import { useState } from 'react';
import type { PostgresColumnStatistics } from '../../shared/postgresColumnStatistics';
import { invoke } from '../lib';
import { postgresColumnStatisticsZh as text } from '../locales/postgresColumnStatistics.zh-CN';
import { usePostgresColumnRead, type PostgresColumnReadSource } from '../postgresColumnRead';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import '../tableStatistics.css';

type Value = NonNullable<PostgresColumnStatistics['groups']>['min'];

function display(value: Value, quoted = false): string {
  if (!value) return 'NULL';
  return (quoted ? JSON.stringify(value.text) : value.text) + (value.clipped ? ` …（${text.clipped}）` : '');
}

/** 选择字段只改变本地输入，显式开始才读取原筛选范围内的数据库快照。 */
export function PostgresColumnStatisticsDialog({ source, onClose }: { source: PostgresColumnReadSource; onClose(): void }) {
  const { origin, result, busy, error, read, reset } = usePostgresColumnRead<PostgresColumnStatistics>(source, text.expired);
  const [column, setColumn] = useState(origin.initialColumn ?? origin.columns[0]?.key ?? '');
  const field = origin.columns.find(item => item.key === column);
  const metrics: [string, string][] = [];
  if (result && field) {
    const { groups, numeric } = result;
    metrics.push([text.type, field.type], [text.rows, result.rows], [text.nonNull, result.nonNull], [text.nulls, result.nulls]);
    if (result.empty !== undefined) metrics.push([text.empty, result.empty]);
    if (groups) metrics.push([text.distinct, groups.distinct], [text.unique, groups.unique], [text.repeated, groups.repeated],
      [text.min, display(groups.min, result.empty !== undefined)], [text.max, display(groups.max, result.empty !== undefined)]);
    if (numeric) metrics.push([text.zero, numeric.zero], [text.nonFinite, numeric.nonFinite],
      [text.sum, display(numeric.sum)], [text.average, display(numeric.average)], [text.deviation, display(numeric.deviation)]);
  }
  return <Modal title={text.title} onClose={onClose} wide>
    <div className="modal-content">
      <p>{text.hint}</p>
      <div className="pg-table-controls">
        <Field label={text.field}><select aria-label={text.field} value={column} disabled={busy} onChange={event => {
          setColumn(event.target.value); reset();
        }}>{origin.columns.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field>
        <button type="button" disabled={busy || !field} onClick={() => void read(() =>
          invoke('postgres.table.statistics', { ...origin.input, column }))}>{text.read}</button>
        {busy && <Spinner text={text.loading}/>}
      </div>
      <ErrorBox message={error}/>
      {result && <div className="table-statistics-results">
        <table aria-label={text.title}><thead><tr><th>{text.metric}</th><th>{text.value}</th></tr></thead>
          <tbody>{metrics.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody>
        </table>
        {!result.groups && <p className="muted small">{text.countsOnly}</p>}
      </div>}
    </div>
    <footer className="modal-footer"><button type="button" onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
