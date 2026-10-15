interface OwnedRead { id: string; submitted: boolean; settled: boolean; cancellation?: Promise<void>; }
interface ReadBatch { tasks: OwnedRead[]; cancelled: boolean; failure?: unknown; cancellationError?: unknown; done: Promise<void>; }

/** 文件与元数据组成一个读取批次；任一失败即取消双方，全部任务和取消 RPC 收尾后才释放占位。 */
export class ExcelPreviewTasks {
  private readonly active = new Set<ReadBatch>();
  private serial = 0;
  private disposed = false;
  constructor(private readonly cancelTask: (id: string) => Promise<void>, private readonly createId: () => string = () => crypto.randomUUID()) {}
  get busy(): boolean { return this.active.size > 0; }
  /** React 严格模式重放挂载时恢复接收资格，旧批次仍由 serial 和实际收尾保护。 */
  activate(): void { this.disposed = false; }

  /** 单文件清单也走同一所有权与取消策略。 */
  async single<T>(execute: (taskId: string) => Promise<T>): Promise<T> { return (await this.run([execute]))[0] as T; }
  /** 两个请求独立编号，返回值保持文件预览与元数据的固定顺序。 */
  async pair<A, B>(first: (taskId: string) => Promise<A>, second: (taskId: string) => Promise<B>): Promise<[A, B]> { return await this.run([first, second]) as [A, B]; }

  /** 同步撤销旧批次资格，再等待真实任务及 RPC；迟到批次不能在新上下文开始后重新提交。 */
  async cancel(): Promise<void> { this.serial++; await this.stopAll(); }
  /** 卸载后撤销未提交请求，并保留已有任务的实际清理等待。 */
  async dispose(): Promise<void> { this.disposed = true; await this.cancel(); }
  /** 取消 RPC 失败不放弃任务 Promise，不能提前声称连接或文件已释放。 */
  private async stopAll(): Promise<void> {
    const batches = [...this.active]; batches.forEach(batch => this.requestCancellation(batch));
    await Promise.all(batches.map(batch => batch.done));
    const failed = batches.find(batch => batch.cancellationError !== undefined);
    if (failed) throw failed.cancellationError;
  }
  /** 只取消本批已提交且尚未结束的编号，每个 RPC 最多发送一次。 */
  private requestCancellation(batch: ReadBatch): void {
    batch.cancelled = true;
    for (const task of batch.tasks) {
      if (!task.submitted || task.settled || task.cancellation) continue;
      task.cancellation = Promise.resolve().then(() => this.cancelTask(task.id)).catch(reason => { batch.cancellationError ??= reason; });
    }
  }
  /** 后续批次先等待旧批次；失败原因和取消错误分别保留，全部收尾后再交付结果。 */
  private async run(operations: ((taskId: string) => Promise<unknown>)[]): Promise<unknown[]> {
    const serial = ++this.serial; await this.stopAll();
    if (this.disposed || serial !== this.serial) throw new Error('Excel 预览读取已取消');
    let finish!: () => void;
    const batch: ReadBatch = { tasks: operations.map(() => ({ id: this.createId(), submitted: false, settled: false })), cancelled: false, done: new Promise<void>(resolve => { finish = resolve; }) };
    this.active.add(batch);
    try {
      const results = await Promise.allSettled(operations.map(async (execute, index) => {
        const task = batch.tasks[index];
        try {
          if (batch.cancelled) throw new Error('Excel 预览读取已取消');
          task.submitted = true; return await execute(task.id);
        } catch (reason) {
          if (!batch.cancelled) batch.failure = reason;
          task.settled = true; this.requestCancellation(batch); throw reason;
        } finally { task.settled = true; }
      }));
      await Promise.all(batch.tasks.map(task => task.cancellation));
      if (batch.cancellationError !== undefined) throw batch.cancellationError;
      if (batch.failure !== undefined) throw batch.failure;
      if (batch.cancelled) throw new Error('Excel 预览读取已取消');
      return results.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
    } finally { this.active.delete(batch); finish(); }
  }
}
