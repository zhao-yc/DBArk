import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { CommandMap, SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { QueryParameter } from '../../src/shared/queryParameters';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteDriverSession } from '../../src/engine/sqlite/session';
import { SqliteQuerySession } from '../../src/main/sqliteQuerySession';
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('参数会话测试只使用准确Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

let worker = '', buildDirectory = '', retained = false;
const directories: string[] = [], drivers = new Set<SqliteDriverSession>(), applications = new Set<SqliteRuntime>();
const processes: { child: ChildProcess; sent: SqliteWorkerRequest[]; exited: Promise<SqliteProcessExit> }[] = [];
beforeAll(async () => { buildDirectory = mkdtempSync(join(tmpdir(), 'dbark-parameter-session-build-')); worker = join(buildDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 只删除本测试登记且已关闭句柄的准确临时目录，不从前缀枚举其它任务资源。 */
function remove(directory: string) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory)).toMatch(/^dbark-parameter-session-/); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const app of applications) await app.forceClose(); applications.clear();
  for (const driver of drivers) { if (driver.isBusy) await driver.cancel(); await driver.close(); } drivers.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) remove(directory);
});
afterAll(() => { if (!retained) remove(buildDirectory); });
/** 独立只读磁盘观察不借用被测查询会话或其事务。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: DatabaseSync) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!, { readOnly: true }); try { return action(db); } finally { db.close(); } }
function fixture(readOnly = false): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-parameter-session-')); directories.push(directory); const filePath = join(directory, 'source.sqlite'), db = new DatabaseSync(filePath);
  try { db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(i INTEGER PRIMARY KEY,t TEXT,d TEXT,b BLOB,n,bval INTEGER,day TEXT,stamp TEXT,duration TEXT); CREATE TABLE control(n); INSERT INTO control VALUES(7)'); } finally { db.close(); }
  return { id: randomUUID(), name: '参数原会话', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath, readOnly, busyTimeoutMs: 100 } };
}
/** 准确进程消息原样透传；捕获仅供本测试核原SQL模板，绝不生成成功回包。 */
function transport(): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record = { child, sent: [] as SqliteWorkerRequest[], exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => child.kill(), exited: record.exited };
}
async function open(profile: SqliteConnectionProfile) { const driver = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly: profile.sqlite.readOnly, busyTimeoutMs: 100 }); drivers.add(driver); const events: TaskEvent[] = [], session = new SqliteQuerySession(profile.id, driver, event => events.push(structuredClone(event))); return { driver, session, events, process: processes.at(-1)! }; }
type Harness = Awaited<ReturnType<typeof open>>;
const execute = (h: Harness, sql: string, parameters: QueryParameter[] = [], extra: Partial<CommandMap['query.executeParameterized']['input']> = {}) => h.session.executeParameterized({ sessionId: h.session.sessionId, taskId: randomUUID(), sql, parameters, maxRows: 1000, ...extra });

