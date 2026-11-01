import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { DataGrid, SelectColumn, renderCheckbox, type Column, type DataGridHandle, type SortColumn } from 'react-data-grid';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../locales/sqliteTableClipboard.zh-CN';
import { encodeSqliteClipboard, writeSqliteClipboardData } from '../sqliteTableClipboard';
import { sqliteTableRangePasteZh as rangeText } from '../locales/sqliteTableRangePaste.zh-CN';
import type { SqlitePasteAnchor } from '../sqliteTableRangePaste';
import type { SqliteCheckedRows } from '../sqliteTableSelection';
import '../sqliteTableClipboard.css';
import { sqliteTableBrowseZh as browseText } from '../locales/sqliteTableBrowse.zh-CN';

export interface SqliteTableFindGridHit { id: string; page: SqliteTablePage; rows: readonly SqliteDraftRow[]; row: SqliteDraftRow; column: number; focus: boolean; range?: { start: number; end: number }; }
interface Props { page: SqliteTablePage; rows: SqliteDraftRow[]; disabled: boolean; selected?: string; isCurrent(): boolean; onSelect(row: SqliteDraftRow): void; onEdit(row: SqliteDraftRow, column: number): void; onPaste?(data: Pick<DataTransfer, 'types' | 'getData'>, anchor?: SqlitePasteAnchor): void; onActiveCell?(anchor: SqlitePasteAnchor | undefined): void; onFilterCell?(anchor: SqlitePasteAnchor | undefined): void; onCheckedRows?(selection: SqliteCheckedRows): void; findHit?: SqliteTableFindGridHit; sort?: readonly SortColumn[]; onSortChange?(next: readonly SortColumn[]): void; projection?: readonly { index: number; width?: number; frozen: boolean }[]; onColumnResize?(key: string, width: number): void; }
/** 仅SQLite编辑快照使用此虚拟网格；任意查询的ResultsGrid继续保持只读。 */
export function SqliteTableEditGrid({ page, rows, disabled, selected, isCurrent, onSelect, onEdit, onPaste, onActiveCell, onFilterCell, onCheckedRows, findHit, sort, onSortChange, projection, onColumnResize }: Props) {
  const display: readonly { index: number; width?: number; frozen: boolean }[] = projection ?? page.columns.map((_, index) => ({ index, frozen: false }));
  if (!display.length || new Set(display.map(column => column.index)).size !== display.length || display.some(column => !Number.isInteger(column.index) || column.index < 0 || column.index >= page.columns.length || column.width !== undefined && (!Number.isInteger(column.width) || column.width < 64 || column.width > 2000))) throw Error('SQLite显示列映射无效');
  const orderKey = JSON.stringify(display.map(column => column.index)), orderRef = useRef<{ key: string; indices: readonly number[] }>({ key: orderKey, indices: Object.freeze(display.map(column => column.index)) });
  if (orderRef.current.key !== orderKey) orderRef.current = { key: orderKey, indices: Object.freeze(display.map(column => column.index)) };
  const order = orderRef.current.indices, naturalOrder = order.length === page.columns.length && order.every((column, index) => column === index);
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  const grid = useRef<DataGridHandle | null>(null), handledFind = useRef<string | undefined>(undefined);
  const source = useRef({ page, rows, identity: {} }); if (source.current.page !== page || source.current.rows !== rows) source.current = { page, rows, identity: {} };
  const owner = source.current, [, selectionChanged] = useState(0), [error, setError] = useState('');
  const selection = useRef<{ owner: typeof owner; ids: ReadonlySet<string>; revision: object }>({ owner, ids: new Set(), revision: {} });
  if (selection.current.owner !== owner) selection.current = { owner, ids: new Set(), revision: {} };
  const selectedRows = selection.current.ids, selectionTicket = selection.current.revision;
  // capture只读最新已提交上下文，父接纳selection引发重渲染不会撤销同源勾选。
  const checkedContext = useRef<{ owner: typeof owner; disabled: boolean; isCurrent(): boolean } | undefined>(undefined);
  const checkedProof = useRef<{ owner: typeof owner; revision: object; capture: SqliteCheckedRows; canRenew(): boolean; invalidate(recoverable?: boolean): void } | undefined>(undefined), checkedNotified = useRef<SqliteCheckedRows | undefined>(undefined), checkedNotify = useRef(onCheckedRows); checkedNotify.current = onCheckedRows;
  if (checkedProof.current?.owner !== owner) checkedProof.current?.invalidate();
  else if (disabled) checkedProof.current?.invalidate(true);
  useLayoutEffect(() => { const context = { owner, disabled, isCurrent }; checkedContext.current = context; return () => { if (checkedContext.current === context) checkedContext.current = undefined; }; });
  /** 每个checkbox修订绑定完整非删除原行，临时失效后只能签新token，旧token永久拒绝。 */
  function checkedCapture(force = false): SqliteCheckedRows | undefined {
    if (source.current !== owner || selection.current.owner !== owner) return;
    const revision = selection.current.revision, previous = checkedProof.current;
    if (!force && previous?.owner === owner && previous.revision === revision) return previous.capture;
    previous?.invalidate();
    const originalRows = [...rows], targetSignature = JSON.stringify([page.target, page.schemaKey, page.columns, page.edit?.kind === 'editable' ? [page.edit.snapshotId, page.edit.columns] : page.edit]);
    const selected = Object.freeze(rows.filter(row => selection.current.ids.has(row.id) && !row.deleted)), original = selected.map(row => ({ row, id: row.id, index: row.index, values: row.values }));
    let valid = true, sourceValid = true, renewable = false;
    /** 来源失败留下独立墓碑，不能借临时disabled或Modal恢复重签到已变化的行。 */
    const sourceCurrent = () => {
      try {
        const actual = rows.filter(row => selection.current.ids.has(row.id) && !row.deleted);
        if (!sourceValid || source.current !== owner || selection.current.owner !== owner || selection.current.revision !== revision || rows.length !== originalRows.length || rows.some((row, index) => row !== originalRows[index]) || JSON.stringify([page.target, page.schemaKey, page.columns, page.edit?.kind === 'editable' ? [page.edit.snapshotId, page.edit.columns] : page.edit]) !== targetSignature || new Set(selected.map(row => row.id)).size !== selected.length || original.some(item => !rows.includes(item.row) || item.row.deleted || item.row.id !== item.id || item.row.index !== item.index || item.row.values !== item.values) || actual.length !== selected.length || actual.some((row, index) => row !== selected[index])) sourceValid = false;
      } catch { sourceValid = false; }
      if (!sourceValid) { valid = false; renewable = false; } return sourceValid;
    };
    const capture: SqliteCheckedRows = Object.freeze({ page, rows, selected, current() {
      if (!sourceCurrent() || !valid) return false;
      const context = checkedContext.current;
      try { if (!context || context.owner !== owner || context.disabled || !context.isCurrent() || !noModal()) { valid = false; renewable = true; } }
      catch { valid = false; renewable = true; }
      return valid;
    } });
    checkedProof.current = { owner, revision, capture, canRenew: () => sourceCurrent() && renewable, invalidate: (recoverable = false) => { valid = false; renewable = recoverable && sourceValid; } }; return capture;
  }
  /** 只在事件或准确新owner提交后通知；卸载不发无目标清空，避免覆盖继任capture。 */
  function notifyChecked(force = false): void { const capture = checkedCapture(force); if (!capture || checkedNotified.current === capture) return; checkedNotified.current = capture; try { checkedNotify.current?.(capture); } catch { checkedProof.current?.invalidate(); setError(rangeText.stale); } }
  useEffect(() => {
    const context = checkedContext.current; if (source.current !== owner || context?.owner !== owner) return;
    const previous = checkedProof.current;
    if (!previous || previous.owner !== owner || previous.revision !== selection.current.revision) { notifyChecked(); return; }
    if (previous.capture.current() || !previous.canRenew()) return;
    // 父layout与当前DOM均已提交，恢复时只签一次fresh token，不让旧授权复活。
    try { if (!context.disabled && context.isCurrent() && noModal()) notifyChecked(true); } catch { /* 当前门无法确认时保留旧墓碑。 */ }
  });
  const activeCell = useRef<{ owner: typeof owner; value?: SqlitePasteAnchor; position?: { row: SqliteDraftRow; key: string }; reason: string; revision: object }>({ owner, reason: rangeText.anchorRequired, revision: {} });
  if (activeCell.current.owner !== owner) activeCell.current = { owner, reason: rangeText.anchorRequired, revision: {} };
  const anchorTicket = activeCell.current.revision, notified = useRef<SqlitePasteAnchor | undefined>(undefined), notifyRef = useRef(onActiveCell); notifyRef.current = onActiveCell;
  const sameAnchor = (left: SqlitePasteAnchor | undefined, right: SqlitePasteAnchor | undefined) => left?.row === right?.row && left?.column === right?.column && left?.columns === right?.columns;
  /** 真正的cell事件同步通知，避免子layout先于父页渲染票据提交而丢掉准确起点。 */
  function notifyAnchor(value: SqlitePasteAnchor | undefined): void { if (sameAnchor(notified.current, value)) return; notified.current = value; try { notifyRef.current?.(value); } catch { setError(rangeText.stale); } }
  // 源page/rows重绑后的清空只在提交后通知；自己的disabled或Modal不改变真实活动位置。
  useEffect(() => { notifyAnchor(activeCell.current.value); });
  // 布局窗口关闭后重新签当前物理格的可见列顺序；隐藏的原格不再提供粘贴资格。
  useEffect(() => { const cell = activeCell.current; if (cell.position && (naturalOrder ? cell.value?.columns !== undefined : cell.value?.columns !== order)) captureCell(cell.position.row, cell.position.key); });
  useEffect(() => () => { if (notified.current !== undefined) { notified.current = undefined; try { notifyRef.current?.(undefined); } catch { /* 旧组件卸载不得向其它目标补发动作。 */ } } }, []);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  /** 父layout提交票据后才导航；一次token只滚动一次，焦点请求走RDG真实活动格API。 */
  useEffect(() => {
    const hit = findHit, handle = grid.current;
    if (!hit || handledFind.current === hit.id + orderKey || hit.page !== page || hit.rows !== rows || !rows.includes(hit.row) || hit.row.deleted || !Number.isInteger(hit.column) || hit.column < 0 || hit.column >= page.columns.length || disabled || !baseCurrent(hit.row) || !noModal() || !handle?.element || !handle.element.ownerDocument.contains(handle.element)) return;
    const displayed = order.indexOf(hit.column); if (displayed < 0) return;
    handledFind.current = hit.id + orderKey;
    const position = { rowIdx: rows.indexOf(hit.row), idx: displayed + 2 };
    handle.scrollToCell(position);
    if (hit.focus && baseCurrent(hit.row) && !disabled && noModal() && grid.current?.element === handle.element) handle.setActivePosition(position, { shouldFocus: true });
  }, [findHit, owner, disabled, orderKey]);
  /** 虚拟行复用不授予旧对象权限；复制同样检查原页和准确rows，不能从当前选中名称猜数据。 */
  function baseCurrent(row?: SqliteDraftRow): boolean { try { return committed.current === ticket && source.current === owner && isCurrent() && (!row || rows.includes(row)); } catch { return false; } }
  function localCurrent(): boolean { return committed.current === ticket && source.current === owner && selection.current.revision === selectionTicket && activeCell.current.revision === anchorTicket; }
  function current(row?: SqliteDraftRow): boolean { return localCurrent() && baseCurrent(row); }
  /** 起点只从RDG真实cell位置事件取得，不能借selectedRow、复选框或行号推测。 */
  function captureCell(row?: SqliteDraftRow, key = ''): void {
    if (!baseCurrent(row) || !noModal()) return;
    const column = Number(key.slice(1)), position = row ? { row, key } : undefined;
    // 筛选允许读取生成列；粘贴起点仍沿原可写字段限制。
    onFilterCell?.(!disabled && row && !row.deleted && /^c(?:0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(column) && order.includes(column) && page.columns[column] ? { row, column } : undefined);
    let reason: string = rangeText.anchorRequired, value: SqlitePasteAnchor | undefined;
    if (disabled || page.edit?.kind !== 'editable') reason = rangeText.readonly;
    else if (row?.deleted) reason = rangeText.deleted;
    else if (row && /^c(?:0|[1-9]\d*)$/.test(key) && Number.isSafeInteger(column) && order.includes(column) && page.columns[column]) { if (page.columns[column].generated || page.edit.columns[column]?.generated) reason = rangeText.generated; else { value = Object.freeze({ row, column, ...(!naturalOrder ? { columns: order } : {}) }); reason = ''; } }
    const before = activeCell.current;
    if (before.position?.row === position?.row && before.position?.key === position?.key && sameAnchor(before.value, value) && before.value?.columns === value?.columns && before.reason === reason) return;
    activeCell.current = { owner, value, position, reason, revision: {} }; notifyAnchor(value); selectionChanged(revision => revision + 1);
  }
  function noModal(): boolean { return !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 输入控件保留自己的剪贴板语义，不截获文字编辑器、搜索框或其它模态的copy/paste。 */
  function inputTarget(event: ClipboardEvent<HTMLDivElement>): boolean { const node = event.target as HTMLElement | null; return !!node && (node.isContentEditable || ['TEXTAREA', 'SELECT'].includes(node.tagName) || node.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((node as HTMLInputElement).type)); }
  const columns: Column<SqliteDraftRow>[] = [SelectColumn, { key: '__row', name: '#', width: 68, frozen: true, renderCell: ({ row }) => <button aria-label={text.select(rows.indexOf(row) + 1)} aria-pressed={selected === row.id} onClick={() => { if (baseCurrent(row)) { onSelect(row); captureCell(row, '__row'); } }}>{rows.indexOf(row) + 1}</button> }, ...display.map(({ index, width, frozen }): Column<SqliteDraftRow> => ({
    key: 'c' + index, name: page.columns[index].name + (page.columns[index].generated ? ' · ' + text.generated : ''), minWidth: 64, width: width ?? 180, frozen, resizable: true, sortable: !!onSortChange && !disabled,
    renderCell: ({ row }) => {
      const value = row.values[index], matched = findHit?.page === page && findHit.rows === rows && findHit.row === row && findHit.column === index && !row.deleted;
      const raw = value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.value, range = matched ? findHit.range : undefined;
      const precise = range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start && range.end <= raw.length;
      return <span title={raw} className={matched ? 'sqlite-find-hit' : undefined} data-sqlite-find-current={matched ? 'true' : undefined}>{value && value.kind !== 'null' ? value.kind.toUpperCase() + ' · ' : ''}{precise ? <>{raw.slice(0, range.start)}<mark className="sqlite-find-range">{raw.slice(range.start, range.end) || '\u200b'}</mark>{raw.slice(range.end)}</> : raw}</span>;
    },
  }))];
  /** F2和双击只打开本地typed编辑，不直接投递写入。 */
  function edit(row: SqliteDraftRow, key: string): void { const column = Number(key.slice(1)); if (current(row) && !disabled && !row.deleted && /^c\d+$/.test(key) && page.columns[column] && !page.columns[column].generated) onEdit(row, column); }
  /** RDG的真实copy事件同步写三种MIME；先编码完整内容，失败只清本事件已写的数据。 */
  function copy(row: SqliteDraftRow, key: string, event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event)) return; event.preventDefault();
    if (!current(row) || !noModal() || row.deleted) return;
    try {
      const checked = rows.filter(item => selectedRows.has(item.id) && !item.deleted), index = Number(key.slice(1));
      if (!checked.length && (!/^c\d+$/.test(key) || !order.includes(index) || !page.columns[index] || row.values.length !== page.columns.length)) return;
      if (checked.some(item => item.values.length !== page.columns.length)) throw Error(clipboardText.invalid);
      const values = checked.length ? checked.map(item => order.map(index => item.values[index])) : [[row.values[index]]], content = encodeSqliteClipboard(values, checked.length ? order.map(index => page.columns[index].name) : [page.columns[index].name]);
      if (!current(row) || !noModal()) return; writeSqliteClipboardData(event.clipboardData, content); setError('');
    } catch (reason) { try { event.clipboardData.clearData(); } catch { /* 仅原事件可清理，不借系统剪贴板重试。 */ } if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
  }
  /** 当前RDG无内联editor，onCellPaste不会派发；在原生capture接管一次，不伪造editable/onRowsChange。 */
  function paste(event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event) || !onPaste) return; event.preventDefault(); event.stopPropagation();
    if (!localCurrent()) return;
    if (!baseCurrent() || !noModal()) { setError(rangeText.stale); return; }
    if (disabled || page.edit?.kind !== 'editable') { setError(rangeText.readonly); return; }
    const target = event.target as HTMLElement | null, anchor = activeCell.current.value;
    if (target?.tagName === 'INPUT' || target?.tagName === 'BUTTON' || !anchor) { setError(activeCell.current.reason || rangeText.anchorRequired); return; }
    if (naturalOrder ? anchor.columns !== undefined : anchor.columns !== order) { setError(rangeText.stale); return; }
    if (!rows.includes(anchor.row) || anchor.row.deleted || !page.columns[anchor.column] || page.columns[anchor.column].generated || page.edit.columns[anchor.column]?.generated) { setError(rangeText.stale); return; }
    try { onPaste(event.clipboardData, anchor); setError(''); } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : rangeText.invalid); }
  }
  return <div className="sqlite-edit-clipboard-region" onPasteCapture={paste}>{error && <p role="alert">{error}</p>}<DataGrid<SqliteDraftRow, unknown, string> ref={grid} aria-label={text.grid} aria-description={onSortChange ? browseText.headerHint : undefined} className="results-grid" columns={columns} rows={rows} rowKeyGetter={row => row.id} rowHeight={32} headerRowHeight={42}
    sortColumns={sort} onSortColumnsChange={next => { if (!disabled && baseCurrent() && noModal()) onSortChange?.(next); }} onColumnResize={onColumnResize ? (column, width) => { if (!disabled && baseCurrent() && noModal() && /^c(?:0|[1-9]\d*)$/.test(column.key) && order.includes(Number(column.key.slice(1)))) onColumnResize(column.key, width); } : undefined}
    renderers={{ renderCheckbox: props => renderCheckbox({ ...props, 'aria-label': props['aria-label'] === 'Select All' ? clipboardText.copyAll : clipboardText.copyRow }) }}
    selectedRows={selectedRows} isRowSelectionDisabled={row => row.deleted} onSelectedRowsChange={ids => { if (!baseCurrent() || selection.current.revision !== selectionTicket || !noModal()) return; selection.current = { owner, ids: new Set(rows.filter(row => ids.has(row.id) && !row.deleted).map(row => row.id)), revision: {} }; notifyChecked(); selectionChanged(value => value + 1); }}
    rowClass={row => row.deleted ? 'row-deleted' : row.index === undefined ? 'row-inserted' : undefined}
    onCellClick={({ row, column }) => { if (baseCurrent(row)) { onSelect(row); captureCell(row, column?.key); } }}
    onCellDoubleClick={({ row, column }, event) => { event.preventGridDefault(); edit(row, column.key); }}
    onCellKeyDown={({ row, column }, event) => { if (row && column && event.key === 'F2' && !event.nativeEvent.isComposing) { event.preventDefault(); event.preventGridDefault(); edit(row, column.key); } }}
    onCellCopy={({ row, column }, event) => copy(row, column.key, event)}
    onActivePositionChange={({ row, column }) => { if (row && baseCurrent(row)) onSelect(row); captureCell(row, column?.key); }}/></div>;
}
