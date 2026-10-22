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

const source = readFileSync(new URL('../../src/renderer/components/QueryTab.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('QueryTab.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['ensureSession', 'currentStatementScope', 'executeCurrentStatement', 'runQuery', 'prepareExecutionContext', 'querySource', 'failureSourceScope', 'captureFailureSource', 'clearFailureSource', 'execute', 'attachQueryEditor', 'invalidateResultSelection']), functions: string[] = [];
/** 运行真实组件入口和真正异步建连函数，仅替换IO与React端口。 */
function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) functions.push(node.getText(tree)); node.forEachChild(visit); }
visit(tree);
const code = ts.transpileModule(functions.join('\n') + '\nglobalThis.handlers={executeCurrentStatement,execute,attachQueryEditor};', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** 每个await由显式门控制，测试不使用网络、GUI、系统按键或剪贴板。 */
function gate() { let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); return { pending, release }; }
/** workspace、模型事件和IPC各有独立观察端口，保持生产执行函数本身不变。 */
function fixture() {
  const selection = queryResultSelectionFixture();
  let sql = "SET @before=1; SELECT '🧭当前'; DELETE FROM after;", version = 1, offset = sql.indexOf('当前'), modal = false, activeModel: unknown;
  const listeners = new Map<string, Set<() => void>>(), workspace = { settings: { activeTabId: 'tab', tabs: [{ id: 'tab', kind: 'query', connectionId: 'c', sql, database: 'db', databaseContext: { state: 'known', database: 'db' } }] }, connections: [{ id: 'c', database: 'db' }], connectionVersions: { c: 2 }, activeJobs: {}, setBusy: vi.fn(), setDirty: vi.fn() };
  const listen = (kind: string, action: () => void) => { const list = listeners.get(kind) ?? new Set(); list.add(action); listeners.set(kind, list); return { dispose: () => { list.delete(action); } }; };
  const emit = (kind: string) => { for (const action of [...listeners.get(kind) ?? []]) action(); };
  const model = { getValue: () => sql, getVersionId: () => version, isDisposed: () => false, getOffsetAt: (p: { column: number }) => p.column - 1, getValueInRange: () => 'SELECT selected', onDidChangeContent: (action: () => void) => listen('content', action), onWillDispose: (action: () => void) => listen('modelDispose', action) };
  activeModel = model;
  const editor = { getModel: () => activeModel, getPosition: () => ({ lineNumber: 1, column: offset + 1 }), getSelection: () => ({}), onDidChangeModel: (action: () => void) => listen('model', action), onDidDispose: (action: () => void) => listen('editorDispose', action), onDidChangeCursorPosition: (action: () => void) => listen('caret', action) };
  const invoke = vi.fn(async (command: string, _input?: any): Promise<any> => command === 'sessions.open' ? { sessionId: 'session' } : { results: [] }), flushSettings = vi.fn(async () => {}), handleQueryError = vi.fn(async (_reason: unknown) => {});
  let serial = 0;
  // 对应真实组件的useRef：复制/格式化尚未发起，模型挂载标记初始false，仍执行真实接管函数。
  const port = createContext({ duplicateIntent: { current: null }, formatting: { current: null }, fileModelAttached: { current: false }, resultSelection: selection.resultSelection, captureQueryFailureSource, failureSource: { current: undefined }, parameterFailureSource: { current: undefined }, alive: { current: true }, closeRequestRef: { current: undefined }, refreshFailureSource: vi.fn(),
    // 与真实组件初始useRef一致：尚未打开行详情，但真实失效函数仍撤销控制器并清空两个React状态。
    rowDetails: new QueryRowDetails(), setRowDetail: vi.fn(), setActiveDetailRow: vi.fn(),
    // 尚未打开筛选草稿；真实撤销函数仍使用组件的引用及状态端口。
    comparisonLeaseRef: { current: null }, setComparisonLease: vi.fn(), statisticsLeaseRef: { current: null }, setStatisticsLease: vi.fn(), sortLeaseRef: { current: null }, setSortLease: vi.fn(), filterLeaseRef: { current: null }, setFilterLease: vi.fn(),
    CurrentStatementIntent, currentStatementZh, queryContextZh, queryConnectionDatabase, resolveQueryDatabase, Error, document: { querySelector: () => modal ? {} : null },
    useWorkspace: { getState: () => workspace, subscribe: (action: () => void) => listen('context', action).dispose }, tab: workspace.settings.tabs[0], settings: { resultLimit: 10 }, editor: { current: editor }, activeCurrentIntent: { current: null }, setSearchEditor: vi.fn(), sessionRef: { current: '' }, pendingSession: { current: null }, busyRef: { current: false }, cancelledQuery: { current: '' }, task: { current: '' }, parameterSession: { current: '' }, explainSource: { current: '' },
    invoke, flushSettings, handleQueryError, rememberDatabase: vi.fn(), uid: () => `task-${++serial}`, errorMessage: (reason: any) => reason.message, zh: { query: { text001: '请输入SQL' } },
    setSessionId: vi.fn(), setRecoveryDatabase: vi.fn(), setRecovery: vi.fn(), setBusy: vi.fn(), setQueryRunning: vi.fn(), setError: vi.fn(), setSelectedPin: vi.fn(), setShowPinSql: vi.fn(), setOutcome: vi.fn(), setStream: vi.fn(), setResultIndex: vi.fn(), setTransaction: vi.fn(), setTransactionKnown: vi.fn(),
  });
  runInContext(code, port);
  return { selection, port, workspace, model, editor, invoke, flushSettings, handleQueryError, emit, listeners,
    edit: (value: string) => { sql = value; version++; emit('content'); }, swap: (value: unknown) => { activeModel = value; emit('model'); }, move: (value: number) => { offset = value; emit('caret'); }, modal: (value: boolean) => { modal = value; },
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
    function inspect(node: ts.Node) {
      if (ts.isJsxOpeningElement(node)) {
        const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(tree), attr.initializer?.getText(tree)]));
        if (node.tagName.getText(tree) === 'button' && props.get('aria-label') === '{currentStatementZh.action}') { expect(props.get('onClick')).toBe('{() => void executeCurrentStatement()}'); expect(props.get('disabled')).toBe('{busy || !connection}'); button = true; }
        if (node.tagName.getText(tree) === 'SqlEditor' && props.has('onExecuteCurrent')) { callback = props.get('onExecuteCurrent') === '{() => void executeCurrentStatement()}'; original = props.get('onExecute') === '{() => void execute()}'; }
      }
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'SqlEditor') {
        const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attr => [attr.name.getText(tree), attr.initializer?.getText(tree)]));
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
    const port = createContext({ monaco: { KeyMod: { CtrlCmd: 2048, Shift: 1024 }, KeyCode: { Enter: 3 } }, zh: { editor: { text001: '执行' } }, currentStatementZh, bindEditorIndentation, editorIndentationOptions, optionsRef: { current: { tabSize: 4, insertSpaces: true } }, editorRef: { current: null }, widgetRef: { current: null }, propsRef: { current: {} }, aliveRef: { current: true }, attachContent: () => ({ ready: true }), runRef: { current: original }, currentRunRef: { current: first } });
    runInContext(ts.transpileModule('globalThis.mounted=' + mounted, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, port); const firstEditor = actionEditor(); port.mounted(firstEditor.editor); firstEditor.changeModel();
    expect(actions.map(action => [action.id, action.keybindings[0]])).toEqual([['dbark-run', 2051], ['dbark-run-current', 3075]]); port.currentRunRef.current = latest; actions[1].run(); actions[0].run(); expect(latest).toHaveBeenCalledOnce(); expect(first).not.toHaveBeenCalled(); expect(original).toHaveBeenCalledOnce();
    actions.length = 0; port.currentRunRef.current = undefined; const nextEditor = actionEditor(); port.mounted(nextEditor.editor); nextEditor.changeModel(); expect(actions.map(action => action.id)).toEqual(['dbark-run']);
  });
});
