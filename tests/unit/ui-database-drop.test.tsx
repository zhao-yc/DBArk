import { act } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseDropApplyOutput, DatabaseDropGetOutput, DatabaseDropPreviewOutput, DatabaseDropProgress } from '../../src/shared/databaseDrop';
import { databaseDropAcknowledgements } from '../../src/shared/databaseDrop';
import { databaseDropAckLabel, databaseDropAcksComplete, databaseDropFailure } from '../../src/renderer/databaseDropUi';
import { databaseDropZh as text } from '../../src/renderer/locales/databaseDrop.zh-CN';
import type { DatabaseDropServices } from '../../src/renderer/components/DatabaseDropDialog';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';

// 仅替换Monaco展示端口，实际React、Modal、输入、生命周期和服务调用保留真实产品代码。
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: ({ value, readOnly }: { value: string; readOnly: boolean }) => <pre aria-label="只读删除数据库SQL测试端口" data-read-only={String(readOnly)}>{value}</pre> }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/DatabaseDropDialog')['DatabaseDropDialog'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);

beforeAll(async () => {
  document = memoryDocument(); Object.defineProperty(document, 'oninput', { value: null, configurable: true }); const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); if (name === 'input') node.type = 'text';
    // 仅补标准HTML属性反射，不伪造系统输入、布局、焦点或服务器返回值。
    node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; };
    node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node;
  };
  Object.assign(window, { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) });
  ({ createRoot } = await import('react-dom/client')); ({ DatabaseDropDialog: Dialog } = await import('../../src/renderer/components/DatabaseDropDialog'));
});
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });

/** 不同版本只注入明确服务能力，不把内存React测试当作实库兼容证明。 */
function snapshot(serverVersion = '8.4.11'): DatabaseDropGetOutput {
  return { target: { connectionId: 'drop-memory', database: '中文`Db' }, snapshotId: 'drop-source', catalogDigest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300000).toISOString(), counts: { tables: 2, views: 3, procedures: 4, functions: 5, triggers: 6, events: 7 }, charset: 'utf8mb4', collation: 'utf8mb4_bin', writable: true, reasons: [], warnings: [], serverVersion };
}
/** 服务替身只记录外部请求，状态只能经真实DOM操作与父传入修订推进。 */
async function mount(initial = snapshot(), firstRead?: Promise<DatabaseDropGetOutput>) {
  let serial = 0, version = 1, listener: Parameters<DatabaseDropServices['subscribe']>[0] | undefined;
  const plans = new Map<string, DatabaseDropPreviewOutput>();
  const get = vi.fn(async (_input: Parameters<DatabaseDropServices['get']>[0]) => initial); if (firstRead) get.mockImplementationOnce(() => firstRead);
  const preview = vi.fn(async (_input: Parameters<DatabaseDropServices['preview']>[0]): Promise<DatabaseDropPreviewOutput> => {
    const plan: DatabaseDropPreviewOutput = { target: initial.target, previewToken: 'drop-plan-' + (++serial), expiresAt: initial.expiresAt, catalogDigest: initial.catalogDigest, counts: { ...initial.counts }, sql: 'DROP DATABASE `中文``Db`;', warnings: [], requiredAcknowledgements: [...databaseDropAcknowledgements] }; plans.set(plan.previewToken, plan); return plan;
  });
  const apply = vi.fn(async (_input: Parameters<DatabaseDropServices['apply']>[0]): Promise<DatabaseDropApplyOutput> => ({ target: initial.target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true }, warnings: [] }));
  const release = vi.fn(async (_input: Parameters<DatabaseDropServices['release']>[0]) => {}), cancel = vi.fn(async (_input: { taskId: string }) => {}), subscribe = vi.fn((next: Parameters<DatabaseDropServices['subscribe']>[0]) => { listener = next; return () => { if (listener === next) listener = undefined; }; });
  const callbacks = { onClose: vi.fn(), onCleanupError: vi.fn(), onDirtyChange: vi.fn(), beforeApply: vi.fn(), onApplied: vi.fn(), onExecutionUncertain: vi.fn() }, confirm = vi.fn(() => true), services: DatabaseDropServices = { get, preview, apply, release, cancel, subscribe };
  Object.assign(window, { confirm }); const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as unknown as Element);
  /** 模拟真实父级配置修订，不操作子组件内部ref或state。 */
  const render = () => root!.render(<Dialog target={initial.target} targetVersion={version} services={services} {...callbacks}/>); await act(async () => render());
  return { initial, plans, get, preview, apply, release, cancel, callbacks, confirm, async version(next: number) { version = next; await act(async () => render()); }, async emit(taskId: string, progress: DatabaseDropProgress) { await act(async () => { listener?.({ taskId, progress }); }); } };
}
/** 中文DOM为用户入口；真实React事件仅用于捕获旧回调与同步重入反例。 */
function button(label: string): MemoryNode { const node = document.querySelectorAll('button').find(item => item.textContent === label); expect(node, label).toBeDefined(); return node!; }
function input(): MemoryNode { const node = document.querySelector(`textarea[aria-label="${text.confirmation}"]`); expect(node).not.toBeNull(); return node!; }
function box(label: string): MemoryNode { const node = document.querySelectorAll('input').find(item => item.type === 'checkbox' && item.parentNode?.textContent === label); expect(node, label).toBeDefined(); return node!; }
function callback(node: MemoryNode, name = 'onClick'): (...args: unknown[]) => unknown {
  const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React事件');
  const handler = (Reflect.get(node, key) as Record<string, unknown>)[name]; if (typeof handler !== 'function') throw Error('缺少真实React回调'); return handler as (...args: unknown[]) => unknown;
}
async function click(label: string): Promise<void> { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
async function fill(value: string): Promise<void> { const node = input(); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); expect(input().value).toBe(value); }
async function acknowledge(label: string, checked = true): Promise<void> { const node = box(label); expect(node.disabled).toBe(false); await act(async () => { node.checked = checked; node.dispatchEvent(new MemoryEvent('click')); }); expect(box(label).checked).toBe(checked); }
async function allAcks(): Promise<void> { for (const label of [text.ackIrreversible, text.ackWindow, text.ackReferences, text.ackSessions]) await acknowledge(label); }
async function prepare(): Promise<void> { await click(text.preview); expect(document.querySelector('pre[aria-label="只读删除数据库SQL测试端口"]')!.getAttribute('data-read-only')).toBe('true'); }
/** 迟到响应由显式deferred控制，不使用sleep、放大超时或重试删除。 */
function gate<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((done, failed) => { resolve = done; reject = failed; }); return { promise, resolve, reject }; }

