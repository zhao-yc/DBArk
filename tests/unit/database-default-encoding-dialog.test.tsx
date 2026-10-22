import { act, StrictMode, type ComponentProps } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseDefaultEncodingDialog, type DatabaseDefaultEncodingServices } from '../../src/renderer/components/DatabaseDefaultEncodingDialog';
import { databaseDefaultEncodingAcknowledgements, type DatabaseDefaultEncodingGetOutput, type DatabaseDefaultEncodingPreviewOutput, type DatabaseDefaultEncodingApplyOutput } from '../../src/shared/databaseDefaultEncoding';
import { databaseDefaultEncodingZh as text } from '../../src/renderer/locales/databaseDefaultEncoding.zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

// Monaco自身不属于属性工作流；保留真实Modal、React状态、正式事件闭包与请求围栏。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre data-readonly={String(readOnly)}>{value}</pre> }));
const target = { connectionId: 'conn', database: '测试数据库' }, before = { charset: 'utf8mb4', collation: 'utf8mb4_bin' }, after = { charset: 'latin1', collation: 'latin1_bin' };
const expiresAt = () => new Date(Date.now() + 60_000).toISOString();
/** 返回服务真实合同形状，不从界面草稿生成另一份实现。 */
const snapshot = (id = 'snapshot'): DatabaseDefaultEncodingGetOutput => ({ target, snapshotId: id, expiresAt: expiresAt(), definitionHash: 'definition', catalogDigest: 'catalog', current: before, candidates: [before, { ...before, collation: 'utf8mb4_general_ci' }, after], writable: true, reasons: [], warnings: [], serverVersion: '8.4.11' });
const preview = (id = 'preview'): DatabaseDefaultEncodingPreviewOutput => ({ target, before, after, previewToken: id, expiresAt: expiresAt(), definitionHash: 'definition', catalogDigest: 'catalog', sql: 'ALTER DATABASE `测试数据库` CHARACTER SET latin1 COLLATE latin1_bin;', warnings: [], requiredAcknowledgements: [...databaseDefaultEncodingAcknowledgements] });
const result = (): DatabaseDefaultEncodingApplyOutput => ({ target, before, after, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, warnings: [] });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeAll(async () => {
  document = memoryDocument(); Object.assign(window, { setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id), confirm: () => true }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name);
    if (name === 'option') {
      let selected = false;
      Object.defineProperty(node, 'value', { configurable: true, get: () => node.attributes.get('value') ?? node.textContent, set: value => node.attributes.set('value', String(value)) });
      Object.defineProperty(node, 'selected', { get: () => selected, set: value => { selected = !!value; if (selected && node.parentNode?.tagName === 'SELECT') for (const option of node.parentNode.querySelectorAll('option')) if (option !== node) (option as any).selected = false; } });
    }
    if (name === 'select') { Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') }); Object.defineProperty(node, 'value', { configurable: true, get: () => node.querySelectorAll('option').find(option => (option as any).selected)?.value ?? '', set: value => { for (const option of node.querySelectorAll('option')) (option as any).selected = option.value === value; } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.textContent = ''; vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
function serviceFixture() {
  let listener: Parameters<DatabaseDefaultEncodingServices['subscribe']>[0] | undefined;
  const services: DatabaseDefaultEncodingServices = { get: vi.fn().mockResolvedValue(snapshot()), preview: vi.fn().mockResolvedValue(preview()), apply: vi.fn().mockResolvedValue(result()), release: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), subscribe: value => { listener = value; return () => { listener = undefined; }; } };
  return { services, emit: (progress: Parameters<NonNullable<typeof listener>>[0]['progress']) => listener?.({ taskId: (services.apply as any).mock.calls.at(-1)?.[0].taskId ?? (services.get as any).mock.calls.at(-1)?.[0].taskId, progress }) };
}
async function mount(patch: Partial<ComponentProps<typeof DatabaseDefaultEncodingDialog>> = {}, strict = false) {
  const f = serviceFixture(); let props: ComponentProps<typeof DatabaseDefaultEncodingDialog> = { target, targetVersion: 1, services: f.services, onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), beforeApply: vi.fn(), onApplied: vi.fn(), onExecutionUncertain: vi.fn(), ...patch };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const render = () => strict ? <StrictMode><DatabaseDefaultEncodingDialog {...props}/></StrictMode> : <DatabaseDefaultEncodingDialog {...props}/>;
  await act(async () => root!.render(render()));
  return { ...f, services: props.services, props, async update(value: Partial<typeof props>) { props = { ...props, ...value }; await act(async () => root!.render(render())); } };
}
function button(label: string) { const node = document.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
function field(label: string) { const node = document.querySelector(`[aria-label="${label}"]`); expect(node, label).not.toBeNull(); return node!; }
function reactProps(node: ReturnType<typeof field>) { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); expect(key).toBeDefined(); return (node as any)[key!]; }
async function click(label: string) { await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function change(label: string, value: string) { await act(async () => reactProps(field(label)).onChange({ target: { value } })); }
async function selectPair() { await change(text.charset, 'latin1'); await change(text.collation, 'latin1_bin'); }
async function prepare() { await selectPair(); await click(text.preview); }
async function confirm() { await change(text.confirmation, target.database); await act(async () => { const boxes = document.querySelectorAll('input').filter(node => node.type === 'checkbox'); expect(boxes).toHaveLength(3); for (const node of boxes) reactProps(node).onChange({ target: { checked: true } }); }); }

describe('数据库默认编码真实React属性流程', () => {
  it('原默认值直接展示，未修改不可预览，未生成预览不可执行', async () => {
    const f = await mount(); expect(field(text.charset).value).toBe(before.charset); expect(field(text.collation).value).toBe(before.collation); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain(text.scope); expect(f.services.apply).not.toHaveBeenCalled(); expect(f.props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('字符集变化清空旧规则，只允许真实完整配对且恢复原值消草稿', async () => {
    const f = await mount(); await change(text.charset, 'latin1'); expect(field(text.collation).value).toBe(''); expect(button(text.preview).disabled).toBe(true); await change(text.collation, 'utf8mb4_bin'); expect(button(text.preview).disabled).toBe(true); await change(text.collation, 'latin1_bin'); expect(button(text.preview).disabled).toBe(false); expect(f.props.onDirtyChange).toHaveBeenLastCalledWith(true); await change(text.charset, before.charset); await change(text.collation, before.collation); expect(button(text.preview).disabled).toBe(true); expect(f.props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('SQL只读且确认精确库名与三风险全部勾选，原Promise同步防双击', async () => {
    const pending = deferred<DatabaseDefaultEncodingApplyOutput>(), f = await mount(); vi.mocked(f.services.apply).mockReturnValue(pending.promise); await prepare(); expect(document.querySelector('pre')?.getAttribute('data-readonly')).toBe('true'); expect(document.body.textContent).toContain(preview().sql); await confirm(); await change(text.confirmation, target.database + ' '); expect(button(text.apply).disabled).toBe(true); await change(text.confirmation, target.database); expect(button(text.apply).disabled).toBe(false);
    const execute = reactProps(button(text.apply)).onClick; await act(async () => { execute(); execute(); }); expect(f.services.apply).toHaveBeenCalledTimes(1); expect(vi.mocked(f.services.apply).mock.calls[0][0]).toMatchObject({ previewToken: 'preview', confirmation: target.database, acknowledgements: [...databaseDefaultEncodingAcknowledgements] }); expect(button(text.close).disabled).toBe(true); await act(async () => pending.resolve(result())); expect(f.props.onApplied).toHaveBeenCalledExactlyOnceWith(result()); expect(document.body.textContent).toContain(text.succeeded); expect(button(text.apply).disabled).toBe(true);
  });
  it('返回编辑撤销令牌与确认，选择变更不能偷带旧SQL或风险确认', async () => {
    const f = await mount(); await prepare(); await confirm(); await click(text.back); expect(f.services.release).toHaveBeenCalledWith({ previewToken: 'preview' }); expect(document.querySelector('pre')).toBeNull(); await click(text.preview); expect(field(text.confirmation).value).toBe(''); expect(document.querySelectorAll('input').filter(node => node.type === 'checkbox').every(node => !node.checked)).toBe(true); expect(button(text.apply).disabled).toBe(true);
  });
  it('已确认旧执行/勾选/输入事件不能授权新预览；旧关闭也重新检查当前草稿', async () => {
    const f = await mount(), oldClose = reactProps(button(text.close)).onClick; await prepare(); await confirm(); const oldApply = reactProps(button(text.apply)).onClick, oldInput = reactProps(field(text.confirmation)).onChange, oldChecks = document.querySelectorAll('input').filter(node => node.type === 'checkbox').map(node => reactProps(node).onChange);
    await click(text.back); vi.mocked(f.services.preview).mockResolvedValue(preview('new')); await click(text.preview);
    await act(async () => { oldInput({ target: { value: target.database } }); for (const callback of oldChecks) callback({ target: { checked: true } }); oldApply(); }); expect(f.services.apply).not.toHaveBeenCalled(); expect(field(text.confirmation).value).toBe(''); expect(button(text.apply).disabled).toBe(true);
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false); await act(async () => oldClose()); expect(confirmation).toHaveBeenCalledWith(text.discard); expect(f.props.onClose).not.toHaveBeenCalled();
  });
  it.each(['definitionHash', 'catalogDigest'] as const)('预览%s变化拒绝响应并精确释放迟到令牌', async key => {
    const f = await mount(); vi.mocked(f.services.preview).mockResolvedValue({ ...preview('mismatch'), [key]: 'changed' }); await prepare(); expect(f.services.release).toHaveBeenCalledWith({ previewToken: 'mismatch' }); expect(document.querySelector('pre')).toBeNull(); expect(document.body.textContent).toContain(text.mismatch); expect(f.services.apply).not.toHaveBeenCalled();
  });
  it('未知或重复风险ID不能激活执行，即使伪造全部勾选事件', async () => {
    const f = await mount(); vi.mocked(f.services.preview).mockResolvedValue({ ...preview(), requiredAcknowledgements: ['ddl-implicit-commit', 'database-default-only', 'constructor'] }); await prepare(); await confirm(); expect(button(text.apply).disabled).toBe(true); await click(text.apply); expect(f.services.apply).not.toHaveBeenCalled();
  });
  it('取消只控制请求，原get结束前关闭和重读均锁住，响应仅释放', async () => {
    const pending = deferred<DatabaseDefaultEncodingGetOutput>(), services = serviceFixture().services; vi.mocked(services.get).mockReturnValue(pending.promise); const f = await mount({ services }); await click(text.cancel); expect(services.cancel).toHaveBeenCalledTimes(1); expect(button(text.close).disabled).toBe(true); await click(text.close); await act(async () => document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }))); expect(f.props.onClose).not.toHaveBeenCalled(); await act(async () => pending.resolve(snapshot('late'))); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'late' }); expect(document.body.textContent).not.toContain('8.4.11'); expect(button(text.close).disabled).toBe(false);
  });
  it('连接修订A→B→A也不复活旧能力与响应', async () => {
    const pending = deferred<DatabaseDefaultEncodingPreviewOutput>(), f = await mount(); vi.mocked(f.services.preview).mockReturnValue(pending.promise); await prepare(); await f.update({ targetVersion: 2 }); await f.update({ targetVersion: 1 }); await act(async () => pending.resolve(preview('old'))); expect(f.services.release).toHaveBeenCalledWith({ previewToken: 'old' }); expect(document.body.textContent).toContain(text.targetChanged); expect(button(text.preview).disabled).toBe(true); expect(document.querySelector('pre')).toBeNull();
  });
  it('卸载之后晚到get仅清理，不回调执行或新窗口', async () => {
    const pending = deferred<DatabaseDefaultEncodingGetOutput>(), services = serviceFixture().services; vi.mocked(services.get).mockReturnValue(pending.promise); const f = await mount({ services }); await act(async () => root!.unmount()); root = undefined; await act(async () => pending.resolve(snapshot('unmounted'))); expect(services.release).toHaveBeenCalledWith({ snapshotId: 'unmounted' }); expect(f.props.onApplied).not.toHaveBeenCalled(); expect(f.props.onClose).not.toHaveBeenCalled();
  });
  it('StrictMode旧代次在清理await后不再发送get，新代次独立接收并释放能力', async () => {
    const pending = deferred<DatabaseDefaultEncodingGetOutput>(), services = serviceFixture().services; vi.mocked(services.get).mockReturnValueOnce(pending.promise); await mount({ services }, true); expect(services.get).toHaveBeenCalledTimes(1); await act(async () => pending.resolve(snapshot('new'))); expect(services.release).not.toHaveBeenCalledWith({ snapshotId: 'new' }); expect(field(text.charset).value).toBe(before.charset); await click(text.close); expect(services.release).toHaveBeenCalledExactlyOnceWith({ snapshotId: 'new' });
  });
  it('快照到期禁用已有预览，旧点击闭包也不能发DDL', async () => {
    vi.useFakeTimers(); const f = await mount(); await prepare(); await confirm(); const old = reactProps(button(text.apply)).onClick; await act(async () => vi.advanceTimersByTime(60_002)); expect(button(text.apply).disabled).toBe(true); await act(async () => old()); expect(f.services.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.expired);
  });
  it('写入错误标未知并永久消费本预览，不自动重试，明确重新读取核验', async () => {
    const f = await mount(); vi.mocked(f.services.apply).mockRejectedValue(Error('断线')); await prepare(); await confirm(); await click(text.apply); expect(f.services.apply).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain(text.unknown); expect(f.props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown); expect(button(text.apply).disabled).toBe(true); await click(text.apply); expect(f.services.apply).toHaveBeenCalledTimes(1);
  });
  it('取消执行不解除原写请求锁，迟到成功仍保留真实完成事实', async () => {
    const f = await mount(), pending = deferred<DatabaseDefaultEncodingApplyOutput>(); vi.mocked(f.services.apply).mockReturnValue(pending.promise); await prepare(); await confirm(); await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(f.services.cancel).toHaveBeenCalledTimes(1); expect(f.props.onApplied).not.toHaveBeenCalled(); await act(async () => pending.resolve(result())); expect(f.props.onApplied).toHaveBeenCalledExactlyOnceWith(result()); expect(document.body.textContent).toContain(text.succeeded); expect(button(text.apply).disabled).toBe(true);
  });
  it('服务返回另一目标不投影为成功，按可能写入保留核验提示', async () => {
    const f = await mount(); vi.mocked(f.services.apply).mockResolvedValue({ ...result(), target: { ...target, database: '另一库' } }); await prepare(); await confirm(); await click(text.apply); expect(f.props.onApplied).not.toHaveBeenCalled(); expect(f.props.onExecutionUncertain).toHaveBeenCalledWith(text.unknown); expect(document.body.textContent).toContain(text.mismatch);
  });
  it('核验失败保留实际读回的不同编码与DDL回执，本预览不可重试', async () => {
    const f = await mount(), actual = { charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }, received = { ...result(), definitionVerified: false, after: actual }; vi.mocked(f.services.apply).mockResolvedValue(received); await prepare(); await confirm(); await click(text.apply); expect(f.props.onApplied).toHaveBeenCalledExactlyOnceWith(received); expect(f.props.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(`${text.actual}：utf8mb4 / utf8mb4_general_ci`); expect(document.body.textContent).toContain(text.verificationFailed); expect(button(text.apply).disabled).toBe(true); await click(text.apply); expect(f.services.apply).toHaveBeenCalledTimes(1);
  });
  it('正式apply消费预览后关闭只释放原快照，绝不释放失去权限的旧预览', async () => {
    const f = await mount(); vi.mocked(f.services.release).mockImplementation(async input => { if (input.previewToken) throw Error('预览已消费，不能释放'); }); await prepare(); await confirm(); await click(text.apply); await click(text.close); expect(f.props.onClose).toHaveBeenCalledTimes(1); expect(f.services.release).toHaveBeenCalledExactlyOnceWith({ snapshotId: 'snapshot' });
  });
  it('只读权限明确展示原因，即使注入选择事件也不生成预览', async () => {
    const services = serviceFixture().services; vi.mocked(services.get).mockResolvedValue({ ...snapshot(), writable: false, reasons: ['没有ALTER权限'] }); await mount({ services }); expect(document.body.textContent).toContain('没有ALTER权限'); expect(field(text.charset).disabled).toBe(true); await selectPair(); await click(text.preview); expect(services.preview).not.toHaveBeenCalled();
  });
  it('宿主完成回调失败只提示刷新错误，保留已核验的DDL完成事实', async () => {
    const f = await mount({ onApplied: () => { throw Error('刷新失败'); } }); await prepare(); await confirm(); const oldBack = reactProps(button(text.back)).onClick; await click(text.apply); expect(document.body.textContent).toContain(text.succeeded); expect(document.body.textContent).toContain('刷新失败'); expect(f.props.onExecutionUncertain).not.toHaveBeenCalled(); await act(async () => oldBack()); expect(document.querySelector('pre')?.textContent).toBe(preview().sql); expect(f.services.apply).toHaveBeenCalledTimes(1);
  });
  it('执行前宿主保护失败证明未发送，不把本地错误冒充服务已完成', async () => {
    const f = await mount({ beforeApply: () => { throw Error('在途结构任务'); } }); await prepare(); await confirm(); await click(text.apply); expect(f.services.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent); expect(f.props.onExecutionUncertain).not.toHaveBeenCalled();
  });
  it('关闭等待释放原Promise；释放失败保留窗口并允许明确再次清理', async () => {
    const pending = deferred<void>(), f = await mount(); vi.mocked(f.services.release).mockReturnValueOnce(pending.promise); await click(text.close); expect(f.props.onClose).not.toHaveBeenCalled(); expect(button(text.close).disabled).toBe(true); await act(async () => pending.reject(Error('释放失败'))); expect(f.props.onClose).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('释放失败'); await click(text.close); expect(f.props.onClose).toHaveBeenCalledTimes(1);
  });
});
