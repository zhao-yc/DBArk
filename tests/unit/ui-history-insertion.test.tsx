import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { HistoryPagesDialog } from '../../src/renderer/components/HistoryPagesDialog';
import type { HistoryInsertionTarget } from '../../src/renderer/historyInsertion';
import { historyInsertionZh as text } from '../../src/renderer/locales/historyInsertion.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const { invoke, notify, openTab } = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), openTab: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke, uid: () => randomUUID(), errorMessage: (reason: unknown) => reason instanceof Error ? reason.message : String(reason) }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign((select: (state: unknown) => unknown) => select({ connections: [{ id: 'current', name: '原查询连接' }, { id: 'other', name: '另一个连接' }] }), { getState: () => ({ notify, openTab }) }) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client').createRoot, root: ReturnType<typeof createRoot> | undefined;
let onClose: ReturnType<typeof vi.fn>, target: HistoryInsertionTarget, insert: ReturnType<typeof vi.fn>, invalidate: () => void;
const sql = 'SELECT \'完整历史\', 9007199254740993;\n-- $0 原样';
const summary = { entry: { id: 'history-1', connectionId: 'removed', startedAt: '2026-10-28T00:00:00.000Z', elapsedMs: 1, success: true }, digest: 'a'.repeat(64), sqlPreview: '仅概要', sqlUnits: sql.length, previewTruncated: true, errorUnits: 0, errorTruncated: false };
const page = { items: [summary], failures: [], scanned: 1, matched: 1, failed: 0, stoppedOnError: false, cursor: 'original-cursor' };
const reply = { entry: { ...summary.entry, sql }, connectionId: 'current', database: '历史库', contextChanged: true };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeAll(async () => {
  doc = memoryDocument(); const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name);
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (name === 'option' && key === 'value') node.value = String(value); };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; };
    return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => {
  onClose = vi.fn(); insert = vi.fn(); notify.mockReset(); openTab.mockReset();
  let current = true;
  const listeners = new Set<() => void>();
  invalidate = () => { if (!current) return; current = false; for (const listener of [...listeners]) listener(); };
  target = { title: '原活动查询', connectionId: 'current', current: () => current, insert: value => { if (!current) throw Error(text.changed); insert(value); invalidate(); }, dispose: invalidate, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  invoke.mockReset().mockImplementation(async command => {
    if (command === 'history.page') return page;
    if (command === 'history.read') return reply;
    if (command === 'history.pageRelease') return;
    throw Error('本例禁止其它IPC：' + command);
  });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mount(insertion: HistoryInsertionTarget | null = target) {
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<HistoryPagesDialog insertion={insertion} onClose={onClose} onQueries={vi.fn()}/>));
}
function button(label: string) { const node = doc.querySelectorAll('button').find(value => value.textContent === label); if (!node) throw Error('缺少按钮：' + label); return node; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
const reads = () => invoke.mock.calls.filter(call => call[0] === 'history.read');

it('历史原连接已删除也可插入原查询，摘要读取不依赖卡片的目标连接且不打开新页', async () => {
  await mount(); expect(button(zh.activity.text010).disabled).toBe(true); expect(button(text.insert).disabled).toBe(false);
  await click(text.insert);
  expect(reads()).toEqual([['history.read', { id: 'history-1', digest: summary.digest, connectionId: 'current' }]]);
  expect(insert).toHaveBeenCalledExactlyOnceWith(sql); expect(openTab).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('history.pageRelease', { cursor: 'original-cursor' });
  expect(invoke.mock.calls.map(call => call[0])).toEqual(['history.page', 'history.read', 'history.pageRelease']);
});

it('打开时非查询则按钮禁用并说明，不能临时改选一个编辑器', async () => {
  await mount(null); expect(button(text.insert).disabled).toBe(true); expect(doc.body.textContent).toContain(text.unavailable); expect(reads()).toHaveLength(0);
});

it('history.read失败保留Main原错误，不自动重读、插入或关闭', async () => {
  invoke.mockImplementation(async command => command === 'history.page' ? page : command === 'history.read' ? Promise.reject(Error('历史摘要已变化，拒绝读取')) : undefined);
  await mount(); await click(text.insert);
  expect(doc.querySelector('[role="alert"]')!.textContent).toBe('历史摘要已变化，拒绝读取');
  expect(reads()).toHaveLength(1); expect(insert).not.toHaveBeenCalled(); expect(openTab).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});

it('关闭时原读取仍收尾，迟到完整正文不插入也不借关闭重读', async () => {
  const wait = deferred<typeof reply>();
  invoke.mockImplementation(command => command === 'history.page' ? Promise.resolve(page) : command === 'history.read' ? wait.promise : Promise.resolve(undefined));
  await mount(); await click(text.insert); await click(zh.common.close);
  expect(target.current()).toBe(false); expect(onClose).not.toHaveBeenCalled();
  await act(async () => wait.resolve(reply));
  expect(insert).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1); expect(reads()).toHaveLength(1); expect(openTab).not.toHaveBeenCalled();
});

