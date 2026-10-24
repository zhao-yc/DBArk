import { createHash } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import { tableFilteredUpdateApplyInputSchema, tableFilteredUpdateApplyOutputSchema, tableFilteredUpdateConfirmation, tableFilteredUpdateLimits as limits, tableFilteredUpdatePreviewInputSchema, tableFilteredUpdatePreviewOutputSchema, tableFilteredUpdateReleaseInputSchema, tableFilteredUpdateText as text } from '../shared/tableFilteredUpdate';
import type { TableFilteredUpdateApplyInput, TableFilteredUpdateApplyOutput, TableFilteredUpdatePreviewInput, TableFilteredUpdatePreviewOutput, TableFilteredUpdateReleaseInput, TableFilteredUpdateTarget } from '../shared/tableFilteredUpdate';

interface Runtime {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; closing(): boolean; available(connectionId: string): void;
  run(command: 'table.filteredUpdate.preview' | 'table.filteredUpdate.apply', input: TableFilteredUpdatePreviewInput | TableFilteredUpdateApplyInput, revision: number): Promise<unknown>;
  release(input: TableFilteredUpdateReleaseInput): Promise<unknown>; stop(taskId: string): Promise<unknown>;
}
interface Binding { owner: ColumnsInvocation; revision: number; generation: object; engine: number; target: TableFilteredUpdateTarget; expires: number; rows: number; column: string; }
interface Operation extends Binding { taskId: string; sent: boolean; invalid: boolean; done: Promise<void>; finish(): void; stop?: Promise<void>; stopFailure?: unknown; listeners: { event: string; callback(): void }[]; }

