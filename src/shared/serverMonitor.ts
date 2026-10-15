/** 首阶段只读监控的固定预算；渲染进程不能提交 SQL 或扩大字段范围。 */
export const serverMonitorLimits = { sessions: 100, defaultSessions: 50, sqlCharacters: 512, snapshotBytes: 512 * 1024, refreshMilliseconds: 5000 } as const;
export const serverMonitorStatusNames = ['Uptime', 'Threads_connected', 'Threads_running', 'Connections', 'Aborted_connects', 'Questions', 'Queries', 'Slow_queries', 'Bytes_received', 'Bytes_sent', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads', 'Innodb_row_lock_waits', 'Innodb_row_lock_time'] as const;
export interface ServerMonitorInput { connectionId: string; taskId: string; sessionLimit?: number; }
export interface ServerMonitorSummary { version: string; versionComment: string; hostname: string; port: string; currentUser: string; connectionId: string; }
export interface ServerMonitorSession { id: string; user: string | null; host: string | null; database: string | null; command: string | null; seconds: string | null; state: string | null; sql: string | null; sqlLength: string | null; sqlTruncated: boolean; }
export type ServerMonitorSection<T> = { status: 'available'; value: T } | { status: 'unavailable'; reason: string };
export interface ServerMonitorSnapshot {
  startedAt: string; completedAt: string;
  summary: ServerMonitorSection<ServerMonitorSummary>;
  globalStatus: ServerMonitorSection<{ name: typeof serverMonitorStatusNames[number]; value: string }[]>;
  sessions: ServerMonitorSection<{ rows: ServerMonitorSession[]; limit: number; truncated: boolean; visibility: 'account-visible-unconfirmed' }>;
  bytes: number;
}
/** IPC 与引擎共用校验，拒绝额外执行范围和非整数预算。 */
export function validateServerMonitorInput(input: ServerMonitorInput): void {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['connectionId', 'taskId', 'sessionLimit'].includes(key))) throw new Error('服务器监控参数无效');
  for (const key of ['connectionId', 'taskId'] as const) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 200) throw new Error('服务器监控标识无效');
  if (input.sessionLimit !== undefined && (!Number.isInteger(input.sessionLimit) || input.sessionLimit < 1 || input.sessionLimit > serverMonitorLimits.sessions)) throw new Error('服务器监控会话条数必须为 1 至 100');
}
