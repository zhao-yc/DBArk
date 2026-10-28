import React, { act, createRef } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceTab } from '../../src/renderer/store';
import { tabOrderZh as text } from '../../src/renderer/locales/tabOrder.zh-CN';
import { queryCloseZh as closeText } from '../../src/renderer/locales/queryClose.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';

let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
let Strip: typeof import('../../src/renderer/components/WorkspaceTabStrip').WorkspaceTabStrip, store: typeof import('../../src/renderer/store').useWorkspace;
let ui: { stripRef: React.RefObject<HTMLDivElement | null>; onClose: ReturnType<typeof vi.fn>; onNew: ReturnType<typeof vi.fn>; onCloseSide?: ReturnType<typeof vi.fn> };
const bridge = vi.fn(async () => undefined), globals = ['window', 'document', 'navigator', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let windowEvents: MemoryNode;
const observers = new Set<Observer>();
/** 只提供标准MutationObserver端口，由测试投递明确记录，不模拟浏览器布局或原生拖放。 */
class Observer {
  active = false; records: MutationRecord[] = [];
  constructor(readonly callback: MutationCallback) { observers.add(this); }
  observe() { this.active = true; }
  disconnect() { this.active = false; this.records = []; }
  takeRecords() { const records = this.records; this.records = []; return records; }
}
function tabs(): WorkspaceTab[] { return [
  { id: 'a', kind: 'query', title: '查询 A', connectionId: 'c', databaseContext: { state: 'known', database: 'db' }, sql: 'SELECT 1;' },
  { id: 'b', kind: 'table', title: '数据表 B', connectionId: 'c', database: 'db', table: 'subject' },
  { id: 'c', kind: 'query', title: '查询 C', connectionId: 'deleted', databaseContext: { state: 'unknown' }, sql: 'SELECT 3;' },
]; }
beforeAll(async () => {
  doc = memoryDocument(); windowEvents = new MemoryNode('#window', 9);
  // memory-dom的window事件默认空实现，这里显式补标准监听端口，不能称为原生失焦验收。
  Object.assign(window, { addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents) });
  Object.defineProperty(globalThis, 'MutationObserver', { value: Observer, configurable: true });
  const create = doc.createElement.bind(doc); doc.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ useWorkspace: store } = await import('../../src/renderer/store')); ({ WorkspaceTabStrip: Strip } = await import('../../src/renderer/components/WorkspaceTabStrip'));
});
beforeEach(() => {
  bridge.mockClear(); observers.clear(); (window as any).dbark = { invoke: bridge };
  store.setState({ settings: { ...store.getState().settings, tabs: tabs(), activeTabId: 'a' }, dirtyTabs: { b: true }, queryFileDirty: {}, activeJobs: { c: true }, notice: undefined });
  ui = { stripRef: createRef<HTMLDivElement>(), onClose: vi.fn(), onNew: vi.fn() };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; windowEvents.dispatchEvent(new MemoryEvent('beforeunload')); doc.body.textContent = ''; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
async function render(blocked = false, strict = false) {
  if (!root) { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); }
  const view = <Strip {...ui} blocked={blocked}/>; await act(async () => root!.render(strict ? <React.StrictMode>{view}</React.StrictMode> : view));
  for (const node of wrappers()) node.getBoundingClientRect = () => ({ x: 100, y: 0, top: 0, bottom: 38, left: 100, right: 200, width: 100, height: 38 });
}
function wrappers() { return doc.querySelectorAll('div').filter(node => node.getAttribute('data-workspace-tab-id') !== null); }
function wrapper(id: string) { const node = wrappers().find(node => node.getAttribute('data-workspace-tab-id') === id); if (!node) throw Error('缺少标签：' + id); return node; }
function select(id: string) { return wrapper(id).querySelectorAll('button').find(node => node.classList.contains('tab-select'))!; }
function close(id: string) { return wrapper(id).querySelectorAll('button').find(node => node.classList.contains('tab-close'))!; }
function order() { return store.getState().settings.tabs.map(tab => tab.id); }
function callback(node: any, key: string): any { const prop = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!prop || typeof node[prop][key] !== 'function') throw Error('缺少真实React回调：' + key); return node[prop][key]; }
function transfer() { return { effectAllowed: 'all', dropEffect: 'none', setData: vi.fn(), getData: vi.fn(() => { throw Error('不允许从拖动内容读标签或SQL'); }) }; }
async function drag(id: string, data = transfer()) { await act(async () => select(id).dispatchEvent(Object.assign(new MemoryEvent('dragstart'), { dataTransfer: data }))); return data; }
async function drop(id: string, position: 'before' | 'after', data: ReturnType<typeof transfer>) { const fields = { dataTransfer: data, clientX: position === 'before' ? 110 : 190 }; await act(async () => wrapper(id).dispatchEvent(Object.assign(new MemoryEvent('dragover'), fields))); await act(async () => wrapper(id).dispatchEvent(Object.assign(new MemoryEvent('drop'), fields))); }
async function key(id: string, key: string, fields: Record<string, unknown> = {}) { const node = select(id); node.focus(); const event = Object.assign(new MemoryEvent('keydown'), { key, ctrlKey: true, shiftKey: true }, fields); await act(async () => node.dispatchEvent(event)); return event; }
async function click(node: MemoryNode) { await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }

