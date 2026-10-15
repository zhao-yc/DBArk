import type { TableDefaultEncodingTarget } from '../shared/tableDefaultEncoding';
import type { WorkspaceTab } from './store';
import type { TableDefaultEncodingServices } from './components/TableDefaultEncodingDialog';
import { tableDefaultEncodingZh as text } from './locales/tableDefaultEncoding.zh-CN';
import { invoke } from './lib';

/** 同目标隐藏表页也参加保护，不丢数据草稿，不用活动页代替完整目标匹配。 */
export function assertTableDefaultEncodingTargetAvailable(target: TableDefaultEncodingTarget, workspace: { settings: { tabs: WorkspaceTab[] }; dirtyTabs: Record<string, boolean>; activeJobs: Record<string, boolean> }): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(text.workspaceBudget);
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table);
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.busy);
  if (tabs.some(tab => Object.hasOwn(workspace.dirtyTabs, tab.id) && workspace.dirtyTabs[tab.id])) throw new Error(text.dirty);
}
/** 生产适配器不接收SQL，不借查询标签会话，没有失败fallback或重放。 */
export const tableDefaultEncodingServices: TableDefaultEncodingServices = {
  get: input => invoke('schema.tableDefaultEncoding.get', input), preview: input => invoke('schema.tableDefaultEncoding.preview', input),
  apply: input => invoke('schema.tableDefaultEncoding.apply', input), release: input => invoke('schema.tableDefaultEncoding.release', input), cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.tableDefaultEncoding) listener({ taskId: event.taskId, progress: event.tableDefaultEncoding }); }) ?? (() => {}),
};
