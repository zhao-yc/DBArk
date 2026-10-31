import { randomUUID } from 'node:crypto';
import type { TaskRecord } from '../shared/contracts';
import type { SqliteEditTarget, SqliteTableEditOutcome, SqliteWriteFact } from '../shared/sqliteTableEdit';
import { sqliteTableEditMessages as text } from '../shared/sqliteTableEdit';
import { sqliteWriteFactMessage, sqliteWriteFactSchema } from '../shared/sqliteWriteFact';

interface Ports { task(id: string): TaskRecord | undefined; replace(task: TaskRecord): void; save(task: TaskRecord): void; notify?(task: TaskRecord): void; }
/** Main在COMMIT发送前同步持久最小事实；内存中的真实ACK不能因后续磁盘失败被抹去。 */
export class SqliteWriteRecords {
  constructor(private readonly ports: Ports) {}
  begin(taskId: string, target: SqliteEditTarget, requestedRows: number): { operationId: string; record(fact: SqliteWriteFact): void } {
    const operationId = randomUUID();
    const record = (value: SqliteWriteFact) => {
      const fact = sqliteWriteFactSchema.parse(value), task = this.ports.task(taskId);
      if (!task || task.kind !== 'sqlite.tableEdit.apply' || fact.operationId !== operationId || fact.target.connectionId !== target.connectionId || fact.target.database !== target.database || fact.target.table !== target.table || fact.requestedRows !== requestedRows) throw Error('SQLite提交回执不属于原操作');
      const previous = task.sqliteWrite;
      if (previous && (previous.operationId !== operationId || previous.commitAcknowledged && !fact.commitAcknowledged || previous.rollbackAcknowledged && fact.phase !== 'rolled-back' || previous.commitMayHaveBeenSent && !fact.commitMayHaveBeenSent && !fact.rollbackAcknowledged)) throw Error('SQLite提交事实不能倒退或换绑');
      const next: TaskRecord = { ...task, sqliteWrite: structuredClone(fact), message: sqliteWriteFactMessage(fact), ...(fact.commitAcknowledged ? { status: 'completed', progress: 100, finishedAt: new Date().toISOString() } : {}) };
      this.ports.replace(next);
      // 每行进度只更新内存；阶段变化及所有提交/回滚边界必须同步落盘，避免整库配置每行重复fsync。
      if (previous?.phase !== 'writing' || fact.phase !== 'writing') { this.ports.save(next); this.ports.notify?.(next); }
    };
    record({ operationId, target: { ...target }, requestedRows, appliedRows: 0, phase: 'not-sent', commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false });
    return { operationId, record };
  }
  /** 可信内存ACK优先，避免Main其它收尾异常把已提交批次显示成可重试失败。 */
  committed(taskId: string): SqliteWriteFact | undefined { const value = this.ports.task(taskId)?.sqliteWrite; return value?.commitAcknowledged ? structuredClone(value) : undefined; }
  /** Outcome必须对应原随机操作和已记录事实，任务事件或可复用编号不能补造成功。 */
  outcome(taskId: string, value: unknown): SqliteTableEditOutcome {
    const result = value as SqliteTableEditOutcome | undefined, task = this.ports.task(taskId), fact = sqliteWriteFactSchema.parse(result?.fact), recorded = task?.sqliteWrite;
    if (!result || !recorded || result.operationId !== recorded.operationId || fact.operationId !== recorded.operationId || JSON.stringify(fact) !== JSON.stringify(sqliteWriteFactSchema.parse(recorded)) || result.target.connectionId !== fact.target.connectionId || result.target.database !== fact.target.database || result.target.table !== fact.target.table || !result.counts || !['insert', 'update', 'delete'].every(key => Number.isSafeInteger(result.counts[key as keyof typeof result.counts]) && result.counts[key as keyof typeof result.counts] >= 0) || result.counts.insert + result.counts.update + result.counts.delete !== fact.requestedRows || typeof result.message !== 'string') throw Error(text.unknown);
    const expected = fact.commitAcknowledged ? 'committed' : fact.rollbackAcknowledged ? 'rolled-back' : fact.phase === 'not-sent' ? 'not-sent' : 'unknown';
    if (result.outcome !== expected) throw Error(text.unknown);
    return result;
  }
}