it('保留旧选择器、活动标志与关闭文案，点击/关闭/新增仍交原入口，dirty运行不误禁用', async () => {
  await render(); expect(ui.stripRef.current).toBe(doc.querySelectorAll('div').find(node => node.classList.contains('tab-strip')));
  expect(wrapper('a').getAttribute('data-active-workspace-tab')).toBe('true'); expect(close('b').getAttribute('aria-label')).toBe(formatText(zh.app.text012, '数据表 B'));
  expect(wrapper('b').querySelectorAll('span').some(node => node.classList.contains('dirty-dot'))).toBe(true);
  await click(select('c')); expect(store.getState().settings.activeTabId).toBe('c'); await click(close('b')); expect(ui.onClose).toHaveBeenCalledExactlyOnceWith('b');
  await click(doc.querySelectorAll('button').find(node => node.classList.contains('add-tab'))!); expect(ui.onNew).toHaveBeenCalledTimes(1); expect(doc.body.textContent).toContain(text.hint);
});

it.each(['before', 'after'] as const)('同窗拖放到左右半区 %s，只重排最新原对象且不切active或读拖动数据', async position => {
  await render(); const original = store.getState(), nodes = new Map(wrappers().map(node => [node.getAttribute('data-workspace-tab-id'), node])); const data = await drag('c');
  await drop('a', position, data); expect(order()).toEqual(position === 'before' ? ['c', 'a', 'b'] : ['a', 'c', 'b']);
  expect(store.getState().settings.activeTabId).toBe('a'); expect(store.getState().settings.tabs.every(tab => original.settings.tabs.includes(tab))).toBe(true);
  expect(store.getState().dirtyTabs).toBe(original.dirtyTabs); expect(store.getState().activeJobs).toBe(original.activeJobs);
  expect(wrappers().every(node => nodes.get(node.getAttribute('data-workspace-tab-id')) === node)).toBe(true); expect(data.getData).not.toHaveBeenCalled(); expect(data.setData).toHaveBeenCalledExactlyOnceWith('application/x-dbark-tab-order', '');
  expect(bridge.mock.calls.every(call => (call as unknown[])[0] === 'settings.save')).toBe(true); expect(doc.body.textContent).toContain(text.placed('查询 C'));
});

