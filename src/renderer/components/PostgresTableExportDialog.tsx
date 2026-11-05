import { useRef, useState } from 'react';
import type { FileChoice } from '../../shared/contracts';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { isPostgresSqlExportColumn, isPostgresSqlExportRelation, postgresTableExportExtension,
  type PostgresTableExportInput, type PostgresTablePage, type PostgresTableTarget } from '../../shared/postgresTable';
import { postgresRelationName } from '../../shared/postgresSql';
import { errorMessage, invoke } from '../lib';
import { postgresTableExportZh as text } from '../locales/postgresTableExport.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal } from './ui';

const formats = ['csv', 'json', 'xlsx', 'sql', 'copy'] as const;
const encodings = [['utf8', 'UTF-8'], ['utf16le', 'UTF-16 LE'], ['gb18030', 'GB18030']] as const;

/** 文件选择、列和任务只对应打开时的原服务端表页。 */
export function PostgresTableExportDialog({ target, page, filtered, isCurrent, onClose }: {
  target: PostgresTableTarget; page: PostgresTablePage; filtered: boolean; isCurrent(): boolean; onClose(): void;
}) {
  const [format, setFormat] = useState<PostgresTableExportInput['format']>('csv');
  const [encoding, setEncoding] = useState<PostgresTableExportInput['encoding']>('utf8');
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [selected, setSelected] = useState(() => new Set(page.columns.map(column => column.key)));
  const [file, setFile] = useState<FileChoice | null>(null);
  const [busy, setBusy] = useState(false), [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const occupied = useRef(false), cancelRequested = useRef(false);
  const available = format === 'sql' ? page.columns.filter(isPostgresSqlExportColumn) : page.columns;
  const output = available.filter(column => selected.has(column.key));
  const textEncoding = format === 'csv' || format === 'json';
  const extension = postgresTableExportExtension(format);

  /** 原生选择器只返回当前窗口一次性文件能力。 */
  async function choose() {
    if (occupied.current) return;
    occupied.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!isCurrent()) throw Error(text.stale);
      const name = postgresRelationName(target.table).name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 160) || 'postgresql';
      setFile(await invoke('postgres.table.exportChoose', { format, suggestedName: name + '.' + extension }));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setBusy(false); }
  }

  /** 仅文件原子发布回执显示成功，取消请求等待原任务自己的终态。 */
  async function start() {
    if (occupied.current || !file || !page.exportToken || !output.length) return;
    if (!isCurrent()) { setError(text.stale); return; }
    occupied.current = true;
    cancelRequested.current = false;
    const taskId = crypto.randomUUID();
    const job = acquireWorkspaceBusy(target.tabId);
    setTaskId(taskId);
    setFile(null);
    setError('');
    setMessage('');
    try {
      const result = await invoke('postgres.table.export', { ...target, taskId, exportToken: page.exportToken, fileToken: file.token,
        format, encoding: textEncoding ? encoding : 'utf8', columns: output.map(column => column.key),
        ...(extension === 'csv' ? { csvDelimiter: delimiter } : {}),
      });
      if (!result.fileCommitted) throw Error(text.cancelled);
      setMessage(text.saved(result.rows));
    } catch (reason) { setError(cancelRequested.current ? text.cancelled : errorMessage(reason)); }
    finally {
      setTaskId(undefined);
      setCancelling(false);
      occupied.current = false;
      job.release();
    }
  }

  /** 通过已有任务通道发出取消请求，保留原导出窗口直到终态。 */
  async function cancel() {
    if (!taskId || cancelRequested.current) return;
    cancelRequested.current = true;
    setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  const locked = busy || !!taskId;
  return <Modal title={text.title} onClose={() => { if (!occupied.current) onClose(); }}>
    <div className="modal-content pg-table-export">
      <p><strong>{target.table}</strong> · {text.source} · {filtered ? text.filtered : text.all}</p>
      <p>{text.note}</p>
      <div className="pg-table-controls">
        <Field label={text.format}><select aria-label={text.format} value={format} disabled={locked}
          onChange={event => { setFormat(event.target.value as typeof format); setFile(null); setMessage(''); }}>
          {formats.map(value => <option key={value} value={value} disabled={value === 'sql' && !isPostgresSqlExportRelation(page.relationKind)}>
            {value === 'copy' ? text.copyFormat : value.toUpperCase()}
          </option>)}
        </select></Field>
        {textEncoding && <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} disabled={locked}
          onChange={event => setEncoding(event.target.value as typeof encoding)}>
          {encodings.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></Field>}
        {extension === 'csv' && <CsvExportDelimiterField value={delimiter} disabled={locked} onChange={setDelimiter}/>}
      </div>
      {format === 'sql' && <p>{text.sqlHint}</p>}
      {format === 'copy' && <p>{text.copyHint}</p>}
      <fieldset disabled={locked}>
        <legend>{text.columns}</legend>
        <button onClick={() => setSelected(new Set(available.map(column => column.key)))}>{text.allColumns}</button>
        <button onClick={() => setSelected(new Set())}>{text.noColumns}</button>
        <div className="pg-table-export-columns">{page.columns.map(column => {
          const eligible = format !== 'sql' || isPostgresSqlExportColumn(column);
          return <label key={column.key}>
          <input type="checkbox" disabled={!eligible} checked={eligible && selected.has(column.key)} onChange={event => {
            const next = new Set(selected);
            if (event.target.checked) next.add(column.key); else next.delete(column.key);
            setSelected(next);
          }}/> {column.name}{!eligible && ' · ' + text.generated}
        </label>; })}</div>
      </fieldset>
      <button disabled={locked} onClick={() => void choose()}>{text.choose}</button>
      {file && <p>{text.file} · {file.name}</p>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.progress}</p>}
      {message && <p role="status">{message}</p>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked} onClick={onClose}>{text.close}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !file || !output.length} onClick={() => void start()}>{text.start}</button>}
    </footer>
  </Modal>;
}
