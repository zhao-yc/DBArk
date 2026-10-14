import type {DraftRow} from './dataChanges';
import {boundedUtf8Bytes,jsonLexicalLimits,lexicalNodeAtPath} from './jsonLexicalTree';
import {applyJsonStructureAction,type JsonStructureAction} from './jsonStructureInput';
import {assertRecordJsonNodeCurrent,beginRecordJsonNodeInput,type BeginRecordNodeOptions,type RecordJsonNodeInput} from './recordJsonNodeInput';
import {editRecordInput,stageRecordDraft,type RecordContext} from './recordViews';
import {recordJsonStructureInputZh as text} from './locales/recordJsonStructureInput.zh-CN';

export type RecordStructureAction={readonly kind:'rename';readonly keyToken:string}|{readonly kind:'remove'}|{readonly kind:'append-member';readonly keyToken:string;readonly valueToken:string}|{readonly kind:'insert-element';readonly indexText:string;readonly valueToken:string}|{readonly kind:'move-element';readonly fromText:string;readonly toText:string};
export type RecordStructureKind=RecordStructureAction['kind'];
export interface RecordJsonStructureInput{readonly base:RecordJsonNodeInput;readonly initial:RecordStructureAction;readonly action:RecordStructureAction}

/** 入口只决定所选节点可用的操作；非法用户原文在后续缓冲中保留，到暂存时才解析。 */
export function beginRecordJsonStructureInput(options:BeginRecordNodeOptions,kind:RecordStructureKind):RecordJsonStructureInput{
  const base=beginRecordJsonNodeInput(options),node=base.value.node,last=base.value.segments.at(-1);let action:RecordStructureAction;
  if(kind==='rename'){
    if(!last)throw Error(text.root);if(last.kind!=='member')throw Error(text.member);
    const parent=lexicalNodeAtPath(base.value.document,{document:base.value.document,segments:base.value.segments.slice(0,-1)});if(parent?.kind!=='object')throw Error(text.member);
    const member=parent.members[last.memberIndex];action={kind,keyToken:base.value.document.text.slice(member.keySpan.start,member.keySpan.end)};
  }else if(kind==='remove'){if(!last)throw Error(text.root);action={kind};}
  else if(kind==='append-member'){if(node.kind!=='object')throw Error(text.object);action={kind,keyToken:'""',valueToken:'null'};}
  else{if(node.kind!=='array')throw Error(text.array);if(kind==='insert-element')action={kind,indexText:String(node.elements.length),valueToken:'null'};else{if(!node.elements.length)throw Error(text.empty);action={kind,fromText:'0',toText:'0'};}}
  const initial=Object.freeze(action);return Object.freeze({base,initial,action:initial});
}
/** 改名/移动只比较输入原文；显式新增或删除已是待暂存意图，打开后即受离开守卫保护。 */
export function recordJsonStructureDirty(input:RecordJsonStructureInput|null):boolean{
  if(!input)return false;const action=input.action,initial=input.initial;
  if(action.kind==='rename')return initial.kind!=='rename'||action.keyToken!==initial.keyToken;
  if(action.kind==='move-element')return initial.kind!=='move-element'||action.fromText!==initial.fromText||action.toText!==initial.toText;
  return true;
}
/** 输入类型不能被晚到事件切换；无效JSON/下标也保留，超限则保留上一份完整缓冲。 */
export function changeRecordJsonStructureInput(input:RecordJsonStructureInput,action:RecordStructureAction):RecordJsonStructureInput{
  if(action.kind!==input.action.kind)throw Error(text.kind);let units=0,bytes=0;
  for(const [key,value]of Object.entries(action)){if(key==='kind')continue;units+=value.length;if(units>jsonLexicalLimits.sourceUnits)throw Error(text.limited);const size=boundedUtf8Bytes(value,jsonLexicalLimits.sourceBytes-bytes);if(size===undefined)throw Error(text.limited);bytes+=size;}
  return Object.freeze({...input,action:Object.freeze({...action})});
}
/** 数组位置与JSON数字值分离，禁止指数、小数、符号、空白和不安全整数被隐式归一化。 */
function index(textValue:string):number{if(textValue.length>16||!/^(?:0|[1-9]\d*)$/.test(textValue))throw Error(text.index);const value=Number(textValue);if(!Number.isSafeInteger(value))throw Error(text.index);return value;}
/** 暂存前重新核完整行身份，结构整体校验成功后只生成原字段JSON输入并合并一次。 */
export function stageRecordJsonStructureInput(rows:DraftRow[],input:RecordJsonStructureInput,context:RecordContext):DraftRow[]{
  assertRecordJsonNodeCurrent(rows,input.base,context);if(!recordJsonStructureDirty(input))return rows;
  const action=input.action;let operation:JsonStructureAction;
  if(action.kind==='insert-element')operation={kind:action.kind,index:index(action.indexText),valueToken:action.valueToken};
  else if(action.kind==='move-element')operation={kind:action.kind,from:index(action.fromText),to:index(action.toText)};
  else operation=action;
  const document=applyJsonStructureAction(input.base.value,input.base.value.document,operation);if(document===input.base.value.document)return rows;
  const column=context.info!.columns.find(value=>value.name===input.base.columnName)!;
  const draft=editRecordInput({...input.base.draft,fields:new Map()},column,{mode:'json',text:document.text});return stageRecordDraft(rows,draft,context);
}
