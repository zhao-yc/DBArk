import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { DataRow, TableInfo } from '../../src/shared/contracts';
import type { ChildReferencePageInput, IncomingReferenceRelation, IncomingReferencesInput } from '../../src/shared/incomingReferences';
import { memoryDocument, MemoryEvent, MemoryNode } from '../fixtures/memory-dom';
import { ChildReferenceIntent } from '../../src/renderer/childReferenceIntent';
import { childReferencesZh as text } from '../../src/renderer/locales/childReferences.zh-CN';
import type { ChildReferenceServices } from '../../src/renderer/components/ChildReferenceDialog';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableSortZh } from '../../src/renderer/locales/tableSort.zh-CN';

// 仅虚拟表格的DOM/布局端口替换；真实窗口、筛选、排序、生命周期与IPC参数都照产品执行。
vi.mock('../../src/renderer/components/ResultsGrid', () => ({ ResultsGrid: (props: { rows: DataRow[]; onSortChange?: (sort: { column: string; direction: 'ASC' }[]) => void }) => <section aria-label="子记录只读网格RAM端口"><pre>{JSON.stringify(props.rows)}</pre><button onClick={() => props.onSortChange?.([{ column: 'parent_id', direction: 'ASC' }])}>RAM表头排序</button></section> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, Dialog: typeof import('../../src/renderer/components/ChildReferenceDialog')['ChildReferenceDialog'];
const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'], saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  const create = document.createElement.bind(document); document.createElement = name => {
    const node = create(name); if (name === 'input') node.type = 'text';
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    // 原生option未显式value时读取正文；页大小选项沿真实HTML合同，不改产品去适配RAM。
    if (name === 'option') Object.defineProperty(node, 'value', { get: () => node.getAttribute('value') ?? node.textContent, set: value => { set('value', String(value)); } });
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (key === 'value' && name === 'option') node.value = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { get: () => node.querySelectorAll('option').find(option => (option as MemoryNode & { selected?: boolean }).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as MemoryNode & { selected?: boolean }).selected = option.value === value; } }); }
    return node;
  };
  ({ createRoot } = await import('react-dom/client')); ({ ChildReferenceDialog: Dialog } = await import('../../src/renderer/components/ChildReferenceDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; });
afterAll(() => { for (const [key, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 真实控制节点事件；不读取React私有属性或调用内部setter。 */
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function field(label: string, tag = 'select') { const node = document.body.querySelectorAll(tag).find(node => node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function select(label: string, value: string) { const node = field(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function input(label: string, value: string) { const node = field(label, 'input'); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(finish => { resolve = finish; }); return { promise, resolve }; }

/** 合成目录只证明UI协议接线，不能替代真实权限目录/数据库验收。 */
async function mount(options: { data?: DataRow; stable?: boolean; incoming?: ChildReferenceServices['incoming']; page?: ChildReferenceServices['page'] } = {}) {
  const base = { connectionId: 'connection', database: 'parent_db', table: 'parent' };
  const source: TableInfo = { database: base.database, name: base.table, engine: 'InnoDB', objectKind: 'table', columns: [{ name: 'id', type: 'bigint', nullable: false }, { name: 'part', type: 'varbinary(8)', nullable: true }] as TableInfo['columns'], indexes: [], foreignKeys: [], primaryKey: ['id'], editableKey: ['id'], ddl: 'CREATE TABLE parent (`id` bigint, `part` varbinary(8))' };
  const relation: IncomingReferenceRelation = { database: 'child_db', table: 'child', digest: 'b'.repeat(64), foreignKey: { name: 'fk_child_parent', columns: ['parent_id', 'parent_part'], referencedDatabase: source.database, referencedTable: source.name, referencedColumns: ['id', 'part'], onDelete: 'RESTRICT', onUpdate: 'RESTRICT' } };
  const directory = { source, sourceDigest: 'a'.repeat(64), scope: 'visible-only' as const, relations: [relation], nextCursor: 'cursor-2' };
  const output = (input: ChildReferencePageInput) => ({ source, sourceDigest: directory.sourceDigest, relation, target: { ...source, name: relation.table, database: relation.database, editableKey: options.stable === false ? [] : ['parent_id'], columns: [{ name: 'parent_id', type: 'bigint', nullable: false }, { name: 'parent_part', type: 'varbinary(8)', nullable: true }] as TableInfo['columns'] }, page: { rows: [{ parent_id: '9223372036854775807', parent_part: { type: 'binary' as const, base64: 'AP8=' } }], columns: [{ key: 'parent_id', name: 'parent_id', type: 'BIGINT' }, { key: 'parent_part', name: 'parent_part', type: 'BLOB' }], page: input.page, pageSize: input.pageSize, hasMore: input.page < 3 }, stablePagination: options.stable !== false });
  const incoming = vi.fn<ChildReferenceServices['incoming']>(options.incoming ?? (async (input: IncomingReferencesInput) => ({ ...directory, ...(input.cursor ? { nextCursor: undefined } : {}) }))), page = vi.fn<ChildReferenceServices['page']>(options.page ?? (async input => output(input))), cancel = vi.fn(async () => {}), close = vi.fn(), activity = vi.fn();
  const services: ChildReferenceServices = { incoming, page, cancel }, row = options.data ?? { id: '9223372036854775807', part: { type: 'binary' as const, base64: 'AP8=' } }, intent = new ChildReferenceIntent(source, 'original-row', row, [source, row], () => true);
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => { root!.render(<Dialog base={base} intent={intent} onClose={close} onActivity={activity} services={services}/>); });
  return { base, source, relation, directory, output, incoming, page, cancel, close, activity, intent, row, services, async render(nextBase = base) { await act(async () => { root!.render(<Dialog base={nextBase} intent={intent} onClose={close} onActivity={activity} services={services}/>); }); } };
}
it('无正向外键的父行可选真实子关系，复合tuple保留精度字节且完全只读', async () => {
  const f = await mount(); expect(f.source.foreignKeys).toEqual([]); expect(f.page).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.visible); await select(text.relations, '0'); expect(f.page).toHaveBeenCalledOnce(); expect(f.page.mock.calls[0][0]).toEqual({ ...f.base, taskId: expect.any(String), relation: { database: 'child_db', table: 'child', foreignKeyName: 'fk_child_parent', digest: 'b'.repeat(64) }, matchValues: ['9223372036854775807', { type: 'binary', base64: 'AP8=' }], page: 1, pageSize: 50, filters: [], filterMode: 'all', sort: [] }); expect(document.body.textContent).toContain('9223372036854775807'); expect(f.row.id).toBe('9223372036854775807'); expect(document.body.querySelectorAll('textarea')).toHaveLength(0); await click(text.close); expect(f.close).toHaveBeenCalledOnce();
});
it.each<[DataRow]>([[{ id: '1', part: null }], [{ id: '1' }]])('NULL或缺字段不给子页发送无界请求：%j', async data => { const f = await mount({ data }); await select(text.relations, '0'); expect(f.page).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(Object.hasOwn(data, 'part') ? text.nullTuple : text.incomplete); });
it('无可靠键仅提示真实不稳定分页，不禁用只读下一页', async () => { const f = await mount({ stable: false }); await select(text.relations, '0'); expect(document.body.textContent).toContain(text.unstable); await click(text.next); expect(f.page.mock.calls.at(-1)![0].page).toBe(2); expect(document.body.textContent).toContain(text.unstable); });
it('目录独立翻页传原cursor，上一页重读且不自动执行任何子关系', async () => { const f = await mount(); await click(text.nextRelations); expect(f.incoming.mock.calls[1][0]).toEqual({ ...f.base, taskId: expect.any(String), cursor: 'cursor-2' }); expect(f.page).not.toHaveBeenCalled(); await click(text.previousRelations); expect(f.incoming.mock.calls[2][0]).toEqual({ ...f.base, taskId: expect.any(String) }); });
it('真实筛选面板和多列排序只附加于原tuple，页码和父草稿不变', async () => {
  const f = await mount(); await select(text.relations, '0'); await click('RAM表头排序'); expect(f.page.mock.calls.at(-1)![0].sort).toEqual([{ column: 'parent_id', direction: 'ASC' }]); await select(text.pageSize, '100'); expect(f.page.mock.calls.at(-1)![0].pageSize).toBe(100);
  await input(zh.table.text011, '9223372036854775807'); expect(f.page).toHaveBeenCalledTimes(3); const form = document.body.querySelectorAll('form').find(node => node.getAttribute('class') === 'filter-rule-form')!; await act(async () => { form.dispatchEvent(new MemoryEvent('submit')); }); expect(f.page.mock.calls.at(-1)![0].filters).toEqual([{ column: 'parent_id', operator: '=', value: '9223372036854775807' }]);
  expect(f.page.mock.calls.every(([input]) => input.matchValues[0] === '9223372036854775807' && input.relation.database === 'child_db')).toBe(true); expect(f.row).toEqual({ id: '9223372036854775807', part: { type: 'binary', base64: 'AP8=' } }); await click(text.sort); expect(button(text.next).disabled).toBe(true); await click(tableSortZh.add); await select(tableSortZh.field(2), 'parent_part'); await click(tableSortZh.apply); expect(f.page.mock.calls.at(-1)![0].sort).toEqual([{ column: 'parent_id', direction: 'ASC' }, { column: 'parent_part', direction: 'ASC' }]); expect(f.page.mock.calls.at(-1)![0].filters).toHaveLength(1);
});
it('取消ACK不解原Promise锁，晚到子页丢弃且不自动重试', async () => {
  const delayed = deferred<Awaited<ReturnType<ChildReferenceServices['page']>>>(), f = await mount({ page: () => delayed.promise }); await select(text.relations, '0'); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1, 1]); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce(); expect(field(text.relations).disabled).toBe(true); expect(f.activity.mock.calls.at(-1)).toEqual([1]); await act(async () => { delayed.resolve(f.output(f.page.mock.calls[0][0])); }); expect(document.body.textContent).not.toContain('子记录第 1 页，本页 1 条'); expect(f.page).toHaveBeenCalledOnce(); expect(field(text.relations).disabled).toBe(false); expect(f.activity.mock.calls.at(-1)).toEqual([-1]);
});
it('关闭等待原读取实际结算，迟到目录不复活且活动成对释放', async () => {
  const delayed = deferred<Awaited<ReturnType<ChildReferenceServices['incoming']>>>(), f = await mount({ incoming: () => delayed.promise }); await click(text.close); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.close).not.toHaveBeenCalled(); await act(async () => { delayed.resolve(f.directory); }); expect(f.close).toHaveBeenCalledOnce(); expect(f.page).not.toHaveBeenCalled(); expect(f.activity.mock.calls.map(([delta]) => delta)).toEqual([1, -1]);
});
it('原行变化/目标ABA永久拒收晚回包和旧关系事件', async () => {
  const delayed = deferred<Awaited<ReturnType<ChildReferenceServices['page']>>>(), f = await mount({ page: () => delayed.promise }); await select(text.relations, '0'); await act(async () => { f.intent.observe([f.source, {}]); f.intent.observe([f.source, f.row]); }); expect(f.cancel).toHaveBeenCalledOnce(); await act(async () => { delayed.resolve(f.output(f.page.mock.calls[0][0])); }); expect(document.body.textContent).toContain(text.changed); expect(document.body.querySelector('[aria-label="子记录只读网格RAM端口"]')).toBeNull(); expect(f.page).toHaveBeenCalledOnce();
});
it('原属性目标切走再回也不复活意图，旧DOM事件不读取新目标', async () => { const f = await mount(), old = field(text.relations); await f.render({ ...f.base, table: 'other' }); await f.render(); await act(async () => { old.value = '0'; old.dispatchEvent(new MemoryEvent('change')); }); expect(f.intent.current()).toBe(false); expect(f.page).not.toHaveBeenCalled(); });
it('映射摘要不符只报错，不接受异表结果或重发', async () => { const f = await mount(); f.page.mockImplementation(async input => ({ ...f.output(input), sourceDigest: 'c'.repeat(64) })); await select(text.relations, '0'); expect(document.body.textContent).toContain(text.mismatch); expect(f.page).toHaveBeenCalledOnce(); expect(document.body.querySelector('[aria-label="子记录只读网格RAM端口"]')).toBeNull(); });
it('模态CtrlEnter/CtrlS被捕获，不触发后台执行或提交', async () => { const f = await mount(); for (const key of ['Enter', 's']) { const event = new MemoryEvent('keydown'); Object.assign(event, { key, ctrlKey: true, stopImmediatePropagation: () => event.stopPropagation() }); await act(async () => { document.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true); expect(event.cancelBubble).toBe(true); } expect(f.page).not.toHaveBeenCalled(); });
