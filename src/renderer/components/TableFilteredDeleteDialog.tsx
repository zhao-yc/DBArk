import { tableSortRuleSummary } from '../tableSort';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskEvent } from '../../shared/contracts';
import { tableFilteredDeleteConfirmation, tableFilteredDeleteReleaseInputSchema, type TableFilteredDeleteApplyInput, type TableFilteredDeleteApplyOutput, type TableFilteredDeletePreviewInput, type TableFilteredDeletePreviewOutput, type TableFilteredDeleteProgress, type TableFilteredDeleteReleaseInput } from '../../shared/tableFilteredDelete';
import { TableFilteredDeleteIntent, checkTableFilteredDeleteApplied, checkTableFilteredDeletePreview, mergeTableFilteredDeleteProgress } from '../tableFilteredDeleteUi';
import { errorMessage, invoke, uid } from '../lib';
import { filterRuleSummary } from '../tableFilters';
import { tableFilterGroupSummary } from '../tableFilterGroups';
import { tableFilteredDeleteZh as text } from '../locales/tableFilteredDelete.zh-CN';
import { ErrorBox, Field, Modal, Spinner } from './ui';

export interface TableFilteredDeleteServices {
  preview(input:TableFilteredDeletePreviewInput):Promise<TableFilteredDeletePreviewOutput>;
  apply(input:TableFilteredDeleteApplyInput):Promise<TableFilteredDeleteApplyOutput>;
  release(input:TableFilteredDeleteReleaseInput):Promise<unknown>;
  cancel(taskId:string):Promise<unknown>; subscribe(listener:(event:TaskEvent)=>void):()=>void;
}
const defaultServices:TableFilteredDeleteServices={preview:input=>invoke('table.filteredDelete.preview',input),apply:input=>invoke('table.filteredDelete.apply',input),release:input=>invoke('table.filteredDelete.release',input),cancel:taskId=>invoke('query.cancel',{taskId}),subscribe:listener=>window.dbark.onTask(listener)};
interface Props { intent:TableFilteredDeleteIntent; services?:TableFilteredDeleteServices; onActivity(delta:1|-1):void; onClose(result?:TableFilteredDeleteApplyOutput):void; onCommitted(result:TableFilteredDeleteApplyOutput,sourceChanged:boolean):void; onCleanupError(message:string):void; }
interface Operation { kind:'preview'|'apply'|'release'; promise:Promise<void>; revision:number; taskId?:string; cancelled:boolean; cancel?:Promise<void>; dispatched?:boolean; preview?:TableFilteredDeletePreviewOutput; progress?:TableFilteredDeleteProgress; }

