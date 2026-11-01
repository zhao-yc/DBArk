import type { TaskRecord } from './contracts';
import { sqliteTableRenameFactSchema, sqliteTableRenameMessages as text, type SqliteTableRenameFact } from './sqliteTableRename';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、DDL数量或驱动原错补造提交。 */
export function sqliteTableRenameFactMessage(fact: SqliteTableRenameFact): string { return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
export function sqliteTableRenameTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.tableRename.inspect') return status === 'completed' ? 'SQLite原表目录已读取；新表名、SQL和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原表目录；尚未修改。' : 'SQLite表重命名目录未交付；尚未修改。';
  if (kind === 'sqlite.tableRename.preview') return status === 'completed' ? 'SQLite表重命名预览已核验；尚未修改，新表名和SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite表重命名设计；尚未修改。' : 'SQLite表重命名预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复新表名、SQL或能力；在途DDL转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteTableRenameTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.tableRename.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteTableRenameTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteTableRenameFactSchema.safeParse(task.sqliteTableRename); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次表重命名回执无法核验，请核对原表，不会自动重放。' };
  const original = parsed.data, fact: SqliteTableRenameFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteTableRename: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteTableRenameFactMessage(fact) };
}
