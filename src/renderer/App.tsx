import { TableCopyDataDialog } from './components/TableCopyDataDialog';
import { tableCopyDataServices, assertTableCopyDataTargetAvailable } from './tableCopyDataServices';
import { tableCopyDataZh } from './locales/tableCopyData.zh-CN';
import type { TableCreateApplyOutput } from '../shared/tableCreate';
import { tableCreateZh } from './locales/tableCreate.zh-CN';
import { TableCopyStructureDialog } from './components/TableCopyStructureDialog';
import { tableCopyStructureServices, assertTableCopyStructureTargetAvailable } from './tableCopyStructureServices';
import { tableCopyStructureZh } from './locales/tableCopyStructure.zh-CN';
import { SchemaCompareDialog } from './components/SchemaCompareDialog';
import { schemaCompareServices } from './schemaCompareServices';
import { schemaCompareZh } from './locales/schemaCompare.zh-CN';
import { zh, formatText } from './locales/zh-CN';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { version as bundledVersion } from '../../package.json';
import { Activity, ArrowRight, CheckCircle2, CircleHelp, Database, FileCode2, History, Moon, Plus, Search, Settings2, Sun, Table2, TerminalSquare, X } from 'lucide-react';
import type { ConnectionProfile, DatabaseObject } from '../shared/contracts';
import { errorMessage, invoke,uid } from './lib';
import { newQueryContext } from './connectionChanges';
import { copyConnectionOverview } from './connectionsTransfer';
import { connectionsTransferZh } from './locales/connectionsTransfer.zh-CN';
import { flushSettings, useWorkspace, type WorkspaceTab } from './store';
import { completionServerFacts } from './completionServerFacts';
import { Sidebar } from './components/Sidebar';
import { WorkbenchDialog, ObjectLinkDialog } from './components/Workbench';
import { useWorkbench } from './workbench';
import { workbenchZh } from './locales/workbench.zh-CN';
import { createWorkbenchNavigation } from './workbenchNavigation';
import './workbench.css';
import { ConnectionDialog } from './components/ConnectionDialog';
import { ConnectionsTransferDialog } from './components/ConnectionsTransferDialog';
import { ColumnPatchDialog } from './components/ColumnPatchDialog';
import { IndexPatchDialog } from './components/IndexPatchDialog';
import { TableRenameDialog } from './components/TableRenameDialog';
import { tableRenameServices, assertTableRenameTargetAvailable } from './tableRenameServices';
import { tableRenameZh } from './locales/tableRename.zh-CN';
import { reconcileTableRenameFavorites, tableRenameTabMatches } from './tableRenameReconcile';
import type { TableRenameApplyOutput } from '../shared/tableRename';
import { TableDropDialog } from './components/TableDropDialog';
import { assertTableDropTargetAvailable, tableDropServices } from './tableDropServices';
import { tableDropZh } from './locales/tableDrop.zh-CN';
import { tableDropTabMatches } from './tableDropUi';
import { TableTruncateDialog } from './components/TableTruncateDialog';
import { assertTableTruncateTargetAvailable, tableTruncateServices } from './tableTruncateServices';
import { tableTruncateZh } from './locales/tableTruncate.zh-CN';
import { TableCommentDialog } from './components/TableCommentDialog';
import { TableDefaultEncodingDialog } from './components/TableDefaultEncodingDialog';
import { assertTableDefaultEncodingTargetAvailable, tableDefaultEncodingServices } from './tableDefaultEncodingServices';
import { tableDefaultEncodingZh } from './locales/tableDefaultEncoding.zh-CN';
import { assertTableCommentTargetAvailable, tableCommentServices } from './tableCommentServices';
import { tableCommentZh } from './locales/tableComment.zh-CN';
import { ForeignKeyPatchDialog } from './components/ForeignKeyPatchDialog';
import { assertForeignKeyTargetsAvailable, foreignKeyPatchServices } from './foreignKeyPatchServices';
import { foreignKeyPatchZh } from './locales/foreignKeyPatches.zh-CN';
import { assertIndexTargetAvailable, indexPatchServices } from './indexPatchServices';
import { indexPatchZh } from './locales/indexPatches.zh-CN';
import { assertColumnTargetAvailable, columnPatchServices, columnTargetKey } from './columnPatchServices';
import type { TableColumnPatchTarget } from '../shared/tableColumnPatches';
import { columnPatchZh } from './locales/columnPatches.zh-CN';
import { QueryTab } from './components/QueryTab';
import { QueryCloseRequests, type QueryCloseRequest } from './queryCloseIntent';
import { queryCloseZh } from './locales/queryClose.zh-CN';
import { TableTab } from './components/TableTab';
import { DdlDialog, SchemaDialog } from './components/SchemaDialog';
import { TransferDialog } from './components/TransferDialog';
import { HistoryDialog, TasksDialog } from './components/ActivityDialog';
import { ErrorBox, Field, Modal, Spinner } from './components/ui';
import { DataTypeColorPreferences } from './components/DataTypeColor';
import {StructureSearchDialog} from './components/StructureSearchDialog';
import {DataSearchDialog} from './components/DataSearchDialog';
import {databaseSearchZh} from './locales/databaseSearch.zh-CN';
import{SavedQuerySearchDialog}from'./components/SavedQuerySearchDialog';
import{savedQuerySearchZh}from'./locales/savedQuerySearch.zh-CN';
import type {SavedQueryNavigationSource} from '../shared/savedQuerySearch';
import type {DefinitionSearchOpen} from '../shared/definitionNavigation';
import { TableAutoIncrementDialog } from './components/TableAutoIncrementDialog';
import { tableAutoIncrementServices, assertTableAutoIncrementTargetAvailable } from './tableAutoIncrementServices';
import { tableAutoIncrementZh } from './locales/tableAutoIncrement.zh-CN';

