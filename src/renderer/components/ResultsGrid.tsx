import { zh } from '../locales/zh-CN';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, SelectColumn, type DataGridHandle, type Column, type CellKeyDownArgs, type CellKeyboardEvent } from 'react-data-grid';
import type { CellValue, DataRow, ResultColumn } from '../../shared/contracts';
import type { QueryResultSortRule } from '../queryResultSort';
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
import { queryResultSortZh as sortText } from '../locales/queryResultSort.zh-CN';
import { captureQueryResultCellFilter, currentQueryResultCellFilter, type CellFilterOperator, type QueryResultCellFilterCapture } from '../queryResultCellFilter';
import { queryResultFilterZh as filterText } from '../locales/queryResultFilter.zh-CN';
import { queryResultHistoryZh as historyText } from '../locales/queryResultHistory.zh-CN';

/** 任意结果的协议BLOB也可能是TEXT；没有真实结构时只认显式字节包装，NULL仍常规展示。 */
export function isResultBinaryCell(value: CellValue | undefined): boolean { return isBinaryCell(value); }

/** 任意查询结果只读；支持单格或勾选记录复制，始终保留原始值用于剪贴板。 */
export function ResultsGrid({ columns, rows, onActiveRowChange, onActiveRowIndexChange, sort, onSortChange, sortReasons, selectionScope, onSelectionChange, isCurrent, onFilterCell, onHistoryTravel }: { columns: ResultColumn[]; rows: DataRow[]; onActiveRowChange?: (row: DataRow | null) => void; onActiveRowIndexChange?: (index: number | null) => void; sort?: QueryResultSortRule[]; onSortChange?: (sort: QueryResultSortRule[]) => void; sortReasons?: ReadonlyMap<string, string | undefined>; selectionScope?: object; onSelectionChange?(selection: ResultGridSelection): boolean; isCurrent?(): boolean;onFilterCell?(cell:QueryResultCopyCell,operator:CellFilterOperator):void;onHistoryTravel?(direction:-1|1):void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const dataTypeColors = useWorkspace(state => state.settings.dataTypeColors === true);
  const [gridRevision,setGridRevision]=useState(0), gridRevisionRef=useRef(0);
  const filterCapable=!!onFilterCell&&!onActiveRowChange;
  const scope = useMemo(() => ({ columns, rows, selectionScope,filterCapable }), [columns, rows, selectionScope,gridRevision,filterCapable]);
  const currentScope = useRef<typeof scope|null>(scope); currentScope.current = scope;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;currentScope.current=null;};},[]);
  /** 全部网格回调核同一准确scope及父接纳门，不能在切换／模态／卸载后复制旧数据。 */
  function actionCurrent():boolean {if(!alive.current||currentScope.current!==scope||gridRevisionRef.current!==gridRevision)return false;try{return !isCurrent||isCurrent()===true;}catch{return false;}}
  /** RDG只回传列和方向；同一活列继承NULL位置及大小写选项，删除后重加则回到默认。 */
  function changeSortColumns(next:readonly {columnKey:string;direction:'ASC'|'DESC'}[]):void{
    if(!actionCurrent())return;
    onSortChange?.(next.map(rule=>{const previous=sort?.find(previous=>previous.column===rule.columnKey);return{column:rule.columnKey,direction:rule.direction,...(previous?.nulls?{nulls:previous.nulls}:{}),...(previous?.ignoreCase!==undefined?{ignoreCase:previous.ignoreCase}:{})};}));
  }
  const gridRef = useRef<DataGridHandle | null>(null);
  const [findHit, setFindHit] = useState<{ scope: typeof scope; hit: QueryResultFindHit }>();
  const activeHit = findHit?.scope === scope && findHit.hit.scan.current() && actionCurrent() ? findHit.hit.match : undefined;
  const [selection, setSelection] = useState<{ scope: typeof scope; indices: ReadonlySet<number> }>();
  const selectedRows = selection?.scope === scope ? selection.indices : new Set<number>();
  const [headerCell, setHeaderCell] = useState<{ scope: typeof scope; cell: QueryResultCopyCell }>();
  const copyRevisionRef = useRef(0), copyRevision = copyRevisionRef.current;
  const filterCellRef=useRef<{scope:typeof scope;capture:QueryResultCellFilterCapture}|undefined>(undefined);
  const activeCopyCell = headerCell?.scope === scope ? headerCell.cell : undefined;
  /** 同坐标重选不一定通知活动位置；显式点击仍须重新核验当前行列。 */
  function captureCopyCell(row: DataRow | undefined, rowIdx: number, column?: { key: string }) {
    if (!actionCurrent() || !selectionScope || !isCurrent || onActiveRowChange) return;
    copyRevisionRef.current++;
    const next=row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row && (!column || columns.some(item => item.key === column.key)) ? { scope, cell: { index: rowIdx, row, column: columns.find(item => item.key === column?.key) } } : undefined;
    filterCellRef.current=undefined;
    if(onFilterCell&&next)try{filterCellRef.current={scope,capture:captureQueryResultCellFilter(columns,rows,next.cell)};}catch{/* 不支持的原值仅禁用快捷填入，不影响原复制或查看。 */}
    setHeaderCell(next);
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
  /** 单格漂移一旦观察就撤销，恢复旧值也不能复活原按钮；新选择必须重新捕获。 */
  function filterCellCurrent(expected:typeof filterCellRef.current):boolean{
    if(!expected||filterCellRef.current!==expected||expected.scope!==scope||!actionCurrent())return false;
    try{if(currentQueryResultCellFilter(expected.capture,columns,rows))return true;}catch{}
    filterCellRef.current=undefined;return false;
  }
  const filterCell=filterCellRef.current,filterCellAllowed=!!onFilterCell&&filterCellCurrent(filterCell);
  /** 只提出当前原格请求；父级再次核准确结果并打开草稿，绝不自动应用或执行SQL。 */
  function filterFromCell(operator:CellFilterOperator):void{
    if(copyRevisionRef.current!==copyRevision||!filterCellCurrent(filterCell)||!onFilterCell)return;
    onFilterCell(filterCell!.capture.cell,operator);
  }
  const [binary, setBinary] = useState<{ row: DataRow; key: string; rows: DataRow[]; columns: ResultColumn[] } | null>(null);
  const binaryRef=useRef(binary);binaryRef.current=binary;
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setBinary(null); onActiveRowChange?.(null); }, [columns, rows]);
  /** 任意 SQL 结果仅打开只读查看器，绝不从列名推测写表定位或提供写入回调。 */
  function viewBinary(row: DataRow, key: string) { if (actionCurrent() && rowIndexes.has(row) && columns.some(column=>column.key===key) && isResultBinaryCell(ownCell(row, key))) {gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary({ row, key, rows, columns });} }
  /** 整理快捷键仅属于当前只读网格；输入框、编辑模式和旧渲染不能借此撤销正文或另一结果。 */
  function cellKeyDown(args:CellKeyDownArgs<DataRow>,event:CellKeyboardEvent):void{
    const {row,column}=args,key=event.key.toLowerCase();
    const historyKey=(event.ctrlKey||event.metaKey)&&!event.altKey&&(key==='z'||key==='y'&&event.ctrlKey&&!event.metaKey&&!event.shiftKey);
    if(historyKey&&onHistoryTravel&&selectionScope&&isCurrent&&!onActiveRowChange){
      const target=event.target as HTMLElement;
      if(event.defaultPrevented||event.nativeEvent.isComposing||event.keyCode===229||event.isGridDefaultPrevented()||args.mode!=='ACTIVE'||!target||target.nodeType!==1||target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName)||!column||!columns.some(item=>item.key===column.key)||!(row===undefined?args.rowIdx===-1:rows[args.rowIdx]===row)||!actionCurrent())return;
      event.preventGridDefault();event.preventDefault();event.stopPropagation();
      // 长按只消费当前命令，避免一次按键跨越多步；下一次明确按键重新核当前租约。
      if(!event.repeat)onHistoryTravel(key==='y'||event.shiftKey?1:-1);
      return;
    }
    if(row&&column&&event.key==='Enter'&&!event.nativeEvent.isComposing&&isResultBinaryCell(ownCell(row,column.key))){event.preventGridDefault();event.preventDefault();viewBinary(row,column.key);}
  }
  // 标题使用用户可见列名，值仍按唯一内部键定位；重复别名不能导致读取另一列。
  const binaryColumn = binary ? columns.find(column => column.key === binary.key) : undefined;
  const gridColumns = useMemo<Column<DataRow>[]>(() => [...(onActiveRowChange ? [] : [SelectColumn]), ...columns.map<Column<DataRow>>((column, index) => ({ key: column.key, name: column.name, cellClass: row => activeHit?.row === rowIndexes.get(row) && activeHit?.column === index ? 'query-result-find-hit' : undefined, resizable: true, minWidth: 110, width: 170, sortable: !!onSortChange && !sortReasons?.get(column.key), renderHeaderCell: () => <span title={sortReasons?.get(column.key) ?? (onSortChange ? sortText.keyboard : column.type)}>{column.name}<small className="column-type">{column.type}</small>{sort?.find(rule => rule.column === column.key) && <span aria-label={sort.find(rule => rule.column === column.key)!.direction === 'ASC' ? sortText.ascending : sortText.descending} title={sortText.priority(sort.findIndex(rule => rule.column === column.key)+1,column.name)}>{sort.findIndex(rule => rule.column === column.key)+1}{sort.find(rule => rule.column === column.key)!.direction === 'ASC' ? ' ↑' : ' ↓'}</span>}</span>, renderCell: ({ row, tabIndex }) => <DataTypeColor enabled={dataTypeColors} selected={tabIndex === 0 || selectedRows.has(rowIndexes.get(row)!)} value={row[column.key]} type={column.type} source="protocol" className={row[column.key] === null ? 'null-value' : ''} title={cellPreview(row[column.key])}>{cellPreview(row[column.key])}</DataTypeColor> }))], [columns, onActiveRowChange, onSortChange, sort, sortReasons, activeHit, dataTypeColors, dataTypeColors ? selectedRows : null, dataTypeColors ? rowIndexes : null]);
  const grid = <DataGrid<DataRow, unknown, number> ref={gridRef} aria-description={onHistoryTravel ? historyText.shortcuts : undefined} className={`results-grid rdg-${theme}`} columns={gridColumns} rows={rows} onCellClick={selectionScope && isCurrent && !onActiveRowChange ? ({ row, rowIdx, column }) => captureCopyCell(row, rowIdx, column) : undefined} onCellDoubleClick={({ row, column }) => viewBinary(row, column.key)} onCellKeyDown={cellKeyDown} rowHeight={32} headerRowHeight={40} rowKeyGetter={row => rowIndexes.get(row)!} selectedRows={selectedRows} onSelectedRowsChange={setSelectedRows} onActivePositionChange={({ row, rowIdx, column }) => { if (!actionCurrent()) return; captureCopyCell(row, rowIdx, column); onActiveRowChange?.(row ?? null); onActiveRowIndexChange?.(row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row ? rowIdx : null); }} sortColumns={sort?.map(rule => ({ columnKey: rule.column, direction: rule.direction }))} onSortColumnsChange={changeSortColumns} onCellCopy={({ row, column }, event) => {
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
  return <>{selectionScope && isCurrent && !onActiveRowChange ? <div className="query-result-copy-region"><div className="query-result-copy-actions"><button type="button" title={copyText.hint} disabled={!actionCurrent() || !selectedRows.size && !activeCopyCell} onClick={copyWithHeaders}>{copyText.action}</button>{onFilterCell&&<><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('eq')}>{filterText.cellEquals}</button><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('ne')}>{filterText.cellNotEquals}</button></>}</div><QueryResultFind owner={scope} rows={rows} columns={columns} grid={gridRef} isCurrent={actionCurrent} onHit={hit => { if (currentScope.current === scope && alive.current) setFindHit(hit ? { scope, hit } : undefined); }}>{grid}</QueryResultFind></div> : grid}{binary && binaryColumn && binary.rows === rows && binary.columns === columns && <Modal title={`${binaryCellZh.title}：${binaryColumn.name}`} onClose={() => {if(alive.current&&currentScope.current===scope&&binaryRef.current===binary){gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary(null);}}} wide><div className="modal-content"><BinaryCellViewer value={ownCell(binary.row, binary.key)} reason={binaryCellZh.readonly}/></div></Modal>}</>;
}
