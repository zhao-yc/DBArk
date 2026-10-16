import type { TaskRecord } from '../shared/contracts';
import type { TaskCancelSnapshot, TaskCancelState } from '../shared/taskCancelState';

/** 仅当前主进程记录可授权取消；磁盘历史和界面消息都不能恢复取消权限。 */
export function taskCancelSnapshot(taskIds: string[], tasks: ReadonlyMap<string, TaskRecord>, tableApplyState: (id: string, operationId: string | undefined) => TaskCancelState): TaskCancelSnapshot {
  return [...new Set(taskIds)].map(taskId => {
    const task = tasks.get(taskId);
    const state = !task ? 'checking' : task.status !== 'running' ? 'finished' : task.kind === 'table.apply' ? tableApplyState(taskId, task.tableApplyReceiptId) : 'allowed';
    return { taskId, state };
  });
}
