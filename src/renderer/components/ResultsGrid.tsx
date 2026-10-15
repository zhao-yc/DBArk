import { zh } from '../locales/zh-CN';
import { useEffect, useMemo, useState } from 'react';
import { DataGrid, SelectColumn, type Column } from 'react-data-grid';
import type { DataRow, ResultColumn, SortRule } from '../../shared/contracts';
import { cellPreview, errorMessage, ownCell } from '../lib';
import { BinaryCellViewer } from './BinaryCellViewer';
import { Modal } from './ui';
import { binaryCellZh } from '../locales/binaryCell.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { useWorkspace } from '../store';
import { cellClipboardType, encodeClipboard } from '../gridClipboard';

/** 任意查询结果只读；支持单格或勾选记录复制，始终保留原始值用于剪贴板。 */
export function ResultsGrid({ columns, rows, onActiveRowChange, sort, onSortChange }: { columns: ResultColumn[]; rows: DataRow[]; onActiveRowChange?: (row: DataRow | null) => void; sort?: SortRule[]; onSortChange?: (sort: SortRule[]) => void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(new Set());
  const [binary, setBinary] = useState<{ row: DataRow; key: string; rows: DataRow[]; columns: ResultColumn[] } | null>(null);
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setSelectedRows(new Set()); setBinary(null); onActiveRowChange?.(null); }, [columns, rows]);
  /** 任意 SQL 结果仅打开只读查看器，绝不从列名推测写表定位或提供写入回调。 */
  function viewBinary(row: DataRow, key: string) { if (isBinaryCell(ownCell(row, key), columns.find(column => column.key === key)?.type)) setBinary({ row, key, rows, columns }); }
  // 标题使用用户可见列名，值仍按唯一内部键定位；重复别名不能导致读取另一列。
  const binaryColumn = binary ? columns.find(column => column.key === binary.key) : undefined;
  const gridColumns = useMemo<Column<DataRow>[]>(() => [...(onActiveRowChange ? [] : [SelectColumn]), ...columns.map<Column<DataRow>>(column => ({ key: column.key, name: column.name, resizable: true, minWidth: 110, width: 170, sortable: !!onSortChange, renderHeaderCell: () => <span title={column.type}>{column.name}<small className="column-type">{column.type}</small></span>, renderCell: ({ row }) => <span className={row[column.key] === null ? 'null-value' : ''} title={cellPreview(row[column.key])}>{cellPreview(row[column.key])}</span> }))], [columns, onActiveRowChange, onSortChange]);
  return <><DataGrid<DataRow, unknown, number> className={`results-grid rdg-${theme}`} columns={gridColumns} rows={rows} onCellDoubleClick={({ row, column }) => viewBinary(row, column.key)} onCellKeyDown={({ row, column }, event) => { if (row && column && event.key === 'Enter' && !event.nativeEvent.isComposing && isBinaryCell(ownCell(row, column.key), columns.find(item => item.key === column.key)?.type)) { event.preventGridDefault(); event.preventDefault(); viewBinary(row, column.key); } }} rowHeight={32} headerRowHeight={40} rowKeyGetter={row => rowIndexes.get(row)!} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onActivePositionChange={({ row }) => onActiveRowChange?.(row ?? null)} sortColumns={sort?.map(rule => ({ columnKey: rule.column, direction: rule.direction }))} onSortColumnsChange={next => onSortChange?.(next.map(rule => ({ column: rule.columnKey, direction: rule.direction })))} onCellCopy={({ row, column }, event) => {
    if (!selectedRows.size && !columns.some(item => item.key === column.key)) return;
    const values = selectedRows.size ? rows.filter((_, index) => selectedRows.has(index)).map(row => columns.map(column => row[column.key] ?? null)) : [[row[column.key] ?? null]];
    event.preventDefault();
    try { const content = encodeClipboard(values); event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData(cellClipboardType, content.typed); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/>{binary && binaryColumn && binary.rows === rows && binary.columns === columns && <Modal title={`${binaryCellZh.title}：${binaryColumn.name}`} onClose={() => setBinary(null)} wide><div className="modal-content"><BinaryCellViewer value={ownCell(binary.row, binary.key)} reason={binaryCellZh.readonly}/></div></Modal>}</>;
}
