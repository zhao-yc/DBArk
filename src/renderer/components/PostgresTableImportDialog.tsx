import { useRef, useState } from 'react';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import { isPostgresSqlExportColumn, type PostgresTableImportChoice, type PostgresTablePage, type PostgresTableTarget } from '../../shared/postgresTable';
import { errorMessage, invoke } from '../lib';
import { postgresTableImportZh as text } from '../locales/postgresTableImport.zh-CN';
import { csvImportHeaderZh } from '../locales/csvImportHeader.zh-CN';
import { xmlImportOptionsSchema, xmlImportZh, type RecordImportFormat, type XmlImportOptions } from '../../shared/xmlImport';
import { importNewTableZh as newTableText } from '../locales/importNewTable.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { ErrorBox, Field, Modal } from './ui';

/** 显示原文件的样本和列映射，只在用户确认后申请一次性导入。 */
export function PostgresTableImportDialog({ target, page, initialSource, isCurrent, onClose, onOutcome }: {
  target: PostgresTableTarget; page: PostgresTablePage; isCurrent(): boolean; onClose(): void;
  initialSource?: { file: PostgresTableImportChoice; mapping: Record<string, string>; format: RecordImportFormat };
  onOutcome(message: string, committed: boolean): void;
}) {
  const [format, setFormat] = useState<RecordImportFormat>(initialSource?.format ?? 'csv');
  const [xmlOptions, setXmlOptions] = useState<XmlImportOptions>({ rowTag: 'RECORD', attributes: true, binaryBase64: false });
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [file, setFile] = useState<PostgresTableImportChoice | null>(initialSource?.file ?? null);
  const candidates = page.columns.filter(isPostgresSqlExportColumn);
  const [mapping, setMapping] = useState<string[]>(() => initialSource?.file.header.map(name =>
    candidates.find(column => column.name === initialSource.mapping[name])?.key ?? '') ?? []);
  const [choosing, setChoosing] = useState(false), [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false), cancelRequested = useRef(false);
  const locked = choosing || !!taskId;
  const records = !!initialSource || format === 'xml';
  const selectedKeys = mapping.filter(Boolean);
  const mapped = !!file && mapping.length === file.header.length && selectedKeys.length > 0 &&
    new Set(selectedKeys).size === selectedKeys.length && (records || selectedKeys.length === mapping.length);
  const validXml = format !== 'xml' || xmlImportOptionsSchema.safeParse(xmlOptions).success;
  const previewHeaders = file?.header.slice(0, file.sample[0]?.length ?? 0) ?? [];

  /** 首行解释或分隔符变化后，旧样本及映射必须重新检查。 */
  function resetSource() {
    setFile(null); setMapping([]); setError('');
  }

  /** 预填准确同名字段，余下字段留给用户映射。 */
  async function choose() {
    if (occupied.current || !page.exportToken || !validXml) return;
    occupied.current = true;
    setChoosing(true); resetSource();
    try {
      if (!isCurrent()) throw Error(text.stale);
      const selection = format === 'xml' ? { format, xmlOptions } : { csvDelimiter: delimiter, csvHasHeader: hasHeader };
      const selected = await invoke('postgres.table.importChoose', { ...target, pageToken: page.exportToken, ...selection });
      if (!isCurrent()) throw Error(text.stale);
      const assigned = new Set<string>();
      setMapping(selected?.header.map(name => {
        const key = format === 'xml' || hasHeader ? candidates.find(column => column.name === name)?.key : undefined;
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
      const selection = records ? { format, columns: mapping.map(key => key || null) } : { columns: mapping };
      const outcome = await invoke('postgres.table.import', { ...target, pageToken: page.exportToken, fileToken: file.token, taskId: id, ...selection });
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
      <p>{format === 'xml' ? xmlImportZh.hint : format === 'json' ? newTableText.postgresJson : initialSource ? newTableText.postgresCsv : text.nullNote}</p>
      {!initialSource && <><Field label={text.format}><select aria-label={text.format} value={format} disabled={locked} onChange={event => {
        setFormat(event.target.value as typeof format); resetSource();
      }}><option value="csv">CSV</option><option value="xml">XML</option></select></Field>
      <div className="pg-table-controls">
        {format === 'xml' ? <>
          <Field label={xmlImportZh.rowTag}><input aria-label={xmlImportZh.rowTag} value={xmlOptions.rowTag} maxLength={256} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, rowTag: event.target.value }); resetSource(); }}/></Field>
          <label className="check"><input type="checkbox" checked={xmlOptions.attributes} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, attributes: event.target.checked }); resetSource(); }}/> {xmlImportZh.attributes}</label>
          <label className="check"><input type="checkbox" checked={xmlOptions.binaryBase64} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, binaryBase64: event.target.checked }); resetSource(); }}/> {xmlImportZh.binary}</label>
        </> : <>
        <CsvExportDelimiterField value={delimiter} disabled={locked} label={text.delimiter} hint={text.delimiterHint} onChange={value => {
          setDelimiter(value); resetSource();
        }}/>
        <label className="check" title={hasHeader ? csvImportHeaderZh.hasHeaderHint : csvImportHeaderZh.noHeaderHint}>
          <input type="checkbox" checked={hasHeader} disabled={locked} onChange={event => {
            setHasHeader(event.target.checked); resetSource();
          }}/> {csvImportHeaderZh.label}
        </label>
        </>}
        <button disabled={locked || !validXml} onClick={() => void choose()}>{format === 'xml' ? text.chooseXml : text.choose}</button>
      </div>
      {!validXml && <ErrorBox message={xmlImportZh.invalid}/>}</>}
      {file && <>
        <p>{text.file} · {file.name} · {file.bytes.toLocaleString('zh-CN')} {text.bytes}</p>
        <fieldset disabled={locked}>
          <legend>{text.columns}</legend>
          {!records && !hasHeader && file.header.length <= candidates.length && <button onClick={() => {
            setMapping(candidates.slice(0, file.header.length).map(column => column.key));
          }}>{text.position}</button>}
          <div className="pg-table-export-columns">
            {file.header.map((name, index) => <label key={index}>{index + 1}. {name || text.unnamed}
              <select aria-label={text.target(index)} value={mapping[index]} onChange={event => {
                setMapping(mapping.map((key, i) => i === index ? event.target.value : key));
              }}>
                <option value="">{records ? text.skip : text.select}</option>
                {candidates.map(column => <option key={column.key} value={column.key}
                  disabled={mapping.some((key, i) => i !== index && key === column.key)}>{column.name}</option>)}
              </select>
            </label>)}
          </div>
        </fieldset>
        <section aria-label={text.sample}>
          <p>{file.sampleLimited ? records ? text.xmlSampleLimited : text.sampleLimited : file.sample.length ? text.sampleLimit : text.sampleEmpty}</p>
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
