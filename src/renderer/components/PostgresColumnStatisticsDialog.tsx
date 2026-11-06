import { useState } from 'react';
import type { PostgresColumnStatistics } from '../../shared/postgresColumnStatistics';
import { postgresHistogramBins, postgresHistogramKind, type PostgresHistogramBins, type PostgresTableHistogram } from '../../shared/postgresTableHistogram';
import { invoke } from '../lib';
import { postgresColumnStatisticsZh as text } from '../locales/postgresColumnStatistics.zh-CN';
import { tableHistogramZh as histogramText } from '../locales/tableHistogram.zh-CN';
import { usePostgresColumnRead, type PostgresColumnReadSource } from '../postgresColumnRead';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { TableHistogramChart } from './TableHistogramChart';
import '../tableStatistics.css';

type Value = NonNullable<PostgresColumnStatistics['groups']>['min'];

function display(value: Value, quoted = false): string {
  if (!value) return 'NULL';
  return (quoted ? JSON.stringify(value.text) : value.text) + (value.clipped ? ` …（${text.clipped}）` : '');
}

/** 选择字段只改变本地输入，显式开始才读取原筛选范围内的数据库快照。 */
export function PostgresColumnStatisticsDialog({ source, onClose }: { source: PostgresColumnReadSource; onClose(): void }) {
  const { origin, result, busy, error, read, reset } = usePostgresColumnRead<PostgresColumnStatistics | PostgresTableHistogram>(source, text.expired);
  const [column, setColumn] = useState(origin.initialColumn ?? origin.columns[0]?.key ?? '');
  const [bins, setBins] = useState<PostgresHistogramBins>(10);
  const field = origin.columns.find(item => item.key === column);
  const summary = result && !('ranges' in result) ? result : undefined;
  const metrics: [string, string][] = [];
  if (summary && field) {
    const { groups, numeric } = summary;
    metrics.push([text.type, field.type], [text.rows, summary.rows], [text.nonNull, summary.nonNull], [text.nulls, summary.nulls]);
    if (summary.empty !== undefined) metrics.push([text.empty, summary.empty]);
    if (groups) metrics.push([text.distinct, groups.distinct], [text.unique, groups.unique], [text.repeated, groups.repeated],
      [text.min, display(groups.min, summary.empty !== undefined)], [text.max, display(groups.max, summary.empty !== undefined)]);
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
        {field && postgresHistogramKind(field) && <>
          <Field label={histogramText.bins}><select aria-label={histogramText.bins} value={bins} disabled={busy} onChange={event => {
            setBins(postgresHistogramBins.parse(Number(event.target.value)));
            if (result && 'ranges' in result) reset();
          }}>
            {[5, 10, 20].map(value => <option key={value} value={value}>{value}</option>)}
          </select></Field>
          <button type="button" disabled={busy} onClick={() => void read(() =>
            invoke('postgres.table.histogram', { ...origin.input, column, bins }))}>{text.readHistogram}</button>
        </>}
        {busy && <Spinner text={text.loading}/>}
      </div>
      <ErrorBox message={error}/>
      {summary && <div className="table-statistics-results">
        <table aria-label={text.title}><thead><tr><th>{text.metric}</th><th>{text.value}</th></tr></thead>
          <tbody>{metrics.map(([name, value]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td></tr>)}</tbody>
        </table>
        {!summary.groups && <p className="muted small">{text.countsOnly}</p>}
      </div>}
      {result && 'ranges' in result && <TableHistogramChart histogram={result}/>}
    </div>
    <footer className="modal-footer"><button type="button" onClick={onClose}>{text.close}</button></footer>
  </Modal>;
}
