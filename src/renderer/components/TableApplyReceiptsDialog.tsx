import { useEffect, useRef, useState } from 'react';
import type { TableApplyReceipt, TableApplyReceiptPage } from '../../shared/tableApplyReceipt';
import { tableApplyReceiptZh as t } from '../locales/tableApplyReceiptZh';
import { formatText } from '../locales/zh-CN';
import { errorMessage, invoke } from '../lib';
import { Empty, ErrorBox, Modal } from './ui';

/** 详情纯展示受限回执；没有执行、重试或把历史SQL放回编辑器的入口。 */
export function TableApplyReceiptDetails({ receipt: r }: { receipt: TableApplyReceipt }) {
  return <section aria-label={t.details}><h3>{r.outcome ? t.outcomes[r.outcome] : t.running}</h3>
    <dl><dt>{t.labels.operationId}</dt><dd>{r.operationId}</dd><dt>{t.labels.previewId}</dt><dd>{r.previewId}</dd><dt>{t.labels.connectionRevision}</dt><dd>{r.target.connectionId} / {r.target.connectionRevision}</dd><dt>{t.labels.target}</dt><dd>{r.target.database} / {r.target.table}</dd>
      <dt>{t.labels.intent}</dt><dd>{formatText(t.intent, r.intent.insert, r.intent.update, r.intent.delete, r.intent.statementCount)}</dd>
      <dt>{t.labels.time}</dt><dd>{r.startedAt} / {r.finishedAt ?? t.unfinished}</dd><dt>{t.labels.phase}</dt><dd>{t.phases[r.phase]}</dd><dt>{t.labels.reason}</dt><dd>{t.reasons[r.reason]}</dd>
      <dt>{t.rows}</dt><dd>{r.committedReportedRows === null ? t.pendingConfirmation : r.committedReportedRows}</dd>
      <dt>{t.labels.transactionProtected}</dt><dd>{r.evidence.transactionProtected ? t.confirmed : t.unconfirmed}</dd><dt>{t.labels.dmlAcknowledged}</dt><dd>{r.evidence.dmlAcknowledged}</dd><dt>{t.labels.acknowledgements}</dt><dd>{r.evidence.commitAcknowledged ? t.yes : t.no} / {r.evidence.rollbackAcknowledged ? t.yes : t.no}</dd></dl>
    {r.outcome === 'unknown' && <p className="warning-text">{t.unknown}</p>}{r.committedReportedRows === null && <p>{t.pendingRows}</p>}<p className="muted">{t.clock}</p><p className="muted">{t.privacy}</p>
  </section>;
}

/** 仅在用户打开时分页读取；进度只刷新当前页，关闭后迟到响应不更新界面。 */
export function TableApplyReceiptsDialog({ onClose, onTasks, initialOperationId }: { onClose(): void; onTasks?(): void; initialOperationId?: string }) {
  const [page, setPage] = useState(0), [outcome, setOutcome] = useState(''), [connectionId, setConnectionId] = useState('');
  const [reply, setReply] = useState<TableApplyReceiptPage>(), [selected, setSelected] = useState<TableApplyReceipt>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialOperationId);
  useEffect(() => { const off = window.dbark?.onTask(event => { if (event.tableApply) setRevision(n => n + 1); }); return () => off?.(); }, []);
  useEffect(() => {
    const id = ++generation.current; setBusy(true); setError('');
    void invoke('table.applyReceipt.list', { page, ...(outcome ? { outcome: outcome as TableApplyReceipt['outcome'] & string } : {}), ...(connectionId.trim() ? { connectionId: connectionId.trim() } : {}) }).then(result => { if (generation.current === id) setReply(result); }).catch(e => { if (generation.current === id) setError(errorMessage(e)); }).finally(() => { if (generation.current === id) setBusy(false); });
    return () => { generation.current++; };
  }, [page, outcome, connectionId, revision]);
  useEffect(() => {
    let active = true; if (!selectedId) { setSelected(undefined); return; }
    void invoke('table.applyReceipt.detail', { operationId: selectedId }).then(r => { if (active) setSelected(r); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [selectedId, revision]);
  return <Modal title={t.title} wide onClose={onClose}><div className="modal-content">{onTasks && <button onClick={onTasks}>{t.tasks}</button>}<p>{t.privacy}</p><ErrorBox message={error}/>
    <label>{t.filters.outcome}<select aria-label={t.filters.outcomeAria} value={outcome} onChange={e => { setOutcome(e.target.value); setPage(0); setSelectedId(undefined); }}><option value="">{t.filters.all}</option>{Object.entries(t.outcomes).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    <label>{t.filters.connectionId}<input aria-label={t.filters.connectionAria} value={connectionId} onChange={e => { setConnectionId(e.target.value); setPage(0); setSelectedId(undefined); }}/></label>
    <div aria-busy={busy}>{reply?.items.map(r => <article key={r.operationId} className="task-card"><strong>{r.target.database} / {r.target.table}</strong><p>{r.outcome ? t.outcomes[r.outcome] : t.running}</p><p>{r.startedAt}</p><button onClick={() => setSelectedId(r.operationId)}>{t.viewDetails}</button></article>)}{reply && !reply.items.length && <Empty title={t.empty} text={t.privacy}/>}</div>
    <footer><button disabled={busy || page === 0} onClick={() => setPage(n => n - 1)}>{t.previousPage}</button><span>{formatText(t.page, page + 1, reply?.total ?? 0)}</span><button disabled={busy || !reply || (page + 1) * 25 >= reply.total} onClick={() => setPage(n => n + 1)}>{t.nextPage}</button></footer>
    {selected && <TableApplyReceiptDetails receipt={selected}/>}</div></Modal>;
}
