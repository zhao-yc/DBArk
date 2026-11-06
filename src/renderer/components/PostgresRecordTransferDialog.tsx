import { useState } from 'react';
import { postgresTableLimits, type PostgresTableColumn } from '../../shared/postgresTable';
import { errorMessage } from '../lib';
import { postgresRecordTransferZh as text } from '../locales/postgresRecordTransfer.zh-CN';
import { postgresTableZh as tableText } from '../locales/postgresTable.zh-CN';
import { defaultPostgresTransferMapping, postgresTransferColumnsCompatible, type PostgresRecordTransfer, type PostgresTransferTable } from '../postgresRecordTransfer';
import { ErrorBox, Field, Modal } from './ui';
import '../tableStatistics.css';

/** 显示准确来源、目标及整批映射，打开窗口和调整字段都不会修改草稿。 */
export function PostgresRecordTransferDialog({ snapshot, target, columns, onStage, onClose }: {
  snapshot: PostgresRecordTransfer; target: PostgresTransferTable; columns: readonly PostgresTableColumn[];
  onStage(mapping: ReadonlyMap<string, string>): void; onClose(): void;
}) {
  const [mapping, setMapping] = useState(() => defaultPostgresTransferMapping(snapshot, columns));
  const [targetKey, setTargetKey] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [error, setError] = useState('');
  const available = columns.filter(column => !column.generated && !mapping.has(column.key));
  const selectedTarget = available.find(column => column.key === targetKey) ?? available[0];
  const sources = selectedTarget ? snapshot.columns.filter(column => postgresTransferColumnsCompatible(column, selectedTarget)) : [];
  const selectedSource = sources.find(column => column.key === sourceKey) ?? sources[0];
  const display = (table: PostgresTransferTable) => `${table.label} / ${table.database} / ${table.table}`;
  const field = (column: PostgresTableColumn) => `${column.name} (${column.type})`;
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content pg-record-form">
      <p>{text.notice}</p>
      <dl><dt>{text.source}</dt><dd>{display(snapshot.source)}</dd><dt>{text.target}</dt><dd>{display(target)}</dd></dl>
      <p>{text.rows(snapshot.rows.length)} · {text.mappingHint}</p>
      {!!mapping.size && <div className="table-statistics-results"><table>
        <thead><tr><th>{text.sourceColumn}</th><th>{text.targetColumn}</th><th/></tr></thead>
        <tbody>{columns.filter(column => mapping.has(column.key)).map(column => {
          const source = snapshot.columns.find(item => item.key === mapping.get(column.key));
          return <tr key={column.key}><td>{source && field(source)}</td><th scope="row">{field(column)}</th>
            <td><button type="button" onClick={() => {
              const next = new Map(mapping);
              next.delete(column.key); setMapping(next); setError('');
            }}>{text.remove(column.name)}</button></td></tr>;
        })}</tbody>
      </table></div>}
      {!!available.length && <div className="pg-table-controls">
        <Field label={text.targetColumn}><select aria-label={text.targetColumn} value={selectedTarget?.key ?? ''} onChange={event => setTargetKey(event.target.value)}>
          {available.map(column => <option key={column.key} value={column.key}>{field(column)}</option>)}
        </select></Field>
        <Field label={text.sourceColumn}><select aria-label={text.sourceColumn} value={selectedSource?.key ?? ''} disabled={!sources.length} onChange={event => setSourceKey(event.target.value)}>
          {sources.map(column => <option key={column.key} value={column.key}>{field(column)}</option>)}
        </select></Field>
        <button type="button" disabled={!selectedTarget || !selectedSource || mapping.size >= postgresTableLimits.fields} onClick={() => {
          if (selectedTarget && selectedSource) { setMapping(new Map(mapping).set(selectedTarget.key, selectedSource.key)); setError(''); }
        }}>{text.add}</button>
      </div>}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer">
      <button type="button" onClick={onClose}>{tableText.cancel}</button>
      <button type="button" className="primary" disabled={!mapping.size} onClick={() => {
        try { onStage(mapping); } catch (reason) { setError(errorMessage(reason)); }
      }}>{tableText.stage}</button>
    </footer>
  </Modal>;
}
