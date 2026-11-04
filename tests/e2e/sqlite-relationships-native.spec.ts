import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableBrowseZh as text } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { relationshipDiagramZh as diagramText } from '../../src/renderer/locales/relationshipDiagram.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { sqliteReferenceZh as referenceText } from '../../src/renderer/locales/sqliteReference.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_RELATIONSHIPS_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite关系图专项仅允许无外库认证的离线Windows/macOS源码，拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('关系图专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface MenuAudit { pending: number; commands: string[]; denied: string[]; pickerCalls: number; reads: unknown[]; references: { input: Record<string, unknown>; reply?: unknown }[]; connectionId?: string; restore(): void; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式离线启用SQLite关系图原生专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('关系图未完成准确正常退出，原现场保留'); } });

test('SQLite真实表页关系图单快照读取、隐式主键、草稿与本地显示', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, basename, dirname, resolve } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const owner = runtime.ownedDesktopResources(info), { application, page } = owner, process = application.process(), directory = runtime.dataDir, database = join(directory, 'relationships.sqlite');
  let closed = false, armed = false;
  /** 每个异步边界都绑定准确owner、期限和合成目录，不接管其它应用。 */
  const check = () => {
    const now = runtime.ownedDesktopResources(info);
    if (now.application !== application || now.page !== page || now.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry || info.repeatEachIndex || info.config.workers !== 1) throw Error('原关系图验收owner或期限已变化');
  };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const result = await action(); check(); return result; };
  const audit = () => step(() => application.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit }).__sqliteRelationshipsAudit;
    if (!state) throw Error('关系图Main观察器不存在'); return { pending: state.pending, commands: state.commands, denied: state.denied, pickerCalls: state.pickerCalls, reads: state.reads, references: state.references };
  }));
  const table = () => page.locator('.sqlite-table-tab:visible');
  const toolbar = () => table().getByRole('toolbar', { name: text.toolbar, exact: true });
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(dirname(resolve(database))).toBe(resolve(directory)); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    const db = new DatabaseSync(database); try { db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT,p REFERENCES parent); INSERT INTO parent VALUES(1); INSERT INTO subject VALUES(1,'合成原值','001')"); } finally { db.close(); }
    await info.attach('关系图准确启动归属', { body: JSON.stringify({ directory, database, pid: process.pid }), contentType: 'application/json' });
    await step(() => application.evaluate(({ ipcMain, dialog, BrowserWindow }, input) => {
      type Root = typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit };
      const root = globalThis as Root, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('dbark:request'), picker = dialog.showOpenDialog, window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (!original || root.__sqliteRelationshipsAudit || BrowserWindow.getAllWindows().length !== 1) throw Error('关系图Main原入口不明确');
      const state: MenuAudit = { pending: 0, commands: [], denied: [], pickerCalls: 0, reads: [], references: [], restore() {} };
      let choosing = false;
      const deny = (command: string): never => { state.denied.push(command); throw Error('关系图专项拒绝越界：' + command); };
      const current = () => { if (root.__sqliteRelationshipsAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== ownPicker || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('关系图Main原观察器失效'); };
      const ownPicker = (async (...args: unknown[]) => { current(); const options = args.at(-1) as Electron.OpenDialogOptions; if (!choosing || state.pickerCalls || !options.properties?.includes('openFile')) return deny('其它文件对话框'); state.pickerCalls++; return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
      const allowed = new Set(['app.menuState', 'app.setDirty', 'settings.get', 'settings.save', 'connections.list', 'connections.save', 'connections.test', 'connections.open', 'files.choose', 'metadata.databases', 'metadata.objects', 'tasks.list', 'history.list', 'sqlite.tablePage', 'sqlite.tableLayout.get', 'sqlite.relationships', 'sqlite.referencePage']);
      const wrapped = async (event: Electron.IpcMainInvokeEvent, packet: { command: string; input: Record<string, unknown> }) => {
        current(); const command = packet?.command, value = packet?.input;
        if (event.sender !== window.webContents || event.senderFrame !== frame || !allowed.has(command) || !value || typeof value !== 'object') return deny(String(command));
        if (command === 'files.choose') { if (value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string') return deny(command); state.connectionId = value.sqliteConnectionId; choosing = true; }
        if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite as { readOnly?: boolean } | undefined; if (value.id !== state.connectionId || value.dialect !== 'sqlite' || config?.readOnly !== true) return deny(command); }
        if (command === 'connections.open' && value.id !== state.connectionId || command.startsWith('metadata.') && value.connectionId !== state.connectionId) return deny(command);
        if (command.startsWith('sqlite.') && (value.connectionId !== state.connectionId || value.database !== 'main' || (command === 'sqlite.relationships' ? (value.anchor as { table?: string })?.table !== 'subject' || !Array.isArray(value.tables) || value.tables.some(name => !['subject', 'parent'].includes(String(name))) : value.table !== 'subject'))) return deny(command);
        state.pending++; state.commands.push(command);
        try { const result = await original(event, packet); current(); if (command === 'sqlite.relationships') state.reads.push({ input: structuredClone(value), reply: structuredClone(result) }); if (command === 'sqlite.referencePage') state.references.push({ input: structuredClone(value), reply: structuredClone(result) }); return result; } finally { state.pending--; if (command === 'files.choose') choosing = false; }
      };
      state.restore = () => { current(); if (state.pending) throw Error('关系图原请求未完成'); handlers.set('dbark:request', original); dialog.showOpenDialog = picker; delete root.__sqliteRelationshipsAudit; };
      root.__sqliteRelationshipsAudit = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = ownPicker;
    }, { database })); armed = true;
    await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill('SQLite关系图本例'));
    await step(() => form.locator('select').selectOption('sqlite')); await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked());
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: 'SQLite关系图本例' }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click());
    await step(() => page.locator('.object-row .tree-label').filter({ hasText: /^subject$/ }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
    // 打开模态会同步原生菜单可用状态；仅排除这个声明式状态命令，其余请求完整逐项核对。
    const operations = (commands: string[]) => commands.filter(command => command !== 'app.menuState');
    const before = await audit();
    await step(async () => (await navigationMenuItem(toolbar(), { name: diagramText.entry, exact: true }, check)).click());
    const dialog = page.getByRole('dialog', { name: diagramText.title, exact: true }); await step(() => expect(dialog).toBeVisible());
    expect(operations((await audit()).commands)).toEqual(operations(before.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.read, exact: true }).click());
    await step(() => expect(dialog).toContainText('1 张已读表 · 1 个未读目标 · 1 个外键'));
    await step(() => expect(dialog).toContainText('隐式主键第1列（未确认）'));
    await step(() => dialog.getByRole('button', { name: diagramText.catalog, exact: true }).click());
    await step(() => expect(dialog.getByRole('checkbox', { name: 'parent', exact: true })).toBeVisible());
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforePick = await audit();
    await step(() => dialog.getByRole('checkbox', { name: 'parent', exact: true }).check());
    expect(operations((await audit()).commands)).toEqual(operations(beforePick.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.read, exact: true }).click());
    await step(() => expect(dialog).toContainText('2 张已读表 · 0 个未读目标 · 1 个外键')); await step(() => expect(dialog).toContainText('p → id'));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforeLocal = await audit();
    for (const theme of ['dark', 'light']) {
      // 对话框在前时只更新合成窗口的显示主题；不模拟点击隐藏业务按钮。
      await step(() => page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme));
      await step(() => dialog.getByRole('button', { name: diagramText.zoomOut, exact: true }).click());
      await step(() => dialog.getByRole('button', { name: diagramText.fit, exact: true }).click());
      await step(() => dialog.getByRole('button', { name: 'main.parent', exact: true }).click());
      await step(() => expect(dialog.locator('.relationship-diagram-node')).toHaveCount(2));
      await info.attach('SQLite关系图-' + theme, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    }
    expect(operations((await audit()).commands)).toEqual(operations(beforeLocal.commands));
    await step(() => dialog.getByRole('button', { name: diagramText.refresh, exact: true }).click()); await step(() => expect.poll(async () => (await audit()).reads.length).toBe(3));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const after = await audit();
    expect(after.denied).toEqual([]); expect(after.pickerCalls).toBe(1); expect(runtime.pageErrors).toEqual([]);
    const requests = after.reads as { input: { taskId: string; tables: string[] }; reply: { ok: boolean; result: { tables: unknown[]; schemaVersion: string } } }[];
    expect(requests.map(value => value.input.tables)).toEqual([['subject'], ['subject', 'parent'], ['subject', 'parent']]);
    expect(new Set(requests.map(value => value.input.taskId)).size).toBe(3); for (const value of requests) { expect(value.reply.ok).toBe(true); expect(value.reply.result.tables).toHaveLength(value.input.tables.length); }
    await step(() => dialog.locator('.modal-footer').getByRole('button', { name: diagramText.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
    await info.attach('SQLite关系图真实Main请求与原资源边界', { body: JSON.stringify({ platform: globalThis.process.platform, before, after, realMain: true, realSQLiteWorker: true, systemFilePickerInputVerified: false, themeSelectionViaSettingsVerified: false, noSystemClipboard: true }), contentType: 'application/json' });
    // 真实当前行的TEXT子键001按父INTEGER亲和性匹配1；打开与选择都零隐式读取。
    const sourceReads = (await audit()).commands.filter(command => command === 'sqlite.tablePage').length;
    await step(() => table().getByRole('grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').nth(1).click());
    const beforeReference = await audit(); await step(async () => (await navigationMenuItem(toolbar(), { name: referenceText.entry, exact: true }, check)).click());
    const reference = page.getByRole('dialog', { name: referenceText.title, exact: true }); await step(() => expect(reference).toBeVisible()); expect((await audit()).references).toEqual(beforeReference.references);
    await step(() => reference.getByRole('button', { name: referenceText.catalog, exact: true }).click()); await step(() => expect(reference.getByLabel(referenceText.constraint, { exact: true })).toHaveValue('0'));
    expect((await audit()).references).toHaveLength(1); await step(() => reference.getByRole('button', { name: referenceText.read, exact: true }).click());
    await step(() => expect(reference.getByRole('grid').getByRole('gridcell').filter({ hasText: /^1$/ })).toHaveCount(1));
    const referenceFacts = await audit(); expect(referenceFacts.references).toHaveLength(2); expect(referenceFacts.references[1].input).toMatchObject({ reference: 'page', foreignKey: 0, values: [{ kind: 'text', value: '001' }], table: 'subject', offset: 0, limit: 50 });
    expect(referenceFacts.commands.filter(command => command === 'sqlite.tablePage')).toHaveLength(sourceReads);
    await info.attach('SQLite外键父记录真实窗口', { body: await page.screenshot(), contentType: 'image/png' });
    await step(() => reference.getByRole('button', { name: referenceText.close, exact: true }).click()); await step(() => expect(reference).toHaveCount(0));
    await info.attach('SQLite外键浏览原始回包', { body: JSON.stringify((await audit()).references), contentType: 'application/json' });
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteRelationshipsAudit?: MenuAudit }).__sqliteRelationshipsAudit; if (!state) throw Error('原关系图观察器已消失'); state.restore(); })); armed = false;
    check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(process.exitCode).toBe(0);
    const verify = new DatabaseSync(database, { readOnly: true }); try { expect(verify.prepare('SELECT id,note,p FROM subject').all()).toEqual([{ id: 1, note: '合成原值', p: '001' }]); expect(verify.prepare('SELECT id FROM parent').all()).toEqual([{ id: 1 }]); } finally { verify.close(); }
    completed = { directory, database, pid: process.pid, platform: globalThis.process.platform };
    await info.attach('SQLite关系图准确正常退出', { body: JSON.stringify({ ...completed, exitCode: process.exitCode }), contentType: 'application/json' });
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    try { await info.attach('SQLite关系图失败原件', { body: JSON.stringify({ directory, database, pid: process.pid, exitCode: process.exitCode, closed, armed, error: reason instanceof Error ? reason.message : String(reason), automaticRetry: false, directoryRemoved: false }), contentType: 'application/json' }); } catch { /* 不覆盖原错误或解除原owner保留。 */ }
    throw reason;
  }
});

/** 原fixture确认准确进程退出后才清理目录；本例只读核零，不自行删除失败现场。 */
test.afterAll(async ({}, info: TestInfo) => {
  if (!completed) return;
  const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let removed = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') removed = true; else throw reason; }
  expect(removed).toBe(true); await info.attach('SQLite关系图最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, launches: 1, systemClipboardOperations: 0 }), contentType: 'application/json' });
});
