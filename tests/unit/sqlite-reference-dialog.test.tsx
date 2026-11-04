import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteReferenceInput, SqliteReferenceOutput } from '../../src/shared/sqliteReference';
import { sqliteReferenceZh as text } from '../../src/renderer/locales/sqliteReference.zh-CN';
const grids = vi.hoisted(() => ({ current: null as any }));
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select' }, DataGrid(props: any) { grids.current = props; return <div role="grid"/>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/SqliteReferenceDialog')['SqliteReferenceDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  // 仅补标准HTML属性端口，产品控制器、Modal、真实回调和来源判断保持运行。
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) }); return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteReferenceDialog: Dialog } = await import('../../src/renderer/components/SqliteReferenceDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function callback(node: any) { const name = Object.keys(node).find(name => name.startsWith('__reactProps$'))!; return node[name].onClick as () => void; }
/** 合成读取端口，不调用数据库或文件；真实reader负责busy／取消与旧回包交接。 */
async function mount(choosing = false) {
  const source: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'p', declaredType: '' }], result: { columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '001' }], statement: '', elapsedMs: 0, truncated: false }, storageTypes: ['t'], offset: 0, limit: 50, hasMore: false };
  if (choosing) source.edit = { kind: 'editable', snapshotId: 's', expiresAt: new Date(60000).toISOString(), columns: [{ name: 'p', declaredType: '', nullable: true, generated: false, hasDefault: false }], rows: [[{ kind: 'text', value: '001' }]], locator: { kind: 'rowid', columns: [] } };
  const child = { name: 'child', columns: [{ name: 'p', type: '', notNull: false, primaryKey: 0, hidden: 0 }], foreignKeys: [{ ordinal: 0, columns: ['p'], referencedTable: 'parent', referencedColumns: null, onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const }] };
  const output = (request: SqliteReferenceInput): SqliteReferenceOutput => request.reference === 'catalog' ? { request, source: child } : { request, source: child, parent: { name: 'parent', columns: [{ name: 'id', type: 'INTEGER', notNull: true, primaryKey: 1, hidden: 0 }], foreignKeys: [] }, referencedColumns: ['id'], page: { ...source, edit: undefined, target: { ...source.target, table: 'parent' }, schemaKey: 'b'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { ...source.result, columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }] }, storageTypes: ['i'], offset: request.offset, limit: request.limit, hasMore: false } };
  let live = true, n = 0; const services = { read: vi.fn(async (request: SqliteReferenceInput) => output(request)), cancel: vi.fn(async (_id: string) => {}), id: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0') }, activity = vi.fn(), close = vi.fn(), stage = vi.fn(() => { expect(activity.mock.calls.at(-1)).toEqual([-1]); return true; });
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<Dialog source={source} values={[{ kind: 'text', value: '001' }]} current={() => live} services={services} onActivity={activity} onStage={choosing ? stage : undefined} onClose={close}/>));
  return { services, output, activity, close, stage, invalidate: () => { live = false; }, restore: () => { live = true; } };
}
it('打开零读取，目录不带记录值；明确读取父记录才显示完整精确值且原子归还busy', async () => {
  const f = await mount(); expect(f.services.read).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(true);
  await click(text.catalog); expect(f.services.read.mock.calls[0][0].reference).toBe('catalog'); expect(f.services.read.mock.calls[0][0]).not.toHaveProperty('values');
  const oldRead = callback(button(text.read)); await click(text.read); expect(f.services.read.mock.calls[1][0]).toMatchObject({ reference: 'page', values: [{ kind: 'text', value: '001' }] }); expect(grids.current.rows).toEqual([{ c0: '9223372036854775807' }]);
  await act(async () => oldRead()); expect(f.services.read).toHaveBeenCalledTimes(2); expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
});
it.each(['read-first', 'ack-first'] as const)('%s关闭等待原读取与ACK终态，busy不提前归还', async order => {
  const f = await mount(), pending = deferred<SqliteReferenceOutput>(), ack = deferred<void>(); f.services.read.mockReturnValueOnce(pending.promise); f.services.cancel.mockReturnValueOnce(ack.promise);
  await click(text.catalog); const request = f.services.read.mock.calls[0][0]; await click(text.close); expect(f.close).not.toHaveBeenCalled(); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
  if (order === 'read-first') await act(async () => pending.resolve(f.output(request))); else await act(async () => ack.resolve()); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1]]);
  if (order === 'read-first') await act(async () => ack.resolve()); else await act(async () => pending.resolve(f.output(request))); expect(f.close).toHaveBeenCalledOnce(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
});
it('来源ABA永久拒读，当前关闭仍可退出失效窗口，旧关闭不作用于新渲染', async () => {
  const f = await mount(), old = callback(button(text.close)); f.invalidate(); await act(async () => store.setState({})); f.restore(); await act(async () => store.setState({})); expect(button(text.catalog).disabled).toBe(true);
  await act(async () => old()); expect(f.close).not.toHaveBeenCalled(); await click(text.close); expect(f.close).toHaveBeenCalledOnce(); expect(f.services.read).not.toHaveBeenCalled();
});

