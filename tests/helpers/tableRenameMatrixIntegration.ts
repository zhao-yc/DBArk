import type { ManagedConnection } from '../../src/engine/connection';
import {
  bindDatabaseEncodingTarget, databaseEncodingGate, watchDatabaseEncodingConnection, assertDatabaseEncodingReleased,
  type DatabaseEncodingConnectionFact, type DatabaseEncodingLifetime,
} from './databaseDefaultEncodingIntegration';

export const tableRenameMatrixGate = 'DBARK_TABLE_RENAME_MATRIX_TEST';
const traceLimit = 256;
let traceSequence = 0;

/** 新专项只绑定六个明确实例；旧专项门不能混入，不读取文件或提供默认认证。 */
export function bindTableRenameMatrixTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindDatabaseEncodingTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, databaseEncodingGate) || Object.hasOwn(raw, 'DBARK_TABLE_RENAME_TEST')) throw Error('表重命名兼容验收不能混用旧专项门');
    return { ...raw, [databaseEncodingGate]: raw[tableRenameMatrixGate] };
  }, id);
}

export interface TableRenameMatrixFact extends DatabaseEncodingConnectionFact {
  renameWarnings: (number | undefined)[]; renameErrors: (number | undefined)[];
  renameErrorCodes: (string | undefined)[]; renameFailed: boolean[];
  viewReads: string[]; killConnections: number[];
  trace: TableRenameNativeTrace[]; traceOverflow: boolean; traceUnavailable: boolean;
  renameCallbackCount: number; killCallbackCount: number;
}

export interface TableRenameNativeTrace {
  seq: number; event: string; closing: 'unset' | 'open' | 'closing' | 'unknown'; readableEnded: boolean | null; closed: boolean | null;
  signalAborted: boolean; originalQueryMatches: boolean | null; pending: number;
  code: string | null; errno: number | null; callbackFailed: boolean | null; warningStatus: number | null; ack: boolean | null;
}

interface RenameWatchIdentity {
  managed: ManagedConnection; native: DatabaseEncodingConnectionFact['native']; stream: DatabaseEncodingConnectionFact['stream'];
  signal: AbortSignal | undefined; id: number; scope: string; owner: DatabaseEncodingLifetime; trace: TableRenameNativeTrace[];
  journal: readonly TableRenameNativeTrace[]; originalQuery?: unknown; renameSql?: string; killTarget?: number;
  overflow: boolean; unavailable: boolean;
}
const renameWatchIdentities = new WeakMap<TableRenameMatrixFact, RenameWatchIdentity>();

export interface TableRenameMdlReceipt {
  readonly branch: 'failed-callback' | 'remote-fin'; readonly originalThreadId: number; readonly controlThreadId: number;
  readonly rawCallbackCount: 0 | 1; readonly rawPending: 0 | 1; readonly serverThreadsRemaining: 0;
}
interface PrivateMdlReceipt {
  output: TableRenameMdlReceipt; original: TableRenameMatrixFact; control: TableRenameMatrixFact;
  originalState: string; controlState: string; originalTrace: readonly TableRenameNativeTrace[]; controlTrace: readonly TableRenameNativeTrace[];
  originalCommand: unknown; controlCommand: unknown;
}
const mdlReceipts = new WeakMap<TableRenameMatrixFact, PrivateMdlReceipt>();
const mdlProofAttempted = new WeakSet<TableRenameMatrixFact>();

