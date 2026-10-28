import type { CellValue, ColumnInfo, FilterGroup, FilterMode, FilterRule, SortRule, TableInfo } from '../shared/contracts';
import { copyFilterRules, validateFilterGroup } from '../shared/filtering';
import { tableCopyMetadataKey } from '../shared/tableCopySource';
import { tableFilteredUpdateColumns as sharedColumns, tableFilteredUpdateAssignments, tableFilteredUpdateOutputColumns, tableFilteredUpdateLimits, tableFilteredUpdatePreviewInputSchema, tableFilteredUpdatePreviewOutputSchema, tableFilteredUpdateApplyOutputSchema, tableFilteredUpdateProgressSchema, type TableFilteredUpdatePreviewInput, type TableFilteredUpdatePreviewOutput, type TableFilteredUpdateApplyOutput, type TableFilteredUpdateProgress } from '../shared/tableFilteredUpdate';
import { validateTableSort } from './tableSort';
import { parseCell } from './lib';
import type { RecordInput } from './recordViews';
import { tableFilteredUpdateZh as text } from './locales/tableFilteredUpdate.zh-CN';

export interface TableFilteredUpdateDraft { column: string; input: RecordInput; }
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
  if (!column || !['text','json','binary','null'].includes(input.mode) || typeof input.text !== 'string' || input.text.length > tableFilteredUpdateLimits.fieldBytes || input.mode === 'null' && !column.nullable || /^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(column.type) && !['binary','null'].includes(input.mode)) throw Error(text.invalid);
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
  input(column:string,input:RecordInput,taskId:string): Extract<TableFilteredUpdatePreviewInput,{column:string}> {
    const result=this.inputs([{column,input}],taskId);
    if('assignments' in result)throw Error(text.invalid);
    return result;
  }
  /** 先解析整组再发出一次请求；任意后续字段无效时不产生部分预览。 */
  inputs(drafts:readonly TableFilteredUpdateDraft[],taskId:string): TableFilteredUpdatePreviewInput {
    if(!this.current())throw Error(text.stale);
    if(!drafts.length||drafts.length>tableFilteredUpdateLimits.columns||new Set(drafts.map(item=>item.column)).size!==drafts.length)throw Error(text.invalid);
    const assignments=drafts.map(item=>({column:item.column,value:tableFilteredUpdateValue(this.source,item.column,item.input)}));
    const assignment=assignments.length===1?assignments[0]:{assignments};
    return tableFilteredUpdatePreviewInputSchema.parse({...this.target,taskId,metadataKey:this.metadataKey,filters:structuredClone(this.scope.filters) as FilterRule[],filterMode:this.scope.filterMode,...(this.scope.filterGroup?{filterGroup:structuredClone(this.scope.filterGroup)}:{}),sort:structuredClone(this.scope.sort) as SortRule[],...assignment});
  }
}
/** 摘要完全保留有序列和值的原类型；单字段沿用历史摘要编码。 */
export async function tableFilteredUpdateInputDigest(input:TableFilteredUpdatePreviewInput):Promise<string> {
  const assignments=tableFilteredUpdateAssignments(input),payload='assignments' in input?assignments.map(item=>[item.column,item.value]):[assignments[0].column,assignments[0].value];
  const hash=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}
