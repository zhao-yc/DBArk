import { clickSidebarAction } from './sidebar-menu';
import ExcelJS from 'exceljs';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page, dataDir } from './desktop-fixture';
import { enabled, isolatedDatabase, type LiveContext } from './live-helpers';
import { excelImportZh } from '../../src/shared/excelTransfer';

test.use({ trace: 'off' });

/** 主对话只在已核对的 200 隔离实例显式启用；本任务默认不访问网络或业务库。 */
async function openTable(context: LiveContext, table: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  const row = connection.locator('.connection-row'); await row.getByRole('button', { name: context.connectionName, exact: true }).focus();
  await clickSidebarAction(row, { name: '刷新连接', exact: true });
  const database = connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }); await expect(database).toBeVisible();
  if (!(await connection.locator('.object-row').getByText(table, { exact: true }).isVisible())) await database.click();
  await connection.locator('.object-row').getByText(table, { exact: true }).click();
  await expect(page.locator('.table-tab:visible .loading-overlay')).toHaveCount(0);
}

/** 只选择原生文件位置；范围、协议、映射和提交全部通过实际界面操作。 */
async function excelDialog(mode: 'import' | 'export', path: string) {
  await desktop.evaluate(({ dialog }, input) => {
    if (input.mode === 'export') dialog.showSaveDialog = (async () => ({ canceled: false, filePath: input.path })) as typeof dialog.showSaveDialog;
    else dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [input.path] })) as typeof dialog.showOpenDialog;
  }, { mode, path });
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.table-tab:visible'), { name: mode === 'import' ? '导入' : '导出', exact: true })).click();
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('xlsx');
  const modal = page.getByRole('dialog'); await expect(modal).toContainText(mode === 'import' ? '导入 Excel' : '导出 Excel');
  await modal.locator('.file-picker').click(); return modal;
}

test('XLSX 无标题时按列位置映射，并仅提交首末行之间的数据', async ({}, info) => {
  test.skip(!enabled || process.env.DBARK_XLSX_ROW_RANGE_NATIVE !== '1', '需要本轮隔离实例');
  const port = Number(process.env.DBARK_TEST_PORT);
  if (process.env.DBARK_TEST_HOST !== '127.0.0.1' || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
    !/^tabrelio-search-[a-f0-9]{12}$/.test(process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '')) throw Error('需要本轮回环隔离库');
  test.setTimeout(90_000);
  await isolatedDatabase(async context => {
    await context.observer.query('USE ??', [context.database]);
    await context.observer.query('CREATE TABLE excel_range (id INT PRIMARY KEY, note TEXT) ENGINE=InnoDB');
    const path = join(dataDir, '无标题行范围.xlsx');
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('数据');
    sheet.addRows([['说明'], ['2', '首条'], ['3', '末条'], [{ formula: '1+1', result: 2 }]]);
    await book.xlsx.writeFile(path);
    await openTable(context, 'excel_range');
    const modal = await excelDialog('import', path);
    await modal.getByRole('spinbutton', { name: excelImportZh.lastDataRow, exact: true }).fill('3');
    await modal.getByRole('spinbutton', { name: '表头所在行', exact: true }).fill('0');
    await modal.getByRole('spinbutton', { name: excelImportZh.firstDataRow, exact: true }).fill('4');
    const apply = modal.getByRole('button', { name: '开始导入', exact: true });
    await expect(apply).toBeDisabled();
    await expect(modal.locator('.error-box')).toContainText('末行不能早于首行');
    await modal.getByRole('spinbutton', { name: excelImportZh.firstDataRow, exact: true }).fill('2');
    await modal.getByRole('combobox', { name: '字段“第1列”的目标列', exact: true }).fill('id');
    await modal.getByRole('combobox', { name: '字段“第2列”的目标列', exact: true }).fill('note');
    await expect(modal.locator('.excel-preview tbody tr')).toHaveCount(2);
    await expect(modal.locator('.excel-preview')).toContainText('首条');
    await expect(modal.locator('.excel-preview')).toContainText('末条');
    await modal.screenshot({ path: info.outputPath('无标题 XLSX 字段映射.png') });
    await apply.click();
    await expect(modal.locator('.success-box')).toContainText('2 行', { timeout: 30_000 });
    const [rows] = await context.observer.query<RowDataPacket[]>('SELECT id, note FROM excel_range ORDER BY id');
    expect(rows).toEqual([{ id: 2, note: '首条' }, { id: 3, note: '末条' }]);
  }, info);
});

