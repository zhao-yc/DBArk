import{randomUUID,createHash}from'node:crypto';
import{savedQuerySearchInputSchema,savedQuerySearchNextSchema,savedQuerySearchReleaseSchema,savedQueryReadSchema,savedQuerySearchLimits as limits,type SavedQuerySearchInput,type SavedQuerySearchPage,type SavedQueryOpenResult}from'../shared/savedQuerySearch';
import type{TaskEvent}from'../shared/contracts';
import{SavedQueryMatcher}from'./savedQueryMatcher';
import{parseSavedQueryRecord}from'./savedQuerySearchMatch';

export interface SavedQuerySearchStore{querySearchRevision():string;querySearchNext(after?:string):{id:string;raw:string|null;hasMore:boolean}|null;querySearchRaw(id:string):string|undefined;queryConnectionExists(id:string):boolean}
interface State{input:SavedQuerySearchInput;revision:string;after?:string;scanned:number;total:number}
interface Job{cancelled:boolean;matcher?:SavedQueryMatcher;done:Promise<void>;finish():void}
export class SavedQuerySearchCancelled extends Error{}

/** 本地库逐条读取、匹配线程可取消；续页只有有界位置和条件，不保存SQL或连接。 */
export class SavedQuerySearches{
 private cursors=new Map<string,{state:State;expires:number}>();private jobs=new Map<string,Job>();private closing=false;
 constructor(private readonly store:SavedQuerySearchStore,private readonly workerPath:string,private readonly emit:(event:TaskEvent)=>void=()=>{},private readonly matchMs:number=limits.matchMs){}
 /** 到期或库修订变化后，旧命中和旧续页不得静默关联到新内容。 */
 private prune(){for(const[id,value]of this.cursors)if(value.expires<=Date.now())this.cursors.delete(id);}
 private check(job:Job,state:State){if(job.cancelled||this.closing)throw new SavedQuerySearchCancelled('本地保存查询搜索已取消');if(state.revision!==this.store.querySearchRevision())throw Error('保存查询或连接库已变化，请重新搜索');}
 /** 初次请求复制范围，编号在主进程全局任务表另行校验。 */
 start(raw:unknown){const input=savedQuerySearchInputSchema.parse(raw);return this.run({input,revision:this.store.querySearchRevision(),scanned:0,total:0},input.taskId);}
 /** 消费一次随机句柄，后续不能篡改原匹配或来源筛选。 */
 next(raw:unknown){const input=savedQuerySearchNextSchema.parse(raw);this.prune();const cursor=this.cursors.get(input.cursor);if(!cursor)throw Error('本地搜索已过期或已继续，请重新搜索');this.cursors.delete(input.cursor);return this.run(cursor.state,input.taskId);}
 /** 关闭只释放指定窗口的句柄，不清理其它搜索。 */
 release(raw:unknown){const input=savedQuerySearchReleaseSchema.parse(raw);this.cursors.delete(input.cursor);}
 /** 取消只作用于本地仍活动的任务，完成后不会让同编号落入数据库取消通道。 */
 has(taskId:string){return this.jobs.has(taskId);}
 async cancel(taskId:string){const job=this.jobs.get(taskId);if(!job)return;job.cancelled=true;await job.matcher?.close();await job.done;}
 /** 退出拒绝新任务，并等待所有正在计算的真实线程终止。 */
 async close(){this.closing=true;this.cursors.clear();await Promise.all([...this.jobs.keys()].map(id=>this.cancel(id)));}
 /** 原摘要再校验后才读取完整正文；替代连接必须明确提供，并变成默认库未知的新查询。 */
 read(raw:unknown):SavedQueryOpenResult{const input=savedQueryReadSchema.parse(raw),source=this.store.querySearchRaw(input.id);if(!source)throw Error('保存查询已删除，请重新搜索');if(createHash('sha256').update(source).digest('hex')!==input.digest)throw Error('保存查询已修改，请重新搜索后打开');if(!this.store.queryConnectionExists(input.connectionId))throw Error('所选连接不存在，请明确选择有效连接');const query=parseSavedQueryRecord(input.id,source),contextChanged=query.connectionId!==input.connectionId;if(query.id!==input.id)throw Error('保存查询标识与本地索引不一致');return{query,connectionId:input.connectionId,...(contextChanged?{databaseContext:{state:'unknown' as const}}:{database:query.databaseContext?query.databaseContext.state==='known'?query.databaseContext.database??undefined:undefined:query.database,databaseContext:query.databaseContext}),contextChanged};}
 /** 每页最多25条记录，发布前等待线程结束，失败/超时从不算作无命中。 */
 private async run(state:State,taskId:string):Promise<SavedQuerySearchPage>{
  this.prune();if(this.closing)throw Error('客户端正在退出，不能开始本地搜索');if(this.jobs.has(taskId))throw Error('本地搜索编号已使用');if(this.jobs.size>=limits.active||this.jobs.size+this.cursors.size>=limits.cursors)throw Error('本地搜索已达上限，请先关闭旧窗口');
  let finish!:()=>void;const job:Job={cancelled:false,done:new Promise(resolve=>{finish=resolve;}),finish:()=>finish()};this.jobs.set(taskId,job);
  const page:SavedQuerySearchPage={hits:[],failures:[],scanned:state.scanned,totalHits:state.total,limitReached:false,stoppedOnError:false};let more=false,consumed=0;
  const matcher=async()=>{if(!job.matcher||job.matcher.closed){await job.matcher?.close();this.check(job,state);job.matcher=new SavedQueryMatcher(this.workerPath,this.matchMs);await job.matcher.initialize(state.input);}return job.matcher;};
  try{
   await new Promise<void>(resolve=>setImmediate(resolve));this.check(job,state);await matcher();
   while(consumed<limits.pageQueries&&state.total<state.input.maxResults){
    this.check(job,state);const record=this.store.querySearchNext(state.after);if(!record){more=false;break;}
    let hit;try{if(record.raw===null)throw Error('保存查询记录超过128MiB，未把截断内容当作无命中');const current=await matcher();this.emit({taskId,status:'running',progress:0,message:'正在匹配本地记录；已检查 '+state.scanned+'，命中 '+state.total});hit=await current.match(record.id,record.raw);this.check(job,state);}
    catch(error){this.check(job,state);await job.matcher?.close();const failure={id:record.id,message:(error instanceof Error?error.message:'本地匹配失败').slice(0,1024)};page.failures.push(failure);state.after=record.id;state.scanned++;consumed++;more=record.hasMore;if(state.input.onError==='stop'){page.stoppedOnError=true;break;}if(!more)break;if(Buffer.byteLength(JSON.stringify(page))+8192>limits.pageBytes)break;continue;}
    // 预留累计数字及续页句柄的空间，不能在最后增加元数据后超过协议预算。
    if(hit&&Buffer.byteLength(JSON.stringify({...page,hits:[...page.hits,hit]}))+8192>limits.pageBytes){if(!page.hits.length)throw Error('单条保存查询摘要超过128KiB');more=true;break;}
    state.after=record.id;state.scanned++;consumed++;more=record.hasMore;if(hit){page.hits.push(hit);state.total++;}
    this.emit({taskId,status:'running',progress:0,message:'本地保存查询搜索进行中；已检查 '+state.scanned+'，命中 '+state.total});
    if(!more)break;await new Promise<void>(resolve=>setImmediate(resolve));
   }
   this.check(job,state);
  }finally{try{await job.matcher?.close();}finally{this.jobs.delete(taskId);job.finish();}}
  this.check(job,state);page.scanned=state.scanned;page.totalHits=state.total;page.limitReached=more&&state.total>=state.input.maxResults;
  if(more&&!page.limitReached&&!page.stoppedOnError){const cursor=randomUUID(),expires=Date.now()+limits.cursorMs;page.cursor=cursor;page.expiresAt=new Date(expires).toISOString();if(Buffer.byteLength(JSON.stringify(page))>limits.pageBytes)throw Error('保存查询搜索批次超过128KiB');this.cursors.set(cursor,{state,expires});}
  if(Buffer.byteLength(JSON.stringify(page))>limits.pageBytes)throw Error('保存查询搜索批次超过128KiB');return page;
 }
}