/** 在原严格旁观器上补RENAME许可；不能因原写入正则未含RENAME而把真实DDL记为零。 */
export function watchTableRenameMatrixConnection(managed: ManagedConnection, scope: string, owner: DatabaseEncodingLifetime, allowedSql: () => string | undefined, allowedKillThread: () => number | undefined): TableRenameMatrixFact {
  const fact: TableRenameMatrixFact = Object.assign(watchDatabaseEncodingConnection(managed, scope, owner, allowedSql), {
    renameWarnings: [] as (number | undefined)[], renameErrors: [] as (number | undefined)[],
    renameErrorCodes: [] as (string | undefined)[], renameFailed: [] as boolean[],
    viewReads: [] as string[], killConnections: [] as number[],
    trace: [] as TableRenameNativeTrace[], traceOverflow: false, traceUnavailable: false, renameCallbackCount: 0, killCallbackCount: 0,
  });
  const journal: TableRenameNativeTrace[] = [];
  const identity: RenameWatchIdentity = { managed, native: fact.native, stream: fact.stream, signal: managed.signal, id: fact.id, scope, owner, trace: fact.trace, journal, overflow: false, unavailable: false };
  renameWatchIdentities.set(fact, identity);
  const unavailable = (): void => { fact.traceUnavailable = identity.unavailable = true; };
  let armed = false, originalQuery: unknown;
  /** 有界旁观真实事件；诊断失败只标记不可用，不能引入产品异常、补回调或修改pending。 */
  const record = (event: string, error?: unknown, rows?: unknown, callback = false): void => {
    if (!armed) return;
    try {
      if (fact.trace.length >= traceLimit || traceSequence >= Number.MAX_SAFE_INTEGER) { fact.traceOverflow = identity.overflow = true; return; }
      const native = fact.native as typeof fact.native & { _closing?: unknown; _command?: unknown };
      const stream = fact.stream as typeof fact.stream & { readableEnded?: unknown };
      const scalar = (value: unknown, name: string): unknown => value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, name)?.value : undefined;
      const code = scalar(error, 'code'), errno = scalar(error, 'errno'), warning = scalar(rows, 'warningStatus'), affected = scalar(rows, 'affectedRows');
      const entry: TableRenameNativeTrace = Object.freeze({
        seq: ++traceSequence, event, closing: native._closing === undefined ? 'unset' : native._closing === false ? 'open' : native._closing === true ? 'closing' : 'unknown',
        readableEnded: typeof stream.readableEnded === 'boolean' ? stream.readableEnded : null, closed: typeof stream.closed === 'boolean' ? stream.closed : null,
        signalAborted: managed.signal?.aborted === true, originalQueryMatches: originalQuery === undefined ? null : native._command === originalQuery, pending: fact.pending,
        code: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(code) ? code : null,
        errno: typeof errno === 'number' && Number.isSafeInteger(errno) && errno >= 0 ? errno : null,
        callbackFailed: callback ? error !== null && error !== undefined : null,
        warningStatus: typeof warning === 'number' && Number.isSafeInteger(warning) && warning >= 0 ? warning : null,
        ack: callback ? (error === null || error === undefined) && affected === 0 && typeof warning === 'number' && Number.isSafeInteger(warning) && warning >= 0 : null,
      });
      journal.push(entry); fact.trace.push(entry);
    } catch { unavailable(); }
  };
  /** 原emit同步透传，避免新增error监听器改变EventEmitter原有未处理错误语义。 */
  const observeEmitter = (value: unknown, prefix: string, names: readonly string[]): void => {
    try {
      const emitter = value as { emit(event: string | symbol, ...args: unknown[]): boolean }, emit = emitter.emit;
      if (typeof emit !== 'function') { unavailable(); return; }
      emitter.emit = function (this: typeof emitter, event: string | symbol, ...args: unknown[]) {
        if (typeof event === 'string' && names.includes(event)) record(prefix + '.' + event, event === 'error' ? args[0] : undefined);
        return emit.apply(this, [event, ...args]);
      };
    } catch { unavailable(); }
  };
  observeEmitter(managed.connection, 'connection', ['end', 'error']); observeEmitter(fact.stream, 'stream', ['end', 'error', 'close']);
  try { managed.signal?.addEventListener('abort', () => record('signal.abort'), { once: true }); } catch { unavailable(); }
  try {
    const destroy = managed.connection.destroy;
    managed.connection.destroy = function (this: typeof managed.connection, ...args: Parameters<typeof destroy>) { record('native.destroy'); return destroy.apply(this, args); };
    const close = managed.close;
    managed.close = function (this: ManagedConnection, ...args: Parameters<typeof close>) {
      record('managed.close.enter'); let result: ReturnType<typeof close>;
      try { result = close.apply(this, args); } catch (error) { record('managed.close.throw', error); throw error; }
      // 仍返回原Promise；附加只读观察器不await、不替换结果，也不改变原strictclose计数。
      try { void result.then(() => record('managed.close.return'), error => record('managed.close.reject', error)); } catch { unavailable(); }
      return result;
    };
  } catch { unavailable(); }
  for (const method of ['query', 'execute'] as const) {
    const original = fact.native[method];
    fact.native[method] = function (this: unknown, ...args: unknown[]) {
      owner.check(); const text = typeof args[0] === 'string' ? args[0] : '', callback = args.at(-1), rename = /^RENAME\b/i.test(text);
      if (rename) {
        fact.writes.push(text);
        if (scope !== 'observer' && text !== allowedSql()) { owner.stop(); throw Error('表重命名投递了非本次精确预览SQL'); }
        identity.renameSql = text;
      }
      if (/^SHOW CREATE VIEW\b/i.test(text)) fact.viewReads.push(text);
      // 结构任务的现行真实协议用KILL CONNECTION唤醒MDL，不冒充普通查询的KILL QUERY。
      const kill = /^KILL CONNECTION ([1-9]\d*)$/i.exec(text);
      if (/^KILL\b/i.test(text)) {
        if (!kill || Number(kill[1]) !== allowedKillThread()) { owner.stop(); throw Error('重命名兼容取消没有原MDL线程精确许可'); }
        fact.killConnections.push(Number(kill[1]));
        identity.killTarget = Number(kill[1]);
      }
      if (rename || kill) { armed = true; record(rename ? 'rename.submit' : 'kill.submit'); }
      if ((rename || kill) && typeof callback === 'function') {
        args[args.length - 1] = function (this: unknown, ...result: unknown[]) {
          const [error, rows] = result;
          if (rename) {
            fact.renameCallbackCount++; record('rename.callback', error, rows, true);
            const failure = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
            const header = rows && typeof rows === 'object' ? rows as Record<string, unknown> : undefined;
            fact.renameErrors.push(typeof failure?.errno === 'number' ? failure.errno : undefined);
            fact.renameErrorCodes.push(typeof failure?.code === 'string' ? failure.code : undefined);
            fact.renameFailed.push(error instanceof Error);
            fact.renameWarnings.push(typeof header?.warningStatus === 'number' ? header.warningStatus : undefined);
          } else { fact.killCallbackCount++; record('kill.callback', error, rows, true); }
          return callback.apply(this, result);
        };
      }
      const result = original.apply(this, args);
      if (rename || kill) { originalQuery = result; identity.originalQuery = result; observeEmitter(result, rename ? 'rename.query' : 'kill.query', ['end', 'error']); record(rename ? 'rename.query.return' : 'kill.query.return'); }
      return result;
    };
  }
  return fact;
}

