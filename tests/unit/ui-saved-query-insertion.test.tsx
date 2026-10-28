import { act, StrictMode } from 'react';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SavedQueriesDialog } from '../../src/renderer/components/SavedQueriesDialog';
import type { HistoryInsertionTarget } from '../../src/renderer/historyInsertion';
import { savedQueryInsertionZh as text } from '../../src/renderer/locales/savedQueryInsertion.zh-CN';
import { savedQueryPagesZh as pages } from '../../src/renderer/locales/savedQueryPages.zh-CN';
import { savedQueryOrganizationZh as groups } from '../../src/renderer/locales/savedQueryOrganization.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const { notify, openTab } = vi.hoisted(() => ({ notify: vi.fn(), openTab: vi.fn() }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign((select: (state: any) => unknown) => select({ connections: [{ id: 'target', name: '原查询连接' }] }), { getState: () => ({ notify, openTab }) }) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
const sql = "SELECT 18446744073709551615, '" + '完整 SQL '.repeat(100) + "尾部 $0';\n-- 保留原文";
const entry = (id = 'q1') => ({ query: { id, name: '来源已删除的查询', connectionId: 'deleted', databaseContext: { state: 'known' as const, database: '来源库' }, updatedAt: '2026-10-28T00:00:00.000Z' }, digest: 'a'.repeat(64), sqlPreview: '绝不能插入的概要', sqlUnits: sql.length, previewTruncated: true });
const page = (id = 'q1') => ({ items: [entry(id)], failures: [], scanned: 1, matched: 1, failed: 0, stoppedOnError: false, cursor: 'cursor-' + id });
const organization = { revision: 'b'.repeat(64), groups: [], unfiledCount: 2, totalCount: 2 };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
/** 这里只替代外界编辑权限，组件仍走真实摘要读取、分页和清理；不代表真实Monaco验收。 */
function target() {
  let valid = true; const listeners = new Set<() => void>(), inserted = vi.fn();
  const invalidate = () => { valid = false; for (const changed of [...listeners]) changed(); };
  const lease: HistoryInsertionTarget = { title: '原活动查询', connectionId: 'target', current: () => valid, dispose: invalidate, subscribe: changed => { listeners.add(changed); return () => { listeners.delete(changed); }; }, insert: value => { if (!valid) throw Error(text.changed); inserted(value); invalidate(); } };
  return { lease, inserted, invalidate };
}
function fixture() {
  const item = target(), onClose = vi.fn(), onHistory = vi.fn();
  const request = vi.fn(async (command: string, _input?: any): Promise<any> => {
    if (command === 'queries.organizationGet') return organization;
    if (command === 'queries.page') return page();
    if (command === 'queries.pageContinue') return page('q2');
    if (command === 'queries.readText') return { query: { ...entry().query, sql } };
    if (command === 'queries.pageRelease' || command === 'query.cancel') return;
    throw Error('本例禁止额外命令：' + command);
  });
  const io = { request: request as any, id: randomUUID };
  return { ...item, request, io, onClose, onHistory };
}
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name); if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); }
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (name === 'option' && key === 'value') node.value = String(value); };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; notify.mockReset(); openTab.mockReset(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function render(f: ReturnType<typeof fixture>, insertion: HistoryInsertionTarget | null = f.lease, strict = false) {
  if (!root) { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); }
  const element = <SavedQueriesDialog services={f.io} insertion={insertion} onClose={f.onClose} onHistory={f.onHistory}/>;
  await act(async () => root!.render(strict ? <StrictMode>{element}</StrictMode> : element));
}
function button(label: string) { const result = doc.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); if (!result) throw Error('缺少按钮：' + label); return result; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function callback(node: any, name = 'onClick') { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key || typeof node[key][name] !== 'function') throw Error('缺少真实React事件'); return node[key][name] as (event?: any) => void; }
const calls = (f: ReturnType<typeof fixture>, command: string) => f.request.mock.calls.filter(call => call[0] === command);
async function escape() { await act(async () => doc.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }))); }

it('来源连接缺失仍按摘要插入完整长SQL，先释放游标且不打开新标签或发送连接参数', async () => {
  const f = fixture(); await render(f); expect(button(zh.activity.text010).disabled).toBe(true);
  expect(doc.body.textContent).toContain(text.target(f.lease.title)); await click(text.insert);
  expect(calls(f, 'queries.readText')).toEqual([['queries.readText', { id: 'q1', digest: entry().digest }]]);
  expect(f.request.mock.calls.map(call => call[0])).toEqual(['queries.organizationGet', 'queries.page', 'queries.readText', 'queries.pageRelease']);
  expect(f.inserted).toHaveBeenCalledExactlyOnceWith(sql); expect(f.onClose).toHaveBeenCalledTimes(1); expect(openTab).not.toHaveBeenCalled();
});

