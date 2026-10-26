import { createHash } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import { tableFilteredDeleteApplyInputSchema, tableFilteredDeleteApplyOutputSchema, tableFilteredDeleteConfirmation, tableFilteredDeleteLimits as limits, tableFilteredDeletePreviewInputSchema, tableFilteredDeletePreviewOutputSchema, tableFilteredDeleteReleaseInputSchema, tableFilteredDeleteScopeIdentity, tableFilteredDeleteText as text } from '../shared/tableFilteredDelete';
import type { TableFilteredDeleteApplyInput, TableFilteredDeleteApplyOutput, TableFilteredDeletePreviewInput, TableFilteredDeletePreviewOutput, TableFilteredDeleteReleaseInput, TableFilteredDeleteTarget } from '../shared/tableFilteredDelete';

interface Runtime {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; closing(): boolean; available(connectionId: string): void;
  run(command: 'table.filteredDelete.preview' | 'table.filteredDelete.apply', input: TableFilteredDeletePreviewInput | TableFilteredDeleteApplyInput, revision: number): Promise<unknown>;
  release(input: TableFilteredDeleteReleaseInput): Promise<unknown>; stop(taskId: string): Promise<unknown>;
}
interface Binding { owner: ColumnsInvocation; revision: number; generation: object; engine: number; target: TableFilteredDeleteTarget; expires: number; rows: number; receiptDigest?: string; }
interface Operation extends Binding { taskId: string; sent: boolean; invalid: boolean; done: Promise<void>; finish(): void; stop?: Promise<void>; stopFailure?: unknown; listeners: { event: string; callback(): void }[]; }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** 删除与填充使用独立能力账本；真实主文档、连接修订及断开代次共同约束一次性确认。 */
export class TableFilteredDeleteOwners {
  private readonly previews = new Map<string, Binding>();
  private readonly active = new Map<string, Operation>();
  private readonly generations = new Map<string, object>();
  private readonly cleanup = new Set<Promise<unknown>>();
  private engine = 0;
  constructor(private readonly runtime: Runtime, private readonly now = Date.now) {}

  /** 取消仅可路由到仍由本用途持有的原任务。 */
  has(taskId: string): boolean { return this.active.has(taskId); }
  private time(): number { const value = this.now(); if (!Number.isFinite(value)) throw Error(text.stale); return value; }
  private generation(id: string): object { let value = this.generations.get(id); if (!value) this.generations.set(id, value = {}); return value; }
  private assert(binding: Binding): void {
    // 配置保存的临时准入锁不等于配置已经变化，不能因旧进度抵达而取消原事务。
    this.runtime.assert(binding.owner);
    if (this.runtime.closing() || binding.engine !== this.engine || binding.revision !== this.runtime.revision() || binding.generation !== this.generation(binding.target.connectionId) || binding.expires <= this.time()) throw Error(text.stale);
  }
  /** 失败的原释放承诺留在账本；不能以重新创建的 Promise 追认文件已经删除。 */
  private queueRelease(input: TableFilteredDeleteReleaseInput, engine: number): Promise<unknown> {
    const operation = Promise.resolve().then(() => engine === this.engine ? this.runtime.release(input) : undefined); this.cleanup.add(operation);
    void operation.then(() => this.cleanup.delete(operation), () => undefined); return operation;
  }
  private drop(token: string, binding: Binding): Promise<unknown> { if (this.previews.get(token) === binding) this.previews.delete(token); return this.queueRelease({ connectionId: binding.target.connectionId, previewToken: token }, binding.engine); }
  private invalidate(operation: Operation): void {
    operation.invalid = true;
    if (operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.runtime.stop(operation.taskId)).then(() => undefined, error => { operation.stopFailure = error; });
  }
  private check(operation: Operation): void { try { this.assert(operation); } catch { this.invalidate(operation); } }

