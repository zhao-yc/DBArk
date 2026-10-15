import {tableDefinitionTokens,type TableDefinitionToken as Token} from './tableColumnDefinition';
import type {SqlLexicalMode} from '../shared/queryParameters';
import type {SessionObjectColumn} from '../shared/sessionObjects';
import {sessionObjectLimits} from '../shared/sessionObjects';
import {completionIdentifier} from '../shared/completionLexical';
type Target={database:string;table:string};
export type SessionObjectAction={kind:'none'}|{kind:'opaque'}|{kind:'dependencies';targets:Target[]}|{kind:'create';target:Target;columns:SessionObjectColumn[];complete:boolean;declaration:boolean;keep:boolean;replace:boolean;effects:boolean}|{kind:'drop';targets:Target[]}|{kind:'alter';target:Target;parts:Token[][]}|{kind:'rename';pairs:{before:Target;after:Target}[]};
const word=(token:Token|undefined)=>token?.kind==='word'?token.value.toUpperCase():'';
const name=(token:Token|undefined)=>token&&(token.kind==='word'||token.kind==='identifier')&&completionIdentifier(token.value)?token.value:undefined;
const constraints=new Set(['PRIMARY','UNIQUE','KEY','INDEX','FOREIGN','CONSTRAINT','CHECK','FULLTEXT','SPATIAL','PERIOD']);
// 仅保留明确没有用户例程副作用的常用内置表达式；限定或引用的函数一律待核对。
const safeCalls=new Set(['ABS','CAST','CEIL','CEILING','COALESCE','CONCAT','CONCAT_WS','CONNECTION_ID','CONVERT','COUNT','CURDATE','CURRENT_DATE','CURRENT_TIME','CURRENT_TIMESTAMP','DATABASE','DATE','DATE_FORMAT','DAY','EXISTS','EXTRACT','FLOOR','FOUND_ROWS','GREATEST','IF','IFNULL','IN','ISNULL','JSON_EXTRACT','JSON_UNQUOTE','LEAST','LEFT','LENGTH','LOWER','MAX','MIN','MOD','NOW','NULLIF','OCTET_LENGTH','RAND','REPLACE','RIGHT','ROUND','ROW_COUNT','SLEEP','SUBSTR','SUBSTRING','SUM','TIME','TRIM','TRUNCATE','UPPER','UTC_TIMESTAMP','VALUES','VERSION','YEAR']);
/** 不能从SQL文本确认永久对象是否为调用函数的视图/触发器，因此只信任已确认临时来源。 */
function expressionAction(tokens:Token[],database:string|undefined):SessionObjectAction{
  const first=word(tokens[0]);if(!['SELECT','TABLE','INSERT','REPLACE','UPDATE','DELETE','SET'].includes(first))return{kind:'opaque'};
  let target:ReturnType<typeof objectTarget>,sourceAt=-1;
  if(first==='SELECT'||first==='DELETE'){const sources=tokens.flatMap((token,index)=>word(token)==='FROM'?[index]:[]);if(sources.length>1)return{kind:'opaque'};sourceAt=sources[0]??-1;}
  else if(first==='TABLE')sourceAt=0;
  else if(first==='UPDATE')sourceAt=0;
  else if(first==='INSERT'||first==='REPLACE'){let cursor=1;if(word(tokens[cursor])==='INTO')cursor++;sourceAt=cursor-1;}
  if(sourceAt>=0){target=objectTarget(tokens,sourceAt+1,database);if(!target)return{kind:'opaque'};let cursor=target.end;if(word(tokens[cursor])==='AS')cursor+=2;else if(name(tokens[cursor])&&!['WHERE','SET','VALUES','VALUE','SELECT','GROUP','HAVING','ORDER','LIMIT','FOR','LOCK','WINDOW','INTO','ON','RETURNING'].includes(word(tokens[cursor])))cursor++;
    if(tokens[cursor]?.value===','||tokens.some(token=>['JOIN','UNION','WITH','PROCEDURE'].includes(word(token))))return{kind:'opaque'};
  }
  if(tokens.some((token,index)=>index>0&&word(token)==='SELECT'))return{kind:'opaque'};
  for(let index=1;index<tokens.length;index++)if(tokens[index+1]?.value==='('&&(tokens[index].kind==='word'||tokens[index].kind==='identifier')){
    if(target&&index===target.end-1&&['INSERT','REPLACE'].includes(first))continue;
    if(tokens[index].kind!=='word'||tokens[index-1]?.value==='.'||!safeCalls.has(word(tokens[index])))return{kind:'opaque'};
  }
  return target?{kind:'dependencies',targets:[target.target]}:{kind:'none'};
}

