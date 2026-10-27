import { sqlFileImportMessage, type FileImportResult, type SqlFileImportReceipt } from '../shared/sqlFileImport';
import type { ManagedConnection } from './connection';

export interface SqlFileImportEvidence { result: FileImportResult; }
/** 只相信原连接新鲜且合法的协议状态，连接断开/状态未知不能反推事务已回滚。 */
export function sqlFileImportTransaction(managed: ManagedConnection): SqlFileImportReceipt['transaction'] {
  const status = managed.serverStatus;
  return !managed.broken && managed.transactionStateKnown === true && Number.isInteger(status) && status! >= 0 && status! <= 65535 ? status! & 1 ? 'open' : 'closed' : 'unknown';
}
/** 在建连前固定任务身份；缺少执行证据时只会返回失败初始状态。 */
export function createSqlFileImportEvidence(taskId: string, encoding: SqlFileImportReceipt['encoding']): SqlFileImportEvidence {
  return { result: { rows: 0, errors: [], sql: { version: 1, taskId, encoding, positionBasis: 'decoded-utf16', termination: 'failed', completedStatements: 0, serverReportedAffectedRows: 0, failure: { phase: 'initial-mode', message: 'SQL文件导入未开始执行；不会自动重试' }, rollback: { state: 'not-needed' }, transaction: 'unknown' } } };
}
/** 外层取消及关闭晚失败仅补充事实，不抹掉原阶段、已完成前缀或回滚ACK。 */
export function finishSqlFileImportEvidence(evidence: SqlFileImportEvidence, cancelled: boolean, cleanupWarning?: string): FileImportResult {
  const result = evidence.result, receipt = result.sql!;
  if (cancelled) {
    receipt.termination = 'cancelled';
    receipt.failure ??= { phase: 'finalize', message: 'SQL文件任务已取消；此前已提交操作保留，不会自动重放' };
  }
  if (cleanupWarning) receipt.cleanupWarning = sqlFileImportMessage(receipt.cleanupWarning ? receipt.cleanupWarning + '；' + cleanupWarning : cleanupWarning);
  const errors: string[] = [];
  if (receipt.failure) errors.push(sqlFileImportMessage(`SQL文件在${receipt.failure.phase}阶段停止${receipt.failure.statement ? `（第${receipt.failure.statement.ordinal}条）` : ''}；${receipt.failure.message}。此前提交及非事务副作用可能保留；${receipt.rollback.state === 'confirmed' ? '原连接ROLLBACK已收到完整确认' : receipt.rollback.state === 'unconfirmed' ? '未提交事务的回滚结果未确认' : '未执行附加回滚'}；累计服务器影响计数不是已提交行数，不会自动重试。`));
  if (receipt.cleanupWarning) errors.push(receipt.cleanupWarning);
  result.errors = errors; return result;
}
