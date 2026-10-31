import { queryDialectVm } from '../helpers/queryDialectVm';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { CurrentStatementIntent } from '../../src/renderer/currentStatementIntent';
import { captureQueryFailureSource } from '../../src/renderer/queryFailureSource';
import { currentStatementZh } from '../../src/renderer/locales/currentStatement.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { queryConnectionDatabase, resolveQueryDatabase } from '../../src/shared/queryContext';
import { queryResultSelectionFixture } from '../fixtures/query-result-selection';
import { QueryRowDetails } from '../../src/renderer/queryRowDetails';
import { bindEditorIndentation } from '../../src/renderer/editorIndentation';
import { editorIndentationOptions } from '../../src/shared/editorIndentation';
import { UiCommandRegistry } from '../../src/renderer/uiCommandRegistry';

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['ensureSession', 'currentStatementScope', 'executeCurrentStatement', 'runQuery', 'prepareExecutionContext', 'querySource', 'failureSourceScope', 'captureFailureSource', 'clearFailureSource', 'execute', 'attachQueryEditor', 'invalidateResultSelection']), functions: string[] = [];
/** 运行真实组件入口和真正异步建连函数，仅替换IO与React端口。 */
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) functions.push(node.getText(tree)); node.forEachChild(visit); }
visit(tree);
const code = ts.transpileModule(functions.join('\n') + '\nglobalThis.handlers={executeCurrentStatement,execute,attachQueryEditor,runQuery};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** 每个await由显式门控制，测试不使用网络、GUI、系统按键或剪贴板。 */
function gate() { let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); return { pending, release }; }
/** workspace、模型事件和IPC各有独立观察端口，保持生产执行函数本身不变。 */
function fixture(dialect: 'mysql' | 'sqlite' = 'mysql') {
  const selection = queryResultSelectionFixture();
  let sql = "SET @before=1; SELECT '🧭当前'; DELETE FROM after;", version = 1, offset = sql.indexOf('当前'), modal = false, activeModel: unknown, fileBusy = false;
  const database = dialect === 'sqlite' ? 'main' : 'db', connection = dialect === 'sqlite' ? { id: 'c', dialect, sqlite: { filePath: 'C:\\合成当前语句.sqlite', readOnly: false, busyTimeoutMs: 1000 } } : { id: 'c', dialect, database: 'db' };
  const listeners = new Map<string, Set<() => void>>(), workspace = { settings: { activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'query', connectionId: 'c', sql, database, databaseContext: { state: 'known', database } }] }, connections: [connection], connectionVersions: { c: 2 }, activeJobs: {} as Record<string, boolean>, setBusy: vi.fn(), setDirty: vi.fn() };
  const listen = (kind: string, action: () => void) => { const list = listeners.get(kind) ?? new Set(); list.add(action); listeners.set(kind, list); return { dispose: () => { list.delete(action); } }; };
  const emit = (kind: string) => { for (const action of [...listeners.get(kind) ?? []]) action(); };
  // 原 store 的同步 busy 通知也进入真实 scope 订阅，确保本任务占用不会使自己失效。
  workspace.setBusy.mockImplementation((id: string, busy: boolean) => { workspace.activeJobs[id] = busy; emit('context'); });
  const model = { getValue: () => sql, getVersionId: () => version, isDisposed: () => false, getOffsetAt: (p: { column: number }) => p.column - 1, getValueInRange: () => 'SELECT selected', onDidChangeContent: (action: () => void) => listen('content', action), onWillDispose: (action: () => void) => listen('modelDispose', action) };
  activeModel = model;
  const editor = { getModel: () => activeModel, getPosition: () => ({ lineNumber: 1, column: offset + 1 }), getSelection: () => ({}), onDidChangeModel: (action: () => void) => listen('model', action), onDidDispose: (action: () => void) => listen('editorDispose', action), onDidChangeCursorPosition: (action: () => void) => listen('caret', action) };
  const invoke = vi.fn(async (command: string, _input?: any): Promise<any> => command === 'sessions.open' ? { sessionId: 'session' } : { results: [] }), flushSettings = vi.fn(async () => {}), handleQueryError = vi.fn(async (_reason: unknown) => {});
  let serial = 0;
  // 对应真实组件的useRef：复制/格式化尚未发起，模型挂载标记初始false，仍执行真实接管函数。
  // 未打开结果写入用途的真实初始引用，不替换原执行函数或断言。
  const port = createContext({ ...queryDialectVm(connection), fileSource: { busy: false, isBusy: () => fileBusy }, snapshotOperation: { current: null }, continueOnError: false, collectWarnings: false, resultInsertRef: { current: null }, resultInsertActivity: { current: 0 }, duplicateIntent: { current: null }, formatting: { current: null }, fileModelAttached: { current: false }, resultSelection: selection.resultSelection, captureQueryFailureSource, failureSource: { current: undefined }, parameterFailureSource: { current: undefined }, alive: { current: true }, closeRequestRef: { current: undefined }, refreshFailureSource: vi.fn(),
    // 与真实组件初始useRef一致：尚未打开行详情，但真实失效函数仍撤销控制器并清空两个React状态。
    rowDetails: new QueryRowDetails(), setRowDetail: vi.fn(), setActiveDetailRow: vi.fn(),
    // 对应新增确认入口的真实初始useRef；本组未打开实际分析，但模型替换仍执行原回调。
    analyzeIntent: { current: null },
    // 尚未打开筛选草稿；真实撤销函数仍使用组件的引用及状态端口。
    comparisonLeaseRef: { current: null }, setComparisonLease: vi.fn(), statisticsLeaseRef: { current: null }, setStatisticsLease: vi.fn(), sortLeaseRef: { current: null }, setSortLease: vi.fn(), filterLeaseRef: { current: null }, setFilterLease: vi.fn(),
    CurrentStatementIntent, currentStatementZh, queryContextZh, queryConnectionDatabase, resolveQueryDatabase, Error, document: { querySelector: () => modal ? {} : null },
    useWorkspace: { getState: () => workspace, subscribe: (action: () => void) => listen('context', action).dispose }, tab: workspace.settings.tabs[0], settings: { resultLimit: 10 }, editor: { current: editor }, activeCurrentIntent: { current: null }, setSearchEditor: vi.fn(), sessionRef: { current: '' }, pendingSession: { current: null }, busyRef: { current: false }, cancelledQuery: { current: '' }, task: { current: '' }, parameterSession: { current: '' }, explainSource: { current: '' },
    invoke, flushSettings, handleQueryError, rememberDatabase: vi.fn(), uid: () => `task-${++serial}`, errorMessage: (reason: any) => reason.message, zh: { query: { text001: '请输入SQL' } },
    setSessionId: vi.fn(), setRecoveryDatabase: vi.fn(), setRecovery: vi.fn(), setBusy: vi.fn(), setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setOutcome: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(),
  });
  runInContext(code, port);
  return { selection, port, workspace, model, editor, invoke, flushSettings, handleQueryError, emit, listeners,
    edit: (value: string) => { sql = value; version++; emit('content'); }, swap: (value: unknown) => { activeModel = value; emit('model'); }, move: (value: number) => { offset = value; emit('caret'); }, modal: (value: boolean) => { modal = value; }, fileBusy: (value: boolean) => { fileBusy = value; emit('context'); },
    execute: () => port.handlers.executeCurrentStatement() as Promise<void>, original: (mode?: string) => port.handlers.execute(mode) as Promise<void>,
  };
}

