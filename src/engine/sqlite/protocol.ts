import { queryParameterLimits } from '../../shared/queryParameters';
import type { QueryFailureSourceRange } from '../../shared/queryFailure';
import type { SqliteRebuildComparisonInput, SqliteRebuildComparisonResult } from './rebuildComparison';

/** SQLite 原生进程的内部契约；不作为渲染 IPC，也不接收可执行代码或扩展路径。 */
export const sqliteDriverLimits = {
  sqlBytes: 20 * 1024 * 1024, statements: 1000, columns: 1024,
  rows: 1000000, batchRows: 1000, resultBytes: 32 * 1024 * 1024, valueBytes: 1024 * 1024,
  // SQLite内部需要解析完整schema和记录；该预算不扩大原生帧及公开单值的1MiB门槛。
  recordBytes: 4 * 1024 * 1024,
  openTimeoutMs: 10000, cancelGraceMs: 250, exitTimeoutMs: 5000,
} as const;
/** 仅Main生成导出/编辑投影使用；纯校验且禁止schema间接调用，不授予任何写能力。 */
export const sqliteExportTextFunction = 'dbark_sqlite_export_text_exact_v1';

/** 仅Main对象管理编译器注入；不属于Renderer IPC，不能授予TEMP、附加库或任意DDL权限。 */
export interface SqliteCreateGuard { kind: 'view' | 'trigger'; name: string; allowedRelations: string[]; }
export const sqliteCreateGuardLimits = { relations: 4096, name: 512, bytes: 2 * 1024 * 1024 } as const;
/** 原型、getter及稀疏数组不进入内部能力；会话与worker各复制一次，不能依赖发送后的可变数组。 */
export function copySqliteCreateGuard(input: unknown): SqliteCreateGuard {
  const invalid = () => Error('SQLite对象创建内部能力格式无效');
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw invalid();
  const keys = Reflect.ownKeys(input); if (keys.length !== 3 || keys.some(key => !['kind', 'name', 'allowedRelations'].includes(String(key)) || typeof key !== 'string')) throw invalid();
  const values = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(input, key); if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw invalid(); values[key as string] = descriptor.value; }
  const validName = (name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= sqliteCreateGuardLimits.name && !name.includes('\0') && !/^sqlite_/i.test(name) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(name);
  if (typeof values.kind !== 'string' || !['view', 'trigger'].includes(values.kind) || !validName(values.name) || !Array.isArray(values.allowedRelations) || values.allowedRelations.length > sqliteCreateGuardLimits.relations) throw invalid();
  const relations = values.allowedRelations, relationKeys = Reflect.ownKeys(relations); if (relationKeys.length !== relations.length + 1 || Object.getPrototypeOf(relations) !== Array.prototype) throw invalid();
  const copied: string[] = [], seen = new Set<string>(), encoder = new TextEncoder(); let bytes = encoder.encode(values.name).length;
  for (let index = 0; index < relations.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(relations, String(index)); if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || !validName(descriptor.value)) throw invalid();
    const name = descriptor.value, key = name.replace(/[A-Z]/g, character => character.toLowerCase()); if (seen.has(key) || (bytes += encoder.encode(name).length + 4) > sqliteCreateGuardLimits.bytes) throw invalid(); seen.add(key); copied.push(name);
  }
  return { kind: values.kind as SqliteCreateGuard['kind'], name: values.name, allowedRelations: copied };
}

