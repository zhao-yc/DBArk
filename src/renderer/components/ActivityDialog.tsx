import { sqliteDatabaseCopyZh } from '../../shared/sqliteDatabaseBackup';
import { objectDefinitionZh } from '../locales/objectDefinition.zh-CN';
import { sqliteTableRebuildTaskTitles } from '../locales/sqliteTableRebuildFact.zh-CN';
import { sqliteStatisticsZh } from '../locales/sqliteStatistics.zh-CN';
import { SqliteTableRebuildFactSummary } from './SqliteTableRebuildFactSummary';
import { sqliteTableRebuildCancelLocked } from '../taskCancelStates';
import { sqliteObjectsTaskTitles } from '../locales/sqliteObjectsFact.zh-CN';
import { SqliteObjectsFactSummary } from './SqliteObjectsFactSummary';
import { sqliteObjectsCancelLocked } from '../taskCancelStates';
import { sqliteTableMaintenanceTaskTitles } from '../locales/sqliteTableMaintenanceFact.zh-CN';
import { SqliteTableMaintenanceFactSummary } from './SqliteTableMaintenanceFactSummary';
import { sqliteTableMaintenanceCancelLocked } from '../taskCancelStates';
import { sqliteTableRenameTaskTitles } from '../locales/sqliteTableRenameFact.zh-CN';
import { SqliteTableRenameFactSummary } from './SqliteTableRenameFactSummary';
import { sqliteTableRenameCancelLocked } from '../taskCancelStates';
import { sqliteColumnsTaskTitles } from '../locales/sqliteColumnsFact.zh-CN';
import { SqliteColumnsFactSummary } from './SqliteColumnsFactSummary';
import { sqliteColumnsCancelLocked } from '../taskCancelStates';
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
import { SqliteTableCreateFactSummary } from './SqliteTableCreateFactSummary';
import { sqliteTableCreateCancelLocked, sqliteWriteCancelLocked } from '../taskCancelStates';
import { sqliteTableCreateZh } from '../locales/sqliteTableCreate.zh-CN';
import { sqliteImportTaskTitles } from '../locales/sqliteWriteFact.zh-CN';
import { sqliteIndexesTaskTitles } from '../locales/sqliteIndexesFact.zh-CN';
import { SqliteIndexesFactSummary } from './SqliteIndexesFactSummary';
import { sqliteIndexesCancelLocked } from '../taskCancelStates';
import type { HistoryInsertionTarget } from '../historyInsertion';
import { borrowInsertion } from '../insertionLease';

/** 两个资料源分别管理有界页和收尾，切换时不保留另一面板的活动读取。 */
export function HistoryDialog({ onClose, insertion, initialSection = 'history', initialConnectionId }: { onClose: () => void; insertion?: HistoryInsertionTarget | null; initialSection?: 'history' | 'queries'; initialConnectionId?: string }) {
  const[section,setSection]=useState<'history'|'queries'>(initialSection);
  // App持有并释放父权限；子页关闭/切换撤销自身租约。不在effect清理中消费权限，避免StrictMode重订阅误撤销。
  const lease = useMemo(() => borrowInsertion(insertion), [insertion, section]);
  return section==='queries'?<SavedQueriesDialog insertion={lease} initialConnectionId={initialConnectionId} onClose={onClose} onHistory={()=>setSection('history')}/>:<HistoryPagesDialog insertion={lease} initialConnectionId={initialConnectionId} onClose={onClose} onQueries={()=>setSection('queries')}/>;
}

