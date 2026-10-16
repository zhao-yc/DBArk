import { zh, formatText } from '../locales/zh-CN';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type Column, type RenderEditCellProps, type DataGridHandle, type CellKeyDownArgs, type CellKeyboardEvent } from 'react-data-grid';
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, Undo2, Eye, KeyRound } from 'lucide-react';
import type { FilterRule, SortRule, SqlPreview, TableInfo, TablePage } from '../../shared/contracts';
import { cellPreview, cellText, errorMessage, invoke, ownCell, rowEqual, uid } from '../lib';
import { useWorkspace, type WorkspaceTab } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Modal, Spinner } from './ui';
import { collectChanges, type DraftRow } from '../dataChanges';
import { cellClipboardType, decodeClipboard, encodeClipboard, pasteCells } from '../gridClipboard';
import { maxTablePage, parsePageJump, type FilterMode } from '../tableFilters';
import { TableFilterPanel } from './TableFilterPanel';
import { ForeignKeyDialog } from './ForeignKeyDialog';
import { patchReferenceRow, referenceWritable, referencesForColumn, type ReferenceSnapshot } from '../referenceChanges';
import { referenceZh } from '../locales/references.zh-CN';
import type { CellValue, ForeignKeyInfo } from '../../shared/contracts';
import type { TablePreferences } from '../../shared/tablePreferences';
import { changeTablePreference, moveTableColumn, reconcileTablePreferences, visibleTableKeys } from '../tableColumnPreferences';
import { applyPageReplacement, type PageOccurrence, type PageReplacement } from '../pageFindReplace';
import { PageFindPanel } from './PageFindPanel';
import { TablePreferencesDialog } from './TablePreferencesDialog';
import { tableGridZh } from '../locales/tableGrid.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { blocksBinaryTextInput, tableCellKeyIsComposing } from '../tableCellKeyboard';
import '../tableGrid.css';
import { indexPatchZh } from '../locales/indexPatches.zh-CN';
import { foreignKeyPatchZh } from '../locales/foreignKeyPatches.zh-CN';
import { columnPatchZh } from '../locales/columnPatches.zh-CN';
import { tableRenameZh } from '../locales/tableRename.zh-CN';
import { tableCommentZh } from '../locales/tableComment.zh-CN';
import { tableDefaultEncodingZh } from '../locales/tableDefaultEncoding.zh-CN';
import { columnPageRefreshAction } from '../columnPatchServices';
import { useRecordViews, type RecordViewController } from '../hooks/useRecordViews';
import { acceptGridDrafts, captureRecordPagePreview, consumeRecordPagePreview, recordReadonlyReason, recordTargetKey, type RecordContext, type RecordPagePreview } from '../recordViews';
import { RecordEditorDialogs, RecordFormPanel } from './RecordFormPanel';
import { recordViewZh } from '../locales/recordViews.zh-CN';
import { RecordPageNavigation, recordPageScope, type RecordPageContext } from '../recordPageNavigation';

/** 输入始终保留字符串精度，失焦仅提交到本地草稿，不执行数据库写入。 */
function TextCellEditor({ row, column, onRowChange, onClose, binary }: RenderEditCellProps<DraftRow> & { binary: boolean }) {
  const value = ownCell(row.data, column.key);
  // 即使将来有额外的编辑入口，字节也只能以有界只读预览呈现，不能被转换为文本草稿。
  return <input className="grid-input" readOnly={binary} autoFocus onFocus={event => event.currentTarget.select()} defaultValue={binary ? cellPreview(value) : value === null ? '' : cellText(value)} onChange={event => { if (!binary) onRowChange({ ...row, data: { ...row.data, [column.key]: event.target.value } }); }} onBlur={() => onClose(!binary, false)} aria-label={formatText(zh.table.text001, column.key)}/>;
}

