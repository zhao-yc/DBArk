import {useEffect,useRef,useState} from 'react';
import {DataGrid,type Column} from 'react-data-grid';
import {structureSearchInputSchema,structureSearchKinds,definitionSearchKinds,structureSearchLimits,type StructureSearchHit,type StructureSearchPage,type StructureSearchKind} from '../../shared/databaseSearch';
import type {DatabaseSearchMode} from '../../shared/databaseSearchPattern';
import {databaseSearchZh as text} from '../locales/databaseSearch.zh-CN';
import {structureSearchContext} from '../structureSearchContext';
import {invoke,errorMessage,uid} from '../lib';
import {useWorkspace} from '../store';
import {Modal,Field,ErrorBox,Spinner, UsageHelp } from './ui';
import '../databaseSearch.css';
import type {DefinitionSearchOpen} from '../../shared/definitionNavigation';
import {DefinitionSearchConnectionLease} from '../definitionNavigation';
import {definitionNavigationZh} from '../locales/definitionNavigation.zh-CN';

/** 搜索窗口独占自己的任务和续页；不借用、关闭或刷新任何已有查询/表格标签。 */
export function StructureSearchDialog({onClose,onOpen,onData,onSavedQueries}:{onClose:()=>void;onOpen:(connectionId:string,hit:StructureSearchHit,definitionSearch?:DefinitionSearchOpen)=>void;onData?:()=>void;onSavedQueries?:()=>void}){
  const state=useWorkspace(),initial=structureSearchContext(state.selection,state.settings.tabs.find(tab=>tab.id===state.settings.activeTabId),state.connections[0]?.id??'');
  const [connectionId,setConnectionId]=useState(state.connections.some(profile=>profile.id===initial.connectionId&&profile.dialect!=='sqlite')?initial.connectionId:''),[databases,setDatabases]=useState(initial.database??'');
  const [keyword,setKeyword]=useState(''),[mode,setMode]=useState<DatabaseSearchMode>('contains'),[caseSensitive,setCaseSensitive]=useState(false);
  const [searchIn,setSearchIn]=useState<'name'|'definition'>('name');
  const [kinds,setKinds]=useState<StructureSearchKind[]>([...structureSearchKinds]),[limit,setLimit]=useState(200),[onError,setOnError]=useState<'stop'|'continue'>('stop');
  const [page,setPage]=useState<StructureSearchPage|null>(null),[hits,setHits]=useState<StructureSearchHit[]>([]),[failures,setFailures]=useState<StructureSearchPage['failures']>([]);
  const [selected,setSelected]=useState<StructureSearchHit|null>(null),[busy,setBusy]=useState(false),[closing,setClosing]=useState(false),[error,setError]=useState('');
  const cursor=useRef<{connectionId:string;value:string}|null>(null),activeTask=useRef<string|null>(null),work=useRef<Promise<void>|null>(null),stopRequested=useRef(false),closeRequested=useRef(false),cancelWork=useRef<Promise<void>|null>(null);
  const resultConnection=useRef(initial.connectionId);
  const resultLease=useRef<DefinitionSearchConnectionLease|null>(null);
  const plannedLease=useRef<DefinitionSearchConnectionLease|null>(null);
  // 同步观察连接修订ABA；卸载只取消后续使用，不让旧搜索恢复为新来源。
  useEffect(()=>{const unsubscribe=useWorkspace.subscribe(()=>{resultLease.current?.current();plannedLease.current?.current();});return()=>{unsubscribe();resultLease.current?.cancel();plannedLease.current?.cancel();};},[]);

  /** 释放小型目录位置；调用成功前保留引用，失败时仍可再次明确关闭。 */
  async function releaseCursor(){const current=cursor.current;if(!current)return;await invoke('search.release',{connectionId:current.connectionId,cursor:current.value});if(cursor.current===current)cursor.current=null;}
  /** 开始和继续共用同步锁，禁止双击发送同一续页，条件只能在新搜索时改变。 */
  function search(next=false){
    if(work.current||closeRequested.current)return;
    stopRequested.current=false;setBusy(true);setError('');
    const operation=(async()=>{
      try{
        let result:StructureSearchPage;
        if(next){
          const current=cursor.current;if(!current)throw Error('没有可继续的搜索，请重新搜索');
          if(!resultLease.current?.current()||resultLease.current.connectionId!==current.connectionId)throw Error(definitionNavigationZh.invalid);
          const taskId=uid();activeTask.current=taskId;cursor.current=null;
          result=await invoke('search.structureContinue',{connectionId:current.connectionId,taskId,cursor:current.value});
          if(result.cursor)cursor.current={connectionId:current.connectionId,value:result.cursor};
        }else{
          // 先校验全部范围，非法请求不会释放旧搜索或查询数据库。
          const parsed=structureSearchInputSchema.safeParse({connectionId,taskId:uid(),databases:databases.split(/\r?\n/).filter(value=>value.length>0),kinds,pattern:{mode,text:keyword,caseSensitive},maxResults:limit,onError,...(searchIn==='definition'?{searchIn}:{})});
          if(!parsed.success)throw Error(text.invalidRequest);const input=parsed.data;
          // 首次await前绑定修订；释放旧游标期间改过连接也不能默默在新连接上开始搜索。
          const version=useWorkspace.getState().connectionVersions[input.connectionId]??0;
          const prepared=new DefinitionSearchConnectionLease(input.connectionId,version,()=>{const workspace=useWorkspace.getState();return workspace.connections.some(profile=>profile.id===input.connectionId)?workspace.connectionVersions[input.connectionId]??0:undefined;});plannedLease.current=prepared;
          await releaseCursor();if(stopRequested.current)return;if(!prepared.current())throw Error(definitionNavigationZh.invalid);
          setHits([]);setFailures([]);setSelected(null);setPage(null);activeTask.current=input.taskId;resultConnection.current=input.connectionId;
          resultLease.current?.cancel();resultLease.current=prepared;plannedLease.current=null;
          result=await invoke('search.structure',input);
          if(result.cursor)cursor.current={connectionId:input.connectionId,value:result.cursor};
        }
        if(!resultLease.current?.current())throw Error(definitionNavigationZh.invalid);
        setPage(result);setHits(previous=>[...(next?previous:[]),...result.hits]);setFailures(previous=>[...(next?previous:[]),...result.failures]);
      }catch(reason){if(next)setPage(previous=>previous?{...previous,cursor:undefined}:previous);setError(stopRequested.current?text.cancelled:errorMessage(reason));}
      finally{plannedLease.current?.cancel();plannedLease.current=null;activeTask.current=null;setBusy(false);}
    })();
    work.current=operation;void operation.finally(()=>{if(work.current===operation)work.current=null;});
  }
  /** 取消等待引擎的真实终态，窗口不因KILL请求刚被接受就提前消失。 */
  async function cancel(){stopRequested.current=true;if(cancelWork.current)return cancelWork.current;const taskId=activeTask.current;if(!taskId)return;const operation=invoke('query.cancel',{taskId});cancelWork.current=operation;try{await operation;}finally{cancelWork.current=null;}}
  /** 关闭及跳转先等待当前批次与续页释放，清理失败时保留窗口供用户核对。 */
  async function close(open?:StructureSearchHit|'data'|'queries'){
    if(closeRequested.current)return;closeRequested.current=true;setClosing(true);setError('');
    try{await cancel();await work.current;await releaseCursor();if(open==='data')onData?.();else if(open==='queries')onSavedQueries?.();else if(open){const lease=resultLease.current;onOpen(resultConnection.current,open,open.matchedIn==='definition'&&lease?{connectionId:resultConnection.current,connectionVersion:lease.version,database:open.database,name:open.object,kind:open.parentKind,invalidated:!lease.current(),result:open.definitionNavigation}:undefined);}else onClose();}
    catch(reason){setError(errorMessage(reason));closeRequested.current=false;setClosing(false);}
  }
  const columns:Column<StructureSearchHit>[]=[{key:'database',name:text.databaseColumn,width:170},{key:'kind',name:text.kindColumn,width:100,renderCell:({row})=>text.kinds[row.kind]},{key:'object',name:text.objectColumn,width:220},{key:'name',name:searchIn==='definition'?text.definitionLocation:text.nameColumn,width:260,renderCell:({row})=>row.matchedIn==='definition'?text.definitionMatch(row.definitionCharacters??0):row.name}];
  return <Modal title={searchIn==='definition'?text.definitionsTitle:text.title} wide onClose={()=>void close()}>
    <div className="modal-content database-search-content">
      {onData&&<div><button disabled={closing} onClick={()=>void close('data')}>{text.dataMode}</button></div>}
      {onSavedQueries&&<div><button disabled={closing} onClick={()=>void close('queries')}>{text.savedQueries}</button></div>}
      <fieldset disabled={busy||closing} className="database-search-options">
        <div className="form-grid"><Field label={text.searchIn}><select aria-label={text.searchIn} value={searchIn} onChange={event=>{const value=event.target.value as 'name'|'definition';setSearchIn(value);setKinds(value==='definition'?[...definitionSearchKinds]:[...structureSearchKinds]);}}><option value="name">{text.names}</option><option value="definition">{text.definitions}</option></select></Field><Field label={text.connection}><select aria-label={text.connection} value={connectionId} onChange={event=>setConnectionId(event.target.value)}>{state.connections.filter(profile=>profile.dialect!=='sqlite').map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></Field>
          <Field label={text.databases}><textarea aria-label={text.databases} rows={2} value={databases} onChange={event=>setDatabases(event.target.value)}/></Field>
          <Field label={text.pattern}><input aria-label={text.pattern} value={keyword} onChange={event=>setKeyword(event.target.value)}/></Field>
          <Field label={text.mode}><select aria-label={text.mode} value={mode} onChange={event=>setMode(event.target.value as DatabaseSearchMode)}>{Object.entries(text.modes).map(([value,label])=><option key={value} value={value}>{value==='whole'&&searchIn==='definition'?text.wholeDefinition:label}</option>)}</select></Field>
          <Field label={text.limit}><input aria-label={text.limit} type="number" min={1} max={structureSearchLimits.maxHits} value={limit} onChange={event=>setLimit(Number(event.target.value))}/></Field>
          <Field label={text.onError}><select aria-label={text.onError} value={onError} onChange={event=>setOnError(event.target.value as 'stop'|'continue')}><option value="stop">{text.stop}</option><option value="continue">{text.continueOnError}</option></select></Field></div>
        <div className="database-search-kinds">{(searchIn==='definition'?definitionSearchKinds:structureSearchKinds).map(kind=><label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={event=>setKinds(previous=>event.target.checked?[...previous,kind]:previous.filter(value=>value!==kind))}/>{text.kinds[kind]}</label>)}<label><input type="checkbox" checked={caseSensitive} onChange={event=>setCaseSensitive(event.target.checked)}/>{text.caseSensitive}</label></div>
        <UsageHelp><p>{searchIn==='definition'?text.definitionHint:text.databaseHint}</p><p>{text.ruleHint}</p><p>{text.currentDefinition}</p></UsageHelp>
      </fieldset>
      <ErrorBox message={error}/>
      <div role="status" className="database-search-status">{busy||closing?<Spinner text={closing?text.closing:text.opening}/>:page?<><span>{text.resultConnection}：{state.connections.find(profile=>profile.id===resultConnection.current)?.name}；{text.summary(page.totalHits,page.completedScopes,page.scopeCount)}{page.scannedDefinitions!==undefined&&text.definitionCount(page.scannedDefinitions)}</span> {page.limitReached?text.capped:page.stoppedOnError?text.stopped:page.cursor?text.more:page.completedScopes<page.scopeCount?text.failed:failures.length?text.finishedWithErrors:page.scannedDefinitions!==undefined?text.definitionsDone:text.done}</>:text.emptyHint}</div>
      <DataGrid className={state.settings.theme==='dark'?'rdg-dark':'rdg-light'} columns={columns} rows={hits} rowKeyGetter={row=>JSON.stringify([row.database,row.kind,row.object,row.name])} rowClass={row=>row===selected?'database-search-selected':undefined} onCellClick={({row})=>setSelected(row)} onCellDoubleClick={({row})=>{if(!busy&&!closing)void close(row);}} onCellKeyDown={({row},event)=>{if(event.key==='Enter'&&!busy&&!closing){event.preventDefault();void close(row);}}} renderers={{noRowsFallback:<div className="database-search-empty">{text.empty}</div>}} style={{height:230}}/>
      {failures.length>0&&<details className="database-search-failures" open><summary>{text.failureCount(failures.length)}</summary>{failures.map((failure,index)=><p key={index}>{failure.database} · {text.kinds[failure.kind]}{failure.object?' · '+failure.object:''}：{failure.message}</p>)}</details>}
      {page?.cursor&&<p className="muted small">{text.expired}</p>}
    </div>
    <footer className="modal-footer"><button className="primary" disabled={busy||closing||!connectionId} onClick={()=>search()}>{text.start}</button><button disabled={busy||closing||!cursor.current||!resultLease.current?.current()} onClick={()=>search(true)}>{text.next}</button><button disabled={!busy||closing} onClick={()=>void cancel().catch(reason=>setError(errorMessage(reason)))}>{text.cancel}</button><span className="grow"/><button disabled={!selected||busy||closing} onClick={()=>selected&&void close(selected)}>{text.open}</button><button disabled={closing} onClick={()=>void close()}>{text.close}</button></footer>
  </Modal>;
}
