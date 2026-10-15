import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, FileCode2, Search, XCircle } from 'lucide-react';
import type { HistoryEntry } from '../../shared/contracts';
import {queryContextZh} from '../locales/queryContext.zh-CN';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { Empty, ErrorBox, Modal, Spinner } from './ui';
import{SavedQueriesDialog}from'./SavedQueriesDialog';

/** 历史记录沿用既有上限；保存查询切换到独立有界概要列表，均不自动执行SQL。 */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const[section,setSection]=useState<'history'|'queries'>('history'),[history,setHistory]=useState<HistoryEntry[]>([]);
  const[busy,setBusy]=useState(true),[error,setError]=useState(''),[search,setSearch]=useState('');const connections=useWorkspace(state=>state.connections);
  useEffect(()=>{let mounted=true;void invoke('history.list',{}).then(value=>{if(mounted)setHistory(value);}).catch(reason=>{if(mounted)setError(errorMessage(reason));}).finally(()=>{if(mounted)setBusy(false);});return()=>{mounted=false;};},[]);
  /** 历史恢复保持原来的入口语义；保存查询的来源选择另由分页面板严格核对。 */
  function open(item:HistoryEntry){const connectionId=item.connectionId||useWorkspace.getState().selection?.connectionId||connections[0]?.id;if(!connectionId){setError(zh.activity.text001);return;}useWorkspace.getState().openTab({kind:'query',title:zh.activity.text002,connectionId,database:item.database,databaseContext:item.databaseContext,sql:item.sql});onClose();}
  /** 显示历史执行开始时的默认库，不把旧记录当作已核实上下文。 */
  function databaseLabel(item:HistoryEntry){const context=item.databaseContext;return context?context.state==='known'?context.database||queryContextZh.none:queryContextZh.unknown:item.database?item.database+' ('+queryContextZh.legacy+')':queryContextZh.legacy;}
  if(section==='queries')return <SavedQueriesDialog onClose={onClose} onHistory={()=>setSection('history')}/>;
  const items=history.filter(item=>item.sql.toLowerCase().includes(search.toLowerCase()));
  return <Modal title={zh.activity.text003} wide onClose={onClose}><div className="dialog-tabs"><button className="selected"><Clock3 size={14}/>{zh.activity.text004}</button><button onClick={()=>setSection('queries')}><FileCode2 size={14}/>{zh.activity.text005}</button></div><div className="modal-content"><div className="search-box"><Search size={15}/><input value={search} aria-label={zh.activity.text006} onChange={event=>setSearch(event.target.value)} placeholder={zh.activity.text007}/></div><ErrorBox message={error}/>{busy?<Spinner/>:<div className="history-list">{items.map(item=><article className="history-card" key={item.id}><div><strong>{new Date(item.startedAt).toLocaleString('zh-CN')}</strong><span className="grow"/>{item.success?<CheckCircle2 size={14} className="accent-text"/>:<XCircle size={14} className="danger"/>}<span className="muted small">{connections.find(profile=>profile.id===item.connectionId)?.name} / {databaseLabel(item)}</span></div><pre>{item.sql}</pre>{item.error&&<p className="danger small">{item.error}</p>}<footer><span className="muted small">{formatText(zh.activity.text008,item.elapsedMs)}</span><span className="grow"/><button onClick={()=>open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer></article>)}{!items.length&&<Empty title={zh.activity.text011} text={zh.activity.text013}/>}</div>}</div></Modal>;
}

/** 任务面板订阅统一状态存储，取消按钮只针对仍在运行的任务编号。 */
export function TasksDialog({ onClose }: { onClose: () => void }) {
  const tasks = useWorkspace(state => state.tasks); const [error, setError] = useState('');
  return <Modal title={zh.common.taskCenter} onClose={onClose}><div className="modal-content"><ErrorBox message={error}/><div className="tasks-list">{tasks.map(task => <article className="task-card" key={task.id}><div><strong>{task.kind}</strong><span className="grow"/><span className={`task-state ${task.status}`}>{{ running: zh.activity.text014, completed: zh.activity.text015, cancelled: zh.activity.text016, failed: zh.activity.text017 }[task.status]}</span></div><p>{task.message}</p><progress max="100" value={task.progress}/><footer><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span><span className="grow"/>{task.status === 'running' && <button onClick={() => void invoke('query.cancel', { taskId: task.id }).catch(reason => setError(errorMessage(reason)))}>{zh.activity.text018}</button>}</footer>{task.errors?.length ? <pre>{task.errors.join('\n')}</pre> : null}</article>)}{!tasks.length && <Empty title={zh.activity.text019} text={zh.activity.text020}/>}</div></div></Modal>;
}
