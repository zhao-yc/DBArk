import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Database, RefreshCw, Table2 } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../../shared/contracts';
import { objectCategories, type ObjectCategory } from '../../shared/objectBrowser';
import { useWorkspace, type WorkspaceTab } from '../store';
import { errorMessage, invoke, kindLabels } from '../lib';
import { navigationZh as text } from '../locales/navigation.zh-CN';
import { SidebarTreeRow } from './SidebarContextMenu';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import '../navigation.css';

interface Props { tab: WorkspaceTab; active: boolean; refreshVersion: number; onOpen(object: DatabaseObject): void; onNewTable(): void; actions(object: DatabaseObject, refresh: () => void): ReactNode; }
/** 目录标签只读取元数据，固定行高虚拟滚动，不取得查询会话或自动执行用户SQL。 */
export function ObjectBrowser({ tab, active, refreshVersion, onOpen, onNewTable, actions }: Props) {
  const workspace = useWorkspace();
  const profile = workspace.connections.find(item => item.id === tab.connectionId), version = workspace.connectionVersions[tab.connectionId] ?? 0;
  const [objects, setObjects] = useState<DatabaseObject[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [descending, setDescending] = useState(false), [refresh, setRefresh] = useState(0);
  const [scrollTop, setScrollTop] = useState(0), [height, setHeight] = useState(400), viewport = useRef<HTMLDivElement>(null);
  const generation = useRef<object>({}), latest = useRef({ tab, active, profile, version }); latest.current = { tab, active, profile, version };
  const pageContext = useRef<{ tab: WorkspaceTab; profile: ConnectionProfile | undefined; version: number; active: boolean; valid: boolean } | undefined>(undefined);
  if (!pageContext.current || active && !pageContext.current.valid || pageContext.current.tab !== tab || pageContext.current.profile !== profile || pageContext.current.version !== version || pageContext.current.active !== active) pageContext.current = { tab, profile, version, active, valid: active };
  const pageOwner = pageContext.current;
  const catalog = useRef<{ owner: object; objects: DatabaseObject[]; profile: ConnectionProfile; version: number; connectionId: string; database: string } | undefined>(undefined);
  const category = tab.objectCategory ?? 'table';
  /** 页头动作也绑定原页面代次，目录读取失败不妨碍用户明确新建表。 */
  const contextCurrent = () => {
    const now = useWorkspace.getState();
    return pageContext.current === pageOwner && pageOwner.valid && active && !!profile && now.settings.activeTabId === tab.id
      && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile
      && (now.connectionVersions[tab.connectionId] ?? 0) === version && !document.querySelector('[role="dialog"], [role="alertdialog"]');
  };
  useLayoutEffect(() => {
    const off = useWorkspace.subscribe(() => {
      const now = useWorkspace.getState();
      if (now.settings.activeTabId !== tab.id || now.settings.tabs.find(item => item.id === tab.id) !== tab || now.connections.find(item => item.id === tab.connectionId) !== profile || (now.connectionVersions[tab.connectionId] ?? 0) !== version) pageOwner.valid = false;
    });
    return () => { pageOwner.valid = false; off(); };
  }, [pageOwner]);
  useEffect(() => {
    const owner = {}; generation.current = owner;
    if (!active || !profile || !tab.database) { setBusy(false); return; }
    const database = tab.database, connectionId = tab.connectionId;
    /** 每个await后核原页面、原连接和原目录代次，隐藏或换绑后只丢弃迟到回包。 */
    const current = () => {
      const now = useWorkspace.getState(), view = now.settings.tabs.find(item => item.id === tab.id);
      return generation.current === owner && latest.current.active && now.settings.activeTabId === tab.id
        && view === tab && view.kind === 'objects' && view.connectionId === connectionId && view.database === database
        && now.connections.find(item => item.id === connectionId) === profile && (now.connectionVersions[connectionId] ?? 0) === version;
    };
    // 订阅每次同步store通知，A→B→A或删除后恢复同名标签也不能复活原请求。
    const unsubscribe = useWorkspace.subscribe(() => {
      if (generation.current !== owner || current()) return;
      generation.current = {}; catalog.current = undefined; setObjects([]); setBusy(false); setError(text.stale);
    });
    setBusy(true); setObjects([]); setError('');
    void invoke('connections.open', { id: connectionId }).then(() => current() ? invoke('metadata.objects', { connectionId, database }) : undefined)
      .then(next => { if (next && current()) { catalog.current = { owner, objects: next, profile, version, connectionId, database }; setObjects(next); } }, reason => { if (current()) setError(errorMessage(reason)); })
      .finally(() => { if (current()) setBusy(false); });
    return () => { unsubscribe(); if (generation.current === owner) generation.current = {}; };
  }, [active, profile, version, tab, refreshVersion, refresh]);
  useLayoutEffect(() => {
    const node = viewport.current; if (!node) return;
    const observer = new ResizeObserver(() => setHeight(node.clientHeight)); observer.observe(node); setHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (viewport.current) viewport.current.scrollTop = 0; setScrollTop(0); }, [category, search, descending]);
  const filtered = useMemo(() => objects.filter(object => (category === 'routine' ? object.kind === 'procedure' || object.kind === 'function' : object.kind === category)
    && object.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => (descending ? -1 : 1) * (a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))), [objects, category, search, descending]);
  const start = Math.max(0, Math.floor(scrollTop / 31) - 5), count = Math.ceil(height / 31) + 10;
  const reload = () => { generation.current = {}; setRefresh(value => value + 1); };
  /** 刷新意图在React提交前已撤销旧目录；原行菜单不得趁此窗口使用旧动作。 */
  const actionCurrent = () => {
    const proof = catalog.current, now = useWorkspace.getState(), current = latest.current;
    return contextCurrent() && !!proof && proof.owner === generation.current && proof.objects === objects && current.active && now.settings.activeTabId === tab.id
      && current.tab.connectionId === proof.connectionId && current.tab.database === proof.database
      && now.connections.find(item => item.id === proof.connectionId) === proof.profile && (now.connectionVersions[proof.connectionId] ?? 0) === proof.version;
  };
  return <div className="workspace-tab object-browser" aria-label={text.objects}>
    <div className="object-browser-header"><Database size={16}/><strong title={`${profile?.name ?? tab.connectionId} / ${tab.database}`}>{profile?.name ?? tab.connectionId} / {tab.database}</strong><span className="grow"/>
      {profile?.dialect !== 'sqlite' && category === 'table' && <button disabled={busy || !profile} onClick={() => { if (contextCurrent()) onNewTable(); }}>{text.newTable}</button>}<button disabled={busy || !profile} onClick={() => { if (contextCurrent()) reload(); }}><RefreshCw size={13}/>{text.refresh}</button></div>
    <div className="object-browser-filter"><select aria-label={text.type} value={category} onChange={event => { if (contextCurrent()) useWorkspace.getState().updateTab(tab.id, { objectCategory: event.target.value as ObjectCategory }); }}>
      {objectCategories.filter(kind => profile?.dialect !== 'sqlite' || kind === 'table' || kind === 'view' || kind === 'trigger').map(kind => <option key={kind} value={kind}>{text.categories[kind]}</option>)}</select>
      <input aria-label={text.search} placeholder={text.search} value={search} onChange={event => setSearch(event.target.value)}/>{busy && <Spinner/>}</div>
    <ErrorBox message={error}/><div className="object-browser-columns"><button onClick={() => setDescending(value => !value)}>{text.name} {descending ? '↓' : '↑'}</button><span className="object-browser-kind">{text.type}</span></div>
    <div className="object-browser-grid objects-browser-scroll" ref={viewport} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
      {!filtered.length && !busy ? <div className="object-browser-empty">{text.noObjects}</div> : <div style={{ height: filtered.length * 31, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * 31, left: 0, right: 0 }}>{filtered.slice(start, start + count).map(object => {
          const target = { connectionId: tab.connectionId, database: tab.database!, kind: object.kind, name: object.name };
          return <SidebarTreeRow key={JSON.stringify([object.kind, object.name])} target={target} label={object.name} className="object-list-row" version={[objects, busy, search, category, descending, version, refreshVersion]} isCurrent={actionCurrent}
            actions={actions(object, reload)}><button className="tree-label" onDoubleClick={() => { if (actionCurrent()) onOpen(object); }}>
              <Table2 size={14}/><span>{object.name}</span><span className="grow"/><small className="object-browser-kind">{kindLabels[object.kind]}</small></button></SidebarTreeRow>;
        })}</div></div>}
    </div><div className="object-browser-footer">{text.records(filtered.length, objects.length)}</div>
  </div>;
}

