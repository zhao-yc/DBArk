import type { CompletionLexicalMode } from '../shared/completionLexical';
import type { CompletionScopeCapabilities } from '../shared/completionCapabilities';
import { validLocalReferences, type LocalReferences } from '../shared/localReferences';
import { completionLimits } from '../shared/sqlCompletion';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;

/** 一次引用请求独占线程；启动8秒与分析2秒分开，正文只在握手后发送，终态准确释放所属线程。 */
export class LocalReferencesWorkerClient {
  private active?: { stop(reason: string): void }; private disposed = false;
  constructor(private readonly create: () => WorkerPort) {}
  /** 输入绑定不可变快照；旧线程回包不能结束或污染继任请求。 */
  analyze(source: string, offset: number, mode: CompletionLexicalMode, signal: AbortSignal, capabilities: CompletionScopeCapabilities): Promise<LocalReferences> {
    if (this.disposed || signal.aborted) return Promise.resolve({ status: 'blocked', reason: 'cancelled' });
    if (source.length > completionLimits.sourceUnits) return Promise.resolve({ status: 'blocked', reason: 'budget' });
    this.active?.stop('replaced');
    return new Promise(resolve => {
      const snapshot = { ansiQuotes: mode.ansiQuotes, noBackslashEscapes: mode.noBackslashEscapes };
      const facts = { lateralDerivedTables: capabilities.lateralDerivedTables === true, windowFunctions: capabilities.windowFunctions === true, insertRowAliases: capabilities.insertRowAliases === true };
      let worker: WorkerPort | undefined, timer: ReturnType<typeof setTimeout> | undefined, sent = false, finished = false;
      /** 先撤监听、引用及当前owner，再终止准确线程；重复回调无副作用。 */
      const finish = (result: LocalReferences) => {
        if (finished) return; finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (this.active === owner) this.active = undefined;
        if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = undefined; }
        resolve(result);
      };
      const owner = { stop: (reason: string) => finish({ status: 'blocked', reason }) }, abort = () => owner.stop('cancelled');
      this.active = owner; signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => owner.stop('startup-timeout'), 8000);
      try {
        worker = this.create();
        worker.onmessage = event => {
          if (finished) return;
          const message = event.data;
          if (message?.type === 'dbark-local-references-unavailable') { owner.stop('worker'); return; }
          if (message?.type === 'dbark-local-references-ready') {
            if (message.version !== 1) { owner.stop('worker'); return; }
            if (sent) return;
            sent = true; clearTimeout(timer); timer = setTimeout(() => owner.stop('timeout'), 2000);
            try { worker!.postMessage({ id: 1, source, offset, mode: snapshot, capabilities: facts }); } catch { owner.stop('worker'); }
            return;
          }
          if (!sent || message?.id !== 1 || !validLocalReferences(message.result, source, offset, snapshot)) { owner.stop('worker'); return; }
          finish(message.result);
        };
        worker.onerror = event => { event.preventDefault(); owner.stop('worker'); };
        worker.onmessageerror = () => owner.stop('worker');
      } catch { owner.stop('worker'); }
    });
  }
  /** 卸载后所有待发正文、计时器和线程立即释放，不允许重新分配。 */
  dispose(): void { this.disposed = true; this.active?.stop('disposed'); }
}
