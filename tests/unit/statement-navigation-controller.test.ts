import { expect, it, vi } from 'vitest';
import { StatementNavigationController, type StatementNavigationView } from '../../src/renderer/statementNavigationController';
import { analyzeStatementNavigation } from '../../src/shared/statementNavigation';
import type { CompletionSessionState } from '../../src/shared/sqlCompletion';
import { validStatementNavigationResult } from '../../src/shared/statementNavigation';

const source = 'SELECT * FROM;', mode = { ansiQuotes: false, noBackslashEscapes: false };
it.each(['SELECT \0', 'SELECT \ud800'])('非法原文不能接受伪造的ready结果：%j', source => {
  expect(validStatementNavigationResult({ status: 'ready', statements: [] }, source)).toBe(false);
  expect(validStatementNavigationResult({ status: 'blocked', reason: 'input' }, source)).toBe(true);
});
/** 可控缓存和线程只验证生命周期；真实生产解析结果仍经过正式回包校验。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(sessionId?: string) {
  let valid = true, observe: (() => void) | undefined;
  const views: StatementNavigationView[] = [], result = analyzeStatementNavigation(source, 'mysql', mode), decorate = vi.fn(), clear = vi.fn(), dispose = vi.fn();
  const state = vi.fn(async (): Promise<CompletionSessionState> => ({ ...mode, dialect: 'mysql', database: 'original', databaseKnown: true, busy: false, broken: false, objectsRevision: 0 }));
  const analyze = vi.fn(async () => result), worker = { analyze, dispose }, create = vi.fn(() => worker), release = vi.fn();
  const controller = new StatementNavigationController({ source, dialect: 'mysql', sessionId, current: () => valid, subscribe: changed => { observe = changed; return release; }, state, create, decorate, clear, changed: view => views.push(view) });
  return { controller, result, analyze, state, create, decorate, clear, dispose, release, views, change: (next: boolean) => { valid = next; observe?.(); }, observe: () => observe?.() };
}
it('无会话检查不建立连接或读缓存，原输入只在线程分析中出现一次', async () => {
  const f = fixture(); const first = f.controller.start(); expect(f.controller.busy).toBe(true); expect(f.controller.start()).toBe(first); await first;
  expect(f.result.status).toBe('ready'); expect(f.state).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledOnce(); expect(f.analyze).toHaveBeenCalledExactlyOnceWith(source, 'mysql', {}, expect.any(AbortSignal)); expect(f.decorate).toHaveBeenCalledExactlyOnceWith(f.result); expect(f.views.at(-1)).toEqual({ busy: false, result: f.result }); expect(f.dispose).toHaveBeenCalledOnce();
  f.controller.dispose(); expect(f.release).toHaveBeenCalledOnce(); expect(f.dispose).toHaveBeenCalledOnce();
});
it('只读取原会话前后缓存，模式来自原session且没有执行／重连能力', async () => {
  const f = fixture('original-session'); await f.controller.start(); expect(f.state.mock.calls).toEqual([['original-session'], ['original-session']]); expect(f.analyze).toHaveBeenCalledExactlyOnceWith(source, 'mysql', mode, expect.any(AbortSignal)); expect(f.decorate).toHaveBeenCalledOnce(); f.controller.dispose();
});
it('缓存等待期间源失效，恢复同名来源也不创建迟到Worker', async () => {
  const f = fixture('original-session'), pending = deferred<CompletionSessionState>(); f.state.mockImplementationOnce(() => pending.promise); const work = f.controller.start(); await Promise.resolve(); f.change(false); f.change(true); pending.resolve({ ...mode, dialect: 'mysql', busy: false, broken: false, databaseKnown: true }); await work;
  expect(f.create).not.toHaveBeenCalled(); expect(f.decorate).not.toHaveBeenCalled(); expect(f.views.at(-1)).toEqual({ busy: false, result: { status: 'blocked', reason: 'stale' } }); f.controller.dispose();
});
it.each(['cancel', 'dispose', 'source'] as const)('%s终止准确线程，迟到完整结果也不重画目录', async action => {
  const f = fixture(), pending = deferred<typeof f.result>(); f.analyze.mockImplementationOnce(() => pending.promise); const work = f.controller.start(); await Promise.resolve();
  if (action === 'cancel') f.controller.stop(); else if (action === 'dispose') f.controller.dispose(); else f.change(false);
  const count = f.views.length; pending.resolve(f.result); await work; expect(f.decorate).not.toHaveBeenCalled(); expect(f.dispose).toHaveBeenCalledOnce(); if (action === 'dispose') expect(f.views).toHaveLength(count); f.controller.dispose();
});
it('源改变后旧问题立即清除，原工作区ABA无法恢复发布资格', async () => {
  const f = fixture(); await f.controller.start(); expect(f.decorate).toHaveBeenCalledOnce(); const before = f.clear.mock.calls.length; f.change(false); f.change(true); expect(f.clear.mock.calls.length).toBeGreaterThan(before); expect(f.controller.current()).toBe(false); expect(f.views.at(-1)?.result).toEqual({ status: 'blocked', reason: 'stale' }); f.controller.dispose();
});
it('原缓存模式在分析后改变时不发布任何问题', async () => {
  const f = fixture('original-session'); f.state.mockResolvedValueOnce({ ...mode, dialect: 'mysql', busy: false, broken: false, databaseKnown: true }).mockResolvedValueOnce({ ...mode, ansiQuotes: true, dialect: 'mysql', busy: false, broken: false, databaseKnown: true }); await f.controller.start(); expect(f.decorate).not.toHaveBeenCalled(); expect(f.views.at(-1)?.result).toEqual({ status: 'blocked', reason: 'stale' }); f.controller.dispose();
});
it.each([{ busy: true }, { broken: true }, { dialect: 'sqlite' as const }])('原会话不可用时不分配解析线程：%j', async override => {
  const f = fixture('original-session'); f.state.mockResolvedValue({ ...mode, dialect: 'mysql', busy: false, broken: false, databaseKnown: true, ...override }); await f.controller.start(); expect(f.create).not.toHaveBeenCalled(); expect(f.views.at(-1)?.result).toEqual({ status: 'blocked', reason: 'context' }); f.controller.dispose();
});
it('原线程不合法回包不能注入SQL或任意目录字段', async () => {
  const f = fixture(); f.analyze.mockResolvedValue({ ...f.result, sql: source } as never); await f.controller.start(); expect(f.decorate).not.toHaveBeenCalled(); expect(f.views.at(-1)?.result).toEqual({ status: 'blocked', reason: 'worker' }); f.controller.dispose();
});
it('绘制失败仍清除所属目录并释放原线程', async () => {
  const f = fixture(); f.decorate.mockImplementation(() => { throw Error('本例绘制失败'); }); await f.controller.start(); expect(f.views.at(-1)?.result).toEqual({ status: 'blocked', reason: 'worker' }); expect(f.dispose).toHaveBeenCalledOnce(); expect(f.clear.mock.calls.length).toBeGreaterThanOrEqual(2); f.controller.dispose();
});
