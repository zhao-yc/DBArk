import type { ColumnsInvocation } from './columnsMainCapabilities';
import { resultInsertApplyInputSchema, resultInsertApplyOutputSchema, resultInsertConfirmation, resultInsertLimits, resultInsertPreviewInputSchema, resultInsertPreviewOutputSchema, resultInsertReleaseInputSchema, resultInsertText as text } from '../shared/resultInsert';
import type { ResultInsertApplyInput, ResultInsertApplyOutput, ResultInsertPreviewInput, ResultInsertPreviewOutput, ResultInsertReleaseInput, ResultInsertTarget } from '../shared/resultInsert';

type RunInput = ResultInsertPreviewInput | ResultInsertApplyInput;
interface Runtime {
  assert(owner: ColumnsInvocation): void;
  same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number;
  closing(): boolean;
  available(connectionId: string): void;
  run(command: 'result.insertPreview' | 'result.insertApply', input: RunInput, revision: number): Promise<unknown>;
  release(input: ResultInsertReleaseInput): Promise<unknown>;
  stop(taskId: string): Promise<unknown>;
}
interface Binding { owner: ColumnsInvocation; revision: number; generation: object; engine: number; target: ResultInsertTarget; expires: number; rows: number; }
interface Operation extends Binding { taskId: string; sent: boolean; invalid: boolean; done: Promise<void>; finish(): void; stop?: Promise<void>; stopFailure?: unknown; listeners: { event: string; callback(): void }[]; }

