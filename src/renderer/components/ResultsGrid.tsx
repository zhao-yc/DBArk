import { zh } from '../locales/zh-CN';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type DataGridHandle, type Column } from 'react-data-grid';
import type { CellValue, DataRow, ResultColumn, SortRule } from '../../shared/contracts';
import { cellPreview, errorMessage, ownCell } from '../lib';
import { BinaryCellViewer } from './BinaryCellViewer';
import { Modal } from './ui';
import { binaryCellZh } from '../locales/binaryCell.zh-CN';
import { isBinaryCell } from '../binaryCell';
import { DataTypeColor } from './DataTypeColor';
import { useWorkspace } from '../store';
import { cellClipboardType, encodeClipboard, maxClipboardCells } from '../gridClipboard';
import type { ResultGridSelection } from '../resultExport';
import { QueryResultFind, type QueryResultFindHit } from './QueryResultFind';
import { encodeQueryResultWithHeaders, writeQueryResultWithHeaders, type QueryResultCopyCell } from '../queryResultHeaderCopy';
import { queryResultCopyZh as copyText } from '../locales/queryResultCopy.zh-CN';
import '../queryResultCopy.css';

/** 任意结果的协议BLOB也可能是TEXT；没有真实结构时只认显式字节包装，NULL仍常规展示。 */
export function isResultBinaryCell(value: CellValue | undefined): boolean { return isBinaryCell(value); }

