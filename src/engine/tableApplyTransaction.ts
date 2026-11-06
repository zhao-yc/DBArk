import type { ResultSetHeader } from 'mysql2';
import type { RowChange, SqlPreview, TableInfo, CellValue } from '../shared/contracts';
import { emptyTableApplyEvidence, type TableApplyEvidence, type TableApplyProgress } from '../shared/tableApplyReceipt';
import { buildChanges } from './sql';

export interface TableApplyControl {
  evidence: TableApplyEvidence; operationId?: string; expectedPlan?: SqlPreview['statements'];
  checkCancelled(): void; broken(): boolean; cancelled(): boolean;
  send(sql: string, params: CellValue[], acknowledged: (result: ResultSetHeader) => void): Promise<ResultSetHeader>;
  lockInfo(): Promise<TableInfo>; rollback(): Promise<ResultSetHeader>; emit(p: TableApplyProgress): void;
  afterWrite?(index: number): Promise<void>;
  strictSync?: true;
}

/** 保留原单表InnoDB事务；实际ACK先于取消/收尾，未知提交不补发、不反称回滚。 */
export async function applyTableTransaction(info: TableInfo, changes: RowChange[], c: TableApplyControl): Promise<{ affectedRows: number }> {
  const e = c.evidence; let transactionStarted = false; let sequence = 0, phase: TableApplyProgress['phase'] = 'executing', reason: TableApplyProgress['reason'] = 'validation';
  const emit = () => { if (c.operationId) c.emit({ operationId: c.operationId, sequence: ++sequence, phase, reason, evidence: { ...e } }); };
  const acknowledged = (r: ResultSetHeader) => { e.transactionKnown = Number.isInteger(r.serverStatus) && r.serverStatus >= 0 && r.serverStatus <= 65535; e.transactionOpen = e.transactionKnown && Boolean(r.serverStatus & 1); };
  try {
    const options = c.strictSync ? { binaryText: 'cast' as const } : undefined;
    const plan = buildChanges(info, changes, options);
    if (c.expectedPlan && JSON.stringify(c.expectedPlan) !== JSON.stringify(plan.statements)) throw Error('提交计划自预览后已变化，请重新预览；未发送本批数据写入');
    await c.send('START TRANSACTION', [], r => { transactionStarted = true; acknowledged(r); });
    if (!e.transactionKnown || !e.transactionOpen) throw Error('未确认事务已开始，未发送本批数据写入');
    // LIMIT 0取得目标MDL并在同一事务内保持；重新读取引擎后才具备目标回滚保证。
    const lockedPlan = buildChanges(await c.lockInfo(), changes, options);
    if (JSON.stringify(lockedPlan.statements) !== JSON.stringify(plan.statements)) throw Error('目标结构在提交前已变化，请重新预览');
    e.transactionProtected = true; reason = 'none'; emit();
    for (const [index, item] of lockedPlan.statements.entries()) {
      c.checkCancelled(); e.dmlMayHaveBeenSent = true; emit();
      await c.send(item.sql, item.params, r => {
        acknowledged(r);
        if (!e.transactionKnown || !e.transactionOpen) { e.transactionProtected = false; reason = 'transaction-unconfirmed'; throw Error('无法确认目标写入仍在同一事务内'); }
        if (!Number.isSafeInteger(r.affectedRows) || r.affectedRows < 0 || !Number.isSafeInteger(e.serverReportedRows + r.affectedRows)) throw Error('服务器返回的行数无效');
        e.dmlAcknowledged++; e.serverReportedRows += r.affectedRows; emit();
        if (c.strictSync && r.warningStatus !== 0) throw Error('服务器返回写入警告');
        if (r.affectedRows !== 1) { reason = 'conflict'; throw Error('数据已被其他连接修改、删除或行定位不唯一'); }
      });
      if (c.afterWrite) await c.afterWrite(index);
    }
    c.checkCancelled(); phase = 'committing'; e.commitMayHaveBeenSent = true; emit();
    await c.send('COMMIT', [], r => { acknowledged(r); e.commitAcknowledged = e.transactionKnown && !e.transactionOpen; emit(); });
    if (!e.commitAcknowledged) { reason = 'commit-unconfirmed'; throw Error('提交回应无法确认事务终态'); }
    return { affectedRows: e.serverReportedRows };
  } catch (error) {
    if (e.commitAcknowledged) { reason = 'cleanup-failed'; return { affectedRows: e.serverReportedRows }; }
    if (e.commitMayHaveBeenSent) { reason = 'commit-unconfirmed'; throw Error('提交结果未知，请核对服务器；未自动重放本批修改'); }
    if ((transactionStarted || e.dmlMayHaveBeenSent) && !c.broken()) {
      phase = 'rolling-back'; emit();
      try { const r = await c.rollback(); acknowledged(r); e.rollbackAcknowledged = e.transactionKnown && !e.transactionOpen; }
      catch { e.transactionKnown = false; e.rollbackAcknowledged = false; }
    }
    if (!e.dmlMayHaveBeenSent) { reason = 'validation'; throw error; }
    if (!e.transactionProtected) { reason = 'transaction-unconfirmed'; throw Error('写入的连续事务保护未知，不能确认目标修改已回滚；未自动重放'); }
    if (!e.rollbackAcknowledged) { reason = 'rollback-unconfirmed'; throw Error('数据修改结果未知，未确认目标事务回滚；未自动重放'); }
    if (c.strictSync) {
      // 约束错误的驱动消息可能包含字段原值。只显示错误类别和已确认的事务状态。
      const code = (error as { code?: unknown } | null)?.code;
      const message = code === 'ER_DUP_ENTRY' ? '目标唯一约束冲突' : typeof code === 'string' ? '数据库写入失败' :
        error instanceof Error ? error.message : '写入校验失败';
      throw Error('整批已回滚：' + message);
    }
    if ((reason as TableApplyProgress['reason']) === 'conflict') throw Error('数据并发冲突，目标表事务内整批修改已回滚；不包含触发器或外部副作用');
    reason = c.cancelled() ? 'cancelled' : 'statement-failed'; throw Error('本批修改未完成，已确认目标表事务回滚；不包含触发器或外部副作用');
  } finally { phase = 'terminal'; emit(); }
}

export { emptyTableApplyEvidence };
