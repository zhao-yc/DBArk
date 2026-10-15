import {Buffer} from 'node:buffer';
import {dataSearchInputSchema,dataSearchNextSchema,dataSearchReleaseSchema,dataSearchLimits,dataSearchBlocks,type DataSearchInput,type DataSearchNext,type DataSearchReply,type DataSearchProgress,type DataSearchHit,type DataSearchTargetMetadata} from '../shared/dataSearch';
import type {TaskEvent} from '../shared/contracts';
import type {ManagedConnection} from './connection';
import type {StructureTaskContext} from './structureDefinition';
import {readDataSearchTarget,buildDataSearchPlan,decodeDataSearchRow} from './dataSearchPlan';
import {consumeQueryFrames} from './queryStreamProtocol';

interface Deferred<T>{promise:Promise<T>;resolve(value:T):void;reject(error:Error):void}
/** 挂起只保留一个批次与一个等待者；注册后即接住拒绝，防止取消先于消费而产生未处理异常。 */
function deferred<T>():Deferred<T>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});void promise.catch(()=>{});return{promise,resolve,reject};}
export interface DataSearchTaskControl extends Pick<StructureTaskContext,'checkCancelled'|'commandStarted'>{managed:ManagedConnection;stop():Promise<void>}
export type DataSearchRun=(action:(control:DataSearchTaskControl)=>Promise<void>)=>Promise<void>;
interface Search{input:DataSearchInput;progress:DataSearchProgress;reply:Deferred<DataSearchReply>;ack?:Deferred<void>;ackTimer?:ReturnType<typeof setTimeout>;offer?:DataSearchReply;lastPull?:{sequence:number;promise:Promise<DataSearchReply>};done:Promise<void>;cancelled:boolean;terminal?:DataSearchReply&{kind:'terminal'};status?:'completed'|'failed'|'cancelled';error?:string;expires?:number;}
class SearchLimit extends Error{}
/** 确认期限已失去客户端，不能再发布另一个需要确认的错误批次。 */
class SearchAcknowledgementError extends Error{}

