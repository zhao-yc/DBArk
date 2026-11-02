import type { TableHistogram } from '../../shared/tableHistogram';
import { tableHistogramZh as text } from '../locales/tableHistogram.zh-CN';
import '../tableHistogram.css';

/** 只显示已核对的服务器区间计数；条形比例有界转换，原计数和边界始终保留原文。 */
export function TableHistogramChart({ histogram }: { histogram: TableHistogram }) {
  const peak = histogram.ranges.reduce((largest, range) => BigInt(range.count) > largest ? BigInt(range.count) : largest, 0n), nonNull = BigInt(histogram.nonNull);
  const percent = (count: string, total: bigint) => { const scaled = total ? BigInt(count) * 10000n / total : 0n; return `${scaled / 100n}.${(scaled % 100n).toString().padStart(2, '0')}%`; };
  return <section className="table-histogram" aria-label={text.title}><h3>{text.title} · {histogram.column}</h3><p>{histogram.approximate ? text.approximate : text.exact}</p><p>{text.scope}</p><p>{text.actual(histogram.ranges.length, histogram.requestedBins)} · {text.reduced}</p>
    <dl><dt>{text.nonNull}</dt><dd>{histogram.nonNull}</dd><dt>{text.nulls}</dt><dd>{histogram.nulls}</dd></dl>
    {!histogram.ranges.length ? <p>{text.empty}</p> : <><table><caption>{text.title} · {histogram.column}</caption><thead><tr>{[text.range, text.count, text.percentage, text.bar].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{histogram.ranges.map((range, index) => <tr key={index}><th scope="row">[{range.lower}, {range.upper}{range.upperInclusive ? ']' : ')'}</th><td>{range.count}</td><td>{percent(range.count, nonNull)}</td><td className="table-histogram-plot"><div aria-hidden="true" style={{ width: percent(range.count, peak) }}/></td></tr>)}</tbody></table><p className="muted">{text.scale}</p></>}
  </section>;
}
