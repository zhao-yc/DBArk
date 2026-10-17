import {completionAliasIdentifier,type CompletionToken} from './completionLexical';

const word=(token:CompletionToken|undefined,value:string)=>token?.kind==='word'&&token.value.toUpperCase()===value;
const name=(token:CompletionToken|undefined)=>!!token&&['word','identifier'].includes(token.kind)&&completionAliasIdentifier(token.value);
export type CompletionInsertRowAlias={name:string;targetStart:number}|'unsupported'|undefined;

/** 只识别当前 INSERT 的 VALUES 新行别名；局部名称即使不支持，也不能降级为同名数据库例程。 */
export function completionInsertRowAlias(tokens:CompletionToken[],caret:number,qualifiers:string[]):CompletionInsertRowAlias{
  if(!word(tokens[0],'INSERT')||!qualifiers.length)return;
  const body=tokens.findIndex(token=>['VALUES','VALUE','SET','SELECT'].some(value=>word(token,value)));
  if(body<0)return;
  // 只核对语法位置的 AS，字符串及引用标识符中的关键字不参与识别。
  const aliases=tokens.flatMap((token,index)=>index>body&&word(token,'AS')&&name(tokens[index+1])?[{token,alias:tokens[index+1]}]:[]);
  const matching=aliases.filter(value=>value.alias.value.toLowerCase()===qualifiers[0].toLowerCase());
  if(!matching.length)return;
  if(matching.length!==1||qualifiers.length!==1)return'unsupported';
  const candidate=matching[0],alias=candidate.alias;
  // 未闭合括号会把后续 AS 推入更深层；已知局部名仍须停止，不能借此绕过边界。
  if(alias.value!==qualifiers[0]||candidate.token.depth!==0||!word(tokens[body],'VALUES')&&!word(tokens[body],'VALUE'))return'unsupported';
  // 表头只收普通限定名和可选 INSERT 列清单；分区、其它语法不借恢复结果猜测目标表。
  let index=1;
  if(['LOW_PRIORITY','DELAYED','HIGH_PRIORITY'].some(value=>word(tokens[index],value)))index++;
  if(word(tokens[index],'IGNORE'))index++;
  if(word(tokens[index],'INTO'))index++;
  const target=tokens[index];if(!name(target))return'unsupported';index++;
  let table=target.value;if(tokens[index]?.value==='.'){index++;if(!name(tokens[index]))return'unsupported';table=tokens[index++].value;}
  if(alias.value.toLowerCase()===table.toLowerCase())return'unsupported';
  /** 按词法深度跳过已闭合括号，不递归展开 VALUES 表达式。 */
  const skipGroup=()=>{if(tokens[index]?.value!=='('||tokens[index].depth!==0)return false;index++;while(index<tokens.length&&!(tokens[index].value===')'&&tokens[index].depth===0))index++;if(index===tokens.length)return false;index++;return true;};
  if(tokens[index]?.value==='('&&!skipGroup())return'unsupported';
  if(!word(tokens[index],'VALUES')&&!word(tokens[index],'VALUE'))return'unsupported';index++;
  if(!skipGroup())return'unsupported';
  while(tokens[index]?.value===','){index++;if(!skipGroup())return'unsupported';}
  if(tokens[index]!==candidate.token||!word(tokens[index],'AS')||tokens[index+1]!==alias)return'unsupported';
  index+=2;
  if(!['ON','DUPLICATE','KEY','UPDATE'].every((value,step)=>word(tokens[index+step],value)))return'unsupported';
  index+=4;
  // 第一片允许普通函数/括号表达式，但整个语句中的嵌套 SELECT 和列别名列表暂不开放。
  if(tokens.some(token=>word(token,'SELECT'))||caret<tokens[index-1].end)return'unsupported';
  const updates=tokens.slice(index),before=updates.filter(token=>token.start<caret);let lastComma=-1;
  for(let step=0;step<before.length;step++)if(before[step].depth===0&&before[step].value===',')lastComma=step;
  const assignment=before.slice(lastComma+1);
  if(!name(assignment[0])||assignment[0].depth!==0||assignment[1]?.value!=='='||assignment[1].depth!==0||caret<assignment[1].end)return'unsupported';
  return{name:alias.value,targetStart:target.start};
}