describe('删除数据库的真实React交互与同步围栏（非原生或实库验收）', () => {
  it('读取真实六类计数及风险不会发送预览或删除，输入确认仅在预览后出现', async () => {
    const f = await mount(); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelectorAll('dd').map(node => node.textContent)).toEqual(['2', '3', '4', '5', '6', '7']); expect(document.querySelectorAll('input').map(node => node.value)).toContain('utf8mb4_bin'); expect(document.body.textContent).toContain(text.risk); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(false);
    await prepare(); expect(f.apply).not.toHaveBeenCalled(); expect(input().value).toBe(''); expect(button(text.apply).disabled).toBe(true); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it.each(['5.7.44', '8.0.46', '8.4.11', '10.11.19-MariaDB', '11.4.13-MariaDB'])('服务明确授权%s时要求原名和四项ACK，双击只发送一次', async version => {
    const f = await mount(snapshot(version)); await prepare(); await allAcks(); expect(button(text.apply).disabled).toBe(true); await fill(f.initial.target.database); const execute = callback(button(text.apply)); await act(async () => { execute(); execute(); });
    expect(f.apply).toHaveBeenCalledOnce(); expect(f.apply.mock.calls[0][0]).toMatchObject({ previewToken: 'drop-plan-1', confirmation: '中文`Db', acknowledgements: [...databaseDropAcknowledgements] }); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledWith(expect.objectContaining({ ddlCompleted: true, after: { databaseAbsent: true } })); expect(document.body.textContent).toContain(text.succeeded);
  });
  it.each([' 中文`Db', '中文`Db ', '中文`db', '中文Db', '中文`Db\n'])('确认文本%s不修剪、不折叠大小写或宽松匹配', async value => {
    const f = await mount(); await prepare(); await allAcks(); await fill(value); expect(button(text.apply).disabled).toBe(true); await act(async () => callback(button(text.apply))()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled();
  });
  it('服务只读原因原样展示，不以对象数或版本猜测可删除', async () => {
    const source = snapshot(); source.writable = false; source.reasons = ['目录权限不足']; const f = await mount(source); expect(button(text.preview).disabled).toBe(true); expect(document.body.textContent).toContain('目录权限不足'); await act(async () => callback(button(text.preview))()); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });
  it.each(['negative', 'missing', 'fraction'] as const)('原目录计数%s不能补零或假定空库，释放原快照且无执行入口', async changed => {
    const source = snapshot(); if (changed === 'negative') source.counts.tables = -1; else if (changed === 'fraction') source.counts.events = 1.5; else Reflect.deleteProperty(source.counts, 'views'); const f = await mount(source);
    expect(f.release).toHaveBeenCalledWith({ snapshotId: 'drop-source' }); expect(button(text.preview).disabled).toBe(true); expect(f.preview).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.mismatch);
  });
  it.each(['unknown', 'duplicate', 'missing'] as const)('服务ACK清单%s不能授权删除', async changed => {
    const f = await mount(), original = f.preview.getMockImplementation()!; f.preview.mockImplementationOnce(async input => { const plan = await original(input); plan.requiredAcknowledgements = changed === 'unknown' ? [...databaseDropAcknowledgements.slice(0, 3), 'toString'] : changed === 'duplicate' ? [...databaseDropAcknowledgements.slice(0, 3), databaseDropAcknowledgements[0]] : databaseDropAcknowledgements.slice(0, 3); return plan; });
    await prepare(); await fill(f.initial.target.database); for (const label of [text.ackIrreversible, text.ackWindow, text.ackReferences]) await acknowledge(label); expect(button(text.apply).disabled).toBe(true); await act(async () => callback(button(text.apply))()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled();
  });
  it.each(['target', 'digest', 'counts'] as const)('预览%s不匹配原快照时释放迟到令牌且不提供执行入口', async changed => {
    const f = await mount(); f.preview.mockImplementationOnce(async () => ({ target: changed === 'target' ? { ...f.initial.target, database: 'other' } : f.initial.target, previewToken: 'wrong-plan', expiresAt: f.initial.expiresAt, catalogDigest: changed === 'digest' ? 'b'.repeat(64) : f.initial.catalogDigest, counts: { ...f.initial.counts, tables: changed === 'counts' ? 0 : f.initial.counts.tables }, sql: '服务原计划', warnings: [], requiredAcknowledgements: [...databaseDropAcknowledgements] }));
    await click(text.preview); expect(f.release).toHaveBeenCalledWith({ previewToken: 'wrong-plan' }); expect(document.querySelector('textarea')).toBeNull(); expect(document.body.textContent).toContain(text.mismatch); expect(f.apply).not.toHaveBeenCalled();
  });
  it('原名改变再恢复相同值也撤销旧执行闭包，当前回调仍可执行一次', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const old = callback(button(text.apply)); await fill('later'); await fill(f.initial.target.database); await act(async () => old()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); await click(text.apply); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('旧输入事件不能覆盖当前同值恢复后的确认文本', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); const old = callback(input(), 'onChange'); await fill('later'); await fill(f.initial.target.database); await act(async () => old({ target: { value: 'stale' } })); expect(input().value).toBe(f.initial.target.database); expect(f.apply).not.toHaveBeenCalled();
  });
  it('取消ACK后旧全确认执行和旧复选框不能恢复授权', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), oldCheck = callback(box(text.ackIrreversible), 'onChange'); await acknowledge(text.ackIrreversible, false);
    await act(async () => { execute(); oldCheck({ target: { checked: true } }); }); expect(box(text.ackIrreversible).checked).toBe(false); expect(button(text.apply).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled();
  });
  it('ACK取消后恢复相同值仍撤销旧执行和旧取消事件', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), oldCheck = callback(box(text.ackSessions), 'onChange'); await acknowledge(text.ackSessions, false); await acknowledge(text.ackSessions);
    await act(async () => { execute(); oldCheck({ target: { checked: false } }); }); expect(box(text.ackSessions).checked).toBe(true); expect(f.apply).not.toHaveBeenCalled(); await click(text.apply); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('旧预览的输入、ACK、返回与执行不能消费后继预览', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), oldInput = callback(input(), 'onChange'), oldCheck = callback(box(text.ackReferences), 'onChange'), oldBack = callback(button(text.back));
    await click(text.back); await prepare(); await act(async () => { execute(); oldInput({ target: { value: f.initial.target.database } }); oldCheck({ target: { checked: true } }); oldBack(); });
    expect(f.apply).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledWith({ previewToken: 'drop-plan-1' }); expect(input().value).toBe(''); expect(box(text.ackReferences).checked).toBe(false); await fill(f.initial.target.database); await allAcks(); await click(text.apply); expect(f.apply.mock.calls[0][0].previewToken).toBe('drop-plan-2');
  });
  it('父草稿守卫拒绝后保留原预览与确认，但已消费执行不能自动重试', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { throw Error('当前库仍有未提交数据，用户取消'); }); await act(async () => { execute(); execute(); });
    expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.apply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(input().value).toBe(f.initial.target.database); expect(document.querySelector('pre')).not.toBeNull(); expect(document.body.textContent).toContain(text.notSent); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(f.callbacks.onDirtyChange).toHaveBeenLastCalledWith(true);
  });
  it('父守卫同步重入删除也只消费一次', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)); f.callbacks.beforeApply.mockImplementationOnce(() => { execute(); }); await act(async () => execute()); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(f.callbacks.onApplied).toHaveBeenCalledOnce();
  });
  it.each(['digest', 'countIdentity', 'counts', 'ackIdentity', 'sql'] as const)('父守卫返回后%s来源漂移阻止发送，恢复原值也不重放', async changed => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), plan = f.plans.get('drop-plan-1')!, original = { digest: f.initial.catalogDigest, counts: f.initial.counts, tables: f.initial.counts.tables, acks: plan.requiredAcknowledgements, sql: plan.sql };
    f.callbacks.beforeApply.mockImplementationOnce(() => { if (changed === 'digest') f.initial.catalogDigest = 'b'.repeat(64); else if (changed === 'countIdentity') f.initial.counts = { ...f.initial.counts }; else if (changed === 'counts') f.initial.counts.tables++; else if (changed === 'ackIdentity') plan.requiredAcknowledgements = [...plan.requiredAcknowledgements]; else plan.sql = '另一条SQL'; });
    await act(async () => execute()); f.initial.catalogDigest = original.digest; f.initial.counts = original.counts; f.initial.counts.tables = original.tables; plan.requiredAcknowledgements = original.acks; plan.sql = original.sql; await act(async () => execute());
    expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.notSent); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled();
  });
  it.each(['read', 'close'] as const)('初始旧%s事件仍使用后继预览和确认的丢稿提示，拒绝后保留令牌', async action => {
    const source = snapshot(), first = gate<DatabaseDropGetOutput>(), f = await mount(source, first.promise), old = callback(button(action === 'read' ? text.read : text.close)); await act(async () => first.resolve(source)); await prepare(); await fill(source.target.database); f.confirm.mockReturnValueOnce(false); await act(async () => old());
    expect(f.confirm).toHaveBeenCalledWith(text.discard); expect(f.get).toHaveBeenCalledOnce(); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(input().value).toBe(source.target.database);
  });
  it('丢稿确认同步重入执行不得进入父守卫或消费令牌', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)); f.confirm.mockImplementationOnce(() => { execute(); return false; }); await click(text.close);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled(); expect(button(text.apply).disabled).toBe(false);
  });
  it('丢稿确认期间同值输入也撤销本次同意', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); const edit = callback(input(), 'onChange'); f.confirm.mockImplementationOnce(() => { edit({ target: { value: f.initial.target.database } }); return true; }); await click(text.close); expect(f.release).not.toHaveBeenCalled(); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(input().value).toBe(f.initial.target.database);
  });
  it('取消预览后等原请求结束才解锁，并释放迟到令牌', async () => {
    const f = await mount(), waiting = gate<DatabaseDropPreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await click(text.preview); await click(text.cancel); expect(f.cancel).toHaveBeenCalledOnce(); expect(button(text.close).disabled).toBe(true); expect(button(text.read).disabled).toBe(true);
    await act(async () => waiting.resolve({ target: f.initial.target, previewToken: 'late-plan', expiresAt: f.initial.expiresAt, catalogDigest: f.initial.catalogDigest, counts: { ...f.initial.counts }, sql: '原服务器迟到计划', warnings: [], requiredAcknowledgements: [...databaseDropAcknowledgements] }));
    expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-plan' }); expect(button(text.close).disabled).toBe(false); expect(document.querySelector('textarea')).toBeNull(); expect(f.apply).not.toHaveBeenCalled();
  });
  it('取消删除控制成功不等于原任务终态，原请求已完成仍保留真实DDL回执', async () => {
    const f = await mount(), waiting = gate<DatabaseDropApplyOutput>(); await prepare(); await fill(f.initial.target.database); await allAcks(); f.apply.mockImplementationOnce(() => waiting.promise); await click(text.apply); await click(text.cancel); expect(button(text.close).disabled).toBe(true); expect(f.callbacks.onApplied).not.toHaveBeenCalled();
    await act(async () => waiting.resolve({ target: f.initial.target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, after: { databaseAbsent: true }, warnings: [] })); expect(f.callbacks.onApplied).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.succeeded); expect(button(text.close).disabled).toBe(false);
  });
  it('取消读取后晚到快照必须独立释放，原请求结束前不能关闭', async () => {
    const source = snapshot(), waiting = gate<DatabaseDropGetOutput>(), f = await mount(source, waiting.promise); await click(text.cancel); expect(button(text.close).disabled).toBe(true); await act(async () => waiting.resolve(source)); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'drop-source' }); expect(button(text.close).disabled).toBe(false); expect(button(text.preview).disabled).toBe(true); expect(f.apply).not.toHaveBeenCalled();
  });
  it('卸载后晚到预览仍释放真实令牌，不回写已卸载窗口', async () => {
    const f = await mount(), waiting = gate<DatabaseDropPreviewOutput>(); f.preview.mockImplementationOnce(() => waiting.promise); await click(text.preview); await act(async () => root!.unmount()); root = undefined;
    await act(async () => waiting.resolve({ target: f.initial.target, previewToken: 'late-unmounted', expiresAt: f.initial.expiresAt, catalogDigest: f.initial.catalogDigest, counts: { ...f.initial.counts }, sql: '原迟到计划', requiredAcknowledgements: [...databaseDropAcknowledgements], warnings: [] })); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'drop-source' }); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late-unmounted' }); expect(f.callbacks.onApplied).not.toHaveBeenCalled();
  });
  it('动作入口真实时钟到期后旧执行回调也不能进入父守卫', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), later = Date.parse(f.initial.expiresAt) + 1; vi.spyOn(Date, 'now').mockReturnValue(later); await act(async () => execute()); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled();
  });
  it('连接版本经过ABA后旧确认、输入与执行均不能复活授权', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); const execute = callback(button(text.apply)), edit = callback(input(), 'onChange'); await f.version(2); await f.version(1); await act(async () => { execute(); edit({ target: { value: 'stale' } }); }); expect(f.apply).not.toHaveBeenCalled(); expect(f.callbacks.beforeApply).not.toHaveBeenCalled(); expect(input().value).toBe(f.initial.target.database); expect(button(text.apply).disabled).toBe(true); expect(document.body.textContent).toContain(text.targetChanged);
  });
  it('投递后断线保留未知和部分删除风险，旧关闭回调不得降级为普通丢稿', async () => {
    const source = snapshot(), first = gate<DatabaseDropGetOutput>(), f = await mount(source, first.promise), oldClose = callback(button(text.close)); await act(async () => first.resolve(source)); await prepare(); await fill(source.target.database); await allAcks(); f.apply.mockRejectedValueOnce(Error('投递后连接中断')); await click(text.apply); f.confirm.mockReturnValueOnce(false); await act(async () => oldClose());
    expect(f.callbacks.onExecutionUncertain).toHaveBeenCalledWith(text.unknown); expect(f.confirm).toHaveBeenCalledWith(text.unknownClose); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.release.mock.calls.map(([input]) => input)).toEqual([{ previewToken: 'drop-plan-1' }, { snapshotId: 'drop-source' }]); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.unknown);
  });
  it('DDL完成但未核验时保留已执行结果，不把失败投影为未执行', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); f.apply.mockResolvedValueOnce({ target: f.initial.target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, verificationError: '核验连接中断', warnings: ['需人工核对'] }); await click(text.apply);
    expect(f.callbacks.onApplied).toHaveBeenCalledWith(expect.objectContaining({ ddlCompleted: true, definitionVerified: false })); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(text.verificationFailed); expect(document.body.textContent).toContain('核验连接中断'); expect(button(text.apply).disabled).toBe(true);
  });
  it('只有未发送结构进度才把投递失败归类未发送，其他任务进度不能干扰', async () => {
    const f = await mount(), waiting = gate<DatabaseDropApplyOutput>(); await prepare(); await fill(f.initial.target.database); await allAcks(); f.apply.mockImplementationOnce(() => waiting.promise); await click(text.apply); const taskId = f.apply.mock.calls[0][0].taskId;
    await f.emit('other-task', { phase: 'executing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' }); await f.emit(taskId, { phase: 'releasing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }); await act(async () => waiting.reject(Error('执行前重核拒绝'))); expect(document.body.textContent).toContain(text.notSent); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled();
  });
  it('独立释放预览失败后仍继续释放快照，失败项保留且不自动执行', async () => {
    const f = await mount(); await prepare(); f.release.mockImplementation(async input => { if (input.previewToken) throw Error('预览令牌释放失败'); }); await click(text.close); expect(f.release).toHaveBeenCalledWith({ previewToken: 'drop-plan-1' }); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'drop-source' }); expect(f.callbacks.onClose).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(document.body.textContent).toContain('预览令牌释放失败');
  });
  it('原删除回执后立即清理已消费能力，原清理未结束前仍不能关闭', async () => {
    const f = await mount(), cleanup = gate<void>(); await prepare(); await fill(f.initial.target.database); await allAcks();
    f.release.mockImplementationOnce(() => cleanup.promise); await click(text.apply);
    expect(f.callbacks.onApplied).toHaveBeenCalledOnce(); expect(button(text.close).disabled).toBe(true);
    expect(f.release).toHaveBeenCalledWith({ previewToken: 'drop-plan-1' });
    await act(async () => cleanup.resolve()); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'drop-source' });
    expect(button(text.close).disabled).toBe(false); const count = f.release.mock.calls.length;
    await click(text.close); expect(f.callbacks.onClose).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledTimes(count); expect(f.apply).toHaveBeenCalledOnce();
  });
  it('执行后的精确清理失败保留责任与成功事实，关闭仅重试清理', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks();
    f.release.mockRejectedValueOnce(Error('原清理失败')); await click(text.apply);
    expect(f.callbacks.onCleanupError).toHaveBeenCalledWith('原清理失败'); expect(document.body.textContent).toContain(text.succeeded);
    await click(text.close); expect(f.release.mock.calls.map(([input]) => input)).toEqual([{ previewToken: 'drop-plan-1' }, { snapshotId: 'drop-source' }, { previewToken: 'drop-plan-1' }]);
    expect(f.callbacks.onClose).toHaveBeenCalledOnce(); expect(f.apply).toHaveBeenCalledOnce(); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled();
  });
  it('父级成功投影报错不能把已完成DDL降级成未知或重发', async () => {
    const f = await mount(); await prepare(); await fill(f.initial.target.database); await allAcks(); f.callbacks.onApplied.mockImplementationOnce(() => { throw Error('父级目录刷新失败'); }); await click(text.apply); expect(f.callbacks.onCleanupError).toHaveBeenCalledWith('父级目录刷新失败'); expect(f.callbacks.onExecutionUncertain).not.toHaveBeenCalled(); expect(f.apply).toHaveBeenCalledOnce(); expect(document.body.textContent).toContain(text.succeeded);
  });
  it('不可证明目录时不显示零计数冒充空库', async () => {
    const value = snapshot(); value.writable = false; value.reasons = ['权限不足，完整目录未读取'];
    value.counts = { tables: 0, views: 0, procedures: 0, functions: 0, triggers: 0, events: 0 };
    await mount(value); expect(document.querySelector('dl')).toBeNull(); expect(document.body.textContent).toContain(text.countsUnavailable);
    expect(button(text.preview).disabled).toBe(true);
  });
});

describe('删除数据库固定确认和结构结果分类', () => {
  it('只识别协议四项，重复、额外或原型名不能成为授权', () => {
    const all = new Set<string>(databaseDropAcknowledgements); expect(databaseDropAcksComplete(databaseDropAcknowledgements, all)).toBe(true); expect(databaseDropAcksComplete([...databaseDropAcknowledgements, databaseDropAcknowledgements[0]], all)).toBe(false); expect(databaseDropAcksComplete(databaseDropAcknowledgements, new Set([...all, 'extra']))).toBe(false); expect(databaseDropAckLabel('toString')).toBeUndefined(); expect(databaseDropAckLabel('__proto__')).toBeUndefined();
  });
  it.each([
    [false, null, 'notSent'], [true, null, 'unknown'],
    [true, { phase: 'releasing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }, 'notSent'],
    [true, { phase: 'releasing', ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }, 'unknown'],
    [true, { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'failed' }, 'verificationFailed'],
    [true, { phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' }, 'succeeded'],
  ] as const)('attempted=%s 时仅按原结构证据分类', (attempted, progress, state) => { expect(databaseDropFailure(progress, attempted)).toBe(state); });
});
