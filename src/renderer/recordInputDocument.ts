import type { ColumnInfo } from '../shared/contracts';
import type { DraftRow } from './dataChanges';
import { ownCell } from './lib';
import { boundedUtf8Bytes, parseRecordInputDocumentTree } from './jsonLexicalTree';
import { assertRecordDraftCurrent, editRecordInput, initialRecordInput, recordFieldTooLarge, recordInputDirty, recordReadonlyReason, stageRecordDraft, type RecordContext, type RecordDraft, type RecordInput, type RecordMode } from './recordViews';
import { recordDocumentZh as text } from './locales/recordDocument.zh-CN';

export interface RecordDocumentInput { readonly draft: RecordDraft; readonly row: DraftRow; readonly initialText: string; readonly text: string }
export const recordDocumentLimits = Object.freeze({ bytes: 2_097_152, fields: 4096, metadataUnits: 1_048_576 });
type InputField = { name: string; locked: true } | ({ name: string } & RecordInput);
const modes: ReadonlySet<string> = new Set<RecordMode>(['text', 'json', 'binary', 'null', 'default']);

/** 生成列及大值只带锁定占位，不复制、截断或重新解释其原始数据库值。 */
function locked(draft: RecordDraft, column: ColumnInfo): boolean { return column.generated || recordFieldTooLarge(ownCell(draft.data, column.name)); }
/** 校验有界完整元数据；精确列名使用 Map/Set，不作为普通对象的索引。 */
function columnsOf(context: RecordContext): readonly ColumnInfo[] {
  const columns=context.info?.columns;
  if(!columns?.length||columns.length>recordDocumentLimits.fields||new Set(columns.map(column=>column.name)).size!==columns.length||columns.reduce((sum,column)=>sum+column.name.length,0)>recordDocumentLimits.metadataUnits)throw Error(text.metadata);
  return columns;
}
/** 与 JSON.stringify 的字符串转义一致，先计实际输出字节，再允许完整序列化。 */
function quotedBytes(value: string, maximum: number): number {
  let bytes=2;
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code===34||code===92||[8,9,10,12,13].includes(code))bytes+=2;
    else if(code<32)bytes+=6;
    else if(code<128)bytes++;
    else if(code<2048)bytes+=2;
    else if(code>=0xd800&&code<=0xdbff&&value.charCodeAt(index+1)>=0xdc00&&value.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
    else if(code>=0xd800&&code<=0xdfff)bytes+=6;
    else bytes+=3;
    if(bytes>maximum)throw Error(text.limited);
  }
  if(bytes>maximum)throw Error(text.limited);
  return bytes;
}
/** 打开缓冲前捕获原 RecordDraft 身份；整行和字段缓冲不能同时持有不同可暂存内容。 */
export function beginRecordDocument(rows: readonly DraftRow[], draft: RecordDraft, context: RecordContext): RecordDocumentInput {
  const row=assertRecordDraftCurrent(rows,draft,context),reason=recordReadonlyReason(context,row);
  if(reason)throw Error(reason);
  if(recordInputDirty(draft,context.info))throw Error(text.pending);
  const columns=columnsOf(context),fields: InputField[]=[];
  const header='{\n  "format": "DBArk-record-input",\n  "version": 1,\n  "fields": [\n',footer='\n  ]\n}';
  let bytes=header.length+footer.length;
  for(const column of columns){
    const field: InputField=locked(draft,column)?{name:column.name,locked:true}:{name:column.name,...initialRecordInput(draft,column)};
    if(fields.length)bytes+=2;
    // 固定标点通过空字符串模板计费；字段名和文本另按真实转义后字节计算。
    bytes+=('locked' in field?'    {\n      "name": ,\n      "locked": true\n    }':'    {\n      "name": ,\n      "mode": ,\n      "text": \n    }').length;
    bytes+=quotedBytes(field.name,recordDocumentLimits.bytes-bytes);
    if(!('locked' in field)){bytes+=quotedBytes(field.mode,recordDocumentLimits.bytes-bytes);bytes+=quotedBytes(field.text,recordDocumentLimits.bytes-bytes);}
    if(bytes>recordDocumentLimits.bytes)throw Error(text.limited);
    fields.push(field);
  }
  const initialText=header+fields.map(field=>JSON.stringify(field,null,2).replace(/^/gm,'    ')).join(',\n')+footer;
  if(boundedUtf8Bytes(initialText,recordDocumentLimits.bytes)!==bytes)throw Error(text.limited);
  return Object.freeze({draft,row,initialText,text:initialText});
}
/** 非法 JSON 仍保留为原文并视为 dirty；超限输入不替换现有完整缓冲。 */
export function changeRecordDocument(input: RecordDocumentInput, value: string): RecordDocumentInput {
  if(value.length>recordDocumentLimits.bytes||boundedUtf8Bytes(value,recordDocumentLimits.bytes)===undefined)throw Error(text.limited);
  return Object.freeze({...input,text:value});
}
/** 仅比较输入原文，语法无效也必须进入原有导航和退出保护。 */
export function recordDocumentDirty(input: RecordDocumentInput | null): boolean { return !!input&&input.text!==input.initialText; }
/** 捕获整行对象引用，删除后撤销即使恢复相同data/original也不能让旧输入重新有效。 */
export function assertRecordDocumentCurrent(rows: readonly DraftRow[], input: RecordDocumentInput, context: RecordContext): DraftRow {
  const row=assertRecordDraftCurrent(rows,input.draft,context);if(row!==input.row)throw Error(text.changed);return row;
}
/** 所有对象保留成员顺序完成去重后才 JSON.parse，禁止丢失重复键后再检查。 */
function decodeDocument(value: string): unknown {
  const lexical=parseRecordInputDocumentTree(value);
  if(lexical.status!=='ready')throw Error(lexical.status==='limited'?text.limited:text.invalid.replace('{0}',lexical.reason));
  for(const node of lexical.nodes)if(node.kind==='object'){
    const seen=new Set<string>();
    for(const member of node.members){if(seen.has(member.key))throw Error(text.duplicateMember.replace('{0}',member.key));seen.add(member.key);}
  }
  return JSON.parse(value) as unknown;
}
/** 只接受封闭数据对象，不从原型或额外成员中解释控制信息。 */
function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
}
/** 先校验全部条目和锁定占位，再构造稀疏输入；最终一次沿用原字段暂存，不发任何 IPC。 */
export function stageRecordDocument(rows: DraftRow[], input: RecordDocumentInput, context: RecordContext): DraftRow[] {
  const row=assertRecordDocumentCurrent(rows,input,context),reason=recordReadonlyReason(context,row);
  if(reason)throw Error(reason);
  const columns=columnsOf(context),byName=new Map(columns.map(column=>[column.name,column]));
  const document=decodeDocument(input.text);
  if(!objectWithKeys(document,['format','version','fields'])||document.format!=='DBArk-record-input'||document.version!==1||!Array.isArray(document.fields))throw Error(text.structure);
  if(document.fields.length!==columns.length)throw Error(text.missingField);
  const seen=new Set<string>(),inputs=new Map<string,RecordInput>();
  for(const entry of document.fields as unknown[]){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||!Object.hasOwn(entry,'name')||typeof(entry as Record<string,unknown>).name!=='string')throw Error(text.structure);
    const field=entry as Record<string,unknown>,name=field.name as string,column=byName.get(name);
    if(!column)throw Error(text.unknownField.replace('{0}',name));
    if(seen.has(name))throw Error(text.duplicateField.replace('{0}',name));seen.add(name);
    if(locked(input.draft,column)){if(!objectWithKeys(field,['name','locked'])||field.locked!==true)throw Error(text.locked.replace('{0}',name));continue;}
    if(!objectWithKeys(field,['name','mode','text'])||typeof field.mode!=='string'||!modes.has(field.mode)||typeof field.text!=='string')throw Error(text.structure);
    inputs.set(name,{mode:field.mode as RecordMode,text:field.text});
  }
  let next: RecordDraft={...input.draft,fields:new Map()};
  for(const[columnName,value]of inputs)next=editRecordInput(next,byName.get(columnName)!,value);
  return stageRecordDraft(rows,next,context);
}
