import { zh, formatText } from './locales/zh-CN';
import { useEffect, useState } from 'react';
import { version as bundledVersion } from '../../package.json';
import { Activity, ArrowRight, CheckCircle2, CircleHelp, Database, FileCode2, History, Moon, Plus, Search, Settings2, Sun, Table2, TerminalSquare, X } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';
import { errorMessage, invoke } from './lib';
import { newQueryContext } from './connectionChanges';
import { copyConnectionOverview } from './connectionsTransfer';
import { connectionsTransferZh } from './locales/connectionsTransfer.zh-CN';
import { flushSettings, useWorkspace, type WorkspaceTab } from './store';
import { Sidebar } from './components/Sidebar';
import { ConnectionDialog } from './components/ConnectionDialog';
import { ConnectionsTransferDialog } from './components/ConnectionsTransferDialog';
import { ColumnPatchDialog } from './components/ColumnPatchDialog';
import { IndexPatchDialog } from './components/IndexPatchDialog';
import { assertIndexTargetAvailable, indexPatchServices } from './indexPatchServices';
import { indexPatchZh } from './locales/indexPatches.zh-CN';
import { assertColumnTargetAvailable, columnPatchServices, columnTargetKey } from './columnPatchServices';
import type { TableColumnPatchTarget } from '../shared/tableColumnPatches';
import { columnPatchZh } from './locales/columnPatches.zh-CN';
import { QueryTab } from './components/QueryTab';
import { TableTab } from './components/TableTab';
import { DdlDialog, SchemaDialog } from './components/SchemaDialog';
import { TransferDialog } from './components/TransferDialog';
import { HistoryDialog, TasksDialog } from './components/ActivityDialog';
import { ErrorBox, Field, Modal, Spinner } from './components/ui';

