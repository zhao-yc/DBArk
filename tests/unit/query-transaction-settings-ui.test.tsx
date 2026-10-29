import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { QueryTransactionSettingsDialog } from '../../src/renderer/components/QueryTransactionSettingsDialog';
import { QueryTransactionSettingsIntent, type QueryTransactionSettingsScope } from '../../src/renderer/queryTransactionSettingsIntent';
import { queryTransactionSettingsZh as t } from '../../src/renderer/locales/queryTransactionSettings.zh-CN';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import type { QueryAutocommitOutput } from '../../src/shared/queryAutocommit';

const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let document: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const intents: QueryTransactionSettingsIntent[] = [];
beforeAll(async () => {
  document = memoryDocument(); (document as any).oninput = null; const create = document.createElement.bind(document);
  document.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    if (name === 'select') Object.defineProperty(node, 'options', { configurable: true, get: () => node.querySelectorAll('option') });
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; intents.splice(0).forEach(intent => intent.dispose()); document.body.textContent = ''; vi.clearAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });

/** 内存只校验来源和控件合同，不模拟Electron焦点、布局或真实数据库。 */
function scopeFixture(sessionId = '原会话') {
  let scope: QueryTransactionSettingsScope = { tabId: 'q', connectionId: 'c', connectionVersion: 1, connection: {}, sessionId, present: true, active: true, closing: false };
  let changed = () => {};
  const intent = new QueryTransactionSettingsIntent(() => scope, fn => { changed = fn; return () => { changed = () => {}; }; }, t.changed); intents.push(intent);
  return { intent, get scope() { return scope; }, change(patch: Partial<QueryTransactionSettingsScope>) { scope = { ...scope, ...patch }; changed(); } };
}
const baseline: QueryTransactionSettingsSnapshot = { dialect: 'mysql', serverVersion: '8.4.8', serverConnectionId: '9007199254740993', database: '实际库', isolation: 'REPEATABLE READ', readOnly: false, transactionOpen: false, autocommit: true };
function button(label: string) { const node = document.querySelectorAll('button').find(item => item.getAttribute('aria-label') === label || item.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function readonly() { const node = document.querySelector(`[aria-label="${t.readOnly}"]`)!; expect(node.disabled).toBe(false); await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); }); }
async function mount(read = vi.fn(async () => ({ ...baseline })), apply = vi.fn(async (input: any) => ({ ...baseline, isolation: input.isolation, readOnly: input.readOnly })), automatic?: (input: any) => Promise<QueryAutocommitOutput>) {
  const source = scopeFixture(), close = vi.fn(), invoke = vi.fn(() => { throw Error('弹窗不得自行调用IPC'); }); (window as any).dbark = { invoke };
  const host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host as any);
  await act(async () => root!.render(<QueryTransactionSettingsDialog intent={source.intent} connectionName="原连接" onRead={read} onApply={apply} onAutocommit={automatic} onClose={close}/>));
  return { source, read, apply, close, invoke };
}