/** INTEGER 不经过 Number；REAL 单独标记，保留负零和无穷，TEXT 不按声明亲和性转换。 */
export type SqliteValue = null | string | { type: 'integer'; value: string } | { type: 'real'; value: string } | { type: 'binary'; base64: string };
/** 先复制纯自有数据字段，避免IPC序列化触发getter或依赖原型；实际字节、数值和全文绑定由worker再核。 */
export function copySqliteNamedParameters(input: unknown): Record<string, SqliteValue> {
  const invalid = () => Error('SQLite命名参数映射格式无效');
  const data = (value: unknown, limit: number): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) throw invalid();
    // 先按自有键数拒绝超量对象，不能先复制巨大映射/包装再核预算；隐藏字段也不得被复制成公开绑定。
    const keys = Reflect.ownKeys(value); if (keys.length > limit) throw invalid();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) { if (typeof key !== 'string') throw invalid(); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !('value' in descriptor)) throw invalid(); result[key] = descriptor.value; }
    return result;
  };
  const source = data(input, queryParameterLimits.names), keys = Object.keys(source), output = Object.create(null) as Record<string, SqliteValue>;
  for (const key of keys) {
    if (!/^:[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw invalid();
    const value = source[key];
    if (value === null || typeof value === 'string') output[key] = value;
    else {
      const fields = data(value, 2), fieldNames = Object.keys(fields), type = fields.type;
      const payload = type === 'binary' ? 'base64' : 'value';
      if (typeof type !== 'string' || !['integer', 'real', 'binary'].includes(type) || fieldNames.length !== 2 || !Object.hasOwn(fields, 'type') || !Object.hasOwn(fields, payload) || typeof fields[payload] !== 'string') throw invalid();
      output[key] = type === 'binary' ? { type, base64: fields.base64 as string } : { type: type as 'integer' | 'real', value: fields.value as string };
    }
  }
  return output;
}
export interface SqliteColumn { name: string; database: string | null; table: string | null; column: string | null; type: string | null; }
export interface SqliteExecutionOptions { maxRows: number; batchRows: number; maxBytes: number; }
/** 只读完整导出没有累计行/结果截断；仍逐帧ACK且受原单值、批次预算约束。 */
export interface SqliteStreamReadOptions { batchRows: number; }
export interface SqliteStatementResult {
  index: number; rows: number; truncated: boolean; changes: string; transaction: boolean;
  /** 原生语句的完整行数与耗时，仅用户查询明确请求时返回。 */
  queryReceipt?: { producedRows: number; elapsedMs: number; sourceRange: QueryFailureSourceRange };
}
export interface SqliteExecutionResult { statements: SqliteStatementResult[]; transaction: boolean; comparison?: SqliteRebuildComparisonResult; }
export interface SqliteOpenOptions { path: string; readOnly: boolean; busyTimeoutMs: number; }
export const sqliteCopySourceSchema = 'dbark_copy_source';
/** 固定模式由 Main 独立任务注入，普通查询不能附加文件。 */
export interface SqliteWorkerOpenOptions extends SqliteOpenOptions { mode?: 'table-rebuild' | 'table-copy' | 'data-search'; sourcePath?: string; }
/** 纯自有数据复制，普通入口即使mode为undefined也拒绝，避免扩展字段被透传到特权writer。 */
function copyOpenOptions(input: unknown, allowRebuild: boolean): SqliteWorkerOpenOptions {
  const fail = () => Error('SQLite连接参数或私有模式无效');
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw fail();
  const keys = Reflect.ownKeys(input), allowed = allowRebuild ? ['path', 'readOnly', 'busyTimeoutMs', 'mode', 'sourcePath'] : ['path', 'readOnly', 'busyTimeoutMs'];
  if (keys.length < 3 || keys.length > allowed.length || keys.some(key => typeof key !== 'string' || !allowed.includes(key))) throw fail();
  const values = Object.create(null) as Record<string, unknown>;
  for (const key of keys) { const item = Object.getOwnPropertyDescriptor(input, key); if (!item || !item.enumerable || !('value' in item)) throw fail(); values[key as string] = item.value; }
  const mode = values.mode;
  if (typeof values.path !== 'string' || !values.path || values.path.includes('\0') || typeof values.readOnly !== 'boolean' || !Number.isInteger(values.busyTimeoutMs) || Number(values.busyTimeoutMs) < 0 || Number(values.busyTimeoutMs) > 5000) throw fail();
  const base = { path: values.path, readOnly: values.readOnly, busyTimeoutMs: values.busyTimeoutMs as number };
  if (mode === 'table-copy' && typeof values.sourcePath === 'string' && values.sourcePath && !values.sourcePath.includes('\0')) return { ...base, mode, sourcePath: values.sourcePath };
  if (mode === 'data-search' && values.readOnly && !keys.includes('sourcePath')) return { ...base, mode };
  if (mode === 'table-rebuild' && !values.readOnly && !keys.includes('sourcePath')) return { ...base, mode };
  if (keys.includes('mode') || keys.includes('sourcePath')) throw fail();
  return base;
}
export function copySqliteOpenOptions(input: unknown): SqliteOpenOptions { return copyOpenOptions(input, false); }
export function copySqliteWorkerOpenOptions(input: unknown): SqliteWorkerOpenOptions { return copyOpenOptions(input, true); }
/** 仅Main私有物理文件身份，绝不进入渲染页或任务持久概要。 */
export interface SqliteFileIdentity { path: string; device: string; inode: string; }

export type SqliteWorkerRequest =
  | { kind: 'backupFile'; id: string; source: SqliteFileIdentity; staging: SqliteFileIdentity }
  | { kind: 'open'; id: string; options: SqliteWorkerOpenOptions }
  | { kind: 'execute'; id: string; sql: string; parameters?: SqliteValue[]; namedParameters?: Record<string, SqliteValue>; createGuard?: SqliteCreateGuard; captureFailureRange?: true; captureQueryReceipt?: true; options: SqliteExecutionOptions }
  | { kind: 'streamRead'; id: string; sql: string; parameters: SqliteValue[]; namedParameters?: never; createGuard?: never; captureFailureRange?: never; captureQueryReceipt?: never; options: SqliteStreamReadOptions }
  | { kind: 'rebuildCompare'; id: string; input: SqliteRebuildComparisonInput }
  | { kind: 'ack'; id: string; frame: number }
  | { kind: 'cancel'; id: string }
  | { kind: 'closeAck'; id: string }
  | { kind: 'close'; id: string };

export type SqliteWorkerResponse =
  | { kind: 'ready' }
  | { kind: 'backupFileFinished'; id: string; verified: boolean }
  | { kind: 'opened'; id: string; version: string; transaction: boolean; readOnly: boolean; identity?: SqliteFileIdentity; copySourceIdentity?: SqliteFileIdentity; mode?: SqliteWorkerOpenOptions['mode'] }
  | { kind: 'statement'; id: string; frame: number; index: number; sql: string; columns: SqliteColumn[]; title?: string }
  | { kind: 'batch'; id: string; frame: number; index: number; rows: SqliteValue[][] }
  | { kind: 'rebuildProgress'; id: string; frame: number; comparedRows: string; columnGroups: number }
  | { kind: 'statementEnd'; id: string; result: SqliteStatementResult }
  | { kind: 'completed'; id: string; result: SqliteExecutionResult }
  | { kind: 'failed'; id: string; code: string; message: string; transaction: boolean; completedStatements: number; sourceRange?: QueryFailureSourceRange }
  | { kind: 'cancelled'; id: string; transaction: boolean; completedStatements: number }
  | { kind: 'closed'; id: string; rebuildRestored?: true };

export interface SqliteProcessExit { code: number | null; signal: string | null; }
/** Main 持有准确 utilityProcess 句柄；进程中断不通过 PID 猜测其它连接。 */
export interface SqliteProcessTransport {
  readonly pid?: number;
  send(message: SqliteWorkerRequest): void;
  onMessage(listener: (message: SqliteWorkerResponse) => void): () => void;
  terminate(): boolean;
  exited: Promise<SqliteProcessExit>;
}

export interface SqliteCancellation {
  mode: 'idle' | 'cooperative' | 'process-terminated' | 'finished';
  sessionClosed: boolean;
  transaction: boolean | null;
  resources: 'confirmed';
}
