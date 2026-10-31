import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { currentStatementZh } from '../../src/renderer/locales/currentStatement.zh-CN';
import { queryFailureSourceZh } from '../../src/renderer/locales/queryFailureSource.zh-CN';

// 默认和--list只注册单个跳过项；原生App、NodeSQLite和文件观察均在显式专项内部加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_CURRENT_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)
    || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite当前语句仅允许Windows/macOS源码、integration=0与无外库认证环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite当前语句禁止自动trace');
}

type Desktop = typeof import('./desktop-fixture');
type Fact = { command: string; request: Record<string, unknown>; reply?: unknown; failure?: string };
interface Audit { pending: number; denied: string[]; forks: string[]; pickerIds: string[]; profiles: Record<string, boolean>; sessions: Record<string, string>; commands: string[]; operations: Fact[]; events: unknown[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_CURRENT_NATIVE_TEST=1、integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const rwName = 'SQLite当前语句本例读写', roName = 'SQLite当前语句本例只读';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 失败保留准确owner、原profile和数据库，禁止自动重试、强停或清理。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite当前语句未完成两次正常退出，原现场已保留'); } });

test('SQLite真实菜单及快捷键只执行当前语句、完整触发器与原事务，准确失败定位且重启不重放', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop;
  const { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-current-statement-native.sqlite');
  let closed = false, armed = false, stage = '独占合成SQLite准备';
  /** 所有异步边界只承认本例准确owner与原120秒单次期限。 */
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite当前语句owner/profile/120秒单次期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteCurrentNative?: Audit & { check(): void } }).__sqliteCurrentNative; if (!state) throw Error('原SQLite当前语句观察器不存在'); state.check(); return { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, sessions: state.sessions, commands: state.commands, operations: state.operations, events: state.events }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const query = () => page.locator('.query-tab:visible');
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  /** 原始IPC必须有成功封套才读取结果，不用UI预期伪造查询或会话事实。 */
  const result = (reply: unknown): Record<string, unknown> => { if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true || !('result' in reply) || !reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result)) throw Error('SQLite当前语句没有成功原IPC结果'); return reply.result as Record<string, unknown>; };
  const operations = (facts: Audit, command: string) => facts.operations.filter(operation => operation.command === command);
  type Script = { name: string; source: string; selected: string; offset: number; current: boolean; start: number; end: number };
  /** 预期范围由本例固定三段文本独立给出，不调用产品分句器来生成自己的断言。 */
  const marked = (name: string, value: string, id: number): Script => {
    const point = value.indexOf('┃'); if (point < 0 || point !== value.lastIndexOf('┃')) throw Error('本例必须恰好一个caret标记');
    const prefix = `-- 前哨中文🚢 ${name}\r\nINSERT INTO guards VALUES(${id},'前哨;?中文');\r\n`, selected = value.replace('┃', ''), suffix = `;\r\nINSERT INTO guards VALUES(${id + 1},'后哨;?中文');`;
    return { name, source: prefix + selected + suffix, selected, offset: prefix.length + point, current: true, start: prefix.length, end: prefix.length + selected.length };
  };
  const insert = marked('中间INSERT', "/* 注释中文🚢 ; ? */\r\nINSERT INTO subject(id,note) VA┃LUES(10,'中间;?''中文🚢')", 101);
  const select = marked('中间SELECT', "SELECT 9223372036854775807 AS exact_int,'🧭┃当前;?''中文' AS marker,COUNT(*) AS total FROM subject", 103);
  const trigger = marked('完整TRIGGER', 'CREATE TRIGGER "当前;?触发🚢" AFTER INSERT ON subject\r\nBEGIN\r\n INSERT INTO audit VALUES(NEW.id,\'触发一;?\'\'中文\');\r\n INSERT INTO audit VALUES(NEW.id,\'触发二┃🚢\');\r\nEND', 105);
  const ordinarySql = "INSERT INTO subject(id,note) VALUES(20,'普通插入🚢');";
  const ordinary: Script = { name: '原普通执行', source: ordinarySql, selected: ordinarySql, offset: 0, current: false, start: 0, end: ordinarySql.length };
  const transactionInsert = marked('原事务写', "INSERT INTO subject(id,note) ┃VALUES(30,'明确回滚🚢')", 107);
  const transactionRead = marked('原事务读', 'SELECT COUNT(*) AS visi┃ble FROM subject', 109);
  const syntax = marked('准确语法错', "SELEC '错误🚢┃;?''中文' AS bad", 111);
  const readonlyWrite = marked('只读写拒绝', "INSERT INTO subject(id,note) ┃VALUES(40,'只读必须拒绝')", 113);
  const readonlyRead = marked('只读SELECT', 'SELECT COUNT(*) AS tota┃l FROM subject', 115);
  const scripts = [insert, select, trigger, ordinary, transactionInsert, transactionRead, syntax, readonlyWrite, readonlyRead];
  const restoredSql = "-- 正常重启仅恢复草稿🚢\r\nINSERT INTO guards VALUES(999,'原未执行写哨兵');";
  /** 独立磁盘读回每次使用只读新句柄；原用户事务在另一物理连接中不可见。 */
  const disk = () => { check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('当前语句磁盘观察越过本例目录'); const db = new DatabaseSync(database, { readOnly: true }); try { return { subject: db.prepare('SELECT CAST(id AS TEXT) AS id,note FROM subject ORDER BY id').all(), guards: db.prepare('SELECT * FROM guards ORDER BY id').all(), audit: db.prepare('SELECT CAST(id AS TEXT) AS id,note FROM audit ORDER BY id,note').all(), triggers: db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all(), control: db.prepare('SELECT * FROM control').all() }; } finally { db.close(); check(); } };
  /** 仅替换两次自身文件chooser的准确路径；IPC、授权、SQLite任务和事件全部真实透传。 */
  const arm = (savedProfiles: Record<string, boolean> = {}) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __sqliteCurrentNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork, originalSend = window?.webContents.send;
    if (typeof original !== 'function' || windows.length !== 1 || !frame || !originalSend || root.__sqliteCurrentNative) throw Error('SQLite当前语句原Main入口未知');
    const state: State = { pending: 0, denied: [], forks: [], pickerIds: [], profiles: { ...input.savedProfiles }, sessions: {}, commands: [], operations: [], events: [], check() {}, restore() {} };
    let pickerRequest: string | undefined;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite当前语句专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteCurrentNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.webContents.send !== send || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite当前语句原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions; if (Object.keys(input.savedProfiles).length || !pickerRequest || state.pickerIds.includes(pickerRequest) || state.pickerIds.length >= 2 || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker'); state.pickerIds.push(pickerRequest); return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
    const save = (() => deny('未授权保存对话框')) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => { check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]); }) as typeof utilityProcess.fork;
    const send = ((channel: string, ...args: unknown[]) => { if (channel === 'dbark:task') state.events.push(structuredClone(args[0])); return Reflect.apply(originalSend, window.webContents, [channel, ...args]); }) as typeof window.webContents.send;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC'); const command = payload.command, value = payload.input as Record<string, unknown>;
      if (/clipboard/i.test(command) || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('sqlite.') || command.startsWith('serverMonitor.') || command.startsWith('files.') && command !== 'files.choose' || command.startsWith('excel.')) return deny(command);
      if (command.startsWith('query.') && !['query.execute', 'query.sessionState', 'query.completionState', 'query.transaction', 'query.cancel'].includes(command) || command.startsWith('sessions.') && !['sessions.open', 'sessions.close'].includes(command)) return deny('非本例查询命令：' + command);
      if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId) return deny('文件用途/连接归属'); pickerRequest = value.sqliteConnectionId; }
      if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite, readOnly = value.name === input.rwName ? false : value.name === input.roName ? true : undefined; if (value.dialect !== 'sqlite' || typeof value.id !== 'string' || !state.pickerIds.includes(value.id) || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== readOnly || readOnly === undefined || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例明确读写/只读配置'); state.profiles[value.id] = readOnly; }
      if (command === 'connections.open' && !Object.hasOwn(state.profiles, String(value.id)) || command.startsWith('metadata.') && !Object.hasOwn(state.profiles, String(value.connectionId))) return deny('其它数据库连接');
      if (command === 'sessions.open' && (!Object.hasOwn(state.profiles, String(value.connectionId)) || value.database !== 'main')) return deny('其它查询连接/数据库');
      if ((command.startsWith('query.') || command === 'sessions.close') && command !== 'query.cancel' && (!String(value.sessionId).startsWith('sqlite:') || !Object.hasOwn(state.sessions, String(value.sessionId)))) return deny('非本例准确SQLite会话');
      // 原QueryTab在执行收尾读取协议缓存更新面包屑，不附加SQL；只允许本例准确sessionId一个字段。
      if (command === 'query.completionState' && (typeof value.sessionId !== 'string' || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'sessionId'))) return deny('非本例会话协议缓存请求');
      if (command === 'query.cancel' && !state.operations.some(operation => operation.command === 'query.execute' && operation.request.taskId === value.taskId)) return deny('其它查询任务取消');
      if (command === 'query.transaction' && !['begin', 'rollback'].includes(String(value.action))) return deny('非本例明确事务动作');
      if (command === 'query.execute') { const script = input.scripts.find(script => script.source === value.sql), current = value.currentStatement; if (!script || value.continueOnError === true || value.collectWarnings === true) return deny('非本例全文/执行选项'); if (script.offset === undefined ? current !== undefined : !current || typeof current !== 'object' || Object.keys(current).length !== 1 || !('offset' in current) || current.offset !== script.offset) return deny('非本例准确光标'); }
      const fact: Fact | undefined = command.startsWith('query.') || command.startsWith('sessions.') ? { command, request: structuredClone(value) } : undefined; if (fact) state.operations.push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply);
        if (command === 'sessions.open' && reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply && reply.result && typeof reply.result === 'object' && 'sessionId' in reply.result && typeof reply.result.sessionId === 'string') { if (!reply.result.sessionId.startsWith('sqlite:')) return deny('会话未由SQLite签发'); state.sessions[reply.result.sessionId] = String(value.connectionId); } return reply;
      } catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; } finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('SQLite当前语句请求仍在途'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; window.webContents.send = originalSend; delete root.__sqliteCurrentNative; };
    root.__sqliteCurrentNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; window.webContents.send = send; check();
  }, { database, savedProfiles, rwName, roName, scripts: scripts.map(script => ({ source: script.source, offset: script.current ? script.offset : undefined })) }));
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
  /** 原菜单/原Monaco按键只发一次；真实IPC、Task终态和停止按钮共同确认结束。 */
  const run = async (script: Script, shortcut = false, failed = false) => {
    await write(script.source, script.offset); const before = operations(await step(audit), 'query.execute').length;
    if (!script.current) await step(() => page.keyboard.press(modifier + '+Enter'));
    else if (shortcut) await step(() => page.keyboard.press(modifier + '+Shift+Enter'));
    else await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(query(), { name: currentStatementZh.action, exact: true }, check)).click());
    await step(() => expect.poll(async () => { const executions = operations(await audit(), 'query.execute'); return executions.length === before + 1 && executions.at(-1)?.reply !== undefined; }).toBe(true)); const fact = operations(await step(audit), 'query.execute').at(-1); expect(fact?.failure).toBeUndefined();
    expect(fact?.request.sql).toBe(script.source); if (script.current) expect(fact?.request.currentStatement).toEqual({ offset: script.offset }); else expect(fact?.request).not.toHaveProperty('currentStatement');
    const outcome = result(fact?.reply); if (failed) expect(outcome).toHaveProperty('failure'); else { expect(outcome).not.toHaveProperty('failure'); expect(outcome.results).toHaveLength(1); }
    await step(() => expect.poll(async () => (await tasks()).find(task => task.id === fact?.request.taskId)?.status).toBe(failed ? 'failed' : 'completed'));
    await step(async () => expect(await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(query(), { name: zh.common.stop, exact: true }, check)).toBeDisabled());
    expect((await model()).source).toBe(script.source); expect(disk().guards).toEqual([]); return { fact, outcome };
  };
  /** 只接受真实TaskEvent在driver statement头后发布的实际SQL，不能从全文猜测历史。 */
  const emittedSql = (facts: Audit, taskId: unknown) => facts.events.flatMap(event => event && typeof event === 'object' && 'taskId' in event && event.taskId === taskId && 'executionSql' in event && typeof event.executionSql === 'string' ? [event.executionSql] : []);
  /** SQLite可不消费leading注释；只核真实header，仍要求它完整包含选中INSERT且绝不越出原范围。 */
  const insertHeader = async (fact: Fact | undefined) => { const headers = emittedSql(await step(audit), fact?.request.taskId); expect(headers).toHaveLength(1); const header = headers[0], body = "INSERT INTO subject(id,note) VALUES(10,'中间;?''中文🚢')"; expect(insert.selected.endsWith(header)).toBe(true); expect(header.endsWith(body)).toBe(true); return header; };
  const assertHistory = async (expected: string[]) => { const entries = await history(); expect(entries.map(entry => entry.sql).sort()).toEqual([...expected].sort()); for (const entry of entries) { expect(entry.sql).not.toContain('INSERT INTO guards'); expect(entry.sql).not.toContain('前哨中文'); } return entries; };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    stage = '原空工作台在Monaco ESM首读前启用官方globalAPI';
    await step(() => page.addInitScript(() => { let environment: Record<string, unknown> = { globalAPI: true }; Object.defineProperty(window, 'MonacoEnvironment', { configurable: true, get: () => environment, set: (value: unknown) => { environment = value && typeof value === 'object' && !Array.isArray(value) ? { ...value, globalAPI: true } : { globalAPI: true }; } }); })); await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
    expect(await step(() => page.evaluate(() => typeof (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors))).toBe('function'); expect((await settings()).tabs).toEqual([]);
    const db = new DatabaseSync(database); try { db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT NOT NULL); CREATE TABLE guards(id INTEGER PRIMARY KEY,note TEXT); CREATE TABLE audit(id INTEGER,note TEXT); CREATE TABLE control(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO control VALUES(1,\'原控制行保持\');'); } finally { db.close(); }
    // Main配置保存沿默认realpathSync；worker原生文件身份另用native，不能混为同一个路径文本协议。
    const canonicalDatabase = realpathSync(database), baseline = { subject: [], guards: [], audit: [], triggers: [], control: [{ id: 1, note: '原控制行保持' }] }; expect(disk()).toEqual(baseline); await arm(); armed = true;
    stage = '真实RW/RO连接表单与原QueryTab'; await createConnection(rwName, false); await createConnection(roName, true); const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(2); const rw = profiles.find(profile => profile.name === rwName), ro = profiles.find(profile => profile.name === roName); if (!rw || rw.dialect !== 'sqlite' || !ro || ro.dialect !== 'sqlite') throw Error('当前语句RW/RO配置未保持SQLite'); expect(rw.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: false }); expect(ro.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true }); for (const profile of [rw, ro]) { expect(profile.sqlite.fileToken).toBeUndefined(); for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(field); }
    await openQuery(rwName); expect((await settings()).tabs).toHaveLength(1); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    stage = '菜单中句INSERT不运行前后哨兵'; const inserted = await run(insert), actualInsertSql = await insertHeader(inserted.fact); expect(result(inserted.fact?.reply)).toMatchObject({ results: [{ affectedRows: 1, statement: actualInsertSql }] }); const afterInsert = { ...baseline, subject: [{ id: '10', note: "中间;?'中文🚢" }] }; expect(disk()).toEqual(afterInsert); await assertHistory([actualInsertSql]);
    stage = 'CtrlMetaShiftEnter中句SELECT精度及中文引号'; const selected = await run(select, true); expect(result(selected.fact?.reply)).toMatchObject({ results: [{ statement: select.selected, rows: [{ c0: '9223372036854775807', c1: "🧭当前;?'中文", c2: '1' }] }] }); await step(() => expect(query().getByRole('grid').getByText('9223372036854775807', { exact: true })).toBeVisible()); expect(disk()).toEqual(afterInsert); expect(emittedSql(await step(audit), selected.fact?.request.taskId)).toEqual([select.selected]);
    stage = 'trigger体内caret创建整个定义且不执行相邻DML'; const created = await run(trigger); expect(result(created.fact?.reply)).toMatchObject({ results: [{ statement: trigger.selected }] }); const afterTrigger = { ...afterInsert, triggers: [{ name: '当前;?触发🚢', sql: trigger.selected }] }; expect(disk()).toEqual(afterTrigger); expect(emittedSql(await step(audit), created.fact?.request.taskId)).toEqual([trigger.selected]);
    stage = '原普通CtrlEnter执行插入触发两条内部语句'; const normal = await run(ordinary); const afterNormal = { ...afterTrigger, subject: [...afterInsert.subject, { id: '20', note: '普通插入🚢' }], audit: [{ id: '20', note: "触发一;?'中文" }, { id: '20', note: '触发二🚢' }] }; expect(disk()).toEqual(afterNormal); const rwSession = inserted.fact?.request.sessionId; expect(typeof rwSession).toBe('string'); for (const execution of [selected, created, normal]) expect(execution.fact?.request.sessionId).toBe(rwSession);
    stage = '准确原会话BEGIN当前写与ROLLBACK独立观察'; await step(() => query().getByRole('button', { name: zh.common.transactionBegin, exact: true }).click()); await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeEnabled()); const txWritten = await run(transactionInsert, true); expect(txWritten.fact?.request.sessionId).toBe(rwSession); expect(txWritten.outcome.transactionOpen).toBe(true); expect(disk()).toEqual(afterNormal); const txRead = await run(transactionRead); expect(txRead.fact?.request.sessionId).toBe(rwSession); expect(txRead.outcome).toMatchObject({ transactionOpen: true, results: [{ rows: [{ c0: '3' }] }] }); expect(disk()).toEqual(afterNormal);
    await step(() => query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).click()); await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeDisabled()); const transactionFacts = operations(await step(audit), 'query.transaction'); expect(transactionFacts.map(fact => fact.request)).toEqual([{ sessionId: rwSession, action: 'begin' }, { sessionId: rwSession, action: 'rollback' }]); expect(disk()).toEqual(afterNormal);
    const successfulSql = [actualInsertSql, select.selected, trigger.selected, ordinary.source, transactionInsert.selected, transactionRead.selected]; await assertHistory(successfulSql);
    stage = '语法错误保原CRLF非BMP范围且无伪造历史'; const historyBeforeSyntax = await history(), syntaxFailure = await run(syntax, true, true); expect(syntaxFailure.outcome).toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start: syntax.start, end: syntax.end } } }); expect(emittedSql(await step(audit), syntaxFailure.fact?.request.taskId)).toEqual([]); expect(await history()).toEqual(historyBeforeSyntax); expect(disk()).toEqual(afterNormal);
    const locate = query().getByRole('button', { name: queryFailureSourceZh.locate, exact: true }); await step(() => expect(locate).toBeEnabled()); await step(() => locate.click()); const located = await model(); expect(located.source).toBe(syntax.source); expect(located.eol).toBe('\r\n'); expect(located.selections).toEqual([{ start: syntax.start, end: syntax.end }]); expect(syntax.source.slice(syntax.start, syntax.end)).toBe(syntax.selected); expect(operations(await step(audit), 'query.execute')).toHaveLength(7);
    stage = '只读连接当前写拒绝但SELECT仍可用'; await openQuery(roName); const historyBeforeReadonly = await history(), denied = await run(readonlyWrite, false, true); expect(denied.outcome).toMatchObject({ failure: { sourceRange: { start: readonlyWrite.start, end: readonlyWrite.end } } }); expect(emittedSql(await step(audit), denied.fact?.request.taskId)).toEqual([]); expect(await history()).toEqual(historyBeforeReadonly); expect(disk()).toEqual(afterNormal);
    const read = await run(readonlyRead, true); expect(read.fact?.request.sessionId).not.toBe(rwSession); expect(read.outcome).toMatchObject({ results: [{ statement: readonlyRead.selected, rows: [{ c0: '2' }] }] }); const firstFacts = await step(audit); expect(firstFacts.sessions[String(rwSession)]).toBe(rw.id); expect(firstFacts.sessions[String(read.fact?.request.sessionId)]).toBe(ro.id); expect(firstFacts.denied).toEqual([]); expect(firstFacts.pickerIds).toHaveLength(2); expect(operations(firstFacts, 'query.execute')).toHaveLength(9); expect(disk()).toEqual(afterNormal); const firstHistory = await assertHistory([...successfulSql, readonlyRead.selected]); expect(firstHistory.every(entry => entry.success)).toBe(true); expect(runtime.pageErrors).toEqual([]);
    stage = '保存未执行写草稿并正常退出'; const tabs = await settings(), rwTab = tabs.tabs.find(tab => tab.connectionId === rw.id && tab.kind === 'query'); if (!rwTab) throw Error('原读写QueryTab丢失'); await step(() => page.locator(`[data-workspace-tab-id="${rwTab.id}"]`).getByRole('button', { name: rwTab.title, exact: true }).click()); await step(() => expect(query().locator('.monaco-editor')).toBeVisible()); await write(restoredSql); const persisted = await settings(), firstTasks = await tasks(); expect(firstTasks.filter(task => task.kind === 'query.execute').map(task => task.status).sort()).toEqual(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'failed', 'failed']); expect(operations(await step(audit), 'query.execute')).toHaveLength(9); expect(disk()).toEqual(afterNormal);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); const beforeQuit = await step(audit); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteCurrentNative?: { restore(): void } }).__sqliteCurrentNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile新owner恢复全文不重放SQL'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid); await arm({ [rw.id]: false, [ro.id]: true }); armed = true; await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(await history()).toEqual(firstHistory); expect(await tasks()).toEqual(firstTasks); expect(disk()).toEqual(afterNormal); await step(() => expect(query().locator('.monaco-editor .view-lines')).toContainText('原未执行写哨兵'));
    const secondFacts = await step(audit); expect(secondFacts.denied).toEqual([]); expect(secondFacts.pickerIds).toEqual([]); expect(operations(secondFacts, 'query.execute')).toEqual([]); expect(operations(secondFacts, 'query.transaction')).toEqual([]); expect(runtime.pageErrors).toEqual([]); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteCurrentNative?: { restore(): void } }).__sqliteCurrentNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(afterNormal);
    await info.attach('SQLite当前语句真实原源光标历史及磁盘原件', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, canonicalDatabaseBeforePicker: canonicalDatabase, firstPid, secondPid: originalProcess.pid, scripts, modelFacts, baseline, finalDisk: disk(), firstFacts, beforeQuit, secondFacts, firstHistory, firstTasks, syntaxFailure, located, readonlyFailure: denied, currentRequests: 8, ordinaryRequests: 1, nativeCurrentStatementsWithHeader: 6, prePostSentinelWrites: 0, userTransactionActions: ['begin', 'rollback'], sameSessionRollback: true, prepareFailureHistoryAdded: 0, sourceCRLFAndUtf16Observed: true, inputScope: '仅本例官方Monaco模型API设置全文/EOL/caret；真实菜单和按键执行，不冒称实体键盘文字输入验收', pickerScope: '只替换两次自身Main chooser准确路径，不冒称验证OS原生对话框输入', observationScope: '每个原窗口就绪后安装至正常退出前撤销，不补造恢复前事实', systemClipboardOperations: 0, firstExitCode: 0, secondExitCode: originalProcess.exitCode, automaticRetry: false, automaticTrace: false }), contentType: 'application/json' }); completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteCurrentNative?: Audit }).__sqliteCurrentNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, sessions: state.sessions, commands: state.commands, operations: state.operations, events: state.events } : undefined; }); } catch { /* 原端口失效不重建、不补造事实。 */ }
    try { await info.attach('SQLite当前语句失败原件保留', { body: JSON.stringify({ stage, directory, database, modelFacts, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, partial, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件失败不解除owner保留，也不覆盖首因。 */ } throw reason;
  }
});

/** 只有原ownedfixture完成两个准确正常owner退出后才核清理，不自行删除目录。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing, '原ownedfixture必须在成功退出后清理本例profile与SQLite').toBe(true); await info.attach('SQLite当前语句最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
