import { zh, formatText } from '../locales/zh-CN';
import { useState } from 'react';
import { FavoriteButton, WorkbenchShelf, type OpenWorkbenchTarget } from './Workbench';
import { ChevronDown, ChevronRight, Database, Table2, Search, Plus, Pencil, RefreshCw, FileCode2, Folder, Unplug, Trash2, Copy } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../../shared/contracts';
import { errorMessage, invoke, kindLabels } from '../lib';
import { useWorkspace } from '../store';
import { Spinner } from './ui';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { connectionsTransferZh } from '../locales/connectionsTransfer.zh-CN';
import { completionServerFacts } from '../completionServerFacts';

/** 按连接分组展示对象树，只对用户展开的节点加载数据库元数据。 */
export function Sidebar({ onNewConnection, onEditConnection, onCopyConnection, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onDdl, onOpenWorkbench, refreshVersion }: { onNewConnection: () => void; onEditConnection: (profile: ConnectionProfile) => void; onCopyConnection: (profile: ConnectionProfile) => void; onDesign: (connectionId: string, database: string, table?: string) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject) => void; onOpenWorkbench: OpenWorkbenchTarget; refreshVersion: number }) {
  const connections = useWorkspace(state => state.connections); const connectionVersions = useWorkspace(state => state.connectionVersions); const [search, setSearch] = useState('');
  const groups = [...new Set(connections.map(profile => profile.group || zh.sidebar.text001))];
  return <aside className="sidebar"><div className="sidebar-heading"><span>{zh.sidebar.text002}</span><button className="icon-button" aria-label={zh.common.newConnection} title={zh.common.newConnection} onClick={onNewConnection}><Plus size={17}/></button></div><div className="search-box"><Search size={14}/><input aria-label={zh.sidebar.text003} value={search} onChange={event => setSearch(event.target.value)} placeholder={zh.sidebar.text004}/><kbd>⌕</kbd></div><div className="tree-scroll"><WorkbenchShelf onOpen={onOpenWorkbench}/>{groups.map(group => <section className="tree-group" key={group}><div className="group-label"><Folder size={13}/>{group}</div>{connections.filter(profile => (profile.group || zh.sidebar.text001) === group).map(profile => <ConnectionNode key={`${profile.id}:${refreshVersion}:${connectionVersions[profile.id] ?? 0}`} profile={profile} search={search} onEdit={() => onEditConnection(profile)} onCopy={() => onCopyConnection(profile)} onDesign={onDesign} onColumnPatches={onColumnPatches} onIndexPatches={onIndexPatches} onForeignKeyPatches={onForeignKeyPatches} onDdl={onDdl}/>)}</section>)}{connections.length === 0 && <div className="sidebar-empty"><Database size={30}/><p>{zh.sidebar.text005}</p><button onClick={onNewConnection}><Plus size={14}/>{zh.common.newConnection}</button></div>}</div><div className="sidebar-bottom"><span className="status-dot"/>{zh.sidebar.text006}<span className="grow"/><span>{connections.length}{zh.sidebar.text007}</span></div></aside>;
}

