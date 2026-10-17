import type { TableCreateGetInput, TableCreateGetOutput, TableCreatePreviewInput, TableCreatePreviewOutput, TableCreateApplyInput, TableCreateApplyOutput, TableCreateReleaseInput, TableCreateProgress } from '../shared/tableCreate';
import { invoke } from './lib';
export interface TableCreateServices {
  get(input: TableCreateGetInput): Promise<TableCreateGetOutput>;
  preview(input: TableCreatePreviewInput): Promise<TableCreatePreviewOutput>;
  apply(input: TableCreateApplyInput): Promise<TableCreateApplyOutput>;
  release(input: TableCreateReleaseInput): Promise<void>;
  cancel(taskId: string): Promise<void>;
  subscribe(listener: (taskId: string, progress: TableCreateProgress) => void): () => void;
}
/** 专用适配器不接受SQL或profile；可信修订、服务器和实际SQL均在主进程/引擎绑定。 */
export const tableCreateServices: TableCreateServices = {
  get: async input => { await invoke('connections.open', { id: input.connectionId }); return invoke('schema.tableCreate.get', input); },
  preview: input => invoke('schema.tableCreate.preview', input), apply: input => invoke('schema.tableCreate.apply', input), release: input => invoke('schema.tableCreate.release', input),
  cancel: taskId => invoke('query.cancel', { taskId }), subscribe: listener => window.dbark?.onTask(event => { if (event.tableCreate) listener(event.taskId, event.tableCreate); }) ?? (() => {}),
};
