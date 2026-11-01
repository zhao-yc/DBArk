import type { TaskRecord } from './contracts';
import { sqliteTableMaintenanceFactSchema, sqliteTableMaintenanceMessages as text, type SqliteTableMaintenanceFact } from './sqliteTableMaintenance';

/** 概要仅根据Main已验证ACK展示结论，不能从进度、维护语句数量或驱动原错补造提交。 */
export function sqliteTableMaintenanceFactMessage(fact: SqliteTableMaintenanceFact): string { return fact.commitAcknowledged ? fact.action === 'drop' ? 'SQLite表删除事务已确认提交；此回执不证明保留的视图和外键引用可用，请核对目录和依赖。' : text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'not-sent' ? text.notSent : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : text.running; }
export function sqliteTableMaintenanceTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.tableMaintenance.inspect') return status === 'completed' ? 'SQLite原表维护目录已读取；关联定义、SQL和目录详情未保存到任务概要。' : status === 'running' ? '正在读取SQLite原表维护目录；尚未修改。' : 'SQLite表维护目录未交付；尚未修改。';
  if (kind === 'sqlite.tableMaintenance.preview') return status === 'completed' ? 'SQLite表维护预览已核验；尚未修改，关联定义和SQL未保存到任务概要。' : status === 'running' ? '正在只读核验SQLite表维护设计；尚未修改。' : 'SQLite表维护预览未交付；尚未修改。';
  return status === 'running' ? text.running : text.unknown;
}
/** 重启不恢复关联定义、SQL或能力；在途维护语句转未知，原提交/回滚ACK保持单向事实。 */
export function recoverSqliteTableMaintenanceTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']); const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as TaskRecord;
  if (task.kind !== 'sqlite.tableMaintenance.apply') return { ...safe, status: task.status === 'running' ? 'failed' : task.status, ...(task.status === 'running' ? { finishedAt: task.finishedAt ?? new Date().toISOString() } : {}), message: sqliteTableMaintenanceTaskMessage(task.kind, task.status === 'running' ? 'failed' : task.status) };
  const parsed = sqliteTableMaintenanceFactSchema.safeParse(task.sqliteTableMaintenance); if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次表维护回执无法核验，请核对原表，不会自动重放。' };
  const original = parsed.data, fact: SqliteTableMaintenanceFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteTableMaintenance: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : safe.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteTableMaintenanceFactMessage(fact) };
}
