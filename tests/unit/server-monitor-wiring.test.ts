import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
const ports = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: ports.connect, execute: ports.execute }));
import { Engine } from '../../src/engine';
import { validateCommand } from '../../src/shared/validation';
import { publicCommands } from '../../src/shared/commands';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';

const profile: ConnectionProfile = { id: 'monitor-connection', name: '只读RAM夹具', group: '', color: '', dialect: 'mysql', host: 'never-connect.invalid', port: 1, user: 'RAM用户' };
const summary = { version: '8.4.11', versionComment: 'RAM', hostname: 'RAM主机', port: '3306', currentUser: 'RAM用户@%', connectionId: '9007199254740993' };
type QueryCallback = (error: Error | null, rows?: unknown, fields?: unknown[]) => void;
/** 只模拟驱动边界，独立任务、真实固定SQL读取、取消和严格关闭均执行产品代码。 */
function managed(signal?: AbortSignal, hold?: (sql: string, callback: QueryCallback) => boolean): ManagedConnection {
  const connection = Object.assign(new EventEmitter(), { threadId: 42, destroy: vi.fn(), query: vi.fn((sql: string, callback: QueryCallback) => {
    if (hold?.(sql, callback)) return;
    if (sql.startsWith('SELECT LEFT(VERSION()')) callback(null, [summary], []);
    else if (sql.startsWith('SHOW GLOBAL STATUS')) callback(null, [{ Variable_name: 'Questions', Value: '18446744073709551615' }], []);
    else if (sql.includes('information_schema.PROCESSLIST')) callback(null, [], []);
    else callback(Error('夹具拒绝固定范围外SQL'));
  }) });
  return { connection, profile, broken: false, signal, close: vi.fn(async () => {}), status: { dialect: 'mysql' } } as unknown as ManagedConnection;
}
/** 主进程已打开连接的RAM状态；不调用网络、文件、真实凭据或用户会话。 */
function engine() { const events: TaskEvent[] = []; const value = new Engine(event => events.push(event)); Reflect.get(value, 'profiles').set(profile.id, profile); return { value, events }; }
beforeEach(() => { ports.connect.mockReset(); ports.execute.mockReset(); });

describe('服务器监控正式命令接线', () => {
  it('公开命令有typed白名单且拒绝任意SQL、额外权限和超限会话', () => {
    expect(publicCommands['serverMonitor.read']).toBe(true);
    expect(validateCommand('serverMonitor.read', { connectionId: profile.id, taskId: 'read', sessionLimit: 100 })).toEqual({ connectionId: profile.id, taskId: 'read', sessionLimit: 100 });
    for (const extra of [{ sql: 'KILL 42' }, { sessionLimit: 101 }, { sessionLimit: 1.5 }, { allUsers: true }]) expect(() => validateCommand('serverMonitor.read', { connectionId: profile.id, taskId: 'read', ...extra })).toThrow();
  });
  it('用独立短连接读取三个固定片段，不触碰已打开的用户SQL会话', async () => {
    const { value, events } = engine(), dedicated = managed(), user = managed();
    Reflect.get(value, 'sessions').set('user-session', { id: 'user-session', connectionId: profile.id, managed: user, busy: false });
    ports.connect.mockResolvedValueOnce(dedicated);
    const result = await value.handle('serverMonitor.read', { connectionId: profile.id, taskId: 'read' });
    expect(result.summary.value).toEqual(summary); expect(result.globalStatus.value[0].value).toBe('18446744073709551615');
    expect(dedicated.connection.query).toHaveBeenCalledTimes(3); expect(user.connection.query).not.toHaveBeenCalled(); expect(user.close).not.toHaveBeenCalled();
    expect(ports.connect).toHaveBeenCalledWith(profile, undefined, expect.any(AbortSignal), expect.any(Function)); expect(dedicated.close).toHaveBeenCalledWith({ strict: true }); expect(events.at(-1)).toMatchObject({ taskId: 'read', status: 'completed' });
  });
  it('快照必须等同一短连接严格收尾后才落定', async () => {
    const { value } = engine(), dedicated = managed(); let release!: () => void;
    vi.mocked(dedicated.close).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })); ports.connect.mockResolvedValueOnce(dedicated);
    let settled = false; const pending = value.handle('serverMonitor.read', { connectionId: profile.id, taskId: 'read' }).finally(() => { settled = true; });
    await vi.waitFor(() => expect(dedicated.close).toHaveBeenCalledOnce()); expect(settled).toBe(false); release(); await pending; expect(settled).toBe(true);
  });
  it('严格关闭失败拒绝快照，完成事件不能假报成功', async () => {
    const { value, events } = engine(), dedicated = managed(); vi.mocked(dedicated.close).mockRejectedValueOnce(Error('RAM严格关闭失败')); ports.connect.mockResolvedValueOnce(dedicated);
    await expect(value.handle('serverMonitor.read', { connectionId: profile.id, taskId: 'read' })).rejects.toThrow('独立任务连接关闭失败'); expect(events.at(-1)).toMatchObject({ status: 'failed', message: '读取服务器监控失败' });
  });
  it('建连阶段取消只中止同一读取，不再发固定SQL或借用用户会话', async () => {
    const { value } = engine(); let signal!: AbortSignal;
    ports.connect.mockImplementationOnce((_profile, _database, current: AbortSignal) => new Promise((_resolve, reject) => { signal = current; current.addEventListener('abort', () => reject(Error('RAM建连已取消')), { once: true }); }));
    const pending = value.handle('serverMonitor.read', { connectionId: profile.id, taskId: 'read' }).catch(error => error);
    expect(signal.aborted).toBe(false); await value.handle('query.cancel', { taskId: 'read' }); expect(signal.aborted).toBe(true); expect(await pending).toBeInstanceOf(Error); expect(ports.connect).toHaveBeenCalledOnce();
  });
  it('读取中取消走准确专属threadId，等待原命令终态且严格关闭控制连接', async () => {
    const { value } = engine(); let complete!: QueryCallback;
    const dedicated = managed(undefined, (_sql, callback) => { complete = callback; return true; }), control = managed();
    ports.connect.mockImplementationOnce((_p, _d, signal) => { dedicated.signal = signal; return dedicated; }).mockResolvedValueOnce(control); ports.execute.mockResolvedValueOnce({ rows: [] });
    const read = value.handle('serverMonitor.read', { connectionId: profile.id, taskId: 'read' }).catch(error => error);
    await vi.waitFor(() => expect(dedicated.connection.query).toHaveBeenCalledOnce());
    let cancelled = false; const cancellation = value.handle('query.cancel', { taskId: 'read' }).then(() => { cancelled = true; });
    await vi.waitFor(() => expect(ports.execute).toHaveBeenCalledWith(control, 'KILL CONNECTION 42')); expect(cancelled).toBe(false); expect(control.close).not.toHaveBeenCalled();
    complete(Object.assign(Error('RAM读取终包'), { errno: 1317 })); await cancellation; expect(await read).toBeInstanceOf(Error); expect(dedicated.connection.query).toHaveBeenCalledOnce(); expect(control.close).toHaveBeenCalledWith({ strict: true }); expect(dedicated.close).toHaveBeenCalledWith({ strict: true });
  });
  it.each(['running', 'completed', 'failed', 'cancelled'] as const)('%s持久摘要不包含会话SQL、账号或错误原文', status => {
    const secret = 'RAM账号和SQL敏感内容'; const text = persistedTaskMessage('serverMonitor.read', { taskId: 'read', status, progress: 0, message: secret }); expect(text).not.toContain(secret); expect(text).toContain('监控');
  });
});
