import{useEffect,useRef,useState}from'react';
import{ArrowUpRight,Clock3,FileCode2,Search,Trash2}from'lucide-react';
import type{SavedQueryPage,SavedQueryPageEntry}from'../../shared/savedQueryPages';
import{zh,formatText}from'../locales/zh-CN';
import{queryContextZh}from'../locales/queryContext.zh-CN';
import{savedQueryPagesZh as t}from'../locales/savedQueryPages.zh-CN';
import{errorMessage,invoke,uid}from'../lib';
import{useWorkspace}from'../store';
import{Empty,ErrorBox,Modal,Spinner}from'./ui';
import'../savedQueryPages.css';

/** 列表只保留当前概要页；关闭及切回历史都等待当前读取和续页释放。 */
export function SavedQueriesDialog({onClose,onHistory}:{onClose():void;onHistory():void}){
 const connections=useWorkspace(state=>state.connections),[search,setSearch]=useState(''),[applied,setApplied]=useState(''),[policy,setPolicy]=useState<'stop'|'continue'>('continue'),[appliedPolicy,setAppliedPolicy]=useState(policy);
 const[reply,setReply]=useState<SavedQueryPage>(),[batch,setBatch]=useState(0),[busy,setBusy]=useState(true),[closing,setClosing]=useState(false),[error,setError]=useState(''),[targets,setTargets]=useState(new Map<string,string>());
 const cursor=useRef<string|undefined>(undefined),active=useRef<string|undefined>(undefined),pending=useRef<Promise<unknown>|undefined>(undefined),locked=useRef(false),closed=useRef(false);
 /** 释放准确句柄；迟到的新页也必须释放，不残留到另一次窗口。 */
 async function release(){const value=cursor.current;if(value){await invoke('queries.pageRelease',{cursor:value});if(cursor.current===value)cursor.current=undefined;}}
 /** 等待当前读取或显式打开/删除终态后再释放句柄，避免迟到回复打开标签。 */
 async function cleanup(){if(active.current)await invoke('query.cancel',{taskId:active.current});await pending.current?.catch(()=>{});await release();}
 /** 模态关闭和切回历史共用收尾流程，失败保留窗口供用户核对。 */
 async function close(after=onClose){if(closed.current)return;closed.current=true;setClosing(true);try{await cleanup();after();}catch(reason){closed.current=false;setClosing(false);setError(errorMessage(reason));}}
 /** 不累计上一页正文/卡片；新筛选显式从头读，空命中页仍能继续。 */
 async function load(next=false){
  if(locked.current||closed.current)return;locked.current=true;setBusy(true);setError('');const taskId=uid();
  try{const previous=cursor.current;if(!next){await release();if(closed.current)return;setReply(undefined);setBatch(0);setTargets(new Map());}else if(!previous)return;
   cursor.current=undefined;active.current=taskId;const request=next?invoke('queries.pageContinue',{taskId,cursor:previous!}):invoke('queries.page',{taskId,search,onError:policy});pending.current=request;
   const page=await request;if(pending.current===request)pending.current=undefined;if(active.current===taskId)active.current=undefined;cursor.current=page.cursor;
   if(closed.current){await release();return;}setReply(page);setBatch(value=>next?value+1:1);setApplied(search);setAppliedPolicy(policy);setTargets(new Map());
  }catch(reason){if(!closed.current)setError(errorMessage(reason));}
  finally{if(active.current===taskId)active.current=undefined;pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}
 }
 useEffect(()=>{void load();return()=>{closed.current=true;void cleanup().catch(reason=>useWorkspace.getState().notify(t.cleanupFailed+errorMessage(reason),true));};},[]);
 /** 原连接不存在时不回退当前连接或首个连接；Map也支持constructor等标识。 */
 function target(item:SavedQueryPageEntry){if(targets.has(item.query.id))return targets.get(item.query.id)!;return connections.some(value=>value.id===item.query.connectionId)?item.query.connectionId!:'';}
 /** 按当前原文摘要读取，并且只创建新标签，不执行语句或替换旧草稿。 */
 async function open(item:SavedQueryPageEntry){
  if(locked.current||closed.current)return;const connectionId=target(item);if(!connectionId){setError(t.choose);return;}locked.current=true;setBusy(true);setError('');
  try{const request=invoke('queries.read',{id:item.query.id,digest:item.digest,connectionId});pending.current=request;const result=await request;if(pending.current===request)pending.current=undefined;if(!closed.current)await close(()=>{useWorkspace.getState().openTab({id:uid(),kind:'query',title:result.query.name,connectionId:result.connectionId,database:result.database,databaseContext:result.databaseContext,sql:result.query.sql,sourceBinding:result.sourceBinding});onClose();});}
  catch(reason){if(!closed.current)setError(errorMessage(reason));}finally{pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}
 }
 /** 按所见摘要删除，成功后丢弃旧续页；失败不重放，也不移除当前卡片。 */
 async function remove(item:SavedQueryPageEntry){
  if(locked.current||closed.current)return;locked.current=true;setBusy(true);setError('');let success=false;
  try{const request=invoke('queries.deleteChecked',{id:item.query.id,digest:item.digest});pending.current=request;await request;success=true;}catch(reason){if(!closed.current)setError(errorMessage(reason));}
  finally{pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}if(success&&!closed.current)await load();
 }
 /** 默认库的已知无库、未知和遗留状态不能合并。 */
 function databaseLabel(item:SavedQueryPageEntry){const value=item.query,context=value.databaseContext;return context?context.state==='known'?context.database||queryContextZh.none:queryContextZh.unknown:value.database?value.database+' ('+queryContextZh.legacy+')':queryContextZh.legacy;}
 return <Modal title={zh.activity.text003} wide onClose={()=>void close()}><div className="dialog-tabs"><button disabled={closing} onClick={()=>void close(onHistory)}><Clock3 size={14}/>{zh.activity.text004}</button><button className="selected"><FileCode2 size={14}/>{zh.activity.text005}</button></div><div className="modal-content saved-query-pages"><div className="search-box"><Search size={15}/><input aria-label={t.search} value={search} maxLength={512} disabled={busy||closing} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void load();}}}/><button disabled={busy||closing} onClick={()=>void load()}>{t.searchButton}</button></div><label className="inline-field">{t.onError}<select aria-label={t.onError} disabled={busy||closing} value={policy} onChange={event=>setPolicy(event.target.value as typeof policy)}><option value="continue">{t.continue}</option><option value="stop">{t.stop}</option></select></label><p className="muted small">{t.hint}</p>{(search!==applied||policy!==appliedPolicy)&&<p role="status">{t.pending}</p>}<ErrorBox message={error}/>{busy&&<Spinner/>}{reply&&<p role="status">{formatText(t.summary,batch,reply.scanned,reply.matched,reply.failed)} {reply.stoppedOnError?t.failedStop:reply.cursor?t.more:t.done}</p>}<div className="history-list">{reply?.items.map(item=><article className="history-card" key={item.query.id}><div><strong>{item.query.name}</strong><span className="grow"/><span className="muted small">{connections.find(profile=>profile.id===item.query.connectionId)?.name||t.sourceMissing} / {databaseLabel(item)}</span></div><pre>{item.sqlPreview}{item.previewTruncated?'…':''}</pre>{item.previewTruncated&&<p className="muted small">{formatText(t.preview,item.sqlUnits)}</p>}<label className="inline-field">{t.choose}<select aria-label={formatText(t.connection,item.query.name)} value={target(item)} disabled={busy||closing} onChange={event=>setTargets(current=>new Map(current).set(item.query.id,event.target.value))}><option value="">{t.choose}</option>{connections.map(profile=><option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><footer><span className="muted small">{new Date(item.query.updatedAt).toLocaleString('zh-CN')}</span><span className="grow"/><button className="icon-button" disabled={busy||closing} title={zh.activity.text009} aria-label={zh.activity.text009} onClick={()=>void remove(item)}><Trash2 size={14}/></button><button disabled={busy||closing||!target(item)} onClick={()=>void open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer></article>)}{reply&&!reply.items.length&&<Empty title={t.empty} text={t.emptyHint}/>}</div>{reply?.failures.length?<details><summary>{t.failures} ({reply.failures.length})</summary>{reply.failures.map((failure,index)=><p key={index}>{failure.id}：{failure.message}</p>)}</details>:null}<p className="muted small">{t.openHint}</p></div><footer className="modal-footer"><button disabled={busy||closing} onClick={()=>void load()}>{t.refresh}</button><button disabled={busy||closing||!reply?.cursor||search!==applied||policy!==appliedPolicy} onClick={()=>void load(true)}>{t.next}</button>{busy&&<button disabled={closing||!active.current} onClick={()=>{if(active.current)void invoke('query.cancel',{taskId:active.current}).catch(reason=>setError(errorMessage(reason)));}}>{t.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={()=>void close()}>{zh.common.close}</button></footer></Modal>;
}
