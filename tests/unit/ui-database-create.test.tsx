import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { DatabaseCreateServices } from '../../src/renderer/components/DatabaseCreateDialog';
import { databaseCreateAcknowledgements, type DatabaseCreateGetOutput, type DatabaseCreatePreviewOutput } from '../../src/shared/databaseCreate';
import { databaseCreateZh as text } from '../../src/renderer/locales/databaseCreate.zh-CN';

/** 仅替换Monaco显示；表单、React事件、异步围栏及卸载运行真实组件。 */
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <textarea aria-label="预览SQL" readOnly={readOnly} value={value}/> }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let DatabaseCreateDialog: typeof import('../../src/renderer/components/DatabaseCreateDialog')['DatabaseCreateDialog'], useWorkspace: typeof import('../../src/renderer/store')['useWorkspace'];
let services: DatabaseCreateServices, listener: Parameters<DatabaseCreateServices['subscribe']>[0] | undefined, applied: ReturnType<typeof vi.fn>, dirty: ReturnType<typeof vi.fn>;
const snapshot = (): DatabaseCreateGetOutput => ({ target: { connectionId: 'c' }, snapshotId: 's', expiresAt: new Date(Date.now() + 120000).toISOString(), catalogDigest: 'catalog', candidates: [{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }, { charset: 'latin1', collation: 'latin1_bin' }], writable: true, reasons: [], warnings: [], serverVersion: '8.4.11' });
const preview = (): DatabaseCreatePreviewOutput => ({ target: { connectionId: 'c' }, name: 'new_db', selection: { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, catalogDigest: 'catalog', previewToken: 'p', expiresAt: new Date(Date.now() + 110000).toISOString(), sql: 'CREATE DATABASE `new_db` CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin`;', requiredAcknowledgements: [...databaseCreateAcknowledgements], warnings: [] });
/** 控制异步回包顺序，不使用网络、原生GUI或真实数据库。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; Object.assign(window, { setTimeout, clearTimeout, confirm: vi.fn(() => true) });
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'input') { let kind = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => kind, set: value => { kind = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    // 内存端口只反射选项和布尔属性；选择逻辑仍由生产受控select和React事件完成。
    if (name === 'option') Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', value) });
    if (name === 'select') {
      Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } });
    }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
  ({ DatabaseCreateDialog } = await import('../../src/renderer/components/DatabaseCreateDialog')); ({ useWorkspace } = await import('../../src/renderer/store'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 只操作实际内存DOM节点和事件，不调用组件内部处理器。 */
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); if (!node) throw Error('缺少按钮：' + label); return node; }
async function click(label: string, twice = false) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); if (twice) node.dispatchEvent(new MemoryEvent('click')); }); }
async function input(label: string, value: string, select = false) { const node = document.querySelector(`${select ? 'select' : 'input'}[aria-label="${label}"]`)!; expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent(select ? 'change' : 'input')); }); }
async function mount(options: { get?: DatabaseCreateServices['get']; preview?: DatabaseCreateServices['preview'] } = {}) {
  useWorkspace.setState({ connectionVersions: { c: 1 } }); applied = vi.fn(); dirty = vi.fn();
  services = { get: vi.fn(options.get ?? (async () => snapshot())), preview: vi.fn(options.preview ?? (async () => preview())), apply: vi.fn(async () => ({ name: 'new_db', ddlSubmitted: true as const, ddlCompleted: true as const, definitionVerified: true, warnings: [] })), release: vi.fn(async () => {}), cancel: vi.fn(async () => {}), subscribe: fn => { listener = fn; return () => { listener = undefined; }; } };
  const container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container as unknown as Element);
  await act(async () => root!.render(<DatabaseCreateDialog connectionId="c" services={services} onClose={vi.fn()} onApplied={applied} onDirtyChange={dirty}/>));
}
async function prepare() { await input(text.name, 'new_db'); await input(text.charset, 'utf8mb4', true); await input(text.collation, 'utf8mb4_bin', true); await click(text.preview); }
async function confirm() { await input(text.confirmation, 'new_db'); await act(async () => { for (const node of document.querySelectorAll('input[type="checkbox"]')) { node.checked = true; node.dispatchEvent(new MemoryEvent('click')); } }); }
describe('新建库真实ReactDOM内存反例（不代替原生验收）', () => {
  it('目录无自动选择和写入，配对明确选择且确认完整后只创建一次', async () => {
    await mount(); expect(services.preview).not.toHaveBeenCalled(); expect(services.apply).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(true);
    await prepare(); expect(document.querySelector('textarea')?.getAttribute('readonly')).not.toBeNull(); expect(button(text.apply).disabled).toBe(true);
    await input(text.confirmation, 'new_db '); expect(button(text.apply).disabled).toBe(true); await confirm(); await click(text.apply, true);
    expect(services.apply).toHaveBeenCalledTimes(1); expect(applied).toHaveBeenCalledOnce(); expect(button(text.apply).disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('切换字符集清空排序规则，不能沿旧配对预览', async () => {
    await mount(); await input(text.name, 'new_db'); await input(text.charset, 'utf8mb4', true); await input(text.collation, 'utf8mb4_bin', true);
    await input(text.charset, 'latin1', true); expect(button(text.preview).disabled).toBe(true); expect(services.preview).not.toHaveBeenCalled();
    expect(document.querySelector(`select[aria-label="${text.collation}"]`)!.textContent).not.toContain('utf8mb4_bin');
  });
  it('连接修订变化立即禁用旧预览，不清除本地草稿或自动重读', async () => {
    await mount(); await prepare(); await confirm(); await act(async () => { useWorkspace.setState({ connectionVersions: { c: 2 } }); });
    expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.mismatch); expect(services.get).toHaveBeenCalledTimes(1); expect(services.apply).not.toHaveBeenCalled();
  });
  it('取消不能提前解除执行锁；无完成证明的失败保持未知并禁止重放', async () => {
    await mount(); await prepare(); await confirm(); const pending = deferred<Awaited<ReturnType<DatabaseCreateServices['apply']>>>(); vi.mocked(services.apply).mockReturnValueOnce(pending.promise);
    await click(text.apply, true); await click(text.cancel); expect(button('关闭').disabled).toBe(true); expect(button(text.read).disabled).toBe(true);
    await act(async () => pending.reject(Error('连接中断'))); expect(document.body.textContent).toContain(text.unknown); expect(button(text.apply).disabled).toBe(true); expect(services.apply).toHaveBeenCalledTimes(1); expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('明确未投递事件不伪装未知，DDL完成后后核失败仍刷新对象树', async () => {
    await mount(); await prepare(); await confirm(); vi.mocked(services.apply).mockImplementationOnce(async input => { listener?.(input.taskId, { phase: 'rechecking', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }); throw Error('目录变化'); });
    await click(text.apply); expect(document.body.textContent).toContain(text.notSent); expect(applied).not.toHaveBeenCalled();
    await act(async () => root!.unmount()); root = undefined; await mount(); await prepare(); await confirm();
    vi.mocked(services.apply).mockResolvedValueOnce({ name: 'new_db', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, warnings: ['后核失败'] });
    await click(text.apply); expect(applied).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.unverified); expect(button(text.apply).disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('卸载后迟到预览只释放令牌，不能变成可执行创建', async () => {
    const pending = deferred<DatabaseCreatePreviewOutput>(); await mount({ preview: async () => pending.promise });
    await input(text.name, 'new_db'); await input(text.charset, 'utf8mb4', true); await input(text.collation, 'utf8mb4_bin', true); await click(text.preview);
    await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve(preview()));
    expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.apply).not.toHaveBeenCalled();
  });
  it('关闭失败的Promise不能抹掉已核验完成事件，仍刷新且禁止重放', async () => {
    await mount(); await prepare(); await confirm();
    vi.mocked(services.apply).mockImplementationOnce(async input => { listener?.(input.taskId, { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' }); throw Error('关闭失败'); });
    await click(text.apply); expect(applied).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.succeeded); expect(button(text.apply).disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('目录只读和响应目标不一致均不能执行，错误响应令牌被释放', async () => {
    await mount({ get: async () => ({ ...snapshot(), writable: false, reasons: ['目录截断'] }) }); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain('目录截断');
    await act(async () => root!.unmount()); root = undefined; await mount({ preview: async () => ({ ...preview(), target: { connectionId: 'other' } }) });
    await input(text.name, 'new_db'); await input(text.charset, 'utf8mb4', true); await input(text.collation, 'utf8mb4_bin', true); await click(text.preview);
    expect(document.body.textContent).toContain(text.previewMismatch); expect(services.release).toHaveBeenCalledWith({ previewToken: 'p' }); expect(services.apply).not.toHaveBeenCalled();
  });
});
