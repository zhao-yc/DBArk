import React, { act } from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
const io = vi.hoisted(() => ({ entries: [] as any[] }));
/** 仅Monaco/IPC/几何使用RAM端口；QueryTab、分隔条、store及正文订阅为真实接线。 */
vi.mock('../../src/renderer/components/SqlEditor', async () => {
  const { useEffect, useLayoutEffect, useRef, createElement } = await import('react');
  return { SqlEditor(props: any) {
    const current = useRef(props); current.current = props; const entry = useRef<any>(undefined);
    useEffect(() => {
      let value = props.value, version = 1; const content = new Set<() => void>(), changes = new Set<() => void>(), disposal = new Set<() => void>();
      const model = { getValue: () => value, getVersionId: () => version, isDisposed: () => false, onDidChangeContent(callback: () => void) { content.add(callback); return { dispose: () => content.delete(callback) }; }, onWillDispose: () => ({ dispose() {} }) };
      const editor = { getModel: () => model, onDidChangeModel(callback: () => void) { changes.add(callback); return { dispose: () => changes.delete(callback) }; }, onDidDispose(callback: () => void) { disposal.add(callback); return { dispose: () => disposal.delete(callback) }; } };
      const state = { model, editor, undo: ['原撤销边界'], controlled: 0, input(next: string) { value = next; version++; for (const callback of content) callback(); current.current.onChange?.(next); }, controlledValue(next: string) { if (next !== value) { value = next; version++; state.controlled++; } } };
      entry.current = state; io.entries.push(state); props.onReady?.(editor); return () => { for (const callback of disposal) callback(); };
    }, []);
    useLayoutEffect(() => { entry.current?.controlledValue(props.value); }, [props.value]);
    return createElement('div', { 'aria-label': 'RAM Monaco正文端口' });
  } };
});
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let QueryTab: typeof import('../../src/renderer/components/QueryTab')['QueryTab'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'], flushSettings: typeof import('../../src/renderer/store')['flushSettings'];
let commands: Array<{ command: string; input: any }>, listeners: Map<string, Set<EventListener>>, rectangles: number, resizeCallbacks: Array<() => void>;
let saveHook: undefined | (() => Promise<void>), captures: Map<MemoryNode, Set<number>>;
const globalNames = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver'];
const originalGlobals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
const names = ['children', 'classList', 'getBoundingClientRect', 'setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'];
const originalProperties = names.map(name => [name, Object.getOwnPropertyDescriptor(MemoryNode.prototype, name)] as const);
beforeAll(async () => {
  doc = memoryDocument();
  Object.defineProperty(MemoryNode.prototype, 'children', { configurable: true, get() { return this.childNodes.filter((node: MemoryNode) => node.nodeType === 1); } });
  Object.defineProperty(MemoryNode.prototype, 'classList', { configurable: true, get() { return { contains: (value: string) => (this.getAttribute('class') ?? '').split(' ').includes(value) }; } });
  Object.defineProperty(MemoryNode.prototype, 'getBoundingClientRect', { configurable: true, value(this: MemoryNode) { const name = this.getAttribute('class') ?? ''; return { height: name.includes('query-tab') ? rectangles : name === 'toolbar' ? 45 : name === 'result-toolbar' ? 35 : name === 'tab-status' ? 33 : name === 'query-layout-bar' ? 18 : 0 }; } });
  Object.assign(MemoryNode.prototype, { setPointerCapture(this: MemoryNode, id: number) { const set = captures.get(this) ?? new Set<number>(); set.add(id); captures.set(this, set); }, hasPointerCapture(this: MemoryNode, id: number) { return captures.get(this)?.has(id) ?? false; }, releasePointerCapture(this: MemoryNode, id: number) { captures.get(this)?.delete(id); this.dispatchEvent(Object.assign(new MemoryEvent('lostpointercapture'), { pointerId: id })); } });
  ({ createRoot } = await import('react-dom/client')); ({ QueryTab } = await import('../../src/renderer/components/QueryTab')); ({ useWorkspace, flushSettings } = await import('../../src/renderer/store'));
});
beforeEach(() => {
  commands = []; io.entries = []; listeners = new Map(); captures = new Map(); rectangles = 850; resizeCallbacks = []; saveHook = undefined;
  window.addEventListener = ((name: string, callback: EventListener) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); }) as typeof window.addEventListener;
  window.removeEventListener = ((name: string, callback: EventListener) => { listeners.get(name)?.delete(callback); }) as typeof window.removeEventListener;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { constructor(callback: () => void) { resizeCallbacks.push(callback); } observe() {} unobserve() {} disconnect() {} } });
  (window as any).dbark = { onTask: () => () => {}, onMenu: () => () => {}, invoke: async (command: string, input: unknown) => { commands.push({ command, input: structuredClone(input) }); if (command !== 'settings.save') throw Error('布局禁止SQL或其它外界调用：' + command); return saveHook?.(); } };
  useWorkspace.setState({ settings: { theme: 'dark', sidebarWidth: 260, resultLimit: 1000, pageSize: 100, activeTabId: 'a', tabs: [{ id: 'a', kind: 'query', title: '查询A', connectionId: 'c', sql: 'SELECT 原SQL;' }, { id: 'b', kind: 'query', title: '查询B', connectionId: 'c', sql: 'SELECT B;' }] }, connections: [{ id: 'c', name: 'RAM连接', group: '', color: '', dialect: 'mysql', host: 'offline.invalid', port: 1, user: 'ram' }], tasks: [], activeJobs: {}, dirtyTabs: {}, connectionVersions: {}, notice: undefined });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; saveHook = undefined; await flushSettings(); expect([...listeners.values()].every(list => !list.size)).toBe(true); expect([...captures.values()].every(set => !set.size)).toBe(true); doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of originalProperties) if (descriptor) Object.defineProperty(MemoryNode.prototype, name, descriptor); else Reflect.deleteProperty(MemoryNode.prototype, name); for (const [name, descriptor] of originalGlobals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mount() { function View() { const tabs = useWorkspace(state => state.settings.tabs); return <>{tabs.map(tab => <section key={tab.id} data-layout-tab={tab.id}><QueryTab tab={tab} onHistory={() => {}}/></section>)}</>; } const node = doc.createElement('div'); doc.body.appendChild(node); root = createRoot(node as any); await act(async () => root!.render(<View/>)); }
function section(id = 'a') { return doc.querySelector(`[data-layout-tab="${id}"]`)!; }
function splitter(id = 'a') { const node = section(id).querySelector('[role="separator"]'); if (!node) throw Error('真实QueryTab未接入分隔条'); return node; }
async function down() { await act(async () => splitter().dispatchEvent(Object.assign(new MemoryEvent('pointerdown'), { pointerId: 7, clientY: 100, isPrimary: true }))); }
async function pointer(type: string, y: number) { const event = Object.assign(new MemoryEvent(type), { pointerId: 7, clientY: y }); await act(async () => { for (const callback of [...listeners.get(type) ?? []]) callback(event as unknown as Event); }); }

it('真实QueryTab默认300接原编辑器；预览和取消不保存或替换model/正文/撤销', async () => {
  await mount(); const original = io.entries[0], version = original.model.getVersionId(), undo = original.undo;
  expect(section().querySelector('[class="sql-editor-wrap"]')!.style).toMatchObject({ height: '300px' }); expect(commands).toEqual([]);
  await down(); await pointer('pointermove', 150); await pointer('pointercancel', 150);
  expect(io.entries[0]).toBe(original); expect(original.model.getVersionId()).toBe(version); expect(original.undo).toBe(undo); expect(original.controlled).toBe(0); expect(commands).toEqual([]);
});
it('整合：pointerup明确提交当前标签，另一标签布局与原SQL保持', async () => {
  await mount(); const original = io.entries[0]; await down(); await pointer('pointermove', 160);
  expect(useWorkspace.getState().settings.tabs[0].queryEditorHeight).toBeUndefined(); expect(commands).toEqual([]);
  await pointer('pointerup', 180); await flushSettings();
  expect(useWorkspace.getState().settings.tabs.map(tab => tab.queryEditorHeight)).toEqual([380, undefined]);
  expect(commands.every(item => item.command === 'settings.save')).toBe(true); expect(commands.at(-1)!.input.tabs[0]).toMatchObject({ sql: 'SELECT 原SQL;', queryEditorHeight: 380 });
  expect(io.entries[0]).toBe(original); expect(original.controlled).toBe(0);
});
it.each(['标签ABA', '目标ABA', '连接代次ABA', '关闭', '后来高度'])('整合：%s同步撤销原监听，旧pointerup不保存或回滚后来设置', async fault => {
  await mount(); await down(); await pointer('pointermove', 160); const late = [...listeners.get('pointerup')!][0];
  await act(async () => {
    const state = useWorkspace.getState();
    if (fault === '标签ABA') { state.updateSettings({ activeTabId: 'b' }); useWorkspace.getState().updateSettings({ activeTabId: 'a' }); }
    if (fault === '目标ABA') { state.updateTab('a', { database: 'other' }); useWorkspace.getState().updateTab('a', { database: undefined }); }
    if (fault === '连接代次ABA') { state.invalidateConnection('c'); useWorkspace.setState({ connectionVersions: {} }); }
    if (fault === '关闭') state.closeTab('a');
    if (fault === '后来高度') state.updateTab('a', { queryEditorHeight: 610 });
  });
  await act(async () => late(Object.assign(new MemoryEvent('pointerup'), { pointerId: 7, clientY: 250 }) as unknown as Event));
  const current = useWorkspace.getState().settings.tabs.find(tab => tab.id === 'a');
  if (fault === '关闭') expect(current).toBeUndefined(); else expect(current?.queryEditorHeight).toBe(fault === '后来高度' ? 610 : undefined);
  expect(useWorkspace.getState().settings.tabs.find(tab => tab.id === 'b')!.sql).toBe('SELECT B;');
});
it('整合：键盘按标签保存并明确恢复300，重新挂载只读取各自高度', async () => {
  await mount();
  for (const [key, shiftKey] of [['ArrowDown', false], ['ArrowDown', true]] as const) await act(async () => splitter().dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key, shiftKey })));
  expect(useWorkspace.getState().settings.tabs[0].queryEditorHeight).toBe(360);
  await act(async () => useWorkspace.getState().updateSettings({ activeTabId: 'b' }));
  await act(async () => splitter('b').dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'ArrowUp' })));
  expect(useWorkspace.getState().settings.tabs.map(tab => tab.queryEditorHeight)).toEqual([360, 290]);
  await flushSettings(); const saved = structuredClone(useWorkspace.getState().settings);
  await act(async () => root!.unmount()); root = undefined; io.entries = []; useWorkspace.setState({ settings: saved }); await mount();
  expect(section('a').querySelector('[class="sql-editor-wrap"]')!.style).toMatchObject({ height: '360px' }); expect(section('b').querySelector('[class="sql-editor-wrap"]')!.style).toMatchObject({ height: '290px' });
  await act(async () => splitter('b').dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Home' }))); expect(useWorkspace.getState().settings.tabs.map(tab => tab.queryEditorHeight)).toEqual([360, 300]);
});
it('整合：提交合并结束时新SQL/标题/来源，保存晚回包不还原后来的正文', async () => {
  await mount(); const entry = io.entries[0]; await down(); await pointer('pointermove', 150);
  const binding = { id: 'saved-new', digest: 'b'.repeat(64), connectionId: 'c', context: { state: 'known' as const, database: null } };
  await act(async () => { entry.input('SELECT 提交前的新SQL;'); useWorkspace.getState().updateTab('a', { title: '后来标题', sourceBinding: binding }); });
  await pointer('pointerup', 170);
  let finish!: () => void; const held = new Promise<void>(resolve => { finish = resolve; }); let first = true;
  saveHook = () => { if (first) { first = false; return held; } return Promise.resolve(); };
  const oldSave = flushSettings();
  try {
    expect(commands.at(-1)!.input.tabs[0]).toMatchObject({ sql: 'SELECT 提交前的新SQL;', title: '后来标题', sourceBinding: binding, queryEditorHeight: 370 });
    await act(async () => entry.input('SELECT 保存等待中的更新正文;')); await flushSettings(); finish(); await oldSave;
    expect(useWorkspace.getState().settings.tabs[0]).toMatchObject({ sql: 'SELECT 保存等待中的更新正文;', title: '后来标题', sourceBinding: binding, queryEditorHeight: 370 }); expect(io.entries[0]).toBe(entry);
  } finally { finish(); await oldSave; }
});
it('整合：当前窗口变矮再恢复只视觉压缩，不落盘并保留900偏好', async () => {
  const state = useWorkspace.getState(); useWorkspace.setState({ settings: { ...state.settings, tabs: state.settings.tabs.map(tab => tab.id === 'a' ? { ...tab, queryEditorHeight: 900 } : tab) } });
  await mount(); expect(useWorkspace.getState().settings.tabs[0].queryEditorHeight).toBe(900); expect(commands).toEqual([]);
  rectangles = 250; await act(async () => { for (const callback of resizeCallbacks) callback(); });
  expect(Number(String((section().querySelector('[class="sql-editor-wrap"]')!.style as any).height).replace('px', ''))).toBeLessThan(130);
  expect(useWorkspace.getState().settings.tabs[0].queryEditorHeight).toBe(900); expect(commands).toEqual([]);
  rectangles = 1400; await act(async () => { for (const callback of resizeCallbacks) callback(); });
  expect(section().querySelector('[class="sql-editor-wrap"]')!.style).toMatchObject({ height: '900px' }); expect(commands).toEqual([]);
});
