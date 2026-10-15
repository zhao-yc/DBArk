import type {CompletionAnalysis} from '../shared/completionAnalysis';
import type {CompletionLexicalMode} from '../shared/completionLexical';
import {completionLimits} from '../shared/sqlCompletion';

type WorkerPort=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'|'onmessageerror'>;
type Phase='starting'|'analyzing';
interface Request{id:number;source:string;offset:number;mode:CompletionLexicalMode}
interface Pending{id:number;phase:Phase;request?:Request;resolve:(value:CompletionAnalysis)=>void;timer:ReturnType<typeof setTimeout>;detach:()=>void}
/** 本地模块启动与用户文本解析分别限时，等待就绪时不向线程传递SQL。 */
export class CompletionWorkerClient{
  private worker?:WorkerPort;private pending?:Pending;private serial=0;private disposed=false;private ready=false;
  constructor(private readonly createWorker:()=>WorkerPort,private readonly timeoutMs=2000,private readonly startupTimeoutMs=8000){}
  /** 绑定不可变快照；替换、取消、超时和卸载仍终止整个旧线程。 */
  analyze(source:string,offset:number,mode:CompletionLexicalMode={},signal?:AbortSignal):Promise<CompletionAnalysis>{
    if(this.disposed)return Promise.resolve({status:'blocked',reason:'disposed'});
    if(signal?.aborted)return Promise.resolve({status:'blocked',reason:'cancelled'});
    if(source.length>completionLimits.sourceUnits)return Promise.resolve({status:'blocked',reason:'budget'});
    if(this.pending)this.reset('replaced');
    return new Promise(resolve=>{
      const id=++this.serial,abort=()=>this.reset('cancelled'),phase=this.ready?'analyzing':'starting';
      this.pending={id,phase,request:{id,source,offset,mode:{ansiQuotes:mode.ansiQuotes,noBackslashEscapes:mode.noBackslashEscapes}},resolve,timer:this.deadline(id,phase),detach:()=>signal?.removeEventListener('abort',abort)};
      signal?.addEventListener('abort',abort,{once:true});
      try{
        if(!this.worker){
          const worker=this.createWorker();this.worker=worker;
          worker.onmessage=event=>{
            if(worker!==this.worker)return;
            if(event.data?.type==='dbark-completion-ready'){
              if(event.data.version!==1){this.reset('worker');return;}
              if(!this.ready){this.ready=true;this.send();}return;
            }
            if(!this.pending||event.data?.id!==this.pending.id)return;
            if(!this.ready||this.pending.phase!=='analyzing'){this.reset('worker');return;}
            const value=event.data.result as CompletionAnalysis|undefined;
            if(value?.status==='ready'||value?.status==='blocked')this.finish(value);else this.reset('worker');
          };
          worker.onerror=event=>{event.preventDefault();if(worker===this.worker)this.reset('worker');};
          worker.onmessageerror=()=>{if(worker===this.worker)this.reset('worker');};
        }
        if(this.ready)this.send();
      }catch{this.reset('worker');}
    });
  }
  /** 期限绑定请求及阶段；迟到的旧计时回调不能提前结束新请求或解析阶段。 */
  private deadline(id:number,phase:Phase):ReturnType<typeof setTimeout>{
    return setTimeout(()=>{if(this.pending?.id===id&&this.pending.phase===phase)this.reset(phase==='starting'?'startup-timeout':'timeout');},phase==='starting'?this.startupTimeoutMs:this.timeoutMs);
  }
  /** 仅首次有效就绪消息可交付待发快照，清除本地正文后开始独立解析期限。 */
  private send():void{
    const pending=this.pending,worker=this.worker;if(!pending?.request||!worker||!this.ready)return;
    const request=pending.request;pending.request=undefined;pending.phase='analyzing';clearTimeout(pending.timer);pending.timer=this.deadline(pending.id,'analyzing');
    try{worker.postMessage(request);}catch{this.reset('worker');}
  }
  /** 完成即移除正文引用、取消监听和计时器，空闲已就绪线程可继续复用。 */
  private finish(value:CompletionAnalysis):void{const pending=this.pending;if(!pending)return;this.pending=undefined;pending.request=undefined;clearTimeout(pending.timer);pending.detach();pending.resolve(value);}
  /** 先撤销旧回调和就绪标识，再终止旧线程，迟到消息不能交付给新模型。 */
  private reset(reason:string):void{const worker=this.worker;this.worker=undefined;this.ready=false;if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}this.finish({status:'blocked',reason});}
  /** 编辑器销毁后不再接受请求，启动中的待发快照也立即释放。 */
  dispose():void{this.disposed=true;this.reset('disposed');}
}
