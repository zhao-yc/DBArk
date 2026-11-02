import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { relationshipDiagramZh as text } from '../../src/renderer/locales/relationshipDiagram.zh-CN';
import type { SqliteRelationshipsInput, SqliteRelationshipsOutput } from '../../src/shared/sqliteRelationships';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/SqliteRelationshipDialog')['SqliteRelationshipDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ SqliteRelationshipDialog: Dialog } = await import('../../src/renderer/components/SqliteRelationshipDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name); expect(node, name).toBeDefined(); return node!; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
/** 真实对话框/reader/画布的组件证据，原生几何与真实磁盘另由Electron专项覆盖。 */
async function mount() {
  const source: SqliteTablePage = { schemaKey: 'a'.repeat(64), target: { connectionId: 'c', database: 'main', table: 'child', kind: 'table' }, columns: [{ name: 'p', declaredType: '' }], result: { columns: [], rows: [], elapsedMs: 0, truncated: false, statement: '' }, limit: 10, offset: 0, hasMore: false };
  const services = { objects: vi.fn(async () => [{ name: 'child', kind: 'table' as const }, { name: 'parent<script>', kind: 'table' as const }, { name: 'v', kind: 'view' as const }]),
    read: vi.fn(async (request: SqliteRelationshipsInput): Promise<SqliteRelationshipsOutput> => ({ request, schemaVersion: '1', tables: request.tables.map(name => ({ name, columns: [{ name: 'p', type: '', notNull: false, primaryKey: name === 'child' ? 0 : 1, hidden: 0 }], foreignKeys: name !== 'child' ? [] : [{ ordinal: 0, columns: ['p'], referencedTable: 'parent<script>', referencedColumns: null, onUpdate: 'NO ACTION', onDelete: 'CASCADE' }] })) })), cancel: vi.fn(async (_id: string) => {}) };
  let live = true; const activity = vi.fn(), close = vi.fn(), props: ComponentProps<typeof Dialog> = { source, current: () => live, onActivity: activity, onClose: close, services };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<Dialog {...props}/>));
  return { services, activity, close, source, props, invalidate() { live = false; }, restore() { live = true; } };
}
it('打开无目录或结构请求，原表固定选中；明确读取才展示未确认隐式引用', async () => {
  const f = await mount(); expect(f.services.read).not.toHaveBeenCalled(); expect(f.services.objects).not.toHaveBeenCalled(); expect(f.activity).not.toHaveBeenCalled();
  expect(document.querySelectorAll('input').filter(node => node.type === 'checkbox')[0].disabled).toBe(true);
  await click(text.read); expect(f.services.read).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain('隐式主键第1列（未确认）'); expect(document.body.textContent).toContain('未声明类型'); expect(document.querySelectorAll('script')).toHaveLength(0);
  await click(text.zoomOut); expect(f.services.read).toHaveBeenCalledTimes(1); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
});
it('目录和勾选只改草稿；完整两表单任务解析隐式主键，刷新仍读图中范围', async () => {
  const f = await mount(); await click(text.catalog); expect(f.services.read).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('>v');
  const parent = document.querySelectorAll('input').filter(node => node.type === 'checkbox')[1]; await act(async () => { const key = Object.keys(parent).find(key => key.startsWith('__reactProps$'))!; (parent as any)[key].onChange({ target: { checked: true } }); });
  expect(f.services.read).not.toHaveBeenCalled(); await click(text.read); expect(f.services.read.mock.calls[0][0].tables).toEqual(['child', 'parent<script>']); expect(document.body.textContent).toContain('p → p'); expect(document.body.textContent).not.toContain('映射未确认'); await click(text.refresh); expect(f.services.read.mock.calls[1][0].tables).toEqual(['child', 'parent<script>']); expect(document.querySelectorAll('script')).toHaveLength(0);
});
it.each(['read-first', 'ack-first'] as const)('%s关闭必须等两侧终态及父busy归还', async order => {
  const f = await mount(), pending = deferred<SqliteRelationshipsOutput>(), ack = deferred<void>(); f.services.read.mockImplementationOnce(() => pending.promise); f.services.cancel.mockImplementationOnce(() => ack.promise);
  await click(text.read); const request = f.services.read.mock.calls[0][0]; await click(text.close); expect(f.close).not.toHaveBeenCalled(); expect(f.services.cancel).toHaveBeenCalledExactlyOnceWith(request.taskId);
  if (order === 'read-first') await act(async () => pending.resolve({ request, schemaVersion: '1', tables: [] })); else await act(async () => ack.resolve()); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1]]);
  if (order === 'read-first') await act(async () => ack.resolve()); else await act(async () => pending.resolve({ request, schemaVersion: '1', tables: [] })); expect(f.activity.mock.calls).toEqual([[1], [-1]]); expect(f.close).toHaveBeenCalledOnce();
});
it('原作用域ABA或源页指纹改写永久撤销，恢复也不读取', async () => {
  const f = await mount(); f.invalidate(); await act(async () => useWorkspace.setState({})); f.restore(); await act(async () => useWorkspace.setState({})); expect(button(text.read).disabled).toBe(true); expect(f.services.read).not.toHaveBeenCalled();
});
