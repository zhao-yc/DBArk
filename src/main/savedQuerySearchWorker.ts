import type{SavedQueryScope}from'../shared/savedQuerySearch';
import { databaseSearchPatternSchema } from '../shared/databaseSearchPattern';
import{parentPort}from'node:worker_threads';
import{compileSavedQueryPattern,matchSavedQueryRecord,summarizeSavedQueryRecord}from'./savedQuerySearchMatch';
import{summarizeHistoryRecord}from'./historyPageMatch';
import type{HistoryPageInput,HistoryPagePosition}from'../shared/historyPages';
import { definitionNavigationLimits } from '../shared/definitionNavigation';
import type { SqliteStructureMatch } from './savedQueryMatcher';
let compiled:ReturnType<typeof compileSavedQueryPattern>|undefined;

/** 名称只判断命中；定义在同一次有时限的匹配中收集非空位置，按 Unicode 码点跨过零宽。 */
function matchSqliteStructure(source: string, raw: unknown, locate: boolean): SqliteStructureMatch {
 const pattern = databaseSearchPatternSchema.parse(raw);
 if (pattern.mode !== 'regexp' || source.length > definitionNavigationLimits.sourceBytes) throw Error('SQLite正则匹配输入超出预算');
 let regex: RegExp;
 try { regex = new RegExp(pattern.text, (pattern.caseSensitive ? 'u' : 'iu') + (locate ? 'g' : '')); }
 catch { throw Error('SQLite本地Unicode正则无效'); }
 if (!locate) return { matched: regex.test(source) };
 const ranges: { offset: number; length: number }[] = [];
 let matched = false, limitReached = false;
 for (let hit = regex.exec(source); hit; hit = regex.exec(source)) {
  matched = true;
  const length = hit[0].length;
  if (length) {
   if (ranges.length === definitionNavigationLimits.matches) { limitReached = true; break; }
   ranges.push({ offset: hit.index, length });
  } else {
   if (hit.index === source.length) break;
   regex.lastIndex = hit.index + ((source.codePointAt(hit.index) ?? 0) > 0xffff ? 2 : 1);
  }
 }
 return { matched, positions: { ranges, limitReached } };
}

/** 单线程只接收初始化、单条匹配或概要，复杂计算可由主进程终止，不接触连接凭据与文件。 */
parentPort!.on('message',(message:{kind:'initialize';input:unknown}|{kind:'record';id:string;raw:string}|{kind:'summary';id:string;raw:string;search:string;scope?:SavedQueryScope}|{kind:'sqliteStructureMatch';source:string;pattern:unknown;locate:boolean}|{kind:'historySummary';id:string;raw:string;input:HistoryPageInput;position:HistoryPagePosition})=>{try{if(message.kind==='initialize'){compiled=compileSavedQueryPattern(message.input as never);parentPort!.postMessage({ok:true});}else if(message.kind==='sqliteStructureMatch'){
 parentPort!.postMessage({ok:true,sqliteStructure:matchSqliteStructure(message.source,message.pattern,message.locate)});
 }else if(message.kind==='summary'){parentPort!.postMessage({ok:true,summary:summarizeSavedQueryRecord(message.id,message.raw,message.search,message.scope)});}else if(message.kind==='historySummary'){parentPort!.postMessage({ok:true,summary:summarizeHistoryRecord(message.id,message.raw,message.input,message.position)});}else{if(!compiled)throw Error('本地匹配器尚未初始化');parentPort!.postMessage({ok:true,hit:matchSavedQueryRecord(message.id,message.raw,compiled)});}}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:'本地匹配失败'});}});
