import React, { act, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
import { assertSqliteTableRenameTargetAvailable, sqliteTableRenameTabMatches } from '../../src/renderer/sqliteTableRenameAvailability';
import { sqliteTableRenameZh as text } from '../../src/renderer/locales/sqliteTableRename.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import { tableRenameZh } from '../../src/renderer/locales/tableRename.zh-CN';
import { reconcileTableRenameFavorites } from '../../src/renderer/tableRenameReconcile';
import { emptyWorkbench, type WorkbenchDocument } from '../../src/shared/workbench';
import type { SqliteTableRenameOutcome, SqliteTableRenameTarget } from '../../src/shared/sqliteTableRename';
import type { AppSettings } from '../../src/shared/contracts';

type DialogProps = ComponentProps<typeof import('../../src/renderer/components/SqliteTableRenameDialog')['SqliteTableRenameDialog']>;
const target: SqliteTableRenameTarget = { connectionId: 'sqlite-original', database: 'main', table: '原表"🚢' }, views: DialogProps[] = [], bridge = vi.fn();
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
  store.setState({ settings: { ...baseline.settings, tabs: [{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }, { id: 'hidden', kind: 'table', title: target.table, ...target }], activeTabId: 'query' }, connections: [{ id: target.connectionId, name: '准确文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/columns.sqlite', readOnly: false, busyTimeoutMs: 0 } }], connectionVersions: { [target.connectionId]: 7 }, dirtyTabs: {}, activeJobs: {}, tableLayoutDrafts: {}, queryFileDirty: {}, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; store.setState(baseline, true); delete (window as any).dbark; vi.clearAllTimers(); vi.useRealTimers(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 执行正式App的hook、入口、改名回调和dirty表达式；Dialog仅是明确外界端口，不声称执行真实DDL。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  const declarations: string[] = [], methods: string[] = []; let dirty = '', modal = '', synchronise = '';
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some(item => ['state', '[sqliteRenameOwner, setSqliteRenameOwner]', 'sqliteRenameOwnerRef'].includes(item.name.getText(tree)) || ts.isObjectBindingPattern(item.name) && item.initializer?.getText(tree) === 'state' && item.name.elements.some(element => element.name.getText(tree) === 'settings'))) declarations.push(node.getText(tree));
      if (node.declarationList.declarations.some(item => item.name.getText(tree) === 'hasDirty')) dirty = node.getText(tree);
    }
    if (node.parent === (app as ts.FunctionDeclaration).body && ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(tree) === 'sqliteRenameOwnerRef.current') synchronise = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && ['openTableRename', 'invalidateSqliteRename', 'finishSqliteTableRename'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'sqliteRenameOwner' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(tree) === 'SqliteTableRenameDialog') modal = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(app); expect(declarations).toHaveLength(4); expect(methods).toHaveLength(3); expect(synchronise).not.toBe(''); expect(modal).not.toBe(''); expect(dirty).toContain('sqliteRenameEdits');
  const flags = Object.fromEntries(['importNewTable', 'importNewTableEdits', 'databaseDropEdits', 'copyDataEdits', 'tableCreateEdits', 'copyStructureEdits', 'databaseCreateEdits', 'dropEdits', 'truncateEdits', 'counterEdits', 'renameEdits', 'encodingEdits', 'databaseEncodingEdits', 'checksEdits', 'commentEdits', 'columnEdits', 'indexEdits', 'sqliteObjectsEdits', 'sqliteMaintenanceEdits', 'sqliteColumnEdits', 'sqliteIndexEdits', 'foreignKeyEdits'].map(key => [key, false]));
  const refresh = vi.fn(), mark = vi.fn(), networkGuard = vi.fn(), sqliteIndexOwnerRef: { current: unknown } = { current: null }, sqliteColumnOwnerRef: { current: unknown } = { current: null };
  const actualNavigation = createWorkbenchNavigation(vi.fn()), navigation = { ...actualNavigation, invalidate: vi.fn(actualNavigation.invalidate), retireTable: vi.fn(actualNavigation.retireTable), completeTableRename: vi.fn(actualNavigation.completeTableRename) }, favorites = { ready: true, busy: false, snapshot: { document: emptyWorkbench() }, save: vi.fn(async (value: WorkbenchDocument) => { favorites.snapshot.document = value; return true; }) }; let open!: (value: SqliteTableRenameTarget) => void;
  function DialogPort(props: DialogProps) { views.push(props); return <section role="dialog" aria-label={text.title}/>; }
  const vm = createContext({ ...flags, sqliteRebuildOwnerRef: { current: null }, sqliteRebuildOwner: null, sqliteRebuildEdits: false, sqliteObjectsOwnerRef: { current: null }, sqliteMaintenanceOwnerRef: { current: null }, exports: {}, document, useRef, useState, useWorkspace: store, sqliteIndexOwnerRef, sqliteColumnOwnerRef, useWorkbench: { getState: () => favorites }, workbenchNavigation: navigation, sqliteTableRenameTabMatches, reconcileTableRenameFavorites, tableRenameZh, structuredClone, assertSqliteTableRenameTargetAvailable, sqliteTableRenameZh: text, errorMessage, SqliteTableRenameDialog: DialogPort, refreshRenameDatabase: refresh, markStructureTarget: mark, assertTableRenameTargetAvailable: networkGuard, setRenameVersion: vi.fn(), setRenameEdits: vi.fn(), setRenameTarget: vi.fn(), captureOpen: (value: typeof open) => { open = value; }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止加载其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${synchronise}\n${methods.join('\n')}\n${dirty}\ncaptureOpen(openTableRename);return <><output data-rename-dirty={hasDirty?'true':'false'}/>{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, vm);
  return { Entry: (vm as any).Entry as React.ComponentType, open: (value = target) => open(value), refresh, mark, networkGuard, sqliteIndexOwnerRef, sqliteColumnOwnerRef, navigation, favorites };
}
async function mount() { const f = fixture(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<f.Entry/>)); return f; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function dirty() { return document.querySelector('[data-rename-dirty]')!.getAttribute('data-rename-dirty') === 'true'; }
/** 合成ACK仅供正式父页回调路由；不将本函数称为数据库提交证据。 */
function result(receivedTarget = target, verified = true): SqliteTableRenameOutcome { return { operationId: 'protocol-only', target: receivedTarget, newName: '新表"🚢', navigationIdentity: 'a'.repeat(64), outcome: 'committed', definitionVerified: verified, fact: { operationId: 'protocol-only', target: receivedTarget, phase: 'committed', requestedStatements: 1, completedStatements: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, message: '协议提交确认' }; }
/** 设置保存是RAM协议证据；核对每次候选都只包含本例页面和原查询，不冒称写入本地配置库。 */
function assertSettingsOnly(expectedSaves: number, tableNames: string[] = [target.table, '新表"🚢']): void {
  expect(bridge.mock.calls.every(([command]) => command === 'settings.save')).toBe(true); expect(settingsWrites).toHaveLength(expectedSaves);
  for (const settings of settingsWrites) {
    expect(settings.tabs.filter(tab => tab.kind === 'query')).toEqual([{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }]);
    for (const tab of settings.tabs.filter(tab => tab.kind === 'table')) { expect(tab.connectionId).toBe(target.connectionId); expect(tab.database).toBe('main'); expect(tableNames).toContain(tab.table); }
  }
  if (expectedSaves) expect(settingsWrites.at(-1)).toEqual(store.getState().settings);
}

it('正式入口捕获原树目标及版本，同轮重复调用不展开/连库/替换原查询', async () => {
  const f = await mount(), previous = store.getState().settings, candidate = { ...target };
  await act(async () => { f.open(candidate); candidate.table = '调用者后来修改'; f.open({ ...target, table: '第二个目标' }); });
  expect(view().target).toEqual(target); expect(view().target).not.toBe(candidate); expect(view().targetVersion).toBe(7); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled(); expect(f.networkGuard).not.toHaveBeenCalled();
});
it('任何模态及同轮待展示字段/索引窗口都不领取rename owner', async () => {
  const f = await mount(); for (const role of ['dialog', 'alertdialog']) { const blocker = document.createElement('div'); blocker.setAttribute('role', role); document.body.appendChild(blocker); await act(async () => f.open()); expect(views).toEqual([]); document.body.removeChild(blocker); }
  for (const ref of [f.sqliteColumnOwnerRef, f.sqliteIndexOwnerRef]) { ref.current = {}; await act(async () => f.open()); expect(views).toEqual([]); ref.current = null; }
  expect(f.navigation.invalidate).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('原表隐藏页%s保护真实入口；异库查询的草稿不改操作目标', async field => {
  const f = await mount(); await act(async () => { store.setState({ [field]: { hidden: true } }); f.open(); }); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true);
  await act(async () => { store.setState({ [field]: { query: true } }); f.open(); }); expect(view().target).toEqual(target); expect(store.getState().settings.activeTabId).toBe('query'); expect(bridge).not.toHaveBeenCalled();
});
it('旧关闭与迟到dirty不能污染后继owner，源查询草稿保持', async () => {
  const f = await mount(); await act(async () => f.open()); const old = view(); await act(async () => old.onDirtyChange!(true)); expect(dirty()).toBe(true); await act(async () => old.onClose());
  await act(async () => f.open()); const current = view(); await act(async () => { current.onDirtyChange!(true); old.onClose(); old.onDirtyChange!(false); }); expect(view().target).toBe(current.target); expect(dirty()).toBe(true);
  await act(async () => { store.setState({ dirtyTabs: { query: true } }); current.onClose(); old.onDirtyChange!(true); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(dirty()).toBe(true); expect(store.getState().dirtyTabs.query).toBe(true);
});
it('未知回执失效原/新及同库依赖页、退役两处链接，原行草稿和SQL完全保留', async () => {
  const f = await mount(); await act(async () => f.open());
  const previous = store.getState().settings; await act(async () => { store.setState({ dirtyTabs: { hidden: true }, tableLayoutDrafts: { hidden: true } }); view().onExecutionUncertain!('新表"🚢'); });
  expect(store.getState().settings).toBe(previous); expect(store.getState().dirtyTabs.hidden).toBe(true); expect(store.getState().tableLayoutDrafts.hidden).toBe(true); expect(f.mark).toHaveBeenCalledWith(target, false); expect(f.mark).toHaveBeenCalledWith({ ...target, table: '新表"🚢' }, false); expect(f.navigation.retireTable).toHaveBeenCalledWith(target); expect(f.navigation.retireTable).toHaveBeenCalledWith({ ...target, table: '新表"🚢' }); expect(f.favorites.save).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('准确提交与定义确认只关闭匹配clean表页并新ID重开；原查询对象和SQL不修改', async () => {
  const f = await mount(), originalQuery = store.getState().settings.tabs[0];
  await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'existing-new', kind: 'table', title: '新表"🚢', ...target, table: '新表"🚢' }, { id: 'unrelated', kind: 'table', title: '另表', ...target, table: '另表' }] } })); f.open(); });
  await act(async () => view().onApplied!(result(), 7));
  const current = store.getState().settings; expect(current.tabs.find(tab => tab.id === 'query')).toBe(originalQuery); expect(originalQuery.sql).toBe('SELECT 原查询'); expect(current.tabs.some(tab => tab.id === 'hidden' || tab.id === 'existing-new')).toBe(false); expect(current.tabs.some(tab => tab.id === 'unrelated')).toBe(true);
  const opened = current.tabs.filter(tab => tab.kind === 'table' && tab.table === '新表"🚢'); expect(opened).toHaveLength(1); expect(opened[0].id).not.toBe('hidden'); expect(opened[0].id).not.toBe('existing-new'); expect(current.activeTabId).toBe(opened[0].id); expect(f.mark.mock.calls.every(([, automatic]) => automatic === false)).toBe(true); expect(store.getState().notice).toEqual({ text: tableRenameZh.referencesNotice, error: false }); assertSettingsOnly(3, [target.table, '新表"🚢', '另表']);
});
it.each(['dirtyTabs', 'activeJobs', 'tableLayoutDrafts'] as const)('提交回调遇原表或新表页后来出现%s，保留全部标签和草稿', async field => {
  const f = await mount(); await act(async () => f.open());
  await act(async () => { store.setState(state => ({ settings: { ...state.settings, tabs: [...state.settings.tabs, { id: 'destination', kind: 'table', title: '新表"🚢', ...target, table: '新表"🚢' }] }, [field]: { destination: true } })); });
  const previous = store.getState().settings; await act(async () => view().onApplied!(result(), 7)); expect(store.getState().settings).toBe(previous); expect(store.getState()[field].destination).toBe(true); expect(store.getState().notice?.error).toBe(true); expect(f.favorites.save).not.toHaveBeenCalled();
});
it('缺少后置定义确认不迁移标签或收藏，错误目标/旧owner/连接版本不接受回调', async () => {
  const f = await mount(); await act(async () => f.open()); const original = view(), previous = store.getState().settings;
  await act(async () => original.onApplied!(result(target, false), 7)); expect(store.getState().settings).toBe(previous); expect(f.navigation.retireTable).toHaveBeenCalledWith({ ...target, table: '新表"🚢' });
  const calls = f.mark.mock.calls.length; await act(async () => original.onApplied!(result({ ...target, table: '错误目标' }), 7)); expect(f.mark).toHaveBeenCalledTimes(calls);
  await act(async () => { store.setState({ connectionVersions: { [target.connectionId]: 8 } }); original.onApplied!(result(), 7); original.onApplied!(result(), 8); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().notice?.error).toBe(true);
  await act(async () => original.onClose()); await act(async () => f.open()); await act(async () => { original.onApplied!(result(), 7); original.onExecutionUncertain!('旧新表'); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().settings).toBe(previous); expect(f.favorites.save).not.toHaveBeenCalled();
});
it('收藏新名冲突只报告待人工处理，不覆盖收藏或宣称收藏迁移成功', async () => {
  const f = await mount(); f.favorites.snapshot.document.favorites = [{ id: 'old', label: '自定义名称', groupId: null, target: { connectionId: target.connectionId, database: 'main', kind: 'table', name: target.table } }, { id: 'new', label: '新名收藏', groupId: null, target: { connectionId: target.connectionId, database: 'main', kind: 'table', name: '新表"🚢' } }];
  const document = f.favorites.snapshot.document; await act(async () => f.open()); await act(async () => view().onApplied!(result(), 7)); expect(f.favorites.save).not.toHaveBeenCalled(); expect(f.favorites.snapshot.document).toBe(document); expect(store.getState().notice).toEqual({ text: tableRenameZh.favoritesPending, error: true }); expect(f.navigation.completeTableRename).toHaveBeenCalledWith(target, { ...target, table: '新表"🚢' }, 'a'.repeat(64)); assertSettingsOnly(2);
});
it('无冲突收藏复用原迁移器并保留自定义标签，保存失败明确报告而不重放DDL', async () => {
  const f = await mount(); f.favorites.snapshot.document.favorites = [{ id: 'old', label: '自定义名称', groupId: null, target: { connectionId: target.connectionId, database: 'main', kind: 'table', name: target.table } }]; f.favorites.save.mockResolvedValue(false);
  await act(async () => f.open()); await act(async () => view().onApplied!(result(), 7)); expect(f.favorites.save).toHaveBeenCalledTimes(1); expect(f.favorites.save.mock.calls[0][0].favorites[0]).toMatchObject({ label: '自定义名称', target: { name: '新表"🚢' } }); expect(store.getState().notice).toEqual({ text: tableRenameZh.favoritesPending, error: true }); assertSettingsOnly(2);
});
it('同一已确认会话lineage的SQLite A→B→A可继续打开新收藏，查询SQL保持原文', async () => {
  const f = await mount(); f.favorites.snapshot.document.favorites = [{ id: 'owned', groupId: null, label: '业务表', target: { connectionId: target.connectionId, database: 'main', kind: 'table', name: target.table } }];
  const query = store.getState().settings.tabs[0]; await act(async () => f.open()); await act(async () => view().onApplied!(result(), 7)); await act(async () => view().onClose());
  const moved = { ...target, table: '新表"🚢' }; await act(async () => f.open(moved)); const back = { ...result(moved), newName: target.table }; await act(async () => view().onApplied!(back, 7));
  expect(f.navigation.completeTableRename).toHaveBeenCalledTimes(2); expect(f.navigation.completeTableRename.mock.results.map(item => item.value)).toEqual([true, true]); expect(f.favorites.save).toHaveBeenCalledTimes(2); expect(f.favorites.snapshot.document.favorites[0].target).toMatchObject({ name: target.table });
  const favorite = f.favorites.snapshot.document.favorites[0].target; let opened: boolean | undefined; await act(async () => { opened = await f.navigation.open(favorite, { resolve: async value => value }); }); expect(opened).toBe(true); expect(store.getState().settings.tabs.find(tab => tab.id === 'query')).toBe(query); expect(query.sql).toBe('SELECT 原查询'); assertSettingsOnly(4);
});
it('SQLite名称返回但lineage变化时保持已知歧义，不能把根页或同名恢复当成永久身份', async () => {
  const f = await mount(); f.favorites.snapshot.document.favorites = [{ id: 'owned', groupId: null, label: '业务表', target: { connectionId: target.connectionId, database: 'main', kind: 'table', name: target.table } }];
  await act(async () => f.open()); await act(async () => view().onApplied!(result(), 7)); await act(async () => view().onClose()); const moved = { ...target, table: '新表"🚢' };
  await act(async () => f.open(moved)); await act(async () => view().onApplied!({ ...result(moved), newName: target.table, navigationIdentity: 'b'.repeat(64) }, 7));
  expect(f.navigation.completeTableRename.mock.results.map(item => item.value)).toEqual([true, false]); expect(store.getState().notice).toEqual({ text: tableRenameZh.ambiguousLink, error: true }); const favorite = f.favorites.snapshot.document.favorites[0].target;
  await expect(f.navigation.open(favorite, { resolve: async value => value })).rejects.toThrow('旧对象链接'); assertSettingsOnly(4);
});
