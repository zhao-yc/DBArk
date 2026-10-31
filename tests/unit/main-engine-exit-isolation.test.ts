import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '../../src/shared/contracts';
import { mainColumnsHarness } from './main-columns-owner-harness';

/** 网络进程退出使用真实Main函数及混合Map，只替换broker资源归属查询，不启动GUI或数据库。 */
describe('Main多引擎退出隔离', () => {
  it('网络退出标记网络准备任务并移除网络会话，SQLite准备项、会话和任务保持原事实', () => {
    const f = mainColumnsHarness(), context = f.context;
    const networkPreparing = { connectionIds: ['network-connection'], cancelled: false }, sqlitePreparing = { connectionIds: ['sqlite-connection'], cancelled: false };
    const networkSession = { connectionId: 'network-connection' }, sqliteSession = { connectionId: 'sqlite-connection' };
    context.preparingTasks.set('network-prepared', networkPreparing); context.preparingTasks.set('sqlite-prepared', sqlitePreparing);
    context.sessions.set('network-session', networkSession); context.sessions.set('sqlite-session', sqliteSession);
    const task = (id: string): TaskRecord => ({ id, kind: 'query.execute', status: 'running', progress: 0, message: '原任务', startedAt: '2026-10-31T00:00:00.000Z' });
    const sqliteRunning = task('sqlite-running'), sqlitePrepared = task('sqlite-prepared');
    for (const value of [task('network-running'), task('network-prepared'), sqliteRunning, sqlitePrepared]) f.tasks.set(value.id, value);
    context.broker.isSqliteConnection.mockImplementation((id: string) => id === 'sqlite-connection');
    context.broker.isSqliteSession.mockImplementation((id: string) => id === 'sqlite-session');
    context.broker.isSqliteTask.mockImplementation((id: string) => id === 'sqlite-running' || id === 'sqlite-prepared');

    context.actual.engineExited();

    expect(context.sessions.has('network-session')).toBe(false); expect(context.sessions.get('sqlite-session')).toBe(sqliteSession);
    expect(context.preparingTasks.get('network-prepared')).toMatchObject({ connectionIds: ['network-connection'], failure: '数据库进程已退出，准备任务已停止；尚未发送用户 SQL，原目标文件保持不变' });
    expect(context.preparingTasks.get('sqlite-prepared')).toBe(sqlitePreparing); expect(sqlitePreparing).toEqual({ connectionIds: ['sqlite-connection'], cancelled: false });
    expect(f.tasks.get('network-running')?.status).toBe('failed'); expect(f.tasks.get('network-prepared')?.status).toBe('failed');
    expect(f.tasks.get('sqlite-running')).toBe(sqliteRunning); expect(sqliteRunning.status).toBe('running');
    expect(f.tasks.get('sqlite-prepared')).toBe(sqlitePrepared); expect(sqlitePrepared.status).toBe('running');
    expect(f.events.map(event => event.taskId).sort()).toEqual(['network-prepared', 'network-running']);
    expect(context.broker.isSqliteConnection).toHaveBeenCalledWith('sqlite-connection'); expect(context.broker.isSqliteSession).toHaveBeenCalledWith('sqlite-session'); expect(context.broker.isSqliteTask).toHaveBeenCalledWith('sqlite-running');
    expect(f.request).not.toHaveBeenCalled();
  });
});
