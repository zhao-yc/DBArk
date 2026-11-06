import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { readServerMonitor, serverMonitorSessionsSql } from '../../src/engine/serverMonitor';
import { readPostgresServerMonitor, signalPostgresMonitorTarget } from '../../src/engine/postgres/serverMonitor';
import { ServerMonitorSignals } from '../../src/main/serverMonitorSignals';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import { postgresMonitorStatusNames, serverMonitorSignalSchema, validateServerMonitorInput, type ServerMonitorSignalInput } from '../../src/shared/serverMonitor';
const query = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/structureDefinition', () => ({ structureTaskQuery: query }));
const summary = { version: '8.0', versionComment: '测试', hostname: '主机', port: '3306', currentUser: '只读账号@%', connectionId: '9007199254740993' };
const session = { id: '9007199254740994', user: '用户', host: '主机', databaseName: null, command: 'Query', seconds: '12', state: '', sqlText: '', sqlLength: '0' };
/** 固定回包检查数据边界，不需要本机数据库或真实凭据。 */
function context(checkCancelled = vi.fn()): StructureTaskContext { return { checkCancelled, commandStarted: () => () => {}, report: () => {} } as unknown as StructureTaskContext; }
function replies(rows: Record<string, unknown>[] = [session]) { query.mockResolvedValueOnce({ rows: [summary] }).mockResolvedValueOnce({ rows: [{ Variable_name: 'Questions', Value: '18446744073709551615' }] }).mockResolvedValueOnce({ rows }); }
beforeEach(() => query.mockReset());
describe('服务器监控固定只读查询与快照', () => {
  it('保留大整数、NULL 和空串，范围始终未确认', async () => {
    replies(); const result = await readServerMonitor(context(), { connectionId: '连接', taskId: '任务' });
    expect(result.summary).toEqual({ status: 'available', value: summary });
    expect(result.globalStatus).toEqual({ status: 'available', value: [{ name: 'Questions', value: '18446744073709551615' }] });
    expect(result.sessions.status).toBe('available');
    if (result.sessions.status === 'available') { expect(result.sessions.value.rows[0]).toMatchObject({ id: session.id, database: null, state: '', sql: '', sqlTruncated: false }); expect(result.sessions.value.visibility).toBe('account-visible-unconfirmed'); }
    expect(result.bytes).toBeLessThan(512 * 1024);
    expect(query.mock.calls.every(([, sql]) => /^(SELECT|SHOW GLOBAL STATUS)/.test(sql))).toBe(true);
  });
  it('服务器先截断 INFO，额外一行仅用于确认列表截断', async () => {
    replies([{ ...session, sqlText: '语'.repeat(512), sqlLength: '9007199254740993' }, { ...session, id: '2' }]);
    const result = await readServerMonitor(context(), { connectionId: '连接', taskId: '任务', sessionLimit: 1 });
    expect(query.mock.calls[2][1]).toContain('LEFT(INFO, 512)'); expect(query.mock.calls[2][1]).toContain('CHAR_LENGTH(INFO)'); expect(query.mock.calls[2][1]).toContain('LIMIT 2');
    if (result.sessions.status === 'available') { expect(result.sessions.value.truncated).toBe(true); expect(result.sessions.value.rows).toHaveLength(1); expect(result.sessions.value.rows[0].sqlTruncated).toBe(true); }
  });
  it('状态权限不足逐项降级，仍读取当前账号会话且不尝试高权限来源', async () => {
    query.mockResolvedValueOnce({ rows: [summary] }).mockRejectedValueOnce(Object.assign(new Error('权限不足'), { code: 'ER_SPECIFIC_ACCESS_DENIED_ERROR' })).mockResolvedValueOnce({ rows: [] });
    const result = await readServerMonitor(context(), { connectionId: '连接', taskId: '任务' });
    expect(result.globalStatus).toEqual({ status: 'unavailable', reason: '权限不足' }); expect(result.sessions.status).toBe('available'); expect(query).toHaveBeenCalledTimes(3);
  });
  it('连接错误不会被伪装成权限不可用', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('连接断开'), { code: 'PROTOCOL_CONNECTION_LOST' }));
    await expect(readServerMonitor(context(), { connectionId: '连接', taskId: '任务' })).rejects.toThrow('连接断开'); expect(query).toHaveBeenCalledTimes(1);
  });
  it('取消后不继续发下一项查询', async () => {
    const check = vi.fn(); query.mockImplementationOnce(async () => { check.mockImplementation(() => { throw new Error('已取消'); }); return { rows: [summary] }; });
    await expect(readServerMonitor(context(check), { connectionId: '连接', taskId: '任务' })).rejects.toThrow('已取消'); expect(query).toHaveBeenCalledTimes(1);
  });
  it('拒绝不精确数字计数、未知状态变量和超长字段', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...summary, connectionId: 9007199254740992 }] });
    await expect(readServerMonitor(context(), { connectionId: '连接', taskId: '任务' })).rejects.toThrow('格式或长度');
    query.mockReset(); query.mockResolvedValueOnce({ rows: [summary] }).mockResolvedValueOnce({ rows: [{ Variable_name: '任意变量', Value: '1' }] });
    await expect(readServerMonitor(context(), { connectionId: '连接', taskId: '任务' })).rejects.toThrow('固定范围');
    query.mockReset(); replies([{ ...session, sqlText: 'x'.repeat(513) }]);
    await expect(readServerMonitor(context(), { connectionId: '连接', taskId: '任务' })).rejects.toThrow('格式或长度');
  });
  it('拒绝无限条数和任何自定义 SQL 输入', () => {
    for (const limit of [0, -1, 101, 1.5, NaN]) expect(() => serverMonitorSessionsSql(limit)).toThrow();
    expect(() => validateServerMonitorInput({ connectionId: '连接', taskId: '任务', sql: 'KILL 1' } as never)).toThrow();
  });
  it('服务器字符预算兼容补充平面字符，序列化字节包括自身计数字段', async () => {
    replies([{ ...session, sqlText: '😀'.repeat(512), sqlLength: '513' }]);
    const result = await readServerMonitor(context(), { connectionId: '连接', taskId: '任务' });
    expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(result), 'utf8'));
    if (result.sessions.status === 'available') expect(result.sessions.value.rows[0].sqlTruncated).toBe(true);
  });
  it('字段均在范围内但转义总字节超预算时拒绝跨 IPC 返回', async () => {
    const row = { ...session, user: '\u0000'.repeat(128), host: '\u0000'.repeat(255), databaseName: '\u0000'.repeat(128), command: '\u0000'.repeat(64), state: '\u0000'.repeat(255), sqlText: '\u0000'.repeat(512), sqlLength: '512' };
    replies(Array.from({ length: 100 }, (_, index) => ({ ...row, id: String(index) })));
    await expect(readServerMonitor(context(), { connectionId: '连接', taskId: '任务', sessionLimit: 100 })).rejects.toThrow('字节预算');
  });
});

