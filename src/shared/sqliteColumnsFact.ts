import type { TaskRecord } from './contracts';
import { sqliteColumnsFactSchema, sqliteColumnsMessages as text, type SqliteColumnsFact } from './sqliteColumns';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、DDL数量或驱动原错补造提交。 */
export function sqliteColumnsFactMessage(fact: SqliteColumnsFact): string { return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
export function sqliteColumnsTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.columns.inspect') return status === 'completed' ? 'SQLite原字段目录已读取；字段名、默认值、SQL和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原字段目录；尚未修改。' : 'SQLite字段目录未交付；尚未修改。';
  if (kind === 'sqlite.columns.preview') return status === 'completed' ? 'SQLite字段预览已核验；尚未修改，字段名、默认值和SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite字段设计；尚未修改。' : 'SQLite字段预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复字段名、默认值、SQL或能力；在途DDL转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteColumnsTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.columns.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteColumnsTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteColumnsFactSchema.safeParse(task.sqliteColumns); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次字段回执无法核验，请核对原表，不会自动重放。' };
  const original = parsed.data, fact: SqliteColumnsFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteColumns: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteColumnsFactMessage(fact) };
}
