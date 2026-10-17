import type { TableCreateGetInput, TableCreateGetOutput, TableCreatePreviewInput, TableCreatePreviewOutput, TableCreateApplyInput, TableCreateApplyOutput, TableCreateReleaseInput, TableCreateProgress } from '../shared/tableCreate';
import { invoke } from './lib';
import { tableCreateZh } from './locales/tableCreate.zh-CN';
/** 此函数只留在renderer，不进入IPC合同；由确认页固定操作租约并活读父origin。 */
export type TableCreateCurrent = () => boolean;
/** 真正发送前失败即终止；不能在内部等待后沿用调用时的有效值。 */
function assertCurrent(current: TableCreateCurrent): void {
  let valid = false; try { valid = typeof current === 'function' && current() === true; } catch { /* 父租约异常同样失效。 */ }
  if (!valid) throw Error(tableCreateZh.mismatch);
}
export interface TableCreateServices {
  get(input: TableCreateGetInput, current: TableCreateCurrent): Promise<TableCreateGetOutput>;
  preview(input: TableCreatePreviewInput, current: TableCreateCurrent): Promise<TableCreatePreviewOutput>;
  apply(input: TableCreateApplyInput, current: TableCreateCurrent): Promise<TableCreateApplyOutput>;
  release(input: TableCreateReleaseInput): Promise<void>;
  cancel(taskId: string): Promise<void>;
  subscribe(listener: (taskId: string, progress: TableCreateProgress) => void): () => void;
}
/** 专用适配器不接受SQL或profile；可信修订、服务器和实际SQL均在主进程/引擎绑定。 */
export const tableCreateServices: TableCreateServices = {
  get: async (input, current) => { assertCurrent(current); await invoke('connections.open', { id: input.connectionId }); assertCurrent(current); return invoke('schema.tableCreate.get', input); },
  preview: async (input, current) => { assertCurrent(current); return invoke('schema.tableCreate.preview', input); }, apply: async (input, current) => { assertCurrent(current); return invoke('schema.tableCreate.apply', input); }, release: input => invoke('schema.tableCreate.release', input),
  cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark?.onTask(event => { if (event.tableCreate) listener(event.taskId, event.tableCreate); }) ?? (() => {}),
};
