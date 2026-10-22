import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import type { Database } from 'sql.js';
import { LocalStore } from '../../src/main/storage';
import { HistoryPages } from '../../src/main/historyPages';
import { SavedQueryMatcher } from '../../src/main/savedQueryMatcher';
import { SavedQuerySearchCancelled } from '../../src/main/savedQuerySearch';
import type { HistoryPageInput } from '../../src/shared/historyPages';
import type { HistoryEntry } from '../../src/shared/contracts';

const require = createRequire(import.meta.url), prefix = 'dbark-test-historyduration-', protector = { available: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value };
const input = (patch: Partial<HistoryPageInput> = {}): HistoryPageInput => ({ taskId: randomUUID(), search: '', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', onError: 'continue', ...patch });
const record = (patch: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: 'h', connectionId: 'source', sql: 'SELECT 1', startedAt: '2026-10-22T00:00:00.000Z', elapsedMs: 1, success: true, ...patch });
let workerDirectory: string, workerPath: string, directory: string, store: LocalStore, service: HistoryPages, restore: (() => void) | undefined;
const workers = new Set<SavedQueryMatcher>(); let onSummary: (worker: SavedQueryMatcher) => void = () => undefined;
/** 只删除本文件在系统临时父目录建立的精确随机目录，拒绝其他路径或嵌套路径。 */
function removeOwned(path: string) { if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith(prefix)) throw Error('拒绝删除非本例历史耗时测试目录'); rmSync(path, { recursive: true, force: true }); }
/** 损坏夹具仅走真实SQLite原始记录，不更改产品新增历史入口或修订实现。 */
function insert(value: HistoryEntry, raw = JSON.stringify(value)) { (store as unknown as { db: Database }).db.run('INSERT INTO history VALUES(?,?,?,?)', [value.id, value.connectionId, raw, value.startedAt]); }
beforeAll(async () => {
  workerDirectory = mkdtempSync(join(tmpdir(), prefix)); workerPath = join(workerDirectory, 'worker.cjs');
  await build({ entryPoints: ['src/main/savedQuerySearchWorker.ts'], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
  const original = SavedQueryMatcher.prototype.summarizeHistory;
  const spy = vi.spyOn(SavedQueryMatcher.prototype, 'summarizeHistory').mockImplementation(function (this: SavedQueryMatcher, ...args) { workers.add(this); const result = original.apply(this, args); onSummary(this); return result; }); restore = () => spy.mockRestore();
});
afterAll(() => { restore?.(); if (workerDirectory) removeOwned(workerDirectory); });
beforeEach(async () => { directory = mkdtempSync(join(tmpdir(), prefix)); store = await LocalStore.open(join(directory, 'history.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), protector); service = new HistoryPages(store, workerPath); workers.clear(); onSummary = () => undefined; });
afterEach(async () => { await service?.close(); for (const worker of workers) expect(worker.threadId).toBe(-1); store?.close(); if (directory) removeOwned(directory); });

describe('耗时范围沿真实SQLite和原worker分页', () => {
  it('58条按原索引降序跨25条扫描，无命中页可继续；不读全量、不写SQLite或任务历史', async () => {
    for (let i = 0; i < 58; i++) store.addHistory(record({ id: 'h' + String(i).padStart(3, '0'), elapsedMs: i, sql: 'x'.repeat(2000) }));
    const file = join(directory, 'history.sqlite'), bytes = readFileSync(file), revision = store.historyPageRevision();
    const full = vi.spyOn(store, 'history').mockImplementation(() => { throw Error('禁止全量读取历史'); });
    try {
      const first = await service.start(input({ durationRange: { minMs: 0, maxMs: 2 } })); expect(first.items).toEqual([]); expect(first).toMatchObject({ scanned: 25, matched: 0, failed: 0 }); expect(first.cursor).toBeTruthy();
      for (const worker of workers) expect(worker.threadId).toBe(-1);
      const second = await service.next({ taskId: randomUUID(), cursor: first.cursor }); expect(second.items).toEqual([]); expect(second.scanned).toBe(50);
      const last = await service.next({ taskId: randomUUID(), cursor: second.cursor }); expect(last.items.map(item => item.entry.id)).toEqual(['h002', 'h001', 'h000']); expect(last).toMatchObject({ scanned: 58, matched: 3, failed: 0 }); expect(last.cursor).toBeUndefined();
      for (const page of [first, second, last]) { expect(page.items.length).toBeLessThanOrEqual(25); expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(128 * 1024); }
      expect(full).not.toHaveBeenCalled(); expect(readFileSync(file)).toEqual(bytes); expect(store.historyPageRevision()).toBe(revision); expect(store.tasks()).toEqual([]);
    } finally { full.mockRestore(); }
  });
  it('新范围与原来源、成功失败、全文尾部及时间范围同时处理，原始分数/零值保持', async () => {
    for (let i = 0; i < 28; i++) store.addHistory(record({ id: 'skip' + String(i).padStart(2, '0'), elapsedMs: 20 }));
    store.addHistory(record({ id: 'a-match', elapsedMs: 1.25, success: false, sql: 'x'.repeat(9000), error: 'x'.repeat(9000) + '精确尾部', startedAt: '2026-10-22T08:00:00+08:00' }));
    store.addHistory(record({ id: 'b-source', connectionId: 'other', elapsedMs: 1.25, success: false, error: '精确尾部' }));
    store.addHistory(record({ id: 'c-success', elapsedMs: 1.25, success: true, error: '精确尾部' }));
    store.addHistory(record({ id: 'd-time', elapsedMs: 1.25, success: false, error: '精确尾部', startedAt: '2026-10-21T23:59:59.999Z' }));
    store.addHistory(record({ id: 'e-zero', elapsedMs: 0 }));
    let page = await service.start(input({ durationRange: { minMs: 1, maxMs: 2 }, timeRange: { from: '2026-10-22T00:00:00.000Z', until: '2026-10-22T00:00:00.001Z' }, scope: { kind: 'connection', connectionId: 'source' }, status: 'failed', fields: ['error'], search: '精确尾部' }));
    const matched = [...page.items]; while (page.cursor) { page = await service.next({ taskId: randomUUID(), cursor: page.cursor }); matched.push(...page.items); }
    expect(matched.map(item => item.entry.id)).toEqual(['a-match']); expect(matched[0].entry.elapsedMs).toBe(1.25); expect(matched[0].errorTruncated).toBe(true); expect(page.failed).toBe(0);
    let zero = await service.start(input({ durationRange: { minMs: 0, maxMs: 0 } })); const zeroIds = zero.items.map(item => item.entry.id);
    while (zero.cursor) { zero = await service.next({ taskId: randomUUID(), cursor: zero.cursor }); zeroIds.push(...zero.items.map(item => item.entry.id)); }
    expect(zeroIds).toEqual(['e-zero']);
  });
  it('游标复制起始范围，修改原对象、在next附带新范围或复用旧游标均不能改筛选', async () => {
    for (let i = 0; i < 30; i++) store.addHistory(record({ id: 'h' + String(i).padStart(2, '0'), elapsedMs: i % 2 ? 2 : 1.25 }));
    const request = input({ durationRange: { minMs: 1, maxMs: 2 } }), pending = service.start(request);
    request.durationRange!.minMs = 999; request.durationRange!.maxMs = 1000;
    const first = await pending; expect(first.items).toHaveLength(25);
    expect(() => service.next({ taskId: randomUUID(), cursor: first.cursor, durationRange: request.durationRange })).toThrow();
    const last = await service.next({ taskId: randomUUID(), cursor: first.cursor }); expect(last.items).toHaveLength(5); expect(last).toMatchObject({ scanned: 30, matched: 30, failed: 0 });
    expect(() => service.next({ taskId: randomUUID(), cursor: first.cursor })).toThrow('已翻页');
  });
  it('负耗时按原onError继续/停止且计作失败，省略范围保留原记录；损坏正文不泄漏', async () => {
    insert(record({ id: 'z-negative', elapsedMs: -12345, sql: '不应回显的秘密正文', error: '不应回显的错误详情' }));
    insert(record({ id: 'y-bad' }), '{"id":"y-bad","sql":"不应回显的损坏正文"}');
    for (let i = 0; i < 27; i++) insert(record({ id: 'a' + String(i).padStart(2, '0') }));
    const stopped = await service.start(input({ durationRange: { minMs: 0 }, status: 'failed', search: '零命中', onError: 'stop' })); expect(stopped).toMatchObject({ scanned: 1, matched: 0, failed: 1, stoppedOnError: true }); expect(stopped.failures[0].message).toContain('耗时无效'); expect(stopped.cursor).toBeUndefined();
    let continued = await service.start(input({ durationRange: { minMs: 0 } })); expect(continued).toMatchObject({ scanned: 25, matched: 23, failed: 2 }); expect(JSON.stringify(continued.failures)).not.toMatch(/12345|秘密正文|错误详情|损坏正文/);
    continued = await service.next({ taskId: randomUUID(), cursor: continued.cursor }); expect(continued).toMatchObject({ scanned: 29, matched: 27, failed: 2 });
    const legacy = await service.start(input()); expect(legacy.items.find(item => item.entry.id === 'z-negative')?.entry.elapsedMs).toBe(-12345); expect(legacy.failed).toBe(1);
  });
  it('原索引和旧时间错误优先，不能被新耗时范围隐藏成无命中', async () => {
    const indexed = record({ id: 'z-indexed', elapsedMs: -1 }); insert(indexed, JSON.stringify({ ...indexed, startedAt: '错位时间' }));
    insert(record({ id: 'y-oldtime', elapsedMs: -1, startedAt: '2026-10-22' }));
    const result = await service.start(input({ durationRange: { minMs: 999 }, timeRange: { from: '2026-01-01T00:00:00.000Z' } }));
    expect(result).toMatchObject({ scanned: 2, matched: 0, failed: 2 }); expect(result.failures.find(item => item.id === 'z-indexed')?.message).toContain('索引不一致'); expect(result.failures.find(item => item.id === 'y-oldtime')?.message).toContain('明确的绝对时刻');
  });
  it('范围读取取消等待原worker真实终止，release/退出取消续读且不复活旧句柄', async () => {
    for (let i = 0; i < 30; i++) store.addHistory(record({ id: 'h' + i, sql: 'x'.repeat(200000) }));
    const request = input({ durationRange: { minMs: 0 } }); let cancelled: Promise<void> | undefined;
    onSummary = worker => { expect(worker.threadId).toBeGreaterThan(0); cancelled = service.cancel(request.taskId); };
    await expect(service.start(request)).rejects.toBeInstanceOf(SavedQuerySearchCancelled); await cancelled; for (const worker of workers) expect(worker.threadId).toBe(-1); onSummary = () => undefined;
    const first = await service.start(input({ durationRange: { minMs: 0 } })); service.release({ cursor: first.cursor }); expect(() => service.next({ taskId: randomUUID(), cursor: first.cursor })).toThrow('已过期');
    const second = await service.start(input({ durationRange: { maxMs: 1 } })); await service.close(); expect(() => service.next({ taskId: randomUUID(), cursor: second.cursor })).toThrow('已过期');
  });
  it('活动worker期间存储修订变化拒绝发布混合页，新字段不绕过旧修订门', async () => {
    store.addHistory(record()); let changed = false;
    onSummary = () => { if (!changed) { changed = true; store.addHistory(record({ id: 'new', elapsedMs: 0 })); } };
    await expect(service.start(input({ durationRange: { minMs: 0 } }))).rejects.toThrow('已变化'); expect(changed).toBe(true); for (const worker of workers) expect(worker.threadId).toBe(-1);
  });
});
