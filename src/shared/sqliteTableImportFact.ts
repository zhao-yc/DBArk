import type { TaskRecord } from './contracts';
import type { SqliteWriteFact } from './sqliteTableEdit';
import { sqliteImportWriteFactSchema } from './sqliteTableImport';

/** 导入任务概要固定脱敏，不使用文件名、路径、内容、映射、SQL或驱动原错。 */
export function sqliteImportTaskMessage(kind: string, status: TaskRecord['status']): string {
  if (kind === 'sqlite.tableImport.inspect') return status === 'running' ? '正在完整检查SQLite导入来源；样本和文件内容不保存到任务概要。' : status === 'completed' ? 'SQLite导入来源已完整检查，尚未写入。' : 'SQLite导入来源检查未交付，尚未写入。';
  if (kind === 'sqlite.tableImport.preview') return status === 'running' ? '正在按字段映射预检完整文件；尚未写入SQLite。' : status === 'completed' ? 'SQLite导入预检通过，等待准确目标确认；尚未写入。' : 'SQLite导入预检未通过或未交付，尚未写入。';
  return status === 'running' ? '正在执行SQLite整文件导入事务；行值和SQL不保存到任务概要。' : 'SQLite导入事务尚未取得可信确认，请核对原库；不会自动重放。';
}
/** 处理行数不能证明提交，仅根据Main同步保存的事务确认展示结论。 */
export function sqliteImportFactMessage(fact: SqliteWriteFact): string {
  return fact.commitAcknowledged ? 'SQLite整文件导入已确认提交；文件内容和SQL未保存到任务概要。' : fact.rollbackAcknowledged ? 'SQLite整文件导入已确认回滚；不会自动重试。' : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? 'SQLite导入结果未知，请核对原库；禁止重复执行原批次。' : fact.phase === 'not-sent' ? 'SQLite导入尚未发送；不会自动重试。' : sqliteImportTaskMessage('sqlite.tableImport.apply', 'running');
}
/** 重启仅恢复最小事实；在途阶段转未知，不恢复文件、映射或导入能力。 */
export function recoverSqliteImportTask(task: TaskRecord): TaskRecord {
  const keys = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']);
  const safe = Object.fromEntries(Object.entries(task).filter(([key]) => keys.has(key))) as TaskRecord;
  const parsed = sqliteImportWriteFactSchema.safeParse(task.sqliteWrite);
  if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次导入回执无法核验，请核对原库；不会自动重放。' };
  const original = parsed.data, fact: SqliteWriteFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteWrite: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : task.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteImportFactMessage(fact) };
}
