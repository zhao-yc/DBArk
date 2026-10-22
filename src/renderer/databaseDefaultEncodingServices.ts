import type { DatabaseDefaultEncodingTarget } from '../shared/databaseDefaultEncoding';
import type { WorkspaceTab } from './store';
import type { DatabaseDefaultEncodingServices } from './components/DatabaseDefaultEncodingDialog';
import { databaseDefaultEncodingZh as text } from './locales/databaseDefaultEncoding.zh-CN';
import { invoke } from './lib';
/** 默认编码不触碰既有表数据草稿；只等待同库表页原操作真正结束。 */
export function assertDatabaseDefaultEncodingTargetAvailable(target: DatabaseDefaultEncodingTarget, workspace: { settings: { tabs: WorkspaceTab[] }; activeJobs: Record<string, boolean> }): void {
  if (workspace.settings.tabs.length > 1000) throw new Error(text.workspaceBudget);
  const tabs = workspace.settings.tabs.filter(tab => tab.kind === 'table' && tab.connectionId === target.connectionId && tab.database === target.database);
  if (tabs.some(tab => Object.hasOwn(workspace.activeJobs, tab.id) && workspace.activeJobs[tab.id])) throw new Error(text.busy);
}
/** 正式IPC只接受令牌及目录配对，不接用户SQL、不复用查询标签会话、不重放失败DDL。 */
export const databaseDefaultEncodingServices: DatabaseDefaultEncodingServices = {
  get: async (input, isCurrent) => { if (isCurrent && !isCurrent()) throw new Error(text.targetChanged); await invoke('connections.open', { id: input.connectionId }); if (isCurrent && !isCurrent()) throw new Error(text.targetChanged); return invoke('schema.databaseDefaultEncoding.get', input); }, preview: input => invoke('schema.databaseDefaultEncoding.preview', input),
  apply: input => invoke('schema.databaseDefaultEncoding.apply', input), release: input => invoke('schema.databaseDefaultEncoding.release', input), cancel: input => invoke('query.cancel', input),
  subscribe: listener => window.dbark?.onTask(event => { if (event.databaseDefaultEncoding) listener({ taskId: event.taskId, progress: event.databaseDefaultEncoding }); }) ?? (() => {}),
};
