import type{CompletionToken}from'./completionLexical';
import type{CompletionQueryBranch}from'./completionQueryScope';
import{completionWindowInheritance}from'./completionWindowInheritance';

const word=(token:CompletionToken|undefined,name:string)=>token?.kind==='word'&&token.value.toUpperCase()===name;
const symbol=(token:CompletionToken|undefined,value:string)=>token?.kind==='symbol'&&token.value===value;
const name=(token:CompletionToken|undefined)=>token?.kind==='word'||token?.kind==='identifier';

/** 仅识别当前SELECT已有窗口中的表达式边界；有界继承只定位字段，不创建关系或扩展目录权限。 */
export function completionWindowContext(branches:CompletionQueryBranch[],tokens:CompletionToken[],at:number,targetWord?:string,validate?:(start:number,end:number)=>boolean,frame?:(open:number,close:number|undefined)=>string[]|undefined):'expression'|'unsupported'|{frameKeywords:string[]}|undefined{
  const branch=branches.filter(item=>item.select.start<=at&&at<=item.end).sort((a,b)=>b.select.depth-a.select.depth||b.select.start-a.select.start)[0];
  const stack:number[]=[],close=new Map<number,number>();
  for(let index=0;index<tokens.length;index++){if(symbol(tokens[index],'('))stack.push(index);else if(symbol(tokens[index],')')){const open=stack.pop();if(open!==undefined)close.set(open,index);}}
  const containers=tokens.flatMap((token,index)=>symbol(token,'(')&&token.end<=at&&at<=(tokens[close.get(index)??-1]?.start??Infinity)?[index]:[]);
  /** 命名窗口只接受本块WINDOW name AS(...)列表，逗号不能被误认成SELECT或函数参数。 */
  function named(open:number):boolean{
    let start=-1;for(let index=open-1;index>=0;index--){if(tokens[index].depth!==tokens[open].depth)continue;if(word(tokens[index],'WINDOW')){start=index;break;}if(['SELECT','UNION','INTERSECT','EXCEPT'].some(value=>word(tokens[index],value)))break;}if(start<0)return false;
    for(let index=start+1;index<tokens.length;){if(!name(tokens[index])||!word(tokens[index+1],'AS')||!symbol(tokens[index+2],'('))return false;const current=index+2;if(current===open)return true;const end=close.get(current);if(end===undefined||!symbol(tokens[end+1],','))return false;index=end+2;}
    return false;
  }
  // 先检查所有外层帧：恢复解析可能没有分支，帧内嵌套表达式也不能借函数或字段目录。
  for(const open of containers){
    if(!word(tokens[open-1],'OVER')&&!named(open))continue;
    const keywords=frame?.(open,close.get(open));if(keywords?.length)return{frameKeywords:keywords};
    // 点号后的保留字仍是合法字段名，例如u.rows；不能把它误当作帧子句。
    if(tokens.slice(open+1,close.get(open)).some((token,index,list)=>token.depth===tokens[open].depth+1&&token.start<=at&&!symbol(list[index-1],'.')&&token.kind==='word'&&['ROWS','RANGE','GROUPS','EXCLUDE'].includes((token.start===at?targetWord??token.value:token.value).toUpperCase())))return'unsupported';
  }
  for(const open of containers.reverse()){
    if(!word(tokens[open-1],'OVER')&&!named(open))continue;
    // 窗口排序中的子查询继续用自身作用域；只有已确认分支才允许当前窗口表达式。
    if(branch&&tokens[open].start<branch.select.start)continue;
    if(!branch)return'unsupported';
    const first=tokens[open+1];if((!word(first,'PARTITION')&&!word(first,'ORDER'))||!word(tokens[open+2],'BY'))return completionWindowInheritance(branch,tokens,close,open,validate)?'expression':'unsupported';
    return'expression';
  }
}
