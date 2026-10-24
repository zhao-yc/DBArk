import type { CellValue, ColumnInfo, FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from '../shared/contracts';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableFilteredUpdateColumns as sharedColumns, tableFilteredUpdatePreviewInputSchema, tableFilteredUpdatePreviewOutputSchema, tableFilteredUpdateApplyOutputSchema, tableFilteredUpdateProgressSchema, type TableFilteredUpdatePreviewInput, type TableFilteredUpdatePreviewOutput, type TableFilteredUpdateApplyOutput, type TableFilteredUpdateProgress } from '../shared/tableFilteredUpdate';
import { validateTableSort } from './tableSort';
import { parseCell } from './lib';
import { recordInputLimits, type RecordInput } from './recordViews';
import { tableFilteredUpdateZh as text } from './locales/tableFilteredUpdate.zh-CN';

export interface TableFilteredUpdateScope { filters: readonly FilterRule[]; filterMode: FilterMode; filterGroup?: FilterGroup; sort: readonly SortRule[]; }
export interface TableFilteredUpdateTarget { connectionId: string; database: string; table: string; }
/** 复用共享普通字段资格；对象和可靠定位键先核，真实可写性仍由服务器重新核验。 */
export function tableFilteredUpdateColumns(info: TableInfo): ColumnInfo[] {
  if (info.objectKind !== 'table' || info.engine?.toLowerCase() !== 'innodb' || !info.editableKey.length) return [];
  return sharedColumns(info);
}
/** 不把BIGINT/DECIMAL转成number；JSON保留完整词法原文，二进制沿原完整Hex校验。 */
export function tableFilteredUpdateValue(info: TableInfo, name: string, input: RecordInput): CellValue {
  const column = tableFilteredUpdateColumns(info).find(column => column.name === name);
  if (!column || !['text','json','binary','null'].includes(input.mode) || typeof input.text !== 'string' || input.text.length > recordInputLimits.field || input.mode === 'null' && !column.nullable || /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(column.type) && !['binary','null'].includes(input.mode)) throw Error(text.invalid);
  return parseCell(input.text, input.mode as 'text'|'json'|'binary'|'null');
}
/** 条件只来自已应用范围，原页数据、勾选和未提交输入均不进入服务器请求。 */
export class TableFilteredUpdateIntent {
  readonly source: TableInfo; readonly target: TableFilteredUpdateTarget; readonly scope: TableFilteredUpdateScope; readonly metadataKey: string;
  private dead=false; private checking=false; private readonly values: readonly unknown[]; private listeners=new Set<()=>void>();
  constructor(target: TableFilteredUpdateTarget, source: TableInfo, scope: TableFilteredUpdateScope, values: readonly unknown[], private readonly guard:()=>boolean) {
    if (!target.connectionId || target.database!==source.database || target.table!==source.name || !tableFilteredUpdateColumns(source).length) throw Error(text.columnUnavailable);
    const filters=copyFilterRules(scope.filters),group=validateFilterGroup(filters,scope.filterMode,scope.filterGroup);
    if(filters.some(rule=>!source.columns.some(column=>column.name===rule.column)))throw Error(text.invalid);
    this.source=freeze(structuredClone(source));this.target=freeze({...target});this.scope=freeze({filters,filterMode:scope.filterMode,...(group?{filterGroup:group}:{}),sort:validateTableSort(scope.sort,source.columns.map(column=>column.name))});this.metadataKey=tableCopyMetadataKey(this.source);this.values=[...values];
  }
  /** 渲染观察过一次变动即永久撤销；恢复相同筛选也不重新授权旧预览。 */
  observe(values:readonly unknown[]):void { if(values.length!==this.values.length||values.some((value,index)=>!Object.is(value,this.values[index])))this.invalidate(); }
  current():boolean { if(this.dead||this.checking)return false;this.checking=true;try{if(this.guard()!==true)this.invalidate();}catch{this.invalidate();}finally{this.checking=false;}return !this.dead; }
  invalidate():void {if(this.dead)return;this.dead=true;queueMicrotask(()=>{for(const listener of this.listeners)listener();});}
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
  /** 发送前同步复核来源，再返回完整独立typed值与原条件，不携带页码/OFFSET。 */
  input(column:string,input:RecordInput,taskId:string): TableFilteredUpdatePreviewInput {
    if(!this.current())throw Error(text.stale);
    return tableFilteredUpdatePreviewInputSchema.parse({...this.target,taskId,metadataKey:this.metadataKey,filters:structuredClone(this.scope.filters) as FilterRule[],filterMode:this.scope.filterMode,...(this.scope.filterGroup?{filterGroup:structuredClone(this.scope.filterGroup)}:{}),sort:structuredClone(this.scope.sort) as SortRule[],column,value:tableFilteredUpdateValue(this.source,column,input)});
  }
}
/** 预览回证准确目标和字段；样本只能是原准确总数中的有限完整语句。 */
export function checkTableFilteredUpdatePreview(value:unknown,input:TableFilteredUpdatePreviewInput):TableFilteredUpdatePreviewOutput {
  const result=tableFilteredUpdatePreviewOutputSchema.parse(value);
  if(result.target.connectionId!==input.connectionId||result.target.database!==input.database||result.target.table!==input.table||result.column!==input.column||result.shownRows>Math.min(result.rows,10)||result.rows===0&&(result.shownRows!==0||!!result.sql)||!result.sampleOmitted&&result.shownRows<result.rows)throw Error(text.invalid);
  return result;
}
/** 提交成功只接纳原令牌的准确目标、字段与全量行数。 */
export function checkTableFilteredUpdateApplied(value:unknown,preview:TableFilteredUpdatePreviewOutput):TableFilteredUpdateApplyOutput {
  const output=tableFilteredUpdateApplyOutputSchema.parse(value);
  if(output.rows!==preview.rows||output.column!==preview.column||output.target.connectionId!==preview.target.connectionId||output.target.database!==preview.target.database||output.target.table!==preview.target.table)throw Error(text.invalid);
  return output;
}
/** 原任务进度只单调保留发送/ACK事实；旧事件不能撤回COMMIT或提前解锁取消。 */
export function mergeTableFilteredUpdateProgress(before:TableFilteredUpdateProgress|undefined,value:unknown,expectedRows?:number):TableFilteredUpdateProgress|undefined {
  const parsed=tableFilteredUpdateProgressSchema.safeParse(value);if(!parsed.success)return before;const next=parsed.data;
  if(next.commitAcknowledged&&(!next.commitMayHaveBeenSent||!next.transactionProtected||next.outcome!=='committed'||expectedRows===undefined||next.rows!==expectedRows||next.totalRows!==expectedRows))return before;
  const output={...next,dmlMayHaveBeenSent:!!before?.dmlMayHaveBeenSent||next.dmlMayHaveBeenSent,commitMayHaveBeenSent:!!before?.commitMayHaveBeenSent||next.commitMayHaveBeenSent,commitAcknowledged:!!before?.commitAcknowledged||next.commitAcknowledged,rollbackAcknowledged:!!before?.rollbackAcknowledged||next.rollbackAcknowledged,transactionProtected:!!before?.transactionProtected||next.transactionProtected};
  if(output.commitAcknowledged)output.outcome='committed';else if(output.rollbackAcknowledged&&output.transactionProtected&&!output.commitMayHaveBeenSent)output.outcome='rolled-back';else if(before?.outcome==='unknown'||output.dmlMayHaveBeenSent&&next.outcome==='not-sent')output.outcome='unknown';return output;
}
/** 共享快照不允许被子组件原地改写。 */
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
