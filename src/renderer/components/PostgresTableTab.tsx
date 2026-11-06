import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ColumnWidths } from 'react-data-grid';
import type { TablePreferences } from '../../shared/tablePreferences';
import { exactTableLayoutProjection, postgresLayoutSchemas, type PostgresLayoutTarget } from '../../shared/sqliteTableLayout';
import { postgresIdentifier, postgresRelationName, postgresRelationSelect } from '../../shared/postgresSql';
import type { RecordTemplateContent, RecordTemplateTarget } from '../../shared/recordTemplates';
import { isPostgresPresetTabId, postgresPresetIdFromTab } from '../../shared/postgresPresetTab';
import {
  isPostgresTableFiltered, postgresTableLimits, postgresTablePageOffset, postgresTablePreviewSchema, postgresTableSortRules, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField,
  type PostgresTablePage, type PostgresTablePageInput, type PostgresTablePreview, type PostgresTableTarget,
} from '../../shared/postgresTable';
import { cellPreview, cellText, errorMessage, invoke, ownCell, uid } from '../lib';
import { postgresStructureZh } from '../locales/postgresStructure.zh-CN';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab } from '../store';
import { ResultsGrid, type GridCellMenuAnchor, type GridFindTarget } from './ResultsGrid';
import { PostgresTableExportDialog } from './PostgresTableExportDialog';
import { postgresTableExportZh } from '../locales/postgresTableExport.zh-CN';
import { PostgresTableImportDialog } from './PostgresTableImportDialog';
import { PostgresTableFilterPanel } from './PostgresTableFilterPanel';
import { PostgresTableCellFilterMenu } from './PostgresTableCellFilterMenu';
import { PostgresInlineCellEditor, type PostgresInlineCellValue } from './PostgresInlineCellEditor';
import { PostgresGridPasteDialog } from './PostgresGridPasteDialog';
import { PostgresRecordForm } from './PostgresRecordFields';
import { PostgresReferencePicker, type PostgresReferenceSource } from './PostgresReferencePicker';
import { postgresReferencePickerZh as referenceText } from '../locales/postgresReferencePicker.zh-CN';
import { PostgresTableRecordView, type PostgresRecordMove } from './PostgresTableRecordView';
import { postgresRecordViewZh as recordText } from '../locales/postgresRecordView.zh-CN';
import { postgresClipboardInput, postgresGridPasteChanges } from '../postgresGridPaste';
import { postgresGridPasteZh as pasteText } from '../locales/postgresGridPaste.zh-CN';
import { PostgresTableFindPanel, type PostgresFindRequest } from './PostgresTableFindPanel';
import { postgresFindPlan, postgresFindRows, type PostgresFindPlan } from '../postgresTableFind';
import { postgresTableFindZh as findText } from '../locales/postgresTableFind.zh-CN';
import { useUiCommandScope } from '../uiCommands';
import { postgresTableCellFilterDraft } from '../postgresTableCellFilter';
import type { QueryResultCopyCell } from '../queryResultHeaderCopy';
import type { FilterDraft } from '../tableFilters';
import { TableSortPanel } from './TableSortPanel';
import { TablePresetPanel } from './TablePresetPanel';
import { TablePreferencesDialog } from './TablePreferencesDialog';
import { tableSortZh } from '../locales/tableSort.zh-CN';
import { tablePresetsZh } from '../locales/tablePresets.zh-CN';
import { tableGridZh } from '../locales/tableGrid.zh-CN';
import { postgresTableLayoutZh as layoutText } from '../locales/postgresTableLayout.zh-CN';
import { TableLayoutController, type SqliteLayoutView, type TableLayoutScope } from '../sqliteTableLayout';
import { setTableColumnWidths } from '../tableColumnPreferences';
import { postgresTablePresetConfiguration, postgresTablePresetOptions, type TablePresetConfiguration } from '../../shared/tablePresets';
import { validateTableSort } from '../tableSort';
import { postgresTableImportZh } from '../locales/postgresTableImport.zh-CN';
import { postgresColumnStatisticsZh } from '../locales/postgresColumnStatistics.zh-CN';
import type { PostgresColumnReadSource } from '../postgresColumnRead';
import { PostgresColumnStatisticsDialog } from './PostgresColumnStatisticsDialog';
import { PostgresBatchFillDialog } from './PostgresBatchFillDialog';
import { postgresBatchFillChanges } from '../postgresBatchFill';
import { postgresBatchEditableColumn, postgresBatchRows, type PostgresBatchRow } from '../postgresBatchSelection';
import { postgresBatchFillZh as fillText } from '../locales/postgresBatchFill.zh-CN';
import { PostgresBatchDeleteDialog } from './PostgresBatchDeleteDialog';
import { postgresBatchDeletePlan, type PostgresBatchDeletePlan } from '../postgresBatchDelete';
import { postgresBatchDeleteZh as deleteText } from '../locales/postgresBatchDelete.zh-CN';
import { PostgresBatchEditDialog } from './PostgresBatchEditDialog';
import { postgresBatchEditPlan, type PostgresBatchEditInput } from '../postgresBatchEdit';
import { postgresBatchEditZh as batchEditText } from '../locales/postgresBatchEdit.zh-CN';
import { postgresBatchDuplicateChanges, postgresBatchDuplicatePlan, postgresRecordDuplicatePlan } from '../postgresRecordDuplicate';
import { postgresRecordDuplicateZh as duplicateText } from '../locales/postgresRecordDuplicate.zh-CN';
import { postgresBatchDuplicateZh as batchDuplicateText } from '../locales/postgresBatchDuplicate.zh-CN';
import { RecordTemplatesDialog } from './RecordTemplatesDialog';
import { RecordTemplateLease, postgresTemplateCandidate, postgresTemplateColumns, postgresTemplateRows } from '../recordTemplates';
import { recordTemplatesZh as templateText } from '../locales/recordTemplates.zh-CN';
import { PostgresDraftHistory, type PostgresDraftEntry as DraftEntry, type PostgresDraftGroup } from '../postgresDraftHistory';
import { draftHistoryKey } from '../draftHistory';
import { draftHistoryZh as draftHistoryText } from '../locales/draftHistory.zh-CN';
import { tableCellKeyIsComposing } from '../tableCellKeyboard';
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresTableTab.css';

type PageOptions = Pick<PostgresTablePageInput, 'offset' | 'limit' | 'filter' | 'sort'>;
type PageMovement = { recordEdge?: 'last'; navigation?: PostgresTablePageInput['navigation'] };
type PageRead = PageMovement & Pick<PostgresTablePageInput, 'retainPageTokens' | 'retainHistoryPageTokens'> &
  { keepHistory?: boolean; checkFilterColumns?: true; presetLayout?: TablePreferences };
type BatchSelection = {
  scope: object; page: PostgresTablePage; selected: ReadonlySet<number>;
  originalDraft: DraftEntry[]; gridCurrent(): boolean;
} & ({ kind: 'fill' } | { kind: 'delete'; plan: PostgresBatchDeletePlan } | { kind: 'edit'; rows: PostgresBatchRow[] } |
  { kind: 'duplicate'; plan: ReturnType<typeof postgresBatchDuplicatePlan> });
const batchLabels = { fill: fillText, delete: deleteText, edit: batchEditText, duplicate: batchDuplicateText, template: templateText };
type TemplateDialog = {
  lease: RecordTemplateLease; target: RecordTemplateTarget; page: PostgresTablePage;
  columns: ReturnType<typeof postgresTemplateColumns>; candidate?: ReturnType<typeof postgresTemplateCandidate>;
};
type DuplicateSource = {
  page: PostgresTablePage; scope: object; row: number; rowNumber: number; originalDraft: DraftEntry[];
} & ReturnType<typeof postgresRecordDuplicatePlan>;
interface InlineEdit {
  scope: object; cell: QueryResultCopyCell; column: PostgresTableColumn; rowKey: string;
  anchor: HTMLElement; originalText: string; initial: PostgresInlineCellValue; typed?: string;
}

