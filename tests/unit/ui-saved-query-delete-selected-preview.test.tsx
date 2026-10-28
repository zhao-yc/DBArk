import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SavedQueryDeleteSelectedPreview, type SavedQueryDeleteSelectedItem } from '../../src/renderer/components/SavedQueryDeleteSelectedPreview';
import { savedQueryDeleteSelectedZh as text } from '../../src/shared/savedQueryDeleteSelected';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
const scrolled = vi.fn();
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    Object.assign(node, { scrollIntoView: scrolled });
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; scrolled.mockClear(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 只生成所需1..101条边界数据，名称可相同但ID与所见摘要各自独立。 */
function items(count = 2): SavedQueryDeleteSelectedItem[] { return Array.from({ length: count }, (_, index) => ({ id: '所选查询-' + index, digest: index.toString(16).padStart(64, '0'), name: '相同名称🚢' })); }
async function mount(selected: readonly SavedQueryDeleteSelectedItem[] = items(), strict = false) {
  const confirm = vi.fn(), cancel = vi.fn(), parentKey = vi.fn(); let props = { items: selected, busy: false };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = () => { const view = <div role="dialog" aria-label="RAM父列表" onKeyDown={parentKey}><SavedQueryDeleteSelectedPreview {...props} onConfirm={confirm} onCancel={cancel}/></div>; root!.render(strict ? <StrictMode>{view}</StrictMode> : view); };
  await act(async () => render());
  return { selected, confirm, cancel, parentKey, async render(patch: Partial<typeof props> = {}) { props = { ...props, ...patch }; await act(async () => render()); } };
}
function group(): MemoryNode { const node = document.querySelector('[role="group"]'); expect(node).not.toBeNull(); return node!; }
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
/** 取得真实React原事件闭包，核过期调用权限；不读取内部state或直接执行删除。 */
function callback(node: MemoryNode, name = 'onClick'): (...args: any[]) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React属性'); const action = Reflect.get(node, key)[name]; if (typeof action !== 'function') throw Error('缺少真实事件：' + name); return action; }
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function key(value: string, extra: Record<string, unknown> = {}): Promise<MemoryEvent> { const event = Object.assign(new MemoryEvent('keydown'), { key: value }, extra); await act(async () => group().dispatchEvent(event)); return event; }

it('完整列出跨页全部100项及重复名称不同ID，默认聚焦取消并滚动预览，不自动删除', async () => {
  const selected = items(100), f = await mount(selected);
  expect(group().getAttribute('aria-label')).toBe(text.title); expect(document.body.textContent).toContain(text.hint);
  expect(group().querySelectorAll('li')).toHaveLength(100); expect(group().querySelectorAll('span').filter(node => node.textContent === '相同名称🚢')).toHaveLength(100);
  expect(group().querySelectorAll('code').map(node => node.textContent)).toEqual(selected.map(item => item.id));
  expect(document.activeElement).toBe(button(text.cancel)); expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' }); expect(button(text.confirm(100)).disabled).toBe(false); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
});
it('只确认按钮明确提交，Enter不是默认删除且不取消原生按钮激活行为', async () => {
  const f = await mount(); const event = await key('Enter'); expect(event.defaultPrevented).toBe(false); expect(f.confirm).not.toHaveBeenCalled();
  await click(text.confirm(2)); expect(f.confirm).toHaveBeenCalledExactlyOnceWith(); expect(f.cancel).not.toHaveBeenCalled();
});
it.each([0, 101])('%i条不产生可提交预览，仍可明确取消', async count => {
  const f = await mount(items(count)); expect(button(text.confirm(0)).disabled).toBe(true); expect(document.body.textContent).toContain(text.invalid);
  await act(async () => callback(button(text.confirm(0)))()); expect(f.confirm).not.toHaveBeenCalled(); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce();
});
it('重复ID即使摘要/名称不同也拒绝，不静默去重或只展示部分选择', async () => {
  const selected = items(); selected[1] = { ...selected[1], id: selected[0].id, name: '另一名称' }; const f = await mount(selected);
  expect(group().querySelectorAll('li')).toHaveLength(0); expect(button(text.confirm(0)).disabled).toBe(true); expect(document.body.textContent).toContain(text.invalid); expect(f.confirm).not.toHaveBeenCalled();
});
it('只将旧名称作为纯文本展示，控制字符/孤立字符及SQL或HTML外观不套重命名校验', async () => {
  const selected = items(); selected[0] = { ...selected[0], name: '旧\u0000名\ud800 <script>DELETE FROM q</script>' }; const f = await mount(selected);
  expect(group().querySelectorAll('li')).toHaveLength(2); expect(group().querySelectorAll('span')[0].textContent).toBe(selected[0].name); expect(group().querySelectorAll('script')).toHaveLength(0);
  await click(text.confirm(2)); expect(f.confirm).toHaveBeenCalledOnce();
});
it.each(['名称getter', 'IDgetter', '摘要getter', '数组getter', '稀疏数组', '附加数组属性', '自有迭代器', '陌生对象原型', '额外字段', '非字符串名称', '空名称', '超长名称', '坏摘要'])('%s拒绝且不调用访问器或迭代器', async fault => {
  const selected = items(), read = vi.fn(() => '不该读取'); let value: readonly SavedQueryDeleteSelectedItem[] = selected;
  if (fault === '名称getter' || fault === 'IDgetter' || fault === '摘要getter') Object.defineProperty(selected[0], fault === '名称getter' ? 'name' : fault === 'IDgetter' ? 'id' : 'digest', { enumerable: true, get: read });
  if (fault === '数组getter') Object.defineProperty(selected, '0', { enumerable: true, get: read });
  if (fault === '稀疏数组') value = new Array(2);
  if (fault === '附加数组属性') Reflect.set(selected, 'extra', true);
  if (fault === '自有迭代器') Object.defineProperty(selected, Symbol.iterator, { value: read });
  if (fault === '陌生对象原型') Object.setPrototypeOf(selected[0], { unexpected: true });
  if (fault === '额外字段') Reflect.set(selected[0], 'sql', '不展示也不执行');
  if (fault === '非字符串名称') Reflect.set(selected[0], 'name', 1);
  if (fault === '空名称') Reflect.set(selected[0], 'name', '');
  if (fault === '超长名称') Reflect.set(selected[0], 'name', 'a'.repeat(257));
  if (fault === '坏摘要') Reflect.set(selected[0], 'digest', 'unknown');
  const f = await mount(value); expect(button(text.confirm(0)).disabled).toBe(true); expect(read).not.toHaveBeenCalled(); expect(f.confirm).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.invalid);
});
it('同栈双击只提交一次，原取消和确认旧闭包不能再消费已提交预览', async () => {
  const f = await mount(), confirm = callback(button(text.confirm(2))), cancel = callback(button(text.cancel));
  await act(async () => { confirm(); confirm(); cancel(); }); expect(f.confirm).toHaveBeenCalledExactlyOnceWith(); expect(f.cancel).not.toHaveBeenCalled(); expect(button(text.confirm(2)).disabled).toBe(true); expect(button(text.cancel).disabled).toBe(true);
});
it('busy禁确认/禁取消，旧回调拒绝；忙态ABA只允许新渲染的明确按钮', async () => {
  const f = await mount(), confirm = callback(button(text.confirm(2))), cancel = callback(button(text.cancel));
  await f.render({ busy: true }); expect(button(text.confirm(2)).disabled).toBe(true); expect(button(text.cancel).disabled).toBe(true);
  await act(async () => { confirm(); cancel(); }); await key('Escape'); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(f.parentKey).not.toHaveBeenCalled();
  await f.render({ busy: false }); await act(async () => { confirm(); cancel(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); await click(text.confirm(2)); expect(f.confirm).toHaveBeenCalledOnce();
});
it.each(['新数组同字段', '顺序ABA', '元素对象替换', 'id', 'digest', 'name'] as const)('所选%s变化再恢复，旧来源预览永久撤销且完整原名称快照不被覆盖', async fault => {
  const selected = items(), f = await mount(selected), confirm = callback(button(text.confirm(2))), cancel = callback(button(text.cancel)), original = selected[0];
  if (fault === '新数组同字段') { await f.render({ items: [...selected] }); await f.render({ items: selected }); }
  else if (fault === '顺序ABA') { selected.reverse(); await f.render(); selected.reverse(); await f.render(); }
  else if (fault === '元素对象替换') { selected[0] = { ...original }; await f.render(); selected[0] = original; await f.render(); }
  else { const old = original[fault]; Reflect.set(original, fault, fault === 'digest' ? 'f'.repeat(64) : '外来字段值'); await f.render(); Reflect.set(original, fault, old); await f.render(); }
  await act(async () => { confirm(); cancel(); callback(button(text.confirm(2)))(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale); expect(button(text.confirm(2)).disabled).toBe(true);
  expect(group().querySelectorAll('code').map(node => node.textContent)).toEqual(['所选查询-0', '所选查询-1']);
});
it('无需等新渲染也会发现原地字段漂移，旧确认不能删除改变的选择', async () => {
  const selected = items(), f = await mount(selected), confirm = callback(button(text.confirm(2))); Reflect.set(selected[0], 'digest', 'f'.repeat(64));
  await act(async () => confirm()); expect(f.confirm).not.toHaveBeenCalled(); Reflect.set(selected[0], 'digest', '0'.repeat(64)); await f.render(); expect(button(text.confirm(2)).disabled).toBe(true);
});
it('Escape仅取消本组件并停止冒泡，不把独立RAM事件视作父Modal捕获验收', async () => {
  const f = await mount(), confirm = callback(button(text.confirm(2))), event = await key('Escape'); expect(event.defaultPrevented).toBe(true); expect(event.cancelBubble).toBe(true);
  expect(f.cancel).toHaveBeenCalledOnce(); expect(f.parentKey).not.toHaveBeenCalled(); await act(async () => confirm()); expect(f.confirm).not.toHaveBeenCalled();
});
it('真实组合开始至结束、原生组合标志及229期间Escape不取消，结束后可明确取消', async () => {
  const f = await mount(); await act(async () => callback(group(), 'onCompositionStart')()); const composingEscape = await key('Escape'); expect(composingEscape.defaultPrevented).toBe(false); expect(f.cancel).not.toHaveBeenCalled();
  await act(async () => callback(group(), 'onCompositionEnd')()); await key('Escape', { isComposing: true }); await key('Escape', { keyCode: 229 }); expect(f.cancel).not.toHaveBeenCalled(); expect(f.parentKey).not.toHaveBeenCalled();
  // RAM显式结束React的229回退组合，不以仍在组合中的Enter/Escape冒称明确动作。
  await act(async () => group().dispatchEvent(Object.assign(new MemoryEvent('keyup'), { key: 'Enter', keyCode: 13 })));
  await key('Escape'); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.confirm).not.toHaveBeenCalled();
});
it('StrictMode和卸载保留准确提交票据，旧确认/取消/组合事件不能触及后继实例', async () => {
  const f = await mount(items(), true), confirm = callback(button(text.confirm(2))), cancel = callback(button(text.cancel)), compose = callback(group(), 'onCompositionStart');
  await act(async () => root!.unmount()); root = undefined; const next = await mount(items()); await act(async () => { compose(); confirm(); cancel(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(next.confirm).not.toHaveBeenCalled(); expect(next.cancel).not.toHaveBeenCalled();
  await click(text.confirm(2)); expect(next.confirm).toHaveBeenCalledOnce();
});
