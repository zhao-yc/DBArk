import type { CompletionSessionState } from '../shared/sqlCompletion';
import type { CompletionLexicalMode } from '../shared/completionLexical';
import { validStatementNavigationResult, type StatementNavigationResult } from '../shared/statementNavigation';
import { sameCompletionState } from './completionContext';

export interface StatementNavigationView { busy: boolean; result?: StatementNavigationResult; }
interface NavigationWorker { analyze(source: string, dialect: 'mysql' | 'mariadb' | 'sqlite', mode: CompletionLexicalMode, signal: AbortSignal): Promise<StatementNavigationResult>; dispose(): void; }
interface Ports {
  source: string; dialect: 'mysql' | 'mariadb' | 'sqlite'; sessionId?: string; current(): boolean; subscribe(changed: () => void): () => void;
  state(sessionId: string): Promise<CompletionSessionState>; create(): NavigationWorker;
  decorate(result: Extract<StatementNavigationResult, { status: 'ready' }>): void; clear(): void;
  changed(view: StatementNavigationView): void;
}

/** 单次检查仅借用原会话缓存；永久失效围栏阻止旧语句目录落到编辑后的模型。 */
export class StatementNavigationController {
  private dead = false; private disposed = false; private started = false;
  private readonly abort = new AbortController();
  private worker?: NavigationWorker; private release?: () => void;
  private view: StatementNavigationView = { busy: false };
  private work?: Promise<void>;
  private readonly source: string;
  constructor(private readonly ports: Ports) { this.source = ports.source; }
  /** 同步占位供同帧按钮守卫使用，不能等React提交后才阻止重复检查。 */
  get busy(): boolean { return this.view.busy; }

  /** 明确动作只运行一次；同帧连点返回原链，不重发正文或缓存请求。 */
  start(): Promise<void> {
    if (this.started) return this.work ?? Promise.resolve();
    this.started = true;
    this.work = Promise.resolve().then(() => this.run());
    this.publish({ busy: true });
    return this.work;
  }

  /** 不同目标后来恢复相同值也不复活；失效后准确终止自己的线程及清除自己的目录。 */
  current(): boolean {
    if (!this.dead && !this.disposed) { try { if (!this.ports.current()) this.dead = true; } catch { this.dead = true; } }
    return !this.dead && !this.disposed && !this.abort.signal.aborted;
  }

  /** 只发布相同owner的有界状态，原SQL不进入组件状态或错误消息。 */
  private publish(view: StatementNavigationView): void { this.view = view; if (!this.disposed) { try { this.ports.changed(view); } catch { /* 界面订阅不能中断原线程收尾。 */ } } }
  private clear(): void { try { this.ports.clear(); } catch { /* 原模型已释放时不修改继任目录。 */ } }
  private terminate(): void { const worker = this.worker; this.worker = undefined; worker?.dispose(); }

  /** 同步模型／工作区事件先撤销原发布资格，迟到缓存结果不能再创建Worker。 */
  observe(): void {
    if (this.current()) return;
    if (this.abort.signal.aborted && this.view.result?.status === 'blocked') return;
    this.abort.abort(); this.terminate(); this.clear();
    this.release?.(); this.release = undefined;
    if (!this.disposed && !(this.view.result?.status === 'blocked' && this.view.result.reason === 'stale')) this.publish({ busy: false, result: { status: 'blocked', reason: 'stale' } });
  }

  /** 错误和超限整份拒绝；从不把不完整结果或其它会话缓存当作检查成功。 */
  private async run(): Promise<void> {
    try {
      if (!this.current()) return this.observe();
      this.release = this.ports.subscribe(() => this.observe());
      if (!this.current()) return this.observe();
      this.clear(); this.publish({ busy: true });
      const cached = this.ports.sessionId ? { ...await this.ports.state(this.ports.sessionId) } : undefined;
      if (!this.current()) return this.observe();
      if (cached && (cached.busy || cached.broken || (this.ports.dialect === 'sqlite' ? cached.dialect !== 'sqlite' : !['mysql', 'mariadb'].includes(cached.dialect ?? '')))) { this.publish({ busy: false, result: { status: 'blocked', reason: 'context' } }); return; }
      const mode = cached ? { ansiQuotes: cached.ansiQuotes, noBackslashEscapes: cached.noBackslashEscapes } : {};
      this.worker = this.ports.create();
      if (!this.current()) return this.observe();
      const result = await this.worker.analyze(this.source, this.ports.dialect, mode, this.abort.signal);
      this.terminate();
      if (!this.current()) return this.observe();
      if (this.ports.sessionId) {
        const latest = await this.ports.state(this.ports.sessionId);
        if (!this.current()) return this.observe();
        if (!sameCompletionState(cached!, latest)) { this.dead = true; return this.observe(); }
      }
      if (!validStatementNavigationResult(result, this.source)) { this.publish({ busy: false, result: { status: 'blocked', reason: 'worker' } }); return; }
      if (result.status === 'ready') this.ports.decorate(result);
      if (!this.current()) return this.observe();
      this.publish({ busy: false, result });
    } catch {
      this.clear();
      if (!this.current()) this.observe();
      else this.publish({ busy: false, result: { status: 'blocked', reason: 'worker' } });
    } finally { this.terminate(); }
  }

  /** 用户取消立即终止所属线程，不影响用户查询、会话或其他检查。 */
  stop(): void { this.dead = true; this.abort.abort(); this.terminate(); this.release?.(); this.release = undefined; this.clear(); if (!this.disposed) this.publish({ busy: false, result: { status: 'blocked', reason: 'cancelled' } }); }
  /** 释放只撤销本轮目录和监听；旧dispose不能触及下一轮owner。 */
  dispose(): void { if (this.disposed) return; this.disposed = true; this.abort.abort(); this.terminate(); this.release?.(); this.release = undefined; this.clear(); }
}