/** 列集合逐项有序核对，同时拒绝旧单列与新整组回执混用。 */
function sameColumns(output:TableFilteredUpdatePreviewOutput|TableFilteredUpdateApplyOutput,expected:TableFilteredUpdatePreviewInput|TableFilteredUpdatePreviewOutput):boolean {
  const names=tableFilteredUpdateOutputColumns(output),wanted='target' in expected?tableFilteredUpdateOutputColumns(expected):tableFilteredUpdateAssignments(expected).map(item=>item.column);
  return ('columns' in output)===('target' in expected?'columns' in expected:'assignments' in expected)&&names.length===wanted.length&&names.every((name,index)=>name===wanted[index]);
}
/** 预览回证准确目标、完整有序字段与本地摘要；样本只能是原准确总数中的有限完整语句。 */
export function checkTableFilteredUpdatePreview(value:unknown,input:TableFilteredUpdatePreviewInput,assignmentDigest?:string):TableFilteredUpdatePreviewOutput {
  const result=tableFilteredUpdatePreviewOutputSchema.parse(value);
  if(result.target.connectionId!==input.connectionId||result.target.database!==input.database||result.target.table!==input.table||!sameColumns(result,input)||assignmentDigest!==undefined&&result.assignmentDigest!==assignmentDigest||'assignments' in input&&assignmentDigest===undefined||result.shownRows>Math.min(result.rows,10)||result.rows===0&&(result.shownRows!==0||!!result.sql)||!result.sampleOmitted&&result.shownRows<result.rows)throw Error(text.invalid);
  return result;
}
/** 提交成功只接纳原操作令牌绑定的准确目标、完整有序字段与全量行数。 */
export function checkTableFilteredUpdateApplied(value:unknown,preview:TableFilteredUpdatePreviewOutput):TableFilteredUpdateApplyOutput {
  const output=tableFilteredUpdateApplyOutputSchema.parse(value);
  if(output.rows!==preview.rows||!sameColumns(output,preview)||output.target.connectionId!==preview.target.connectionId||output.target.database!==preview.target.database||output.target.table!==preview.target.table)throw Error(text.invalid);
  return output;
}
/** 只有原任务准确全量COMMIT ACK才可补足RPC收尾失败，保留整组字段形式。 */
export function tableFilteredUpdateCommitted(preview:TableFilteredUpdatePreviewOutput):TableFilteredUpdateApplyOutput {
  const columns=tableFilteredUpdateOutputColumns(preview),fields='columns' in preview?{columns}:{column:columns[0]};
  return {target:preview.target,...fields,rows:preview.rows,outcome:'committed',commitAcknowledged:true};
}
/** 原任务进度只单调保留发送/ACK事实；旧事件不能撤回COMMIT或提前解锁取消。 */
export function mergeTableFilteredUpdateProgress(before: TableFilteredUpdateProgress | undefined, value: unknown, expectedRows?: number): TableFilteredUpdateProgress | undefined {
  const parsed = tableFilteredUpdateProgressSchema.safeParse(value); if (!parsed.success) return before; const next = parsed.data;
  // Main可能已记账失保护，但真实COMMIT ACK仍优先；准确发送/用途/全量行数门继续成立。
  if (next.commitAcknowledged && (!next.commitMayHaveBeenSent || next.outcome !== 'committed' || expectedRows === undefined || next.rows !== expectedRows || next.totalRows !== expectedRows)) return before;
  // 发送DML后失去事务保护永久保持；初始或迟到prepare未发送DML的false不抹掉真实保护。
  const protectionLost = !!before?.dmlMayHaveBeenSent && !before.transactionProtected || next.dmlMayHaveBeenSent && !next.transactionProtected;
  const output = { ...next, dmlMayHaveBeenSent: !!before?.dmlMayHaveBeenSent || next.dmlMayHaveBeenSent, commitMayHaveBeenSent: !!before?.commitMayHaveBeenSent || next.commitMayHaveBeenSent, commitAcknowledged: !!before?.commitAcknowledged || next.commitAcknowledged, rollbackAcknowledged: !!before?.rollbackAcknowledged || next.rollbackAcknowledged, transactionProtected: !protectionLost && (!!before?.transactionProtected || next.transactionProtected) };
  if (output.commitAcknowledged) { output.outcome = 'committed'; if (before?.commitAcknowledged) { output.rows = before.rows; output.totalRows = before.totalRows; } }
  else if (output.dmlMayHaveBeenSent && !output.transactionProtected) output.outcome = 'unknown';
  else if (output.rollbackAcknowledged && output.transactionProtected && !output.commitMayHaveBeenSent) output.outcome = 'rolled-back';
  else if (before?.outcome === 'unknown' || output.dmlMayHaveBeenSent && next.outcome === 'not-sent') output.outcome = 'unknown';
  return output;
}
/** 共享快照不允许被子组件原地改写。 */
function freeze<T>(value:T):T {if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
