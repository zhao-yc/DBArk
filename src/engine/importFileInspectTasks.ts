import type { TaskEvent } from '../shared/contracts';
import type { ImportFileInspectInput, ImportFileInspectOutput } from '../shared/importNewTable';
import { inspectImportFile } from './importNewTableSource';

interface Inspection { controller: AbortController; done: Promise<void>; finish(): void; }
/** 扫描不建立数据库连接；取消及退出等待原读取流和句柄真正结束。 */
export class ImportFileInspectTasks {
  private readonly tasks = new Map<string, Inspection>();
  private closing = false;
  constructor(private readonly emit: (event: TaskEvent) => void) {}
  /** 与数据库、导出及其它文件任务共用编号检查，不重复登记同一请求。 */
  has(id: string): boolean { return this.tasks.has(id); }
  /** 中止原读取链并等待finally，控制请求返回不能替代原任务终态。 */
  async cancel(id: string): Promise<void> { const task = this.tasks.get(id); if (task) { task.controller.abort(); await task.done; } }
  /** 关闭先停止接单，再等待全部原读取任务；不重新打开源文件。 */
  async closeAll(): Promise<void> { this.closing = true; await Promise.all([...this.tasks.keys()].map(id => this.cancel(id))); }
  /** 进度仅报告记录及字节数，不把本机路径或源数据写入持久任务摘要。 */
  async run(input: ImportFileInspectInput & { filePath: string }): Promise<ImportFileInspectOutput> {
    if (this.closing || !input.taskId || this.has(input.taskId)) throw Error('扫描任务编号为空、已使用或客户端正在退出');
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const task: Inspection = { controller: new AbortController(), done, finish }; this.tasks.set(input.taskId, task);
    const check = () => { if (task.controller.signal.aborted) throw Error('导入文件扫描已取消'); };
    try {
      this.emit({ taskId: input.taskId, status: 'running', progress: 0, message: '正在完整扫描导入文件' });
      const result = await inspectImportFile(input, check, value => {
        check(); this.emit({ taskId: input.taskId, status: 'running', progress: 0, rows: value.records, message: `已扫描 ${value.records} 条记录、${value.bytes} 字节` });
      }, task.controller.signal);
      check(); this.emit({ taskId: input.taskId, status: 'completed', progress: 100, rows: result.records, message: '导入文件完整扫描完成' }); return result;
    } catch (reason) {
      this.emit({ taskId: input.taskId, status: task.controller.signal.aborted ? 'cancelled' : 'failed', progress: 0, message: task.controller.signal.aborted ? '导入文件扫描已取消' : '导入文件扫描失败，请核对文件与编码' }); throw reason;
    } finally { this.tasks.delete(input.taskId); task.finish(); }
  }
}
