import { useMemo, useState } from 'react';
import type { ServerMonitorSnapshot } from '../../shared/serverMonitor';
import { serverMonitorSessionSearchLimit, serverMonitorSessionView, type ServerMonitorSessionDirection, type ServerMonitorSessionSort } from '../serverMonitorSessions';
import { serverMonitorSessionsZh as t } from '../serverMonitorSessionsZh';
import { serverMonitorZhCN as monitor } from '../serverMonitorZh';
import '../serverMonitorSessions.css';

interface Props { section?: ServerMonitorSnapshot['sessions']; disabled?: boolean; }
/** 目标key由Dialog提供；同目标刷新/暂时不可用保留选择，目标换代或关闭卸载即丢弃旧回调。 */
export function ServerMonitorSessions({section,disabled=false}: Props) {
  const [query,setQuery] = useState(''), [sort,setSort] = useState<ServerMonitorSessionSort>('id'), [direction,setDirection] = useState<ServerMonitorSessionDirection>('asc');
  const view = useMemo(()=>serverMonitorSessionView(section?.status === 'available' ? section.value.rows : [],query,sort,direction),[section,query,sort,direction]);
  if (!section) return null;
  const value = (text: string | null) => text === null ? monitor.null : text === '' ? monitor.emptyString : text;
  return <section className="server-monitor-sessions">
    <h3>{monitor.sessions}</h3>
    <p>{t.scope}</p><p className="server-monitor-note">{t.sqlScope}</p>
    {section.status === 'unavailable' ? <p>{monitor.unavailable}：{section.reason}</p> : <>
      <div className="server-monitor-session-controls">
        <label>{t.search}<input type="search" aria-label={t.search} placeholder={t.placeholder} maxLength={serverMonitorSessionSearchLimit} value={query} disabled={disabled} onInput={event=>setQuery(event.currentTarget.value.slice(0,serverMonitorSessionSearchLimit))}/></label>
        <button type="button" disabled={disabled || !query} onClick={()=>setQuery('')}>{t.clear}</button>
        <div role="group" aria-label={t.sortBy}>
          <button type="button" disabled={disabled} aria-pressed={sort==='id'} onClick={()=>setSort('id')}>{t.byId}</button>
          <button type="button" disabled={disabled} aria-pressed={sort==='seconds'} onClick={()=>setSort('seconds')}>{t.bySeconds}</button>
          <button type="button" disabled={disabled} aria-label={direction==='asc'?t.toDescending:t.toAscending} onClick={()=>setDirection(old=>old==='asc'?'desc':'asc')}>{direction==='asc'?t.ascending:t.descending}</button>
        </div>
      </div>
      <p aria-live="polite">{t.counts(view.filtered,view.returned)}</p>
      {(section.value.truncated || view.capped) && <p>{monitor.limited}</p>}
      {!view.returned ? <p>{monitor.noSessions}</p> : !view.filtered && <p>{t.noMatches}</p>}
      <div className="server-monitor-table"><table><thead><tr>{monitor.sessionFields.map(label=><th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{view.rows.map(row=><tr key={row.id}>
        <td>{row.id}</td><td>{value(row.user)}</td><td>{value(row.host)}</td><td>{value(row.database)}</td><td>{value(row.command)}</td><td>{value(row.seconds)}</td><td>{value(row.state)}</td>
        <td><details><summary>{monitor.sqlDetail}</summary><pre>{value(row.sql)}</pre></details><span>{value(row.sqlLength)}{row.sqlTruncated?` · ${monitor.sqlLimited}`:''}</span></td>
      </tr>)}</tbody></table></div>
    </>}
  </section>;
}
