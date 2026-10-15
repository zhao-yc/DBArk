import { useEffect, useRef, useState } from 'react';
import { schemaCompareInputSchema, type SchemaCompareInput, type SchemaCompareResult, type SchemaComparePreview, type SchemaComparePreviewInput, type SchemaCompareTarget } from '../../shared/schemaCompare';
import { schemaCompareZh as text } from '../locales/schemaCompare.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../schemaCompare.css';

export interface SchemaCompareServices { compare(input: SchemaCompareInput): Promise<SchemaCompareResult>; cancel(taskId: string): Promise<unknown>; preview(input: SchemaComparePreviewInput): Promise<SchemaComparePreview>; release(snapshotId: string): Promise<unknown>; save(sql: string): Promise<boolean>; }
export interface SchemaCompareDialogProps {
  connections: readonly { id: string; name: string }[]; services: SchemaCompareServices;
  initialSource?: SchemaCompareTarget; initialTarget?: SchemaCompareTarget; onClose(): void;
}
/** 通过注入服务接线，渲染侧只提交连接引用和表名，不能持有凭据或自行借用查询会话。 */
export function SchemaCompareDialog({ connections, services, initialSource, initialTarget, onClose }: SchemaCompareDialogProps) {
  const fallback = { connectionId: '', database: '', table: '' };
  const [source, setSource] = useState<SchemaCompareTarget>(initialSource ?? fallback), [target, setTarget] = useState<SchemaCompareTarget>(initialTarget ?? fallback);
  const [report, setReport] = useState<SchemaCompareResult | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [showSame, setShowSame] = useState(false);
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<SchemaComparePreview | null>(null), [previewBusy, setPreviewBusy] = useState(false), [saved, setSaved] = useState(false);
  const snapshot = useRef<string | null>(null), previewWork = useRef<Promise<void> | null>(null);
  const active = useRef<string | null>(null), work = useRef<Promise<void> | null>(null), cancellation = useRef<{ taskId: string; promise: Promise<unknown> } | null>(null), stopRequested = useRef(false), alive = useRef(true), closeRequested = useRef(false), service = useRef(services);
  const activeService = useRef(services), cancelFailure = useRef<string | null>(null);
  service.current = services;
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (snapshot.current) void service.current.release(snapshot.current).catch(() => undefined); if (active.current) void activeService.current.cancel(active.current).catch(() => undefined); }; }, []);
  /** 同一轮固定输入和服务；取消后即使读取晚到成功，也不能把结果重新显示为已完成。 */
  function compare(): void {
    if (active.current || closeRequested.current) return;
    const parsed = schemaCompareInputSchema.safeParse({ source, target, taskId: crypto.randomUUID() });
    if (!parsed.success) { setError(text.invalid); return; }
    const taskId = parsed.data.taskId, current = service.current;
    if (snapshot.current) void current.release(snapshot.current).catch(() => undefined);
    snapshot.current = null; setSelected([]); setPreview(null); setSaved(false);
    activeService.current = current;
    active.current = taskId; stopRequested.current = false; cancelFailure.current = null; setBusy(true); setReport(null); setError('');
    const operation = (async () => {
      try { const result = await current.compare(parsed.data); if (alive.current && !stopRequested.current) { snapshot.current = result.snapshotId; setReport(result); } else await current.release(result.snapshotId); }
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
    if (closeRequested.current) return;
    closeRequested.current = true; setClosing(true);
    try { await cancel(); await work.current; await previewWork.current; if (snapshot.current) await service.current.release(snapshot.current); snapshot.current = null; onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.failed); closeRequested.current = false; setClosing(false); }
  }
  /** 输入一旦变化就撤销旧预览，避免将旧方向或旧目标显示为当前结果。 */
  function changeEndpoint(side: 'source' | 'target', value: SchemaCompareTarget): void {
    if (snapshot.current) void service.current.release(snapshot.current).catch(() => undefined);
    snapshot.current = null; setReport(null); setPreview(null); setSelected([]); setSaved(false);
    if (side === 'source') setSource(value); else setTarget(value);
  }
  /** 只把稳定差异的类别与名称传给引擎；SQL 及原定义不回传。 */
  function generatePreview(): void {
    if (!report || previewBusy || closeRequested.current) return;
    setPreviewBusy(true); setError(''); setSaved(false);
    const id = report.snapshotId;
    const operation = (async () => {
      try {
        const result = await service.current.preview({ snapshotId: id, selections: report.rows.filter(row => selected.includes(JSON.stringify([row.category, row.name]))).map(({ category, name }) => ({ category, name })) });
        if (alive.current && !closeRequested.current && snapshot.current === id) setPreview(result);
      } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : text.failed); }
      finally { if (alive.current) setPreviewBusy(false); }
    })();
    previewWork.current = operation;
  }
  /** 保存期间固定审查稿并等待原生文件操作，关闭不会抢先卸载窗口。 */
  async function savePreview(): Promise<void> {
    if (!preview || previewBusy) return;
    setPreviewBusy(true); setError('');
    const operation = (async () => { try { if (await service.current.save(preview.sql)) setSaved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : text.failed); } finally { setPreviewBusy(false); } })();
    previewWork.current = operation; await operation;
  }
  /** 表身份始终保留原始输入，引用和 SQL 转义由引擎负责。 */
  function endpoint(label: string, value: SchemaCompareTarget, update: (value: SchemaCompareTarget) => void) {
    return <fieldset disabled={busy || closing || previewBusy}><legend>{label}</legend><Field label={text.connection}><select aria-label={`${label} ${text.connection}`} value={value.connectionId} onChange={event => update({ ...value, connectionId: event.target.value })}><option value="">—</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></Field><Field label={text.database}><input aria-label={`${label} ${text.database}`} value={value.database} onChange={event => update({ ...value, database: event.target.value })}/></Field><Field label={text.table}><input aria-label={`${label} ${text.table}`} value={value.table} onChange={event => update({ ...value, table: event.target.value })}/></Field></fieldset>;
  }
  const rows = report?.rows.filter(row => showSame || row.status !== 'same') ?? [];
  const endpointName = (value: SchemaCompareTarget) => `${connections.find(connection => connection.id === value.connectionId)?.name ?? value.connectionId} · ${JSON.stringify(value.database)}.${JSON.stringify(value.table)}`;
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content schema-compare-content">
    <p>{text.direction}</p><p className="muted small">{text.scope} {text.exactNames}</p>
    <div className="schema-compare-endpoints">{endpoint(text.source, source, value => changeEndpoint('source', value))}{endpoint(text.target, target, value => changeEndpoint('target', value))}</div><button disabled={busy || closing || previewBusy} onClick={() => { changeEndpoint('source', target); changeEndpoint('target', source); }}>{text.swap}</button><ErrorBox message={error}/>
    <div role="status">{closing ? text.closing : busy ? text.reading : report ? <>{Object.entries(report.counts).map(([status, count]) => <span className="schema-compare-count" key={status}>{text.statuses[status as keyof typeof text.statuses]}：{count}</span>)}{report.counts.unknown > 0 ? text.unknown : report.counts.added + report.counts.removed + report.counts.changed === 0 ? text.allSame : ''}</> : text.empty}</div>
    {report && <><p className="schema-compare-direction">{endpointName(report.source)}（{text.version} {report.sourceVersion}） → {endpointName(report.target)}（{text.version} {report.targetVersion}）</p><label><input type="checkbox" checked={showSame} onChange={event => setShowSame(event.target.checked)}/>{text.showSame}</label>
      <div className="schema-compare-results"><table><thead><tr><th>{text.select}</th><th>{text.category}</th><th>{text.name}</th><th>{text.status}</th><th>{text.properties}</th><th>{text.detail}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={JSON.stringify([row.category, row.name, index])} data-status={row.status}><td><input type="checkbox" aria-label={text.select + ' ' + text.categories[row.category] + ' ' + row.name} disabled={busy || closing || previewBusy || row.status === 'same' || row.status === 'unknown'} checked={selected.includes(JSON.stringify([row.category, row.name]))} onChange={event => { const key = JSON.stringify([row.category, row.name]); setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(value => value !== key)); setPreview(null); setSaved(false); }}/></td><td>{text.categories[row.category]}</td><td><code>{JSON.stringify(row.name)}</code></td><td>{text.statuses[row.status]}</td><td>{row.changedProperties.map(key => text.propertiesMap[key] ?? key).join('、')}{row.reasons.length > 0 && <ul aria-label={text.reasons}>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}</td><td><details><summary>{text.detail}</summary><strong>{text.sourceDefinition}</strong><pre>{row.source?.rawSql ?? text.absent}</pre><strong>{text.targetDefinition}</strong><pre>{row.target?.rawSql ?? text.absent}</pre></details></td></tr>)}</tbody></table></div>
      <p>{text.previewScope} {text.selected}：{selected.length}</p>
      {preview && <section className="schema-compare-preview"><h3>{text.sql}</h3><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><textarea aria-label={text.sql} readOnly value={preview.sql}/>{preview.blocked.length > 0 && <div><strong>{text.blocked}</strong><ul>{preview.blocked.map(item => <li key={JSON.stringify([item.category, item.name])}>{text.categories[item.category]} {JSON.stringify(item.name)}：{item.reasons.join('；')}</li>)}</ul></div>}{saved && <p role="status">{text.saved}</p>}</section>}
      <details className="schema-compare-limits"><summary>{text.limits}</summary><ul>{report.ignored.map(reason => <li key={reason}>{reason}</li>)}</ul><details><summary>{text.rawTail}</summary>{report.ignoredFragments.map(fragment => <div key={fragment.side}><strong>{fragment.side === 'source' ? text.source : text.target}</strong><pre>{fragment.rawSql}</pre></div>)}</details></details></>}
  </div><footer className="modal-footer"><button className="primary" disabled={busy || closing || previewBusy} onClick={compare}>{text.start}</button><button disabled={!busy || closing} onClick={() => void cancel().catch(reason => setError(reason instanceof Error ? reason.message : text.failed))}>{text.cancel}</button><button disabled={!report || !selected.length || selected.length > 100 || busy || closing || previewBusy} onClick={generatePreview}>{text.preview}</button><button disabled={!preview?.statements.length || busy || closing || previewBusy} onClick={() => void savePreview()}>{text.save}</button><span className="grow"/><button disabled={closing} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
