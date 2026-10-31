import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import { sqliteDriverLimits, type SqliteProcessExit, type SqliteProcessTransport, type SqliteWorkerRequest, type SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteQuerySession } from '../../src/main/sqliteQuerySession';
import type { CommandMap, QueryOutcome, TaskEvent } from '../../src/shared/contracts';

type ExecuteInput = CommandMap['query.execute']['input'];
interface ProcessRecord { child: ChildProcess; kills: number; sent: SqliteWorkerRequest[]; statements: string[]; exited: Promise<SqliteProcessExit>; }
interface Harness { session: SqliteQuerySession; driver: SqliteDriverSession; events: TaskEvent[]; process: ProcessRecord; }
const directories: string[] = [], drivers = new Set<SqliteDriverSession>(), processes: ProcessRecord[] = [];
const executions = new Set<Promise<QueryOutcome>>();
let bundleDirectory: string, worker: string, retained = false;

/** 只用于观察真实worker已投递结果头，不替代原生查询、结果或终态。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-query-build-')); worker = join(bundleDirectory, 'worker.cjs');
  await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' });
});
/** 只清理本测试独占且已关闭的准确临时目录；失败保留原磁盘现场。 */
function removeDirectory(directory: string) {
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-query-')).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const driver of drivers) if (driver.isBusy) await driver.cancel();
  // 原生取消事实可能早于结果消费者终态；等待原execute后才能发正常close，失败也不丢准确进程。
  await Promise.allSettled([...executions]);
  for (const driver of drivers) await driver.close(); drivers.clear();
  for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 所有库均在本例新建目录内，原生SQLite直接操作磁盘，不使用用户配置和文件。 */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-query-')); directories.push(directory);
  const path = join(directory, 'sample.sqlite'), db = new DatabaseSync(path);
  try { db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)'); } finally { db.close(); }
  return path;
}
/** 创建真实Node子进程；记录原发送消息以证明拒绝分支没有投递SQL或偷偷重连。 */
function transport(): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, kills: 0, sent: [], statements: [], exited: new Promise<SqliteProcessExit>(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))) }; processes.push(record);
  return {
    send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); },
    onMessage(listener) { const receive = (message: SqliteWorkerResponse) => { if (message.kind === 'statement') record.statements.push(message.sql); listener(message); }; child.on('message', receive); return () => child.off('message', receive); },
    terminate: () => { record.kills++; return child.kill(); }, exited: record.exited,
  };
}
/** 适配器只接收已经打开的真实driver；事件观察器可故意拒绝发布以验证step前撤销。 */
async function open(path: string, observe?: (event: TaskEvent) => void, readOnly = false): Promise<Harness> {
  const driver = await SqliteDriverSession.open(transport, { path, readOnly, busyTimeoutMs: 100 }); drivers.add(driver);
  const events: TaskEvent[] = [];
  const session = new SqliteQuerySession('磁盘库连接', driver, event => { events.push(structuredClone(event)); observe?.(event); });
  return { session, driver, events, process: processes.at(-1)! };
}
/** 通过原query.execute输入合同发送SQL，默认每次生成不同task编号。 */
function execute(harness: Harness, sql: string, options: Partial<ExecuteInput> = {}) {
  const pending = harness.session.execute({ sessionId: harness.session.sessionId, taskId: randomUUID(), sql, maxRows: 1000, ...options });
  executions.add(pending); void pending.then(() => executions.delete(pending), () => executions.delete(pending)); return pending;
}
/** 独立物理连接核对已提交磁盘值，不能用待验会话缓存证明隔离或回滚。 */
function diskValue(path: string, sql: string): unknown {
  const db = new DatabaseSync(path); try { return Object.values(db.prepare(sql).get()!)[0]; } finally { db.close(); }
}

