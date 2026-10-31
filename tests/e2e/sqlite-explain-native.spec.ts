import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import type { QueryResult } from '../../src/shared/contracts';
import type { SqliteExplainNode } from '../../src/shared/sqliteExplain';

// 默认和--list只注册单个跳过项；原生App、NodeSQLite和文件观察均在显式专项内部加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_EXPLAIN_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)
    || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite执行计划仅允许Windows/macOS源码、integration=0与无外库认证环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite执行计划禁止自动trace');
}

type Desktop = typeof import('./desktop-fixture');
type Fact = { command: string; request: Record<string, unknown>; reply?: unknown; failure?: string };
interface Audit { pending: number; denied: string[]; forks: string[]; pickerIds: string[]; profiles: Record<string, boolean>; sessions: Record<string, string>; commands: string[]; operations: Fact[]; events: unknown[]; driverSql: { worker: number; id: string; kind: string; sql: string }[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_EXPLAIN_NATIVE_TEST=1、integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const rwName = 'SQLite执行计划本例读写', roName = 'SQLite执行计划本例只读';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 失败保留准确owner、原profile和数据库，禁止自动重试、强停或清理。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite执行计划未完成两次正常退出，原现场已保留'); } });

test('SQLite真实执行计划原始节点与本地视图、同会话临时表事务、拒绝副作用且重启不重放', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop;
  const { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-explain-native.sqlite');
  let closed = false, armed = false, stage = '独占合成SQLite准备';
  /** 所有异步边界只承认本例准确owner与原120秒单次期限。 */
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite执行计划owner/profile/120秒单次期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteExplainNative?: Audit & { check(): void } }).__sqliteExplainNative; if (!state) throw Error('原SQLite执行计划观察器不存在'); state.check(); return { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, sessions: state.sessions, commands: state.commands, operations: state.operations, events: state.events, driverSql: state.driverSql }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const query = () => page.locator('.query-tab:visible');
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  /** 原始IPC必须有成功封套才读取结果，不用UI预期伪造查询或会话事实。 */
  const result = (reply: unknown): Record<string, unknown> => { if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true || !('result' in reply) || !reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result)) throw Error('SQLite执行计划没有成功原IPC结果'); return reply.result as Record<string, unknown>; };
  const operations = (facts: Audit, command: string) => facts.operations.filter(operation => operation.command === command);
  const indexName = 'idx_subject_label', temporaryName = '仅原会话计划🚢';
  const indexedSql = "SELECT s.id,s.label FROM subject AS s INDEXED BY idx_subject_label\r\nWHERE s.label IN (SELECT label FROM subject WHERE id=2 LIMIT 1);";
  const temporarySql = 'CREATE TEMP TABLE "仅原会话计划🚢"(id INTEGER PRIMARY KEY,note TEXT)';
  const transactionSql = "INSERT INTO subject(id,label,v) VALUES(99,'事务原值🚢',99)";
  const temporaryPlanSql = 'SELECT s.id,t.note FROM subject AS s\r\nLEFT JOIN temp."仅原会话计划🚢" AS t ON t.id=s.id WHERE s.id=99;';
  const dmlSql = 'UPDATE subject SET v=v+1000 WHERE id=2;';
  const pragmaSql = 'PRAGMA user_version=7;';
  const multipleSql = "UPDATE subject SET v=9999 WHERE id=1;\r\nSELECT '不得发送第二句🚢';";
  const allowedPlans = [indexedSql, temporaryPlanSql, dmlSql, pragmaSql, multipleSql];
  const restoredSql = "-- 正常重启仅恢复原草稿🚢\r\nUPDATE subject SET v=8888 WHERE id=1;";
  /** 原磁盘观察每次独立只读句柄，明确看不到用户会话中尚未提交的id99。 */
  const disk = () => { check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('计划专项磁盘观察越过本例目录'); const db = new DatabaseSync(database, { readOnly: true }); try { return { rows: db.prepare('SELECT CAST(id AS TEXT) AS id,label,CAST(v AS TEXT) AS v,typeof(v) AS value_type FROM subject ORDER BY id').all(), control: db.prepare('SELECT * FROM control').all(), schema: db.prepare('SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE \'sqlite_%\' ORDER BY type,name').all(), userVersion: db.prepare('PRAGMA user_version').get() }; } finally { db.close(); check(); } };
  /** 仅替换两次自身文件chooser的准确路径；IPC、授权、SQLite任务和事件全部真实透传。 */
  const arm = (savedProfiles: Record<string, boolean> = {}) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __sqliteExplainNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork, originalSend = window?.webContents.send;
    if (typeof original !== 'function' || windows.length !== 1 || !frame || !originalSend || root.__sqliteExplainNative) throw Error('SQLite执行计划原Main入口未知');
    const state: State = { pending: 0, denied: [], forks: [], pickerIds: [], profiles: { ...input.savedProfiles }, sessions: {}, commands: [], operations: [], events: [], driverSql: [], check() {}, restore() {} };
    const children: { child: Electron.UtilityProcess; original: Electron.UtilityProcess['postMessage']; wrapped: Electron.UtilityProcess['postMessage'] }[] = [];
    let pickerRequest: string | undefined;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite执行计划专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteExplainNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.webContents.send !== send || children.some(port => port.child.postMessage !== port.wrapped) || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite执行计划原Main/文档/child观察器失效'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions; if (Object.keys(input.savedProfiles).length || !pickerRequest || state.pickerIds.includes(pickerRequest) || state.pickerIds.length >= 2 || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker'); state.pickerIds.push(pickerRequest); return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
    const save = (() => deny('未授权保存对话框')) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => {
      check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); const child: Electron.UtilityProcess = Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]), original = child.postMessage, worker = state.forks.length;
      // 只旁观准确child的原消息，绝不改写、阻断cleanup/ACK或构造worker回执。
      const post = ((message: unknown, ...rest: unknown[]) => { if (message && typeof message === 'object' && 'kind' in message && ['execute', 'streamRead'].includes(String(message.kind)) && 'sql' in message && typeof message.sql === 'string') state.driverSql.push({ worker, id: 'id' in message ? String(message.id) : '', kind: String(message.kind), sql: message.sql }); return Reflect.apply(original, child, [message, ...rest]); }) as typeof child.postMessage;
      children.push({ child, original, wrapped: post }); child.postMessage = post; return child;
    }) as typeof utilityProcess.fork;
    const send = ((channel: string, ...args: unknown[]) => { if (channel === 'dbark:task') state.events.push(structuredClone(args[0])); return Reflect.apply(originalSend, window.webContents, [channel, ...args]); }) as typeof window.webContents.send;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC'); const command = payload.command, value = payload.input as Record<string, unknown>;
      if (/clipboard/i.test(command) || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('sqlite.') || command.startsWith('serverMonitor.') || command.startsWith('files.') && command !== 'files.choose' || command.startsWith('excel.')) return deny(command);
      if (command.startsWith('query.') && !['query.execute', 'query.explain', 'query.sessionState', 'query.completionState', 'query.transaction', 'query.cancel'].includes(command) || command.startsWith('sessions.') && !['sessions.open', 'sessions.close'].includes(command)) return deny('非本例查询命令：' + command);
      if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId) return deny('文件用途/连接归属'); pickerRequest = value.sqliteConnectionId; }
      if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite, readOnly = value.name === input.rwName ? false : value.name === input.roName ? true : undefined; if (value.dialect !== 'sqlite' || typeof value.id !== 'string' || !state.pickerIds.includes(value.id) || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== readOnly || readOnly === undefined || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例明确读写/只读配置'); state.profiles[value.id] = readOnly; }
      if (command === 'connections.open' && !Object.hasOwn(state.profiles, String(value.id)) || command.startsWith('metadata.') && !Object.hasOwn(state.profiles, String(value.connectionId))) return deny('其它数据库连接');
      if (command === 'sessions.open' && (!Object.hasOwn(state.profiles, String(value.connectionId)) || value.database !== 'main')) return deny('其它查询连接/数据库');
      if ((command.startsWith('query.') || command === 'sessions.close') && command !== 'query.cancel' && (!String(value.sessionId).startsWith('sqlite:') || !Object.hasOwn(state.sessions, String(value.sessionId)))) return deny('非本例准确SQLite会话');
      // 原QueryTab在执行收尾读取协议缓存更新面包屑，不附加SQL；只允许本例准确sessionId一个字段。
      if (command === 'query.completionState' && (typeof value.sessionId !== 'string' || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'sessionId'))) return deny('非本例会话协议缓存请求');
      if (command === 'query.cancel' && !state.operations.some(operation => ['query.execute', 'query.explain'].includes(operation.command) && operation.request.taskId === value.taskId)) return deny('其它查询任务取消');
      if (command === 'query.transaction' && !['begin', 'rollback'].includes(String(value.action))) return deny('非本例明确事务动作');
      if (command === 'query.execute' && (typeof value.sql !== 'string' || !input.executions.includes(value.sql) || value.currentStatement !== undefined || value.continueOnError === true || value.collectWarnings === true)) return deny('非本例明确TEMP/事务夹具准备');
      if (command === 'query.explain' && (typeof value.sql !== 'string' || !input.plans.includes(value.sql) || value.currentStatement !== undefined || value.format !== 'auto')) return deny('非本例原文计划请求');
      const fact: Fact | undefined = command.startsWith('query.') || command.startsWith('sessions.') ? { command, request: structuredClone(value) } : undefined; if (fact) state.operations.push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply);
        if (command === 'sessions.open' && reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply && reply.result && typeof reply.result === 'object' && 'sessionId' in reply.result && typeof reply.result.sessionId === 'string') { if (!reply.result.sessionId.startsWith('sqlite:')) return deny('会话未由SQLite签发'); state.sessions[reply.result.sessionId] = String(value.connectionId); } return reply;
      } catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; } finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('SQLite执行计划请求仍在途'); for (const port of children) { port.child.postMessage = port.original; if (port.child.postMessage !== port.original) throw Error('原SQLite child消息端口未准确恢复'); } handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; window.webContents.send = originalSend; delete root.__sqliteExplainNative; };
    root.__sqliteExplainNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; window.webContents.send = send; check();
  }, { database, savedProfiles, rwName, roName, plans: allowedPlans, executions: [temporarySql, transactionSql] }));
  /** 两个连接都通过真实表单保存；读写连接必须明确取消产品默认只读。 */
  const createConnection = async (name: string, readOnly: boolean) => {
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(name)); const dialect = form.locator('select'); await step(() => expect(dialect).toHaveCount(1)); await step(() => dialect.selectOption('sqlite')); const readonly = form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }); await step(() => expect(readonly).toBeChecked()); if (!readOnly) { await step(() => readonly.uncheck()); await step(() => expect(readonly).not.toBeChecked()); }
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
  };

  /** 原树真实右键生成SELECT草稿，不双击数据页，不用settings写入标签或伪造会话。 */
  const openQuery = async (name: string) => {
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').filter({ hasText: name }) }); await step(() => expect(connection).toHaveCount(1));
    const databaseRow = connection.locator('.database-row .tree-label').filter({ hasText: /^main$/ }); if (!await step(() => databaseRow.isVisible())) await step(() => connection.locator('.connection-row .tree-label').filter({ hasText: name }).click());
    const object = connection.locator('.object-row').filter({ has: page.getByRole('button', { name: 'subject', exact: true }) }); if (!await step(() => object.isVisible())) await step(() => databaseRow.click());
    // SQLite对象单击仅选择；先固定准确行及滚动，仍只右键一次，不重试或强行保活旧菜单。
    await step(() => object.getByRole('button', { name: 'subject', exact: true }).click()); await step(() => expect(object).toHaveClass(/\bactive\b/)); await step(() => object.scrollIntoViewIfNeeded());
    await step(() => expect.poll(() => object.evaluate(async node => { const scroll = node.closest('.tree-scroll'); if (!scroll) throw Error('准确对象行不在原树滚动容器'); const sample = () => { const bounds = node.getBoundingClientRect(); return [bounds.x, bounds.y, bounds.width, bounds.height, scroll.scrollTop, scroll.scrollLeft]; }; const before = sample(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); return node.isConnected && JSON.stringify(before) === JSON.stringify(sample()); })).toBe(true));
    await step(async () => { const item = await (require('./sidebar-menu') as typeof import('./sidebar-menu')).sidebarMenuItem(object, { name: sqliteZh.selectQuery + ' subject', exact: true }, check); check(); await item.click(); check(); }); await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
  };
  /** 官方Monaco getter只读取唯一当前查询模型，不用旧editor或内部store代替真实光标。 */
  const model = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    const editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab .sql-editor-wrap') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('当前查询Monaco官方API不可用或原编辑器不唯一'); const editor = editors[0], source = editor.getModel(), point = editor.getPosition(); if (!source || source.isDisposed() || !point) throw Error('当前查询原模型/光标不可读取');
    return { source: source.getValue(), eol: source.getEOL(), offset: source.getOffsetAt(point), selections: editor.getSelections()?.map(range => ({ start: source.getOffsetAt(range.getStartPosition()), end: source.getOffsetAt(range.getEndPosition()) })) };
  }));
  const modelFacts: { source: string; eol: string; offset: number; selections: { start: number; end: number }[] | undefined }[] = [];
  /** 经Root授权仅设置本例官方模型/EOL/caret；执行仍由产品真实菜单/快捷键发起，不是实体键盘输入验收。 */
  const write = async (source: string, offset = 0) => {
    await step(() => page.evaluate(input => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && node.closest('.query-tab .sql-editor-wrap') && node.getClientRects().length > 0; });
      if (!api || editors?.length !== 1) throw Error('本例Monaco官方输入端口不可用'); const editor = editors[0], model = editor.getModel(); if (!model || model.isDisposed() || input.offset < 0 || input.offset > input.source.length) throw Error('本例原模型或UTF16位置无效');
      model.setValue(input.source); model.setEOL(api.editor.EndOfLineSequence.CRLF); const point = model.getPositionAt(input.offset); editor.setPosition(point); editor.setSelection({ startLineNumber: point.lineNumber, startColumn: point.column, endLineNumber: point.lineNumber, endColumn: point.column }); editor.revealPositionInCenter(point); editor.focus();
      if (model.getValue() !== input.source || model.getOffsetAt(point) !== input.offset) throw Error('真实模型全文/EOL/光标与原输入不一致');
    }, { source, offset }));
    await step(() => expect.poll(async () => { const saved = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return saved.tabs.find(tab => tab.id === saved.activeTabId)?.sql; }).toBe(source));
    const observed = await model(); expect(observed).toEqual({ source, eol: '\r\n', offset, selections: [{ start: offset, end: offset }] }); modelFacts.push(observed);
  };
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  const view = () => query().locator('[data-sqlite-explain-view]');
  const emittedSql = (facts: Audit, taskId: unknown) => facts.events.flatMap(event => event && typeof event === 'object' && 'taskId' in event && event.taskId === taskId && 'executionSql' in event && typeof event.executionSql === 'string' ? [event.executionSql] : []);
  /** 成品只由真实四列回包独立核对，不导入生产plan builder来生成预期。 */
  const inspectPlan = (outcome: Record<string, unknown>) => {
    expect(outcome).not.toHaveProperty('explain'); expect(outcome).not.toHaveProperty('analysis'); expect(outcome).not.toHaveProperty('failure');
    if (!Array.isArray(outcome.results) || outcome.results.length !== 1) throw Error('SQLite计划缺少单个真实原始结果'); const result: unknown = outcome.results[0];
    if (!result || typeof result !== 'object' || !('columns' in result) || !Array.isArray(result.columns) || !('rows' in result) || !Array.isArray(result.rows) || !('statement' in result) || typeof result.statement !== 'string') throw Error('SQLite原始计划结果形状无效');
    const columns: Pick<QueryResult['columns'][number], 'key' | 'name'>[] = result.columns.map((column: unknown) => { if (!column || typeof column !== 'object' || !('key' in column) || typeof column.key !== 'string' || !('name' in column) || typeof column.name !== 'string') throw Error('SQLite计划原列无效'); return { key: column.key, name: column.name }; }); expect(columns.map(column => column.name)).toEqual(['id', 'parent', 'notused', 'detail']);
    const rows: string[][] = result.rows.map((row: unknown) => { if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('SQLite计划原行无效'); return columns.map(column => { if (!(column.key in row)) throw Error('SQLite计划原行缺少列'); const value: unknown = Reflect.get(row, column.key); if (typeof value !== 'string') throw Error('本例SQLite计划四列必须为原始精确文本'); return value; }); }); expect(rows.length).toBeGreaterThan(0);
    const plan = outcome.sqliteExplain;
    if (!plan || typeof plan !== 'object' || !('raw' in plan) || typeof plan.raw !== 'string' || !('nodes' in plan) || !Array.isArray(plan.nodes) || !('version' in plan) || typeof plan.version !== 'string') throw Error('SQLite原生计划合同缺失');
    expect(plan).toMatchObject({ dialect: 'sqlite', initialView: 'tree', rawTruncated: false, warnings: [] }); expect(plan.version).toMatch(/^\d+\.\d+\.\d+$/); expect(JSON.parse(plan.raw)).toEqual({ columns: columns.map(column => column.name), rows });
    const ids = new Set(rows.map(row => row[0])); expect(ids.size).toBe(rows.length); const expectedNodes: SqliteExplainNode[] = [], visited = new Set<string>();
    const visit = (row: string[], depth: number) => { if (visited.has(row[0]) || depth > 64) throw Error('本例计划原关系有环或超过有界树深度'); visited.add(row[0]); expectedNodes.push({ id: row[0], ...(row[1] === '0' ? {} : { parent: row[1] }), depth, detail: row[3], auxiliary: row[2] }); for (const child of rows.filter(child => child[1] === row[0])) visit(child, depth + 1); };
    for (const row of rows.filter(row => row[1] === '0')) visit(row, 0); expect(visited.size).toBe(rows.length); expect(plan.nodes).toEqual(expectedNodes);
    return { raw: plan.raw, version: plan.version, rows, columns, expectedNodes, statement: result.statement };
  };
  /** 等原Task和查询忙态收尾；缓存读取仍沿本例准确session，不能把未完成态当作切换基线。 */
  const idle = async (fact: Fact) => {
    await step(() => expect.poll(async () => { const status = (await tasks()).find(task => task.id === fact.request.taskId)?.status; return status !== undefined && ['completed', 'failed', 'cancelled'].includes(status); }).toBe(true));
    await step(async () => expect(await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(query(), { name: zh.common.stop, exact: true }, check)).toBeDisabled());
    await step(() => expect.poll(async () => { const state = await audit(), index = state.operations.findIndex(operation => operation.request.taskId === fact.request.taskId && operation.command === fact.command); return index >= 0 && state.pending === 0 && state.operations.slice(index + 1).some(operation => operation.command === 'query.completionState' && operation.request.sessionId === fact.request.sessionId && operation.reply !== undefined); }).toBe(true));
  };
  /** 只有两个显式准备SQL可走普通执行；这些不是任何待测plan原语句。 */
  const prepare = async (sql: string) => {
    await write(sql); const before = operations(await step(audit), 'query.execute').length; await step(() => page.keyboard.press(modifier + '+Enter')); await step(() => expect.poll(async () => { const facts = operations(await audit(), 'query.execute'); return facts.length === before + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true)); const fact = operations(await step(audit), 'query.execute').at(-1); if (!fact) throw Error('本例准备SQL缺少原请求'); expect(fact.failure).toBeUndefined(); expect(result(fact.reply)).not.toHaveProperty('failure'); await idle(fact); return fact;
  };
  /** 真实原“执行计划”菜单，公共IPC仍传原SQL；只允许后端给driver构造EXPLAIN前缀。 */
  const explain = async (sql: string, refused = false) => {
    await write(sql); const before = await step(audit), previous = operations(before, 'query.explain').length, beforeHistory = await history();
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(query(), { name: zh.query.text014, exact: true }, check)).click());
    await step(() => expect.poll(async () => { const facts = operations(await audit(), 'query.explain'); return facts.length === previous + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true)); const after = await step(audit), fact = operations(after, 'query.explain').at(-1); if (!fact) throw Error('SQLite计划缺少原Main请求'); expect(fact.failure).toBeUndefined(); expect(fact.request).toMatchObject({ sql, format: 'auto' }); expect(fact.request).not.toHaveProperty('currentStatement');
    const sent = after.driverSql.slice(before.driverSql.length), headers = emittedSql(after, fact.request.taskId);
    if (refused) { expect(fact.reply).toMatchObject({ ok: false, error: expect.any(String) }); expect(sent).toEqual([]); expect(headers).toEqual([]); await step(() => expect(query().locator('.error-box')).toBeVisible()); }
    else { const outcome = result(fact.reply), plan = inspectPlan(outcome); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ kind: 'execute' }); expect(sql.endsWith(';')).toBe(true); expect(sent[0].sql).toBe('EXPLAIN QUERY PLAN ' + sql.slice(0, -1)); expect(headers).toEqual([plan.statement]); expect(plan.statement).toBe(sent[0].sql); await step(() => expect(view()).toHaveCount(1)); await step(() => expect(view()).toHaveAttribute('aria-label', 'SQLite 执行计划')); }
    await idle(fact); expect(await history()).toEqual(beforeHistory); expect((await model()).source).toBe(sql); return { fact, outcome: refused ? undefined : result(fact.reply), sent, headers };
  };
  /** 四列原生值通过真实列头定位；ResultsGrid的勾选列不能被当作id列。 */
  const expectRawGrid = async (plan: ReturnType<typeof inspectPlan>) => {
    const grid = view().getByRole('grid'); await step(() => expect(grid).toBeVisible()); await step(() => expect(grid.getByRole('columnheader').filter({ has: page.locator('.column-type') })).toHaveCount(4));
    // 列名是原span的直接文本节点，small另含SQLITE类型；不能把整个列头文本误当纯列名。
    for (const [index, name] of ['id', 'parent', 'notused', 'detail'].entries()) { const label = page.locator(`xpath=.//span[text()="${name}"]`), header = grid.getByRole('columnheader').filter({ has: label }); await step(() => expect(header).toHaveCount(1)); const column = await step(() => header.getAttribute('aria-colindex')); if (!column || !/^[1-9][0-9]*$/.test(column)) throw Error('SQLite计划真实列位置未知'); const cells = grid.locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${column}"]`); await step(() => expect(cells).toHaveCount(plan.rows.length)); await step(() => expect(cells).toHaveText(plan.rows.map(row => row[index]))); }
  };
  /** 切树/表格/原文和展开折叠均是本地操作；原Main所有命令、任务消息及driver帧必须完全不变。 */
  const localViews = async (plan: ReturnType<typeof inspectPlan>, fact: Fact) => {
    // 执行前已保存unknown；收尾恢复known/main后的原防抖保存真正落盘，才开始本地零IPC区间。
    const currentSettings = await settings(), activeTab = currentSettings.tabs.find(tab => tab.id === currentSettings.activeTabId), sessionId = fact.request.sessionId;
    if (!activeTab || activeTab.kind !== 'query' || activeTab.sql !== fact.request.sql || typeof sessionId !== 'string') throw Error('本地计划视图缺少准确原查询标签');
    const connectionId = (await step(audit)).sessions[sessionId]; expect(connectionId).toBe(activeTab.connectionId);
    let savedContext: Awaited<ReturnType<typeof settings>> | undefined;
    await step(() => expect.poll(async () => {
      const saved = await settings(), tab = saved.tabs.find(tab => tab.id === activeTab.id); savedContext = saved;
      return { activeTabId: saved.activeTabId, tab: tab && { id: tab.id, kind: tab.kind, connectionId: tab.connectionId, sql: tab.sql, database: tab.database, databaseContext: tab.databaseContext }, pending: (await audit()).pending };
    }).toEqual({ activeTabId: activeTab.id, tab: { id: activeTab.id, kind: 'query', connectionId, sql: fact.request.sql, database: 'main', databaseContext: { state: 'known', database: 'main' } }, pending: 0 }));
    const before = await step(audit); await step(() => view().getByRole('button', { name: '展开 SQLite 全部计划节点', exact: true }).click()); const tree = view().getByRole('tree', { name: 'SQLite 计划树', exact: true }); await step(() => expect(tree).toBeVisible()); await step(() => expect(tree.getByRole('treeitem')).toHaveCount(plan.expectedNodes.length));
    for (const [index, node] of plan.expectedNodes.entries()) { await step(() => expect(tree.getByRole('treeitem').nth(index)).toHaveAttribute('aria-level', String(node.depth + 1))); await step(() => expect(tree.getByRole('treeitem').nth(index)).toContainText(node.detail)); }
    await step(() => view().getByRole('button', { name: 'SQLite 计划表格', exact: true }).click()); await step(() => expect(view().getByRole('button', { name: 'SQLite 计划表格', exact: true })).toHaveAttribute('aria-pressed', 'true')); await expectRawGrid(plan);
    await step(() => view().getByRole('button', { name: 'SQLite 计划原文', exact: true }).click()); const raw = view().getByLabel('SQLite 计划原文内容', { exact: true }); await step(() => expect(raw).toBeVisible()); expect(await step(() => raw.textContent())).toBe(plan.raw);
    await step(() => view().getByRole('button', { name: 'SQLite 计划树', exact: true }).click()); await step(() => view().getByRole('button', { name: '折叠 SQLite 全部计划节点', exact: true }).click()); await step(() => view().getByRole('button', { name: '展开 SQLite 全部计划节点', exact: true }).click()); await step(() => expect(tree.getByRole('treeitem')).toHaveCount(plan.expectedNodes.length)); await step(() => expect(view().getByRole('button', { name: /快照/ })).toHaveCount(0));
    const after = await step(audit); expect(after.commands).toEqual(before.commands); expect(after.operations).toEqual(before.operations); expect(after.events).toEqual(before.events); expect(after.driverSql).toEqual(before.driverSql); expect(after.pending).toBe(0); return { savedContext, before, after };
  };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    stage = '原空owner在Monaco ESM首读前启用官方globalAPI'; await step(() => page.addInitScript(() => { let environment: Record<string, unknown> = { globalAPI: true }; Object.defineProperty(window, 'MonacoEnvironment', { configurable: true, get: () => environment, set: (value: unknown) => { environment = value && typeof value === 'object' && !Array.isArray(value) ? { ...value, globalAPI: true } : { globalAPI: true }; } }); })); await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible()); expect(await step(() => page.evaluate(() => typeof (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors))).toBe('function');
    const db = new DatabaseSync(database); try { db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,label TEXT NOT NULL,v INTEGER NOT NULL); CREATE INDEX idx_subject_label ON subject(label); CREATE TABLE control(id INTEGER PRIMARY KEY,note TEXT NOT NULL); INSERT INTO control VALUES(1,\'原控制行保持\');'); const insert = db.prepare('INSERT INTO subject VALUES(?,?,?)'); for (let id = 1; id <= 4; id++) insert.run(BigInt(id), '标签' + id + '🚢', BigInt(id * 10)); } finally { db.close(); }
    // Main保存配置沿默认realpathSync；worker物理身份另用native，两者不能混用期望。
    const canonicalDatabase = realpathSync(database), baseline = disk(); expect(baseline.rows).toEqual([1, 2, 3, 4].map(id => ({ id: String(id), label: '标签' + id + '🚢', v: String(id * 10), value_type: 'integer' }))); expect(baseline.userVersion).toEqual({ user_version: 0 }); await arm(); armed = true;
    stage = '真实RW/RO表单与原QueryTab'; await createConnection(rwName, false); await createConnection(roName, true); const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(2); const rw = profiles.find(profile => profile.name === rwName), ro = profiles.find(profile => profile.name === roName); if (!rw || rw.dialect !== 'sqlite' || !ro || ro.dialect !== 'sqlite') throw Error('SQLite计划本例连接方言不正确'); expect(rw.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: false }); expect(ro.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true }); for (const profile of [rw, ro]) { expect(profile.sqlite.fileToken).toBeUndefined(); for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(field); } await openQuery(rwName);
    stage = '原菜单索引SELECT计划与原始关系独立核对'; const first = await explain(indexedSql); if (!first.outcome) throw Error('有效SQLite计划没有回执'); const plan = inspectPlan(first.outcome); expect(plan.expectedNodes.some(node => node.detail.includes(indexName))).toBe(true); expect(plan.expectedNodes.some(node => node.depth > 0)).toBe(true); const rwSession = first.fact.request.sessionId; expect(typeof rwSession).toBe('string'); expect(disk()).toEqual(baseline); expect(await history()).toEqual([]); const localEvidence = await localViews(plan, first.fact); expect((await model()).source).toBe(indexedSql);
    stage = '原同会话TEMP和BEGIN未提交环境只规划'; const temporary = await prepare(temporarySql); expect(temporary.request.sessionId).toBe(rwSession); const afterTemporaryHistory = await history(); expect(afterTemporaryHistory.map(entry => entry.sql)).toEqual([temporarySql]); expect(disk()).toEqual(baseline);
    await step(() => query().getByRole('button', { name: zh.common.transactionBegin, exact: true }).click()); await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeEnabled()); const inserted = await prepare(transactionSql); expect(inserted.request.sessionId).toBe(rwSession); expect(result(inserted.reply).transactionOpen).toBe(true); expect(disk()).toEqual(baseline);
    const transactionPlan = await explain(temporaryPlanSql); expect(transactionPlan.fact.request.sessionId).toBe(rwSession); expect(transactionPlan.outcome?.transactionOpen).toBe(true); if (!transactionPlan.outcome) throw Error('原TEMP计划结果丢失'); const temporaryPlan = inspectPlan(transactionPlan.outcome); expect(temporaryPlan.expectedNodes.some(node => /\b(?:SCAN|SEARCH) t\b/.test(node.detail) || node.detail.includes(temporaryName))).toBe(true); expect(disk()).toEqual(baseline);
    await step(() => query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).click()); await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeDisabled()); expect(operations(await step(audit), 'query.transaction').map(fact => fact.request)).toEqual([{ sessionId: rwSession, action: 'begin' }, { sessionId: rwSession, action: 'rollback' }]); expect(disk()).toEqual(baseline);
    stage = 'RW UPDATE仅规划零目标写入'; const dml = await explain(dmlSql); expect(dml.fact.request.sessionId).toBe(rwSession); expect(disk()).toEqual(baseline);
    stage = '副作用PRAGMA和多句在driver之前拒绝'; const pragma = await explain(pragmaSql, true); expect(disk()).toEqual(baseline); const multiple = await explain(multipleSql, true); expect(disk()).toEqual(baseline); const recovered = await explain(indexedSql); expect(recovered.fact.request.sessionId).toBe(rwSession); expect(disk()).toEqual(baseline);
    stage = '只读连接SELECT成功与原输入保持'; await openQuery(roName); const readonly = await explain(indexedSql); expect(readonly.fact.request.sessionId).not.toBe(rwSession); if (!readonly.outcome) throw Error('只读计划结果丢失'); const roPlan = inspectPlan(readonly.outcome); expect(roPlan.expectedNodes.some(node => node.detail.includes(indexName))).toBe(true); const firstFacts = await step(audit); expect(firstFacts.sessions[String(rwSession)]).toBe(rw.id); expect(firstFacts.sessions[String(readonly.fact.request.sessionId)]).toBe(ro.id); expect(firstFacts.denied).toEqual([]); expect(firstFacts.pickerIds).toHaveLength(2); expect(operations(firstFacts, 'query.explain')).toHaveLength(7); expect(operations(firstFacts, 'query.execute').map(fact => fact.request.sql).sort()).toEqual([temporarySql, transactionSql].sort()); expect(disk()).toEqual(baseline); expect(runtime.pageErrors).toEqual([]);
    const firstHistory = await history(); expect(firstHistory.map(entry => entry.sql).sort()).toEqual([temporarySql, transactionSql].sort()); expect(firstHistory.every(entry => entry.success)).toBe(true); const firstTasks = await tasks(); expect(firstTasks.filter(task => task.kind === 'query.explain').map(task => task.status).sort()).toEqual(['completed', 'completed', 'completed', 'completed', 'completed', 'failed', 'failed']);
    stage = '保存未执行写草稿并正常退出'; await write(restoredSql); const persisted = await settings(); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforeQuit = await step(audit); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteExplainNative?: { restore(): void } }).__sqliteExplainNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile恢复草稿不重放计划或执行'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid); await arm({ [rw.id]: false, [ro.id]: true }); armed = true; await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(await history()).toEqual(firstHistory); expect(await tasks()).toEqual(firstTasks); expect(disk()).toEqual(baseline); await step(() => expect(query().locator('.monaco-editor .view-lines')).toContainText('8888')); const secondFacts = await step(audit); expect(secondFacts.denied).toEqual([]); expect(secondFacts.pickerIds).toEqual([]); expect(operations(secondFacts, 'query.explain')).toEqual([]); expect(operations(secondFacts, 'query.execute')).toEqual([]); expect(secondFacts.driverSql).toEqual([]); expect(runtime.pageErrors).toEqual([]);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteExplainNative?: { restore(): void } }).__sqliteExplainNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(baseline);
    await info.attach('SQLite执行计划原请求driver帧及独立磁盘原件', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, mainSavedPathBeforePicker: canonicalDatabase, firstPid, secondPid: originalProcess.pid, baseline, finalDisk: disk(), first, localEvidence, temporary, inserted, transactionPlan, dml, pragma, multiple, recovered, readonly, firstFacts, beforeQuit, secondFacts, firstTasks, firstHistory, modelFacts, rawPlan: plan.raw, expectedNodesFromOriginalRows: plan.expectedNodes, originalPlannedSqlExecutions: 0, explicitFixturePreparations: [temporarySql, transactionSql], explainHistoryAdded: 0, rejectedInputDriverFrames: 0, independentDiskWritesAfterRollback: 0, allChildPostMessagePortsRestoredBeforeQuit: true, automaticRetry: false, automaticTrace: false, firstExitCode: 0, secondExitCode: originalProcess.exitCode, systemClipboardOperations: 0, inputScope: '仅本例官方Monaco API设置全文/EOL/caret，原菜单执行；不冒称实体键盘文字输入验收', pickerScope: '只替换自身Main chooser准确路径，不冒称验证OS对话框输入', observationScope: '每个原窗口就绪后安装至正常退出前恢复，child消息原样透传，不补造恢复前事实' }), contentType: 'application/json' }); completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteExplainNative?: Audit }).__sqliteExplainNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, sessions: state.sessions, commands: state.commands, operations: state.operations, events: state.events, driverSql: state.driverSql } : undefined; }); } catch { /* 原端口失效后不重建、不补造事实。 */ }
    try { await info.attach('SQLite执行计划失败原件保留', { body: JSON.stringify({ stage, directory, database, modelFacts, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, partial, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件失败不解除owner保留或覆盖首因。 */ } throw reason;
  }
});

/** 原ownedfixture完成两次准确正常退出后才核清理；专项不自行删除目录。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing, '原ownedfixture必须在成功退出后清理本例profile与SQLite').toBe(true); await info.attach('SQLite执行计划最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
