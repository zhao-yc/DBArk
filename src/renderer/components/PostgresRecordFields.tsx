import { useRef, useState } from 'react';
import type { DataRow } from '../../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../../shared/postgresTable';
import { cellPreview, cellText, errorMessage, ownCell } from '../lib';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { postgresRecordViewZh as viewText } from '../locales/postgresRecordView.zh-CN';
import { postgresReferencePickerZh as referenceText } from '../locales/postgresReferencePicker.zh-CN';
import { postgresRecordDuplicateZh as duplicateText } from '../locales/postgresRecordDuplicate.zh-CN';
import { postgresRecordJsonZh as jsonText } from '../locales/postgresRecordJson.zh-CN';
import { beginPostgresRecordJson, isPostgresJsonTextType, postgresRecordJsonBudget, readPostgresRecordJson, replacePostgresJsonField, type PostgresRecordJsonBuffer } from '../postgresRecordJson';
import { BoundedRecordTextarea } from './BoundedRecordTextarea';
import { PostgresReferencePicker, type PostgresReferenceSource } from './PostgresReferencePicker';
import { PostgresRecordJsonTree } from './PostgresRecordJsonTree';
import { BinaryCellViewer } from './BinaryCellViewer';
import { binaryByteLength } from '../binaryCell';
import { postgresBinaryEditBytes, postgresBinaryInputHex } from '../postgresBinaryInput';
import { postgresByteaZh as byteaText } from '../locales/postgresBytea.zh-CN';
import { ErrorBox, Modal } from './ui';
import '../recordProjections.css';

export type PostgresEditableRecord = Extract<PostgresTableChange, { kind: 'insert' | 'update' }>;
export type PostgresRecordValues = Map<string, PostgresTableField['value']>;
type Mode = PostgresTableField['value']['mode'] | 'unchanged';
const emptyBinary = { type: 'binary' as const, base64: '' };