it('来源只绑定原连接和会话，活动标签离开再回来不能复活旧设置', () => {
  const f = scopeFixture(); f.change({}); expect(f.intent.current()).toBe(true);
  f.change({ active: false }); f.change({ active: true }); expect(() => f.intent.assertCurrent()).toThrow(t.changed);
});
it('连接对象、版本和会话ABA分别永久失效，首次创建只绑定一次', () => {
  for (const patch of [{ connection: {} }, { connectionVersion: 2 }, { sessionId: '另一个会话' }, { closing: true }, { present: false }]) {
    const f = scopeFixture(), original = f.scope; f.change(patch); f.change(original); expect(f.intent.current()).toBe(false);
  }
  const fresh = scopeFixture(''); fresh.change({ sessionId: '新原会话' }); fresh.intent.bindSession('新原会话'); expect(fresh.intent.current()).toBe(true);
  fresh.change({ sessionId: '' }); fresh.change({ sessionId: '新原会话' }); expect(fresh.intent.current()).toBe(false);
});
it('每次新弹窗读取精确物理ID和实际库；未改变时不能应用，不自行调用数据库', async () => {
  const f = await mount(); expect(f.read).toHaveBeenCalledTimes(1); expect(f.apply).not.toHaveBeenCalled(); expect(button(t.apply).disabled).toBe(true);
  expect(document.querySelector(`[aria-label="${t.physicalId}"]`)!.textContent).toBe('9007199254740993');
  expect(document.querySelector(`[aria-label="${t.database}"]`)!.textContent).toBe('实际库'); expect(document.body.textContent).toContain(t.diagnosticsNotice);
  await click(t.refresh); expect(f.read).toHaveBeenCalledTimes(2); expect(f.invoke).not.toHaveBeenCalled();
});
it('应用携带原快照和固定枚举；失败后必须显式重读，不能重复或自动重试', async () => {
  const apply = vi.fn(async (_input: any): Promise<QueryTransactionSettingsSnapshot> => { throw Error('真实SET失败'); });
  const f = await mount(undefined, apply); await readonly(); expect(button(t.apply).disabled).toBe(false); await click(t.apply);
  expect(apply).toHaveBeenCalledTimes(1); expect(apply.mock.calls[0][0]).toMatchObject({ expected: baseline, isolation: baseline.isolation, readOnly: true });
  expect(button(t.apply).disabled).toBe(true); expect(document.body.textContent).toContain('真实SET失败'); expect(f.read).toHaveBeenCalledTimes(1);
  await click(t.refresh); await readonly(); expect(button(t.apply).disabled).toBe(false);
});
it('活动事务只允许读取，禁止修改默认设置但允许关闭', async () => {
  const f = await mount(vi.fn(async () => ({ ...baseline, transactionOpen: true })));
  expect(document.querySelector(`[aria-label="${t.isolation}"]`)!.disabled).toBe(true); expect(button(t.apply).disabled).toBe(true);
  expect(document.body.textContent).toContain(t.activeTransaction); await click(t.refresh); expect(f.read).toHaveBeenCalledTimes(2); await click(t.close); expect(f.close).toHaveBeenCalledTimes(1);
});
it('读取失败保留需重读状态，不自动重发，只有显式读取成功才恢复控件', async () => {
  const read = vi.fn(async () => ({ ...baseline })); read.mockRejectedValueOnce(Error('原会话协议状态未知'));
  const f = await mount(read); expect(read).toHaveBeenCalledTimes(1); expect(button(t.apply).disabled).toBe(true);
  expect(document.querySelector(`[aria-label="${t.isolation}"]`)!.disabled).toBe(true); expect(document.body.textContent).toContain('原会话协议状态未知');
  await click(t.refresh); expect(read).toHaveBeenCalledTimes(2); await readonly(); expect(button(t.apply).disabled).toBe(false); expect(f.apply).not.toHaveBeenCalled();
});
it('读取pending锁住关闭按钮及Escape；完成后来源ABA不能再读取或应用', async () => {
  let resolve!: (value: QueryTransactionSettingsSnapshot) => void;
  const f = await mount(vi.fn(() => new Promise<QueryTransactionSettingsSnapshot>(done => { resolve = done; })));
  expect(button(t.close).disabled).toBe(true); expect(button(t.dismiss).disabled).toBe(true);
  await act(async () => { document.body.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(f.close).not.toHaveBeenCalled();
  await act(async () => { f.source.change({ active: false }); f.source.change({ active: true }); resolve({ ...baseline }); });
  expect(button(t.refresh).disabled).toBe(true); expect(button(t.apply).disabled).toBe(true); expect(document.body.textContent).toContain(t.changed); await click(t.close); expect(f.close).toHaveBeenCalledTimes(1);
});
it('应用pending锁住再次应用与关闭，成功只展示返回的新默认值', async () => {
  let resolve!: (value: QueryTransactionSettingsSnapshot) => void;
  const apply = vi.fn((_input: any) => new Promise<QueryTransactionSettingsSnapshot>(done => { resolve = done; }));
  const f = await mount(undefined, apply); await readonly(); await click(t.apply);
  expect(button(t.close).disabled).toBe(true); expect(button(t.apply).disabled).toBe(true);
  await act(async () => { resolve({ ...baseline, readOnly: true }); });
  expect(button(t.apply).disabled).toBe(true); expect(document.querySelector(`[aria-label="${t.readOnly}"]`)!.checked).toBe(true); expect(f.read).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledTimes(1);
});
it('旧弹窗卸载后的晚回执不能影响新弹窗的来源和设置', async () => {
  let resolve!: (value: QueryTransactionSettingsSnapshot) => void;
  const old = await mount(vi.fn(() => new Promise<QueryTransactionSettingsSnapshot>(done => { resolve = done; })));
  await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
  const fresh = await mount(vi.fn(async () => ({ ...baseline, serverConnectionId: '42', database: '新原库' })));
  await act(async () => resolve({ ...baseline, readOnly: true }));
  expect(document.querySelector(`[aria-label="${t.physicalId}"]`)!.textContent).toBe('42'); expect(document.querySelector(`[aria-label="${t.database}"]`)!.textContent).toBe('新原库');
  expect(document.querySelector(`[aria-label="${t.readOnly}"]`)!.checked).toBe(false); expect(old.apply).not.toHaveBeenCalled(); expect(old.close).not.toHaveBeenCalled(); expect(fresh.apply).not.toHaveBeenCalled();
});

/** 通过真实React事件测试确认与同步锁；内存DOM不提供原生窗口验收证据。 */
async function toggleAutomatic(label: string = t.autocommitChoice) {
  const node = document.querySelector(`[aria-label="${label}"]`)!; expect(node.disabled).toBe(false);
  await act(async () => { node.checked = !node.checked; node.dispatchEvent(new MemoryEvent('click')); });
}
function originalClick(label: string): () => void {
  const node = button(label), key = Object.keys(node).find(name => name.startsWith('__reactProps$'));
  expect(key).toBeDefined(); return (node as any)[key!].onClick;
}
function automaticReply(input: any): QueryAutocommitOutput {
  return { confirmed: true, changed: input.expected.autocommit !== input.autocommit,
    implicitCommitAcknowledged: !input.expected.autocommit && input.autocommit && input.expected.transactionOpen,
    snapshot: { ...input.expected, autocommit: input.autocommit, transactionOpen: input.autocommit ? false : input.expected.transactionOpen } };
}
it('自动提交有独立按钮，关闭后不改默认事务属性或触发隐式提交', async () => {
  const automatic = vi.fn(async input => automaticReply(input)), f = await mount(undefined, undefined, automatic);
  expect(button(t.enableAutocommit).disabled).toBe(true); await toggleAutomatic(); await click(t.disableAutocommit);
  expect(automatic).toHaveBeenCalledTimes(1); expect(automatic.mock.calls[0][0]).toMatchObject({ expected: baseline, autocommit: false, allowImplicitCommit: false });
  expect(f.apply).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledTimes(1); expect(f.invoke).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('服务器已确认自动提交关闭');
});
it('关闭到开启有活动事务时明确展示提交警告并要求勾选确认', async () => {
  const expected = { ...baseline, autocommit: false, transactionOpen: true }, automatic = vi.fn(async input => automaticReply(input));
  await mount(vi.fn(async () => expected), undefined, automatic); await toggleAutomatic();
  expect(document.body.textContent).toContain(t.implicitCommit); expect(button(t.enableAndCommit).disabled).toBe(true);
  await act(async () => originalClick(t.enableAndCommit)()); expect(automatic).not.toHaveBeenCalled();
  await toggleAutomatic(t.acknowledgeCommit); await click(t.enableAndCommit);
  expect(automatic.mock.calls[0][0]).toMatchObject({ expected, autocommit: true, allowImplicitCommit: true });
  expect(document.body.textContent).toContain('原活动事务已确认提交'); expect(button(t.enableAutocommit).disabled).toBe(true);
});
it('活动事务中关闭自动提交仍保留事务，默认值修改继续禁用', async () => {
  const automatic = vi.fn(async input => automaticReply(input));
  await mount(vi.fn(async () => ({ ...baseline, transactionOpen: true })), undefined, automatic);
  await toggleAutomatic(); await click(t.disableAutocommit);
  expect(document.querySelector(`[aria-label="${t.transaction}"]`)!.textContent).toBe(t.yes);
  expect(document.querySelector(`[aria-label="${t.isolation}"]`)!.disabled).toBe(true);
  expect(automatic.mock.calls[0][0].allowImplicitCommit).toBe(false); expect(document.body.textContent).not.toContain('原活动事务已确认提交');
});
it('选择往返或刷新永久撤销旧确认闭包，不能通过ABA提交', async () => {
  const expected = { ...baseline, autocommit: false, transactionOpen: true }, automatic = vi.fn(async input => automaticReply(input));
  await mount(vi.fn(async () => expected), undefined, automatic); await toggleAutomatic(); await toggleAutomatic(t.acknowledgeCommit);
  const old = originalClick(t.enableAndCommit); await toggleAutomatic(); await toggleAutomatic();
  await act(async () => old()); expect(automatic).not.toHaveBeenCalled(); expect(button(t.enableAndCommit).disabled).toBe(true);
  await toggleAutomatic(t.acknowledgeCommit); const beforeRefresh = originalClick(t.enableAndCommit); await click(t.refresh);
  await act(async () => beforeRefresh()); expect(automatic).not.toHaveBeenCalled();
  expect(document.querySelector(`[aria-label="${t.autocommitChoice}"]`)!.checked).toBe(false);
  expect(button(t.disableAutocommit).disabled).toBe(true);
});
it('自动提交请求同轮双点只发送一次，pending覆盖刷新关闭及默认值设置', async () => {
  let resolve!: (value: QueryAutocommitOutput) => void;
  const automatic = vi.fn((_input: any) => new Promise<QueryAutocommitOutput>(done => { resolve = done; })), f = await mount(undefined, undefined, automatic);
  await toggleAutomatic(); const old = originalClick(t.disableAutocommit);
  await act(async () => { old(); old(); }); expect(automatic).toHaveBeenCalledTimes(1);
  for (const label of [t.close, t.dismiss, t.refresh, t.apply]) expect(button(label).disabled).toBe(true);
  await act(async () => { document.body.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' })); }); expect(f.close).not.toHaveBeenCalled();
  await act(async () => resolve(automaticReply(automatic.mock.calls[0][0]))); expect(button(t.close).disabled).toBe(false);
});
it('失败后旧应用回调不能重发，只有显式刷新可恢复', async () => {
  const automatic = vi.fn(async (_input: any): Promise<QueryAutocommitOutput> => { throw Error('原连接断线；结果未知'); }), f = await mount(undefined, undefined, automatic);
  await toggleAutomatic(); const old = originalClick(t.disableAutocommit); await click(t.disableAutocommit);
  await act(async () => old()); expect(automatic).toHaveBeenCalledTimes(1); expect(button(t.disableAutocommit).disabled).toBe(true);
  expect(document.body.textContent).toContain('结果未知'); expect(f.read).toHaveBeenCalledTimes(1);
  await click(t.refresh); expect(f.read).toHaveBeenCalledTimes(2); expect(button(t.enableAutocommit).disabled).toBe(true);
});
it('ACK确认提交但附加收尾异常时仍明确成功，锁定修改直到显式读取', async () => {
  const expected = { ...baseline, autocommit: false, transactionOpen: true };
  const automatic = vi.fn(async input => ({ ...automaticReply(input), cleanupWarning: '附加收尾失败；请显式重新读取' }));
  const f = await mount(vi.fn(async () => expected), undefined, automatic); await toggleAutomatic(); await toggleAutomatic(t.acknowledgeCommit); await click(t.enableAndCommit);
  expect(document.body.textContent).toContain('原活动事务已确认提交'); expect(document.body.textContent).toContain('附加收尾失败');
  expect(button(t.enableAutocommit).disabled).toBe(true); expect(button(t.refresh).disabled).toBe(false); expect(f.read).toHaveBeenCalledTimes(1);
});
it('原会话ABA后晚确认不能安装到新来源；卸载后旧按钮也不能发送', async () => {
  let resolve!: (value: QueryAutocommitOutput) => void;
  const automatic = vi.fn((_input: any) => new Promise<QueryAutocommitOutput>(done => { resolve = done; })), f = await mount(undefined, undefined, automatic);
  await toggleAutomatic(); await click(t.disableAutocommit);
  await act(async () => { f.source.change({ active: false }); f.source.change({ active: true }); resolve(automaticReply(automatic.mock.calls[0][0])); });
  expect(document.querySelector(`[aria-label="${t.autocommit}"]`)!.textContent).toBe(t.yes); expect(document.body.textContent).toContain(t.changed);
  await act(async () => root!.unmount()); root = undefined; document.body.textContent = '';
  const freshAutomatic = vi.fn(async input => automaticReply(input)); await mount(undefined, undefined, freshAutomatic); await toggleAutomatic();
  const old = originalClick(t.disableAutocommit); await act(async () => root!.unmount()); root = undefined;
  await act(async () => old()); expect(freshAutomatic).not.toHaveBeenCalled();
});
