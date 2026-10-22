import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FilterGroup, FilterRule } from '../../src/shared/contracts';
import type { TableSelectedFilterProposal } from '../../src/renderer/tableSelectedFilter';
import { TableSelectedFilterPanel } from '../../src/renderer/components/TableSelectedFilterPanel';
import { tableSelectedFilterZh as text } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    // 仅补HTML布尔disabled端口；真实面板和React事件保持生产实现，不模拟数据库或本机输入法。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; Reflect.deleteProperty(window, 'dbark'); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 合成提案按模型合同递归冻结；这里只准备输入，不替代生产面板或父来源判断。 */
function freeze<T>(value: T): T { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
/** 给预览准备完整含旧条件的协议；各文本断言独立核UI，不据此断言模型生成正确。 */
function proposal(patch: Partial<Pick<TableSelectedFilterProposal, 'column' | 'rowCount' | 'values' | 'includesNull' | 'exclude'>> = {}): TableSelectedFilterProposal {
  const values = patch.values ?? ['', 'NULL', '甲,乙\n下一行', '18446744073709551615'], includesNull = patch.includesNull ?? true, exclude = patch.exclude ?? false, column = patch.column ?? '__proto__';
  const filters: FilterRule[] = [{ column: '旧列', operator: '=', value: '旧条件原值' }, { column: '停用列', operator: '=', value: '保留停用', enabled: false }];
  const selected: number[] = [];
  if (values.length) { selected.push(filters.length); filters.push({ column, operator: exclude ? 'NOT IN' : 'IN', values: [...values] }); }
  if (includesNull || exclude) { selected.push(filters.length); filters.push({ column, operator: exclude && includesNull ? 'IS NOT NULL' : 'IS NULL' }); }
  const filterGroup: FilterGroup = { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: exclude && includesNull ? 'all' : 'any', children: selected }] };
  return freeze({ column, rowCount: patch.rowCount ?? values.length + Number(includesNull) + 2, values: [...values], includesNull, exclude, filters, filterMode: 'all', filterGroup });
}
/** 只提供父回调观察端；若面板调用任何IPC立即失败，不允许测试悄悄联网。 */
async function mount(input = proposal()) {
  const invoke = vi.fn(() => { throw Error('预览不得调用IPC'); }), onApply = vi.fn(() => true), onClose = vi.fn(); let active = true, currentKey = 'origin';
  (window as any).dbark = { invoke };
  let props = { proposal: input, isCurrent: () => active, onApply, onClose };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<TableSelectedFilterPanel key={currentKey} {...props}/>));
  return { input, invoke, onApply, onClose, invalidate: () => { active = false; }, restore: () => { active = true; },
    async update(patch: Partial<typeof props> = {}, key = currentKey) { currentKey = key; props = { ...props, ...patch }; await act(async () => root!.render(<TableSelectedFilterPanel key={currentKey} {...props}/>)); } };
}
/** 按固定aria定位生产DOM，避免把说明文字或原值误当按钮。 */
function node(label: string) { const result = document.querySelectorAll('[aria-label]').find(item => item.getAttribute('aria-label') === label); expect(result, label).toBeDefined(); return result!; }
function button(label: string) { const result = document.querySelectorAll('button').find(item => item.textContent === label); expect(result, label).toBeDefined(); return result!; }
async function click(label: string) { const target = button(label); expect(target.disabled, label).toBe(false); await act(async () => target.dispatchEvent(new MemoryEvent('click'))); }
/** 捕获真实已提交DOM闭包，检查旧渲染及同一事件栈的同步门，不读组件内部状态。 */
function props(node: MemoryNode) { const name = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!name) throw Error('缺少真实React事件'); return (node as any)[name]; }
/** 合成事件仅验证标志守卫；实体键盘、输入法及浏览器默认行为需后续原生验收。 */
function key(patch: Record<string, unknown> = {}) { return { key: 'Enter', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, keyCode: 13, defaultPrevented: false, nativeEvent: {}, target: node(text.title), currentTarget: node(text.title), preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch }; }

