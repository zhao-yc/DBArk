import {MySQL} from 'dt-sql-parser/dist/parser/mysql/index';
import type {EntityContext,CommonEntityContext,StmtContext} from 'dt-sql-parser/dist/parser/common/entityCollector';
import {completionLexicalContext,completionIdentifier,completionAliasIdentifier,quoteCompletionAlias,type CompletionLexicalMode,type CompletionLexicalContext,type CompletionToken} from './completionLexical';
import {completionLimits} from './sqlCompletion';
import{completionQueryBranches,completionBranchAt,completionOutputContext}from'./completionQueryScope';

export interface CompletionCatalogSource{database?:string;table:string}
/** 派生列只携带名称与需惰性展开的目录来源，不把AST循环引用传出worker。 */
export interface CompletionRelation{
  name:string;source:'table'|'derived'|'cte';database?:string;table?:string;aliased:boolean;
  columns:string[];catalogs:CompletionCatalogSource[];incomplete:boolean;
}
export type CompletionSyntax='database'|'relation'|'column'|'function'|'procedure';
export interface CompletionOutputAliases{clause:'order'|'group'|'having';union:boolean;aliases:string[];columns:string[];catalogs:CompletionCatalogSource[];localNames:string[];localCount:number;incomplete:boolean}
export interface CompletionAnalysisReady{
  status:'ready';target:CompletionLexicalContext['target'];syntax:CompletionSyntax[];keywords:string[];
  relations:CompletionRelation[];localRelations:string[];columnMode:'expression'|'insert-list';incomplete:boolean;outputAliases?:CompletionOutputAliases;
}
export type CompletionAnalysis=CompletionAnalysisReady|{status:'blocked';reason:string};
interface Cte{name:string;columns?:string[];start:number;end:number;bodyStart:number;bodyEnd:number;scopeEnd:number;recursive:boolean}
interface Projection{columns:string[];catalogs:CompletionCatalogSource[];incomplete:boolean}

/** 第三方默认错误监听器可能输出完整SQL；补全解析只在本地静默失败。 */
class QuietMySQL extends MySQL{
  override createLexer(...args:Parameters<MySQL['createLexer']>){return super.createLexer(args[0],args[1]??(()=>{}));}
  override createParser(...args:Parameters<MySQL['createParser']>){return super.createParser(args[0],args[1]??(()=>{}));}
}
const nameToken=(token:CompletionToken|undefined)=>token!==undefined&&['word','identifier'].includes(token.kind)&&completionIdentifier(token.value);
const keyword=(token:CompletionToken|undefined,value:string)=>token?.kind==='word'&&token.value.toUpperCase()===value;
const contains=(start:number,end:number,offset:number)=>start<=offset&&offset<=end;
const scopeKey=(scope:StmtContext)=>scope.position.startIndex+':'+scope.position.endIndex+':'+scope.scopeDepth;

/** 只将当前语句投影为模式无关的解析文本；注释及字符串内容不会进入语法库错误输出。 */
function normalize(source:string,context:CompletionLexicalContext){
  const names=new Set(context.tokens.map(token=>token.value.toLowerCase()));let serial=0,sentinel:string;
  do{sentinel='__dbark_caret_'+serial+++'__';}while(names.has(sentinel));
  let text='',previous=context.statement.start,caret=-1,inserted=false;const origins=new Map<number,CompletionToken>();
  const gap=(end:number)=>{text+=source.slice(previous,end).replace(/[^\r\n]/g,' ');previous=end;};
  for(const token of context.tokens){
    if(!inserted&&context.target.start<=token.start){gap(context.target.start);caret=text.length;text+=sentinel;inserted=true;previous=context.target.end;}
    if(token.start<context.target.end&&token.end>context.target.start)continue;
    if(previous>token.start)continue;
    gap(token.start);
    origins.set(text.length,token);text+=token.kind==='identifier'?quoteCompletionAlias(token.value):token.kind==='string'?"'0'":source.slice(token.start,token.end);previous=token.end;
  }
  if(!inserted){gap(context.target.start);caret=text.length;text+=sentinel;previous=context.target.end;}
  gap(context.statement.end);
  return{text,caret,sentinel,origins};
}

