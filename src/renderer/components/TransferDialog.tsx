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
import { csvExportOptions, type CsvExportDelimiter } from '../../shared/csvExport';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { csvExportZh } from '../locales/csvExport.zh-CN';
import { csvImportHeaderZh } from '../locales/csvImportHeader.zh-CN';
import { importPresetConfigurationSchema, type ImportPresetConfiguration } from '../../shared/importPresets';
import { captureImportPresetConfiguration } from '../importPresetsUi';
import { ImportPresets } from './ImportPresets';
import { importPresetsZh } from '../locales/importPresets.zh-CN';

/** 文件仅通过一次性选择令牌使用，先预览字段映射再启动独立长任务。 */
export function TransferDialog({ mode, connectionId, database, table, onClose }: { mode: 'import' | 'export'; connectionId: string; database: string; table: string; onClose: () => void }) {
  const [useExcel, setUseExcel] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json' | 'sql'>('csv'); const [encoding, setEncoding] = useState<'utf8' | 'utf16le' | 'gb18030'>('utf8'); const [file, setFile] = useState<FileChoice | null>(null);
  const [csvDelimiter, setCsvDelimiter] = useState<CsvImportDelimiter>(',');
  const [csvHasHeader, setCsvHasHeader] = useState(true);
  const importRevision = useRef(0), renderedImportRevision = importRevision.current;
  const [importEpoch, setImportEpoch] = useState(0), [presetNotice, setPresetNotice] = useState('');
  const presetPlan = useRef<{ revision: number; configuration: ImportPresetConfiguration } | undefined>(undefined);
  const [presetsBusy, setPresetsBusy] = useState(false), presetsBusyRef = useRef(0);
  const [exportDelimiter, setExportDelimiter] = useState<CsvExportDelimiter>(',');
  const exportRevision = useRef(0), renderedExportRevision = exportRevision.current;
  const importCsvDelimiter = mode === 'import' && format === 'csv' ? csvDelimiter : undefined;
  // 省略true保持历史调用；false必须原样传输，不能用真值展开丢失。
  const importCsvHasHeader = mode === 'import' && format === 'csv' && !csvHasHeader ? false : undefined;
  const [previewState, setPreviewState] = useState<ImportPreviewState>(null);
  const [previewController] = useState(() => new ImportPreviewController({
    metadata: target => invoke('metadata.table', target),
    preview: ({ fileToken, format, encoding, csvDelimiter, csvHasHeader }) => invoke('files.preview', { fileToken, format, encoding, ...(csvDelimiter === undefined ? {} : { csvDelimiter }), ...(csvHasHeader === undefined ? {} : { csvHasHeader }) })
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
  const formKey = JSON.stringify([mode, connectionId, database, table, connectionVersion, format, encoding, file?.token, importCsvDelimiter, importCsvHasHeader, mode === 'export' && format === 'csv' ? exportDelimiter : undefined]), formKeyRef = useRef(formKey); formKeyRef.current = formKey;
  const choosing = useRef(0);
  useEffect(() => { void csvController.prepare(csvContext); return () => csvController.cancel(); }, [csvController, csvContext]);
  useEffect(() => {
    if (csvState?.status !== 'ready') return; const expires = Date.parse(csvState.catalog.expiresAt);
    const timer = window.setTimeout(() => setCsvClock(value => value + 1), Math.max(1, expires - Date.now() + 1)); return () => window.clearTimeout(timer);
  }, [csvState]);
  useEffect(() => { if (mode === 'export') { setFile(null); setDone(undefined); setTaskId(''); setError(''); } }, [mode, connectionId, database, table, connectionVersion]);
  const previewContext = useMemo<ImportPreviewContext | null>(() => !useExcel && mode === 'import' && format !== 'sql' && file ? { connectionId, database, table, fileToken: file.token, format, encoding, ...(importCsvDelimiter === undefined ? {} : { csvDelimiter: importCsvDelimiter }), ...(importCsvHasHeader === undefined ? {} : { csvHasHeader: importCsvHasHeader }) } : null, [useExcel, mode, connectionId, database, table, connectionVersion, file?.token, format, encoding, importCsvDelimiter, importCsvHasHeader, importEpoch]);
  const needsPreview = mode === 'import' && format !== 'sql';
  const ready = readyImportPreview(previewState, previewContext); const sample = ready?.sample; const info = ready?.info; const mapping = ready?.mapping ?? {};
  const currentPreview = previewContext && previewState?.key === importPreviewKey(previewContext) ? previewState : null;
  const previewing = !!previewContext && (!currentPreview || currentPreview.status === 'loading');
  const previewError = currentPreview?.status === 'failed' ? currentPreview.error : '';
  useEffect(() => {
    const plan = presetPlan.current, revision = importRevision.current;
    setError(''); void previewController.prepare(previewContext, plan?.revision === revision ? { freshMetadata: true, configuration: plan.configuration } : {}).then(() => {
      if (plan && presetPlan.current === plan && importRevision.current === revision) setPresetNotice(previewController.ready(previewContext) ? importPresetsZh.applied : '');
    });
    return () => { previewController.cancel(); };
  }, [previewController, previewContext]);
  /** 连接修订ABA也在store通知内同步撤销，不等下一次渲染或副作用。 */
  useEffect(() => {
    let version = useWorkspace.getState().connectionVersions[connectionId] ?? 0;
    return useWorkspace.subscribe(state => { const next = state.connectionVersions[connectionId] ?? 0; if (mode === 'import' && next !== version) { version = next; invalidateImport(); setImportEpoch(value => value + 1); } });
  }, [connectionId, mode]);
  const targetIdentity = JSON.stringify([mode, connectionId, database, table]), previousTarget = useRef(targetIdentity);
  useEffect(() => { if (previousTarget.current !== targetIdentity) { previousTarget.current = targetIdentity; if (mode === 'import') { invalidateImport(); setImportEpoch(value => value + 1); } } }, [targetIdentity]);
  /** 手动配置和换文件统一撤销整份套用身份，不删除本地保存的模板。 */
  function invalidateImport(): void { importRevision.current++; choosing.current++; presetPlan.current = undefined; previewController.cancel(); void previewController.prepare(null); setPresetNotice(''); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); }
  function changeImportOptions(action: () => void): void {
    if (busyRef.current || presetsBusyRef.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return;
    invalidateImport(); action(); setImportEpoch(value => value + 1);
  }
  /** 应用只恢复选项并只读核验；相同选项也换代，格式变化必须重新选文件后再次明确应用。 */
  function applyImportPreset(value: ImportPresetConfiguration): boolean {
    if (mode !== 'import' || busyRef.current || presetsBusyRef.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return false;
    const configuration = importPresetConfigurationSchema.parse(value), sameFormat = configuration.format === format;
    invalidateImport(); setFormat(configuration.format); setEncoding(configuration.encoding); setCsvDelimiter(configuration.csvDelimiter ?? ','); setCsvHasHeader(configuration.csvHasHeader ?? true);
    if (sameFormat && file) { presetPlan.current = { revision: importRevision.current, configuration }; setPresetNotice(importPresetsZh.applying); } else { setFile(null); setPresetNotice(importPresetsZh.needFile); }
    setImportEpoch(value => value + 1); return true;
  }
  /** 本地列表/CAS操作真实终结前占住表单和关闭入口，不把关闭当作取消写盘。 */
  function importPresetActivity(delta: 1 | -1): void { if (delta === 1 && busyRef.current) throw Error(importPresetsZh.unavailable); presetsBusyRef.current = Math.max(0, presetsBusyRef.current + delta); setPresetsBusy(presetsBusyRef.current > 0); }
  function captureImportPreset(): ImportPresetConfiguration { if (renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) throw Error(importPresetsZh.unavailable); return captureImportPresetConfiguration(previewContext, previewController.ready(previewContext)); }
  let canSavePreset = false; try { if (ready) { captureImportPresetConfiguration(previewContext, ready); canSavePreset = true; } } catch {}
  const controlsBusy = busy || presetsBusy;
  /** CSV字节配置变化同步撤销旧文件与闭包，ABA恢复同值也不能领取旧选择；字段目录仍可复用。 */
  function changeCsvExport(action: () => void) {
    if (busyRef.current || renderedExportRevision !== exportRevision.current) return;
    exportRevision.current++; choosing.current++; setFile(null); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); action();
  }
  /** 标题切换先同步撤销原预览和所有旧回调；保留当前文件，下一渲染重新读取其首条记录。 */
  function changeCsvImportHeader(value: boolean): void {
    if (value !== csvHasHeader) changeImportOptions(() => setCsvHasHeader(value));
  }
  /** 格式变更后重新选择文件，避免输出扩展名与内容格式不一致。 */
  async function chooseFile() {
    if (busyRef.current || presetsBusyRef.current || renderedExportRevision !== exportRevision.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return;
    const importGeneration = importRevision.current;
    const generation = ++choosing.current, key = formKeyRef.current;
    try { const choice = await invoke('files.choose', { purpose: mode, format, suggestedName: `${table}.${format}` }); if (busyRef.current || generation !== choosing.current || key !== formKeyRef.current || renderedExportRevision !== exportRevision.current || importGeneration !== importRevision.current) return; if (choice) { if (mode === 'import') { invalidateImport(); setImportEpoch(value => value + 1); } setFile(choice); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); } }
    // 迟到失败与迟到成功使用同一归属门，不能覆盖后来分隔符或文件配置的反馈。
    catch (reason) { if (!busyRef.current && generation === choosing.current && key === formKeyRef.current && renderedExportRevision === exportRevision.current && importGeneration === importRevision.current) setError(errorMessage(reason)); }
  }
  /** 每次显式重试使用新任务编号，保留已提交行数与逐行失败明细。 */
  async function execute() {
    if (!file || busyRef.current || presetsBusyRef.current || done !== undefined || renderedExportRevision !== exportRevision.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return;
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
        // 使用刚通过就绪检查的预览上下文，保证执行与映射采用同一分隔符及首行解释。
        const delimiterOptions = previewContext?.csvDelimiter === undefined ? {} : { csvDelimiter: previewContext.csvDelimiter };
        const headerOptions = previewContext?.csvHasHeader === undefined ? {} : { csvHasHeader: previewContext.csvHasHeader };
        const result = await invoke('files.import', { connectionId, database, table, fileToken: file.token, format, encoding, ...delimiterOptions, ...headerOptions, mapping: selectedMapping, taskId: nextTaskId });
        setDone(result.rows); setFailureDetails(result.errors);
      } else {
        if (format === 'sql' && !includeData && !includeStructure) throw new Error(zh.transfer.text003);
        const csvSelection = format === 'csv' ? csvController.take(csvContext) : undefined;
        // CSV字段选择始终导出数据，不沿用SQL格式隐藏的数据复选状态；其他格式保持原参数。
        const result = await invoke('files.export', { connectionId, database, table, fileToken: file.token, format, encoding, ...csvExportOptions(format, exportDelimiter), includeStructure, includeData: format === 'csv' ? true : includeData, taskId: nextTaskId, ...(csvSelection ? { csvSelection } : {}) });
        if (executionKey === formKeyRef.current) setDone(result.rows);
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (useExcel) return <ConnectedExcelTransferDialog mode={mode} connectionId={connectionId} database={database} table={table} onClose={onClose} onBack={() => setUseExcel(false)}/>;
  return <Modal title={`${mode === 'import' ? zh.transfer.text004 : zh.transfer.text005} · ${database}.${table}`} wide onClose={() => { if (!busyRef.current && !presetsBusyRef.current) onClose(); }}><div className="modal-content"><div className="form-grid"><Field label={zh.transfer.text006}><select disabled={controlsBusy} value={format} onChange={event => { const value = event.target.value; if (value === format) return; const update = () => { if (value === 'xlsx') setUseExcel(true); else setFormat(value as typeof format); setFile(null); setDone(undefined); setFailureDetails([]); setTaskId(''); }; if (mode === 'import') changeImportOptions(update); else if (format === 'csv' || value === 'csv') changeCsvExport(update); else update(); }}><option value="xlsx">{excelTransferZh.format}</option><option value="csv">{mode === 'import' ? zh.transfer.csvImportFormat : csvExportZh.format}</option><option value="json">JSON</option><option value="sql">{zh.transfer.text008}</option></select></Field><Field label={zh.transfer.text009}><select disabled={controlsBusy} value={encoding} onChange={event => { const value = event.target.value as typeof encoding; if (value === encoding) return; if (mode === 'import') changeImportOptions(() => setEncoding(value)); else if (format === 'csv') changeCsvExport(() => setEncoding(value)); else setEncoding(value); }}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">{zh.transfer.text010}</option></select></Field>{mode === 'import' && format === 'csv' && <Field label={zh.transfer.csvDelimiter}><select aria-label={zh.transfer.csvDelimiter} disabled={controlsBusy} value={csvDelimiter} onChange={event => { const value = event.target.value as CsvImportDelimiter; if (value !== csvDelimiter) changeImportOptions(() => setCsvDelimiter(value)); }}>{csvImportDelimiters.map((value, index) => <option key={value} value={value}>{[zh.transfer.csvDelimiterComma, zh.transfer.csvDelimiterSemicolon, zh.transfer.csvDelimiterTab][index]}</option>)}</select><small>{csvHasHeader ? csvImportHeaderZh.hasHeaderHint : csvImportHeaderZh.noHeaderHint}</small></Field>}{mode === 'import' && format === 'csv' && <div className="check-row"><label className="check"><input type="checkbox" aria-label={csvImportHeaderZh.label} checked={csvHasHeader} disabled={controlsBusy} onChange={event => changeCsvImportHeader(event.target.checked)}/>{csvImportHeaderZh.label}</label></div>}{mode === 'export' && format === 'csv' && <CsvExportDelimiterField value={exportDelimiter} disabled={controlsBusy} onChange={value => { if (value !== exportDelimiter) changeCsvExport(() => setExportDelimiter(value)); }}/>}</div>{mode === 'import' && format !== 'sql' && <ImportPresets source={JSON.stringify([formKey, importRevision.current])} busy={busy} canSave={canSavePreset} isCurrent={() => renderedImportRevision === importRevision.current && formKeyRef.current === formKey && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === connectionVersion} capture={captureImportPreset} onApply={applyImportPreset} onActivity={importPresetActivity}/>}{presetNotice && <p role="status">{presetNotice}</p>}{csvContext && <CsvExportFields context={csvContext} state={csvState} controller={csvController} busy={busy}/>}<button className="file-picker" disabled={controlsBusy} onClick={() => void chooseFile()}>{mode === 'import' ? <FileUp size={25}/> : <Download size={25}/>}<span><strong>{file?.name || (mode === 'import' ? zh.transfer.text011 : zh.transfer.text012)}</strong><small>{mode === 'import' ? zh.transfer.text013 : zh.transfer.text014}</small></span><ArrowRight size={17}/></button>{mode === 'export' && format === 'sql' && <div className="check-row"><label className="check"><input type="checkbox" checked={includeStructure} disabled={controlsBusy} onChange={event => setIncludeStructure(event.target.checked)}/>{zh.transfer.text015}</label><label className="check"><input type="checkbox" checked={includeData} disabled={controlsBusy} onChange={event => setIncludeData(event.target.checked)}/>{zh.transfer.text016}</label></div>}{mode === 'import' && format === 'sql' && <div className="info-strip">{zh.transfer.text017}</div>}{previewing && <Spinner text={zh.transfer.text018}/>}{sample && <><h3>{zh.transfer.text019}</h3><div className="mapping-grid">{sample.columns.map(column => <div className="mapping-row" key={column}><span className="truncate">{column}</span><ArrowRight size={13}/><select aria-label={formatText(zh.transfer.text020, column)} value={mapping[column] ?? ''} disabled={controlsBusy} onChange={event => { if (!busyRef.current && !presetsBusyRef.current && renderedImportRevision === importRevision.current && formKeyRef.current === formKey && previewContext) { importRevision.current++; choosing.current++; presetPlan.current = undefined; setPresetNotice(''); previewController.setMapping(previewContext, column, event.target.value); } }}><option value="">{zh.transfer.text021}</option>{info?.columns.filter(item => !item.generated).map(target => <option value={target.name} key={target.name}>{target.name}</option>)}</select></div>)}</div><h3>{zh.transfer.text022}</h3><div className="sample-grid"><ResultsGrid columns={sample.columns.map(name => ({ key: name, name, type: '' }))} rows={sample.rows}/></div></>}{task && <div className="transfer-progress"><div><span>{task.message}</span><strong>{Math.round(task.progress)}%</strong></div><progress max="100" value={task.progress}/></div>}{done !== undefined && <div className={failureDetails.length ? 'error-box' : 'success-box'}>{!failureDetails.length && <CheckCircle2 size={16}/>}{zh.transfer.text023}{mode === 'import' ? zh.common.import : zh.common.export} {done}{zh.transfer.text024}{failureDetails.length ? formatText(zh.transfer.text025, failureDetails.length) : '。'}</div>}<ErrorBox message={error || previewError}/>{failureDetails.length > 0 && <details className="error-box" open><summary>{failureDetails.length}{zh.transfer.text026}</summary><pre>{failureDetails.join('\n')}</pre></details>}</div><footer className="modal-footer"><button disabled={controlsBusy} onClick={() => { if (!busyRef.current && !presetsBusyRef.current) onClose(); }}>{done === undefined ? zh.common.close : zh.common.done}</button><span className="grow"/>{busy ? <button onClick={() => void invoke('query.cancel', { taskId }).catch(reason => setError(errorMessage(reason)))}><Square size={13}/>{zh.transfer.text027}</button> : <button className="primary" disabled={presetsBusy || !file || previewing || (needsPreview && !ready) || (mode === 'export' && format === 'csv' && !csvReady?.selected.length) || done !== undefined} onClick={() => void execute()}>{mode === 'import' ? zh.transfer.text028 : zh.transfer.text029}<ArrowRight size={14}/></button>}</footer></Modal>;
}