it('拖动期间原SQL/标题正式更新后用最新内容投放，不以旧快照覆盖或重建文档', async () => {
  await render(); const data = await drag('c'); await act(async () => store.getState().updateTab('c', { sql: 'SELECT 9007199254740993;', title: '最新标题' }));
  const updated = store.getState().settings.tabs.find(tab => tab.id === 'c')!; await drop('a', 'before', data);
  expect(store.getState().settings.tabs[0]).toBe(updated); expect(updated.sql).toBe('SELECT 9007199254740993;'); expect(select('c').textContent).toContain('最新标题');
});

it('键盘左右及首末保持原按钮焦点和active；边界不重复保存，关闭/新增按钮不截获', async () => {
  await render(); const node = select('b'), scroll = vi.fn(); (node as any).scrollIntoView = scroll;
  await key('b', 'ArrowLeft'); expect(order()).toEqual(['b', 'a', 'c']); expect(select('b')).toBe(node); expect(doc.activeElement).toBe(node); expect(store.getState().settings.activeTabId).toBe('a');
  const count = bridge.mock.calls.length; await key('b', 'Home'); expect(bridge.mock.calls).toHaveLength(count); expect(doc.body.textContent).toContain(text.boundary);
  await key('b', 'End', { ctrlKey: false, metaKey: true }); expect(order()).toEqual(['a', 'c', 'b']); await key('b', 'ArrowLeft'); expect(order()).toEqual(['a', 'b', 'c']); expect(scroll).toHaveBeenCalled();
  const before = order(); for (const node of [close('b'), doc.querySelectorAll('button').find(node => node.classList.contains('add-tab'))!]) { node.focus(); const event = Object.assign(new MemoryEvent('keydown'), { key: 'Home', ctrlKey: true, shiftKey: true }); await act(async () => node.dispatchEvent(event)); expect(event.defaultPrevented).toBe(false); } expect(order()).toEqual(before);
});

it('IME组合、229、Alt、未聚焦和已处理事件都不重排，组合结束才可处理', async () => {
  await render(); const initial = order(); for (const fields of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { defaultPrevented: true }, { shiftKey: false }, { ctrlKey: false, metaKey: false }]) await key('b', 'Home', fields);
  const node = select('b'); await act(async () => callback(node, 'onCompositionStart')()); await key('b', 'Home'); expect(order()).toEqual(initial);
  doc.body.focus(); await act(async () => callback(node, 'onKeyDown')({ currentTarget: node, target: node, key: 'Home', ctrlKey: true, shiftKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() })); expect(order()).toEqual(initial);
  await act(async () => callback(node, 'onCompositionEnd')()); await key('b', 'Home'); expect(order()).toEqual(['b', 'a', 'c']);
});

it.each(['Escape', 'blur', 'dragend', 'external-drop'])('%s撤销本轮，外来drop无owner或迟到旧drop均无权重排', async event => {
  await render(); const data = await drag('c');
  await act(async () => { if (event === 'blur') windowEvents.dispatchEvent(new MemoryEvent('blur')); else doc.dispatchEvent(Object.assign(new MemoryEvent(event === 'Escape' ? 'keydown' : event === 'external-drop' ? 'drop' : 'dragend'), { key: 'Escape' })); });
  // 外来drop由下一个任务兜底；其余原同步取消门保持即时，不用延长产品或原生验收期限。
  if (event === 'external-drop') await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  await drop('a', 'before', data); expect(order()).toEqual(['a', 'b', 'c']); expect(observers.size > 0).toBe(true); expect([...observers].every(observer => !observer.active)).toBe(true);
});

