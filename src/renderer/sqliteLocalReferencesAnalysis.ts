import type { LocalReferences } from '../shared/localReferences';
import type { LocalReferencesWorkerClient } from './localReferencesWorkerClient';

/** SQLite引用只分析原模型；不提供连接、会话模式、目录、文件或数据库执行端口。 */
export function createSqliteLocalReferencesAnalysis(ports: { current(): boolean; create(): LocalReferencesWorkerClient }) {
  let disposed = false;
  const active = new Set<LocalReferencesWorkerClient>();
  return {
    async analyze(source: string, offset: number, signal: AbortSignal): Promise<LocalReferences> {
      const current = () => !disposed && !signal.aborted && ports.current();
      let worker: LocalReferencesWorkerClient | undefined;
      try {
        if (!current()) return { status: 'blocked', reason: 'cancelled' };
        worker = ports.create(); active.add(worker);
        const result = await worker.analyze(source, offset, {}, signal, {});
        worker.dispose(); active.delete(worker); worker = undefined;
        return current() ? result : { status: 'blocked', reason: 'cancelled' };
      } catch { return { status: 'blocked', reason: 'worker' }; }
      finally { if (worker) { worker.dispose(); active.delete(worker); } }
    },
    /** 卸载即终止准确线程；迟到结果不能交付给继任模型。 */
    async dispose(): Promise<void> { disposed = true; for (const worker of active) worker.dispose(); active.clear(); },
  };
}
