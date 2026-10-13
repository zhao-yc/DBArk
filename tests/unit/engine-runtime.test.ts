import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'test', name: '测试', group: '', color: '', dialect: 'mysql', host: 'test.invalid', port: 3306, user: 'test' };
let scenario: (sql: string, query: EventEmitter) => void;
let engine: Engine, sessionId: string, events: TaskEvent[];

/** 模拟网络事件只验证控制流，不把这类单元测试当作数据库兼容性验收。 */
function managed(): ManagedConnection {
  const connection = new EventEmitter() as EventEmitter & { threadId: number; query: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  connection.threadId = 42;
  connection.destroy = vi.fn();
  connection.query = vi.fn((options: { sql: string }) => {
    const result = new EventEmitter(); queueMicrotask(() => scenario(options.sql, result)); return result;
  });
  return { connection, profile, sqlMode: '', serverStatus: 2, status: { version: '模拟服务器', dialect: 'mysql' }, broken: false, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
}
function rows(query: EventEmitter, values: unknown[][]): void {
  query.emit('fields', [{ name: 'value', columnType: 253 }], 0);
  values.forEach(value => query.emit('result', value, 0)); query.emit('end');
}

beforeEach(async () => {
  mocks.connect.mockReset().mockImplementation(async () => managed());
  mocks.execute.mockReset().mockImplementation(async (_managed: ManagedConnection, sql: string) => ({ rows: sql.includes('sql_mode') ? [{ mode: '' }] : { affectedRows: 1, serverStatus: 2 }, fields: [] }));
  mocks.tableInfo.mockReset().mockResolvedValue({ database: 'db', name: 'table', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: [
    { name: 'id', type: 'int', nullable: false, generated: false }, { name: 'value', type: 'varchar(20)', nullable: true, generated: false },
  ] });
  scenario = (_sql, query) => rows(query, [['ok']]);
  events = []; engine = new Engine(event => events.push(event));
  await engine.handle('connections.open', { id: profile.id, profile });
  sessionId = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
});

describe('查询任务与会话互斥', () => {
  it('驱动在连接上报告致命错误时查询立即失败并释放监听器', async () => {
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    scenario = () => { active.connection.emit('error', new Error('模拟解析器致命错误')); };
    await expect(engine.handle('query.execute', { sessionId, sql: 'SELECT value', taskId: 'fatal-error', maxRows: 1 })).rejects.toThrow('模拟解析器致命错误');
    expect(active.connection.listenerCount('error')).toBe(0); expect(events.at(-1)?.status).toBe('failed');
  });
  it('真实驱动的无字段 DDL/DML 状态包能正常完成，不能等待不存在的列数组', async () => {
    scenario = (_sql, query) => {
      query.emit('fields', undefined);
      query.emit('result', { affectedRows: 1, insertId: 0, warningStatus: 0, serverStatus: 2 });
      query.emit('end');
    };
    const output = await engine.handle('query.execute', { sessionId, sql: 'CREATE DATABASE example', taskId: 'ddl-header', maxRows: 10 });
    expect(output.results).toHaveLength(1); expect(output.results[0].affectedRows).toBe(1); expect(output.results[0].columns).toEqual([]);
    expect(events.at(-1)?.status).toBe('completed');
  });

  it('CALL 最后的无索引状态包独立成项，不覆盖之前的多结果集', async () => {
    scenario = (_sql, query) => {
      query.emit('fields', [{ name: 'first', columnType: 253 }], 0); query.emit('result', ['一'], 0);
      query.emit('fields', [{ name: 'second', columnType: 253 }], 1); query.emit('result', ['二'], 1);
      query.emit('fields', undefined); query.emit('result', { affectedRows: 0, insertId: 0, warningStatus: 0, serverStatus: 2 }); query.emit('end');
    };
    const output = await engine.handle('query.execute', { sessionId, sql: 'CALL example()', taskId: 'call-status', maxRows: 10 });
    expect(output.results).toHaveLength(3); expect(output.results[0].rows).toEqual([{ c0: '一' }]); expect(output.results[1].rows).toEqual([{ c0: '二' }]);
    expect(output.results[2].affectedRows).toBe(0); expect(output.results[0].affectedRows).toBeUndefined();
  });

  it('整个脚本共享结果行数预算，分批事件与最终值一致', async () => {
    scenario = (_sql, query) => rows(query, Array.from({ length: 250 }, (_, index) => [String(index)]));
    const output = await engine.handle('query.execute', { sessionId, sql: 'SELECT 1; SELECT 2;', taskId: 'rows', maxRows: 300 });
    expect(output.results.map((result: { rows: unknown[] }) => result.rows.length)).toEqual([250, 50]);
    expect(output.results[1].truncated).toBe(true);
    expect(events.filter(event => event.batch).map(event => event.batch!.length)).toEqual([200, 50, 50]);
  });

  it('巨大单元格不经 IPC 传输且明确截断', async () => {
    scenario = (_sql, query) => rows(query, [[Buffer.alloc(300000)]]);
    const output = await engine.handle('query.execute', { sessionId, sql: 'SELECT blob', taskId: 'blob', maxRows: 10 });
    expect(output.results[0].rows).toEqual([]); expect(output.results[0].truncated).toBe(true);
    expect(events.some(event => event.batch?.length)).toBe(false);
  });

  it('取消控制连接仍在建立时不释放会话，也不误杀已经结束的查询', async () => {
    let pending: EventEmitter | undefined;
    scenario = (_sql, query) => { pending = query; };
    const running = engine.handle('query.execute', { sessionId, sql: 'SELECT SLEEP(10)', taskId: 'cancel-race', maxRows: 1 });
    const failure = expect(running).rejects.toThrow('取消');
    await vi.waitFor(() => expect(pending).toBeDefined());
    let release!: (connection: ManagedConnection) => void;
    mocks.connect.mockImplementationOnce(() => new Promise<ManagedConnection>(resolve => { release = resolve; }));
    const cancelling = engine.handle('query.cancel', { taskId: 'cancel-race' });
    pending!.emit('end');
    await Promise.resolve();
    await expect(engine.handle('query.execute', { sessionId, sql: 'SELECT next', taskId: 'next', maxRows: 1 })).rejects.toThrow('正在执行');
    release(managed()); await cancelling; await failure;
    expect(mocks.execute.mock.calls.some(([, sql]) => String(sql).startsWith('KILL'))).toBe(false);
    scenario = (_sql, query) => rows(query, [['after']]);
    expect((await engine.handle('query.execute', { sessionId, sql: 'SELECT next', taskId: 'after', maxRows: 1 })).results[0].rows[0].c0).toBe('after');
  });

  it('正在执行的查询由独立连接 KILL QUERY 取消', async () => {
    let pending: EventEmitter | undefined;
    scenario = (_sql, query) => { pending = query; };
    const running = engine.handle('query.execute', { sessionId, sql: 'SELECT SLEEP(10)', taskId: 'kill', maxRows: 1 });
    const failure = expect(running).rejects.toThrow('模拟中断');
    await vi.waitFor(() => expect(pending).toBeDefined());
    mocks.execute.mockImplementation(async (_managed, sql) => { if (String(sql).startsWith('KILL QUERY')) pending!.emit('error', new Error('模拟中断')); return { rows: { affectedRows: 0 }, fields: [] }; });
    await engine.handle('query.cancel', { taskId: 'kill' }); await failure;
    expect(mocks.execute.mock.calls.some(([, sql]) => sql === 'KILL QUERY 42')).toBe(true);
    expect(events.at(-1)?.status).toBe('cancelled');
  });

  it('EXPLAIN 只允许一条语句，数据库不会收到危险的后续 SQL', async () => {
    const actual: string[] = [];
    scenario = (sql, query) => { actual.push(sql); rows(query, [['plan']]); };
    await expect(engine.handle('query.explain', { sessionId, sql: 'SELECT 1; DELETE FROM t;', taskId: 'explain-many', maxRows: 10 })).rejects.toThrow('一条 SQL');
    await expect(engine.handle('query.explain', { sessionId, sql: '/* 注释 */ EXPLAIN ANALYZE SELECT 1', taskId: 'explain-analyze', maxRows: 10 })).rejects.toThrow('实际执行');
    await expect(engine.handle('query.explain', { sessionId, sql: '/*!80000 ANALYZE */ SELECT 1', taskId: 'explain-comment', maxRows: 10 })).rejects.toThrow('可执行版本注释');
    await engine.handle('query.explain', { sessionId, sql: 'SELECT 1;', taskId: 'explain-one', maxRows: 10 });
    expect(actual).toEqual(['EXPLAIN SELECT 1']);
  });

  it('使用服务器状态更新显式事务标志，而不是猜测 SQL 文本', async () => {
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    scenario = (_sql, query) => { active.serverStatus = 3; rows(query, []); };
    expect((await engine.handle('query.execute', { sessionId, sql: 'START TRANSACTION', taskId: 'tx-state', maxRows: 1 })).transactionOpen).toBe(true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('缺少结束协议状态不把已完成写入报成可重试错误，并禁止复用断开的会话', async () => {
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    scenario = (_sql, query) => { active.serverStatus = undefined; rows(query, [['ok']]); };
    const result = await engine.handle('query.execute', { sessionId, sql: 'UPDATE t SET n=1', taskId: 'status-failed', maxRows: 1 });
    expect(result.transactionOpen).toBeUndefined(); expect(result.results).toHaveLength(1);
    await expect(engine.handle('query.execute', { sessionId, sql: 'SELECT 1', taskId: 'after-broken', maxRows: 1 })).rejects.toThrow('断开');
  });
});

describe('修改事务控制', () => {
  it('第二条操作并发冲突时回滚第一条操作，不提交部分修改', async () => {
    let updates = 0;
    mocks.execute.mockImplementation(async (_managed, sql) => ({ rows: { affectedRows: String(sql).startsWith('UPDATE') ? (++updates === 1 ? 1 : 0) : 0 }, fields: [] }));
    await expect(engine.handle('table.apply', { connectionId: profile.id, database: 'db', table: 'table', taskId: 'conflict', changes: [
      { kind: 'update', before: { id: 1, value: 'old' }, values: { value: 'new' } },
      { kind: 'update', before: { id: 2, value: 'old' }, values: { value: 'new' } },
    ] })).rejects.toThrow('整批修改已回滚');
    const commands = mocks.execute.mock.calls.map(([, sql]) => sql);
    expect(commands.at(-1)).toBe('ROLLBACK'); expect(commands).not.toContain('COMMIT');
  });
});

describe('连接配置重设保护', () => {
  it('存在空闲会话时也拒绝切换目标，并保留当前会话供用户提交或回滚', async () => {
    const active = await mocks.connect.mock.results.at(-1)!.value as ManagedConnection;
    await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'new.invalid' }, transportChanged: true })).rejects.toThrow('打开的会话');
    expect(active.close).not.toHaveBeenCalled();
    expect((await engine.handle('query.execute', { sessionId, sql: 'SELECT still_alive', taskId: 'unchanged-session', maxRows: 1 })).results[0].rows).toHaveLength(1);
  });
  it('无会话时清掉旧配置，明确要求下一次open提供新目标', async () => {
    await engine.handle('sessions.close', { sessionId });
    const next = { ...profile, host: 'new.invalid', password: '新密码' };
    await engine.handle('__connections.prepareSave', { id: profile.id, profile: next, transportChanged: true });
    await expect(engine.handle('sessions.open', { connectionId: profile.id })).rejects.toThrow('先打开');
    await engine.handle('connections.open', { id: profile.id, profile: next });
    await engine.handle('sessions.open', { connectionId: profile.id });
    expect(mocks.connect).toHaveBeenLastCalledWith(next, undefined);
  });
  it.each(['connections.open', 'sessions.open'] as const)('建连尚未完成时拒绝保存，覆盖%s尚未登记会话的窗口', async command => {
    await engine.handle('sessions.close', { sessionId });
    let finish!: (value: ManagedConnection) => void;
    mocks.connect.mockImplementationOnce(() => new Promise<ManagedConnection>(resolve => { finish = resolve; }));
    const opening = engine.handle(command, command === 'connections.open' ? { id: profile.id, profile } : { connectionId: profile.id });
    await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'new.invalid' }, transportChanged: true })).rejects.toThrow('正在执行的操作');
    finish(managed()); await opening;
  });
  it('独立结构任务运行时拒绝保存，不取消任务也不切换其凭据', async () => {
    await engine.handle('sessions.close', { sessionId });
    let pending: EventEmitter | undefined;
    scenario = (_sql, query) => { pending = query; };
    const task = engine.handle('schema.apply', { connectionId: profile.id, database: '', sql: 'CREATE DATABASE example', taskId: 'independent-task' });
    await vi.waitFor(() => expect(pending).toBeDefined());
    await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, user: 'new' }, transportChanged: true })).rejects.toThrow('正在执行的操作');
    expect(mocks.execute.mock.calls.some(([, sql]) => String(sql).startsWith('KILL'))).toBe(false);
    rows(pending!, [['done']]); await task;
    expect(events.at(-1)?.status).toBe('completed');
  });
  it('建连失败后计数释放，不会永久阻止后续配置修正', async () => {
    await engine.handle('sessions.close', { sessionId });
    mocks.connect.mockRejectedValueOnce(new Error('模拟无法连接'));
    await expect(engine.handle('sessions.open', { connectionId: profile.id })).rejects.toThrow('无法连接');
    await expect(engine.handle('__connections.prepareSave', { id: profile.id, profile: { ...profile, host: 'fixed.invalid' }, transportChanged: true })).resolves.toBeUndefined();
  });
});
