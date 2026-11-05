import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTableEditPreviewInput } from '../../shared/sqliteTableEdit';
import { parseSqliteTableDraft, sqliteDraftChanges, type SqliteTableDraftDocument, type SqliteDraftRestored } from '../../shared/sqliteTableDraft';
import { assertSqliteDraftRestored } from '../sqliteDraftRestored';
import { invoke, errorMessage, uid } from '../lib';
import { sqliteTableDraftZh as text } from '../locales/sqliteTableDraft.zh-CN';
import { Modal, ErrorBox, Spinner } from './ui';
export interface SqliteDraftDialogServices {
  save(source: SqliteTableEditPreviewInput, activeSnapshotId?: string): Promise<{name:string}|null>;
  open(target:SqliteTableDraftDocument['target']):Promise<{name:string;document:SqliteTableDraftDocument}|null>;
  restore(document:SqliteTableDraftDocument,taskId:string):Promise<SqliteDraftRestored>;
  cancel(taskId:string):Promise<unknown>; release(snapshotId:string):Promise<unknown>;
}
const defaults:SqliteDraftDialogServices={save:(source,activeSnapshotId)=>invoke('sqliteDraftFiles.save',{source,...(activeSnapshotId?{activeSnapshotId}:{})}),open:target=>invoke('sqliteDraftFiles.open',{target}),restore:(document,taskId)=>invoke('sqliteDraftFiles.restore',{...document.target,taskId,document}),cancel:taskId=>invoke('query.cancel',{taskId}),release:snapshotId=>invoke('sqlite.tableEdit.release',{snapshotId})};
interface Props { ticket:object; mode:'save'|'restore';target:SqliteTableDraftDocument['target'];source?:SqliteTableEditPreviewInput;activeSnapshotId?:string;assertCurrent():void;onBusy(value:boolean):void;onRestore(value:SqliteDraftRestored):void;onClose():void;services?:SqliteDraftDialogServices; }
/** 选择、核验及清理使用同一原始操作；取消ACK不提前释放父页占用，旧回包不得创建新草稿。 */
export function SqliteTableDraftDialog(props:Props){
 const owner=useRef({...props,services:props.services??defaults}).current,mounted=useRef(false),invalid=useRef(false),closed=useRef(false),committed=useRef<object|undefined>(undefined),operation=useRef<{taskId?:string;cancelled:boolean;cancel?:Promise<unknown>}|undefined>(undefined);
 const[view,setView]=useState<{ack:boolean;file?:{name:string;document:SqliteTableDraftDocument};saved?:string;error?:string;message?:string}>({ack:false}),live=useRef(view);live.current=view;const[busy,setBusy]=useState(false),render={};
 if(owner.ticket!==props.ticket||owner.mode!==props.mode||owner.source!==props.source||owner.activeSnapshotId!==props.activeSnapshotId||owner.target.connectionId!==props.target.connectionId||owner.target.database!==props.target.database||owner.target.table!==props.target.table||(props.services??defaults)!==owner.services)invalid.current=true;
 /** 来源失效永久保留，不因之后切回同名标签或配置而复活旧确认。 */
 function check():void{if(!mounted.current||closed.current||invalid.current)throw Error(text.stale);try{owner.assertCurrent();}catch(reason){invalid.current=true;throw reason;}}
 function replace(next:typeof view):void{live.current=next;if(mounted.current&&!closed.current)setView(next);}
 function ready():boolean{if(operation.current||committed.current!==render||live.current!==view||closed.current)return false;try{check();return true;}catch(reason){replace({...live.current,error:errorMessage(reason)});return false;}}
 /** 取消只投递准确核验任务，后续仍等待原Promise和取消Promise。 */
 function cancel():void{const active=operation.current;if(!active?.taskId||active.cancelled)return;active.cancelled=true;replace({...live.current,message:text.cancelling});active.cancel=Promise.resolve().then(()=>owner.services.cancel(active.taskId!)).catch(reason=>{replace({...live.current,error:errorMessage(reason)});});}
 /** 一个同步锁覆盖选择器、文件IO、核验及准确新快照清理，禁止同步重入和迟到恢复。 */
 function start(kind:'save'|'open'|'restore'):void{
  if(!ready()||kind!=='open'&&!view.ack||kind==='save'&&view.saved||kind==='restore'&&!view.file)return;
  const active={cancelled:false,...(kind==='restore'?{taskId:uid()}: {})} as NonNullable<typeof operation.current>;operation.current=active;setBusy(true);
  let published=false,restored:SqliteDraftRestored|undefined;
  void Promise.resolve().then(async()=>{
   owner.onBusy(true);check();
   if(kind==='save'){
    if(!owner.source)throw Error(text.invalid);const result=await (owner.activeSnapshotId?owner.services.save(owner.source,owner.activeSnapshotId):owner.services.save(owner.source));
    if(result){if(typeof result.name!=='string'||!result.name||result.name.length>1024)throw Error(text.invalid);let current=true;try{check();}catch{current=false;}replace({...live.current,saved:result.name,error:undefined,message:current?text.saved:text.savedStale});}else check();return;
   }
   if(kind==='open'){replace({ack:false});const result=await owner.services.open(owner.target);check();if(!result)return;const document=parseSqliteTableDraft(result.document);if(!result.name||result.name.length>1024||document.target.connectionId!==owner.target.connectionId||document.target.database!==owner.target.database||document.target.table!==owner.target.table)throw Error(text.invalid);replace({ack:false,file:{name:result.name,document}});return;}
   const selected=live.current.file!;restored=await owner.services.restore(selected.document,active.taskId!);check();if(active.cancelled)return;
   assertSqliteDraftRestored(restored,selected.document,active.taskId!);
   if(live.current.file!==selected||!live.current.ack)throw Error(text.invalid);
   check();owner.onRestore(restored);published=true;
  }).catch(reason=>{replace({...live.current,error:errorMessage(reason)});}).finally(async()=>{
   if(restored&&!published){const ids=new Set([restored,...(restored.additionalPages??[])].flatMap(item=>item.page?.edit?.kind==='editable'?[item.page.edit.snapshotId]:[]));await Promise.all([...ids].map(async id=>{try{await owner.services.release(id);}catch(reason){replace({...live.current,error:errorMessage(reason)});}}));}
   if(active.cancel)await active.cancel;
   if(active.cancelled)replace({ack:false,message:text.cancelled});if(operation.current===active)operation.current=undefined;
   try{owner.onBusy(false);}catch(reason){replace({...live.current,error:errorMessage(reason)});}if(mounted.current)setBusy(false);
   if(published&&mounted.current&&!closed.current){closed.current=true;owner.onClose();}
  });
 }
 function close():void{if(!mounted.current||closed.current||operation.current||committed.current!==render)return;closed.current=true;owner.onClose();}
 useLayoutEffect(()=>{mounted.current=true;committed.current=render;return()=>{if(committed.current===render)committed.current=undefined;};});
 useEffect(()=>{mounted.current=true;const block=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&(event.key==='Enter'||event.key.toLowerCase()==='s')){event.preventDefault();event.stopImmediatePropagation();}};document.addEventListener('keydown',block,true);return()=>{mounted.current=false;cancel();document.removeEventListener('keydown',block,true);};},[]);
 const counts={insert:0,update:0,delete:0};for(const change of view.file?.document.changes??[])counts[change.kind]++;
 return <Modal title={owner.mode==='save'?text.saveTitle:text.restoreTitle} onClose={close}><div className="dialog-body" data-sqlite-draft-file><p>{owner.target.database}.{owner.target.table}</p><p className="warning-text">{text.warning}</p><p>{owner.mode==='save'?text.scope:text.restoreScope}</p>{owner.mode==='restore'&&<><button disabled={busy||invalid.current} onClick={()=>start('open')}>{view.file?text.chooseAgain:text.choose}</button>{view.file?<p>{view.file.name} · {text.counts(counts.insert,counts.update,counts.delete)}{view.file.document.workspace&&" · "+text.groups(view.file.document.workspace.pages.length)}</p>:<p>{text.noFile}</p>}</>}<label><input type="checkbox" aria-label={owner.mode==='save'?text.saveAck:text.restoreAck} checked={view.ack} disabled={busy||invalid.current||!!view.saved||owner.mode==='restore'&&!view.file} onChange={event=>{if(ready())replace({...view,ack:event.target.checked});}}/>{owner.mode==='save'?text.saveAck:text.restoreAck}</label>{busy&&<Spinner text={text.busy}/>}<ErrorBox message={view.error}/>{view.message&&<p role="status">{view.message}</p>}{view.saved&&<p>{view.saved}</p>}</div><footer><button disabled={busy} onClick={close}>{text.close}</button>{operation.current?.taskId&&<button disabled={operation.current.cancelled} onClick={cancel}>{text.cancel}</button>}<button className="primary" disabled={busy||invalid.current||!view.ack||!!view.saved||owner.mode==='restore'&&!view.file} onClick={()=>start(owner.mode)}>{owner.mode==='save'?text.saveAction:text.restoreAction}</button></footer></Modal>;
}
