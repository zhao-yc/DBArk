import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SqliteTablePage, SqliteTablePageInput } from '../shared/sqliteTableBrowse';
import type { SqliteEditTarget, SqliteTableEditPreview, SqliteTableEditReleaseInput } from '../shared/sqliteTableEdit';
import { sqliteTableEditLimits as limits, sqliteTableEditMessages as text } from '../shared/sqliteTableEdit';

interface Ports { assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean; revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean; release(input: SqliteTableEditReleaseInput): Promise<void>; stop(taskId: string): Promise<unknown>; }
interface Binding { owner: ColumnsInvocation; revision: number; epoch: object; target: SqliteEditTarget; expires: number; }
interface Snapshot extends Binding { id: string; }
interface Preview extends Binding { id: string; snapshotId: string; source: Snapshot; counts: SqliteTableEditPreview['counts']; }
interface Operation { owner: ColumnsInvocation; check(): void; invalid: boolean; sent: boolean; stop?: Promise<void>; }
export interface SqliteEditLease { beforeSend(): void; release(): Promise<void>; }

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
    for (const [id, preview] of this.previews) if (preview.source === source) this.previews.delete(id);
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
  page(owner: ColumnsInvocation, input: SqliteTablePageInput): { accept(value: SqliteTablePage): Promise<SqliteTablePage> } {
    this.ports.assert(owner); this.watch(owner); this.observe();
    const binding: Binding = { owner, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), target: { connectionId: input.connectionId, database: 'main', table: input.table }, expires: Date.now() + limits.snapshotLifetimeMs };
    this.valid(binding);
    return { accept: async value => {
      const edit = value?.edit;
      try {
        this.valid(binding);
        if (value.target.connectionId !== binding.target.connectionId || value.target.database !== 'main' || value.target.table !== binding.target.table) throw Error(text.stale);
        if (edit?.kind === 'editable') {
          const expires = Date.parse(edit.expiresAt);
          if (!edit.snapshotId || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.snapshotLifetimeMs + 5000 || this.snapshots.has(edit.snapshotId) || this.snapshots.size >= limits.snapshots) throw Error(text.stale);
          this.snapshots.set(edit.snapshotId, { ...binding, id: edit.snapshotId, expires });
        }
        return value;
      } catch (reason) { if (edit?.kind === 'editable') await this.ports.release({ snapshotId: edit.snapshotId }); throw reason; }
    } };
  }
  /** 只有原主文档可解析对应snapshot；目标完全来自Main签发的页。 */
  snapshot(owner: ColumnsInvocation, id: string): Snapshot {
    const source = this.snapshots.get(id); if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale); this.valid(source); return source;
  }
  preview(owner: ColumnsInvocation, snapshotId: string): { target: SqliteEditTarget; check(): void; accept(value: SqliteTableEditPreview): Promise<SqliteTableEditPreview> } {
    const source = this.snapshot(owner, snapshotId);
    const check = () => { if (this.snapshots.get(snapshotId) !== source) throw Error(text.stale); this.valid(source); };
    return { target: source.target, check, accept: async value => {
      try {
        check(); const expires = Date.parse(value.expiresAt);
        if (value.snapshotId !== snapshotId || value.target.connectionId !== source.target.connectionId || value.target.database !== source.target.database || value.target.table !== source.target.table || !value.previewId || this.previews.has(value.previewId) || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.previewLifetimeMs + 5000) throw Error(text.stale);
        this.previews.set(value.previewId, { ...source, id: value.previewId, snapshotId, source, counts: { ...value.counts }, expires }); return value;
      } catch (reason) { if (value?.previewId) await this.ports.release({ previewId: value.previewId }); throw reason; }
    } };
  }
  /** 先解析再在投递前claim；每个预览一次使用，不能靠失败重试原能力。 */
  lookup(owner: ColumnsInvocation, previewId: string): Preview {
    const value = this.previews.get(previewId); if (!value || !this.ports.same(value.owner, owner) || this.snapshots.get(value.snapshotId) !== value.source) throw Error(text.stale); this.valid(value); return value;
  }
  claim(owner: ColumnsInvocation, previewId: string): { target: SqliteEditTarget; counts: Preview['counts']; check(): void; finish(outcome: string): void } {
    const value = this.lookup(owner, previewId); this.previews.delete(previewId);
    const check = () => { this.ports.assert(value.owner); if (this.ports.closing() || value.revision !== this.ports.revision() || value.epoch !== this.ports.epoch(value.target.connectionId) || this.snapshots.get(value.snapshotId) !== value.source) throw Error(text.stale); };
    return { target: { ...value.target }, counts: { ...value.counts }, check, finish: outcome => { if (outcome === 'committed' || outcome === 'unknown') this.discardSnapshot(value.source); } };
  }
  begin(taskId: string, owner: ColumnsInvocation, check: () => void): SqliteEditLease {
    if (this.operations.has(taskId)) throw Error(text.stale); this.ports.assert(owner); this.watch(owner); check();
    const operation: Operation = { owner, check, invalid: false, sent: false }; this.operations.set(taskId, operation);
    return { beforeSend: () => { this.observe(); if (operation.invalid) throw Error(text.stale); operation.sent = true; }, release: async () => { try { if (operation.stop) await operation.stop.catch(() => {}); } finally { if (this.operations.get(taskId) === operation) this.operations.delete(taskId); } } };
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
    if (source) { this.snapshots.delete(source.id); for (const [id, value] of this.previews) if (value.source === source) this.previews.delete(id); }
    if (preview) this.previews.delete(preview.id);
    if (source || preview) await this.ports.release({ ...(source ? { snapshotId: source.id } : {}), ...(preview ? { previewId: preview.id } : {}) });
  }
}
