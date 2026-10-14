import type { TableIndexPatchTarget } from '../shared/tableIndexTasks';
import type { IndexPatchServices } from './components/IndexPatchDialog';
import type { WorkspaceTab } from './store';
import { invoke } from './lib';
import { indexPatchZh as text } from './locales/indexPatches.zh-CN';

export interface IndexTargetWorkspace { settings: { tabs: WorkspaceTab[] }; dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean>; }
/** 同目标的隐藏页也参与保护，不触碰其他表或查询会话。 */
export function assertIndexTargetAvailable(target: TableIndexPatchTarget, workspace: IndexTargetWorkspace): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(text.workspaceBudget);
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table);
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.dataBusy);
  if (tabs.some(tab => Object.hasOwn(workspace.dirtyTabs, tab.id) && workspace.dirtyTabs[tab.id])) throw new Error(text.dataDirty);
}
/** 元组序列化保持特殊字符和大小写，不使用可碰撞的分隔符。 */
export function indexTargetKey(target: TableIndexPatchTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
/** 只允许真正空闲且无数据草稿的表页自动刷新。 */
export function indexPageRefreshAction(seen: number, next: number, automatic: boolean, busy: boolean, dirty: boolean): 'ignore' | 'wait' | 'reload' | 'stale' { if (seen === next) return 'ignore'; if (busy) return 'wait'; return automatic && !dirty ? 'reload' : 'stale'; }
/** 生产适配器仅调用真实索引命令，不能借查询会话执行任意 SQL 或重放失败。 */
export const indexPatchServices: IndexPatchServices = {
  get: input => invoke('schema.indexes.get', input),
  preview: input => invoke('schema.indexes.preview', input),
  apply: input => invoke('schema.indexes.apply', input),
  release: input => invoke('schema.indexes.release', input),
  cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.indexPatch) listener({ taskId: event.taskId, progress: event.indexPatch }); }) ?? (() => {}),
};
