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
import { fileImportTransactionZh } from '../locales/fileImportTransaction.zh-CN';
import type { FileImportTransactionMode } from '../../shared/fileImportTransaction';
import { sqlFileImportReceiptSchema, type SqlFileImportReceipt } from '../../shared/sqlFileImport';
import { sqlFileImportZh as sqlText } from '../locales/sqlFileImport.zh-CN';
import { fileImportConflictReportSchema, type FileImportConflictReport } from '../../shared/fileImportConflict';
import { ImportConflictController, initialImportConflictState, type ImportConflictMode, type ImportConflictSource, type ImportConflictState } from '../importConflict';
import { ImportConflictFields } from './ImportConflictFields';
import { ImportConflictReport } from './ImportConflictReport';
import { fileImportConflictZh as conflictText } from '../locales/fileImportConflict.zh-CN';
import { ImportPreflightPanel, type ImportPreflightServices, type ImportPreflightSource } from './ImportPreflightPanel';
import type { FileImportPreflightReport } from '../../shared/fileImportPreflight';
import { importPreflightZh } from '../locales/importPreflight.zh-CN';
import { importNewTableSeedSchema, type ImportNewTableSeed } from '../../shared/importNewTable';

const newTableImportText = {
  invalid:'导入新表的来源、文件指纹或连接已变化，本流程永久失效；请关闭并核对已建表后重新发起。',
  stages:'建表和导入分为两个独立阶段：新表已经创建，导入失败不会自动删除表或重放，新表可能为空。未知结果请先核对准确新表。',
  locked:'当前文件、格式、编码、CSV解释及整文件事务已锁定，冲突处理固定为仅插入；字段映射仍须人工核对，改名后的缺失目标请重新选择。',
  preview:'下方仅为有限记录样本；源字段列表来自先前整文件检查，不代表样本证明文件未变化。导入前必须按原SHA-256及字节数完成整文件预检且没有任何问题。',
  preflight:'请先完成本次映射的整文件预检，要求完整读取、没有任何问题且原SHA-256及字节数一致。',
  consumed:'本次新表导入已发送过一次，不会再次发送；失败或未知结果请先核对准确新表。',
};

/** SQL结果只展示结构化执行事实，不用兼容行数推断提交、保留或整文件成功。 */
function SqlFileImportReport({ receipt }: { receipt: SqlFileImportReceipt | null }) {
  if (!receipt) return <section className="error-box" role="status" aria-label={sqlText.title}><strong>{sqlText.unconfirmed}</strong><p>{sqlText.unconfirmedHint}</p></section>;
  const failure = receipt.failure, position = failure?.statement?.location;
  const warning = receipt.termination !== 'completed' || !!receipt.cleanupWarning || receipt.rollback.state === 'unconfirmed' || receipt.transaction !== 'closed';
  return <section className={warning ? 'info-strip' : 'sql-import-result'} role="status" aria-label={sqlText.title} style={{ overflowWrap: 'anywhere' }}>
    <strong>{receipt.termination === 'completed' ? sqlText.completed : receipt.termination === 'cancelled' ? sqlText.cancelled : sqlText.failed}</strong>
    <p>{sqlText.completedStatements}：{receipt.completedStatements}</p><p>{sqlText.affected}：{receipt.serverReportedAffectedRows === null ? sqlText.unknown : receipt.serverReportedAffectedRows}</p><p className="muted small">{sqlText.affectedHint}</p>
    <p>{sqlText.encoding}：{sqlText.encodings[receipt.encoding]}</p>
    {failure && <><p>{sqlText.phase}：{sqlText.phases[failure.phase]}{failure.statement && ` · ${sqlText.ordinal(failure.statement.ordinal)}`}</p><p>{sqlText.location}：{position ? sqlText.position(position.start, position.end) : sqlText.positionUnavailable}</p><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{failure.message}</pre></>}
    <p className="muted small">{sqlText.positionHint}</p><p>{sqlText.rollback}：{sqlText.rollbackStates[receipt.rollback.state]}</p>{receipt.rollback.message && <p>{receipt.rollback.message}</p>}<p>{sqlText.transaction}：{sqlText.transactions[receipt.transaction]}</p>
    {(receipt.rollback.state === 'unconfirmed' || receipt.transaction !== 'closed') && <p className="warning-text">{sqlText.unknownHint}</p>}
    {receipt.cleanupWarning && <p className="warning-text">{sqlText.cleanup}：{receipt.cleanupWarning}</p>}
  </section>;
}

interface TransferExecution { taskId: string; key: string; revision: number; connectionVersion: number; target: string; valid: boolean; cancellation?:Promise<void>; }
interface TransferDialogProps { mode:'import'|'export'; connectionId:string; database:string; table:string; initialImport?:ImportNewTableSeed; isParentCurrent?():boolean; invalidated?:boolean; onClose():void; }

