import type { CellValue, DataRow, ResultColumn } from '../shared/contracts';
import type { QueryResultCopyCell } from './queryResultHeaderCopy';
import { queryResultFilterLimits, queryResultFilterOperators, type QueryResultFilterRule } from './queryResultFilter';
import { compareQueryResultFilterKeys, queryResultFilterKey, queryResultFilterLiteral } from './queryResultSort';
import { queryResultFilterZh as text } from './locales/queryResultFilter.zh-CN';

export type CellFilterOperator='eq'|'ne';
export interface QueryResultCellFilterCapture {readonly cell:Readonly<QueryResultCopyCell>;readonly value:CellValue;readonly key:string;readonly name:string;readonly type:string;readonly literal:string;}
/** 只捕获当前可见原格；标量按声明类型往返核对，不能截断精确数值或把字节转成文本。 */
export function captureQueryResultCellFilter(columns:readonly ResultColumn[],rows:readonly DataRow[],cell:QueryResultCopyCell|undefined):QueryResultCellFilterCapture{
  const column=cell?.column;
  if(!cell||!column||!Number.isSafeInteger(cell.index)||cell.index<0||rows[cell.index]!==cell.row||!columns.includes(column)||typeof column.key!=='string'||!column.key||column.key.length>4096||typeof column.name!=='string'||typeof column.type!=='string')throw Error(text.cellUnavailable);
  const field=Object.getOwnPropertyDescriptor(cell.row,column.key);
  if(!field||!('value'in field)||field.value===undefined)throw Error(text.cellUnavailable);
  const value:CellValue=field.value;
  if(value!==null&&(typeof value!=='string'&&typeof value!=='number'||!queryResultFilterOperators(column).includes('eq')))throw Error(text.cellUnavailable);
  const literal=value===null?'':String(value);
  if(literal.length>queryResultFilterLimits.valueUnits)throw Error(text.budget);
  if(value!==null&&compareQueryResultFilterKeys(queryResultFilterKey(column,value),queryResultFilterKey(column,queryResultFilterLiteral(column,literal)))!==0)throw Error(text.value);
  return Object.freeze({cell:Object.freeze({...cell}),value,key:column.key,name:column.name,type:column.type,literal});
}
/** 捕获后原格或元数据漂移即拒绝；父级另核结果、工作区及模态租约。 */
export function currentQueryResultCellFilter(capture:QueryResultCellFilterCapture,columns:readonly ResultColumn[],rows:readonly DataRow[]):boolean{
  const {cell}=capture,column=cell.column;
  if(!column||rows[cell.index]!==cell.row||!columns.includes(column)||column.key!==capture.key||column.name!==capture.name||column.type!==capture.type)return false;
  const field=Object.getOwnPropertyDescriptor(cell.row,column.key);return !!field&&'value'in field&&Object.is(field.value,capture.value);
}
/** NULL使用独立判断；空文本、NULL字样及精确输入都保留原文，不生成SQL。 */
export function queryResultCellFilterRule(capture:QueryResultCellFilterCapture,operator:CellFilterOperator):QueryResultFilterRule{
  if(operator!=='eq'&&operator!=='ne')throw Error(text.invalid);
  return Object.freeze({column:capture.key,operator:capture.value===null?(operator==='eq'?'null':'notNull'):operator,value:capture.literal});
}
