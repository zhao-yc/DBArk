import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import { sqliteValueOptionsZh as text } from '../../src/renderer/locales/sqliteValueOptions.zh-CN';

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Dialog: typeof import('../../src/renderer/components/SqliteValueOptionsDialog')['SqliteValueOptionsDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { configurable: true, value: null }); const create = document.createElement.bind(document), selected = new WeakMap<MemoryNode, boolean>();
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'input') Object.defineProperty(node, 'type', { configurable: true, get: () => node.getAttribute('type') ?? 'text', set: value => node.setAttribute('type', value) });
    if (name === 'option') Object.defineProperties(node, { value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent }, selected: { configurable: true, get: () => selected.get(node) ?? false, set: value => { if (value) for (const sibling of node.parentNode?.querySelectorAll('option') ?? []) selected.set(sibling, false); selected.set(node, !!value); } } });
    if (name === 'select') Object.defineProperties(node, { options: { get: () => node.querySelectorAll('option') }, value: { configurable: true, get: () => node.querySelectorAll('option').find(option => selected.get(option))?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) selected.set(option, option.value === String(value)); } } });
    return node;
  };
  ({ useWorkspace } = await import('../../src/renderer/store')); ({ createRoot } = await import('react-dom/client')); ({ SqliteValueOptionsDialog: Dialog } = await import('../../src/renderer/components/SqliteValueOptionsDialog'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; useWorkspace.setState({ activeJobs: {} }); vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('真实React事件端口不存在'); return Reflect.get(node, key); }
function button(name: string): MemoryNode { const node = document.querySelectorAll('button').find(node => node.textContent === name); expect(node, name).toBeDefined(); return node!; }
function control(name: string): MemoryNode { const node = document.querySelectorAll('input,select').find(node => node.getAttribute('aria-label') === name); expect(node, name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function change(name: string, value: string | boolean) { const node = control(name); expect(node.disabled).toBe(false); await act(async () => props(node).onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } })); }
/** 界面/RAM端口验收不冒充真实数据库；Zustand原租约、Controller和React均使用产品代码。 */
async function mount() {
  useWorkspace.setState({ activeJobs: {} }); const state = { current: true }, applied = vi.fn(() => true), closed = vi.fn(), cleanup = vi.fn();
  const calls: { command: string; input: unknown }[] = [], base = { connectionId: 'c', database: 'main' as const, table: 'subject', schemaKey: 'a'.repeat(64), mode: 'and' as const, filters: [] }, columns = ['v', 'other'];
  const invoke = vi.fn(async (command: string, input: unknown) => { calls.push({ command, input }); if (command === 'query.cancel') return; if (command !== 'sqlite.valueOptions') throw Error('不同值RAM禁止其它IPC'); return { request: input, values: [{ value: { kind: 'integer', value: '9223372036854775807' }, count: '2' }, { value: { kind: 'text', value: '前\0🚢' }, count: '1' }, { value: { kind: 'null' }, count: '3' }, { value: { kind: 'real', value: 'Infinity' }, count: '1' }], truncated: false }; });
  Object.assign(window, { dbark: { invoke }, confirm: vi.fn(() => true) });
  const definition = { tabId: 'values-tab', base, columns, mode: 'and' as const, current: () => state.current, onApply: applied, onClose: closed, onCleanup: cleanup }, container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as HTMLElement);
  const render = async () => act(async () => root!.render(<Dialog {...definition}/>)); await render(); return { state, applied, closed, cleanup, calls, invoke, base, render };
}
it('打开、选择字段和搜索均零IPC，明确读取使用原目标，父重绘不撤销自己的候选', async () => {
  const f = await mount(); expect(f.calls).toEqual([]); await change(text.column, 'other'); await change(text.search, '%_中文'); expect(f.calls).toEqual([]);
  await click(text.read); expect(f.calls).toHaveLength(1); expect(f.calls[0]).toMatchObject({ command: 'sqlite.valueOptions', input: { ...f.base, column: 'other', search: '%_中文', taskId: expect.any(String) } }); expect(useWorkspace.getState().activeJobs['values-tab']).toBeFalsy();
  await f.render(); await change(text.choice(1), true); await change(text.choice(3), true); expect(control(text.choice(4)).disabled).toBe(true); await click(text.add);
  expect(f.applied).toHaveBeenCalledExactlyOnceWith({ column: 'other', operator: 'oneOf', selectedValues: [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }] }); expect(f.closed).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(1);
});
it('更改搜索取消丢弃确认保原候选和勾选；确认清空后仍须重新读取', async () => {
  const f = await mount(); await click(text.read); await change(text.choice(2), true); vi.mocked(window.confirm).mockReturnValueOnce(false); await change(text.search, 'new'); expect(control(text.search).value).toBe(''); expect(control(text.choice(2)).checked).toBe(true);
  await change(text.search, 'new'); expect(button(text.add).disabled).toBe(true); expect(f.calls).toHaveLength(1); await click(text.read); expect(f.calls).toHaveLength(2);
});
it('准确来源失效后旧输入和读取事件不投递后继请求，关闭仍可收尾', async () => {
  const f = await mount(), oldRead = props(button(text.read)).onClick, oldSearch = props(control(text.search)).onChange; f.state.current = false; await f.render();
  await act(async () => { oldRead(); oldSearch({ target: { value: '不应读取' } }); }); expect(f.calls).toEqual([]); expect(document.body.textContent).toContain(text.stale); await click(text.close); expect(f.closed).toHaveBeenCalledTimes(1);
});
it('同帧重复加入只交付一次；父级拒绝保留原勾选及可重试窗口', async () => {
  const f = await mount(); await click(text.read); await change(text.choice(1), true); f.applied.mockReturnValueOnce(false); await click(text.add); expect(f.closed).not.toHaveBeenCalled(); expect(control(text.choice(1)).checked).toBe(true); expect(document.body.textContent).toContain(text.rejected);
  const apply = props(button(text.add)).onClick; await act(async () => { apply(); apply(); }); expect(f.applied).toHaveBeenCalledTimes(2); expect(f.closed).toHaveBeenCalledTimes(1); expect(f.calls).toHaveLength(1);
});
