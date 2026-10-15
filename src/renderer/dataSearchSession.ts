import {dataSearchInputSchema,dataSearchLimits,type DataSearchInput,type DataSearchNext,type DataSearchReply,type DataSearchProgress,type DataSearchHit,type DataSearchTargetMetadata} from '../shared/dataSearch';

export interface DataSearchServices{start(input:DataSearchInput):Promise<DataSearchReply>;next(input:DataSearchNext):Promise<DataSearchReply>;release(input:{connectionId:string;taskId:string}):Promise<void>;releaseRecords?(input:{connectionId:string;sourceTaskId:string}):Promise<void>}
export interface DataSearchViewHit extends DataSearchHit{id:string;block:string;columnOffset:number}
export interface DataSearchView{busy:boolean;status:'idle'|'running'|'completed'|'failed'|'cancelled';input?:DataSearchInput;progress?:DataSearchProgress;rows:DataSearchViewHit[];blocks:ReadonlyMap<string,DataSearchTargetMetadata>;failures:string[];error?:string}
interface Operation{input:DataSearchInput;stopped:boolean;done:Promise<void>;release?:Promise<void>}
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;

/** 每次只消费一个已确认批次，结果与块描述分开保存；关闭等待真正的引擎释放。 */
export class DataSearchSession{
  private operation?:Operation;
  private view:DataSearchView={busy:false,status:'idle',rows:[],blocks:new Map(),failures:[]};
  private retainedBytes=0;
  private sequence=0;
  private sources=new Map<string,{connectionId:string;sourceTaskId:string}>();
  private closing?:Promise<void>;
  constructor(private readonly services:DataSearchServices,private readonly publish:(view:DataSearchView)=>void){}
  /** 只读快照供组件初始化；所有状态更新产生新对象，旧批次不会被后续修改。 */
  get snapshot(){return this.view;}
  /** 同步登记占位防双击；提交前留一个微任务，卸载可撤销尚未发送的搜索。 */
  start(raw:unknown):Promise<void>{
    if(this.operation||this.closing)throw Error('上一次搜索尚未释放，请先关闭或重试清理');
    const input=dataSearchInputSchema.parse(raw),operation:Operation={input,stopped:false,done:Promise.resolve()};this.operation=operation;
    this.retainedBytes=0;this.sequence=0;this.update({busy:true,status:'running',input,rows:[],blocks:new Map(),failures:[],error:undefined,progress:undefined});
    operation.done=(async()=>{
      try{
        await Promise.resolve();await this.clearRecords();if(operation.stopped){this.update({...this.view,status:'cancelled'});return;}
        this.sources.set(input.taskId,{connectionId:input.connectionId,sourceTaskId:input.taskId});
        let page=await this.services.start(input);
        for(;;){
          if(operation.stopped){this.update({...this.view,status:'cancelled'});break;}
          this.accept(page);
          if(page.kind==='terminal')break;
          // 发布本批之后才确认；实际数据量仍有独立总预算，不以快速IPC制造无确认队列。
          await new Promise<void>(resolve=>setTimeout(resolve,0));
          if(operation.stopped){this.update({...this.view,status:'cancelled'});break;}
          page=await this.services.next({connectionId:input.connectionId,taskId:input.taskId,sequence:page.sequence});
        }
      }catch(error){this.update({...this.view,status:operation.stopped?'cancelled':'failed',error:message(error)});}
      finally{try{await this.release(operation);this.finish(operation);}catch(error){this.update({...this.view,status:'failed',error:message(error),busy:true});}}
    })();return operation.done;
  }
  /** 取消与窗口关闭共用一条释放请求；取消返回不能替代仍在等待的开始/续页回复。 */
  async stop():Promise<void>{const operation=this.operation;if(!operation)return;operation.stopped=true;await this.release(operation);await operation.done;this.finish(operation);}
  /** 关闭窗口才释放仍可使用的定位引用；普通取消保留已收到的只读命中。 */
  close():Promise<void>{if(this.closing)return this.closing;const operation=(async()=>{try{await this.stop();await this.clearRecords();}finally{this.closing=undefined;}})();this.closing=operation;return operation;}
  /** 新搜索和关闭共用精确来源清理，失败保留来源以供明确重试。 */
  private async clearRecords():Promise<void>{for(const[key,source]of this.sources){await this.services.releaseRecords?.(source);this.sources.delete(key);}}
  /** 清理失败后保留占位且允许显式重试，不能遗忘仍可能在执行的后台任务。 */
  private async release(operation:Operation):Promise<void>{
    if(!operation.release){const pending=Promise.resolve().then(()=>this.services.release({connectionId:operation.input.connectionId,taskId:operation.input.taskId}));operation.release=pending;void pending.catch(()=>{});}
    try{await operation.release;}catch(error){operation.release=undefined;throw error;}
  }
  /** 回复消费和服务释放都结束后才交还占位，迟到旧回复不会污染下一次搜索。 */
  private finish(operation:Operation){if(this.operation===operation){this.operation=undefined;this.update({...this.view,busy:false});}}
  /** 只接受递增序号；错误批同样占用确认序号，不丢弃已接收的旧结果。 */
  private accept(page:DataSearchReply){
    if(page.kind==='terminal'){
      if(page.status==='completed'&&(page.progress.hits!==this.view.rows.length||page.progress.processedBlocks<page.progress.blocks&&!page.progress.limitReached))throw Error('数据搜索完成计数与已接收范围不一致');
      this.update({...this.view,status:page.status,progress:page.progress,error:page.error});return;
    }
    if(page.sequence!==this.sequence+1||bytes(page)>dataSearchLimits.batchBytes)throw Error('数据搜索回复序号或批次预算无效，已停止读取');
    this.sequence=page.sequence;
    if(page.kind==='error'){
      if(this.view.failures.length>=1024||page.message.length>1024)throw Error('数据搜索错误明细超过预算');
      this.update({...this.view,progress:page.progress,failures:[...this.view.failures,page.message]});return;
    }
    if(page.hits.length>dataSearchLimits.batchRows||this.view.rows.length+page.hits.length>Math.min(dataSearchLimits.rows,this.view.input!.maxResults))throw Error('数据搜索命中数超过预算');
    const block=JSON.stringify([page.targetIndex,page.columnOffset]),blocks=new Map(this.view.blocks),known=blocks.get(block);
    if(known&&JSON.stringify(known)!==JSON.stringify(page.metadata))throw Error('数据搜索字段描述在批次之间变化');
    const added=bytes(page.hits)+(known?0:bytes(page.metadata));
    if(this.retainedBytes+added>dataSearchLimits.resultBytes)throw Error('数据搜索结果超过32MiB，已停止读取');this.retainedBytes+=added;
    if(!known)blocks.set(block,page.metadata);
    const rows=page.hits.map((hit,index)=>{
      if(hit.columnIndex<page.columnOffset||hit.columnIndex>=page.columnOffset+page.metadata.columns.length)throw Error('数据搜索命中字段位置无效');
      return{...hit,id:page.sequence+':'+index,block,columnOffset:page.columnOffset};
    });
    this.update({...this.view,progress:page.progress,blocks,rows:[...this.view.rows,...rows]});
  }
  /** 单一状态出口，React订阅者只接收有界、不可变的结果快照。 */
  private update(view:DataSearchView){this.view=view;this.publish(view);}
}
/** 错误只交当前搜索窗口显示，不持久化搜索值或服务器错误。 */
function message(error:unknown){return error instanceof Error?error.message:'数据搜索失败';}
