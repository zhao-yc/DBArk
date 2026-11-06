import { useState } from 'react';
import type { PostgresTableColumn } from '../../shared/postgresTable';
import { errorMessage } from '../lib';
import { postgresBatchEditZh as text } from '../locales/postgresBatchEdit.zh-CN';
import { postgresBatchDuplicateZh as duplicateText } from '../locales/postgresBatchDuplicate.zh-CN';
import { postgresTableZh } from '../locales/postgresTable.zh-CN';
import type { PostgresBatchEditInput } from '../postgresBatchEdit';
import type { PostgresBatchRow } from '../postgresBatchSelection';
import { PostgresRecordFields, type PostgresRecordValues } from './PostgresRecordFields';
import { ErrorBox, Modal } from './ui';

/** 每条原记录使用独立缓冲。只在确认整批时把各条输入交回表页。 */
export function PostgresBatchEditDialog({ rows, columns, primary, offset, duplicate, onStage, onClose }: {
  rows: readonly PostgresBatchRow[]; columns: readonly PostgresTableColumn[]; primary: readonly PostgresTableColumn[];
  duplicate?: { initial: ReadonlyMap<number, PostgresRecordValues>; omitted: readonly string[] };
  offset: number; onStage(inputs: PostgresBatchEditInput): void; onClose(): void;
}) {
  const [active, setActive] = useState(0);
  const [draft, setDraft] = useState(() => new Map<number, PostgresRecordValues>());
  const [error, setError] = useState('');
  const row = rows[active];
  const labels = duplicate ? duplicateText : text;

  function originalFields(target: PostgresBatchRow): PostgresRecordValues {
    if (duplicate) return duplicate.initial.get(target.index) ?? new Map();
    const fields = target.previous?.kind === 'update' ? target.previous.fields : [];
    return new Map(fields.filter(field => columns.some(column => column.key === field.column))
      .map(field => [field.column, field.value]));
  }

  return <Modal title={labels.title} onClose={onClose} wide>
    <div className="modal-content pg-batch-edit">
      <p>{labels.notice}</p>
      {!!duplicate?.omitted.length && <p>{duplicateText.omitted(duplicate.omitted.join('、'))}</p>}
      <div className="pg-batch-edit-records">
        <nav aria-label={text.rows}>{rows.map((target, index) => {
          const label = text.record(offset + target.index + 1);
          return <button type="button" key={target.key} aria-label={label} aria-pressed={active === index}
            onClick={() => { setActive(index); setError(''); }}>{label} {draft.has(target.index) && <small>{text.edited}</small>}</button>;
        })}</nav>
        <section aria-label={text.record(offset + row.index + 1)} key={row.key}>
          <PostgresRecordFields columns={primary} original={row.original} fields={new Map()} editable={false} inspect onChange={() => {}}/>
          <PostgresRecordFields columns={columns} original={duplicate ? undefined : row.original} fields={draft.get(row.index) ?? originalFields(row)}
            editable inspect onChange={change => {
              setDraft(previous => {
                const fields = change(previous.get(row.index) ?? originalFields(row));
                return new Map(previous).set(row.index, fields);
              });
              setError('');
            }}/>
        </section>
      </div>
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button type="button" onClick={onClose}>{postgresTableZh.cancel}</button>
      <button type="button" className="primary" disabled={!duplicate && !draft.size} onClick={() => {
        try { onStage(draft); } catch (reason) { setError(errorMessage(reason)); }
      }}>{labels.stage}</button>
    </footer>
  </Modal>;
}
