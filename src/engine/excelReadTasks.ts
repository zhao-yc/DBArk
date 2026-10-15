import type { TaskEvent } from '../shared/contracts';
import { listExcelSheets, previewExcelSheet, type ExcelSheetReadOptions } from './excelFiles';

interface ReadTask { cancelled: boolean; done: Promise<void>; finish(): void; }

/** 工作簿读取也属于正式任务：取消和退出必须等 ZIP、XML 与文件句柄实际释放。 */
export class ExcelReadTasks {
  private readonly tasks = new Map<string, ReadTask>();
  private closing = false;
  constructor(private readonly emit: (event: TaskEvent) => void) {}
  has(id: string): boolean { return this.tasks.has(id); }
  /** 读取循环逐块检查取消；RPC 收尾前等待读取器 finally 关闭句柄。 */
  async cancel(id: string): Promise<void> { const task = this.tasks.get(id); if (task) { task.cancelled = true; await task.done; } }
  async closeAll(): Promise<void> { this.closing = true; await Promise.all([...this.tasks.keys()].map(id => this.cancel(id))); }
  async run(command: 'excel.sheets' | 'excel.preview', input: ExcelSheetReadOptions & { taskId: string }): Promise<unknown> {
    if (this.closing || !input.taskId || this.has(input.taskId)) throw new Error('Excel 读取任务编号为空、已在执行或客户端正在退出');
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const task: ReadTask = { cancelled: false, done, finish }; this.tasks.set(input.taskId, task);
    const checkCancelled = () => { if (task.cancelled) throw new Error('Excel 工作簿读取已取消'); };
    this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: '正在校验 Excel 工作簿' });
    try {
      const options = { ...input, checkCancelled };
      const result = command === 'excel.sheets' ? await listExcelSheets(options) : await previewExcelSheet(options);
      checkCancelled(); this.emit({ taskId: input.taskId, status: 'completed', progress: 100, message: 'Excel 工作簿读取完成' }); return result;
    } catch (reason) {
      this.emit({ taskId: input.taskId, status: task.cancelled ? 'cancelled' : 'failed', progress: 0, message: reason instanceof Error ? reason.message : 'Excel 工作簿读取失败' }); throw reason;
    } finally { this.tasks.delete(input.taskId); task.finish(); }
  }
}
