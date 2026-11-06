import { useState } from 'react';
import { postgresTableLimits, type PostgresTableColumn, type PostgresTableField } from '../../shared/postgresTable';
import { errorMessage } from '../lib';
import { postgresBatchFillZh as text } from '../locales/postgresBatchFill.zh-CN';
import { postgresTableZh } from '../locales/postgresTable.zh-CN';
import { postgresFilteredUpdateZh as filteredText } from '../locales/postgresFilteredUpdate.zh-CN';
import { PostgresRecordFields, type PostgresRecordValues } from './PostgresRecordFields';
import { ErrorBox, Field, Modal } from './ui';

/** 编辑器只维护统一字段赋值，确认后一次交给原表页草稿。 */
export function PostgresBatchFillDialog({ columns, count, filtered, onStage, onClose }: {
  columns: readonly PostgresTableColumn[]; count: number; onStage(fields: PostgresTableField[]): void; onClose(): void;
  filtered?: { initial?: PostgresTableField[]; busy: boolean; error: string };
}) {
  const initial = filtered?.initial;
  const [chosen, setChosen] = useState(() => initial?.length
    ? columns.filter(column => initial.some(field => field.column === column.key)) : columns.slice(0, 1));
  const [fields, setFields] = useState<PostgresRecordValues>(() => new Map(initial?.map(field => [field.column, field.value])));
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const available = columns.filter(column => !chosen.includes(column));
  const selected = available.find(column => column.key === next) ?? available[0];

  function remove(column: PostgresTableColumn) {
    setChosen(previous => previous.filter(item => item !== column));
    setFields(previous => {
      const values = new Map(previous);
      values.delete(column.key);
      return values;
    });
    setError('');
  }

  return <Modal title={filtered ? filteredText.title : text.title} onClose={onClose} wide>
    <div className="modal-content pg-record-form">
      <p>{filtered ? filteredText.scope : `${text.notice} ${text.count(count)}`}</p>
      {chosen.map(column => <div key={column.key} className="pg-batch-fill-field">
        <PostgresRecordFields columns={[column]} fields={fields} editable disabled={filtered?.busy} batch onChange={change => {
          setFields(change); setError('');
        }}/>
        <button type="button" disabled={filtered?.busy} onClick={() => remove(column)}>{text.remove(column.name)}</button>
      </div>)}
      {!!available.length && <div className="pg-table-controls">
        <Field label={text.selectField}><select aria-label={text.selectField} disabled={filtered?.busy} value={selected?.key ?? ''} onChange={event => setNext(event.target.value)}>
          {available.map(column => <option key={column.key} value={column.key}>{column.name}</option>)}
        </select></Field>
        <button type="button" disabled={filtered?.busy || !selected || chosen.length >= postgresTableLimits.fields} onClick={() => {
          if (selected) setChosen(previous => [...previous, selected]);
        }}>{text.addField}</button>
      </div>}
      <ErrorBox message={error || filtered?.error}/>
    </div>
    <footer className="modal-footer">
      <button type="button" disabled={filtered?.busy} onClick={onClose}>{postgresTableZh.cancel}</button>
      <button type="button" className="primary" disabled={filtered?.busy || !fields.size} onClick={() => {
        try { onStage(Array.from(fields, ([column, value]) => ({ column, value }))); }
        catch (reason) { setError(errorMessage(reason)); }
      }}>{filtered ? filteredText.preview : text.stage}</button>
    </footer>
  </Modal>;
}
