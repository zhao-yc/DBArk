import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ConnectionProfile, SqliteConnectionProfile } from '../../src/shared/contracts';

const ports = vi.hoisted(() => ({ fork: vi.fn(), sqlite: vi.fn(), close: vi.fn(), force: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: ports.fork } }));
// 这里只隔离两个运行时边界，真实Broker负责路由及网络消息；磁盘执行由runtime专项另验。
vi.mock('../../src/main/sqliteRuntime', () => ({ SqliteRuntime: class {
  ownsSession(id: string) { return id.startsWith('sqlite:'); }
  ownsTask(id: string) { return id === 'sqlite-task'; }
  ownsConnection(id: string) { return id === 'closed-sqlite'; }
  request = ports.sqlite; close = ports.close; forceClose = ports.force;
} }));
import { EngineBroker } from '../../src/main/broker';

const profile: SqliteConnectionProfile = { id: 'file', name: '文件库', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: '/Main授权/sample.sqlite', readOnly: true, busyTimeoutMs: 1000 } };
/** 网络端只回真实Broker所发消息，不包含数据库执行或文件访问。 */
function fixture() {
  const child = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn(() => true) });
  ports.fork.mockReturnValue(child);
  const profiles: ConnectionProfile[] = [profile], failed = vi.fn();
  const broker = new EngineBroker(vi.fn(), failed, id => profiles.find(value => value.id === id));
  const reply = (error?: string) => child.emit('message', { id: child.postMessage.mock.calls.at(-1)![0].id, result: 'network', ...(error ? { error } : {}) });
  return { child, broker, profiles, failed, reply };
}
beforeEach(() => { vi.clearAllMocks(); ports.sqlite.mockReset().mockResolvedValue('sqlite'); ports.close.mockReset().mockResolvedValue(undefined); ports.force.mockReset().mockResolvedValue(undefined); });

it.each([
  ['metadata.objects', { connectionId: 'file', database: 'main' }],
  ['query.execute', { sessionId: 'sqlite:old', taskId: 'new', sql: 'SELECT 1' }],
  ['query.cancel', { taskId: 'sqlite-task' }],
  ['connections.close', { id: 'closed-sqlite' }],
  ['table.copyData', { source: { connectionId: 'file' }, target: { connectionId: 'mysql' } }],
] as const)('%s命中SQLite后端拒绝也不转发网络进程', async (command, input) => {
  const { broker } = fixture(), failure = Error('SQLite尚未接入或原会话已失效'); ports.sqlite.mockRejectedValueOnce(failure);
  await expect(broker.request(command, input)).rejects.toBe(failure);
  expect(ports.sqlite).toHaveBeenCalledExactlyOnceWith(command, input); expect(ports.fork).not.toHaveBeenCalled();
});
it('已删配置的SQLite会话编号仍终结于原路由，同名网络请求不受影响', async () => {
  const { broker, profiles, child, reply } = fixture(); profiles.length = 0;
  await expect(broker.request('query.sessionState', { sessionId: 'sqlite:unknown' })).resolves.toBe('sqlite');
  expect(ports.fork).not.toHaveBeenCalled();
  const pending = broker.request('metadata.objects', { connectionId: 'mysql', database: 'app' }); reply(); await expect(pending).resolves.toBe('network');
  expect(child.postMessage).toHaveBeenCalledOnce(); expect(ports.sqlite).toHaveBeenCalledOnce();
});
it('SQLite准备期尚未提交任务的取消不加载冷网络引擎；热网络取消仍交给原进程', async () => {
  const { broker, child, reply } = fixture(), input = { taskId: '尚未投递的查询' };
  await broker.request('query.cancel', input); expect(ports.fork).not.toHaveBeenCalled(); expect(ports.sqlite).not.toHaveBeenCalled();
  broker.start(); const cancel = broker.request('query.cancel', input); reply(); await cancel;
  expect(child.postMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ command: 'query.cancel', input }));
});
it('冷网络保存SQLite不加载mysql2，热网络仍核验原ID占用并保留原错误', async () => {
  const { broker, child, reply } = fixture(), input = { id: profile.id, profile, transportChanged: true };
  await broker.request('__connections.prepareSave', input); expect(ports.fork).not.toHaveBeenCalled();
  broker.start(); const pending = broker.request('__connections.prepareSave', input);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledOnce()); reply('网络原ID仍在测试中');
  await expect(pending).rejects.toThrow('网络原ID仍在测试中'); expect(child.kill).not.toHaveBeenCalled();
  expect(ports.sqlite).toHaveBeenCalledTimes(2);
});
it('SQLite退出失败时网络ACK不触发kill，重试保留准确资源后才能退出', async () => {
  const { broker, child, reply } = fixture(); broker.start(); ports.close.mockRejectedValueOnce(Error('SQLite准确句柄尚未退出'));
  const pending = broker.close(); reply(); await expect(pending).rejects.toThrow('准确句柄尚未退出'); expect(child.kill).not.toHaveBeenCalled();
  const retry = broker.close(); reply(); await retry; expect(child.kill).toHaveBeenCalledOnce(); expect(ports.close).toHaveBeenCalledTimes(2);
});
