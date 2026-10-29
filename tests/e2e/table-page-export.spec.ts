import { clickSidebarAction } from './sidebar-menu';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tablePageExportZh as text } from '../../src/renderer/locales/tablePageExport.zh-CN';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_PAGE_EXPORT_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认及列表不读取认证、不加载桌面；Root先创建本轮隔离夹具，只接受明确200/13384。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_pageexport_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表页快照导出缺少本轮准确明文隔离目标，拒绝启动');
const output = active ? process.env.DBARK_TABLE_EXPORT_JSON_PATH : undefined;
if (active && (!output || !isAbsolute(output) || resolve(output) !== output || basename(output) !== 'selected-page.json' || !/^dbark-page-export-[a-f0-9]{32}$/.test(basename(dirname(output))))) throw Error('缺少Root本例独占导出路径');
test.skip(!active, '默认关闭：须Root显式提供准确隔离夹具及DBARK_TABLE_PAGE_EXPORT_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 只记录本例真实table.page参数及原回包，写命令在原handler前拒绝；不制造数据或变更store。 */
function observePages({ ipcMain }: { ipcMain: Electron.IpcMain }, expected: { database: string; connectionId: string }) {
  const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
  if (typeof original !== 'function' || root.__tablePageExportPages) throw Error('分页观察归属未知');
  const state = { pages: [] as any[], pending: 0, writes: 0 };
  root.__tablePageExportPages = state;
  handlers.set('dbark:request', async (event: any, payload: any) => {
    if (/^(?:query\.execute|schema\.)/.test(payload.command) || ['table.apply', 'table.preview'].includes(payload.command)) { state.writes++; throw Error('本例禁止产品写入或SQL正文执行'); }
    if (payload.command !== 'table.page') return original(event, payload);
    const input = payload.input;
    if (state.pages.length >= 16 || input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('分页目标或预算已变化');
    const entry: any = { input: { page: input.page, pageSize: input.pageSize, filters: structuredClone(input.filters), filterMode: input.filterMode, sort: structuredClone(input.sort) } }; state.pages.push(entry); state.pending++;
    try { const reply = await original(event, payload); if (reply?.ok !== true || !Array.isArray(reply.result?.rows)) throw Error('真实分页未成功'); entry.ids = reply.result.rows.map((row: any) => row.id); entry.hasMore = reply.result.hasMore; return reply; }
    finally { state.pending--; }
  });
}

test('真实表页导出当前页及勾选快照：零重查、原序、精确小数、NULL与二进制JSON', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
  /** 每次await核原窗口归属；失败立即保留，禁止重启或强退补证。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  const state = () => step(() => application.evaluate(() => (globalThis as any).__tablePageExportPages as { pages: any[]; pending: number; writes: number }));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const connectionName = '本页快照导出本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.host).toBe(target!.host); expect(profile.port).toBe(13384); expect(profile.database).toBe(target!.database); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    await step(() => application.evaluate(observePages, { database: target!.database!, connectionId: profile.id }));
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => clickSidebarAction(connection, { name: zh.sidebar.text011, exact: true })); await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click()); await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const tab = page.locator('.table-tab:visible'), grid = tab.locator('.results-grid');
    await step(() => tab.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids?.length).toBe(50));
    await step(() => tab.getByRole('columnheader', { name: /^id/ }).click()); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.input.sort).toEqual([{ column: 'id', direction: 'ASC' }])); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(tab.locator('.loading-overlay')).toHaveCount(0));
    const before = (await state()).pages.length;
    await step(() => tab.getByRole('button', { name: text.page, exact: true }).click()); const full = page.getByRole('dialog', { name: text.page, exact: true }); await step(() => expect(full).toContainText(text.pageRows(50))); expect((await state()).pages).toHaveLength(before); await step(() => full.getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(full).toBeHidden());
    // 反向勾选第三和第一行，文件仍按当前页原序输出；本页之外的行不能混入。
    for (const index of [4, 2]) await step(() => grid.locator(`[role="row"][aria-rowindex="${index}"]`).getByRole('checkbox').check());
    await step(() => tab.getByRole('button', { name: text.selected, exact: true }).click()); const dialog = page.getByRole('dialog', { name: text.selected, exact: true }); await step(() => expect(dialog).toContainText(text.selectedRows(2))); await step(() => dialog.getByRole('combobox', { name: zh.resultExport.format, exact: true }).selectOption('json')); expect((await state()).pages).toHaveLength(before);
    const ownerWindow = await step(() => application.browserWindow(page)), senderId = await step(() => ownerWindow.evaluate(window => window.webContents.id)); await step(() => ownerWindow.dispose());
    await step(() => application.evaluate(({ dialog }, target) => { const original = dialog.showSaveDialog; dialog.showSaveDialog = (async (...args: any[]) => { dialog.showSaveDialog = original; if (args[0]?.webContents?.id !== target.senderId) throw Error('拒绝其它窗口使用本例保存路径'); return { canceled: false, filePath: target.path }; }) as typeof dialog.showSaveDialog; }, { senderId, path: output! }));
    await step(() => dialog.locator('.file-picker').click()); await step(() => dialog.getByRole('button', { name: zh.resultExport.start, exact: true }).click()); await step(() => expect(dialog.locator('.success-box')).toContainText('已导出 2 行'));
    expect((await step(() => stat(output!))).size).toBeLessThan(32768);
    // 原生文件独立JSON解析，期望值手写，不调用产品编码器生成答案。
    const rows = JSON.parse((await step(() => readFile(output!, 'utf8'))).replace(/^\uFEFF/, ''));
    expect(rows).toEqual([{ id: '1', amount: '0.12345678901234567890', note: '', bin: { type: 'binary', base64: 'AP8=' } }, { id: '3', amount: '1.00000000000000000000', note: null, bin: { type: 'binary', base64: '' } }]);
    for (const row of rows) expect(Object.keys(row)).toEqual(['id', 'amount', 'note', 'bin']);
    await step(() => dialog.getByRole('button', { name: zh.common.done, exact: true }).click()); await step(() => expect(tab.getByRole('button', { name: text.selected, exact: true })).toBeDisabled());
    const final = await state(); expect(final.pages).toHaveLength(before); expect(final.pending).toBe(0); expect(final.writes).toBe(0); expect(runtime.pageErrors).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(tasks.filter(task => task.kind === 'files.exportResult')).toHaveLength(1);
    await info.attach('表页快照导出', { body: Buffer.from(JSON.stringify({ pageRows: 50, selectedRows: 2, noRequery: true, noDatabaseWrites: true, jsonVerified: true, pages: final.pages })), contentType: 'application/json' });
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
  } catch (reason) { runtime.retainOwnedDesktopResources(info); throw reason; }
});