it('真实capture监听之后先经过微任务检查点，React原onDrop仍能消费本轮且精确取消兜底任务', async () => {
  await render(); const data = await drag('c'), target = wrapper('a'), bubble = callback(target, 'onDrop');
  const captures = doc.listeners.get('drop')?.filter(listener => listener.capture) ?? []; expect(captures).toHaveLength(1);
  const event: MemoryEvent & { dataTransfer: ReturnType<typeof transfer>; clientX: number } = Object.assign(new MemoryEvent('drop'), { target: select('a'), currentTarget: doc, dataTransfer: data, clientX: 110 });
  await act(async () => {
    // memory-dom同步派发不会在两个监听器间让出JS栈，故显式重现原生回调边界。
    captures[0].fn(event); await Promise.resolve();
    event.currentTarget = target; bubble(event);
  });
  expect(order()).toEqual(['c', 'a', 'b']); expect(event.defaultPrevented).toBe(true); expect(store.getState().settings.activeTabId).toBe('a');
  expect(doc.body.textContent).toContain(text.placed('查询 C'));
  await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
  expect(order()).toEqual(['c', 'a', 'b']); expect(doc.body.textContent).not.toContain(text.cancelled); expect([...observers].every(observer => !observer.active)).toBe(true);
});

it('原owner释放精确清除捕获阶段的任务，迟到旧任务回调不能撤销后继拖动', async () => {
  await render(); await drag('a'); const capture = doc.listeners.get('drop')!.find(listener => listener.capture)!;
  const schedule = vi.spyOn(globalThis, 'setTimeout'), clear = vi.spyOn(globalThis, 'clearTimeout'), next = transfer(); let handle: unknown;
  try {
    await act(async () => {
      capture.fn(new MemoryEvent('drop'));
      const task = schedule.mock.calls.at(-1)?.[0]; handle = schedule.mock.results.at(-1)?.value;
      if (typeof task !== 'function') throw Error('原capture未安排明确的任务兜底');
      doc.dispatchEvent(new MemoryEvent('dragend'));
      select('b').dispatchEvent(Object.assign(new MemoryEvent('dragstart'), { dataTransfer: next }));
      // 模拟已排出的旧回调晚到；仍调用产品原闭包，不替换当前owner或move实现。
      task();
    });
    expect(clear).toHaveBeenCalledWith(handle); await drop('c', 'after', next); expect(order()).toEqual(['a', 'c', 'b']);
    expect([...observers].every(observer => !observer.active)).toBe(true);
  } finally { schedule.mockRestore(); clear.mockRestore(); }
});

it('blocked与dialog/alertdialog拒所有旧入口；模态添加又移除仍使拖动永久失效', async () => {
  await render(); const oldClick = callback(select('c'), 'onClick'), oldClose = callback(close('c'), 'onClick'); await render(true); await act(async () => { oldClick(); oldClose(); }); expect(store.getState().settings.activeTabId).toBe('a'); expect(ui.onClose).not.toHaveBeenCalled(); await key('b', 'Home'); expect(order()).toEqual(['a', 'b', 'c']);
  await render(); for (const role of ['dialog', 'alertdialog']) { const modal = doc.createElement('div'); modal.setAttribute('role', role); doc.body.appendChild(modal); await click(select('c')); await drag('c'); await key('b', 'Home'); doc.body.removeChild(modal); expect(order()).toEqual(['a', 'b', 'c']); }
  const data = await drag('c'), modal = doc.createElement('div'); modal.setAttribute('role', 'dialog'); doc.body.appendChild(modal); doc.body.removeChild(modal);
  for (const observer of observers) if (observer.active) observer.records.push({ addedNodes: [modal] } as unknown as MutationRecord);
  await drop('a', 'before', data); expect(order()).toEqual(['a', 'b', 'c']); expect(ui.onClose).not.toHaveBeenCalled();
});

it('同id替换/目标ABA后的旧activate/close/drag都拒；旧blur不能清后继拖动', async () => {
  await render(); const oldClick = callback(select('c'), 'onClick'), oldClose = callback(close('c'), 'onClick'), data = await drag('c'), original = store.getState().settings.tabs;
  await act(async () => { store.setState({ settings: { ...store.getState().settings, tabs: original.filter(tab => tab.id !== 'c') } }); store.setState({ settings: { ...store.getState().settings, tabs: original } }); });
  await act(async () => { oldClick(); oldClose(); }); await drop('a', 'before', data); expect(order()).toEqual(['a', 'b', 'c']); expect(store.getState().settings.activeTabId).toBe('a'); expect(ui.onClose).not.toHaveBeenCalled();
  await drag('a'); const oldBlur = windowEvents.listeners.get('blur')!.at(-1)!.fn; const fresh = await drag('b'); await act(async () => oldBlur(new MemoryEvent('blur'))); await drop('c', 'after', fresh); expect(order()).toEqual(['a', 'c', 'b']);
});

