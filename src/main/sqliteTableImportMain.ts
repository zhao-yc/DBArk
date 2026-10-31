import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SelectedFile } from './fileTokens';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import type { SqliteEditTarget, SqliteTableEditOutcome, SqliteWriteFact } from '../shared/sqliteTableEdit';
import { sqliteTableImportInspectSchema, sqliteTableImportInspectionSchema, sqliteTableImportPreviewSchema, sqliteTableImportPreviewOutputSchema, sqliteTableImportApplySchema, sqliteTableImportReleaseSchema, sqliteTableImportOutcomeSchema, sqliteImportWriteFactSchema, assertSqliteImportWriteFactTransition, buildSqliteTableImportInsert, sqliteTableImportLimits as limits, type SqliteTableImportInspectInput, type SqliteTableImportInspectOutput, type SqliteTableImportPreviewInput, type SqliteTableImportPreviewOutput, type SqliteTableImportApplyInput, type SqliteTableImportReleaseInput } from '../shared/sqliteTableImport';
import { sqliteImportFactMessage, sqliteImportTaskMessage } from '../shared/sqliteTableImportFact';

interface Ports {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean;
  profile(id: string): SqliteConnectionProfile | undefined; file(token: string, format: string): SelectedFile;
  request(command: string, input: unknown): Promise<unknown>;
  task(id: string): TaskRecord | undefined; replace(task: TaskRecord): void; save(task: TaskRecord): void; event(event: TaskEvent): void;
}
interface Source { owner: ColumnsInvocation; revision: number; epoch: object; profile: string; target: SqliteEditTarget; expires: number; revoked: boolean; fileToken: string; file: SelectedFile; fileKey: string; format: string; source?: { sha256: string; bytes: number }; records?: number; cancelled?(): boolean; }
interface Inspection extends Source { id: string; }
interface Preview extends Source { id: string; inspectionId: string; confirmation: string; records: number; }
interface Operation { owner: ColumnsInvocation; cancelled: boolean; sent: boolean; check(): void; stop?: Promise<void>; settled: Promise<void>; settle(): void; }
/** Main仅比较固定来源和摘要，不将样本、映射、SQL或字段值留在能力表。 */
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileKey = (profile: SqliteConnectionProfile) => digest([profile.id, profile.sqlite.filePath, profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs, profile.pendingFiles]);
const sameTarget = (left: SqliteEditTarget, right: SqliteEditTarget) => digest(left) === digest(right);
const stale = 'SQLite导入的原文档、文件、连接或预览已失效，请重新检查；不会自动重放。';

/** 文件与预览能力绑定真实Main文档；流式数据库资源仍归原SQLite账本。 */
export class SqliteTableImportMain {
  private readonly inspections = new Map<string, Inspection>();
  private readonly previews = new Map<string, Preview>();
  private readonly operations = new Map<string, Operation>();
  private readonly watched = new WeakSet<object>();
  private readonly publications = new WeakMap<object, { owner: ColumnsInvocation; check(): void }>();
  constructor(private readonly ports: Ports) {}