/** 通过真实ResultsGrid的活动行端口选择，数据网格DOM是唯一替代边界。 */
async function chooseRow() { await act(async () => grids.current.onActivePositionChange({ row: grids.current.rows[0], rowIdx: 0, column: grids.current.columns[0] })); }
it('候选选择不写草稿，明确确认复读typed父键；原租约释放后才回交父编辑器', async () => {
  const f = await mount(true); await click(text.catalog); await click(text.candidates); expect(f.stage).not.toHaveBeenCalled();
  expect(f.services.read.mock.calls[1][0].reference).toBe('candidates'); await chooseRow(); expect(button(text.stage).disabled).toBe(false);
  await click(text.stage); expect(f.services.read.mock.calls[2][0]).toMatchObject({ reference: 'page', parentSchemaKey: 'b'.repeat(64), values: [{ kind: 'integer', value: '9223372036854775807' }] }); expect(f.stage).toHaveBeenCalledOnce();
});
it('复读父键消失不暂存，关闭中的迟到成功结果不写回', async () => {
  const f = await mount(true); await click(text.catalog); await click(text.candidates); await chooseRow();
  f.services.read.mockImplementationOnce(async request => { const value = f.output(request); value.page!.result.rows = []; value.page!.storageTypes = []; return value; });
  await click(text.stage); expect(f.stage).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('删除或变化');
  const pending = deferred<SqliteReferenceOutput>(); f.services.read.mockReturnValueOnce(pending.promise); await click(text.stage); const request = f.services.read.mock.calls.at(-1)![0]; await click(text.close);
  await act(async () => pending.resolve(f.output(request))); expect(f.stage).not.toHaveBeenCalled(); expect(f.close).toHaveBeenCalledOnce();
});
it('租约归还时来源变化拒绝暂存；清空须明确确认且仅新读源目录', async () => {
  const f = await mount(true); await click(text.catalog); await click(text.candidates); await chooseRow();
  f.activity.mockImplementation(delta => { if (delta === -1) f.invalidate(); }); await click(text.stage); expect(f.stage).not.toHaveBeenCalled();
});
it('清空整组须明确确认，只读取准确源目录且归还租约后交接', async () => {
  const f = await mount(true); await click(text.catalog); expect(button(text.clear).disabled).toBe(true);
  const checkbox = document.querySelectorAll('input').find(node => (node as any).type === 'checkbox' || node.getAttribute('type') === 'checkbox')!;
  const props = (checkbox as any)[Object.keys(checkbox).find(name => name.startsWith('__reactProps$'))!]; await act(async () => props.onChange({ target: { checked: true } }));
  await click(text.clear); expect(f.services.read.mock.calls.at(-1)![0].reference).toBe('catalog'); expect(f.stage).toHaveBeenCalledWith(expect.objectContaining({ foreignKey: 0, values: null }));
});
it('搜索草稿修改或新页撤销所选父键；旧活动行回调不能借新渲染恢复选择', async () => {
  const f = await mount(true); await click(text.catalog); await click(text.candidates); await chooseRow(); const oldGrid = grids.current.onActivePositionChange, oldRow = grids.current.rows[0], oldColumn = grids.current.columns[0];
  const input = document.querySelectorAll('input').find(node => node.getAttribute('aria-label') === text.search)!;
  const props = (input as any)[Object.keys(input).find(name => name.startsWith('__reactProps$'))!]; await act(async () => props.onChange({ target: { value: '新搜索' } }));
  expect(button(text.stage).disabled).toBe(true); expect(f.services.read).toHaveBeenCalledTimes(2);
  await click(text.candidates); expect(f.services.read.mock.calls.at(-1)![0]).toMatchObject({ reference: 'candidates', search: { column: 'id', text: '新搜索' }, offset: 0 });
  await act(async () => oldGrid({ row: oldRow, rowIdx: 0, column: oldColumn })); expect(button(text.stage).disabled).toBe(true); expect(f.stage).not.toHaveBeenCalled();
});
