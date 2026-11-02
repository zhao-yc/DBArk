import type { ConnectionStatus } from '../shared/contracts';
import type { CompletionAnalysis } from '../shared/completionAnalysis';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import { CompletionWorkerClient } from './completionWorkerClient';
import { completionContextCapabilities, resolveCompletionContext, sameCompletionState, type SqlCompletionScope } from './completionContext';

interface DefinitionPorts {
  scope: SqlCompletionScope;
  current(): boolean;
  facts(): Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
  state(sessionId: string): Promise<CompletionSessionState>;
  create(): CompletionWorkerClient;
}

/** 每次导航独占可终止Worker；唯一IPC只读现有会话缓存，没有目录、连接或SQL执行端口。 */
export function createMysqlDefinitionAnalysis(ports: DefinitionPorts) {
  let disposed = false;
  const active = new Set<CompletionWorkerClient>();
  return {
    async analyze(source: string, offset: number, signal: AbortSignal): Promise<CompletionAnalysis> {
      const facts = ports.scope.sessionId ? undefined : ports.facts();
      const current = () => !disposed && !signal.aborted && ports.current() && (!!ports.scope.sessionId || ports.facts() === facts);
      let worker: CompletionWorkerClient | undefined;
      try {
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const cached = ports.scope.sessionId ? await ports.state(ports.scope.sessionId) : undefined;
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const context = resolveCompletionContext(ports.scope.database, cached, ports.scope.databaseUnknown);
        if (!context.available || cached?.dialect === 'sqlite' || facts?.dialect === 'sqlite') return { status: 'blocked', reason: 'context' };
        worker = ports.create(); active.add(worker);
        const result = await worker.analyze(source, offset, context.mode, signal, completionContextCapabilities(cached, facts), 'definition');
        // Worker结果返回即释放线程，不在会话缓存复核期间保留SQL正文及解析器状态。
        worker.dispose(); active.delete(worker); worker = undefined;
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        if (ports.scope.sessionId) {
          const latest = await ports.state(ports.scope.sessionId);
          if (!current() || !sameCompletionState(cached!, latest)) return { status: 'blocked', reason: 'context' };
        }
        return result;
      } catch { return { status: 'blocked', reason: 'worker' }; }
      finally { if (worker) { worker.dispose(); active.delete(worker); } }
    },
    /** 卸载立即终止所有准确线程；尚未返回的缓存读取也不能再建立解析线程。 */
    async dispose(): Promise<void> { disposed = true; for (const worker of active) worker.dispose(); active.clear(); },
  };
}