/** 统一维护桌面工作空间、标签与对话框，并把退出前的编辑状态交回主进程。 */
export default function App() {
  const state = useWorkspace(); const { settings, ready, connections, notice } = state;
  const closeRequests = useMemo(() => new QueryCloseRequests(), []);
  const [queryCloseRequest, setQueryCloseRequest] = useState<QueryCloseRequest>();
  const [connectionsTransfer, setConnectionsTransfer] = useState(false);
  const workbench = useWorkbench();
  const [workbenchDialog, setWorkbenchDialog] = useState(false), [objectLinkDialog, setObjectLinkDialog] = useState(false);
  const [schemaCompare, setSchemaCompare] = useState(false);
  const [structureSearch,setStructureSearch]=useState(false);
  const [dataSearch,setDataSearch]=useState(false);
  const[savedQuerySearch,setSavedQuerySearch]=useState(false),[querySearchPositions,setQuerySearchPositions]=useState<Record<string,SavedQueryNavigationSource>>({});
  // 原文摘要绑定的有界命中仅留当前窗口内存，关闭标签清理，不进入持久化工作台。
  useEffect(()=>{setQuerySearchPositions(previous=>{const ids=new Set(settings.tabs.map(tab=>tab.id)),entries=Object.entries(previous).filter(([id])=>ids.has(id));return entries.length===Object.keys(previous).length?previous:Object.fromEntries(entries);});},[settings.tabs]);
  const [connectionCopy, setConnectionCopy] = useState<ConnectionProfile | null>(null);
  const [connectionDialog, setConnectionDialog] = useState<ConnectionProfile | 'new' | null>(null); const [newQuery, setNewQuery] = useState(false);
  const [history, setHistory] = useState(false); const [tasks, setTasks] = useState(false); const [preferences, setPreferences] = useState(false); const [about, setAbout] = useState(false);
  const [columnTarget, setColumnTarget] = useState<TableColumnPatchTarget | null>(null); const [columnEdits, setColumnEdits] = useState(false);
  const [encodingTarget, setEncodingTarget] = useState<TableColumnPatchTarget | null>(null); const [encodingEdits, setEncodingEdits] = useState(false);
  const [copyDataTarget, setCopyDataTarget] = useState<TableColumnPatchTarget | null>(null), [copyDataVersion, setCopyDataVersion] = useState(0), [copyDataEdits, setCopyDataEdits] = useState(false);
  const [copyStructureTarget, setCopyStructureTarget] = useState<TableColumnPatchTarget | null>(null), [copyStructureVersion, setCopyStructureVersion] = useState(0), [copyStructureEdits, setCopyStructureEdits] = useState(false);
  const [renameTarget, setRenameTarget] = useState<TableColumnPatchTarget | null>(null), [renameVersion, setRenameVersion] = useState(0), [renameEdits, setRenameEdits] = useState(false);
  const [counterTarget, setCounterTarget] = useState<TableColumnPatchTarget | null>(null), [counterVersion, setCounterVersion] = useState(0), [counterEdits, setCounterEdits] = useState(false);
  const [dropTarget, setDropTarget] = useState<TableColumnPatchTarget | null>(null), [dropVersion, setDropVersion] = useState(0), [dropEdits, setDropEdits] = useState(false);
  const [truncateTarget, setTruncateTarget] = useState<TableColumnPatchTarget | null>(null), [truncateVersion, setTruncateVersion] = useState(0), [truncateEdits, setTruncateEdits] = useState(false);
  const [commentTarget, setCommentTarget] = useState<TableColumnPatchTarget | null>(null); const [commentEdits, setCommentEdits] = useState(false);
  const [indexTarget, setIndexTarget] = useState<TableColumnPatchTarget | null>(null); const [indexEdits, setIndexEdits] = useState(false);
  const [foreignKeyTarget, setForeignKeyTarget] = useState<TableColumnPatchTarget | null>(null); const [foreignKeyEdits, setForeignKeyEdits] = useState(false);
  const [objectRefreshVersions, setObjectRefreshVersions] = useState<Record<string, number>>({});
  const [structureRefresh, setStructureRefresh] = useState<Record<string, { version: number; automatic: boolean }>>({});
  const [tableCreateEdits, setTableCreateEdits] = useState(false);
  const [schema, setSchema] = useState<{ connectionId: string; database: string; table?: string } | null>(null);
  const [ddl, setDdl] = useState<{ connectionId: string; database?: string; object?: DatabaseObject; readOnly?:boolean; definitionSearch?:DefinitionSearchOpen } | null>(null);
  const [databaseCreateEdits, setDatabaseCreateEdits] = useState(false);
  const workbenchNavigation = useMemo(() => createWorkbenchNavigation(setDdl), []);
  useLayoutEffect(() => { workbenchNavigation.activate(); return () => workbenchNavigation.dispose(); }, [workbenchNavigation]);
  const openWorkbenchTarget = workbenchNavigation.open;
  const [transfer, setTransfer] = useState<{ mode: 'import' | 'export'; connectionId: string; database: string; table: string } | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0); const [version, setVersion] = useState(bundledVersion); const [platform, setPlatform] = useState('win32'); const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  useEffect(() => {
    void useWorkspace.getState().initialize();
    void useWorkbench.getState().initialize();
    const unsubscribeTasks = window.dbark?.onTask(event => useWorkspace.getState().onTask(event));
    const unsubscribeMenu = window.dbark?.onMenu(action => {
      // 原生菜单也尊重模态焦点，防止片段或参数编辑期间叠加第二个工作区表单。
      if ((action === 'new-connection' || action === 'new-query'||action==='structure-search') && document.querySelector('[role="dialog"]')) return;
      if (action === 'new-connection') setConnectionDialog('new');
      if (action === 'new-query') openNewQueryDialog();
      if(action==='structure-search')setStructureSearch(true);
      if (action === 'toggle-theme') useWorkspace.getState().updateSettings({ theme: useWorkspace.getState().settings.theme === 'dark' ? 'light' : 'dark' });
      if (action === 'persist-state') void flushSettings().catch(reason => useWorkspace.getState().notify(errorMessage(reason), true));
      if (action.startsWith('warning:')) useWorkspace.getState().notify(action.slice('warning:'.length), true);
    });
    void invoke('app.info', {}).then(info => { setVersion(info.version); setPlatform(info.platform); setEncryptionAvailable(info.encryptionAvailable); }).catch(() => {});
    return () => { unsubscribeTasks?.(); unsubscribeMenu?.(); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = settings.theme; }, [settings.theme]);
  const hasDirty = copyDataEdits || tableCreateEdits || copyStructureEdits || databaseCreateEdits || dropEdits || truncateEdits || counterEdits || renameEdits || encodingEdits || commentEdits || columnEdits || indexEdits || foreignKeyEdits || Object.values(state.dirtyTabs).some(Boolean);
  useEffect(() => { if (ready) void invoke('app.setDirty', { dirty: hasDirty }).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); }, [hasDirty, ready]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => useWorkspace.setState({ notice: undefined }), 5500); return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    /** 仅在无活动对话框时处理工作区快捷键，避免覆盖表单内的正常操作。 */
    const listener = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || document.querySelector('[role="dialog"]')) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); const current = useWorkbench.getState(); void current.save({ ...current.snapshot.document, focusMode: !current.snapshot.document.focusMode }); }
      if (event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); openWorkbenchManager(); }
      if (event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); openObjectLink(); }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); openNewQueryDialog(); }
      if(event.shiftKey&&event.key.toLowerCase()==='f'){event.preventDefault();setStructureSearch(true);}
      if (event.key.toLowerCase() === 'w' && useWorkspace.getState().settings.activeTabId) { event.preventDefault(); closeTab(useWorkspace.getState().settings.activeTabId!); }
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  /** 查询表单在同步入口接管导航归属，迟到收藏/链接不能再切换连接、叠加定义或报告旧错误。 */
  function openNewQueryDialog() { workbenchNavigation.invalidate(); setNewQuery(true); }
  /** 关闭或取消表单结束当前意图；已有失效请求不能在表单消失后复活。 */
  function closeNewQueryDialog() { workbenchNavigation.invalidate(); setNewQuery(false); }
  /** 无连接时沿用先建连的行为；标签加号的两条路径都必须在任何异步读取前撤销旧导航。 */
  function openQueryTabEntry() { workbenchNavigation.invalidate(); if (connections.length) setNewQuery(true); else setConnectionDialog('new'); }
  /** 导入模态独占显式导航意图，旧收藏/链接的迟到结果不得创建标签或自动连接。 */
  function openConnectionsTransfer() { workbenchNavigation.invalidate(); setConnectionsTransfer(true); }
  /** 关闭也废弃模态前后的迟到回执，不能恢复旧导航。 */
  function closeConnectionsTransfer() { workbenchNavigation.invalidate(); setConnectionsTransfer(false); }
  /** 打开或关闭导航表单均撤销先前意图，避免旧侧栏读取在编辑链接时改变工作区。 */
  function openWorkbenchManager() { workbenchNavigation.invalidate(); setWorkbenchDialog(true); }
  function closeWorkbenchManager() { workbenchNavigation.invalidate(); setWorkbenchDialog(false); }
  function openObjectLink() { workbenchNavigation.invalidate(); setObjectLinkDialog(true); }
  function closeObjectLink() { workbenchNavigation.invalidate(); setObjectLinkDialog(false); }
  /** 活动任务不能直接关闭；尚未提交的修改与 SQL 需要用户明确确认。 */
  function closeTab(id: string) {
    const current = useWorkspace.getState(); const tab = current.settings.tabs.find(item => item.id === id);
    if (current.activeJobs[id]) { current.notify(zh.app.text001, true); return; }
    if (current.dirtyTabs[id] && !window.confirm(zh.app.text002)) return;
    if (tab?.kind === 'query' && tab.sql?.trim() && !current.dirtyTabs[id]) {
      if (document.querySelector('[role="dialog"]')) return;
      const request = closeRequests.begin(id); if (request) setQueryCloseRequest(request); return;
    }
    current.closeTab(id);
  }
  /** 只有当前请求能完成关闭；保存解除自身busy之后仍重新核对作业与事务。 */
  function finishQueryClose(request: QueryCloseRequest, close: boolean) {
    if (!closeRequests.finish(request)) return;
    setQueryCloseRequest(undefined);
    const current = useWorkspace.getState();
    if (!close || !current.settings.tabs.some(tab => tab.id === request.tabId)) return;
    if (current.activeJobs[request.tabId] || current.dirtyTabs[request.tabId]) { current.notify(queryCloseZh.changed, true); return; }
    current.closeTab(request.tabId);
  }
  useEffect(() => { if (queryCloseRequest && !settings.tabs.some(tab => tab.id === queryCloseRequest.tabId)) finishQueryClose(queryCloseRequest, false); }, [settings.tabs, queryCloseRequest]);
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
  /** 外键入口保护当前子表；执行前由弹窗提交全部已加载父目标再核对数据草稿。 */
  function openForeignKeyPatches(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { assertForeignKeyTargetsAvailable([target], useWorkspace.getState()); useWorkspace.setState({ notice: undefined }); setForeignKeyEdits(false); setForeignKeyTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 专用入口在任何读取之前保护全部同目标表页并撤销旧导航意图。 */
  function openTableCopyData(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { const workspace = useWorkspace.getState(); assertTableCopyDataTargetAvailable(target, workspace); workbenchNavigation.invalidate(); setCopyDataVersion(workspace.connectionVersions[target.connectionId] ?? 0); setCopyDataEdits(false); setCopyDataTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  function openTableCopyStructure(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { const workspace = useWorkspace.getState(); assertTableCopyStructureTargetAvailable(target, workspace); workbenchNavigation.invalidate(); setCopyStructureVersion(workspace.connectionVersions[target.connectionId] ?? 0); setCopyStructureEdits(false); setCopyStructureTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 原表重命名入口保留独立任务。 */
  function openTableRename(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try {
      assertTableRenameTargetAvailable(target, useWorkspace.getState()); workbenchNavigation.invalidate();
      setRenameVersion(useWorkspace.getState().connectionVersions[target.connectionId] ?? 0); setRenameEdits(false); setRenameTarget(structuredClone(target));
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 精确通知已有数据库节点重读对象目录，不能用字符串替换伪造服务器对象列表。 */
  function refreshRenameDatabase(target: TableColumnPatchTarget) { const key = JSON.stringify([target.connectionId, target.database]); setObjectRefreshVersions(current => ({ ...current, [key]: (current[key] ?? 0) + 1 })); }
  /** 成功与未知都刷新真实目录；只有完整核验后才用新ID重开标签和迁移收藏。 */
  async function finishTableRename(result: TableRenameApplyOutput, version: number) {
    const workspace = useWorkspace.getState(), before = result.target, after = result.newTarget;
    if ((workspace.connectionVersions[before.connectionId] ?? 0) !== version) { workspace.notify(tableRenameZh.targetChanged, true); return; }
    workbenchNavigation.invalidate(); refreshRenameDatabase(before); markStructureTarget(before, false); markStructureTarget(after, false);
    if (!result.definitionVerified || !result.after?.physicalIdentity) {
      // invalidate只能撤销在途请求；DDL可能已改变名称，后续点击的旧URI也必须停用。
      if (result.ddlSubmitted || result.ddlCompleted) { workbenchNavigation.retireTable(before); workbenchNavigation.retireTable(after); }
      workspace.notify(result.ddlCompleted ? tableRenameZh.verificationFailed : result.ddlSubmitted ? tableRenameZh.unknown : tableRenameZh.notSent, true); return;
    }
    const nameReusable = workbenchNavigation.completeTableRename(before, after, result.after.physicalIdentity);
    try {
      assertTableRenameTargetAvailable(before, workspace); assertTableRenameTargetAvailable(after, workspace);
      // 从不把现有组件改成另一目标，旧请求只能触及已关闭的旧标签ID。
      for (const tab of [...workspace.settings.tabs]) if (tableRenameTabMatches(tab, before) || tableRenameTabMatches(tab, after)) workspace.closeTab(tab.id);
      workspace.openTab({ kind: 'table', connectionId: after.connectionId, database: after.database, table: after.table, title: after.table });
    } catch (reason) { workspace.notify(errorMessage(reason), true); return; }
    // 先结束本次模态，再等待配置保存；迟到保存结果不能关闭后来打开的另一个表单。
    setRenameTarget(null); setRenameEdits(false);
    const currentWorkbench = useWorkbench.getState();
    if (!currentWorkbench.ready || currentWorkbench.busy) { workspace.notify(tableRenameZh.favoritesPending, true); return; }
    const plan = reconcileTableRenameFavorites(currentWorkbench.snapshot.document, before, after);
    if (plan.conflict || plan.changed && !await currentWorkbench.save(plan.document)) workspace.notify(tableRenameZh.favoritesPending, true);
    else workspace.notify(nameReusable ? tableRenameZh.referencesNotice : tableRenameZh.ambiguousLink, !nameReusable);
  }
  /** 计数编辑独立于列级AUTO_INCREMENT，入口同步保护同目标全部隐藏草稿和活动任务。 */
  function openTableAutoIncrement(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try {
      assertTableAutoIncrementTargetAvailable(target, useWorkspace.getState()); workbenchNavigation.invalidate();
      setCounterVersion(useWorkspace.getState().connectionVersions[target.connectionId] ?? 0); setCounterEdits(false); setCounterTarget(structuredClone(target));
    } catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 删除入口固定连接修订；同目标隐藏草稿或活动操作不允许进入。 */
  function openTableDrop(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { assertTableDropTargetAvailable(target, useWorkspace.getState()); workbenchNavigation.invalidate(); setDropVersion(useWorkspace.getState().connectionVersions[target.connectionId] ?? 0); setDropEdits(false); setDropTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 已发送的删除使旧URI和迟到导航退役；只有完整核验成功才关闭原表标签，不重新绑定同名新表。 */
  function finishTableDrop(target: TableColumnPatchTarget, version: number, verified: boolean) {
    const workspace = useWorkspace.getState();
    if ((workspace.connectionVersions[target.connectionId] ?? 0) !== version) { workspace.notify(tableDropZh.targetChanged, true); return; }
    workbenchNavigation.retireTable(target); refreshRenameDatabase(target); markStructureTarget(target, false);
    if (!verified) return;
    // 异步执行期间出现的新草稿不能被完成回调静默丢弃；旧页只标失效并保持现场。
    try { assertTableDropTargetAvailable(target, workspace); }
    catch (reason) { workspace.notify(errorMessage(reason), true); return; }
    for (const tab of [...workspace.settings.tabs]) if (tableDropTabMatches(tab, target)) workspace.closeTab(tab.id);
  }
  /** 清空须先通过全部同表页保护；版本固定于打开时，执行前再次检查草稿。 */
  function openTableTruncate(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { assertTableTruncateTargetAvailable(target, useWorkspace.getState()); workbenchNavigation.invalidate(); setTruncateVersion(useWorkspace.getState().connectionVersions[target.connectionId] ?? 0); setTruncateEdits(false); setTruncateTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 注释入口保护全部同目标表页；不覆盖已有模态或未提交数据。 */
  function openTableComment(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { assertTableCommentTargetAvailable(target, useWorkspace.getState()); useWorkspace.setState({ notice: undefined }); setCommentEdits(false); setCommentTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 默认编码入口保护精确目标所有表页，不覆盖数据草稿或其他模态。 */
  function openTableDefaultEncoding(target: TableColumnPatchTarget) {
    if (document.querySelector('[role="dialog"]')) return;
    try { assertTableDefaultEncodingTargetAvailable(target, useWorkspace.getState()); useWorkspace.setState({ notice: undefined }); setEncodingEdits(false); setEncodingTarget(structuredClone(target)); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  /** 完成只通知精确目标表页，核验不明仅标过期，不重放DDL或影响其他表。 */
  /** 已确认CREATE只刷新固定连接/数据库，既不重绑旧页，也不让迟到回调关闭另一窗口。 */
  function finishTableCreate(result: TableCreateApplyOutput, version: number) {
    const workspace = useWorkspace.getState();
    if ((workspace.connectionVersions[result.target.connectionId] ?? 0) !== version) { workspace.notify(tableCreateZh.mismatch, true); return; }
    refreshRenameDatabase(result.target); markStructureTarget(result.target, false);
  }
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
  return <div className={`app platform-${platform} ${workbench.snapshot.document.focusMode ? 'focus-mode' : ''}`}><header className="app-titlebar"><Brand/><span className="title-divider"/><span className="window-title">{zh.app.text005}</span><span className="grow"/><span className="version-label">v{version}</span><button className="icon-button" title={settings.theme === 'dark' ? zh.app.text006 : zh.app.text007} aria-label={zh.app.text008} onClick={() => state.updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>{settings.theme === 'dark' ? <Sun size={15}/> : <Moon size={15}/>}</button><button className="icon-button" title={zh.app.text009} aria-label={zh.app.text009} onClick={() => setPreferences(true)}><Settings2 size={15}/></button></header><div className="app-commandbar"><button className="new-connection-button" onClick={() => setConnectionDialog('new')}><Plus size={15}/>{zh.common.newConnection}</button><button aria-label={connectionsTransferZh.open} onClick={openConnectionsTransfer}>{connectionsTransferZh.open}</button><span className="toolbar-divider"/><button disabled={!connections.length} onClick={() => openNewQueryDialog()}><FileCode2 size={15}/>{zh.common.newQuery}</button><button onClick={() => setHistory(true)}><History size={15}/>{zh.common.historyQueries}</button><button title="Ctrl / ⌘ Shift B" onClick={openWorkbenchManager}>{workbenchZh.title}</button><button title="Ctrl / ⌘ Shift O" onClick={openObjectLink}>{workbenchZh.paste}</button><button title="Ctrl / ⌘ Shift L" disabled={!workbench.ready || workbench.busy} aria-pressed={workbench.snapshot.document.focusMode} onClick={() => void workbench.save({ ...workbench.snapshot.document, focusMode: !workbench.snapshot.document.focusMode })}>{workbench.snapshot.document.focusMode ? workbenchZh.exitFocus : workbenchZh.focus}</button><button onClick={() => setSchemaCompare(true)}>{schemaCompareZh.entry}</button><span className="grow"/><button onClick={()=>setStructureSearch(true)}><Search size={15}/>{databaseSearchZh.entry}</button><button onClick={() => setTasks(true)}><Activity size={15}/>{zh.common.taskCenter}{runningCount > 0 && <span className="count">{runningCount}</span>}</button><button className="icon-button" aria-label={zh.app.text010} onClick={() => setAbout(true)}><CircleHelp size={16}/></button></div><div className="app-body"><div className="sidebar-container" style={{ width: settings.sidebarWidth }}><Sidebar onTableAutoIncrement={(connectionId, database, table) => openTableAutoIncrement({ connectionId, database, table })} objectRefreshVersions={objectRefreshVersions} onTableCopyData={(connectionId, database, table) => openTableCopyData({ connectionId, database, table })} onTableCopyStructure={(connectionId, database, table) => openTableCopyStructure({ connectionId, database, table })} onTableRename={(connectionId, database, table) => openTableRename({ connectionId, database, table })} onTableDefaultEncoding={(connectionId, database, table) => openTableDefaultEncoding({ connectionId, database, table })} onTableComment={(connectionId, database, table) => openTableComment({ connectionId, database, table })} onOpenWorkbench={openWorkbenchTarget} onNewConnection={() => setConnectionDialog('new')} onEditConnection={setConnectionDialog} onForeignKeyPatches={(connectionId, database, table) => openForeignKeyPatches({ connectionId, database, table })} onIndexPatches={(connectionId, database, table) => openIndexPatches({ connectionId, database, table })} onColumnPatches={(connectionId, database, table) => openColumnPatches({ connectionId, database, table })} onCopyConnection={profile => { setConnectionCopy(copyConnectionOverview(profile)); setConnectionDialog('new'); }} onDesign={(connectionId, database, table) => setSchema({ connectionId, database, table })} onDdl={(connectionId, database, object) => setDdl({ connectionId, database, object })} refreshVersion={refreshVersion}/></div><div className="vertical-resize" role="separator" aria-label={zh.app.text011} aria-orientation="vertical" onPointerDown={resizeSidebar}/><main className="main-workspace"><div className="tab-strip">{settings.tabs.length ? settings.tabs.map(tab => <div key={tab.id} className={`workspace-tab-button ${tab.id === activeTab?.id ? 'active' : ''}`}><button className="tab-select" onClick={() => state.updateSettings({ activeTabId: tab.id })}>{tab.kind === 'query' ? <FileCode2 size={14}/> : <Table2 size={14}/>}<span>{tab.title}</span>{state.dirtyTabs[tab.id] && <span className="dirty-dot"/>}</button><button className="tab-close" aria-label={formatText(zh.app.text012, tab.title)} onClick={() => closeTab(tab.id)}><X size={12}/></button></div>) : <div className="welcome-tab"><Database size={14}/>{zh.app.text013}</div>}<button className="add-tab" title={zh.common.newQuery} aria-label={zh.app.text014} onClick={openQueryTabEntry}><Plus size={15}/></button></div>{settings.tabs.length ? <div className="tab-content">{settings.tabs.map(tab => <section key={tab.id} className="tab-pane" hidden={tab.id !== activeTab?.id}>{tab.kind === 'query' ? <QueryTab tab={tab} closeRequest={queryCloseRequest?.tabId === tab.id ? queryCloseRequest : undefined} onCloseRequestFinished={finishQueryClose} searchNavigation={Object.hasOwn(querySearchPositions,tab.id)?querySearchPositions[tab.id]:undefined} onHistory={() => setHistory(true)}/> : <TableTab onTableDrop={() => openTableDrop({ connectionId: tab.connectionId!, database: tab.database!, table: tab.table! })} onTableTruncate={() => openTableTruncate({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onTableAutoIncrement={() => openTableAutoIncrement({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onTableCopyData={() => openTableCopyData({ connectionId: tab.connectionId!, database: tab.database!, table: tab.table! })} onTableCopyStructure={() => openTableCopyStructure({ connectionId: tab.connectionId!, database: tab.database!, table: tab.table! })} onTableRename={() => openTableRename({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onTableDefaultEncoding={() => openTableDefaultEncoding({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onTableComment={() => openTableComment({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} tab={tab} refreshVersion={structureRefresh[columnTargetKey({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })]?.version ?? 0} refreshAutomatically={structureRefresh[columnTargetKey({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })]?.automatic ?? true} onForeignKeyPatches={() => openForeignKeyPatches({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onIndexPatches={() => openIndexPatches({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onColumnPatches={() => openColumnPatches({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! })} onDesign={isView => isView ? setDdl({ connectionId: tab.connectionId, database: tab.database!, object: { name: tab.table!, kind: 'view' } }) : setSchema({ connectionId: tab.connectionId, database: tab.database!, table: tab.table })} onTransfer={mode => setTransfer({ mode, connectionId: tab.connectionId, database: tab.database!, table: tab.table! })}/>}</section>)}</div> : <Welcome onConnect={() => setConnectionDialog('new')} onQuery={() => openNewQueryDialog()} onHistory={() => setHistory(true)}/>}</main></div><footer className="app-statusbar"><span className="status-dot"/>{zh.app.text015}<span className="status-divider"/><span>{activeTab ? connections.find(profile => profile.id === activeTab.connectionId)?.name || zh.common.connectionDeleted : 'MySQL · MariaDB'}</span><span className="grow"/><button onClick={() => setTasks(true)}>{runningCount ? formatText(zh.app.text016, runningCount) : zh.app.text017}</button><span className="status-divider"/><span>UTF-8</span></footer>{notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <CheckCircle2 size={17}/>}<span>{notice.text}</span><button aria-label={zh.app.text018} onClick={() => useWorkspace.setState({ notice: undefined })}><X size={15}/></button></div>}
    {workbenchDialog && <WorkbenchDialog onOpen={openWorkbenchTarget} onClose={closeWorkbenchManager}/>}
    {objectLinkDialog && <ObjectLinkDialog onOpen={openWorkbenchTarget} onClose={closeObjectLink}/>}

    {schemaCompare && <SchemaCompareDialog connections={connections} services={schemaCompareServices} onClose={() => setSchemaCompare(false)}/>}
    {dataSearch&&<DataSearchDialog onClose={()=>setDataSearch(false)} onStructure={()=>{setDataSearch(false);setStructureSearch(true);}} onOpen={(connectionId,target)=>{setDataSearch(false);useWorkspace.getState().openTab({kind:"table",title:target.table,connectionId,database:target.database,table:target.table});}}/>}
    {savedQuerySearch&&<SavedQuerySearchDialog onClose={()=>setSavedQuerySearch(false)} onStructure={()=>{setSavedQuerySearch(false);setStructureSearch(true);}} onOpen={(result,hit)=>{const id=uid();if(hit?.sqlOccurrences&&result.sourceBinding?.id===hit.query.id&&result.sourceBinding.digest===hit.digest)setQuerySearchPositions(previous=>({...previous,[id]:{queryId:hit.query.id,digest:hit.digest,sql:result.query.sql,connectionId:result.connectionId,connectionVersion:useWorkspace.getState().connectionVersions[result.connectionId]??0,occurrences:hit.sqlOccurrences!}}));useWorkspace.getState().openTab({id,kind:'query',title:result.query.name,connectionId:result.connectionId,database:result.database,databaseContext:result.databaseContext,sql:result.query.sql,sourceBinding:result.sourceBinding});setSavedQuerySearch(false);if(result.contextChanged)useWorkspace.getState().notify(savedQuerySearchZh.replaced);}}/>}
    {encodingTarget && <TableDefaultEncodingDialog target={encodingTarget} targetVersion={state.connectionVersions[encodingTarget.connectionId] ?? 0} services={tableDefaultEncodingServices} onDirtyChange={setEncodingEdits} beforeApply={() => assertTableDefaultEncodingTargetAvailable(encodingTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(encodingTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(tableDefaultEncodingZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(encodingTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setEncodingTarget(null); setEncodingEdits(false); }}/>}
    {counterTarget && <TableAutoIncrementDialog target={counterTarget} targetVersion={state.connectionVersions[counterTarget.connectionId] ?? 0} services={tableAutoIncrementServices} onDirtyChange={setCounterEdits} beforeApply={() => assertTableAutoIncrementTargetAvailable(counterTarget, useWorkspace.getState())} onApplied={result => { if ((useWorkspace.getState().connectionVersions[counterTarget.connectionId] ?? 0) !== counterVersion) { useWorkspace.getState().notify(tableAutoIncrementZh.targetChanged, true); return; } markStructureTarget(counterTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(tableAutoIncrementZh.verificationFailed, true); }} onExecutionUncertain={message => { if ((useWorkspace.getState().connectionVersions[counterTarget.connectionId] ?? 0) === counterVersion) markStructureTarget(counterTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setCounterTarget(null); setCounterEdits(false); }}/>}
    {copyDataTarget && <TableCopyDataDialog target={copyDataTarget} targetVersion={state.connectionVersions[copyDataTarget.connectionId] ?? 0} services={tableCopyDataServices} onDirtyChange={setCopyDataEdits} beforeApply={newName => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyDataTarget.connectionId] ?? 0) !== copyDataVersion) throw Error(tableCopyDataZh.targetChanged);
      assertTableCopyDataTargetAvailable(copyDataTarget, workspace); assertTableCopyDataTargetAvailable({ ...copyDataTarget, table: newName }, workspace); workbenchNavigation.invalidate();
    }} onApplied={result => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyDataTarget.connectionId] ?? 0) !== copyDataVersion) { workspace.notify(tableCopyDataZh.targetChanged, true); return; }
      refreshRenameDatabase(copyDataTarget); markStructureTarget(result.newTarget, result.definitionVerified);
      // DDL成功但后核不完整也可能是源身份变化；两端均保守失效，保留源页与所有草稿。
      if (!result.definitionVerified) { markStructureTarget(copyDataTarget, false); workspace.notify(tableCopyDataZh.verificationFailed, true); }
    }} onExecutionUncertain={(message, newName) => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyDataTarget.connectionId] ?? 0) === copyDataVersion) { refreshRenameDatabase(copyDataTarget); markStructureTarget(copyDataTarget, false); markStructureTarget({ ...copyDataTarget, table: newName }, false); }
      workspace.notify(message, true);
    }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setCopyDataTarget(null); setCopyDataEdits(false); }}/>}
    {copyStructureTarget && <TableCopyStructureDialog target={copyStructureTarget} targetVersion={state.connectionVersions[copyStructureTarget.connectionId] ?? 0} services={tableCopyStructureServices} onDirtyChange={setCopyStructureEdits} beforeApply={newName => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyStructureTarget.connectionId] ?? 0) !== copyStructureVersion) throw Error(tableCopyStructureZh.targetChanged);
      assertTableCopyStructureTargetAvailable(copyStructureTarget, workspace); assertTableCopyStructureTargetAvailable({ ...copyStructureTarget, table: newName }, workspace); workbenchNavigation.invalidate();
    }} onApplied={result => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyStructureTarget.connectionId] ?? 0) !== copyStructureVersion) { workspace.notify(tableCopyStructureZh.targetChanged, true); return; }
      refreshRenameDatabase(copyStructureTarget); markStructureTarget(result.newTarget, result.definitionVerified);
      // DDL成功但后核不完整也可能是源身份变化；两端均保守失效，保留源页与所有草稿。
      if (!result.definitionVerified) { markStructureTarget(copyStructureTarget, false); workspace.notify(tableCopyStructureZh.verificationFailed, true); }
    }} onExecutionUncertain={(message, newName) => {
      const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[copyStructureTarget.connectionId] ?? 0) === copyStructureVersion) { refreshRenameDatabase(copyStructureTarget); markStructureTarget(copyStructureTarget, false); markStructureTarget({ ...copyStructureTarget, table: newName }, false); }
      workspace.notify(message, true);
    }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setCopyStructureTarget(null); setCopyStructureEdits(false); }}/>}
    {renameTarget && <TableRenameDialog target={renameTarget} targetVersion={state.connectionVersions[renameTarget.connectionId] ?? 0} services={tableRenameServices} onDirtyChange={setRenameEdits} beforeApply={newName => { const current = useWorkspace.getState(); assertTableRenameTargetAvailable(renameTarget, current); assertTableRenameTargetAvailable({ ...renameTarget, table: newName }, current); workbenchNavigation.invalidate(); }} onApplied={result => { void finishTableRename(result, renameVersion).catch(reason => useWorkspace.getState().notify(errorMessage(reason), true)); }} onExecutionUncertain={(message, newName) => {
      if ((useWorkspace.getState().connectionVersions[renameTarget.connectionId] ?? 0) === renameVersion) {
        // 未核验的来源/目标均按未知身份退役，不借不完整凭证恢复名称，也不重放DDL。
        workbenchNavigation.retireTable(renameTarget); workbenchNavigation.retireTable({ ...renameTarget, table: newName });
        refreshRenameDatabase(renameTarget); markStructureTarget(renameTarget, false); markStructureTarget({ ...renameTarget, table: newName }, false); workbenchNavigation.invalidate();
      }
      useWorkspace.getState().notify(message, true);
    }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setRenameTarget(null); setRenameEdits(false); }}/>}
    {dropTarget && <TableDropDialog target={dropTarget} targetVersion={state.connectionVersions[dropTarget.connectionId] ?? 0} services={tableDropServices} onDirtyChange={setDropEdits} beforeApply={() => { const current = useWorkspace.getState(); if ((current.connectionVersions[dropTarget.connectionId] ?? 0) !== dropVersion) throw new Error(tableDropZh.targetChanged); assertTableDropTargetAvailable(dropTarget, current); workbenchNavigation.invalidate(); }} onApplied={result => { finishTableDrop(dropTarget, dropVersion, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(tableDropZh.verificationFailed, true); }} onExecutionUncertain={message => { finishTableDrop(dropTarget, dropVersion, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setDropTarget(null); setDropEdits(false); }}/>}
    {truncateTarget && <TableTruncateDialog target={truncateTarget} targetVersion={state.connectionVersions[truncateTarget.connectionId] ?? 0} services={tableTruncateServices} onDirtyChange={setTruncateEdits} beforeApply={() => { const current = useWorkspace.getState(); if ((current.connectionVersions[truncateTarget.connectionId] ?? 0) !== truncateVersion) throw new Error(tableTruncateZh.targetChanged); assertTableTruncateTargetAvailable(truncateTarget, current); }} onApplied={result => { markStructureTarget(truncateTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(tableTruncateZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(truncateTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setTruncateTarget(null); setTruncateEdits(false); }}/>}
    {commentTarget && <TableCommentDialog target={commentTarget} targetVersion={state.connectionVersions[commentTarget.connectionId] ?? 0} services={tableCommentServices} onDirtyChange={setCommentEdits} beforeApply={() => assertTableCommentTargetAvailable(commentTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(commentTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(tableCommentZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(commentTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setCommentTarget(null); setCommentEdits(false); }}/>}
    {foreignKeyTarget && <ForeignKeyPatchDialog target={foreignKeyTarget} targetVersion={state.connectionVersions[foreignKeyTarget.connectionId] ?? 0} services={foreignKeyPatchServices} onDirtyChange={setForeignKeyEdits} beforeApply={targets => assertForeignKeyTargetsAvailable(targets ?? [foreignKeyTarget], useWorkspace.getState())} onApplied={result => { markStructureTarget(foreignKeyTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(foreignKeyPatchZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(foreignKeyTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setForeignKeyTarget(null); setForeignKeyEdits(false); }}/>}
    {indexTarget && <IndexPatchDialog target={indexTarget} targetVersion={state.connectionVersions[indexTarget.connectionId] ?? 0} services={indexPatchServices} onDirtyChange={setIndexEdits} beforeApply={() => assertIndexTargetAvailable(indexTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(indexTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(indexPatchZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(indexTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setIndexTarget(null); setIndexEdits(false); }}/>} {structureSearch&&<StructureSearchDialog onSavedQueries={()=>{setStructureSearch(false);setSavedQuerySearch(true);}} onData={()=>{setStructureSearch(false);setDataSearch(true);}} onClose={()=>setStructureSearch(false)} onOpen={(connectionId,hit,definitionSearch)=>{setStructureSearch(false);setDdl({connectionId,database:hit.database,object:{name:hit.object,kind:hit.parentKind},readOnly:true,definitionSearch});}}/>} {columnTarget && <ColumnPatchDialog target={columnTarget} targetVersion={state.connectionVersions[columnTarget.connectionId] ?? 0} services={columnPatchServices} onDirtyChange={setColumnEdits} beforeApply={() => assertColumnTargetAvailable(columnTarget, useWorkspace.getState())} onApplied={result => { markStructureTarget(columnTarget, result.definitionVerified); if (!result.definitionVerified) useWorkspace.getState().notify(columnPatchZh.verificationFailed, true); }} onExecutionUncertain={message => { markStructureTarget(columnTarget, false); useWorkspace.getState().notify(message, true); }} onCleanupError={message => useWorkspace.getState().notify(message, true)} onClose={() => { setColumnTarget(null); setColumnEdits(false); }}/>} {connectionsTransfer && <ConnectionsTransferDialog onClose={closeConnectionsTransfer}/>} {connectionDialog && <ConnectionDialog profile={connectionDialog === 'new' ? undefined : connectionDialog} initialProfile={connectionDialog === 'new' ? connectionCopy ?? undefined : undefined} onClose={() => { setConnectionCopy(null); setConnectionDialog(null); }} onTransportChanged={state.invalidateConnection}/>} {newQuery && <NewQueryDialog onClose={closeNewQueryDialog}/>} {history && <HistoryDialog onClose={() => setHistory(false)}/>} {tasks && <TasksDialog onClose={() => setTasks(false)}/>} {schema && <SchemaDialog {...schema} onDirtyChange={setTableCreateEdits} onCreated={finishTableCreate} onClose={() => { setSchema(null); setTableCreateEdits(false); }} onApplied={() => setRefreshVersion(value => value + 1)}/>} {ddl && <DdlDialog {...ddl} onDirtyChange={setDatabaseCreateEdits} onClose={() => { setDdl(null); setDatabaseCreateEdits(false); }} onApplied={() => setRefreshVersion(value => value + 1)}/>} {transfer && <TransferDialog {...transfer} onClose={() => setTransfer(null)}/>}
    {preferences && <Modal title={zh.app.text009} onClose={() => setPreferences(false)}><div className="modal-content form-grid"><Field label={zh.app.text019}><select value={settings.theme} onChange={event => state.updateSettings({ theme: event.target.value as 'dark' | 'light' })}><option value="dark">{zh.common.dark}</option><option value="light">{zh.common.light}</option></select></Field><Field label={zh.app.text020}><input type="number" min="1" max="100000" value={settings.resultLimit} onChange={event => state.updateSettings({ resultLimit: Math.max(1, Math.min(100000, Number(event.target.value))) })}/></Field><Field label={zh.app.text021}><select value={settings.pageSize} onChange={event => state.updateSettings({ pageSize: Number(event.target.value) })}>{[50, 100, 200, 500, 1000].map(size => <option key={size}>{size}</option>)}</select></Field><Field label={zh.app.text022}><input type="number" min="180" max="600" value={settings.sidebarWidth} onChange={event => state.updateSettings({ sidebarWidth: Math.max(180, Math.min(600, Number(event.target.value))) })}/></Field><DataTypeColorPreferences enabled={settings.dataTypeColors === true} onChange={enabled => state.updateSettings({ dataTypeColors: enabled })}/><p className="full muted small">{zh.app.text023}{encryptionAvailable ? zh.app.text024 : zh.app.text025}</p></div><footer className="modal-footer"><span className="grow"/><button className="primary" onClick={() => setPreferences(false)}>{zh.common.done}</button></footer></Modal>}
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
  useEffect(() => {
    let alive=true;setDatabases([]);if(!connectionId)return;setBusy(true);
    // 复用原有建连结果，不新增能力探测SQL；旧连接修订的迟到结果不能填充新草稿。
    const revision=useWorkspace.getState().connectionVersions[connectionId]??0,ticket=completionServerFacts.begin(connectionId,revision);
    void invoke('connections.open',{id:connectionId}).then(status=>{
      if((useWorkspace.getState().connectionVersions[connectionId]??0)===revision)completionServerFacts.complete(ticket,status);else completionServerFacts.fail(ticket);
      return invoke('metadata.databases',{connectionId});
    }).then(items=>{if(alive)setDatabases(items);}).catch(reason=>{completionServerFacts.fail(ticket);if(alive)setError(errorMessage(reason));}).finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[connectionId]);
  return <Modal title={zh.common.newQuery} onClose={onClose}><form onSubmit={event => { event.preventDefault(); if (connectionId) { useWorkspace.getState().openTab({ kind: 'query', title: zh.common.unnamedQuery, connectionId, database: database || undefined, sql: '' }); onClose(); } }}><div className="modal-content form-grid"><Field label={zh.app.text049} full><select value={connectionId} onChange={event => { setConnectionId(event.target.value); setDatabase(''); setError(''); }}>{connections.map(profile => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></Field><Field label={zh.app.text050} full><input list="query-databases" value={database} onChange={event => setDatabase(event.target.value)} placeholder={busy ? zh.app.text051 : zh.app.text052}/><datalist id="query-databases">{databases.map(name => <option key={name} value={name}/>)}</datalist></Field><ErrorBox message={error}/></div><footer className="modal-footer"><span className="grow"/><button type="button" onClick={onClose}>{zh.common.cancel}</button><button className="primary" type="submit" disabled={!connectionId}>{zh.app.text053}<ArrowRight size={14}/></button></footer></form></Modal>;
}
