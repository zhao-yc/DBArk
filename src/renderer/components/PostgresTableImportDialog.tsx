import { excelImportDefaults, excelImportOptionsSchema, excelImportZh } from '../../shared/excelTransfer';
import { ExcelImportFields } from './ExcelImportFields';
import type { FileChoice } from '../../shared/contracts';
import { useRef, useState } from 'react';
import type { CsvExportDelimiter } from '../../shared/csvExport';
import type { ImportFileReadOptions } from '../../shared/importNewTable';
import { txtImportDefaults, txtImportOptionsSchema, txtImportZh, type TxtImportOptions } from '../../shared/txtImport';
import { TxtImportFields } from './TxtImportFields';
import { isPostgresImportUpdateColumn, isPostgresSqlExportColumn, type PostgresImportConflict, type PostgresTableImportChoice, type PostgresTablePage, type PostgresTableTarget } from '../../shared/postgresTable';
import { errorMessage, invoke } from '../lib';
import { postgresTableImportZh as text } from '../locales/postgresTableImport.zh-CN';
import { fileImportConflictZh as conflictText } from '../locales/fileImportConflict.zh-CN';
import { csvImportHeaderZh } from '../locales/csvImportHeader.zh-CN';
import { xmlImportOptionsSchema, xmlImportZh, type RecordImportFormat, type XmlImportOptions } from '../../shared/xmlImport';
import { importNewTableZh as newTableText } from '../locales/importNewTable.zh-CN';
import { acquireWorkspaceBusy } from '../store';
import { CsvExportDelimiterField } from './CsvExportDelimiter';
import { XmlDocumentImportFields } from './XmlDocumentImportFields';
import { ErrorBox, Field, Modal, Spinner } from './ui';

