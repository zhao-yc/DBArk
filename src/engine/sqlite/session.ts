import { randomUUID } from 'node:crypto';
import { copySqliteNamedParameters, copySqliteCreateGuard, copySqliteOpenOptions, sqliteDriverLimits as limits, type SqliteCreateGuard, type SqliteCancellation, type SqliteColumn, type SqliteExecutionOptions, type SqliteExecutionResult, type SqliteOpenOptions, type SqliteWorkerOpenOptions, type SqliteProcessExit, type SqliteProcessTransport, type SqliteStatementResult, type SqliteValue, type SqliteWorkerResponse, type SqliteFileIdentity } from './protocol';
import { copySqliteRebuildComparisonInput, copySqliteRebuildComparisonResult, type SqliteRebuildComparisonInput, type SqliteRebuildComparisonResult } from './rebuildComparison';

/** 进程中断只证明连接已释放；事务/提交结果未知时不能伪造ROLLBACK成功。 */
export class SqliteDriverError extends Error {
  readonly completedResults: readonly Readonly<SqliteStatementResult>[];
  constructor(message: string, readonly code: string, readonly transaction: boolean | null, readonly completedStatements: number, readonly sessionClosed: boolean, results: readonly SqliteStatementResult[] = []) {
    super(message); this.name = 'SqliteDriverError';
    // 前序完整结果属于原执行事实；失败后仍须提供截断/变更量，不能只凭语句数猜测成功。
    this.completedResults = Object.freeze(results.map(result => Object.freeze({ ...result })));
  }
}
export interface SqliteExecuteOptions extends Partial<SqliteExecutionOptions> {
  parameters?: SqliteValue[];
  namedParameters?: Record<string, SqliteValue>;
  /** 对象管理私有原生CREATE约束；公共query接口不能传入此能力。 */
  createGuard?: SqliteCreateGuard;
  onStatement?(statement: { index: number; sql: string; columns: SqliteColumn[] }): void | Promise<void>;
  onBatch?(batch: { index: number; rows: SqliteValue[][] }): void | Promise<void>;
}
export interface SqliteStreamReadOptions extends Pick<SqliteExecuteOptions, 'parameters' | 'onStatement' | 'onBatch'> { batchRows?: number; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Terminal = Extract<SqliteWorkerResponse, { kind: 'completed' | 'failed' | 'cancelled' }>;
interface Operation {
  id: string; options: SqliteExecuteOptions; result: ReturnType<typeof deferred<SqliteExecutionResult>>;
  nativeDone: ReturnType<typeof deferred<SqliteCancellation>>;
  results: SqliteStatementResult[]; delivery: Promise<void>; frame: number; index: number;
  cancelRequested: boolean; cancelPromise?: Promise<SqliteCancellation>; timer?: ReturnType<typeof setTimeout>;
  terminal?: Terminal; finishing?: boolean; consumerError?: Error;
  comparison?: { columnGroups: number; comparedRows: bigint; onProgress?(progress: { comparedRows: string; columnGroups: number }): void | Promise<void> };
}

/** 一个真实SQLite物理连接对应一个由Main持有的进程；不重连、不重放SQL。 */
export class SqliteDriverSession {
  private readonly openResult = deferred<void>();
  private readonly openId = randomUUID();
  private readonly exit: Promise<SqliteProcessExit>;
  private readonly unsubscribe: () => void;
  private readonly openTimer: ReturnType<typeof setTimeout>;
  private active?: Operation;
  private openSent = false;
  private opened = false;
  private exited = false;
  private invalid = false;
  private closing?: Promise<void>;
  private closeResult?: ReturnType<typeof deferred<void>>;
  private closeId?: string;
  private termination?: Promise<SqliteProcessExit>;
  private failure?: { message: string; code: string };
  private transactionValue: boolean | null = null;
  private versionValue = '';
  private identityValue?: SqliteFileIdentity;

