import { zh } from '../locales/zh-CN';
import { tableApplyReceiptZh as t } from '../locales/tableApplyReceiptZh';
import { useMemo, useState } from 'react';
import { useTaskCancelStates } from '../hooks/useTaskCancelStates';
import { errorMessage, invoke } from '../lib';
import { useWorkspace } from '../store';
import { Empty, ErrorBox, Modal, Spinner } from './ui';
import{SavedQueriesDialog}from'./SavedQueriesDialog';
import{HistoryPagesDialog}from'./HistoryPagesDialog';
import { TableApplyReceiptsDialog } from './TableApplyReceiptsDialog';
import { QueryFileTaskProgress } from './QueryFileTaskProgress';
import { SqliteWriteFactSummary } from './SqliteWriteFactSummary';
import type { HistoryInsertionTarget } from '../historyInsertion';
import { borrowInsertion } from '../insertionLease';

/** 两个资料源分别管理有界页和收尾，切换时不保留另一面板的活动读取。 */
export function HistoryDialog({ onClose, insertion, initialSection = 'history' }: { onClose: () => void; insertion?: HistoryInsertionTarget | null; initialSection?: 'history' | 'queries' }) {
  const[section,setSection]=useState<'history'|'queries'>(initialSection);
  // App持有并释放父权限；子页关闭/切换撤销自身租约。不在effect清理中消费权限，避免StrictMode重订阅误撤销。
  const lease = useMemo(() => borrowInsertion(insertion), [insertion, section]);
  return section==='queries'?<SavedQueriesDialog insertion={lease} onClose={onClose} onHistory={()=>setSection('history')}/>:<HistoryPagesDialog insertion={lease} onClose={onClose} onQueries={()=>setSection('queries')}/>;
}

/** 任务面板订阅统一状态存储，取消按钮只针对仍在运行的任务编号。 */
export function TasksDialog({ onClose }: { onClose: () => void }) {
  const tasks = useWorkspace(state => state.tasks); const fileTasks = useWorkspace(state => state.queryFileTasks); const [error, setError] = useState('');
  const [receipts, setReceipts] = useState(false);
  const cancellation = useTaskCancelStates(tasks.filter(task => task.status === 'running' && !fileTasks[task.id]).map(task => task.id));
  if (receipts) return <TableApplyReceiptsDialog onClose={onClose} onTasks={() => setReceipts(false)}/>;
  return <Modal title={zh.common.taskCenter} onClose={onClose}><div className="modal-content"><button onClick={() => setReceipts(true)}>{t.title}</button><ErrorBox message={error}/><div className="tasks-list">{tasks.map(task => <article className="task-card" key={task.id}><div><strong>{task.kind}</strong><span className="grow"/><span className={`task-state ${task.status}`}>{{ running: zh.activity.text014, completed: zh.activity.text015, cancelled: zh.activity.text016, failed: zh.activity.text017 }[task.status]}</span></div><p>{task.message}</p><SqliteWriteFactSummary fact={task.sqliteWrite}/><progress max="100" value={task.progress}/>{fileTasks[task.id] && <QueryFileTaskProgress task={fileTasks[task.id]}/>}<footer><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span><span className="grow"/>{task.status === 'running' && !fileTasks[task.id] && (cancellation.states.get(task.id) === 'allowed' && task.sqliteWrite?.phase !== 'commit-pending' ? <button onClick={() => { if (cancellation.canCancel(task.id)) void invoke('query.cancel', { taskId: task.id }).catch(reason => setError(errorMessage(reason))); }}>{zh.activity.text018}</button> : <span>{task.sqliteWrite?.phase === 'commit-pending' || cancellation.states.get(task.id) === 'confirming' ? t.phases.committing : cancellation.states.get(task.id) === 'finished' ? t.cancellation.finished : t.cancellation.unverified}</span>)}</footer>{task.errors?.length ? <pre>{task.errors.join('\n')}</pre> : null}</article>)}{!tasks.length && <Empty title={zh.activity.text019} text={zh.activity.text020}/>}</div></div></Modal>;
}