describe('PostgreSQL 监控会话信号', () => {
  const target = { pid: '20', user: 'owner', database: 'ledger', backendStart: '1760000000.123456',
    instance: 'original-instance', query: { start: '1760000010.123456', digest: 'a'.repeat(32) } };

  it('匹配失效时不重试，SQL 的 PID、后端代次及查询指纹走原绑定参数', async () => {
    const read = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const connection = { query: read } as unknown as PostgresConnection;
    const before = vi.fn();
    await expect(signalPostgresMonitorTarget(connection, target, 'cancel-query', before)).resolves.toEqual({ status: 'stale' });
    expect(before).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toContain('pg_cancel_backend(pid)');
    expect(read.mock.calls[1][0]).toContain('EXTRACT(EPOCH FROM query_start) = $6::numeric');
    expect(read.mock.calls[1][1]).toEqual([target.pid, target.user, target.database, target.backendStart, target.instance, target.query.start, target.query.digest]);
  });

  it('收到信号确认后只进行观察，读取失败保留原确认', async () => {
    const read = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ c0: 't' }] })
      .mockRejectedValueOnce(Error('原连接断开'));
    const connection = { query: read } as unknown as PostgresConnection;
    await expect(signalPostgresMonitorTarget(connection, target, 'terminate-session', () => {}))
      .resolves.toEqual({ status: 'accepted', observation: 'unknown' });
    expect(read.mock.calls.filter(([sql]) => sql.includes('pg_terminate_backend'))).toHaveLength(1);
    expect(read.mock.calls[2][0]).toContain('backend_start IS NULL');
  });

  it('观察查询独占回包预算，信号确认消费预算后仍能确认目标消失', async () => {
    const read = vi.fn(async (sql: string, _values: unknown, budget: { rows: number }) => {
      if (sql.startsWith('SET ')) return { rows: [] };
      if (budget.rows-- <= 0) return { rows: [], truncated: true };
      return { rows: [{ c0: sql.includes('pg_terminate_backend') ? 't' : 'f' }] };
    });
    const connection = { query: read } as unknown as PostgresConnection;
    await expect(signalPostgresMonitorTarget(connection, target, 'terminate-session', () => {}))
      .resolves.toEqual({ status: 'accepted', observation: 'ended' });
  });

  it('快照只给原文档和原配置，单次使用，拒绝覆盖后的旧快照与迟到快照', () => {
    let connectionEpoch = {};
    const permits = new ServerMonitorSignals(() => connectionEpoch), document = {}, connectionId = 'postgres', revision = 1;
    const issue = () => permits.begin(document, connectionId, revision);
    const privateSnapshot = { dialect: 'postgresql' as const, startedAt: '', completedAt: '', bytes: 0, signalTargets: [target],
      summary: { status: 'unavailable' as const, reason: '' }, globalStatus: { status: 'unavailable' as const, reason: '' },
      sessions: { status: 'unavailable' as const, reason: '' } };
    const old = issue(), current = issue();
    expect(old(privateSnapshot)).not.toHaveProperty('signal');
    const view = current(privateSnapshot);
    expect(view).not.toHaveProperty('signalTargets');
    expect(view.signal?.targets).toEqual([{ pid: '20', canCancel: true }]);
    expect(view.bytes).toBe(Buffer.byteLength(JSON.stringify(view)));
    const input: ServerMonitorSignalInput = { connectionId, taskId: 'signal', token: view.signal!.token, pid: '20',
      confirmedPid: '20', action: 'cancel-query' };
    expect(serverMonitorSignalSchema.safeParse({ ...input, confirmedPid: '21' }).success).toBe(false);
    expect(serverMonitorSignalSchema.safeParse({ ...input, backendStart: target.backendStart }).success).toBe(false);
    expect(() => permits.claim({}, revision, input)).toThrow('失效');
    expect(() => permits.claim(document, revision + 1, input)).toThrow('失效');
    expect(permits.claim(document, revision, input)).toEqual(target);
    expect(() => permits.claim(document, revision, input)).toThrow('失效');
    const next = issue()(privateSnapshot).signal!;
    connectionEpoch = {};
    expect(() => permits.claim(document, revision, { ...input, token: next.token })).toThrow('失效');
  });
});

