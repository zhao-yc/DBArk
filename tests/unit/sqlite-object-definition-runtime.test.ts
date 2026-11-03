import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { objectDefinitionTaskPrefix, type ObjectDefinitionOutput } from '../../src/shared/objectDefinition';
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('对象定义测试必须使用真实Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>();
let workerDirectory: string, worker: string, retained = false, serial = 0;
/** 门闩只延迟真实消息，不伪造原生SQL、事务和退出事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { workerDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-definition-')); worker = join(workerDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 清理仅限本测试直接创建、位于系统临时目录的准确目录，失败时保留现场。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-definition-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; for (const runtime of runtimes) await runtime.forceClose(); runtimes.clear(); for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; } for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory); });
afterAll(() => { if (!retained) removeDirectory(workerDirectory); });
/** 随机隔离磁盘库由原生SQLite创建，不读用户连接、测试数据库或生产数据。 */
function profile(sql = 'CREATE TABLE Subject(id INTEGER PRIMARY KEY,note TEXT); CREATE VIEW summary AS SELECT note FROM Subject;', encoding?: string): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-definition-')); directories.push(directory); const filePath = join(directory, 'sample.sqlite'), db = new DatabaseSync(filePath);
  try { if (encoding) db.exec("PRAGMA encoding='" + encoding + "'"); db.exec('PRAGMA journal_mode=WAL;' + sql); } finally { db.close(); }
  return { id: '定义-' + ++serial, name: '隔离定义库', group: '', color: '#789abc', dialect: 'sqlite', sqlite: { filePath, fileName: 'sample.sqlite', readOnly: false, busyTimeoutMs: 100 } };
}
/** transport只记录并转发真实worker协议，所有退出均来自准确child的exit事件。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send(message) { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate() { record.kills++; return child.kill(); }, exited: record.exited };
}
/** Runtime仅注入授权profile及真实worker，事件用于证明没有生成用户查询或历史。 */
function runtime(profiles: SqliteConnectionProfile[], observe?: Parameters<typeof transport>[0]) { const events: TaskEvent[] = []; const app = new SqliteRuntime({ emit: event => events.push(event), resolveProfile: id => profiles.find(value => value.id === id), createTransport: () => transport(observe) }); runtimes.add(app); return { app, events }; }
/** 只从准确execute请求提取SQL，ACK及取消都不会被计作语句。 */
function statements(record: ProcessRecord): string[] { return record.sent.flatMap(request => request.kind === 'execute' ? [request.sql] : []); }
/** 用户SQL仅准备会话事务和TEMP夹具；对象定义请求没有任意SQL输入。 */
function execute(app: SqliteRuntime, sessionId: string, sql: string) { return app.request('query.execute', { sessionId, taskId: 'sql-' + ++serial, sql, maxRows: 100 }); }
/** 使用公开命令及完整原输入，避免测试绕过公共校验和会话绑定。 */
function definition(app: SqliteRuntime, connectionId: string, table = 'subject', sessionId?: string, database?: string, taskId = objectDefinitionTaskPrefix + ++serial): Promise<ObjectDefinitionOutput> { return app.request('query.objectDefinition', { connectionId, table, taskId, ...(sessionId ? { sessionId } : {}), ...(database ? { database } : {}) }); }

