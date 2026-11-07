import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { inspectImportFile, readVerifiedImportRecords } from '../../src/engine/importNewTableSource';
import { listExcelSheets } from '../../src/engine/excelFiles';
import { validateCommand } from '../../src/shared/validation';
import { sqliteImportSourceOptionsKey } from '../../src/shared/sqliteImportSource';
import { fileImportTransactionMode } from '../../src/shared/fileImportTransaction';

let folder: string, filePath: string;
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'tabrelio-xlsx-source-')); filePath = join(folder, 'source.xlsx'); });
afterEach(async () => { await rm(folder, {recursive: true, force: true}); });

const options = {format: 'xlsx', encoding: 'utf8', fileToken: 'file', taskId: 'task',
  excelOptions: {sheetId: '2', headerRow: 2, protocol: 'dbark-v1'}} as const;

async function workbook(tail: ExcelJS.CellValue, formulaTail = false) {
  const book = new ExcelJS.Workbook();
  book.addWorksheet('首张').addRows([['id'], ['不读']]);
  const sheet = book.addWorksheet('所选🚢');
  sheet.addRows([['说明'], ['id', 'note', 'bytes', 'empty'], ['9223372036854775807', null, '\\B:AP8=', ''], ['2', tail, '\\B:', '\\N']]);
  if (formulaTail) {
    for (let i = 0; i < 21; i++) sheet.addRow([String(i + 3)]);
    sheet.addRow(['26', {formula: '1+1', result: 2}]);
  }
  await book.xlsx.writeFile(filePath);
}

it('指定第二张工作表和第 2 行标题，保留精确值与工作簿字节指纹', async () => {
  await workbook('中文🚢');
  expect((await listExcelSheets({filePath})).map(sheet => [sheet.id, sheet.name])).toEqual([['1', '首张'], ['2', '所选🚢']]);
  const bytes = await readFile(filePath);
  const inspected = await inspectImportFile({...options, filePath, strictEncoding: true}, () => {});
  expect(inspected).toMatchObject({columns: ['id', 'note', 'bytes', 'empty'], records: 2, source: {
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }});
  expect(inspected.rows).toEqual([
    {id: '9223372036854775807', note: null, bytes: {type: 'binary', base64: 'AP8='}, empty: ''},
    {id: '2', note: '中文🚢', bytes: {type: 'binary', base64: ''}, empty: null},
  ]);
  await workbook('变化🚢');
  const changed = readVerifiedImportRecords({...options, filePath, expectedSource: inspected.source}, () => {});
  await expect(changed.next()).rejects.toThrow('变化');
});

it('样本之外的公式仍阻止整张工作表通过检查', async () => {
  await workbook('中文', true);
  await expect(inspectImportFile({...options, filePath}, () => {})).rejects.toThrow('公式');
});

it('XLSX 与文本配置隔离，SQLite 新表阶段绑定工作表、标题行和协议', () => {
  const target = {connectionId: 'connection', database: 'main', table: 'table'};
  expect(validateCommand('files.inspectImport', options)).toMatchObject(options);
  expect(validateCommand('files.preflight', {...options, ...target, mapping: {id: 'id'}})).toMatchObject(options);
  expect(() => validateCommand('files.import', {...options, ...target, transactionMode: 'batch', mapping: {id: 'id'}})).toThrow('原子导入');
  expect(validateCommand('sqlite.tableImport.inspect', {...options, ...target})).toMatchObject(options);
  expect(() => validateCommand('files.preview', {fileToken: 'file', format: 'xlsx', encoding: 'gb18030', excelOptions: options.excelOptions})).toThrow();
  expect(() => validateCommand('files.inspectImport', {...options, format: 'txt'})).toThrow();
  expect(sqliteImportSourceOptionsKey(options)).not.toBe(sqliteImportSourceOptionsKey({...options, excelOptions: {...options.excelOptions, sheetId: '1'}}));
  expect(sqliteImportSourceOptionsKey(options)).not.toBe(sqliteImportSourceOptionsKey({...options, excelOptions: {...options.excelOptions, headerRow: 1}}));
  expect(fileImportTransactionMode('xlsx', options)).toBe('atomic');
  expect(fileImportTransactionMode('xlsx', {})).toBe('batch');
});
