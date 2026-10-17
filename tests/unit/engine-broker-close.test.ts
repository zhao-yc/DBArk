import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: ports.fork } }));
import { EngineBroker } from '../../src/main/broker';

/** 只替换utility process的消息/退出端口，Broker的请求及退出代码保持真实。 */
function fixture() {
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(() => { child.emit('exit', 0); return true; }) });
  ports.fork.mockReturnValueOnce(child); const failed = vi.fn(), broker = new EngineBroker(vi.fn(), failed); broker.start();
  const respond = (error?: string) => { const sent = child.postMessage.mock.calls.at(-1)![0]; child.emit('message', { id: sent.id, ...(error ? { error } : { result: undefined }) }); };
  return { child, broker, failed, respond };
}
beforeEach(() => ports.fork.mockReset()); afterEach(() => vi.useRealTimers());

describe('数据库进程普通退出与显式强退', () => {
  it('只有原引擎成功ACK后才终止进程，并发退出只发送一个shutdown', async () => {
    const { child, broker, failed, respond } = fixture(); const first = broker.close(), second = broker.close(); expect(second).toBe(first); expect(child.postMessage).toHaveBeenCalledOnce(); expect(child.kill).not.toHaveBeenCalled();
    respond(); await first; expect(child.kill).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });
  it('引擎明确拒绝时保留同一进程，后续显式重试成功才kill', async () => {
    const { child, broker, respond } = fixture(); const first = broker.close(); respond('物理资源尚未确认释放'); await expect(first).rejects.toThrow('尚未确认释放'); expect(child.kill).not.toHaveBeenCalled();
    const second = broker.close(); expect(child.postMessage).toHaveBeenCalledTimes(2); respond(); await second; expect(child.kill).toHaveBeenCalledOnce(); expect(ports.fork).toHaveBeenCalledOnce();
  });
  it('超时不自动kill，迟到ACK也不能变成隐式终止；用户重试仍沿原进程', async () => {
    vi.useFakeTimers(); const { child, broker, respond } = fixture(); const first = broker.close(), rejected = expect(first).rejects.toThrow('收尾尚未确认'); await vi.advanceTimersByTimeAsync(3001); await rejected;
    expect(child.kill).not.toHaveBeenCalled(); respond(); await Promise.resolve(); expect(child.kill).not.toHaveBeenCalled(); const retry = broker.close(); respond(); await retry; expect(child.kill).toHaveBeenCalledOnce(); expect(ports.fork).toHaveBeenCalledOnce();
  });
  it('未收到ACK的意外退出仍通知主进程，不当作正常退出隐藏', async () => {
    const { child, broker, failed } = fixture(), pending = broker.close(); child.emit('exit', 1); await expect(pending).rejects.toThrow('执行进程已退出'); expect(failed).toHaveBeenCalledOnce(); expect(child.kill).not.toHaveBeenCalled();
  });
  it('强制终止只能由独立显式入口触发，不重发shutdown或数据库命令', async () => {
    const { child, broker, respond, failed } = fixture(); const pending = broker.close(); respond('资源未知'); await expect(pending).rejects.toThrow('资源未知'); expect(child.kill).not.toHaveBeenCalled(); broker.forceClose(); expect(child.kill).toHaveBeenCalledOnce(); expect(child.postMessage).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  });
  it('kill明确失败不能假报退出成功，仍可重试', async () => {
    const { child, broker, respond } = fixture(); child.kill.mockReturnValueOnce(false); const pending = broker.close(); respond(); await expect(pending).rejects.toThrow('未能终止'); child.kill.mockReturnValueOnce(false); expect(() => broker.forceClose()).toThrow('强制退出未能');
  });
  it('没有引擎时退出不会为收尾临时启动新的进程', async () => {
    const broker = new EngineBroker(vi.fn(), vi.fn()); await broker.close(); broker.forceClose(); expect(ports.fork).not.toHaveBeenCalled();
  });
});
