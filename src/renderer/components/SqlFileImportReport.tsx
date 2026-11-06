import type { SqlFileImportReceipt } from '../../shared/sqlFileImport';
import { sqlFileImportZh as sqlText } from '../locales/sqlFileImport.zh-CN';

/** SQL结果只展示结构化执行事实，不用兼容行数推断提交、保留或整文件成功。 */
export function SqlFileImportReport({ receipt }: { receipt: SqlFileImportReceipt | null }) {
  if (!receipt) return <section className="error-box" role="status" aria-label={sqlText.title}><strong>{sqlText.unconfirmed}</strong><p>{sqlText.unconfirmedHint}</p></section>;
  const failure = receipt.failure, position = failure?.statement?.location;
  const warning = receipt.termination !== 'completed' || !!receipt.cleanupWarning || receipt.rollback.state === 'unconfirmed' || receipt.transaction !== 'closed';
  return <section className={warning ? 'info-strip' : 'sql-import-result'} role="status" aria-label={sqlText.title} style={{ overflowWrap: 'anywhere' }}>
    <strong>{receipt.termination === 'completed' ? sqlText.completed : receipt.termination === 'cancelled' ? sqlText.cancelled : sqlText.failed}</strong>
    <p>{sqlText.completedStatements}：{receipt.completedStatements}</p><p>{sqlText.affected}：{receipt.serverReportedAffectedRows === null ? sqlText.unknown : receipt.serverReportedAffectedRows}</p><p className="muted small">{sqlText.affectedHint}</p>
    <p>{sqlText.encoding}：{sqlText.encodings[receipt.encoding]}</p>
    {failure && <><p>{sqlText.phase}：{sqlText.phases[failure.phase]}{failure.statement && ` · ${sqlText.ordinal(failure.statement.ordinal)}`}</p><p>{sqlText.location}：{position ? sqlText.position(position.start, position.end) : sqlText.positionUnavailable}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{failure.message}</pre></>}
    <p className="muted small">{sqlText.positionHint}</p><p>{sqlText.rollback}：{sqlText.rollbackStates[receipt.rollback.state]}</p>{receipt.rollback.message && <p>{receipt.rollback.message}</p>}<p>{sqlText.transaction}：{sqlText.transactions[receipt.transaction]}</p>
    {(receipt.rollback.state === 'unconfirmed' || receipt.transaction !== 'closed') && <p className="warning-text">{sqlText.unknownHint}</p>}
    {receipt.cleanupWarning && <p className="warning-text">{sqlText.cleanup}：{receipt.cleanupWarning}</p>}
  </section>;
}
