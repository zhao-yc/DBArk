import { act, StrictMode } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SavedQueryRenameEditor, type SavedQueryRenameOrigin } from '../../src/renderer/components/SavedQueryRenameEditor';
import { savedQueryRenameZh as text } from '../../src/shared/savedQueryRename';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 只建立原名称/摘要与回调；名称合法性始终由真实共享schema和组件处理。 */
async function mount(strict = false) {
  const origin: SavedQueryRenameOrigin = { id: '原查询', digest: 'a'.repeat(64), name: '原始名称' }, confirm = vi.fn(), cancel = vi.fn(), parentKey = vi.fn();
  let current = { origin, busy: false }; const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = () => {
    const view = <div role="dialog" aria-label="原父列表" onKeyDown={parentKey}><SavedQueryRenameEditor {...current} onConfirm={confirm} onCancel={cancel}/></div>;
    root!.render(strict ? <StrictMode>{view}</StrictMode> : view);
  };
  await act(async () => render());
  return { origin, confirm, cancel, parentKey, async render(patch: Partial<typeof current>) { current = { ...current, ...patch }; await act(async () => render()); } };
}
function input(): MemoryNode { const node = document.querySelector('[aria-label="' + text.newName + '"]'); expect(node).not.toBeNull(); return node!; }
function group(): MemoryNode { const node = document.querySelector('[role="group"]'); expect(node).not.toBeNull(); return node!; }
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
/** 捕获真实React原闭包验证过期权限，不仿写业务处理器或修改组件内部草稿。 */
function callback(node: MemoryNode, name: string): (...args: any[]) => void { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React属性'); const handler = Reflect.get(node, key)[name]; if (typeof handler !== 'function') throw Error('缺少真实事件：' + name); return handler; }
async function rename(value: string): Promise<void> { const node = input(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function key(value: string, extra: Record<string, unknown> = {}): Promise<MemoryEvent> { const event = Object.assign(new MemoryEvent('keydown'), { key: value }, extra); await act(async () => input().dispatchEvent(event)); return event; }

it('显示原名及准确输入合同，原名不变不提交；Unicode与首尾空白原样提交', async () => {
  const f = await mount(); expect(group().getAttribute('aria-label')).toBe(text.rename); expect(document.body.textContent).toContain(f.origin.name); expect(document.body.textContent).toContain(text.hint); expect(input().getAttribute('maxLength') ?? input().getAttribute('maxlength')).toBe('256');
  expect(input().value).toBe(f.origin.name); expect(button(text.confirm).disabled).toBe(true); await key('Enter'); expect(f.confirm).not.toHaveBeenCalled();
  const name = '  财务🚢 e\u0301 中文  '; await rename(name); await click(text.confirm); expect(f.confirm).toHaveBeenCalledExactlyOnceWith(name); expect(f.cancel).not.toHaveBeenCalled();
});
it.each(['', ' ', '\t', '名\n称', '名\u0000称', '名\u007f称', '名\u0085称', '\ud800', '\udfff', 'a'.repeat(257)])('非法名称不能确认且显示统一说明：%j', async name => {
  const f = await mount(); await rename(name); expect(button(text.confirm).disabled).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toBe(text.invalidName);
  await key('Enter'); await act(async () => callback(button(text.confirm), 'onClick')()); expect(f.confirm).not.toHaveBeenCalled();
});
it.each(['a'.repeat(256), '🚢'.repeat(128)])('允许256个UTF16单元边界且不截断名称', async name => { const f = await mount(); await rename(name); expect(input().value).toBe(name); await key('Enter'); expect(f.confirm).toHaveBeenCalledExactlyOnceWith(name); });
it('不进行同名查重，不同来源ID可明确提交相同名称', async () => {
  const f = await mount(); await rename('已有同名查询'); await click(text.confirm); expect(f.confirm).toHaveBeenCalledExactlyOnceWith('已有同名查询'); expect(document.querySelectorAll('input')).toHaveLength(1);
});
it('同栈双击仅提交一次，提交后的旧修改与取消均被拒绝', async () => {
  const f = await mount(); await rename('新名称'); const confirm = callback(button(text.confirm), 'onClick'), cancel = callback(button(text.cancel), 'onClick'), change = callback(input(), 'onChange');
  await act(async () => { confirm(); confirm(); change({ target: { value: '迟到名称' } }); cancel(); });
  expect(f.confirm).toHaveBeenCalledExactlyOnceWith('新名称'); expect(f.cancel).not.toHaveBeenCalled(); expect(input().value).toBe('新名称'); expect(input().disabled).toBe(true);
});
it('busy禁改/禁确认/禁取消，旧事件拒绝；解除busy只允许新渲染事件', async () => {
  const f = await mount(); await rename('新名称'); const change = callback(input(), 'onChange'), confirm = callback(button(text.confirm), 'onClick'), cancel = callback(button(text.cancel), 'onClick');
  await f.render({ busy: true }); expect(input().disabled).toBe(true); expect(button(text.confirm).disabled).toBe(true); expect(button(text.cancel).disabled).toBe(true);
  await act(async () => { change({ target: { value: '不允许变化' } }); confirm(); cancel(); }); await key('Escape'); expect(f.cancel).not.toHaveBeenCalled(); expect(f.parentKey).not.toHaveBeenCalled();
  await f.render({ busy: false }); await act(async () => { confirm(); cancel(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(input().value).toBe('新名称');
  await click(text.confirm); expect(f.confirm).toHaveBeenCalledExactlyOnceWith('新名称');
});
it.each(['id', 'digest', 'name', '对象'] as const)('origin的%s变化并恢复旧props仍永久撤销旧草稿及全部旧闭包', async field => {
  const f = await mount(); await rename('候选名称'); const confirm = callback(button(text.confirm), 'onClick'), cancel = callback(button(text.cancel), 'onClick'), change = callback(input(), 'onChange');
  const next = { ...f.origin, ...(field === 'id' ? { id: '另一查询' } : field === 'digest' ? { digest: 'b'.repeat(64) } : field === 'name' ? { name: '外来名称' } : {}) };
  await f.render({ origin: next }); await f.render({ origin: f.origin });
  await act(async () => { change({ target: { value: '旧输入穿透' } }); confirm(); cancel(); });
  expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(input().value).toBe('候选名称'); expect(input().disabled).toBe(true); expect(document.body.textContent).toContain(text.stale);
});
it('同origin对象字段原地漂移后恢复也永久失效，不共享原始名称快照', async () => {
  const f = await mount(); await rename('候选名称'); const original = f.origin.name;
  Reflect.set(f.origin, 'name', '原地更名'); await f.render({ origin: f.origin }); Reflect.set(f.origin, 'name', original); await f.render({ origin: f.origin });
  await act(async () => callback(button(text.confirm), 'onClick')()); expect(f.confirm).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale);
});
it('草稿A→B→A后旧确认与取消不能复活，当前确认仍可提交', async () => {
  const f = await mount(); await rename('A'); const old = callback(button(text.confirm), 'onClick'), oldCancel = callback(button(text.cancel), 'onClick');
  await rename('B'); await rename('A'); await act(async () => { old(); oldCancel(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  await click(text.confirm); expect(f.confirm).toHaveBeenCalledExactlyOnceWith('A');
});
it('每次输入同步消费旧草稿，React尚未提交时旧确认也无权提交旧名称', async () => {
  const f = await mount(); await rename('A'); const confirm = callback(button(text.confirm), 'onClick'), change = callback(input(), 'onChange');
  await act(async () => { change({ target: { value: 'B' } }); confirm(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(input().value).toBe('B'); await click(text.confirm); expect(f.confirm).toHaveBeenCalledExactlyOnceWith('B');
});
it('IME组合阻止按钮和Enter；原生组合标记/229也拒绝，结束后新Enter仅提交一次', async () => {
  const f = await mount(); await rename('组合名称'); const start = callback(input(), 'onCompositionStart'), confirm = callback(button(text.confirm), 'onClick');
  await act(async () => { start(); confirm(); }); expect(button(text.confirm).disabled).toBe(true); await key('Enter'); expect(f.confirm).not.toHaveBeenCalled();
  await key('Escape', { isComposing: true }); expect(f.cancel).not.toHaveBeenCalled();
  await act(async () => callback(input(), 'onCompositionEnd')()); await key('Enter', { isComposing: true }); await key('Enter', { keyCode: 229 }); expect(f.confirm).not.toHaveBeenCalled();
  // 无原生CompositionEvent的RAM使用React回退：229开始组合，真实Enter keyup(13)才结束，不能省略后假定已结束。
  await act(async () => input().dispatchEvent(Object.assign(new MemoryEvent('keyup'), { key: 'Enter', keyCode: 13, which: 13 })));
  await key('Enter'); expect(f.confirm).toHaveBeenCalledExactlyOnceWith('组合名称'); expect(f.parentKey).not.toHaveBeenCalled();
});
it('Escape只取消原内联编辑并停止冒泡，双Escape与旧确认均不能关闭父层或提交', async () => {
  const f = await mount(); await rename('将取消'); const confirm = callback(button(text.confirm), 'onClick'), cancel = callback(button(text.cancel), 'onClick'), event = await key('Escape');
  expect(event.defaultPrevented).toBe(true); expect(event.cancelBubble).toBe(true); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.parentKey).not.toHaveBeenCalled();
  await act(async () => { cancel(); confirm(); }); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.confirm).not.toHaveBeenCalled();
});
it('StrictMode原提交票据正常可用，卸载后的真实旧回调全部失效', async () => {
  const f = await mount(true); await rename('卸载候选'); const change = callback(input(), 'onChange'), confirm = callback(button(text.confirm), 'onClick'), cancel = callback(button(text.cancel), 'onClick');
  await act(async () => root!.unmount()); root = undefined; await act(async () => { change({ target: { value: '迟到输入' } }); confirm(); cancel(); }); expect(f.confirm).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
});
