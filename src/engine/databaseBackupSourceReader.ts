import { tracingChannel } from 'node:diagnostics_channel';
import { types } from 'node:util';
import type { Query } from 'mysql2';
import { databaseBackupSourceSql, DatabaseBackupSourceLimitError, type DatabaseBackupSourceContext, type DatabaseBackupSourceRead } from './databaseBackupSource';
import type { StructureTaskContext } from './structureDefinition';
import { identifier } from './sql';

type Row = Record<string, unknown>;
type Context = Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>;
export interface DatabaseBackupSourceReaderOwner {
  readonly taskId: string; readonly connectionId: string; readonly connectionRevision: string;
  readonly sourceLease: string; readonly threadId: number;
}
export type DatabaseBackupSourceReadStop = 'cancelled' | 'timeout' | 'limit' | 'lease-invalid' | 'driver-error' | 'protocol-invalid' | 'submission-unknown' | 'registration-failed';
export type DatabaseBackupSourceNativeEvent = 'not-submitted' | 'query-end' | 'query-error' | 'connection-end' | 'connection-error';
export interface DatabaseBackupSourceReadOperation {
  readonly owner: Readonly<DatabaseBackupSourceReaderOwner>;
  /** 私有原生句柄；Root 在 register 时先登记本操作，发送返回后可取同一 Query，绝不传 renderer。 */
  readonly query: Query | null;
  readonly result: Promise<{ rows: readonly Row[]; complete: true }>;
  /** 仅原生事件观察，不表示服务器取消已确认或附属资源已释放。 */
  readonly nativeTerminal: Promise<DatabaseBackupSourceNativeEvent>;
  snapshot(): Readonly<{
    reading: 'reading' | 'stopped' | 'completed'; submission: 'not-submitted' | 'started' | 'returned' | 'unknown';
    nativeEvent: DatabaseBackupSourceNativeEvent | null; queryEnded: boolean; queryErrored: boolean;
    connectionEnded: boolean; connectionErrored: boolean; stopRequested: boolean; stopRequestFailed: boolean;
    accountingFailed: boolean; retainedRows: number; acceptedRows: number; acceptedBytes: number;
  }>;
  cancel(owner: DatabaseBackupSourceReaderOwner, reason?: 'cancelled' | 'timeout'): void;
}
export interface DatabaseBackupSourceReaderHooks {
  /** 同步检查当前 owner/租约，失效必须抛错；不得仅检查调用方自报的字符串。 */
  checkOwner(owner: Readonly<DatabaseBackupSourceReaderOwner>): void;
  /** 同步预登记稳定操作句柄；不得在此发送 SQL 或启动异步分配。 */
  register(operation: DatabaseBackupSourceReadOperation): void;
  /** 只同步登记 Root 的原命令停止请求；返回不构成 KILL/原命令/资源终态。 */
  requestStop(operation: DatabaseBackupSourceReadOperation, reason: DatabaseBackupSourceReadStop): void;
}

/** 对外仅输出固定错误，原驱动错误、SQL、授权正文及 cause 都不透传。 */
function safeError(reason: DatabaseBackupSourceReadStop): Error {
  if (reason === 'limit') return new DatabaseBackupSourceLimitError('源读取超出行数或字节预算，未返回部分结果');
  return Object.assign(new Error('备份源读取未完整成功；原操作由 Root 协调收尾'), { code: 'DBARK_BACKUP_SOURCE_READ_FAILED', reason });
}
/** 仅接受源模块固定语句；目录值走真正预处理参数，SHOW 名称须为既有引用器的规范形式。 */
function statementCopy(input: DatabaseBackupSourceRead): DatabaseBackupSourceRead {
  const statement = { ...input, params: [...input.params] };
  if (statement.sensitiveResult !== true || !Number.isSafeInteger(statement.maxRows) || statement.maxRows < 1 || statement.maxRows > 10001 || !Number.isSafeInteger(statement.maxBytes) || statement.maxBytes < 1 || statement.maxBytes > 2 * 1024 * 1024) throw safeError('protocol-invalid');
  const catalogue = ['schemas', 'tables', 'views', 'triggers', 'routines', 'events'].includes(statement.id);
  if (Object.hasOwn(databaseBackupSourceSql, statement.id)) {
    if (statement.sql !== databaseBackupSourceSql[statement.id as keyof typeof databaseBackupSourceSql] || statement.params.length !== (catalogue ? 1 : 0)) throw safeError('protocol-invalid');
    if (catalogue) identifier(statement.params[0]);
  } else {
    const verbs: Record<string, string> = { 'show-database': 'DATABASE', 'show-table': 'TABLE', 'show-view': 'VIEW', 'show-trigger': 'TRIGGER', 'show-procedure': 'PROCEDURE', 'show-function': 'FUNCTION', 'show-event': 'EVENT' };
    const verb = verbs[statement.id];
    const match = verb && new RegExp('^SHOW CREATE ' + verb + ' (`(?:[^`]|``)*`)(?:\\.(`(?:[^`]|``)*`))?$').exec(statement.sql);
    if (!match || statement.params.length || Boolean(match[2]) !== (verb !== 'DATABASE')) throw safeError('protocol-invalid');
    for (const quoted of match.slice(1).filter(Boolean)) { const value = quoted.slice(1, -1).replace(/``/g, '`'); if (identifier(value) !== quoted) throw safeError('protocol-invalid'); }
  }
  Object.freeze(statement.params); return Object.freeze(statement);
}
/** 与 Source 层相同的行值计量；在保留行之前核预算，不序列化授权正文或调用值的自定义方法。 */
function rowCopy(value: unknown, budget: number): { row: Row; bytes: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw safeError('protocol-invalid');
  let bytes = 0; const row: Row = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    bytes += Buffer.byteLength(key, 'utf8');
    if (typeof item === 'string') bytes += Buffer.byteLength(item, 'utf8');
    else if (Buffer.isBuffer(item)) bytes += item.length;
    else if (item instanceof Date) bytes += 32;
    else if (item === null || typeof item === 'number' || typeof item === 'boolean') bytes += 16;
    else throw safeError('protocol-invalid');
    if (bytes > budget) throw safeError('limit');
    row[key] = Buffer.isBuffer(item) ? Buffer.from(item) : item instanceof Date ? new Date(item.getTime()) : item;
  }
  return { row, bytes };
}

