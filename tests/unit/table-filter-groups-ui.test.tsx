import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FilterGroup, FilterRule } from '../../src/shared/contracts';
import { TableFilterGroupsDialog } from '../../src/renderer/components/TableFilterGroupsDialog';
import { tableFilterGroupsZh as text } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { validateFilterGroup } from '../../src/shared/filtering';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } });
    }
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 仅现有规则常量，集合/停用/精确值由真实面板原样展示，不使用组件成功mock。 */
function rules(count = 3): FilterRule[] {
  return Array.from({ length: count }, (_, index) => index === 1 ? { column: '原型__proto__', operator: 'IN', values: ['', 'NULL', '甲,乙\n下一行'], enabled: false } : { column: 'id', operator: '=', value: index === 0 ? '18446744073709551615' : String(index) });
}
/** 只替代父层明确确认结果；面板草稿、稳定ID、协议校验和DOM事件使用生产实现。 */
async function mount(initial?: FilterGroup, filters = rules()) {
  const onApply = vi.fn((_group: FilterGroup) => true), onClose = vi.fn(); let active = true, currentKey = 'same';
  let props = { filters, mode: 'all' as 'all' | 'any', initial, isCurrent: () => active, onApply, onClose };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<TableFilterGroupsDialog key="same" {...props}/>));
  return { filters, onApply, onClose, invalidate: () => { active = false; }, restore: () => { active = true; },
    async update(patch: Partial<typeof props>, key = currentKey) { currentKey = key; props = { ...props, ...patch }; await act(async () => root!.render(<TableFilterGroupsDialog key={key} {...props}/>)); } };
}
/** 取真实渲染事件闭包以验证旧节点不能操作新草稿，不替换组件控制器。 */
function reactProps(node: MemoryNode) { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (node as any)[key]; }
function node(label: string) { const value = document.querySelector(`[aria-label="${label}"]`); expect(value, label).not.toBeNull(); return value!; }
function button(label: string) { const value = document.querySelectorAll('button').find(value => value.textContent === label || value.getAttribute('aria-label') === label); expect(value, label).toBeDefined(); return value!; }
async function click(label: string) { const value = button(label); expect(value.disabled, label).toBe(false); await act(async () => value.dispatchEvent(new MemoryEvent('click'))); }
async function change(label: string, value: string) { const select = node(label); expect(select.disabled).toBe(false); await act(async () => { select.value = value; select.dispatchEvent(new MemoryEvent('change')); }); }
/** 路径只定位可见option，测试不猜内部稳定节点编号。 */
async function move(ruleNo: number, path: string) { const select = node(text.destination(ruleNo)), option = select.querySelectorAll('option').find(option => option.textContent === text.group(path)); expect(option).toBeDefined(); await change(text.destination(ruleNo), option!.value); }
/** 原键盘事件形状，只在真实面板处理器消费后记录preventDefault/stopPropagation。 */
function key(patch: Record<string, unknown> = {}) { return { key: 'Enter', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false, keyCode: 13, defaultPrevented: false, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...patch }; }

