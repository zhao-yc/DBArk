import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createQueryStreamFile } from '../../src/engine/queryStreamFile';
import { ResultFileTasks } from '../../src/engine/resultFileTasks';
import { queryHtmlRow } from '../../src/engine/queryHtml';
import { queryHtmlZh } from '../../src/shared/queryHtml.zh-CN';
import { validateCommand } from '../../src/shared/validation';

const hostile = '<img src="https://example.invalid/" onerror="alert(1)"> & 中文🚢\u0000';
const options = { fileToken: 'file', taskId: 'test', format: 'html', encoding: 'utf8' } as const;
const stream = { ...options, sql: 'SELECT 1', sessionId: 'session', protocol: 'text-strict', resultSelection: { kind: 'all' } } as const;
const column = { position: 1, key: 'x', name: '<b>字段</b>', exportName: '<b>字段</b>', type: 'TEXT' };
const snapshot = { ...options, result: { columns: [{ key: 'x', name: column.name }], rows: [{ x: hostile }], truncated: true } };
let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'dbark-query-html-')); filePath = join(folder, 'out.html'); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

it('独立网页保留结果顺序、空表头和协议回执，文本只能进入转义后的单元格', async () => {
  const output = await createQueryStreamFile({ ...stream, filePath, checkCancelled() {}, onCommitStart() {} });
  try {
    await output.write({ kind: 'status', resultOrdinal: 1, statementOrdinal: 1, affectedRows: 1, insertId: '9007199254740993', warningCount: 2 });
    await output.write({ kind: 'rows-start', resultOrdinal: 2, statementOrdinal: 2, rowResultOrdinal: 1, columns: [column] });
    await output.write({ kind: 'row', resultOrdinal: 2, values: [hostile] });
    await output.write({ kind: 'rows-end', resultOrdinal: 2 });
    await output.write({ kind: 'rows-start', resultOrdinal: 3, statementOrdinal: 2, rowResultOrdinal: 2, columns: [column] });
    await output.write({ kind: 'rows-end', resultOrdinal: 3 });
    await output.complete();
    expect(output.rowsWritten).toBe(1);
  } finally { await output.abort(); }
  const html = await readFile(filePath, 'utf8');
  expect(html).toMatch(/^<!doctype html>\n/);
  expect(html).toContain('Content-Security-Policy');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain('&lt;img src=&quot;https://example.invalid/&quot; onerror=&quot;alert(1)&quot;&gt; &amp; 中文🚢<span class="control">\\u0000</span>');
  expect(html).not.toContain('<img');
  expect(html.match(/<h2>[^<]+<\/h2>/g)).toEqual(['<h2>结果 1 · 语句 1</h2>', '<h2>结果 2 · 语句 2</h2>', '<h2>结果 3 · 语句 2</h2>']);
  expect(html).toContain('影响 1 行 · 插入 ID 9007199254740993 · 警告 2 条');
  expect(html).toContain('<th scope="col">&lt;b&gt;字段&lt;/b&gt;</th>');
  expect(html).toContain('<tbody>\n</tbody>');
  expect(html.endsWith('</main></body></html>\n')).toBe(true);
  expect(await readdir(folder)).toEqual(['out.html']);
});

it('已返回结果包含截断提示，区分 NULL、空字符串、二进制和文本', async () => {
  const result = { ...snapshot.result, rows: [
    { x: null }, { x: '' }, { x: { type: 'binary' as const, base64: 'AP8=' } }, { x: 'NULL' }, { x: -0 },
  ] };
  expect(await new ResultFileTasks(() => {}).run({ ...snapshot, result, filePath })).toEqual({ rows: 5 });
  const html = await readFile(filePath, 'utf8');
  expect(html).toContain(queryHtmlZh.truncated);
  expect(html.match(/<td[^>]*>[^<]*<\/td>/g)).toEqual([
    '<td data-kind="null" class="marker">NULL</td>', '<td data-kind="empty" class="marker">空字符串</td>',
    '<td data-kind="binary">base64:AP8=</td>', '<td>NULL</td>', '<td>-0</td>',
  ]);
});

it('取消和转义后超限均保留已存在的目标文件', async () => {
  await writeFile(filePath, '原文件');
  let cancelled = false;
  const output = await createQueryStreamFile({ ...stream, filePath, checkCancelled() { if (cancelled) throw Error('已取消'); }, onCommitStart() {} });
  try {
    await output.write({ kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: [column] });
    await expect(output.write({ kind: 'row', resultOrdinal: 1, values: ['&'.repeat(2 * 1024 * 1024)] })).rejects.toThrow(queryHtmlZh.field);
    await output.write({ kind: 'rows-end', resultOrdinal: 1 });
    cancelled = true;
    await expect(output.complete()).rejects.toThrow('已取消');
  } finally { await output.abort(); }
  expect(await readFile(filePath, 'utf8')).toBe('原文件');
  expect(await readdir(folder)).toEqual(['out.html']);
  expect(() => queryHtmlRow([{ type: 'binary', base64: 'AB==' }])).toThrow(queryHtmlZh.invalid);
});

it('四条 IPC 路径都要求 UTF-8，MySQL 网页始终接收全部结果', () => {
  const full = { ...options, sql: 'SELECT 1', connectionId: 'connection' };
  for (const [command, input] of [
    ['sqlite.queryExport', full], ['postgres.query.export', { ...full, database: 'db' }],
    ['query.exportStream', stream], ['files.exportResult', snapshot],
  ] as const) {
    expect(validateCommand(command, input)).toMatchObject(options);
    expect(() => validateCommand(command, { ...input, encoding: 'gb18030' })).toThrow(queryHtmlZh.utf8);
    expect(() => validateCommand(command, { ...input, csvDelimiter: ';' })).toThrow();
  }
  expect(() => validateCommand('query.exportStream', { ...stream, resultSelection: { kind: 'row-result', ordinal: 1 } })).toThrow();
});