describe('真实QueryTab当前语句异步意图', () => {
  it('真实入口在异步建连和落盘后只发一次完整模型正文与真实UTF16光标', async () => {
    expect(functions).toHaveLength(12); const f = fixture(), expected = f.model.getValue(); await f.execute();
    const calls = f.invoke.mock.calls.filter(([command]) => command === 'query.execute'); expect(calls).toHaveLength(1); expect(calls[0][1]).toMatchObject({ sessionId: 'session', sql: expected, currentStatement: { offset: expected.indexOf('当前') } }); expect(calls[0][1].sql).not.toBe('SELECT selected');
    expect(f.model.getValue()).toBe(expected); expect([...f.listeners.values()].every(list => !list.size)).toBe(true);
    expect(f.selection.resultSelection.count(f.selection.binding)).toBe(0);
    expect(f.port.setRowDetail).toHaveBeenCalledWith(null); expect(f.port.setActiveDetailRow).toHaveBeenCalledWith(null);
  });
  it.each(['connections.open', 'sessions.open', 'settings'] as const)('%s等待期间编辑再恢复原文仍不发送', async phase => {
    const f = fixture(), held = gate(), original = f.model.getValue();
    if (phase === 'settings') f.flushSettings.mockImplementationOnce(() => held.pending);
    else f.invoke.mockImplementationOnce(async command => { expect(command).toBe('connections.open'); if (phase === 'connections.open') await held.pending; return {}; });
    if (phase === 'sessions.open') f.invoke.mockImplementationOnce(async command => { expect(command).toBe('sessions.open'); await held.pending; return { sessionId: 'session' }; });
    const pending = f.execute(); await vi.waitFor(() => expect(phase === 'settings' ? f.flushSettings : f.invoke).toHaveBeenCalledTimes(phase === 'sessions.open' ? 2 : 1));
    f.edit('SELECT edited'); f.edit(original); held.release(); await pending; expect(f.invoke.mock.calls.some(([c]) => c === 'query.execute')).toBe(false); expect(f.handleQueryError.mock.calls[0][0]).toHaveProperty('message', currentStatementZh.changed);
  });
  it.each(['connection', 'active', 'draft', 'model', 'editor', 'caret', 'closed', 'cancelled', 'modal'] as const)('落盘等待期间%s变化阻止旧意图投递', async changed => {
    const f = fixture(), held = gate(); f.flushSettings.mockImplementationOnce(() => held.pending); const pending = f.execute(); await vi.waitFor(() => expect(f.flushSettings).toHaveBeenCalledOnce());
    if (changed === 'connection') { f.workspace.connectionVersions.c++; f.emit('context'); }
    else if (changed === 'active') { f.workspace.settings.activeTabId = 'other'; f.emit('context'); f.workspace.settings.activeTabId = 'tab'; f.emit('context'); }
    else if (changed === 'draft') { f.workspace.settings.tabs[0].sql = '外部新草稿'; f.emit('context'); }
    else if (changed === 'model') { f.swap({}); f.swap(f.model); }
    else if (changed === 'editor') { expect(f.port.fileModelAttached.current).toBe(false); f.port.handlers.attachQueryEditor({}); f.port.handlers.attachQueryEditor(f.editor); expect(f.port.fileModelAttached.current).toBe(true); }
    else if (changed === 'caret') { f.move(1); }
    else if (changed === 'closed') { f.workspace.settings.tabs = []; f.emit('context'); }
    else if (changed === 'cancelled') f.port.cancelledQuery.current = f.port.task.current;
    else f.modal(true);
    held.release(); await pending; expect(f.invoke.mock.calls.some(([c]) => c === 'query.execute')).toBe(false); expect([...f.listeners.values()].every(list => !list.size)).toBe(true);
  });
  it.each(['busy', 'modal'])('%s守卫在捕获或建连前生效', async blocked => { const f = fixture(); if (blocked === 'busy') f.port.busyRef.current = true; else f.modal(true); await f.execute(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.flushSettings).not.toHaveBeenCalled(); });
  it('重复点击期间只允许原任务，断开错误也不自动重放', async () => {
    const f = fixture(), held = gate(); f.flushSettings.mockImplementationOnce(() => held.pending); const first = f.execute(); await vi.waitFor(() => expect(f.flushSettings).toHaveBeenCalledOnce()); await f.execute();
    f.invoke.mockImplementation(async command => { if (command === 'query.execute') throw Error('ECONNRESET'); return {}; }); held.release(); await first; expect(f.invoke.mock.calls.filter(([c]) => c === 'query.execute')).toHaveLength(1); expect(f.handleQueryError).toHaveBeenCalledOnce();
  });
  it('原选区优先/全部执行保持不带新标志', async () => {
    const f = fixture(); await f.original(); await f.original('all'); const inputs = f.invoke.mock.calls.filter(([c]) => c === 'query.execute').map(([, input]) => input);
    expect(inputs.map(value => value.sql)).toEqual(['SELECT selected', f.model.getValue()]); expect(inputs.every(value => !Object.hasOwn(value, 'currentStatement'))).toBe(true);
  });
});

