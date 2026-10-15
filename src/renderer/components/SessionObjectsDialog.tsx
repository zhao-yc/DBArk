import {useEffect,useRef,useState} from 'react';
import type {SessionObjectSnapshot,SessionObjectReadResult} from '../../shared/sessionObjects';
import type {CompletionMetadataEntry} from '../../shared/sqlCompletion';
import {invoke,errorMessage,uid} from '../lib';
import {sessionObjectsZh as text} from '../locales/sessionObjects.zh-CN';
import {zh} from '../locales/zh-CN';
import {Modal,Field,ErrorBox,Empty,Spinner} from './ui';
import {ResultsGrid} from './ResultsGrid';

/** 名称与结构都来自本查询会话；字段预览不提供独立连接的表编辑入口。 */
export function SessionObjectsDialog({sessionId,database:initialDatabase,busy,onRead,onClose}:{sessionId:string;database?:string;busy:boolean;onRead:(input:{database:string;table:string;taskId:string})=>Promise<SessionObjectReadResult>;onClose:()=>void}){
  const[database,setDatabase]=useState(initialDatabase??''),[table,setTable]=useState(''),[prefix,setPrefix]=useState(''),[snapshot,setSnapshot]=useState<SessionObjectSnapshot>(),[columns,setColumns]=useState<CompletionMetadataEntry[]>([]),[incomplete,setIncomplete]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[reading,setReading]=useState(false),[version,setVersion]=useState(0);
  const active=useRef(''),readingRef=useRef(false),alive=useRef(true),currentSession=useRef(sessionId);currentSession.current=sessionId;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let valid=true;setSnapshot(undefined);setColumns([]);if(!sessionId){setError(text.closed);return;}
    void invoke('query.temporaryState',{sessionId}).then(value=>{if(valid)setSnapshot(value);}).catch(reason=>{if(valid)setError(errorMessage(reason));});return()=>{valid=false;};
  },[sessionId,version]);
  useEffect(()=>{let valid=true;setColumns([]);setIncomplete(false);if(!sessionId||!database||!table||reading)return;
    void invoke('query.temporaryCompletion',{sessionId,kind:'columns',database,table,prefix}).then(value=>{if(valid){setColumns(value.entries);setIncomplete(value.incomplete);}}).catch(reason=>{if(valid)setError(errorMessage(reason));});return()=>{valid=false;};
  },[sessionId,database,table,prefix,version,reading]);
  /** 双击只发一次，完成后再读取快照；关闭或会话变化后不写回旧界面。 */
  async function read(){if(readingRef.current||busy)return;readingRef.current=true;setReading(true);setError('');setMessage('');active.current=uid();
    try{const value=await onRead({database,table,taskId:active.current});if(alive.current&&currentSession.current===sessionId){setMessage(value.temporary?text.readDone:text.notTemporary);setVersion(value=>value+1);}}
    catch(reason){if(alive.current&&currentSession.current===sessionId)setError(errorMessage(reason));}
    finally{readingRef.current=false;active.current='';if(alive.current)setReading(false);}
  }
  /** 取消等待真实任务终态，界面不提前释放会话或清除读取标识。 */
  async function cancel(){try{if(active.current)await invoke('query.cancel',{taskId:active.current});}catch(reason){setError(errorMessage(reason));}}
  /** 关闭不销毁仍在运行的读取，取消和退出复用统一生命周期。 */
  function close(){if(readingRef.current){setError(text.closeBusy);return;}onClose();}
  return <Modal title={text.title} wide onClose={close}><div className="modal-content"><p className="muted small">{text.hint}</p><ErrorBox message={error}/>{message&&<p className="success-box">{message}</p>}{snapshot?.uncertain&&<p className="warning-text">{text.uncertain}</p>}<div className="form-grid"><Field label={text.observed} full><select disabled={reading||busy} value="" onChange={event=>{if(!event.target.value)return;const value=JSON.parse(event.target.value)as{database:string;name:string};setDatabase(value.database);setTable(value.name);setPrefix('');setError('');setMessage('');}}><option value="">{text.choose}</option>{snapshot?.objects.map(object=><option key={JSON.stringify([object.database,object.name])} value={JSON.stringify({database:object.database,name:object.name})}>{object.database}.{object.name} · {object.known?object.complete?text.known:text.partial:text.unknown}</option>)}</select></Field><Field label={text.database}><input value={database} maxLength={64} disabled={reading||busy} onChange={event=>{setDatabase(event.target.value);setError('');setMessage('');}}/></Field><Field label={text.table}><input value={table} maxLength={64} disabled={reading||busy} onChange={event=>{setTable(event.target.value);setError('');setMessage('');}}/></Field><Field label={text.filter} full><input value={prefix} maxLength={64} disabled={reading} onChange={event=>{setPrefix(event.target.value);setError('');}}/></Field></div>{reading?<Spinner text={text.read}/>:columns.length?<div style={{height:280}}><ResultsGrid columns={[{key:'name',name:text.field,type:'文本'},{key:'type',name:text.type,type:'文本'},{key:'visible',name:text.visible,type:'文本'}]} rows={columns.map(column=>({name:column.name,type:column.dataType??'',visible:column.visible===false?text.no:text.yes}))}/></div>:<Empty title={table?text.noColumns:text.empty} text={text.emptyHint}/ >}{incomplete&&<p className="muted small">{text.limited}</p>}</div><footer className="modal-footer"><button disabled={reading||busy||!sessionId} onClick={()=>{setError('');setVersion(value=>value+1);}}>{text.refresh}</button><span className="grow"/>{reading&&<button onClick={()=>void cancel()}>{text.cancel}</button>}<button disabled={reading||busy||!sessionId||!database||!table} className="primary" onClick={()=>void read()}>{text.read}</button><button disabled={reading} onClick={close}>{zh.common.close}</button></footer></Modal>;
}
