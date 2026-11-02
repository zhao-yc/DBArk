import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableBrowseZh as text } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTableLayoutZh as layoutText } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { navigationMenuItem } from './navigation-menu';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_TABLE_TOOLBAR_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite工具栏专项仅允许无外库认证的离线Windows/macOS源码，拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('工具栏专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface MenuAudit { pending: number; commands: string[]; denied: string[]; pickerCalls: number; connectionId?: string; restore(): void; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式离线启用SQLite工具栏原生专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('工具栏未完成准确正常退出，原现场保留'); } });

test('SQLite表工具栏在最小窗口及600侧栏明暗无根溢出，真实菜单保原操作且零数据库请求', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, basename, dirname, resolve } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const owner = runtime.ownedDesktopResources(info), { application, page } = owner, process = application.process(), directory = runtime.dataDir, database = join(directory, 'toolbar.sqlite');
  let closed = false, armed = false;
  /** 每个异步边界都绑定准确owner、期限和合成目录，不接管其它应用。 */
  const check = () => {
    const now = runtime.ownedDesktopResources(info);
    if (now.application !== application || now.page !== page || now.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry || info.repeatEachIndex || info.config.workers !== 1) throw Error('原工具栏验收owner或期限已变化');
  };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const result = await action(); check(); return result; };
  const audit = () => step(() => application.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __sqliteToolbarAudit?: MenuAudit }).__sqliteToolbarAudit;
    if (!state) throw Error('工具栏Main观察器不存在'); return { pending: state.pending, commands: state.commands, denied: state.denied, pickerCalls: state.pickerCalls };
  }));
  const table = () => page.locator('.sqlite-table-tab:visible');
  const toolbar = () => table().getByRole('toolbar', { name: text.toolbar, exact: true });
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(dirname(resolve(database))).toBe(resolve(directory)); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    const db = new DatabaseSync(database); try { db.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO subject VALUES(1,'合成原值')"); } finally { db.close(); }
    await info.attach('工具栏准确启动归属', { body: JSON.stringify({ directory, database, pid: process.pid }), contentType: 'application/json' });
    await step(() => application.evaluate(({ ipcMain, dialog, BrowserWindow }, input) => {
      type Root = typeof globalThis & { __sqliteToolbarAudit?: MenuAudit };
      const root = globalThis as Root, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('dbark:request'), picker = dialog.showOpenDialog, window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (!original || root.__sqliteToolbarAudit || BrowserWindow.getAllWindows().length !== 1) throw Error('工具栏Main原入口不明确');
      const state: MenuAudit = { pending: 0, commands: [], denied: [], pickerCalls: 0, restore() {} };
      let choosing = false;
      const deny = (command: string): never => { state.denied.push(command); throw Error('工具栏专项拒绝越界：' + command); };
      const current = () => { if (root.__sqliteToolbarAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== ownPicker || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('工具栏Main原观察器失效'); };
      const ownPicker = (async (...args: unknown[]) => { current(); const options = args.at(-1) as Electron.OpenDialogOptions; if (!choosing || state.pickerCalls || !options.properties?.includes('openFile')) return deny('其它文件对话框'); state.pickerCalls++; return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
      const allowed = new Set(['app.menuState', 'app.setDirty', 'settings.get', 'settings.save', 'connections.list', 'connections.save', 'connections.test', 'connections.open', 'files.choose', 'metadata.databases', 'metadata.objects', 'tasks.list', 'history.list', 'sqlite.tablePage', 'sqlite.tableLayout.get']);
      const wrapped = async (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => {
        current(); const command = packet?.command, value = packet?.input;
        if (event.sender !== window.webContents || event.senderFrame !== frame || !allowed.has(command) || !value || typeof value !== 'object') return deny(String(command));
        if (command === 'files.choose') { if (value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string') return deny(command); state.connectionId = value.sqliteConnectionId; choosing = true; }
        if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite as { readOnly?: boolean } | undefined; if (value.id !== state.connectionId || value.dialect !== 'sqlite' || config?.readOnly !== true) return deny(command); }
        if (command === 'connections.open' && value.id !== state.connectionId || command.startsWith('metadata.') && value.connectionId !== state.connectionId) return deny(command);
        if (command.startsWith('sqlite.') && (value.connectionId !== state.connectionId || value.database !== 'main' || value.table !== 'subject')) return deny(command);
        state.pending++; state.commands.push(command);
        try { const result = await original(event, packet); current(); return result; } finally { state.pending--; if (command === 'files.choose') choosing = false; }
      };
      state.restore = () => { current(); if (state.pending) throw Error('工具栏原请求未完成'); handlers.set('dbark:request', original); dialog.showOpenDialog = picker; delete root.__sqliteToolbarAudit; };
      root.__sqliteToolbarAudit = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = ownPicker;
    }, { database })); armed = true;
    await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill('SQLite工具栏本例'));
    await step(() => form.locator('select').selectOption('sqlite')); await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked());
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: 'SQLite工具栏本例' }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click());
    await step(() => page.locator('.object-row .tree-label').filter({ hasText: /^subject$/ }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
    const before = await audit(), layoutFacts: unknown[] = [];
    await step(() => application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 680); }));
    for (const sidebar of [300, 600]) {
      await step(() => page.getByRole('button', { name: zh.app.text009, exact: true }).click()); const preferences = page.getByRole('dialog');
      await step(() => preferences.getByLabel(zh.app.text022, { exact: true }).fill(String(sidebar))); await step(() => preferences.getByRole('button', { name: zh.common.done, exact: true }).click());
      await step(() => expect(page.locator('.sidebar-container')).toHaveCSS('width', sidebar + 'px'));
      for (const theme of ['dark', 'light']) {
        if (await step(() => page.locator('html').getAttribute('data-theme')) !== theme) await step(() => page.getByRole('button', { name: zh.app.text008, exact: true }).click());
        await step(() => expect(page.locator('html')).toHaveAttribute('data-theme', theme));
        await step(() => expect.poll(() => toolbar().evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true));
        const geometry = await step(() => page.evaluate(() => { const root = document.getElementById('root')!, bar = document.querySelector('.sqlite-table-tab .toolbar')!; return { root: { client: root.clientWidth, scroll: root.scrollWidth, left: root.scrollLeft }, bar: { client: bar.clientWidth, scroll: bar.scrollWidth }, viewport: innerWidth, right: bar.getBoundingClientRect().right }; }));
        expect(geometry.root.scroll).toBeLessThanOrEqual(geometry.root.client + 1); expect(geometry.root.left).toBe(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
        await step(() => toolbar().locator('.action-menu-trigger').click()); const menu = page.locator('.action-menu-panel:not(.action-menu-submenu)'); await step(() => expect(menu).toBeVisible());
        await step(() => page.keyboard.press('End')); await step(() => expect(menu.getByRole('menuitem').last()).toBeFocused()); await step(() => page.keyboard.press('Home')); await step(() => expect(menu.getByRole('menuitem').first()).toBeFocused());
        await step(() => page.keyboard.press('Escape')); await step(() => expect(menu).toHaveCount(0));
        await step(async () => (await navigationMenuItem(toolbar(), { name: layoutText.entry, exact: true }, check)).click()); const layout = page.getByRole('dialog', { name: layoutText.title, exact: true }); await step(() => expect(layout).toBeVisible()); await step(() => layout.locator('.modal-footer').getByRole('button', { name: zh.common.close, exact: true }).click());
        await step(() => expect(layout).toBeHidden()); layoutFacts.push({ sidebar, theme, geometry });
        await info.attach('SQLite工具栏' + sidebar + '-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
      }
    }
    const after = await audit(), databaseCommands = (commands: string[]) => commands.filter(command => command.startsWith('sqlite.') || command.startsWith('metadata.') || ['connections.open', 'connections.save', 'connections.test', 'files.choose'].includes(command));
    expect(databaseCommands(after.commands)).toEqual(databaseCommands(before.commands)); expect(after.denied).toEqual([]); expect(after.pickerCalls).toBe(1); expect(runtime.pageErrors).toEqual([]);
    await info.attach('SQLite工具栏实际布局与原请求边界', { body: JSON.stringify({ platform: globalThis.process.platform, layoutFacts, before, after, noSystemClipboard: true }), contentType: 'application/json' });
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteToolbarAudit?: MenuAudit }).__sqliteToolbarAudit; if (!state) throw Error('原工具栏观察器已消失'); state.restore(); })); armed = false;
    check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(process.exitCode).toBe(0);
    const verify = new DatabaseSync(database, { readOnly: true }); try { expect(verify.prepare('SELECT id,note FROM subject').all()).toEqual([{ id: 1, note: '合成原值' }]); } finally { verify.close(); }
    completed = { directory, database, pid: process.pid, platform: globalThis.process.platform };
    await info.attach('SQLite工具栏准确正常退出', { body: JSON.stringify({ ...completed, exitCode: process.exitCode }), contentType: 'application/json' });
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    try { await info.attach('SQLite工具栏失败原件', { body: JSON.stringify({ directory, database, pid: process.pid, exitCode: process.exitCode, closed, armed, error: reason instanceof Error ? reason.message : String(reason), automaticRetry: false, directoryRemoved: false }), contentType: 'application/json' }); } catch { /* 不覆盖原错误或解除原owner保留。 */ }
    throw reason;
  }
});

/** 原fixture确认准确进程退出后才清理目录；本例只读核零，不自行删除失败现场。 */
test.afterAll(async ({}, info: TestInfo) => {
  if (!completed) return;
  const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let removed = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') removed = true; else throw reason; }
  expect(removed).toBe(true); await info.attach('SQLite工具栏最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, launches: 1, systemClipboardOperations: 0 }), contentType: 'application/json' });
});
