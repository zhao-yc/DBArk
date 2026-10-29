import { emptyTableFilteredDeleteOwners } from './table-filtered-delete-owner-fixture';
import { emptyTableFilteredUpdateOwners } from './table-filtered-update-owner-fixture';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { HistoryDelete } from '../../src/main/historyDelete';
import { ColumnsMainCapabilities } from '../../src/main/columnsMainCapabilities';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import { extractMainProductionFunction, extractMainProductionBinding } from './main-production-function';
import { SavedQueryMatcher } from '../../src/main/savedQueryMatcher';
import { summarizeHistoryRecord } from '../../src/main/historyPageMatch';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { historyDeleteLimits as limits, historyDeleteText as text } from '../../src/shared/historyDelete';
import type { HistoryDeleteFilters, HistoryDeleteReference, HistoryDeletePreviewInput } from '../../src/shared/historyDelete';
import type { HistoryPageInput, HistoryPagePosition, HistoryPageEntry } from '../../src/shared/historyPages';
import type { HistoryEntry } from '../../src/shared/contracts';

const filters = (patch: Partial<HistoryDeleteFilters> = {}): HistoryDeleteFilters => ({ search: '', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', ...patch });
const filtered = (patch: Partial<HistoryDeleteFilters> = {}): HistoryDeletePreviewInput => ({ taskId: randomUUID(), scope: { kind: 'filtered', filters: filters(patch) } });
const digest = (raw: string) => createHash('sha256').update(raw).digest('hex');
const row = (index: number, patch: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: 'h' + String(index).padStart(4, '0'), connectionId: 'source', sql: 'SELECT ' + index + ' -- 尾部中文', startedAt: new Date(Date.UTC(2026, 9, 23, 0, 0, index)).toISOString(), elapsedMs: index, success: index % 2 === 0, ...patch });
/** 本地异步端口精确区分原匹配返回、实际关闭与取消回复。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => undefined); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
let workerDirectory: string, workerPath: string;
const services = new Set<HistoryDelete>(), workers = new Set<SavedQueryMatcher>();
beforeAll(async () => { workerDirectory = mkdtempSync(join(tmpdir(), 'dbark-test-historydelete-')); workerPath = join(workerDirectory, 'matcher.cjs'); await build({ entryPoints: ['src/main/savedQuerySearchWorker.ts'], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs', target: 'node22' }); });
afterEach(async () => { for (const service of services) await service.close(); services.clear(); for (const worker of workers) expect(worker.threadId).toBe(-1); workers.clear(); });
afterAll(() => { if (dirname(resolve(workerDirectory)) !== resolve(tmpdir()) || !basename(workerDirectory).startsWith('dbark-test-historydelete-')) throw Error('拒绝清理其它目录'); rmSync(workerDirectory, { recursive: true, force: true }); });

/** 使用真实ColumnsMain文档、真实匹配线程及生产协调器；存储仅替为内存索引/CAS端口。 */
function fixture(entries: HistoryEntry[] = [row(1)], matcher?: () => { summarizeHistory: SavedQueryMatcher['summarizeHistory']; close(): Promise<void> }) {
  let revision = 1, now = Date.UTC(2026, 9, 23), closing = false;
  const records = new Map(entries.map(entry => [entry.id, { id: entry.id, connectionId: entry.connectionId, startedAt: entry.startedAt, raw: JSON.stringify(entry) as string | null }]));
  const frame = { url: 'dbark-test:history-delete', detached: false, processId: 17, frameToken: 'original' }, contents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false }), window = { webContents: contents, isDestroyed: () => false };
  const columnsMain = new ColumnsMainCapabilities(new Map(), { currentWindow: () => window as any, rendererURL: frame.url, connectionRevision: () => revision, assertAvailable: () => {}, shuttingDown: () => closing, release: async () => {} }); columnsMain.trackWindow(window as any);
  const event = { sender: contents, senderFrame: frame }, owner = columnsMain.capture(event as any);
  const store = {
    historyPageRevision: () => String(revision),
    historyDeleteRecord: (id: string) => records.get(id),
    historyPageNext(after: HistoryPagePosition | undefined, input: HistoryPageInput) {
      const rows = [...records.values()].filter(record => input.scope.kind === 'all' || record.connectionId === (input.scope.kind === 'connection' ? input.scope.connectionId : '')).sort((left, right) => left.startedAt === right.startedAt ? right.id.localeCompare(left.id) : right.startedAt.localeCompare(left.startedAt));
      const remaining = after ? rows.filter(record => record.startedAt < after.startedAt || record.startedAt === after.startedAt && record.id < after.id) : rows;
      return remaining.length ? { ...remaining[0], hasMore: remaining.length > 1 } : null;
    },
    deleteHistorySnapshot: vi.fn((expected: string, refs: readonly HistoryDeleteReference[], current: () => void) => {
      current(); if (expected !== String(revision)) throw Error(text.stale);
      for (const reference of refs) { const record = records.get(reference.id); if (!record?.raw || digest(record.raw) !== reference.digest) throw Error(text.stale); }
      current(); for (const reference of refs) records.delete(reference.id); revision++; return refs.length;
    }),
    saveTask: vi.fn(), addHistory: vi.fn(),
  };
  const service = new HistoryDelete(store, workerPath, { assert: value => columnsMain.assertCapturedOwner(value), same: (left, right) => columnsMain.sharesDocumentOwner(left, right), shuttingDown: () => closing, now: () => now, matcher: matcher ?? (() => { const worker = new SavedQueryMatcher(workerPath); workers.add(worker); return worker; }) }); services.add(service);
  return { service, records, store, columnsMain, owner, contents, frame, window, event, revise() { revision++; }, advance(milliseconds: number) { now += milliseconds; }, shutdown() { closing = true; }, navigate() { contents.emit('did-navigate'); }, capture: () => columnsMain.capture(event as any), selected(ids = [...records.keys()]): HistoryDeletePreviewInput { return { taskId: randomUUID(), scope: { kind: 'selected', records: ids.map(id => ({ id, digest: digest(records.get(id)!.raw!) })) } }; } };
}