  private constructor(private readonly transport: SqliteProcessTransport, private readonly options: SqliteWorkerOpenOptions) {
    this.unsubscribe = transport.onMessage(message => this.receive(message));
    this.exit = transport.exited.then(result => {
      this.exited = true; this.opened = false; this.transactionValue = null; this.unsubscribe();
      this.openResult.reject(this.error('SQLite执行进程已退出，连接未重新建立', 'SQLITE_PROCESS_EXIT'));
      if (this.closeResult) this.closeResult.reject(this.error('SQLite未确认正常关闭', 'SQLITE_CLOSE_UNCONFIRMED'));
      const active = this.active;
      if (active && !active.terminal) {
        active.nativeDone.resolve({ mode: 'process-terminated', sessionClosed: true, transaction: null, resources: 'confirmed' });
        active.terminal = { kind: 'failed', id: active.id, code: this.failure?.code ?? (active.cancelRequested ? 'SQLITE_CANCELLED_SESSION_CLOSED' : 'SQLITE_PROCESS_EXIT'), message: this.failure?.message ?? 'SQLite执行进程已退出；原事务及写入结果请重新核对，不会重放SQL', transaction: false, completedStatements: active.results.length };
        this.finish(active);
      }
      return result;
    });
    this.openTimer = setTimeout(() => { void this.breakSession('SQLite连接进程启动超时，未自动重试', 'SQLITE_OPEN_TIMEOUT'); }, limits.openTimeoutMs);
    this.openTimer.unref();
  }

  /** 文件能力由Main确认后注入；worker仍执行现存普通文件与URI mode=rw/ro检查。 */
  static async open(create: () => SqliteProcessTransport, options: SqliteOpenOptions): Promise<SqliteDriverSession> {
    return this.openOwned(create, copySqliteOpenOptions(options));
  }
  /** 独立writer固定保护模式；调用方不能通过普通options选择或覆盖私有开关。 */
  static async openRebuild(create: () => SqliteProcessTransport, options: SqliteOpenOptions): Promise<SqliteDriverSession> {
    const normal = copySqliteOpenOptions(options); if (normal.readOnly) throw Error('SQLite重建writer不能以只读模式打开');
    return this.openOwned(create, { ...normal, mode: 'table-rebuild' });
  }
  private static async openOwned(create: () => SqliteProcessTransport, options: SqliteWorkerOpenOptions): Promise<SqliteDriverSession> {
    const session = new SqliteDriverSession(create(), options);
    try { await session.openResult.promise; return session; }
    catch (reason) { await session.terminate(); throw reason; }
    finally { clearTimeout(session.openTimer); }
  }
  get version(): string { return this.versionValue; }
  get transaction(): boolean | null { return this.transactionValue; }
  get isClosed(): boolean { return this.exited; }
  /** 未确认退出的失效会话也不能接收SQL，不能只依据isClosed判断还能执行。 */
  get isUsable(): boolean { return this.opened && !this.exited && !this.invalid && !this.closing; }
  get isBusy(): boolean { return !!this.active; }
  /** 流式全量读取不能被读写会话借用以绕过普通查询预算。 */
  get readOnly(): boolean { return this.options.readOnly; }
  /** 只表示这条独立连接的固定打开模式，不授权普通会话或原查询事务。 */
  get isRebuildWriter(): boolean { return this.options.mode === 'table-rebuild'; }
  /** 返回副本防调用方改写，旧无身份协议只允许原查询，不能签发编辑能力。 */
  get identity(): SqliteFileIdentity | undefined { return this.identityValue ? { ...this.identityValue } : undefined; }
  private error(message: string, code: string, completed = this.active?.results.length ?? 0, results: readonly SqliteStatementResult[] = this.active?.results ?? []): SqliteDriverError { return new SqliteDriverError(message, code, this.exited ? null : this.transactionValue, completed, this.exited, results); }

