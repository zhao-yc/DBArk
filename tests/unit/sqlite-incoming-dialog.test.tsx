import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteIncomingInput, SqliteIncomingOutput } from '../../src/shared/sqliteIncoming';
import { sqliteIncomingZh as text } from '../../src/renderer/locales/sqliteIncoming.zh-CN';
const grids = vi.hoisted(() => ({ current: null as any }));
vi.mock('react-data-grid', () => ({ SelectColumn: { key: 'select' }, DataGrid(props: any) { grids.current = props; return <div role="grid"/>; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/SqliteIncomingDialog')['SqliteIncomingDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  // 仅补标准HTML属性端口，产品控制器、Modal、真实回调和来源判断保持运行。
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; };
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.getAttribute('value') ?? node.textContent, set: value => node.setAttribute('value', value) }); return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteIncomingDialog: Dialog } = await import('../../src/renderer/components/SqliteIncomingDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(label: string) { const node = document.querySelectorAll('button').find(node => node.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function callback(node: any) { const name = Object.keys(node).find(name => name.startsWith('__reactProps$'))!; return node[name].onClick as () => void; }
/** 合成读取端口，不调用数据库或文件；真实reader负责busy／取消与旧回包交接。 */
async function mount() {
  const source: SqliteTablePage = { target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, schemaKey: 'a'.repeat(64), columns: [{ name: 'p', declaredType: '' }], result: { columns: [{ key: 'c0', name: 'p', type: 'SQLITE' }], rows: [{ c0: '001' }], statement: '', elapsedMs: 0, truncated: false }, storageTypes: ['t'], offset: 0, limit: 50, hasMore: false };
  const child = { name: 'child', columns: [{ name: 'p', type: '', notNull: false, primaryKey: 1, hidden: 0 }], foreignKeys: [] };
  const entry = { table: 'parent', schemaKey: 'b'.repeat(64), key: { ordinal: 0, columns: ['id'], referencedTable: 'child', referencedColumns: ['p'], onUpdate: 'NO ACTION' as const, onDelete: 'NO ACTION' as const }, referencedColumns: ['p'] };
  const output = (request: SqliteIncomingInput): SqliteIncomingOutput => request.incoming === 'catalog' ? { request, source: child, references: [entry] } : { request, source: child, references: [entry], page: { ...source, target: { ...source.target, table: 'parent' }, schemaKey: 'b'.repeat(64), columns: [{ name: 'id', declaredType: 'INTEGER' }], result: { ...source.result, columns: [{ key: 'c0', name: 'id', type: 'SQLITE' }], rows: [{ c0: '9223372036854775807' }] }, storageTypes: ['i'], offset: request.offset, limit: request.limit, hasMore: false } };
  let live = true, n = 0; const services = { read: vi.fn(async (request: SqliteIncomingInput) => output(request)), cancel: vi.fn(async (_id: string) => {}), id: () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0') }, activity = vi.fn(), close = vi.fn();
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as any);
  await act(async () => root!.render(<Dialog source={source} values={[{ kind: 'text', value: '001' }]} current={() => live} services={services} onActivity={activity} onClose={close}/>));
  return { services, output, activity, close, invalidate: () => { live = false; }, restore: () => { live = true; } };
}
it('打开零读取，目录不带记录值；明确读取子记录才显示完整精确值且原子归还busy', async () => {
  const f = await mount(); expect(f.services.read).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(true);
  await click(text.catalog); expect(f.services.read.mock.calls[0][0].incoming).toBe('catalog'); expect(f.services.read.mock.calls[0][0]).not.toHaveProperty('values');
  const oldRead = callback(button(text.read)); await click(text.read); expect(f.services.read.mock.calls[1][0]).toMatchObject({ incoming: 'page', values: [{ kind: 'text', value: '001' }] }); expect(grids.current.rows).toEqual([{ c0: '9223372036854775807' }]);
  await act(async () => oldRead()); expect(f.services.read).toHaveBeenCalledTimes(2); expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1]]);
});
it.each(['read-first', 'ack-first'] as const)('%s关闭等待原读取与ACK终态，busy不提前归还', async order => {
  const f = await mount(), pending = deferred<SqliteIncomingOutput>(), ack = deferred<void>(); f.services.read.mockReturnValueOnce(pending.promise); f.services.cancel.mockReturnValueOnce(ack.promise);
  await click(text.catalog); const request = f.services.read.mock.calls[0][0]; await click(text.close); expect(f.close).not.toHaveBeenCalled(); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
  if (order === 'read-first') await act(async () => pending.resolve(f.output(request))); else await act(async () => ack.resolve()); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1]]);
  if (order === 'read-first') await act(async () => ack.resolve()); else await act(async () => pending.resolve(f.output(request))); expect(f.close).toHaveBeenCalledOnce(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
});
it('来源ABA永久拒读，当前关闭仍可退出失效窗口，旧关闭不作用于新渲染', async () => {
  const f = await mount(), old = callback(button(text.close)); f.invalidate(); await act(async () => store.setState({})); f.restore(); await act(async () => store.setState({})); expect(button(text.catalog).disabled).toBe(true);
  await act(async () => old()); expect(f.close).not.toHaveBeenCalled(); await click(text.close); expect(f.close).toHaveBeenCalledOnce(); expect(f.services.read).not.toHaveBeenCalled();
});
