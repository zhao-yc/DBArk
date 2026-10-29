import { clickSidebarAction } from './sidebar-menu';
import ExcelJS from 'exceljs';
import { join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page, dataDir } from './desktop-fixture';
import { enabled, isolatedDatabase, type LiveContext } from './live-helpers';

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
  await page.locator('.table-tab:visible').getByRole('button', { name: mode === 'import' ? '导入' : '导出', exact: true }).click();
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('xlsx');
  const modal = page.getByRole('dialog'); await expect(modal).toContainText(mode === 'import' ? '导入 Excel' : '导出 Excel');
  await modal.locator('.file-picker').click(); return modal;
}

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
    await sample.getByRole('button', { name: '开始导出', exact: true }).click(); await expect(sample.locator('.success-box')).toContainText('1000 行', { timeout: 30000 }); await sample.getByRole('button', { name: '完成', exact: true }).click();
    const sampleBook = new ExcelJS.Workbook(); await sampleBook.xlsx.readFile(samplePath); expect(sampleBook.worksheets[0].rowCount).toBe(1001);
    const fullPath = join(dataDir, '完整.xlsx'), full = await excelDialog('export', fullPath);
    await full.getByRole('combobox', { name: '导出范围', exact: true }).selectOption('all'); await full.getByRole('button', { name: '开始导出', exact: true }).click();
    await expect(full.locator('.success-box')).toContainText('1201 行', { timeout: 30000 }); await full.getByRole('button', { name: '完成', exact: true }).click();
    const fullBook = new ExcelJS.Workbook(); await fullBook.xlsx.readFile(fullPath); expect(fullBook.worksheets[0].rowCount).toBe(1202);
    expect(fullBook.worksheets[0].getCell('A2').text).toBe('18446744073709550000'); expect(fullBook.worksheets[0].getCell('B2').text).toBe('123456789012345678.123456789012');
    expect(fullBook.worksheets[0].getCell('D5').type).not.toBe(ExcelJS.ValueType.Formula);
    await openTable(context, 'excel_target'); const input = await excelDialog('import', fullPath);
    await input.getByRole('combobox', { name: '文本解释方式', exact: true }).selectOption('dbark-v1');
    // 带 datalist 的目标字段输入在可访问树中是 combobox，保留实际字段映射值断言。
    await expect(input.getByRole('combobox', { name: '字段“id”的目标列', exact: true })).toHaveValue('id');
    await expect(input.getByRole('button', { name: '开始导入', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('excel-live-mapping.png') });
    await input.getByRole('button', { name: '开始导入', exact: true }).click(); await expect(input.locator('.success-box')).toContainText('1201 行', { timeout: 45000 });
    await expect(input.locator('.error-box')).toHaveCount(0); await input.getByRole('button', { name: '完成', exact: true }).click();
    const comparison = `SELECT CAST(id AS CHAR) AS id, CAST(amount AS CHAR) AS amount, DATE_FORMAT(happened, '%Y-%m-%d %H:%i:%s.%f') AS happened, payload, HEX(bytes) AS bytes, CAST(flags AS UNSIGNED) AS flags`;
    const [actual] = await context.observer.query<RowDataPacket[]>(`${comparison} FROM ${q('excel_target')} ORDER BY id`);
    const [expected] = await context.observer.query<RowDataPacket[]>(`${comparison} FROM ${q('excel_source')} ORDER BY id`);
    expect(actual).toEqual(expected); expect(actual).toHaveLength(1201);
  }, testInfo);
});