/** 提取真实Main dispatch及原IPC回调，不能用镜像路由跳过发布归属门。 */
function main(f: ReturnType<typeof fixture>) {
  const source = readFileSync(new URL('../../src/main/index.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true); let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node): void { if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'ipcMain' && node.expression.name.text === 'handle' && ts.isArrowFunction(node.arguments[1])) callback = node.arguments[1]; ts.forEachChild(node, visit); }
  visit(tree); if (!callback) throw Error('生产IPC入口已变化');
  const request = vi.fn(async () => { throw Error('历史清理不允许进入Engine'); });
  // 原dispatch在switch之前统一清理结构能力、解析会话及核配置锁；本例仅提供准确的空RAM状态。
  const assertAvailable = vi.fn((connectionId?: string) => { if (connectionId !== undefined) throw Error('历史清理不应绑定数据库连接'); });
  const context: any = createContext({ filteredDeletes: emptyTableFilteredDeleteOwners(), filteredUpdates: emptyTableFilteredUpdateOwners(), Error, Map, Set, Date, window: f.window, rendererURL: f.frame.url, columnsMain: f.columnsMain, historyDelete: f.service, historyPages: undefined, savedQueryPages: undefined, savedQuerySearches: { has: () => false }, tasks: new Map(), completionTasks: new Set(), tablePresetReads: new Map(), structureTokens: new Map(), sessions: new Map(), connectionConfig: { assertAvailable }, queryInsertExports: { has: vi.fn(() => false) }, shuttingDown: false, localSearchOperations: new Set(), queryFileOperations: new Set(), store: f.store, broker: { request }, validateMainCommand: validateCommand });
  Object.assign(context, { TableChecksMainCapabilities, tableChecksFailureProgress });
  runInContext(ts.transpileModule(extractMainProductionBinding(source, 'tableChecksMain') + '\n' + extractMainProductionFunction(source, 'dispatch') + '\nglobalThis.dispatch=dispatch;globalThis.request=' + callback.getText(tree) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, request, ipc: (command: string, input: unknown) => context.request(f.event, { command, input }) as Promise<any> };
}

describe('历史清理严格契约与准确全集', () => {
  it('三公开命令只接受所见摘要或完整规范筛选，不接收客户端SQL、位置、修订、路径或onError降级', () => {
    const f = fixture(); for (const command of ['history.deletePreview', 'history.deleteApply', 'history.deleteRelease'] as const) expect(publicCommands[command]).toBe(true);
    expect(validateCommand('history.deletePreview', f.selected())).toBeDefined(); expect(validateCommand('history.deletePreview', filtered({ timeRange: { from: '2026-10-23T00:00:00.000Z' }, durationRange: { minMs: 0 } }))).toBeDefined();
    for (const patch of [{ sql: 'DELETE FROM history' }, { filePath: '任意' }, { revision: '1' }, { taskId: 'bad' }, { scope: { kind: 'selected', records: [] } }, { scope: { kind: 'selected', records: Array.from({ length: 101 }, (_, index) => ({ id: String(index), digest: 'a'.repeat(64) })) } }, { scope: { kind: 'selected', records: [{ id: 'h', digest: 'a'.repeat(64) }, { id: 'h', digest: 'a'.repeat(64) }] } }, { scope: { kind: 'filtered', filters: { ...filters(), onError: 'continue' } } }, { scope: { kind: 'filtered', filters: { ...filters(), fields: [] } } }]) expect(() => validateCommand('history.deletePreview', { ...filtered(), ...patch })).toThrow();
    expect(() => validateCommand('history.deleteApply', { previewToken: randomUUID(), records: [] })).toThrow(); expect(() => new HistoryDelete(f.store, workerPath, undefined as any)).toThrow();
  });
  it('真实线程扫描58条而非当前25条，复用完整Unicode、状态、时间和耗时语义', async () => {
    const f = fixture(Array.from({ length: 58 }, (_, index) => row(index))), input = filtered({ search: '尾部中文', status: 'success', timeRange: { from: '2026-10-23T00:00:10.000Z', until: '2026-10-23T00:00:50.000Z' }, durationRange: { minMs: 20, maxMs: 40 } });
    const preview = await f.service.preview(input, f.owner); expect(preview).toMatchObject({ kind: 'filtered', count: 11, scanned: 58 }); expect(preview.samples).toHaveLength(3); expect(preview.samples.every(sample => sample.sqlPreview.length <= 512 && !('error' in sample) && !('errorPreview' in sample))).toBe(true);
    expect(workers.size).toBe(1); for (const worker of workers) expect(worker.threadId).toBe(-1);
    expect(f.service.apply({ previewToken: preview.previewToken }, f.capture())).toEqual({ deleted: 11, applied: true }); expect(f.records.size).toBe(47); expect(f.store.deleteHistorySnapshot).toHaveBeenCalledOnce(); expect(() => f.service.apply({ previewToken: preview.previewToken }, f.capture())).toThrow();
  });
  it('所选记录按原digest及真实时间/来源索引检查，不能只解析JSON', async () => {
    const f = fixture([row(1), row(2)]), input = f.selected(); f.records.get('h0001')!.connectionId = '另一个原索引'; await expect(f.service.preview(input, f.owner)).rejects.toThrow(); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); expect(f.records.size).toBe(2);
  });
  it.each(['connection', 'unbound'] as const)('%s全集不能因坏连接索引迁出范围而签发部分删除能力', async kind => {
    const connectionId = kind === 'connection' ? 'source' : '', f = fixture([row(1, { connectionId }), row(2, { connectionId })]);
    f.records.get('h0001')!.connectionId = '迁出范围的坏索引';
    const input = filtered({ scope: kind === 'connection' ? { kind, connectionId } : { kind } });
    await expect(f.service.preview(input, f.owner)).rejects.toThrow(); expect((f.service as unknown as { previews: ReadonlyMap<string, unknown> }).previews.size).toBe(0); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); expect(f.records.size).toBe(2);
    // 失败不留下可用预览；之后修复索引并显式重读仍能完整确认两条原记录。
    f.records.get('h0001')!.connectionId = connectionId;
    const preview = await f.service.preview({ ...input, taskId: randomUUID() }, f.owner); expect(preview).toMatchObject({ count: 2, scanned: 2 });
    f.service.release({ previewToken: preview.previewToken }, f.capture());
  });
  it('其他来源的正确记录也逐条核验并计入scanned，但原来源筛选只删除匹配记录', async () => {
    const f = fixture([row(1), row(2, { connectionId: 'other' }), row(3, { connectionId: '' })]), preview = await f.service.preview(filtered({ scope: { kind: 'connection', connectionId: 'source' } }), f.owner);
    expect(preview).toMatchObject({ count: 1, scanned: 3 }); expect(preview.samples.map(sample => sample.entry.id)).toEqual(['h0001']);
    expect(f.service.apply({ previewToken: preview.previewToken }, f.capture())).toEqual({ deleted: 1, applied: true }); expect([...f.records.keys()].sort()).toEqual(['h0002', 'h0003']);
  });
  it('一条损坏或超过总扫描数量立即拒绝，不签发部分删除能力或泄漏原文', async () => {
    const f = fixture([row(1), row(2)]); f.records.get('h0001')!.raw = '{秘密SQL错误'; const error = await f.service.preview(filtered(), f.owner).catch(reason => reason); expect(error.message).not.toContain('秘密SQL错误'); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled();
    const many = fixture(Array.from({ length: 1001 }, (_, index) => row(index)), () => ({ summarizeHistory: async (...args) => summarizeHistoryRecord(...args), close: async () => {} })); await expect(many.service.preview(filtered(), many.owner)).rejects.toThrow(text.budget);
  });
  it('零命中只返回零预览，明确no-op不会调用存储、写盘或推进修订', async () => {
    const f = fixture(), before = f.store.historyPageRevision(), preview = await f.service.preview(filtered({ search: '无匹配' }), f.owner); expect(preview).toMatchObject({ count: 0, scanned: 1, samples: [] }); expect(f.service.apply({ previewToken: preview.previewToken }, f.capture())).toEqual({ deleted: 0, applied: true }); expect(f.store.historyPageRevision()).toBe(before); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled();
  });
});

describe('原文档、取消和原线程终态', () => {
  it.each(['cancel', 'navigation', 'quit', 'budget'])('真实worker在%s后实际terminate，原Promise不签发迟到token', async mode => {
    const input = filtered(); let stop: Promise<void> | undefined, originalThread: number | undefined;
    const f = fixture([row(1)], () => {
      const worker = new SavedQueryMatcher(workerPath); workers.add(worker);
      return {
        summarizeHistory(...args) {
          const result = worker.summarizeHistory(...args); originalThread = worker.threadId;
          if (mode === 'cancel') stop = f.service.cancel(input.taskId, f.capture());
          else if (mode === 'navigation') f.navigate(); else if (mode === 'quit') stop = f.service.close(); else f.advance(limits.previewMs);
          return result;
        },
        close: () => worker.close(),
      };
    });
    await expect(f.service.preview(input, f.owner)).rejects.toThrow(); await stop; expect(originalThread).toBeGreaterThan(0); for (const worker of workers) expect(worker.threadId).toBe(-1); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); expect(f.records.size).toBe(1);
  });
  it.each(['revision', 'navigation', 'expiry', 'shutdown'])('%s不能把旧预览变成删除授权', async cause => {
    const f = fixture(), preview = await f.service.preview(f.selected(), f.owner); if (cause === 'revision') f.revise(); else if (cause === 'navigation') f.navigate(); else if (cause === 'expiry') f.advance(limits.lifetimeMs); else f.shutdown();
    expect(() => f.service.apply({ previewToken: preview.previewToken }, cause === 'navigation' ? f.capture() : f.owner)).toThrow(); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); expect(f.records.size).toBe(1);
  });
  it('不允许伪造capture对象或另一窗口释放/提交原token', async () => {
    const f = fixture(), preview = await f.service.preview(f.selected(), f.owner), foreign = { owner: f.owner.owner } as any;
    expect(() => f.service.release({ previewToken: preview.previewToken }, foreign)).toThrow(); expect(() => f.service.apply({ previewToken: preview.previewToken }, foreign)).toThrow(); expect(f.service.apply({ previewToken: preview.previewToken }, f.capture())).toEqual({ deleted: 1, applied: true });
  });
  it('取消ACK不能提前结束原预览；等待原worker关闭和原请求finally', async () => {
    const reading = deferred<HistoryPageEntry | undefined>(), closing = deferred<void>(), close = vi.fn(() => closing.promise), f = fixture([row(1)], () => ({ summarizeHistory: () => reading.promise, close })), input = filtered();
    let previewDone = false, cancelDone = false; const pending = f.service.preview(input, f.owner).catch(reason => reason).finally(() => { previewDone = true; }); await tick(); const cancellation = f.service.cancel(input.taskId, f.capture()).finally(() => { cancelDone = true; }); await tick(); expect(close).toHaveBeenCalledOnce(); expect(previewDone).toBe(false); expect(cancelDone).toBe(false);
    closing.resolve(); await tick(); expect(cancelDone).toBe(false); reading.reject(Error('原线程已终结')); await pending; await cancellation; expect(previewDone).toBe(true); expect(f.service.owns(input.taskId)).toBe(true); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled();
  });
  it('导航当场关闭原worker，退出等待同一原预览promise', async () => {
    const reading = deferred<HistoryPageEntry | undefined>(), closing = deferred<void>(), close = vi.fn(() => closing.promise), f = fixture([row(1)], () => ({ summarizeHistory: () => reading.promise, close }));
    const pending = f.service.preview(filtered(), f.owner).catch(reason => reason); await tick(); f.navigate(); await tick(); expect(close).toHaveBeenCalledOnce(); let done = false; const quit = f.service.close().finally(() => { done = true; }); closing.resolve(); await tick(); expect(done).toBe(false); reading.reject(Error('原任务终结')); await pending; await quit; expect(done).toBe(true); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled();
  });
  it('实际关闭失败保留原job并拒绝退出收尾，不丢掉未知资源', async () => {
    const f = fixture([row(1)], () => ({ summarizeHistory: async (...args) => summarizeHistoryRecord(...args), close: async () => { throw Error('原关闭失败'); } })), input = filtered(); await expect(f.service.preview(input, f.owner)).rejects.toThrow(text.failed); expect(f.service.owns(input.taskId)).toBe(true); await expect(f.service.close()).rejects.toThrow(text.failed); services.delete(f.service);
  });
  it('预览期限、8份token和最近task编号均保持有界', async () => {
    const f = fixture([row(1)], () => ({ summarizeHistory: async (...args) => { f.advance(limits.previewMs); return summarizeHistoryRecord(...args); }, close: async () => {} })); await expect(f.service.preview(filtered(), f.owner)).rejects.toThrow(text.budget);
    const bounded = fixture([row(1)], () => ({ summarizeHistory: async (...args) => summarizeHistoryRecord(...args), close: async () => {} })); for (let index = 0; index < limits.tokens; index++) await bounded.service.preview(filtered(), bounded.owner); await expect(bounded.service.preview(filtered(), bounded.owner)).rejects.toThrow(text.busy); bounded.advance(limits.lifetimeMs); const input = filtered(); await bounded.service.preview(input, bounded.owner); await expect(bounded.service.preview(input, bounded.owner)).rejects.toThrow(text.taskUsed);
  });
  it('累计原文字节预算在交给下一条线程前拒绝，绝不把剩余记录当作无命中', async () => {
    const f = fixture([row(1), row(2)], () => ({ summarizeHistory: async (...args) => summarizeHistoryRecord(...args), close: async () => {} })), rawFirst = f.records.get('h0002')!.raw, rawSecond = f.records.get('h0001')!.raw, byteLength = Buffer.byteLength;
    const measured = vi.spyOn(Buffer, 'byteLength').mockImplementation((value, encoding) => value === rawFirst ? limits.rawBytes : value === rawSecond ? 1 : byteLength(value, encoding));
    try { await expect(f.service.preview(filtered(), f.owner)).rejects.toThrow(text.budget); expect(f.records.size).toBe(2); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); } finally { measured.mockRestore(); }
  });
});

