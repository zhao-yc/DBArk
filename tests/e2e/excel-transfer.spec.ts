import ExcelJS from 'exceljs';
import { join } from 'node:path';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';

test.use({ trace: 'off' });

/** 离线窗口用例仅替换系统文件对话框回答；预加载、IPC、文件令牌、工作簿解析与任务均走正式实现。 */
test('Excel 正式文件授权、工作表和预览 IPC，以及表格实际入口', async ({}, testInfo) => {
  const filePath = join(dataDir, '离线工作簿.xlsx'), book = new ExcelJS.Workbook();
  book.addWorksheet('说明').addRow(['使用第二张表']); const sheet = book.addWorksheet('实际数据');
  sheet.addRow(['导入说明']); sheet.addRow(['编号', '文本']); sheet.addRow(['18446744073709551615', '=SUM(A1)']); await book.xlsx.writeFile(filePath);
  await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog; }, filePath);
  const result = await page.evaluate(async () => {
    const file = await window.dbark.invoke('files.choose', { purpose: 'import', format: 'xlsx' });
    if (!file) throw Error('文件未选择');
    const sheets = await window.dbark.invoke('excel.sheets', { fileToken: file.token, taskId: '离线工作表' });
    const sample = await window.dbark.invoke('excel.preview', { fileToken: file.token, sheetId: sheets[1].id, taskId: '离线预览', headerRow: 2, protocol: 'plain' });
    let denied = ''; try { await window.dbark.invoke('excel.export', { connectionId: '无连接', database: '无库', table: '无表', fileToken: file.token, taskId: '用途拒绝' }); } catch (reason) { denied = (reason as Error).message; }
    // 使用正常持久化契约恢复一个不可连接的表标签，只验入口和文件读取，绝不模拟数据库成功。
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...settings, tabs: [{ id: '离线表', kind: 'table', title: '离线表', connectionId: '无连接', database: '离线库', table: '离线表' }], activeTabId: '离线表' });
    return { sheets, sample, denied };
  });
  expect(result.sheets.map(sheet => sheet.name)).toEqual(['说明', '实际数据']);
  expect(result.sample.rows).toEqual([{ 编号: '18446744073709551615', 文本: '=SUM(A1)' }]); expect(result.denied).toContain('文件访问未授权');
  await page.reload(); await expect(page.locator('.table-tab:visible')).toBeVisible();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.table-tab:visible'), { name: '导入', exact: true })).click();
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('xlsx');
  const modal = page.getByRole('dialog', { name: '导入 Excel · 离线库.离线表', exact: true }); await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled();
  await modal.locator('.file-picker').click(); await expect(modal.getByRole('combobox', { name: '工作表', exact: true })).toBeVisible();
  await modal.getByRole('combobox', { name: '工作表', exact: true }).selectOption('2'); await modal.getByRole('spinbutton', { name: '表头所在行', exact: true }).fill('2');
  await modal.getByRole('combobox', { name: '文本解释方式', exact: true }).selectOption('dbark-v1');
  await expect(modal.locator('.error-box')).toContainText('连接');
  await expect(modal.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('excel-import-offline.png') });
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.table-tab:visible'), { name: '导出', exact: true })).click();
  await page.getByRole('dialog').getByRole('combobox').first().selectOption('xlsx');
  const output = page.getByRole('dialog', { name: '导出 Excel · 离线库.离线表', exact: true });
  await expect(output.getByRole('combobox', { name: '导出范围', exact: true })).toHaveValue('sample');
  await output.getByRole('combobox', { name: '导出范围', exact: true }).selectOption('all');
  await (await (await import('./navigation-menu')).navigationMenuItem(output, { name: '其他文件格式', exact: true })).click(); await expect(page.getByRole('dialog').getByRole('combobox').first()).toHaveValue('csv');
  const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  const metadata = tasks.filter(task => task.kind === 'metadata.table'), previews = tasks.filter(task => task.kind === 'excel.preview');
  expect(metadata.length).toBeGreaterThan(0); expect(previews.length).toBeGreaterThan(0);
  expect(metadata.every(task => !previews.some(preview => preview.id === task.id))).toBe(true);
  expect([...metadata, ...previews].some(task => task.status === 'running')).toBe(false);
  expect(pageErrors).toEqual([]);
});
