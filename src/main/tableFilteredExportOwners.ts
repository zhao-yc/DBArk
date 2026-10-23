import type { ColumnsInvocation } from './columnsMainCapabilities';
import type { TableFilteredExportOutput } from '../shared/tableFilteredExport';
import { tableFilteredExportText as text } from '../shared/tableFilteredExport';

interface OwnerRuntime {
  assert(owner: ColumnsInvocation): void;
  same(left: ColumnsInvocation, right: ColumnsInvocation): boolean;
  stop(taskId: string): Promise<unknown>;
}
interface Operation {
  taskId: string; owner: ColumnsInvocation; assertCurrent(): void; sent: boolean; invalid: boolean;
  stop?: Promise<void>; stopFailure?: unknown; listeners: { event: string; callback(): void }[];
}
export interface TableFilteredExportMainLease {
  beforeSend(): void;
  settle(value: unknown): Promise<TableFilteredExportOutput>;
  failed(reason: unknown): Promise<never>;
  release(): Promise<void>;
}

/** 文件副作用的来源门：失效后取消并等待原任务；真实提交成功不能被晚发布检查改写。 */
export class TableFilteredExportOwners {
  private readonly active = new Map<string, Operation>();
  constructor(private readonly runtime: OwnerRuntime) {}
  has(taskId: string): boolean { return this.active.has(taskId); }
  /** 最后await恢复时重新读取原取消承诺，不能遗漏等待期间才登记的取消。 */
  private async waitForStop(operation: Operation): Promise<void> {
    let observed: Promise<void> | undefined;
    do { observed = operation.stop; if (observed) await observed; } while (observed !== operation.stop);
  }
  /** 原生导航、连接变更或进度都只撤销原任务一次，不启动替代导出或重复KILL。 */
  private invalidate(operation: Operation): void {
    operation.invalid = true;
    if (!operation.sent || operation.stop) return;
    operation.stop = Promise.resolve().then(() => this.runtime.stop(operation.taskId)).then(() => undefined).catch(reason => { operation.stopFailure = reason; });
  }
  /** 检查异常只触发精确取消，不能从事件监听器抛错打断主进程收尾。 */
  private check(operation: Operation): void {
    if (this.active.get(operation.taskId) !== operation) return;
    try { this.runtime.assert(operation.owner); operation.assertCurrent(); }
    catch { this.invalidate(operation); }
  }
  /** 连接配置的同步修改点在写盘后调用；也供原任务进度复核存活来源。 */
  observe(taskId?: string): void {
    if (taskId !== undefined) { const operation = this.active.get(taskId); if (operation) this.check(operation); }
    else for (const operation of this.active.values()) this.check(operation);
  }
  /** 只有真实同一主文档可主动取消本任务；新文档不能冒用旧任务编号。 */
  async cancel(taskId: string, owner: ColumnsInvocation): Promise<void> {
    const operation = this.active.get(taskId);
    if (!operation || !this.runtime.same(operation.owner, owner)) throw Error(text.stale);
    this.invalidate(operation);
    // 尚在Main文件预留阶段也须登记用户取消；runtime只撤销原准备，不会向引擎发送不存在的任务。
    if (!operation.sent && !operation.stop) operation.stop = Promise.resolve().then(() => this.runtime.stop(operation.taskId)).then(() => undefined).catch(reason => { operation.stopFailure = reason; });
    await this.waitForStop(operation);
    if (operation.stopFailure) throw operation.stopFailure;
  }
  /** 原始归属在任何文件预留await前登记，导航期间不能投递迟到的旧筛选。 */
  begin(taskId: string, owner: ColumnsInvocation, assertCurrent: () => void): TableFilteredExportMainLease {
    if (this.active.has(taskId)) throw Error('导出任务编号已使用');
    this.runtime.assert(owner); assertCurrent();
    const operation: Operation = { taskId, owner, assertCurrent, sent: false, invalid: false, listeners: [] };
    this.active.set(taskId, operation);
    const contents = owner.owner.contents;
    for (const event of ['did-start-navigation', 'did-navigate', 'render-process-gone', 'destroyed']) {
      const callback = () => this.check(operation); contents.on(event as 'destroyed', callback); operation.listeners.push({ event, callback });
    }
    let released = false;
    /** 等待与拆监听在同一恢复轮次结算；不能漏掉外层await期间才加入的取消。 */
    const release = async () => {
      if (released) return;
      for (;;) {
        const observed = operation.stop; await observed;
        if (observed !== operation.stop) continue;
        released = true;
        for (const { event, callback } of operation.listeners) contents.removeListener(event as 'destroyed', callback);
        if (this.active.get(taskId) === operation) this.active.delete(taskId);
        return;
      }
    };
    return {
      beforeSend: () => {
        this.check(operation);
        if (operation.invalid || this.active.get(taskId) !== operation) throw Error(text.stale);
        operation.sent = true;
      },
      settle: async value => {
        this.check(operation); await release();
        const result = value as Partial<TableFilteredExportOutput> | null;
        // 已提交文件优先于晚来源失效或取消失败；不能误导用户重放覆盖原件。
        if (result?.fileCommitted === true && Number.isSafeInteger(result.rows) && result.rows! >= 0) return { rows: result.rows!, fileCommitted: true };
        if (operation.stopFailure) throw operation.stopFailure;
        throw Error(operation.invalid ? text.stale : '导出未返回可信文件提交事实，请核对所选文件，不要自动重试。');
      },
      failed: async reason => {
        await release();
        if (operation.stopFailure) throw new AggregateError([reason, operation.stopFailure], '原导出失败且取消收尾失败；请核对文件及服务器资源，不要自动重放。', { cause: reason });
        throw reason;
      },
      release,
    };
  }
}