/** 只认可本旁观器登记的原对象与不可改写事件；公开诊断数组丢项、重排或替换都不能成为证据。 */
function originalTrace(fact: TableRenameMatrixFact): RenameWatchIdentity {
  const identity = renameWatchIdentities.get(fact);
  if (!identity || fact.managed !== identity.managed || fact.native !== identity.native || fact.stream !== identity.stream || fact.id !== identity.id || fact.scope !== identity.scope || fact.managed.connection !== identity.native as unknown || fact.native.stream !== identity.stream || fact.native.threadId !== identity.id || fact.managed.signal !== identity.signal || fact.trace !== identity.trace || fact.traceOverflow || fact.traceUnavailable || identity.overflow || identity.unavailable || !fact.trace.length || fact.trace.length > traceLimit || fact.trace.length !== identity.journal.length || fact.trace.some((entry, index) => entry !== identity.journal[index] || !Object.isFrozen(entry) || !Number.isSafeInteger(entry.seq) || entry.seq < 1 || index > 0 && entry.seq <= fact.trace[index - 1].seq || entry.closing === 'unknown' || entry.readableEnded === null || entry.closed === null || !Number.isSafeInteger(entry.pending) || entry.pending < 0)) throw Error('MDL原对象或完整有界事件证据不能确认');
  return identity;
}