  /** TTL限制领取，不限制已经开始的长任务；其它身份和退出门持续复核。 */
  private valid(source: Source, claimed = false): void {
    this.ports.assert(source.owner); this.ports.available(source.target.connectionId);
    const profile = this.ports.profile(source.target.connectionId);
    if (this.ports.closing() || source.revoked || source.cancelled?.() || !claimed && source.expires <= Date.now() || source.revision !== this.ports.revision() || source.epoch !== this.ports.epoch(source.target.connectionId) || !profile || profile.pendingFiles?.length || !profile.sqlite.filePath || profileKey(profile) !== source.profile || this.ports.file(source.fileToken, source.format) !== source.file || digest([source.file.path, source.file.purpose, source.file.format]) !== source.fileKey) throw Error(stale);
  }
  /** 文档导航同步撤权，不把旧来源移交给重载后的页面。 */
  private watch(owner: ColumnsInvocation): void {
    const contents = owner.owner.contents; if (this.watched.has(contents)) return; this.watched.add(contents);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) contents.on(event as 'destroyed', () => this.observe());
  }
  /** 仅释放准确能力，先撤Main登记再等待runtime回收。 */
  private discard(kind: 'inspection' | 'preview', source: Inspection | Preview): Promise<void> {
    const map = kind === 'inspection' ? this.inspections : this.previews;
    if (map.get(source.id) !== source) return Promise.resolve(); source.revoked = true; map.delete(source.id);
    if (kind === 'inspection') for (const preview of this.previews.values()) if (preview.inspectionId === source.id) { preview.revoked = true; this.previews.delete(preview.id); }
    return this.ports.request('sqlite.tableImport.release', { [kind === 'inspection' ? 'inspectionId' : 'previewId']: source.id }).then(() => {});
  }
  /** profile ABA、文件令牌替换及原文档变化使旧能力永久失效。 */
  observe(): void {
    for (const [kind, map] of [['inspection', this.inspections], ['preview', this.previews]] as const) for (const source of map.values()) {
      // 自然TTL只回收自己的领取能力；runtime也按独立TTL回收，不能级联撤销更新的子预览。
      if (source.expires <= Date.now()) { map.delete(source.id); continue; }
      try { this.valid(source); } catch { void this.discard(kind, source).catch(() => {}); }
    }
    for (const [id, operation] of this.operations) try { operation.check(); } catch { void this.stop(id, operation).catch(() => {}); }
  }
  /** Main只接收原生文件选择对象；明显的数据库及日志路径在打开读取前拒绝。 */
  private source(owner: ColumnsInvocation, input: SqliteTableImportInspectInput): Source {
    this.watch(owner); this.observe(); this.ports.assert(owner); this.ports.available(input.connectionId);
    const profile = this.ports.profile(input.connectionId), file = this.ports.file(input.fileToken, input.format);
    if (!profile || profile.pendingFiles?.length || !profile.sqlite.filePath) throw Error('请先保存并授权准确SQLite文件连接');
    const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (['', '-wal', '-shm', '-journal'].some(suffix => pathKey(profile.sqlite.filePath! + suffix) === pathKey(file.path))) throw Error('导入来源不能是目标SQLite文件或其日志');
    const source: Source = { owner, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), profile: profileKey(profile), target: { connectionId: input.connectionId, database: 'main', table: input.table }, fileToken: input.fileToken, file, fileKey: digest([file.path, file.purpose, file.format]), format: input.format, expires: Infinity, revoked: false };
    this.valid(source); return source;
  }
  /** 在首个await前独占编号，原取消和退出始终指向同一次操作。 */
  private operation(owner: ColumnsInvocation, taskId: string, check: () => void): Operation {
    if (this.ports.task(taskId) || this.operations.has(taskId) || this.operations.size >= limits.previews) throw Error('SQLite导入任务编号已使用或操作繁忙');
    let settle!: () => void;
    const operation: Operation = { owner, cancelled: false, sent: false, check: () => { this.ports.assert(owner); if (operation.cancelled || this.ports.closing()) throw Error(stale); check(); }, settled: new Promise<void>(resolve => { settle = resolve; }), settle: () => settle() };
    operation.check(); this.operations.set(taskId, operation); return operation;
  }
  /** 首次任务概要必须先落盘，任何存储拒绝都不能开始文件或数据库工作。 */
  private start(taskId: string, command: string): void {
    const task: TaskRecord = { id: taskId, kind: command, status: 'running', progress: 0, message: sqliteImportTaskMessage(command, 'running'), startedAt: new Date().toISOString() };
    this.ports.replace(task); this.ports.save(task);
  }
  /** 取消只投递一次，并始终观察准确原请求及取消应答。 */
  private stop(taskId: string, operation: Operation): Promise<void> {
    operation.cancelled = true;
    if (!operation.stop) operation.stop = operation.sent ? this.ports.request('query.cancel', { taskId }).then(() => {}) : Promise.resolve();
    void operation.stop.catch(() => {}); return operation.stop;
  }
  /** 原请求与取消都settle后才释放Main占用；数据库最终关闭另走原账本。 */
  private async finish(taskId: string, operation: Operation): Promise<void> {
    try { await operation.stop; } finally { if (this.operations.get(taskId) === operation) this.operations.delete(taskId); operation.settle(); }
  }
  /** 公共取消必须属于同一原文档。 */
  owns(taskId: string): boolean { return this.operations.has(taskId); }
  async cancel(owner: ColumnsInvocation, taskId: string): Promise<void> {
    this.ports.assert(owner); const operation = this.operations.get(taskId);
    if (!operation || !this.ports.same(operation.owner, owner)) throw Error(stale); await this.stop(taskId, operation);
  }
  /** 正常或强制退出均先观察原Main承诺，不能在提交边界关闭配置文件。 */
  async drain(): Promise<void> {
    const operations = [...this.operations.entries()];
    await Promise.allSettled([...this.inspections.values()].map(source => this.discard('inspection', source)).concat([...this.previews.values()].map(source => this.discard('preview', source))));
    await Promise.allSettled(operations.map(([id, operation]) => this.stop(id, operation)));
    await Promise.all(operations.map(([, operation]) => operation.settled));
  }
  /** 释放可跨目标失效，但两个编号必须先整组核归属，不能半释放另一文档。 */
  private async release(owner: ColumnsInvocation, input: SqliteTableImportReleaseInput): Promise<void> {
    this.ports.assert(owner); const inspection = input.inspectionId ? this.inspections.get(input.inspectionId) : undefined, preview = input.previewId ? this.previews.get(input.previewId) : undefined;
    const children = input.inspectionId ? [...this.previews.values()].filter(value => value.inspectionId === input.inspectionId) : [];
    for (const source of [inspection, preview, ...children]) if (source && !this.ports.same(source.owner, owner)) throw Error(stale);
    // 父领取资格自然过期后，仍可由子能力的原owner核验显式级联释放。
    await Promise.all([inspection ? this.discard('inspection', inspection) : Promise.all(children.map(value => this.discard('preview', value))), preview ? this.discard('preview', preview) : undefined]);
  }
  /** 完整文件检查仅发布有界样本，持久任务不含文件名、摘要、值或路径。 */
  private async inspect(owner: ColumnsInvocation, input: SqliteTableImportInspectInput): Promise<SqliteTableImportInspectOutput> {
    const source = this.source(owner, input), operation = this.operation(owner, input.taskId, () => this.valid(source)); source.cancelled = () => operation.cancelled;
    let output: SqliteTableImportInspectOutput | undefined, accepted: Inspection | undefined, receivedId: string | undefined;
    try {
      this.start(input.taskId, 'sqlite.tableImport.inspect'); operation.check(); operation.sent = true;
      const received = await this.ports.request('sqlite.tableImport.inspect', { ...input, filePath: source.file.path, assertCurrent: operation.check });
      const candidate = (received as { inspectionId?: unknown } | undefined)?.inspectionId;
      if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 200) receivedId = candidate;
      output = sqliteTableImportInspectionSchema.parse(received);
      operation.check(); const expires = Date.parse(output.expiresAt);
      if (!sameTarget(output.target, source.target) || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.previewLifetimeMs + 5000 || this.inspections.has(output.inspectionId) || this.inspections.size >= limits.previews) throw Error(stale);
      accepted = { ...source, id: output.inspectionId, expires, records: output.records, source: output.source }; this.inspections.set(output.inspectionId, accepted);
      this.publications.set(output, { owner, check: operation.check });
      this.ports.event({ taskId: input.taskId, status: 'completed', progress: 100, message: sqliteImportTaskMessage('sqlite.tableImport.inspect', 'completed') }); return output;
    } catch (reason) {
      if (accepted) await this.discard('inspection', accepted).catch(() => {});
      else if (receivedId && !this.inspections.has(receivedId)) await this.ports.request('sqlite.tableImport.release', { inspectionId: receivedId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: sqliteImportTaskMessage('sqlite.tableImport.inspect', 'failed') }); throw reason;
    } finally { await this.finish(input.taskId, operation); }
  }
  /** 映射预检必须耗尽原文件；只接收同目标、同摘要、同记录总数的预览。 */
  private async preview(owner: ColumnsInvocation, input: SqliteTableImportPreviewInput): Promise<SqliteTableImportPreviewOutput> {
    this.ports.assert(owner); const source = this.inspections.get(input.inspectionId);
    if (!source || !this.ports.same(source.owner, owner)) throw Error(stale); this.valid(source);
    const operation = this.operation(owner, input.taskId, () => this.valid(source, true)); let output: SqliteTableImportPreviewOutput | undefined, accepted: Preview | undefined, receivedId: string | undefined;
    try {
      this.start(input.taskId, 'sqlite.tableImport.preview'); operation.check(); operation.sent = true;
      const received = await this.ports.request('sqlite.tableImport.preview', { ...input, assertCurrent: operation.check });
      const candidate = (received as { previewId?: unknown } | undefined)?.previewId;
      if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 200) receivedId = candidate;
      output = sqliteTableImportPreviewOutputSchema.parse(received); operation.check();
      if (output.inspectionId !== source.id || !sameTarget(output.target, source.target) || digest(output.source) !== digest(source.source) || output.records !== source.records) throw Error(stale);
      if (output.ok) {
        const expires = Date.parse(output.expiresAt);
        if (output.sql !== buildSqliteTableImportInsert(source.target.table, input.mapping.map(item => item.target)) || output.inspectionId !== source.id || output.confirmation !== `main.${source.target.table}` || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.previewLifetimeMs + 5000 || this.previews.has(output.previewId) || this.previews.size >= limits.previews) throw Error(stale);
        accepted = { ...source, id: output.previewId, inspectionId: source.id, expires, confirmation: output.confirmation, records: output.records, cancelled: () => operation.cancelled }; this.previews.set(output.previewId, accepted);
      }
      this.publications.set(output, { owner, check: operation.check });
      this.ports.event({ taskId: input.taskId, status: output.ok ? 'completed' : 'failed', progress: output.ok ? 100 : 0, message: sqliteImportTaskMessage('sqlite.tableImport.preview', output.ok ? 'completed' : 'failed') }); return output;
    } catch (reason) {
      if (accepted) await this.discard('preview', accepted).catch(() => {});
      else if (receivedId && !this.previews.has(receivedId)) await this.ports.request('sqlite.tableImport.release', { previewId: receivedId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: sqliteImportTaskMessage('sqlite.tableImport.preview', 'failed') }); throw reason;
    } finally { await this.finish(input.taskId, operation); }
  }
  /** 同步最小事实只接受准确原随机操作和数量；处理行数不代表已提交。 */
  private record(taskId: string, operationId: string, source: Preview, value: SqliteWriteFact): void {
    const fact = sqliteImportWriteFactSchema.parse(value), current = this.ports.task(taskId);
    if (!current || current.kind !== 'sqlite.tableImport.apply' || fact.operationId !== operationId || !sameTarget(fact.target, source.target) || fact.requestedRows !== source.records) throw Error('SQLite导入回执不属于原操作');
    if (current.sqliteWrite) assertSqliteImportWriteFactTransition(current.sqliteWrite, fact);
    const next: TaskRecord = { ...current, sqliteWrite: fact, message: sqliteImportFactMessage(fact), ...(fact.commitAcknowledged ? { status: 'completed', progress: 100, finishedAt: new Date().toISOString() } : {}) }; this.ports.replace(next);
    if (current.sqliteWrite?.phase !== 'writing' || fact.phase !== 'writing') this.ports.save(next);
    this.ports.event({ taskId, status: next.status, progress: next.progress, message: next.message });
  }
  /** 单次领取只在明确确认后写入，ACK和未知事实永不触发自动重放。 */
  private async apply(owner: ColumnsInvocation, input: SqliteTableImportApplyInput): Promise<SqliteTableEditOutcome> {
    this.ports.assert(owner); const source = this.previews.get(input.previewId);
    if (!source || !this.ports.same(source.owner, owner)) throw Error(stale); this.valid(source);
    const operation = this.operation(owner, input.taskId, () => this.valid(source, true)), operationId = randomUUID(); this.previews.delete(source.id);
    let result: SqliteTableEditOutcome | undefined;
    try {
      this.start(input.taskId, 'sqlite.tableImport.apply');
      this.record(input.taskId, operationId, source, { operationId, target: source.target, phase: 'not-sent', requestedRows: source.records, appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false });
      if (this.ports.profile(source.target.connectionId)?.sqlite.readOnly) throw Error('SQLite连接为只读，导入尚未发送');
      if (input.confirmation !== source.confirmation) throw Error('准确库.表名确认不匹配；原预览已消费，导入尚未发送');
      operation.check(); operation.sent = true;
      const output = sqliteTableImportOutcomeSchema.parse(await this.ports.request('sqlite.tableImport.apply', { ...input, operationId, recordWriteFact: (fact: SqliteWriteFact) => this.record(input.taskId, operationId, source, fact), assertCurrent: operation.check }));
      const recorded = this.ports.task(input.taskId)?.sqliteWrite;
      if (!recorded || output.operationId !== operationId || digest(recorded) !== digest(output.fact)) throw Error(stale); result = output;
    } catch (reason) {
      let fact = this.ports.task(input.taskId)?.sqliteWrite;
      if (!fact) { this.ports.event({ taskId: input.taskId, status: 'failed', progress: 0, message: sqliteImportTaskMessage('sqlite.tableImport.apply', 'failed') }); throw reason; }
      if (operation.sent && !fact.commitAcknowledged && !fact.rollbackAcknowledged) { try { this.record(input.taskId, operationId, source, { ...fact, phase: 'unknown' }); } catch { /* 原内存事实保留，持久失败不自动重试。 */ } fact = this.ports.task(input.taskId)?.sqliteWrite ?? fact; }
      result = { operationId, target: source.target, counts: { insert: source.records, update: 0, delete: 0 }, outcome: fact.commitAcknowledged ? 'committed' : fact.rollbackAcknowledged ? 'rolled-back' : operation.sent ? 'unknown' : 'not-sent', fact, message: !operation.sent && reason instanceof Error ? reason.message : sqliteImportFactMessage(fact), cleanupWarning: true };
    } finally {
      await this.ports.request('sqlite.tableImport.release', { previewId: source.id }).catch(() => {});
      // runtime在已提交/未知后撤销整个原来源，Main必须同步撤旧检查及其它未领取子预览。
      if (result?.outcome === 'committed' || result?.outcome === 'unknown') {
        const inspection = this.inspections.get(source.inspectionId);
        if (inspection) try { await this.discard('inspection', inspection); } catch { result = { ...result, cleanupWarning: true }; }
        else for (const child of this.previews.values()) if (child.inspectionId === source.inspectionId) try { await this.discard('preview', child); } catch { result = { ...result, cleanupWarning: true }; }
      }
      try { await this.finish(input.taskId, operation); } catch { if (result) result = { ...result, cleanupWarning: true }; }
    }
    if (!result) throw Error(stale);
    this.ports.event({ taskId: input.taskId, status: result.fact.commitAcknowledged ? 'completed' : operation.cancelled && result.outcome !== 'unknown' ? 'cancelled' : 'failed', progress: result.fact.commitAcknowledged ? 100 : 0, message: sqliteImportFactMessage(result.fact) }); return result;
  }
  /** IPC最终同步发布门守住检查/预览完成后的取消与导航窗口。 */
  assertPublication(owner: ColumnsInvocation, value: unknown, command: string): void {
    const publication = value && typeof value === 'object' ? this.publications.get(value) : undefined;
    if (!publication || !this.ports.same(publication.owner, owner)) throw Error(stale);
    this.publications.delete(value as object);
    const output = value as SqliteTableImportInspectOutput | SqliteTableImportPreviewOutput;
    if (command === 'sqlite.tableImport.preview' && 'ok' in output && !output.ok) { publication.check(); this.ports.assert(owner); return; }
    const inspection = command === 'sqlite.tableImport.inspect', id = inspection ? (output as SqliteTableImportInspectOutput).inspectionId : (output as Extract<SqliteTableImportPreviewOutput, { ok: true }>).previewId;
    const source = inspection ? this.inspections.get(id) : this.previews.get(id);
    if (!source || !this.ports.same(source.owner, owner)) throw Error(stale);
    try { publication.check(); this.valid(source); }
    catch (reason) { void this.discard(inspection ? 'inspection' : 'preview', source).catch(() => {}); this.observe(); throw reason; }
  }
  /** 内部调用同样严格校验公开合同，私有路径和回调只在Main注入。 */
  async request(owner: ColumnsInvocation, command: string, input: unknown): Promise<unknown> {
    switch (command) {
      case 'sqlite.tableImport.inspect': return this.inspect(owner, sqliteTableImportInspectSchema.parse(input));
      case 'sqlite.tableImport.preview': return this.preview(owner, sqliteTableImportPreviewSchema.parse(input));
      case 'sqlite.tableImport.apply': return this.apply(owner, sqliteTableImportApplySchema.parse(input));
      case 'sqlite.tableImport.release': return this.release(owner, sqliteTableImportReleaseSchema.parse(input));
      default: throw Error('SQLite导入命令未声明');
    }
  }
}
