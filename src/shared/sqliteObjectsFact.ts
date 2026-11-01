import type { TaskRecord } from './contracts';
import { sqliteObjectsFactSchema, sqliteObjectsMessages as text, type SqliteObjectsFact } from './sqliteObjects';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、对象DDL数量或驱动原错补造提交。 */
export function sqliteObjectsFactMessage(fact: SqliteObjectsFact): string { return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
export function sqliteObjectsTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.objects.inspect') return status === 'completed' ? 'SQLite原对象目录已读取；关联定义、SQL和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原对象目录；尚未修改。' : 'SQLite对象目录未交付；尚未修改。';
  if (kind === 'sqlite.objects.preview') return status === 'completed' ? 'SQLite对象预览文本和归属已核对；正文将在提交事务内由原生解析，SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite对象设计；尚未修改。' : 'SQLite对象预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复关联定义、SQL或能力；在途对象DDL转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteObjectsTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.objects.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteObjectsTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteObjectsFactSchema.safeParse(task.sqliteObjects); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次对象定义回执无法核验，请核对原对象，不会自动重放。' };
  const original = parsed.data, fact: SqliteObjectsFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteObjects: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteObjectsFactMessage(fact) };
}
