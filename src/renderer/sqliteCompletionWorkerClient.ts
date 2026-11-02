import { sqliteCompletionLimits } from '../shared/sqliteCompletion';
import { validateSqliteCompletionAnalysis, type SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';

export interface SqliteCompletionWorkerPort {
  postMessage(value: unknown): void; terminate(): void | Promise<unknown>;
  onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: ((event: MessageEvent) => void) | null;
}
interface Pending {
  id: number; worker: SqliteCompletionWorkerPort; phase: 'starting' | 'analyzing'; request?: { id: number; source: string; offset: number; intent?: 'hover' };
  timer: ReturnType<typeof setTimeout>; validate?: (value: unknown) => SqliteCompletionAnalysis; current(): boolean; resolve(value: SqliteCompletionAnalysis): void; detach(): void;
}
/** 每次分析独占Worker，真实终止完成后才交付终态或创建后继线程，不复用SQL正文缓存。 */
export class SqliteCompletionWorkerClient {
  private pending?: Pending; private serial = 0; private disposed = false; private retiring: Promise<void> = Promise.resolve();
  constructor(private readonly createWorker: () => SqliteCompletionWorkerPort, private readonly timeoutMs = 1500, private readonly startupTimeoutMs = 8000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1500 || !Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 8000) throw Error('SQLite补全线程期限无效');
  }
  /** 新意图先撤旧回调，握手前保留有界快照；替换与Abort均不允许迟到结果复活。 */
  async analyze(source: string, offset: number, signal?: AbortSignal, intent?: 'hover'): Promise<SqliteCompletionAnalysis> {
    const id = ++this.serial; await this.stop({ status: 'blocked', reason: 'replaced' });
    if (this.disposed) return { status: 'blocked', reason: 'disposed' };
    if (id !== this.serial || signal?.aborted) return { status: 'blocked', reason: 'cancelled' };
    if (typeof source !== 'string' || source.length > sqliteCompletionLimits.sourceUnits || !Number.isSafeInteger(offset) || offset < 0 || offset > source.length || intent !== undefined && intent !== 'hover') return { status: 'blocked', reason: 'input' };
    return new Promise(resolve => {
      let worker: SqliteCompletionWorkerPort;
      try { worker = this.createWorker(); } catch { resolve({ status: 'blocked', reason: 'worker' }); return; }
      const deadline = (phase: Pending['phase']) => setTimeout(() => { if (this.pending?.id === id && this.pending.phase === phase) void this.stop({ status: 'blocked', reason: phase === 'starting' ? 'startup-timeout' : 'timeout' }); }, phase === 'starting' ? this.startupTimeoutMs : this.timeoutMs);
      const abort = () => { if (this.pending?.id === id) { this.serial++; void this.stop({ status: 'blocked', reason: 'cancelled' }); } };
      this.pending = { id, worker, phase: 'starting', request: { id, source, offset, ...(intent ? { intent } : {}) }, timer: deadline('starting'), validate: value => validateSqliteCompletionAnalysis(value, source, offset, intent), current: () => id === this.serial && !this.disposed && !signal?.aborted, resolve, detach: () => signal?.removeEventListener('abort', abort) };
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = event => {
        const pending = this.pending; if (!pending || pending.id !== id || pending.worker !== worker) return;
        const message: unknown = event.data;
        try {
          if (!message || typeof message !== 'object') throw Error('response');
          const frame = message as Record<string, unknown>;
          if (pending.phase === 'starting') {
            if (Object.keys(frame).sort().join(',') !== 'type,version' || frame.type !== 'dbark-sqlite-completion-ready' || frame.version !== 1) throw Error('response');
            const request = pending.request; if (!request) throw Error('response'); pending.request = undefined; clearTimeout(pending.timer); pending.phase = 'analyzing'; pending.timer = deadline('analyzing');
            worker.postMessage(request); return;
          }
          if (Object.keys(frame).sort().join(',') !== 'id,result' || frame.id !== id) throw Error('response');
          if (!pending.validate) throw Error('response'); void this.stop(pending.validate(frame.result));
        } catch { void this.stop({ status: 'blocked', reason: 'response' }); }
      };
      worker.onerror = event => { event.preventDefault(); if (this.pending?.worker === worker) void this.stop({ status: 'blocked', reason: 'worker' }); };
      worker.onmessageerror = () => { if (this.pending?.worker === worker) void this.stop({ status: 'blocked', reason: 'worker' }); };
      if (signal?.aborted) abort();
    });
  }
  /** 先切断全部旧事件并清待发正文，再等待准确原terminate；失败永久停用该Client。 */
  private stop(result: SqliteCompletionAnalysis): Promise<void> {
    const pending = this.pending; this.pending = undefined;
    if (!pending) return this.retiring;
    clearTimeout(pending.timer); pending.detach(); pending.request = undefined; pending.validate = undefined; pending.worker.onmessage = null; pending.worker.onerror = null; pending.worker.onmessageerror = null;
    const prior = this.retiring;
    this.retiring = (async () => { await prior; let value = result; try { await pending.worker.terminate(); } catch { this.disposed = true; value = { status: 'blocked', reason: 'worker' }; } finally { if (!pending.current() && !(value.status === 'blocked' && value.reason === 'worker')) value = { status: 'blocked', reason: this.disposed ? 'disposed' : 'cancelled' }; pending.resolve(value); } })();
    return this.retiring;
  }
  /** cancel即使无运行线程也递增意图，等待正在退出的原线程，不并行积累。 */
  cancel(): Promise<void> { this.serial++; return this.stop({ status: 'blocked', reason: 'cancelled' }); }
  /** 组件卸载后永久拒绝新分析，等待原Worker真正退出。 */
  dispose(): Promise<void> { this.disposed = true; this.serial++; return this.stop({ status: 'blocked', reason: 'disposed' }); }
}
