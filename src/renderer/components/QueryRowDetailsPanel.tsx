import { useMemo, useState } from 'react';
import { queryRowDetailPrefix, queryRowDetailValue, queryRowDetailsLimits, type QueryRowDetails, type QueryRowDetailsView } from '../queryRowDetails';
import { queryRowDetailsZh as text } from '../locales/queryRowDetails.zh-CN';
import '../queryRowDetails.css';

interface Props {
  controller: QueryRowDetails;
  view: QueryRowDetailsView;
  isCurrent(): boolean;
  onMove(view: QueryRowDetailsView, index: number): void;
  onClose(view: QueryRowDetailsView): void;
  sqlitePage?: { storageTypes?: string[] };
  pageNavigation?: { previous: boolean; next: boolean; move(view: QueryRowDetailsView, direction: -1 | 1): void };
}

/** 搜索词随当前结果保留；换行后重新创建行号、展开和字段分页状态。 */
export function QueryRowDetailsPanel(props: Props) {
  const [search, setSearch] = useState({ binding: props.view.binding, text: '' });
  const filter = search.binding === props.view.binding ? search.text : '';
  return <RowDetailsContent key={props.view.id} {...props} filter={filter} onFilter={text => setSearch({ binding: props.view.binding, text })}/>;
}

/** 内联只读区域不参与全局模态观察；每个迟到事件仍复核准确原行租约。 */
function RowDetailsContent({ controller, view, isCurrent, onMove, onClose, sqlitePage, pageNavigation, filter, onFilter }: Props & { filter: string; onFilter(text: string): void }) {
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState<number | null>(null), [row, setRow] = useState(String(view.index + 1));
  const current = () => isCurrent() && controller.valid(view);
  const columns = view.binding.metadata;
  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return columns.map((column, index) => ({ column, index })).filter(({ column }) => !needle || column.name.toLowerCase().includes(needle));
  }, [columns, filter]);
  if (!current()) return null;
  const lastPage = Math.max(0, Math.ceil(matching.length / queryRowDetailsLimits.page) - 1), start = page * queryRowDetailsLimits.page;
  const rowLabel = sqlitePage ? text.sqliteRow : text.row;
  const storage = sqlitePage?.storageTypes?.[view.index];
  const previousPage = view.index === 0 && pageNavigation?.previous, nextPage = view.index + 1 === view.binding.rows.length && pageNavigation?.next;
  /** 页内只翻已加载行；边界用明确的跨页文案并交回原父页核对来源。 */
  function move(direction: -1 | 1): void {
    if (!current()) return;
    if (direction === -1 ? previousPage : nextPage) pageNavigation?.move(view, direction);
    else onMove(view, view.index + direction);
  }
  /** 搜索范围始终是整行原列；重置页码和单值展开，避免展示上次匹配的字段。 */
  function changeFilter(value: string): void {
    if (!current()) return;
    setPage(0);
    setExpanded(null);
    onFilter(value);
  }
  return <section role="region" aria-label={sqlitePage ? text.sqlitePage : text.region} className="query-row-details">
    <header><strong>{text.open} · {view.index + 1} / {view.binding.rows.length}</strong><button onClick={() => { if (current()) onClose(view); }}>{text.close}</button></header>
    <p title={pageNavigation ? text.sqlitePageNavigation : text.readonly}>{text.scope}</p>{pageNavigation && <p>{text.sqlitePageNavigation}</p>}{view.binding.truncated && <p className="warning-text">{text.truncated}</p>}
    <div className="query-row-details-actions"><button disabled={view.index === 0 && !previousPage} onClick={() => move(-1)}>{previousPage ? text.sqlitePreviousPage : text.previous}</button><button disabled={view.index + 1 >= view.binding.rows.length && !nextPage} onClick={() => move(1)}>{nextPage ? text.sqliteNextPage : text.next}</button><label>{rowLabel}<input aria-label={rowLabel} value={row} inputMode="numeric" maxLength={6} onChange={event => { if (current()) setRow(event.target.value); }}/></label><button disabled={!/^[1-9][0-9]{0,5}$/u.test(row) || Number(row) > view.binding.rows.length} onClick={() => { if (current() && /^[1-9][0-9]{0,5}$/u.test(row) && Number(row) <= view.binding.rows.length) onMove(view, Number(row) - 1); }}>{text.go}</button></div>
    <div className="query-row-details-search"><input type="search" aria-label={text.fieldSearch} placeholder={text.fieldSearch} value={filter} maxLength={256} onChange={event => changeFilter(event.target.value)}/><button disabled={!filter} onClick={() => changeFilter('')}>{text.clearFieldSearch}</button></div>
    {!matching.length && <p role="status">{text.noFields}</p>}
    <div className="query-row-details-fields">{matching.slice(start, start + queryRowDetailsLimits.page).map(({ column, index }) => {
      const value = queryRowDetailValue(view.values[index], expanded === index);
      const storageType = storage?.[index] as keyof typeof text.sqliteStorage | undefined;
      return <article key={column.key}><h4 title={column.key}>{index + 1}. {queryRowDetailPrefix(column.name, 256)} <small>{storageType ? text.sqliteStorage[storageType] : queryRowDetailPrefix(column.type, 64)}</small></h4>{value.kind === 'binary' && <p>{text.binary}{value.units === 0 ? ' · 0' : ''}</p>}
        <pre>{value.kind === 'null' ? text.null : value.kind === 'empty' ? text.empty : value.text}</pre>{value.clipped && <p className="muted small">{value.units} UTF-16 · {expanded === index ? text.budget : text.preview}</p>}{value.units > queryRowDetailsLimits.preview && <button onClick={() => { if (current()) setExpanded(expanded === index ? null : index); }}>{expanded === index ? text.collapse : text.expand}</button>}</article>;
    })}</div><footer><button disabled={page === 0} onClick={() => { if (current() && page > 0) { setPage(page - 1); setExpanded(null); } }}>{text.fieldsPrevious}</button><span>{matching.length ? start + 1 : 0}–{Math.min(start + queryRowDetailsLimits.page, matching.length)} / {matching.length}</span><button disabled={page >= lastPage} onClick={() => { if (current() && page < lastPage) { setPage(page + 1); setExpanded(null); } }}>{text.fieldsNext}</button></footer>
  </section>;
}
