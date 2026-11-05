import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DataRow } from '../../shared/contracts';
import type { ColumnWidths } from 'react-data-grid';
import type { TablePreferences } from '../../shared/tablePreferences';
import { exactTableLayoutProjection, postgresLayoutSchemas, type PostgresLayoutTarget } from '../../shared/sqliteTableLayout';
import { postgresRelationSelect } from '../../shared/postgresSql';
import { isPostgresPresetTabId, postgresPresetIdFromTab } from '../../shared/postgresPresetTab';
import {
  isPostgresTableFiltered, postgresTableLimits, postgresTablePreviewSchema, postgresTableSortRules, type PostgresTableChange, type PostgresTableColumn, type PostgresTableField,
  type PostgresTablePage, type PostgresTablePageInput, type PostgresTablePreview, type PostgresTableTarget,
} from '../../shared/postgresTable';
import { cellPreview, cellText, errorMessage, invoke, ownCell } from '../lib';
import { postgresStructureZh } from '../locales/postgresStructure.zh-CN';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { acquireWorkspaceBusy, useWorkspace, type WorkspaceTab } from '../store';
import { ResultsGrid, type GridCellMenuAnchor } from './ResultsGrid';
import { PostgresTableExportDialog } from './PostgresTableExportDialog';
import { postgresTableExportZh } from '../locales/postgresTableExport.zh-CN';
import { PostgresTableImportDialog } from './PostgresTableImportDialog';
import { PostgresTableFilterPanel } from './PostgresTableFilterPanel';
import { PostgresTableCellFilterMenu } from './PostgresTableCellFilterMenu';
import { PostgresInlineCellEditor, type PostgresInlineCellValue } from './PostgresInlineCellEditor';
import { PostgresGridPasteDialog } from './PostgresGridPasteDialog';
import { postgresClipboardInput, postgresGridPasteChanges } from '../postgresGridPaste';
import { postgresGridPasteZh as pasteText } from '../locales/postgresGridPaste.zh-CN';
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
import { Empty, ErrorBox, Field, Modal, Spinner } from './ui';
import './PostgresTableTab.css';

type PageOptions = Pick<PostgresTablePageInput, 'offset' | 'limit' | 'filter' | 'sort'>;
type Editable = Extract<PostgresTableChange, { kind: 'insert' | 'update' }>;
type DraftEntry = { change: PostgresTableChange & { pageToken: string }; rowKey?: string; offset: number };
type Mode = PostgresTableField['value']['mode'] | 'unchanged';
interface InlineEdit {
  scope: object; cell: QueryResultCopyCell; column: PostgresTableColumn; rowKey: string;
  anchor: HTMLElement; originalText: string; initial: PostgresInlineCellValue; typed?: string;
}

