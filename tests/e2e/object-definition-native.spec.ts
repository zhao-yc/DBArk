import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { objectDefinitionZh as text } from '../../src/renderer/locales/objectDefinition.zh-CN';
import { objectDefinitionInputSchema, assertObjectDefinitionOutput, type ObjectDefinitionOutput } from '../../src/shared/objectDefinition';

// 默认和列举只注册跳过项，不加载desktop、NodeSQLite、文件、数据库或系统剪贴板。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_OBJECT_DEFINITION_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_/i.test(key) && !['DBARK_OBJECT_DEFINITION_NATIVE_TEST', 'DBARK_INTEGRATION_ENABLED'].includes(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|DB_|DATABASE_|SSH_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)
    || /^PLAYWRIGHT_.*(?:TRACE|TIMEOUT|WORKER|RETRIES)/i.test(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('对象结构专项仅允许Windows/macOS源码、integration=0及独占SQLite文件；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('对象结构专项禁止自动trace覆盖');
}

type Desktop = typeof import('./desktop-fixture');
interface Fact { command: string; request: Record<string, unknown>; reply?: unknown; failure?: string; }
interface WorkerFact { module: string; opens: string[]; exit?: number; kills: number; }
interface Audit { pending: number; denied: string[]; commands: string[]; facts: Fact[]; pickerIds: string[]; profilePaths: Record<string, string>; sessions: string[]; workers: WorkerFact[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：DBARK_OBJECT_DEFINITION_NATIVE_TEST=1且integration=0，使用本例独占A/B合成SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const nameA = '对象结构本例A', nameB = '对象结构本例B', savedNameB = '对象结构本例B已保存';
const bootstrap = "CREATE TEMP TABLE subject(temp_marker TEXT DEFAULT 'OBJECT_DEFINITION_A_TEMP',id INTEGER); INSERT INTO temp.subject VALUES('OBJECT_DEFINITION_TEMP_A',1); BEGIN;";
let completed: { directory: string; databases: string[]; platform: string; pid?: number } | undefined;
let failureSnapshot: (() => unknown) | undefined;

/** 失败保留原owner、profile和数据库；不重启、不重试、不强制终止或自行删目录。 */
test.afterEach(async ({}, info) => {
  if (active && info.status !== 'skipped' && !completed) {
    (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info);
    try { await info.attach('对象结构停链原件', { body: JSON.stringify(failureSnapshot?.() ?? { stage: '尚未捕获原owner' }), contentType: 'application/json' }); } catch { /* 附件失败不解除所属资源保留。 */ }
    throw Error('对象结构专项未完成准确正常退出，保留原窗口和独占profile');
  }
});

test('活动A查询在树选B及概要替换后仍由更多和右键读取A完整定义，原会话TEMP和事务保持', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { join, basename, dirname, resolve } = require('node:path') as typeof import('node:path'), { realpathSync } = require('node:fs') as typeof import('node:fs');
  const owner = runtime.ownedDesktopResources(info), { application, page } = owner, originalProcess = application.process(), directory = runtime.dataDir;
  const databases = [join(directory, 'object-definition-a.sqlite'), join(directory, 'object-definition-b.sqlite')];
  let closed = false, armed = false, stage = '官方Monaco观察及独占文件准备';
  const pageErrors: string[] = []; page.on('pageerror', reason => pageErrors.push(reason.stack ?? reason.message));
  failureSnapshot = () => ({ stage, directory, databases, pid: originalProcess.pid, closed, armed, exitCode: originalProcess.exitCode, signal: originalProcess.signalCode, automaticRetry: false, automaticRestart: false, automaticForceStop: false });
  /** 每个异步边界核捕获的同一应用、页面、profile和原120秒单worker零重试合同。 */
  const check = () => { const now = runtime.ownedDesktopResources(info); if (now.application !== application || now.page !== page || (closed ? originalProcess.exitCode !== 0 : application.process() !== originalProcess) || now.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.repeatEach !== 1 || info.config.workers !== 1) throw Error('对象结构原owner/profile/期限已经变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __objectDefinitionNative?: Audit & { check(): void } }).__objectDefinitionNative; if (!state) throw Error('原对象结构Main观察器缺失'); state.check(); return { pending: state.pending, denied: state.denied, commands: state.commands, facts: state.facts, pickerIds: state.pickerIds, profilePaths: state.profilePaths, sessions: state.sessions, workers: state.workers }; });
  const step = async <T,>(action: () => Promise<T>, skipAfter = false): Promise<T> => { check(); if (armed && !closed) { await audit(); check(); } const value = await action(); check(); if (armed && !closed && !skipAfter) { await audit(); check(); } return value; };
  const query = () => page.locator('.query-tab:visible'), dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const facts = (value: Audit, command: string) => value.facts.filter(fact => fact.command === command);
  /** 成功封套只解码原Main回包，不提供可替代产品回复的路径。 */
  const unwrap = (raw: unknown): any => { if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !('result' in raw)) throw Error('缺少真实Main成功封套'); return raw.result; };
  /** 完整主目录及所有合成业务表全行均由独立只读观察连接核对，观察后准确关闭。 */
  const disk = () => databases.map((path, index) => {
    check(); if (dirname(resolve(path)) !== resolve(directory)) throw Error('对象结构磁盘观察越过本例目录');
    const db = new DatabaseSync(path, { readOnly: true });
    try { return { schema: db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all(), subject: db.prepare(index ? 'SELECT b_only_marker,id FROM subject ORDER BY id' : 'SELECT main_marker,id FROM subject ORDER BY id').all(), control: db.prepare('SELECT * FROM outside_control ORDER BY id').all() }; }
    finally { db.close(); check(); }
  });
  /** 唯一替换为两次准确OS chooser路径；原IPC、Main、broker和SQLite Worker全程真实透传。 */
  const arm = (canonicalPaths: string[]) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>; type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __objectDefinitionNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork;
    if (!original || !window || !frame || BrowserWindow.getAllWindows().length !== 1 || root.__objectDefinitionNative) throw Error('对象结构原Main/准确帧未知');
    const state: State = { pending: 0, denied: [], commands: [], facts: [], pickerIds: [], profilePaths: {}, sessions: [], workers: [], check() {}, restore() {} };
    const releases: (() => void)[] = []; let pickerRequest: string | undefined;
    const deny = (name: string): never => { state.denied.push(name); throw Error('对象结构离线专项拒绝：' + name); };
    const check = () => { if (root.__objectDefinitionNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('对象结构原Main观察器/窗口/文档已变化'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions, index = state.pickerIds.length; if (args[0] !== window || !pickerRequest || index >= 2 || !options?.properties?.includes('openFile')) return deny('非本例两文件chooser'); state.pickerIds.push(pickerRequest); state.profilePaths[pickerRequest] = input.paths[index]; return { canceled: false, filePaths: [input.paths[index]] }; }) as typeof dialog.showOpenDialog;
    const save = (() => deny('未授权保存对话框')) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => {
      check(); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility worker');
      const child = Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]) as Electron.UtilityProcess, record: WorkerFact = { module: modulePath, opens: [], kills: 0 }; state.workers.push(record);
      const post = child.postMessage, kill = child.kill;
      const wrappedPost = ((...messages: unknown[]) => { check(); const raw = messages[0] as { kind?: unknown; options?: { path?: unknown } } | undefined; if (raw?.kind === 'open') { if (typeof raw.options?.path !== 'string' || !input.paths.includes(raw.options.path)) return deny('SQLite文件越界'); record.opens.push(raw.options.path); } return Reflect.apply(post, child, messages); }) as typeof child.postMessage;
      const wrappedKill = () => { record.kills++; return Reflect.apply(kill, child, []); }; child.postMessage = wrappedPost; child.kill = wrappedKill; child.once('exit', code => { record.exit = code; });
      releases.push(() => { if (child.postMessage !== wrappedPost || child.kill !== wrappedKill) throw Error('原SQLite Worker观察器变化'); child.postMessage = post; child.kill = kill; }); return child;
    }) as typeof utilityProcess.fork;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame || !payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('外来文档或非标准IPC');
      const command = payload.command, value = payload.input as Record<string, unknown>;
      if (/clipboard/i.test(command) || /^(?:table|schema|serverMonitor)\./.test(command) || ['files.path', 'files.export', 'files.exportResult', 'excel.export'].includes(command)) return deny(command);
      if (command.startsWith('query.') && !['query.objectDefinition', 'query.execute', 'query.transaction', 'query.sessionState', 'query.completionState', 'query.cancel'].includes(command) || command.startsWith('sessions.') && !['sessions.open', 'sessions.close'].includes(command) || command.startsWith('sqlite.') && command !== 'sqlite.completion' || command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest || state.pickerIds.length >= 2 || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string') return deny('chooser不是本例连接'); pickerRequest = value.sqliteConnectionId; }
      if (command === 'connections.save' || command === 'connections.test') {
        const config = value.sqlite, index = state.pickerIds.indexOf(String(value.id)), names = index === 0 ? [input.names[0]] : [input.names[1], input.names[2]];
        if (command === 'connections.test' || index < 0 || !names.includes(String(value.name)) || value.dialect !== 'sqlite' || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== false || 'filePath' in config && config.filePath !== undefined && config.filePath !== input.paths[index] || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例SQLite表单配置');
      }
      if (command === 'connections.open' && !Object.hasOwn(state.profilePaths, String(value.id)) || typeof value.connectionId === 'string' && !Object.hasOwn(state.profilePaths, value.connectionId)) return deny('连接不属本例');
      if (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !state.sessions.includes(value.sessionId) || !value.sessionId.startsWith('sqlite:'))) return deny('session不属本例');
      if (command === 'sessions.open' && (value.connectionId !== state.pickerIds[0] || state.sessions.length !== 0)) return deny('非唯一明确执行创建的A原session');
      if (command === 'query.execute' && (typeof value.sql !== 'string' || value.sql.replaceAll('\r\n', '\n') !== input.bootstrap || value.currentStatement !== undefined || state.facts.some(fact => fact.command === command))) return deny('非本例唯一固定bootstrap脚本');
      if (command === 'query.transaction' && value.action !== 'rollback') return deny('非明确原事务回滚');
      if (command === 'query.cancel' && (typeof value.taskId !== 'string' || !/^(?:object-definition:|sqlite-completion:)/.test(value.taskId))) return deny('取消不是本例目录任务');
      if (command === 'query.objectDefinition' && (value.connectionId !== state.pickerIds[0] || !['subject', 'subject_view'].includes(String(value.table)) || value.database !== undefined && value.database !== 'main' || typeof value.taskId !== 'string' || !value.taskId.startsWith('object-definition:') || Object.keys(value).some(key => !['connectionId', 'sessionId', 'database', 'table', 'taskId'].includes(key)))) return deny('对象读取不是准确A关系');
      const observed = command.startsWith('query.') || command.startsWith('sessions.') || command === 'connections.save';
      const fact: Fact | undefined = observed ? { command, request: structuredClone(value) } : undefined; if (fact) state.facts.push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply); if (command === 'sessions.open' && reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply && reply.result && typeof reply.result === 'object' && 'sessionId' in reply.result && typeof reply.result.sessionId === 'string') state.sessions.push(reply.result.sessionId); return reply; }
      catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; }
      finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending || state.workers.some(worker => worker.exit !== 0 || worker.kills !== 0)) throw Error('原Main/SQLite Worker尚未真实终结'); for (const release of releases) release(); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; delete root.__objectDefinitionNative; };
    root.__objectDefinitionNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; check();
  }, { paths: canonicalPaths, names: [nameA, nameB, savedNameB], bootstrap }));
  /** 官方API只观察原查询编辑器，正文和光标只通过真实键盘写入。 */
  const model = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    const editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && !!node.closest('.query-tab') && !node.closest('[data-object-definition]') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('原查询Monaco实例不唯一'); const editor = editors[0], model = editor.getModel(), position = editor.getPosition(); if (!model || !position || model.isDisposed()) throw Error('原查询模型不可用');
    return { uri: model.uri.toString(), version: model.getVersionId(), source: model.getValue(), offset: model.getOffsetAt(position), canUndo: model.canUndo(), canRedo: model.canRedo() };
  }));
  const write = async (sql: string) => { await step(() => page.keyboard.press('Escape')); await step(() => query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press(modifier + '+A')); await step(() => page.keyboard.insertText(sql)); await step(() => expect.poll(async () => { const state = await settings(); return state.tabs.find(tab => tab.id === state.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(sql)); };
  /** 用文档首和真实ArrowRight定位完整限定词，不调用模型setValue/setPosition。 */
  const at = async (marked: string) => { const index = marked.indexOf('|'); if (index < 0 || index !== marked.lastIndexOf('|')) throw Error('本例光标标记不唯一'); const sql = marked.replace('|', ''); await write(sql); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')); for (const _character of marked.slice(0, index)) await step(() => page.keyboard.press('ArrowRight')); const result = await model(); expect(result.source.replaceAll('\r\n', '\n')).toBe(sql); expect(result.offset).toBe(index); return result; };
  /** 菜单动作由真实产品菜单定位，不点击隐藏工具栏控件。 */
  const clickMenu = (scope: import('@playwright/test').Locator, name: string) => step(async () => { const item = await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(scope, { name, exact: true }, check); check(); await expect(item).toBeVisible(); check(); await item.click(); check(); });
  const readProofs: unknown[] = [];
  let tabId = '', connectionA = '';
  /** 两入口都经原UI；实际DDL取只读Monaco模型，并与Main原回包及原查询模型逐项核对。 */
  const read = async (marked: string, gesture: 'more' | 'context', expected: { name: string; kind: 'table' | 'view'; schema: 'main' | 'temp'; marker: string; session?: string }) => {
    const before = await at(marked), previous = facts(await step(audit), 'query.objectDefinition').length, stateBefore = await settings();
    if (gesture === 'more') await clickMenu(query(), text.entry);
    else {
      const point = await step(() => page.evaluate(offset => { const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => editor.hasTextFocus()); if (editors?.length !== 1) throw Error('右键原聚焦编辑器不唯一'); const editor = editors[0], model = editor.getModel(), node = editor.getDomNode(); if (!model || !node) throw Error('右键原模型失效'); const position = editor.getScrolledVisiblePosition(model.getPositionAt(offset)); if (!position) throw Error('右键原词不可见'); const box = node.getBoundingClientRect(); return { x: box.left + position.left + 1, y: box.top + position.top + position.height / 2 }; }, before.offset));
      await step(() => page.mouse.click(point.x, point.y, { button: 'right' })); const item = page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: text.entry, exact: true }); await step(() => expect(item).toBeVisible()); // Monaco原菜单延迟100ms安装mouseup监听；真实按下保持120ms，避免测试在监听安装前瞬时松开。
      await step(() => item.click({ delay: 120 }));
    }
    await step(() => expect(dialog()).toBeVisible()); await step(() => expect(dialog().getByRole('status')).toContainText(expected.schema));
    await step(() => expect.poll(async () => facts(await audit(), 'query.objectDefinition').filter(fact => fact.reply !== undefined).length).toBe(previous + 1));
    const fact = facts(await step(audit), 'query.objectDefinition').at(-1)!, request = objectDefinitionInputSchema.parse(fact.request), output = unwrap(fact.reply) as ObjectDefinitionOutput;
    assertObjectDefinitionOutput(output, request, 'sqlite'); expect(request.connectionId).toBe(connectionA); expect(request.sessionId).toBe(expected.session); expect(request.table).toBe(expected.name); expect(output).toMatchObject({ database: expected.schema, name: expected.name, kind: expected.kind, temporary: expected.schema === 'temp' });
    await step(() => expect(dialog().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
    const ddl = await step(() => page.evaluate(() => { const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && !!node.closest('[data-object-definition]') && node.getClientRects().length > 0; }); if (editors?.length !== 1 || editors[0].getRawOptions().readOnly !== true) throw Error('实际DDL不是唯一只读Monaco'); const model = editors[0].getModel(); if (!model || model.isDisposed()) throw Error('实际DDL模型失效'); return model.getValue(); }));
    expect(ddl.replaceAll('\r\n', '\n')).toBe(output.ddl.replaceAll('\r\n', '\n')); expect(ddl).toContain(expected.marker); expect(ddl).not.toContain('OBJECT_DEFINITION_B'); expect(await model()).toEqual(before);
    const image = await step(() => page.screenshot()); await step(() => info.attach('对象结构实际窗口-' + gesture + '-' + expected.schema + '-' + expected.name, { body: image, contentType: 'image/png' }));
    await step(() => dialog().getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog()).toHaveCount(0)); expect(await model()).toEqual(before);
    const stateAfter = await settings(); expect(stateAfter.tabs).toEqual(stateBefore.tabs); expect(stateAfter.activeTabId).toBe(tabId); readProofs.push({ gesture, expected, request, output, ddl, modelBefore: before, modelAfter: await model(), tabsBefore: stateBefore.tabs, tabsAfter: stateAfter.tabs }); return output;
  };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    expect(await step(() => page.evaluate(async () => ({ connections: (await window.dbark.invoke('connections.list', {})).length, tabs: (await window.dbark.invoke('settings.get', {})).tabs.length, tasks: (await window.dbark.invoke('tasks.list', {})).length, history: (await window.dbark.invoke('history.list', {})).length })))).toEqual({ connections: 0, tabs: 0, tasks: 0, history: 0 });
    await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
    for (const [index, path] of databases.entries()) { check(); const db = new DatabaseSync(path); try { db.exec(index ? "CREATE TABLE subject(b_only_marker TEXT DEFAULT 'OBJECT_DEFINITION_B_MAIN',id INTEGER PRIMARY KEY); INSERT INTO subject VALUES('B原始行',1); CREATE VIEW subject_view AS SELECT b_only_marker,id FROM subject WHERE b_only_marker <> 'OBJECT_DEFINITION_B_VIEW'; CREATE TABLE outside_control(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO outside_control VALUES(1,'B控制行');" : "CREATE TABLE subject(main_marker TEXT DEFAULT 'OBJECT_DEFINITION_A_MAIN',id INTEGER PRIMARY KEY); INSERT INTO subject VALUES('A原始行🚢',1); CREATE VIEW subject_view AS SELECT main_marker,id FROM subject WHERE main_marker <> 'OBJECT_DEFINITION_A_VIEW'; CREATE TABLE outside_control(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO outside_control VALUES(1,'A控制行🚢');"); } finally { db.close(); check(); } }
    const canonical = databases.map(path => realpathSync(path)), baseline = disk(); await arm(canonical); armed = true;
    stage = '真实ConnectionDialog表单创建A和B，选择器仅授权两个准确文件';
    for (const [index, name] of [nameA, nameB].entries()) { await clickMenu(page.locator('.navigation-toolbar'), zh.common.newConnection); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }); await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(name)); await step(() => form.locator('select').selectOption('sqlite')); await step(() => form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck()); await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(databases[index]))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toHaveCount(0)); }
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(2); const a = profiles.find(profile => profile.name === nameA), b = profiles.find(profile => profile.name === nameB); if (!a || !b || a.dialect !== 'sqlite' || b.dialect !== 'sqlite') throw Error('真实A/B连接未保存'); connectionA = a.id; expect(a.sqlite.filePath).toBe(canonical[0]); expect(b.sqlite.filePath).toBe(canonical[1]);
    await clickMenu(page.locator('.navigation-toolbar'), zh.common.newQuery); const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true }); await step(() => newQuery.locator('select').selectOption(a.id)); await step(() => newQuery.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox')).toBeVisible()); const initial = await settings(); expect(initial.tabs).toHaveLength(1); tabId = initial.activeTabId!; expect(initial.tabs[0]).toMatchObject({ id: tabId, kind: 'query', connectionId: a.id, database: 'main' });
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: nameB }).click()); await step(() => expect(page.locator('.connection-row.active .tree-label')).toHaveText(nameB)); expect((await settings()).activeTabId).toBe(tabId);
    stage = '树选B而原A草稿活动，实际更多菜单读取A永久表且不建session';
    await read('SELECT s|.main_marker FROM subject s', 'more', { name: 'subject', kind: 'table', schema: 'main', marker: 'OBJECT_DEFINITION_A_MAIN' });
    let observed = await step(audit); expect(facts(observed, 'query.execute')).toHaveLength(0); expect(facts(observed, 'sessions.open')).toHaveLength(0); expect(disk()).toEqual(baseline);
    stage = '真实编辑保存B整体替换概要，原A查询实际右键仍读取A视图';
    const bRow = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: nameB, exact: true }) }); await step(async () => { const item = await (require('./sidebar-menu') as typeof import('./sidebar-menu')).sidebarMenuItem(bRow, { name: formatText(zh.sidebar.text010, nameB), exact: true }, check); check(); await item.click(); check(); }); const edit = page.getByRole('dialog', { name: zh.connections.text003, exact: true }); await step(() => edit.getByLabel(zh.connections.text006, { exact: true }).fill(savedNameB)); await step(() => edit.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(edit).toHaveCount(0));
    await step(() => expect(page.locator('.connection-row.active .tree-label')).toHaveText(savedNameB)); expect((await settings()).activeTabId).toBe(tabId);
    await read('SELECT v|.main_marker FROM subject_view v', 'context', { name: 'subject_view', kind: 'view', schema: 'main', marker: 'OBJECT_DEFINITION_A_VIEW' });
    observed = await step(audit); expect(facts(observed, 'connections.save')).toHaveLength(3); expect(facts(observed, 'query.execute')).toHaveLength(0); expect(facts(observed, 'sessions.open')).toHaveLength(0); expect(disk()).toEqual(baseline);
    stage = '唯一明确原执行按钮运行固定TEMP遮蔽及BEGIN脚本';
    await write(bootstrap); await step(() => query().locator('.query-execute-split > button.primary').click()); await step(() => expect.poll(async () => facts(await audit(), 'query.execute').filter(fact => fact.reply !== undefined).length).toBe(1)); await step(() => expect(query().locator('.query-execute-split > button.primary')).toBeEnabled()); await step(() => expect(query().locator('.error-box')).toHaveCount(0));
    observed = await step(audit); expect(facts(observed, 'sessions.open')).toHaveLength(1); const session = observed.sessions[0]; expect(session).toMatch(/^sqlite:/); expect(facts(observed, 'query.execute')[0].request.sql).toBe(bootstrap);
    const sessionState = () => step(() => page.evaluate(sessionId => window.dbark.invoke('query.sessionState', { sessionId }), session));
    const beforeTransaction = await sessionState(); expect(beforeTransaction).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    stage = '原session中未限定subject解析到TEMP，显式main保持永久，读取不动事务';
    await read('SELECT s|.temp_marker FROM subject s', 'more', { name: 'subject', kind: 'table', schema: 'temp', marker: 'OBJECT_DEFINITION_A_TEMP', session }); expect(await sessionState()).toEqual(beforeTransaction);
    await read('SELECT s|.main_marker FROM main.subject s', 'context', { name: 'subject', kind: 'table', schema: 'main', marker: 'OBJECT_DEFINITION_A_MAIN', session }); expect(await sessionState()).toEqual(beforeTransaction); expect(disk()).toEqual(baseline);
    stage = '实际关闭正在打开的预览，只取消所属读取且磁盘及原事务保持';
    const cancelModel = await at('SELECT s|.temp_marker FROM subject s'), cancelBefore = await step(audit); await clickMenu(query(), text.entry); await step(() => expect(dialog()).toBeVisible()); await step(() => page.keyboard.press('Escape')); await step(() => expect(dialog()).toHaveCount(0)); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); expect(await model()).toEqual(cancelModel); expect(await sessionState()).toEqual(beforeTransaction); expect(disk()).toEqual(baseline);
    const cancelAfter = await step(audit); expect(facts(cancelAfter, 'query.execute')).toHaveLength(1); expect(facts(cancelAfter, 'sessions.open')).toHaveLength(1);
    stage = '真实Rollback按钮回滚原事务，目录和全行baseline不变';
    await step(() => query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).click()); await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeDisabled()); expect(await sessionState()).toEqual({ transactionOpen: false, transactionKnown: true, broken: false }); expect(disk()).toEqual(baseline);
    const finalModel = await model(), finalTabs = (await settings()).tabs; expect(finalTabs).toHaveLength(1); expect(finalTabs[0].id).toBe(tabId); expect(finalTabs[0].connectionId).toBe(a.id);
    await step(() => page.locator('[data-workspace-tab-id="' + tabId + '"] .tab-close').click()); const close = page.getByRole('dialog', { name: queryCloseZh.title, exact: true }); await step(() => expect(close).toBeVisible()); await step(() => close.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(page.locator('[data-workspace-tab-id="' + tabId + '"]')).toHaveCount(0));
    await step(() => expect.poll(async () => { const value = await audit(); return value.pending === 0 && value.workers.every(worker => worker.exit === 0 && worker.kills === 0); }).toBe(true)); const final = await step(audit);
    expect(final.denied).toEqual([]); expect(final.pickerIds).toEqual([a.id, b.id]); expect(facts(final, 'query.execute').map(fact => String(fact.request.sql).replaceAll('\r\n', '\n'))).toEqual([bootstrap]); expect(facts(final, 'sessions.open')).toHaveLength(1); expect(facts(final, 'query.transaction').map(fact => fact.request.action)).toEqual(['rollback']); expect(final.workers.length).toBeGreaterThan(0); expect(final.workers.every(worker => worker.opens.length === 1 && canonical.includes(worker.opens[0]) && worker.exit === 0 && worker.kills === 0)).toBe(true); expect(disk()).toEqual(baseline);
    const finalHistory = await step(() => page.evaluate(() => window.dbark.invoke('history.list', {}))); expect(finalHistory.map(item => item.sql.replaceAll('\r\n', '\n'))).toEqual([bootstrap]); expect(pageErrors).toEqual([]);
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __objectDefinitionNative?: { restore(): void } }).__objectDefinitionNative; if (!state) throw Error('原Main观察器缺失'); state.restore(); }), true); armed = false;
    stage = '准确owner正常退出与所属PID全部不存在'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(baseline);
    await step(() => info.attach('对象结构原输入回包模型事务与退出证明', { body: JSON.stringify({ platform: process.platform, directory, databases, canonical, pid: originalProcess.pid, baseline, finalDisk: disk(), readProofs, finalModel, finalTabs, beforeTransaction, bootstrap, finalHistory, audit: final, cancellation: { model: cancelModel, before: facts(cancelBefore, 'query.cancel'), after: facts(cancelAfter, 'query.cancel'), scope: '真实Escape关闭预览；是否已进入后端按原请求时序记录，不假造取消ACK' }, metadataCreatesUserSession: false, metadataUserSqlExecutions: 0, normalOwnerExit: true, ownedPidsConfirmedAbsentByFixture: true, automaticTrace: false, systemClipboardOperations: 0, chooserScope: '仅替换本例A/B两条准确OS选择路径' }), contentType: 'application/json' }));
    completed = { directory, databases, platform: process.platform, pid: originalProcess.pid };
  } catch (reason) { runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined; if (armed && !closed) try { check(); partial = await audit(); check(); } catch { /* 保留首因，不重装观察器。 */ } try { await info.attach('对象结构失败现场', { body: JSON.stringify({ stage, directory, databases, pid: originalProcess.pid, closed, armed, partial, firstError: reason instanceof Error ? reason.message : String(reason), automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false }), contentType: 'application/json' }); } catch { /* 不掩盖原错或解除保留。 */ } throw reason; }
});

/** 目录只由原ownedfixture在准确exit和PID确认后清理；专项本身不执行递归删除。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing).toBe(true); await info.attach('对象结构独占profile最终清理证明', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, normalLaunches: 1, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