  /** 导航、配置成功变化和退出单向撤销旧能力，不补发删除或重新创建任务。 */
  observe(): void {
    for (const operation of this.active.values()) this.check(operation);
    for (const [token, binding] of this.previews) try { this.assert(binding); } catch { void this.drop(token, binding).catch(() => undefined); }
  }
  /** 同一连接断开再恢复也不会复活旧预览。 */
  invalidateConnection(id: string): void { this.generations.set(id, {}); this.observe(); }
  /** 引擎代次只撤销逻辑能力；不把进程死亡表述为物理快照已删除。 */
  engineExited(): void { this.engine++; this.previews.clear(); this.cleanup.clear(); this.generations.clear(); for (const operation of this.active.values()) { operation.invalid = true; operation.sent = false; } }
  /** 等待原请求及原释放结算；失败保留并向退出协调器报告。 */
  async drain(): Promise<void> { this.observe(); while (this.active.size || this.cleanup.size) await Promise.all([...this.active.values()].map(value => value.done).concat([...this.cleanup].map(value => value.then(() => undefined)))); }
  private begin(taskId: string, owner: ColumnsInvocation, target: TableFilteredDeleteTarget, revision: number, rows = 0): Operation {
    if (this.active.has(taskId)) throw Error('全部筛选行删除任务编号已使用');
    this.runtime.available(target.connectionId);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Operation = { owner, target, revision, rows, generation: this.generation(target.connectionId), engine: this.engine, expires: Infinity, taskId, sent: false, invalid: false, done, finish, listeners: [] };
    this.assert(operation); this.active.set(taskId, operation);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) { const callback = () => this.check(operation); owner.owner.contents.on(event as 'destroyed', callback); operation.listeners.push({ event, callback }); }
    return operation;
  }
  private async waitStop(operation: Operation): Promise<void> { for (;;) { const stop = operation.stop; await stop; if (stop === operation.stop) return; } }
  /** 原数据库任务、原取消和原快照释放均已结算，才释放任务编号和监听器。 */
  private async finish(operation: Operation): Promise<void> {
    try { await this.waitStop(operation); }
    finally { for (const { event, callback } of operation.listeners) operation.owner.owner.contents.removeListener(event as 'destroyed', callback); if (this.active.get(operation.taskId) === operation) this.active.delete(operation.taskId); operation.finish(); }
  }

  /** 回证准确删除目标与完整条件摘要，再把原令牌交给同一文档。 */
  async preview(raw: TableFilteredDeletePreviewInput, owner: ColumnsInvocation): Promise<TableFilteredDeletePreviewOutput> {
    const input = tableFilteredDeletePreviewInputSchema.parse(raw); this.observe();
    if (this.previews.size + this.active.size >= limits.previews) throw Error(text.budget);
    const operation = this.begin(input.taskId, owner, { connectionId: input.connectionId, database: input.database, table: input.table }, this.runtime.revision());
    let returnedToken: string | undefined, success = false;
    try {
      this.assert(operation); operation.sent = true;
      const value = await this.runtime.run('table.filteredDelete.preview', input, operation.revision); operation.sent = false;
      // 只读取自身数据属性，畸形回执的 getter 不得因清理预判而执行。
      const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'previewToken') : undefined;
      const release = descriptor && 'value' in descriptor ? tableFilteredDeleteReleaseInputSchema.safeParse({ connectionId: input.connectionId, previewToken: descriptor.value }) : undefined;
      if (release?.success && !this.previews.has(release.data.previewToken)) returnedToken = release.data.previewToken;
      const result = tableFilteredDeletePreviewOutputSchema.parse(value), expected = operation.target, actual = result.target, now = this.time();
      if (actual.connectionId !== expected.connectionId || actual.database !== expected.database || actual.table !== expected.table || result.scopeDigest !== digest(tableFilteredDeleteScopeIdentity(input)) || result.shownRows > Math.min(result.rows, limits.shownRows) || result.sampleOmitted !== (result.shownRows < result.rows) || result.rows === 0 && result.sql !== '' || Date.parse(result.expiresAt) <= now || Date.parse(result.expiresAt) > now + limits.lifetimeMs || this.previews.has(result.previewToken)) throw Error(text.stale);
      this.check(operation); await this.waitStop(operation); this.assert(operation);
      if (operation.invalid || operation.stopFailure) throw operation.stopFailure ?? Error(text.stale);
      this.previews.set(result.previewToken, { ...operation, rows: result.rows, expires: Date.parse(result.expiresAt), receiptDigest: digest(JSON.stringify(result)) }); success = true; return result;
    } finally {
      operation.sent = false;
      try { if (!success && returnedToken) await this.queueRelease({ connectionId: input.connectionId, previewToken: returnedToken }, operation.engine); }
      finally { await this.finish(operation); }
    }
  }
  /** 最终 IPC 发布回证整份原预览，不能只凭相同 UUID 发布替换后的目标或条件。 */
  assertPublication(value: unknown, owner: ColumnsInvocation): void {
    const output = tableFilteredDeletePreviewOutputSchema.parse(value), binding = this.previews.get(output.previewToken);
    if (!binding || !this.runtime.same(binding.owner, owner) || binding.receiptDigest !== digest(JSON.stringify(output))) throw Error(text.stale);
    this.assert(binding); this.runtime.available(binding.target.connectionId);
  }
  /** 发布失败只回收本次原调用得到的令牌，不释放另一文档或另一用途的能力。 */
  async rejectPublication(value: unknown, owner: ColumnsInvocation): Promise<void> { const parsed = tableFilteredDeletePreviewOutputSchema.safeParse(value); if (!parsed.success) return; const binding = this.previews.get(parsed.data.previewToken); if (binding?.owner === owner) await this.drop(parsed.data.previewToken, binding); }
  /** 准确确认成功后单次消费；失败及未知回执均不会复活原删除令牌。 */
  async apply(raw: TableFilteredDeleteApplyInput, owner: ColumnsInvocation): Promise<TableFilteredDeleteApplyOutput> {
    const input = tableFilteredDeleteApplyInputSchema.parse(raw), binding = this.previews.get(input.previewToken);
    if (!binding || input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale);
    this.assert(binding); if (!binding.rows || input.confirmation !== tableFilteredDeleteConfirmation(binding)) throw Error('请准确确认原库表、删除用途及全部匹配行数');
    const operation = this.begin(input.taskId, owner, binding.target, binding.revision, binding.rows); this.previews.delete(input.previewToken);
    let committed = false;
    try {
      this.assert(operation); operation.sent = true;
      const result = tableFilteredDeleteApplyOutputSchema.parse(await this.runtime.run('table.filteredDelete.apply', input, binding.revision)); operation.sent = false;
      if (result.target.connectionId !== binding.target.connectionId || result.target.database !== binding.target.database || result.target.table !== binding.target.table || result.rows !== binding.rows) throw Error(text.unknown);
      // 真实 COMMIT 回执优先于迟到导航和取消；后续删除必须重新预览。
      committed = true; return result;
    } finally {
      operation.sent = false;
      try { await this.waitStop(operation); try { await this.queueRelease({ connectionId: input.connectionId, previewToken: input.previewToken }, operation.engine); } catch (error) { if (!committed) throw error; } }
      finally { await this.finish(operation); }
    }
  }
  /** 释放保持准确连接及同一文档约束，未知令牌只在本用途内幂等忽略。 */
  async release(raw: TableFilteredDeleteReleaseInput, owner: ColumnsInvocation): Promise<void> { const input = tableFilteredDeleteReleaseInputSchema.parse(raw), binding = this.previews.get(input.previewToken); this.runtime.assert(owner); if (!binding) return; if (input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale); await this.drop(input.previewToken, binding); }
  /** 原取消 ACK 不是完成证明；等待原请求及其释放责任后才返回。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> { const operation = this.active.get(taskId); this.runtime.assert(owner); if (!operation || !this.runtime.same(operation.owner, owner)) throw Error(text.stale); this.invalidate(operation); await operation.stop; await operation.done; if (operation.stopFailure) throw operation.stopFailure; }
}
