import { test as baseTest } from '@playwright/test';

// 默认及/list只登记skip；不加载桌面、数据库驱动、SQLite或认证。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_DATABASE_SWITCH_UI === '1') register();
else baseTest.skip('显式切换默认库原生专项默认关闭（资源操作尚需另行授权）', () => {});

/** 新建双库专项只在双门及准确200绑定后注册；不复用其它专项的资源授权。 */
function register(): void {
  const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_DATABASE_SWITCH_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_EXECUTABLE_PATH'] as const;
  const fixed = Object.fromEntries(keys.map(key => [key, process.env[key]])); let stopped = false;
  const uuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
  /** 每个await两侧保持原RAM认证及目标绑定，失败不能重新授权或换目标。 */
  function binding(): void {
    if (stopped || process.platform !== 'win32' || fixed.DBARK_INTEGRATION_ENABLED !== '1' || fixed.DBARK_DATABASE_SWITCH_UI !== '1' || fixed.DBARK_TEST_HOST !== '192.168.31.200' || fixed.DBARK_TEST_PORT !== '13384' || fixed.DBARK_TEST_TLS !== '0' || !fixed.DBARK_TEST_USER || typeof fixed.DBARK_TEST_PASSWORD !== 'string' || fixed.DBARK_TEST_EXPECTED_SERVER_UUID !== uuid || keys.some(key => process.env[key] !== fixed[key]) || ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'DBARK_TEST_DATABASE'].some(key => !!process.env[key])) { stopped = true; throw Error('切库专项目标、双门或原RAM绑定已失效'); }
  }
  binding();
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = desktop;
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise');
  const { randomUUID, randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const { readFile } = require('node:fs/promises') as typeof import('node:fs/promises'), { join } = require('node:path') as typeof import('node:path');
  const { queryDatabaseSwitchZh: text } = require('../../src/renderer/locales/queryDatabaseSwitch.zh-CN') as typeof import('../../src/renderer/locales/queryDatabaseSwitch.zh-CN');
  const { queryResultFilterZh: filterText } = require('../../src/renderer/locales/queryResultFilter.zh-CN') as typeof import('../../src/renderer/locales/queryResultFilter.zh-CN');
  const { queryResultSortZh: sortText } = require('../../src/renderer/locales/queryResultSort.zh-CN') as typeof import('../../src/renderer/locales/queryResultSort.zh-CN');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: { assertCurrent: binding } });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let complete = false;
  test.afterEach(({}, info) => { if (!complete) { stopped = true; desktop.retainOwnedDesktopResources(info); throw Error('切库专项未完成原owner正常收尾，保留App、profile及双库，不重跑或补清理'); } });

  test('真实切库保留原查询、结果整理、物理连接、事务与临时表并保存实际B库', async ({ trace, screenshot, video }, info) => {
    const owner = desktop.ownedDesktopResources(info), application = owner.application, page = owner.page, directory = desktop.dataDir, child = application.process();
    const nonce = randomBytes(6).toString('hex'), a = 'dbark_dbswitch_' + nonce + '_a', b = 'dbark_dbswitch_' + nonce + '_b';
    const profileId = 'database-switch-' + randomUUID(), tabId = 'database-switch-tab-' + randomUUID();
    const sql = 'SELECT id,value,CONNECTION_ID() AS session_id,DATABASE() AS actual_db FROM subject ORDER BY id';
    const suffix = ' /* DBARK_DBSWITCH_UNDO */', originalSql = sql + suffix;
    const setupSql = `CREATE TEMPORARY TABLE \`${a}\`.marker(n INT);INSERT INTO \`${a}\`.marker VALUES(73);BEGIN;INSERT INTO \`${a}\`.subject(id,value) VALUES(19,'A-uncommitted')`;
    const diagnosticSql = `SELECT CONNECTION_ID() AS session_id,DATABASE() AS actual_db,(SELECT n FROM \`${a}\`.marker) AS marker,(SELECT COUNT(*) FROM \`${a}\`.subject WHERE id=19) AS own_pending`;
    let closed = false, armed = false, observer: import('mysql2/promise').Connection | undefined, observerEnded = false, observerClosed = false;
    const deadline = Date.now() + info.timeout, created: string[] = [];
    type SwitchOutput = import('../../src/shared/queryDatabaseSwitch').QueryDatabaseSwitchOutput;
    type QueryOutcome = import('../../src/shared/contracts').QueryOutcome;
    type Call = { command: string; input?: unknown; ok?: boolean; result?: unknown };
    type Audit = { pending: number; session: string | null; forbidden: number; switches: number; calls: Call[] };
    /** 原owner/profile/单次期限永久绑定；正常关闭后仍核同一所有者才允许清理本例资源。 */
    function check(): void {
      binding(); const current = desktop.ownedDesktopResources(info);
      if (current.application !== application || current.page !== page || current.closed !== closed || desktop.dataDir !== directory || !closed && application.process() !== child || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.timeout !== 120000 || Date.now() >= deadline) throw Error('切库原owner、profile或单次期限已变化');
    }
    const audit = (): Promise<Audit> => application.evaluate(() => { const state = (globalThis as any).__databaseSwitchNativeAudit; state.check(); return { pending: state.pending, session: state.session, forbidden: state.forbidden, switches: state.switches, calls: state.calls }; });
    async function step<T>(action: () => Promise<T>): Promise<T> { check(); if (armed) { expect((await audit()).forbidden).toBe(0); check(); } const value = await action(); check(); if (armed) { expect((await audit()).forbidden).toBe(0); check(); } return value; }
    const query = () => page.locator('.query-tab:visible'), editor = () => query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox');
    const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    const ledger = () => step(() => page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })));
    /** 单个SQL动作走原Main并保留原回包；仅诊断与准备使用此入口，真正切库必须点击UI。 */
    async function originalQuery(statement: string): Promise<QueryOutcome> {
      const state = await step(audit); if (!state.session) throw Error('原会话尚未建立');
      const result = await step(() => page.evaluate(value => window.dbark.invoke('query.execute', value), { sessionId: state.session!, taskId: randomUUID(), sql: statement, maxRows: 100 }));
      expect(result.failure).toBeUndefined(); expect(result.scriptReport?.errors ?? []).toEqual([]); return result;
    }
    /** 只用键盘编辑正文，不调用模型写入接口或系统剪贴板。 */
    async function write(statement: string): Promise<void> { await step(() => editor().focus()); await step(() => page.keyboard.press('Control+A')); await step(() => page.keyboard.insertText(statement)); await step(() => expect.poll(async () => (await settings()).tabs.find(tab => tab.id === tabId)?.sql).toBe(statement)); }
    /** 显式UI执行一次，原Main回包、任务与可见网格均须完成。 */
    async function execute(): Promise<QueryOutcome> {
      const before = (await step(audit)).calls.filter(call => call.command === 'query.execute').length;
      await step(async () => (await navigationMenuItem(query(), { name: '执行全部', exact: true })).click());
      await step(() => expect.poll(async () => (await audit()).calls.filter(call => call.command === 'query.execute').length).toBe(before + 1));
      await step(async () => expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled());
      await step(() => expect(query().locator('.error-box')).toHaveCount(0));
      const calls = (await step(audit)).calls.filter(call => call.command === 'query.execute'), last = calls.at(-1)!;
      expect(last.ok).toBe(true); const result = last.result as QueryOutcome; expect(result.failure).toBeUndefined(); expect(result.scriptReport?.errors ?? []).toEqual([]); return result;
    }
    /** 官方Monaco只读getter配独立WeakMap核模型身份，不访问React私有属性。 */
    const model = () => step(() => page.evaluate(() => {
      type Api = typeof import('monaco-editor');
      const root = window as Window & { monaco?: Api; __databaseSwitchModelIds?: { ids: WeakMap<object, number>; next: number } };
      const editors = root.monaco?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab .sql-editor-wrap') && node.getClientRects().length > 0; });
      if (editors?.length !== 1) throw Error('切库官方Monaco观察接口或可见编辑器不唯一');
      const editor = editors[0], value = editor.getModel(); if (!value || value.isDisposed()) throw Error('切库原模型未知');
      const registry = root.__databaseSwitchModelIds ??= { ids: new WeakMap(), next: 0 };
      const id = (object: object) => { if (!registry.ids.has(object)) registry.ids.set(object, ++registry.next); return registry.ids.get(object)!; };
      return { editor: id(editor), model: id(value), uri: value.uri.toString(), value: value.getValue(), version: value.getVersionId(), alternativeVersion: value.getAlternativeVersionId(), selections: editor.getSelections()?.map(selection => ({ startLineNumber: selection.startLineNumber, startColumn: selection.startColumn, endLineNumber: selection.endLineNumber, endColumn: selection.endColumn, positionLineNumber: selection.positionLineNumber, positionColumn: selection.positionColumn })) };
    }));
    const view = () => step(async () => ({ body: await query().locator('.result-body').innerText(), ids: await query().locator('.result-body [role="gridcell"][aria-colindex="2"]').allTextContents(), sorts: await query().getByRole('list', { name: sortText.priorities, exact: true }).innerText(), filter: await query().locator('.query-result-filter-bar > span').first().innerText() }));
    /** Main原handler透传；只审计原session及切库命令，不声称覆盖底层驱动全部SQL。 */
    async function installAudit(): Promise<void> {
      await step(() => application.evaluate(({ ipcMain, BrowserWindow }, expected) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], contents = window?.webContents;
        if (root.__databaseSwitchNativeAudit || !(handlers instanceof Map) || typeof previous !== 'function' || BrowserWindow.getAllWindows().length !== 1 || !window || window.isDestroyed()) throw Error('切库Main原入口未知');
        const state = { pending: 0, session: null as string | null, forbidden: 0, switches: 0, calls: [] as Call[], check() {}, restore() {} };
        const forward = async function (this: unknown, event: any, request: any) {
          state.check(); const command = request?.command, input = request?.input;
          if (['connections.open', 'connections.close'].includes(command) && input?.id !== expected.profileId) { state.forbidden++; throw Error('切库拒绝其它profile的连接操作'); }
          if (typeof command === 'string' && command.startsWith('metadata.') && input?.connectionId !== undefined && input.connectionId !== expected.profileId) { state.forbidden++; throw Error('切库拒绝其它profile的目录操作'); }
          if (command === 'sessions.open' && (state.session || input?.connectionId !== expected.profileId || input.database !== expected.a)) { state.forbidden++; throw Error('切库拒绝替代session'); }
          if (command === 'query.execute' && (!state.session || input?.sessionId !== state.session || !expected.statements.includes(input?.sql))) { state.forbidden++; throw Error('切库拒绝原会话及固定专项SQL之外的执行'); }
          if (command === 'query.transaction' && (!state.session || input?.sessionId !== state.session || input?.action !== 'rollback')) { state.forbidden++; throw Error('切库仅允许原session的显式回滚'); }
          if (command === 'query.databaseSwitch') {
            if (!state.session || input?.sessionId !== state.session || input?.database !== expected.b || typeof input.taskId !== 'string' || state.switches !== 0) { state.forbidden++; throw Error('切库不是原会话的一次正式选择'); }
            state.switches++;
          }
          const recorded = ['sessions.open', 'query.execute', 'query.databaseSwitch', 'query.transaction', 'metadata.completion', 'query.temporaryCompletion'].includes(command);
          const row: Call = { command, ...(recorded ? { input: structuredClone(input) } : {}) };
          if (recorded) state.calls.push(row); state.pending++;
          try {
            const reply: unknown = await Reflect.apply(previous, this, [event, request]);
            row.ok = !!reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true;
            if (row.ok && reply && typeof reply === 'object' && 'result' in reply) {
              if (command === 'sessions.open') { const result = reply.result as any; if (typeof result?.sessionId !== 'string' || !result.sessionId) throw Error('切库原session回包未知'); state.session = result.sessionId; }
              if (recorded) row.result = structuredClone(reply.result);
            }
            return reply;
          } finally { state.pending--; }
        };
        state.check = () => { if (root.__databaseSwitchNativeAudit !== state || handlers.get('dbark:request') !== forward || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || window.isDestroyed() || window.webContents !== contents) throw Error('切库原Map或窗口归属变化'); };
        state.restore = () => { state.check(); if (state.pending) throw Error('切库原Main请求未终结'); handlers.set('dbark:request', previous); delete root.__databaseSwitchNativeAudit; };
        root.__databaseSwitchNativeAudit = state; handlers.set('dbark:request', forward); state.check();
      }, { profileId, a, b, statements: [sql, originalSql, setupSql, diagnosticSql] })); armed = true;
    }
    /** 恢复后立即撤销本地标记，不能再经step读取已删除的Main审计状态。 */
    async function restoreAudit(): Promise<void> {
      check(); const before = await audit(); check(); expect(before.forbidden).toBe(0); expect(before.pending).toBe(0);
      await application.evaluate(() => (globalThis as any).__databaseSwitchNativeAudit.restore()); armed = false; check();
    }
    /** 所有服务器资源SQL先核本例随机名称，绝不操作候选目录中的其它库。 */
    function resourceNames(): void { if (!/^dbark_dbswitch_[a-f0-9]{12}_a$/u.test(a) || b !== a.slice(0, -1) + 'b' || a === b) throw Error('切库双库资源归属未知'); }
    const connect = () => mysql.createConnection({ host: fixed.DBARK_TEST_HOST!, port: 13384, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000 });
    /** 固定身份诊断先于任何CREATE/DROP；只接受准确200 MySQL8.4.11 Linux实例。 */
    async function identity(connection: import('mysql2/promise').Connection): Promise<void> {
      const [rows] = await step(() => connection.query<import('mysql2/promise').RowDataPacket[]>('SELECT @@server_uuid AS uuid,@@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,DATABASE() AS currentDatabase,CONNECTION_ID() AS connectionId'));
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ uuid, currentDatabase: null }); expect(rows[0].version).toMatch(/^8\.4\.11(?:[-+]|$)/u); expect(String(rows[0].os).toLowerCase()).toMatch(/^(linux|debian-linux-gnu)$/u); expect([0, '0']).toContain(rows[0].lowerNames);
      const native = (connection as any).connection; if (!native || !Number.isSafeInteger(native.threadId) || native.threadId < 1 || Number(rows[0].connectionId) !== native.threadId) throw Error('切库观察连接物理身份未知');
    }
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); resourceNames();
      const empty = await step(() => page.evaluate(async () => ({ connections: (await window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))).length, settings: await window.dbark.invoke('settings.get', {}), ledger: [(await window.dbark.invoke('tasks.list', {})).length, (await window.dbark.invoke('history.list', {})).length] })));
      expect(empty.connections).toBe(0); expect(empty.settings.tabs).toEqual([]); expect(empty.ledger).toEqual([0, 0]);
      // 仅空工作台启用现有Monaco官方全局观察API，之后不再reload或替换模型。
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
      await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
      expect(await step(() => page.evaluate(() => typeof (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors))).toBe('function');
      observer = await step(connect); await identity(observer);
      const native = (observer as any).connection, stream = native.stream; if (!stream || typeof stream.once !== 'function') throw Error('切库观察连接物理流未知');
      const observedClose = new Promise<void>(resolve => stream.once('close', () => { observerClosed = true; resolve(); }));
      // 首次服务器写入前持久登记精确资源归属；只记录计划与身份，不伪报创建或正常收尾。
      await step(() => info.attach('切库专项首写前安全资源清单', { body: Buffer.from(JSON.stringify({ databases: [a, b], profileId, tabId, port: 13384, serverUuid: uuid, observerThreadId: String(native.threadId) })), contentType: 'application/json' }));
      for (const [database, label, extra] of [[a, 'A', 'a_only'], [b, 'B', 'b_only']]) {
        resourceNames(); await step(() => observer!.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`)); created.push(database);
        await step(() => observer!.query(`CREATE TABLE \`${database}\`.subject(id INT PRIMARY KEY,value VARCHAR(40),\`${extra}\` INT) ENGINE=InnoDB`));
        await step(() => observer!.query(`INSERT INTO \`${database}\`.subject(id,value) VALUES(1,?),(2,?),(3,?)`, [label + '-one', label + '-two', label + '-three']));
      }
      // 准备专用临时profile/settings，口令remember=false只进RAM；不声称连接表单验收。
      await step(() => page.evaluate(async value => {
        const profile = await window.dbark.invoke('connections.save', { id: value.profileId, name: '切库专项临时连接', dialect: 'mysql', host: value.host, port: 13384, user: value.user, password: value.password, rememberPassword: false, database: value.a, group: '', color: '#345678' }).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; });
        if (profile.rememberPassword !== false || profile.password !== undefined) throw Error('切库临时profile口令策略不符');
        const settings = await window.dbark.invoke('settings.get', {}); await window.dbark.invoke('settings.save', { ...settings, activeTabId: value.tabId, tabs: [{ id: value.tabId, kind: 'query', title: '切库专项查询', connectionId: profile.id, database: value.a, databaseContext: { state: 'known', database: value.a }, sql: value.sql }] });
      }, { profileId, tabId, a, sql, host: fixed.DBARK_TEST_HOST!, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD! }));
      await step(() => page.reload()); await step(() => expect(query().locator('.sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false')); await installAudit();
      await execute(); await originalQuery(setupSql); await write(sql); await execute();
      const originalState = await step(audit), session = originalState.session!;
      const beforeFacts = (await originalQuery(diagnosticSql)).results[0].rows; expect(beforeFacts).toHaveLength(1); expect(beforeFacts[0]).toMatchObject({ c1: a, c2: 73 }); expect(String(beforeFacts[0].c3)).toBe('1');
      const connectionId = String(beforeFacts[0].c0); expect(connectionId).toMatch(/^[1-9]\d*$/u);
      const pending = async () => { resourceNames(); const [rows] = await step(() => observer!.query<import('mysql2/promise').RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${a}\`.subject WHERE id=19`)); return Number(rows[0].n); };
      expect(await pending()).toBe(0);
      // 已应用筛选及降序真实作用于原四行结果，切库后不能重发SQL或重置整理。
      await step(async () => (await navigationMenuItem(query(), { name: filterText.open, exact: true })).click()); const panel = query().getByRole('region', { name: filterText.title, exact: true });
      await step(async () => (await navigationMenuItem(panel, { name: filterText.add, exact: true })).click());
      await step(() => panel.getByRole('combobox', { name: filterText.column + ' 1', exact: true }).selectOption({ index: 0 })); await step(() => panel.getByRole('combobox', { name: filterText.operator + ' 1', exact: true }).selectOption('lt')); await step(() => panel.getByRole('textbox', { name: filterText.input + ' 1', exact: true }).fill('19')); await step(async () => (await navigationMenuItem(panel, { name: filterText.apply, exact: true })).click());
      const idHead = query().locator('.result-body [role="columnheader"]:has(.column-type)').nth(0); await step(() => idHead.click()); await step(() => idHead.click());
      await step(() => expect.poll(async () => (await view()).ids).toEqual(['3', '2', '1']));
      await step(() => editor().focus()); await step(() => page.keyboard.press('Control+End')); await step(() => page.keyboard.insertText(suffix)); await step(() => page.keyboard.press('Control+Home')); await step(() => page.keyboard.press('Shift+ArrowRight')); await step(() => page.keyboard.press('Shift+ArrowRight'));
      const beforeModel = await model(), beforeView = await view(), beforeLedger = await ledger(); expect(beforeModel.value).toBe(originalSql); expect(beforeView.filter).toContain(filterText.counts(4, 3));
      await step(async () => (await navigationMenuItem(query(), { name: text.open, exact: true })).click()); await step(() => dialog().getByRole('combobox', { name: text.database, exact: true }).selectOption(b)); await step(async () => (await navigationMenuItem(dialog(), { name: text.close, exact: true })).click());
      await step(() => expect(dialog()).toBeHidden()); expect((await step(audit)).switches).toBe(0); expect(await model()).toEqual(beforeModel); expect(await view()).toEqual(beforeView); expect((await ledger()).history).toEqual(beforeLedger.history);
      expect((await originalQuery(diagnosticSql)).results[0].rows).toEqual(beforeFacts);
      const beforeSwitchLedger = await ledger(), beforeSwitchCalls = (await step(audit)).calls.filter(call => call.command === 'query.execute').length;
      await step(async () => (await navigationMenuItem(query(), { name: text.open, exact: true })).click()); await step(() => dialog().getByRole('combobox', { name: text.database, exact: true }).selectOption(b)); await step(async () => (await navigationMenuItem(dialog(), { name: text.confirm, exact: true })).click());
      await step(() => expect(dialog().getByRole('status')).toHaveText(text.completed + b)); await step(async () => (await navigationMenuItem(dialog(), { name: text.close, exact: true })).click()); await step(() => expect(dialog()).toBeHidden());
      const switched = await step(audit), call = switched.calls.filter(call => call.command === 'query.databaseSwitch'); expect(call).toHaveLength(1); expect(call[0].ok).toBe(true);
      expect(call[0].input).toMatchObject({ sessionId: session, database: b, expectedContext: { state: 'known', database: a } });
      const confirmed = call[0].result as SwitchOutput; expect(confirmed).toMatchObject({ sessionId: session, database: b, unchanged: false, transactionKnown: true, transactionOpen: true, completion: { database: b, databaseKnown: true, broken: false, busy: false } }); expect((call[0].input as { taskId: string }).taskId).toBe(confirmed.taskId);
      expect((await ledger()).tasks.filter(task => task.kind === 'query.databaseSwitch')).toMatchObject([{ id: confirmed.taskId, status: 'completed' }]);
      expect(switched.calls.filter(call => call.command === 'sessions.open')).toHaveLength(1); expect(switched.calls.filter(call => call.command === 'query.execute')).toHaveLength(beforeSwitchCalls);
      expect(await model()).toEqual(beforeModel); expect(await view()).toEqual(beforeView); expect((await ledger()).history).toEqual(beforeSwitchLedger.history);
      await step(() => expect(query().getByLabel('当前查询默认库', { exact: true })).toHaveText(b));
      await step(() => expect.poll(async () => (await settings()).tabs.find(tab => tab.id === tabId)?.databaseContext).toEqual({ state: 'known', database: b }));
      const afterFacts = (await originalQuery(diagnosticSql)).results[0].rows; expect(afterFacts).toEqual([{ ...beforeFacts[0], c1: b }]); expect(String(afterFacts[0].c0)).toBe(connectionId); expect(await pending()).toBe(0);
      // 原Undo/Redo实际工作，先前实例及快照已逐项核对；不以相同正文冒充保留栈。
      await step(() => editor().focus()); await step(() => page.keyboard.press('Control+Z')); expect((await model()).value).toBe(sql); await step(() => page.keyboard.press('Control+Y')); expect((await model()).value).toBe(originalSql);
      // 在B下以真实键盘请求补全，目录须有B独有列且没有A独有列。
      await write('SELECT s. FROM subject s'); await step(() => editor().focus()); await step(() => page.keyboard.press('Control+Home')); for (let offset = 0; offset < 'SELECT s.'.length; offset++) await step(() => page.keyboard.press('ArrowRight')); await step(() => page.keyboard.press('Control+Space'));
      await step(() => expect(page.locator('.suggest-widget.visible')).toContainText('b_only')); await step(() => expect(page.locator('.suggest-widget.visible')).not.toContainText('a_only'));
      const completion = (await step(audit)).calls.filter(call => call.command === 'metadata.completion' && (call.input as { kind?: string; database?: string; table?: string }).kind === 'columns' && (call.input as { database?: string }).database === b && (call.input as { table?: string }).table === 'subject'); expect(completion.length).toBeGreaterThan(0);
      await step(() => page.keyboard.press('Escape')); await write(sql); const bResult = await execute(); expect(bResult.results[0].rows.map(row => row.c1)).toEqual(['B-one', 'B-two', 'B-three']); expect(bResult.results[0].rows.every(row => String(row.c2) === connectionId && row.c3 === b)).toBe(true);
      await step(async () => (await navigationMenuItem(query(), { name: '回滚', exact: true })).click()); await step(async () => expect((await navigationMenuItem(query(), { name: '回滚', exact: true }))).toBeDisabled());
      const rolled = (await originalQuery(diagnosticSql)).results[0].rows; expect(rolled).toHaveLength(1); expect(rolled[0]).toMatchObject({ c0: beforeFacts[0].c0, c1: b, c2: 73 }); expect(String(rolled[0].c3)).toBe('0'); expect(await pending()).toBe(0);
      await write(originalSql); await step(() => expect.poll(async () => (await settings()).tabs.find(tab => tab.id === tabId)).toMatchObject({ sql: originalSql, databaseContext: { state: 'known', database: b } }));
      const finalAudit = await step(audit); expect(finalAudit.switches).toBe(1); expect(finalAudit.forbidden).toBe(0); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await restoreAudit();
      expect(desktop.pageErrors).toEqual([]); check(); await desktop.confirmOwnedDesktopExit(info); closed = true; check(); expect(child.exitCode).toBe(0);
      await step(() => observer!.end()); observerEnded = true; await step(() => observedClose); expect(observerClosed).toBe(true); expect(native.stream).toBe(stream); expect(stream.closed).toBe(true);
      // 正常退出后仅查本例恢复字段及口令未持久化，不将认证或完整SQLite输出到产物。
      const bytes = await step(() => readFile(join(directory, 'dbark.sqlite'))), initSqlJs = require('sql.js') as typeof import('sql.js');
      const SQL = await step(() => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })), db = new SQL.Database(bytes);
      try {
        const stored = db.exec('SELECT data FROM settings'); expect(stored).toHaveLength(1); const restored = JSON.parse(String(stored[0].values[0][0])).tabs.find((tab: { id: string }) => tab.id === tabId); expect(restored).toMatchObject({ sql: originalSql, databaseContext: { state: 'known', database: b } });
        expect(db.exec('SELECT value FROM secrets WHERE connection_id=\'' + profileId + '\'')).toEqual([]); const profile = JSON.parse(String(db.exec('SELECT data FROM connections WHERE id=\'' + profileId + '\'')[0].values[0][0])); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
      } finally { db.close(); }
      // App与原观察者均正常退出后，才另开一次清理连接；失败不重试、不补DROP。
      expect(observerEnded && observerClosed && closed).toBe(true); expect(created).toEqual([a, b]); resourceNames();
      const cleanup = await step(connect); await identity(cleanup); const cleanupNative = (cleanup as any).connection, cleanupStream = cleanupNative.stream; if (!cleanupStream || typeof cleanupStream.once !== 'function') throw Error('切库清理连接物理流未知');
      const cleanupClosed = new Promise<void>(resolve => cleanupStream.once('close', resolve));
      for (const database of [a, b]) { resourceNames(); await step(() => cleanup.query(`DROP DATABASE \`${database}\``)); }
      const [remaining] = await step(() => cleanup.query<import('mysql2/promise').RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)', [a, b])); expect(remaining).toEqual([]);
      await step(() => cleanup.end()); await step(() => cleanupClosed); expect(cleanupNative.stream).toBe(cleanupStream); expect(cleanupStream.closed).toBe(true);
      await info.attach('显式切库原生范围', { body: Buffer.from(JSON.stringify({ databases: [a, b], originalSql, serverUuid: uuid, switchCalls: finalAudit.switches, samePhysicalConnection: connectionId, originalModelAndSelectionPreserved: true, realUndoRedo: true, resultFilterSortPreserved: true, transactionIsolationAndRollbackVerified: true, temporaryMarker: 73, completionDatabase: b, persistedDatabase: b, normalAppExit: child.exitCode, observerEnded, observerClosed, exactCleanupConfirmed: true, systemClipboardOperations: 0, trace: 'off', screenshot: 'off', video: 'off', auditScope: '原Main专用切库input/result透传及次数；不声称全驱动SQL审计', unverified: ['安装包专项另记', 'macOS', '六实例矩阵', '跟踪关闭与断线/取消矩阵'] })), contentType: 'application/json' });
      check(); complete = true;
    } catch (error) { stopped = true; desktop.retainOwnedDesktopResources(info); throw error; }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