/** 文件仅通过一次性选择令牌使用，先预览字段映射再启动独立长任务。 */
export function TransferDialog({ mode, connectionId, database, table, initialImport, isParentCurrent, invalidated=false, onClose }: TransferDialogProps) {
  const [seed] = useState(() => {
    let value:ImportNewTableSeed|undefined,error='';
    if(initialImport!==undefined)try{if(mode!=='import')throw Error('新表来源只能用于导入');value=importNewTableSeedSchema.parse(initialImport);}catch(reason){error=newTableImportText.invalid+' '+errorMessage(reason);}
    return {reference:initialImport,value,error,parent:isParentCurrent,locked:initialImport!==undefined,invalid:!!error,consumed:false,connectionId,database,table,version:useWorkspace.getState().connectionVersions[connectionId]??0};
  });
  // 身份按原对象和目标单向封闭，A→B→A不能重新领取旧指纹或把新种子注入普通窗口。
  if(initialImport!==undefined)seed.locked=true;
  if(seed.locked&&(seed.reference!==initialImport||seed.connectionId!==connectionId||seed.database!==database||seed.table!==table||mode!=='import'||seed.version!==(useWorkspace.getState().connectionVersions[connectionId]??0)))seed.invalid=true;
  if(seed.locked&&invalidated)seed.invalid=true;
  seedCurrent();
  /** 原种子与最初父租约共同授权，父false/异常单向撤销；安全取消和关闭仍等待原承诺。 */
  function seedCurrent():boolean {if(!seed.locked)return true;if(!seed.invalid)try{if(seed.parent&&seed.parent()!==true)seed.invalid=true;}catch{seed.invalid=true;}return !seed.invalid;}
  const [useExcel, setUseExcel] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json' | 'sql'>(seed.value?.format??'csv'); const [encoding, setEncoding] = useState<'utf8' | 'utf16le' | 'gb18030'>(seed.value?.encoding??'utf8'); const [file, setFile] = useState<FileChoice | null>(seed.value?.file??null);
  const [csvDelimiter, setCsvDelimiter] = useState<CsvImportDelimiter>(seed.value?.csvDelimiter??',');
  const [csvHasHeader, setCsvHasHeader] = useState(seed.value?.csvHasHeader??true);
  const [transactionMode, setTransactionMode] = useState<FileImportTransactionMode>(seed.locked?'atomic':'batch');
  const transactionRevision = useRef(0), renderedTransactionRevision = transactionRevision.current;
  const importRevision = useRef(0), renderedImportRevision = importRevision.current;
  const [importEpoch, setImportEpoch] = useState(0), [presetNotice, setPresetNotice] = useState('');
  const presetPlan = useRef<{ revision: number; configuration: ImportPresetConfiguration } | undefined>(undefined);
  const [presetsBusy, setPresetsBusy] = useState(false), presetsBusyRef = useRef(0);
  const [preflightBusy, setPreflightBusy] = useState(false), preflightBusyRef = useRef(0);
  const [preflightResult, setPreflightResult] = useState<{ source: ImportPreflightSource; report: FileImportPreflightReport } | null>(null);
  const preflightResultRef = useRef(preflightResult);
  const preflightServices = useMemo<ImportPreflightServices>(() => ({
    run: input => {if(!seedCurrent())return Promise.reject(Error(newTableImportText.invalid));return invoke('files.preflight', input);}, cancel: taskId => invoke('query.cancel', { taskId }), uid,
    chooseReport: () => invoke('files.choose', { purpose: 'export', format: 'json', suggestedName: importPreflightZh.reportName }),
    exportReport: input => invoke('files.exportResult', { ...input, format: 'json', encoding: 'utf8' })
  }), []);
  const [exportDelimiter, setExportDelimiter] = useState<CsvExportDelimiter>(',');
  const exportRevision = useRef(0), renderedExportRevision = exportRevision.current;
  const importCsvDelimiter = mode === 'import' && format === 'csv' ? csvDelimiter : undefined;
  // 省略true保持历史调用；false必须原样传输，不能用真值展开丢失。
  const importCsvHasHeader = mode === 'import' && format === 'csv' && !csvHasHeader ? false : undefined;
  const [previewState, setPreviewState] = useState<ImportPreviewState>(null);
  const [previewController] = useState(() => new ImportPreviewController({
    metadata: target => {if(!seedCurrent())return Promise.reject(Error(newTableImportText.invalid));return invoke('metadata.table', target);},
    preview: ({ fileToken, format, encoding, csvDelimiter, csvHasHeader }) => {if(!seedCurrent())return Promise.reject(Error(newTableImportText.invalid));return invoke('files.preview', { fileToken, format, encoding, ...(csvDelimiter === undefined ? {} : { csvDelimiter }), ...(csvHasHeader === undefined ? {} : { csvHasHeader }) });}
  },state=>setPreviewState(seedCurrent()?state:null)));
  const [includeStructure, setIncludeStructure] = useState(true); const [includeData, setIncludeData] = useState(true); const [busy, setBusy] = useState(false); const busyRef = useRef(false); const [error, setError] = useState(''); const [failureDetails, setFailureDetails] = useState<string[]>([]); const [done, setDone] = useState<number>();
  const [sqlResult, setSqlResult] = useState<{ receipt: SqlFileImportReceipt | null } | null>(null);
  const mounted = useRef(true), execution = useRef<TransferExecution | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (execution.current) execution.current.valid = false; }; }, []);
  const [conflictResult, setConflictResult] = useState<{ report: FileImportConflictReport | null } | null>(null);
  const [conflictState, setConflictState] = useState<ImportConflictState>(initialImportConflictState);
  const conflictSourceRef = useRef<ImportConflictSource | null>(null);
  const [conflictController] = useState(() => new ImportConflictController({
    current: source => mounted.current && conflictSourceRef.current?.identity === source.identity && source.revision === importRevision.current && (useWorkspace.getState().connectionVersions[source.connectionId] ?? 0) === source.connectionVersion,
    open: source => invoke('connections.open', { id: source.connectionId }),
    read: (source, taskId) => invoke('files.importKeys', { connectionId: source.connectionId, database: source.database, table: source.table, taskId }), cancel: taskId => invoke('query.cancel', { taskId }),
    cancelFailure: () => useWorkspace.getState().notify(conflictText.cancelUnconfirmed, true), uid,
  }, state => { if (mounted.current) setConflictState(state); }, conflictState));
  useEffect(() => () => conflictController.dispose(), [conflictController]);
  const [taskId, setTaskId] = useState(''); const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  const connectionVersion = useWorkspace(state => state.connectionVersions[connectionId] ?? 0);
  const [csvState, setCsvState] = useState<CsvExportFieldState>(null), [, setCsvClock] = useState(0);
  const [csvController] = useState(() => new CsvExportFieldsController({
    read: async (target, taskId) => { await invoke('connections.open', { id: target.connectionId }); return invoke('files.exportColumns', { ...target, taskId }); },
    release: catalogId => invoke('files.releaseExportColumns', { catalogId }), taskId: uid, cleanupError: reason => useWorkspace.getState().notify(errorMessage(reason), true)
  }, setCsvState));
  const csvContext = useMemo<CsvExportContext | null>(() => !seed.locked && !seed.invalid && !useExcel && mode === 'export' && format === 'csv' ? { connectionId, database, table, version: connectionVersion } : null, [seed.locked,seed.invalid,useExcel, mode, format, connectionId, database, table, connectionVersion]);
  const csvReady = csvController.ready(csvContext);
  const formKey = JSON.stringify([mode, connectionId, database, table, connectionVersion, format, encoding, file?.token, importCsvDelimiter, importCsvHasHeader, mode === 'export' && format === 'csv' ? exportDelimiter : undefined, mode === 'import' && format !== 'sql' ? transactionMode : undefined, mode === 'import' && format !== 'sql' ? [conflictState.revision, conflictState.mode, conflictState.key, conflictState.source, conflictState.catalog?.schemaHash] : undefined]), formKeyRef = useRef(formKey); formKeyRef.current = formKey;
  const choosing = useRef(0);
  useEffect(() => { void csvController.prepare(csvContext); return () => csvController.cancel(); }, [csvController, csvContext]);
  useEffect(() => {
    if (csvState?.status !== 'ready') return; const expires = Date.parse(csvState.catalog.expiresAt);
    const timer = window.setTimeout(() => setCsvClock(value => value + 1), Math.max(1, expires - Date.now() + 1)); return () => window.clearTimeout(timer);
  }, [csvState]);
  useEffect(() => { if (mode === 'export') { setFile(null); setDone(undefined); setSqlResult(null); setConflictResult(null); setTaskId(''); setError(''); } }, [mode, connectionId, database, table, connectionVersion]);
  const previewContext = useMemo<ImportPreviewContext | null>(() => !seed.invalid && !useExcel && mode === 'import' && format !== 'sql' && file ? { connectionId, database, table, fileToken: file.token, format, encoding, ...(importCsvDelimiter === undefined ? {} : { csvDelimiter: importCsvDelimiter }), ...(importCsvHasHeader === undefined ? {} : { csvHasHeader: importCsvHasHeader }) } : null, [seed.invalid,useExcel, mode, connectionId, database, table, connectionVersion, file?.token, format, encoding, importCsvDelimiter, importCsvHasHeader, importEpoch]);
  const needsPreview = mode === 'import' && format !== 'sql';
  const ready = readyImportPreview(previewState, previewContext); const sample = ready?.sample; const info = ready?.info; const mapping = ready?.mapping ?? {};
  // 每次真实预览或配置代次都产生新对象，恢复相同配置也不能领取旧报告。
  const preflightSource = useMemo<ImportPreflightSource | null>(() => ready && previewContext ? {
    identity: {}, input: { ...previewContext, ...(seed.locked&&seed.value?{expectedSource:{...seed.value.expectedSource}}:{}), mapping: Object.fromEntries(Object.entries(ready.mapping).filter(([, target]) => target)) }
  } : null, [ready, previewContext, transactionMode, renderedImportRevision]);
  const preflightSourceRef = useRef(preflightSource); preflightSourceRef.current = preflightSource;
  const currentPreflight = preflightResult?.source === preflightSource ? preflightResult.report : null;
  const seedPreflightReady = !seed.locked || !!seed.value&&!!currentPreflight&&currentPreflight.complete&&currentPreflight.issueCount===0&&currentPreflight.sourceFingerprint===seed.value.expectedSource.sha256&&currentPreflight.sourceBytes===seed.value.expectedSource.bytes;
  const preflightBlocked = !seedPreflightReady || !!currentPreflight && (!currentPreflight.complete || currentPreflight.issueCount > 0);
  /** 父层与预检分别保留占用，选择文件、取消请求和卸载都不提前释放原任务。 */
  function preflightActivity(delta: 1 | -1): void {
    if (delta === 1 && (!seedCurrent() || seed.consumed || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || renderedImportRevision !== importRevision.current || renderedTransactionRevision !== transactionRevision.current || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== connectionVersion)) throw Error(importPreflightZh.failed);
    preflightBusyRef.current = Math.max(0, preflightBusyRef.current + delta);
    if (mounted.current) setPreflightBusy(preflightBusyRef.current > 0);
  }
  /** 迟到的旧来源回调不能清除或替换当前报告。 */
  function receivePreflight(source: ImportPreflightSource, report: FileImportPreflightReport | null): void {
    if (!mounted.current || !seedCurrent() || preflightSourceRef.current !== source || renderedImportRevision !== importRevision.current || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== connectionVersion) return;
    preflightResultRef.current = report ? { source, report } : null;
    setPreflightResult(preflightResultRef.current);
  }
  const conflictSource: ImportConflictSource | null = !seed.locked && !useExcel && mode === 'import' && format !== 'sql' && ready ? { identity: JSON.stringify([ready.key, connectionVersion, importRevision.current, ready.mapping]), connectionId, database, table, connectionVersion, revision: importRevision.current, mapping: ready.mapping, rows: ready.sample.rows } : null;
  conflictSourceRef.current = conflictSource;
  const currentPreview = previewContext && previewState?.key === importPreviewKey(previewContext) ? previewState : null;
  const previewing = !!previewContext && (!currentPreview || currentPreview.status === 'loading');
  const previewError = currentPreview?.status === 'failed' ? currentPreview.error : '';
  useEffect(() => {
    const plan = presetPlan.current, revision = importRevision.current;
    setError(''); void previewController.prepare(previewContext, seed.locked&&seed.value?{freshMetadata:true,initialMapping:seed.value.mapping,sourceColumns:seed.value.columns}:plan?.revision === revision ? { freshMetadata: true, configuration: plan.configuration } : {}).then(() => {
      if (plan && presetPlan.current === plan && importRevision.current === revision) setPresetNotice(previewController.ready(previewContext) ? importPresetsZh.applied : '');
    });
    return () => { previewController.cancel(); };
  }, [previewController, previewContext]);
  /** 连接修订ABA也在store通知内同步撤销，不等下一次渲染或副作用。 */
  useEffect(() => {
    let version = useWorkspace.getState().connectionVersions[connectionId] ?? 0;
    return useWorkspace.subscribe(state => { const next = state.connectionVersions[connectionId] ?? 0; if (next !== version) { version = next; if(seed.locked)seed.invalid=true; if (execution.current) execution.current.valid = false; if (mode === 'import') { invalidateImport(); setImportEpoch(value => value + 1); } } });
  }, [connectionId, mode]);
  const targetIdentity = JSON.stringify([mode, connectionId, database, table]), previousTarget = useRef(targetIdentity);
  const executionTarget = useRef(targetIdentity);
  // 来源变化在本次渲染就撤销，不能等副作用后才拒绝旧请求；返回同值也不复活。
  if (executionTarget.current !== targetIdentity) { executionTarget.current = targetIdentity; choosing.current++; if (execution.current) execution.current.valid = false; }
  useEffect(() => { if (previousTarget.current !== targetIdentity) { previousTarget.current = targetIdentity; if (mode === 'import') { invalidateImport(); setImportEpoch(value => value + 1); } } }, [targetIdentity]);
  /** 手动配置和换文件统一撤销整份套用身份，不删除本地保存的模板。 */
  function invalidateImport(): void { if (execution.current) execution.current.valid = false; conflictController.reset(); setConflictResult(null); importRevision.current++; choosing.current++; presetPlan.current = undefined; previewController.cancel(); void previewController.prepare(null); setPresetNotice(''); setDone(undefined); setSqlResult(null); setFailureDetails([]); setTaskId(''); setError(''); }
  function changeImportOptions(action: () => void): void {
    if (seed.locked || seed.invalid || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return;
    invalidateImport(); action(); setImportEpoch(value => value + 1);
  }
  /** 应用只恢复选项并只读核验；相同选项也换代，格式变化必须重新选文件后再次明确应用。 */
  function applyImportPreset(value: ImportPresetConfiguration): boolean {
    if (seed.locked || seed.invalid || mode !== 'import' || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return false;
    const configuration = importPresetConfigurationSchema.parse(value), sameFormat = configuration.format === format;
    invalidateImport(); setFormat(configuration.format); setEncoding(configuration.encoding); setCsvDelimiter(configuration.csvDelimiter ?? ','); setCsvHasHeader(configuration.csvHasHeader ?? true);
    if (sameFormat && file) { presetPlan.current = { revision: importRevision.current, configuration }; setPresetNotice(importPresetsZh.applying); } else { setFile(null); setPresetNotice(importPresetsZh.needFile); }
    setImportEpoch(value => value + 1); return true;
  }
  /** 本地列表/CAS操作真实终结前占住表单和关闭入口，不把关闭当作取消写盘。 */
  function importPresetActivity(delta: 1 | -1): void { if (delta === 1 && (busyRef.current || preflightBusyRef.current)) throw Error(importPresetsZh.unavailable); presetsBusyRef.current = Math.max(0, presetsBusyRef.current + delta); setPresetsBusy(presetsBusyRef.current > 0); }
  function captureImportPreset(): ImportPresetConfiguration { if (renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) throw Error(importPresetsZh.unavailable); return captureImportPresetConfiguration(previewContext, previewController.ready(previewContext)); }
  let canSavePreset = false; try { if (ready) { captureImportPresetConfiguration(previewContext, ready); canSavePreset = true; } } catch {}
  const controlsBusy = busy || presetsBusy || preflightBusy;
  const configurationLocked = controlsBusy || seed.locked || seed.invalid;
  /** 模式与匹配键明确选择，只读目录不改变提交方式；旧事件不能使用新状态发起写入。 */
  function changeConflictMode(value: ImportConflictMode) {
    if (seed.locked || seed.invalid || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || done !== undefined || conflictResult || !conflictSource || !conflictController.current(conflictSource, conflictState)) return;
    void conflictController.chooseMode(conflictSource, value, conflictState);
  }
  function changeConflictKey(value: string) {
    if (seed.locked || seed.invalid || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || done !== undefined || conflictResult || !conflictSource) return;
    conflictController.chooseKey(conflictSource, value, conflictState);
  }
  /** 提交方式独立换代，不改变文件解释、已核验映射或模板计划；旧执行闭包永久失效。 */
  function changeImportTransaction(value: string): void {
    if (seed.locked || seed.invalid || mode !== 'import' || format === 'sql' || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || renderedTransactionRevision !== transactionRevision.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey || value !== 'batch' && value !== 'atomic' || value === transactionMode) return;
    transactionRevision.current++; choosing.current++; setTransactionMode(value);
  }
  /** CSV字节配置变化同步撤销旧文件与闭包，ABA恢复同值也不能领取旧选择；字段目录仍可复用。 */
  function changeCsvExport(action: () => void) {
    if (seed.locked || seed.invalid || busyRef.current || renderedExportRevision !== exportRevision.current) return;
    exportRevision.current++; choosing.current++; setFile(null); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); action();
  }
  /** 标题切换先同步撤销原预览和所有旧回调；保留当前文件，下一渲染重新读取其首条记录。 */
  function changeCsvImportHeader(value: boolean): void {
    if (value !== csvHasHeader) changeImportOptions(() => setCsvHasHeader(value));
  }
  /** 格式变更后重新选择文件，避免输出扩展名与内容格式不一致。 */
  async function chooseFile() {
    if (seed.locked || seed.invalid || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || renderedExportRevision !== exportRevision.current || renderedImportRevision !== importRevision.current || formKeyRef.current !== formKey) return;
    const importGeneration = importRevision.current;
    const generation = ++choosing.current, key = formKeyRef.current;
    try { const choice = await invoke('files.choose', { purpose: mode, format, suggestedName: `${table}.${format}` }); if (!mounted.current || busyRef.current || generation !== choosing.current || key !== formKeyRef.current || renderedExportRevision !== exportRevision.current || importGeneration !== importRevision.current) return; if (choice) { if (mode === 'import') { invalidateImport(); setImportEpoch(value => value + 1); } setFile(choice); setDone(undefined); setFailureDetails([]); setTaskId(''); setError(''); } }
    // 迟到失败与迟到成功使用同一归属门，不能覆盖后来分隔符或文件配置的反馈。
    catch (reason) { if (mounted.current && !busyRef.current && generation === choosing.current && key === formKeyRef.current && renderedExportRevision === exportRevision.current && importGeneration === importRevision.current) setError(errorMessage(reason)); }
  }
  /** 每次显式重试使用新任务编号，保留已提交行数与逐行失败明细。 */
  async function execute() {
    if (!mounted.current || !seedCurrent() || seed.consumed || !file || busyRef.current || presetsBusyRef.current || preflightBusyRef.current || done !== undefined || sqlResult !== null || conflictResult !== null || renderedExportRevision !== exportRevision.current || renderedImportRevision !== importRevision.current || renderedTransactionRevision !== transactionRevision.current || formKeyRef.current !== formKey || (useWorkspace.getState().connectionVersions[connectionId] ?? 0) !== connectionVersion) return;
    // 就绪状态在入口重新检查，不能只依赖按钮禁用；快速切换参数也不能使用旧文件的映射。
    const current = previewController.ready(previewContext);
    const verified = preflightResultRef.current;
    if(seed.locked&&(!seed.value||verified?.source!==preflightSourceRef.current||!verified?.report.complete||verified.report.issueCount!==0||verified.report.sourceFingerprint!==seed.value.expectedSource.sha256||verified.report.sourceBytes!==seed.value.expectedSource.bytes)){setError(newTableImportText.preflight);return;}
    if (verified?.source === preflightSourceRef.current && (!verified.report.complete || verified.report.issueCount > 0)) { setError(importPreflightZh.blocked); return; }
    if (needsPreview && !current) { setError(zh.transfer.previewNotReady); return; }
    if (mode === 'export' && format === 'csv' && !csvController.ready(csvContext)?.selected.length) { setError(csvExportFieldsZh.selectionRequired); return; }
    if (!seed.locked && mode === 'import' && format !== 'sql' && !conflictController.canExecute(conflictSource, conflictState)) return;
    const selectedConflict = !seed.locked && mode === 'import' && format !== 'sql' ? conflictController.selection(conflictSource, conflictState) : undefined;
    busyRef.current = true; setBusy(true); setError(''); setFailureDetails([]); const nextTaskId = uid(); setTaskId(nextTaskId);
    const owner: TransferExecution = { taskId: nextTaskId, key: formKeyRef.current, revision: importRevision.current, connectionVersion, target: targetIdentity, valid: true };
    execution.current = owner;
    /** 成功、失败和附加回执使用同一来源门，ABA撤销不会因恢复原值而复活。 */
    const owns = () => mounted.current && seedCurrent() && execution.current === owner && owner.valid && owner.key === formKeyRef.current && owner.revision === importRevision.current && owner.connectionVersion === (useWorkspace.getState().connectionVersions[connectionId] ?? 0) && owner.target === executionTarget.current;
    try {
      if (mode === 'import') {
        const selectedMapping = Object.fromEntries(Object.entries(current?.mapping ?? {}).filter(([, target]) => target));
        if (format !== 'sql' && Object.keys(selectedMapping).length === 0) throw new Error(zh.transfer.text001);
        if (new Set(Object.values(selectedMapping)).size !== Object.keys(selectedMapping).length) throw new Error(zh.transfer.text002);
        // 使用刚通过就绪检查的预览上下文，保证执行与映射采用同一分隔符及首行解释。
        const delimiterOptions = previewContext?.csvDelimiter === undefined ? {} : { csvDelimiter: previewContext.csvDelimiter };
        const headerOptions = previewContext?.csvHasHeader === undefined ? {} : { csvHasHeader: previewContext.csvHasHeader };
        if(seed.locked)seed.consumed=true;
        const result = await invoke('files.import', { connectionId, database, table, fileToken: file.token, format, encoding, ...delimiterOptions, ...headerOptions, ...(format === 'sql' ? {} : { transactionMode:seed.locked?'atomic':transactionMode }), ...(seed.locked&&seed.value?{expectedSource:{...seed.value.expectedSource}}:{}), ...(selectedConflict ? { conflict: selectedConflict } : {}), mapping: selectedMapping, taskId: nextTaskId });
        if (!owns()) return;
        if (format === 'sql') {
          const parsed = sqlFileImportReceiptSchema.safeParse(result.sql);
          // 仅本任务、原编码的有效回执可显示执行事实，兼容rows/errors不充当提交证明。
          setSqlResult({ receipt: parsed.success && parsed.data.taskId === owner.taskId && parsed.data.encoding === encoding ? parsed.data : null });
        } else if (selectedConflict) {
          const parsed = fileImportConflictReportSchema.safeParse(result.conflicts);
          setConflictResult({ report: parsed.success && parsed.data.taskId === owner.taskId && parsed.data.mode === selectedConflict.mode ? parsed.data : null });
        } else { setDone(result.rows); setFailureDetails(result.errors); }
      } else {
        if (format === 'sql' && !includeData && !includeStructure) throw new Error(zh.transfer.text003);
        const csvSelection = format === 'csv' ? csvController.take(csvContext) : undefined;
        // CSV字段选择始终导出数据，不沿用SQL格式隐藏的数据复选状态；其他格式保持原参数。
        const result = await invoke('files.export', { connectionId, database, table, fileToken: file.token, format, encoding, ...csvExportOptions(format, exportDelimiter), includeStructure, includeData: format === 'csv' ? true : includeData, taskId: nextTaskId, ...(csvSelection ? { csvSelection } : {}) });
        if (owns()) setDone(result.rows);
      }
    } catch (reason) { if (owns()) { setError(errorMessage(reason)); if (mode === 'import' && format === 'sql') setSqlResult({ receipt: null }); else if (selectedConflict) setConflictResult({ report: null }); } }
    finally { if(seed.locked&&owner.cancellation)await owner.cancellation; if (execution.current === owner) { execution.current = null; busyRef.current = false; if (mounted.current) setBusy(false); } }
  }

  /** 取消始终指向尚未落定的原任务，来源失效不会提前解锁或误取消新任务。 */
  async function cancelExecution() {
    const owner = execution.current; if (!owner || !busyRef.current) return;
    if(seed.locked){
      if(!owner.cancellation)owner.cancellation=Promise.resolve().then(()=>invoke('query.cancel',{taskId:owner.taskId})).then(()=>undefined).catch(reason=>{if(mounted.current&&execution.current===owner)setError(errorMessage(reason));});
      await owner.cancellation;return;
    }
    try { await invoke('query.cancel', { taskId: owner.taskId }); }
    catch (reason) { if (mounted.current && execution.current === owner && owner.valid && owner.key === formKeyRef.current && owner.revision === importRevision.current && owner.target === executionTarget.current && owner.connectionVersion === (useWorkspace.getState().connectionVersions[connectionId] ?? 0)) setError(errorMessage(reason)); }
  }
  /** 父租约失效只封闭新请求；原任务及取消真正终结后仍可安全关闭原子页。 */
  function closeTransfer():void {seedCurrent();if(!busyRef.current&&!presetsBusyRef.current&&!preflightBusyRef.current)onClose();}
  if (!seed.locked && useExcel) return <ConnectedExcelTransferDialog mode={mode} connectionId={connectionId} database={database} table={table} onClose={onClose} onBack={() => setUseExcel(false)}/>;
  return <Modal title={`${mode === 'import' ? zh.transfer.text004 : zh.transfer.text005} · ${database}.${table}`} wide onClose={closeTransfer}><div className="modal-content">{seed.locked&&<section className="warning-text" aria-label="新表导入两阶段说明"><p>{newTableImportText.stages}</p><p>{newTableImportText.locked}</p><p>{newTableImportText.preview}</p></section>}<div className="form-grid"><Field label={zh.transfer.text006}><select disabled={configurationLocked} value={format} onChange={event => { if(seed.locked||seed.invalid)return; const value = event.target.value; if (value === format) return; const update = () => { if (value === 'xlsx') setUseExcel(true); else setFormat(value as typeof format); setFile(null); setDone(undefined); setFailureDetails([]); setTaskId(''); }; if (mode === 'import') changeImportOptions(update); else if (format === 'csv' || value === 'csv') changeCsvExport(update); else update(); }}><option value="xlsx">{excelTransferZh.format}</option><option value="csv">{mode === 'import' ? zh.transfer.csvImportFormat : csvExportZh.format}</option><option value="json">JSON</option><option value="sql">{zh.transfer.text008}</option></select></Field><Field label={zh.transfer.text009}><select disabled={configurationLocked} value={encoding} onChange={event => { if(seed.locked||seed.invalid)return; const value = event.target.value as typeof encoding; if (value === encoding) return; if (mode === 'import') changeImportOptions(() => setEncoding(value)); else if (format === 'csv') changeCsvExport(() => setEncoding(value)); else setEncoding(value); }}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">{zh.transfer.text010}</option></select></Field>{mode === 'import' && format === 'csv' && <Field label={zh.transfer.csvDelimiter}><select aria-label={zh.transfer.csvDelimiter} disabled={configurationLocked} value={csvDelimiter} onChange={event => { const value = event.target.value as CsvImportDelimiter; if (value !== csvDelimiter) changeImportOptions(() => setCsvDelimiter(value)); }}>{csvImportDelimiters.map((value, index) => <option key={value} value={value}>{[zh.transfer.csvDelimiterComma, zh.transfer.csvDelimiterSemicolon, zh.transfer.csvDelimiterTab][index]}</option>)}</select><small>{csvHasHeader ? csvImportHeaderZh.hasHeaderHint : csvImportHeaderZh.noHeaderHint}</small></Field>}{mode === 'import' && format === 'csv' && <div className="check-row"><label className="check"><input type="checkbox" aria-label={csvImportHeaderZh.label} checked={csvHasHeader} disabled={configurationLocked} onChange={event => changeCsvImportHeader(event.target.checked)}/>{csvImportHeaderZh.label}</label></div>}{mode === 'export' && format === 'csv' && <CsvExportDelimiterField value={exportDelimiter} disabled={controlsBusy} onChange={value => { if (value !== exportDelimiter) changeCsvExport(() => setExportDelimiter(value)); }}/>}</div>{mode === 'import' && format !== 'sql' && <section><Field label={fileImportTransactionZh.label}><select aria-label={fileImportTransactionZh.label} value={transactionMode} disabled={configurationLocked} onChange={event => changeImportTransaction(event.target.value)}><option value="batch">{fileImportTransactionZh.batch}</option><option value="atomic">{fileImportTransactionZh.atomic}</option></select></Field><p className="muted small">{transactionMode === 'atomic' ? fileImportTransactionZh.atomicHint : fileImportTransactionZh.batchHint} {fileImportTransactionZh.unknown}</p><p className="muted small">{fileImportTransactionZh.presetHint}</p></section>}{!seed.locked && mode === 'import' && format !== 'sql' && <ImportConflictFields state={conflictState} source={conflictSource} busy={controlsBusy || conflictResult !== null || done !== undefined} onMode={changeConflictMode} onKey={changeConflictKey} onRefresh={() => changeConflictMode(conflictState.mode)}/ >}{!seed.locked && mode === 'import' && format !== 'sql' && <ImportPresets source={JSON.stringify([formKey, importRevision.current])} busy={busy || preflightBusy} canSave={canSavePreset} isCurrent={() => renderedImportRevision === importRevision.current && formKeyRef.current === formKey && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === connectionVersion} capture={captureImportPreset} onApply={applyImportPreset} onActivity={importPresetActivity}/>}{presetNotice && <p role="status">{presetNotice}</p>}{csvContext && <CsvExportFields context={csvContext} state={csvState} controller={csvController} busy={busy}/>}<button className="file-picker" disabled={configurationLocked} onClick={() => void chooseFile()}>{mode === 'import' ? <FileUp size={25}/> : <Download size={25}/>}<span><strong>{file?.name || (mode === 'import' ? zh.transfer.text011 : zh.transfer.text012)}</strong><small>{mode === 'import' ? zh.transfer.text013 : zh.transfer.text014}</small></span><ArrowRight size={17}/></button>{mode === 'export' && format === 'sql' && <div className="check-row"><label className="check"><input type="checkbox" checked={includeStructure} disabled={controlsBusy} onChange={event => setIncludeStructure(event.target.checked)}/>{zh.transfer.text015}</label><label className="check"><input type="checkbox" checked={includeData} disabled={controlsBusy} onChange={event => setIncludeData(event.target.checked)}/>{zh.transfer.text016}</label></div>}{mode === 'import' && format === 'sql' && <div className="info-strip">{zh.transfer.text017}</div>}{previewing && <Spinner text={zh.transfer.text018}/>}{sample && <><h3>{zh.transfer.text019}</h3><div className="mapping-grid">{sample.columns.map(column => <div className="mapping-row" key={column}><span className="truncate">{column}</span><ArrowRight size={13}/><select aria-label={formatText(zh.transfer.text020, column)} value={mapping[column] ?? ''} disabled={controlsBusy||seed.invalid||seed.consumed} onChange={event => { if (seedCurrent() && !seed.consumed && !busyRef.current && !presetsBusyRef.current && !preflightBusyRef.current && renderedImportRevision === importRevision.current && formKeyRef.current === formKey && previewContext) { conflictController.reset(); setConflictResult(null); importRevision.current++; choosing.current++; presetPlan.current = undefined; setPresetNotice(''); previewController.setMapping(previewContext, column, event.target.value); } }}><option value="">{zh.transfer.text021}</option>{info?.columns.filter(item => !item.generated).map(target => <option value={target.name} key={target.name}>{target.name}</option>)}</select></div>)}</div><h3>{zh.transfer.text022}</h3><div className="sample-grid"><ResultsGrid columns={sample.columns.map(name => ({ key: name, name, type: '' }))} rows={sample.rows}/></div></>}{mode === 'import' && format !== 'sql' && <ImportPreflightPanel source={preflightSource} busy={seed.invalid || seed.consumed || busy || presetsBusy || done !== undefined || conflictResult !== null} services={preflightServices} onActivity={preflightActivity} onReport={receivePreflight}/>}{task && !conflictResult && !(mode === 'import' && format === 'sql' && sqlResult) && <div className="transfer-progress"><div><span>{task.message}</span><strong>{Math.round(task.progress)}%</strong></div><progress max="100" value={task.progress}/></div>}{mode === 'import' && format !== 'sql' && conflictResult && <ImportConflictReport report={conflictResult.report}/ >}{mode === 'import' && format === 'sql' && sqlResult && <SqlFileImportReport receipt={sqlResult.receipt}/ >}{!(mode === 'import' && format === 'sql') && done !== undefined && <div className={failureDetails.length ? 'error-box' : 'success-box'}>{!failureDetails.length && <CheckCircle2 size={16}/>}{zh.transfer.text023}{mode === 'import' ? zh.common.import : zh.common.export} {done}{zh.transfer.text024}{failureDetails.length ? formatText(zh.transfer.text025, failureDetails.length) : '。'}</div>}<ErrorBox message={seed.invalid ? seed.error||newTableImportText.invalid : error || previewError}/>{seed.locked&&seed.consumed&&<p className="warning-text">{newTableImportText.consumed}</p>}{failureDetails.length > 0 && <details className="error-box" open><summary>{failureDetails.length}{zh.transfer.text026}</summary><pre>{failureDetails.join('\n')}</pre></details>}</div><footer className="modal-footer"><button disabled={controlsBusy} onClick={closeTransfer}>{done === undefined && sqlResult === null && conflictResult === null ? zh.common.close : zh.common.done}</button><span className="grow"/>{busy ? <button onClick={() => void cancelExecution()}><Square size={13}/>{zh.transfer.text027}</button> : <button className="primary" disabled={seed.invalid || seed.consumed || presetsBusy || preflightBusy || preflightBlocked || !file || previewing || (needsPreview && !ready) || (mode === 'export' && format === 'csv' && !csvReady?.selected.length) || done !== undefined || sqlResult !== null || conflictResult !== null || (!seed.locked && mode === 'import' && format !== 'sql' && !conflictController.canExecute(conflictSource, conflictState))} onClick={() => void execute()}>{mode === 'import' ? zh.transfer.text028 : zh.transfer.text029}<ArrowRight size={14}/></button>}</footer></Modal>;
}
