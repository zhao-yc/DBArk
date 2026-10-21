import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableCellFilterZh as text } from '../../src/renderer/locales/tableCellFilter.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_CELL_FILTER_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认及列表不读取认证、不加载桌面；Root先创建本轮隔离夹具，只接受明确200/13384。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_cellfilter_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表格单元格筛选缺少本轮准确明文隔离目标，拒绝启动');
test.skip(!active, '默认关闭：须Root显式提供准确隔离夹具及DBARK_TABLE_CELL_FILTER_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 只记录本例真实table.page参数及原回包，写命令在原handler前拒绝；不制造数据或变更store。 */
function observePages({ ipcMain }: { ipcMain: Electron.IpcMain }, expected: { database: string; connectionId: string }) {
  const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
  if (typeof original !== 'function' || root.__tableCellFilterPages) throw Error('分页观察归属未知');
  const state = { pages: [] as any[], pending: 0, writes: 0 };
  root.__tableCellFilterPages = state;
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

test('真实表页按单元格原值读取全表：跨页精确小数、空串排除、NULL及二进制禁用', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, captured = runtime.ownedDesktopResources(info), page = captured.page, application = captured.application;
  /** 每次await前后核原TestInfo和窗口，不重启失败实例。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  const state = () => step(() => application.evaluate(() => (globalThis as any).__tableCellFilterPages as { pages: { input: any; ids?: string[]; hasMore?: boolean }[]; pending: number; writes: number }));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const connectionName = '单元格筛选本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql'));
    await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
    expect(profile.database).toBe(target!.database); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    await step(() => application.evaluate(observePages, { database: target!.database!, connectionId: profile.id }));
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => connection.getByRole('button', { name: zh.sidebar.text011, exact: true }).click());
    await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click());
    await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const tab = page.locator('.table-tab:visible'), grid = tab.locator('.results-grid'), filter = tab.locator('.filter-panel');
    const ids = () => step(() => grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents());
    // 新profile的默认页大小不承担本例前提；用正式入口明确选50，仍保留原50行断言。
    await step(() => tab.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50'));
    await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids?.length).toBe(50));
    await step(() => tab.getByRole('columnheader', { name: /^id/ }).click());
    await step(() => expect.poll(async () => (await state()).pages.at(-1)?.input.sort).toEqual([{ column: 'id', direction: 'ASC' }]));
    await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(tab.locator('.loading-overlay')).toHaveCount(0));
    async function cell(row: number, column: number) { await step(() => grid.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${column}"]`).click()); }
    const add = () => step(() => filter.getByRole('button', { name: zh.table.text013, exact: true }).click());
    await cell(2, 3); const before = (await state()).pages.length; await step(() => tab.getByRole('button', { name: text.equal, exact: true }).click());
    expect((await state()).pages).toHaveLength(before); await step(() => expect(filter.getByRole('textbox', { name: zh.table.text011, exact: true })).toHaveValue('0.12345678901234567890'));
    await add(); await step(() => expect.poll(ids).toEqual(['1', '61']));
    expect((await state()).pages.at(-1)?.input).toMatchObject({ page: 1, filterMode: 'all', filters: [{ column: 'amount', operator: '=', value: '0.12345678901234567890' }], sort: [{ column: 'id', direction: 'ASC' }] });
    // 空串排除按服务器!=语义也不包含NULL；结果确实为空，不回退未筛选数据。
    await cell(2, 4); const beforeEmpty = (await state()).pages.length; await step(() => tab.getByRole('button', { name: text.exclude, exact: true }).click()); expect((await state()).pages).toHaveLength(beforeEmpty);
    await step(() => expect(filter.getByRole('textbox', { name: zh.table.text011, exact: true })).toHaveValue('')); await add(); await step(() => expect.poll(ids).toEqual([]));
    expect((await state()).pages.at(-1)?.input.filters.at(-1)).toEqual({ column: 'note', operator: '!=', value: '' }); expect((await state()).pages.at(-1)?.ids).toEqual([]);
    await step(() => filter.locator('.filter-mode-row').getByRole('button', { name: zh.common.clearAll, exact: true }).click());
    await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids?.length).toBe(50)); await step(() => expect(tab.locator('.loading-overlay')).toHaveCount(0));
    await cell(2, 3); await step(() => tab.getByRole('button', { name: text.equal, exact: true }).click()); await add(); await step(() => expect.poll(ids).toEqual(['1', '61']));
    await cell(3, 4); await step(() => tab.getByRole('button', { name: text.equal, exact: true }).click()); await step(() => expect(filter.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true })).toHaveValue('IS NULL')); await add(); await step(() => expect.poll(ids).toEqual(['61']));
    expect((await state()).pages.at(-1)?.input.filters.at(-1)).toEqual({ column: 'note', operator: 'IS NULL' });
    await cell(2, 5); await step(() => expect(tab.getByRole('button', { name: text.equal, exact: true })).toBeDisabled()); await step(() => expect(tab.getByRole('button', { name: text.exclude, exact: true })).toBeDisabled());
    const final = await state(); expect(final.pending).toBe(0); expect(final.writes).toBe(0); expect(runtime.pageErrors).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);
    await info.attach('表格单元格筛选', { body: Buffer.from(JSON.stringify({ equalOffPage: true, emptyExcluded: true, nullPredicate: true, binaryDisabled: true, noProductWrites: true, pages: final.pages })), contentType: 'application/json' });
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
  } catch (reason) { runtime.retainOwnedDesktopResources(info); throw reason; }
});
