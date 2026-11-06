import { useEffect, useRef, useState } from 'react';
import { postgresTableReferenceLimits as limits, type PostgresRelatedTablePage } from '../../shared/postgresTable';
import { errorMessage, invoke } from '../lib';
import { postgresReferencePickerZh as text } from '../locales/postgresReferencePicker.zh-CN';
import { useWorkspace, type WorkspaceTab } from '../store';
import { PostgresReferenceRecord } from './PostgresReferenceRecord';
import { ResultsGrid } from './ResultsGrid';
import { ErrorBox, Spinner } from './ui';

/** 关联标签独立浏览会话能力下的行，只使用关联读取入口。 */
export function PostgresRelatedTableTab({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const target = { connectionId: tab.connectionId, database: tab.database ?? '', table: tab.table ?? '', tabId: tab.id };
  const version = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const [view, setView] = useState<{ data: PostgresRelatedTablePage; version: number }>();
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [row, setRow] = useState<number | null>(null), [detail, setDetail] = useState(false);
  const alive = useRef(false), started = useRef(false), pending = useRef(false);
  const data = view?.version === version ? view.data : undefined;
  const current = () => alive.current && (useWorkspace.getState().connectionVersions[tab.connectionId] ?? 0) === version;

  /** 迟到回包只能属于原标签与连接版本，失效时清空关联数据。 */
  async function load(offset: number, nextSearch?: string) {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setDetail(false);
    setRow(null);
    try {
      const next = await invoke('postgres.table.related', { ...target, operation: 'page', offset, search: nextSearch });
      if (!current()) return;
      if (!next) throw Error(text.relatedExpired);
      setView({ data: next, version });
      setSearch(next.search);
      if (!next.incoming && next.page.rows.length) setRow(0);
    } catch (reason) {
      if (current()) { setView(undefined); setError(errorMessage(reason)); }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void invoke('postgres.table.related', { ...target, operation: 'close' }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void load(0);
  }, [active]);

  const record = row === null ? undefined : data?.page.rows[row];
  const gridCurrent = () => active && current() && !pending.current && useWorkspace.getState().settings.activeTabId === tab.id;
  return <div className="workspace-tab postgres-related-table-tab" aria-label={text.relatedTab}>
    <div className="context-bar"><strong>{tab.title}</strong><span>{text.relatedHint}</span></div>
    <div className="pg-table-controls">
      <button type="button" disabled={busy || !active} onClick={() => void load(data?.offset ?? 0, data?.search)}>{text.relatedRefresh}</button>
      {data?.incoming && <form className="pg-page-jump" onSubmit={event => { event.preventDefault(); if (gridCurrent()) void load(0, search); }}>
        <input type="search" aria-label={text.childQuery} value={search} maxLength={limits.search} disabled={busy}
          onChange={event => setSearch(event.target.value)}/>
        <button type="submit" disabled={busy}>{text.childSearch}</button>
      </form>}
      {data?.incoming && <>
        <button type="button" disabled={busy || data.offset === 0}
          onClick={() => void load(Math.max(0, data.offset - limits.page), data.search)}>{text.childPrevious}</button>
        <button type="button" disabled={busy || !data.page.hasNext || data.offset + limits.page > limits.offset}
          onClick={() => void load(data.offset + limits.page, data.search)}>{text.childNext}</button>
      </>}
      <button type="button" disabled={busy || !record} onClick={() => { if (gridCurrent()) setDetail(value => !value); }}>
        {detail ? text.relatedBack : text.relatedRecord}
      </button>
    </div>
    {busy && <Spinner text={text.loading}/>}
    <ErrorBox message={error || (view && !data ? text.relatedExpired : '')}/>
    {data && !busy && <>
      <div className="tab-status"><span>{data.constraint}</span>
        {data.incoming && !!data.page.rows.length && <span>{text.childRange(data.offset, data.page.rows.length)}</span>}
      </div>
      {detail && record ? <PostgresReferenceRecord key={row} columns={data.page.columns} row={record}/>
        : data.page.rows.length ? <div className="pg-table-grid"><ResultsGrid
          columns={data.page.columns} rows={data.page.rows} onActiveRowIndexChange={setRow} isCurrent={gridCurrent}
          navigateTo={!data.incoming ? { row: 0, key: data.page.columns[0].key } : undefined}/></div>
          : <p>{data.incoming ? text.emptyChildren : text.emptyParent}</p>}
    </>}
  </div>;
}