describe('真实按钮和Monaco动作接线', () => {
  it('按钮与新回调都调用当前语句入口，原回调保持选区优先', () => {
    let button = false, callback = false, original = false;
    /** 两个方言共用同一正式箭头；既有网络入口仍逐字核原执行函数。 */
    function attributeValue(attr: ts.JsxAttribute): string | undefined {
      return attr.initializer?.getText(tree);
    }
    function inspect(node: ts.Node) {
      if (ts.isJsxOpeningElement(node)) {
        const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(tree), attributeValue(attr)]));
        if (node.tagName.getText(tree) === 'button' && props.get('aria-label') === '{currentStatementZh.action}') { expect(props.get('onClick')).toBe('{() => void executeCurrentStatement()}'); expect(props.get('disabled')).toBe('{busy || !connection || !!closeRequest || fileSource.busy}'); button = true; }
        if (node.tagName.getText(tree) === 'SqlEditor' && props.has('onExecuteCurrent')) { callback = props.get('onExecuteCurrent') === '{() => void executeCurrentStatement()}'; original = props.get('onExecute') === '{() => void execute()}'; }
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SqlEditor') {
        const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(tree), attributeValue(attr)]));
        if (props.has('onExecuteCurrent')) { callback = props.get('onExecuteCurrent') === '{() => void executeCurrentStatement()}'; original = props.get('onExecute') === '{() => void execute()}'; }
      }
      node.forEachChild(inspect);
    }
    inspect(tree); expect({ button, callback, original }).toEqual({ button: true, callback: true, original: true });
  });
  it('原CtrlCmdEnter键位逐字保持，新Shift动作调用最新引用且无回调编辑器不注册', () => {
    const content = readFileSync(new URL('../../src/renderer/components/SqlEditor.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('SqlEditor.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let mounted = '';
    function inspect(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'mounted') mounted = node.initializer!.getText(file); node.forEachChild(inspect); } inspect(file);
    expect(mounted).toContain("keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter]"); expect(mounted).toContain('monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter');
    const original = vi.fn(), first = vi.fn(), latest = vi.fn(), actions: Array<{ id: string; keybindings: number[]; run(): void }> = [];
    /** 提供真实绑定器需要的模型切换/选项端口；事件会实际更新editor及新model选项，不以noop绕过挂载。 */
    function actionEditor() {
      const modelListeners = new Set<() => void>(), disposeListeners = new Set<() => void>(), editorOptions: Record<string, unknown> = {};
      const createModel = () => { const options: Record<string, unknown> = {}; return { isDisposed: () => false, updateOptions: vi.fn((next: Record<string, unknown>) => Object.assign(options, next)) }; };
      let model = createModel();
      return {
        editor: {
          getModel: () => model, updateOptions: vi.fn((next: Record<string, unknown>) => Object.assign(editorOptions, next)),
          onDidChangeModel(listener: () => void) { modelListeners.add(listener); return { dispose() { modelListeners.delete(listener); } }; },
          onDidDispose(listener: () => void) { disposeListeners.add(listener); return { dispose() { disposeListeners.delete(listener); } }; },
          addAction: (action: typeof actions[number]) => actions.push(action),
        },
        changeModel() { model = createModel(); for (const listener of modelListeners) listener(); },
      };
    }
    // 本例只核对原快捷键；正文桥接的真实生命周期由专用组件测试覆盖。
    const port = createContext({ ...queryDialectVm(),  monaco: { KeyMod: { CtrlCmd: 2048, Shift: 1024 }, KeyCode: { Enter: 3 } }, zh: { editor: { text001: '执行' } }, currentStatementZh, bindEditorIndentation, editorIndentationOptions, optionsRef: { current: { tabSize: 4, insertSpaces: true } }, editorRef: { current: null }, widgetRef: { current: null }, propsRef: { current: {} }, aliveRef: { current: true }, attachContent: () => ({ ready: true }), runRef: { current: original }, currentRunRef: { current: first } });
    runInContext(ts.transpileModule('globalThis.mounted=' + mounted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port); const firstEditor = actionEditor(); port.mounted(firstEditor.editor); firstEditor.changeModel();
    expect(actions.map(action => [action.id, action.keybindings[0]])).toEqual([['dbark-run', 2051], ['dbark-run-current', 3075]]); port.currentRunRef.current = latest; actions[1].run(); actions[0].run(); expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled(); expect(original).toHaveBeenCalledOnce();
    actions.length = 0; port.currentRunRef.current = undefined; const nextEditor = actionEditor(); port.mounted(nextEditor.editor); nextEditor.changeModel(); expect(actions.map(action => action.id)).toEqual(['dbark-run']);
  });
});