/** 任务面板订阅统一状态存储，取消按钮只针对仍在运行的任务编号。 */
export function TasksDialog({ onClose }: { onClose: () => void }) {
  const tasks = useWorkspace(state => state.tasks); const fileTasks = useWorkspace(state => state.queryFileTasks); const [error, setError] = useState('');
  const [receipts, setReceipts] = useState(false);
  const cancellation = useTaskCancelStates(tasks.filter(task => task.status === 'running' && !fileTasks[task.id]).map(task => task.id));
  if (receipts) return <TableApplyReceiptsDialog onClose={onClose} onTasks={() => setReceipts(false)}/>;
  return <Modal title={zh.common.taskCenter} onClose={onClose}><div className="modal-content"><button onClick={() => setReceipts(true)}>{t.title}</button><ErrorBox message={error}/><div className="tasks-list">{tasks.map(task => <article className="task-card" key={task.id}><div><strong>{task.kind === 'sqlite.databaseCopy.backup' ? sqliteDatabaseCopyZh.backup : task.kind === 'sqlite.databaseCopy.restore' ? sqliteDatabaseCopyZh.restore : task.kind === 'query.objectDefinition' ? objectDefinitionZh.entry : task.kind === 'sqlite.statistics' ? sqliteStatisticsZh.entry : task.kind === 'sqlite.tableRebuild.inspect' ? sqliteTableRebuildTaskTitles.inspect : task.kind === 'sqlite.tableRebuild.preview' ? sqliteTableRebuildTaskTitles.preview : task.kind === 'sqlite.tableRebuild.apply' ? sqliteTableRebuildTaskTitles.apply : task.kind === 'sqlite.objects.inspect' ? sqliteObjectsTaskTitles.inspect : task.kind === 'sqlite.objects.preview' ? sqliteObjectsTaskTitles.preview : task.kind === 'sqlite.objects.apply' ? sqliteObjectsTaskTitles.apply : task.kind === 'sqlite.tableMaintenance.inspect' ? sqliteTableMaintenanceTaskTitles.inspect : task.kind === 'sqlite.tableMaintenance.preview' ? sqliteTableMaintenanceTaskTitles.preview : task.kind === 'sqlite.tableMaintenance.apply' ? sqliteTableMaintenanceTaskTitles.apply : task.kind === 'sqlite.tableRename.inspect' ? sqliteTableRenameTaskTitles.inspect : task.kind === 'sqlite.tableRename.preview' ? sqliteTableRenameTaskTitles.preview : task.kind === 'sqlite.tableRename.apply' ? sqliteTableRenameTaskTitles.apply : task.kind === 'sqlite.columns.inspect' ? sqliteColumnsTaskTitles.inspect : task.kind === 'sqlite.columns.preview' ? sqliteColumnsTaskTitles.preview : task.kind === 'sqlite.columns.apply' ? sqliteColumnsTaskTitles.apply : task.kind === 'sqlite.indexes.inspect' ? sqliteIndexesTaskTitles.inspect : task.kind === 'sqlite.indexes.preview' ? sqliteIndexesTaskTitles.preview : task.kind === 'sqlite.indexes.apply' ? sqliteIndexesTaskTitles.apply : task.kind === 'sqlite.importSource.inspect' ? sqliteImportTaskTitles.source : task.kind === 'sqlite.tableImport.inspect' ? sqliteImportTaskTitles.inspect : task.kind === 'sqlite.tableImport.preview' ? sqliteImportTaskTitles.preview : task.kind === 'sqlite.tableImport.apply' ? sqliteImportTaskTitles.apply : task.kind === 'sqlite.tableCreate.preview' ? sqliteTableCreateZh.previewTask : task.kind === 'sqlite.tableCreate.apply' ? sqliteTableCreateZh.applyTask : task.kind}</strong><span className="grow"/><span className={`task-state ${task.status}`}>{{ running: zh.activity.text014, completed: zh.activity.text015, cancelled: zh.activity.text016, failed: zh.activity.text017 }[task.status]}</span></div><p>{task.message}</p><SqliteWriteFactSummary fact={task.sqliteWrite} importing={task.kind === 'sqlite.tableImport.apply'}/><SqliteTableCreateFactSummary fact={task.sqliteCreate}/><SqliteIndexesFactSummary fact={task.sqliteIndexes}/><SqliteTableRebuildFactSummary fact={task.sqliteTableRebuild}/><SqliteObjectsFactSummary fact={task.sqliteObjects}/><SqliteTableMaintenanceFactSummary fact={task.sqliteTableMaintenance}/><SqliteTableRenameFactSummary fact={task.sqliteTableRename}/><SqliteColumnsFactSummary fact={task.sqliteColumns}/><progress max="100" value={task.progress}/>{fileTasks[task.id] && <QueryFileTaskProgress task={fileTasks[task.id]}/>}<footer><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN')}</span><span className="grow"/>{task.status === 'running' && !fileTasks[task.id] && (cancellation.states.get(task.id) === 'allowed' && !sqliteTableRebuildCancelLocked(task.sqliteTableRebuild) && !sqliteObjectsCancelLocked(task.sqliteObjects) && !sqliteTableMaintenanceCancelLocked(task.sqliteTableMaintenance) && !sqliteTableRenameCancelLocked(task.sqliteTableRename) && !sqliteColumnsCancelLocked(task.sqliteColumns) && !sqliteIndexesCancelLocked(task.sqliteIndexes) && !sqliteWriteCancelLocked(task.sqliteWrite, task.kind === 'sqlite.tableImport.apply') && !sqliteTableCreateCancelLocked(task.sqliteCreate) ? <button onClick={() => { if (cancellation.canCancel(task.id) && !sqliteTableRebuildCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteTableRebuild) && !sqliteObjectsCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteObjects) && !sqliteTableMaintenanceCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteTableMaintenance) && !sqliteTableRenameCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteTableRename) && !sqliteColumnsCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteColumns) && !sqliteIndexesCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteIndexes) && !sqliteWriteCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteWrite, useWorkspace.getState().tasks.find(value => value.id === task.id)?.kind === 'sqlite.tableImport.apply') && !sqliteTableCreateCancelLocked(useWorkspace.getState().tasks.find(value => value.id === task.id)?.sqliteCreate)) void invoke('query.cancel', { taskId: task.id }).catch(reason => setError(errorMessage(reason))); }}>{zh.activity.text018}</button> : <span>{sqliteTableCreateCancelLocked(task.sqliteCreate) ? task.sqliteCreate?.phase === 'unknown' ? sqliteTableCreateZh.cancelUnknown : sqliteTableCreateZh.cancelCommit : sqliteTableRebuildCancelLocked(task.sqliteTableRebuild) || sqliteObjectsCancelLocked(task.sqliteObjects) || sqliteTableMaintenanceCancelLocked(task.sqliteTableMaintenance) || sqliteTableRenameCancelLocked(task.sqliteTableRename) || sqliteColumnsCancelLocked(task.sqliteColumns) || sqliteIndexesCancelLocked(task.sqliteIndexes) || sqliteWriteCancelLocked(task.sqliteWrite, task.kind === 'sqlite.tableImport.apply') || cancellation.states.get(task.id) === 'confirming' ? t.phases.committing : cancellation.states.get(task.id) === 'finished' ? t.cancellation.finished : t.cancellation.unverified}</span>)}</footer>{task.errors?.length ? <pre>{task.errors.join('\n')}</pre> : null}</article>)}{!tasks.length && <Empty title={zh.activity.text019} text={zh.activity.text020}/>}</div></div></Modal>;
}
