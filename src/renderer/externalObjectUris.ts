import type { ExternalObjectUriRequest, ExternalObjectUriState } from '../shared/externalObjectUris';
import type { WorkbenchTarget } from '../shared/workbench';
import { externalObjectUrisZh as text } from '../shared/externalObjectUris.zh-CN';
import type { OpenWorkbenchTarget } from './workbenchNavigation';

export interface ExternalObjectUriConsumerPorts {
  ready(): Promise<ExternalObjectUriState>;
  take(): Promise<ExternalObjectUriRequest | null>;
  resolve(id: string): Promise<WorkbenchTarget>;
  commit(id: string): Promise<{ committed: true }>;
  finish(id: string): Promise<ExternalObjectUriState>;
  open: OpenWorkbenchTarget;
  canNavigate(): boolean;
  captureIntent(): unknown;
  isIntentCurrent(scope: unknown): boolean;
  notify(error: string): void;
}
interface Operation { scope: unknown; request?: ExternalObjectUriRequest; notification: number; invalid: boolean; controller: AbortController; waiting: boolean; commitSubmitted: boolean; pendingAtProjection?: { scope: unknown; notification: number }; projectedScope?: unknown; projected: boolean; }

/** 系统通知仅唤醒单个原操作；所有IO按原Promise结算，最新待处理意图始终有界。 */
export function createExternalObjectUriConsumer(ports: ExternalObjectUriConsumerPorts) {
  const stopped = Symbol('原对象链接意图已撤销');
  let started = false, disposed = false, halted = false, initialized = false, running = false, queued = false;
  let pending = false, pendingScope: unknown, hasPendingScope = false, notifications = 0, emptySupplementUsed = false, parked = false;
  let active: Operation | undefined;
  const waiters = new Set<() => void>();
  /** 所有权检查异常同样不能授权投影；旧回包不通过重新捕获当前页面获得新身份。 */
  function intentCurrent(scope: unknown): boolean { try { return ports.isIntentCurrent(scope) === true; } catch { return false; } }
  function valid(operation: Operation): boolean { return !disposed && !halted && !operation.invalid && active === operation && !operation.controller.signal.aborted && intentCurrent(operation.scope); }
  function navigable(): boolean { try { return ports.canNavigate() === true; } catch { return false; } }
  function releaseWaiters(): void { for (const resolve of [...waiters]) resolve(); waiters.clear(); }
  /** 只投递固定文案；底层异常不回显原URI、命令行、SQL或凭据。 */
  function notify(scope: unknown, message: string): void { if (!disposed && intentCurrent(scope)) { try { ports.notify(message); } catch { /* 通知异常不能跳过原finish。 */ } } }
  function notifyOperation(operation: Operation, message: string): void {
    if (!disposed && !operation.invalid && notifications === operation.notification) notify(operation.projected ? operation.projectedScope : operation.scope, message);
  }
  /** DOM/React提交显式唤醒，无数据库轮询；撤销只解除本地等待，不冒充IO取消。 */
  async function waitNavigable(operation: Operation): Promise<void> {
    while (valid(operation)) {
      if (navigable()) return;
      operation.waiting = true;
      await new Promise<void>(resolve => waiters.add(resolve));
      operation.waiting = false;
    }
    throw stopped;
  }
  /** ready只握手一次；失败保留边界，不由wake隐式重放。 */
  async function initialize(): Promise<void> {
    running = true;
    let scope: unknown;
    try {
      scope = ports.captureIntent();
      const state = await ports.ready();
      if (disposed) return;
      if (!state || typeof state.pending !== 'boolean' || typeof state.active !== 'boolean') throw stopped;
      initialized = true;
      if (state.pending) { pending = true; if (!hasPendingScope) { pendingScope = scope; hasPendingScope = true; } }
    } catch { halted = true; notify(scope, text.resolveFailed); }
    finally { running = false; schedule(); }
  }
  /** 一个take即一个本地操作；原finish未结算前绝不开始后继。 */
  async function consume(): Promise<void> {
    running = true; queued = false;
    const operation: Operation = { scope: hasPendingScope ? pendingScope : ports.captureIntent(), notification: notifications, invalid: false, controller: new AbortController(), waiting: false, commitSubmitted: false, projected: false };
    active = operation; pending = false; hasPendingScope = false;
    const takeNotification = notifications;
    try {
      const request = await ports.take();
      if (request === null) {
        // take返回空期间的新通知最多补查一次；再次为空则保留通知，等待下一次显式wake。
        if (!disposed && notifications !== takeNotification && !emptySupplementUsed) { emptySupplementUsed = true; pending = true; }
        else parked = true;
        return;
      }
      operation.request = request; operation.notification = notifications; emptySupplementUsed = false;
      // take尚未领取ID时的新通知可能正属于返回的新请求，由Main resolve裁决其有效性。
      if (notifications !== takeNotification && hasPendingScope) operation.scope = pendingScope;
      if (!valid(operation)) return;
      await waitNavigable(operation);
      // 错误请求也先结算原finish；Main仍有新pending时不显示刚刚过期的旧输入错误。
      if (request.kind === 'error') return;
      const opened = await ports.open(request.target, {
        signal: operation.controller.signal,
        isCurrent: () => valid(operation),
        resolve: async () => { if (!valid(operation)) throw stopped; const target = await ports.resolve(request.id); if (!valid(operation)) throw stopped; return target; },
        beforeProject: async () => {
          await waitNavigable(operation);
          if (!valid(operation)) throw stopped;
          operation.commitSubmitted = true;
          const result = await ports.commit(request.id);
          if (!result || result.committed !== true) throw Error(text.notResolved);
          // commit回包期间若出现模态，仍等待原UI；手动意图及新通知可撤销本地等待。
          await waitNavigable(operation);
          if (!valid(operation)) throw stopped;
          if (hasPendingScope && intentCurrent(pendingScope)) operation.pendingAtProjection = { scope: pendingScope, notification: notifications };
        },
      });
      if (opened && !disposed) {
        operation.projected = true; operation.projectedScope = ports.captureIntent();
        // 只承接这一同步投影自身产生的workspace代次；排队URI不能被我们自己的select误作手动导航。
        const queuedIntent = operation.pendingAtProjection;
        if (queuedIntent && hasPendingScope && queuedIntent.scope === pendingScope && queuedIntent.notification === notifications) pendingScope = operation.projectedScope;
      }
    } catch (error) {
      if (!operation.request) { if (notifications === takeNotification) notifyOperation(operation, text.resolveFailed); halted = true; }
      if (error !== stopped && valid(operation)) {
        try { await waitNavigable(operation); if (valid(operation)) notifyOperation(operation, text.resolveFailed); } catch { /* 新意图、模态取消或卸载不显示旧错误。 */ }
      }
    } finally {
      const request = operation.request;
      if (request) {
        try {
          const state = await ports.finish(request.id);
          if (!state || typeof state.pending !== 'boolean' || typeof state.active !== 'boolean') throw Error(text.changed);
          if (!disposed) {
            pending = state.pending || notifications !== operation.notification;
            if (pending && !hasPendingScope) { pendingScope = operation.projected ? operation.projectedScope : operation.scope; hasPendingScope = true; }
            if (request.kind === 'error' && !state.pending && valid(operation)) notifyOperation(operation, text[request.code]);
          }
        } catch { notifyOperation(operation, text.resolveFailed); halted = true; }
      }
      if (active === operation) active = undefined;
      running = false; schedule();
    }
  }
  /** 首次同步占调度位，连点和同轮wake不能重复ready/take/resolve。 */
  function schedule(): void {
    if (!started || disposed || halted || !initialized || running || queued || parked || !pending || !navigable()) return;
    queued = true;
    void Promise.resolve().then(async () => {
      queued = false;
      if (disposed || halted || running || parked || !pending || !navigable()) return;
      try { await consume(); }
      catch { halted = true; notify(pendingScope, text.resolveFailed); running = false; }
    });
  }
  return {
    /** 先订阅外部空通知再调用start；StrictMode重复调用同实例也只有一次握手。 */
    start(): void { if (started || disposed) return; started = true; void initialize(); },
    /** 新URI撤销尚未commit的原投影；commit在途交Main裁决，后继仍等待原收尾。 */
    signal(): void {
      if (disposed) return;
      notifications++; pending = true;
      try { pendingScope = ports.captureIntent(); hasPendingScope = true; } catch { halted = true; }
      if (active?.request && (!active.commitSubmitted || active.waiting)) { active.invalid = true; active.controller.abort(); }
      if (!running) { parked = false; emptySupplementUsed = false; }
      releaseWaiters(); schedule();
    },
    /** 模态或React提交仅重核原意图，不制造新的请求或查询循环。 */
    wake(): void { if (disposed) return; if (!running) { parked = false; emptySupplementUsed = false; } releaseWaiters(); schedule(); },
    /** 卸载不终止原metadata/finish Promise；迟到take仍只finish它实际领取的原编号。 */
    dispose(): void { if (disposed) return; disposed = true; pending = false; if (active) { active.invalid = true; active.controller.abort(); } releaseWaiters(); },
  };
}
