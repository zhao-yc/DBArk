import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { previewFile } from '../../src/engine/files';
import { createQueryStreamFile } from '../../src/engine/queryStreamFile';
import { ResultFileTasks } from '../../src/engine/resultFileTasks';
import { txtWriter } from '../../src/engine/txtExport';
import { txtExportDefaults, txtExportZh } from '../../src/shared/txtExport';
import { validateCommand } from '../../src/shared/validation';
import { fullQueryExportProfileMutation } from '../../src/shared/fullQueryExportProfiles';

const token = '39041f23-9317-48e3-8508-748df1682040';
const options = { format: 'txt', encoding: 'utf16le', taskId: 'txt-task', fileToken: token,
  txtOptions: { ...txtExportDefaults, delimiter: '||', recordDelimiter: 'cr', quote: 'single' } } as const;
const columns = ['note', 'exact', 'missing', 'empty', 'raw'].map((name, index) => ({name, key: 'c' + index}));
const data = { columns, rows: [{c0: "含'引号\r\n与🚢\0|", c1: '9223372036854775807', c2: null, c3: '', c4: {type: 'binary' as const, base64: 'AP8='}},
  {c0: '\\N', c1: '9007199254740993', c2: '', c3: '', c4: {type: 'binary' as const, base64: ''}}], truncated: false };
let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'tabrelio-txt-export-')); filePath = join(folder, 'out.txt'); });
afterEach(async () => { await rm(folder, {recursive: true, force: true}); });

it.each(['utf8', 'utf16le', 'gb18030'] as const)('查询快照 TXT 按 %s 回读精确值、字节、换行及空字符串', async encoding => {
  await new ResultFileTasks(() => {}).run({...options, encoding, result: data, filePath});
  const bytes = await readFile(filePath);
  if (encoding === 'utf16le') expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
  expect(iconv.decode(bytes, encoding)).toContain("'含''引号\r\n与🚢\0|'||");
  const { rows } = await previewFile({...options, encoding, filePath, txtOptions: {...options.txtOptions, mode: 'delimited'}});
  expect(rows).toEqual([
    {note: data.rows[0].c0, exact: data.rows[0].c1, missing: null, empty: '', raw: 'base64:AP8='},
    {note: '\\N', exact: data.rows[1].c1, missing: '', empty: '', raw: 'base64:'},
  ]);
});

it('无引号仍可写单列空值，跨字段歧义和无法编码的行保留原文件', async () => {
  const txtOptions = {...options.txtOptions, quote: 'none' as const, hasHeader: false};
  const writer = txtWriter(txtOptions);
  expect(writer.tableStart(['empty'])).toBe('');
  await writeFile(filePath, writer.row(['']) + writer.row(['']));
  expect((await previewFile({filePath, format: 'txt', encoding: 'utf8', txtOptions: {...txtOptions, mode: 'delimited'}})).rows).toEqual([{'第1列': ''}, {'第1列': ''}]);
  writer.tableStart(['left', 'right']);
  expect(() => writer.row(['尾部|', '正文'])).toThrow(txtExportZh.needsQuote);
  const unambiguous = txtWriter({...txtOptions, delimiter: '|;'});
  unambiguous.tableStart(['left', 'right']);
  expect(unambiguous.row(['尾部|', '正文'])).toBe('尾部||;正文\r');
  await writeFile(filePath, '原文件');
  await expect(new ResultFileTasks(() => {}).run({...options, txtOptions, result: data, filePath})).rejects.toThrow(txtExportZh.needsQuote);
  expect(await readFile(filePath, 'utf8')).toBe('原文件');
  expect(await readdir(folder)).toEqual(['out.txt']);
});

it('流式 TXT 仅写指定行结果集，忽略语句回执和其它结果', async () => {
  const output = await createQueryStreamFile({...options, filePath, encoding: 'utf8', resultSelection: {kind: 'row-result', ordinal: 2}, checkCancelled() {}, onCommitStart() {}});
  const fields = columns.slice(0, 1).map((column, index) => ({...column, exportName: column.name, position: index + 1, type: 'TEXT'}));
  try {
    await output.write({kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: fields});
    await output.write({kind: 'row', resultOrdinal: 1, values: ['排除']});
    await output.write({kind: 'rows-end', resultOrdinal: 1});
    await output.write({kind: 'status', resultOrdinal: 2, statementOrdinal: 2, affectedRows: 1, insertId: '0', warningCount: 0});
    await output.write({kind: 'rows-start', resultOrdinal: 3, statementOrdinal: 3, rowResultOrdinal: 2, columns: fields});
    await output.write({kind: 'row', resultOrdinal: 3, values: [-0]});
    await output.write({kind: 'rows-end', resultOrdinal: 3});
    await output.complete();
    expect(output.rowsWritten).toBe(1);
    expect(await readFile(filePath, 'utf8')).toBe('note\r-0\r');
  } finally { await output.abort(); }
});

it('七个导出入口和命名方案共同校验 TXT 配置', () => {
  const target = {...options, connectionId: 'connection', database: 'main', table: 'example'};
  const {txtOptions: _removed, ...defaults} = options;
  for (const [command, fields] of [
    ['files.exportResult', {result: data}],
    ['query.exportStream', {sessionId: 'session', sql: 'SELECT 1', protocol: 'text-strict', resultSelection: {kind: 'row-result', ordinal: 1}}],
    ['sqlite.queryExport', {connectionId: 'connection', sql: 'SELECT 1'}],
    ['postgres.query.export', {connectionId: 'connection', database: 'test', sql: 'SELECT 1'}],
    ['sqlite.tableExport', {connectionId: target.connectionId, database: 'main', table: 'example', schemaKey: '0'.repeat(64), mode: 'and', filters: [], sort: [], columns: ['id']}],
    ['postgres.table.export', {connectionId: target.connectionId, database: 'main', table: 'example', exportToken: token, tabId: 'tab', columns: ['c0']}],
    ['table.exportFiltered', {connectionId: target.connectionId, database: 'main', table: 'example', metadataKey: 'key', filters: [], sort: [], columns: ['id']}],
  ] as const) {
    expect(validateCommand(command, {...options, ...fields})).toMatchObject(options);
    expect(() => validateCommand(command, {...defaults, ...fields})).toThrow(txtExportZh.invalid);
    expect(() => validateCommand(command, {...options, ...fields, csvDelimiter: ';'})).toThrow();
    expect(() => validateCommand(command, {...options, ...fields, format: 'csv'})).toThrow();
  }
  const profile = {format: options.format, encoding: options.encoding, txtOptions: options.txtOptions};
  expect(fullQueryExportProfileMutation.parse({kind: 'add', dialect: 'sqlite', profile: {name: 'TXT', options: profile}})).toMatchObject({profile: {options: profile}});
});
