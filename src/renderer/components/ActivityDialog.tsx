import { zh, formatText } from '../locales/zh-CN';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Clock3, FileCode2, Search, Trash2, XCircle } from 'lucide-react';
import type { HistoryEntry, SavedQuery } from '../../shared/contracts';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { Empty, ErrorBox, Modal, Spinner } from './ui';

/** 历史记录与已保存查询仅用于回看，打开记录不会立即执行 SQL。 */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<'history' | 'queries'>('history'); const [history, setHistory] = useState<HistoryEntry[]>([]); const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [search, setSearch] = useState(''); const connections = useWorkspace(state => state.connections);
  useEffect(() => { void Promise.all([invoke('history.list', {}), invoke('queries.list', {})]).then(([history, queries]) => { setHistory(history); setQueries(queries); }).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false)); }, []);
  /** 优先恢复记录的原连接；缺少来源时使用用户当前选择的新查询上下文。 */
  function open(item: HistoryEntry | SavedQuery) {
    const connectionId = item.connectionId || useWorkspace.getState().selection?.connectionId || connections[0]?.id;
    if (!connectionId) { setError(zh.activity.text001); return; }
    useWorkspace.getState().openTab({ kind: 'query', title: 'name' in item ? item.name : zh.activity.text002, connectionId, database: item.database, sql: item.sql }); onClose();
  }
  /** 仅删除本地保存的查询，数据库及执行历史不受影响。 */
  async function remove(id: string) { try { await invoke('queries.delete', { id }); setQueries(current => current.filter(item => item.id !== id)); } catch (reason) { setError(errorMessage(reason)); } }
  const items = (section === 'history' ? history : queries).filter(item => `${'name' in item ? item.name : ''} ${item.sql}`.toLowerCase().includes(search.toLowerCase()));
  return <Modal title={zh.activity.text003} wide onClose={onClose}><div className="dialog-tabs"><button className={section === 'history' ? 'selected' : ''} onClick={() => setSection('history')}><Clock3 size={14}/>{zh.activity.text004}</button><button className={section === 'queries' ? 'selected' : ''} onClick={() => setSection('queries')}><FileCode2 size={14}/>{zh.activity.text005}</button></div><div className="modal-content"><div className="search-box"><Search size={15}/><input value={search} aria-label={zh.activity.text006} onChange={event => setSearch(event.target.value)} placeholder={zh.activity.text007}/></div><ErrorBox message={error}/>{busy ? <Spinner/> : <div className="history-list">{items.map(item => <article className="history-card" key={item.id}><div><strong>{'name' in item ? item.name : new Date(item.startedAt).toLocaleString('zh-CN')}</strong><span className="grow"/>{'success' in item && (item.success ? <CheckCircle2 size={14} className="accent-text"/> : <XCircle size={14} className="danger"/>)}<span className="muted small">{connections.find(profile => profile.id === item.connectionId)?.name} {item.database ? `/ ${item.database}` : ''}</span></div><pre>{item.sql}</pre>{'error' in item && item.error && <p className="danger small">{item.error}</p>}<footer><span className="muted small">{'elapsedMs' in item ? formatText(zh.activity.text008, item.elapsedMs) : new Date(item.updatedAt).toLocaleString('zh-CN')}</span><span className="grow"/>{'name' in item && <button className="icon-button" title={zh.activity.text009} onClick={() => void remove(item.id)}><Trash2 size={14}/></button>}<button onClick={() => open(item)}>{zh.activity.text010}<ArrowUpRight size={14}/></button></footer></article>)}{!items.length && <Empty title={section === 'history' ? zh.activity.text011 : zh.activity.text012} text={zh.activity.text013}/>}</div>}</div></Modal>;
}

/** 任务面板订阅统一状态存储，取消按钮只针对仍在运行的任务编号。 */
export function TasksDialog({ onClose }: { onClose: () => void }) {
  const tasks = useWorkspace(state => state.tasks); const [error, setError] = useState('');
  return <Modal title={zh.common.taskCenter} onClose={onClose}><div className="modal-content"><ErrorBox message={error}/><div className="tasks-list">{tasks.map(task => <article className="task-card" key={task.id}><div><strong>{task.kind}</strong><span className="grow"/><span className={`task-state ${task.status}`}>{{ running: zh.activity.text014, completed: zh.activity.text015, cancelled: zh.activity.text016, failed: zh.activity.text017 }[task.status]}</span></div><p>{task.message}</p><progress max="100" value={task.progress}/><footer><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span><span className="grow"/>{task.status === 'running' && <button onClick={() => void invoke('query.cancel', { taskId: task.id }).catch(reason => setError(errorMessage(reason)))}>{zh.activity.text018}</button>}</footer>{task.errors?.length ? <pre>{task.errors.join('\n')}</pre> : null}</article>)}{!tasks.length && <Empty title={zh.activity.text019} text={zh.activity.text020}/>}</div></div></Modal>;
}
