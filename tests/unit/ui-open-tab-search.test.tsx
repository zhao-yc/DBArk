import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { OpenTabSearchRegistry } from '../../src/renderer/openTabSearch';
import { openTabSearchZh as text } from '../../src/renderer/locales/openTabSearch.zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import type { WorkspaceTab } from '../../src/renderer/store';
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/OpenTabSearchDialog')['OpenTabSearchDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
let registry: OpenTabSearchRegistry, unsubscribe: (() => void) | undefined;
const bridge = vi.fn(), globals = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; (window as any).CompositionEvent = MemoryEvent; Object.defineProperty(globalThis, 'HTMLElement', { value: MemoryNode, configurable: true });
  const create = document.createElement.bind(document); document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text'; node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ OpenTabSearchDialog: Dialog } = await import('../../src/renderer/components/OpenTabSearchDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
/** 合成标签只提供元数据，正文getter一旦被查找逻辑读取就立即失败。 */
function tabs(): WorkspaceTab[] {
  const values: WorkspaceTab[] = [
    { id: 'one', kind: 'query', title: '订单查询', connectionId: 'c', databaseContext: { state: 'known', database: 'shop' } },
    { id: 'two', kind: 'table', title: '客户表', connectionId: 'c', database: 'shop', table: 'customers' },
    { id: 'three', kind: 'query', title: '离线分析', connectionId: 'missing', databaseContext: { state: 'known', database: null }, fileSourceBinding: { id: 'file-source', revision: 1 } },
    { id: 'four', kind: 'query', title: '未知上下文', connectionId: 'c', databaseContext: { state: 'unknown' } },
  ];
  for (const tab of values) if (tab.kind === 'query') Object.defineProperty(tab, 'sql', { enumerable: true, configurable: true, get() { throw Error('标签查找不允许读取SQL'); } });
  return values;
}
beforeEach(() => {
  bridge.mockReset(); (window as any).dbark = { invoke: bridge }; store.setState({ settings: { ...store.getState().settings, tabs: tabs(), activeTabId: 'two' }, connections: [{ id: 'c', name: '开发连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' }], dirtyTabs: { one: true }, queryFileDirty: {}, activeJobs: {}, notice: undefined });
  registry = new OpenTabSearchRegistry(); registry.observe(store.getState().settings.tabs); unsubscribe = store.subscribe(state => registry.observe(state.settings.tabs));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } unsubscribe?.(); registry.dispose(); document.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
async function mount(strict = false) {
  const activate = vi.fn<(_: import('../../src/renderer/openTabSearch').OpenTabSearchEntry) => boolean | void>(() => true), close = vi.fn(), host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const view = <Dialog registry={registry} onActivate={activate} onClose={close}/>; await act(async () => root!.render(strict ? <React.StrictMode>{view}</React.StrictMode> : view)); return { activate, close };
}
function input() { return document.querySelector(`input[aria-label="${text.searchLabel}"]`)!; }
function options() { return document.querySelectorAll('[role="option"]'); }
function chosen() { return options().find(node => node.getAttribute('aria-selected') === 'true')!; }
function option(title: string) { const node = options().find(node => node.querySelector('strong')?.textContent === title); expect(node, title).toBeDefined(); return node!; }
function callback(node: MemoryNode, key = 'onClick'): any { const name = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!name) throw Error('缺少真实React事件'); return (node as any)[name][key]; }
async function click(node: MemoryNode) { expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function search(value: string) { await act(async () => { input().value = value; input().dispatchEvent(new MemoryEvent('input')); }); }
async function key(key: string, fields: Record<string, unknown> = {}) { const event = Object.assign(new MemoryEvent('keydown'), { key }, fields); await act(async () => { input().dispatchEvent(event); }); return event; }
function setTabs(next: WorkspaceTab[]) { store.setState({ settings: { ...store.getState().settings, tabs: next } }); }

it('默认按标签栏顺序显示准确上下文/未保存/当前标记，自动聚焦且不读取SQL或进行IO', async () => {
  const original = store.getState(), f = await mount(); expect(options().map(node => node.querySelector('strong')!.textContent)).toEqual(['订单查询', '客户表', '离线分析', '未知上下文']); expect(document.activeElement).toBe(input()); expect(chosen()).toBe(option('客户表')); expect(input().getAttribute('aria-activedescendant')).toBe(chosen().getAttribute('id'));
  const entries = registry.snapshot(original.settings.tabs, original.connections); for (const entry of entries) expect(option(entry.title).textContent).toContain(entry.databaseCaption);
  expect(option('订单查询').textContent).toContain(text.unsaved); expect(option('离线分析').textContent).toContain(text.unsaved); expect(option('客户表').textContent).toContain(text.current); expect(document.body.textContent).toContain(text.count(4, 4)); expect(store.getState().settings).toBe(original.settings); expect(f.activate).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('AND关键词搜索标题/连接/库/对象，清空恢复原顺序，无匹配和空工作区分别提示', async () => {
  const original = store.getState().settings; await mount(); await search('开发连接 shop customers'); expect(options()).toHaveLength(1); expect(chosen()).toBe(option('客户表')); expect(document.body.textContent).toContain(text.count(1, 4));
  await search('不存在的SQL正文'); expect(options()).toHaveLength(0); expect(document.body.textContent).toContain(text.noMatches); await search(''); expect(options()).toHaveLength(4); expect(store.getState().settings).toBe(original); expect(bridge).not.toHaveBeenCalled();
  await act(async () => setTabs([])); expect(document.body.textContent).toContain(text.empty); expect(options()).toHaveLength(0); await key('Enter'); expect(bridge).not.toHaveBeenCalled();
});
it('运行中和dirty不阻止切换，文件绑定仅准确clean回执去标记，已删连接仍可查看原标签', async () => {
  const f = await mount(); await act(async () => store.setState({ activeJobs: { three: true }, dirtyTabs: { one: true, two: true }, queryFileDirty: { three: false } })); const original = store.getState();
  expect(option('客户表').textContent).toContain(text.unsaved); expect(option('离线分析').textContent).not.toContain(text.unsaved); await click(option('离线分析')); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].connectionId).toBe('missing'); expect(store.getState().activeJobs).toBe(original.activeJobs); expect(store.getState().dirtyTabs).toBe(original.dirtyTabs); expect(store.getState().settings).toBe(original.settings); expect(bridge).not.toHaveBeenCalled();
});
it.each(['constructor', '__proto__'])('原型同名ID %s只接受自有dirty旗标，不误报未保存', async id => {
  setTabs([{ id, kind: 'query', title: '原型名称', connectionId: 'c' }]); await mount(); expect(option('原型名称').textContent).not.toContain(text.unsaved);
  await act(async () => store.setState({ dirtyTabs: { [id]: true } })); expect(option('原型名称').textContent).toContain(text.unsaved);
});
it('真实键盘链支持上下首尾和Enter，选项aria与输入activedescendant同步且只激活一次', async () => {
  const f = await mount(); await key('ArrowDown'); expect(chosen()).toBe(option('离线分析')); await key('ArrowUp'); expect(chosen()).toBe(option('客户表')); await key('Home'); expect(chosen()).toBe(option('订单查询')); await key('End'); expect(chosen()).toBe(option('未知上下文')); expect(input().getAttribute('aria-activedescendant')).toBe(chosen().getAttribute('id'));
  await key('Enter'); await key('Enter'); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].id).toBe('four'); expect(f.close).not.toHaveBeenCalled(); expect(bridge).not.toHaveBeenCalled();
});
it('输入法组合/229、修饰键、重复Enter、disabled与已阻止事件均不能激活或穿透', async () => {
  const f = await mount(); await key('Enter', { isComposing: true }); await key('Enter', { keyCode: 229 }); for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) await key('Enter', { [modifier]: true });
  const repeated = await key('Enter', { repeat: true }); expect(repeated.defaultPrevented).toBe(true); await key('Enter', { defaultPrevented: true }); input().disabled = true; await key('Enter'); input().disabled = false; expect(f.activate).not.toHaveBeenCalled(); await key('Enter'); expect(f.activate).toHaveBeenCalledOnce();
});
it('鼠标双击同步只交付一个明确原目标，取消后旧选项不再激活', async () => {
  const f = await mount(), old = callback(option('订单查询')); await act(async () => { old(); old(); }); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].id).toBe('one'); expect(f.close).not.toHaveBeenCalled();
});
it('Escape/取消只关闭一次，旧选项和卸载后回调不再激活', async () => {
  const f = await mount(), old = callback(option('订单查询')); await key('Escape'); await key('Escape'); await act(async () => old()); expect(f.close).toHaveBeenCalledOnce(); expect(f.activate).not.toHaveBeenCalled(); await act(async () => root!.unmount()); root = undefined; await act(async () => old()); expect(f.activate).not.toHaveBeenCalled();
});
it('真实compositionstart后缺少native组合标记的document Escape不关闭，compositionend后只关一次', async () => {
  const f = await mount(); await act(async () => { input().dispatchEvent(new MemoryEvent('compositionstart')); });
  await key('Escape'); await key('Escape', { isComposing: true }); await key('Escape', { keyCode: 229 }); expect(f.close).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled();
  await act(async () => { input().dispatchEvent(new MemoryEvent('compositionend')); }); await key('Escape'); await key('Escape'); expect(f.close).toHaveBeenCalledOnce(); expect(f.activate).not.toHaveBeenCalled();
});
it.each(['remove', 'target'] as const)('%s ABA即使同轮回到同名原对象，旧DOM不能激活后继令牌', async change => {
  const f = await mount(), old = callback(option('客户表')), original = store.getState().settings.tabs;
  await act(async () => { setTabs(change === 'remove' ? original.filter(tab => tab.id !== 'two') : original.map(tab => tab.id === 'two' ? { ...tab, connectionId: 'other' } : tab)); setTabs(original); old(); }); expect(f.activate).not.toHaveBeenCalled();
  await click(option('客户表')); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].id).toBe('two');
});
it.each(['remove', 'target-aba'] as const)('选中的目标%s后fresh DOM Enter不自动激活邻项或同名后继，明确移动才重选', async change => {
  const f = await mount(), original = store.getState().settings.tabs; expect(chosen()).toBe(option('客户表'));
  await act(async () => { if (change === 'remove') setTabs(original.filter(tab => tab.id !== 'two')); else { setTabs(original.map(tab => tab.id === 'two' ? { ...tab, connectionId: 'other' } : tab)); setTabs(original); } });
  expect(options().every(node => node.getAttribute('aria-selected') === 'false')).toBe(true); expect(input().getAttribute('aria-activedescendant')).toBeNull(); expect(document.body.textContent).toContain(text.stale); await key('Enter'); expect(f.activate).not.toHaveBeenCalled();
  await key('ArrowDown'); expect(chosen()).toBe(option('订单查询')); await key('Enter'); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].id).toBe('one');
});
it('普通SQL变化保持同一文档令牌，旧可见元数据仍准确时可以激活且不读取新SQL', async () => {
  const f = await mount(), old = callback(option('订单查询')), original = store.getState().settings.tabs, token = registry.snapshot(original, store.getState().connections).find(entry => entry.id === 'one')!.token;
  await act(async () => { setTabs(original.map(tab => tab.id === 'one' ? { id: tab.id, kind: tab.kind, connectionId: tab.connectionId, title: tab.title, databaseContext: tab.databaseContext, sql: '仅原编辑器可见的新正文' } : tab)); old(); }); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].token).toBe(token); expect(document.body.textContent).not.toContain('仅原编辑器可见的新正文');
});
it('标题变化拒绝旧可见回调，Root最终拒绝也保留弹窗并可明确重选', async () => {
  const f = await mount(), old = callback(option('客户表')), original = store.getState().settings.tabs; await act(async () => { setTabs(original.map(tab => tab.id === 'two' ? { ...tab, title: '客户新标题' } : tab)); old(); }); expect(f.activate).not.toHaveBeenCalled();
  f.activate.mockReturnValueOnce(false); await click(option('客户新标题')); expect(document.body.textContent).toContain(text.stale); expect(f.close).not.toHaveBeenCalled(); await click(option('订单查询')); expect(f.activate).toHaveBeenCalledTimes(2); expect(f.activate.mock.calls[1][0].id).toBe('one');
});
it('隐藏或其它dialog/alertdialog在顶层时不能点击或关闭，恢复后仅当前列表有效', async () => {
  const f = await mount(), old = callback(option('订单查询')), host = document.body.querySelectorAll('div').find(node => node.classList.contains('open-tab-search'))!;
  host.hidden = true; await act(async () => old()); await key('Escape'); expect(f.activate).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); host.hidden = false;
  for (const role of ['dialog', 'alertdialog']) { const overlay = document.createElement('div'); overlay.setAttribute('role', role); document.body.appendChild(overlay); await act(async () => old()); await key('Escape'); expect(f.activate).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); document.body.removeChild(overlay); }
  await click(option('订单查询')); expect(f.activate).toHaveBeenCalledOnce();
});
it('StrictMode重新建立仍能搜索激活，搜索变化后的旧DOM不能借新列表选择目标', async () => {
  const f = await mount(true), old = callback(option('订单查询')); await search('customers'); await act(async () => old()); expect(f.activate).not.toHaveBeenCalled(); await key('Enter'); expect(f.activate).toHaveBeenCalledOnce(); expect(f.activate.mock.calls[0][0].id).toBe('two'); expect(bridge).not.toHaveBeenCalled();
});
