import { describe, expect, it, vi } from 'vitest';
import { createServerMonitorServices } from '../../src/renderer/serverMonitorServices';
import { monitorDeferred, monitorSnapshot } from '../fixtures/server-monitor';
import type { invoke } from '../../src/renderer/lib';

/** 仅替换typed IPC端口，目标门和原任务取消仍运行正式适配器。 */
function service(current: () => boolean = () => true) { const request = vi.fn(), services = createServerMonitorServices('a', current, request as typeof invoke); return { request, services }; }
describe('服务器监控正式适配器范围与迟到保护', () => {
  it('直接投递一个监控任务，不额外打开测试连接，输入不含SQL或凭据', async () => {
    const { request, services } = service(); request.mockResolvedValueOnce(monitorSnapshot());
    await expect(services.read({ connectionId: 'a', taskId: 'owned', sessionLimit: 50 })).resolves.toMatchObject({ summary: { status: 'available' } });
    expect(request.mock.calls).toEqual([['serverMonitor.read', { connectionId: 'a', taskId: 'owned', sessionLimit: 50 }]]);
  });
  it('换目标或失效先于投递时零IPC，A→B→A不能恢复已观察失效的服务', async () => {
    let current = true; const { request, services } = service(() => current);
    const first = services.read({ connectionId: 'a', taskId: 'first' }); current = false;
    await expect(first).rejects.toThrow('当前连接不可用'); current = true;
    await expect(services.read({ connectionId: 'a', taskId: 'again' })).rejects.toThrow('当前连接不可用'); expect(request).not.toHaveBeenCalled();
  });
  it('错误连接编号和同一目标重叠读取均拒绝，不复用别人的任务号', async () => {
    const { request, services } = service(), pending = monitorDeferred<ReturnType<typeof monitorSnapshot>>(); request.mockReturnValueOnce(pending.promise);
    await expect(services.read({ connectionId: 'b', taskId: 'foreign' })).rejects.toThrow();
    const read = services.read({ connectionId: 'a', taskId: 'owned' }); await Promise.resolve();
    await expect(services.read({ connectionId: 'a', taskId: 'second' })).rejects.toThrow(); await services.cancel('foreign'); expect(request).toHaveBeenCalledOnce(); pending.resolve(monitorSnapshot()); await read;
  });
  it('投递前取消不发送查询或取消IPC', async () => {
    const { request, services } = service(), read = services.read({ connectionId: 'a', taskId: 'owned' }); await services.cancel('owned');
    await expect(read).rejects.toThrow('已请求取消'); expect(request).not.toHaveBeenCalled();
  });
  it('投递后取消只发送原任务一次，迟到快照即使成功也拒绝交付', async () => {
    const { request, services } = service(), pending = monitorDeferred<ReturnType<typeof monitorSnapshot>>(); request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(undefined);
    const read = services.read({ connectionId: 'a', taskId: 'owned' }); await Promise.resolve(); const cancelled = services.cancel('owned'); expect(services.cancel('owned')).toBe(cancelled); await cancelled;
    expect(request.mock.calls[1]).toEqual(['query.cancel', { taskId: 'owned' }]); pending.resolve(monitorSnapshot()); await expect(read).rejects.toThrow('已请求取消'); expect(request).toHaveBeenCalledTimes(2);
  });
  it('IPC等待期间目标失效时丢弃旧快照，取消失败也不触发重放', async () => {
    let current = true; const { request, services } = service(() => current), pending = monitorDeferred<ReturnType<typeof monitorSnapshot>>(); request.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(Error('RAM取消未知'));
    const read = services.read({ connectionId: 'a', taskId: 'owned' }); await Promise.resolve(); await expect(services.cancel('owned')).rejects.toThrow('RAM取消未知'); current = false; pending.resolve(monitorSnapshot());
    await expect(read).rejects.toThrow('当前连接不可用'); expect(request.mock.calls.map(call => call[0])).toEqual(['serverMonitor.read', 'query.cancel']);
  });
});
