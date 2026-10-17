import { tracingChannel } from 'node:diagnostics_channel';
import { types } from 'node:util';
import type { EventEmitter } from 'node:events';
import type { Query } from 'mysql2';
import type { StructureTaskContext } from './structureDefinition';

export type DatabaseBackupMysqlLockContext = Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>;
export interface DatabaseBackupMysqlLockOwner { readonly taskId: string; readonly planToken: string; readonly connectionRevision: string; readonly sourceLease: string; readonly controlLease: string; }
type Role = 'source' | 'control';
type Kind = 'acquire' | 'observe' | 'release';
type Phase = 'idle' | 'acquiring' | 'observed' | 'observing' | 'releasing' | 'released' | 'unknown';
export type DatabaseBackupMysqlLockReason = 'invalid' | 'metadata' | 'driver' | 'cancelled' | 'timeout' | 'budget';
export interface DatabaseBackupMysqlLockOutcome { readonly state: 'observed' | 'released'; readonly observation: number; }
/** 许可由Root真实Scope同步给出；没有dump必须明确证明从未启动，不能用取消ACK替代。 */
export type DatabaseBackupMysqlLockReleasePermit = { readonly owner: DatabaseBackupMysqlLockOwner; readonly originalOperationLeft: true; readonly serverOperationsEnded: true } & (
  { readonly dumpNeverStarted: true } | { readonly dumpNeverStarted: false; readonly dumpProcessClosed: true; readonly dumpStreamsClosed: true }
);
export interface DatabaseBackupMysqlLockHooks {
  /** 同步核当前lease和专属会话，除allowed原命令外不得有外部命令/事务/重连/中途解锁。 */
  checkLease(owner: Readonly<DatabaseBackupMysqlLockOwner>, allowed: DatabaseBackupMysqlLockCommand | null): void;
  registerOperation(operation: DatabaseBackupMysqlLockOperation): void;
  registerCommand(command: DatabaseBackupMysqlLockCommand): void;
  /** 仅请求Root停止原命令/作业；不是执行KILL，不是终态。 */
  requestStop(operation: DatabaseBackupMysqlLockOperation, command: DatabaseBackupMysqlLockCommand | null, reason: DatabaseBackupMysqlLockReason): void;
  releasePermit(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockReleasePermit;
}
export interface DatabaseBackupMysqlLockOptions { budgetMs?: number; maxCommands?: number; maxObservations?: number; maxBytes?: number; }

/** 没有任意SQL入口；参数只来自已读回并固定的十进制原session/thread身份。E等待者观察属Root实验，不在本原语中。 */
export const databaseBackupMysqlLockSql = Object.freeze({
  identity: 'SELECT CAST(CONNECTION_ID() AS CHAR) AS session_id, @@GLOBAL.server_uuid AS server_uuid, VERSION() AS server_version, @@version_comment AS server_flavor, @@GLOBAL.performance_schema AS performance_schema_enabled',
  thread: 'SELECT CAST(THREAD_ID AS CHAR) AS thread_id, CAST(PROCESSLIST_ID AS CHAR) AS session_id, TYPE, INSTRUMENTED FROM performance_schema.threads WHERE PROCESSLIST_ID = CAST(? AS UNSIGNED) LIMIT 3',
  instrument: "SELECT NAME, ENABLED, TIMED FROM performance_schema.setup_instruments WHERE NAME = 'wait/lock/metadata/sql/mdl' LIMIT 3",
  consumers: "SELECT NAME, ENABLED FROM performance_schema.setup_consumers WHERE NAME IN ('global_instrumentation', 'thread_instrumentation') LIMIT 3",
  status: "SHOW GLOBAL STATUS WHERE Variable_name IN ('Performance_schema_metadata_lock_lost', 'Performance_schema_thread_instances_lost', 'Uptime')",
  locks: "SELECT CAST(t.THREAD_ID AS CHAR) AS thread_id, CAST(t.PROCESSLIST_ID AS CHAR) AS session_id, t.TYPE, t.INSTRUMENTED, m.OBJECT_TYPE, m.OBJECT_SCHEMA, m.OBJECT_NAME, m.LOCK_TYPE, m.LOCK_DURATION, m.LOCK_STATUS, CAST(m.OBJECT_INSTANCE_BEGIN AS CHAR) AS instance_address, CAST(m.OWNER_EVENT_ID AS CHAR) AS owner_event_id FROM performance_schema.threads AS t JOIN performance_schema.metadata_locks AS m ON m.OWNER_THREAD_ID = t.THREAD_ID WHERE t.THREAD_ID = CAST(? AS UNSIGNED) AND t.PROCESSLIST_ID = CAST(? AS UNSIGNED) AND t.TYPE = 'FOREGROUND' AND m.OBJECT_TYPE IN ('GLOBAL', 'COMMIT') ORDER BY m.OBJECT_TYPE, m.OBJECT_INSTANCE_BEGIN LIMIT 3",
  flush: 'FLUSH TABLES WITH READ LOCK', unlock: 'UNLOCK TABLES',
});
type Statement = keyof typeof databaseBackupMysqlLockSql;
type Row = Readonly<Record<string, string | number | null>>;
const fields: Record<Exclude<Statement, 'flush' | 'unlock'>, readonly string[]> = {
  identity: ['session_id', 'server_uuid', 'server_version', 'server_flavor', 'performance_schema_enabled'],
  thread: ['thread_id', 'session_id', 'TYPE', 'INSTRUMENTED'], instrument: ['NAME', 'ENABLED', 'TIMED'], consumers: ['NAME', 'ENABLED'], status: ['Variable_name', 'Value'],
  locks: ['thread_id', 'session_id', 'TYPE', 'INSTRUMENTED', 'OBJECT_TYPE', 'OBJECT_SCHEMA', 'OBJECT_NAME', 'LOCK_TYPE', 'LOCK_DURATION', 'LOCK_STATUS', 'instance_address', 'owner_event_id'],
};
const blocked = () => new Error('MySQL全局读锁原会话或观察状态未经确认，已保留并阻断');
function need(value: unknown): asserts value { if (!value) throw blocked(); }
function decimal(value: unknown, zero = false): string { need(typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/u.test(value)); need(BigInt(value) <= 18446744073709551615n && (zero || value !== '0')); return value; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject }; }
function syncVoid(value: unknown, fail: () => void): void { if (value !== undefined) { void Promise.resolve(value).catch(fail); fail(); throw blocked(); } }

