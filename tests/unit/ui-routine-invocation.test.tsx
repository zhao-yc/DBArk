import React, { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { RoutineInvocationMetadata, RoutineInvocationTarget } from '../../src/shared/routineInvocation';
import { RoutineInvocationIntent } from '../../src/renderer/routineInvocationIntent';
import { routineInvocationServices, type RoutineInvocationServices } from '../../src/renderer/routineInvocationServices';
import { routineInvocationZh as text } from '../../src/renderer/locales/routineInvocation.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
const editors = vi.hoisted(() => ({ all: [] as any[] }));
vi.mock('../../src/renderer/components/SqlEditor', () => ({ SqlEditor: (props: any) => { editors.all.push(props); return null; } }));
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
let Dialog: typeof import('../../src/renderer/components/RoutineInvocationDialog')['RoutineInvocationDialog'], store: typeof import('../../src/renderer/store')['useWorkspace'];
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
const target: RoutineInvocationTarget = { connectionId: 'c', database: 'db', name: 'routine', kind: 'procedure' }, profile = { id: 'c', name: '仅合成连接', group: '', color: '', host: 'offline.invalid', port: 1, user: 'ram', dialect: 'mysql' as const };
beforeAll(async () => {
  document = memoryDocument(); const create = document.createElement.bind(document); document.createElement = name => { const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key, value); if (key === 'disabled') node.disabled = true; }; node.removeAttribute = key => { remove(key); if (key === 'disabled') node.disabled = false; }; return node; };
  ({ createRoot } = await import('react-dom/client')); ({ RoutineInvocationDialog: Dialog } = await import('../../src/renderer/components/RoutineInvocationDialog')); ({ useWorkspace: store } = await import('../../src/renderer/store'));
});
beforeEach(() => { (window as any).dbark = { invoke: vi.fn(() => { throw Error('本组件不允许未知正式IPC'); }) }; store.setState({ settings: { ...store.getState().settings, tabs: [{ id: 'q', title: '原查询', kind: 'query', connectionId: 'c', database: 'db', sql: '原SQL及事务不得改动' }], activeTabId: 'q' }, connections: [profile], connectionVersions: { c: 4 }, activeJobs: {}, dirtyTabs: { q: true }, notice: undefined }); });
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; } document.body.textContent = ''; editors.all = []; delete (window as any).dbark; });
afterAll(() => { for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
/** 严格合成目录只有签名，不伪造SHOW CREATE、数据库执行或实际参数值。 */
function metadata(source = target): RoutineInvocationMetadata { return { ...source, fingerprint: 'a'.repeat(64), parameters: source.kind === 'function' ? [{ ordinal: 1, name: 'input_value', mode: 'IN', type: 'decimal(30,12)' }] : [{ ordinal: 1, name: 'input_value', mode: 'IN', type: 'bigint unsigned' }, { ordinal: 2, name: 'out_value', mode: 'OUT', type: 'decimal(30,12)' }, { ordinal: 3, name: 'state_value', mode: 'INOUT', type: 'varchar(255)' }], ...(source.kind === 'function' ? { returnType: 'decimal(30,12)' } : {}) }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function button(label: string) { const node = document.body.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => { node.dispatchEvent(new MemoryEvent('click')); }); }
function props(node: ReturnType<typeof button>): any { const key = Object.keys(node).find(key => key.startsWith('__reactProps$')); if (!key) throw Error('缺少真实React按钮事件'); return (node as any)[key]; }
function sql() { return editors.all.at(-1)?.value as string | undefined; }
async function mount(options: { target?: RoutineInvocationTarget; read?: RoutineInvocationServices['read']; cancel?: RoutineInvocationServices['cancel']; strict?: boolean; raw?: RoutineInvocationMetadata } = {}) {
  const source = options.target ?? target, value = options.raw ?? metadata(source), read = vi.fn<RoutineInvocationServices['read']>(options.read ?? (async () => value)), cancel = vi.fn<RoutineInvocationServices['cancel']>(options.cancel ?? (async () => undefined)), open = vi.fn(), close = vi.fn(), services = { read, cancel };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  const view = (next = source) => <Dialog target={next} onOpenGeneratedQuery={open} onClose={close} services={services}/>;
  await act(async () => root!.render(options.strict ? <React.StrictMode>{view()}</React.StrictMode> : view()));
  return { source, value, read, cancel, open, close, async render(next = source) { await act(async () => root!.render(view(next))); } };
}

it('明确读取才生成IN/OUT/INOUT完整只读脚本，fresh沿同nonce且只交付一次不执行', async () => {
  const original = store.getState(), f = await mount(); expect(f.read).not.toHaveBeenCalled(); expect(editors.all).toHaveLength(0); expect(document.body.textContent).toContain(text.effects); await click(text.read);
  const preview = sql()!; expect(preview).toContain('CALL'); expect(preview).toContain(':arg_1'); expect(preview).toContain(':arg_3'); expect(preview).toContain('@dbark_call_'); expect(preview).toContain('NULL'); expect(document.body.textContent).toContain('INOUT'); expect(document.body.textContent).toContain('decimal(30,12)'); expect(document.body.textContent).toContain(text.variables);
  expect(editors.all.at(-1)).toMatchObject({ readOnly: true, height: 260 }); expect(editors.all.at(-1).onExecute).toBeUndefined(); expect(editors.all.at(-1).onChange).toBeUndefined();
  await click(text.open); expect(f.read).toHaveBeenCalledTimes(2); expect(new Set(f.read.mock.calls.map(call => call[1])).size).toBe(2); expect(f.read.mock.calls.every(call => JSON.stringify(call[0]) === JSON.stringify(target))).toBe(true); expect(f.open).toHaveBeenCalledExactlyOnceWith(preview); expect(button(text.open).disabled).toBe(true);
  expect(store.getState().settings).toBe(original.settings); expect(store.getState().dirtyTabs).toBe(original.dirtyTabs); expect(store.getState().activeJobs).toBe(original.activeJobs); expect((window as any).dbark.invoke).not.toHaveBeenCalled();
});
it.each(['procedure', 'function'] as const)('零参%s可生成，函数返回类型显示且无OUT会话变量', async kind => {
  const source = { ...target, kind }, value = { ...metadata(source), parameters: [] }, f = await mount({ target: source, raw: value }); await click(text.read);
  expect(sql()).toContain(kind === 'procedure' ? 'CALL `db`.`routine`()' : 'SELECT `db`.`routine`()'); expect(document.body.textContent).toContain(text.zero); expect(document.body.textContent).toContain(text.noOutputs); if (kind === 'function') expect(document.body.textContent).toContain(text.returnType);
  await click(text.open); expect(f.open).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledTimes(2);
});
it('双击/旧DOM不重入目录任务，完成后的旧回调也不能触发新的读取', async () => {
  const pending = deferred<RoutineInvocationMetadata>(), f = await mount({ read: () => pending.promise }), old = props(button(text.read)).onClick;
  await act(async () => { old(); old(); }); expect(f.read).toHaveBeenCalledOnce(); expect(button(text.read).disabled).toBe(true);
  await act(async () => { pending.resolve(f.value); }); await act(async () => old()); expect(f.read).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled();
});
it.each(['ack-first', 'read-first'] as const)('忙关闭%s等原read和取消ACK双方结算，Escape/重复关闭只取消一次', async order => {
  const pending = deferred<RoutineInvocationMetadata>(), ack = deferred<unknown>(), f = await mount({ read: () => pending.promise, cancel: () => ack.promise }); await click(text.read); await click(text.close);
  await click(zh.dialogs.text001); await act(async () => { document.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(f.cancel).toHaveBeenCalledExactlyOnceWith(f.read.mock.calls[0][1]); expect(f.close).not.toHaveBeenCalled();
  await act(async () => { if (order === 'ack-first') ack.resolve(undefined); else pending.resolve(f.value); }); expect(f.close).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(true); expect(document.body.textContent).toContain(text.closing);
  await act(async () => { if (order === 'ack-first') pending.resolve(f.value); else ack.resolve(undefined); }); expect(f.close).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled(); expect(editors.all).toHaveLength(0);
});
it('fresh成功回调同步卸载时，已结束目录任务不再收到迟到取消', async () => {
  const f = await mount(); await click(text.read); const preview = sql();
  f.open.mockImplementation(() => { root!.unmount(); root = undefined; });
  await click(text.open); expect(f.open).toHaveBeenCalledExactlyOnceWith(preview); expect(f.read).toHaveBeenCalledTimes(2); expect(f.cancel).not.toHaveBeenCalled(); expect(f.close).not.toHaveBeenCalled(); expect(store.getState().notice).toBeUndefined();
});
it('关闭中原read真实失败仍通知原文，并等待取消ACK后只关闭一次', async () => {
  const pending = deferred<RoutineInvocationMetadata>(), ack = deferred<unknown>(), f = await mount({ read: () => pending.promise, cancel: () => ack.promise }); await click(text.read); await click(text.close);
  await act(async () => { pending.reject(Error('物理关闭未确认')); }); expect(store.getState().notice).toEqual({ text: '物理关闭未确认', error: true }); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.close).not.toHaveBeenCalled(); expect(button(text.read).disabled).toBe(true); expect(document.body.textContent).toContain(text.closing);
  await act(async () => { ack.resolve(undefined); }); await click(zh.dialogs.text001); expect(f.close).toHaveBeenCalledOnce(); expect(f.open).not.toHaveBeenCalled(); expect(store.getState().notice).toEqual({ text: '物理关闭未确认', error: true });
});
it('原目录错误和错误目标保持原文，不能生成另一连接的调用查询', async () => {
  const f = await mount({ read: async () => { throw Error('原服务器SHOW CREATE权限不足'); } }); await click(text.read); expect(document.body.textContent).toContain('原服务器SHOW CREATE权限不足'); expect(f.open).not.toHaveBeenCalled();
  f.read.mockResolvedValue({ ...f.value, connectionId: 'other' }); await click(text.read); expect(document.body.textContent).toContain(text.target); expect(editors.all).toHaveLength(0); expect(f.open).not.toHaveBeenCalled();
});
it('fresh指纹变化拒绝旧预览，只有明确重新读取才生成新nonce，不自动换SQL', async () => {
  const f = await mount(); await click(text.read); const old = sql()!; f.read.mockResolvedValue({ ...f.value, fingerprint: 'b'.repeat(64) }); await click(text.open);
  expect(f.open).not.toHaveBeenCalled(); expect(sql()).toBe(old); expect(document.body.textContent).toContain(text.changed); expect(button(text.open).disabled).toBe(true); expect(button(text.read).disabled).toBe(false); expect(f.read).toHaveBeenCalledTimes(2);
  await click(text.read); expect(f.read).toHaveBeenCalledTimes(3); expect(sql()).not.toBe(old); expect(button(text.open).disabled).toBe(false); expect(f.open).not.toHaveBeenCalled();
});
it.each(['profile', 'version', 'target'] as const)('%s ABA永久撤销原意图，迟到回包不生成查询', async change => {
  const pending = deferred<RoutineInvocationMetadata>(), f = await mount({ read: () => pending.promise }); await click(text.read);
  if (change === 'target') { await f.render({ ...target, name: 'other' }); await f.render(target); }
  else await act(async () => { if (change === 'profile') { store.setState({ connections: [{ ...profile, name: '曾更换' }] }); store.setState({ connections: [profile] }); } else { store.setState({ connectionVersions: { c: 5 } }); store.setState({ connectionVersions: { c: 4 } }); } });
  await act(async () => { pending.resolve(f.value); }); expect(document.body.textContent).toContain(text.stale); expect(f.open).not.toHaveBeenCalled(); expect(editors.all).toHaveLength(0); expect(button(text.read).disabled).toBe(true); expect(f.cancel).toHaveBeenCalledOnce();
});
it('后台原查询自然完成或SQL/标签/activeJobs改变不毒死独立例程目标', async () => {
  const pending = deferred<RoutineInvocationMetadata>(), f = await mount(); f.read.mockImplementationOnce(() => pending.promise); await click(text.read);
  await act(async () => { const state = store.getState(); store.setState({ settings: { ...state.settings, activeTabId: 'other', tabs: state.settings.tabs.map(tab => ({ ...tab, sql: '后台已保存的新正文' })) }, activeJobs: { q: true }, dirtyTabs: { q: true } }); });
  const original = store.getState(); await act(async () => { pending.resolve(f.value); }); await click(text.open); expect(f.open).toHaveBeenCalledOnce(); expect(store.getState().settings).toBe(original.settings); expect(store.getState().activeJobs).toBe(original.activeJobs); expect(store.getState().dirtyTabs).toBe(original.dirtyTabs);
});
it('StrictMode不自动读取，卸载取消原任务且迟到metadata不能污染新窗口', async () => {
  const pending = deferred<RoutineInvocationMetadata>(), f = await mount({ strict: true, read: () => pending.promise }); expect(f.read).not.toHaveBeenCalled(); await click(text.read);
  await act(async () => root!.render(<span/>)); await f.render(); await act(async () => { pending.resolve(f.value); }); expect(f.read).toHaveBeenCalledOnce(); expect(f.cancel).toHaveBeenCalledOnce(); expect(editors.all).toHaveLength(0); expect(f.open).not.toHaveBeenCalled();
});
it('正式服务只使用带准确target和taskId的目录读取及同task取消，不发送profile或执行SQL', async () => {
  const bridge = vi.fn(async () => metadata()); (window as any).dbark.invoke = bridge; await routineInvocationServices.read(target, 'read-only-task'); await routineInvocationServices.cancel('read-only-task');
  expect(bridge.mock.calls).toEqual([['metadata.routineInvocation', { ...target, taskId: 'read-only-task' }], ['query.cancel', { taskId: 'read-only-task' }]]);
});
it('小型intent固定环境标量和profile身份，不因同一环境对象原地改回版本而复活', () => {
  const environment = { profile: profile as object | undefined, version: 4 }, intent = new RoutineInvocationIntent(target, () => environment); environment.version = 5; expect(intent.current()).toBe(false); environment.version = 4; expect(intent.current()).toBe(false);
});