/** 一次性能力绑定真实主文档及连接代次；磁盘快照收尾与数据库原任务均结束才放行取消。 */
export class TableFilteredUpdateOwners {
  private readonly previews = new Map<string, Binding>();
  private readonly active = new Map<string, Operation>();
  private readonly generations = new Map<string, object>();
  private readonly cleanup = new Set<Promise<unknown>>();
  private engine = 0;
  constructor(private readonly runtime: Runtime, private readonly now = Date.now) {}
  has(taskId: string): boolean { return this.active.has(taskId); }
  private generation(id: string): object { let value = this.generations.get(id); if (!value) this.generations.set(id, value = {}); return value; }
  private assert(binding: Binding): void {
    // saving是待成功/待拒绝的临时准入锁，不能因原进度抵达就取消正在执行的事务。
    this.runtime.assert(binding.owner);
    if (this.runtime.closing() || binding.engine !== this.engine || binding.revision !== this.runtime.revision() || binding.generation !== this.generation(binding.target.connectionId) || binding.expires <= this.now()) throw Error(text.stale);
  }
  /** 清理失败保留原Promise，drain不能把未删除快照报告为已经收尾。 */
  private queueRelease(input: TableFilteredUpdateReleaseInput, engine: number): Promise<unknown> {
    const operation = Promise.resolve().then(() => engine === this.engine ? this.runtime.release(input) : undefined); this.cleanup.add(operation);
    void operation.then(() => this.cleanup.delete(operation), () => undefined); return operation;
  }
  private drop(token: string, binding: Binding): Promise<unknown> { if (this.previews.get(token) === binding) this.previews.delete(token); return this.queueRelease({ connectionId: binding.target.connectionId, previewToken: token }, binding.engine); }
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
  engineExited(): void { this.engine++; this.previews.clear(); this.cleanup.clear(); this.generations.clear(); for (const operation of this.active.values()) { operation.invalid = true; operation.sent = false; } }
  async drain(): Promise<void> { this.observe(); while (this.cleanup.size) await Promise.all([...this.cleanup]); }
  private begin(taskId: string, owner: ColumnsInvocation, target: TableFilteredUpdateTarget, revision: number, column: string, rows = 0): Operation {
    if (this.active.has(taskId)) throw Error('全部筛选行填充任务编号已使用');
    this.runtime.available(target.connectionId);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Operation = { owner, target, revision, column, rows, generation: this.generation(target.connectionId), engine: this.engine, expires: Infinity, taskId, sent: false, invalid: false, done, finish, listeners: [] };
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
    if (this.previews.size + this.active.size >= limits.previews) throw Error(text.budget);
    const operation = this.begin(input.taskId, owner, { connectionId: input.connectionId, database: input.database, table: input.table }, this.runtime.revision(), input.column);
    let returnedToken: string | undefined, success = false;
    try {
      this.assert(operation); operation.sent = true;
      const value = await this.runtime.run('table.filteredUpdate.preview', input, operation.revision); operation.sent = false;
      if (value && typeof value === 'object' && 'previewToken' in value && typeof value.previewToken === 'string' && /^[a-f0-9-]{36}$/i.test(value.previewToken) && !this.previews.has(value.previewToken)) returnedToken = value.previewToken;
      const result = tableFilteredUpdatePreviewOutputSchema.parse(value), expected = operation.target, actual = result.target;
      const assignment = createHash('sha256').update(JSON.stringify([input.column, input.value])).digest('hex');
      if (actual.connectionId !== expected.connectionId || actual.database !== expected.database || actual.table !== expected.table || result.column !== input.column || result.assignmentDigest !== assignment || result.shownRows > Math.min(result.rows, limits.shownRows) || result.sampleOmitted !== (result.shownRows < result.rows) || Date.parse(result.expiresAt) <= this.now() || Date.parse(result.expiresAt) > this.now() + limits.lifetimeMs || this.previews.has(result.previewToken)) throw Error(text.stale);
      this.check(operation); await this.waitStop(operation); this.assert(operation);
      if (operation.invalid || operation.stopFailure) throw operation.stopFailure ?? Error(text.stale);
      this.previews.set(result.previewToken, { ...operation, rows: result.rows, expires: Date.parse(result.expiresAt) }); success = true; return result;
    } finally {
      operation.sent = false;
      try { if (!success && returnedToken) await this.queueRelease({ connectionId: input.connectionId, previewToken: returnedToken }, operation.engine); }
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
    this.assert(binding); if (!binding.rows || input.confirmation !== tableFilteredUpdateConfirmation(binding)) throw Error('请准确确认原库表、字段及全部匹配行数');
    const operation = this.begin(input.taskId, owner, binding.target, binding.revision, binding.column, binding.rows); this.previews.delete(input.previewToken);
    let committed = false;
    try {
      this.assert(operation); operation.sent = true;
      const result = tableFilteredUpdateApplyOutputSchema.parse(await this.runtime.run('table.filteredUpdate.apply', input, binding.revision)); operation.sent = false;
      if (result.target.connectionId !== binding.target.connectionId || result.target.database !== binding.target.database || result.target.table !== binding.target.table || result.column !== binding.column || result.rows !== binding.rows) throw Error(text.unknown);
      // 真实COMMIT回执不受晚导航或取消影响；下一份预览仍须重新获取。
      committed = true; return result;
    } finally {
      operation.sent = false;
      try { await this.waitStop(operation); try { await this.queueRelease({ connectionId: input.connectionId, previewToken: input.previewToken }, operation.engine); } catch (error) { if (!committed) throw error; } }
      finally { await this.finish(operation); }
    }
  }
  async release(raw: TableFilteredUpdateReleaseInput, owner: ColumnsInvocation): Promise<void> { const input = tableFilteredUpdateReleaseInputSchema.parse(raw), binding = this.previews.get(input.previewToken); this.runtime.assert(owner); if (!binding) return; if (input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale); await this.drop(input.previewToken, binding); }
  /** 等待原DB请求、原cancel承诺及原磁盘快照清理，不用新任务追认旧任务完成。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> { const operation = this.active.get(taskId); this.runtime.assert(owner); if (!operation || !this.runtime.same(operation.owner, owner)) throw Error(text.stale); this.invalidate(operation); await operation.stop; await operation.done; if (operation.stopFailure) throw operation.stopFailure; }
}
