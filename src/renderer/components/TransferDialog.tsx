import { csvExportFieldsZh } from '../locales/csvExportFields.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FileUp, Download, Square, CheckCircle2 } from 'lucide-react';
import type { FileChoice } from '../../shared/contracts';
import { errorMessage, invoke, uid } from '../lib';
import { useWorkspace } from '../store';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { ImportPreviewController, importPreviewKey, readyImportPreview, type ImportPreviewContext, type ImportPreviewState } from '../importPreview';
import { ConnectedExcelTransferDialog } from './ConnectedExcelTransferDialog';
import { CsvExportFieldsController, type CsvExportFieldState, type CsvExportContext } from '../csvExportFields';
import { CsvExportFields } from './CsvExportFields';
import { excelTransferZh } from '../locales/excelTransfer.zh-CN';
import { csvImportDelimiters, type CsvImportDelimiter } from '../../shared/csvImport';

/** 文件仅通过一次性选择令牌使用，先预览字段映射再启动独立长任务。 */
export function TransferDialog({ mode, connectionId, database, table, onClose }: { mode: 'import' | 'export'; connectionId: string; database: string; table: string; onClose: () => void }) {
  const [useExcel, setUseExcel] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json' | 'sql'>('csv'); const [encoding, setEncoding] = useState<'utf8' | 'utf16le' | 'gb18030'>('utf8'); const [file, setFile] = useState<FileChoice | null>(null);
  const [csvDelimiter, setCsvDelimiter] = useState<CsvImportDelimiter>(',');
  const importCsvDelimiter = mode === 'import' && format === 'csv' ? csvDelimiter : undefined;
  const [previewState, setPreviewState] = useState<ImportPreviewState>(null);
  const [previewController] = useState(() => new ImportPreviewController({
    metadata: target => invoke('metadata.table', target),
    preview: ({ fileToken, format, encoding, csvDelimiter }) => invoke('files.preview', { fileToken, format, encoding, ...(csvDelimiter === undefined ? {} : { csvDelimiter }) })
  }, setPreviewState));
  const [includeStructure, setIncludeStructure] = useState(true); const [includeData, setIncludeData] = useState(true); const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState(''); const [failureDetails, setFailureDetails] = useState<string[]>([]); const [done, setDone] = useState<number>();
  const [taskId, setTaskId] = useState(''); const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  const connectionVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [csvState, setCsvState] = useState<CsvExportFieldState>(null), [, setCsvClock] = useState(0);
  const [csvController] = useState(() => new CsvExportFieldsController({
    read: async (target, taskId) => { await invoke('connections.open', { id: target.connectionId }); return invoke('files.exportColumns', { ...target, taskId }); },
    release: catalogId => invoke('files.releaseExportColumns', { catalogId }), taskId: uid, cleanupError: reason => useWorkspace.getState().notify(errorMessage(reason), true)
  }, setCsvState));
  const csvContext = useMemo<CsvExportContext | null>(() => !useExcel && mode === 'export' && format === 'csv' ? { connectionId, database, table, version: connectionVersion } : null, [useExcel, mode, format, connectionId, database, table, connectionVersion]);
  const csvReady = csvController.ready(csvContext);
  const formKey = JSON.stringify([mode, connectionId, database, table, connectionVersion, format, encoding, file?.token, importCsvDelimiter]), formKeyRef = useRef(formKey); formKeyRef.current = formKey;
  const choosing = useRef(0);
  useEffect(() => { void csvController.prepare(csvContext); return () => csvController.cancel(); }, [csvController, csvContext]);
  useEffect(() => {
    if (csvState?.status !== 'ready') return; const expires = Date.parse(csvState.catalog.expiresAt);
    const timer = window.setTimeout(() => setCsvClock(value => value + 1), Math.max(1, expires - Date.now() + 1)); return () => window.clearTimeout(timer);
  }, [csvState]);
  useEffect(() => { if (mode === 'export') { setFile(null); setDone(undefined); setTaskId(''); setError(''); } }, [mode, connectionId, database, table, connectionVersion]);
  const previewContext = useMemo<ImportPreviewContext | null>(() => !useExcel && mode === 'import' && format !== 'sql' && file ? { connectionId, database, table, fileToken: file.token, format, encoding, ...(importCsvDelimiter === undefined ? {} : { csvDelimiter: importCsvDelimiter }) } : null, [useExcel, mode, connectionId, database, table, file?.token, format, encoding, importCsvDelimiter]);
  const needsPreview = mode === 'import' && format !== 'sql';
  const ready = readyImportPreview(previewState, previewContext); const sample = ready?.sample; const info = ready?.info; const mapping = ready?.mapping ?? {};
  const currentPreview = previewContext && previewState?.key === importPreviewKey(previewContext) ? previewState : null;
  const previewing = !!previewContext && (!currentPreview || currentPreview.status === 'loading');
  const previewError = currentPreview?.status === 'failed' ? currentPreview.error : '';
  useEffect(() => {
    setError(''); void previewController.prepare(previewContext);
    return () => { previewController.cancel(); };
  }, [previewController, previewContext]);
  /** 格式变更后重新选择文件，避免输出扩展名与内容格式不一致。 */
  async function chooseFile() {
    if (busyRef.current) return;
    const generation = ++choosing.current, key = formKeyRef.current;
    try { const choice = await invoke('files.choose', { purpose: mode, format, suggestedName: `${table}.${format}` }); if (busyRef.current || generation !== choosing.current || key !== formKeyRef.current) return; if (choice) { setFile(choice); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); } }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 每次显式重试使用新任务编号，保留已提交行数与逐行失败明细。 */
  async function execute() {
    if (!file || busyRef.current || done !== undefined) return;
    // 就绪状态在入口重新检查，不能只依赖按钮禁用；快速切换参数也不能使用旧文件的映射。
    const current = previewController.ready(previewContext);
    if (needsPreview && !current) { setError(zh.transfer.previewNotReady); return; }
    if (mode === 'export' && format === 'csv' && !csvController.ready(csvContext)?.selected.length) { setError(csvExportFieldsZh.selectionRequired); return; }
    const executionKey = formKeyRef.current;
    busyRef.current = true; setBusy(true); setError(''); setFailureDetails([]); const nextTaskId = uid(); setTaskId(nextTaskId);
    try {
      if (mode === 'import') {
        const selectedMapping = Object.fromEntries(Object.entries(current?.mapping ?? {}).filter(([, target]) => target));
        if (format !== 'sql' && Object.keys(selectedMapping).length === 0) throw new Error(zh.transfer.text001);
        if (new Set(Object.values(selectedMapping)).size !== Object.keys(selectedMapping).length) throw new Error(zh.transfer.text002);
        // 使用刚通过就绪检查的预览上下文，保证执行与字段映射采用同一分隔符。
        const delimiterOptions = previewContext?.csvDelimiter === undefined ? {} : { csvDelimiter: previewContext.csvDelimiter };
        const result = await invoke('files.import', { connectionId, database, table, fileToken: file.token, format, encoding, ...delimiterOptions, mapping: selectedMapping, taskId: nextTaskId });
        setDone(result.rows); setFailureDetails(result.errors);
      } else {
        if (format === 'sql' && !includeData && !includeStructure) throw new Error(zh.transfer.text003);
        const csvSelection = format === 'csv' ? csvController.take(csvContext) : undefined;
        // CSV字段选择始终导出数据，不沿用SQL格式隐藏的数据复选状态；其他格式保持原参数。
        const result = await invoke('files.export', { connectionId, database, table, fileToken: file.token, format, encoding, includeStructure, includeData: format === 'csv' ? true : includeData, taskId: nextTaskId, ...(csvSelection ? { csvSelection } : {}) });
        if (executionKey === formKeyRef.current) setDone(result.rows);
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (useExcel) return <ConnectedExcelTransferDialog mode={mode} connectionId={connectionId} database={database} table={table} onClose={onClose} onBack={() => setUseExcel(false)}/>;
  return <Modal title={`${mode === 'import' ? zh.transfer.text004 : zh.transfer.text005} · ${database}.${table}`} wide onClose={() => { if (!busy) onClose(); }}><div className="modal-content"><div className="form-grid"><Field label={zh.transfer.text006}><select disabled={busy} value={format} onChange={event => { if (event.target.value === 'xlsx') setUseExcel(true); else setFormat(event.target.value as typeof format); setFile(null); setDone(undefined); setFailureDetails([]); setTaskId(''); }}><option value="xlsx">{excelTransferZh.format}</option><option value="csv">{mode === 'import' ? zh.transfer.csvImportFormat : zh.transfer.text007}</option><option value="json">JSON</option><option value="sql">{zh.transfer.text008}</option></select></Field><Field label={zh.transfer.text009}><select disabled={busy} value={encoding} onChange={event => setEncoding(event.target.value as typeof encoding)}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">{zh.transfer.text010}</option></select></Field>{mode === 'import' && format === 'csv' && <Field label={zh.transfer.csvDelimiter}><select aria-label={zh.transfer.csvDelimiter} disabled={busy} value={csvDelimiter} onChange={event => { setCsvDelimiter(event.target.value as CsvImportDelimiter); setDone(undefined); setFailureDetails([]); setTaskId(''); }}>{csvImportDelimiters.map((value, index) => <option key={value} value={value}>{[zh.transfer.csvDelimiterComma, zh.transfer.csvDelimiterSemicolon, zh.transfer.csvDelimiterTab][index]}</option>)}</select><small>{zh.transfer.csvHeaderRequired}</small></Field>}</div>{csvContext && <CsvExportFields context={csvContext} state={csvState} controller={csvController} busy={busy}/>}<button className="file-picker" disabled={busy} onClick={() => void chooseFile()}>{mode === 'import' ? <FileUp size={25}/> : <Download size={25}/>}<span><strong>{file?.name || (mode === 'import' ? zh.transfer.text011 : zh.transfer.text012)}</strong><small>{mode === 'import' ? zh.transfer.text013 : zh.transfer.text014}</small></span><ArrowRight size={17}/></button>{mode === 'export' && format === 'sql' && <div className="check-row"><label className="check"><input type="checkbox" checked={includeStructure} disabled={busy} onChange={event => setIncludeStructure(event.target.checked)}/>{zh.transfer.text015}</label><label className="check"><input type="checkbox" checked={includeData} disabled={busy} onChange={event => setIncludeData(event.target.checked)}/>{zh.transfer.text016}</label></div>}{mode === 'import' && format === 'sql' && <div className="info-strip">{zh.transfer.text017}</div>}{previewing && <Spinner text={zh.transfer.text018}/>}{sample && <><h3>{zh.transfer.text019}</h3><div className="mapping-grid">{sample.columns.map(column => <div className="mapping-row" key={column}><span className="truncate">{column}</span><ArrowRight size={13}/><select aria-label={formatText(zh.transfer.text020, column)} value={mapping[column] ?? ''} disabled={busy} onChange={event => { if (previewContext) previewController.setMapping(previewContext, column, event.target.value); }}><option value="">{zh.transfer.text021}</option>{info?.columns.filter(item => !item.generated).map(target => <option value={target.name} key={target.name}>{target.name}</option>)}</select></div>)}</div><h3>{zh.transfer.text022}</h3><div className="sample-grid"><ResultsGrid columns={sample.columns.map(name => ({ key: name, name, type: '' }))} rows={sample.rows}/></div></>}{task && <div className="transfer-progress"><div><span>{task.message}</span><strong>{Math.round(task.progress)}%</strong></div><progress max="100" value={task.progress}/></div>}{done !== undefined && <div className={failureDetails.length ? 'error-box' : 'success-box'}>{!failureDetails.length && <CheckCircle2 size={16}/>}{zh.transfer.text023}{mode === 'import' ? zh.common.import : zh.common.export} {done}{zh.transfer.text024}{failureDetails.length ? formatText(zh.transfer.text025, failureDetails.length) : '。'}</div>}<ErrorBox message={error || previewError}/>{failureDetails.length > 0 && <details className="error-box" open><summary>{failureDetails.length}{zh.transfer.text026}</summary><pre>{failureDetails.join('\n')}</pre></details>}</div><footer className="modal-footer"><button disabled={busy} onClick={onClose}>{done === undefined ? zh.common.close : zh.common.done}</button><span className="grow"/>{busy ? <button onClick={() => void invoke('query.cancel', { taskId }).catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.transfer.text027}</button> : <button className="primary" disabled={!file || previewing || (needsPreview && !ready) || (mode === 'export' && format === 'csv' && !csvReady?.selected.length) || done !== undefined} onClick={() => void execute()}>{mode === 'import' ? zh.transfer.text028 : zh.transfer.text029}<ArrowRight size={14}/></button>}</footer></Modal>;
}