/** 不执行配置 getter；mysql2 的布尔 typeCast 会回退连接级函数，必须在发送前排除此组合。 */
function privateConfiguration(connection: Context['managed']['connection']): { config: object; typeCast: boolean | undefined } | null {
  try {
    if (types.isProxy(connection)) return null;
    const binding = Object.getOwnPropertyDescriptor(connection, 'config');
    if (!binding || !('value' in binding) || !binding.value || typeof binding.value !== 'object' || types.isProxy(binding.value)) return null;
    const config: object = binding.value;
    /** 只接受可静态读取的数据描述符；原型上的 getter/代理同样不能作为默认配置。 */
    const option = (key: string): { value: unknown } | null => {
      let target: object | null = config;
      for (let depth = 0; target && depth < 32; depth++, target = Object.getPrototypeOf(target)) {
        if (types.isProxy(target)) return null;
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (descriptor) return 'value' in descriptor ? { value: descriptor.value } : null;
      }
      return target ? null : { value: undefined };
    };
    const debug = option('debug'), format = option('queryFormat'), cast = option('typeCast');
    if (!debug || debug.value || !format || typeof format.value === 'function' || !cast || cast.value !== undefined && typeof cast.value !== 'boolean') return null;
    return { config, typeCast: cast.value as boolean | undefined };
  } catch { return null; }
}

/** 一个私有物理会话的串行行事件读取器；失败后封存，Root 保留原句柄，绝不自动重试或重连。 */
export class DatabaseBackupSourceReader {
  readonly context: DatabaseBackupSourceContext;
  private readonly bound: Readonly<DatabaseBackupSourceReaderOwner>;
  private readonly managed: Context['managed'];
  private readonly connection: Context['managed']['connection'];
  private readonly signal: AbortSignal | undefined;
  private readonly checkTask: () => void;
  private readonly commandStarted: Context['commandStarted'];
  private readonly hooks: DatabaseBackupSourceReaderHooks;
  private active: DatabaseBackupSourceReadOperation | null = null;
  private sealed = false;
  private entering = false;

