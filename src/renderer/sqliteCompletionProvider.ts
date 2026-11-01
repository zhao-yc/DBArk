import type { CompletionSessionState } from '../shared/sqlCompletion';
import { sqliteCompletionInputSchema, sqliteCompletionOutputSchema, sqliteCompletionLimits, foldSqliteCompletionName as fold, type SqliteCompletionInput, type SqliteCompletionLookup } from '../shared/sqliteCompletion';
import type { SqliteCompletionAnalysis } from '../shared/sqliteCompletionAnalysis';
import { sameCompletionState } from './completionContext';
import { sqliteCompletionSuggestions, type SqliteCompletionItem } from './sqliteCompletionSuggestions';

interface Position { lineNumber: number; column: number; }
interface Disposable { dispose(): void; }
export interface SqliteCompletionModel {
  isDisposed(): boolean; getVersionId(): number; getValue(): string; getValueLength(): number;
  getOffsetAt(position: Position): number; getPositionAt(offset: number): Position;
  onDidChangeContent(listener: () => void): Disposable;
}
interface Token { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): Disposable; }
type Status = 'idle' | 'partial' | 'limited' | 'unavailable' | 'startupTimeout' | 'analysisTimeout';
interface Ports {
  connectionId: string; sessionId?: string;
  model(): SqliteCompletionModel | null; current(): boolean;
  worker: { analyze(source: string, offset: number, signal?: AbortSignal): Promise<SqliteCompletionAnalysis>; cancel(): Promise<void>; dispose(): Promise<void> };
  request(input: SqliteCompletionInput): Promise<unknown>; cancel(taskId: string): Promise<unknown>;
  state(sessionId: string): Promise<CompletionSessionState>; id(): string; status(status: Status): void;
}
interface Pending { sent: boolean; work: Promise<unknown>; cancel?: Promise<unknown>; }
interface Operation { controller: AbortController; pending: Map<string, Pending>; done: Promise<void>; finish(): void; workerStop?: Promise<void>; }
export interface SqliteCompletionSuggestion extends SqliteCompletionItem {
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number };
  filterText: string; sortText: string;
}
const stale = () => Object.assign(new Error('SQLite补全原来源已失效'), { name: 'AbortError' });

