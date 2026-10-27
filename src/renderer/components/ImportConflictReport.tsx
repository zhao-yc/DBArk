import type { FileImportConflictReport } from '../../shared/fileImportConflict';
import { fileImportConflictZh as text } from '../locales/fileImportConflict.zh-CN';

/** 处理与提交的两个计数组保持独立，绝不从兼容rows或affectedRows推算导入成功。 */
export function ImportConflictReport({ report }: { report: FileImportConflictReport | null }) {
  if (!report) return <section className="error-box" role="status" aria-label={text.report}><strong>{text.unconfirmed}</strong><p>{text.unconfirmedHint}</p></section>;
  const labels = { inserted: text.inserted, matchedUpdates: text.matchedUpdates, skippedExisting: text.skippedExisting, skippedMissing: text.skippedMissing } as const;
  return <section role="status" aria-label={text.report} style={{ overflowWrap: 'anywhere' }}>
    <strong>{report.termination === 'completed' ? text.completed : report.termination === 'cancelled' ? text.cancelled : text.failed}</strong><p>{text.mode}：{report.mode === 'skip-existing' ? text.skipExisting : report.mode === 'upsert' ? text.upsert : text.updateExisting}</p><p>{text.readRecords}：{report.readRecords}</p>
    <div style={{ overflowX: 'auto' }}><table><thead><tr><th></th>{Object.values(labels).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{(['acknowledged', 'committed'] as const).map(kind => <tr key={kind}><th>{kind === 'acknowledged' ? text.acknowledged : text.committed}</th>{(Object.keys(labels) as Array<keyof typeof labels>).map(key => <td key={key}>{report[kind][key]}</td>)}</tr>)}</tbody></table></div>
    <p className="muted small">{text.countsHint}</p><p>{text.batch}：{text.batches[report.currentBatch]}</p>
    {report.failure && <><p>{text.stage}：{text.stages[report.failure.stage]}{report.failure.record ? ` · ${text.record(report.failure.record)}` : ''}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{report.failure.message}</pre></>}
    {report.currentBatch === 'commit-unknown' && <p className="warning-text">{text.noReplay}</p>}{(report.currentBatch === 'rollback-unconfirmed' || report.currentBatch === 'pending') && <p className="warning-text">{text.checkServer}</p>}
    {report.cleanupWarning && <p className="warning-text">{text.cleanup}：{report.cleanupWarning}</p>}
  </section>;
}
