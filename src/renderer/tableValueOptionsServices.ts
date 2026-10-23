import type { TableValueOptionsServices } from './components/TableValueOptionsDialog';
import { invoke } from './lib';

/** 正式入口只投递有类型只读任务；取消仍等待原读取Promise实际收尾。 */
export const tableValueOptionsServices: TableValueOptionsServices = {
  read: input => invoke('table.valueOptions', input),
  cancel: taskId => invoke('query.cancel', { taskId }),
};