/** 连接节点维护展开状态及数据库列表，配置编辑仍交给独立表单完成。 */
function ConnectionNode({ profile, search, onEdit, onCopy, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onDdl }: { profile: ConnectionProfile; search: string; onEdit: () => void; onCopy: () => void; onDesign: (connectionId: string, database: string, table?: string) => void; onColumnPatches: (connectionId: string, database: string, table: string) => void; onIndexPatches: (connectionId: string, database: string, table: string) => void; onForeignKeyPatches: (connectionId: string, database: string, table: string) => void; onDdl: (connectionId: string, database?: string, object?: DatabaseObject) => void }) {
  const [databases, setDatabases] = useState<string[]>([]); const [opened, setOpened] = useState(false); const [busy, setBusy] = useState(false); const [connected, setConnected] = useState(false);
  const selection = useWorkspace(state => state.selection);
  /** 先验证连接再列出可访问数据库，失败时保留可重试的节点入口。 */
  async function load() {
    setBusy(true);
    const revision=useWorkspace.getState().connectionVersions[profile.id]??0,ticket=completionServerFacts.begin(profile.id,revision);
    try { const status=await invoke('connections.open', { id: profile.id }); if((useWorkspace.getState().connectionVersions[profile.id]??0)===revision)completionServerFacts.complete(ticket,status);else completionServerFacts.fail(ticket);setConnected(true); setDatabases(await invoke('metadata.databases', { connectionId: profile.id })); setOpened(true); }
    catch (error) { completionServerFacts.fail(ticket);useWorkspace.getState().notify(errorMessage(error), true); }
    finally { setBusy(false); }
  }
  /** 由主进程关闭连接所属的会话和任务，成功后再折叠连接节点。 */
  async function disconnect() {
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.close', { id: profile.id }); setConnected(false); setOpened(false); } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    // 后端可能已关闭会话再报告取消收尾错误；所有结束路径都撤销期间新建的旧目标ticket。
    finally { completionServerFacts.clear(profile.id); }
  }
  /** 删除操作仅作用于本地连接配置，执行前明确提示不会删除数据库。 */
  async function remove() {
    if (!window.confirm(formatText(zh.sidebar.text008, profile.name))) return;
    completionServerFacts.clear(profile.id);
    try { await invoke('connections.delete', { id: profile.id }); useWorkspace.getState().setConnections(await invoke('connections.list', {})); } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); }
    finally { completionServerFacts.clear(profile.id); }
  }
  const matches = profile.name.toLowerCase().includes(search.toLowerCase());
  if (search && !matches && !opened) return null;
  return <div className="connection-node"><div className={`tree-row connection-row ${selection?.connectionId === profile.id && !selection.database ? 'active' : ''}`}><button className="tree-label" onClick={() => { useWorkspace.getState().select({ connectionId: profile.id }); if (!opened) void load(); else setOpened(false); }}><span className="tree-chevron">{opened ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</span><Database size={16} style={{ color: profile.color }}/><span className="truncate">{profile.name}</span>{connected && <span className="connection-dot"/>}</button><div className="row-actions"><button title={connectionsTransferZh.copy} aria-label={formatText(connectionsTransferZh.copyAction, profile.name)} onClick={onCopy}><Copy size={12}/></button><button title={zh.sidebar.text009} aria-label={formatText(zh.sidebar.text010, profile.name)} onClick={onEdit}><Pencil size={12}/></button><button title={zh.sidebar.text011} aria-label={zh.sidebar.text011} onClick={() => void load()}><RefreshCw size={12}/></button><button title={zh.sidebar.text012} aria-label={zh.sidebar.text012} onClick={() => onDdl(profile.id)}><Plus size={12}/></button>{connected && <button title={zh.sidebar.text013} aria-label={zh.sidebar.text013} onClick={() => void disconnect()}><Unplug size={12}/></button>}<button title={zh.sidebar.text014} aria-label={zh.sidebar.text014} onClick={() => void remove()}><Trash2 size={12}/></button></div></div>{busy && <div className="tree-loading"><Spinner text={zh.sidebar.text015}/></div>}{opened && !busy && databases.map(database => <DatabaseNode key={database} connectionId={profile.id} database={database} search={matches ? '' : search} onColumnPatches={table => onColumnPatches(profile.id, database, table)} onIndexPatches={table => onIndexPatches(profile.id, database, table)} onForeignKeyPatches={table => onForeignKeyPatches(profile.id, database, table)} onDesign={table => onDesign(profile.id, database, table)} onDdl={object => onDdl(profile.id, database, object)}/>)}</div>;
}

