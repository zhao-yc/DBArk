import { queryParameterLimits } from '../../shared/queryParameters';

/** SQLite 原生进程的内部契约；不作为渲染 IPC，也不接收可执行代码或扩展路径。 */
export const sqliteDriverLimits = {
  sqlBytes: 20 * 1024 * 1024, statements: 1000, columns: 1024,
  rows: 1000000, batchRows: 1000, resultBytes: 32 * 1024 * 1024, valueBytes: 1024 * 1024,
  openTimeoutMs: 10000, cancelGraceMs: 250, exitTimeoutMs: 5000,
} as const;
/** 仅Main生成导出/编辑投影使用；纯校验且禁止schema间接调用，不授予任何写能力。 */
export const sqliteExportTextFunction = 'dbark_sqlite_export_text_exact_v1';

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
export interface SqliteStatementResult { index: number; rows: number; truncated: boolean; changes: string; transaction: boolean; }
export interface SqliteExecutionResult { statements: SqliteStatementResult[]; transaction: boolean; }
export interface SqliteOpenOptions { path: string; readOnly: boolean; busyTimeoutMs: number; }
/** 仅Main私有物理文件身份，绝不进入渲染页或任务持久概要。 */
export interface SqliteFileIdentity { path: string; device: string; inode: string; }

export type SqliteWorkerRequest =
  | { kind: 'open'; id: string; options: SqliteOpenOptions }
  | { kind: 'execute'; id: string; sql: string; parameters?: SqliteValue[]; namedParameters?: Record<string, SqliteValue>; options: SqliteExecutionOptions }
  | { kind: 'streamRead'; id: string; sql: string; parameters: SqliteValue[]; namedParameters?: never; options: SqliteStreamReadOptions }
  | { kind: 'ack'; id: string; frame: number }
  | { kind: 'cancel'; id: string }
  | { kind: 'closeAck'; id: string }
  | { kind: 'close'; id: string };

export type SqliteWorkerResponse =
  | { kind: 'ready' }
  | { kind: 'opened'; id: string; version: string; transaction: boolean; readOnly: boolean; identity?: SqliteFileIdentity }
  | { kind: 'statement'; id: string; frame: number; index: number; sql: string; columns: SqliteColumn[] }
  | { kind: 'batch'; id: string; frame: number; index: number; rows: SqliteValue[][] }
  | { kind: 'statementEnd'; id: string; result: SqliteStatementResult }
  | { kind: 'completed'; id: string; result: SqliteExecutionResult }
  | { kind: 'failed'; id: string; code: string; message: string; transaction: boolean; completedStatements: number }
  | { kind: 'cancelled'; id: string; transaction: boolean; completedStatements: number }
  | { kind: 'closed'; id: string };

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
