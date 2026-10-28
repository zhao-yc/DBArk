import { createHash } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import { tableFilteredUpdateApplyInputSchema, tableFilteredUpdateApplyOutputSchema, tableFilteredUpdateAssignments, tableFilteredUpdateOutputColumns, tableFilteredUpdateConfirmation, tableFilteredUpdateLimits as limits, tableFilteredUpdatePreviewInputSchema, tableFilteredUpdatePreviewOutputSchema, tableFilteredUpdateReleaseInputSchema, tableFilteredUpdateText as text } from '../shared/tableFilteredUpdate';
import type { TableFilteredUpdateApplyInput, TableFilteredUpdateApplyOutput, TableFilteredUpdatePreviewInput, TableFilteredUpdatePreviewOutput, TableFilteredUpdateReleaseInput, TableFilteredUpdateTarget } from '../shared/tableFilteredUpdate';

interface Runtime {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; closing(): boolean; available(connectionId: string): void;
  run(command: 'table.filteredUpdate.preview' | 'table.filteredUpdate.apply', input: TableFilteredUpdatePreviewInput | TableFilteredUpdateApplyInput, revision: number): Promise<unknown>;
  release(input: TableFilteredUpdateReleaseInput): Promise<unknown>; stop(taskId: string): Promise<unknown>;
}
interface Binding { owner: ColumnsInvocation; revision: number; generation: object; engine: number; target: TableFilteredUpdateTarget; expires: number; rows: number; columns: string[]; legacy: boolean; }
interface Operation extends Binding { taskId: string; sent: boolean; invalid: boolean; done: Promise<void>; finish(): void; stop?: Promise<void>; stopFailure?: unknown; listeners: { event: string; callback(): void }[]; }
interface Release { binding: Binding; operation?: Operation; pending: boolean; promise: Promise<unknown>; failure?: unknown; }

