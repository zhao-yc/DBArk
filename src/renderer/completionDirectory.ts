import {completionLimits,type CompletionDirectoryRequest,type CompletionMetadataInput,type CompletionMetadataOutput} from '../shared/sqlCompletion';
import {completionIdentifier} from '../shared/completionLexical';
import { copyCompletionColumnDetails } from '../shared/completionColumnDetails';
interface Waiter{resolve:(value:CompletionMetadataOutput)=>void;reject:(reason:Error)=>void;detach:()=>void}
interface Entry{key:string;query:CompletionDirectoryRequest;waiters:Set<Waiter>;taskId?:string;cancelled:boolean}
interface Transport{request:(input:CompletionMetadataInput)=>Promise<CompletionMetadataOutput>;cancel:(taskId:string)=>Promise<unknown>;id:()=>string}
const cancelled=()=>Object.assign(new Error('补全请求已取消'),{name:'AbortError'});
/** 连接版本属于实例身份；目录项以库、对象、类别和前缀的结构化键隔离。 */
export class CompletionDirectory{
  private cache=new Map<string,{value:CompletionMetadataOutput;bytes:number;expires:number}>();private bytes=0;
  private entries=new Map<string,Entry>();private queue:Entry[]=[];private active=0;private disposed=false;
  constructor(readonly connectionId:string,readonly connectionVersion:number,private readonly transport:Transport,private readonly ttlMs=15000){}
  /** 同键请求共享读取，消费者取消只影响自身；最后一名消费者离开才取消数据库任务。 */
  load(query:CompletionDirectoryRequest,signal?:AbortSignal):Promise<CompletionMetadataOutput>{
    if(this.disposed||signal?.aborted)return Promise.reject(cancelled());
    if(!this.validRequest(query))return Promise.reject(new Error('补全目录目标无效'));
    const key=JSON.stringify([query.kind,query.kind==='databases'?null:query.database,query.kind==='columns'?query.table:query.kind==='objects'?query.objectKind:null,query.prefix,query.kind==='columns'&&query.details===true]);
    const cached=this.cache.get(key);if(cached){this.cache.delete(key);this.bytes-=cached.bytes;if(cached.expires>Date.now()){this.cache.set(key,cached);this.bytes+=cached.bytes;return Promise.resolve(this.copy(cached.value));}}
    let entry=this.entries.get(key);
    if(!entry){if(this.entries.size>=16)return Promise.reject(new Error('补全目录排队已达上限'));entry={key,query:{...query},waiters:new Set(),cancelled:false};this.entries.set(key,entry);this.queue.push(entry);}
    const pending=entry;
    const promise=new Promise<CompletionMetadataOutput>((resolve,reject)=>{
      const abort=()=>{pending.waiters.delete(waiter);waiter.detach();reject(cancelled());if(!pending.waiters.size)this.cancelEntry(pending);};
      const waiter:Waiter={resolve,reject,detach:()=>signal?.removeEventListener('abort',abort)};pending.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});
    });
    this.drain();return promise;
  }
  /** 异步读取仍占据并发槽直到引擎真实收尾，不能在取消后立即无限启动新连接。 */
  private drain():void{while(!this.disposed&&this.active<2&&this.queue.length){const entry=this.queue.shift()!;if(entry.cancelled)continue;this.active++;void this.run(entry);}}
  /** 只有仍有消费者的成功结果能进缓存；失败和迟到结果不会覆盖新键。 */
  private async run(entry:Entry):Promise<void>{
    try{entry.taskId=this.transport.id();const result=await this.transport.request({...entry.query,connectionId:this.connectionId,taskId:entry.taskId});this.validateOutput(entry.query,result);if(!entry.cancelled&&!this.disposed){this.put(entry.key,result);for(const waiter of entry.waiters){waiter.detach();waiter.resolve(this.copy(result));}}}
    catch(error){for(const waiter of entry.waiters){waiter.detach();waiter.reject(error instanceof Error?error:new Error('补全目录读取失败'));}}
    finally{entry.waiters.clear();if(this.entries.get(entry.key)===entry)this.entries.delete(entry.key);this.active--;this.drain();}
  }
  /** 已发送任务仅发一次取消，不尝试重放；队列任务直接撤销且不产生任务编号。 */
  private cancelEntry(entry:Entry):void{if(entry.cancelled)return;entry.cancelled=true;if(this.entries.get(entry.key)===entry)this.entries.delete(entry.key);this.queue=this.queue.filter(value=>value!==entry);if(entry.taskId)void this.transport.cancel(entry.taskId).catch(()=>{});}
  /** 操作完成、连接目标改变或卸载时撤销缓存与旧消费者，旧响应不再缓存。 */
  invalidate():void{this.cache.clear();this.bytes=0;for(const entry of this.entries.values()){for(const waiter of entry.waiters){waiter.detach();waiter.reject(cancelled());}entry.waiters.clear();this.cancelEntry(entry);}this.queue=[];}
  /** 生命周期结束后禁止再读；活动连接仍由引擎取消并等待实际终态。 */
  dispose():void{this.disposed=true;this.invalidate();}
  /** 预算同时覆盖字符串和每项估算开销，缓存不持久化到配置或磁盘。 */
  private put(key:string,value:CompletionMetadataOutput):void{
    const bytes=2*(key.length+JSON.stringify(value).length)+512+value.entries.length*128;if(bytes>completionLimits.cacheBytes)return;
    const old=this.cache.get(key);if(old){this.bytes-=old.bytes;this.cache.delete(key);}
    while(this.cache.size>=completionLimits.cacheEntries||this.bytes+bytes>completionLimits.cacheBytes){const oldest=this.cache.keys().next().value;if(oldest===undefined)break;this.bytes-=this.cache.get(oldest)!.bytes;this.cache.delete(oldest);}
    this.cache.set(key,{value:this.copy(value),bytes,expires:Date.now()+this.ttlMs});this.bytes+=bytes;
  }
  /** 接口异常不会污染后续前缀，目录字段仅接受当前请求对应的种类。 */
  private validateOutput(query:CompletionDirectoryRequest,value:CompletionMetadataOutput):void{
    const kinds=query.kind==='databases'?['database']:query.kind==='columns'?['column']:query.objectKind==='relation'?['table','view']:[query.objectKind];
    if(!value||!Array.isArray(value.entries)||value.entries.length>completionLimits.entries||typeof value.incomplete!=='boolean'||value.entries.some(entry=>!completionIdentifier(entry.name)||!kinds.includes(entry.kind)||entry.dataType!==undefined&&(typeof entry.dataType!=='string'||entry.dataType.length>64)))throw new Error('补全目录返回值无效');
    for (const entry of value.entries) {
      if (entry.visible !== undefined && typeof entry.visible !== 'boolean' || entry.sessionObject !== undefined && !['temporary','unconfirmed'].includes(entry.sessionObject)) throw Error('字段来源或可见性无效');
      if (entry.details !== undefined) copyCompletionColumnDetails(entry.details);
      if (query.kind === 'columns' && query.details && !entry.details) throw Error('字段完整属性尚未返回');
    }
  }
  /** 前缀允许空白/通配符等原名称字符，但不允许NUL、代理字符或无限长度。 */
  private validRequest(query:CompletionDirectoryRequest):boolean{return typeof query.prefix==='string'&&query.prefix.length<=completionLimits.prefixUnits&&!/[\0\ud800-\udfff]/.test(query.prefix)&&(query.kind!=='columns'||query.details===undefined||query.details===true)&&(query.kind==='databases'||completionIdentifier(query.database)&&(query.kind==='objects'||completionIdentifier(query.table)));}
  /** 返回独立普通记录，渲染组件不能修改缓存中的目录名称。 */
  private copy(value:CompletionMetadataOutput):CompletionMetadataOutput{return{entries:value.entries.map(entry=>({name:entry.name,kind:entry.kind,...(entry.dataType===undefined?{}:{dataType:entry.dataType}),...(entry.visible===undefined?{}:{visible:entry.visible}),...(entry.details===undefined?{}:{details:copyCompletionColumnDetails(entry.details)})})),incomplete:value.incomplete};}
}
