import { createHash, randomUUID } from 'node:crypto';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import { getSqliteObjectsAcknowledgements, parseSqliteObjectsCreateHeader, assertSqliteObjectsAcknowledgements, assertSqliteObjectsFactTransition, buildSqliteObjectsPlan, sqliteObjectsInspectSchema, sqliteObjectsInspectionSchema, sqliteObjectsPreviewSchema, sqliteObjectsPreviewOutputSchema, sqliteObjectsApplySchema, sqliteObjectsReleaseSchema, sqliteObjectsFactSchema, sqliteObjectsOutcomeSchema, sqliteObjectsLimits as limits, sqliteObjectsMessages as text, type SqliteObjectsAction, type SqliteObjectsAcknowledgement, type SqliteObjectsTarget, type SqliteObjectsInspectInput, type SqliteObjectsInspectOutput, type SqliteObjectsPreviewInput, type SqliteObjectsPreviewOutput, type SqliteObjectsApplyInput, type SqliteObjectsReleaseInput, type SqliteObjectsFact, type SqliteObjectsOutcome } from '../shared/sqliteObjects';
import { sqliteObjectsFactMessage, sqliteObjectsTaskMessage } from '../shared/sqliteObjectsFact';

interface Ports {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean;
  profile(id: string): SqliteConnectionProfile | undefined; request(command: string, input: unknown): Promise<unknown>;
  task(id: string): TaskRecord | undefined; replace(task: TaskRecord): void; save(task: TaskRecord): void; event(event: TaskEvent): void;
}
interface Source { owner: ColumnsInvocation; revision: number; epoch: object; profile: string; target: SqliteObjectsTarget; action: SqliteObjectsAction; expires: number; revoked: boolean; cancelled?(): boolean; }
interface Catalogue extends Source { id: string; attachedTriggers: { name: string; digest: string }[]; }
interface Preview extends Source { id: string; catalogueId: string; statements: number; confirmation: string; requiredAcknowledgements: SqliteObjectsAcknowledgement[]; attachedTriggerCount: number; }
interface Operation { owner: ColumnsInvocation; catalogue?: Catalogue; cancelled: boolean; sent: boolean; check(): void; stop?: Promise<void>; settled: Promise<void>; settle(): void; }
/** Main仅保存原附属触发器名称及定义摘要，SQL正文不随任务或能力元数据持久化。 */
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileKey = (profile: SqliteConnectionProfile) => digest([profile.id, profile.sqlite.filePath, profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs, profile.pendingFiles]);
const sameTarget = (left: SqliteObjectsTarget, right: SqliteObjectsTarget) => left.connectionId === right.connectionId && left.database === right.database && left.kind === right.kind && left.name === right.name;

/** 对象目录、预览和真实对象DDL回执归原文档，连接及utility继续由原SQLite账本管理。 */
export class SqliteObjectsMain {
  private readonly catalogues = new Map<string, Catalogue>();
  private readonly previews = new Map<string, Preview>();
  private readonly operations = new Map<string, Operation>();
  private readonly watched = new WeakSet<object>();
  private readonly publications = new WeakMap<object, { owner: ColumnsInvocation; check(): void }>();
  constructor(private readonly ports: Ports) {}

