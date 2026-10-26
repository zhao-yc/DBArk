import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { applyQueryTransactionSettings, readQueryTransactionSettings, type QueryTransactionSettingsContext } from '../../src/engine/queryTransactionSettings';
import type { QueryTransactionSettingsSnapshot } from '../../src/shared/queryTransactionSettings';
import type { TaskEvent } from '../../src/shared/contracts';

const driver = vi.hoisted(() => ({ execute: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/engine/connection', async importOriginal => ({ ...await importOriginal<typeof import('../../src/engine/connection')>(), execute: driver.execute, connect: driver.connect }));
const names = ['__dbark_tx_isolation', '__dbark_tx_read_only', '__dbark_tx_connection', '__dbark_tx_database'];
const initial: QueryTransactionSettingsSnapshot = { dialect: 'mysql', serverVersion: '8.4.11', serverConnectionId: '777', database: '实际库', isolation: 'REPEATABLE READ', readOnly: false, transactionOpen: false, autocommit: true };
const setSql = 'SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY';

/** 合成原始驱动回包，不经过查询结果序列化，也不将mock视为实库证明。 */
function reply(snapshot = initial) {
  return { rows: [{ [names[0]]: snapshot.isolation.replaceAll(' ', '-'), [names[1]]: snapshot.readOnly ? 'ON' : 'OFF', [names[2]]: snapshot.serverConnectionId, [names[3]]: snapshot.database }], fields: names.map(name => ({ name })) };
}
function fixture() {
  let value = { ...initial };
  const protocol = { known: true, broken: false, serverStatus: 2 };
  const check = vi.fn(), onSetSent = vi.fn();
  const query = vi.fn(async (sql: string, onSend?: () => void): Promise<{ rows: unknown; fields: { name: string }[] }> => {
    if (sql.startsWith('SET ')) {
      onSend?.(); value = { ...value, isolation: 'READ COMMITTED', readOnly: true };
      return { rows: { affectedRows: 0, warningStatus: 0, serverStatus: protocol.serverStatus }, fields: [] };
    }
    return reply(value);
  });
  const context: QueryTransactionSettingsContext = { status: { dialect: initial.dialect, version: initial.serverVersion }, physicalId: () => 777, query, protocolState: () => protocol, check, onSetSent };
  return { context, query, protocol, check, onSetSent };
}

beforeEach(() => { driver.execute.mockReset(); driver.connect.mockReset(); });

describe('本会话事务设置固定诊断与完整确认', () => {
  it.each([
    ['mysql', '5.7.44', 'transaction_isolation', 'transaction_read_only'],
    ['mysql', '8.0.46', 'transaction_isolation', 'transaction_read_only'],
    ['mariadb', '10.11.19-MariaDB-ubu2204', 'tx_isolation', 'tx_read_only'],
    ['mariadb', '11.4.13-MariaDB-ubu2404', 'transaction_isolation', 'transaction_read_only'],
  ] as const)('按真实%s %s生成唯一固定四列诊断', async (dialect, version, isolation, readOnly) => {
    const f = fixture(); f.context.status = { dialect, version };
    expect(await readQueryTransactionSettings(f.context)).toEqual({ ...initial, dialect, serverVersion: version });
    expect(f.query).toHaveBeenCalledExactlyOnceWith(`SELECT @@SESSION.${isolation} AS ${names[0]},@@SESSION.${readOnly} AS ${names[1]},CAST(CONNECTION_ID() AS CHAR) AS ${names[2]},DATABASE() AS ${names[3]}`);
  });
  it('允许活动事务下读取，自动提交和事务开启分别取新鲜协议位', async () => {
    const f = fixture(); f.protocol.serverStatus = 1;
    expect(await readQueryTransactionSettings(f.context)).toMatchObject({ transactionOpen: true, autocommit: false });
    expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'broken', 'missing-status', 'invalid-status'] as const)('协议状态%s不能生成可信快照', async problem => {
    const f = fixture();
    if (problem === 'unknown') f.protocol.known = false;
    if (problem === 'broken') f.protocol.broken = true;
    if (problem === 'missing-status') f.protocol.serverStatus = undefined as any;
    if (problem === 'invalid-status') f.protocol.serverStatus = 65536;
    await expect(readQueryTransactionSettings(f.context)).rejects.toThrow('状态未知');
  });
  it.each(['rows0', 'rows2', 'fields3', 'wrong-name', 'extra-cell', 'missing-cell', 'array-row', 'numeric-id', 'other-id', 'bad-bool', 'bad-isolation', 'bad-db'] as const)('诊断形状或值%s严格拒绝', async problem => {
    const f = fixture(), result: any = reply();
    if (problem === 'rows0') result.rows = [];
    if (problem === 'rows2') result.rows.push({ ...result.rows[0] });
    if (problem === 'fields3') result.fields.pop();
    if (problem === 'wrong-name') result.fields[0].name = '其他';
    if (problem === 'extra-cell') result.rows[0].extra = '忽略不得';
    if (problem === 'missing-cell') delete result.rows[0][names[3]];
    if (problem === 'array-row') result.rows[0] = Object.values(result.rows[0]);
    if (problem === 'numeric-id') result.rows[0][names[2]] = 777;
    if (problem === 'other-id') result.rows[0][names[2]] = '778';
    if (problem === 'bad-bool') result.rows[0][names[1]] = 'false';
    if (problem === 'bad-isolation') result.rows[0][names[0]] = 'READ COMMITTED; COMMIT';
    if (problem === 'bad-db') result.rows[0][names[3]] = '';
    f.query.mockResolvedValue(result);
    await expect(readQueryTransactionSettings(f.context)).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(1);
  });
  it('真实NULL默认库保留，物理线程变化及未知版本不猜测或重连', async () => {
    const nullDb = fixture(); nullDb.query.mockResolvedValue(reply({ ...initial, database: null }));
    expect((await readQueryTransactionSettings(nullDb.context)).database).toBeNull();
    const changed = fixture(); changed.context.physicalId = vi.fn().mockReturnValueOnce(777).mockReturnValue(778);
    await expect(readQueryTransactionSettings(changed.context)).rejects.toThrow('身份已变化');
    const unknown = fixture(); unknown.context.status.version = '未知';
    await expect(readQueryTransactionSettings(unknown.context)).rejects.toThrow('版本'); expect(unknown.query).not.toHaveBeenCalled();
  });
});

describe('事务默认设置的单次SET和不确定执行边界', () => {
  it('一次SET后回读核对，不提交回滚、不改GLOBAL或autocommit', async () => {
    const f = fixture();
    expect(await applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).toEqual({ ...initial, isolation: 'READ COMMITTED', readOnly: true });
    expect(f.query.mock.calls.map(call => call[0])).toEqual([expect.stringMatching(/^SELECT /), setSql, expect.stringMatching(/^SELECT /)]);
    expect(f.onSetSent).toHaveBeenCalledTimes(1);
    expect(f.query.mock.calls.every(([sql]) => !/\b(?:GLOBAL|COMMIT|ROLLBACK|AUTOCOMMIT)\b/u.test(sql))).toBe(true);
  });
  it('相同默认值只刷新，不发送SET', async () => {
    const f = fixture(); expect(await applyQueryTransactionSettings(initial, initial.isolation, initial.readOnly, f.context)).toEqual(initial);
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it('活动事务拒绝SET，不能自动帮用户提交或回滚', async () => {
    const f = fixture(); f.protocol.serverStatus = 3;
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).rejects.toThrow('活动事务');
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it.each([
    { database: null }, { serverConnectionId: '778' }, { serverVersion: '8.4.10' }, { dialect: 'mariadb' as const, serverVersion: '11.4.13' },
    { isolation: 'READ COMMITTED' as const }, { readOnly: true }, { transactionOpen: true }, { autocommit: false },
  ])('完整确认快照过期%j时拒绝SET', async patch => {
    const f = fixture(); await expect(applyQueryTransactionSettings({ ...initial, ...patch }, 'READ COMMITTED', true, f.context)).rejects.toThrow('已变化');
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
  });
  it('无效expected或desired在任何诊断前拒绝', async () => {
    const f = fixture();
    await expect(applyQueryTransactionSettings({ ...initial, extra: true } as any, 'READ COMMITTED', true, f.context)).rejects.toThrow();
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED; COMMIT' as any, true, f.context)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  });
  it('SET前取消保留未发送边界，读失败原样返回且不回退', async () => {
    const f = fixture(), cancelled = Error('取消前诊断');
    f.query.mockImplementationOnce(async () => { f.check.mockImplementation(() => { throw cancelled; }); return reply(); });
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).rejects.toBe(cancelled);
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.onSetSent).not.toHaveBeenCalled();
    const disconnected = fixture(), error = Error('诊断连接断开'); disconnected.query.mockRejectedValue(error);
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, disconnected.context)).rejects.toBe(error);
    expect(disconnected.query).toHaveBeenCalledTimes(1);
  });
  it.each(['warning', 'missing-warning', 'array-header', 'affected', 'missing-status', 'status-mismatch'] as const)('SET确认包%s不完整时报告可能已改，不回读掩盖问题', async shape => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, sent) => {
      const result = await original(sql, sent);
      if (!sql.startsWith('SET ')) return result;
      const rows: any = { affectedRows: 0, warningStatus: 0, serverStatus: 2 };
      if (shape === 'warning') rows.warningStatus = 1;
      if (shape === 'missing-warning') delete rows.warningStatus;
      if (shape === 'affected') rows.affectedRows = 1;
      if (shape === 'missing-status') delete rows.serverStatus;
      if (shape === 'status-mismatch') rows.serverStatus = 0;
      return { rows: shape === 'array-header' ? [rows] : rows, fields: [] };
    });
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).rejects.toThrow('设置可能已改变');
    expect(f.query).toHaveBeenCalledTimes(2); expect(f.onSetSent).toHaveBeenCalledTimes(1);
  });
  it('SET后取消不重发，不把可能修改描述成未改', async () => {
    const f = fixture(), original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, sent) => { const result = await original(sql, sent); if (sql.startsWith('SET ')) f.check.mockImplementation(() => { throw Error('服务器确认后取消'); }); return result; });
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).rejects.toThrow('设置可能已改变，请重新读取核对；不会自动重试；服务器确认后取消');
    expect(f.query).toHaveBeenCalledTimes(2);
  });
  it.each(['wrong-values', 'read-error', 'new-database', 'new-autocommit'] as const)('SET后%s保留原诊断且不重试', async kind => {
    const f = fixture(), original = f.query.getMockImplementation()!; let reads = 0;
    f.query.mockImplementation(async (sql, sent) => {
      if (sql.startsWith('SELECT ') && ++reads === 2) {
        if (kind === 'read-error') throw Error('原读回网络错误');
        if (kind === 'new-autocommit') f.protocol.serverStatus = 0;
        return reply({ ...initial, ...(kind === 'wrong-values' ? {} : { isolation: 'READ COMMITTED', readOnly: true }), ...(kind === 'new-database' ? { database: null } : {}) });
      }
      return original(sql, sent);
    });
    await expect(applyQueryTransactionSettings(initial, 'READ COMMITTED', true, f.context)).rejects.toThrow('设置可能已改变');
    expect(f.query).toHaveBeenCalledTimes(3); expect(f.query.mock.calls.filter(([sql]) => sql.startsWith('SET '))).toHaveLength(1);
  });
});

