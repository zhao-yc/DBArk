import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DataRow, ResultColumn } from '../../shared/contracts';
import { captureQueryResultStatistics, currentQueryResultStatistics, QueryResultStatisticsScan, type QueryResultStatisticsCapture, type QueryResultStatisticsResult } from '../queryResultStatistics';
import { queryResultStatisticsZh as text } from '../locales/queryResultStatistics.zh-CN';
import { errorMessage } from '../lib';
import { ErrorBox, Modal } from './ui';

interface Props {
  columns: ResultColumn[]; rows: DataRow[]; initialColumn: ResultColumn;
  selectedIndices: ReadonlySet<number>; truncated: boolean; owner: string;
  isCurrent(): boolean; onClose(): void;
}
type Request = { column: string; scope: 'all' | 'selected' };
type Operation = { request: Request; capture: QueryResultStatisticsCapture; scan: QueryResultStatisticsScan; timer?: ReturnType<typeof setTimeout> };
type View = { request: Request; processed: number; total: number; result?: QueryResultStatisticsResult; error?: string };

/** 仅统计当前已返回快照；分批让出界面线程，切列、取消和来源变化永久撤销旧计算。 */
export function QueryResultStatisticsDialog({ columns, rows, initialColumn, selectedIndices, truncated, owner, isCurrent, onClose }: Props) {
  const origin = useRef({ columns, rows, initialColumn, owner }).current;
  const latest = useRef({ columns, rows, initialColumn, owner, isCurrent }); latest.current = { columns, rows, initialColumn, owner, isCurrent };
  const [prepared] = useState(() => {
    try {
      const indices: ReadonlySet<number> = new Set<number>(Set.prototype.values.call(selectedIndices));
      const capture = captureQueryResultStatistics(columns, rows, initialColumn, indices.size ? indices : undefined);
      // 捕获已经核过全部元数据；仍只读自有数据描述符，不执行列字段访问器。
      const options = columns.map(column => ({ key: Object.getOwnPropertyDescriptor(column, 'key')!.value as string, name: Object.getOwnPropertyDescriptor(column, 'name')!.value as string }));
      return { indices, capture, options, error: '' };
    } catch (reason) { return { indices: new Set<number>() as ReadonlySet<number>, capture: undefined, options: [] as { key: string; name: string }[], error: errorMessage(reason) }; }
  });
  const [request, setRequest] = useState<Request>(() => ({ column: prepared.capture?.column.key ?? '', scope: prepared.indices.size ? 'selected' : 'all' }));
  const requestRef = useRef(request), firstRequest = useRef(request).current;
  const [view, setView] = useState<View>({ request, processed: 0, total: prepared.capture?.rowCount ?? 0, error: prepared.error });
  const operation = useRef<Operation | undefined>(undefined), alive = useRef(true), invalid = useRef(false), closed = useRef(false);
  const lastCapture = useRef(prepared.capture);
  const committed = useRef<object | undefined>(undefined), ticket = {};

  /** 每批只核父层轻量身份门与原数组身份，完整逐行漂移检查留在发布前执行一次。 */
  function environment(): boolean {
    if (!alive.current || invalid.current || closed.current) return false;
    const current = latest.current;
    let valid = false;
    try { valid = current.columns === origin.columns && current.rows === origin.rows && current.initialColumn === origin.initialColumn && current.owner === origin.owner && current.isCurrent() === true; } catch {}
    if (!valid) invalid.current = true;
    return valid;
  }
  /** 同步清理定时器和扫描器；已经排队的旧回调还必须通过准确operation引用门。 */
  function stop(): void {
    const active = operation.current; operation.current = undefined;
    if (active) { if (active.timer !== undefined) clearTimeout(active.timer); active.scan.cancel(); }
  }
  useLayoutEffect(() => { alive.current = true; committed.current = ticket; if (!environment()) stop(); return () => { if (committed.current === ticket) committed.current = undefined; }; });
  useLayoutEffect(() => () => { alive.current = false; stop(); }, []);

  useEffect(() => {
    stop();
    if (!prepared.capture || !environment()) return;
    let active: Operation;
    try {
      const column = origin.columns.find(value => Object.getOwnPropertyDescriptor(value, 'key')?.value === request.column);
      if (!column) throw Error(text.stale);
      const capture = request === firstRequest ? prepared.capture : captureQueryResultStatistics(origin.columns, origin.rows, column, request.scope === 'selected' ? prepared.indices : undefined);
      lastCapture.current = capture;
      active = { request, capture, scan: new QueryResultStatisticsScan(capture) }; operation.current = active;
      setView({ request, processed: 0, total: capture.rowCount });
    } catch (reason) { setView({ request, processed: 0, total: 0, error: errorMessage(reason) }); return; }

    /** 不复用旧完成值；最终核完整来源之后，只向当前请求发布一次统计结果。 */
    function tick(): void {
      if (operation.current !== active || requestRef.current !== request || !alive.current) return;
      active.timer = undefined;
      if (!environment()) { stop(); setView({ request, processed: 0, total: active.capture.rowCount, error: text.stale }); return; }
      try {
        const progress = active.scan.step();
        if (operation.current !== active || !environment()) { stop(); setView({ request, ...progress, error: text.stale }); return; }
        if (progress.done) {
          // result内部完整核源；不在每批对全部行重复扫描。
          const result = active.scan.result(); if (!result) { invalid.current = true; throw Error(text.stale); }
          if (operation.current !== active || !environment()) throw Error(text.stale);
          operation.current = undefined; setView({ request, ...progress, result });
        } else { setView({ request, ...progress }); active.timer = setTimeout(tick, 0); }
      } catch (reason) { invalid.current = true; stop(); if (alive.current && requestRef.current === request) setView({ request, processed: 0, total: active.capture.rowCount, error: errorMessage(reason) }); }
    }
    active.timer = setTimeout(tick, 0);
    return () => { if (operation.current === active) stop(); else active.scan.cancel(); };
  }, [request]);

  /** 选择只使用首次勾选快照；同步换请求引用，旧列或范围回调不能覆盖后继扫描。 */
  function change(next: Request): void {
    if (committed.current !== ticket || requestRef.current !== request || !environment() || next.scope === 'selected' && !prepared.indices.size || !prepared.options.some(column => column.key === next.column)) return;
    if (next.column === request.column && next.scope === request.scope) return;
    // 显式切换时允许一次完整复核，不能用新捕获追认上一轮已经漂移的原值。
    if (lastCapture.current && !currentQueryResultStatistics(lastCapture.current, origin.columns, origin.rows)) {
      invalid.current = true; stop(); setView({ request, processed: 0, total: 0, error: text.stale }); return;
    }
    stop(); requestRef.current = next; setRequest(next);
  }
  /** 扫描中也可立即关闭；父层未立即卸载时同样清空旧指标，并拒绝再次关闭或重启。 */
  function close(): void {
    if (!alive.current || closed.current) return;
    closed.current = true; stop(); setView({ request: requestRef.current, processed: 0, total: 0 }); onClose();
  }
  // 完成后若外部再次渲染，仍拒绝同数组引用上的原地漂移，不重启或追认新值。
  if (view.result && lastCapture.current && !currentQueryResultStatistics(lastCapture.current, columns, rows)) invalid.current = true;
  const valid = environment(), current = view.request === request && requestRef.current === request;
  const result = valid && current ? view.result : undefined;
  const labels = ['count', 'nonNull', 'nulls', 'distinct', 'min', 'max', 'sum', 'average'] as const;
  return <div data-query-result-statistics-owner={owner}><Modal title={text.title} onClose={close} wide><div className="modal-content">
    <p>{text.notice}</p><p className="muted small">{text.hint}</p>{truncated && <p role="note">{text.truncated}</p>}
    <div className="filter-inputs"><label>{text.column}<select aria-label={text.column} value={request.column} disabled={!valid || !prepared.capture} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) change({ ...request, column: event.target.value }); }}>{prepared.options.map(column => <option key={column.key} value={column.key}>{column.name || column.key} · {column.key}</option>)}</select></label>
      <label>{text.scope}<select aria-label={text.scope} value={request.scope} disabled={!valid || !prepared.capture} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented && (event.target.value === 'all' || event.target.value === 'selected')) change({ ...request, scope: event.target.value }); }}><option value="all">{text.all}</option><option value="selected" disabled={!prepared.indices.size}>{text.selected}</option></select></label></div>
    {!valid && !closed.current && <ErrorBox message={text.stale}/>}<ErrorBox message={current ? view.error : undefined}/>
    {valid && current && !view.result && !view.error && <p role="status">{text.scanning} {text.progress(view.processed, view.total)}</p>}
    {result && <><dl aria-label={text.title}>{labels.map(label => <div key={label}><dt>{text[label]}</dt><dd aria-label={text[label]} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result[label] ?? text.unavailable}</dd></div>)}</dl>{result.approximate && <p>{text.approximate}</p>}{result.floatInput && <p>{text.floatInput}</p>}{result.averageRounded && <p>{text.averageRounded}</p>}{result.reason && <p>{text.reason}：{result.reason}</p>}</>}
  </div><footer className="modal-footer"><span className="grow"/><button onClick={close}>{result ? text.close : text.cancel}</button></footer></Modal></div>;
}