/** 网格弹窗和记录视图共用字段模式，分别管理自己的输入和暂存。 */
export function PostgresRecordFields({ columns, original, fields, editable, disabled, inspect, reference, batch, explicitDefault, current, onChange }: {
  columns: readonly PostgresTableColumn[]; original?: DataRow; fields: PostgresRecordValues; editable: boolean; disabled?: boolean; inspect?: boolean;
  reference?: PostgresReferenceSource;
  batch?: true;
  explicitDefault?: boolean;
  current?(): boolean;
  onChange(change: (current: PostgresRecordValues) => PostgresRecordValues): void;
}) {
  const [expanded, setExpanded] = useState<string>();
  const [pickReference, setPickReference] = useState(false);
  const [binaryView, setBinaryView] = useState<{ column: string; mode: 'original' | 'input' }>();
  const fileSource = useRef(current);
  fileSource.current = current;
  const filesCurrent = current ? () => fileSource.current?.() === true : undefined;

  function toggleBinary(column: string, mode: 'original' | 'input') {
    setBinaryView(previous => previous?.column === column && previous.mode === mode ? undefined : { column, mode });
  }

  function changeMode(column: string, mode: Mode) {
    setBinaryView(undefined);
    onChange(previous => {
      const result = new Map(previous);
      if (mode === 'unchanged') result.delete(column);
      else if (mode === 'null' || mode === 'default') result.set(column, { mode });
      else {
        const old = original && ownCell(original, column);
        const initial = old === null || old === undefined ? '' : cellText(old);
        result.set(column, { mode, value: mode === 'binary' ? (initial.startsWith('0x') ? initial.slice(2) : '') : initial });
      }
      return result;
    });
  }

  return <>{editable && reference && <div className="pg-record-reference">
    <button type="button" disabled={disabled} aria-expanded={pickReference} onClick={() => setPickReference(value => !value)}>{referenceText.open}</button>
    {pickReference && <PostgresReferencePicker key={reference.input.pageToken} source={reference} onClose={() => setPickReference(false)}
      onChoose={selected => onChange(previous => {
        const next = new Map(previous);
        for (const field of selected) next.set(field.column, field.value);
        return next;
      })}/>}
  </div>}{columns.map(column => {
    const value = fields.get(column.key);
    const originalValue = original && ownCell(original, column.key);
    const summary = inspect && originalValue === null ? viewText.null : inspect && originalValue === '' ? viewText.empty : cellPreview(originalValue);
    const originalBinary = column.binary && originalValue && typeof originalValue === 'object' ? originalValue : undefined;
    const largeBinary = originalBinary && (binaryByteLength(originalBinary) ?? 0) > postgresBinaryEditBytes;
    const originalOpen = binaryView?.column === column.key && binaryView.mode === 'original';
    const inputOpen = binaryView?.column === column.key && binaryView.mode === 'input' && value?.mode === 'binary';
    const valueLabel = column.name + ' ' + text.value;
    const writeHex = (hex: string) => {
      const next = postgresBinaryInputHex(hex);
      onChange(previous => new Map(previous).set(column.key, { mode: 'binary', value: next }));
    };
    return <div className="pg-record-field" key={column.key} data-record-column={column.key}>
      <strong tabIndex={inspect ? -1 : undefined}>{column.name} <small className="muted">{column.type}</small></strong>
      {original && <div className="muted pg-record-original">{text.original}　{summary}
        {inspect && originalValue != null && originalValue !== '' && <button type="button" aria-expanded={expanded === column.key}
          aria-label={viewText.raw(column.name)} onClick={() => setExpanded(previous => previous === column.key ? undefined : column.key)}>
          {expanded === column.key ? viewText.closeValue : viewText.fullValue}
        </button>}
        {originalBinary && <button type="button" aria-expanded={originalOpen} disabled={!originalOpen && filesCurrent?.() === false}
          onClick={() => toggleBinary(column.key, 'original')}>
          {originalOpen ? byteaText.close : byteaText.original}
        </button>}
      </div>}
      {inspect && expanded === column.key && <textarea readOnly aria-label={viewText.raw(column.name)} rows={3} value={cellText(originalValue)}/>}
      {originalBinary && originalOpen && <BinaryCellViewer value={originalBinary} source={[original, column]} isCurrent={filesCurrent}/>}
      {column.generated ? <span className="muted">{text.generated}</span> : editable && <div className="pg-record-inputs">
        <select aria-label={column.name + ' ' + text.valueMode} value={value?.mode ?? 'unchanged'} disabled={disabled} onChange={event => changeMode(column.key, event.target.value as Mode)}>
          <option value="unchanged">{original || batch ? text.unchanged : explicitDefault ? text.omitInsertField : text.default}</option>
          <option value="text">{text.text}</option>
          {column.binary && <option value="binary" disabled={!!largeBinary && value?.mode !== 'binary'}>{text.hex}</option>}
          {column.nullable && <option value="null">{text.null}</option>}
          {(original || batch || explicitDefault) && <option value="default">{text.default}</option>}
        </select>
        {largeBinary && value?.mode !== 'binary' && <button type="button" title={byteaText.replacementHint} disabled={disabled} onClick={() => {
          writeHex(''); setBinaryView({ column: column.key, mode: 'input' });
        }}>{byteaText.replace}</button>}
        {value?.mode === 'binary' && <button type="button" aria-expanded={inputOpen} disabled={!inputOpen && filesCurrent?.() === false}
          onClick={() => toggleBinary(column.key, 'input')}>
          {inputOpen ? byteaText.close : byteaText.edit}
        </button>}
        {inputOpen && value?.mode === 'binary' ? <BinaryCellViewer value={emptyBinary} hexInput={value.value} label={valueLabel}
          reason={disabled ? viewText.expired : undefined} source={[original, column, fields]} isCurrent={filesCurrent}
          onHexChange={disabled ? undefined : writeHex}/>
        : value && 'value' in value && <textarea aria-label={valueLabel} value={value.value}
          maxLength={postgresTableLimits.value} readOnly={disabled} rows={2} onChange={event => {
            const next = event.target.value;
            onChange(previous => new Map(previous).set(column.key, { ...value, value: next }));
          }}/>}
      </div>}
    </div>;
  })}</>;
}

