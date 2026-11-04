import { expect, it, vi } from 'vitest';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteOriginalValue } from '../../src/shared/sqliteTableEdit';
import type { SqliteReferenceInput, SqliteReferenceOutput } from '../../src/shared/sqliteReference';
import type { SqliteIncomingInput, SqliteIncomingOutput } from '../../src/shared/sqliteIncoming';
import { SqliteRelationNavigator } from '../../src/renderer/sqliteRelationNavigator';

const a = 'a'.repeat(64), b = 'b'.repeat(64), key = { ordinal: 0, columns: ['p'], referencedTable: 'parent', referencedColumns: ['id'], onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const };
const meta = (table: string) => ({ name: table, columns: (table === 'child' ? ['id', 'p'] : ['id']).map((name, i) => ({ name, type: 'INTEGER', notNull: false, primaryKey: i === 0 ? 1 : 0, hidden: 0 })), foreignKeys: table === 'child' ? [key] : [] });
/** 合成协议页，真实reader及完整共享回包门保持运行；此夹具不伪装成真实数据库。 */
function page(table: string, value = '1'): SqliteTablePage {
  const columns = meta(table).columns.map(column => ({ name: column.name, declaredType: column.type })), rows = table === 'child' ? [{ c0: '10', c1: value }] : [{ c0: value }];
  return { target: { connectionId: 'c', database: 'main', table, kind: 'table' }, schemaKey: table === 'child' ? a : b, columns, storageTypes: [table === 'child' ? 'ii' : 'i'], offset: 0, limit: 50, hasMore: false, result: { columns: columns.map((column, i) => ({ key: 'c' + i, name: column.name, type: 'SQLITE' })), rows, statement: '', elapsedMs: 0, truncated: false } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(value = '1') {
  const source = page('child', value); let live = true, n = 0;
  const output = (request: SqliteReferenceInput): SqliteReferenceOutput => request.reference === 'catalog' ? { request, source: meta(request.table) } : { request, source: meta(request.table), parent: meta('parent'), referencedColumns: ['id'], page: { ...page('parent', value), offset: request.offset, limit: request.limit } };
  const incoming = (request: SqliteIncomingInput): SqliteIncomingOutput => ({ request, source: meta('parent'), references: [{ table: 'child', schemaKey: a, key, referencedColumns: ['id'] }], ...(request.incoming === 'page' ? { page: { ...page('child', value), offset: request.offset, limit: request.limit } } : {}) });
  const id = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0'), cancel = vi.fn(async (_id: string) => {}), parents = { read: vi.fn(async (request: SqliteReferenceInput) => output(request)), cancel, id }, children = { read: vi.fn(async (request: SqliteIncomingInput) => incoming(request)), cancel, id }, activity = vi.fn();
  const nav = new SqliteRelationNavigator(source, [{ kind: 'integer', value: '10' }, { kind: 'integer', value }], () => live, { parents, children, activity });
  return { nav, parents, children, cancel, activity, output, incoming, invalidate: () => { live = false; }, restore: () => { live = true; } };
}
async function readParents(f: ReturnType<typeof fixture>) { await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); }
function select(f: ReturnType<typeof fixture>) { const view = f.nav.view, data = view.panel.data!.page!; expect(f.nav.row(view, data, data.result.rows[0])).toBe(true); }
it('逐层父→子→父，返回和前进恢复页、声明及行选择，零隐式IO；旧位置回调永不复活', async () => {
  const f = fixture(); expect(f.parents.read).not.toHaveBeenCalled(); await readParents(f); select(f); const root = f.nav.view;
  expect(f.nav.navigate(root, 'children')).toBe(true); expect(f.nav.view.source.target.table).toBe('parent'); expect(f.children.read).not.toHaveBeenCalled();
  await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); select(f); const child = f.nav.view;
  expect(f.nav.navigate(child, 'parents')).toBe(true); expect(f.nav.view.history).toBe(3); const count = f.parents.read.mock.calls.length + f.children.read.mock.calls.length;
  expect(f.nav.travel(f.nav.view, -1)).toBe(true); expect(f.nav.view.panel.data?.page?.target.table).toBe('child'); expect(f.nav.view.panel.row).toBe(0);
  expect(f.nav.travel(f.nav.view, -1)).toBe(true); expect(f.nav.view.panel.data?.page?.target.table).toBe('parent'); expect(f.nav.view.panel.selected).toBe(0); expect(f.nav.view.panel.row).toBe(0);
  expect(f.nav.navigate(root, 'children')).toBe(false); expect(f.nav.travel(root, 1)).toBe(false); expect(f.nav.travel(f.nav.view, 1)).toBe(true);
  expect(f.parents.read.mock.calls.length + f.children.read.mock.calls.length).toBe(count); expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1], [1], [-1], [1], [-1]]); f.nav.dispose();
});
it('返回后再次读取父页仍强绑旧父hash；明确刷新目录才重建父结构锚点', async () => {
  const f = fixture(); await readParents(f); select(f); f.nav.navigate(f.nav.view, 'children'); f.nav.travel(f.nav.view, -1); await f.nav.page(f.nav.view, 0);
  expect(f.parents.read.mock.calls.at(-1)![0]).toMatchObject({ reference: 'page', parentSchemaKey: b }); await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); expect(f.parents.read.mock.calls.at(-1)![0]).not.toHaveProperty('parentSchemaKey'); f.nav.dispose();
});
it('返回后另走分支截断前进历史，旧分支回调不作用于新节点', async () => {
  const f = fixture(); await readParents(f); select(f); f.nav.navigate(f.nav.view, 'children'); const old = f.nav.view; f.nav.travel(f.nav.view, -1); f.nav.navigate(f.nav.view, 'parents');
  expect(f.nav.view.history).toBe(2); expect(f.nav.view.node).not.toBe(old.node); expect(f.nav.direction(old, 'parents')).toBe(false); expect(f.nav.travel(f.nav.view, 1)).toBe(false); f.nav.dispose();
});
it('切换方向保留两份本地面板，选另一外键或页后撤销旧行，不隐式读取', async () => {
  const f = fixture(); await readParents(f); select(f); const before = f.parents.read.mock.calls.length;
  f.nav.direction(f.nav.view, 'children'); expect(f.nav.view.panel.data).toBeUndefined(); f.nav.direction(f.nav.view, 'parents'); expect(f.nav.view.panel.row).toBe(0); expect(f.parents.read).toHaveBeenCalledTimes(before);
  expect(f.nav.select(f.nav.view, 0)).toBe(true); expect(f.nav.view.panel.data).toBeUndefined(); expect(f.nav.navigate(f.nav.view, 'parents')).toBe(false); f.nav.dispose();
});
it.each(['read-first', 'ack-first'] as const)('%s关闭期间准确原读和ACK均终态才释放根租约，busy禁止导航', async order => {
  const f = fixture(), pending = deferred<SqliteReferenceOutput>(), ack = deferred<void>(); f.parents.read.mockReturnValueOnce(pending.promise); f.cancel.mockReturnValueOnce(ack.promise);
  const work = f.nav.catalog(f.nav.view); await Promise.resolve(); await Promise.resolve(); const request = f.parents.read.mock.calls[0][0]; const old = f.nav.view, close = f.nav.close(); let ended = false; void close.then(() => { ended = true; });
  expect(f.nav.direction(old, 'children')).toBe(false); expect(f.nav.navigate(old, 'children')).toBe(false); expect(f.nav.view.busy).toBe(true);
  if (order === 'read-first') pending.resolve(f.output(request)); else ack.resolve(); await Promise.resolve(); expect(ended).toBe(false); expect(f.activity.mock.calls).toEqual([[1]]);
  if (order === 'read-first') ack.resolve(); else pending.resolve(f.output(request)); await work; await close; expect(f.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(f.nav.view.panel.catalog).toBeUndefined(); f.nav.dispose();
});
it('尚未发送即关闭不取得租约或发送cancel，仍等待准确已登记操作终态', async () => {
  const f = fixture(), work = f.nav.catalog(f.nav.view), close = f.nav.close(); await close; await work; expect(f.activity).not.toHaveBeenCalled(); expect(f.parents.read).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); expect(f.nav.view.busy).toBe(false); f.nav.dispose();
});
it('取得根租约时同步重入关闭，不先返回关闭、不读取、不遗留busy', async () => {
  const f = fixture(); let close: Promise<void> | undefined, ended = false; f.activity.mockImplementation(delta => { if (delta === 1) { close = f.nav.close(); void close.then(() => { ended = true; }); expect(ended).toBe(false); } });
  await f.nav.catalog(f.nav.view); await close; expect(ended).toBe(true); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(f.parents.read).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled(); f.nav.dispose();
});
it('初始来源及历史来源的ABA永久撤权，返回或恢复相同值也不能重新读取', async () => {
  const f = fixture(); await readParents(f); select(f); f.nav.navigate(f.nav.view, 'children'); const source = f.nav.view.source, value = source.result.rows[0].c0;
  source.result.rows[0].c0 = '2'; f.nav.observe(); source.result.rows[0].c0 = value; expect(f.nav.view.valid).toBe(false); expect(f.nav.travel(f.nav.view, -1)).toBe(false);
  const g = fixture(); g.invalidate(); g.nav.observe(); g.restore(); expect(g.nav.view.valid).toBe(false); await g.nav.catalog(g.nav.view); expect(g.parents.read).not.toHaveBeenCalled(); f.nav.dispose(); g.nav.dispose();
});
it('后代捕获真实64位父值，错误目标回包不进入历史，也不发送写入或查询SQL', async () => {
  const f = fixture('9223372036854775807'); await readParents(f); select(f); f.nav.navigate(f.nav.view, 'children'); await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0);
  expect(f.children.read.mock.calls.at(-1)![0]).toMatchObject({ incoming: 'page', values: [{ kind: 'integer', value: '9223372036854775807' }] });
  f.nav.travel(f.nav.view, -1); f.parents.read.mockImplementationOnce(async request => { const output = f.output(request); output.page!.target.table = 'other'; return output; }); await f.nav.page(f.nav.view, 0); expect(f.nav.view.panel.data).toBeUndefined(); expect(f.nav.view.error).not.toBe(''); f.nav.dispose();
});
it('20个位置达到历史门后拒绝继续，仍可返回并另走分支，不静默丢旧位置', async () => {
  const f = fixture();
  for (let i = 1; i < 20; i++) { if (f.nav.view.direction === 'parents') await readParents(f); else { await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); } select(f); expect(f.nav.navigate(f.nav.view, f.nav.view.direction === 'parents' ? 'children' : 'parents')).toBe(true); }
  await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); select(f); expect(f.nav.navigate(f.nav.view, 'parents')).toBe(false); expect(f.nav.view.error).toContain('20'); expect(f.nav.view.history).toBe(20); expect(f.nav.travel(f.nav.view, -1)).toBe(true); f.nav.dispose();
});

