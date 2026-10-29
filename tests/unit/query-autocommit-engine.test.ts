import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { applyQueryAutocommit } from '../../src/engine/queryAutocommit';
import type { QueryTransactionSettingsContext } from '../../src/engine/queryTransactionSettings';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';
import type { TaskEvent } from '../../src/shared/contracts';

const driver = vi.hoisted(() => ({ execute: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/engine/connection', async original => ({ ...await original<typeof import('../../src/engine/connection')>(), execute: driver.execute, connect: driver.connect }));
const base: QueryTransactionSettingsSnapshot = { dialect: 'mysql', serverVersion: '8.4.11', serverConnectionId: '777', database: '原库', isolation: 'REPEATABLE READ', readOnly: false, transactionOpen: false, autocommit: true };
const names = ['__dbark_tx_isolation', '__dbark_tx_read_only', '__dbark_tx_connection', '__dbark_tx_database'];

/** 保留原始字段和协议位，网络mock不代替任何实库或隐式提交验收。 */
function reply(value: QueryTransactionSettingsSnapshot) {
  return { rows: [{ [names[0]]: value.isolation.replaceAll(' ', '-'), [names[1]]: value.readOnly ? 'ON' : 'OFF', [names[2]]: value.serverConnectionId, [names[3]]: value.database }], fields: names.map(name => ({ name })) };
}
function fixture(value = base) {
  const protocol = { known: true, broken: false, serverStatus: (value.autocommit ? 2 : 0) | (value.transactionOpen ? 1 : 0) };
  const query = vi.fn<QueryTransactionSettingsContext['query']>(async (sql, send, acknowledge) => {
    if (!sql.startsWith('SET ')) return reply(value);
    send?.(); const enabled = sql === 'SET SESSION autocommit = 1';
    protocol.serverStatus = (enabled ? 2 : 0) | (!enabled && value.transactionOpen ? 1 : 0);
    const result = { rows: { affectedRows: 0, warningStatus: 0, serverStatus: protocol.serverStatus }, fields: undefined as any };
    acknowledge?.(result); return result;
  });
  const check = vi.fn(), onSetSent = vi.fn();
  const context: QueryTransactionSettingsContext = { query, status: { dialect: value.dialect, version: value.serverVersion }, physicalId: () => 777, protocolState: () => protocol, check, onSetSent };
  const input = { sessionId: 'session', taskId: 'task', expected: value, autocommit: !value.autocommit, allowImplicitCommit: true };
  return { context, query, check, onSetSent, protocol, input };
}
beforeEach(() => { driver.execute.mockReset(); driver.connect.mockReset(); });

describe('原会话自动提交固定SET与新鲜ACK', () => {
  it.each([[true, false], [true, true], [false, false], [false, true]])('原auto=%s/事务=%s固定切换一次并按ACK记录实际事务', async (autocommit, transactionOpen) => {
    const expected = { ...base, autocommit, transactionOpen }, f = fixture(expected), confirmed = vi.fn();
    const result = await applyQueryAutocommit(f.input, f.context, confirmed);
    expect(f.query).toHaveBeenCalledTimes(2); expect(f.query.mock.calls[1][0]).toBe(`SET SESSION autocommit = ${autocommit ? 0 : 1}`);
    expect(result).toMatchObject({ confirmed: true, changed: true, implicitCommitAcknowledged: !autocommit && transactionOpen, snapshot: { ...expected, autocommit: !autocommit, transactionOpen: autocommit && transactionOpen } });
    expect(confirmed).toHaveBeenCalledExactlyOnceWith(result); expect(f.onSetSent).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('同值auto=%s在活动事务中只读诊断，不发送隐式提交命令', async autocommit => {
    const f = fixture({ ...base, transactionOpen: true, autocommit });
    const result = await applyQueryAutocommit({ ...f.input, autocommit, allowImplicitCommit: false }, f.context);
    expect(result).toMatchObject({ changed: false, implicitCommitAcknowledged: false, snapshot: { transactionOpen: true, autocommit } });
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it('未明确允许隐式提交时零查询，不能靠新鲜诊断绕过确认', async () => {
    const f = fixture({ ...base, transactionOpen: true, autocommit: false });
    await expect(applyQueryAutocommit({ ...f.input, allowImplicitCommit: false }, f.context)).rejects.toThrow('必须明确确认');
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['dialect', 'serverVersion', 'serverConnectionId', 'database', 'isolation', 'readOnly', 'transactionOpen', 'autocommit'] as const)('原快照%s变化拒绝SET', async field => {
    const f = fixture();
    const changed = { dialect: 'mariadb', serverVersion: '8.4.10', serverConnectionId: '42', database: null, isolation: 'READ COMMITTED', readOnly: true, transactionOpen: true, autocommit: false };
    // 方言变更使用受支持的对应版本，确保走到新鲜快照CAS而非被版本校验提前拒绝。
    const expected = { ...base, [field]: changed[field], ...(field === 'dialect' ? { serverVersion: '11.4.13-MariaDB' } : {}) };
    await expect(applyQueryAutocommit({ ...f.input, expected } as any, f.context)).rejects.toThrow('快照已变化');
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it('方言与版本不兼容的快照在输入边界拒绝，零诊断和零SET', async () => {
    const f = fixture();
    await expect(applyQueryAutocommit({ ...f.input, expected: { ...base, dialect: 'mariadb' } }, f.context)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled(); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it.each(['warning', 'affected', 'missing-status', 'wrong-state', 'array', 'fields', 'physical'] as const)('SET后%s不完整回执只报告未知且不重放', async kind => {
    const f = fixture();
    f.query.mockImplementation(async (sql, send, acknowledge) => {
      if (!sql.startsWith('SET ')) return reply(base);
      send?.(); const rows: any = { affectedRows: 0, warningStatus: 0, serverStatus: 0 };
      if (kind === 'warning') rows.warningStatus = 1;
      if (kind === 'affected') rows.affectedRows = 1;
      if (kind === 'missing-status') delete rows.serverStatus;
      if (kind === 'wrong-state') rows.serverStatus = 2;
      if (kind === 'physical') f.context.physicalId = () => 778;
      const result = { rows: kind === 'array' ? [rows] : rows, fields: kind === 'fields' ? [{ name: '额外' }] : [] };
      acknowledge?.(result); return result;
    });
    await expect(applyQueryAutocommit(f.input, f.context)).rejects.toThrow('结果未知'); expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('原确认包先于取消收尾失败，保留活动事务已经提交的事实', async () => {
    const f = fixture({ ...base, transactionOpen: true, autocommit: false }), original = f.query.getMockImplementation()!, confirmed = vi.fn();
    f.query.mockImplementation(async (...args) => { const result = await original(...args); if (args[0].startsWith('SET ')) throw Error('取消控制连接收尾失败'); return result; });
    const result = await applyQueryAutocommit(f.input, f.context, confirmed);
    expect(result).toMatchObject({ confirmed: true, implicitCommitAcknowledged: true, snapshot: { autocommit: true, transactionOpen: false } });
    expect(result.cleanupWarning).toContain('收尾失败'); expect(confirmed).toHaveBeenCalledTimes(1); expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('SET发出后丢失ACK不重试，不假定没有提交', async () => {
    const f = fixture({ ...base, transactionOpen: true, autocommit: false });
    f.query.mockImplementation(async (sql, send) => { if (sql.startsWith('SET ')) { send?.(); throw Error('原连接断线'); } return reply(f.input.expected); });
    await expect(applyQueryAutocommit(f.input, f.context)).rejects.toThrow('原事务提交结果未知'); expect(f.query).toHaveBeenCalledTimes(2);
  });
  it('SET投递前取消零SET，未知版本零诊断，不切换新连接', async () => {
    const f = fixture(); f.check.mockImplementation(() => { throw Error('投递前取消'); });
    await expect(applyQueryAutocommit(f.input, f.context)).rejects.toThrow('投递前取消'); expect(f.query).not.toHaveBeenCalled();
    const unsupported = fixture(); unsupported.context.status.version = '8.1.0';
    await expect(applyQueryAutocommit(unsupported.input, unsupported.context)).rejects.toThrow(); expect(unsupported.query).not.toHaveBeenCalled(); expect(driver.connect).not.toHaveBeenCalled();
  });
});

/** 真实Engine互斥和任务生命周期；驱动响应只用于单元边界验证。 */
function engineFixture(emitFailure = false) {
  const expected = { ...base, transactionOpen: true, autocommit: false }, events: TaskEvent[] = [];
  const engine = new Engine(event => { events.push(event); if (emitFailure && event.status === 'completed') throw Error('晚通知故障'); });
  const managed = { connection: { threadId: 777, destroy: vi.fn() }, status: { dialect: 'mysql', version: base.serverVersion }, broken: false, serverStatus: 1 as number | undefined, transactionStateKnown: true };
  const session = { id: 'session', connectionId: 'c', managed, busy: false }; (engine as any).sessions.set('session', session);
  driver.execute.mockImplementation(async (_managed, sql: string) => {
    expect(_managed).toBe(managed);
    if (sql.startsWith('SELECT ')) { managed.serverStatus = 1; managed.transactionStateKnown = true; return reply(expected); }
    return { rows: { affectedRows: 0, warningStatus: 0, serverStatus: 2 }, fields: undefined };
  });
  const input = { sessionId: 'session', taskId: 'task', expected, autocommit: true, allowImplicitCommit: true };
  return { engine, managed, session, events, input };
}
describe('自动提交Engine任务及取消边界', () => {
  it('开始事件抛错时仍释放任务与原会话，零SQL', async () => {
    const f = engineFixture(); (f.engine as any).emit = () => { throw Error('开始通知失败'); };
    await expect(f.engine.handle('query.autocommit.apply', f.input)).rejects.toThrow('开始通知失败');
    expect(driver.execute).not.toHaveBeenCalled(); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('确认任务正常释放，最终事件记录真实隐式提交，不产生用户结果或新连接', async () => {
    const f = engineFixture(); const result = await f.engine.handle('query.autocommit.apply', f.input);
    expect(result.implicitCommitAcknowledged).toBe(true); expect(f.events.at(-1)).toMatchObject({ status: 'completed', message: '服务器已确认自动提交开启；原活动事务已确认提交' });
    expect(f.events.some(event => 'result' in event)).toBe(false); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0); expect(driver.connect).not.toHaveBeenCalled();
  });
  it('最终事件抛错不覆盖已经确认的提交；附加异常后仍释放原任务', async () => {
    const f = engineFixture(true); const result = await f.engine.handle('query.autocommit.apply', f.input);
    expect(result.implicitCommitAcknowledged).toBe(true); expect(result.cleanupWarning).toContain('晚通知故障');
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('SET发送后取消不KILL；ACK前等待保持原会话互斥', async () => {
    const f = engineFixture(), original = driver.execute.getMockImplementation()!; let resume!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), paused = new Promise<void>(resolve => { resume = resolve; });
    driver.execute.mockImplementation(async (...args) => { if (args[1].startsWith('SET ')) { entered(); await paused; } return original(...args); });
    const running = f.engine.handle('query.autocommit.apply', f.input); await started;
    const stop = vi.spyOn(f.engine as any, 'stopTaskCommand');
    await f.engine.handle('query.cancel', { taskId: 'task' }); expect(stop).not.toHaveBeenCalled();
    await expect(f.engine.handle('query.transactionSettings.read', { sessionId: 'session', taskId: 'other' })).rejects.toThrow();
    expect(f.session.busy).toBe(true); resume(); expect((await running).implicitCommitAcknowledged).toBe(true);
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0); expect(driver.execute).toHaveBeenCalledTimes(2);
  });
  it('ACK后取消收尾失败保留已确认提交；未知ACK和收尾双故障仍明确未知', async () => {
    for (const acknowledged of [true, false]) {
      const f = engineFixture(), original = driver.execute.getMockImplementation()!;
      driver.execute.mockImplementation(async (...args) => {
        if (!args[1].startsWith('SET ')) return original(...args);
        const task = (f.engine as any).tasks.get('task'); task.cancelPending = Promise.reject(Error('收尾失败')); task.cancelPending.catch(() => undefined);
        if (!acknowledged) throw Error('ACK丢失'); return original(...args);
      });
      if (acknowledged) { const result = await f.engine.handle('query.autocommit.apply', f.input); expect(result.implicitCommitAcknowledged).toBe(true); expect(result.cleanupWarning).toContain('收尾失败'); }
      else await expect(f.engine.handle('query.autocommit.apply', f.input)).rejects.toThrow('原事务提交结果未知');
      expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0); expect(driver.connect).not.toHaveBeenCalled();
    }
  });
});
