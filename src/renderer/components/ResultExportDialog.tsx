import { useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, Square } from 'lucide-react';
import type { FileChoice, QueryResult, ResultExportOptions } from '../../shared/contracts';
import { resultExportColumns } from '../../shared/resultExport';
import { zh, formatText } from '../locales/zh-CN';
import { invoke, errorMessage, uid } from '../lib';
import { resultExportData } from '../resultExport';
import { useWorkspace } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Field, Modal } from './ui';
import '../resultExport.css';

/** 对话框持有打开时的不可变结果引用；导出不访问数据库，支持已断线的旧快照。 */
export function ResultExportDialog({ result, tabId, onClose }: { result: QueryResult; tabId: string; onClose(): void }) {
  const data = useMemo(() => resultExportData(result), [result]);
  const columns = useMemo(() => resultExportColumns(data.columns), [data]);
  const sample = useMemo(() => data.rows.slice(0, 20), [data]);
  const [format, setFormat] = useState<ResultExportOptions['format']>('csv');
  const [encoding, setEncoding] = useState<ResultExportOptions['encoding']>('utf8');
  const [file, setFile] = useState<FileChoice | null>(null); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [done, setDone] = useState<number>();
  const [taskId, setTaskId] = useState(''); const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));

  /** 目标只能由保存对话框授予，不接收用户输入的任意文件路径。 */
  async function chooseFile() {
    if (busyRef.current) return;
    try {
      const selected = await invoke('files.choose', { purpose: 'export', format, suggestedName: `${zh.resultExport.defaultName}.${format}` });
      if (selected) { setFile(selected); setError(''); setDone(undefined); setTaskId(''); }
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 同步入口锁保证快速双击也只有一个写任务；失败后仅允许用户明确发起新的任务。 */
  async function execute() {
    if (!file || busyRef.current || done !== undefined) return;
    busyRef.current = true; setBusy(true); setError(''); const id = uid(); setTaskId(id); useWorkspace.getState().setBusy(tabId, true);
    try { const output = await invoke('files.exportResult', { fileToken: file.token, format, encoding, taskId: id, result: data }); setDone(output.rows); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setBusy(false); useWorkspace.getState().setBusy(tabId, false); }
  }
  /** 写入或原子替换结束前保留对话框与任务进度，关闭不能绕过资源释放。 */
  function close() { if (!busyRef.current) onClose(); }

  return <Modal title={zh.resultExport.title} wide onClose={close}>
    <div className="modal-content">
      <div className="info-strip">{formatText(zh.resultExport.returnedRows, data.rows.length)}<br/>{zh.resultExport.returnedOnly}</div>
      {data.truncated && <p className="warning-text">{zh.resultExport.truncated}</p>}
      <div className="form-grid">
        <Field label={zh.resultExport.format}><select aria-label={zh.resultExport.format} value={format} disabled={busy} onChange={event => { setFormat(event.target.value as typeof format); setFile(null); setDone(undefined); setTaskId(''); setError(''); }}><option value="csv">CSV</option><option value="json">JSON</option></select></Field>
        <Field label={zh.resultExport.encoding}><select aria-label={zh.resultExport.encoding} value={encoding} disabled={busy} onChange={event => { setEncoding(event.target.value as typeof encoding); setDone(undefined); setTaskId(''); setError(''); }}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option></select></Field>
      </div>
      <button className="file-picker" disabled={busy} onClick={() => void chooseFile()}><Download size={24}/><span><strong>{file?.name ?? zh.resultExport.chooseFile}</strong><small>{zh.resultExport.atomicFile}</small></span><ArrowRight size={16}/></button>
      <h3>{zh.resultExport.columnMapping}</h3><p className="muted small">{zh.resultExport.columnRule}</p>
      <div className="result-export-columns"><table><thead><tr><th>{zh.resultExport.columnPosition}</th><th>{zh.resultExport.originalColumn}</th><th>{zh.resultExport.outputColumn}</th></tr></thead><tbody>{columns.map((column, index) => <tr key={column.key}><td>{index + 1}</td><td>{column.name || zh.resultExport.emptyName}</td><td>{column.exportName}</td></tr>)}</tbody></table></div>
      <p className="muted small">{format === 'csv' ? zh.resultExport.csvProtocol : zh.resultExport.jsonProtocol}</p>
      <h3>{zh.resultExport.preview}</h3><div className="sample-grid"><ResultsGrid columns={columns.map(column => ({ key: column.key, name: column.exportName, type: '' }))} rows={sample}/></div>
      {task && <div className="transfer-progress"><div><span>{task.message}</span><strong>{Math.round(task.progress)}%</strong></div><progress max="100" value={task.progress}/></div>}
      {done !== undefined && <div className="success-box"><CheckCircle2 size={16}/>{formatText(zh.resultExport.completed, done)}</div>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button disabled={busy} onClick={close}>{done === undefined ? zh.common.close : zh.common.done}</button><span className="grow"/>{busy ? <button onClick={() => void invoke('query.cancel', { taskId }).catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.resultExport.cancel}</button> : <button className="primary" disabled={!file || done !== undefined} onClick={() => void execute()}>{zh.resultExport.start}<ArrowRight size={14}/></button>}</footer>
  </Modal>;
}
