import type {CompletionAnalysisReady,CompletionRelation} from '../shared/completionAnalysis';
import {completionIdentifier,completionAliasIdentifier,quoteCompletionIdentifier as quote,quoteCompletionAlias} from '../shared/completionLexical';
import {completionLimits,type CompletionDirectoryRequest,type CompletionMetadataOutput} from '../shared/sqlCompletion';
import {completionZh as text} from './locales/completion.zh-CN';
export interface SqlCompletionItem{label:string;kind:'database'|'table'|'view'|'function'|'procedure'|'column'|'alias'|'keyword';insertText:string;detail:string;trigger?:boolean}
export interface SqlCompletionItems{items:SqlCompletionItem[];incomplete:boolean;unavailable:boolean;sessionUncertain?:boolean}
interface Directory{load:(query:CompletionDirectoryRequest,signal?:AbortSignal)=>Promise<CompletionMetadataOutput>}
/** 将有界语义目标转成惰性目录读取，不预取全库、前20张表或用户任意SQL。 */
export async function completionSuggestions(analysis:CompletionAnalysisReady,database:string|undefined,directory:Directory,signal?:AbortSignal,dialect?:'mysql'|'mariadb'):Promise<SqlCompletionItems>{
  if(signal?.aborted)return{items:[],incomplete:false,unavailable:false};
  // 窗口名称是本块本地符号；不混合字段、函数、输出别名或目录读取。
  if(analysis.windowNames!==undefined){const names=analysis.windowNames.filter(name=>completionIdentifier(name)&&name.toLowerCase().startsWith(analysis.target.prefix.toLowerCase()));return{items:names.slice(0,completionLimits.suggestions).map(name=>({label:name,kind:'alias' as const,insertText:quote(name),detail:text.namedWindow})),incomplete:analysis.incomplete||names.length>completionLimits.suggestions,unavailable:false};}
  const {target}=analysis,prefix=target.prefix,qualifiers=target.qualifiers,items:SqlCompletionItem[]=[],jobs:Promise<void>[]=[],keys=new Set<string>(),requests=new Map<string,Promise<CompletionMetadataOutput>>(),output=analysis.outputAliases,localColumns=new Set<string>(),starNames:string[]=[];let incomplete=analysis.incomplete,unavailable=false,sessionUncertain=false,reads=0,localComplete=true,starsComplete=true;
  const matches=(name:string)=>name.toLowerCase().startsWith(prefix.toLowerCase());
  /** 基线服务器按UTF-8字节截断输出名；离线或未确认方言时采用两种方言共同可引用的范围。 */
  function referenceable(name:string):boolean{if(!completionAliasIdentifier(name))return false;const valid=new TextEncoder().encode(name).length<=(dialect==='mysql'?256:255);if(!valid)incomplete=true;return valid;}
  /** 去重使用结构化文本键；达到建议上限明确标记更多，不虚构省略项。 */
  function add(item:SqlCompletionItem):void{if(!matches(item.label))return;const key=JSON.stringify([item.kind,item.insertText]);if(keys.has(key))return;keys.add(key);if(items.length>=completionLimits.suggestions){incomplete=true;return;}items.push(item);}
  /** 每个触发最多读取8个实际目录目标，显式别名可继续定位被省略的大JOIN来源。 */
  function read(query:CompletionDirectoryRequest,consume:(value:CompletionMetadataOutput)=>void,unknown?:()=>void):void{if(query.prefix.length>completionLimits.prefixUnits)return;const key=JSON.stringify(query);let request=requests.get(key);if(!request){if(reads++>=8){incomplete=true;unknown?.();return;}request=directory.load(query,signal);requests.set(key,request);}jobs.push(request.then(value=>{if(signal?.aborted)return;incomplete||=value.incomplete;if(value.incomplete)unknown?.();sessionUncertain||=value.sessionUncertain===true;consume(value);},error=>{if(signal?.aborted||error?.name==='AbortError')return;incomplete=true;unavailable=true;unknown?.();}));}
  /** 目录中的名称按单个标识符引用，既不运行建议也不注入Monaco片段语法。 */
  function objects(kind:'relation'|'function'|'procedure',schema:string):void{read({kind:'objects',database:schema,objectKind:kind,prefix},value=>value.entries.forEach(entry=>add({label:entry.name,kind:entry.kind as SqlCompletionItem['kind'],insertText:quote(entry.name),detail:entry.sessionObject==='temporary'?text.temporary:entry.sessionObject==='unconfirmed'?text.sessionUnconfirmed:text[entry.kind]})));}
  function databases():void{read({kind:'databases',prefix},value=>value.entries.forEach(entry=>add({label:entry.name,kind:'database',insertText:quote(entry.name)+(analysis.syntax.includes('relation')?'.':''),detail:text.database,trigger:analysis.syntax.includes('relation')})));}
  /** 未限定表达式优先插入别名.列；INSERT列清单保持不限定，符合其SQL语法。 */
  function columns(relation:CompletionRelation):void{
    const local=output?.localNames.includes(relation.name)??false;if(local&&relation.incomplete)localComplete=false;
    const detail=relation.name+(relation.source==='table'?' · '+text.column:relation.source==='cte'?' · '+text.cte:' · '+text.derived);
    const insert=(name:string)=>qualifiers.length||analysis.columnMode==='insert-list'?quoteCompletionAlias(name):quote(relation.name)+'.'+quoteCompletionAlias(name);
    for(const name of relation.columns)if(referenceable(name)){if(local)localColumns.add(name.toLowerCase());add({label:name,kind:'column',insertText:insert(name),detail});}
    for(const source of relation.catalogs){const schema=source.database??database;if(!schema){if(local)localComplete=false;continue;}read({kind:'columns',database:schema,table:source.table,prefix},value=>value.entries.filter(entry=>relation.source==='table'||entry.visible!==false).forEach(entry=>{if(local)localColumns.add(entry.name.toLowerCase());add({label:entry.name,kind:'column',insertText:insert(entry.name),detail:detail+(entry.sessionObject?' · '+text.temporary:'')+(entry.dataType?' · '+entry.dataType:'')});}),()=>{if(local)localComplete=false;});}
  }
  const selected=qualifiers.length===1?analysis.relations.filter(relation=>relation.name===qualifiers[0]):qualifiers.length===2?analysis.relations.filter(relation=>!relation.aliased&&relation.source==='table'&&relation.database===qualifiers[0]&&relation.table===qualifiers[1]):analysis.relations;
  if(analysis.syntax.includes('column')){
    for(const relation of selected)columns(relation);
    if(!qualifiers.length&&analysis.columnMode==='expression')for(const relation of analysis.relations)add({label:relation.name,kind:'alias',insertText:quote(relation.name)+'.',detail:relation.source==='cte'?text.cte:relation.source==='derived'?text.derived:text.alias,trigger:true});
  }
  if(output&&!qualifiers.length){if(analysis.relations.filter(relation=>output.localNames.includes(relation.name)).length<output.localCount)localComplete=false;
    for(const source of output.catalogs){const schema=source.database??database;if(!schema){starsComplete=false;incomplete=true;continue;}read({kind:'columns',database:schema,table:source.table,prefix},value=>{for(const entry of value.entries)if(entry.visible!==false)starNames.push(entry.name);},()=>{starsComplete=false;});}
  }
  if(analysis.syntax.includes('relation')){
    if(!qualifiers.length){for(const name of analysis.localRelations)add({label:name,kind:'table',insertText:quote(name),detail:text.cte});if(database)objects('relation',database);databases();}
    else if(qualifiers.length===1)objects('relation',qualifiers[0]);
  }
  if(analysis.syntax.includes('database')&&!analysis.syntax.includes('relation')&&!qualifiers.length)databases();
  for(const kind of ['function','procedure'] as const)if(analysis.syntax.includes(kind)&&qualifiers.length<2&&(!qualifiers.length||!selected.length)){const schema=qualifiers[0]??database;if(schema)objects(kind,schema);}
  // 对象与列优先使用预算；关键字不挤掉当前前缀匹配的元数据。
  await Promise.all(jobs);
  const aliasItems:SqlCompletionItem[]=[];
  if(output&&!qualifiers.length&&analysis.syntax.includes('column')){const counts=new Map<string,number>();for(const name of[...output.columns,...starNames])counts.set(name.toLowerCase(),(counts.get(name.toLowerCase())??0)+1);
    const candidates=output.union?[...output.columns,...starNames]:output.aliases;
    for(const name of candidates){if(!referenceable(name)||!matches(name))continue;const fold=name.toLowerCase();if(counts.get(fold)!==1||!starsComplete||output.clause!=='order'&&!output.union&&name.length<=completionLimits.prefixUnits&&(!localComplete||localColumns.has(fold))){incomplete=true;continue;}const item:SqlCompletionItem={label:name,kind:'column',insertText:quoteCompletionAlias(name),detail:output.union?text.outputColumn:text.outputAlias},key=JSON.stringify([item.kind,item.insertText]);if(keys.has(key))continue;keys.add(key);aliasItems.push(item);}
  }
  if(!signal?.aborted&&!qualifiers.length&&!target.quoted)for(const keyword of analysis.keywords)add({label:keyword,kind:'keyword',insertText:keyword,detail:text.keyword});
  if(signal?.aborted)return{items:[],incomplete:false,unavailable:false};
  const combined=output?.clause==='order'?[...aliasItems,...items]:[...items,...aliasItems];if(combined.length>completionLimits.suggestions)incomplete=true;
  return{items:combined.slice(0,completionLimits.suggestions),incomplete,unavailable,...(sessionUncertain?{sessionUncertain:true}:{})};
}
