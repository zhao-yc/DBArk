import { statementNavigationLimits, validStatementNavigationResult, type StatementNavigationDialect, type StatementNavigationResult } from '../shared/statementNavigation';
import type { CompletionLexicalMode } from '../shared/completionLexical';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
/** 单个导航请求独占线程；原文只在握手后发送，停止/替换不碰别人的线程。 */
export class StatementNavigationWorkerClient {
  private active?: { stop(reason: string): void }; private disposed = false;
  constructor(private readonly create: () => WorkerPort) {}
  /** 8秒启动／2秒扫描分别限时，超时整份拒绝，不保留部分语句目录。 */
  analyze(source: string, dialect: StatementNavigationDialect, mode: CompletionLexicalMode, signal: AbortSignal): Promise<StatementNavigationResult> {
    if (this.disposed || signal.aborted) return Promise.resolve({ status: 'blocked', reason: 'cancelled' });
    if (source.length > statementNavigationLimits.sourceUnits) return Promise.resolve({ status: 'blocked', reason: 'budget' });
    this.active?.stop('replaced');
    return new Promise(resolve => {
      let worker: WorkerPort | undefined, timer: ReturnType<typeof setTimeout> | undefined, sent = false, finished = false;
      const snapshot = { ansiQuotes: mode.ansiQuotes, noBackslashEscapes: mode.noBackslashEscapes };
      /** 先撤销回调与owner，再准确终止物理线程；迟到结果不能清理下一轮。 */
      const finish = (result: StatementNavigationResult) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (this.active === owner) this.active = undefined;
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = undefined; }
        resolve(result);
      };
      const owner = { stop: (reason: string) => finish({ status: 'blocked', reason }) }, abort = () => owner.stop('cancelled');
      this.active = owner; signal.addEventListener('abort', abort, { once: true }); timer = setTimeout(() => owner.stop('startup-timeout'), 8000);
      try {
        worker = this.create(); if (finished) { worker.terminate(); worker = undefined; return; }
        worker.onmessage = event => {
          const value = event.data;
          if (finished) return;
          if (value?.type === 'dbark-statement-navigation-ready') {
            if (Object.keys(value).sort().join(',') !== 'type,version' || value.version !== 1) return owner.stop('worker');
            if (sent) return; sent = true; clearTimeout(timer); timer = setTimeout(() => owner.stop('timeout'), 2000);
            try { worker!.postMessage({ id: 1, source, dialect, mode: snapshot }); } catch { owner.stop('worker'); }
            return;
          }
          if (!sent || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,result' || value.id !== 1 || !validStatementNavigationResult(value.result, source)) return owner.stop('worker');
          finish(value.result);
        };
        worker.onerror = event => { event.preventDefault(); owner.stop('worker'); }; worker.onmessageerror = () => owner.stop('worker');
      } catch { owner.stop('worker'); }
    });
  }
  /** 卸载只终止当前owner；不允许复用已销毁客户端。 */
  dispose(): void { this.disposed = true; this.active?.stop('disposed'); }
}
