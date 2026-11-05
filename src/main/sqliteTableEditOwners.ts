import type { SqliteDraftRestored } from '../shared/sqliteTableDraft';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SqliteTablePage, SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import type { SqliteEditTarget, SqliteTableEditPreview, SqliteTableEditReleaseInput } from '../shared/sqliteTableEdit';
import { sqliteTableEditLimits as limits, sqliteTableEditMessages as text } from '../shared/sqliteTableEdit';

interface Ports { assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean; revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean; release(input: SqliteTableEditReleaseInput): Promise<void>; stop(taskId: string): Promise<unknown>; }
interface Binding { owner: ColumnsInvocation; revision: number; epoch: object; target: SqliteEditTarget; expires: number; }
interface Snapshot extends Binding { id: string; schemaKey: string; }
interface Preview extends Binding { id: string; snapshotId: string; source: Snapshot; sources: Snapshot[]; counts: SqliteTableEditPreview['counts']; }
interface Operation { owner: ColumnsInvocation; check(): void; invalid: boolean; sent: boolean; stop?: Promise<void>; }
export interface SqliteEditLease { check(): void; beforeSend(): void; release(): Promise<void>; }

/** 文件页与预览能力属于准确主文档和配置修订，不能在同URL重载或连接ABA后继承。 */
export class SqliteTableEditOwners {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly previews = new Map<string, Preview>();
  private readonly operations = new Map<string, Operation>();
  private readonly watched = new WeakSet<object>();
  constructor(private readonly ports: Ports) {}
  private valid(binding: Binding, admission = true): void {
    this.ports.assert(binding.owner); if (admission) this.ports.available(binding.target.connectionId);
    if (this.ports.closing() || binding.revision !== this.ports.revision() || binding.epoch !== this.ports.epoch(binding.target.connectionId) || binding.expires <= Date.now()) throw Error(text.stale);
  }
  /** 每个窗口只监听一次，数量不会随翻页增加；导航失败也不能复活旧文档能力。 */
  private watch(owner: ColumnsInvocation): void {
    const contents = owner.owner.contents; if (this.watched.has(contents)) return; this.watched.add(contents);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) contents.on(event as 'destroyed', () => this.observe());
  }
  /** 撤销读取能力不取消已发送的写入；准确写入的取消由自己的操作租约负责。 */
  private discardSnapshot(source: Snapshot): void {
    if (this.snapshots.get(source.id) !== source) return;
    this.snapshots.delete(source.id);
    for (const [id, preview] of this.previews) if (preview.sources.includes(source)) this.previews.delete(id);
    void this.ports.release({ snapshotId: source.id }).catch(() => { /* 已撤销Main能力；runtime仍持有原清理账本，不伪造释放成功。 */ });
  }
  /** 同步失效标记优先于异步取消，重复通知不重复取消同一任务。 */
  private invalidate(taskId: string, operation: Operation): void {
    operation.invalid = true;
    if (operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.ports.stop(taskId)).then(() => {});
    void operation.stop?.catch(() => {});
  }
  observe(): void {
    for (const source of this.snapshots.values()) try { this.valid(source, false); } catch { this.discardSnapshot(source); }
    for (const [id, preview] of this.previews) if (preview.expires <= Date.now()) { this.previews.delete(id); void this.ports.release({ previewId: id }).catch(() => {}); }
    for (const [id, operation] of this.operations) try { this.ports.assert(operation.owner); operation.check(); } catch { this.invalidate(id, operation); }
  }
  /** 页请求在首个await前捕获来源；回包只签原目标，不向新文档泄露可写快照。 */
  page(owner: ColumnsInvocation, input: SqliteTablePageInput): { check(): void; accept(value: SqliteTablePage): Promise<SqliteTablePage>; acceptRestored(value: SqliteDraftRestored): Promise<SqliteDraftRestored> } {
    this.ports.assert(owner); this.watch(owner); this.observe();
    const binding: Binding = { owner, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), target: { connectionId: input.connectionId, database: 'main', table: input.table }, expires: Date.now() + limits.snapshotLifetimeMs };
    this.valid(binding);
    /** 全部新页先校验，任何后页失败都不登记前页；释放准确本批能力后才拒绝。 */
    const accept = async (pages: SqliteTablePage[]): Promise<void> => {
      try {
        this.valid(binding);
        if (!pages.length || pages.length > limits.pages) throw Error(text.stale);
        const prepared: Snapshot[] = [], ids = new Set<string>();
        for (const value of pages) {
          if (value.target.connectionId !== binding.target.connectionId || value.target.database !== 'main' || value.target.table !== binding.target.table || value.schemaKey !== pages[0].schemaKey) throw Error(text.stale);
          const edit = value.edit;
          if (edit?.kind === 'editable') {
            const expires = Date.parse(edit.expiresAt);
            if (!edit.snapshotId || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.snapshotLifetimeMs + 5000 || this.snapshots.has(edit.snapshotId) || ids.has(edit.snapshotId) || this.snapshots.size + prepared.length >= limits.snapshots) throw Error(text.stale);
            ids.add(edit.snapshotId); prepared.push({ ...binding, id: edit.snapshotId, schemaKey: value.schemaKey, expires });
          }
        }
        for (const item of prepared) this.snapshots.set(item.id, item);
      } catch (reason) { const fresh = pages.filter(page => page?.edit?.kind === 'editable' && !this.snapshots.has(page.edit.snapshotId)); await this.rejectRestored({ page: fresh[0], changes: [], additionalPages: fresh.slice(1).map(page => ({ page, changes: [] })) }); throw reason; }
    };
    return { check: () => this.valid(binding), accept: async value => { await accept([value]); return value; }, acceptRestored: async value => { await accept([value, ...(value.additionalPages ?? [])].map(item => item.page)); return value; } };
  }
  /** 仅Main未发布回包收尾调用；原窗口失效时也撤销本批所有分组，不能漏留后台能力。 */
  async rejectRestored(value: SqliteDraftRestored): Promise<void> {
    const ids = new Set([value, ...(value.additionalPages ?? [])].flatMap(item => item.page?.edit?.kind === 'editable' ? [item.page.edit.snapshotId] : []));
    for (const id of ids) { this.snapshots.delete(id); for (const [key, preview] of this.previews) if (preview.sources.some(source => source.id === id)) this.previews.delete(key); }
    const results = await Promise.allSettled([...ids].map(snapshotId => this.ports.release({ snapshotId })));
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []); if (failures.length) throw new AggregateError(failures, 'SQLite恢复分组能力释放未确认');
  }
  /** 只有原主文档可解析对应snapshot；目标完全来自Main签发的页。 */
  snapshot(owner: ColumnsInvocation, id: string): Snapshot {
    const source = this.snapshots.get(id); if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale); this.valid(source); return source;
  }
  /** 多页能力逐一属于同一原文档／配置和表结构；任一页撤权即撤整组预览。 */
  preview(owner: ColumnsInvocation, snapshotId: string, additionalIds: readonly string[] = []): { target: SqliteEditTarget; check(): void; accept(value: SqliteTableEditPreview): Promise<SqliteTableEditPreview> } {
    const ids = [snapshotId, ...additionalIds];
    if (ids.length > limits.pages || new Set(ids).size !== ids.length) throw Error(text.stale);
    const sources = ids.map(id => this.snapshot(owner, id)), source = sources[0];
    if (sources.some(page => page.target.connectionId !== source.target.connectionId || page.target.database !== source.target.database || page.target.table !== source.target.table || page.schemaKey !== source.schemaKey)) throw Error(text.stale);
    const check = () => { for (const page of sources) { if (this.snapshots.get(page.id) !== page) throw Error(text.stale); this.valid(page); } };
    return { target: source.target, check, accept: async value => {
      try {
        check(); const expires = Date.parse(value.expiresAt);
        const outputIds = value.snapshotIds ?? [value.snapshotId];
        if (outputIds.length !== ids.length || outputIds.some((id, index) => id !== ids[index]) || value.snapshotId !== snapshotId || value.schemaKey !== source.schemaKey || value.target.connectionId !== source.target.connectionId || value.target.database !== source.target.database || value.target.table !== source.target.table || !value.previewId || this.previews.has(value.previewId) || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.previewLifetimeMs + 5000 || sources.some(page => expires > page.expires)) throw Error(text.stale);
        this.previews.set(value.previewId, { ...source, id: value.previewId, snapshotId, source, sources, counts: { ...value.counts }, expires }); return value;
      } catch (reason) { if (value?.previewId) await this.ports.release({ previewId: value.previewId }); throw reason; }
    } };
  }
  /** 先解析再在投递前claim；每个预览一次使用，不能靠失败重试原能力。 */
  lookup(owner: ColumnsInvocation, previewId: string): Preview {
    const value = this.previews.get(previewId); if (!value || !this.ports.same(value.owner, owner) || value.sources.some(source => this.snapshots.get(source.id) !== source)) throw Error(text.stale); this.valid(value); for (const source of value.sources) this.valid(source); return value;
  }
  claim(owner: ColumnsInvocation, previewId: string): { target: SqliteEditTarget; counts: Preview['counts']; check(): void; finish(outcome: string): void } {
    const value = this.lookup(owner, previewId); this.previews.delete(previewId);
    const check = () => { this.ports.assert(value.owner); if (this.ports.closing() || value.revision !== this.ports.revision() || value.epoch !== this.ports.epoch(value.target.connectionId) || value.sources.some(source => this.snapshots.get(source.id) !== source)) throw Error(text.stale); };
    return { target: { ...value.target }, counts: { ...value.counts }, check, finish: outcome => { if (outcome === 'committed' || outcome === 'unknown') for (const source of value.sources) this.discardSnapshot(source); } };
  }
  begin(taskId: string, owner: ColumnsInvocation, check: () => void): SqliteEditLease {
    if (this.operations.has(taskId)) throw Error(text.stale); this.ports.assert(owner); this.watch(owner); check();
    const operation: Operation = { owner, check, invalid: false, sent: false }; this.operations.set(taskId, operation);
    const current = () => { this.observe(); if (operation.invalid || this.operations.get(taskId) !== operation) throw Error(text.stale); };
    return { check: current, beforeSend: () => { current(); operation.sent = true; }, release: async () => { try { if (operation.stop) await operation.stop.catch(() => {}); } finally { if (this.operations.get(taskId) === operation) this.operations.delete(taskId); } } };
  }
  owns(taskId: string): boolean { return this.operations.has(taskId); }
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> {
    const operation = this.operations.get(taskId); if (!operation || !this.ports.same(operation.owner, owner)) throw Error(text.stale);
    this.invalidate(taskId, operation);
    if (!operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.ports.stop(taskId)).then(() => {});
    await operation.stop;
  }
  async release(owner: ColumnsInvocation, input: SqliteTableEditReleaseInput): Promise<void> {
    this.ports.assert(owner);
    const source = input.snapshotId ? this.snapshots.get(input.snapshotId) : undefined, preview = input.previewId ? this.previews.get(input.previewId) : undefined;
    if (source && !this.ports.same(source.owner, owner) || preview && !this.ports.same(preview.owner, owner)) throw Error(text.stale);
    if (source) { this.snapshots.delete(source.id); for (const [id, value] of this.previews) if (value.sources.includes(source)) this.previews.delete(id); }
    if (preview) this.previews.delete(preview.id);
    if (source || preview) await this.ports.release({ ...(source ? { snapshotId: source.id } : {}), ...(preview ? { previewId: preview.id } : {}) });
  }
}
