import type { TableFilteredUpdateProgress } from '../shared/tableFilteredUpdate';

/** 提交及回滚ACK只能累积，旧进度、晚取消或进程退出均不能把真实提交改写成可重放失败。 */
export function mergeTableFilteredUpdateProgress(previous: TableFilteredUpdateProgress | undefined, progress: TableFilteredUpdateProgress): TableFilteredUpdateProgress {
  const next = { ...progress };
  next.dmlMayHaveBeenSent ||= !!previous?.dmlMayHaveBeenSent; next.commitMayHaveBeenSent ||= !!previous?.commitMayHaveBeenSent;
  next.commitAcknowledged ||= !!previous?.commitAcknowledged; next.rollbackAcknowledged ||= !!previous?.rollbackAcknowledged; next.transactionProtected ||= !!previous?.transactionProtected;
  next.snapshotBytes = Math.max(next.snapshotBytes, previous?.snapshotBytes ?? 0);
  if (previous?.commitAcknowledged) { next.rows = previous.rows; next.totalRows = previous.totalRows; }
  if (next.commitAcknowledged) next.outcome = 'committed';
  else if (next.rollbackAcknowledged && next.transactionProtected) next.outcome = 'rolled-back';
  else if (previous?.outcome === 'unknown' && next.outcome === 'not-sent') next.outcome = 'unknown';
  return next;
}