/** 统一维护桌面工作空间、标签与对话框，并把退出前的编辑状态交回主进程。 */
export default function App() {
  const state = useWorkspace(); const { settings, ready, connections, notice } = state;
  const [connectionsTransfer, setConnectionsTransfer] = useState(false);
  const [connectionCopy, setConnectionCopy] = useState<ConnectionProfile | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionProfile | 'new' | null>(null); const [newQuery, setNewQuery] = useState(false);
  const [history, setHistory] = useState(false); const [tasks, setTasks] = useState(false); const [preferences, setPreferences] = useState(false); const [about, setAbout] = useState(false);
  const [columnTarget, setColumnTarget] = useState<TableColumnPatchTarget | null>(null); const [columnEdits, setColumnEdits] = useState(false);
  const [indexTarget, setIndexTarget] = useState<TableColumnPatchTarget | null>(null); const [indexEdits, setIndexEdits] = useState(false);
  const [structureRefresh, setStructureRefresh] = useState<Record<string, { version: number; automatic: boolean }>>({});
  const [schema, setSchema] = useState<{ connectionId: string; database: string; table?: string } | null>(null);
  const [ddl, setDdl] = useState<{ connectionId: string; database?: string; object?: DatabaseObject } | null>(null);
  const [transfer, setTransfer] = useState<{ mode: 'import' | 'export'; connectionId: string; database: string; table: string } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0); const [version, setVersion] = useState(bundledVersion); const [platform, setPlatform] = useState('win32'); const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  useEffect(() => {
    void useWorkspace.getState().initialize();
    const unsubscribeTasks = window.dbark?.onTask(event => useWorkspace.getState().onTask(event));
    const unsubscribeMenu = window.dbark?.onMenu(action => {
      // 原生菜单也尊重模态焦点，防止片段或参数编辑期间叠加第二个工作区表单。
      if ((action === 'new-connection' || action === 'new-query') && document.querySelector('[role="dialog"]')) return;
      if (action === 'new-connection') setConnectionDialog('new');
      if (action === 'new-query') setNewQuery(true);
      if (action === 'toggle-theme') useWorkspace.getState().updateSettings({ theme: useWorkspace.getState().settings.theme === 'dark' ? 'light' : 'dark' });
      if (action === 'persist-state') void flushSettings().catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
      if (action.startsWith('warning:')) useWorkspace.getState().notify(action.slice('warning:'.length), true);
    });
    void invoke('app.info', {}).then(info => { setVersion(info.version); setPlatform(info.platform); setEncryptionAvailable(info.encryptionAvailable); }).catch(() => {});
    return () => { unsubscribeTasks?.(); unsubscribeMenu?.(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  const hasDirty = columnEdits || indexEdits || Object.values(state.dirtyTabs).some(Boolean);
  useEffect(() => { if (ready) void invoke('app.setDirty', { dirty: hasDirty }).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); }, [hasDirty, ready]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => useWorkspace.setState({ notice: undefined }), 5500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    /** 仅在无活动对话框时处理工作区快捷键，避免覆盖表单内的正常操作。 */
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === 't') { event.preventDefault(); setNewQuery(true); }
      if (event.key.toLowerCase() === 'w' && useWorkspace.getState().settings.activeTabId) { event.preventDefault(); closeTab(useWorkspace.getState().settings.activeTabId!); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  /** 活动任务不能直接关闭；尚未提交的修改与 SQL 需要用户明确确认。 */
  function closeTab(id: string) {
    const current = useWorkspace.getState(); const tab = current.settings.tabs.find(item => item.id === id);
    if (current.activeJobs[id]) { current.notify(zh.app.text001, true); return; }
    if (current.dirtyTabs[id] && !window.confirm(zh.app.text002)) return;
    if (tab?.kind === 'query' && tab.sql?.trim() && !current.dirtyTabs[id] && !window.confirm(zh.app.text003)) return;
    current.closeTab(id);
  }
  /** 新字段入口先保护同目标所有表页，绝不自动放弃已有数据草稿。 */
  function openColumnPatches(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try {
      assertColumnTargetAvailable(target, useWorkspace.getState());
      // 入口保护已通过，清除上一轮已解决的提示，避免旧错误遮挡本次确认；失败保护仍保留错误提示。
      useWorkspace.setState({ notice: undefined });
      setColumnEdits(false); setColumnTarget(structuredClone(target));
    }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 索引入口保护精确目标的全部表页，已有结构模态或数据草稿不会被覆盖。 */
  function openIndexPatches(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try {
      assertIndexTargetAvailable(target, useWorkspace.getState());
      useWorkspace.setState({ notice: undefined }); setIndexEdits(false); setIndexTarget(structuredClone(target));
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 完成只通知精确目标表页，核验不明仅标过期，不重放DDL或影响其他表。 */
  function markStructureTarget(target: TableColumnPatchTarget, automatic: boolean) {
    const key = columnTargetKey(target); setStructureRefresh(current => ({ ...current, [key]: { version: (current[key]?.version ?? 0) + 1, automatic } }));
  }
  /** 指针拖动即时调整宽度，持久化由工作空间存储层合并处理。 */
  function resizeSidebar(event: React.PointerEvent) {
    const startX = event.clientX; const width = settings.sidebarWidth; event.currentTarget.setPointerCapture(event.pointerId);
    /** 将拖动位置限制在可用侧边栏宽度范围内。 */
    const move = (next: PointerEvent) => useWorkspace.getState().updateSettings({ sidebarWidth: Math.max(180, Math.min(600, width + next.clientX - startX)) });
    /** 拖动结束立即移除窗口级监听，避免后续指针移动误改布局。 */
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  }
  const runningCount = state.tasks.filter(task => task.status === 'running').length;
  const activeTab = settings.tabs.find(tab => tab.id === settings.activeTabId) ?? settings.tabs[0];
  if (!ready) return <div className="boot-screen"><Brand/><Spinner text={zh.app.text004}/></div>;
  return <div className={`app platform-${platform}`}><header className="app-titlebar"><Brand/><span className="title-divider"/><span className="window-title">{zh.app.text005}</span><span className="grow"/><span className="version-label">v{version}</span><button className="icon-button" title={settings.theme === 'dark' ? zh.app.text006 : zh.app.text007} aria-label={zh.app.text008} onClick={() => state.updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>{settings.theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}</button><button className="icon-button" title={zh.app.text009} aria-label={zh.app.text009} onClick={() => setPreferences(true)}><Settings2 size={15}/></button></header><div className="app-commandbar"><button className="new-connection-button" onClick={() => setConnectionDialog('new')}><Plus size={15}/>{zh.common.newConnection}</button><button aria-label={connectionsTransferZh.open} onClick={() => setConnectionsTransfer(true)}>{connectionsTransferZh.open}</button><span className="toolbar-divider"/><button disabled={!connections.length} onClick={() => setNewQuery(true)}><FileCode2 size={15}/>{zh.common.newQuery}</button><button onClick={() => setHistory(true)}><History size={15}/>{zh.common.historyQueries}</button><span className="grow"/><button onClick={() => setTasks(true)}><Activity size={15}/>{zh.common.taskCenter}{runningCount > 0 && <span className="count">{runningCount}</span>}</button><button className="icon-button" aria-label={zh.app.text010} onClick={() => setAbout(true)}><CircleHelp size={16}/></button></div><div className="app-body"><div className="sidebar-container" style={{ width: settings.sidebarWidth }}><Sidebar onNewConnection={() => setConnectionDialog('new')} onEditConnection={setConnectionDialog} onIndexPatches={(connectionId, database, table) => openIndexPatches({ connectionId, database, table })} onColumnPatches={(connectionId, database, table) => openColumnPatches({ connectionId, database, table })} onCopyConnection={profile => { setConnectionCopy(copyConnectionOverview(profile)); setConnectionDialog('new'); }} onDesign={(connectionId, database, table) => setSchema({ connectionId, database, table })} onDdl={(connectionId, database, object) => setDdl({ connectionId, database, object })} refreshVersion={refreshVersion}/></div><div className="vertical-resize" role="separator" aria-label={zh.app.text011} aria-orientation="vertical" onPointerDown={resizeSidebar}/><main className="main-workspace"><div className="tab-strip">{settings.tabs.length ? settings.tabs.map(tab => <div key={tab.id} className={`workspace-tab-button ${tab.id === activeTab?.id ? 'active' : ''}`}><button className="tab-select" onClick={() => state.updateSettings({ activeTabId: tab.id })}>{tab.kind === 'query' ? <FileCode2 size={14}/> : <Table2 size={14}/>}<span>{tab.title}</span>{state.dirtyTabs[tab.id] && <span className="dirty-dot"/>}</button><button className="tab-close" aria-label={formatText(zh.app.text012, tab.title)} onClick={() => closeTab(tab.id)}><X size={12}/></button></div>) : <div className="welcome-tab"><Database size={14}/>{zh.app.text013}</div>}<button className="add-tab" title={zh.common.newQuery} aria-label={zh.app.text014} onClick={() => connections.length ? setNewQuery(true) : setConnectionDialog('new')}><Plus size={15}/></button></div>{settings.tabs.length ? <div className="tab-content">{settings.tabs.map(tab => <section key={tab.id} className="tab-pane" hidden={tab.id !== activeTab?.id}>{tab.kind === 'query' ? <QueryTab tab={tab} onHistory={() => setHistory(true)}/> : <TableTab tab={tab} refreshVersion={structureRefresh[columnTargetKey({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })]?.version ?? 0} refreshAutomatically={structureRefresh[columnTargetKey({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })]?.automatic ?? true} onIndexPatches={() => openIndexPatches({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onColumnPatches={() => openColumnPatches({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onDesign={isView => isView ? setDdl({ connectionId: tab.connectionId, database: tab.database!, object: { name: tab.table!, kind: 'view' } }) : setSchema({ connectionId: tab.connectionId, database: tab.database!, table: tab.table })} onTransfer={mode => setTransfer({ mode, connectionId: tab.connectionId, database: tab.database!, table: tab.table! })}/>}</section>)}</div> : <Welcome onConnect={() => setConnectionDialog('new')} onQuery={() => setNewQuery(true)} onHistory={() => setHistory(true)}/>}</main></div><footer className="app-statusbar"><span className="status-dot"/>{zh.app.text015}<span className="status-divider"/><span>{activeTab ? connections.find(profile => profile.id === activeTab.connectionId)?.name || zh.common.connectionDeleted : 'MySQL · MariaDB'}</span><span className="grow"/><button onClick={() => setTasks(true)}>{runningCount ? formatText(zh.app.text016, runningCount) : zh.app.text017}</button><span className="status-divider"/><span>UTF-8</span></footer>{notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <CheckCircle2 size={17}/>}<span>{notice.text}</span><button aria-label={zh.app.text018} onClick={() => useWorkspace.setState({ notice: undefined })}><X size={15}/></button></div>}
    {indexTarget && <IndexPatchDialog target={indexTarget} targetVersion={state.connectionVersions[indexTarget.connectionId] ?? 0} services={indexPatchServices} onDirtyChange={setIndexEdits} beforeApply={() => assertIndexTargetAvailable(indexTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(indexTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(indexPatchZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(indexTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setIndexTarget(null); setIndexEdits(false); }}/>} {columnTarget && <ColumnPatchDialog target={columnTarget} targetVersion={state.connectionVersions[columnTarget.connectionId] ?? 0} services={columnPatchServices} onDirtyChange={setColumnEdits} beforeApply={() => assertColumnTargetAvailable(columnTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(columnTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(columnPatchZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(columnTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setColumnTarget(null); setColumnEdits(false); }}/>} {connectionsTransfer && <ConnectionsTransferDialog onClose={() => setConnectionsTransfer(false)}/>} {connectionDialog && <ConnectionDialog profile={connectionDialog === 'new' ? undefined : connectionDialog} initialProfile={connectionDialog === 'new' ? connectionCopy ?? undefined : undefined} onClose={() => { setConnectionCopy(null); setConnectionDialog(null); }} onTransportChanged={state.invalidateConnection}/>} {newQuery && <NewQueryDialog onClose={() => setNewQuery(false)}/>} {history && <HistoryDialog onClose={() => setHistory(false)}/>} {tasks && <TasksDialog onClose={() => setTasks(false)}/>} {schema && <SchemaDialog {...schema} onClose={() => setSchema(null)} onApplied={() => setRefreshVersion(value => value + 1)}/>} {ddl && <DdlDialog {...ddl} onClose={() => setDdl(null)} onApplied={() => setRefreshVersion(value => value + 1)}/>} {transfer && <TransferDialog {...transfer} onClose={() => setTransfer(null)}/>}
    {preferences && <Modal title={zh.app.text009} onClose={() => setPreferences(false)}><div className="modal-content form-grid"><Field label={zh.app.text019}><select value={settings.theme} onChange={event => state.updateSettings({ theme: event.target.value as 'dark' | 'light' })}><option value="dark">{zh.common.dark}</option><option value="light">{zh.common.light}</option></select></Field><Field label={zh.app.text020}><input type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => state.updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/></Field><Field label={zh.app.text021}><select value={settings.pageSize} onChange={event => state.updateSettings({ pageSize: Number(event.target.value) })}>{[50, 100, 200, 500, 1000].map(size => <option key={size}>{size}</option>)}</select></Field><Field label={zh.app.text022}><input type="number" min="180" max="600" value={settings.sidebarWidth} onChange={event => state.updateSettings({ sidebarWidth: Math.max(180, Math.min(600, Number(event.target.value))) })}/></Field><p className="full muted small">{zh.app.text023}{encryptionAvailable ? zh.app.text024 : zh.app.text025}</p></div><footer className="modal-footer"><span className="grow"/><button className="primary" onClick={() => setPreferences(false)}>{zh.common.done}</button></footer></Modal>}
    {about && <Modal title={zh.app.text010} onClose={() => setAbout(false)}><div className="modal-content about-content"><Brand/><p>{zh.app.text026}</p><span className="tag">{zh.app.text027}{version}</span><p className="muted">{zh.app.text028}</p><p className="muted small">{zh.app.text029}</p></div></Modal>}
  </div>;
}

/** 自主绘制的方舟图形标识，不依赖远程图片或第三方产品素材。 */
function Brand() { return <span className="brand"><svg aria-hidden="true" width="25" height="25" viewBox="0 0 28 28" fill="none"><path d="M4 7L14 2L24 7V19L14 25L4 19V7Z" fill="currentColor" opacity=".16"/><path d="M5 8L14 3L23 8M5 8V18L14 24M5 8L14 13M23 8V18L14 24M23 8L14 13M14 13V24M9.5 5.5L18.5 10.5M5 13L14 18L23 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg><strong>DBArk</strong></span>; }

/** 无标签时展示真实可用的入口，首次使用不创建演示连接或假数据。 */
function Welcome({ onConnect, onQuery, onHistory }: { onConnect: () => void; onQuery: () => void; onHistory: () => void }) {
  const connections = useWorkspace(state => state.connections);
  return <div className="welcome"><div className="welcome-inner"><div className="welcome-kicker"><span className="status-dot"/>{zh.app.text030}</div><h1>{zh.app.text031}<br/><span>{zh.app.text032}</span></h1><p className="welcome-description">{zh.app.text033}<br/>{zh.app.text034}</p><div className="welcome-actions"><button className="primary" onClick={onConnect}><Plus size={16}/>{zh.common.newConnection}<ArrowRight size={16}/></button><button onClick={onQuery} disabled={!connections.length}><TerminalSquare size={16}/>{zh.app.text035}</button></div><div className="welcome-divider"/><div className="welcome-columns"><section><h2>{zh.app.text036}</h2><button className="welcome-link" onClick={onConnect}><span className="welcome-link-icon"><Database size={18}/></span><span><strong>{zh.app.text037}</strong><small>{zh.app.text038}</small></span><ArrowRight size={15}/></button><button className="welcome-link" disabled={!connections.length} onClick={onQuery}><span className="welcome-link-icon purple"><FileCode2 size={18}/></span><span><strong>{zh.app.text039}</strong><small>{zh.app.text040}</small></span><ArrowRight size={15}/></button><button className="welcome-link" onClick={onHistory}><span className="welcome-link-icon blue"><History size={18}/></span><span><strong>{zh.app.text041}</strong><small>{zh.app.text042}</small></span><ArrowRight size={15}/></button></section><section className="welcome-shortcuts"><h2>{zh.app.text043}</h2><div><span>{zh.common.newQuery}</span><kbd>Ctrl / ⌘ T</kbd></div><div><span>{zh.common.executeSql}</span><kbd>Ctrl / ⌘ ↵</kbd></div><div><span>{zh.app.text044}</span><kbd>Ctrl / ⌘ S</kbd></div><div><span>{zh.app.text045}</span><kbd>Ctrl / ⌘ W</kbd></div><p><Search size={13}/>{zh.app.text046}</p></section></div><div className="welcome-footnote"><span>{zh.app.text047}</span><span>MySQL / MariaDB</span><span>{zh.app.text048}</span></div></div><div className="welcome-decoration" aria-hidden="true"><div/><div/><div/></div></div>;
}

/** 新查询明确绑定连接及默认数据库；同名数据库不跨连接混用。 */
function NewQueryDialog({ onClose }: { onClose: () => void }) {
  const connections = useWorkspace(state => state.connections); const selection = useWorkspace(state => state.selection); const activeTab = useWorkspace(state => state.settings.tabs.find(tab => tab.id === state.settings.activeTabId));
  const initial = newQueryContext(selection, activeTab, connections[0]?.id ?? '');
  const [connectionId, setConnectionId] = useState(initial.connectionId); const [database, setDatabase] = useState(initial.database ?? ''); const [databases, setDatabases] = useState<string[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; setDatabases([]); if (!connectionId) return; setBusy(true); void invoke('connections.open', { id: connectionId }).then(() => invoke('metadata.databases', { connectionId })).then(items => { if (alive) setDatabases(items); }).catch(reason => { if (alive) setError(errorMessage(reason)); }).finally(() => { if (alive) setBusy(false); }); return () => { alive = false; }; }, [connectionId]);
  return <Modal title={zh.common.newQuery} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (connectionId) { useWorkspace.getState().openTab({ kind: 'query', title: zh.common.unnamedQuery, connectionId, database: database || undefined, sql: '' }); onClose(); } }}><div className="modal-content form-grid"><Field label={zh.app.text049} full><select value={connectionId} onChange={event => { setConnectionId(event.target.value); setDatabase(''); setError(''); }}>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></Field><Field label={zh.app.text050} full><input list="query-databases" value={database} onChange={event => setDatabase(event.target.value)} placeholder={busy ? zh.app.text051 : zh.app.text052}/><datalist id="query-databases">{databases.map(name => <option key={name} value={name}/>)}</datalist></Field><ErrorBox message={error}/></div><footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{zh.common.cancel}</button><button className="primary" type="submit" disabled={!connectionId}>{zh.app.text053}<ArrowRight size={14}/></button></footer></form></Modal>;
}
