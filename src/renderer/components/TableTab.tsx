import { zh, formatText } from '../locales/zh-CN';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type Column, type RenderEditCellProps } from 'react-data-grid';
import { ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Save, SlidersHorizontal, Trash2, Undo2, Eye, KeyRound } from 'lucide-react';
import type { FilterRule, SortRule, SqlPreview, TableInfo, TablePage } from '../../shared/contracts';
import { cellPreview, cellText, errorMessage, invoke, parseCell, rowEqual, uid } from '../lib';
import { useWorkspace, type WorkspaceTab } from '../store';
import { SqlEditor } from './SqlEditor';
import { ErrorBox, Field, Modal, Spinner } from './ui';
import { collectChanges, type DraftRow } from '../dataChanges';
import { cellClipboardType, decodeClipboard, encodeClipboard, pasteCells } from '../gridClipboard';
import { maxTablePage, parsePageJump, type FilterMode } from '../tableFilters';
import { TableFilterPanel } from './TableFilterPanel';

/** 输入始终保留字符串精度，失焦仅提交到本地草稿，不执行数据库写入。 */
function TextCellEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<DraftRow>) {
  return <input className="grid-input" autoFocus onFocus={event => event.currentTarget.select()} defaultValue={row.data[column.key] === null ? '' : cellText(row.data[column.key])} onChange={event => onRowChange({ ...row, data: { ...row.data, [column.key]: event.target.value } })} onBlur={() => onClose(true, false)} aria-label={formatText(zh.table.text001, column.key)}/>;
}

