import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import { QueryWarningCollector, queryWarningsCountSql, queryWarningsDetailsSql, type QueryWarningsContext } from '../../src/engine/queryWarnings';
import { queryWarningsReportSchema } from '../../src/shared/queryWarnings';
import type { ManagedConnection } from '../../src/engine/connection';
import type { QueryOutcome, TaskEvent } from '../../src/shared/contracts';

const driver = vi.hoisted(() => ({ execute: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ execute: driver.execute, connect: driver.connect }));
const failure = (message = '预期服务器失败') => Object.assign(Error(message), { code: 'ER_DUP_ENTRY', errno: 1062, sqlState: '23000' });
const condition = (message = '原警告') => ({ Level: 'Warning', Code: 1292, Message: message });
const counted = (value: unknown = 1) => ({ rows: [{ '@@session.warning_count': value }], fields: [{ name: '@@session.warning_count' }] });
const details = (rows: unknown[] = [condition()]) => ({ rows, fields: ['Level', 'Code', 'Message'].map(name => ({ name })) });

/** 仅模拟固定诊断原始回包；不把内存形状验证冒充服务器诊断验收。 */
function collectorFixture(parameterized = false) {
  const collector = new QueryWarningCollector(parameterized), check = vi.fn();
  const query = vi.fn(async (sql: string): Promise<{ rows: unknown; fields: { name: string }[] }> => sql === queryWarningsCountSql ? counted() : details());
  const context: QueryWarningsContext = { query, check, broken: () => false };
  const capture = (ordinal = 1) => collector.capture({ statementOrdinal: ordinal, status: 'completed', sourceRange: { start: 3, end: 12 } }, context);
  return { collector, query, check, context, capture };
}
beforeEach(() => { driver.execute.mockReset(); driver.connect.mockReset(); });

describe('原语句警告报告与独立采集预算', () => {
  it('固定COUNT之后按需固定LIMIT101，记录真实计数和三列明细', async () => {
    const f = collectorFixture(); await f.capture();
    expect(f.query.mock.calls.map(call => call[0])).toEqual([queryWarningsCountSql, queryWarningsDetailsSql]);
    expect(queryWarningsReportSchema.parse(f.collector.report)).toMatchObject({ collection: 'explicit', truncated: false, omittedStatements: 0, statements: [{ statementOrdinal: 1, status: 'completed', warningCount: 1, conditions: [{ level: 'Warning', code: 1292, message: '原警告' }], truncated: false, sourceRange: { start: 3, end: 12 } }] });
  });
  it('真实零计数仅读COUNT，不发送明细，也不把异常计数当零', async () => {
    const f = collectorFixture(); f.query.mockResolvedValue(counted('0')); await f.capture();
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.collector.report.statements[0]).toMatchObject({ warningCount: 0, conditions: [], truncated: false });
  });
  it.each([NaN, -1, Infinity, 1.5, '1.5', '01', '9007199254740992', null, true])('未知计数%j保留unavailable，不补零或继续读明细', async value => {
    const f = collectorFixture(); f.query.mockResolvedValue(counted(value)); await f.capture();
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.collector.report.statements[0].warningCount).toBeUndefined();
    expect(f.collector.report.statements[0].unavailable).toBeTruthy(); expect(f.collector.report.truncated).toBe(true);
  });
  it('服务器只保留部分条件时标不完整，不把max_error_count截断伪装成全部', async () => {
    const f = collectorFixture(); f.query.mockImplementation(async sql => sql === queryWarningsCountSql ? counted(3) : details([condition()]));
    await f.capture(); expect(f.collector.report.statements[0]).toMatchObject({ warningCount: 3, truncated: true }); expect(f.collector.report.statements[0].conditions).toHaveLength(1);
  });
  it('每语句最多100条件，额外第101条只证明截断', async () => {
    const f = collectorFixture(); f.query.mockImplementation(async sql => sql === queryWarningsCountSql ? counted(101) : details(Array.from({ length: 101 }, () => condition())));
    await f.capture(); expect(f.collector.report.statements[0].conditions).toHaveLength(100); expect(f.collector.report.statements[0].truncated).toBe(true);
  });
  it('参数Message不读取、不暂存到报告且不参与字节计算', async () => {
    const f = collectorFixture(true), raw = { Level: 'Warning', Code: 1292 };
    const getter = vi.fn(() => { throw Error('不准读取参数秘密'); }); Object.defineProperty(raw, 'Message', { get: getter, enumerable: true });
    f.query.mockImplementation(async sql => sql === queryWarningsCountSql ? counted() : details([raw])); await f.capture();
    expect(getter).not.toHaveBeenCalled(); expect(f.collector.report.statements[0].conditions).toEqual([{ level: 'Warning', code: 1292, messageHidden: true }]);
  });
  it('恶意Level和诊断异常正文不能成为参数秘密侧通道', async () => {
    const secret = '不得泄露', f = collectorFixture(true);
    f.query.mockImplementation(async sql => sql === queryWarningsCountSql ? counted() : details([{ ...condition(secret), Level: secret }])); await f.capture();
    expect(JSON.stringify(f.collector.report)).not.toContain(secret); expect(f.collector.report.statements[0].unavailable).toBeTruthy();
    const rejected = collectorFixture(true); rejected.query.mockRejectedValue(Object.assign(Error(secret), { sqlMessage: secret })); await rejected.capture();
    expect(JSON.stringify(rejected.collector.report)).not.toContain(secret);
  });
  it('消息及总JSON预算截断明确，预算满后只计omitted不再发送SHOW', async () => {
    const f = collectorFixture(); f.query.mockImplementation(async sql => sql === queryWarningsCountSql ? counted(100) : details(Array.from({ length: 100 }, () => condition('中'.repeat(5000)))));
    await f.capture(1); await f.capture(2); const sent = f.query.mock.calls.length; await f.capture(3);
    expect(Buffer.byteLength(JSON.stringify(f.collector.report))).toBeLessThanOrEqual(512 * 1024); expect(f.collector.report.truncated).toBe(true);
    expect(f.collector.report.omittedStatements).toBe(1); expect(f.query).toHaveBeenCalledTimes(sent);
    expect(f.collector.report.statements[0].conditions[0].messageTruncated).toBe(true); expect(queryWarningsReportSchema.safeParse(f.collector.report).success).toBe(true);
  });
});