/** 核默认解析/日志配置，不调用getter，不改连接配置；Root仍须拥有原驱动与配置。 */
function configuration(connection: object): object {
  need(!types.isProxy(connection)); const binding = Object.getOwnPropertyDescriptor(connection, 'config'); need(binding && 'value' in binding && binding.value && typeof binding.value === 'object');
  const config: object = binding.value; need(!types.isProxy(config));
  for (const key of ['debug', 'queryFormat', 'typeCast']) {
    let target: object | null = config, found = false;
    for (let depth = 0; target && depth < 32; depth++, target = Object.getPrototypeOf(target)) {
      need(!types.isProxy(target)); const descriptor = Object.getOwnPropertyDescriptor(target, key); if (!descriptor) continue;
      need('value' in descriptor); const value = descriptor.value;
      need(key === 'debug' ? !value : key === 'queryFormat' ? value === undefined : value === undefined || typeof value === 'boolean'); found = true; break;
    }
    need(found || target === null);
  }
  need(!tracingChannel('mysql2:query').hasSubscribers && !tracingChannel('mysql2:execute').hasSubscribers); return config;
}
interface ActionRecord { kind: Kind; slot: number; result: ReturnType<typeof deferred<DatabaseBackupMysqlLockOutcome>>; work?: Promise<void>; finished: boolean; stopRequested: boolean; stopFailed: boolean; handle: DatabaseBackupMysqlLockOperation; }
interface CommandRecord {
  slot: number; role: Role; statement: Statement; params: readonly string[]; action: ActionRecord; handle?: DatabaseBackupMysqlLockCommand; query: Query | null;
  result: ReturnType<typeof deferred<void>>; nativeEnd: ReturnType<typeof deferred<void>>; accountingEnd: ReturnType<typeof deferred<void>>;
  rows: Row[]; fieldsSeen: boolean; packets: number; bytes: number; sendAttempted: boolean; returned: boolean; queryEnded: boolean; queryErrored: boolean;
  accountingStarted: boolean; accountingAttempted: boolean; accountingLeft: boolean; accountingFailed: boolean; leave?: () => void;
}
interface Binding { context: DatabaseBackupMysqlLockContext; managed: DatabaseBackupMysqlLockContext['managed']; connection: DatabaseBackupMysqlLockContext['managed']['connection']; signal: AbortSignal | undefined; stream: EventEmitter | undefined; errored: boolean; ended: boolean; transportClosed: boolean; config: object; query: DatabaseBackupMysqlLockContext['managed']['connection']['query']; execute: DatabaseBackupMysqlLockContext['managed']['connection']['execute']; check: () => void; begin: () => () => void; thread: string; }
/** 底层流已关闭或读端结束时，即使Managed尚未更新broken也不能发新命令。 */
function streamEnded(stream: EventEmitter | undefined): boolean { const value = stream as (EventEmitter & { closed?: boolean; destroyed?: boolean; readableEnded?: boolean }) | undefined; return value?.closed === true || value?.destroyed === true || value?.readableEnded === true; }
export interface DatabaseBackupMysqlLockCommandRetained { readonly query: Query | null; readonly result: Promise<void>; readonly nativeEnd: Promise<void>; readonly accountingEnd: Promise<void>; readonly statement: Statement; readonly sql: string; readonly params: readonly string[]; readonly rows: readonly Row[]; }
export interface DatabaseBackupMysqlLockOperationRetained { readonly result: Promise<DatabaseBackupMysqlLockOutcome>; readonly work: Promise<void> | undefined; }

