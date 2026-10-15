import type{CommonEntityContext,StmtContext}from'dt-sql-parser/dist/parser/common/entityCollector';
import type{CompletionToken}from'./completionLexical';
type Query=CommonEntityContext;
const word=(token:CompletionToken|undefined,name:string)=>token?.kind==='word'&&token.value.toUpperCase()===name;
const key=(scope:StmtContext)=>scope.position.startIndex+':'+scope.position.endIndex+':'+scope.scopeDepth;
export interface CompletionQueryBranch{query:Query;select:CompletionToken;end:number}

/** 语法库把UNION分支放入同一Stmt，真实括号及集合操作共同限定每个SELECT的来源。 */
export function completionQueryBranches(queries:Query[],tokens:CompletionToken[]):CompletionQueryBranch[]{
  return queries.flatMap(query=>{let found:CompletionToken|undefined;for(let index=tokens.length-1;index>=0;index--){const token=tokens[index];if(word(token,'SELECT')&&token.start<query.position.startIndex&&token.start>=query.belongStmt.position.startIndex){found=token;break;}}const select=found;if(!select)return[];
    const boundary=tokens.find(token=>token.start>select.start&&(token.value===')'&&token.kind==='symbol'&&token.depth<select.depth||token.depth===select.depth&&['UNION','INTERSECT','EXCEPT'].some(name=>word(token,name))));return[{query,select,end:Math.min(query.belongStmt.position.endIndex+1,boundary?.start??Infinity)}];});
}

/** 所选语句内的最近分支；祖先来源检查仍由调用方的作用域规则决定。 */
export function completionBranchAt(branches:CompletionQueryBranch[],scope:StmtContext,at:number):CompletionQueryBranch|undefined{
  return branches.filter(branch=>key(branch.query.belongStmt)===key(scope)&&branch.select.start<=at&&at<=branch.end).sort((a,b)=>b.select.depth-a.select.depth||b.select.start-a.select.start)[0];
}
export interface CompletionOutputContext{query:Query;clause:'order'|'group'|'having';union:boolean;branch?:CompletionQueryBranch}

/** 输出别名仅属于当前查询块；窗口/聚合内部ORDER不会被当成外层ORDER。 */
export function completionOutputContext(branches:CompletionQueryBranch[],tokens:CompletionToken[],at:number):CompletionOutputContext|undefined{
  const scopes=branches.map(branch=>branch.query.belongStmt).filter(scope=>scope.position.startIndex<=at&&at<=scope.position.endIndex+1).sort((a,b)=>b.scopeDepth-a.scopeDepth||(a.position.endIndex-a.position.startIndex)-(b.position.endIndex-b.position.startIndex)),scope=scopes[0];if(!scope)return;
  const scoped=branches.filter(branch=>key(branch.query.belongStmt)===key(scope)),branch=completionBranchAt(branches,scope,at),clauses:{token:CompletionToken;clause:'order'|'group'|'having'}[]=[];
  for(let index=0;index<tokens.length;index++){const token=tokens[index];if(token.start<scope.position.startIndex||token.start>=at||token.kind!=='word')continue;const name=token.value.toUpperCase();if((name==='ORDER'||name==='GROUP')&&!word(tokens[index+1],'BY')||!['ORDER','GROUP','HAVING'].includes(name))continue;
    // 右括号离开该层、后续子句或集合操作出现后，此处不再属于原子句。
    const ended=tokens.some(next=>next.start>token.start&&next.start<at&&(next.kind==='symbol'&&next.value===')'&&next.depth<token.depth||next.depth===token.depth&&next.kind==='word'&&['WHERE','GROUP','HAVING','WINDOW','ORDER','LIMIT','FOR','UNION','INTERSECT','EXCEPT','INTO'].includes(next.value.toUpperCase())));if(!ended)clauses.push({token,clause:name==='ORDER'?'order':name==='GROUP'?'group':'having'});
  }
  for(const candidate of clauses.sort((a,b)=>b.token.start-a.token.start)){
    const {token,clause}=candidate,operators=tokens.filter(item=>item.start>=scope.position.startIndex&&item.start<token.start&&item.depth===token.depth&&['UNION','INTERSECT','EXCEPT'].some(name=>word(item,name))&&!tokens.some(close=>close.kind==='symbol'&&close.value===')'&&close.depth<item.depth&&close.start>item.start&&close.start<token.start));
    if(operators.length){if(clause!=='order')continue;const first=scoped.filter(item=>item.select.start<operators[0].start&&item.select.depth>=token.depth).sort((a,b)=>a.select.start-b.select.start)[0];if(first)return{query:first.query,clause,union:true};}
    if(branch&&token.depth===branch.select.depth&&token.start>branch.query.position.endIndex)return{query:branch.query,clause,union:false,branch};
  }
}
