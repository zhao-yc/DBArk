import{Worker}from'node:worker_threads';
import{savedQuerySearchLimits as limits,type SavedQuerySearchHit,type SavedQuerySearchInput}from'../shared/savedQuerySearch';
import type{SavedQueryPageEntry}from'../shared/savedQueryPages';

/** 每页使用独立且有堆预算的真实线程；定时器超时后等待terminate实际完成再回复。 */
export class SavedQueryMatcher{
 private worker:Worker;private pending?:{resolve(value:any):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>};private closing?:Promise<void>;private ended=false;
 constructor(path:string,private readonly matchMs:number=limits.matchMs){this.worker=new Worker(path,{env:{},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});this.worker.on('message',(value:{ok:boolean;hit?:SavedQuerySearchHit;summary?:SavedQueryPageEntry;error?:string})=>{const pending=this.pending;if(!pending)return;clearTimeout(pending.timer);this.pending=undefined;value.ok?pending.resolve(value.summary??value.hit):pending.reject(Error(value.error??'本地匹配失败'));});this.worker.on('error',()=>this.fail(Error('本地匹配线程异常结束，当前查询未确认搜索')));this.worker.on('exit',()=>{this.ended=true;this.fail(Error('本地匹配线程已结束'));});}
 /** 每次至多一条请求，错误不携带原始SQL到任务历史。 */
 private request<T>(message:unknown,timeout:number):Promise<T>{if(this.ended||this.closing)throw Error('本地匹配线程已关闭');if(this.pending)throw Error('本地匹配线程仍在处理上一条记录');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{void this.close(Error('单条本地查询检索超时，已停止匹配线程，不能认定为无命中'));},timeout);this.pending={resolve,reject,timer};this.worker.postMessage(message);});}
 /** 在线程内编译，空查询库也能明确拒绝非法正则。 */
 async initialize(input:SavedQuerySearchInput){await this.request({kind:'initialize',input},limits.initializationMs);}
 /** 正则时间预算逐条生效；调用方可在失败后继续其它记录，不能重放此条。 */
 match(id:string,raw:string){return this.request<SavedQuerySearchHit|undefined>({kind:'record',id,raw},this.matchMs);}
 /** 列表概要不运行正则，不返回完整SQL，仍受线程时间和堆预算约束。 */
 summarize(id:string,raw:string,search:string){return this.request<SavedQueryPageEntry|undefined>({kind:'summary',id,raw,search},this.matchMs);}
 /** 仅拒绝当前请求，线程回收由close或原生exit负责。 */
 private fail(error:Error){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=undefined;}}
 /** 关闭幂等，不能只清除本地引用就认为后台计算已经结束。 */
 close(error=Error('本地匹配已取消')):Promise<void>{if(this.closing)return this.closing;this.fail(error);this.closing=(async()=>{if(!this.ended)await this.worker.terminate();this.ended=true;})();return this.closing;}
 /** 只读终态供任务决定是否需为下一条新记录建立新线程。 */
 get closed(){return this.ended||!!this.closing;}
 /** 原生线程编号用于诊断与资源验收，终止后Node返回-1，不包含查询内容。 */
 get threadId(){return this.worker.threadId;}
}
