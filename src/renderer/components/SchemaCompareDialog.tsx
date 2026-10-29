import { useEffect, useRef, useState } from 'react';
import { schemaCompareInputSchema, type SchemaCompareInput, type SchemaCompareResult, type SchemaComparePreview, type SchemaComparePreviewInput, type SchemaCompareTarget } from '../../shared/schemaCompare';
import { schemaCompareZh as text } from '../locales/schemaCompare.zh-CN';
import { ErrorBox, Field, Modal, UsageHelp } from './ui';
import { SchemaCompareResults } from './SchemaCompareResults';
import { applySchemaCompareResultsSelection } from '../schemaCompareResults';
import '../schemaCompare.css';

export interface SchemaCompareServices { compare(input: SchemaCompareInput): Promise<SchemaCompareResult>; cancel(taskId: string): Promise<unknown>; preview(input: SchemaComparePreviewInput): Promise<SchemaComparePreview>; release(snapshotId: string): Promise<unknown>; save(sql: string): Promise<boolean>; }
export interface SchemaCompareDialogProps {
  connections: readonly { id: string; name: string }[]; services: SchemaCompareServices;
  initialSource?: SchemaCompareTarget; initialTarget?: SchemaCompareTarget; onClose(): void;
}
/** 已接纳选择以同步引用为权威；React state 只负责投影，不能作为请求范围的同步屏障。 */
interface AcceptedSelection { report: SchemaCompareResult; ids: string[]; revision: number; }
/** 通过注入服务接线，渲染侧只提交连接引用和表名，不能持有凭据或自行借用查询会话。 */
export function SchemaCompareDialog({ connections, services, initialSource, initialTarget, onClose }: SchemaCompareDialogProps) {
  const fallback = { connectionId: '', database: '', table: '' };
  const [source, setSource] = useState<SchemaCompareTarget>(initialSource ?? fallback), [target, setTarget] = useState<SchemaCompareTarget>(initialTarget ?? fallback);
  const [report, setReport] = useState<SchemaCompareResult | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<SchemaComparePreview | null>(null), [previewBusy, setPreviewBusy] = useState(false), [saved, setSaved] = useState(false);
  const snapshot = useRef<string | null>(null), previewWork = useRef<Promise<void> | null>(null);
  const active = useRef<string | null>(null), work = useRef<Promise<void> | null>(null), cancellation = useRef<{ taskId: string; promise: Promise<unknown> } | null>(null), stopRequested = useRef(false), alive = useRef(true), closeRequested = useRef(false), service = useRef(services);
  const activeService = useRef(services), cancelFailure = useRef<string | null>(null);
  const previewOwner = useRef<object | null>(null), currentEpoch = useRef<object | null>(null), epoch = {};
  const acceptedSelection = useRef<AcceptedSelection | null>(null), acceptedPreview = useRef<{ selection: AcceptedSelection; value: SchemaComparePreview } | null>(null);
  currentEpoch.current = epoch;
  const selectionBlocked = useRef(false); selectionBlocked.current = !!previewOwner.current || busy || closing || previewBusy;
  service.current = services;
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (snapshot.current) void service.current.release(snapshot.current).catch(() => undefined); if (active.current) void activeService.current.cancel(active.current).catch(() => undefined); }; }, []);
  /** 同一轮固定输入和服务；取消后即使读取晚到成功，也不能把结果重新显示为已完成。 */
  function compare(): void {
    if (active.current || closeRequested.current) return;
    const parsed = schemaCompareInputSchema.safeParse({ source, target, taskId: crypto.randomUUID() });
    if (!parsed.success) { setError(text.invalid); return; }
    const taskId = parsed.data.taskId, current = service.current;
    if (snapshot.current) void current.release(snapshot.current).catch(() => undefined);
    snapshot.current = null; acceptedSelection.current = null; acceptedPreview.current = null; setSelected([]); setPreview(null); setSaved(false);
    activeService.current = current;
    active.current = taskId; stopRequested.current = false; cancelFailure.current = null; setBusy(true); setReport(null); setError('');
    const operation = (async () => {
      try { const result = await current.compare(parsed.data); if (alive.current && !stopRequested.current) { snapshot.current = result.snapshotId; acceptedSelection.current = { report: result, ids: [], revision: 0 }; setReport(result); } else await current.release(result.snapshotId); }
      catch (reason) { if (alive.current) setError(stopRequested.current ? cancelFailure.current ?? text.stopped : reason instanceof Error ? reason.message : text.failed); }
      finally { if (alive.current) { setBusy(false); if (stopRequested.current) setError(cancelFailure.current ?? text.stopped); } active.current = null; }
    })();
    work.current = operation; void operation.finally(() => { if (work.current === operation) work.current = null; });
  }
  /** 取消等待后端真实释放；取消请求本身不会清除 busy 或解除关闭等待。 */
  async function cancel(): Promise<void> {
    if (!active.current) return;
    stopRequested.current = true;
    const taskId = active.current;
    if (cancellation.current?.taskId !== taskId) {
      const promise = activeService.current.cancel(taskId).catch(reason => { cancelFailure.current = reason instanceof Error ? reason.message : text.failed; throw reason; }).finally(() => { if (cancellation.current?.promise === promise) cancellation.current = null; });
      cancellation.current = { taskId, promise };
    }
    await cancellation.current.promise;
  }
  /** 关闭先取消再等待读取终态；取消失败时保留窗口和错误供核对。 */
  async function close(): Promise<void> {
    if (!alive.current || currentEpoch.current !== epoch || closeRequested.current) return;
    closeRequested.current = true; setClosing(true);
    try { await cancel(); await work.current; await previewWork.current; if (snapshot.current) await service.current.release(snapshot.current); snapshot.current = null; acceptedSelection.current = null; acceptedPreview.current = null; onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.failed); closeRequested.current = false; setClosing(false); }
  }
  /** 输入一旦变化就撤销旧预览，避免将旧方向或旧目标显示为当前结果。 */
  function changeEndpoint(side: 'source' | 'target', value: SchemaCompareTarget): void {
    if (snapshot.current) void service.current.release(snapshot.current).catch(() => undefined);
    snapshot.current = null; acceptedSelection.current = null; acceptedPreview.current = null; setReport(null); setPreview(null); setSelected([]); setSaved(false);
    if (side === 'source') setSource(value); else setTarget(value);
  }
  /** 只把稳定差异的类别与名称传给引擎；SQL 及原定义不回传。 */
  function generatePreview(): void {
    const selection = acceptedSelection.current;
    if (!report || !selection || selection.report !== report || !selection.ids.length || selection.ids.length > 100 || !alive.current || currentEpoch.current !== epoch || snapshot.current !== report.snapshotId || selectionBlocked.current || active.current || closeRequested.current) return;
    // 服务可以在首个 await 前同步回调；先登记 owner 并封锁选择，重绘不能清掉进行中的封锁。
    const owner = {}; previewOwner.current = owner; selectionBlocked.current = true;
    setPreviewBusy(true); setError(''); setSaved(false);
    const id = report.snapshotId, input = { snapshotId: id, selections: report.rows.filter(row => selection.ids.includes(JSON.stringify([row.category, row.name]))).map(({ category, name }) => ({ category, name })) };
    const operation = (async () => {
      try {
        const result = await service.current.preview(input);
        if (previewOwner.current === owner && acceptedSelection.current === selection && alive.current && !closeRequested.current && snapshot.current === id) { acceptedPreview.current = { selection, value: result }; setPreview(result); }
      } catch (reason) { if (previewOwner.current === owner && alive.current && snapshot.current === id) setError(reason instanceof Error ? reason.message : text.failed); }
      finally {
        // 只释放本操作；旧异步尾部不能解除后续操作、比较或关闭持有的门。
        if (previewOwner.current === owner) { previewOwner.current = null; selectionBlocked.current = !!active.current || closeRequested.current; if (alive.current) setPreviewBusy(false); }
      }
    })();
    previewWork.current = operation;
    void operation.finally(() => { if (previewWork.current === operation) previewWork.current = null; });
  }
  /** 保存期间固定审查稿并等待原生文件操作，关闭不会抢先卸载窗口。 */
  async function savePreview(): Promise<void> {
    const draft = acceptedPreview.current;
    if (!preview || !report || !draft || draft.value !== preview || draft.selection !== acceptedSelection.current || draft.selection.report !== report || !alive.current || currentEpoch.current !== epoch || snapshot.current !== report.snapshotId || selectionBlocked.current || active.current || closeRequested.current) return;
    // 保存同样先同步封锁，固定本次 SQL 与快照，防止原生文件对话框返回前选择改变。
    const owner = {}, id = report.snapshotId, sql = draft.value.sql; previewOwner.current = owner; selectionBlocked.current = true;
    setPreviewBusy(true); setError('');
    const operation = (async () => {
      try { const saved = await service.current.save(sql); if (saved && previewOwner.current === owner && acceptedPreview.current === draft && acceptedSelection.current === draft.selection && alive.current && !closeRequested.current && snapshot.current === id) setSaved(true); }
      catch (reason) { if (previewOwner.current === owner && alive.current && snapshot.current === id) setError(reason instanceof Error ? reason.message : text.failed); }
      finally { if (previewOwner.current === owner) { previewOwner.current = null; selectionBlocked.current = !!active.current || closeRequested.current; if (alive.current) setPreviewBusy(false); } }
    })();
    previewWork.current = operation;
    try { await operation; } finally { if (previewWork.current === operation) previewWork.current = null; }
  }
  /** 表身份始终保留原始输入，引用和 SQL 转义由引擎负责。 */
  function endpoint(label: string, value: SchemaCompareTarget, update: (value: SchemaCompareTarget) => void) {
    return <fieldset disabled={busy || closing || previewBusy}><legend>{label}</legend><Field label={text.connection}><select aria-label={`${label} ${text.connection}`} value={value.connectionId} onChange={event => update({ ...value, connectionId: event.target.value })}><option value="">—</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></Field><Field label={text.database}><input aria-label={`${label} ${text.database}`} value={value.database} onChange={event => update({ ...value, database: event.target.value })}/></Field><Field label={text.table}><input aria-label={`${label} ${text.table}`} value={value.table} onChange={event => update({ ...value, table: event.target.value })}/></Field></fieldset>;
  }
  const endpointName = (value: SchemaCompareTarget) => `${connections.find(connection => connection.id === value.connectionId)?.name ?? value.connectionId} · ${JSON.stringify(value.database)}.${JSON.stringify(value.table)}`;
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content schema-compare-content">
    <p>{text.direction}</p><UsageHelp><p>{text.scope}</p><p>{text.exactNames}</p></UsageHelp>
    <div className="schema-compare-endpoints">{endpoint(text.source, source, value => changeEndpoint('source', value))}{endpoint(text.target, target, value => changeEndpoint('target', value))}</div><button disabled={busy || closing || previewBusy} onClick={() => { changeEndpoint('source', target); changeEndpoint('target', source); }}>{text.swap}</button><ErrorBox message={error}/>
    <div role="status">{closing ? text.closing : busy ? text.reading : report ? <>{Object.entries(report.counts).map(([status, count]) => <span className="schema-compare-count" key={status}>{text.statuses[status as keyof typeof text.statuses]}：{count}</span>)}{report.counts.unknown > 0 ? text.unknown : report.counts.added + report.counts.removed + report.counts.changed === 0 ? text.allSame : ''}</> : text.empty}</div>
    {report && <><p className="schema-compare-direction">{endpointName(report.source)}（{text.version} {report.sourceVersion}） → {endpointName(report.target)}（{text.version} {report.targetVersion}）</p>
      <SchemaCompareResults report={report} selectedIds={selected} disabled={busy || closing || previewBusy} onSelectionChange={event => {
        // 回调捕获原快照，接纳前活读父级归属和忙碌状态，旧报告不能借新报告改选择或撤销预览。
        if (!alive.current || event.snapshotId !== report.snapshotId || snapshot.current !== report.snapshotId || selectionBlocked.current || active.current || closeRequested.current) return;
        const current = acceptedSelection.current;
        if (!current || current.report !== report) return;
        const next = applySchemaCompareResultsSelection(report, current.ids, event);
        if (next.length === current.ids.length && next.every((id, index) => id === current.ids[index])) return;
        // 在同一个同步段先发布权威选择代次并撤销旧稿，再排队显示状态；预览不再读取旧闭包。
        acceptedSelection.current = { report, ids: next, revision: current.revision + 1 }; acceptedPreview.current = null;
        setSelected(next);
        setPreview(null); setSaved(false);
      }}/>
      <p>{text.previewScope} {text.selected}：{selected.length}</p>
      {preview && <section className="schema-compare-preview"><h3>{text.sql}</h3><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><textarea aria-label={text.sql} readOnly value={preview.sql}/>{preview.blocked.length > 0 && <div><strong>{text.blocked}</strong><ul>{preview.blocked.map(item => <li key={JSON.stringify([item.category, item.name])}>{text.categories[item.category]} {JSON.stringify(item.name)}：{item.reasons.join('；')}</li>)}</ul></div>}{saved && <p role="status">{text.saved}</p>}</section>}
      <details className="schema-compare-limits"><summary>{text.limits}</summary><ul>{report.ignored.map(reason => <li key={reason}>{reason}</li>)}</ul><details><summary>{text.rawTail}</summary>{report.ignoredFragments.map(fragment => <div key={fragment.side}><strong>{fragment.side === 'source' ? text.source : text.target}</strong><pre>{fragment.rawSql}</pre></div>)}</details></details></>}
  </div><footer className="modal-footer"><button className="primary" disabled={busy || closing || previewBusy} onClick={compare}>{text.start}</button><button disabled={!busy || closing} onClick={() => void cancel().catch(reason => setError(reason instanceof Error ? reason.message : text.failed))}>{text.cancel}</button><button disabled={!report || !selected.length || selected.length > 100 || busy || closing || previewBusy} onClick={generatePreview}>{text.preview}</button><button disabled={!preview?.statements.length || busy || closing || previewBusy} onClick={() => void savePreview()}>{text.save}</button><span className="grow"/><button disabled={closing} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
