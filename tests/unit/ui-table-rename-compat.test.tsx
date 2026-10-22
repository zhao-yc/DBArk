import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TableRenameApplyOutput, TableRenameGetOutput, TableRenamePreviewOutput } from '../../src/shared/tableRename';
import { tableRenameAcknowledgements } from '../../src/shared/tableRename';
import { tableRenameZh as text } from '../../src/renderer/locales/tableRename.zh-CN';
import type { TableRenameServices } from '../../src/renderer/components/TableRenameDialog';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

// 只替换Monaco显示端口；实际React、Modal、输入、风险确认、生命周期及服务调用保持产品实现。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="只读重命名SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/TableRenameDialog')['TableRenameDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);

beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    // 只补标准HTML属性反射，不伪造布局、焦点、系统输入或服务器返回值。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  ({ createRoot } = await import('react-dom/client')); ({ TableRenameDialog: Dialog } = await import('../../src/renderer/components/TableRenameDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 各版本在本文件只注入服务能力，用于证明界面不猜版本；不构成实库兼容证据。 */
function snapshot(serverVersion = '5.7.44'): TableRenameGetOutput {
  return { target: { connectionId: 'rename-memory', database: 'db', table: 'subject' }, snapshotId: 'rename-source', ddlHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), tableId: '9007199254740993', engine: 'InnoDB', rowFormat: 'Dynamic', charset: 'utf8mb4', collation: 'utf8mb4_bin', autoIncrement: '9007199254740994', writable: true, reasons: [], warnings: [], serverVersion };
}
/** 服务替身只记录请求，SQL由服务生成，不通过测试修改组件state或调用内部方法。 */
async function mount(initial = snapshot(), firstRead?: Promise<TableRenameGetOutput>) {
  let serial = 0, version = 1;
  const plans = new Map<string, TableRenamePreviewOutput>();
  const get = vi.fn(async (_input: Parameters<TableRenameServices['get']>[0]) => initial); if (firstRead) get.mockImplementationOnce(() => firstRead);
  const preview = vi.fn(async (input: Parameters<TableRenameServices['preview']>[0]): Promise<TableRenamePreviewOutput> => {
    const plan: TableRenamePreviewOutput = { target: initial.target, previewToken: 'rename-plan-' + (++serial), expiresAt: initial.expiresAt, ddlHash: initial.ddlHash, sql: `RENAME TABLE \`db\`.\`subject\` TO \`db\`.\`${input.newName}\`;`, before: initial.target.table, after: input.newName, warnings: [], requiredAcknowledgements: [...tableRenameAcknowledgements] }; plans.set(plan.previewToken, plan); return plan;
  });
  const apply = vi.fn(async (input: Parameters<TableRenameServices['apply']>[0]): Promise<TableRenameApplyOutput> => {
    const plan = plans.get(input.previewToken); if (!plan) throw Error('测试服务未收到该原预览');
    return { target: initial.target, newTarget: { ...initial.target, table: plan.after }, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { physicalIdentity: 'b'.repeat(64), tableId: initial.tableId!, ddlHash: 'c'.repeat(64) }, warnings: [] };
  });
  const release = vi.fn(async (_input: Parameters<TableRenameServices['release']>[0]) => {}), cancel = vi.fn(async (_input: { taskId: string }) => {}), subscribe = vi.fn((_listener: Parameters<TableRenameServices['subscribe']>[0]) => () => {});
  const callbacks = { onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), beforeApply: vi.fn(), onApplied: vi.fn(), onExecutionUncertain: vi.fn() }, confirm = vi.fn(() => true), services: TableRenameServices = { get, preview, apply, release, cancel, subscribe };
  Object.assign(window, { confirm }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  /** 只改变父传入连接修订，不在测试中直接改变子组件内部租约。 */
  const render = () => root!.render(<Dialog target={initial.target} targetVersion={version} services={services} {...callbacks}/>); await act(async () => render());
  return { initial, plans, get, preview, apply, release, cancel, callbacks, confirm, async version(next: number) { version = next; await act(async () => render()); } };
}
/** 当前中文DOM为操作入口；读取真实React事件只用于延迟回调和同步重入反例。 */
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function input(): MemoryNode { const node = document.querySelector(`textarea[aria-label="${text.newName}"]`); expect(node).not.toBeNull(); return node!; }
function box(label: string): MemoryNode { const node = document.querySelectorAll('input').find(item => item.type === 'checkbox' && item.parentNode?.textContent === label); expect(node, label).toBeDefined(); return node!; }
function callback(node: MemoryNode, name = 'onClick'): (...args: unknown[]) => unknown {
  const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件');
  const props = Reflect.get(node, key) as Record<string, unknown>, handler = props[name]; if (typeof handler !== 'function') throw Error('缺少真实React回调'); return handler as (...args: unknown[]) => unknown;
}
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function fill(value: string): Promise<void> { const node = input(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); expect(input().value).toBe(value); }
async function acknowledge(label: string, checked = true): Promise<void> { const node = box(label); expect(node.disabled).toBe(false); await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); expect(box(label).checked).toBe(checked); }
async function allAcks(): Promise<void> { for (const label of [text.ackImplicit, text.ackWindow, text.ackReferences]) await acknowledge(label); }
async function prepare(name = 'renamed'): Promise<void> { await fill(name); await click(text.preview); expect(document.querySelector('pre[aria-label="只读重命名SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true'); }
/** 迟到结果由显式deferred控制，不使用sleep、增大等待时间或重试写请求。 */
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('表重命名兼容界面的真实React正反对照（非原生或实库验收）', () => {
  it.each(['5.7.44', '10.11.19-MariaDB', '11.4.13-MariaDB'])('服务明确授权%s时只读预览、三确认及单次执行保留原物理凭证', async version => {
    const f = await mount(snapshot(version)); await fill('renamed'); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); await click(text.preview); expect(button(text.apply).disabled).toBe(true); await allAcks(); const execute = callback(button(text.apply)); await act(async () => { execute(); execute(); });
    expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0]).toMatchObject({ previewToken: 'rename-plan-1', acknowledgements: [...tableRenameAcknowledgements] }); expect(f.callbacks.onApplied).toHaveBeenCalledWith(expect.objectContaining({ after: expect.objectContaining({ physicalIdentity: 'b'.repeat(64), tableId: '9007199254740993' }) }));
  });
  it.each(['外键依赖未开放', '视图目录不可见', '触发器存在', '原生实体身份不可确认', '服务器版本尚未证明'])('%s时保持服务只读原因，不按版本或伪造事件放开', async reason => {
    const source = snapshot(); source.writable = false; source.reasons = [reason]; const f = await mount(source); expect(input().disabled).toBe(true); expect(document.body.textContent).toContain(reason); await act(async () => callback(input(), 'onChange')({ target: { value: 'renamed' } })); expect(input().value).toBe('subject'); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
  it('同一预览取消一项ACK后，保存的旧全确认执行回调不得发送或进入父守卫', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)); await acknowledge(text.ackImplicit, false); expect(button(text.apply).disabled).toBe(true); await act(async () => { execute(); }); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(box(text.ackImplicit).checked).toBe(false);
  });
  it('同一预览的旧ACK事件不能恢复用户后续取消的确认', async () => {
    const f = await mount(); await prepare(); await allAcks(); const oldCheck = callback(box(text.ackImplicit), 'onChange'); await acknowledge(text.ackImplicit, false); await act(async () => { oldCheck({ target: { checked: true } }); }); expect(box(text.ackImplicit).checked).toBe(false); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it('ACK取消后恢复相同值也撤销旧执行回调，当前确认事件仍可执行一次', async () => {
    const f = await mount(); await prepare(); await allAcks(); const oldExecute = callback(button(text.apply)); await acknowledge(text.ackImplicit, false); await acknowledge(text.ackImplicit); await act(async () => { oldExecute(); }); expect(f.apply).not.toHaveBeenCalled(); await click(text.apply); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('旧预览全ACK执行回调不能消费返回编辑后产生的未确认新令牌', async () => {
    const f = await mount(); await prepare('first_name'); await allAcks(); const oldExecute = callback(button(text.apply)); await click(text.back); await prepare('second_name'); expect(f.release).toHaveBeenCalledWith({ previewToken: 'rename-plan-1' }); expect(button(text.apply).disabled).toBe(true); await act(async () => { oldExecute(); }); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(box(text.ackImplicit).checked).toBe(false);
    await allAcks(); await click(text.apply); expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'rename-plan-2' }));
  });
  it('旧预览的确认框不能替后继新预览勾选任意ACK', async () => {
    const f = await mount(); await prepare('first_name'); const oldCheck = callback(box(text.ackReferences), 'onChange'); await click(text.back); await prepare('second_name'); await act(async () => { oldCheck({ target: { checked: true } }); }); expect(box(text.ackReferences).checked).toBe(false); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it.each(['read', 'close'] as const)('初始空界面的旧%s回调必须确认后继名称草稿，取消保持输入且不释放', async action => {
    const source = snapshot(), first = gate<TableRenameGetOutput>(), f = await mount(source, first.promise), old = callback(button(action === 'read' ? text.read : text.close)); await act(async () => { first.resolve(source); }); await fill('user_draft'); f.confirm.mockReturnValueOnce(false); await act(async () => { old(); });
    expect(f.confirm).toHaveBeenCalledOnce(); expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(input().value).toBe('user_draft'); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('丢稿确认回调同步重入当前apply时不得消费预览或进入父守卫', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)); f.confirm.mockImplementationOnce(() => { execute(); return false; }); await click(text.close); expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(false);
  });
  it('取消只结束请求权，原预览尚未返回时关闭仍禁用，迟到令牌必须释放', async () => {
    const f = await mount(), waiting = gate<TableRenamePreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await fill('renamed'); await click(text.preview); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce(); expect(button(text.close).disabled).toBe(true);
    await act(async () => { waiting.resolve({ target: f.initial.target, previewToken: 'late-plan', expiresAt: f.initial.expiresAt, ddlHash: f.initial.ddlHash, sql: '原服务器迟到计划', before: 'subject', after: 'renamed', warnings: [], requiredAcknowledgements: [...tableRenameAcknowledgements] }); }); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-plan' }); expect(button(text.close).disabled).toBe(false); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('beforeApply后发现原定义变化则未发送；恢复原定义也不重用已消费的旧确认', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)), hash = f.initial.ddlHash;
    f.callbacks.beforeApply.mockImplementationOnce(() => { f.initial.ddlHash = 'd'.repeat(64); }); await act(async () => { execute(); });
    f.initial.ddlHash = hash; await act(async () => { execute(); });
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onApplied).not.toHaveBeenCalled(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('beforeApply后ACK清单被同值数组替换也撤销原预览租约，恢复原引用不能补发', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)), plan = f.plans.get('rename-plan-1')!, required = plan.requiredAcknowledgements;
    f.callbacks.beforeApply.mockImplementationOnce(() => { plan.requiredAcknowledgements = [...required]; }); await act(async () => { execute(); }); plan.requiredAcknowledgements = required; await act(async () => { execute(); });
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.notSent);
  });
  it('父级草稿守卫拒绝后保留名称和预览，但旧执行不能自动重试', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { throw Error('原表或新名称仍有未提交数据，用户取消'); }); await act(async () => { execute(); execute(); });
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(input().value).toBe('renamed'); expect(document.querySelector('pre')).not.toBeNull(); expect(document.body.textContent).toContain(text.notSent); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled();
  });
  it('beforeApply同步重入当前执行只消费一次，父守卫和物理回执也只调用一次', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { execute(); }); await act(async () => { execute(); }); await act(async () => { execute(); });
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.succeeded);
  });
  it('ACK取消再恢复后，旧复选框也不能撤销当前有效确认', async () => {
    const f = await mount(); await prepare(); await allAcks(); const oldCheck = callback(box(text.ackImplicit), 'onChange'); await acknowledge(text.ackImplicit, false); await acknowledge(text.ackImplicit); await act(async () => { oldCheck({ target: { checked: false } }); });
    expect(box(text.ackImplicit).checked).toBe(true); expect(button(text.apply).disabled).toBe(false); expect(f.apply).not.toHaveBeenCalled(); await click(text.apply); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('旧返回编辑事件不能释放或移除后继预览', async () => {
    const f = await mount(); await prepare('first_name'); const oldBack = callback(button(text.back)); await click(text.back); await prepare('second_name'); await act(async () => { oldBack(); });
    expect(f.release).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledWith({ previewToken: 'rename-plan-1' }); expect(document.querySelector('pre')!.textContent).toContain('second_name'); await allAcks(); await click(text.apply); expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'rename-plan-2' }));
  });
  it.each(['read', 'close'] as const)('%s确认期间出现后继输入时，一次同意不能丢弃后继草稿', async action => {
    const f = await mount(); await fill('first_draft'); const edit = callback(input(), 'onChange'); f.confirm.mockImplementationOnce(() => { edit({ target: { value: 'later_draft' } }); return true; }); await click(action === 'read' ? text.read : text.close);
    expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(input().value).toBe('later_draft'); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('确认期间名称恢复同值仍撤销旧丢稿授权', async () => {
    const f = await mount(); await fill('user_draft'); const edit = callback(input(), 'onChange'); f.confirm.mockImplementationOnce(() => { edit({ target: { value: 'user_draft' } }); return true; }); await click(text.close);
    expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(input().value).toBe('user_draft');
  });
  it('连接版本经历ABA后旧执行和输入都不能恢复原读取授权', async () => {
    const f = await mount(); await prepare(); await allAcks(); const execute = callback(button(text.apply)), edit = callback(input(), 'onChange'); await f.version(2); await f.version(1); await act(async () => { execute(); edit({ target: { value: 'wrong_name' } }); });
    expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(input().value).toBe('renamed'); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.targetChanged);
  });
  it('初始旧关闭事件必须使用后续执行未知事实，不能降级为普通丢稿提示', async () => {
    const source = snapshot(), first = gate<TableRenameGetOutput>(), f = await mount(source, first.promise), oldClose = callback(button(text.close)); await act(async () => { first.resolve(source); }); await prepare(); await allAcks(); f.apply.mockRejectedValueOnce(Error('投递后连接中断')); await click(text.apply); f.confirm.mockReturnValueOnce(false); await act(async () => { oldClose(); });
    expect(f.confirm).toHaveBeenCalledWith(text.unknownClose); expect(f.callbacks.onExecutionUncertain).toHaveBeenCalledOnce(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.unknown);
  });
});
