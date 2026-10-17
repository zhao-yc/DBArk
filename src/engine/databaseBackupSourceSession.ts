import { types } from 'node:util';
import type { Query } from 'mysql2';
import { DatabaseBackupSourceLimitError, inspectDatabaseBackupSource, type DatabaseBackupSourceBinding, type DatabaseBackupSourceContext, type DatabaseBackupSourceInspection, type DatabaseBackupSourceRead } from './databaseBackupSource';
import { DatabaseBackupSourceReader, type DatabaseBackupSourceNativeEvent, type DatabaseBackupSourceReadOperation, type DatabaseBackupSourceReaderOwner, type DatabaseBackupSourceReadStop } from './databaseBackupSourceReader';
import type { StructureTaskContext } from './structureDefinition';

type Context = Pick<StructureTaskContext, 'managed' | 'checkCancelled' | 'commandStarted'>;
type Owner = DatabaseBackupSourceReaderOwner;
type Reason = 'cancelled' | 'owner-invalid' | 'context-invalid' | 'registration-failed' | 'read-failed' | 'native-unproven' | 'accounting-unproven' | 'limit' | 'inspection-failed';
/** Source最多10000个对象（含数据库），MySQL前后事实/授权及目录最多另15句。 */
export const databaseBackupSourceSessionLimits = Object.freeze({ operations: 10_015 });
export interface DatabaseBackupSourceSessionHooks {
  /** Root同步核当前登记的owner、租约及准确源绑定；这里不是调用方自报的有效布尔。 */
  checkOwner(owner: Readonly<Owner>, binding: Readonly<DatabaseBackupSourceBinding>): void;
  /** 任何inspect/Reader/SQL之前同步保留同一实例和inspection Promise。 */
  register(session: DatabaseBackupSourceSession): void;
  /** 只同步登记原operation停止请求；回执不构成服务器、命令或资源终态。 */
  requestStop(operation: DatabaseBackupSourceReadOperation, reason: DatabaseBackupSourceReadStop): void;
}
interface OperationRecord {
  readonly operation: DatabaseBackupSourceReadOperation;
  result: 'pending' | 'fulfilled' | 'rejected'; nativeEvent: DatabaseBackupSourceNativeEvent | null;
  accounting: 'not-started' | 'pending' | 'left' | 'unknown'; stopRequested: boolean; stopRequestFailed: boolean;
  query: Query | null; nativeInvalidated: boolean;
}
function safeError(reason: Reason): Error {
  if (reason === 'limit') return new DatabaseBackupSourceLimitError('私有源检查超过原对象、元数据或读取次数预算，未返回部分检查');
  return Object.assign(new Error('私有源检查未完整完成；原操作与资源须由 Root 单独协调'), { code: 'DBARK_BACKUP_SOURCE_SESSION_FAILED', reason });
}
/** 绑定只允许有界数据描述符；复制时不执行getter/toJSON，不接代理、函数或凭据容器。 */
function dataCopy(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= 2048 || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) || depth > 5 || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw safeError('owner-invalid');
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length > 32 || keys.some(key => typeof key !== 'string' || key.length > 100 || !('value' in descriptors[key]))) throw safeError('owner-invalid');
  const output: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) output[key] = dataCopy(descriptors[key].value, depth + 1);
  return Object.freeze(output);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** 只组合已登记物理会话的Reader和完整Source检查；无建连、重放、持锁、关闭或驱动退出入口。 */