/** 与当前页删除草稿完全独立；只删除完整服务器快照，不读取原页行值或勾选。 */
export function TableFilteredDeleteDialog({intent,services=defaultServices,...callbacks}:Props){
  const owner=useRef({intent,services,callbacks}).current;
  const[preview,setPreview]=useState<TableFilteredDeletePreviewOutput>(),previewRef=useRef<TableFilteredDeletePreviewOutput|undefined>(undefined);
  const[confirmation,setConfirmation]=useState(''),[acknowledged,setAcknowledged]=useState(false),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<TableFilteredDeleteProgress>(),[done,setDone]=useState<TableFilteredDeleteApplyOutput>(),[clock,setClock]=useState(Date.now());
  const mounted=useRef(true),closed=useRef(false),invalid=useRef(false),revision=useRef(0),consumed=useRef(false),operation=useRef<Operation|undefined>(undefined),doneRef=useRef<TableFilteredDeleteApplyOutput|undefined>(undefined),reported=useRef(false),committed=useRef<object|undefined>(undefined),releases=useRef(new Map<string,TableFilteredDeleteReleaseInput>()),releasing=useRef(new Map<string,Promise<void>>());
  const ticket={};useLayoutEffect(()=>{committed.current=ticket;return()=>{if(committed.current===ticket)committed.current=undefined;};});
  if(intent!==owner.intent||services!==owner.services)invalid.current=true;
  function cleanup(reason:unknown):void {try{owner.callbacks.onCleanupError(errorMessage(reason));}catch{}}
  /** 来源失效只能单向撤销；渲染期间不更新子状态。 */
  function current():boolean {if(!mounted.current||closed.current||invalid.current)return false;if(!owner.intent.current())invalid.current=true;return !invalid.current;}
  function editable():boolean {return current()&&committed.current===ticket&&!operation.current&&!consumed.current;}
  function valid(active:Operation):boolean {return operation.current===active&&active.revision===revision.current&&!active.cancelled&&current();}
  /** 每个原令牌只释放自己的能力，失败保留待清理责任，不改报已释放。 */
  async function release(value:TableFilteredDeleteReleaseInput):Promise<void>{
    const key=value.connectionId+':'+value.previewToken;releases.current.set(key,value);let pending=releasing.current.get(key);
    if(!pending){pending=Promise.resolve().then(()=>owner.services.release(value)).then(()=>{releases.current.delete(key);});releasing.current.set(key,pending);}
    try{await pending;}finally{if(releasing.current.get(key)===pending)releasing.current.delete(key);}
  }
  async function drain():Promise<void>{for(const value of [...releases.current.values()])await release(value);}
  function revokePreview():TableFilteredDeletePreviewOutput|undefined {const old=previewRef.current;previewRef.current=undefined;setPreview(undefined);setConfirmation('');setAcknowledged(false);if(old)releases.current.set(old.target.connectionId+':'+old.previewToken,{connectionId:old.target.connectionId,previewToken:old.previewToken});return old;}
  /** COMMIT可能发送后只能等待确认；取消ACK不能代替原任务真实终结。 */
  function cancel(active=operation.current):void {if(!active||active.cancelled||!active.taskId||active.kind==='apply'&&(doneRef.current||active.progress?.commitMayHaveBeenSent||active.progress?.commitAcknowledged))return;active.cancelled=true;active.cancel=Promise.resolve().then(()=>owner.services.cancel(active.taskId!)).then(()=>undefined).catch(cleanup);if(mounted.current&&!closed.current)setError(text.cancelling);}
  /** 已确认提交优先于页面失效、晚取消或收尾异常，父级只接一次准确事实。 */
  function committedOutput(output:TableFilteredDeleteApplyOutput):void {if(doneRef.current)return;doneRef.current=output;if(mounted.current&&!closed.current){setDone(output);setError('');}if(!reported.current){reported.current=true;try{owner.callbacks.onCommitted(output,!owner.intent.current()||invalid.current);}catch(reason){cleanup(reason);}}}
  /** 所有占门都等待原任务、原取消和原token释放；不会提前清operation。 */
  function start(kind:Operation['kind'],action:(active:Operation)=>Promise<void>,taskId?:string,expected?:TableFilteredDeletePreviewOutput,cleanupOnly=false):void{
    if(operation.current||!cleanupOnly&&!editable())return;
    let active:Operation;const promise=Promise.resolve().then(async()=>{if(cleanupOnly||valid(active))await action(active);}).catch(reason=>{if(mounted.current&&!closed.current&&active.revision===revision.current)setError(errorMessage(reason));}).finally(async()=>{
      if(active.cancel)await active.cancel;
      if(active.kind==='apply'&&!active.dispatched&&active.preview)releases.current.set(active.preview.target.connectionId+':'+active.preview.previewToken,{connectionId:active.preview.target.connectionId,previewToken:active.preview.previewToken});
      try{if(active.kind!=='release')await drain();}catch(reason){cleanup(reason);if(mounted.current&&!closed.current)setError(errorMessage(reason));}
      if(active.kind==='apply'&&active.preview&&active.progress?.commitAcknowledged)committedOutput({operation:'delete',target:active.preview.target,rows:active.preview.rows,outcome:'committed',commitAcknowledged:true});
      if(operation.current===active)operation.current=undefined;try{owner.callbacks.onActivity(-1);}catch(reason){cleanup(reason);}if(mounted.current)setBusy(false);
    });
    active={kind,promise,taskId,revision:revision.current,cancelled:false,preview:expected};operation.current=active;setBusy(true);setError('');try{owner.callbacks.onActivity(1);}catch(reason){invalid.current=true;cleanup(reason);}
  }
  function prepare():void {
    if(!editable())return;let input:TableFilteredDeletePreviewInput;try{input=owner.intent.input(uid());}catch(reason){setError(errorMessage(reason));return;}
    revokePreview();setProgress(undefined);
    start('preview',async active=>{await drain();if(!valid(active))return;const raw=await owner.services.preview(input),token=tableFilteredDeleteReleaseInputSchema.safeParse({connectionId:input.connectionId,previewToken:raw?.previewToken});if(token.success)releases.current.set(token.data.connectionId+':'+token.data.previewToken,token.data);const result=checkTableFilteredDeletePreview(raw,input);if(!valid(active))return;releases.current.delete(input.connectionId+':'+result.previewToken);previewRef.current=result;setPreview(result);setClock(Date.now());},input.taskId);
  }
  /** 第一次await前消费原token；失败/未知后旧回调不能再次发送apply。 */
  function apply():void {
    const expected=previewRef.current;if(!editable()||!expected||!expected.rows||Date.parse(expected.expiresAt)<=Date.now()||confirmation!==tableFilteredDeleteConfirmation(expected)||!acknowledged)return;
    const input:TableFilteredDeleteApplyInput={connectionId:expected.target.connectionId,taskId:uid(),previewToken:expected.previewToken,confirmation,acknowledged:true};
    start('apply',async active=>{
      try{active.dispatched=true;committedOutput(checkTableFilteredDeleteApplied(await owner.services.apply(input),expected));}
      catch(reason){if(active.progress?.commitAcknowledged){committedOutput({operation:'delete',target:expected.target,rows:expected.rows,outcome:'committed',commitAcknowledged:true});if(mounted.current&&!closed.current)setError(text.cleanup+' '+errorMessage(reason));}else if(mounted.current&&!closed.current)setError((active.progress?.rollbackAcknowledged&&active.progress.transactionProtected&&!active.progress.commitMayHaveBeenSent?text.rolledBack:active.progress?.outcome==='not-sent'&&!active.progress.dmlMayHaveBeenSent?text.notSent:text.unknown)+' '+errorMessage(reason));}
    },input.taskId,expected);
    if(operation.current?.taskId===input.taskId){consumed.current=true;previewRef.current=undefined;}
  }
  /** 关闭保留原Promise；收尾后把准确ACK交父级决定是否仍可刷新原scope。 */
  function close():void {
    if(!mounted.current||closed.current||committed.current!==ticket)return;closed.current=true;setClosing(true);revokePreview();const active=operation.current;cancel(active);
    void(async()=>{try{if(active){await active.promise;await active.cancel;}await drain();if(mounted.current)owner.callbacks.onClose(doneRef.current);}catch(reason){cleanup(reason);if(mounted.current){closed.current=false;setClosing(false);setError(errorMessage(reason));}}})();
  }
  useEffect(()=>{
    mounted.current=true;const unsubscribeIntent=owner.intent.subscribe(()=>{invalid.current=true;if(mounted.current)setStale(true);cancel();const old=previewRef.current;if(old&&!operation.current){revokePreview();start('release',async()=>{await drain();},undefined,undefined,true);}});
    const unsubscribeTask=owner.services.subscribe(event=>{const active=operation.current;if(!active||event.taskId!==active.taskId)return;active.progress=mergeTableFilteredDeleteProgress(active.progress,event.tableFilteredDelete,active.preview?.rows);if(mounted.current&&!closed.current)setProgress(active.progress);});
    const inspect=()=>{const dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');if(dialogs.length!==1||!dialogs[0].querySelector('[data-table-filtered-delete-dialog]'))owner.intent.invalidate();};const observer=typeof MutationObserver==='function'?new MutationObserver(inspect):undefined;observer?.observe(document.body,{childList:true,subtree:true});inspect();
    const timer=setInterval(()=>{if(mounted.current)setClock(Date.now());},1000);
    const block=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&(event.key==='Enter'||event.key.toLowerCase()==='s')){event.preventDefault();event.stopImmediatePropagation();}};document.addEventListener('keydown',block,true);
    return()=>{mounted.current=false;unsubscribeIntent();observer?.disconnect();clearInterval(timer);document.removeEventListener('keydown',block,true);cancel();const old=previewRef.current;previewRef.current=undefined;if(old)releases.current.set(old.target.connectionId+':'+old.previewToken,{connectionId:old.target.connectionId,previewToken:old.previewToken});const active=operation.current;void(async()=>{try{if(active){await active.promise;await active.cancel;}await drain();}finally{unsubscribeTask();}})().catch(cleanup);};
  },[]);
  const disabled=busy||closing||stale||invalid.current||consumed.current,expired=!!preview&&Date.parse(preview.expiresAt)<=clock;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" style={{minWidth:0,maxWidth:'100%',overflowX:'hidden',overflowWrap:'anywhere'}} data-table-filtered-delete-dialog aria-busy={busy||closing}>
    <p>{owner.intent.target.database}.{owner.intent.target.table}</p><p>{text.scope}</p><p className="warning-text">{text.transaction}</p><p className="warning-text">{text.dependencies}</p>
    <section aria-label={text.conditions}><strong>{text.conditions}</strong>{!!owner.intent.scope.filters.length&&<ul>{owner.intent.scope.filters.map((rule,index)=><li key={index}>{rule.enabled===false?text.disabledRule:''}{filterRuleSummary(rule)}</li>)}</ul>}{!owner.intent.scope.filters.some(rule=>rule.enabled!==false)&&<p className="warning-text">{text.noConditions}</p>}{owner.intent.scope.filterGroup&&<p>{tableFilterGroupSummary(owner.intent.scope.filterGroup)}</p>}</section>
    <section aria-label={text.sorts}><strong>{text.sorts}</strong>{owner.intent.scope.sort.length?<ol>{owner.intent.scope.sort.map(rule=><li key={rule.column}>{tableSortRuleSummary(rule)}</li>)}</ol>:<p>{text.noSorts}</p>}</section>
    {busy&&<Spinner text={operation.current?.kind==='apply'?text.applying:operation.current?.kind==='release'?text.release:text.previewing}/>} {closing&&<p>{text.closing}</p>}{progress&&<p role="status">{text.phases[progress.phase]} · {progress.rows} / {progress.totalRows}</p>}{progress?.commitMayHaveBeenSent&&!progress.commitAcknowledged&&<p className="warning-text">{text.committing}</p>}
    {preview&&<section><p>{preview.target.database}.{preview.target.table} / 删除</p><p>{text.sample(preview.shownRows,preview.rows)}</p>{preview.sampleOmitted&&<p>{text.omitted}</p>}<p>{text.timeZone(preview.timeZone)}</p>{preview.warnings.map((warning,index)=><p className="warning-text" key={index}>{warning}</p>)}<pre className="sql-preview" aria-label={text.sql} style={{boxSizing:'border-box',display:'block',width:'100%',maxWidth:'100%',maxHeight:200,overflow:'auto',whiteSpace:'pre'}}>{preview.sql}</pre>{!preview.rows&&<p>{text.empty}</p>}<p>{tableFilteredDeleteConfirmation(preview)}</p><Field label={text.confirmation}><textarea aria-label={text.confirmation} rows={2} style={{boxSizing:'border-box',maxWidth:'100%',overflowWrap:'anywhere'}} value={confirmation} disabled={disabled||expired||!preview.rows} onChange={event=>{if(editable())setConfirmation(event.target.value);}}/></Field><label><input type="checkbox" aria-label={text.acknowledge} checked={acknowledged} disabled={disabled||expired||!preview.rows} onChange={event=>{if(editable())setAcknowledged(event.target.checked);}}/>{text.acknowledge}</label></section>}
  </div><footer className="modal-footer" style={{flexDirection:'column',alignItems:'stretch'}}>
    <div data-table-filtered-delete-status style={{maxHeight:120,overflow:'auto',overflowWrap:'anywhere'}}>{done&&<p className="success-box" role="status">{owner.intent.current()?text.committed(done.rows):text.committedChanged(done.rows)}</p>}<ErrorBox message={stale||invalid.current?text.stale:error||(expired&&!consumed.current?text.expired:'')}/>{consumed.current&&!done&&!busy&&<p>{text.consumed}</p>}</div>
    <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button disabled={closing} onClick={close}>{text.close}</button><span className="grow"/>{busy&&operation.current?.taskId&&<button disabled={closing||operation.current.cancelled||!!progress?.commitMayHaveBeenSent||!!progress?.commitAcknowledged} onClick={()=>{if(committed.current===ticket)cancel();}}>{text.cancel}</button>}<button disabled={disabled} onClick={prepare}>{text.preview}</button><button className="danger" disabled={disabled||expired||!preview?.rows||confirmation!==(preview?tableFilteredDeleteConfirmation(preview):'')||!acknowledged} onClick={apply}>{text.apply}</button></div>
  </footer></Modal>;
}
