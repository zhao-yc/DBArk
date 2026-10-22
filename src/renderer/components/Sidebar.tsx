import { databaseDropZh } from '../locales/databaseDrop.zh-CN';
import { isProtectedDatabaseDropName } from '../../shared/databaseDrop';
import { tableCopyDataZh } from '../locales/tableCopyData.zh-CN';
import { tableCopyStructureZh } from '../locales/tableCopyStructure.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { connectionGroups } from '../connectionGroups';
import { connectionOrganizationZh } from '../../shared/connectionOrganization.zh-CN';
import { useEffect, useRef, useState } from 'react';
import { FavoriteButton, WorkbenchShelf, type OpenWorkbenchTarget } from './Workbench';
import { ChevronDown, ChevronRight, Database, Table2, Search, Plus, Pencil, RefreshCw, FileCode2, Folder, Unplug, Trash2, Copy } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../../shared/contracts';
import { errorMessage, invoke, kindLabels } from '../lib';
import { useWorkspace } from '../store';
import { Spinner } from './ui';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { tableRenameZh } from '../locales/tableRename.zh-CN';
import { tableCommentZh } from '../locales/tableComment.zh-CN';
import { databaseDefaultEncodingZh } from '../locales/databaseDefaultEncoding.zh-CN';
import { tableDefaultEncodingZh } from '../locales/tableDefaultEncoding.zh-CN';
import { connectionsTransferZh } from '../locales/connectionsTransfer.zh-CN';
import { completionServerFacts } from '../completionServerFacts';
import { beginSidebarConnectionEnd, sidebarConnectionEnd, SidebarNodeRequests } from '../sidebarNodeRequests';
import { tableAutoIncrementZh } from '../locales/tableAutoIncrement.zh-CN';

/** 节点请求始终读取同步连接修订；卸载或重挂载只撤销旧结果，不动后端共享连接。 */
function useNodeRequests(connectionId: string): SidebarNodeRequests {
  const ref = useRef<SidebarNodeRequests | null>(null);
  ref.current ??= new SidebarNodeRequests(() => useWorkspace.getState().connectionVersions[connectionId] ?? 0);
  const requests = ref.current;
  useEffect(() => { requests.activate(); return () => requests.dispose(); }, [requests]);
  return requests;
}

/** 按连接分组展示对象树，只对用户展开的节点加载数据库元数据。 */
export function Sidebar({ onNewConnection, onEditConnection, onCopyConnection, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onTableRename, onTableAutoIncrement, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onDdl, onOpenWorkbench, refreshVersion, objectRefreshVersions = {}, connectionRefreshVersions = {} }: { onNewConnection: () => void; onEditConnection: (profile: ConnectionProfile) => void; onCopyConnection: (profile: ConnectionProfile) => void; onDesign: (connectionId: string, database: string, table?: string) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onTableCopyData?: (connectionId: string, database: string, table: string) => void; onTableCopyStructure?: (connectionId: string, database: string, table: string) => void; onTableRename: (connectionId: string, database: string, table: string) => void; onTableAutoIncrement: (connectionId: string, database: string, table: string) => void; onTableComment: (connectionId: string, database: string, table: string) => void; onDatabaseDefaultEncoding?: (connectionId: string, database: string) => void; onDatabaseDrop?: (connectionId: string, database: string) => void; onTableDefaultEncoding: (connectionId: string, database: string, table: string) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject) => void; onOpenWorkbench: OpenWorkbenchTarget; refreshVersion: number; objectRefreshVersions?: Record<string, number>; connectionRefreshVersions?: Record<string, number> }) {
  const connections = useWorkspace(state => state.connections); const connectionVersions = useWorkspace(state => state.connectionVersions); const [search, setSearch] = useState('');
  // 分组标题与连接必须是同一层兄弟；换组只移动原节点，不撤销展开树、忙碌请求或已连接事实。
  const groups = connectionGroups(connections);
  return <aside className="sidebar"><div className="sidebar-heading"><span>{zh.sidebar.text002}</span><button className="icon-button" aria-label={zh.common.newConnection} title={zh.common.newConnection} onClick={onNewConnection}><Plus size={17}/></button></div><div className="search-box"><Search size={14}/><input aria-label={zh.sidebar.text003} value={search} onChange={event => setSearch(event.target.value)} placeholder={zh.sidebar.text004}/><kbd>⌕</kbd></div><div className="tree-scroll"><WorkbenchShelf onOpen={onOpenWorkbench}/>{groups.flatMap(group => [<div className="group-label connection-group-heading" key={`connection-group:${JSON.stringify(group.name)}`}><Folder size={13}/>{connectionOrganizationZh.groupDisplay(group.name)}</div>, ...group.connections.map((profile, index) => <ConnectionNode groupEnd={index === group.connections.length - 1} key={`${profile.id}:${refreshVersion}:${connectionVersions[profile.id] ?? 0}:${connectionRefreshVersions[profile.id] ?? 0}`} profile={profile} search={search} onEdit={() => onEditConnection(profile)} onCopy={() => onCopyConnection(profile)} onDesign={onDesign} onColumnPatches={onColumnPatches} onIndexPatches={onIndexPatches} onForeignKeyPatches={onForeignKeyPatches} onTableCopyData={onTableCopyData} onTableCopyStructure={onTableCopyStructure} onTableRename={onTableRename} onTableAutoIncrement={onTableAutoIncrement} onTableComment={onTableComment} onTableDefaultEncoding={onTableDefaultEncoding} onDatabaseDefaultEncoding={onDatabaseDefaultEncoding} onDatabaseDrop={onDatabaseDrop} onDdl={onDdl} objectRefreshVersions={objectRefreshVersions}/>)])}{connections.length === 0 && <div className="sidebar-empty"><Database size={30}/><p>{zh.sidebar.text005}</p><button onClick={onNewConnection}><Plus size={14}/>{zh.common.newConnection}</button></div>}</div><div className="sidebar-bottom"><span className="status-dot"/>{zh.sidebar.text006}<span className="grow"/><span>{connections.length}{zh.sidebar.text007}</span></div></aside>;
}

