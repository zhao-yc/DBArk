import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: ports.fork } }));
import { EngineBroker } from '../../src/main/broker';

/** 只替换utility process的消息/退出端口，Broker的请求及退出代码保持真实。 */
function fixture(start = true) {
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(() => { child.emit('exit', 0); return true; }) });
  ports.fork.mockReturnValueOnce(child); const failed = vi.fn(), broker = new EngineBroker(vi.fn(), failed); if (start) broker.start();
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

describe('保存连接配置时按需启动数据库进程', () => {
  it.each([false, true])('未启动引擎时准备保存不创建数据库进程，传输变更=%s', async transportChanged => {
    const { broker, child, respond, failed } = fixture(false);
    const pending = broker.request('__connections.prepareSave', { id: 'offline', profile: { id: 'offline' }, transportChanged });
    // 修前仍回答原请求，避免反例因悬挂等待污染下一条；断言检查真实进程启动次数。
    if (child.postMessage.mock.calls.length) respond();
    await expect(pending).resolves.toBeUndefined();
    expect(ports.fork).not.toHaveBeenCalled(); expect(child.postMessage).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
  it('本地保存准备之后首次数据库操作仍发送原请求，不重放保存或写操作', async () => {
    const { broker, child, respond } = fixture(false);
    const prepare = broker.request('__connections.prepareSave', { id: 'offline', profile: { id: 'offline' } });
    if (child.postMessage.mock.calls.length) respond();
    await prepare;
    const input = { sessionId: 'session', sql: 'SELECT 1' }, query = broker.request('query.execute', input);
    const message = child.postMessage.mock.calls.at(-1)![0]; respond(); await query;
    expect(ports.fork).toHaveBeenCalledOnce();
    expect(child.postMessage).toHaveBeenCalledOnce(); expect(message).toMatchObject({ command: 'query.execute', input }); expect(message.input).toBe(input);
  });
  it('已有引擎必须等待原进程核验，忙会话拒绝原样传回且不终止进程', async () => {
    const { broker, child, respond, failed } = fixture(), input = { id: 'active', profile: { id: 'active' }, transportChanged: true };
    let settled = false;
    const pending = broker.request('__connections.prepareSave', input); void pending.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(child.postMessage.mock.calls[0][0]).toMatchObject({ command: '__connections.prepareSave', input });
    respond('该连接仍有打开的会话'); await expect(pending).rejects.toThrow('仍有打开的会话');
    expect(ports.fork).toHaveBeenCalledOnce(); expect(child.kill).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
  it.each([{}, { id: 'one', profile: { id: 'other' } }])('无可靠配置身份时仍由原引擎拒绝，不能走空引擎捷径：%j', async input => {
    const { broker, child, respond } = fixture(false), pending = broker.request('__connections.prepareSave', input);
    respond('主进程未提供有效连接配置'); await expect(pending).rejects.toThrow('未提供有效连接配置');
    expect(ports.fork).toHaveBeenCalledOnce(); expect(child.postMessage).toHaveBeenCalledOnce();
  });
});
