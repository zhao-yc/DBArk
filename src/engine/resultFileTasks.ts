import type { ResultExportOptions, TaskEvent } from '../shared/contracts';
import { resultExportColumns, validateResultExportData } from '../shared/resultExport';
import { csvCell, csvHeader, encodingName } from './files';
import { AtomicFile, nativeAtomicFileIO, type AtomicFileIO } from './atomicFile';

export type ResultFileIO = AtomicFileIO;
interface FileTask { cancelled: boolean; committing: boolean; done: Promise<void>; finish(): void; }

/** 结果文件任务完全独立于数据库连接；取消和退出都等待文件关闭及临时文件清理。 */
export class ResultFileTasks {
  private readonly tasks = new Map<string, FileTask>();
  private closing = false;
  /** 可注入文件接口以验证磁盘短写、取消竞态及失败时的目标文件保护。 */
  constructor(private readonly emit: (event: TaskEvent) => void, private readonly io: ResultFileIO = nativeAtomicFileIO) {}
  /** 统一任务编号空间，禁止与数据库任务重名。 */
  has(id: string): boolean { return this.tasks.has(id); }
  /** 原子替换已开始时不能声称撤销，之前的所有阶段均可取消。 */
  cancel(id: string): void { const task = this.tasks.get(id); if (task && !task.committing) task.cancelled = true; }
  /** 停止接收新任务并等待已有任务在取消边界清理资源。 */
  async closeAll(): Promise<void> {
    this.closing = true; const active = [...this.tasks.entries()];
    active.forEach(([id]) => this.cancel(id)); await Promise.all(active.map(([, task]) => task.done));
  }
  /** 仅写出传入的已返回行，永远不解析或重新执行原 SQL。 */
  async run(input: ResultExportOptions & { filePath: string }): Promise<{ rows: number }> {
    if (this.closing) throw new Error('客户端正在退出，不能启动结果导出');
    if (!input.taskId || this.has(input.taskId)) throw new Error('任务编号为空或任务已在执行');
    if (!input.filePath) throw new Error('主进程未提供已授权文件路径');
    if (!['csv', 'json'].includes(input.format)) throw new Error('结果仅支持 CSV 或 JSON 导出');
    validateResultExportData(input.result); const encoding = encodingName(input.encoding);
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const task: FileTask = { cancelled: false, committing: false, done, finish }; this.tasks.set(input.taskId, task);
    const columns = resultExportColumns(input.result.columns);
    let file: AtomicFile | undefined; let count = 0;
    /** 每批写入和原子替换前均检查取消，不能在已取消时替换用户原文件。 */
    const checkCancelled = () => { if (task.cancelled) throw new Error('结果导出已取消，原目标文件保持不变'); };
    /** 共用有界原子 IO，旧入口仍只处理已经返回的行，不获得 SQL 执行能力。 */
    const write = (text: string) => file!.write(text);
    this.emit({ taskId: input.taskId, status: 'running', progress: 0, rows: 0, message: `正在导出已返回的 ${input.result.rows.length} 行` });
    try {
      file = await AtomicFile.create(input.filePath, encoding, checkCancelled, () => { task.committing = true; }, this.io);
      if (encoding === 'utf16le') await write('\uFEFF');
      await write(input.format === 'csv' ? columns.map(column => csvHeader(column.exportName)).join(',') + '\r\n' : '[\n');
      for (const row of input.result.rows) {
        // 按列描述顺序取值，不能依赖行对象的枚举顺序；手工构造 JSON 键值对保留原型同名键。
        await write(input.format === 'csv'
          ? columns.map(column => csvCell(row[column.key])).join(',') + '\r\n'
          : (count ? ',\n' : '') + '{' + columns.map(column => JSON.stringify(column.exportName) + ':' + JSON.stringify(row[column.key])).join(',') + '}');
        count++;
        if (count % 250 === 0) this.emit({ taskId: input.taskId, status: 'running', progress: Math.floor(count / input.result.rows.length * 98), rows: count, message: `已写入 ${count}/${input.result.rows.length} 行` });
      }
      if (input.format === 'json') await write('\n]\n');
      await file.commit();
      this.emit({ taskId: input.taskId, status: 'completed', progress: 100, rows: count, message: `已导出 ${count} 行已返回结果` });
      return { rows: count };
    } catch (error) {
      this.emit({ taskId: input.taskId, status: task.cancelled ? 'cancelled' : 'failed', progress: 0, rows: count, message: error instanceof Error ? error.message : '结果导出失败' });
      throw error;
    } finally {
      try { await file?.dispose(); }
      finally { this.tasks.delete(input.taskId); task.finish(); }
    }
  }
}
