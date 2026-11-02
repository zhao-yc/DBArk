import type { CellValue, DataRow, QueryResult, ResultColumn } from '../shared/contracts';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { queryResultFilterLimits, queryResultFilterOperators, type QueryResultFilterGroup, type QueryResultFilterRule } from './queryResultFilter';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultFilterLiteral } from './queryResultSort';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';
import { captureSqliteResultFilterSource, type SqliteResultFilterSource } from './sqliteResultFilterSource';
import type { SqliteResultFilterType } from '../shared/sqliteResultStorage';

export type CellFilterOperator='eq'|'ne';
export interface QueryResultCellFilterCapture {readonly cell:Readonly<QueryResultCopyCell>;readonly value:CellValue;readonly key:string;readonly name:string;readonly type:string;readonly literal:string;readonly sqliteType?:SqliteResultFilterType;}
const sqliteBindings=new WeakMap<QueryResultCellFilterCapture,{source?:SqliteResultFilterSource;columns:readonly ResultColumn[];rows:readonly DataRow[];invalid:boolean}>();
/** 只捕获当前可见原格；标量按声明类型往返核对，不能截断精确数值或把字节转成文本。 */
export function captureQueryResultCellFilter(columns:readonly ResultColumn[],rows:readonly DataRow[],cell:QueryResultCopyCell|undefined,sqliteSource?:QueryResult):QueryResultCellFilterCapture{
  const column=cell?.column;
  if(!cell||!column||!Number.isSafeInteger(cell.index)||cell.index<0||rows[cell.index]!==cell.row||!columns.includes(column)||typeof column.key!=='string'||!column.key||column.key.length>4096||typeof column.name!=='string'||typeof column.type!=='string')throw Error(text.cellUnavailable);
  const field=Object.getOwnPropertyDescriptor(cell.row,column.key);
  if(!field||!('value'in field)||field.value===undefined)throw Error(text.cellUnavailable);
  const value:CellValue=field.value;
  if(column.type==='SQLITE'){
    const source=sqliteSource?captureSqliteResultFilterSource(sqliteSource,columns,rows):undefined;
    if(!source&&value!==null)throw Error(text.sqliteUnknown);
    const typed=source?.literal(cell.index,column.key)??{value,literal:''};
    if(!Object.is(typed.value,value)||source&&!source.current())throw Error(text.stale);
    const capture:QueryResultCellFilterCapture=Object.freeze({cell:Object.freeze({...cell}),value,key:column.key,name:column.name,type:column.type,literal:typed.literal,...(typed.sqliteType?{sqliteType:typed.sqliteType}:{})});
    sqliteBindings.set(capture,{source,columns,rows,invalid:false});return capture;
  }
  if(value!==null&&(typeof value!=='string'&&typeof value!=='number'||!queryResultFilterOperators(column).includes('eq')))throw Error(text.cellUnavailable);
  const literal=value===null?'':String(value);
  if(literal.length>queryResultFilterLimits.valueUnits)throw Error(text.budget);
  if(value!==null&&compareQueryResultFilterKeys(queryResultFilterKey(column,value),queryResultFilterKey(column,queryResultFilterLiteral(column,literal)))!==0)throw Error(text.value);
  return Object.freeze({cell:Object.freeze({...cell}),value,key:column.key,name:column.name,type:column.type,literal});
}
/** 捕获后原格或元数据漂移即拒绝；父级另核结果、工作区及模态租约。 */
export function currentQueryResultCellFilter(capture:QueryResultCellFilterCapture,columns:readonly ResultColumn[],rows:readonly DataRow[]):boolean{
  const binding=capture.type==='SQLITE'?sqliteBindings.get(capture):undefined;
  if(capture.type==='SQLITE'&&(!binding||binding.invalid))return false;
  const invalid=()=>{if(binding)binding.invalid=true;return false;};
  if(binding&&(columns!==binding.columns||rows!==binding.rows))return invalid();
  const {cell}=capture,column=cell.column;
  if(!column||rows[cell.index]!==cell.row||!columns.includes(column)||column.key!==capture.key||column.name!==capture.name||column.type!==capture.type)return invalid();
  const field=Object.getOwnPropertyDescriptor(cell.row,column.key);if(!field||!('value'in field)||!Object.is(field.value,capture.value))return invalid();
  if(binding?.source)try{if(!binding.source.current())return invalid();const typed=binding.source.literal(cell.index,column.key);if(typed.literal!==capture.literal||typed.sqliteType!==capture.sqliteType)return invalid();}catch{return invalid();}
  return true;
}
/** NULL使用独立判断；空文本、NULL字样及精确输入都保留原文，不生成SQL。 */
export function queryResultCellFilterRule(capture:QueryResultCellFilterCapture,operator:CellFilterOperator):QueryResultFilterRule{
  if(operator!=='eq'&&operator!=='ne')throw Error(text.invalid);
  if(capture.type==='SQLITE'){const binding=sqliteBindings.get(capture);if(!binding||!currentQueryResultCellFilter(capture,binding.columns,binding.rows))throw Error(text.stale);}
  return Object.freeze({column:capture.key,operator:capture.value===null?(operator==='eq'?'null':'notNull'):operator,value:capture.literal,...(capture.sqliteType?{sqliteType:capture.sqliteType}:{})});
}

/** SQLite排除原格须保留其它非NULL存储类；不能把显式类型NE误当完整列的补集。 */
export function queryResultCellFilterNode(capture:QueryResultCellFilterCapture,operator:CellFilterOperator):QueryResultFilterRule|QueryResultFilterGroup{
  const rule=queryResultCellFilterRule(capture,operator);
  if(capture.type!=='SQLITE'||operator!=='ne'||capture.value===null)return rule;
  return Object.freeze({mode:'OR',children:Object.freeze([rule,Object.freeze({column:capture.key,operator:'notType' as const,value:'',sqliteType:capture.sqliteType!})])});
}
