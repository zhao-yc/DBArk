import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CellValue, FileChoice } from '../../shared/contracts';
import { excelImportZh, excelRowRangeMessage, excelRowRangeSchema, validateExcelMapping, type ExcelColumn, type ExcelFieldMapping, type ExcelRowRange, type ExcelSheet, type ExcelSheetPreview, type ExcelTextProtocol, type ExcelTransferProgress, type ExcelTransferServices, type ExcelTransferTarget } from '../../shared/excelTransfer';
import { excelTransferZh as text } from '../locales/excelTransfer.zh-CN';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';
import { ExcelRowRangeFields } from './ExcelImportFields';
import { ImportMappingActions } from './ImportMappingActions';
import { matchImportColumns } from '../importMapping';
import { ExcelTransferLifecycle, type ExcelTaskSnapshot } from '../excelTransferLifecycle';
import { ExcelPreviewTasks } from '../excelPreviewTasks';
import { importPresetConfigurationSchema, resolveImportPresetMapping, type ImportPresetConfiguration, type StoredImportPresetConfiguration } from '../../shared/importPresets';
import { ImportPresets } from './ImportPresets';
import { importPresetsZh as presetsText } from '../locales/importPresets.zh-CN';
import '../excelTransfer.css';

interface Props extends ExcelTransferTarget {
  mode: 'import' | 'export'; services: ExcelTransferServices; onClose(): void; onBack?(): void;
  progress?: ExcelTransferProgress; onTaskStart?(taskId: string): void;
}
interface ReadyPreview { key: string; revision: number; sample: ExcelSheetPreview; targets: ExcelColumn[]; mapping: ExcelFieldMapping[]; }
type WorkbookPreset = ImportPresetConfiguration & { format: 'xlsx'; excelOptions: NonNullable<ImportPresetConfiguration['excelOptions']> };

function isWorkbookPreset(value: StoredImportPresetConfiguration): value is WorkbookPreset {
  return 'mapping' in value && value.format === 'xlsx' && !!value.excelOptions;
}

