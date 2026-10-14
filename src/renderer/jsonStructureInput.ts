import {boundedUtf8Bytes,jsonLexicalLimits,lexicalNodeAtPath,lexicalToken,parseJsonLexicalTree,type LexicalNode,type ReadyLexicalDocument} from './jsonLexicalTree';
import {beginJsonNodeInput,type JsonNodeInput} from './jsonNodeInput';
import {jsonStructureInputZh as text} from './locales/jsonStructureInput.zh-CN';
export type JsonStructureSelection=Pick<JsonNodeInput,'document'|'segments'|'node'|'initialToken'>;
export type JsonStructureAction={kind:'rename';keyToken:string}|{kind:'remove'}|{kind:'append-member';keyToken:string;valueToken:string}|{kind:'insert-element';index:number;valueToken:string}|{kind:'move-element';from:number;to:number};
export {beginJsonNodeInput as beginJsonStructureSelection};

/** 原选择必须来自同一冻结文档和同一节点，等值新树也不能重用旧路径。 */
function assertSelection(selection:JsonStructureSelection,current:ReadyLexicalDocument):LexicalNode{
  if(current!==selection.document||lexicalNodeAtPath(current,{document:current,segments:selection.segments})!==selection.node||lexicalToken(current,selection.node)!==selection.initialToken)throw Error(text.changed);return selection.node;
}
/** key和值分别按原词法预算完整预检；JSON.parse不参与数值或容器转换。 */
function token(source:string,key=false):void{const parsed=parseJsonLexicalTree(source);if(parsed.status!=='ready'||key&&parsed.nodes[parsed.root].kind!=='string')throw Error(key?text.key:text.value);}
/** 拼接前按代码单元和UTF8计费，多段输入不能先组成超预算大串。 */
function concatenate(parts:readonly string[]):string{
  let units=0,bytes=0;for(const part of parts){units+=part.length;if(units>jsonLexicalLimits.sourceUnits)throw Error(text.limited);const size=boundedUtf8Bytes(part,jsonLexicalLimits.sourceBytes-bytes);if(size===undefined)throw Error(text.limited);bytes+=size;}return parts.join('');
}
/** 仅改变可信词法跨度，预检文本后完整解析合并文档，任何失败都不返回部分修改。 */
function splice(current:ReadyLexicalDocument,start:number,end:number,replacement:string):ReadyLexicalDocument{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>current.text.length)throw Error(text.changed);
  if(current.text.length-(end-start)+replacement.length>jsonLexicalLimits.sourceUnits)throw Error(text.limited);
  const removed=boundedUtf8Bytes(current.text.slice(start,end),jsonLexicalLimits.sourceBytes),added=boundedUtf8Bytes(replacement,jsonLexicalLimits.sourceBytes);if(removed===undefined||added===undefined||current.sourceBytes-removed+added>jsonLexicalLimits.sourceBytes)throw Error(text.limited);
  const source=current.text.slice(0,start)+replacement+current.text.slice(end);if(source===current.text)return current;
  const parsed=parseJsonLexicalTree(source);if(parsed.status!=='ready')throw Error(text.combined);return parsed;
}
/** 删除首中项时连同其后逗号删除；末项删除前置逗号，唯一项只删除自身。 */
function removeRange(current:ReadyLexicalDocument,starts:readonly number[],ends:readonly number[],index:number):ReadyLexicalDocument{
  if(index<0||index>=starts.length)throw Error(text.parent);
  if(starts.length===1)return splice(current,starts[0],ends[0],'');
  return index<starts.length-1?splice(current,starts[index],starts[index+1],''):splice(current,ends[index-1],ends[index],'');
}
/** 新下标只表示当前数组位置，插入允许尾后一位，移动只允许已有位置。 */
function assertIndex(index:number,length:number,insert=false):void{if(!Number.isSafeInteger(index)||index<0||index>length-(insert?0:1))throw Error(text.index);}

/** 纯模型只生成完整词法文档；行身份、互斥缓冲与原有预览提交由记录控制器负责。 */
export function applyJsonStructureAction(selection:JsonStructureSelection,current:ReadyLexicalDocument,action:JsonStructureAction):ReadyLexicalDocument{
  const node=assertSelection(selection,current);
  if(action.kind==='rename'||action.kind==='remove'){
    const last=selection.segments.at(-1);if(!last)throw Error(text.root);
    const parent=lexicalNodeAtPath(current,{document:current,segments:selection.segments.slice(0,-1)});if(!parent)throw Error(text.parent);
    if(last.kind==='member'){
      if(parent.kind!=='object')throw Error(text.parent);const member=parent.members[last.memberIndex];if(!member||member.key!==last.key||current.nodes[member.valueNode]!==node)throw Error(text.parent);
      if(action.kind==='rename'){token(action.keyToken,true);return splice(current,member.keySpan.start,member.keySpan.end,action.keyToken);}
      return removeRange(current,parent.members.map(value=>value.keySpan.start),parent.members.map(value=>current.nodes[value.valueNode].end),last.memberIndex);
    }
    if(action.kind==='rename'||parent.kind!=='array'||current.nodes[parent.elements[last.index]]!==node)throw Error(text.parent);
    return removeRange(current,parent.elements.map(value=>current.nodes[value].start),parent.elements.map(value=>current.nodes[value].end),last.index);
  }
  if(action.kind==='append-member'){
    if(node.kind!=='object')throw Error(text.object);token(action.keyToken,true);token(action.valueToken);
    const at=node.members.length?current.nodes[node.members.at(-1)!.valueNode].end:node.start+1;
    return splice(current,at,at,concatenate([node.members.length?',':'',action.keyToken,':',action.valueToken]));
  }
  if(node.kind!=='array')throw Error(text.array);
  if(action.kind==='insert-element'){
    assertIndex(action.index,node.elements.length,true);token(action.valueToken);const before=action.index<node.elements.length;
    const at=before?current.nodes[node.elements[action.index]].start:node.elements.length?current.nodes[node.elements.at(-1)!].end:node.start+1;
    return splice(current,at,at,concatenate([!before&&node.elements.length?',':'',action.valueToken,before?',':'']));
  }
  assertIndex(action.from,node.elements.length);assertIndex(action.to,node.elements.length);if(action.from===action.to)return current;
  const values=node.elements.map(index=>current.nodes[index]),order=[...values],moved=order.splice(action.from,1)[0];order.splice(action.to,0,moved);
  // 只旋转完整value token；逗号及空白槽位保持，移动过程中不使用已经失效的结构路径。
  const parts:string[]=[];values.forEach((value,index)=>{if(index)parts.push(current.text.slice(values[index-1].end,value.start));parts.push(lexicalToken(current,order[index]));});
  return splice(current,values[0].start,values.at(-1)!.end,concatenate(parts));
}