describe('SQLite原查询会话的类型参数脚本', () => {
  it('识别不建立任务或投递SQL，九类型多语句真实绑定、重复名和隐私模板保持', async () => {
    const profile = fixture(), h = await open(profile), sql = 'INSERT INTO subject VALUES(:i,:t,:d,:b,:n,:yes,:day,:stamp,:duration); SELECT :i,:t,:d,hex(:b),:n,typeof(:yes),:day,:stamp,:duration,:i;', baseline = h.process.sent.length;
    expect(h.session.parameterNames({ sessionId: h.session.sessionId, sql })).toMatchObject({ dialect: 'sqlite', names: ['i', 't', 'd', 'b', 'n', 'yes', 'day', 'stamp', 'duration'], maxDecimalScale: 38 }); expect(h.process.sent).toHaveLength(baseline); expect(h.events).toEqual([]);
    const secret = "parameter_private_nonce_🚢' ); DELETE FROM control;--\0尾", decimal = '12345678901234567890.001230', values: QueryParameter[] = [{ name: 'i', type: 'integer', value: '-9223372036854775808' }, { name: 't', type: 'text', value: secret }, { name: 'd', type: 'decimal', value: decimal }, { name: 'b', type: 'binary', value: '00ff00' }, { name: 'n', type: 'null' }, { name: 'yes', type: 'boolean', value: 'true' }, { name: 'day', type: 'date', value: '0001-01-01' }, { name: 'stamp', type: 'datetime', value: '2024-02-29 23:59:59.123456' }, { name: 'duration', type: 'time', value: '-838:59:59.123456' }];
    const outcome = await execute(h, sql, values); expect(outcome.failure).toBeUndefined(); expect(outcome.results).toHaveLength(2); expect(outcome.results[1].rows).toEqual([{ c0: '-9223372036854775808', c1: secret, c2: decimal, c3: '00FF00', c4: null, c5: 'integer', c6: '0001-01-01', c7: '2024-02-29 23:59:59.123456', c8: '-838:59:59.123456', c9: '-9223372036854775808' }]);
    const sent = h.process.sent.filter(message => message.kind === 'execute'); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ sql, namedParameters: { ':i': { type: 'integer', value: '-9223372036854775808' }, ':d': decimal, ':b': { type: 'binary', base64: 'AP8A' }, ':n': null } }); expect(sent[0]).not.toHaveProperty('parameters');
    const headers = h.events.flatMap(event => event.executionSql ? [event.executionSql] : []); expect(headers).toEqual(outcome.results.map(result => result.statement)); expect(headers.join('')).not.toContain('parameter_private_nonce_'); expect(h.events.every(event => !event.message.includes('parameter_private_nonce_'))).toBe(true);
    expect(disk(profile, db => db.prepare('SELECT CAST(i AS TEXT) AS i,t,d,hex(b) AS blob,typeof(d) AS d_type,typeof(bval) AS b_type,day,stamp,duration,n FROM subject').get())).toEqual({ i: '-9223372036854775808', t: secret, d: decimal, blob: '00FF00', d_type: 'text', b_type: 'integer', day: '0001-01-01', stamp: '2024-02-29 23:59:59.123456', duration: '-838:59:59.123456', n: null }); expect(disk(profile, db => db.prepare('SELECT n FROM control').get()!.n)).toBe(7);
  });
  it('整组缺少/额外/重复/无效值和非法语法格式均在首条driver请求之前拒绝', async () => {
    const profile = fixture(), h = await open(profile), sql = 'INSERT INTO control VALUES(99); SELECT :a', before = h.process.sent.length;
    const groups: QueryParameter[][] = [[], [{ name: 'b', type: 'text', value: 'x' }], [{ name: 'a', type: 'text', value: 'x' }, { name: 'b', type: 'text', value: 'x' }], [{ name: 'a', type: 'text', value: 'x' }, { name: 'a', type: 'text', value: 'x' }], [{ name: 'a', type: 'integer', value: '9223372036854775808' }]];
    for (const group of groups) await expect(execute(h, sql, group)).rejects.toThrow();
    for (const suffix of ['SELECT ?', 'SELECT @a', 'SELECT $a', "SELECT '未闭合"]) await expect(execute(h, 'INSERT INTO control VALUES(99); ' + suffix)).rejects.toThrow();
    for (const extra of [{ continueOnError: true }, { collectWarnings: true }]) await expect(execute(h, 'INSERT INTO control VALUES(99)', [], extra)).rejects.toThrow();
    expect(h.process.sent).toHaveLength(before); expect(h.events).toEqual([]); expect(disk(profile, db => db.prepare('SELECT n FROM control').all())).toEqual([{ n: 7 }]);
  });
  it('原事务/临时表和其它会话隔离，用户明确回滚保原库', async () => {
    const profile = fixture(), h = await open(profile), other = await open(profile);
    await h.session.execute({ sessionId: h.session.sessionId, taskId: randomUUID(), sql: 'CREATE TEMP TABLE local_only(v); BEGIN;', maxRows: 1000 });
    const parameters: QueryParameter[] = [{ name: 'v', type: 'integer', value: '9' }], outcome = await execute(h, 'INSERT INTO control VALUES(:v); INSERT INTO local_only VALUES(:v); SELECT count(*) FROM control;', parameters);
    expect(outcome.transactionOpen).toBe(true); expect(outcome.results[2].rows).toEqual([{ c0: '2' }]); expect(disk(profile, db => db.prepare('SELECT n FROM control').all())).toEqual([{ n: 7 }]);
    expect((await execute(other, 'SELECT * FROM local_only')).failure).toBeDefined(); await h.session.transaction({ sessionId: h.session.sessionId, action: 'rollback' }); expect(disk(profile, db => db.prepare('SELECT n FROM control').all())).toEqual([{ n: 7 }]);
  });
  it('原生第二句失败只交前序完整事实及原模板UTF16范围，失败不回显值或自动重放', async () => {
    const profile = fixture(), h = await open(profile), sql = 'INSERT INTO control VALUES(:v);\r\nBAD SELECT :v; SELECT 99;', parameters: QueryParameter[] = [{ name: 'v', type: 'integer', value: '42' }];
    const outcome = await execute(h, sql, parameters); expect(outcome.results).toHaveLength(1); expect(outcome.failure).toMatchObject({ statementOrdinal: 2, statementsCompleted: 1, sourceRange: { start: sql.indexOf('BAD'), end: sql.indexOf('; SELECT 99') } }); expect(outcome.failure?.message).not.toContain('42'); expect(disk(profile, db => db.prepare('SELECT n FROM control ORDER BY n').all())).toEqual([{ n: 7 }, { n: 42 }]);
    expect(h.process.sent.filter(message => message.kind === 'execute')).toHaveLength(1); expect((await execute(h, 'SELECT :x', [{ name: 'x', type: 'text', value: '后继' }])).results[0].rows).toEqual([{ c0: '后继' }]);
  });
  it('只读拒写保原连接可继续SELECT，空BLOB/空TEXT/NULL各自保留', async () => {
    const profile = fixture(true), h = await open(profile); const failed = await execute(h, 'INSERT INTO control VALUES(:v)', [{ name: 'v', type: 'integer', value: '9' }]); expect(failed.failure).toBeDefined(); expect(h.session.state()).toMatchObject({ broken: false, transactionOpen: false });
    const outcome = await execute(h, 'SELECT typeof(:b),length(:b),typeof(:t),length(:t),:n', [{ name: 'b', type: 'binary', value: '' }, { name: 't', type: 'text', value: '' }, { name: 'n', type: 'null' }]); expect(outcome.results[0].rows).toEqual([{ c0: 'blob', c1: '0', c2: 'text', c3: '0', c4: null }]); expect(disk(profile, db => db.prepare('SELECT n FROM control').all())).toEqual([{ n: 7 }]);
  });
  it('运行时识别复用准确session且不登记任务，参数执行归属及重复ID保护保持', async () => {
    const profile = fixture(), events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: transport, emit: event => events.push(event) }); applications.add(app);
    await app.request('connections.open', { id: profile.id, profile }); const { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }), before = processes.flatMap(record => record.sent).length;
    expect(await app.request('query.parameterNames', { sessionId, sql: 'SELECT :v,:v' })).toMatchObject({ dialect: 'sqlite', names: ['v'] }); expect(processes.flatMap(record => record.sent)).toHaveLength(before); expect(events).toEqual([]);
    const taskId = randomUUID(), input = { sessionId, taskId, sql: 'SELECT :v', maxRows: 1000, parameters: [{ name: 'v', type: 'integer', value: '9223372036854775807' }] };
    expect((await app.request('query.executeParameterized', input)).results[0].rows).toEqual([{ c0: '9223372036854775807' }]); expect(app.ownsTask(taskId)).toBe(true); await expect(app.request('query.executeParameterized', input)).rejects.toThrow('编号'); await app.request('query.cancel', { taskId }); await app.request('connections.close', { id: profile.id });
    // 直接核准确原进程退出回执，不用不存在的运行时统计接口推断资源已经释放。
    expect(processes.length).toBeGreaterThan(0); for (const record of processes) expect(await record.exited).toEqual({ code: 0, signal: null });
  });
});
