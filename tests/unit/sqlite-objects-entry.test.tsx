import React, { act, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
import { assertSqliteObjectsScopeAvailable, assertSqliteObjectsTargetAvailable, sqliteObjectsTabMatches, type SqliteObjectsScope } from '../../src/renderer/sqliteObjectsAvailability';
import { sqliteObjectsZh as text } from '../../src/renderer/locales/sqliteObjects.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import type { SqliteObjectsAction, SqliteObjectsOutcome, SqliteObjectsTarget } from '../../src/shared/sqliteObjects';
import type { AppSettings } from '../../src/shared/contracts';

type DialogProps = ComponentProps<typeof import('../../src/renderer/components/SqliteObjectsDialog')['SqliteObjectsDialog']>;
const target: SqliteObjectsTarget = { connectionId: 'sqlite-original', database: 'main', kind: 'view', name: 'Subject"🚢' }, views: DialogProps[] = [], bridge = vi.fn();
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
  store.setState({ settings: { ...baseline.settings, tabs: [{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }, { id: 'hidden', kind: 'table', title: target.name, connectionId: target.connectionId, database: 'main', table: target.name }], activeTabId: 'query' }, connections: [{ id: target.connectionId, name: '准确文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/maintenance.sqlite', readOnly: false, busyTimeoutMs: 0 } }], connectionVersions: { [target.connectionId]: 7 }, dirtyTabs: {}, activeJobs: {}, tableLayoutDrafts: {}, queryFileDirty: {}, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; store.setState(baseline, true); delete (window as any).dbark; vi.clearAllTimers(); vi.useRealTimers(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 执行正式App的hook、入口、对象回调和dirty表达式；Dialog仅是明确外界端口，不声称执行真实对象SQL。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  const declarations: string[] = [], methods: string[] = []; let dirty = '', modal = '', synchronise = '';
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some(item => ['state', '[sqliteObjectsOwner, setSqliteObjectsOwner]', 'sqliteObjectsOwnerRef', 'sqliteObjectsTargetRef'].includes(item.name.getText(tree)) || ts.isObjectBindingPattern(item.name) && item.initializer?.getText(tree) === 'state' && item.name.elements.some(element => element.name.getText(tree) === 'settings'))) declarations.push(node.getText(tree));
      if (node.declarationList.declarations.some(item => item.name.getText(tree) === 'hasDirty')) dirty = node.getText(tree);
    }
    if (node.parent === (app as ts.FunctionDeclaration).body && ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(tree) === 'sqliteObjectsOwnerRef.current') synchronise = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && ['openSqliteObjects', 'invalidateSqliteObjects', 'finishSqliteObjects'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'sqliteObjectsOwner' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(tree) === 'SqliteObjectsDialog') modal = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(app); expect(declarations).toHaveLength(5); expect(methods).toHaveLength(3); expect(synchronise).not.toBe(''); expect(modal).not.toBe(''); expect(dirty).toContain('sqliteObjectsEdits');
  const flags = Object.fromEntries(['sqliteMaintenanceEdits', 'importNewTable', 'importNewTableEdits', 'databaseDropEdits', 'copyDataEdits', 'tableCreateEdits', 'copyStructureEdits', 'databaseCreateEdits', 'dropEdits', 'truncateEdits', 'counterEdits', 'renameEdits', 'encodingEdits', 'databaseEncodingEdits', 'checksEdits', 'commentEdits', 'columnEdits', 'indexEdits', 'sqliteRenameEdits', 'sqliteColumnEdits', 'sqliteIndexEdits', 'foreignKeyEdits'].map(key => [key, false]));
  const refresh = vi.fn(), mark = vi.fn(), networkGuard = vi.fn(), sqliteMaintenanceOwnerRef: { current: unknown } = { current: null }, sqliteRenameOwnerRef: { current: unknown } = { current: null }, sqliteIndexOwnerRef: { current: unknown } = { current: null }, sqliteColumnOwnerRef: { current: unknown } = { current: null };
  const actualNavigation = createWorkbenchNavigation(vi.fn()), navigation = { ...actualNavigation, invalidate: vi.fn(actualNavigation.invalidate), retireObject: vi.fn(actualNavigation.retireObject) }; let open!: (value: SqliteObjectsScope, action: SqliteObjectsAction) => void;
  function DialogPort(props: DialogProps) { views.push(props); return <section role="dialog" aria-label={text.title(props.action,props.scope.kind)}/>; }
  const vm = createContext({ ...flags, sqliteRebuildOwnerRef: { current: null }, sqliteRebuildOwner: null, sqliteRebuildEdits: false, exports: {}, document, useRef, useState, useWorkspace: store, sqliteIndexOwnerRef, sqliteColumnOwnerRef, sqliteRenameOwnerRef, sqliteMaintenanceOwnerRef, workbenchNavigation: navigation, sqliteObjectsTabMatches, structuredClone, assertSqliteObjectsScopeAvailable, assertSqliteObjectsTargetAvailable, sqliteObjectsZh: text, errorMessage, SqliteObjectsDialog: DialogPort, refreshRenameDatabase: refresh, markStructureTarget: mark, assertTableDropTargetAvailable: networkGuard, assertTableTruncateTargetAvailable: networkGuard, captureOpen: (value: typeof open) => { open = value; }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止加载其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${synchronise}\n${methods.join('\n')}\n${dirty}\ncaptureOpen(openSqliteObjects);return <><output data-objects-dirty={hasDirty?'true':'false'}/>{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, vm);
  return { Entry: (vm as any).Entry as React.ComponentType, open: (value: SqliteObjectsScope = target, action: SqliteObjectsAction = 'replace') => open(value, action), refresh, mark, networkGuard, sqliteIndexOwnerRef, sqliteColumnOwnerRef, sqliteRenameOwnerRef, sqliteMaintenanceOwnerRef, navigation };
}
async function mount() { const f = fixture(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<f.Entry/>)); return f; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function dirty() { return document.querySelector('[data-objects-dirty]')!.getAttribute('data-objects-dirty') === 'true'; }
/** 合成ACK仅供正式父页回调路由；不将本函数称为数据库提交证据。 */
function result(action: SqliteObjectsAction = 'replace', receivedTarget = target, verified = true): SqliteObjectsOutcome { return { operationId: 'protocol-only', target: receivedTarget, action, outcome: 'committed', definitionVerified: verified, fact: { operationId: 'protocol-only', target: receivedTarget, action, phase: 'committed', requestedStatements: action === 'replace' ? 2 : 1, completedStatements: action === 'replace' ? 2 : 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, message: '协议提交确认' }; }
/** 仅关闭view页产生设置候选，RAM端口不冒称本地配置持久化，更不执行数据库SQL。 */
function assertSettingsOnly(expectedSaves: number): void {
  expect(bridge.mock.calls.every(([command]) => command === 'settings.save')).toBe(true); expect(settingsWrites).toHaveLength(expectedSaves);
  for (const settings of settingsWrites) { expect(settings.tabs.filter(tab => tab.kind === 'query')).toEqual([{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }]); for (const tab of settings.tabs.filter(tab => tab.kind === 'table')) { expect(tab.connectionId).toBe(target.connectionId); expect(tab.database).toBe('main'); expect([target.name, 'sUBJECT"🚢', 'related']).toContain(tab.table); } }
  if (expectedSaves) expect(settingsWrites.at(-1)).toEqual(store.getState().settings);
}

it('create无名称可以开本地窗，但真实accepted target前任何完成/未知回调都不投影', async () => {
  const f = await mount(), { name: _name, ...scope } = target, previous = store.getState().settings; await act(async () => f.open(scope, 'create')); expect(view().scope).toEqual(scope); expect(view().action).toBe('create'); expect(view().targetVersion).toBe(7);
  await act(async () => { view().onApplied!(result('create'), 7); view().onExecutionUncertain!(target, 'create'); }); expect(f.mark).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
  await act(async () => { view().onTargetChange!(target); view().onApplied!(result('create'), 7); }); expect(f.mark).toHaveBeenCalled(); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
it('create预填名称仍未授权完成；改名后接受真正target，重读撤绑定不丢原查询', async () => {
  const f = await mount(), previous = store.getState().settings; await act(async () => f.open(target, 'create')); await act(async () => view().onApplied!(result('create'), 7)); expect(f.mark).not.toHaveBeenCalled();
  const renamed = { ...target, name: '新名称' }; await act(async () => { view().onTargetChange!(renamed); view().onApplied!(result('create', target), 7); }); expect(f.mark).not.toHaveBeenCalled();
  await act(async () => view().onApplied!(result('create', renamed), 7)); expect(f.mark).toHaveBeenCalled(); const calls = f.mark.mock.calls.length; await act(async () => { view().onTargetChange!(undefined); view().onApplied!(result('create', renamed), 7); view().onExecutionUncertain!(renamed, 'create'); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
it.each(['replace', 'drop'] as const)('%s没有既有准确名称时拒绝入口，不读取目录', async action => { const f = await mount(), { name: _name, ...scope } = target; await act(async () => f.open(scope, action)); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true); expect(bridge).not.toHaveBeenCalled(); });
it('入口复制scope及原版本，同轮重复调用不换目标/用途，不改活动异库查询', async () => {
  const f = await mount(), candidate = { ...target }, previous = store.getState().settings; await act(async () => { f.open(candidate); candidate.name = '调用者改名'; f.open({ ...target, kind: 'trigger' }, 'drop'); }); expect(view().scope).toEqual(target); expect(view().scope).not.toBe(candidate); expect(view().action).toBe('replace'); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
it('任何模态或同轮其它SQLite结构owner均阻止新对象窗口', async () => {
  const f = await mount(); for (const role of ['dialog', 'alertdialog']) { const blocker = document.createElement('div'); blocker.setAttribute('role', role); document.body.appendChild(blocker); await act(async () => f.open()); expect(views).toEqual([]); document.body.removeChild(blocker); }
  for (const ref of [f.sqliteMaintenanceOwnerRef, f.sqliteRenameOwnerRef, f.sqliteColumnOwnerRef, f.sqliteIndexOwnerRef]) { ref.current = {}; await act(async () => f.open()); expect(views).toEqual([]); ref.current = null; } expect(f.navigation.invalidate).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('同main其它表%s保护无名create入口，查询草稿不能替代对象scope', async field => {
  const f = await mount(), { name: _name, ...scope } = target; await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'related', kind: 'table', title: '关联表', connectionId: target.connectionId, database: 'main', table: 'related' }] }, [field]: { related: true } })); f.open(scope, 'create'); }); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true);
  await act(async () => { store.setState({ [field]: { query: true } }); f.open(scope, 'create'); }); expect(view().scope).toEqual(scope); expect(store.getState().settings.activeTabId).toBe('query'); expect(bridge).not.toHaveBeenCalled();
});
it('准确replace view只自动刷新原页和ASCII别名，其它同main页失效但不自动读', async () => {
  const f = await mount(); await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'alias', kind: 'table', title: '别名', connectionId: target.connectionId, database: 'main', table: 'sUBJECT"🚢' }, { id: 'related', kind: 'table', title: '关联表', connectionId: target.connectionId, database: 'main', table: 'related' }] } })); f.open(); }); const previous = store.getState().settings;
  await act(async () => view().onApplied!(result(), 7)); expect(store.getState().settings).toBe(previous); expect(f.mark).toHaveBeenCalledWith({ connectionId: target.connectionId, database: 'main', table: target.name }, true); expect(f.mark).toHaveBeenCalledWith({ connectionId: target.connectionId, database: 'main', table: 'sUBJECT"🚢' }, true); expect(f.mark).toHaveBeenCalledWith({ connectionId: target.connectionId, database: 'main', table: 'related' }, false); expect(f.navigation.retireObject).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it.each(['view', 'trigger'] as const)('准确drop %s按kind退役，仅view关闭clean表页，不修改同名trigger的数据页', async kind => {
  const f = await mount(), selected = { ...target, kind }; await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'alias', kind: 'table', title: '别名', connectionId: target.connectionId, database: 'main', table: 'sUBJECT"🚢' }, { id: 'related', kind: 'table', title: '关联表', connectionId: target.connectionId, database: 'main', table: 'related' }] } })); f.open(selected, 'drop'); }); const previous = store.getState().settings;
  await act(async () => view().onApplied!(result('drop', selected), 7)); expect(f.navigation.retireObject).toHaveBeenCalledWith(selected); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true);
  if (kind === 'view') { const current = store.getState().settings; expect(current.tabs.map(tab => tab.id)).toEqual(['query', 'related']); expect(current.tabs[0]).toBe(previous.tabs[0]); expect(current.activeTabId).toBe('query'); assertSettingsOnly(2); } else { expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled(); }
});
it.each(['create', 'replace', 'drop'] as const)('未知%s只按已接受精确target退役并停止自动读取，草稿和查询不丢失', async action => {
  const f = await mount(); await act(async () => f.open(target, action)); if (action === 'create') await act(async () => view().onTargetChange!(target)); const previous = store.getState().settings;
  await act(async () => { store.setState({ dirtyTabs: { hidden: true }, tableLayoutDrafts: { hidden: true } }); view().onExecutionUncertain!(target, action); }); expect(store.getState().settings).toBe(previous); expect(store.getState().dirtyTabs.hidden).toBe(true); expect(store.getState().tableLayoutDrafts.hidden).toBe(true); expect(f.navigation.retireObject).toHaveBeenCalledWith(target); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(bridge).not.toHaveBeenCalled();
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('回调期间同main其它表后来出现%s时，保全部页面并禁止自动读取', async field => {
  const f = await mount(); await act(async () => f.open(target, 'drop')); await act(async () => store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'related', kind: 'table', title: '关联表', connectionId: target.connectionId, database: 'main', table: 'related' }] }, [field]: { related: true } }))); const previous = store.getState().settings;
  await act(async () => view().onApplied!(result('drop'), 7)); expect(store.getState().settings).toBe(previous); expect(store.getState()[field].related).toBe(true); expect(store.getState().notice?.error).toBe(true); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(bridge).not.toHaveBeenCalled();
});
it('错误scope/name/kind不能换既有绑定，版本/用途/后置条件及旧owner回调均不越过来源门', async () => {
  const f = await mount(); await act(async () => f.open()); const original = view(), previous = store.getState().settings;
  for (const patch of [{ connectionId: 'other' }, { kind: 'trigger' as const }, { name: 'different' }]) await act(async () => { original.onTargetChange!({ ...target, ...patch }); original.onApplied!(result('replace', { ...target, ...patch }), 7); }); expect(f.mark).not.toHaveBeenCalled();
  await act(async () => { original.onApplied!(result('drop'), 7); original.onApplied!(result('replace', target, false), 7); }); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); const calls = f.mark.mock.calls.length;
  await act(async () => { store.setState({ connectionVersions: { [target.connectionId]: 8 } }); original.onApplied!(result(), 7); original.onApplied!(result(), 8); }); expect(f.mark).toHaveBeenCalledTimes(calls);
  await act(async () => original.onClose()); await act(async () => f.open({ ...target, kind: 'trigger' }, 'drop')); const current = view(); await act(async () => { current.onDirtyChange!(true); original.onTargetChange!(target); original.onClose(); original.onDirtyChange!(false); original.onExecutionUncertain!(target, 'replace'); original.onApplied!(result(), 7); }); expect(view().scope.kind).toBe('trigger'); expect(dirty()).toBe(true); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled();
});