/** 稳定操作仅通过wait交付无敏感观察编号；原Promise和工作流程只在Root显式retained中。 */
export class DatabaseBackupMysqlLockOperation {
  #record: ActionRecord; #wait: () => Promise<DatabaseBackupMysqlLockOutcome>; #retained: (owner: DatabaseBackupMysqlLockOwner) => DatabaseBackupMysqlLockOperationRetained;
  constructor(record: ActionRecord, wait: () => Promise<DatabaseBackupMysqlLockOutcome>, retained: (owner: DatabaseBackupMysqlLockOwner) => DatabaseBackupMysqlLockOperationRetained) { this.#record = record; this.#wait = wait; this.#retained = retained; Object.freeze(this); }
  wait(): Promise<DatabaseBackupMysqlLockOutcome> { return this.#wait(); }
  retained(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockOperationRetained { return this.#retained(owner); }
  snapshot() { const r = this.#record; return Object.freeze({ slot: r.slot, kind: r.kind, finished: r.finished, stopRequested: r.stopRequested, stopFailed: r.stopFailed }); }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
/** 命令返回、query-end、记账离开是独立事实；error或取消不能代替任意一项。 */
export class DatabaseBackupMysqlLockCommand {
  #record: CommandRecord; #retained: (owner: DatabaseBackupMysqlLockOwner) => DatabaseBackupMysqlLockCommandRetained;
  constructor(record: CommandRecord, retained: (owner: DatabaseBackupMysqlLockOwner) => DatabaseBackupMysqlLockCommandRetained) { this.#record = record; this.#retained = retained; Object.freeze(this); }
  retained(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockCommandRetained { return this.#retained(owner); }
  snapshot() { const r = this.#record; return Object.freeze({ slot: r.slot, source: r.role === 'source', sendAttempted: r.sendAttempted, returned: r.returned, queryEnded: r.queryEnded, queryErrored: r.queryErrored, accountingStarted: r.accountingStarted, accountingAttempted: r.accountingAttempted, accountingLeft: r.accountingLeft, accountingFailed: r.accountingFailed, rows: r.rows.length, packets: r.packets, bytes: r.bytes }); }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
/** 永久任务号占位，保留原actor，不因超时驱逐或允许ABA换新实例。 */
export class DatabaseBackupMysqlLockOwners {
  #entries = new Map<string, DatabaseBackupMysqlLock>();
  constructor(private readonly capacity = 32) { need(Number.isSafeInteger(capacity) && capacity >= 1 && capacity <= 64); }
  register(taskId: string, actor: DatabaseBackupMysqlLock): void { const previous = this.#entries.get(taskId); if (previous) { previous.invalidate(); throw blocked(); } need(this.#entries.size < this.capacity); this.#entries.set(taskId, actor); }
}

/** Root私有MySQL8.4.11 FTWRL原语；不建立/重连/关闭连接，不KILL、不修改仪表，不声称完整备份能力。 */
export class DatabaseBackupMysqlLock {
  #owner: DatabaseBackupMysqlLockOwner; #bound: Readonly<DatabaseBackupMysqlLockOwner>; #hooks: DatabaseBackupMysqlLockHooks; #bindings!: Record<Role, Binding>;
  #options: Required<DatabaseBackupMysqlLockOptions>; #phase: Phase = 'idle'; #unknown = false; #cancelled = false; #entering = false;
  #actions: ActionRecord[] = []; #commands: CommandRecord[] = []; #active: ActionRecord | null = null; #command: CommandRecord | null = null;
  #timer?: ReturnType<typeof setTimeout>; #deadline = 0; #bytes = 0; #observations = 0; #flushAttempted = false; #flushCompleted = false; #unlockAttempted = false; #unlockCompleted = false;
  #uuid?: string; #sourceId?: string; #controlId?: string; #sourceThread?: string; #uptime?: bigint; #locks: readonly Row[] = []; #releasePermit?: DatabaseBackupMysqlLockReleasePermit;
  constructor(owner: DatabaseBackupMysqlLockOwner, source: DatabaseBackupMysqlLockContext, control: DatabaseBackupMysqlLockContext, hooks: DatabaseBackupMysqlLockHooks, owners: DatabaseBackupMysqlLockOwners, options: DatabaseBackupMysqlLockOptions = {}) {
    this.#owner = owner; this.#bound = Object.freeze({ taskId: owner.taskId, planToken: owner.planToken, connectionRevision: owner.connectionRevision, sourceLease: owner.sourceLease, controlLease: owner.controlLease });
    this.#hooks = Object.freeze({ checkLease: hooks.checkLease.bind(hooks), registerOperation: hooks.registerOperation.bind(hooks), registerCommand: hooks.registerCommand.bind(hooks), requestStop: hooks.requestStop.bind(hooks), releasePermit: hooks.releasePermit.bind(hooks) });
    this.#options = { budgetMs: options.budgetMs ?? 10000, maxCommands: options.maxCommands ?? 128, maxObservations: options.maxObservations ?? 4, maxBytes: options.maxBytes ?? 262144 };
    try {
      for (const value of Object.values(this.#bound)) need(typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\x00-\x1f]/u.test(value));
      owners.register(this.#bound.taskId, this); need(this.#bound.sourceLease !== this.#bound.controlLease);
      need(Number.isSafeInteger(this.#options.budgetMs) && this.#options.budgetMs >= 1 && this.#options.budgetMs <= 30000);
      need(Number.isSafeInteger(this.#options.maxCommands) && this.#options.maxCommands >= 1 && this.#options.maxCommands <= 128);
      need(Number.isSafeInteger(this.#options.maxObservations) && this.#options.maxObservations >= 1 && this.#options.maxObservations <= 4);
      need(Number.isSafeInteger(this.#options.maxBytes) && this.#options.maxBytes >= 1 && this.#options.maxBytes <= 1048576);
      need(source !== control && source.managed !== control.managed && source.managed.connection !== control.managed.connection);
      const bind = (context: DatabaseBackupMysqlLockContext): Binding => {
        const managed = context.managed, connection = managed.connection, id = connection.threadId;
        need(managed.status.dialect === 'mysql' && Number.isSafeInteger(id) && id > 0 && id <= 4294967295);
        const stream = (connection as unknown as { stream?: EventEmitter }).stream;
        need(stream === undefined || stream && typeof stream.on === 'function');
        return { context, managed, connection, signal: managed.signal, stream, errored: false, ended: false, transportClosed: false, config: configuration(connection), query: connection.query, execute: connection.execute, check: context.checkCancelled.bind(context), begin: context.commandStarted.bind(context), thread: String(id) };
      };
      this.#bindings = { source: bind(source), control: bind(control) }; need(this.#bindings.source.thread !== this.#bindings.control.thread);
      for (const binding of Object.values(this.#bindings)) {
        binding.connection.on('error', () => { binding.errored = true; this.#fail('driver'); }); binding.connection.on('end', () => { binding.ended = true; this.#fail('driver'); });
        binding.stream?.on('close', () => { binding.transportClosed = true; this.#fail('driver'); }); binding.stream?.on('error', () => { binding.errored = true; this.#fail('driver'); }); binding.stream?.on('end', () => { binding.ended = true; this.#fail('driver'); });
        binding.signal?.addEventListener('abort', () => this.requestCancel(this.#owner), { once: true });
      }
      this.#check();
    } catch { this.#fail('invalid'); throw blocked(); }
  }
  /** 只用原owner对象获取私有恢复账本，即使当前lease已坏也不把原账本隐藏或清除。 */
  #private(owner: DatabaseBackupMysqlLockOwner): void { need(owner === this.#owner); }
  #check(): void {
    try {
      need(!this.#unknown && Object.entries(this.#bound).every(([key, value]) => this.#owner[key as keyof DatabaseBackupMysqlLockOwner] === value));
      if (this.#deadline) need(performance.now() < this.#deadline);
      for (const b of Object.values(this.#bindings)) { syncVoid(b.check(), () => this.#fail('invalid')); need(this.#intact(b)); }
      syncVoid(this.#hooks.checkLease(this.#bound, this.#command?.handle ?? null), () => this.#fail('invalid'));
      need(!this.#unknown && (!this.#deadline || performance.now() < this.#deadline) && Object.entries(this.#bound).every(([key, value]) => this.#owner[key as keyof DatabaseBackupMysqlLockOwner] === value) && Object.values(this.#bindings).every(b => this.#intact(b)));
    } catch { this.#fail('invalid'); throw blocked(); }
  }
  /** Root钩子返回后再核原对象，防止同步回调在最后一个检查窗口换绑。 */
  #intact(b: Binding): boolean { return b.context.managed === b.managed && b.managed.connection === b.connection && b.managed.signal === b.signal && (b.connection as unknown as { stream?: EventEmitter }).stream === b.stream && !streamEnded(b.stream) && !b.managed.broken && !b.signal?.aborted && !b.errored && !b.ended && !b.transportClosed && String(b.connection.threadId) === b.thread && b.connection.query === b.query && b.connection.execute === b.execute && configuration(b.connection) === b.config; }
  /** 失效立即拒绝公共结果，但不伪造Query-end、记账离开或锁释放；晚到事件继续归原记录。 */
  #fail(reason: DatabaseBackupMysqlLockReason): void {
    this.#unknown = true; this.#phase = 'unknown';
    for (const action of this.#actions) action.result.reject(blocked());
    this.#command?.result.reject(blocked());
    const action = this.#active ?? this.#actions.at(-1);
    if (action && !action.stopRequested) { action.stopRequested = true; try { syncVoid(this.#hooks.requestStop(action.handle, this.#command?.handle ?? null, reason), () => { action.stopFailed = true; }); } catch { action.stopFailed = true; } }
  }
  invalidate(): void { this.#fail('invalid'); }
  requestCancel(owner: DatabaseBackupMysqlLockOwner): void { this.#private(owner); this.#cancelled = true; this.#fail('cancelled'); }
  /** 先创建/登记稳定操作和结果Promise，工作流程下一microtask才可发送第一条SQL。 */
  #start(owner: DatabaseBackupMysqlLockOwner, kind: Kind): DatabaseBackupMysqlLockOperation {
    if (this.#entering) { this.#fail('invalid'); throw blocked(); } this.#entering = true;
    try {
      this.#private(owner); this.#check(); need(!this.#active && !this.#command && this.#actions.length < 6);
      need(kind === 'acquire' ? this.#phase === 'idle' : this.#phase === 'observed');
      if (kind !== 'release') need(this.#observations < this.#options.maxObservations);
      const action = { kind, slot: this.#actions.length + 1, result: deferred<DatabaseBackupMysqlLockOutcome>(), finished: false, stopRequested: false, stopFailed: false } as ActionRecord;
      action.handle = new DatabaseBackupMysqlLockOperation(action, () => action.result.promise.then(result => { this.#check(); need(result.state === 'released' ? this.#phase === 'released' : this.#phase === 'observed' && result.observation === this.#observations); return result; }), requested => { this.#private(requested); return Object.freeze({ result: action.result.promise, work: action.work }); });
      this.#actions.push(action); this.#active = action;
      syncVoid(this.#hooks.registerOperation(action.handle), () => this.#fail('invalid')); this.#check();
      if (!this.#deadline) { this.#deadline = performance.now() + this.#options.budgetMs; this.#timer = setTimeout(() => this.#fail('timeout'), this.#options.budgetMs); this.#timer.unref(); }
      this.#phase = kind === 'acquire' ? 'acquiring' : kind === 'observe' ? 'observing' : 'releasing';
      action.work = Promise.resolve().then(async () => {
        try {
          this.#check();
          if (kind === 'acquire') { await this.#sample(action, false); this.#check(); this.#flushAttempted = true; await this.#run(action, 'source', 'flush'); this.#check(); this.#flushCompleted = true; await this.#sample(action, true); }
          else if (kind === 'observe') await this.#sample(action, true);
          else {
            this.#releasePermit = this.#hooks.releasePermit(this.#owner); this.#permit(); this.#check();
            await this.#sample(action, true); this.#permit(); this.#check();
            this.#unlockAttempted = true; await this.#run(action, 'source', 'unlock'); this.#check(); this.#unlockCompleted = true;
            await this.#sample(action, false);
          }
          this.#check(); need(!this.#command); action.finished = true; this.#active = null;
          if (kind === 'release') { this.#phase = 'released'; if (this.#timer) clearTimeout(this.#timer); this.#deadline = 0; }
          else { this.#observations++; this.#phase = 'observed'; }
          action.result.resolve(Object.freeze({ state: kind === 'release' ? 'released' : 'observed', observation: this.#observations }));
        } catch { this.#fail('invalid'); }
      }); void action.work.catch(() => this.#fail('invalid'));
      return action.handle;
    } catch { this.#fail('invalid'); throw blocked(); } finally { this.#entering = false; }
  }
  acquire(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockOperation { return this.#start(owner, 'acquire'); }
  observe(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockOperation { return this.#start(owner, 'observe'); }
  release(owner: DatabaseBackupMysqlLockOwner): DatabaseBackupMysqlLockOperation { return this.#start(owner, 'release'); }
  /** 许可是Root不可逆Scope事实；对原对象和所有字段逐次核验，不接受Promise或thenable。 */
  #permit(): void {
    const p = this.#releasePermit; if (p && typeof p === 'object' && 'then' in p) { void Promise.resolve(p).catch(() => this.#fail('invalid')); throw blocked(); } need(p && typeof p === 'object' && p.owner === this.#owner && p.originalOperationLeft === true && p.serverOperationsEnded === true);
    need(p.dumpNeverStarted === true || p.dumpNeverStarted === false && p.dumpProcessClosed === true && p.dumpStreamsClosed === true);
  }
  /** 每条实际SQL先预登记命令、Promise和记账槽位；只有query-end后才调用原commandFinished。 */
  async #run(action: ActionRecord, role: Role, statement: Statement, params: readonly string[] = []): Promise<readonly Row[]> {
    this.#check(); need(!this.#command && this.#commands.length < this.#options.maxCommands);
    need(params.length === (statement === 'thread' ? 1 : statement === 'locks' ? 2 : 0)); for (const value of params) decimal(value);
    const record = { slot: this.#commands.length + 1, role, statement, params: Object.freeze([...params]), action, query: null, result: deferred<void>(), nativeEnd: deferred<void>(), accountingEnd: deferred<void>(), rows: [], fieldsSeen: false, packets: 0, bytes: 0, sendAttempted: false, returned: false, queryEnded: false, queryErrored: false, accountingStarted: false, accountingAttempted: false, accountingLeft: false, accountingFailed: false } as CommandRecord;
    record.handle = new DatabaseBackupMysqlLockCommand(record, owner => { this.#private(owner); return Object.freeze({ query: record.query, result: record.result.promise, nativeEnd: record.nativeEnd.promise, accountingEnd: record.accountingEnd.promise, statement: record.statement, sql: databaseBackupMysqlLockSql[record.statement], params: record.params, rows: Object.freeze([...record.rows]) }); });
    this.#commands.push(record); this.#command = record;
    const binding = this.#bindings[role], ack = statement === 'flush' || statement === 'unlock';
    try {
      syncVoid(this.#hooks.registerCommand(record.handle), () => this.#fail('invalid')); this.#check();
      record.accountingStarted = true;
      try { record.leave = binding.begin(); need(typeof record.leave === 'function'); } catch { record.accountingFailed = true; throw blocked(); }
      this.#check();
      // Root同步钩子也可能改变许可；紧贴原UNLOCK发送再次核验，不能沿用早先的true。
      if (statement === 'unlock') this.#permit();
      record.sendAttempted = true;
      const options = { sql: databaseBackupMysqlLockSql[statement], rowsAsArray: false, nestTables: false as const, namedPlaceholders: false, typeCast: true as const, supportBigNumbers: true, bigNumberStrings: true };
      record.query = params.length ? binding.connection.execute(options, [...params]) : binding.connection.query(options); record.returned = true;
      const event = (action: () => void) => { try { action(); } catch { record.result.reject(blocked()); this.#fail('driver'); } };
      record.query.on('fields', (value: unknown, index?: number) => event(() => {
        this.#check(); need(!ack && !record.fieldsSeen && !record.queryEnded && (index === undefined || index === 0));
        const names = fields[statement as Exclude<Statement, 'flush' | 'unlock'>]; need(Array.isArray(value) && value.length === names.length && value.every((field, at) => field?.name === names[at])); record.fieldsSeen = true;
      }));
      record.query.on('result', (value: unknown, index?: number) => event(() => {
        this.#check(); need(index === 0 && !record.queryEnded && value && typeof value === 'object' && !Array.isArray(value)); record.packets++;
        if (ack) { const packet = value as Record<string, unknown>; need(record.packets === 1 && !record.fieldsSeen && packet.fieldCount === 0 && packet.affectedRows === 0 && packet.warningStatus === 0 && Number.isSafeInteger(packet.serverStatus) && (Number(packet.serverStatus) & 1) === 0); return; }
        need(record.fieldsSeen && record.rows.length < 3); const names = fields[statement as Exclude<Statement, 'flush' | 'unlock'>], entries = Object.entries(value); need(entries.length === names.length && entries.every(([key]) => names.includes(key)));
        let bytes = 0; const row: Record<string, string | number | null> = Object.create(null);
        for (const [key, item] of entries) { need(item === null || typeof item === 'string' && item.length <= 512 || typeof item === 'number' && Number.isSafeInteger(item)); bytes += Buffer.byteLength(key) + (typeof item === 'string' ? Buffer.byteLength(item) : 16); row[key] = item; }
        need(bytes <= 8192 && this.#bytes + bytes <= this.#options.maxBytes); this.#bytes += bytes; record.bytes += bytes; record.rows.push(Object.freeze(row));
      }));
      record.query.on('error', () => { record.queryErrored = true; this.#fail('driver'); });
      record.query.on('end', () => event(() => {
        need(!record.queryEnded); record.queryEnded = true; record.nativeEnd.resolve();
        if (!record.accountingAttempted) {
          record.accountingAttempted = true;
          try { need(typeof record.leave === 'function'); syncVoid(record.leave(), () => { record.accountingFailed = true; this.#fail('invalid'); }); record.accountingLeft = true; record.accountingEnd.resolve(); }
          catch { record.accountingFailed = true; this.#fail('invalid'); }
        }
        if (this.#command === record && record.accountingLeft) this.#command = null;
        this.#check(); need(!record.queryErrored && record.accountingLeft && (ack ? record.packets === 1 : record.fieldsSeen)); record.result.resolve();
      })); this.#check();
    } catch { this.#fail('invalid'); }
    await record.result.promise; this.#check(); need(record.returned && record.queryEnded && record.accountingLeft && !record.queryErrored); return Object.freeze([...record.rows]);
  }
  /** 同一准确版本/实例和两条不同原连接；不把server_uuid当启动世代或重连许可。 */
  async #identity(action: ActionRecord, role: Role): Promise<void> {
    const rows = await this.#run(action, role, 'identity'); this.#check(); need(rows.length === 1); const row = rows[0], id = decimal(row.session_id);
    need(id === this.#bindings[role].thread && row.server_version === '8.4.11' && typeof row.server_flavor === 'string' && /^(?:MySQL Community Server - GPL|MySQL Enterprise Server - Commercial)$/u.test(row.server_flavor));
    need(typeof row.server_uuid === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(row.server_uuid) && (row.performance_schema_enabled === 1 || row.performance_schema_enabled === '1'));
    if (this.#uuid === undefined) this.#uuid = row.server_uuid; need(this.#uuid === row.server_uuid);
    if (role === 'source') { this.#sourceId ??= id; need(this.#sourceId === id); } else { this.#controlId ??= id; need(this.#controlId === id && id !== this.#sourceId); }
  }
  async #mapping(action: ActionRecord): Promise<void> {
    const rows = await this.#run(action, 'control', 'thread', [this.#sourceId!]); this.#check(); need(rows.length === 1); const row = rows[0];
    need(decimal(row.session_id) === this.#sourceId && row.TYPE === 'FOREGROUND' && (row.INSTRUMENTED === 'YES' || row.INSTRUMENTED === 'NO')); const thread = decimal(row.thread_id); this.#sourceThread ??= thread; need(thread === this.#sourceThread);
  }
  async #instruments(action: ActionRecord): Promise<void> {
    const instruments = await this.#run(action, 'control', 'instrument'); this.#check(); need(instruments.length === 1 && instruments[0].NAME === 'wait/lock/metadata/sql/mdl' && instruments[0].ENABLED === 'YES' && ['YES', 'NO'].includes(String(instruments[0].TIMED)));
    const consumers = await this.#run(action, 'control', 'consumers'); this.#check(); need(consumers.length === 2); const map = new Map(consumers.map(row => [row.NAME, row.ENABLED])); need(map.size === 2 && map.get('global_instrumentation') === 'YES' && ['YES', 'NO'].includes(String(map.get('thread_instrumentation'))));
  }
  async #status(action: ActionRecord): Promise<void> {
    const rows = await this.#run(action, 'control', 'status'); this.#check(); need(rows.length === 3); const map = new Map(rows.map(row => [row.Variable_name, row.Value])); need(map.size === 3);
    need(decimal(map.get('Performance_schema_metadata_lock_lost'), true) === '0' && decimal(map.get('Performance_schema_thread_instances_lost'), true) === '0');
    const uptime = BigInt(decimal(map.get('Uptime'), true)); need(this.#uptime === undefined || uptime >= this.#uptime); this.#uptime = uptime;
  }
  /** 前后仪表、映射和身份采样只给观察证据；连续独占及完整备份窗口由Root Scope保证。 */
  async #sample(action: ActionRecord, held: boolean): Promise<void> {
    await this.#identity(action, 'source'); await this.#identity(action, 'control'); await this.#mapping(action); await this.#instruments(action); await this.#status(action);
    const rows = await this.#run(action, 'control', 'locks', [this.#sourceThread!, this.#sourceId!]); this.#check(); need(rows.length === (held ? 2 : 0));
    const expected = new Set(['GLOBAL', 'COMMIT']);
    for (const row of rows) { need(decimal(row.thread_id) === this.#sourceThread && decimal(row.session_id) === this.#sourceId && row.TYPE === 'FOREGROUND' && ['YES', 'NO'].includes(String(row.INSTRUMENTED)) && expected.delete(String(row.OBJECT_TYPE)) && row.LOCK_TYPE === 'SHARED' && row.LOCK_DURATION === 'EXPLICIT' && row.LOCK_STATUS === 'GRANTED'); need(row.OBJECT_SCHEMA === null || typeof row.OBJECT_SCHEMA === 'string'); need(row.OBJECT_NAME === null || typeof row.OBJECT_NAME === 'string'); decimal(row.instance_address); decimal(row.owner_event_id); }
    if (held) need(expected.size === 0);
    await this.#status(action); await this.#instruments(action); await this.#mapping(action); await this.#identity(action, 'control'); await this.#identity(action, 'source'); this.#check(); this.#locks = Object.freeze([...rows]);
  }
  /** 显式私有恢复出口；不得传入IPC、日志或任务事件，原连接/Query/Promise永久归本实例。 */
  retained(owner: DatabaseBackupMysqlLockOwner) { this.#private(owner); return Object.freeze({ owner: this.#bound, source: this.#bindings.source.context, control: this.#bindings.control.context, sourceManaged: this.#bindings.source.managed, controlManaged: this.#bindings.control.managed, sourceConnection: this.#bindings.source.connection, controlConnection: this.#bindings.control.connection, serverUuid: this.#uuid, sourceId: this.#sourceId, controlId: this.#controlId, sourceThread: this.#sourceThread, locks: this.#locks, operations: Object.freeze(this.#actions.map(action => action.handle)), commands: Object.freeze(this.#commands.map(command => command.handle!)) }); }
  snapshot() { try { if (!this.#unknown) this.#check(); } catch { /* 失败事实通过unknown及原账本对Root可见。 */ } const bindings = Object.values(this.#bindings); return Object.freeze({ phase: this.#phase, unknown: this.#unknown, cancelled: this.#cancelled, operations: this.#actions.length, commands: this.#commands.length, active: !!this.#active, pendingCommand: !!this.#command, observations: this.#observations, bytes: this.#bytes, connectionErrors: bindings.filter(b => b.errored).length, connectionEnds: bindings.filter(b => b.ended).length, transportClosed: bindings.filter(b => b.transportClosed).length, flushAttempted: this.#flushAttempted, flushCompleted: this.#flushCompleted, unlockAttempted: this.#unlockAttempted, unlockCompleted: this.#unlockCompleted, observedLockRows: this.#locks.length }); }
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
