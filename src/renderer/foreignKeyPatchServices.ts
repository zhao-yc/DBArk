import type { TableForeignKeyTarget } from '../shared/tableForeignKeyTasks';
import { foreignKeyTaskLimits } from '../shared/tableForeignKeyTasks';
import type { ForeignKeyPatchServices } from './components/ForeignKeyPatchDialog';
import type { WorkspaceTab } from './store';
import { invoke } from './lib';
import { foreignKeyPatchZh as text } from './locales/foreignKeyPatches.zh-CN';

export interface ForeignKeyTargetWorkspace { settings: { tabs: WorkspaceTab[] }; dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean>; }
/** 精确保护子表及已加载父表的隐藏页，不把同名其他连接或查询页纳入数据草稿检查。 */
export function assertForeignKeyTargetsAvailable(targets: readonly TableForeignKeyTarget[], workspace: ForeignKeyTargetWorkspace): void {
  if (workspace.settings.tabs.length > 1000 || targets.length > foreignKeyTaskLimits.tables) throw new Error(text.workspaceBudget);
  const keys = new Set(targets.map(target => JSON.stringify([target.connectionId, target.database, target.table])));
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && keys.has(JSON.stringify([tab.connectionId, tab.database, tab.table])));
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.dataBusy);
  if (tabs.some(tab => Object.hasOwn(workspace.dirtyTabs, tab.id) && workspace.dirtyTabs[tab.id])) throw new Error(text.dataDirty);
}
/** 生产适配器只提交外键任务结构和 opaque token，不能借任意 SQL 或查询会话写入。 */
export const foreignKeyPatchServices: ForeignKeyPatchServices = {
  get: input => invoke('schema.foreignKeys.get', input),
  preview: input => invoke('schema.foreignKeys.preview', input),
  apply: input => invoke('schema.foreignKeys.apply', input),
  release: input => invoke('schema.foreignKeys.release', input),
  cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.foreignKeyPatch) listener({ taskId: event.taskId, progress: event.foreignKeyPatch }); }) ?? (() => {}),
};
