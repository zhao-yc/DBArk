import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewFile } from '../../src/engine/files';
import { readXmlRecords } from '../../src/engine/xmlImport';
import { validateCommand } from '../../src/shared/validation';
import { importPresetConfigurationSchema } from '../../src/shared/importPresets';
import { fileImportTransactionMode } from '../../src/shared/fileImportTransaction';

const xmlOptions = { rowTag: '记录', attributes: true, binaryBase64: true };
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
const parse = (filePath: string, options = xmlOptions) => collect(readXmlRecords(filePath, options));
let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'dbark-xml-import-')); filePath = join(folder, '数据.xml'); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

it('合并属性和子元素，扫描到末行才确定列，缺失和空文本各自保留', async () => {
  const rows = '<记录 id="18446744073709551615" __proto__="文本&#9;&#10;&#13;"><note><![CDATA[<&>]]> &amp;🚢</note><empty/></记录>';
  await writeFile(filePath, '\uFEFF<?xml version="1.0" encoding="UTF-8"?><data>' + rows.repeat(20) + '<记录 id="21"><last>最后</last></记录></data>');
  const result = await previewFile({filePath, format: 'xml', encoding: 'utf8', xmlOptions});
  expect(result.columns).toEqual(['id', '__proto__', 'note', 'empty', 'last']);
  expect(result.rows).toHaveLength(20);
  expect(Object.entries(result.rows[0])).toEqual([['id', '18446744073709551615'], ['__proto__', '文本\t\n\r'], ['note', '<&> &🚢'], ['empty', ''], ['last', null]]);
  expect(Object.keys((await parse(filePath, {...xmlOptions, attributes: false}))[0])).toEqual(['note', 'empty']);
  await expect(collect(readXmlRecords(filePath, xmlOptions, {requiredColumns: ['不存在']}))).rejects.toThrow('缺少已映射的源字段');
});

it.each([
  '<!DOCTYPE d [<!ENTITY x SYSTEM "file:///tmp/secret">]><d><记录><note>&x;</note></记录></d>',
  '<?xml version="1.1"?><d><记录/></d>',
  '<?xml version="1.0" encoding="GB18030"?><d><记录/></d>',
  '<d><记录><a><b/></a></记录></d>',
  '<d><记录 a="1"><a>2</a></记录></d>',
  '<d xmlns="urn:example"><记录/></d>',
  '<d><记录><a>正常</a></记录><其它/></d>',
  '<d><记录/></d><d/>',
])('拒绝不支持或损坏的 XML %s', async source => {
  await writeFile(filePath, source);
  await expect(parse(filePath)).rejects.toThrow();
});

it('UTF-8 解码错误和取消均终止读取', async () => {
  await writeFile(filePath, Buffer.concat([Buffer.from('<d><记录><note>'), Buffer.from([0xc3, 0x28]), Buffer.from('</note></记录></d>')]));
  await expect(parse(filePath)).rejects.toThrow('UTF-8');
  const controller = new AbortController();
  controller.abort();
  await expect(collect(readXmlRecords(filePath, xmlOptions, {signal: controller.signal}))).rejects.toThrow();
});

it('预览、预检、执行和配置共同约束 XML 参数，导入只允许整文件事务', () => {
  const file = { fileToken: 'file', format: 'xml', encoding: 'utf8', xmlOptions };
  const target = { connectionId: 'connection', database: 'database', table: 'table', taskId: 'task', mapping: {id: 'id'} };
  expect(validateCommand('files.preview', file)).toMatchObject({xmlOptions});
  expect(validateCommand('files.preflight', {...target, ...file})).toMatchObject({xmlOptions});
  expect(validateCommand('files.import', {...target, ...file, transactionMode: 'atomic'})).toMatchObject({xmlOptions});
  expect(() => validateCommand('files.preview', {...file, encoding: 'utf16le'})).toThrow('UTF-8');
  expect(() => validateCommand('files.preview', {...file, format: 'json'})).toThrow();
  expect(() => validateCommand('files.import', {...target, ...file, transactionMode: 'batch'})).toThrow('整文件');
  expect(fileImportTransactionMode('xml', {})).toBe('atomic');
  expect(importPresetConfigurationSchema.parse({format: 'xml', encoding: 'utf8', xmlOptions, columns: ['id'], mapping: {id: 'id'}})).toMatchObject({xmlOptions});
});
