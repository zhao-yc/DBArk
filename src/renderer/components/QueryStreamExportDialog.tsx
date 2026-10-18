import { useEffect, useRef, useState } from 'react';
import { Download, Square } from 'lucide-react';
import type { FileChoice } from '../../shared/contracts';
import type { QueryParameter, QueryParameterNames } from '../../shared/queryParameters';
import { queryExportFileFormat, queryCsvResultFile, type QueryExportProgress, type QueryStreamExportInput, type QueryStreamExportOutput } from '../../shared/queryStreamExport';
import { errorMessage, invoke, uid } from '../lib';
import { zh, formatText } from '../locales/zh-CN';
import { queryStreamZh as text } from '../locales/queryStreamExport.zh-CN';
import { streamExecutionAllowed, streamResultSelection } from '../queryStreamExport';
import { ErrorBox, Field, Modal } from './ui';
import { QueryParametersDialog } from './QueryParametersDialog';
import '../queryStreamExport.css';
import { queryInsertTargetSchema, type QueryInsertPending } from '../../shared/queryInsertExport';
import { queryInsertZh as insertText } from '../../shared/queryInsertExport.zh-CN';

export type StreamExportOptions = Omit<QueryStreamExportInput, 'sql' | 'sessionId'>;

/** 只持有打开时捕获的 SQL；选文件、识别参数都不会执行用户 SQL。 */
export function QueryStreamExportDialog({ source, loadNames, onExecute, onCancel, onClose, sessionBusy }: { source: string; sessionBusy: boolean; loadNames(): Promise<QueryParameterNames>; onExecute(options: StreamExportOptions): Promise<QueryStreamExportOutput>; onCancel(taskId: string): Promise<void>; onClose(): void }) {
  const live=useRef(true),configuration=useRef(0),completedRef=useRef(false);const generation=configuration.current;
  const [format, setFormat] = useState<QueryStreamExportInput['format']>('json'); const [encoding, setEncoding] = useState<QueryStreamExportInput['encoding']>('utf8');
  const [protocol, setProtocol] = useState<QueryStreamExportInput['protocol']>('text-strict'); const [ordinal, setOrdinal] = useState('1');
  const [file, setFile] = useState<FileChoice | null>(null); const [acknowledged, setAcknowledged] = useState(false); const [binaryAcknowledged, setBinaryAcknowledged] = useState(false);
  const [parameters, setParameters] = useState<QueryParameter[] | undefined>(); const [parameterDialog, setParameterDialog] = useState(false);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [choosing, setChoosing] = useState(false); const choosingRef = useRef(false);
  const [error, setError] = useState(''); const [failed, setFailed] = useState(false); const [completed, setCompleted] = useState(false);
  const [output, setOutput] = useState<QueryStreamExportOutput | null>(null);
  const [progress, setProgress] = useState<QueryExportProgress | null>(null); const [cancelling, setCancelling] = useState(false); const task = useRef('');
  const [database,setDatabase]=useState(''),[table,setTable]=useState(''),[columns,setColumns]=useState('');
  const [pending,setPending]=useState<QueryInsertPending|null>(null),[confirmation,setConfirmation]=useState(''),[publishAck,setPublishAck]=useState(false),[publishing,setPublishing]=useState(false);
  const publishingRef=useRef(false);
  useEffect(() => window.dbark?.onTask(event => { if (event.taskId !== task.current)return;if(event.queryExport)setProgress(event.queryExport);if(event.queryInsert){setPending(event.queryInsert);setConfirmation('');setPublishAck(false);} }), []);
  useEffect(()=>{live.current=true;return()=>{live.current=false;if(busyRef.current)void onCancel(task.current).catch(()=>undefined);};},[]);
  useEffect(() => {
    /** 只读 SQL 与表单的执行、保存快捷键不能穿透到后台编辑器。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);
  /** 原子目标授权必须先于执行；选择文件期间也不允许关闭或启动第二个选择器。 */
  async function chooseFile() {
    if (!live.current || generation!==configuration.current || busyRef.current || choosingRef.current || completedRef.current) return;
    choosingRef.current = true; setChoosing(true);
    try { const extension = queryExportFileFormat(format); const next = await invoke('files.choose', { purpose: 'export', format: extension, suggestedName: `${text.defaultName}.${extension}`,...(format==='sql'?{queryInsertExport:true as const}:{}) }); if (next && live.current && generation===configuration.current) { setFile(next); setError(''); invalidate(); } }
    catch (reason) { setError(errorMessage(reason)); }
    finally { choosingRef.current = false; setChoosing(false); }
  }
  /** 同步锁覆盖最后确认到 IPC finally；失败不把数据库执行当文件写入重试。 */
  async function execute() {
    if (!live.current || generation!==configuration.current || !streamExecutionAllowed(file?.token, acknowledged, protocol, binaryAcknowledged, busyRef.current || choosingRef.current || sessionBusy, completed)) return;
    let resultSelection: QueryStreamExportInput['resultSelection'];
    let insertTarget:QueryStreamExportInput['insertTarget'];
    try { resultSelection = streamResultSelection(format, ordinal);if(format==='sql')insertTarget=queryInsertTargetSchema.parse({database,table,columns:columns.split('\n')}); } catch (reason) { setError(errorMessage(reason)); return; }
    busyRef.current = true; setBusy(true); setError(''); setProgress(null); setCancelling(false);publishingRef.current=false;setPublishing(false); task.current = uid();
    try {
      const result = await onExecute({ taskId: task.current, fileToken: file!.token, format, encoding, protocol, resultSelection, parameters,...(insertTarget?{insertTarget}:{}) });
      setOutput(result);
      completedRef.current=true;setCompleted(true);
    } catch (reason) { setError(errorMessage(reason)); setFailed(true); setAcknowledged(false); setBinaryAcknowledged(false); }
    finally { busyRef.current = false; setBusy(false);setPending(null);if(format==='sql')setFile(null); }
  }
  /** 单独的同步发布锁；仅确认原暂存任务，不再次调用执行入口。 */
  async function publish(){
    if(!live.current||generation!==configuration.current||!busyRef.current||!pending||publishingRef.current||!publishAck||confirmation!==`${pending.target.database}.${pending.target.table}`||cancelling)return;
    publishingRef.current=true;setPublishing(true);
    try{await invoke('query.confirmInsertExport',{taskId:task.current,previewToken:pending.previewToken,confirmation,acknowledged:true});}
    catch(reason){setError(errorMessage(reason));publishingRef.current=false;setPublishing(false);}
  }
  /** 取消仅请求结束任务，真实资源释放前继续保留窗口和父标签互斥。 */
  async function cancel() { if (!busyRef.current || cancelling) return; setCancelling(true); try { await onCancel(task.current); } catch (reason) { setError(errorMessage(reason)); setCancelling(false); } }
  function close() { if (!busyRef.current && !choosingRef.current && !sessionBusy) onClose(); }
  /** 旧表单回调也必须核当前同步锁，禁用状态本身不能代替异步归属检查。 */
  function canConfigure(){return live.current&&!busyRef.current&&!choosingRef.current&&!completedRef.current;}
  /** 修改配置使旧启动闭包失效，恢复原值也不能复活旧确认。 */
  function invalidate() { configuration.current++;setAcknowledged(false); setBinaryAcknowledged(false);setPending(null);setConfirmation('');setPublishAck(false); }
  return <>{!parameterDialog && <Modal title={text.title} wide onClose={close}><div className="modal-content">
    <div className="info-strip">{text.warning}</div><h3>{text.source}</h3>{source.length > 65536 && <p className="muted small">{text.sourceLimit}</p>}<pre className="query-stream-source" aria-label={text.source}>{source.slice(0, 65536)}</pre>
    <div className="form-grid"><Field label={text.format}><select disabled={busy || choosing || completed} value={format} aria-label={text.format} onChange={event => { if(!canConfigure())return;setFormat(event.target.value as typeof format); setFile(null); invalidate(); }}><option value="json">{text.json}</option><option value="csv">{text.csv}</option><option value="csv-zip">{text.csvZip}</option><option value="sql">{insertText.format}</option></select></Field><Field label={text.encoding}><select disabled={busy || completed} value={encoding} onChange={event => { if(!canConfigure())return;setEncoding(event.target.value as typeof encoding); invalidate(); }}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option></select></Field></div>
    {format==='sql'&&<><p className="warning-text">{insertText.scope}</p><p>{insertText.mapping}</p><div className="form-grid"><Field label={insertText.database}><input disabled={busy||choosing||completed} value={database} aria-label={insertText.database} onChange={event=>{if(!canConfigure())return;setDatabase(event.target.value);invalidate();}}/></Field><Field label={insertText.table}><input disabled={busy||choosing||completed} value={table} aria-label={insertText.table} onChange={event=>{if(!canConfigure())return;setTable(event.target.value);invalidate();}}/></Field></div><Field label={insertText.columns}><textarea disabled={busy||choosing||completed} value={columns} aria-label={insertText.columns} onChange={event=>{if(!canConfigure())return;setColumns(event.target.value);invalidate();}}/></Field></>}
    {format === 'csv-zip' && <p className="muted small">{text.csvZipHint}</p>}
    {format === 'csv' && <><Field label={text.ordinal}><input disabled={busy || completed} value={ordinal} inputMode="numeric" onChange={event => { if(!canConfigure())return;setOrdinal(event.target.value); invalidate(); }}/></Field><p className="muted small">{text.ordinalHint}</p></>}
    <Field label={text.protocol}><select disabled={busy || completed} value={protocol} onChange={event => { if(!canConfigure())return;setProtocol(event.target.value as typeof protocol); invalidate(); }}><option value="text-strict">{text.text}</option><option value="binary-explicit">{text.binary}</option></select></Field><p className="warning-text">{protocol === 'text-strict' ? text.textHint : text.binaryHint}</p>
    <div className="parameter-actions"><button disabled={busy || choosing || completed || sessionBusy} onClick={() => {if(canConfigure())setParameterDialog(true);}}>{text.parameters}</button><span>{parameters ? formatText(text.parameterCount, parameters.length) : text.noParameters}</span>{parameters && <button disabled={busy || completed} onClick={() => { if(!canConfigure())return;setParameters(undefined); invalidate(); }}>{text.clearParameters}</button>}</div>
    <button className="file-picker" disabled={busy || choosing || completed} onClick={() => void chooseFile()}><Download size={20}/><span><strong>{file?.name ?? text.choose}</strong><small>{text.fileHint}</small></span></button>
    {pending&&<section aria-label={insertText.preview}><h3>{insertText.pending}</h3><p>{insertText.stats(pending.totalRows,pending.shownRows,pending.bytes,pending.encoding)}</p><pre className="query-stream-source">{pending.target.database}.{pending.target.table}{'\n'}{pending.target.columns.join('\n')}</pre><pre className="query-stream-source" aria-label={insertText.preview}>{pending.sql}</pre><Field label={insertText.confirmation}><input disabled={publishing||cancelling} value={confirmation} aria-label={insertText.confirmation} onChange={event=>setConfirmation(event.target.value)}/></Field><label className="query-stream-confirm"><input type="checkbox" aria-label={insertText.acknowledge} checked={publishAck} disabled={publishing||cancelling} onChange={event=>setPublishAck(event.target.checked)}/>{insertText.acknowledge}</label><button className="primary" disabled={publishing||cancelling||!publishAck||confirmation!==pending.target.database+'.'+pending.target.table} onClick={()=>void publish()}>{insertText.publish}</button></section>}
    {failed && <p className="warning-text">{text.retry}</p>}
    {!completed && <><label className="query-stream-confirm"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>{text.acknowledge}</label>{protocol === 'binary-explicit' && <label className="query-stream-confirm"><input type="checkbox" disabled={busy} checked={binaryAcknowledged} onChange={event => setBinaryAcknowledged(event.target.checked)}/>{text.binaryAcknowledge}</label>}</>}
    {progress && <div className="query-stream-progress" aria-label={text.progress}><strong>{text[progress.phase]}</strong><p>{formatText(text.stats, progress.statementsCompleted, progress.rowsWritten, progress.bytesWritten)}</p>{progress.sqlMayHaveExecuted && <p className="warning-text">{text.executed}</p>}{!progress.transactionKnown && <p className="warning-text">{text.unknown}</p>}</div>}
    {cancelling && busy && <p>{text.cancelling}</p>}{completed && <div className="success-box">{format==='sql'?insertText.completed:text.completed}</div>}{output && <section aria-label={text.summary}><h3>{text.summary}</h3><ul>{output.results.map(result => <li key={result.resultOrdinal}>{result.kind === 'rows' ? formatText(text.rowSummary, result.resultOrdinal, result.rowResultOrdinal ?? 0, result.rowsWritten) : formatText(text.statusSummary, result.resultOrdinal, result.affectedRows ?? 0, result.insertId ?? '0', result.warningCount ?? 0)}{format === 'csv-zip' && result.kind === 'rows' && <>；{queryCsvResultFile(result.rowResultOrdinal!)}</>}</li>)}</ul></section>}<ErrorBox message={error}/>
  </div><footer className="modal-footer"><button disabled={busy || choosing || sessionBusy} onClick={close}>{zh.common.close}</button><button disabled={!busy || cancelling} onClick={() => void cancel()}><Square size={13}/>{text.cancel}</button><span className="grow"/>{/* 确认与取消保持独立节点和位置，双击确认的第二击不能变成取消任务。 */}<button className="primary" disabled={!streamExecutionAllowed(file?.token, acknowledged, protocol, binaryAcknowledged, busy || choosing || sessionBusy, completed)} onClick={() => void execute()}>{failed ? text.again : format==='sql'?insertText.start:text.execute}</button></footer></Modal>}
  {parameterDialog && <QueryParametersDialog source={source} initialParameters={parameters} loadNames={loadNames} submitLabel={text.applyParameters} onExecute={values => { setParameters(values); invalidate(); setParameterDialog(false); }} onClose={() => setParameterDialog(false)}/>}</>;
}
