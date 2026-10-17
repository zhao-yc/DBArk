import { serverMonitorLimits, type ServerMonitorInput, type ServerMonitorSnapshot } from '../shared/serverMonitor';
import { serverMonitorZhCN as t } from './serverMonitorZh';

export interface ServerMonitorServices {
  /** Root接到独立只读短会话；Promise在原读取及严格释放处理后落定，拒绝不代表资源释放成功。 */
  read(input: ServerMonitorInput): Promise<ServerMonitorSnapshot>;
  /** 仅取消本组件的taskId；返回本身不能替代原read的资源收尾证明。 */
  cancel(taskId: string): Promise<unknown>;
}
export interface ServerMonitorTarget { connectionId: string; connectionRevision: number; }
export interface ServerMonitorViewState {
  target?: ServerMonitorTarget; snapshot?: ServerMonitorSnapshot;
  busy: boolean; waiting: boolean; automatic: boolean; remaining: number; error?: string;
}
interface Pending {
  taskId: string; generation: number; services: ServerMonitorServices;
  submitted: boolean; cancelled: boolean; done: Promise<void>; cancelPromise?: Promise<void>;
}
export const serverMonitorAutomaticRounds = 60;

/** 沿用609c886的串行读取/原Promise收尾设计；同一控制器横跨连接、修订与开关生命周期。 */
export class ServerMonitorController {
  private generation = 0;
  private active = false;
  private pending?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  private barrier: Promise<void> = Promise.resolve();
  private services?: ServerMonitorServices;
  private view: ServerMonitorViewState = { busy: false, waiting: false, automatic: false, remaining: 0 };
  constructor(private readonly publish: (view: ServerMonitorViewState) => void, private readonly createId: () => string = () => crypto.randomUUID()) {}

  /** 所有快照只在窗口内存中发布；完整替换状态，不保留旧连接的概要或SQL。 */
  private update(patch: Partial<ServerMonitorViewState>): void { this.view = { ...this.view, ...patch }; this.publish(this.view); }
  private clearTimer(): void { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  private accepts(pending: Pending): boolean { return this.active && this.pending === pending && this.generation === pending.generation; }

  /** 取消始终绑定原services和taskId，重复关闭/隐藏不会重复发送取消。 */
  private cancelPending(pending: Pending): void {
    pending.cancelled = true;
    if (!pending.submitted || pending.cancelPromise) return;
    pending.cancelPromise = Promise.resolve().then(() => pending.services.cancel(pending.taskId)).then(() => undefined, () => {
      if (this.accepts(pending)) this.update({ error: t.cancelUnconfirmed });
    });
  }
  /** 关闭先撤销接收权，等待原read及取消控制落定；此Promise不是物理资源已释放的证明。 */
  stop(): Promise<void> {
    ++this.generation; this.active = false; this.clearTimer();
    const pending = this.pending; if (pending) this.cancelPending(pending);
    this.barrier = Promise.allSettled([this.barrier, pending?.done]).then(() => undefined);
    return this.barrier;
  }
  /** 目标变化立即清空旧快照；原连接释放前，新连接和ABA重开都不提交新读取。 */
  async start(target: ServerMonitorTarget, services: ServerMonitorServices): Promise<void> {
    const stopped = this.stop(), generation = this.generation;
    this.services = services;
    this.view = { target: { ...target }, busy: true, waiting: true, automatic: false, remaining: 0 };
    this.publish(this.view);
    await stopped;
    if (generation !== this.generation) return;
    if (!target.connectionId || !Number.isSafeInteger(target.connectionRevision) || target.connectionRevision < 0) { this.update({ busy: false, waiting: false, error: t.targetUnavailable }); return; }
    this.active = true; this.update({ busy: false, waiting: false }); await this.refresh();
  }
  /** 自动刷新最多60轮；每次原任务落定后再等至少5秒，不用setInterval堆积请求。 */
  setAutomatic(value: boolean): void {
    if (!this.active) return;
    this.clearTimer();
    this.update({ automatic: value, remaining: value ? this.view.automatic ? this.view.remaining : serverMonitorAutomaticRounds : 0 });
    this.schedule();
  }
  private schedule(): void {
    if (!this.active || !this.view.automatic || this.pending || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const remaining = this.view.remaining - 1;
      this.update({ remaining, automatic: remaining > 0 });
      void this.refresh();
    }, serverMonitorLimits.refreshMilliseconds);
  }
  /** 手动、自动和双击共用一个pending；服务同步抛错也走同一个收尾路径。 */
  refresh(): Promise<void> {
    if (!this.active || !this.services || !this.view.target) return this.barrier;
    if (this.pending) return this.pending.done;
    this.clearTimer();
    const target = this.view.target, services = this.services;
    let taskId: string; try { taskId = this.createId(); } catch { this.update({ error: t.readFailed, automatic: false, remaining: 0 }); return Promise.resolve(); }
    const pending: Pending = { taskId, services, generation: this.generation, submitted: false, cancelled: false, done: Promise.resolve() };
    this.pending = pending;
    pending.done = Promise.resolve().then(() => {
      if (!this.accepts(pending) || pending.cancelled) return undefined;
      pending.submitted = true;
      return services.read({ connectionId: target.connectionId, taskId, sessionLimit: serverMonitorLimits.defaultSessions });
    }).then(snapshot => {
      if (snapshot && this.accepts(pending) && !pending.cancelled) this.update({ snapshot });
    }, () => { if (this.accepts(pending) && !pending.cancelled) this.update({ error: t.readFailed, automatic: false, remaining: 0 }); }).finally(async () => {
      // 取消控制请求也属于本轮收尾；读完但取消控制未返回时仍不启动下一轮。
      if (pending.cancelPromise) await pending.cancelPromise;
      if (this.pending === pending) this.pending = undefined;
      if (this.active && pending.generation === this.generation) { this.update({ busy: false }); this.schedule(); }
    });
    this.update({ busy: true, error: undefined }); return pending.done;
  }
  /** 用户取消不丢原占位，同时停止自动轮询；旧快照保留但不接收取消后的迟到新快照。 */
  cancel(): Promise<void> {
    this.setAutomatic(false);
    const pending = this.pending; if (!pending) return Promise.resolve();
    this.cancelPending(pending); this.update({ error: t.cancelled }); return pending.done;
  }
}
