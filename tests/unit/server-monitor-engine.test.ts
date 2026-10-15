import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';
import { readServerMonitor, serverMonitorSessionsSql } from '../../src/engine/serverMonitor';
import { validateServerMonitorInput } from '../../src/shared/serverMonitor';
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
