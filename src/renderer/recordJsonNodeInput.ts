import type {DraftRow} from './dataChanges';
import {ownCell} from './lib';
import {assertRecordDraftCurrent,editRecordInput,recordInputDirty,recordReadonlyReason,stageRecordDraft,type RecordContext,type RecordDraft} from './recordViews';
import {resolveProjectionPath,type ProjectionIdentity} from './recordProjections';
import type {LexicalPathSegment,ReadyLexicalDocument} from './jsonLexicalTree';
import {applyJsonNodeInput,beginJsonNodeInput,changeJsonNodeInput,jsonNodeInputDirty,type JsonNodeInput} from './jsonNodeInput';
import {recordJsonNodeInputZh as text} from './locales/recordJsonNodeInput.zh-CN';

export interface RecordNodeSelection{readonly row:DraftRow;readonly identity:ProjectionIdentity;readonly columnName:string;readonly document:ReadyLexicalDocument;readonly segments:readonly LexicalPathSegment[]}
export interface BeginRecordNodeOptions{rows:readonly DraftRow[];draft:RecordDraft;context:RecordContext;columnName:string;document:ReadyLexicalDocument;selection:RecordNodeSelection}
export interface RecordJsonNodeInput{readonly session:object;readonly draft:RecordDraft;readonly row:DraftRow;readonly columnName:string;readonly value:JsonNodeInput}

/** 行和元数据属于同一写入目标；待删除、生成列、过期和忙碌均使用原字段能力门。 */
function writable(rows:readonly DraftRow[],draft:RecordDraft,context:RecordContext,key:string):DraftRow{
  const row=assertRecordDraftCurrent(rows,draft,context),reason=recordReadonlyReason(context,row,key);if(reason)throw Error(reason);return row;
}
/** 入口同时核对当前缓存文档、选择所属的行对象和精确结构路径，不能拿相同文本替代身份。 */
export function beginRecordJsonNodeInput(options:BeginRecordNodeOptions):RecordJsonNodeInput{
  const{rows,draft,context,columnName,document,selection}=options,row=writable(rows,draft,context,columnName);
  if(recordInputDirty(draft,context.info))throw Error(text.pending);
  const identity:ProjectionIdentity={target:draft.target,connectionVersion:draft.connectionVersion,generation:draft.generation,metadata:draft.metadata,rowId:draft.rowId,data:draft.data,original:draft.original,inserted:draft.inserted,deleted:row.deleted};
  if(selection.row!==row||!resolveProjectionPath(identity,columnName,document,selection))throw Error(text.changed);
  const source=ownCell(row.data,columnName);if(typeof source!=='string'||source!==document.text)throw Error(text.notText);
  return Object.freeze({session:Object.freeze({}),draft,row,columnName,value:beginJsonNodeInput(document,selection.segments)});
}
/** 行对象变化和原文就地变化都使旧节点输入失效；UI迟到事件也须先调用此门。 */
export function assertRecordJsonNodeCurrent(rows:readonly DraftRow[],input:RecordJsonNodeInput,context:RecordContext):DraftRow{
  const row=writable(rows,input.draft,context,input.columnName);
  if(row!==input.row||ownCell(row.data,input.columnName)!==input.value.document.text)throw Error(text.changed);return row;
}
/** 非法节点原文也保留在互斥输入缓冲，不预先写入页面行或数据库。 */
export function changeRecordJsonNodeInput(input:RecordJsonNodeInput,value:string):RecordJsonNodeInput{return Object.freeze({...input,value:changeJsonNodeInput(input.value,value)});}
/** 未修改和无效输入分别按原始token比较，不在dirty判断中解析JSON。 */
export function recordJsonNodeDirty(input:RecordJsonNodeInput|null):boolean{return !!input&&jsonNodeInputDirty(input.value);}
/** 全部词法与身份校验后仅生成单字段JSON输入，再一次复用原页面草稿暂存。 */
export function stageRecordJsonNodeInput(rows:DraftRow[],input:RecordJsonNodeInput,context:RecordContext):DraftRow[]{
  assertRecordJsonNodeCurrent(rows,input,context);if(!recordJsonNodeDirty(input))return rows;
  const document=applyJsonNodeInput(input.value,input.value.document),column=context.info!.columns.find(column=>column.name===input.columnName)!;
  const draft=editRecordInput({...input.draft,fields:new Map()},column,{mode:'json',text:document.text});return stageRecordDraft(rows,draft,context);
}