describe('PostgreSQL 监控投影', () => {
  const input = { connectionId: 'postgres', taskId: 'snapshot', sessionLimit: 1 };
  const postgresSummary = { c0: '18.6', c1: 'PostgreSQL', c2: '127.0.0.1', c3: '5432', c4: 'readonly', c5: '10', c6: 'ledger' };
  const restricted = { c0: '20', c1: 'other', c2: null, c3: 'ledger', c4: null, c5: null, c6: null, c7: null, c8: null, c9: null };
  it('只读固定目录，保留大整数及受限会话，额外行仅用于确认列表截断', async () => {
    const stats = Object.fromEntries(postgresMonitorStatusNames.map((_, index) => ['c' + index, '9223372036854775807']));
    const read = vi.fn().mockResolvedValueOnce({ rows: [postgresSummary] })
      .mockResolvedValueOnce({ rows: [{ ...stats, ['c' + postgresMonitorStatusNames.length]: null }] })
      .mockResolvedValueOnce({ rows: [restricted, { ...restricted, c0: '21' }] });
    const snapshot = await readPostgresServerMonitor({ query: read } as unknown as PostgresConnection, input, () => {});
    expect(snapshot).toMatchObject({ dialect: 'postgresql', statisticsReset: null,
      summary: { value: { database: 'ledger', connectionId: '10' } },
      globalStatus: { value: expect.arrayContaining([{ name: 'xact_commit', value: '9223372036854775807' }]) },
      sessions: { value: { truncated: true, rows: [{ id: '20', user: 'other', sql: null, sqlLength: null, seconds: null, waitEvent: null }] } } });
    expect(snapshot.bytes).toBe(Buffer.byteLength(JSON.stringify(snapshot)));
    expect(read.mock.calls.every(([sql]) => sql.startsWith('SELECT '))).toBe(true);
    expect(read.mock.calls[2][0]).toContain('LIMIT 2');
  });

  it('权限不足只影响对应段，连接错误仍终止快照', async () => {
    const read = vi.fn().mockResolvedValueOnce({ rows: [postgresSummary] })
      .mockRejectedValueOnce(Object.assign(Error('内部权限报错'), { postgresSqlState: '42501' })).mockResolvedValueOnce({ rows: [] });
    const connection = { query: read } as unknown as PostgresConnection;
    expect(await readPostgresServerMonitor(connection, input, () => {})).toMatchObject({
      globalStatus: { status: 'unavailable', reason: '当前账号没有读取此项的权限' }, sessions: { status: 'available' },
    });
    read.mockRejectedValueOnce(Object.assign(Error('连接中断'), { postgresSqlState: '08006' }));
    await expect(readPostgresServerMonitor(connection, input, () => {})).rejects.toThrow('连接中断');
    expect(read).toHaveBeenCalledTimes(4);
  });
});
