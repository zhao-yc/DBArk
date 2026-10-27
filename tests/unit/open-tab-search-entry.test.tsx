import React, { act, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../src/shared/contracts';
import { OpenTabSearchRegistry } from '../../src/renderer/openTabSearch';
import { openTabSearchZh as text } from '../../src/renderer/locales/openTabSearch.zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/OpenTabSearchDialog')['OpenTabSearchDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
type DialogProps = ComponentProps<typeof import('../../src/renderer/components/OpenTabSearchDialog')['OpenTabSearchDialog']>;
const views: DialogProps[] = [], bridge = vi.fn(), globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
/** 只提供window监听与投递端口；不模拟操作系统快捷键、布局或原生焦点。 */
class ActorWindow {
  readonly listeners = new Set<(event: MemoryEvent) => void>();
  addEventListener(type: string, listener: (event: MemoryEvent) => void) { expect(type).toBe('keydown'); this.listeners.add(listener); }
  removeEventListener(type: string, listener: (event: MemoryEvent) => void) { expect(type).toBe('keydown'); this.listeners.delete(listener); }
  dispatchEvent(event: MemoryEvent) { for (const listener of [...this.listeners]) listener(event); return !event.defaultPrevented; }
}
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document); document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text'; node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ OpenTabSearchDialog: Dialog } = await import('../../src/renderer/components/OpenTabSearchDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
beforeEach(() => {
  bridge.mockReset(); views.length = 0; (window as any).dbark = { invoke: bridge };
  store.setState({ settings: { ...store.getState().settings, activeTabId: 'one', tabs: [
    { id: 'one', kind: 'query', title: '同名标签', connectionId: 'c', databaseContext: { state: 'known', database: '甲库' }, sql: '原SQL，不得执行或改写', sourceBinding: { id: 'saved-one', digest: 'a'.repeat(64), context: { state: 'known', database: '甲库' } }, fileSourceBinding: { id: 'file-one', revision: 3 } },
    { id: 'two', kind: 'query', title: '同名标签', connectionId: 'd', databaseContext: { state: 'known', database: '乙库' }, sql: '第二份原SQL' },
  ] }, connections: [{ id: 'c', name: '甲连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' }, { id: 'd', name: '乙连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' }], dirtyTabs: { two: true }, queryFileDirty: { one: false }, activeJobs: { two: true }, notice: undefined });
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; delete (window as any).dbark; views.length = 0; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 只拼接正式App的本功能节点，保留真实方法、观察effect、窗口快捷键和JSX回调。 */
function appEntry() {
  const source = readFileSync(new URL('../../src/renderer/App.tsx', import.meta.url), 'utf8'), file = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const app = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'App') as ts.FunctionDeclaration;
  expect(app?.body).toBeDefined(); const declarations: string[] = [], methods: string[] = []; let observe = '', shortcut = '', button = '', modal = '';
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ['[tabSearch, setTabSearch]', 'tabSearchRef', '[tabScrollRevision, setTabScrollRevision]'].includes(item.name.getText(file)))) declarations.push(node.getText(file));
    if (ts.isFunctionDeclaration(node) && ['openTabSearch', 'closeTabSearch', 'activateSearchedTab'].includes(node.name?.text ?? '')) methods.push(node.getText(file));
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useLayoutEffect' && node.arguments[0]?.getText(file).includes('tabSearch.registry.observe')) observe = node.getText(file) + ';';
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0]?.getText(file).includes("window.addEventListener('keydown', listener)") && node.arguments[0]?.getText(file).includes('openTabSearch()')) shortcut = node.getText(file) + ';';
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'button' && node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(file) === 'openTabSearchZh.entry')) button = node.getText(file);
    if (ts.isBinaryExpression(node) && node.left.getText(file) === 'tabSearch' && ts.isJsxSelfClosingElement(node.right) && node.right.tagName.getText(file) === 'OpenTabSearchDialog') modal = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(app); expect(declarations).toHaveLength(3); expect(methods).toHaveLength(3); expect([observe, shortcut, button, modal].every(Boolean)).toBe(true);
  let sequence = 0; const keyboard = new ActorWindow(), invalidate = vi.fn(), uid = vi.fn(() => `owner-${++sequence}`), openTab = vi.fn(() => { throw Error('查找入口不得创建新标签'); });
  // 持久化属于外界端口：记录正式action参数并更新真实store内存，不启动400ms磁盘持久化。
  const update = vi.fn((patch: Partial<AppSettings>) => store.setState({ settings: { ...store.getState().settings, ...patch } }));
  const workspace = { getState: () => ({ ...store.getState(), updateSettings: update, openTab }), subscribe: store.subscribe };
  function DialogPort(props: DialogProps) { views.push(props); return <Dialog {...props}/>; }
  const context = createContext({ exports: {}, useState, useRef, useEffect, useLayoutEffect, document, window: keyboard, OpenTabSearchRegistry, OpenTabSearchDialog: DialogPort, openTabSearchZh: text, useWorkspace: workspace, uid, workbenchNavigation: { invalidate }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('禁止其它App依赖'); } });
  runInContext(ts.transpileModule(`function Entry(){${declarations.join('\n')}\n${methods.join('\n')}\n${observe}\n${shortcut}\nreturn <>${button}{${modal}}</>};globalThis.Entry=Entry;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return { Entry: (context as any).Entry as React.ComponentType, keyboard, invalidate, uid, update, openTab };
}
async function mount(strict = false) { const f = appEntry(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(strict ? <React.StrictMode><f.Entry/></React.StrictMode> : <f.Entry/>)); return f; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function callback(node: MemoryNode): () => void { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React入口事件'); return (node as any)[key].onClick; }
async function click(label: string) { await act(async () => { button(label).dispatchEvent(new MemoryEvent('click')); }); }
async function shortcut(f: ReturnType<typeof appEntry>, fields: Record<string, unknown> = {}) { const event = Object.assign(new MemoryEvent('keydown'), { key: 'A', ctrlKey: true, shiftKey: true }, fields); await act(async () => { f.keyboard.dispatchEvent(event); }); return event; }
function view() { expect(views.length).toBeGreaterThan(0); return views.at(-1)!; }
function setTabs(tabs: AppSettings['tabs']) { store.setState({ settings: { ...store.getState().settings, tabs } }); }

it('真实commandbar空工作区可开空态，同轮连点只有一个owner，取消不写settings或建立连接', async () => {
  store.setState({ settings: { ...store.getState().settings, tabs: [], activeTabId: undefined }, connections: [] }); const before = store.getState(), f = await mount(), open = callback(button(text.entry)); expect(button(text.entry).disabled).toBe(false); expect(button(text.entry).getAttribute('title')).toBe(text.shortcutHint);
  await act(async () => { open(); open(); }); expect(f.uid).toHaveBeenCalledOnce(); expect(f.invalidate).toHaveBeenCalledOnce(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(document.body.textContent).toContain(text.empty); await click(text.close); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(f.invalidate).toHaveBeenCalledTimes(2); expect(store.getState().settings).toBe(before.settings); expect(f.update).not.toHaveBeenCalled(); expect(f.openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('真实window effect接受Ctrl或Meta Shift A，明确阻止默认行为，关闭后新owner独立', async () => {
  const f = await mount(); expect(f.keyboard.listeners.size).toBe(1); const control = await shortcut(f); expect(control.defaultPrevented).toBe(true); const first = view().registry; await click(text.close);
  const meta = await shortcut(f, { ctrlKey: false, metaKey: true }); expect(meta.defaultPrevented).toBe(true); expect(view().registry).not.toBe(first); expect(f.uid).toHaveBeenCalledTimes(2); await click(text.close); expect(f.update).not.toHaveBeenCalled(); expect(f.openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('dialog/alertdialog、IME/229、Alt/defaultPrevented/repeat及缺modifier都不能领取快捷键窗口', async () => {
  const f = await mount(), open = callback(button(text.entry)); for (const fields of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { defaultPrevented: true }, { repeat: true }, { shiftKey: false }, { ctrlKey: false, metaKey: false }]) await shortcut(f, fields);
  for (const role of ['dialog', 'alertdialog']) { const other = document.createElement('div'); other.setAttribute('role', role); document.body.appendChild(other); await shortcut(f); await act(async () => open()); document.body.removeChild(other); }
  expect(f.uid).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled(); expect(views).toHaveLength(0); expect(f.update).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('旧owner关闭与激活回调不能清除后来窗口或改活动标签', async () => {
  const f = await mount(); await click(text.entry); const old = view(), entry = old.registry.snapshot(store.getState().settings.tabs, store.getState().connections)[1]; await act(async () => old.onClose()); await click(text.entry); const next = view(); expect(next.registry).not.toBe(old.registry);
  let accepted: boolean | void; await act(async () => { old.onClose(); accepted = old.onActivate(entry); }); expect(accepted!).toBe(false); expect(view().registry).toBe(next.registry); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(store.getState().settings.activeTabId).toBe('one'); expect(f.invalidate).toHaveBeenCalledTimes(3); expect(f.update).not.toHaveBeenCalled(); expect(f.openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('Root最终Registry复核拒绝删除及目标ABA，即使直接投递旧entry也无同名或其它连接fallback', async () => {
  const f = await mount(); await click(text.entry); const owner = view(), original = store.getState().settings.tabs;
  for (const change of ['remove', 'target']) { const entry = owner.registry.snapshot(original, store.getState().connections)[1]; let accepted: boolean | void;
    await act(async () => { setTabs(change === 'remove' ? original.filter(tab => tab.id !== 'two') : original.map(tab => tab.id === 'two' ? { ...tab, connectionId: 'c' } : tab)); setTabs(original); accepted = owner.onActivate(entry); }); expect(accepted!).toBe(false); expect(store.getState().settings.activeTabId).toBe('one'); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  }
  expect(f.update).not.toHaveBeenCalled(); expect(f.openTab).not.toHaveBeenCalled(); expect(f.invalidate).toHaveBeenCalledOnce(); expect(bridge).not.toHaveBeenCalled();
});
it('成功仅切换准确原id，原SQL/绑定/任务草稿不变，已active再次激活不多写settings', async () => {
  const original = store.getState(), f = await mount(); await click(text.entry); const owner = view(), entry = owner.registry.snapshot(original.settings.tabs, original.connections)[1]; let accepted: boolean | void;
  await act(async () => { accepted = owner.onActivate(entry); }); expect(accepted!).toBe(true); expect(f.update.mock.calls).toEqual([[{ activeTabId: 'two' }]]); expect(store.getState().settings.tabs).toBe(original.settings.tabs); expect(store.getState().settings.tabs[0]).toBe(original.settings.tabs[0]); expect(store.getState().settings.tabs[0].sourceBinding).toBe(original.settings.tabs[0].sourceBinding); expect(store.getState().settings.tabs[0].fileSourceBinding).toBe(original.settings.tabs[0].fileSourceBinding); expect(store.getState().dirtyTabs).toBe(original.dirtyTabs); expect(store.getState().activeJobs).toBe(original.activeJobs); expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(text.entry); const current = view(), same = current.registry.snapshot(store.getState().settings.tabs, store.getState().connections)[1]; await act(async () => { accepted = current.onActivate(same); }); expect(accepted!).toBe(true); expect(f.update).toHaveBeenCalledOnce(); expect(f.openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled(); expect(f.invalidate).toHaveBeenCalledTimes(4);
});
it('StrictMode与普通SQL/标题编辑不撤销同文档token，卸载真实effect会注销window及store观察', async () => {
  const f = await mount(true); await click(text.entry); const owner = view(), original = store.getState().settings.tabs, token = owner.registry.snapshot(original, store.getState().connections)[0].token;
  await act(async () => setTabs(original.map(tab => tab.id === 'one' ? { ...tab, title: '新标题', sql: '正常编辑的SQL' } : tab))); expect(owner.registry.snapshot(store.getState().settings.tabs, store.getState().connections)[0].token).toBe(token); expect(document.body.textContent).toContain('新标题'); expect(f.keyboard.listeners.size).toBe(1);
  const observe = vi.spyOn(owner.registry, 'observe'); await act(async () => root!.unmount()); root = undefined; observe.mockClear(); expect(f.keyboard.listeners.size).toBe(0); setTabs([]); expect(observe).not.toHaveBeenCalled(); observe.mockRestore(); expect(f.update).not.toHaveBeenCalled(); expect(f.openTab).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
