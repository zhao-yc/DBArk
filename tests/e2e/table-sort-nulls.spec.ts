import { clickSidebarAction } from './sidebar-menu';
import { test as baseTest, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableSortZh as text } from '../../src/renderer/locales/tableSort.zh-CN';
import { tablePresetsZh as presetText } from '../../src/renderer/locales/tablePresets.zh-CN';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_SORT_NULLS_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认和列表不读取认证、不加载桌面；用例自行创建全新隔离库，不接受已有数据库。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_nullsort_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表NULL排序缺少准确200/13384隔离目标，拒绝启动');
test.skip(!active, '默认关闭：须提供本轮RAM认证及DBARK_TABLE_SORT_NULLS_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 观察正式分页及原回包，任何产品写入或SQL正文执行在原handler前拒绝。 */
function observePages({ ipcMain }: { ipcMain: Electron.IpcMain }, expected: { database: string; connectionId: string }) {
  const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
  if (typeof original !== 'function' || root.__tableSortPages) throw Error('排序观察器归属未知');
  const state = { pages: [] as any[], presets: [] as any[], pending: 0, writes: 0 }; root.__tableSortPages = state;
  handlers.set('dbark:request', async (event: any, payload: any) => {
    if (/^(?:query\.execute|query\.transaction|schema\.|files\.import|excel\.import|result\.insert|table\.(?:apply|preview|filteredUpdate\.|filteredDelete\.|copyData\.))/.test(payload.command)) { state.writes++; throw Error('本例禁止产品写入及正文执行'); }
    if (payload.command.startsWith('table.presets.')) {
      const input = payload.input;
      if (!['table.presets.list', 'table.presets.save', 'table.presets.apply'].includes(payload.command) || input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('方案命令或准确目标变化');
      if (payload.command === 'table.presets.save' && (state.presets.some((item: any) => item.command === 'table.presets.save') || input.name !== 'NULL位置原方案' || JSON.stringify(input.configuration.sort) !== JSON.stringify([{ column: 'note', direction: 'DESC', nulls: 'LAST' }]) || input.configuration.filters.length !== 0)) throw Error('本例仅允许准确本机方案保存');
      state.pending++; try { const reply = await original(event, payload); if (reply?.ok !== true) throw Error('原本机方案请求未成功'); state.presets.push({ command: payload.command, name: input.name, configuration: payload.command === 'table.presets.save' ? structuredClone(input.configuration) : payload.command === 'table.presets.apply' ? structuredClone(reply.result) : undefined }); return reply; } finally { state.pending--; }
    }
    if (payload.command !== 'table.page') return original(event, payload);
    const input = payload.input;
    if (state.pages.length >= 32 || input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('分页目标或预算已变化');
    const entry: any = { input: { page: input.page, pageSize: input.pageSize, filters: structuredClone(input.filters), filterMode: input.filterMode, sort: structuredClone(input.sort) } }; state.pages.push(entry); state.pending++;
    try { const reply = await original(event, payload); if (reply?.ok !== true || !Array.isArray(reply.result?.rows)) throw Error('正式分页未成功'); entry.ids = reply.result.rows.map((row: any) => row.id); entry.hasMore = reply.result.hasMore; return reply; }
    finally { state.pending--; }
  });
}

test('真实表浏览NULL四组合全121行、优先级/列头/取消草稿与命名方案恢复', async ({ trace, screenshot, video }, info) => {
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
  const state = () => step(() => application.evaluate(() => (globalThis as any).__tableSortPages as { pages: { input: { page: number; pageSize: number; filters: unknown[]; filterMode: string; sort: unknown[] }; ids?: string[]; hasMore?: boolean }[]; presets: { command: string; name?: string; configuration?: unknown }[]; pending: number; writes: number }));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await auxiliary('prepare', async (connection, id) => {
      preparedThread = id; const [existing] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]); expect(existing).toHaveLength(0);
      await connection.query('CREATE DATABASE ' + databaseSql + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
      await connection.query('CREATE TABLE ' + qualified + ' (id BIGINT NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,note VARCHAR(200) NULL,bin VARBINARY(4) NULL,big_value BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB');
      await connection.query('INSERT INTO ' + qualified + ' VALUES ?', [Array.from({ length: 121 }, (_, index) => { const id = index + 1; return [id, '9007199254740993.123456789012', [1, 61, 121].includes(id) ? null : [2, 62].includes(id) ? '' : id % 2 === 0 ? 'A' : 'B', Buffer.from([0, 255]), '18446744073709551615']; })]);
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); definition = digest(ddl); data = digest(rows);
    });
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }), connectionName = '多列排序本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.database).toBe(target!.database!); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    await step(() => application.evaluate(observePages, { connectionId: profile.id, database: target!.database! }));
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => clickSidebarAction(connection, { name: zh.sidebar.text011, exact: true })); await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click()); await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const table = page.locator('.table-tab:visible'), grid = table.locator('.results-grid'), panel = table.getByRole('region', { name: text.title, exact: true });
    const cell = (row: number, column: number) => grid.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${column}"]`);
    const choose = (label: string, value: string) => step(() => panel.getByRole('combobox', { name: label, exact: true }).selectOption(value));
    const open = () => step(() => table.getByRole('button', { name: text.entry, exact: true }).click());
    const click = (name: string) => step(() => panel.getByRole('button', { name, exact: true }).click());
    /** 等待本例一次正式回包及加载收尾，不把旧页面当成新排序结果。 */
    async function settled(count?: number) { if (count !== undefined) await step(() => expect.poll(async () => (await state()).pages.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids !== undefined).toBe(true)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); if (count !== undefined) expect((await state()).pages).toHaveLength(count); }
    await step(() => expect(cell(2, 2)).toHaveText('1')); await settled();
    await step(() => table.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids?.length).toBe(50)); await settled();
    await step(() => expect(cell(2, 3)).toHaveText('9007199254740993.123456789012')); await step(() => expect(cell(2, 6)).toHaveText('18446744073709551615'));
    // 期望独立手工分桶：NULL、空串、A、B；组内仅按可靠id原值顺序，不调用产品排序器或SQL生成器。
    const all = Array.from({ length: 121 }, (_, index) => index + 1), nullIds = [1, 61, 121], emptyIds = [2, 62];
    const aIds = all.filter(id => !nullIds.includes(id) && !emptyIds.includes(id) && id % 2 === 0), bIds = all.filter(id => !nullIds.includes(id) && !emptyIds.includes(id) && id % 2 !== 0);
    const expected = (direction: 'ASC' | 'DESC', nulls: 'FIRST' | 'LAST', keyDirection: 'ASC' | 'DESC' = 'DESC') => {
      const order = (ids: number[]) => keyDirection === 'DESC' ? [...ids].reverse() : [...ids];
      const values = (direction === 'ASC' ? [emptyIds, aIds, bIds] : [bIds, aIds, emptyIds]).flatMap(order), missing = order(nullIds);
      return (nulls === 'FIRST' ? [...missing, ...values] : [...values, ...missing]).map(String);
    };
    /** 每次next必须产生一条准确正式分页；三页拼接后核全121且无重叠、无漏行。 */
    async function verifyAllPages(ids: string[], count: number, rules: unknown[]) {
      await settled(count); const actual: string[] = [];
      for (let pageIndex = 1; pageIndex <= 3; pageIndex++) {
        if (pageIndex > 1) { await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(++count); }
        const current = (await state()).pages.at(-1)!; expect(current.input).toMatchObject({ page: pageIndex, pageSize: 50, filters: [], sort: rules });
        expect(current.ids).toEqual(ids.slice((pageIndex - 1) * 50, pageIndex * 50)); expect(current.hasMore).toBe(pageIndex !== 3); actual.push(...current.ids!);
        for (const [position, id] of current.ids!.slice(0, 3).entries()) await step(() => expect(cell(position + 2, 2)).toHaveText(id));
      }
      expect(actual).toEqual(ids); expect(new Set(actual).size).toBe(121); await step(() => expect(table.getByRole('button', { name: zh.common.pageNext, exact: true })).toBeDisabled());
    }
    for (const [direction, nulls] of [['ASC', 'FIRST'], ['ASC', 'LAST'], ['DESC', 'FIRST'], ['DESC', 'LAST']] as const) {
      const before = (await state()).pages.length; await open(); await click(text.clear); await click(text.add); await choose(text.field(1), 'note'); await choose(text.direction(1), direction); await choose(text.nulls(1), nulls); await click(text.add); await choose(text.field(2), 'id'); await choose(text.direction(2), 'DESC');
      await step(() => expect(panel.getByRole('combobox', { name: text.nulls(1), exact: true })).toHaveValue(nulls)); expect((await state()).pages).toHaveLength(before);
      await click(text.apply); await step(() => expect(panel).toBeHidden()); const rules = [{ column: 'note', direction, nulls }, { column: 'id', direction: 'DESC' }]; await verifyAllPages(expected(direction, nulls), before + 1, rules);
    }
    // 回第一页，真实编辑一条非NULL记录；取消排序只撤销排序草稿，不重读也不丢网格草稿。
    const beforeJump = (await state()).pages.length; await step(() => table.getByRole('textbox', { name: zh.table.pageJumpLabel, exact: true }).fill('1')); await step(() => table.locator('.page-jump').getByRole('button', { name: zh.table.pageJump, exact: true }).click()); await settled(beforeJump + 1);
    const first = expected('DESC', 'LAST')[0]; await step(() => expect(cell(2, 2)).toHaveText(first)); const note = cell(2, 4), editor = table.locator('.grid-input'); await step(() => expect(note).toHaveText('B'));
    await step(() => note.dblclick()); await step(() => editor.fill('保留本页草稿')); await step(() => editor.press('Enter')); await step(() => expect(editor).toHaveCount(0));
    const beforeCancel = (await state()).pages.length, originalSort = (await state()).pages.at(-1)!.input.sort;
    await open(); await choose(text.direction(1), 'ASC'); await step(() => expect(panel.getByRole('combobox', { name: text.nulls(1), exact: true })).toHaveValue('LAST')); await choose(text.nulls(1), 'FIRST'); await click(text.cancel); await step(() => expect(panel).toBeHidden());
    expect((await state()).pages).toHaveLength(beforeCancel); expect((await state()).pages.at(-1)!.input.sort).toEqual(originalSort); await step(() => expect(note).toHaveText('保留本页草稿'));
    await step(() => note.dblclick()); await step(() => editor.fill('B')); await step(() => editor.press('Enter')); await step(() => expect(editor).toHaveCount(0)); await step(() => expect(table.getByRole('button', { name: zh.table.text018, exact: true })).toHaveCount(0));
    // 提高第二条id优先级后，原note变第二条；改方向不丢其NULL位置。
    await open(); await click(text.earlier(2)); await step(() => expect(panel.getByRole('combobox', { name: text.field(2), exact: true })).toHaveValue('note')); await step(() => expect(panel.getByRole('combobox', { name: text.nulls(2), exact: true })).toHaveValue('LAST'));
    await choose(text.direction(2), 'ASC'); await step(() => expect(panel.getByRole('combobox', { name: text.nulls(2), exact: true })).toHaveValue('LAST')); const beforePriority = (await state()).pages.length; await click(text.apply); await settled(beforePriority + 1);
    expect((await state()).pages.at(-1)!.input.sort).toEqual([{ column: 'id', direction: 'DESC' }, { column: 'note', direction: 'ASC', nulls: 'LAST' }]); expect((await state()).pages.at(-1)!.ids).toEqual(all.slice().reverse().slice(0, 50).map(String));
    // 原note列头把同列ASC改DESC，表格只传方向时仍须保留同列LAST；可靠id回到默认ASC。
    const beforeHeader = (await state()).pages.length; await step(() => grid.locator('[role="columnheader"][aria-colindex="4"]').click()); await settled(beforeHeader + 1);
    expect((await state()).pages.at(-1)!.input.sort).toEqual([{ column: 'note', direction: 'DESC', nulls: 'LAST' }]); expect((await state()).pages.at(-1)!.ids).toEqual(expected('DESC', 'LAST', 'ASC').slice(0, 50));
    await open(); await step(() => expect(panel.getByRole('combobox', { name: text.nulls(1), exact: true })).toHaveValue('LAST')); await click(text.cancel);
    // 命名方案仅保存本机排序配置；不把table.presets.save误认成产品数据库DML。
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click()); const presets = table.getByRole('region', { name: presetText.title, exact: true });
    await step(() => presets.getByRole('textbox', { name: presetText.name, exact: true }).fill('NULL位置原方案')); await step(() => expect(presets.getByRole('button', { name: presetText.save, exact: true })).toBeEnabled());
    const beforeSave = (await state()).pages.length; await step(() => presets.getByRole('button', { name: presetText.save, exact: true }).click()); await step(() => expect(presets).toContainText(presetText.saved)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); expect((await state()).pages).toHaveLength(beforeSave);
    await open(); await click(text.clear); await click(text.apply); await settled(beforeSave + 1); expect((await state()).pages.at(-1)!.input.sort).toEqual([]);
    await step(() => presets.getByRole('combobox', { name: presetText.choose, exact: true }).selectOption({ label: 'NULL位置原方案' })); const beforeRestore = (await state()).pages.length; await step(() => presets.getByRole('button', { name: presetText.apply, exact: true }).click()); await settled(beforeRestore + 1);
    expect((await state()).pages.at(-1)!.input.sort).toEqual([{ column: 'note', direction: 'DESC', nulls: 'LAST' }]); expect((await state()).pages.at(-1)!.ids).toEqual(expected('DESC', 'LAST', 'ASC').slice(0, 50)); await open(); await step(() => expect(panel.getByRole('combobox', { name: text.nulls(1), exact: true })).toHaveValue('LAST')); await click(text.cancel);
    expect((await state()).presets.filter(item => item.command === 'table.presets.save')).toHaveLength(1); expect((await state()).presets.filter(item => item.command === 'table.presets.apply')).toHaveLength(1);
    const final = await state(); expect(final.writes).toBe(0); expect(final.pending).toBe(0); expect(runtime.pageErrors).toEqual([]); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);

    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    await auxiliary('cleanup', async (connection, id) => {
      cleanupThread = id; const [active] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=?', [target!.database!, preparedThread]); expect(active).toHaveLength(0);
      const [objects] = await connection.execute<any[]>('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target!.database!]); expect(objects.map(row => [row.TABLE_NAME, row.TABLE_TYPE])).toEqual([['subject', 'BASE TABLE']]);
      for (const query of ['SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?', 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?']) { const [rows] = await connection.execute<any[]>(query, [target!.database!]); expect(rows).toHaveLength(0); }
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); expect(digest(ddl)).toBe(definition); expect(digest(rows)).toBe(data);
      expect(created && /^dbark_nullsort_[a-f0-9]{32}$/.test(target!.database!)).toBe(true); await connection.query('DROP DATABASE ' + databaseSql);
    }, true);
    await auxiliary('verify-absence', async connection => { const [databases] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]), [threads] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=? OR ID=?', [target!.database!, preparedThread, cleanupThread]); expect(databases).toHaveLength(0); expect(threads).toHaveLength(0); }, true);
    await info.attach('表数据多列排序', { body: Buffer.from(JSON.stringify({ audit: final, nullCombinations: 4, exactIdsAcrossAllPages: 121, headerPreservedNulls: true, presetRestoredNulls: true, draftPreserved: true, draftRestored: true, definitionUnchanged: true, fixtureRows: 121, fixtureDataUnchanged: true, databaseRemoved: true, closes })), contentType: 'application/json' });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('排序隔离资源保留', { body: Buffer.from(JSON.stringify({ database: target!.database!, created, automaticCleanup: false, closes })), contentType: 'application/json' }); throw reason; }
});
