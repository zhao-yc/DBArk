export interface QueryTransactionSettingsScope {
  tabId: string; connectionId: string; connectionVersion: number; connection: unknown;
  sessionId: string; present: boolean; active: boolean; closing: boolean;
}

/** 只绑定事务设置来源，不绑定SQL模型、正文或整个标签对象；来源ABA永久撤销。 */
export class QueryTransactionSettingsIntent {
  private readonly origin: QueryTransactionSettingsScope;
  private session: string;
  private valid = true;
  private unsubscribe: () => void;
  private listeners = new Set<() => void>();

  constructor(private readonly read: () => QueryTransactionSettingsScope, subscribe: (changed: () => void) => () => void, private readonly message: string) {
    this.origin = { ...read() }; this.session = this.origin.sessionId;
    this.unsubscribe = subscribe(() => { this.current(); });
    try { this.assertCurrent(); } catch (error) { this.dispose(); throw error; }
  }

  /** 首次创建的原会话只允许单向绑定；观察到另一个ID或清空后不能复活。 */
  bindSession(session: string): void {
    if (!session || this.session && this.session !== session || this.read().sessionId !== session) this.invalidate();
    this.session = session; this.assertCurrent();
  }

  current(): boolean {
    if (!this.valid) return false;
    const now = this.read(), before = this.origin;
    if (!now.present || !now.active || now.closing || !now.connection || now.tabId !== before.tabId || now.connectionId !== before.connectionId || now.connectionVersion !== before.connectionVersion || now.connection !== before.connection || this.session && now.sessionId !== this.session) this.invalidate();
    // ensureSession完成后同步捕获ID，随后任何session变化都将撤销。
    if (this.valid && !this.session && now.sessionId) this.session = now.sessionId;
    return this.valid;
  }

  assertCurrent(): void { if (!this.current()) throw Error(this.message); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private invalidate(): void { if (!this.valid) return; this.valid = false; for (const listener of this.listeners) listener(); }
  /** 释放本弹窗观察者，不关闭原会话，也不更改事务。 */
  dispose(): void { this.valid = false; this.unsubscribe?.(); this.listeners.clear(); }
}
