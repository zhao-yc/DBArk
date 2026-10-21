import {completionAliasIdentifier,type CompletionToken} from './completionLexical';

const word=(token:CompletionToken|undefined,value:string)=>token?.kind==='word'&&token.value.toUpperCase()===value;
const name=(token:CompletionToken|undefined)=>!!token&&['word','identifier'].includes(token.kind)&&completionAliasIdentifier(token.value);
export type CompletionInsertRowAlias={name:string;targetStart:number;setValues?:{start:number;end:number}[]}|'unsupported'|undefined;

/** 只识别当前 INSERT 的 VALUES／SET 新行别名；局部名称即使不支持，也不能降级为同名数据库例程。 */
export function completionInsertRowAlias(tokens:CompletionToken[],caret:number,qualifiers:string[]):CompletionInsertRowAlias{
  if(!word(tokens[0],'INSERT')||!qualifiers.length)return;
  const bodyWord=(token:CompletionToken)=>['VALUES','VALUE','SET','SELECT'].some(value=>word(token,value));
  let body=tokens.findIndex(token=>token.depth===0&&bodyWord(token));
  // 未闭合表头只用于识别确实跟在 VALUES 元组之后的声明，不把嵌套 CAST 的 AS 当声明。
  if(body<0)body=tokens.findIndex(bodyWord);
  if(body<0)return;
  // INSERT SELECT 的投影 AS 不是新行声明，不能抢占合法 schema 例程名称。
  if(word(tokens[body],'SELECT'))return;
  /** 找到同层完整括号的下一位置；只走有界 token，不递归展开表达式。 */
  function afterGroup(start:number,depth:number):number|undefined{if(tokens[start]?.value!=='('||tokens[start].depth!==depth)return;for(let end=start+1;end<tokens.length;end++)if(tokens[end].value===')'&&tokens[end].depth===depth)return end+1;}
  let declaration:number|undefined;
  if(word(tokens[body],'VALUES')||word(tokens[body],'VALUE')){
    declaration=afterGroup(body+1,tokens[body].depth);
    while(declaration!==undefined&&tokens[declaration]?.value===',')declaration=afterGroup(declaration+1,tokens[body].depth);
  }else if(word(tokens[body],'SET')){
    // SET 仅同层尾部AS声明新行；CAST等嵌套表达式中的AS不参与，完整赋值另与AST共同校验。
    const found=tokens.findIndex((token,index)=>index>body&&token.depth===tokens[body].depth&&word(token,'AS'));
    if(found>=0)declaration=found;
    else{
      // 缺右括号可能把实际尾声明推入表达式层；只有完整尾关键字匹配才标记局部名，CAST的AS类型不误抢schema。
      const nested=tokens.findIndex((token,index)=>index>body&&word(token,'AS')&&name(tokens[index+1])
        &&['ON','DUPLICATE','KEY','UPDATE'].every((value,step)=>word(tokens[index+2+step],value)));
      if(nested>=0)declaration=nested;
    }
  }
  if(declaration===undefined||!word(tokens[declaration],'AS')||!name(tokens[declaration+1]))return;
  const candidate=tokens[declaration],alias=tokens[declaration+1];
  if(alias.value.toLowerCase()!==qualifiers[0].toLowerCase())return;
  if(qualifiers.length!==1)return'unsupported';
  // 未闭合括号会把后续 AS 推入更深层；已知局部名仍须停止，不能借此绕过边界。
  if(alias.value!==qualifiers[0]||candidate.depth!==0)return'unsupported';
  // 表头只收普通限定名和可选 INSERT 列清单；分区、其它语法不借恢复结果猜测目标表。
  let index=1;
  if(['LOW_PRIORITY','DELAYED','HIGH_PRIORITY'].some(value=>word(tokens[index],value)))index++;
  if(word(tokens[index],'IGNORE'))index++;
  if(word(tokens[index],'INTO'))index++;
  const target=tokens[index];if(!name(target))return'unsupported';index++;
  let table=target.value;if(tokens[index]?.value==='.'){index++;if(!name(tokens[index]))return'unsupported';table=tokens[index++].value;}
  if(alias.value.toLowerCase()===table.toLowerCase())return'unsupported';
  /** 表头和VALUES按同一括号规则核对；SET逐项要求普通列等号赋值，表达式仍须真实AST通过。 */
  const skipGroup=()=>{const next=afterGroup(index,0);if(next===undefined)return false;index=next;return true;};
  const columns=tokens[index]?.value==='(';
  const setValues:{start:number;end:number}[]=[];
  if(tokens[index]?.value==='('&&!skipGroup())return'unsupported';
  if(word(tokens[index],'SET')){
    if(columns||index!==body)return'unsupported';
    const depth=tokens[index].depth;let start=++index;
    for(;index<=declaration;index++){
      if(index!==declaration&&!(tokens[index].value===','&&tokens[index].depth===depth))continue;
      if(index-start<3||!name(tokens[start])||tokens[start].depth!==depth||tokens[start+1]?.value!=='='||tokens[start+1].depth!==depth)return'unsupported';
      if(index-start!==3||!word(tokens[start+2],'DEFAULT'))setValues.push({start:tokens[start+2].start,end:tokens[index-1].end});
      start=index+1;
    }
    index=declaration;
  }else{
    if(!word(tokens[index],'VALUES')&&!word(tokens[index],'VALUE'))return'unsupported';index++;
    if(!skipGroup())return'unsupported';
    while(tokens[index]?.value===','){index++;if(!skipGroup())return'unsupported';}
  }
  if(tokens[index]!==candidate||tokens[index+1]!==alias)return'unsupported';
  index+=2;
  if(!['ON','DUPLICATE','KEY','UPDATE'].every((value,step)=>word(tokens[index+step],value)))return'unsupported';
  index+=4;
  // 第一片允许普通函数/括号表达式，但整个语句中的嵌套 SELECT 和列别名列表暂不开放。
  if(tokens.some(token=>word(token,'SELECT'))||caret<tokens[index-1].end)return'unsupported';
  const updates=tokens.slice(index),before=updates.filter(token=>token.start<caret);let lastComma=-1;
  for(let step=0;step<before.length;step++)if(before[step].depth===0&&before[step].value===',')lastComma=step;
  const assignment=before.slice(lastComma+1);
  if(!name(assignment[0])||assignment[0].depth!==0||assignment[1]?.value!=='='||assignment[1].depth!==0||caret<assignment[1].end)return'unsupported';
  return{name:alias.value,targetStart:target.start,...(word(tokens[body],'SET')?{setValues}:{})};
}
