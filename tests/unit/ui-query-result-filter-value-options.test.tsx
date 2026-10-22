import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueryResult } from '../../src/shared/contracts';
import { QueryResultFilter, type QueryResultFilterGroup } from '../../src/renderer/queryResultFilter';
import { queryResultFilterZh as text } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultValueOptionsZh as valuesText } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Panel: typeof import('../../src/renderer/components/QueryResultFilterPanel')['QueryResultFilterPanel'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'option') Object.assign(node, { selected: false, defaultSelected: false });
    // 仅补标准HTML布尔属性反射，不提供布局、数据库、系统输入或伪造组件状态。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ QueryResultFilterPanel: Panel } = await import('../../src/renderer/components/QueryResultFilterPanel'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 完整原结果与生效投影分开；生产Panel/Picker/筛选器均使用真实实现，调用IPC立即失败。 */
async function mount(expression: QueryResultFilterGroup = { mode: 'AND', children: [{ column: 'kind', operator: 'eq', value: 'A' }] }) {
  const source: QueryResult = { columns: [{ key: 'id', name: '编号', type: 'BIGINT' }, { key: 'kind', name: '分类', type: 'VARCHAR' }], rows: [{ id: '1', kind: 'A' }, { id: '2', kind: 'B' }, { id: '3', kind: null }, { id: '4', kind: '' }], truncated: true, elapsedMs: 1, statement: '原SQL不变' };
  const filter = new QueryResultFilter(), binding = filter.bind(source, ['内存父结果'])!, initial = filter.applyExpression(binding, filter.view(binding)!, expression);
  const onApply = vi.fn(), onClose = vi.fn(), invoke = vi.fn(() => { throw Error('选择器不能执行IPC'); }); let available = true;
  Object.assign(window, { dbark: { invoke } }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<Panel binding={binding} initial={initial} isCurrent={() => available} onApply={onApply} onClose={onClose}/>));
  return { source, filter, binding, initial, onApply, onClose, invoke, invalidate() { available = false; }, restore() { available = true; } };
}
/** 只定位当前真实DOM；迟到事件测试读取React已提交的原回调，不直接改hook状态。 */
function named(label: string): MemoryNode { const node = document.querySelectorAll('[aria-label]').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function props(node: MemoryNode): Record<string, any> { const key = Object.keys(node).find(name => name.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return Reflect.get(node, key); }
async function click(label: string, aria = false): Promise<void> { const node = aria ? named(label) : button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function check(literal: string | null): Promise<void> { const node = named(valuesText.value(literal)); expect(node.disabled).toBe(false); await act(async () => { props(node).onChange({ target: { checked: true } }); }); }
async function mode(value: 'include' | 'exclude'): Promise<void> { await act(async () => props(named(valuesText.mode)).onChange({ target: { value } })); }
/** 合成键盘标志只验证冒泡和组合守卫，不当作原生键盘或输入法证据。 */
function key(patch: Record<string, unknown> = {}) { return { key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, keyCode: 27, defaultPrevented: false, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch }; }

describe('结果条件面板集成不同值选择草稿', () => {
  it('从原返回全行取值，确认仅替换本条草稿；外层应用后才变化原视图', async () => {
    const f = await mount(), before = structuredClone(f.source); expect(f.initial.sourceIndices).toEqual([0]);
    await click(valuesText.openCondition(1), true); expect(named(valuesText.title).getAttribute('role')).toBe('region'); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain(valuesText.counts(4, 4, 4, 0)); expect(document.body.textContent).toContain(text.truncated);
    await check('B'); await click(valuesText.apply); expect(document.querySelectorAll('[aria-label]').some(node => node.getAttribute('aria-label') === valuesText.title)).toBe(false);
    expect(f.onApply).not.toHaveBeenCalled(); expect(f.filter.view(f.binding)).toBe(f.initial); expect(named(text.member(1, 1)).value).toBe('B');
    await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce(); const expression = f.onApply.mock.calls[0][0]; expect(expression).toEqual({ mode: 'AND', children: [{ column: 'kind', operator: 'in', value: '', values: ['B'] }] });
    expect(f.filter.applyExpression(f.binding, f.initial, expression).sourceIndices).toEqual([1]); expect(f.source).toEqual(before); expect(f.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['include', ['A'], [0]], ['include', ['A', null], [0, 2]], ['include', [null], [2]],
    ['exclude', ['A'], [1, 2, 3]], ['exclude', ['A', null], [1, 3]], ['exclude', [null], [0, 1, 3]], ['include', [''], [3]],
  ] as const)('%s %j的NULL/空串语义沿真实外层控制器应用', async (method, selected, expected) => {
    const f = await mount(); await click(valuesText.openCondition(1), true); for (const literal of selected) await check(literal); await mode(method); await click(valuesText.apply); expect(f.onApply).not.toHaveBeenCalled();
    await click(text.apply); expect(f.filter.applyExpression(f.binding, f.initial, f.onApply.mock.calls[0][0]).sourceIndices).toEqual(expected); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('保留其它OR子组及原停用意图；混合NULL替换为子组，不解平原括号', async () => {
    const original: QueryResultFilterGroup = { mode: 'AND', children: [{ mode: 'OR', children: [{ column: 'id', operator: 'eq', value: '1' }, { column: 'id', operator: 'eq', value: '3' }] }, { column: 'kind', operator: 'eq', value: '旧停用原文', enabled: false }] };
    const f = await mount(original); await click(valuesText.openCondition(3), true); await check('A'); await check(null); await mode('exclude'); await click(valuesText.apply); await click(text.apply);
    const next = f.onApply.mock.calls[0][0]; expect(next.children[0]).toEqual(original.children[0]); expect(next.children[1]).toEqual({ mode: 'AND', children: [{ column: 'kind', operator: 'notIn', value: '', values: ['A'], enabled: false }, { column: 'kind', operator: 'notNull', value: '', enabled: false }] });
    expect(f.filter.applyExpression(f.binding, f.initial, next).sourceIndices).toEqual([0, 2]);
  });

  it('候选打开时旧外层应用/改值回调均不能越过同步门，取消保留原草稿', async () => {
    const f = await mount(), apply = props(button(text.apply)).onClick, input = props(named(text.input + ' 1')).onChange;
    await click(valuesText.openCondition(1), true); await act(async () => { apply(); input({ target: { value: '被旧输入覆盖' } }); }); expect(f.onApply).not.toHaveBeenCalled();
    const event = key(); await act(async () => props(named(valuesText.title)).onKeyDown(event)); expect(event.stopPropagation).toHaveBeenCalledOnce(); expect(f.onClose).not.toHaveBeenCalled(); expect(named(text.input + ' 1').value).toBe('A');
    await click(text.apply); expect(f.onApply.mock.calls[0][0]).toEqual(f.initial.expression);
  });

  it('候选原格漂移拒绝发布新筛选；失效窗口可取消，原控制器也撤销旧来源', async () => {
    const f = await mount(); await click(valuesText.openCondition(1), true); await check('B'); const apply = props(button(valuesText.apply)).onClick;
    f.source.rows[1].kind = '外部变化'; await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(valuesText.stale);
    await click(valuesText.cancel); expect(named(text.input + ' 1').value).toBe('A'); expect(f.onClose).not.toHaveBeenCalled(); expect(f.onApply).not.toHaveBeenCalled(); expect(f.initial.sourceIndices).toEqual([0]); expect(f.filter.view(f.binding)).toBeUndefined();
  });

  it('最终完整条件数超过32时拒绝混合NULL替换，保持原草稿及勾选供修正', async () => {
    const f = await mount({ mode: 'AND', children: Array.from({ length: 32 }, () => ({ column: 'kind', operator: 'eq', value: 'A' })) });
    await click(valuesText.openCondition(1), true); await check('A'); await check(null); await click(valuesText.apply);
    expect(f.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.budget); expect(named(valuesText.value('A')).checked).toBe(true); expect(named(valuesText.value(null)).checked).toBe(true);
    await click(valuesText.cancel); await click(text.apply); expect(f.onApply.mock.calls[0][0].children).toHaveLength(32);
  });

  it('旧picker的写入及取消不能影响重新打开的原列草稿', async () => {
    const f = await mount(); await click(valuesText.openCondition(1), true); await check('B'); const oldApply = props(button(valuesText.apply)).onClick, oldClose = props(button(valuesText.cancel)).onClick;
    await click(valuesText.cancel); await click(valuesText.openCondition(1), true); await check('A');
    await act(async () => { oldApply(); oldClose(); }); expect(document.body.textContent).toContain(valuesText.counts(4, 4, 4, 1)); expect(f.onApply).not.toHaveBeenCalled();
    await click(valuesText.apply); await click(text.apply); expect(f.onApply.mock.calls[0][0].children[0].values).toEqual(['A']);
  });
});