/** 预览键绑定文件、工作表、行范围、协议和目标，迟到响应不能恢复旧映射。 */
export function excelPreviewKey(target: ExcelTransferTarget, fileToken: string, sheetId: string, protocol: ExcelTextProtocol,
  headerRow = 1, firstDataRow?: number, lastDataRow?: number): string {
  return JSON.stringify([target.connectionId, target.database, target.table, fileToken, sheetId, protocol, headerRow, firstDataRow, lastDataRow]);
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
  const [rowRange, setRowRange] = useState<ExcelRowRange>({ headerRow: 1 }), [scope, setScope] = useState<'sample' | 'all'>('sample');
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [done, setDone] = useState<number>(), [failures, setFailures] = useState<string[]>([]);
  const [preset, setPreset] = useState<WorkbookPreset>(), [presetBusy, setPresetBusy] = useState(false);
  const [lifecycle] = useState(() => new ExcelTransferLifecycle());
  const [taskState, setTaskState] = useState<ExcelTaskSnapshot>(lifecycle.snapshot);
  const busy = taskState.busy, contextKey = JSON.stringify([mode, connectionId, database, table]);
  const reservationKey = JSON.stringify([connectionId, database, table]);
  const [mappingPage, setMappingPage] = useState(0); const targetListId = useId();
  const choosing = useRef(false), generation = useRef(0), fileGeneration = useRef(0), mounted = useRef(true);
  const presetOperation = useRef(false), closing = useRef(false);
  const reads = useMemo(() => new ExcelPreviewTasks(id => services.cancel(id)), [services]);
  const { headerRow, firstDataRow, lastDataRow } = rowRange;
  const rangeValid = excelRowRangeSchema.safeParse(rowRange).success;
  const key = file && sheetId && rangeValid ? excelPreviewKey(props, file.token, sheetId, protocol, headerRow, firstDataRow, lastDataRow) : '';
  const current = ready?.key === key && ready.revision === generation.current ? ready : null;
  const locked = busy || presetBusy;

  /** 组件销毁或上下文改变后，所有旧文件与预览请求都失效。 */
  useLayoutEffect(() => { mounted.current = true; reads.activate(); return () => { mounted.current = false; generation.current++; fileGeneration.current++; void reads.dispose().catch(() => undefined); }; }, [reads]);
  useLayoutEffect(() => {
    lifecycle.attach(contextKey, setTaskState, reservationKey);
    fileGeneration.current++; generation.current++; setFile(null); setSheets([]); setSheetId(''); setReady(null); setDone(undefined); setFailures([]); setError(''); setLoading(false);
    setPreset(undefined);
    return () => { lifecycle.detach(); void reads.cancel().catch(() => undefined); };
  }, [lifecycle, contextKey, reservationKey, reads]);
  useEffect(() => {
    const revision = ++generation.current; setReady(null); setDone(undefined); setError(''); setMappingPage(0);
    if (mode !== 'import' || !file || !sheetId) return;
    if (!rangeValid) { setLoading(false); return; }
    setLoading(true);
    void reads.pair(taskId => services.preview({ fileToken: file.token, taskId, sheetId, ...rowRange, protocol }), taskId => services.targetColumns({ connectionId, database, table }, taskId)).then(([sample, targets]) => {
      if (!mounted.current || generation.current !== revision) return;
      const matched = preset
        ? resolveImportPresetMapping(preset, sample.columns, new Set(targets.map(column => column.name)))
        : matchImportColumns(headerRow === 0 ? 'clear' : 'name', sample.columns, targets).map(column => column?.name ?? '');
      if (!matched) { setError(presetsText.incompatible); return; }
      const mapping = sample.columns.map((source, index) => ({ source, target: matched[index] }));
      setReady({ key, revision, sample, targets, mapping });
    }, reason => { if (mounted.current && generation.current === revision) setError(reason instanceof Error ? reason.message : text.error); })
      .finally(() => { if (mounted.current && generation.current === revision) setLoading(false); });
    return () => { generation.current++; void reads.cancel().catch(() => undefined); };
  }, [mode, file?.token, sheetId, protocol, connectionId, database, table, services, key, reads, rowRange, rangeValid, headerRow, preset]);

  function presetCurrent(): boolean {
    return mounted.current && !closing.current && !choosing.current && !reads.busy && !lifecycle.busy;
  }

  function presetActivity(delta: 1 | -1): void {
    if (delta === 1 && (!presetCurrent() || presetOperation.current)) throw Error(presetsText.unavailable);
    presetOperation.current = delta === 1;
    if (mounted.current) setPresetBusy(presetOperation.current);
  }

  function capturePreset(): ImportPresetConfiguration {
    if (!current || current.revision !== generation.current) throw Error(presetsText.unavailable);
    validateExcelMapping(current.mapping.filter(item => item.target), current.sample.columns, current.targets.map(column => column.name));
    return importPresetConfigurationSchema.parse({
      format: 'xlsx', encoding: 'utf8', excelOptions: { ...rowRange, protocol }, columns: current.sample.columns,
      mapping: Object.fromEntries(current.mapping.map(({ source, target }) => [source, target])),
    });
  }

  /** 套用仅恢复读取设置，旧预览立即失效；本次工作簿和工作表均由用户选择。 */
  function applyPreset(value: StoredImportPresetConfiguration): boolean {
    if (!isWorkbookPreset(value) || !presetCurrent() || presetOperation.current) return false;
    const { protocol: savedProtocol, ...range } = value.excelOptions;
    generation.current++; fileGeneration.current++;
    setPreset(value); setRowRange(range); setProtocol(savedProtocol);
    setFile(null); setSheets([]); setSheetId(''); setReady(null); setDone(undefined); setFailures([]); setError('');
    return true;
  }

  /** 手工改变读取规则时退出配置套用；换工作表仍使用同一组配置重新核验。 */
  function changeReadOptions(change: () => void, keepPreset = false): void {
    if (lifecycle.busy || presetOperation.current || closing.current || choosing.current) return;
    generation.current++; setReady(null);
    if (!keepPreset) setPreset(undefined);
    change();
  }

  /** 文件选择串行化，且校验响应仍属于本轮选择，避免快速点击或关闭导致状态回滚。 */
  async function chooseFile() {
    if (lifecycle.busy || choosing.current || presetOperation.current || closing.current) return;
    choosing.current = true;
    const revision = ++fileGeneration.current;
    try {
      const selected = await services.chooseFile(mode, `${table}.xlsx`);
      if (!selected || !mounted.current || revision !== fileGeneration.current) return;
      generation.current++; setReady(null); setError('');
      let available: ExcelSheet[] = [];
      if (mode === 'import') {
        // 目录读完才发布新文件，防止旧预览 effect 的清理取消新文件的目录请求。
        setLoading(true); available = await reads.single(taskId => services.listSheets(selected.token, taskId));
        if (!mounted.current || revision !== fileGeneration.current) return;
      }
      setFile(selected); setSheets(available); setSheetId(preset ? '' : available[0]?.id ?? '');
      setDone(undefined); setFailures([]);
    } catch (reason) { if (mounted.current && revision === fileGeneration.current) setError(reason instanceof Error ? reason.message : text.error); }
    finally { choosing.current = false; if (mounted.current && revision === fileGeneration.current) setLoading(false); }
  }

  /** 同步锁覆盖双击；提交前重新检查就绪预览键、唯一映射以及当前目标列。 */
  async function execute() {
    if (!file || lifecycle.busy || presetOperation.current || closing.current || choosing.current || done !== undefined) return;
    if (mode === 'import' && (!current || current.revision !== generation.current)) { setError(text.pendingPreview); return; }
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
        : submittedServices.importTable({ ...target, sheetId, ...rowRange, protocol, mapping, fingerprint: current!.sample.fingerprint }),
      success: result => { setDone(result.rows); setFailures(result.errors); },
      failure: reason => setError(reason instanceof Error ? reason.message : text.error),
    });
  }

  /** 任务真实结束前禁止关闭，取消仅发出请求，按钮状态由后端结果解除。 */
  async function close() {
    if (lifecycle.ownsActiveTask || presetOperation.current || closing.current) return;
    closing.current = true;
    setLoading(true); generation.current++; const revision = ++fileGeneration.current;
    try { await reads.cancel(); if (mounted.current && revision === fileGeneration.current) onClose(); }
    catch (reason) { if (mounted.current && revision === fileGeneration.current) setError(reason instanceof Error ? reason.message : text.error); }
    finally { closing.current = false; if (mounted.current && revision === fileGeneration.current) setLoading(false); }
  }

  let canSavePreset = false;
  if (current) { try { capturePreset(); canSavePreset = true; } catch { /* 仍可逐列修正当前映射。 */ } }
  return <Modal title={`${mode === 'import' ? text.importTitle : text.exportTitle} · ${database}.${table}`} wide onClose={close}>
    <div className="modal-content excel-transfer">
      {mode === 'export' && <p className="info-strip">{text.exportScope}</p>}<UsageHelp><p>{mode === 'export' ? text.exportHelp : text.importLimits}</p>{mode === 'export' ? <p>{text.limits}</p> : <p>{protocol === 'plain' ? text.plainHelp : text.dbarkHelp}</p>}</UsageHelp>
      {mode === 'import' && <p className="info-strip">{text.importPolicy}</p>}
      {props.onBack && <button disabled={locked || loading} onClick={() => { if (presetCurrent() && !presetOperation.current) props.onBack?.(); }}>{text.back}</button>}
      {mode === 'export' && <Field label={text.scope}><select aria-label={text.scope} disabled={busy} value={scope} onChange={event => { setScope(event.target.value as typeof scope); setDone(undefined); }}><option value="sample">{text.sample}</option><option value="all">{text.all}</option></select></Field>}
      {mode === 'import' && <details><summary>{presetsText.title}</summary>
        <ImportPresets source={JSON.stringify([contextKey, key, ready?.revision, ready?.mapping, preset])}
          busy={busy || loading} canSave={canSavePreset} isCurrent={presetCurrent} supports={isWorkbookPreset}
          applyHint={presetsText.workbookApplyHint} capture={capturePreset} onApply={applyPreset} onActivity={presetActivity}/>
      </details>}
      {preset && <div className="check-row">
        {!error && <span role="status">{current ? presetsText.applied : presetsText.chooseNewSheet}</span>}
        <button type="button" disabled={locked} onClick={() => changeReadOptions(() => {})}>{presetsText.cancelApply}</button>
      </div>}
      <button className="file-picker" title={text.fileHint} disabled={locked || loading} onClick={() => void chooseFile()}><span><strong>{file?.name ?? (mode === 'import' ? text.chooseImport : text.chooseExport)}</strong></span></button>
      {mode === 'import' && sheets.length > 0 && <div className="form-grid">
        <Field label={text.sheet}><select aria-label={text.sheet} value={sheetId} disabled={locked || choosing.current} onChange={event => {
          const value = event.target.value;
          if (value !== sheetId) changeReadOptions(() => setSheetId(value), true);
        }}><option value="" disabled>{text.chooseSheet}</option>{sheets.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.name}{sheet.hidden ? text.hidden : ''}</option>)}</select></Field>
        <ExcelRowRangeFields range={rowRange} headerLabel={text.headerRow} disabled={locked || choosing.current} onChange={range => changeReadOptions(() => setRowRange(range))}/>
        <Field label={text.protocol}><select aria-label={text.protocol} value={protocol} disabled={locked || choosing.current} onChange={event => {
          const value = event.target.value as ExcelTextProtocol;
          if (value !== protocol) changeReadOptions(() => setProtocol(value));
        }}><option value="plain">{text.plain}</option><option value="dbark-v1">{text.dbark}</option></select></Field>
      </div>}
      {mode === 'import' && sheets.length > 0 && <p className="muted small">{excelImportZh.rangeHint}</p>}
      {loading && <Spinner text={text.loading}/>}
      {loading && <button onClick={() => void reads.cancel().catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : text.error); })}>{text.cancel}</button>}
      {current && <><h3>{text.mapping}</h3>
        <ImportMappingActions disabled={locked || done !== undefined} onAction={action => {
          if (lifecycle.busy || presetOperation.current || current.revision !== generation.current || done !== undefined) return;
          const matches = matchImportColumns(action, current.sample.columns, current.targets);
          setReady(previous => previous?.key === key ? { ...previous, mapping: current.sample.columns.map((source, index) => ({
            source, target: matches[index]?.name ?? '',
          })) } : previous);
          setMappingPage(0);
          setError('');
        }}/>
        <datalist id={targetListId}>{current.targets.map(column => <option key={column.name} value={column.name}/>)}</datalist><div className="mapping-grid">{current.mapping.slice(mappingPage * 50, (mappingPage + 1) * 50).map((item, index) => <div className="mapping-row" key={item.source}><span className="truncate">{item.source}</span><span aria-hidden="true">→</span><input list={targetListId} placeholder={text.skip} aria-label={text.mappingLabel.replace('{name}', item.source)} value={item.target} disabled={locked} onChange={event => {
        if (presetOperation.current || current.revision !== generation.current) return;
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
      <ErrorBox message={error || (mode === 'import' && !rangeValid ? excelRowRangeMessage : '') || (taskState.cancellationError ? text.cancelFailed + taskState.cancellationError : '')}/>{failures.length > 0 && <details className="error-box"><summary>{text.failureCount}</summary><pre>{failures.join('\n')}</pre></details>}
    </div>
    <footer className="modal-footer"><button disabled={presetBusy || busy && lifecycle.ownsActiveTask} onClick={close}>{done === undefined ? text.close : text.done}</button><span className="grow"/>{busy ? <button disabled={!lifecycle.ownsActiveTask} onClick={() => void lifecycle.cancel()}>{text.cancel}</button> : <button className="primary" disabled={!file || loading || presetBusy || (mode === 'import' && !current?.mapping.some(item => item.target)) || done !== undefined} onClick={() => void execute()}>{mode === 'import' ? text.startImport : text.startExport}</button>}</footer>
  </Modal>;
}