/** 连接节点维护展开状态及数据库列表；groupEnd仅保留原组尾间距，不参与节点身份或请求生命周期。 */
function ConnectionNode({ groupEnd = false, profile, search, onEdit, onCopy, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onTableRename, onTableAutoIncrement, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onDdl, objectRefreshVersions }: { groupEnd?: boolean; objectRefreshVersions: Record<string, number>; profile: ConnectionProfile; search: string; onEdit: () => void; onCopy: () => void; onDesign: (connectionId: string, database: string, table?: string) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onTableCopyData?: (connectionId: string, database: string, table: string) => void; onTableCopyStructure?: (connectionId: string, database: string, table: string) => void; onTableRename: (connectionId: string, database: string, table: string) => void; onTableAutoIncrement: (connectionId: string, database: string, table: string) => void; onTableComment: (connectionId: string, database: string, table: string) => void; onDatabaseDefaultEncoding?: (connectionId: string, database: string) => void; onDatabaseDrop?: (connectionId: string, database: string) => void; onTableDefaultEncoding: (connectionId: string, database: string, table: string) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject) => void }) {
  const [databases, setDatabases] = useState<string[]>([]); const [opened, setOpened] = useState(false); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false);
  const requests = useNodeRequests(profile.id), openedRef = useRef(false);
  const selection = useWorkspace(state => state.selection);
  /** 同轮连续点击也看到最新展开意图，不等待React提交后才撤销加载。 */
  function expand(value: boolean) { openedRef.current = value; setOpened(value); }
  /** 折叠不关闭连接，迟到加载仅失去本节点的状态写入权。 */
  function toggle() { useWorkspace.getState().select({ connectionId: profile.id }); if (openedRef.current || requests.kind === 'load') { if (requests.collapse()) { expand(false); setBusy(false); } } else void load(); }
  /** 先验证连接再列出可访问数据库，失败时保留可重试的节点入口。 */
  async function load() {
    const request = requests.begin('load'); if (!request) return;
    setBusy(true);
    let ticket: ReturnType<typeof completionServerFacts.begin> | undefined;
    try {
      // 结束屏障可能被另一项明确操作接续，恢复前重新核对当前屏障及本次意图。
      for (let ending = sidebarConnectionEnd(profile.id); ending; ending = sidebarConnectionEnd(profile.id)) { await ending; if (!requests.current(request)) return; }
      if (!requests.current(request)) return;
      ticket = completionServerFacts.begin(profile.id, useWorkspace.getState().connectionVersions[profile.id] ?? 0);
      const status = await invoke('connections.open', { id: profile.id });
      if (!requests.current(request)) return;
      completionServerFacts.complete(ticket, status); setConnected(true);
      const next = await invoke('metadata.databases', { connectionId: profile.id });
      if (!requests.current(request)) return;
      setDatabases(next); expand(true);
    } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    finally { if (ticket) completionServerFacts.fail(ticket); if (requests.finish(request)) setBusy(false); }
  }
  /** 明确断开立即撤销加载意图，成功后折叠；后端失败保持原连接状态与真实错误。 */
  async function disconnect() {
    const ending = beginSidebarConnectionEnd(profile.id); if (!ending) return;
    const request = requests.begin('disconnect'); if (!request) { ending.release(); return; }
    setBusy(true);
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.close', { id: profile.id }); if (requests.current(request)) { setConnected(false); expand(false); } } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    // 后端可能已关闭会话再报告取消收尾错误；仅当前节点清本代事实，不能清除新节点的事实。
    finally { if (requests.current(request)) completionServerFacts.clear(profile.id); ending.release(); if (requests.finish(request)) setBusy(false); }
  }
  /** 删除操作仅作用于本地连接配置，执行前明确提示不会删除数据库。 */
  async function remove() {
    if (!window.confirm(formatText(zh.sidebar.text008, profile.name))) return;
    const ending = beginSidebarConnectionEnd(profile.id); if (!ending) return;
    const request = requests.begin('remove'); if (!request) { ending.release(); return; }
    setBusy(true);
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.delete', { id: profile.id }); if (!requests.current(request)) return; const next = await invoke('connections.list', {}); if (requests.current(request)) useWorkspace.getState().setConnections(next); } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    finally { if (requests.current(request)) completionServerFacts.clear(profile.id); ending.release(); if (requests.finish(request)) setBusy(false); }
  }
  const matches = profile.name.toLowerCase().includes(search.toLowerCase());
  if (search && !matches && !opened) return null;
  return <div className="connection-node" style={groupEnd ? { marginBottom: 10 } : undefined}><div className={`tree-row connection-row ${selection?.connectionId === profile.id && !selection.database ? 'active' : ''}`}><button className="tree-label" aria-expanded={opened} aria-busy={busy} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={toggle}><span className="tree-chevron">{opened ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</span><Database size={16} style={{ color: profile.color }}/><span className="truncate">{profile.name}</span>{connected && <span className="connection-dot"/>}</button><div className="row-actions"><button title={connectionsTransferZh.copy} aria-label={formatText(connectionsTransferZh.copyAction, profile.name)} onClick={onCopy}><Copy size={12}/></button><button title={zh.sidebar.text009} aria-label={formatText(zh.sidebar.text010, profile.name)} onClick={onEdit}><Pencil size={12}/></button><button title={zh.sidebar.text011} aria-label={zh.sidebar.text011} disabled={busy} onClick={() => void load()}><RefreshCw size={12}/></button><button title={zh.sidebar.text012} aria-label={zh.sidebar.text012} onClick={() => onDdl(profile.id)}><Plus size={12}/></button>{connected && <button title={zh.sidebar.text013} aria-label={zh.sidebar.text013} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={() => void disconnect()}><Unplug size={12}/></button>}<button title={zh.sidebar.text014} aria-label={zh.sidebar.text014} disabled={requests.kind === 'disconnect' || requests.kind === 'remove'} onClick={() => void remove()}><Trash2 size={12}/></button></div></div>{busy && <div className="tree-loading"><Spinner text={zh.sidebar.text015}/></div>}{opened && !busy && databases.map(database => <DatabaseNode refreshVersion={objectRefreshVersions[JSON.stringify([profile.id, database])] ?? 0} key={database} connectionId={profile.id} database={database} search={matches ? '' : search} onColumnPatches={table => onColumnPatches(profile.id, database, table)} onIndexPatches={table => onIndexPatches(profile.id, database, table)} onForeignKeyPatches={table => onForeignKeyPatches(profile.id, database, table)} onTableCopyData={onTableCopyData ? table => onTableCopyData(profile.id, database, table) : undefined} onTableCopyStructure={onTableCopyStructure ? table => onTableCopyStructure(profile.id, database, table) : undefined} onTableRename={table => onTableRename(profile.id, database, table)} onTableAutoIncrement={table => onTableAutoIncrement(profile.id, database, table)} onTableComment={table => onTableComment(profile.id, database, table)} onTableDefaultEncoding={table => onTableDefaultEncoding(profile.id, database, table)} onDatabaseDefaultEncoding={onDatabaseDefaultEncoding ? () => onDatabaseDefaultEncoding(profile.id, database) : undefined} onDatabaseDrop={onDatabaseDrop ? () => onDatabaseDrop(profile.id, database) : undefined} onDesign={table => onDesign(profile.id, database, table)} onDdl={object => onDdl(profile.id, database, object)}/>)}</div>;
}