/** 真实文档持有一次性写入能力；旧窗口、旧连接及迟到响应均不能复活预览。 */
export class ResultInsertOwners {
  private readonly previews = new Map<string, Binding>();
  private readonly active = new Map<string, Operation>();
  private readonly generations = new Map<string, object>();
  private readonly cleanup = new Set<Promise<unknown>>();
  private engine = 0;
  constructor(private readonly runtime: Runtime, private readonly now = Date.now) {}
  has(taskId: string): boolean { return this.active.has(taskId); }
  private generation(id: string): object { let value = this.generations.get(id); if (!value) this.generations.set(id, value = {}); return value; }
  private assert(binding: Binding): void {
    this.runtime.assert(binding.owner); this.runtime.available(binding.target.connectionId);
    if (this.runtime.closing() || binding.engine !== this.engine || binding.revision !== this.runtime.revision() || binding.generation !== this.generation(binding.target.connectionId) || binding.expires <= this.now()) throw Error(text.stale);
  }
  private queueRelease(input: ResultInsertReleaseInput, engine: number): Promise<unknown> {
    const pending = Promise.resolve().then(() => engine === this.engine ? this.runtime.release(input) : undefined); this.cleanup.add(pending);
    // 事件回调不能抛异常；失败保留在集合，显式drain仍能报告原始收尾失败。
    void pending.then(() => this.cleanup.delete(pending), () => undefined); return pending;
  }
  private drop(token: string, binding: Binding): Promise<unknown> {
    if (this.previews.get(token) === binding) this.previews.delete(token);
    return this.queueRelease({ connectionId: binding.target.connectionId, previewToken: token }, binding.engine);
  }
  private invalidate(operation: Operation): void {
    operation.invalid = true;
    if (operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.runtime.stop(operation.taskId)).then(() => undefined, error => { operation.stopFailure = error; });
  }
  private check(operation: Operation): void { try { this.assert(operation); } catch { this.invalidate(operation); } }
  /** 同步配置/导航观察只撤销原能力；不会启动替代任务或重放SQL。 */
  observe(): void {
    for (const operation of this.active.values()) this.check(operation);
    for (const [token, binding] of this.previews) { try { this.assert(binding); } catch { void this.drop(token, binding).catch(() => undefined); } }
  }
  /** 显式断开有独立代次，即使配置修订不变也不能恢复旧预览。 */
  invalidateConnection(id: string): void { this.generations.set(id, {}); this.observe(); }
  /** 工具进程退出后能力直接失效；不向替代进程发送旧release或cancel。 */
  engineExited(): void { this.engine++; this.previews.clear(); this.cleanup.clear(); for (const operation of this.active.values()) { operation.invalid = true; operation.sent = false; } this.generations.clear(); }
  async drain(): Promise<void> { this.observe(); while (this.cleanup.size) await Promise.all([...this.cleanup]); }
  private begin(taskId: string, owner: ColumnsInvocation, target: ResultInsertTarget, revision: number): Operation {
    if (this.active.has(taskId)) throw Error('结果写入任务编号已使用');
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const operation: Operation = { owner, target, revision, generation: this.generation(target.connectionId), engine: this.engine, expires: Infinity, rows: 0, taskId, sent: false, invalid: false, done, finish, listeners: [] };
    this.assert(operation); this.active.set(taskId, operation);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) {
      const callback = () => this.check(operation); owner.owner.contents.on(event as 'destroyed', callback); operation.listeners.push({ event, callback });
    }
    return operation;
  }
  private async settle(operation: Operation): Promise<void> {
    for (;;) { const stop = operation.stop; await stop; if (stop === operation.stop) break; }
    for (const { event, callback } of operation.listeners) operation.owner.owner.contents.removeListener(event as 'destroyed', callback);
    if (this.active.get(operation.taskId) === operation) this.active.delete(operation.taskId);
    operation.finish();
  }
  /** 预览只存归属及计数；真实行数据只由有预算的引擎缓存保管。 */
  async preview(raw: ResultInsertPreviewInput, owner: ColumnsInvocation): Promise<ResultInsertPreviewOutput> {
    const input = resultInsertPreviewInputSchema.parse(raw); this.observe();
    if (this.previews.size + this.active.size >= resultInsertLimits.previews) throw Error(text.budget);
    const operation = this.begin(input.taskId, owner, { connectionId: input.connectionId, database: input.database, table: input.table }, this.runtime.revision());
    let result: ResultInsertPreviewOutput | undefined, returnedToken: string | undefined, success = false;
    try {
      this.assert(operation); operation.sent = true;
      const value = await this.runtime.run('result.insertPreview', input, operation.revision);
      // 即使其余输出损坏，也只能回收此次实际返回的精确UUID，不能清空其它窗口能力。
      if (value && typeof value === 'object' && 'previewToken' in value && typeof value.previewToken === 'string' && /^[a-f0-9-]{36}$/i.test(value.previewToken) && !this.previews.has(value.previewToken)) returnedToken = value.previewToken;
      result = resultInsertPreviewOutputSchema.parse(value);
      const expected = operation.target, actual = result.target;
      if (actual.connectionId !== expected.connectionId || actual.database !== expected.database || actual.table !== expected.table || result.rows !== input.data.rows.length || result.sourceTruncated !== input.data.truncated || result.timeZone !== input.timeZone || JSON.stringify(result.mapping) !== JSON.stringify(input.mapping) || Date.parse(result.expiresAt) <= this.now() || Date.parse(result.expiresAt) > this.now() + resultInsertLimits.lifetimeMs || Buffer.byteLength(result.sql) > resultInsertLimits.previewSqlBytes || result.shownRows > Math.min(result.rows, resultInsertLimits.shownRows) || this.previews.has(result.previewToken)) throw Error(text.stale);
      this.check(operation); await this.settle(operation); this.assert(operation);
      if (operation.invalid || operation.stopFailure) throw operation.stopFailure ?? Error(text.stale);
      this.previews.set(result.previewToken, { ...operation, expires: Date.parse(result.expiresAt), rows: result.rows }); success = true; return result;
    } finally {
      await this.settle(operation);
      if (!success && returnedToken) await this.queueRelease({ connectionId: input.connectionId, previewToken: returnedToken }, operation.engine);
    }
  }
  /** IPC发布前最后同步重核；下一次await之前不得交付旧能力。 */
  assertPublication(value: unknown, owner: ColumnsInvocation): void {
    const output = resultInsertPreviewOutputSchema.parse(value), binding = this.previews.get(output.previewToken);
    if (!binding || !this.runtime.same(binding.owner, owner)) throw Error(text.stale);
    this.assert(binding);
  }
  async rejectPublication(value: unknown, owner: ColumnsInvocation): Promise<void> {
    const parsed = resultInsertPreviewOutputSchema.safeParse(value); if (!parsed.success) return;
    const binding = this.previews.get(parsed.data.previewToken);
    // 最后发布失败时原文档可能已经失效；只认此调用的原私有对象，不能要求旧文档仍有效才回收。
    if (binding && binding.owner === owner) await this.drop(parsed.data.previewToken, binding);
  }
  /** 应用在首个await前消费令牌，目标只能从原预览取得。 */
  async apply(raw: ResultInsertApplyInput, owner: ColumnsInvocation): Promise<ResultInsertApplyOutput> {
    const input = resultInsertApplyInputSchema.parse(raw), binding = this.previews.get(input.previewToken);
    if (!binding || input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale);
    this.assert(binding);
    if (input.confirmation !== resultInsertConfirmation(binding.target)) throw Error('请准确输入目标库名.表名');
    const operation = this.begin(input.taskId, owner, binding.target, binding.revision); this.previews.delete(input.previewToken);
    let committed = false;
    try {
      this.assert(operation); operation.sent = true;
      const result = resultInsertApplyOutputSchema.parse(await this.runtime.run('result.insertApply', input, binding.revision));
      if (result.target.connectionId !== binding.target.connectionId || result.target.database !== binding.target.database || result.target.table !== binding.target.table || result.rows !== binding.rows) throw Error(text.unknown);
      // 已知COMMIT优先于晚导航/取消；不能诱导重新插入同一批。
      committed = true;
      return result;
    } finally {
      await this.settle(operation);
      try { await this.queueRelease({ connectionId: input.connectionId, previewToken: input.previewToken }, operation.engine); }
      catch (error) { if (!committed) throw error; /* 真实提交不能被迟到release异常改报为未插入；drain保留收尾失败。 */ }
    }
  }
  async release(raw: ResultInsertReleaseInput, owner: ColumnsInvocation): Promise<void> {
    const input = resultInsertReleaseInputSchema.parse(raw), binding = this.previews.get(input.previewToken);
    this.runtime.assert(owner);
    if (!binding) return;
    if (input.connectionId !== binding.target.connectionId || !this.runtime.same(binding.owner, owner)) throw Error(text.stale);
    await this.drop(input.previewToken, binding);
  }
  /** 取消仅作用于同一真实文档的原任务，等原任务的数据库资源收尾。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> {
    const operation = this.active.get(taskId); this.runtime.assert(owner);
    if (!operation || !this.runtime.same(operation.owner, owner)) throw Error(text.stale);
    this.invalidate(operation); await operation.stop; await operation.done;
    if (operation.stopFailure) throw operation.stopFailure;
  }
}
