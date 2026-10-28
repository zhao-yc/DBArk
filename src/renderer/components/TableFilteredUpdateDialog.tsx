import { tableSortRuleSummary } from '../tableSort';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TaskEvent } from '../../shared/contracts';
import { tableFilteredUpdateConfirmation, tableFilteredUpdateOutputColumns, tableFilteredUpdateReleaseInputSchema, type TableFilteredUpdateApplyInput, type TableFilteredUpdateApplyOutput, type TableFilteredUpdatePreviewInput, type TableFilteredUpdatePreviewOutput, type TableFilteredUpdateProgress, type TableFilteredUpdateReleaseInput } from '../../shared/tableFilteredUpdate';
import { TableFilteredUpdateIntent, checkTableFilteredUpdateApplied, checkTableFilteredUpdatePreview, mergeTableFilteredUpdateProgress, tableFilteredUpdateColumns, tableFilteredUpdateInputDigest, tableFilteredUpdateCommitted } from '../tableFilteredUpdateUi';
import type { RecordInput } from '../recordViews';
import { errorMessage, invoke, uid } from '../lib';
import { filterRuleSummary } from '../tableFilters';
import { tableFilterGroupSummary } from '../tableFilterGroups';
import { tableFilteredUpdateZh as text } from '../locales/tableFilteredUpdate.zh-CN';
import { RecordValueEditor } from './RecordValueEditor';
import { ErrorBox, Field, Modal, Spinner } from './ui';

export interface TableFilteredUpdateServices {
  preview(input:TableFilteredUpdatePreviewInput):Promise<TableFilteredUpdatePreviewOutput>;
  apply(input:TableFilteredUpdateApplyInput):Promise<TableFilteredUpdateApplyOutput>;
  release(input:TableFilteredUpdateReleaseInput):Promise<unknown>;
  cancel(taskId:string):Promise<unknown>; subscribe(listener:(event:TaskEvent)=>void):()=>void;
}
const defaultServices:TableFilteredUpdateServices={preview:input=>invoke('table.filteredUpdate.preview',input),apply:input=>invoke('table.filteredUpdate.apply',input),release:input=>invoke('table.filteredUpdate.release',input),cancel:taskId=>invoke('query.cancel',{taskId}),subscribe:listener=>window.dbark.onTask(listener)};
interface Props { intent:TableFilteredUpdateIntent; initialColumn?:string; services?:TableFilteredUpdateServices; onActivity(delta:1|-1):void; onClose(result?:TableFilteredUpdateApplyOutput):void; onCommitted(result:TableFilteredUpdateApplyOutput,sourceChanged:boolean):void; onCleanupError(message:string):void; }
interface Draft { id:number; column:string; input:RecordInput; }
interface Operation { kind:'preview'|'apply'|'release'; promise:Promise<void>; revision:number; taskId?:string; cancelled:boolean; cancel?:Promise<void>; dispatched?:boolean; preview?:TableFilteredUpdatePreviewOutput; progress?:TableFilteredUpdateProgress; }

