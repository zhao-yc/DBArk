import { test, expect, desktop, page, pageErrors, quitDesktop, launchDesktop } from './desktop-fixture';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const query = () => page.locator('.query-tab:visible');
const saveDialog = () => page.getByRole('dialog', { name: '保存查询', exact: true });
const sourceSql = "UPDATE subject SET note='900719925474099312345 / 0.12345678901234567890 / 🚢'; -- 打开不得执行";

/** 仅创建离线本地连接与记录；窗口、Monaco、IPC、SQLite、保存和重启均使用真实实现。 */
async function seed() {
  const result = await page.evaluate(async sql => {
    const profile = await window.dbark.invoke('connections.save', { id: '', name: '来源绑定离线连接', group: '', color: '#123456', dialect: 'mysql', host: '127.0.0.1', port: 1, user: 'offline' });
    return window.dbark.invoke('queries.create', { name: '源查询', connectionId: profile.id, context: { state: 'known', database: null }, sql });
  }, sourceSql);
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible(); return result;
}
/** 按实际分页列表打开完整原文，必须新建查询标签而不执行。 */
async function openSource(name = '源查询') {
  await page.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true });
  await dialog.getByRole('button', { name: '保存的查询', exact: true }).click();
  const row = dialog.locator('.history-card').filter({ has: page.getByText(name, { exact: true }) });
  await row.getByRole('button', { name: '在新标签打开', exact: true }).click(); await expect(dialog).toBeHidden();
  await expect(query().locator('.monaco-editor')).toBeVisible();
}
/** 修改仅经过真实编辑器键盘输入，正文不通过保存 IPC 测试桩注入。 */
async function edit(sql: string) { await query().locator('.monaco-editor').getByRole('textbox').focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(sql); }
async function save(action: '保存到原查询' | '另存为新查询', name?: string) {
  await query().getByRole('button', { name: '保存查询', exact: true }).click();
  if (name) await saveDialog().getByLabel('查询名称', { exact: true }).fill(name);
  await saveDialog().getByRole('button', { name: action, exact: true }).click();
}

test('原查询更新、另存独立记录、绑定重启恢复与关闭清除，不执行保存正文', async ({}, info) => {
  const first = await seed(); await openSource();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs[0]?.sourceBinding).toEqual(first.source);
  const initial = await page.evaluate(() => window.dbark.invoke('settings.get', {})); const tabId = initial.activeTabId!;
  expect(initial.tabs.find(tab => tab.id === tabId)?.sourceBinding).toEqual(first.source);
  await edit(sourceSql + '\n-- 第一次更新'); await save('保存到原查询'); await expect(saveDialog()).toBeHidden();
  let records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(1); expect(records[0].id).toBe(first.source.id); expect(records[0].sql).toContain('第一次更新');
  const updatedSql = records[0].sql;
  await save('另存为新查询', '独立副本'); await expect(saveDialog()).toBeHidden();
  records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(2); expect(records.find(record => record.id === first.source.id)?.sql).toBe(updatedSql);
  const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})), copy = settings.tabs.find(tab => tab.id === tabId)!;
  expect(copy.id).toBe(tabId); expect(copy.sourceBinding?.id).not.toBe(first.source.id); expect(copy.sql).toContain('900719925474099312345');
  await quitDesktop(); await launchDesktop();
  expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.find(tab => tab.id === tabId)?.sourceBinding).toEqual(copy.sourceBinding);
  await edit(updatedSql + '\n-- 重启后只更新副本'); await save('保存到原查询'); await expect(saveDialog()).toBeHidden();
  records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records.find(record => record.id === first.source.id)?.sql).toBe(updatedSql); expect(records.find(record => record.id === copy.sourceBinding!.id)?.sql).toContain('重启后只更新副本');
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await page.screenshot({ path: info.outputPath('query-binding-restored.png') });
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync; });
  await page.locator('.tab-strip .tab-close').click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.some(tab => tab.id === tabId)).toBe(false);
  expect(pageErrors).toEqual([]);
});

test('同源标签陈旧 CAS 拒绝，保留草稿并可另存，不覆盖另一标签新正文', async () => {
  const first = await seed(); await openSource(); await openSource();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.length).toBe(2);
  const tabs = await page.evaluate(() => window.dbark.invoke('settings.get', {})); expect(tabs.tabs).toHaveLength(2);
  // 第二标签先保存；第一个标签持有原摘要，实际点击保存必须失败。
  await edit('SELECT 2; -- 另一标签已保存'); await save('保存到原查询'); await expect(saveDialog()).toBeHidden();
  await page.locator('.tab-strip .tab-select').first().click(); await edit('SELECT 3; -- 陈旧草稿不得覆盖'); await save('保存到原查询');
  await expect(saveDialog().getByRole('alert')).toContainText('原查询已修改');
  expect((await page.evaluate(() => window.dbark.invoke('queries.list', {})))[0].sql).toContain('另一标签已保存');
  await saveDialog().getByLabel('查询名称', { exact: true }).fill('冲突草稿副本'); await saveDialog().getByRole('button', { name: '另存为新查询', exact: true }).click(); await expect(saveDialog()).toBeHidden();
  const records = await page.evaluate(() => window.dbark.invoke('queries.list', {})); expect(records).toHaveLength(2); expect(records.find(record => record.id === first.source.id)?.sql).toContain('另一标签已保存'); expect(records.find(record => record.name === '冲突草稿副本')?.sql).toContain('陈旧草稿不得覆盖');
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); expect(pageErrors).toEqual([]);
});
