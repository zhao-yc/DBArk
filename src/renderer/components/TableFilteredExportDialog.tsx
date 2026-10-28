import { tableSortRuleSummary } from '../tableSort';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileChoice, TaskEvent } from '../../shared/contracts';
import { selectTableFilteredExportColumns, type TableFilteredExportInput, type TableFilteredExportOutput } from '../../shared/tableFilteredExport';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { TableFilteredExportIntent, checkTableFilteredExportOutput, type TableFilteredExportOptions } from '../tableFilteredExportUi';
import { filterRuleSummary } from '../tableFilters';
import { tableFilterGroupSummary } from '../tableFilterGroups';
import { errorMessage, invoke, uid } from '../lib';
import { tableFilteredExportZh as text } from '../locales/tableFilteredExport.zh-CN';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal, Spinner } from './ui';

export interface TableFilteredExportServices {
  choose(input: { purpose: 'export'; format: TableFilteredExportInput['format']; suggestedName: string }): Promise<FileChoice | null>;
  execute(input: TableFilteredExportInput): Promise<TableFilteredExportOutput>; cancel(taskId: string): Promise<unknown>; subscribe(listener: (event: TaskEvent) => void): () => void;
}
/** 独立正式入口只经受限IPC，不借用当前页导出或旧全表传输的样本/字段目录。 */
export const tableFilteredExportServices: TableFilteredExportServices = {
  choose: input => invoke('files.choose', input), execute: input => invoke('table.exportFiltered', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
interface Props { intent: TableFilteredExportIntent; services?: TableFilteredExportServices; onActivity(delta: 1 | -1): void; onClose(): void; onCleanupError(message: string): void; onCommitted?(result: TableFilteredExportOutput, sourceChanged: boolean): void; }
type Draft = { format: TableFilteredExportInput['format']; encoding: TableFilteredExportInput['encoding']; csvDelimiter: CsvExportDelimiter; columns: string[]; file?: FileChoice; problem?: string; done?: { output: TableFilteredExportOutput; changed: boolean } };
type Operation = { kind: 'choose' | 'export'; id?: string; cancelled: boolean; promise: Promise<void>; cancel?: Promise<void> };

/** 全量服务器导出与本地数据草稿分离，所有异步回包只归属于原意图和原操作。 */
export function TableFilteredExportDialog({ intent, services = tableFilteredExportServices, ...callbacks }: Props) {
  const owner = useRef({ intent, services, callbacks }).current;
  const [draft, setDraft] = useState<Draft>({ format: 'csv', encoding: 'utf8', csvDelimiter: ',', columns: owner.intent.source.columns.map(column => column.name) }), live = useRef(draft); live.current = draft;
  const [busy, setBusy] = useState(false), [closing, setClosing] = useState(false), [stale, setStale] = useState(false), [progress, setProgress] = useState<TaskEvent>();
  const mounted = useRef(true), closed = useRef(false), invalid = useRef(false), operation = useRef<Operation | undefined>(undefined), committed = useRef<object | undefined>(undefined), consumed = useRef(false);
  const ticket = {};
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  if (intent !== owner.intent || services !== owner.services) invalid.current = true;
  /** 原owner失效后永久撤销；渲染检查不写state，事件入口及时显示失效。 */
  function current(): boolean { if (!mounted.current || closed.current || invalid.current) return false; if (!owner.intent.current()) invalid.current = true; return !invalid.current && mounted.current && !closed.current; }
  function replace(value: Draft): void { live.current = value; setDraft(value); }
  function editable(): boolean {
    const okay = current() && !operation.current && committed.current === ticket && live.current === draft;
    if (!okay && invalid.current && mounted.current && !closed.current && live.current === draft) setStale(true);
    return okay;
  }
  /** 清理反馈不能抛出并替代原任务终结，失败也一直等待原IPC和取消Promise。 */
  function cleanup(reason: unknown): void { try { owner.callbacks.onCleanupError(errorMessage(reason)); } catch {} }
  /** 取消仅发一次；choose没有可取消数据库任务，只能等待原文件选择自然结束。 */
  function cancel(active = operation.current): void {
    if (!active || operation.current !== active || active.kind !== 'export' || active.cancelled || !active.id) return;
    active.cancelled = true;
    active.cancel = Promise.resolve().then(() => owner.services.cancel(active.id!)).then(() => undefined).catch(cleanup);
    if (mounted.current && !closed.current) replace({ ...live.current, problem: text.cancelling });
  }
  /** 配置变化消费当前草稿身份，并撤销原文件；不会自动选择文件或发起导出。 */
  function change(next: TableFilteredExportOptions): void {
    if (!editable()) return;
    if (!['csv', 'json', 'sql', 'xlsx'].includes(next.format) || !['utf8', 'utf16le', 'gb18030'].includes(next.encoding)) return;
    if (next.format === 'sql' && owner.intent.source.objectKind !== 'table') { replace({ ...draft, problem: text.viewSql }); return; }
    consumed.current = false; setProgress(undefined);
    // SQL只呈现可写入INSERT的选择；返回其它格式不偷偷补回此前取消的字段。
    const columns = [...(next.columns ?? draft.columns)].filter(name => next.format !== 'sql' || !owner.intent.source.columns.find(column => column.name === name)?.generated);
    replace({ format: next.format, encoding: next.format === 'xlsx' ? 'utf8' : next.encoding, csvDelimiter: next.csvDelimiter ?? draft.csvDelimiter, columns });
  }
  /** 字段与顺序同属原草稿租约；旧渲染回调及运行中的选择不能替换已确定的输出范围。 */
  function changeFields(columns: string[]): void { change({ format: draft.format, encoding: draft.encoding, csvDelimiter: draft.csvDelimiter, columns }); }
  function selectField(name: string, selected: boolean): void {
    const column = owner.intent.source.columns.find(column => column.name === name);
    if (!column || draft.format === 'sql' && column.generated || draft.columns.includes(name) === selected) return;
    changeFields(selected ? [...draft.columns, name] : draft.columns.filter(value => value !== name));
  }
  /** 仅交换相邻字段，保持全部已选名称和原物理字段身份，不改变父表排序或可见列。 */
  function moveField(name: string, delta: -1 | 1): void {
    const from = draft.columns.indexOf(name), to = from + delta;
    if (from < 0 || to < 0 || to >= draft.columns.length) return;
    const columns = [...draft.columns]; [columns[from], columns[to]] = [columns[to], columns[from]]; changeFields(columns);
  }
  /** 文件chooser等待期间父标签也保持占用，迟到文件令牌不会绑定新来源或新格式。 */
  function choose(): void {
    if (!editable()) return;
    try { selectTableFilteredExportColumns(owner.intent.source, { format: draft.format, columns: draft.columns }); }
    catch (reason) { replace({ ...draft, problem: draft.columns.length ? errorMessage(reason) : text.emptyFields }); return; }
    const chosen = draft;
    let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active) return;
      const file = await owner.services.choose({ purpose: 'export', format: chosen.format, suggestedName: `${owner.intent.target.table}-filtered.${chosen.format}` });
      if (!current() || operation.current !== active || live.current !== chosen) return;
      if (file) {
        if (typeof file.token !== 'string' || !file.token || typeof file.name !== 'string' || !file.name) throw Error(text.invalid);
        consumed.current = false; replace({ ...chosen, file, done: undefined, problem: undefined }); setProgress(undefined);
      }
    }).catch(reason => { if (mounted.current && !closed.current && operation.current === active && !invalid.current) replace({ ...live.current, problem: errorMessage(reason) }); }).finally(() => {
      if (operation.current === active) operation.current = undefined;
      owner.callbacks.onActivity(-1); if (mounted.current) setBusy(false);
    });
    active = { kind: 'choose', cancelled: false, promise }; operation.current = active; setBusy(true); owner.callbacks.onActivity(1);
  }
  /** 原任务编号、文件能力与完整条件在首次await前固定；失败后需重新选文件，绝不自动重放。 */
  function execute(): void {
    if (!editable() || !draft.file || draft.done || consumed.current) return;
    let input: TableFilteredExportInput;
    try { input = owner.intent.input({ format: draft.format, encoding: draft.encoding, columns: draft.columns, ...(draft.format === 'csv' ? { csvDelimiter: draft.csvDelimiter } : {}) }, draft.file.token, uid()); }
    catch (reason) { replace({ ...draft, problem: errorMessage(reason) }); return; }
    consumed.current = true; const chosen = { ...draft, problem: undefined }; replace(chosen); setProgress(undefined);
    let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active || active.cancelled) return;
      const output = checkTableFilteredExportOutput(await owner.services.execute(input)), changed = !owner.intent.current() || invalid.current;
      // 完整落盘成功是既成事实；晚到取消或页面变化不能把它改称未执行或自动重试。
      if (mounted.current && operation.current === active && !closed.current) replace({ ...live.current, done: { output, changed }, problem: undefined });
      if (changed || closed.current || !mounted.current) { try { owner.callbacks.onCommitted?.(output, changed); } catch (reason) { cleanup(reason); } }
    }).catch(reason => { if (mounted.current && !closed.current && operation.current === active) replace({ ...live.current, file: undefined, problem: errorMessage(reason) }); }).finally(async () => {
      // 两种结算顺序都要等：读取终结不能越过仍在等待的原取消ACK。
      if (active.cancel) await active.cancel;
      if (operation.current === active) operation.current = undefined;
      owner.callbacks.onActivity(-1); if (mounted.current) setBusy(false);
    });
    active = { kind: 'export', id: input.taskId, cancelled: false, promise }; operation.current = active; setBusy(true); owner.callbacks.onActivity(1);
  }
  /** 运行中关闭只请求取消并等待同一原操作，不能以取消ACK或任务事件代替原Promise。 */
  function close(): void {
    if (!mounted.current || closed.current || committed.current !== ticket || live.current !== draft) return;
    closed.current = true; setClosing(true); const active = operation.current; cancel(active);
    void (async () => { if (active) { await active.promise; await active.cancel; } if (mounted.current) owner.callbacks.onClose(); })();
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribeIntent = owner.intent.subscribe(() => { invalid.current = true; if (mounted.current) setStale(true); cancel(); });
    const unsubscribe = owner.services.subscribe(event => {
      const active = operation.current;
      if (!mounted.current || closed.current || active?.kind !== 'export' || event.taskId !== active.id) return;
      if (!owner.intent.current()) { invalid.current = true; setStale(true); cancel(active); }
      if (typeof event.progress === 'number' && Number.isFinite(event.progress) && event.progress >= 0 && event.progress <= 100 && typeof event.message === 'string') setProgress(event);
    });
    /** 覆盖正文和页脚，禁止后台执行或保存快捷键穿透；导出只接受明确按钮。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true);
    return () => { mounted.current = false; unsubscribeIntent(); unsubscribe(); cancel(); document.removeEventListener('keydown', block, true); };
  }, []);
  const valid = current(), active = operation.current, disabled = busy || closing || !valid;
  const sqlUnavailable = draft.format === 'sql' && (owner.intent.source.objectKind !== 'table' || !owner.intent.source.columns.some(column => !column.generated));
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" data-table-filtered-export-dialog aria-busy={busy || closing}>
    <p>{owner.intent.target.database}.{owner.intent.target.table}</p><p>{text.scope}</p><p className="warning-text">{text.committedOnly}</p>
    <section aria-label={text.conditions}><strong>{text.conditions}</strong>{owner.intent.conditions.filters.length ? <ul>{owner.intent.conditions.filters.map((filter, index) => <li key={index}>{filter.enabled === false ? text.disabled : ''}{filterRuleSummary(filter)}</li>)}</ul> : <p>{text.noConditions}</p>}{owner.intent.conditions.filterGroup && <p>{tableFilterGroupSummary(owner.intent.conditions.filterGroup)}</p>}</section>
    <section aria-label={text.sorts}><strong>{text.sorts}</strong>{owner.intent.sort.length ? <ol>{owner.intent.sort.map((rule, index) => <li key={index}>{tableSortRuleSummary(rule)}</li>)}</ol> : <p>{text.noSorts}</p>}</section>
    <div className="form-grid"><Field label={text.format}><select aria-label={text.format} disabled={disabled} value={draft.format} onChange={event => change({ format: event.target.value as Draft['format'], encoding: draft.encoding, csvDelimiter: draft.csvDelimiter })}><option value="csv">CSV</option><option value="json">JSON</option><option value="sql" disabled={owner.intent.source.objectKind !== 'table'}>INSERT SQL</option><option value="xlsx">Excel（XLSX）</option></select></Field>
      <Field label={text.encoding}><select aria-label={text.encoding} disabled={disabled || draft.format === 'xlsx'} value={draft.encoding} onChange={event => change({ format: draft.format, encoding: event.target.value as Draft['encoding'], csvDelimiter: draft.csvDelimiter })}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option></select></Field>{draft.format === 'csv' && <CsvExportDelimiterField value={draft.csvDelimiter} disabled={disabled} onChange={csvDelimiter => change({ format: draft.format, encoding: draft.encoding, csvDelimiter })}/>}</div>
    {draft.format === 'xlsx' && <><p>{text.xlsxEncoding}</p><p>{text.xlsxLimits}</p></>}{draft.format === 'sql' && <p className="warning-text">{text.sqlScope}</p>}{owner.intent.source.objectKind !== 'table' && <p className="muted small">{text.viewSql}</p>}
    <section aria-label={text.fields}><strong>{text.fields}</strong><p>{text.allFields}</p>
      <button type="button" disabled={disabled} onClick={() => changeFields(owner.intent.source.columns.filter(column => draft.format !== 'sql' || !column.generated).map(column => column.name))}>{text.selectAllFields}</button><button type="button" disabled={disabled} onClick={() => changeFields([])}>{text.clearFields}</button>
      <div className="check-row">{owner.intent.source.columns.map(column => <label className="check" key={column.name}><input type="checkbox" aria-label={text.fieldLabel(column.name)} checked={draft.columns.includes(column.name)} disabled={disabled || draft.format === 'sql' && !!column.generated} onChange={event => selectField(column.name, event.target.checked)}/>{column.name} · {column.type}{column.generated ? ` · ${text.generated}` : ''}</label>)}</div>
      <ol aria-label={text.fieldOrder}>{draft.columns.map((name, position) => <li key={name}><span>{name}</span> <button type="button" aria-label={text.fieldUp(name)} disabled={disabled || position === 0} onClick={() => moveField(name, -1)}>{text.moveUp}</button> <button type="button" aria-label={text.fieldDown(name)} disabled={disabled || position + 1 === draft.columns.length} onClick={() => moveField(name, 1)}>{text.moveDown}</button></li>)}</ol>
      {!draft.columns.length && <p className="warning-text">{text.emptyFields}</p>}
    </section>
    <button className="file-picker" disabled={disabled || sqlUnavailable || !draft.columns.length} onClick={choose}>{draft.file ? `${text.chooseAgain}：${draft.file.name}` : text.choose}</button><p className="muted small">{text.atomic}</p>
    {busy && <Spinner text={active?.kind === 'choose' ? text.choosing : text.running}/>} {closing && <p>{text.closing}</p>}
    {progress && <div className="transfer-progress"><span>{progress.message}</span><progress value={progress.progress} max={100}/></div>}
    {draft.done && <div className="success-box">{draft.done.changed ? text.committedChanged(draft.done.output.rows) : text.completed(draft.done.output.rows)}</div>}
    <ErrorBox message={sqlUnavailable ? owner.intent.source.objectKind !== 'table' ? text.viewSql : text.noSqlFields : stale || !valid ? text.stale : draft.problem}/>
  </div><footer className="modal-footer"><button disabled={closing} onClick={close}>{draft.done ? text.done : text.close}</button><span className="grow"/>{busy && active?.kind === 'export' && <button disabled={closing || active.cancelled} onClick={() => { if (committed.current === ticket) cancel(active); }}>{text.cancel}</button>}<button className="primary" disabled={disabled || !draft.file || !!draft.done || consumed.current || sqlUnavailable || !draft.columns.length} onClick={execute}>{text.start}</button></footer></Modal>;
}