it('总缓存超32MiB拒绝发布新结果，保留之前的历史并允许返回，不静默淘汰或截断', async () => {
  const f = fixture(), payload = 'x'.repeat(230000);
  f.parents.read.mockImplementation(async request => {
    const output = f.output(request);
    if (output.parent) output.parent.columns[0].primaryKey = 0;
    if (output.page) { output.parent!.columns.push({ name: 'payload', type: 'TEXT', notNull: false, primaryKey: 0, hidden: 0 }); output.page.columns.push({ name: 'payload', declaredType: 'TEXT' }); output.page.result.columns.push({ name: 'payload', key: 'c1', type: 'SQLITE' }); output.page.result.rows = Array.from({ length: 50 }, () => ({ c0: '1', c1: payload })); output.page.storageTypes = Array(50).fill('it'); }
    return output;
  });
  f.children.read.mockImplementation(async request => { const output = f.incoming(request); output.source.columns[0].primaryKey = 0; return output; });
  await readParents(f); expect(f.nav.view.error).toBe(''); select(f); expect(f.nav.navigate(f.nav.view, 'children')).toBe(true);
  await f.nav.catalog(f.nav.view); await f.nav.page(f.nav.view, 0); select(f); expect(f.nav.navigate(f.nav.view, 'parents')).toBe(true);
  await readParents(f); expect(f.nav.view.panel.data).toBeUndefined(); expect(f.nav.view.error).toContain('32MiB'); expect(f.nav.view.history).toBe(3); expect(f.nav.travel(f.nav.view, -1)).toBe(true); expect(f.nav.view.panel.data?.page?.result.rows).toHaveLength(1); f.nav.dispose();
});

it('取消ACK失败在等待原读终态后明确报告，不自动重读或提前放开根租约', async () => {
  const f = fixture(), pending = deferred<SqliteReferenceOutput>(); f.parents.read.mockReturnValueOnce(pending.promise); f.cancel.mockRejectedValueOnce(Error('取消响应未确认'));
  const work = f.nav.catalog(f.nav.view); await Promise.resolve(); await Promise.resolve(); const request = f.parents.read.mock.calls[0][0], stop = f.nav.stop(), rejected = expect(stop).rejects.toThrow('取消响应未确认');
  expect(f.nav.view.busy).toBe(true); expect(f.activity.mock.calls).toEqual([[1]]); pending.resolve(f.output(request)); await work; await rejected; expect(f.nav.view.error).toBe('取消响应未确认'); expect(f.nav.view.busy).toBe(false); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(f.parents.read).toHaveBeenCalledTimes(1); f.nav.dispose();
});
