import type { ConnectionStatus } from '../shared/contracts';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import { assertObjectDefinitionOutput, objectDefinitionInputSchema, objectDefinitionTaskPrefix, type ObjectDefinitionInput, type ObjectDefinitionOutput } from '../shared/objectDefinition';
import { validPhysicalObjectAnalysis } from '../shared/physicalObjectAnalysis';
import { completionContextCapabilities, sameCompletionScope, sameCompletionState, type SqlCompletionScope } from './completionContext';
import type { LocalReferencesWorkerClient } from './localReferencesWorkerClient';
import { objectDefinitionZh as text } from './locales/objectDefinition.zh-CN';

export interface ObjectDefinitionView { busy: boolean; stopping: boolean; error: string; output?: ObjectDefinitionOutput; }
interface Lease { owns(): boolean; release(): unknown; }
interface Ports {
  source: string; offset: number; dialect: 'mysql' | 'mariadb' | 'sqlite'; scope: SqlCompletionScope;
  current(): boolean; acquire(): Lease;
  facts(): Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
  state(sessionId: string): Promise<CompletionSessionState>;
  create(): Pick<LocalReferencesWorkerClient, 'object' | 'dispose'>;
  read(input: ObjectDefinitionInput): Promise<ObjectDefinitionOutput>; cancel(taskId: string): Promise<unknown>; id(): string;
  changed(view: ObjectDefinitionView): void; cleanup(reason: unknown): void;
}
interface Pending { id: string; sent: boolean; settled: boolean; work: Promise<ObjectDefinitionOutput>; }
interface Operation {
  controller: AbortController; stopped: boolean; acquiring: boolean; releasing: boolean;
  lease?: Lease; worker?: Pick<LocalReferencesWorkerClient, 'object' | 'dispose'>;
  pending?: Pending; cancellation?: Promise<void>; facts?: Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>>;
  factsCaptured: boolean; done: Promise<void>; finish(): void;
}
class ReaderFailure extends Error {}

/** 单次显式读取绑定原源码、作用域与忙碌租约；取消ACK和原任务都终结后才归还占位。 */
export class ObjectDefinitionReader {
  private readonly scope: SqlCompletionScope;
  private readonly source: string;
  private readonly offset: number;
  private readonly dialect: Ports['dialect'];
  private dead = false;
  private disposed = false;
  private started = false;
  private active?: Operation;
  private last?: Promise<void>;
  private view: ObjectDefinitionView = { busy: false, stopping: false, error: '' };
  constructor(private readonly ports: Ports) {
    this.scope = { ...ports.scope }; this.source = ports.source; this.offset = ports.offset; this.dialect = ports.dialect;
  }

  /** 来源失效是永久墓碑；名称、标签或连接后来恢复成相同值也不能复活旧轮。 */
  private sourceCurrent(): boolean {
    if (!this.dead) {
      try {
        if (!this.ports.current() || this.ports.source !== this.source || this.ports.offset !== this.offset || this.ports.dialect !== this.dialect || !sameCompletionScope(this.scope, this.ports.scope)) this.dead = true;
      } catch { this.dead = true; }
    }
    return !this.dead;
  }

  /** 清理回调不能打断后续原任务和租约释放，也不把内部错误写入界面或持久状态。 */
  private cleanup(reason: unknown): void { try { this.ports.cleanup(reason); } catch { /* 继续原收尾。 */ } }
  private emit(value: ObjectDefinitionView): void {
    // 重复observe不能让React订阅在同一失效状态下反复发布等价对象。
    if (this.view.busy === value.busy && this.view.stopping === value.stopping && this.view.error === value.error && this.view.output === value.output) return;
    this.view = value;
    if (!this.disposed) { try { this.ports.changed({ ...value }); } catch (reason) { this.cleanup(reason); } }
  }

  /** 不比较活动标签等外部可变目标，所有上下文只能由创建时捕获的scope和守卫确认。 */
  private check(operation: Operation): void {
    if (!this.sourceCurrent() || this.active !== operation) throw new ReaderFailure(text.stale);
    if (this.disposed || operation.stopped || operation.controller.signal.aborted) throw new ReaderFailure(text.cancelled);
    if (!operation.lease?.owns()) { this.dead = true; throw new ReaderFailure(text.stale); }
    if (!this.scope.sessionId && operation.factsCaptured) {
      const facts = this.ports.facts();
      if (facts?.dialect !== operation.facts?.dialect || facts?.version !== operation.facts?.version) { this.dead = true; throw new ReaderFailure(text.stale); }
    }
  }

