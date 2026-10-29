import { randomUUID } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { test, expect, desktop, page, pageErrors, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { sidebarMenuItem } from './sidebar-menu';

/**
 * ROOT独占窗口准备：先构建产品，再显式设置DBARK_SIDEBAR_ASYNC_UI=1运行本文件。
 * 默认关闭且拒绝实库环境。正式应用窗口、Sidebar和IPC/preload保持真实；
 * 本例只在主进程为虚构loopback:1连接控制回包，不证明驱动、服务器或真实取消已验收。
 * 本文件的收集不运行测试体；也不能代替源码/安装产物各自的GUI结果。
 */
type Call = { id: number; command: string; released: boolean };
type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input: Record<string, unknown> }) => Promise<unknown>;
interface Control { calls: (Call & { complete(response: unknown): void })[]; restore(): void }
type Main = typeof globalThis & { __sidebarAsyncUi?: Control };
let connectionId = '', name = '', halted = false;
test.use({ trace: 'off', preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: {
  /** 前例保留后在分配应用之前停链，不能把新窗口当作原Main继续操作。 */
  assertCurrent() { if (halted) throw Error('Sidebar异步前例已保留，不再启动新应用'); }
} });
const database = 'sidebar_fixture_db';
const status = { dialect: 'mysql', version: '8.4.11', connectionId: 101 };
const connection = () => page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByRole('button', { name, exact: true }) });
const label = () => connection().locator('.connection-row > .tree-label');
const databaseRow = () => connection().locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
const databaseLabel = () => databaseRow().locator('.tree-label');

/** 只读取有界调用摘要，不读取配置、凭据、完整对象数据或React状态。 */
async function calls(): Promise<Call[]> { return desktop.evaluate(() => (globalThis as Main).__sidebarAsyncUi!.calls.map(({ id, command, released }) => ({ id, command, released }))); }
/** 回包经实际Electron IPC和preload返回；仅控制本例输入端口，不替换节点实现。 */
async function release(id: number, result: unknown, error?: string) { await desktop.evaluate((_, value) => { const call = (globalThis as Main).__sidebarAsyncUi!.calls[value.id]; if (!call || call.released) throw Error('本例在途回包不存在'); call.released = true; call.complete(value.error ? { ok: false, error: value.error } : { ok: true, result: value.result }); }, { id, result, error }); }
async function waitCall(index: number, command: string) { await expect.poll(async () => (await calls())[index]?.command).toBe(command); }
/** 所有打开与折叠操作都走实际节点按钮；这里只控制异步响应次序。 */
async function openConnection() { const index = (await calls()).length; await label().click(); await waitCall(index, 'connections.open'); await release(index, status); await waitCall(index + 1, 'metadata.databases'); await release(index + 1, [database]); await expect(label()).toHaveAttribute('aria-expanded', 'true'); await expect(label()).toHaveAttribute('aria-busy', 'false'); await expect(databaseLabel()).toBeVisible(); }
async function openDatabase() { const index = (await calls()).length; await databaseLabel().click(); await waitCall(index, 'metadata.objects'); await release(index, [{ name: '原表', kind: 'table' }]); await expect(databaseLabel()).toHaveAttribute('aria-expanded', 'true'); await expect(connection().locator('.object-row')).toContainText('原表'); }
/** 从实际右键菜单读取动作，不改DOM/CSS，也不触发节点展开。 */
async function action(row: Locator, text: string) { return sidebarMenuItem(row, { name: text, exact: true }); }

