import type { QueryResultFrequency } from '../queryResultFrequency';
import { queryResultStatisticsZh as text } from '../locales/queryResultStatistics.zh-CN';
import '../queryResultFrequency.css';

interface ChartRow { key: string; label: string; kind?: string; count: number; truncated?: boolean; }

/** 占比按整个已返回统计范围计算；次数有界，整数基点实现两位小数的四舍五入。 */
function percentage(count: number, total: number): string {
  const basis = total ? Math.floor((count * 10000 + total / 2) / total) : 0;
  return `${Math.floor(basis / 100)}.${String(basis % 100).padStart(2, '0')}%`;
}

/** 表格同时给出数值和可见条形；NULL和其余值参与比例，但永不冒充普通值。 */
export function QueryResultFrequencyChart({ frequency, count, nulls }: { frequency: QueryResultFrequency; count: number; nulls: number }) {
  const rows: ChartRow[] = frequency.entries.map((entry, index) => ({ key: `value-${index}`, label: entry.label, kind: text.frequencyKinds[entry.kind], count: entry.count, truncated: entry.truncated }));
  if (frequency.otherValues) rows.push({ key: 'other', label: text.frequencyOther(frequency.otherValues), count: frequency.otherRows });
  if (nulls) rows.push({ key: 'null', label: text.nulls, count: nulls });
  const peak = Math.max(1, ...rows.map(row => row.count));
  return <section className="query-result-frequency" aria-label={text.frequencyTitle}>
    {!rows.length ? <p role="status">{text.frequencyEmpty}</p> : <>
      <p>{text.frequencyCount(count)}</p>
      <table><caption>{text.frequencyTitle}</caption><thead><tr><th scope="col">{text.frequencyValue}</th><th scope="col">{text.frequencyRows}</th><th scope="col">{text.frequencyPercent}</th><th scope="col">{text.frequencyBar}</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.key}><th scope="row"><code>{row.label}</code>{row.kind && <span className="muted small">{row.kind}{row.truncated ? ` · ${text.frequencyTruncated}` : ''}</span>}</th><td>{row.count}</td><td>{percentage(row.count, count)}</td><td><div className="query-result-frequency-bar" aria-hidden="true"><span style={{ width: `${row.count * 100 / peak}%` }}/></div></td></tr>)}</tbody></table>
      <p className="muted small">{text.frequencyScale}</p>
    </>}
  </section>;
}
