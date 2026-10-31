/** SQLite 原生进程的内部契约；不作为渲染 IPC，也不接收可执行代码或扩展路径。 */
export const sqliteDriverLimits = {
  sqlBytes: 20 * 1024 * 1024, statements: 1000, columns: 1024,
  rows: 1000000, batchRows: 1000, resultBytes: 32 * 1024 * 1024, valueBytes: 1024 * 1024,
  openTimeoutMs: 10000, cancelGraceMs: 250, exitTimeoutMs: 5000,
} as const;
/** 仅完整导出的Main生成投影使用；worker注册纯只读、禁止schema间接调用的原文校验函数。 */
export const sqliteExportTextFunction = 'dbark_sqlite_export_text_exact_v1';

/** INTEGER 不经过 Number；REAL 单独标记，保留负零和无穷，TEXT 不按声明亲和性转换。 */
export type SqliteValue = null | string | { type: 'integer'; value: string } | { type: 'real'; value: string } | { type: 'binary'; base64: string };
export interface SqliteColumn { name: string; database: string | null; table: string | null; column: string | null; type: string | null; }
export interface SqliteExecutionOptions { maxRows: number; batchRows: number; maxBytes: number; }
/** 只读完整导出没有累计行/结果截断；仍逐帧ACK且受原单值、批次预算约束。 */
export interface SqliteStreamReadOptions { batchRows: number; }
export interface SqliteStatementResult { index: number; rows: number; truncated: boolean; changes: string; transaction: boolean; }
export interface SqliteExecutionResult { statements: SqliteStatementResult[]; transaction: boolean; }
export interface SqliteOpenOptions { path: string; readOnly: boolean; busyTimeoutMs: number; }

export type SqliteWorkerRequest =
  | { kind: 'open'; id: string; options: SqliteOpenOptions }
  | { kind: 'execute'; id: string; sql: string; parameters?: SqliteValue[]; options: SqliteExecutionOptions }
  | { kind: 'streamRead'; id: string; sql: string; parameters: SqliteValue[]; options: SqliteStreamReadOptions }
  | { kind: 'ack'; id: string; frame: number }
  | { kind: 'cancel'; id: string }
  | { kind: 'closeAck'; id: string }
  | { kind: 'close'; id: string };

export type SqliteWorkerResponse =
  | { kind: 'ready' }
  | { kind: 'opened'; id: string; version: string; transaction: boolean; readOnly: boolean }
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
