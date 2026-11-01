import type { TaskRecord } from './contracts';
import { sqliteTableRebuildFactSchema, sqliteTableRebuildMessages as text, type SqliteTableRebuildFact } from './sqliteTableRebuild';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、DDL数量或驱动原错补造提交。 */
export function sqliteTableRebuildFactMessage(fact: SqliteTableRebuildFact): string { return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
/** 只读与预览任务只显示固定阶段，不回显字段草稿、目录或底层错误。 */
export function sqliteTableRebuildTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.tableRebuild.inspect') return status === 'completed' ? 'SQLite原表重建目录已读取；字段名、默认值、SQL和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原表重建目录；尚未修改。' : 'SQLite表重建目录未交付；尚未修改。';
  if (kind === 'sqlite.tableRebuild.preview') return status === 'completed' ? 'SQLite表重建预览已核验；尚未修改，字段名、默认值和SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite表重建设计；尚未修改。' : 'SQLite表重建预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复字段名、默认值、SQL或能力；在途DDL转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteTableRebuildTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.tableRebuild.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteTableRebuildTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteTableRebuildFactSchema.safeParse(task.sqliteTableRebuild); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次重建回执无法核验，请核对原表，不会自动重放。' };
  const original = parsed.data, fact: SqliteTableRebuildFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteTableRebuild: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteTableRebuildFactMessage(fact) };
}
