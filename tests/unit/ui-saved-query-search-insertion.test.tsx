import { act, StrictMode } from 'react';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SavedQuerySearchDialog } from '../../src/renderer/components/SavedQuerySearchDialog';
import type { HistoryInsertionTarget } from '../../src/renderer/historyInsertion';
import { savedQueryInsertionZh as text } from '../../src/renderer/locales/savedQueryInsertion.zh-CN';
import { savedQuerySearchZh as searchText } from '../../src/renderer/locales/savedQuerySearch.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';

const { invoke, notify, grid } = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), grid: { current: undefined as any } }));
vi.mock('../../src/renderer/lib', () => ({ invoke, uid: () => randomUUID(), errorMessage: (reason: unknown) => reason instanceof Error ? reason.message : String(reason) }));
const connections = [{ id: 'target', name: '原查询连接' }];
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign(() => ({ connections, settings: { theme: 'dark' } }), { getState: () => ({ notify }) }) }));
/** 只替代虚拟网格DOM边界；点击仍进入真实搜索组件的select处理，不读写其私有状态。 */
vi.mock('react-data-grid', () => ({ DataGrid: (props: any) => {
  grid.current = props;
  return <div role="grid">{props.rows.map((row: any) => <button key={row.query.id} aria-label={'本例行 ' + row.query.id} onClick={() => props.onCellClick({ row })}>{row.query.name}</button>)}</div>;
} }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
const sql = "SELECT '" + '原始全文 '.repeat(100) + "末尾 $0', 18446744073709551615;\n-- 原默认库不变";
const hit = (id = 'q1') => ({ query: { id, name: '搜索来源 ' + id, connectionId: 'deleted', updatedAt: '2026-10-28T00:00:00.000Z' }, digest: 'c'.repeat(64), matches: [{ field: 'sql' as const, line: 1, column: 1, offset: 0, length: 2, preview: '不是完整 SQL', previewTruncated: true }] });
const page = (next = false) => ({ hits: next ? [hit('q3')] : [hit(), hit('q2')], failures: [], scanned: next ? 3 : 2, totalHits: next ? 3 : 2, limitReached: false, stoppedOnError: false, cursor: next ? undefined : 'search-cursor' });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function target() {
  let valid = true; const listeners = new Set<() => void>(), inserted = vi.fn();
  const invalidate = () => { valid = false; for (const changed of [...listeners]) changed(); };
  const lease: HistoryInsertionTarget = { title: '原查询选区', connectionId: 'target', current: () => valid, dispose: invalidate, subscribe: changed => { listeners.add(changed); return () => { listeners.delete(changed); }; }, insert: value => { if (!valid) throw Error(text.changed); inserted(value); invalidate(); } };
  return { lease, inserted, invalidate };
}
function fixture() { return { ...target(), onClose: vi.fn(), onOpen: vi.fn(), onStructure: vi.fn() }; }

it.each([false, true])('App传入%s插入目标时，搜索窗口仍只有一个进度状态，说明不冒充搜索结果', async withTarget => {
  const f = fixture(); await render(f, withTarget ? f.lease : null);
  const statuses = doc.querySelectorAll('[role="status"]'); expect(statuses).toHaveLength(1);
  expect(statuses[0].textContent).toContain(searchText.empty);
  expect(doc.body.textContent).toContain(withTarget ? text.target(f.lease.title) : text.unavailable);
  expect(doc.querySelectorAll('p').some(node => node.getAttribute('aria-live') === 'polite' && node.textContent.includes(withTarget ? text.target(f.lease.title) : text.unavailable))).toBe(true);
});
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
beforeEach(() => {
  invoke.mockReset(); notify.mockReset(); grid.current = undefined;
  invoke.mockImplementation(async (command: string, input?: any): Promise<any> => {
    if (command === 'search.savedQueries') return page();
    if (command === 'search.savedQueriesContinue') return page(true);
    if (command === 'search.savedQueriesRelease' || command === 'query.cancel') return;
    if (command === 'queries.readText') return { query: { ...hit().query, id: input.id, sql } };
    if (command === 'queries.read') return { query: { ...hit().query, sql }, connectionId: input.connectionId, databaseContext: { state: 'unknown' }, contextChanged: true };
    throw Error('本例禁止其它IPC：' + command);
  });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function render(f: ReturnType<typeof fixture>, insertion: HistoryInsertionTarget | null = f.lease, strict = false) {
  if (!root) { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); }
  const element = <SavedQuerySearchDialog insertion={insertion} onClose={f.onClose} onOpen={f.onOpen} onStructure={f.onStructure}/>;
  await act(async () => root!.render(strict ? <StrictMode>{element}</StrictMode> : element));
}
function button(label: string) { const result = doc.querySelectorAll('button').find(node => node.textContent === label || node.getAttribute('aria-label') === label); if (!result) throw Error('缺少按钮：' + label); return result; }
async function click(label: string) { const node = button(label); expect(node.disabled).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const node = doc.querySelectorAll('input').find(node => node.getAttribute('aria-label') === label); if (!node) throw Error(label); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
function callback(node: any, name = 'onClick') { const key = Object.keys(node).find(value => value.startsWith('__reactProps$')); if (!key || typeof node[key][name] !== 'function') throw Error('缺少真实React事件'); return node[key][name] as (event?: any) => void; }
const calls = (command: string) => invoke.mock.calls.filter(call => call[0] === command);
async function search() { await input(searchText.keyword, '合成关键词'); await click(searchText.start); await click('本例行 q1'); }
async function escape() { await act(async () => doc.dispatchEvent(Object.assign(new MemoryEvent('keydown'), { key: 'Escape' }))); }

it('不自动搜索；选中命中后只按id/digest读取全文，先释放再单次插入且不借来源连接', async () => {
  const f = fixture(); await render(f); expect(invoke).not.toHaveBeenCalled(); expect(button(text.insert).disabled).toBe(true); await search();
  expect(button(searchText.open).disabled).toBe(true); await click(text.insert);
  expect(calls('queries.readText')).toEqual([['queries.readText', { id: 'q1', digest: hit().digest }]]);
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['search.savedQueries', 'queries.readText', 'search.savedQueriesRelease']);
  expect(f.inserted).toHaveBeenCalledExactlyOnceWith(sql); expect(f.onClose).toHaveBeenCalledTimes(1); expect(f.onOpen).not.toHaveBeenCalled();
});

it.each(['原查询已修改', '原查询已删除', '摘要核对失败'])('重读原错保持：%s，不插入概要或自动重试', async message => {
  const f = fixture(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'queries.readText' ? Promise.reject(Error(message)) : normal(command, value));
  await render(f); await search(); await click(text.insert);
  expect(doc.querySelector('[role="alert"]')?.textContent).toBe(message); expect(calls('queries.readText')).toHaveLength(1); expect(f.inserted).not.toHaveBeenCalled(); expect(f.onClose).not.toHaveBeenCalled(); expect(calls('search.savedQueriesRelease')).toHaveLength(0);
});

it('同轮双点只读取一次，Escape可在读及释放期间撤销并等待实际收尾', async () => {
  const f = fixture(), read = deferred<{ query: { sql: string } }>(), release = deferred<void>(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'queries.readText' ? read.promise : command === 'search.savedQueriesRelease' ? release.promise : normal(command, value));
  await render(f); await search(); const old = callback(button(text.insert)); await act(async () => { old(); old(); });
  expect(calls('queries.readText')).toHaveLength(1); await escape(); expect(f.lease.current()).toBe(false); expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => read.resolve({ query: { sql } })); expect(f.onClose).not.toHaveBeenCalled();
  await act(async () => release.resolve()); expect(f.onClose).toHaveBeenCalledTimes(1); expect(f.inserted).not.toHaveBeenCalled(); expect(calls('search.savedQueriesRelease')).toHaveLength(1);
});

it('读取完成但释放未结束时标题关闭仍有效；释放失败保留原内容而不插入', async () => {
  const f = fixture(), release = deferred<void>(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'search.savedQueriesRelease' ? release.promise : normal(command, value));
  await render(f); await search(); await click(text.insert); expect(f.inserted).not.toHaveBeenCalled(); await click(zh.dialogs.text001);
  await act(async () => release.reject(Error('搜索句柄释放失败')));
  expect(doc.querySelector('[role="alert"]')?.textContent).toBe('搜索句柄释放失败'); expect(f.onClose).not.toHaveBeenCalled(); expect(f.inserted).not.toHaveBeenCalled(); expect(grid.current.rows).toHaveLength(2);
});

it('真实grid选择A→B→A撤销在途读取；未应用条件和续页后旧DOM不消费新结果', async () => {
  const f = fixture(), read = deferred<{ query: { sql: string } }>(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'queries.readText' ? read.promise : normal(command, value));
  await render(f); await search(); await click(text.insert); await click('本例行 q2'); await click('本例行 q1'); await act(async () => read.resolve({ query: { sql } }));
  expect(f.inserted).not.toHaveBeenCalled(); expect(doc.querySelector('[role="alert"]')?.textContent).toBe(text.changed);
  const old = callback(button(text.insert)); await input(searchText.keyword, '另一条件'); expect(button(text.insert).disabled).toBe(true); await input(searchText.keyword, '合成关键词'); await act(async () => old()); expect(calls('queries.readText')).toHaveLength(1);
  const beforePage = callback(button(text.insert)); await click(searchText.next); await act(async () => beforePage()); expect(calls('queries.readText')).toHaveLength(1); expect(grid.current.rows).toHaveLength(3);
});

it('prop目标A→B→A不复活旧租约，晚回包和旧DOM不写任一目标', async () => {
  const f = fixture(), b = target(), read = deferred<{ query: { sql: string } }>(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'queries.readText' ? read.promise : normal(command, value));
  await render(f); await search(); const old = callback(button(text.insert)); await click(text.insert); await render(f, b.lease); await render(f, f.lease); await act(async () => read.resolve({ query: { sql } })); await act(async () => old());
  expect(f.inserted).not.toHaveBeenCalled(); expect(b.inserted).not.toHaveBeenCalled(); expect(button(text.insert).disabled).toBe(true); expect(calls('queries.readText')).toHaveLength(1);
});

it('原打开仍核连接并把结果交父入口；返回结构搜索撤销本子租约', async () => {
  const f = fixture(); await render(f); await search(); const node = doc.querySelectorAll('select').find(node => node.getAttribute('aria-label') === searchText.openConnection)!;
  await act(async () => { node.value = 'target'; node.dispatchEvent(new MemoryEvent('change')); }); await click(searchText.open);
  expect(calls('queries.read')[0][1]).toEqual({ id: 'q1', digest: hit().digest, connectionId: 'target' }); expect(f.onOpen).toHaveBeenCalledTimes(1); expect(f.inserted).not.toHaveBeenCalled(); expect(f.lease.current()).toBe(false);
  await act(async () => root!.unmount()); root = undefined; const next = fixture(); await render(next); await click(searchText.structure); expect(next.onStructure).toHaveBeenCalledTimes(1); expect(next.lease.current()).toBe(false);
});

it('没有目标明确禁用；StrictMode不消费原权限，卸载晚读取只清理不发布', async () => {
  const f = fixture(); await render(f, null); expect(button(text.insert).disabled).toBe(true); expect(doc.body.textContent).toContain(text.unavailable);
  await act(async () => root!.unmount()); root = undefined; const next = fixture(), read = deferred<{ query: { sql: string } }>(), normal = invoke.getMockImplementation()!;
  invoke.mockImplementation((command, value) => command === 'queries.readText' ? read.promise : normal(command, value));
  await render(next, next.lease, true); expect(next.lease.current()).toBe(true); await search(); await click(text.insert); await act(async () => root!.unmount()); root = undefined;
  await act(async () => read.resolve({ query: { sql } })); expect(next.inserted).not.toHaveBeenCalled(); expect(next.onClose).not.toHaveBeenCalled(); expect(next.onOpen).not.toHaveBeenCalled();
});
