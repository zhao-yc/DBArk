import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { observeSessionError, observeSessionState, type ManagedConnection } from '../../src/engine/connection';
import { SessionObjects } from '../../src/engine/sessionObjects';
import type { SessionStatePacket } from '../../src/engine/completionSession';
import type { QueryDatabaseSwitchInput } from '../../src/shared/queryDatabaseSwitch';
import type { TaskEvent } from '../../src/shared/contracts';

const driver = vi.hoisted(() => ({ execute: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/engine/connection', async importOriginal => ({ ...await importOriginal<typeof import('../../src/engine/connection')>(), execute: driver.execute, connect: driver.connect }));
const require = createRequire(import.meta.url), NativeQuery = require(join(dirname(require.resolve('mysql2')), 'lib/commands/query.js'));
const input: QueryDatabaseSwitchInput = { sessionId: 'session', taskId: 'switch', database: '库B', expectedContext: { state: 'known', database: '库A' } };

/** RAM闸门精确控制原命令与取消连接的终态，不依赖计时或真实数据库。 */
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

/** 只替换网络端口，运行产品的withSession/runTask及真实协议缓存维护。 */
function fixture() {
  const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
  const native = Object.assign(new EventEmitter(), { threadId: 777, destroy: vi.fn() });
  const objects = new SessionObjects(0); objects.confirm('库A', 'marker', [{ name: 'v', dataType: 'bigint', visible: true }]);
  const managed = { connection: native, profile: { database: '配置库' }, status: { dialect: 'mysql', version: '8.4.11' }, serverStatus: 3, transactionStateKnown: true, broken: false, sqlMode: '', noBackslashEscapesKnown: true, completionDatabase: { known: true, database: '库A' }, sessionObjects: objects, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
  const session = { id: input.sessionId, connectionId: 'connection', managed, busy: false };
  (engine as any).sessions.set(session.id, session);
  /** 模拟驱动先发布真实包，再交付原execute回调。 */
  const packet = (sql: string, schema?: string, serverStatus = 3) => {
    const value: SessionStatePacket = { sql, serverStatus: serverStatus | (schema === undefined ? 0 : 16384), warningStatus: 0, ...(schema === undefined ? {} : { stateChanges: { schema } }) };
    observeSessionState(managed, value); native.emit('dbark:session-state', value);
    return { rows: { affectedRows: 0, warningStatus: 0, serverStatus: value.serverStatus }, fields: [] };
  };
  driver.execute.mockImplementation(async (target: ManagedConnection, sql: string) => {
    expect(target).toBe(managed);
    if (sql.startsWith('USE ')) return packet(sql, '库B');
    packet(sql); return { rows: [{ database: '库B' }], fields: [{ name: 'database' }] };
  });
  return { engine, events, native, managed, objects, session, packet, task: () => (engine as any).tasks.get(input.taskId) };
}

beforeEach(() => { driver.execute.mockReset(); driver.connect.mockReset(); });

describe('显式切库沿用原物理会话和协议证据', () => {
  it.each([true, false])('执行真实mysql2 Query.doneInsert/done及产品execute回调形状；schema报告=%s', async schemaReport => {
    const f = fixture(), callbacks: unknown[][] = [];
    const actual = await vi.importActual<typeof import('../../src/engine/connection')>('../../src/engine/connection');
    driver.execute.mockImplementation(actual.execute);
    (f.native as any).query = vi.fn((sql: string, callback: (...args: unknown[]) => void) => {
      // 运行已安装驱动的doneInsert→done→nextTick→onResult，不能手写fields=[]模拟OK。
      const command = new NativeQuery({ sql }, (...args: unknown[]) => { callbacks.push(args); Reflect.apply(callback, undefined, args); });
      if (sql.startsWith('USE ')) command.doneInsert(f.packet(sql, schemaReport ? '库B' : undefined).rows);
      else {
        expect(sql).toBe('SELECT DATABASE() AS `database`'); f.packet(sql);
        command._rows.push([{ database: '库B' }]); command._fields.push([{ name: 'database' }]); command.done();
      }
      return command;
    });
    expect(await f.engine.handle('query.databaseSwitch', input)).toMatchObject({ database: '库B', unchanged: false, transactionOpen: true });
    expect(callbacks[0]).toHaveLength(2); expect(callbacks[0][0]).toBeNull(); expect(callbacks[0][2]).toBeUndefined();
    expect(driver.execute.mock.calls.map(call => call[1])).toEqual(schemaReport ? ['USE `库B`'] : ['USE `库B`', 'SELECT DATABASE() AS `database`']);
    if (!schemaReport) { expect(callbacks[1]).toHaveLength(3); expect(callbacks[1][2]).toEqual([{ name: 'database' }]); }
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.native.threadId).toBe(777);
  });
  it('schema报告直接确认，保留事务、配置、模式与A库临时对象且不产生SQL结果', async () => {
    const f = fixture(), objectState = f.objects.snapshot();
    expect(await f.engine.handle('query.databaseSwitch', input)).toMatchObject({ sessionId: 'session', taskId: 'switch', database: '库B', unchanged: false, transactionKnown: true, transactionOpen: true, completion: { database: '库B', databaseKnown: true, busy: false } });
    expect(driver.execute.mock.calls.map(call => call[1])).toEqual(['USE `库B`']);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.managed.profile.database).toBe('配置库'); expect(f.objects.snapshot()).toEqual(objectState); expect(f.managed.sqlMode).toBe('');
    expect(f.events.every(event => event.executionSql === undefined && event.batch === undefined && event.columns === undefined)).toBe(true);
    expect(f.session.busy).toBe(false); expect(f.task()).toBeUndefined(); expect(f.native.listenerCount('dbark:session-state')).toBe(0);
  });
  it('反引号和注入形状只组成一个安全引用的库标识符', async () => {
    const f = fixture(), database = '库`B; SELECT 1 --';
    driver.execute.mockImplementation(async (_target, sql) => f.packet(sql, database));
    expect((await f.engine.handle('query.databaseSwitch', { ...input, database })).database).toBe(database);
    expect(driver.execute.mock.calls.map(call => call[1])).toEqual(['USE `库``B; SELECT 1 --`']);
  });
  it.each([{ state: 'known', database: '别的库' }, { state: 'unknown' }])('期望上下文变化时锁内拒绝且零投递：%j', async expectedContext => {
    const f = fixture(); await expect(f.engine.handle('query.databaseSwitch', { ...input, expectedContext } as QueryDatabaseSwitchInput)).rejects.toThrow('已变化');
    expect(driver.execute).not.toHaveBeenCalled(); expect(f.managed.completionDatabase).toEqual({ known: true, database: '库A' }); expect(f.session.busy).toBe(false);
  });
  it('同库可信缓存零USE，事务未知不伪造false；unknown同名必须实际确认', async () => {
    const f = fixture(); f.managed.transactionStateKnown = false;
    const output = await f.engine.handle('query.databaseSwitch', { ...input, database: '库A' });
    expect(output).toMatchObject({ unchanged: true, transactionKnown: false }); expect(output).not.toHaveProperty('transactionOpen'); expect(driver.execute).not.toHaveBeenCalled();
    f.managed.completionDatabase!.known = false;
    await f.engine.handle('query.databaseSwitch', { ...input, expectedContext: { state: 'unknown' } }); expect(driver.execute).toHaveBeenCalledOnce();
  });
  it('无schema报告仅在明确USE成功后同锁读一次DATABASE，不能恢复sql_mode信任', async () => {
    const f = fixture(); f.managed.sqlMode = undefined; f.managed.noBackslashEscapesKnown = false;
    driver.execute.mockImplementation(async (target, sql) => {
      expect(target).toBe(f.managed); expect(f.session.busy).toBe(true);
      if (sql.startsWith('USE ')) return f.packet(sql);
      f.packet(sql); return { rows: [{ database: '库B' }], fields: [{ name: 'database' }] };
    });
    const output = await f.engine.handle('query.databaseSwitch', input);
    expect(output.database).toBe('库B'); expect(output.completion).not.toHaveProperty('ansiQuotes'); expect(output.completion).not.toHaveProperty('noBackslashEscapes');
    expect(driver.execute.mock.calls.map(call => call[1])).toEqual(['USE `库B`', 'SELECT DATABASE() AS `database`']); expect(f.managed.sqlMode).toBeUndefined();
    await f.engine.handle('query.completionState', { sessionId: 'session' }); expect(driver.execute).toHaveBeenCalledTimes(2);
  });
  it.each(['错误库', ''])('schema报告不匹配或非法时不诊断兜底：%s', async schema => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => f.packet(sql, schema));
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生');
    expect(driver.execute).toHaveBeenCalledOnce(); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it.each([{ fields: null }, { fields: {} }, { fields: [{ name: '异常真实列' }] }])('ACK字段描述%j不能借undefined归一化放行', async ({ fields }) => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => ({ ...f.packet(sql, '库B'), fields }));
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(driver.execute).toHaveBeenCalledOnce(); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it('真实行结果缺失fields不能借非结果ACK豁免恢复库信任', async () => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => {
      if (sql.startsWith('USE ')) return { rows: f.packet(sql).rows, fields: undefined };
      f.packet(sql); return { rows: [{ database: '库B' }], fields: undefined };
    });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('列描述缺失或无效'); expect(driver.execute).toHaveBeenCalledTimes(2); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it('USE确认不能掩盖原事务或自动提交状态变化', async () => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => f.packet(sql, '库B', 2));
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('事务或自动提交状态'); expect(driver.execute).toHaveBeenCalledOnce(); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it.each(['ERR', '未知ACK', '断线'])('USE%s不发诊断、不重放且隐藏旧库', async kind => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => {
      expect(f.task().databaseSwitchSubmitted).toBe(true);
      if (kind === 'ERR') { observeSessionError(f.managed, sql); throw Error('服务器权限拒绝'); }
      if (kind === '断线') { f.managed.broken = true; throw Error('网络断线'); }
      return { rows: [], fields: [] };
    });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(driver.execute).toHaveBeenCalledOnce(); expect(driver.connect).not.toHaveBeenCalled(); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it.each(['错误库', '多行', '多列', '无新协议', '读失败'])('固定诊断%s不能冒充确认，最多一读一USE', async kind => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => {
      if (sql.startsWith('USE ')) return f.packet(sql);
      if (kind === '读失败') throw Error('固定诊断失败');
      if (kind !== '无新协议') f.packet(sql);
      return { rows: kind === '多行' ? [{ database: '库B' }, { database: '库B' }] : [{ database: kind === '错误库' ? '库A' : '库B', ...(kind === '多列' ? { extra: 1 } : {}) }], fields: [{ name: 'database' }] };
    });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(driver.execute).toHaveBeenCalledTimes(2); expect(f.managed.completionDatabase!.known).toBe(false);
  });
  it.each(['native', 'threadId', 'session'])('ACK后%s变化拒绝诊断或交付，不能换连接确认', async kind => {
    const f = fixture(); driver.execute.mockImplementation(async (_target, sql) => {
      const ack = f.packet(sql, '库B');
      if (kind === 'native') f.managed.connection = Object.assign(new EventEmitter(), { threadId: 777 }) as any;
      if (kind === 'threadId') f.native.threadId = 778;
      if (kind === 'session') (f.engine as any).sessions.get('session').managed = {};
      return ack;
    });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(driver.execute).toHaveBeenCalledOnce(); expect(driver.connect).not.toHaveBeenCalled();
  });
});

