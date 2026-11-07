import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SaxesParser } from 'saxes';
import { createQueryStreamFile } from '../../src/engine/queryStreamFile';
import { dataMarkupWriter } from '../../src/engine/dataMarkupExport';
import { ResultFileTasks } from '../../src/engine/resultFileTasks';
import { dataXmlZh, xmlRecordLayouts } from '../../src/shared/dataMarkupExport';
import { validateCommand } from '../../src/shared/validation';

const options = { fileToken: 'file', taskId: 'test', format: 'xml', encoding: 'utf8' } as const;
const stream = { ...options, sql: 'SELECT 1', sessionId: 'session', protocol: 'text-strict', resultSelection: { kind: 'all' } } as const;
const columns = ['a:b', 'a:b', '', '非法\0列'].map((name, i) => ({ position: i + 1, key: 'c' + i, name, exportName: '输出' + i, type: 'TEXT' }));
const payload = '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///tmp/example">]> & 中文🚢\r\n\t]]>';
const snapshot = { ...options, result: { columns: columns.map(({key, name}) => ({key, name})), rows: [{ c0: payload, c1: '\0\ud800🚢', c2: -0, c3: true }], truncated: true } };
let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'dbark-data-xml-')); filePath = join(folder, 'out.xml'); });
afterEach(async () => { await rm(folder, {recursive: true, force: true}); });

function parse(source: string) {
  const elements: { name: string; attributes: Record<string, string>; text: string }[] = [];
  const stack: typeof elements = [];
  const parser = new SaxesParser();
  parser.on('doctype', () => { throw Error('导出文件不允许 DTD'); });
  parser.on('opentag', tag => {
    const entry = { name: tag.name, attributes: {...tag.attributes}, text: '' };
    stack.push(entry); elements.push(entry);
  });
  parser.on('text', value => { if (stack.length) stack.at(-1)!.text += value; });
  parser.on('closetag', () => stack.pop());
  parser.write(source).close();
  return elements;
}

it('真实快照保留重复列、空名、精确文本与非法 XML 码元，正文无法注入 DTD', async () => {
  expect(await new ResultFileTasks(() => {}).run({...snapshot, filePath})).toEqual({rows: 1});
  const source = await readFile(filePath, 'utf8'), parsed = parse(source);
  expect(source).toMatch(/^<\?xml version="1.0" encoding="UTF-8" standalone="yes"\?>/);
  expect(parsed[0]).toMatchObject({name: 'tabrelio-data', attributes: {version: '1', scope: 'returned', truncated: 'true'}});
  const fields = parsed.filter(item => item.name === 'column');
  expect(fields.slice(0, 3).map(item => item.text)).toEqual(['a:b', 'a:b', '']);
  expect(fields[3].attributes.encoding).toBe('utf16le-base64');
  expect(Buffer.from(fields[3].text, 'base64').toString('utf16le')).toBe(columns[3].name);
  const values = parsed.filter(item => item.name === 'cell');
  expect(values.map(item => item.attributes.kind)).toEqual(['text', 'text', 'number', 'boolean']);
  expect(values[0].text).toBe(payload);
  expect(values[1].attributes.encoding).toBe('utf16le-base64');
  expect(Buffer.from(values[1].text, 'base64').toString('utf16le')).toBe(snapshot.result.rows[0].c1);
  expect(values.slice(2).map(item => item.text)).toEqual(['-0', 'true']);
});

it('流式文件在同一根元素保持协议顺序、空行集、空文本、NULL 和字节', async () => {
  const output = await createQueryStreamFile({...stream, filePath, checkCancelled() {}, onCommitStart() {}});
  try {
    await output.write({kind: 'status', resultOrdinal: 1, statementOrdinal: 1, affectedRows: 1, insertId: '9007199254740993', warningCount: 0});
    await output.write({kind: 'rows-start', resultOrdinal: 2, statementOrdinal: 2, rowResultOrdinal: 1, columns});
    await output.write({kind: 'row', resultOrdinal: 2, values: [null, '', {type: 'binary', base64: ''}, '9007199254740993']});
    await output.write({kind: 'rows-end', resultOrdinal: 2});
    await output.write({kind: 'rows-start', resultOrdinal: 3, statementOrdinal: 2, rowResultOrdinal: 2, columns: columns.slice(0, 1)});
    await output.write({kind: 'rows-end', resultOrdinal: 3, warningCount: 1});
    await output.complete();
    expect(output.rowsWritten).toBe(1);
  } finally { await output.abort(); }
  const parsed = parse(await readFile(filePath, 'utf8'));
  expect(parsed.filter(item => ['receipt','result'].includes(item.name)).map(({name, attributes}) => [name, attributes.ordinal, attributes.statement]))
    .toEqual([['receipt','1','1'], ['result','2','2'], ['result','3','2']]);
  expect(parsed.find(item => item.name === 'receipt')?.attributes['insert-id']).toBe('9007199254740993');
  expect(parsed.filter(item => item.name === 'cell').map(item => [item.attributes.kind, item.attributes.encoding, item.text]))
    .toEqual([['null',undefined,''], ['text',undefined,''], ['binary','base64',''], ['text',undefined,'9007199254740993']]);
  expect(parsed.filter(item => item.name === 'summary').map(item => item.attributes)).toEqual([{rows:'1'}, {rows:'0', warnings:'1'}]);
});

