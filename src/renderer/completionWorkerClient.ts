import type {CompletionAnalysis} from '../shared/completionAnalysis';
import type {CompletionLexicalMode} from '../shared/completionLexical';
import {completionLimits} from '../shared/sqlCompletion';

type WorkerPort=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
interface Pending{id:number;resolve:(value:CompletionAnalysis)=>void;timer:ReturnType<typeof setTimeout>;detach:()=>void}
/** 一个编辑器最多一个分析任务；替换、取消和超时均终止旧线程，迟到消息不能写回新模型。 */
export class CompletionWorkerClient{
  private worker?:WorkerPort;private pending?:Pending;private serial=0;private disposed=false;
  constructor(private readonly createWorker:()=>WorkerPort,private readonly timeoutMs=2000){}
  /** 复用已空闲worker减少冷启动；活动解析无法合作取消，必须释放整个线程。 */
  analyze(source:string,offset:number,mode:CompletionLexicalMode={},signal?:AbortSignal):Promise<CompletionAnalysis>{
    if(this.disposed)return Promise.resolve({status:'blocked',reason:'disposed'});
    if(signal?.aborted)return Promise.resolve({status:'blocked',reason:'cancelled'});
    if(source.length>completionLimits.sourceUnits)return Promise.resolve({status:'blocked',reason:'budget'});
    if(this.pending)this.reset('replaced');
    return new Promise(resolve=>{
      const id=++this.serial,abort=()=>this.reset('cancelled');
      const timer=setTimeout(()=>this.reset('timeout'),this.timeoutMs);
      this.pending={id,resolve,timer,detach:()=>signal?.removeEventListener('abort',abort)};signal?.addEventListener('abort',abort,{once:true});
      try{
        if(!this.worker){
          const worker=this.createWorker();this.worker=worker;
          worker.onmessage=event=>{if(worker!==this.worker||!this.pending||event.data?.id!==this.pending.id)return;const value=event.data.result as CompletionAnalysis|undefined;if(value?.status==='ready'||value?.status==='blocked')this.finish(value);else this.reset('worker');};
          worker.onerror=event=>{event.preventDefault();if(worker===this.worker)this.reset('worker');};
          worker.onmessageerror=()=>{if(worker===this.worker)this.reset('worker');};
        }
        this.worker.postMessage({id,source,offset,mode});
      }catch{this.reset('worker');}
    });
  }
  /** 只交付一次结果，移除请求的取消监听和计时器；不保留用户SQL。 */
  private finish(value:CompletionAnalysis):void{const pending=this.pending;if(!pending)return;this.pending=undefined;clearTimeout(pending.timer);pending.detach();pending.resolve(value);}
  /** 终止旧实例并先解除回调，旧事件即使排队也无法交付。 */
  private reset(reason:string):void{const worker=this.worker;this.worker=undefined;if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}this.finish({status:'blocked',reason});}
  /** 编辑器卸载释放线程，之后不允许再启动后台解析。 */
  dispose():void{this.disposed=true;this.reset('disposed');}
}
