import { randomUUID } from 'node:crypto';
import { externalObjectUriIdSchema, externalObjectUriLimits, type ExternalObjectUriRequest, type ExternalObjectUriState } from '../shared/externalObjectUris';
import { externalObjectUrisZh as text } from '../shared/externalObjectUris.zh-CN';
import { parseObjectUri, targetKey, workbenchTargetSchema, type WorkbenchTarget } from '../shared/workbench';

export interface ExternalObjectUriPorts<Owner> {
  revision(): number | undefined;
  assertOwner(owner: Owner): void;
  sameOwner(left: Owner, right: Owner): boolean;
  resolve(target: WorkbenchTarget, assertCurrent: () => void): Promise<WorkbenchTarget>;
  notify(owner: Owner): void;
  uid?(): string;
}
interface Entry { request: ExternalObjectUriRequest; revision: number | undefined }
interface Active<Owner> extends Entry {
  owner: Owner; invalid: boolean; started: boolean; settled: boolean; committed: boolean; resolved?: WorkbenchTarget;
}

/** 有界系统入口：一个真实在途操作和一个最新待处理意图，失效不会提前释放在途槽。 */
export class ExternalObjectUris<Owner> {
  private pending: Entry | undefined;
  private active: Active<Owner> | undefined;
  private receiver: { owner: Owner } | undefined;
  private closed = false;

  constructor(private readonly ports: ExternalObjectUriPorts<Owner>) {}

  /** 原生 open-url 的完整字符串只交规范解析器，禁止自动修正或宽松 URL 归一化。 */
  receiveUrl(uri: string): void {
    if (this.closed) return;
    let request: ExternalObjectUriRequest;
    const id = this.id();
    try { request = { id, kind: 'target', target: parseObjectUri(uri) }; }
    catch { request = { id, kind: 'error', code: 'invalid' }; }
    this.receive(request);
  }

  /** 有界扫描完整参数，不假设最后一项；多个协议候选使整次调用失败。 */
  receiveArgv(argv: readonly string[]): void {
    if (this.closed) return;
    if (argv.length > externalObjectUriLimits.argvItems) { this.receiveError('invalid'); return; }
    let size = 0;
    let candidate: string | undefined;
    let count = 0;
    for (const argument of argv) {
      if (typeof argument !== 'string' || argument.length > externalObjectUriLimits.argvCharacters - size) { this.receiveError('invalid'); return; }
      size += argument.length;
      if (/^dbark:/i.test(argument)) { candidate = argument; count++; }
    }
    if (count > 1) this.receiveError('multiple');
    else if (candidate !== undefined) this.receiveUrl(candidate);
  }

  /** 同文档重复握手保持原操作；新文档只能继承尚未开始的待处理请求。 */
  ready(owner: Owner): ExternalObjectUriState {
    this.assertOwner(owner);
    if (!this.receiver || !this.same(this.receiver.owner, owner)) this.invalidateActive();
    this.receiver = { owner };
    this.reconcilePending();
    this.notify();
    return this.state();
  }

  /** 领取后槽位立即占用，重复领取不能并发启动另一项连接核验。 */
  take(owner: Owner): ExternalObjectUriRequest | null {
    this.assertReceiver(owner);
    this.reconcilePending();
    if (this.active || !this.pending) return null;
    if (this.pending.request.kind === 'target' && this.pending.revision === undefined) throw new Error(text.notReady);
    const entry = this.pending;
    this.pending = undefined;
    this.active = { ...entry, owner, invalid: false, started: false, settled: false, committed: false };
    return this.copy(entry.request);
  }

  /** 原核验仅启动一次；即使页面销毁，finally 也必须等真实 Promise 收尾才释放槽。 */
  async resolve(owner: Owner, id: string): Promise<WorkbenchTarget> {
    this.assertReceiver(owner);
    const active = this.required(owner, id);
    this.assertCurrent(active);
    if (active.request.kind !== 'target') throw new Error(text.notResolved);
    if (active.started) throw new Error(text.alreadyResolved);
    active.started = true;
    try {
      const result = await this.ports.resolve(workbenchTargetSchema.parse(active.request.target), () => this.assertCurrent(active));
      this.assertCurrent(active);
      const target = workbenchTargetSchema.parse(result);
      if (targetKey(target) !== targetKey(active.request.target)) throw new Error(text.resolveFailed);
      active.resolved = target;
      return workbenchTargetSchema.parse(target);
    } catch {
      const changed = active.invalid || !this.current(active);
      active.invalid = true;
      throw new Error(changed ? text.changed : text.resolveFailed);
    } finally {
      active.settled = true;
      if (active.invalid) this.release(active);
    }
  }

