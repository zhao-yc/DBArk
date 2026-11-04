import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteReferenceInput, SqliteReferenceOutput } from '../../src/shared/sqliteReference';
import type { SqliteIncomingInput, SqliteIncomingOutput } from '../../src/shared/sqliteIncoming';
import { sqliteRelationZh as text } from '../../src/renderer/locales/sqliteRelation.zh-CN';
import { sqliteReferenceZh as parentText } from '../../src/renderer/locales/sqliteReference.zh-CN';
import { sqliteIncomingZh as childText } from '../../src/renderer/locales/sqliteIncoming.zh-CN';
const grids = vi.hoisted(() => ({ current: null as any }));
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select' }, DataGrid(props: any) { grids.current = props; return <div role="grid"/>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/SqliteRelationDialog')['SqliteRelationDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  // 仅补标准HTML属性端口，产品控制器、Modal、真实回调和来源判断保持运行。
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) }); return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteRelationDialog: Dialog } = await import('../../src/renderer/components/SqliteRelationDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function callback(node: any) { const name = Object.keys(node).find(name => name.startsWith('__reactProps$'))!; return node[name].onClick as () => void; }
const a = 'a'.repeat(64), b = 'b'.repeat(64), key = { ordinal: 0, columns: ['p'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const };
const meta = (table: string) => ({ name: table, columns: (table === 'child' ? ['id', 'p'] : ['id']).map((name, i) => ({ name, type: 'INTEGER', notNull: false, primaryKey: i === 0 ? 1 : 0, hidden: 0 })), foreignKeys: table === 'child' ? [key] : [] });
/** 合成协议页，真实reader及完整共享回包门保持运行；此夹具不伪装成真实数据库。 */
function page(table: string, value = '1'): SqliteTablePage {
  const columns = meta(table).columns.map(column => ({ name: column.name, declaredType: column.type })), rows = table === 'child' ? [{ c0: '10', c1: value }] : [{ c0: value }];
  return { target: { connectionId: 'c', database: 'main', table, kind: 'table' }, schemaKey: table === 'child' ? a : b, columns, storageTypes: [table === 'child' ? 'ii' : 'i'], offset: 0, limit: 50, hasMore: false, result: { columns: columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows, statement: '', elapsedMs: 0, truncated: false } };
}
function fixture(value = '1') {
  const source = page('child', value); let live = true, n = 0;
  const output = (request: SqliteReferenceInput): SqliteReferenceOutput => request.reference === 'catalog' ? { request, source: meta(request.table) } : { request, source: meta(request.table), parent: meta('parent'), referencedColumns: ['id'], page: { ...page('parent', value), offset: request.offset, limit: request.limit } };
  const incoming = (request: SqliteIncomingInput): SqliteIncomingOutput => ({ request, source: meta('parent'), references: [{ table: 'child', schemaKey: a, key, referencedColumns: ['id'] }], ...(request.incoming === 'page' ? { page: { ...page('child', value), offset: request.offset, limit: request.limit } } : {}) });
  const id = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'), cancel = vi.fn(async (_id: string) => {}), parents = { read: vi.fn(async (request: SqliteReferenceInput) => output(request)), cancel, id }, children = { read: vi.fn(async (request: SqliteIncomingInput) => incoming(request)), cancel, id }, activity = vi.fn();
  const values = [{ kind: 'integer' as const, value: '10' }, { kind: 'integer' as const, value }];
  return { source, values, parents, children, cancel, activity, output, incoming, current: () => live, invalidate: () => { live = false; }, restore: () => { live = true; } };
}

async function mount() {
  const f = fixture(), container = document.createElement('div'), close = vi.fn(); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<Dialog source={f.source} values={f.values} current={f.current} services={{ parents: f.parents, children: f.children }} onActivity={f.activity} onClose={close}/>)); return { ...f, close };
}
async function selectRow() { await act(async () => grids.current.onActivePositionChange({ row: grids.current.rows[0], rowIdx: 0, column: grids.current.columns[0] })); }
it('真实界面从父页继续子页并返回已选记录，方向／声明／历史切换均零隐式读取', async () => {
  const f = await mount(); expect(f.parents.read).not.toHaveBeenCalled(); await click(parentText.catalog); await click(parentText.read); await selectRow(); const oldRead = callback(button(parentText.read));
  await click(text.nextChildren); expect(f.children.read).not.toHaveBeenCalled(); await click(childText.catalog); await click(childText.read); await selectRow(); expect(grids.current.rows[0]).toEqual({ c0: '10', c1: '1' });
  await click(text.nextParents); const total = f.parents.read.mock.calls.length + f.children.read.mock.calls.length; await click(text.back); expect(grids.current.rows[0]).toEqual({ c0: '10', c1: '1' }); expect(button(text.nextParents).disabled).toBe(false);
  await click(text.back); expect(grids.current.rows[0]).toEqual({ c0: '1' }); expect(document.body.textContent).toContain(text.selected(1)); await act(async () => oldRead()); expect(f.parents.read.mock.calls.length + f.children.read.mock.calls.length).toBe(total);
  await click(text.forward); expect(grids.current.rows[0]).toEqual({ c0: '10', c1: '1' }); expect(f.parents.read.mock.calls.length + f.children.read.mock.calls.length).toBe(total); await click(text.close); expect(f.close).toHaveBeenCalledOnce();
});
it.each(['read-first', 'ack-first'] as const)('%s关闭等待原读和取消ACK，父标签busy不提前归还，迟到回包不进入网格', async order => {
  const f = await mount(), pending = deferred<SqliteReferenceOutput>(), ack = deferred<void>(); f.parents.read.mockReturnValueOnce(pending.promise); f.cancel.mockReturnValueOnce(ack.promise);
  await click(parentText.catalog); const request = f.parents.read.mock.calls[0][0]; await click(text.close); expect(f.close).not.toHaveBeenCalled(); expect(f.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
  if (order === 'read-first') await act(async () => pending.resolve(f.output(request))); else await act(async () => ack.resolve()); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1]]);
  if (order === 'read-first') await act(async () => ack.resolve()); else await act(async () => pending.resolve(f.output(request))); expect(f.close).toHaveBeenCalledOnce(); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(document.querySelectorAll('[role="grid"]')).toHaveLength(0);
});
it('来源ABA撤销整个浏览链，当前关闭可用，旧关闭和旧网格回调不能接管新渲染', async () => {
  const f = await mount(); await click(parentText.catalog); await click(parentText.read); const oldGrid = grids.current.onActivePositionChange, oldRow = grids.current.rows[0], oldColumn = grids.current.columns[0], oldClose = callback(button(text.close));
  f.invalidate(); await act(async () => store.setState({})); f.restore(); await act(async () => store.setState({})); expect(button(parentText.catalog).disabled).toBe(true);
  await act(async () => oldGrid({ row: oldRow, rowIdx: 0, column: oldColumn })); expect(button(text.nextChildren).disabled).toBe(true); await act(async () => oldClose()); expect(f.close).not.toHaveBeenCalled(); await click(text.close); expect(f.close).toHaveBeenCalledOnce();
});
