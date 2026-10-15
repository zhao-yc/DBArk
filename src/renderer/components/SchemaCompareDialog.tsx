import { useEffect, useRef, useState } from 'react';
import { schemaCompareInputSchema, type SchemaCompareInput, type SchemaCompareReport, type SchemaCompareTarget } from '../../shared/schemaCompare';
import { schemaCompareZh as text } from '../locales/schemaCompare.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../schemaCompare.css';

export interface SchemaCompareServices { compare(input: SchemaCompareInput): Promise<SchemaCompareReport>; cancel(taskId: string): Promise<unknown>; }
export interface SchemaCompareDialogProps {
  connections: readonly { id: string; name: string }[]; services: SchemaCompareServices;
  initialSource?: SchemaCompareTarget; initialTarget?: SchemaCompareTarget; onClose(): void;
}
/** 通过注入服务接线，渲染侧只提交连接引用和表名，不能持有凭据或自行借用查询会话。 */
export function SchemaCompareDialog({ connections, services, initialSource, initialTarget, onClose }: SchemaCompareDialogProps) {
  const fallback = { connectionId: connections[0]?.id ?? '', database: '', table: '' };
  const [source, setSource] = useState<SchemaCompareTarget>(initialSource ?? fallback), [target, setTarget] = useState<SchemaCompareTarget>(initialTarget ?? fallback);
  const [report, setReport] = useState<SchemaCompareReport | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [showSame, setShowSame] = useState(false);
  const active = useRef<string | null>(null), work = useRef<Promise<void> | null>(null), cancellation = useRef<{ taskId: string; promise: Promise<unknown> } | null>(null), stopRequested = useRef(false), alive = useRef(true), closeRequested = useRef(false), service = useRef(services);
  const activeService = useRef(services);
  service.current = services;
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) void activeService.current.cancel(active.current).catch(() => undefined); }; }, []);
  /** 同一轮固定输入和服务；取消后即使读取晚到成功，也不能把结果重新显示为已完成。 */
  function compare(): void {
    if (active.current || closeRequested.current) return;
    const parsed = schemaCompareInputSchema.safeParse({ source, target, taskId: crypto.randomUUID() });
    if (!parsed.success) { setError(text.invalid); return; }
    const taskId = parsed.data.taskId, current = service.current;
    activeService.current = current;
    active.current = taskId; stopRequested.current = false; setBusy(true); setReport(null); setError('');
    const operation = (async () => {
      try { const result = await current.compare(parsed.data); if (alive.current && !stopRequested.current) setReport(result); }
      catch (reason) { if (alive.current) setError(stopRequested.current ? text.stopped : reason instanceof Error ? reason.message : text.failed); }
      finally { if (alive.current) { setBusy(false); if (stopRequested.current) setError(text.stopped); } active.current = null; }
    })();
    work.current = operation; void operation.finally(() => { if (work.current === operation) work.current = null; });
  }
  /** 取消等待后端真实释放；取消请求本身不会清除 busy 或解除关闭等待。 */
  async function cancel(): Promise<void> {
    if (!active.current) return;
    stopRequested.current = true;
    const taskId = active.current;
    if (cancellation.current?.taskId !== taskId) {
      const promise = activeService.current.cancel(taskId).finally(() => { if (cancellation.current?.promise === promise) cancellation.current = null; });
      cancellation.current = { taskId, promise };
    }
    await cancellation.current.promise;
  }
  /** 关闭先取消再等待读取终态；取消失败时保留窗口和错误供核对。 */
  async function close(): Promise<void> {
    if (closeRequested.current) return;
    closeRequested.current = true; setClosing(true);
    try { await cancel(); await work.current; onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.failed); closeRequested.current = false; setClosing(false); }
  }
  /** 表身份始终保留原始输入，引用和 SQL 转义由引擎负责。 */
  function endpoint(label: string, value: SchemaCompareTarget, update: (value: SchemaCompareTarget) => void) {
    return <fieldset disabled={busy || closing}><legend>{label}</legend><Field label={text.connection}><select aria-label={`${label} ${text.connection}`} value={value.connectionId} onChange={event => update({ ...value, connectionId: event.target.value })}><option value="">—</option>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></Field><Field label={text.database}><input aria-label={`${label} ${text.database}`} value={value.database} onChange={event => update({ ...value, database: event.target.value })}/></Field><Field label={text.table}><input aria-label={`${label} ${text.table}`} value={value.table} onChange={event => update({ ...value, table: event.target.value })}/></Field></fieldset>;
  }
  const rows = report?.rows.filter(row => showSame || row.status !== 'same') ?? [];
  const endpointName = (value: SchemaCompareTarget) => `${connections.find(connection => connection.id === value.connectionId)?.name ?? value.connectionId} · ${JSON.stringify(value.database)}.${JSON.stringify(value.table)}`;
  return <Modal title={text.title} wide onClose={() => void close()}><div className="modal-content schema-compare-content">
    <p>{text.direction}</p><p className="muted small">{text.scope} {text.exactNames}</p>
    <div className="schema-compare-endpoints">{endpoint(text.source, source, setSource)}{endpoint(text.target, target, setTarget)}</div><ErrorBox message={error}/>
    <div role="status">{closing ? text.closing : busy ? text.reading : report ? <>{Object.entries(report.counts).map(([status, count]) => <span className="schema-compare-count" key={status}>{text.statuses[status as keyof typeof text.statuses]}：{count}</span>)}{report.counts.unknown > 0 ? text.unknown : report.counts.added + report.counts.removed + report.counts.changed === 0 ? text.allSame : ''}</> : text.empty}</div>
    {report && <><p className="schema-compare-direction">{endpointName(report.source)}（{text.version} {report.sourceVersion}） → {endpointName(report.target)}（{text.version} {report.targetVersion}）</p><label><input type="checkbox" checked={showSame} onChange={event => setShowSame(event.target.checked)}/>{text.showSame}</label>
      <div className="schema-compare-results"><table><thead><tr><th>{text.category}</th><th>{text.name}</th><th>{text.status}</th><th>{text.properties}</th><th>{text.detail}</th></tr></thead><tbody>{rows.map((row, index) => <tr key={JSON.stringify([row.category, row.name, index])} data-status={row.status}><td>{text.categories[row.category]}</td><td><code>{JSON.stringify(row.name)}</code></td><td>{text.statuses[row.status]}</td><td>{row.changedProperties.map(key => text.propertiesMap[key] ?? key).join('、')}{row.reasons.length > 0 && <ul aria-label={text.reasons}>{row.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}</td><td><details><summary>{text.detail}</summary><strong>{text.sourceDefinition}</strong><pre>{row.source?.rawSql ?? text.absent}</pre><strong>{text.targetDefinition}</strong><pre>{row.target?.rawSql ?? text.absent}</pre></details></td></tr>)}</tbody></table></div>
      <details className="schema-compare-limits"><summary>{text.limits}</summary><ul>{report.ignored.map(reason => <li key={reason}>{reason}</li>)}</ul><details><summary>{text.rawTail}</summary>{report.ignoredFragments.map(fragment => <div key={fragment.side}><strong>{fragment.side === 'source' ? text.source : text.target}</strong><pre>{fragment.rawSql}</pre></div>)}</details></details></>}
  </div><footer className="modal-footer"><button className="primary" disabled={busy || closing} onClick={compare}>{text.start}</button><button disabled={!busy || closing} onClick={() => void cancel().catch(reason => setError(reason instanceof Error ? reason.message : text.failed))}>{text.cancel}</button><span className="grow"/><button disabled={closing} onClick={() => void close()}>{text.close}</button></footer></Modal>;
}