it.each(['查询已修改', '查询已删除', '摘要不匹配'])('重读失败保留原错误：%s，不重试、不释放原列表或插入预览', async message => {
  const f = fixture(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((command, input) => command === 'queries.readText' ? Promise.reject(Error(message)) : normal(command, input));
  await render(f); await click(text.insert); expect(doc.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(calls(f, 'queries.readText')).toHaveLength(1); expect(calls(f, 'queries.pageRelease')).toHaveLength(0); expect(f.inserted).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled();
});

it('同步双击只读一次；读在途Escape等原读取及释放后只关闭，绝不插入', async () => {
  const f = fixture(), read = deferred<{ query: { sql: string } }>(), release = deferred<void>(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((command, input) => command === 'queries.readText' ? read.promise : command === 'queries.pageRelease' ? release.promise : normal(command, input));
  await render(f); const old = callback(button(text.insert)); await act(async () => { old(); old(); });
  expect(calls(f, 'queries.readText')).toHaveLength(1); await escape(); expect(f.lease.current()).toBe(false); expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => read.resolve({ query: { sql } })); expect(f.onClose).not.toHaveBeenCalled(); expect(f.inserted).not.toHaveBeenCalled();
  await act(async () => release.resolve()); expect(f.onClose).toHaveBeenCalledTimes(1); expect(calls(f, 'queries.pageRelease')).toHaveLength(1); expect(f.inserted).not.toHaveBeenCalled();
});

it('成功读回后的释放等待仍能用标题关闭撤销，释放失败保留原错误且不编辑', async () => {
  const f = fixture(), release = deferred<void>(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((command, input) => command === 'queries.pageRelease' ? release.promise : normal(command, input));
  await render(f); await click(text.insert); expect(f.inserted).not.toHaveBeenCalled(); await click(zh.dialogs.text001);
  await act(async () => release.reject(Error('游标释放未确认')));
  expect(f.inserted).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(doc.querySelector('[role="alert"]')?.textContent).toBe('游标释放未确认');
});

it('分页、选择变化及未应用搜索草稿都拒绝旧插入回调，不能按相同标题认领新页', async () => {
  const f = fixture(); await render(f); const first = callback(button(text.insert)); await click(pages.next); await act(async () => first()); expect(calls(f, 'queries.readText')).toHaveLength(0);
  const second = callback(button(text.insert)), choice = doc.querySelectorAll('input').find(node => node.getAttribute('aria-label') === groups.select(entry().query.name))!;
  await act(async () => callback(choice, 'onChange')({ target: { checked: true } })); await act(async () => second()); expect(calls(f, 'queries.readText')).toHaveLength(0);
  const current = callback(button(text.insert)), input = doc.querySelectorAll('input').find(node => node.getAttribute('aria-label') === pages.search)!;
  await act(async () => { input.value = '新条件'; input.dispatchEvent(new MemoryEvent('input')); });
  expect(button(text.insert).disabled).toBe(true); await act(async () => current()); expect(calls(f, 'queries.readText')).toHaveLength(0);
});

it('目标prop A→B→A永久撤销原A，旧按钮与原读回包不能插入后来目标', async () => {
  const f = fixture(), b = target(), read = deferred<{ query: { sql: string } }>(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((command, input) => command === 'queries.readText' ? read.promise : normal(command, input));
  await render(f); const old = callback(button(text.insert)); await click(text.insert); await render(f, b.lease); await render(f, f.lease);
  await act(async () => read.resolve({ query: { sql } })); await act(async () => old());
  expect(f.inserted).not.toHaveBeenCalled(); expect(b.inserted).not.toHaveBeenCalled(); expect(calls(f, 'queries.readText')).toHaveLength(1); expect(button(text.insert).disabled).toBe(true); expect(f.onClose).not.toHaveBeenCalled();
});

it('没有目标禁插入；切历史沿原清理关闭并撤销子权限', async () => {
  const f = fixture(); await render(f, null); expect(button(text.insert).disabled).toBe(true); expect(doc.body.textContent).toContain(text.unavailable);
  await render(f); await click(zh.activity.text004); expect(f.lease.current()).toBe(false); expect(f.onHistory).toHaveBeenCalledTimes(1); expect(f.inserted).not.toHaveBeenCalled();
});

it('StrictMode重建订阅保留原权限；真正卸载后旧回包只有释放权', async () => {
  const f = fixture(), read = deferred<{ query: { sql: string } }>(), normal = f.request.getMockImplementation()!;
  f.request.mockImplementation((command, input) => command === 'queries.readText' ? read.promise : normal(command, input));
  await render(f, f.lease, true); expect(f.lease.current()).toBe(true); expect(calls(f, 'queries.page')).toHaveLength(1); await click(text.insert);
  await act(async () => root!.unmount()); root = undefined; await act(async () => read.resolve({ query: { sql } }));
  expect(f.inserted).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(calls(f, 'queries.pageRelease')).toHaveLength(1); expect(openTab).not.toHaveBeenCalled();
});