describe('SQLite原查询会话与真实磁盘driver适配', () => {
  it('原TaskEvent头、批次和唯一终态保持顺序，QueryOutcome重复列及数值精度不丢失', async () => {
    const harness = await open(fixture()), taskId = '精度查询';
    const sql = "SELECT 9223372036854775807 AS duplicate,-9223372036854775808 AS duplicate,1.25,-0.0,1e999,'9007199254740993',x'00ff',NULL,'中文🚢'";
    const outcome = await execute(harness, sql, { taskId });
    expect(outcome.failure).toBeUndefined(); expect(outcome.transactionOpen).toBe(false); expect(outcome.results).toHaveLength(1);
    const result = outcome.results[0];
    expect(result.columns.map(column => column.key)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
    expect(result.columns.slice(0, 2)).toEqual([{ key: 'c0', name: 'duplicate', type: 'SQLITE' }, { key: 'c1', name: 'duplicate', type: 'SQLITE' }]);
    expect(result.rows).toEqual([{ c0: '9223372036854775807', c1: '-9223372036854775808', c2: '1.25', c3: '-0', c4: 'Infinity', c5: '9007199254740993', c6: { type: 'binary', base64: 'AP8=' }, c7: null, c8: '中文🚢' }]);
    expect(result.truncated).toBe(false); expect(result.statement).toBe(sql); expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(harness.events).toHaveLength(4);
    expect(harness.events[0]).toMatchObject({ taskId, status: 'running', executionDatabase: { state: 'known', database: 'main' } });
    expect(harness.events[1]).toMatchObject({ taskId, status: 'running', resultIndex: 0, executionSql: sql, columns: result.columns });
    expect(harness.events[2]).toMatchObject({ taskId, status: 'running', resultIndex: 0, rows: 1, batch: result.rows });
    expect(harness.events[3]).toMatchObject({ taskId, status: 'completed', progress: 100, rows: 1 });
    expect(harness.events.filter(event => event.status !== 'running')).toHaveLength(1);
    expect(harness.session.completionState()).toMatchObject({ database: 'main', databaseKnown: true, dialect: 'sqlite', broken: false, busy: false, serverVersion: harness.driver.version });
  });

  it('脚本首错仅返回原生确认的完整前序，失败语句已流式发布的部分行不冒充完整结果', async () => {
    const path = fixture(), harness = await open(path);
    await execute(harness, `WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<250) INSERT INTO subject SELECT x,CASE WHEN x=220 THEN '无效JSON' ELSE '{"n":1}' END FROM n`);
    harness.events.length = 0;
    const outcome = await execute(harness, "BEGIN; INSERT INTO subject VALUES(1000,'{}'); SELECT 7 AS prior; SELECT json_extract(note,'$.n') AS item FROM subject ORDER BY id; INSERT INTO subject VALUES(1001,'不得执行')");
    expect(outcome.failure).toMatchObject({ statementOrdinal: 4, statementsCompleted: 3 });
    expect(outcome.results).toHaveLength(3); expect(outcome.results[1].affectedRows).toBe(1); expect(outcome.results[2].rows).toEqual([{ c0: '7' }]);
    expect(harness.events.some(event => event.resultIndex === 3 && event.batch?.length === 200)).toBe(true);
    expect(harness.events.at(-1)?.status).toBe('failed'); expect(harness.events.some(event => event.status === 'completed')).toBe(false);
    expect(outcome.transactionOpen).toBe(true); expect(harness.session.state()).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(251);
    expect((await execute(harness, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '252' }]);
    await harness.session.transaction({ sessionId: harness.session.sessionId, action: 'rollback' });
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(251);
  });

  it('maxRows约束整个脚本而非每个结果集，RETURNING截断后仍完整写入', async () => {
    const path = fixture(), harness = await open(path);
    const outcome = await execute(harness, "SELECT 1 UNION ALL SELECT 2; INSERT INTO subject SELECT value,NULL FROM json_each('[1,2,3,4,5]') RETURNING id; SELECT '最后结果'", { maxRows: 3 });
    expect(outcome.failure).toBeUndefined(); expect(outcome.results.map(result => result.rows.length)).toEqual([2, 1, 0]);
    expect(outcome.results.map(result => result.truncated)).toEqual([false, true, true]);
    expect(outcome.results[1].affectedRows).toBe(5); expect(outcome.results[1].rows).toEqual([{ c0: '1' }]);
    expect(harness.events.reduce((count, event) => count + (event.batch?.length ?? 0), 0)).toBe(3);
    expect(harness.events.at(-1)).toMatchObject({ status: 'completed', rows: 3 });
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(5); expect(diskValue(path, 'PRAGMA integrity_check')).toBe('ok');
  });

  it('两个真实物理会话保持临时表与事务隔离，提交后另一会话才看到主库变化', async () => {
    const path = fixture(), first = await open(path), second = await open(path);
    expect(first.process.child.pid).not.toBe(second.process.child.pid);
    await execute(first, "CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(8); BEGIN; INSERT INTO subject VALUES(1,'第一会话未提交')");
    expect((await execute(first, 'SELECT n FROM marker')).results[0].rows).toEqual([{ c0: '8' }]);
    const missing = await execute(second, 'SELECT n FROM marker'); expect(missing.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0 }); expect(missing.results).toEqual([]);
    expect((await execute(second, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '0' }]);
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    expect(first.session.state().transactionOpen).toBe(true); expect(second.session.state().transactionOpen).toBe(false);
    await first.session.transaction({ sessionId: first.session.sessionId, action: 'commit' });
    expect((await execute(second, 'SELECT id,note FROM subject')).results[0].rows).toEqual([{ c0: '1', c1: '第一会话未提交' }]);
  });

  it('第201个结果前停止，保留200份完整前序且不执行后续写入', async () => {
    const path = fixture(), harness = await open(path);
    const sql = Array.from({ length: 200 }, (_value, index) => 'SELECT ' + index).join(';') + "; INSERT INTO subject VALUES(1,'第201条不得执行'); SELECT 999";
    const outcome = await execute(harness, sql);
    expect(outcome.results).toHaveLength(200); expect(outcome.results[199].rows).toEqual([{ c0: '199' }]);
    expect(outcome.failure).toMatchObject({ statementOrdinal: 201, statementsCompleted: 200, message: 'SQLite结果集数量超过200，后续语句尚未执行' });
    expect(harness.events.filter(event => event.columns)).toHaveLength(200);
    expect(harness.events.filter(event => event.status !== 'running').map(event => event.status)).toEqual(['failed']);
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); expect(harness.driver.isUsable).toBe(true);
  });

  it('重复BEGIN及延迟外键COMMIT失败保留真实事务位，不偷偷回滚或重放', async () => {
    const path = fixture(), harness = await open(path), sessionId = harness.session.sessionId;
    await execute(harness, 'CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(pid INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)');
    await harness.session.transaction({ sessionId, action: 'begin' });
    await expect(harness.session.transaction({ sessionId, action: 'begin' })).rejects.toBeInstanceOf(SqliteDriverError);
    expect(harness.session.state()).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    await execute(harness, 'INSERT INTO child VALUES(9)');
    await expect(harness.session.transaction({ sessionId, action: 'commit' })).rejects.toBeInstanceOf(SqliteDriverError);
    expect(harness.session.state()).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    expect(diskValue(path, 'SELECT count(*) FROM child')).toBe(0);
    expect((await execute(harness, 'SELECT count(*) FROM child')).results[0].rows).toEqual([{ c0: '1' }]);
    await execute(harness, 'INSERT INTO parent VALUES(9)'); await harness.session.transaction({ sessionId, action: 'commit' });
    expect(harness.session.state()).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
    expect(diskValue(path, 'SELECT count(*) FROM parent')).toBe(1); expect(diskValue(path, 'SELECT count(*) FROM child')).toBe(1);
    expect(harness.process.sent.filter(message => message.kind === 'execute' && message.sql === 'COMMIT')).toHaveLength(2);
    expect(harness.process.sent.some(message => message.kind === 'execute' && message.sql === 'ROLLBACK')).toBe(false);
  });

  it('两个不支持选项及错误session在任何SQL投递前拒绝', async () => {
    const path = fixture(), harness = await open(path), baseline = harness.process.sent.length;
    for (const options of [{ continueOnError: true }, { collectWarnings: true }]) {
      await expect(execute(harness, "INSERT INTO subject VALUES(1,'不得执行')", options)).rejects.toThrow('尚未接入');
    }
    await expect(execute(harness, "INSERT INTO subject VALUES(2,'错误会话')", { sessionId: '另一会话' })).rejects.toThrow('关闭或失效');
    await expect(harness.session.transaction({ sessionId: '另一会话', action: 'begin' })).rejects.toThrow('关闭或失效');
    expect(harness.process.sent).toHaveLength(baseline); expect(harness.events).toEqual([]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('当前INSERT仅发精确原文及空绑定，前后写哨兵/SET/副作用PRAGMA均未执行，事件只含所选语句', async () => {
    const path = fixture(), harness = await open(path), chosen = "--前置中文🚢注释\r\nINSERT INTO subject VALUES(2,'只执行当前')";
    const prefix = "PRAGMA user_version=123; SET impossible='不得预演'; INSERT INTO subject VALUES(1,'前哨兵');\r\n  ", sql = prefix + chosen + ";\r\nINSERT INTO subject VALUES(3,'后哨兵'); PRAGMA user_version=456;";
    const outcome = await execute(harness, sql, { currentStatement: { offset: prefix.length + chosen.indexOf('VALUES') } });
    const native = "INSERT INTO subject VALUES(2,'只执行当前')";
    expect(outcome.failure).toBeUndefined(); expect(outcome.results).toHaveLength(1); expect(outcome.results[0]).toMatchObject({ statement: native, affectedRows: 1 });
    expect(harness.process.sent.filter(message => message.kind === 'execute')).toHaveLength(1); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: chosen, parameters: [] });
    expect(harness.process.statements).toEqual([native]); expect(harness.events.filter(event => event.executionSql).map(event => event.executionSql)).toEqual([native]); expect(diskValue(path, 'SELECT group_concat(id) FROM subject')).toBe('2'); expect(diskValue(path, 'PRAGMA user_version')).toBe(0);
  });

  it('当前SELECT保持64位/REAL/TEXT/NULL/BLOB精度，原生语法失败准确映射全文UTF16且前序0', async () => {
    const path = fixture(), harness = await open(path), chosen = "SELECT 9223372036854775807,-9223372036854775808,1.25,-0.0,1e999,'中文🚢',x'00ff',NULL", prefix = "SELECT '前🧭';\r\n";
    const outcome = await execute(harness, prefix + chosen + ';\r\nSELECT 99;', { currentStatement: { offset: prefix.length + 3 } });
    expect(outcome.results[0].rows).toEqual([{ c0: '9223372036854775807', c1: '-9223372036854775808', c2: '1.25', c3: '-0', c4: 'Infinity', c5: '中文🚢', c6: { type: 'binary', base64: 'AP8=' }, c7: null }]); expect(outcome.results[0].statement).toBe(chosen);
    const invalid = "SELEC '只失败当前🚢'", full = prefix + 'SELECT 8;\r\n' + invalid + ";\r\nINSERT INTO subject VALUES(5,'不得写')", start = (prefix + 'SELECT 8;\r\n').length; harness.events.length = 0;
    const failure = await execute(harness, full, { currentStatement: { offset: start + 2 } }); expect(failure).toMatchObject({ results: [], transactionOpen: false, failure: { statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start, end: start + invalid.length } } });
    expect(full.slice(failure.failure!.sourceRange!.start, failure.failure!.sourceRange!.end)).toBe(invalid); expect(harness.events.some(event => event.executionSql)).toBe(false); expect(harness.events.at(-1)?.status).toBe('failed'); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it.each(['\u00A0', '\u2003', '\v'])('当前非法SQLite空白前缀%s不被改写成可写INSERT，保原失败范围且零磁盘写', async invalid => {
    const path = fixture(), harness = await open(path), selected = invalid + "INSERT INTO subject VALUES(1,'不得静默去前缀')", prefix = 'SELECT 0;\r\n', source = prefix + selected + ";INSERT INTO subject VALUES(2,'后哨兵');";
    const outcome = await execute(harness, source, { currentStatement: { offset: prefix.length + 3 } });
    expect(outcome).toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start: prefix.length, end: prefix.length + selected.length } } }); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: selected, parameters: [] }); expect(harness.events.some(event => event.executionSql)).toBe(false); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('普通脚本VT前缀也交原生拒绝，skipTrivia不得静默去掉后写入', async () => {
    const path = fixture(), harness = await open(path), sql = "\vINSERT INTO subject VALUES(1,'不得去掉VT'); INSERT INTO subject VALUES(2,'不得继续')";
    const outcome = await execute(harness, sql); expect(outcome).toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0 } }); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql }); expect(harness.events.some(event => event.executionSql)).toBe(false); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('BOM首部及标准ASCII空白正常SELECT，unquoted alias末尾BOM和关键词内部BOM不被删除', async () => {
    const path = fixture(), harness = await open(path), leading = '\uFEFF\t\n\f\r ', selected = 'SELECT 1 AS alias\uFEFF', source = leading + selected + ' \t\r\n;SELECT 9;';
    const outcome = await execute(harness, source, { currentStatement: { offset: leading.length + 2 } }); expect(outcome.failure).toBeUndefined(); expect(outcome.results[0]).toMatchObject({ rows: [{ c0: '1' }], columns: [{ key: 'c0', name: 'alias\uFEFF', type: 'SQLITE' }], statement: selected }); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: selected, parameters: [] }); expect(harness.process.statements).toEqual([selected]);
    expect((await execute(harness, 'SELECT \uFEFF1 AS n;', { currentStatement: { offset: 3 } })).results[0].rows).toEqual([{ c0: '1' }]);
    const invalid = 'SELECT\uFEFF1', failure = await execute(harness, invalid + ';', { currentStatement: { offset: 3 } }); expect(failure).toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start: 0, end: invalid.length } } }); expect(harness.process.sent.filter(message => message.kind === 'execute').at(-1)).toMatchObject({ sql: invalid, parameters: [] });
  });

  it('trigger正文光标创建完整TEMPORARY IF NOT EXISTS多语句trigger，CASE END/AS end/begin字段原生可用', async () => {
    const path = fixture(), harness = await open(path); await execute(harness, 'CREATE TABLE audit(begin TEXT,n INTEGER)'); harness.events.length = 0;
    const chosen = "CREATE TEMPORARY TRIGGER IF NOT EXISTS \"触\"\"发\" AFTER INSERT ON subject WHEN NEW.id>0 BEGIN\r\n INSERT INTO audit(begin,n) SELECT NEW.note,CASE WHEN NEW.id>0 THEN 7 ELSE 0 END AS end;\r\n UPDATE subject SET note=note||':触发' WHERE id=NEW.id;\r\n END";
    const source = "INSERT INTO subject VALUES(1,'前哨兵');\r\n" + chosen + ";\r\nINSERT INTO subject VALUES(2,'后哨兵');";
    const outcome = await execute(harness, source, { currentStatement: { offset: source.indexOf('CASE WHEN') } }); expect(outcome.failure).toBeUndefined(); expect(outcome.results).toHaveLength(1); expect(outcome.results[0].statement).toBe(chosen); expect(harness.events.filter(event => event.executionSql).map(event => event.executionSql)).toEqual([chosen]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    await execute(harness, "INSERT INTO subject VALUES(3,'真实触发')"); expect(diskValue(path, 'SELECT note FROM subject WHERE id=3')).toBe('真实触发:触发'); expect(diskValue(path, 'SELECT begin FROM audit')).toBe('真实触发'); expect(diskValue(path, 'SELECT n FROM audit')).toBe(7);
    const explain = 'EXPLAIN CREATE TRIGGER explained AFTER INSERT ON subject BEGIN SELECT CASE WHEN 1 THEN 2 END AS end; END', plan = await execute(harness, 'SELECT 0;\r\n' + explain + ';SELECT 9;', { currentStatement: { offset: 'SELECT 0;\r\n'.length + explain.indexOf('CASE') } });
    expect(plan.failure).toBeUndefined(); expect(plan.results).toHaveLength(1); expect(plan.results[0].statement).toBe(explain); expect(diskValue(path, "SELECT count(*) FROM sqlite_schema WHERE name='explained'")).toBe(0);
  });

  it('原活动事务内current写入不执行脚本COMMIT，双物理会话隔离并由明确ROLLBACK收尾', async () => {
    const path = fixture(), first = await open(path), second = await open(path); await first.session.transaction({ sessionId: first.session.sessionId, action: 'begin' });
    const selected = "INSERT INTO subject VALUES(2,'原事务当前写')", prefix = "INSERT INTO subject VALUES(1,'前哨兵');\r\n", sql = prefix + selected + ";COMMIT;INSERT INTO subject VALUES(3,'后哨兵');";
    expect((await execute(first, sql, { currentStatement: { offset: prefix.length + 1 } })).transactionOpen).toBe(true); expect(first.session.state()).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    expect((await execute(first, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '1' }]); expect((await execute(second, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '0' }]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    expect(first.process.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false); await first.session.transaction({ sessionId: first.session.sessionId, action: 'rollback' }); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('current RETURNING保留总行预算且完整drain写入，前后哨兵不因结果截断执行', async () => {
    const path = fixture(), harness = await open(path), chosen = "INSERT INTO subject SELECT value,NULL FROM json_each('[1,2,3,4,5]') RETURNING id", prefix = "INSERT INTO subject VALUES(90,'前');\n";
    const outcome = await execute(harness, prefix + chosen + ";INSERT INTO subject VALUES(99,'后');", { maxRows: 2, currentStatement: { offset: prefix.length + 3 } });
    expect(outcome.failure).toBeUndefined(); expect(outcome.results).toHaveLength(1); expect(outcome.results[0]).toMatchObject({ rows: [{ c0: '1' }, { c0: '2' }], truncated: true, affectedRows: 5, statement: chosen }); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(5); expect(diskValue(path, 'SELECT max(id) FROM subject')).toBe(5);
  });

  it('readonly current读取成功，写入及副作用PRAGMA仍按原authorizer拒绝并保失败范围', async () => {
    const path = fixture(), harness = await open(path, undefined, true), prefix = 'PRAGMA user_version=123;\r\n', chosen = 'SELECT 9223372036854775807';
    expect((await execute(harness, prefix + chosen + ';', { currentStatement: { offset: prefix.length + 1 } })).results[0].rows).toEqual([{ c0: '9223372036854775807' }]); expect(diskValue(path, 'PRAGMA user_version')).toBe(0);
    for (const selected of ["INSERT INTO subject VALUES(1,'拒写')", 'PRAGMA user_version=777']) { const source = 'SELECT 0;\r\n' + selected + ';SELECT 9;', start = 'SELECT 0;\r\n'.length; const failure = await execute(harness, source, { currentStatement: { offset: start + 1 } }); expect(failure).toMatchObject({ results: [], failure: { statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start, end: start + selected.length } } }); }
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); expect(diskValue(path, 'PRAGMA user_version')).toBe(0); expect(harness.driver.isUsable).toBe(true);
  });

  it('无SQL/非法offset/CRLF代理对内/后部未闭合及超预算全文在零用户SQL投递时拒绝', async () => {
    const path = fixture(), harness = await open(path), baseline = harness.process.sent.length;
    for (const [sql, offset] of [[' --只有注释', 5], ['  SELECT 1;', 0], ['SELECT 1;  SELECT 2;', 10], ['SELECT 1', -1], ['SELECT 1', 1.5], ['SELECT 1;\r\nSELECT 2;', 10], ["SELECT '🚢'; SELECT 2;", 9], ["SELECT 1; SELECT '未闭合", 1], ['SELECT 1; CREATE TRIGGER t AFTER INSERT ON subject BEGIN SELECT 2;', 1]] as const) await expect(execute(harness, sql, { currentStatement: { offset } })).rejects.toThrow();
    await expect(execute(harness, 'SELECT 1;' + ' '.repeat(20 * 1024 * 1024), { currentStatement: { offset: 1 } })).rejects.toThrow('预算');
    expect(harness.process.sent).toHaveLength(baseline); expect(harness.events).toEqual([]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('DELIMITER及SQLite不支持的过程源码在body光标也零execute，引用和注释中的相同文字不误拒', async () => {
    const path = fixture(), harness = await open(path), baseline = harness.process.sent.length;
    for (const source of ['DELIMITER $$\r\nCREATE TRIGGER t AFTER INSERT ON subject BEGIN INSERT INTO subject VALUES(1,\'前\'); INSERT INTO subject VALUES(2,\'body不得裸执行\'); END$$', 'CREATE PROCEDURE p() BEGIN SELECT 1; INSERT INTO subject VALUES(2,\'body不得裸执行\'); END;', 'CREATE FUNCTION f() RETURNS INT BEGIN SELECT 1; INSERT INTO subject VALUES(2,\'body不得裸执行\'); END;', 'CREATE EVENT e DO BEGIN SELECT 1; INSERT INTO subject VALUES(2,\'body不得裸执行\'); END;']) await expect(execute(harness, source, { currentStatement: { offset: source.indexOf('body不得裸执行') } })).rejects.toThrow(/DELIMITER|CREATE/);
    expect(harness.process.sent).toHaveLength(baseline); expect(harness.events).toEqual([]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    const selected = "--DELIMITER $$不是指令\r\nSELECT 'DELIMITER', 'CREATE PROCEDURE'", source = selected + ';SELECT 99;';
    expect((await execute(harness, source, { currentStatement: { offset: source.indexOf("'DELIMITER'") } })).results[0].rows).toEqual([{ c0: 'DELIMITER', c1: 'CREATE PROCEDURE' }]);
  });

  it('超过driver目录语句数的全文仍只发送一条current，后部未闭合时不再投递任何用户SQL', async () => {
    const path = fixture(), harness = await open(path), prefix = 'SELECT 0;'.repeat(sqliteDriverLimits.statements + 7), chosen = "INSERT INTO subject VALUES(1,'大脚本当前')", source = prefix + chosen + ";INSERT INTO subject VALUES(2,'后哨兵');";
    expect((await execute(harness, source, { currentStatement: { offset: prefix.length + 2 } })).results[0]).toMatchObject({ affectedRows: 1, statement: chosen }); expect(harness.process.sent.filter(message => message.kind === 'execute')).toHaveLength(1); expect(diskValue(path, 'SELECT group_concat(id) FROM subject')).toBe('1');
    const baseline = harness.process.sent.length, events = harness.events.length; await expect(execute(harness, source + "SELECT '末尾未闭合", { currentStatement: { offset: prefix.length + 2 } })).rejects.toThrow('未闭合'); expect(harness.process.sent).toHaveLength(baseline); expect(harness.events).toHaveLength(events); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(1);
  });

  it('当前切片包含前后注释时只按真实native statement头发布事件/结果，绝不以模板补造历史SQL', async () => {
    const path = fixture(), harness = await open(path), selected = '--前置说明\r\nSELECT 7 /*尾块注释*/ --尾行注释', prefix = "INSERT INTO subject VALUES(1,'前哨兵');\r\n";
    const source = prefix + selected + "\r\n;INSERT INTO subject VALUES(2,'后哨兵');", outcome = await execute(harness, source, { currentStatement: { offset: prefix.length + selected.indexOf('SELECT') + 2 } });
    expect(outcome.failure).toBeUndefined(); expect(outcome.results[0].rows).toEqual([{ c0: '7' }]); expect(harness.process.sent.filter(message => message.kind === 'execute')).toHaveLength(1); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: selected, parameters: [] });
    expect(harness.process.statements).toHaveLength(1); const native = harness.process.statements[0]; expect(native.startsWith('SELECT 7')).toBe(true); expect(native).not.toContain('前置说明'); expect(outcome.results[0].statement).toBe(native); expect(harness.events.filter(event => event.executionSql).map(event => event.executionSql)).toEqual([native]); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
  });

  it('current长SUM准确取消只终止原utility，原活动事务回滚且不执行前后SQL或重连', async () => {
    const path = fixture(), started = deferred<void>(), chosen = 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n';
    const harness = await open(path, event => { if (event.taskId === '当前句精确取消' && event.executionSql === chosen) started.resolve(); });
    await execute(harness, "BEGIN; INSERT INTO subject VALUES(1,'未提交')", { taskId: '旧任务' });
    const prefix = "INSERT INTO subject VALUES(2,'前哨兵');\r\n", count = processes.length, execution = execute(harness, prefix + chosen + ";COMMIT;INSERT INTO subject VALUES(3,'后哨兵');", { taskId: '当前句精确取消', currentStatement: { offset: prefix.length + chosen.indexOf('sum(x)') } }).catch(reason => reason);
    await started.promise; await delay(50); const sent = harness.process.sent.length; expect(await harness.session.cancel('旧任务')).toBeUndefined(); expect(harness.process.sent).toHaveLength(sent);
    expect(await harness.session.cancel('当前句精确取消')).toEqual({ mode: 'process-terminated', sessionClosed: true, transaction: null, resources: 'confirmed' }); expect(await execution).toMatchObject({ code: 'SQLITE_CANCELLED_SESSION_CLOSED', completedStatements: 0, sessionClosed: true });
    expect(harness.process.kills).toBe(1); expect(processes).toHaveLength(count); expect(harness.session.state()).toEqual({ transactionOpen: false, transactionKnown: false, broken: true }); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); expect(harness.events.filter(event => event.taskId === '当前句精确取消' && event.status !== 'running').map(event => event.status)).toEqual(['cancelled']); expect(harness.process.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false);
  });

  it('旧task取消及busy请求不干扰当前执行；阻塞强取消后会话broken且事务未知，不重连', async () => {
    const path = fixture(), started = deferred<void>();
    const harness = await open(path, event => { if (event.taskId === '当前阻塞查询' && event.executionSql?.includes('sum(x)')) started.resolve(); if (event.taskId === '当前阻塞查询' && event.status === 'cancelled') throw Error('取消终态通知失败不得覆盖原事实'); });
    await execute(harness, 'SELECT 1', { taskId: '旧任务' });
    const execution = execute(harness, "BEGIN; INSERT INTO subject VALUES(1,'未提交'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n", { taskId: '当前阻塞查询' }).catch(reason => reason);
    await started.promise; await delay(50);
    const sent = harness.process.sent.length, processCount = processes.length;
    expect(await harness.session.cancel('旧任务')).toBeUndefined(); expect(harness.process.sent).toHaveLength(sent); expect(harness.process.kills).toBe(0);
    expect(harness.session.state()).toMatchObject({ transactionKnown: false, broken: false });
    expect(harness.session.completionState()).toMatchObject({ databaseKnown: false, busy: true, broken: false });
    await expect(execute(harness, "INSERT INTO subject VALUES(2,'忙态不得执行')")).rejects.toThrow('已有运行操作');
    await expect(harness.session.transaction({ sessionId: harness.session.sessionId, action: 'commit' })).rejects.toThrow('已有运行操作');
    await expect(harness.session.close()).rejects.toThrow('仍有运行操作'); expect(harness.process.sent).toHaveLength(sent);
    expect(await harness.session.cancel('当前阻塞查询')).toEqual({ mode: 'process-terminated', sessionClosed: true, transaction: null, resources: 'confirmed' });
    expect(await execution).toMatchObject({ code: 'SQLITE_CANCELLED_SESSION_CLOSED', transaction: null, sessionClosed: true, completedStatements: 2 });
    expect(harness.session.notificationFailed).toBe(true);
    expect(harness.process.kills).toBe(1); expect(harness.session.state()).toEqual({ transactionOpen: false, transactionKnown: false, broken: true });
    expect(harness.session.completionState()).toMatchObject({ databaseKnown: false, broken: true, busy: false });
    expect(harness.events.filter(event => event.taskId === '当前阻塞查询' && event.status !== 'running').map(event => event.status)).toEqual(['cancelled']);
    const afterCancel = harness.process.sent.length;
    await expect(execute(harness, 'SELECT 3')).rejects.toThrow('不会自动重连');
    await expect(harness.session.transaction({ sessionId: harness.session.sessionId, action: 'rollback' })).rejects.toThrow('不会自动重连');
    expect(harness.process.sent).toHaveLength(afterCancel); expect(processes).toHaveLength(processCount);
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); expect(diskValue(path, 'PRAGMA integrity_check')).toBe('ok');
    await harness.session.close();
  });

  it('结果头消费者发布失败在原生step前撤销写入，原物理会话仍可明确发新请求', async () => {
    const path = fixture(); let rejected = false;
    const harness = await open(path, event => { if (event.columns && !rejected) { rejected = true; throw Error('本例拒绝结果头发布'); } });
    await expect(execute(harness, "INSERT INTO subject VALUES(1,'不得写入')")).rejects.toMatchObject({ code: 'SQLITE_CONSUMER_FAILED', completedStatements: 0, sessionClosed: false });
    expect(rejected).toBe(true); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    expect(harness.events.filter(event => event.status !== 'running').map(event => event.status)).toEqual(['failed']);
    expect(harness.driver.isUsable).toBe(true); expect(harness.driver.isBusy).toBe(false); expect(harness.process.kills).toBe(0);
    expect((await execute(harness, 'SELECT 2')).results[0].rows).toEqual([{ c0: '2' }]);
  });

  it.each(['completed', 'failed'] as const)('%s终态通知失败不覆盖数据库事实、不补发另一个终态或自动重放', async terminal => {
    const path = fixture(), harness = await open(path, event => { if (event.status === terminal) throw Error('本例终态接收端失效'); });
    const sql = terminal === 'completed' ? "INSERT INTO subject VALUES(1,'真实提交')" : "BEGIN; INSERT INTO subject VALUES(1,'未提交'); INSERT INTO subject VALUES(1,'冲突')";
    const outcome = await execute(harness, sql);
    expect(harness.session.notificationFailed).toBe(true); expect(harness.driver.isUsable).toBe(true);
    expect(harness.events.filter(event => event.status !== 'running').map(event => event.status)).toEqual([terminal]);
    if (terminal === 'completed') { expect(outcome.failure).toBeUndefined(); expect(outcome.results[0].affectedRows).toBe(1); expect(outcome.transactionOpen).toBe(false); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(1); }
    else { expect(outcome.failure).toMatchObject({ statementOrdinal: 3, statementsCompleted: 2 }); expect(outcome.results).toHaveLength(2); expect(outcome.results[1].affectedRows).toBe(1); expect(outcome.transactionOpen).toBe(true); expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); }
    const count = harness.process.sent.length;
    await expect(execute(harness, "INSERT INTO subject VALUES(2,'不得重放')")).rejects.toThrow('界面通知失败');
    expect(harness.process.sent).toHaveLength(count);
    if (terminal === 'failed') {
      await expect(harness.session.transaction({ sessionId: harness.session.sessionId, action: 'commit' })).rejects.toThrow('界面通知失败');
      expect(harness.process.sent).toHaveLength(count);
      await harness.session.transaction({ sessionId: harness.session.sessionId, action: 'rollback' });
      expect(harness.session.state()).toEqual({ transactionOpen: false, transactionKnown: true, broken: false });
      expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0);
    }
    await harness.session.close();
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(terminal === 'completed' ? 1 : 0);
  });

  it('正常close只关闭准确进程且等待原生握手退出，未提交事务回滚，重复close不重发', async () => {
    const path = fixture(), harness = await open(path), other = await open(path);
    await execute(harness, "BEGIN; INSERT INTO subject VALUES(1,'关闭时未提交')");
    const closing = harness.session.close(); expect(harness.session.close()).toBe(closing); await closing;
    expect(await harness.process.exited).toEqual({ code: 0, signal: null }); expect(harness.driver.isClosed).toBe(true); expect(harness.process.kills).toBe(0);
    expect(harness.process.sent.filter(message => message.kind === 'close')).toHaveLength(1); expect(harness.process.sent.filter(message => message.kind === 'closeAck')).toHaveLength(1);
    expect(diskValue(path, 'SELECT count(*) FROM subject')).toBe(0); expect(diskValue(path, 'PRAGMA integrity_check')).toBe('ok');
    expect((await execute(other, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '0' }]); expect(other.driver.isUsable).toBe(true); expect(other.process.kills).toBe(0);
    const baseline = harness.process.sent.length;
    await expect(execute(harness, 'SELECT 1')).rejects.toThrow('关闭或失效'); expect(harness.process.sent).toHaveLength(baseline);
    expect(harness.session.state()).toEqual({ transactionOpen: false, transactionKnown: false, broken: true });
  });
});