describe('SQLite对象定义真实只读运行时', () => {
  it('独立只读快照返回真实大小写和完整DDL，无用户任务且准确退出', async () => {
    const p = profile(), { app, events } = runtime([p]), value = await definition(app, p.id);
    expect(value).toMatchObject({ database: 'main', name: 'Subject', kind: 'table', temporary: false, ddl: 'CREATE TABLE Subject(id INTEGER PRIMARY KEY,note TEXT)' });
    expect(value.request.table).toBe('subject'); expect(value.revision).toBeUndefined(); expect(events).toEqual([]);
    expect(processes[0].sent.find(request => request.kind === 'open')).toMatchObject({ options: { readOnly: true } }); expect(statements(processes[0])[0]).toBe('BEGIN'); expect(statements(processes[0]).at(-1)).toBe('ROLLBACK'); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0);
  });

  it('原会话保留事务和TEMP遮蔽，显式main精确定位，TEMP VIEW同样可读', async () => {
    const p = profile(), { app } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id });
    await execute(app, session.sessionId, "BEGIN; INSERT INTO Subject VALUES(7,'未提交'); CREATE TEMP TABLE sUbJeCt(temp_value TEXT); CREATE TEMP VIEW temp_view AS SELECT temp_value FROM temp.subject");
    const revision = (await app.request('query.completionState', session)).objectsRevision, start = processes[0].sent.length;
    expect(await definition(app, p.id, 'SUBJECT', session.sessionId)).toMatchObject({ database: 'temp', name: 'sUbJeCt', kind: 'table', temporary: true, revision, ddl: 'CREATE TABLE sUbJeCt(temp_value TEXT)' });
    expect(await definition(app, p.id, 'subject', session.sessionId, 'MaIn')).toMatchObject({ database: 'main', name: 'Subject', temporary: false, request: { database: 'MaIn' } });
    expect(await definition(app, p.id, 'temp_view', session.sessionId, 'temp')).toMatchObject({ kind: 'view', temporary: true, database: 'temp' });
    expect(processes).toHaveLength(1); expect(statements({ ...processes[0], sent: processes[0].sent.slice(start) }).some(sql => /^(BEGIN|ROLLBACK|COMMIT)/.test(sql))).toBe(false);
    expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false }); expect((await app.request('query.completionState', session)).objectsRevision).toBe(revision);
    expect((await execute(app, session.sessionId, 'SELECT note FROM main.Subject WHERE id=7')).results[0].rows).toEqual([{ c0: '未提交' }]); await app.request('query.transaction', { ...session, action: 'rollback' });
    await expect(definition(app, p.id, 'temp_view', session.sessionId, 'temp')).rejects.toThrow('不存在');
  });

  it('2MiB内大DDL按字节分块读取，跨块UTF8及UTF16编码保持原文', async () => {
    const ddl = 'CREATE TABLE "大表"(note TEXT DEFAULT \'' + '汉😀'.repeat(180000) + '\')'; expect(Buffer.byteLength(ddl)).toBeGreaterThan(1024 * 1024); expect(Buffer.byteLength(ddl)).toBeLessThan(2 * 1024 * 1024);
    const p = profile(ddl), { app } = runtime([p]); expect((await definition(app, p.id, '大表')).ddl).toBe(ddl);
    const utf16Ddl = 'CREATE TABLE "中文"("字段" TEXT DEFAULT \'' + 'a'.repeat(1100000) + '\')';
    expect(Buffer.byteLength(utf16Ddl, 'utf16le')).toBeGreaterThan(2 * 1024 * 1024); expect(Buffer.byteLength(utf16Ddl, 'utf8')).toBeLessThan(2 * 1024 * 1024);
    const utf16 = profile(utf16Ddl, 'UTF-16le'), other = runtime([utf16]); expect((await definition(other.app, utf16.id, '中文')).ddl).toBe(utf16Ddl);
  });

  it('原生记录可读取但完整DDL超过2MiB时明确拒绝，绝不截断', async () => {
    const ddl = 'CREATE TABLE oversized(note TEXT DEFAULT \'' + 'a'.repeat(2 * 1024 * 1024) + '\')', p = profile(ddl), { app, events } = runtime([p]);
    await expect(definition(app, p.id, 'oversized')).rejects.toThrow('超过2MiB'); expect(events).toEqual([]); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0);
  });

  it('UTF16完整DDL正好2MiB的UTF8边界连同真实schema记录头仍可读取', async () => {
    const prefix = 'CREATE TABLE "utf16_boundary"(note TEXT DEFAULT \'' , suffix = '\')', ddl = prefix + 'a'.repeat(2 * 1024 * 1024 - Buffer.byteLength(prefix + suffix)) + suffix;
    expect(Buffer.byteLength(ddl, 'utf8')).toBe(2 * 1024 * 1024); expect(Buffer.byteLength(ddl, 'utf16le')).toBe(4 * 1024 * 1024);
    const p = profile(ddl, 'UTF-16le'), { app } = runtime([p]); expect((await definition(app, p.id, 'utf16_boundary')).ddl).toBe(ddl);
  });

  it('拒绝附加库、无会话TEMP、夹带SQL、索引、触发器和无SQL系统表，不执行用户输入', async () => {
    const p = profile('CREATE TABLE Subject(x); CREATE INDEX sample_index ON Subject(x); CREATE TRIGGER sample_trigger AFTER INSERT ON Subject BEGIN SELECT 1; END;'), { app } = runtime([p]);
    await expect(definition(app, p.id, 'Subject', undefined, 'attached')).rejects.toThrow('main或temp'); await expect(definition(app, p.id, 'Subject', undefined, 'temp')).rejects.toThrow('原查询会话');
    await expect(app.request('query.objectDefinition', { connectionId: p.id, table: 'Subject', database: 'main', taskId: objectDefinitionTaskPrefix + '注入', sql: 'DROP TABLE Subject' })).rejects.toThrow(); expect(processes).toHaveLength(0);
    await expect(definition(app, p.id, 'sample_index')).rejects.toThrow('索引及触发器'); await expect(definition(app, p.id, 'sample_trigger')).rejects.toThrow('索引及触发器'); await expect(definition(app, p.id, 'sqlite_schema')).rejects.toThrow(); await expect(definition(app, p.id, "Subject'; DROP TABLE Subject;--")).rejects.toThrow('不存在');
    expect((await definition(app, p.id)).name).toBe('Subject');
  });

  it('独立快照抵御读取期间外部DDL，返回同一准确旧目录', async () => {
    const p = profile(); let changed = false;
    const { app } = runtime([p], (message, forward, record) => { if (!changed && message.kind === 'completed' && statements(record).at(-1) === 'PRAGMA main.schema_version') { changed = true; const db = new DatabaseSync(p.sqlite.filePath!); try { db.exec('ALTER TABLE Subject ADD COLUMN later TEXT'); } finally { db.close(); } } forward(); });
    expect((await definition(app, p.id)).ddl).not.toContain('later'); expect(changed).toBe(true); expect((await definition(app, p.id)).ddl).toContain('later');
  });

  it('原会话未开事务时检测外部schema变化，拒绝混合目录且不重连', async () => {
    const p = profile(); let changed = false, armed = false;
    const { app } = runtime([p], (message, forward, record) => { if (armed && !changed && message.kind === 'completed' && statements(record).at(-1) === 'PRAGMA main.schema_version') { changed = true; const db = new DatabaseSync(p.sqlite.filePath!); try { db.exec('ALTER TABLE Subject ADD COLUMN later TEXT'); } finally { db.close(); } } forward(); });
    const session = await app.request('sessions.open', { connectionId: p.id }); armed = true; await expect(definition(app, p.id, 'subject', session.sessionId)).rejects.toThrow('读取期间变化'); expect(changed).toBe(true); expect(processes).toHaveLength(1); expect((await definition(app, p.id, 'subject', session.sessionId)).ddl).toContain('later'); expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: false, broken: false });
  });

  it('错误会话连接与已经关闭会话不能重建替代driver', async () => {
    const p = profile(), other = profile(), { app } = runtime([p, other]), session = await app.request('sessions.open', { connectionId: p.id });
    await expect(definition(app, other.id, 'subject', session.sessionId)).rejects.toThrow('不属于原连接'); await app.request('sessions.close', session); await expect(definition(app, p.id, 'subject', session.sessionId)).rejects.toThrow('不存在'); expect(processes).toHaveLength(1);
  });

  it('会话取消只等待短读边界，繁忙拒绝并保留原事务，旧号取消不影响后续任务', async () => {
    const p = profile(), held = deferred<void>(); let armed = false, release!: () => void;
    const { app, events } = runtime([p], (message, forward, record) => { if (armed && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA encoding') { armed = false; release = forward; held.resolve(); } else forward(); });
    const session = await app.request('sessions.open', { connectionId: p.id }); await execute(app, session.sessionId, "BEGIN; INSERT INTO Subject VALUES(7,'保留事务')"); armed = true;
    const taskId = objectDefinitionTaskPrefix + '取消原目录', work = definition(app, p.id, 'subject', session.sessionId, undefined, taskId).catch(reason => reason); await held.promise;
    await expect(definition(app, p.id, 'subject', session.sessionId)).rejects.toThrow('已有运行操作'); expect((await app.request('query.completionState', session)).busy).toBe(true);
    let ended = false; const cancel = app.request('query.cancel', { taskId }).then(() => { ended = true; }); await Promise.resolve(); expect(ended).toBe(false); expect(processes[0].sent.some(request => request.kind === 'cancel' || request.kind === 'close')).toBe(false);
    release(); expect(await work).toBeInstanceOf(Error); await cancel; expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, broken: false }); expect(processes[0].kills).toBe(0); expect(events.some(event => event.taskId === taskId)).toBe(false);
    await app.request('query.cancel', { taskId }); expect((await definition(app, p.id, 'subject', session.sessionId)).name).toBe('Subject'); await app.request('query.transaction', { ...session, action: 'rollback' });
  });

  it('两个打开中请求均占槽，第三请求拒绝；取消确认原exit后才归还准确槽位', async () => {
    const p = profile(), gates = new Map<ProcessRecord, () => void>(), held = deferred<void>(); let intercept = true;
    // 两个子进程的opened到达顺序不固定，按原进程绑定门闩，不能误放已取消进程的消息。
    const { app } = runtime([p], (message, forward, record) => { if (intercept && message.kind === 'opened') { gates.set(record, forward); if (gates.size === 2) held.resolve(); } else forward(); });
    const firstId = objectDefinitionTaskPrefix + '首个打开', first = definition(app, p.id, 'subject', undefined, undefined, firstId).catch(reason => reason), second = definition(app, p.id); await held.promise;
    await expect(definition(app, p.id)).rejects.toThrow('繁忙'); expect(processes).toHaveLength(2); await app.request('query.cancel', { taskId: firstId }); expect(await first).toBeInstanceOf(Error); expect(processes[0].kills).toBe(1); await processes[0].exited;
    intercept = false; gates.get(processes[1])!(); expect((await second).name).toBe('Subject'); gates.get(processes[0])!(); expect((await definition(app, p.id)).name).toBe('Subject'); expect((app as unknown as { definitionReads: Map<string, unknown> }).definitionReads.size).toBe(0);
  });

  it('连接关闭等待原session目录终态，原资源准确退出前不interrupt或关闭事务', async () => {
    const p = profile(), held = deferred<void>(); let armed = false, release!: () => void;
    const { app } = runtime([p], (message, forward, record) => { if (armed && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA encoding') { armed = false; release = forward; held.resolve(); } else forward(); });
    const session = await app.request('sessions.open', { connectionId: p.id }); armed = true; const work = definition(app, p.id, 'subject', session.sessionId).catch(reason => reason); await held.promise; const close = app.request('connections.close', { id: p.id });
    expect(processes[0].sent.some(request => request.kind === 'cancel' || request.kind === 'close')).toBe(false); release(); expect(await work).toBeInstanceOf(Error); await close; expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0); expect(app.ownsConnection(p.id)).toBe(false);
  });

  it('强退覆盖打开中准确对象，真实exit确认后清空槽位，迟到opened不发布', async () => {
    const p = profile(), held = deferred<void>(); let release!: () => void;
    const { app } = runtime([p], (message, forward) => { if (message.kind === 'opened') { release = forward; held.resolve(); } else forward(); });
    const work = definition(app, p.id).catch(reason => reason); await held.promise; await app.forceClose(); expect(await work).toBeInstanceOf(Error); expect(processes[0].kills).toBe(1); await processes[0].exited; expect((app as unknown as { definitionReads: Map<string, unknown> }).definitionReads.size).toBe(0); release(); expect(app.ownsConnection(p.id)).toBe(false);
  });
});
