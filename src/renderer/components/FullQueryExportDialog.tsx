import { useEffect, useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import { csvExportOptions, type CsvExportDelimiter } from '../../shared/csvExport';
import { postgresExportParameterNames, type PostgresQueryExportInput } from '../../shared/postgresQueryExport';
import { sqliteQueryInsertTargetSchema, type SqliteQueryExportInput } from '../../shared/sqliteQueryExport';
import type { QueryParameter } from '../../shared/queryParameters';
import { acquireWorkspaceBusy, useWorkspace } from '../store';
import { errorMessage, invoke, uid } from '../lib';
import { zh } from '../locales/zh-CN';
import { postgresQueryExportZh } from '../locales/postgresQueryExport.zh-CN';
import { sqliteQueryExportZh } from '../locales/sqliteQueryExport.zh-CN';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal } from './ui';
import { QueryParametersDialog } from './QueryParametersDialog';
import { postgresZh } from '../locales/postgres.zh-CN';

export interface FullQueryExportSource {
  dialect?: 'sqlite';
  fromCurrentStatement?: boolean;
  tabId: string; connectionId: string; database: string; sql: string;
  current(): boolean;
}

/** 文件授权与实际导出各持有当前来源，变更格式或执行一次后需重新选择文件。 */
export function FullQueryExportDialog({source, onClose}: {source: FullQueryExportSource; onClose(): void}) {
  const sqlite = source.dialect === 'sqlite';
  const text = sqlite ? sqliteQueryExportZh : postgresQueryExportZh;
  const [format, setFormat] = useState<SqliteQueryExportInput['format']>('csv');
  const [insertDatabase, setInsertDatabase] = useState('main'), [insertTable, setInsertTable] = useState(''), [insertColumns, setInsertColumns] = useState('');
  const insert = sqlite && format === 'sql', fixedEncoding = insert || format === 'xlsx';
  const [encoding, setEncoding] = useState<PostgresQueryExportInput['encoding']>('utf8');
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [parameters, setParameters] = useState<QueryParameter[]>(), [editingParameters, setEditingParameters] = useState(false);
  const target = insert ? sqliteQueryInsertTargetSchema.safeParse({database: insertDatabase, table: insertTable,
    ...(insertColumns ? {columns: insertColumns.replace(/\r?\n$/, '').split(/\r?\n/)} : {})}) : undefined;
  const invalidTarget = target?.success === false;
  const [file, setFile] = useState<FileChoice | null>(null);
  const [pending, setPending] = useState<'pick' | 'write' | null>(null);
  const [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [rows, setRows] = useState<number>(), [stale, setStale] = useState(false), [cancelling, setCancelling] = useState(false);
  const alive = useRef(true), picking = useRef(false), invalid = useRef(false), task = useRef<string | undefined>(undefined);
  const current = () => alive.current && !invalid.current && source.current();
  useEffect(() => {
    alive.current = true;
    const stop = useWorkspace.subscribe(() => {
      if (!source.current()) { invalid.current = true; setStale(true); }
    });
    const unlisten = window.dbark.onTask(event => { if (event.taskId === task.current && event.status === 'running') setProgress(event.message); });
    return () => {
      alive.current = false;
      stop(); unlisten();
      if (task.current) void invoke('query.cancel', {taskId: task.current}).catch(() => {});
    };
  }, [source]);

  async function choose() {
    if (picking.current || task.current || !current() || invalidTarget) return;
    picking.current = true;
    setPending('pick'); setFile(null); setError(''); setRows(undefined);
    try {
      const selected = await invoke('files.choose', {purpose: 'export', format, suggestedName: `${text.suggestedName}.${format}`});
      if (!current()) throw Error(text.changed);
      setFile(selected);
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { picking.current = false; if (alive.current) setPending(null); }
  }

  async function run() {
    if (!file || picking.current || task.current || !current() || invalidTarget) return;
    const taskId = uid();
    task.current = taskId;
    let job: ReturnType<typeof acquireWorkspaceBusy> | undefined;
    setPending('write'); setError(''); setProgress(text.running); setRows(undefined); setFile(null);
    try {
      job = acquireWorkspaceBusy(source.tabId);
      if (!current()) throw Error(text.changed);
      const input = {connectionId: source.connectionId, sql: source.sql, taskId, fileToken: file.token,
        encoding: fixedEncoding ? 'utf8' as const : encoding, ...csvExportOptions(format, delimiter), ...(parameters ? {parameters} : {})};
      const result = sqlite ? await invoke('sqlite.queryExport', {...input, format, ...(target?.success ? {insertTarget: target.data} : {})})
        : format !== 'sql' ? await invoke('postgres.query.export', {...input, format, database: source.database}) : undefined;
      if (!result) throw Error(text.changed);
      if (alive.current) setRows(result.rows);
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally {
      task.current = undefined; job?.release();
      if (alive.current) { setPending(null); setCancelling(false); }
    }
  }

  async function cancel() {
    if (!task.current || cancelling) return;
    setCancelling(true);
    try { await invoke('query.cancel', {taskId: task.current}); }
    catch (reason) { if (alive.current) { setError(errorMessage(reason)); setCancelling(false); } }
  }

  if (editingParameters) return <QueryParametersDialog source={source.sql} syntaxHint={sqlite ? sqliteQueryExportZh.parameterHint : postgresZh.parameterHint}
    initialParameters={parameters} submitLabel={text.applyParameters}
    loadNames={() => sqlite ? invoke('sqlite.queryExportParameterNames', {sql: source.sql}) : Promise.resolve(postgresExportParameterNames(source.sql))}
    onClose={() => setEditingParameters(false)} onExecute={values => {
      if (!current()) throw Error(text.changed);
      setParameters(values.map(value => ({...value}))); setFile(null); setRows(undefined); setEditingParameters(false);
    }} />;

  return <Modal title={text.title} wide onClose={() => { if (!picking.current && !task.current) onClose(); }}>
    <div className="modal-content">
      <p>{source.database} · {text.scope}</p>
      {source.fromCurrentStatement && <p className="muted small">{text.currentSource}</p>}
      <pre className="result-sql-preview" aria-label={text.source}>{source.sql.slice(0, 4000)}</pre>
      {source.sql.length > 4000 && <p>{text.sourcePrefix}</p>}
      <button disabled={!!pending || stale} onClick={() => setEditingParameters(true)}>{text.parameters}</button>
      {parameters && <p>{text.parameterCount(parameters.length)}</p>}
      <Field label={zh.resultExport.format}><select aria-label={zh.resultExport.format} value={format} disabled={!!pending}
        onChange={event => { const value = event.target.value; if (value === 'csv' || value === 'json' || value === 'xlsx' || sqlite && value === 'sql') setFormat(value); setFile(null); setRows(undefined); }}>
        <option value="csv">CSV</option><option value="json">JSON</option><option value="xlsx">Excel (.xlsx)</option>{sqlite && <option value="sql">{sqliteQueryExportZh.insertFormat}</option>}
      </select></Field>
      {sqlite && format === 'json' && <p>{sqliteQueryExportZh.formatHint}</p>}
      <Field label={zh.resultExport.encoding}><select aria-label={zh.resultExport.encoding} value={fixedEncoding ? 'utf8' : encoding} disabled={!!pending || fixedEncoding}
        onChange={event => { const value = event.target.value; if (value === 'utf8' || value === 'utf16le' || value === 'gb18030') setEncoding(value); }}>
        <option value="utf8">UTF-8</option><option value="utf16le">UTF-16LE</option><option value="gb18030">GB18030</option>
      </select></Field>
      {insert && <>
        <p>{sqliteQueryExportZh.insertHint}</p>
        <Field label={sqliteQueryExportZh.insertDatabase}><input disabled={!!pending} value={insertDatabase} maxLength={256}
          onChange={event => { setInsertDatabase(event.target.value); setFile(null); setRows(undefined); }}/></Field>
        <Field label={sqliteQueryExportZh.insertTable}><input disabled={!!pending} value={insertTable} maxLength={256}
          onChange={event => { setInsertTable(event.target.value); setFile(null); setRows(undefined); }}/></Field>
        <Field label={sqliteQueryExportZh.insertColumns}><textarea disabled={!!pending} value={insertColumns} rows={3} maxLength={263168}
          onChange={event => { setInsertColumns(event.target.value); setFile(null); setRows(undefined); }}/></Field>
      </>}
      {format === 'csv' && <CsvExportDelimiterField value={delimiter} disabled={!!pending} onChange={setDelimiter}/>}
      <button disabled={!!pending || stale || invalidTarget} onClick={() => void choose()}>{file?.name ?? zh.resultExport.chooseFile}</button>
      {pending === 'write' && <p role="status">{cancelling ? text.cancelling : progress}</p>}
      {rows !== undefined && <div role="status" className="success-box">{text.done(rows)}</div>}
      <ErrorBox message={error || (stale ? text.changed : insertTable && target?.success === false ? target.error.issues[0]?.message ?? '' : '')}/>
    </div>
    <footer className="modal-footer">
      {pending === 'write' && <button disabled={cancelling} onClick={() => void cancel()}>{zh.common.cancel}</button>}
      <button disabled={!!pending} onClick={onClose}>{zh.common.close}</button>
      <button className="primary" disabled={!!pending || !file || stale || invalidTarget} onClick={() => void run()}>{text.start}</button>
    </footer>
  </Modal>;
}
