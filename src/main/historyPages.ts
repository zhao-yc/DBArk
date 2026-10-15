import{createHash}from'node:crypto';
import{historyPageInputSchema,historyReadSchema,historyErrorReadSchema,type HistoryPageInput,type HistoryPageEntry,type HistoryPagePosition,type HistoryOpenResult}from'../shared/historyPages';
import{LocalSqlPages}from'./localSqlPages';
import{parseHistoryRecord}from'./historyPageMatch';

interface HistoryStore{historyPageRevision():string;historyPageNext(after:HistoryPagePosition|undefined,input:HistoryPageInput):{id:string;startedAt:string;connectionId:string;raw:string|null;hasMore:boolean}|null;historyRaw(id:string):string|undefined;queryConnectionExists(id:string):boolean}

/** 执行历史与查询列表拥有独立页句柄；只读操作不写任务/历史或建立数据库连接。 */
export class HistoryPages extends LocalSqlPages<HistoryPageInput,HistoryPageEntry,HistoryPagePosition>{
 constructor(private readonly store:HistoryStore,workerPath:string){super({
  label:'执行历史',parse:raw=>historyPageInputSchema.parse(raw),revision:()=>store.historyPageRevision(),
  next:(after,input)=>{const record=store.historyPageNext(after,input);return record?{...record,orderValue:record.startedAt,position:{id:record.id,startedAt:record.startedAt,connectionId:record.connectionId}}:null;},
  match:(matcher,record,input)=>matcher.summarizeHistory(record.id,record.raw!,input,record.position)
 },workerPath);}
 /** 完整内容仅在明确打开时读取，并对所见摘要重核，不能替换成后来的历史。 */
 private current(id:string,digest:string){const raw=this.store.historyRaw(id);if(raw===undefined)throw Error('执行历史已被保留上限移除，请刷新列表');if(createHash('sha256').update(raw).digest('hex')!==digest)throw Error('执行历史已变化，请刷新列表后打开');return parseHistoryRecord(id,raw);}
 /** 原连接缺失需显式选替代连接；替代后默认库变为未知，且只创建新草稿。 */
 read(raw:unknown):HistoryOpenResult{const input=historyReadSchema.parse(raw),record=this.current(input.id,input.digest);if(!this.store.queryConnectionExists(input.connectionId))throw Error('所选连接不存在，请明确选择有效连接');const{error,...entry}=record,contextChanged=entry.connectionId!==input.connectionId;return{entry,connectionId:input.connectionId,...(contextChanged?{databaseContext:{state:'unknown' as const}}:{database:entry.databaseContext?entry.databaseContext.state==='known'?entry.databaseContext.database??undefined:undefined:entry.database,databaseContext:entry.databaseContext}),contextChanged};}
 /** 错误全文按单条显式读取，概要列表不传完整错误或SQL。 */
 readError(raw:unknown):{error:string}{const input=historyErrorReadSchema.parse(raw),record=this.current(input.id,input.digest);return{error:record.error??''};}
}
