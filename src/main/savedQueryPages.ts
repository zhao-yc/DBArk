import{randomUUID,createHash}from'node:crypto';
import{savedQueryPageLimits as limits,savedQueryPageInputSchema,savedQueryPageNextSchema,savedQueryPageReleaseSchema,savedQueryDeleteCheckedSchema,type SavedQueryPageInput,type SavedQueryPage,type SavedQueryPagePosition}from'../shared/savedQueryPages';
import{SavedQueryMatcher}from'./savedQueryMatcher';
import{SavedQuerySearchCancelled}from'./savedQuerySearch';

interface PageStore{querySearchRevision():string;queryPageNext(after?:SavedQueryPagePosition):{id:string;updatedAt:string;raw:string|null;hasMore:boolean}|null;querySearchRaw(id:string):string|undefined;deleteQuery(id:string):void}
interface State{input:SavedQueryPageInput;revision:string;after?:SavedQueryPagePosition;scanned:number;matched:number;failed:number}
interface Job{cancelled:boolean;matcher?:SavedQueryMatcher;done:Promise<void>;finish():void}

/** 高频列表不写任务历史；编号、取消及退出仍绑定实际工作线程。 */
export class SavedQueryPages{
 private cursors=new Map<string,{state:State;expires:number}>();private jobs=new Map<string,Job>();private recent=new Map<string,number>();private closing=false;
 constructor(private readonly store:PageStore,private readonly workerPath:string){}
 /** 到期的句柄和已结束任务编号仅有界保留，不保存正文或凭据。 */
 private prune(){const now=Date.now();for(const[id,value]of this.cursors)if(value.expires<=now)this.cursors.delete(id);for(const[id,expires]of this.recent)if(expires<=now&&!this.jobs.has(id))this.recent.delete(id);}
 /** 任一等待点后重核修订和取消，旧页不能关联到后来保存的新内容。 */
 private check(job:Job,state:State){if(job.cancelled||this.closing)throw new SavedQuerySearchCancelled('保存查询列表读取已取消');if(state.revision!==this.store.querySearchRevision())throw Error('保存查询或连接库已变化，请刷新列表');}
 /** 初次打开或明确搜索从最新记录开始，不在每次按键时启动遍历。 */
 start(raw:unknown){const input=savedQueryPageInputSchema.parse(raw);return this.run({input,revision:this.store.querySearchRevision(),scanned:0,matched:0,failed:0},input.taskId);}
 /** 单次句柄固定原筛选与排序位置，不能把新筛选混入旧页面。 */
 next(raw:unknown){const input=savedQueryPageNextSchema.parse(raw);this.prune();const cursor=this.cursors.get(input.cursor);if(!cursor)throw Error('查询列表已过期或已翻页，请刷新');this.cursors.delete(input.cursor);return this.run(cursor.state,input.taskId);}
 /** 仅释放指定面板的续页；页间本来就没有活动线程。 */
 release(raw:unknown){this.cursors.delete(savedQueryPageReleaseSchema.parse(raw).cursor);}
 /** 最近的本地请求取消不能误发到数据库工具进程。 */
 owns(taskId:string){this.prune();return this.jobs.has(taskId)||this.recent.has(taskId);}
 /** 返回前等待真实terminate及整页finally，不能仅设置取消布尔值。 */
 async cancel(taskId:string){const job=this.jobs.get(taskId);if(!job)return;job.cancelled=true;await job.matcher?.close();await job.done;}
 /** 退出禁止新页，释放所有续页并等实际活动页结束。 */
 async close(){this.closing=true;this.cursors.clear();await Promise.all([...this.jobs.keys()].map(id=>this.cancel(id)));}
 /** 删除针对所见原文；陈旧预览不能删除后来覆盖保存的新查询。 */
 deleteChecked(raw:unknown){const input=savedQueryDeleteCheckedSchema.parse(raw),source=this.store.querySearchRaw(input.id);if(source===undefined)throw Error('保存查询已删除，请刷新列表');if(createHash('sha256').update(source).digest('hex')!==input.digest)throw Error('保存查询已修改，未删除新内容，请刷新列表');this.store.deleteQuery(input.id);}
 /** 二元键位置分页，每批最多25条，正文解析与完整文字筛选都在线程内进行。 */
 private async run(state:State,taskId:string):Promise<SavedQueryPage>{
  this.prune();if(this.closing)throw Error('客户端正在退出，不能读取查询列表');if(this.owns(taskId))throw Error('列表请求编号已使用');if(this.jobs.size>=limits.active||this.jobs.size+this.cursors.size>=limits.cursors)throw Error('查询列表读取已达上限，请关闭旧面板');
  let finish!:()=>void;const job:Job={cancelled:false,done:new Promise(resolve=>{finish=resolve;}),finish:()=>finish()};this.jobs.set(taskId,job);this.recent.set(taskId,Date.now()+limits.cursorMs);while(this.recent.size>limits.recentTasks){const id=[...this.recent.keys()].find(key=>!this.jobs.has(key));if(id===undefined)break;this.recent.delete(id);}
  const page:SavedQueryPage={items:[],failures:[],scanned:state.scanned,matched:state.matched,failed:state.failed,stoppedOnError:false};let more=false;
  try{
   await new Promise<void>(resolve=>setImmediate(resolve));this.check(job,state);
   for(let count=0;count<limits.records;count++){
    this.check(job,state);const record=this.store.queryPageNext(state.after);if(!record){more=false;break;}if(record.id.length>200||record.updatedAt.length>256)throw Error('查询列表索引结构无效，请修复本地配置后重试');
    let item;try{if(record.raw===null)throw Error('保存查询记录超过128MiB，未读取截断概要');if(!job.matcher||job.matcher.closed){await job.matcher?.close();this.check(job,state);job.matcher=new SavedQueryMatcher(this.workerPath);}item=await job.matcher.summarize(record.id,record.raw,state.input.search);this.check(job,state);if(item&&item.query.updatedAt!==record.updatedAt)throw Error('保存查询更新时间与索引不一致');}
    catch(error){this.check(job,state);await job.matcher?.close();page.failures.push({id:record.id,message:(error instanceof Error?error.message:'查询概要读取失败').slice(0,1024)});state.after={id:record.id,updatedAt:record.updatedAt};state.scanned++;state.failed++;more=record.hasMore;if(state.input.onError==='stop'){page.stoppedOnError=true;break;}if(!more)break;if(Buffer.byteLength(JSON.stringify(page))+8192>limits.bytes)break;continue;}
    if(item&&Buffer.byteLength(JSON.stringify({...page,items:[...page.items,item]}))+8192>limits.bytes){if(!page.items.length)throw Error('单条查询概要超过128KiB');more=true;break;}
    state.after={id:record.id,updatedAt:record.updatedAt};state.scanned++;more=record.hasMore;if(item){page.items.push(item);state.matched++;}if(!more)break;await new Promise<void>(resolve=>setImmediate(resolve));
   }
   this.check(job,state);
  }finally{try{await job.matcher?.close();}finally{this.jobs.delete(taskId);job.finish();}}
  this.check(job,state);page.scanned=state.scanned;page.matched=state.matched;page.failed=state.failed;
  if(more&&!page.stoppedOnError){const cursor=randomUUID(),expires=Date.now()+limits.cursorMs;page.cursor=cursor;page.expiresAt=new Date(expires).toISOString();if(Buffer.byteLength(JSON.stringify(page))>limits.bytes)throw Error('查询概要页超过128KiB');this.cursors.set(cursor,{state,expires});}
  if(Buffer.byteLength(JSON.stringify(page))>limits.bytes)throw Error('查询概要页超过128KiB');return page;
 }
}
