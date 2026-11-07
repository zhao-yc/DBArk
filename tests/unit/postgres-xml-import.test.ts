import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { inspectPostgresXmlImportSource, readPostgresXmlImportSource } from '../../src/engine/postgres/xmlImportFile';
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
  const { source, sample } = await inspectPostgresXmlImportSource(path, xmlOptions, () => {});
  expect(source.header).toEqual(['id', 'raw', 'note', 'after']);
  expect(sample).toEqual([['9223372036854775807', 'AP8=', '\\.', null], ['2', '', '', null], ['3', null, null, '后来字段']]);
  const fields = [{ name: 'note', binary: false }, { name: 'raw', binary: true }];
  expect(await readPostgresXmlImportSource(source, fields, () => {}, async stream => {
    expect(await text(stream)).toBe('"\\.","\\x00ff"\n"","\\x"\n\\N,\\N\n');
    return 3;
  })).toBe(3);
  await expect(readPostgresXmlImportSource(source, fields, () => {}, async stream => { await text(stream); return 2; })).rejects.toThrow('记录数不一致');
});

it('拒绝读取符号链接、已检查后改写的 XML 和无效 Base64', async () => {
  await writeFile(path, '<data><entry raw="AP8="/></data>');
  const link = join(folder, 'link.xml');
  if (process.platform !== 'win32') {
    await symlink(path, link);
    await expect(inspectPostgresXmlImportSource(link, xmlOptions, () => {})).rejects.toThrow();
  }
  const { source } = await inspectPostgresXmlImportSource(path, xmlOptions, () => {});
  await writeFile(path, '<data><entry raw="AAAA"/></data>');
  const fields = [{ name: 'raw', binary: true }], consume = async (stream: Readable) => { await text(stream); return 1; };
  await expect(readPostgresXmlImportSource(source, fields, () => {}, consume)).rejects.toThrow('变化');
  await writeFile(path, '<data><entry raw="AB=="/></data>');
  const invalid = await inspectPostgresXmlImportSource(path, xmlOptions, () => {});
  await expect(readPostgresXmlImportSource(invalid.source, fields, () => {}, consume)).rejects.toThrow('规范 Base64');
});

it('XML 和原 CSV 文件选择与映射保持独立合同', () => {
  const token = '39041f23-9317-48e3-8508-748df1682040';
  const target = { connectionId: 'connection', database: 'db', table: 'table', tabId: 'tab', pageToken: token };
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions }).success).toBe(true);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, format: 'xml', xmlOptions, csvDelimiter: ',' }).success).toBe(false);
  expect(postgresTableImportChooseSchema.safeParse({ ...target, csvDelimiter: ';', csvHasHeader: false }).success).toBe(true);
  const apply = { ...target, taskId: 'task', fileToken: token };
  expect(postgresTableImportSchema.safeParse({ ...apply, format: 'xml', columns: ['c1', null, 'c2'] }).success).toBe(true);
  expect(postgresTableImportSchema.safeParse({ ...apply, format: 'xml', columns: [null] }).success).toBe(false);
  expect(postgresTableImportSchema.safeParse({ ...apply, columns: ['c1', null] }).success).toBe(false);
});