/** 分页、排序和筛选全部交给数据库，界面仅持有当前页及该页的待提交修改。 */
export function TableTab({ tab, onDesign, onTransfer }: { tab: WorkspaceTab; onDesign: (isView: boolean) => void; onTransfer: (mode: 'import' | 'export') => void }) {
  const settings = useWorkspace(state => state.settings); const connection = useWorkspace(state => state.connections.find(profile => profile.id === tab.connectionId));
  const [info, setInfo] = useState<TableInfo | null>(null); const [page, setPage] = useState<TablePage | null>(null); const [pageIndex, setPageIndex] = useState(1);
  const [pageJump, setPageJump] = useState('1');
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [rows, setRows] = useState<DraftRow[]>([]); const [sort, setSort] = useState<SortRule[]>([]); const [filters, setFilters] = useState<FilterRule[]>([]); const [showFilter, setShowFilter] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set());
  const pendingPaste = useRef<DraftRow[] | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [selection, setSelection] = useState<{ rowId: string; key: string }>();
  const [cellDialog, setCellDialog] = useState<{ rowId: string; key: string; text: string; mode: 'text' | 'json' | 'binary' | 'null' }>();
  const [preview, setPreview] = useState<SqlPreview | null>(null); const [applying, setApplying] = useState(false);
  const [applyTaskId, setApplyTaskId] = useState('');
  const changes = useMemo(() => collectChanges(rows), [rows]);
  const loadGeneration = useRef(0);
  const editable = !!info?.editableKey.length && !!page;
  const base = useMemo(() => ({ connectionId: tab.connectionId, database: tab.database!, table: tab.table! }), [tab.connectionId, tab.database, tab.table]);
  /** 每次加载分配代次，旧请求迟到时不能覆盖新页面或当前编辑状态。 */
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setBusy(true); setError('');
    try {
      await invoke('connections.open', { id: tab.connectionId });
      const [metadata, data] = await Promise.all([invoke('metadata.table', base), invoke('table.page', { ...base, page: pageIndex, pageSize, filters, filterMode, sort })]);
      if (generation !== loadGeneration.current) return;
      setInfo(metadata); setPage(data); setRows(data.rows.map(data => ({ id: uid(), data: structuredClone(data), original: structuredClone(data), inserted: false, deleted: false }))); setSelectedRows(new Set()); setSelection(undefined);
    } catch (reason) {
      if (generation === loadGeneration.current) {
        // 翻页/筛选已获草稿放弃确认；失败不能把旧页继续显示成新条件下的可编辑结果。
        setError(errorMessage(reason)); setPage(null); setRows([]); setSelectedRows(new Set()); setSelection(undefined); setCellDialog(undefined);
      }
    }
    finally { if (generation === loadGeneration.current) setBusy(false); }
  }, [base, pageIndex, pageSize, filters, filterMode, sort, tab.connectionId]);
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load]);
  useEffect(() => { setPageJump(String(pageIndex)); }, [pageIndex]);
  useEffect(() => { useWorkspace.getState().setDirty(tab.id, changes.length > 0); return () => useWorkspace.getState().setDirty(tab.id, false); }, [tab.id, changes.length]);
  /** 翻页、排序或刷新前先确认是否允许丢弃本页尚未提交的草稿。 */
  function canReload() { return !busy && !applying && (changes.length === 0 || window.confirm(zh.table.text002)); }
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
  const columns = useMemo<Column<DraftRow>[]>(() => [SelectColumn, ...(page?.columns ?? []).map<Column<DraftRow>>(column => ({
    key: column.key, name: column.name, minWidth: 110, width: 165, resizable: true, sortable: true,
    editable: row => editable && !busy && !row.deleted && !info?.columns.find(item => item.name === column.key)?.generated,
    renderEditCell: TextCellEditor,
    renderHeaderCell: () => <span className="data-header">{info?.primaryKey.includes(column.key) && <KeyRound size={11}/>}<span>{column.name}<small className="column-type">{column.type}</small></span></span>,
    renderCell: ({ row }) => <span className={row.data[column.key] === null ? 'null-value' : row.data[column.key] === undefined ? 'default-value' : ''} title={cellPreview(row.data[column.key])}>{row.data[column.key] === undefined ? zh.common.defaultValue : cellPreview(row.data[column.key])}</span>
  }))], [page?.columns, editable, info, busy]);
  /** 数据网格先返回当前行，再统一替换整个矩阵，避免多行粘贴被默认单行更新覆盖。 */
  function changeRows(updated: DraftRow[]) { setRows(pendingPaste.current ?? updated); pendingPaste.current = null; }
  /** 删除选中记录仅形成草稿，仍须预览并提交后才影响数据库。 */
  function deleteSelected() {
    const targets = selectedRows.size ? selectedRows : new Set(selection ? [selection.rowId] : []);
    setRows(current => current.map(row => targets.has(row.id) ? { ...row, deleted: !row.deleted } : row));
  }
  /** 勾选记录时复制整行，否则复制当前单元格；文本和类型化内容同时写入剪贴板。 */
  function copyCells({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    if (!selectedRows.size && !(page?.columns.some(item => item.key === column.key))) return;
    const matrix = selectedRows.size ? rows.filter(item => selectedRows.has(item.id)).map(item => page!.columns.map(column => item.data[column.key] ?? null)) : [[row.data[column.key] ?? null]];
    event.preventDefault();
    try { const content = encodeClipboard(matrix); event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData(cellClipboardType, content.typed); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  /** 原生粘贴事件提供内容，完全不依赖被禁用的浏览器剪贴板权限。 */
  function pasteClipboard({ row, column }: { row: DraftRow; column: { key: string } }, event: React.ClipboardEvent) {
    event.preventDefault(); pendingPaste.current = null;
    if (!editable || busy) return row;
    try {
      const values = decodeClipboard(event.clipboardData.getData(cellClipboardType), event.clipboardData.getData('text/plain'));
      const updated = pasteCells(rows, page!.columns.map(item => item.key), row.id, column.key, values, new Set(info!.columns.filter(item => item.generated).map(item => item.name)));
      pendingPaste.current = updated; setError(''); return updated.find(item => item.id === row.id)!;
    } catch (reason) { setError(errorMessage(reason)); return row; }
  }
  /** 使用独立编辑器查看文本、JSON、二进制与 NULL，待删除行不允许再编辑。 */
  function editCell() {
    if (!selection) return;
    const row = rows.find(row => row.id === selection.rowId); if (!row || row.deleted) return;
    const value = row.data[selection.key]; const type = info?.columns.find(column => column.name === selection.key)?.type ?? '';
    setCellDialog({ ...selection, text: value === null ? '' : cellText(value), mode: value === null ? 'null' : typeof value === 'object' ? 'binary' : /json/i.test(type) ? 'json' : 'text' });
  }
  /** 将当前草稿交给引擎生成参数化 SQL 预览，此步骤不修改数据库。 */
  async function makePreview() {
    setError(''); try { setPreview(await invoke('table.preview', { ...base, changes })); } catch (reason) { setError(errorMessage(reason)); }
  }
  /** 一次提交使用唯一任务编号；失败保留草稿，成功后重新读取服务器数据。 */
  async function apply() {
    setApplying(true); setError(''); useWorkspace.getState().setBusy(tab.id, true);
    const taskId = uid(); setApplyTaskId(taskId);
    try { const result = await invoke('table.apply', { ...base, changes, taskId }); setPreview(null); useWorkspace.getState().notify(formatText(zh.table.text003, result.affectedRows)); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setApplying(false); useWorkspace.getState().setBusy(tab.id, false); }
  }
  return <div className="workspace-tab table-tab"><div className="context-bar"><span className="connection-dot" style={{ background: connection?.color }}/><strong>{connection?.name ?? zh.common.connectionDeleted}</strong><span className="breadcrumb-divider">/</span>{tab.database}<span className="breadcrumb-divider">/</span><strong>{tab.table}</strong><span className="grow"/><span className="tag">{info?.engine || zh.table.text004}</span></div><div className="toolbar"><button onClick={() => { if (canReload()) void load(); }} disabled={busy}><RefreshCw size={14}/>{zh.common.refresh}</button><button disabled={!editable || busy} onClick={() => setRows(current => [...current, { id: uid(), data: {}, inserted: true, deleted: false }])}><Plus size={14}/>{zh.common.add}</button><button disabled={!editable || (!selection && !selectedRows.size) || busy} onClick={deleteSelected}><Trash2 size={14}/>{zh.common.delete}</button><button disabled={!selection || busy} onClick={editCell}><Eye size={14}/>{zh.table.text005}</button><span className="toolbar-divider"/><button className={showFilter || filters.length ? 'selected' : ''} onClick={() => setShowFilter(!showFilter)}><Filter size={14}/>{zh.table.text006}{filters.length > 0 ? ` (${filters.length})` : ''}</button><button disabled={!info || busy} onClick={() => onDesign(!info?.engine)}><SlidersHorizontal size={14}/>{info && !info.engine ? zh.table.text007 : zh.table.text008}</button><span className="grow"/><button onClick={() => onTransfer('import')}><ArrowDownToLine size={14}/>{zh.common.import}</button><button onClick={() => onTransfer('export')}><ArrowUpFromLine size={14}/>{zh.common.export}</button></div>{showFilter && <TableFilterPanel columns={info?.columns.map(column => column.name) ?? []} filters={filters} mode={filterMode} disabled={busy || applying} onFiltersChange={changeFilters} onModeChange={changeFilterMode}/>}<ErrorBox message={error}/>{info && !info.editableKey.length && <div className="info-strip">{zh.table.text014}</div>}<div className="table-grid-wrap">{busy && <div className="loading-overlay"><Spinner/></div>}<DataGrid<DraftRow, unknown, string> className={`results-grid rdg-${settings.theme}`} columns={columns} rows={rows} rowHeight={32} headerRowHeight={42} rowKeyGetter={row => row.id} rowClass={row => row.deleted ? 'row-deleted' : row.inserted ? 'row-inserted' : !rowEqual(row.original!, row.data) ? 'row-modified' : undefined} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onRowsChange={changeRows} onActivePositionChange={({ row, column }) => setSelection(row && column && page?.columns.some(item => item.key === column.key) ? { rowId: row.id, key: column.key } : undefined)} sortColumns={sort.map(item => ({ columnKey: item.column, direction: item.direction }))} onSortColumnsChange={next => { if (canReload()) { setSort(next.map(item => ({ column: item.columnKey, direction: item.direction }))); setPageIndex(1); } }} onCellCopy={copyCells} onCellPaste={pasteClipboard} onCellKeyDown={(args, event) => { if (args.mode !== 'ACTIVE' || busy) return; const { row: activeRow, column: activeColumn } = args; if (!activeRow || !activeColumn) return; if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && changes.length) { event.preventGridDefault(); event.preventDefault(); void makePreview(); } else if (event.key === 'Delete' && editable && !activeRow.deleted && page?.columns.some(item => item.key === activeColumn.key) && !info?.columns.find(item => item.name === activeColumn.key)?.generated) { event.preventGridDefault(); event.preventDefault(); setRows(current => current.map(row => row.id === activeRow.id ? { ...row, data: { ...row.data, [activeColumn.key]: info?.columns.find(item => item.name === activeColumn.key)?.nullable ? null : '' } } : row)); } }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/></div><div className="table-action-bar"><span className={changes.length ? 'warning-text' : 'muted'}>{changes.length ? formatText(zh.table.text015, changes.length) : formatText(zh.table.text016, page?.rows.length ?? 0)}</span>{changes.length > 0 && <><button disabled={busy || applying} onClick={() => { if (window.confirm(zh.table.text017)) void load(); }}><Undo2 size={13}/>{zh.table.text018}</button><button className="primary" disabled={busy || applying} onClick={() => void makePreview()}><Save size={13}/>{zh.table.text019}</button></>}<span className="grow"/><label className="inline-field">{zh.table.text020}<select aria-label={zh.table.text021} value={pageSize} disabled={busy || applying} onChange={event => { if (canReload()) { setPageIndex(1); setPageSize(Number(event.target.value)); useWorkspace.getState().updateSettings({ pageSize: Number(event.target.value) }); } }}>{[50, 100, 200, 500, 1000].map(size => <option key={size}>{size}</option>)}</select>{zh.table.text022}</label><form className="page-jump" title={zh.table.pageJumpHint} onSubmit={event => { event.preventDefault(); jumpToPage(); }}><input aria-label={zh.table.pageJumpLabel} inputMode="numeric" value={pageJump} disabled={busy || applying} onChange={event => setPageJump(event.target.value)}/><button type="submit" disabled={busy || applying}>{zh.table.pageJump}</button></form><button className="icon-button" aria-label={zh.common.pagePrevious} disabled={pageIndex === 1 || busy || applying} onClick={() => { if (canReload()) setPageIndex(current => current - 1); }}><ChevronLeft size={16}/></button><span>{zh.table.text023}{pageIndex}{zh.table.text024}</span><button className="icon-button" aria-label={zh.common.pageNext} disabled={!page?.hasMore || busy || applying || pageIndex >= maxTablePage} onClick={() => { if (canReload()) setPageIndex(current => current + 1); }}><ChevronRight size={16}/></button></div>
    {cellDialog && <Modal title={formatText(zh.table.text025, cellDialog.key)} onClose={() => setCellDialog(undefined)}><div className="modal-content"><Field label={zh.table.text026}><select value={cellDialog.mode} onChange={event => setCellDialog({ ...cellDialog, mode: event.target.value as typeof cellDialog.mode })}><option value="text">{zh.table.text027}</option><option value="json">JSON</option><option value="binary">{zh.table.text028}</option><option value="null">{zh.table.text029}</option></select></Field><textarea className="cell-textarea" disabled={cellDialog.mode === 'null'} value={cellDialog.text} onChange={event => setCellDialog({ ...cellDialog, text: event.target.value })}/><ErrorBox message={error}/></div><footer className="modal-footer"><span className="grow"/><button onClick={() => setCellDialog(undefined)}>{zh.common.close}</button><button className="primary" disabled={!editable || info?.columns.find(column => column.name === cellDialog.key)?.generated} onClick={() => { try { const value = parseCell(cellDialog.text, cellDialog.mode); setRows(current => current.map(row => row.id === cellDialog.rowId ? { ...row, data: { ...row.data, [cellDialog.key]: value } } : row)); setCellDialog(undefined); setError(''); } catch (reason) { setError(errorMessage(reason)); } }}>{zh.table.text030}</button></footer></Modal>}
    {preview && <Modal title={zh.table.text031} wide onClose={() => { if (!applying) setPreview(null); }}><div className="modal-content"><p>{zh.table.text032}{changes.length}{zh.table.text033}</p>{preview.warnings.map(warning => <p className="warning-text" key={warning}>{warning}</p>)}<SqlEditor value={preview.sql} height={280} readOnly/><ErrorBox message={error}/></div><footer className="modal-footer"><button disabled={applying} onClick={() => setPreview(null)}>{zh.common.backToEdit}</button><span className="grow"/>{applying && <button onClick={() => void invoke('query.cancel', { taskId: applyTaskId }).catch(reason => setError(errorMessage(reason)))}>{zh.table.text034}</button>}<button className="primary" disabled={applying} onClick={() => void apply()}>{applying ? <Spinner text={zh.table.text035}/> : zh.common.confirmApply}</button></footer></Modal>}
  </div>;
}