test('200 隔离库 Excel 样本与完整流式导出、字段映射导入及精度往返', async ({}, testInfo) => {
  test.skip(!enabled, '仅由主对话核对 200 实例和隔离资源后显式启用'); test.setTimeout(120000);
  await isolatedDatabase(async context => {
    const q = (table: string) => `\`${context.database}\`.\`${table}\``;
    // 观察连接只负责建立隔离夹具与断言，不替代应用的导入、导出和任务实现。
    const definition = '(id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,12), happened DATETIME(6), payload TEXT NULL, bytes VARBINARY(8), flags BIT(64)) ENGINE=InnoDB';
    await context.observer.query(`CREATE TABLE ${q('excel_source')} ${definition}`);
    await context.observer.query(`CREATE TABLE ${q('excel_target')} ${definition}`);
    const parameters = Array.from({ length: 1201 }, (_, index) => [(18446744073709550000n + BigInt(index)).toString(), '123456789012345678.123456789012', '2026-10-15 10:20:30.123456', index === 0 ? null : index === 1 ? '' : index === 2 ? '\\N' : '=SUM(A1)', Buffer.from([0, 1, 255]), '18446744073709551615']).flat();
    // 夹具也显式按精确 DECIMAL 定型，不能在应用运行之前把 BIT64 最大值钳到有符号上限。
    await context.observer.execute(`INSERT INTO ${q('excel_source')} VALUES ${Array.from({ length: 1201 }, () => '(?,?,?,?,?,CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED))').join(',')}`, parameters);
    await openTable(context, 'excel_source');
    const samplePath = join(dataDir, '样本.xlsx'), sample = await excelDialog('export', samplePath);
    await expect(sample.getByRole('combobox', { name: '导出范围', exact: true })).toHaveValue('sample');
    await (await (await import('./navigation-menu')).navigationMenuItem(sample, { name: '开始导出', exact: true })).click(); await expect(sample.locator('.success-box')).toContainText('1000 行', { timeout: 30000 }); await (await (await import('./navigation-menu')).navigationMenuItem(sample, { name: '完成', exact: true })).click();
    const sampleBook = new ExcelJS.Workbook(); await sampleBook.xlsx.readFile(samplePath); expect(sampleBook.worksheets[0].rowCount).toBe(1001);
    const fullPath = join(dataDir, '完整.xlsx'), full = await excelDialog('export', fullPath);
    await full.getByRole('combobox', { name: '导出范围', exact: true }).selectOption('all'); await (await (await import('./navigation-menu')).navigationMenuItem(full, { name: '开始导出', exact: true })).click();
    await expect(full.locator('.success-box')).toContainText('1201 行', { timeout: 30000 }); await (await (await import('./navigation-menu')).navigationMenuItem(full, { name: '完成', exact: true })).click();
    const fullBook = new ExcelJS.Workbook(); await fullBook.xlsx.readFile(fullPath); expect(fullBook.worksheets[0].rowCount).toBe(1202);
    expect(fullBook.worksheets[0].getCell('A2').text).toBe('18446744073709550000'); expect(fullBook.worksheets[0].getCell('B2').text).toBe('123456789012345678.123456789012');
    expect(fullBook.worksheets[0].getCell('D5').type).not.toBe(ExcelJS.ValueType.Formula);
    await openTable(context, 'excel_target'); const input = await excelDialog('import', fullPath);
    await input.getByRole('combobox', { name: '文本解释方式', exact: true }).selectOption('dbark-v1');
    // 带 datalist 的目标字段输入在可访问树中是 combobox，保留实际字段映射值断言。
    await expect(input.getByRole('combobox', { name: '字段“id”的目标列', exact: true })).toHaveValue('id');
    await expect(input.getByRole('button', { name: '开始导入', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('excel-live-mapping.png') });
    await (await (await import('./navigation-menu')).navigationMenuItem(input, { name: '开始导入', exact: true })).click(); await expect(input.locator('.success-box')).toContainText('1201 行', { timeout: 45000 });
    await expect(input.locator('.error-box')).toHaveCount(0); await (await (await import('./navigation-menu')).navigationMenuItem(input, { name: '完成', exact: true })).click();
    const comparison = `SELECT CAST(id AS CHAR) AS id, CAST(amount AS CHAR) AS amount, DATE_FORMAT(happened, '%Y-%m-%d %H:%i:%s.%f') AS happened, payload, HEX(bytes) AS bytes, CAST(flags AS UNSIGNED) AS flags`;
    const [actual] = await context.observer.query<RowDataPacket[]>(`${comparison} FROM ${q('excel_target')} ORDER BY id`);
    const [expected] = await context.observer.query<RowDataPacket[]>(`${comparison} FROM ${q('excel_source')} ORDER BY id`);
    expect(actual).toEqual(expected); expect(actual).toHaveLength(1201);
  }, testInfo);
});