/** 浏览、选择、草稿及回执归属于同一标签及原页，隐藏标签保留本地工作。 */
export function PostgresTableTab({ tab, active, onInspect }: { tab: WorkspaceTab; active: boolean; onInspect(): void }) {
  const limit = useWorkspace(state => state.settings.pageSize);
  const connectionVersion = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const workspaceBusy = useWorkspace(state => !!state.activeJobs[tab.id]);
  const [options, setOptions] = useState<PageOptions>({ offset: 0, limit: Math.min(postgresTableLimits.page, limit) });
  const [page, setPage] = useState<PostgresTablePage>();
  const [pageConnectionVersion, setPageConnectionVersion] = useState<number>();
  const [exportPage, setExportPage] = useState<PostgresTablePage>();
  const [importPage, setImportPage] = useState<PostgresTablePage>();
  const [row, setRow] = useState<number | null>(null);
  const [recordView, setRecordView] = useState(false);
  const [recordInputDirty, setRecordInputDirty] = useState(false);
  const recordInput = useRef<{ page: PostgresTablePage; row: number }>(undefined);
  const [gridReturn, setGridReturn] = useState<{ page: PostgresTablePage; position: GridFindTarget }>();
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const draftRef = useRef(draft);
  const [batch, setBatch] = useState<BatchSelection>();
  const batchOwner = useRef<BatchSelection>(undefined);
  const [history] = useState(() => new PostgresDraftHistory());
  const [pasteScope, setPasteScope] = useState<object>();
  const pasteOwner = useRef<object>(undefined);
  const [findRequest, setFindRequest] = useState<PostgresFindRequest>();
  const findAnchor = useRef<{ scope: object; value?: GridFindTarget }>(undefined);
  const [form, setForm] = useState<{ row: number | null; duplicate?: DuplicateSource }>();
  const duplicateOwner = useRef<DuplicateSource>(undefined);
  const [templateDialog, setTemplateDialog] = useState<TemplateDialog>();
  const templateOwner = useRef<RecordTemplateLease>(undefined);
  const [preview, setPreview] = useState<PostgresTablePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [browsedReference, setBrowsedReference] = useState<PostgresReferenceSource>();
  const [filterColumn, setFilterColumn] = useState('');
  const [filterText, setFilterText] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [columnDialog, setColumnDialog] = useState<{ kind: 'values' | 'statistics'; source: PostgresColumnReadSource }>();
  const [cellFilterSeed, setCellFilterSeed] = useState<FilterDraft>();
  const [cellMenu, setCellMenu] = useState<{
    scope: object; cell: QueryResultCopyCell; anchor: GridCellMenuAnchor; seed: FilterDraft;
  }>();
  const cellMenuOwner = useRef<typeof cellMenu>(undefined);
  const [inlineEdit, setInlineEdit] = useState<InlineEdit>();
  const inlineOwner = useRef<InlineEdit>(undefined);
  const inlineReturnFocus = useRef<HTMLElement>(undefined);
  const [sortPageToken, setSortPageToken] = useState<string>();
  const [presetPage, setPresetPage] = useState<{ token: string; connectionVersion: number }>();
  const [layoutDialog, setLayoutDialog] = useState<object>();
  const [layoutView, setLayoutView] = useState<SqliteLayoutView>({ preferences: { version: 1, columns: [] }, ready: false, pending: false, dirty: false, error: '' });
  const [layoutError, setLayoutError] = useState('');
  const [pageSize, setPageSize] = useState(options.limit);
  const [pageJump, setPageJump] = useState('');
  const lease = useRef<object | undefined>(undefined);
  const issued = useRef<string | undefined>(undefined);
  const lifetime = useRef<object | undefined>(undefined);
  const recordDirty = useRef(false);
  const started = useRef(false);
  const target: PostgresTableTarget = { connectionId: tab.connectionId, database: tab.database ?? 'postgres', table: tab.table ?? '', tabId: tab.id };
  const presetTab = isPostgresPresetTabId(tab.id);
  const layoutTarget = useMemo(() => ({ connectionId: target.connectionId, database: target.database, table: target.table }), [target.connectionId, target.database, target.table]);
  const layoutKey = useMemo(() => ({}), [layoutTarget, connectionVersion]);
  const columnNames = useMemo(() => page?.columns.map(column => column.name) ?? [], [page?.columns]);
  const layoutScope = useRef<TableLayoutScope<PostgresLayoutTarget>>(null!);
  layoutScope.current = { key: layoutKey, target: layoutTarget, names: columnNames, current: () => {
    const state = useWorkspace.getState();
    return !!lifetime.current && active && state.settings.activeTabId === tab.id && pageConnectionVersion === connectionVersion &&
      (state.connectionVersions[tab.connectionId] ?? 0) === connectionVersion;
  } };
  const [layout] = useState(() => new TableLayoutController<PostgresLayoutTarget>({
    scope: () => layoutScope.current,
    get: input => invoke('postgres.table.layout.get', input), save: input => invoke('postgres.table.layout.save', input),
    reset: input => invoke('postgres.table.layout.reset', input), acquire: () => acquireWorkspaceBusy(tab.id),
    changed: view => {
      setLayoutView(view);
      const state = useWorkspace.getState(), dirty = recordDirty.current || !!inlineOwner.current || !!recordInput.current || view.dirty;
      if (!!state.dirtyTabs[tab.id] !== dirty) state.setDirty(tab.id, dirty);
    },
  }, postgresLayoutSchemas, layoutText));

  /** 操作回包只能发布到原组件代次，加载或应用进行时由全局标签忙碌屏障保护。 */
  async function run(action: (isCurrent: () => boolean) => Promise<unknown>, onError?: (reason: unknown) => void) {
    const life = lifetime.current;
    if (!life || lease.current || useWorkspace.getState().activeJobs[tab.id]) return;
    const owner = {}, job = acquireWorkspaceBusy(tab.id);
    lease.current = owner;
    const isCurrent = () => lifetime.current === life && lease.current === owner;
    setBusy(true);
    setError('');
    try { await action(isCurrent); }
    catch (reason) { if (isCurrent()) { setError(errorMessage(reason)); onError?.(reason); } }
    finally {
      if (isCurrent()) setBusy(false);
      if (lease.current === owner) lease.current = undefined;
      job.release();
    }
  }

  /** 只发布完整回包，旧组件迟到的原页能力显式释放。 */
  async function read(next: PageOptions, isCurrent: () => boolean, extra: PageRead = {}) {
    const { presetLayout, recordEdge, keepHistory, ...readOptions } = extra;
    const result = await invoke('postgres.table.page', { ...target, ...next, ...readOptions });
    const retained = keepHistory ? new Set([...readOptions.retainPageTokens ?? [], ...result.retainedHistoryPageTokens ?? []]) : undefined;
    return publishPage(result, next, isCurrent, presetLayout, recordEdge, retained);
  }

  async function publishPage(result: PostgresTablePage, next: PageOptions, isCurrent: () => boolean, presetLayout?: TablePreferences,
    recordEdge?: 'last', retained?: ReadonlySet<string>) {
    if (!isCurrent()) {
      const token = result.exportToken ?? result.pageToken;
      if (token) await invoke('postgres.table.release', { ...target, pageToken: token }).catch(() => {});
      return false;
    }
    issued.current = result.exportToken ?? result.pageToken;
    if (retained) history.retain(retained);
    else history.reset(draftRef.current);
    if (presetLayout) layout.applyPreset(presetLayout, result.columns.map(column => column.name));
    setPage(result);
    setPageConnectionVersion(connectionVersion);
    const offset = result.counted?.offset ?? next.offset;
    setOptions({ ...next, offset });
    setPageSize(next.limit);
    setPageJump('');
    // 表单翻页使用明确的首末位置；同页刷新优先复选仍在该页的主键。
    const selectedKey = row !== null && offset === options.offset ? page?.rowKeys?.[row] : undefined;
    const retainedRow = selectedKey ? result.rowKeys?.indexOf(selectedKey) ?? -1 : -1;
    setRow(recordView && result.rows.length ? recordEdge === 'last' ? result.rows.length - 1 : Math.max(0, retainedRow) : null);
    setGridReturn(undefined);
    setRequiresRefresh(false);
    if (!result.columns.some(column => column.name === filterColumn)) setFilterColumn(result.columns[0]?.name ?? '');
    return true;
  }

  /** 方案页首屏只走方案读取；方案已删除或查询失败时保留空页和重试入口。 */
  async function openPresetPage(isCurrent: () => boolean) {
    const id = postgresPresetIdFromTab(tab.id);
    if (!id) throw Error(tablePresetsZh.tabMissing);
    const { tabId, ...relation } = target;
    const snapshot = await invoke('postgres.table.presets.list', relation);
    if (!isCurrent()) return;
    if (!snapshot.entries.some(entry => entry.id === id)) throw Error(tablePresetsZh.tabMissing);
    const { page: result, configuration } = await invoke('postgres.table.presets.open', { ...relation, id, tabId,
      limit: options.limit, source: snapshot.source, expectedRevision: snapshot.revision, bindingToken: snapshot.bindingToken });
    if (!await publishPage(result, { ...postgresTablePresetOptions(configuration), offset: 0, limit: options.limit }, isCurrent, configuration.layout) || !isCurrent()) return;
    if (configuration.quickFilter) { setFilterColumn(configuration.quickFilter.column); setFilterText(configuration.quickFilter.text); }
    setMessage(configuration.layout ? tablePresetsZh.appliedWithLayout : tablePresetsZh.applied);
  }

  /** 标签移除时只释放本代签发的表页令牌。 */
  useEffect(() => {
    lifetime.current = {};
    return () => {
      lifetime.current = undefined;
      const pageToken = issued.current;
      if (pageToken) void invoke('postgres.table.release', { ...target, pageToken }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    void run(isCurrent => presetTab ? openPresetPage(isCurrent) : read(options, isCurrent));
  }, [active]);
  useEffect(() => { layout.activate(); return () => layout.dispose(); }, [layout]);
  useEffect(() => { layout.sync(); });

  /** 有草稿时只翻页，明确把仍有草稿的原页交给引擎保留。 */
  function navigate(next: PageOptions, keepDraft = false, movement: PageMovement = {}) {
    if ((presetTab && !page) || (!keepDraft && draft.length) || (requiresRefresh && draft.length) || preview || form || columnDialog || batchOwner.current || templateOwner.current || inlineOwner.current || pasteOwner.current || recordInput.current || lease.current) return;
    setMessage('');
    const pins = keepDraft ? history.pins() : {};
    void run(isCurrent => read(next, isCurrent, { ...movement, ...pins, keepHistory: keepDraft }));
  }

  /** 更新草稿及标签退出保护。 */
  function publishChanges(next: DraftEntry[]) {
    draftRef.current = next;
    setDraft(next);
    recordDirty.current = next.length > 0;
    useWorkspace.getState().setDirty(tab.id, recordDirty.current || !!inlineOwner.current || !!recordInput.current || layout.view.dirty);
  }

  function setChanges(next: DraftEntry[], group?: PostgresDraftGroup) {
    if (next.length === draftRef.current.length && next.every((entry, index) => entry === draftRef.current[index])) return;
    history.record(next, group);
    publishChanges(next);
  }

  /** 单格和矩形共用一次整批校验，重编同一主键时继续使用首次暂存的原行版本。 */
  function stageChanges(changes: readonly PostgresTableChange[],
    { owner, remove, group }: { owner?: InlineEdit; remove?: ReadonlySet<string>; group?: PostgresDraftGroup } = {}) {
    if (!page?.pageToken || requiresRefresh || lease.current || inlineOwner.current !== owner) return false;
    const next = draftRef.current.filter(entry => !entry.rowKey || !remove?.has(entry.rowKey));
    for (const change of changes) {
      const rowKey = change.kind === 'insert' ? undefined : page.rowKeys?.[change.row];
      if (change.kind !== 'insert' && !rowKey) throw Error(text.noKey);
      const index = rowKey ? next.findIndex(item => item.rowKey === rowKey) : -1;
      const prior = index >= 0 ? next.splice(index, 1)[0] : undefined;
      next.push(prior && prior.change.kind !== 'insert' && change.kind !== 'insert'
        ? { ...prior, change: { ...change, row: prior.change.row, pageToken: prior.change.pageToken } }
        : { change: { ...change, pageToken: page.pageToken }, rowKey, offset: options.offset });
    }
    if (next.length) {
      const checked = postgresTablePreviewSchema.safeParse({ ...target, pageToken: page.pageToken, changes: next.map(item => item.change) });
      if (!checked.success) throw Error(checked.error.issues[0]?.message ?? text.noChange);
    }
    setChanges(next, group);
    return true;
  }

  function stage(change: PostgresTableChange, owner?: InlineEdit) {
    if (stageChanges([change], { owner })) setForm(undefined);
  }

  /** 预览包含服务端构建的参数语句，点击确认前没有写库。 */
  function prepare() {
    const pageToken = page?.exportToken;
    if (!pageToken || !draft.length || requiresRefresh || batchOwner.current || templateOwner.current || inlineOwner.current || pasteOwner.current || recordInput.current) return;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.preview', { ...target, pageToken, changes: draft.map(item => item.change) });
      if (isCurrent()) setPreview(result);
    });
  }

  /** 原预览只用一次。确认回滚后保留草稿，终态待核对时冻结编辑。 */
  function apply() {
    const pageToken = page?.exportToken;
    if (!pageToken || !preview || !active) return;
    const previewToken = preview.previewToken;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.apply', { ...target, pageToken, previewToken });
      if (!isCurrent()) return;
      setPreview(undefined);
      if (result.outcome === 'rolledBack' && result.draftsRetained && issued.current === pageToken) {
        setMessage(result.message + ' ' + text.retryAfterRollback);
        return;
      }
      issued.current = undefined;
      history.reset(draftRef.current);
      setRequiresRefresh(true);
      setMessage(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      if (result.outcome === 'committed') {
        history.reset([]);
        publishChanges([]);
        await read(options, isCurrent);
      }
    }, () => {
      setPreview(undefined);
      if (!issued.current) return;
      history.reset(draftRef.current);
      setRequiresRefresh(true);
      setMessage(text.unknown);
    });
  }

  const layoutOpen = layoutDialog === layoutKey;
  // 字段弹窗关闭后，原只读请求收尾前继续阻止表页发起另一个作业。
  const modalBlocked = busy || workspaceBusy || !!form || !!inlineEdit || !!pasteScope || !!preview || !!exportPage || !!importPage || !!sortPageToken || !!presetPage || !!columnDialog || !!batch || !!templateDialog || !!browsedReference || layoutOpen;
  const blocked = modalBlocked || recordInputDirty;
  const frozenPage = blocked || draft.length > 0 || (presetTab && !page);
  const pagingBlocked = blocked || (requiresRefresh && draft.length > 0);
  const writable = !blocked && !requiresRefresh && !!page?.pageToken;
  const historyStatus = history.status;
  const historyEnabled = active && writable && pageConnectionVersion === connectionVersion;

  /** 只在当前表页的草稿账本移动，不执行查询或提交，也不接管输入控件的撤销。 */
  function moveDraftHistory(direction: 'undo' | 'redo') {
    if (!historyEnabled || issued.current !== page?.pageToken || !layoutScope.current.current() ||
        draftRef.current !== draft || lease.current || batchOwner.current || templateOwner.current ||
        inlineOwner.current || pasteOwner.current || recordInput.current ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const next = history.move(direction);
    if (!next) return;
    closeCellMenu(cellMenuOwner.current, false);
    publishChanges(next);
    setMessage('');
    setError('');
  }

  function handleDraftHistoryKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!historyEnabled || event.defaultPrevented || tableCellKeyIsComposing(event.nativeEvent)) return;
    const element = event.target;
    const action = draftHistoryKey(event, element instanceof HTMLElement && !!element.closest('[role="grid"]') &&
      !element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) moveDraftHistory(action);
  }
  const firstPage = { ...options, offset: 0, limit: pageSize };
  const appliedAdvanced = options.filter && 'rules' in options.filter ? options.filter : undefined;
  const sortRules = postgresTableSortRules(options.sort);
  const sorted = sortRules.flatMap(rule => {
    const column = page?.columns.find(column => column.name === rule.column);
    return column ? [{ ...rule, column: column.key }] : [];
  });
  const sortIsCurrent = () => !!lifetime.current && active && !!sortPageToken && issued.current === sortPageToken &&
    !lease.current && !recordDirty.current;
  const presetIsCurrent = () => {
    const state = useWorkspace.getState();
    return !!lifetime.current && active && !!presetPage && issued.current === presetPage.token && !lease.current && !layout.view.pending &&
      state.settings.activeTabId === tab.id && !recordDirty.current &&
      (state.connectionVersions[tab.connectionId] ?? 0) === presetPage.connectionVersion;
  };

  /** 布局只投影列定义；网格中的行索引和内部键继续对应原页，记录和导出都使用完整列。 */
  const gridLayout = useMemo(() => {
    const columns = page?.columns ?? [], projection = exactTableLayoutProjection(columnNames, layoutView.preferences);
    return {
      columns: projection.map(item => columns[item.index]),
      frozenKeys: projection.filter(item => item.frozen).map(item => columns[item.index].key),
      widths: new Map(projection.flatMap(item => item.width === undefined ? [] : [[columns[item.index].key, item.width] as const])),
    };
  }, [page?.columns, columnNames, layoutView.preferences]);

  const cellScope = useMemo(() => ({}), [page, gridLayout.columns, connectionVersion]);
  const cellMenuEnabled = active && !frozenPage && !requiresRefresh && pageConnectionVersion === connectionVersion && !!page?.exportToken;

  function closeCellMenu(menu: typeof cellMenu, restoreFocus: boolean) {
    if (!menu || cellMenuOwner.current !== menu) return;
    cellMenuOwner.current = undefined;
    setCellMenu(undefined);
    if (restoreFocus && menu.anchor.element.isConnected) menu.anchor.element.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const owner = cellMenuOwner.current;
    if (owner && (!cellMenuEnabled || owner.scope !== cellScope)) closeCellMenu(owner, false);
  }, [cellMenuEnabled, cellScope]);

  /** 在打开及选中菜单项时都校验原页及活动标签，避免用旧格或其他连接的值。 */
  function canFilterCell(): boolean {
    return cellMenuEnabled && !inlineOwner.current && !!lifetime.current && issued.current === page?.exportToken && layoutScope.current.current() &&
      !lease.current && !recordDirty.current && !document.querySelector('[role="dialog"], [role="alertdialog"]');
  }

  function openCellMenu(cell: QueryResultCopyCell, anchor: GridCellMenuAnchor): boolean {
    if (!page || !canFilterCell()) return false;
    try {
      const seed = postgresTableCellFilterDraft(cell, gridLayout.columns, page.rows);
      const menu = { scope: cellScope, cell, anchor, seed };
      cellMenuOwner.current = menu;
      setCellMenu(menu);
      return true;
    } catch { return false; }
  }

  function chooseCellFilter(menu: NonNullable<typeof cellMenu>, exclude: boolean) {
    if (cellMenuOwner.current !== menu) return;
    closeCellMenu(menu, true);
    if (!page || !canFilterCell() || menu.scope !== cellScope || !menu.anchor.element.isConnected) return;
    try {
      const current = postgresTableCellFilterDraft(menu.cell, gridLayout.columns, page.rows);
      if (current.value !== menu.seed.value || current.operator !== menu.seed.operator || current.column !== menu.seed.column) return;
      setCellFilterSeed(exclude ? postgresTableCellFilterDraft(menu.cell, gridLayout.columns, page.rows, true) : current);
      setAdvancedFilters(true);
    } catch { /* 原值失效时保留当前条件。 */ }
  }

  const canChangeGrid = !recordView && active && writable && pageConnectionVersion === connectionVersion;
  const canEditGrid = canChangeGrid && !!page?.capabilities.update;
  const fillColumns = gridLayout.columns.filter(postgresBatchEditableColumn);
  const editColumns = page?.columns.filter(postgresBatchEditableColumn) ?? [];

  function closeBatch(intent: BatchSelection) {
    if (batchOwner.current !== intent) return;
    batchOwner.current = undefined;
    setBatch(undefined);
  }

  useLayoutEffect(() => {
    if (batch && (!active || batch.scope !== cellScope || !layoutScope.current.current())) closeBatch(batch);
  }, [active, cellScope, batch]);

  function canBatch(kind: BatchSelection['kind'], selected: ReadonlySet<number>): boolean {
    const permitted = kind === 'duplicate' ? canChangeGrid && !!page?.capabilities.insert && !page.truncated :
      kind === 'delete' ? canChangeGrid && !!page?.capabilities.delete :
      canEditGrid && (kind === 'fill' ? !!fillColumns.length : !!editColumns.length);
    return permitted && !!selected.size && selected.size <= postgresTableLimits.changes &&
      [...selected].every(row => {
        const key = page?.rowKeys?.[row];
        return !!page?.rows[row] && (kind === 'duplicate' || !!key) &&
          (!key || !draft.some(entry => entry.rowKey === key && entry.change.kind === 'delete'));
      });
  }

  /** 窗口绑定已勾选的网格代次、原表页与完整草稿，确认前没有数据库请求。 */
  function openBatch(kind: BatchSelection['kind'], selected: ReadonlySet<number>, gridCurrent: () => boolean) {
    if (!page?.pageToken || !canBatch(kind, selected) || !gridCurrent() || batchOwner.current ||
        !layoutScope.current.current() || lease.current || inlineOwner.current || recordInput.current ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const source = { scope: cellScope, page, selected, originalDraft: draftRef.current, gridCurrent };
    const prior = (key: string) => source.originalDraft.find(entry => entry.rowKey === key)?.change;
    try {
      const intent: BatchSelection = kind === 'delete'
        ? { ...source, kind, plan: postgresBatchDeletePlan(page, selected, prior) }
        : kind === 'edit' ? { ...source, kind, rows: postgresBatchRows(page, selected, prior) }
          : kind === 'duplicate' ? { ...source, kind, plan: postgresBatchDuplicatePlan(page, selected, prior) } : { ...source, kind };
      closeCellMenu(cellMenuOwner.current, false);
      batchOwner.current = intent;
      setBatch(intent);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function stageBatch(intent: BatchSelection, build: () => { changes: PostgresTableChange[]; remove?: ReadonlySet<string> }) {
    const batchText = batchLabels[intent.kind];
    if (batchOwner.current !== intent || intent.page !== page || cellScope !== intent.scope ||
        !intent.gridCurrent() || issued.current !== intent.page.pageToken || !layoutScope.current.current() ||
        lease.current || requiresRefresh || draftRef.current !== intent.originalDraft) throw Error(batchText.stale);
    const { changes, remove } = build(), count = changes.length + (remove?.size ?? 0);
    if (count && !stageChanges(changes, { remove, group: intent.kind })) throw Error(batchText.stale);
    closeBatch(intent);
    setError('');
    setMessage(count ? batchText.staged(count) : intent.kind === 'edit' ? batchEditText.unchanged : fillText.unchanged);
  }
  const canFind = !recordView && active && !!page?.exportToken && !blocked && !requiresRefresh && pageConnectionVersion === connectionVersion;
  const findScope = useMemo(() => ({}), [cellScope, draft]);
  const latestFindScope = useRef(findScope);
  latestFindScope.current = findScope;
  const findRows = useMemo(() => page && findRequest
    ? postgresFindRows(page, key => draft.find(entry => entry.rowKey === key)?.change) : [], [page, draft, !!findRequest]);

  /** 查找和替换只接纳活动标签的当前页；草稿、筛选或列位置变化都换代。 */
  function findIsCurrent() {
    return canFind && !!lifetime.current && latestFindScope.current === findScope && draftRef.current === draft &&
      issued.current === page?.exportToken && layoutScope.current.current() && !lease.current && !inlineOwner.current && !pasteOwner.current &&
      !document.querySelector('[role="dialog"], [role="alertdialog"]');
  }

  function openFind(replace: boolean) {
    if (findIsCurrent() && (!replace || canEditGrid)) setFindRequest({ replace });
  }

  useUiCommandScope('tab:' + tab.id, {
    find: { enabled: canFind, run: () => openFind(false) },
    replace: { enabled: canEditGrid, run: () => openFind(true) },
  }, { active, contextKey: page?.exportToken });

  function stageFind(scope: object, plan: PostgresFindPlan) {
    if (!findIsCurrent() || !canEditGrid || scope !== findScope || !stageChanges(plan.changes)) throw Error(findText.stale);
    setMessage(findText.staged(plan.changes.length));
    setError('');
  }
  const canPasteAppend = active && writable && !!page?.capabilities.insert && pageConnectionVersion === connectionVersion &&
    gridLayout.columns.some(column => !column.generated);

  function closePasteAppend(owner: object) {
    if (pasteOwner.current !== owner) return;
    pasteOwner.current = undefined;
    setPasteScope(undefined);
  }

  /** 只消费当前页剪贴板计划，读取、预览和提交由既有按钮独立触发。 */
  function stageGridPaste(start: string, source: { plain: string; typed?: string }, cell?: QueryResultCopyCell, owner?: object) {
    if (!page?.pageToken || issued.current !== page.pageToken || !layoutScope.current.current() || lease.current ||
      inlineOwner.current || requiresRefresh || pasteOwner.current !== owner) throw Error(pasteText.expired);
    if (cell) {
      if (!canEditGrid || !cell.column || page.rows[cell.index] !== cell.row || !gridLayout.columns.some(column => column === cell.column) ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) throw Error(pasteText.expired);
    } else if (!owner || owner !== cellScope || !page.capabilities.insert) throw Error(pasteText.expired);
    const changes = postgresGridPasteChanges(page, gridLayout.columns, start, source, cell?.index,
      key => draftRef.current.find(entry => entry.rowKey === key)?.change);
    if (!stageChanges(changes)) throw Error(pasteText.expired);
    if (owner) closePasteAppend(owner);
    setError('');
    setMessage(pasteText.staged(changes.length));
  }

  /** 单元格编辑只接收当前可见、可写且有原行身份的字段；字节仍走原查看和记录表单。 */
  function openInlineEdit(cell: QueryResultCopyCell, anchor: HTMLElement, typed?: string): boolean {
    if (!canEditGrid || !page || inlineOwner.current || lease.current || issued.current !== page.pageToken ||
      !layoutScope.current.current() || page.rows[cell.index] !== cell.row ||
      document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
    const column = page.columns.find(column => column === cell.column);
    const rowKey = page.rowKeys?.[cell.index];
    if (!column || column.generated || column.binary || !rowKey) return false;
    const raw = ownCell(cell.row, column.key);
    if (raw === undefined || (raw !== null && typeof raw === 'object')) return false;
    const prior = draft.find(entry => entry.rowKey === rowKey)?.change;
    if (prior?.kind === 'delete') return false;
    const staged = prior?.kind === 'update' ? prior.fields.find(field => field.column === column.key)?.value : undefined;
    if (staged?.mode === 'binary') return false;
    const originalText = raw === null ? '' : cellText(raw);
    const initial = staged ?? (raw === null ? { mode: 'null' } : { mode: 'text', value: originalText });
    const owner: InlineEdit = { scope: cellScope, cell, column, rowKey, anchor, originalText, initial, typed };
    closeCellMenu(cellMenuOwner.current, false);
    inlineOwner.current = owner;
    useWorkspace.getState().setDirty(tab.id, true);
    setInlineEdit(owner);
    return true;
  }

  function closeInlineEdit(owner: InlineEdit) {
    if (inlineOwner.current !== owner) return;
    inlineOwner.current = undefined;
    inlineReturnFocus.current = owner.anchor;
    setInlineEdit(undefined);
    useWorkspace.getState().setDirty(tab.id, recordDirty.current || layout.view.dirty);
  }

  useLayoutEffect(() => {
    if (inlineEdit || !active) return;
    const anchor = inlineReturnFocus.current;
    inlineReturnFocus.current = undefined;
    if (anchor?.isConnected) anchor.focus({ preventScroll: true });
  }, [active, inlineEdit]);

  /** 同一原行的其他暂存字段保留；共享 stage 继续使用首次编辑时的原页和行版本。 */
  function stageInlineEdit(owner: InlineEdit, value: PostgresInlineCellValue) {
    if (inlineOwner.current !== owner || owner.scope !== cellScope || !page?.pageToken || issued.current !== page.pageToken ||
      !layoutScope.current.current() || requiresRefresh || lease.current || page.rows[owner.cell.index] !== owner.cell.row ||
      page.rowKeys?.[owner.cell.index] !== owner.rowKey || document.querySelector('[role="dialog"], [role="alertdialog"]'))
      throw Error(text.cellEditExpired);
    const prior = draft.find(entry => entry.rowKey === owner.rowKey)?.change;
    if (prior?.kind === 'delete') throw Error(text.cellEditExpired);
    const unchanged = value.mode === owner.initial.mode && (value.mode !== 'text' || owner.initial.mode === 'text' && value.value === owner.initial.value);
    if (!unchanged) {
      const fields = prior?.kind === 'update' ? prior.fields.filter(field => field.column !== owner.column.key) : [];
      stage({ kind: 'update', row: owner.cell.index, fields: [...fields, { column: owner.column.key, value }] }, owner);
    }
    closeInlineEdit(owner);
  }

  function closeAdvancedFilters() {
    setAdvancedFilters(false);
    setCellFilterSeed(undefined);
    if (columnDialog?.kind === 'values') setColumnDialog(undefined);
  }

  const valueColumns = page?.columns.filter(column => column.valueOptions) ?? [];
  const canReadStatistics = active && !blocked && !requiresRefresh && !!page?.exportToken && pageConnectionVersion === connectionVersion;
  const canReadValues = canReadStatistics && !frozenPage && !!valueColumns.length;
  useEffect(() => {
    if (columnDialog && !columnDialog.source.current()) setColumnDialog(undefined);
  }, [active, connectionVersion, page, columnDialog]);

  /** 统计可与草稿共存。候选会加入筛选草稿，仍要求没有待提交记录。 */
  function openColumnReader(kind: 'values' | 'statistics') {
    const pageToken = page?.exportToken, allowed = kind === 'values' ? canReadValues : canReadStatistics;
    if (!allowed || !page || !pageToken || !layoutScope.current.current() || lease.current ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const columns = kind === 'values' ? valueColumns : page.columns;
    const current = () => issued.current === pageToken && layoutScope.current.current() && !lease.current &&
      (kind === 'statistics' || !recordDirty.current);
    setColumnDialog({ kind, source: { input: { ...target, pageToken }, columns, current,
      initialColumn: columns.find(column => column.name === filterColumn)?.key } });
  }

  /** 仅保存明确调整后的宽度，跳过虚拟网格的自动测量和无变化事件。 */
  function resizeLayout(widths: ColumnWidths) {
    if (!layoutScope.current.current() || blocked || !layoutView.ready || layoutView.pending) return;
    const changed = new Map<string, number>();
    for (const column of gridLayout.columns) {
      const width = widths.get(column.key);
      if (width?.type === 'resized' && width.width !== gridLayout.widths.get(column.key)) changed.set(column.name, Math.round(width.width));
    }
    if (!changed.size) return;
    try { layout.set(setTableColumnWidths(layout.view.preferences, changed)); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  function changeLayout(preferences: TablePreferences) { layout.set(preferences); }

  function persistLayout(reset = false) {
    setLayoutError('');
    void layout.persist(reset).catch(reason => setLayoutError(errorMessage(reason)));
  }

  /** 用正常分页执行方案，直到服务器成功回包才替换页、条件和排序。 */
  async function applyPreset(configuration: TablePresetConfiguration): Promise<boolean> {
    if (!presetIsCurrent()) return false;
    let applied = false, failure: unknown;
    const conditions = postgresTablePresetOptions(configuration);
    await run(async isCurrent => {
      applied = await read({ ...options, ...conditions, offset: 0 }, isCurrent, { checkFilterColumns: true, presetLayout: configuration.layout });
      if (!applied) return;
      closeAdvancedFilters();
      setFilterText(configuration.quickFilter?.text ?? '');
      if (configuration.quickFilter) setFilterColumn(configuration.quickFilter.column);
      setMessage(configuration.layout ? tablePresetsZh.appliedWithLayout : tablePresetsZh.applied);
      setPresetPage(undefined);
    }, reason => { failure = reason; });
    if (failure) throw failure;
    return applied;
  }
  const formKey = form?.row == null ? undefined : page?.rowKeys?.[form.row];
  const stagedChange = formKey ? draft.find(entry => entry.rowKey === formKey)?.change : undefined;
  const viewKey = row === null ? undefined : page?.rowKeys?.[row];
  const viewDraft = viewKey ? draft.find(entry => entry.rowKey === viewKey)?.change : undefined;
  const canDuplicate = active && writable && pageConnectionVersion === connectionVersion && !!page?.capabilities.insert &&
    !page.truncated && row !== null && !!page.rows[row] && viewDraft?.kind !== 'delete';

  function closeDuplicate(source: DuplicateSource) {
    if (duplicateOwner.current !== source) return;
    duplicateOwner.current = undefined;
    setForm(undefined);
  }

  useLayoutEffect(() => {
    const source = duplicateOwner.current;
    if (source && (!active || source.scope !== cellScope || source.row !== row)) closeDuplicate(source);
  }, [active, cellScope, row]);

  /** 复制表单只取当前快照，窗内改动及取消都不会改变原记录草稿。 */
  function openDuplicate() {
    if (!canDuplicate || !page || row === null || duplicateOwner.current || issued.current !== page.pageToken ||
        !layoutScope.current.current() || lease.current || recordInput.current ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    try {
      const originalDraft = draftRef.current;
      const prior = viewKey ? originalDraft.find(entry => entry.rowKey === viewKey)?.change : undefined;
      const source = { ...postgresRecordDuplicatePlan(page, row, prior), page, scope: cellScope,
        row, rowNumber: options.offset + row + 1, originalDraft };
      closeCellMenu(cellMenuOwner.current, false);
      duplicateOwner.current = source;
      setForm({ row: null, duplicate: source });
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function duplicateCurrent(source: DuplicateSource): boolean {
    return duplicateOwner.current === source && page === source.page && cellScope === source.scope &&
      row === source.row && draftRef.current === source.originalDraft && issued.current === page.pageToken &&
      layoutScope.current.current() && !lease.current && !requiresRefresh;
  }

  function stageDuplicate(source: DuplicateSource, change: PostgresTableChange) {
    if (change.kind !== 'insert' || !duplicateCurrent(source) || !stageChanges([change])) throw Error(duplicateText.stale);
    closeDuplicate(source);
    setError('');
    setMessage(duplicateText.staged);
  }

  const canUseTemplates = active && writable && pageConnectionVersion === connectionVersion && !!page?.capabilities.insert && !page.truncated;
  function closeRecordTemplates(owner: RecordTemplateLease) {
    if (templateOwner.current !== owner) return;
    owner.invalidate();
    templateOwner.current = undefined;
    setTemplateDialog(undefined);
  }
  useLayoutEffect(() => {
    // 选择、列布局或原页切换后立即撤权，避免迟到的弹窗回包重新接管。
    const owner = templateOwner.current;
    if (owner) closeRecordTemplates(owner);
  }, [active, cellScope, row]);

  /** 管理器绑定当前原页和草稿代次，同一表从目录或旧式别名打开时共用模板。 */
  function openRecordTemplates() {
    if (!canUseTemplates || !page?.pageToken || issued.current !== page.pageToken || !layoutScope.current.current() ||
        templateOwner.current || duplicateOwner.current || batchOwner.current || inlineOwner.current || pasteOwner.current ||
        recordInput.current || lease.current || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    const originalDraft = draftRef.current;
    const prior = viewKey ? originalDraft.find(entry => entry.rowKey === viewKey)?.change : undefined;
    const { schema, name } = postgresRelationName(target.table);
    const owner: RecordTemplateLease = new RecordTemplateLease(uid(), () => templateOwner.current === owner && issued.current === page.pageToken &&
      layoutScope.current.key === layoutKey && layoutScope.current.current() && !lease.current && !recordInput.current &&
      draftRef.current === originalDraft && !useWorkspace.getState().activeJobs[tab.id]);
    closeCellMenu(cellMenuOwner.current, false);
    templateOwner.current = owner;
    setTemplateDialog({ lease: owner, target: { ...layoutTarget, table: postgresIdentifier(schema) + '.' + postgresIdentifier(name) },
      page, columns: postgresTemplateColumns(page.columns),
      candidate: row === null ? undefined : postgresTemplateCandidate(page, row, prior) });
  }

  /** 用原页账本一次性接收全部副本，撤销时恢复应用前的整份草稿。 */
  function stageRecordTemplate(intent: TemplateDialog, content: RecordTemplateContent, count: number) {
    if (intent.page !== page || !intent.lease.current()) throw Error(templateText.stale);
    if (!stageChanges(postgresTemplateRows(content, intent.page.columns, count), { group: 'template' })) throw Error(templateText.stale);
    closeRecordTemplates(intent.lease);
    setError('');
    setMessage(templateText.staged(count));
  }

  function recordViewCurrent(): boolean {
    return !!(recordView && page?.exportToken && issued.current === page.exportToken && !modalBlocked && !requiresRefresh &&
      layoutScope.current.current() && !lease.current && !inlineOwner.current && !pasteOwner.current &&
      !document.querySelector('[role="dialog"], [role="alertdialog"]'));
  }

  const recordEditable = active && recordView && !modalBlocked && !requiresRefresh && pageConnectionVersion === connectionVersion &&
    !!page?.capabilities.update && !!page.pageToken && !!viewKey && viewDraft?.kind !== 'delete';
  /** 候选只附着在当前可写表单，连接或原表页变化后不能继续填入。 */
  function referenceSource(allowed: boolean, current: () => boolean): PostgresReferenceSource | undefined {
    if (!allowed || !page?.pageToken) return;
    const input = { ...target, pageToken: page.pageToken };
    return { input, current: () => issued.current === input.pageToken && layoutScope.current.current() &&
      !lease.current && !requiresRefresh && current() };
  }
  const canBrowseReference = active && !blocked && !requiresRefresh && pageConnectionVersion === connectionVersion &&
    !!page?.canBrowseReferences && row !== null && !!page.rows[row];

  /** 浏览绑定当前已读取的原行，允许保留同页或其他页的草稿。 */
  function browseReference(direction: 'parent' | 'children') {
    const pageToken = page?.exportToken;
    if (!canBrowseReference || row === null || !pageToken || issued.current !== pageToken ||
        lease.current || !layoutScope.current.current()) return;
    setBrowsedReference({ input: { ...target, pageToken, ...(direction === 'parent' ? { parentRow: row } : { childrenRow: row }) },
      current: () => issued.current === pageToken && layoutScope.current.current() && !lease.current });
  }
  const recordIndex = row ?? -1, recordCount = page?.rows.length ?? 0;
  const canMoveRecord = active && recordView && !pagingBlocked && !requiresRefresh && recordIndex >= 0 && recordIndex < recordCount;
  const moves: Record<PostgresRecordMove, boolean> = {
    first: canMoveRecord && recordIndex > 0,
    last: canMoveRecord && recordIndex < recordCount - 1,
    previous: canMoveRecord && (recordIndex > 0 || options.offset > 0),
    next: canMoveRecord && (recordIndex < recordCount - 1 || !!page?.hasNext && options.offset + options.limit <= postgresTableLimits.offset),
  };

  /** 跨页延用当前筛选、排序和原草稿页；到达相邻页时选中对应边界记录。 */
  function moveRecord(move: PostgresRecordMove) {
    if (!moves[move] || !recordViewCurrent() || recordInput.current || !page || row === null) return;
    const last = page.rows.length - 1;
    if (move === 'first' || move === 'last') { setRow(move === 'first' ? 0 : last); return; }
    if (move === 'next' && row === last) navigate({ ...options, offset: options.offset + options.limit }, true);
    else if (move === 'previous' && row === 0) navigate({ ...options, offset: Math.max(0, options.offset - options.limit) }, true, { recordEdge: 'last' });
    else setRow(row + (move === 'next' ? 1 : -1));
  }

  /** 未暂存输入属于准确页和行，保持标签退出确认及所有写操作的同步屏障。 */
  function changeRecordInput(index: number, dirty: boolean) {
    if (dirty) {
      if (!recordEditable || !recordViewCurrent() || !page || row !== index || !page.rows[index]) throw Error(recordText.expired);
      recordInput.current = { page, row: index };
    } else {
      if (recordInput.current && (recordInput.current.page !== page || recordInput.current.row !== index)) return;
      recordInput.current = undefined;
    }
    setRecordInputDirty(dirty);
    useWorkspace.getState().setDirty(tab.id, dirty || recordDirty.current || layout.view.dirty);
  }

  function stageRecordView(index: number, fields: PostgresTableField[]) {
    const owner = recordInput.current;
    if (!recordEditable || !recordViewCurrent() || !owner || owner.page !== page || owner.row !== index || row !== index ||
      !viewKey || draftRef.current !== draft) throw Error(recordText.expired);
    if (fields.length) {
      if (!stageChanges([{ kind: 'update', row: index, fields }])) throw Error(recordText.expired);
    } else setChanges(draft.filter(entry => entry.rowKey !== viewKey));
    setMessage('');
    setError('');
  }

  function switchRecordView(next: boolean) {
    if (!active || blocked || recordInput.current || lease.current || !page || next === recordView) return;
    closeCellMenu(cellMenuOwner.current, false);
    setFindRequest(undefined);
    if (next) setRow(row !== null && page.rows[row] ? row : page.rows.length ? 0 : null);
    else if (row !== null && gridLayout.columns.length) {
      const previous = findAnchor.current?.scope === cellScope ? findAnchor.current.value?.key : undefined;
      setGridReturn({ page, position: { row, key: previous ?? gridLayout.columns[0].key } });
    }
    setRecordView(next);
  }

  return <div className="workspace-tab postgres-table-tab" aria-label={text.relation}>
    <div className="context-bar"><strong>{tab.title}</strong><span>PostgreSQL / {target.database}</span></div>
    <div className="query-toolbar pg-table-toolbar">
      {presetTab && !page
        ? <button disabled={blocked} onClick={() => void run(openPresetPage)}>{tablePresetsZh.treeRetry}</button>
        : <button disabled={frozenPage} onClick={() => navigate({ ...options, limit: pageSize })}>{text.refresh}</button>}
      <button disabled={blocked} onClick={onInspect}>{postgresStructureZh.open}</button>
      <button disabled={!canBrowseReference} onClick={() => browseReference('parent')}>{referenceText.browse}</button>
      <button disabled={!canBrowseReference} onClick={() => browseReference('children')}>{referenceText.children}</button>
      <button disabled={!canReadStatistics} onClick={() => openColumnReader('statistics')}>{postgresColumnStatisticsZh.title}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken}
        onClick={() => setExportPage(page)}>{postgresTableExportZh.open}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken || !page.canImport}
        onClick={() => setImportPage(page)}>{postgresTableImportZh.open}</button>
      <button disabled={busy} onClick={() => useWorkspace.getState().openTab({
        kind: 'query', title: tab.title, connectionId: target.connectionId, database: target.database, sql: postgresRelationSelect(target.table),
      })}>{text.query}</button>
      <button disabled={!writable || !page?.capabilities.insert} onClick={() => setForm({ row: null })}>{text.add}</button>
      <button disabled={!canDuplicate} onClick={openDuplicate}>{duplicateText.action}</button>
      <button disabled={!canUseTemplates} onClick={openRecordTemplates}>{templateText.open}</button>
      <button disabled={!canPasteAppend} onClick={() => {
        if (!canPasteAppend || lease.current || inlineOwner.current || !layoutScope.current.current() ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        closeCellMenu(cellMenuOwner.current, false);
        pasteOwner.current = cellScope;
        setPasteScope(cellScope);
      }}>{pasteText.append}</button>
      {!recordView && <button disabled={!writable || !page?.capabilities.update || row === null} onClick={() => setForm({ row })}>{text.edit}</button>}
      <button disabled={!writable || !page?.capabilities.delete || row === null} onClick={() => {
        if (row === null) return;
        try { stage({ kind: 'delete', row }); } catch (reason) { setError(errorMessage(reason)); }
      }}>{text.remove}</button>
      <button className="primary" disabled={blocked || requiresRefresh || !page?.exportToken || !draft.length} onClick={prepare}>{text.preview}</button>
      {busy && <Spinner text={text.waiting}/>}
    </div>
    <div className="pg-table-controls">
      <button disabled={pagingBlocked || options.offset === 0}
        onClick={() => navigate({ ...firstPage, limit: draft.length ? options.limit : pageSize }, true)}>{text.first}</button>
      <button disabled={pagingBlocked || options.offset === 0}
        onClick={() => navigate({ ...options, offset: Math.max(0, options.offset - options.limit) }, true)}>{text.previous}</button>
      <button disabled={pagingBlocked || !page?.hasNext || options.offset + options.limit > postgresTableLimits.offset}
        onClick={() => navigate({ ...options, offset: options.offset + options.limit }, true)}>{text.next}</button>
      <button type="button" disabled={!page || pagingBlocked}
        onClick={() => navigate(options, true, { navigation: 'last', recordEdge: 'last' })}>{text.lastPage}</button>
      <button type="button" disabled={!page || pagingBlocked}
        onClick={() => navigate(options, true, { navigation: 'count' })}>{text.countRows}</button>
      <form className="pg-page-jump" onSubmit={event => {
        event.preventDefault();
        if (!page || pagingBlocked || !active) return;
        try {
          const offset = postgresTablePageOffset(pageJump.trim(), options.limit);
          navigate({ ...options, offset }, true);
        } catch (reason) { setError(errorMessage(reason)); }
      }}>
        <input aria-label={text.pageNumber} inputMode="numeric" maxLength={7} value={pageJump}
          placeholder={page ? text.currentPage(Math.floor(options.offset / options.limit) + 1) : undefined}
          disabled={!page || pagingBlocked} onChange={event => setPageJump(event.target.value)}/>
        <button type="submit" disabled={!page || pagingBlocked || !pageJump.trim()}>{text.jumpPage}</button>
      </form>
      <Field label={text.pageSize}><input type="number" min={1} max={postgresTableLimits.page} value={pageSize} disabled={frozenPage}
        onChange={event => setPageSize(Math.max(1, Math.min(postgresTableLimits.page, Math.trunc(Number(event.target.value)) || 1)))}/></Field>
      <Field label={text.filterColumn}><select aria-label={text.filterColumn} value={filterColumn} disabled={frozenPage}
        onChange={event => setFilterColumn(event.target.value)}>{page?.columns.map(column => <option key={column.key} value={column.name}>{column.name}</option>)}</select></Field>
      <Field label={text.filterText}><input value={filterText} maxLength={4096} disabled={frozenPage} onChange={event => setFilterText(event.target.value)}/></Field>
      <button disabled={frozenPage || !filterColumn} onClick={() => {
        closeAdvancedFilters(); navigate({ ...firstPage, filter: { column: filterColumn, text: filterText } });
      }}>{text.filter}</button>
      <button disabled={frozenPage} aria-expanded={advancedFilters}
        onClick={() => advancedFilters ? closeAdvancedFilters() : setAdvancedFilters(true)}>{text.advancedFilter}</button>
      <button disabled={frozenPage || !options.filter} onClick={() => {
        closeAdvancedFilters(); setFilterText(''); navigate({ ...firstPage, filter: undefined });
      }}>{text.clearFilter}</button>
      <button disabled={frozenPage || !page?.exportToken || !columnNames.length} onClick={() => setSortPageToken(page?.exportToken)}>{tableSortZh.entry}</button>
      <button disabled={!canFind} aria-expanded={!!findRequest && !findRequest.replace} onClick={() => openFind(false)}>{findText.title}</button>
      <button disabled={!canEditGrid} aria-expanded={findRequest?.replace === true} onClick={() => openFind(true)}>{findText.replaceTitle}</button>
      <button disabled={frozenPage || !page?.exportToken || !layoutView.ready || layoutView.pending} onClick={() => {
        if (page?.exportToken) setPresetPage({ token: page.exportToken, connectionVersion });
      }}>{text.presets}</button>
      <button disabled={blocked || !layoutView.ready || layoutView.pending || !layoutScope.current.current()} onClick={() => {
        setLayoutError(''); setLayoutDialog(layoutKey);
      }}>{layoutText.entry}</button>
      <div className="pg-view-switch" role="group" aria-label={recordText.title}>
        <button type="button" disabled={!page || blocked} aria-pressed={!recordView} onClick={() => switchRecordView(false)}>{recordText.grid}</button>
        <button type="button" disabled={!page || blocked} aria-pressed={recordView} onClick={() => switchRecordView(true)}>{recordText.view}</button>
      </div>
    </div>
    {advancedFilters && <PostgresTableFilterPanel columns={page?.columns.map(column => column.name) ?? []}
      initial={appliedAdvanced} seed={cellFilterSeed} onSeedAdded={() => setCellFilterSeed(undefined)}
      values={columnDialog?.kind === 'values' ? columnDialog.source : undefined} canReadValues={canReadValues}
      onOpenValues={() => openColumnReader('values')} onCloseValues={() => setColumnDialog(undefined)}
      replacesQuick={!!(options.filter && 'text' in options.filter && options.filter.text)}
      disabled={frozenPage} onApply={filter => navigate({ ...firstPage, filter })}/>}
    {columnDialog?.kind === 'statistics' && <PostgresColumnStatisticsDialog source={columnDialog.source} onClose={() => setColumnDialog(undefined)}/>}
    {message && <div className="info-strip" role="status">{message}</div>}
    <ErrorBox message={error}/>
    {page?.truncated && <div className="warning-text">{text.truncated}</div>}
    {page?.order === 'unstable' && <div className="info-strip">{text.unstable}</div>}
    {page && <div className="tab-status"><span>{text.currentPage(Math.floor(options.offset / options.limit) + 1)}</span>
      <span>{text.page(options.offset, page.rows.length)}</span><span>{row === null ? text.noSelection : text.selected(row + 1)}</span>
      {page.counted && <span>{text.matchingRows(page.counted.matchingRows)}</span>}
      {appliedAdvanced && <span>{text.activeAdvancedFilter(appliedAdvanced.rules.filter(rule => rule.enabled !== false).length)}</span>}
      {sortRules.length > 0 && <span>{text.activeSort(sortRules.length)}</span>}
      {layoutView.dirty && <span>{tableGridZh.unsaved}</span>}
      {layoutView.fromPreset && <span>{layoutText.fromPreset}</span>}
      {!page.pageToken && <span>{text.noWrite}</span>}
      {canEditGrid && <span title={pasteText.overwriteHint}>{text.cellEditHint} {pasteText.overwriteHint}</span>}
      {requiresRefresh && <span>{text.refreshAfterFailure}</span>}
    </div>}
    <div className="pg-table-grid" inert={!!inlineEdit} onKeyDownCapture={handleDraftHistoryKey}>
      {page && recordView && <PostgresTableRecordView page={page} row={row} offset={options.offset} visible={gridLayout.columns}
        draft={viewDraft?.kind === 'update' || viewDraft?.kind === 'delete' ? viewDraft : undefined}
        editable={recordEditable} reference={referenceSource(recordEditable, recordViewCurrent)}
        moves={moves} onMove={moveRecord} onDirty={changeRecordInput} onStage={stageRecordView}/>}
      {page ? <div className="pg-record-grid-host" hidden={recordView}><PostgresTableFindPanel request={findRequest} scope={findScope} pageKey={page.exportToken} enabled={canFind} writable={canEditGrid}
        rows={findRows} columns={gridLayout.columns} isCurrent={findIsCurrent}
        anchor={() => findAnchor.current?.scope === cellScope ? findAnchor.current.value : undefined}
        onOpen={openFind} onClose={() => setFindRequest(undefined)} onStage={stageFind}
        onPreview={(hits, replacement) => {
          if (!findIsCurrent() || !canEditGrid) throw Error(findText.stale);
          return postgresFindPlan(page, findRows, gridLayout.columns, hits, replacement,
            key => draftRef.current.find(entry => entry.rowKey === key)?.change);
        }}
        renderGrid={(findTarget, findMarks) => <ResultsGrid key={page.exportToken} columns={gridLayout.columns} rows={page.rows} rowJump
        renderRowSelectionAction={page.capabilities.insert || page.capabilities.delete || page.capabilities.update && editColumns.length ? (selected, current) =>
          <div className="pg-table-controls pg-batch-actions">
            {!!fillColumns.length && page.capabilities.update && <button type="button" title={fillText.rows} disabled={!canBatch('fill', selected)}
              onClick={() => openBatch('fill', selected, current)}>{fillText.action}</button>}
            {!!editColumns.length && page.capabilities.update && <button type="button" title={fillText.rows} disabled={!canBatch('edit', selected)}
              onClick={() => openBatch('edit', selected, current)}>{batchEditText.action}</button>}
            {page.capabilities.insert && <button type="button" title={fillText.rows} disabled={!canBatch('duplicate', selected)}
              onClick={() => openBatch('duplicate', selected, current)}>{batchDuplicateText.action}</button>}
            {page.capabilities.delete && <button type="button" title={fillText.rows} disabled={!canBatch('delete', selected)}
              onClick={() => openBatch('delete', selected, current)}>{deleteText.action}</button>}
            {!!selected.size && <span>{fillText.count(selected.size)}</span>}
          </div> : undefined}
        onActiveRowIndexChange={recordView ? undefined : setRow}
        findTarget={findTarget} findMarks={findMarks} navigateTo={gridReturn?.page === page ? gridReturn.position : undefined}
        onGridAnchor={value => { findAnchor.current = { scope: cellScope, value }; if (gridReturn) setGridReturn(undefined); }}
        onCellFilterMenu={cellMenuEnabled ? openCellMenu : undefined}
        onCellEdit={canEditGrid ? openInlineEdit : undefined}
        onCellPaste={(cell, data) => {
          if (!canEditGrid || !cell.column) return;
          try { stageGridPaste(cell.column.key, postgresClipboardInput(data), cell); }
          catch (reason) { setError(errorMessage(reason)); }
        }}
        frozenKeys={gridLayout.frozenKeys} columnWidths={gridLayout.widths} rowHeight={layoutView.preferences.rowHeight} onColumnWidthsChange={resizeLayout}
        sort={sorted} onSortChange={frozenPage ? undefined : sort => {
          try {
            const rules = sort.map(({ column, direction, nulls }) => ({
              column: page.columns.find(item => item.key === column)?.name ?? '', direction, nulls,
            }));
            navigate({ ...firstPage, sort: validateTableSort(rules, columnNames) });
          } catch (reason) { setError(errorMessage(reason)); }
        }}/>}/></div> : <Empty title={text.empty}/>}
    </div>
    {cellMenu && cellMenuEnabled && cellMenu.scope === cellScope &&
      <PostgresTableCellFilterMenu anchor={cellMenu.anchor} column={cellMenu.seed.column}
        onClose={restoreFocus => closeCellMenu(cellMenu, restoreFocus)} onChoose={exclude => chooseCellFilter(cellMenu, exclude)}/>}
    {inlineEdit && <PostgresInlineCellEditor anchor={inlineEdit.anchor} column={inlineEdit.column}
      initial={inlineEdit.initial} originalText={inlineEdit.originalText} typed={inlineEdit.typed} visible={active}
      onStage={value => stageInlineEdit(inlineEdit, value)} onCancel={() => closeInlineEdit(inlineEdit)}/>}
    {pasteScope && <PostgresGridPasteDialog columns={gridLayout.columns} onClose={() => closePasteAppend(pasteScope)}
      onStage={(start, source) => stageGridPaste(start, source, undefined, pasteScope)}/>}
    {batch?.kind === 'fill' && <PostgresBatchFillDialog columns={fillColumns} count={batch.selected.size}
      onStage={fields => stageBatch(batch, () => ({
        changes: postgresBatchFillChanges(batch.page, gridLayout.columns, batch.selected, fields,
          key => batch.originalDraft.find(entry => entry.rowKey === key)?.change),
      }))} onClose={() => closeBatch(batch)}/>}
    {batch?.kind === 'delete' && <PostgresBatchDeleteDialog plan={batch.plan} offset={options.offset}
      onStage={() => stageBatch(batch, () => batch.plan)} onClose={() => closeBatch(batch)}/>}
    {batch?.kind === 'edit' && <PostgresBatchEditDialog rows={batch.rows} columns={editColumns}
      primary={batch.page.columns.filter(column => column.primary)} offset={options.offset}
      onStage={(inputs: PostgresBatchEditInput) => stageBatch(batch, () => postgresBatchEditPlan(batch.page, batch.rows, inputs))}
      onClose={() => closeBatch(batch)}/>}
    {batch?.kind === 'duplicate' && <PostgresBatchEditDialog rows={batch.plan.rows} duplicate={batch.plan}
      columns={batch.page.columns.filter(column => !column.generated)} primary={batch.page.columns.filter(column => column.primary)}
      offset={options.offset}
      onStage={inputs => stageBatch(batch, () => ({ changes: postgresBatchDuplicateChanges(batch.page, batch.plan, inputs) }))}
      onClose={() => closeBatch(batch)}/>}
    {templateDialog && <RecordTemplatesDialog key={templateDialog.lease.id} lease={templateDialog.lease}
      target={templateDialog.target} dialect="postgresql" columns={templateDialog.columns} candidate={templateDialog.candidate}
      onStage={(content, count) => stageRecordTemplate(templateDialog, content, count)} onClose={() => closeRecordTemplates(templateDialog.lease)}/>}
    {!!(historyStatus.undo || historyStatus.redo) && <div className="pg-table-controls" role="group" aria-label={draftHistoryText.postgresTitle}>
      <button aria-label={draftHistoryText.undo} title={draftHistoryText.postgresLimit} disabled={!historyEnabled || !historyStatus.undo}
        onClick={() => moveDraftHistory('undo')}>{draftHistoryText.undo} ({historyStatus.undo})</button>
      <button aria-label={draftHistoryText.redo} title={draftHistoryText.postgresLimit} disabled={!historyEnabled || !historyStatus.redo}
        onClick={() => moveDraftHistory('redo')}>{draftHistoryText.redo} ({historyStatus.redo})</button>
    </div>}
    {(draft.length > 0 || historyStatus.undoGroup) && <div className="pg-table-draft" aria-label={text.draft}>
      <strong>{text.changes(draft.length)}</strong>{draft.length > 0 &&
        <button disabled={blocked} onClick={() => {
          if (requiresRefresh) { history.reset([]); publishChanges([]); }
          else setChanges([]);
          setMessage('');
        }}>{text.discard}</button>}
      {historyStatus.undoGroup && <button disabled={!historyEnabled} onClick={() => moveDraftHistory('undo')}>{batchLabels[historyStatus.undoGroup].undo}</button>}
      <ol>{draft.map(({ change, offset }, index) => <li key={index}>
        <span>{text.change[change.kind]}{change.kind === 'insert' ? '' : ' · ' + text.originalRow(offset + change.row + 1)}</span>
        {change.kind !== 'delete' && <span className="muted">　{change.fields.map(field => {
          const name = page?.columns.find(column => column.key === field.column)?.name;
          const value = 'value' in field.value ? cellPreview(field.value.value) : field.value.mode.toUpperCase();
          return name + '=' + value;
        }).join('，')}</span>}
        <button disabled={blocked || requiresRefresh} onClick={() => { setChanges(draft.filter((_, other) => index !== other)); setMessage(''); }}>{text.undo}</button>
      </li>)}</ol>
    </div>}
    {exportPage && <PostgresTableExportDialog target={target} page={exportPage} filtered={isPostgresTableFiltered(options.filter)}
      isCurrent={() => !!lifetime.current && !!exportPage.exportToken && issued.current === exportPage.exportToken &&
        !recordDirty.current} onClose={() => setExportPage(undefined)}/>}
    {layoutOpen && page && <TablePreferencesDialog title={layoutText.title} hint={layoutText.hint} defaultWidth={170}
      preferences={layoutView.preferences} pending={layoutView.pending} dirty={layoutView.dirty} error={layoutError || layoutView.error}
      cleanNotice={layoutView.fromPreset ? layoutText.fromPreset : undefined}
      onChange={changeLayout} onSave={() => persistLayout()} onReset={() => persistLayout(true)} resetPrompt={layoutText.reset}
      onReload={() => { setLayoutError(''); void layout.reload(); }} reloadPrompt={layoutText.discard} reloadLabel={layoutText.reload}
      fitSource={() => ({ columns: gridLayout.columns.map(column => ({ ...column, key: column.name })), rowCount: page.rows.length,
        cell: (index, name) => cellPreview(page.rows[index][gridLayout.columns.find(column => column.name === name)!.key]) })}
      onClose={() => setLayoutDialog(undefined)}/>}
    {sortPageToken && <Modal title={tableSortZh.entry} onClose={() => setSortPageToken(undefined)} wide>
      <div className="modal-content pg-table-sort-dialog">
        <TableSortPanel columns={columnNames} initial={sortRules} hint={text.sortHint} isCurrent={sortIsCurrent}
          onClose={() => setSortPageToken(undefined)} onApply={sort => {
            if (!sortIsCurrent()) return false;
            setSortPageToken(undefined);
            navigate({ ...firstPage, sort });
            return true;
          }}/>
      </div>
    </Modal>}
    {presetPage && <Modal title={text.presets} onClose={() => { if (!lease.current) setPresetPage(undefined); }} wide>
      <div className="modal-content">
        <TablePresetPanel postgres target={{ connectionId: target.connectionId, database: target.database, table: target.table }}
          connectionVersion={connectionVersion} refreshVersion={0} columns={columnNames}
          configuration={postgresTablePresetConfiguration(options, layoutView.preferences)} layoutDirty={layoutView.dirty} disabled={!presetIsCurrent()}
          beforeApply={presetIsCurrent} onApply={applyPreset}/>
      </div>
    </Modal>}
    {importPage && <PostgresTableImportDialog target={target} page={importPage}
      isCurrent={() => !!lifetime.current && !!importPage.exportToken && issued.current === importPage.exportToken &&
        !recordDirty.current} onClose={() => setImportPage(undefined)}
      onOutcome={(outcome, committed) => {
        if (!lifetime.current || issued.current !== importPage.exportToken) return;
        history.reset(draftRef.current);
        setImportPage(undefined); setRequiresRefresh(true); setMessage(outcome);
        if (committed) void run(isCurrent => read(options, isCurrent));
      }}/>}
    {browsedReference && <Modal title={browsedReference.input.childrenRow === undefined ? referenceText.browseTitle : referenceText.childrenTitle}
      onClose={() => setBrowsedReference(undefined)} wide>
      <div className="modal-content"><PostgresReferencePicker source={browsedReference} onClose={() => setBrowsedReference(undefined)}
        onOpen={opened => {
          if (!browsedReference.current()) throw Error(referenceText.relatedExpired);
          const workspace = useWorkspace.getState();
          if (workspace.settings.tabs.length >= 100) throw Error(referenceText.relatedTabsFull);
          workspace.openTab({ id: opened.tabId, kind: 'table', title: referenceText.relatedTitle(opened.table),
            connectionId: target.connectionId, database: target.database, table: opened.table });
        }}/></div>
    </Modal>}
    {form && page && <PostgresRecordForm page={page} row={form.row}
      duplicate={form.duplicate}
      initial={form.duplicate ? { kind: 'insert', fields: form.duplicate.fields } : stagedChange?.kind === 'update' ? stagedChange : undefined}
      reference={referenceSource(active && stagedChange?.kind !== 'delete' &&
        (form.row === null ? page.capabilities.insert : page.capabilities.update), () => form.duplicate ? duplicateCurrent(form.duplicate) : !!form)}
      onSave={change => form.duplicate ? stageDuplicate(form.duplicate, change) : stage(change)}
      onClose={() => form.duplicate ? closeDuplicate(form.duplicate) : setForm(undefined)}/>}
    {preview && <Modal title={text.preview} onClose={() => { if (!busy) setPreview(undefined); }} wide>
      <div className="modal-content pg-table-preview">
        <p>{text.previewHint}</p>
        <p>{text.change.insert} {preview.counts.insert}　{text.change.update} {preview.counts.update}　{text.change.delete} {preview.counts.delete}</p>
        <ol>{draft.map(({ change, offset }, index) => <li key={index}>
          <strong>{text.change[change.kind]}{change.kind === 'insert' ? '' : ' · ' + text.originalRow(offset + change.row + 1)}</strong>
          {change.kind !== 'delete' && <dl>{change.fields.map(field => <div key={field.column}>
            <dt>{page?.columns.find(column => column.key === field.column)?.name}</dt>
            <dd>{'value' in field.value ? field.value.value : field.value.mode === 'null' ? 'NULL' : 'DEFAULT'}</dd>
          </div>)}</dl>}
          <pre>{preview.statements[index]}</pre>
        </li>)}</ol>
      </div>
      <footer className="modal-footer"><button disabled={busy} onClick={() => setPreview(undefined)}>{text.cancel}</button>
        <button className="primary" disabled={busy || !active} onClick={apply}>{text.apply}</button></footer>
    </Modal>}
  </div>;
}
