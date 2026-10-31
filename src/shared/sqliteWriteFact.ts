import { z } from 'zod';
import type { TaskRecord } from './contracts';
import { sqliteTablePageSchema } from './sqliteTableBrowse';
import { sqliteTableEditMessages as text, type SqliteWriteFact } from './sqliteTableEdit';

const target = z.object({ connectionId: z.string().min(1).max(200), database: z.literal('main'), table: sqliteTablePageSchema.shape.table }).strict();
/** 最小回执拒绝附带SQL、行值和路径；相互矛盾的ACK不能成为已提交事实。 */
export const sqliteWriteFactSchema = z.object({ operationId: z.uuid(), target, phase: z.enum(['not-sent', 'writing', 'commit-pending', 'committed', 'rolled-back', 'unknown']), requestedRows: z.number().int().min(1).max(500), appliedRows: z.number().int().min(0).max(500), commitMayHaveBeenSent: z.boolean(), commitAcknowledged: z.boolean(), rollbackAcknowledged: z.boolean() }).strict().superRefine((fact, context) => {
  if (fact.appliedRows > fact.requestedRows || fact.commitAcknowledged !== (fact.phase === 'committed') || fact.rollbackAcknowledged !== (fact.phase === 'rolled-back') || fact.commitAcknowledged && !fact.commitMayHaveBeenSent || fact.phase === 'commit-pending' && !fact.commitMayHaveBeenSent || fact.phase === 'not-sent' && (fact.appliedRows !== 0 || fact.commitMayHaveBeenSent)) context.addIssue({ code: 'custom', message: 'SQLite提交记录包含矛盾的执行事实' });
});
/** 固定概要只使用确认事实，不使用驱动错误原文或用户输入生成持久消息。 */
export function sqliteWriteFactMessage(fact: SqliteWriteFact): string {
  return fact.commitAcknowledged ? text.committed : fact.rollbackAcknowledged ? text.rolledBack : fact.phase === 'unknown' || fact.commitMayHaveBeenSent ? text.unknown : fact.phase === 'not-sent' ? 'SQLite修改尚未发送；未自动重试，原值及SQL未保存。' : text.running;
}
/** 重启绝不重放：COMMIT前在途记录也保持未知；已确认ACK不会因上次收尾失败被覆盖。 */
export function recoverSqliteWriteTask(task: TaskRecord): TaskRecord {
  const allowed = new Set(['id', 'kind', 'status', 'progress', 'message', 'startedAt', 'finishedAt']);
  const safe = Object.fromEntries(Object.entries(task).filter(([key]) => allowed.has(key))) as Omit<TaskRecord, 'sqliteWrite' | 'errors'>;
  const parsed = sqliteWriteFactSchema.safeParse(task.sqliteWrite);
  if (!parsed.success) return { ...safe, status: 'failed', finishedAt: task.finishedAt ?? new Date().toISOString(), message: 'SQLite上次提交记录无法核验，请核对原数据库；禁止自动重放。' };
  const original = parsed.data;
  const fact: SqliteWriteFact = ['writing', 'commit-pending'].includes(original.phase) ? { ...original, phase: 'unknown', commitAcknowledged: false, rollbackAcknowledged: false } : original;
  return { ...safe, sqliteWrite: fact, status: fact.commitAcknowledged ? 'completed' : task.status === 'cancelled' && (fact.phase === 'not-sent' || fact.rollbackAcknowledged) ? 'cancelled' : 'failed', progress: fact.commitAcknowledged ? 100 : task.progress, finishedAt: task.finishedAt ?? new Date().toISOString(), message: sqliteWriteFactMessage(fact) };
}