/** 字符串只在AST确认是别名时解码；未知反斜线模式必须得到相同名称，普通值仍不参与补全输出。 */
function stringAlias(source:string,token:CompletionToken,mode:CompletionLexicalMode):string|undefined{
  if(!token.closed)return;const raw=source.slice(token.start,token.end),quote=raw[0],results:string[]=[],escapes:Record<string,string>={'0':'\0',b:'\b',n:'\n',r:'\r',t:'\t',Z:'\x1a'};
  for(const noBackslash of mode.noBackslashEscapes===undefined?[false,true]:[mode.noBackslashEscapes]){let value='';for(let index=1;index<raw.length-1;index++){const char=raw[index];if(char===quote&&raw[index+1]===quote){value+=quote;index++;}else if(char==='\\'&&!noBackslash&&index+1<raw.length-1){const next=raw[++index];value+=next==='%'||next==='_'?'\\'+next:Object.hasOwn(escapes,next)?escapes[next]:next;}else value+=char;}results.push(value);}
  return results.every(value=>value===results[0])&&completionAliasIdentifier(results[0])?results[0]:undefined;
}

/** 解析器已规范化为反引号，限定名仍逐token读取，不能按名称中的点号拆分。 */
function entityName(text:string):string[]|null{
  const context=completionLexicalContext(text,text.length,{ansiQuotes:false,noBackslashEscapes:true});if(context.status!=='ready')return null;
  const tokens=context.tokens;if(!tokens.length||tokens.length>5||tokens.length%2!==1)return null;
  const names:string[]=[];for(let index=0;index<tokens.length;index++){if(index%2===0){if(!nameToken(tokens[index]))return null;names.push(tokens[index].value);}else if(tokens[index].value!=='.')return null;}
  return names;
}

/** WITH的名称、显式列和括号范围使用有界token核对，查询体仍由MySQL AST提供。 */
function collectCtes(tokens:CompletionToken[],end:number):Cte[]{
  const close=new Map<number,number>(),stack:number[]=[];for(let index=0;index<tokens.length;index++){if(tokens[index].value==='(')stack.push(index);else if(tokens[index].value===')'){const open=stack.pop();if(open!==undefined)close.set(open,index);}}
  const result:Cte[]=[];
  for(let position=0;position<tokens.length;position++){
    if(!keyword(tokens[position],'WITH'))continue;const withToken=tokens[position];let index=position+1;const recursive=keyword(tokens[index],'RECURSIVE');if(recursive)index++;
    const scopeEnd=tokens.find((token,i)=>i>position&&token.value===')'&&token.depth<withToken.depth)?.start??end;
    while(result.length<=completionLimits.entries){
      const name=tokens[index];if(!nameToken(name))break;index++;let columns:string[]|undefined;
      if(tokens[index]?.value==='('){const finish=close.get(index);if(finish===undefined)break;const list=tokens.slice(index+1,finish);if(!list.length||list.some((token,i)=>i%2===0?!nameToken(token):token.value!==',')||list.length%2!==1)break;columns=list.filter((_,i)=>i%2===0).map(token=>token.value);index=finish+1;}
      if(!keyword(tokens[index],'AS')||tokens[index+1]?.value!=='(')break;index++;const finish=close.get(index);if(finish===undefined)break;
      result.push({name:name.value,columns,start:withToken.start,end:tokens[finish].end,bodyStart:tokens[index].end,bodyEnd:tokens[finish].start,scopeEnd,recursive});index=finish+1;if(tokens[index]?.value!==',')break;index++;
    }
  }
  return result;
}

