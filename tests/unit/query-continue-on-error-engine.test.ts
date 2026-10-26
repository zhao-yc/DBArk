import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import type { ManagedConnection } from '../../src/engine/connection';
import type { QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';
import { queryScriptReportSchema } from '../../src/shared/queryContinueOnError';

const driver = vi.hoisted(() => ({ execute: vi.fn(), connect: vi.fn() }));
vi.mock('../../src/engine/connection', () => ({ execute: driver.execute, connect: driver.connect }));
const diagnostic = 'SELECT @@SESSION.sql_mode AS __dbark_continue_mode,CAST(CONNECTION_ID() AS CHAR) AS __dbark_continue_connection,DATABASE() AS __dbark_continue_database';
const diagnosticNames = ['__dbark_continue_mode', '__dbark_continue_connection', '__dbark_continue_database'];
const serverError = (message = '预期语法错误', patch = {}) => Object.assign(Error(message), { code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000', ...patch });

/** 原始事件只替代网络；真实互斥、任务、调度、绑定、流预算和错误分类都执行产品代码。 */
function fixture() {
  const connection = new EventEmitter(), transport = new EventEmitter(), sent: string[] = [], events: TaskEvent[] = [];
  const managed = { connection, profile: {}, status: { dialect: 'mysql', version: '8.4.11' }, sqlMode: '', noBackslashEscapesKnown: true, serverStatus: 2, transactionStateKnown: true, completionDatabase: { known: true, database: '初始库' }, broken: false } as unknown as ManagedConnection;
  let ended = true;
  const controls = { mode: '', database: '真实库' as string | null, status: 2, onEvent: (_event: TaskEvent) => {}, scenario: (_sql: string, query: EventEmitter) => ok(query), diagnosticResult: undefined as any };
  const engine = new Engine(event => { controls.onEvent(event); events.push(event); });
  const session = { id: 's', connectionId: 'c', managed, busy: false }; (engine as any).sessions.set('s', session);
  Object.assign(connection, {
    threadId: 777, stream: transport, destroy: vi.fn(() => transport.emit('close')),
    query: ({ sql }: { sql: string }) => {
      sent.push(sql); ended = false; const query = new EventEmitter();
      query.prependOnceListener('end', () => { ended = true; });
      queueMicrotask(() => controls.scenario(sql, query)); return query;
    },
  });
  driver.execute.mockImplementation(async (target, sql) => {
    expect(target).toBe(managed); expect(sql).toBe(diagnostic); expect(ended).toBe(true);
    expect(managed.serverStatus).toBeUndefined(); expect(managed.transactionStateKnown).toBe(false);
    if (controls.diagnosticResult) return controls.diagnosticResult();
    managed.serverStatus = controls.status; managed.transactionStateKnown = true;
    return { rows: [{ [diagnosticNames[0]]: controls.mode, [diagnosticNames[1]]: '777', [diagnosticNames[2]]: controls.database }], fields: diagnosticNames.map(name => ({ name })) };
  });
  /** 先模拟原ERR使缓存失效，再发error与end，确保诊断必须等待原命令终态。 */
  function fail(query: EventEmitter, error = serverError()) {
    managed.sqlMode = undefined; managed.noBackslashEscapesKnown = false; managed.transactionStateKnown = false;
    managed.completionDatabase = { known: false, database: '失效旧库' };
    query.emit('error', error); query.emit('end');
  }
  function ok(query: EventEmitter, rows: unknown[] = ['成功']) {
    managed.serverStatus = controls.status; managed.transactionStateKnown = true;
    query.emit('fields', [{ name: 'value', columnType: 253 }], 0);
    for (const value of rows) query.emit('result', [value], 0);
    query.emit('end');
  }
  const run = (sql: string, options: { continueOnError?: unknown; maxRows?: number; parameters?: QueryParameter[]; currentStatement?: { offset: number } } = {}): Promise<QueryOutcome> => engine.handle(options.parameters ? 'query.executeParameterized' : 'query.execute', { sessionId: 's', taskId: 't', sql, maxRows: 1000, continueOnError: true, ...options });
  return { engine, managed, controls, session, connection, transport, sent, events, run, fail, ok };
}
beforeEach(() => { driver.execute.mockReset(); driver.connect.mockReset(); });

describe('显式继续与默认首错停止隔离', () => {
  it.each([undefined, false, 1, 'true'])('仅===true启用；值%j仍按原首错路径停止', async continueOnError => {
    const f = fixture(); f.controls.scenario = (sql, query) => sql === 'SELECT bad' ? f.fail(query) : f.ok(query);
    const output = await f.run('SELECT before;SELECT bad;SELECT after;', { continueOnError });
    expect(output.scriptReport).toBeUndefined(); expect(output.failure?.statementOrdinal).toBe(2);
    expect(f.sent).toEqual(['SELECT before', 'SELECT bad']); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('前后成功结果保留，首错范围与最终失败事件保留，按真实ordinal继续', async () => {
    const f = fixture(), source = "SELECT '😀';\r\n SELECT bad;SELECT after;SELECT bad;SELECT last;";
    f.controls.scenario = (sql, query) => sql === 'SELECT bad' ? f.fail(query) : f.ok(query, [sql]);
    const output = await f.run(source), report = queryScriptReportSchema.parse(output.scriptReport);
    expect(report).toMatchObject({ mode: 'continue-on-error', statementsAttempted: 5, statementsCompleted: 3, reachedEnd: true });
    expect(report.errors.map(error => [error.kind, error.statementOrdinal, error.statementsCompleted])).toEqual([['server', 2, 1], ['server', 4, 2]]);
    const start = source.indexOf('SELECT bad'); expect(output.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, sourceRange: { start, end: start + 10 } });
    expect(output.results.map(result => result.rows[0].c0)).toEqual(["SELECT '😀'", 'SELECT after', 'SELECT last']);
    expect(driver.execute).toHaveBeenCalledTimes(2); expect(driver.connect).not.toHaveBeenCalled();
    expect(f.events.at(-1)?.status).toBe('failed'); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
    expect(f.events.filter(event => event.columns).map(event => event.resultIndex)).toEqual([0, 1, 2]);
  });
  it('DELIMITER过程体只投一次，CALL先产行再SIGNAL时整条片段均丢弃', async () => {
    const f = fixture(), source = "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT '内部;'; END$$\nDELIMITER ;\nCALL p();SELECT tail;";
    f.controls.scenario = (sql, query) => {
      if (sql === 'CALL p()') { query.emit('fields', [{ name: 'partial', columnType: 253 }], 0); query.emit('result', ['不得发布'], 0); f.fail(query, serverError('过程主动失败', { code: 'ER_SIGNAL_EXCEPTION', errno: 1644, sqlState: '45000' })); }
      else f.ok(query, [sql]);
    };
    const output = await f.run(source);
    expect(f.sent).toEqual(["CREATE PROCEDURE p() BEGIN SELECT '内部;'; END", 'CALL p()', 'SELECT tail']);
    expect(output.scriptReport).toMatchObject({ statementsAttempted: 3, statementsCompleted: 2, reachedEnd: true });
    expect(JSON.stringify(output.results)).not.toContain('不得发布'); expect(JSON.stringify(f.events)).not.toContain('不得发布');
    expect(f.events.filter(event => event.columns).map(event => event.resultIndex)).toEqual([0, 1]);
  });
  it('完全成功也返回显式报告，空脚本不冒充执行语句', async () => {
    const f = fixture(), output = await f.run('SELECT one;SELECT two;');
    expect(output.failure).toBeUndefined(); expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({ statementsAttempted: 2, statementsCompleted: 2, reachedEnd: true, errors: [] });
    const empty = fixture(); expect((await empty.run('-- 只有注释')).scriptReport).toMatchObject({ statementsAttempted: 0, statementsCompleted: 0, reachedEnd: true }); expect(empty.sent).toEqual([]);
  });
  it('当前语句仍只发送目标，不因继续选项执行邻句或整篇', async () => {
    const f = fixture(), source = 'SELECT before;SELECT bad;SELECT after;'; f.controls.scenario = (_sql, query) => f.fail(query);
    const output = await f.run(source, { currentStatement: { offset: 22 } });
    expect(f.sent).toEqual(['SELECT bad']); expect(output.scriptReport).toMatchObject({ statementsAttempted: 1, statementsCompleted: 0, reachedEnd: true });
  });
});

describe('ERR后的同会话恢复与强制停止', () => {
  it('原ERR未end时不诊断；恢复真实模式、库、事务后才扫描反斜线尾句', async () => {
    const f = fixture(); let pending: EventEmitter | undefined;
    f.controls.mode = 'NO_BACKSLASH_ESCAPES'; f.controls.database = '错误后真实库'; f.controls.status = 515;
    f.controls.scenario = (sql, query) => {
      if (sql === 'CALL bad()') { pending = query; f.managed.sqlMode = undefined; f.managed.transactionStateKnown = false; query.emit('error', serverError()); }
      else f.ok(query, [sql]);
    };
    const running = f.run("CALL bad();SELECT 'C:\\';SELECT tail;");
    await vi.waitFor(() => expect(pending).toBeDefined()); expect(driver.execute).not.toHaveBeenCalled(); expect(f.sent).toEqual(['CALL bad()']);
    pending!.emit('end'); const output = await running;
    expect(f.sent).toEqual(['CALL bad()', "SELECT 'C:\\'", 'SELECT tail']);
    expect(f.managed.completionDatabase).toEqual({ known: true, database: '错误后真实库' });
    expect(f.managed.sqlMode).toBe('NO_BACKSLASH_ESCAPES'); expect(f.managed.noBackslashEscapesKnown).toBe(true); expect(output.transactionOpen).toBe(true);
  });
  it('死锁ERR后协议显示服务器已回滚，Engine不发送任何事务补偿', async () => {
    const f = fixture(); f.managed.serverStatus = 3; f.controls.status = 2;
    f.controls.scenario = (sql, query) => sql === 'UPDATE deadlock' ? f.fail(query, serverError('死锁', { code: 'ER_LOCK_DEADLOCK', errno: 1213, sqlState: '40001' })) : f.ok(query);
    const output = await f.run('UPDATE deadlock;SELECT after;'); expect(output.transactionOpen).toBe(false);
    expect(f.sent).toEqual(['UPDATE deadlock', 'SELECT after']); expect(driver.execute.mock.calls.map(call => call[1])).toEqual([diagnostic]);
  });
  it.each(['bad-id', 'bad-fields', 'extra-row', 'unknown-protocol', 'mode-conflict', 'bad-db', 'read-failed'] as const)('恢复失败%s不发送后续SQL、不重放原错误句', async shape => {
    const f = fixture(); f.controls.scenario = (_sql, query) => f.fail(query);
    f.controls.diagnosticResult = () => {
      if (shape === 'read-failed') throw Error('恢复原连接失败');
      f.managed.serverStatus = shape === 'mode-conflict' ? 514 : 2; f.managed.transactionStateKnown = shape !== 'unknown-protocol';
      const result = { rows: [{ [diagnosticNames[0]]: '', [diagnosticNames[1]]: shape === 'bad-id' ? '778' : '777', [diagnosticNames[2]]: shape === 'bad-db' ? '' : null }], fields: diagnosticNames.map(name => ({ name })) };
      if (shape === 'bad-fields') result.fields.pop(); if (shape === 'extra-row') result.rows.push({ ...result.rows[0] }); return result;
    };
    const output = await f.run('SELECT bad;DELETE FROM tail;'), report = queryScriptReportSchema.parse(output.scriptReport);
    expect(report.reachedEnd).toBe(false); expect(report.stopReason).toBeTruthy(); expect(report.errors).toHaveLength(1);
    expect(f.sent).toEqual(['SELECT bad']); expect(driver.connect).not.toHaveBeenCalled(); expect(output.failure).toBeDefined();
  });
  it.each([
    { code: 'ER_QUERY_INTERRUPTED', errno: 1317, sqlState: '70100' },
    { code: 'ER_CONNECTION_KILLED', errno: 1927, sqlState: 'HY000' },
    { code: 'ER_SERVER_SHUTDOWN', errno: 1053, sqlState: '08S01' },
    { code: 'ER_PARSE_ERROR', errno: 1064, sqlState: '42000', fatal: true },
  ])('服务器停止错误%j不得诊断后继续', async patch => {
    const f = fixture(); f.controls.scenario = (_sql, query) => f.fail(query, serverError('必须停', patch));
    const output = await f.run('SELECT bad;SELECT tail;'); expect(output.scriptReport).toMatchObject({ reachedEnd: false, statementsAttempted: 1, statementsCompleted: 0 });
    expect(output.scriptReport?.errors[0].kind).toBe('stopped'); expect(f.sent).toEqual(['SELECT bad']); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('原socket只有close也结束等待，绝不拿超时当命令终态继续', async () => {
    const f = fixture(); f.controls.scenario = (_sql, query) => { query.emit('error', serverError()); f.transport.emit('close'); };
    const output = await f.run('SELECT bad;SELECT tail;'); expect(output.scriptReport?.reachedEnd).toBe(false); expect(f.managed.broken).toBe(true);
    expect(f.sent).toEqual(['SELECT bad']); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('本地消费者即使伪造完整服务器错误字段，也不能继续或诊断', async () => {
    const f = fixture(); f.controls.onEvent = event => { if (event.columns) throw serverError('本地消费者，不是driver ERR'); };
    const output = await f.run('SELECT before;DELETE FROM tail;'); expect(output.scriptReport?.errors[0].kind).toBe('stopped');
    expect(f.sent).toEqual(['SELECT before']); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('取消仍拒绝，不发布可消费的完成报告，也不发诊断和下一句', async () => {
    const f = fixture(); f.controls.scenario = (_sql, query) => { (f.engine as any).tasks.get('t').cancelled = true; f.fail(query, serverError('取消', { code: 'ER_QUERY_INTERRUPTED', errno: 1317, sqlState: '70100' })); };
    await expect(f.run('SELECT wait;DELETE FROM tail;')).rejects.toThrow('取消');
    expect(driver.execute).not.toHaveBeenCalled(); expect(f.events.at(-1)?.status).toBe('cancelled'); expect(f.session.busy).toBe(false); expect((f.engine as any).tasks.size).toBe(0);
  });
  it('取消控制原Promise拒绝时保留原异常并释放map、done和会话互斥', async () => {
    const f = fixture(), failure = Error('原控制收尾失败'); let task: any;
    f.controls.scenario = (_sql, query) => {
      task = (f.engine as any).tasks.get('t'); task.cancelled = true;
      task.cancelPending = Promise.reject(failure); task.cancelPending.catch(() => undefined);
      f.fail(query, serverError('原取消ERR', { code: 'ER_QUERY_INTERRUPTED', errno: 1317, sqlState: '70100' }));
    };
    let caught: any; try { await f.run('SELECT wait;DELETE FROM tail;'); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect(caught.errors).toContain(failure);
    expect(caught.message).toContain('取消收尾失败'); expect(f.events.at(-1)?.status).toBe('cancelled');
    expect(f.sent).toEqual(['SELECT wait']); expect(driver.execute).not.toHaveBeenCalled(); expect(driver.connect).not.toHaveBeenCalled();
    expect((f.engine as any).tasks.size).toBe(0); expect(f.session.busy).toBe(false); await expect(task.done).resolves.toBeUndefined();
  });
  it('尾部解析失败不沿用前一句范围，错误ordinal按原调度下一项', async () => {
    const f = fixture(), output = await f.run("SELECT one;SELECT '未闭合");
    expect(output.scriptReport).toMatchObject({ statementsAttempted: 1, statementsCompleted: 1, reachedEnd: false });
    expect(output.scriptReport?.errors[0]).toMatchObject({ kind: 'stopped', statementOrdinal: 2 }); expect(output.scriptReport?.errors[0].sourceRange).toBeUndefined();
    expect(f.sent).toEqual(['SELECT one']); expect(driver.execute).not.toHaveBeenCalled();
  });
});

describe('共享预算、错误上限与参数脱敏', () => {
  it('失败片段消耗整批行预算但不阻止后续写入，也不退款重置后续行结果', async () => {
    const f = fixture(); f.controls.scenario = (sql, query) => {
      if (sql === 'CALL partial()') { query.emit('fields', [{ name: 'partial', columnType: 253 }], 0); query.emit('result', ['隐藏1'], 0); query.emit('result', ['隐藏2'], 0); f.fail(query); }
      else if (sql.startsWith('INSERT ')) { query.emit('result', { affectedRows: 1, insertId: 0, warningStatus: 0, serverStatus: 2 }, 0); query.emit('end'); }
      else f.ok(query);
    };
    const output = await f.run('SELECT before;CALL partial();INSERT INTO tail VALUES(1);SELECT after;', { maxRows: 3 });
    expect(f.sent).toEqual(['SELECT before', 'CALL partial()', 'INSERT INTO tail VALUES(1)', 'SELECT after']);
    expect(output.results).toHaveLength(3); expect(output.results[1].affectedRows).toBe(1); expect(output.results[2]).toMatchObject({ rows: [], truncated: true });
    expect(output.results.reduce((total, result) => total + result.rows.length, 0)).toBe(1);
    expect(output.scriptReport).toMatchObject({ reachedEnd: true, statementsAttempted: 4, statementsCompleted: 3 }); expect(output.scriptReport?.stopReason).toBeUndefined();
    expect(JSON.stringify(f.events)).not.toContain('隐藏'); expect(queryScriptReportSchema.safeParse(output.scriptReport).success).toBe(true);
  });
  it('单条SELECT恰好用尽显示行预算仍是完整成功，不伪造不存在的第2条失败', async () => {
    const f = fixture(), output = await f.run('SELECT one;', { maxRows: 1 });
    expect(f.sent).toEqual(['SELECT one']); expect(output.results).toHaveLength(1);
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({ statementsAttempted: 1, statementsCompleted: 1, reachedEnd: true, errors: [] }); expect(output.failure).toBeUndefined();
  });
  it('成功SELECT被显示截断后仍执行INSERT，后续SELECT不获得新的行预算', async () => {
    const f = fixture(); f.controls.scenario = (sql, query) => {
      if (sql.startsWith('INSERT ')) { query.emit('result', { affectedRows: 1, insertId: 0, warningStatus: 0, serverStatus: 2 }, 0); query.emit('end'); }
      else f.ok(query, ['第一行', '显示预算外']);
    };
    const output = await f.run('SELECT many;INSERT INTO tail VALUES(1);SELECT after;', { maxRows: 1 });
    expect(f.sent).toEqual(['SELECT many', 'INSERT INTO tail VALUES(1)', 'SELECT after']);
    expect(output.results[0]).toMatchObject({ rows: [{ c0: '第一行' }], truncated: true }); expect(output.results[1].affectedRows).toBe(1);
    expect(output.results[2]).toMatchObject({ rows: [], truncated: true }); expect(output.failure).toBeUndefined();
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({ statementsAttempted: 3, statementsCompleted: 3, reachedEnd: true, errors: [] });
  });
  it('第100条失败完整保存后停，不能把第101条悄悄丢掉或再执行', async () => {
    const f = fixture(); f.controls.scenario = (_sql, query) => f.fail(query);
    const output = await f.run(Array.from({ length: 101 }, (_, index) => `SELECT bad_${index}`).join(';'));
    const report = queryScriptReportSchema.parse(output.scriptReport); expect(report.errors).toHaveLength(100); expect(report.statementsAttempted).toBe(100);
    expect(report.reachedEnd).toBe(false); expect(report.stopReason).toContain('100'); expect(f.sent).toHaveLength(100); expect(driver.execute).toHaveBeenCalledTimes(99);
  });
  it('200结果预算在整批共用，到达显示上限后仍投递第201条', async () => {
    const f = fixture(), output = await f.run(Array.from({ length: 201 }, (_, index) => `SELECT result_${index}`).join(';'));
    expect(f.sent).toHaveLength(201); expect(output.results).toHaveLength(200);
    expect(queryScriptReportSchema.parse(output.scriptReport)).toMatchObject({ statementsAttempted: 201, statementsCompleted: 201, reachedEnd: true, errors: [] });
    expect(output.failure).toBeUndefined(); expect(driver.execute).not.toHaveBeenCalled();
  });
  it('类型参数先分类原ERR后脱敏，报告/失败/stopReason/事件不包含展开秘密', async () => {
    const f = fixture(), secret = '不得泄漏秘密😀'; let count = 0;
    f.controls.scenario = (_sql, query) => ++count === 1 ? f.fail(query, serverError(secret, { sqlMessage: secret, sql: secret })) : f.ok(query, ['后续成功']);
    const output = await f.run('SELECT :v;SELECT after;', { parameters: [{ name: 'v', type: 'text', value: secret }] });
    expect(output.scriptReport).toMatchObject({ reachedEnd: true, statementsAttempted: 2, statementsCompleted: 1 });
    expect(output.scriptReport?.errors[0].message).toContain('ER_PARSE_ERROR'); expect(JSON.stringify(output)).not.toContain(secret); expect(JSON.stringify(f.events)).not.toContain(secret);
    expect(f.sent).toHaveLength(2); expect(f.sent[0]).not.toBe('SELECT :v'); expect(driver.execute).toHaveBeenCalledTimes(1);
  });
  it('参数恢复失败的stopReason也隐藏错误message/sql/sqlMessage', async () => {
    const f = fixture(), secret = '恢复失败秘密'; f.controls.scenario = (_sql, query) => f.fail(query, serverError(secret));
    f.controls.diagnosticResult = () => { throw Object.assign(Error(secret), { sql: secret, sqlMessage: secret }); };
    const output = await f.run('SELECT :v;DELETE FROM tail;', { parameters: [{ name: 'v', type: 'text', value: secret }] });
    expect(output.scriptReport?.reachedEnd).toBe(false); expect(JSON.stringify(output)).not.toContain(secret); expect(JSON.stringify(f.events)).not.toContain(secret); expect(f.sent).toHaveLength(1);
  });
});