/** 没有明确数据库时先由用户选择；仅点击读取按钮才连接并读取目录，不猜测活动查询的库。 */
export function ObjectDatabasePicker({ connections, preferredConnectionId, onOpen, onClose }: { connections: readonly ConnectionProfile[]; preferredConnectionId?: string; onOpen(connectionId: string, database: string): void; onClose(): void }) {
  const [connectionId, setConnectionId] = useState(preferredConnectionId ?? ''), [database, setDatabase] = useState(''), [databases, setDatabases] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const owner = useRef<object>({}), alive = useRef(true), closed = useRef(false), loading = useRef(false), checked = useRef<{ profile: ConnectionProfile; version: number } | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; owner.current = {}; }; }, []);
  /** 切换立即撤销原目录和打开许可，旧请求即使成功也不能替新连接选择数据库。 */
  function change(id: string) { owner.current = {}; checked.current = undefined; loading.current = false; setConnectionId(id); setDatabase(''); setDatabases([]); setBusy(false); setError(''); }
  async function read() {
    const now = useWorkspace.getState(), profile = now.connections.find(item => item.id === connectionId); if (!alive.current || closed.current || !profile || loading.current) return; loading.current = true;
    const version = now.connectionVersions[connectionId] ?? 0, token = {}; owner.current = token; checked.current = undefined; setBusy(true); setError('');
    const current = () => alive.current && !closed.current && owner.current === token && useWorkspace.getState().connections.find(item => item.id === connectionId) === profile
      && (useWorkspace.getState().connectionVersions[connectionId] ?? 0) === version;
    try {
      await invoke('connections.open', { id: connectionId }); if (!current()) return;
      const next = await invoke('metadata.databases', { connectionId }); if (!current()) return;
      checked.current = { profile, version }; setDatabases(next); setDatabase('');
    } catch (reason) { if (current()) setError(errorMessage(reason)); }
    finally { if (owner.current === token) { loading.current = false; if (alive.current) setBusy(false); } }
  }
  function open() {
    const proof = checked.current, now = useWorkspace.getState();
    if (!alive.current || closed.current || loading.current) return;
    if (!proof || !databases.includes(database) || now.connections.find(item => item.id === connectionId) !== proof.profile || (now.connectionVersions[connectionId] ?? 0) !== proof.version) { setError(text.stale); return; }
    closed.current = true; owner.current = {};
    onOpen(connectionId, database);
  }
  function close() { if (closed.current) return; closed.current = true; owner.current = {}; onClose(); }
  return <Modal title={text.pickTitle} onClose={close}><div className="modal-content">
    <Field label={text.pickConnection}><select aria-label={text.pickConnection} value={connectionId} disabled={busy} onChange={event => change(event.target.value)}><option value="">{text.selectConnection}</option>{connections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <button disabled={!connectionId || busy} onClick={() => void read()}>{text.readDatabases}</button>
    <Field label={text.pickDatabase}><select aria-label={text.pickDatabase} value={database} disabled={busy || !databases.length} onChange={event => setDatabase(event.target.value)}><option value="">{text.selectDatabase}</option>{databases.map(name => <option key={name}>{name}</option>)}</select></Field>
    {busy && <Spinner/>}<ErrorBox message={error}/></div><footer className="modal-footer"><button onClick={close}>{text.cancel}</button><span className="grow"/><button className="primary" disabled={busy || !database} onClick={open}>{text.open}</button></footer></Modal>;
}