/** 限定名逐token读取，名称中的点不能当作库分隔符。 */
export function objectTarget(tokens:Token[],cursor:number,database:string|undefined):{target:Target;end:number}|undefined{
  const first=name(tokens[cursor]);if(!first)return;
  if(tokens[cursor+1]?.value==='.') {const table=name(tokens[cursor+2]);if(!table)return;return{target:{database:first,table},end:cursor+3};}
  if(!database||!completionIdentifier(database))return;return{target:{database,table:first},end:cursor+1};
}
/** 仅在最外层分割，枚举、表达式及约束内部的逗号不会成为字段或ALTER动作。 */
export function objectParts(tokens:Token[]):Token[][]{
  const parts:Token[][]=[];let start=0,depth=0;
  for(let i=0;i<tokens.length;i++){if(tokens[i].kind!=='symbol')continue;if(tokens[i].value==='(')depth++;if(tokens[i].value===')'&&--depth<0)throw Error('结构括号不平衡');if(tokens[i].value===','&&depth===0){parts.push(tokens.slice(start,i));start=i+1;}}
  if(depth)throw Error('结构括号不平衡');parts.push(tokens.slice(start));return parts;
}
/** 只保留名称、基础类型和可见性，敏感默认值/注释从不进入目录。 */
export function objectColumn(tokens:Token[]):SessionObjectColumn|undefined{
  const column=name(tokens[0]);if(!column||constraints.has(word(tokens[0]))||['IF','NOT','EXISTS','COLUMN'].includes(word(tokens[0])))return;
  const type=word(tokens[1]).toLowerCase();let depth=0,visible=true;
  for(const token of tokens.slice(2)){if(token.kind==='symbol'&&token.value==='(')depth++;else if(token.kind==='symbol'&&token.value===')')depth--;else if(!depth&&word(token)==='INVISIBLE')visible=false;else if(!depth&&word(token)==='VISIBLE')visible=true;}
  return{name:column,...(type&&type.length<=64?{dataType:type}:{}),visible};
}
/** 解析成功DDL的目录变化；无法确认的语法只产生待核对状态，绝不执行或重写SQL。 */
function parse(sql:string,database:string|undefined,mode:SqlLexicalMode,dialect:'mysql'|'mariadb'):SessionObjectAction{
  if(sql.length>sessionObjectLimits.sqlUnits)return{kind:'opaque'};
  const tokens=tableDefinitionTokens(sql,{dialect,mode}).filter(token=>!(token.kind==='symbol'&&token.value===';'));
  if(tokens.some(token=>token.kind==='executable'))return{kind:'opaque'};
  const first=word(tokens[0]);if(!first)return{kind:'none'};
  if(['CALL','EXECUTE','DO','RESET','HANDLER','EXPLAIN','ANALYZE'].includes(first))return{kind:'opaque'};
  if(first==='CREATE'){
    let cursor=1,replace=false;if(word(tokens[cursor])==='OR'&&word(tokens[cursor+1])==='REPLACE'){cursor+=2;replace=true;}
    if(word(tokens[cursor])!=='TEMPORARY')return tokens.some(token=>word(token)==='SELECT')?{kind:'opaque'}:{kind:'none'};cursor++;if(word(tokens[cursor++])!=='TABLE')return{kind:'opaque'};
    let keep=false;if(word(tokens[cursor])==='IF'&&word(tokens[cursor+1])==='NOT'&&word(tokens[cursor+2])==='EXISTS'){keep=true;cursor+=3;}
    const target=objectTarget(tokens,cursor,database);if(!target)return{kind:'opaque'};cursor=target.end;const columns:SessionObjectColumn[]=[];let complete=false,primary=false;
    if(tokens[cursor]?.value==='('){let depth=1,end=cursor+1;for(;end<tokens.length&&depth;end++){if(tokens[end].kind==='symbol'&&tokens[end].value==='(')depth++;else if(tokens[end].kind==='symbol'&&tokens[end].value===')')depth--;}
      if(depth)return{kind:'opaque'};const parts=objectParts(tokens.slice(cursor+1,end-1));complete=true;
      for(const part of parts){primary||=part.some((token,index)=>word(token)==='PRIMARY'&&word(part[index+1])==='KEY');if(constraints.has(word(part[0])))continue;const column=objectColumn(part);if(column)columns.push(column);else complete=false;}cursor=end;
    }
    if(tokens.slice(cursor).some(token=>['LIKE','SELECT','SYSTEM','VERSIONING'].includes(word(token))))complete=false;
    // 失败原子性与成功后的完整性分开：隐含列不让失败声明虚构临时对象。
    const declaration=complete;
    // MySQL可在会话设置下隐式增加my_row_id；没有显式主键时不能声称声明就是完整服务器字段。
    if(dialect==='mysql'&&!primary)complete=false;
    if(columns.length>sessionObjectLimits.columns)return{kind:'opaque'};
    return{kind:'create',target:target.target,columns,complete,declaration,keep,replace,effects:tokens.slice(cursor).some(token=>word(token)==='SELECT')};
  }
  if(first==='DROP'){
    let cursor=1;const temporary=word(tokens[cursor])==='TEMPORARY';if(temporary)cursor++;if(word(tokens[cursor++])!=='TABLE')return temporary||word(tokens[cursor-1])==='TABLES'?{kind:'opaque'}:{kind:'none'};
    if(word(tokens[cursor])==='IF'&&word(tokens[cursor+1])==='EXISTS')cursor+=2;const targets:Target[]=[];
    while(cursor<tokens.length){const value=objectTarget(tokens,cursor,database);if(!value)return{kind:'opaque'};targets.push(value.target);cursor=value.end;if(tokens[cursor]?.value===','){cursor++;continue;}if(['CASCADE','RESTRICT'].includes(word(tokens[cursor])))cursor++;if(cursor!==tokens.length)return{kind:'opaque'};}
    return{kind:'drop',targets};
  }
  if(first==='ALTER'&&word(tokens[1])==='TABLE'){
    const target=objectTarget(tokens,2,database);return target?{kind:'alter',target:target.target,parts:objectParts(tokens.slice(target.end))}:{kind:'opaque'};
  }
  if(first==='ALTER')return{kind:'opaque'};
  if(first==='RENAME'&&word(tokens[1])==='TABLE'){
    const pairs:{before:Target;after:Target}[]=[];
    for(const part of objectParts(tokens.slice(2))){const before=objectTarget(part,0,database);if(!before||word(part[before.end])!=='TO')return{kind:'opaque'};const after=objectTarget(part,before.end+1,database);if(!after||after.end!==part.length)return{kind:'opaque'};pairs.push({before:before.target,after:after.target});}return{kind:'rename',pairs};
  }
  if(['SELECT','TABLE','WITH','INSERT','REPLACE','UPDATE','DELETE','SET','LOAD'].includes(first))return expressionAction(tokens,database);
  return{kind:'none'};
}
/** 未知引号模式须由四种候选同意，不能按默认模式猜测对象名。 */
export function sessionObjectAction(sql:string,database:string|undefined,mode:SqlLexicalMode,dialect:'mysql'|'mariadb'):SessionObjectAction{
  try{const actions:SessionObjectAction[]=[];for(const ansiQuotes of mode.ansiQuotesKnown===false?[false,true]:[mode.ansiQuotes])for(const noBackslashEscapes of mode.noBackslashEscapesKnown===false?[false,true]:[mode.noBackslashEscapes])actions.push(parse(sql,database,{ansiQuotes,noBackslashEscapes},dialect));return actions.every(action=>JSON.stringify(action)===JSON.stringify(actions[0]))?actions[0]:{kind:'opaque'};}catch{return{kind:'opaque'};}
}

