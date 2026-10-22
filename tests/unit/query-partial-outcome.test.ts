import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import { queryFailureMessage, queryFailureMessageLimit } from '../../src/shared/queryFailure';

const driver = vi.hoisted(() => ({ connect: vi.fn(), execute: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ connect: driver.connect, execute: driver.execute }));
import { Engine } from '../../src/engine/index';

const profile: ConnectionProfile = { id: 'partial-ram', name: '首错停止RAM', group: '', color: '', dialect: 'mysql', host: 'invalid', port: 1, user: 'ram' };
let engine: Engine, sessionId: string, events: TaskEvent[], sent: string[], connections: ManagedConnection[], scenario: (managed: ManagedConnection, sql: string, query: EventEmitter) => void;
let nextId: number, throwSql: string | undefined;
/** 原生query事件只替代网络；实际Engine脚本扫描、预算、结果合并、首错停止和取消均执行产品实现。 */
function managed(): ManagedConnection {
  const native = new EventEmitter(), id = ++nextId;
  const value = { connection: native, profile, status: { version: '8.4.11', dialect: 'mysql' }, sqlMode: '', serverStatus: 2, transactionStateKnown: true, broken: false, close: vi.fn(async () => undefined) } as unknown as ManagedConnection;
  Object.assign(native, { threadId: id, destroy: vi.fn(), query({ sql }: { sql: string }) { sent.push(sql); if (sql === throwSql) throw Error('驱动同步拒绝'); const query = new EventEmitter(); queueMicrotask(() => scenario(value, sql, query)); return query; } });
  connections.push(value); return value;
}
function rows(query: EventEmitter, data: unknown[][], index = 0, names = ['value']) { query.emit('fields', names.map(name => ({ name, columnType: 253 })), index); for (const row of data) query.emit('result', row, index); }
function ok(query: EventEmitter, status = 2) { query.emit('result', { affectedRows: 1, insertId: '9007199254740993', warningStatus: 0, serverStatus: status }); query.emit('end'); }
const execute = (sql: string, patch: Record<string, unknown> = {}) => engine.handle('query.execute', { sessionId, sql, taskId: 'query', maxRows: 1000, ...patch }) as Promise<QueryOutcome>;
beforeEach(async () => {
  events = []; sent = []; connections = []; nextId = 0; throwSql = undefined;
  driver.connect.mockReset().mockImplementation(async () => managed()); driver.execute.mockReset().mockResolvedValue({ rows: { affectedRows: 0, serverStatus: 2 }, fields: [] });
  scenario = (_managed, _sql, query) => { rows(query, [['ok']]); query.emit('end'); };
  engine = new Engine(event => events.push(event)); await engine.handle('connections.open', { id: profile.id, profile }); sessionId = (await engine.handle('sessions.open', { connectionId: profile.id })).sessionId;
});
afterEach(async () => { await engine.closeAll(); });

