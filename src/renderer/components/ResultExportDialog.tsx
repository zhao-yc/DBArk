import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, Square } from 'lucide-react';
import type { FileChoice, QueryResult, ResultExportOptions } from '../../shared/contracts';
import { resultExportColumns } from '../../shared/resultExport';
import { assertResultSqlData, type ResultSqlPreview, type ResultSqlTarget } from '../../shared/resultSql';
import { resultSqlZh as sqlText } from '../../shared/resultSql.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { invoke, errorMessage, uid } from '../lib';
import { resultExportData } from '../resultExport';
import { useWorkspace } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Field, Modal } from './ui';
import '../resultExport.css';

/** 仅处理打开时的已返回/勾选快照，SQL目标全部显式填写；不访问连接或重新执行查询。 */
export function ResultExportDialog({ result, tabId, selected = false, onClose }: { result: QueryResult; tabId: string; selected?: boolean; onClose(): void }) {
  const fixed = useRef(result), alive = useRef(true), invalid = useRef(false), revision = useRef(0);
  if (result !== fixed.current) invalid.current = true;
  const data = useMemo(() => resultExportData(fixed.current), []), columns = useMemo(() => resultExportColumns(data.columns), [data]);
  const sample = useMemo(() => data.rows.slice(0, 20), [data]);
  const [format, setFormat] = useState<ResultExportOptions['format']>('csv'), [encoding, setEncoding] = useState<ResultExportOptions['encoding']>('utf8');
  const [target, setTarget] = useState<ResultSqlTarget>(() => ({ database: '', table: '', columns: data.columns.map(column => ({ key: column.key, name: '' })) }));
  const [preview, setPreview] = useState<ResultSqlPreview | null>(null), previewRef = useRef<ResultSqlPreview | null>(null);
  const [confirmation, setConfirmation] = useState(''), [acknowledged, setAcknowledged] = useState(false);
  const [file, setFile] = useState<FileChoice | null>(null), fileRef = useRef<FileChoice | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), [preparing, setPreparing] = useState(false), prepareRef = useRef(false), [picking, setPicking] = useState(false), pickRef = useRef(false);
  const [done, setDone] = useState<number>(), consumed = useRef(false), [taskId, setTaskId] = useState(''), activeTask = useRef('');
  const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  const releases = useRef(new Set<string>()), pending = useRef(new Map<string, Promise<void>>());
  const renderedRevision = revision.current;
  const config = useRef({ format, encoding, target, confirmation, acknowledged }); config.current = { format, encoding, target, confirmation, acknowledged };
  /** 事件同时核实例存活、结果身份及同步代次，恢复相同配置不能复活旧回调。 */
  const current = (ticket: number) => alive.current && !invalid.current && ticket === revision.current;
  const validPreview = () => !!previewRef.current && Date.parse(previewRef.current.expiresAt) > Date.now();
  /** 释放失败保留责任，下次准备重试；不因旧释放迟到撤销新预览。 */
  async function release(id: string): Promise<void> {
    releases.current.add(id); let action = pending.current.get(id);
    if (!action) { action = invoke('files.releaseResultSql', { previewId: id }).then(() => { releases.current.delete(id); }); pending.current.set(id, action); }
    try { await action; } finally { if (pending.current.get(id) === action) pending.current.delete(id); }
  }
  /** 新准备和关闭均先结算尚未完成的旧能力释放。 */
  async function drain() { for (const id of [...releases.current]) await release(id); }
  /** 卸载后的旧异步失败不更新新窗口或已移除组件。 */
  function report(reason: unknown) { if (alive.current) setError(errorMessage(reason)); }
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (previewRef.current) void release(previewRef.current.previewId).catch(() => {}); if (busyRef.current && activeTask.current) void invoke('query.cancel', { taskId: activeTask.current }).catch(() => {}); }; }, []);
  /** 配置变化同步撤销预览与文件；旧闭包不能通过A→B→A重新认领授权。 */
  function change(ticket: number, action: () => void) {
    if (!current(ticket) || busyRef.current) return;
    revision.current++; const old = previewRef.current; previewRef.current = null; fileRef.current = null; consumed.current = false;
    setPreview(null); setFile(null); setConfirmation(''); setAcknowledged(false); setDone(undefined); setTaskId(''); setError(''); action();
    if (old) void release(old.previewId).catch(report);
  }
  /** 预览到期同步撤销文件选择；已经进入写入的任务继续按原提交/取消模型结算。 */
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => { if (previewRef.current?.previewId === preview.previewId && !busyRef.current && alive.current) { change(revision.current, () => {}); setError(sqlText.stale); } }, Math.max(1, Date.parse(preview.expiresAt) - Date.now() + 1));
    return () => window.clearTimeout(timer);
  }, [preview]);
  /** Main计算完整快照摘要，展示同一生成器的有界真实SQL；迟到预览只释放自己。 */
  async function prepare(ticket: number) {
    if (!current(ticket) || busyRef.current || prepareRef.current || config.current.format !== 'sql') return;
    ticket = ++revision.current;
    const chosen = config.current; prepareRef.current = true; setPreparing(true); setError('');
    try {
      const old = previewRef.current; previewRef.current = null; fileRef.current = null; setPreview(null); setFile(null); setConfirmation(''); setAcknowledged(false); consumed.current = false; setDone(undefined);
      if (old) releases.current.add(old.previewId); await drain(); if (!current(ticket)) return;
      assertResultSqlData(data, chosen.target);
      const value = await invoke('files.previewResultSql', { result: data, target: chosen.target, encoding: chosen.encoding });
      if (!current(ticket)) { void release(value.previewId).catch(() => {}); return; }
      previewRef.current = value; setPreview(value);
    } catch (reason) { if (current(ticket)) report(reason); } finally { prepareRef.current = false; if (alive.current) setPreparing(false); }
  }
  /** 原生保存选择与准确预览绑定，映射变更期间返回的旧选择不能发布。 */
  async function chooseFile(ticket: number) {
    if (!current(ticket) || busyRef.current || pickRef.current || config.current.format === 'sql' && !validPreview()) return;
    ticket = ++revision.current;
    const chosen = config.current, lease = previewRef.current; pickRef.current = true; setPicking(true);
    if (chosen.format === 'sql') { fileRef.current = null; setFile(null); }
    try {
      const value = await invoke('files.choose', { purpose: 'export', format: chosen.format, suggestedName: `${zh.resultExport.defaultName}.${chosen.format}`, ...(chosen.format === 'sql' ? { resultSqlPreviewId: lease!.previewId } : {}) });
      if (!current(ticket)) return;
      if (value) { fileRef.current = value; setFile(value); consumed.current = false; setError(''); setDone(undefined); setTaskId(''); }
    } catch (reason) { if (current(ticket)) report(reason); } finally { pickRef.current = false; if (alive.current) setPicking(false); }
  }
  /** 第一次await前消费本地入口；Main再次消费预览与文件能力，再沿原文件任务原子提交。 */
  async function execute(ticket: number) {
    if (!current(ticket) || !fileRef.current || busyRef.current || pickRef.current || prepareRef.current || consumed.current) return;
    const chosen = config.current, lease = previewRef.current;
    if (chosen.format === 'sql' && (!validPreview() || chosen.confirmation !== `${chosen.target.database}.${chosen.target.table}` || !chosen.acknowledged)) return;
    busyRef.current = true; consumed.current = true; setBusy(true); setError(''); const id = uid(); activeTask.current = id; setTaskId(id); useWorkspace.getState().setBusy(tabId, true);
    try {
      const output = await invoke('files.exportResult', { fileToken: fileRef.current.token, format: chosen.format, encoding: chosen.encoding, taskId: id, result: data, ...(chosen.format === 'sql' ? { sql: { target: chosen.target, previewId: lease!.previewId, confirmation: chosen.confirmation, acknowledged: true as const } } : {}) });
      if (current(ticket)) setDone(output.rows);
    } catch (reason) {
      if (chosen.format === 'sql') { previewRef.current = null; fileRef.current = null; if (alive.current) { setPreview(null); setFile(null); } void release(lease!.previewId).catch(() => {}); }
      else consumed.current = false;
      if (current(ticket)) report(reason);
    } finally { busyRef.current = false; if (alive.current) setBusy(false); useWorkspace.getState().setBusy(tabId, false); }
  }
  /** 写入与原子替换等待期间不关闭；其余关闭先完成精确能力释放。 */
  async function close() { if (busyRef.current) return; revision.current++; if (previewRef.current) releases.current.add(previewRef.current.previewId); previewRef.current = null; fileRef.current = null; setPreview(null); setFile(null); try { await drain(); if (alive.current) onClose(); } catch (reason) { report(reason); } }
  const sqlReady = format !== 'sql' || !!preview && validPreview() && confirmation === `${target.database}.${target.table}` && acknowledged;
  return <Modal title={selected ? zh.resultExport.selectedTitle : zh.resultExport.title} wide onClose={() => void close()}><div className="modal-content">
    <div className="info-strip">{formatText(selected ? zh.resultExport.selectedRows : zh.resultExport.returnedRows, data.rows.length)}<br/>{selected ? zh.resultExport.selectedOnly : zh.resultExport.returnedOnly}</div>
    {data.truncated && <p className="warning-text">{zh.resultExport.truncated}</p>}
    <div className="form-grid">
      <Field label={zh.resultExport.format}><select aria-label={zh.resultExport.format} value={format} disabled={busy} onChange={event => { const value = event.target.value; if (value !== format && ['csv','json','sql'].includes(value)) change(renderedRevision, () => setFormat(value as typeof format)); }}><option value="csv">CSV</option><option value="json">JSON</option><option value="sql">INSERT SQL</option></select></Field>
      <Field label={zh.resultExport.encoding}><select aria-label={zh.resultExport.encoding} value={encoding} disabled={busy} onChange={event => { const value = event.target.value; if (value !== encoding && ['utf8','utf16le','gb18030'].includes(value)) change(renderedRevision, () => setEncoding(value as typeof encoding)); }}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option></select></Field>
      {format === 'sql' && <><Field label={sqlText.database}><input aria-label={sqlText.database} value={target.database} disabled={busy} onChange={event => change(renderedRevision, () => setTarget({ ...target, database: event.target.value }))}/></Field><Field label={sqlText.table}><input aria-label={sqlText.table} value={target.table} disabled={busy} onChange={event => change(renderedRevision, () => setTarget({ ...target, table: event.target.value }))}/></Field></>}
    </div>
    <button className="file-picker" disabled={busy || picking || invalid.current || format === 'sql' && !preview} onClick={() => void chooseFile(renderedRevision)}><Download size={24}/><span><strong>{file?.name ?? zh.resultExport.chooseFile}</strong><small>{zh.resultExport.atomicFile}</small></span><ArrowRight size={16}/></button>
    <h3>{zh.resultExport.columnMapping}</h3><p className="muted small">{format === 'sql' ? sqlText.mapping : zh.resultExport.columnRule}</p>
    <div className="result-export-columns"><table><thead><tr><th>{zh.resultExport.columnPosition}</th><th>{zh.resultExport.originalColumn}</th><th>{format === 'sql' ? sqlText.targetColumn : zh.resultExport.outputColumn}</th></tr></thead><tbody>{columns.map((column, index) => <tr key={column.key}><td>{index + 1}</td><td>{column.name || zh.resultExport.emptyName}</td><td>{format === 'sql' ? <input aria-label={sqlText.column(index + 1)} value={target.columns[index].name} disabled={busy} onChange={event => change(renderedRevision, () => setTarget({ ...target, columns: target.columns.map((value, position) => position === index ? { ...value, name: event.target.value } : value) }))}/> : column.exportName}</td></tr>)}</tbody></table></div>
    <p className="muted small">{format === 'sql' ? sqlText.protocol : format === 'csv' ? zh.resultExport.csvProtocol : zh.resultExport.jsonProtocol}</p>
    {format === 'sql' && <><button disabled={busy || preparing || invalid.current} onClick={() => void prepare(renderedRevision)}>{sqlText.preview}</button>{preview && <><p>{sqlText.previewScope(preview.shownRows, preview.totalRows)}</p><pre className="result-sql-preview" aria-label={sqlText.preview}>{preview.sql}</pre><Field label={sqlText.confirmation}><input aria-label={sqlText.confirmation} disabled={busy} value={confirmation} onChange={event => { if (current(renderedRevision) && !busyRef.current) setConfirmation(event.target.value); }}/></Field><label><input type="checkbox" aria-label={sqlText.acknowledge} checked={acknowledged} disabled={busy} onChange={event => { if (current(renderedRevision) && !busyRef.current) setAcknowledged(event.target.checked); }}/>{sqlText.acknowledge}</label></>}</>}
    <h3>{zh.resultExport.preview}</h3><div className="sample-grid"><ResultsGrid columns={columns.map(column => ({ key: column.key, name: column.exportName, type: '' }))} rows={sample}/></div>
    {task && <div className="transfer-progress"><div><span>{task.message}</span><strong>{Math.round(task.progress)}%</strong></div><progress max="100" value={task.progress}/></div>}
    {done !== undefined && <div className="success-box"><CheckCircle2 size={16}/>{formatText(zh.resultExport.completed, done)}</div>}<ErrorBox message={invalid.current ? sqlText.changed : error}/>
  </div><footer className="modal-footer"><button disabled={busy} onClick={() => void close()}>{done === undefined ? zh.common.close : zh.common.done}</button><span className="grow"/>{busy ? <button onClick={() => void invoke('query.cancel', { taskId }).catch(report)}><Square size={13}/>{zh.resultExport.cancel}</button> : <button className="primary" disabled={!file || done !== undefined || !sqlReady || invalid.current || picking || preparing} onClick={() => void execute(renderedRevision)}>{zh.resultExport.start}<ArrowRight size={14}/></button>}</footer></Modal>;
}
