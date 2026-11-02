import { expect, it, vi } from 'vitest';
import { createMysqlDefinitionAnalysis } from '../../src/renderer/mysqlDefinitionAnalysis';
import type { CompletionWorkerClient } from '../../src/renderer/completionWorkerClient';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { analyzeCompletionDefinition } from '../../src/shared/completionDefinitionAnalysis';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => resolve = yes); return { promise, resolve }; }
const source = 'SELECT s.id FROM subject s';
/** 缓存端口和线程为RAM；语义仍走真实解析器，fixture不提供任何目录或SQL执行能力。 */
function fixture(sessionId?: string) {
  let live = true, facts = { dialect: 'mysql' as const, version: '8.4.0' };
  const cached: CompletionSessionState = { database: 'db', databaseKnown: true, objectsRevision: 4, dialect: 'mysql', serverVersion: '8.4.0', busy: false, broken: false, ansiQuotes: false, noBackslashEscapes: false };
  const worker = { analyze: vi.fn(async (text: string, offset: number, mode: {}, _signal: AbortSignal, capabilities: {}, _intent: 'definition') => analyzeCompletionDefinition(text, offset, mode, capabilities)), dispose: vi.fn() };
  const create = vi.fn(() => worker as unknown as CompletionWorkerClient), state = vi.fn(async (_id: string) => ({ ...cached }));
  const analyzer = createMysqlDefinitionAnalysis({ scope: { connectionId: 'only-connection', connectionVersion: 2, database: 'db', sessionId }, current: () => live, facts: () => facts, state, create });
  const controller = new AbortController();
  return { analyzer, controller, worker, create, state, cached, analyze: () => analyzer.analyze(source, 8, controller.signal), invalidate: () => live = false, replaceFacts: () => facts = { ...facts } };
}
it('无会话草稿只用连接事实与本地Worker，交付前准确终止线程', async () => {
  const f = fixture(); expect(await f.analyze()).toMatchObject({ status: 'ready', definition: { start: 25, end: 26 } });
  expect(f.state).not.toHaveBeenCalled(); expect(f.worker.analyze).toHaveBeenCalledExactlyOnceWith(source, 8, {}, f.controller.signal, expect.objectContaining({ windowFunctions: true }), 'definition'); expect(f.worker.dispose).toHaveBeenCalledOnce(); await f.analyzer.dispose(); expect(f.worker.dispose).toHaveBeenCalledOnce();
});
it('已有会话只读前后两份缓存，使用实际模式和版本能力', async () => {
  const f = fixture('physical-session'); f.cached.dialect = 'mariadb'; f.cached.serverVersion = '11.4.0';
  expect(await f.analyze()).toMatchObject({ status: 'ready' }); expect(f.state).toHaveBeenNthCalledWith(1, 'physical-session'); expect(f.state).toHaveBeenNthCalledWith(2, 'physical-session');
  expect(f.worker.analyze).toHaveBeenCalledWith(source, 8, { ansiQuotes: false, noBackslashEscapes: false }, f.controller.signal, expect.objectContaining({ lateralDerivedTables: false }), 'definition'); await f.analyzer.dispose();
});
it.each(['abort', 'invalidate', 'dispose'] as const)('缓存等待期间%s后不创建线程', async action => {
  const f = fixture('session'), pending = deferred<CompletionSessionState>(); f.state.mockReturnValueOnce(pending.promise); const result = f.analyze();
  if (action === 'abort') f.controller.abort(); else if (action === 'invalidate') f.invalidate(); else await f.analyzer.dispose();
  pending.resolve(f.cached); expect(await result).toMatchObject({ status: 'blocked' }); expect(f.create).not.toHaveBeenCalled(); await f.analyzer.dispose();
});
it.each(['busy', 'broken'] as const)('物理会话%s时不分配解析器', async key => {
  const f = fixture('session'); f.cached[key] = true; expect(await f.analyze()).toMatchObject({ status: 'blocked' }); expect(f.create).not.toHaveBeenCalled(); await f.analyzer.dispose();
});
it('前后会话模式或对象代次改变，不交付旧范围且Worker已经释放', async () => {
  const f = fixture('session'); f.state.mockResolvedValueOnce({ ...f.cached }).mockResolvedValueOnce({ ...f.cached, objectsRevision: 5 });
  expect(await f.analyze()).toMatchObject({ status: 'blocked', reason: 'context' }); expect(f.worker.dispose).toHaveBeenCalledOnce(); await f.analyzer.dispose();
});
it('无会话事实换代、取消和卸载期间迟到范围均不能交付', async () => {
  for (const action of ['facts', 'cancel', 'dispose'] as const) {
    const f = fixture(), pending = deferred<ReturnType<typeof analyzeCompletionDefinition>>(); f.worker.analyze.mockReturnValueOnce(pending.promise); const result = f.analyze();
    if (action === 'facts') f.replaceFacts(); else if (action === 'cancel') f.controller.abort(); else await f.analyzer.dispose();
    pending.resolve(analyzeCompletionDefinition(source, 8)); expect(await result).toMatchObject({ status: 'blocked' }); await f.analyzer.dispose();
  }
});
