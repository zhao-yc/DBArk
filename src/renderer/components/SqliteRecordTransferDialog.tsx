import { useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import type { PostgresRecordTransfer } from '../postgresRecordTransfer';
import { errorMessage } from '../lib';
import { defaultSqliteTransferMapping, prepareSqliteRecordTransfer, sqliteTransferTargets, type SqliteTransferEngine } from '../sqliteRecordTransfer';
import type { SqliteClipboardCell, SqlitePastePlan } from '../sqliteTableClipboard';
import { sqliteRecordTransferZh as text } from '../locales/sqliteRecordTransfer.zh-CN';
import { postgresRecordTransferZh } from '../locales/postgresRecordTransfer.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../locales/sqliteTableClipboard.zh-CN';
import { ErrorBox, Field, Modal } from './ui';
import '../tableStatistics.css';

/** 映射只生成原目标页的原类型新增计划，集中提交沿用 SQLite 编辑事务。 */
export function SqliteRecordTransferDialog({ engine, snapshot, page, values, targetName, current, onStage, onClose }: {
  engine: SqliteTransferEngine;
  snapshot: PostgresRecordTransfer; page: SqliteTablePage; values: SqliteClipboardCell[][];
  targetName: string; current(): boolean; onStage(plan: SqlitePastePlan): void; onClose(): void;
}) {
  const [mapping, setMapping] = useState(() => defaultSqliteTransferMapping(snapshot, page, values));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const source = snapshot.source, valid = current();
  const field = (index: number) => `${index + 1}. ${snapshot.columns[index].name} (${snapshot.columns[index].type})`;
  const destinations = sqliteTransferTargets(page, values, selected)
    .filter(column => !mapping.some((item, index) => index !== selected && item.column === column.name));
  return <Modal title={text.title(engine)} wide onClose={onClose}>
    <div className="modal-content">
      <p>{text.scope(values.length)}</p><p>{text.precision}</p>
      <dl><dt>{text.source(engine)}</dt><dd>{source.label} / {source.database && <>{source.database} / </>}{'title' in source ? postgresRecordTransferZh.queryResult(source.title, source.result) : source.table}</dd>
        <dt>{text.target}</dt><dd>{targetName} / {page.target.database}.{page.target.table}</dd></dl>
      <div className="pg-table-controls">
        <Field label={text.sourceColumn}><select aria-label={text.sourceColumn} disabled={!valid} value={selected} onChange={event => setSelected(Number(event.target.value))}>
          {snapshot.columns.map((column, index) => <option key={column.key} value={index}>{field(index)}</option>)}
        </select></Field>
        <Field label={text.targetColumn}><select aria-label={text.targetColumn} disabled={!valid} value={mapping[selected].column ?? ''} onChange={event => {
          const column = event.target.value || null;
          setMapping(mapping.map((entry, index) => index === selected ? { ...entry, column } : entry)); setError('');
        }}>
          <option value="">{text.skip}</option>
          {destinations.map(column => <option key={column.name} value={column.name}>{column.name} ({column.declaredType})</option>)}
        </select></Field>
      </div>
      <div className="table-statistics-results"><table>
        <thead><tr><th>{text.sourceColumn}</th><th>{text.targetColumn}</th></tr></thead>
        <tbody>{mapping.map((item, index) => <tr key={snapshot.columns[index].key}><td>{field(index)}</td><td>{item.column ?? text.skip}</td></tr>)}</tbody>
      </table></div>
      <ErrorBox message={valid ? error : clipboardText.stale}/>
    </div>
    <footer className="modal-footer">
      <button type="button" onClick={onClose}>{clipboardText.cancel}</button>
      <button type="button" className="primary" disabled={!valid || !mapping.some(item => item.column !== null)} onClick={() => {
        if (!current()) return;
        try { onStage(prepareSqliteRecordTransfer(page, values, mapping)); } catch (reason) { setError(errorMessage(reason)); }
      }}>{clipboardText.stage}</button>
    </footer>
  </Modal>;
}