it('完整正文已返回但游标释放未结束时标题关闭仍撤销插入，原收尾完成后只关闭', async () => {
  const release = deferred<void>();
  invoke.mockImplementation(command => command === 'history.page' ? Promise.resolve(page) : command === 'history.read' ? Promise.resolve(reply) : command === 'history.pageRelease' ? release.promise : Promise.resolve(undefined));
  await mount(); await click(text.insert);
  expect(reads()).toHaveLength(1); expect(target.current()).toBe(true); expect(insert).not.toHaveBeenCalled();
  const close = doc.querySelector(`button[aria-label="${zh.dialogs.text001}"]`)!;
  expect(close.disabled).toBe(false); await act(async () => close.dispatchEvent(new MemoryEvent('click')));
  expect(target.current()).toBe(false); expect(onClose).not.toHaveBeenCalled();
  await act(async () => release.resolve(undefined));
  expect(insert).not.toHaveBeenCalled(); expect(onClose).toHaveBeenCalledTimes(1); expect(openTab).not.toHaveBeenCalled();
  expect(reads()).toHaveLength(1); expect(invoke.mock.calls.filter(call => call[0] === 'history.pageRelease')).toHaveLength(1);
});

it('模型/导航租约失效后同历史的迟到回包不插入，按钮同步禁用', async () => {
  const wait = deferred<typeof reply>();
  invoke.mockImplementation(command => command === 'history.page' ? Promise.resolve(page) : command === 'history.read' ? wait.promise : Promise.resolve(undefined));
  await mount(); await click(text.insert); await act(async () => invalidate()); await act(async () => wait.resolve(reply));
  expect(insert).not.toHaveBeenCalled(); expect(button(text.insert).disabled).toBe(true); expect(doc.querySelector('[role="alert"]')!.textContent).toBe(text.changed); expect(onClose).not.toHaveBeenCalled(); expect(reads()).toHaveLength(1);
});

it('组件卸载后原读取只收尾，不插入、不发布旧错误或重建新标签', async () => {
  const wait = deferred<typeof reply>();
  invoke.mockImplementation(command => command === 'history.page' ? Promise.resolve(page) : command === 'history.read' ? wait.promise : Promise.resolve(undefined));
  await mount(); await click(text.insert); await act(async () => root!.unmount()); root = undefined;
  await act(async () => wait.resolve(reply));
  expect(insert).not.toHaveBeenCalled(); expect(openTab).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled(); expect(reads()).toHaveLength(1);
});

it('旧“打开新标签”仍按明确选择的连接和历史上下文创建新草稿，不消费插入权限', async () => {
  invoke.mockImplementation(async command => command === 'history.page' ? { ...page, items: [{ ...summary, entry: { ...summary.entry, connectionId: 'other' } }] } : command === 'history.read' ? { ...reply, connectionId: 'other', contextChanged: false } : undefined);
  await mount(); await click(zh.activity.text010);
  expect(reads()[0][1]).toEqual({ id: 'history-1', digest: summary.digest, connectionId: 'other' });
  expect(openTab).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'query', connectionId: 'other', database: '历史库', sql }));
  expect(insert).not.toHaveBeenCalled(); expect(target.current()).toBe(false); expect(onClose).toHaveBeenCalledTimes(1);
});