it('StrictMode重建后可移动，卸载释放全部观察；空工作区保原欢迎及新增入口', async () => {
  await render(false, true); const data = await drag('c'), old = callback(select('c'), 'onClick'); await act(async () => root!.unmount()); root = undefined;
  expect([...observers].every(observer => !observer.active)).toBe(true); await act(async () => old()); expect(store.getState().settings.activeTabId).toBe('a'); expect(data.getData).not.toHaveBeenCalled();
  await act(async () => store.setState({ settings: { ...store.getState().settings, tabs: [], activeTabId: undefined } })); await render(); expect(wrappers()).toHaveLength(0); expect(doc.body.textContent).toContain(zh.app.text013); await click(doc.querySelectorAll('button').find(node => node.classList.contains('add-tab'))!); expect(ui.onNew).toHaveBeenCalledTimes(1);
});

it('整组snapshot异常或缺ref不抛工作台、不丢原标题，全部旧交互拒绝且不按id回退', async () => {
  await render(); expect(doc.querySelectorAll('[role="status"]')).toHaveLength(0);
  const current = store.getState(), snapshot = current.tabOrderSnapshot, originalMove = current.moveTab;
  const oldClick = callback(select('c'), 'onClick'), oldClose = callback(close('c'), 'onClick'), oldKey = callback(select('c'), 'onKeyDown'), oldNode = select('c'), move = vi.fn(() => false);
  try {
    await act(async () => store.setState({ tabOrderSnapshot: () => { throw Error('整组身份损坏'); }, moveTab: move }));
    expect(wrappers().map(node => node.querySelectorAll('span')[0].textContent)).toEqual(['查询 A', '数据表 B', '查询 C']);
    expect(wrappers().every(node => node.querySelectorAll('button').every(button => button.disabled))).toBe(true);
    expect(doc.querySelector('[role="status"]')?.textContent).toBe(text.unavailable);
    oldNode.focus(); await act(async () => { oldClick(); oldClose(); oldKey({ target: oldNode, currentTarget: oldNode, key: 'Home', ctrlKey: true, shiftKey: true, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn() }); });
    expect(move).not.toHaveBeenCalled(); expect(ui.onClose).not.toHaveBeenCalled(); expect(store.getState().settings.activeTabId).toBe('a');
    await act(async () => store.setState({ tabOrderSnapshot: () => snapshot().slice(0, 2) }));
    expect(wrappers()).toHaveLength(3); expect(wrappers().every(node => node.querySelectorAll('button').every(button => button.disabled))).toBe(true);
    await click(doc.querySelectorAll('button').find(node => node.classList.contains('add-tab'))!); expect(ui.onNew).toHaveBeenCalledTimes(1); expect(move).not.toHaveBeenCalled();
  } finally { await act(async () => store.setState({ tabOrderSnapshot: snapshot, moveTab: originalMove })); }
});

