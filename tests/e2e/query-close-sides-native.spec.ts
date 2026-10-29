import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { stat } from 'node:fs/promises';
import type { AppSettings } from '../../src/shared/contracts';
import { queryBindingZh as binding } from '../../src/renderer/locales/queryBinding.zh-CN';
import { queryCloseZh as close } from '../../src/renderer/locales/queryClose.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_QUERY_CLOSE_SIDES_NATIVE_TEST === '1';
/** 默认关闭及列表不加载桌面夹具；实际窗口只使用临时离线配置，不读取任何认证资源。 */
function assertOffline(): void {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || Object.hasOwn(process.env, 'DBARK_DEV_URL')) throw Error('左右关闭原生专项要求integration=0且不得覆盖renderer地址');
  for (const key of Object.keys(process.env)) {
    const executableAlias = key === 'DBARK_C02_EXECUTABLE_PATH' && process.env[key] === process.env.DBARK_EXECUTABLE_PATH;
    if (/^DBARK_(?:TEST_|C02_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|CERT|CA_PATH|PRIVATE_KEY)/.test(key) && !executableAlias) throw Error('左右关闭原生专项拒绝实库和认证环境');
  }
  if (process.argv.some((value, index, args) => value === '--trace' && args[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off')) throw Error('左右关闭原生专项禁止trace');
}
if (enabled) assertOffline();
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = enabled ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!enabled, '默认关闭：须显式开启DBARK_QUERY_CLOSE_SIDES_NATIVE_TEST=1并使用integration=0');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });

type Tab = AppSettings['tabs'][number];
const ids = ['close-side-a', 'close-side-b', 'close-side-c'] as const;
const sql = ["SELECT '原左侧A', '900719925474099312345';", "SELECT '待保存B', '0.12345678901234567890';", "SELECT '原活动C', '🚢';"];
const completed: { directory: string; identity: string }[] = [];
/** 每次跨await之后仍核同一TestInfo的owner，失败不借全局句柄继续操作下一实例。 */
function owner(info: TestInfo) {
  assertOffline(); const runtime = require('./desktop-fixture') as Desktop, current = runtime.ownedDesktopResources(info);
  if (current.closed || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('左右关闭原生专项所属窗口或单次执行条件变化');
  return { runtime, ...current };
}
/** 只读正式持久化设置，不访问renderer store、业务handler或Monaco内部模型。 */
async function settings(info: TestInfo) { const value = await owner(info).page.evaluate(() => window.dbark.invoke('settings.get', {})); owner(info); return value; }
/** 原生标签点击后，核Main持久活动ID，不按相同标题猜测当前文档。 */
async function select(info: TestInfo, id: string) {
  await owner(info).page.locator(`.tab-strip [data-workspace-tab-id="${id}"] .tab-select`).click(); owner(info);
  await expect.poll(() => settings(info).then(value => value.activeTabId)).toBe(id);
}
/** 准备配置走正式Main；三份非空草稿都由真实Monaco键盘输入产生，不以配置写入冒充编辑流程。 */
async function prepare(info: TestInfo): Promise<Tab[]> {
  const { page } = owner(info); expect((await settings(info)).tabs).toEqual([]);
  expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]); owner(info);
  await page.evaluate(async names => {
    const profile = await window.dbark.invoke('connections.save', { id: 'close-sides-offline', name: '标签关闭离线配置', dialect: 'mysql', host: 'offline-close-sides.example.invalid', port: 1, user: 'offline-only', group: '', color: '#567890', rememberPassword: false });
    const current = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', { ...current, activeTabId: names[2], tabs: names.map<Tab>((id, index) => ({ id, kind: 'query', title: `左右关闭查询${index + 1}`, connectionId: profile.id, databaseContext: { state: 'known', database: null }, sql: '' })) });
  }, ids); owner(info);
  await page.reload(); owner(info); await expect(page.locator('.query-tab')).toHaveCount(3);
  for (const [index, id] of ids.entries()) {
    await select(info, id);
    const pane = page.locator('.tab-content > .tab-pane').nth(index), input = pane.locator('.sql-editor-wrap .monaco-editor').getByRole('textbox');
    await expect(pane).toBeVisible(); await expect(pane.locator('.sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false');
    await expect(input).toBeEditable(); await input.focus(); owner(info); await expect(input).toBeFocused();
    await page.keyboard.insertText(sql[index]); owner(info);
    await expect.poll(() => settings(info).then(value => value.tabs.find(tab => tab.id === id)?.sql?.replaceAll('\r\n', '\n'))).toBe(sql[index]);
  }
  const current = await settings(info); expect(current.activeTabId).toBe(ids[2]); expect(current.tabs.map(tab => tab.id)).toEqual([...ids]);
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]); owner(info); return current.tabs;
}
/** 通过原生按钮或右键打开准确锚点菜单；菜单动作本身不应切换活动查询。 */
async function openMenu(info: TestInfo, tab: Tab, rightClick = false) {
  const { page } = owner(info), active = (await settings(info)).activeTabId;
  const wrapper = page.locator(`.tab-strip [data-workspace-tab-id="${tab.id}"]`);
  if (rightClick) await wrapper.locator('.tab-select').click({ button: 'right' });
  else await (await navigationMenuItem(wrapper, { name: close.menuButton(tab.title), exact: true }, () => { owner(info); })).click();
  owner(info); const menu = page.getByRole('menu', { name: close.menu(tab.title), exact: true }); await expect(menu).toBeVisible();
  expect((await settings(info)).activeTabId).toBe(active); return menu;
}
/** 等真实React提交对应的关闭弹窗，不自行清理DOM或调用队列推进。 */
async function dialog(info: TestInfo, tab: Tab) {
  const value = owner(info).page.getByRole('dialog', { name: close.title, exact: true }); await expect(value).toBeVisible();
  await expect(value.locator('strong')).toHaveText(tab.title); owner(info); return value;
}
/** 每例只确认正常退出；原夹具严格核所属PID后清理，未确认的现场保持原样。 */
async function finish(info: TestInfo, identity: string) {
  const { runtime, page } = owner(info), directory = runtime.dataDir;
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); owner(info);
  expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]); owner(info);
  expect(runtime.pageErrors).toEqual([]); await runtime.confirmOwnedDesktopExit(info);
  expect(runtime.ownedDesktopResources(info).closed).toBe(true); completed.push({ directory, identity });
}
/** 首次失败保留原owner，不重试退出、重启或删除临时profile。 */
async function retain(info: TestInfo) {
  const runtime = require('./desktop-fixture') as Desktop; runtime.retainOwnedDesktopResources(info);
  await info.attach('左右关闭原生失败现场', { body: Buffer.from(JSON.stringify({ directory: runtime.dataDir, automaticRetry: false, automaticRestart: false, automaticForceStop: false })), contentType: 'application/json' });
}