describe('切库互斥与取消收尾', () => {
  it('投递前取消不发USE且保留原已知库', async () => {
    const f = fixture(), check = (f.engine as any).checkCancelled.bind(f.engine);
    vi.spyOn(f.engine as any, 'checkCancelled').mockImplementation((...args: any[]) => { args[0].cancelled = true; check(args[0]); });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('任务已取消');
    expect(driver.execute).not.toHaveBeenCalled(); expect(f.managed.completionDatabase).toEqual({ known: true, database: '库A' }); expect(f.session.busy).toBe(false);
  });
  it('USE和诊断之间持续占锁，其他原会话操作全部拒绝；completionState只返回忙', async () => {
    const f = fixture(), gate = deferred<void>(), reached = deferred<void>();
    driver.execute.mockImplementation(async (_target, sql) => {
      if (sql.startsWith('USE ')) return f.packet(sql);
      reached.resolve(); await gate.promise; f.packet(sql); return { rows: [{ database: '库B' }], fields: [{ name: 'database' }] };
    });
    const pending = f.engine.handle('query.databaseSwitch', input); await reached.promise;
    expect(await f.engine.handle('query.completionState', { sessionId: 'session' })).toEqual({ databaseKnown: false, broken: false, busy: true });
    for (const command of ['query.execute', 'query.parameterNames', 'query.transaction', 'query.temporaryRead', 'query.databaseSwitch'] as const) await expect(f.engine.handle(command, { ...input, sql: 'SELECT 1', maxRows: 1, action: 'rollback', database: '库B', table: 'marker' } as any)).rejects.toThrow('正在执行');
    expect(driver.execute).toHaveBeenCalledTimes(2); gate.resolve(); await pending; expect(f.session.busy).toBe(false);
  });
  it('已投递后取消不发诊断，原命令及cancelPending结束前不释放锁', async () => {
    const f = fixture(), command = deferred<void>(), cancellation = deferred<void>(), started = deferred<void>();
    driver.execute.mockImplementation(async (_target, sql) => { started.resolve(); await command.promise; return f.packet(sql); });
    const pending = f.engine.handle('query.databaseSwitch', input), failure = expect(pending).rejects.toThrow('切换可能已发生'); await started.promise;
    const task = f.task(); task.cancelled = true; task.cancelPending = cancellation.promise;
    command.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.session.busy).toBe(true); expect(f.task()).toBe(task);
    cancellation.resolve(); await failure; expect(f.events.at(-1)?.status).toBe('cancelled'); expect(driver.execute).toHaveBeenCalledOnce(); expect(f.managed.completionDatabase!.known).toBe(false); expect(f.session.busy).toBe(false); await task.done;
  });
  it('runTask末尾取消仍保留已确认新库，IPC与终态明确可能切换且不重发', async () => {
    const f = fixture(), check = (f.engine as any).checkCancelled.bind(f.engine);
    vi.spyOn(f.engine as any, 'checkCancelled').mockImplementation((...args: any[]) => { if (args[0].databaseSwitchConfirmed) args[0].cancelled = true; check(args[0]); });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(f.managed.completionDatabase).toEqual({ known: true, database: '库B' }); expect(f.events.at(-1)?.status).toBe('cancelled'); expect(driver.execute).toHaveBeenCalledOnce();
  });
  it('sessions.close等待原USE回调及取消控制关闭完成，再关闭原物理资源', async () => {
    const f = fixture(), command = deferred<void>(), controlClose = deferred<void>(), started = deferred<void>(), killed = deferred<void>();
    const control = { close: vi.fn(async () => { await controlClose.promise; }) } as unknown as ManagedConnection;
    driver.connect.mockResolvedValue(control);
    driver.execute.mockImplementation(async (target, sql) => {
      if (target === control) { expect(sql).toBe('KILL QUERY 777'); killed.resolve(); return { rows: { affectedRows: 0, warningStatus: 0, serverStatus: 2 }, fields: [] }; }
      expect(target).toBe(f.managed); started.resolve(); await command.promise; return f.packet(sql);
    });
    const pending = f.engine.handle('query.databaseSwitch', input), failure = expect(pending).rejects.toThrow('切换可能已发生'); await started.promise;
    const task = f.task(), closing = f.engine.handle('sessions.close', { sessionId: 'session' }); await killed.promise;
    expect(f.managed.close).not.toHaveBeenCalled(); expect(f.session.busy).toBe(true);
    command.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.managed.close).not.toHaveBeenCalled(); expect(f.task()).toBe(task);
    controlClose.resolve(); await failure; await closing; await task.done;
    expect(f.managed.close).toHaveBeenCalledOnce(); expect(control.close).toHaveBeenCalledOnce(); expect((f.engine as any).sessions.has('session')).toBe(false);
    expect(driver.execute.mock.calls.filter(call => call[0] === f.managed)).toHaveLength(1); expect(driver.connect).toHaveBeenCalledOnce();
  });
  it('取消控制收尾失败仍合并原错误，释放任务done并保留failed事实', async () => {
    const f = fixture(), cancelError = Error('取消控制关闭失败'); let task: any;
    driver.execute.mockImplementation(async () => { task = f.task(); task.cancelled = true; task.cancelPending = Promise.reject(cancelError); task.cancelPending.catch(() => undefined); throw Error('原USE失败'); });
    await expect(f.engine.handle('query.databaseSwitch', input)).rejects.toThrow('切换可能已发生'); expect(f.session.busy).toBe(false); expect(f.task()).toBeUndefined(); await task.done; expect(f.events.at(-1)?.status).toBe('cancelled'); expect(driver.execute).toHaveBeenCalledOnce();
  });
});
