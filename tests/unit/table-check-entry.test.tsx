import React, { act, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { tableCheckMessages, type TableCheckTarget } from '../../src/shared/tableChecks';
import { assertTableChecksTargetAvailable, tableChecksServices } from '../../src/renderer/tableChecksServices';
import { tableChecksZh as text } from '../../src/renderer/locales/tableChecks.zh-CN';
import { errorMessage } from '../../src/renderer/lib';
import { memoryDocument, MemoryNode } from '../fixtures/memory-dom';
type DialogProps = ComponentProps<typeof import('../../src/renderer/components/TableCheckConstraintsDialog')['TableCheckConstraintsDialog']>;
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, store: typeof import('../../src/renderer/store')['useWorkspace'];
const views: DialogProps[] = [], bridge = vi.fn(), target: TableCheckTarget = { connectionId: 'c', database: 'db', table: 'subject' };
const globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let originalOpen: ReturnType<typeof import('../../src/renderer/store')['useWorkspace']['getState']>['openTab']; let openTab: Mock<typeof originalOpen>;
beforeAll(async () => { document = memoryDocument(); Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true }); ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store } = await import('../../src/renderer/store')); originalOpen = store.getState().openTab; });
beforeEach(() => {
  views.length = 0; bridge.mockReset(); (window as any).dbark = { invoke: bridge }; openTab = vi.fn(originalOpen);
  store.setState({ openTab: openTab as typeof originalOpen, settings: { ...store.getState().settings, activeTabId: 'q', tabs: [
    { id: 'q', kind: 'query', title: '原查询', connectionId: 'c', sql: '原SQL保持不动', fileSourceBinding: { id: 'file-one', revision: 1 } },
    { id: 'hidden', kind: 'table', title: '隐藏同表', ...target },
    { id: 'other', kind: 'table', title: '同名异库', ...target, database: 'other' },
  ] }, connections: [{ id: 'c', name: '合成连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' }, { id: 'd', name: '后继合成连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' }], connectionVersions: { c: 1, d: 5 }, activeJobs: {}, dirtyTabs: {}, queryFileDirty: { q: false }, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } store.setState({ openTab: originalOpen }); document.body.textContent = ''; views.length = 0; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 仅提取CHECK真实App节点；Dialog是明确的外界端口，不声称覆盖完整组件或实际DDL。 */
function entry() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App') as ts.FunctionDeclaration;
  const declarations: string[] = [], methods: string[] = []; let dirty = '', modal = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some(item => ['state', '[tableChecksDialog, setTableChecksDialog]', 'tableChecksRef', '[checksEdits, setChecksEdits]'].includes(item.name.getText(file)) || ts.isObjectBindingPattern(item.name) && item.initializer?.getText(file) === 'state' && item.name.elements.some(element => element.name.getText(file) === 'settings'))) declarations.push(node.getText(file));
      if (node.declarationList.declarations.some(item => item.name.getText(file) === 'hasDirty')) dirty = node.getText(file);
    }
    if (ts.isFunctionDeclaration(node) && ['openTableChecks', 'closeTableChecks', 'finishTableChecks'].includes(node.name?.text ?? '')) methods.push(node.getText(file));
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'tableChecksDialog' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(file) === 'TableCheckConstraintsDialog') modal = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(app); expect(declarations).toHaveLength(5); expect(methods).toHaveLength(3); expect(dirty.includes('checksEdits')).toBe(true); expect(modal).not.toBe('');
  // 其它功能的修改标志是外界false端口；checksEdits、workspace flags和完整hasDirty表达式均保留正式源码。
  const otherFlags = Object.fromEntries(['databaseDropEdits', 'copyDataEdits', 'tableCreateEdits', 'copyStructureEdits', 'databaseCreateEdits', 'dropEdits', 'truncateEdits', 'counterEdits', 'renameEdits', 'encodingEdits', 'databaseEncodingEdits', 'commentEdits', 'columnEdits', 'indexEdits', 'foreignKeyEdits'].map(key => [key, false]));
  let sequence = 0, open!: (value: TableCheckTarget) => void; const invalidate = vi.fn(), mark = vi.fn(), uid = vi.fn(() => `owner-${++sequence}`);
  function DialogPort(props: DialogProps) { views.push(props); return <section role="dialog" aria-label={text.title}/>; }
  const context = createContext({ exports: {}, ...otherFlags, document, useState, useRef, useWorkspace: store, assertTableChecksTargetAvailable, tableChecksServices, tableCheckMessages, errorMessage, structuredClone, uid, TableCheckConstraintsDialog: DialogPort, workbenchNavigation: { invalidate }, markStructureTarget: mark, captureOpen: (value: typeof open) => { open = value; }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${methods.join('\n')}\n${dirty}\ncaptureOpen(openTableChecks);return <><output data-check-has-dirty={hasDirty?'true':'false'}/>{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return { Entry: (context as any).Entry as React.ComponentType, open: (value = target) => open(value), invalidate, mark, uid };
}
async function mount() { const f = entry(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<f.Entry/>)); return f; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function hasDirty() { return document.querySelector('[data-check-has-dirty]')!.getAttribute('data-check-has-dirty') === 'true'; }

it('准确捕获target与配置版本，同轮连点仅一个owner，入口不invoke/openTab/改SQL', async () => {
  const original = store.getState(), f = await mount(), candidate = { ...target }; await act(async () => { f.open(candidate); candidate.table = '后来修改'; f.open({ ...target, table: '其它表' }); });
  expect(f.uid).toHaveBeenCalledOnce(); expect(f.invalidate).toHaveBeenCalledOnce(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(view().target).toEqual(target); expect(view().target).not.toBe(candidate); expect(view().services).toBe(tableChecksServices); expect(hasDirty()).toBe(false); expect(store.getState().settings).toBe(original.settings); expect(store.getState().settings.tabs[0].sql).toBe('原SQL保持不动'); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('任何dialog或alertdialog占用都拒绝领取新owner', async () => {
  const f = await mount(); for (const role of ['dialog', 'alertdialog']) { const other = document.createElement('div'); other.setAttribute('role', role); document.body.appendChild(other); await act(async () => f.open()); expect(f.uid).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); document.body.removeChild(other); } expect(views).toHaveLength(0); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('同目标隐藏表的dirty/activeJobs保护入口与实际beforeApply，其它目标及查询不误阻', async () => {
  const f = await mount(); await act(async () => { store.setState({ dirtyTabs: { hidden: true } }); f.open(); }); expect(views).toHaveLength(0); expect(store.getState().notice?.text).toContain('草稿');
  await act(async () => { store.setState({ dirtyTabs: {}, activeJobs: { hidden: true } }); f.open(); }); expect(views).toHaveLength(0); expect(store.getState().notice?.text).toContain('活动操作');
  await act(async () => { store.setState({ dirtyTabs: { other: true, q: true }, activeJobs: { other: true, q: true } }); f.open(); }); expect(f.uid).toHaveBeenCalledOnce(); const current = view(); expect(typeof current.beforeApply).toBe('function'); expect(() => current.beforeApply!()).not.toThrow();
  await act(async () => store.setState({ dirtyTabs: { hidden: true }, activeJobs: {} })); expect(() => current.beforeApply!()).toThrow('草稿'); await act(async () => store.setState({ dirtyTabs: {}, activeJobs: { hidden: true } })); expect(() => current.beforeApply!()).toThrow('活动操作'); expect(f.mark).not.toHaveBeenCalled(); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('旧owner关闭和迟到dirty(false/true)不能清除或污染后来owner', async () => {
  const f = await mount(); await act(async () => f.open()); const old = view(); expect(typeof old.onDirtyChange).toBe('function'); await act(async () => old.onDirtyChange!(true)); expect(hasDirty()).toBe(true); await act(async () => old.onClose()); expect(hasDirty()).toBe(false);
  await act(async () => f.open({ ...target, database: 'other' })); const current = view(); await act(async () => current.onDirtyChange!(true)); await act(async () => { old.onDirtyChange!(false); old.onClose(); old.onDirtyChange!(true); }); expect(view().target).toBe(current.target); expect(hasDirty()).toBe(true); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(f.invalidate).toHaveBeenCalledTimes(3);
  await act(async () => current.onClose()); await act(async () => old.onDirtyChange!(true)); expect(hasDirty()).toBe(false); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('finish只路由原target，完整verified且当前owner/version新鲜才自动刷新，其余仅标旧', async () => {
  const original = store.getState(), f = await mount(); await act(async () => f.open()); const old = view(); await act(async () => old.onApplied(true)); expect(f.mark).toHaveBeenLastCalledWith(target, true);
  await act(async () => { store.setState({ connectionVersions: { c: 2, d: 5 } }); old.onApplied(true); }); expect(f.mark).toHaveBeenLastCalledWith(target, false); expect(store.getState().notice?.text).toBe(tableCheckMessages.refresh);
  await act(async () => old.onClose()); const next = { ...target, connectionId: 'd', database: '后继库' }; await act(async () => f.open(next)); const current = view(); await act(async () => old.onApplied(true)); expect(f.mark).toHaveBeenLastCalledWith(target, false); await act(async () => current.onApplied(false)); expect(f.mark).toHaveBeenLastCalledWith(next, false); await act(async () => current.onApplied(true)); expect(f.mark).toHaveBeenLastCalledWith(next, true);
  expect(store.getState().settings).toBe(original.settings); expect(store.getState().settings.tabs).toBe(original.settings.tabs); expect(store.getState().settings.activeTabId).toBe('q'); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('checksEdits进入正式hasDirty表达式，onClose只清自身，保留workspace原文件dirty', async () => {
  const f = await mount(); expect(hasDirty()).toBe(false); await act(async () => f.open()); const current = view(); await act(async () => current.onDirtyChange!(true)); expect(hasDirty()).toBe(true); await act(async () => current.onDirtyChange!(false)); expect(hasDirty()).toBe(false);
  await act(async () => { current.onDirtyChange!(true); store.setState({ queryFileDirty: { q: true } }); }); expect(hasDirty()).toBe(true); await act(async () => current.onClose()); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(hasDirty()).toBe(true); await act(async () => store.setState({ queryFileDirty: { q: false } })); expect(hasDirty()).toBe(false);
  await act(async () => { current.onDirtyChange!(false); current.onDirtyChange!(true); }); expect(hasDirty()).toBe(false); expect(openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
