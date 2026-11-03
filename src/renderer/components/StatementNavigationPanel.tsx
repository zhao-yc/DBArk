import { useMemo, useState } from 'react';
import type { StatementNavigationView } from '../statementNavigationController';
import { currentNavigableStatement, statementNavigationPreview } from '../../shared/statementNavigation';
import { statementNavigationZh as text } from '../locales/statementNavigation.zh-CN';
import '../statementNavigation.css';

const pageSize = 10;
/** 目录只从捕获的原文生成预览和本地筛选；跳转始终由原模型owner确认。 */
export function StatementNavigationPanel({ source, dialect, view, cursor, position, onNavigate, onRefresh, onCancel, onClose }: {
  source: string; dialect: 'mysql' | 'mariadb' | 'sqlite'; view: StatementNavigationView; cursor: number;
  position(offset: number): { lineNumber: number; column: number }; onNavigate(index: number, select: boolean): void; onRefresh(): void; onCancel(): void; onClose(): void;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), result = view.result;
  const ranges = result?.status === 'ready' ? result.statements : undefined;
  const activeIndex = ranges ? currentNavigableStatement(source, ranges, cursor) : -1;
  const rows = useMemo(() => ranges?.map((range, index) => ({ range, index, preview: statementNavigationPreview(source, range, dialect) })).filter(row => !search || source.slice(row.range.start, row.range.end).toLowerCase().includes(search.toLowerCase())) ?? [], [ranges, source, search, dialect]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), actual = Math.min(page, pages - 1);
  return <section className="statement-navigation" aria-label={text.title}><header><strong>{text.title}</strong><span role="status">{view.busy ? text.loading : result?.status === 'ready' ? text.total(rows.length) : result ? text.reasons[result.reason] ?? text.unavailable : ''}</span><span className="grow"/>
    {view.busy ? <button onClick={onCancel}>{text.cancel}</button> : <button onClick={onRefresh}>{text.refresh}</button>}<button onClick={onClose}>{text.close}</button></header>
    <p className="muted small">{text.hint}</p>
    {ranges && <><input aria-label={text.search} placeholder={text.search} value={search} maxLength={200} onChange={event => { setSearch(event.target.value); setPage(0); }}/>
      <ol start={actual * pageSize + 1}>{rows.slice(actual * pageSize, (actual + 1) * pageSize).map(row => <li key={row.index} className={row.index === activeIndex ? 'active' : ''}>
        <button className="statement-navigation-target" aria-label={text.position(row.index, position(row.range.start).lineNumber)} title={row.preview} onClick={() => onNavigate(row.index, false)}><span>{text.position(row.index, position(row.range.start).lineNumber)}</span><code>{row.preview}</code></button>
        <button aria-label={`${text.select} ${row.index + 1}`} onClick={() => onNavigate(row.index, true)}>{text.select}</button>
      </li>)}</ol>{!rows.length && <p>{text.empty}</p>}
      {pages > 1 && <footer><button disabled={actual === 0} onClick={() => setPage(actual - 1)}>{text.previous}</button><span>{text.page(actual + 1, pages)}</span><button disabled={actual + 1 >= pages} onClick={() => setPage(actual + 1)}>{text.next}</button></footer>}
    </>}
  </section>;
}