  /** 同一物理连接不并行执行；每个批次等消费者完成后才确认，不无限积压结果。 */
  execute(sql: string, options: SqliteExecuteOptions = {}): Promise<SqliteExecutionResult> {
    return this.start(sql, options, false);
  }
  /** 完整比较不走公共行/结果字节上限，输入没有SQL，进度帧仍由原消费者确认及取消框架约束。 */
  rebuildCompare(input: SqliteRebuildComparisonInput, options: { onProgress?(progress: { comparedRows: string; columnGroups: number }): void | Promise<void> } = {}): Promise<SqliteRebuildComparisonResult> {
    if (!this.opened || this.exited || this.invalid || this.closing || this.active) return Promise.reject(this.error('SQLite会话未就绪或已有运行任务', 'SQLITE_SESSION_UNAVAILABLE'));
    if (!this.isRebuildWriter || this.options.readOnly) return Promise.reject(this.error('SQLite完整重建比较只允许独立重建writer', 'SQLITE_REBUILD_COMPARE_MODE'));
    if (this.transactionValue !== true) return Promise.reject(this.error('SQLite重建比较要求原writer已明确BEGIN事务', 'SQLITE_REBUILD_COMPARE_TRANSACTION'));
    let copied: SqliteRebuildComparisonInput, onProgress: NonNullable<Operation['comparison']>['onProgress'];
    try {
      copied = copySqliteRebuildComparisonInput(input);
      if (!options || typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) || Reflect.ownKeys(options).some(key => key !== 'onProgress')) throw Error('进度回调无效');
      const descriptor = Object.getOwnPropertyDescriptor(options, 'onProgress'); if (descriptor && (!('value' in descriptor) || descriptor.value !== undefined && typeof descriptor.value !== 'function')) throw Error('进度回调无效'); onProgress = descriptor?.value;
    } catch { return Promise.reject(this.error('SQLite重建比较内部输入无效，本次未发送', 'SQLITE_REBUILD_COMPARE_INPUT')); }
    const operation: Operation = { id: randomUUID(), options: {}, result: deferred(), nativeDone: deferred(), results: [], delivery: Promise.resolve(), frame: 0, index: -1, cancelRequested: false, comparison: { columnGroups: Math.ceil(copied.columns.length / 256), comparedRows: 0n, onProgress } };
    void operation.nativeDone.promise.catch(() => {}); this.active = operation;
    try { this.transport.send({ kind: 'rebuildCompare', id: operation.id, input: copied }); } catch { void this.breakSession('SQLite重建比较未能投递，未重试', 'SQLITE_SEND_FAILED'); }
    return operation.result.promise.then(result => copySqliteRebuildComparisonResult(result.comparison));
  }
  /** 私有导出通道只允许物理只读会话，消费者必须逐批完成，不能积攒全表结果。 */
  streamRead(sql: string, options: SqliteStreamReadOptions): Promise<SqliteExecutionResult> {
    if ('createGuard' in options) return Promise.reject(this.error('SQLite完整流读取不能携带对象创建能力', 'SQLITE_CREATE_GUARD_INVALID'));
    if (Object.hasOwn(options, 'namedParameters')) return Promise.reject(this.error('SQLite完整流读取不接受命名脚本绑定', 'SQLITE_NAMED_PARAMETERS_INVALID'));
    if (!this.options.readOnly || typeof options.onBatch !== 'function') return Promise.reject(this.error('SQLite完整流读取必须使用独立物理只读会话和批次消费者', 'SQLITE_STREAM_REQUIRES_READONLY'));
    return this.start(sql, { ...options, maxRows: 1, maxBytes: 1 }, true);
  }
  /** 普通查询继续原100万行/32MiB门槛，流读取不接受其预算覆盖值。 */
  private start(sql: string, options: SqliteExecuteOptions, stream: boolean): Promise<SqliteExecutionResult> {
    if (!this.opened || this.exited || this.invalid || this.closing || this.active) return Promise.reject(this.error('SQLite会话未就绪或已有运行任务', 'SQLITE_SESSION_UNAVAILABLE'));
    const configured: SqliteExecutionOptions = { maxRows: options.maxRows ?? 1000, batchRows: options.batchRows ?? 200, maxBytes: options.maxBytes ?? limits.resultBytes };
    if (typeof sql !== 'string' || Buffer.byteLength(sql) > limits.sqlBytes || !Number.isInteger(configured.maxRows) || configured.maxRows < 1 || configured.maxRows > limits.rows || !Number.isInteger(configured.batchRows) || configured.batchRows < 1 || configured.batchRows > limits.batchRows || !Number.isInteger(configured.maxBytes) || configured.maxBytes < 1 || configured.maxBytes > limits.resultBytes) return Promise.reject(this.error('SQLite执行参数超出预算', 'SQLITE_INPUT_LIMIT'));
    let namedParameters: Record<string, SqliteValue> | undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(options, 'namedParameters');
      if (descriptor && !('value' in descriptor) || !descriptor && 'namedParameters' in options) throw Error('SQLite命名绑定必须是自有数据字段');
      if (descriptor?.value !== undefined) { if (stream || options.parameters !== undefined) throw Error('SQLite命名与位置绑定不能混用'); namedParameters = copySqliteNamedParameters(descriptor.value); }
    } catch { return Promise.reject(this.error('SQLite命名参数映射或绑定模式无效，本次未发送SQL', 'SQLITE_NAMED_PARAMETERS_INVALID')); }
    let createGuard: SqliteCreateGuard | undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(options, 'createGuard');
      if (descriptor && !('value' in descriptor) || !descriptor && 'createGuard' in options) throw Error('SQLite创建能力必须是自有数据字段');
      if (descriptor?.value !== undefined) {
        const binding = Object.getOwnPropertyDescriptor(options, 'parameters');
        if (stream || namedParameters !== undefined || !binding || !('value' in binding) || !Array.isArray(binding.value) || binding.value.length !== 0 || Reflect.ownKeys(binding.value).length !== 1) throw Error('SQLite创建能力必须独占显式空位置绑定');
        createGuard = copySqliteCreateGuard(descriptor.value);
      }
    } catch { return Promise.reject(this.error('SQLite对象创建内部能力或绑定模式无效，本次未发送SQL', 'SQLITE_CREATE_GUARD_INVALID')); }
    const operation: Operation = { id: randomUUID(), options, result: deferred(), nativeDone: deferred(), results: [], delivery: Promise.resolve(), frame: 0, index: -1, cancelRequested: false };
    // 无取消调用时也保留原生终态错误的处理端；execute仍通过自己的Promise报告失败。
    void operation.nativeDone.promise.catch(() => {});
    this.active = operation;
    try { this.transport.send(stream
      ? { kind: 'streamRead', id: operation.id, sql, parameters: options.parameters ?? [], options: { batchRows: configured.batchRows } }
      : { kind: 'execute', id: operation.id, sql, ...(options.parameters === undefined ? {} : { parameters: options.parameters }), ...(namedParameters === undefined ? {} : { namedParameters }), ...(createGuard === undefined ? {} : { createGuard }), options: configured }); }
    catch { void this.breakSession('SQLite请求未能投递，未重试', 'SQLITE_SEND_FAILED'); }
    return operation.result.promise;
  }

  /** 优先协作取消；同步native调用不响应时终止准确进程，明确报告会话丢失。 */
  cancel(): Promise<SqliteCancellation> {
    const operation = this.active;
    if (!operation) {
      if (this.invalid && !this.exited) return this.terminate().then(() => ({ mode: 'process-terminated' as const, sessionClosed: true, transaction: null, resources: 'confirmed' as const }), reason => { throw this.error(reason instanceof Error ? reason.message : 'SQLite资源释放未确认', 'SQLITE_EXIT_UNCONFIRMED'); });
      return Promise.resolve({ mode: 'idle', sessionClosed: this.exited, transaction: this.transactionValue, resources: 'confirmed' });
    }
    if (operation.cancelPromise) return operation.cancelPromise;
    this.requestCancel(operation);
    // 只等待原生资源终态，避免消费者内部await cancel形成等待环。
    // execute仍等待消费者结束，调用方关闭工作区前必须等待原execute。
    operation.cancelPromise = operation.nativeDone.promise;
    return operation.cancelPromise;
  }
  private requestCancel(operation: Operation): void {
    if (this.active !== operation || operation.cancelRequested || operation.terminal) return;
    operation.cancelRequested = true;
    try { this.transport.send({ kind: 'cancel', id: operation.id }); }
    catch { void this.breakSession('SQLite取消请求无法投递，原会话不可继续使用', 'SQLITE_SEND_FAILED'); return; }
    operation.timer = setTimeout(() => {
      if (this.active === operation && !operation.terminal) void this.terminate().catch(error => this.failUnconfirmed(operation, error));
    }, limits.cancelGraceMs);
    operation.timer.unref();
  }

  private receive(message: SqliteWorkerResponse): void {
    try {
      if (this.exited || this.invalid || !message || typeof message !== 'object') return;
      if (message.kind === 'ready') { if (this.openSent) throw Error('重复SQLite启动消息'); this.openSent = true; this.transport.send({ kind: 'open', id: this.openId, options: this.options }); return; }
      if (message.kind === 'opened') {
        if (message.id !== this.openId || this.opened || message.readOnly !== this.options.readOnly || typeof message.version !== 'string' || message.mode !== this.options.mode || this.isRebuildWriter && message.transaction !== false) throw Error('SQLite打开回执不匹配');
        if (message.identity && (typeof message.identity.path !== 'string' || !message.identity.path || !/^[0-9]+$/.test(message.identity.device) || !/^[0-9]+$/.test(message.identity.inode))) throw Error('SQLite打开文件身份无效');
        this.identityValue = message.identity ? { ...message.identity } : undefined;
        this.opened = true; this.versionValue = message.version; this.transactionValue = message.transaction; this.openResult.resolve(); return;
      }
      if (message.kind === 'failed' && message.id === this.openId && !this.opened) { this.openResult.reject(this.error(message.message, message.code)); return; }
      if (message.kind === 'closed') {
        if (message.id !== this.closeId || !this.closeResult) throw Error('SQLite关闭回执不匹配');
        if (this.isRebuildWriter ? message.rebuildRestored !== true : 'rebuildRestored' in message) throw Error('SQLite重建关闭缺少原保护恢复确认');
        this.transport.send({ kind: 'closeAck', id: message.id }); this.closeResult.resolve(); this.closeResult = undefined; return;
      }
      if (message.kind === 'failed' && message.id === this.closeId && this.closeResult) {
        this.transactionValue = message.transaction; const pending = this.closeResult; this.closeResult = undefined; pending.reject(this.error(message.message, message.code)); return;
      }
      const operation = this.active;
      if (!operation || !('id' in message) || message.id !== operation.id || operation.terminal) return;
      if (message.kind === 'rebuildProgress') {
        const comparison = operation.comparison;
        if (!comparison || message.frame !== operation.frame + 1 || message.columnGroups !== comparison.columnGroups || typeof message.comparedRows !== 'string' || !/^(?:0|[1-9][0-9]{0,19})$/.test(message.comparedRows)) throw Error('SQLite重建比较进度不属于原操作');
        const rows = BigInt(message.comparedRows); if (rows < comparison.comparedRows || rows > 9223372036854775807n * BigInt(comparison.columnGroups)) throw Error('SQLite重建比较进度计数倒退或溢出'); comparison.comparedRows = rows; operation.frame = message.frame;
        operation.delivery = operation.delivery.then(async () => { if (!this.invalid && this.active === operation && !operation.cancelRequested && !operation.terminal) await comparison.onProgress?.({ comparedRows: message.comparedRows, columnGroups: message.columnGroups }); }).catch(reason => { operation.consumerError = reason instanceof Error ? reason : Error('SQLite重建进度消费者失败'); this.requestCancel(operation); }).finally(() => { if (!this.invalid && this.active === operation && !operation.terminal && !this.exited) try { this.transport.send({ kind: 'ack', id: operation.id, frame: message.frame }); } catch { void this.breakSession('SQLite重建进度确认无法投递', 'SQLITE_SEND_FAILED'); } });
      } else if (message.kind === 'statement' || message.kind === 'batch') {
        if (operation.comparison) throw Error('SQLite重建比较不能携带SQL或用户结果值');
        if (message.frame !== operation.frame + 1 || message.kind === 'statement' && (message.index !== operation.results.length || operation.index !== operation.results.length - 1) || message.kind === 'batch' && (message.index < 0 || message.index !== operation.index || message.index !== operation.results.length)) throw Error('SQLite结果批次顺序无效');
        operation.frame = message.frame; if (message.kind === 'statement') operation.index = message.index;
        operation.delivery = operation.delivery.then(async () => {
          if (this.invalid || this.active !== operation || operation.cancelRequested || operation.terminal) return;
          if (message.kind === 'statement') await operation.options.onStatement?.({ index: message.index, sql: message.sql, columns: message.columns });
          else await operation.options.onBatch?.({ index: message.index, rows: message.rows });
        }).catch(reason => { operation.consumerError = reason instanceof Error ? reason : Error('SQLite结果消费者失败'); this.requestCancel(operation); }).finally(() => {
          if (!this.invalid && this.active === operation && !operation.terminal && !this.exited) try { this.transport.send({ kind: 'ack', id: operation.id, frame: message.frame }); } catch { void this.breakSession('SQLite批次确认无法投递', 'SQLITE_SEND_FAILED'); }
        });
      } else if (message.kind === 'statementEnd') {
        if (operation.comparison) throw Error('SQLite重建比较不能冒充执行DDL');
        if (message.result.index !== operation.results.length || message.result.index !== operation.index) throw Error('SQLite语句完成顺序无效');
        operation.results.push(message.result); this.transactionValue = message.result.transaction;
      } else if (message.kind === 'completed' || message.kind === 'failed' || message.kind === 'cancelled') {
        if (message.kind === 'completed') {
          if (operation.comparison) {
            const result = copySqliteRebuildComparisonResult(message.result.comparison); if (message.result.transaction !== true || message.result.statements.length || result.columnGroups !== operation.comparison.columnGroups || BigInt(result.verifiedRows) * BigInt(result.columnGroups) !== operation.comparison.comparedRows) throw Error('SQLite重建完整计数、分组或事务终态不一致'); message.result.comparison = result;
          } else if ('comparison' in message.result) throw Error('SQLite普通执行不能携带重建比较事实');
        }
        if (message.kind === 'completed' ? JSON.stringify(message.result.statements) !== JSON.stringify(operation.results) : message.completedStatements !== operation.results.length) throw Error('SQLite完成回执与已收语句不一致');
        operation.nativeDone.resolve({ mode: message.kind === 'cancelled' ? 'cooperative' : 'finished', sessionClosed: false, transaction: message.kind === 'completed' ? message.result.transaction : message.transaction, resources: 'confirmed' });
        operation.terminal = message; this.transactionValue = message.kind === 'completed' ? message.result.transaction : message.transaction; this.finish(operation);
      }
    } catch { void this.breakSession('SQLite进程消息不符合本次会话，已停止继续执行', 'SQLITE_PROTOCOL_ERROR'); }
  }
  /** native终态先停止强杀计时；消费者尚未完成时仍不放行下一项任务。 */
  private finish(operation: Operation): void {
    if (operation.finishing) return; operation.finishing = true; clearTimeout(operation.timer);
    void operation.delivery.finally(() => {
      if (this.active !== operation) return;
      this.active = undefined;
      const terminal = operation.terminal!;
      if (operation.consumerError) operation.result.reject(this.error(operation.consumerError.message, 'SQLITE_CONSUMER_FAILED', operation.results.length, operation.results));
      else if (terminal.kind === 'completed') operation.result.resolve(terminal.result);
      else operation.result.reject(this.error(terminal.kind === 'cancelled' ? 'SQLite查询已取消' : terminal.message, terminal.kind === 'cancelled' ? 'SQLITE_CANCELLED' : terminal.code, terminal.completedStatements, operation.results));
    });
  }
  private failUnconfirmed(operation: Operation, reason: unknown): void {
    this.invalid = true; clearTimeout(operation.timer);
    // 进程尚未终结就不返回resources=confirmed；原句柄保留，后续close可以继续核对。
    const failure = this.error(reason instanceof Error ? reason.message : 'SQLite进程释放未确认', 'SQLITE_EXIT_UNCONFIRMED', operation.results.length);
    operation.nativeDone.reject(failure); operation.result.reject(failure);
  }
  private async breakSession(message: string, code: string): Promise<void> {
    this.invalid = true; this.failure = { message, code };
    this.openResult.reject(this.error(message, code));
    try { await this.terminate(); } catch (reason) { if (this.active) this.failUnconfirmed(this.active, reason); }
  }
  private terminate(): Promise<SqliteProcessExit> {
    if (this.termination) return this.termination;
    const work = (async () => { if (!this.exited) this.transport.terminate(); return this.waitForExit(); })();
    this.termination = work; void work.catch(() => { if (this.termination === work) this.termination = undefined; }); return work;
  }
  private async waitForExit(): Promise<SqliteProcessExit> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([this.exit, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite进程退出尚未确认，保留原句柄')), limits.exitTimeoutMs); timer.unref(); })]); }
    finally { clearTimeout(timer); }
  }
  /** 普通关闭必须确认worker关闭SQLite且进程实际退出；运行中先由用户明确取消或等待。 */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.active && !this.invalid) return Promise.reject(this.error('SQLite查询仍在执行，请先等待或明确取消', 'SQLITE_SESSION_BUSY'));
    if (this.isRebuildWriter && this.isUsable && this.transactionValue !== false) return Promise.reject(this.error('SQLite重建事务尚未明确收束，请先显式ROLLBACK或COMMIT再关闭', 'SQLITE_REBUILD_TRANSACTION_ACTIVE'));
    const work = (async () => {
      if (this.exited) return;
      if (this.invalid) { await this.terminate(); return; }
      this.closeId = randomUUID(); const acknowledgement = this.closeResult = deferred<void>();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        this.transport.send({ kind: 'close', id: this.closeId });
        await Promise.race([acknowledgement.promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error('SQLite正常关闭尚未确认，保留连接')), limits.exitTimeoutMs); timer.unref(); })]);
        const result = await this.waitForExit(); if (result.code !== 0) throw this.error('SQLite关闭后的进程退出异常', 'SQLITE_CLOSE_UNCONFIRMED');
      } catch (reason) {
        if (!(reason instanceof SqliteDriverError && reason.code === 'SQLITE_REBUILD_TRANSACTION_ACTIVE')) this.invalid = true; if (this.closeResult === acknowledgement) this.closeResult = undefined;
        throw reason;
      } finally { clearTimeout(timer); }
    })();
    this.closing = work; void work.catch(() => { if (this.closing === work) this.closing = undefined; }); return work;
  }
}
