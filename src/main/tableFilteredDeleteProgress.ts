import type { TableFilteredDeleteProgress } from '../shared/tableFilteredDelete';

/** 删除发送与提交／回滚 ACK 单向累积，迟到进度不得抹掉已经确认的实际事务结果。 */
export function mergeTableFilteredDeleteProgress(previous: TableFilteredDeleteProgress | undefined, progress: TableFilteredDeleteProgress): TableFilteredDeleteProgress {
  const next = { ...progress };
  next.dmlMayHaveBeenSent ||= !!previous?.dmlMayHaveBeenSent; next.commitMayHaveBeenSent ||= !!previous?.commitMayHaveBeenSent;
  next.commitAcknowledged ||= !!previous?.commitAcknowledged; next.rollbackAcknowledged ||= !!previous?.rollbackAcknowledged;
  // DML可能发送后失去事务位是不可逆失败；历史曾有事务不能证明后来ROLLBACK覆盖全部删除。
  const protectionLost = !!previous?.dmlMayHaveBeenSent && !previous.transactionProtected || progress.dmlMayHaveBeenSent && !progress.transactionProtected;
  next.transactionProtected = !protectionLost && (progress.transactionProtected || !!previous?.transactionProtected);
  next.snapshotBytes = Math.max(next.snapshotBytes, previous?.snapshotBytes ?? 0);
  if (previous?.commitAcknowledged) { next.rows = previous.rows; next.totalRows = previous.totalRows; }
  if (next.commitAcknowledged) next.outcome = 'committed';
  else if (next.dmlMayHaveBeenSent && !next.transactionProtected) next.outcome = 'unknown';
  else if (next.rollbackAcknowledged && next.transactionProtected && !next.commitMayHaveBeenSent) next.outcome = 'rolled-back';
  else if (previous?.outcome === 'unknown' && next.outcome === 'not-sent') next.outcome = 'unknown';
  return next;
}
