import type { ConnectionStatus } from '../shared/contracts';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import type { LocalReferences } from '../shared/localReferences';
import { completionContextCapabilities, resolveCompletionContext, sameCompletionState, type SqlCompletionScope } from './completionContext';
import type { LocalReferencesWorkerClient } from './localReferencesWorkerClient';

interface ReferencesPorts {
  scope: SqlCompletionScope; current(): boolean;
  facts(): Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
  state(sessionId: string): Promise<CompletionSessionState>;
  create(): LocalReferencesWorkerClient;
}

/** 只读前后两份现有会话缓存；不建立连接、不读取目录、不执行查询。 */
export function createLocalReferencesAnalysis(ports: ReferencesPorts) {
  let disposed = false;
  const active = new Set<LocalReferencesWorkerClient>();
  return {
    async analyze(source: string, offset: number, signal: AbortSignal): Promise<LocalReferences> {
      const facts = ports.scope.sessionId ? undefined : ports.facts();
      const current = () => !disposed && !signal.aborted && ports.current() && (!!ports.scope.sessionId || ports.facts() === facts);
      let worker: LocalReferencesWorkerClient | undefined;
      try {
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const cached = ports.scope.sessionId ? await ports.state(ports.scope.sessionId) : undefined;
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const context = resolveCompletionContext(ports.scope.database, cached, ports.scope.databaseUnknown);
        if (!context.available || cached?.dialect === 'sqlite' || facts?.dialect === 'sqlite') return { status: 'blocked', reason: 'context' };
        worker = ports.create(); active.add(worker);
        const result = await worker.analyze(source, offset, context.mode, signal, completionContextCapabilities(cached, facts));
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
    /** 缓存等待也受卸载代次约束，不能在窗口离开后再创建线程。 */
    async dispose(): Promise<void> { disposed = true; for (const worker of active) worker.dispose(); active.clear(); },
  };
}