/** ALTER只更新可完整表达的列动作；未知动作令列待读取，保留名称遮蔽。 */
export function alterObjectColumns(before:SessionObjectColumn[],parts:Token[][],database:string):{columns:SessionObjectColumn[];complete:boolean;rename?:Target}{
  let columns=before.map(column=>({...column})),complete=true,rename:Target|undefined;const index=(value:string)=>columns.findIndex(column=>column.name.toLowerCase()===value.toLowerCase());
  for(const raw of parts){const tokens=raw.filter(token=>!(token.kind==='symbol'&&token.value===';'));const action=word(tokens[0]);let cursor=1;if(['ADD','CHANGE','MODIFY','DROP'].includes(action)&&word(tokens[cursor])==='COLUMN')cursor++;
    if(action==='RENAME'&&word(tokens[1])==='COLUMN'){const old=name(tokens[2]),next=name(tokens[4]);if(old&&word(tokens[3])==='TO'&&next&&index(old)>=0)columns[index(old)].name=next;else complete=false;continue;}
    if(action==='RENAME'&&!['INDEX','KEY'].includes(word(tokens[1]))){cursor=['TO','AS'].includes(word(tokens[1]))?2:1;const next=objectTarget(tokens,cursor,database);if(next&&next.end===tokens.length)rename=next.target;else complete=false;continue;}
    if(action==='DROP'){if(['PRIMARY','KEY','INDEX','FOREIGN','CONSTRAINT','CHECK'].includes(word(tokens[cursor])))continue;const old=name(tokens[cursor]);if(old&&index(old)>=0)columns.splice(index(old),1);else complete=false;continue;}
    if(action==='ALTER'&&word(tokens[cursor])==='COLUMN'){const column=name(tokens[cursor+1]),visibility=word(tokens[cursor+3]);if(column&&word(tokens[cursor+2])==='SET'&&['VISIBLE','INVISIBLE'].includes(visibility)&&index(column)>=0&&tokens.length===cursor+4)columns[index(column)].visible=visibility==='VISIBLE';else complete=false;continue;}
    if(['ADD','CHANGE','MODIFY'].includes(action)){
      if(action==='ADD'&&tokens[cursor]?.value==='('&&tokens.at(-1)?.value===')'){for(const part of objectParts(tokens.slice(cursor+1,-1))){const column=objectColumn(part);if(column&&index(column.name)<0)columns.push(column);else complete=false;}continue;}
      if(constraints.has(word(tokens[cursor])))continue;const old=action==='CHANGE'?name(tokens[cursor++]):undefined,column=objectColumn(tokens.slice(cursor));if(!column){complete=false;continue;}
      const oldIndex=index(old??column.name);if(action!=='ADD'){if(oldIndex<0){complete=false;continue;}columns.splice(oldIndex,1);}else if(oldIndex>=0){complete=false;continue;}
      let at=action==='ADD'?columns.length:oldIndex,depth=0;
      for(let n=cursor+2;n<tokens.length;n++){const token=tokens[n];if(token.kind==='symbol'&&token.value==='(')depth++;else if(token.kind==='symbol'&&token.value===')')depth--;else if(!depth&&word(token)==='FIRST')at=0;else if(!depth&&word(token)==='AFTER'){const after=name(tokens[n+1]);const found=after?index(after):-1;if(found<0)complete=false;else at=found+1;}}
      columns.splice(at,0,column);continue;
    }
    if(['ALGORITHM','LOCK','DEFAULT','COMMENT','AUTO_INCREMENT','ROW_FORMAT','RENAME'].includes(action))continue;
    complete=false;
  }
  if(new Set(columns.map(column=>column.name.toLowerCase())).size!==columns.length)complete=false;
  return{columns,complete,...(rename?{rename}:{})};
}