  /** 界面投影的唯一线性化点；核验成功和原始配置、文档、意图必须同时有效。 */
  commit(owner: Owner, id: string): { committed: true } {
    this.assertReceiver(owner);
    const active = this.required(owner, id);
    this.assertCurrent(active);
    if (active.committed || !active.settled || !active.resolved) throw new Error(text.notResolved);
    active.committed = true;
    return { committed: true };
  }

  /** 提前放弃只使结果失效；旧编号的重复完成通知不会消费新的待处理请求。 */
  finish(owner: Owner, id: string): ExternalObjectUriState {
    this.assertReceiver(owner);
    const active = this.active;
    if (active && active.request.id === id && this.same(active.owner, owner)) {
      active.invalid = true;
      if (!active.started || active.settled) this.release(active);
    }
    return this.state();
  }

  /** 页面导航或崩溃时撤销原文档租约，不重放已经开始的请求。 */
  suspend(): void {
    this.receiver = undefined;
    this.invalidateActive();
  }

  /** 退出后拒收并清除待处理项，正在运行的操作只允许自然收尾。 */
  close(): void {
    this.closed = true;
    this.pending = undefined;
    this.suspend();
  }

  /** 接收新意图只取代未提交操作；已提交投影不被后续系统请求追溯撤销。 */
  private receive(request: ExternalObjectUriRequest): void {
    this.pending = { request, revision: this.revision() };
    if (this.active && !this.active.committed) this.invalidateActive();
    this.notify();
  }

  private receiveError(code: 'invalid' | 'multiple'): void { this.receive({ id: this.id(), kind: 'error', code }); }
  private id(): string {
    try { return externalObjectUriIdSchema.parse({ id: (this.ports.uid ?? randomUUID)() }).id; }
    catch { throw new Error(text.invalid); }
  }
  private state(): ExternalObjectUriState { return { pending: this.pending !== undefined, active: this.active !== undefined }; }
  private copy(request: ExternalObjectUriRequest): ExternalObjectUriRequest {
    return request.kind === 'target' ? { ...request, target: workbenchTargetSchema.parse(request.target) } : { ...request };
  }

  /** 冷启动只在修订首次可用时绑定一次；任何后续修订变化都变为固定拒绝结果。 */
  private reconcilePending(): void {
    const pending = this.pending;
    if (!pending || pending.request.kind !== 'target') return;
    const revision = this.revision();
    if (pending.revision === undefined) pending.revision = revision;
    else if (pending.revision !== revision) pending.request = { id: pending.request.id, kind: 'error', code: 'changed' };
  }

  private revision(): number | undefined {
    try { return this.ports.revision(); } catch { throw new Error(text.changed); }
  }
  private same(left: Owner, right: Owner): boolean {
    try { return this.ports.sameOwner(left, right); } catch { return false; }
  }
  private assertOwner(owner: Owner): void {
    if (this.closed) throw new Error(text.closed);
    try { this.ports.assertOwner(owner); } catch { throw new Error(text.changed); }
  }
  private assertReceiver(owner: Owner): void {
    this.assertOwner(owner);
    if (!this.receiver || !this.same(this.receiver.owner, owner)) throw new Error(text.notReady);
  }
  private required(owner: Owner, id: string): Active<Owner> {
    const active = this.active;
    if (!active || active.request.id !== id || !this.same(active.owner, owner)) throw new Error(text.changed);
    return active;
  }

  /** 租约检查不信任可复用的窗口编号，真实文档归属由主进程能力端口判断。 */
  private current(active: Active<Owner>): boolean {
    try {
      if (this.closed || active.invalid || this.active !== active || !this.receiver || !this.same(this.receiver.owner, active.owner)
        || active.revision === undefined || active.revision !== this.revision()) return false;
      this.ports.assertOwner(active.owner);
      return true;
    } catch { return false; }
  }
  private assertCurrent(active: Active<Owner>): void {
    if (!this.current(active)) { active.invalid = true; throw new Error(text.changed); }
  }
  private invalidateActive(): void {
    const active = this.active;
    if (!active) return;
    active.invalid = true;
    if (!active.started || active.settled) this.release(active);
  }
  private release(active: Active<Owner>): void {
    if (this.active !== active) return;
    this.active = undefined;
    this.notify();
  }

  /** 通知只是可丢失的唤醒信号；页面主动领取才交付，不让销毁窗口异常破坏队列。 */
  private notify(): void {
    const receiver = this.receiver;
    if (!this.pending || !receiver || this.closed) return;
    try { this.ports.assertOwner(receiver.owner); }
    catch { this.suspend(); return; }
    try { this.ports.notify(receiver.owner); } catch { /* 文档重新握手时仍可主动领取。 */ }
  }
}
