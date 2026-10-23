import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CellValue, TableInfo } from '../../src/shared/contracts';
import type { TableValueOptionsOutput } from '../../src/shared/tableValueOptions';
import type { TableValueOptionsConditions } from '../../src/renderer/tableValueOptionsUi';
import type { TableValueOptionsDialogProps, TableValueOptionsServices } from '../../src/renderer/components/TableValueOptionsDialog';
import { tableValueOptionsZh as text } from '../../src/renderer/locales/tableValueOptions.zh-CN';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableValueOptionsDialog')['TableValueOptionsDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true });
  const create = document.createElement.bind(document);
  /** 只补标准HTML属性端口；组件、React状态、任务Promise与条件核心均使用真实产品实现。 */
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') node.type = 'text';
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperties(node, {
      options: { configurable: true, get: () => node.querySelectorAll('option') },
      value: { configurable: true, get: () => node.querySelectorAll('option').find(option => Reflect.get(option, 'selected') === true)?.value ?? '', set: (value: string) => { let matched = false; for (const option of node.querySelectorAll('option')) { const selected = !matched && option.value === String(value); Reflect.set(option, 'selected', selected); if (selected) matched = true; } } },
    });
    if (name === 'option') {
      let selected = false, dirty = false;
      Object.defineProperties(node, {
        value: { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: (value: string) => node.setAttribute('value', String(value)) },
        selected: { configurable: true, get: () => dirty ? selected : node.getAttribute('selected') !== null, set: (value: boolean) => { selected = Boolean(value); dirty = true; if (selected) { let parent = node.parentNode; while (parent && parent.tagName !== 'SELECT') parent = parent.parentNode; if (parent) for (const option of parent.querySelectorAll('option')) if (option !== node) Reflect.set(option, 'selected', false); } } },
        defaultSelected: { configurable: true, get: () => node.getAttribute('selected') !== null, set: (value: boolean) => { if (value) node.setAttribute('selected', ''); else node.removeAttribute('selected'); } },
      });
    }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ TableValueOptionsDialog: Dialog } = await import('../../src/renderer/components/TableValueOptionsDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

const source = (): TableInfo => ({ database: 'db', name: 't', objectKind: 'table', engine: 'InnoDB', ddl: 'CREATE TABLE t(a TEXT, b DOUBLE, bits BIT)', columns: [
  { name: 'a', type: 'TEXT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' },
  { name: 'b', type: 'DOUBLE', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' },
  { name: 'bits', type: 'BIT', nullable: true, generated: false, defaultValue: null, extra: '', comment: '' },
], indexes: [], foreignKeys: [], primaryKey: [], editableKey: [] });
/** 原任务由deferred显式结算；取消ACK与任务终结分别控制，不能伪造成原生验收。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(values: CellValue[] = [null, '', 'NULL', 'one'], override?: Partial<TableValueOptionsServices>) {
  const info = source(), conditions: TableValueOptionsConditions = { filters: [{ column: 'a', operator: '!=', value: 'old', enabled: false }], filterMode: 'any' }; let allowed = true;
  const result = (input: { column: string; searchPattern?: string }): TableValueOptionsOutput => ({ source: structuredClone(info), sourceDigest: 'a'.repeat(64), column: input.column, ...(input.searchPattern ? { searchPattern: input.searchPattern } : {}), values: values.map(value => ({ value, count: '9007199254740993' })), truncated: false, warnings: ['服务器字段排序规则分组'] });
  const read = vi.fn(async (input: Parameters<TableValueOptionsServices['read']>[0]) => result(input)), cancel = vi.fn(async () => undefined), onApply = vi.fn((_conditions: TableValueOptionsConditions) => true), onClose = vi.fn(), onCleanupError = vi.fn(), onActivity = vi.fn(), isCurrent = vi.fn(() => allowed);
  let props: TableValueOptionsDialogProps = { target: { connectionId: 'c', database: 'db', table: 't' }, source: info, column: 'a', conditions, services: { read, cancel, ...override }, isCurrent, onApply, onClose, onCleanupError, onActivity };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  const render = () => root!.render(<Dialog {...props}/>); await act(async () => render());
  return { info, conditions, read, cancel, onApply, onClose, onCleanupError, onActivity, isCurrent, result, async allowed(value: boolean) { allowed = value; await act(async () => render()); }, async props(value: Partial<TableValueOptionsDialogProps>) { props = { ...props, ...value }; await act(async () => render()); }, async render() { await act(async () => render()); } };
}
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function input(label: string = text.search): MemoryNode { const node = document.querySelectorAll('input').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function select(label: string): MemoryNode { const node = document.querySelectorAll('select').find(item => item.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
function boxes(): MemoryNode[] { return document.querySelectorAll('input').filter(item => item.type === 'checkbox'); }
function callback(node: MemoryNode, name = 'onClick'): (...args: unknown[]) => unknown { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); const handler = (Reflect.get(node, key) as Record<string, unknown>)[name]; if (typeof handler !== 'function') throw Error('缺少真实回调'); return handler as (...args: unknown[]) => unknown; }
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function fill(value: string): Promise<void> { const node = input(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function check(label: string, checked = true): Promise<void> { const node = input(label); expect(node.disabled).toBe(false); await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function mode(value: string, label: string = text.mode): Promise<void> { const node = select(label); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }

describe('表页服务器不同值真实React RAM交互（非原生验收）', () => {
  it('初始不查询，输入模式与选列不自动查询，未证明类型禁选', async () => { const f = await mount(); expect(f.read).not.toHaveBeenCalled(); await fill('a%'); await mode('b', text.column); expect(f.read).not.toHaveBeenCalled(); expect(select(text.column).querySelectorAll('option').find(option => option.value === 'bits')!.disabled).toBe(true); expect(button(text.apply).disabled).toBe(true); });
  it('显式读取冻结原筛选，NULL空串和文本NULL独立，计数保留完整大整数', async () => { const f = await mount(); await click(text.read); expect(f.read).toHaveBeenCalledOnce(); expect(f.read.mock.calls[0][0]).toMatchObject({ connectionId: 'c', database: 'db', table: 't', column: 'a', filters: f.conditions.filters, filterMode: 'any' }); expect(boxes().map(node => node.getAttribute('aria-label'))).toEqual([text.value(null), text.value(''), text.value('NULL'), text.value('one')]); expect(document.body.textContent).toContain('9007199254740993 行'); expect(f.onApply).not.toHaveBeenCalled(); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]); });
  it('混合NULL排除与原OR完整组合，父接受后才关闭', async () => { const f = await mount(); await click(text.read); await check(text.value(null)); await check(text.value('one')); await mode('exclude'); await click(text.apply); expect(f.onApply).toHaveBeenCalledOnce(); const proposal = f.onApply.mock.calls[0][0] as unknown as TableValueOptionsConditions; expect(proposal.filters).toEqual([...f.conditions.filters, { column: 'a', operator: 'NOT IN', values: ['one'] }, { column: 'a', operator: 'IS NOT NULL' }]); expect(proposal.filterGroup).toEqual({ mode: 'all', children: [{ mode: 'any', children: [0] }, 1, 2] }); expect(f.onClose).toHaveBeenCalledOnce(); });
  it('父拒绝保留勾选和完整规则，后续显式重试', async () => { const f = await mount(); f.onApply.mockReturnValueOnce(false); await click(text.read); await check(text.value('one')); await click(text.apply); expect(input(text.value('one')).checked).toBe(true); expect(f.onClose).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.rejected); await click(text.apply); expect(f.onApply).toHaveBeenCalledTimes(2); expect(f.onClose).toHaveBeenCalledOnce(); });
  it('父抛错保留勾选不关闭', async () => { const f = await mount(); f.onApply.mockImplementationOnce(() => { throw Error('父页已有修改'); }); await click(text.read); await check(text.value('one')); await click(text.apply); expect(input(text.value('one')).checked).toBe(true); expect(document.body.textContent).toContain('父页已有修改'); expect(f.onClose).not.toHaveBeenCalled(); });
  it('搜索修改保留旧候选但不可应用，搜索ABA仍需重新读取', async () => { const f = await mount(); await click(text.read); await check(text.value('one')); await fill('%one%'); expect(button(text.apply).disabled).toBe(true); expect(input(text.value('one')).checked).toBe(true); await fill(''); expect(button(text.apply).disabled).toBe(true); expect(f.read).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.searchPending); });
  it('重读先确认丢弃，保留选择不会查询；确认后才清空并读取', async () => { const f = await mount(['one']); await click(text.read); await check(text.value('one')); await fill('%'); await click(text.refresh); expect(f.read).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.discardRead); await click(text.keep); expect(input(text.value('one')).checked).toBe(true); await click(text.refresh); await click(text.confirmRead); expect(f.read).toHaveBeenCalledTimes(2); expect(f.read.mock.calls[1][0].searchPattern).toBe('%'); expect(input(text.value('one')).checked).toBe(false); });
  it('关闭丢弃确认期间不修改父条件，取消确认继续原选择', async () => { const f = await mount(); await click(text.read); await check(text.value('one')); await click(text.close); expect(f.onClose).not.toHaveBeenCalled(); await click(text.keep); expect(input(text.value('one')).checked).toBe(true); await click(text.close); await click(text.confirmClose); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled(); });
  it('51候选分页50+1，选择隐藏页仍保留', async () => { const f = await mount(Array.from({ length: 51 }, (_, i) => 'v' + i)); await click(text.read); expect(boxes()).toHaveLength(50); await check(text.value('v0')); await click(text.next); expect(boxes()).toHaveLength(1); await check(text.value('v50')); await click(text.apply); const proposal = f.onApply.mock.calls[0][0] as unknown as TableValueOptionsConditions; expect(proposal.filters.at(-1)!.values).toEqual(['v0', 'v50']); });
  it('全选超过200整份拒绝，不截断原已选集合', async () => { const f = await mount(Array.from({ length: 201 }, (_, i) => 'v' + i)); await click(text.read); await check(text.value('v0')); await click(text.selectAll); expect(document.body.textContent).toContain(text.selection); expect(input(text.value('v0')).checked).toBe(true); await click(text.apply); const proposal = f.onApply.mock.calls[0][0] as unknown as TableValueOptionsConditions; expect(proposal.filters.at(-1)!.values).toEqual(['v0']); });
  it('空回包不提供空集合应用，重新读取仍显式可用', async () => { const f = await mount([]); await click(text.read); expect(document.body.textContent).toContain(text.empty); expect(button(text.apply).disabled).toBe(true); expect(button(text.refresh).disabled).toBe(false); expect(f.onApply).not.toHaveBeenCalled(); });
  it('多行逗号引号完整原值写入，长值详情可核对尾部', async () => { const value = '逗号,\r\n"引号"' + 'a'.repeat(90) + '尾部', f = await mount([value]); await click(text.read); expect(document.querySelector('pre')!.textContent).toBe(text.value(value)); await act(async () => { boxes()[0].checked = true; boxes()[0].dispatchEvent(new MemoryEvent('click')); }); await click(text.apply); const proposal = f.onApply.mock.calls[0][0] as unknown as TableValueOptionsConditions; expect(proposal.filters.at(-1)!.values).toEqual([value]); });
  it('超过筛选值预算应用失败，完整原值与原勾选仍保留', async () => { const value = 'x'.repeat(4097), f = await mount([value]); await click(text.read); await act(async () => { boxes()[0].checked = true; boxes()[0].dispatchEvent(new MemoryEvent('click')); }); await click(text.apply); expect(document.body.textContent).toContain(text.budget); expect(boxes()[0].checked).toBe(true); expect(f.onApply).not.toHaveBeenCalled(); });
  it('源元数据或回包列不符拒绝发布，不能用成功状态骗过准入', async () => { const f = await mount(); f.read.mockImplementationOnce(async input => { const result = f.result(input); result.source.columns[0].comment = 'changed'; return result; }); await click(text.read); expect(boxes()).toHaveLength(0); expect(document.body.textContent).toContain(text.mismatch); });
  it('旧输入和旧读取按钮在搜索ABA后均失效', async () => { const f = await mount(), oldInput = callback(input(), 'onChange'), oldRead = callback(button(text.read)); await fill('a'); await fill(''); await act(async () => { oldInput({ target: { value: 'late' } }); oldRead(); }); expect(input().value).toBe(''); expect(f.read).not.toHaveBeenCalled(); await click(text.read); expect(f.read).toHaveBeenCalledOnce(); });
  it('旧勾选与旧应用不能使用后继草稿', async () => { const f = await mount(); await click(text.read); await check(text.value('one')); const old = callback(button(text.apply)), oldBox = callback(input(text.value('one')), 'onChange'); await mode('exclude'); await mode('include'); await act(async () => { oldBox({ target: { checked: false } }); old(); }); expect(input(text.value('one')).checked).toBe(true); expect(f.onApply).not.toHaveBeenCalled(); });
  it('源曾失效即永久撤销，恢复true不复活旧按钮', async () => { const f = await mount(); await click(text.read); await check(text.value('one')); await f.allowed(false); await f.allowed(true); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.stale); expect(f.onApply).not.toHaveBeenCalled(); });
  it('同组件换源不能借用原勾选，失效仍能确认关闭', async () => { const f = await mount(); await click(text.read); await check(text.value('one')); await f.props({ source: structuredClone(f.info) }); expect(button(text.apply).disabled).toBe(true); await click(text.close); await click(text.confirmClose); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled(); });
  it('取消ACK不解锁原任务，原任务终结后才可重读', async () => { const pending = deferred<TableValueOptionsOutput>(), cancelAck = deferred<unknown>(); const f = await mount(['one'], { read: vi.fn(() => pending.promise), cancel: vi.fn(() => cancelAck.promise) }); await click(text.read); await click(text.cancelTask); await act(async () => cancelAck.resolve(undefined)); expect(button(text.read).disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1]]); await act(async () => pending.resolve(f.result({ column: 'a' }))); expect(boxes()).toHaveLength(0); expect(button(text.read).disabled).toBe(false); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]); });
  it('原读取先终结而取消ACK仍待结算，不能重读且父占用不提前释放', async () => {
    const pending = deferred<TableValueOptionsOutput>(), cancelAck = deferred<unknown>(), read = vi.fn(() => pending.promise), f = await mount(['one'], { read, cancel: vi.fn(() => cancelAck.promise) });
    await click(text.read); await click(text.cancelTask); await act(async () => pending.resolve(f.result({ column: 'a' })));
    expect(button(text.read).disabled).toBe(true); expect(f.onActivity.mock.calls).toEqual([[1]]); expect(boxes()).toHaveLength(0);
    await act(async () => callback(button(text.read))()); expect(read).toHaveBeenCalledOnce(); expect(f.onClose).not.toHaveBeenCalled();
    await act(async () => cancelAck.resolve(undefined)); expect(button(text.read).disabled).toBe(false); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]);
    await click(text.read); expect(read).toHaveBeenCalledTimes(2); expect(f.onActivity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
  });
  it('取消后原读取先终结，随后关闭仍等待同一原取消ACK且不重复发送', async () => {
    const pending = deferred<TableValueOptionsOutput>(), cancelAck = deferred<unknown>(), cancel = vi.fn(() => cancelAck.promise), f = await mount(['one'], { read: vi.fn(() => pending.promise), cancel });
    await click(text.read); await click(text.cancelTask); await act(async () => pending.resolve(f.result({ column: 'a' }))); await click(text.close);
    expect(f.onClose).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); expect(f.onActivity.mock.calls).toEqual([[1]]);
    await act(async () => cancelAck.resolve(undefined)); expect(f.onClose).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(f.onActivity.mock.calls).toEqual([[1], [-1]]); expect(f.onApply).not.toHaveBeenCalled();
  });
  it('关闭运行任务等待原任务和取消终结，迟到成功不展示不重放', async () => { const pending = deferred<TableValueOptionsOutput>(), cancelAck = deferred<unknown>(), cancel = vi.fn(() => cancelAck.promise); const f = await mount(['one'], { read: vi.fn(() => pending.promise), cancel }); await click(text.read); await click(text.close); expect(f.onClose).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce(); await act(async () => pending.resolve(f.result({ column: 'a' }))); expect(f.onClose).not.toHaveBeenCalled(); await act(async () => cancelAck.resolve(undefined)); expect(f.onClose).toHaveBeenCalledOnce(); expect(f.onApply).not.toHaveBeenCalled(); expect(boxes()).toHaveLength(0); });
  it('取消失败回报清理错误，不提前解除原任务', async () => { const pending = deferred<TableValueOptionsOutput>(), f = await mount(['one'], { read: vi.fn(() => pending.promise), cancel: vi.fn(async () => { throw Error('取消发送失败'); }) }); await click(text.read); await click(text.cancelTask); expect(f.onCleanupError).toHaveBeenCalledWith('取消发送失败'); expect(button(text.read).disabled).toBe(true); await act(async () => pending.reject(Error('原读取已停止'))); expect(button(text.read).disabled).toBe(false); expect(boxes()).toHaveLength(0); });
  it('组合输入禁止读取应用关闭，旧compositionend不能解锁新组合', async () => { const f = await mount(); await act(async () => callback(input(), 'onCompositionStart')()); const oldEnd = callback(input(), 'onCompositionEnd'); await act(async () => callback(input(), 'onCompositionEnd')()); await act(async () => callback(input(), 'onCompositionStart')()); await act(async () => oldEnd()); expect(button(text.read).disabled).toBe(true); expect(button(text.close).disabled).toBe(true); await fill('%'); await act(async () => callback(input(), 'onCompositionEnd')()); await click(text.read); expect(f.read).toHaveBeenCalledOnce(); });
});
