import type { TaskRecord } from './contracts';
import { sqliteIndexesFactSchema, sqliteIndexesMessages as text, type SqliteIndexesFact } from './sqliteIndexes';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、DDL数量或驱动原错补造提交。 */
export function sqliteIndexesFactMessage(fact: SqliteIndexesFact): string { return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
export function sqliteIndexesTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.indexes.inspect') return status === 'completed' ? 'SQLite原索引目录已读取；SQL、表达式和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原索引目录；尚未修改。' : 'SQLite索引目录未交付；尚未修改。';
  if (kind === 'sqlite.indexes.preview') return status === 'completed' ? 'SQLite索引预览已核验；尚未修改，表达式和SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite索引设计；尚未修改。' : 'SQLite索引预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复SQL、表达式或能力；在途DDL转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteIndexesTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.indexes.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteIndexesTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteIndexesFactSchema.safeParse(task.sqliteIndexes); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次索引回执无法核验，请核对原表，不会自动重放。' };
  const original = parsed.data, fact: SqliteIndexesFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteIndexes: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteIndexesFactMessage(fact) };
}