describe('SQLite 当前语句复用真实 QueryTab 意图与准入', () => {
  it('Monaco全文/UTF16光标准确发送，存留MySQL开关与选区/旧tab正文不进入payload', async () => {
    const f = fixture('sqlite'), sql = "SELECT '前🧭';\r\nINSERT INTO \"表\" VALUES ('当前');\r\nDELETE FROM \"尾\";"; f.edit(sql); f.move(sql.indexOf('当前')); f.port.continueOnError = true; f.port.collectWarnings = true;
    await f.execute(); const calls = f.invoke.mock.calls.filter(([command]) => command === 'query.execute'); expect(calls).toHaveLength(1); expect(calls[0][1]).toEqual({ sessionId: 'session', sql, taskId: 'task-1', maxRows: 10, currentStatement: { offset: sql.indexOf('当前') } });
    expect(calls[0][1].sql).not.toBe(f.workspace.settings.tabs[0].sql); expect(calls[0][1].sql).not.toBe('SELECT selected'); expect(Object.hasOwn(calls[0][1], 'continueOnError')).toBe(false); expect(Object.hasOwn(calls[0][1], 'collectWarnings')).toBe(false); expect(f.invoke.mock.calls.some(([command]) => command === 'query.executeParameterized' || command === 'query.explain' || command === 'query.analyze')).toBe(false); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it('SQLite原选区和全文执行仍无currentStatement，MySQL当前语句入口原行为保留', async () => {
    const sqlite = fixture('sqlite'); sqlite.port.continueOnError = true; sqlite.port.collectWarnings = true; await sqlite.original(); await sqlite.original('all'); const inputs = sqlite.invoke.mock.calls.filter(([command]) => command === 'query.execute').map(([, input]) => input);
    expect(inputs.map(input => input.sql)).toEqual(['SELECT selected', sqlite.model.getValue()]); expect(inputs.every(input => !Object.hasOwn(input, 'currentStatement') && !Object.hasOwn(input, 'continueOnError') && !Object.hasOwn(input, 'collectWarnings'))).toBe(true);
    const mysql = fixture(); await mysql.execute(); expect(mysql.invoke.mock.calls.find(([command]) => command === 'query.execute')?.[1]).toMatchObject({ currentStatement: { offset: mysql.model.getValue().indexOf('当前') }, sql: mysql.model.getValue() });
  });
  it.each(['busy', 'other-job', 'modal', 'hidden', 'closed', 'closing', 'file', 'file-opening', 'formatting', 'unmounted'] as const)('%s在捕获/建连之前拒绝SQLite当前语句', async kind => {
    const f = fixture('sqlite');
    if (kind === 'busy') f.port.busyRef.current = true; else if (kind === 'other-job') f.workspace.activeJobs.tab = true; else if (kind === 'modal') f.modal(true); else if (kind === 'hidden') f.workspace.settings.activeTabId = 'other'; else if (kind === 'closed') f.workspace.settings.tabs = []; else if (kind === 'closing') f.port.closeRequestRef.current = {}; else if (kind === 'file') f.fileBusy(true); else if (kind === 'file-opening') Reflect.set(f.workspace, 'queryFileOpenings', { tab: {} }); else if (kind === 'formatting') f.port.formatting.current = {}; else f.port.alive.current = false;
    await f.execute(); expect(f.invoke).not.toHaveBeenCalled(); expect(f.flushSettings).not.toHaveBeenCalled(); expect(f.port.activeCurrentIntent.current).toBeNull(); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it.each(['connections.open', 'sessions.open', 'settings'] as const)('SQLite %s等待后严格重核原模型与光标，ABA不投递', async phase => {
    const f = fixture('sqlite'), held = gate(), originalOffset = f.model.getValue().indexOf('当前');
    if (phase === 'settings') f.flushSettings.mockImplementationOnce(() => held.pending);
    else f.invoke.mockImplementationOnce(async command => { expect(command).toBe('connections.open'); if (phase === 'connections.open') await held.pending; return {}; });
    if (phase === 'sessions.open') f.invoke.mockImplementationOnce(async command => { expect(command).toBe('sessions.open'); await held.pending; return { sessionId: 'session' }; });
    const pending = f.execute(); await vi.waitFor(() => expect(phase === 'settings' ? f.flushSettings : f.invoke).toHaveBeenCalledTimes(phase === 'sessions.open' ? 2 : 1)); f.move(0); f.move(originalOffset); held.release(); await pending;
    expect(f.invoke.mock.calls.some(([command]) => command === 'query.execute')).toBe(false); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it.each(['connection', 'session', 'file', 'closing', 'active', 'draft', 'model', 'cancelled'] as const)('SQLite落盘等待中的%s失效拒绝旧任务，不重放', async kind => {
    const f = fixture('sqlite'), held = gate(); f.flushSettings.mockImplementationOnce(() => held.pending); const pending = f.execute(); await vi.waitFor(() => expect(f.flushSettings).toHaveBeenCalledOnce());
    if (kind === 'connection') { f.workspace.connectionVersions.c++; f.emit('context'); f.workspace.connectionVersions.c--; f.emit('context'); }
    else if (kind === 'session') { f.port.sessionRef.current = 'replacement'; f.emit('context'); f.port.sessionRef.current = 'session'; f.emit('context'); }
    else if (kind === 'file') { f.fileBusy(true); f.fileBusy(false); }
    else if (kind === 'closing') { f.port.closeRequestRef.current = {}; f.emit('context'); f.port.closeRequestRef.current = undefined; f.emit('context'); }
    else if (kind === 'active') { f.workspace.settings.activeTabId = 'other'; f.emit('context'); f.workspace.settings.activeTabId = 'tab'; f.emit('context'); }
    else if (kind === 'draft') { const draft = f.workspace.settings.tabs[0].sql; f.workspace.settings.tabs[0].sql = '更换正文'; f.emit('context'); f.workspace.settings.tabs[0].sql = draft; f.emit('context'); }
    else if (kind === 'model') { f.swap({}); f.swap(f.model); }
    else f.port.cancelledQuery.current = f.port.task.current;
    held.release(); await pending; expect(f.invoke.mock.calls.some(([command]) => command === 'query.execute')).toBe(false); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it.each(['parameters', 'explain-parameters', 'analyze', 'continue', 'warnings'] as const)('显式%s仍在SQLite runQuery投递前拒绝，不因current/计划开放旁路', async kind => {
    const f = fixture('sqlite'), locator = { dispose: vi.fn() }; const result = await f.port.handlers.runQuery('SELECT 1', kind === 'explain-parameters' ? 'explain' : kind === 'analyze' ? 'analyze' : 'execute', kind === 'parameters' || kind === 'explain-parameters' ? [] : undefined, undefined, locator, undefined, kind === 'continue', kind === 'warnings'); expect(result).toBe(false); expect(f.invoke).not.toHaveBeenCalled(); expect(f.port.setError).toHaveBeenCalledWith(f.port.sqliteZh.unsupported); expect(locator.dispose).toHaveBeenCalledOnce();
  });
  it.each(['mysql', 'sqlite'] as const)('%s原生菜单声明命令使用同handler，busy/close/file/hidden/modal与旧revision均拒绝', async dialect => {
    let initializer = ''; function inspect(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === "'execute-current'") initializer = node.initializer.getText(tree); ts.forEachChild(node, inspect); } inspect(tree); expect(initializer).not.toBe('');
    for (const blocked of ['none', 'busy', 'close', 'file', 'hidden', 'modal', 'revision'] as const) {
      const executeCurrentStatement = vi.fn(), port = createContext({ sqlite: dialect === 'sqlite', busy: blocked === 'busy', connection: {}, closeRequest: blocked === 'close' ? {} : undefined, fileSource: { busy: blocked === 'file' }, executeCurrentStatement }); runInContext('globalThis.command=' + initializer, port);
      const registry = new UiCommandRegistry(); registry.update('tab:tab', {}, { active: blocked !== 'hidden', contextKey: 'current', handlers: { 'execute-current': port.command } }); registry.setBlocked(blocked === 'modal'); const revision = registry.getSnapshot().revision; if (blocked === 'revision') registry.invalidate();
      expect(await registry.execute({ id: 'execute-current', revision })).toBe(blocked === 'none'); expect(executeCurrentStatement).toHaveBeenCalledTimes(blocked === 'none' ? 1 : 0);
    }
  });
});

describe('SQLite 执行计划复用真实 QueryTab 会话与入口', () => {
  it('明确计划只发送原选区query.explain auto，沿原会话和事务，不夹current/参数/存留开关', async () => {
    const f = fixture('sqlite'); f.port.sessionRef.current = 'session'; f.port.continueOnError = true; f.port.collectWarnings = true;
    f.invoke.mockResolvedValueOnce({ results: [], elapsedMs: 1, transactionOpen: true, sqliteExplain: { dialect: 'sqlite', version: '合成', initialView: 'tree', nodes: [], raw: '', rawTruncated: false, warnings: [] } }); await f.original('explain');
    expect(f.invoke).toHaveBeenCalledExactlyOnceWith('query.explain', { sessionId: 'session', sql: 'SELECT selected', taskId: 'task-1', maxRows: 10, format: 'auto' }); expect(f.port.setTransaction).toHaveBeenCalledWith(true); expect(f.workspace.setDirty).toHaveBeenCalledWith('tab', true); expect(f.port.sessionRef.current).toBe('session'); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it('显式text请求仍走EQP原命令format text，没有调用MySQL fallback或analyze', async () => {
    const f = fixture('sqlite'); f.port.sessionRef.current = 'session'; await f.port.handlers.runQuery('SELECT 7', 'explain-text'); expect(f.invoke).toHaveBeenCalledExactlyOnceWith('query.explain', { sessionId: 'session', sql: 'SELECT 7', taskId: 'task-1', maxRows: 10, format: 'text' });
  });
  it.each(['busy', 'modal', 'hidden', 'closing', 'file', 'other-job'] as const)('%s旧计划入口在任何建连/执行前拒绝', async kind => {
    const f = fixture('sqlite'); if (kind === 'busy') f.port.busyRef.current = true; else if (kind === 'modal') f.modal(true); else if (kind === 'hidden') f.workspace.settings.activeTabId = 'other'; else if (kind === 'closing') f.port.closeRequestRef.current = {}; else if (kind === 'file') f.fileBusy(true); else f.workspace.activeJobs.tab = true;
    await f.original('explain'); expect(f.invoke).not.toHaveBeenCalled(); expect(f.flushSettings).not.toHaveBeenCalled();
  });
  it.each(['connections.open', 'sessions.open', 'settings'] as const)('计划%s等待期间原source ABA撤权，不投递迟到计划', async phase => {
    const f = fixture('sqlite'), held = gate(), original = f.model.getValue(); if (phase === 'settings') f.flushSettings.mockImplementationOnce(() => held.pending);
    else f.invoke.mockImplementationOnce(async command => { expect(command).toBe('connections.open'); if (phase === 'connections.open') await held.pending; return {}; });
    if (phase === 'sessions.open') f.invoke.mockImplementationOnce(async command => { expect(command).toBe('sessions.open'); await held.pending; return { sessionId: 'session' }; });
    const pending = f.original('explain'); await vi.waitFor(() => expect(phase === 'settings' ? f.flushSettings : f.invoke).toHaveBeenCalledTimes(phase === 'sessions.open' ? 2 : 1)); f.edit('新规划正文'); f.edit(original); held.release(); await pending;
    expect(f.invoke.mock.calls.some(([command]) => command === 'query.explain' || command === 'query.execute')).toBe(false); expect([...f.listeners.values()].every(group => !group.size)).toBe(true);
  });
  it('声明explain菜单对SQLite可用但其它未接能力仍禁用，模态/旧菜单revision拒执行', async () => {
    const declarations = new Map<string, string>(); function inspect(node: ts.Node) { if (ts.isPropertyAssignment(node) && ['explain', 'analyze', 'parameters', "'transaction-settings'"].includes(node.name.getText(tree)) && node.initializer.getText(tree).includes('enabled:')) declarations.set(node.name.getText(tree), node.initializer.getText(tree)); ts.forEachChild(node, inspect); } inspect(tree); expect(declarations.size).toBe(4);
    const execute = vi.fn(), port = createContext({ sqlite: true, busy: false, connection: {}, closeRequest: undefined, fileSource: { busy: false }, execute, openAnalyze: vi.fn(), openParameters: vi.fn(), openTransactionSettings: vi.fn() }); for (const [name, value] of declarations) runInContext('globalThis[' + JSON.stringify(name) + ']=' + value, port);
    expect(port.explain.enabled).toBe(true); expect(port.analyze.enabled).toBe(false); expect(port.parameters.enabled).toBe(false); expect(port["'transaction-settings'"].enabled).toBe(false);
    const registry = new UiCommandRegistry(); registry.update('tab:tab', {}, { active: true, contextKey: 'sqlite-plan', handlers: { explain: port.explain } }); registry.setBlocked(false); const old = registry.getSnapshot().revision; registry.setBlocked(true); registry.setBlocked(false); expect(await registry.execute({ id: 'explain', revision: old })).toBe(false); expect(execute).not.toHaveBeenCalled(); expect(await registry.execute({ id: 'explain', revision: registry.getSnapshot().revision })).toBe(true); expect(execute).toHaveBeenCalledExactlyOnceWith('explain');
  });
});
