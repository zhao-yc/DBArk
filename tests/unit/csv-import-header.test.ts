import { mkdtemp, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReadStream } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';
import type { DataRow } from '../../src/shared/contracts';
import { csvImportColumnName, csvImportHasHeader, type CsvImportDelimiter } from '../../src/shared/csvImport';

const observed = vi.hoisted(() => ({ streams: [] as ReadStream[], closes: new Set<ReadStream>() }));
// 仅旁路记录真实文件流；解析、磁盘读取和 close 均不替换为模拟结果。
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    const stream = actual.createReadStream(...args); observed.streams.push(stream);
    stream.once('close', () => observed.closes.add(stream)); return stream;
  } };
});
import { previewFile, readRecords } from '../../src/engine/files';

const folders: string[] = [];
/** 手写 CSV 文本独立于产品导出器，覆盖首条即数据的含义。 */
async function fixture(text: string, encoding = 'utf8'): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'dbark-csv-header-')); folders.push(folder);
  const path = join(folder, 'source.csv'); await writeFile(path, iconv.encode(text, encoding)); return path;
}
/** 完整消费读取器，不受预览二十条上限影响。 */
async function records(path: string, delimiter?: CsvImportDelimiter, hasHeader?: boolean, encoding = 'utf8'): Promise<DataRow[]> {
  const rows: DataRow[] = []; for await (const row of readRecords(path, 'csv', encoding, delimiter, hasHeader)) rows.push(row); return rows;
}
/** 原 close 已到且流已关闭才算归还句柄，destroy 调用本身不当作完成证据。 */
function expectClosed(count: number): void {
  expect(observed.streams).toHaveLength(count);
  for (const stream of observed.streams) { expect(stream.destroyed).toBe(true); expect(stream.closed).toBe(true); expect(observed.closes.has(stream)).toBe(true); }
}
beforeEach(() => { observed.streams.length = 0; observed.closes.clear(); });
/** 只精确删除本文件创建的合成文件和目录。 */
afterEach(async () => {
  for (const stream of observed.streams) stream.destroy();
  for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); }
});

describe('CSV 无标题共享规则', () => {
  it('缺省保持首行为标题，显式选项只接受 CSV 布尔值', () => {
    expect(csvImportHasHeader('csv')).toBe(true); expect(csvImportHasHeader('json')).toBe(true);
    expect(csvImportHasHeader('csv', true)).toBe(true); expect(csvImportHasHeader('csv', false)).toBe(false);
    for (const format of ['json', 'sql', 'xlsx']) for (const value of [true, false]) expect(() => csvImportHasHeader(format, value)).toThrow('只适用于 CSV');
    for (const value of [null, 0, 1, '', 'false', [], {}]) expect(() => csvImportHasHeader('csv', value as unknown as boolean)).toThrow('布尔值');
    expect(csvImportColumnName(0)).toBe('第1列'); expect(csvImportColumnName(1023)).toBe('第1024列');
    for (const index of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => csvImportColumnName(index)).toThrow('列序号');
  });
});

