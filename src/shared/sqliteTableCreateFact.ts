import type { TaskRecord } from './contracts';
import { sqliteTableCreateFactSchema, sqliteTableCreateMessages as text, type SqliteTableCreateFact } from './sqliteTableCreate';

/** 持久化只使用最小事务事实，不保存设计、SQL、默认值、驱动原错或文件路径。 */
export function sqliteCreateFactMessage(fact: SqliteTableCreateFact): string {
  return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running;
}

/** 重启保留已确认提交/回滚；任何在途DDL都转未知，绝不自动重放原设计。 */
export function recoverSqliteTableCreateTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']);
  const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  const parsed = sqliteTableCreateFactSchema.safeParse(task.sqliteCreate);
  if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次建表回执无法核验，请核对原库，不会自动重放。' };
  const original = parsed.data, fact: SqliteTableCreateFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteCreate: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteCreateFactMessage(fact) };
}