/** 任意查询结果只读；支持单格或勾选记录复制，始终保留原始值用于剪贴板。 */
export function ResultsGrid({ columns, rows, onActiveRowChange, onActiveRowIndexChange, sort, onSortChange, selectionScope, onSelectionChange, isCurrent }: { columns: ResultColumn[]; rows: DataRow[]; onActiveRowChange?: (row: DataRow | null) => void; onActiveRowIndexChange?: (index: number | null) => void; sort?: SortRule[]; onSortChange?: (sort: SortRule[]) => void; selectionScope?: object; onSelectionChange?(selection: ResultGridSelection): boolean; isCurrent?(): boolean }) {
  const theme = useWorkspace(state => state.settings.theme);
  const dataTypeColors = useWorkspace(state => state.settings.dataTypeColors === true);
  const [gridRevision,setGridRevision]=useState(0), gridRevisionRef=useRef(0);
  const scope = useMemo(() => ({ columns, rows, selectionScope }), [columns, rows, selectionScope,gridRevision]);
  const currentScope = useRef<typeof scope|null>(scope); currentScope.current = scope;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;currentScope.current=null;};},[]);
  /** 全部网格回调核同一准确scope及父接纳门，不能在切换／模态／卸载后复制旧数据。 */
  function actionCurrent():boolean {if(!alive.current||currentScope.current!==scope||gridRevisionRef.current!==gridRevision)return false;try{return !isCurrent||isCurrent()===true;}catch{return false;}}
  const gridRef = useRef<DataGridHandle | null>(null);
  const [findHit, setFindHit] = useState<{ scope: typeof scope; hit: QueryResultFindHit }>();
  const activeHit = findHit?.scope === scope && findHit.hit.scan.current() && actionCurrent() ? findHit.hit.match : undefined;
  const [selection, setSelection] = useState<{ scope: typeof scope; indices: ReadonlySet<number> }>();
  const selectedRows = selection?.scope === scope ? selection.indices : new Set<number>();
  const [headerCell, setHeaderCell] = useState<{ scope: typeof scope; cell: QueryResultCopyCell }>();
  const copyRevisionRef = useRef(0), copyRevision = copyRevisionRef.current;
  const activeCopyCell = headerCell?.scope === scope ? headerCell.cell : undefined;
  /** 同坐标重选不一定通知活动位置；显式点击仍须重新核验当前行列。 */
  function captureCopyCell(row: DataRow | undefined, rowIdx: number, column?: { key: string }) {
    if (!actionCurrent() || !selectionScope || !isCurrent || onActiveRowChange) return;
    copyRevisionRef.current++;
    setHeaderCell(row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row && (!column || columns.some(item => item.key === column.key)) ? { scope, cell: { index: rowIdx, row, column: columns.find(item => item.key === column?.key) } } : undefined);
  }
  /** 旧网格回调在首次effect前也不能覆盖新选择；复制仍沿用同一组当前勾选行。 */
  function setSelectedRows(indices: ReadonlySet<number>) {
    if (!actionCurrent()) return;
    const next = new Set(indices);
    // 导出父级须明确接纳同一选择；模态或任务门拒绝时保留原勾选，避免显示与文件范围分离。
    if (onSelectionChange && onSelectionChange({ scope: selectionScope ?? scope, rows, columns, indices: next }) !== true) return;
    if (!actionCurrent()) return;
    copyRevisionRef.current++; setSelection({ scope, indices: next });
  }
  /** 既有选择接口不变；新入口独立核渲染代次，旧按钮不能复制后来变更之前的行/列。 */
  function copyWithHeaders() {
    const current = () => actionCurrent() && copyRevisionRef.current === copyRevision;
    if (!current()) return;
    try { writeQueryResultWithHeaders(encodeQueryResultWithHeaders(columns, rows, selectedRows, activeCopyCell), current); }
    catch (reason) { useWorkspace.getState().notify(errorMessage(reason), true); }
  }
  const [binary, setBinary] = useState<{ row: DataRow; key: string; rows: DataRow[]; columns: ResultColumn[] } | null>(null);
  const binaryRef=useRef(binary);binaryRef.current=binary;
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setBinary(null); onActiveRowChange?.(null); }, [columns, rows]);
  /** 任意 SQL 结果仅打开只读查看器，绝不从列名推测写表定位或提供写入回调。 */
  function viewBinary(row: DataRow, key: string) { if (actionCurrent() && rowIndexes.has(row) && columns.some(column=>column.key===key) && isResultBinaryCell(ownCell(row, key))) {gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary({ row, key, rows, columns });} }
  // 标题使用用户可见列名，值仍按唯一内部键定位；重复别名不能导致读取另一列。
  const binaryColumn = binary ? columns.find(column => column.key === binary.key) : undefined;
  const gridColumns = useMemo<Column<DataRow>[]>(() => [...(onActiveRowChange ? [] : [SelectColumn]), ...columns.map<Column<DataRow>>((column, index) => ({ key: column.key, name: column.name, cellClass: row => activeHit?.row === rowIndexes.get(row) && activeHit?.column === index ? 'query-result-find-hit' : undefined, resizable: true, minWidth: 110, width: 170, sortable: !!onSortChange, renderHeaderCell: () => <span title={column.type}>{column.name}<small className="column-type">{column.type}</small></span>, renderCell: ({ row, tabIndex }) => <DataTypeColor enabled={dataTypeColors} selected={tabIndex === 0 || selectedRows.has(rowIndexes.get(row)!)} value={row[column.key]} type={column.type} source="protocol" className={row[column.key] === null ? 'null-value' : ''} title={cellPreview(row[column.key])}>{cellPreview(row[column.key])}</DataTypeColor> }))], [columns, onActiveRowChange, onSortChange, activeHit, dataTypeColors, dataTypeColors ? selectedRows : null, dataTypeColors ? rowIndexes : null]);
  const grid = <DataGrid<DataRow, unknown, number> ref={gridRef} className={`results-grid rdg-${theme}`} columns={gridColumns} rows={rows} onCellClick={selectionScope && isCurrent && !onActiveRowChange ? ({ row, rowIdx, column }) => captureCopyCell(row, rowIdx, column) : undefined} onCellDoubleClick={({ row, column }) => viewBinary(row, column.key)} onCellKeyDown={({ row, column }, event) => { if (row && column && event.key === 'Enter' && !event.nativeEvent.isComposing && isResultBinaryCell(ownCell(row, column.key))) { event.preventGridDefault(); event.preventDefault(); viewBinary(row, column.key); } }} rowHeight={32} headerRowHeight={40} rowKeyGetter={row => rowIndexes.get(row)!} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onActivePositionChange={({ row, rowIdx, column }) => { if (!actionCurrent()) return; captureCopyCell(row, rowIdx, column); onActiveRowChange?.(row ?? null); onActiveRowIndexChange?.(row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row ? rowIdx : null); }} sortColumns={sort?.map(rule => ({ columnKey: rule.column, direction: rule.direction }))} onSortColumnsChange={next => {if(actionCurrent())onSortChange?.(next.map(rule => ({ column: rule.columnKey, direction: rule.direction })));}} onCellCopy={({ row, column }, event) => {
    event.preventDefault();
    if(!actionCurrent()||!rowIndexes.has(row)||!selectedRows.size&&!columns.some(item=>item.key===column.key))return;
    try {
      if(selectedRows.size*columns.length>maxClipboardCells)throw Error(zh.clipboard.copyLimit);
      const indices=[...selectedRows].sort((a,b)=>a-b);
      if(indices.some(index=>!Number.isSafeInteger(index)||index<0||index>=rows.length))return;
      const values=indices.length?indices.map(index=>columns.map(column=>ownCell(rows[index],column.key))):[[ownCell(row,column.key)]];
      const content=encodeClipboard(values);event.clipboardData.setData('text/plain',content.text);event.clipboardData.setData(cellClipboardType,content.typed);
    }catch(reason){useWorkspace.getState().notify(errorMessage(reason),true);}
  }} renderers={{ noRowsFallback: <div className="grid-empty">{zh.common.noMatchingData}</div> }}/>;
  return <>{selectionScope && isCurrent && !onActiveRowChange ? <div className="query-result-copy-region"><div className="query-result-copy-actions"><button type="button" title={copyText.hint} disabled={!actionCurrent() || !selectedRows.size && !activeCopyCell} onClick={copyWithHeaders}>{copyText.action}</button></div><QueryResultFind owner={scope} rows={rows} columns={columns} grid={gridRef} isCurrent={actionCurrent} onHit={hit => { if (currentScope.current === scope && alive.current) setFindHit(hit ? { scope, hit } : undefined); }}>{grid}</QueryResultFind></div> : grid}{binary && binaryColumn && binary.rows === rows && binary.columns === columns && <Modal title={`${binaryCellZh.title}：${binaryColumn.name}`} onClose={() => {if(alive.current&&currentScope.current===scope&&binaryRef.current===binary){gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary(null);}}} wide><div className="modal-content"><BinaryCellViewer value={ownCell(binary.row, binary.key)} reason={binaryCellZh.readonly}/></div></Modal>}</>;
}
