import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { CommandMap, QueryOutcome, SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { sqliteExplainLimits, sqliteExplainMessages } from '../../src/shared/sqliteExplain';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteDriverSession } from '../../src/engine/sqlite/session';
import { sqliteExplainSource } from '../../src/engine/sqlite/explainSource';
import { SqliteQuerySession } from '../../src/main/sqliteQuerySession';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite计划测试必须使用准确真实Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

type ExplainInput = CommandMap['query.explain']['input'];
interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; statements: string[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], drivers = new Set<SqliteDriverSession>(), applications = new Set<SqliteRuntime>(), operations = new Set<Promise<QueryOutcome>>();
let worker: string, bundleDirectory: string, retained = false;
/** 仅同步准确worker原消息，绝不替换SQL/结果/成功或取消终态。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-explain-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 先等原execute及准确进程退出才删独占目录；失败保留本例库/worker现场。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-explain-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const app of applications) await app.forceClose(); applications.clear();
  for (const driver of drivers) if (driver.isBusy) await driver.cancel(); await Promise.allSettled([...operations]);
  for (const driver of drivers) await driver.close(); drivers.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });
/** 原磁盘包含真实索引和触发器；任何误step DML都会改变原行或audit。 */
function fixture(): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-explain-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path);
  try { db.exec("PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT); CREATE INDEX index_note ON subject(note); INSERT INTO subject VALUES(1,'甲'),(2,'乙'); CREATE TABLE audit(note TEXT); CREATE TRIGGER inserted AFTER INSERT ON subject BEGIN INSERT INTO audit VALUES(NEW.note); END; CREATE TRIGGER updated AFTER UPDATE ON subject BEGIN INSERT INTO audit VALUES(NEW.note); END; CREATE TRIGGER deleted AFTER DELETE ON subject BEGIN INSERT INTO audit VALUES(OLD.note); END"); } finally { db.close(); }
  return { id: '计划真实源', name: 'SQLite计划真实磁盘', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 独立原生观察器证明零原语句step，不从待验session缓存推断落盘。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
function state(profile: SqliteConnectionProfile) { return disk(profile, db => ({ rows: db.prepare('SELECT id,note FROM subject ORDER BY id').all(), audit: db.prepare('SELECT count(*) AS n FROM audit').get()!.n, version: db.prepare('PRAGMA user_version').get()!.user_version })); }
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], statements: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => { if (message.kind === 'statement') record.statements.push(message.sql); if (observe) observe(message, () => listener(message)); else listener(message); }; child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
/** 已打开原driver交给查询适配器；暂停/通知失败仅改变消息交付，不造数据库结果。 */
async function open(profile: SqliteConnectionProfile, options: { readOnly?: boolean; observe?: (event: TaskEvent) => void; message?: (message: SqliteWorkerResponse, forward: () => void) => void } = {}) {
  const driver = await SqliteDriverSession.open(() => transport(options.message), { path: profile.sqlite.filePath!, readOnly: options.readOnly ?? false, busyTimeoutMs: 100 }); drivers.add(driver);
  const events: TaskEvent[] = [], session = new SqliteQuerySession(profile.id, driver, event => { events.push(structuredClone(event)); options.observe?.(event); }); return { session, driver, events, process: processes.at(-1)! };
}
function track(work: Promise<QueryOutcome>): Promise<QueryOutcome> { operations.add(work); void work.then(() => operations.delete(work), () => operations.delete(work)); return work; }
function explain(harness: Awaited<ReturnType<typeof open>>, sql: string, options: Partial<ExplainInput> = {}) { return track(harness.session.explain({ sessionId: harness.session.sessionId, taskId: randomUUID(), sql, maxRows: 1000, ...options })); }
function execute(harness: Awaited<ReturnType<typeof open>>, sql: string) { return track(harness.session.execute({ sessionId: harness.session.sessionId, taskId: randomUUID(), sql, maxRows: 1000 })); }
function application(profile: SqliteConnectionProfile, message?: (message: SqliteWorkerResponse, forward: () => void) => void) { const events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: () => transport(message), emit: event => events.push(structuredClone(event)) }); applications.add(app); return { app, events }; }

