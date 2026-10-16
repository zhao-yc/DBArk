import {useEffect,useRef,useState} from 'react';
import type * as monaco from 'monaco-editor';
import type {SavedQueryNavigationSource} from '../../shared/savedQuerySearch';
import {SavedQueryNavigation,SavedQueryNavigationLifetime,type SavedQueryNavigationIdentity,type SavedQueryNavigationState} from '../savedQueryNavigation';
import {savedQueryNavigationZh as t} from '../locales/savedQueryNavigation.zh-CN';
import {useWorkspace} from '../store';
import '../savedQueryNavigation.css';

/** 原文仅保留当前标签内存，工作区同步订阅与模型事件共同负责及时失效。 */
export function SavedQueryMatchNavigation({tabId,source,editor}:{tabId:string;source?:SavedQueryNavigationSource;editor:monaco.editor.IStandaloneCodeEditor|null}){
 const[state,setState]=useState<SavedQueryNavigationState>(),[controller,setController]=useState<SavedQueryNavigation>();
 const lifetime=useRef(new SavedQueryNavigationLifetime());
 useEffect(()=>{
  if(!source||!editor)return;
  if(!lifetime.current.claim(tabId,source,editor.getModel())){setState(previous=>previous&&previous.status!=='ready'?previous:{status:'invalid',index:0,count:0,limitReached:false});return;}
  const current=():SavedQueryNavigationIdentity|undefined=>{const workspace=useWorkspace.getState(),tab=workspace.settings.tabs.find(tab=>tab.id===tabId);return tab?.kind==='query'&&workspace.connections.some(connection=>connection.id===tab.connectionId)?{sql:tab.sql,connectionId:tab.connectionId,connectionVersion:workspace.connectionVersions[tab.connectionId]??0,sourceBinding:tab.sourceBinding}:undefined;};
  let mounted=true;const navigation=new SavedQueryNavigation(editor,source,current,state=>{if(mounted){if(state.status!=='ready')lifetime.current.end();setState(state);}});setController(navigation);
  const unsubscribe=useWorkspace.subscribe(()=>navigation.refresh());
  return()=>{mounted=false;unsubscribe();navigation.dispose();};
 },[tabId,source,editor]);
 if(!source||!state||state.status==='closed')return null;
 return <section className="saved-query-navigation" aria-label={t.title}><span role="status">{state.status==='ready'?t.count(state.index,state.count):state.status==='unlocatable'?t.unlocatable:t.invalid}</span>{state.status==='ready'&&<><button onClick={()=>controller?.move(-1)}>{t.previous}</button><button onClick={()=>controller?.move(1)}>{t.next}</button><span className="muted small">{state.limitReached?t.capped(state.count):t.complete}</span></>}<button onClick={()=>{lifetime.current.end();controller?.dispose();setState({status:'closed',index:0,count:0,limitReached:false});}}>{t.close}</button></section>;
}