/** B分支保留真实pending=1，只独立核其余原strictclose事实，绝不复制对象后伪造pending=0。 */
function assertRemoteFinReleased(fact: TableRenameMatrixFact): void {
  originalTrace(fact);
  if (fact.pending !== 1 || fact.closeCalls !== 1 || !fact.strict || !fact.closeReturned || fact.closeFailed || !fact.sawClose || fact.stream.closed !== true) throw Error('MDL远端FIN后的原资源未完成一次严格关闭');
}

/** 两条原连接共同证明精确KILL与终态；任何本地关闭先于远端FIN，都不能进入无回调分支。 */
function inspectMdlTerminal(original: TableRenameMatrixFact, control: TableRenameMatrixFact, owner?: DatabaseEncodingLifetime): TableRenameMdlReceipt['branch'] {
  const source = originalTrace(original), killer = originalTrace(control);
  if (original === control || source.owner !== killer.owner || owner && source.owner !== owner || !Number.isSafeInteger(source.id) || source.id < 1 || !Number.isSafeInteger(killer.id) || killer.id < 1 || source.id === killer.id || !source.originalQuery || !killer.originalQuery || !source.renameSql || source.killTarget !== undefined || killer.renameSql !== undefined || killer.killTarget !== source.id || original.writes.length !== 1 || original.writes[0] !== source.renameSql || control.writes.length !== 0 || original.killConnections.length !== 0 || control.killConnections.length !== 1 || control.killConnections[0] !== source.id) throw Error('MDL取消没有唯一原RENAME与准确原线程KILL');
  assertDatabaseEncodingReleased([control], true);
  const find = (fact: TableRenameMatrixFact, event: string) => fact.trace.filter(entry => entry.event === event);
  const single = (fact: TableRenameMatrixFact, event: string): TableRenameNativeTrace => { const rows = find(fact, event); if (rows.length !== 1) throw Error('MDL原事件缺失或重复：' + event); return rows[0]; };
  const submitted = single(original, 'rename.submit'), returned = single(original, 'rename.query.return');
  const killSubmitted = single(control, 'kill.submit'), killReturned = single(control, 'kill.query.return'), ack = single(control, 'kill.callback');
  if (submitted.seq >= returned.seq || returned.seq >= killSubmitted.seq || killSubmitted.seq >= killReturned.seq || killReturned.seq >= ack.seq || ack.ack !== true || ack.callbackFailed !== false || ack.warningStatus !== 0 || control.killCallbackCount !== 1 || control.renameCallbackCount !== 0 || control.renameFailed.length || control.renameErrors.length || control.renameErrorCodes.length || control.renameWarnings.length) throw Error('MDL没有唯一真实成功KILL回调ACK');
  const sequences = [...original.trace, ...control.trace].map(entry => entry.seq); if (new Set(sequences).size !== sequences.length) throw Error('MDL原连接事件序号重复');
  const local = original.trace.filter(entry => ['native.destroy', 'signal.abort', 'managed.close.enter'].includes(entry.event));
  const firstLocal = local[0], abort = single(original, 'signal.abort'), closeEntered = single(original, 'managed.close.enter'), closeReturned = single(original, 'managed.close.return'), closed = single(original, 'stream.close');
  const controlClose = single(control, 'managed.close.enter'), controlReturned = single(control, 'managed.close.return'); single(control, 'stream.close');
  if (!firstLocal || ack.seq >= firstLocal.seq || abort.signalAborted !== true || closeEntered.seq >= closeReturned.seq || closed.seq >= closeReturned.seq || controlClose.seq >= controlReturned.seq || original.trace.some(entry => ['managed.close.reject', 'managed.close.throw'].includes(entry.event)) || control.trace.some(entry => ['managed.close.reject', 'managed.close.throw'].includes(entry.event))) throw Error('MDL原ACK与严格关闭顺序不能确认');
  const callbacks = find(original, 'rename.callback');
  if (original.renameCallbackCount === 1 && callbacks.length === 1 && original.pending === 0) {
    const callback = callbacks[0];
    if (callback.callbackFailed !== true || callback.ack !== false || callback.originalQueryMatches !== true || original.renameFailed.length !== 1 || original.renameFailed[0] !== true || original.renameErrors.length !== 1 || original.renameErrors[0] !== (callback.errno ?? undefined) || original.renameErrorCodes.length !== 1 || original.renameErrorCodes[0] !== (callback.code ?? undefined) || original.renameWarnings.length !== 1 || original.renameWarnings[0] !== undefined || original.killCallbackCount !== 0 || closeReturned.pending !== 0) throw Error('MDL原RENAME不是唯一真实失败回调');
    assertDatabaseEncodingReleased([original], true); return 'failed-callback';
  }
  if (original.renameCallbackCount !== 0 || callbacks.length !== 0 || original.pending !== 1 || original.renameFailed.length || original.renameErrors.length || original.renameErrorCodes.length || original.renameWarnings.length || original.killCallbackCount !== 0) throw Error('MDL无回调分支的原始计数不一致');
  const fin = single(original, 'stream.end'), ended = single(original, 'connection.end');
  if (returned.seq >= fin.seq || fin.seq >= ended.seq || ended.seq >= closed.seq || fin.seq >= firstLocal.seq || fin.seq >= closed.seq || fin.readableEnded !== true || fin.closed !== false || fin.signalAborted || !['unset', 'open'].includes(fin.closing) || fin.originalQueryMatches !== true || fin.pending !== 1 || ended.originalQueryMatches !== true || ended.signalAborted || !['unset', 'open'].includes(ended.closing) || closed.originalQueryMatches !== true || closed.pending !== 1 || closeReturned.pending !== 1 || (source.native as typeof source.native & { _command?: unknown })._command !== source.originalQuery || original.trace.some(entry => ['connection.error', 'stream.error', 'rename.query.error', 'rename.query.end'].includes(entry.event))) throw Error('MDL没有本地关闭前原Query匹配的真实远端FIN');
  assertRemoteFinReleased(original); return 'remote-fin';
}

