import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerMonitorController, serverMonitorAutomaticRounds, type ServerMonitorViewState } from '../../src/renderer/serverMonitorController';
import type { ServerMonitorSnapshot } from '../../src/shared/serverMonitor';
import { monitorDeferred as deferred, monitorSnapshot as snapshot } from '../fixtures/server-monitor';

afterEach(() => vi.useRealTimers());
/** 记录真实控制器完整状态；服务全是RAM端口，无IPC、网络、存储或后台SQL。 */
function fixture(read = vi.fn().mockResolvedValue(snapshot()), cancel = vi.fn().mockResolvedValue(undefined)) {
  const views: ServerMonitorViewState[] = [], entered = deferred<void>(); let id = 0;
  const controller = new ServerMonitorController(view => views.push(view), () => 'monitor-' + ++id);
  return { controller, views, read, cancel, entered: entered.promise, services: { read: (input: Parameters<import('../../src/renderer/serverMonitorController').ServerMonitorServices['read']>[0]) => { entered.resolve(); return read(input); }, cancel }, last: () => views.at(-1)! };
}
describe('服务器监控独立控制器', () => {
  it('手动双击仍只有一个请求，明确只读输入和默认50条预算', async () => {
    const first = deferred<ServerMonitorSnapshot>(), f = fixture(vi.fn().mockReturnValue(first.promise));
    const started = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await f.entered;
    const one = f.controller.refresh(), two = f.controller.refresh(); expect(one).toBe(two); expect(f.read).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledWith({ connectionId: 'a', taskId: 'monitor-1', sessionLimit: 50 });
    first.resolve(snapshot()); await started; expect(f.last().busy).toBe(false); await f.controller.stop();
  });
  it('启动微任务前关闭不发送读取或取消空任务', async () => {
    const f = fixture(), started = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await f.controller.stop(); await started;
    expect(f.read).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  });
  it('A/B/A与修订变化均撤销原回包，原read和cancel都结束才读新目标', async () => {
    const old = deferred<ServerMonitorSnapshot>(), control = deferred<unknown>(), f = fixture(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(snapshot('新服务器')), vi.fn().mockReturnValue(control.promise));
    const a = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await f.entered;
    const b = f.controller.start({ connectionId: 'b', connectionRevision: 1 }, f.services), next = f.controller.start({ connectionId: 'a', connectionRevision: 2 }, f.services); await Promise.resolve();
    old.resolve(snapshot('旧敏感服务器')); await Promise.resolve(); await Promise.resolve(); expect(f.read).toHaveBeenCalledOnce(); expect(f.views.some(view => view.snapshot?.summary.status === 'available' && view.snapshot.summary.value.hostname === '旧敏感服务器')).toBe(false);
    control.resolve(undefined); await Promise.all([a, b, next]); expect(f.read).toHaveBeenCalledTimes(2); expect(f.read.mock.calls.at(-1)![0].connectionId).toBe('a'); expect(f.last().target?.connectionRevision).toBe(2); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('monitor-1'); await f.controller.stop();
  });
  it('取消失败仍等原读，停止自动刷新且拒收取消后的迟到快照', async () => {
    vi.useFakeTimers(); const old = deferred<ServerMonitorSnapshot>(), f = fixture(vi.fn().mockReturnValue(old.promise), vi.fn().mockRejectedValue(Error('RAM私有取消正文')));
    const started = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await vi.advanceTimersByTimeAsync(0); f.controller.setAutomatic(true); const cancelled = f.controller.cancel(); await vi.advanceTimersByTimeAsync(10000);
    expect(f.last().busy).toBe(true); expect(f.last().automatic).toBe(false); expect(f.read).toHaveBeenCalledOnce(); expect(f.last().error).not.toContain('私有');
    old.resolve(snapshot('取消后不能展示')); await Promise.all([started, cancelled]); expect(f.last().snapshot).toBeUndefined(); expect(f.last().busy).toBe(false); await f.controller.stop();
  });
  it('原任务完成后至少5秒才自动刷新，最多60轮，不堆积请求', async () => {
    vi.useFakeTimers(); const first = deferred<ServerMonitorSnapshot>(), f = fixture(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(snapshot()));
    const started = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await vi.advanceTimersByTimeAsync(0); f.controller.setAutomatic(true); await vi.advanceTimersByTimeAsync(20000); expect(f.read).toHaveBeenCalledOnce();
    first.resolve(snapshot()); await started; await vi.advanceTimersByTimeAsync(4999); expect(f.read).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(1); expect(f.read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000 * (serverMonitorAutomaticRounds + 1)); expect(f.read).toHaveBeenCalledTimes(1 + serverMonitorAutomaticRounds); expect(f.last().automatic).toBe(false); await f.controller.stop();
  });
  it('同步服务异常只发通用错误，自动读取暂停，无后台重试', async () => {
    const f = fixture(vi.fn(() => { throw Error('含认证的驱动正文'); })); await f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services);
    expect(f.last().busy).toBe(false); expect(f.last().error).not.toContain('认证'); expect(f.last().automatic).toBe(false); await f.controller.stop();
  });
  it('重复stop只取消原任务一次', async () => {
    const old = deferred<ServerMonitorSnapshot>(), f = fixture(vi.fn().mockReturnValue(old.promise)); const started = f.controller.start({ connectionId: 'a', connectionRevision: 1 }, f.services); await f.entered;
    const one = f.controller.stop(), two = f.controller.stop(); old.resolve(snapshot()); await Promise.all([one, two, started]); expect(f.cancel).toHaveBeenCalledExactlyOnceWith('monitor-1');
  });
});