export class DatabaseBackupSourceSession {
  readonly #owner: Owner;
  readonly #boundOwner: Readonly<Owner>;
  readonly #sourceInput: DatabaseBackupSourceBinding;
  readonly #binding: Readonly<DatabaseBackupSourceBinding>;
  readonly #ownerKey: string;
  readonly #bindingKey: string;
  readonly #sourceContext: Context;
  readonly #managed: Context['managed'];
  readonly #connection: Context['managed']['connection'];
  readonly #signal: AbortSignal | undefined;
  readonly #rootCheck: () => void;
  readonly #rootCommand: Context['commandStarted'];
  readonly #hooks: DatabaseBackupSourceSessionHooks;
  readonly #inspection = deferred<DatabaseBackupSourceInspection>();
  readonly #operations: OperationRecord[] = [];
  readonly #byOperation = new Map<DatabaseBackupSourceReadOperation, OperationRecord>();
  #reader: DatabaseBackupSourceReader | null = null;
  #current: OperationRecord | null = null;
  #chain: Promise<void> | null = null;
  #candidate: DatabaseBackupSourceInspection | null = null;
  #state: 'idle' | 'registering' | 'running' | 'completed' | 'failed' | 'cancelled' = 'idle';
  #reason: Reason | null = null;
  #started = false;
  #reading = false;
  #invalidated = false;
  #invalidationReason: Reason | null = null;
  #invalidReads = 0;
  #queryObservers = 0;
  #connectionInvalidated = false;
  get inspection() { return this.#inspection.promise; }

  /** 仅捕获已登记上下文及有界源绑定，构造不触发任何读取或连接生命周期动作。 */
  constructor(context: Context, owner: Owner, binding: DatabaseBackupSourceBinding, hooks: DatabaseBackupSourceSessionHooks) {
    this.#owner = owner; this.#sourceInput = binding;
    this.#boundOwner = dataCopy(owner) as Readonly<Owner>; this.#binding = dataCopy(binding) as Readonly<DatabaseBackupSourceBinding>;
    this.#ownerKey = JSON.stringify(this.#boundOwner); this.#bindingKey = JSON.stringify(this.#binding);
    if (Object.keys(this.#boundOwner).length !== 5 || ['taskId', 'connectionId', 'connectionRevision', 'sourceLease'].some(key => { const value = this.#boundOwner[key as keyof Owner]; return typeof value !== 'string' || !value || value.length > 200 || value.includes('\0'); }) || !Number.isSafeInteger(this.#boundOwner.threadId) || this.#boundOwner.threadId < 1 || this.#boundOwner.threadId > 0xffffffff) throw safeError('owner-invalid');
    const required = ['connectionId', 'database', 'connectionRevision', 'sourceLease', 'endpoint', 'threadId'];
    if (required.some(key => !Object.hasOwn(this.#binding, key)) || Object.keys(this.#binding).some(key => ![...required, 'expectedInstance', 'lockCapability'].includes(key)) || ['connectionId', 'connectionRevision', 'sourceLease', 'threadId'].some(key => this.#boundOwner[key as keyof Owner] !== this.#binding[key as keyof DatabaseBackupSourceBinding])) throw safeError('owner-invalid');
    this.#sourceContext = context; this.#managed = context.managed; this.#connection = context.managed.connection; this.#signal = context.managed.signal;
    this.#rootCheck = context.checkCancelled.bind(context); this.#rootCommand = context.commandStarted.bind(context);
    this.#hooks = Object.freeze({ checkOwner: hooks.checkOwner.bind(hooks), register: hooks.register.bind(hooks), requestStop: hooks.requestStop.bind(hooks) });
  }
  /** 清理只接受原登记对象；字段被换绑后仍只清理本实例原句柄，不借新值申请资源。 */
  #sameOwner(owner: Owner): void { if (owner !== this.#owner) throw safeError('owner-invalid'); }
  /** 对原入参重新读取数据描述符，拒绝首await后换绑及注册钩子中的同步别名修改。 */
  #dataCurrent(): boolean { return JSON.stringify(dataCopy(this.#owner)) === this.#ownerKey && JSON.stringify(dataCopy(this.#sourceInput)) === this.#bindingKey; }
  /** Root租约核验前后都复核绑定；不把回调返回布尔或异步回执当作权限证明。 */
  #ownerCurrent(): void {
    try {
      if (!this.#dataCurrent()) throw safeError('owner-invalid');
      const response: unknown = this.#hooks.checkOwner(this.#boundOwner, this.#binding);
      if (response !== undefined) { void Promise.resolve(response).catch(() => undefined); throw safeError('owner-invalid'); }
      if (!this.#dataCurrent()) throw safeError('owner-invalid');
    } catch { throw safeError('owner-invalid'); }
  }
  /** 每条读的前后与最终发布前复核原physical/signal/租约；失效永久封存。 */
  #check(): void {
    if (this.#reason) throw safeError(this.#reason);
    if (this.#invalidated) throw safeError(this.#invalidationReason!);
    try { this.#ownerCurrent(); }
    catch { this.#stop('owner-invalid'); throw safeError('owner-invalid'); }
    try {
      this.#rootCheck();
      if (this.#sourceContext.managed !== this.#managed || this.#managed.connection !== this.#connection || this.#managed.signal !== this.#signal || this.#managed.broken || this.#signal?.aborted || this.#connection.threadId !== this.#boundOwner.threadId) throw safeError('context-invalid');
    } catch { this.#stop(this.#signal?.aborted ? 'cancelled' : 'context-invalid'); throw safeError(this.#reason!); }
    try { if (!this.#dataCurrent()) throw safeError('owner-invalid'); } catch { this.#stop('owner-invalid'); throw safeError('owner-invalid'); }
    if (this.#reason) throw safeError(this.#reason);
  }
  /** 一次性领取；先注册稳定inspection，再构造Reader和调用真实Source，重复/重入立即拒绝。 */
  start(owner: Owner): Promise<DatabaseBackupSourceInspection> {
    this.#sameOwner(owner); if (this.#started || this.#reason) throw safeError('owner-invalid');
    this.#started = true; this.#state = 'registering';
    try {
      const registration: unknown = this.#hooks.register(this);
      if (registration !== undefined) { void Promise.resolve(registration).catch(() => undefined); throw safeError('registration-failed'); }
      this.#check();
      this.#signal?.addEventListener('abort', this.#aborted, { once: true });
      // 同一物理会话只登记一组故障观察，不给每条历史Query叠加连接监听。
      this.#connection.on('error', this.#connectionFailed); this.#connection.on('end', this.#connectionFailed);
      const context: Context = { managed: this.#managed, checkCancelled: () => this.#check(), commandStarted: () => this.#commandStarted() };
      this.#reader = new DatabaseBackupSourceReader(context, this.#owner, {
        checkOwner: () => this.#ownerCurrent(), register: operation => this.#registerOperation(operation), requestStop: (operation, reason) => this.#requestStop(operation, reason),
      });
      this.#state = 'running'; this.#chain = this.#run();
    } catch { if (!this.#reason) this.#stop('registration-failed'); }
    return this.inspection;
  }
  /** Reader真正发送前保留每个原操作，成功或未知都不逐条驱逐。 */
  #registerOperation(operation: DatabaseBackupSourceReadOperation): void {
    if (this.#operations.length >= databaseBackupSourceSessionLimits.operations || this.#current) throw safeError('limit');
    const record: OperationRecord = { operation, result: 'pending', nativeEvent: null, accounting: 'not-started', stopRequested: false, stopRequestFailed: false, query: null, nativeInvalidated: false };
    this.#operations.push(record); this.#byOperation.set(operation, record); this.#current = record;
  }
  /** 一条原Query只加一个O(1)错误观察；不留原错误参数，已过门记录也不删除监听。 */
  #watch(record: OperationRecord): void {
    record.query = record.operation.query;
    if (record.query) { this.#queryObservers++; record.query.on('error', () => this.#invalidate('native-unproven', record)); }
    // Reader.start内可能先观察到同步错误；补核原快照，不能靠监听安装时刻漏掉失效。
    const state = record.operation.snapshot();
    if (state.queryErrored || state.connectionErrored || state.connectionEnded || state.accountingFailed) this.#invalidate('native-unproven', record);
  }
  /** 失效是永久资格标记；运行中停当前原读，已发布的Promise仅保留历史结果而不假装撤回。 */
  #invalidate(reason: Reason, record?: OperationRecord): void {
    if (record && !record.nativeInvalidated) { record.nativeInvalidated = true; this.#invalidReads++; }
    this.#invalidated = true; this.#invalidationReason ??= reason;
    if (this.#state !== 'completed') this.#stop(reason);
  }
  readonly #connectionFailed = (): void => { this.#connectionInvalidated = true; this.#invalidate('context-invalid'); };
  /** 单条接纳核其原活快照，发布前再对全部记录仅做一遍O(n)复核。 */
  #healthy(record: OperationRecord): boolean {
    const state = record.operation.snapshot();
    return record.result === 'fulfilled' && record.nativeEvent === 'query-end' && record.accounting === 'left' && !record.nativeInvalidated && Boolean(record.query) && record.query === record.operation.query
      && state.reading === 'completed' && state.nativeEvent === 'query-end' && state.queryEnded && !state.queryErrored && !state.connectionErrored && !state.connectionEnded && !state.accountingFailed;
  }
  /** 本地结束回调只在Root原记账成功返回后标left；抛错保留unknown，不伪造已离开命令。 */
  #commandStarted(): () => void {
    this.#check(); const record = this.#current; if (!record || record.accounting !== 'not-started') throw safeError('accounting-unproven');
    record.accounting = 'pending'; let finished: (() => void);
    try { finished = this.#rootCommand(); if (typeof finished !== 'function') throw safeError('accounting-unproven'); }
    catch { record.accounting = 'unknown'; throw safeError('accounting-unproven'); }
    let called = false;
    return () => {
      if (called) return; called = true;
      try { const result: unknown = finished(); if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw safeError('accounting-unproven'); } record.accounting = 'left'; }
      catch { record.accounting = 'unknown'; throw safeError('accounting-unproven'); }
    };
  }
  /** 每个原操作最多向Root登记一次停止请求；所有返回都只是请求，不修改native/记账状态。 */
  #requestStop(operation: DatabaseBackupSourceReadOperation, reason: DatabaseBackupSourceReadStop): void {
    const record = this.#byOperation.get(operation); if (!record || record.stopRequested) return;
    record.stopRequested = true;
    try { const response: unknown = this.#hooks.requestStop(operation, reason); if (response !== undefined) { record.stopRequestFailed = true; void Promise.resolve(response).catch(() => { record.stopRequestFailed = true; }); } }
    catch { record.stopRequestFailed = true; }
  }
  /** Source的唯一read实现：直接Reader.start，双Promise及原记账齐备才推进链。 */
  #read = async (statement: DatabaseBackupSourceRead): ReturnType<DatabaseBackupSourceContext['read']> => {
    this.#check(); if (this.#reading || !this.#reader) throw safeError('read-failed');
    if (this.#operations.length >= databaseBackupSourceSessionLimits.operations) { this.#stop('limit'); throw safeError('limit'); }
    this.#reading = true;
    try {
      const operation = this.#reader.start(this.#owner, statement), record = this.#current;
      if (!record || record.operation !== operation) throw safeError('native-unproven');
      this.#watch(record);
      const result = operation.result.then(value => { record.result = 'fulfilled'; return { value } as const; }, error => {
        record.result = 'rejected'; this.#stop(error instanceof DatabaseBackupSourceLimitError ? 'limit' : 'read-failed'); return { error: true } as const;
      });
      const native = operation.nativeTerminal.then(event => { record.nativeEvent = event; return event; });
      // result先拒绝会立即封存可见inspection，链本身仍留在原native Promise上等待晚事件。
      const [outcome, event] = await Promise.all([result, native]);
      this.#check();
      if ('error' in outcome || outcome.value.complete !== true) throw safeError('read-failed');
      if (event !== 'query-end' || !this.#healthy(record)) { this.#invalidate('native-unproven', record); throw safeError('native-unproven'); }
      this.#current = null; return outcome.value;
    } catch (error) {
      if (!this.#reason) this.#stop(error instanceof DatabaseBackupSourceLimitError ? 'limit' : 'read-failed');
      throw safeError(this.#reason!);
    } finally { this.#reading = false; }
  };
  /** 调用真实完整Source检查，不替换可见性/能力结论；候选与发布事实分开保留。 */
  async #run(): Promise<void> {
    try {
      const result = await inspectDatabaseBackupSource({ checkCancelled: () => this.#check(), read: this.#read }, this.#binding);
      this.#candidate = result; this.#check();
      const invalid = this.#operations.find(record => !this.#healthy(record));
      if (invalid) { this.#invalidate('native-unproven', invalid); throw safeError('native-unproven'); }
      if (result.actualLockHeld !== false) throw safeError('native-unproven');
      this.#state = 'completed'; this.#inspection.resolve(result);
    } catch (error) { if (!this.#reason) this.#stop(error instanceof DatabaseBackupSourceLimitError ? 'limit' : 'inspection-failed'); }
  }
  /** 可见inspection立即拒绝，原chain/native等待仍保留；不关闭或替换任何句柄。 */
  #stop(reason: Reason): void {
    if (this.#state === 'completed' || this.#reason) return;
    this.#reason = reason; this.#state = reason === 'cancelled' ? 'cancelled' : 'failed'; this.#inspection.reject(safeError(reason));
    const operation = this.#current?.operation;
    if (operation) {
      try { operation.cancel(this.#owner); }
      catch { this.#requestStop(operation, reason === 'cancelled' ? 'cancelled' : 'lease-invalid'); }
    }
  }
  readonly #aborted = (): void => this.#invalidate('cancelled');
  /** 取消只作用于本例原operation和Root停止钩子，没有取消ACK到serverClosed的转换。 */
  cancel(owner: Owner): void { this.#sameOwner(owner); this.#invalidate('cancelled'); }
  /** 显式私有诊断接口保留原操作、Query、Promise与迟到候选；不得交日志/renderer。 */
  retained(owner: Owner) {
    this.#sameOwner(owner);
    return { owner: this.#boundOwner, binding: this.#binding, inspection: this.inspection, chain: this.#chain, candidate: this.#candidate,
      operations: this.#operations.map(record => ({ operation: record.operation, result: record.result, nativeEvent: record.nativeEvent, accounting: record.accounting, stopRequested: record.stopRequested, stopRequestFailed: record.stopRequestFailed, nativeInvalidated: record.nativeInvalidated })) };
  }
  /** 通用快照只复制状态/计数，不读取私有结果Promise、源绑定或原Query。 */
  snapshot() {
    return Object.freeze({ state: this.#state, reason: this.#reason, started: this.#started, reading: this.#reading, operations: this.#operations.length,
      invalidated: this.#invalidated, invalidationReason: this.#invalidationReason, invalidReads: this.#invalidReads, queryObservers: this.#queryObservers, connectionInvalidated: this.#connectionInvalidated,
      resultsPending: this.#operations.filter(record => record.result === 'pending').length, nativePending: this.#operations.filter(record => record.nativeEvent === null).length,
      commandsPending: this.#operations.filter(record => record.accounting === 'pending' || record.accounting === 'unknown').length,
      stopRequests: this.#operations.filter(record => record.stopRequested).length, stopRequestFailures: this.#operations.filter(record => record.stopRequestFailed).length });
  }
  /** 日志与序列化复用同一白名单，不依赖调用方replacer。 */
  toJSON() { return this.snapshot(); }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.snapshot(); }
}
