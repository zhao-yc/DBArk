import type { ConnectionStatus } from '../shared/contracts';
import type { CompletionSessionState } from '../shared/sqlCompletion';
import type { LocalRename, LocalRenameDialect } from '../shared/localRename';
import { completionContextCapabilities, resolveCompletionContext, sameCompletionState, type SqlCompletionScope } from './completionContext';
import type { LocalReferencesWorkerClient } from './localReferencesWorkerClient';

interface RenamePorts {
  dialect: LocalRenameDialect; scope?: SqlCompletionScope; current(): boolean;
  facts(): Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
  state(sessionId: string): Promise<CompletionSessionState>; create(): LocalReferencesWorkerClient;
}

/** SQLite完全本地；MySQL仅只读现有模式缓存并前后核代次，不建立连接或执行SQL。 */
export function createLocalRenameAnalysis(ports: RenamePorts) {
  let disposed = false;
  const active = new Set<LocalReferencesWorkerClient>();
  return {
    async analyze(source: string, offset: number, signal: AbortSignal, newName?: string): Promise<LocalRename> {
      const scope = ports.scope, facts = ports.dialect === 'mysql' && !scope?.sessionId ? ports.facts() : undefined;
      const current = () => !disposed && !signal.aborted && ports.current() && (ports.dialect === 'sqlite' || !!scope && (!!scope.sessionId || ports.facts() === facts));
      let worker: LocalReferencesWorkerClient | undefined;
      try {
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const cached = ports.dialect === 'mysql' && scope?.sessionId ? await ports.state(scope.sessionId) : undefined;
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        const context = ports.dialect === 'sqlite' ? { available: true, mode: {} } : resolveCompletionContext(scope!.database, cached, scope!.databaseUnknown);
        if (!context.available || ports.dialect === 'mysql' && (cached?.dialect === 'sqlite' || facts?.dialect === 'sqlite')) return { status: 'blocked', reason: 'context' };
        worker = ports.create(); active.add(worker);
        const result = await worker.rename(source, offset, context.mode, signal, ports.dialect === 'sqlite' ? {} : completionContextCapabilities(cached, facts), newName);
        worker.dispose(); active.delete(worker); worker = undefined;
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        if (ports.dialect === 'mysql' && scope?.sessionId) {
          const latest = await ports.state(scope.sessionId);
          if (!current() || !sameCompletionState(cached!, latest)) return { status: 'blocked', reason: 'context' };
        }
        return result;
      } catch { return { status: 'blocked', reason: 'worker' }; }
      finally { if (worker) { worker.dispose(); active.delete(worker); } }
    },
    /** 卸载使缓存等待失效，并终止本实例全部准确Worker。 */
    async dispose(): Promise<void> { disposed = true; for (const worker of active) worker.dispose(); active.clear(); },
  };
}
