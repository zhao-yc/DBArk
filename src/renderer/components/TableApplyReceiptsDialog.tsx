import { useEffect, useRef, useState } from 'react';
import type { TableApplyReceipt, TableApplyReceiptPage } from '../../shared/tableApplyReceipt';
import { tableApplyReceiptZh as t } from '../locales/tableApplyReceiptZh';
import { errorMessage, invoke } from '../lib';
import { Empty, ErrorBox, Modal } from './ui';

/** 详情纯展示受限回执；没有执行、重试或把历史SQL放回编辑器的入口。 */
export function TableApplyReceiptDetails({ receipt: r }: { receipt: TableApplyReceipt }) {
  return <section aria-label="提交记录详情"><h3>{r.outcome ? t.outcomes[r.outcome] : t.running}</h3>
    <dl><dt>操作编号</dt><dd>{r.operationId}</dd><dt>预览编号</dt><dd>{r.previewId}</dd><dt>连接编号 / 修订</dt><dd>{r.target.connectionId} / {r.target.connectionRevision}</dd><dt>目标库表</dt><dd>{r.target.database} / {r.target.table}</dd>
      <dt>计划类别</dt><dd>新增 {r.intent.insert}，修改 {r.intent.update}，删除 {r.intent.delete}；执行计划 {r.intent.statementCount} 条</dd>
      <dt>开始 / 结束</dt><dd>{r.startedAt} / {r.finishedAt ?? '尚未结束'}</dd><dt>阶段</dt><dd>{t.phases[r.phase]}</dd><dt>原因</dt><dd>{t.reasons[r.reason]}</dd>
      <dt>{t.rows}</dt><dd>{r.committedReportedRows === null ? '未知 / 尚未确认' : r.committedReportedRows}</dd>
      <dt>目标连续事务保护</dt><dd>{r.evidence.transactionProtected ? '已确认' : '未确认'}</dd><dt>提交前语句回应数</dt><dd>{r.evidence.dmlAcknowledged}</dd><dt>COMMIT成功回应 / ROLLBACK成功回应</dt><dd>{r.evidence.commitAcknowledged ? '是' : '否'} / {r.evidence.rollbackAcknowledged ? '是' : '否'}</dd></dl>
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
    <label>结果 <select aria-label="提交结果筛选" value={outcome} onChange={e => { setOutcome(e.target.value); setPage(0); setSelectedId(undefined); }}><option value="">全部</option>{Object.entries(t.outcomes).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
    <label>连接编号 <input aria-label="提交连接筛选" value={connectionId} onChange={e => { setConnectionId(e.target.value); setPage(0); setSelectedId(undefined); }}/></label>
    <div aria-busy={busy}>{reply?.items.map(r => <article key={r.operationId} className="task-card"><strong>{r.target.database} / {r.target.table}</strong><p>{r.outcome ? t.outcomes[r.outcome] : t.running}</p><p>{r.startedAt}</p><button onClick={() => setSelectedId(r.operationId)}>查看提交详情</button></article>)}{reply && !reply.items.length && <Empty title={t.empty} text={t.privacy}/>}</div>
    <footer><button disabled={busy || page === 0} onClick={() => setPage(n => n - 1)}>上一页</button><span>第 {page + 1} 页 / 共 {reply?.total ?? 0} 条</span><button disabled={busy || !reply || (page + 1) * 25 >= reply.total} onClick={() => setPage(n => n + 1)}>下一页</button></footer>
    {selected && <TableApplyReceiptDetails receipt={selected}/>}</div></Modal>;
}
