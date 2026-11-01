import React, { act, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
import { assertSqliteTableMaintenanceTargetAvailable, sqliteTableMaintenanceTabMatches } from '../../src/renderer/sqliteTableMaintenanceAvailability';
import { sqliteTableMaintenanceZh as text } from '../../src/renderer/locales/sqliteTableMaintenance.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import type { SqliteTableMaintenanceAction, SqliteTableMaintenanceOutcome, SqliteTableMaintenanceTarget } from '../../src/shared/sqliteTableMaintenance';
import type { AppSettings } from '../../src/shared/contracts';

type DialogProps = ComponentProps<typeof import('../../src/renderer/components/SqliteTableMaintenanceDialog')['SqliteTableMaintenanceDialog']>;
const target: SqliteTableMaintenanceTarget = { connectionId: 'sqlite-original', database: 'main', table: 'Subject"🚢' }, views: DialogProps[] = [], bridge = vi.fn();
const settingsWrites: AppSettings[] = [];
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let store: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof store.getState>;
let createWorkbenchNavigation: typeof import('../../src/renderer/workbenchNavigation')['createWorkbenchNavigation'];
/** 正式导航依赖store的window退出监听，必须先建立原内存DOM再加载，不替换生产导航实现。 */
beforeAll(async () => { document = memoryDocument(); Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store } = await import('../../src/renderer/store')); ({ createWorkbenchNavigation } = await import('../../src/renderer/workbenchNavigation')); baseline = store.getState(); });
beforeEach(() => {
  views.length = 0; settingsWrites.length = 0; bridge.mockReset();
  // 真实store会立即保存标签身份；仅提供明确的RAM设置端口，任何数据库或其它IPC都失败。
  bridge.mockImplementation((command: string, input: unknown) => { if (command !== 'settings.save') throw Error('入口夹具禁止其它IPC：' + command); settingsWrites.push(structuredClone(input) as AppSettings); return Promise.resolve(); });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); (window as any).dbark = { invoke: bridge };
  store.setState({ settings: { ...baseline.settings, tabs: [{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }, { id: 'hidden', kind: 'table', title: target.table, ...target }], activeTabId: 'query' }, connections: [{ id: target.connectionId, name: '准确文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/maintenance.sqlite', readOnly: false, busyTimeoutMs: 0 } }], connectionVersions: { [target.connectionId]: 7 }, dirtyTabs: {}, activeJobs: {}, tableLayoutDrafts: {}, queryFileDirty: {}, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; store.setState(baseline, true); delete (window as any).dbark; vi.clearAllTimers(); vi.useRealTimers(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 执行正式App的hook、入口、维护回调和dirty表达式；Dialog仅是明确外界端口，不声称执行真实维护SQL。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  const declarations: string[] = [], methods: string[] = []; let dirty = '', modal = '', synchronise = '';
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some(item => ['state', '[sqliteMaintenanceOwner, setSqliteMaintenanceOwner]', 'sqliteMaintenanceOwnerRef'].includes(item.name.getText(tree)) || ts.isObjectBindingPattern(item.name) && item.initializer?.getText(tree) === 'state' && item.name.elements.some(element => element.name.getText(tree) === 'settings'))) declarations.push(node.getText(tree));
      if (node.declarationList.declarations.some(item => item.name.getText(tree) === 'hasDirty')) dirty = node.getText(tree);
    }
    if (node.parent === (app as ts.FunctionDeclaration).body && ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(tree) === 'sqliteMaintenanceOwnerRef.current') synchronise = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && ['openSqliteTableMaintenance', 'invalidateSqliteTableMaintenance', 'finishSqliteTableMaintenance', 'openTableDrop', 'openTableTruncate'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'sqliteMaintenanceOwner' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(tree) === 'SqliteTableMaintenanceDialog') modal = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(app); expect(declarations).toHaveLength(4); expect(methods).toHaveLength(5); expect(synchronise).not.toBe(''); expect(modal).not.toBe(''); expect(dirty).toContain('sqliteMaintenanceEdits');
  const flags = Object.fromEntries(['importNewTable', 'importNewTableEdits', 'databaseDropEdits', 'copyDataEdits', 'tableCreateEdits', 'copyStructureEdits', 'databaseCreateEdits', 'dropEdits', 'truncateEdits', 'counterEdits', 'renameEdits', 'encodingEdits', 'databaseEncodingEdits', 'checksEdits', 'commentEdits', 'columnEdits', 'indexEdits', 'sqliteRenameEdits', 'sqliteColumnEdits', 'sqliteIndexEdits', 'foreignKeyEdits'].map(key => [key, false]));
  const refresh = vi.fn(), mark = vi.fn(), networkGuard = vi.fn(), sqliteRenameOwnerRef: { current: unknown } = { current: null }, sqliteIndexOwnerRef: { current: unknown } = { current: null }, sqliteColumnOwnerRef: { current: unknown } = { current: null };
  const actualNavigation = createWorkbenchNavigation(vi.fn()), navigation = { ...actualNavigation, invalidate: vi.fn(actualNavigation.invalidate), retireTable: vi.fn(actualNavigation.retireTable) }; let open!: (value: SqliteTableMaintenanceTarget, action: SqliteTableMaintenanceAction) => boolean, drop!: (value: SqliteTableMaintenanceTarget) => void, clear!: (value: SqliteTableMaintenanceTarget) => void;
  function DialogPort(props: DialogProps) { views.push(props); return <section role="dialog" aria-label={text.titles[props.action]}/>; }
  const vm = createContext({ ...flags, exports: {}, document, useRef, useState, useWorkspace: store, sqliteIndexOwnerRef, sqliteColumnOwnerRef, sqliteRenameOwnerRef, workbenchNavigation: navigation, sqliteTableMaintenanceTabMatches, structuredClone, assertSqliteTableMaintenanceTargetAvailable, sqliteTableMaintenanceZh: text, errorMessage, SqliteTableMaintenanceDialog: DialogPort, refreshRenameDatabase: refresh, markStructureTarget: mark, assertTableDropTargetAvailable: networkGuard, assertTableTruncateTargetAvailable: networkGuard, captureEntries: (value: typeof open, remove: typeof drop, empty: typeof clear) => { open = value; drop = remove; clear = empty; }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止加载其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${synchronise}\n${methods.join('\n')}\n${dirty}\ncaptureEntries(openSqliteTableMaintenance,openTableDrop,openTableTruncate);return <><output data-maintenance-dirty={hasDirty?'true':'false'}/>{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, vm);
  return { Entry: (vm as any).Entry as React.ComponentType, open: (value = target, action: SqliteTableMaintenanceAction = 'clear') => open(value, action), drop: (value = target) => drop(value), clear: (value = target) => clear(value), refresh, mark, networkGuard, sqliteIndexOwnerRef, sqliteColumnOwnerRef, sqliteRenameOwnerRef, navigation };
}
async function mount() { const f = fixture(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<f.Entry/>)); return f; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function dirty() { return document.querySelector('[data-maintenance-dirty]')!.getAttribute('data-maintenance-dirty') === 'true'; }
/** 合成ACK仅供正式父页回调路由；不将本函数称为数据库提交证据。 */
function result(action: SqliteTableMaintenanceAction = 'clear', receivedTarget = target, verified = true): SqliteTableMaintenanceOutcome { return { operationId: 'protocol-only', target: receivedTarget, action, resetSequence: false, outcome: 'committed', definitionVerified: verified, fact: { operationId: 'protocol-only', target: receivedTarget, action, phase: 'committed', requestedStatements: 1, completedStatements: 1, actualBeforeRows: '3', commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, message: '协议提交确认' }; }
/** 仅drop关闭标签产生真实store设置候选；RAM端口核对原SQL与准确剩余页面，不冒称配置库落盘。 */
function assertSettingsOnly(expectedSaves: number): void {
  expect(bridge.mock.calls.every(([command]) => command === 'settings.save')).toBe(true); expect(settingsWrites).toHaveLength(expectedSaves);
  for (const settings of settingsWrites) {
    expect(settings.tabs.filter(tab => tab.kind === 'query')).toEqual([{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }]);
    for (const tab of settings.tabs.filter(tab => tab.kind === 'table')) { expect(tab.connectionId).toBe(target.connectionId); expect(tab.database).toBe('main'); expect([target.table, 'sUBJECT"🚢', 'related']).toContain(tab.table); }
  }
  if (expectedSaves) expect(settingsWrites.at(-1)).toEqual(store.getState().settings);
}

it('正式入口固定原树目标/版本/用途，同轮重复动作不改owner、不展开/连库/替换异库查询', async () => {
  const f = await mount(), previous = store.getState().settings, candidate = { ...target }; let handled: boolean | undefined;
  await act(async () => { handled = f.open(candidate, 'clear'); candidate.table = '调用者后来修改'; f.open({ ...target, table: '另一目标' }, 'drop'); });
  expect(handled).toBe(true); expect(view().target).toEqual(target); expect(view().target).not.toBe(candidate); expect(view().targetVersion).toBe(7); expect(view().action).toBe('clear'); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled(); expect(f.networkGuard).not.toHaveBeenCalled();
});
it('旧删除/清空入口明确由SQLite用途接管，不落入MySQL网络业务处理器', async () => {
  const f = await mount(), previous = store.getState().settings; await act(async () => f.drop()); expect(view().action).toBe('drop'); await act(async () => view().onClose()); await act(async () => f.clear()); expect(view().action).toBe('clear'); expect(f.networkGuard).not.toHaveBeenCalled(); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
it('任何模态与同轮待展示rename/columns/index窗口都不领取维护owner', async () => {
  const f = await mount(); for (const role of ['dialog', 'alertdialog']) { const blocker = document.createElement('div'); blocker.setAttribute('role', role); document.body.appendChild(blocker); await act(async () => f.open()); expect(views).toEqual([]); document.body.removeChild(blocker); }
  for (const ref of [f.sqliteRenameOwnerRef, f.sqliteColumnOwnerRef, f.sqliteIndexOwnerRef]) { ref.current = {}; await act(async () => f.open()); expect(views).toEqual([]); ref.current = null; } expect(f.navigation.invalidate).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同库其它表隐藏页%s也保护真实入口，处理后原查询草稿不阻维护目录', async field => {
  const f = await mount(); await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'related', kind: 'table', title: '可能受影响', ...target, table: 'related' }] }, [field]: { related: true } })); f.open(); }); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true);
  await act(async () => { store.setState({ [field]: { query: true } }); f.open(); }); expect(view().target).toEqual(target); expect(store.getState().settings.activeTabId).toBe('query'); expect(bridge).not.toHaveBeenCalled();
});
it('旧关闭与迟到dirty不能污染后继owner，原查询草稿保持', async () => {
  const f = await mount(); await act(async () => f.open()); const old = view(); await act(async () => old.onDirtyChange!(true)); expect(dirty()).toBe(true); await act(async () => old.onClose());
  await act(async () => f.open(target, 'drop')); const current = view(); await act(async () => { current.onDirtyChange!(true); old.onClose(); old.onDirtyChange!(false); }); expect(view().target).toBe(current.target); expect(view().action).toBe('drop'); expect(dirty()).toBe(true);
  await act(async () => { store.setState({ dirtyTabs: { query: true } }); current.onClose(); old.onDirtyChange!(true); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(dirty()).toBe(true); expect(store.getState().dirtyTabs.query).toBe(true); expect(bridge).not.toHaveBeenCalled();
});
it.each(['clear', 'drop'] as const)('未知%s只停止自动读取并保留草稿；仅drop使旧名称链接退役', async action => {
  const f = await mount(); await act(async () => f.open(target, action)); const previous = store.getState().settings;
  await act(async () => { store.setState({ dirtyTabs: { hidden: true }, tableLayoutDrafts: { hidden: true } }); view().onExecutionUncertain!(action); }); expect(store.getState().settings).toBe(previous); expect(store.getState().dirtyTabs.hidden).toBe(true); expect(store.getState().tableLayoutDrafts.hidden).toBe(true); expect(f.mark).toHaveBeenCalledWith(target, false); expect(f.navigation.invalidate).toHaveBeenCalled();
  if (action === 'drop') expect(f.navigation.retireTable).toHaveBeenCalledWith(target); else expect(f.navigation.retireTable).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('准确clear只自动刷新原表及大小写别名，保留标签ID/原查询，关联其它表不自动读取', async () => {
  const f = await mount(); await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'alias', kind: 'table', title: '大小写别名', ...target, table: 'sUBJECT"🚢' }, { id: 'related', kind: 'table', title: '关联表', ...target, table: 'related' }] } })); f.open(); });
  const previous = store.getState().settings; await act(async () => view().onApplied!(result(), 7)); expect(store.getState().settings).toBe(previous); expect(f.mark).toHaveBeenCalledWith(target, true); expect(f.mark).toHaveBeenCalledWith({ ...target, table: 'sUBJECT"🚢' }, true); expect(f.mark).toHaveBeenCalledWith({ ...target, table: 'related' }, false); expect(f.navigation.retireTable).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('准确drop只关闭clean原表及SQLite ASCII别名，不重开页面或修改原查询/关联表', async () => {
  const f = await mount(); await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'alias', kind: 'table', title: '大小写别名', ...target, table: 'sUBJECT"🚢' }, { id: 'related', kind: 'table', title: '关联表', ...target, table: 'related' }] } })); f.open(target, 'drop'); });
  const previous = store.getState().settings; await act(async () => view().onApplied!(result('drop'), 7)); const current = store.getState().settings; expect(current.tabs.map(tab => tab.id)).toEqual(['query', 'related']); expect(current.tabs[0]).toBe(previous.tabs[0]); expect(current.tabs[1]).toBe(previous.tabs.find(tab => tab.id === 'related')); expect(current.activeTabId).toBe('query'); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(f.navigation.retireTable).toHaveBeenCalledWith(target); assertSettingsOnly(2);
  const uri = { connectionId: target.connectionId, database: 'main', kind: 'table' as const, name: target.table }; await expect(f.navigation.open(uri, { resolve: async value => value })).rejects.toThrow('旧对象链接'); assertSettingsOnly(2);
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('已确认维护期间同库其它表后来出现%s，保留所有标签/草稿并禁止自动读', async field => {
  const f = await mount(); await act(async () => f.open(target, 'drop')); await act(async () => store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'related', kind: 'table', title: '关联表', ...target, table: 'related' }] }, [field]: { related: true } })));
  const previous = store.getState().settings; await act(async () => view().onApplied!(result('drop'), 7)); expect(store.getState().settings).toBe(previous); expect(store.getState()[field].related).toBe(true); expect(store.getState().notice?.error).toBe(true); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(bridge).not.toHaveBeenCalled();
});
it('缺少后置确认不刷新，错误用途/目标、旧owner和连接换代均不能接受迟到回调', async () => {
  const f = await mount(); await act(async () => f.open()); const original = view(), previous = store.getState().settings; await act(async () => original.onApplied!(result('clear', target, false), 7)); expect(store.getState().settings).toBe(previous); expect(f.mark).toHaveBeenCalledWith(target, false);
  const calls = f.mark.mock.calls.length; await act(async () => { original.onApplied!(result('drop'), 7); original.onApplied!(result('clear', { ...target, table: '另一目标' }), 7); original.onExecutionUncertain!('drop'); }); expect(f.mark).toHaveBeenCalledTimes(calls);
  await act(async () => { store.setState({ connectionVersions: { [target.connectionId]: 8 } }); original.onApplied!(result(), 7); original.onApplied!(result(), 8); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().notice?.error).toBe(true);
  await act(async () => original.onClose()); await act(async () => f.open(target, 'drop')); await act(async () => { original.onApplied!(result(), 7); original.onExecutionUncertain!('clear'); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
it('非SQLite路由返回false，main之外SQLite来源报告错误但不落入网络写入', async () => {
  const f = await mount(); let handled: boolean | undefined; await act(async () => { handled = f.open({ ...target, connectionId: 'not-sqlite' }); }); expect(handled).toBe(false); expect(views).toEqual([]);
  await act(async () => { handled = f.open({ ...target, database: 'temp' } as any); }); expect(handled).toBe(true); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true); expect(bridge).not.toHaveBeenCalled(); expect(f.networkGuard).not.toHaveBeenCalled();
});
