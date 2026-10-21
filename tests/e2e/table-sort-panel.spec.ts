import { test as baseTest, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableSortZh as text } from '../../src/renderer/locales/tableSort.zh-CN';
import { tableCellFilterZh as cellText } from '../../src/renderer/locales/tableCellFilter.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_SORT_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认和列表不读取认证、不加载桌面；用例自行创建全新隔离库，不接受已有数据库。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_tablesort_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表多列排序缺少准确200/13384隔离目标，拒绝启动');
test.skip(!active, '默认关闭：须提供本轮RAM认证及DBARK_TABLE_SORT_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 观察正式分页及原回包，任何产品写入或SQL正文执行在原handler前拒绝。 */
function observePages({ ipcMain }: { ipcMain: Electron.IpcMain }, expected: { database: string; connectionId: string }) {
  const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
  if (typeof original !== 'function' || root.__tableSortPages) throw Error('排序观察器归属未知');
  const state = { pages: [] as any[], pending: 0, writes: 0 }; root.__tableSortPages = state;
  handlers.set('dbark:request', async (event: any, payload: any) => {
    if (/^(?:query\.execute|schema\.)/.test(payload.command) || ['table.apply', 'table.preview'].includes(payload.command)) { state.writes++; throw Error('本例禁止产品写入及正文执行'); }
    if (payload.command !== 'table.page') return original(event, payload);
    const input = payload.input;
    if (state.pages.length >= 16 || input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('分页目标或预算已变化');
    const entry: any = { input: { page: input.page, pageSize: input.pageSize, filters: structuredClone(input.filters), filterMode: input.filterMode, sort: structuredClone(input.sort) } }; state.pages.push(entry); state.pending++;
    try { const reply = await original(event, payload); if (reply?.ok !== true || !Array.isArray(reply.result?.rows)) throw Error('正式分页未成功'); entry.ids = reply.result.rows.map((row: any) => row.id); entry.hasMore = reply.result.hasMore; return reply; }
    finally { state.pending--; }
  });
}

test('真实表页多列排序：第三页回第一页、精确筛选、优先级与取消保留草稿', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const qualified = '`' + target!.database! + '`.`subject`', databaseSql = '`' + target!.database! + '`', digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let definition = '', data = '', preparedThread = 0, cleanupThread = 0, created = false;
  const closes: { label: string; normal: boolean; streamClosed: boolean }[] = [];
  /** 每条辅助连接都重新核准确服务器和原生关闭；只在原owner仍有效时结算。 */
  async function auxiliary(label: string, action: (connection: import('mysql2/promise').Connection, id: number) => Promise<void>, afterExit = false): Promise<void> {
    const check = () => { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || !afterExit && current.closed) throw Error('辅助连接原owner失效'); };
    check(); const connection = await mysql.createConnection({ host: target!.host!, port: 13384, user: target!.user, password: target!.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 15000 }), native = (connection as any).connection, stream = native?.stream;
    expect(Boolean(native && stream)).toBe(true); let failure: unknown;
    try { check(); const [rows] = await connection.query<any[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS id'); check(); expect(rows).toHaveLength(1); expect(rows[0].version).toMatch(/^8\.4\.11(?:-|$)/); expect(rows[0].os).toBe('Linux'); expect(Number(rows[0].names)).toBe(0); expect(rows[0].uuid).toBe(target!.uuid); await action(connection, Number(rows[0].id)); check(); }
    catch (reason) { failure = reason; }
    check(); await closeMysqlConnection(native, true, false, 2000); expect(stream.closed).toBe(true); closes.push({ label, normal: true, streamClosed: true }); if (failure) throw failure;
  }
  /** 每步核原TestInfo、App和窗口，失败保留原资源，不重启或补退出。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  const state = () => step(() => application.evaluate(() => (globalThis as any).__tableSortPages as { pages: { input: { page: number; pageSize: number; filters: unknown[]; filterMode: string; sort: unknown[] }; ids?: string[]; hasMore?: boolean }[]; pending: number; writes: number }));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await auxiliary('prepare', async (connection, id) => {
      preparedThread = id; const [existing] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]); expect(existing).toHaveLength(0);
      await connection.query('CREATE DATABASE ' + databaseSql + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
      await connection.query('CREATE TABLE ' + qualified + ' (id BIGINT NOT NULL PRIMARY KEY,amount DECIMAL(30,20) NOT NULL,note VARCHAR(200) NULL,bin VARBINARY(4) NULL) ENGINE=InnoDB');
      await connection.query('INSERT INTO ' + qualified + ' VALUES ?', [Array.from({ length: 121 }, (_, index) => [index + 1, '0.12345678901234567890', index === 0 ? '' : index === 120 ? null : (index + 1) % 2 === 0 ? 'A' : 'B', Buffer.from([0, 255])])]);
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); definition = digest(ddl); data = digest(rows);
    });
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }), connectionName = '多列排序本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.database).toBe(target!.database!); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    await step(() => application.evaluate(observePages, { connectionId: profile.id, database: target!.database! }));
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => connection.getByRole('button', { name: zh.sidebar.text011, exact: true }).click()); await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click()); await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const table = page.locator('.table-tab:visible'), grid = table.locator('.results-grid'), panel = table.getByRole('region', { name: text.title, exact: true });
    const cell = (row: number, column: number) => grid.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${column}"]`);
    const choose = (label: string, value: string) => step(() => panel.getByRole('combobox', { name: label, exact: true }).selectOption(value));
    const open = () => step(() => table.getByRole('button', { name: text.entry, exact: true }).click());
    const click = (name: string) => step(() => panel.getByRole('button', { name, exact: true }).click());
    /** 等待本例一次正式回包及加载收尾，不把旧页面当成新排序结果。 */
    async function settled(count?: number) { if (count !== undefined) await step(() => expect.poll(async () => (await state()).pages.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids !== undefined).toBe(true)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); if (count !== undefined) expect((await state()).pages).toHaveLength(count); }
    await step(() => expect(cell(2, 2)).toHaveText('1')); await settled();
    await step(() => table.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids?.length).toBe(50)); await settled();
    await step(() => cell(2, 3).click()); await step(() => table.getByRole('button', { name: cellText.equal, exact: true }).click());
    const filterForm = table.locator('.filter-rule-form'); await step(() => expect(filterForm.getByRole('textbox', { name: zh.table.text011, exact: true })).toHaveValue('0.12345678901234567890')); const beforeFilter = (await state()).pages.length; await step(() => filterForm.getByRole('button', { name: zh.table.text013, exact: true }).click()); await settled(beforeFilter + 1);
    const appliedFilter = [{ column: 'amount', operator: '=', value: '0.12345678901234567890' }]; expect((await state()).pages.at(-1)?.input.filters).toEqual(appliedFilter);
    await step(() => table.getByRole('textbox', { name: zh.table.pageJumpLabel, exact: true }).fill('3')); await step(() => table.locator('.page-jump').getByRole('button', { name: zh.table.pageJump, exact: true }).click()); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids).toEqual(Array.from({ length: 21 }, (_, index) => String(index + 101)))); await settled();
    const before = (await state()).pages.length; await open(); await click(text.add); await choose(text.field(1), 'note'); await click(text.add); await choose(text.field(2), 'id'); await choose(text.direction(2), 'DESC'); expect((await state()).pages).toHaveLength(before);
    await click(text.apply); await step(() => expect(panel).toBeHidden());
    const expected = ['121', '1', ...Array.from({ length: 48 }, (_, index) => String(120 - index * 2))]; await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids).toEqual(expected)); await settled(before + 1);
    expect((await state()).pages.at(-1)?.input).toMatchObject({ page: 1, pageSize: 50, filters: appliedFilter, filterMode: 'all', sort: [{ column: 'note', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] }); expect((await state()).pages.at(-1)?.hasMore).toBe(true);
    for (const [index, id] of expected.slice(0, 3).entries()) await step(() => expect(cell(index + 2, 2)).toHaveText(id));
    // 第2行原note为空串；取消只丢排序草稿，随后通过真实网格将原行输入恢复为空串。
    const note = cell(3, 4), editor = table.locator('.grid-input'); await step(() => note.dblclick()); await step(() => editor.fill('保留的本页草稿')); await step(() => editor.press('Enter')); await step(() => expect(editor).toHaveCount(0)); await step(() => expect(note).toHaveText('保留的本页草稿'));
    const beforeCancel = (await state()).pages.length; await open(); await choose(text.direction(1), 'DESC'); await click(text.cancel); await step(() => expect(note).toHaveText('保留的本页草稿')); expect((await state()).pages).toHaveLength(beforeCancel);
    await step(() => note.dblclick()); await step(() => editor.fill('')); await step(() => editor.press('Enter')); await step(() => expect(editor).toHaveCount(0)); await step(() => expect(note).toHaveText('')); await step(() => expect(table.getByRole('button', { name: zh.table.text018, exact: true })).toHaveCount(0));
    await open(); await click(text.earlier(2)); expect((await state()).pages).toHaveLength(beforeCancel); await click(text.apply);
    await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids).toEqual(Array.from({ length: 50 }, (_, index) => String(121 - index)))); await settled(beforeCancel + 1); expect((await state()).pages.at(-1)?.input.sort).toEqual([{ column: 'id', direction: 'DESC' }, { column: 'note', direction: 'ASC' }]); expect((await state()).pages.at(-1)?.input.filters).toEqual(appliedFilter);
    const beforeClear = (await state()).pages.length; await open(); await click(text.clear); expect((await state()).pages).toHaveLength(beforeClear); await click(text.apply); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids).toEqual(Array.from({ length: 50 }, (_, index) => String(index + 1)))); await settled(beforeClear + 1); expect((await state()).pages.at(-1)?.input.sort).toEqual([]);
    const beforeUnchanged = (await state()).pages.length; await open(); await click(text.apply); await step(() => expect(panel).toBeHidden()); await settled(beforeUnchanged);
    const final = await state(); expect(final.writes).toBe(0); expect(final.pending).toBe(0); expect(runtime.pageErrors).toEqual([]); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);

    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    await auxiliary('cleanup', async (connection, id) => {
      cleanupThread = id; const [active] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=?', [target!.database!, preparedThread]); expect(active).toHaveLength(0);
      const [objects] = await connection.execute<any[]>('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target!.database!]); expect(objects.map(row => [row.TABLE_NAME, row.TABLE_TYPE])).toEqual([['subject', 'BASE TABLE']]);
      for (const query of ['SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?', 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?']) { const [rows] = await connection.execute<any[]>(query, [target!.database!]); expect(rows).toHaveLength(0); }
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); expect(digest(ddl)).toBe(definition); expect(digest(rows)).toBe(data);
      expect(created && /^dbark_tablesort_[a-f0-9]{32}$/.test(target!.database!)).toBe(true); await connection.query('DROP DATABASE ' + databaseSql);
    }, true);
    await auxiliary('verify-absence', async connection => { const [databases] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]), [threads] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=? OR ID=?', [target!.database!, preparedThread, cleanupThread]); expect(databases).toHaveLength(0); expect(threads).toHaveLength(0); }, true);
    await info.attach('表数据多列排序', { body: Buffer.from(JSON.stringify({ audit: final, draftPreserved: true, draftRestored: true, fromThirdPage: true, definitionUnchanged: true, fixtureRows: 121, fixtureDataUnchanged: true, databaseRemoved: true, closes })), contentType: 'application/json' });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('排序隔离资源保留', { body: Buffer.from(JSON.stringify({ database: target!.database!, created, automaticCleanup: false, closes })), contentType: 'application/json' }); throw reason; }
});
