import type { ExcelTransferServices } from '../shared/excelTransfer';
import { invoke } from './lib';

/** 稳定服务对象直连正式白名单 IPC；文件与目标元数据持有独立、可取消的任务编号。 */
export const excelTransferServices: ExcelTransferServices = {
  chooseFile: (mode, suggestedName) => invoke('files.choose', { purpose: mode, format: 'xlsx', suggestedName }),
  listSheets: (fileToken, taskId = crypto.randomUUID()) => invoke('excel.sheets', { fileToken, taskId }),
  preview: input => invoke('excel.preview', { ...input, taskId: input.taskId ?? crypto.randomUUID() }),
  targetColumns: async (target, taskId) => (await invoke('metadata.table', { ...target, taskId })).columns.filter(column => !column.generated),
  exportTable: input => invoke('excel.export', input),
  importTable: input => invoke('excel.import', input),
  cancel: taskId => invoke('query.cancel', { taskId }),
};
