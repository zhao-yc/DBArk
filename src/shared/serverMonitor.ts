import { z } from 'zod';

/** 监控的固定预算；渲染进程不能提交 SQL 或扩大字段范围。 */
export const serverMonitorLimits = { sessions: 100, defaultSessions: 50, sqlCharacters: 512, snapshotBytes: 512 * 1024, refreshMilliseconds: 5000 } as const;
export const serverMonitorStatusNames = ['Uptime', 'Threads_connected', 'Threads_running', 'Connections', 'Aborted_connects', 'Questions', 'Queries', 'Slow_queries', 'Bytes_received', 'Bytes_sent', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads', 'Innodb_row_lock_waits', 'Innodb_row_lock_time'] as const;
export const postgresMonitorStatusNames = ['numbackends', 'xact_commit', 'xact_rollback', 'blks_read', 'blks_hit', 'tup_returned', 'tup_fetched', 'tup_inserted', 'tup_updated', 'tup_deleted', 'conflicts', 'temp_files', 'temp_bytes', 'deadlocks'] as const;
export type ServerMonitorCounterName = typeof serverMonitorStatusNames[number] | typeof postgresMonitorStatusNames[number];
export interface ServerMonitorInput { connectionId: string; taskId: string; sessionLimit?: number; }
export interface ServerMonitorSummary { version: string; versionComment: string; hostname: string | null; port: string | null; currentUser: string; connectionId: string; database?: string; }
export interface ServerMonitorSession { id: string; user: string | null; host: string | null; database: string | null; command: string | null; seconds: string | null; state: string | null; sql: string | null; sqlLength: string | null; sqlTruncated: boolean; waitEvent?: string | null; }
export type ServerMonitorSection<T> = { status: 'available'; value: T } | { status: 'unavailable'; reason: string };
export interface ServerMonitorSnapshot {
  dialect?: 'mysql' | 'mariadb' | 'postgresql';
  startedAt: string; completedAt: string;
  summary: ServerMonitorSection<ServerMonitorSummary>;
  globalStatus: ServerMonitorSection<{ name: ServerMonitorCounterName; value: string }[]>;
  statisticsReset?: string | null;
  signal?: { token: string; targets: { pid: string; canCancel: boolean; canTerminate?: false }[] };
  sessions: ServerMonitorSection<{ rows: ServerMonitorSession[]; limit: number; truncated: boolean; visibility: 'account-visible-unconfirmed' }>;
  bytes: number;
}

const monitorId = z.string().min(1).max(200).refine(value => !!value.trim() && !value.includes('\0'));
/** 连接 ID 和语句 ID 保留十进制字符串，避免经过 JS number 丢失精度。 */
export function isServerMonitorNumericId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
}
const monitorPid = z.string().refine(isServerMonitorNumericId);
export const serverMonitorSignalSchema = z.object({
  connectionId: monitorId, taskId: monitorId, token: z.uuid(), pid: monitorPid,
  action: z.enum(['cancel-query', 'terminate-session']), confirmedPid: monitorPid,
}).strict().refine(input => input.pid === input.confirmedPid, '请输入准确的目标会话 ID');
export type ServerMonitorSignalInput = z.infer<typeof serverMonitorSignalSchema>;
export type ServerMonitorSignalAction = ServerMonitorSignalInput['action'];
export type ServerMonitorSignalResult = (
  | { status: 'stale' | 'denied' | 'rejected' | 'unknown' }
  | { status: 'accepted'; observation: 'ended' | 'still-present' | 'unknown' }
) & { cleanupUnconfirmed?: true };
/** IPC 与引擎共用校验，拒绝额外执行范围和非整数预算。 */
export function validateServerMonitorInput(input: ServerMonitorInput): void {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['connectionId', 'taskId', 'sessionLimit'].includes(key))) throw new Error('服务器监控参数无效');
  for (const key of ['connectionId', 'taskId'] as const) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 200) throw new Error('服务器监控标识无效');
  if (input.sessionLimit !== undefined && (!Number.isInteger(input.sessionLimit) || input.sessionLimit < 1 || input.sessionLimit > serverMonitorLimits.sessions)) throw new Error('服务器监控会话条数必须为 1 至 100');
}
