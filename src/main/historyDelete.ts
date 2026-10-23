import { createHash, randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import { SavedQueryMatcher } from './savedQueryMatcher';
import type { HistoryPageInput, HistoryPagePosition, HistoryPageEntry } from '../shared/historyPages';
import { historyDeleteLimits as limits, historyDeleteText as text, historyDeletePreviewInputSchema, historyDeleteApplyInputSchema, historyDeleteReleaseInputSchema, type HistoryDeleteReference, type HistoryDeletePreviewOutput, type HistoryDeleteSample, type HistoryDeleteApplyOutput } from '../shared/historyDelete';

interface IndexedRecord { id: string; startedAt: string; connectionId: string; raw: string | null; }
interface HistoryDeleteStore {
  historyPageRevision(): string;
  historyPageNext(after: HistoryPagePosition | undefined, input: HistoryPageInput): (IndexedRecord & { hasMore: boolean }) | null;
  historyDeleteRecord(id: string): IndexedRecord | undefined;
  deleteHistorySnapshot(expectedRevision: string, refs: readonly HistoryDeleteReference[], assertCurrent: () => void): number;
}
interface Matcher {
  summarizeHistory(id: string, raw: string, input: HistoryPageInput, position: HistoryPagePosition): Promise<HistoryPageEntry | undefined>;
  close(): Promise<void>;
}
interface Runtime {
  assert(owner: ColumnsInvocation): void;
  same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  shuttingDown(): boolean;
  now?(): number;
  matcher?(workerPath: string): Matcher;
}
interface Preview {
  owner: ColumnsInvocation; revision: string; expires: number;
  refs: HistoryDeleteReference[];
}
interface Job {
  owner: ColumnsInvocation; revision: string; deadline: number; cancelled: boolean;
  matcher?: Matcher; stop?: Promise<void>; done: Promise<void>; finish(): void;
}

/** 预览只扫描本地SQLite，删除能力仅保存摘要与真实主文档，不接触数据库Engine或任务历史。 */
export class HistoryDelete {
  private readonly previews = new Map<string, Preview>();
  private readonly jobs = new Map<string, Job>();
  private readonly recent = new Map<string, { owner: ColumnsInvocation; expires: number }>();
  private closing = false;
  constructor(private readonly store: HistoryDeleteStore, private readonly workerPath: string, private readonly runtime: Runtime) {
    if (!runtime || typeof runtime.assert !== 'function' || typeof runtime.same !== 'function' || typeof runtime.shuttingDown !== 'function') throw Error(text.stale);
  }
  /** 时钟端口只供同一Main实例使用；能力本身不会被持久化或跨启动重新签发。 */
  private now(): number { const value = this.runtime.now?.() ?? Date.now(); if (!Number.isFinite(value)) throw Error(text.stale); return value; }
  /** 任何新操作都先核真实来源；退出开始后不能从旧令牌重新进入存储写入。 */
  private assertOwner(owner: ColumnsInvocation): void {
    this.runtime.assert(owner);
    if (this.closing || this.runtime.shuttingDown()) throw Error(text.shuttingDown);
  }
  /** 过期或资料源变化仅撤销能力，不删除记录、不保留SQL正文。 */
  private prune(): void {
    const now = this.now();
    for (const [token, preview] of this.previews) {
      try { this.assertOwner(preview.owner); if (preview.expires <= now || preview.revision !== this.store.historyPageRevision()) this.previews.delete(token); }
      catch { this.previews.delete(token); }
    }
    for (const [taskId, state] of this.recent) if (state.expires <= now && !this.jobs.has(taskId)) this.recent.delete(taskId);
  }
  /** 最近取消仍由本地owner接管，不能落入数据库查询取消通道。 */
  owns(taskId: string): boolean { this.prune(); return this.jobs.has(taskId) || this.recent.has(taskId); }
  /** 每个异步边界重新核原文档、原修订和固定预览期限。 */
  private check(job: Job): void {
    this.assertOwner(job.owner);
    if (job.cancelled) throw Error(text.cancelled);
    if (job.revision !== this.store.historyPageRevision()) throw Error(text.stale);
    if (this.now() >= job.deadline) throw Error(text.budget);
  }
  /** 关闭只作用于该job原匹配线程；原Promise保留至实际terminate返回。 */
  private stop(job: Job): Promise<void> { job.cancelled = true; return job.stop ??= job.matcher?.close() ?? Promise.resolve(); }
  /** 导航/崩溃当场停止原worker；监听只登记到原contents，finally准确移除。 */
  private observe(job: Job): () => void {
    const contents = job.owner.owner.contents;
    const listener = () => { try { this.check(job); } catch { void this.stop(job).catch(() => undefined); } };
    contents.on('did-start-navigation', listener); contents.on('did-navigate', listener); contents.on('render-process-gone', listener); contents.on('destroyed', listener);
    return () => { contents.off('did-start-navigation', listener); contents.off('did-navigate', listener); contents.off('render-process-gone', listener); contents.off('destroyed', listener); };
  }
  /** 完整扫描及原线程收尾成功后才签发token；失败不返回部分命中范围。 */
  async preview(raw: unknown, owner: ColumnsInvocation): Promise<HistoryDeletePreviewOutput> {
    const input = historyDeletePreviewInputSchema.parse(raw); this.assertOwner(owner); this.prune();
    if (this.owns(input.taskId)) throw Error(text.taskUsed);
    if (this.jobs.size >= limits.active || this.previews.size + this.jobs.size >= limits.tokens) throw Error(text.busy);
    let finish!: () => void;
    const job: Job = { owner, revision: this.store.historyPageRevision(), deadline: this.now() + limits.previewMs, cancelled: false, done: new Promise(resolve => { finish = resolve; }), finish: () => finish() };
    this.jobs.set(input.taskId, job); this.recent.set(input.taskId, { owner, expires: this.now() + limits.lifetimeMs });
    while (this.recent.size > limits.recentTasks) { const oldest = [...this.recent.keys()].find(key => !this.jobs.has(key)); if (oldest === undefined) break; this.recent.delete(oldest); }
    let unobserve = () => {}, scanned = 0, bytes = 0, failure: unknown, closeFailed = false;
    const refs: HistoryDeleteReference[] = [], samples: HistoryDeleteSample[] = [];
    const request: HistoryPageInput = input.scope.kind === 'filtered' ? { ...input.scope.filters, taskId: input.taskId, onError: 'stop' } : { taskId: input.taskId, search: '', fields: ['sql', 'error'], scope: { kind: 'all' }, status: 'all', onError: 'stop' };
    /** 原索引随正文一起进入真实线程，连接或时间不一致不会被忽略为无命中。 */
    const inspect = async (record: IndexedRecord, expected?: HistoryDeleteReference) => {
      this.check(job);
      if (record.id.length > 200 || record.startedAt.length > 256 || record.connectionId.length > 200 || record.raw === null) throw Error(text.invalidRecord);
      bytes += Buffer.byteLength(record.raw); if (bytes > limits.rawBytes || ++scanned > limits.retained) throw Error(text.budget);
      const digest = createHash('sha256').update(record.raw).digest('hex');
      if (expected && (record.id !== expected.id || digest !== expected.digest)) throw Error(text.missing);
      job.matcher ??= this.runtime.matcher?.(this.workerPath) ?? new SavedQueryMatcher(this.workerPath);
      const entry = await job.matcher.summarizeHistory(record.id, record.raw, request, { id: record.id, startedAt: record.startedAt, connectionId: record.connectionId }); this.check(job);
      if (!entry) { if (expected) throw Error(text.invalidRecord); return; }
      if (entry.digest !== digest || entry.entry.id !== record.id || entry.entry.startedAt !== record.startedAt || (entry.entry.connectionId ?? '') !== record.connectionId) throw Error(text.invalidRecord);
      refs.push({ id: record.id, digest });
      if (samples.length < limits.samples) samples.push({ entry: entry.entry, sqlPreview: entry.sqlPreview, sqlUnits: entry.sqlUnits, previewTruncated: entry.previewTruncated });
    };
    try {
      unobserve = this.observe(job);
      await new Promise<void>(resolve => setImmediate(resolve)); this.check(job);
      if (input.scope.kind === 'selected') {
        for (const expected of input.scope.records) { this.check(job); const record = this.store.historyDeleteRecord(expected.id); if (!record) throw Error(text.missing); await inspect(record, expected); }
      } else {
        let after: HistoryPagePosition | undefined;
        // 枚举全部保留索引，不能按待核验的connection_id提前缩窄而漏掉迁出范围的坏索引。
        const enumerate: HistoryPageInput = { ...request, scope: { kind: 'all' } };
        for (;;) { this.check(job); const record = this.store.historyPageNext(after, enumerate); if (!record) break; await inspect(record); after = { id: record.id, startedAt: record.startedAt, connectionId: record.connectionId }; if (!record.hasMore) break; }
      }
      this.check(job);
    } catch (error) { failure = error; }
    try { await (job.stop ??= job.matcher?.close() ?? Promise.resolve()); } catch { closeFailed = true; failure ??= Error(text.failed); }
    try {
      if (failure) throw failure;
      this.check(job);
      const previewToken = randomUUID(), expires = this.now() + limits.lifetimeMs;
      this.previews.set(previewToken, { owner, revision: job.revision, expires, refs });
      return { previewToken, kind: input.scope.kind, count: refs.length, scanned, samples, expiresAt: new Date(expires).toISOString() };
    } catch (error) {
      // 原始线程异常只给出固定提示，不能把损坏JSON、SQL或错误正文泄入IPC及任务概要。
      if (error instanceof Error && Object.values(text).some(message => message === error.message)) throw error;
      throw Error(text.failed);
    } finally { unobserve(); if (!closeFailed) this.jobs.delete(input.taskId); job.finish(); }
  }
  /** 指定原task的取消只在同一真实文档下获准，等待其实际finally结束。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> {
    this.assertOwner(owner); const job = this.jobs.get(taskId), source = job?.owner ?? this.recent.get(taskId)?.owner;
    if (!source || !this.runtime.same(source, owner)) throw Error(text.stale);
    if (!job) return;
    const stopped = await Promise.allSettled([this.stop(job), job.done]);
    if (stopped.some(result => result.status === 'rejected')) throw Error(text.failed);
  }
  /** 同一原文档可幂等释放；另一文档不能借token撤销后来预览。 */
  release(raw: unknown, owner: ColumnsInvocation): void {
    const input = historyDeleteReleaseInputSchema.parse(raw); this.assertOwner(owner);
    const preview = this.previews.get(input.previewToken); if (!preview) return;
    if (!this.runtime.same(preview.owner, owner)) throw Error(text.stale); this.previews.delete(input.previewToken);
  }
  /** 最后同步领取一次性能力，所有CAS与整批删除交给原SQLite事务；成功事实不再被异步门改写。 */
  apply(raw: unknown, owner: ColumnsInvocation): HistoryDeleteApplyOutput {
    const input = historyDeleteApplyInputSchema.parse(raw); this.assertOwner(owner);
    const preview = this.previews.get(input.previewToken);
    if (!preview || !this.runtime.same(preview.owner, owner)) throw Error(text.stale);
    this.previews.delete(input.previewToken);
    const current = () => { this.assertOwner(owner); if (!this.runtime.same(preview.owner, owner) || preview.expires <= this.now() || preview.revision !== this.store.historyPageRevision()) throw Error(text.stale); };
    current();
    if (!preview.refs.length) return { deleted: 0, applied: true };
    const deleted = this.store.deleteHistorySnapshot(preview.revision, preview.refs, current);
    return { deleted, applied: true };
  }
  /** 最后IPC发布前核预览真实来源；迟到旧响应只撤销本次尚未交付的token。 */
  assertPreviewPublication(result: unknown, owner: ColumnsInvocation): void {
    if (!result || typeof result !== 'object' || !('previewToken' in result) || typeof result.previewToken !== 'string') throw Error(text.stale);
    const preview = this.previews.get(result.previewToken);
    try { this.assertOwner(owner); if (!preview || preview.owner !== owner || !this.runtime.same(preview.owner, owner) || preview.expires <= this.now() || preview.revision !== this.store.historyPageRevision()) throw Error(text.stale); }
    catch (error) { if (preview?.owner === owner) this.previews.delete(result.previewToken); throw error; }
  }
  /** 退出先停全部原worker并等待原预览承诺结束，之后才允许关闭SQLite。 */
  async close(): Promise<void> {
    this.closing = true; this.previews.clear();
    const jobs = [...this.jobs.values()];
    const stops = await Promise.allSettled(jobs.map(job => this.stop(job)));
    await Promise.all(jobs.map(job => job.done));
    const failed = stops.find(result => result.status === 'rejected'); if (failed?.status === 'rejected') throw Error(text.failed);
  }
}
