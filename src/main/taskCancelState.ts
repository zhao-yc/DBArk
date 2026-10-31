import type { TaskRecord } from '../shared/contracts';
import type { TaskCancelSnapshot, TaskCancelState } from '../shared/taskCancelState';

/** 仅当前主进程记录可授权取消；磁盘历史和界面消息都不能恢复取消权限。 */
export function taskCancelSnapshot(taskIds: string[], tasks: ReadonlyMap<string, TaskRecord>, tableApplyState: (id: string, operationId: string | undefined) => TaskCancelState): TaskCancelSnapshot {
  return [...new Set(taskIds)].map(taskId => {
    const task = tasks.get(taskId);
    const create = task?.kind === 'sqlite.tableCreate.apply' ? task.sqliteCreate : undefined;
    const confirmingCreate = create && (create.phase === 'commit-pending' || create.phase === 'unknown' || create.commitMayHaveBeenSent && !create.commitAcknowledged && !create.rollbackAcknowledged);
    const state = !task ? 'checking' : task.status !== 'running' || create?.commitAcknowledged || create?.rollbackAcknowledged ? 'finished' : confirmingCreate ? 'confirming' : task.kind === 'table.apply' ? tableApplyState(taskId, task.tableApplyReceiptId) : 'allowed';
    return { taskId, state };
  });
}
