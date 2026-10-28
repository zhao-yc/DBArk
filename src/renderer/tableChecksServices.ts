import type { TableCheckApplyInput, TableCheckApplyOutput, TableCheckGetInput, TableCheckGetOutput, TableCheckPreviewInput, TableCheckPreviewOutput, TableCheckProgress, TableCheckReleaseInput, TableCheckTarget } from '../shared/tableChecks';
import type { WorkspaceTab } from './store';
import type { TaskRecord } from '../shared/contracts';
import { invoke } from './lib';
import { tableChecksZh as text } from './locales/tableChecks.zh-CN';
export interface TableChecksServices {
  get(input: TableCheckGetInput): Promise<TableCheckGetOutput>; preview(input: TableCheckPreviewInput): Promise<TableCheckPreviewOutput>; apply(input: TableCheckApplyInput): Promise<TableCheckApplyOutput>;
  release(input: TableCheckReleaseInput): Promise<void>; cancel(input: { taskId: string }): Promise<unknown>; subscribe?(listener: (event: { taskId: string; status: TaskRecord['status']; progress: TableCheckProgress }) => void): () => void;
}
/** 同目标所有隐藏表页也参加保护，查询会话和其它目标不被误当作当前表。 */
export function assertTableChecksTargetAvailable(target: TableCheckTarget, state: { settings: { tabs: WorkspaceTab[] }; activeJobs: Record<string, boolean>; dirtyTabs: Record<string, boolean> }): void {
  if (state.settings.tabs.length > 1000) throw Error(text.workspaceBudget);
  const tabs = state.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database && tab.table === target.table);
  if (tabs.some(tab => Object.getOwnPropertyDescriptor(state.activeJobs, tab.id)?.value === true)) throw Error(text.busy);
  if (tabs.some(tab => Object.getOwnPropertyDescriptor(state.dirtyTabs, tab.id)?.value === true)) throw Error(text.dirty);
}
/** 正式适配器仅传结构化变更与原令牌，不接收renderer SQL或复用查询会话。 */
export const tableChecksServices: TableChecksServices = {
  get: input => invoke('schema.tableChecks.get', input), preview: input => invoke('schema.tableChecks.preview', input), apply: input => invoke('schema.tableChecks.apply', input), release: input => invoke('schema.tableChecks.release', input), cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask?.(event => { if (event.tableChecks) listener({ taskId: event.taskId, status: event.status, progress: event.tableChecks }); }) ?? (() => {}),
};
