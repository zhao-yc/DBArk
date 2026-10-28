import { test as baseTest } from '@playwright/test';

// 默认/list仅登记skip，不加载桌面、mysql、SQLite或认证。
const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_PARAMETER_REUSE_UI === '1') register();
else baseTest.skip('同标签参数显式复用原生专项默认关闭（未执行）', () => {});

/** 仅无FROM的合成SELECT；不导入isolatedDatabase，不创建服务器库/表/用户/授权。 */
function register(): void {
  const fixedKeys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_PARAMETER_REUSE_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_EXECUTABLE_PATH'] as const;
  const fixed = Object.fromEntries(fixedKeys.map(key => [key, process.env[key]])); let stopped = false;
  const uuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
  /** 目标和认证仅保留RAM快照；启动前和每个await两侧复核，不输出实际凭据。 */
  function binding(): void {
    if (stopped || process.platform !== 'win32' || fixed.DBARK_INTEGRATION_ENABLED !== '1' || fixed.DBARK_PARAMETER_REUSE_UI !== '1' || fixed.DBARK_TEST_HOST !== '192.168.31.200' || fixed.DBARK_TEST_PORT !== '13384' || fixed.DBARK_TEST_TLS !== '0' || !fixed.DBARK_TEST_USER || typeof fixed.DBARK_TEST_PASSWORD !== 'string' || fixed.DBARK_TEST_EXPECTED_SERVER_UUID !== uuid || fixedKeys.some(key => process.env[key] !== fixed[key]) || ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_PATH', 'DBARK_TEST_DATABASE'].some(key => !!process.env[key])) { stopped = true; throw Error('参数复用专项目标、双门或原RAM绑定已失效'); }
  }
  binding();
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = desktop;
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), { join } = require('node:path') as typeof import('node:path');
  const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise');
  const { queryParameterReuseZh: text } = require('../../src/renderer/locales/queryParameterReuse.zh-CN') as typeof import('../../src/renderer/locales/queryParameterReuse.zh-CN');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: { assertCurrent: binding } });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let complete = false;
  test.afterEach(({}, info) => { if (!complete) { stopped = true; desktop.retainOwnedDesktopResources(info); throw Error('参数复用未完成原owner正常收尾，保留App、profile及原观察连接，不自动重跑'); } });

  test('真实参数表单仅显式暂存/填入，取消保留、忘记保输入、改正文Undo后失效且原值不落盘', async ({ trace, screenshot, video }, info) => {
    const owner = desktop.ownedDesktopResources(info), application = owner.application, page = owner.page, directory = desktop.dataDir, child = application.process();
    const template = 'SELECT :value AS echoed', profileId = 'parameter-reuse-' + randomUUID(), tabId = 'parameter-reuse-tab-' + randomUUID();
    const values = ['PARAMETER_REUSE_SYNTHETIC_' + randomUUID(), 'PARAMETER_REUSE_SYNTHETIC_' + randomUUID()];
    let closed = false, armed = false, observer: import('mysql2/promise').Connection | undefined, observerClosed = false, observerEnded = false;
    type Audit = { pending: number; session: string | null; forbidden: number; calls: { command: string; ok?: boolean; sql?: string; taskId?: string; sessionId?: string; result?: { columns: unknown[]; rows: unknown[]; failed: boolean } }[] };
    const deadline = Date.now() + info.timeout;
    /** 严格单次owner，不向下一个窗口/配置追认；失败后不再次退出或清理。 */
    function check(): void {
      binding(); const current = desktop.ownedDesktopResources(info);
      if (current.application !== application || current.page !== page || current.closed !== closed || desktop.dataDir !== directory || !closed && application.process() !== child || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.timeout !== 120000 || Date.now() >= deadline) throw Error('参数复用原owner、profile或单次期限已变化');
    }
    const audit = (): Promise<Audit> => application.evaluate(() => { const state = (globalThis as any).__parameterReuseNativeAudit; state.check(); return { pending: state.pending, session: state.session, forbidden: state.forbidden, calls: state.calls }; });
    async function step<T>(action: () => Promise<T>): Promise<T> { check(); if (armed) { expect((await audit()).forbidden).toBe(0); check(); } const value = await action(); check(); if (armed) { expect((await audit()).forbidden).toBe(0); check(); } return value; }
    /** 恢复成功即撤下本地审计标记；不让通用step再访问已删除的Main状态。 */
    async function restoreAudit(): Promise<void> {
      check(); const before = await audit(); check(); expect(before.forbidden).toBe(0); expect(before.pending).toBe(0);
      await application.evaluate(() => (globalThis as any).__parameterReuseNativeAudit.restore()); armed = false; check();
    }
    const query = () => page.locator('.query-tab:visible'), modal = () => page.getByRole('dialog', { name: '类型参数查询', exact: true });
    const input = () => modal().getByRole('textbox', { name: '参数值 value', exact: true });
    const remember = () => modal().getByRole('checkbox', { name: text.remember, exact: true });
    const fill = () => modal().getByRole('button', { name: text.fill, exact: true });
    /** 原Main入口精确受控透传；禁止别的SQL/API，不替换成功结果或会话。 */
    async function installAudit(): Promise<void> {
      await step(() => application.evaluate(({ ipcMain, BrowserWindow }, expected) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], contents = window?.webContents;
        if (root.__parameterReuseNativeAudit || !(handlers instanceof Map) || typeof previous !== 'function' || BrowserWindow.getAllWindows().length !== 1 || !window || window.isDestroyed()) throw Error('参数复用Main原入口未知');
        const local = new Set(['settings.get', 'settings.save', 'history.list', 'queries.list', 'tasks.list', 'connections.list', 'connections.organizationGet', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake']);
        const state = { pending: 0, session: null as string | null, forbidden: 0, executions: 0, calls: [] as Audit['calls'], check() {}, restore() {} };
        const forward = async function (this: unknown, event: any, request: any) {
          state.check(); const command = request?.command, input = request?.input;
          let allowed = typeof command === 'string' && local.has(command);
          if (command === 'connections.open' || command === 'connections.close') allowed = input?.id === expected.profileId;
          if (command === 'sessions.open') allowed = !state.session && input?.connectionId === expected.profileId && (input.database === undefined || input.database === null);
          if (['query.sessionState', 'query.completionState', 'sessions.close'].includes(command)) allowed = !!state.session && input?.sessionId === state.session;
          if (command === 'query.parameterNames') allowed = !!state.session && input?.sessionId === state.session && input?.sql === expected.template;
          if (command === 'query.executeParameterized') {
            const parameter = input?.parameters?.[0];
            allowed = !!state.session && input?.sessionId === state.session && input?.sql === expected.template && Array.isArray(input.parameters) && input.parameters.length === 1 && parameter?.name === 'value' && parameter.type === 'text' && parameter.value === expected.values[state.executions] && state.executions < 2 && typeof input.taskId === 'string' && input.continueOnError !== true && input.collectWarnings !== true;
          }
          if (!allowed) { state.forbidden++; throw Error('参数复用拒绝本例范围之外的Main命令或SQL'); }
          const row: Audit['calls'][number] = { command, ...(['query.parameterNames', 'query.executeParameterized'].includes(command) ? { sql: input.sql, sessionId: input.sessionId } : {}), ...(command === 'query.executeParameterized' ? { taskId: input.taskId } : {}) };
          if (command === 'query.executeParameterized') state.executions++;
          state.calls.push(row); state.pending++;
          try {
            const reply: unknown = await Reflect.apply(previous, this, [event, request]);
            row.ok = !!reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true;
            if (row.ok && reply && typeof reply === 'object' && 'result' in reply) {
              const result = reply.result as any;
              if (command === 'sessions.open') { if (typeof result?.sessionId !== 'string' || !result.sessionId) throw Error('参数复用session回包未知'); state.session = result.sessionId; }
              if (command === 'query.executeParameterized') row.result = { columns: result?.results?.[0]?.columns, rows: result?.results?.[0]?.rows, failed: !!result?.failure || !!result?.scriptReport?.errors?.length };
            }
            return reply;
          } finally { state.pending--; }
        };
        state.check = () => { if (root.__parameterReuseNativeAudit !== state || handlers.get('dbark:request') !== forward || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || window.isDestroyed() || window.webContents !== contents) throw Error('参数复用原Map或窗口归属变化'); };
        state.restore = () => { state.check(); if (state.pending) throw Error('参数复用原Main请求未终结'); handlers.set('dbark:request', previous); delete root.__parameterReuseNativeAudit; };
        root.__parameterReuseNativeAudit = state; handlers.set('dbark:request', forward); state.check();
      }, { profileId, template, values })); armed = true;
    }
    const persisted = () => step(() => page.evaluate(async () => ({ settings: await window.dbark.invoke('settings.get', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}), tasks: await window.dbark.invoke('tasks.list', {}) })));
    const ledgerIds = () => step(() => page.evaluate(async () => ({ tasks: (await window.dbark.invoke('tasks.list', {})).map(value => value.id).sort(), history: (await window.dbark.invoke('history.list', {})).map(value => value.id).sort() })));
    /** 仅在内存断言敏感值没有进入记账；产物只备份已核安全的四类本地记录。 */
    function privateLedger(value: unknown): void { const text = JSON.stringify(value); for (const marker of values) { expect(text).not.toContain(marker); expect(text.toLowerCase()).not.toContain(Buffer.from(marker).toString('hex')); } }
    async function open(): Promise<void> {
      await step(() => query().getByRole('button', { name: '参数执行', exact: true }).click()); await step(() => expect(modal()).toBeVisible());
      await step(() => expect(modal().getByRole('button', { name: '执行参数 SQL', exact: true })).toBeEnabled());
      await step(() => expect(remember()).not.toBeChecked()); await step(() => expect(input()).toHaveValue('')); await step(() => expect(modal().locator('.error-box')).toHaveCount(0));
    }
    async function cancel(): Promise<void> { await step(() => modal().getByRole('button', { name: '取消', exact: true }).click()); await step(() => expect(modal()).toBeHidden()); }
    /** 执行按钮只点一次，实际任务终态、结果单元格和Main原回包共同证明成功。 */
    async function execute(marker: string, index: number): Promise<void> {
      const before = await ledgerIds(); await step(() => input().fill(marker)); await step(() => remember().check());
      await step(() => modal().getByRole('button', { name: '执行参数 SQL', exact: true }).click()); await step(() => expect(modal()).toBeHidden());
      await step(() => expect.poll(async () => {
        const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); check(); const added = tasks.filter(task => !before.tasks.includes(task.id));
        if (added.length !== 1 || added[0].kind !== 'query.executeParameterized') return '未知任务集合'; return added[0].status;
      }).toBe('completed'));
      await step(() => expect(query().getByRole('button', { name: '停止', exact: true })).toBeDisabled());
      await step(() => expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(marker));
      const report = await step(audit), calls = report.calls.filter(call => call.command === 'query.executeParameterized'); expect(calls).toHaveLength(index + 1);
      // 显示别名属于列元数据；行使用引擎c0键，分别核对两者，不能把别名当内部键。
      expect(calls[index]).toMatchObject({ sql: template, sessionId: report.session, ok: true, result: { columns: [{ key: 'c0', name: 'echoed' }], failed: false } });
      expect(calls[index].result?.rows).toEqual([{ c0: marker }]);
      expect(await step(() => page.evaluate(input => window.dbark.invoke('query.sessionState', input), { sessionId: report.session! }))).toMatchObject({ broken: false, transactionOpen: false, transactionKnown: true });
      await step(() => expect(query().locator('[aria-label="当前查询默认库"]')).toHaveText('未选择数据库'));
    }
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      // 观察者只发送这一条无FROM的身份/协议诊断，绝不CREATE/DROP/SET/USE。
      observer = await step(() => mysql.createConnection({ host: fixed.DBARK_TEST_HOST!, port: 13384, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD!, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000 }));
      const native = (observer as any).connection, stream = native?.stream; if (!native || !stream || typeof stream.once !== 'function' || !Number.isSafeInteger(native.threadId) || native.threadId < 1) throw Error('观察连接原物理流未知');
      const observedClose = new Promise<void>(resolve => stream.once('close', () => { observerClosed = true; resolve(); }));
      const [facts] = await step(() => observer!.query<import('mysql2/promise').RowDataPacket[]>('SELECT @@server_uuid AS uuid,@@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,DATABASE() AS currentDatabase,CONNECTION_ID() AS connectionId'));
      expect(facts).toHaveLength(1); expect(facts[0]).toMatchObject({ uuid, currentDatabase: null }); expect(facts[0].version).toMatch(/^8\.4\.11(?:[-+]|$)/); expect(String(facts[0].os).toLowerCase()).toMatch(/^(linux|debian-linux-gnu)$/); expect([0, '0']).toContain(facts[0].lowerNames); expect(Number(facts[0].connectionId)).toBe(native.threadId);
      const initial = await persisted(); expect(initial.settings.tabs).toEqual([]); expect(initial.history).toEqual([]); expect(initial.queries).toEqual([]); expect(initial.tasks).toEqual([]); privateLedger(initial);
      // Main仅准备自己的临时profile和一个无默认库查询；密码remember=false只进RAM，不声称连接表单验收。
      await step(() => page.evaluate(async value => {
        const profile = await window.dbark.invoke('connections.save', { id: value.profileId, name: '参数复用合成profile', dialect: 'mysql', host: value.host, port: 13384, user: value.user, password: value.password, rememberPassword: false, group: '', color: '#345678' });
        if (profile.rememberPassword !== false || profile.password !== undefined || profile.database !== undefined) throw Error('参数复用配置秘密或默认库不符');
        const settings = await window.dbark.invoke('settings.get', {}); await window.dbark.invoke('settings.save', { ...settings, activeTabId: value.tabId, tabs: [{ id: value.tabId, kind: 'query', title: '参数复用合成查询', connectionId: profile.id, databaseContext: { state: 'known', database: null }, sql: value.template }] });
      }, { profileId, tabId, template, host: fixed.DBARK_TEST_HOST!, user: fixed.DBARK_TEST_USER!, password: fixed.DBARK_TEST_PASSWORD! }));
      await step(() => page.reload()); await step(() => expect(query().locator('.sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false'));
      await installAudit(); const baseline = await persisted(); privateLedger(baseline);
      await open(); await step(() => expect(fill()).toBeDisabled()); await execute(values[0], 0);
      const firstIds = await ledgerIds();
      await open(); await step(() => expect(fill()).toBeEnabled()); expect(await ledgerIds()).toEqual(firstIds);
      await step(() => fill().click()); await step(() => expect(input()).toHaveValue(values[0])); expect(await ledgerIds()).toEqual(firstIds); await cancel();
      await open(); await step(() => expect(fill()).toBeEnabled()); await step(() => fill().click()); await step(() => expect(input()).toHaveValue(values[0]));
      await step(() => modal().getByRole('button', { name: text.forget, exact: true }).click()); await step(() => expect(input()).toHaveValue(values[0])); await step(() => expect(remember()).not.toBeChecked()); expect(await ledgerIds()).toEqual(firstIds); await cancel();
      await open(); await step(() => expect(fill()).toBeDisabled()); await execute(values[1], 1);
      const secondIds = await ledgerIds(); await open(); await step(() => expect(fill()).toBeEnabled()); await cancel(); expect(await ledgerIds()).toEqual(secondIds);
      // 真实键盘只加一个空格再Undo，不触碰系统剪贴板；同文模型版本仍变化，旧缓存不能复活。
      const editor = query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox'); await step(() => editor.focus()); await step(() => page.keyboard.press('End')); await step(() => page.keyboard.type(' '));
      await step(() => expect.poll(async () => (await persisted()).settings.tabs.find(tab => tab.id === tabId)?.sql).toBe(template + ' '));
      await step(() => page.keyboard.press('Control+Z')); await step(() => expect.poll(async () => (await persisted()).settings.tabs.find(tab => tab.id === tabId)?.sql).toBe(template));
      await open(); await step(() => expect(fill()).toBeDisabled()); await cancel(); expect(await ledgerIds()).toEqual(secondIds);
      const after = await persisted(); privateLedger(after); expect(after.queries).toEqual([]); expect(after.tasks.filter(task => task.kind === 'query.executeParameterized')).toHaveLength(2); expect(after.history).toHaveLength(2); expect(after.history.every(entry => entry.sql === template)).toBe(true);
      const report = await step(audit); expect(report.forbidden).toBe(0); expect(report.calls.filter(call => call.command === 'sessions.open')).toHaveLength(1); expect(report.calls.filter(call => call.command === 'query.executeParameterized')).toHaveLength(2);
      await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await restoreAudit();
      expect(desktop.pageErrors).toEqual([]); check(); await desktop.confirmOwnedDesktopExit(info); closed = true; check(); expect(child.exitCode).toBe(0);
      // 同一原观察连接正常end并等待原stream close；失败不换新连接或自动补清理。
      await step(() => observer!.end()); observerEnded = true; await step(() => observedClose); expect(observerClosed).toBe(true); expect(native.stream).toBe(stream); expect(stream.closed).toBe(true);
      const bytes = await step(() => fs.readFile(join(directory, 'dbark.sqlite')));
      for (const marker of values) for (const buffer of [Buffer.from(marker), Buffer.from(marker, 'utf16le'), Buffer.from(Buffer.from(marker).toString('hex')), Buffer.from(Buffer.from(marker).toString('hex').toUpperCase())]) expect(bytes.includes(buffer)).toBe(false);
      const initSqlJs = require('sql.js') as typeof import('sql.js'), SQL = await step(() => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }));
      const db = new SQL.Database(bytes); let raw: Record<string, unknown> = {};
      try { raw = Object.fromEntries(['settings', 'history', 'queries', 'tasks'].map(table => [table, db.exec('SELECT data FROM "' + table + '"')])); privateLedger(raw); expect(db.exec('SELECT value FROM secrets WHERE connection_id=\'' + profileId + '\'')).toEqual([]); const storedProfile = db.exec('SELECT data FROM connections WHERE id=\'' + profileId + '\''); expect(storedProfile).toHaveLength(1); const publicProfile = JSON.parse(String(storedProfile[0].values[0][0])); expect(publicProfile.rememberPassword).toBe(false); expect(publicProfile.password).toBeUndefined(); } finally { db.close(); }
      privateLedger({ initial, baseline, after, raw }); await step(() => fs.writeFile(info.outputPath('parameter-reuse-safe-ledgers.json'), JSON.stringify({ initial, baseline, after, sqlite: raw }, null, 2)));
      await info.attach('参数复用原生验收范围', { body: Buffer.from(JSON.stringify({ template, parameterExecutions: 2, onlyOwnSession: true, defaultDatabase: null, serverUuidVerified: uuid, serverResourceWrites: 0, systemClipboardOperations: 0, originalProcessExitCode: child.exitCode, observerNormalEnd: observerEnded, observerPhysicalClose: observerClosed, ledgerMarkerAbsent: true, sqliteMarkerAndHexAbsent: true, trace: 'off', screenshot: 'off', video: 'off', auditScope: 'Main准备/reload后至退出前精确恢复原handler；观察者仅一条身份诊断SELECT；不替代底层驱动全SQL审计', unverified: ['安装包范围另记', 'macOS', '真实取消/断线', '其它参数类型原生矩阵'] })), contentType: 'application/json' });
      check(); complete = true;
    } catch (error) { stopped = true; desktop.retainOwnedDesktopResources(info); throw error; }
  });
}