/** 真实条带菜单不借当前活动标签定位，旧回调仍由原菜单owner约束。 */
function menuButton(id: string) { return wrapper(id).querySelectorAll('button').find(node => node.classList.contains('tab-query-menu'))!; }
function sideButton(side: 'left' | 'right') { return doc.querySelectorAll('button').find(node => node.textContent === closeText[side])!; }
it('非活动查询锚点只交接准确ref，表标签不提供菜单且活动标签保持', async () => {
  ui.onCloseSide = vi.fn(); await render(); expect(wrapper('b').querySelectorAll('button').some(node => node.classList.contains('tab-query-menu'))).toBe(false);
  await click(menuButton('c')); expect(store.getState().settings.activeTabId).toBe('a'); expect(sideButton('right').disabled).toBe(true);
  const old = callback(sideButton('left'), 'onClick'); await click(sideButton('left')); expect(ui.onCloseSide).toHaveBeenCalledTimes(1);
  const [ref, side] = ui.onCloseSide.mock.calls[0]; expect(side).toBe('left'); expect(store.getState().resolveTabOrder(ref)?.id).toBe('c'); expect(ui.onClose).not.toHaveBeenCalled();
  await act(async () => old()); expect(ui.onCloseSide).toHaveBeenCalledTimes(1); expect(store.getState().settings.activeTabId).toBe('a');
});
it.each(['重排ABA', '来源ABA', '新增', 'blocked', '卸载', '拖动', '键盘移动', 'Escape', 'blur'])('%s后原菜单不可复活且不能撤销后来菜单', async fault => {
  ui.onCloseSide = vi.fn(); await render(); await click(menuButton('c')); const old = callback(sideButton('left'), 'onClick'), original = store.getState().settings;
  if (fault === '重排ABA') await act(async () => { store.getState().updateSettings({ tabs: [...original.tabs].reverse() }); store.getState().updateSettings(original); });
  if (fault === '来源ABA') await act(async () => { store.getState().updateTab('c', { databaseContext: { state: 'known', database: null } }); store.getState().updateSettings(original); });
  if (fault === '新增') await act(async () => store.getState().openTab({ kind: 'query', title: '后来查询', connectionId: 'c', sql: '' }));
  if (fault === 'blocked') await render(true); if (fault === '卸载') { await act(async () => root!.unmount()); root = undefined; }
  if (fault === '拖动') await drag('a'); if (fault === '键盘移动') await key('c', 'Home');
  if (fault === 'Escape') await act(async () => doc.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })));
  if (fault === 'blur') await act(async () => windowEvents.dispatchEvent(new MemoryEvent('blur')));
  await act(async () => old()); expect(ui.onCloseSide).not.toHaveBeenCalled();
  if (!['blocked', '卸载', '拖动'].includes(fault)) { await click(menuButton('c')); await act(async () => old()); expect(doc.querySelector('[role="menu"]')).not.toBeNull(); }
});
it('菜单期间出现又移除的模态也永久撤销，旧动作不穿透到新菜单', async () => {
  ui.onCloseSide = vi.fn(); await render(); await click(menuButton('c')); const old = callback(sideButton('left'), 'onClick');
  const modal = doc.createElement('div'); modal.setAttribute('role', 'dialog'); doc.body.appendChild(modal); doc.body.removeChild(modal);
  for (const observer of observers) if (observer.active) observer.records.push({ addedNodes: [modal] } as unknown as MutationRecord);
  await act(async () => old()); expect(ui.onCloseSide).not.toHaveBeenCalled();
});

it.each(['dialog', 'alertdialog'])('复用节点的%s角色变化后恢复也撤销旧菜单，未投递记录不能穿透', async role => {
  ui.onCloseSide = vi.fn(); await render();
  const reused = doc.createElement('div'); doc.body.appendChild(reused);
  await click(menuButton('c')); const old = callback(sideButton('left'), 'onClick');
  reused.setAttribute('role', role); reused.removeAttribute('role');
  for (const observer of observers) if (observer.active) observer.records.push(
    { type: 'attributes', target: reused, attributeName: 'role', oldValue: null } as unknown as MutationRecord,
    { type: 'attributes', target: reused, attributeName: 'role', oldValue: role } as unknown as MutationRecord
  );
  await act(async () => old()); expect(ui.onCloseSide).not.toHaveBeenCalled();
  await click(menuButton('c')); await act(async () => old()); expect(ui.onCloseSide).not.toHaveBeenCalled();
  expect(doc.querySelector('[role="menu"]')).not.toBeNull();
});
