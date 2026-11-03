import { SqliteTablePresetPanel } from './SqliteTablePresetPanel';
import { SqliteRelationshipDialog } from './SqliteRelationshipDialog';
import { relationshipDiagramZh as diagramText } from '../locales/relationshipDiagram.zh-CN';
import { SqliteValueOptionsDialog } from './SqliteValueOptionsDialog';
import { SqliteStatisticsDialog } from './SqliteStatisticsDialog';
import { sqliteStatisticsZh as statisticsText } from '../locales/sqliteStatistics.zh-CN';
import type { SqliteStatisticsInput } from '../../shared/sqliteStatistics';
import { sqliteValueOptionsZh as valuesText } from '../locales/sqliteValueOptions.zh-CN';
import type { SqliteValueOptionsInput } from '../../shared/sqliteValueOptions';
import type { SqliteTableFilter } from '../../shared/sqliteTableBrowse';
import { SqliteTableLayoutController, type SqliteLayoutView, type SqliteLayoutScope } from '../sqliteTableLayout';
import { sqliteLayoutProjection } from '../../shared/sqliteTableLayout';
import { sqliteTableLayoutZh as layoutText } from '../locales/sqliteTableLayout.zh-CN';
import { changeTablePreference } from '../tableColumnPreferences';
import { TablePreferencesDialog } from './TablePreferencesDialog';
import type { TablePreferences } from '../../shared/tablePreferences';
import { sqliteTablePresetsZh as presetText } from '../locales/sqliteTablePresets.zh-CN';
import { sqlitePresetDraft } from '../sqliteTablePresetDraft';
import type { SqliteTablePresetQuery } from '../../shared/sqliteTablePresets';
import { captureSqliteCellFilter, type SqliteCellFilterSource } from '../sqliteTableCellFilter';
import { sqliteTableCellFilterZh as cellFilterText } from '../locales/sqliteTableCellFilter.zh-CN';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import { SqliteTableFilters } from './SqliteTableFilters';
import type { SqliteTableRebuildTarget } from '../../shared/sqliteTableRebuild';
import { sqliteTableRebuildZh } from '../locales/sqliteTableRebuild.zh-CN';
import { sqliteObjectsZh } from '../locales/sqliteObjects.zh-CN';
import { sqliteTableMaintenanceZh } from '../locales/sqliteTableMaintenance.zh-CN';
import type { SqliteTableMaintenanceAction } from '../../shared/sqliteTableMaintenance';
import { sqliteTableRenameZh } from '../locales/sqliteTableRename.zh-CN';
import { ActionMenuSection } from './ActionMenu';
import { AdaptiveToolbar } from './AdaptiveToolbar';
import { tableToolbarZh } from '../locales/tableToolbar.zh-CN';
import { navigationZh } from '../locales/navigation.zh-CN';
import { sqliteIndexesZh } from '../locales/sqliteIndexes.zh-CN';
import { sqliteColumnsZh } from '../locales/sqliteColumns.zh-CN';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ResultExportData } from '../../shared/contracts';
import type { SqliteOriginalValue, SqliteTableEditPreview } from '../../shared/sqliteTableEdit';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableBrowseLimits } from '../../shared/sqliteTableBrowse';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab, type WorkspaceBusyLease } from '../store';
import { invoke, uid, errorMessage } from '../lib';
import { resultExportData } from '../resultExport';
import { SqliteTableBrowser, sqliteTableDraft, type SqliteTableQuery, type SqliteTableView, type SqliteFilterDraft, type SqliteSortDraft } from '../sqliteTableBrowser';
import { sqliteHeaderSortFromGrid, sqliteHeaderSortToGrid, type SqliteHeaderSort } from '../sqliteTableHeaderSort';
import { prepareSqliteDuplicate, sqliteDuplicateSourceCurrent, type SqliteDuplicateSource } from '../sqliteTableDuplicate';
import type { SqliteCheckedRows } from '../sqliteTableSelection';
import { prepareSqliteFill, sqliteFillSourceCurrent, type SqliteFillSource, type SqliteFillField } from '../sqliteTableFill';
import { SqliteTableFillDialog } from './SqliteTableFillDialog';
import { sqliteTableFillZh as fillText } from '../locales/sqliteTableFill.zh-CN';
import { SqliteFilteredSelectIntent, type SqliteFilteredSelectPlan } from '../sqliteFilteredSelectUi';
import { SqliteFilteredSelectDialog } from './SqliteFilteredSelectDialog';
import { sqliteFilteredSelectZh as filteredSelectText } from '../locales/sqliteFilteredSelect.zh-CN';
import { sqliteTableBrowseZh as text } from '../locales/sqliteTableBrowse.zh-CN';
import { sqliteZh } from '../locales/sqlite.zh-CN';
import { openSqliteSelect } from '../sqliteNavigation';
import { useUiCommandScope } from '../uiCommands';
import { ResultsGrid } from './ResultsGrid';
import { openFocusedGridRowJump } from './GridRowJump';
import { SqliteTableExportDialog } from './SqliteTableExportDialog';
import { SqliteTableExportIntent } from '../sqliteTableExportUi';
import { sqliteTableExportZh as exportText } from '../locales/sqliteTableExport.zh-CN';
import { ResultExportDialog } from './ResultExportDialog';
import { Empty, ErrorBox, Spinner } from './ui';
import { SqliteTableEditor, type SqliteEditView, type SqliteDraftRow } from '../sqliteTableEditor';
import { SqliteTableEditGrid, type SqliteTableFindGridHit } from './SqliteTableEditGrid';
import { SqliteTableFindPanel, type SqliteTableFindFocusRequest, type SqliteTableFindSeed } from './SqliteTableFindPanel';
import { sqliteTextReplacementPlanValues, type SqliteTextReplacementPlan } from '../sqliteTableFindWorkerClient';
import { sqliteTableFindZh as findText } from '../locales/sqliteTableFind.zh-CN';
import { SqliteTableValueDialog, SqliteTablePreviewDialog } from './SqliteTableEditDialog';
import { sqliteTableEditZh as editText } from '../locales/sqliteTableEdit.zh-CN';
import { SqliteTableImportDialog, SqliteTableImportSource } from './SqliteTableImportDialog';
import { sqliteTableImportZh as importText } from '../locales/sqliteTableImport.zh-CN';
import type { SqliteTableEditOutcome } from '../../shared/sqliteTableEdit';
import { SqlitePasteInsertDialog } from './SqlitePasteInsertDialog';
import { SqlitePasteRangeDialog } from './SqlitePasteRangeDialog';
import { sqliteRangePastePlanValues, type SqlitePasteAnchor, type SqliteRangePastePlan } from '../sqliteTableRangePaste';
import { sqliteTableRangePasteZh as rangeText } from '../locales/sqliteTableRangePaste.zh-CN';
import { readSqliteClipboard, sqlitePastePlanValues, type SqliteClipboardSource, type SqlitePastePlan } from '../sqliteTableClipboard';
import { sqliteTableClipboardZh as clipboardText } from '../locales/sqliteTableClipboard.zh-CN';
import { QueryRowDetails, type QueryRowDetailsBinding, type QueryRowDetailsView } from '../queryRowDetails';
import { QueryRowDetailsPanel } from './QueryRowDetailsPanel';
import { queryRowDetailsZh as detailText } from '../locales/queryRowDetails.zh-CN';
import '../sqliteTableBrowse.css';

interface FullExportOwner { intent: SqliteTableExportIntent; acquiring: boolean; lease?: WorkspaceBusyLease; }
interface ImportOwner { source: SqliteTableImportSource; page: SqliteTablePage; acquiring: boolean; dirty: boolean; refreshed: boolean; lease?: WorkspaceBusyLease; }
interface EditInputTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; row: SqliteDraftRow; column?: number; duplicate?: { source: SqliteDuplicateSource; valid: boolean }; }
interface RangeInputTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; anchor: SqlitePasteAnchor; valid: boolean; source?: SqliteClipboardSource; }
interface PasteInputTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; valid: boolean; source?: SqliteClipboardSource; }
interface FindInputTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; valid: boolean; preview: boolean; staging: boolean; retiringPreview?: string; seed?: SqliteTableFindSeed; }
interface EditPreviewTicket { id: string; editor: SqliteTableEditor; page: SqliteTablePage; rows: SqliteDraftRow[]; }
interface CheckedRowsOwner { id: string; editor: SqliteTableEditor; capture: SqliteCheckedRows; }
interface FillInputTicket { id: string; editor: SqliteTableEditor; source: SqliteFillSource; valid: boolean; attached: boolean; }
interface FilteredSelectOwner { id: string; intent: SqliteFilteredSelectIntent; page: SqliteTablePage; query: SqliteTableQuery; editor: SqliteTableEditor | null; rows?: SqliteDraftRow[]; attached: boolean; }