describe('勾选值筛选只读内联预览', () => {
  it('原勾选数和去重数分开，空串/NULL字符串/换行/精确大数及原型列原样展示，打开零副作用', async () => {
    const input = proposal({ rowCount: 12 }), before = JSON.stringify(input), f = await mount(input);
    expect(node(text.title).getAttribute('role')).toBe('region'); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(node(text.column).textContent).toBe('__proto__'); expect(node(text.rowCount).textContent).toBe('12'); expect(node(text.valueCount).textContent).toBe('4'); expect(node(text.nullState).textContent).toBe(text.hasNull);
    expect(node(text.values).querySelectorAll('[role="listitem"]').map(value => value.textContent)).toEqual(['""', '"NULL"', '"甲,乙\\n下一行"', '"18446744073709551615"']);
    expect(node(text.nullValue).textContent).toBe(text.null); expect(node(text.semantics).textContent).toBe(text.includeValuesNull); expect(document.body.textContent).toContain(text.originalAnd);
    expect(f.invoke).not.toHaveBeenCalled(); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(JSON.stringify(input)).toBe(before);
    await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled(); expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    { values: ['甲'], includesNull: false, exclude: false, summary: text.includeValues },
    { values: ['甲'], includesNull: true, exclude: false, summary: text.includeValuesNull },
    { values: [], includesNull: true, exclude: false, summary: text.includeNull },
    { values: ['甲'], includesNull: false, exclude: true, summary: text.excludeValues },
    { values: ['甲'], includesNull: true, exclude: true, summary: text.excludeValuesNull },
    { values: [], includesNull: true, exclude: true, summary: text.excludeNull },
  ])('完整包含/排除语义：$summary', async ({ summary, ...patch }) => {
    const f = await mount(proposal(patch)); expect(node(text.semantics).textContent).toBe(summary); expect(document.body.textContent).toContain(text.originalAnd);
    expect(document.querySelectorAll('[aria-label]').some(item => item.getAttribute('aria-label') === text.nullValue)).toBe(patch.includesNull);
    if (!patch.values.length) expect(node(text.values).textContent).toContain(text.noValues); expect(f.invoke).not.toHaveBeenCalled(); expect(f.onApply).not.toHaveBeenCalled();
  });

  it('200个唯一非NULL值完整有界展示，201不截断成假完整预览', async () => {
    const values = Array.from({ length: 200 }, (_, index) => '值' + index), f = await mount(proposal({ values, includesNull: false }));
    expect(node(text.values).querySelectorAll('[role="listitem"]')).toHaveLength(200); expect(node(text.values).querySelectorAll('[role="listitem"]').at(-1)?.textContent).toBe('"值199"'); expect(button(text.apply).disabled).toBe(false);
    await f.update({ proposal: proposal({ values: [...values, '超限'], includesNull: false }) }, 'over-budget'); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.budget); expect(document.querySelectorAll('[role="listitem"]')).toHaveLength(0); expect(f.onApply).not.toHaveBeenCalled(); expect(f.invoke).not.toHaveBeenCalled();
    await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('显式应用无参数且同步单次消费，连点或旧取消不再调用父层', async () => {
    const f = await mount(), apply = props(button(text.apply)).onClick, cancel = props(button(text.cancel)).onClick;
    await act(async () => { apply(); apply(); cancel(); }); expect(f.onApply.mock.calls).toEqual([[]]); expect(f.onClose).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('父连续否决保持原面板且每次新事件可重试，同轮旧尝试不能重复确认', async () => {
    const f = await mount(), before = JSON.stringify(f.input); f.onApply.mockReturnValueOnce(false).mockReturnValueOnce(false);
    const old = props(button(text.apply)).onClick; await act(async () => { old(); old(); }); expect(f.onApply).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(text.declined); expect(f.onClose).not.toHaveBeenCalled();
    await click(text.apply); expect(f.onApply).toHaveBeenCalledTimes(2); expect(button(text.apply).disabled).toBe(false); await act(async () => old()); expect(f.onApply).toHaveBeenCalledTimes(2);
    await click(text.apply); expect(f.onApply).toHaveBeenCalledTimes(3); expect(JSON.stringify(f.input)).toBe(before); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('父抛错仅显示错误并保留提案，下一次明确尝试可用且没有自动重放', async () => {
    const f = await mount(); f.onApply.mockImplementationOnce(() => { throw Error('父层重新核验失败'); }); await click(text.apply);
    expect(document.body.textContent).toContain('父层重新核验失败'); expect(f.onApply).toHaveBeenCalledOnce(); expect(f.onClose).not.toHaveBeenCalled(); await click(text.apply); expect(f.onApply).toHaveBeenCalledTimes(2); expect(f.invoke).not.toHaveBeenCalled();
  });

  it('父来源首次失效永久撤销，恢复后仍不能应用，当前取消可关闭失效提示', async () => {
    const f = await mount(), old = props(button(text.apply)).onClick; f.invalidate(); await act(async () => old()); expect(document.body.textContent).toContain(text.unavailable); f.restore(); await f.update();
    expect(button(text.apply).disabled).toBe(true); await act(async () => { old(); props(button(text.apply)).onClick(); }); expect(f.onApply).not.toHaveBeenCalled(); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('同值新提案再换回不重新授权原父，只有新挂载面板能独立应用', async () => {
    const f = await mount(), original = f.input, oldApply = props(button(text.apply)).onClick, oldCancel = props(button(text.cancel)).onClick;
    await f.update({ proposal: proposal() }); await f.update({ proposal: original }); expect(button(text.apply).disabled).toBe(true); await act(async () => oldApply()); expect(f.onApply).not.toHaveBeenCalled();
    await f.update({ proposal: proposal() }, 'new-owner'); await act(async () => { oldApply(); oldCancel(); }); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce();
  });

  it('取消单次消费，旧close在后继渲染和卸载后不能关闭新面板', async () => {
    const f = await mount(), old = props(button(text.cancel)).onClick; await f.update(); await act(async () => old()); expect(f.onClose).not.toHaveBeenCalled();
    const cancel = props(button(text.cancel)).onClick; await act(async () => { cancel(); cancel(); }); expect(f.onClose).toHaveBeenCalledOnce();
    await f.update({ proposal: proposal() }, 'next'); await act(async () => { old(); cancel(); }); expect(f.onClose).toHaveBeenCalledOnce(); const later = props(button(text.cancel)).onClick;
    await act(async () => { root!.unmount(); root = undefined; later(); }); expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('已消费合成或native事件不应用/取消；未消费按钮仍明确可用', async () => {
    const f = await mount(), apply = props(button(text.apply)).onClick, cancel = props(button(text.cancel)).onClick;
    await act(async () => { for (const event of [{ defaultPrevented: true }, { nativeEvent: { defaultPrevented: true } }]) { apply(event); cancel(event); } }); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce();
  });

  it('组合输入同步阻止按钮和旧快捷键，结束后明确CtrlEnter才应用', async () => {
    const f = await mount(), apply = props(button(text.apply)).onClick, cancel = props(button(text.cancel)).onClick;
    await act(async () => { props(node(text.title)).onCompositionStart({}); apply(); cancel(); }); expect(button(text.apply).disabled).toBe(true); expect(button(text.cancel).disabled).toBe(true);
    await act(async () => props(node(text.title)).onKeyDown(key())); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
    await act(async () => props(node(text.title)).onCompositionEnd({})); const event = key(); await act(async () => props(node(text.title)).onKeyDown(event)); expect(f.onApply).toHaveBeenCalledOnce(); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it('已消费、229、组合标志、长按与额外Enter修饰键不触发动作或吞键', async () => {
    const f = await mount(), handler = props(node(text.title)).onKeyDown;
    for (const patch of [{ defaultPrevented: true }, { nativeEvent: { defaultPrevented: true } }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }, { repeat: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { ctrlKey: false }]) {
      const event = key(patch); await act(async () => handler(event)); expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopPropagation).not.toHaveBeenCalled();
    }
    expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); const event = key({ ctrlKey: false, metaKey: true }); await act(async () => handler(event)); expect(f.onApply).toHaveBeenCalledOnce();
  });

  it('Ctrl/Meta/Alt/Shift Escape不取消，单独Escape只取消一次', async () => {
    const f = await mount(), handler = props(node(text.title)).onKeyDown;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) { const event = key({ key: 'Escape', ctrlKey: false, [modifier]: true }); await act(async () => handler(event)); expect(event.preventDefault).not.toHaveBeenCalled(); }
    expect(f.onClose).not.toHaveBeenCalled(); const event = key({ key: 'Escape', ctrlKey: false }); await act(async () => { handler(event); handler(key({ key: 'Escape', ctrlKey: false })); }); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled(); expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it.each(['input', 'textarea', 'select', 'editable-child'])('%s内快捷键由输入控件拥有，不应用也不取消', async targetKind => {
    const f = await mount(), region = node(text.title), child = document.createElement(targetKind === 'editable-child' ? 'span' : targetKind);
    if (targetKind === 'editable-child') { const editable = document.createElement('div'); editable.setAttribute('contenteditable', 'true'); region.appendChild(editable); editable.appendChild(child); } else region.appendChild(child);
    const handler = props(region).onKeyDown;
    for (const event of [key({ target: child }), key({ target: child, key: 'Escape', ctrlKey: false })]) { await act(async () => handler(event)); expect(event.preventDefault).not.toHaveBeenCalled(); }
    expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
  });
});
