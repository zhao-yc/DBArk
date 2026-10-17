import type { TableTruncateTarget } from '../shared/tableTruncate';
import type { WorkspaceTab } from './store';
import type { TableTruncateServices } from './components/TableTruncateDialog';
import { tableTruncateZh as text } from './locales/tableTruncate.zh-CN';
import { invoke } from './lib';

/** 同表隐藏页的数据、布局与活动任务共同阻断；尚未提交到状态树的输入也不能绕过。 */
export function assertTableTruncateTargetAvailable(target: TableTruncateTarget, workspace: { settings: { tabs: WorkspaceTab[] }; dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean>; tableLayoutDrafts: Record<string, boolean> }, gridInputOpen = typeof document !== 'undefined' && !!document.querySelector('.grid-input')): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(text.workspaceBudget);
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table);
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.busy);
  if (tabs.some(tab => Object.hasOwn(workspace.dirtyTabs, tab.id) && workspace.dirtyTabs[tab.id] || Object.hasOwn(workspace.tableLayoutDrafts, tab.id) && workspace.tableLayoutDrafts[tab.id])) throw new Error(text.dirty);
  if (gridInputOpen) throw new Error(text.editing);
}
/** 仅调用专用类型化命令，不传入SQL，不复用查询事务，不做失败回放。 */
export const tableTruncateServices: TableTruncateServices = {
  get: input => invoke('schema.tableTruncate.get', input), preview: input => invoke('schema.tableTruncate.preview', input),
  apply: input => invoke('schema.tableTruncate.apply', input), release: input => invoke('schema.tableTruncate.release', input), cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.tableTruncate) listener({ taskId: event.taskId, progress: event.tableTruncate }); }) ?? (() => {}),
};
