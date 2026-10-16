import { zh } from '../locales/zh-CN';
import { useState } from 'react';
import { useTaskCancelStates } from '../hooks/useTaskCancelStates';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { Empty, ErrorBox, Modal, Spinner } from './ui';
import{SavedQueriesDialog}from'./SavedQueriesDialog';
import{HistoryPagesDialog}from'./HistoryPagesDialog';
import { TableApplyReceiptsDialog } from './TableApplyReceiptsDialog';

/** 两个资料源分别管理有界页和收尾，切换时不保留另一面板的活动读取。 */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const[section,setSection]=useState<'history'|'queries'>('history');
  return section==='queries'?<SavedQueriesDialog onClose={onClose} onHistory={()=>setSection('history')}/>:<HistoryPagesDialog onClose={onClose} onQueries={()=>setSection('queries')}/>;
}

/** 任务面板订阅统一状态存储，取消按钮只针对仍在运行的任务编号。 */
export function TasksDialog({ onClose }: { onClose: () => void }) {
  const tasks = useWorkspace(state => state.tasks); const [error, setError] = useState('');
  const [receipts, setReceipts] = useState(false);
  const cancellation = useTaskCancelStates(tasks.filter(task => task.status === 'running').map(task => task.id));
  if (receipts) return <TableApplyReceiptsDialog onClose={onClose} onTasks={() => setReceipts(false)}/>;
  return <Modal title={zh.common.taskCenter} onClose={onClose}><div className="modal-content"><button onClick={() => setReceipts(true)}>数据提交记录</button><ErrorBox message={error}/><div className="tasks-list">{tasks.map(task => <article className="task-card" key={task.id}><div><strong>{task.kind}</strong><span className="grow"/><span className={`task-state ${task.status}`}>{{ running: zh.activity.text014, completed: zh.activity.text015, cancelled: zh.activity.text016, failed: zh.activity.text017 }[task.status]}</span></div><p>{task.message}</p><progress max="100" value={task.progress}/><footer><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span><span className="grow"/>{task.status === 'running' && (cancellation.states.get(task.id) === 'allowed' ? <button onClick={() => { if (cancellation.canCancel(task.id)) void invoke('query.cancel', { taskId: task.id }).catch(reason => setError(errorMessage(reason))); }}>{zh.activity.text018}</button> : <span>{cancellation.states.get(task.id) === 'confirming' ? '正在确认提交，暂不能取消' : cancellation.states.get(task.id) === 'finished' ? '任务正在收尾，暂不能取消' : '尚未核验当前阶段，暂不能取消'}</span>)}</footer>{task.errors?.length ? <pre>{task.errors.join('\n')}</pre> : null}</article>)}{!tasks.length && <Empty title={zh.activity.text019} text={zh.activity.text020}/>}</div></div></Modal>;
}