  /** TTL只限制新领取，原任务仍持续核文档、连接修订、物理连接代次及明确撤权。 */
  private valid(source: Source, claimed = false): void {
    this.ports.assert(source.owner); this.ports.available(source.target.connectionId);
    const profile = this.ports.profile(source.target.connectionId);
    if (this.ports.closing() || source.revoked || source.cancelled?.() || !claimed && source.expires <= Date.now() || source.revision !== this.ports.revision() || source.epoch !== this.ports.epoch(source.target.connectionId) || !profile || profile.pendingFiles?.length || !profile.sqlite.filePath || profileKey(profile) !== source.profile) throw Error(text.stale);
  }
  /** 同一窗口只监听一次；原文档导航、销毁均不移交旧对象定义权限。 */
  private watch(owner: ColumnsInvocation): void {
    const contents = owner.owner.contents; if (this.watched.has(contents)) return; this.watched.add(contents);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) contents.on(event as 'destroyed', () => this.observe());
  }
  /** 明确释放同步撤权，只取消在途只读预检，不假取消已领取writer。 */
  private discard(kind: 'catalogue' | 'preview', source: Catalogue | Preview): Promise<void> {
    const map = kind === 'catalogue' ? this.catalogues : this.previews;
    if (map.get(source.id) !== source) return Promise.resolve(); source.revoked = true; map.delete(source.id);
    if (kind === 'catalogue') {
      for (const preview of this.previews.values()) if (preview.catalogueId === source.id) { preview.revoked = true; this.previews.delete(preview.id); }
      for (const [id, operation] of this.operations) if (operation.catalogue === source) void this.stop(id, operation).catch(() => {});
    }
    return this.ports.request('sqlite.objects.release', { [kind === 'catalogue' ? 'catalogueId' : 'previewId']: source.id }).then(() => {});
  }
  /** 自然过期保在途parent归属至settle，已发表子预览拥有独立期限。 */
  observe(): void {
    for (const [kind, map] of [['catalogue', this.catalogues], ['preview', this.previews]] as const) for (const source of map.values()) {
      if (source.expires <= Date.now()) { if (kind !== 'catalogue' || ![...this.operations.values()].some(operation => operation.catalogue === source)) map.delete(source.id); continue; }
      try { this.valid(source); } catch { void this.discard(kind, source).catch(() => {}); }
    }
    for (const [id, operation] of this.operations) try { operation.check(); } catch { void this.stop(id, operation).catch(() => {}); }
  }
  /** 最初目录只捕获明确保存的main目标，不建立查询会话。 */
  private source(owner: ColumnsInvocation, input: SqliteObjectsInspectInput): Source {
    this.watch(owner); this.observe(); this.ports.assert(owner); this.ports.available(input.connectionId);
    const profile = this.ports.profile(input.connectionId); if (!profile || profile.pendingFiles?.length || !profile.sqlite.filePath) throw Error('请先保存并授权准确SQLite文件连接');
    const source: Source = { owner, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), profile: profileKey(profile), target: { connectionId: input.connectionId, database: 'main', kind: input.kind, name: input.name }, action: input.action, expires: Infinity, revoked: false };
    this.valid(source); return source;
  }
  /** 首个await前独占编号，所有终态和取消均指向同一次请求。 */
  private operation(owner: ColumnsInvocation, id: string, check: () => void): Operation {
    if (this.ports.task(id) || this.operations.has(id) || this.operations.size >= limits.previews) throw Error('SQLite对象定义任务编号已使用或操作繁忙');
    let settle!: () => void; const operation: Operation = { owner, cancelled: false, sent: false, check: () => { this.ports.assert(owner); if (operation.cancelled || this.ports.closing()) throw Error(text.stale); check(); }, settled: new Promise<void>(resolve => { settle = resolve; }), settle: () => settle() };
    operation.check(); this.operations.set(id, operation); return operation;
  }
  /** 首次概要落盘成功后才允许读取或发送对象DDL。 */
  private start(id: string, kind: string): void {
    const task: TaskRecord = { id, kind, status: 'running', progress: 0, message: sqliteObjectsTaskMessage(kind, 'running'), startedAt: new Date().toISOString() };
    this.ports.replace(task); this.ports.save(task);
  }
  /** 每个原操作仅发送一次取消，并观察准确取消应答。 */
  private stop(id: string, operation: Operation): Promise<void> {
    operation.cancelled = true; operation.stop ??= operation.sent ? this.ports.request('query.cancel', { taskId: id }).then(() => {}) : Promise.resolve();
    void operation.stop.catch(() => {}); return operation.stop;
  }
  /** 原请求和取消应答结束后才解除占用及过期只读parent强引用。 */
  private async finish(id: string, operation: Operation): Promise<void> {
    try { await operation.stop; } finally {
      if (this.operations.get(id) === operation) this.operations.delete(id); const catalogue = operation.catalogue;
      if (catalogue && catalogue.expires <= Date.now() && this.catalogues.get(catalogue.id) === catalogue && ![...this.operations.values()].some(value => value.catalogue === catalogue)) this.catalogues.delete(catalogue.id);
      operation.settle();
    }
  }
  /** 公开取消的类别只能来自本Main登记，不能仅凭编号猜测。 */
  owns(id: string): boolean { return this.operations.has(id); }
  /** 同一原文档才可取消，不触碰其它标签或后继文档。 */
  async cancel(owner: ColumnsInvocation, id: string): Promise<void> {
    this.ports.assert(owner); const operation = this.operations.get(id); if (!operation || !this.ports.same(owner, operation.owner)) throw Error(text.stale); await this.stop(id, operation);
  }
  /** 退出等待本Main所有原承诺，底层进程由原broker收尾。 */
  async drain(): Promise<void> {
    const operations = [...this.operations];
    await Promise.allSettled([...this.catalogues.values()].map(source => this.discard('catalogue', source)).concat([...this.previews.values()].map(source => this.discard('preview', source))));
    await Promise.allSettled(operations.map(([id, operation]) => this.stop(id, operation))); await Promise.all(operations.map(([, operation]) => operation.settled));
  }
  /** 两个编号及全部子能力先整组核归属，避免半释放另一文档。 */
  private async release(owner: ColumnsInvocation, input: SqliteObjectsReleaseInput): Promise<void> {
    this.ports.assert(owner); const catalogue = input.catalogueId ? this.catalogues.get(input.catalogueId) : undefined, preview = input.previewId ? this.previews.get(input.previewId) : undefined;
    const children = input.catalogueId ? [...this.previews.values()].filter(value => value.catalogueId === input.catalogueId) : [];
    for (const source of [catalogue, preview, ...children]) if (source && !this.ports.same(source.owner, owner)) throw Error(text.stale);
    await Promise.all([catalogue ? this.discard('catalogue', catalogue) : Promise.all(children.map(source => this.discard('preview', source))), preview ? this.discard('preview', preview) : undefined]);
  }
  /** 目录结果只在原身份和有界合同仍有效时签发Main能力。 */
  private async inspect(owner: ColumnsInvocation, input: SqliteObjectsInspectInput): Promise<SqliteObjectsInspectOutput> {
    const source = this.source(owner, input), operation = this.operation(owner, input.taskId, () => this.valid(source, true)); source.cancelled = () => operation.cancelled;
    let accepted: Catalogue | undefined, receivedId: string | undefined;
    try {
      this.start(input.taskId, 'sqlite.objects.inspect'); operation.check(); operation.sent = true;
      const received = await this.ports.request('sqlite.objects.inspect', { ...input, assertCurrent: operation.check }), id = (received as { catalogueId?: unknown } | undefined)?.catalogueId;
      if (typeof id === 'string' && id.length > 0 && id.length <= 200) receivedId = id;
      const output = sqliteObjectsInspectionSchema.parse(received); operation.check(); const expires = Date.parse(output.expiresAt);
      if (!sameTarget(source.target, output.target) || output.action !== source.action || output.readOnly !== this.ports.profile(source.target.connectionId)?.sqlite.readOnly || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.catalogueLifetimeMs + 5000 || this.catalogues.has(output.catalogueId) || this.catalogues.size >= limits.catalogues) throw Error(text.stale);
      accepted = { ...source, id: output.catalogueId, attachedTriggers: output.attachedTriggers.map(trigger => ({ name: trigger.name, digest: digest(trigger.sql) })), expires }; this.catalogues.set(accepted.id, accepted); this.publications.set(output, { owner, check: operation.check });
      this.ports.event({ taskId: input.taskId, status: 'completed', progress: 100, message: sqliteObjectsTaskMessage('sqlite.objects.inspect', 'completed') }); return output;
    } catch (reason) {
      if (accepted) await this.discard('catalogue', accepted).catch(() => {}); else if (receivedId && !this.catalogues.has(receivedId)) await this.ports.request('sqlite.objects.release', { catalogueId: receivedId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: sqliteObjectsTaskMessage('sqlite.objects.inspect', 'failed') }); throw reason;
    } finally { await this.finish(input.taskId, operation); }
  }
  /** 只接受准确原目录及同一编译计划，对象DDL只返回当前文档，永不进入任务概要。 */
  private async preview(owner: ColumnsInvocation, input: SqliteObjectsPreviewInput): Promise<SqliteObjectsPreviewOutput> {
    this.ports.assert(owner); const source = this.catalogues.get(input.catalogueId); if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale); this.valid(source);
    const plan = buildSqliteObjectsPlan(source.target, source.action, input.sql), restored = source.action === 'replace' && source.target.kind === 'view' ? source.attachedTriggers : [], requiredAcknowledgements = getSqliteObjectsAcknowledgements(source.target, source.action, source.attachedTriggers.length), operation = this.operation(owner, input.taskId, () => this.valid(source, true)); operation.catalogue = source;
    let accepted: Preview | undefined, receivedId: string | undefined;
    try {
      this.start(input.taskId, 'sqlite.objects.preview'); operation.check(); operation.sent = true;
      const received = await this.ports.request('sqlite.objects.preview', { ...input, assertCurrent: operation.check }), id = (received as { previewId?: unknown } | undefined)?.previewId;
      if (typeof id === 'string' && id.length > 0 && id.length <= 200) receivedId = id;
      const output = sqliteObjectsPreviewOutputSchema.parse(received); operation.check(); const expires = Date.parse(output.expiresAt);
      if (output.catalogueId !== source.id || !sameTarget(output.target, source.target) || output.sql.length !== plan.sql.length + restored.length || plan.sql.some((sql, index) => digest(output.sql[index]) !== digest(sql)) || restored.some((trigger, index) => { const sql = output.sql[plan.sql.length + index], header = parseSqliteObjectsCreateHeader(sql); return digest(sql) !== trigger.digest || header.kind !== 'trigger' || header.name !== trigger.name; }) || output.action !== source.action || output.attachedTriggerCount !== source.attachedTriggers.length || digest(output.requiredAcknowledgements) !== digest(requiredAcknowledgements) || output.confirmation !== `main.${source.target.name}` || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.previewLifetimeMs + 5000 || this.previews.has(output.previewId) || this.previews.size >= limits.previews) throw Error(text.stale);
      accepted = { ...source, id: output.previewId, catalogueId: source.id, statements: output.sql.length, confirmation: output.confirmation, attachedTriggerCount: output.attachedTriggerCount, requiredAcknowledgements: [...output.requiredAcknowledgements], expires, cancelled: () => operation.cancelled }; this.previews.set(accepted.id, accepted); this.publications.set(output, { owner, check: operation.check });
      this.ports.event({ taskId: input.taskId, status: 'completed', progress: 100, message: sqliteObjectsTaskMessage('sqlite.objects.preview', 'completed') }); return output;
    } catch (reason) {
      if (accepted) await this.discard('preview', accepted).catch(() => {}); else if (receivedId && !this.previews.has(receivedId)) await this.ports.request('sqlite.objects.release', { previewId: receivedId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: sqliteObjectsTaskMessage('sqlite.objects.preview', 'failed') }); throw reason;
    } finally { await this.finish(input.taskId, operation); }
  }
  /** 同步保存原随机操作的最小对象DDL事实，不能用回包补造COMMIT ACK。 */
  private record(id: string, operationId: string, source: Preview, value: SqliteObjectsFact): void {
    const fact = sqliteObjectsFactSchema.parse(value), current = this.ports.task(id);
    if (!current || current.kind !== 'sqlite.objects.apply' || fact.operationId !== operationId || !sameTarget(fact.target, source.target) || fact.requestedStatements !== source.statements || fact.action !== source.action) throw Error('SQLite对象定义回执不属于原操作');
    if (current.sqliteObjects) assertSqliteObjectsFactTransition(current.sqliteObjects, fact);
    const next: TaskRecord = { ...current, sqliteObjects: fact, message: sqliteObjectsFactMessage(fact), ...(fact.commitAcknowledged ? { status: 'completed', progress: 100, finishedAt: new Date().toISOString() } : {}) };
    this.ports.replace(next); if (current.sqliteObjects?.phase !== 'writing' || fact.phase !== 'writing') this.ports.save(next);
    this.ports.event({ taskId: id, status: next.status, progress: next.progress, message: next.message });
  }
  /** 预览只领取一次，准确确认与只读门在投递对象DDL之前复核。 */
  private async apply(owner: ColumnsInvocation, input: SqliteObjectsApplyInput): Promise<SqliteObjectsOutcome> {
    this.ports.assert(owner); const source = this.previews.get(input.previewId); if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale); this.valid(source);
    const operation = this.operation(owner, input.taskId, () => this.valid(source, true)), operationId = randomUUID(); this.previews.delete(source.id); let result: SqliteObjectsOutcome | undefined;
    try {
      this.start(input.taskId, 'sqlite.objects.apply'); this.record(input.taskId, operationId, source, { operationId, target: source.target, action: source.action, phase: 'not-sent', requestedStatements: source.statements, completedStatements: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false });
      if (this.ports.profile(source.target.connectionId)?.sqlite.readOnly) throw Error(text.readonly); if (input.confirmation !== source.confirmation) throw Error('请确认准确的main.对象名；原对象定义预览已消费，对象DDL尚未发送');
      assertSqliteObjectsAcknowledgements(source.target, source.action, source.attachedTriggerCount, input.acknowledgements);
      operation.check(); operation.sent = true;
      const output = sqliteObjectsOutcomeSchema.parse(await this.ports.request('sqlite.objects.apply', { ...input, operationId, assertCurrent: operation.check, recordObjectsFact: (fact: SqliteObjectsFact) => this.record(input.taskId, operationId, source, fact) })), recorded = this.ports.task(input.taskId)?.sqliteObjects;
      if (!recorded || output.operationId !== operationId || output.action !== source.action || digest(recorded) !== digest(output.fact)) throw Error(text.unknown); result = output;
    } catch (reason) {
      let fact = this.ports.task(input.taskId)?.sqliteObjects;
      if (!fact) { this.ports.event({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteObjectsTaskMessage('sqlite.objects.apply', 'failed') }); throw reason; }
      if (operation.sent && !fact.commitAcknowledged && !fact.rollbackAcknowledged) { try { this.record(input.taskId, operationId, source, { ...fact, phase: 'unknown' }); } catch { /* 原内存事实保留，不自动重试对象DDL。 */ } fact = this.ports.task(input.taskId)?.sqliteObjects ?? fact; }
      result = { operationId, target: source.target, action: source.action, outcome: fact.commitAcknowledged ? 'committed' : fact.rollbackAcknowledged ? 'rolled-back' : operation.sent ? 'unknown' : 'not-sent', fact, message: !operation.sent && reason instanceof Error ? reason.message : sqliteObjectsFactMessage(fact), definitionVerified: false, cleanupWarning: true };
    } finally {
      await this.ports.request('sqlite.objects.release', { previewId: source.id }).catch(() => {});
      if (result?.outcome === 'committed' || result?.outcome === 'unknown') {
        const catalogue = this.catalogues.get(source.catalogueId); if (catalogue) try { await this.discard('catalogue', catalogue); } catch { result = { ...result, cleanupWarning: true }; }
        else for (const child of this.previews.values()) if (child.catalogueId === source.catalogueId) try { await this.discard('preview', child); } catch { result = { ...result, cleanupWarning: true }; }
      }
      try { await this.finish(input.taskId, operation); } catch { if (result) result = { ...result, cleanupWarning: true }; }
    }
    if (!result) throw Error(text.unknown);
    this.ports.event({ taskId: input.taskId, status: result.fact.commitAcknowledged ? 'completed' : operation.cancelled && result.outcome !== 'unknown' ? 'cancelled' : 'failed', progress: result.fact.commitAcknowledged ? 100 : 0, message: sqliteObjectsFactMessage(result.fact) }); return result;
  }
  /** IPC发布前最后一门仍核同一原文档及能力，迟到回包只释放不重新签发。 */
  assertPublication(owner: ColumnsInvocation, value: unknown, command: string): void {
    const publication = value && typeof value === 'object' ? this.publications.get(value) : undefined; if (!publication || !this.ports.same(owner, publication.owner)) throw Error(text.stale); this.publications.delete(value as object);
    const catalogue = command === 'sqlite.objects.inspect', id = catalogue ? (value as SqliteObjectsInspectOutput).catalogueId : (value as SqliteObjectsPreviewOutput).previewId, source = catalogue ? this.catalogues.get(id) : this.previews.get(id);
    if (!source || !this.ports.same(source.owner, owner)) throw Error(text.stale);
    try { publication.check(); this.valid(source); } catch (reason) { void this.discard(catalogue ? 'catalogue' : 'preview', source).catch(() => {}); this.observe(); throw reason; }
  }
  /** 公开合同严格解析，原文档guard、operationId和回执回调只能在Main注入。 */
  async request(owner: ColumnsInvocation, command: string, input: unknown): Promise<unknown> {
    switch (command) {
      case 'sqlite.objects.inspect': return this.inspect(owner, sqliteObjectsInspectSchema.parse(input));
      case 'sqlite.objects.preview': return this.preview(owner, sqliteObjectsPreviewSchema.parse(input));
      case 'sqlite.objects.apply': return this.apply(owner, sqliteObjectsApplySchema.parse(input));
      case 'sqlite.objects.release': return this.release(owner, sqliteObjectsReleaseSchema.parse(input));
      default: throw Error('SQLite对象定义命令未声明');
    }
  }
}