  constructor(private readonly source: Context, private readonly owner: DatabaseBackupSourceReaderOwner, hooks: DatabaseBackupSourceReaderHooks) {
    this.bound = Object.freeze({ ...owner }); this.managed = source.managed; this.connection = this.managed.connection; this.signal = this.managed.signal;
    this.checkTask = source.checkCancelled.bind(source); this.commandStarted = source.commandStarted.bind(source);
    this.hooks = Object.freeze({ checkOwner: hooks.checkOwner.bind(hooks), register: hooks.register.bind(hooks), requestStop: hooks.requestStop.bind(hooks) });
    if (['taskId', 'connectionId', 'connectionRevision', 'sourceLease'].some(key => { const value = this.bound[key as keyof DatabaseBackupSourceReaderOwner]; return typeof value !== 'string' || !value || value.length > 200 || value.includes('\0'); }) || !Number.isSafeInteger(this.bound.threadId) || this.bound.threadId < 1) throw safeError('lease-invalid');
    this.context = Object.freeze({ checkCancelled: () => this.check(this.owner), read: (statement: DatabaseBackupSourceRead) => this.start(this.owner, statement).result });
  }
  /** 身份既要求原 owner 对象，又逐字段核原绑定，并由 Root 当前租约注册表核验。 */
  private checkOwner(owner: DatabaseBackupSourceReaderOwner): void {
    try { if (owner !== this.owner || Object.entries(this.bound).some(([key, value]) => owner[key as keyof DatabaseBackupSourceReaderOwner] !== value)) throw Error(); this.hooks.checkOwner(this.bound); }
    catch { throw safeError('lease-invalid'); }
  }
  private check(owner: DatabaseBackupSourceReaderOwner): void {
    this.checkOwner(owner);
    try { this.checkTask(); if (this.source.managed !== this.managed || this.managed.connection !== this.connection || this.managed.signal !== this.signal || this.managed.broken || this.signal?.aborted || this.connection.threadId !== this.bound.threadId) throw Error(); }
    catch { throw safeError('lease-invalid'); }
  }
  /** 在任何驱动发送前锁住 reader、同步登记操作及命令；无回调模式避免 mysql2 汇总整批行。 */
  start(owner: DatabaseBackupSourceReaderOwner, input: DatabaseBackupSourceRead): DatabaseBackupSourceReadOperation {
    if (this.entering) throw safeError('protocol-invalid');
    this.entering = true;
    try { return this.startOwned(owner, input); } finally { this.entering = false; }
  }
  /** 输入 getter 与 Root 钩子也处于同步进入门内，不能在正式登记前重入发送第二句。 */
  private startOwned(owner: DatabaseBackupSourceReaderOwner, input: DatabaseBackupSourceRead): DatabaseBackupSourceReadOperation {
    this.check(owner);
    if (this.active || this.sealed) throw safeError('protocol-invalid');
    let statement: DatabaseBackupSourceRead;
    try { statement = statementCopy(input); } catch { throw safeError('protocol-invalid'); }
    // 敏感读取不接受外部字段回调或动态配置；只核对，不修改原连接的全局 config。
    const initialConfiguration = privateConfiguration(this.connection);
    const privateDriver = (): boolean => {
      const current = privateConfiguration(this.connection);
      return Boolean(initialConfiguration && current && current.config === initialConfiguration.config && current.typeCast === initialConfiguration.typeCast && !['mysql2:query', 'mysql2:execute'].some(key => tracingChannel(key).hasSubscribers));
    };
    if (!privateDriver()) throw safeError('protocol-invalid');
    let query: Query | null = null, rows: Row[] = [], acceptedRows = 0, acceptedBytes = 0;
    let reading: 'reading' | 'stopped' | 'completed' = 'reading', submission: 'not-submitted' | 'started' | 'returned' | 'unknown' = 'not-submitted';
    let nativeEvent: DatabaseBackupSourceNativeEvent | null = null, queryEnded = false, queryErrored = false, connectionEnded = false, connectionErrored = false;
    let stopRequested = false, stopRequestFailed = false, accountingFailed = false, fieldsSeen = false, sendAttempted = false, commandFinished: (() => void) | undefined;
    let resolveResult!: (value: { rows: readonly Row[]; complete: true }) => void, rejectResult!: (error: Error) => void, resolveNative!: (event: DatabaseBackupSourceNativeEvent) => void;
    const result = new Promise<{ rows: readonly Row[]; complete: true }>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    void result.catch(() => undefined);
    const nativeTerminal = new Promise<DatabaseBackupSourceNativeEvent>(resolve => { resolveNative = resolve; });
    /** 停止接纳与请求停止是两件事；先封存/清空，再调用 Root，不等待 ACK，也不伪造原生终态。 */
    const stop = (reason: DatabaseBackupSourceReadStop): void => {
      if (reading !== 'reading') return;
      reading = 'stopped'; rows = []; this.sealed = true; rejectResult(safeError(reason));
      if (sendAttempted && !stopRequested) {
        stopRequested = true;
        try {
          const response: unknown = this.hooks.requestStop(operation, reason);
          if (response !== undefined) { stopRequestFailed = true; void Promise.resolve(response).catch(() => { stopRequestFailed = true; }); }
        } catch { stopRequestFailed = true; }
      }
    };
    /** 原命令编号只由首个原生事件结算；cancel/timeout/超限不调用此函数。 */
    const observe = (event: DatabaseBackupSourceNativeEvent): void => {
      if (nativeEvent) return;
      nativeEvent = event;
      try { commandFinished?.(); } catch { accountingFailed = true; stop('protocol-invalid'); }
      resolveNative(event);
      this.connection.removeListener('error', connectionError); this.connection.removeListener('end', connectionEnd);
      this.signal?.removeEventListener('abort', aborted);
    };
    const checkReceiving = (): boolean => { if (reading !== 'reading') return false; try { this.check(owner); return true; } catch { stop('lease-invalid'); return false; } };
    const connectionError = (): void => { connectionErrored = true; stop('driver-error'); observe('connection-error'); };
    const connectionEnd = (): void => { connectionEnded = true; stop('driver-error'); observe('connection-end'); };
    const aborted = (): void => stop('cancelled');
    const operation: DatabaseBackupSourceReadOperation = Object.freeze({
      owner: this.bound, get query() { return query; }, result, nativeTerminal,
      snapshot: () => Object.freeze({ reading, submission, nativeEvent, queryEnded, queryErrored, connectionEnded, connectionErrored, stopRequested, stopRequestFailed, accountingFailed, retainedRows: rows.length, acceptedRows, acceptedBytes }),
      cancel: (requestedOwner: DatabaseBackupSourceReaderOwner, reason: 'cancelled' | 'timeout' = 'cancelled') => { this.checkOwner(requestedOwner); if (reason !== 'cancelled' && reason !== 'timeout') throw safeError('protocol-invalid'); stop(reason); },
    });
    this.active = operation;
    try {
      const registration: unknown = this.hooks.register(operation);
      if (registration !== undefined) { void Promise.resolve(registration).catch(() => undefined); throw Error(); }
      this.check(owner); if (reading !== 'reading') { observe('not-submitted'); return operation; }
      // register/checkOwner 可以同步改变配置；必须在 commandStarted 之前再核，拒绝换绑。
      if (!privateDriver()) throw Error();
      this.connection.on('error', connectionError); this.connection.on('end', connectionEnd); this.signal?.addEventListener('abort', aborted, { once: true });
      try {
        commandFinished = this.commandStarted();
        if (typeof commandFinished !== 'function') { commandFinished = undefined; throw Error(); }
      } catch { accountingFailed = true; throw Error(); }
      submission = 'started';
      this.check(owner);
      if (reading !== 'reading') { submission = 'not-submitted'; observe('not-submitted'); return operation; }
      if (!privateDriver()) throw Error();
      // 同步发送期间不插入 await；有值时用 COM_STMT，SHOW 等无参数语句用 COM_QUERY。
      // true 只选择默认转换，不隔离全局函数；隔离依赖上面的静态配置隐私门与 Root 配置所有权。
      const options = { sql: statement.sql, rowsAsArray: false, namedPlaceholders: false, typeCast: true as const };
      sendAttempted = true;
      query = statement.params.length ? this.connection.execute(options, [...statement.params]) : this.connection.query(options);
      submission = 'returned';
      // mysql2 文本 Query 的 fields 没有 index，Execute 才附带 0；重复 fields 仍拒绝多结果集。
      query.on('fields', (fields: unknown, index?: number) => { if (checkReceiving()) { if (fieldsSeen || index !== undefined && index !== 0 || !Array.isArray(fields) || !fields.length) stop('protocol-invalid'); else fieldsSeen = true; } });
      query.on('result', (value: unknown, index: number) => {
        if (!checkReceiving()) return;
        if (!fieldsSeen || index !== 0) { stop('protocol-invalid'); return; }
        if (acceptedRows >= statement.maxRows) { stop('limit'); return; }
        try { const next = rowCopy(value, statement.maxBytes - acceptedBytes); rows.push(next.row); acceptedRows++; acceptedBytes += next.bytes; }
        catch (error) { stop(error instanceof DatabaseBackupSourceLimitError ? 'limit' : 'protocol-invalid'); }
      });
      // 取消后仍保留这些监听与原 Query，接纳零行但吸收迟到 error/end；不把 stream.end 当协议终态。
      query.on('error', () => { queryErrored = true; stop('driver-error'); observe('query-error'); });
      query.on('end', () => {
        queryEnded = true;
        if (checkReceiving() && !fieldsSeen) stop('protocol-invalid');
        observe('query-end');
        if (checkReceiving() && !accountingFailed) {
          reading = 'completed'; const completeRows = rows; rows = []; resolveResult({ rows: completeRows, complete: true });
          if (this.active === operation) this.active = null;
        }
      });
      if (!checkReceiving()) stop('lease-invalid');
    } catch {
      if (!sendAttempted) { submission = 'not-submitted'; stop('registration-failed'); observe('not-submitted'); }
      else { submission = 'unknown'; stop('submission-unknown'); }
    }
    return operation;
  }
}