/** 与当前页填充完全独立；只冻结服务器范围，原页输入和勾选不参与更新。 */
export function TableFilteredUpdateDialog({intent,services=defaultServices,initialColumn,...callbacks}:Props){
  const owner=useRef({intent,services,callbacks}).current,columns=tableFilteredUpdateColumns(owner.intent.source);
  function blank(column:string):RecordInput {const type=columns.find(item=>item.name===column)?.type??'';return{mode:/^(?:TINYBLOB|BLOB|MEDIUMBLOB|LONGBLOB|BINARY|VARBINARY|BIT)\b/i.test(type)?'binary':/^JSON\b/i.test(type)?'json':'text',text:''};}
  const first=columns.find(item=>item.name===initialColumn)?.name??columns[0]?.name??'';
  const nextId=useRef(1),[draft,setDraft]=useState<Draft[]>(()=>[{id:0,column:first,input:blank(first)}]),live=useRef(draft);live.current=draft;
  const[preview,setPreview]=useState<TableFilteredUpdatePreviewOutput>(),previewRef=useRef<TableFilteredUpdatePreviewOutput|undefined>(undefined);
  const[confirmation,setConfirmation]=useState(''),[acknowledged,setAcknowledged]=useState(false),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<TableFilteredUpdateProgress>(),[done,setDone]=useState<TableFilteredUpdateApplyOutput>(),[clock,setClock]=useState(Date.now());
  const mounted=useRef(true),closed=useRef(false),invalid=useRef(false),revision=useRef(0),consumed=useRef(false),operation=useRef<Operation|undefined>(undefined),doneRef=useRef<TableFilteredUpdateApplyOutput|undefined>(undefined),reported=useRef(false),committed=useRef<object|undefined>(undefined),releases=useRef(new Map<string,TableFilteredUpdateReleaseInput>()),releasing=useRef(new Map<string,Promise<void>>());
  const ticket={};useLayoutEffect(()=>{committed.current=ticket;return()=>{if(committed.current===ticket)committed.current=undefined;};});
  if(intent!==owner.intent||services!==owner.services)invalid.current=true;
  function cleanup(reason:unknown):void {try{owner.callbacks.onCleanupError(errorMessage(reason));}catch{}}
  /** 来源失效只能单向撤销；渲染期间不更新子状态。 */
  function current():boolean {if(!mounted.current||closed.current||invalid.current)return false;if(!owner.intent.current())invalid.current=true;return !invalid.current;}
  function editable():boolean {return current()&&committed.current===ticket&&live.current===draft&&!operation.current&&!consumed.current;}
  function valid(active:Operation):boolean {return operation.current===active&&active.revision===revision.current&&!active.cancelled&&current();}
  /** 每个原令牌只释放自己的能力，失败保留待清理责任，不改报已释放。 */
  async function release(value:TableFilteredUpdateReleaseInput):Promise<void>{
    const key=value.connectionId+':'+value.previewToken;releases.current.set(key,value);let pending=releasing.current.get(key);
    if(!pending){pending=Promise.resolve().then(()=>owner.services.release(value)).then(()=>{releases.current.delete(key);});releasing.current.set(key,pending);}
    try{await pending;}finally{if(releasing.current.get(key)===pending)releasing.current.delete(key);}
  }
  async function drain():Promise<void>{for(const value of [...releases.current.values()])await release(value);}
  function revokePreview():TableFilteredUpdatePreviewOutput|undefined {const old=previewRef.current;previewRef.current=undefined;setPreview(undefined);setConfirmation('');setAcknowledged(false);if(old)releases.current.set(old.target.connectionId+':'+old.previewToken,{connectionId:old.target.connectionId,previewToken:old.previewToken});return old;}
  /** COMMIT可能发送后只能等待确认；取消ACK不能代替原任务真实终结。 */
  function cancel(active=operation.current):void {if(!active||active.cancelled||!active.taskId||active.kind==='apply'&&(doneRef.current||active.progress?.commitMayHaveBeenSent||active.progress?.commitAcknowledged))return;active.cancelled=true;active.cancel=Promise.resolve().then(()=>owner.services.cancel(active.taskId!)).then(()=>undefined).catch(cleanup);if(mounted.current&&!closed.current)setError(text.cancelling);}
  /** 已确认提交优先于页面失效、晚取消或收尾异常，父级只接一次准确事实。 */
  function committedOutput(output:TableFilteredUpdateApplyOutput):void {if(doneRef.current)return;doneRef.current=output;if(mounted.current&&!closed.current){setDone(output);setError('');}if(!reported.current){reported.current=true;try{owner.callbacks.onCommitted(output,!owner.intent.current()||invalid.current);}catch(reason){cleanup(reason);}}}
  /** 所有占门都等待原任务、原取消和原token释放；不会提前清operation。 */
  function start(kind:Operation['kind'],action:(active:Operation)=>Promise<void>,taskId?:string,expected?:TableFilteredUpdatePreviewOutput,cleanupOnly=false):void{
    if(operation.current||!cleanupOnly&&!editable())return;
    let active:Operation;const promise=Promise.resolve().then(async()=>{if(cleanupOnly||valid(active))await action(active);}).catch(reason=>{
      // 独立释放的finally不再drain，原错误须在这里通知父级；待清理token仍保留，不能假报释放。
      if(active.kind==='release')cleanup(reason);
      if(mounted.current&&!closed.current&&active.revision===revision.current)setError(errorMessage(reason));
    }).finally(async()=>{
      if(active.cancel)await active.cancel;
      if(active.kind==='apply'&&!active.dispatched&&active.preview)releases.current.set(active.preview.target.connectionId+':'+active.preview.previewToken,{connectionId:active.preview.target.connectionId,previewToken:active.preview.previewToken});
      try{if(active.kind!=='release')await drain();}catch(reason){cleanup(reason);if(mounted.current&&!closed.current)setError(errorMessage(reason));}
      if(active.kind==='apply'&&active.preview&&active.progress?.commitAcknowledged)committedOutput(tableFilteredUpdateCommitted(active.preview));
      if(operation.current===active)operation.current=undefined;try{owner.callbacks.onActivity(-1);}catch(reason){cleanup(reason);}if(mounted.current)setBusy(false);
    });
    active={kind,promise,taskId,revision:revision.current,cancelled:false,preview:expected};operation.current=active;setBusy(true);setError('');try{owner.callbacks.onActivity(1);}catch(reason){invalid.current=true;cleanup(reason);}
  }
  /** 输入/列每次变化递增代次；即使改回原值，也只能重新读取，不借旧确认。 */
  function change(next:Draft[]):void {if(!editable())return;revision.current++;revokePreview();live.current=next;setDraft(next);setProgress(undefined);setError('');if(releases.current.size)start('release',async()=>{await drain();},undefined,undefined,true);}
  /** 新目标使用自身类型的空值；不能把上一字段的NULL、Hex或精确文本误带过去。 */
  function selectColumn(id:number,name:string):void {if(!editable()||!columns.some(column=>column.name===name)||draft.some(item=>item.id!==id&&item.column===name))return;change(draft.map(item=>item.id===id?{...item,column:name,input:blank(name)}:item));}
  /** 只追加尚未选取的可写字段；每次结构变化都撤销原预览修订。 */
  function add():void {if(!editable())return;const column=columns.find(column=>!draft.some(item=>item.column===column.name));if(column)change([...draft,{id:nextId.current++,column:column.name,input:blank(column.name)}]);}
  /** 至少保留一项，移除也只能通过当前修订的编辑门。 */
  function remove(id:number):void {if(draft.length>1)change(draft.filter(item=>item.id!==id));}
  function prepare():void {
    if(!editable())return;let input:TableFilteredUpdatePreviewInput;try{input=owner.intent.inputs(draft,uid());}catch(reason){setError(errorMessage(reason));return;}
    revokePreview();setProgress(undefined);
    start('preview',async active=>{await drain();if(!valid(active))return;const digest=await tableFilteredUpdateInputDigest(input);if(!valid(active))return;const raw=await owner.services.preview(input),token=tableFilteredUpdateReleaseInputSchema.safeParse({connectionId:input.connectionId,previewToken:raw?.previewToken});if(token.success)releases.current.set(token.data.connectionId+':'+token.data.previewToken,token.data);const result=checkTableFilteredUpdatePreview(raw,input,digest);if(!valid(active))return;releases.current.delete(input.connectionId+':'+result.previewToken);previewRef.current=result;setPreview(result);setClock(Date.now());},input.taskId);
  }
  /** 第一次await前消费原token；失败/未知后旧回调不能再次发送apply。 */
  function apply():void {
    const expected=previewRef.current;if(!editable()||!expected||!expected.rows||Date.parse(expected.expiresAt)<=Date.now()||confirmation!==tableFilteredUpdateConfirmation(expected)||!acknowledged)return;
    const input:TableFilteredUpdateApplyInput={connectionId:expected.target.connectionId,taskId:uid(),previewToken:expected.previewToken,confirmation,acknowledged:true};
    start('apply',async active=>{
      try{active.dispatched=true;committedOutput(checkTableFilteredUpdateApplied(await owner.services.apply(input),expected));}
      catch(reason){if(active.progress?.commitAcknowledged){committedOutput(tableFilteredUpdateCommitted(expected));if(mounted.current&&!closed.current)setError(text.cleanup+' '+errorMessage(reason));}else if(mounted.current&&!closed.current)setError((active.progress?.rollbackAcknowledged&&active.progress.transactionProtected&&!active.progress.commitMayHaveBeenSent?text.rolledBack:active.progress?.outcome==='not-sent'&&!active.progress.dmlMayHaveBeenSent?text.notSent:text.unknown)+' '+errorMessage(reason));}
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
    const unsubscribeTask=owner.services.subscribe(event=>{const active=operation.current;if(!active||event.taskId!==active.taskId)return;active.progress=mergeTableFilteredUpdateProgress(active.progress,event.tableFilteredUpdate,active.preview?.rows);if(mounted.current&&!closed.current)setProgress(active.progress);});
    const inspect=()=>{const dialogs=document.querySelectorAll('[role="dialog"], [role="alertdialog"]');if(dialogs.length!==1||!dialogs[0].querySelector('[data-table-filtered-update-dialog]'))owner.intent.invalidate();};const observer=typeof MutationObserver==='function'?new MutationObserver(inspect):undefined;observer?.observe(document.body,{childList:true,subtree:true});inspect();
    const timer=setInterval(()=>{if(mounted.current)setClock(Date.now());},1000);
    const block=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&(event.key==='Enter'||event.key.toLowerCase()==='s')){event.preventDefault();event.stopImmediatePropagation();}};document.addEventListener('keydown',block,true);
    return()=>{mounted.current=false;unsubscribeIntent();observer?.disconnect();clearInterval(timer);document.removeEventListener('keydown',block,true);cancel();const old=previewRef.current;previewRef.current=undefined;if(old)releases.current.set(old.target.connectionId+':'+old.previewToken,{connectionId:old.target.connectionId,previewToken:old.previewToken});const active=operation.current;void(async()=>{try{if(active){await active.promise;await active.cancel;}await drain();}finally{unsubscribeTask();}})().catch(cleanup);};
  },[]);
  const disabled=busy||closing||stale||invalid.current||consumed.current,expired=!!preview&&Date.parse(preview.expiresAt)<=clock;
  return <Modal title={text.title} wide onClose={close}><div className="modal-content" data-table-filtered-update-dialog aria-busy={busy||closing}>
    <p>{owner.intent.target.database}.{owner.intent.target.table}</p><p>{text.scope}</p><p className="warning-text">{text.transaction}</p>
    <section aria-label={text.conditions}><strong>{text.conditions}</strong>{!!owner.intent.scope.filters.length&&<ul>{owner.intent.scope.filters.map((rule,index)=><li key={index}>{rule.enabled===false?text.disabledRule:''}{filterRuleSummary(rule)}</li>)}</ul>}{!owner.intent.scope.filters.some(rule=>rule.enabled!==false)&&<p className="warning-text">{text.noConditions}</p>}{owner.intent.scope.filterGroup&&<p>{tableFilterGroupSummary(owner.intent.scope.filterGroup)}</p>}</section>
    <section aria-label={text.sorts}><strong>{text.sorts}</strong>{owner.intent.scope.sort.length?<ol>{owner.intent.scope.sort.map(rule=><li key={rule.column}>{tableSortRuleSummary(rule)}</li>)}</ol>:<p>{text.noSorts}</p>}</section>
    <p>{text.valueHint}</p>{draft.map((item,index)=>{const column=columns.find(column=>column.name===item.column),label=index===0?text.column:text.columnAt(index+1);return <fieldset key={item.id} aria-label={text.assignment(index+1)}><legend>{text.assignment(index+1)}</legend><Field label={label}><select aria-label={label} disabled={disabled} value={item.column} onChange={event=>selectColumn(item.id,event.target.value)}>{columns.map(column=><option key={column.name} value={column.name} disabled={draft.some(other=>other.id!==item.id&&other.column===column.name)}>{column.name} · {column.type}</option>)}</select></Field>{column&&<RecordValueEditor column={column} input={item.input} inserted={false} reason={disabled?stale||invalid.current?text.stale:busy?text.previewing:text.consumed:''} focus={index===0} onChange={input=>change(draft.map(other=>other.id===item.id?{...other,input}:other))}/>}<button disabled={disabled||draft.length===1} onClick={()=>remove(item.id)}>{text.remove(item.column)}</button></fieldset>;})}<button disabled={disabled||draft.length>=columns.length} onClick={add}>{text.add}</button>
    {busy&&<Spinner text={operation.current?.kind==='apply'?text.applying:operation.current?.kind==='release'?text.release:text.previewing}/>} {closing&&<p>{text.closing}</p>}{progress&&<p role="status">{text.phases[progress.phase]} · {progress.rows} / {progress.totalRows}</p>}{progress?.commitMayHaveBeenSent&&!progress.commitAcknowledged&&<p className="warning-text">{text.committing}</p>}
    {preview&&<section><p>{preview.target.database}.{preview.target.table} / {JSON.stringify(tableFilteredUpdateOutputColumns(preview))}</p><p>{text.globalValues}</p><dl aria-label={text.globalValues}>{draft.map(item=><div key={item.id}><dt>{item.column} · {text.valueMode(item.input.mode)}</dt><dd><pre>{item.input.mode==='null'?'NULL':item.input.text||text.emptyValue}</pre></dd></div>)}</dl><p>{text.sample(preview.shownRows,preview.rows)}</p>{preview.sampleOmitted&&<p>{text.omitted}</p>}<p className="warning-text">{text.timeZone(preview.timeZone)}</p>{preview.warnings.map((warning,index)=><p className="warning-text" key={index}>{warning}</p>)}<pre className="sql-preview" aria-label={text.sql}>{preview.sql}</pre>{!preview.rows&&<p>{text.empty}</p>}<p>{tableFilteredUpdateConfirmation(preview)}</p><Field label={text.confirmation}><textarea aria-label={text.confirmation} value={confirmation} disabled={disabled||expired||!preview.rows} onChange={event=>{if(editable())setConfirmation(event.target.value);}}/></Field><label><input type="checkbox" aria-label={text.acknowledge} checked={acknowledged} disabled={disabled||expired||!preview.rows} onChange={event=>{if(editable())setAcknowledged(event.target.checked);}}/>{text.acknowledge}</label></section>}
    {done&&<p className="success-box" role="status">{owner.intent.current()?text.committed(done.rows):text.committedChanged(done.rows)}</p>}<ErrorBox message={stale||invalid.current?text.stale:error||(expired&&!consumed.current?text.expired:'')}/>{consumed.current&&!done&&!busy&&<p>{text.consumed}</p>}
  </div><footer className="modal-footer"><button disabled={closing} onClick={close}>{text.close}</button><span className="grow"/>{busy&&operation.current?.taskId&&<button disabled={closing||operation.current.cancelled||!!progress?.commitMayHaveBeenSent||!!progress?.commitAcknowledged} onClick={()=>{if(committed.current===ticket)cancel();}}>{text.cancel}</button>}<button disabled={disabled||!draft.length||draft.some(item=>!columns.some(column=>column.name===item.column))} onClick={prepare}>{text.preview}</button><button className="primary" disabled={disabled||expired||!preview?.rows||confirmation!==(preview?tableFilteredUpdateConfirmation(preview):'')||!acknowledged} onClick={apply}>{text.apply}</button></footer></Modal>;
}
