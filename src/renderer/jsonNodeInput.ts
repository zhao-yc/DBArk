import { boundedUtf8Bytes,jsonLexicalLimits,lexicalNodeAtPath,lexicalToken,parseJsonLexicalTree,type LexicalNode,type LexicalPathSegment,type ReadyLexicalDocument } from './jsonLexicalTree';
import { jsonNodeInputZh as text } from './locales/jsonNodeInput.zh-CN';
import { assertTextInputBudget } from './boundedTextInput';
export const jsonNodeInputBudget = Object.freeze({ units: jsonLexicalLimits.sourceUnits, bytes: jsonLexicalLimits.sourceBytes, message: text.limited });
export interface JsonNodeInput { readonly document:ReadyLexicalDocument;readonly segments:readonly LexicalPathSegment[];readonly node:LexicalNode;readonly initialToken:string;readonly text:string }

/** 路径必须由明确成员序号/数组下标构成，名称是精确字符串而非对象访问表达式。 */
function validPath(segments:readonly LexicalPathSegment[]):boolean{return Array.isArray(segments)&&segments.length<=jsonLexicalLimits.depth&&segments.every(segment=>segment&&typeof segment==='object'&&(segment.kind==='member'?Number.isSafeInteger(segment.memberIndex)&&segment.memberIndex>=0&&typeof segment.key==='string':segment.kind==='element'&&Number.isSafeInteger(segment.index)&&segment.index>=0));}
/** 只捕获完整词法文档中的真实节点，不复制其它字段或解析数字值。 */
export function beginJsonNodeInput(document:ReadyLexicalDocument,segments:readonly LexicalPathSegment[]):JsonNodeInput{
  if(!validPath(segments))throw Error(text.path);
  const node=lexicalNodeAtPath(document,{document,segments});if(!node)throw Error(text.path);
  const path=Object.freeze(segments.map(segment=>Object.freeze({...segment}))),initialToken=lexicalToken(document,node);
  return Object.freeze({document,segments:path,node,initialToken,text:initialToken});
}
/** 不完整JSON也保留为dirty原文；超预算输入拒绝替换已有完整缓冲。 */
export function changeJsonNodeInput(input:JsonNodeInput,value:string):JsonNodeInput{
  assertTextInputBudget(value,jsonNodeInputBudget);
  return Object.freeze({...input,text:value});
}
/** dirty只比较原始token，合法性不决定是否需要离开保护。 */
export function jsonNodeInputDirty(input:JsonNodeInput|null):boolean{return !!input&&input.text!==input.initialToken;}
/** 先核同一文档和节点，再验证替换值及完整合并结果；失败不返回任何部分树或修改旧文档。 */
export function applyJsonNodeInput(input:JsonNodeInput,current:ReadyLexicalDocument):ReadyLexicalDocument{
  if(current!==input.document||lexicalNodeAtPath(current,{document:current,segments:input.segments})!==input.node||lexicalToken(current,input.node)!==input.initialToken)throw Error(text.changed);
  // 不信任组件或调用者已做检查，最终合并继续使用相同完整候选预算。
  assertTextInputBudget(input.text,jsonNodeInputBudget);
  if(!jsonNodeInputDirty(input))return current;
  const replacement=parseJsonLexicalTree(input.text);
  if(replacement.status!=='ready')throw Error(replacement.status==='limited'?text.limited:text.invalid.replace('{0}',replacement.reason));
  const size=current.text.length-(input.node.end-input.node.start)+input.text.length;if(size>jsonLexicalLimits.sourceUnits)throw Error(text.units);
  // token边界是JSON分隔符，UTF-8计费可相减相加，拼接前就拒绝超限结果。
  const previousBytes=boundedUtf8Bytes(input.initialToken,jsonLexicalLimits.sourceBytes);if(previousBytes===undefined)throw Error(text.changed);
  if(current.sourceBytes-previousBytes+replacement.sourceBytes>jsonLexicalLimits.sourceBytes)throw Error(text.bytes);
  const source=current.text.slice(0,input.node.start)+input.text+current.text.slice(input.node.end),result=parseJsonLexicalTree(source);
  if(result.status!=='ready')throw Error(text.combined.replace('{0}',result.reason));
  return result;
}