/** 凭证保留原计数、原事件和关闭事实的快照，后续真实迟到回调或人工篡改均不能悄悄复用。 */
function mdlState(fact: TableRenameMatrixFact): string {
  originalTrace(fact);
  const native = fact.native as typeof fact.native & { _closing?: unknown }, stream = fact.stream as typeof fact.stream & { readableEnded?: unknown };
  return JSON.stringify({ pending: fact.pending, closeCalls: fact.closeCalls, strict: fact.strict, closeReturned: fact.closeReturned, closeFailed: fact.closeFailed, sawClose: fact.sawClose, streamClosed: fact.stream.closed, readableEnded: stream.readableEnded, closing: native._closing, broken: fact.managed.broken, aborted: fact.managed.signal?.aborted, writes: fact.writes, kills: fact.killConnections, renameCallbackCount: fact.renameCallbackCount, killCallbackCount: fact.killCallbackCount, failed: fact.renameFailed, errors: fact.renameErrors, codes: fact.renameErrorCodes, warnings: fact.renameWarnings, trace: fact.trace });
}

/** 原apply及两个原流终态后，在观察器仍持MDL时查原两线程；一次尝试只签一份私有凭证，不延长期限。 */
export async function proveTableRenameMdlTerminal(original: TableRenameMatrixFact, control: TableRenameMatrixFact, owner: DatabaseEncodingLifetime, readOriginalThreads: (ids: readonly number[]) => Promise<unknown>): Promise<TableRenameMdlReceipt> {
  owner.check();
  if (mdlProofAttempted.has(original) || mdlProofAttempted.has(control)) throw Error('MDL原终态证明已尝试，不能重复签发');
  mdlProofAttempted.add(original); mdlProofAttempted.add(control);
  const branch = inspectMdlTerminal(original, control, owner), beforeOriginal = mdlState(original), beforeControl = mdlState(control);
  const originalCommand = (original.native as typeof original.native & { _command?: unknown })._command, controlCommand = (control.native as typeof control.native & { _command?: unknown })._command;
  const rows = await readOriginalThreads(Object.freeze([original.id, control.id])); owner.check();
  if (!Array.isArray(rows) || rows.length !== 0 || inspectMdlTerminal(original, control, owner) !== branch || mdlState(original) !== beforeOriginal || mdlState(control) !== beforeControl || (original.native as typeof original.native & { _command?: unknown })._command !== originalCommand || (control.native as typeof control.native & { _command?: unknown })._command !== controlCommand) throw Error('MDL原线程仍存在或查询期间原终态变化，不能释放观察器锁');
  const output: TableRenameMdlReceipt = Object.freeze({ branch, originalThreadId: original.id, controlThreadId: control.id, rawCallbackCount: original.renameCallbackCount as 0 | 1, rawPending: original.pending as 0 | 1, serverThreadsRemaining: 0 });
  const receipt: PrivateMdlReceipt = { output, original, control, originalState: beforeOriginal, controlState: beforeControl, originalTrace: [...original.trace], controlTrace: [...control.trace], originalCommand, controlCommand };
  mdlReceipts.set(original, receipt); mdlReceipts.set(control, receipt); return output;
}