it('字段转义超限和取消不会发布半份 XML，二进制必须是规范 Base64', async () => {
  await writeFile(filePath, '原文件');
  let cancelled = false;
  const output = await createQueryStreamFile({...stream, filePath, checkCancelled() { if (cancelled) throw Error('已取消'); }, onCommitStart() {}});
  try {
    await output.write({kind: 'rows-start', resultOrdinal: 1, statementOrdinal: 1, rowResultOrdinal: 1, columns: columns.slice(0, 1)});
    await expect(output.write({kind: 'row', resultOrdinal: 1, values: ['&'.repeat(2 * 1024 * 1024)]})).rejects.toThrow(dataXmlZh.field);
    await output.write({kind: 'rows-end', resultOrdinal: 1});
    cancelled = true;
    await expect(output.complete()).rejects.toThrow('已取消');
  } finally { await output.abort(); }
  expect(await readFile(filePath, 'utf8')).toBe('原文件');
  expect(await readdir(folder)).toEqual(['out.xml']);
  expect(() => dataMarkupWriter('xml')!.row([{type:'binary', base64:'AB=='}])).toThrow(dataXmlZh.invalid);
});

it.each(['xml', ...xmlRecordLayouts] as const)('查询、表和视图七个 IPC 接受 %s 并锁定 UTF-8', format => {
  const target = { ...options, connectionId: 'connection', database: 'main', table: 'example' };
  const token = '39041f23-9317-48e3-8508-748df1682040';
  for (const [command, input] of [
    ['files.exportResult', snapshot], ['query.exportStream', stream],
    ['sqlite.queryExport', {...options, connectionId: target.connectionId, sql: 'SELECT 1'}],
    ['postgres.query.export', {...options, connectionId: target.connectionId, database: 'test', sql: 'SELECT 1'}],
    ['sqlite.tableExport', {...target, schemaKey: '0'.repeat(64), mode: 'and', filters: [], sort: [], columns: ['id']}],
    ['postgres.table.export', {...target, fileToken: token, exportToken: token, tabId: 'tab', columns: ['c0']}],
    ['table.exportFiltered', {...target, metadataKey: 'key', filters: [], sort: [], columns: ['id']}],
  ] as const) {
    const payload = {...input, format, ...(command === 'query.exportStream' && format !== 'xml' ? {resultSelection: {kind: 'row-result', ordinal: 2}} : {})};
    expect(validateCommand(command, payload)).toMatchObject({format, encoding: 'utf8'});
    expect(() => validateCommand(command, {...payload, encoding: 'gb18030'})).toThrow(dataXmlZh.utf8);
    expect(() => validateCommand(command, {...payload, csvDelimiter: ';'})).toThrow();
    if (command === 'query.exportStream' && format !== 'xml') {
      expect(() => validateCommand(command, {...payload, resultSelection: {kind: 'all'}})).toThrow('须指定行结果集');
    }
  }
});

it.each(xmlRecordLayouts)('%s 按原列名输出，解析后保留文本、空字符串、精确数字和字节', async format => {
  const fields = ['备注', 'missing', 'empty', 'raw', 'exact-id', '𐐀'];
  const values = [payload, null, '', {type: 'binary' as const, base64: 'AP8='}, '9223372036854775807', true];
  const result = { truncated: false, columns: fields.map((name, index) => ({name, key: 'c' + index})),
    rows: [Object.fromEntries(values.map((value, index) => ['c' + index, value]))] };
  expect(await new ResultFileTasks(() => {}).run({...options, format, result, filePath})).toEqual({rows: 1});
  const parsed = parse(await readFile(filePath, 'utf8'));
  expect(parsed.slice(0, 2).map(item => item.name)).toEqual(['RECORDS', 'RECORD']);
  const entries = Object.entries({'备注': payload, empty: '', raw: 'AP8=', 'exact-id': '9223372036854775807', '𐐀': 'true'});
  expect(format === 'xml-elements' ? parsed.slice(2).map(item => [item.name, item.text]) : Object.entries(parsed[1].attributes)).toEqual(entries);
});

it.each(xmlRecordLayouts)('%s 拒绝无效或重复列名，且写入失败不覆盖已有文件', async format => {
  const writer = dataMarkupWriter(format)!;
  for (const name of ['', '1id', 'a:b', 'a b', 'a\n', '\u037e']) expect(() => writer.tableStart([name])).toThrow('第 1 列');
  expect(() => writer.tableStart(['id', 'id'])).toThrow('第 2 列的列名重复');
  if (format === 'xml-attributes') expect(() => writer.tableStart(['xmlns'])).toThrow('第 1 列');
  await writeFile(filePath, '原文件');
  const result = { truncated: false, columns: [{name: '备注', key: 'note'}], rows: [{note: '有效首行'}, {note: '\0'}] };
  await expect(new ResultFileTasks(() => {}).run({...options, format, result, filePath})).rejects.toThrow('第 1 列的值含 XML 1.0 禁用字符');
  expect(await readFile(filePath, 'utf8')).toBe('原文件');
  expect(await readdir(folder)).toEqual(['out.xml']);
});
