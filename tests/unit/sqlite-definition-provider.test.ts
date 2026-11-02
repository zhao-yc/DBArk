import type { editor, CancellationToken } from 'monaco-editor';
import { expect, it, vi } from 'vitest';
import { analyzeSqliteCompletion, type SqliteCompletionAnalysis } from '../../src/shared/sqliteCompletionAnalysis';
import { createSqlDefinitionProvider } from '../../src/renderer/sqlDefinitionProvider';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; }
/** 真解析与provider；Monaco模型和Worker消息端口为RAM，未提供数据库或文件能力。 */
function fixture() {
  const source = 'SELECT s.id FROM subject AS s'; let version = 1, live = true, modelAlive = true;
  const changes = new Set<() => void>(), cancellations = new Set<() => void>(), uri = { scheme: 'inmemory', path: '/only-this-model' };
  const model = { uri, isDisposed: () => !modelAlive, getVersionId: () => version, getValueLength: () => source.length, getValue: vi.fn(() => source), getOffsetAt: () => 8, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }), onDidChangeContent: (listener: () => void) => { changes.add(listener); return { dispose: () => changes.delete(listener) }; } } as unknown as editor.ITextModel;
  const worker = { analyze: vi.fn(async (sql: string, offset: number, _signal: AbortSignal, intent: 'definition'): Promise<SqliteCompletionAnalysis> => analyzeSqliteCompletion(sql, offset, intent)), dispose: vi.fn(async () => {}) };
  const provider = createSqlDefinitionProvider({ model: () => model, current: () => live, worker, sourceLimit: 262144 });
  const token: CancellationToken = { isCancellationRequested: false, onCancellationRequested: listener => { const invoke = () => listener(undefined); cancellations.add(invoke); return { dispose() { cancellations.delete(invoke); } }; } };
  const invoke = () => provider.provider.provideDefinition(model, { lineNumber: 1, column: 9 } as import('monaco-editor').Position, token);
  return { provider, model, worker, token, invoke, changes, cancellations, uri, source, edit() { version++; changes.forEach(listener => listener()); }, invalidate() { live = false; }, closeModel() { modelAlive = false; } };
}
it('只返回原模型URI及准确声明和来源范围，正文与监听保持', async () => {
  const f = fixture(), value = await f.invoke(); expect(value).toEqual([{ uri: f.uri, range: { startLineNumber: 1, startColumn: 29, endLineNumber: 1, endColumn: 30 }, targetSelectionRange: { startLineNumber: 1, startColumn: 29, endLineNumber: 1, endColumn: 30 }, originSelectionRange: { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 9 } }]);
  expect(f.worker.analyze).toHaveBeenCalledExactlyOnceWith(f.source, 8, expect.any(AbortSignal), 'definition'); expect(f.model.getValue()).toBe(f.source); expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0); await f.provider.dispose();
});
it.each(['edit', 'invalidate', 'closeModel', 'cancel'] as const)('%s期间迟到范围不能导航', async action => {
  const f = fixture(), pending = deferred<SqliteCompletionAnalysis>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const result = f.invoke();
  if (action === 'cancel') f.cancellations.forEach(listener => listener()); else f[action]();
  pending.resolve(analyzeSqliteCompletion(f.source, 8, 'definition')); expect(await result).toBeNull(); expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0); await f.provider.dispose();
});
it('新意图撤销旧请求，旧取消监听已解除后不能撤销继任导航', async () => {
  const f = fixture(), pending = deferred<SqliteCompletionAnalysis>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const first = f.invoke(), second = f.invoke();
  const value = await second; expect(value).not.toBeNull(); pending.resolve(analyzeSqliteCompletion(f.source, 8, 'definition')); expect(await first).toBeNull(); expect(f.changes.size).toBe(0); await f.provider.dispose();
});
it('超预算不读取全文或分配分析', async () => {
  const f = fixture(); vi.spyOn(f.model, 'getValueLength').mockReturnValue(262145); expect(await f.invoke()).toBeNull(); expect(f.model.getValue).not.toHaveBeenCalled(); expect(f.worker.analyze).not.toHaveBeenCalled(); await f.provider.dispose();
});
it('卸载幂等等待原Worker dispose，后续不建立新请求', async () => {
  const f = fixture(), disposed = deferred<void>(); f.worker.dispose.mockReturnValue(disposed.promise);
  const close = f.provider.dispose(); expect(f.provider.dispose()).toBe(close); let ended = false; void close.then(() => ended = true); await Promise.resolve(); expect(ended).toBe(false); disposed.resolve(undefined); await close; expect(f.worker.dispose).toHaveBeenCalledOnce(); expect(await f.invoke()).toBeNull();
});
