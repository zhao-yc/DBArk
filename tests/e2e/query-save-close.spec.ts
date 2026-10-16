import { test, expect, page, pageErrors } from './desktop-fixture';
test.skip(process.env.DBARK_E2E !== '1' || process.env.DBARK_Q03_SAVE_CLOSE_UI !== '1', '默认关闭：须Root明确授权Q03保存后关闭正式UI');
const closeDialog = () => page.getByRole('dialog', { name: '关闭查询', exact: true });
const saveDialog = () => page.getByRole('dialog', { name: '保存查询', exact: true });
/** 仅建离线本地来源；打开、键入、三选、保存和关闭全部走真实UI。 */
async function seedAndOpen() {
  const source = await page.evaluate(async () => {
    const connection = await window.dbark.invoke('connections.save', { id: '', name: '关闭流程离线连接', group: '', color: '#51bda5', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' });
    return window.dbark.invoke('queries.create', { name: '关闭流程来源', connectionId: connection.id, context: { state: 'known', database: null }, sql: 'SELECT 900719925474099312345; -- 不得自动执行' });
  });
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
  await page.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true }); await dialog.getByRole('button', { name: '保存的查询', exact: true }).click();
  await dialog.locator('.history-card').filter({ has: page.getByText('关闭流程来源', { exact: true }) }).getByRole('button', { name: '在新标签打开', exact: true }).click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible(); return source;
}
async function write(sql: string) { const box = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await box.focus(); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`); await page.keyboard.insertText(sql); await expect.poll(() => page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql; })).toBe(sql); }
async function requestClose() { await page.locator('.tab-close').click(); await expect(closeDialog()).toBeVisible(); }

test('关闭三选取消保留完整草稿，直接关闭零查询写入', async () => {
  const source = await seedAndOpen(), sql = 'SELECT 未保存草稿;'; await write(sql); await requestClose(); await closeDialog().getByRole('button', { name: '取消', exact: true }).click();
  expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs[0].sql).toBe(sql);
  await requestClose(); await closeDialog().getByRole('button', { name: '直接关闭', exact: true }).click(); await expect(page.locator('.tab-close')).toHaveCount(0);
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(1); expect(records[0].id).toBe(source.source.id); expect(records[0].sql).not.toBe(sql); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
});
test('绑定来源保存后关闭保持ID，完整精度正文落库', async () => {
  const source = await seedAndOpen(), sql = "SELECT '900719925474099312345', '0.12345678901234567890', '🚢';"; await write(sql); await requestClose(); await closeDialog().getByRole('button', { name: '保存后关闭', exact: true }).click(); await saveDialog().getByRole('button', { name: '保存到原查询', exact: true }).click(); await expect(page.locator('.tab-close')).toHaveCount(0);
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(1); expect(records[0].id).toBe(source.source.id); expect(records[0].sql).toBe(sql); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); expect(pageErrors).toEqual([]);
});
test('关闭保存遇到旧摘要保留草稿，明确另存后才关闭且不覆盖来源', async () => {
  const source = await seedAndOpen(), sql = 'SELECT 我的独立草稿;'; await write(sql);
  await page.evaluate(async initial => { await window.dbark.invoke('queries.updateSource', { source: initial.source, content: { name: '关闭流程来源', connectionId: initial.source.connectionId, context: initial.source.context, sql: 'SELECT 另一编辑者;' } }); }, source);
  await requestClose(); await closeDialog().getByRole('button', { name: '保存后关闭', exact: true }).click(); await saveDialog().getByRole('button', { name: '保存到原查询', exact: true }).click(); await expect(saveDialog().locator('.error-box')).toContainText('已修改'); expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs[0].sql).toBe(sql);
  await saveDialog().getByRole('button', { name: '另存为新查询', exact: true }).click(); await expect(page.locator('.tab-close')).toHaveCount(0);
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(2); expect(records.find(item => item.id === source.source.id)?.sql).toBe('SELECT 另一编辑者;'); expect(records.some(item => item.id !== source.source.id && item.sql === sql)).toBe(true); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
});

test('未绑定草稿从新建查询进入，另存后仅关闭该标签', async () => {
  const source = await seedAndOpen();
  await page.getByRole('button', { name: '新建查询标签', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建查询', exact: true }); await dialog.getByRole('button', { name: '打开查询', exact: true }).click();
  await expect(page.locator('.tab-close')).toHaveCount(2); const sql = 'SELECT 未绑定独立草稿;'; await write(sql);
  await page.locator('.tab-close').last().click(); await expect(closeDialog()).toBeVisible(); await closeDialog().getByRole('button', { name: '保存后关闭', exact: true }).click();
  await expect(saveDialog().getByRole('button', { name: '保存到原查询', exact: true })).toHaveCount(0); await saveDialog().getByLabel('查询名称', { exact: true }).fill('未绑定关闭草稿'); await saveDialog().getByRole('button', { name: '另存为新查询', exact: true }).click();
  await expect(page.locator('.tab-close')).toHaveCount(1); const records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(2); expect(records.find(item => item.id === source.source.id)?.sql).toContain('900719925474099312345'); expect(records.some(item => item.id !== source.source.id && item.name === '未绑定关闭草稿' && item.sql === sql)).toBe(true); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
});