/** 普通操作仍走原基类释放门；仅本次已查线程0的原MDL对象可用私有凭证重核，绝不修改pending。 */
export function assertTableRenameMatrixReleased(facts: readonly DatabaseEncodingConnectionFact[], strict: boolean): void {
  for (const fact of facts) {
    if (!renameWatchIdentities.has(fact as TableRenameMatrixFact)) throw Error('重命名释放门只接收本轮原旁观对象，不能提交复制事实');
    const receipt = mdlReceipts.get(fact as TableRenameMatrixFact);
    if (!receipt && mdlProofAttempted.has(fact as TableRenameMatrixFact)) throw Error('原MDL终态证明未成功签收，不能退回普通释放门');
    if (!receipt) { assertDatabaseEncodingReleased([fact], strict); continue; }
    const { original, control } = receipt;
    if (inspectMdlTerminal(original, control) !== receipt.output.branch || mdlState(original) !== receipt.originalState || mdlState(control) !== receipt.controlState || (original.native as typeof original.native & { _command?: unknown })._command !== receipt.originalCommand || (control.native as typeof control.native & { _command?: unknown })._command !== receipt.controlCommand || original.trace.length !== receipt.originalTrace.length || control.trace.length !== receipt.controlTrace.length || original.trace.some((entry, index) => entry !== receipt.originalTrace[index]) || control.trace.some((entry, index) => entry !== receipt.controlTrace[index])) throw Error('MDL一次凭证的原对象、事件或回调已经变化');
    if (fact === original && receipt.output.branch === 'remote-fin') assertRemoteFinReleased(original); else assertDatabaseEncodingReleased([fact], strict);
  }
}

// 原Vitest起点120秒、零重试、原managed及原物理流close全部保留，不另签收尾期限。
export {
  databaseEncodingLifetime as tableRenameMatrixLifetime,
  loadDatabaseEncodingModules as loadTableRenameMatrixModules,
  assertDatabaseEncodingIdentity as assertTableRenameMatrixIdentity,
  closeDatabaseEncodingObserver as closeTableRenameMatrixObserver,
  type DatabaseEncodingLifetime as TableRenameMatrixLifetime,
} from './databaseDefaultEncodingIntegration';