/** 显示原文件的样本和列映射，只在用户确认后申请一次性导入。 */
export function PostgresTableImportDialog({ target, page, initialSource, isCurrent, onClose, onOutcome }: {
  target: PostgresTableTarget; page: PostgresTablePage; isCurrent(): boolean; onClose(): void;
  initialSource?: { file: PostgresTableImportChoice; mapping: Record<string, string>; format: RecordImportFormat; xmlOptions?: XmlImportOptions };
  onOutcome(message: string, committed: boolean): void;
}) {
  const [format, setFormat] = useState<RecordImportFormat>(initialSource?.format ?? 'csv');
  const [xmlOptions, setXmlOptions] = useState<XmlImportOptions>(initialSource?.xmlOptions ?? { rowTag: 'RECORD', attributes: true, binaryBase64: false });
  const [delimiter, setDelimiter] = useState<CsvExportDelimiter>(',');
  const [hasHeader, setHasHeader] = useState(true);
  const [encoding, setEncoding] = useState<ImportFileReadOptions['encoding']>('utf8');
  const [txtOptions, setTxtOptions] = useState<TxtImportOptions>(txtImportDefaults);
  const [workbook, setWorkbook] = useState<FileChoice | null>(null);
  const [excelOptions, setExcelOptions] = useState(excelImportDefaults);
  const validWorkbook = format !== 'xlsx' || !!workbook && excelImportOptionsSchema.safeParse(excelOptions).success;
  const [file, setFile] = useState<PostgresTableImportChoice | null>(initialSource?.file ?? null);
  const candidates = page.columns.filter(isPostgresSqlExportColumn);
  const [mapping, setMapping] = useState<string[]>(() => initialSource?.file.header.map(name =>
    candidates.find(column => column.name === initialSource.mapping[name])?.key ?? '') ?? []);
  const [mode, setMode] = useState<'insert' | PostgresImportConflict['mode']>('insert');
  const [keyId, setKeyId] = useState('');
  const [choosing, setChoosing] = useState(false), [taskId, setTaskId] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const occupied = useRef(false), cancelRequested = useRef(false);
  const locked = choosing || !!taskId;
  const records = !!initialSource || format !== 'csv';
  const selectedKeys = mapping.filter(Boolean);
  const mapped = !!file && mapping.length === file.header.length && selectedKeys.length > 0 &&
    new Set(selectedKeys).size === selectedKeys.length && (records || selectedKeys.length === mapping.length);
  const key = file?.conflictKeys?.find(value => value.id === keyId);
  const conflictError = mode === 'insert' ? '' : !key ? conflictText.noKey :
    key.columns.some(column => !selectedKeys.includes(column)) ? conflictText.unmapped :
      mode !== 'skip-existing' && !candidates.some(column => selectedKeys.includes(column.key) && isPostgresImportUpdateColumn(column, key)) ? conflictText.noUpdate : '';
  const validXml = format !== 'xml' || xmlImportOptionsSchema.safeParse(xmlOptions).success;
  const validTxt = format !== 'txt' || txtImportOptionsSchema.safeParse(txtOptions).success;
  const previewHeaders = file?.header.slice(0, file.sample[0]?.length ?? 0) ?? [];

  /** 文件解释变化后，旧样本、令牌和映射须一起撤下。 */
  function resetSource() {
    setFile(null); changeMapping([]); setError('');
  }

  /** 更换映射后撤下原策略，按键写入需要用户基于新映射重新选择。 */
  function changeMapping(next: string[]) {
    setMapping(next); setMode('insert'); setKeyId('');
  }

  async function chooseWorkbook() {
    if (initialSource || occupied.current || format !== 'xlsx') return;
    occupied.current = true; setChoosing(true);
    try {
      if (!isCurrent()) throw Error(text.stale);
      const selected = await invoke('files.choose', { purpose: 'import', format: 'xlsx' });
      if (!isCurrent()) throw Error(text.stale);
      if (selected) { setWorkbook(selected); setExcelOptions(excelImportDefaults); resetSource(); }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { occupied.current = false; setChoosing(false); }
  }

  /** 预填准确同名字段，余下字段留给用户映射。 */
  async function choose() {
    if (initialSource || occupied.current || !page.exportToken || !validXml || !validTxt || !validWorkbook) return;
    occupied.current = true;
    setChoosing(true); resetSource();
    try {
      if (!isCurrent()) throw Error(text.stale);
      const selection = format === 'xml' ? { format, xmlOptions } : format === 'txt' ? { format, encoding, txtOptions } : format === 'json' ? { format, encoding } :
        format === 'xlsx' ? { format, excelOptions, workbookToken: workbook!.token } :
        { csvDelimiter: delimiter, csvHasHeader: hasHeader };
      const selected = await invoke('postgres.table.importChoose', { ...target, pageToken: page.exportToken, ...selection });
      if (!isCurrent()) throw Error(text.stale);
      const assigned = new Set<string>();
      setMapping(selected?.header.map(name => {
        const key = records || hasHeader ? candidates.find(column => column.name === name)?.key : undefined;
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
    if (occupied.current || !file || !page.exportToken || !mapped || conflictError) return;
    if (!isCurrent()) { setError(text.stale); return; }
    const id = crypto.randomUUID(), lease = acquireWorkspaceBusy(target.tabId);
    occupied.current = true; cancelRequested.current = false;
    setTaskId(id); setError('');
    let message: string, committed = false;
    try {
      const selection = records ? { format, columns: mapping.map(key => key || null) } : { columns: mapping };
      const conflict = mode === 'insert' || !key ? undefined : { mode, keyId: key.id };
      const outcome = await invoke('postgres.table.import', { ...target, pageToken: page.exportToken, fileToken: file.token, taskId: id, ...selection,
        ...(conflict ? { conflict } : {}) });
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
      <p>{mode === 'insert' ? text.note : text.conflictNote}</p>
      {(!['txt', 'xlsx'].includes(format) || initialSource) && <p>{format === 'xml' ? xmlOptions.documentResult === undefined ? xmlImportZh.hint : xmlImportZh.documentHint : format === 'json' ? text.jsonNote : format === 'txt' ? txtImportZh.hint : format === 'xlsx' ? excelImportZh.hint : initialSource ? newTableText.postgresCsv : text.nullNote}</p>}
      {!initialSource && <><Field label={text.format}><select aria-label={text.format} value={format} disabled={locked} onChange={event => {
        setFormat(event.target.value as typeof format); setWorkbook(null); setExcelOptions(excelImportDefaults); resetSource();
      }}><option value="csv">CSV</option><option value="json">JSON</option><option value="txt">{txtImportZh.format}</option><option value="xlsx">{excelImportZh.format}</option><option value="xml">XML</option></select></Field>
      <div className="pg-table-controls">
        {format === 'xml' ? <>
          <XmlDocumentImportFields options={xmlOptions} disabled={locked} onChange={options => { setXmlOptions(options); resetSource(); }}/>
          {xmlOptions.documentResult === undefined && <>
          <Field label={xmlImportZh.rowTag}><input aria-label={xmlImportZh.rowTag} value={xmlOptions.rowTag} maxLength={256} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, rowTag: event.target.value }); resetSource(); }}/></Field>
          <label className="check"><input type="checkbox" checked={xmlOptions.attributes} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, attributes: event.target.checked }); resetSource(); }}/> {xmlImportZh.attributes}</label>
          <label className="check"><input type="checkbox" checked={xmlOptions.binaryBase64} disabled={locked}
            onChange={event => { setXmlOptions({ ...xmlOptions, binaryBase64: event.target.checked }); resetSource(); }}/> {xmlImportZh.binary}</label>
          </>}
        </> : format === 'json' || format === 'txt' ? <Field label={text.encoding}><select aria-label={text.encoding} value={encoding} disabled={locked}
          onChange={event => { setEncoding(event.target.value as typeof encoding); resetSource(); }}>
          <option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">GB18030</option>
        </select></Field> : format === 'xlsx' ? <button disabled={locked} onClick={() => void chooseWorkbook()}>{workbook?.name ?? excelImportZh.workbook}</button> : <>
        <CsvExportDelimiterField value={delimiter} disabled={locked} label={text.delimiter} hint={text.delimiterHint} onChange={value => {
          setDelimiter(value); resetSource();
        }}/>
        <label className="check" title={hasHeader ? csvImportHeaderZh.hasHeaderHint : csvImportHeaderZh.noHeaderHint}>
          <input type="checkbox" checked={hasHeader} disabled={locked} onChange={event => {
            setHasHeader(event.target.checked); resetSource();
          }}/> {csvImportHeaderZh.label}
        </label>
        </>}
        {format !== 'xlsx' && <button disabled={locked || !validXml || !validTxt} onClick={() => void choose()}>{format === 'xml' ? text.chooseXml : format === 'json' ? text.chooseJson : format === 'txt' ? text.chooseTxt : text.choose}</button>}
      </div>
      {format === 'xlsx' && <><div className="form-grid"><ExcelImportFields fileToken={workbook?.token} options={excelOptions} disabled={locked} onChange={options => { setExcelOptions(options); resetSource(); }}/></div>
        <button disabled={locked || !validWorkbook} onClick={() => void choose()}>{excelImportZh.inspect}</button></>}
      {format === 'txt' && <div className="form-grid"><TxtImportFields options={txtOptions} disabled={locked} onChange={options => { setTxtOptions(options); resetSource(); }}/></div>}
      {!validTxt && <ErrorBox message={txtImportZh.invalid}/>}
      {!validXml && <ErrorBox message={xmlImportZh.invalid}/>}</>}
      {choosing && <Spinner text={text.reading}/>}
      {file && <>
        <p>{text.file} · {file.name} · {file.bytes.toLocaleString('zh-CN')} {text.bytes}{file.records !== undefined && <> · {format === 'xml' && xmlOptions.documentResult !== undefined ? xmlImportZh.documentRecords(file.records) : text.records(file.records)}</>}</p>
        <fieldset disabled={locked}>
          <legend>{text.columns}</legend>
          {!records && !hasHeader && file.header.length <= candidates.length && <button onClick={() => {
            changeMapping(candidates.slice(0, file.header.length).map(column => column.key));
          }}>{text.position}</button>}
          <div className="pg-table-export-columns">
            {file.header.map((name, index) => <label key={index}>{index + 1}. {name || text.unnamed}
              <select aria-label={text.target(index)} value={mapping[index]} onChange={event => {
                changeMapping(mapping.map((key, i) => i === index ? event.target.value : key));
              }}>
                <option value="">{records ? text.skip : text.select}</option>
                {candidates.map(column => <option key={column.key} value={column.key}
                  disabled={mapping.some((key, i) => i !== index && key === column.key)}>{column.name}</option>)}
              </select>
            </label>)}
          </div>
        </fieldset>
        {!initialSource && !!file.conflictKeys?.length && <div className="pg-table-controls">
          <Field label={conflictText.mode}><select aria-label={conflictText.mode} value={mode} disabled={locked} onChange={event => {
            setMode(event.target.value as typeof mode); setKeyId('');
          }}><option value="insert">{conflictText.insert}</option><option value="skip-existing">{conflictText.skipExisting}</option>
            <option value="upsert">{conflictText.upsert}</option><option value="update-existing">{conflictText.updateExisting}</option></select></Field>
          {mode !== 'insert' && <Field label={conflictText.key}><select aria-label={conflictText.key} value={keyId} disabled={locked}
            onChange={event => setKeyId(event.target.value)}><option value="">{conflictText.chooseKey}</option>
            {file.conflictKeys.map(value => <option key={value.id} value={value.id}>{value.name} ({value.columns.map(key => candidates.find(column => column.key === key)?.name ?? key).join(', ')})</option>)}
          </select></Field>}
        </div>}
        {mode !== 'insert' && conflictError && <p className="warning-text">{conflictError}</p>}
        <section aria-label={text.sample}>
          <p>{file.sampleLimited ? records ? text.recordSampleLimited : text.sampleLimited : file.sample.length ? text.sampleLimit : text.sampleEmpty}</p>
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
        <button className="primary" disabled={locked || !mapped || !!conflictError} onClick={() => void start()}>{mode === 'insert' ? text.confirm : text.confirmConflict}</button>}
    </footer>
  </Modal>;
}