/** 运行真实withSession/runTask，只有网络端口为mock；检查IPC生命周期和诊断不进入结果流。 */
function engineFixture() {
  const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
  const managed = { connection: { threadId: 777, destroy: vi.fn() }, status: { dialect: 'mysql', version: '8.4.11' }, broken: false, serverStatus: 2 as number | undefined, transactionStateKnown: false, completionDatabase: { known: true, database: '实际库' } };
  const session = { id: 'session', connectionId: 'connection', managed, busy: false };
  (engine as any).sessions.set(session.id, session);
  let current = { ...initial }, reads = 0;
  driver.execute.mockImplementation(async (target, sql: string) => {
    expect(target).toBe(managed); expect(managed.transactionStateKnown).toBe(false); expect(managed.serverStatus).toBeUndefined();
    managed.transactionStateKnown = true; managed.serverStatus = 2;
    if (sql.startsWith('SET ')) { current = { ...current, isolation: 'READ COMMITTED', readOnly: true }; return { rows: { affectedRows: 0, warningStatus: 0, serverStatus: 2 }, fields: [] }; }
    reads++; return reply(current);
  });
  return { engine, managed, events, session, reads: () => reads };
}
const readInput = { sessionId: 'session', taskId: 'task' };
const applyInput = { ...readInput, expected: initial, isolation: 'READ COMMITTED' as const, readOnly: true };