/** 初次请求只读取无条件第一页，不恢复未明确应用的草稿条件。 */
const initialQuery = (): SqliteTableQuery => ({ limit: 100, mode: 'and', filters: [], sort: [] });
/** 原 table 标签的 SQLite 分支复用分页来源；编辑采用独立快照，不借用查询标签事务。 */
export function SqliteTableTab({ tab, active, refreshVersion = 0, refreshAutomatically = true, onIndexes, onColumns, onRename, onSqliteTableRebuild, onMaintenance, onObject }: { tab: WorkspaceTab; active: boolean; refreshVersion?: number; refreshAutomatically?: boolean; onIndexes?(): void; onColumns?(): void; onRename?(): void; onSqliteTableRebuild?(target: SqliteTableRebuildTarget): void; onMaintenance?(action: SqliteTableMaintenanceAction): void; onObject?(action: 'replace' | 'drop'): void }) {
  const profile = useWorkspace(state => state.connections.find(item => item.id === tab.connectionId));
  const version = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const externalBusy = useWorkspace(state => !!state.activeJobs[tab.id]);
  const latest = useRef({ tab, active, refreshVersion }); latest.current = { tab, active, refreshVersion };
  // 未知结构回执在原标签内持续阻止自动读取；切换标签或后续回执不能替代用户明确刷新。
  const automaticReads = useRef({ version: refreshVersion, blocked: false });
  if (automaticReads.current.version !== refreshVersion) automaticReads.current = { version: refreshVersion, blocked: automaticReads.current.blocked || !refreshAutomatically };
  const [view, setView] = useState<SqliteTableView>({ busy: false, stopping: false, error: '', columns: [] });
  const [conditions, setConditions] = useState(false), [limit, setLimit] = useState(100), [mode, setMode] = useState<'and' | 'or'>('and');
  const [filters, setFilters] = useState<SqliteFilterDraft[]>([]), [sort, setSort] = useState<SqliteSortDraft[]>([]), [validation, setValidation] = useState('');
  const [presetsVisible, setPresetsVisible] = useState(false);
  const [cellFilterOwner, setCellFilterOwner] = useState<{ id: string; page: SqliteTablePage; row: unknown; column: number; source: SqliteCellFilterSource }>(), cellFilterRef = useRef<typeof cellFilterOwner>(undefined);
  const [cellFilterReason, setCellFilterReason] = useState('');
  const [exportData, setExportData] = useState<ResultExportData | null>(null);
  const applied = useRef(initialQuery());
  const [fullExport, setFullExport] = useState<FullExportOwner | null>(null), fullExportRef = useRef<FullExportOwner | null>(null);
  const [tableImport, setTableImport] = useState<ImportOwner | null>(null), importRef = useRef<ImportOwner | null>(null);
  const editorRef = useRef<SqliteTableEditor | null>(null), [editView, setEditView] = useState<SqliteEditView | null>(null);
  const layoutDirtyRef = useRef(false), layoutScopeRef = useRef<SqliteLayoutScope | undefined>(undefined);
  const [layoutView, setLayoutView] = useState<SqliteLayoutView>({ preferences: { version: 1, columns: [] }, ready: false, pending: false, dirty: false, error: '' });
  const [layoutDialog, setLayoutDialog] = useState<{ scope: object; preferences: TablePreferences; dirty: boolean }>();
  const [layout] = useState(() => new SqliteTableLayoutController({
    scope: () => { if (!layoutScopeRef.current) throw Error(layoutText.stale); return layoutScopeRef.current; },
    get: input => invoke('sqlite.tableLayout.get', input), save: input => invoke('sqlite.tableLayout.save', input), reset: input => invoke('sqlite.tableLayout.reset', input), acquire: () => acquireWorkspaceBusy(latest.current.tab.id),
    changed: next => { layoutDirtyRef.current = next.dirty; setLayoutView(next); const now = useWorkspace.getState(), current = latest.current.tab; if (now.settings.tabs.find(item => item.id === current.id) === current) now.setDirty(current.id, next.dirty || !!editorRef.current?.dirty || !!importRef.current?.dirty); },
  }));
  const [selectedRow, setSelectedRow] = useState<string>(), [cellInput, setCellInput] = useState<EditInputTicket | null>(null), inputRef = useRef<EditInputTicket | null>(null);
  const [rowDetails] = useState(() => new QueryRowDetails());
  type DetailSelection = { binding: QueryRowDetailsBinding; index: number };
  const [detailSelection, setDetailSelection] = useState<DetailSelection | null>(null);
  const detailSelectionRef = useRef<DetailSelection | null>(null);
  const [rowDetail, setRowDetail] = useState<QueryRowDetailsView | null>(null);
  const [previewOpen, setPreviewOpen] = useState<EditPreviewTicket | null>(null), previewRef = useRef<EditPreviewTicket | null>(null);
  const [pasteOpen, setPasteOpen] = useState<PasteInputTicket | null>(null), pasteRef = useRef<PasteInputTicket | null>(null);
  const [rangeOpen, setRangeOpen] = useState<RangeInputTicket | null>(null), rangeRef = useRef<RangeInputTicket | null>(null);
  const [rangeCell, setRangeCell] = useState<SqlitePasteAnchor>(), rangeCellRef = useRef<SqlitePasteAnchor | undefined>(undefined);
  const [findOpen, setFindOpen] = useState<FindInputTicket | null>(null), findRef = useRef<FindInputTicket | null>(null);
  const [findPreview, setFindPreview] = useState(false), [findFocus, setFindFocus] = useState<SqliteTableFindFocusRequest>({ id: 0, mode: 'find' });
  const [findHit, setFindHit] = useState<SqliteTableFindGridHit>();
  const [checkedRows, setCheckedRows] = useState<CheckedRowsOwner>(), checkedRef = useRef<CheckedRowsOwner | undefined>(undefined);
  const [fillOpen, setFillOpen] = useState<FillInputTicket | null>(null), fillRef = useRef<FillInputTicket | null>(null);
  const [filteredSelectOpen, setFilteredSelectOpen] = useState<FilteredSelectOwner | null>(null), filteredSelectRef = useRef<FilteredSelectOwner | null>(null);
  type DiagramOwner = { id: string; page: SqliteTablePage; valid: boolean; acquiring: boolean; lease?: WorkspaceBusyLease; current(): boolean; activity(delta: 1 | -1): void; };
  const [diagramOpen, setDiagramOpen] = useState<DiagramOwner>(), diagramRef = useRef<DiagramOwner | undefined>(undefined);
  type ValuesOwner = { id: string; base: Omit<SqliteValueOptionsInput, 'column' | 'search' | 'taskId'>; columns: string[]; mode: 'and' | 'or'; current(): boolean; apply(filter: SqliteTableFilter): boolean; valid: boolean; };
  const [valuesOpen, setValuesOpen] = useState<ValuesOwner>(), valuesRef = useRef<ValuesOwner | undefined>(undefined), valuesForm = useRef({ filters, mode, sort, limit }); valuesForm.current = { filters, mode, sort, limit };
  type StatisticsOwner = { id: string; base: Omit<SqliteStatisticsInput, 'column' | 'taskId'>; columns: string[]; valid: boolean; current(): boolean; };
  const [statisticsOpen, setStatisticsOpen] = useState<StatisticsOwner>(), statisticsRef = useRef<StatisticsOwner | undefined>(undefined);
  const editRenderTicket = {}, editRender = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { editRender.current = editRenderTicket; return () => { if (editRender.current === editRenderTicket) editRender.current = undefined; }; });
  const [controller] = useState(() => new SqliteTableBrowser({
    scope: () => {
      const current = latest.current, workspace = useWorkspace.getState(), present = workspace.settings.tabs.find(item => item.id === current.tab.id), connection = workspace.connections.find(item => item.id === current.tab.connectionId);
      return { tab: present, profile: connection, connectionId: current.tab.connectionId, database: current.tab.database, table: current.tab.table, version: workspace.connectionVersions[current.tab.connectionId] ?? 0, schemaRevision: current.refreshVersion, present: present === current.tab && present?.kind === 'table', active: current.active && workspace.settings.activeTabId === current.tab.id, sqlite: connection?.dialect === 'sqlite', ...(connection?.dialect === 'sqlite' && !connection.sqlite.readOnly ? { editing: true } : {}) };
    },
    acquire: () => acquireWorkspaceBusy(latest.current.tab.id), read: input => invoke('sqlite.tablePage', input), release: snapshotId => invoke('sqlite.tableEdit.release', { snapshotId }), cancel: taskId => invoke('query.cancel', { taskId }), id: uid, changed: next => { fullExportRef.current?.intent.current(); importRef.current?.source.observePage(next.page); setView(next); }, subscribe: changed => useWorkspace.subscribe(changed),
  }));
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  const target = useRef({ profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table });
  /** 新连接修订先清旧条件；初次只读无条件第一页，重新激活同目标沿已明确应用的配置。 */
  useEffect(() => {
    const before = target.current, changed = before.profile !== profile || before.version !== version || before.connectionId !== tab.connectionId || before.database !== tab.database || before.table !== tab.table;
    target.current = { profile, version, connectionId: tab.connectionId, database: tab.database, table: tab.table };
    editorRef.current?.observe();
    if (automaticReads.current.blocked) { controller.observe(); setValidation(sqliteIndexesZh.tableStale); return; }
    // 有草稿时保留原页；连接或目标变化只撤销提交权，不拿新回包替换本地内容。
    if (editorRef.current?.dirty || editorRef.current?.busy || importRef.current && (importRef.current.dirty || importRef.current.acquiring || importRef.current.lease)) { controller.observe(); return; }
    if (changed) { applied.current = initialQuery(); setLimit(100); setMode('and'); setFilters([]); setSort([]); setValidation(''); }
    if (active) { dropEditor(); void controller.load(applied.current, 0); } else controller.observe();
  }, [controller, active, profile, version, tab.connectionId, tab.database, tab.table]);
  const structureVersion = useRef(refreshVersion);
  const structureDisplay = useRef<{ tab: WorkspaceTab; profile: typeof profile; version: number; page: SqliteTablePage } | undefined>(undefined), displayVersion = useRef(refreshVersion);
  /** 旧页只保展示，不再提供编辑/导入/导出授权；目标或profile变化不能继承该展示。 */
  useLayoutEffect(() => {
    if (displayVersion.current !== refreshVersion) { displayVersion.current = refreshVersion; if (view.page) structureDisplay.current = { tab, profile, version, page: view.page }; }
    if (view.page && controller.pageCurrent(view.page)) structureDisplay.current = undefined;
  }, [refreshVersion, view.page, tab, profile, version]);
  /** 结构回执只使旧快照失效；脏页、未决写入和其它弹窗不被后台刷新覆盖。 */
  useEffect(() => {
    if (structureVersion.current === refreshVersion) return; structureVersion.current = refreshVersion;
    controller.observe(); editorRef.current?.observe();
    const editor = editorRef.current, workspace = useWorkspace.getState();
    if (editor?.dirty || editor?.busy || editor?.view.unknown || inputRef.current || previewRef.current || importRef.current || fullExportRef.current || exportData || workspace.dirtyTabs[tab.id] || workspace.activeJobs[tab.id] || automaticReads.current.blocked || !refreshAutomatically) { setValidation(sqliteIndexesZh.tableStale); return; }
    if (active) { const offset = page?.offset ?? 0; dropEditor(); void controller.load(applied.current, offset); }
  }, [refreshVersion]);
  useLayoutEffect(() => { controller.observe(); editorRef.current?.observe(); fullExportRef.current?.intent.observe([view.page, applied.current, tab, profile, version, active]); importRef.current?.source.observe([view.page, applied.current, tab, profile, version, active]); });
  useEffect(() => { const stop = useWorkspace.subscribe(() => { fullExportRef.current?.intent.current(); importRef.current?.source.current(); }); return () => { stop(); fullExportRef.current?.intent.invalidate(); importRef.current?.source.invalidate(); }; }, []);
  /** 页面编辑能力只从后端签发的准确快照创建；同步订阅守住真实来源 ABA。 */
  useEffect(() => {
    const received = view.page;
    if (!received || received.edit?.kind !== 'editable' || editorRef.current?.page === received || editorRef.current?.dirty) return;
    if (!controller.pageCurrent(received) || profile?.dialect !== 'sqlite' || profile.sqlite.readOnly) { controller.releaseUnadopted(received); return; }
    dropEditor();
    const captured = { tab, profile, version, schemaRevision: refreshVersion };
    try {
      const editor = new SqliteTableEditor(received, {
        current: () => { const now = useWorkspace.getState(); return now.settings.tabs.find(item => item.id === captured.tab.id) === captured.tab && now.connections.find(item => item.id === captured.tab.connectionId) === captured.profile && captured.profile?.dialect === 'sqlite' && !captured.profile.sqlite.readOnly && (now.connectionVersions[captured.tab.connectionId] ?? 0) === captured.version && latest.current.refreshVersion === captured.schemaRevision; },
        active: () => latest.current.active && useWorkspace.getState().settings.activeTabId === captured.tab.id,
        available: () => !useWorkspace.getState().activeJobs[captured.tab.id], acquire: () => acquireWorkspaceBusy(captured.tab.id), id: uid, now: Date.now,
        changed: setEditView, dirty: dirty => { const now = useWorkspace.getState(); if ((importRef.current?.dirty || layoutDirtyRef.current) && !dirty) return; if (now.settings.tabs.find(item => item.id === captured.tab.id) === captured.tab && !!now.dirtyTabs[captured.tab.id] !== dirty) now.setDirty(captured.tab.id, dirty); },
        preview: input => invoke('sqlite.tableEdit.preview', input), apply: input => invoke('sqlite.tableEdit.apply', input), release: input => invoke('sqlite.tableEdit.release', input), cancel: taskId => invoke('query.cancel', { taskId }),
        committed: () => { useWorkspace.getState().notify(editor.view.message); if (editorRef.current === editor) { const offset = editor.page.offset; dropEditor(); if (latest.current.active) void controller.load(applied.current, offset); } },
      });
      // 构造阶段仅复制本地值；准确页交接成功后才把编辑器登记为快照拥有者。
      if (!controller.adopt(received)) { controller.releaseUnadopted(received); return; }
      editorRef.current = editor; setEditView(editor.view); setSelectedRow(editor.view.rows[0]?.id);
    } catch (reason) { setValidation(errorMessage(reason)); controller.releaseUnadopted(received); }
  }, [view.page]);
  useEffect(() => { const observe = () => { editorRef.current?.observe(); const input = inputRef.current; if (input?.duplicate) inputCurrent(input); }; const unsubscribe = useWorkspace.subscribe(observe); const timer = setInterval(observe, 5000); return () => { unsubscribe(); clearInterval(timer); filteredSelectRef.current?.intent.invalidate(); filteredSelectRef.current = null; if (fillRef.current) { fillRef.current.valid = false; fillRef.current = null; } editorRef.current?.dispose(); }; }, []);
  // 导入草稿/原租约存活时保留准确原页；即使controller撤销来源，也不以新页覆盖草稿背景。
  const retained = structureDisplay.current, stalePage = retained?.tab === tab && retained.profile === profile && retained.version === version ? retained.page : undefined;
  const page = importRef.current && (importRef.current.dirty || importRef.current.acquiring || importRef.current.lease) ? importRef.current.page : editView && (editView.dirty || !view.page || editView.page === view.page) ? editView.page : view.page ?? stalePage;
  // 只读侧栏绑定原页的全部字段，不以网格列布局或同名对象代替原快照。
  const detailPage = page && active && !externalBusy && !editView && page.edit?.kind !== 'editable' && controller.pageCurrent(page) ? page : undefined;
  const detailBinding = rowDetails.bind(detailPage?.result, [detailPage, detailPage?.storageTypes]);
  const visibleRowDetail = rowDetail && rowDetails.valid(rowDetail) ? rowDetail : null;
  useEffect(() => {
    if (detailSelectionRef.current?.binding !== detailBinding) detailSelectionRef.current = null;
    setDetailSelection(current => current?.binding === detailBinding ? current : null);
    setRowDetail(current => current?.binding === detailBinding ? current : null);
  }, [detailBinding]);
  const names = (page?.columns ?? view.columns).map(column => column.name), invalidTarget = profile?.dialect !== 'sqlite' || tab.database !== 'main' || !tab.table;
  const presetScope = useMemo(() => ({ id: uid(), tab, profile, version, refreshVersion, page }), [tab, profile, version, refreshVersion, page]);
  const layoutScope = useMemo(() => ({ tab, profile, version }), [tab, profile, version]), layoutNamesKey = JSON.stringify(names);
  layoutScopeRef.current = { key: layoutScope, target: { connectionId: tab.connectionId, database: 'main', table: tab.table ?? '' }, names, current: () => { const state = useWorkspace.getState(); return !!page && (editorRef.current?.page === page ? editorRef.current.view.valid : controller.pageCurrent(page)) && profile?.dialect === 'sqlite' && latest.current.active && state.settings.activeTabId === tab.id && state.settings.tabs.find(item => item.id === tab.id) === tab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version; } };
  useEffect(() => { layout.activate(); return () => layout.dispose(); }, [layout]);
  useEffect(() => { layout.sync(); });
  useEffect(() => { setLayoutDialog(undefined); }, [layoutScope]);
  const projection = useMemo(() => sqliteLayoutProjection(names, layoutView.preferences), [layoutNamesKey, layoutView.preferences]);
  const displayColumns = useMemo(() => page ? projection.map(column => page.result.columns[column.index]) : [], [page, projection]);
  const displayWidths = useMemo(() => new Map(projection.flatMap(column => column.width === undefined || !page ? [] : [[page.result.columns[column.index].key, column.width] as const])), [projection, page]);
  const displayFrozen = useMemo(() => page ? projection.filter(column => column.frozen).map(column => page.result.columns[column.index].key) : [], [projection, page]);
  /** 显示可用状态只核当前来源；渲染阶段不能用尚未提交的事件票据禁用所有控件。 */
  function layoutSourceCurrent(): boolean { return (!layoutDialog || layoutDialog.scope === layoutScope) && layoutScopeRef.current?.key === layoutScope && !!layoutScopeRef.current.current() && !layoutView.pending && !view.busy && !externalBusy; }
  /** 点击和旧回调另核已提交代次，不能把显示可用状态当成事件授权。 */
  function layoutUiCurrent(): boolean { return editRender.current === editRenderTicket && layoutSourceCurrent(); }
  /** 改变显示不会重建编辑快照、读取数据或触发数据库提交。 */
  function changeLayout(preferences: TablePreferences): void { if (!layoutUiCurrent()) return; try { layout.set(preferences); } catch (reason) { setValidation(errorMessage(reason)); } }
  function resizeLayout(key: string, width: number): void { if (!layoutUiCurrent() || document.querySelector('[role="dialog"], [role="alertdialog"]') || !page) return; const index = page.result.columns.findIndex(column => column.key === key); if (index >= 0) changeLayout(changeTablePreference(layout.view.preferences, page.columns[index].name, { width: Math.max(64, Math.min(2000, Math.round(width))) })); }
  /** 关闭只处理列布局副本；记录草稿保持，明确保存后不恢复旧布局。 */
  function closeLayout(): void {
    if (editRender.current !== editRenderTicket || !layoutDialog || layoutDialog.scope !== layoutScope || layoutView.pending) return;
    if (!layoutScopeRef.current?.current()) { setLayoutDialog(undefined); return; }
    if (layout.view.dirty && layout.view.preferences !== layoutDialog.preferences) { if (!window.confirm(layoutText.discard) || !layoutUiCurrent()) return; layout.restore(layoutDialog.preferences, layoutDialog.dirty); }
    setLayoutDialog(undefined);
  }
  /** 只有明确放弃或无草稿时可替换当前页，运行中写操作从不被读取入口打断。 */
  function dropEditor(): void { cellFilterRef.current = undefined; setCellFilterOwner(undefined); if (filteredSelectRef.current) closeFilteredSelect(filteredSelectRef.current); if (fillRef.current) closeFill(fillRef.current); checkedRef.current = undefined; setCheckedRows(undefined); if (findRef.current) closeFind(findRef.current); if (rangeRef.current) rangeRef.current.valid = false; rangeRef.current = null; rangeCellRef.current = undefined; setRangeOpen(null); setRangeCell(undefined); if (pasteRef.current) { pasteRef.current.valid = false; pasteRef.current = null; setPasteOpen(null); } editorRef.current?.dispose(); editorRef.current = null; inputRef.current = null; previewRef.current = null; setEditView(null); setCellInput(null); setPreviewOpen(null); const now = useWorkspace.getState(); if (now.settings.tabs.find(item => item.id === tab.id) === tab && now.dirtyTabs[tab.id]) now.setDirty(tab.id, layoutDirtyRef.current); }
  function prepareRead(): boolean { const editor = editorRef.current; if (editor?.busy) return false; if (editor?.dirty && !window.confirm(editText.confirmDiscard)) return false; dropEditor(); automaticReads.current.blocked = false; return true; }
  /** 操作读取同步目标和占用，旧按钮与隐藏标签不得开始新读取。 */
  function available(): boolean { const workspace = useWorkspace.getState(); return active && !filteredSelectRef.current && !fillRef.current && !invalidTarget && workspace.settings.tabs.find(item => item.id === tab.id) === tab && workspace.settings.activeTabId === tab.id && workspace.connections.find(item => item.id === tab.connectionId) === profile && (workspace.connectionVersions[tab.connectionId] ?? 0) === version && (!workspace.activeJobs[tab.id] || view.busy) && !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 原页租约与连接身份决定动作是否过期，普通重绘不撤销同一页的菜单。 */
  function rowDetailsCurrent(binding: QueryRowDetailsBinding | undefined): binding is QueryRowDetailsBinding {
    return !!detailPage && controller.pageCurrent(detailPage) && available() && rowDetails.current(binding);
  }
  /** 只接收虚拟网格传回的当前页位置，行号不沿用到下一页。 */
  function selectDetailRow(index: number | null): void {
    if (!rowDetailsCurrent(detailBinding)) return;
    const current = detailSelectionRef.current;
    if (current?.binding === detailBinding && current.index === index) return;
    const next = index === null ? null : { binding: detailBinding, index };
    detailSelectionRef.current = next;
    setDetailSelection(next);
  }
  /** 侧栏的打开与翻行都只处理已加载值。 */
  function showRowDetail(view?: QueryRowDetailsView, index = detailSelection?.index): void {
    const binding = view?.binding ?? detailSelection?.binding;
    if (index === undefined || !rowDetailsCurrent(binding) || (view ? !rowDetails.valid(view) : detailSelectionRef.current !== detailSelection)) return;
    try { setRowDetail(view ? rowDetails.move(view, index) : rowDetails.open(binding, index)); }
    catch { if (!view || visibleRowDetail === view) setValidation(detailText.invalid); }
  }
  /** 关系图绑定活动物理表原页，独立只读操作不改变现有查询事务、树选择或编辑草稿。 */
  function openDiagram(): void {
    if (!page || page.target.kind !== 'table' || !available() || view.busy || editorRef.current?.dirty || editorRef.current?.busy || editorRef.current?.view.unknown || !controller.pageCurrent(page)) return;
    const originalKey = page.schemaKey;
    const owner: DiagramOwner = { id: uid(), page, valid: true, acquiring: false,
      current: () => {
        if (!owner.valid) return false; const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        const okay = diagramRef.current === owner && latest.current.active && latest.current.tab === tab && latest.current.refreshVersion === refreshVersion && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && page.schemaKey === originalKey && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown && (!now.activeJobs[tab.id] || owner.acquiring || owner.lease?.owns() === true) && (dialogs.length === 0 || dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === diagramText.title);
        if (!okay) owner.valid = false; return okay;
      },
      activity: delta => {
        if (delta === 1) { if (owner.lease || !owner.current()) throw Error(diagramText.stale); owner.acquiring = true; try { owner.lease = acquireWorkspaceBusy(tab.id); } finally { owner.acquiring = false; } }
        else { const lease = owner.lease; owner.lease = undefined; lease?.release(); }
      },
    };
    diagramRef.current = owner; setDiagramOpen(owner);
  }
  /** 候选源只取准确原页与已应用条件；与表单草稿分别绑定，不借树选择改换目标。 */
  function openValues(): void {
    if (editRender.current !== editRenderTicket || !page || !available() || view.busy || latest.current.refreshVersion !== refreshVersion) return;
    const original = applied.current, formKey = JSON.stringify(valuesForm.current), queryKey = JSON.stringify(original), editor = editorRef.current;
    const owner: ValuesOwner = { id: uid(), base: { connectionId: tab.connectionId, database: 'main', table: page.target.table, schemaKey: page.schemaKey, mode: original.mode, filters: structuredClone(original.filters) }, columns: page.columns.map(column => column.name), mode, valid: true,
      current: () => {
        if (!owner.valid) return false; if (valuesRef.current !== owner) { owner.valid = false; return false; } const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        const okay = latest.current.active && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && latest.current.refreshVersion === refreshVersion && applied.current === original && JSON.stringify(original) === queryKey && JSON.stringify(valuesForm.current) === formKey && (editor ? editorRef.current === editor && editor.page === page && editor.view.valid : controller.pageCurrent(page)) && (dialogs.length === 0 || dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === valuesText.title);
        if (!okay) owner.valid = false; return okay;
      },
      apply: filter => {
        // 原读取会改变父级busy渲染；绑定存活owner与当前已提交父渲染，不复用打开时的渲染票据。
        if (!owner.current() || editRender.current === undefined) return false;
        const form = valuesForm.current, next = [...form.filters, { id: uid(), column: filter.column, operator: filter.operator, kind: 'text' as const, value: '', selectedValues: filter.selectedValues }];
        sqliteTableDraft({ connectionId: tab.connectionId, database: 'main', table: page.target.table }, form.limit, form.mode, next, form.sort);
        if (!owner.current()) return false; setFilters(next); setConditions(true); return true;
      },
    }; valuesRef.current = owner; setValuesOpen(owner);
  }
  /** 概况沿冻结的已应用条件读取，保留当前页和编辑草稿；新目录或表单变化永久撤销旧窗口。 */
  function openStatistics(): void {
    if (editRender.current !== editRenderTicket || !page || !available() || view.busy || latest.current.refreshVersion !== refreshVersion) return;
    const original = applied.current, formKey = JSON.stringify(valuesForm.current), queryKey = JSON.stringify(original), editor = editorRef.current;
    const owner: StatisticsOwner = { id: uid(), base: { connectionId: tab.connectionId, database: 'main', table: page.target.table, schemaKey: page.schemaKey, mode: original.mode, filters: structuredClone(original.filters) }, columns: page.columns.map(column => column.name), valid: true,
      current: () => {
        if (!owner.valid) return false; if (statisticsRef.current !== owner) { owner.valid = false; return false; } const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        const okay = latest.current.active && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && latest.current.refreshVersion === refreshVersion && applied.current === original && JSON.stringify(original) === queryKey && JSON.stringify(valuesForm.current) === formKey && (editor ? editorRef.current === editor && editor.page === page && editor.view.valid : controller.pageCurrent(page)) && (dialogs.length === 0 || dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === statisticsText.title);
        if (!okay) owner.valid = false; return okay;
      },
    }; statisticsRef.current = owner; setStatisticsOpen(owner);
  }
  /** 表单只在明确应用时严格校验并读取，类型或顺序编辑本身不发送请求。 */
  function apply() {
    if (!available()) return;
    try { const next = sqliteTableDraft({ connectionId: tab.connectionId, database: tab.database, table: tab.table }, limit, mode, filters, sort); if (!prepareRead()) return; applied.current = next; setValidation(''); void controller.load(next, 0); }
    catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 翻页和刷新沿原已应用配置，不把尚未应用的条件带入请求。 */
  function read(offset: number) { if (available() && prepareRead()) { setValidation(''); void controller.load(applied.current, offset); } }
  /** 列头仅属于准确展示页；模态、导入导出、输入草稿和结构失效均不提供重读资格。 */
  function headerSortCurrent(): boolean {
    if (editRender.current !== editRenderTicket || !page || !available() || view.busy || latest.current.refreshVersion !== refreshVersion || inputRef.current || previewRef.current || pasteRef.current || rangeRef.current || importRef.current || fullExportRef.current || exportData || findRef.current?.preview) return false;
    const editor = editorRef.current;
    return editor ? editor === renderedEditor && editor.page === page && editor.view.rows === editRows && editor.canEdit() : !renderedEditor && controller.pageCurrent(page);
  }
  /** 只替换已应用查询的排序；确认返回后再核原页、原草稿和同步墓碑，不能丢弃后继来源。 */
  function sortFromHeader(raw: unknown): void {
    if (!headerSortCurrent() || !page) return;
    const original = applied.current, editor = editorRef.current, rows = editor?.view.rows;
    let valid = true;
    const current = () => valid && headerSortCurrent() && applied.current === original && editorRef.current === editor && (!editor || editor.view.rows === rows);
    let stop = () => {};
    try {
      const nextSort = sqliteHeaderSortFromGrid(raw, page);
      if (JSON.stringify(nextSort) === JSON.stringify(original.sort)) return;
      const next: SqliteTableQuery = { ...original, sort: nextSort };
      // 系统确认期间也观察来源ABA；回到同名标签不能复活旧排序回调。
      stop = useWorkspace.subscribe(() => { if (!current()) valid = false; });
      if (!current() || editor?.dirty && !window.confirm(editText.confirmDiscard) || !current()) return;
      stop(); stop = () => {};
      dropEditor(); applied.current = next; setSort(nextSort.map(rule => ({ id: uid(), ...rule }))); setValidation('');
      void controller.load(next, 0);
    } catch (reason) { if (current()) setValidation(errorMessage(reason)); }
    finally { stop(); }
  }
  /** 导出只冻结当前页原值；不读取全表，不生成 MySQL INSERT SQL。 */
  function exportPage() { if (!page || !available() || !controller.pageCurrent(page)) return; try { setExportData(resultExportData(structuredClone(page.result))); } catch (reason) { setValidation(errorMessage(reason)); } }
  /** 已载入的只读页或原编辑快照都可生成查询；未提交数据值不进入编译。 */
  function filteredSelectReady(): boolean {
    if (!page || view.busy || !available() || inputRef.current || previewRef.current || pasteRef.current || rangeRef.current || importRef.current || fullExportRef.current || exportData || findRef.current?.preview) return false;
    const editor = editorRef.current;
    return editor ? editor === renderedEditor && editor.page === page && editor.view.rows === editRows && editor.canEdit() : !renderedEditor && controller.pageCurrent(page);
  }
  /** 仅冻结已应用条件；同一编译意图不读取页样本、筛选表单草稿或其它树选择。 */
  function openFilteredSelect(): void {
    if (editRender.current !== editRenderTicket || !filteredSelectReady() || filteredSelectRef.current || !page) return;
    try {
      const query = applied.current, editor = editorRef.current;
      let owner: FilteredSelectOwner;
      const intent = new SqliteFilteredSelectIntent(page, query, () => !!owner && filteredSelectCurrent(owner));
      owner = { id: uid(), intent, page, query, editor, ...(editor ? { rows: editor.view.rows } : {}), attached: false };
      if (!filteredSelectReady() || applied.current !== query || editorRef.current !== editor) { intent.invalidate(); return; }
      if (findRef.current) closeFind(findRef.current);
      filteredSelectRef.current = owner; setFilteredSelectOpen(owner);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 唯一本票据模态与原目标双核；切换目标或占用后旧意图永久失效，不借同名页复活。 */
  function filteredSelectCurrent(owner: FilteredSelectOwner): boolean {
    if (filteredSelectRef.current !== owner) return false;
    try {
      const workspace = useWorkspace.getState(), dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      const markers = dialogs.length === 1 ? dialogs[0].querySelectorAll('[data-sqlite-filtered-select-owner]') : [];
      const own = dialogs.length === 0 ? !owner.attached : dialogs.length === 1 && markers.length === 1 && markers[0].getAttribute('data-sqlite-filtered-select-owner') === owner.id;
      if (!own || !latest.current.active || latest.current.tab !== tab || workspace.settings.activeTabId !== tab.id || workspace.settings.tabs.find(item => item.id === tab.id) !== tab || workspace.connections.find(item => item.id === tab.connectionId) !== profile || (workspace.connectionVersions[tab.connectionId] ?? 0) !== version || latest.current.refreshVersion !== refreshVersion || workspace.activeJobs[tab.id] || applied.current !== owner.query || editorRef.current !== owner.editor || inputRef.current || previewRef.current || pasteRef.current || rangeRef.current || fillRef.current || importRef.current || fullExportRef.current || exportData || findRef.current?.preview) return false;
      if (owner.editor ? owner.editor.page !== owner.page || owner.editor.view.rows !== owner.rows || !owner.editor.canEdit() : !controller.pageCurrent(owner.page)) return false;
      if (dialogs.length) owner.attached = true;
      return true;
    } catch { return false; }
  }
  /** 只消费本意图最新预览；成功后直接开独立草稿，不执行SQL、不接管父页事务或草稿。 */
  function openFilteredSelectQuery(owner: FilteredSelectOwner, plan: SqliteFilteredSelectPlan): boolean {
    if (!owner.intent.current() || !owner.attached || !filteredSelectCurrent(owner)) return false;
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(filteredSelectText.tabs);
    if (!owner.intent.consume(plan)) return false;
    const target = owner.intent.target;
    // SQLite名称可长于通用标签标题；只缩短显示名，不改SQL中的完整准确标识符。
    let shortName = target.table.slice(0, 180); if (/[\uD800-\uDBFF]$/.test(shortName)) shortName = shortName.slice(0, -1);
    if (shortName.length !== target.table.length) shortName += '…';
    closeFilteredSelect(owner);
    useWorkspace.getState().openTab({ kind: 'query', connectionId: target.connectionId, database: target.database, databaseContext: { state: 'known', database: target.database }, title: filteredSelectText.queryTitle(shortName), sql: plan.sql });
    return true;
  }
  /** 失效或取消仅撤销本模态；不清父数据修改、选择或后继输入，也不释放任何数据库任务。 */
  function closeFilteredSelect(owner: FilteredSelectOwner): void {
    if (filteredSelectRef.current !== owner) return;
    filteredSelectRef.current = null; owner.intent.invalidate(); setFilteredSelectOpen(null);
  }
  /** 全量导出只捕获准确当前页的元数据与已应用条件，不取尚未应用的表单草稿。 */
  function openAllExport() {
    if (!page || !available() || !controller.pageCurrent(page) || fullExportRef.current) return;
    try {
      const query = applied.current; let owner!: FullExportOwner;
      const intent = new SqliteTableExportIntent(page, query, [page, query, tab, profile, version, active], () => {
        const now = useWorkspace.getState();
        return latest.current.active && latest.current.tab === tab && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && applied.current === query && controller.pageCurrent(page) && (!now.activeJobs[tab.id] || owner.acquiring || owner.lease?.owns() === true);
      });
      owner = { intent, acquiring: false }; if (!intent.current()) throw Error(exportText.stale);
      fullExportRef.current = owner; setFullExport(owner); setValidation('');
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** chooser及流式请求分别取得准确作业租约；自身同步占用不使来源自失效，旧收尾不清他人作业。 */
  function fullExportActivity(owner: FullExportOwner, delta: 1 | -1) {
    if (delta === 1) {
      if (fullExportRef.current !== owner || owner.lease || !owner.intent.current()) throw Error(exportText.stale);
      owner.acquiring = true;
      try { owner.lease = acquireWorkspaceBusy(tab.id); } finally { owner.acquiring = false; }
    } else { const lease = owner.lease; owner.lease = undefined; lease?.release(); }
  }
  /** 对话框已等待原操作及取消确认收尾，关闭只撤销本次意图，不提前释放运行中的资源。 */
  function closeAllExport(owner: FullExportOwner) { owner.intent.invalidate(); if (fullExportRef.current === owner) { fullExportRef.current = null; setFullExport(null); } }
  /** 导入只绑定准确原表页；表格草稿、输入框和未知提交必须先沿原流程处理。 */
  function openImport(): void {
    const now = useWorkspace.getState(), editor = editorRef.current;
    if (!page || page.target.kind !== 'table' || !available() || !controller.pageCurrent(page) || importRef.current || fullExportRef.current || exportData || view.busy || now.activeJobs[tab.id]) return;
    if (editor?.dirty || editor?.busy || editor?.view.unknown || inputRef.current || previewRef.current || now.dirtyTabs[tab.id]) { setValidation(importText.busyDraft); return; }
    try {
      const query = applied.current; let owner!: ImportOwner;
      const source = new SqliteTableImportSource(page, profile?.dialect === 'sqlite' && profile.sqlite.readOnly, [page, query, tab, profile, version, active], () => {
        const current = useWorkspace.getState();
        return latest.current.active && latest.current.tab === tab && current.settings.activeTabId === tab.id && current.settings.tabs.find(item => item.id === tab.id) === tab && current.connections.find(item => item.id === tab.connectionId) === profile && (current.connectionVersions[tab.connectionId] ?? 0) === version && applied.current === query && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown && !inputRef.current && !previewRef.current && (!current.dirtyTabs[tab.id] || owner.dirty) && (!current.activeJobs[tab.id] || owner.acquiring || owner.lease?.owns() === true);
      });
      owner = { source, page, acquiring: false, dirty: false, refreshed: false }; if (!source.current()) throw Error(importText.stale);
      importRef.current = owner; setTableImport(owner); setValidation('');
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 自有dirty与busy在同步store通知前登记；旧收尾不能清除后继草稿或他人的租约。 */
  function importDirty(owner: ImportOwner, dirty: boolean): void {
    if (importRef.current !== owner) return; owner.dirty = dirty;
    const now = useWorkspace.getState(); if (now.settings.tabs.find(item => item.id === tab.id) === tab && !editorRef.current?.dirty && !!now.dirtyTabs[tab.id] !== dirty) now.setDirty(tab.id, dirty || layoutDirtyRef.current);
  }
  function importActivity(owner: ImportOwner, delta: 1 | -1): void {
    if (delta === 1) { if (importRef.current !== owner || owner.lease || !owner.source.current()) throw Error(importText.stale); owner.acquiring = true; try { owner.lease = acquireWorkspaceBusy(tab.id); } finally { owner.acquiring = false; } }
    else { const lease = owner.lease; owner.lease = undefined; lease?.release(); }
  }
  /** 只按确认COMMIT刷新原表一次，刷新失败不改写导入成功事实。 */
  function imported(owner: ImportOwner, output: SqliteTableEditOutcome, changed: boolean): void {
    if (output.outcome !== 'committed' || !output.fact.commitAcknowledged) return;
    const current = importRef.current === owner && !changed && owner.source.current(); useWorkspace.getState().notify(current ? importText.committed(output.fact.appliedRows) : importText.committedStale, !current);
    if (current && !owner.refreshed) { owner.refreshed = true; importDirty(owner, false); dropEditor(); void controller.load(applied.current, 0); }
  }
  function closeImport(owner: ImportOwner): void { owner.source.invalidate(); if (importRef.current !== owner) return; importDirty(owner, false); importRef.current = null; setTableImport(null); }
  /** 选择来源按原页、连接版本和完整行身份持有，不受左树后续选择影响。 */
  function selectFilterSource(index: number | undefined, column: number, row: unknown): void {
    if (editRender.current !== undefined && editRender.current !== editRenderTicket || !page || !available() || view.busy || externalBusy || latest.current.refreshVersion !== refreshVersion) return;
    const previous = cellFilterRef.current;
    if (previous?.page === page && previous.row === row && previous.column === column && previous.source.current()) return;
    cellFilterRef.current = undefined; setCellFilterOwner(undefined); setCellFilterReason('');
    if (index === undefined || column < 0) return;
    const editor = renderedEditor, rows = editRows;
    try {
      const source = captureSqliteCellFilter(page, index, column, () => {
        const now = useWorkspace.getState();
        return latest.current.active && latest.current.refreshVersion === refreshVersion && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && !now.activeJobs[tab.id] && !document.querySelector('[role="dialog"], [role="alertdialog"]') && editorRef.current === editor && (editor ? editor.page === page && editor.view.rows === rows && editor.canEdit() : controller.pageCurrent(page));
      }, editor ? { rows, row: row as import('../sqliteTableEditor').SqliteDraftRow } : undefined);
      const owner = { id: uid(), page, row, column, source }; cellFilterRef.current = owner; setCellFilterOwner(owner);
    } catch (reason) { setCellFilterReason(errorMessage(reason)); }
  }
  /** 只读网格提供准确原行与列对象，不从选中行号或名称推测列。 */
  function selectReadFilterCell(cell: QueryResultCopyCell | undefined): void {
    if (cell && page?.result.rows[cell.index] === cell.row && cell.column) selectFilterSource(cell.index, page.result.columns.indexOf(cell.column), cell.row);
    else selectFilterSource(undefined, -1, undefined);
  }
  /** 可编辑网格允许读取未修改的生成字段，粘贴起点仍沿原可写限制。 */
  function selectEditFilterCell(anchor: SqlitePasteAnchor | undefined): void {
    selectFilterSource(anchor?.row.index, anchor?.column ?? -1, anchor?.row);
  }
  /** 从原格生成一条可审阅的typed草稿，整组校验成功后一次发布，不读取或写入数据库。 */
  function appendCellFilter(exclude: boolean): void {
    const owner = cellFilterRef.current;
    if (editRender.current !== editRenderTicket || !owner || owner !== cellFilterOwner || owner.page !== page || !owner.source.current() || !available() || view.busy || externalBusy) return;
    try {
      const next = [...filters, owner.source.draft(exclude, uid())];
      sqliteTableDraft({ connectionId: tab.connectionId, database: tab.database, table: tab.table }, limit, mode, next, sort);
      if (cellFilterRef.current !== owner || !owner.source.current()) return;
      setFilters(next); setConditions(true); setValidation(''); cellFilterRef.current = undefined; setCellFilterOwner(undefined); useWorkspace.getState().notify(cellFilterText.added);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 方案只属于准确活动表页，不依赖左树选择，也不要求重新建立数据库会话。 */
  function presetCurrent(): boolean {
    if (!page || !available() || view.busy || externalBusy || latest.current.refreshVersion !== refreshVersion) return false;
    const editor = editorRef.current;
    return editor ? editor === renderedEditor && editor.page === page && editor.canEdit() : controller.pageCurrent(page);
  }
  /** 保存只捕获当前条件表单，不读取行数据，不改变applied或未提交修改。 */
  function presetConfiguration(): SqliteTablePresetQuery {
    if (!presetCurrent()) throw Error(presetText.changed);
    return sqliteTableDraft({ connectionId: tab.connectionId, database: tab.database, table: tab.table }, limit, mode, filters, sort);
  }
  /** 载入先完整核字段，再一次填写本地表单；原页、applied、编辑器及数据草稿保持。 */
  function loadPreset(query: SqliteTablePresetQuery): boolean {
    if (editRender.current !== editRenderTicket || !presetCurrent()) return false;
    const next = sqlitePresetDraft(query, names, uid);
    if (!presetCurrent()) return false;
    setLimit(next.query.limit); setMode(next.query.mode); setFilters(next.filters); setSort(next.sort); setValidation(''); setConditions(true); return true;
  }
  /** 顺序即服务端 ORDER BY 优先级；只移动草稿，应用时才发送。 */
  function moveSort(index: number, offset: -1 | 1) { setSort(values => { const next = [...values], to = index + offset; if (to < 0 || to >= next.length) return values; [next[index], next[to]] = [next[to], next[index]]; return next; }); }
  useUiCommandScope('tab:' + tab.id, { 'sql-goto-line': { enabled: active && !!page?.result.rows.length && !view.busy && !externalBusy && !cellInput, run: () => { if (latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id) openFocusedGridRowJump(); } }, find: { enabled: active && !!editView && !view.busy && !externalBusy && !findPreview, run: () => openFind('find') }, replace: { enabled: active && !!editView && !view.busy && !externalBusy && !findPreview, run: () => openFind('replace') }, stop: { enabled: active && view.busy, run: () => { void controller.stop(); } }, export: { enabled: active && !!page && !view.busy && !externalBusy, run: exportPage }, import: { enabled: active && page?.target.kind === 'table' && !invalidTarget && !view.busy && !externalBusy && !fullExport && !exportData && !tableImport && !editView?.dirty && !editView?.busy && !editView?.unknown && !cellInput && !previewOpen, run: openImport } }, { active, contextKey: JSON.stringify([tab.id, version, page?.offset, page?.limit, page?.schemaKey, view.busy, externalBusy, !!tableImport, !!fullExport, !!exportData, !!editView?.dirty, !!editView?.unknown, !!cellInput, !!previewOpen, findOpen?.id, findPreview]) });
  const renderedEditor = editorRef.current?.page === editView?.page ? editorRef.current : null, editRows = editView?.rows ?? [];
  /** 每个编辑入口绑定准确渲染、编辑器、页和草稿数组；同名 row id 不提供跨页授权。 */
  function editActionCurrent(writable = true): boolean {
    return editRender.current === editRenderTicket && !!renderedEditor && editorRef.current === renderedEditor && renderedEditor.page === page && renderedEditor.view.rows === editRows && latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id && (!writable || renderedEditor.canEdit());
  }
  /** 选格只认可本次 rows 中的原对象，旧 grid 事件不能选中新页同 id 记录。 */
  function selectEditRow(row: SqliteDraftRow): void { if (editActionCurrent(false) && editRows.includes(row)) setSelectedRow(row.id); }
  function openInput(editor: SqliteTableEditor, row: SqliteDraftRow, column?: number): void {
    const ticket: EditInputTicket = { id: uid(), editor, page: editor.page, rows: editor.view.rows, row, column };
    inputRef.current = ticket; editor.inputOpen(true); setCellInput(ticket);
  }
  /** 单元格与整行输入仅写入原草稿，对话框未保存文本也登记 dirty 防关闭丢失。 */
  function editRow(row: SqliteDraftRow, column?: number): void { if (!editActionCurrent() || !available() || !editRows.includes(row) || row.deleted || inputRef.current || previewRef.current) return; openInput(renderedEditor!, row, column); }
  function inputCurrent(ticket: EditInputTicket): boolean {
    const original = inputRef.current === ticket && editorRef.current === ticket.editor && ticket.editor.page === ticket.page && ticket.editor.view.rows === ticket.rows && ticket.editor.canEdit();
    if (!ticket.duplicate) return original && ticket.rows.includes(ticket.row);
    if (!ticket.duplicate.valid) return false;
    try {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      if (original && sqliteDuplicateSourceCurrent(ticket.duplicate.source, ticket.page, ticket.rows) && ticket.row === ticket.duplicate.source.row && latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id && !useWorkspace.getState().activeJobs[tab.id] && (dialogs.length === 0 || dialogs.length === 1 && !!dialogs[0].querySelector('[data-sqlite-duplicate-input="' + ticket.id + '"]'))) return true;
    } catch { /* 无法核实原复制来源或唯一窗口时不授予新增资格。 */ }
    ticket.duplicate.valid = false; return false;
  }
  /** 复制只暂存一条新增；appendRows按原整批预算复核，失败不产生半条或消耗撤销步骤。 */
  function saveInput(ticket: EditInputTicket, values: (SqliteOriginalValue | undefined)[]): boolean {
    if (!inputCurrent(ticket)) return false;
    if (ticket.duplicate) {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      if (dialogs.length !== 1 || !dialogs[0].querySelector('[data-sqlite-duplicate-input="' + ticket.id + '"]')) return false;
      const ids = ticket.editor.appendRows([values]); if (ids[0]) setSelectedRow(ids[0]);
    } else ticket.editor.save(ticket.row.id, values);
    if (inputRef.current !== ticket || editorRef.current !== ticket.editor) return false;
    if (ticket.duplicate) ticket.duplicate.valid = false;
    inputRef.current = null; ticket.editor.inputOpen(false); setCellInput(null); return true;
  }
  /** 关闭只消费准确输入票据；旧 Modal 的关闭不能清除后继窗口或新编辑器 dirty。 */
  function closeInput(ticket: EditInputTicket): void {
    if (inputRef.current !== ticket) return;
    if (ticket.duplicate) { ticket.duplicate.valid = false; inputRef.current = null; if (editorRef.current === ticket.editor) ticket.editor.inputOpen(false); setCellInput(null); return; }
    if (editorRef.current !== ticket.editor || ticket.editor.page !== ticket.page || ticket.editor.view.rows !== ticket.rows) return;
    inputRef.current = null; ticket.editor.inputOpen(false); setCellInput(null);
  }
  /** 只在原快照的已有行中导航，本地新增或待删除行不会成为目标。 */
  function adjacentRecord(ticket: EditInputTicket, direction: -1 | 1): SqliteDraftRow | undefined {
    if (ticket.column !== undefined || ticket.duplicate || ticket.row.index === undefined || ticket.row.deleted) return;
    const index = ticket.rows.indexOf(ticket.row);
    if (index < 0) return;
    for (let i = index + direction; i >= 0 && i < ticket.rows.length; i += direction) {
      const row = ticket.rows[i];
      if (row.index !== undefined && !row.deleted) return row;
    }
  }
  /** 切换前核对唯一表单及原票据，暂存后用新票据交接给下一条。 */
  function moveRecordInput(ticket: EditInputTicket, direction: -1 | 1, values?: (SqliteOriginalValue | undefined)[]): boolean {
    const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
    const next = adjacentRecord(ticket, direction);
    if (!next || !inputCurrent(ticket) || dialogs.length !== 1 || !dialogs[0].querySelector('[data-sqlite-record-input="' + ticket.id + '"]')) return false;
    if (values) ticket.editor.save(ticket.row.id, values);
    if (inputRef.current !== ticket || editorRef.current !== ticket.editor || !ticket.editor.canEdit() || !ticket.editor.view.rows.includes(next)) return false;
    setSelectedRow(next.id);
    openInput(ticket.editor, next);
    return true;
  }
  /** 准确选中行的已保存typed值独立复制到虚拟输入；打开及取消不调用add或接触剪贴板。 */
  function duplicateRow(): void {
    if (!editActionCurrent() || !available() || inputRef.current || previewRef.current || pasteRef.current || rangeRef.current) return;
    const editor = renderedEditor!, row = editRows.find(row => row.id === selectedRow);
    if (!row || row.deleted) return;
    try {
      const id = uid(), source = prepareSqliteDuplicate(editor.page, editRows, row, id);
      if (!editActionCurrent() || !available() || editor.view.rows !== editRows || !sqliteDuplicateSourceCurrent(source, editor.page, editRows)) return;
      const ticket: EditInputTicket = { id, editor, page: editor.page, rows: editRows, row: source.row, duplicate: { source, valid: true } };
      inputRef.current = ticket; editor.inputOpen(true); setCellInput(ticket);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  function addRow(): void { if (!editActionCurrent() || !available() || inputRef.current || previewRef.current) return; const editor = renderedEditor!, id = editor.add(), row = editor.view.rows.find(row => row.id === id); if (row) { setSelectedRow(row.id); openInput(editor, row); } }
  /** 勾选只接纳当前Grid的原页原行对象；空选择同样带来源，旧effect不得清后来集合。 */
  function selectCheckedRows(capture: SqliteCheckedRows): void {
    try {
      if (!editActionCurrent() || capture.page !== page || capture.rows !== editRows || !capture.current() || capture.selected.some(row => !editRows.includes(row) || row.deleted) || new Set(capture.selected).size !== capture.selected.length || checkedRef.current?.capture === capture) return;
      const owner: CheckedRowsOwner = { id: uid(), editor: renderedEditor!, capture };
      checkedRef.current = owner; setCheckedRows(owner);
    } catch { /* 不能确认的勾选事件只丢弃，不借单行选中状态补齐批次。 */ }
  }
  /** 删除授权只属于准确已提交选择；模态、忙态、来源或勾选修订改变即拒绝。 */
  function checkedRowsCurrent(owner: CheckedRowsOwner): boolean {
    try {
      return checkedRef.current === owner && checkedRows === owner && owner.editor === renderedEditor && editorRef.current === owner.editor && editActionCurrent() && available() && !inputRef.current && !previewRef.current && !pasteRef.current && !rangeRef.current && !importRef.current && !fullExportRef.current && !exportData && !findRef.current?.preview && owner.capture.page === page && owner.capture.rows === editRows && owner.editor.view.rows === editRows && owner.capture.selected.length > 0 && owner.capture.current() && owner.capture.selected.every(row => editRows.includes(row) && !row.deleted);
    } catch { return false; }
  }
  /** 一次确认后整批暂存；系统确认期间同步观察workspace，回到原目标也不复活旧意图。 */
  function removeCheckedRows(): void {
    const owner = checkedRows; if (!owner || !checkedRowsCurrent(owner)) return;
    let valid = true, stop = () => {};
    const current = () => valid && checkedRowsCurrent(owner);
    try {
      const ids = owner.capture.selected.map(row => row.id);
      stop = useWorkspace.subscribe(() => { if (!current()) valid = false; });
      if (!current() || !window.confirm(editText.removeSelectedConfirm(ids.length)) || !current()) return;
      stop(); stop = () => {};
      owner.editor.removeRows(ids);
      if (checkedRef.current === owner) { checkedRef.current = undefined; setCheckedRows(undefined); }
      const remaining = owner.editor.view.rows;
      if (!remaining.some(row => row.id === selectedRow && !row.deleted)) setSelectedRow(remaining.find(row => !row.deleted)?.id);
    } catch (reason) { if (current()) setValidation(errorMessage(reason)); }
    finally { stop(); }
  }
  function removeRow(): void { const row = editRows.find(row => row.id === selectedRow); if (row && editActionCurrent() && available() && window.confirm(editText.confirmDelete) && editActionCurrent() && editRows.includes(row)) renderedEditor!.remove(row.id); }
  /** 打开时冻结准确勾选；自身模态禁用Grid后不借已经撤销的Grid捕获继续授权。 */
  function openFill(): void {
    const owner = checkedRows;
    if (!owner || fillRef.current || !checkedRowsCurrent(owner)) return;
    try {
      const source = prepareSqliteFill(owner.capture.page, owner.capture.rows, owner.capture.selected);
      if (!checkedRowsCurrent(owner) || !sqliteFillSourceCurrent(source, owner.editor.page, owner.editor.view.rows)) return;
      if (findRef.current) closeFind(findRef.current);
      const ticket: FillInputTicket = { id: uid(), editor: owner.editor, source, valid: true, attached: false };
      fillRef.current = ticket; ticket.editor.inputOpen(true); setFillOpen(ticket);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 只允许本票据唯一模态及原快照，失活／忙态／配置ABA留下永久墓碑。 */
  function fillCurrent(ticket: FillInputTicket): boolean {
    if (fillRef.current !== ticket || !ticket.valid) return false;
    try {
      const workspace = useWorkspace.getState(), dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      const markers = dialogs.length === 1 ? dialogs[0].querySelectorAll('[data-sqlite-fill-owner]') : [];
      const own = dialogs.length === 0 ? !ticket.attached : dialogs.length === 1 && markers.length === 1 && markers[0].getAttribute('data-sqlite-fill-owner') === ticket.id;
      if (own && editorRef.current === ticket.editor && ticket.editor.page === ticket.source.page && sqliteFillSourceCurrent(ticket.source, ticket.editor.page, ticket.editor.view.rows) && ticket.editor.canEdit() && latest.current.active && workspace.settings.activeTabId === tab.id && !workspace.activeJobs[tab.id] && !inputRef.current && !previewRef.current && !pasteRef.current && !rangeRef.current && !importRef.current && !fullExportRef.current && !exportData && !findRef.current?.preview) {
        if (dialogs.length) ticket.attached = true;
        return true;
      }
    } catch { /* 来源或唯一模态无法确认时拒绝暂存，不借相同ID接管后继对象。 */ }
    ticket.valid = false; return false;
  }
  /** 同步整批暂存仍由原editor验预算；输入成功不调用预览、提交或任何数据库接口。 */
  function stageFill(ticket: FillInputTicket, fields: readonly SqliteFillField[]): boolean {
    if (!fillCurrent(ticket) || !ticket.attached) return false;
    const changed = ticket.editor.fillRows(ticket.source.selected.map(row => row.id), fields);
    if (fillRef.current === ticket && editorRef.current === ticket.editor) {
      closeFill(ticket);
      if (checkedRef.current?.editor === ticket.editor) { checkedRef.current = undefined; setCheckedRows(undefined); }
      useWorkspace.getState().notify(fillText.changed(changed));
    }
    return true;
  }
  /** 失效输入仍可关闭；只撤自己的占用，不清后来窗口、原行或已暂存的修改。 */
  function closeFill(ticket: FillInputTicket): void {
    if (fillRef.current !== ticket) return;
    fillRef.current = null; ticket.valid = false; setFillOpen(null);
    if (editorRef.current === ticket.editor) ticket.editor.inputOpen(false);
  }
  function undoEdit(): void { if (editActionCurrent() && available()) renderedEditor!.undo(); }
  function redoEdit(): void { if (editActionCurrent() && available()) renderedEditor!.redo(); }
  function discardEdit(): void { if (!editActionCurrent(false) || renderedEditor!.busy || !available() || !window.confirm(editText.confirmDiscard) || !editActionCurrent(false)) return; renderedEditor!.discard(); read(page?.offset ?? 0); }
  function previewChanges(): void { if (!editActionCurrent() || !available() || previewRef.current || inputRef.current) return; const editor = renderedEditor!, ticket: EditPreviewTicket = { id: uid(), editor, page: editor.page, rows: editRows }; previewRef.current = ticket; setPreviewOpen(ticket); void editor.preview(); }
  /** 预览事件同时绑定准确回执与 task；旧 pending 预览的 stop 不得取消后继 apply。 */
  function previewCurrent(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined, taskId: string | undefined): boolean { const current = ticket.editor.view; return previewRef.current === ticket && editorRef.current === ticket.editor && ticket.editor.page === ticket.page && current.rows === ticket.rows && current.preview === expected && current.taskId === taskId && latest.current.active && useWorkspace.getState().settings.activeTabId === tab.id; }
  function applyPreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined): void { if (!expected || !previewCurrent(ticket, expected, undefined) || !ticket.editor.canEdit()) return; void ticket.editor.apply(); }
  function closePreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined): void { if (!previewCurrent(ticket, expected, undefined) || ticket.editor.busy) return; previewRef.current = null; ticket.editor.closePreview(); setPreviewOpen(null); }
  function stopPreview(ticket: EditPreviewTicket, expected: SqliteTableEditPreview | undefined, taskId: string | undefined): void { if (taskId && previewCurrent(ticket, expected, taskId)) ticket.editor.stop(); }
  /** 粘贴源仅捕获准确编辑器、原页和整批rows；活动、配置或结构一旦变化即留下失效标记。 */
  function pasteCurrent(ticket: PasteInputTicket): boolean {
    if (pasteRef.current !== ticket || !ticket.valid) return false;
    const workspace = useWorkspace.getState();
    try {
      // 已接管的脏页可在标签往返后继续编辑；授权来自editor原快照，不借已释放的只读browser页票据。
      if (editorRef.current === ticket.editor && ticket.editor.page === ticket.page && ticket.editor.view.rows === ticket.rows && ticket.editor.canEdit() && latest.current.active && workspace.settings.activeTabId === tab.id && !workspace.activeJobs[tab.id] && document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length <= 1) return true;
    } catch { /* 无法确认来源时不转交任何草稿。 */ }
    ticket.valid = false; return false;
  }
  /** 显式菜单或本格paste事件只打开本地预览，读取本次DataTransfer后不保留事件对象。 */
  function openPaste(data?: Pick<DataTransfer, 'types' | 'getData'>): void {
    if (!editActionCurrent() || !available() || pasteRef.current || rangeRef.current || inputRef.current || previewRef.current) return;
    try {
      const source = data ? readSqliteClipboard(data) : undefined;
      if (!editActionCurrent() || !available()) return;
      const editor = renderedEditor!, ticket: PasteInputTicket = { id: uid(), editor, page: editor.page, rows: editor.view.rows, valid: true, ...(source ? { source } : {}) };
      pasteRef.current = ticket; editor.inputOpen(true); setPasteOpen(ticket);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 关闭只清本票据input标志，不替换原行或清除其它编辑器的dirty。 */
  function closePaste(ticket: PasteInputTicket): void {
    if (pasteRef.current !== ticket) return;
    pasteRef.current = null; ticket.valid = false; ticket.editor.inputOpen(false); setPasteOpen(null);
  }
  /** 同步一次暂存：计划核原page，editor再验证整批与现有差异，失败不产生半批新增行。 */
  function stagePaste(ticket: PasteInputTicket, plan: SqlitePastePlan): void {
    if (!pasteCurrent(ticket)) throw Error(clipboardText.stale);
    const ids = ticket.editor.appendRows(sqlitePastePlanValues(plan, ticket.page));
    if (pasteRef.current !== ticket || editorRef.current !== ticket.editor) return;
    closePaste(ticket); if (ids[0]) setSelectedRow(ids[0]);
  }
  /** 只接纳准确当前grid的选格通知；布局交接允许报告新格，旧已提交render不能污染后来起点。 */
  function selectPasteCell(anchor: SqlitePasteAnchor | undefined): void {
    const editor = renderedEditor;
    if (editRender.current !== undefined && editRender.current !== editRenderTicket || !editor || editorRef.current !== editor || editor.page !== page || editor.view.rows !== editRows || !latest.current.active || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    const value = anchor && editRows.includes(anchor.row) && !anchor.row.deleted && Number.isInteger(anchor.column) && anchor.column >= 0 && anchor.column < editor.page.columns.length && !editor.page.columns[anchor.column].generated ? { row: anchor.row, column: anchor.column, ...(anchor.columns ? { columns: anchor.columns } : {}) } : undefined;
    const before = rangeCellRef.current; if (before?.row === value?.row && before?.column === value?.column && before?.columns === value?.columns) return;
    rangeCellRef.current = value; setRangeCell(value);
  }
  /** 输入窗口固定原锚点，不随焦点移动改写目标；原editor仍是已接管草稿的授权来源。 */
  function rangeCurrent(ticket: RangeInputTicket): boolean {
    if (rangeRef.current !== ticket || !ticket.valid) return false;
    const workspace = useWorkspace.getState();
    try {
      if (editorRef.current === ticket.editor && ticket.editor.page === ticket.page && ticket.editor.view.rows === ticket.rows && ticket.rows.includes(ticket.anchor.row) && !ticket.anchor.row.deleted && Number.isInteger(ticket.anchor.column) && ticket.anchor.column >= 0 && ticket.anchor.column < ticket.page.columns.length && !ticket.page.columns[ticket.anchor.column].generated && ticket.editor.canEdit() && latest.current.active && workspace.settings.activeTabId === tab.id && !workspace.activeJobs[tab.id] && document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length <= 1) return true;
    } catch { /* 无法确认原范围时不转交任何值。 */ }
    ticket.valid = false; return false;
  }
  /** Ctrl/Cmd+V按原活动单元格位置覆盖，新增记录仍须明确选择独立菜单。 */
  function openRange(data?: Pick<DataTransfer, 'types' | 'getData'>, supplied = rangeCellRef.current): void {
    if (!editActionCurrent() || !available() || rangeRef.current || pasteRef.current || inputRef.current || previewRef.current) return;
    try {
      const caret = rangeCellRef.current;
      if (!supplied || !caret || supplied.row !== caret.row || supplied.column !== caret.column || supplied.columns !== caret.columns || !editRows.includes(supplied.row) || supplied.row.deleted || !Number.isInteger(supplied.column) || supplied.column < 0 || supplied.column >= renderedEditor!.page.columns.length || renderedEditor!.page.columns[supplied.column].generated) throw Error(rangeText.anchorRequired);
      const source = data ? readSqliteClipboard(data) : undefined;
      if (!editActionCurrent() || !available() || rangeCellRef.current !== caret) return;
      const editor = renderedEditor!, ticket: RangeInputTicket = { id: uid(), editor, page: editor.page, rows: editor.view.rows, anchor: { row: caret.row, column: caret.column, ...(caret.columns ? { columns: caret.columns } : {}) }, valid: true, ...(source ? { source } : {}) };
      rangeRef.current = ticket; editor.inputOpen(true); setRangeOpen(ticket);
    } catch (reason) { setValidation(errorMessage(reason)); }
  }
  /** 只消费自己的输入占用；失效时仍可关闭，不清后来窗口或既有增删改。 */
  function closeRange(ticket: RangeInputTicket): void {
    if (rangeRef.current !== ticket) return;
    rangeRef.current = null; ticket.valid = false; ticket.editor.inputOpen(false); setRangeOpen(null);
  }
  /** 准确范围计划由editor整批复核后一次覆盖本地草稿，不直接发送SQL。 */
  function stageRange(ticket: RangeInputTicket, plan: SqliteRangePastePlan): void {
    if (!rangeCurrent(ticket)) throw Error(rangeText.stale);
    const values = sqliteRangePastePlanValues(plan, ticket.page, ticket.rows, ticket.anchor);
    if (ticket.anchor.columns) ticket.editor.pasteCells(ticket.anchor.row.id, ticket.anchor.column, values, plan.columns.map(name => ticket.page.columns.findIndex(column => column.name === name)));
    else ticket.editor.pasteCells(ticket.anchor.row.id, ticket.anchor.column, values);
    if (rangeRef.current === ticket && editorRef.current === ticket.editor) closeRange(ticket);
  }
  useLayoutEffect(() => {
    valuesRef.current?.current(); statisticsRef.current?.current();
    if (inputRef.current?.duplicate) inputCurrent(inputRef.current);
    if (pasteRef.current) pasteCurrent(pasteRef.current);
    if (rangeRef.current) rangeCurrent(rangeRef.current);
    if (fillRef.current) fillCurrent(fillRef.current);
    filteredSelectRef.current?.intent.current();
    const find = findRef.current;
    // 新key完成提交后旧Portal已退场；退休授权只覆盖这一准确交接，不跨后续Modal复用。
    if (find && findOpen === find) delete find.retiringPreview;
    if (find && !findCurrent(find) && !find.staging) closeFind(find);
    const cell = rangeCellRef.current;
    if (cell && (!renderedEditor || !editRows.includes(cell.row) || cell.row.deleted || !renderedEditor.page.columns[cell.column] || renderedEditor.page.columns[cell.column].generated)) { rangeCellRef.current = undefined; setRangeCell(undefined); }
  });
  useEffect(() => useWorkspace.subscribe(() => { valuesRef.current?.current(); statisticsRef.current?.current(); cellFilterRef.current?.source.current(); filteredSelectRef.current?.intent.current(); if (fillRef.current) fillCurrent(fillRef.current); if (pasteRef.current) pasteCurrent(pasteRef.current); if (rangeRef.current) rangeCurrent(rangeRef.current); if (findRef.current) findCurrent(findRef.current); }), []);
  /** 常驻查找不占用DB会话；来源更换和外来模态留下永久失效标记，仅容许准确自己的预览。 */
  function findCurrent(ticket: FindInputTicket): boolean {
    if (findRef.current !== ticket || !ticket.valid) return false;
    const workspace = useWorkspace.getState();
    try {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
      const ownModal = dialogs.length === 0 || dialogs.length === 1 && (!!dialogs[0].querySelector('[data-sqlite-find-preview="' + ticket.id + '"]') || !!ticket.retiringPreview && !!dialogs[0].querySelector('[data-sqlite-find-preview="' + ticket.retiringPreview + '"]'));
      if (editorRef.current === ticket.editor && ticket.editor.page === ticket.page && ticket.editor.view.rows === ticket.rows && ticket.editor.canEdit() && latest.current.active && workspace.settings.activeTabId === tab.id && !workspace.activeJobs[tab.id] && !inputRef.current && !pasteRef.current && !rangeRef.current && !previewRef.current && ownModal) return true;
    } catch { /* 原源不能确认时不接收线程结果或替换。 */ }
    ticket.valid = false; return false;
  }
  /** 显式按钮、快捷键和原生菜单共用同一入口，不模拟隐藏控件或发起数据库读取。 */
  function openFind(mode: 'find' | 'replace' = 'find'): void {
    if (!editActionCurrent() || !available() || inputRef.current || previewRef.current || pasteRef.current || rangeRef.current) return;
    const previous = findRef.current;
    if (!previous || !findCurrent(previous)) {
      if (previous) closeFind(previous);
      const editor = renderedEditor!, ticket: FindInputTicket = { id: uid(), editor, page: editor.page, rows: editor.view.rows, valid: true, preview: false, staging: false };
      findRef.current = ticket; setFindOpen(ticket); setFindHit(undefined); setFindPreview(false);
    }
    setFindFocus(value => ({ id: value.id + 1, mode }));
  }
  /** 原面板关闭和旧cleanup只能清除自己的票据，不能清后来新source或已有数据草稿。 */
  function closeFind(ticket: FindInputTicket): void {
    if (findRef.current !== ticket) return;
    ticket.valid = false; findRef.current = null; setFindOpen(null); setFindPreview(false); setFindHit(undefined);
  }
  /** 输入修订仅清原面板命中，旧面板不能清继任来源的高亮。 */
  function clearFindHit(ticket: FindInputTicket): void { if (findRef.current === ticket) setFindHit(undefined); }
  /** 预览阶段同步登记，实际执行还必须核唯一准确DOM标记。 */
  function findPreviewChanged(ticket: FindInputTicket, opened: boolean): void {
    if (findRef.current !== ticket) return;
    ticket.preview = opened; setFindPreview(opened);
  }
  /** 只向准确原行原列发导航请求，由Grid真实虚拟滚动和活动格API定位。 */
  function jumpFind(ticket: FindInputTicket, rowId: string, column: number, focus = true, range?: { start: number; end: number }): void {
    if (!findCurrent(ticket) || ticket.preview || !Number.isInteger(column) || column < 0 || column >= ticket.page.columns.length) return;
    const row = ticket.rows.find(row => row.id === rowId); if (!row || row.deleted) return;
    layout.reveal(ticket.page.columns[column].name);
    setFindHit({ id: uid(), page: ticket.page, rows: ticket.rows, row, column, focus, ...(range ? { range: { ...range } } : {}) });
  }
  /** Opaque计划只消费一次；成功整批暂存后签新来源，输入seed不提供任何执行或目标授权。 */
  function stageFind(ticket: FindInputTicket, plan: SqliteTextReplacementPlan, continuation?: SqliteTableFindSeed): boolean {
    const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
    if (!findCurrent(ticket) || !ticket.preview || dialogs.length !== 1 || !dialogs[0].querySelector('[data-sqlite-find-preview="' + ticket.id + '"]')) throw Error(findText.stale);
    const patches = sqliteTextReplacementPlanValues(plan, ticket.page, ticket.rows); ticket.staging = true;
    try {
      ticket.editor.replaceTextCells(patches);
      if (findRef.current !== ticket || editorRef.current !== ticket.editor || ticket.editor.page !== ticket.page || !ticket.editor.canEdit() || !latest.current.active || useWorkspace.getState().settings.activeTabId !== tab.id) return false;
      ticket.valid = false;
      const next: FindInputTicket = { id: uid(), editor: ticket.editor, page: ticket.page, rows: ticket.editor.view.rows, valid: true, preview: false, staging: false, retiringPreview: ticket.id, ...(continuation ? { seed: continuation } : {}) };
      findRef.current = next; setFindOpen(next); setFindPreview(false); setFindHit(undefined); setFindFocus(value => ({ id: value.id + 1, mode: continuation?.mode ?? 'replace' })); return true;
    } finally { ticket.staging = false; }
  }
  /** 组合输入、重复键与外来Modal不接管；输入只进入查找栏，不进入单元格编辑器。 */
  function findKey(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.repeat || !event.ctrlKey && !event.metaKey || event.altKey || !['f', 'h'].includes(event.key.toLowerCase()) || !editActionCurrent() || !available()) return;
    event.preventDefault(); event.stopPropagation(); openFind(event.key.toLowerCase() === 'h' ? 'replace' : 'find');
  }
  const checkedCount = checkedRows && checkedRows.editor === renderedEditor && checkedRows.capture.page === page && checkedRows.capture.rows === editRows ? checkedRows.capture.selected.length : 0;
  const changes = renderedEditor?.changes ?? [], counts = { insert: changes.filter(change => change.kind === 'insert').length, update: changes.filter(change => change.kind === 'update').length, delete: changes.filter(change => change.kind === 'delete').length };
  const editBlocked = !active || externalBusy || !editView?.valid || editView.unknown || !!cellInput || !!pasteOpen || !!rangeOpen || !!fillOpen || !!filteredSelectOpen || findPreview;
  const headerSort: SqliteHeaderSort = page ? sqliteHeaderSortToGrid(applied.current.sort, page) : [];
  const fieldOptions = (page?.columns ?? view.columns).map((column, index) => <option key={index} value={column.name}>{column.name} · {column.declaredType || text.dynamic}</option>);
  const cellFilterReady = !!cellFilterOwner && cellFilterRef.current === cellFilterOwner && cellFilterOwner.source.current();
  return <div className="workspace-tab table-tab sqlite-table-tab" onKeyDownCapture={findKey} aria-label={text.title} data-readonly={editView ? 'false' : 'true'}>
    <div className="context-bar"><span className="connection-dot" style={{ background: profile?.color }}/><strong>{profile?.name ?? tab.connectionId}</strong><span>/</span><span>{tab.database}</span><span>/</span><strong>{tab.table}</strong><span className="grow"/><span className="tag">SQLite · {text.title}</span></div>
    {/* 只展示放得下的完整操作，其余沿原菜单回调展开，不让应用根容器被横向撑开。 */}
    <AdaptiveToolbar className="toolbar" ariaLabel={text.toolbar} moreLabel={navigationZh.more}
      moreDisabled={!page || !active || invalidTarget || view.busy || externalBusy}
      contextKey={JSON.stringify([tab.id, version, refreshVersion, page?.schemaKey, view.busy, externalBusy, !!editView?.dirty, checkedRows?.id, rangeCell?.row.id, rangeCell?.column, cellFilterOwner?.id])}
      isCurrent={() => !!page && available() && (controller.pageCurrent(page) || editActionCurrent())}
      items={[
        { key: 'refresh', content: (<button aria-label={text.refresh} disabled={!active || invalidTarget || !!exportData || externalBusy && !view.busy} onClick={() => read(page?.offset ?? 0)}>{text.refresh}</button>) },
        { key: 'stop', content: (<button aria-label={text.stop} disabled={!view.busy} onClick={() => void controller.stop()}>{text.stop}</button>) },
        { key: 'conditions', content: (<button aria-expanded={conditions} onClick={() => setConditions(value => !value)}>{text.conditions}</button>) },
        ...(page?.target.kind === 'table' ? [{ key: 'import', content: (<button aria-label={importText.entry} title={editView?.dirty || editView?.busy || editView?.unknown || externalBusy ? importText.busyDraft : undefined} disabled={!active || invalidTarget || view.busy || externalBusy || !!fullExport || !!exportData || !!tableImport || !!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen} onClick={openImport}>{importText.entry}</button>) }] : []),
        { key: 'export-page', content: (<button aria-label={text.export} disabled={!page || view.busy || externalBusy} onClick={exportPage}>{text.export}</button>) },
        { key: 'export-all', content: (<button aria-label={exportText.entry} disabled={!page || view.busy || externalBusy || !!fullExport} onClick={openAllExport}>{exportText.entry}</button>) },
        { key: 'columns', content: (<button aria-label={layoutText.entry} disabled={!page || !layoutView.ready || !layoutSourceCurrent()} onClick={() => { if (layoutUiCurrent()) setLayoutDialog({ scope: layoutScope, preferences: layout.view.preferences, dirty: layout.view.dirty }); }}>{layoutText.entry}{layoutView.dirty ? " *" : ""}</button>) },
      ]}
      more={page ? <><ActionMenuSection label={cellFilterText.group}><button disabled={!cellFilterReady} title={cellFilterReady && cellFilterOwner ? cellFilterText.target(cellFilterOwner.source.column) : cellFilterReason || cellFilterText.unavailable} onClick={() => appendCellFilter(false)}>{cellFilterText.equal}</button><button disabled={!cellFilterReady} title={cellFilterReady && cellFilterOwner ? cellFilterText.target(cellFilterOwner.source.column) : cellFilterReason || cellFilterText.unavailable} onClick={() => appendCellFilter(true)}>{cellFilterText.exclude}</button></ActionMenuSection>{editView && <ActionMenuSection label={tableToolbarZh.editing}><button aria-label={fillText.entry} disabled={editBlocked || !checkedCount || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={openFill}>{fillText.entry}</button><button aria-label={editText.duplicateEntry} disabled={editBlocked || !selectedRow || editRows.find(row => row.id === selectedRow)?.deleted || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={duplicateRow}>{editText.duplicateEntry}</button><button aria-label={editText.removeSelected} title={editText.removeSelectedCount(checkedCount)} disabled={editBlocked || !checkedCount || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={removeCheckedRows}>{editText.removeSelected}（{checkedCount}）</button></ActionMenuSection>}<ActionMenuSection label={tableToolbarZh.transfer}>{editView && <button disabled={editBlocked || !rangeCell || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => openRange()}>{rangeText.entry}</button>}{editView && <button disabled={editBlocked || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => openPaste()}>{clipboardText.paste}</button>}</ActionMenuSection><ActionMenuSection label={tableToolbarZh.display}>{detailPage && <button disabled={!detailSelection || detailSelection.binding !== detailBinding} title={detailText.sqliteChoose} onClick={() => showRowDetail()}>{detailText.open}</button>}<button aria-label={statisticsText.entry} disabled={!active || invalidTarget || view.busy || externalBusy} onClick={openStatistics}>{statisticsText.entry}</button>{editView && <><button aria-label={findText.entry} disabled={editBlocked} onClick={() => openFind()}>{findText.entry}</button><button aria-label={findText.replaceEntry} disabled={editBlocked} onClick={() => openFind('replace')}>{findText.replaceEntry}</button></>}</ActionMenuSection><ActionMenuSection label={tableToolbarZh.generate}><button aria-label={sqliteZh.selectQuery} disabled={invalidTarget || view.busy || externalBusy} onClick={() => { if (available()) openSqliteSelect(tab.connectionId, tab.database!, { name: tab.table!, kind: page?.target.kind ?? 'table' }); }}>{sqliteZh.selectQuery}</button><button aria-label={filteredSelectText.entry} disabled={!filteredSelectReady()} onClick={openFilteredSelect}>{filteredSelectText.entry}</button></ActionMenuSection><ActionMenuSection label={tableToolbarZh.structure}>{page.target.kind === 'table' && <><button aria-label={diagramText.entry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={openDiagram}>{diagramText.entry}</button>{onRename && <button aria-label={sqliteTableRenameZh.entry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onRename(); }}>{sqliteTableRenameZh.entry}</button>}{onIndexes && <button aria-label={sqliteIndexesZh.entry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onIndexes(); }}>{sqliteIndexesZh.entry}</button>}{onSqliteTableRebuild && tab.database === 'main' && <button aria-label={sqliteTableRebuildZh.entry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && tab.database === 'main' && typeof tab.table === 'string' && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onSqliteTableRebuild({ connectionId: tab.connectionId, database: 'main', table: tab.table }); }}>{sqliteTableRebuildZh.entry}</button>}{onColumns && <button aria-label={sqliteColumnsZh.entry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onColumns(); }}>{sqliteColumnsZh.entry}</button>}</>}{page.target.kind === 'view' && onObject && <button aria-label={sqliteObjectsZh.editDefinition} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onObject('replace'); }}>{sqliteObjectsZh.editDefinition}</button>}</ActionMenuSection>{onMaintenance && page.target.kind === 'table' && <ActionMenuSection label={sqliteTableMaintenanceZh.dangerGroup}>{(['clear', 'drop'] as const).map(action => <button key={action} aria-label={action === 'clear' ? sqliteTableMaintenanceZh.clearEntry : sqliteTableMaintenanceZh.dropEntry} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onMaintenance(action); }}>{action === 'clear' ? sqliteTableMaintenanceZh.clearEntry : sqliteTableMaintenanceZh.dropEntry}</button>)}</ActionMenuSection>}{page.target.kind === 'view' && onObject && <ActionMenuSection label={sqliteTableMaintenanceZh.dangerGroup}><button aria-label={sqliteObjectsZh.dropView} disabled={!!editView?.dirty || !!editView?.busy || !!editView?.unknown || !!cellInput || !!previewOpen || !!tableImport || !!fullExport || !!exportData} onClick={() => { if (available() && controller.pageCurrent(page) && !editorRef.current?.dirty && !editorRef.current?.busy && !editorRef.current?.view.unknown) onObject('drop'); }}>{sqliteObjectsZh.dropView}</button></ActionMenuSection>}</> : null}/>
    <p className="sqlite-browse-hint" title={text.headerHint}>{editView ? editText.editable : page?.edit?.kind === 'readonly' ? page.edit.reason : text.readonly}</p>
    {conditions && <div className="sqlite-browse-conditions"><p className="muted small">{text.typesHint}</p><button disabled={!page || !active || invalidTarget || view.busy || externalBusy} onClick={() => { if (editRender.current === editRenderTicket && presetCurrent()) setPresetsVisible(value => !value); }}>{presetText.entry}</button><button disabled={!page || !active || invalidTarget || view.busy || externalBusy} onClick={openValues}>{valuesText.entry}</button>{presetsVisible && page && <SqliteTablePresetPanel key={presetScope.id} scope={presetScope} target={{ connectionId: tab.connectionId, database: 'main', table: page.target.table }} columns={names} draftKey={JSON.stringify([limit, mode, filters, sort])} current={presetCurrent} configuration={presetConfiguration} onLoad={loadPreset}/>}<SqliteTableFilters names={names} filters={filters} mode={mode} disabled={!active || invalidTarget || view.busy || externalBusy} current={() => editRender.current === editRenderTicket && available() && !view.busy && latest.current.refreshVersion === refreshVersion} id={uid} onFilters={setFilters} onMode={setMode}/>
      <fieldset aria-label={text.sorts}><legend>{text.sorts}</legend><button disabled={!names.length || sort.length >= sqliteTableBrowseLimits.sorts || sort.length >= names.length} onClick={() => setSort(values => { if (values.length >= sqliteTableBrowseLimits.sorts) return values; const column = names.find(name => !values.some(value => value.column === name)); return column ? [...values, { id: uid(), column, direction: 'asc' }] : values; })}>{text.addSort}</button>{sort.map((rule, index) => <div className="sqlite-browse-rule" key={rule.id}><span>{index + 1}</span><select aria-label={text.sortColumn(index + 1)} value={rule.column} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, column: event.target.value } : value))}>{view.columns.map((column, columnIndex) => <option key={columnIndex} value={column.name} disabled={sort.some(value => value.id !== rule.id && value.column === column.name)}>{column.name}</option>)}</select><select aria-label={text.sortDirection(index + 1)} value={rule.direction} onChange={event => setSort(values => values.map(value => value.id === rule.id ? { ...value, direction: event.target.value as 'asc' | 'desc' } : value))}><option value="asc">{text.ascending}</option><option value="desc">{text.descending}</option></select><button aria-label={text.up(index + 1)} disabled={index === 0} onClick={() => moveSort(index, -1)}>↑</button><button aria-label={text.down(index + 1)} disabled={index === sort.length - 1} onClick={() => moveSort(index, 1)}>↓</button><button aria-label={text.removeSort(index + 1)} onClick={() => setSort(values => values.filter(value => value.id !== rule.id))}>×</button></div>)}</fieldset>
      <label>{text.limit}<input aria-label={text.limit} type="number" min={1} max={sqliteTableBrowseLimits.pageSize} value={limit} onChange={event => setLimit(Number(event.target.value))}/></label><button className="primary" disabled={!active || invalidTarget || externalBusy && !view.busy} onClick={apply}>{text.apply}</button></div>}
    {findOpen && <SqliteTableFindPanel key={findOpen.id} page={findOpen.page} rows={findOpen.rows} seed={findOpen.seed} previewOwner={findOpen.id} focusRequest={findFocus} isCurrent={() => findCurrent(findOpen)} onJump={(rowId, column, focus, range) => jumpFind(findOpen, rowId, column, focus, range)} onStage={(plan, seed) => stageFind(findOpen, plan, seed)} onClearHit={() => clearFindHit(findOpen)} onPreviewChange={opened => findPreviewChanged(findOpen, opened)} onClose={() => closeFind(findOpen)}/>}
    <ErrorBox message={invalidTarget ? text.unsupported : validation || view.error}/>
    <div className="sqlite-browse-result">{view.busy ? <div className="empty"><Spinner text={view.stopping ? text.stopping : text.loading}/></div> : page && editView && editView.page === page ? <SqliteTableEditGrid page={page} rows={editView.rows} projection={projection} onColumnResize={resizeLayout} disabled={editBlocked || !layoutView.ready} selected={selectedRow} isCurrent={() => editActionCurrent(false) && !!renderedEditor?.canEdit()} onSelect={selectEditRow} onEdit={editRow} onPaste={openRange} onActiveCell={selectPasteCell} onFilterCell={selectEditFilterCell} findHit={findHit} sort={headerSort} onSortChange={sortFromHeader} onCheckedRows={selectCheckedRows}/> : page ? <div className="query-result-with-details"><div className="query-result-grid"><ResultsGrid rowJump columns={displayColumns} rows={page.result.rows} frozenKeys={displayFrozen} columnWidths={displayWidths} onColumnResize={resizeLayout} selectionScope={page} isCurrent={() => controller.pageCurrent(page) && available() && !externalBusy} binaryFileActions={false} onActiveCellChange={selectReadFilterCell} onActiveRowIndexChange={detailPage ? selectDetailRow : undefined} sort={headerSort.map(rule => ({ column: rule.columnKey, direction: rule.direction }))} onSortChange={next => sortFromHeader(next.map(rule => ({ columnKey: rule.column, direction: rule.direction })))}/></div>
      {visibleRowDetail && detailPage && <QueryRowDetailsPanel controller={rowDetails} view={visibleRowDetail} sqlitePage={detailPage} isCurrent={() => rowDetailsCurrent(visibleRowDetail.binding)} onMove={showRowDetail}
        onClose={current => { if (rowDetailsCurrent(current.binding) && rowDetails.close(current)) setRowDetail(null); }}/>}
      </div> : <Empty title={text.noPage}/>}</div>
    {editView && <div className="table-action-bar"><span role="status">{editText.counts(counts.insert, counts.update, counts.delete)}</span><button aria-label={editText.add} disabled={editBlocked} onClick={addRow}>{editText.add}</button><button aria-label={editText.editRow} disabled={editBlocked || !selectedRow || editRows.find(row => row.id === selectedRow)?.deleted} onClick={() => { const row = editRows.find(row => row.id === selectedRow); if (row) editRow(row); }}>{editText.editRow}</button><button aria-label={editText.remove} disabled={editBlocked || !selectedRow || editRows.find(row => row.id === selectedRow)?.deleted} onClick={removeRow}>{editText.remove}</button><button aria-label={editText.undo} disabled={editBlocked || !editView.undo} onClick={undoEdit}>{editText.undo}</button><button aria-label={editText.redo} disabled={editBlocked || !editView.redo} onClick={redoEdit}>{editText.redo}</button><button aria-label={editText.discard} disabled={editView.busy || !editView.dirty} onClick={discardEdit}>{editText.discard}</button><button className="primary" aria-label={editText.preview} disabled={editBlocked || !changes.length} onClick={previewChanges}>{editText.preview}</button></div>}
    {editView?.message && <p role="status" className="sqlite-browse-hint">{editView.message}</p>}
    <div className="tab-status"><button aria-label={text.first} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(0)}>{text.first}</button><button aria-label={text.previous} disabled={view.busy || !page || page.offset === 0 || externalBusy} onClick={() => read(Math.max(0, page!.offset - page!.limit))}>{text.previous}</button><button aria-label={text.next} disabled={view.busy || !page?.hasMore || externalBusy || page.offset + page.limit > sqliteTableBrowseLimits.offset} onClick={() => read(page!.offset + page!.limit)}>{text.next}</button><span>{page ? text.page(page.offset, page.result.rows.length, page.hasMore) : ''}</span><span className="grow"/><small title={text.noCount}>{text.noCount}</small></div>
    {diagramOpen && <SqliteRelationshipDialog key={diagramOpen.id} source={diagramOpen.page} current={diagramOpen.current} onActivity={diagramOpen.activity} onClose={() => { if (diagramRef.current === diagramOpen) { diagramOpen.valid = false; diagramRef.current = undefined; setDiagramOpen(undefined); } }}/>}
    {valuesOpen && <SqliteValueOptionsDialog key={valuesOpen.id} tabId={tab.id} base={valuesOpen.base} columns={valuesOpen.columns} mode={valuesOpen.mode} current={valuesOpen.current} onApply={valuesOpen.apply} onClose={() => { if (valuesRef.current === valuesOpen) { valuesOpen.valid = false; valuesRef.current = undefined; setValuesOpen(undefined); } }} onCleanup={reason => useWorkspace.getState().notify(errorMessage(reason), true)}/>}
    {statisticsOpen && <SqliteStatisticsDialog key={statisticsOpen.id} tabId={tab.id} base={statisticsOpen.base} columns={statisticsOpen.columns} current={statisticsOpen.current} onClose={() => { if (statisticsRef.current === statisticsOpen) { statisticsOpen.valid = false; statisticsRef.current = undefined; setStatisticsOpen(undefined); } }} onCleanup={reason => useWorkspace.getState().notify(errorMessage(reason), true)}/>}
    {layoutDialog?.scope === layoutScope && <TablePreferencesDialog title={layoutText.title} hint={layoutText.hint} maximumNameLength={512} defaultWidth={editView ? 180 : 170} preferences={layoutView.preferences} pending={layoutView.pending} dirty={layoutView.dirty} error={layoutView.error} onChange={changeLayout} onSave={() => { if (layoutUiCurrent()) void layout.persist().catch(reason => setValidation(errorMessage(reason))); }} onReset={() => { if (layoutUiCurrent() && window.confirm(layoutText.reset) && layoutUiCurrent()) void layout.persist(true).catch(reason => setValidation(errorMessage(reason))); }} onReload={() => { if (layoutUiCurrent() && (!layout.view.dirty || window.confirm(layoutText.discard)) && layoutUiCurrent()) void layout.reload(); }} reloadLabel={layoutText.reload} onClose={closeLayout}/>}
    {fullExport && <SqliteTableExportDialog intent={fullExport.intent} onActivity={delta => fullExportActivity(fullExport, delta)} onClose={() => closeAllExport(fullExport)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onCommitted={(output, _changed, content) => useWorkspace.getState().notify(content === 'structure' ? exportText.structureCommittedChanged : exportText.committedChanged(output.rows))}/>}
    {tableImport && <SqliteTableImportDialog key={tableImport.source.id} source={tableImport.source} onActivity={delta => importActivity(tableImport, delta)} onDirtyChange={dirty => importDirty(tableImport, dirty)} onClose={() => closeImport(tableImport)} onCommitted={(output, changed) => imported(tableImport, output, changed)} onCleanupError={message => useWorkspace.getState().notify(message, true)}/>}
    {exportData && <ResultExportDialog result={exportData} tabId={tab.id} scope="table" allowSql={false} onClose={() => setExportData(null)}/>}
    {rangeOpen && <SqlitePasteRangeDialog key={rangeOpen.id} page={rangeOpen.page} rows={rangeOpen.rows} anchor={rangeOpen.anchor} initial={rangeOpen.source} current={() => rangeCurrent(rangeOpen)} onStage={plan => stageRange(rangeOpen, plan)} onClose={() => closeRange(rangeOpen)}/>}
    {pasteOpen && <SqlitePasteInsertDialog key={pasteOpen.id} page={pasteOpen.page} initial={pasteOpen.source} current={() => pasteCurrent(pasteOpen)} onStage={plan => stagePaste(pasteOpen, plan)} onClose={() => closePaste(pasteOpen)}/>}
    {filteredSelectOpen && <SqliteFilteredSelectDialog intent={filteredSelectOpen.intent} ownerId={filteredSelectOpen.id} onOpen={plan => openFilteredSelectQuery(filteredSelectOpen, plan)} onClose={() => closeFilteredSelect(filteredSelectOpen)}/>}
    {fillOpen && <SqliteTableFillDialog key={fillOpen.id} ticket={fillOpen} ownerId={fillOpen.id} page={fillOpen.source.page} count={fillOpen.source.selected.length} allNew={fillOpen.source.allNew} current={() => fillCurrent(fillOpen)} onSave={fields => stageFill(fillOpen, fields)} onClose={() => closeFill(fillOpen)}/>}
    {cellInput && <SqliteTableValueDialog key={cellInput.id} ticket={cellInput} page={cellInput.page} row={cellInput.row} column={cellInput.column} duplicate={!!cellInput.duplicate} duplicateOwner={cellInput.duplicate ? cellInput.id : undefined}
      navigation={cellInput.column === undefined && !cellInput.duplicate && cellInput.row.index !== undefined ? {
        ownerId: cellInput.id, previous: !!adjacentRecord(cellInput, -1), next: !!adjacentRecord(cellInput, 1),
        move: (direction, values) => moveRecordInput(cellInput, direction, values),
      } : undefined} current={() => inputCurrent(cellInput)} onSave={values => saveInput(cellInput, values)} onClose={() => closeInput(cellInput)}/>}
    {previewOpen && editView && previewOpen.editor === renderedEditor && <SqliteTablePreviewDialog key={previewOpen.id + ':' + (editView.preview?.previewId ?? 'pending')} ticket={previewOpen} view={editView} current={() => previewCurrent(previewOpen, editView.preview, editView.taskId)} onApply={() => applyPreview(previewOpen, editView.preview)} onClose={() => closePreview(previewOpen, editView.preview)} onStop={() => stopPreview(previewOpen, editView.preview, editView.taskId)}/>}
  </div>;
}
