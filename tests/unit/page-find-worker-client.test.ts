import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageFindWorkerClient, type PageFindRequest, type PageFindWorkerPort } from '../../src/renderer/pageFindWorkerClient';
import { pageFindLimits } from '../../src/renderer/pageFindReplace';

const request: PageFindRequest = { operation: 'find', rows: [], keys: [], options: { kind: 'text', query: 'a', regex: true, caseSensitive: false, wholeCell: false }, generation: 1 };
/** 模拟消息与终止确认时序；实际恶意模式在线程测试和 Electron 中验证。 */
function fixture() {
  const ports: (PageFindWorkerPort & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> })[] = [];
  const client = new PageFindWorkerClient(() => { const port = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null, onmessageerror: null }; ports.push(port); return port; }, 100, 500);
  const ready = (index = 0) => ports[index].onmessage?.({ data: { type: 'dbark-page-find-ready', version: 1 } } as MessageEvent);
  const reply = (index = 0) => { ready(index); const id = ports[index].postMessage.mock.lastCall![0].id; ports[index].onmessage?.({ data: { id, result: { status: 'ready', operation: 'find', matches: [] } } } as MessageEvent); };
  return { client, ports, ready, reply };
}
afterEach(() => vi.useRealTimers());
describe('页内查找线程时序', () => {
  it('终止确认之前不交付取消或创建替代线程，旧消息不能完成新请求', async () => {
    const f = fixture(), first = f.client.run(request); await vi.waitFor(() => expect(f.ports).toHaveLength(1)); f.ready();
    let terminated!: () => void; f.ports[0].terminate.mockImplementation(() => new Promise<void>(resolve => { terminated = resolve; }));
    const late = f.ports[0].onmessage; let firstSettled = false; void first.then(() => { firstSettled = true; });
    const second = f.client.run(request); await Promise.resolve(); await Promise.resolve();
    expect(firstSettled).toBe(false); expect(f.ports).toHaveLength(1);
    late?.({ data: { id: 1, result: { status: 'ready', operation: 'find', matches: [] } } } as MessageEvent);
    terminated(); await expect(first).resolves.toMatchObject({ status: 'blocked', reason: 'cancelled' });
    await vi.waitFor(() => expect(f.ports).toHaveLength(2)); f.reply(1); await expect(second).resolves.toMatchObject({ status: 'ready' });
    await f.client.dispose();
  });
  it('启动和运行期限独立，重复握手不能延长期限，超时会真正终止', async () => {
    vi.useFakeTimers(); const f = fixture(), pending = f.client.run(request); await vi.advanceTimersByTimeAsync(400);
    expect(f.ports[0].postMessage).not.toHaveBeenCalled(); f.ready(); await vi.advanceTimersByTimeAsync(90); f.ready(); await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toMatchObject({ reason: 'timeout' }); expect(f.ports[0].terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); await f.client.dispose();
  });
  it('取消与卸载终止线程；超预算的旁列在创建或复制线程前拒绝', async () => {
    const f = fixture(), pending = f.client.run(request); await vi.waitFor(() => expect(f.ports).toHaveLength(1)); await f.client.cancel();
    await expect(pending).resolves.toMatchObject({ reason: 'cancelled' }); expect(f.ports[0].onmessage).toBeNull();
    const oversized = { ...request, rows: [{ id: '1', inserted: false, deleted: false, data: { blob: { type: 'binary' as const, base64: 'x'.repeat(pageFindLimits.bytes) } } }] };
    await expect(f.client.run(oversized)).resolves.toMatchObject({ reason: 'budget' }); expect(f.ports).toHaveLength(1);
    await f.client.dispose(); await expect(f.client.run(request)).resolves.toMatchObject({ reason: 'cancelled' }); expect(f.ports).toHaveLength(1);
  });
  it('启动失败不传原文；线程异常不回显模式，成功后也终止并清除定时器', async () => {
    const f = fixture(), first = f.client.run(request); await vi.waitFor(() => expect(f.ports).toHaveLength(1));
    f.ports[0].onerror?.({ preventDefault() {}, message: '私有模式' } as ErrorEvent);
    await expect(first).resolves.toMatchObject({ status: 'blocked', reason: 'worker' }); expect(f.ports[0].postMessage).not.toHaveBeenCalled();
    const second = f.client.run(request); await vi.waitFor(() => expect(f.ports).toHaveLength(2)); f.reply(1); await expect(second).resolves.toMatchObject({ status: 'ready' }); expect(f.ports[1].terminate).toHaveBeenCalledTimes(1); await f.client.dispose();
  });
});
