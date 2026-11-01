import React, { act, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
import { assertSqliteColumnsTargetAvailable } from '../../src/renderer/sqliteColumnsAvailability';
import { sqliteColumnsZh as text } from '../../src/renderer/locales/sqliteColumns.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import type { SqliteColumnsOutcome, SqliteColumnsTarget } from '../../src/shared/sqliteColumns';

type DialogProps = ComponentProps<typeof import('../../src/renderer/components/SqliteColumnsDialog')['SqliteColumnsDialog']>;
const target: SqliteColumnsTarget = { connectionId: 'sqlite-original', database: 'main', table: '原表"🚢' }, views: DialogProps[] = [], bridge = vi.fn();
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let store: typeof import('../../src/renderer/store')['useWorkspace'], baseline: ReturnType<typeof store.getState>;
beforeAll(async () => { document = memoryDocument(); Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store } = await import('../../src/renderer/store')); baseline = store.getState(); });
beforeEach(() => {
  views.length = 0; bridge.mockReset(); (window as any).dbark = { invoke: bridge };
  store.setState({ settings: { ...baseline.settings, tabs: [{ id: 'query', kind: 'query', title: '不被替换', connectionId: 'other', database: 'another', sql: 'SELECT 原查询' }, { id: 'hidden', kind: 'table', title: target.table, ...target }], activeTabId: 'query' }, connections: [{ id: target.connectionId, name: '准确文件', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: 'D:/synthetic/columns.sqlite', readOnly: false, busyTimeoutMs: 0 } }], connectionVersions: { [target.connectionId]: 7 }, dirtyTabs: {}, activeJobs: {}, queryFileDirty: {}, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; store.setState(baseline, true); delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 执行正式App的hook、入口、回调和dirty表达式；Dialog仅是明确外界端口，不声称执行真实DDL。 */
function fixture() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceApp')!;
  const declarations: string[] = [], methods: string[] = []; let dirty = '', modal = '', synchronise = '';
  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some(item => ['state', '[sqliteColumnOwner, setSqliteColumnOwner]', 'sqliteColumnOwnerRef'].includes(item.name.getText(tree)) || ts.isObjectBindingPattern(item.name) && item.initializer?.getText(tree) === 'state' && item.name.elements.some(element => element.name.getText(tree) === 'settings'))) declarations.push(node.getText(tree));
      if (node.declarationList.declarations.some(item => item.name.getText(tree) === 'hasDirty')) dirty = node.getText(tree);
    }
    if (node.parent === (app as ts.FunctionDeclaration).body && ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(tree) === 'sqliteColumnOwnerRef.current') synchronise = node.getText(tree);
    if (ts.isFunctionDeclaration(node) && ['openColumnPatches', 'refreshSqliteColumnsTarget'].includes(node.name?.text ?? '')) methods.push(node.getText(tree));
    if (ts.isBinaryExpression(node) && node.left.getText(tree) === 'sqliteColumnOwner' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(tree) === 'SqliteColumnsDialog') modal = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(app); expect(declarations).toHaveLength(4); expect(methods).toHaveLength(2); expect(synchronise).not.toBe(''); expect(modal).not.toBe(''); expect(dirty).toContain('sqliteColumnEdits');
  const flags = Object.fromEntries(['importNewTable', 'importNewTableEdits', 'databaseDropEdits', 'copyDataEdits', 'tableCreateEdits', 'copyStructureEdits', 'databaseCreateEdits', 'dropEdits', 'truncateEdits', 'counterEdits', 'renameEdits', 'encodingEdits', 'databaseEncodingEdits', 'checksEdits', 'commentEdits', 'columnEdits', 'indexEdits', 'sqliteMaintenanceEdits', 'sqliteRenameEdits', 'sqliteIndexEdits', 'foreignKeyEdits'].map(key => [key, false]));
  const refresh = vi.fn(), mark = vi.fn(), networkGuard = vi.fn(), sqliteIndexOwnerRef: { current: unknown } = { current: null }; let open!: (value: SqliteColumnsTarget) => void;
  function DialogPort(props: DialogProps) { views.push(props); return <section role="dialog" aria-label={text.title}/>; }
  const vm = createContext({ ...flags, sqliteMaintenanceOwnerRef: { current: null }, sqliteRenameOwnerRef: { current: null }, exports: {}, document, useRef, useState, useWorkspace: store, sqliteIndexOwnerRef, structuredClone, assertSqliteColumnsTargetAvailable, sqliteColumnsZh: text, errorMessage, SqliteColumnsDialog: DialogPort, refreshRenameDatabase: refresh, markStructureTarget: mark, assertColumnTargetAvailable: networkGuard, setColumnEdits: vi.fn(), setColumnTarget: vi.fn(), captureOpen: (value: typeof open) => { open = value; }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止加载其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${synchronise}\n${methods.join('\n')}\n${dirty}\ncaptureOpen(openColumnPatches);return <><output data-columns-dirty={hasDirty?'true':'false'}/>{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, vm);
  return { Entry: (vm as any).Entry as React.ComponentType, open: (value = target) => open(value), refresh, mark, networkGuard, sqliteIndexOwnerRef };
}
async function mount() { const f = fixture(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<f.Entry/>)); return f; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function dirty() { return document.querySelector('[data-columns-dirty]')!.getAttribute('data-columns-dirty') === 'true'; }
/** 合成ACK仅供正式父页回调路由；不将本函数称为数据库提交证据。 */
function result(receivedTarget = target, verified = true): SqliteColumnsOutcome { return { operationId: 'protocol-only', target: receivedTarget, outcome: 'committed', definitionVerified: verified, fact: { operationId: 'protocol-only', target: receivedTarget, phase: 'committed', requestedStatements: 1, completedStatements: 1, commitMayHaveBeenSent: true, commitAcknowledged: true, rollbackAcknowledged: false }, message: '协议提交确认' }; }

it('正式字段入口捕获不可变目标与版本，同轮重复调用不改目标、不连库、不替换原查询', async () => {
  const f = await mount(), previous = store.getState().settings, candidate = { ...target };
  await act(async () => { f.open(candidate); candidate.table = '调用者后来修改'; f.open({ ...target, table: '第二次请求' }); });
  expect(view().target).toEqual(target); expect(view().target).not.toBe(candidate); expect(view().targetVersion).toBe(7); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(store.getState().settings).toBe(previous); expect(bridge).not.toHaveBeenCalled(); expect(f.networkGuard).not.toHaveBeenCalled();
});
it('任何模态或同轮待展示索引窗口占用时，不领取字段owner', async () => {
  const f = await mount(); for (const role of ['dialog', 'alertdialog']) { const blocker = document.createElement('div'); blocker.setAttribute('role', role); document.body.appendChild(blocker); await act(async () => f.open()); expect(views).toEqual([]); document.body.removeChild(blocker); }
  f.sqliteIndexOwnerRef.current = {}; await act(async () => f.open()); expect(views).toEqual([]); expect(bridge).not.toHaveBeenCalled();
});
it.each(['dirty', 'busy'] as const)('隐藏同表%s保护真实入口，其他数据库的查询状态不替代目标', async kind => {
  const f = await mount(); await act(async () => { store.setState(kind === 'dirty' ? { dirtyTabs: { hidden: true } } : { activeJobs: { hidden: true } }); f.open(); }); expect(views).toEqual([]); expect(store.getState().notice?.error).toBe(true);
  await act(async () => { store.setState({ dirtyTabs: { query: true }, activeJobs: { query: true } }); f.open(); }); expect(view().target).toEqual(target); expect(store.getState().settings.activeTabId).toBe('query'); expect(bridge).not.toHaveBeenCalled();
});
it('旧关闭和迟到dirty不能污染后来owner，源查询草稿标志保持', async () => {
  const f = await mount(); await act(async () => f.open()); const old = view(); await act(async () => old.onDirtyChange!(true)); expect(dirty()).toBe(true); await act(async () => old.onClose());
  await act(async () => f.open()); const current = view(); await act(async () => { current.onDirtyChange!(true); old.onClose(); old.onDirtyChange!(false); }); expect(view().target).toBe(current.target); expect(dirty()).toBe(true);
  await act(async () => { store.setState({ dirtyTabs: { query: true } }); current.onClose(); old.onDirtyChange!(true); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(dirty()).toBe(true); expect(store.getState().dirtyTabs.query).toBe(true); expect(bridge).not.toHaveBeenCalled();
});
it('提交与未知回调只刷新原目标；错误目标、旧owner和连接版本不会自动刷新', async () => {
  const f = await mount(); await act(async () => f.open()); const original = view(); await act(async () => original.onApplied!(result(), 7)); expect(f.mark).toHaveBeenLastCalledWith(target, true); expect(f.refresh).toHaveBeenLastCalledWith(target);
  await act(async () => original.onExecutionUncertain!()); expect(f.mark).toHaveBeenLastCalledWith(target, false);
  const calls = f.mark.mock.calls.length; await act(async () => original.onApplied!(result({ ...target, table: '另一张表' }), 7)); expect(f.mark).toHaveBeenCalledTimes(calls);
  await act(async () => { store.setState({ connectionVersions: { [target.connectionId]: 8 } }); original.onApplied!(result(), 7); }); expect(f.mark).toHaveBeenCalledTimes(calls); expect(store.getState().notice?.error).toBe(true);
  await act(async () => original.onClose()); await act(async () => f.open()); const current = view(); await act(async () => { original.onApplied!(result(), 7); original.onExecutionUncertain!(); current.onApplied!(result(target, false), 8); }); expect(f.mark).toHaveBeenLastCalledWith(target, false); expect(f.mark).toHaveBeenCalledTimes(calls + 1); expect(bridge).not.toHaveBeenCalled();
});