/** 一次性能力绑定真实主文档及连接代次；磁盘快照收尾与数据库原任务均结束才放行取消。 */
export class TableFilteredUpdateOwners {
  private readonly previews = new Map<string, Binding>();
  private readonly active = new Map<string, Operation>();
  private readonly generations = new Map<string, object>();
  private readonly releases = new Map<string, Release>();
  private engine = 0;
  constructor(private readonly runtime: Runtime, private readonly now = Date.now) {}
  has(taskId: string): boolean { return this.active.has(taskId); }
  private generation(id: string): object { let value = this.generations.get(id); if (!value) this.generations.set(id, value = {}); return value; }
  private assert(binding: Binding): void {
    // saving是待成功/待拒绝的临时准入锁，不能因原进度抵达就取消正在执行的事务。
    this.runtime.assert(binding.owner);
    if (this.runtime.closing() || binding.engine !== this.engine || binding.revision !== this.runtime.revision() || binding.generation !== this.generation(binding.target.connectionId) || binding.expires <= this.now()) throw Error(text.stale);
  }
  /** 一个原token只保留当前清理承诺；自动观察不重试，显式释放才能替换已失败承诺。 */
  private queueRelease(input: TableFilteredUpdateReleaseInput, binding: Binding, operation?: Operation, retry = false): Promise<unknown> {
    if (binding.engine !== this.engine) return Promise.resolve();
    const before = this.releases.get(input.previewToken);
    if (before && (before.binding.engine !== binding.engine || before.binding.target.connectionId !== input.connectionId)) return Promise.reject(Error(text.stale));
    if (before && (before.pending || !retry)) return before.promise;
    const release: Release = { binding: before?.binding ?? binding, operation: before?.operation ?? operation, pending: true, promise: Promise.resolve(), failure: before?.failure };
    const promise = Promise.resolve().then(() => binding.engine === this.engine ? this.runtime.release(input) : undefined).then(value => {
      release.pending = false; release.failure = undefined;
      if (this.releases.get(input.previewToken) === release) this.releases.delete(input.previewToken);
      return value;
    }, error => { release.pending = false; release.failure = error; throw error; });
    release.promise = promise; this.releases.set(input.previewToken, release);
    // 失败仍在墓碑中供drain报告；不累计已替换的失败历史，也不产生未观察拒绝。
    void promise.catch(() => undefined); return promise;
  }
  /** 撤销写入能力后立即以原归属建立清理墓碑，失败不会丢失重试身份或资源槽。 */
  private drop(token: string, binding: Binding): Promise<unknown> { if (this.previews.get(token) === binding) this.previews.delete(token); return this.queueRelease({ connectionId: binding.target.connectionId, previewToken: token }, binding); }
  /** 在途原操作已经占槽，同一快照的清理不能重复计数；失败终结后仍占一个槽。 */
  private occupied(): number { return this.previews.size + this.active.size + [...this.releases.values()].filter(release => !release.operation || this.active.get(release.operation.taskId) !== release.operation).length; }
  private invalidate(operation: Operation): void {
    operation.invalid = true;
    if (operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.runtime.stop(operation.taskId)).then(() => undefined, error => { operation.stopFailure = error; });
  }
  private check(operation: Operation): void { try { this.assert(operation); } catch { this.invalidate(operation); } }
  /** 配置、主文档导航及显式断开立即撤销，不建立替代任务或重放写入。 */
  observe(): void {
    for (const operation of this.active.values()) this.check(operation);
    for (const [token, binding] of this.previews) try { this.assert(binding); } catch { void this.drop(token, binding).catch(() => undefined); }
  }
  invalidateConnection(id: string): void { this.generations.set(id, {}); this.observe(); }
  engineExited(): void { this.engine++; this.previews.clear(); this.releases.clear(); this.generations.clear(); for (const operation of this.active.values()) { operation.invalid = true; operation.sent = false; } }
  /** 只观察当前原承诺；既不把失败当成功，也不借退出或观察自动重放释放。 */
  async drain(): Promise<void> { this.observe(); while (this.releases.size) await Promise.all([...this.releases.values()].map(release => release.promise)); }
  private begin(taskId: string, owner: ColumnsInvocation, target: TableFilteredUpdateTarget, revision: number, columns: readonly string[], legacy: boolean, rows = 0): Operation {
    if (this.active.has(taskId)) throw Error('全部筛选行填充任务编号已使用');
    this.runtime.available(target.connectionId);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Operation = { owner, target, revision, columns: [...columns], legacy, rows, generation: this.generation(target.connectionId), engine: this.engine, expires: Infinity, taskId, sent: false, invalid: false, done, finish, listeners: [] };
    this.assert(operation); this.active.set(taskId, operation);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) { const callback = () => this.check(operation); owner.owner.contents.on(event as 'destroyed', callback); operation.listeners.push({ event, callback }); }
    return operation;
  }
  private async waitStop(operation: Operation): Promise<void> { for (;;) { const stop = operation.stop; await stop; if (stop === operation.stop) return; } }
  /** 只在实际请求和快照release都已结算后调用；观察超时或单独cancel ACK不能提前触发done。 */
  private async finish(operation: Operation): Promise<void> {
    try { await this.waitStop(operation); }
    finally { for (const { event, callback } of operation.listeners) operation.owner.owner.contents.removeListener(event as 'destroyed', callback); if (this.active.get(operation.taskId) === operation) this.active.delete(operation.taskId); operation.finish(); }
  }
  async preview(raw: TableFilteredUpdatePreviewInput, owner: ColumnsInvocation): Promise<TableFilteredUpdatePreviewOutput> {
    const input = tableFilteredUpdatePreviewInputSchema.parse(raw); this.observe();
    if (this.occupied() >= limits.previews) throw Error(text.budget);
    const assignments = tableFilteredUpdateAssignments(input), legacy = 'column' in input;
    const operation = this.begin(input.taskId, owner, { connectionId: input.connectionId, database: input.database, table: input.table }, this.runtime.revision(), assignments.map(value => value.column), legacy);
    let returnedToken: string | undefined, success = false;
    try {
      this.assert(operation); operation.sent = true;
      const value = await this.runtime.run('table.filteredUpdate.preview', input, operation.revision); operation.sent = false;
      const releasable = tableFilteredUpdateReleaseInputSchema.safeParse({ connectionId: input.connectionId, previewToken: value && typeof value === 'object' && 'previewToken' in value ? value.previewToken : undefined });
      if (releasable.success && !this.previews.has(releasable.data.previewToken) && !this.releases.has(releasable.data.previewToken)) returnedToken = releasable.data.previewToken;
      const result = tableFilteredUpdatePreviewOutputSchema.parse(value), expected = operation.target, actual = result.target;
      // 全部字段和值均签入摘要；旧单字段保留原摘要，不能将多字段回执缩成首列。
      const assignment = createHash('sha256').update(JSON.stringify(legacy ? [assignments[0].column, assignments[0].value] : assignments.map(value => [value.column, value.value]))).digest('hex');
      if (actual.connectionId !== expected.connectionId || actual.database !== expected.database || actual.table !== expected.table || ('column' in result) !== legacy || JSON.stringify(tableFilteredUpdateOutputColumns(result)) !== JSON.stringify(operation.columns) || result.assignmentDigest !== assignment || result.shownRows > Math.min(result.rows, limits.shownRows) || result.sampleOmitted !== (result.shownRows < result.rows) || Date.parse(result.expiresAt) <= this.now() || Date.parse(result.expiresAt) > this.now() + limits.lifetimeMs || this.previews.has(result.previewToken) || this.releases.has(result.previewToken)) throw Error(text.stale);
      this.check(operation); await this.waitStop(operation); this.assert(operation);
      if (operation.invalid || operation.stopFailure) throw operation.stopFailure ?? Error(text.stale);
      this.previews.set(result.previewToken, { ...operation, rows: result.rows, expires: Date.parse(result.expiresAt) }); success = true; return result;
    } finally {
      operation.sent = false;
      try { if (!success && returnedToken) await this.queueRelease({ connectionId: input.connectionId, previewToken: returnedToken }, operation, operation); }
      finally { await this.finish(operation); }
    }
  }
  /** IPC最终发布之前同步检查；不能将导航期间返回的磁盘快照能力交付给新文档。 */
  assertPublication(value: unknown, owner: ColumnsInvocation): void { const output = tableFilteredUpdatePreviewOutputSchema.parse(value), binding = this.previews.get(output.previewToken); if (!binding || !this.runtime.same(binding.owner, owner)) throw Error(text.stale); this.assert(binding); this.runtime.available(binding.target.connectionId); }
  async rejectPublication(value: unknown, owner: ColumnsInvocation): Promise<void> { const parsed = tableFilteredUpdatePreviewOutputSchema.safeParse(value); if (!parsed.success) return; const binding = this.previews.get(parsed.data.previewToken); if (binding?.owner === owner) await this.drop(parsed.data.previewToken, binding); }
  /** 只消费准确预览；确认失败保留原能力，实际发送或任何应用失败后均不得复活重试。 */
  async apply(raw: TableFilteredUpdateApplyInput, owner: ColumnsInvocation): Promise<TableFilteredUpdateApplyOutput> {
    const input = tableFilteredUpdateApplyInputSchema.parse(raw), binding = this.previews.get(input.previewToken);
    if (!binding || input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale);
    const fields = binding.legacy ? { column: binding.columns[0] } : { columns: [...binding.columns] };
    this.assert(binding); if (!binding.rows || input.confirmation !== tableFilteredUpdateConfirmation({ target: binding.target, rows: binding.rows, ...fields })) throw Error('请准确确认原库表、全部字段及匹配行数');
    const operation = this.begin(input.taskId, owner, binding.target, binding.revision, binding.columns, binding.legacy, binding.rows); this.previews.delete(input.previewToken);
    let committed = false;
    try {
      this.assert(operation); operation.sent = true;
      const result = tableFilteredUpdateApplyOutputSchema.parse(await this.runtime.run('table.filteredUpdate.apply', input, binding.revision)); operation.sent = false;
      if (result.target.connectionId !== binding.target.connectionId || result.target.database !== binding.target.database || result.target.table !== binding.target.table || ('column' in result) !== binding.legacy || JSON.stringify(tableFilteredUpdateOutputColumns(result)) !== JSON.stringify(binding.columns) || result.rows !== binding.rows) throw Error(text.unknown);
      // 真实COMMIT回执不受晚导航或取消影响；下一份预览仍须重新获取。
      committed = true; return result;
    } finally {
      operation.sent = false;
      try { await this.waitStop(operation); try { await this.queueRelease({ connectionId: input.connectionId, previewToken: input.previewToken }, operation, operation); } catch (error) { if (!committed) throw error; } }
      finally { await this.finish(operation); }
    }
  }
  /** 回收沿原文档/连接/引擎身份，允许原预览过期或连接修订变化；绝不恢复apply能力。 */
  async release(raw: TableFilteredUpdateReleaseInput, owner: ColumnsInvocation): Promise<void> {
    const input = tableFilteredUpdateReleaseInputSchema.parse(raw), binding = this.previews.get(input.previewToken), retained = this.releases.get(input.previewToken); this.runtime.assert(owner);
    const original = binding ?? retained?.binding; if (!original) return;
    if (original.engine !== this.engine || input.connectionId !== original.target.connectionId || !this.runtime.same(original.owner, owner)) throw Error(text.stale);
    if (binding) await this.drop(input.previewToken, binding);
    else await this.queueRelease(input, original, retained?.operation, true);
  }
  /** 等待原DB请求、原cancel承诺及原磁盘快照清理，不用新任务追认旧任务完成。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> { const operation = this.active.get(taskId); this.runtime.assert(owner); if (!operation || !this.runtime.same(operation.owner, owner)) throw Error(text.stale); this.invalidate(operation); await operation.stop; await operation.done; if (operation.stopFailure) throw operation.stopFailure; }
}