/** 使用真实Engine互斥/任务/流边界，仅网络及SHOW原始回包由合成端口提供。 */
function engineFixture() {
  const native = new EventEmitter(), socket = new EventEmitter(), sent: string[] = [], diagnostics: string[] = [], events: TaskEvent[] = [];
  const managed = { connection: native, profile: {}, status: { dialect: 'mysql', version: '8.4.11' }, sqlMode: '', noBackslashEscapesKnown: true, transactionStateKnown: true, serverStatus: 2, completionDatabase: { known: true, database: 'db' }, broken: false } as unknown as ManagedConnection;
  let ended = true, currentSql = '';
  const state = { count: 1, conditions: [condition()] as unknown[], user: (_sql: string, query: EventEmitter) => ok(query), diagnostic: undefined as undefined | ((sql: string) => unknown) };
  const engine = new Engine(event => events.push(event)), session = { id: 's', connectionId: 'c', managed, busy: false };
  (engine as any).sessions.set('s', session);
  Object.assign(native, { threadId: 777, stream: socket, destroy: vi.fn(() => socket.emit('close')), query({ sql }: { sql: string }) {
    currentSql = sql; sent.push(sql); ended = false; const query = new EventEmitter(); query.prependOnceListener('end', () => { ended = true; }); queueMicrotask(() => state.user(sql, query)); return query;
  } });
  driver.execute.mockImplementation(async (target, sql) => {
    expect(target).toBe(managed); expect(ended).toBe(true); diagnostics.push(sql);
    managed.serverStatus = 2; managed.transactionStateKnown = true;
    if (state.diagnostic) return state.diagnostic(sql);
    if (sql === queryWarningsCountSql) return counted(state.count);
    if (sql === queryWarningsDetailsSql) return details(state.conditions);
    expect(sql).toMatch(/^SELECT @@SESSION.sql_mode AS __dbark_continue_mode/);
    return { rows: [{ __dbark_continue_mode: '', __dbark_continue_connection: '777', __dbark_continue_database: 'db' }], fields: ['__dbark_continue_mode', '__dbark_continue_connection', '__dbark_continue_database'].map(name => ({ name })) };
  });
  function ok(query: EventEmitter, rows: unknown[] = ['原结果']) {
    managed.serverStatus = 2; managed.transactionStateKnown = true;
    query.emit('fields', [{ name: 'value', columnType: 253 }], 0); for (const value of rows) query.emit('result', [value], 0);
    native.emit('dbark:session-state', { sql: currentSql, warningStatus: state.count, serverStatus: 2 }); query.emit('end');
  }
  function fail(query: EventEmitter) { managed.transactionStateKnown = false; query.emit('error', failure()); query.emit('end'); }
  const run = (sql: string, options: Record<string, unknown> = {}): Promise<QueryOutcome> => engine.handle(options.parameters ? 'query.executeParameterized' : 'query.execute', { sessionId: 's', taskId: 't', sql, maxRows: 100, ...options });
  return { engine, managed, native, socket, session, events, sent, diagnostics, state, ok, fail, run };
}