describe('表条件分组的真实内联面板', () => {
  it('只组合原叶并显示停用摘要；打开、编辑和取消均不应用或修改原值', async () => {
    const filters = rules(), before = structuredClone(filters), f = await mount(undefined, filters);
    expect(node(text.title).getAttribute('role')).toBe('region'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.textContent).toContain('已停用'); expect(document.body.textContent).toContain('18446744073709551615');
    await click(text.addGroup()); await move(1, '1'); await move(2, '1'); await change(text.groupMode('1'), 'any');
    expect(f.onApply).not.toHaveBeenCalled(); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(filters).toEqual(before);
  });

  it('明确Apply才交付完整组，父层否决保持草稿，随后确认只提交一次', async () => {
    const f = await mount(); await click(text.addGroup()); await move(1, '1'); await move(2, '1');
    f.onApply.mockReturnValueOnce(false); await click(text.apply); expect(document.body.textContent).toContain(text.declined); expect(f.onClose).not.toHaveBeenCalled();
    const expected = { mode: 'all', children: [2, { mode: 'any', children: [0, 1] }] };
    expect(f.onApply.mock.calls[0][0]).toEqual(expected); await click(text.apply); const apply = reactProps(button(text.apply)).onClick; await act(async () => apply()); expect(f.onApply).toHaveBeenCalledTimes(2); expect(Object.isFrozen(f.onApply.mock.calls[1][0])).toBe(true);
  });

  it('根和嵌套子组独立all/any，解散按原位置提升孙组及停用叶', async () => {
    const initial: FilterGroup = { mode: 'all', children: [{ mode: 'any', children: [0, { mode: 'all', children: [1] }] }, 2] }, f = await mount(initial);
    await change(text.groupMode(), 'any'); await click(text.dissolve('1')); await click(text.apply);
    expect(f.onApply).toHaveBeenCalledExactlyOnceWith({ mode: 'any', children: [0, { mode: 'all', children: [1] }, 2] }); expect(initial.children).toHaveLength(2);
  });

  it('允许暂时空组，但Apply拒绝空子组；移入原叶后才能提交且各叶恰一次', async () => {
    const f = await mount(); await click(text.addGroup()); await click(text.apply); expect(f.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.emptyGroup);
    await move(3, '1'); await click(text.apply); const group = f.onApply.mock.calls[0][0]; expect(validateFilterGroup(f.filters, group.mode, group)).toEqual({ mode: 'all', children: [0, 1, { mode: 'any', children: [2] }] });
  });

  it('同一事件栈旧root回调及解散后占据相同路径的新组不能被旧回调改写', async () => {
    const f = await mount(), add = reactProps(button(text.addGroup())).onClick;
    await act(async () => { add({ defaultPrevented: false }); add({ defaultPrevented: false }); }); expect(document.querySelectorAll('fieldset')).toHaveLength(1);
    const oldMode = reactProps(node(text.groupMode('1'))).onChange, dissolve = reactProps(button(text.dissolve('1'))).onClick;
    await click(text.dissolve('1')); await click(text.addGroup()); await act(async () => { oldMode({ target: { value: 'all' } }); dissolve({ defaultPrevented: false }); });
    expect(node(text.groupMode('1')).value).toBe('any'); await move(1, '1'); await click(text.apply); expect(f.onApply.mock.calls[0][0]).toEqual({ mode: 'all', children: [1, 2, { mode: 'any', children: [0] }] });
  });

  it('叶移组后旧目标回调不能借原编号移动后来叶，伪造目标范围明确拒绝', async () => {
    const f = await mount(); await click(text.addGroup()); const old = reactProps(node(text.destination(1))).onChange;
    await move(1, '1'); await act(async () => old({ target: { value: '0' } }));
    const current = node(text.destination(1)); expect(current.value).not.toBe('0'); await act(async () => reactProps(current).onChange({ target: { value: '999999' } })); expect(document.body.textContent).toContain(text.invalidDestination);
    await click(text.apply); expect(f.onApply.mock.calls[0][0]).toEqual({ mode: 'all', children: [1, 2, { mode: 'any', children: [0] }] });
  });

  it('isCurrent首次拒绝永久撤销，原环境恢复不复活旧Apply；取消仍可关闭提示', async () => {
    const f = await mount(), apply = reactProps(button(text.apply)).onClick; f.invalidate(); await act(async () => apply()); f.restore(); await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled(); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('父条件原值或props身份变化不能由旧草稿覆盖，新面板挂载后独立可用', async () => {
    const f = await mount(), apply = reactProps(button(text.apply)).onClick; f.filters[0].value = '原值已改'; await act(async () => apply()); f.filters[0].value = '18446744073709551615'; await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled();
    await f.update({ filters: rules() }, 'next-owner'); const newer = reactProps(button(text.apply)).onClick; await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled(); await act(async () => newer()); expect(f.onApply).toHaveBeenCalledOnce();
  });

  it('组合输入期间按钮和旧快捷回调拒绝，结束后明确快捷键才可应用', async () => {
    const f = await mount(), region = node(text.title), stale = reactProps(button(text.apply)).onClick;
    await act(async () => reactProps(region).onCompositionStart()); expect(button(text.apply).disabled).toBe(true); expect(button(text.addGroup()).disabled).toBe(true);
    await act(async () => { stale(); reactProps(region).onKeyDown(key()); }); expect(f.onApply).not.toHaveBeenCalled();
    await act(async () => reactProps(region).onCompositionEnd()); const event = key(); await act(async () => reactProps(region).onKeyDown(event)); expect(event.preventDefault).toHaveBeenCalledOnce(); expect(f.onApply).toHaveBeenCalledOnce();
  });

  it('已消费、输入法、229、长按和额外修饰键不提交或取消，单独Escape只取消', async () => {
    const f = await mount(), handler = reactProps(node(text.title)).onKeyDown;
    for (const patch of [{ defaultPrevented: true }, { nativeEvent: { defaultPrevented: true } }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { repeat: true }, { altKey: true }, { shiftKey: true }]) await act(async () => handler(key(patch)));
    await act(async () => handler(key({ key: 'Escape', ctrlKey: false, defaultPrevented: true }))); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
    const escape = key({ key: 'Escape', ctrlKey: false }); await act(async () => handler(escape)); expect(f.onClose).toHaveBeenCalledOnce(); expect(escape.stopPropagation).toHaveBeenCalledOnce();
  });

  it('已消费按钮及选择事件不改变树，也不能应用或取消', async () => {
    const f = await mount(), apply = reactProps(button(text.apply)).onClick, cancel = reactProps(button(text.cancel)).onClick, add = reactProps(button(text.addGroup())).onClick;
    await act(async () => { apply({ defaultPrevented: true }); cancel({ nativeEvent: { defaultPrevented: true } }); add({ defaultPrevented: true }); reactProps(node(text.groupMode())).onChange({ defaultPrevented: true, target: { value: 'any' } }); });
    expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(document.querySelectorAll('fieldset')).toHaveLength(0); expect(node(text.groupMode()).value).toBe('all');
    await click(text.apply); expect(f.onApply).toHaveBeenCalledExactlyOnceWith({ mode: 'all', children: [0, 1, 2] });
  });

  it('父级真实外部modal门一旦拒绝，modal移除不能复活旧草稿', async () => {
    const f = await mount(); await f.update({ isCurrent: () => !document.querySelector('[role="dialog"]') });
    const apply = reactProps(button(text.apply)).onClick, modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.appendChild(modal);
    await act(async () => apply()); modal.parentNode!.removeChild(modal); await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled(); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });

  it('同值新filters或原始组原地改写都拒绝，恢复来源不覆盖本次草稿', async () => {
    const initial: FilterGroup = { mode: 'all', children: [0, 1, 2] }, f = await mount(initial), apply = reactProps(button(text.apply)).onClick;
    (initial.children as number[]).reverse(); await act(async () => apply()); (initial.children as number[]).reverse(); await act(async () => apply()); expect(f.onApply).not.toHaveBeenCalled();
    await f.update({ filters: rules() }, 'new-source'); const originalApply = reactProps(button(text.apply)).onClick;
    await f.update({ filters: rules() }); await act(async () => originalApply()); expect(f.onApply).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true);
  });

  it('30叶含停用均可保留，31叶及无叶来源禁止应用或增加组', async () => {
    const f = await mount(undefined, rules(30)); await click(text.apply); expect((f.onApply.mock.calls[0][0]).children).toHaveLength(30);
    await f.update({ filters: rules(31) }, 'over-budget'); expect(button(text.apply).disabled).toBe(true);
    const add = document.querySelectorAll('button').find(value => value.getAttribute('aria-label') === text.addGroup()); expect(add === undefined || add.disabled).toBe(true);
    await f.update({ filters: [] }, 'empty'); expect(button(text.apply).disabled).toBe(true); expect(button(text.addGroup()).disabled).toBe(true); expect(document.body.textContent).toContain(text.empty);
  });

  it('16组和8层上限控制新增，不截断原树或减少叶，边界树仍可Apply', async () => {
    const filters = rules(15), initial: FilterGroup = { mode: 'all', children: filters.map((_, index) => ({ mode: 'any', children: [index] })) }, f = await mount(initial, filters);
    expect(button(text.addGroup()).disabled).toBe(true); expect(button(text.addGroup('1')).disabled).toBe(true); await click(text.apply); expect(f.onApply.mock.calls[0][0]).toEqual(initial);
    let deep: FilterGroup = { mode: 'any', children: [0] }; for (let level = 1; level < 8; level++) deep = { mode: 'all', children: [deep] };
    await f.update({ filters: rules(1), initial: deep }, 'deep'); expect(button(text.addGroup('1.1.1.1.1.1.1')).disabled).toBe(true); await click(text.apply); expect(f.onApply.mock.calls.at(-1)?.[0]).toEqual(deep);
  });

  it('非法初始覆盖不被猜成平铺成功，面板只允许取消不调用父Apply', async () => {
    const f = await mount({ mode: 'all', children: [0, 0, 2] }); expect(button(text.apply).disabled).toBe(true); expect(f.onApply).not.toHaveBeenCalled(); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });
});
