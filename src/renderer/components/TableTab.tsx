import { tableChecksZh } from '../locales/tableChecks.zh-CN';
import { tableCopyDataZh } from '../locales/tableCopyData.zh-CN';
import { tableCopyStructureZh } from '../locales/tableCopyStructure.zh-CN';
import { zh, formatText } from '../locales/zh-CN';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type Column, type RenderEditCellProps, type DataGridHandle, type CellKeyDownArgs, type CellKeyboardEvent } from 'react-data-grid';
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, CopyPlus, Filter, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, Undo2, Eye, KeyRound } from 'lucide-react';
import type { FilterRule, FilterGroup, SortRule, SqlPreview, TableInfo, TablePage, ResultExportData } from '../../shared/contracts';
import { cellPreview, cellText, errorMessage, invoke, ownCell, rowEqual, uid } from '../lib';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceBusyLease, type WorkspaceTab } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import { collectChanges, newDraftRow, type DraftRow } from '../dataChanges';
import { cellClipboardType, decodeClipboard, encodeClipboard, pasteCells } from '../gridClipboard';
import { maxTablePage, parsePageJump, type FilterMode, type FilterDraft } from '../tableFilters';
import { tableCellFilterDraft } from '../tableCellFilter';
import { tableCellFilterZh as cellFilterText } from '../locales/tableCellFilter.zh-CN';
import { buildTableSelectedFilter, type TableSelectedFilterProposal } from '../tableSelectedFilter';
import { tableSelectedFilterZh as selectedFilterText } from '../locales/tableSelectedFilter.zh-CN';
import { TableSelectedFilterPanel } from './TableSelectedFilterPanel';
import { TableFilterPanel } from './TableFilterPanel';
import { TableFilterGroupsDialog } from './TableFilterGroupsDialog';
import { tableFilterGroupAfterChange, tableFilterGroupWithMode, tableFilterGroupSummary } from '../tableFilterGroups';
import { tableFilterGroupsZh as groupText } from '../locales/tableFilterGroups.zh-CN';
import { validateFilterGroup } from '../../shared/filtering';
import { snapshotTablePageExport } from '../tablePageExport';
import { tablePageExportZh as pageExportText } from '../locales/tablePageExport.zh-CN';
import { ResultExportDialog } from './ResultExportDialog';
import { TableFilteredExportDialog } from './TableFilteredExportDialog';
import { TableFilteredExportIntent } from '../tableFilteredExportUi';
import { tableFilteredExportZh } from '../locales/tableFilteredExport.zh-CN';
import { TableFilteredDeleteDialog } from './TableFilteredDeleteDialog';
import { TableFilteredDeleteIntent, tableFilteredDeleteAvailable } from '../tableFilteredDeleteUi';
import { tableFilteredDeleteZh as filteredDeleteText } from '../locales/tableFilteredDelete.zh-CN';
import type { TableFilteredDeleteApplyOutput } from '../../shared/tableFilteredDelete';
import { TableFilteredUpdateDialog } from './TableFilteredUpdateDialog';
import { TableFilteredUpdateIntent, tableFilteredUpdateColumns } from '../tableFilteredUpdateUi';
import { tableFilteredUpdateZh as filteredUpdateText } from '../locales/tableFilteredUpdate.zh-CN';
import type { TableFilteredUpdateApplyOutput } from '../../shared/tableFilteredUpdate';
import { TableQueryTemplateDialog } from './TableQueryTemplateDialog';
import { buildTableQueryTemplate, tableQueryTemplateMetadataKey, type TableQueryTemplateKind, type TableQueryTemplateOptions } from '../tableQueryTemplate';
import { tableQueryTemplateZh as templateText } from '../locales/tableQueryTemplate.zh-CN';
import { TableForeignKeyJoinDialog } from './TableForeignKeyJoinDialog';
import { TableForeignKeyJoinIntent, type ForeignKeyJoinPreview } from '../tableForeignKeyJoinIntent';
import { foreignKeyJoinChoices, foreignKeyJoinMetadataKey } from '../tableForeignKeyJoin';
import { tableForeignKeyJoinZh } from '../locales/tableForeignKeyJoin.zh-CN';
import { TableFilteredSelectIntent } from '../tableFilteredSelectUi';
import { tableFilteredSelectZh as filteredSelectText } from '../locales/tableFilteredSelect.zh-CN';
import { TableSortPanel } from './TableSortPanel';
import { tableSortZh as sortText } from '../locales/tableSort.zh-CN';
import { validateTableSort, tableSortFromGrid } from '../tableSort';
import { queryDatabasePatch } from '../../shared/queryContext';
import { TablePresetPanel } from './TablePresetPanel';
import { createPresetDialogGuard } from '../tablePresetDialogs';
import { validateTablePresetColumns, type TablePresetConfiguration } from '../../shared/tablePresets';
import { ForeignKeyDialog } from './ForeignKeyDialog';
import { ChildReferenceDialog } from './ChildReferenceDialog';
import { ChildReferenceIntent } from '../childReferenceIntent';
import { childReferencesZh } from '../locales/childReferences.zh-CN';
import { TableStatisticsDialog } from './TableStatisticsDialog';
import { TableStatisticsIntent } from '../tableStatisticsIntent';
import { tableStatisticsZh } from '../locales/tableStatistics.zh-CN';
import { TableValueOptionsDialog } from './TableValueOptionsDialog';
import { tableValueOptionsServices } from '../tableValueOptionsServices';
import { tableValueOptionsZh } from '../locales/tableValueOptions.zh-CN';
import { tableValueOptionsColumnCapability } from '../../shared/tableValueOptions';
import type { TableValueOptionsConditions } from '../tableValueOptionsUi';
import { patchReferenceRow, referenceWritable, referencesForColumn, type ReferenceSnapshot } from '../referenceChanges';
import { referenceZh } from '../locales/references.zh-CN';
import type { CellValue, ForeignKeyInfo } from '../../shared/contracts';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn, reconcileTablePreferences, visibleTableKeys, frozenTableKeys } from '../tableColumnPreferences';
import { applyPageReplacement, type PageOccurrence, type PageReplacement } from '../pageFindReplace';
import { PageFindPanel } from './PageFindPanel';
import { TablePreferencesDialog } from './TablePreferencesDialog';
import { tableGridZh } from '../locales/tableGrid.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { blocksBinaryTextInput, tableCellKeyIsComposing } from '../tableCellKeyboard';
import '../tableGrid.css';
import { DataTypeColor } from './DataTypeColor';
import { catalogColorType } from '../dataTypeColors';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { tableRenameZh } from '../locales/tableRename.zh-CN';
import { tableDropZh } from '../locales/tableDrop.zh-CN';
import { tableTruncateZh } from '../locales/tableTruncate.zh-CN';
import { tableCommentZh } from '../locales/tableComment.zh-CN';
import { tableDefaultEncodingZh } from '../locales/tableDefaultEncoding.zh-CN';
import { columnPageRefreshAction } from '../columnPatchServices';
import { useRecordViews, type RecordViewController } from '../hooks/useRecordViews';
import { TableApplyReceiptsDialog } from './TableApplyReceiptsDialog';
import { tableApplyReceiptZh } from '../locales/tableApplyReceiptZh';
import { acceptGridDrafts, captureRecordPagePreview, consumeRecordPagePreview, recordReadonlyReason, recordTargetKey, type RecordContext, type RecordPagePreview } from '../recordViews';
import { RecordEditorDialogs, RecordFormPanel } from './RecordFormPanel';
import { recordViewZh } from '../locales/recordViews.zh-CN';
import { tableAutoIncrementZh } from '../locales/tableAutoIncrement.zh-CN';
import { RecordPageNavigation, recordPageScope, type RecordPageContext } from '../recordPageNavigation';
import { assertCopiedRecordKeys, duplicateRecordDraft, recordDuplicateReadonlyReason } from '../recordDuplicate';
import { duplicateSelectedRecordDrafts } from '../recordDuplicateBatch';
import { recordDuplicateZh } from '../locales/recordDuplicate.zh-CN';
import { beginRecordCopyRead, consumeRecordCopyRead, recordCopySourceReady, recordCopyMetadataReason, type RecordCopyReadIntent, type RecordCopyPage } from '../recordCopySource';
import { recordCopySourceZh } from '../locales/recordCopySource.zh-CN';
import { tableCopyMetadataKey, type TableCopyPageSources } from '../../shared/tableCopySource';
import { PasteInsertIntent, type PasteInsertPlan } from '../pasteInsert';
import { PasteInsertDialog } from './PasteInsertDialog';
import { pasteInsertZh } from '../locales/pasteInsert.zh-CN';
import { BatchFillIntent, type BatchFillAssignment } from '../recordBatchFill';
import type { RecordInput } from '../recordViews';
import { TableBatchFillDialog } from './TableBatchFillDialog';
import { recordBatchFillZh } from '../locales/recordBatchFill.zh-CN';
import { DraftHistory, draftHistoryKey } from '../draftHistory';
import { captureTableDraft, restoreTableDraftRows } from '../tableDraft';
import type { TableDraftDocument, TableDraftPayload } from '../../shared/tableDraft';
import { TableDraftDialog } from './TableDraftDialog';
import { tableDraftFilesZh as savedDraftText } from '../locales/tableDraftFiles.zh-CN';
import { draftHistoryZh } from '../locales/draftHistory.zh-CN';
import { AdaptiveToolbar } from './AdaptiveToolbar';
import { ActionMenuSection } from './ActionMenu';
import { useUiCommandScope } from '../uiCommands';
import { tableToolbarZh } from '../locales/tableToolbar.zh-CN';
import { prepareCopyInsertSql } from '../copyInsertSql';
import { copyInsertSqlZh } from '../../shared/copyInsertSql.zh-CN';

/** 输入始终保留字符串精度，失焦仅提交到本地草稿，不执行数据库写入。 */
function TextCellEditor({ row, column, onRowChange, onClose, binary, onEditingChange }: RenderEditCellProps<DraftRow> & { binary: boolean; onEditingChange: (editor: object, editing: boolean) => void }) {
  const editor = useRef({}).current;
  // 网格Enter/Escape/Tab可直接卸载输入框而不派发blur；挂载时在绘制前占门。
  useLayoutEffect(() => { onEditingChange(editor, true); }, [editor, onEditingChange]);
  // 被动清理晚于父页卸载标记；旧会话的清理不能释放随后挂载的新编辑器。
  useEffect(() => () => { onEditingChange(editor, false); }, [editor, onEditingChange]);
  const value = ownCell(row.data, column.key);
  // 即使将来有额外的编辑入口，字节也只能以有界只读预览呈现，不能被转换为文本草稿。
  return <input className="grid-input" readOnly={binary} autoFocus onFocus={event => event.currentTarget.select()} defaultValue={binary ? cellPreview(value) : value === null ? '' : cellText(value)} onChange={event => { if (!binary) onRowChange({ ...row, data: { ...row.data, [column.key]: event.target.value } }); }} onBlur={() => onClose(!binary, false)} aria-label={formatText(zh.table.text001, column.key)}/>;
}

/** 分页、排序和筛选全部交给数据库，界面仅持有当前页及该页的待提交修改。 */
type TableQueryTemplateLease = { info: TableInfo; metadata: string; tab: WorkspaceTab; version: number; refresh: number; generation: number; limit: number; invalid: boolean };
type TableFilteredSelectPage = { info: TableInfo; page: TablePage; scope: string; generation: number; index: number };
type TableSortLease = { scope: object; columns: string[]; sort: SortRule[]; invalid: boolean };
type TableDraftLease = { mode: 'save' | 'restore'; payload?: TableDraftPayload; info: TableInfo; page: TablePage; rows: DraftRow[]; generation: number; invalid: boolean; values: unknown[] };
type TableFilterGroupLease = { scope: object; filters: FilterRule[]; mode: FilterMode; initial?: FilterGroup; invalid: boolean; dialogs: ReturnType<typeof createPresetDialogGuard> };
type TableSelectedFilterLease = { proposal: TableSelectedFilterProposal; fingerprint: string; metadata: string; scope: object; rows: DraftRow[]; selected: ReadonlySet<string>; selection: { rowId: string; key: string }; generation: number; layout: number; epoch: number; profile: unknown; tab: string; invalid: boolean; dialogs: ReturnType<typeof createPresetDialogGuard> };

