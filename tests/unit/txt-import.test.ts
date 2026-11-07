import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { previewFile } from '../../src/engine/files';
import { inspectImportFile, readVerifiedImportRecords } from '../../src/engine/importNewTableSource';
import { txtImportDefaults, type TxtImportOptions } from '../../src/shared/txtImport';
import { validateCommand } from '../../src/shared/validation';
import { importPresetConfigurationSchema } from '../../src/shared/importPresets';
import { sqliteImportSourceOptionsKey } from '../../src/shared/sqliteImportSource';

let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'tabrelio-txt-')); filePath = join(folder, 'source.txt'); });
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

it('TXT 自定义分隔、记录换行和单引号保留精确数值及 NULL／空文本', async () => {
  const txtOptions: TxtImportOptions = { mode: 'delimited', delimiter: '||', quote: 'single', recordDelimiter: 'cr', hasHeader: true };
  const content = "\uFEFFid||note||marker\r9223372036854775807||'甲''||乙'||\\N\r";
  await writeFile(filePath, content, 'utf16le');
  const inspected = await inspectImportFile({filePath, fileToken: 'file', taskId: 'task', format: 'txt', encoding: 'utf16le', txtOptions}, () => {});
  expect(inspected.columns).toEqual(['id', 'note', 'marker']);
  expect(inspected.rows).toEqual([{id: '9223372036854775807', note: "甲'||乙", marker: null}]);
  const rows = [];
  for await (const row of readVerifiedImportRecords({filePath, format: 'txt', encoding: 'utf16le', txtOptions, expectedSource: inspected.source}, () => {})) rows.push(row);
  expect(rows).toEqual(inspected.rows);
  await writeFile(filePath, content.replace('乙', '丙'), 'utf16le');
  await expect(async () => {
    for await (const _row of readVerifiedImportRecords({filePath, format: 'txt', encoding: 'utf16le', txtOptions, expectedSource: inspected.source}, () => {})) { /* 读到原字节核验终点。 */ }
  }).rejects.toThrow('变化');
});

it('固定列宽按码点切割，保留无表头首行，拒绝样本之后的短行', async () => {
  const txtOptions: TxtImportOptions = { mode: 'fixed', widths: '2, 3, 2', trimPadding: true, hasHeader: false, recordDelimiter: 'auto' };
  const input = {filePath, format: 'txt' as const, encoding: 'utf8', txtOptions};
  const first = ['🚢甲', ' 乙 ', '\\N'].join(''), second = ['🚢丙', ' 丙 ', '  '].join('');
  await writeFile(filePath, first + '\r\n' + second + '\r\n');
  expect(await previewFile(input)).toEqual({columns: ['第1列', '第2列', '第3列'], rows: [
    {'第1列': '🚢甲', '第2列': '乙', '第3列': null}, {'第1列': '🚢丙', '第2列': '丙', '第3列': ''},
  ]});
  await writeFile(filePath, (first + '\n').repeat(21) + '短行');
  await expect(previewFile(input)).rejects.toThrow('固定列宽');
});

it('TXT 按 GB18030 无引号读取，拒绝截断的四字节字符', async () => {
  const txtOptions: TxtImportOptions = { mode: 'delimited', delimiter: '|', quote: 'none', recordDelimiter: 'lf', hasHeader: false };
  const input = {filePath, format: 'txt' as const, encoding: 'gb18030', txtOptions};
  const bytes = iconv.encode('🚢|"甲"\n', 'gb18030');
  await writeFile(filePath, bytes);
  expect(await previewFile(input)).toEqual({columns: ['第1列', '第2列'], rows: [{'第1列': '🚢', '第2列': '"甲"'}]});
  await writeFile(filePath, Buffer.concat([bytes, bytes.subarray(0, 3)]));
  await expect(previewFile(input)).rejects.toThrow();
});

it('TXT 解释在预览、预检、提交、预设和 SQLite 来源指纹中保持独立', () => {
  const request = { fileToken: 'file', format: 'txt', encoding: 'utf8', txtOptions: txtImportDefaults };
  const target = { connectionId: 'connection', database: 'db', table: 'table', taskId: 'task', mapping: {id: 'id'} };
  expect(validateCommand('files.preview', request)).toMatchObject({txtOptions: txtImportDefaults});
  expect(validateCommand('files.preflight', {...target, ...request})).toMatchObject({txtOptions: txtImportDefaults});
  expect(validateCommand('files.import', {...target, ...request, transactionMode: 'atomic'})).toMatchObject({txtOptions: txtImportDefaults});
  expect(() => validateCommand('files.preview', {...request, format: 'csv'})).toThrow();
  expect(() => validateCommand('files.preview', {...request, txtOptions: {...txtImportDefaults, delimiter: '"'}})).toThrow();
  expect(importPresetConfigurationSchema.parse({ format: 'txt', encoding: 'utf8', txtOptions: txtImportDefaults, columns: ['id'], mapping: {id: 'id'} })).toMatchObject({txtOptions: txtImportDefaults});
  expect(sqliteImportSourceOptionsKey({...request, format: 'txt', encoding: 'utf8'})).not.toBe(
    sqliteImportSourceOptionsKey({...request, format: 'txt', encoding: 'utf8', txtOptions: {...txtImportDefaults, hasHeader: true}}));
});