test('非活动B的左侧关闭：取消保留三份全文，再明确放弃仅移除A且不切换C', async ({ trace, screenshot, video }, info) => {
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const [a, b, c] = await prepare(info), { page } = owner(info);
    let menu = await openMenu(info, b); await menu.getByRole('menuitem', { name: close.left, exact: true }).click(); owner(info);
    await (await navigationMenuItem((await dialog(info, a)), { name: close.cancel, exact: true }, () => { owner(info); })).click(); owner(info);
    await expect(page.getByRole('dialog')).toHaveCount(0); expect((await settings(info)).tabs).toEqual([a, b, c]);
    menu = await openMenu(info, b); await menu.getByRole('menuitem', { name: close.left, exact: true }).click(); owner(info);
    await (await navigationMenuItem((await dialog(info, a)), { name: close.discard, exact: true }, () => { owner(info); })).click(); owner(info);
    await expect.poll(() => settings(info).then(value => value.tabs.map(tab => tab.id))).toEqual([b.id, c.id]);
    expect((await settings(info)).tabs).toEqual([b, c]); expect((await settings(info)).activeTabId).toBe(c.id); await expect(page.getByRole('dialog')).toHaveCount(0);
    menu = await openMenu(info, b); await expect(menu.getByRole('menuitem', { name: close.left, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); owner(info); await expect(menu).toBeHidden();
    await expect(page.locator(`.tab-strip [data-workspace-tab-id="${b.id}"] .tab-query-menu`)).toBeFocused();
    expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual([]); owner(info);
    await finish(info, '非活动锚点左侧取消及放弃');
  } catch (error) { await retain(info); throw error; }
});

test('非活动A的右键右侧关闭：保存B后真实推进C，取消C保留全文，再明确关闭C', async ({ trace, screenshot, video }, info) => {
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const [a, b, c] = await prepare(info), { page } = owner(info);
    let menu = await openMenu(info, a, true); await menu.getByRole('menuitem', { name: close.right, exact: true }).click(); owner(info);
    await (await navigationMenuItem((await dialog(info, b)), { name: close.save, exact: true }, () => { owner(info); })).click(); owner(info);
    const save = page.getByRole('dialog', { name: binding.title, exact: true }); await expect(save).toBeVisible();
    await save.getByLabel(binding.name, { exact: true }).fill('由右侧关闭明确保存B');
    await (await navigationMenuItem(save, { name: binding.create, exact: true }, () => { owner(info); })).click(); owner(info);
    await (await navigationMenuItem((await dialog(info, c)), { name: close.cancel, exact: true }, () => { owner(info); })).click(); owner(info);
    await expect(page.getByRole('dialog')).toHaveCount(0); expect((await settings(info)).tabs).toEqual([a, c]); expect((await settings(info)).activeTabId).toBe(c.id);
    const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {})); owner(info); expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: '由右侧关闭明确保存B', sql: b.sql, connectionId: b.connectionId });
    menu = await openMenu(info, a, true); await menu.getByRole('menuitem', { name: close.right, exact: true }).click(); owner(info);
    await (await navigationMenuItem((await dialog(info, c)), { name: close.discard, exact: true }, () => { owner(info); })).click(); owner(info);
    await expect.poll(() => settings(info).then(value => value.tabs.map(tab => tab.id))).toEqual([a.id]);
    expect((await settings(info)).tabs).toEqual([a]); expect((await settings(info)).activeTabId).toBe(a.id); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual(saved); owner(info);
    await finish(info, '右键非活动锚点保存及提交后推进');
  } catch (error) { await retain(info); throw error; }
});

/** 每例正常退出后才检查目录消失；此证据只覆盖离线查询，不扩展为表、活动会话或实库事务验收。 */
test.afterAll(async ({}, info) => {
  for (const result of completed) {
    let missing = false;
    try { await stat(result.directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw error; }
    expect(missing, '左右关闭原生所属profile应在正常退出后清理').toBe(true);
    await info.attach('左右关闭原生终态', { body: Buffer.from(JSON.stringify({ ...result, normalExitConfirmed: true, directoryRemoved: true, launches: 1, explicitSqlExecution: 0, systemClipboard: 0, realDatabaseProven: false, mixedTableTabsProven: false })), contentType: 'application/json' });
  }
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
