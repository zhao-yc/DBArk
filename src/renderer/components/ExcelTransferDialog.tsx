import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CellValue, FileChoice } from '../../shared/contracts';
import { validateExcelMapping, type ExcelColumn, type ExcelFieldMapping, type ExcelSheet, type ExcelSheetPreview, type ExcelTextProtocol, type ExcelTransferProgress, type ExcelTransferServices, type ExcelTransferTarget } from '../../shared/excelTransfer';
import { excelTransferZh as text } from '../locales/excelTransfer.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { ExcelTransferLifecycle, type ExcelTaskSnapshot } from '../excelTransferLifecycle';
import '../excelTransfer.css';

interface Props extends ExcelTransferTarget {
  mode: 'import' | 'export'; services: ExcelTransferServices; onClose(): void; onBack?(): void;
  progress?: ExcelTransferProgress; onTaskStart?(taskId: string): void;
}
interface ReadyPreview { key: string; sample: ExcelSheetPreview; targets: ExcelColumn[]; mapping: ExcelFieldMapping[]; }

/** 预览键包括文件、工作表、协议和目标上下文，迟到响应不能恢复旧映射。 */
export function excelPreviewKey(target: ExcelTransferTarget, fileToken: string, sheetId: string, protocol: ExcelTextProtocol, headerRow = 1): string {
  return JSON.stringify([target.connectionId, target.database, target.table, fileToken, sheetId, protocol, headerRow]);
}

/** 预览值只作为 React 文本展示，保留空串/NULL 的可见区别，不插入文件中的 HTML。 */
function showValue(value: CellValue): string {
  if (value === null) return text.nullValue;
  if (typeof value === 'object') return `${text.binaryValue} (${value.base64.length})`;
  return value === '' ? text.emptyValue : String(value);
}

