import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteStatisticsInput, SqliteStatisticsValue } from '../../shared/sqliteStatistics';
import { SqliteStatisticsController, type SqliteStatisticsView } from '../sqliteStatistics';
import { sqliteStatisticsZh as text } from '../locales/sqliteStatistics.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { ErrorBox, Modal, Spinner, UsageHelp } from './ui';
import '../sqliteStatistics.css';

interface Props { tabId: string; base: Omit<SqliteStatisticsInput, 'column' | 'taskId'>; columns: readonly string[]; current(): boolean; onClose(): void; onCleanup(reason: unknown): void; }
/** 极值只展示准确typed值，文本保留JSON转义，二进制显示完整hex，不按声明类型隐式转换。 */
function preview(value: SqliteStatisticsValue): string { return value.kind === 'null' ? 'NULL' : value.kind === 'text' ? JSON.stringify(value.value) : value.kind === 'blob' ? 'X\'' + value.value + '\'' : value.value; }
/** 打开和选择字段不读取，明确开始才统计；关闭在途操作等原任务与ACK，原占用不提前释放。 */
export function SqliteStatisticsDialog(props: Props) {
  const origin = useRef(props).current, latest = useRef(props); latest.current = props;
  const [view, setView] = useState<SqliteStatisticsView>({ busy: false, stopping: false, error: '' }), [column, setColumn] = useState(origin.columns[0] ?? ''), [closing, setClosing] = useState(false), [problem, setProblem] = useState('');
  const mounted = useRef(true), closingRef = useRef(false), closed = useRef(false), render = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = render; return () => { if (committed.current === render) committed.current = undefined; }; });
  const [controller] = useState(() => new SqliteStatisticsController({ base: origin.base, current: () => latest.current.base === origin.base && latest.current.columns === origin.columns && latest.current.tabId === origin.tabId && origin.current(), acquire: () => acquireWorkspaceBusy(origin.tabId), read: input => invoke('sqlite.statistics', input), cancel: taskId => invoke('query.cancel', { taskId }), id: uid, changed: setView, cleanup: reason => origin.onCleanup(reason) }));
  useEffect(() => { controller.observe(); });
  useEffect(() => { mounted.current = true; controller.activate(); return () => { mounted.current = false; controller.dispose(); }; }, [controller]);
  function current(): boolean { return committed.current === render && !closed.current && !closingRef.current && !controller.view.busy && controller.current(); }
  /** 关闭占门后不接纳继任读取；取消失败仍等待原Promise的真实终态。 */
  async function close(): Promise<void> {
    if (committed.current !== render || closed.current || closingRef.current) return; closingRef.current = true; setClosing(true);
    try { await controller.stop(); if (mounted.current && !closed.current) { closed.current = true; origin.onClose(); } } catch (reason) { if (mounted.current) { closingRef.current = false; setProblem(errorMessage(reason)); setClosing(false); } }
  }
  const output = view.output;
  return <Modal title={text.title} onClose={() => { void close(); }} wide><div className="modal-content sqlite-statistics-content">
    <p>{text.hint}</p><UsageHelp><p className="muted small">{text.types}</p></UsageHelp><p className="muted small">{origin.base.database} / {origin.base.table}</p>
    <div className="sqlite-statistics-controls"><label>{text.column}<select aria-label={text.column} value={column} disabled={view.busy || closing} onChange={event => { if (!current() || !origin.columns.includes(event.target.value)) return; controller.clear(); setColumn(event.target.value); setProblem(''); }}>{origin.columns.map(name => <option key={name}>{name}</option>)}</select></label>
    <button disabled={view.busy || closing || !controller.current()} onClick={() => { if (current()) void controller.read(column); }}>{text.read}</button>{view.busy && <><button disabled={view.stopping || closing} onClick={() => { if (committed.current === render) void controller.stop(); }}>{text.stop}</button><Spinner text={view.stopping ? text.stopping : text.loading}/></>}</div>
    <ErrorBox message={problem || view.error || (!controller.current() ? text.stale : '')}/>
    {output && <div className="sqlite-statistics-result" aria-label={text.entry}><p className="muted small">{text.declared}：{output.declaredType || text.dynamic}</p><p className="sqlite-statistics-summary" role="status">{text.rows}：{output.rows} · {text.nonNull}：{output.nonNull} · {text.nulls}：{output.nulls}</p>{!output.groups.length ? <p>{text.empty}</p> : <div className="sqlite-statistics-scroll"><table><thead><tr>{[text.kind, text.count, text.distinct, text.min, text.max].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{output.groups.map(group => <tr key={group.kind}><th scope="row">{group.kind.toUpperCase()}</th><td>{group.count}</td><td>{group.distinct}</td><td className="sqlite-statistics-bound">{preview(group.min)}</td><td className="sqlite-statistics-bound">{preview(group.max)}</td></tr>)}</tbody></table></div>}</div>}
  </div><footer className="modal-footer"><button disabled={closing} onClick={() => { void close(); }}>{text.close}</button></footer></Modal>;
}
