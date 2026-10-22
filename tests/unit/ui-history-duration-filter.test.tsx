import { act } from 'react';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryDocument, MemoryEvent } from '../fixtures/memory-dom';
import { HistoryPagesDialog } from '../../src/renderer/components/HistoryPagesDialog';
import { historyPagesZh as text } from '../../src/renderer/locales/historyPages.zh-CN';
const { invoke, notify, openTab } = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn(), openTab: vi.fn() }));
vi.mock('../../src/renderer/lib', () => ({ invoke, errorMessage: String, uid: () => randomUUID() }));
vi.mock('../../src/renderer/store', () => ({ useWorkspace: Object.assign((select: (state: unknown) => unknown) => select({ connections: [{ id: 'connection', name: '本例连接' }] }), { getState: () => ({ notify, openTab }) }) }));
const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let doc: ReturnType<typeof memoryDocument>, createRoot: typeof import('react-dom/client')['createRoot'], root: ReturnType<typeof createRoot> | undefined, onClose: ReturnType<typeof vi.fn>;
/** 概要页保留真实记录形状，失效输入必须能继续显示旧卡片。 */
const page = (cursor?: string, id = 'original') => ({ items: [{ entry: { id, connectionId: 'connection', startedAt: '2026-10-22T00:00:00.000Z', elapsedMs: 8, success: true, databaseContext: { state: 'known' as const, database: null } }, digest: 'a'.repeat(64), sqlPreview: '本地历史概要 ' + id, sqlUnits: 10, previewTruncated: false, errorUnits: 0, errorTruncated: false }], failures: [], scanned: 1, matched: 1, failed: 0, stoppedOnError: false, ...(cursor ? { cursor } : {}) });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeAll(async () => {
  doc = memoryDocument(); (doc as any).oninput = null; const create = doc.createElement.bind(doc);
  doc.createElement = name => {
    const node = create(name);
    if (name === 'input') { let type = 'text'; Object.defineProperty(node, 'type', { configurable: true, get: () => type, set: value => { type = value; node.attributes.set('type', value); } }); node.type = 'text'; }
    if (name === 'select') Object.defineProperty(node, 'options', { get: () => node.querySelectorAll('option') });
    const set = node.setAttribute.bind(node), remove = node.removeAttribute.bind(node); node.setAttribute = (key, value) => { set(key.toLowerCase(), value); if (key === 'disabled') node.disabled = true; if (key === 'type') node.type = value; if (name === 'option' && key === 'value') node.value = String(value); }; node.removeAttribute = key => { remove(key.toLowerCase()); if (key === 'disabled') node.disabled = false; }; return node;
  };
  ({ createRoot } = await import('react-dom/client'));
});
beforeEach(() => { invoke.mockReset().mockImplementation(async command => command === 'history.page' || command === 'history.pageContinue' ? page('cursor-original') : undefined); notify.mockReset(); openTab.mockReset(); onClose = vi.fn(); });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; doc.body.textContent = ''; vi.restoreAllMocks(); });
afterAll(() => { for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); });
/** 所有草稿/勾选/搜索通过真实ReactDOM事件委派，不替换解析器或请求生命周期。 */
async function mount() { const host = doc.createElement('div'); doc.body.appendChild(host); root = createRoot(host as unknown as Element); await act(async () => root!.render(<HistoryPagesDialog onClose={onClose} onQueries={vi.fn()}/>)); }
function field(label: string, tag = 'input') { const node = doc.querySelector(`${tag}[aria-label="${label}"]`); expect(node, label).not.toBeNull(); return node!; }
function button(label: string) { const node = doc.querySelectorAll('button').find(value => value.textContent === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { expect(button(label).disabled).toBe(false); await act(async () => button(label).dispatchEvent(new MemoryEvent('click'))); }
async function input(label: string, value: string) { const node = field(label); expect(node.disabled).toBe(false); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('input')); }); }
async function select(label: string, value: string) { const node = field(label, 'select'); await act(async () => { node.value = value; node.dispatchEvent(new MemoryEvent('change')); }); }
function requests() { return invoke.mock.calls.filter(call => call[0] === 'history.page'); }

