import type{CommonEntityContext}from'dt-sql-parser/dist/parser/common/entityCollector';
import type{CompletionToken}from'./completionLexical';
import{completionBranchAt,type CompletionQueryBranch}from'./completionQueryScope';
const word=(token:CompletionToken|undefined,value:string)=>token?.kind==='word'&&token.value.toUpperCase()===value;
const symbol=(token:CompletionToken|undefined,value:string)=>token?.kind==='symbol'&&token.value===value;
const scopeKey=(entity:CommonEntityContext)=>entity.belongStmt.position.startIndex+':'+entity.belongStmt.position.endIndex+':'+entity.belongStmt.scopeDepth;

/** 点号后的LATERAL和引用标识符是名称；仅识别显式派生/连接位置的关键字。 */
export function completionLateralTokens(tokens:CompletionToken[]):number[]{return tokens.flatMap((token,index)=>word(token,'LATERAL')&&!symbol(tokens[index-1],'.')&&(symbol(tokens[index+1],'(')||word(tokens[index-1],'JOIN')||word(tokens[index-1],'FROM'))?[index]:[]);}
export interface CompletionLateralBoundary{entity:CommonEntityContext;start:number;end:number;keyword:number}
export type CompletionLateralScope={status:'ready';boundaries:CompletionLateralBoundary[]}|{status:'blocked'};

/** 把显式LATERAL与真实派生表AST一一核对；未知连接或恢复解析不能创造相关关系。 */
export function completionLateralScope(tables:CommonEntityContext[],branches:CompletionQueryBranch[],tokens:CompletionToken[]):CompletionLateralScope{
  const stack:number[]=[],close=new Map<number,number>();for(let index=0;index<tokens.length;index++){if(symbol(tokens[index],'('))stack.push(index);else if(symbol(tokens[index],')')){const open=stack.pop();if(open!==undefined)close.set(open,index);}}
  const boundaries:CompletionLateralBoundary[]=[];
  for(const index of completionLateralTokens(tokens)){
    const keyword=tokens[index],open=tokens[index+1],end=close.get(index+1);if(!symbol(open,'(')||end===undefined||!word(tokens[index+2],'SELECT'))return{status:'blocked'};
    const matches=tables.filter(entity=>entity.declareType===1&&entity.position.startIndex===open.start&&entity.position.endIndex===tokens[end].start);if(matches.length!==1)return{status:'blocked'};
    const entity=matches[0],branch=completionBranchAt(branches,entity.belongStmt,keyword.start);if(!branch||branch.select.depth!==keyword.depth||!entity._alias)return{status:'blocked'};
    const prefix=tokens.filter(token=>token.start>=branch.select.start&&token.start<keyword.start&&token.depth===keyword.depth),from=prefix.findIndex((token,index)=>word(token,'FROM')&&!symbol(prefix[index-1],'.'));if(from<0)return{status:'blocked'};
    const source=prefix.slice(from+1),previous=tokens[index-1],modifier=tokens[index-2],beforeModifier=tokens[index-3];
    if(source.some((token,index)=>!symbol(source[index-1],'.')&&['WHERE','GROUP','HAVING','WINDOW','ORDER','LIMIT','UNION','INTERSECT','EXCEPT'].some(value=>word(token,value))))return{status:'blocked'};
    if(word(previous,'JOIN')){
      if(source.some(token=>symbol(token,','))||['RIGHT','FULL','NATURAL','STRAIGHT_JOIN'].some(value=>word(modifier,value)||word(beforeModifier,value))||word(modifier,'OUTER')&&!word(beforeModifier,'LEFT'))return{status:'blocked'};
    }else if(symbol(previous,',')){if(source.some((token,index)=>!symbol(source[index-1],'.')&&(word(token,'JOIN')||word(token,'STRAIGHT_JOIN'))))return{status:'blocked'};}
    else if(!word(previous,'FROM'))return{status:'blocked'};
    // 本切片不解释派生列重命名列表，不能按旧投影名读取错误字段。
    const alias=tokens.findIndex(token=>token.start===entity._alias!.startIndex);if(alias<0||symbol(tokens[alias+1],'('))return{status:'blocked'};
    for(const previous of tables.filter(item=>item.declareType===1&&item.position.endIndex<keyword.start&&scopeKey(item)===scopeKey(entity))){const position=tokens.findIndex(token=>token.start===previous._alias?.startIndex);if(position>=0&&symbol(tokens[position+1],'('))return{status:'blocked'};}
    boundaries.push({entity,start:open.start,end:tokens[end].end,keyword:keyword.start});
  }
  return{status:'ready',boundaries};
}

/** 同级来源必须在该LATERAL之前；更外层关联来源仍由全部派生/CTE屏障共同核对。 */
export function completionLateralAllows(boundary:CompletionLateralBoundary,entity:CommonEntityContext):boolean{
  return scopeKey(boundary.entity)!==scopeKey(entity)||entity.position.endIndex<boundary.keyword;
}
