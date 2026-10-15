import { useState } from 'react';
import type { ExcelTransferServices, ExcelTransferTarget } from '../../shared/excelTransfer';
import { invoke } from '../lib';
import { useWorkspace } from '../store';
import { ExcelTransferDialog } from './ExcelTransferDialog';

/** 稳定服务对象直连正式白名单 IPC；目标生成列由元数据过滤，后端仍重新核验。 */
const services: ExcelTransferServices = {
  chooseFile: (mode, suggestedName) => invoke('files.choose', { purpose: mode, format: 'xlsx', suggestedName }),
  listSheets: (fileToken, taskId = crypto.randomUUID()) => invoke('excel.sheets', { fileToken, taskId }),
  preview: input => invoke('excel.preview', { ...input, taskId: input.taskId ?? crypto.randomUUID() }),
  targetColumns: async target => (await invoke('metadata.table', target)).columns.filter(column => !column.generated),
  exportTable: input => invoke('excel.export', input),
  importTable: input => invoke('excel.import', input),
  cancel: taskId => invoke('query.cancel', { taskId }),
};

/** 复用工作台任务事件与现有导入导出入口，不创建旁路文件或数据库权限。 */
export function ConnectedExcelTransferDialog(props: ExcelTransferTarget & { mode: 'import' | 'export'; onClose(): void; onBack(): void }) {
  const [taskId, setTaskId] = useState('');
  const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  return <ExcelTransferDialog {...props} services={services} onTaskStart={setTaskId} progress={task}/>;
}