/** SQL补全语义分析在可终止worker内调用；返回结构有界，异常不包含SQL正文。 */
export function analyzeCompletion(source:string,offset:number,mode:CompletionLexicalMode={}):CompletionAnalysis{
  const lexical=completionLexicalContext(source,offset,mode,completionLimits.aliasUnits);if(lexical.status!=='ready')return lexical;
  try{
    const normalized=normalize(source,lexical);if(normalized.text.length>completionLimits.sourceUnits)return{status:'blocked',reason:'budget'};
    const context=completionLexicalContext(normalized.text,normalized.caret,{ansiQuotes:false,noBackslashEscapes:true},completionLimits.aliasUnits);if(context.status!=='ready')return{status:'blocked',reason:'syntax'};
    const normalizedTokens=context.tokens;
    const before=normalized.text.slice(0,normalized.caret).split('\n'),position={lineNumber:before.length,column:before.at(-1)!.length+1},parser=new QuietMySQL();
    const suggestions=parser.getSuggestionAtCaretPosition(normalized.text,position),entities=parser.getAllEntities(normalized.text,position)??[];
    if(entities.length>completionLimits.tokens)return{status:'blocked',reason:'budget'};
    const tables=entities.filter(entity=>entity.entityContextType==='table') as CommonEntityContext[],queries=entities.filter(entity=>entity.entityContextType==='queryResult') as CommonEntityContext[],ctes=collectCtes(normalizedTokens,normalized.text.length);
    if(ctes.length>completionLimits.entries)return{status:'blocked',reason:'budget'};
    let expansions=0,truncated=false;const branches=completionQueryBranches(queries,normalizedTokens);
    /** 引用名和字符串别名均回到原token解码，不能把已脱敏的'0'当成真实别名。 */
    function aliasName(alias:{startIndex:number}|null|undefined):string|undefined{if(!alias)return;const origin=normalized.origins.get(alias.startIndex);if(!origin)return;if(origin.kind==='string')return stringAlias(source,origin,mode);return completionAliasIdentifier(origin.value)&&origin.value!==normalized.sentinel?origin.value:undefined;}
    /** 语法库可能把UNION各分支放进同一个语句范围，表来源还须按同层UNION边界核对。 */
    function sameBranch(scope:StmtContext,entityAt:number,at:number):boolean{
      const branch=completionBranchAt(branches,scope,at);return !branch||contains(branch.select.start,branch.end,entityAt);
    }
    /** 相同作用域内重复名称不任取一张表；内层遮蔽外层，并保留合法关联子查询祖先。 */
    function visible(at:number):CommonEntityContext[]{
      const boundaries=tables.filter(entity=>entity.declareType===1&&contains(entity.position.startIndex,entity.position.endIndex+1,at));
      const cteBoundary=ctes.filter(cte=>contains(cte.bodyStart,cte.bodyEnd,at)).sort((a,b)=>b.bodyStart-a.bodyStart)[0];
      const candidates=tables.filter(entity=>{
        const scope=entity.belongStmt.position;if(!contains(scope.startIndex,scope.endIndex+1,at))return false;
        if(!sameBranch(entity.belongStmt,entity.position.startIndex,at))return false;
        if(entity.declareType===1&&contains(entity.position.startIndex,entity.position.endIndex+1,at))return false;
        // 普通派生表和CTE不是关联子查询；尚未确认LATERAL能力时不越过它们读外层别名。
        if(boundaries.some(boundary=>scope.startIndex<boundary.position.startIndex))return false;
        if(cteBoundary&&scope.startIndex<cteBoundary.bodyStart)return false;
        return true;
      }).sort((a,b)=>b.belongStmt.scopeDepth-a.belongStmt.scopeDepth||b.belongStmt.position.startIndex-a.belongStmt.position.startIndex);
      const selected=new Map<string,{scope:string;items:CommonEntityContext[]}>();
      for(const entity of candidates){const name=relationName(entity);if(!name)continue;const key=scopeKey(entity.belongStmt),old=selected.get(name);if(!old)selected.set(name,{scope:key,items:[entity]});else if(old.scope===key)old.items.push(entity);}
      const visible=[...selected.values()].flatMap(value=>value.items.length===1?value.items:[]);if(visible.length>completionLimits.entries)truncated=true;return visible.slice(0,completionLimits.entries);
    }
    /** 表别名覆盖原名称；没有别名时只使用真实表名这一段。 */
    function relationName(entity:CommonEntityContext):string|undefined{if(entity._alias)return entityName(entity._alias.text)?.[0];return entityName(entity.text)?.at(-1);}
    /** WITH的前向引用与未声明递归自引用都不回退成物理表请求。 */
    function cteFor(entity:CommonEntityContext,name:string):Cte|null|undefined{
      const at=entity.position.startIndex,candidates=ctes.filter(cte=>cte.name===name&&contains(cte.start,cte.scopeEnd,at)).sort((a,b)=>b.start-a.start);if(!candidates.length)return undefined;
      const cte=candidates[0];if(at<cte.end&&!(cte.recursive&&contains(cte.bodyStart,cte.bodyEnd,at)))return null;return cte;
    }
    /** 解析表达式的投影列；星号只产出实际目录来源，绝不执行SELECT探测列。 */
    function rawProjection(query:CommonEntityContext|undefined,visited:Set<CommonEntityContext>,depth:number):Projection{
      if(!query||depth>completionLimits.depth||++expansions>completionLimits.tokens)return{columns:[],catalogs:[],incomplete:true};
      const columns:string[]=[],catalogs:CompletionCatalogSource[]=[];let incomplete=false;
      for(const column of query.columns??[]){
        // 库的收集器也可能附带WHERE/ORDER等列实体；派生输出必须位于实际SELECT投影范围。
        if(scopeKey(column.belongStmt)!==scopeKey(query.belongStmt)||column.position.startIndex<query.position.startIndex||column.position.endIndex>query.position.endIndex)continue;
        if(column._alias){const alias=aliasName(column._alias);if(alias)columns.push(alias);else incomplete=true;continue;}
        if(column.declareType===0){const name=entityName(column.text)?.at(-1);if(name&&name!==normalized.sentinel)columns.push(name);}
        else if(column.declareType===1){
          const prefix=column.text.trim().replace(/\*\s*$/,'').replace(/\.\s*$/,'').trim(),parts=prefix?entityName(prefix):[];
          const sources=tables.filter(entity=>scopeKey(entity.belongStmt)===scopeKey(query.belongStmt)&&sameBranch(query.belongStmt,entity.position.startIndex,query.position.startIndex)&&(!parts?.length||relationName(entity)===parts.at(-1)));
          if(parts===null||!sources.length){incomplete=true;continue;}
          for(const entity of sources){const relation=resolve(entity,visited,depth+1);if(!relation){incomplete=true;continue;}columns.push(...relation.columns);catalogs.push(...relation.catalogs);incomplete||=relation.incomplete;}
        }else incomplete=true;
        if(columns.length>completionLimits.entries||catalogs.length>completionLimits.entries){incomplete=true;break;}
      }
      return{columns:columns.slice(0,completionLimits.entries),catalogs:uniqueCatalogs(catalogs),incomplete};
    }
    /** 重复输出名不能假装为完整派生结构；原始次数另用于别名歧义判定。 */
    function projection(query:CommonEntityContext|undefined,visited:Set<CommonEntityContext>,depth:number):Projection{const raw=rawProjection(query,visited,depth),columns=[...new Set(raw.columns)];return{...raw,columns,incomplete:raw.incomplete||columns.length!==raw.columns.length};}
    /** 解析链使用对象集合防循环，不以JS属性访问用户名称。 */
    function resolve(entity:CommonEntityContext,visited=new Set<CommonEntityContext>(),depth=0):CompletionRelation|undefined{
      const name=relationName(entity);if(!name||name===normalized.sentinel)return undefined;
      if(visited.has(entity)||depth>completionLimits.depth)return{name,source:'derived',aliased:!!entity._alias,columns:[],catalogs:[],incomplete:true};
      const next=new Set(visited);next.add(entity);
      if(entity.declareType===1){const query=entity.relatedEntities?.filter(item=>item.entityContextType==='queryResult').sort((a,b)=>a.position.startIndex-b.position.startIndex)[0] as CommonEntityContext|undefined;return{name,source:'derived',aliased:!!entity._alias,...projection(query,next,depth+1)};}
      const parts=entityName(entity.text);if(!parts?.length||parts.length>2||parts.includes(normalized.sentinel))return undefined;
      if(parts.length===1){const cte=cteFor(entity,parts[0]);if(cte===null)return undefined;if(cte){const query=queries.filter(item=>contains(cte.bodyStart,cte.bodyEnd,item.position.startIndex)).sort((a,b)=>a.position.startIndex-b.position.startIndex)[0];return{name,source:'cte',aliased:!!entity._alias,...(cte.columns?{columns:cte.columns.slice(0,completionLimits.entries),catalogs:[],incomplete:cte.columns.length>completionLimits.entries}:projection(query,next,depth+1))};}}
      const database=parts.length===2?parts[0]:undefined,table=parts.at(-1)!;return{name,source:'table',database,table,aliased:!!entity._alias,columns:[],catalogs:[{database,table}],incomplete:false};
    }
    let relations=visible(normalized.caret).map(entity=>resolve(entity)).filter((value):value is CompletionRelation=>!!value);let outputAliases:CompletionOutputAliases|undefined;
    const output=completionOutputContext(branches,normalizedTokens,normalized.caret);
    if(output){const raw=rawProjection(output.query,new Set(),0),counts=new Map<string,number>();for(const name of raw.columns)counts.set(name.toLowerCase(),(counts.get(name.toLowerCase())??0)+1);const aliases:string[]=[];let incomplete=raw.incomplete||[...counts.values()].some(count=>count>1);
      for(const column of output.query.columns??[]){if(!column._alias||column.position.startIndex<output.query.position.startIndex||column.position.endIndex>output.query.position.endIndex)continue;const name=aliasName(column._alias);if(!name||counts.get(name.toLowerCase())!==1){incomplete=true;continue;}
        const nested=queries.filter(query=>scopeKey(query.belongStmt)!==scopeKey(output.query.belongStmt)),tokens=normalizedTokens.filter(token=>token.start>=column.position.startIndex&&token.start<=column.position.endIndex&&!nested.some(query=>contains(query.belongStmt.position.startIndex,query.belongStmt.position.endIndex+1,token.start))),window=tokens.some(token=>keyword(token,'OVER')),aggregate=tokens.some((token,index)=>token.kind==='word'&&['AVG','COUNT','SUM','MIN','MAX','GROUP_CONCAT','JSON_ARRAYAGG','JSON_OBJECTAGG','BIT_AND','BIT_OR','BIT_XOR','STD','STDDEV','STDDEV_POP','STDDEV_SAMP','VARIANCE','VAR_POP','VAR_SAMP'].includes(token.value.toUpperCase())&&tokens[index+1]?.value==='('&&tokens[index-1]?.value!=='.');
        if(output.clause==='group'&&(aggregate||window)||output.clause==='having'&&window)continue;aliases.push(name);
      }
      const local=tables.filter(entity=>scopeKey(entity.belongStmt)===scopeKey(output.query.belongStmt)&&sameBranch(entity.belongStmt,entity.position.startIndex,output.query.position.startIndex)),localNames=local.map(relationName).filter((name):name is string=>!!name);
      outputAliases={clause:output.clause,union:output.union,aliases,columns:raw.columns.filter(name=>counts.get(name.toLowerCase())===1),catalogs:raw.catalogs,localNames,localCount:local.length,incomplete};if(output.union)relations=[];
    }
    const syntax=new Set<CompletionSyntax>();for(const item of suggestions?.syntax??[]){const kind=item.syntaxContextType;if(kind==='table'||kind==='view')syntax.add('relation');else if(['database','column','function','procedure'].includes(kind))syntax.add(kind as CompletionSyntax);}
    // INSERT列清单不是CREATE列；语法库未提供该候选规则时，只接受已解析目标表后紧邻的列括号。
    const insertTarget=tables.find(entity=>entity.belongStmt.stmtContextType==='insertStmt');
    let columnMode:CompletionAnalysisReady['columnMode']='expression';
    if(insertTarget){const tail=normalizedTokens.filter(token=>token.start>insertTarget.position.endIndex),open=tail[0];if(open?.value==='('){const close=tail.find(token=>token.value===')'&&token.depth===open.depth);if(close&&contains(open.end,close.start,normalized.caret)&&tail.filter(token=>token.start>open.start&&token.start<close.start).every(token=>nameToken(token)||token.value===',')){syntax.add('column');columnMode='insert-list';}}}
    const localRelations=[...new Set(ctes.filter(cte=>contains(cte.end,cte.scopeEnd,normalized.caret)||cte.recursive&&contains(cte.bodyStart,cte.bodyEnd,normalized.caret)).map(cte=>cte.name))].slice(0,completionLimits.entries);
    return{status:'ready',target:lexical.target,syntax:[...syntax],keywords:[...new Set(suggestions?.keywords??[])].filter(value=>/^[A-Z_][A-Z_0-9 ]{0,63}$/.test(value)).slice(0,completionLimits.suggestions),relations,localRelations,columnMode,incomplete:truncated||relations.some(relation=>relation.incomplete)||outputAliases?.incomplete===true,...(outputAliases?{outputAliases}:{})};
  }catch{return{status:'blocked',reason:'syntax'};}
}

/** 物理列来源按结构化二元组去重，原型名和带点号名称互不碰撞。 */
function uniqueCatalogs(values:CompletionCatalogSource[]):CompletionCatalogSource[]{const unique=new Map<string,CompletionCatalogSource>();for(const value of values)unique.set(JSON.stringify([value.database??null,value.table]),value);return[...unique.values()].slice(0,completionLimits.entries);}
