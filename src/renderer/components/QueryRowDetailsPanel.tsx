import { useState } from 'react';
import { queryRowDetailPrefix, queryRowDetailValue, queryRowDetailsLimits, type QueryRowDetails, type QueryRowDetailsView } from '../queryRowDetails';
import { queryRowDetailsZh as text } from '../locales/queryRowDetails.zh-CN';
import '../queryRowDetails.css';

/** 内联只读region不参与全局modal观察；每个迟到事件仍复核准确原行租约。 */
export function QueryRowDetailsPanel({ controller, view, isCurrent, onMove, onClose }: { controller: QueryRowDetails; view: QueryRowDetailsView; isCurrent(): boolean; onMove(view: QueryRowDetailsView, index: number): void; onClose(view: QueryRowDetailsView): void }) {
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState<number | null>(null), [row, setRow] = useState(String(view.index + 1));
  const current = () => isCurrent() && controller.valid(view);
  if (!current()) return null;
  const columns = view.binding.columns, lastPage = Math.ceil(columns.length / queryRowDetailsLimits.page) - 1, start = page * queryRowDetailsLimits.page;
  return <section role="region" aria-label={text.region} className="query-row-details">
    <header><strong>{text.open} · {view.index + 1} / {view.binding.rows.length}</strong><button onClick={() => { if (current()) onClose(view); }}>{text.close}</button></header>
    <p>{text.scope}</p><p className="muted small">{text.readonly}</p>{view.binding.truncated && <p className="warning-text">{text.truncated}</p>}
    <div className="query-row-details-actions"><button disabled={view.index === 0} onClick={() => { if (current()) onMove(view, view.index - 1); }}>{text.previous}</button><button disabled={view.index + 1 >= view.binding.rows.length} onClick={() => { if (current()) onMove(view, view.index + 1); }}>{text.next}</button><label>{text.row}<input aria-label={text.row} value={row} inputMode="numeric" maxLength={6} onChange={event => { if (current()) setRow(event.target.value); }}/></label><button disabled={!/^[1-9][0-9]{0,5}$/u.test(row) || Number(row) > view.binding.rows.length} onClick={() => { if (current() && /^[1-9][0-9]{0,5}$/u.test(row) && Number(row) <= view.binding.rows.length) onMove(view, Number(row) - 1); }}>{text.go}</button></div>
    <div className="query-row-details-fields">{columns.slice(start, start + queryRowDetailsLimits.page).map((column, offset) => {
      const index = start + offset, value = queryRowDetailValue(view.values[index], expanded === index);
      return <article key={column.key}><h4>{index + 1}. {queryRowDetailPrefix(column.name, 256)} <small>{queryRowDetailPrefix(column.type, 64)}</small></h4><small>key: {queryRowDetailPrefix(column.key, 256)}</small>{value.kind === 'binary' && <p>{text.binary}{value.units === 0 ? ' · 0' : ''}</p>}
        <pre>{value.kind === 'null' ? text.null : value.kind === 'empty' ? text.empty : value.text}</pre>{value.clipped && <p className="muted small">{value.units} UTF-16 · {expanded === index ? text.budget : text.preview}</p>}{value.units > queryRowDetailsLimits.preview && <button onClick={() => { if (current()) setExpanded(expanded === index ? null : index); }}>{expanded === index ? text.collapse : text.expand}</button>}</article>;
    })}</div><footer><button disabled={page === 0} onClick={() => { if (current() && page > 0) { setPage(page - 1); setExpanded(null); } }}>{text.fieldsPrevious}</button><span>{start + 1}–{Math.min(start + queryRowDetailsLimits.page, columns.length)} / {columns.length}</span><button disabled={page >= lastPage} onClick={() => { if (current() && page < lastPage) { setPage(page + 1); setExpanded(null); } }}>{text.fieldsNext}</button></footer>
  </section>;
}
