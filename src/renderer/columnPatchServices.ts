import type { TableColumnPatchTarget } from '../shared/tableColumnPatches';
import type { ColumnPatchServices } from './components/ColumnPatchDialog';
import type { WorkspaceTab } from './store';
import { invoke } from './lib';
import { columnPatchZh as text } from './locales/columnPatches.zh-CN';

export interface ColumnTargetWorkspace { settings: { tabs: WorkspaceTab[] }; dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean>; }
/** 只检查精确同目标表标签，隐藏页也不能丢草稿；查询会话和其他表保持独立。 */
export function assertColumnTargetAvailable(target: TableColumnPatchTarget, workspace: ColumnTargetWorkspace): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(text.workspaceBudget);
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table);
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.dataBusy);
  if (tabs.some(tab => Object.hasOwn(workspace.dirtyTabs, tab.id) && workspace.dirtyTabs[tab.id])) throw new Error(text.dataDirty);
}
/** 身份序列化不用拼接分隔符，库表大小写与合法特殊字符不会碰撞。 */
export function columnTargetKey(target: TableColumnPatchTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
/** 刷新版本只在真实空闲时消费，任何数据草稿或未知DDL结果都禁止自动刷新丢草稿。 */
export function columnPageRefreshAction(seen: number, next: number, automatic: boolean, busy: boolean, dirty: boolean): 'ignore' | 'wait' | 'reload' | 'stale' {
  if (seen === next) return 'ignore'; if (busy) return 'wait'; return automatic && !dirty ? 'reload' : 'stale';
}

/** 唯一真实适配器：不执行用户SQL，不借用查询标签session，失败不fallback或重放。 */
export const columnPatchServices: ColumnPatchServices = {
  get: input => invoke('schema.columns.get', input),
  preview: input => invoke('schema.columns.preview', input),
  apply: input => invoke('schema.columns.apply', input),
  release: input => invoke('schema.columns.release', input),
  cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.columnPatch) listener({ taskId: event.taskId, progress: event.columnPatch }); }) ?? (() => {}),
};
