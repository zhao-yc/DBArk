import { act, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { relationshipDiagramZh as text } from '../../src/renderer/locales/relationshipDiagram.zh-CN';
import { relationshipFixture } from '../helpers/relationshipDiagramFixture';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let RelationshipDiagramDialog: typeof import('../../src/renderer/components/RelationshipDiagramDialog')['RelationshipDiagramDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client'));
  ({ RelationshipDiagramDialog } = await import('../../src/renderer/components/RelationshipDiagramDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function button(name: string) { const node = document.querySelectorAll('button').find(node => node.textContent === name || node.getAttribute('aria-label') === name); expect(node, name).toBeDefined(); return node!; }
function props(node: ReturnType<typeof button>) { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件'); return (node as any)[key]; }
async function click(name: string) { const node = button(name); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
/** 真实Modal、图与reader，只替代元数据端口；内存DOM不作为原生几何或系统输入证据。 */
async function mount() {
  const tables = relationshipFixture(), services = { objects: vi.fn(async () => [...tables.map(table => ({ name: table.name, kind: 'table' as const })), { name: 'some_view', kind: 'view' as const }]), table: vi.fn(async (target: { table: string; taskId: string }) => structuredClone(tables.find(table => table.name === target.table)!)), cancel: vi.fn(async (_id: string) => {}) };
  let live = true; const activity = vi.fn(), close = vi.fn(), value: ComponentProps<typeof RelationshipDiagramDialog> = { source: tables[0], connectionId: 'c', current: () => live, services, onClose: close, onActivity: activity };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any); await act(async () => root!.render(<RelationshipDiagramDialog {...value}/>));
  return { tables, services, activity, close, value, invalidate() { live = false; }, restore() { live = true; } };
}
describe('表关系图真实对话框', () => {
  it('打开仅显示已读结构和未读声明目标，查看节点、缩放及字段开关不读取目录', async () => {
    const f = await mount(); expect(document.body.textContent).toContain(text.external); expect(document.body.textContent).toContain('fk_composite'); expect(document.body.textContent).toContain('备注<script>');
    expect(document.querySelectorAll('script')).toHaveLength(0); await click(text.zoomOut); expect(document.body.textContent).toContain('75%'); await click(text.zoomIn);
    await click('diagram_db.child'); expect(f.services.objects).not.toHaveBeenCalled(); expect(f.services.table).not.toHaveBeenCalled(); expect(f.activity).not.toHaveBeenCalled();
  });
  it('目录、选择与读取分开；原菜单任务串行读取完整两表，不包含视图或未读跨库目标', async () => {
    const f = await mount(); await click(text.catalog); expect(f.services.table).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('some_view');
    const parent = document.querySelectorAll('label').find(node => node.textContent === 'parent')!.querySelector('input')!;
    await act(async () => props(parent).onChange({ target: { checked: true } })); expect(f.services.table).not.toHaveBeenCalled(); await click(text.read);
    expect(f.services.table.mock.calls.map(([target]) => target.table)).toEqual(['child', 'parent']); expect(document.body.textContent).toContain('2 张已读表 · 1 个未读目标 · 3 个外键');
    expect(f.activity.mock.calls).toEqual([[1], [-1], [1], [-1]]); await click(text.clear); expect(f.services.table).toHaveBeenCalledTimes(2); await click(text.refresh); expect(f.services.table).toHaveBeenCalledTimes(4);
  });
  it('关闭等待原读取与取消ACK，不能提前释放窗口和父活动计数', async () => {
    const f = await mount(), pending = deferred<typeof f.tables[0]>(), ack = deferred<void>(); f.services.table.mockImplementationOnce(() => pending.promise); f.services.cancel.mockImplementationOnce(() => ack.promise);
    await click(text.read); const id = f.services.table.mock.calls[0][0].taskId; await click(text.close); expect(f.close).not.toHaveBeenCalled(); expect(f.services.cancel.mock.calls).toEqual([[id]]);
    await act(async () => pending.resolve(f.tables[0])); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1]]);
    await act(async () => ack.resolve()); expect(f.close).toHaveBeenCalledOnce(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('目录权限失败保留原图，不发布半个新范围；错误以纯文本显示', async () => {
    const f = await mount(); f.services.table.mockRejectedValueOnce(Error('目录拒绝<script>')); await click(text.read);
    expect(document.body.textContent).toContain('目录拒绝<script>'); expect(document.body.textContent).toContain('1 张已读表'); expect(document.querySelectorAll('script')).toHaveLength(0); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
  it('原目标ABA通知永久撤销，旧按钮闭包和恢复同名目标不发送请求', async () => {
    const f = await mount(), old = props(button(text.read)).onClick; f.invalidate(); await act(async () => useWorkspace.setState({})); f.restore(); await act(async () => useWorkspace.setState({}));
    expect(document.body.textContent).toContain(text.stale); await act(async () => old()); expect(f.services.table).not.toHaveBeenCalled();
  });
  it('原目录对象原地修改也撤销，不能只比较相同引用后读取旧目标', async () => {
    const f = await mount(), old = props(button(text.read)).onClick; f.tables[0].columns[0].name = 'changed';
    await act(async () => old()); expect(f.services.table).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.stale);
  });
  it('卸载取消准确当前读取，迟到结果不发布，原终态后归还父活动计数', async () => {
    const f = await mount(), pending = deferred<typeof f.tables[0]>(); f.services.table.mockImplementationOnce(() => pending.promise); await click(text.read);
    const id = f.services.table.mock.calls[0][0].taskId; await act(async () => root!.unmount()); root = undefined; expect(f.services.cancel.mock.calls).toEqual([[id]]);
    await act(async () => pending.resolve(f.tables[0])); expect(f.close).not.toHaveBeenCalled(); expect(f.activity.mock.calls).toEqual([[1], [-1]]);
  });
});