export function PostgresRecordJsonEditor({ buffer, disabled, onChange }: {
  buffer: PostgresRecordJsonBuffer; disabled?: boolean; onChange(buffer: PostgresRecordJsonBuffer): void;
}) {
  return <><p>{jsonText.hint}</p><BoundedRecordTextarea aria-label={jsonText.input} className="record-whole-json" spellCheck={false}
    readOnly={disabled} inputIdentity={buffer.input} budget={postgresRecordJsonBudget} value={buffer.source}
    onValueChange={source => onChange({ ...buffer, source })}/></>;
}

export function PostgresRecordForm({ page, row, initial, reference, duplicate, editingDraft, current, onSave, onClose }: {
  page: PostgresTablePage; row: number | null; initial?: PostgresEditableRecord;
  reference?: PostgresReferenceSource;
  duplicate?: { rowNumber: number; omitted: readonly string[] };
  editingDraft?: boolean;
  current(): boolean;
  onSave(change: PostgresEditableRecord): void; onClose(): void;
}) {
  const [origin] = useState(() => ({ page, row }));
  const [fields, setFields] = useState<PostgresRecordValues>(() => new Map(initial?.fields.map(field => [field.column, field.value])));
  const [json, setJson] = useState<PostgresRecordJsonBuffer>();
  const [tree, setTree] = useState(false);
  const [error, setError] = useState('');
  const original = row === null ? undefined : page.rows[row];

  function sourceCurrent() {
    return current() && origin.page === page && origin.row === row && (row === null || !!original);
  }

  function valid() {
    if (!sourceCurrent()) throw Error(viewText.expired);
  }

  function changeMode() {
    try {
      valid();
      if (json) { setFields(readPostgresRecordJson(json)); setJson(undefined); }
      else setJson(beginPostgresRecordJson(page.columns, original, fields));
      setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function submit() {
    if (tree) return;
    try {
      valid();
      const values = json ? readPostgresRecordJson(json) : fields;
      const list = Array.from(values, ([column, value]) => ({ column, value }));
      if (row !== null && !list.length) throw Error(text.noChange);
      onSave(row === null ? { kind: 'insert', fields: list } : { kind: 'update', row, fields: list });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={editingDraft ? text.editInsertDraft : duplicate ? duplicateText.title : row === null ? text.add : text.edit} onClose={onClose} wide>
    <div className={duplicate ? 'modal-content pg-record-form pg-record-duplicate' : 'modal-content pg-record-form'}>
      {duplicate && <>
        <p>{duplicateText.source(duplicate.rowNumber)} {duplicateText.notice}</p>
        {!!duplicate.omitted.length && <p>{duplicateText.omitted(duplicate.omitted.join('、'))}</p>}
      </>}
      {!tree && <div className="pg-table-controls">
        <button type="button" onClick={changeMode}>{json ? jsonText.back : jsonText.open}</button>
        {json && <button type="button" onClick={() => { setJson(undefined); setError(''); }}>{jsonText.discard}</button>}
        {!json && page.columns.some(column => isPostgresJsonTextType(column.type)) && <button type="button" onClick={() => {
          try { valid(); setTree(true); setError(''); }
          catch (reason) { setError(errorMessage(reason)); }
        }}>{jsonText.tree}</button>}
      </div>}
      {tree ? <PostgresRecordJsonTree columns={page.columns} original={original} values={fields}
        current={sourceCurrent} onAccept={(column, previous, next) => {
          valid();
          setFields(replacePostgresJsonField(original, fields, column, previous, next));
        }} onClose={() => setTree(false)}/>
        : json ? <PostgresRecordJsonEditor buffer={json} onChange={value => { setJson(value); setError(''); }}/>
        : <PostgresRecordFields columns={page.columns} original={original} fields={fields} editable reference={reference} current={sourceCurrent}
          explicitDefault={editingDraft} onChange={setFields}/>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{text.cancel}</button><button className="primary" disabled={tree} onClick={submit}>{editingDraft ? text.saveInsertDraft : text.stage}</button></footer>
  </Modal>;
}
