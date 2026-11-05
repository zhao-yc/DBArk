import { useState } from 'react';
import type { DataRow } from '../../shared/contracts';
import { postgresTableLimits, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField, type PostgresTablePage } from '../../shared/postgresTable';
import { cellPreview, cellText, errorMessage, ownCell } from '../lib';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { postgresRecordViewZh as viewText } from '../locales/postgresRecordView.zh-CN';
import { ErrorBox, Modal } from './ui';

export type PostgresEditableRecord = Extract<PostgresTableChange, { kind: 'insert' | 'update' }>;
export type PostgresRecordValues = Map<string, PostgresTableField['value']>;
type Mode = PostgresTableField['value']['mode'] | 'unchanged';

/** 网格弹窗和记录视图共用字段模式，分别管理自己的输入和暂存。 */
export function PostgresRecordFields({ columns, original, fields, editable, disabled, inspect, onChange }: {
  columns: readonly PostgresTableColumn[]; original?: DataRow; fields: PostgresRecordValues; editable: boolean; disabled?: boolean; inspect?: boolean;
  onChange(change: (current: PostgresRecordValues) => PostgresRecordValues): void;
}) {
  const [expanded, setExpanded] = useState<string>();

  function changeMode(column: string, mode: Mode) {
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

  return <>{columns.map(column => {
    const value = fields.get(column.key);
    const originalValue = original && ownCell(original, column.key);
    const summary = inspect && originalValue === null ? viewText.null : inspect && originalValue === '' ? viewText.empty : cellPreview(originalValue);
    return <div className="pg-record-field" key={column.key} data-record-column={column.key}>
      <strong tabIndex={inspect ? -1 : undefined}>{column.name} <small className="muted">{column.type}</small></strong>
      {original && <div className="muted pg-record-original">{text.original}　{summary}
        {inspect && originalValue != null && originalValue !== '' && <button type="button" aria-expanded={expanded === column.key}
          aria-label={viewText.raw(column.name)} onClick={() => setExpanded(previous => previous === column.key ? undefined : column.key)}>
          {expanded === column.key ? viewText.closeValue : viewText.fullValue}
        </button>}
      </div>}
      {inspect && expanded === column.key && <textarea readOnly aria-label={viewText.raw(column.name)} rows={3} value={cellText(originalValue)}/>}
      {column.generated ? <span className="muted">{text.generated}</span> : editable && <div className="pg-record-inputs">
        <select aria-label={column.name + ' ' + text.valueMode} value={value?.mode ?? 'unchanged'} disabled={disabled} onChange={event => changeMode(column.key, event.target.value as Mode)}>
          <option value="unchanged">{original ? text.unchanged : text.default}</option>
          <option value="text">{text.text}</option>
          {column.binary && <option value="binary">{text.hex}</option>}
          {column.nullable && <option value="null">{text.null}</option>}
          {original && <option value="default">{text.default}</option>}
        </select>
        {value && 'value' in value && <textarea aria-label={column.name + ' ' + text.value} value={value.value}
          maxLength={postgresTableLimits.value} readOnly={disabled} rows={2} onChange={event => {
            const next = event.target.value;
            onChange(previous => new Map(previous).set(column.key, { ...value, value: next }));
          }}/>}
      </div>}
    </div>;
  })}</>;
}

export function PostgresRecordForm({ page, row, initial, onSave, onClose }: {
  page: PostgresTablePage; row: number | null; initial?: PostgresEditableRecord;
  onSave(change: PostgresEditableRecord): void; onClose(): void;
}) {
  const [fields, setFields] = useState<PostgresRecordValues>(() => new Map(initial?.fields.map(field => [field.column, field.value])));
  const [error, setError] = useState('');
  const original = row === null ? undefined : page.rows[row];

  function submit() {
    const list = Array.from(fields, ([column, value]) => ({ column, value }));
    if (row !== null && !list.length) { setError(text.noChange); return; }
    try { onSave(row === null ? { kind: 'insert', fields: list } : { kind: 'update', row, fields: list }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={row === null ? text.add : text.edit} onClose={onClose} wide>
    <div className="modal-content pg-record-form">
      <PostgresRecordFields columns={page.columns} original={original} fields={fields} editable onChange={setFields}/>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{text.cancel}</button><button className="primary" onClick={submit}>{text.stage}</button></footer>
  </Modal>;
}
