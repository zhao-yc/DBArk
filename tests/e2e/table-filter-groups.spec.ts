import { clickSidebarAction } from './sidebar-menu';
import { test as baseTest, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableSortZh as text } from '../../src/renderer/locales/tableSort.zh-CN';
import { tableFilterGroupsZh as groups } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { tablePresetsZh as presets } from '../../src/renderer/locales/tablePresets.zh-CN';
import { tableFilterEnabledZh as enabledText } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_SORT_UI === '1' && process.env.DBARK_TABLE_FILTER_GROUPS_UI === '1';
type Desktop = typeof import('./desktop-fixture');
// 默认和列表不读取认证、不加载桌面；用例自行创建全新隔离库，不接受已有数据库。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_e2e_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表多列排序缺少准确200/13384隔离目标，拒绝启动');
const authorization = active ? ['DBARK_INTEGRATION_ENABLED','DBARK_TABLE_SORT_UI','DBARK_TABLE_FILTER_GROUPS_UI','DBARK_TEST_HOST','DBARK_TEST_PORT','DBARK_TEST_USER','DBARK_TEST_PASSWORD','DBARK_TEST_DATABASE','DBARK_TEST_EXPECTED_SERVER_UUID','DBARK_TEST_TLS','DBARK_TEST_SSH','DBARK_TEST_CA','DBARK_EXECUTABLE_PATH','DBARK_DEV_URL'].map(key => ({ key, present: Object.hasOwn(process.env, key), value: process.env[key] })) : [];
let authorizationInvalid = false;
/** 三门和目标逐步核对；一旦观察漂移，即使环境改回也永久停链。 */
function assertAuthorization(): void {
  if (authorizationInvalid || authorization.some(item => Object.hasOwn(process.env, item.key) !== item.present || process.env[item.key] !== item.value)) { authorizationInvalid = true; throw Error('嵌套筛选原授权已变化，永久停链'); }
}
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.beforeEach(() => { assertAuthorization(); });
test.skip(!active, '默认关闭：须提供本轮RAM认证、DBARK_TABLE_SORT_UI=1及DBARK_TABLE_FILTER_GROUPS_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 观察正式分页及原回包，任何产品写入或SQL正文执行在原handler前拒绝。 */
function observePages({ ipcMain }: { ipcMain: Electron.IpcMain }, expected: { database: string; connectionId: string; senderId: number }) {
  const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request');
  if (typeof original !== 'function' || root.__tableFilterGroupPages) throw Error('排序观察器归属未知');
  const pageRefs = new Set<string>(), pendingTasks = new Set<string>(), cancelledTasks = new Set<string>();
  const state = { pages: [] as any[], pending: 0, writes: 0, releases: 0, cancellations: 0, preferences: 0, presets: { list: 0, save: 0, apply: 0 } }; root.__tableFilterGroupPages = state;
  const wrapped = async (event: any, payload: any) => {
    if (event.sender.id !== expected.senderId || handlers.get('dbark:request') !== wrapped) throw Error('分组筛选原窗口或Main处理器已变化');
    const command = payload.command, input = payload.input;
    const passive = ['settings.get', 'settings.save', 'connections.list', 'connections.open', 'connections.close', 'tasks.list', 'metadata.databases', 'metadata.objects', 'metadata.table'];
    if (command === 'table.preferences.get') {
      if (input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject' || ++state.preferences > 6) throw Error('列偏好读取目标或次数已变化');
      return original(event, payload);
    }
    if (command === 'table.copySourceRelease') {
      if (input.connectionId !== expected.connectionId || typeof input.pageRef !== 'string' || !pageRefs.delete(input.pageRef)) throw Error('不能释放本例未接纳或已消费的复制来源');
      state.releases++; return original(event, payload);
    }
    if (command === 'query.cancel') {
      if (!pendingTasks.has(input.taskId) || cancelledTasks.has(input.taskId)) throw Error('只能取消本轮准确未完成任务一次');
      cancelledTasks.add(input.taskId); state.cancellations++; return original(event, payload);
    }
    if (!passive.includes(command) && command !== 'table.page' && !['table.presets.list', 'table.presets.save', 'table.presets.apply'].includes(command)) { state.writes++; throw Error('本例禁止未授权产品命令'); }
    if (command.startsWith('metadata.') && (input.connectionId !== expected.connectionId || input.database !== undefined && input.database !== expected.database || input.table !== undefined && input.table !== 'subject')) throw Error('元数据目标已变化');
    if (['connections.open', 'connections.close'].includes(command) && input.id !== expected.connectionId) throw Error('连接生命周期目标已变化');
    if (command.startsWith('table.presets.')) {
      if (input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('方案目标已变化');
      const kind = command.slice('table.presets.'.length) as 'list' | 'save' | 'apply';
      if (++state.presets[kind] > (kind === 'list' ? 6 : 1) || kind === 'save' && input.replaceId !== undefined) throw Error('方案次数或覆盖范围已变化');
      if (kind === 'apply') { if (typeof input.taskId !== 'string' || !input.taskId || pendingTasks.has(input.taskId)) throw Error('方案任务身份无效'); pendingTasks.add(input.taskId); }
      state.pending++;
      try { const reply = await original(event, payload); if (reply?.ok !== true) throw Error('正式方案请求未成功'); return reply; }
      finally { state.pending--; if (kind === 'apply') pendingTasks.delete(input.taskId); }
    }
    if (payload.command !== 'table.page') return original(event, payload);
    if (state.pages.length >= 30 || input.connectionId !== expected.connectionId || input.database !== expected.database || input.table !== 'subject') throw Error('分页目标或预算已变化');
    if (typeof input.taskId !== 'string' || !input.taskId || pendingTasks.has(input.taskId)) throw Error('分页任务身份无效');
    pendingTasks.add(input.taskId);
    const entry: any = { input: { page: input.page, pageSize: input.pageSize, filters: structuredClone(input.filters), filterMode: input.filterMode, filterGroup: structuredClone(input.filterGroup), sort: structuredClone(input.sort) } }; state.pages.push(entry); state.pending++;
    try {
      const reply = await original(event, payload); if (reply?.ok !== true || !Array.isArray(reply.result?.rows)) throw Error('正式分页未成功');
      const source = reply.result.copySource;
      if (source?.status === 'ready') { if (typeof source.pageRef !== 'string' || !source.pageRef || pageRefs.has(source.pageRef)) throw Error('复制来源回执无效'); pageRefs.add(source.pageRef); }
      entry.ids = reply.result.rows.map((row: any) => row.id); entry.hasMore = reply.result.hasMore; return reply;
    }
    finally { state.pending--; pendingTasks.delete(input.taskId); }
  };
  handlers.set('dbark:request', wrapped);
  root.__tableFilterGroupOwner = { handlers, wrapped };
}

test('真实表页嵌套筛选：精确值、两页、排序、停用子组及命名方案恢复', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const qualified = '`' + target!.database! + '`.`subject`', databaseSql = '`' + target!.database! + '`', digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let definition = '', data = '', preparedThread = 0, cleanupThread = 0, created = false;
  const closes: { label: string; normal: boolean; streamClosed: boolean }[] = [];
  /** 每条辅助连接都重新核准确服务器和原生关闭；只在原owner仍有效时结算。 */
  async function auxiliary(label: string, action: (connection: import('mysql2/promise').Connection, id: number) => Promise<void>, afterExit = false): Promise<void> {
    const check = () => { assertAuthorization(); const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || !afterExit && current.closed) throw Error('辅助连接原owner失效'); };
    check(); const connection = await mysql.createConnection({ host: target!.host!, port: 13384, user: target!.user, password: target!.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 15000 }), native = (connection as any).connection, stream = native?.stream;
    expect(Boolean(native && stream)).toBe(true); let failure: unknown;
    try { check(); const [rows] = await connection.query<any[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS id'); check(); expect(rows).toHaveLength(1); expect(rows[0].version).toMatch(/^8\.4\.11(?:-|$)/); expect(rows[0].os).toBe('Linux'); expect(Number(rows[0].names)).toBe(0); expect(rows[0].uuid).toBe(target!.uuid); await action(connection, Number(rows[0].id)); check(); }
    catch (reason) { failure = reason; }
    check(); await closeMysqlConnection(native, true, false, 2000); expect(stream.closed).toBe(true); closes.push({ label, normal: true, streamClosed: true }); if (failure) throw failure;
  }
  /** 每步核原TestInfo、App和窗口，失败保留原资源，不重启或补退出。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { assertAuthorization(); const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); assertAuthorization(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  const state = () => step(() => application.evaluate(() => {
    const root = globalThis as any, audit = root.__tableFilterGroupOwner;
    if (!audit || audit.handlers.get('dbark:request') !== audit.wrapped) throw Error('分组筛选Main审计已变化');
    return root.__tableFilterGroupPages as { pages: { input: { page: number; pageSize: number; filters: unknown[]; filterMode: string; filterGroup?: unknown; sort: unknown[] }; ids?: string[]; hasMore?: boolean }[]; pending: number; writes: number; presets: { list: number; save: number; apply: number } };
  }));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await auxiliary('prepare', async (connection, id) => {
      preparedThread = id; const [existing] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]); expect(existing).toHaveLength(0);
      await connection.query('CREATE DATABASE ' + databaseSql + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
      await connection.query('CREATE TABLE ' + qualified + ' (id BIGINT NOT NULL PRIMARY KEY,amount DECIMAL(30,20) NOT NULL,note VARCHAR(200) NULL,bin VARBINARY(4) NULL) ENGINE=InnoDB');
      await connection.query('INSERT INTO ' + qualified + ' VALUES ?', [Array.from({ length: 121 }, (_, index) => [index + 1, index === 59 ? '0.12345678901234567889' : '0.12345678901234567890', '固定原文', Buffer.from([0, 255])])]);
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); definition = digest(ddl); data = digest(rows);
      // 独立SQL只使用固定数学期待，不调用产品筛选/排序生成器计算结果。
      const [expectedRows] = await connection.execute<any[]>('SELECT id FROM ' + qualified + ' WHERE (id<=CAST(? AS SIGNED) OR id>=CAST(? AS SIGNED)) AND amount>=CAST(? AS DECIMAL(30,20)) ORDER BY id', ['60','100','0.12345678901234567890']);
      expect(expectedRows.map(row => String(row.id))).toEqual([...Array.from({length:59},(_,i)=>String(i+1)),...Array.from({length:22},(_,i)=>String(i+100))]);
    });
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }), connectionName = '嵌套筛选本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.database).toBe(target!.database!); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    const browserWindow = await step(() => application.browserWindow(page)); const senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    await step(() => application.evaluate(observePages, { connectionId: profile.id, database: target!.database!, senderId }));
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
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click());
    const filterForm = table.locator('.filter-rule-form'), grouping = table.getByRole('region', { name: groups.title, exact: true });
    /** 正式表单逐条添加；每次只有一次真实分页，分组编辑另外明确应用。 */
    async function addRule(column: string, operator: string, value: string) {
      await step(() => filterForm.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption(column));
      await step(() => filterForm.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption(operator));
      await step(() => filterForm.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(value));
      const count = (await state()).pages.length;
      await step(() => filterForm.getByRole('button', { name: zh.table.text013, exact: true }).click()); await settled(count + 1);
    }
    await addRule('id', '<=', '60'); await addRule('id', '>=', '100'); await addRule('amount', '>=', '0.12345678901234567890');
    expect((await state()).pages.at(-1)?.ids).toEqual([]);
    const beforeGroups = (await state()).pages.length;
    await step(() => table.getByRole('button', { name: groups.open, exact: true }).click());
    await step(() => expect(grouping).toBeVisible());
    await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode(), exact: true })).toHaveValue('all'));
    await step(() => grouping.getByRole('button', { name: groups.addGroup(), exact: true }).click());
    await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode('1'), exact: true })).toHaveValue('any'));
    // 目的地值是内部稳定编号，只按真实可见组名称选择，不能把路径当编号。
    for (const index of [1, 2]) await step(() => grouping.getByRole('combobox', { name: groups.destination(index), exact: true }).selectOption({ label: groups.group('1') }));
    expect((await state()).pages).toHaveLength(beforeGroups);
    await step(() => grouping.getByRole('button', { name: groups.apply, exact: true }).click()); await settled(beforeGroups + 1);
    const first = Array.from({ length: 50 }, (_, i) => String(i + 1));
    const second = [...Array.from({ length: 9 }, (_, i) => String(i + 51)), ...Array.from({ length: 22 }, (_, i) => String(i + 100))];
    expect((await state()).pages.at(-1)?.ids).toEqual(first);
    const filterGroup = (await state()).pages.at(-1)?.input.filterGroup; expect(filterGroup).toBeDefined();
    expect((await state()).pages.at(-1)?.hasMore).toBe(true); await step(() => expect(cell(2, 2)).toHaveText('1'));
    let count = (await state()).pages.length;
    await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(count + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(second); expect((await state()).pages.at(-1)?.hasMore).toBe(false);
    // 第二页应用两级排序必须回首页；精确边界id60继续排除。
    count = (await state()).pages.length; await open(); await click(text.add); await choose(text.field(1), 'amount'); await click(text.add); await choose(text.field(2), 'id'); await choose(text.direction(2), 'DESC'); await click(text.apply); await settled(count + 1);
    const ordered = [...Array.from({ length: 22 }, (_, i) => String(121 - i)), ...Array.from({ length: 28 }, (_, i) => String(59 - i))];
    const sort = [{ column: 'amount', direction: 'ASC' }, { column: 'id', direction: 'DESC' }];
    expect((await state()).pages.at(-1)?.ids).toEqual(ordered); expect((await state()).pages.at(-1)?.input).toMatchObject({ page: 1, filterGroup, sort });
    count = (await state()).pages.length; await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(count + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(Array.from({ length: 31 }, (_, i) => String(31 - i)));
    // 停用两个OR叶应省略该子组，不将空OR误当false；逐叶动作各核一次真实读取。
    for (const index of [1, 2]) { count = (await state()).pages.length; await step(() => table.getByRole('checkbox', { name: enabledText.enabled(index), exact: true }).uncheck()); await settled(count + 1); }
    expect((await state()).pages.at(-1)?.ids).toEqual(Array.from({ length: 50 }, (_, i) => String(121 - i)));
    for (const index of [1, 2]) { count = (await state()).pages.length; await step(() => table.getByRole('checkbox', { name: enabledText.enabled(index), exact: true }).check()); await settled(count + 1); }
    expect((await state()).pages.at(-1)?.ids).toEqual(ordered);
    // 方案仅经本机实际控件保存、关闭重开后领取新来源；不直接读写SQLite。
    const shelf = table.getByRole('region', { name: presets.title, exact: true }), presetName = '本例嵌套条件与排序';
    await step(() => shelf.getByRole('textbox', { name: presets.name, exact: true }).fill(presetName));
    await step(() => shelf.getByRole('button', { name: presets.save, exact: true }).click()); await step(() => expect(shelf).toContainText(presets.saved));
    count = (await state()).pages.length; await step(() => table.getByRole('button', { name: zh.common.clearAll, exact: true }).click()); await settled(count + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(['60', ...Array.from({ length: 49 }, (_, i) => String(121 - i))]);
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click());
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click());
    await step(() => shelf.getByRole('combobox', { name: presets.choose, exact: true }).selectOption({ label: presetName }));
    count = (await state()).pages.length; await step(() => shelf.getByRole('button', { name: presets.apply, exact: true }).click()); await settled(count + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(ordered); expect((await state()).pages.at(-1)?.input).toMatchObject({ filterGroup, sort });
    await step(() => table.getByRole('button', { name: groups.open, exact: true }).click());
    await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode(), exact: true })).toHaveValue('all'));
    await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode('1'), exact: true })).toHaveValue('any'));
    await step(() => grouping.getByRole('button', { name: groups.cancel, exact: true }).click());
    const final = await state(); expect(final.writes).toBe(0); expect(final.pending).toBe(0); expect(final.presets.save).toBe(1); expect(final.presets.apply).toBe(1); expect(final.presets.list).toBeGreaterThanOrEqual(2); expect(runtime.pageErrors).toEqual([]); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);

    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    await auxiliary('cleanup', async (connection, id) => {
      cleanupThread = id; const [active] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=?', [target!.database!, preparedThread]); expect(active).toHaveLength(0);
      const [objects] = await connection.execute<any[]>('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target!.database!]); expect(objects.map(row => [row.TABLE_NAME, row.TABLE_TYPE])).toEqual([['subject', 'BASE TABLE']]);
      for (const query of ['SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?', 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?']) { const [rows] = await connection.execute<any[]>(query, [target!.database!]); expect(rows).toHaveLength(0); }
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(121); expect(digest(ddl)).toBe(definition); expect(digest(rows)).toBe(data);
      expect(created && /^dbark_e2e_[a-f0-9]{32}$/.test(target!.database!)).toBe(true); await connection.query('DROP DATABASE ' + databaseSql);
    }, true);
    await auxiliary('verify-absence', async connection => { const [databases] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]), [threads] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=? OR ID=?', [target!.database!, preparedThread, cleanupThread]); expect(databases).toHaveLength(0); expect(threads).toHaveLength(0); }, true);
    await info.attach('表数据嵌套筛选', { body: Buffer.from(JSON.stringify({ audit: final, nestedFilterVerified: true, preciseBoundaryExcluded: true, secondPageVerified: true, disabledSubgroupOmitted: true, presetReopened: true, definitionUnchanged: true, fixtureRows: 121, fixtureDataUnchanged: true, databaseRemoved: true, closes })), contentType: 'application/json' });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('分组筛选隔离资源保留', { body: Buffer.from(JSON.stringify({ database: target!.database!, created, automaticCleanup: false, closes })), contentType: 'application/json' }); throw reason; }
});
