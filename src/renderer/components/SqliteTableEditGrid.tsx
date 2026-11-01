import { useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { DataGrid, SelectColumn, renderCheckbox, type Column } from 'react-data-grid';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../locales/sqliteTableClipboard.zh-CN';
import { encodeSqliteClipboard, writeSqliteClipboardData } from '../sqliteTableClipboard';
import '../sqliteTableClipboard.css';

interface Props { page: SqliteTablePage; rows: SqliteDraftRow[]; disabled: boolean; selected?: string; isCurrent(): boolean; onSelect(row: SqliteDraftRow): void; onEdit(row: SqliteDraftRow, column: number): void; onPaste?(data: Pick<DataTransfer, 'types' | 'getData'>): void; }
/** 仅SQLite编辑快照使用此虚拟网格；任意查询的ResultsGrid继续保持只读。 */
export function SqliteTableEditGrid({ page, rows, disabled, selected, isCurrent, onSelect, onEdit, onPaste }: Props) {
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  const source = useRef({ page, rows, identity: {} }); if (source.current.page !== page || source.current.rows !== rows) source.current = { page, rows, identity: {} };
  const owner = source.current, [, selectionChanged] = useState(0), [error, setError] = useState('');
  const selection = useRef<{ owner: typeof owner; ids: ReadonlySet<string>; revision: object }>({ owner, ids: new Set(), revision: {} });
  if (selection.current.owner !== owner) selection.current = { owner, ids: new Set(), revision: {} };
  const selectedRows = selection.current.ids, selectionTicket = selection.current.revision;
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  /** 虚拟行复用不授予旧对象权限；复制同样检查原页和准确rows，不能从当前选中名称猜数据。 */
  function current(row?: SqliteDraftRow): boolean { try { return committed.current === ticket && source.current === owner && selection.current.revision === selectionTicket && isCurrent() && (!row || rows.includes(row)); } catch { return false; } }
  function noModal(): boolean { return !document.querySelector('[role="dialog"], [role="alertdialog"]'); }
  /** 输入控件保留自己的剪贴板语义，不截获文字编辑器、搜索框或其它模态的copy/paste。 */
  function inputTarget(event: ClipboardEvent<HTMLDivElement>): boolean { const node = event.target as HTMLElement | null; return !!node && (node.isContentEditable || ['TEXTAREA', 'SELECT'].includes(node.tagName) || node.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((node as HTMLInputElement).type)); }
  const columns: Column<SqliteDraftRow>[] = [SelectColumn, { key: '__row', name: '#', width: 68, frozen: true, renderCell: ({ row }) => <button aria-label={text.select(rows.indexOf(row) + 1)} aria-pressed={selected === row.id} onClick={() => { if (current(row)) onSelect(row); }}>{rows.indexOf(row) + 1}</button> }, ...page.columns.map((column, index): Column<SqliteDraftRow> => ({
    key: 'c' + index, name: column.name + (column.generated ? ' · ' + text.generated : ''), width: 180, resizable: true,
    renderCell: ({ row }) => { const value = row.values[index]; return <span title={value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.value}>{value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.kind.toUpperCase() + ' · ' + value.value}</span>; },
  }))];
  /** F2和双击只打开本地typed编辑，不直接投递写入。 */
  function edit(row: SqliteDraftRow, key: string): void { const column = Number(key.slice(1)); if (current(row) && !disabled && !row.deleted && /^c\d+$/.test(key) && page.columns[column] && !page.columns[column].generated) onEdit(row, column); }
  /** RDG的真实copy事件同步写三种MIME；先编码完整内容，失败只清本事件已写的数据。 */
  function copy(row: SqliteDraftRow, key: string, event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event)) return; event.preventDefault();
    if (!current(row) || !noModal() || row.deleted) return;
    try {
      const checked = rows.filter(item => selectedRows.has(item.id) && !item.deleted), index = Number(key.slice(1));
      if (!checked.length && (!/^c\d+$/.test(key) || !page.columns[index] || row.values.length !== page.columns.length)) return;
      if (checked.some(item => item.values.length !== page.columns.length)) throw Error(clipboardText.invalid);
      const values = checked.length ? checked.map(item => item.values) : [[row.values[index]]], content = encodeSqliteClipboard(values, checked.length ? page.columns.map(column => column.name) : [page.columns[index].name]);
      if (!current(row) || !noModal()) return; writeSqliteClipboardData(event.clipboardData, content); setError('');
    } catch (reason) { try { event.clipboardData.clearData(); } catch { /* 仅原事件可清理，不借系统剪贴板重试。 */ } if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
  }
  /** 当前RDG无内联editor，onCellPaste不会派发；在原生capture接管一次，不伪造editable/onRowsChange。 */
  function paste(event: ClipboardEvent<HTMLDivElement>): void {
    if (inputTarget(event) || !onPaste) return; event.preventDefault(); event.stopPropagation();
    if (!current() || !noModal() || disabled) return;
    try { onPaste(event.clipboardData); setError(''); } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : clipboardText.invalid); }
  }
  return <div className="sqlite-edit-clipboard-region" onPasteCapture={paste}>{error && <p role="alert">{error}</p>}<DataGrid<SqliteDraftRow, unknown, string> aria-label={text.grid} className="results-grid" columns={columns} rows={rows} rowKeyGetter={row => row.id} rowHeight={32} headerRowHeight={42}
    renderers={{ renderCheckbox: props => renderCheckbox({ ...props, 'aria-label': props['aria-label'] === 'Select All' ? clipboardText.copyAll : clipboardText.copyRow }) }}
    selectedRows={selectedRows} isRowSelectionDisabled={row => row.deleted} onSelectedRowsChange={ids => { if (!current() || !noModal()) return; selection.current = { owner, ids: new Set(rows.filter(row => ids.has(row.id) && !row.deleted).map(row => row.id)), revision: {} }; selectionChanged(value => value + 1); }}
    rowClass={row => row.deleted ? 'row-deleted' : row.index === undefined ? 'row-inserted' : undefined}
    onCellClick={({ row }) => { if (current(row)) onSelect(row); }}
    onCellDoubleClick={({ row, column }, event) => { event.preventGridDefault(); edit(row, column.key); }}
    onCellKeyDown={({ row, column }, event) => { if (row && column && event.key === 'F2' && !event.nativeEvent.isComposing) { event.preventDefault(); event.preventGridDefault(); edit(row, column.key); } }}
    onCellCopy={({ row, column }, event) => copy(row, column.key, event)}
    onActivePositionChange={({ row }) => { if (row && current(row)) onSelect(row); }}/></div>;
}