/** 表单只产生字段和值，明确区分保留原值、空串、NULL及DEFAULT。 */
function RecordForm({ page, row, initial, onSave, onClose }: {
  page: PostgresTablePage; row: number | null; initial?: Editable; onSave(change: Editable): void; onClose(): void;
}) {
  const [fields, setFields] = useState(() => new Map(initial?.fields.map(field => [field.column, field.value])));
  const [error, setError] = useState('');
  const original: DataRow | undefined = row === null ? undefined : page.rows[row];

  /** 切换模式时从原值初始化，数据库生成列没有可编辑入口。 */
  function changeMode(key: string, mode: Mode) {
    setFields(previous => {
      const result = new Map(previous);
      if (mode === 'unchanged') result.delete(key);
      else if (mode === 'null' || mode === 'default') result.set(key, { mode });
      else {
        const old = original?.[key];
        const initial = old === null || old === undefined ? '' : cellText(old);
        result.set(key, { mode, value: mode === 'binary' ? (initial.startsWith('0x') ? initial.slice(2) : '') : initial });
      }
      return result;
    });
  }

  /** 表单保存只更新内存草稿。 */
  function submit() {
    const list = Array.from(fields, ([column, value]) => ({ column, value }));
    if (row !== null && !list.length) { setError(text.noChange); return; }
    try { onSave(row === null ? { kind: 'insert', fields: list } : { kind: 'update', row, fields: list }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return <Modal title={row === null ? text.add : text.edit} onClose={onClose} wide>
    <div className="modal-content pg-record-form">
      {page.columns.map(column => {
        const value = fields.get(column.key);
        return <div className="pg-record-field" key={column.key}>
          <strong>{column.name} <small className="muted">{column.type}</small></strong>
          {original && <div className="muted">{text.original}　{cellPreview(original[column.key])}</div>}
          {column.generated ? <span className="muted">{text.generated}</span> : <div className="pg-record-inputs">
            <select aria-label={column.name + ' ' + text.valueMode} value={value?.mode ?? 'unchanged'} onChange={event => changeMode(column.key, event.target.value as Mode)}>
              <option value="unchanged">{row === null ? text.default : text.unchanged}</option>
              <option value="text">{text.text}</option>
              {column.binary && <option value="binary">{text.hex}</option>}
              {column.nullable && <option value="null">{text.null}</option>}
              {row !== null && <option value="default">{text.default}</option>}
            </select>
            {value && 'value' in value && <textarea aria-label={column.name + ' ' + text.value} value={value.value}
              maxLength={postgresTableLimits.value} rows={2} onChange={event => {
                const next = event.target.value;
                setFields(previous => new Map(previous).set(column.key, { ...value, value: next }));
              }}/>}
          </div>}
        </div>;
      })}
      <ErrorBox message={error}/>
    </div>
    <footer className="modal-footer"><button onClick={onClose}>{text.cancel}</button><button className="primary" onClick={submit}>{text.stage}</button></footer>
  </Modal>;
}

/** 浏览、选择、草稿及回执归属于同一标签及原页，隐藏标签保留本地工作。 */
export function PostgresTableTab({ tab, active, onInspect }: { tab: WorkspaceTab; active: boolean; onInspect(): void }) {
  const limit = useWorkspace(state => state.settings.pageSize);
  const connectionVersion = useWorkspace(state => state.connectionVersions[tab.connectionId] ?? 0);
  const [options, setOptions] = useState<PageOptions>({ offset: 0, limit: Math.min(postgresTableLimits.page, limit) });
  const [page, setPage] = useState<PostgresTablePage>();
  const [pageConnectionVersion, setPageConnectionVersion] = useState<number>();
  const [exportPage, setExportPage] = useState<PostgresTablePage>();
  const [importPage, setImportPage] = useState<PostgresTablePage>();
  const [row, setRow] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftEntry[]>([]);
  const draftRef = useRef<DraftEntry[]>([]);
  const [pasteScope, setPasteScope] = useState<object>();
  const pasteOwner = useRef<object>(undefined);
  const [form, setForm] = useState<{ row: number | null }>();
  const [preview, setPreview] = useState<PostgresTablePreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [filterColumn, setFilterColumn] = useState('');
  const [filterText, setFilterText] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState(false);
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
      const state = useWorkspace.getState(), dirty = recordDirty.current || !!inlineOwner.current || view.dirty;
      if (!!state.dirtyTabs[tab.id] !== dirty) state.setDirty(tab.id, dirty);
    },
  }, postgresLayoutSchemas, layoutText));

  /** 操作回包只能发布到原组件代次，加载或应用进行时由全局标签忙碌屏障保护。 */
  async function run(action: (isCurrent: () => boolean) => Promise<unknown>, onError?: (reason: unknown) => void) {
    const life = lifetime.current;
    if (!life || lease.current) return;
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
  async function read(next: PageOptions, isCurrent: () => boolean, retainPageTokens: string[] = [], checkFilterColumns = false, presetLayout?: TablePreferences) {
    const result = await invoke('postgres.table.page', { ...target, ...next,
      ...(retainPageTokens.length ? { retainPageTokens } : {}), ...(checkFilterColumns ? { checkFilterColumns: true } : {}) });
    return publishPage(result, next, isCurrent, presetLayout);
  }

  async function publishPage(result: PostgresTablePage, next: PageOptions, isCurrent: () => boolean, presetLayout?: TablePreferences) {
    if (!isCurrent()) {
      const token = result.exportToken ?? result.pageToken;
      if (token) await invoke('postgres.table.release', { ...target, pageToken: token }).catch(() => {});
      return false;
    }
    issued.current = result.exportToken ?? result.pageToken;
    if (presetLayout) layout.applyPreset(presetLayout, result.columns.map(column => column.name));
    setPage(result);
    setPageConnectionVersion(connectionVersion);
    setOptions(next);
    setPageSize(next.limit);
    setRow(null);
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
  function navigate(next: PageOptions, keepDraft = false) {
    if ((presetTab && !page) || (!keepDraft && draft.length) || (requiresRefresh && draft.length) || preview || form || inlineOwner.current || pasteOwner.current || lease.current) return;
    setMessage('');
    void run(isCurrent => read(next, isCurrent, [...new Set(draft.map(entry => entry.change.pageToken))]));
  }

  /** 更新草稿及标签退出保护。 */
  function setChanges(next: DraftEntry[]) {
    draftRef.current = next;
    setDraft(next);
    recordDirty.current = next.length > 0;
    useWorkspace.getState().setDirty(tab.id, recordDirty.current || !!inlineOwner.current || layout.view.dirty);
  }

  /** 单格和矩形共用一次整批校验，重编同一主键时继续使用首次暂存的原行版本。 */
  function stageChanges(changes: readonly PostgresTableChange[], owner?: InlineEdit) {
    if (!page?.pageToken || requiresRefresh || lease.current || inlineOwner.current !== owner) return false;
    const next = [...draftRef.current];
    for (const change of changes) {
      const rowKey = change.kind === 'insert' ? undefined : page.rowKeys?.[change.row];
      if (change.kind !== 'insert' && !rowKey) throw Error(text.noKey);
      const index = rowKey ? next.findIndex(item => item.rowKey === rowKey) : -1;
      const prior = index >= 0 ? next.splice(index, 1)[0] : undefined;
      next.push(prior && prior.change.kind !== 'insert' && change.kind !== 'insert'
        ? { ...prior, change: { ...change, row: prior.change.row, pageToken: prior.change.pageToken } }
        : { change: { ...change, pageToken: page.pageToken }, rowKey, offset: options.offset });
    }
    const checked = postgresTablePreviewSchema.safeParse({ ...target, pageToken: page.pageToken, changes: next.map(item => item.change) });
    if (!checked.success) throw Error(checked.error.issues[0]?.message ?? text.noChange);
    setChanges(next);
    return true;
  }

  function stage(change: PostgresTableChange, owner?: InlineEdit) {
    if (stageChanges([change], owner)) setForm(undefined);
  }

  /** 预览包含服务端构建的参数语句，点击确认前没有写库。 */
  function prepare() {
    const pageToken = page?.exportToken;
    if (!pageToken || !draft.length || requiresRefresh || inlineOwner.current || pasteOwner.current) return;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.preview', { ...target, pageToken, changes: draft.map(item => item.change) });
      if (isCurrent()) setPreview(result);
    });
  }

  /** 每个预览只发送一次；任何未确认回执都要先刷新核对，避免重复提交。 */
  function apply() {
    const pageToken = page?.exportToken;
    if (!pageToken || !preview || !active) return;
    const previewToken = preview.previewToken;
    void run(async isCurrent => {
      const result = await invoke('postgres.table.apply', { ...target, pageToken, previewToken });
      if (!isCurrent()) return;
      issued.current = undefined;
      setPreview(undefined);
      setRequiresRefresh(true);
      setMessage(result.outcome === 'unknown' ? text.unknown + ' ' + result.message : result.message);
      if (result.outcome === 'committed') {
        setChanges([]);
        await read(options, isCurrent);
      }
    }, () => {
      setPreview(undefined);
      if (!issued.current) return;
      setRequiresRefresh(true);
      setMessage(text.unknown);
    });
  }

  const layoutOpen = layoutDialog === layoutKey;
  const blocked = busy || !!form || !!inlineEdit || !!pasteScope || !!preview || !!exportPage || !!importPage || !!sortPageToken || !!presetPage || layoutOpen;
  const frozenPage = blocked || draft.length > 0 || (presetTab && !page);
  const pagingBlocked = blocked || (requiresRefresh && draft.length > 0);
  const writable = !blocked && !requiresRefresh && !!page?.pageToken;
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

  const canEditGrid = active && writable && !!page?.capabilities.update && pageConnectionVersion === connectionVersion;
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
      applied = await read({ ...options, ...conditions, offset: 0 }, isCurrent, [], true, configuration.layout);
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
  return <div className="workspace-tab postgres-table-tab" aria-label={text.relation}>
    <div className="context-bar"><strong>{tab.title}</strong><span>PostgreSQL / {target.database}</span></div>
    <div className="query-toolbar pg-table-toolbar">
      {presetTab && !page
        ? <button disabled={blocked} onClick={() => void run(openPresetPage)}>{tablePresetsZh.treeRetry}</button>
        : <button disabled={frozenPage} onClick={() => navigate({ ...options, limit: pageSize })}>{text.refresh}</button>}
      <button disabled={blocked} onClick={onInspect}>{postgresStructureZh.open}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken}
        onClick={() => setExportPage(page)}>{postgresTableExportZh.open}</button>
      <button disabled={frozenPage || requiresRefresh || !page?.exportToken || !page.canImport}
        onClick={() => setImportPage(page)}>{postgresTableImportZh.open}</button>
      <button disabled={busy} onClick={() => useWorkspace.getState().openTab({
        kind: 'query', title: tab.title, connectionId: target.connectionId, database: target.database, sql: postgresRelationSelect(target.table),
      })}>{text.query}</button>
      <button disabled={!writable || !page?.capabilities.insert} onClick={() => setForm({ row: null })}>{text.add}</button>
      <button disabled={!canPasteAppend} onClick={() => {
        if (!canPasteAppend || lease.current || inlineOwner.current || !layoutScope.current.current() ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        closeCellMenu(cellMenuOwner.current, false);
        pasteOwner.current = cellScope;
        setPasteScope(cellScope);
      }}>{pasteText.append}</button>
      <button disabled={!writable || !page?.capabilities.update || row === null} onClick={() => setForm({ row })}>{text.edit}</button>
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
      <button disabled={frozenPage || !page?.exportToken || !layoutView.ready || layoutView.pending} onClick={() => {
        if (page?.exportToken) setPresetPage({ token: page.exportToken, connectionVersion });
      }}>{text.presets}</button>
      <button disabled={blocked || !layoutView.ready || layoutView.pending || !layoutScope.current.current()} onClick={() => {
        setLayoutError(''); setLayoutDialog(layoutKey);
      }}>{layoutText.entry}</button>
    </div>
    {advancedFilters && <PostgresTableFilterPanel columns={page?.columns.map(column => column.name) ?? []}
      initial={appliedAdvanced} seed={cellFilterSeed} onSeedAdded={() => setCellFilterSeed(undefined)}
      replacesQuick={!!(options.filter && 'text' in options.filter && options.filter.text)}
      disabled={frozenPage} onApply={filter => navigate({ ...firstPage, filter })}/>}
    {message && <div className="info-strip" role="status">{message}</div>}
    <ErrorBox message={error}/>
    {page?.truncated && <div className="warning-text">{text.truncated}</div>}
    {page?.order === 'unstable' && <div className="info-strip">{text.unstable}</div>}
    {page && <div className="tab-status"><span>{text.page(options.offset, page.rows.length)}</span><span>{row === null ? text.noSelection : text.selected(row + 1)}</span>
      {appliedAdvanced && <span>{text.activeAdvancedFilter(appliedAdvanced.rules.filter(rule => rule.enabled !== false).length)}</span>}
      {sortRules.length > 0 && <span>{text.activeSort(sortRules.length)}</span>}
      {layoutView.dirty && <span>{tableGridZh.unsaved}</span>}
      {layoutView.fromPreset && <span>{layoutText.fromPreset}</span>}
      {!page.pageToken && <span>{text.noWrite}</span>}
      {canEditGrid && <span title={pasteText.overwriteHint}>{text.cellEditHint} {pasteText.overwriteHint}</span>}
      {requiresRefresh && <span>{text.refreshAfterFailure}</span>}
    </div>}
    <div className="pg-table-grid" inert={!!inlineEdit}>
      {page ? <ResultsGrid key={page.exportToken} columns={gridLayout.columns} rows={page.rows} rowJump onActiveRowIndexChange={setRow}
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
        }}/> : <Empty title={text.empty}/>}
    </div>
    {cellMenu && cellMenuEnabled && cellMenu.scope === cellScope &&
      <PostgresTableCellFilterMenu anchor={cellMenu.anchor} column={cellMenu.seed.column}
        onClose={restoreFocus => closeCellMenu(cellMenu, restoreFocus)} onChoose={exclude => chooseCellFilter(cellMenu, exclude)}/>}
    {inlineEdit && <PostgresInlineCellEditor anchor={inlineEdit.anchor} column={inlineEdit.column}
      initial={inlineEdit.initial} originalText={inlineEdit.originalText} typed={inlineEdit.typed} visible={active}
      onStage={value => stageInlineEdit(inlineEdit, value)} onCancel={() => closeInlineEdit(inlineEdit)}/>}
    {pasteScope && <PostgresGridPasteDialog columns={gridLayout.columns} onClose={() => closePasteAppend(pasteScope)}
      onStage={(start, source) => stageGridPaste(start, source, undefined, pasteScope)}/>}
    {draft.length > 0 && <div className="pg-table-draft" aria-label={text.draft}>
      <strong>{text.changes(draft.length)}</strong><button disabled={blocked} onClick={() => setChanges([])}>{text.discard}</button>
      <ol>{draft.map(({ change, offset }, index) => <li key={index}>
        <span>{text.change[change.kind]}{change.kind === 'insert' ? '' : ' · ' + text.originalRow(offset + change.row + 1)}</span>
        {change.kind !== 'delete' && <span className="muted">　{change.fields.map(field => {
          const name = page?.columns.find(column => column.key === field.column)?.name;
          const value = 'value' in field.value ? cellPreview(field.value.value) : field.value.mode.toUpperCase();
          return name + '=' + value;
        }).join('，')}</span>}
        <button disabled={blocked} onClick={() => setChanges(draft.filter((_, other) => index !== other))}>{text.undo}</button>
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
        setImportPage(undefined); setRequiresRefresh(true); setMessage(outcome);
        if (committed) void run(isCurrent => read(options, isCurrent));
      }}/>}
    {form && page && <RecordForm page={page} row={form.row}
      initial={stagedChange?.kind === 'update' ? stagedChange : undefined}
      onSave={stage} onClose={() => setForm(undefined)}/>}
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
