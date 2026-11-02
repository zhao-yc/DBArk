import { afterEach, expect, it, vi } from 'vitest';
import { LocalReferencesWorkerClient } from '../../src/renderer/localReferencesWorkerClient';
import { analyzeLocalReferences } from '../../src/shared/localReferencesAnalysis';

const source = 'SELECT s.id FROM subject s WHERE s.id=1';
/** 只模拟线程传输和时钟；交付的引用范围由真实解析器产生。 */
function fixture() {
  const workers: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage: ((event: MessageEvent) => void) | null; onerror: ((event: ErrorEvent) => void) | null; onmessageerror: (() => void) | null }[] = [];
  const create = vi.fn(() => { const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; workers.push(worker); return worker; });
  const client = new LocalReferencesWorkerClient(create), signal = new AbortController();
  const run = () => client.analyze(source, 8, {}, signal.signal, {});
  const ready = (index = 0) => workers[index].onmessage?.({ data: { type: 'dbark-local-references-ready', version: 1 } } as MessageEvent);
  const reply = (index = 0, result: unknown = analyzeLocalReferences(source, 8)) => workers[index].onmessage?.({ data: { id: 1, result } } as MessageEvent);
  return { workers, create, client, signal, run, ready, reply };
}
afterEach(() => vi.useRealTimers());
it('握手前不传正文，完成后准确终止线程并清除监听', async () => {
  const f = fixture(), result = f.run(), worker = f.workers[0]; expect(worker.postMessage).not.toHaveBeenCalled(); f.ready(); expect(worker.postMessage).toHaveBeenCalledOnce();
  f.reply(); expect(await result).toMatchObject({ status: 'ready' }); expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.onmessage).toBeNull(); f.client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each(['startup', 'analysis'] as const)('%s期限保持8秒／2秒，不交付部分列表', async phase => {
  vi.useFakeTimers(); const f = fixture(), result = f.run();
  if (phase === 'analysis') f.ready(); await vi.advanceTimersByTimeAsync(phase === 'analysis' ? 2000 : 8000);
  expect(await result).toEqual({ status: 'blocked', reason: phase === 'analysis' ? 'timeout' : 'startup-timeout' }); expect(f.workers[0].terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it.each(['abort', 'dispose'] as const)('%s立即释放启动线程且不发正文', async action => {
  const f = fixture(), result = f.run(); if (action === 'abort') f.signal.abort(); else f.client.dispose();
  expect(await result).toMatchObject({ status: 'blocked' }); expect(f.workers[0].postMessage).not.toHaveBeenCalled(); expect(f.workers[0].terminate).toHaveBeenCalledOnce();
});
it('旧线程迟到消息与重复ready不影响继任owner', async () => {
  const f = fixture(), first = f.run(), old = f.workers[0].onmessage!, second = f.run(); expect(await first).toEqual({ status: 'blocked', reason: 'replaced' });
  old({ data: { type: 'dbark-local-references-ready', version: 1 } } as MessageEvent); expect(f.workers[1].postMessage).not.toHaveBeenCalled();
  f.ready(1); f.ready(1); expect(f.workers[1].postMessage).toHaveBeenCalledOnce(); f.reply(1); expect(await second).toMatchObject({ status: 'ready' }); expect(f.workers.map(worker => worker.terminate.mock.calls.length)).toEqual([1, 1]);
});
it.each(['forged', 'early', 'version', 'messageerror', 'error'] as const)('拒绝%s并释放准确线程', async action => {
  const f = fixture(), result = f.run(), worker = f.workers[0];
  if (action === 'forged') { f.ready(); f.reply(0, { status: 'ready', uri: 'file:///x' }); }
  else if (action === 'early') f.reply();
  else if (action === 'version') worker.onmessage!({ data: { type: 'dbark-local-references-ready', version: 2 } } as MessageEvent);
  else if (action === 'error') worker.onerror!({ preventDefault() {} } as ErrorEvent);
  else worker.onmessageerror!();
  expect(await result).toEqual({ status: 'blocked', reason: 'worker' }); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('超预算和已取消请求不分配线程', async () => {
  const f = fixture(); expect(await f.client.analyze('x'.repeat(262145), 0, {}, f.signal.signal, {})).toEqual({ status: 'blocked', reason: 'budget' });
  f.signal.abort(); expect((await f.run()).status).toBe('blocked'); expect(f.create).not.toHaveBeenCalled();
});
