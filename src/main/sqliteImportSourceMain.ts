import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SelectedFile } from './fileTokens';
import type { SqliteConnectionProfile, TaskEvent, TaskRecord } from '../shared/contracts';
import { sqliteImportSourceInspectSchema, sqliteImportSourceInspectionSchema, sqliteImportSourceReleaseSchema, sqliteImportSourceOptionsKey, sqliteImportSourceLimits as limits, sqliteImportSourceMessages as messages, type SqliteImportSourceInspectInput, type SqliteImportSourceInspectOutput } from '../shared/sqliteImportSource';
import type { SqliteTableImportInspectInput, SqliteTableImportInspectOutput } from '../shared/sqliteTableImport';
import { sqliteImportTaskMessage } from '../shared/sqliteTableImportFact';

export interface SqliteImportSourceMainPorts {
  assert(owner: ColumnsInvocation): void; same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  revision(): number; epoch(id: string): object; available(id: string): void; closing(): boolean;
  profile(id: string): SqliteConnectionProfile | undefined; file(token: string, format: string): SelectedFile;
  request(command: string, input: unknown): Promise<unknown>;
  task(id: string): TaskRecord | undefined; replace(task: TaskRecord): void; save(task: TaskRecord): void; event(event: TaskEvent): void;
}
interface Source {
  owner: ColumnsInvocation; connectionId: string; revision: number; epoch: object; profile: string;
  file: SelectedFile; fileToken: string; format: string; fileKey: string; options: string;
  id?: string; expires: number; revoked: boolean; claim?: object; claimTask?: string; table?: string;
  source?: SqliteImportSourceInspectOutput['source']; records?: number; columns?: string;
}
interface Operation { owner: ColumnsInvocation; cancelled: boolean; sent: boolean; check(): void; stop?: Promise<void>; settled: Promise<void>; settle(): void; }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const profileKey = (profile: SqliteConnectionProfile) => digest([profile.id, profile.sqlite.filePath, profile.sqlite.readOnly, profile.sqlite.busyTimeoutMs, profile.pendingFiles]);
export interface SqliteImportSourceLease { check(): void; accept(output: SqliteTableImportInspectOutput): void; release(): void; }

/** 无表来源仅为后续建表保留文件解释和摘要；不能自行创建表或授权写入。 */
export class SqliteImportSourceMain {
  private readonly sources = new Map<string, Source>();
  private readonly operations = new Map<string, Operation>();
  private readonly publications = new WeakMap<object, { owner: ColumnsInvocation; source: Source; check(): void }>();
  private readonly watched = new WeakSet<object>();
  constructor(private readonly ports: SqliteImportSourceMainPorts, private readonly children: { assertOwner(owner: ColumnsInvocation, id: string): void; release(id: string): Promise<void>; cancelClaim(taskId: string): Promise<void> }) {}

