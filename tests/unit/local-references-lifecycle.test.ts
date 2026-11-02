import { expect, it, vi } from 'vitest';
import type { CancellationToken, editor, Position } from 'monaco-editor';
import { createSqlReferencesProvider } from '../../src/renderer/sqlReferencesProvider';
import { createLocalReferencesAnalysis } from '../../src/renderer/localReferencesAnalysis';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';
import type { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';

const source = 'SELECT s.id FROM subject s WHERE s.id=1';
/** 可控异步端口只用于制造原请求竞态；语义结果始终由生产解析器返回。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; }
function analysisFixture(sessionId?: string) {
  let live = true, facts = { dialect: 'mysql' as const, version: '8.4.0' };
  const cached: CompletionSessionState = { database: 'db', databaseKnown: true, objectsRevision: 4, dialect: 'mysql', serverVersion: '8.4.0', busy: false, broken: false, ansiQuotes: false, noBackslashEscapes: false };
  const worker = { analyze: vi.fn(async (text: string, offset: number, mode: {}, _signal: AbortSignal, capabilities: {}) => analyzeLocalReferences(text, offset, mode, capabilities)), dispose: vi.fn() };
  const create = vi.fn(() => worker as unknown as LocalReferencesWorkerClient), state = vi.fn(async (_id: string) => ({ ...cached }));
  const analyzer = createLocalReferencesAnalysis({ scope: { connectionId: 'only-connection', connectionVersion: 2, database: 'db', sessionId }, current: () => live, facts: () => facts, state, create });
  const controller = new AbortController();
  return { analyzer, controller, worker, create, state, cached, analyze: () => analyzer.analyze(source, 8, controller.signal), invalidate: () => live = false, replaceFacts: () => facts = { ...facts } };
}
it('无会话草稿仅本地分析；已有会话仅前后读取缓存，先终止线程再复核', async () => {
  for (const sessionId of [undefined, 'physical-session']) {
    const f = analysisFixture(sessionId); if (sessionId) { f.cached.dialect = 'mariadb'; f.cached.serverVersion = '11.4.0'; }
    expect(await f.analyze()).toMatchObject({ status: 'ready' }); expect(f.state).toHaveBeenCalledTimes(sessionId ? 2 : 0); expect(f.worker.dispose).toHaveBeenCalledOnce();
    expect(f.worker.analyze).toHaveBeenCalledWith(source, 8, sessionId ? { ansiQuotes: false, noBackslashEscapes: false } : {}, f.controller.signal, expect.objectContaining({ windowFunctions: true }));
    if (sessionId) expect(f.worker.dispose.mock.invocationCallOrder[0]).toBeLessThan(f.state.mock.invocationCallOrder[1]); await f.analyzer.dispose();
  }
});
it.each(['abort', 'invalidate', 'dispose'] as const)('缓存等待期间%s后不创建线程', async action => {
  const f = analysisFixture('session'), pending = deferred<CompletionSessionState>(); f.state.mockReturnValueOnce(pending.promise); const result = f.analyze();
  if (action === 'abort') f.controller.abort(); else if (action === 'invalidate') f.invalidate(); else await f.analyzer.dispose();
  pending.resolve(f.cached); expect(await result).toMatchObject({ status: 'blocked' }); expect(f.create).not.toHaveBeenCalled(); await f.analyzer.dispose();
});
it.each(['busy', 'broken'] as const)('会话%s时不建立分析线程', async key => {
  const f = analysisFixture('session'); f.cached[key] = true; expect(await f.analyze()).toMatchObject({ status: 'blocked' }); expect(f.create).not.toHaveBeenCalled(); await f.analyzer.dispose();
});
it.each(['ansiQuotes', 'noBackslashEscapes', 'objectsRevision', 'database', 'dialect'] as const)('会话%s变化撤销旧引用', async key => {
  const f = analysisFixture('session'), latest = { ...f.cached, [key]: key === 'objectsRevision' ? 5 : key === 'database' ? 'other' : key === 'dialect' ? 'mariadb' : true };
  f.state.mockResolvedValueOnce({ ...f.cached }).mockResolvedValueOnce(latest as CompletionSessionState);
  expect(await f.analyze()).toMatchObject({ status: 'blocked', reason: 'context' }); expect(f.worker.dispose).toHaveBeenCalledOnce(); await f.analyzer.dispose();
});
it.each(['facts', 'cancel', 'dispose'] as const)('%s后迟到分析结果不可交付', async action => {
  const f = analysisFixture(), pending = deferred<ReturnType<typeof analyzeLocalReferences>>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const result = f.analyze();
  if (action === 'facts') f.replaceFacts(); else if (action === 'cancel') f.controller.abort(); else await f.analyzer.dispose();
  pending.resolve(analyzeLocalReferences(source, 8)); expect(await result).toMatchObject({ status: 'blocked' }); await f.analyzer.dispose();
});

/** 单行原模型句柄不提供执行或外部URI端口；取消监听按真实注册/解绑顺序计数。 */
function providerFixture() {
  let live = true, alive = true, version = 1, currentModel: editor.ITextModel;
  const changes = new Set<() => void>(), cancellations = new Set<() => void>(), uri = { scheme: 'inmemory', path: '/original' };
  const model = { uri, isDisposed: () => !alive, getValueLength: () => source.length, getValue: vi.fn(() => source), getVersionId: () => version, getOffsetAt: () => 8, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }), onDidChangeContent: (listener: () => void) => { changes.add(listener); return { dispose: () => changes.delete(listener) }; } } as unknown as editor.ITextModel;
  currentModel = model;
  const worker = { analyze: vi.fn(async () => analyzeLocalReferences(source, 8)), dispose: vi.fn(async () => {}) };
  const prepare = vi.fn();
  const registration = createSqlReferencesProvider({ worker, prepare, model: () => currentModel, current: () => live, sourceLimit: 262144 });
  const token: CancellationToken = { isCancellationRequested: false, onCancellationRequested: listener => { const invoke = () => listener(undefined); cancellations.add(invoke); return { dispose: () => cancellations.delete(invoke) }; } };
  const invoke = (includeDeclaration = false) => registration.provider.provideReferences(model, { lineNumber: 1, column: 9 } as Position, { includeDeclaration }, token);
  return { registration, worker, prepare, model, uri, changes, cancellations, invoke, edit() { version++; changes.forEach(listener => listener()); }, invalidate() { live = false; }, close() { alive = false; }, replace() { currentModel = { ...model } as editor.ITextModel; } };
}
it('引用列表遵循includeDeclaration且始终使用原模型URI，范围按原文排序', async () => {
  const f = providerFixture();
  const expected = [7, 33].map(start => ({ uri: f.uri, range: { startLineNumber: 1, startColumn: start + 1, endLineNumber: 1, endColumn: start + 2 } }));
  expect(await f.invoke()).toEqual(expected);
  expect(await f.invoke(true)).toEqual([expected[0], { uri: f.uri, range: { startLineNumber: 1, startColumn: 26, endLineNumber: 1, endColumn: 27 } }, expected[1]]);
  expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0); await f.registration.dispose();
});
it.each(['edit', 'invalidate', 'close', 'replace', 'cancel', 'dispose'] as const)('%s不交付旧模型引用并释放监听', async action => {
  const f = providerFixture(), pending = deferred<ReturnType<typeof analyzeLocalReferences>>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const result = f.invoke();
  if (action === 'cancel') f.cancellations.forEach(listener => listener()); else if (action === 'dispose') await f.registration.dispose(); else f[action]();
  pending.resolve(analyzeLocalReferences(source, 8)); expect(await result).toBeNull(); expect(f.changes.size).toBe(0); expect(f.cancellations.size).toBe(0); await f.registration.dispose();
});
it('继任请求不会被旧请求的finally撤销', async () => {
  const f = providerFixture(), firstPending = deferred<ReturnType<typeof analyzeLocalReferences>>(), secondPending = deferred<ReturnType<typeof analyzeLocalReferences>>();
  f.worker.analyze.mockReturnValueOnce(firstPending.promise).mockReturnValueOnce(secondPending.promise);
  const first = f.invoke(), second = f.invoke(); firstPending.resolve(analyzeLocalReferences(source, 8)); expect(await first).toBeNull();
  secondPending.resolve(analyzeLocalReferences(source, 8)); expect(await second).not.toBeNull(); await f.registration.dispose();
});
it('超预算不读取正文；卸载幂等等待底层dispose', async () => {
  const f = providerFixture(); vi.spyOn(f.model, 'getValueLength').mockReturnValue(262145); expect(await f.invoke()).toBeNull(); expect(f.model.getValue).not.toHaveBeenCalled(); expect(f.worker.analyze).not.toHaveBeenCalled();
  const pending = deferred<void>(); f.worker.dispose.mockReturnValue(pending.promise); const close = f.registration.dispose(); expect(f.registration.dispose()).toBe(close); pending.resolve(); await close; expect(f.worker.dispose).toHaveBeenCalledOnce();
});
it('有效请求先收起候选再解析，准备期间模型失效不再建立请求', async () => {
  const f = providerFixture(); await f.invoke(); expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(f.worker.analyze.mock.invocationCallOrder[0]); expect(f.prepare.mock.invocationCallOrder[1]).toBeGreaterThan(f.worker.analyze.mock.invocationCallOrder[0]);
  f.prepare.mockImplementationOnce(() => f.invalidate()); expect(await f.invoke()).toBeNull(); expect(f.worker.analyze).toHaveBeenCalledOnce(); await f.registration.dispose();
});
