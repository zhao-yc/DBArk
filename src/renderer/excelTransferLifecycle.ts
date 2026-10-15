/** 任务占位独立于目标上下文；旧任务收尾前，新上下文也不能启动第二个任务。 */
export interface ExcelTaskSnapshot { busy: boolean; waitingForPrevious: boolean; cancellationError: string; }
interface OwnedTask {
  id: string; generation: number; contextKey: string; reservationKey: string; submitted: boolean; finished: boolean;
  cancellationRequested: boolean; cancellationIssued: boolean; cancellation?: Promise<void>;
  cancel(taskId: string): Promise<void>;
}
interface ExcelTaskRun<T> {
  taskId: string; contextKey: string; prepare?(): void;
  execute(): Promise<T>; cancel(taskId: string): Promise<void>;
  success(result: T): void; failure(reason: unknown): void;
}

/** 管理自有任务的发布资格与取消。控制器捕获提交时的服务，永远不取消其它任务。 */
export class ExcelTransferLifecycle {
  private static readonly reservations = new Map<string, OwnedTask>();
  private static readonly observers = new Set<ExcelTransferLifecycle>();
  private generation = 0;
  private contextKey = '';
  private reservationKey = '';
  private mounted = false;
  private active?: OwnedTask;
  private listener?: (snapshot: ExcelTaskSnapshot) => void;
  private cancellationError = '';

  get busy(): boolean { return !!this.active || ExcelTransferLifecycle.reservations.has(this.reservationKey); }
  get ownsActiveTask(): boolean { return !!this.active; }
  get lastCancellationError(): string { return this.cancellationError; }
  get snapshot(): ExcelTaskSnapshot {
    return { busy: this.busy, waitingForPrevious: this.busy && (!this.active || !this.isCurrent(this.active)), cancellationError: this.active && this.isCurrent(this.active) ? this.cancellationError : '' };
  }

  /** 每次挂载/上下文切换使用新代次；即使从 A 返回 A，旧 A 的响应也不能恢复发布资格。 */
  attach(contextKey: string, listener: (snapshot: ExcelTaskSnapshot) => void, reservationKey = contextKey): void {
    this.generation++; this.contextKey = contextKey; this.reservationKey = reservationKey; this.mounted = true; this.listener = listener;
    ExcelTransferLifecycle.observers.add(this);
    if (this.active) this.requestCancellation(this.active);
    this.publish();
  }

  /** 卸载先撤销发布资格，再取消已提交的自有任务；取消拒绝保存在可观察状态中。 */
  detach(): void {
    this.generation++; this.mounted = false; this.listener = undefined;
    ExcelTransferLifecycle.observers.delete(this);
    if (this.active) this.requestCancellation(this.active);
  }

  /** 用户取消只针对当前控制器拥有的编号，未提交时不发送无主取消请求。 */
  cancel(): Promise<void> {
    if (!this.active) return Promise.resolve();
    this.requestCancellation(this.active);
    return this.active.cancellation ?? Promise.resolve();
  }

  /** 同步占位拦截双击；提交前让出一个微任务，关闭或切换可以直接撤销尚未发出的请求。 */
  async run<T>(input: ExcelTaskRun<T>): Promise<boolean> {
    if (!this.mounted || this.busy || input.contextKey !== this.contextKey) return false;
    const task: OwnedTask = { id: input.taskId, generation: this.generation, contextKey: input.contextKey, reservationKey: this.reservationKey, submitted: false, finished: false, cancellationRequested: false, cancellationIssued: false, cancel: input.cancel };
    this.active = task; this.cancellationError = ''; ExcelTransferLifecycle.reservations.set(task.reservationKey, task); ExcelTransferLifecycle.publishReservations();
    try {
      await Promise.resolve();
      if (!this.isCurrent(task) || task.cancellationRequested) return true;
      input.prepare?.();
      if (!this.isCurrent(task) || task.cancellationRequested) return true;
      // execute 若同步抛错，视为未提交；若调用内部触发切换，等返回 Promise 后补发稳定旧服务的取消。
      const completion = input.execute();
      task.submitted = true;
      if (task.cancellationRequested || !this.isCurrent(task)) this.requestCancellation(task);
      const result = await completion; task.finished = true;
      if (this.isCurrent(task)) input.success(result);
    } catch (reason) {
      task.finished = true;
      if (this.isCurrent(task)) input.failure(reason);
    } finally {
      task.finished = true;
      // 请求取消完成不等于任务结束；反过来，任务结束也要观察已发出的取消 RPC 再释放占位。
      if (task.cancellation) await task.cancellation;
      if (this.active === task) this.active = undefined;
      if (ExcelTransferLifecycle.reservations.get(task.reservationKey) === task) ExcelTransferLifecycle.reservations.delete(task.reservationKey);
      // 此处发布的是当前代次的占位状态，不携带旧代次结果或错误。
      ExcelTransferLifecycle.publishReservations();
    }
    return true;
  }

  private isCurrent(task: OwnedTask): boolean {
    return this.mounted && this.active === task && task.generation === this.generation && task.contextKey === this.contextKey;
  }

  /** 同一自有任务只发一次取消，兼容取消服务同步抛错与异步拒绝，并始终观察结果。 */
  private requestCancellation(task: OwnedTask): void {
    if (task.finished) return;
    task.cancellationRequested = true;
    if (!task.submitted || task.cancellationIssued) return;
    task.cancellationIssued = true;
    task.cancellation = Promise.resolve().then(() => task.cancel(task.id)).catch(reason => {
      this.cancellationError = reason instanceof Error ? reason.message : 'Excel 任务取消失败';
      this.publish();
    });
  }

  /** 没有挂载中的监听器时只保留状态，不触发已卸载 React 组件的更新。 */
  private publish(): void { if (this.mounted) this.listener?.(this.snapshot); }

  /** 登记只存连接/库/表键和在途自有任务；完成时精确删除，等待者卸载即移除监听。 */
  private static publishReservations(): void { for (const observer of this.observers) observer.publish(); }
}
