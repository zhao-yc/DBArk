import {Buffer} from 'node:buffer';
import {structureSearchLimits,searchIdentifier,type DefinitionSearchKind,type StructureSearchInput,type StructureSearchPage} from '../shared/databaseSearch';
import type {ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';
import {completionQuery} from './completionQuery';
import {databaseSearchMatch} from './databaseSearchMatch';
import {qualified} from './sql';
import {definitionOmittingSqlModes} from '../shared/tableColumnPatches';
import {definitionNavigationResult} from './definitionNavigation';

export interface DefinitionSearchState{input:StructureSearchInput;scope:number;total:number;after?:{object:string;name:string};scannedDefinitions?:number}
type Control=Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>;
const binary=(expression:string)=>'CAST('+expression+' AS BINARY)';
const showTypes:Record<DefinitionSearchKind,{type:string;column:string}>={table:{type:'TABLE',column:'Create Table'},view:{type:'VIEW',column:'Create View'},procedure:{type:'PROCEDURE',column:'Create Procedure'},function:{type:'FUNCTION',column:'Create Function'},trigger:{type:'TRIGGER',column:'SQL Original Statement'},event:{type:'EVENT',column:'Create Event'}};

/** 枚举当前账号可见的真实对象；名称只作排序参数，不把定义匹配伪装为名称匹配。 */
export function definitionCandidateQuery(kind:DefinitionSearchKind,database:string,after?:string){
 searchIdentifier.parse(database);if(after!==undefined)searchIdentifier.parse(after);if(!Object.hasOwn(showTypes,kind))throw Error('不支持的定义对象类别');
 const table=kind==='table'||kind==='view'?'TABLES':kind==='procedure'||kind==='function'?'ROUTINES':kind==='trigger'?'TRIGGERS':'EVENTS';
 const prefix=table==='TABLES'?'TABLE':table==='ROUTINES'?'ROUTINE':table==='TRIGGERS'?'TRIGGER':'EVENT',column=prefix+'_NAME',schema=prefix+'_SCHEMA';
 let where=binary(schema)+'='+binary('?');const params:string[]=[database];
 if(table==='TABLES')where+=" AND TABLE_TYPE='"+(kind==='table'?'BASE TABLE':'VIEW')+"'";
 if(table==='ROUTINES')where+=" AND ROUTINE_TYPE='"+kind.toUpperCase()+"'";
 if(after!==undefined){where+=' AND '+binary(column)+'>'+binary('?');params.push(after);}
 return{sql:'SELECT '+column+' AS object_name FROM information_schema.'+table+' WHERE '+where+' ORDER BY '+binary(column)+' LIMIT 2',params};
}

/** SHOW CREATE返回NULL代表不可搜索；未知、缺失或超限定义绝不当作无命中。 */
export function definitionText(kind:DefinitionSearchKind,rows:Record<string,unknown>[]){
 if(!Object.hasOwn(showTypes,kind))throw Error('不支持的定义对象类别');const source=rows.length===1?rows[0][showTypes[kind].column]:undefined;
 if(typeof source!=='string'||source.length===0)throw Error('服务器未返回完整定义，请检查当前账号的SHOW CREATE权限');
 if(Buffer.byteLength(source)>structureSearchLimits.definitionBytes)throw Error('完整定义超过2MiB，未把截断内容当作无命中');return source;
}

/** 同一服务器匹配完整SHOW CREATE原文，普通文字转义及正则语义与名称/数据搜索保持一致。 */
export function definitionMatchQuery(source:string,pattern:StructureSearchInput['pattern']){
 if(typeof source!=='string'||Buffer.byteLength(source)>structureSearchLimits.definitionBytes)throw Error('定义匹配超过2MiB预算');
 const match=databaseSearchMatch({column:'definition_text',qualifier:'search_definition'},pattern);
 // 同一次服务器匹配返回实际LOWER结果，位置映射不借用JavaScript的大小写规则；不把全文追加到回包。
 const folded=!pattern.caseSensitive&&pattern.mode!=='regexp';
 return{sql:'SELECT CHAR_LENGTH(definition_text) AS characters'+(folded?', LOWER(definition_text) AS navigationText, LOWER(navigation_pattern) AS navigationNeedle':'')+' FROM (SELECT CONVERT(? USING utf8mb4) AS definition_text'+(folded?', CONVERT(? USING utf8mb4) AS navigation_pattern':'')+') AS search_definition WHERE '+match.sql,params:[source,...(folded?[pattern.text]:[]),...match.params]};
}

/** 每页最多检查十个定义，页间只保留二进制名称位置，不持有连接或完整定义正文。 */
export async function readDefinitionSearchPage(state:DefinitionSearchState,managed:ManagedConnection,control:Control):Promise<StructureSearchPage>{
 const input=state.input,page:StructureSearchPage={hits:[],failures:[],totalHits:state.total,completedScopes:state.scope,scopeCount:input.databases.length*input.kinds.length,limitReached:false,stoppedOnError:false,scannedDefinitions:state.scannedDefinitions??0};
 const read=async(sql:string,params:(string|number)[]=[])=>{const result=await completionQuery<Record<string,unknown>[]>(managed,control,sql,params);control.checkCancelled();return result.rows;};
 // 只规范此独立读取会话，避免NO_TABLE_OPTIONS等使可搜索的定义被静默省略。
 const facts=(await read('SELECT @@SESSION.sql_mode AS mode'))[0];if(typeof facts?.mode!=='string'||!/^[A-Z0-9_,]*$/i.test(facts.mode))throw Error('无法确认定义读取会话的SQL模式');
 const omitted=new Set<string>(definitionOmittingSqlModes),mode=facts.mode.split(',').filter(value=>!omitted.has(value.toUpperCase())).join(',');if(mode!==facts.mode)await read('SET SESSION sql_mode = ?',[mode]);await read('SET SESSION sql_quote_show_create = 1');
 let enumerations=0,objects=0;
 while(state.scope<page.scopeCount&&state.total<input.maxResults&&objects<structureSearchLimits.definitionPageObjects&&enumerations<structureSearchLimits.pageQueries){
  control.checkCancelled();const database=input.databases[Math.floor(state.scope/input.kinds.length)],kind=input.kinds[state.scope%input.kinds.length] as DefinitionSearchKind;
  let object:string|undefined,hasMore=false;
  try{
   const candidate=definitionCandidateQuery(kind,database,state.after?.object);enumerations++;const rows=await read(candidate.sql,candidate.params);
   if(rows.length>2)throw Error('定义目录超过单对象枚举预算');if(rows.length===0){state.scope++;delete state.after;continue;}
   object=searchIdentifier.parse(rows[0].object_name);hasMore=rows.length>1;state.after={object,name:object};objects++;state.scannedDefinitions=(state.scannedDefinitions??0)+1;
   const spec=showTypes[kind],source=definitionText(kind,await read('SHOW CREATE '+spec.type+' '+qualified(database,object))),query=definitionMatchQuery(source,input.pattern),matched=await read(query.sql,query.params);
   if(matched.length>1)throw Error('定义匹配返回了多条状态');if(matched.length){const characters=Number(matched[0].characters);if(!Number.isSafeInteger(characters)||characters<1||characters>structureSearchLimits.definitionBytes)throw Error('定义长度信息无效');page.hits.push({database,kind,object,name:object,parentKind:kind,matchedIn:'definition',definitionCharacters:characters,definitionNavigation:definitionNavigationResult(source,input.pattern,matched[0])});state.total++;}
   if(!hasMore){state.scope++;delete state.after;}
  }catch(error){
   control.checkCancelled();if(managed.broken)throw error;page.failures.push({database,kind,...(object?{object}:{}),message:(error instanceof Error?error.message:String(error)).slice(0,1024)});
   // 对象失败只跳过该对象；目录失败才跳过该类别，不能隐去后续同类定义。
   if(!object||!hasMore){state.scope++;delete state.after;}
   if(input.onError==='stop'){page.stoppedOnError=true;break;}
  }
 }
 control.checkCancelled();page.totalHits=state.total;page.completedScopes=state.scope;page.scannedDefinitions=state.scannedDefinitions??0;page.limitReached=!page.stoppedOnError&&state.total>=input.maxResults&&state.scope<page.scopeCount;
 if(Buffer.byteLength(JSON.stringify(page))>structureSearchLimits.pageBytes)throw Error('定义搜索批次超过128KiB');return page;
}
