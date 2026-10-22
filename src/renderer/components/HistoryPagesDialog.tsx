import{useEffect,useRef,useState}from'react';
import{ArrowUpRight,Clock3,FileCode2,Search,CheckCircle2,XCircle}from'lucide-react';
import type{HistoryPageInput,HistoryPage,HistoryPageEntry}from'../../shared/historyPages';
import{zh,formatText}from'../locales/zh-CN';
import{queryContextZh}from'../locales/queryContext.zh-CN';
import{historyPagesZh as t}from'../locales/historyPages.zh-CN';
import{errorMessage,invoke,uid}from'../lib';
import{useWorkspace}from'../store';
import{Empty,ErrorBox,Modal,Spinner}from'./ui';
import'../savedQueryPages.css';
import { historyInputRange } from '../historyTimeInput';
import { historyDurationInputRange, type HistoryDurationInputRange } from '../historyDurationInput';

type Filters=Omit<HistoryPageInput,'taskId'|'timeRange'|'durationRange'>;
/** 历史面板仅保留当前概要页，原文、错误全文和打开目标都需明确选择。 */
export function HistoryPagesDialog({onClose,onQueries}:{onClose():void;onQueries():void}){
 const connections=useWorkspace(state=>state.connections);
 // 时区固定于本次打开；修改系统时区或翻页不能重新解释已有草稿。
 const timeZone=useRef(Intl.DateTimeFormat().resolvedOptions().timeZone).current;
 const[timeDraft,setTimeDraft]=useState({from:'',until:''});
 const[durationDraft,setDurationDraft]=useState({minimum:'',maximum:''});
 const[filters,setFilters]=useState<Filters>({search:'',fields:['sql','error'],scope:{kind:'all'},status:'all',onError:'continue'}),[applied,setApplied]=useState('');
 const[reply,setReply]=useState<HistoryPage>(),[batch,setBatch]=useState(0),[busy,setBusy]=useState(true),[closing,setClosing]=useState(false),[error,setError]=useState(''),[targets,setTargets]=useState(new Map<string,string>()),[errorView,setErrorView]=useState<{id:string;error:string}>();
 const cursor=useRef<string|undefined>(undefined),active=useRef<string|undefined>(undefined),pending=useRef<Promise<unknown>|undefined>(undefined),locked=useRef(false),closed=useRef(false),filterKey=JSON.stringify({filters,timeDraft,timeZone,durationDraft});
 /** 失败不抹掉句柄，用户可以重试收尾；成功才删除准确的当前句柄。 */
 async function release(){const value=cursor.current;if(value){await invoke('history.pageRelease',{cursor:value});if(cursor.current===value)cursor.current=undefined;}}
 /** 等真正任务终态再释放续页，不能在迟到响应中重新打开已关闭的窗口。 */
 async function cleanup(){if(active.current)await invoke('query.cancel',{taskId:active.current});await pending.current?.catch(()=>{});await release();}
 /** 关闭、切换查询库和打开新标签共用同一收尾路径。 */
 async function close(after=onClose){if(closed.current)return;closed.current=true;setClosing(true);try{await cleanup();after();}catch(reason){closed.current=false;setClosing(false);setError(errorMessage(reason));}}
 /** 明确搜索或续读一批；不累计卡片、原文或失败明细。 */
 async function load(next=false){
  if(locked.current||closed.current)return;if(next&&filterKey!==applied){setError(t.pending);return;}if(!filters.fields.length){setError(t.fieldsRequired);return;}
  // 所有草稿先完整校验；非法耗时不释放旧游标、不抹页，也不发出搜索请求。
  let timeRange:HistoryPageInput['timeRange'],durationRange:HistoryDurationInputRange|undefined;try{if(!next){timeRange=historyInputRange(timeDraft.from,timeDraft.until,timeZone);durationRange=historyDurationInputRange(durationDraft.minimum,durationDraft.maximum);}}catch(reason){setError(errorMessage(reason));return;}locked.current=true;setBusy(true);setError('');const taskId=uid();
  try{const previous=cursor.current;if(!next){await release();if(closed.current)return;setReply(undefined);setBatch(0);setTargets(new Map());}else if(!previous)return;
   cursor.current=undefined;active.current=taskId;setErrorView(undefined);const request=next?invoke('history.pageContinue',{taskId,cursor:previous!}):invoke('history.page',{taskId,...filters,...(timeRange?{timeRange}:{}),...(durationRange?{durationRange}:{})});pending.current=request;
   const page=await request;if(pending.current===request)pending.current=undefined;if(active.current===taskId)active.current=undefined;cursor.current=page.cursor;
   if(closed.current){await release();return;}setReply(page);setBatch(value=>next?value+1:1);setApplied(filterKey);setTargets(new Map());
  }catch(reason){if(!closed.current)setError(errorMessage(reason));}
  finally{if(active.current===taskId)active.current=undefined;pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}
 }
 useEffect(()=>{void load();return()=>{closed.current=true;void cleanup().catch(reason=>useWorkspace.getState().notify(t.cleanupFailed+errorMessage(reason),true));};},[]);
 /** 来源失效不能回退当前选择或首个连接；替代选择仅保留本批窗口内。 */
 function target(item:HistoryPageEntry){if(targets.has(item.entry.id))return targets.get(item.entry.id)!;return connections.some(value=>value.id===item.entry.connectionId)?item.entry.connectionId!:'';}
 /** 按原文摘要重新读取后新建随机标识标签，原查询、事务和结果不被替换。 */
 async function open(item:HistoryPageEntry){
  if(locked.current||closed.current)return;const connectionId=target(item);if(!connectionId){setError(t.choose);return;}locked.current=true;setBusy(true);setError('');
  try{const request=invoke('history.read',{id:item.entry.id,digest:item.digest,connectionId});pending.current=request;const result=await request;if(pending.current===request)pending.current=undefined;if(!closed.current)await close(()=>{useWorkspace.getState().openTab({id:uid(),kind:'query',title:zh.activity.text002,connectionId:result.connectionId,database:result.database,databaseContext:result.databaseContext,sql:result.entry.sql});onClose();});}
  catch(reason){if(!closed.current)setError(errorMessage(reason));}finally{pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}
 }
 /** 错误全文单条按需读取，页内预览不会把长错误和长SQL全部挂进DOM。 */
 async function showError(item:HistoryPageEntry){
  if(locked.current||closed.current)return;locked.current=true;setBusy(true);setError('');
  try{const request=invoke('history.readError',{id:item.entry.id,digest:item.digest});pending.current=request;const result=await request;if(!closed.current)setErrorView({id:item.entry.id,error:result.error});}
  catch(reason){if(!closed.current)setError(errorMessage(reason));}finally{pending.current=undefined;locked.current=false;if(!closed.current)setBusy(false);}
 }
 /** 已知有库、无库、未知和遗留记录按原执行上下文分别显示。 */
 function databaseLabel(item:HistoryPageEntry){const value=item.entry,context=value.databaseContext;return context?context.state==='known'?context.database||queryContextZh.none:queryContextZh.unknown:value.database?value.database+' ('+queryContextZh.legacy+')':queryContextZh.legacy;}
 return <Modal title={zh.activity.text003} wide onClose={()=>void close()}><div className="dialog-tabs"><button className="selected"><Clock3 size={14}/>{zh.activity.text004}</button><button disabled={closing} onClick={()=>void close(onQueries)}><FileCode2 size={14}/>{zh.activity.text005}</button></div><div className="modal-content saved-query-pages history-pages">
  <div className="search-box"><Search size={15}/><input aria-label={t.search} value={filters.search} maxLength={512} disabled={busy||closing} onChange={event=>setFilters({...filters,search:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void load();}}}/><button disabled={busy||closing} onClick={()=>void load()}>{t.searchButton}</button></div>
  <div className="inline-field" role="group" aria-label={t.fields}>{(['sql','error']as const).map(field=><label key={field}><input type="checkbox" checked={filters.fields.includes(field)} disabled={busy||closing} onChange={event=>setFilters({...filters,fields:(['sql','error']as const).filter(value=>value===field?event.target.checked:filters.fields.includes(value))})}/>{field==='sql'?t.sql:t.error}</label>)}</div>
  <label className="inline-field">{t.scope}<select aria-label={t.scope} disabled={busy||closing} value={filters.scope.kind==='connection'?'connection:'+filters.scope.connectionId:filters.scope.kind} onChange={event=>setFilters({...filters,scope:event.target.value.startsWith('connection:')?{kind:'connection',connectionId:event.target.value.slice(11)}:{kind:event.target.value as'all'|'unbound'}})}><option value="all">{t.all}</option><option value="unbound">{t.unbound}</option>{connections.map(profile=><option value={'connection:'+profile.id} key={profile.id}>{profile.name}</option>)}</select></label>
  <label className="inline-field">{t.status}<select aria-label={t.status} disabled={busy||closing} value={filters.status} onChange={event=>setFilters({...filters,status:event.target.value as Filters['status']})}><option value="all">{t.allStatus}</option><option value="success">{t.success}</option><option value="failed">{t.failed}</option></select></label>
  <label className="inline-field">{t.onError}<select aria-label={t.onError} disabled={busy||closing} value={filters.onError} onChange={event=>setFilters({...filters,onError:event.target.value as Filters['onError']})}><option value="continue">{t.continue}</option><option value="stop">{t.stop}</option></select></label>
  <div className="history-time-range" role="group" aria-label={t.timeRange}><label>{t.from}<input type="text" aria-label={t.from} placeholder="YYYY-MM-DD HH:mm:ss" value={timeDraft.from} maxLength={40} disabled={busy||closing} autoComplete="off" onChange={event=>setTimeDraft({...timeDraft,from:event.target.value})}/></label><label>{t.until}<input type="text" aria-label={t.until} placeholder="YYYY-MM-DD HH:mm:ss" value={timeDraft.until} maxLength={40} disabled={busy||closing} autoComplete="off" onChange={event=>setTimeDraft({...timeDraft,until:event.target.value})}/></label><button disabled={busy||closing||(!timeDraft.from&&!timeDraft.until)} onClick={()=>setTimeDraft({from:'',until:''})}>{t.clearTime}</button></div>
  <p className="muted small">{t.timeZone}：{timeZone||t.unknownZone}。{t.timeHint}</p>
  <div className="history-time-range" role="group" aria-label={t.durationRange}><label>{t.minDuration}<input type="text" inputMode="numeric" aria-label={t.minDuration} value={durationDraft.minimum} maxLength={64} disabled={busy||closing} autoComplete="off" onChange={event=>setDurationDraft({...durationDraft,minimum:event.target.value})}/></label><label>{t.maxDuration}<input type="text" inputMode="numeric" aria-label={t.maxDuration} value={durationDraft.maximum} maxLength={64} disabled={busy||closing} autoComplete="off" onChange={event=>setDurationDraft({...durationDraft,maximum:event.target.value})}/></label><button disabled={busy||closing||(!durationDraft.minimum&&!durationDraft.maximum)} onClick={()=>setDurationDraft({minimum:'',maximum:''})}>{t.clearDuration}</button></div>
  <p className="muted small">{t.durationHint}</p>
  <p className="muted small">{t.hint}</p>{applied&&filterKey!==applied&&<p role="status">{t.pending}</p>}<ErrorBox message={error}/>{busy&&<Spinner/>}{reply&&<p role="status">{formatText(t.summary,batch,reply.scanned,reply.matched,reply.failed)} {reply.stoppedOnError?t.failedStop:reply.cursor?t.more:t.done}</p>}
  <div className="history-list">{reply?.items.map(item=><article className="history-card" data-history-id={item.entry.id} key={item.entry.id}><div><strong>{new Date(item.entry.startedAt).toLocaleString('zh-CN',timeZone?{timeZone}:undefined)}</strong><span className="grow"/>{item.entry.success?<CheckCircle2 size={14} className="accent-text"/>:<XCircle size={14} className="danger"/>}<span className="muted small">{connections.find(profile=>profile.id===item.entry.connectionId)?.name||t.sourceMissing} / {databaseLabel(item)}</span></div><pre>{item.sqlPreview}{item.previewTruncated?'…':''}</pre>{item.previewTruncated&&<p className="muted small">{formatText(t.preview,item.sqlUnits)}</p>}{item.errorPreview!==undefined&&<div className="history-error"><p className="danger small">{t.errorPreview}：{item.errorPreview}{item.errorTruncated?'…':''}</p><button disabled={busy||closing} onClick={()=>void showError(item)}>{t.errorFull}</button>{errorView?.id===item.entry.id&&<section aria-label={t.errorTitle}><p className="muted small">{formatText(t.errorSize,item.errorUnits)}</p><pre>{errorView.error}</pre><button onClick={()=>setErrorView(undefined)}>{t.errorClose}</button></section>}</div>}<label className="inline-field">{t.choose}<select aria-label={formatText(t.connection,item.entry.id)} value={target(item)} disabled={busy||closing} onChange={event=>setTargets(current=>new Map(current).set(item.entry.id,event.target.value))}><option value="">{t.choose}</option>{connections.map(profile=><option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><footer><span className="muted small">{formatText(zh.activity.text008,item.entry.elapsedMs)}</span><span className="grow"/><button disabled={busy||closing||!target(item)} onClick={()=>void open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer></article>)}{reply&&!reply.items.length&&<Empty title={t.empty} text={t.emptyHint}/>}</div>
  {reply?.failures.length?<details><summary>{t.failures} ({reply.failures.length})</summary>{reply.failures.map((failure,index)=><p key={index}>{failure.id}：{failure.message}</p>)}</details>:null}<p className="muted small">{t.openHint}</p>
 </div><footer className="modal-footer"><button disabled={busy||closing} onClick={()=>void load()}>{t.refresh}</button><button disabled={busy||closing||!reply?.cursor||filterKey!==applied} onClick={()=>void load(true)}>{t.next}</button>{busy&&<button disabled={closing||!active.current} onClick={()=>{if(active.current)void invoke('query.cancel',{taskId:active.current}).catch(reason=>setError(errorMessage(reason)));}}>{t.cancel}</button>}<span className="grow"/><button disabled={closing} onClick={()=>void close()}>{zh.common.close}</button></footer></Modal>;
}