/** 数据库节点按对象种类选择数据浏览或定义编辑入口。 */
function DatabaseNode({ connectionId, database, search, onDesign, onColumnPatches, onIndexPatches, onForeignKeyPatches, onDdl }: { connectionId: string; database: string; search: string; onDesign: (table?: string) => void; onColumnPatches: (table: string) => void; onIndexPatches: (table: string) => void; onForeignKeyPatches: (table: string) => void; onDdl: (object?: DatabaseObject) => void }) {
  const [open, setOpen] = useState(false); const [objects, setObjects] = useState<DatabaseObject[]>([]); const [busy, setBusy] = useState(false);
  const selection = useWorkspace(state => state.selection);
  /** 只读取当前数据库对象列表，避免加载未展开数据库的全部字段。 */
  async function load() {
    setBusy(true); try { setObjects(await invoke('metadata.objects', { connectionId, database })); setOpen(true); } catch (error) { useWorkspace.getState().notify(errorMessage(error), true); } finally { setBusy(false); }
  }
  const visible = objects.filter(object => object.name.toLowerCase().includes(search.toLowerCase()));
  return <div><div className={`tree-row database-row ${selection?.connectionId === connectionId && selection.database === database ? 'active' : ''}`}><button className="tree-label" onClick={() => { useWorkspace.getState().select({ connectionId, database }); if (!open) void load(); else setOpen(false); }}><span className="tree-chevron">{open ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}</span><Database size={13}/><span className="truncate">{database}</span></button><div className="row-actions"><FavoriteButton target={{ connectionId, database, kind: 'database' }}/><button title={zh.common.newQuery} aria-label={zh.sidebar.text016} onClick={() => useWorkspace.getState().openTab({ title: zh.common.unnamedQuery, kind: 'query', connectionId, database, sql: '' })}><FileCode2 size={12}/></button><button title={zh.sidebar.text017} aria-label={zh.sidebar.text017} onClick={() => onDesign()}><Plus size={12}/></button><button title={zh.sidebar.text018} aria-label={zh.sidebar.text018} onClick={() => void load()}><RefreshCw size={12}/></button><button title={zh.sidebar.text019} aria-label={zh.sidebar.text019} onClick={() => onDdl()}><Pencil size={12}/></button></div></div>{busy && <div className="tree-loading"><Spinner/></div>}{open && !busy && <div className="object-list">{visible.map(object => <div className="tree-row object-row" key={`${object.kind}:${object.name}`}><button className="tree-label" title={`${kindLabels[object.kind]} · ${object.name}`} onClick={() => { useWorkspace.getState().select({ connectionId, database }); if (object.kind === 'table' || object.kind === 'view') useWorkspace.getState().openTab({ kind: 'table', title: object.name, connectionId, database, table: object.name }); else onDdl(object); }}>{object.kind === 'table' ? <Table2 size={13}/> : <FileCode2 size={13}/>}<span className="truncate">{object.name}</span><span className="object-kind">{object.kind === 'table' ? '' : kindLabels[object.kind]}</span></button><div className="row-actions"><FavoriteButton target={{ connectionId, database, kind: object.kind, name: object.name }}/>{object.kind === 'table' && <button title={foreignKeyPatchZh.title} aria-label={`${foreignKeyPatchZh.title} ${object.name}`} onClick={() => onForeignKeyPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button title={indexPatchZh.title} aria-label={`${indexPatchZh.title} ${object.name}`} onClick={() => onIndexPatches(object.name)}><Table2 size={12}/></button>}{object.kind === 'table' && <button title={columnPatchZh.title} aria-label={`${columnPatchZh.title} ${object.name}`} onClick={() => onColumnPatches(object.name)}><Pencil size={12}/></button>}<button title={object.kind === 'table' ? zh.sidebar.text020 : zh.sidebar.text021} aria-label={formatText(zh.sidebar.text022, object.name)} onClick={() => object.kind === 'table' ? onDesign(object.name) : onDdl(object)}><Pencil size={12}/></button></div></div>)}{!visible.length && <span className="tree-hint">{search ? zh.sidebar.text023 : zh.sidebar.text024}</span>}</div>}</div>;
}
