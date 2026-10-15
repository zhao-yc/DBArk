import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerMonitorController } from '../../src/renderer/components/ServerMonitorDialog';
import type { ServerMonitorSnapshot } from '../../src/shared/serverMonitor';
/** 可控真实 promise 用于验证取消与原任务结束之间的生命周期，而非仅比较定时器次数。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
afterEach(() => vi.useRealTimers());
describe('服务器监控刷新生命周期', () => {
  it('手动与自动不重叠，完成后才计算下一轮间隔', async () => {
    vi.useFakeTimers(); const first = deferred<ServerMonitorSnapshot>(), read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({}), publish = vi.fn();
    const controller = new ServerMonitorController('连接', { read, cancel: vi.fn().mockResolvedValue(undefined) }, publish, () => '任务');
    controller.setAutomatic(true); const start = controller.start(); await vi.advanceTimersByTimeAsync(0);
    void controller.refresh(); await vi.advanceTimersByTimeAsync(20000); expect(read).toHaveBeenCalledTimes(1);
    first.resolve({} as ServerMonitorSnapshot); await start; await vi.advanceTimersByTimeAsync(4999); expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2); await controller.stop();
  });
  it('隐藏/关闭等待原读取结束，快速重新打开也不能重叠', async () => {
    vi.useFakeTimers(); const first = deferred<ServerMonitorSnapshot>(), read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({}), cancel = vi.fn().mockResolvedValue(undefined), publish = vi.fn();
    const controller = new ServerMonitorController('连接', { read, cancel }, publish, () => '任务');
    void controller.start(); await vi.advanceTimersByTimeAsync(0); const stop = controller.stop(); let stopped = false; void stop.then(() => { stopped = true; });
    const reopen = controller.start(); await vi.advanceTimersByTimeAsync(10000); expect(stopped).toBe(false); expect(read).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledWith('任务');
    const count = publish.mock.calls.length; first.resolve({} as ServerMonitorSnapshot); await stop; await reopen;
    expect(read).toHaveBeenCalledTimes(2); expect(publish.mock.calls.slice(count).filter(([state]) => state.snapshot)).toHaveLength(1); await controller.stop();
  });
  it('取消失败仍占用原任务，停止后不会后台再读', async () => {
    vi.useFakeTimers(); const first = deferred<ServerMonitorSnapshot>(), read = vi.fn().mockReturnValue(first.promise), publish = vi.fn();
    const controller = new ServerMonitorController('连接', { read, cancel: vi.fn().mockRejectedValue(new Error('取消失败')) }, publish, () => '任务');
    controller.setAutomatic(true); void controller.start(); await vi.advanceTimersByTimeAsync(0); await controller.cancel();
    void controller.refresh(); await vi.advanceTimersByTimeAsync(10000); expect(read).toHaveBeenCalledTimes(1); expect(publish).toHaveBeenCalledWith({ busy: true, error: '取消失败' });
    const stopped = controller.stop(); first.reject(new Error('原任务结束')); await stopped; await vi.advanceTimersByTimeAsync(20000); expect(read).toHaveBeenCalledTimes(1);
  });
  it('停止先于首次微任务时不启动过期生命周期', async () => {
    const read = vi.fn(), controller = new ServerMonitorController('连接', { read, cancel: vi.fn() }, vi.fn());
    const start = controller.start(); await controller.stop(); await start; expect(read).not.toHaveBeenCalled();
  });
  it('读取已占位但尚未提交时停止，不发送读取或取消空任务', async () => {
    const read = vi.fn(), cancel = vi.fn(), publish = vi.fn();
    const controller = new ServerMonitorController('连接', { read, cancel }, publish, () => '任务');
    const start = controller.start();
    // start 首个 await 后已占位，实际服务调用仍在下一微任务。
    await Promise.resolve();
    await controller.stop(); await start;
    expect(read).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    expect(publish.mock.calls.some(([state]) => state.snapshot)).toBe(false);
  });
  it('用户在提交前取消也不会稍后启动读取', async () => {
    const read = vi.fn(), cancel = vi.fn(), controller = new ServerMonitorController('连接', { read, cancel }, vi.fn(), () => '任务');
    const start = controller.start(); await Promise.resolve();
    await controller.cancel(); await start;
    expect(read).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
    await controller.stop();
  });
});