describe('SQLite计划真实原会话、EQP和零原SQL执行', () => {
  it.each([
    "SELECT id,note FROM subject WHERE note='甲'", "SELECT json_extract(note,'$.n') FROM subject", "VALUES(9223372036854775807,'中文🚢'),(NULL,'')", "WITH chosen AS (SELECT 1 AS id) SELECT subject.note FROM subject JOIN chosen USING(id)",
    "INSERT INTO subject VALUES(3,'不得插入')", "UPDATE subject SET note='不得更新' WHERE id=1", 'DELETE FROM subject WHERE id=2', "REPLACE INTO subject VALUES(1,'不得替换')",
  ])('真实计划%s只执行EQP，不step原读写语句或其trigger', async sql => {
    const profile = fixture(), harness = await open(profile), before = state(profile), outcome = await explain(harness, sql);
    expect(outcome.failure).toBeUndefined(); expect(outcome.sqliteExplain).toMatchObject({ dialect: 'sqlite', version: harness.driver.version, initialView: 'tree', rawTruncated: false }); expect(outcome.results).toHaveLength(1); expect(outcome.results[0].columns.map(column => column.name)).toEqual(['id', 'parent', 'notused', 'detail']);
    expect(harness.process.sent.filter(message => message.kind === 'execute')).toHaveLength(1); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: 'EXPLAIN QUERY PLAN ' + sql, parameters: [], options: { maxRows: 1000, maxBytes: 16 * 1024 * 1024 } });
    expect(harness.process.statements).toEqual(['EXPLAIN QUERY PLAN ' + sql]); expect(outcome.results[0].statement).toBe(harness.process.statements[0]); expect(harness.events.filter(event => event.executionSql).map(event => event.executionSql)).toEqual(harness.process.statements); expect(harness.events.filter(event => event.status !== 'running').map(event => event.status)).toEqual(['completed']); expect(state(profile)).toEqual(before);
    const raw = JSON.parse(outcome.sqliteExplain!.raw); expect(raw.columns).toEqual(['id', 'parent', 'notused', 'detail']); expect(raw.rows).toEqual(outcome.results[0].rows.map(row => outcome.results[0].columns.map(column => row[column.key])));
    for (const node of outcome.sqliteExplain!.nodes) { expect(node.id).toMatch(/^\d+$/); expect(typeof node.auxiliary).toBe('string'); expect(Number.isInteger(node.depth)).toBe(true); expect(typeof node.detail).toBe('string'); }
    if (sql === "SELECT id,note FROM subject WHERE note='甲'") expect(outcome.sqliteExplain!.nodes.some(node => node.detail.includes('index_note'))).toBe(true);
  });

  it('同一原session能计划temp表及活动写事务，另一session不能计划其temp，显式rollback保原库', async () => {
    const profile = fixture(), first = await open(profile), second = await open(profile); await execute(first, 'CREATE TEMP TABLE local_marker(n); INSERT INTO local_marker VALUES(8); BEGIN; INSERT INTO subject VALUES(3,\'未提交\')');
    const before = first.process.sent.filter(message => message.kind === 'execute').length, count = processes.length, plan = await explain(first, 'SELECT subject.note,local_marker.n FROM subject,local_marker WHERE subject.id=3');
    expect(plan.failure).toBeUndefined(); expect(plan.transactionOpen).toBe(true); expect(plan.sqliteExplain?.nodes.length).toBeGreaterThan(0); expect(first.process.sent.filter(message => message.kind === 'execute')).toHaveLength(before + 1); expect(processes).toHaveLength(count);
    const missing = await explain(second, 'SELECT n FROM local_marker'); expect(missing.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0 }); expect(missing.sqliteExplain).toBeUndefined(); expect(second.session.state().transactionOpen).toBe(false);
    expect((await execute(first, 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '3' }]); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM subject').get()!.n)).toBe(2); await first.session.transaction({ sessionId: first.session.sessionId, action: 'rollback' }); expect(state(profile)).toEqual({ rows: [{ id: 1, note: '甲' }, { id: 2, note: '乙' }], audit: 0, version: 0 });
  });

  it('单条range保留注释/CRLF/引用分号与BOM，format text仅切初始视图且结果仍真实四列表', async () => {
    const profile = fixture(), harness = await open(profile), sql = '\uFEFF \r\n--前置说明\r\nSELECT note AS "别;名" FROM subject WHERE id=1 /*尾部;注释*/;\r\n', expected = sqliteExplainSource(sql).sql;
    const outcome = await explain(harness, sql, { format: 'text' }); expect(outcome.failure).toBeUndefined(); expect(outcome.sqliteExplain?.initialView).toBe('table'); expect(harness.process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql: expected, parameters: [] }); expect(outcome.results[0].statement).toBe(harness.process.statements[0]); expect(harness.events.filter(event => event.executionSql).map(event => event.executionSql)).toEqual(harness.process.statements);
    const auto = await explain(harness, 'SELECT note FROM subject WHERE id=1', { format: 'auto' }); expect(auto.sqliteExplain?.initialView).toBe('tree'); expect(auto.sqliteExplain?.version).toMatch(/^\d+\.\d+/);
  });

  it('非白名单/多句/不完整/DELIMITER和非法SQLite空白均在零driver投递时拒绝，不产生history用执行头', async () => {
    const profile = fixture(), harness = await open(profile), baseline = harness.process.sent.length;
    for (const sql of ['PRAGMA user_version=999', 'EXPLAIN SELECT 1', "ATTACH 'other.sqlite' AS other", 'DETACH main', 'CREATE TABLE forbidden(n)', 'BEGIN', 'COMMIT', 'ROLLBACK', 'VACUUM', 'SELECT 1; INSERT INTO subject VALUES(3,\'不得插入\')', '--仅注释', '/*仅注释*/;', "SELECT 1; SELECT '未闭合", 'SELECT (1', 'DELIMITER $$\nSELECT 1$$', '\u00A0INSERT INTO subject VALUES(3,\'不得修剪\')', '\vINSERT INTO subject VALUES(3,\'不得修剪\')']) await expect(explain(harness, sql)).rejects.toThrow();
    expect(harness.process.sent).toHaveLength(baseline); expect(harness.process.statements).toEqual([]); expect(harness.events).toEqual([]); expect(state(profile)).toEqual({ rows: [{ id: 1, note: '甲' }, { id: 2, note: '乙' }], audit: 0, version: 0 });
    expect((await execute(harness, 'SELECT 7')).results[0].rows).toEqual([{ c0: '7' }]);
  });

  it('readonly SELECT仍能计划，DML按原authorizer拒绝且明确说明，不获得写能力', async () => {
    const profile = fixture(), harness = await open(profile, { readOnly: true }); expect((await explain(harness, 'SELECT * FROM subject')).sqliteExplain?.dialect).toBe('sqlite');
    for (const sql of ["INSERT INTO subject VALUES(3,'拒写')", "UPDATE subject SET note='拒写'", 'DELETE FROM subject', "REPLACE INTO subject VALUES(1,'拒写')"]) { const outcome = await explain(harness, sql); expect(outcome.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0 }); expect(outcome.failure?.message).toContain('原只读会话'); expect(outcome.sqliteExplain).toBeUndefined(); }
    expect(state(profile)).toEqual({ rows: [{ id: 1, note: '甲' }, { id: 2, note: '乙' }], audit: 0, version: 0 }); expect(harness.driver.isUsable).toBe(true);
  });

  it('maxRows取原input与1000较小者，截断成功仍附明确不完整table计划而不伪造树', async () => {
    const profile = fixture(), harness = await open(profile), sql = Array.from({ length: 5 }, () => 'SELECT id FROM subject').join(' UNION ALL '), outcome = await explain(harness, sql, { maxRows: 1 });
    expect(outcome.failure).toBeUndefined(); expect(outcome.results[0].rows).toHaveLength(1); expect(outcome.results[0].truncated).toBe(true); expect(outcome.sqliteExplain).toMatchObject({ initialView: 'table', nodes: [] }); expect(outcome.sqliteExplain?.warnings).toContain(sqliteExplainMessages.truncated);
    await explain(harness, 'SELECT id FROM subject', { maxRows: 100000 }); const requests = harness.process.sent.filter(message => message.kind === 'execute'); expect(requests[0]).toMatchObject({ options: { maxRows: 1 } }); expect(requests.at(-1)).toMatchObject({ options: { maxRows: 1000 } });
  });

  it('真实长alias计划说明超raw预算时保有界前缀及明确warning，不突破16MiB结果门', async () => {
    const profile = fixture(), harness = await open(profile), alias = 'a'.repeat(sqliteExplainLimits.rawBytes + 1000), outcome = await explain(harness, 'SELECT id FROM subject AS "' + alias + '"');
    expect(outcome.failure).toBeUndefined(); const detail = outcome.results[0].rows[0].c3; expect(typeof detail).toBe('string'); expect((detail as string).length).toBeGreaterThan(sqliteExplainLimits.rawBytes); expect(outcome.sqliteExplain).toMatchObject({ initialView: 'table', nodes: [], rawTruncated: true }); expect(Buffer.byteLength(outcome.sqliteExplain!.raw)).toBeLessThanOrEqual(sqliteExplainLimits.rawBytes); expect(outcome.sqliteExplain!.warnings).toContain(sqliteExplainMessages.raw);
  });

  it('原生prepare失败无plan且保完整原输入range，终态通知失败不丢已成功计划并阻新请求', async () => {
    const profile = fixture(), harness = await open(profile), sql = ' \r\nSELECT * FROM absent_table;\r\n', outcome = await explain(harness, sql); expect(outcome.failure).toMatchObject({ statementOrdinal: 1, statementsCompleted: 0, sourceRange: { start: 3, end: sql.indexOf(';') } }); expect(outcome.sqliteExplain).toBeUndefined(); expect(harness.events.at(-1)?.status).toBe('failed');
    const taskId = '计划通知失败', third = await open(profile, { observe: event => { if (event.taskId === taskId && event.status === 'completed') throw Error('本例计划完成通知失败'); } }); await third.session.transaction({ sessionId: third.session.sessionId, action: 'begin' });
    const completed = await explain(third, 'SELECT * FROM subject', { taskId }); expect(completed.sqliteExplain?.dialect).toBe('sqlite'); expect(completed.transactionOpen).toBe(true); expect(third.session.notificationFailed).toBe(true); const count = third.process.sent.length; await expect(explain(third, 'SELECT 1')).rejects.toThrow('通知失败'); await expect(execute(third, 'SELECT 2')).rejects.toThrow('通知失败'); expect(third.process.sent).toHaveLength(count); await third.session.transaction({ sessionId: third.session.sessionId, action: 'rollback' });
  });

  it('准确EQP头暂停时busy/旧task不干扰，协作cancel保原事务，原session显式rollback后仍可计划', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false;
    const harness = await open(profile, { message: (message, forward) => { if (hold && message.kind === 'statement' && message.sql.startsWith('EXPLAIN QUERY PLAN ')) { hold = false; reached.resolve(); } else forward(); } });
    await execute(harness, "BEGIN; INSERT INTO subject VALUES(3,'原事务')"); const taskId = '准确计划取消'; hold = true; const work = explain(harness, 'SELECT * FROM subject', { taskId }); const failure = expect(work).rejects.toMatchObject({ code: 'SQLITE_CANCELLED', completedStatements: 0, sessionClosed: false }); await reached.promise;
    const sent = harness.process.sent.length; expect(await harness.session.cancel('旧任务')).toBeUndefined(); await expect(explain(harness, 'SELECT 1')).rejects.toThrow('运行操作'); await expect(execute(harness, 'SELECT 2')).rejects.toThrow('运行操作'); await expect(harness.session.close()).rejects.toThrow('运行操作'); expect(harness.process.sent).toHaveLength(sent);
    expect(await harness.session.cancel(taskId)).toMatchObject({ mode: 'cooperative', sessionClosed: false, transaction: true, resources: 'confirmed' }); await failure; expect(harness.events.filter(event => event.taskId === taskId && event.status !== 'running').map(event => event.status)).toEqual(['cancelled']); expect(harness.process.kills).toBe(0); expect(harness.session.state().transactionOpen).toBe(true); await harness.session.transaction({ sessionId: harness.session.sessionId, action: 'rollback' }); expect((await explain(harness, 'SELECT id FROM subject')).sqliteExplain?.dialect).toBe('sqlite'); expect(state(profile).audit).toBe(0);
  });

  it('Runtime query.explain使用原任务归属和准确session，重复ID拒绝且连接close取消计划后原utility正常exit', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false;
    const { app, events } = application(profile, (message, forward) => { if (hold && message.kind === 'statement' && message.sql.startsWith('EXPLAIN QUERY PLAN ')) { hold = false; reached.resolve(); } else forward(); });
    const { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }); const first: QueryOutcome = await app.request('query.explain', { sessionId, taskId: '原计划', sql: 'SELECT * FROM subject', maxRows: 1000 }); expect(first.sqliteExplain?.dialect).toBe('sqlite'); expect(app.ownsTask('原计划')).toBe(true); const processCount = processes.length, baseline = processes[0].sent.length;
    await expect(app.request('query.explain', { sessionId, taskId: '原计划', sql: 'SELECT 1', maxRows: 1000 })).rejects.toThrow('已经使用'); expect(processes[0].sent).toHaveLength(baseline);
    hold = true; const work = track(app.request('query.explain', { sessionId, taskId: '活动计划', sql: 'UPDATE subject SET note=\'不得写\'', maxRows: 1000 })); const failure = expect(work).rejects.toMatchObject({ code: 'SQLITE_CANCELLED' }); await reached.promise; await app.request('query.cancel', { taskId: '原计划' }); expect(app.ownsTask('活动计划')).toBe(true); await app.request('connections.close', { id: profile.id }); await failure;
    expect(processes).toHaveLength(processCount); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0); expect(app.ownsTask('活动计划')).toBe(true); expect(events.filter(event => event.taskId === '活动计划' && event.status !== 'running').map(event => event.status)).toEqual(['cancelled']); expect(state(profile).audit).toBe(0);
  });
});