/** SQLite独立provider：只读目录请求与原模型／会话代次绑定，不执行建议或借用MySQL分析器。 */
export function createSqliteCompletionProvider(ports: Ports) {
  let disposed = false, active: Operation | undefined, closeWork: Promise<void> | undefined;
  /** 仅停止原操作；取消回执与原请求都等待终态，不能以ACK先到复用仍忙的原会话。 */
  function abort(operation: Operation): Promise<void> {
    operation.controller.abort();
    operation.workerStop ??= active === operation ? ports.worker.cancel().catch(() => {}) : Promise.resolve();
    for (const [id, pending] of operation.pending) if (pending.sent) pending.cancel ??= Promise.resolve().then(() => ports.cancel(id)).catch(() => {});
    return Promise.allSettled([operation.done, operation.workerStop, ...[...operation.pending.values()].flatMap(pending => pending.cancel ? [pending.cancel] : [])]).then(() => undefined);
  }
  return {
    triggerCharacters: ['.', '"', '`', '['],
    /** 所有await之后重新核模型、版本及同一provider；新编辑、切会话和取消不交付旧结果。 */
    async provideCompletionItems(model: SqliteCompletionModel, position: Position, _context: unknown, token: Token): Promise<{ suggestions: SqliteCompletionSuggestion[]; incomplete?: boolean }> {
      const empty = () => ({ suggestions: [] as SqliteCompletionSuggestion[] });
      let version: number;
      try { if (disposed || !ports.current() || ports.model() !== model || model.isDisposed() || token.isCancellationRequested) return empty(); version = model.getVersionId(); } catch { return empty(); }
      const previous = active;
      if (previous) void abort(previous);
      let finish!: () => void;
      const operation: Operation = { controller: new AbortController(), pending: new Map(), done: new Promise(resolve => { finish = resolve; }), finish: () => finish() };
      active = operation;
      const current = () => { try { return !disposed && active === operation && !operation.controller.signal.aborted && ports.current() && ports.model() === model && !model.isDisposed() && model.getVersionId() === version; } catch { return false; } };
      const stop = () => { void abort(operation); };
      let cancellation: Disposable | undefined, change: Disposable | undefined;
      let stamp: string | undefined, state: CompletionSessionState | undefined;
      try {
        cancellation = token.onCancellationRequested(stop); change = model.onDidChangeContent(stop);
        if (previous) await previous.done;
        if (!current()) return empty(); ports.status('idle');
        if (model.getValueLength() > sqliteCompletionLimits.sourceUnits) { ports.status('limited'); return empty(); }
        if (ports.sessionId) {
          state = await ports.state(ports.sessionId); if (!current()) return empty();
          if (state.dialect !== 'sqlite' || state.busy || state.broken || !state.databaseKnown || state.database !== 'main' || !Number.isSafeInteger(state.objectsRevision) || state.objectsRevision! < 0) return empty();
        }
        const source = model.getValue(), offset = model.getOffsetAt(position);
        const analysis = await ports.worker.analyze(source, offset, operation.controller.signal); if (!current()) return empty();
        if (analysis.status === 'blocked') { ports.status(analysis.reason === 'budget' ? 'limited' : analysis.reason === 'startup-timeout' ? 'startupTimeout' : analysis.reason === 'timeout' ? 'analysisTimeout' : analysis.reason === 'worker' ? 'unavailable' : 'idle'); return empty(); }
        /** 每个请求在发送前登记，取消发生在微任务投递前时不发送；不保存SQL或目录正文。 */
        const load = async (query: SqliteCompletionLookup) => {
          if (!current()) throw stale();
          const input = sqliteCompletionInputSchema.parse({ ...query, connectionId: ports.connectionId, ...(ports.sessionId ? { sessionId: ports.sessionId } : {}), taskId: ports.id() });
          if (operation.pending.has(input.taskId)) throw stale();
          const pending: Pending = { sent: false, work: Promise.resolve() }; operation.pending.set(input.taskId, pending);
          pending.work = Promise.resolve().then(() => { if (!current()) throw stale(); pending.sent = true; return ports.request(input); });
          try {
            const raw = await pending.work; if (!current()) throw stale();
            const result = sqliteCompletionOutputSchema.parse(raw);
            if (new TextEncoder().encode(JSON.stringify(result)).length > sqliteCompletionLimits.outputBytes || result.sessionRevision !== state?.objectsRevision || stamp !== undefined && result.stamp !== stamp) throw stale();
            if (query.kind === 'stamp' && (result.entries.length || result.incomplete) || query.kind !== 'stamp' && result.entries.some(entry => entry.kind === 'column' ? query.kind !== 'columns' || fold(entry.table) !== fold(query.table) || query.schema !== undefined && entry.schema !== query.schema : query.kind !== 'relations' || query.schema !== undefined && entry.schema !== query.schema)) throw stale();
            const names = result.entries.map(entry => fold(entry.name)); if (new Set(names).size !== names.length) throw stale();
            stamp ??= result.stamp; return result;
          } finally { if (pending.cancel) await pending.cancel; operation.pending.delete(input.taskId); }
        };
        // 目录串行读取，原物理会话不允许并发；一致stamp防止把跨DDL目录拼成一组建议。
        const result = await sqliteCompletionSuggestions(analysis, { load }); if (!current()) return empty();
        if (stamp !== undefined) await load({ kind: 'stamp', prefix: '' });
        if (ports.sessionId) {
          const latest = await ports.state(ports.sessionId); if (!current() || !state || !sameCompletionState(state, latest)) return empty();
        }
        if (!current()) return empty();
        const start = model.getPositionAt(analysis.target.start), end = model.getPositionAt(analysis.target.end), range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column };
        ports.status(result.incomplete ? 'partial' : 'idle');
        return { incomplete: result.incomplete, suggestions: result.items.map((item, index) => ({ ...item, range, filterText: analysis.target.quoted ? source[analysis.target.start] + item.label : item.label, sortText: (item.kind === 'keyword' ? '9' : '0') + String(index).padStart(4, '0') })) };
      } catch { if (current()) ports.status('unavailable'); return empty(); }
      finally { cancellation?.dispose(); change?.dispose(); if (operation.workerStop) await operation.workerStop; if (active === operation) active = undefined; operation.finish(); }
    },
    /** 退出编辑器后同时等待原目录任务和分析线程；其它provider的任务不在本对象内。 */
    dispose(): Promise<void> { if (closeWork) return closeWork; disposed = true; const operation = active; closeWork = (async () => { if (operation) await abort(operation); await ports.worker.dispose(); })(); return closeWork; },
  };
}