/** 分页、排序和筛选全部交给数据库，界面仅持有当前页及该页的待提交修改。 */
export function TableTab({ tab, onDesign, onTransfer, onColumnPatches, onIndexPatches, onForeignKeyPatches, onTableRename, onTableComment, onTableDefaultEncoding, refreshVersion = 0, refreshAutomatically = true }: { tab: WorkspaceTab; onDesign: (isView: boolean) => void; onTransfer: (mode: 'import' | 'export') => void; onColumnPatches(): void; onIndexPatches(): void; onForeignKeyPatches(): void; onTableRename(): void; onTableComment(): void; onTableDefaultEncoding(): void; refreshVersion?: number; refreshAutomatically?: boolean }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const connectionVersion = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const [info, setInfo] = useState<TableInfo | null>(null); const [page, setPage] = useState<TablePage | null>(null); const [pageIndex, setPageIndex] = useState(1);
  const [pageJump, setPageJump] = useState('1');
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [rows, setRowsState] = useState<DraftRow[]>([]); const [sort, setSort] = useState<SortRule[]>([]); const [filters, setFilters] = useState<FilterRule[]>([]); const [showFilter, setShowFilter] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set());
  const pendingPaste = useRef<DraftRow[] | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selection, setSelection] = useState<{ rowId: string; key: string }>();
  const [preview, setPreview] = useState<{ view: SqlPreview; snapshot: RecordPagePreview } | null>(null); const [previewing, setPreviewing] = useState(false); const previewingRef = useRef(false); const [applying, setApplying] = useState(false);
  const [applyTaskId, setApplyTaskId] = useState('');
  const [referenceDialog, setReferenceDialog] = useState<{ snapshot: ReferenceSnapshot; keys: ForeignKeyInfo[]; mode: 'choose' | 'browse' } | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false); const referenceCount = useRef(0);
  const grid = useRef<DataGridHandle>(null); const [showFind, setShowFind] = useState(false); const [showPreferences, setShowPreferences] = useState(false);
  const [findFocus, setFindFocus] = useState<{ target: 'query' | 'replacement'; generation: number }>({ target: 'query', generation: 0 });
  const [preferences, setPreferences] = useState<TablePreferences>({ version: 1, columns: [] }); const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const [preferencesLoading, setPreferencesLoading] = useState(true); const [preferencesPending, setPreferencesPending] = useState(false); const preferencesLock = useRef(false);
  const [preferencesDirty, setPreferencesDirtyState] = useState(false); const [preferencesError, setPreferencesError] = useState(''); const layoutRevision = useRef(0);
  /** 同步发布布局草稿，跨标签结构操作不能在React效果到来前抢先丢弃设置。 */
  function setPreferencesDirty(dirty: boolean) { setPreferencesDirtyState(dirty); useWorkspace.getState().setTableLayoutDraft(tab.id, dirty); }
  const preferenceLifecycle = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; preferenceLifecycle.current++; useWorkspace.getState().setTableLayoutDraft(tab.id, false); }; }, []);
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const inputDirtyRef = useRef(false); const recordControllerRef = useRef<RecordViewController | null>(null); const rootElement = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  /** 所有入口同步替换同一页草稿引用，避免一次事件轮次内的迟到回调覆盖更新。 */
  function setRows(value: DraftRow[] | ((current: DraftRow[]) => DraftRow[])) {
    const next = typeof value === 'function' ? value(rowsRef.current) : value;
    rowsRef.current = next; setRowsState(next); useWorkspace.getState().setDirty(tab.id, collectChanges(next).length > 0 || inputDirtyRef.current);
  }
  const applyingRef = useRef(applying); applyingRef.current = applying;
  const blocked = busy || referenceBusy || applying || preferencesPending || previewing || !!preview; const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const changes = useMemo(() => collectChanges(rows), [rows]);
  const loadGeneration = useRef(0);
  const recordPages = useRef(new RecordPageNavigation()).current;
  const [recordPageMessage, setRecordPageMessage] = useState({ revision: -1, text: '' });
  const loadingCount = useRef(0); const observedRefresh = useRef(refreshVersion); const [externalStale, setExternalStale] = useState(false);
  const base = useMemo(() => ({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! }), [tab.connectionId, tab.database, tab.table]);
  const recordContextRef = useRef<RecordContext>({ target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked });
  recordContextRef.current = { target: base, connectionVersion, generation: loadGeneration.current, info, loaded: !!page, stale: externalStale, busy: blocked };
  /** 代次与忙碌读取同步引用，不等待下一次渲染才能阻止旧字段输入写入新页。 */
  function getRecordContext(): RecordContext { return { ...recordContextRef.current, generation: loadGeneration.current, busy: blockedRef.current }; }
  const record = useRecordViews({ rows, getRows: () => rowsRef.current, getContext: getRecordContext, onRows: setRows, onDirty: dirty => { inputDirtyRef.current = dirty; useWorkspace.getState().setDirty(tab.id, dirty || collectChanges(rowsRef.current).length > 0); }, onFocusGrid: () => restoreGridFocus(true) });
  recordControllerRef.current = record;
  const recordPageScopeValue = { target: base, connectionVersion, refreshVersion, pageSize, filters, filterMode, sort };
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
  const visibleColumns = useMemo(() => { const source = new Map(page?.columns.map(column => [column.key, column]) ?? []); return visibleKeys.map(key => source.get(key)!); }, [page?.columns, visibleKeys]);
  const pageFindContext = useRef<{ values: unknown[]; generation: number }>({ values: [], generation: 0 });
  /** 任意草稿或上下文变化都递增查找代次；应用时同步重算，不能覆盖同轮事件的新草稿。 */
  function pageFindGeneration(): number {
    const context = getRecordContext();
    const values = [rowsRef.current, context.info, context.connectionVersion, refreshVersion, context.stale, recordTargetKey(context.target), context.loaded, context.generation, pageIndex, pageSize, sort, filters, filterMode, visibleKeys];
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
    finally { preferencesLock.current = false; if (mounted.current) setPreferencesPending(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current); }
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
    const next = applyPageReplacement(rowsRef.current, plan, context.info, pageFindGeneration()); rowsRef.current = next; setRows(next); setError(''); return next;
  }
  /** 每次加载分配代次，旧请求迟到时不能覆盖新页面或当前编辑状态。 */
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current; blockedRef.current = true;
    // 读取实参绑定当次条件；结构版本取最新值，其它旧闭包实参不能领取新条件的意图。
    const navigation = recordPages.claim({ ...getRecordPageContext(), scope: recordPageScope({ target: base, connectionVersion, refreshVersion: recordPageScopeRef.current.value.refreshVersion, pageSize, filters, filterMode, sort }), page: pageIndex, generation });
    loadingCount.current++; useWorkspace.getState().setBusy(tab.id, true);
    setBusy(true); setError('');
    try {
      await invoke('connections.open', { id: tab.connectionId });
      const settled = await Promise.allSettled([invoke('metadata.table', base), invoke('table.page', { ...base, page: pageIndex, pageSize, filters, filterMode, sort })]);
      if (settled[0].status === 'rejected') throw settled[0].reason;
      const metadata = settled[0].value; if (generation === loadGeneration.current) setInfo(metadata);
      if (settled[1].status === 'rejected') throw settled[1].reason; const data = settled[1].value;
      if (generation !== loadGeneration.current) return;
      if (navigation && (data.page !== pageIndex || data.pageSize !== pageSize)) throw new Error(recordViewZh.pageChanged);
      const nextRows = data.rows.map(data => ({ id: uid(), data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }));
      setInfo(metadata); setPage(data); setRows(nextRows); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; recordControllerRef.current?.reset(); setExternalStale(false);
      if (navigation && recordPages.complete(navigation, getRecordPageContext(), nextRows)) setRecordPageMessage({ revision: navigation.action, text: formatText(nextRows.length ? recordViewZh.pageArrived : recordViewZh.pageEmpty, pageIndex) });
    } catch (reason) {
      if (generation === loadGeneration.current) {
        // 翻页/筛选已获草稿放弃确认；失败不能把旧页继续显示成新条件下的可编辑结果。
        setError(errorMessage(reason)); setPage(null); setRows([]); setSelectedRows(new Set()); setSelection(undefined); selectionRef.current = undefined; recordControllerRef.current?.reset();
        if (navigation && recordPages.fail(navigation, getRecordPageContext())) setRecordPageMessage({ revision: navigation.action, text: formatText(recordViewZh.pageFailed, pageIndex) });
      }
    }
    finally { loadingCount.current = Math.max(0, loadingCount.current - 1); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current); if (generation === loadGeneration.current) setBusy(false); }
  }, [base, pageIndex, pageSize, filters, filterMode, sort, tab.connectionId, connectionVersion]);
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
  function canReload() {
    if (blockedRef.current || showPreferences || document.querySelector('[role="dialog"]') || referenceCount.current > 0 || referenceDialog) return false;
    if ((collectChanges(rowsRef.current).length || record.hasInput()) && !window.confirm(recordViewZh.discardPage)) return false;
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
    blockedRef.current = true; setBusy(true); record.reset(); setPage(null); setRows([]); setSelectedRows(new Set()); selectionRef.current = undefined; setSelection(undefined);
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
  /** 捕获整行草稿及页面代次，多外键在关联窗口内明确选择约束。 */
  function openReference(mode: 'choose' | 'browse') {
    if (blocked || referenceDialog || !info || !selection || !relatedKeys.length) return;
    if (record.hasInput()) { setError(recordViewZh.resolveInput); return; }
    const row = rowsRef.current.find(item => item.id === selection.rowId);
    if (!row || row.deleted || (mode === 'choose' && !relatedKeys.some(key => referenceWritable(info, key)))) return;
    setReferenceDialog({ mode, keys: structuredClone(relatedKeys), snapshot: { rowId: row.id, data: structuredClone(row.data), foreignKey: structuredClone(relatedKeys[0]), source: structuredClone(info), generation: loadGeneration.current } });
  }
  /** 请求已关闭窗口后仍占用标签，直到服务器请求实际结束才释放。 */
  const referenceActivity = useCallback((delta: 1 | -1) => {
    referenceCount.current = Math.max(0, referenceCount.current + delta); setReferenceBusy(referenceCount.current > 0);
    useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current);
  }, [tab.id]);
  /** 使用最新行状态一次写入完整外键草稿，不更改 original 或调用提交。 */
  function applyReference(values: CellValue[], source: TableInfo, key: ForeignKeyInfo, expected: ForeignKeyInfo, clear: boolean) {
    if (record.hasInput()) throw new Error(recordViewZh.resolveInput);
    const readonly = recordReadonlyReason({ ...getRecordContext(), busy: false }); if (readonly) throw new Error(readonly);
    if (!referenceDialog || applyingRef.current) throw new Error(referenceZh.changed);
    const next = patchReferenceRow(rowsRef.current, { ...referenceDialog.snapshot, foreignKey: expected }, loadGeneration.current, source, key, values, clear);
    rowsRef.current = next; setRows(next); setError('');
  }
  /** 条件变更始终从第一页读取，取消草稿确认时不更改任何已应用条件。 */
  function changeFilters(next: FilterRule[]): boolean {
    if (!canReload()) return false;
    setFilters(next); setPageIndex(1); return true;
  }
  /** 全部与任一是整组规则的组合方式，切换也必须通过当前页草稿保护。 */
  function changeFilterMode(next: FilterMode): boolean {
    if (next === filterMode) return true;
    if (!canReload()) return false;
    setFilterMode(next); setPageIndex(1); return true;
  }
  /** 页码可指向空页；只检查接口范围，不用当前页的 hasMore 推测总页数。 */
  function jumpToPage() {
    if (busy || applying) return;
    try { const target = parsePageJump(pageJump); if (target !== pageIndex && canReload()) { setError(''); setPageIndex(target); } }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const columns = useMemo<Column<DraftRow>[]>(() => [SelectColumn, ...visibleColumns.map<Column<DraftRow>>(column => ({
    key: column.key, name: column.name, minWidth: 64, maxWidth: 2000, width: preferences.columns.find(item => item.name === column.key)?.width ?? 165, resizable: true, sortable: true, draggable: true,
    // 组件的editable同时控制粘贴派发；只读判断保持不变，二进制另在文本入口拦截。
    editable: row => !record.dirty && !recordReadonlyReason(getRecordContext(), row, column.key),
    renderEditCell: props => <TextCellEditor {...props} binary={isBinaryCell(ownCell(props.row.data, column.key), info?.columns.find(item => item.name === column.key)?.type)}/>,
    renderHeaderCell: () => <span className="data-header">{info?.primaryKey.includes(column.key) && <KeyRound size={11}/>}<span>{column.name}<small className="column-type">{column.type}</small></span></span>,
    renderCell: ({ row }) => { const value = ownCell(row.data, column.key); return <span className={value === null ? 'null-value' : value === undefined ? 'default-value' : ''} title={value === undefined ? zh.common.defaultValue : cellPreview(value)}>{value === undefined ? zh.common.defaultValue : cellPreview(value)}</span>; }
  }))], [visibleColumns, preferences, editable, info, blocked, record.dirty, externalStale]);
  /** 刷新后网格可能保留同一活动坐标；点击也须用当前行同步选择，不能只等待坐标变化。 */
  function selectCurrentCell(row: DraftRow | undefined, key: string | undefined) {
    if (blocked || document.querySelector('[role="dialog"]')) return;
    // 失去有效坐标时先同步撤销选择令牌，迟到预览不能抢在React渲染前写入。
    if (!row || !key || !page?.columns.some(column => column.key === key) || !rowsRef.current.some(current => current.id === row.id)) { selectionRef.current = undefined; setSelection(undefined); return; }
    const activate = () => { selectionRef.current = { rowId: row.id, key }; setSelection(current => current?.rowId === row.id && current.key === key ? current : { rowId: row.id, key }); };
    if (record.formOpen && !record.select(row.id, activate)) restoreGridFocus(false); else if (!record.formOpen) activate();
  }
  /** 数据网格先返回当前行，再统一替换整个矩阵，避免多行粘贴被默认单行更新覆盖。 */
  function changeRows(updated: DraftRow[]) { try { assertGridWritable(); setRows(acceptGridDrafts(rowsRef.current, rows, pendingPaste.current ?? updated)); } catch (reason) { setError(errorMessage(reason)); } finally { pendingPaste.current = null; } }
  /** 新增使用同一草稿 UUID；表单已打开时可立即编辑该新增记录。 */
  function addRow() {
    try { assertGridWritable(); const row: DraftRow = { id: uid(), data: {}, inserted: true, deleted: false }; setRows(current => [...current, row]); const key = visibleKeys[0]; if (key) { selectionRef.current = { rowId: row.id, key }; setSelection(selectionRef.current); } if (record.formOpen) record.select(row.id); }
    catch (reason) { setError(errorMessage(reason)); }
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
    try { snapshot = captureRecordPagePreview(rowsRef.current, getRecordContext()); if (!snapshot.changes.length) return; }
    catch (reason) { setError(errorMessage(reason)); return; }
    previewingRef.current = true; blockedRef.current = true; setPreviewing(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    try {
      const view = await invoke('table.preview', { ...base, changes: snapshot.changes });
      if (snapshot.rows !== rowsRef.current || snapshot.generation !== loadGeneration.current || snapshot.connectionVersion !== recordContextRef.current.connectionVersion || recordContextRef.current.stale) throw new Error(recordViewZh.previewChanged);
      setPreview({ view, snapshot });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { previewingRef.current = false; setPreviewing(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || applyingRef.current || preferencesLock.current); }
  }
  /** 最终确认同步消耗一次投递机会，异常、取消及未知提交结果都不自动重放。 */
  async function apply() {
    if (!preview || applyingRef.current || previewingRef.current) return;
    let fixedChanges;
    try { fixedChanges = consumeRecordPagePreview(preview.snapshot, rowsRef.current, getRecordContext()); }
    catch (reason) { setError(errorMessage(reason)); return; }
    applyingRef.current = true; blockedRef.current = true; setApplying(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    const taskId = uid(); setApplyTaskId(taskId);
    try { const result = await invoke('table.apply', { ...base, changes: fixedChanges, taskId }); setPreview(null); useWorkspace.getState().notify(formatText(zh.table.text003, result.affectedRows)); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { applyingRef.current = false; setApplying(false); useWorkspace.getState().setBusy(tab.id, loadingCount.current > 0 || referenceCount.current > 0 || preferencesLock.current); }
  }
  return <div ref={rootElement} className="workspace-tab table-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><span className="breadcrumb-divider">/</span>{tab.database}<span className="breadcrumb-divider">/</span><strong>{tab.table}</strong><span className="grow"/><span className="tag">{info?.engine || zh.table.text004}</span></div><div className="toolbar"><button onClick={() => { if (canReload()) void load(); }} disabled={blocked}><RefreshCw size={14}/>{zh.common.refresh}</button><button disabled={!editable || blocked} onClick={addRow}><Plus size={14}/>{zh.common.add}</button><button disabled={!editable || (!selection && !selectedRows.size) || blocked} onClick={deleteSelected}><Trash2 size={14}/>{zh.common.delete}</button><button className={record.formOpen ? 'selected' : ''} disabled={!page || blocked} onClick={() => { if (record.formOpen) record.closeForm(); else record.openForm(selection?.rowId); }}>{recordViewZh.title}</button><button disabled={!selection || blocked} onClick={editCell}><Eye size={14}/>{zh.table.text005}</button><button aria-label={referenceZh.choose} title={referenceZh.choose} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.some(key => info && referenceWritable(info, key))} onClick={() => openReference('choose')}>{referenceZh.choose}</button><button aria-label={referenceZh.browse} title={referenceZh.browse} disabled={blocked || !referenceRow || referenceRow.deleted || !relatedKeys.length} onClick={() => openReference('browse')}>{referenceZh.browse}</button><span className="toolbar-divider"/><button aria-label={tableGridZh.find} title={tableGridZh.find} disabled={!page || blocked} className={showFind ? "selected" : ""} onClick={() => { if (showFind) setShowFind(false); else openPageFind(); }}>{tableGridZh.find}</button><button aria-label={tableGridZh.preferences} title={tableGridZh.preferences} disabled={!page || blocked || preferencesLoading} onClick={() => setShowPreferences(true)}>{tableGridZh.preferences}</button>{preferencesDirty && <span className="muted small">{tableGridZh.unsaved}</span>}<button className={showFilter || filters.length ? 'selected' : ''} onClick={() => setShowFilter(!showFilter)}><Filter size={14}/>{zh.table.text006}{filters.length > 0 ? ` (${filters.length})` : ''}</button><button title={tableDefaultEncodingZh.title} aria-label={tableDefaultEncodingZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableDefaultEncoding}>{tableDefaultEncodingZh.title}</button><button title={tableRenameZh.title} aria-label={tableRenameZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableRename}>{tableRenameZh.title}</button><button title={tableCommentZh.title} aria-label={tableCommentZh.title} disabled={info?.objectKind !== 'table' || blocked} onClick={onTableComment}>{tableCommentZh.title}</button><button title={foreignKeyPatchZh.title} aria-label={foreignKeyPatchZh.title} disabled={!info?.engine || blocked} onClick={onForeignKeyPatches}>{foreignKeyPatchZh.title}</button><button title={indexPatchZh.title} aria-label={indexPatchZh.title} disabled={!info?.engine || blocked} onClick={onIndexPatches}>{indexPatchZh.title}</button><button title={columnPatchZh.title} aria-label={columnPatchZh.title} disabled={!info?.engine || blocked} onClick={onColumnPatches}>{columnPatchZh.title}</button><button disabled={!info || blocked} onClick={() => onDesign(!info?.engine)}><SlidersHorizontal size={14}/>{info && !info.engine ? zh.table.text007 : zh.table.text008}</button><span className="grow"/><button onClick={() => onTransfer('import')}><ArrowDownToLine size={14}/>{zh.common.import}</button><button onClick={() => onTransfer('export')}><ArrowUpFromLine size={14}/>{zh.common.export}</button></div>{showFilter && <TableFilterPanel columns={info?.columns.map(column => column.name) ?? []} filters={filters} mode={filterMode} disabled={blocked} onFiltersChange={changeFilters} onModeChange={changeFilterMode}/>}{showFind && <PageFindPanel focusRequest={findFocus} rows={rows} keys={visibleKeys} info={info} generation={pageFindGeneration()} disabled={blocked || record.dirty || externalStale} replaceDisabled={!editable} onJump={jumpToMatch} getSelectionToken={() => selectionRef.current} onApply={applyPagePlan} onFilter={() => setShowFilter(true)}/>}{externalStale && <div className="info-strip">{columnPatchZh.staleTable}</div>}<ErrorBox message={error || references.error || preferencesError}/>{info && !editable && <div className="info-strip">{recordReadonlyReason({ ...getRecordContext(), busy: false })}</div>}<div className="table-record-layout"><div className="table-grid-wrap">{busy && <div className="loading-overlay"><Spinner/></div>}<DataGrid<DraftRow, unknown, string> ref={grid} aria-label={tableGridZh.grid} onColumnResize={(column, width) => { if (!blocked && visibleKeys.includes(column.key)) { try { updatePreferences(changeTablePreference(preferencesRef.current, column.key, { width })); } catch (reason) { setPreferencesError(errorMessage(reason)); } } }} onColumnsReorder={(source, target) => { if (!blocked) updatePreferences(moveTableColumn(preferencesRef.current, source, target)); }} className={`results-grid rdg-${settings.theme}`} columns={columns} rows={rows} rowHeight={32} headerRowHeight={42} rowKeyGetter={row => row.id} rowClass={row => row.deleted ? 'row-deleted' : row.inserted ? 'row-inserted' : !rowEqual(row.original!, row.data) ? 'row-modified' : undefined} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onRowsChange={changeRows} onActivePositionChange={({ row, column }) => selectCurrentCell(row, column?.key)} onCellClick={({ row, column }) => { recordPages.cancel(); selectCurrentCell(row, column.key); }} onCellDoubleClick={({ row, column }, event) => { if (!blocked && isBinaryCell(ownCell(row.data, column.key), info?.columns.find(item => item.name === column.key)?.type)) { event.preventGridDefault(); record.openCell(row.id, column.key); } }} sortColumns={sort.map(item => ({ columnKey: item.column, direction: item.direction }))} onSortColumnsChange={next => { if (canReload()) { setSort(next.map(item => ({ column: item.columnKey, direction: item.direction }))); setPageIndex(1); } }} onCellCopy={copyCells} onCellPaste={pasteClipboard} onCellKeyDown={(args, event) => { recordPages.cancel(); handleGridKeyDown(args, event); }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/></div>{record.formOpen && <RecordFormPanel editor={record} context={getRecordContext()} rows={rows} visibleKeys={visibleKeys} pageNavigation={{ previous: pageIndex > 1 && (rows.length === 0 || !!record.draft), next: !!page?.hasMore && pageIndex < maxTablePage && !!record.draft, message: recordPageMessage.revision === recordPages.revision ? recordPageMessage.text : '', onNavigate: navigateRecordPage }} onSelect={rowId => { const key = selection?.key && visibleKeys.includes(selection.key) ? selection.key : visibleKeys[0]; if (key) jumpToMatch(rowId, key); }}/>}</div><div className="table-action-bar"><span className={changes.length ? 'warning-text' : 'muted'}>{changes.length ? formatText(zh.table.text015, changes.length) : formatText(zh.table.text016, page?.rows.length ?? 0)}</span>{record.dirty && <span className="warning-text">{recordViewZh.inputDirty}</span>}{(changes.length > 0 || record.dirty) && <><button disabled={blocked} onClick={() => { if (canReload()) void load(); }}><Undo2 size={13}/>{zh.table.text018}</button><button className="primary" disabled={blocked} onClick={() => void makePreview()}><Save size={13}/>{zh.table.text019}</button></>}<span className="grow"/><label className="inline-field">{zh.table.text020}<select aria-label={zh.table.text021} value={pageSize} disabled={blocked} onChange={event => { if (canReload()) { setPageIndex(1); setPageSize(Number(event.target.value)); useWorkspace.getState().updateSettings({ pageSize: Number(event.target.value) }); } }}>{[50, 100, 200, 500, 1000].map(size => <option key={size}>{size}</option>)}</select>{zh.table.text022}</label><form className="page-jump" title={zh.table.pageJumpHint} onSubmit={event => { event.preventDefault(); jumpToPage(); }}><input aria-label={zh.table.pageJumpLabel} inputMode="numeric" value={pageJump} disabled={blocked} onChange={event => setPageJump(event.target.value)}/><button type="submit" disabled={blocked}>{zh.table.pageJump}</button></form><button className="icon-button" aria-label={zh.common.pagePrevious} disabled={pageIndex === 1 || busy || applying} onClick={() => { if (canReload()) setPageIndex(current => current - 1); }}><ChevronLeft size={16}/></button><span>{zh.table.text023}{pageIndex}{zh.table.text024}</span><button className="icon-button" aria-label={zh.common.pageNext} disabled={!page?.hasMore || busy || applying || pageIndex >= maxTablePage} onClick={() => { if (canReload()) setPageIndex(current => current + 1); }}><ChevronRight size={16}/></button></div>
    {showPreferences && <TablePreferencesDialog preferences={preferences} pending={preferencesPending} dirty={preferencesDirty} error={preferencesError} onChange={updatePreferences} onSave={() => void savePreferences()} onReset={() => void savePreferences(true)} onClose={() => { if (!preferencesLock.current) setShowPreferences(false); }}/ >}
    {referenceDialog && <ForeignKeyDialog base={base} snapshot={referenceDialog.snapshot} keys={referenceDialog.keys} mode={referenceDialog.mode} onApply={applyReference} onClose={() => setReferenceDialog(null)} onActivity={referenceActivity}/ >}
    <RecordEditorDialogs editor={record} context={getRecordContext()} rows={rows}/>
    {preview && <Modal title={zh.table.text031} wide onClose={() => { if (!applying) setPreview(null); }}><div className="modal-content"><p>{zh.table.text032}{preview.snapshot.changes.length}{zh.table.text033}</p>{preview.view.warnings.map(warning => <p className="warning-text" key={warning}>{warning}</p>)}<SqlEditor value={preview.view.sql} height={280} readOnly/><ErrorBox message={error}/>{preview.snapshot.attempted && !applying && <p className="warning-text">{recordViewZh.applyAttempted}</p>}</div><footer className="modal-footer"><button disabled={applying} onClick={() => setPreview(null)}>{zh.common.backToEdit}</button><span className="grow"/>{applying && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.table.text034}</button>}<button className="primary" disabled={applying || preview.snapshot.attempted} onClick={() => void apply()}>{applying ? <Spinner text={zh.table.text035}/> : zh.common.confirmApply}</button></footer></Modal>}
  </div>;
}