describe('CSV 无标题真实流式解析', () => {
  it.each(['utf8', 'utf16le', 'gb18030'])('编码 %s 的三种分隔符保留首条、精度、跨行引号、NULL 与反斜线', async encoding => {
    for (const delimiter of [',', ';', '\t'] as const) {
      const bom = encoding === 'gb18030' ? '' : '\uFEFF';
      const path = await fixture(`${bom}18446744073709551615${delimiter}123456789012345678.123456789012${delimiter}"含${delimiter}双""引号""\r\n下一行"${delimiter}\\N${delimiter}\\\\N${delimiter}\r\n`, encoding);
      const expected = [{ 第1列: '18446744073709551615', 第2列: '123456789012345678.123456789012', 第3列: `含${delimiter}双"引号"\r\n下一行`, 第4列: null, 第5列: '\\N', 第6列: '' }];
      expect(await records(path, delimiter, false, encoding)).toEqual(expected);
      expect(await previewFile({ filePath: path, format: 'csv', encoding, csvDelimiter: delimiter, csvHasHeader: false })).toEqual({ columns: ['第1列', '第2列', '第3列', '第4列', '第5列', '第6列'], rows: expected });
    }
    expectClosed(6);
  });
  it('重复或空首行值属于数据，原型同名文字不影响安全序号键', async () => {
    const path = await fixture('重复,重复,,__proto__,constructor\n第二行,原文,,prototype,toString\n');
    const rows = await records(path, undefined, false);
    expect(rows).toEqual([{ 第1列: '重复', 第2列: '重复', 第3列: '', 第4列: '__proto__', 第5列: 'constructor' }, { 第1列: '第二行', 第2列: '原文', 第3列: '', 第4列: 'prototype', 第5列: 'toString' }]);
    expect(rows.every(row => Object.getPrototypeOf(row) === null)).toBe(true); expectClosed(1);
  });
  it('空文件没有记录，仅一个换行恰好一条空串，单条文件在无标题模式不会丢失', async () => {
    expect(await records(await fixture(''), undefined, false)).toEqual([]);
    expect(await records(await fixture('\n'), undefined, false)).toEqual([{ 第1列: '' }]);
    expect(await records(await fixture('\n值\n'), undefined, false)).toEqual([{ 第1列: '' }, { 第1列: '值' }]);
    expect(await records(await fixture('""\r\n'), undefined, false)).toEqual([{ 第1列: '' }]);
    const one = await fixture('名称,金额\n');
    expect(await records(one, undefined, false)).toEqual([{ 第1列: '名称', 第2列: '金额' }]);
    expect(await records(one)).toEqual([]); expect(await records(one, undefined, true)).toEqual([]);
    expectClosed(7);
  });
  it('缺省和显式有标题保持旧行为，包括跳过空行和拒绝重复或空标题', async () => {
    const path = await fixture('\nid,内容\n\n1,原文\n');
    expect(await records(path)).toEqual([{ id: '1', 内容: '原文' }]);
    expect(await records(path, undefined, true)).toEqual([{ id: '1', 内容: '原文' }]);
    for (const content of ['id,id\n1,2', 'id,\n1,2']) await expect(records(await fixture(content))).rejects.toThrow('CSV 标题');
    expectClosed(4);
  });
  it('每行列数不一致或引号损坏都拒绝，并等待原文件 close', async () => {
    for (const content of ['a,b\nc', 'a,b\nc,d,e', '\na,b', '"未闭合,字段']) await expect(records(await fixture(content), undefined, false)).rejects.toThrow();
    expectClosed(4);
  });
  it('预览二十条包含第一条，完整读取仍保留二十二条，提前 return 也确认 close', async () => {
    const path = await fixture(Array.from({ length: 22 }, (_, i) => `${i};"原文;${i}"`).join('\n'));
    const preview = await previewFile({ filePath: path, format: 'csv', encoding: 'utf8', csvDelimiter: ';', csvHasHeader: false });
    expect(preview.columns).toEqual(['第1列', '第2列']); expect(preview.rows).toHaveLength(20);
    expect(preview.rows[0]).toEqual({ 第1列: '0', 第2列: '原文;0' }); expect(preview.rows[19]).toEqual({ 第1列: '19', 第2列: '原文;19' }); expectClosed(1);
    const all = await records(path, ';', false); expect(all).toHaveLength(22); expect(all[21]).toEqual({ 第1列: '21', 第2列: '原文;21' }); expectClosed(2);
    const iterator = readRecords(path, 'csv', 'utf8', ';', false);
    expect((await iterator.next()).value).toEqual({ 第1列: '0', 第2列: '原文;0' });
    await iterator.return(undefined); expectClosed(3);
  });
  it('选项错误在开流前拒绝，JSON 显式 true/false 均不可用', async () => {
    const missing = join(tmpdir(), 'dbark-csv-header-never-open.invalid');
    for (const csvHasHeader of [true, false]) {
      await expect(previewFile({ filePath: missing, format: 'json', encoding: 'utf8', csvHasHeader })).rejects.toThrow('只适用于 CSV');
      await expect(readRecords(missing, 'json', 'utf8', undefined, csvHasHeader).next()).rejects.toThrow('只适用于 CSV');
    }
    for (const csvHasHeader of [undefined, null, 'false', 0]) await expect(previewFile({ filePath: missing, format: 'csv', encoding: 'utf8', csvHasHeader: csvHasHeader as unknown as boolean })).rejects.toThrow('布尔值');
    await expect(readRecords(missing, 'csv', 'utf8', '|' as CsvImportDelimiter, false).next()).rejects.toThrow('分隔符');
    await expect(readRecords(missing, 'csv', 'invalid', undefined, false).next()).rejects.toThrow('编码');
    expectClosed(0);
  });
});
