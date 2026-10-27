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
import { captureQueryResultSelectedFilter, currentQueryResultSelectedFilter, type QueryResultSelectedFilterCapture } from '../queryResultSelectedFilter';
import { queryResultSelectedFilterZh as selectedFilterText } from '../locales/queryResultSelectedFilter.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../locales/queryResultStatistics.zh-CN';

/** 任意结果的协议BLOB也可能是TEXT；没有真实结构时只认显式字节包装，NULL仍常规展示。 */
export function isResultBinaryCell(value: CellValue | undefined): boolean { return isBinaryCell(value); }

/** 任意查询结果只读；支持单格或勾选记录复制，始终保留原始值用于剪贴板。 */
export function ResultsGrid({ columns, rows, frozenKeys, onActiveRowChange, onActiveRowIndexChange, sort, onSortChange, sortReasons, selectionScope, onSelectionChange, isCurrent, binarySourceIdentity, binaryIsCurrent, binaryFileActions = true, onFilterCell, onFilterSelected, onHistoryTravel, onStatistics }: { columns: ResultColumn[]; rows: DataRow[]; frozenKeys?: readonly string[]; onActiveRowChange?: (row: DataRow | null) => void; onActiveRowIndexChange?: (index: number | null) => void; sort?: QueryResultSortRule[]; onSortChange?: (sort: QueryResultSortRule[]) => void; sortReasons?: ReadonlyMap<string, string | undefined>; selectionScope?: object; onSelectionChange?(selection: ResultGridSelection): boolean; isCurrent?(): boolean; binarySourceIdentity?: readonly unknown[]; binaryIsCurrent?(): boolean; binaryFileActions?: boolean;onFilterCell?(cell:QueryResultCopyCell,operator:CellFilterOperator):void;onFilterSelected?(capture:QueryResultSelectedFilterCapture):void;onHistoryTravel?(direction:-1|1):void;onStatistics?(column:ResultColumn,indices:ReadonlySet<number>):void }) {
  const theme = useWorkspace(state => state.settings.theme);
  const dataTypeColors = useWorkspace(state => state.settings.dataTypeColors === true);
  /** 只接受当前可见顺序的精确前缀；任一过期、重复或稀疏键整组取消，禁止RDG重排非前缀列。 */
  const frozenCount = (() => {
    if (frozenKeys === undefined || !Array.isArray(frozenKeys)) return 0;
    const count = Object.getOwnPropertyDescriptor(frozenKeys, 'length')?.value;
    if (!Number.isSafeInteger(count) || count < 0 || count > columns.length || new Set(columns.map(column => column.key)).size !== columns.length) return 0;
    for (let index = 0; index < count; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(frozenKeys, String(index));
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !descriptor.value || descriptor.value !== columns[index].key) return 0;
    }
    return count as number;
  })();
  const [gridRevision,setGridRevision]=useState(0), gridRevisionRef=useRef(0);
  const filterCapable=!!(onFilterCell||onFilterSelected||onStatistics)&&!onActiveRowChange;
  const scope = useMemo(() => ({ columns, rows, selectionScope,filterCapable }), [columns, rows, selectionScope,gridRevision,filterCapable,frozenCount]);
  const currentScope = useRef<typeof scope|null>(scope); currentScope.current = scope;
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;currentScope.current=null;};},[]);
  /** 全部网格回调核同一准确scope及父接纳门，不能在切换／模态／卸载后复制旧数据。 */
  function actionCurrent():boolean {if(!alive.current||currentScope.current!==scope||gridRevisionRef.current!==gridRevision)return false;try{return !isCurrent||isCurrent()===true;}catch{return false;}}
  const [statisticsReadyScope,setStatisticsReadyScope]=useState<typeof scope>();
  // 模态卸载前的渲染仍能看到旧DOM；提交后再准入新按钮，不能把旧模态的禁用状态留在新网格。
  useEffect(()=>{if(onStatistics&&actionCurrent())setStatisticsReadyScope(scope);},[scope,onStatistics]);
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
  const copyCellRef=useRef<{scope:typeof scope;cell:QueryResultCopyCell}|undefined>(undefined);
  const selectedRowsRef=useRef<{scope:typeof scope;indices:ReadonlySet<number>}|undefined>(undefined);
  const selectedFilterRef=useRef<{scope:typeof scope;revision:number;capture:QueryResultSelectedFilterCapture}|undefined>(undefined);
  const selectedFilterErrorRef=useRef('');
  const activeCopyCell = headerCell?.scope === scope ? headerCell.cell : undefined;
  /** 仅在明确换列或父级接纳新勾选后捕获；不在旧按钮点击时读取后来选择。 */
  function captureSelectedFilter(cell:typeof copyCellRef.current,indices:ReadonlySet<number>):void{
    selectedFilterRef.current=undefined;selectedFilterErrorRef.current='';
    if(!onFilterSelected||!cell||cell.scope!==scope||!indices.size)return;
    try{selectedFilterRef.current={scope,revision:copyRevisionRef.current,capture:captureQueryResultSelectedFilter(columns,rows,cell.cell,indices)};}
    catch(reason){selectedFilterErrorRef.current=errorMessage(reason);}
  }
  /** 同坐标重选不一定通知活动位置；显式点击仍须重新核验当前行列。 */
  function captureCopyCell(row: DataRow | undefined, rowIdx: number, column?: { key: string }) {
    if (!actionCurrent() || !selectionScope || !isCurrent || onActiveRowChange) return;
    copyRevisionRef.current++;
    const next=row && Number.isSafeInteger(rowIdx) && rowIdx >= 0 && rows[rowIdx] === row && (!column || columns.some(item => item.key === column.key)) ? { scope, cell: { index: rowIdx, row, column: columns.find(item => item.key === column?.key) } } : undefined;
    filterCellRef.current=undefined;
    if(onFilterCell&&next)try{filterCellRef.current={scope,capture:captureQueryResultCellFilter(columns,rows,next.cell)};}catch{/* 不支持的原值仅禁用快捷填入，不影响原复制或查看。 */}
    copyCellRef.current=next;
    captureSelectedFilter(next,selectedRowsRef.current?.scope===scope?selectedRowsRef.current.indices:new Set());
    setHeaderCell(next);
  }
  /** 旧网格回调在首次effect前也不能覆盖新选择；复制仍沿用同一组当前勾选行。 */
  function setSelectedRows(indices: ReadonlySet<number>) {
    if (!actionCurrent()) return;
    const next = new Set(indices);
    // 导出父级须明确接纳同一选择；模态或任务门拒绝时保留原勾选，避免显示与文件范围分离。
    if (onSelectionChange && onSelectionChange({ scope: selectionScope ?? scope, rows, columns, indices: next }) !== true) return;
    if (!actionCurrent()) return;
    copyRevisionRef.current++;selectedRowsRef.current={scope,indices:next};captureSelectedFilter(copyCellRef.current,next);setSelection({ scope, indices: next });
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
  /** 选择、列、原值或作用域失效后永久丢弃本次捕获，恢复旧值不能复活旧按钮。 */
  function selectedFilterCurrent(expected:typeof selectedFilterRef.current):boolean{
    if(!expected||selectedFilterRef.current!==expected||expected.scope!==scope||expected.revision!==copyRevisionRef.current||!actionCurrent())return false;
    if(currentQueryResultSelectedFilter(expected.capture,columns,rows))return true;
    selectedFilterRef.current=undefined;selectedFilterErrorRef.current=selectedFilterText.unavailable;return false;
  }
  const selectedFilter=selectedFilterRef.current,selectedFilterAllowed=!!onFilterSelected&&selectedFilterCurrent(selectedFilter);
  /** 子网格只提出准确原值捕获，父查询另核已接纳勾选和完整结构后才开审核草稿。 */
  function filterFromSelected():void{
    if(copyRevisionRef.current!==copyRevision||!selectedFilterCurrent(selectedFilter)||!onFilterSelected)return;
    onFilterSelected(selectedFilter!.capture);
  }
  /** 统计锁定本次活动列和已接纳勾选；旧渲染不能读取后来选择，空结果仍可统计首列。 */
  function openStatistics():void {
    if(!onStatistics||!actionCurrent()||copyRevisionRef.current!==copyRevision)return;
    const column=activeCopyCell?.column??columns[0];
    if(!column||!columns.includes(column))return;
    onStatistics(column,selectedRows);
  }
  const binaryGeneration=useRef({identity:binarySourceIdentity??[],revision:0});
  const binaryIdentity=frozenCount?[...(binarySourceIdentity??[]),frozenCount]:binarySourceIdentity??[];
  if(binaryIdentity.length!==binaryGeneration.current.identity.length||binaryIdentity.some((value,index)=>!Object.is(value,binaryGeneration.current.identity[index])))binaryGeneration.current={identity:binaryIdentity,revision:binaryGeneration.current.revision+1};
  const latestBinaryGuard=useRef(binaryIsCurrent);latestBinaryGuard.current=binaryIsCurrent;
  type BinaryView = { sourceRevision: number; row: DataRow; key: string; rows: DataRow[]; columns: ResultColumn[]; value: CellValue | undefined; revision: number; workspaceCurrent(): boolean; invalid: boolean };
  const [binary, setBinary] = useState<BinaryView | null>(null);
  const binaryRef=useRef(binary);binaryRef.current=binary;
  const binarySource=useRef({rows,columns});binarySource.current={rows,columns};
  /** 原结果模态会撤销普通网格选择；只读文件用途独立持有已准入的结果来源，不复活选择权限。 */
  function binaryCurrent(expected: BinaryView): boolean {
    if (expected.invalid) return false;
    if (!alive.current || binaryGeneration.current.revision !== expected.sourceRevision || latestBinaryGuard.current && !latestBinaryGuard.current() || binaryRef.current !== expected || binarySource.current.rows !== expected.rows || binarySource.current.columns !== expected.columns || gridRevisionRef.current !== expected.revision || ownCell(expected.row, expected.key) !== expected.value || !expected.workspaceCurrent()) { expected.invalid = true; return false; }
    return true;
  }
  // 同步观察工作区ABA；恢复原tab也不能重新领取旧文件回包。
  useEffect(() => useWorkspace.subscribe(() => { const current=binaryRef.current; if(current)binaryCurrent(current); }), []);
  const rowIndexes = useMemo(() => new Map(rows.map((row, index) => [row, index])), [rows]);
  useEffect(() => { setBinary(null); onActiveRowChange?.(null); }, [columns, rows]);
  /** 任意 SQL 结果仅打开只读查看器，绝不从列名推测写表定位或提供写入回调。 */
  function viewBinary(row: DataRow, key: string) {
    if (!actionCurrent() || !rowIndexes.has(row) || !columns.some(column=>column.key===key) || !isResultBinaryCell(ownCell(row,key))) return;
    const state=useWorkspace.getState(),tab=state.settings.tabs.find(item=>item.id===state.settings.activeTabId),connection=state.connections.find(item=>item.id===tab?.connectionId),version=tab?(state.connectionVersions[tab.connectionId]??0):0;
    // 打开必须经过原actionCurrent；之后只检查同一活动查询及原行列，不借父选择模态门提升权限。
    const workspaceCurrent=()=>{const now=useWorkspace.getState();return !!tab&&now.settings.activeTabId===tab.id&&now.settings.tabs.find(item=>item.id===tab.id)===tab&&!now.activeJobs[tab.id]&&(now.connectionVersions[tab.connectionId]??0)===version&&now.connections.find(item=>item.id===tab.connectionId)===connection;};
    gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);
    const next={sourceRevision:binaryGeneration.current.revision,row,key,rows,columns,value:ownCell(row,key),revision:gridRevisionRef.current,workspaceCurrent,invalid:false};binaryRef.current=next;setBinary(next);
  }
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
  // 离线窗口只查看原字节，不借查询页归属开放文件能力；默认仍沿用原安全门。
  const binaryColumn = binary ? columns.find(column => column.key === binary.key) : undefined;
  const gridColumns = useMemo<Column<DataRow>[]>(() => [...(onActiveRowChange ? [] : [SelectColumn]), ...columns.map<Column<DataRow>>((column, index) => ({ key: column.key, name: column.name, frozen: index < frozenCount, cellClass: row => activeHit?.row === rowIndexes.get(row) && activeHit?.column === index ? 'query-result-find-hit' : undefined, resizable: true, minWidth: 110, width: 170, sortable: !!onSortChange && !sortReasons?.get(column.key), renderHeaderCell: () => <span title={sortReasons?.get(column.key) ?? (onSortChange ? sortText.keyboard : column.type)}>{column.name}<small className="column-type">{column.type}</small>{sort?.find(rule => rule.column === column.key) && <span aria-label={sort.find(rule => rule.column === column.key)!.direction === 'ASC' ? sortText.ascending : sortText.descending} title={sortText.priority(sort.findIndex(rule => rule.column === column.key)+1,column.name)}>{sort.findIndex(rule => rule.column === column.key)+1}{sort.find(rule => rule.column === column.key)!.direction === 'ASC' ? ' ↑' : ' ↓'}</span>}</span>, renderCell: ({ row, tabIndex }) => <DataTypeColor enabled={dataTypeColors} selected={tabIndex === 0 || selectedRows.has(rowIndexes.get(row)!)} value={row[column.key]} type={column.type} source="protocol" className={row[column.key] === null ? 'null-value' : ''} title={cellPreview(row[column.key])}>{cellPreview(row[column.key])}</DataTypeColor> }))], [columns, frozenCount, onActiveRowChange, onSortChange, sort, sortReasons, activeHit, dataTypeColors, dataTypeColors ? selectedRows : null, dataTypeColors ? rowIndexes : null]);
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
  return <>{selectionScope && isCurrent && !onActiveRowChange ? <div className="query-result-copy-region"><div className="query-result-copy-actions"><button type="button" title={copyText.hint} disabled={!actionCurrent() || !selectedRows.size && !activeCopyCell} onClick={copyWithHeaders}>{copyText.action}</button>{onFilterCell&&<><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('eq')}>{filterText.cellEquals}</button><button type="button" title={filterCellAllowed?filterText.cellHint:filterText.cellUnavailable} disabled={!filterCellAllowed} onClick={()=>filterFromCell('ne')}>{filterText.cellNotEquals}</button></>}{onFilterSelected&&<button type="button" title={selectedFilterAllowed?selectedFilterText.hint:selectedFilterErrorRef.current||selectedFilterText.unavailable} disabled={!selectedFilterAllowed} onClick={filterFromSelected}>{selectedFilterText.open}</button>}{onStatistics&&<button type="button" disabled={statisticsReadyScope!==scope||!columns.length} onClick={openStatistics}>{statisticsText.open}</button>}</div><QueryResultFind owner={scope} rows={rows} columns={columns} grid={gridRef} isCurrent={actionCurrent} onHit={hit => { if (currentScope.current === scope && alive.current) setFindHit(hit ? { scope, hit } : undefined); }}>{grid}</QueryResultFind></div> : grid}{binary && binaryColumn && binary.rows === rows && binary.columns === columns && <Modal title={`${binaryCellZh.title}：${binaryColumn.name}`} onClose={() => {if(alive.current&&currentScope.current===scope&&binaryRef.current===binary){gridRevisionRef.current++;setGridRevision(gridRevisionRef.current);setBinary(null);}}} wide><div className="modal-content"><BinaryCellViewer value={binary.value} reason={binaryCellZh.readonly} source={[binary]} isCurrent={binaryFileActions ? () => binaryCurrent(binary) : undefined}/></div></Modal>}</>;
}
