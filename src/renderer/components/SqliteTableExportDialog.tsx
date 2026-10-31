import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FileChoice, TaskEvent } from '../../shared/contracts';
import type { SqliteTableExportInput, SqliteTableExportOutput } from '../../shared/sqliteTableExport';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { SqliteTableExportIntent, checkSqliteTableExportOutput, selectSqliteExportColumns, type SqliteTableExportOptions } from '../sqliteTableExportUi';
import { errorMessage, invoke, uid } from '../lib';
import { sqliteTableExportZh as text } from '../locales/sqliteTableExport.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../locales/sqliteTableBrowse.zh-CN';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';

export interface SqliteTableExportServices {
  choose(input: { purpose: 'export'; format: SqliteTableExportInput['format']; suggestedName: string }): Promise<FileChoice | null>;
  execute(input: SqliteTableExportInput): Promise<SqliteTableExportOutput>; cancel(taskId: string): Promise<unknown>; subscribe(listener: (event: TaskEvent) => void): () => void;
}
/** 独立正式入口只经受限IPC，不借用当前页导出或旧全表传输的样本/字段目录。 */
export const sqliteTableExportServices: SqliteTableExportServices = {
  choose: input => invoke('files.choose', input), execute: input => invoke('sqlite.tableExport', input), cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark.onTask(listener),
};
interface Props { intent: SqliteTableExportIntent; services?: SqliteTableExportServices; onActivity(delta: 1 | -1): void; onClose(): void; onCleanupError(message: string): void; onCommitted?(result: SqliteTableExportOutput, sourceChanged: boolean, sqlContent?: SqliteTableExportInput['sqlContent']): void; }
type Draft = { format: SqliteTableExportInput['format']; encoding: SqliteTableExportInput['encoding']; csvDelimiter: CsvExportDelimiter; columns: string[]; dataColumns: string[]; sqlContent?: SqliteTableExportInput['sqlContent']; file?: FileChoice; problem?: string; done?: { output: SqliteTableExportOutput; changed: boolean } };
type Operation = { kind: 'choose' | 'export'; id?: string; cancelled: boolean; promise: Promise<void>; sent?: boolean; cancel?: Promise<void> };

