/** 仅用于Engine内部恢复；不把驱动句柄、配置或底层私密错误投影到界面。 */
export type ConnectionResourceKind = 'mysql-transport' | 'ssh-channel' | 'ssh-client';
export interface ConnectionResourceSnapshot {
  confirmedClosed: boolean; allocationSettled: boolean; pendingAllocations: number;
  ownedResources: number; pendingKinds: readonly ConnectionResourceKind[]; inventoryUnknown: boolean;
}
export interface ConnectionRecoveryResult { state: ConnectionResourceSnapshot; timedOut: boolean; actionFailed: boolean; }
export interface ConnectionResourceRecovery {
  /** 只读独立终态事实，不能从close成功/失败或destroy调用次数反推。 */
  snapshot(): ConnectionResourceSnapshot;
  /** 只供既有显式断开/退出路径调用；每次有界，不执行SQL，也不重试缓存的close Promise。 */
  recover(): Promise<ConnectionRecoveryResult>;
}
interface Resource {
  closed?: boolean; incoming?: { state?: string }; outgoing?: { state?: string };
  once?(event: string, listener: () => void): unknown; removeListener?(event: string, listener: () => void): unknown;
  destroy?(): unknown; close?(): unknown;
}
interface Entry { resource: Resource; kinds: Set<ConnectionResourceKind>; closeObserved: boolean; }

/** 一次物理建连的RAM归属：原始/TLS流、SSH channel/client及未结束的分配回调都独立保留。 */
export class ConnectionResourceOwner {
  private readonly entries: Entry[] = [];
  private readonly waiters = new Set<() => void>();
  private pendingAllocations = 0;
  private sealed = false;
  private inventoryUnknown = false;
  private expectsTransport = false;
  private recoveryPending?: Promise<ConnectionRecoveryResult>;
  /** facade没有注册/封账入口，调用方不能伪造确认或覆盖原资源。 */
  readonly recovery: ConnectionResourceRecovery = Object.freeze({ snapshot: () => this.snapshot(), recover: () => this.recover() });

  constructor(private readonly transport: () => unknown, private readonly destroyDriver: () => void, private readonly timeoutMs = 1000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) throw Error('连接恢复期限无效');
  }
  /** 异步分配在回调真正结束前保持未知；取消Promise结束不代表迟到channel不会到达。 */
  beginAllocation(): () => void {
    this.pendingAllocations++; let ended = false;
    return () => { if (ended) return; ended = true; this.pendingAllocations--; this.notify(); };
  }
  /** 记录实际资源身份，已知别名只登记一次；异常替换超过物理建连预算则永久保持未知。 */
  add(kind: ConnectionResourceKind, value: unknown): void {
    if (!value || typeof value !== 'object') { this.inventoryUnknown = true; return; }
    const resource = value as Resource, previous = this.entries.find(entry => entry.resource === resource);
    if (previous) { previous.kinds.add(kind); return; }
    if (this.entries.length >= 8) { this.inventoryUnknown = true; return; }
    const entry: Entry = { resource, kinds: new Set([kind]), closeObserved: false }; this.entries.push(entry);
    // SSH client只能由其自身close事件证明；channel的EOF/end不是双向CLOSE。
    try { resource.once?.('close', () => { entry.closeObserved = true; this.notify(); }); }
    catch { this.inventoryUnknown = true; }
    this.notify();
  }
  /** mysql2在TLS升级时替换stream，初始流与新流均属于本次物理连接。 */
  captureTransport(required = false): void {
    this.expectsTransport ||= required;
    try { const current = this.transport(); if (current) this.add('mysql-transport', current); }
    catch { this.inventoryUnknown = true; }
  }
  /** 成功或失败离开建连阶段才封账；仍未回调的分配继续阻止确认。 */
  seal(): void { this.sealed = true; this.captureTransport(); this.notify(); }
  /** 只认可资源自身的closed、双向channel协议关闭或close事件，不认可destroyed/end。 */
  private closed(entry: Entry): boolean {
    if (entry.closeObserved) return true;
    if (entry.kinds.has('ssh-client')) return false;
    try { return entry.resource.closed === true || entry.kinds.has('ssh-channel') && entry.resource.incoming?.state === 'closed' && entry.resource.outgoing?.state === 'closed'; }
    catch { return false; }
  }
  /** 读当前流同时保留全部原句柄；动态替换不能凭旧流关闭就获得完成证明。 */
  private snapshot(): ConnectionResourceSnapshot {
    this.captureTransport();
    const missingTransport = this.expectsTransport && !this.entries.some(entry => entry.kinds.has('mysql-transport'));
    const pending = new Set<ConnectionResourceKind>(); for (const entry of this.entries) if (!this.closed(entry)) for (const kind of entry.kinds) pending.add(kind);
    if (missingTransport) pending.add('mysql-transport');
    const inventoryUnknown = this.inventoryUnknown || missingTransport;
    return Object.freeze({ confirmedClosed: this.sealed && this.pendingAllocations === 0 && !inventoryUnknown && pending.size === 0, allocationSettled: this.sealed && this.pendingAllocations === 0, pendingAllocations: this.pendingAllocations, ownedResources: this.entries.length, pendingKinds: Object.freeze([...pending]), inventoryUnknown });
  }
  /** 唤醒等待仅发生在资源/分配状态变化；不派发SQL或自动释放host锁。 */
  private notify(): void { for (const notify of [...this.waiters]) notify(); }
  /** 只有显式调用才强制收尾；并发恢复合并，超时正常返回未确认状态供host保留隔离。 */
  private recover(): Promise<ConnectionRecoveryResult> {
    if (this.recoveryPending) return this.recoveryPending;
    let finish!: (result: ConnectionRecoveryResult) => void;
    const pending = new Promise<ConnectionRecoveryResult>(resolve => { finish = resolve; }); this.recoveryPending = pending;
    let settled = false, actionFailed = false, issuing = false;
    const complete = (timedOut: boolean): void => {
      if (settled || issuing && !timedOut) return;
      const state = this.snapshot(); if (!timedOut && !state.confirmedClosed) return;
      settled = true; clearTimeout(timer); this.waiters.delete(changed); this.recoveryPending = undefined;
      finish(Object.freeze({ state, timedOut: timedOut && !state.confirmedClosed, actionFailed }));
    };
    const changed = () => complete(false), timer = setTimeout(() => complete(true), this.timeoutMs); timer.unref(); this.waiters.add(changed);
    if (this.snapshot().confirmedClosed) { complete(false); return pending; }
    // destroy只是请求：即使调用不抛错，也必须等所有原资源各自的终态。
    const attempt = (action: () => void) => { try { action(); } catch { actionFailed = true; } };
    issuing = true; attempt(this.destroyDriver);
    for (const entry of this.entries) if (!this.closed(entry)) {
      attempt(() => { entry.resource.destroy?.(); });
      if (entry.kinds.has('ssh-channel')) attempt(() => { entry.resource.close?.(); });
    }
    issuing = false; complete(false); return pending;
  }
}