/** 数据搜索后台执行、按需拉取；不通过无确认的任务事件发送单元格，重试同一ACK也不推进第二批。 */
export class DataSearchTasks{
  private readonly searches=new Map<string,Search>();
  /** 超时是内部生命周期选项，不接受渲染进程覆盖；测试可用短期限验证真实资源收尾。 */
  constructor(private readonly emit:(event:TaskEvent)=>void,private readonly acknowledgementMs:number=dataSearchLimits.acknowledgementMs){if(!Number.isInteger(acknowledgementMs)||acknowledgementMs<1||acknowledgementMs>60000)throw Error('搜索确认期限无效');}
  /** 终态只保留短期幂等回复，不保留连接；关闭窗口应主动释放。 */
  private prune(){for(const [id,state]of this.searches)if(state.expires!==undefined&&state.expires<=Date.now())this.searches.delete(id);}
  /** 权属在任何确认、释放或取消动作之前检查。 */
  private owner(input:{connectionId:string;taskId:string}){const state=this.searches.get(input.taskId);if(!state)throw Error('数据搜索不存在或已过期');if(state.input.connectionId!==input.connectionId)throw Error('数据搜索不属于此连接');return state;}
  /** 查询生命周期由引擎决定，任务实际收尾后的状态覆盖动作内的预期。 */
  observe(taskId:string,status:'completed'|'failed'|'cancelled',message:string){const state=this.searches.get(taskId);if(state){state.status=status;if(status!=='completed')state.error=message;}}
  /** 进度只含计数；敏感搜索值、命中和错误不进入任务事件。 */
  detail(taskId:string){const state=this.searches.get(taskId);return state?{dataSearch:{...state.progress}}:{};}
  /** 用户取消先唤醒ACK与消费方，随后引擎KILL并等待原命令终态，避免暂停读流造成死锁。 */
  interrupt(taskId:string){const state=this.searches.get(taskId);if(!state||state.terminal)return;state.cancelled=true;state.ack?.reject(Error('数据搜索已取消'));}
  /** 释放之前调用者须完成引擎取消；未知旧句柄可安全清理，跨连接不能删除。 */
  async release(raw:unknown){const input=dataSearchReleaseSchema.parse(raw),state=this.searches.get(input.taskId);if(!state)return;this.owner(input);await state.done;this.searches.delete(input.taskId);}
  /** 供引擎在执行取消前核对归属，不触碰其它搜索。 */
  assertOwner(raw:unknown):boolean{const input=dataSearchReleaseSchema.parse(raw);if(!this.searches.has(input.taskId))return false;this.owner(input);return true;}
  /** 首批或终态回复只在对应阶段发布；异常回复必须等后台连接实际收尾。 */
  async start(raw:unknown,run:DataSearchRun):Promise<DataSearchReply>{
    const input=dataSearchInputSchema.parse(raw);this.prune();if(this.searches.has(input.taskId))throw Error('数据搜索编号已使用');
    if(this.searches.size>=dataSearchLimits.retained||[...this.searches.values()].filter(state=>!state.terminal).length>=dataSearchLimits.active)throw Error('数据搜索繁忙，请关闭旧搜索后重试');
    const state:Search={input,progress:{phase:'preparing',targetIndex:0,targets:input.targets.length,processedBlocks:0,blocks:input.targets.reduce((count,target)=>count+Math.ceil(target.columns.length/dataSearchLimits.projectionColumns),0),failedBlocks:0,hits:0,bytes:0,sequence:0,limitReached:false,peakBufferedRows:0,peakBufferedBytes:0},reply:deferred(),done:Promise.resolve(),cancelled:false};
    this.searches.set(input.taskId,state);
    state.done=(async()=>{let failure:unknown;try{await run(control=>this.scan(state,control));}catch(error){failure=error;}finally{clearTimeout(state.ackTimer);const status=state.status??(failure?(state.cancelled?'cancelled':'failed'):'completed');const terminal:DataSearchReply&{kind:'terminal'}={kind:'terminal',status,progress:{...state.progress},...(failure||state.error?{error:state.error??(failure instanceof Error?failure.message:String(failure))}:{})};state.terminal=terminal;state.expires=Date.now()+dataSearchLimits.retentionMs;state.offer=undefined;state.ack=undefined;state.reply.resolve(terminal);}})();
    return state.reply.promise;
  }
  /** 同一确认的重试重用上一回复；未来序号不会解除当前背压，也不会重放SQL。 */
  next(raw:unknown):Promise<DataSearchReply>{
    const input=dataSearchNextSchema.parse(raw);this.prune();const state=this.owner(input);
    if(input.sequence>state.progress.sequence)throw Error('数据搜索确认序号超前');
    if(state.terminal)return Promise.resolve(state.terminal);
    if(state.lastPull?.sequence===input.sequence)return state.lastPull.promise;
    if(!state.offer||state.offer.kind==='terminal'||state.offer.sequence!==input.sequence||!state.ack)throw Error('数据搜索确认已失效，请等待当前批次');
    const ack=state.ack;state.ack=undefined;state.offer=undefined;clearTimeout(state.ackTimer);state.reply=deferred();state.lastPull={sequence:input.sequence,promise:state.reply.promise};ack.resolve();return state.reply.promise;
  }
  /** 发送前登记确认等待；客户端收到前不会继续消费服务器行。 */
  private async offer(state:Search,page:Extract<DataSearchReply,{kind:'batch'|'error'}>,control:DataSearchTaskControl){
    control.checkCancelled();if(state.cancelled)throw Error('数据搜索已取消');if(state.ack)throw Error('上一数据搜索批次尚未确认');
    if(Buffer.byteLength(JSON.stringify(page))>dataSearchLimits.batchBytes)throw Error('数据搜索批次超过128KiB');
    const ack=deferred<void>();state.ack=ack;state.offer=page;state.progress.phase='waiting';
    state.ackTimer=setTimeout(()=>ack.reject(new SearchAcknowledgementError('数据搜索批次确认超时，已停止读取并释放任务；不会自动继续')),this.acknowledgementMs);state.ackTimer.unref();
    state.reply.resolve(page);this.report(state);
    try{await ack.promise;control.checkCancelled();if(state.cancelled)throw Error('数据搜索已取消');}finally{clearTimeout(state.ackTimer);if(state.ack===ack)state.ack=undefined;}
  }
  /** 每个目标和字段块显式记录范围；中断不自动重连，不再执行后续对象。 */
  private async scan(state:Search,control:DataSearchTaskControl){
    const {managed}=control,input=state.input;
    outer:for(let targetIndex=0;targetIndex<input.targets.length;targetIndex++)for(const block of dataSearchBlocks(input.targets[targetIndex])){
      control.checkCancelled();state.progress.targetIndex=targetIndex;state.progress.phase='preparing';this.report(state);let pending:DataSearchHit[]=[],pendingBytes=0,metadata:DataSearchTargetMetadata|undefined,charged=false,metadataBytes=0;
      /** 元数据只在首次命中计入保留预算；每批复用同一个描述，不积累服务器行。 */
      const flush=async()=>{if(!pending.length||!metadata)return;state.progress.hits+=pending.length;state.progress.bytes+=pendingBytes+(charged?0:metadataBytes);charged=true;const hits=pending;pending=[];pendingBytes=0;state.progress.sequence++;await this.offer(state,{kind:'batch',sequence:state.progress.sequence,targetIndex,columnOffset:block.columnOffset,metadata,hits,progress:{...state.progress,phase:'waiting'}},control);};
      try{
        metadata=await readDataSearchTarget(managed,block.target,control,{allowViews:input.allowViews});metadataBytes=Buffer.byteLength(JSON.stringify(metadata));
        const plan=buildDataSearchPlan(metadata,input.matcher,Math.max(1,input.maxResults-state.progress.hits+1));state.progress.phase='scanning';this.report(state);
        await consumeQueryFrames(managed,plan.sql,'binary',{
          statementOrdinal:1,ordinals:{results:0,rows:0},checkCancelled:()=>{control.checkCancelled();if(state.cancelled)throw Error('数据搜索已取消');},commandStarted:()=>control.commandStarted(),stop:()=>control.stop(),
          queuePeak:(rows,bytes)=>{state.progress.peakBufferedRows=Math.max(state.progress.peakBufferedRows,rows);state.progress.peakBufferedBytes=Math.max(state.progress.peakBufferedBytes,bytes);},
          consume:async frame=>{
            if(frame.kind!=='row')return;const row=decodeDataSearchRow(metadata!,frame.values);
            for(let index=0;index<row.cells.length;index++)if(row.cells[index].matched){
              if(state.progress.hits+pending.length>=input.maxResults){state.progress.limitReached=true;state.progress.limitReason='hits';throw new SearchLimit('已达到数据搜索命中上限');}
              const hit:DataSearchHit={columnIndex:block.columnOffset+index,cell:row.cells[index],keyValues:row.keyValues,...(row.keyUnavailableReason?{keyUnavailableReason:row.keyUnavailableReason}:{})},bytes=Buffer.byteLength(JSON.stringify(hit));
              if(state.progress.bytes+pendingBytes+bytes+(charged?0:metadataBytes)>dataSearchLimits.resultBytes){state.progress.limitReached=true;state.progress.limitReason='bytes';throw new SearchLimit('已达到数据搜索结果内存上限');}
              if(pending.length&&(pending.length>=dataSearchLimits.batchRows||pendingBytes+bytes+metadataBytes+4096>dataSearchLimits.batchBytes))await flush();
              if(bytes+metadataBytes+4096>dataSearchLimits.batchBytes)throw Error('单处数据搜索命中及描述超过批次预算');pending.push(hit);pendingBytes+=bytes;
            }
          },
        },plan.params);
        await flush();state.progress.processedBlocks++;
      }catch(error){
        if(error instanceof SearchLimit){await flush();break outer;}
        if(error instanceof SearchAcknowledgementError)throw error;
        control.checkCancelled();if(state.cancelled||managed.broken)throw error;state.progress.failedBlocks++;state.progress.processedBlocks++;state.progress.sequence++;
        await this.offer(state,{kind:'error',sequence:state.progress.sequence,targetIndex,columnOffset:block.columnOffset,message:(error instanceof Error?error.message:String(error)).slice(0,1024),discardedHits:pending.length,progress:{...state.progress,phase:'waiting'}},control);
        if(input.onError==='stop')throw error;
      }
    }
    state.progress.phase='releasing';this.report(state);
  }
  /** 任务进度始终是轻量快照；数据库值只通过有确认的拉取回复传输。 */
  private report(state:Search){this.emit({taskId:state.input.taskId,status:'running',progress:Math.floor(state.progress.processedBlocks/Math.max(1,state.progress.blocks)*100),message:'正在搜索数据',dataSearch:{...state.progress}});}
}