  /** 同一帧双击返回原Promise；该实例失败或取消后也不自动重放。 */
  start(): Promise<void> {
    if (this.started) return this.last ?? Promise.resolve();
    this.started = true;
    let finish!: () => void;
    const operation: Operation = { controller: new AbortController(), stopped: false, acquiring: false, releasing: false, factsCaptured: false, done: new Promise(resolve => { finish = resolve; }), finish: () => finish() };
    this.active = operation; this.last = operation.done;
    this.emit({ busy: true, stopping: false, error: '' });
    // 先发布唯一owner再进入可重入的外部acquire和changed端口。
    void Promise.resolve().then(() => this.run(operation));
    return operation.done;
  }

  /** 只停止所属线程与已发送且未终结的准确后端编号，绝不取消其它查询或下一轮租约。 */
  private requestStop(operation: Operation): void {
    operation.stopped = true; operation.controller.abort(); this.disposeWorker(operation);
    const pending = operation.pending;
    if (pending?.sent && !pending.settled && !operation.cancellation) {
      operation.cancellation = Promise.resolve().then(() => this.ports.cancel(pending.id)).then(() => undefined, reason => { this.cleanup(reason); });
    }
  }

  /** 分析一结束就释放线程，原SQL正文不跟随后续目录读取继续驻留在线程中。 */
  private disposeWorker(operation: Operation): void {
    const worker = operation.worker; operation.worker = undefined;
    if (worker) { try { worker.dispose(); } catch (reason) { this.cleanup(reason); } }
  }

  /** 状态必须来自原session；缺失MySQL模式不猜默认值，SQLite要求原main目录及对象代次可靠。 */
  private stateUsable(state: CompletionSessionState): boolean {
    if (state.busy || state.broken || !this.dialectUsable(state.dialect)) return false;
    if (this.dialect === 'sqlite') return state.databaseKnown && state.database === 'main' && Number.isSafeInteger(state.objectsRevision) && state.objectsRevision! >= 0;
    return typeof state.ansiQuotes === 'boolean' && typeof state.noBackslashEscapes === 'boolean';
  }

  /** 网络配置允许同协议服务器报告真实MySQL或MariaDB；能力仍按其真实家族和版本计算。 */
  private dialectUsable(dialect: CompletionSessionState['dialect']): boolean {
    return this.dialect === 'sqlite' ? dialect === 'sqlite' : dialect === 'mysql' || dialect === 'mariadb';
  }