/** 数据库节点按对象种类选择数据浏览或定义编辑入口。 */
function DatabaseNode({ connectionId, database, search, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onTableRename, onTableAutoIncrement, onTableComment, onTableDefaultEncoding, onDatabaseDefaultEncoding, onDatabaseDrop, onDdl, refreshVersion = 0 }: { refreshVersion?: number; connectionId: string; database: string; search: string; onDesign: (table?: string) => void; onColumnPatches: (table: string) => void; onIndexPatches: (table: string) => void; onForeignKeyPatches: (table: string) => void; onTableCopyData?: (table: string) => void; onTableCopyStructure?: (table: string) => void; onTableRename: (table: string) => void; onTableAutoIncrement: (table: string) => void; onTableComment: (table: string) => void; onDatabaseDefaultEncoding?: () => void; onDatabaseDrop?: () => void; onTableDefaultEncoding: (table: string) => void; onDdl: (object?: DatabaseObject) => void }) {
  const [open, setOpen] = useState(false); const [objects, setObjects] = useState<DatabaseObject[]>([]); const [busy, setBusy] = useState(false);
  const requests = useNodeRequests(connectionId), openRef = useRef(false);
  const selection = useWorkspace(state => state.selection);
  /** 保留同步展开意图，刷新中的折叠立即撤销旧回包。 */
  function expand(value: boolean) { openRef.current = value; setOpen(value); }
  /** 选择数据库仍走原工作区入口，不重放已取消的目录请求。 */
  function toggle() { useWorkspace.getState().select({ connectionId, database }); if (openRef.current || requests.kind === 'load') { if (requests.collapse()) { expand(false); setBusy(false); } } else void load(); }
  const observedRefresh = useRef(refreshVersion);
  // 重命名事件仅重读实际目录，保留当前展开意图；请求归属仍交由统一节点请求门管理。
  useEffect(() => { if (observedRefresh.current !== refreshVersion) { observedRefresh.current = refreshVersion; void load(false); } }, [refreshVersion]);
  /** 只读取当前数据库对象列表，避免加载未展开数据库的全部字段。 */
  async function load(reveal = true) {
    // 结构变化必须重读目录，不能被改名前的在途加载吞掉；普通按钮连点仍只发一次。
    const request = requests.begin('load', !reveal); if (!request) return;
    setBusy(true);
    try { for (let ending = sidebarConnectionEnd(connectionId); ending; ending = sidebarConnectionEnd(connectionId)) { await ending; if (!requests.current(request)) return; } if (!requests.current(request)) return; const next = await invoke('metadata.objects', { connectionId, database }); if (requests.current(request)) { setObjects(next); if (reveal) expand(true); } }
    catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    finally { if (requests.finish(request)) setBusy(false); }
  }
  const visible = objects.filter(object => object.name.toLowerCase().includes(search.toLowerCase()));
  return <div><div className={`tree-row database-row ${selection?.connectionId === connectionId && selection.database === database ? 'active' : ''}`}><button className="tree-label" aria-expanded={open} aria-busy={busy} onClick={toggle}><span className="tree-chevron">{open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span><Database size={13}/><span className="truncate">{database}</span></button><div className="row-actions"><FavoriteButton target={{ connectionId, database, kind: 'database' }}/>{onDatabaseDrop && <button title={databaseDropZh.title} aria-label={`${databaseDropZh.title} ${database}`} disabled={isProtectedDatabaseDropName(database)} onClick={onDatabaseDrop}><Trash2 size={12}/></button>}{onDatabaseDefaultEncoding && <button title={databaseDefaultEncodingZh.title} aria-label={`${databaseDefaultEncodingZh.entry} ${database}`} onClick={onDatabaseDefaultEncoding}><Pencil size={12}/></button>}<button title={zh.common.newQuery} aria-label={zh.sidebar.text016} onClick={() => useWorkspace.getState().openTab({ title: zh.common.unnamedQuery, kind: 'query', connectionId, database, sql: '' })}><FileCode2 size={12}/></button><button title={zh.sidebar.text017} aria-label={zh.sidebar.text017} onClick={() => onDesign()}><Plus size={12}/></button><button title={zh.sidebar.text018} aria-label={zh.sidebar.text018} disabled={busy} onClick={() => void load()}><RefreshCw size={12}/></button><button title={zh.sidebar.text019} aria-label={zh.sidebar.text019} onClick={() => onDdl()}><Pencil size={12}/></button></div></div>{busy && <div className="tree-loading"><Spinner/></div>}{open && !busy && <div className="object-list">{visible.map(object => <div className="tree-row object-row" key={`${object.kind}:${object.name}`}><button className="tree-label" title={`${kindLabels[object.kind]} · ${object.name}`} onClick={() => { useWorkspace.getState().select({ connectionId, database }); if (object.kind === 'table' || object.kind === 'view') useWorkspace.getState().openTab({ kind: 'table', title: object.name, connectionId, database, table: object.name }); else onDdl(object); }}>{object.kind === 'table' ? <Table2 size={13}/> : <FileCode2 size={13}/>}<span className="truncate">{object.name}</span><span className="object-kind">{object.kind === 'table' ? '' : kindLabels[object.kind]}</span></button><div className="row-actions"><FavoriteButton target={{ connectionId, database, kind: object.kind, name: object.name }}/>{object.kind === 'table' && <button title={tableDefaultEncodingZh.title} aria-label={`${tableDefaultEncodingZh.title} ${object.name}`} onClick={() => onTableDefaultEncoding(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && onTableCopyData && <button title={tableCopyDataZh.title} aria-label={`${tableCopyDataZh.title} ${object.name}`} onClick={() => onTableCopyData(object.name)}><Copy size={12}/></button>}{object.kind === 'table' && onTableCopyStructure && <button title={tableCopyStructureZh.title} aria-label={`${tableCopyStructureZh.title} ${object.name}`} onClick={() => onTableCopyStructure(object.name)}><Copy size={12}/></button>}{object.kind === 'table' && <button title={tableRenameZh.title} aria-label={`${tableRenameZh.title} ${object.name}`} onClick={() => onTableRename(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && <button title={tableAutoIncrementZh.title} aria-label={`${tableAutoIncrementZh.title} ${object.name}`} onClick={() => onTableAutoIncrement(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && <button title={tableCommentZh.title} aria-label={`${tableCommentZh.title} ${object.name}`} onClick={() => onTableComment(object.name)}><Pencil size={12}/></button>}{object.kind === 'table' && <button title={foreignKeyPatchZh.title} aria-label={`${foreignKeyPatchZh.title} ${object.name}`} onClick={() => onForeignKeyPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button title={indexPatchZh.title} aria-label={`${indexPatchZh.title} ${object.name}`} onClick={() => onIndexPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button title={columnPatchZh.title} aria-label={`${columnPatchZh.title} ${object.name}`} onClick={() => onColumnPatches(object.name)}><Pencil size={12}/></button>}<button title={object.kind === 'table' ? zh.sidebar.text020 : zh.sidebar.text021} aria-label={formatText(zh.sidebar.text022, object.name)} onClick={() => object.kind === 'table' ? onDesign(object.name) : onDdl(object)}><Pencil size={12}/></button></div></div>)}{!visible.length && <span className="tree-hint">{search ? zh.sidebar.text023 : zh.sidebar.text024}</span>}</div>}</div>;
}