describe('事务设置Engine原会话接线与任务尾部', () => {
  it('未知缓存允许固定诊断刷新，但禁止借旧状态构造快照', async () => {
    const f = engineFixture();
    expect(await f.engine.handle('query.transactionSettings.read', readInput)).toEqual(initial);
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.managed.connection.destroy).not.toHaveBeenCalled();
    expect(f.events.every(event => event.batch === undefined && event.columns === undefined && event.executionSql === undefined)).toBe(true);
    driver.execute.mockImplementationOnce(async () => reply());
    await expect(f.engine.handle('query.transactionSettings.read', readInput)).rejects.toThrow('状态未知');
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('沿用原会话互斥，繁忙时不发诊断', async () => {
    const f = engineFixture(); f.session.busy = true;
    await expect(f.engine.handle('query.transactionSettings.read', readInput)).rejects.toThrow('正在执行'); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('真实分支只执行两次固定读和一次SET，无用户SQL历史或结果批次', async () => {
    const f = engineFixture(); expect(await f.engine.handle('query.transactionSettings.apply', applyInput)).toMatchObject({ isolation: 'READ COMMITTED', readOnly: true });
    expect(driver.execute.mock.calls.map(call => call[1])).toEqual([expect.stringMatching(/^SELECT /), setSql, expect.stringMatching(/^SELECT /)]);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.events.every(event => event.batch === undefined && event.columns === undefined && event.executionSql === undefined)).toBe(true);
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('runTask末尾取消也同时在IPC和终态事件提示设置可能已改变', async () => {
    const f = engineFixture(), original = (f.engine as any).checkCancelled.bind(f.engine); let finalReadChecks = 0;
    vi.spyOn(f.engine as any, 'checkCancelled').mockImplementation((...args: any[]) => {
      if (f.reads() === 2 && ++finalReadChecks === 2) args[0].cancelled = true;
      original(args[0]);
    });
    await expect(f.engine.handle('query.transactionSettings.apply', applyInput)).rejects.toThrow('设置可能已改变');
    expect(f.events.at(-1)?.message).toContain('设置可能已改变'); expect(f.events.at(-1)?.status).toBe('cancelled');
    expect(driver.execute.mock.calls.filter(call => call[1].startsWith('SET '))).toHaveLength(1);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('SET驱动失败保留具体原因，任务和IPC不自动重试或改旧结果', async () => {
    const f = engineFixture(), original = driver.execute.getMockImplementation()!;
    driver.execute.mockImplementation(async (...args: any[]) => { if (args[1].startsWith('SET ')) throw Error('原服务器权限拒绝'); return original(...args); });
    await expect(f.engine.handle('query.transactionSettings.apply', applyInput)).rejects.toThrow('设置可能已改变，请重新读取核对；不会自动重试；原服务器权限拒绝');
    expect(f.events.at(-1)?.message).toContain('原服务器权限拒绝'); expect(driver.execute).toHaveBeenCalledTimes(2);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('SET后取消控制拒绝仍保留完整失败并释放任务、done和会话互斥', async () => {
    const f = engineFixture(), original = driver.execute.getMockImplementation()!, cancelFailure = Error('原取消控制连接关闭失败');
    let originalTask: { done: Promise<void> } | undefined;
    driver.execute.mockImplementation(async (...args: any[]) => {
      if (args[1].startsWith('SET ')) {
        const task = (f.engine as any).tasks.get('task'); originalTask = task;
        // execute同步入口已经看见提交标记，标记与驱动投递之间没有await。
        expect(task.transactionSettingsChangeSubmitted).toBe(true);
        task.cancelled = true; task.cancelPending = Promise.reject(cancelFailure);
        task.cancelPending.catch(() => undefined);
      }
      return original(...args);
    });
    let failure: any;
    try { await f.engine.handle('query.transactionSettings.apply', applyInput); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect(failure.message).toContain('设置可能已改变');
    expect(failure.cause).toBeInstanceOf(AggregateError); expect(failure.cause.errors).toContain(cancelFailure);
    expect(f.events.at(-1)?.status).toBe('cancelled'); expect(f.events.at(-1)?.message).toBe(failure.message);
    expect(driver.execute).toHaveBeenCalledTimes(2); expect(driver.execute.mock.calls.filter(call => call[1].startsWith('SET '))).toHaveLength(1);
    expect(driver.connect).not.toHaveBeenCalled(); expect((f.engine as any).tasks.size).toBe(0); expect(f.session.busy).toBe(false);
    expect(originalTask).toBeDefined(); await expect(originalTask!.done).resolves.toBeUndefined();
  });
});
