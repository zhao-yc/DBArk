import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import { createSqliteLocalReferencesAnalysis } from '../../src/renderer/sqliteLocalReferencesAnalysis';
import { analyzeSqliteLocalReferences } from '../../src/shared/sqliteLocalReferences';
import type { LocalReferences } from '../../src/shared/localReferences';

const source = 'SELECT "s🚢".id FROM subject AS [S🚢] WHERE [s🚢].id=1', offset = 7;
/** 真实SQLite解析负责返回范围；fixture只控制Worker握手及回包时机，不提供数据库端口。 */
function fixture() {
  const workers: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: (() => void) | null }[] = [];
  const client = new LocalReferencesWorkerClient(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; }, 'sqlite');
  const signal = new AbortController(), run = () => client.analyze(source, offset, { ansiQuotes: false, noBackslashEscapes: false }, signal.signal, { lateralDerivedTables: true });
  const ready = (index = 0) => workers[index].onmessage?.({ data: { type: 'dbark-sqlite-local-references-ready', version: 1 } } as MessageEvent);
  const reply = (index = 0, result: unknown = analyzeSqliteLocalReferences(source, offset)) => workers[index].onmessage?.({ data: { id: 1, result } } as MessageEvent);
  return { workers, client, signal, run, ready, reply };
}
afterEach(() => vi.useRealTimers());
it('只在SQLite握手后传有界正文和位置，不传MySQL模式或能力，完成准确释放', async () => {
  const f = fixture(), result = f.run(), worker = f.workers[0]; expect(worker.postMessage).not.toHaveBeenCalled(); f.ready();
  expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ id: 1, source, offset }); f.reply(); expect(await result).toMatchObject({ status: 'ready' }); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull(); f.client.dispose();
});
it('另一方言ready不能放行正文', async () => {
  const f = fixture(), result = f.run(); f.workers[0].onmessage?.({ data: { type: 'dbark-completion-ready', version: 1 } } as MessageEvent);
  expect(await result).toEqual({ status: 'blocked', reason: 'worker' }); expect(f.workers[0].postMessage).not.toHaveBeenCalled(); expect(f.workers[0].terminate).toHaveBeenCalledOnce();
});
it.each(['starting', 'analyzing'] as const)('%s期限保持8秒／2秒，准确终止且无部分列表', async phase => {
  vi.useFakeTimers(); const f = fixture(), result = f.run(); if (phase === 'analyzing') f.ready();
  await vi.advanceTimersByTimeAsync(phase === 'starting' ? 8000 : 2000); expect(await result).toEqual({ status: 'blocked', reason: phase === 'starting' ? 'startup-timeout' : 'timeout' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['abort', 'dispose', 'forged'] as const)('%s不能留下Worker或迟到引用', async action => {
  const f = fixture(), result = f.run(); f.ready(); const late = f.workers[0].onmessage!;
  if (action === 'abort') f.signal.abort(); else if (action === 'dispose') f.client.dispose(); else f.reply(0, { status: 'ready', uri: 'file:///other' });
  expect((await result).status).toBe('blocked'); late({ data: { id: 1, result: analyzeSqliteLocalReferences(source, offset) } } as MessageEvent); expect(f.workers[0].terminate).toHaveBeenCalledOnce();
});
it('继任Worker不接受旧线程回包，双ready不重复发送', async () => {
  const f = fixture(), first = f.run(), late = f.workers[0].onmessage!, second = f.run(); expect(await first).toEqual({ status: 'blocked', reason: 'replaced' });
  late({ data: { type: 'dbark-sqlite-local-references-ready', version: 1 } } as MessageEvent); expect(f.workers[1].postMessage).not.toHaveBeenCalled(); f.ready(1); f.ready(1); f.reply(1); expect((await second).status).toBe('ready'); expect(f.workers[1].postMessage).toHaveBeenCalledOnce();
});
it.each(['abort', 'scope', 'dispose'] as const)('纯模型适配器%s后撤销原线程结果，没有缓存或数据库端口', async action => {
  let resolve!: (value: LocalReferences) => void, current = true;
  const pending = new Promise<LocalReferences>(yes => resolve = yes), worker = { analyze: vi.fn(() => pending), dispose: vi.fn() }, create = vi.fn(() => worker as unknown as LocalReferencesWorkerClient);
  const analysis = createSqliteLocalReferencesAnalysis({ current: () => current, create }), controller = new AbortController(), result = analysis.analyze(source, offset, controller.signal);
  expect(worker.analyze).toHaveBeenCalledExactlyOnceWith(source, offset, {}, controller.signal, {});
  if (action === 'abort') controller.abort(); else if (action === 'scope') current = false; else await analysis.dispose();
  resolve(analyzeSqliteLocalReferences(source, offset)); expect((await result).status).toBe('blocked'); expect(worker.dispose).toHaveBeenCalled(); await analysis.dispose();
});
it('失效的模型不创建线程，卸载后也不接受新请求', async () => {
  const create = vi.fn(), analysis = createSqliteLocalReferencesAnalysis({ current: () => false, create });
  expect((await analysis.analyze(source, offset, new AbortController().signal)).status).toBe('blocked'); await analysis.dispose(); expect((await analysis.analyze(source, offset, new AbortController().signal)).status).toBe('blocked'); expect(create).not.toHaveBeenCalled();
});