export function TableTab({ tab, onOpenGeneratedQuery, onQueryTemplateNavigation, onDesign, onTransfer, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableCopyData, onTableCopyStructure, onTableRename, onTableAutoIncrement, onTableChecks, onTableComment, onTableDrop, onTableTruncate, onTableDefaultEncoding, refreshVersion = 0, refreshAutomatically = true }: { tab: WorkspaceTab; onOpenGeneratedQuery?(candidate: Omit<WorkspaceTab, 'id'>): void; onQueryTemplateNavigation?(): void; onDesign: (isView: boolean) => void; onTransfer: (mode: 'import' | 'export') => void; onColumnPatches(): void; onIndexPatches(): void; onForeignKeyPatches(): void; onTableCopyData?(): void; onTableCopyStructure?(): void; onTableRename(): void; onTableAutoIncrement(): void; onTableChecks?(): void; onTableComment(): void; onTableDrop?(): void; onTableTruncate?(): void; onTableDefaultEncoding(): void; refreshVersion?: number; refreshAutomatically?: boolean }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const connectionVersion = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const presetUiEpoch=useRef(0);
  const [info, setInfo] = useState<TableInfo | null>(null); const [page, setPage] = useState<TablePage | null>(null); const [pageIndex, setPageIndexState] = useState(1);
  const [draftDialog, setDraftDialog] = useState<TableDraftLease | null>(null), draftLease = useRef<TableDraftLease | null>(null);
  const [restoredDraftView, setRestoredDraftView] = useState(false);
  const [pageJump, setPageJump] = useState('1');
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [rows, setRowsState] = useState<DraftRow[]>([]); const [sort, setSort] = useState<SortRule[]>([]); const [filters, setFilters] = useState<FilterRule[]>([]); const [showFilter, setShowFilter] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [filterGroup, setFilterGroup] = useState<FilterGroup>();
  const [filterGroups, setFilterGroups] = useState<TableFilterGroupLease | null>(null), filterGroupsRef = useRef(filterGroups);
  const [selectedFilter, setSelectedFilter] = useState<TableSelectedFilterLease | null>(null), selectedFilterRef = useRef(selectedFilter);
  const [cellFilterSeed, setCellFilterSeed] = useState<FilterDraft>();
  const [pageExport, setPageExport] = useState<{ data: ResultExportData; selected: boolean } | null>(null), pageExportRef = useRef(pageExport);
  const [filteredExportDialog, setFilteredExportDialog] = useState<TableFilteredExportIntent | null>(null), filteredExportIntent = useRef<TableFilteredExportIntent | null>(null);
  const [filteredUpdateDialog, setFilteredUpdateDialog] = useState<TableFilteredUpdateIntent | null>(null), filteredUpdateIntent = useRef<TableFilteredUpdateIntent | null>(null);
  const [filteredDeleteDialog, setFilteredDeleteDialog] = useState<TableFilteredDeleteIntent | null>(null), filteredDeleteIntent = useRef<TableFilteredDeleteIntent | null>(null);
  const [queryTemplate, setQueryTemplate] = useState<TableQueryTemplateLease | null>(null), queryTemplateRef = useRef(queryTemplate);
  const [foreignKeyJoinDialog, setForeignKeyJoinDialog] = useState<TableForeignKeyJoinIntent | null>(null), foreignKeyJoinIntent = useRef<TableForeignKeyJoinIntent | null>(null);
  const foreignKeyJoinBusy = useRef<{ lease?: WorkspaceBusyLease; acquiring: boolean; releasing: boolean } | null>(null);
  const [filteredSelectDialog, setFilteredSelectDialog] = useState<TableFilteredSelectIntent | null>(null), filteredSelectIntent = useRef<TableFilteredSelectIntent | null>(null), filteredSelectPage = useRef<TableFilteredSelectPage | null>(null);
  /** 所有已应用条件/排序均同时回到第一页；在排队渲染前撤销旧loaded来源，堵住同事件旧按钮。 */
  function setPageIndex(next: number | ((current: number) => number)): void { filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null; setPageIndexState(next); }
  const [sortPanel, setSortPanel] = useState<TableSortLease | null>(null), sortPanelRef = useRef(sortPanel);
  const tableReadAction = useRef<object | null>(null), tableReadRender = {};
  /** 只发布已提交渲染的快捷动作；卸载、隐藏恢复或后继渲染不能复活旧按钮回调。 */
  useLayoutEffect(() => { tableReadAction.current = tableReadRender; return () => { if (tableReadAction.current === tableReadRender) tableReadAction.current = null; }; });
  const [selectedRows, setSelectedRowsState] = useState<ReadonlySet<string>>(new Set());
  const selectedRowsRef = useRef(selectedRows);
  /** 勾选状态同步发布，旧回调也只能读取当前选择。 */
  function setSelectedRows(value: ReadonlySet<string>) { batchFillIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; selectedRowsRef.current = value; setSelectedRowsState(value); }
  const copiedDraftIds = useRef(new Set<string>()); const [duplicateNotice, setDuplicateNotice] = useState('');
  const [copyPending, setCopyPending] = useState(false); const copyPendingRef = useRef(false);
  const insertCopyBlockedRef = useRef(false);
  const copyReadIntent = useRef<RecordCopyReadIntent | null>(null); const copyPageTask = useRef<string | undefined>(undefined);
  const copySources = useRef<{ connectionId: string; source: TableCopyPageSources } | null>(null); const copyRowRefs = useRef(new Map<string, string>());
  const copyPage = useRef<RecordCopyPage | null>(null);
  const pendingPaste = useRef<DraftRow[] | null>(null);
  const pasteInsertIntent = useRef<PasteInsertIntent | null>(null); const [pasteInsertDialog, setPasteInsertDialog] = useState<PasteInsertIntent | null>(null);
  const pasteInsertEnvironment = useRef<unknown[]>([]);
  const batchFillIntent = useRef<BatchFillIntent | null>(null), [batchFillDialog, setBatchFillDialog] = useState<BatchFillIntent | null>(null);
  const batchFillEnvironment = useRef<unknown[]>([]);
  useEffect(() => () => { batchFillIntent.current?.invalidate(); }, []);
  // 工作区先变化再恢复也同步撤销票据，不等待React合并渲染才发现切页或作业变化。
  useEffect(() => {
    const identity = (state: ReturnType<typeof useWorkspace.getState>) => JSON.stringify([state.settings.activeTabId, state.settings.tabs.find(item => item.id === tab.id), state.connectionVersions[tab.connectionId] ?? 0, state.connections.find(item => item.id === tab.connectionId), !!state.activeJobs[tab.id]]);
    // 导出自己的chooser/任务会占用标签；该忙碌位不撤销自身，原标签与连接变化仍同步作废。
    const exportIdentity = (state: ReturnType<typeof useWorkspace.getState>) => JSON.stringify([state.settings.activeTabId, state.settings.tabs.find(item => item.id === tab.id), state.connectionVersions[tab.connectionId] ?? 0, state.connections.find(item => item.id === tab.connectionId)]);
    return useWorkspace.subscribe((state, previous) => {
      if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] || state.settings.resultLimit !== previous.settings.resultLimit) foreignKeyJoinIntent.current?.invalidate();
      if (state.activeJobs !== previous.activeJobs && (state.activeJobs[tab.id] || previous.activeJobs[tab.id])) {
        const own = foreignKeyJoinBusy.current;
        const ownTransition = own?.acquiring && !previous.activeJobs[tab.id] && state.activeJobs[tab.id] || own?.releasing && previous.activeJobs[tab.id] && !state.activeJobs[tab.id];
        if (!ownTransition && !own?.lease?.owns()) foreignKeyJoinIntent.current?.invalidate();
      }
      if (exportIdentity(state) !== exportIdentity(previous)) filteredExportIntent.current?.invalidate();
      if (exportIdentity(state) !== exportIdentity(previous) || state.settings.tabs.find(item=>item.id===tab.id)!==previous.settings.tabs.find(item=>item.id===tab.id) || state.connections.find(item=>item.id===tab.connectionId)!==previous.connections.find(item=>item.id===tab.connectionId) || state.activeJobs[tab.id] && !previous.activeJobs[tab.id] && referenceCount.current===0) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); }
      if (identity(state) !== identity(previous) || state.settings.resultLimit !== previous.settings.resultLimit) filteredSelectIntent.current?.invalidate();
      if (identity(state) !== identity(previous)) {
        batchFillIntent.current?.invalidate(); if (sortPanelRef.current) sortPanelRef.current.invalid = true; if (filterGroupsRef.current) filterGroupsRef.current.invalid = true;
        // 模板窗口也在标签／连接切走的当下失效，同轮恢复原值不能复活旧SQL来源。
        if (queryTemplateRef.current) queryTemplateRef.current.invalid = true;
        if (selectedFilterRef.current) selectedFilterRef.current.invalid = true;
      }
      if (state.settings.resultLimit !== previous.settings.resultLimit && queryTemplateRef.current) queryTemplateRef.current.invalid = true;
    });
  }, [tab.id, tab.connectionId]);
  useEffect(() => () => foreignKeyJoinIntent.current?.invalidate(), []);
  useEffect(() => () => { pasteInsertIntent.current?.invalidate(); }, []);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selection, setSelection] = useState<{ rowId: string; key: string }>();
  const [preview, setPreview] = useState<{ view: SqlPreview & { previewId?: string; previewExpiresAt?: string }; snapshot: RecordPagePreview } | null>(null); const [previewing, setPreviewing] = useState(false); const previewingRef = useRef(false); const [applying, setApplying] = useState(false);
  const [applyTaskId, setApplyTaskId] = useState('');
  const [lastReceiptId, setLastReceiptId] = useState(''), [showReceipt, setShowReceipt] = useState(false), [commitLocked, setCommitLocked] = useState(false);
  const receiptTaskRef = useRef('');
  // 主进程关联编号用于展示；提交事实仍只来自受校验的独立回执。
  useEffect(() => window.dbark?.onTask(event => {
    if (event.taskId !== receiptTaskRef.current || !event.tableApply) return;
    setLastReceiptId(event.tableApply.operationId);
    if (event.tableApply.evidence.commitMayHaveBeenSent) setCommitLocked(true);
  }), []);
  const [referenceDialog, setReferenceDialogState] = useState<{ snapshot: ReferenceSnapshot; keys: ForeignKeyInfo[]; mode: 'choose' | 'browse' } | null>(null);
  const [childReferenceDialog, setChildReferenceDialog] = useState<ChildReferenceIntent | null>(null), childReferenceIntent = useRef<ChildReferenceIntent | null>(null);
  const [tableStatisticsDialog, setTableStatisticsDialog] = useState<TableStatisticsIntent | null>(null), tableStatisticsIntent = useRef<TableStatisticsIntent | null>(null);
  const [tableValueOptionsDialog, setTableValueOptionsDialog] = useState<{ intent: TableStatisticsIntent; column: string } | null>(null), tableValueOptionsIntent = useRef<TableStatisticsIntent | null>(null);
  /** 关联窗口即使打开后关闭，也永久推进原方案的上下文代次。 */
  function setReferenceDialog(next:typeof referenceDialog){filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();batchFillIntent.current?.invalidate();presetUiEpoch.current++;setReferenceDialogState(next);}
  const [referenceBusy, setReferenceBusy] = useState(false); const referenceCount = useRef(0);
  const grid = useRef<DataGridHandle>(null); const [showFind, setShowFind] = useState(false); const [showPreferences, setShowPreferencesState] = useState(false);
  /** 布局窗口变化同步记代，不依赖晚到的React effect或最终布尔值。 */
  function setShowPreferences(next:boolean){filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();batchFillIntent.current?.invalidate();presetUiEpoch.current++;setShowPreferencesState(next);}
  const [findFocus, setFindFocus] = useState<{ target: 'query' | 'replacement'; generation: number }>({ target: 'query', generation: 0 });
  const [preferences, setPreferences] = useState<TablePreferences>({ version: 1, columns: [] }); const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const [preferencesLoading, setPreferencesLoading] = useState(true); const [preferencesPending, setPreferencesPending] = useState(false); const preferencesLock = useRef(false);
  const [preferencesDirty, setPreferencesDirtyState] = useState(false); const [preferencesError, setPreferencesError] = useState(''); const layoutRevision = useRef(0);
  /** 同步发布布局草稿，跨标签结构操作不能在React效果到来前抢先丢弃设置。 */
  function setPreferencesDirty(dirty: boolean) { setPreferencesDirtyState(dirty); useWorkspace.getState().setTableLayoutDraft(tab.id, dirty); }
  const preferenceLifecycle = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); filteredExportIntent.current?.invalidate(); filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null; pageExportRef.current = null; queryTemplateRef.current = null; sortPanelRef.current = null; preferenceLifecycle.current++; useWorkspace.getState().setTableLayoutDraft(tab.id, false); }; }, []);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const history = useRef(new DraftHistory()).current;
  const historyEnvironment = useRef<unknown[]>([]);
  const [gridEditing, setGridEditing] = useState(false);
  const activeGridEditor = useRef<object | null>(null);
  /** 编辑器生命周期是占门依据；稳定回调避免每次输入都重新注册，卸载父页不再更新状态。 */
  const onGridEditingChange = useCallback((editor: object, editing: boolean) => {
    if (!mounted.current) return;
    if (editing) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; activeGridEditor.current = editor; setGridEditing(true); }
    else if (activeGridEditor.current === editor) { activeGridEditor.current = null; setGridEditing(false); }
  }, []);
  useEffect(() => () => history.clear(), [history]);
  const inputDirtyRef = useRef(false); const recordControllerRef = useRef<RecordViewController | null>(null); const rootElement = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  /** 所有入口同步替换同一页草稿引用，避免一次事件轮次内的迟到回调覆盖更新。 */
  function setRows(value: DraftRow[] | ((current: DraftRow[]) => DraftRow[]), mode: 'record' | 'replace' | 'replay' = 'record') {
    childReferenceIntent.current?.invalidate();
    tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate();
    filteredExportIntent.current?.invalidate();
    filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate();
    filteredSelectIntent.current?.invalidate();
    batchFillIntent.current?.invalidate();
    if (selectedFilterRef.current) selectedFilterRef.current.invalid = true;
    invalidateCopyRead();
    const next = typeof value === 'function' ? value(rowsRef.current) : value;
    if (mode === 'record') history.record(rowsRef.current, next); else if (mode === 'replace') history.clear();
    const retained = history.retainedIds();
    for (const row of next) if (copiedDraftIds.current.has(row.id)) retained.add(row.id);
    for (const id of copiedDraftIds.current) if (!retained.has(id)) copiedDraftIds.current.delete(id);
    rowsRef.current = next; setRowsState(next); useWorkspace.getState().setDirty(tab.id, collectChanges(next).length > 0 || inputDirtyRef.current);
  }
  const applyingRef = useRef(applying); applyingRef.current = applying;
  const blocked = busy || referenceBusy || !!foreignKeyJoinDialog || !!childReferenceDialog || !!tableStatisticsDialog || !!tableValueOptionsDialog || !!filteredExportDialog || !!filteredUpdateDialog || !!filteredDeleteDialog || !!filteredSelectDialog || applying || preferencesPending || previewing || !!preview || copyPending; const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const changes = useMemo(() => collectChanges(rows), [rows]);
  const loadGeneration = useRef(0);
  const recordPages = useRef(new RecordPageNavigation()).current;
  const [recordPageMessage, setRecordPageMessage] = useState({ revision: -1, text: '' });
  const loadingCount = useRef(0); const observedRefresh = useRef(refreshVersion); const [externalStale, setExternalStale] = useState(false);
  const base = useMemo(() => ({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! }), [tab.connectionId, tab.database, tab.table]);
  const savedDraftValues = [base, connection, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, filters, filterMode, filterGroup, sort, externalStale, settings.activeTabId];
  const foreignKeyJoinValues = [...savedDraftValues, tab, settings.resultLimit]; foreignKeyJoinIntent.current?.observe(foreignKeyJoinValues);
  if (draftLease.current && savedDraftValues.some((value, index) => value !== draftLease.current!.values[index])) draftLease.current.invalid = true;
  // 观察标签和连接的每次变化，切走后再切回也不能复活文件选择前的恢复授权。
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    if (state.settings.activeTabId !== previous.settings.activeTabId || state.settings.tabs.find(item => item.id === tab.id) !== previous.settings.tabs.find(item => item.id === tab.id) || state.connectionVersions[tab.connectionId] !== previous.connectionVersions[tab.connectionId] || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId)) { if (draftLease.current) draftLease.current.invalid = true; }
  }), [tab.id, tab.connectionId]);
  // 排序草稿绑定原表页及读取条件；切换后再回到相同值也不复活旧草稿。
  const sortScope = useMemo(() => ({}), [base, connectionVersion, refreshVersion, info, page, pageIndex, pageSize, sort, filters, filterMode, filterGroup, externalStale, settings.activeTabId, JSON.stringify(info?.columns.map(column => column.name))]);
  const sortScopeRef = useRef(sortScope); sortScopeRef.current = sortScope;
  const filteredExportValues = [base, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, filters, filterMode, filterGroup, sort, externalStale, settings.activeTabId];
  filteredExportIntent.current?.observe(filteredExportValues);
  const filteredSelectValues = [...filteredExportValues, settings.resultLimit, filteredSelectPage.current, selectedRows, selection];
  filteredSelectIntent.current?.observe(filteredSelectValues);
  if (sortPanelRef.current && sortPanelRef.current.scope !== sortScope) sortPanelRef.current.invalid = true;
  if (filterGroupsRef.current && filterGroupsRef.current.scope !== sortScope) filterGroupsRef.current.invalid = true;
  if (selectedFilterRef.current && selectedFilterRef.current.scope !== sortScope) selectedFilterRef.current.invalid = true;
  useEffect(() => () => { filterGroupsRef.current?.dialogs.dispose(); }, []);
  useEffect(() => () => { selectedFilterRef.current?.dialogs.dispose(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; }, []);
  const copyEnvironment = useRef<{ values: unknown[] }>({ values: [] });
  const copyValues = [base, connectionVersion, refreshVersion, info, page, info && tableCopyMetadataKey(info), page?.copyMetadataKey, page?.copySource, page?.copySource?.status === 'ready' && page.copySource.metadataKey];
  if (copyValues.some((value, index) => value !== copyEnvironment.current.values[index])) { copyEnvironment.current = { values: copyValues }; if (copyReadIntent.current) copyReadIntent.current.invalidated = true; }
  // 观察过的目标/目录/页面/布局变化使旧对话框永久失效，随后变回也不复活旧计划。
  const pasteInsertValues = [base, connectionVersion, refreshVersion, info, page, info && tableCopyMetadataKey(info), layoutRevision.current, externalStale, pageIndex, pageSize, filters, filterMode, filterGroup, sort];
  if (pasteInsertValues.some((value, index) => value !== pasteInsertEnvironment.current[index])) { pasteInsertIntent.current?.invalidate(); pasteInsertEnvironment.current = pasteInsertValues; }
  // 页面、条件、目录及连接身份只要观察过变化就清空，不允许返回旧值时复活旧历史。
  const historyValues = [base, connectionVersion, refreshVersion, info, page, info && tableCopyMetadataKey(info), externalStale, loadGeneration.current, pageIndex, pageSize, filters, filterMode, filterGroup, sort];
  if (historyValues.some((value, index) => value !== historyEnvironment.current[index])) { history.clear(); historyEnvironment.current = historyValues; }
  const recordContextRef = useRef<RecordContext>({ target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked });
  recordContextRef.current = { target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked };
  /** 代次与忙碌读取同步引用，不等待下一次渲染才能阻止旧字段输入写入新页。 */
  function getRecordContext(): RecordContext { return { ...recordContextRef.current, generation: loadGeneration.current, busy: blockedRef.current }; }
  /** 取消只请求一次并保留占门，直到实际读取收尾；已消费结果不再向完成任务发送KILL。 */
  function invalidateCopyRead() {
    const intent = copyReadIntent.current; if (!intent || intent.consumed) return;
    intent.invalidated = true; if (intent.cancelSent) return; intent.cancelSent = true;
    void invoke('query.cancel', { taskId: intent.taskId }).catch(() => undefined);
  }
  /** 本地先撤掉页/行引用，再幂等释放引擎租约；迟到页面另行按其请求连接释放。 */
  async function releaseCopySources(source = copySources.current) {
    if (source === copySources.current) { copySources.current = null; copyPage.current = null; copyRowRefs.current.clear(); }
    if (source?.source.status === 'ready') await invoke('table.copySourceRelease', { connectionId: source.connectionId, pageRef: source.source.pageRef }).catch(() => undefined);
  }
  useEffect(() => { invalidateCopyRead(); }, [base, connectionVersion, refreshVersion]);
  useEffect(() => () => { invalidateCopyRead(); if (copyPageTask.current) void invoke('query.cancel', { taskId: copyPageTask.current }).catch(() => undefined); void releaseCopySources(); }, []);
  const record = useRecordViews({ rows, getRows: () => rowsRef.current, getContext: getRecordContext, onRows: setRows, onDirty: dirty => { childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); if (dirty && selectedFilterRef.current) selectedFilterRef.current.invalid = true; if (dirty) { filteredUpdateIntent.current?.invalidate(); filteredDeleteIntent.current?.invalidate(); invalidateCopyRead(); batchFillIntent.current?.invalidate(); } inputDirtyRef.current = dirty; useWorkspace.getState().setDirty(tab.id, dirty || collectChanges(rowsRef.current).length > 0); }, onFocusGrid: () => restoreGridFocus(true) });
  recordControllerRef.current = record;
  const childReferenceValues = [base, connectionVersion, refreshVersion, info, page, rows, loadGeneration.current, pageIndex, pageSize, sort, filters, filterMode, filterGroup, externalStale, selection?.rowId, settings.activeTabId, record.dirty, record.pending, record.formOpen, gridEditing];
  childReferenceIntent.current?.observe(childReferenceValues);
  tableStatisticsIntent.current?.observe(childReferenceValues);
  tableValueOptionsIntent.current?.observe(childReferenceValues);
  const statisticsConditions = useRef({ filters, filterMode, ...(filterGroup ? { filterGroup } : {}) }); statisticsConditions.current = { filters, filterMode, ...(filterGroup ? { filterGroup } : {}) };
  const filteredSelectView = useRef({ info, page, unavailable: false });
  filteredSelectView.current = { info, page, unavailable: restoredDraftView || busy || referenceBusy || applying || preferencesPending || previewing || !!preview || copyPending || showPreferences || !!referenceDialog || externalStale || gridEditing || record.hasInput() };
  // 标签或连接切走再切回亦同步撤销，不依赖React合并后的最终值。
  useEffect(() => useWorkspace.subscribe((state, previous) => {
    const target = (value: typeof state) => JSON.stringify([value.settings.activeTabId, value.settings.tabs.find(item => item.id === tab.id), value.connectionVersions[tab.connectionId] ?? 0]);
    if (target(state) !== target(previous) || state.connections.find(item => item.id === tab.connectionId) !== previous.connections.find(item => item.id === tab.connectionId)) { childReferenceIntent.current?.invalidate(); tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); }
  }), [tab.id, tab.connectionId]);
  const batchFillValues = [...pasteInsertValues, rows, selectedRows, selection, settings.activeTabId, blocked, record.dirty, record.pending, gridEditing, showPreferences, referenceDialog];
  const filteredUpdateValues = [...filteredExportValues, record.dirty, record.pending, gridEditing, showPreferences, referenceDialog, busy, applying, previewing, preview, preferencesPending];
  filteredUpdateIntent.current?.observe(filteredUpdateValues);
  const filteredDeleteValues = [...filteredUpdateValues];
  filteredDeleteIntent.current?.observe(filteredDeleteValues);
  if (batchFillValues.some((value, index) => value !== batchFillEnvironment.current[index])) { batchFillIntent.current?.invalidate(); batchFillEnvironment.current = batchFillValues; }
  const recordPageScopeValue = { target: base, connectionVersion, refreshVersion, pageSize, filters, filterMode, filterGroup, sort };
  const recordPageScopeRef = useRef({ value: recordPageScopeValue, page: pageIndex }); recordPageScopeRef.current = { value: recordPageScopeValue, page: pageIndex };
  /** 异步完成仍读取当前工作区身份，连接版本或标签切换无需等待旧闭包更新。 */
  function getRecordPageContext(): RecordPageContext {
    const current = recordPageScopeRef.current, workspace = useWorkspace.getState(), target = current.value.target;
    const currentTab = workspace.settings.tabs.find(item => item.id === tab.id);
    return { scope: recordPageScope({ ...current.value, connectionVersion: workspace.connectionVersions[target.connectionId] ?? 0 }), page: current.page, generation: loadGeneration.current, active: workspace.settings.activeTabId === tab.id && currentTab?.connectionId === target.connectionId && currentTab.database === target.database && currentTab.table === target.table, formOpen: recordControllerRef.current?.formOpen ?? false, stale: recordContextRef.current.stale };
  }
  recordPages.observe(getRecordPageContext());
  useEffect(() => () => recordPages.cancel(), [recordPages]);
  const editable = !recordReadonlyReason({ ...getRecordContext(), busy: false });
  const visibleKeys = useMemo(() => visibleTableKeys(reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], preferences)), [page?.columns, preferences]);
  // 冻结边界和可见列使用同一真实结构调和，只标记前缀，不重排原值或读取数据库。
  const frozenKeys = useMemo(() => frozenTableKeys(reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], preferences)), [page?.columns, preferences]);
  const visibleColumns = useMemo(() => { const source = new Map(page?.columns.map(column => [column.key, column]) ?? []); return visibleKeys.map(key => source.get(key)!); }, [page?.columns, visibleKeys]);
  const pageFindContext = useRef<{ values: unknown[]; generation: number }>({ values: [], generation: 0 });
  /** 任意草稿或上下文变化都递增查找代次；应用时同步重算，不能覆盖同轮事件的新草稿。 */
  function pageFindGeneration(): number {
    const context = getRecordContext();
    const values = [rowsRef.current, context.info, context.connectionVersion, refreshVersion, context.stale, recordTargetKey(context.target), context.loaded, context.generation, pageIndex, pageSize, sort, filters, filterMode, filterGroup, visibleKeys];
    if (values.some((value, index) => value !== pageFindContext.current.values[index])) pageFindContext.current = { values, generation: pageFindContext.current.generation + 1 };
    return pageFindContext.current.generation;
  }
  useEffect(() => {
    let alive = true; preferenceLifecycle.current++; const revision = ++layoutRevision.current; setPreferencesLoading(true); setPreferencesDirty(false); setPreferencesError('');
    preferencesRef.current = { version: 1, columns: [] }; setPreferences(preferencesRef.current);
    void invoke('table.preferences.get', base).then(value => { if (alive && revision === layoutRevision.current) { const next = value ?? { version: 1 as const, columns: [] }; preferencesRef.current = next; setPreferences(next); setPreferencesError(''); } }).catch(reason => { if (alive) { setPreferencesError(errorMessage(reason)); setPreferencesDirty(true); } }).finally(() => { if (alive) setPreferencesLoading(false); });
    return () => { alive = false; };
  }, [base, connectionVersion]);
  /** 真实列新增或删除时调和偏好，不刷新数据或丢弃草稿。 */
  useEffect(() => { if (!page) return; const next = reconcileTablePreferences(page.columns.map(column => column.key), preferencesRef.current); if (JSON.stringify(next) !== JSON.stringify(preferencesRef.current)) { preferencesRef.current = next; setPreferences(next); } }, [page?.columns, preferencesLoading]);
  /** 活动身份保留列名，隐藏后移到首个可见列，重排后重新计算网格坐标。 */
  useEffect(() => {
    if (!selection || !visibleKeys.length) return;
    const rowIdx = rowsRef.current.findIndex(row => row.id === selection.rowId); if (rowIdx < 0) return;
    const key = visibleKeys.includes(selection.key) ? selection.key : visibleKeys[0]; const idx = visibleKeys.indexOf(key) + 1;
    if (key !== selection.key) setSelection({ rowId: selection.rowId, key });
    grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: false });
  }, [visibleKeys]);
  /** 使用本地行身份还原网格位置；已失效目标回到本标签工具栏，不误选另一行。 */
  function restoreGridFocus(focus: boolean) {
    const current = selectionRef.current; const rowIdx = rowsRef.current.findIndex(row => row.id === current?.rowId); const idx = current ? visibleKeys.indexOf(current.key) + 1 : -1;
    if (rowIdx >= 0 && idx > 0) grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: focus });
    else if (focus) rootElement.current?.querySelector<HTMLButtonElement>('.toolbar button:not(:disabled)')?.focus();
  }
  /** 所有本地写入口共享输入守卫；未暂存字段不能被另一个工具悄悄覆盖。 */
  function assertGridWritable() { if (record.hasInput()) throw new Error(recordViewZh.resolveInput); const reason = recordReadonlyReason(getRecordContext()); if (reason) throw new Error(reason); }
  /** 按钮与快捷键都同步核对真实工作区、输入及模态门；历史从不领取连接或执行票据。 */
  function historyAvailable(): boolean {
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
    return mounted.current && workspace.settings.activeTabId === tab.id && !!current && workspace.connections.some(item => item.id === current.connectionId) && recordTargetKey({ connectionId: current.connectionId, database: current.database ?? '', table: current.table ?? '' }) === recordTargetKey(context.target) && (workspace.connectionVersions[current.connectionId] ?? 0) === context.connectionVersion && !blockedRef.current && !loadingCount.current && !referenceCount.current && !applyingRef.current && !preferencesLock.current && !previewingRef.current && !copyPendingRef.current && !recordReadonlyReason(context) && !record.hasInput() && !record.pending && !gridEditing && !activeGridEditor.current && !showPreferences && !referenceDialog && !pasteInsertDialog && !document.querySelector('[role="dialog"]') && !rootElement.current?.querySelector('.grid-input');
  }
  /** 只重放本页RAM差异，不重新调用原操作；重建记录输入并撤销旧粘贴/查找/复制意图。 */
  function moveHistory(direction: 'undo' | 'redo') {
    if (!historyAvailable()) return;
    const next = history.move(rowsRef.current, direction); if (!next) { if (history.notice) setError(history.notice); return; }
    const recordRowId = record.draft?.rowId;
    pasteInsertIntent.current?.invalidate(); pendingPaste.current = null; recordPages.cancel(); record.reset();
    setRows(next, 'replay'); setError(''); setDuplicateNotice('');
    const liveIds = new Set(next.map(row => row.id));
    setSelectedRows(new Set([...selectedRows].filter(id => liveIds.has(id))));
    const selected = selectionRef.current;
    if (selected && !next.some(row => row.id === selected.rowId)) { selectionRef.current = undefined; setSelection(undefined); }
    const formRowId = selected?.rowId ?? recordRowId;
    if (record.formOpen && formRowId && next.some(row => row.id === formRowId)) record.select(formRowId);
    restoreGridFocus(false);
  }
  /** 布局即时生效但明确保持未保存状态，异步读取不能覆盖用户刚调整的布局。 */
  function updatePreferences(next: TablePreferences) { if (preferencesLock.current) return; layoutRevision.current++; preferencesRef.current = next; setPreferences(next); setPreferencesDirty(true); setPreferencesError(''); }
  /** 成功返回后才显示已保存，失败保持本页布局并报告未持久化。 */
  async function savePreferences(reset = false) {
    if (preferencesLock.current) return; preferencesLock.current = true; setPreferencesPending(true); setPreferencesError(''); useWorkspace.getState().setBusy(tab.id, true);
    const lifecycle = preferenceLifecycle.current; const revision = layoutRevision.current;
    try {
      const next = reset ? reconcileTablePreferences(page?.columns.map(column => column.key) ?? [], null) : preferencesRef.current;
      if (reset) await invoke('table.preferences.reset', base); else await invoke('table.preferences.save', { ...base, preferences: next });
      if (mounted.current && lifecycle === preferenceLifecycle.current) {
        if (revision === layoutRevision.current && (reset || JSON.stringify(next) === JSON.stringify(preferencesRef.current))) { preferencesRef.current = next; setPreferences(next); setPreferencesDirty(false); layoutRevision.current++; }
        else setPreferencesDirty(true);
      }
    } catch (reason) { if (mounted.current && lifecycle === preferenceLifecycle.current) { setPreferencesError(formatText(tableGridZh.saveFailed, errorMessage(reason))); setPreferencesDirty(true); } }
    finally { preferencesLock.current = false; if (mounted.current) setPreferencesPending(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); }
  }
  /** 查找按最新行身份和可见列跳转，虚拟行无需先存在于 DOM。 */
  function jumpToMatch(rowId: string, key: string, focusGrid = true) {
    recordPages.cancel();
    const rowIdx = rowsRef.current.findIndex(row => row.id === rowId), idx = visibleKeys.indexOf(key) + 1;
    if (blocked || rowIdx < 0 || idx < 1) return;
    const activate = () => { setSelection({ rowId, key }); selectionRef.current = { rowId, key }; grid.current?.scrollToCell({ rowIdx, idx }); grid.current?.setActivePosition({ rowIdx, idx }, { enableEditor: false, shouldFocus: focusGrid }); };
    if (record.formOpen) record.select(rowId, activate); else activate();
  }
  /** 网格快捷键与工具栏明确打开时发出新焦点请求，已打开的面板也能再次聚焦。 */
  function openPageFind(target: 'query' | 'replacement' = 'query') {
    if (blocked || document.querySelector('[role="dialog"]')) return;
    setShowFind(true); setFindFocus(current => ({ target, generation: current.generation + 1 }));
  }
  /** 当前页替换先核对完整快照，最后只一次写本地草稿。 */
  function applyPagePlan(plan: PageReplacement, only?: PageOccurrence, selectionToken?: unknown) {
    assertGridWritable();
    const context = getRecordContext();
    // 单处定位还须属于网格同步选中身份，用户移到另一行/列后不沿用旧Worker命令。
    if (only && (selectionToken !== selectionRef.current || selectionRef.current?.rowId !== only.rowId || selectionRef.current.key !== only.key || plan.patches.length !== 1 || plan.patches[0].rowId !== only.rowId || plan.patches[0].key !== only.key)) throw new Error(tableGridZh.changed);
    // 最后写草稿前同步复核字段、记录和连接；迟到Worker结果不能借旧渲染信息跨页或覆盖活动输入。
    if (blockedRef.current || record.dirty || rootElement.current?.querySelector('.grid-input') || !context.info || plan.patches.some(patch => { const row = rowsRef.current.find(row => row.id === patch.rowId); return !row || !visibleKeys.includes(patch.key) || recordReadonlyReason(context, row, patch.key); })) throw new Error(tableGridZh.changed);
    const next = applyPageReplacement(rowsRef.current, plan, context.info, pageFindGeneration()); setRows(next); setError(''); return next;
  }
  /** 每次加载分配代次，旧请求迟到时不能覆盖新页面或当前编辑状态。 */
  const load = useCallback(async () => {
    history.clear();
    const generation = ++loadGeneration.current; blockedRef.current = true;
    filteredSelectIntent.current?.invalidate(); filteredSelectPage.current = null;
    // 实际读取实参在第一个await前固定，不能让旧页领取后来筛选/排序的SQL草稿。
    const selectScope = recordPageScope({ target: base, connectionVersion, refreshVersion: recordPageScopeRef.current.value.refreshVersion, pageSize, filters, filterMode, filterGroup, sort });
    // 读取实参绑定当次条件；结构版本取最新值，其它旧闭包实参不能领取新条件的意图。
    const navigation = recordPages.claim({ ...getRecordPageContext(), scope: recordPageScope({ target: base, connectionVersion, refreshVersion: recordPageScopeRef.current.value.refreshVersion, pageSize, filters, filterMode, filterGroup, sort }), page: pageIndex, generation });
    invalidateCopyRead(); if (copyPageTask.current) void invoke('query.cancel', { taskId: copyPageTask.current }).catch(() => undefined);
    const sourceTaskId = uid(); copyPageTask.current = sourceTaskId;
    let pendingSource: { connectionId: string; source: TableCopyPageSources } | null = null;
    loadingCount.current++; useWorkspace.getState().setBusy(tab.id, true);
    setBusy(true); setError('');
    try {
      await releaseCopySources();
      await invoke('connections.open', { id: tab.connectionId });
      if (generation !== loadGeneration.current || !mounted.current) return;
      const settled = await Promise.allSettled([invoke('metadata.table', base), invoke('table.page', { ...base, page: pageIndex, pageSize, filters, filterMode, filterGroup, sort, copySource: true, taskId: sourceTaskId })]);
      if (settled[1].status === 'fulfilled' && settled[1].value.copySource) pendingSource = { connectionId: base.connectionId, source: settled[1].value.copySource };
      if (settled[0].status === 'rejected') throw settled[0].reason;
      const metadata = settled[0].value;
      if (settled[1].status === 'rejected') throw settled[1].reason; const data = settled[1].value;
      if (generation !== loadGeneration.current || !mounted.current) return;
      if (navigation && (data.page !== pageIndex || data.pageSize !== pageSize)) throw new Error(recordViewZh.pageChanged);
      const nextRows = data.rows.map(data => ({ id: uid(), data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }));
      copySources.current = pendingSource; copyPage.current = { page: data, target: recordTargetKey(base), connectionVersion, generation }; pendingSource = null; copyRowRefs.current.clear();
      if (data.copySource?.status === 'ready') { const refs = data.copySource.rowRefs; nextRows.forEach((row, index) => { if (refs[index]) copyRowRefs.current.set(row.id, refs[index]!); }); }
      filteredSelectPage.current = { info: metadata, page: data, scope: selectScope, generation, index: pageIndex };
      setInfo(metadata); setPage(data); setRows(nextRows, 'replace'); setRestoredDraftView(false); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; copiedDraftIds.current.clear(); setDuplicateNotice(''); recordControllerRef.current?.reset(); setExternalStale(false);
      if (navigation && recordPages.complete(navigation, getRecordPageContext(), nextRows)) setRecordPageMessage({ revision: navigation.action, text: formatText(nextRows.length ? recordViewZh.pageArrived : recordViewZh.pageEmpty, pageIndex) });
    } catch (reason) {
      if (generation === loadGeneration.current && mounted.current) {
        // 翻页/筛选已获草稿放弃确认；失败不能把旧页继续显示成新条件下的可编辑结果。
        setError(errorMessage(reason)); setPage(null); setRows([], 'replace'); setRestoredDraftView(false); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; recordControllerRef.current?.reset();
        if (navigation && recordPages.fail(navigation, getRecordPageContext())) setRecordPageMessage({ revision: navigation.action, text: formatText(recordViewZh.pageFailed, pageIndex) });
      }
    }
    finally {
      if (pendingSource) await releaseCopySources(pendingSource);
      if (copyPageTask.current === sourceTaskId) copyPageTask.current = undefined;
      loadingCount.current = Math.max(0, loadingCount.current - 1); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); if (generation === loadGeneration.current && mounted.current) setBusy(false);
    }
  }, [base, pageIndex, pageSize, filters, filterMode, filterGroup, sort, tab.connectionId, connectionVersion]);
  const observedConnection = useRef({ target: recordTargetKey(base), version: connectionVersion });
  useEffect(() => {
    const changed = observedConnection.current.target !== recordTargetKey(base) || observedConnection.current.version !== connectionVersion;
    observedConnection.current = { target: recordTargetKey(base), version: connectionVersion };
    // 正常编辑连接已由上层保护；仍防御外部版本改变静默丢弃两层草稿。
    if (changed && (collectChanges(rowsRef.current).length || recordControllerRef.current?.hasInput())) { loadGeneration.current++; setExternalStale(true); return; }
    void load(); return () => { loadGeneration.current++; };
  }, [load]);
  /** 仅同目标的完成版本触发刷新；未知结果或有草稿时明确过期，绝不自动丢数据。 */
  useEffect(() => {
    const action = columnPageRefreshAction(observedRefresh.current, refreshVersion, refreshAutomatically, blocked, changes.length > 0 || record.dirty);
    if (action === 'ignore' || action === 'wait') return;
    observedRefresh.current = refreshVersion;
    if (action === 'reload') void load(); else setExternalStale(true);
  }, [refreshVersion, refreshAutomatically, blocked, changes.length, record.dirty, load]);
  useEffect(() => { setPageJump(String(pageIndex)); }, [pageIndex]);
  useEffect(() => { useWorkspace.getState().setDirty(tab.id, changes.length > 0 || record.dirty); }, [tab.id, changes.length, record.dirty]);
  useEffect(() => () => useWorkspace.getState().setDirty(tab.id, false), [tab.id]);
  /** 翻页、排序或刷新前先确认是否允许丢弃本页尚未提交的草稿。 */
  /** 保存和恢复都绑定原页；文件成功不清除数据库dirty，恢复从不自动提交。 */
  function openSavedDraft(mode: 'save' | 'restore') {
    if (tableReadAction.current !== tableReadRender || draftLease.current || !editable || !info || !page || !connection || blockedRef.current || gridEditing || record.hasInput() || record.pending || showPreferences || referenceDialog || document.querySelector('[role="dialog"]') || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    if (mode === 'restore' && collectChanges(rowsRef.current).length) { setError(savedDraftText.existing); return; }
    try {
      const payload = mode === 'save' ? captureTableDraft(rowsRef.current, base, info) : undefined;
      const lease: TableDraftLease = { mode, ...(payload ? { payload } : {}), info, page, rows: rowsRef.current, generation: loadGeneration.current, invalid: false, values: savedDraftValues };
      draftLease.current = lease; blockedRef.current = true; referenceCount.current++; setReferenceBusy(true); useWorkspace.getState().setBusy(tab.id, true); setDraftDialog(lease); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 原文件或核验回包过期时保留父页全部数据，只有原租约能一次性发布独立草稿。 */
  function assertSavedDraft(lease: TableDraftLease) {
    const state = useWorkspace.getState();
    if (!mounted.current || draftLease.current !== lease || lease.invalid || state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion || lease.rows !== rowsRef.current || lease.info !== recordContextRef.current.info || lease.generation !== loadGeneration.current || recordContextRef.current.stale || activeGridEditor.current || record.hasInput()) throw Error(savedDraftText.stale);
  }
  /** 独立草稿只显示保存的变更行；清空旧分页来源，不按当前页位置覆盖任何记录。 */
  function acceptSavedDraft(lease: TableDraftLease, document: TableDraftDocument) {
    assertSavedDraft(lease);
    if (collectChanges(rowsRef.current).length || lease.mode !== 'restore') throw Error(savedDraftText.existing);
    const restored = restoreTableDraftRows(document, lease.info, uid);
    const inserted = new Set(restored.filter(row => row.inserted).map(row => row.id));
    assertCopiedRecordKeys(restored, lease.info, inserted);
    recordPages.cancel(); record.reset(); void releaseCopySources(); filteredSelectPage.current = null;
    copiedDraftIds.current = inserted;
    setPage({ ...lease.page, rows: restored.flatMap(row => row.original ? [structuredClone(row.original)] : []), hasMore: false, copySource: undefined });
    setRows(restored, 'replace'); setRestoredDraftView(true); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; setDuplicateNotice(''); setError('');
  }
  /** 占门持续到子窗口的原文件操作或核验全部结算，关闭后才允许刷新或退出。 */
  function closeSavedDraft(lease: TableDraftLease) {
    if (draftLease.current !== lease) return;
    lease.invalid = true; draftLease.current = null; setDraftDialog(null);
    referenceCount.current = Math.max(0, referenceCount.current - 1); setReferenceBusy(referenceCount.current > 0);
    useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current);
  }
  function reloadBlocked():boolean {
    return !!(blockedRef.current||showPreferences||document.querySelector('[role="dialog"]')||referenceCount.current>0||referenceDialog);
  }
  /** 同一个丢稿确认入口在确认前后核原来源；confirm期间的导航或ABA不能授权后继页。 */
  function confirmPageReload(guard: () => boolean = () => !reloadBlocked()): boolean {
    if (!guard()) return false;
    if ((collectChanges(rowsRef.current).length || record.hasInput()) && !window.confirm(recordViewZh.discardPage)) return false;
    return guard();
  }
  function canReload(selectedFilterOwner?: TableSelectedFilterLease) {
    if (!confirmPageReload()) return false;
    // 普通翻页／排序／条件操作在排队渲染前撤销旧提案；仅本提案自身留给确认后二次核验。
    if (!selectedFilterOwner && selectedFilterRef.current) selectedFilterRef.current.invalid = true;
    recordPages.cancel(); record.reset(); return true;
  }
  /** 跨页只在整页无输入/草稿时发起；不复用会询问丢弃的普通翻页入口。 */
  function navigateRecordPage(direction: -1 | 1) {
    const result = recordPages.begin(getRecordPageContext(), { rows: rowsRef.current, rowId: record.draft?.rowId, key: selectionRef.current?.key ?? visibleKeys[0] ?? info?.columns[0]?.name ?? '', direction, hasMore: !!page?.hasMore, busy: blockedRef.current || showPreferences || !!document.querySelector('[role="dialog"]') || referenceCount.current > 0, inputDirty: record.hasInput() || !!rootElement.current?.querySelector('.grid-input') });
    if (result.kind !== 'ready') {
      if (result.kind !== 'busy') setRecordPageMessage({ revision: recordPages.revision, text: result.kind === 'dirty' ? recordViewZh.pageDirty : recordViewZh.pageUnavailable });
      return;
    }
    // 同步锁住连点并清除旧页展示；真正读取仍由原 pageIndex -> load 流程负责一次。
    blockedRef.current = true; setBusy(true); record.reset(); setPage(null); setRows([], 'replace'); setSelectedRows(new Set()); selectionRef.current = undefined; setSelection(undefined);
    setRecordPageMessage({ revision: result.ticket.action, text: formatText(recordViewZh.pageLoading, result.ticket.page) }); setPageIndex(result.ticket.page);
  }
  // 新页DOM提交后、绘制前选中目标，避免反向跨页先展示网格默认首行。
  useLayoutEffect(() => {
    const target = recordPages.consume(getRecordPageContext(), rowsRef.current, record.hasInput(), blocked);
    if (target) { const key = visibleKeys.includes(target.key) ? target.key : visibleKeys[0]; if (key) jumpToMatch(target.rowId, key, false); }
  }, [page, rows, blocked, record.formOpen, connectionVersion, settings.activeTabId, visibleKeys]);
  const references = info && selection ? referencesForColumn(info, selection.key) : { keys: [], error: '' };
  const relatedKeys = references.keys;
  const referenceRow = rows.find(row => row.id === selection?.rowId);
  const copyMetadataReason = recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source);
  const copySourceReady = !copyMetadataReason && recordCopySourceReady(getRecordContext(), referenceRow, copySources.current?.source, referenceRow ? copyRowRefs.current.get(referenceRow.id) : undefined);
  /** 捕获整行草稿及页面代次，多外键在关联窗口内明确选择约束。 */
  function openReference(mode: 'choose' | 'browse') {
    if (blocked || referenceDialog || !info || !selection || !relatedKeys.length) return;
    if (record.hasInput()) { setError(recordViewZh.resolveInput); return; }
    const row = rowsRef.current.find(item => item.id === selection.rowId);
    if (!row || row.deleted || (mode === 'choose' && !relatedKeys.some(key => referenceWritable(info, key)))) return;
    setReferenceDialog({ mode, keys: structuredClone(relatedKeys), snapshot: { rowId: row.id, data: structuredClone(row.data), foreignKey: structuredClone(relatedKeys[0]), source: structuredClone(info), generation: loadGeneration.current } });
  }
  /** 父→子入口不依赖所选字段的正向外键，也不提交或清除已暂存父表草稿。 */
  function openChildReferences() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || childReferenceIntent.current || !connection || info?.objectKind !== 'table' || !page || !selectionRef.current || externalStale || gridEditing || record.hasInput() || document.querySelector('[role="dialog"]')) return;
    const row = rowsRef.current.find(item => item.id === selectionRef.current!.rowId);
    if (!row || row.deleted || row.inserted) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: ChildReferenceIntent;
    intent = new ChildReferenceIntent(source, row.id, row.data, childReferenceValues, () => {
      const state = useWorkspace.getState(), currentRow = rowsRef.current.find(item => item.id === row.id);
      return mounted.current && childReferenceIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && currentRow === row && !row.deleted && selectionRef.current?.rowId === row.id && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(row.data) === JSON.stringify(intent.data) && recordPageSource.current === originalPage;
    });
    childReferenceIntent.current = intent; batchFillIntent.current?.invalidate(); presetUiEpoch.current++; setChildReferenceDialog(intent);
  }
  const recordPageSource = useRef(page); recordPageSource.current = page;
  /** 对话框只有原请求实际结算后才关闭，旧实例不能关闭后来的关联窗口。 */
  function closeChildReferences(intent: ChildReferenceIntent) { if (childReferenceIntent.current !== intent) return; intent.invalidate(); childReferenceIntent.current = null; presetUiEpoch.current++; setChildReferenceDialog(null); }
  /** 统计不要求活动行；冻结服务器筛选且保留本地草稿，表和视图均使用同一只读入口。 */
  function openTableStatistics() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || tableStatisticsIntent.current || !connection || !info || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput() || document.querySelector('[role="dialog"]')) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, originalSelection = selectionRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: TableStatisticsIntent;
    intent = new TableStatisticsIntent(source, statisticsConditions.current, childReferenceValues, () => {
      const state = useWorkspace.getState();
      return mounted.current && tableStatisticsIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && selectionRef.current === originalSelection && recordPageSource.current === originalPage && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
    });
    tableStatisticsIntent.current = intent; batchFillIntent.current?.invalidate(); presetUiEpoch.current++; setTableStatisticsDialog(intent);
  }
  /** 原窗口原任务结算后才关闭；旧关闭回调不能关闭后续统计实例。 */
  function closeTableStatistics(intent: TableStatisticsIntent) { if (tableStatisticsIntent.current !== intent) return; intent.invalidate(); tableStatisticsIntent.current = null; presetUiEpoch.current++; setTableStatisticsDialog(null); }
  /** 候选绑定原页、原条件和连接；读取不碰父草稿，也不要求活动行。 */
  function openTableValueOptions() {
    if (tableReadAction.current !== tableReadRender || blockedRef.current || tableValueOptionsIntent.current || !connection || !info || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput() || document.querySelector('[role="dialog"]') || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    const column = info.columns.find(item => item.name === selectionRef.current?.key && tableValueOptionsColumnCapability(item.type) !== 'unsupported') ?? info.columns.find(item => tableValueOptionsColumnCapability(item.type) !== 'unsupported');
    if (!column) return;
    const source = info, originalPage = page, originalRows = rowsRef.current, originalSelection = selectionRef.current, generation = loadGeneration.current, version = connectionVersion, profile = connection;
    const currentTab = JSON.stringify(useWorkspace.getState().settings.tabs.find(item => item.id === tab.id));
    let intent: TableStatisticsIntent;
    intent = new TableStatisticsIntent(source, statisticsConditions.current, childReferenceValues, () => {
      const state = useWorkspace.getState();
      return mounted.current && tableValueOptionsIntent.current === intent && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === currentTab && state.connections.find(item => item.id === tab.connectionId) === profile && (state.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && loadGeneration.current === generation && rowsRef.current === originalRows && selectionRef.current === originalSelection && recordPageSource.current === originalPage && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
    });
    tableValueOptionsIntent.current = intent; batchFillIntent.current?.invalidate(); presetUiEpoch.current++; setTableValueOptionsDialog({ intent, column: column.name });
  }
  /** 原读取结算后的关闭只处理自己的窗口，不释放后继实例。 */
  function closeTableValueOptions(intent: TableStatisticsIntent) {
    if (tableValueOptionsIntent.current !== intent) return;
    intent.invalidate(); tableValueOptionsIntent.current = null; presetUiEpoch.current++; setTableValueOptionsDialog(null);
  }
  /** 只为自己唯一的空闲模态放行丢稿确认，其他作业、弹窗或新页均拒绝。 */
  function valueOptionsReloadReady(intent: TableStatisticsIntent, modal: Element): boolean {
    const body = document.querySelector('[data-table-value-options-dialog]');
    return tableValueOptionsIntent.current === intent && intent.current() && body?.closest('[role="dialog"]') === modal && document.querySelectorAll('[role="dialog"]').length === 1 && !document.querySelector('[role="alertdialog"]') && !busy && !referenceBusy && !referenceCount.current && !childReferenceDialog && !tableStatisticsDialog && !applyingRef.current && !preferencesPending && !preferencesLock.current && !previewingRef.current && !preview && !copyPendingRef.current && !showPreferences && !referenceDialog && !externalStale;
  }
  /** 确认后一次接纳整份服务器条件，保持原排序；重置输入放在最终来源门之后。 */
  function applyTableValueOptions(intent: TableStatisticsIntent, conditions: TableValueOptionsConditions): boolean {
    const modal = document.querySelector('[data-table-value-options-dialog]')?.closest('[role="dialog"]');
    if (!modal || !valueOptionsReloadReady(intent, modal) || !info) return false;
    const next = validateTablePresetColumns({ filters: [...conditions.filters], filterMode: conditions.filterMode, ...(conditions.filterGroup ? { filterGroup: conditions.filterGroup } : {}), sort }, info.columns.map(column => column.name));
    if (!confirmPageReload(() => valueOptionsReloadReady(intent, modal))) return false;
    // 无await，先消费原实例再改变条件；reset的失效通知不再撤销已接纳的同一份筛选。
    closeTableValueOptions(intent); setFilters(next.filters); setFilterMode(next.filterMode); setFilterGroup(next.filterGroup); setPageIndex(1); setShowFilter(true);
    recordPages.cancel(); record.reset(); return true;
  }
  /** 请求已关闭窗口后仍占用标签，直到服务器请求实际结束才释放。 */
  const referenceActivity = useCallback((delta: 1 | -1) => {
    presetUiEpoch.current++;
    referenceCount.current = Math.max(0, referenceCount.current + delta); setReferenceBusy(referenceCount.current > 0);
    useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current);
  }, [tab.id]);
  /** 使用最新行状态一次写入完整外键草稿，不更改 original 或调用提交。 */
  function applyReference(values: CellValue[], source: TableInfo, key: ForeignKeyInfo, expected: ForeignKeyInfo, clear: boolean) {
    if (record.hasInput()) throw new Error(recordViewZh.resolveInput);
    const readonly = recordReadonlyReason({ ...getRecordContext(), busy: false }); if (readonly) throw new Error(readonly);
    if (!referenceDialog || applyingRef.current) throw new Error(referenceZh.changed);
    const next = patchReferenceRow(rowsRef.current, { ...referenceDialog.snapshot, foreignKey: expected }, loadGeneration.current, source, key, values, clear);
    setRows(next); setError('');
  }
  /** 条件变更始终从第一页读取，取消草稿确认时不更改任何已应用条件。 */
  const presetApplyScope=useRef<{base:typeof base;connectionVersion:number;refreshVersion:number;info:TableInfo;rows:DraftRow[];generation:number;uiEpoch:number;dialogs:ReturnType<typeof createPresetDialogGuard>}|null>(null);
  useEffect(()=>()=>{presetApplyScope.current?.dialogs.dispose();presetApplyScope.current=null;},[]);
  /** 先沿原丢稿确认入口授权读取；记录原页对象，晚回包不能清掉后来新增的编辑。 */
  function preparePresetApply():boolean {
    presetApplyScope.current?.dialogs.dispose();presetApplyScope.current=null;
    if(!info||externalStale||activeGridEditor.current||!canReload())return false;
    presetApplyScope.current={base,connectionVersion,refreshVersion,info,rows:rowsRef.current,generation:loadGeneration.current,uiEpoch:presetUiEpoch.current,dialogs:createPresetDialogGuard(document)};return true;
  }
  /** 整份恢复条件、组合和排序，只触发现有表页读取，不调用写SQL或改动草稿历史。 */
  function applyNamedPreset(configuration:TablePresetConfiguration):boolean {
    const original=presetApplyScope.current;presetApplyScope.current=null;
    if(!original)return false;
    const dialogsCurrent=original.dialogs.current();original.dialogs.dispose();
    // 晚回包只做无副作用检查；不重调会确认丢稿/清输入的canReload，不清后来窗口。
    if(!dialogsCurrent||original.uiEpoch!==presetUiEpoch.current||reloadBlocked())return false;
    if(!mounted.current||!original||original.base!==base||original.connectionVersion!==connectionVersion||original.refreshVersion!==refreshVersion||original.info!==info||original.rows!==rowsRef.current||original.generation!==loadGeneration.current||blockedRef.current||externalStale||record.hasInput()||activeGridEditor.current)return false;
    const next=validateTablePresetColumns(configuration,info!.columns.map(column=>column.name));
    setFilters(next.filters);setFilterMode(next.filterMode);setFilterGroup(next.filterGroup);setSort(next.sort);setPageIndex(1);return true;
  }
  let cellFilterAvailable = !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && !changes.length && !!info && !!page && !!selection;
  if (cellFilterAvailable) { try { tableCellFilterDraft(info!.columns, rows, visibleKeys, selection); } catch { cellFilterAvailable = false; } }
  /** 快捷入口只预填手工条件；既有添加条件仍负责丢稿确认和服务器分页，不自动查询或提交。 */
  function stageCellFilter(exclude: boolean): void {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id);
    if (tableReadAction.current !== tableReadRender || !mounted.current || !cellFilterAvailable || selectionRef.current !== selection || reloadBlocked() || activeGridEditor.current || record.hasInput() || collectChanges(rowsRef.current).length || state.settings.activeTabId !== tab.id || current?.connectionId !== tab.connectionId || current?.database !== tab.database || current?.table !== tab.table || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    try { setCellFilterSeed(tableCellFilterDraft(info!.columns, rowsRef.current, visibleKeys, selection, exclude)); setShowFilter(true); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const selectedFilterAvailable = !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && !!info && !!page && !!selection && visibleKeys.includes(selection.key) && selectedRows.size > 0 && !selectedFilter;
  /** 只冻结当前列的原勾选值及完整旧条件；预览不确认丢稿，也不读取服务器。 */
  function openSelectedFilter(exclude: boolean): void {
    const state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !selectedFilterAvailable || selectedFilterRef.current || selectionRef.current !== selection || selectedRowsRef.current !== selectedRows || reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    try {
      const proposal = buildTableSelectedFilter({ columns: info!.columns, rows: rowsRef.current, visible: visibleKeys, selection, selected: selectedRowsRef.current, conditions: statisticsConditions.current, exclude });
      presetUiEpoch.current++;
      const lease: TableSelectedFilterLease = { proposal, fingerprint: JSON.stringify(proposal), metadata: tableCopyMetadataKey(info!), scope: sortScope, rows: rowsRef.current, selected: selectedRowsRef.current, selection: selection!, generation: loadGeneration.current, layout: layoutRevision.current, epoch: presetUiEpoch.current, profile: connection, tab: JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)), invalid: false, dialogs: createPresetDialogGuard(document) };
      selectedFilterRef.current = lease; setSelectedFilter(lease); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 页、列、原值、勾选或连接变化即永久失效；原提案不能借后来相同值恢复授权。 */
  function selectedFilterCurrent(lease: TableSelectedFilterLease): boolean {
    let valid = false;
    try {
      const state = useWorkspace.getState();
      valid = mounted.current && selectedFilterRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && rowsRef.current === lease.rows && selectedRowsRef.current === lease.selected && selectionRef.current === lease.selection && loadGeneration.current === lease.generation && layoutRevision.current === lease.layout && presetUiEpoch.current === lease.epoch && state.settings.activeTabId === tab.id && JSON.stringify(state.settings.tabs.find(item => item.id === tab.id)) === lease.tab && state.connections.find(item => item.id === tab.connectionId) === lease.profile && (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion && !!info && tableCopyMetadataKey(info) === lease.metadata && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !externalStale && !reloadBlocked() && lease.dialogs.current();
      if (valid) valid = JSON.stringify(buildTableSelectedFilter({ columns: info!.columns, rows: rowsRef.current, visible: visibleKeys, selection: selectionRef.current, selected: selectedRowsRef.current, conditions: statisticsConditions.current, exclude: lease.proposal.exclude })) === lease.fingerprint;
    } catch {}
    if (!valid) lease.invalid = true;
    return valid;
  }
  /** 完整条件与原排序一次发布；沿原丢稿确认，取消时保留面板、草稿及当前页。 */
  function applySelectedFilter(lease: TableSelectedFilterLease): boolean {
    if (!selectedFilterCurrent(lease)) throw Error(selectedFilterText.unavailable);
    const next = validateTablePresetColumns({ filters: lease.proposal.filters, filterMode: lease.proposal.filterMode, filterGroup: lease.proposal.filterGroup, sort }, info!.columns.map(column => column.name));
    if (!canReload(lease)) return false;
    if (!selectedFilterCurrent(lease)) throw Error(selectedFilterText.unavailable);
    closeSelectedFilter(lease); setFilters(next.filters); setFilterMode(next.filterMode); setFilterGroup(next.filterGroup); setPageIndex(1); setShowFilter(true); return true;
  }
  /** 只关闭本次预览，迟到的旧取消不触及后继勾选值提案。 */
  function closeSelectedFilter(lease: TableSelectedFilterLease): void {
    if (selectedFilterRef.current !== lease) return;
    lease.invalid = true; lease.dialogs.dispose(); selectedFilterRef.current = null; presetUiEpoch.current++; setSelectedFilter(null);
  }
  const pageExportAvailable = !restoredDraftView && !blocked && !preferencesLoading && !externalStale && !gridEditing && !record.dirty && !record.pending && !changes.length && !!info && !!page && !!visibleKeys.length;
  const filteredExportAvailable = !restoredDraftView && !blocked && !externalStale && !gridEditing && !record.hasInput() && !preferencesPending && !!connection && !!info && !!page && ['table', 'view'].includes(info.objectKind ?? '');
  /** 独立全量入口冻结已应用服务器条件和原页身份，保留本地数据草稿，不借用当前页样本。 */
  function openFilteredExport(): void {
    const state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !filteredExportAvailable || filteredExportIntent.current || !info || !page || !connection || reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id) return;
    const source = info, originalRows = rowsRef.current, originalPage = page, generation = loadGeneration.current, profile = connection, version = connectionVersion, scope = sortScopeRef.current;
    const currentTab = JSON.stringify(state.settings.tabs.find(item => item.id === tab.id));
    let intent: TableFilteredExportIntent;
    try {
      intent = new TableFilteredExportIntent(base, source, statisticsConditions.current, sort, filteredExportValues, () => {
        const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"]');
        return mounted.current && filteredExportIntent.current === intent && now.settings.activeTabId === tab.id && JSON.stringify(now.settings.tabs.find(item => item.id === tab.id)) === currentTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && recordContextRef.current.info === source && rowsRef.current === originalRows && recordPageSource.current === originalPage && loadGeneration.current === generation && sortScopeRef.current === scope && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !externalStale && !preferencesLock.current && dialogs.length <= 1 && !document.querySelector('[role="alertdialog"]') && JSON.stringify(source) === JSON.stringify(intent.source) && JSON.stringify(statisticsConditions.current) === JSON.stringify(intent.conditions);
      });
      filteredExportIntent.current = intent; batchFillIntent.current?.invalidate(); presetUiEpoch.current++; setFilteredExportDialog(intent);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 只有原文件选择/导出及取消均结算后的关闭，才能释放自己的窗口。 */
  function closeFilteredExport(intent: TableFilteredExportIntent): void {
    if (filteredExportIntent.current !== intent) return;
    intent.invalidate(); filteredExportIntent.current = null; presetUiEpoch.current++; setFilteredExportDialog(null);
  }
  /** 打开时投影并冻结本页快照；旧选择／标签／连接或活动编辑器不能误导出新页，不发数据库请求。 */
  function exportTablePage(selected: boolean): void {
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === tab.id);
    if (tableReadAction.current !== tableReadRender || pageExportRef.current || !mounted.current || !pageExportAvailable || preferencesLock.current || reloadBlocked() || activeGridEditor.current || record.hasInput() || collectChanges(rowsRef.current).length || state.settings.activeTabId !== tab.id || current?.connectionId !== tab.connectionId || current?.database !== tab.database || current?.table !== tab.table || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion || selectedRowsRef.current !== selectedRows) return;
    try { const lease = { data: snapshotTablePageExport(page!, rowsRef.current, visibleKeys, selected ? selectedRows : undefined), selected }; pageExportRef.current = lease; setSelectedRows(new Set()); setPageExport(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 同步比对实际已完成读取的来源，覆盖新条件已渲染但加载effect尚未开始的窗口。 */
  function filteredSelectReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current || filteredSelectView.current.unavailable) return false;
    const context = getRecordPageContext(), current = filteredSelectView.current;
    try { return context.active && !context.stale && context.scope === source.scope && context.page === source.index && context.generation === source.generation && current.info === source.info && current.page === source.page && source.info.database === base.database && source.info.name === base.table && (source.page.copyMetadataKey === undefined || source.page.copyMetadataKey === tableCopyMetadataKey(source.info)); } catch { return false; }
  }
  const filteredSelectAvailable = !restoredDraftView && !!onOpenGeneratedQuery && !!connection && !blocked && !gridEditing && !record.hasInput() && (connection.dialect === 'mysql' || connection.dialect === 'mariadb') && filteredSelectReadReady();
  /** 独立修改租约只核已完成读取的准确scope，自身任务占用不能被误判成外来加载。 */
  function filteredUpdateReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current) return false;
    const context=getRecordPageContext(), current=recordContextRef.current;
    try{return context.active&&!context.stale&&context.scope===source.scope&&context.page===source.index&&context.generation===source.generation&&current.info===source.info&&recordPageSource.current===source.page&&source.info.database===base.database&&source.info.name===base.table&&(source.page.copyMetadataKey===undefined||source.page.copyMetadataKey===tableCopyMetadataKey(source.info));}catch{return false;}
  }
  const filteredUpdateAvailable = !restoredDraftView && !!connection && !blocked && !externalStale && !gridEditing && !record.hasInput() && !record.pending && !changes.length && !!info && !!tableFilteredUpdateColumns(info).length && filteredUpdateReadReady();
  /** 开门不询问丢稿、不提交已有稿；全部筛选行与当前页勾选填充是两条独立用途。 */
  function openFilteredUpdate():void {
    const source=filteredSelectPage.current,state=useWorkspace.getState();
    if(tableReadAction.current!==tableReadRender||!filteredUpdateAvailable||filteredUpdateIntent.current||!filteredUpdateReadReady(source)||reloadBlocked()||activeGridEditor.current||record.hasInput()||collectChanges(rowsRef.current).length||state.settings.activeTabId!==tab.id||state.settings.tabs.find(item=>item.id===tab.id)!==tab||state.connections.find(item=>item.id===tab.connectionId)!==connection||(state.connectionVersions[tab.connectionId]??0)!==connectionVersion)return;
    const originalRows=rowsRef.current,originalTab=state.settings.tabs.find(item=>item.id===tab.id),profile=connection,version=connectionVersion,scope=sortScopeRef.current;
    let intent:TableFilteredUpdateIntent;
    try{
      intent=new TableFilteredUpdateIntent(base,source.info,{...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort},filteredUpdateValues,()=>{
        const now=useWorkspace.getState(),dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        return mounted.current&&filteredUpdateIntent.current===intent&&filteredUpdateReadReady(source)&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===originalTab&&now.connections.find(item=>item.id===tab.connectionId)===profile&&(now.connectionVersions[tab.connectionId]??0)===version&&rowsRef.current===originalRows&&sortScopeRef.current===scope&&!activeGridEditor.current&&!recordControllerRef.current?.hasInput()&&!collectChanges(rowsRef.current).length&&!preferencesLock.current&&!previewingRef.current&&!applyingRef.current&&dialogs.length<=1&&(!dialogs.length||!!dialogs[0].querySelector('[data-table-filtered-update-dialog]'))&&tableCopyMetadataKey(source.info)===intent.metadataKey&&JSON.stringify({...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort})===JSON.stringify(intent.scope);
      });
      filteredUpdateIntent.current=intent;batchFillIntent.current?.invalidate();presetUiEpoch.current++;setFilteredUpdateDialog(intent);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 原任务与取消/预览释放均已终结后才到达这里；只在原scope仍有效时刷新原页。 */
  function closeFilteredUpdate(intent:TableFilteredUpdateIntent,result?:TableFilteredUpdateApplyOutput):void {
    if(filteredUpdateIntent.current!==intent)return;
    const refresh=!!result&&result.commitAcknowledged&&result.outcome==='committed'&&intent.current()&&!collectChanges(rowsRef.current).length&&!recordControllerRef.current?.hasInput();
    intent.invalidate();filteredUpdateIntent.current=null;setFilteredUpdateDialog(null);presetUiEpoch.current++;
    if(refresh)void load();
  }
  function filteredDeleteReadReady(source = filteredSelectPage.current): source is TableFilteredSelectPage {
    if (!source || source !== filteredSelectPage.current || !mounted.current) return false;
    const context=getRecordPageContext(), current=recordContextRef.current;
    try{return context.active&&!context.stale&&context.scope===source.scope&&context.page===source.index&&context.generation===source.generation&&current.info===source.info&&recordPageSource.current===source.page&&source.info.database===base.database&&source.info.name===base.table&&(source.page.copyMetadataKey===undefined||source.page.copyMetadataKey===tableCopyMetadataKey(source.info));}catch{return false;}
  }
  const filteredDeleteAvailable = !restoredDraftView && !!connection && !blocked && !externalStale && !gridEditing && !record.hasInput() && !record.pending && !changes.length && !!info && tableFilteredDeleteAvailable(info) && filteredDeleteReadReady();
  /** 删除入口不询问丢稿、不混入当前页勾选；完整服务器快照只在明确确认后提交。 */
  function openFilteredDelete():void {
    const source=filteredSelectPage.current,state=useWorkspace.getState();
    if(tableReadAction.current!==tableReadRender||!filteredDeleteAvailable||filteredDeleteIntent.current||!filteredDeleteReadReady(source)||reloadBlocked()||activeGridEditor.current||record.hasInput()||collectChanges(rowsRef.current).length||state.settings.activeTabId!==tab.id||state.settings.tabs.find(item=>item.id===tab.id)!==tab||state.connections.find(item=>item.id===tab.connectionId)!==connection||(state.connectionVersions[tab.connectionId]??0)!==connectionVersion)return;
    const originalRows=rowsRef.current,originalTab=state.settings.tabs.find(item=>item.id===tab.id),profile=connection,version=connectionVersion,scope=sortScopeRef.current;
    let intent:TableFilteredDeleteIntent;
    try{
      intent=new TableFilteredDeleteIntent(base,source.info,{...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort},filteredDeleteValues,()=>{
        const now=useWorkspace.getState(),dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
        return mounted.current&&filteredDeleteIntent.current===intent&&filteredDeleteReadReady(source)&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===originalTab&&now.connections.find(item=>item.id===tab.connectionId)===profile&&(now.connectionVersions[tab.connectionId]??0)===version&&rowsRef.current===originalRows&&sortScopeRef.current===scope&&!activeGridEditor.current&&!recordControllerRef.current?.hasInput()&&!collectChanges(rowsRef.current).length&&!preferencesLock.current&&!previewingRef.current&&!applyingRef.current&&dialogs.length<=1&&(!dialogs.length||!!dialogs[0].querySelector('[data-table-filtered-delete-dialog]'))&&tableCopyMetadataKey(source.info)===intent.metadataKey&&JSON.stringify({...statisticsConditions.current,sort:recordPageScopeRef.current.value.sort})===JSON.stringify(intent.scope);
      });
      filteredDeleteIntent.current=intent;batchFillIntent.current?.invalidate();presetUiEpoch.current++;setFilteredDeleteDialog(intent);setError('');
    }catch(reason){setError(errorMessage(reason));}
  }
  /** 原任务与取消/预览释放均已终结后才到达这里；只在原scope仍有效时刷新原页。 */
  function closeFilteredDelete(intent:TableFilteredDeleteIntent,result?:TableFilteredDeleteApplyOutput):void {
    if(filteredDeleteIntent.current!==intent)return;
    const refresh=!!result&&result.commitAcknowledged&&result.outcome==='committed'&&intent.current()&&!collectChanges(rowsRef.current).length&&!recordControllerRef.current?.hasInput();
    intent.invalidate();filteredDeleteIntent.current=null;setFilteredDeleteDialog(null);presetUiEpoch.current++;
    if(refresh)void load();
  }
  /** 独立入口冻结完整已应用范围；不确认丢稿、不取当前页行值、不发IPC。 */
  function openFilteredSelect(): void {
    const source = filteredSelectPage.current, state = useWorkspace.getState();
    if (tableReadAction.current !== tableReadRender || !filteredSelectAvailable || filteredSelectIntent.current || !filteredSelectReadReady(source) || reloadBlocked() || activeGridEditor.current || record.hasInput() || state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.settings.resultLimit !== settings.resultLimit || state.connections.find(item => item.id === tab.connectionId) !== connection || (state.connectionVersions[tab.connectionId] ?? 0) !== connectionVersion) return;
    const originalRows = rowsRef.current, originalSelected = selectedRowsRef.current, originalSelection = selectionRef.current, version = connectionVersion, profile = connection, scope = sortScopeRef.current, originalTab = state.settings.tabs.find(item => item.id === tab.id), limit = state.settings.resultLimit;
    let intent: TableFilteredSelectIntent;
    try {
      intent = new TableFilteredSelectIntent(source.info, { ...statisticsConditions.current, sort }, limit, filteredSelectValues, () => {
        const now = useWorkspace.getState(), dialogs = document.querySelectorAll('[role="dialog"]');
        return mounted.current && filteredSelectIntent.current === intent && filteredSelectReadReady(source) && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === originalTab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && now.settings.resultLimit === limit && rowsRef.current === originalRows && selectedRowsRef.current === originalSelected && selectionRef.current === originalSelection && sortScopeRef.current === scope && !activeGridEditor.current && !recordControllerRef.current?.hasInput() && !preferencesLock.current && dialogs.length <= 1 && !document.querySelector('[role="alertdialog"]') && tableCopyMetadataKey(source.info) === intent.metadata && JSON.stringify({ ...statisticsConditions.current, sort: recordPageScopeRef.current.value.sort }) === JSON.stringify(intent.readScope);
      });
      filteredSelectIntent.current = intent; onQueryTemplateNavigation?.(); setFilteredSelectDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 打开前按同一字段顺序重新生成并逐字核验；无await地消费一次后才建立未执行草稿。 */
  function openFilteredSelectQuery(intent: TableFilteredSelectIntent, sql: string, kind: TableQueryTemplateKind, options?: TableQueryTemplateOptions): boolean {
    if (filteredSelectIntent.current !== intent || kind !== 'SELECT' || !options || !onOpenGeneratedQuery || !intent.current()) return false;
    const dialogs = document.querySelectorAll('[role="dialog"]'), body = document.querySelector('[data-table-filtered-select-dialog]');
    if (dialogs.length !== 1 || !body || dialogs[0].querySelector('[data-table-filtered-select-dialog]') !== body || document.querySelector('[role="alertdialog"]')) { intent.invalidate(); return false; }
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(filteredSelectText.tabs);
    if (intent.compile(options.columns).sql !== sql || !intent.current() || !intent.consume()) return false;
    filteredSelectIntent.current = null; setFilteredSelectDialog(null); onQueryTemplateNavigation?.();
    onOpenGeneratedQuery({ kind: 'query', title: filteredSelectText.queryTitle(intent.info.name), connectionId: tab.connectionId, ...queryDatabasePatch({ state: 'known', database: intent.info.database }), sql }); return true;
  }
  /** 原窗口取消只清自己的租约，父行草稿、勾选、当前页和服务器均保持。 */
  function closeFilteredSelect(intent: TableFilteredSelectIntent): void {
    if (filteredSelectIntent.current !== intent) return;
    intent.invalidate(); filteredSelectIntent.current = null; setFilteredSelectDialog(null); onQueryTemplateNavigation?.();
  }
  const templateAvailable = !!onOpenGeneratedQuery && !!info && !blocked && !externalStale && !gridEditing && !record.dirty && !record.pending && (connection?.dialect === 'mysql' || connection?.dialect === 'mariadb');
  let foreignKeyJoinAvailable = templateAvailable && info?.objectKind === 'table';
  if (foreignKeyJoinAvailable) { try { foreignKeyJoinAvailable = foreignKeyJoinChoices(info!).length > 0; } catch { foreignKeyJoinAvailable = false; } }
  /** JOIN只消费真实FK结构；已有暂存草稿、选行、筛选排序都留在原表页。 */
  function openForeignKeyJoin(): void {
    if (!foreignKeyJoinAvailable || tableReadAction.current !== tableReadRender || foreignKeyJoinIntent.current || reloadBlocked() || activeGridEditor.current || record.hasInput()) return;
    const state = useWorkspace.getState(), source = info!, version = connectionVersion, profile = connection, generation = loadGeneration.current, refresh = refreshVersion, limit = settings.resultLimit;
    if (state.settings.activeTabId !== tab.id || state.settings.tabs.find(item => item.id === tab.id) !== tab || state.activeJobs[tab.id] || state.connections.find(item => item.id === tab.connectionId) !== profile) return;
    try {
      let intent: TableForeignKeyJoinIntent;
      intent = new TableForeignKeyJoinIntent(source, tab.connectionId, limit, foreignKeyJoinValues, () => {
        const now = useWorkspace.getState(), own = foreignKeyJoinBusy.current;
        return mounted.current && foreignKeyJoinIntent.current === intent && now.settings.activeTabId === tab.id && now.settings.tabs.find(item => item.id === tab.id) === tab && now.connections.find(item => item.id === tab.connectionId) === profile && (now.connectionVersions[tab.connectionId] ?? 0) === version && now.settings.resultLimit === limit && refreshVersion === refresh && loadGeneration.current === generation && recordContextRef.current.info === source && !recordContextRef.current.stale && !recordControllerRef.current?.hasInput() && !activeGridEditor.current && !loadingCount.current && !applyingRef.current && !previewingRef.current && !preferencesLock.current && !copyPendingRef.current && (!now.activeJobs[tab.id] || !!own?.acquiring || !!own?.lease?.owns()) && foreignKeyJoinMetadataKey(source) === intent.metadataKey;
      });
      foreignKeyJoinIntent.current = intent; onQueryTemplateNavigation?.(); setForeignKeyJoinDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 独占busy世代只认可本次原operation；别人覆盖同true时也失效，旧释放不清后来作业。 */
  const foreignKeyJoinActivity = useCallback((delta: 1 | -1) => {
    if (delta === 1) {
      if (foreignKeyJoinBusy.current || referenceCount.current || useWorkspace.getState().activeJobs[tab.id]) throw Error(tableForeignKeyJoinZh.stale);
      const own = { lease: undefined as WorkspaceBusyLease | undefined, acquiring: true, releasing: false }; foreignKeyJoinBusy.current = own;
      try { own.lease = acquireWorkspaceBusy(tab.id); referenceCount.current++; setReferenceBusy(true); }
      catch (reason) { foreignKeyJoinBusy.current = null; foreignKeyJoinIntent.current?.invalidate(); throw reason; }
      finally { own.acquiring = false; }
    } else {
      const own = foreignKeyJoinBusy.current; if (!own) return;
      own.releasing = true;
      if (!own.lease?.release()) foreignKeyJoinIntent.current?.invalidate();
      if (foreignKeyJoinBusy.current === own) foreignKeyJoinBusy.current = null;
      referenceCount.current = Math.max(0, referenceCount.current - 1); setReferenceBusy(referenceCount.current > 0);
    }
  }, [tab.id]);
  /** 正式结构前置核验完成后同步消费一次，独立查询明确绑定子库且不继承原表草稿。 */
  function openForeignKeyJoinQuery(intent: TableForeignKeyJoinIntent, preview: ForeignKeyJoinPreview): boolean {
    if (foreignKeyJoinIntent.current !== intent || !onOpenGeneratedQuery || !intent.current() || activeGridEditor.current || record.hasInput()) return false;
    if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(tableForeignKeyJoinZh.tabs);
    const sql = intent.consume(preview);
    foreignKeyJoinIntent.current = null; setForeignKeyJoinDialog(null); onQueryTemplateNavigation?.();
    onOpenGeneratedQuery({ kind: 'query', title: tableForeignKeyJoinZh.queryTitle(intent.source.name), connectionId: intent.connectionId, ...queryDatabasePatch({ state: 'known', database: intent.source.database }), sql }); return true;
  }
  /** 关闭只移除已完成原异步收尾的那个窗口，不能放行旧读取或撤掉后来窗口。 */
  function closeForeignKeyJoin(intent: TableForeignKeyJoinIntent): void { if (foreignKeyJoinIntent.current === intent) { intent.invalidate(); foreignKeyJoinIntent.current = null; setForeignKeyJoinDialog(null); onQueryTemplateNavigation?.(); } }
  /** 模板只消费结构；已暂存数据草稿留在原表页，不进入SQL或新查询。 */
  function openQueryTemplate(): void {
    if (!templateAvailable || tableReadAction.current !== tableReadRender || queryTemplateRef.current || reloadBlocked() || activeGridEditor.current || record.hasInput() || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try { const lease: TableQueryTemplateLease = { info: info!, metadata: tableQueryTemplateMetadataKey(info!), tab, version: connectionVersion, refresh: refreshVersion, generation: loadGeneration.current, limit: settings.resultLimit, invalid: false }; queryTemplateRef.current = lease; onQueryTemplateNavigation?.(); setQueryTemplate(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 模板的表、结构、连接修订、页代次和默认上限都固定；一次失效不因恢复原值复活。 */
  function queryTemplateCurrent(lease: TableQueryTemplateLease): boolean {
    if (lease.invalid || queryTemplateRef.current !== lease) return false;
    const state = useWorkspace.getState(), current = state.settings.tabs.find(item => item.id === lease.tab.id);
    let valid = false;
    try { valid = mounted.current && !blockedRef.current && !externalStale && current === lease.tab && current.kind === 'table' && state.settings.activeTabId === current.id && (state.connectionVersions[current.connectionId] ?? 0) === lease.version && refreshVersion === lease.refresh && loadGeneration.current === lease.generation && state.settings.resultLimit === lease.limit && info === lease.info && info.database === base.database && info.name === base.table && tableQueryTemplateMetadataKey(info) === lease.metadata; } catch {}
    if (!valid) lease.invalid = true; return valid;
  }
  /** 新查询仅持有生成SQL和明确默认库，保留表页／草稿；不继承查询来源或会话。 */
  function openGeneratedQuery(lease: TableQueryTemplateLease, sql: string, kind: TableQueryTemplateKind, options?: TableQueryTemplateOptions): boolean {
    if (!queryTemplateCurrent(lease) || !onOpenGeneratedQuery || activeGridEditor.current || record.hasInput()) return false;
    try {
      if (useWorkspace.getState().settings.tabs.length >= 100) throw Error(templateText.tabs);
      if (buildTableQueryTemplate(lease.info, kind, lease.limit, options).sql !== sql) throw Error(templateText.changed);
      queryTemplateRef.current = null; setQueryTemplate(null); onQueryTemplateNavigation?.();
      onOpenGeneratedQuery({ kind: 'query', title: templateText.queryTitle(lease.info.name, kind), connectionId: lease.tab.connectionId, ...queryDatabasePatch({ state: 'known', database: lease.info.database }), sql }); return true;
    } catch (reason) { setError(errorMessage(reason)); throw reason; }
  }
  /** 旧窗口关闭只能结束自己，不能移除后来打开的模板。 */
  function closeQueryTemplate(lease: TableQueryTemplateLease): void { if (queryTemplateRef.current === lease) { queryTemplateRef.current = null; setQueryTemplate(null); onQueryTemplateNavigation?.(); } }
  const sortPanelAvailable = !!info && !!page && !blocked && !externalStale && !gridEditing && !record.pending;
  /** 只打开当前排序的独立草稿，不确认丢弃数据，也不重新读取服务器。 */
  function openSortPanel(): void {
    if (tableReadAction.current !== tableReadRender) return;
    if (sortPanelRef.current) { closeSortPanel(sortPanelRef.current); return; }
    if (!sortPanelAvailable || reloadBlocked() || activeGridEditor.current || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try { const columns = info!.columns.map(column => column.name), lease: TableSortLease = { scope: sortScope, columns, sort: validateTableSort(sort, columns), invalid: false }; sortPanelRef.current = lease; setSortPanel(lease); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 旧父渲染、连接／标签ABA、页和筛选变化均不能应用到后继表页。 */
  function sortPanelCurrent(lease: TableSortLease): boolean {
    const valid = mounted.current && tableReadAction.current === tableReadRender && sortPanelRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && useWorkspace.getState().settings.activeTabId === tab.id && !reloadBlocked() && !externalStale && !activeGridEditor.current;
    if (!valid) lease.invalid = true; return valid;
  }
  /** 与列头共用正式排序规则，明确应用后复用原分页加载及草稿确认。 */
  function applySortPanel(lease: TableSortLease, next: SortRule[]): boolean {
    if (!sortPanelCurrent(lease)) throw Error(sortText.stale);
    const checked = validateTableSort(next, info!.columns.map(column => column.name));
    if (JSON.stringify(checked) === JSON.stringify(sort)) { closeSortPanel(lease); return true; }
    if (!canReload()) return false;
    if (!sortPanelCurrent(lease)) throw Error(sortText.stale);
    closeSortPanel(lease); setSort(checked); setPageIndex(1); return true;
  }
  /** 取消只撤销自己的排序草稿，原页数据和已应用规则保持。 */
  function closeSortPanel(lease: TableSortLease): void { if (sortPanelRef.current === lease) { sortPanelRef.current = null; setSortPanel(null); } }
  /** 组合器只编辑原条件的逻辑关系，打开不确认丢稿、不重新查询。 */
  function openFilterGroups(): void {
    if (tableReadAction.current !== tableReadRender || filterGroupsRef.current || !filters.length || !info || !page || externalStale || reloadBlocked() || activeGridEditor.current || useWorkspace.getState().settings.activeTabId !== tab.id) return;
    try {
      const lease: TableFilterGroupLease = { scope: sortScope, filters, mode: filterMode, initial: validateFilterGroup(filters, filterMode, filterGroup), invalid: false, dialogs: createPresetDialogGuard(document) };
      presetUiEpoch.current++; filterGroupsRef.current = lease; setFilterGroups(lease);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 条件、页、目标、外部窗口和工作区变化后永久撤销，取消仍可关闭原面板。 */
  function filterGroupsCurrent(lease: TableFilterGroupLease): boolean {
    const valid = mounted.current && filterGroupsRef.current === lease && !lease.invalid && lease.scope === sortScopeRef.current && useWorkspace.getState().settings.activeTabId === tab.id && lease.dialogs.current() && !reloadBlocked() && !externalStale && !activeGridEditor.current;
    if (!valid) lease.invalid = true;
    return valid;
  }
  /** 完整树先校验；用户拒绝丢草稿时保留面板、原条件、排序和当前页。 */
  function applyFilterGroups(lease: TableFilterGroupLease, next: FilterGroup): boolean {
    if (!filterGroupsCurrent(lease)) throw Error(groupText.stale);
    const checked = validateFilterGroup(lease.filters, next.mode, next)!;
    if (JSON.stringify(checked) === JSON.stringify(filterGroup ?? { mode: filterMode, children: filters.map((_, index) => index) })) { closeFilterGroups(lease); return true; }
    if (!canReload()) return false;
    if (!filterGroupsCurrent(lease)) throw Error(groupText.stale);
    closeFilterGroups(lease); setFilterGroup(checked); setFilterMode(checked.mode); setPageIndex(1); return true;
  }
  /** 只关闭自己的组合器，旧取消不能清除后来创建的分组。 */
  function closeFilterGroups(lease: TableFilterGroupLease): void {
    if (filterGroupsRef.current !== lease) return;
    lease.dialogs.dispose(); presetUiEpoch.current++; filterGroupsRef.current = null; setFilterGroups(null);
  }
  function changeFilters(next: FilterRule[]): boolean {
    if (!mounted.current || tableReadAction.current !== tableReadRender || externalStale || useWorkspace.getState().settings.activeTabId !== tab.id) return false;
    const nextGroup = tableFilterGroupAfterChange(filters, next, filterGroup, filterMode);
    if (!canReload()) return false;
    setFilters(next); setFilterGroup(nextGroup); setPageIndex(1); return true;
  }
  /** 全部与任一是整组规则的组合方式，切换也必须通过当前页草稿保护。 */
  function changeFilterMode(next: FilterMode): boolean {
    if (!mounted.current || tableReadAction.current !== tableReadRender || externalStale || useWorkspace.getState().settings.activeTabId !== tab.id) return false;
    if (next === filterMode) return true;
    if (!canReload()) return false;
    setFilterGroup(tableFilterGroupWithMode(filterGroup, next)); setFilterMode(next); setPageIndex(1); return true;
  }
  /** 页码可指向空页；只检查接口范围，不用当前页的 hasMore 推测总页数。 */
  function jumpToPage() {
    // 恢复视图不领取服务器分页；旧渲染闭包也不能沿用恢复前残留的页码。
    if (tableReadAction.current !== tableReadRender || restoredDraftView || busy || applying) return;
    try { const target = parsePageJump(pageJump); if (target !== pageIndex && canReload()) { setError(''); setPageIndex(target); } }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const columns = useMemo<Column<DraftRow>[]>(() => [SelectColumn, ...visibleColumns.map<Column<DraftRow>>(column => ({
    key: column.key, name: column.name, minWidth: 64, maxWidth: 2000, width: preferences.columns.find(item => item.name === column.key)?.width ?? 165, frozen: frozenKeys.includes(column.key), resizable: true, sortable: true, draggable: true,
    // 组件的editable同时控制粘贴派发；只读判断保持不变，二进制另在文本入口拦截。
    editable: row => !record.dirty && !recordReadonlyReason(getRecordContext(), row, column.key),
    renderEditCell: props => <TextCellEditor {...props} onEditingChange={onGridEditingChange} binary={isBinaryCell(ownCell(props.row.data, column.key), info?.columns.find(item => item.name === column.key)?.type)}/>,
    renderHeaderCell: () => <span className="data-header">{info?.primaryKey.includes(column.key) && <KeyRound size={11}/>}<span>{column.name}<small className="column-type">{column.type}</small></span></span>,
    renderCell: ({ row, tabIndex }) => { const value = ownCell(row.data, column.key); return <DataTypeColor enabled={settings.dataTypeColors === true} selected={tabIndex === 0 || selectedRows.has(row.id)} value={value} type={settings.dataTypeColors === true ? catalogColorType(info?.columns, column.key) : undefined} source="catalog" className={value === null ? 'null-value' : value === undefined ? 'default-value' : ''} title={value === undefined ? zh.common.defaultValue : cellPreview(value)}>{value === undefined ? zh.common.defaultValue : cellPreview(value)}</DataTypeColor>; }
  }))], [visibleColumns, preferences, frozenKeys, editable, info, blocked, record.dirty, externalStale, settings.dataTypeColors, settings.dataTypeColors === true ? selectedRows : null]);
  /** 刷新后网格可能保留同一活动坐标；点击也须用当前行同步选择，不能只等待坐标变化。 */
  function selectCurrentCell(row: DraftRow | undefined, key: string | undefined) {
    // 先永久撤销旧意图；忙碌时忽略新选择也不能让切走再切回的回包复活。
    if (selectionRef.current?.rowId !== row?.id || selectionRef.current?.key !== key) { invalidateCopyRead(); batchFillIntent.current?.invalidate(); }
    if (selectionRef.current?.rowId !== row?.id) childReferenceIntent.current?.invalidate();
    if (selectionRef.current?.rowId !== row?.id || selectionRef.current?.key !== key) { tableStatisticsIntent.current?.invalidate(); tableValueOptionsIntent.current?.invalidate(); if (selectedFilterRef.current) selectedFilterRef.current.invalid = true; }
    if (blocked || document.querySelector('[role="dialog"]')) return;
    // 失去有效坐标时先同步撤销选择令牌，迟到预览不能抢在React渲染前写入。
    if (!row || !key || !page?.columns.some(column => column.key === key) || !rowsRef.current.some(current => current.id === row.id)) { selectionRef.current = undefined; setSelection(undefined); return; }
    const activate = () => {
      // 同坐标重复通知复用令牌；同步引用与React状态共用同一对象，重渲染不制造选择变化。
      const current = selectionRef.current;
      const next = current?.rowId === row.id && current.key === key ? current : { rowId: row.id, key };
      selectionRef.current = next; setSelection(next);
    };
    if (record.formOpen && !record.select(row.id, activate)) restoreGridFocus(false); else if (!record.formOpen) activate();
  }
  /** 数据网格先返回当前行，再统一替换整个矩阵，避免多行粘贴被默认单行更新覆盖。 */
  function changeRows(updated: DraftRow[]) { try { assertGridWritable(); setRows(acceptGridDrafts(rowsRef.current, rows, pendingPaste.current ?? updated)); } catch (reason) { setError(errorMessage(reason)); } finally { pendingPaste.current = null; } }
  /** 新增使用同一草稿 UUID；表单已打开时可立即编辑该新增记录。 */
  function addRow() {
    try { assertGridWritable(); const row = newDraftRow(uid()); setRows(current => [...current, row]); const key = visibleKeys[0]; if (key) { selectionRef.current = { rowId: row.id, key }; setSelection(selectionRef.current); } if (record.formOpen) record.select(row.id); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 再读工作区同步状态，不让关闭标签、切换目标或未暂存输入借旧回调追加草稿。 */
  function assertPasteInsertTarget() {
    assertGridWritable();
    const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
    if (!mounted.current || workspace.settings.activeTabId !== tab.id || !current || !workspace.connections.some(item => item.id === current.connectionId) || recordTargetKey({ connectionId: current.connectionId, database: current.database ?? '', table: current.table ?? '' }) !== recordTargetKey(context.target) || (workspace.connectionVersions[current.connectionId] ?? 0) !== context.connectionVersion || record.dirty || rootElement.current?.querySelector('.grid-input')) throw Error(pasteInsertZh.changed);
  }
  function openPasteInsert() {
    try {
      assertPasteInsertTarget(); if (document.querySelector('[role="dialog"]')) return;
      const intent = new PasteInsertIntent(rowsRef.current, getRecordContext(), visibleKeys);
      pasteInsertIntent.current?.invalidate(); pasteInsertIntent.current = intent; setPasteInsertDialog(intent); setError('');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  function closePasteInsert(intent: PasteInsertIntent) {
    intent.invalidate(); if (pasteInsertIntent.current !== intent) return;
    pasteInsertIntent.current = null; setPasteInsertDialog(null);
  }
  /** 只一次发布整批本地草稿；键冲突及最终权限仍复用原集中preview/apply。 */
  function stagePasteInsert(intent: PasteInsertIntent, plan: PasteInsertPlan) {
    assertPasteInsertTarget(); if (pasteInsertIntent.current !== intent) throw Error(pasteInsertZh.changed);
    const result = intent.consume(plan, rowsRef.current, getRecordContext(), uid);
    result.ids.forEach(id => copiedDraftIds.current.add(id));
    setRows(result.rows); setError(''); setDuplicateNotice(pasteInsertZh.staged); closePasteInsert(intent);
  }
  /** 复用原活动页/输入门；仅允许本弹窗存在，其他模态、忙碌或迟到回调均不能发布。 */
  function assertBatchFillTarget() {
    assertPasteInsertTarget();
    if (useWorkspace.getState().activeJobs[tab.id] || observedRefresh.current !== refreshVersion || blockedRef.current || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || activeGridEditor.current || record.pending || showPreferences || referenceDialog || pasteInsertDialog) throw Error(recordBatchFillZh.changed);
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    if (dialogs.length > 1 || dialogs.some(dialog => dialog.getAttribute('aria-label') !== recordBatchFillZh.title)) throw Error(recordBatchFillZh.changed);
  }
  function openBatchFill() {
    try { assertBatchFillTarget(); if (rows !== rowsRef.current || selectedRows !== selectedRowsRef.current || selection !== selectionRef.current || document.querySelector('[role="dialog"]')) throw Error(recordBatchFillZh.changed); const intent = new BatchFillIntent(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, page); batchFillIntent.current?.invalidate(); batchFillIntent.current = intent; setBatchFillDialog(intent); setError(''); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  function closeBatchFill(intent: BatchFillIntent) { intent.invalidate(); if (batchFillIntent.current === intent) { batchFillIntent.current = null; setBatchFillDialog(null); } }
  /** 无await且只setRows一次；原history、SQL预览及集中提交链保持唯一写入路径。 */
  function stageBatchFill(intent: BatchFillIntent, assignments: readonly BatchFillAssignment[]) {
    try { assertBatchFillTarget(); if (batchFillIntent.current !== intent) throw Error(recordBatchFillZh.changed); }
    catch (reason) { intent.invalidate(); throw reason; }
    const next = intent.consumeAssignments(assignments, rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, page);
    const changed = next.filter((row, index) => row !== rowsRef.current[index]).length;
    setRows(next); recordPages.cancel(); record.reset(); setError(''); setDuplicateNotice(changed ? formatText(recordBatchFillZh.staged, changed) : recordBatchFillZh.unchanged); closeBatchFill(intent);
  }
  /** 点击时同步核对活动页和输入占门；IPC 只携带此刻的已加载原值，不等待补取或推断目标。 */
  function copyRowsAsInsert(selected: boolean) {
    try {
      const workspace = useWorkspace.getState(), current = workspace.settings.tabs.find(item => item.id === tab.id), context = getRecordContext();
      if (!mounted.current || workspace.settings.activeTabId !== tab.id || !current || !workspace.connections.some(item => item.id === current.connectionId) || current.connectionId !== context.target.connectionId || current.database !== context.target.database || current.table !== context.target.table || (workspace.connectionVersions[current.connectionId] ?? 0) !== context.connectionVersion || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || insertCopyBlockedRef.current || record.hasInput() || record.dirty || inputDirtyRef.current || activeGridEditor.current || rootElement.current?.querySelector('.grid-input')) throw Error(copyInsertSqlZh.busy);
      const ids = selected ? selectedRowsRef.current : new Set(selectionRef.current ? [selectionRef.current.rowId] : []);
      const input = prepareCopyInsertSql(context, copyPage.current, page, rowsRef.current, ids);
      setError(''); setDuplicateNotice('');
      // 无其他 await：主进程同步消费这个点击快照，迟到回包只影响提示，不再写第二次。
      const environment = copyEnvironment.current;
      void invoke('table.copyInsertSql', input).then(() => { if (mounted.current && copyEnvironment.current === environment) setDuplicateNotice(copyInsertSqlZh.copied); }, reason => { if (mounted.current && copyEnvironment.current === environment) setError(errorMessage(reason)); });
    } catch (reason) { setError(errorMessage(reason)); }
  }
  // 捕获本次勾选和页面身份；观察过的页/目标变化即使恢复原值，也不能复活旧按钮。
  const batchDuplicateScope = { rows, selectedRows, page, source: page?.copySource, metadata: page?.copyMetadataKey, environment: copyEnvironment.current, revision: recordPages.revision };
  /** 批量复制只接受完整当前页，先整批验证，再一次发布历史和新增键保护。 */
  function duplicateSelectedRows() {
    try {
      assertPasteInsertTarget(); recordPages.observe(getRecordPageContext());
      if (insertCopyBlockedRef.current || blockedRef.current || loadingCount.current || referenceCount.current || applyingRef.current || preferencesLock.current || previewingRef.current || copyPendingRef.current || activeGridEditor.current || document.querySelector('[role="dialog"]')) throw Error(recordViewZh.resolveInput);
      if (batchDuplicateScope.rows !== rowsRef.current || batchDuplicateScope.selectedRows !== selectedRowsRef.current || batchDuplicateScope.page !== copyPage.current?.page || batchDuplicateScope.source !== copyPage.current?.page.copySource || batchDuplicateScope.metadata !== copyPage.current?.page.copyMetadataKey || batchDuplicateScope.environment !== copyEnvironment.current || batchDuplicateScope.revision !== recordPages.revision) throw Error(recordDuplicateZh.batchSource);
      const result = duplicateSelectedRecordDrafts(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, batchDuplicateScope.page, uid);
      for (const id of result.ids) copiedDraftIds.current.add(id);
      setRows(result.rows); setError(''); setDuplicateNotice(formatText(recordDuplicateZh.batchStaged, result.ids.length));
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 完整本地行直接复制；缺列只可沿本页引擎租约补取，不猜测DEFAULT。 */
  function duplicateCurrentRow() {
    try {
      assertGridWritable();
      if (blockedRef.current || record.dirty || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordViewZh.resolveInput);
      const metadataReason = recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source); if (metadataReason) throw new Error(metadataReason);
      const row = rowsRef.current.find(item => item.id === selectionRef.current?.rowId);
      if (recordDuplicateReadonlyReason(getRecordContext(), row) && recordCopySourceReady(getRecordContext(), row, copySources.current?.source, row ? copyRowRefs.current.get(row.id) : undefined)) { void readCompleteCopySource(); return; }
      const newId = uid();
      const next = duplicateRecordDraft(rowsRef.current, selectionRef.current?.rowId, getRecordContext(), newId);
      copiedDraftIds.current.add(newId); setRows(next); setError(''); setDuplicateNotice(recordDuplicateZh.staged);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 第一个await前占门并捕获意图；成功只追加一次，取消后等服务器实际收尾再解锁。 */
  async function readCompleteCopySource() {
    if (copyPendingRef.current) return;
    const sourcePage = copyPage.current;
    let intent: RecordCopyReadIntent;
    try {
      assertGridWritable();
      const metadataReason = recordCopyMetadataReason(getRecordContext(), sourcePage, copySources.current?.source); if (metadataReason) throw new Error(metadataReason);
      if (record.hasInput() || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordViewZh.resolveInput);
      const rowId = selectionRef.current?.rowId; if (!rowId) throw new Error(recordCopySourceZh.unavailable);
      intent = beginRecordCopyRead(rowsRef.current, rowId, getRecordContext(), selectionRef.current, copySources.current?.source, copyRowRefs.current.get(rowId), uid());
    } catch (reason) { setError(errorMessage(reason)); return; }
    copyReadIntent.current = intent; copyPendingRef.current = true; blockedRef.current = true; setCopyPending(true); setError(''); setDuplicateNotice(recordCopySourceZh.reading); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const result = await invoke('table.copySourceRead', { connectionId: base.connectionId, taskId: intent.taskId, pageRef: intent.source.pageRef, rowRef: intent.rowRef });
      if (!mounted.current || copyPage.current !== sourcePage || recordCopyMetadataReason(getRecordContext(), copyPage.current, copySources.current?.source) || copyReadIntent.current !== intent || recordControllerRef.current?.hasInput() || rootElement.current?.querySelector('.grid-input') || document.querySelector('[role="dialog"]')) throw new Error(recordCopySourceZh.unavailable);
      // 本操作的占门不算外部忙碌；其余同步门与完整来源守卫仍必须全部通过。
      const context = { ...getRecordContext(), busy: loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || previewingRef.current || !!preview };
      const newId = uid(), next = consumeRecordCopyRead(intent, rowsRef.current, context, selectionRef.current, copySources.current?.source, copyRowRefs.current.get(intent.row.id), result, newId);
      copiedDraftIds.current.add(newId); setRows(next); setError(''); setDuplicateNotice(formatText(recordCopySourceZh.completed, result.readAt));
    } catch (reason) { if (mounted.current && copyReadIntent.current === intent) { setError(errorMessage(reason)); setDuplicateNotice(''); } }
    finally {
      if (copyReadIntent.current === intent) { copyReadIntent.current = null; copyPendingRef.current = false; if (mounted.current) setCopyPending(false); }
      blockedRef.current = loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || previewingRef.current || !!preview || copyPendingRef.current;
      useWorkspace.getState().setBusy(tab.id, blockedRef.current);
    }
  }
  /** 删除选中记录仅形成草稿，仍须预览并提交后才影响数据库。 */
  function deleteSelected() {
    try { assertGridWritable(); } catch (reason) { setError(errorMessage(reason)); return; }
    const targets = selectedRows.size ? selectedRows : new Set(selection ? [selection.rowId] : []);
    setRows(current => current.map(row => targets.has(row.id) ? { ...row, deleted: !row.deleted } : row));
  }
  /** 勾选记录时复制整行，否则复制当前单元格；文本和类型化内容同时写入剪贴板。 */
  function copyCells({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    if (!selectedRows.size && !(page?.columns.some(item => item.key === column.key))) return;
    const matrix = selectedRows.size ? rows.filter(item => selectedRows.has(item.id)).map(item => visibleKeys.map(key => ownCell(item.data, key))) : [[ownCell(row.data, column.key)]];
    event.preventDefault();
    try { const content = encodeClipboard(matrix); event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData(cellClipboardType, content.typed); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 原生粘贴事件提供内容，完全不依赖被禁用的浏览器剪贴板权限。 */
  function pasteClipboard({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    event.preventDefault(); pendingPaste.current = null;
    if (!editable || blocked || referenceDialog) return row;
    if (record.hasInput()) { setError(recordViewZh.resolveInput); return row; }
    try {
      const values = decodeClipboard(event.clipboardData.getData(cellClipboardType), event.clipboardData.getData('text/plain'));
      const updated = pasteCells(rows, visibleKeys, row.id, column.key, values, new Set(info!.columns.filter(item => item.generated).map(item => item.name)));
      pendingPaste.current = updated; setError(''); return updated.find(item => item.id === row.id)!;
    } catch (reason) { setError(errorMessage(reason)); return row; }
  }
  /** 普通编辑仍由网格处理；二进制保留原复制粘贴，仅将文本输入和IME交回专用查看器边界。 */
  function handleGridKeyDown(args: CellKeyDownArgs<DraftRow>, event: CellKeyboardEvent) {
    const composing = tableCellKeyIsComposing(event.nativeEvent);
    if (args.mode !== 'ACTIVE') {
      // EDIT态的Enter也会被网格自动提交；组合输入只取消网格行为，原生输入仍继续。
      if (composing) event.preventGridDefault();
      return;
    }
    if (blocked || document.querySelector('[role=dialog]')) return;
    const { row: activeRow, column: activeColumn } = args;
    if (!activeRow || !activeColumn) return;
    const binary = isBinaryCell(ownCell(activeRow.data, activeColumn.key), info?.columns.find(item => item.name === activeColumn.key)?.type);
    if (binary && blocksBinaryTextInput(event)) event.preventGridDefault();
    // 二进制不进入普通编辑器；TEXT保留原生IME输入，但组合事件不能触发查看、查找、清空或预览。
    if (composing) { if (binary) event.preventGridDefault(); return; }
    const target = event.target;
    const historyAction = draftHistoryKey(event, target instanceof HTMLElement && !!target.closest('[role="grid"]') && !target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor'));
    if (historyAction) {
      event.preventGridDefault(); event.preventDefault(); moveHistory(historyAction); return;
    }
    if ((event.ctrlKey || event.metaKey) && ['f', 'h'].includes(event.key.toLowerCase()) && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable=true]'))) {
      event.preventGridDefault(); event.preventDefault(); openPageFind(event.key.toLowerCase() === 'h' ? 'replacement' : 'query');
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && binary) {
      event.preventGridDefault(); event.preventDefault(); record.openCell(activeRow.id, activeColumn.key);
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && changes.length) {
      event.preventGridDefault(); event.preventDefault(); void makePreview();
    } else if (event.key === 'Delete') {
      event.preventGridDefault(); event.preventDefault();
      const context = getRecordContext(), field = context.info?.columns.find(item => item.name === activeColumn.key), currentRow = rowsRef.current.find(row => row.id === activeRow.id);
      // 清空与编辑/粘贴共享当前列资格；缺结构、迟到行和记录输入不能被快捷键绕过。
      if (!editable || record.dirty || record.hasInput() || !field || currentRow !== activeRow || !page?.columns.some(item => item.key === activeColumn.key) || recordReadonlyReason(context, currentRow, activeColumn.key)) return;
      const value = field.nullable ? null : isBinaryCell(ownCell(currentRow.data, activeColumn.key), field.type) ? { type: 'binary' as const, base64: '' } : '';
      setRows(current => current.map(row => row.id === activeRow.id ? { ...row, data: { ...row.data, [activeColumn.key]: value } } : row));
    }
  }
  /** 单元格弹窗也使用相同 UUID、代次与输入缓冲，关闭不会无提示丢稿。 */
  function editCell() { if (selection && !blockedRef.current) record.openCell(selection.rowId, selection.key); }
  /** 固定预览草稿与代次；先处理输入，且在第一个 await 前阻止重复读取和后续编辑。 */
  async function makePreview(afterInputConfirmation = false) {
    if (previewingRef.current || applyingRef.current || preview || referenceCount.current > 0 || (!afterInputConfirmation && document.querySelector('[role="dialog"]'))) return;
    if (record.hasInput()) { record.request(() => void makePreview(true)); return; }
    let snapshot: RecordPagePreview;
    try { const context = getRecordContext(); snapshot = captureRecordPagePreview(rowsRef.current, context); if (!snapshot.changes.length) return; assertCopiedRecordKeys(snapshot.rows, context.info!, copiedDraftIds.current); }
    catch (reason) { setError(errorMessage(reason)); return; }
    previewingRef.current = true; blockedRef.current = true; setPreviewing(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const view = await invoke('table.preview', { ...base, changes: snapshot.changes });
      if (snapshot.rows !== rowsRef.current || snapshot.generation !== loadGeneration.current || snapshot.connectionVersion !== recordContextRef.current.connectionVersion || recordContextRef.current.stale) throw new Error(recordViewZh.previewChanged);
      setPreview({ view: snapshot.rows.some(row => copiedDraftIds.current.has(row.id) && row.inserted && !row.deleted) ? { ...view, warnings: [...view.warnings, recordDuplicateZh.previewHint] } : view, snapshot });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { previewingRef.current = false; setPreviewing(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current || copyPendingRef.current); }
  }
  /** 最终确认同步消耗一次投递机会，异常、取消及未知提交结果都不自动重放。 */
  async function apply() {
    if (!preview || applyingRef.current || previewingRef.current) return;
    let fixedChanges;
    try { fixedChanges = consumeRecordPagePreview(preview.snapshot, rowsRef.current, getRecordContext()); }
    catch (reason) { setError(errorMessage(reason)); return; }
    // 投递机会一旦消耗便不再信任执行前历史；失败、取消或未知结果也不能靠重做重放。
    history.clear();
    applyingRef.current = true; blockedRef.current = true; setApplying(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    const taskId = uid(); setApplyTaskId(taskId); receiptTaskRef.current = taskId; setLastReceiptId(''); setCommitLocked(false);
    try { const result = await invoke('table.apply', { ...base, changes: fixedChanges, taskId, previewId: preview.view.previewId }); setLastReceiptId(result.receiptId ?? ''); setPreview(null); useWorkspace.getState().notify(result.receiptSaved === false ? tableApplyReceiptZh.committedRecordFailed : result.cleanupWarning ? tableApplyReceiptZh.committedCleanupWarning : formatText(zh.table.text003, result.affectedRows), result.receiptSaved === false || result.cleanupWarning === true); await load(); }
    catch (reason) {
      setError(errorMessage(reason));
      // 查询本地记录，不连接数据库、不重放失败或未知批次。
      try { const records = await invoke('table.applyReceipt.list', { taskId }); if (records.items[0]) setLastReceiptId(records.items[0].operationId); } catch { /* 原数据操作错误保持；任务中心仍可手动查看。 */ }
    }
    finally { applyingRef.current = false; setApplying(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || preferencesLock.current || copyPendingRef.current); }
  }
  insertCopyBlockedRef.current = observedRefresh.current !== refreshVersion || blocked || gridEditing || record.dirty || record.pending || record.cellKey !== null || !!record.nodeInput || !!record.structureInput || !!record.documentInput || showPreferences || !!referenceDialog || !!pasteInsertDialog || !!batchFillDialog || settings.activeTabId !== tab.id || !page;
  const historyBlocked = blocked || !editable || record.dirty || record.pending || gridEditing || showPreferences || !!referenceDialog || !!pasteInsertDialog || !!batchFillDialog || record.cellKey !== null || !!record.nodeInput || !!record.structureInput || settings.activeTabId !== tab.id;
  // 菜单和原生命令绑定同一个表页快照，切页、改草稿、改选区或换连接后旧入口立即失效。
  const tableToolbarScope = useMemo(() => ({}), [tab, connection, connectionVersion, refreshVersion, info, page, rows, selection, selectedRows, settings.activeTabId, blocked, gridEditing, record.dirty, record.pending, showPreferences, referenceDialog, pasteInsertDialog, historyBlocked, sortScope]);
  const tableToolbarOwner = useRef({ scope: tableToolbarScope, revision: 0 });
  if (tableToolbarOwner.current.scope !== tableToolbarScope) tableToolbarOwner.current = { scope: tableToolbarScope, revision: tableToolbarOwner.current.revision + 1 };
  const tableToolbarContextKey = JSON.stringify([tab.id, connectionVersion, refreshVersion, tableToolbarOwner.current.revision]);
  /** 执行前读取同步工作区，不能将原菜单动作转交给后来选中的表或隐藏标签。 */
  function tableToolbarCurrent(): boolean {
    const state = useWorkspace.getState();
    return mounted.current && tableToolbarOwner.current.scope === tableToolbarScope && state.settings.activeTabId === tab.id
      && state.settings.tabs.find(item => item.id === tab.id) === tab && state.connections.find(item => item.id === tab.connectionId) === connection
      && (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion
      && !document.querySelector('[role="dialog"], [role="alertdialog"]');
  }
  useUiCommandScope(`tab:${tab.id}`, {
    find: { enabled: !!page && !blocked, run: () => { if (tableToolbarCurrent()) openPageFind(); } },
    replace: { enabled: !!page && editable && !blocked, run: () => { if (tableToolbarCurrent()) openPageFind('replacement'); } },
    import: { enabled: !!connection, run: () => { if (tableToolbarCurrent()) onTransfer('import'); } },
    export: { enabled: !!connection, run: () => { if (tableToolbarCurrent()) onTransfer('export'); } }
  }, { active: settings.activeTabId === tab.id, contextKey: tableToolbarContextKey });

  return <div ref={rootElement} className="workspace-tab table-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><span className="breadcrumb-divider">/</span>{tab.database}<span className="breadcrumb-divider">/</span><strong>{tab.table}</strong>{lastReceiptId && <button disabled={applying} onClick={() => setShowReceipt(true)}>{tableApplyReceiptZh.openCurrent}</button>}<span className="grow"/><span className="tag">{info?.engine || zh.table.text004}</span></div><AdaptiveToolbar className="table-command-toolbar" ariaLabel={tableToolbarZh.title} contextKey={tableToolbarContextKey} isCurrent={tableToolbarCurrent} moreDisabled={gridEditing}
  items={[
    { key: 'refresh', content: (<button onClick={() => { if (canReload()) void load(); }} disabled={blocked}><RefreshCw size={14}/>{zh.common.refresh}</button>) },
    { key: 'insert', content: (<button disabled={!editable || blocked} onClick={addRow}><Plus size={14}/>{zh.common.add}</button>) },
    { key: 'delete', content: (<button disabled={!editable || (!selection && !selectedRows.size) || blocked} onClick={deleteSelected}><Trash2 size={14}/>{zh.common.delete}</button>) },
    { key: 'filter', content: (<button className={showFilter || filters.length ? 'selected' : ''} onClick={() => { setCellFilterSeed(undefined); setShowFilter(!showFilter); }}><Filter size={14}/>{zh.table.text006}{filters.length > 0 ? ` (${filters.length})` : ''}</button>) },
    { key: 'sort', content: (<button aria-label={sortText.entry} title={sortText.hint} className={sortPanel || sort.length ? 'selected' : ''} disabled={!sortPanelAvailable} onClick={openSortPanel}>{sortText.entry}{sort.length ? ` (${sort.length})` : ''}</button>) },
    { key: 'import', content: (<button onClick={() => onTransfer('import')}><ArrowDownToLine size={14}/>{zh.common.import}</button>) },
    { key: 'export', content: (<button onClick={() => onTransfer('export')}><ArrowUpFromLine size={14}/>{zh.common.export}</button>) }
  ]}
  more={<>
    <ActionMenuSection label={tableToolbarZh.editing}><button aria-label={recordDuplicateZh.action} title={copyMetadataReason || (copySourceReady ? recordCopySourceZh.hint : recordDuplicateReadonlyReason(getRecordContext(), referenceRow) || recordDuplicateZh.hint)} disabled={blocked || record.dirty || !!copyMetadataReason || (!!recordDuplicateReadonlyReason(getRecordContext(), referenceRow) && !copySourceReady)} onClick={duplicateCurrentRow}><CopyPlus size={14}/>{recordDuplicateZh.action}</button>
<button aria-label={recordDuplicateZh.batchAction} title={recordDuplicateZh.batchHint} disabled={!editable || insertCopyBlockedRef.current || !selectedRows.size} onClick={duplicateSelectedRows}><CopyPlus size={14}/>{recordDuplicateZh.batchAction}</button>
<button aria-label={pasteInsertZh.action} disabled={!editable || blocked || record.dirty || !!pasteInsertDialog} onClick={openPasteInsert}>{pasteInsertZh.action}</button>
<button aria-label={recordBatchFillZh.action} disabled={!editable || insertCopyBlockedRef.current || !selectedRows.size} onClick={openBatchFill}>{recordBatchFillZh.action}</button>
<button aria-label={draftHistoryZh.undo} title={draftHistoryZh.limit} disabled={!history.status.undo || historyBlocked} onClick={() => moveHistory("undo")}>{draftHistoryZh.undo} ({history.status.undo})</button>
<button aria-label={draftHistoryZh.redo} title={draftHistoryZh.limit} disabled={!history.status.redo || historyBlocked} onClick={() => moveHistory("redo")}>{draftHistoryZh.redo} ({history.status.redo})</button>
<button aria-label={savedDraftText.save} disabled={historyBlocked || !changes.length} onClick={() => openSavedDraft('save')}>{savedDraftText.save}</button>
<button aria-label={savedDraftText.open} title={changes.length ? savedDraftText.existing : undefined} disabled={historyBlocked || !!changes.length} onClick={() => openSavedDraft('restore')}>{savedDraftText.open}</button>
{restoredDraftView && <button disabled={blocked} onClick={() => { if (canReload()) void load(); }}>{savedDraftText.leaveRestore}</button>}</ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.display}><button className={record.formOpen ? 'selected' : ''} disabled={!page || blocked} onClick={() => { if (record.formOpen) record.closeForm(); else record.openForm(selection?.rowId); }}>{recordViewZh.title}</button>
<button disabled={!selection || blocked} onClick={editCell}><Eye size={14}/>{zh.table.text005}</button>
<button aria-label={tableGridZh.find} title={tableGridZh.find} disabled={!page || blocked} className={showFind ? "selected" : ""} onClick={() => { if (showFind) setShowFind(false); else openPageFind(); }}>{tableGridZh.find}</button>
<button aria-label={tableGridZh.preferences} title={tableGridZh.preferences} disabled={!page || blocked || preferencesLoading} onClick={() => setShowPreferences(true)}>{tableGridZh.preferences}</button>
<button aria-label={tableStatisticsZh.title} title={tableStatisticsZh.title} disabled={blocked || !connection || !info || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput()} onClick={openTableStatistics}>{tableStatisticsZh.title}</button>
<button aria-label={tableValueOptionsZh.open} title={tableValueOptionsZh.scope} disabled={blocked || !connection || !info || !info.columns.some(column => tableValueOptionsColumnCapability(column.type) !== 'unsupported') || !['table', 'view'].includes(info.objectKind ?? '') || !page || externalStale || gridEditing || record.hasInput()} onClick={openTableValueOptions}>{tableValueOptionsZh.open}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.filter}><button type="button" aria-label={groupText.open} title={groupText.hint} className={filterGroup ? 'selected' : ''} disabled={!filters.length || !page || !info || blocked || externalStale || gridEditing || !!filterGroups} onClick={openFilterGroups}>{groupText.open}</button>
<button title={cellFilterText.hint} disabled={!cellFilterAvailable} onClick={() => stageCellFilter(false)}>{cellFilterText.equal}</button>
<button title={cellFilterText.hint} disabled={!cellFilterAvailable} onClick={() => stageCellFilter(true)}>{cellFilterText.exclude}</button>
<button aria-label={selectedFilterText.entry} title={selectedFilterText.hint} disabled={!selectedFilterAvailable} onClick={() => openSelectedFilter(false)}>{selectedFilterText.entry}</button>
<button aria-label={selectedFilterText.excludeEntry} title={selectedFilterText.hint} disabled={!selectedFilterAvailable} onClick={() => openSelectedFilter(true)}>{selectedFilterText.excludeEntry}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.references}><button aria-label={referenceZh.choose} title={referenceZh.choose} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.some(key => info && referenceWritable(info, key))} onClick={() => openReference('choose')}>{referenceZh.choose}</button>
<button aria-label={referenceZh.browse} title={referenceZh.browse} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.length} onClick={() => openReference('browse')}>{referenceZh.browse}</button>
<button aria-label={childReferencesZh.title} title={childReferencesZh.title} disabled={blocked || !connection || !referenceRow || referenceRow.deleted || referenceRow.inserted || info?.objectKind !== 'table' || !page || externalStale || gridEditing || record.hasInput()} onClick={openChildReferences}>{childReferencesZh.title}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.structure}><button disabled={!info || blocked} onClick={() => onDesign(!info?.engine)}><SlidersHorizontal size={14}/>{info && !info.engine ? zh.table.text007 : zh.table.text008}</button>
<button title={columnPatchZh.title} aria-label={columnPatchZh.title} disabled={!info?.engine || blocked} onClick={onColumnPatches}>{columnPatchZh.title}</button>
<button title={indexPatchZh.title} aria-label={indexPatchZh.title} disabled={!info?.engine || blocked} onClick={onIndexPatches}>{indexPatchZh.title}</button>
<button title={foreignKeyPatchZh.title} aria-label={foreignKeyPatchZh.title} disabled={!info?.engine || blocked} onClick={onForeignKeyPatches}>{foreignKeyPatchZh.title}</button>
{info?.objectKind === 'table' && onTableChecks && <button title={tableChecksZh.entry} aria-label={tableChecksZh.entry} disabled={blocked} onClick={onTableChecks}>{tableChecksZh.entry}</button>}
<button title={tableRenameZh.title} aria-label={tableRenameZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableRename}>{tableRenameZh.title}</button>
<button title={tableAutoIncrementZh.title} aria-label={tableAutoIncrementZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableAutoIncrement}>{tableAutoIncrementZh.title}</button>
<button title={tableCommentZh.title} aria-label={tableCommentZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableComment}>{tableCommentZh.title}</button>
<button title={tableDefaultEncodingZh.title} aria-label={tableDefaultEncodingZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableDefaultEncoding}>{tableDefaultEncodingZh.title}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.generate}><button disabled={!templateAvailable} onClick={openQueryTemplate}>{templateText.entry}</button>
<button aria-label={tableForeignKeyJoinZh.entry} title={tableForeignKeyJoinZh.scope} disabled={!foreignKeyJoinAvailable} onClick={openForeignKeyJoin}>{tableForeignKeyJoinZh.entry}</button>
<button aria-label={filteredSelectText.entry} title={filteredSelectText.hint} disabled={!filteredSelectAvailable} onClick={openFilteredSelect}>{filteredSelectText.entry}</button>
<button title={copyInsertSqlZh.policy} disabled={insertCopyBlockedRef.current || !selection} onClick={() => copyRowsAsInsert(false)}>{copyInsertSqlZh.current}</button>
<button title={copyInsertSqlZh.policy} disabled={insertCopyBlockedRef.current || !selectedRows.size} onClick={() => copyRowsAsInsert(true)}>{copyInsertSqlZh.selected}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.transfer}>{onTableCopyData && <button title={tableCopyDataZh.title} aria-label={tableCopyDataZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableCopyData(); }}>{tableCopyDataZh.title}</button>}
{onTableCopyStructure && <button title={tableCopyStructureZh.title} aria-label={tableCopyStructureZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableCopyStructure(); }}>{tableCopyStructureZh.title}</button>}
<button aria-label={filteredUpdateText.entry} title={filteredUpdateText.scope} disabled={!filteredUpdateAvailable} onClick={openFilteredUpdate}>{filteredUpdateText.entry}</button>
<button aria-label={filteredDeleteText.entry} title={filteredDeleteText.scope} disabled={!filteredDeleteAvailable} onClick={openFilteredDelete}>{filteredDeleteText.entry}</button>
<button aria-label={tableFilteredExportZh.entry} title={tableFilteredExportZh.scope} disabled={!filteredExportAvailable} onClick={openFilteredExport}>{tableFilteredExportZh.entry}</button>
<button title={pageExportText.hint} disabled={!pageExportAvailable} onClick={() => exportTablePage(false)}>{pageExportText.page}</button>
<button title={pageExportText.hint} disabled={!pageExportAvailable || !selectedRows.size} onClick={() => exportTablePage(true)}>{pageExportText.selected}</button></ActionMenuSection>
    <ActionMenuSection label={tableToolbarZh.danger}>{onTableDrop && <button title={tableDropZh.title} aria-label={tableDropZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableDrop(); }}>{tableDropZh.title}</button>}
{onTableTruncate && <button title={tableTruncateZh.title} aria-label={tableTruncateZh.title} disabled={info?.objectKind !== 'table' || blocked || gridEditing || record.dirty || record.pending || changes.length > 0 || showPreferences || !!referenceDialog || !!pasteInsertDialog} onClick={() => { if (!rootElement.current?.querySelector('.grid-input')) onTableTruncate(); }}>{tableTruncateZh.title}</button>}</ActionMenuSection>
  </>}/>{preferencesDirty && <span className="muted small">{tableGridZh.unsaved}</span>}{showFilter && <TableFilterPanel seed={cellFilterSeed} columns={info?.columns.map(column => column.name) ?? []} filters={filters} mode={filterMode} disabled={blocked || !!filterGroups} onFiltersChange={changeFilters} onModeChange={changeFilterMode}><TablePresetPanel target={base} connectionVersion={connectionVersion} refreshVersion={refreshVersion} columns={info?.columns.map(column=>column.name)??[]} configuration={{filters,filterMode,...(filterGroup?{filterGroup}:{}),sort}} disabled={blocked||externalStale||!info||!!activeGridEditor.current||!!filterGroups} beforeApply={preparePresetApply} onApply={applyNamedPreset}/></TableFilterPanel>}{filterGroup && <p className="filter-value-hint" aria-label={groupText.structure}>{tableFilterGroupSummary(filterGroup)}</p>}{selectedFilter && <TableSelectedFilterPanel proposal={selectedFilter.proposal} isCurrent={() => selectedFilterCurrent(selectedFilter)} onApply={() => applySelectedFilter(selectedFilter)} onClose={() => closeSelectedFilter(selectedFilter)}/>}{filterGroups && <TableFilterGroupsDialog filters={filterGroups.filters} mode={filterGroups.mode} initial={filterGroups.initial} isCurrent={() => filterGroupsCurrent(filterGroups)} onApply={next => applyFilterGroups(filterGroups, next)} onClose={() => closeFilterGroups(filterGroups)}/ >}{sortPanel && <TableSortPanel columns={sortPanel.columns} initial={sortPanel.sort} isCurrent={() => sortPanelCurrent(sortPanel)} onApply={next => applySortPanel(sortPanel, next)} onClose={() => closeSortPanel(sortPanel)}/>}{showFind && <PageFindPanel focusRequest={findFocus} rows={rows} keys={visibleKeys} info={info} generation={pageFindGeneration()} disabled={blocked || record.dirty || externalStale} replaceDisabled={!editable} onJump={jumpToMatch} getSelectionToken={() => selectionRef.current} onApply={applyPagePlan} onFilter={() => setShowFilter(true)}/>}{externalStale && <div className="info-strip">{columnPatchZh.staleTable}</div>}<ErrorBox message={error || references.error || preferencesError}/>{history.notice && <div className="info-strip" role="status">{history.notice}</div>}{duplicateNotice && <div className="info-strip" role="status">{duplicateNotice}{copyPending && <button onClick={() => { invalidateCopyRead(); setDuplicateNotice(recordCopySourceZh.cancelling); }}>{recordCopySourceZh.cancel}</button>}</div>}{info && !editable && <div className="info-strip">{recordReadonlyReason({ ...getRecordContext(), busy: false })}</div>}<div className="table-record-layout"><div className="table-grid-wrap">{busy && <div className="loading-overlay"><Spinner/></div>}<DataGrid<DraftRow, unknown, string> ref={grid} aria-label={tableGridZh.grid} onColumnResize={(column, width) => { if (!blocked && visibleKeys.includes(column.key)) { try { updatePreferences(changeTablePreference(preferencesRef.current, column.key, { width })); } catch (reason) { setPreferencesError(errorMessage(reason)); } } }} onColumnsReorder={(source, target) => { if (!blocked) updatePreferences(moveTableColumn(preferencesRef.current, source, target)); }} className={`results-grid rdg-${settings.theme}`} columns={columns} rows={rows} rowHeight={32} headerRowHeight={42} rowKeyGetter={row => row.id} rowClass={row => row.deleted ? 'row-deleted' : row.inserted ? 'row-inserted' : !rowEqual(row.original!, row.data) ? 'row-modified' : undefined} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onRowsChange={changeRows} onActivePositionChange={({ row, column }) => selectCurrentCell(row, column?.key)} onCellClick={({ row, column }) => { recordPages.cancel(); selectCurrentCell(row, column.key); }} onCellDoubleClick={({ row, column }, event) => { if (!blocked && isBinaryCell(ownCell(row.data, column.key), info?.columns.find(item => item.name === column.key)?.type)) { event.preventGridDefault(); record.openCell(row.id, column.key); } }} sortColumns={sort.map(item => ({ columnKey: item.column, direction: item.direction }))} onSortColumnsChange={next => { if (tableReadAction.current !== tableReadRender) return; try { const checked = tableSortFromGrid(next, sort, info?.columns.map(column => column.name) ?? []); if (canReload()) { setSort(checked); setPageIndex(1); } } catch (reason) { setError(errorMessage(reason)); } }} onCellCopy={copyCells} onCellPaste={pasteClipboard} onCellKeyDown={(args, event) => { recordPages.cancel(); handleGridKeyDown(args, event); }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/></div>{record.formOpen && <RecordFormPanel editor={record} context={getRecordContext()} rows={rows} visibleKeys={visibleKeys} pageNavigation={{ previous: !restoredDraftView && pageIndex > 1 && (rows.length === 0 || !!record.draft), next: !restoredDraftView && !!page?.hasMore && pageIndex < maxTablePage && !!record.draft, message: recordPageMessage.revision === recordPages.revision ? recordPageMessage.text : '', onNavigate: navigateRecordPage }} onSelect={rowId => { const key = selection?.key && visibleKeys.includes(selection.key) ? selection.key : visibleKeys[0]; if (key) jumpToMatch(rowId, key); }}/>}</div><div className="table-action-bar"><span className={changes.length ? 'warning-text' : 'muted'}>{changes.length ? formatText(zh.table.text015, changes.length) : formatText(zh.table.text016, page?.rows.length ?? 0)}</span>{record.dirty && <span className="warning-text">{recordViewZh.inputDirty}</span>}{(changes.length > 0 || record.dirty) && <><button disabled={blocked} onClick={() => { if (canReload()) void load(); }}><Undo2 size={13}/>{zh.table.text018}</button><button className="primary" disabled={blocked} onClick={() => void makePreview()}><Save size={13}/>{zh.table.text019}</button></>}<span className="grow"/><label className="inline-field">{zh.table.text020}<select aria-label={zh.table.text021} value={pageSize} disabled={blocked || restoredDraftView} onChange={event => { if (canReload()) { setPageIndex(1); setPageSize(Number(event.target.value)); useWorkspace.getState().updateSettings({ pageSize: Number(event.target.value) }); } }}>{[50, 100, 200, 500, 1000].map(size => <option key={size}>{size}</option>)}</select>{zh.table.text022}</label><form className="page-jump" title={zh.table.pageJumpHint} onSubmit={event => { event.preventDefault(); jumpToPage(); }}><input aria-label={zh.table.pageJumpLabel} inputMode="numeric" value={pageJump} disabled={blocked || restoredDraftView} onChange={event => setPageJump(event.target.value)}/><button type="submit" disabled={blocked || restoredDraftView}>{zh.table.pageJump}</button></form><button className="icon-button" aria-label={zh.common.pagePrevious} disabled={restoredDraftView || pageIndex === 1 || blocked} onClick={() => { if (canReload()) setPageIndex(current => current - 1); }}><ChevronLeft size={16}/></button><span>{restoredDraftView ? savedDraftText.restoredScope : <>{zh.table.text023}{pageIndex}{zh.table.text024}</>}</span><button className="icon-button" aria-label={zh.common.pageNext} disabled={restoredDraftView || !page?.hasMore || blocked || pageIndex >= maxTablePage} onClick={() => { if (canReload()) setPageIndex(current => current + 1); }}><ChevronRight size={16}/></button></div>
    {pageExport && <ResultExportDialog result={pageExport.data} tabId={tab.id} scope="table" selected={pageExport.selected} onClose={() => { if (pageExportRef.current === pageExport) { pageExportRef.current = null; setPageExport(null); } }}/>}
    {queryTemplate && <TableQueryTemplateDialog info={queryTemplate.info} limit={queryTemplate.limit} isCurrent={() => queryTemplateCurrent(queryTemplate)} onOpen={(sql, kind, options) => openGeneratedQuery(queryTemplate, sql, kind, options)} onClose={() => closeQueryTemplate(queryTemplate)}/>}
    {filteredSelectDialog && <TableQueryTemplateDialog info={filteredSelectDialog.info} limit={filteredSelectDialog.limit} readScope={filteredSelectDialog.readScope} isCurrent={() => filteredSelectDialog.current()} onOpen={(sql, kind, options) => openFilteredSelectQuery(filteredSelectDialog, sql, kind, options)} onClose={() => closeFilteredSelect(filteredSelectDialog)}/>}
    {pasteInsertDialog && <PasteInsertDialog info={pasteInsertDialog.context.info!} visibleKeys={pasteInsertDialog.visible} invalidReason={pasteInsertDialog.reason(rowsRef.current, getRecordContext())} onStage={plan => stagePasteInsert(pasteInsertDialog, plan)} onClose={() => closePasteInsert(pasteInsertDialog)}/>}
    {batchFillDialog && <TableBatchFillDialog intent={batchFillDialog} initialColumn={selection?.key} invalidReason={batchFillDialog.reason(rowsRef.current, selectedRowsRef.current, getRecordContext(), copyPage.current, page)} onStage={assignments => stageBatchFill(batchFillDialog, assignments)} onClose={() => closeBatchFill(batchFillDialog)}/>}
    {showPreferences && <TablePreferencesDialog preferences={preferences} pending={preferencesPending} dirty={preferencesDirty} error={preferencesError} onChange={updatePreferences} onSave={() => void savePreferences()} onReset={() => void savePreferences(true)} onClose={() => { if (!preferencesLock.current) setShowPreferences(false); }}/ >}
    {referenceDialog && <ForeignKeyDialog base={base} snapshot={referenceDialog.snapshot} keys={referenceDialog.keys} mode={referenceDialog.mode} onApply={applyReference} onClose={() => setReferenceDialog(null)} onActivity={referenceActivity}/ >}
    {childReferenceDialog && <ChildReferenceDialog base={base} intent={childReferenceDialog} onClose={() => closeChildReferences(childReferenceDialog)} onActivity={referenceActivity}/>}
    {foreignKeyJoinDialog && <TableForeignKeyJoinDialog intent={foreignKeyJoinDialog} onOpen={preview => openForeignKeyJoinQuery(foreignKeyJoinDialog, preview)} onClose={() => closeForeignKeyJoin(foreignKeyJoinDialog)} onActivity={foreignKeyJoinActivity} onCleanupError={message => useWorkspace.getState().notify(message, true)}/>}
    {tableStatisticsDialog && <TableStatisticsDialog base={base} intent={tableStatisticsDialog} onClose={() => closeTableStatistics(tableStatisticsDialog)} onActivity={referenceActivity}/>}
    {tableValueOptionsDialog && <TableValueOptionsDialog target={base} source={tableValueOptionsDialog.intent.source} column={tableValueOptionsDialog.column} conditions={tableValueOptionsDialog.intent.conditions} isCurrent={() => tableValueOptionsDialog.intent.current()} services={tableValueOptionsServices} onApply={next => applyTableValueOptions(tableValueOptionsDialog.intent, next)} onClose={() => closeTableValueOptions(tableValueOptionsDialog.intent)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onActivity={referenceActivity}/>}
    {filteredUpdateDialog && <TableFilteredUpdateDialog intent={filteredUpdateDialog} initialColumn={selection?.key} onActivity={referenceActivity} onClose={result => closeFilteredUpdate(filteredUpdateDialog,result)} onCommitted={(result,changed) => useWorkspace.getState().notify(changed?filteredUpdateText.committedChanged(result.rows):filteredUpdateText.committed(result.rows),changed)} onCleanupError={message => useWorkspace.getState().notify(message,true)}/>}
    {filteredDeleteDialog && <TableFilteredDeleteDialog intent={filteredDeleteDialog} onActivity={referenceActivity} onClose={result => closeFilteredDelete(filteredDeleteDialog,result)} onCommitted={(result,changed) => useWorkspace.getState().notify(changed?filteredDeleteText.committedChanged(result.rows):filteredDeleteText.committed(result.rows),changed)} onCleanupError={message => useWorkspace.getState().notify(message,true)}/>}
    {filteredExportDialog && <TableFilteredExportDialog intent={filteredExportDialog} onActivity={referenceActivity} onClose={() => closeFilteredExport(filteredExportDialog)} onCleanupError={message => useWorkspace.getState().notify(message, true)} onCommitted={(result, changed) => useWorkspace.getState().notify(changed ? tableFilteredExportZh.committedChanged(result.rows) : tableFilteredExportZh.completed(result.rows), changed)}/>}
    <RecordEditorDialogs editor={record} context={getRecordContext()} rows={rows}/>
    {draftDialog && <TableDraftDialog mode={draftDialog.mode} target={base} payload={draftDialog.payload} assertCurrent={() => assertSavedDraft(draftDialog)} onRestore={document => acceptSavedDraft(draftDialog, document)} onBusy={() => undefined} onClose={() => closeSavedDraft(draftDialog)}/>}
    {restoredDraftView && <div className="info-strip" role="status">{savedDraftText.restoredScope}</div>}
    {preview && <Modal title={zh.table.text031} wide onClose={() => { if (!applying) setPreview(null); }}><div className="modal-content"><p>{zh.table.text032}{preview.snapshot.changes.length}{zh.table.text033}</p><p className="muted">{tableApplyReceiptZh.previewPrivacy}</p>{commitLocked && applying && <p>{tableApplyReceiptZh.phases.committing}</p>}{preview.view.warnings.map(warning => <p className="warning-text" key={warning}>{warning}</p>)}<SqlEditor value={preview.view.sql} height={280} readOnly/><ErrorBox message={error}/>{preview.snapshot.attempted && !applying && <p className="warning-text">{recordViewZh.applyAttempted}</p>}</div><footer className="modal-footer"><button disabled={applying} onClick={() => setPreview(null)}>{zh.common.backToEdit}</button><span className="grow"/>{applying && !commitLocked && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.table.text034}</button>}<button className="primary" disabled={applying || preview.snapshot.attempted} onClick={() => void apply()}>{applying ? <Spinner text={zh.table.text035}/> : zh.common.confirmApply}</button></footer></Modal>}
    {showReceipt && <TableApplyReceiptsDialog initialOperationId={lastReceiptId} onClose={() => setShowReceipt(false)}/>}
  </div>;
}
