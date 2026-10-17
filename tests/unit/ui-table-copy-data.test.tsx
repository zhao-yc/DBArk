import { StrictMode, act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode, MemoryEvent } from '../fixtures/memory-dom';
import { TableCopyDataDialog, type TableCopyDataDialogProps, type TableCopyDataServices } from '../../src/renderer/components/TableCopyDataDialog';
import type { TableCopyDataGetOutput, TableCopyDataPreviewOutput, TableCopyDataProgress } from '../../src/shared/tableCopyData';
import { tableCopyDataAcknowledgements } from '../../src/shared/tableCopyData';
import { tableCopyDataZh as text } from '../../src/renderer/locales/tableCopyData.zh-CN';

/** 仅替换Monaco显示端口；对话框、事件委派、异步围栏和生命周期均使用真实ReactDOM。 */
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="预览SQL" readOnly={readOnly} value={value}/> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let props: TableCopyDataDialogProps, services: TableCopyDataServices, listener: ((event: { taskId: string; progress: TableCopyDataProgress }) => void) | undefined;
const target = { connectionId: '连接1', database: 'db', table: 't' };
const snapshot = (): TableCopyDataGetOutput => ({ mode: 'structure-and-data' as const, target, snapshotId: 's', expiresAt: new Date(Date.now() + 120000).toISOString(), ddlHash: 'hash', writable: true, reasons: [], warnings: ['数据不可回滚'], serverVersion: '8.4.11', tableId: '123', sourceDdl: 'CREATE TABLE `t` (`id` int NOT NULL) ENGINE=InnoDB' });
const preview = (): TableCopyDataPreviewOutput => ({ mode: 'structure-and-data' as const, target, previewToken: 'p', expiresAt: new Date(Date.now() + 110000).toISOString(), ddlHash: 'hash', newName: 't_copy', sql: 'CREATE TABLE `db`.`t_copy` LIKE `db`.`t`;', requiredAcknowledgements: [...tableCopyDataAcknowledgements], warnings: [] });
/** 明确控制服务完成顺序，不使用真实网络、时钟等待或浏览器。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null;
  Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  document.createElement = name => { const node = create(name); if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    // React写HTML布尔属性；仅反射disabled读回，不推导产品状态。
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 所有输入均走真实DOM事件，不直接调用组件内部处理器。 */
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.textContent === label); if (!node) throw Error('缺少按钮：' + label); return node; }
async function click(label: string, twice = false) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); if (twice) node.dispatchEvent(new MemoryEvent('click')); }); }
async function type(value: string, label: string = text.confirmation) { const node = document.querySelector(`textarea[aria-label="${label}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function acknowledge() { await act(async () => { for (const node of document.querySelectorAll('input[type="checkbox"]')) { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); } }); }
async function mount(options: { strict?: boolean; get?: TableCopyDataServices['get']; preview?: TableCopyDataServices['preview'] } = {}) {
  listener = undefined; services = { get: vi.fn(options.get ?? (async () => snapshot())), preview: vi.fn(options.preview ?? (async () => preview())), apply: vi.fn(async () => ({ mode: 'structure-and-data' as const, target, newTarget: { ...target, table: 't_copy' }, ddlSubmitted: true as const, ddlCompleted: true as const, dataSubmitted: true as const, insertCompleted: true as const, commitSubmitted: true as const, dataCompleted: true as const, definitionVerified: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  props = { target, targetVersion: 1, services, onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), beforeApply: vi.fn(), onApplied: vi.fn(), onExecutionUncertain: vi.fn() };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(options.strict ? <StrictMode><TableCopyDataDialog {...props}/></StrictMode> : <TableCopyDataDialog {...props}/>));
}
async function prepare() { await type('t_copy', text.newName); await click(text.preview); await type('db.t_copy'); await acknowledge(); }

describe('结构及数据复制真实对话框（内存ReactDOM）', () => {
  it('打开只读能力不自动预览或投递SQL；准确确认前按钮禁用，预览SQL只读', async () => {
    await mount(); expect(services.preview).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled();
    await type('t_copy', text.newName); await click(text.preview); expect(button(text.apply).disabled).toBe(true); expect(document.querySelector('textarea[aria-label="预览SQL"]')!.getAttribute('readonly')).not.toBeNull();
    await acknowledge(); for (const value of ['db.T_copy', ' db.t_copy', 'db.t_copy ', 'db.t_copy;']) { await type(value); expect(button(text.apply).disabled).toBe(true); }
    await type('db.t_copy'); expect(button(text.apply).disabled).toBe(false); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('同事件双击仅投递一次；参数仅含token、准确确认、三项风险及编号', async () => {
    await mount(); await prepare(); await click(text.apply, true); expect(services.apply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(services.apply).mock.calls[0][0]).toEqual({ mode: 'structure-and-data', previewToken: 'p', confirmation: 'db.t_copy', acknowledgements: [...tableCopyDataAcknowledgements], taskId: expect.any(String) });
    expect(button(text.apply).disabled).toBe(true); expect(props.onApplied).toHaveBeenCalledTimes(1); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('取消预览先释放token，确认文字复制结构，不会执行', async () => {
    await mount(); await prepare(); await click(text.back); expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.apply).not.toHaveBeenCalled();
    await type('t_copy', text.newName); await click(text.preview); expect(document.querySelector(`textarea[aria-label="${text.confirmation}"]`)!.value).toBe(''); expect(button(text.apply).disabled).toBe(true);
  });
  it('执行前新草稿阻断并消费本地令牌，不发送且不误报未知', async () => {
    await mount(); await prepare(); vi.mocked(props.beforeApply).mockImplementation(() => { throw Error('新数据草稿'); }); await click(text.apply);
    expect(services.apply).not.toHaveBeenCalled(); expect(props.onExecutionUncertain).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true);
  });
  it.each(['target', 'version'] as const)('预览后%s变化，执行按钮立即禁用', async change => {
    await mount(); await prepare(); props = change === 'target' ? { ...props, target: { ...target, table: 'other' } } : { ...props, targetVersion: 2 };
    await act(async () => root!.render(<TableCopyDataDialog {...props}/>)); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('未知结果仍保留退出保护与原目标回调，不自动重试', async () => {
    await mount(); await prepare(); vi.mocked(services.apply).mockRejectedValueOnce(Error('连接中断')); await click(text.apply);
    expect(props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown, 't_copy'); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true); expect(services.apply).toHaveBeenCalledTimes(1);
  });
  it('已完成但后核验失败保留完成回调，不伪造回滚或再次发送', async () => {
    await mount(); await prepare(); vi.mocked(services.apply).mockResolvedValueOnce({ mode: 'structure-and-data' as const, target, newTarget: { ...target, table: 't_copy' }, ddlSubmitted: true, ddlCompleted: true, dataSubmitted: true, insertCompleted: true, commitSubmitted: true, dataCompleted: true, definitionVerified: false, warnings: [] }); await click(text.apply);
    expect(props.onApplied).toHaveBeenCalledWith(expect.objectContaining({ ddlCompleted: true, definitionVerified: false })); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true);
  });
  it('取消响应不提前解除忙碌；原任务终态到来后才允许关闭', async () => {
    await mount(); await prepare(); const pending = deferred<Awaited<ReturnType<TableCopyDataServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(services.cancel).toHaveBeenCalledTimes(1);
    await act(async () => { listener?.({ taskId: vi.mocked(services.apply).mock.calls[0][0].taskId, progress: { phase: 'releasing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } }); pending.reject(Error('实际取消终态')); });
    expect(button(text.close).disabled).toBe(false); expect(props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown, 't_copy');
  });
  it('数据提交成功后关闭失败仍按可信进度回调创建事实并刷新，不能回报未创建', async () => {
    await mount(); await prepare(); const pending = deferred<Awaited<ReturnType<TableCopyDataServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply);
    await act(async () => { listener?.({ taskId: vi.mocked(services.apply).mock.calls[0][0].taskId, progress: { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, dataSubmitted: true, insertCompleted: true, commitSubmitted: true, dataCompleted: true, definitionVerified: true, outcome: 'succeeded' } }); pending.reject(Error('连接关闭失败')); });
    expect(props.onApplied).toHaveBeenCalledWith(expect.objectContaining({ mode: 'structure-and-data' as const, target, newTarget: { ...target, table: 't_copy' }, ddlCompleted: true, definitionVerified: true })); expect(props.onExecutionUncertain).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true); expect(services.apply).toHaveBeenCalledTimes(1);
  });
  it('首片不支持的来源完整定义只读展示，并明确显示原因', async () => {
    await mount({ get: async () => ({ ...snapshot(), writable: false, reasons: ['含自增列，首片只读'] }) });
    expect(document.querySelector('textarea[aria-label="预览SQL"]')!.value).toBe(snapshot().sourceDdl); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain('含自增列，首片只读'); expect(services.preview).not.toHaveBeenCalled();
  });
  it('已有预览到期同步禁执行，不能借已填确认文字重放', async () => {
    const nativeSet = window.setTimeout, nativeClear = window.clearTimeout;
    vi.useFakeTimers(); Object.assign(window, { setTimeout, clearTimeout });
    try { await mount(); await prepare(); await act(async () => { await vi.advanceTimersByTimeAsync(110001); }); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled(); }
    finally { vi.useRealTimers(); Object.assign(window, { setTimeout: nativeSet, clearTimeout: nativeClear }); }
  });
  it('释放失败不关闭窗口，明确再次关闭才重试释放而非执行', async () => {
    await mount(); await prepare(); vi.mocked(services.release).mockRejectedValueOnce(Error('释放失败')); await click(text.close); expect(props.onClose).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled(); await click(text.close); expect(props.onClose).toHaveBeenCalledTimes(1); expect(services.apply).not.toHaveBeenCalled();
  });
  it('卸载后迟到预览只释放令牌，不复活界面或自动apply', async () => {
    const pending = deferred<TableCopyDataPreviewOutput>(); await mount({ preview: () => pending.promise }); await type('t_copy', text.newName); await click(text.preview);
    await act(async () => { root!.unmount(); root = undefined; }); await act(async () => pending.resolve(preview()));
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.cancel).toHaveBeenCalledTimes(1); expect(services.apply).not.toHaveBeenCalled();
  });
  it('StrictMode旧get迟到仅释放原token，不能覆盖新快照', async () => {
    const first = deferred<TableCopyDataGetOutput>(); let count = 0; await mount({ strict: true, get: async () => ++count === 1 ? first.promise : { ...snapshot(), snapshotId: 'new' } });
    await act(async () => root!.render(<StrictMode><TableCopyDataDialog key="重新挂载" {...props}/></StrictMode>));
    await act(async () => first.resolve({ ...snapshot(), snapshotId: 'late' })); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late' });
    await type('t_copy', text.newName); await click(text.preview); expect(vi.mocked(services.preview).mock.calls[0][0].snapshotId).toBe('new'); expect(services.apply).not.toHaveBeenCalled();
  });
  it.each(['wrong-target','wrong-hash','expired','unknown-ack'] as const)('拒绝预览响应%s，不产生可执行授权', async reason => {
    await mount({ preview: async () => ({ ...preview(), ...(reason === 'wrong-target' ? { target: { ...target, table: 'other' } } : reason === 'wrong-hash' ? { ddlHash: 'other' } : reason === 'expired' ? { expiresAt: new Date(0).toISOString() } : { requiredAcknowledgements: ['__proto__'] }) }) });
    await type('t_copy', text.newName); await click(text.preview); expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' });
    expect(services.apply).not.toHaveBeenCalled();
  });
  it('五项数据确认未全部勾选不能发送，空表风险不能替代', async () => {
    await mount(); await type('t_copy', text.newName); await click(text.preview); await type('db.t_copy');
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(5);
    await act(async () => { for (const node of document.querySelectorAll('input[type="checkbox"]').slice(0, 4)) { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); } });
    expect(button(text.apply).disabled).toBe(true); await acknowledge(); await click(text.apply); expect(services.apply).toHaveBeenCalledTimes(1);
  });
  it('仅建表完成且传输失败时报告数据未确认，不能回调数据成功', async () => {
    await mount(); await prepare(); const pending = deferred<Awaited<ReturnType<TableCopyDataServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply); await act(async () => { listener?.({ taskId: vi.mocked(services.apply).mock.calls[0][0].taskId, progress: { phase: 'executing', ddlSubmitted: true, ddlCompleted: true, dataSubmitted: true, commitSubmitted: true, dataCompleted: false, definitionVerified: true, outcome: 'unknown' } }); pending.reject(Error('提交ACK丢失')); });
    expect(props.onApplied).not.toHaveBeenCalled(); expect(props.onExecutionUncertain).toHaveBeenCalledWith(text.verificationFailed, 't_copy'); expect(button(text.apply).disabled).toBe(true); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