/** 全量SQLite 文件导出与本地数据草稿分离，所有异步回包只归属于原意图和原操作。 */
export function SqliteTableExportDialog({ intent, services = sqliteTableExportServices, ...callbacks }: Props) {
  const owner = useRef({ intent, services, callbacks }).current;
  const [draft, setDraft] = useState<Draft>(() => { const columns = owner.intent.source.columns.map(column => column.name); return { format: 'csv', encoding: 'utf8', csvDelimiter: ',', columns, dataColumns: [...columns] }; }), live = useRef(draft); live.current = draft;
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
    if (active.sent) active.cancel = Promise.resolve().then(() => owner.services.cancel(active.id!)).then(() => undefined).catch(cleanup);
    if (mounted.current && !closed.current) replace({ ...live.current, problem: text.cancelling });
  }
  /** 配置变化消费当前草稿身份，并撤销原文件；不会自动选择文件或发起导出。 */
  function change(next: Omit<SqliteTableExportOptions, 'columns'> & { columns?: string[] }): void {
    if (!editable()) return;
    if (!['csv', 'json', 'sql', 'xlsx'].includes(next.format) || !['utf8', 'utf16le', 'gb18030'].includes(next.encoding)) return;
    const sqlContent = next.format === 'sql' ? next.sqlContent ?? (draft.format === 'sql' ? draft.sqlContent : owner.intent.source.target.kind === 'view' ? 'structure' : undefined) : undefined;
    if (sqlContent !== undefined && !['data', 'structure', 'structure-data'].includes(sqlContent)) return;
    if (next.format === 'sql' && owner.intent.source.target.kind !== 'table' && sqlContent !== 'structure') { replace({ ...draft, problem: text.viewSql }); return; }
    consumed.current = false; setProgress(undefined);
    const structure = next.format === 'sql' && sqlContent === 'structure', complete = next.format === 'sql' && sqlContent === 'structure-data';
    const wasStructure = draft.format === 'sql' && ['structure', 'structure-data'].includes(draft.sqlContent ?? 'data');
    // 结构模式不覆盖原字段草稿；结构及数据补齐所有非生成列，原有顺序可继续调整。
    let columns = [...(next.columns ?? (wasStructure && !structure && !complete ? draft.dataColumns : draft.columns))].filter(name => next.format !== 'sql' || !owner.intent.source.columns.find(column => column.name === name)?.generated);
    if (structure) columns = [];
    if (complete) {
      const required = owner.intent.source.columns.filter(column => !column.generated).map(column => column.name);
      columns = [...columns.filter(name => required.includes(name)), ...required.filter(name => !columns.includes(name))];
    }
    replace({ format: next.format, encoding: next.format === 'xlsx' ? 'utf8' : next.encoding, csvDelimiter: next.csvDelimiter ?? draft.csvDelimiter, columns, dataColumns: structure || complete ? [...draft.dataColumns] : [...columns], ...(sqlContent !== undefined ? { sqlContent } : {}) });
  }
  /** 字段与顺序同属原草稿租约；旧渲染回调及运行中的选择不能替换已确定的输出范围。 */
  function changeFields(columns: string[]): void { change({ format: draft.format, encoding: draft.encoding, csvDelimiter: draft.csvDelimiter, columns }); }
  function selectField(name: string, selected: boolean): void {
    if (draft.format === 'sql' && ['structure', 'structure-data'].includes(draft.sqlContent ?? 'data')) return;
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
    try { selectSqliteExportColumns(owner.intent.source, { format: draft.format, columns: draft.columns, ...(draft.format === 'sql' && draft.sqlContent !== undefined ? { sqlContent: draft.sqlContent } : {}) }); }
    catch (reason) { replace({ ...draft, problem: draft.columns.length ? errorMessage(reason) : text.emptyFields }); return; }
    try { owner.callbacks.onActivity(1); } catch (reason) { replace({ ...draft, file: undefined, problem: errorMessage(reason) }); return; }
    const previous = draft;
    const chosen = { ...draft, file: undefined, done: undefined, problem: undefined }; replace(chosen); setProgress(undefined);
    let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active) return;
      const file = await owner.services.choose({ purpose: 'export', format: chosen.format, suggestedName: `${owner.intent.source.target.table}-filtered.${chosen.format}` });
      if (!current() || operation.current !== active || live.current !== chosen) return;
      if (file) {
        if (typeof file.token !== 'string' || !file.token || typeof file.name !== 'string' || !file.name) throw Error(text.invalid);
        consumed.current = false; replace({ ...chosen, file, done: undefined, problem: undefined }); setProgress(undefined);
      } else {
        // 原生选择取消未改变准确来源和配置，保留原文件；新对象避免复活旧渲染闭包。
        replace({ ...previous });
      }
    }).catch(reason => { if (mounted.current && !closed.current && operation.current === active && !invalid.current) replace({ ...live.current, problem: errorMessage(reason) }); }).finally(() => {
      if (operation.current === active) operation.current = undefined;
      try { owner.callbacks.onActivity(-1); } catch (reason) { cleanup(reason); } if (mounted.current) setBusy(false);
    });
    active = { kind: 'choose', cancelled: false, promise }; operation.current = active; setBusy(true);
  }
  /** 原任务编号、文件能力与完整条件在首次await前固定；失败后需重新选文件，绝不自动重放。 */
  function execute(): void {
    if (!editable() || !draft.file || draft.done || consumed.current) return;
    let input: SqliteTableExportInput;
    try { input = owner.intent.input({ format: draft.format, encoding: draft.encoding, columns: draft.columns, ...(draft.format === 'csv' ? { csvDelimiter: draft.csvDelimiter } : {}), ...(draft.format === 'sql' && draft.sqlContent !== undefined ? { sqlContent: draft.sqlContent } : {}) }, draft.file.token, uid()); }
    catch (reason) { replace({ ...draft, problem: errorMessage(reason) }); return; }
    try { owner.callbacks.onActivity(1); } catch (reason) { replace({ ...draft, file: undefined, problem: errorMessage(reason) }); return; }
    consumed.current = true; const chosen = { ...draft, problem: undefined }; replace(chosen); setProgress(undefined);
    let active: Operation;
    const promise = Promise.resolve().then(async () => {
      if (!current() || operation.current !== active || active.cancelled) return;
      active.sent = true;
      const output = checkSqliteTableExportOutput(await owner.services.execute(input)), changed = !owner.intent.current() || invalid.current;
      // 完整落盘成功是既成事实；晚到取消或页面变化不能把它改称未执行或自动重试。
      if (mounted.current && operation.current === active && !closed.current) replace({ ...live.current, done: { output, changed }, problem: undefined });
      if (changed || closed.current || !mounted.current) { try { if (chosen.format === 'sql' && chosen.sqlContent !== undefined) owner.callbacks.onCommitted?.(output, changed, chosen.sqlContent); else owner.callbacks.onCommitted?.(output, changed); } catch (reason) { cleanup(reason); } }
    }).catch(reason => { if (mounted.current && !closed.current && operation.current === active) replace({ ...live.current, file: undefined, problem: errorMessage(reason) }); }).finally(async () => {
      // 两种结算顺序都要等：读取终结不能越过仍在等待的原取消ACK。
      if (active.cancel) await active.cancel;
      if (operation.current === active) operation.current = undefined;
      try { owner.callbacks.onActivity(-1); } catch (reason) { cleanup(reason); } if (mounted.current) setBusy(false);
    });
    active = { kind: 'export', id: input.taskId, cancelled: false, promise }; operation.current = active; setBusy(true);
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
  const structureOnly = draft.format === 'sql' && draft.sqlContent === 'structure', structureData = draft.format === 'sql' && draft.sqlContent === 'structure-data';
  const sqlUnavailable = draft.format === 'sql' && !structureOnly && (owner.intent.source.target.kind !== 'table' || !owner.intent.source.columns.some(column => !column.generated));
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" data-sqlite-table-export-dialog aria-busy={busy || closing}>
    <p>{owner.intent.source.target.database}.{owner.intent.source.target.table}</p><p>{structureOnly ? text.structureScope : text.scope}</p>{!structureOnly && <><p className="warning-text">{text.committedOnly}</p><p className="muted small">{text.protocolHint}</p></>}
    {structureOnly ? <p>{text.structureConditions}</p> : <><section aria-label={text.conditions}><strong>{text.conditions}</strong>{owner.intent.query.filters.length ? <ul>{owner.intent.query.filters.map((filter, index) => <li key={index}>{filter.column} {browseText.operators[filter.operator]} {filter.value ? '[' + browseText.kinds[filter.value.kind] + '] ' + filter.value.value : ''}</li>)}</ul> : <p>{text.noConditions}</p>}<p>{owner.intent.query.mode === 'and' ? 'AND' : 'OR'}</p></section>
    <section aria-label={text.sorts}><strong>{text.sorts}</strong>{owner.intent.query.sort.length ? <ol>{owner.intent.query.sort.map((rule, index) => <li key={index}>{rule.column} {rule.direction === 'asc' ? browseText.ascending : browseText.descending}</li>)}</ol> : <p>{text.noSorts}</p>}</section></>}
    <div className="form-grid"><Field label={text.format}><select aria-label={text.format} disabled={disabled} value={draft.format} onChange={event => change({ format: event.target.value as Draft['format'], encoding: draft.encoding, csvDelimiter: draft.csvDelimiter })}><option value="csv">CSV</option><option value="json">JSON</option><option value="sql">SQLite SQL</option><option value="xlsx">Excel（XLSX）</option></select></Field>
      {draft.format === 'sql' && <Field label={text.sqlContent}><select aria-label={text.sqlContent} disabled={disabled} value={draft.sqlContent ?? 'data'} onChange={event => change({ format: draft.format, encoding: draft.encoding, csvDelimiter: draft.csvDelimiter, sqlContent: event.target.value as SqliteTableExportInput['sqlContent'] })}>{Object.entries(text.sqlContents).map(([value, label]) => <option key={value} value={value} disabled={owner.intent.source.target.kind !== 'table' && value !== 'structure'}>{label}</option>)}</select></Field>}
      <Field label={text.encoding}><select aria-label={text.encoding} disabled={disabled || draft.format === 'xlsx'} value={draft.encoding} onChange={event => change({ format: draft.format, encoding: event.target.value as Draft['encoding'], csvDelimiter: draft.csvDelimiter })}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option></select></Field>{draft.format === 'csv' && <CsvExportDelimiterField value={draft.csvDelimiter} disabled={disabled} onChange={csvDelimiter => change({ format: draft.format, encoding: draft.encoding, csvDelimiter })}/>}</div>
    {draft.format === 'xlsx' && <UsageHelp><p>{text.xlsxEncoding}</p><p>{text.xlsxLimits}</p></UsageHelp>}{draft.format === 'sql' && <><p className="warning-text">{structureOnly ? text.structureSql : structureData ? text.structureDataSql : text.sqlScope}</p>{!structureOnly && <p className="muted small">{text.generatedHint}</p>}</>}{owner.intent.source.target.kind !== 'table' && <p className="muted small">{text.viewSql}</p>}
    {structureOnly ? <p>{text.structureNoFields}</p> : <section aria-label={text.fields}><strong>{text.fields}</strong><UsageHelp><p>{structureData ? text.structureDataFields : text.allFields}</p><p>{text.atomic}</p></UsageHelp>
      <button type="button" disabled={disabled || structureData} onClick={() => { if (!structureData) changeFields(owner.intent.source.columns.filter(column => draft.format !== 'sql' || !column.generated).map(column => column.name)); }}>{text.selectAllFields}</button><button type="button" disabled={disabled || structureData} onClick={() => { if (!structureData) changeFields([]); }}>{text.clearFields}</button>
      <div className="check-row">{owner.intent.source.columns.map(column => <label className="check" key={column.name}><input type="checkbox" aria-label={text.fieldLabel(column.name)} checked={draft.columns.includes(column.name)} disabled={disabled || structureData || draft.format === 'sql' && !!column.generated} onChange={event => selectField(column.name, event.target.checked)}/>{column.name} · {column.declaredType || browseText.dynamic}{column.generated ? ` · ${text.generated}` : ''}</label>)}</div>
      <ol aria-label={text.fieldOrder}>{draft.columns.map((name, position) => <li key={name}><span>{name}</span> <button type="button" aria-label={text.fieldUp(name)} disabled={disabled || position === 0} onClick={() => moveField(name, -1)}>{text.moveUp}</button> <button type="button" aria-label={text.fieldDown(name)} disabled={disabled || position + 1 === draft.columns.length} onClick={() => moveField(name, 1)}>{text.moveDown}</button></li>)}</ol>
      {!draft.columns.length && <p className="warning-text">{text.emptyFields}</p>}
    </section>}
    <button className="file-picker" aria-label={text.choose} disabled={disabled || sqlUnavailable || !structureOnly && !draft.columns.length} onClick={choose}>{draft.file ? `${text.chooseAgain}：${draft.file.name}` : text.choose}</button>
    {!draft.file && !draft.done && <p className="muted small">{text.fileRequired}</p>}
    {busy && <Spinner text={active?.kind === 'choose' ? text.choosing : structureOnly ? text.structureRunning : text.running}/>} {closing && <p>{text.closing}</p>}
    {progress && <div className="transfer-progress"><span>{progress.message}</span><progress value={progress.progress} max={100}/></div>}
    {draft.done && <div className="success-box">{structureOnly ? draft.done.changed ? text.structureCommittedChanged : text.structureCompleted : draft.done.changed ? text.committedChanged(draft.done.output.rows) : text.completed(draft.done.output.rows)}</div>}
    <ErrorBox message={draft.done ? undefined : sqlUnavailable ? owner.intent.source.target.kind !== 'table' ? text.viewSql : text.noSqlFields : stale || !valid ? text.stale : draft.problem}/>
  </div><footer className="modal-footer"><button aria-label={text.close} disabled={closing} onClick={close}>{draft.done ? text.done : text.close}</button><span className="grow"/>{busy && active?.kind === 'export' && <button aria-label={text.stop} disabled={closing || active.cancelled} onClick={() => { if (committed.current === ticket) cancel(active); }}>{text.cancel}</button>}<button className="primary" aria-label={text.start} disabled={disabled || !draft.file || !!draft.done || consumed.current || sqlUnavailable || !structureOnly && !draft.columns.length} onClick={execute}>{text.start}</button></footer></Modal>;
}