describe('历史耗时范围真实ReactDOM筛选', () => {
  it('初始兼容旧请求，说明精度/含两端/本地筛选且不重发SQL', async () => {
    await mount(); expect(requests()).toHaveLength(1); expect(requests()[0][1]).not.toHaveProperty('durationRange'); expect(field(text.minDuration).type).toBe('text'); expect(field(text.maxDuration).type).toBe('text'); expect(field(text.minDuration).getAttribute('inputmode')).toBe('numeric'); expect(doc.body.textContent).toContain(text.durationHint); expect(button(text.clearDuration).disabled).toBe(true); expect(invoke.mock.calls.some(call => call[0] === 'query.execute')).toBe(false);
  });
  it.each([['0', '', { minMs: 0 }], ['', '0', { maxMs: 0 }], ['5', '12', { minMs: 5, maxMs: 12 }], ['5', '5', { minMs: 5, maxMs: 5 }], ['0', '9007199254740991', { minMs: 0, maxMs: Number.MAX_SAFE_INTEGER }]])('搜索发送整数端点%s/%s，不因修改自动请求', async (minimum, maximum, expected) => {
    await mount(); await input(text.minDuration, minimum as string); await input(text.maxDuration, maximum as string); expect(requests()).toHaveLength(1); expect(invoke.mock.calls.some(call => call[0] === 'history.pageRelease')).toBe(false); expect(button(text.next).disabled).toBe(true); await click(text.searchButton); expect(requests()).toHaveLength(2); expect(requests()[1][1].durationRange).toEqual(expected); expect(field(text.minDuration).value).toBe(minimum); expect(field(text.maxDuration).value).toBe(maximum);
  });
  it('耗时与时间、来源、状态、错误全文字段组合保留各自合同', async () => {
    await mount(); await input(text.minDuration, ' 0 '); await input(text.maxDuration, '250'); await input(text.from, '2026-10-22T08:00:00+08:00'); await input(text.until, '2026-10-23T08:00:00+08:00'); await input(text.search, '错误全文'); await select(text.scope, 'connection:connection'); await select(text.status, 'failed');
    const checkbox = doc.querySelectorAll('input').find(node => node.type === 'checkbox' && node.parentNode?.textContent === text.sql)!; expect(checkbox).toBeDefined(); await act(async () => { checkbox.checked = false; checkbox.dispatchEvent(new MemoryEvent('click')); }); await click(text.searchButton);
    expect(requests().at(-1)![1]).toMatchObject({ search: '错误全文', fields: ['error'], scope: { kind: 'connection', connectionId: 'connection' }, status: 'failed', timeRange: { from: '2026-10-22T00:00:00.000Z', until: '2026-10-23T00:00:00.000Z' }, durationRange: { minMs: 0, maxMs: 250 }, onError: 'continue' });
  });
  it.each([['-1', ''], ['1.5', ''], ['1e3', ''], ['', '9007199254740992'], ['12', '11']])('非法%s/%s不释放旧cursor、不发请求、不清页或原草稿', async (minimum, maximum) => {
    await mount(); await input(text.minDuration, minimum); await input(text.maxDuration, maximum); await click(text.searchButton); expect(requests()).toHaveLength(1); expect(invoke.mock.calls.filter(call => call[0] === 'history.pageRelease')).toHaveLength(0); expect(doc.querySelector('[data-history-id="original"]')).not.toBeNull(); expect(field(text.minDuration).value).toBe(minimum); expect(field(text.maxDuration).value).toBe(maximum); expect(doc.querySelector('[role="alert"]')?.textContent).toContain(minimum === '12' ? text.durationOrder : text.durationInvalid); expect(button(text.next).disabled).toBe(true);
  });
  it('清除只改耗时草稿，旧卡片/游标/时间不变；明确重搜才释放并发送无耗时范围', async () => {
    await mount(); await input(text.from, '2026-10-22T00:00:00Z'); await input(text.minDuration, '10'); await click(text.searchButton); const count = invoke.mock.calls.length; await click(text.clearDuration); expect(invoke.mock.calls).toHaveLength(count); expect(field(text.minDuration).value).toBe(''); expect(field(text.maxDuration).value).toBe(''); expect(field(text.from).value).toBe('2026-10-22T00:00:00Z'); expect(doc.querySelector('[data-history-id="original"]')).not.toBeNull(); expect(button(text.next).disabled).toBe(true); await click(text.searchButton); expect(invoke.mock.calls.filter(call => call[0] === 'history.pageRelease')).toHaveLength(2); expect(requests().at(-1)![1]).not.toHaveProperty('durationRange'); expect(requests().at(-1)![1].timeRange).toEqual({ from: '2026-10-22T00:00:00.000Z' });
  });
  it('纯空白两端明确搜索时省略范围，独立清除时间不清耗时', async () => {
    await mount(); await input(text.minDuration, ' \t'); await input(text.maxDuration, '\n '); await click(text.searchButton); expect(requests().at(-1)![1]).not.toHaveProperty('durationRange'); await input(text.minDuration, '4'); await input(text.maxDuration, '8'); await input(text.from, '2026-10-22T00:00:00Z'); await click(text.clearTime); expect(field(text.minDuration).value).toBe('4'); expect(field(text.maxDuration).value).toBe('8'); await click(text.searchButton); expect(requests().at(-1)![1].durationRange).toEqual({ minMs: 4, maxMs: 8 }); expect(requests().at(-1)![1]).not.toHaveProperty('timeRange');
  });
  it('续页只发送cursor/taskId；改耗时草稿立即禁止用旧筛选续读', async () => {
    invoke.mockImplementation(async command => command === 'history.page' ? page('first') : command === 'history.pageContinue' ? page('second', 'second-page') : undefined); await mount(); await input(text.minDuration, '0'); await click(text.searchButton); await click(text.next); const next = invoke.mock.calls.find(call => call[0] === 'history.pageContinue')![1]; expect(Object.keys(next).sort()).toEqual(['cursor', 'taskId']); expect(next.cursor).toBe('first'); expect(doc.querySelector('[data-history-id="second-page"]')).not.toBeNull(); await input(text.maxDuration, '10'); expect(button(text.next).disabled).toBe(true); expect(doc.body.textContent).toContain(text.pending); await click(text.searchButton); expect(invoke).toHaveBeenCalledWith('history.pageRelease', { cursor: 'second' });
  });
  it('原请求busy时输入/清除均禁用，取消不提前放开原Promise或发第二次搜索', async () => {
    const pending = deferred<ReturnType<typeof page>>(); invoke.mockImplementation(command => command === 'history.page' ? pending.promise : Promise.resolve(undefined)); await mount(); expect(field(text.minDuration).disabled).toBe(true); expect(field(text.maxDuration).disabled).toBe(true); expect(button(text.clearDuration).disabled).toBe(true); await click(text.cancel); expect(invoke.mock.calls.filter(call => call[0] === 'query.cancel')).toHaveLength(1); expect(button(text.searchButton).disabled).toBe(true); expect(requests()).toHaveLength(1); await act(async () => pending.resolve(page('after-cancel'))); expect(field(text.minDuration).disabled).toBe(false); expect(requests()).toHaveLength(1);
  });
  it('关闭等待原任务及迟到cursor释放，期间禁用耗时输入且不复活面板', async () => {
    const pending = deferred<ReturnType<typeof page>>(); invoke.mockImplementation(command => command === 'history.page' ? pending.promise : Promise.resolve(undefined)); await mount(); await click('关闭'); expect(onClose).not.toHaveBeenCalled(); expect(field(text.minDuration).disabled).toBe(true); expect(invoke.mock.calls.some(call => call[0] === 'query.cancel')).toBe(true); await act(async () => pending.resolve(page('late', 'late-page'))); expect(invoke).toHaveBeenCalledWith('history.pageRelease', { cursor: 'late' }); expect(onClose).toHaveBeenCalledTimes(1); expect(doc.querySelector('[data-history-id="late-page"]')).toBeNull(); expect(openTab).not.toHaveBeenCalled(); expect(requests()).toHaveLength(1);
  });
});