describe('显式警告采集Engine集成', () => {
  it.each([undefined, false, 1, 'true'])('非true值%j不读取任何附加SQL，仍被动映射SELECT EOF计数', async collectWarnings => {
    const f = engineFixture(), output = await f.run('SELECT one;', { collectWarnings });
    expect(output.warnings).toBeUndefined(); expect(output.results[0].warningCount).toBe(1); expect(f.diagnostics).toEqual([]);
    expect(driver.connect).not.toHaveBeenCalled(); expect(f.native.listenerCount('dbark:session-state')).toBe(0);
  });
  it('普通多语句逐条采集，内部SHOW不进入用户结果、历史或额外语句计数', async () => {
    const f = engineFixture(), output = await f.run('SELECT one;SELECT two;', { collectWarnings: true });
    expect(output.failure).toBeUndefined(); expect(output.results).toHaveLength(2); expect(output.warnings?.statements.map(item => [item.statementOrdinal, item.status])).toEqual([[1, 'completed'], [2, 'completed']]);
    expect(f.diagnostics).toEqual([queryWarningsCountSql, queryWarningsDetailsSql, queryWarningsCountSql, queryWarningsDetailsSql]);
    expect(f.events.every(event => event.executionSql === undefined)).toBe(true); expect(f.events.filter(event => event.columns)).toHaveLength(2);
  });
  it('普通ERR仍首错停止并采原错误诊断，不能执行尾句', async () => {
    const f = engineFixture(); f.state.user = (_sql, query) => f.fail(query); f.state.conditions = [{ Level: 'Error', Code: 1062, Message: '原错误' }];
    const output = await f.run('INSERT bad;INSERT tail;', { collectWarnings: true });
    expect(output.failure?.statementOrdinal).toBe(1); expect(f.sent).toEqual(['INSERT bad']);
    expect(output.warnings?.statements[0]).toMatchObject({ status: 'failed', warningCount: 1, conditions: [{ level: 'Error', code: 1062, message: '原错误' }] });
  });
  it('ERR的SHOW必须先于continue固定恢复，之后原成功仍准确计入', async () => {
    const f = engineFixture(); f.state.user = (sql, query) => sql.includes('bad') ? f.fail(query) : f.ok(query);
    const output = await f.run('INSERT bad;SELECT after;', { collectWarnings: true, continueOnError: true });
    expect(output.scriptReport).toMatchObject({ statementsAttempted: 2, statementsCompleted: 1, reachedEnd: true });
    expect(f.diagnostics.slice(0, 3)).toEqual([queryWarningsCountSql, queryWarningsDetailsSql, expect.stringMatching(/^SELECT @@SESSION.sql_mode/)]);
    expect(output.warnings?.statements.map(item => item.status)).toEqual(['failed', 'completed']);
  });
  it('前序ERR后本条成功却采集断线，不把成功组重复记成failed', async () => {
    const f = engineFixture(); f.state.user = (sql, query) => sql.includes('bad') ? f.fail(query) : f.ok(query); let countReads = 0;
    f.state.diagnostic = sql => {
      if (sql === queryWarningsCountSql && ++countReads === 3) { f.managed.broken = true; throw Error('原采集连接断开'); }
      if (sql === queryWarningsCountSql) return counted(1); if (sql === queryWarningsDetailsSql) return details();
      return { rows: [{ __dbark_continue_mode: '', __dbark_continue_connection: '777', __dbark_continue_database: 'db' }], fields: ['__dbark_continue_mode', '__dbark_continue_connection', '__dbark_continue_database'].map(name => ({ name })) };
    };
    const output = await f.run('INSERT bad;SELECT first_success;SELECT successful;INSERT tail;', { collectWarnings: true, continueOnError: true });
    expect(output.warnings?.statements.map(item => [item.statementOrdinal, item.status])).toEqual([[1, 'failed'], [2, 'completed'], [3, 'completed']]);
    expect(output.warnings?.statements[2].unavailable).toBeTruthy(); expect(output.results).toHaveLength(2); expect(output.scriptReport).toMatchObject({ statementsAttempted: 3, statementsCompleted: 2, reachedEnd: false });
    expect(f.sent).toEqual(['INSERT bad', 'SELECT first_success', 'SELECT successful']); expect(queryWarningsReportSchema.safeParse(output.warnings).success).toBe(true);
  });
  it('普通原SQL成功但SHOW出ERR后协议未知，保留成功结果并停止尾句', async () => {
    const f = engineFixture(); f.state.diagnostic = () => { f.managed.serverStatus = undefined; f.managed.transactionStateKnown = false; throw failure('不得泄露采集错误正文'); };
    const output = await f.run('SELECT successful;INSERT tail;', { collectWarnings: true });
    expect(f.sent).toEqual(['SELECT successful']); expect(output.results).toHaveLength(1);
    expect(output.warnings?.statements.map(item => item.status)).toEqual(['completed']); expect(output.warnings?.statements[0].unavailable).toBeTruthy();
    expect(output.failure?.message).toContain('已执行'); expect(output.failure?.message).not.toContain('不得泄露'); expect(output.transactionOpen).toBeUndefined();
    expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('CALL整体只采一次且先等真实end；中间EOF计数与最终OK不混淆', async () => {
    const f = engineFixture(); let pending: EventEmitter | undefined;
    f.state.user = (sql, query) => {
      pending = query; query.emit('fields', [{ name: 'first', columnType: 253 }], 0); query.emit('result', ['片段'], 0);
      f.native.emit('dbark:session-state', { sql, warningStatus: 7, serverStatus: 10 });
      query.emit('error', failure());
    };
    const running = f.run('CALL partial();', { collectWarnings: true }); await vi.waitFor(() => expect(pending).toBeDefined());
    expect(f.diagnostics).toEqual([]); pending!.emit('end'); const output = await running;
    expect(output.results).toEqual([]); expect(output.warnings?.statements).toHaveLength(1); expect(output.warnings?.statements[0].warningCount).toBe(1);
    const completed = engineFixture(); completed.state.user = (sql, query) => {
      query.emit('fields', [{ name: 'row', columnType: 253 }], 0); query.emit('result', ['行'], 0);
      completed.native.emit('dbark:session-state', { sql, warningStatus: 7, serverStatus: 10 });
      completed.native.emit('dbark:session-state', { sql, warningStatus: 2, serverStatus: 2 });
      query.emit('result', { affectedRows: 0, insertId: 0, warningStatus: 2, serverStatus: 2 }, 1); query.emit('end');
    };
    const call = await completed.run('CALL ok();'); expect(call.results.map(result => result.warningCount)).toEqual([7, 2]);
  });
  it('参数Message原文不进入报告、事件或错误，Level/Code仍展示', async () => {
    const f = engineFixture(), secret = '秘密参数'; f.state.conditions = [condition(secret)];
    const output = await f.run('SELECT :v;', { collectWarnings: true, parameters: [{ name: 'v', type: 'text', value: secret }] });
    expect(output.warnings?.statements[0].conditions).toEqual([{ level: 'Warning', code: 1292, messageHidden: true }]);
    expect(JSON.stringify(output)).not.toContain(secret); expect(JSON.stringify(f.events)).not.toContain(secret);
  });
  it('200组之后仅省略警告采集，尾部INSERT照常执行', async () => {
    const f = engineFixture(); f.state.count = 0;
    const output = await f.run(Array.from({ length: 201 }, (_, index) => `SELECT ${index}`).join(';') + ';INSERT tail;', { collectWarnings: true });
    expect(f.sent).toHaveLength(202); expect(f.sent.at(-1)).toBe('INSERT tail'); expect(f.diagnostics).toHaveLength(200);
    expect(output.failure).toBeUndefined(); expect(output.warnings).toMatchObject({ omittedStatements: 2, truncated: true }); expect(output.warnings?.statements).toHaveLength(200);
  });
  it('采集COUNT后取消不得再送明细和下一句，并释放原任务', async () => {
    const f = engineFixture(); f.state.diagnostic = () => { (f.engine as any).tasks.get('t').cancelled = true; return counted(1); };
    await expect(f.run('SELECT one;INSERT tail;', { collectWarnings: true })).rejects.toThrow('取消');
    expect(f.diagnostics).toEqual([queryWarningsCountSql]); expect(f.sent).toEqual(['SELECT one']); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
});