/** 所有后端能力通过 services 注入；正式导入仍由现有引擎管理事务、提交和任务取消。 */
export function ExcelTransferDialog(props: Props) {
  const { mode, connectionId, database, table, services, onClose, progress } = props;
  const [file, setFile] = useState<FileChoice | null>(null), [sheets, setSheets] = useState<ExcelSheet[]>([]), [sheetId, setSheetId] = useState('');
  const [protocol, setProtocol] = useState<ExcelTextProtocol>('plain'), [ready, setReady] = useState<ReadyPreview | null>(null);
  const [headerRow, setHeaderRow] = useState(1), [scope, setScope] = useState<'sample' | 'all'>('sample');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [done, setDone] = useState<number>(), [failures, setFailures] = useState<string[]>([]);
  const [lifecycle] = useState(() => new ExcelTransferLifecycle());
  const [taskState, setTaskState] = useState<ExcelTaskSnapshot>(lifecycle.snapshot);
  const busy = taskState.busy, contextKey = JSON.stringify([mode, connectionId, database, table]);
  const reservationKey = JSON.stringify([connectionId, database, table]);
  const [mappingPage, setMappingPage] = useState(0); const targetListId = useId();
  const choosing = useRef(false), generation = useRef(0), fileGeneration = useRef(0), mounted = useRef(true);
  const readTasks = useRef(new Set<string>());
  const key = file && sheetId ? excelPreviewKey(props, file.token, sheetId, protocol, headerRow) : '';
  const current = ready?.key === key ? ready : null;

  /** 组件销毁或上下文改变后，所有旧文件与预览请求都失效。 */
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; fileGeneration.current++; for (const id of readTasks.current) void services.cancel(id).catch(() => undefined); }; }, [services]);
  useLayoutEffect(() => {
    lifecycle.attach(contextKey, setTaskState, reservationKey);
    fileGeneration.current++; generation.current++; setFile(null); setSheets([]); setSheetId(''); setReady(null); setDone(undefined); setFailures([]); setError(''); setLoading(false);
    return () => { lifecycle.detach(); for (const id of readTasks.current) void services.cancel(id).catch(() => undefined); };
  }, [lifecycle, contextKey, reservationKey]);
  useEffect(() => {
    const revision = ++generation.current; setReady(null); setDone(undefined); setError(''); setMappingPage(0);
    if (mode !== 'import' || !file || !sheetId) return;
    setLoading(true);
    const taskId = crypto.randomUUID(); readTasks.current.add(taskId);
    const previewTask = services.preview({ fileToken: file.token, taskId, sheetId, headerRow, protocol });
    // 元数据失败时立即取消文件读取；等待后端资源收尾，避免 Promise.all 提前拒绝留下后台解析。
    const targetsTask = services.targetColumns({ connectionId, database, table }).catch(async reason => { await services.cancel(taskId).catch(() => undefined); throw reason; });
    void Promise.allSettled([previewTask, targetsTask]).then(([sampleResult, targetResult]) => {
      if (!mounted.current || generation.current !== revision) return;
      // 等两侧均收尾后优先报告目标错误，避免它触发的读取取消掩盖真正失败原因。
      const failed = targetResult.status === 'rejected' ? targetResult : sampleResult.status === 'rejected' ? sampleResult : null;
      if (failed) { setError(failed.reason instanceof Error ? failed.reason.message : text.error); return; }
      if (sampleResult.status !== 'fulfilled' || targetResult.status !== 'fulfilled') return;
      const sample = sampleResult.value, targets = targetResult.value;
      const mapping = sample.columns.map(source => ({ source, target: targets.some(column => column.name === source) ? source : '' }));
      setReady({ key, sample, targets, mapping });
    })
      .finally(() => { readTasks.current.delete(taskId); if (mounted.current && generation.current === revision) setLoading(false); });
    return () => { generation.current++; void services.cancel(taskId).catch(() => undefined); };
  }, [mode, file?.token, sheetId, protocol, connectionId, database, table, services, key]);

  /** 文件选择串行化，且校验响应仍属于本轮选择，避免快速点击或关闭导致状态回滚。 */
  async function chooseFile() {
    if (lifecycle.busy || choosing.current) return;
    choosing.current = true;
    const revision = ++fileGeneration.current;
    try {
      const selected = await services.chooseFile(mode, `${table}.xlsx`);
      if (!selected || !mounted.current || revision !== fileGeneration.current) return;
      generation.current++; setFile(selected); setReady(null); setSheets([]); setSheetId(''); setError(''); setDone(undefined); setFailures([]);
      if (mode === 'import') {
        setLoading(true); const taskId = crypto.randomUUID(); readTasks.current.add(taskId);
        let available: ExcelSheet[];
        try { available = await services.listSheets(selected.token, taskId); } finally { readTasks.current.delete(taskId); }
        if (!mounted.current || revision !== fileGeneration.current) return;
        setSheets(available); setSheetId(available[0]?.id ?? '');
      }
    } catch (reason) { if (mounted.current && revision === fileGeneration.current) setError(reason instanceof Error ? reason.message : text.error); }
    finally { choosing.current = false; if (mounted.current && revision === fileGeneration.current) setLoading(false); }
  }

  /** 同步锁覆盖双击；提交前重新检查就绪预览键、唯一映射以及当前目标列。 */
  async function execute() {
    if (!file || lifecycle.busy || done !== undefined) return;
    if (mode === 'import' && !current) { setError(text.pendingPreview); return; }
    const mapping = current?.mapping.filter(item => item.target) ?? [];
    try { if (current) validateExcelMapping(mapping, current.sample.columns, current.targets.map(column => column.name)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.error); return; }
    setError(''); setFailures([]);
    const id = crypto.randomUUID(), target = { connectionId, database, table, fileToken: file.token, taskId: id };
    const submittedServices = services;
    await lifecycle.run({ taskId: id, contextKey, prepare: () => props.onTaskStart?.(id),
      cancel: task => submittedServices.cancel(task),
      execute: () => mode === 'export'
        ? submittedServices.exportTable({ ...target, scope }).then(result => ({ ...result, errors: [] }))
        : submittedServices.importTable({ ...target, sheetId, headerRow, protocol, mapping, fingerprint: current!.sample.fingerprint }),
      success: result => { setDone(result.rows); setFailures(result.errors); },
      failure: reason => setError(reason instanceof Error ? reason.message : text.error),
    });
  }

  /** 任务真实结束前禁止关闭，取消仅发出请求，按钮状态由后端结果解除。 */
  function close() { if (!lifecycle.ownsActiveTask) onClose(); }

  return <Modal title={`${mode === 'import' ? text.importTitle : text.exportTitle} · ${database}.${table}`} wide onClose={close}>
    <div className="modal-content excel-transfer">
      <p className="info-strip">{mode === 'export' ? text.exportHelp : text.importLimits}</p>
      {mode === 'import' && <p className="info-strip">{text.importPolicy}</p>}
      {props.onBack && <button disabled={busy || loading} onClick={props.onBack}>{text.back}</button>}
      {mode === 'export' && <Field label={text.scope}><select aria-label={text.scope} disabled={busy} value={scope} onChange={event => { setScope(event.target.value as typeof scope); setDone(undefined); }}><option value="sample">{text.sample}</option><option value="all">{text.all}</option></select></Field>}
      {mode === 'export' && <p className="muted small">{text.limits}</p>}
      <button className="file-picker" disabled={busy || loading} onClick={() => void chooseFile()}><span><strong>{file?.name ?? (mode === 'import' ? text.chooseImport : text.chooseExport)}</strong><small>{text.fileHint}</small></span></button>
      {mode === 'import' && sheets.length > 0 && <div className="form-grid">
        <Field label={text.sheet}><select aria-label={text.sheet} value={sheetId} disabled={busy} onChange={event => setSheetId(event.target.value)}>{sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}{sheet.hidden ? text.hidden : ''}</option>)}</select></Field>
        <Field label={text.headerRow}><input type="number" aria-label={text.headerRow} min="1" max="1000" value={headerRow} disabled={busy} onChange={event => setHeaderRow(Number(event.target.value))}/></Field>
        <Field label={text.protocol}><select aria-label={text.protocol} value={protocol} disabled={busy} onChange={event => setProtocol(event.target.value as ExcelTextProtocol)}><option value="plain">{text.plain}</option><option value="dbark-v1">{text.dbark}</option></select></Field>
      </div>}
      {mode === 'import' && <p className="muted small">{protocol === 'plain' ? text.plainHelp : text.dbarkHelp}</p>}
      {loading && <Spinner text={text.loading}/>}
      {loading && <button onClick={() => { for (const id of readTasks.current) void services.cancel(id).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : text.error); }); }}>{text.cancel}</button>}
      {current && <><h3>{text.mapping}</h3><datalist id={targetListId}>{current.targets.map(column => <option key={column.name} value={column.name}/>)}</datalist><div className="mapping-grid">{current.mapping.slice(mappingPage * 50, (mappingPage + 1) * 50).map((item, index) => <div className="mapping-row" key={item.source}><span className="truncate">{item.source}</span><span aria-hidden="true">→</span><input list={targetListId} placeholder={text.skip} aria-label={text.mappingLabel.replace('{name}', item.source)} value={item.target} disabled={busy} onChange={event => {
        const target = event.target.value;
        setReady(previous => previous?.key === key ? { ...previous, mapping: previous.mapping.map((mapping, position) => position === mappingPage * 50 + index ? { ...mapping, target } : mapping) } : previous);
      }}/></div>)}</div>
        {current.mapping.length > 50 && <div className="excel-mapping-pages"><button disabled={busy || mappingPage === 0} onClick={() => setMappingPage(page => page - 1)}>{text.previous}</button><span>{text.mappingPage.replace('{page}', String(mappingPage + 1)).replace('{pages}', String(Math.ceil(current.mapping.length / 50)))}</span><button disabled={busy || (mappingPage + 1) * 50 >= current.mapping.length} onClick={() => setMappingPage(page => page + 1)}>{text.next}</button></div>}
        <h3>{text.preview}</h3>{current.sample.columns.length > 50 && <p className="muted small">{text.previewColumns}</p>}<div className="excel-preview"><table><thead><tr>{current.sample.columns.slice(0, 50).map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{current.sample.rows.map((row, index) => <tr key={index}>{current.sample.columns.slice(0, 50).map(column => <td key={column} title={showValue(row[column])}>{showValue(row[column]).slice(0, 300)}</td>)}</tr>)}</tbody></table></div>
        {!current.sample.rows.length && <p className="muted">{text.noRows}</p>}
        {current.sample.warnings.map(warning => <p className="muted small" key={warning}>{warning}</p>)}
      </>}
      {taskState.waitingForPrevious && <Spinner text={text.waitingForPrevious}/>}
      {busy && !taskState.waitingForPrevious && progress && <div className="transfer-progress"><span>{progress.message}</span><progress max="100" value={progress.progress}/></div>}
      {done !== undefined && <div className={failures.length ? 'error-box' : 'success-box'}>{text.completed.replace('{rows}', String(done))}</div>}
      <ErrorBox message={error || (taskState.cancellationError ? text.cancelFailed + taskState.cancellationError : '')}/>{failures.length > 0 && <details className="error-box"><summary>{text.failureCount}</summary><pre>{failures.join('\n')}</pre></details>}
    </div>
    <footer className="modal-footer"><button disabled={busy && lifecycle.ownsActiveTask} onClick={close}>{done === undefined ? text.close : text.done}</button><span className="grow"/>{busy ? <button disabled={!lifecycle.ownsActiveTask} onClick={() => void lifecycle.cancel()}>{text.cancel}</button> : <button className="primary" disabled={!file || loading || (mode === 'import' && !current) || done !== undefined} onClick={() => void execute()}>{mode === 'import' ? text.startImport : text.startExport}</button>}</footer>
  </Modal>;
}
