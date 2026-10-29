import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CellValue, ResultColumn } from '../../src/shared/contracts';
import { captureQueryResultValueOptions, currentQueryResultValueOptions, queryResultValueOptionsNode } from '../../src/renderer/queryResultValueOptions';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Picker: typeof import('../../src/renderer/components/QueryResultValuePicker')['QueryResultValuePicker'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  const create = document.createElement.bind(document);
  /** 只补标准属性反射；真实 React 与真实候选核心保持原实现，不伪造浏览器布局或系统输入。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    // ReactDOM 的真实 updateOptions 读取标准 options/value/selected；这里只补 HTML 端口，不代替组件筛选。
    if (name === 'select') Object.defineProperties(node, {
      options: { configurable: true, get: () => node.querySelectorAll('option') },
      value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } },
    });
    if (name === 'option') {
      let selected = false, dirty = false;
      Object.defineProperties(node, {
        value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => { node.setAttribute('value', String(value)); } },
        selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; if (selected) { let parent = node.parentNode; while (parent && parent.tagName !== 'SELECT') parent = parent.parentNode; if (parent) for (const option of parent.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } } },
        defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } },
      });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ QueryResultValuePicker: Picker } = await import('../../src/renderer/components/QueryResultValuePicker'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 仅通过父 props 改变可用性；捕获、条件构造及结果扫描使用实际产品核心。 */
async function mount(values: CellValue[] = [null, '', 'NULL', 'one', 'one'], type = 'VARCHAR') {
  const columns: ResultColumn[] = [{ key: 'a', name: '测试列', type }], rows = values.map(a => ({ a })), original = captureQueryResultValueOptions(columns, rows, columns[0]); let capture = original, allowed = true;
  const onApply = vi.fn(), onClose = vi.fn(), outerKey = vi.fn(), isCurrent = vi.fn(() => allowed && currentQueryResultValueOptions(capture, columns, rows));
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = () => root!.render(<div onKeyDown={outerKey}><Picker capture={capture} isCurrent={isCurrent} onApply={onApply} onClose={onClose}/></div>);
  await act(async () => render());
  return { columns, rows, capture: original, onApply, onClose, outerKey, isCurrent, async allowed(value: boolean) { allowed = value; await act(async () => render()); }, async recapture() { capture = captureQueryResultValueOptions(columns, rows, columns[0]); await act(async () => render()); }, async render() { await act(async () => render()); } };
}
/** 普通交互走中文 DOM 与 React 事件委派；保存真实回调只用来投递迟到/重入反例。 */
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function input(label: string = text.search): MemoryNode { const node = document.querySelectorAll('input').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function boxes(): MemoryNode[] { return document.querySelectorAll('input').filter(item => item.type === 'checkbox'); }
function callback(node: MemoryNode, name = 'onClick'): (...args: unknown[]) => unknown { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实 React 事件'); const handler = (Reflect.get(node, key) as Record<string, unknown>)[name]; if (typeof handler !== 'function') throw Error('缺少真实 React 回调'); return handler as (...args: unknown[]) => unknown; }
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function fill(value: string): Promise<void> { const node = input(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); expect(input().value).toBe(value); }
async function check(label: string, value = true): Promise<void> { const node = input(label); expect(node.disabled).toBe(false); await act(async () => { node.checked = value; node.dispatchEvent(new MemoryEvent('click')); }); expect(input(label).checked).toBe(value); }
async function mode(value: string): Promise<void> { const node = document.querySelector('select')!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function key(values: Record<string, unknown>): Promise<MemoryEvent> { const event = Object.assign(new MemoryEvent('keydown'), values); await act(async () => { input().dispatchEvent(event); }); return event; }

describe('已返回不同值选择器真实 React RAM 交互（非原生验收）', () => {
  it('以 region 显示完整计数，NULL、空串、文本 NULL 独立，初始不写入', async () => {
    const f = await mount(); expect(document.querySelector('section')!.getAttribute('role')).toBe('region'); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(boxes().map(node => node.getAttribute('aria-label'))).toEqual([text.nullValue, text.emptyValue, '"NULL"', '"one"']); expect(boxes().every(node => !node.checked)).toBe(true);
    expect(document.body.textContent).toContain(text.counts(5, 4, 4, 0)); expect(document.body.textContent).toContain(text.occurrences(2)); expect(button(text.apply).disabled).toBe(true); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('勾选和切换模式仅改本地草稿；显式写入使用完整 NULL 分组节点', async () => {
    const f = await mount(); await check(text.nullValue); await check('"NULL"'); await mode('exclude'); expect(f.onApply).not.toHaveBeenCalled(); await click(text.apply);
    expect(f.onApply).toHaveBeenCalledOnce(); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, [0, 2], 'exclude')); expect(f.onClose).not.toHaveBeenCalled();
  });
  it('取消不写入，文本逗号换行引号显示为 JSON 且原文完整写入', async () => {
    const value = 'a,b\n"c"', f = await mount([value]); await check(JSON.stringify(value)); await click(text.cancel); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('超过 80 字的省略只用于展示，写入保留完整值', async () => {
    const value = '甲'.repeat(110), f = await mount([value]), label = JSON.stringify(value).slice(0, 80) + text.displayTruncated;
    expect(boxes()[0].getAttribute('aria-label')).toBe(label); await check(label); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, [0], 'include'));
  });
  it('相同80字前缀的长候选有各自完整值提示和只读详情，选值不靠省略文字猜测', async () => {
    const values = ['甲'.repeat(90) + 'A', '甲'.repeat(90) + 'B'], f = await mount(values);
    expect(boxes().map(node => node.getAttribute('title'))).toEqual(values.map(value => JSON.stringify(value)));
    const details = document.querySelectorAll('details').filter(node => node.querySelector('pre') !== null); expect(details).toHaveLength(2);
    expect(details.map(node => node.querySelector('pre')?.textContent)).toEqual(values.map(value => JSON.stringify(value)));
    expect(details.map(node => node.querySelector('summary')?.textContent)).toEqual([text.completeValue(1), text.completeValue(2)]);
    expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
  });
  it('50 项分页不改变完整不同值数量，搜索全选涵盖全部匹配页', async () => {
    const values = Array.from({ length: 120 }, (_, i) => '候选' + i.toString().padStart(3, '0')), f = await mount(values);
    expect(boxes()).toHaveLength(50); expect(document.body.textContent).toContain(text.counts(120, 120, 120, 0)); await click(text.next); expect(boxes()[0].getAttribute('aria-label')).toBe('"候选050"'); await fill('候选0'); await click(text.selectMatches);
    expect(document.body.textContent).toContain(text.counts(120, 120, 100, 100)); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, Array.from({ length: 100 }, (_, i) => i), 'include'));
  });
  it('全选超过 128 种时完整拒绝，保留已有选择而不截前 128', async () => {
    const f = await mount(Array.from({ length: 129 }, (_, i) => 'v' + i)); await check('"v0"'); await click(text.selectMatches);
    expect(document.body.textContent).toContain(text.selection); expect(document.body.textContent).toContain(text.counts(129, 129, 129, 1)); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, [0], 'include'));
  });
  it('跨搜索累积保留既有选值，全选并集超过预算也不能覆盖原集合', async () => {
    const f = await mount(['保留', ...Array.from({ length: 128 }, (_, i) => '匹配' + i)]); await check('"保留"'); await fill('匹配'); await click(text.selectMatches); expect(document.body.textContent).toContain(text.selection); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, [0], 'include'));
  });
  it('逐项增加第 129 个值仍整份拒绝，原 128 个选择保持', async () => {
    const f = await mount([...Array.from({ length: 128 }, (_, i) => '前部' + i), '最后']); await fill('前部'); await click(text.selectMatches); await fill('最后');
    const node = input('"最后"'); await act(async () => { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); }); expect(input('"最后"').checked).toBe(false); expect(document.body.textContent).toContain(text.selection); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, Array.from({ length: 128 }, (_, i) => i), 'include'));
  });
  it('明确勾选 128 项可写入，清空后不能提交空选择', async () => {
    const f = await mount(Array.from({ length: 128 }, (_, i) => 'v' + i)); await click(text.selectMatches); expect(document.body.textContent).toContain(text.counts(128, 128, 128, 128)); await click(text.clear); expect(boxes().every(node => !node.checked)).toBe(true); expect(button(text.apply).disabled).toBe(true); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('搜索失败保留原输入和勾选，不用部分搜索结果替代草稿', async () => {
    const f = await mount(); await check('"one"'); await fill('one'); await act(async () => { callback(input(), 'onChange')({ target: { value: 'x'.repeat(4097) } }); }); expect(input().value).toBe('one'); expect(document.body.textContent).toContain(text.searchBudget); await click(text.apply); expect(f.onApply).toHaveBeenCalledWith(queryResultValueOptionsNode(f.capture, [3], 'include'));
  });
  it('空搜索结果保留隐藏的原选择，清空按钮仍能撤销', async () => {
    const f = await mount(); await check('"one"'); await fill('没有匹配'); expect(boxes()).toHaveLength(0); expect(document.body.textContent).toContain(text.empty); expect(button(text.apply).disabled).toBe(false); await click(text.clear); expect(button(text.apply).disabled).toBe(true); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('父全树预算拒绝时显示真实错误并保留勾选，后续明确按钮可重试', async () => {
    const f = await mount(); await check('"one"'); f.onApply.mockImplementationOnce(() => { throw Error('原条件组超过 32 条，保留原草稿'); }); await click(text.apply); expect(document.body.textContent).toContain('原条件组超过 32 条'); expect(input('"one"').checked).toBe(true); expect(f.onClose).not.toHaveBeenCalled(); await click(text.apply); expect(f.onApply).toHaveBeenCalledTimes(2);
  });
  it('旧输入与旧按钮不能改写后继搜索，搜索 ABA 也不复活旧授权', async () => {
    const f = await mount(); await check('"one"'); const oldInput = callback(input(), 'onChange'), oldApply = callback(button(text.apply)); await fill('one'); await fill(''); await act(async () => { oldInput({ target: { value: 'NULL' } }); oldApply(); }); expect(input().value).toBe(''); expect(f.onApply).not.toHaveBeenCalled(); await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce();
  });
  it('旧复选框不能撤销后继同值选择', async () => {
    const f = await mount(); await check('"one"'); const old = callback(input('"one"'), 'onChange'); await check('"one"', false); await check('"one"'); await act(async () => { old({ target: { checked: false } }); }); expect(input('"one"').checked).toBe(true); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('父租约失效后恢复 true 也不复活旧选择事件', async () => {
    const f = await mount(); await check('"one"'); const old = callback(button(text.apply)); await f.allowed(false); await f.allowed(true); await act(async () => { old(); }); expect(f.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale); expect(button(text.apply).disabled).toBe(true);
  });
  it('失效的选择器仍可取消关闭自己，但不能写入', async () => {
    const f = await mount(); await check('"one"'); await f.allowed(false); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('失效选择器单 Esc 只关闭自己并阻止外层 Esc', async () => {
    const f = await mount(); await f.allowed(false); const event = await key({ key: 'Escape' }); expect(event.cancelBubble).toBe(true); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.outerKey).not.toHaveBeenCalled();
  });
  it('旧取消事件不能关闭后继搜索草稿，当前关闭只消费一次', async () => {
    const f = await mount(), old = callback(button(text.cancel)); await fill('one'); await act(async () => { old(); }); expect(f.onClose).not.toHaveBeenCalled(); const close = callback(button(text.cancel)); await act(async () => { close(); close(); }); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('原结果同引用格值改变再恢复也永久撤销捕获', async () => {
    const f = await mount(); await check('"one"'); f.rows[0].a = 'changed'; await f.render(); f.rows[0].a = null; await f.render(); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.stale); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('事件发现源漂移立即显示失效，不需要父级先重绘', async () => {
    const f = await mount(); await check('"one"'); f.rows[0].a = 'changed'; await act(async () => { callback(button(text.apply))(); }); expect(f.onApply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale); expect(button(text.apply).disabled).toBe(true);
  });
  it('同组件替换捕获不会借用旧勾选写入新源', async () => {
    const f = await mount(); await check('"one"'); await f.recapture(); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.stale); expect(f.onApply).not.toHaveBeenCalled();
  });
  it.each([{ ctrlKey: true }, { metaKey: true }])('Ctrl/Cmd Enter 只写本条草稿并阻止父键盘事件 %j', async modifiers => {
    const f = await mount(); await check('"one"'); const event = await key({ key: 'Enter', ...modifiers }); expect(event.defaultPrevented).toBe(true); expect(event.cancelBubble).toBe(true); expect(f.onApply).toHaveBeenCalledOnce(); expect(f.outerKey).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
  });
  it('单 Esc 只关当前选择器，普通 Enter 不写入', async () => {
    const f = await mount(); await check('"one"'); await key({ key: 'Enter' }); expect(f.onApply).not.toHaveBeenCalled(); f.outerKey.mockClear(); const event = await key({ key: 'Escape' }); expect(event.cancelBubble).toBe(true); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.outerKey).not.toHaveBeenCalled();
  });
  it.each([{ key: 'Enter', ctrlKey: true }, { key: 'Escape' }])('输入法原生组合标识拦截父事件且不写入关闭 %j', async keys => {
    const f = await mount(); await check('"one"'); const event = await key({ ...keys, isComposing: true }); expect(event.cancelBubble).toBe(true); expect(f.outerKey).not.toHaveBeenCalled(); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
  });
  it('组合输入期间禁用按钮但可搜索，结束后明确写入', async () => {
    const f = await mount(); await check('"one"'); await act(async () => { callback(input(), 'onCompositionStart')(); }); await fill('one'); expect(button(text.apply).disabled).toBe(true); await key({ key: 'Enter', ctrlKey: true }); await key({ key: 'Escape' }); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); await act(async () => { callback(input(), 'onCompositionEnd')(); }); await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce();
  });
  it('旧组合结束事件不能解锁后一轮组合', async () => {
    const f = await mount(); await check('"one"'); await act(async () => { callback(input(), 'onCompositionStart')(); }); const old = callback(input(), 'onCompositionEnd'); await act(async () => { old(); }); await act(async () => { callback(input(), 'onCompositionStart')(); }); await act(async () => { old(); }); expect(button(text.apply).disabled).toBe(true); await key({ key: 'Enter', ctrlKey: true }); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('组合期间源失效，真实组合结束后仍能取消自己的选择器', async () => {
    const f = await mount(); await act(async () => { callback(input(), 'onCompositionStart')(); }); await f.allowed(false); expect(button(text.cancel).disabled).toBe(true); await act(async () => { callback(input(), 'onCompositionEnd')(); }); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('父写入同步重入原按钮也只调用一次，已消费旧事件不能再次提交', async () => {
    const f = await mount(); await check('"one"'); const old = callback(button(text.apply)); f.onApply.mockImplementationOnce(() => { old(); }); await act(async () => { old(); old(); }); expect(f.onApply).toHaveBeenCalledOnce();
  });
  it('卸载后保存的输入和按钮不能触发父写入', async () => {
    const f = await mount(); await check('"one"'); const old = callback(button(text.apply)), change = callback(input(), 'onChange'); await act(async () => { root!.unmount(); root = undefined; old(); change({ target: { value: '迟到' } }); }); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
  });
});
