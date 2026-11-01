import type { TaskRecord } from '../shared/contracts';
import type { TaskCancelSnapshot, TaskCancelState } from '../shared/taskCancelState';

/** 仅当前主进程记录可授权取消；磁盘历史和界面消息都不能恢复取消权限。 */
export function taskCancelSnapshot(taskIds: string[], tasks: ReadonlyMap<string, TaskRecord>, tableApplyState: (id: string, operationId: string | undefined) => TaskCancelState): TaskCancelSnapshot {
  return [...new Set(taskIds)].map(taskId => {
    const task = tasks.get(taskId);
    const objects = task?.kind === 'sqlite.objects.apply' ? task.sqliteObjects : undefined;
    const confirmingObjects = objects && (objects.phase === 'commit-pending' || objects.phase === 'unknown' || objects.commitMayHaveBeenSent && !objects.commitAcknowledged && !objects.rollbackAcknowledged);
    const maintenance = task?.kind === 'sqlite.tableMaintenance.apply' ? task.sqliteTableMaintenance : undefined;
    const confirmingMaintenance = maintenance && (maintenance.phase === 'commit-pending' || maintenance.phase === 'unknown' || maintenance.commitMayHaveBeenSent && !maintenance.commitAcknowledged && !maintenance.rollbackAcknowledged);
    const rename = task?.kind === 'sqlite.tableRename.apply' ? task.sqliteTableRename : undefined;
    const confirmingRename = rename && (rename.phase === 'commit-pending' || rename.phase === 'unknown' || rename.commitMayHaveBeenSent && !rename.commitAcknowledged && !rename.rollbackAcknowledged);
    const rebuild = task?.kind === 'sqlite.tableRebuild.apply' ? task.sqliteTableRebuild : undefined;
    const confirmingRebuild = rebuild && (rebuild.phase === 'commit-pending' || rebuild.phase === 'unknown' || rebuild.commitMayHaveBeenSent && !rebuild.commitAcknowledged && !rebuild.rollbackAcknowledged);
    const columns = task?.kind === 'sqlite.columns.apply' ? task.sqliteColumns : undefined;
    const confirmingColumns = columns && (columns.phase === 'commit-pending' || columns.phase === 'unknown' || columns.commitMayHaveBeenSent && !columns.commitAcknowledged && !columns.rollbackAcknowledged);
    const indexes = task?.kind === 'sqlite.indexes.apply' ? task.sqliteIndexes : undefined;
    const confirmingIndexes = indexes && (indexes.phase === 'commit-pending' || indexes.phase === 'unknown' || indexes.commitMayHaveBeenSent && !indexes.commitAcknowledged && !indexes.rollbackAcknowledged);
    const create = task?.kind === 'sqlite.tableCreate.apply' ? task.sqliteCreate : undefined;
    const imported = task?.kind === 'sqlite.tableImport.apply' ? task.sqliteWrite : undefined;
    const confirmingImport = imported && (imported.phase === 'commit-pending' || imported.phase === 'unknown' || imported.commitMayHaveBeenSent && !imported.commitAcknowledged && !imported.rollbackAcknowledged);
    const confirmingCreate = create && (create.phase === 'commit-pending' || create.phase === 'unknown' || create.commitMayHaveBeenSent && !create.commitAcknowledged && !create.rollbackAcknowledged);
    const state = !task ? 'checking' : task.status !== 'running' || objects?.commitAcknowledged || objects?.rollbackAcknowledged || maintenance?.commitAcknowledged || maintenance?.rollbackAcknowledged || rename?.commitAcknowledged || rename?.rollbackAcknowledged || rebuild?.commitAcknowledged || rebuild?.rollbackAcknowledged || columns?.commitAcknowledged || columns?.rollbackAcknowledged || indexes?.commitAcknowledged || indexes?.rollbackAcknowledged || create?.commitAcknowledged || create?.rollbackAcknowledged || imported?.commitAcknowledged || imported?.rollbackAcknowledged ? 'finished' : confirmingCreate || confirmingImport || confirmingIndexes || confirmingRebuild || confirmingColumns || confirmingRename || confirmingMaintenance || confirmingObjects ? 'confirming' : task.kind === 'table.apply' ? tableApplyState(taskId, task.tableApplyReceiptId) : 'allowed';
    return { taskId, state };
  });
}
