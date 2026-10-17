import type { ConnectionResourceRecovery } from './connectionResourceState';

export interface IndependentTaskResourceLease {
  /** 建连之前捕获物理资源facade，覆盖尚未返回ManagedConnection就失败的分配。 */
  capture(resources: ConnectionResourceRecovery | undefined): void;
  /** 动作与关闭均离开后结算；未知资源保留任务号和全部目标锁。 */
  settle(closeFailed: boolean): boolean;
}
interface Entry {
  connectionId: string; resources: Set<ConnectionResourceRecovery>; unknown: boolean;
  finished: boolean; closeFailed: boolean; releaseTargets: () => void; recovering?: Promise<boolean>;
}

/** 独立任务的物理资源隔离账本；有界预留先于网络分配，不保存SQL、凭据或原错误。 */
export class IndependentTaskResources {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly capacity = 64, private readonly recoveryMs = 2500) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 128 || !Number.isSafeInteger(recoveryMs) || recoveryMs < 1 || recoveryMs > 3000) throw Error('独立资源登记预算无效');
  }
  owns(taskId: string): boolean { return this.entries.has(taskId); }
  retained(connectionId: string): boolean { return [...this.entries.values()].some(entry => entry.connectionId === connectionId && entry.finished); }
  /** 调用者在获取目标锁后同步预留；失败时由调用者立即归还刚获取的锁。 */
  reserve(connectionId: string, taskId: string, releaseTargets: () => void): IndependentTaskResourceLease {
    if (this.entries.has(taskId)) throw Error('独立任务编号仍被资源占用，请先显式断开连接');
    if (this.entries.size >= this.capacity) throw Error('独立任务资源登记已达上限，请等待任务完成或显式断开连接');
    const entry: Entry = { connectionId, resources: new Set(), unknown: false, finished: false, closeFailed: false, releaseTargets };
    this.entries.set(taskId, entry);
    return Object.freeze({
      capture: (resources: ConnectionResourceRecovery | undefined) => {
        if (!resources || entry.resources.has(resources)) return;
        // 一次主建连及两类互斥控制连接远小于此预算；异常扩张保持未知，不假装已全量回收。
        if (entry.resources.size >= 4) { entry.unknown = true; return; }
        entry.resources.add(resources);
      },
      settle: (closeFailed: boolean) => {
        entry.finished = true; entry.closeFailed ||= closeFailed;
        return this.releaseIfClosed(taskId, entry);
      },
    });
  }
  /** 生产connect始终提供facade；旧内部端口仅在严格关闭未失败时保留原合同。 */
  private confirmed(entry: Entry): boolean {
    if (!entry.finished || entry.unknown) return false;
    if (entry.resources.size === 0) return !entry.closeFailed;
    try { return [...entry.resources].every(resources => resources.snapshot().confirmedClosed); } catch { return false; }
  }
  /** 目标集合的释放器只调用一次；异常时仍保留占位，绝不先删账本。 */
  private releaseIfClosed(taskId: string, entry: Entry): boolean {
    if (this.entries.get(taskId) !== entry) return true;
    if (!this.confirmed(entry)) return false;
    try { entry.releaseTargets(); } catch { entry.unknown = true; return false; }
    this.entries.delete(taskId); return true;
  }
  /** 显式断开/退出才恢复；同一条目的并发请求合并，超时保留原资源供后续人工重试。 */
  async recover(connectionId?: string): Promise<{ released: number; remaining: number }> {
    const selected = [...this.entries].filter(([, entry]) => entry.finished && (connectionId === undefined || entry.connectionId === connectionId));
    const results = await Promise.all(selected.map(([taskId, entry]) => {
      if (entry.recovering) return entry.recovering;
      const work = (async () => {
        if (this.releaseIfClosed(taskId, entry)) return true;
        // 不重试原ManagedConnection.close的缓存拒绝；每个facade只请求真实资源的有界恢复。
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.allSettled([...entry.resources].map(resources => Promise.resolve().then(() => resources.recover()))),
            new Promise<void>(resolve => { timer = setTimeout(resolve, this.recoveryMs); timer.unref(); }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
        return this.releaseIfClosed(taskId, entry);
      })();
      entry.recovering = work;
      void work.finally(() => { if (entry.recovering === work) entry.recovering = undefined; }).catch(() => undefined);
      return work;
    }));
    return { released: results.filter(Boolean).length, remaining: [...this.entries.values()].filter(entry => entry.finished && (connectionId === undefined || entry.connectionId === connectionId)).length };
  }
}
