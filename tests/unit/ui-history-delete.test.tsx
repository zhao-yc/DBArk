import { act } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent, type MemoryNode } from '../fixtures/memory-dom';
import type { HistoryPage, HistoryPageEntry } from '../../src/shared/historyPages';
import type { HistoryDeletePreviewOutput } from '../../src/shared/historyDelete';
import { HistoryDeleteIntent } from '../../src/renderer/historyDeleteUi';
import { historyDeleteZh as text } from '../../src/renderer/locales/historyDelete.zh-CN';
import { historyPagesZh as pages } from '../../src/renderer/locales/historyPages.zh-CN';
import { HistoryPagesDialog } from '../../src/renderer/components/HistoryPagesDialog';
import { HistoryDeleteDialog } from '../../src/renderer/components/HistoryDeleteDialog';

const { invoke, notify, openTab, holder, listeners } = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), openTab: vi.fn(), holder: { state: {} as any }, listeners: new Set<() => void>() }));
vi.mock('../../src/renderer/lib', () => ({ invoke, errorMessage: String, uid: () => randomUUID() }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign((select: (state: any) => unknown) => select(holder.state), { getState: () => holder.state, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } }) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined;
const record = (id: string): HistoryPageEntry => ({ entry: { id, connectionId: 'connection', startedAt: '2026-10-23T00:00:00.000Z', elapsedMs: 8, success: true, databaseContext: { state: 'known', database: null } }, digest: 'a'.repeat(64), sqlPreview: `SELECT '${id}'`, sqlUnits: 100, previewTruncated: true, errorUnits: 0, errorTruncated: false });
const page = (ids = ['1', '2'], cursor = 'cursor-first'): HistoryPage => ({ items: ids.map(record), scanned: ids.length, matched: ids.length, failed: 0, failures: [], stoppedOnError: false, cursor });
const preview = (kind: 'selected' | 'filtered' = 'filtered', count = 26): HistoryDeletePreviewOutput => ({ previewToken: randomUUID(), kind, count, scanned: Math.max(30, count), samples: Array.from({ length: Math.min(count, 3) }, (_, i) => { const { entry, sqlPreview, sqlUnits, previewTruncated } = record(String(i + 1)); return { entry, sqlPreview, sqlUnits, previewTruncated }; }), expiresAt: new Date(Date.now() + 60_000).toISOString() });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; const create = doc.createElement.bind(doc);
  /** 只补标准属性反射；真实React、筛选、选择、租约和异步Promise不做替身。 */
  doc.createElement = name => {
    const node = create(name), set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (name === 'option' && key === 'value') node.value = String(value); };
    node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => {
  listeners.clear(); holder.state = { connections: [{ id: 'connection', name: '本例连接' }], settings: { activeTabId: 'original', tabs: [{ id: 'original', kind: 'query', connectionId: 'connection', sql: '未执行草稿' }] }, connectionVersions: { connection: 1 }, notify, openTab };
  invoke.mockReset().mockImplementation(async (command, input) => {
    if (command === 'history.page') return page(); if (command === 'history.pageContinue') return page(['3', '4'], 'cursor-second');
    if (command === 'history.deletePreview') return preview(input.scope.kind, input.scope.kind === 'selected' ? input.scope.records.length : 26); if (command === 'history.deleteApply') return { applied: true, deleted: 26 };
    return undefined;
  }); notify.mockReset(); openTab.mockReset();
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
async function mountParent() { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); const onClose = vi.fn(); await act(async () => root!.render(<HistoryPagesDialog onClose={onClose} onQueries={vi.fn()}/>)); return { onClose }; }
async function mountDialog() {
  const intent = new HistoryDeleteIntent({ kind: 'filtered', filters: { search: '原搜索', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', durationRange: { minMs: 0 } } }, () => true), onClose = vi.fn(), onDeleted = vi.fn(), onCleanupError = vi.fn();
  const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element);
  await act(async () => root!.render(<HistoryDeleteDialog intent={intent} onClose={onClose} onDeleted={onDeleted} onCleanupError={onCleanupError}/>)); return { intent, onClose, onDeleted, onCleanupError };
}
function button(label: string): MemoryNode { const node = doc.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { const node = button(label); expect(node.disabled, label).toBe(false); await act(async () => node.dispatchEvent(new MemoryEvent('click'))); }
function field(label: string, tag = 'input') { const node = doc.querySelector(`${tag}[aria-label="${label}"]`); expect(node, label).not.toBeNull(); return node!; }
async function input(label: string, value: string) { const node = field(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function select(label: string, value: string) { const node = field(label, 'select'); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
async function check(label: string, value = true) { const node = field(label); expect(node.disabled, label).toBe(false); await act(async () => { node.checked = value; node.dispatchEvent(new MemoryEvent('click')); }); }
function calls(command: string) { return invoke.mock.calls.filter(value => value[0] === command); }

describe('历史清理完整正式父入口真实React RAM（非原生SQLite验收）', () => {
  it('初始只有概要页；所有清理明确发起，不影响未执行草稿或服务器', async () => {
    await mountParent(); expect(calls('history.page')).toHaveLength(1); expect(calls('history.deletePreview')).toHaveLength(0); expect(button(text.selected).disabled).toBe(true);
    await click(text.filtered); expect(doc.querySelector('[data-history-delete-dialog]')).not.toBeNull(); expect(calls('history.deletePreview')).toHaveLength(0); expect(button(text.confirm).disabled).toBe(true);
    await click(text.cancel); expect(doc.querySelector('[data-history-id="1"]')).not.toBeNull(); expect(calls('history.page')).toHaveLength(1); expect(calls('history.pageRelease')).toHaveLength(0);
    expect(holder.state.settings.tabs[0].sql).toBe('未执行草稿'); expect(openTab).not.toHaveBeenCalled(); expect(invoke.mock.calls.some(value => value[0] === 'query.execute')).toBe(false);
  });
  it('当前批次全选跨下一页保留摘要，再取消原页和选择都不变', async () => {
    await mountParent(); await click(text.selectBatch); await click(pages.next); await click(text.selectBatch); expect(doc.body.textContent).toContain(text.selection(4)); await click(text.selected); await click(text.preview);
    expect(calls('history.deletePreview')[0][1].scope).toEqual({ kind: 'selected', records: ['1', '2', '3', '4'].map(id => ({ id, digest: 'a'.repeat(64) })) });
    await click(text.cancel); expect(doc.querySelector('[data-history-id="3"]')).not.toBeNull(); expect(doc.body.textContent).toContain(text.selection(4)); expect(calls('history.pageRelease')).toHaveLength(0); expect(calls('history.deleteRelease')).toHaveLength(1);
    await click(text.clearSelection); expect(doc.body.textContent).toContain(text.selection(0));
  });
  it('卡片删除只预览对应一条，不借当前批次或跨页所选替代', async () => {
    await mountParent(); await click(text.selectBatch); const card = doc.querySelector('[data-history-id="2"]')!; const single = card.querySelectorAll('button').find(value => value.textContent === text.single)!;
    await act(async () => single.dispatchEvent(new MemoryEvent('click'))); await click(text.preview); expect(calls('history.deletePreview')[0][1].scope).toEqual({ kind: 'selected', records: [{ id: '2', digest: 'a'.repeat(64) }] });
  });
  it('任意筛选草稿变化清选择且禁止全集，应用后冻结六维条件且无continue', async () => {
    await mountParent(); await click(text.selectBatch); await input(pages.search, '错误全文'); expect(doc.body.textContent).toContain(text.selectionCleared); expect(doc.body.textContent).toContain(text.selection(0)); expect(button(text.filtered).disabled).toBe(true);
    await select(pages.scope, 'connection:connection'); await select(pages.status, 'failed'); await input(pages.from, '2026-10-22T00:00:00Z'); await input(pages.until, '2026-10-23T00:00:00Z'); await input(pages.minDuration, '0'); await input(pages.maxDuration, '20'); await click(pages.searchButton);
    await click(text.filtered); await click(text.preview); expect(calls('history.deletePreview')[0][1].scope).toEqual({ kind: 'filtered', filters: { search: '错误全文', fields: ['sql', 'error'], scope: { kind: 'connection', connectionId: 'connection' }, status: 'failed', timeRange: { from: '2026-10-22T00:00:00.000Z', until: '2026-10-23T00:00:00.000Z' }, durationRange: { minMs: 0, maxMs: 20 } } });
    expect(doc.body.textContent).toContain(text.summary(26, 30)); expect(doc.querySelectorAll('[data-history-delete-sample]')).toHaveLength(3); expect(calls('history.deleteApply')).toHaveLength(0);
  });
  it('确认成功只消费原token一次，清跨页选择并释放旧cursor按原筛选刷新第一页', async () => {
    const result = preview(); invoke.mockImplementation(async (command, value) => { if (command === 'history.page') return page(); if (command === 'history.pageContinue') return page(['3'], 'cursor-second'); if (command === 'history.deletePreview') return result; if (command === 'history.deleteApply') return { applied: true, deleted: 26 }; return undefined; });
    await mountParent(); await input(pages.search, 'original'); await click(pages.searchButton); await click(text.selectBatch); await click(pages.next); await click(text.filtered); await click(text.preview); expect(button(text.confirm).disabled).toBe(true); await check(text.acknowledge); await click(text.confirm);
    expect(calls('history.deleteApply')).toEqual([['history.deleteApply', { previewToken: result.previewToken }]]); expect(calls('history.pageRelease').at(-1)![1]).toEqual({ cursor: 'cursor-second' }); expect(calls('history.page')).toHaveLength(3); expect(calls('history.page').at(-1)![1]).toMatchObject({ search: 'original', onError: 'continue' }); expect(doc.body.textContent).toContain(text.selection(0)); expect(doc.querySelector('[data-history-id="1"]')).not.toBeNull(); expect(calls('history.deleteRelease')).toHaveLength(0);
  });
  it('工作台标签ABA立即永久失效，返回原标签也无法确认', async () => {
    await mountParent(); await click(text.filtered); await click(text.preview); const settings = holder.state.settings;
    await act(async () => { holder.state = { ...holder.state, settings: { ...settings, activeTabId: 'other' } }; for (const listener of listeners) listener(); holder.state = { ...holder.state, settings }; for (const listener of listeners) listener(); });
    expect(button(text.confirm).disabled).toBe(true); expect(doc.body.textContent).toContain(text.stale); await click(text.cancel); expect(calls('history.deleteRelease')).toHaveLength(1); expect(calls('history.deleteApply')).toHaveLength(0);
  });
});

describe('历史清理原任务与取消双终态真实React RAM', () => {
  it.each(['ack-first', 'preview-first'] as const)('取消预览%s，两者终态前关闭不能释放原窗口或迟到令牌', async order => {
    const task = deferred<HistoryDeletePreviewOutput>(), ack = deferred<unknown>(), result = preview(); invoke.mockImplementation(command => command === 'history.deletePreview' ? task.promise : command === 'query.cancel' ? ack.promise : Promise.resolve(undefined));
    const f = await mountDialog(); await click(text.preview); await click(text.cancelPreview); await click(text.cancel); expect(f.onClose).not.toHaveBeenCalled();
    if (order === 'ack-first') await act(async () => ack.resolve(undefined)); else await act(async () => task.resolve(result));
    expect(f.onClose).not.toHaveBeenCalled(); expect(calls('history.deleteRelease')).toHaveLength(0); expect(button(text.confirm).disabled).toBe(true);
    if (order === 'ack-first') await act(async () => task.resolve(result)); else await act(async () => ack.resolve(undefined));
    expect(f.onClose).toHaveBeenCalledOnce(); expect(calls('query.cancel')).toHaveLength(1); expect(calls('history.deleteRelease')).toEqual([['history.deleteRelease', { previewToken: result.previewToken }]]); expect(calls('history.deleteApply')).toHaveLength(0);
  });
  it('取消请求失败不能解锁原任务，原任务终结后保留原确认取消状态', async () => {
    const task = deferred<HistoryDeletePreviewOutput>(); invoke.mockImplementation(command => command === 'history.deletePreview' ? task.promise : command === 'query.cancel' ? Promise.reject(Error('取消端口失败')) : Promise.resolve(undefined));
    const f = await mountDialog(); await click(text.preview); await click(text.cancelPreview); expect(f.onCleanupError).toHaveBeenCalledWith('Error: 取消端口失败'); expect(button(text.confirm).disabled).toBe(true);
    await act(async () => task.reject(Error('原预览终结'))); expect(f.onClose).not.toHaveBeenCalled(); expect(doc.body.textContent).toContain(text.cancelled); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('卸载后原preview先结束仍等待原取消，迟到token只释放且不关闭后继窗口', async () => {
    const task = deferred<HistoryDeletePreviewOutput>(), ack = deferred<unknown>(), result = preview(); invoke.mockImplementation(command => command === 'history.deletePreview' ? task.promise : command === 'query.cancel' ? ack.promise : Promise.resolve(undefined));
    const original = await mountDialog(); await click(text.preview); await act(async () => root!.unmount()); root = undefined;
    const successor = await mountDialog(); await act(async () => task.resolve(result)); expect(calls('history.deleteRelease')).toHaveLength(0); expect(successor.onClose).not.toHaveBeenCalled();
    await act(async () => ack.resolve(undefined)); expect(calls('history.deleteRelease')).toEqual([['history.deleteRelease', { previewToken: result.previewToken }]]); expect(original.onClose).not.toHaveBeenCalled(); expect(successor.onClose).not.toHaveBeenCalled(); expect(button(text.preview).disabled).toBe(false); expect(doc.body.textContent).not.toContain(text.summary(26, 30));
  });
  it('取消确认的令牌释放失败保留准确句柄重试关闭，不能转而应用', async () => {
    let releases = 0; const result = preview(); invoke.mockImplementation(async command => { if (command === 'history.deletePreview') return result; if (command === 'history.deleteRelease' && ++releases === 1) throw Error('释放失败'); return undefined; });
    const f = await mountDialog(); await click(text.preview); await check(text.acknowledge); await click(text.cancel); expect(f.onClose).not.toHaveBeenCalled(); expect(button(text.confirm).disabled).toBe(true); expect(doc.body.textContent).toContain('释放失败'); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(calls('history.deleteRelease')).toEqual([['history.deleteRelease', { previewToken: result.previewToken }], ['history.deleteRelease', { previewToken: result.previewToken }]]); expect(calls('history.deleteApply')).toHaveLength(0);
  });
  it('零命中不能确认，返回释放原令牌', async () => {
    const result = preview('filtered', 0); invoke.mockImplementation(async command => command === 'history.deletePreview' ? result : undefined); const f = await mountDialog(); await click(text.preview); expect(button(text.confirm).disabled).toBe(true); expect(field(text.acknowledge).disabled).toBe(true); expect(doc.body.textContent).toContain(text.noSamples); await click(text.cancel); expect(f.onClose).toHaveBeenCalledOnce(); expect(calls('history.deleteApply')).toHaveLength(0);
  });
  it('过期token即使已有准确概要也不能勾选确认，未自动重新预览', async () => {
    const result = { ...preview(), expiresAt: new Date(Date.now() - 1).toISOString() }; invoke.mockImplementation(async command => command === 'history.deletePreview' ? result : undefined);
    await mountDialog(); await click(text.preview); expect(button(text.confirm).disabled).toBe(true); expect(field(text.acknowledge).disabled).toBe(true); expect(doc.body.textContent).toContain(text.expired); expect(calls('history.deletePreview')).toHaveLength(1); await click(text.cancel); expect(calls('history.deleteRelease')).toHaveLength(1);
  });
  it('apply失败不重试同token，不重扫；仍可明确返回', async () => {
    invoke.mockImplementation(async (command, value) => { if (command === 'history.deletePreview') return preview(); if (command === 'history.deleteApply') throw Error('SQLite写盘失败'); return undefined; });
    const f = await mountDialog(); await click(text.preview); await check(text.acknowledge); await click(text.confirm); expect(calls('history.deleteApply')).toHaveLength(1); expect(calls('history.deletePreview')).toHaveLength(1); expect(button(text.confirm).disabled).toBe(true); expect(doc.body.textContent).toContain(text.consumed); await click(text.cancel); expect(f.onDeleted).not.toHaveBeenCalled(); expect(f.onClose).toHaveBeenCalledOnce();
  });
  it('apply运行中关闭等待原Promise；源失效后的已删除事实仍只向原owner报告一次', async () => {
    const task = deferred<{ applied: true; deleted: number }>(); invoke.mockImplementation(command => command === 'history.deletePreview' ? Promise.resolve(preview()) : command === 'history.deleteApply' ? task.promise : Promise.resolve(undefined));
    const f = await mountDialog(); await click(text.preview); await check(text.acknowledge); await click(text.confirm); await click(text.cancel); await act(async () => f.intent.invalidate()); expect(f.onClose).not.toHaveBeenCalled(); expect(calls('query.cancel')).toHaveLength(0);
    await act(async () => task.resolve({ applied: true, deleted: 26 })); expect(f.onDeleted).toHaveBeenCalledExactlyOnceWith({ applied: true, deleted: 26 }, false); expect(f.onClose).toHaveBeenCalledOnce(); expect(calls('history.deleteApply')).toHaveLength(1);
  });
});
