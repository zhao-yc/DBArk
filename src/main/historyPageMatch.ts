import{createHash}from'node:crypto';
import { historyTimeMatches } from '../shared/historyTimeRange';
import { historyDurationMatches } from '../shared/historyDurationRange';
import{historyPageInputSchema,historyRecordSchema,historyPageLimits,type HistoryPageInput,type HistoryPageEntry,type HistoryPagePosition}from'../shared/historyPages';
import{savedQuerySearchLimits}from'../shared/savedQuerySearch';

/** 损坏记录只给出有界字段路径，绝不回显JSON正文、SQL或运行时原始异常。 */
export function parseHistoryRecord(id:string,raw:string){
 if(Buffer.byteLength(raw)>savedQuerySearchLimits.recordBytes)throw Error('执行历史记录超过128MiB，未读取截断正文');
 let value:unknown;try{value=JSON.parse(raw);}catch{throw Error('执行历史记录JSON无效，未读取原文');}
 const parsed=historyRecordSchema.safeParse(value);if(!parsed.success)throw Error('执行历史记录结构无效：'+parsed.error.issues.slice(0,4).map(issue=>issue.path.join('.')||'记录').join('、'));
 if(parsed.data.id!==id)throw Error('执行历史标识与本地索引不一致');return parsed.data;
}
/** 从完整文本开头取有界预览，UTF16代理对不能被拆成损坏字符。 */
function preview(source:string,limit:number){let end=Math.min(source.length,limit);if(end<source.length&&/[\ud800-\udbff]/.test(source[end-1])&&/[\udc00-\udfff]/.test(source[end]))end--;return source.slice(0,end);}
/** 在线程内校验索引、筛选完整SQL/错误，再返回概要；不解析或执行SQL。 */
export function summarizeHistoryRecord(id:string,raw:string,request:HistoryPageInput,position:HistoryPagePosition):HistoryPageEntry|undefined{
 const input=historyPageInputSchema.parse(request),entry=parseHistoryRecord(id,raw);
 if(entry.startedAt!==position.startedAt||(entry.connectionId??'')!==position.connectionId)throw Error('执行历史来源或时间与索引不一致');
 // 时间校验先于正文/状态筛选；遗留无时区记录不能被悄悄认作范围内或直接跳过。
 const timeMatches=historyTimeMatches(entry.startedAt,input.timeRange);
 // 旧时间校验优先；负耗时即便被来源、状态、正文或时间范围排除也不能被隐藏为无命中。
 const durationMatches=historyDurationMatches(entry.elapsedMs,input.durationRange);if(!timeMatches||!durationMatches)return;
 if(input.scope.kind==='connection'&&entry.connectionId!==input.scope.connectionId||input.scope.kind==='unbound'&&!!entry.connectionId)return;
 if(input.status==='success'&&!entry.success||input.status==='failed'&&entry.success)return;
 const needle=input.search.toLowerCase();if(needle&&!input.fields.some(field=>(entry[field]??'').toLowerCase().includes(needle)))return;
 const{sql,error,...summary}=entry,sqlPreview=preview(sql,historyPageLimits.previewUnits),errorPreview=error===undefined||error===null?undefined:preview(error,historyPageLimits.errorPreviewUnits);
 return{entry:summary,digest:createHash('sha256').update(raw).digest('hex'),sqlPreview,sqlUnits:sql.length,previewTruncated:sqlPreview.length<sql.length,errorPreview,errorUnits:error?.length??0,errorTruncated:errorPreview!==undefined&&errorPreview.length<(error?.length??0)};
}
