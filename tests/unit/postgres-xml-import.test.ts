import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { inspectPostgresRecordImportSource, readPostgresRecordImportSource } from '../../src/engine/postgres/recordImportFile';
import { postgresTableImportChooseSchema, postgresTableImportSchema } from '../../src/shared/postgresTable';

const xmlOptions = { rowTag: 'entry', attributes: true, binaryBase64: true };
let folder: string, path: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'dbark-postgres-xml-')); path = join(folder, 'source.xml'); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });
async function text(stream: Readable): Promise<string> {
  let value = '';
  for await (const chunk of stream) value += String(chunk);
  return value;
}

it('XML 完整扫描保留后续列，COPY 按映射区分 NULL、空串、特殊文本和 BYTEA', async () => {
  await writeFile(path, '<data><entry id="9223372036854775807" raw="AP8="><note>\\.</note></entry><entry id="2" raw=""><note/></entry><entry id="3"><after>后来字段</after></entry></data>');
  const { source, sample } = await inspectPostgresRecordImportSource(path, { format: 'xml', encoding: 'utf8', xmlOptions }, () => {});
  expect(source.header).toEqual(['id', 'raw', 'note', 'after']);
  expect(sample).toEqual([['9223372036854775807', 'AP8=', '\\.', null], ['2', '', '', null], ['3', null, null, '后来字段']]);
  const fields = [{ name: 'note', binary: false }, { name: 'raw', binary: true }];
  expect(await readPostgresRecordImportSource(source, fields, () => {}, async stream => {
    expect(await text(stream)).toBe('"\\.","\\x00ff"\n"","\\x"\n\\N,\\N\n');
    return 3;
  })).toBe(3);
  await expect(readPostgresRecordImportSource(source, fields, () => {}, async stream => { await text(stream); return 2; })).rejects.toThrow('记录数不一致');
});

it('拒绝读取符号链接、已检查后改写的 XML 和无效 Base64', async () => {
  await writeFile(path, '<data><entry raw="AP8="/></data>');
  const link = join(folder, 'link.xml');
  if (process.platform !== 'win32') {
    await symlink(path, link);
    await expect(inspectPostgresRecordImportSource(link, { format: 'xml', encoding: 'utf8', xmlOptions }, () => {})).rejects.toThrow();
  }
  const { source } = await inspectPostgresRecordImportSource(path, { format: 'xml', encoding: 'utf8', xmlOptions }, () => {});
  await writeFile(path, '<data><entry raw="AAAA"/></data>');
  const fields = [{ name: 'raw', binary: true }], consume = async (stream: Readable) => { await text(stream); return 1; };
  await expect(readPostgresRecordImportSource(source, fields, () => {}, consume)).rejects.toThrow('变化');
  await writeFile(path, '<data><entry raw="AB=="/></data>');
  const invalid = await inspectPostgresRecordImportSource(path, { format: 'xml', encoding: 'utf8', xmlOptions }, () => {});
  await expect(readPostgresRecordImportSource(invalid.source, fields, () => {}, consume)).rejects.toThrow('规范 Base64');
});

it('XML 和原 CSV 文件选择与映射保持独立合同', () => {
  const token = '39041f23-9317-48e3-8508-748df1682040';
  const target = { connectionId: 'connection', database: 'db', table: 'table', tabId: 'tab', pageToken: token };
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions, csvDelimiter: ',' }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, csvDelimiter: ';', csvHasHeader: false }).success).toBe(true);
  const scannedFile = { token, expectedSource: { sha256: '0'.repeat(64), bytes: 200 } };
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions, scannedFile }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, csvDelimiter: ',', scannedFile }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions, scannedFile: { token } }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'csv', encoding: 'utf16le', csvDelimiter: ';', csvHasHeader: false, scannedFile }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'json', encoding: 'gb18030', scannedFile }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'json', encoding: 'utf8' }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'json', encoding: 'ascii' }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'json', encoding: 'utf8', scannedFile, csvHasHeader: true }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'csv', encoding: 'utf8', csvDelimiter: ',', csvHasHeader: true }).success).toBe(false);
  const apply = { ...target, taskId: 'task', fileToken: token };
  expect(postgresTableImportSchema.safeParse({ ...apply, format: 'xml', columns: ['c1', null, 'c2'] }).success).toBe(true);
  const conflict = { mode: 'upsert', keyId: 'a'.repeat(64) };
  expect(postgresTableImportSchema.safeParse({ ...apply, columns: ['c1', 'c2'], conflict }).success).toBe(true);
  expect(postgresTableImportSchema.safeParse({ ...apply, format: 'json', columns: ['c1', null, 'c2'], conflict }).success).toBe(true);
  expect(postgresTableImportSchema.safeParse({ ...apply, columns: ['c1'], conflict: { ...conflict, keyId: '任意索引名' } }).success).toBe(false);
  expect(postgresTableImportSchema.safeParse({ ...apply, columns: ['c1'], conflict: { ...conflict, mode: 'replace' } }).success).toBe(false);
  expect(postgresTableImportSchema.safeParse({ ...apply, format: 'xml', columns: [null] }).success).toBe(false);
  expect(postgresTableImportSchema.safeParse({ ...apply, columns: ['c1', null] }).success).toBe(false);
});

it('JSON 保留精确数字、嵌套值、空串和 NULL，只对 bytea 解码二进制对象', async () => {
  await writeFile(path, '[{"id":9223372036854775807,"raw":{"type":"binary","base64":"AP8="},"note":""},{"id":2,"nested":{"n":9007199254740993.123456789012}}]');
  const { source } = await inspectPostgresRecordImportSource(path, { format: 'json', encoding: 'utf8' }, () => {});
  expect(source.header).toEqual(['id', 'raw', 'note', 'nested']);
  const fields = source.header.map(name => ({ name, binary: name === 'raw' }));
  await readPostgresRecordImportSource(source, fields, () => {}, async stream => {
    expect(await text(stream)).toBe('"9223372036854775807","\\x00ff","",\\N\n"2",\\N,\\N,"{""n"":9007199254740993.123456789012}"\n');
    return 2;
  });
});
