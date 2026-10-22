import { databaseDropZh } from './locales/databaseDrop.zh-CN';
import type { DatabaseDropTarget } from '../shared/databaseDrop';
import type { WorkspaceTab } from './store';
import type { DatabaseDropServices } from './components/DatabaseDropDialog';
import { resolveQueryDatabase } from '../shared/queryContext';
import { invoke } from './lib';

/** 库级删除保护全部同库表页及同连接查询事务；未知查询上下文不能推断与目标无关。 */
export function assertDatabaseDropTargetAvailable(target: DatabaseDropTarget, workspace: {
  settings: { tabs: WorkspaceTab[] }; connections: { id: string; database?: string }[];
  dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean>; tableLayoutDrafts: Record<string, boolean>;
}, gridInputOpen = typeof document !== 'undefined' && !!document.querySelector('.grid-input')): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(databaseDropZh.workspaceBudget);
  for (const tab of workspace.settings.tabs) {
    if (tab.connectionId !== target.connectionId) continue;
    const own = (map: Record<string, boolean>) => Object.hasOwn(map, tab.id) && map[tab.id];
    // 任意同连接查询可能使用跨库SQL，活动任务和事务不能仅凭标签默认库排除。
    if (tab.kind === 'query') {
      if (own(workspace.activeJobs) || own(workspace.dirtyTabs)) throw new Error(databaseDropZh.busyQuery);
      const context = resolveQueryDatabase(tab.database, tab.databaseContext, workspace.connections.find(value => value.id === target.connectionId)?.database);
      if (context.state === 'unknown') throw new Error(databaseDropZh.unknownQuery);
    } else if (tab.database === target.database) {
      if (own(workspace.activeJobs)) throw new Error(databaseDropZh.busyTable);
      if (own(workspace.dirtyTabs) || own(workspace.tableLayoutDrafts)) throw new Error(databaseDropZh.dirty);
    }
  }
  if (gridInputOpen) throw new Error(databaseDropZh.editing);
}

/** 专用能力不接任意SQL、不借查询会话、不重试写入；Main绑定原连接及文档身份。 */
export const databaseDropServices: DatabaseDropServices = {
  get: input => invoke('schema.databaseDrop.get', input), preview: input => invoke('schema.databaseDrop.preview', input),
  apply: input => invoke('schema.databaseDrop.apply', input), release: input => invoke('schema.databaseDrop.release', input),
  cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.databaseDrop) listener({ taskId: event.taskId, progress: event.databaseDrop }); }) ?? (() => {}),
};
