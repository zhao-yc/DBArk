import { zh } from '../locales/zh-CN';
import { useEffect, useMemo, useState } from 'react';
import { DataGrid, SelectColumn, type Column } from 'react-data-grid';
import type { DataRow, ResultColumn } from '../../shared/contracts';
import { cellPreview, errorMessage } from '../lib';
import { useWorkspace } from '../store';
import { cellClipboardType, encodeClipboard } from '../gridClipboard';

/** 任意查询结果只读；支持单格或勾选记录复制，始终保留原始值用于剪贴板。 */
export function ResultsGrid({ columns, rows }: { columns: ResultColumn[]; rows: DataRow[] }) {
  const theme = useWorkspace(state => state.settings.theme);
  const [selectedRows, setSelectedRows] = useState<ReadonlySet<number>>(new Set());
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setSelectedRows(new Set()); }, [columns]);
  const gridColumns = useMemo<Column<DataRow>[]>(() => [SelectColumn, ...columns.map<Column<DataRow>>(column => ({ key: column.key, name: column.name, resizable: true, minWidth: 110, width: 170, renderHeaderCell: () => <span title={column.type}>{column.name}<small className="column-type">{column.type}</small></span>, renderCell: ({ row }) => <span className={row[column.key] === null ? 'null-value' : ''} title={cellPreview(row[column.key])}>{cellPreview(row[column.key])}</span> }))], [columns]);
  return <DataGrid<DataRow, unknown, number> className={`results-grid rdg-${theme}`} columns={gridColumns} rows={rows} rowHeight={32} headerRowHeight={40} rowKeyGetter={row => rowIndexes.get(row)!} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onCellCopy={({ row, column }, event) => {
    if (!selectedRows.size && !columns.some(item => item.key === column.key)) return;
    const values = selectedRows.size ? rows.filter((_, index) => selectedRows.has(index)).map(row => columns.map(column => row[column.key] ?? null)) : [[row[column.key] ?? null]];
    event.preventDefault();
    try { const content = encodeClipboard(values); event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData(cellClipboardType, content.typed); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/>;
}