describe('查询首错停止且只保留完整前序结果', () => {
  it('CALL多结果、重复列、BIGINT/DECIMAL/BLOB完整保留；失败语句已流出的批次不进入可导出结果', async () => {
    scenario = (_managed, sql, query) => {
      if (sql === 'CALL prefix()') { rows(query, [['18446744073709551615', '12345678901234567890.123456789012345678']], 0, ['同名', '同名']); rows(query, [[Buffer.from('00ff80', 'hex'), null]], 1, ['二进制', '空']); query.emit('result', { affectedRows: 0, insertId: 0, warningStatus: 0, serverStatus: 3 }); query.emit('end'); }
      else { rows(query, Array.from({ length: 201 }, () => ['失败语句未完成的行'])); query.emit('error', Object.assign(Error('首个服务器错误'), { code: 'ER_TEST' })); }
    };
    const output = await execute('CALL prefix();CALL broken();DELETE FROM tail');
    expect(sent).toEqual(['CALL prefix()', 'CALL broken()']); expect(output.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, message: expect.stringContaining('首个服务器错误') });
    expect(output.results).toHaveLength(3); expect(output.results[0].columns.map(column => [column.key, column.name])).toEqual([['c0', '同名'], ['c1', '同名']]);
    expect(output.results[0].rows).toEqual([{ c0: '18446744073709551615', c1: '12345678901234567890.123456789012345678' }]); expect(output.results[1].rows).toEqual([{ c0: { type: 'binary', base64: 'AP+A' }, c1: null }]); expect(output.results[2].affectedRows).toBe(0);
    expect(events.some(event => event.resultIndex === 3 && event.batch?.length === 200)).toBe(true); expect(JSON.stringify(output)).not.toContain('失败语句未完成的行'); expect(output).not.toHaveProperty('transactionOpen');
    expect(events.at(-1)).toMatchObject({ status: 'failed', message: output.failure!.message }); expect(events.filter(event => event.status === 'completed')).toHaveLength(0); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('首条失败也返回空完整结果与失败序号；不把ERR后的旧事务位发布为true', async () => {
    const active = connections.at(-1)!; active.serverStatus = 3; scenario = (_managed, _sql, query) => query.emit('error', Error('SQL语法错误'));
    const output = await execute('BROKEN;UPDATE tail SET n=1'); expect(output.results).toEqual([]); expect(output.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0 }); expect(output).not.toHaveProperty('transactionOpen'); expect(active.serverStatus).toBe(3); expect(active.transactionStateKnown).toBe(false); expect(sent).toEqual(['BROKEN']);
  });
  it('完整成功输出形状不新增failure；空脚本、普通行集及状态包保持兼容', async () => {
    scenario = (_managed, sql, query) => { if (sql.startsWith('UPDATE')) ok(query, 3); else { rows(query, [['成功']]); query.emit('end'); } };
    const output = await execute('SELECT value;UPDATE t SET n=1'); expect(Object.keys(output).sort()).toEqual(['elapsedMs', 'results', 'transactionOpen']); expect(output.results).toHaveLength(2); expect(output.transactionOpen).toBe(true); expect(events.at(-1)?.status).toBe('completed');
    expect((await execute('/* 空脚本 */', { taskId: 'empty' })).results).toEqual([]);
  });
  it('已完成写操作不自动回滚或重连，扫描尾部失败保留完整状态结果与可信事务位', async () => {
    let storedValue = 0; scenario = (_managed, sql, query) => { expect(sql).toBe('UPDATE t SET n=1'); storedValue++; ok(query, 3); };
    const before = driver.connect.mock.calls.length, output = await execute("UPDATE t SET n=1;SELECT '未闭合");
    expect(output).toMatchObject({ transactionOpen: true, failure: { statementOrdinal: 2, statementsCompleted: 1 } }); expect(output.results[0].affectedRows).toBe(1); expect(storedValue).toBe(1); expect(sent).toEqual(['UPDATE t SET n=1']); expect(driver.connect).toHaveBeenCalledTimes(before); expect(driver.execute).not.toHaveBeenCalled();
  });
  it.each([undefined, NaN, -1, 65536])('失败时不可信serverStatus=%j不推测事务状态', async status => {
    const active = connections.at(-1)!; active.serverStatus = status; const output = await execute("SELECT '未闭合"); expect(output.failure).toBeTruthy(); expect(output).not.toHaveProperty('transactionOpen'); expect(sent).toEqual([]);
  });
  it('主动标为事务未知但保留cached位时，扫描失败也不伪造transactionOpen', async () => { const active = connections.at(-1)!; active.serverStatus = 3; active.transactionStateKnown = false; const result = await execute("SELECT '未闭合"); expect(result).not.toHaveProperty('transactionOpen'); expect(result.failure?.statementsCompleted).toBe(0); });
  it.each(['error', 'end'] as const)('原生连接%s中断返回完整prefix并停止tail，下一次显式请求拒绝broken会话', async kind => {
    scenario = (active, sql, query) => { if (sql === 'SELECT prefix') { rows(query, [['前序']]); query.emit('end'); } else if (kind === 'error') active.connection.emit('error', Error('ECONNRESET')); else active.connection.emit('end'); };
    const output = await execute('SELECT prefix;SELECT broken;SELECT tail'); expect(output.results.map(result => result.rows)).toEqual([[{ c0: '前序' }]]); expect(output.failure?.statementOrdinal).toBe(2); expect(output).not.toHaveProperty('transactionOpen'); expect(sent).toEqual(['SELECT prefix', 'SELECT broken']);
    await expect(execute('SELECT again', { taskId: 'again' })).rejects.toThrow('断开'); expect(driver.connect).toHaveBeenCalledTimes(2);
  });
  it('同步投递失败只保留前序，失败结果完全不发布，旧任务晚到事件不污染新代次', async () => {
    let stale: EventEmitter | undefined; scenario = (_managed, sql, query) => { if (sql === 'SELECT prefix') { rows(query, [['prefix']]); query.emit('end'); } else { stale = query; rows(query, [['不完整']]); query.emit('error', Error('失败')); } };
    const output = await execute('SELECT prefix;SELECT broken;SELECT tail'); expect(output.results).toHaveLength(1); const count = events.length;
    stale!.emit('fields', [{ name: '迟到' }], 0); stale!.emit('result', ['不得发布'], 0); stale!.emit('end'); expect(events).toHaveLength(count);
    scenario = (_managed, _sql, query) => { rows(query, [['新任务']]); query.emit('end'); }; throwSql = 'SELECT sync';
    const rejected = await execute('SELECT prefix;SELECT sync;SELECT tail', { taskId: 'sync' }); expect(rejected.results).toHaveLength(1); expect(rejected.failure?.statementOrdinal).toBe(2); expect(rejected.failure?.message).toContain('驱动同步拒绝');
  });
  it('schema.apply沿旧语义抛错，不能因共享queryScript而返回failure对象', async () => {
    scenario = (_managed, sql, query) => { if (sql === 'ALTER TABLE prefix') ok(query); else query.emit('error', Error('结构变更拒绝')); };
    await expect(engine.handle('schema.apply', { connectionId: profile.id, database: 'db', sql: 'ALTER TABLE prefix;ALTER TABLE broken;ALTER TABLE tail', taskId: 'schema' })).rejects.toThrow('结构变更拒绝'); expect(sent).toEqual(['ALTER TABLE prefix', 'ALTER TABLE broken']); expect(events.at(-1)?.status).toBe('failed');
  });
  it('共享行预算仍截断成功结果；之后解析失败只保留该完整且标记截断的结果', async () => { scenario = (_managed, _sql, query) => { rows(query, [[1], [2], [3]]); query.emit('end'); }; const output = await execute("SELECT prefix;SELECT '未闭合", { maxRows: 1 }); expect(output.results).toHaveLength(1); expect(output.results[0]).toMatchObject({ truncated: true, rows: [{ c0: 1 }] }); expect(output.failure?.statementsCompleted).toBe(1); });
  it('无效行预算零SQL且有明确首条失败，不读取其他会话或自动补探测', async () => { const output = await execute('UPDATE t SET n=1', { maxRows: 0 }); expect(output.results).toEqual([]); expect(output.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0, message: expect.stringContaining('结果上限') }); expect(sent).toEqual([]); expect(driver.execute).not.toHaveBeenCalled(); });
});

