import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TableStatisticsInput, TableStatisticsOutput } from '../../shared/tableStatistics';
import { TableStatisticsIntent } from '../tableStatisticsIntent';
import { checkTableStatisticsOutput, tableStatisticsCellPreview } from '../tableStatisticsResult';
import { filterRuleSummary } from '../tableFilters';
import { tableFilterGroupSummary } from '../tableFilterGroups';
import { errorMessage, invoke, uid } from '../lib';
import { tableStatisticsZh as text } from '../locales/tableStatistics.zh-CN';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import '../tableStatistics.css';

export interface TableStatisticsServices { statistics(input: TableStatisticsInput): Promise<TableStatisticsOutput>; cancel(taskId: string): Promise<unknown>; }
/** 正式统计仅通过有类型的独立只读任务，不执行渲染层SQL或聚合当前页。 */
export const tableStatisticsServices: TableStatisticsServices = { statistics: input => invoke('table.statistics', input), cancel: taskId => invoke('query.cancel', { taskId }) };
type Operation = { taskId: string; promise: Promise<void>; cancelled: boolean; cancelPromise?: Promise<unknown> };
type StatisticsReceipt = { output: TableStatisticsOutput; distinct: boolean };

/** 勾选仅改变本地草稿；显式开始才按冻结筛选统计服务器全部匹配记录。 */
export function TableStatisticsDialog({ base, intent, onClose, onActivity, services = tableStatisticsServices }: {
  base: { connectionId: string; database: string; table: string }; intent: TableStatisticsIntent;
  onClose(): void; onActivity(delta: 1 | -1): void; services?: TableStatisticsServices;
}) {
  const origin = useRef({ base: { ...base }, intent, services }).current;
  if (origin.intent !== intent || origin.services !== services || origin.base.connectionId !== base.connectionId || origin.base.database !== base.database || origin.base.table !== base.table) origin.intent.invalidate();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), selectedRef = useRef(selected); selectedRef.current = selected;
  const [distinct, setDistinct] = useState(false), distinctRef = useRef(distinct); distinctRef.current = distinct;
  const [receipt, setReceipt] = useState<StatisticsReceipt>(), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [invalid, setInvalid] = useState(false);
  const alive = useRef(true), closingRef = useRef(false), operation = useRef<Operation | null>(null), revision = useRef(0);
  const activity = useRef(onActivity), closeCallback = useRef(onClose); activity.current = onActivity; closeCallback.current = onClose;
  const ticket = {}, committed = useRef<object | null>(null);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = null; }; });
  /** 任意入口都核原实例与永久意图；旧复选框/按钮不能投递后继选择。 */
  function current(): boolean { return alive.current && !closingRef.current && origin.intent === intent && origin.services === services && intent.current(); }
  function editable(): boolean { return current() && !operation.current && committed.current === ticket; }
  /** 取消只发送一次，原Promise和父标签占用一直保留至finally。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.cancelled) return;
    active.cancelled = true; revision.current++;
    active.cancelPromise = Promise.resolve().then(() => origin.services.cancel(active.taskId)).catch(() => undefined);
    if (alive.current) { setReceipt(undefined); setMessage(text.cancelling); }
  }
  /** 原选择同步占门并固定taskId，连点以及取消ACK均不能提前启动下一次统计。 */
  function start(): void {
    if (!editable() || selectedRef.current !== selected || distinctRef.current !== distinct) return;
    const names = origin.intent.source.columns.filter(column => selected.has(column.name)).map(column => column.name);
    if (names.length !== selected.size || names.length > 12) { setError(text.tooMany); return; }
    const taskId = uid(), generation = ++revision.current, includeDistinct = distinct;
    let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active || active.cancelled) return;
      const output = await origin.services.statistics({ ...origin.base, taskId, columns: names, ...structuredClone(origin.intent.conditions), ...(includeDistinct ? { distinct: true } : {}) });
      if (!current() || operation.current !== active || generation !== revision.current || active.cancelled) return;
      checkTableStatisticsOutput(intent, names, output, includeDistinct); setReceipt({ output, distinct: includeDistinct });
    }).catch(reason => { if (alive.current && !closingRef.current && operation.current === active && generation === revision.current) setError(errorMessage(reason)); }).finally(() => {
      if (operation.current === active) operation.current = null; activity.current(-1); if (alive.current) setBusy(false);
    });
    active = { taskId, promise, cancelled: false }; operation.current = active; activity.current(1); setBusy(true); setReceipt(undefined); setError(''); setMessage('');
  }
  /** 修改选列立即撤销旧展示，但不自动读取；超过12项时原子拒绝本次变化。 */
  function select(name: string, checked: boolean): void {
    if (!editable() || selectedRef.current !== selected || distinctRef.current !== distinct || !origin.intent.source.columns.some(column => column.name === name)) return;
    const next = new Set(selected); if (checked) next.add(name); else next.delete(name);
    if (next.size > 12) { setError(text.tooMany); return; }
    revision.current++; selectedRef.current = next; setSelected(next); setReceipt(undefined); setError(''); setMessage('');
  }
  /** 开关与选列共用同步版本门；撤下旧回执但不查询，旧DOM不能代投递新选择。 */
  function selectDistinct(checked: boolean): void {
    if (!editable() || selectedRef.current !== selected || distinctRef.current !== distinct || checked === distinct) return;
    revision.current++; distinctRef.current = checked; setDistinct(checked); setReceipt(undefined); setError(''); setMessage('');
  }
  /** 关闭等待原统计和其取消请求结算；迟到回包不会发布成功或重放任务。 */
  function close(): void {
    if (committed.current !== ticket || !alive.current || closingRef.current) return; closingRef.current = true; revision.current++; setClosing(true); const active = operation.current; cancel(active);
    void (async () => { if (active) { await active.promise; if (active.cancelPromise) await active.cancelPromise; } if (alive.current) { alive.current = false; closeCallback.current(); } })();
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = origin.intent.subscribe(() => { if (alive.current) { setInvalid(true); setReceipt(undefined); cancel(); } });
    /** 模态期间CtrlEnter/CtrlS不能触发后台执行或父表预览。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { alive.current = false; revision.current++; unsubscribe(); cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const disabled = busy || closing || invalid || !intent.current();
  const renderedOperation = operation.current;
  const result = receipt?.output;
  const conditions = origin.intent.conditions;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" aria-busy={busy || closing}>
    <p>{text.scope}</p><p className="warning-text">{text.drafts}</p><p>{origin.intent.source.database}.{origin.intent.source.name}</p>
    <section aria-label={text.conditions}><strong>{text.conditions}</strong><div className="table-statistics-conditions">{conditions.filters.length ? <ul>{conditions.filters.map((filter, index) => <li key={index}>{filter.enabled === false ? text.disabledPrefix : ''}{filterRuleSummary(filter)}</li>)}</ul> : <p>{text.noFilters}</p>}{conditions.filterGroup ? <p>{tableFilterGroupSummary(conditions.filterGroup)}</p> : <p>{conditions.filterMode === 'any' ? text.anyMode : text.allMode}</p>}</div></section>
    <fieldset disabled={disabled}><legend>{text.selection}</legend><UsageHelp><p>{text.countOnly}</p><p>{text.disabledFilters}</p><p>{text.distinctScope}</p><p>{text.distinctSemantics}</p><p>{text.bounded}</p></UsageHelp><p>{text.selected(selected.size)}</p><div className="table-statistics-columns">{origin.intent.source.columns.map(column => <label key={column.name}><input type="checkbox" aria-label={text.selectColumn(column.name)} checked={selected.has(column.name)} disabled={disabled} onChange={event => select(column.name, event.target.checked)}/><span>{column.name} · {column.type}</span></label>)}</div><label><input type="checkbox" aria-label={text.distinctOption} checked={distinct} disabled={disabled} onChange={event => selectDistinct(event.target.checked)}/>{text.distinctOption}</label></fieldset>
    <ErrorBox message={invalid || !intent.current() ? text.changed : error}/>{message && <p role="status">{message}</p>}{busy && <Spinner text={text.loading}/>}{closing && <p>{text.closing}</p>}
    {result && !disabled && <section aria-label={text.result} className="table-statistics-results"><dl><dt>{text.rowCount}</dt><dd aria-label={text.rowCount}>{result.rowCount}</dd></dl>{result.rowCount === '0' && <p>{text.empty}</p>}{result.warnings.map((warning, index) => <p className="warning-text" key={index}>{warning}</p>)}{result.columns.length > 0 && <table><caption>{text.result}</caption><thead><tr>{[text.column, text.type, text.nonNull, text.nulls, ...(receipt?.distinct ? [text.distinctColumn] : []), text.min, text.max, text.sum, text.average].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{result.columns.map(column => <tr key={column.name}><th scope="row">{column.name}</th><td>{column.type}{column.kind === 'numeric' && column.approximate && <p>{text.approximate}</p>}</td><td>{column.nonNull}</td><td>{column.nulls}</td>{receipt?.distinct && <td>{column.kind === 'count-only' ? text.distinctUnsupported : column.distinct}</td>}{column.kind === 'count-only' ? <td colSpan={4}>{text.unavailable}：{column.reason}</td> : <><td>{tableStatisticsCellPreview(column.min)}</td><td>{tableStatisticsCellPreview(column.max)}</td><td>{column.kind === 'numeric' ? tableStatisticsCellPreview(column.sum) : '—'}</td><td>{column.kind === 'numeric' ? tableStatisticsCellPreview(column.avg) : '—'}</td></>}</tr>)}</tbody></table>}</section>}
  </div><footer className="modal-footer">{busy && <button disabled={closing} onClick={() => { if (committed.current === ticket) cancel(renderedOperation); }}>{text.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={close}>{text.close}</button><button className="primary" disabled={disabled} onClick={start}>{result ? text.refresh : text.start}</button></footer></Modal>;
}