  /** 自然TTL限制新领取，已领取扫描继续核对文档、profile及原文件对象。 */
  private valid(source: Source, claimed = false): void {
    this.ports.assert(source.owner); this.ports.available(source.connectionId);
    const profile = this.ports.profile(source.connectionId);
    if (this.ports.closing() || source.revoked || !claimed && source.expires <= Date.now() || source.revision !== this.ports.revision() || source.epoch !== this.ports.epoch(source.connectionId) || !profile || profile.pendingFiles?.length || !profile.sqlite.filePath || profileKey(profile) !== source.profile || this.ports.file(source.fileToken, source.format) !== source.file || digest([source.file.path, source.file.purpose, source.file.format]) !== source.fileKey) throw Error(messages.stale);
  }
  /** 文档换代立即撤销来源，不能继承旧页面的文件授权。 */
  private watch(owner: ColumnsInvocation): void {
    const contents = owner.owner.contents; if (this.watched.has(contents)) return; this.watched.add(contents);
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) contents.on(event as 'destroyed', () => this.observe());
  }
  /** 明确释放级联未领取目标能力；正在写入的原承诺由其任务负责。 */
  async retire(id: string): Promise<void> {
    const source = this.sources.get(id); if (source) { source.revoked = true; this.sources.delete(id); }
    await Promise.all([source?.claimTask ? this.children.cancelClaim(source.claimTask) : undefined, this.children.release(id), this.ports.request('sqlite.importSource.release', { sourceId: id })]);
  }
  observe(): void {
    for (const [id, source] of this.sources) {
      if (source.expires <= Date.now()) { if (!source.claim) this.sources.delete(id); continue; }
      try { this.valid(source); } catch { void this.retire(id).catch(() => {}); }
    }
    for (const [id, operation] of this.operations) try { operation.check(); } catch { void this.stop(id, operation).catch(() => {}); }
  }
  owns(id: string): boolean { return this.operations.has(id); }
  /** 取消只发送一次，原请求和取消应答都被退出屏障观察。 */
  private stop(id: string, operation: Operation): Promise<void> {
    operation.cancelled = true;
    if (!operation.stop) operation.stop = operation.sent ? this.ports.request('query.cancel', { taskId: id }).then(() => {}) : Promise.resolve();
    void operation.stop.catch(() => {}); return operation.stop;
  }
  async cancel(owner: ColumnsInvocation, id: string): Promise<void> {
    this.ports.assert(owner); const operation = this.operations.get(id);
    if (!operation || !this.ports.same(owner, operation.owner)) throw Error(messages.stale); await this.stop(id, operation);
  }
  async drain(): Promise<void> {
    const operations = [...this.operations];
    await Promise.allSettled([...this.sources.keys()].map(id => this.retire(id)));
    await Promise.allSettled(operations.map(([id, operation]) => this.stop(id, operation)));
    await Promise.all(operations.map(([, operation]) => operation.settled));
  }
  /** 最初检查不绑定虚构表名，原生选择文件且数据库日志均不可作为来源。 */
  private capture(owner: ColumnsInvocation, input: SqliteImportSourceInspectInput): Source {
    this.watch(owner); this.observe(); this.ports.assert(owner); this.ports.available(input.connectionId);
    const profile = this.ports.profile(input.connectionId), file = this.ports.file(input.fileToken, input.format);
    if (!profile || profile.pendingFiles?.length || !profile.sqlite.filePath) throw Error('请先保存并授权准确SQLite文件连接');
    const pathKey = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
    if (['', '-wal', '-shm', '-journal'].some(suffix => pathKey(profile.sqlite.filePath! + suffix) === pathKey(file.path))) throw Error('导入来源不能是目标SQLite文件或其日志');
    return { owner, connectionId: input.connectionId, revision: this.ports.revision(), epoch: this.ports.epoch(input.connectionId), profile: profileKey(profile), file, fileToken: input.fileToken, format: input.format, fileKey: digest([file.path, file.purpose, file.format]), options: digest(sqliteImportSourceOptionsKey(input)), expires: Infinity, revoked: false };
  }
  private async inspect(owner: ColumnsInvocation, input: SqliteImportSourceInspectInput): Promise<SqliteImportSourceInspectOutput> {
    const source = this.capture(owner, input);
    if (this.ports.task(input.taskId) || this.operations.has(input.taskId) || this.operations.size >= limits.sources || this.sources.size >= limits.sources) throw Error('SQLite来源任务编号已使用或检查繁忙');
    let settle!: () => void;
    const operation: Operation = { owner, cancelled: false, sent: false, check: () => { if (operation.cancelled) throw Error(messages.stale); this.valid(source, true); }, settled: new Promise<void>(resolve => { settle = resolve; }), settle: () => settle() };
    operation.check(); this.operations.set(input.taskId, operation);
    let accepted: SqliteImportSourceInspectOutput | undefined, receivedId: string | undefined;
    try {
      const task: TaskRecord = { id: input.taskId, kind: 'sqlite.importSource.inspect', status: 'running', progress: 0, message: sqliteImportTaskMessage('sqlite.importSource.inspect', 'running'), startedAt: new Date().toISOString() };
      this.ports.replace(task); this.ports.save(task); operation.check(); operation.sent = true;
      const received = await this.ports.request('sqlite.importSource.inspect', { ...input, filePath: source.file.path, assertCurrent: operation.check });
      const candidate = (received as { sourceId?: unknown } | undefined)?.sourceId;
      if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 200) receivedId = candidate;
      const output = sqliteImportSourceInspectionSchema.parse(received); operation.check(); const expires = Date.parse(output.expiresAt);
      if (output.connectionId !== source.connectionId || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + limits.sourceLifetimeMs + 5000 || this.sources.has(output.sourceId) || this.sources.size >= limits.sources) throw Error(messages.stale);
      Object.assign(source, { id: output.sourceId, expires, source: output.source, records: output.records, columns: digest(output.sourceColumns) }); this.sources.set(output.sourceId, source); accepted = output;
      this.publications.set(output, { owner, source, check: operation.check });
      this.ports.event({ taskId: input.taskId, status: 'completed', progress: 100, message: sqliteImportTaskMessage('sqlite.importSource.inspect', 'completed') }); return output;
    } catch (reason) {
      if (accepted) await this.retire(accepted.sourceId).catch(() => {});
      else if (receivedId && !this.sources.has(receivedId)) await this.ports.request('sqlite.importSource.release', { sourceId: receivedId }).catch(() => {});
      this.ports.event({ taskId: input.taskId, status: operation.cancelled ? 'cancelled' : 'failed', progress: 0, message: sqliteImportTaskMessage('sqlite.importSource.inspect', 'failed') }); throw reason;
    } finally {
      try { await operation.stop; } finally { if (this.operations.get(input.taskId) === operation) this.operations.delete(input.taskId); operation.settle(); }
    }
  }
  /** 同一来源最多一个检查领取；首次成功固定准确新表，后续仅允许重检同表。 */
  bind(owner: ColumnsInvocation, input: SqliteTableImportInspectInput): SqliteImportSourceLease | undefined {
    if (!input.sourceId) return undefined; const source = this.sources.get(input.sourceId);
    if (!source || !this.ports.same(owner, source.owner) || source.connectionId !== input.connectionId || source.options !== digest(sqliteImportSourceOptionsKey(input)) || source.claim || source.table && source.table !== input.table) throw Error(messages.stale);
    this.valid(source); const claim = {}; source.claim = claim; source.claimTask = input.taskId;
    const check = () => { this.valid(source, true); if (source.claim !== claim) throw Error(messages.stale); };
    return { check, accept: output => {
      check(); if (output.target.connectionId !== source.connectionId || output.target.database !== 'main' || output.target.table !== input.table || digest(output.source) !== digest(source.source) || output.records !== source.records || digest(output.sourceColumns) !== source.columns) throw Error(messages.stale);
      source.table = input.table;
    }, release: () => { if (source.claim === claim) { source.claim = undefined; source.claimTask = undefined; } } };
  }
  /** 最终IPC发布门拒绝迟到或已撤销的来源，并回收准确能力。 */
  assertPublication(owner: ColumnsInvocation, value: unknown): void {
    const publication = value && typeof value === 'object' ? this.publications.get(value) : undefined;
    if (!publication || !this.ports.same(owner, publication.owner)) throw Error(messages.stale); this.publications.delete(value as object);
    try { publication.check(); this.valid(publication.source); if (this.sources.get(publication.source.id!) !== publication.source) throw Error(messages.stale); }
    catch (reason) { void this.retire(publication.source.id!).catch(() => {}); throw reason; }
  }
  async request(owner: ColumnsInvocation, command: string, input: unknown): Promise<unknown> {
    if (command === 'sqlite.importSource.inspect') return this.inspect(owner, sqliteImportSourceInspectSchema.parse(input));
    if (command !== 'sqlite.importSource.release') throw Error('SQLite来源命令未声明');
    const { sourceId } = sqliteImportSourceReleaseSchema.parse(input); this.ports.assert(owner); const source = this.sources.get(sourceId);
    if (source && !this.ports.same(owner, source.owner)) throw Error(messages.stale); this.children.assertOwner(owner, sourceId); await this.retire(sourceId);
  }
}
