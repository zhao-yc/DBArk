import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, RowChange, TaskEvent } from '../../src/shared/contracts';
import type { ManagedConnection } from '../../src/engine/connection';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn(), tableInfo: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: mocks.connect, execute: mocks.execute }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: mocks.tableInfo }));
import { Engine } from '../../src/engine';

const profile: ConnectionProfile = { id: 'receipt-test', name: '合成测试', host: 'test.invalid', port: 1, user: 'test', dialect: 'mysql', group: '', color: '' };
const operationId = '9b114a51-7550-44a5-ae0c-cbd48a938b26';
const changes: RowChange[] = [{ kind: 'update', before: { id: 1, value: '原值' }, values: { value: '新值' } }];
let engine: Engine, events: TaskEvent[], commands: string[], active: ManagedConnection;
/** 仅模拟协议边界，真正调用Engine生产入口；不把ACK替身算为实库提交验收。 */
beforeEach(async () => {
  const connection = Object.assign(new EventEmitter(), { threadId: 42, destroy: vi.fn() });
  active = { profile, connection, status: { version: '合成', dialect: 'mysql' }, broken: false, close: vi.fn(async () => {}) } as unknown as ManagedConnection;
  mocks.connect.mockReset().mockResolvedValue(active); commands = []; events = [];
  mocks.execute.mockReset().mockImplementation(async (_m, sql) => { commands.push(sql); return { rows: { affectedRows: 1, serverStatus: sql === 'COMMIT' || sql === 'ROLLBACK' ? 2 : 3 }, fields: [] }; });
  mocks.tableInfo.mockReset().mockResolvedValue({ database: 'db', name: 'subject', engine: 'InnoDB', editableKey: ['id'], primaryKey: ['id'], indexes: [], foreignKeys: [], ddl: '', columns: [{ name: 'id', type: 'int', nullable: false }, { name: 'value', type: 'varchar(20)', nullable: false }] });
  engine = new Engine(e => events.push(e)); await engine.handle('connections.open', { id: profile.id, profile });
});
function apply() { return engine.handle('table.apply', { connectionId: profile.id, database: 'db', table: 'subject', taskId: 'apply', changes, tableApplyBinding: { operationId } }); }
function receipt() { return (events.filter(e => (e as any).tableApply?.phase === 'terminal').at(-1) as any)?.tableApply; }

