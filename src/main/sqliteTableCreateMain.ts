import { createHash, randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import { assertSqliteTableCreateFactTransition, buildSqliteTableCreate, sqliteTableCreateApplySchema, sqliteTableCreateFactSchema, sqliteTableCreateLimits as limits, sqliteTableCreateMessages as text, sqliteTableCreateOutcomeSchema, sqliteTableCreatePreviewSchema, sqliteTableCreateReleaseSchema, type SqliteTableCreateApplyInput, type SqliteTableCreateFact, type SqliteTableCreateOutcome, type SqliteTableCreatePreviewInput, type SqliteTableCreatePreviewOutput, type SqliteTableCreateTarget } from '../shared/sqliteTableCreate';
import { sqliteCreateFactMessage } from '../shared/sqliteTableCreateFact';

interface Ports {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean;
  profile(id: string): SqliteConnectionProfile | undefined;
  request(command: string, input: unknown): Promise<unknown>;
  task(id: string): TaskRecord | undefined; replace(task: TaskRecord): void; save(task: TaskRecord): void;
  event(event: TaskEvent): void;
}
interface Source { owner: ColumnsInvocation; revision: number; epoch: object; profile: string; target: SqliteTableCreateTarget; expires: number; expected?: { fingerprint: string; statements: number }; cancelled?(): boolean; }
interface Preview extends Source { id: string; statements: number; }
interface Operation { owner: ColumnsInvocation; cancelled: boolean; sent: boolean; check(): void; stop?: Promise<void>; settled: Promise<void>; settle(): void; }
/** 摘要只比较来源，不把路径或完整SQL复制到Main预览表。 */
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileKey = (profile: SqliteConnectionProfile) => fingerprint([profile.id, profile.sqlite.filePath, profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs, profile.pendingFiles]);
const sameTarget = (left: SqliteTableCreateTarget, right: SqliteTableCreateTarget) => left.connectionId === right.connectionId && left.database === right.database && left.table === right.table;

/** Main只持有来源和最小回执，真实SQL与物理资源仍在原SQLite运行时；不建立第二套连接池。 */
export class SqliteTableCreateMain {
  private readonly previews = new Map<string, Preview>();
  private readonly operations = new Map<string, Operation>();
  private readonly watched = new WeakSet<object>();
  constructor(private readonly ports: Ports) {}

  /** 连接ABA、原文档导航和目录生命周期都不能继承旧预览。 */
  private valid(source: Source): void {
    this.ports.assert(source.owner); this.ports.available(source.target.connectionId);
    const profile = this.ports.profile(source.target.connectionId);
    if (this.ports.closing() || source.cancelled?.() || source.expires <= Date.now() || source.revision !== this.ports.revision() || source.epoch !== this.ports.epoch(source.target.connectionId) || !profile || profile.pendingFiles?.length || !profile.sqlite.filePath || profileKey(profile) !== source.profile) throw Error(text.stale);
  }
  /** 同一webContents只监听一次；导航或销毁立即检查旧来源。 */
  private watch(owner: ColumnsInvocation): void {
    const contents = owner.owner.contents; if (this.watched.has(contents)) return; this.watched.add(contents);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) contents.on(event as 'destroyed', () => this.observe());
  }
  /** 失效预览只撤销自己的元数据能力；不会向新文档移交，也不取消已消费的写任务。 */
  private discard(preview: Preview): Promise<void> {
    if (this.previews.get(preview.id) !== preview) return Promise.resolve();
    this.previews.delete(preview.id);
    return this.ports.request('sqlite.tableCreate.release', { previewId: preview.id }).then(() => {});
  }
  /** 先同步撤权，再异步回收准确预览或取消自己的任务。 */
  observe(): void {
    for (const preview of this.previews.values()) try { this.valid(preview); } catch { void this.discard(preview).catch(() => {}); }
    for (const [id, operation] of this.operations) try { operation.check(); } catch { void this.stop(id, operation).catch(() => {}); }
  }
  /** 草稿和默认值不留在Main能力表，只保准确目标及有界SQL摘要。 */
  private source(owner: ColumnsInvocation, input: SqliteTableCreatePreviewInput): Source {
    this.watch(owner); this.observe(); this.ports.assert(owner); this.ports.available(input.connectionId);
    const profile = this.ports.profile(input.connectionId);
    if (!profile || profile.pendingFiles?.length || !profile.sqlite.filePath) throw Error('请先保存并授权准确SQLite文件连接');
    const plan = 'design' in input ? buildSqliteTableCreate(input.design) : undefined;
    const table = 'design' in input ? input.design.name : input.copy.name;
    const source: Source = { owner, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), profile: profileKey(profile), target: { connectionId: input.connectionId, database: 'main', table }, expires: Date.now() + limits.previewLifetimeMs,
      expected: plan && { fingerprint: fingerprint(plan.sql), statements: plan.sql.length } };
    this.valid(source); return source;
  }
  /** 首个await之前占住任务编号，取消和退出始终指向原操作。 */
  private operation(owner: ColumnsInvocation, taskId: string, check: () => void): Operation {
    if (this.ports.task(taskId) || this.operations.has(taskId) || this.operations.size >= limits.previews) throw Error('SQLite建表任务编号已经使用或操作繁忙');
    let settle!: () => void;
    const operation: Operation = { owner, cancelled: false, sent: false, check: () => { this.ports.assert(owner); if (operation.cancelled || this.ports.closing()) throw Error('SQLite原建表操作已取消或正在退出'); check(); }, settled: new Promise<void>(resolve => { settle = resolve; }), settle: () => settle() };
    operation.check(); this.operations.set(taskId, operation); return operation;
  }
  /** 投递前保存脱敏概要，存储失败不能开始原生写入。 */
  private startTask(taskId: string, command: string): void {
    const record: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: command.endsWith('.preview') ? '正在只读准备SQLite建表预览；设计、SQL和默认值不保存到任务概要。' : text.running, startedAt: new Date().toISOString() };
    this.ports.replace(record); this.ports.save(record);
  }
  /** 取消应答与原请求均完成后才解除Main占用。 */
  private async finish(taskId: string, operation: Operation): Promise<void> {
    try { await operation.stop; }
    finally { if (this.operations.get(taskId) === operation) this.operations.delete(taskId); operation.settle(); }
  }
  /** 每个原操作只投递一次取消，不把取消应答当作回滚证明。 */
  private stop(taskId: string, operation: Operation): Promise<void> {
    operation.cancelled = true;
    if (!operation.stop) operation.stop = operation.sent ? this.ports.request('query.cancel', { taskId }).then(() => {}) : Promise.resolve();
    void operation.stop.catch(() => {}); return operation.stop;
  }
  /** 给公开取消入口做精确归属检查，不因taskId名称推断来源。 */
  owns(taskId: string): boolean { return this.operations.has(taskId); }
  /** 取消只允许本原文档，不能因taskId可见就取消另一来源的事务。 */
  async cancel(owner: ColumnsInvocation, taskId: string): Promise<void> {
    this.ports.assert(owner); const operation = this.operations.get(taskId);
    if (!operation || !this.ports.same(operation.owner, owner)) throw Error(text.stale);
    await this.stop(taskId, operation);
  }
  /** 退出先等本Main请求真实settled；私有物理进程最终仍由原broker.close/forceClose核账。 */
  async drain(): Promise<void> {
    const operations = [...this.operations.entries()];
    await Promise.allSettled([...this.previews.values()].map(preview => this.discard(preview)));
    await Promise.allSettled(operations.map(([id, operation]) => this.stop(id, operation)));
    await Promise.all(operations.map(([, operation]) => operation.settled));
  }
  /** 释放不要求目标仍可写，但只能回收本原文档签发的能力。 */
  async release(owner: ColumnsInvocation, previewId: string): Promise<void> {
    this.ports.assert(owner); const preview = this.previews.get(previewId);
    if (!preview) return;
    if (!this.ports.same(preview.owner, owner)) throw Error(text.stale);
    await this.discard(preview);
  }
  /** 目标、完整SQL摘要、数量和期限全部匹配后才签发Main能力。 */
  private accept(source: Source, value: unknown): SqliteTableCreatePreviewOutput {
    this.valid(source); const preview = value as SqliteTableCreatePreviewOutput;
    const expires = Date.parse(preview?.expiresAt);
    if (!preview || typeof preview.previewId !== 'string' || !preview.previewId || preview.previewId.length > 200 || this.previews.has(preview.previewId) || this.previews.size >= limits.previews || !preview.target || !sameTarget(preview.target, source.target) || !Number.isFinite(expires) || expires <= Date.now() || expires > source.expires + 5000 || preview.confirmation !== `main.${source.target.table}` || !Array.isArray(preview.sql) || preview.sql.length < 1 || preview.sql.length > limits.statements || preview.sql.some(statement => typeof statement !== 'string' || !statement || statement.includes('\0')) || !Array.isArray(preview.warnings) || preview.warnings.length > 64 || preview.warnings.some(item => typeof item !== 'string' || item.length > 4096)) throw Error(text.stale);
    // 复制 SQL 来自同一 Main 内的运行时目录，表单创建仍需与预编译摘要逐字匹配。
    if (source.expected && (preview.sql.length !== source.expected.statements || fingerprint(preview.sql) !== source.expected.fingerprint)) throw Error(text.stale);
    const binding: Preview = { ...source, id: preview.previewId, statements: preview.sql.length, expires: Math.min(source.expires, expires) }; this.previews.set(binding.id, binding);
    return { ...preview, expiresAt: new Date(binding.expires).toISOString() };
  }
  /** 只读请求的迟到回包必须释放，不能交给后继连接或文档。 */
  private async preview(owner: ColumnsInvocation, input: SqliteTableCreatePreviewInput): Promise<SqliteTableCreatePreviewOutput> {
    const source = this.source(owner, input), operation = this.operation(owner, input.taskId, () => this.valid(source));
    source.cancelled = () => operation.cancelled;
    let output: SqliteTableCreatePreviewOutput | undefined, accepted = false;
    try {
      this.startTask(input.taskId, 'sqlite.tableCreate.preview'); operation.check(); operation.sent = true;
      output = await this.ports.request('sqlite.tableCreate.preview', { ...input, assertCurrent: operation.check }) as SqliteTableCreatePreviewOutput;
      operation.check(); const result = this.accept(source, output); accepted = true;
      this.ports.event({ taskId: input.taskId, status: 'completed', progress: 100, message: 'SQLite建表预览已生成，尚未写入；设计和SQL不保存到任务概要。' });
      return result;
    } catch (reason) {
      if (accepted && output?.previewId) { const binding = this.previews.get(output.previewId); if (binding) await this.discard(binding).catch(() => {}); }
      else if (output?.previewId && !this.previews.has(output.previewId)) await this.ports.request('sqlite.tableCreate.release', { previewId: output.previewId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: 'SQLite建表预览未交付，尚未创建新表。' }); throw reason;
    } finally { await this.finish(input.taskId, operation); }
  }
  /** 真实随机operationId和同步持久化回调仅Main注入，公开IPC不能自带这些能力。 */
  private record(taskId: string, operationId: string, source: Preview, value: SqliteTableCreateFact): void {
    const fact = sqliteTableCreateFactSchema.parse(value), current = this.ports.task(taskId);
    if (!current || current.kind !== 'sqlite.tableCreate.apply' || fact.operationId !== operationId || !sameTarget(fact.target, source.target) || fact.requestedStatements !== source.statements) throw Error('SQLite建表回执不属于原操作');
    if (current.sqliteCreate) assertSqliteTableCreateFactTransition(current.sqliteCreate, fact);
    const next: TaskRecord = { ...current, sqliteCreate: fact, message: sqliteCreateFactMessage(fact), ...(fact.commitAcknowledged ? { status: 'completed', progress: 100, finishedAt: new Date().toISOString() } : {}) };
    this.ports.replace(next);
    // 后续DDL计数只更新内存；每个阶段及COMMIT/ROLLBACK边界必须同步落盘。
    if (current.sqliteCreate?.phase !== 'writing' || fact.phase !== 'writing') this.ports.save(next);
    this.ports.event({ taskId, status: next.status, progress: next.progress, message: next.message });
  }
  /** 对照Main已记录的原随机操作，不用回包本身补造提交ACK。 */
  private outcome(taskId: string, operationId: string, value: unknown): SqliteTableCreateOutcome {
    const outcome = sqliteTableCreateOutcomeSchema.parse(value), recorded = this.ports.task(taskId)?.sqliteCreate;
    if (!recorded || outcome.operationId !== operationId || fingerprint(outcome.fact) !== fingerprint(sqliteTableCreateFactSchema.parse(recorded))) throw Error(text.unknown);
    return outcome;
  }
  /** 单次消费后显式投递；任何异常都保留最强已确认事实而不重放DDL。 */
  private async apply(owner: ColumnsInvocation, input: SqliteTableCreateApplyInput): Promise<SqliteTableCreateOutcome> {
    this.ports.assert(owner); const source = this.previews.get(input.previewId);
    if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale);
    this.valid(source);
    const operation = this.operation(owner, input.taskId, () => this.valid(source)), operationId = randomUUID();
    this.previews.delete(source.id);
    let result: SqliteTableCreateOutcome | undefined;
    try {
      this.startTask(input.taskId, 'sqlite.tableCreate.apply');
      this.record(input.taskId, operationId, source, { operationId, target: source.target, phase: 'not-sent', requestedStatements: source.statements, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false });
      if (this.ports.profile(source.target.connectionId)?.sqlite.readOnly) throw Error('SQLite连接为只读，不能创建表；原设计保留');
      if (input.confirmation !== `main.${source.target.table}`) throw Error('准确库.表名确认不匹配；原预览已消费，建表尚未发送，请重新预览');
      operation.check(); operation.sent = true;
      const value = await this.ports.request('sqlite.tableCreate.apply', { ...input, operationId, recordCreateFact: (fact: SqliteTableCreateFact) => this.record(input.taskId, operationId, source, fact), assertCurrent: operation.check });
      result = this.outcome(input.taskId, operationId, value);
    } catch (reason) {
      let fact = this.ports.task(input.taskId)?.sqliteCreate;
      if (!fact) { this.ports.event({ taskId: input.taskId, status: 'failed', progress: 0, message: text.notSent }); throw reason; }
      if (operation.sent && !fact.commitAcknowledged && !fact.rollbackAcknowledged) {
        try { this.record(input.taskId, operationId, source, { ...fact, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false }); } catch { /* 可信内存事实仍保留；磁盘错误不触发重放。 */ }
        fact = this.ports.task(input.taskId)?.sqliteCreate ?? fact;
      }
      result = { operationId, target: source.target, outcome: fact.commitAcknowledged ? 'committed' : fact.rollbackAcknowledged ? 'rolled-back' : operation.sent ? 'unknown' : 'not-sent', fact, definitionVerified: false, cleanupWarning: true, message: !operation.sent && reason instanceof Error ? reason.message : sqliteCreateFactMessage(fact) };
    } finally {
      await this.ports.request('sqlite.tableCreate.release', { previewId: source.id }).catch(() => {});
      try { await this.finish(input.taskId, operation); } catch { if (result) result = { ...result, cleanupWarning: true }; }
    }
    if (!result) throw Error(text.unknown);
    this.ports.event({ taskId: input.taskId, status: result.fact.commitAcknowledged ? 'completed' : operation.cancelled && result.outcome !== 'unknown' ? 'cancelled' : 'failed', progress: result.fact.commitAcknowledged ? 100 : 0, message: sqliteCreateFactMessage(result.fact) });
    return result;
  }
  /** 真正发送IPC回包前再同步核原能力，封住取消和连接换代的最后窗口。 */
  assertPublication(owner: ColumnsInvocation, value: unknown): void {
    const id = (value as SqliteTableCreatePreviewOutput | undefined)?.previewId, preview = typeof id === 'string' ? this.previews.get(id) : undefined;
    if (!preview || !this.ports.same(preview.owner, owner)) throw Error(text.stale);
    try { this.valid(preview); }
    catch (reason) { void this.discard(preview).catch(() => {}); throw reason; }
  }
  /** 公共参数重验，防止内部调用者绕开原IPC门。 */
  async request(owner: ColumnsInvocation, command: string, input: unknown): Promise<unknown> {
    switch (command) {
      case 'sqlite.tableCreate.preview': return this.preview(owner, sqliteTableCreatePreviewSchema.parse(input));
      case 'sqlite.tableCreate.apply': return this.apply(owner, sqliteTableCreateApplySchema.parse(input));
      case 'sqlite.tableCreate.release': return this.release(owner, sqliteTableCreateReleaseSchema.parse(input).previewId);
      default: throw Error('SQLite建表命令未声明');
    }
  }
}