describe('参数隐私、运行时预算及取消收尾', () => {
  it('参数错误只保留模板prefix及安全代码，expanded SQL和值不进入failure或事件', async () => {
    scenario = (_managed, sql, query) => { if (sql.startsWith('SELECT')) { rows(query, [['前序']]); query.emit('end'); } else query.emit('error', Object.assign(Error('秘密值 duplicate value'), { code: 'ER_DUP_ENTRY' })); };
    const output = await engine.handle('query.executeParameterized', { sessionId, taskId: 'params', sql: 'SELECT :v;INSERT INTO t VALUES (:v);DELETE FROM tail', parameters: [{ name: 'v', type: 'text', value: '秘密值' }], maxRows: 100 }) as QueryOutcome;
    expect(output.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, message: expect.stringContaining('ER_DUP_ENTRY') }); expect(output.results[0].statement).toBe('SELECT :v'); expect(output.failure!.message).toContain('已隐藏'); expect(JSON.stringify(output)).not.toContain('秘密值'); expect(JSON.stringify(events)).not.toContain('秘密值'); expect(sent).toHaveLength(2); expect(sent[1]).toContain(Buffer.from('秘密值').toString('hex'));
  });
  it('动态模式后的缺参和展开20MiB预算错误保留前序，绝不发送巨大语句或tail', async () => {
    scenario = (_managed, _sql, query) => ok(query);
    const missing = await engine.handle('query.executeParameterized', { sessionId, taskId: 'missing', sql: 'SET sql_mode=@future;SELECT :missing;DELETE FROM tail', parameters: [], maxRows: 100 }) as QueryOutcome;
    expect(missing.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1 }); expect(missing.results).toHaveLength(1); expect(sent).toEqual(['SET sql_mode=@future']); sent = [];
    const budget = await engine.handle('query.executeParameterized', { sessionId, taskId: 'budget', sql: 'SET sql_mode=@future;SELECT ' + Array(161).fill(':v').join(',') + ';DELETE FROM tail', parameters: [{ name: 'v', type: 'text', value: 'x'.repeat(65536) }], maxRows: 100 }) as QueryOutcome;
    expect(budget.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, message: expect.stringContaining('20 MiB') }); expect(budget.results).toHaveLength(1); expect(sent).toEqual(['SET sql_mode=@future']);
  });
  it('取消原命令仍reject；原控制连接关闭前保留会话互斥与任务，tail不发送', async () => {
    let pending: EventEmitter | undefined; scenario = (_managed, sql, query) => { if (sql === 'SELECT prefix') { rows(query, [['前序']]); query.emit('end'); } else pending = query; };
    const running = execute('SELECT prefix;SELECT wait;DELETE FROM tail'); const failed = expect(running).rejects.toThrow('原命令中断'); await vi.waitFor(() => expect(pending).toBeDefined());
    let release!: () => void; const control = managed(); vi.mocked(control.close).mockImplementation(async () => new Promise<void>(resolve => { release = resolve; })); driver.connect.mockResolvedValueOnce(control);
    driver.execute.mockImplementation(async (_managed, sql) => { expect(sql).toBe('KILL QUERY 2'); pending!.emit('error', Error('原命令中断')); return { rows: { affectedRows: 0 }, fields: [] }; });
    const cancelling = engine.handle('query.cancel', { taskId: 'query' }); await vi.waitFor(() => expect(release).toBeDefined()); await expect(execute('SELECT other', { taskId: 'other' })).rejects.toThrow('正在执行'); expect(events.at(-1)?.status).not.toBe('cancelled');
    release(); await cancelling; await failed; expect(events.at(-1)?.status).toBe('cancelled'); expect(sent).toEqual(['SELECT prefix', 'SELECT wait']); expect(control.close).toHaveBeenCalledOnce();
  });
  it('取消建控制连接期间原代次已结束，不发送迟到KILL且不执行tail', async () => {
    let pending: EventEmitter | undefined; scenario = (_managed, _sql, query) => { pending = query; };
    const running = execute('SELECT wait;DELETE FROM tail'); const rejected = expect(running).rejects.toThrow('取消'); await vi.waitFor(() => expect(pending).toBeDefined());
    let deliver!: (value: ManagedConnection) => void; driver.connect.mockImplementationOnce(() => new Promise<ManagedConnection>(resolve => { deliver = resolve; })); const cancelling = engine.handle('query.cancel', { taskId: 'query' }); pending!.emit('end'); await Promise.resolve();
    await expect(execute('SELECT other', { taskId: 'other' })).rejects.toThrow('正在执行'); deliver(managed()); await cancelling; await rejected; expect(driver.execute).not.toHaveBeenCalled(); expect(sent).toEqual(['SELECT wait']);
  });
});

describe('有界失败消息保留执行事实', () => {
  it('32Ki UTF16总预算包含明确截断标记，不拆代理对，序号和不可重放前缀完整', () => {
    const empty = queryFailureMessage(2, ''), marker = '\n[错误详情已截断]', padding = queryFailureMessageLimit - marker.length - empty.length - 1;
    const message = queryFailureMessage(2, 'x'.repeat(padding) + '😀' + 'x'.repeat(100)); expect(message.length).toBeLessThanOrEqual(queryFailureMessageLimit); expect(message).toContain('第 3 条 SQL 未完成；已完成 2 条'); expect(message).toContain('未自动回滚或重放'); expect(message.endsWith(marker)).toBe(true); expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(message)).toBe(false);
  });
  it('实际服务器长错误亦受同一总限额，不改变已完成结果', async () => { scenario = (_managed, _sql, query) => query.emit('error', Error('😀'.repeat(40000)));
    const output = await execute('BROKEN;DELETE tail'); expect(output.failure!.message.length).toBeLessThanOrEqual(queryFailureMessageLimit); expect(output.failure!.message.endsWith('[错误详情已截断]')).toBe(true); expect(output.results).toEqual([]); expect(sent).toEqual(['BROKEN']);
  });
});
