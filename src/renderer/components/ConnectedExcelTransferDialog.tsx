import { useState } from 'react';
import type { ExcelTransferTarget } from '../../shared/excelTransfer';
import { excelTransferServices } from '../excelTransferServices';
import { useWorkspace } from '../store';
import { ExcelTransferDialog } from './ExcelTransferDialog';

/** 复用工作台任务事件与现有导入导出入口，不创建旁路文件或数据库权限。 */
export function ConnectedExcelTransferDialog(props: ExcelTransferTarget & { mode: 'import' | 'export'; onClose(): void; onBack(): void }) {
  const [taskId, setTaskId] = useState('');
  const task = useWorkspace(state => state.tasks.find(item => item.id === taskId));
  return <ExcelTransferDialog {...props} services={excelTransferServices} onTaskStart={setTaskId} progress={task}/>;
}