describe('真实Main IPC接入', () => {
  it('只走本地协调器，正常预览/提交/释放不调用Engine、不持久化任务和执行历史', async () => {
    const f = fixture(), m = main(f), preview = await m.ipc('history.deletePreview', f.selected()); expect(preview.ok).toBe(true); expect(await m.ipc('history.deleteApply', { previewToken: preview.result.previewToken })).toEqual({ ok: true, result: { deleted: 1, applied: true } }); expect(await m.ipc('history.deleteRelease', { previewToken: preview.result.previewToken })).toEqual({ ok: true, result: undefined }); expect(m.request).not.toHaveBeenCalled(); expect(f.store.saveTask).not.toHaveBeenCalled(); expect(f.store.addHistory).not.toHaveBeenCalled(); expect(m.context.localSearchOperations.size).toBe(0);
  });
  it('dispatch无真实owner或原task编号已用时，在扫描/写入前拒绝', async () => {
    const f = fixture(), m = main(f), input = f.selected(); await expect(m.context.dispatch('history.deletePreview', input)).rejects.toThrow(); m.context.completionTasks.add(input.taskId); expect((await m.ipc('history.deletePreview', input)).ok).toBe(false); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
  });
  it('真实handler的query.cancel只收尾本地原预览，原编号不会转发Engine', async () => {
    const reading = deferred<HistoryPageEntry | undefined>(), closing = deferred<void>(), summarizeHistory = vi.fn(() => reading.promise), close = vi.fn(() => closing.promise), f = fixture([row(1)], () => ({ summarizeHistory, close })), m = main(f), input = filtered();
    let previewFinished = false, cancelFinished = false, cancellation: Promise<any> | undefined;
    const pending = m.ipc('history.deletePreview', input).finally(() => { previewFinished = true; });
    try {
      await tick(); expect(summarizeHistory).toHaveBeenCalledOnce(); expect(previewFinished).toBe(false);
      cancellation = m.ipc('query.cancel', { taskId: input.taskId }).finally(() => { cancelFinished = true; }); await tick(); expect(close).toHaveBeenCalledOnce(); expect(cancelFinished).toBe(false);
      closing.resolve(); await tick(); expect(previewFinished).toBe(false); expect(cancelFinished).toBe(false);
      reading.reject(Error('原worker请求已结束')); expect((await pending).ok).toBe(false); expect(await cancellation).toEqual({ ok: true, result: undefined }); expect(m.context.queryInsertExports.has).toHaveBeenCalledWith(input.taskId); expect(m.request).not.toHaveBeenCalled(); expect(f.store.saveTask).not.toHaveBeenCalled(); expect(f.store.addHistory).not.toHaveBeenCalled(); expect(m.context.localSearchOperations.size).toBe(0);
    } finally {
      // 断言失败也只结算本例RAM门；首个失败保留，避免未观察拒绝或afterEach悬挂掩盖原因。
      closing.resolve(); reading.reject(Error('原受控请求收尾')); await Promise.allSettled([pending, cancellation]);
    }
  });
  it('Main最后发布门拒绝旧文档token，已落盘删除事实不因迟到导航变成未删除', async () => {
    const f = fixture(), m = main(f), original = f.service.assertPreviewPublication.bind(f.service); vi.spyOn(f.service, 'assertPreviewPublication').mockImplementation((result, owner) => { f.navigate(); original(result, owner); }); expect((await m.ipc('history.deletePreview', f.selected())).ok).toBe(false); expect(f.store.deleteHistorySnapshot).not.toHaveBeenCalled();
    const saved = fixture(), n = main(saved), preview = await n.ipc('history.deletePreview', saved.selected()), apply = saved.service.apply.bind(saved.service); vi.spyOn(saved.service, 'apply').mockImplementation((input, owner) => { const result = apply(input, owner); saved.navigate(); return result; }); expect(await n.ipc('history.deleteApply', { previewToken: preview.result.previewToken })).toEqual({ ok: true, result: { deleted: 1, applied: true } }); expect(saved.records.size).toBe(0);
  });
});
