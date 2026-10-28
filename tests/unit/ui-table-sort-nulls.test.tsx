import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { SortRule } from '../../src/shared/contracts';
import { TableSortPanel } from '../../src/renderer/components/TableSortPanel';
import { tableSortZh as text } from '../../src/renderer/locales/tableSort.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  doc = memoryDocument(); const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'value' && name === 'option') node.value = String(value); };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 只接RAM父回调，正式排序组件和React事件保持；不把此端口当浏览器或数据库验收。 */
async function mount(initial: SortRule[] = [{ column: 'note', direction: 'ASC', nulls: 'LAST' }]) {
  const apply = vi.fn(() => true), close = vi.fn(); let current = true;
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<TableSortPanel columns={['id', 'note', 'amount']} initial={initial} isCurrent={() => current} onApply={apply} onClose={close}/>));
  return { apply, close, current(value: boolean) { current = value; } };
}
function button(label: string) { const node = doc.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function choose(label: string, value: string) { const node = doc.querySelector(`select[aria-label="${label}"]`); expect(node).not.toBeNull(); await act(async () => { node!.value = value; node!.dispatchEvent(new MemoryEvent('change')); }); }
/** 读取React真实旧闭包，核准入票据；不替代组件实现。 */
function callback(node: any) { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('真实React属性不存在'); return node[key].onClick as () => void; }

it('明确NULL位置只编辑草稿，应用才发送；方向改变保留同列位置', async () => {
  const f = await mount(); expect(doc.body.textContent).toContain(text.nullsDefault); expect(doc.body.textContent).toContain(text.nullsFirst); expect(doc.body.textContent).toContain(text.nullsLast);
  await choose(text.nulls(1), 'FIRST'); await choose(text.direction(1), 'DESC'); expect(f.apply).not.toHaveBeenCalled(); await click(text.apply);
  expect(f.apply).toHaveBeenCalledExactlyOnceWith([{ column: 'note', direction: 'DESC', nulls: 'FIRST' }]);
});
it('恢复默认删除可选属性，旧两字段排序形状保持', async () => {
  const f = await mount(); await choose(text.nulls(1), 'DEFAULT'); await click(text.apply); expect(f.apply).toHaveBeenCalledExactlyOnceWith([{ column: 'note', direction: 'ASC' }]);
});
it('优先级移动保留每列独立位置，新增列缺省，父规则保持', async () => {
  const original: SortRule[] = [{ column: 'note', direction: 'DESC', nulls: 'LAST' }, { column: 'amount', direction: 'ASC', nulls: 'FIRST' }], f = await mount(original);
  await click(text.earlier(2)); await click(text.add); await click(text.apply);
  expect(f.apply).toHaveBeenCalledExactlyOnceWith([{ column: 'amount', direction: 'ASC', nulls: 'FIRST' }, { column: 'note', direction: 'DESC', nulls: 'LAST' }, { column: 'id', direction: 'ASC' }]); expect(original[0].column).toBe('note');
});
it('取消NULL草稿零应用', async () => {
  const f = await mount(); await choose(text.nulls(1), 'FIRST'); await click(text.cancel); expect(f.close).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled();
});
it('父草稿门拒绝保留本轮编辑供明确重试', async () => {
  const f = await mount(); await choose(text.nulls(1), 'FIRST');
  f.apply.mockReturnValueOnce(false); await click(text.apply); expect(doc.body.textContent).toContain(text.declined); expect(f.apply).toHaveBeenCalledTimes(1); await click(text.apply); expect(f.apply).toHaveBeenLastCalledWith([{ column: 'note', direction: 'ASC', nulls: 'FIRST' }]); expect(f.apply).toHaveBeenCalledTimes(2);
});
it('失效来源恢复后旧确认不复活，同栈双击仅交付一次', async () => {
  const f = await mount(), old = callback(button(text.apply)); await choose(text.nulls(1), 'FIRST'); await act(async () => old()); expect(f.apply).not.toHaveBeenCalled();
  f.current(false); await click(text.apply); f.current(true); await act(async () => callback(button(text.apply))()); expect(f.apply).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.stale);
});
it('当前明确确认的同栈双击只触发一次父读取', async () => {
  const f = await mount(), confirm = callback(button(text.apply)); await act(async () => { confirm(); confirm(); }); expect(f.apply).toHaveBeenCalledOnce();
});