  /** 分析、读取前后逐次核原来源和会话快照；只有完整确认才能发布定义。 */
  private async run(operation: Operation): Promise<void> {
    let output: ObjectDefinitionOutput | undefined, error = '';
    try {
      if (!this.sourceCurrent()) throw new ReaderFailure(text.stale);
      if (this.disposed || operation.stopped) throw new ReaderFailure(text.cancelled);
      operation.acquiring = true;
      try { operation.lease = this.ports.acquire(); } catch { throw new ReaderFailure(text.busy); }
      finally { operation.acquiring = false; }
      this.check(operation);
      const cached = this.scope.sessionId ? { ...await this.ports.state(this.scope.sessionId) } : undefined;
      this.check(operation);
      if (cached && !this.stateUsable(cached)) throw new ReaderFailure(text.context);
      if (!this.scope.sessionId) {
        const facts = this.ports.facts(); operation.facts = facts ? { ...facts } : undefined; operation.factsCaptured = true;
        if (facts && !this.dialectUsable(facts.dialect)) throw new ReaderFailure(text.context);
      }
      const mode = cached && this.dialect !== 'sqlite' ? { ansiQuotes: cached.ansiQuotes, noBackslashEscapes: cached.noBackslashEscapes } : {};
      operation.worker = this.ports.create(); this.check(operation);
      let analysis;
      try { analysis = await operation.worker.object(this.source, this.offset, mode, operation.controller.signal, completionContextCapabilities(cached, operation.facts)); }
      finally { this.disposeWorker(operation); }
      this.check(operation);
      if (!validPhysicalObjectAnalysis(analysis, this.source, this.offset, this.dialect === 'sqlite' ? 'sqlite' : 'mysql', mode)) throw new ReaderFailure(text.invalid);
      if (analysis.status !== 'ready') throw new ReaderFailure(['worker', 'timeout', 'startup-timeout'].includes(analysis.reason) ? text.worker : text.blocked);
      if (this.scope.sessionId) {
        const latest = await this.ports.state(this.scope.sessionId); this.check(operation);
        if (!sameCompletionState(cached!, latest)) { this.dead = true; throw new ReaderFailure(text.stale); }
      }
      // SQLite未限定schema交给原会话按TEMP优先；MySQL默认库只用原会话可靠缓存。
      const database = analysis.object.database ?? (this.dialect === 'sqlite' ? undefined : cached ? cached.databaseKnown ? cached.database ?? undefined : undefined : this.scope.databaseUnknown ? undefined : this.scope.database);
      if (this.dialect !== 'sqlite' && database === undefined) throw new ReaderFailure(text.context);
      const input = objectDefinitionInputSchema.parse({ connectionId: this.scope.connectionId, ...(this.scope.sessionId ? { sessionId: this.scope.sessionId } : {}), ...(database === undefined ? {} : { database }), table: analysis.object.table, taskId: objectDefinitionTaskPrefix + this.ports.id() });
      this.check(operation);
      const pending: Pending = { id: input.taskId, sent: false, settled: false, work: Promise.resolve(undefined as unknown as ObjectDefinitionOutput) };
      operation.pending = pending;
      pending.work = Promise.resolve().then(() => { this.check(operation); pending.sent = true; return this.ports.read(input); }).finally(() => { pending.settled = true; });
      const raw = await pending.work; this.check(operation);
      try { assertObjectDefinitionOutput(raw, input, this.dialect); } catch { throw new ReaderFailure(text.invalid); }
      const confirmed: ObjectDefinitionOutput = { ...raw, request: { ...raw.request } };
      if (this.scope.sessionId) {
        const latest = await this.ports.state(this.scope.sessionId); this.check(operation);
        if (!sameCompletionState(cached!, latest) || confirmed.revision !== undefined && confirmed.revision !== cached!.objectsRevision) { this.dead = true; throw new ReaderFailure(text.stale); }
      }
      this.check(operation); output = confirmed;
    } catch (reason) {
      error = !this.sourceCurrent() ? text.stale : operation.stopped || this.disposed ? text.cancelled : reason instanceof ReaderFailure ? reason.message : text.failed;
    } finally {
      this.disposeWorker(operation);
      if (operation.cancellation) await operation.cancellation;
      // 原请求已离开且取消ACK也结算后才归还busy；释放回调导致来源变化时仍不发布结果。
      if (output) { try { this.check(operation); } catch { output = undefined; error = this.dead ? text.stale : text.cancelled; } }
      operation.releasing = true;
      if (operation.lease) { try { operation.lease.release(); } catch (reason) { output = undefined; error = text.failed; this.cleanup(reason); } }
      if (this.active === operation) this.active = undefined;
      if (!this.sourceCurrent()) { output = undefined; error = text.stale; }
      if (operation.stopped) { output = undefined; error = this.dead ? text.stale : text.cancelled; }
      this.emit({ busy: false, stopping: false, error, ...(output ? { output } : {}) });
      operation.finish();
    }
  }

  /** 来源或租约一旦失效立即撤销发布资格；观察到ABA前的变化也不能再恢复。 */
  observe(): void {
    const operation = this.active;
    let current = this.sourceCurrent();
    if (current && operation?.lease && !operation.acquiring && !operation.releasing) {
      try { current = operation.lease.owns(); } catch { current = false; }
      if (!current) this.dead = true;
    }
    if (current && operation?.factsCaptured && !this.scope.sessionId) {
      try { const facts = this.ports.facts(); current = facts?.dialect === operation.facts?.dialect && facts?.version === operation.facts?.version; } catch { current = false; }
      if (!current) this.dead = true;
    }
    if (!current) {
      if (operation) this.requestStop(operation);
      this.emit({ busy: !!operation, stopping: !!operation, error: text.stale });
    }
  }

  /** 两种取消顺序均等原Promise和ACK，不以先到的其中一个提前归还忙碌租约。 */
  stop(): Promise<void> {
    const operation = this.active; if (!operation) return Promise.resolve();
    this.requestStop(operation);
    this.emit({ busy: true, stopping: true, error: this.dead ? text.stale : '' });
    return operation.done;
  }

  /** 卸载撤销界面发布并停准确owner；保留后台清理链到真实终态。 */
  dispose(): void { this.disposed = true; if (this.active) this.requestStop(this.active); }
  /** 严格模式可恢复挂载资格；永久墓碑和已开始的单次动作都不会被重置。 */
  activate(): void { if (this.sourceCurrent()) this.disposed = false; }
}
