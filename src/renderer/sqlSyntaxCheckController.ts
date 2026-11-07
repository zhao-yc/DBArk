import type { CompletionSessionState } from '../shared/sqlCompletion';
import type { CompletionLexicalMode } from '../shared/completionLexical';
import { validSqlSyntaxCheckResult, type SqlSyntaxCheckResult } from '../shared/sqlSyntaxCheck';
import { sameCompletionState } from './completionContext';

export interface SqlSyntaxCheckView { busy: boolean; result?: SqlSyntaxCheckResult; }
interface SyntaxWorker { syntax(source: string, mode: CompletionLexicalMode, signal: AbortSignal): Promise<SqlSyntaxCheckResult>; dispose(): void; }
interface Ports {
  source: string; sessionId?: string; current(): boolean; subscribe(changed: () => void): () => void;
  state(sessionId: string): Promise<CompletionSessionState>; create(): SyntaxWorker;
  native?(signal: AbortSignal): Promise<SqlSyntaxCheckResult>;
  decorate(result: Extract<SqlSyntaxCheckResult, { status: 'ready' }>): void; clear(): void;
  changed(view: SqlSyntaxCheckView): void;
}

/** 单次检查绑定原来源。MySQL 路径读取模式缓存，SQLite 路径调用原生准备。来源失效后不发布旧标记。 */
export class SqlSyntaxCheckController {
  private dead = false; private disposed = false; private started = false;
  private readonly abort = new AbortController();
  private worker?: SyntaxWorker; private release?: () => void;
  private view: SqlSyntaxCheckView = { busy: false };
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

  /** 不同目标后来恢复相同值也不复活；失效后准确终止自己的线程及清除自己的标记。 */
  current(): boolean {
    if (!this.dead && !this.disposed) { try { if (!this.ports.current()) this.dead = true; } catch { this.dead = true; } }
    return !this.dead && !this.disposed && !this.abort.signal.aborted;
  }

  /** 只发布相同owner的有界状态，原SQL不进入组件状态或错误消息。 */
  private publish(view: SqlSyntaxCheckView): void { this.view = view; if (!this.disposed) { try { this.ports.changed(view); } catch { /* 界面订阅不能中断原线程收尾。 */ } } }
  private clear(): void { try { this.ports.clear(); } catch { /* 原模型已释放时不修改继任模型。 */ } }
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
      if (this.ports.native) {
        const result = await this.ports.native(this.abort.signal);
        if (!this.current()) return this.observe();
        this.showResult(result);
        return;
      }
      const cached = this.ports.sessionId ? { ...await this.ports.state(this.ports.sessionId) } : undefined;
      if (!this.current()) return this.observe();
      if (cached && (cached.busy || cached.broken || !['mysql', 'mariadb'].includes(cached.dialect ?? ''))) { this.publish({ busy: false, result: { status: 'blocked', reason: 'context' } }); return; }
      const mode = cached ? { ansiQuotes: cached.ansiQuotes, noBackslashEscapes: cached.noBackslashEscapes } : {};
      this.worker = this.ports.create();
      if (!this.current()) return this.observe();
      const result = await this.worker.syntax(this.source, mode, this.abort.signal);
      this.terminate();
      if (!this.current()) return this.observe();
      if (this.ports.sessionId) {
        const latest = await this.ports.state(this.ports.sessionId);
        if (!this.current()) return this.observe();
        if (!sameCompletionState(cached!, latest)) { this.dead = true; return this.observe(); }
      }
      this.showResult(result);
    } catch {
      this.clear();
      if (!this.current()) this.observe();
      else this.publish({ busy: false, result: { status: 'blocked', reason: 'worker' } });
    } finally { this.terminate(); }
  }

  private showResult(result: SqlSyntaxCheckResult): void {
    if (!validSqlSyntaxCheckResult(result, this.source)) { this.publish({busy: false, result: {status: 'blocked', reason: 'worker'}}); return; }
    if (result.status === 'ready') this.ports.decorate(result);
    if (!this.current()) return this.observe();
    this.publish({busy: false, result});
  }

  /** 取消只终止所属本地线程或请求停止原生准备任务。 */
  stop(): void { this.dead = true; this.abort.abort(); this.terminate(); this.release?.(); this.release = undefined; this.clear(); if (!this.disposed) this.publish({ busy: false, result: { status: 'blocked', reason: 'cancelled' } }); }
  /** 释放只撤销本轮标记和监听；旧dispose不能触及下一轮owner。 */
  dispose(): void { if (this.disposed) return; this.disposed = true; this.abort.abort(); this.terminate(); this.release?.(); this.release = undefined; this.clear(); }
}
