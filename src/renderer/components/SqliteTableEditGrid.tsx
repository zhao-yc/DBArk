import { useLayoutEffect, useRef } from 'react';
import { DataGrid, type Column } from 'react-data-grid';
import type { SqliteDraftRow } from '../sqliteTableEditor';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteTableEditZh as text } from '../locales/sqliteTableEdit.zh-CN';

interface Props { page: SqliteTablePage; rows: SqliteDraftRow[]; disabled: boolean; selected?: string; isCurrent(): boolean; onSelect(row: SqliteDraftRow): void; onEdit(row: SqliteDraftRow, column: number): void; }
/** 仅 SQLite 编辑快照使用此虚拟网格；任意查询的 ResultsGrid 继续保持只读。 */
export function SqliteTableEditGrid({ page, rows, disabled, selected, isCurrent, onSelect, onEdit }: Props) {
  const ticket = {}, committed = useRef<object | undefined>(undefined);
  useLayoutEffect(() => { committed.current = ticket; return () => { if (committed.current === ticket) committed.current = undefined; }; });
  /** 虚拟行复用不授予旧对象权限，先核渲染票据和准确 rows 成员再转交父页。 */
  function current(row: SqliteDraftRow): boolean { return committed.current === ticket && isCurrent() && rows.includes(row); }
  const columns: Column<SqliteDraftRow>[] = [{ key: '__row', name: '#', width: 68, frozen: true, renderCell: ({ row }) => <button aria-label={text.select(rows.indexOf(row) + 1)} aria-pressed={selected === row.id} onClick={() => { if (current(row)) onSelect(row); }}>{rows.indexOf(row) + 1}</button> }, ...page.columns.map((column, index): Column<SqliteDraftRow> => ({
    key: 'c' + index, name: column.name + (column.generated ? ' · ' + text.generated : ''), width: 180, resizable: true,
    renderCell: ({ row }) => { const value = row.values[index]; return <span title={value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.value}>{value === undefined ? text.omitted : value.kind === 'null' ? 'NULL' : value.kind.toUpperCase() + ' · ' + value.value}</span>; },
  }))];
  /** F2 和双击都只打开本地 typed 编辑，不直接投递写入。 */
  function edit(row: SqliteDraftRow, key: string): void { const column = Number(key.slice(1)); if (current(row) && !disabled && !row.deleted && /^c\d+$/.test(key) && page.columns[column] && !page.columns[column].generated) onEdit(row, column); }
  return <DataGrid<SqliteDraftRow> aria-label={text.grid} className="results-grid" columns={columns} rows={rows} rowKeyGetter={row => row.id} rowHeight={32} headerRowHeight={42}
    rowClass={row => row.deleted ? 'row-deleted' : row.index === undefined ? 'row-inserted' : undefined}
    onCellClick={({ row }) => { if (current(row)) onSelect(row); }}
    onCellDoubleClick={({ row, column }, event) => { event.preventGridDefault(); edit(row, column.key); }}
    onCellKeyDown={({ row, column }, event) => { if (row && column && event.key === 'F2' && !event.nativeEvent.isComposing) { event.preventDefault(); event.preventGridDefault(); edit(row, column.key); } }}
    onActivePositionChange={({ row }) => { if (row && current(row)) onSelect(row); }}/ >;
}
