import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionResourceOwner, type ConnectionResourceRecovery } from '../../src/engine/connectionResourceState';
import { IndependentTaskResources } from '../../src/engine/independentTaskResources';

/** 使用真实资源证明器及RAM流事件，destroy调用本身不会变成关闭证据。 */
function owned() {
  const stream = Object.assign(new EventEmitter(), { closed: false, destroy: vi.fn() });
  const destroyDriver = vi.fn(); const owner = new ConnectionResourceOwner(() => stream, destroyDriver, 20);
  owner.captureTransport(true); owner.seal();
  const close = () => { stream.closed = true; stream.emit('close'); };
  return { stream, owner, close, destroyDriver };
}
afterEach(() => vi.useRealTimers());

describe('独立任务物理资源隔离账本', () => {
  it('容量和任务号在分配前预留，正常严格关闭兼容既有内部端口', () => {
    const book = new IndependentTaskResources(1), release = vi.fn(), lease = book.reserve('connection', 'first', release);
    expect(() => book.reserve('connection', 'second', vi.fn())).toThrow('上限'); expect(() => book.reserve('connection', 'first', vi.fn())).toThrow('编号');
    expect(lease.settle(false)).toBe(true); expect(release).toHaveBeenCalledOnce(); expect(book.owns('first')).toBe(false);
  });
  it('关闭失败且流未终态保留任务号和目标，流后来关闭也只在显式恢复时释放', async () => {
    const book = new IndependentTaskResources(), release = vi.fn(), resource = owned(), lease = book.reserve('connection', 'task', release);
    lease.capture(resource.owner.recovery); expect(lease.settle(true)).toBe(false); expect(book.retained('connection')).toBe(true); expect(release).not.toHaveBeenCalled();
    resource.close(); expect(release).not.toHaveBeenCalled(); expect(await book.recover('connection')).toEqual({ released: 1, remaining: 0 }); expect(release).toHaveBeenCalledOnce(); expect(await book.recover()).toEqual({ released: 0, remaining: 0 });
  });
  it('主流已关但控制连接仍活跃时不释放全部目标；显式恢复包含控制连接', async () => {
    const book = new IndependentTaskResources(), release = vi.fn(), main = owned(), control = owned(), lease = book.reserve('connection', 'task', release);
    lease.capture(main.owner.recovery); lease.capture(control.owner.recovery); main.close(); expect(lease.settle(true)).toBe(false);
    control.stream.destroy.mockImplementationOnce(control.close); expect(await book.recover()).toEqual({ released: 1, remaining: 0 }); expect(control.destroyDriver).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it('同一条目并发恢复合并，destroy无真实close不能释放', async () => {
    vi.useFakeTimers(); const book = new IndependentTaskResources(), resource = owned(), lease = book.reserve('connection', 'task', vi.fn());
    lease.capture(resource.owner.recovery); lease.settle(true); const first = book.recover(), second = book.recover(); await vi.advanceTimersByTimeAsync(21);
    expect(await first).toEqual({ released: 0, remaining: 1 }); expect(await second).toEqual({ released: 0, remaining: 1 }); expect(resource.destroyDriver).toHaveBeenCalledOnce(); expect(book.owns('task')).toBe(true);
  });
  it('恢复端口永不落定仍受host预算限制，保留原条目且不泄漏原错误', async () => {
    vi.useFakeTimers(); const book = new IndependentTaskResources(1, 30), resource = owned();
    const recovery: ConnectionResourceRecovery = { snapshot: () => resource.owner.recovery.snapshot(), recover: () => new Promise(() => {}) };
    const lease = book.reserve('connection', 'task', vi.fn()); lease.capture(recovery); lease.settle(true); const pending = book.recover(); await vi.advanceTimersByTimeAsync(31);
    expect(await pending).toEqual({ released: 0, remaining: 1 }); expect(book.owns('task')).toBe(true);
  });
  it('活动动作不被显式恢复触碰，连接筛选不回收其他连接资源', async () => {
    const book = new IndependentTaskResources(), a = owned(), b = owned(), first = book.reserve('a', 'first', vi.fn()), second = book.reserve('b', 'second', vi.fn());
    first.capture(a.owner.recovery); second.capture(b.owner.recovery); second.settle(true);
    expect(await book.recover('a')).toEqual({ released: 0, remaining: 0 }); expect(a.destroyDriver).not.toHaveBeenCalled(); expect(b.destroyDriver).not.toHaveBeenCalled();
    a.close(); first.settle(false); b.close(); expect(await book.recover('b')).toEqual({ released: 1, remaining: 0 });
  });
  it('恢复抛错或缺少可证明资源都保持占位，不重试原关闭Promise', async () => {
    const book = new IndependentTaskResources(), resource = owned(), recover = vi.fn(async () => { throw Error('RAM原错误不得投影'); });
    const lease = book.reserve('connection', 'task', vi.fn()); lease.capture({ snapshot: () => resource.owner.recovery.snapshot(), recover }); lease.settle(true);
    expect(await book.recover()).toEqual({ released: 0, remaining: 1 }); expect(recover).toHaveBeenCalledOnce();
    const missing = book.reserve('connection', 'missing', vi.fn()); expect(missing.settle(true)).toBe(false); expect(await book.recover()).toEqual({ released: 0, remaining: 2 });
  });
  it('资源清单超预算即永久未知，不能因已存四项全关就漏放第五项', async () => {
    const book = new IndependentTaskResources(), release = vi.fn(), lease = book.reserve('connection', 'task', release);
    for (let i = 0; i < 5; i++) { const item = owned(); item.close(); lease.capture(item.owner.recovery); }
    expect(lease.settle(false)).toBe(false); expect(await book.recover()).toEqual({ released: 0, remaining: 1 }); expect(release).not.toHaveBeenCalled();
  });
  it('尚有迟到分配回调时不提前释放，收到原回调并关同一流后才能恢复', async () => {
    const book = new IndependentTaskResources(), release = vi.fn(), item = owned(), finishAllocation = item.owner.beginAllocation(), lease = book.reserve('connection', 'task', release);
    item.close(); lease.capture(item.owner.recovery); expect(lease.settle(true)).toBe(false); finishAllocation(); expect(await book.recover()).toEqual({ released: 1, remaining: 0 }); expect(release).toHaveBeenCalledOnce();
  });
});