test.describe('Sidebar异步节点受控回包产品UI补充', () => {
  // 失败时Playwright会重启worker；串行组跨worker跳过后例，不能绕过halted再启动。
  test.describe.configure({ mode: 'serial', retries: 0 });
  // 默认在自动桌面夹具之前跳过；本用例不接入实库，严禁沿用200/集成环境执行。
  test.skip(process.env.DBARK_SIDEBAR_ASYNC_UI !== '1', '仅由ROOT单独安排Sidebar受控回包窗口，默认不启动应用');
  test.beforeAll(() => { if (process.env.DBARK_INTEGRATION_ENABLED === '1' || process.env.DBARK_TEST_HOST || process.env.DBARK_TEST_PORT) throw Error('Sidebar受控回包UI必须与实库/200环境分离'); });
  test.beforeEach(async ({}, info) => {
    const owner = ownedDesktopResources(info);
    if (halted) throw Error('Sidebar异步前例已保留，停止后续用例');
    // 表单和受控端口安装前记录原Main，失败时保留的窗口与PID必须可追溯。
    const actual = await owner.application.evaluate(({ app }) => ({ pid: process.pid, platform: process.platform, architecture: process.arch, version: app.getVersion(), packaged: app.isPackaged, appPath: app.getAppPath() }));
    ownedDesktopResources(info);
    await info.attach('Sidebar异步原Main启动归属', { body: JSON.stringify({ actual, noRealDatabase: true, noSystemClipboard: true }, null, 2), contentType: 'application/json' });
    ownedDesktopResources(info);
    name = 'Sidebar UI ' + randomUUID();
    // 正式连接表单与本地配置保存均使用产品路径，虚构目标只有loopback:1，未点击测试连接。
    await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(name); await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1'); await form.getByLabel(zh.connections.text010, { exact: true }).fill('1'); await form.getByLabel(zh.common.user, { exact: true }).fill('sidebar-fixture');
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click(); await expect(form).toBeHidden();
    const profile = await page.evaluate(async title => (await window.dbark.invoke('connections.list', {})).find(profile => profile.name === title), name);
    expect(profile).toMatchObject({ host: '127.0.0.1', port: 1, user: 'sidebar-fixture' }); connectionId = profile!.id;
    await desktop.evaluate(({ ipcMain }, id) => {
      const root = globalThis as Main; if (root.__sidebarAsyncUi) throw Error('本例IPC观察器重复安装');
      const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'); if (!original) throw Error('没有正式IPC处理器');
      const state: Control = { calls: [], restore() { handlers.set('dbark:request', original); for (const call of state.calls) if (!call.released) { call.released = true; call.complete({ ok: false, error: 'Sidebar本例清理取消未完成回包' }); } } }; root.__sidebarAsyncUi = state;
      handlers.set('dbark:request', async (event, payload) => {
        if (!['connections.open', 'connections.close', 'metadata.databases', 'metadata.objects'].includes(payload.command)) return original(event, payload);
        if ((payload.input.id ?? payload.input.connectionId) !== id) throw Error('拒绝本例之外的连接请求');
        const response = await original(event, { command: 'connections.list', input: {} }) as { ok: boolean; result?: { id: string; host: string; port: number; user: string }[] };
        const profile = response.result?.find(profile => profile.id === id);
        if (!response.ok || !profile || !['127.0.0.1', '127.0.0.2'].includes(profile.host) || profile.port !== 1 || profile.user !== 'sidebar-fixture') throw Error('本例只接受虚构loopback:1连接，禁止发往数据库');
        if (state.calls.length >= 32) throw Error('Sidebar本例调用摘要超出预算');
        return new Promise(complete => state.calls.push({ id: state.calls.length, command: payload.command, released: false, complete }));
      });
    }, connectionId);
  });
  test.afterEach(async ({}, info) => {
    // 失败现场保留原处理器、在途回包、窗口与profile；不能借收尾改写失败证据。
    if (info.status !== info.expectedStatus) { halted = true; retainOwnedDesktopResources(info); return; }
    try {
      const owner = ownedDesktopResources(info);
      await owner.application.evaluate(() => { const root = globalThis as Main; root.__sidebarAsyncUi?.restore(); delete root.__sidebarAsyncUi; });
      ownedDesktopResources(info);
      await confirmOwnedDesktopExit(info);
      expect(ownedDesktopResources(info).closed).toBe(true);
    } catch (error) { halted = true; retainOwnedDesktopResources(info); throw error; }
  });

  test('SIDEBAR-ASYNC-UI-01：连接刷新回包迟到不能撤销明确折叠', async ({}, info) => {
    await openConnection(); await (await action(connection().locator('.connection-row'), zh.sidebar.text011)).click(); await waitCall(2, 'connections.open'); await release(2, status); await waitCall(3, 'metadata.databases'); await label().click();
    await expect(label()).toHaveAttribute('aria-expanded', 'false'); await release(3, [database]); await expect(label()).toHaveAttribute('aria-expanded', 'false'); await expect(label()).toHaveAttribute('aria-busy', 'false'); await expect(connection().locator('.database-row')).toHaveCount(0); expect(await calls()).toHaveLength(4); expect(pageErrors).toEqual([]); await page.screenshot({ path: info.outputPath('sidebar-collapse-kept.png') });
  });
  test('SIDEBAR-ASYNC-UI-02：数据库折叠后新请求不会被旧目录和finally覆盖', async () => {
    await openConnection(); await openDatabase(); await (await action(databaseRow(), zh.sidebar.text018)).click(); await waitCall(3, 'metadata.objects'); await databaseLabel().click(); await databaseLabel().click(); await waitCall(4, 'metadata.objects');
    await release(3, [{ name: '旧表', kind: 'table' }]); await expect(databaseLabel()).toHaveAttribute('aria-busy', 'true'); await expect(connection().locator('.object-row')).toHaveCount(0); await release(4, [{ name: '新表', kind: 'table' }]); await expect(databaseLabel()).toHaveAttribute('aria-busy', 'false'); await expect(connection().locator('.object-row')).toHaveCount(1); await expect(connection().locator('.object-row')).toContainText('新表'); await expect(connection().locator('.object-row')).not.toContainText('旧表'); expect(pageErrors).toEqual([]);
  });
  test('SIDEBAR-ASYNC-UI-03：数据库菜单刷新在忙碌期间禁用且只接受一个在途请求', async () => {
    await openConnection(); await openDatabase(); await (await action(databaseRow(), zh.sidebar.text018)).click(); await waitCall(3, 'metadata.objects'); await expect(await action(databaseRow(), zh.sidebar.text018)).toBeDisabled(); expect(await calls()).toHaveLength(4); await page.keyboard.press('Escape');
    await release(3, [{ name: '新表', kind: 'table' }]); await expect(await action(databaseRow(), zh.sidebar.text018)).toBeEnabled(); await page.keyboard.press('Escape'); await expect(connection().locator('.object-row')).toContainText('新表'); expect(await calls()).toHaveLength(4); expect(pageErrors).toEqual([]);
  });
  test('SIDEBAR-ASYNC-UI-04：连接菜单忙碌期间不重复建连，旧结束不能提前释放新busy', async () => {
    await (await action(connection().locator('.connection-row'), zh.sidebar.text011)).click(); await waitCall(0, 'connections.open'); await expect(await action(connection().locator('.connection-row'), zh.sidebar.text011)).toBeDisabled(); expect(await calls()).toHaveLength(1); await page.keyboard.press('Escape'); await label().click(); await label().click(); await waitCall(1, 'connections.open'); await release(0, status);
    await expect(label()).toHaveAttribute('aria-busy', 'true'); expect(await calls()).toHaveLength(2); await release(1, status); await waitCall(2, 'metadata.databases'); await release(2, [database]); await expect(label()).toHaveAttribute('aria-busy', 'false'); await expect(databaseLabel()).toBeVisible(); expect(await calls()).toHaveLength(3); expect(pageErrors).toEqual([]);
  });
  test('SIDEBAR-ASYNC-UI-05：编辑连接重挂载等待旧断开，原取消错误保留且不补发close', async () => {
    await openConnection(); await (await action(connection().locator('.connection-row'), zh.sidebar.text013)).click(); await waitCall(2, 'connections.close');
    await (await action(connection().locator('.connection-row'), formatText(zh.sidebar.text010, name))).click(); const form = page.getByRole('dialog', { name: zh.connections.text003, exact: true }); await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.2'); await form.getByRole('button', { name: zh.connections.text036, exact: true }).click(); await expect(form).toBeHidden();
    await label().click(); await expect(label()).toHaveAttribute('aria-busy', 'true'); expect(await calls()).toHaveLength(3); await release(2, undefined, '本例受控回包取消收尾失败'); await expect(page.getByRole('alert')).toContainText('本例受控回包取消收尾失败'); await waitCall(3, 'connections.open'); await release(3, status); await waitCall(4, 'metadata.databases'); await release(4, [database]); await expect(databaseLabel()).toBeVisible(); expect((await calls()).filter(call => call.command === 'connections.close')).toHaveLength(1); expect(pageErrors).toEqual([]);
  });
});
