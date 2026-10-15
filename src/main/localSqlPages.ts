import{randomUUID}from'node:crypto';
import{localSqlPageLimits as limits,localSqlPageNextSchema,localSqlPageReleaseSchema,type LocalSqlPage}from'../shared/localSqlPages';
import{SavedQueryMatcher}from'./savedQueryMatcher';
import{SavedQuerySearchCancelled}from'./savedQuerySearch';

export interface LocalPageRecord<Position>{id:string;orderValue:string;raw:string|null;position:Position;hasMore:boolean}
interface PageInput{taskId:string;onError:'stop'|'continue'}
export interface LocalPageSource<Input,Entry,Position>{
 label:string;parse(raw:unknown):Input;revision():string;
 next(after:Position|undefined,input:Input):LocalPageRecord<Position>|null;
 match(matcher:SavedQueryMatcher,record:LocalPageRecord<Position>,input:Input):Promise<Entry|undefined>;
 verify?(entry:Entry,record:LocalPageRecord<Position>):void;
}
interface State<Input,Position>{input:Input;revision:string;after?:Position;scanned:number;matched:number;failed:number}
interface Job{cancelled:boolean;matcher?:SavedQueryMatcher;done:Promise<void>;finish():void}

/** 共用真实线程、字节预算和取消实现；每个资料源仍独立拥有句柄与修订。 */
export class LocalSqlPages<Input extends PageInput,Entry,Position>{
 private cursors=new Map<string,{state:State<Input,Position>;expires:number}>();
 private jobs=new Map<string,Job>();private recent=new Map<string,number>();private closing=false;
 constructor(private readonly source:LocalPageSource<Input,Entry,Position>,private readonly workerPath:string){}
 /** 到期状态和最近请求仅有界保留，不保存正文、预览或活动线程。 */
 private prune(){const now=Date.now();for(const[id,value]of this.cursors)if(value.expires<=now)this.cursors.delete(id);for(const[id,expires]of this.recent)if(expires<=now&&!this.jobs.has(id))this.recent.delete(id);}
 /** 每次等待后核对取消和资料源修订，不能发布混合了新旧记录的一页。 */
 private check(job:Job,state:State<Input,Position>){if(job.cancelled||this.closing)throw new SavedQuerySearchCancelled(this.source.label+'列表读取已取消');if(state.revision!==this.source.revision())throw Error(this.source.label+'或连接库已变化，请刷新列表');}
 /** 初次请求由资料源严格校验，复制条件并从最新索引位置读取。 */
 start(raw:unknown){const input=this.source.parse(raw);return this.run({input,revision:this.source.revision(),scanned:0,matched:0,failed:0},input.taskId);}
 /** 消费一次句柄，后续编号不能篡改原筛选和位置。 */
 next(raw:unknown){const input=localSqlPageNextSchema.parse(raw);this.prune();const cursor=this.cursors.get(input.cursor);if(!cursor)throw Error(this.source.label+'列表已过期或已翻页，请刷新');this.cursors.delete(input.cursor);return this.run(cursor.state,input.taskId);}
 /** 幂等释放指定来源的句柄，不能释放另一资料源的游标。 */
 release(raw:unknown){this.cursors.delete(localSqlPageReleaseSchema.parse(raw).cursor);}
 /** 最近请求的迟到取消仍在本地处理，不落入数据库取消通道。 */
 owns(taskId:string){this.prune();return this.jobs.has(taskId)||this.recent.has(taskId);}
 /** 取消等待真实线程终止及整页finally结束。 */
 async cancel(taskId:string){const job=this.jobs.get(taskId);if(!job)return;job.cancelled=true;await job.matcher?.close();await job.done;}
 /** 退出拒绝新请求，释放所有续页并等待实际活动读取结束。 */
 async close(){this.closing=true;this.cursors.clear();await Promise.all([...this.jobs.keys()].map(id=>this.cancel(id)));}
 /** 一次最多25条并同时约束概要和失败明细，完整原文只交给固定线程。 */
 private async run(state:State<Input,Position>,taskId:string):Promise<LocalSqlPage<Entry>>{
  this.prune();if(this.closing)throw Error('客户端正在退出，不能读取'+this.source.label+'列表');if(this.owns(taskId))throw Error('列表请求编号已使用');if(this.jobs.size>=limits.active||this.jobs.size+this.cursors.size>=limits.cursors)throw Error(this.source.label+'列表读取已达上限，请关闭旧面板');
  let finish!:()=>void;const job:Job={cancelled:false,done:new Promise(resolve=>{finish=resolve;}),finish:()=>finish()};this.jobs.set(taskId,job);this.recent.set(taskId,Date.now()+limits.cursorMs);
  while(this.recent.size>limits.recentTasks){const id=[...this.recent.keys()].find(key=>!this.jobs.has(key));if(id===undefined)break;this.recent.delete(id);}
  const page:LocalSqlPage<Entry>={items:[],failures:[],scanned:state.scanned,matched:state.matched,failed:state.failed,stoppedOnError:false};let more=false;
  try{
   await new Promise<void>(resolve=>setImmediate(resolve));this.check(job,state);
   for(let count=0;count<limits.records;count++){
    this.check(job,state);const record=this.source.next(state.after,state.input);if(!record){more=false;break;}if(record.id.length>200||record.orderValue.length>256)throw Error(this.source.label+'列表索引结构无效，请修复本地配置后重试');
    let item:Entry|undefined;
    try{if(record.raw===null)throw Error(this.source.label+'记录超过128MiB，未读取截断概要');if(!job.matcher||job.matcher.closed){await job.matcher?.close();this.check(job,state);job.matcher=new SavedQueryMatcher(this.workerPath);}item=await this.source.match(job.matcher,record,state.input);this.check(job,state);if(item)this.source.verify?.(item,record);}
    catch(error){this.check(job,state);await job.matcher?.close();page.failures.push({id:record.id,message:(error instanceof Error?error.message:'本地概要读取失败').slice(0,1024)});state.after=record.position;state.scanned++;state.failed++;more=record.hasMore;if(state.input.onError==='stop'){page.stoppedOnError=true;break;}if(!more)break;if(Buffer.byteLength(JSON.stringify(page))+8192>limits.bytes)break;continue;}
    // 预留一条有界失败及最终计数、句柄，未消费的当前记录留给下一批。
    if(item&&Buffer.byteLength(JSON.stringify({...page,items:[...page.items,item]}))+8192>limits.bytes){if(!page.items.length)throw Error('单条本地概要超过128KiB');more=true;break;}
    state.after=record.position;state.scanned++;more=record.hasMore;if(item){page.items.push(item);state.matched++;}if(!more)break;await new Promise<void>(resolve=>setImmediate(resolve));
   }
   this.check(job,state);
  }finally{try{await job.matcher?.close();}finally{this.jobs.delete(taskId);job.finish();}}
  this.check(job,state);page.scanned=state.scanned;page.matched=state.matched;page.failed=state.failed;
  if(more&&!page.stoppedOnError){const cursor=randomUUID(),expires=Date.now()+limits.cursorMs;page.cursor=cursor;page.expiresAt=new Date(expires).toISOString();if(Buffer.byteLength(JSON.stringify(page))>limits.bytes)throw Error('本地概要页超过128KiB');this.cursors.set(cursor,{state,expires});}
  if(Buffer.byteLength(JSON.stringify(page))>limits.bytes)throw Error('本地概要页超过128KiB');return page;
 }
}
