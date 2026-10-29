import { clickSidebarAction } from './sidebar-menu';
import { test, expect, page, desktop, quitDesktop, launchDesktop, pageErrors } from './desktop-fixture';
import { dataTypeColorsZh as text } from '../../src/renderer/locales/dataTypeColors.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认关闭。本轮只采集定义；实际Electron和实库均由ROOT另行明确启用。
test.skip(process.env.DBARK_E2E !== '1' || process.env.DBARK_D08_TYPE_COLORS_UI !== '1', 'D08类型颜色正式UI默认关闭，须独立授权');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(150000);

/** 只操作真实设置入口；保存沿原本地偏好IPC，绝不向网格注入数据或伪造元数据。 */
async function preferences() {
  await page.getByRole('button', { name: zh.app.text009, exact: true }).click();
  return page.getByRole('dialog', { name: zh.app.text009, exact: true });
}
async function setColors(enabled: boolean) {
  const modal = await preferences(); const checkbox = modal.getByRole('checkbox', { name: text.title, exact: true });
  if (enabled) await checkbox.check(); else await checkbox.uncheck();
  await expect.poll(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))).toMatchObject({ dataTypeColors: enabled });
  await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
}

test('D08默认关闭、六类图例、暗亮切换和重启恢复及单项重置', async () => {
  await expect(page.locator('.app-statusbar')).toBeVisible(); expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).dataTypeColors).toBe(false);
  const modal = await preferences(); await expect(modal.getByRole('checkbox', { name: text.title, exact: true })).not.toBeChecked(); await expect(modal.getByRole('list', { name: text.legend, exact: true }).locator('li')).toHaveCount(6);
  await modal.getByRole('checkbox', { name: text.title, exact: true }).check(); await modal.getByRole('combobox', { name: zh.app.text019, exact: true }).selectOption('light');
  await expect.poll(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))).toMatchObject({ dataTypeColors: true, theme: 'light' }); await modal.getByRole('button', { name: zh.common.done, exact: true }).click();
  await quitDesktop(); await launchDesktop(); await expect(page.locator('.app-statusbar')).toBeVisible(); const restored = await preferences();
  await expect(restored.getByRole('checkbox', { name: text.title, exact: true })).toBeChecked(); await expect(restored.getByRole('combobox', { name: zh.app.text019, exact: true })).toHaveValue('light');
  await restored.getByRole('button', { name: text.reset, exact: true }).click(); await expect(restored.getByRole('checkbox', { name: text.title, exact: true })).not.toBeChecked();
  await expect.poll(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))).toMatchObject({ dataTypeColors: false, theme: 'light' }); expect(pageErrors).toEqual([]);
});

test('D08真实表格与只读SQL的可靠类别一致，文本不猜类型，选择和原值保持', async ({}, testInfo) => {
  // 第三道实库门在动态导入前检查；列表不会读取live环境或连接目标。
  test.skip(process.env.DBARK_INTEGRATION_ENABLED !== '1', '真实元数据另需实库授权');
  const { isolatedDatabase, openDatabaseQuery, executeSql } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    const qualified = `\`${context.database}\`.\`d08_values\``;
    await context.observer.query(`CREATE TABLE ${qualified}(id INT PRIMARY KEY, big_value BIGINT, amount DECIMAL(25,12), at_time DATETIME(6), bytes_value VARBINARY(8), text_value VARCHAR(40), null_value VARCHAR(40), ambiguous_text LONGTEXT)`);
    await context.observer.query(`INSERT INTO ${qualified} VALUES(1,9007199254740993,0.100000000001,'2026-10-16 12:34:56.123456',X'00FF','123',NULL,'2026-10-16')`);
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
    await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
    await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click(); await connection.locator('.object-row').getByText('d08_values', { exact: true }).click();
    const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); await expect(table.locator('[data-value-type]')).toHaveCount(0);
    await setColors(true); for (const kind of ['number', 'temporal', 'binary', 'text', 'null']) await expect(table.locator(`[data-value-type="${kind}"]`).first()).toBeVisible();
    const header = table.getByRole('columnheader', { name: /^big_value/ }); const index = await header.getAttribute('aria-colindex'); if (!index) throw Error('真实列缺少aria坐标');
    const bigCell = table.locator(`[aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`); await expect(bigCell).toHaveText('9007199254740993'); await bigCell.click();
    await expect(bigCell).toHaveAttribute('aria-selected', 'true'); await expect(bigCell.locator('[data-value-type]')).toHaveCount(0); await expect(bigCell).toHaveText('9007199254740993');
    await openDatabaseQuery(context.database); await executeSql(`SELECT big_value,amount,at_time,bytes_value,text_value,null_value,ambiguous_text FROM ${qualified}`);
    const result = page.locator('.query-tab:visible .results-grid'); for (const kind of ['number', 'temporal', 'binary', 'text', 'null']) await expect(result.locator(`[data-value-type="${kind}"]`).first()).toBeVisible();
    // 协议BLOB的LONGTEXT不能谎报二进制/时间，即使内容长得像日期。
    const ambiguousHeader = result.getByRole('columnheader', { name: /^ambiguous_text/ }); const ambiguousIndex = await ambiguousHeader.getAttribute('aria-colindex'); if (!ambiguousIndex) throw Error('结果列缺少真实坐标');
    const ambiguous = result.locator(`[aria-rowindex="2"] [role="gridcell"][aria-colindex="${ambiguousIndex}"]`); await expect(ambiguous).toHaveText('2026-10-16'); await expect(ambiguous.locator('[data-value-type]')).toHaveCount(0);
    const before = await context.observer.query(`SELECT CAST(big_value AS CHAR) AS big_value,HEX(bytes_value) AS bytes_value,text_value FROM ${qualified}`); expect((before[0] as { big_value: string; bytes_value: string; text_value: string }[])[0]).toEqual({ big_value: '9007199254740993', bytes_value: '00FF', text_value: '123' });
    expect(pageErrors).toEqual([]);
  }, testInfo);
});
