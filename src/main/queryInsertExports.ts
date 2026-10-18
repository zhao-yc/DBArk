import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { SelectedFile } from './fileTokens';
import type { QueryStreamExportInput } from '../shared/queryStreamExport';
import { queryInsertLimits, type QueryInsertPending } from '../shared/queryInsertExport';
import { queryInsertZh as text } from '../shared/queryInsertExport.zh-CN';
interface Entry {owner:ColumnsInvocation;revision:number;session:object;sessionId:string;target:string;mapping:string;encoding:string;pending?:QueryInsertPending;granted:boolean;invalid:boolean}
interface Runtime {assert(owner:ColumnsInvocation|undefined):void;same(left:ColumnsInvocation,right:ColumnsInvocation):boolean;revision():number;session(id:string):object|undefined;stop(id:string):Promise<unknown>;closing():boolean}
/** Main只保留真实文档/会话身份和有界发布信息；文件令牌独立用途、一次消费。 */
export class QueryInsertExports{
  private readonly choices=new Map<string,{owner:ColumnsInvocation;file:SelectedFile}>();
  private readonly entries=new Map<string,Entry>();
  /** 只注入原Main归属和精确停止端口，不获得数据库或任意路径访问能力。 */
  constructor(private readonly files:Map<string,SelectedFile>,private readonly runtime:Runtime){}
  /** 原生选择返回后复核真实文档，通用SQL文件不能借此用途执行查询。 */
  bind(token:string,owner:ColumnsInvocation):void{
    this.runtime.assert(owner);if(this.runtime.closing())throw Error(text.stale);
    const file=this.files.get(token);if(!file||file.purpose!=='export'||file.format!=='sql')throw Error(text.stale);
    // 当前文档仅保留最后一次显式选择，旧选择不能积累可写文件能力。
    for(const [previous,value]of this.choices){if(this.files.get(previous)===value.file)this.files.delete(previous);}this.choices.clear();
    const selected={...file,purpose:'query-insert-export'};this.files.set(token,selected);this.choices.set(token,{owner,file:selected});
  }
  /** 在第一个await前消费目标；失败、取消或旧请求回包均不能恢复同一执行能力。 */
  begin(input:QueryStreamExportInput,owner:ColumnsInvocation|undefined):string{
    this.runtime.assert(owner);const selected=this.choices.get(input.fileToken),session=this.runtime.session(input.sessionId);
    if(this.entries.size>=queryInsertLimits.activeTasks)throw Error(text.capacity);
    if(this.runtime.closing()||!owner||!session||!input.insertTarget||this.entries.has(input.taskId)||!selected||this.files.get(input.fileToken)!==selected.file||!this.runtime.same(owner,selected.owner))throw Error(text.stale);
    this.choices.delete(input.fileToken);this.files.delete(input.fileToken);
    this.entries.set(input.taskId,{owner,session,sessionId:input.sessionId,revision:this.runtime.revision(),target:`${input.insertTarget.database}.${input.insertTarget.table}`,mapping:JSON.stringify(input.insertTarget),encoding:input.encoding,granted:false,invalid:false});return selected.file.path;
  }
  /** 路径等待后及样例发布前重核原会话、配置修订和真实主文档。 */
  assert(taskId:string):void{
    const entry=this.entries.get(taskId);if(!entry||entry.invalid||entry.revision!==this.runtime.revision()||entry.session!==this.runtime.session(entry.sessionId))throw Error(text.stale);this.runtime.assert(entry.owner);
  }
  /** 样例只交付原owner；没有授权的引擎事件不能创建新的Main发布能力。 */
  receive(taskId:string,pending?:QueryInsertPending):boolean{
    const entry=this.entries.get(taskId);if(!entry)return pending===undefined;
    try{this.assert(taskId);if(pending){if(entry.granted||entry.pending||JSON.stringify(pending.target)!==entry.mapping||pending.encoding!==entry.encoding)throw Error(text.stale);entry.pending=pending;}return true;}
    catch{if(!entry.granted)this.invalidate(taskId);return false;}
  }
  /** 确认调用无await同步消费，不允许双击、旧文档或其它任务借用同一字符串令牌。 */
  grant(input:{taskId:string;previewToken:string;confirmation:string},owner:ColumnsInvocation|undefined):void{
    // 退出确认框尚未决定时只拒绝发布，不提前取消原任务；返回工作台后可继续确认。
    if(this.runtime.closing())throw Error(text.stale);
    this.assert(input.taskId);this.runtime.assert(owner);const entry=this.entries.get(input.taskId)!;
    if(!owner||!this.runtime.same(owner,entry.owner)||entry.granted||!entry.pending||entry.pending.previewToken!==input.previewToken||entry.target!==input.confirmation||Date.parse(entry.pending.expiresAt)<=Date.now())throw Error(text.stale);
    entry.granted=true;entry.pending=undefined;
  }
  /** 取消也必须来自持有该任务的真实文档，不能只凭任务编号。 */
  assertOwned(id:string,owner:ColumnsInvocation|undefined):void{this.assert(id);this.runtime.assert(owner);if(!owner||!this.runtime.same(owner,this.entries.get(id)!.owner))throw Error(text.stale);}
  /** 仅本片活动编号参与真实IPC归属捕获，不改变其它查询取消路径。 */
  has(id:string):boolean{return this.entries.has(id);}
  /** 撤销只是停止自有任务；原链继续等待文件清理，不能在Main假造已经取消成功。 */
  private invalidate(id:string):void{const entry=this.entries.get(id);if(!entry||entry.invalid||entry.granted)return;entry.invalid=true;void this.runtime.stop(id).catch(()=>undefined);}
  /** 导航、崩溃及配置变化主动撤销；最终确认已同步授权的发布按真实提交结果报告。 */
  invalidateAll():void{for(const [token,value]of this.choices){if(this.files.get(token)===value.file)this.files.delete(token);}this.choices.clear();for(const id of this.entries.keys())this.invalidate(id);}
  /** 原Promise收尾后只移除本任务记录，不清掉其它待发布操作。 */
  finish(id:string):void{this.entries.delete(id);}
}