describe('表格提交的真实回调顺序与受限回执', () => {
  it('实际COMMIT回应产生可信提交证据，计数不是只显示在RPC结果', async () => {
    expect(await apply()).toEqual({ affectedRows: 1 });
    expect(receipt()?.evidence).toMatchObject({ commitAcknowledged: true, dmlAcknowledged: 1, serverReportedRows: 1, transactionKnown: true, transactionOpen: false });
    expect(commands.filter(s => s === 'COMMIT')).toHaveLength(1);
  });
  it('COMMIT已进入发送边界时取消不建控制连接、不发KILL，ACK后不降为cancelled', async () => {
    const original = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (m, sql, ...args) => { if (sql === 'COMMIT') await engine.handle('query.cancel', { taskId: 'apply' }); return original(m, sql, ...args); });
    expect(await apply()).toEqual({ affectedRows: 1 });
    expect(events.at(-1)?.status).toBe('completed'); expect(receipt()?.evidence.commitAcknowledged).toBe(true);
    expect(commands.some(s => s.startsWith('KILL'))).toBe(false); expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
  it('冲突且ROLLBACK失败不能声称整批已经回滚', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => { commands.push(sql); if (sql === 'ROLLBACK') throw Error('合成敏感回滚错误'); return { rows: { affectedRows: sql.startsWith('UPDATE') ? 0 : 1, serverStatus: sql === 'ROLLBACK' ? 2 : 3 }, fields: [] }; });
    await expect(apply()).rejects.toThrow('未确认目标事务回滚');
    expect(receipt()?.evidence).toMatchObject({ rollbackAcknowledged: false, commitAcknowledged: false, dmlMayHaveBeenSent: true });
    expect(receipt()?.reason).toBe('rollback-unconfirmed'); expect(commands).not.toContain('COMMIT');
  });
  it('COMMIT回应丢失标未知，既不重放COMMIT也不以随后ROLLBACK反证未提交', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => { commands.push(sql); if (sql === 'COMMIT') { active.broken = true; throw Error('合成连接中断'); } return { rows: { affectedRows: 1, serverStatus: 3 }, fields: [] }; });
    await expect(apply()).rejects.toThrow('提交结果未知');
    expect(receipt()?.evidence).toMatchObject({ commitMayHaveBeenSent: true, commitAcknowledged: false });
    expect(commands.filter(s => s === 'COMMIT')).toHaveLength(1); expect(commands).not.toContain('ROLLBACK');
  });
  it('ROLLBACK成功回应只确认目标InnoDB事务，不扩展触发器保证', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => ({ rows: { affectedRows: sql.startsWith('UPDATE') ? 0 : 1, serverStatus: sql === 'ROLLBACK' ? 2 : 3 }, fields: [] }));
    await expect(apply()).rejects.toThrow('不包含触发器或外部副作用'); expect(receipt()?.evidence.rollbackAcknowledged).toBe(true);
  });
  it('非事务表在DML前拒绝，元数据未知也不伪造成功', async () => {
    mocks.tableInfo.mockResolvedValueOnce({ engine: 'MyISAM' }); await expect(apply()).rejects.toThrow('InnoDB');
    expect(commands.some(s => /^(INSERT|UPDATE|DELETE|COMMIT)/.test(s))).toBe(false); expect(receipt()?.evidence.dmlMayHaveBeenSent).toBe(false);
  });
  it('COMMIT回应缺少当次事务状态时不能用旧缓存填成确认成功', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => ({ rows: { affectedRows: 1, ...(sql === 'COMMIT' ? {} : { serverStatus: 3 }) }, fields: [] }));
    await expect(apply()).rejects.toThrow('提交结果未知'); expect(receipt()?.evidence.commitAcknowledged).toBe(false);
  });
  it('ACK后取消收尾Promise拒绝也不能撤销提交或伪造回滚', async () => {
    const original = mocks.execute.getMockImplementation()!;
    mocks.execute.mockImplementation(async (m, sql, ...args) => {
      if (sql === 'COMMIT') {
        const task = (engine as any).tasks.get('apply'); task.cancelled = true;
        task.cancelPending = Promise.reject(Error('合成取消收尾错误')); task.cancelPending.catch(() => {});
      }
      return original(m, sql, ...args);
    });
    expect(await apply()).toEqual({ affectedRows: 1 }); expect(events.at(-1)?.status).toBe('completed');
    expect(receipt()?.evidence.commitAcknowledged).toBe(true); expect(receipt()?.reason).toBe('cleanup-failed'); expect(commands).not.toContain('ROLLBACK');
  });
  it('连接最终关闭失败保留已发出的提交证据，不把清理当作数据库回滚', async () => {
    active.close = vi.fn(async () => { throw Error('合成关闭错误'); });
    await expect(apply()).rejects.toThrow('合成关闭错误'); expect(receipt()?.evidence.commitAcknowledged).toBe(true); expect(events.at(-1)?.status).toBe('completed');
  });
  it('重新生成的计划与可信预览不一致时零DML，不能只关联一个展示ID', async () => {
    await expect(engine.handle('table.apply', { connectionId: profile.id, database: 'db', table: 'subject', taskId: 'apply', changes, tableApplyBinding: { operationId, plan: [] } })).rejects.toThrow('计划自预览后已变化');
    expect(commands.some(s => /^(INSERT|UPDATE|DELETE|COMMIT)/.test(s))).toBe(false); expect(receipt()?.evidence.dmlMayHaveBeenSent).toBe(false);
  });
  it('START回应未确认进入事务时零DML，不根据命令名称猜测事务已开始', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => { commands.push(sql); return { rows: { affectedRows: 1, serverStatus: 2 }, fields: [] }; });
    await expect(apply()).rejects.toThrow('未确认事务已开始'); expect(commands.some(s => /^(INSERT|UPDATE|DELETE|COMMIT)/.test(s))).toBe(false);
  });
  it('事务内MDL后复核发现非事务引擎，仍在任何DML之前拒绝', async () => {
    const info = await mocks.tableInfo(); mocks.tableInfo.mockResolvedValueOnce(info).mockResolvedValueOnce({ ...info, engine: 'MyISAM' });
    await expect(apply()).rejects.toThrow('InnoDB'); expect(commands.some(s => s.startsWith('SELECT 1 FROM'))).toBe(true); expect(commands.some(s => /^(INSERT|UPDATE|DELETE|COMMIT)/.test(s))).toBe(false);
  });
  it('DML回应丢失事务保护时，即使ROLLBACK回应成功也不能宣称目标修改已回滚', async () => {
    mocks.execute.mockImplementation(async (_m, sql) => { commands.push(sql); return { rows: { affectedRows: 1, serverStatus: sql === 'START TRANSACTION' ? 3 : 2 }, fields: [] }; });
    await expect(apply()).rejects.toThrow('连续事务保护未知'); expect(receipt()?.evidence).toMatchObject({ transactionProtected: false, rollbackAcknowledged: true, commitAcknowledged: false }); expect(commands).not.toContain('COMMIT');
  });
});
