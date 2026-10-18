import { randomUUID } from 'node:crypto';
import { queryInsertLimits, type QueryInsertPending, type QueryInsertSample, type QueryInsertTarget } from '../shared/queryInsertExport';
import { queryInsertZh as text } from '../shared/queryInsertExport.zh-CN';
interface Pending {token:string;target:string;expires:number;resolve():void;reject(error:Error):void}
/** 等待确认仍属于原运行任务及会话；取消、TTL和关闭唤醒原链，不建立第二次执行。 */
export class QueryInsertConfirmations {
  private readonly entries=new Map<string,Pending>();
  /** 只在文件同步关闭后发布样例，样例来自同一逐行写入器，不读取旧工作台结果。 */
  async wait(taskId:string,sample:QueryInsertSample,target:QueryInsertTarget,encoding:QueryInsertPending['encoding'],bytes:number,publish:(value:QueryInsertPending)=>void):Promise<void>{
    if(this.entries.has(taskId)||this.entries.size>=queryInsertLimits.activeTasks)throw Error(text.stale);
    const token=randomUUID(),expires=Date.now()+queryInsertLimits.ttlMs;
    let resolve!:()=>void,reject!:(error:Error)=>void;
    const done=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    // 先注册拒绝处理，再调用可能同步抛错的发布端口。
    void done.catch(()=>undefined);
    const entry:Pending={token,target:`${target.database}.${target.table}`,expires,resolve,reject};this.entries.set(taskId,entry);
    const timer=setTimeout(()=>this.cancel(taskId),queryInsertLimits.ttlMs);timer.unref();
    try{publish({...sample,previewToken:token,target,encoding,bytes,expiresAt:new Date(expires).toISOString()});await done;}
    finally{clearTimeout(timer);if(this.entries.get(taskId)===entry)this.entries.delete(taskId);}
  }
  /** 无await同步消费准确令牌；不重连、不读取会话或再次执行查询。 */
  confirm(input:{taskId:string;previewToken:string;confirmation:string}):void{
    const entry=this.entries.get(input.taskId);
    if(!entry || entry.token!==input.previewToken || entry.target!==input.confirmation || entry.expires<=Date.now())throw Error(text.stale);
    this.entries.delete(input.taskId);entry.resolve();
  }
  /** 只拒绝该原任务；收尾仍由持有自有文件的原执行链负责。 */
  cancel(taskId:string):void{const entry=this.entries.get(taskId);if(entry){this.entries.delete(taskId);entry.reject(Error(text.stale));}}
}
