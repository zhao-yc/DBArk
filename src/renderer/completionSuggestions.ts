import type {CompletionAnalysisReady,CompletionRelation} from '../shared/completionAnalysis';
import {completionIdentifier,quoteCompletionIdentifier as quote} from '../shared/completionLexical';
import {completionLimits,type CompletionDirectoryRequest,type CompletionMetadataOutput} from '../shared/sqlCompletion';
import {completionZh as text} from './locales/completion.zh-CN';
export interface SqlCompletionItem{label:string;kind:'database'|'table'|'view'|'function'|'procedure'|'column'|'alias'|'keyword';insertText:string;detail:string;trigger?:boolean}
export interface SqlCompletionItems{items:SqlCompletionItem[];incomplete:boolean;unavailable:boolean}
interface Directory{load:(query:CompletionDirectoryRequest,signal?:AbortSignal)=>Promise<CompletionMetadataOutput>}
/** 将有界语义目标转成惰性目录读取，不预取全库、前20张表或用户任意SQL。 */
export async function completionSuggestions(analysis:CompletionAnalysisReady,database:string|undefined,directory:Directory,signal?:AbortSignal):Promise<SqlCompletionItems>{
  if(signal?.aborted)return{items:[],incomplete:false,unavailable:false};
  const {target}=analysis,prefix=target.prefix,qualifiers=target.qualifiers,items:SqlCompletionItem[]=[],jobs:Promise<void>[]=[],keys=new Set<string>();let incomplete=analysis.incomplete,unavailable=false,reads=0;
  const matches=(name:string)=>name.toLowerCase().startsWith(prefix.toLowerCase());
  /** 去重使用结构化文本键；达到建议上限明确标记更多，不虚构省略项。 */
  function add(item:SqlCompletionItem):void{if(!matches(item.label))return;const key=JSON.stringify([item.kind,item.insertText]);if(keys.has(key))return;keys.add(key);if(items.length>=completionLimits.suggestions){incomplete=true;return;}items.push(item);}
  /** 每个触发最多读取8个实际目录目标，显式别名可继续定位被省略的大JOIN来源。 */
  function read(query:CompletionDirectoryRequest,consume:(value:CompletionMetadataOutput)=>void):void{if(reads++>=8){incomplete=true;return;}jobs.push(directory.load(query,signal).then(value=>{if(signal?.aborted)return;incomplete||=value.incomplete;consume(value);},error=>{if(signal?.aborted||error?.name==='AbortError')return;incomplete=true;unavailable=true;}));}
  /** 目录中的名称按单个标识符引用，既不运行建议也不注入Monaco片段语法。 */
  function objects(kind:'relation'|'function'|'procedure',schema:string):void{read({kind:'objects',database:schema,objectKind:kind,prefix},value=>value.entries.forEach(entry=>add({label:entry.name,kind:entry.kind as SqlCompletionItem['kind'],insertText:quote(entry.name),detail:text[entry.kind]})));}
  function databases():void{read({kind:'databases',prefix},value=>value.entries.forEach(entry=>add({label:entry.name,kind:'database',insertText:quote(entry.name)+(analysis.syntax.includes('relation')?'.':''),detail:text.database,trigger:analysis.syntax.includes('relation')})));}
  /** 未限定表达式优先插入别名.列；INSERT列清单保持不限定，符合其SQL语法。 */
  function columns(relation:CompletionRelation):void{
    const detail=relation.name+(relation.source==='table'?' · '+text.column:relation.source==='cte'?' · '+text.cte:' · '+text.derived);
    const insert=(name:string)=>qualifiers.length||analysis.columnMode==='insert-list'?quote(name):quote(relation.name)+'.'+quote(name);
    for(const name of relation.columns)if(completionIdentifier(name))add({label:name,kind:'column',insertText:insert(name),detail});
    for(const source of relation.catalogs){const schema=source.database??database;if(!schema)continue;read({kind:'columns',database:schema,table:source.table,prefix},value=>value.entries.forEach(entry=>add({label:entry.name,kind:'column',insertText:insert(entry.name),detail:detail+(entry.dataType?' · '+entry.dataType:'')})));}
  }
  const selected=qualifiers.length===1?analysis.relations.filter(relation=>relation.name===qualifiers[0]):qualifiers.length===2?analysis.relations.filter(relation=>!relation.aliased&&relation.source==='table'&&relation.database===qualifiers[0]&&relation.table===qualifiers[1]):analysis.relations;
  if(analysis.syntax.includes('column')){
    for(const relation of selected)columns(relation);
    if(!qualifiers.length&&analysis.columnMode==='expression')for(const relation of analysis.relations)add({label:relation.name,kind:'alias',insertText:quote(relation.name)+'.',detail:relation.source==='cte'?text.cte:relation.source==='derived'?text.derived:text.alias,trigger:true});
  }
  if(analysis.syntax.includes('relation')){
    if(!qualifiers.length){for(const name of analysis.localRelations)add({label:name,kind:'table',insertText:quote(name),detail:text.cte});if(database)objects('relation',database);databases();}
    else if(qualifiers.length===1)objects('relation',qualifiers[0]);
  }
  if(analysis.syntax.includes('database')&&!analysis.syntax.includes('relation')&&!qualifiers.length)databases();
  for(const kind of ['function','procedure'] as const)if(analysis.syntax.includes(kind)&&qualifiers.length<2&&(!qualifiers.length||!selected.length)){const schema=qualifiers[0]??database;if(schema)objects(kind,schema);}
  // 对象与列优先使用预算；关键字不挤掉当前前缀匹配的元数据。
  await Promise.all(jobs);
  if(!signal?.aborted&&!qualifiers.length&&!target.quoted)for(const keyword of analysis.keywords)add({label:keyword,kind:'keyword',insertText:keyword,detail:text.keyword});
  if(signal?.aborted)return{items:[],incomplete:false,unavailable:false};
  return{items,incomplete,unavailable};
}
