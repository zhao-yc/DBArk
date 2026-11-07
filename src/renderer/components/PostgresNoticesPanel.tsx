import { useMemo, useState } from 'react';
import type { PostgresNoticeEntry, PostgresNoticeReport } from '../../shared/postgresNotices';
import { postgresNoticesZh as text } from '../locales/postgresNotices.zh-CN';

/** 本次消息只读内存副本；展开、搜索和分页都不向数据库发送请求。 */
export function PostgresNoticesPanel({report, locateAvailable, onLocate}: {
  report: PostgresNoticeReport; locateAvailable(entry: PostgresNoticeEntry): boolean; onLocate(entry: PostgresNoticeEntry): void;
}) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? report.entries.filter(entry => [entry.severity, entry.sqlState, entry.message, entry.detail, entry.hint, entry.context]
      .some(value => value?.toLowerCase().includes(needle))) : report.entries;
  }, [report, search]);
  const pages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, pages - 1);
  return <details className="query-partial-outcome postgres-notices" aria-label={text.title}>
    <summary>{text.count(report.received)}</summary>
    <div style={{maxHeight: 'min(320px, 35vh)', overflow: 'auto', overflowWrap: 'anywhere', padding: '6px 8px'}}>
      <p>{text.retained(report.received, report.entries.length)}</p>
      {report.truncated && <p className="warning-text">{text.truncated}</p>}
      {report.redacted && <p>{text.redacted}</p>}
      <label className="field"><span>{text.search}</span><input type="search" aria-label={text.search} maxLength={200} value={search}
        onChange={event => { setSearch(event.target.value); setPage(0); }}/></label>
      {!filtered.length && <p>{text.empty}</p>}
      <ol>{filtered.slice(current * 25, (current + 1) * 25).map(entry => {
        const available = locateAvailable(entry);
        return <li key={entry.sequence}>
          <strong>{text.ordinal(entry.statementOrdinal)} · {entry.severity}{entry.sqlState ? ' · ' + entry.sqlState : ''}</strong>
          <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{entry.message || text.emptyMessage}</pre>
          {(['detail', 'hint', 'context'] as const).map(field => entry[field] && <details key={field}>
            <summary>{text[field]}</summary><pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{entry[field]}</pre>
          </details>)}
          {entry.truncated && <p>{text.fieldTruncated}</p>}
          <button disabled={!available} title={available ? text.locate(entry.statementOrdinal) : text.unavailable}
            onClick={() => { if (locateAvailable(entry)) onLocate(entry); }}>{text.locate(entry.statementOrdinal)}</button>
        </li>;
      })}</ol>
      {pages > 1 && <div className="postgres-result-actions">
        <button disabled={current === 0} onClick={() => setPage(current - 1)}>{text.previous}</button>
        <span>{text.page(current + 1, pages)}</span>
        <button disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>{text.next}</button>
      </div>}
    </div>
  </details>;
}
