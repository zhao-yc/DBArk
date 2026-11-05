import { useRef, useState } from 'react';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { isPostgresSqlExportColumn, type PostgresTableImportChoice, type PostgresTablePage, type PostgresTableTarget } from '../../shared/postgresTable';
import { errorMessage, invoke } from '../lib';
import { postgresTableImportZh as text } from '../locales/postgresTableImport.zh-CN';
import { csvImportHeaderZh } from '../locales/csvImportHeader.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Modal } from './ui';

/** 显示原文件的样本和列映射，只在用户确认后申请一次性导入。 */
export function PostgresTableImportDialog({ target, page, isCurrent, onClose, onOutcome }: {
  target: PostgresTableTarget; page: PostgresTablePage; isCurrent(): boolean; onClose(): void;
  onOutcome(message: string, committed: boolean): void;
}) {
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [file, setFile] = useState<PostgresTableImportChoice | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false), [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false), cancelRequested = useRef(false);
  const candidates = page.columns.filter(isPostgresSqlExportColumn);
  const locked = choosing || !!taskId;
  const mapped = !!file && mapping.length === file.header.length && mapping.every(Boolean) && new Set(mapping).size === mapping.length;
  const previewHeaders = file?.header.slice(0, file.sample[0]?.length ?? 0) ?? [];

  /** 首行解释或分隔符变化后，旧样本及映射必须重新检查。 */
  function resetSource() {
    setFile(null); setMapping([]); setError('');
  }

  /** 预填准确同名字段，余下字段留给用户映射。 */
  async function choose() {
    if (occupied.current || !page.exportToken) return;
    occupied.current = true;
    setChoosing(true); resetSource();
    try {
      if (!isCurrent()) throw Error(text.stale);
      const selected = await invoke('postgres.table.importChoose', { ...target, pageToken: page.exportToken, csvDelimiter: delimiter, csvHasHeader: hasHeader });
      if (!isCurrent()) throw Error(text.stale);
      const assigned = new Set<string>();
      setMapping(selected?.header.map(name => {
        const key = hasHeader ? candidates.find(column => column.name === name)?.key : undefined;
        if (!key || assigned.has(key)) return '';
        assigned.add(key);
        return key;
      }) ?? []);
      setFile(selected);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }

  /** 提交期间保护标签，结束后由表页接管回执和刷新。 */
  async function start() {
    if (occupied.current || !file || !page.exportToken || !mapped) return;
    if (!isCurrent()) { setError(text.stale); return; }
    const id = crypto.randomUUID(), lease = acquireWorkspaceBusy(target.tabId);
    occupied.current = true; cancelRequested.current = false;
    setTaskId(id); setError('');
    let message: string, committed = false;
    try {
      const outcome = await invoke('postgres.table.import', { ...target, pageToken: page.exportToken, fileToken: file.token, taskId: id, columns: mapping });
      committed = outcome.outcome === 'committed';
      message = outcome.message;
    } catch (reason) { message = text.unknown + ' ' + errorMessage(reason); }
    finally { occupied.current = false; lease.release(); }
    onOutcome(message, committed);
  }

  /** 取消只请求一次，仍由正在运行的事务给出最终回执。 */
  async function cancel() {
    if (!taskId || cancelRequested.current) return;
    cancelRequested.current = true; setCancelling(true);
    try { await invoke('query.cancel', { taskId }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={text.title} onClose={() => { if (!occupied.current) onClose(); }}>
    <div className="modal-content pg-table-export">
      <p><strong>{target.table}</strong> · {target.database}</p>
      <p>{text.note}</p>
      <p>{text.nullNote}</p>
      <div className="pg-table-controls">
        <CsvExportDelimiterField value={delimiter} disabled={locked} label={text.delimiter} hint={text.delimiterHint} onChange={value => {
          setDelimiter(value); resetSource();
        }}/>
        <label className="check" title={hasHeader ? csvImportHeaderZh.hasHeaderHint : csvImportHeaderZh.noHeaderHint}>
          <input type="checkbox" checked={hasHeader} disabled={locked} onChange={event => {
            setHasHeader(event.target.checked); resetSource();
          }}/> {csvImportHeaderZh.label}
        </label>
        <button disabled={locked} onClick={() => void choose()}>{text.choose}</button>
      </div>
      {file && <>
        <p>{text.file} · {file.name} · {file.bytes.toLocaleString('zh-CN')} {text.bytes}</p>
        <fieldset disabled={locked}>
          <legend>{text.columns}</legend>
          {!hasHeader && file.header.length <= candidates.length && <button onClick={() => {
            setMapping(candidates.slice(0, file.header.length).map(column => column.key));
          }}>{text.position}</button>}
          <div className="pg-table-export-columns">
            {file.header.map((name, index) => <label key={index}>{index + 1}. {name || text.unnamed}
              <select aria-label={text.target(index)} value={mapping[index]} onChange={event => {
                setMapping(mapping.map((key, i) => i === index ? event.target.value : key));
              }}>
                <option value="">{text.select}</option>
                {candidates.map(column => <option key={column.key} value={column.key}
                  disabled={mapping.some((key, i) => i !== index && key === column.key)}>{column.name}</option>)}
              </select>
            </label>)}
          </div>
        </fieldset>
        <section aria-label={text.sample}>
          <p>{file.sampleLimited ? text.sampleLimited : file.sample.length ? text.sampleLimit : text.sampleEmpty}</p>
          {file.sample.length > 0 && <div className="pg-copy-import-sample">
            <table className="design-table" aria-label={text.sample}>
              <thead><tr>{previewHeaders.map((name, i) => <th scope="col" key={i}>{name || text.unnamed}</th>)}</tr></thead>
              <tbody>{file.sample.map((row, index) => <tr key={index}>
                {row.map((value, i) => <td key={i}>
                  {value === null ? <em>{text.nullValue}</em> : value === '' ? <em>{text.emptyValue}</em> : value}
                </td>)}
              </tr>)}</tbody>
            </table>
          </div>}
        </section>
      </>}
      {taskId && <p role="status">{cancelling ? text.cancelling : text.running}</p>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button disabled={locked} onClick={onClose}>{text.close}</button>
      {taskId ? <button disabled={cancelling} onClick={() => void cancel()}>{text.cancel}</button> :
        <button className="primary" disabled={locked || !mapped} onClick={() => void start()}>{text.confirm}</button>}
    </footer>
  </Modal>;
}
