import { StrictMode, act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryNode, MemoryEvent } from '../fixtures/memory-dom';
import { TableTruncateDialog, type TableTruncateDialogProps, type TableTruncateServices } from '../../src/renderer/components/TableTruncateDialog';
import type { TableTruncateGetOutput, TableTruncatePreviewOutput, TableTruncateProgress } from '../../src/shared/tableTruncate';
import { tableTruncateAcknowledgements } from '../../src/shared/tableTruncate';
import { tableTruncateZh as text } from '../../src/renderer/locales/tableTruncate.zh-CN';

/** 仅替换Monaco显示端口；对话框、事件委派、异步围栏和生命周期均使用真实ReactDOM。 */
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="预览SQL" readOnly={readOnly} value={value}/> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let props: TableTruncateDialogProps, services: TableTruncateServices, listener: ((event: { taskId: string; progress: TableTruncateProgress }) => void) | undefined;
const target = { connectionId: '连接1', database: 'db', table: 't' };
const snapshot = (): TableTruncateGetOutput => ({ target, snapshotId: 's', expiresAt: new Date(Date.now() + 120000).toISOString(), ddlHash: 'hash', writable: true, reasons: [], warnings: ['数据不可回滚'], serverVersion: '8.4.11', engine: 'InnoDB', autoIncrement: '9' });
const preview = (): TableTruncatePreviewOutput => ({ target, previewToken: 'p', expiresAt: new Date(Date.now() + 110000).toISOString(), ddlHash: 'hash', sql: 'TRUNCATE TABLE `db`.`t`;', requiredAcknowledgements: [...tableTruncateAcknowledgements], warnings: [] });
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
async function type(value: string) { const node = document.querySelector(`input[aria-label="${text.confirmation}"]`)!; await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function acknowledge() { await act(async () => { for (const node of document.querySelectorAll('input[type="checkbox"]')) { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); } }); }
async function mount(options: { strict?: boolean; get?: TableTruncateServices['get']; preview?: TableTruncateServices['preview'] } = {}) {
  listener = undefined; services = { get: vi.fn(options.get ?? (async () => snapshot())), preview: vi.fn(options.preview ?? (async () => preview())), apply: vi.fn(async () => ({ ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  props = { target, targetVersion: 1, services, onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), beforeApply: vi.fn(), onApplied: vi.fn(), onExecutionUncertain: vi.fn() };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(options.strict ? <StrictMode><TableTruncateDialog {...props}/></StrictMode> : <TableTruncateDialog {...props}/>));
}
async function prepare() { await click(text.preview); await type('db.t'); await acknowledge(); }

describe('清空真实对话框反例（内存ReactDOM，不冒充原生验收）', () => {
  it('打开只读能力不自动预览或投递SQL；准确确认前按钮禁用，预览SQL只读', async () => {
    await mount(); expect(services.preview).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled();
    await click(text.preview); expect(button(text.apply).disabled).toBe(true); expect(document.querySelector('textarea[aria-label="预览SQL"]')!.getAttribute('readonly')).not.toBeNull();
    await acknowledge(); for (const value of ['db.T', ' db.t', 'db.t ', 'db.t;']) { await type(value); expect(button(text.apply).disabled).toBe(true); }
    await type('db.t'); expect(button(text.apply).disabled).toBe(false); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('同事件双击仅投递一次；参数仅含token、准确确认、三项风险及编号', async () => {
    await mount(); await prepare(); await click(text.apply, true); expect(services.apply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(services.apply).mock.calls[0][0]).toEqual({ previewToken: 'p', confirmation: 'db.t', acknowledgements: [...tableTruncateAcknowledgements], taskId: expect.any(String) });
    expect(button(text.apply).disabled).toBe(true); expect(props.onApplied).toHaveBeenCalledTimes(1); expect(props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('取消预览先释放token，确认文字清空，不会执行', async () => {
    await mount(); await prepare(); await click(text.back); expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.apply).not.toHaveBeenCalled();
    await click(text.preview); expect(document.querySelector(`input[aria-label="${text.confirmation}"]`)!.value).toBe(''); expect(button(text.apply).disabled).toBe(true);
  });
  it('执行前新草稿阻断并消费本地令牌，不发送且不误报未知', async () => {
    await mount(); await prepare(); vi.mocked(props.beforeApply).mockImplementation(() => { throw Error('新数据草稿'); }); await click(text.apply);
    expect(services.apply).not.toHaveBeenCalled(); expect(props.onExecutionUncertain).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(true);
  });
  it.each(['target', 'version'] as const)('预览后%s变化，执行按钮立即禁用', async change => {
    await mount(); await prepare(); props = change === 'target' ? { ...props, target: { ...target, table: 'other' } } : { ...props, targetVersion: 2 };
    await act(async () => root!.render(<TableTruncateDialog {...props}/>)); expect(button(text.apply).disabled).toBe(true); expect(services.apply).not.toHaveBeenCalled();
  });
  it('未知结果仍保留退出保护与原目标回调，不自动重试', async () => {
    await mount(); await prepare(); vi.mocked(services.apply).mockRejectedValueOnce(Error('连接中断')); await click(text.apply);
    expect(props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true); expect(services.apply).toHaveBeenCalledTimes(1);
  });
  it('已完成但后核验失败保留完成回调，不伪造回滚或再次发送', async () => {
    await mount(); await prepare(); vi.mocked(services.apply).mockResolvedValueOnce({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: [], verificationError: '后核未完成' }); await click(text.apply);
    expect(props.onApplied).toHaveBeenCalledWith(expect.objectContaining({ ddlCompleted: true, definitionVerified: false })); expect(props.onDirtyChange).toHaveBeenLastCalledWith(true); expect(button(text.apply).disabled).toBe(true);
  });
  it('取消响应不提前解除忙碌；原任务终态到来后才允许关闭', async () => {
    await mount(); await prepare(); const pending = deferred<Awaited<ReturnType<TableTruncateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(services.cancel).toHaveBeenCalledTimes(1);
    await act(async () => { listener?.({ taskId: vi.mocked(services.apply).mock.calls[0][0].taskId, progress: { phase: 'releasing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' } }); pending.reject(Error('实际取消终态')); });
    expect(button(text.close).disabled).toBe(false); expect(props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown);
  });
  it('卸载后迟到预览只释放令牌，不复活界面或自动apply', async () => {
    const pending = deferred<TableTruncatePreviewOutput>(); await mount({ preview: () => pending.promise }); await click(text.preview);
    await act(async () => { root!.unmount(); root = undefined; }); await act(async () => pending.resolve(preview()));
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.cancel).toHaveBeenCalledTimes(1); expect(services.apply).not.toHaveBeenCalled();
  });
  it('StrictMode旧get迟到仅释放原token，不能覆盖新快照', async () => {
    const first = deferred<TableTruncateGetOutput>(); let count = 0; await mount({ strict: true, get: async () => ++count === 1 ? first.promise : { ...snapshot(), snapshotId: 'new' } });
    await act(async () => root!.render(<StrictMode><TableTruncateDialog key="重新挂载" {...props}/></StrictMode>));
    await act(async () => first.resolve({ ...snapshot(), snapshotId: 'late' })); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late' });
    await click(text.preview); expect(vi.mocked(services.preview).mock.calls[0][0].snapshotId).toBe('new'); expect(services.apply).not.toHaveBeenCalled();
  });
  it.each(['wrong-target','wrong-hash','expired','unknown-ack'] as const)('拒绝预览响应%s，不产生可执行授权', async reason => {
    await mount({ preview: async () => ({ ...preview(), ...(reason === 'wrong-target' ? { target: { ...target, table: 'other' } } : reason === 'wrong-hash' ? { ddlHash: 'other' } : reason === 'expired' ? { expiresAt: new Date(0).toISOString() } : { requiredAcknowledgements: ['__proto__'] }) }) });
    await click(text.preview); if (reason === 'unknown-ack') { await type('db.t'); expect(button(text.apply).disabled).toBe(true); } else expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' });
    expect(services.apply).not.toHaveBeenCalled();
  });
});
