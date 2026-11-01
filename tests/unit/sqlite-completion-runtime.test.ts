import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import { sqliteCompletionTaskPrefix, type SqliteCompletionInput, type SqliteCompletionOutput } from '../../src/shared/sqliteCompletion';
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('补全测试必须使用真实Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>();
let workerDirectory: string, worker: string, retained = false, serial = 0;
/** 只延迟真实协议消息的交付，不伪造SQL结果、事务、退出或取消事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { workerDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-completion-')); worker = join(workerDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 仅清理本测试独占且退出已确认的目录；失败现场保留。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-completion-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; for (const runtime of runtimes) await runtime.forceClose(); runtimes.clear(); for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; } for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory); });
afterAll(() => { if (!retained) removeDirectory(workerDirectory); });
/** 所有数据库均为本例随机临时磁盘库，无用户配置或生产数据。 */
function profile(id = '补全连接', sql = 'CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT); CREATE VIEW subject_view AS SELECT id,note FROM subject;'): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-completion-')); directories.push(directory); const filePath = join(directory, 'sample.sqlite'), db = new DatabaseSync(filePath); try { db.exec('PRAGMA journal_mode=WAL;' + sql); } finally { db.close(); }
  return { id, name: '补全隔离库', group: '', color: '#789abc', dialect: 'sqlite', sqlite: { filePath, fileName: 'sample.sqlite', readOnly: false, busyTimeoutMs: 100 } };
}
/** 准确记录每个原生child的所有请求和exit，观察器只能扣住／转发真实回包。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send(message) { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate() { record.kills++; return child.kill(); }, exited: record.exited };
}
/** 只注入真实授权profile与真实transport，事件记录用于证明补全不会冒充查询任务。 */
function runtime(profiles: SqliteConnectionProfile[], observe?: Parameters<typeof transport>[0]) { const events: TaskEvent[] = []; const app = new SqliteRuntime({ resolveProfile: id => profiles.find(p => p.id === id), createTransport: () => transport(observe), emit: event => events.push(event) }); runtimes.add(app); return { app, events }; }
/** 每次目录请求用独立命名空间编号，正常调用不传任何用户SQL。 */
function completion(app: SqliteRuntime, connectionId: string, lookup: { kind: 'relations'; prefix?: string; schema?: 'main' | 'temp' } | { kind: 'columns'; table: string; prefix?: string; schema?: 'main' | 'temp' } | { kind: 'stamp'; prefix?: string }, sessionId?: string, taskId = sqliteCompletionTaskPrefix + ++serial): Promise<SqliteCompletionOutput> { return app.request('sqlite.completion', { ...lookup, prefix: lookup.prefix ?? '', connectionId, taskId, ...(sessionId ? { sessionId } : {}) } as SqliteCompletionInput); }
/** 仅用于准备原会话事务／临时DDL，真实执行记录不计入目录任务。 */
function execute(app: SqliteRuntime, sessionId: string, sql: string) { return app.request('query.execute', { sessionId, taskId: 'sql-' + ++serial, sql, maxRows: 100 }); }
/** 只看真实driver请求中的SQL，不将ACK或close伪装成语句。 */
function statements(record: ProcessRecord): string[] { return record.sent.flatMap(request => request.kind === 'execute' ? [request.sql] : []); }

/** 门闩只扣住真实原session的首个schema批次，允许精确重现目录未终态时的用户动作。 */
function sessionCompletionGate(p: SqliteConnectionProfile) {
  const held = deferred<void>(); let armed = false, release!: () => void;
  const value = runtime([p], (message, forward, record) => { if (armed && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA main.schema_version') { armed = false; release = forward; held.resolve(); } else forward(); });
  return { ...value, held: held.promise, arm: () => { armed = true; }, release: () => release() };
}
type UserAction = 'execute' | 'explain' | 'parameterized' | 'transaction' | 'parameterNames';
const handoffSql = 'SELECT note FROM subject WHERE id=7';
/** 所有明确动作仍走实际公开runtime入口，不替代SQL执行器或伪造查询结果。 */
function userAction(app: SqliteRuntime, sessionId: string, action: UserAction, taskId: string): Promise<any> {
  if (action === 'transaction') return app.request('query.transaction', { sessionId, action: 'commit' });
  if (action === 'parameterNames') return app.request('query.parameterNames', { sessionId, sql: 'SELECT :value FROM subject' });
  return app.request(action === 'execute' ? 'query.execute' : action === 'explain' ? 'query.explain' : 'query.executeParameterized', { sessionId, taskId, sql: handoffSql, maxRows: 100, ...(action === 'parameterized' ? { parameters: [] } : {}) });
}

describe('SQLite补全真实运行时与原会话边界', () => {
  it('无session使用独立只读driver并正常exit，不建历史任务或发送写SQL', async () => {
    const p = profile(), { app, events } = runtime([p]), result = await completion(app, p.id, { kind: 'relations' });
    expect(result.entries).toEqual([{ name: 'subject', kind: 'table', schema: 'main' }, { name: 'subject_view', kind: 'view', schema: 'main' }]); expect(result.incomplete).toBe(false); expect(result.sessionRevision).toBeUndefined(); expect(result.stamp).toMatch(/^\d+:0$/); expect(events).toEqual([]); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0);
    expect(processes[0].sent.find(request => request.kind === 'open')).toMatchObject({ options: { readOnly: true } }); expect(statements(processes[0]).every(sql => /^(SELECT|PRAGMA (?:main|temp)\.schema_version)/.test(sql))).toBe(true); expect((app as unknown as { completionReads: Map<string, unknown> }).completionReads.size).toBe(0);
  });

  it('同一原session看到未提交DDL及temp遮蔽，显式main仍准确，目录不推进objectsRevision或改事务', async () => {
    const p = profile(), { app, events } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id });
    expect(await app.request('query.completionState', session)).toMatchObject({ busy: false, objectsRevision: 0 });
    await execute(app, session.sessionId, 'BEGIN; CREATE TABLE pending_ddl(x TEXT); CREATE TEMP TABLE SUBJECT(temp_col TEXT)'); const prior = await app.request('query.completionState', session), eventCount = events.length, start = processes[0].sent.length;
    const result = await completion(app, p.id, { kind: 'relations' }, session.sessionId); expect(result.entries).toContainEqual({ name: 'SUBJECT', kind: 'table', schema: 'temp' }); expect(result.entries.some(entry => entry.name === 'subject')).toBe(false); expect(result.entries).toContainEqual({ name: 'pending_ddl', kind: 'table', schema: 'main' }); expect(result.sessionRevision).toBe(prior.objectsRevision);
    expect((await completion(app, p.id, { kind: 'columns', table: 'subject' }, session.sessionId)).entries.map(e => e.name)).toEqual(['temp_col']); expect((await completion(app, p.id, { kind: 'columns', schema: 'main', table: 'subject' }, session.sessionId)).entries.map(e => e.name)).toEqual(['id', 'note']);
    expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, transactionKnown: true }); expect(await app.request('query.completionState', session)).toMatchObject({ busy: false, objectsRevision: prior.objectsRevision }); expect(events).toHaveLength(eventCount); expect(processes).toHaveLength(1); expect(processes[0].sent.slice(start).some(request => request.kind === 'close' || request.kind === 'cancel' || request.kind === 'execute' && /^(BEGIN|COMMIT|ROLLBACK)/.test(request.sql))).toBe(false);
    await app.request('query.transaction', { ...session, action: 'rollback' }); expect(await app.request('query.completionState', session)).toMatchObject({ objectsRevision: prior.objectsRevision + 1 }); expect((await completion(app, p.id, { kind: 'relations', prefix: 'pending' }, session.sessionId)).entries).toEqual([]); await app.close();
  });

  it('字面前缀含%/_/引号/emoji且ASCII大小写折叠，名字始终参数绑定', async () => {
    const name = '%_\'"🚢', quoted = '"' + name.replaceAll('"', '""') + '"', p = profile('字面前缀', 'CREATE TABLE ' + quoted + '("列_🚢" TEXT); CREATE TABLE abc(x); CREATE TABLE aBcdef(x); CREATE TABLE Δ(x); CREATE TABLE δ(x);'), { app } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id });
    expect((await completion(app, p.id, { kind: 'relations', prefix: '%_' }, session.sessionId)).entries.map(e => e.name)).toEqual([name]); expect((await completion(app, p.id, { kind: 'relations', prefix: 'ABC' }, session.sessionId)).entries.map(e => e.name)).toEqual(['abc', 'aBcdef']); expect((await completion(app, p.id, { kind: 'relations', prefix: 'Δ' }, session.sessionId)).entries.map(e => e.name)).toEqual(['Δ']); expect((await completion(app, p.id, { kind: 'columns', table: name, prefix: '列_' }, session.sessionId)).entries.map(e => e.name)).toEqual(['列_🚢']);
    expect(statements(processes[0]).some(sql => sql.includes(name))).toBe(false); expect((await completion(app, p.id, { kind: 'stamp' }, session.sessionId)).entries).toEqual([]); await app.close();
  });

  it('真实generated和FTS hidden列分开标注，系统与shadow表不得成为用户对象', async () => {
    const p = profile('生成与隐藏', 'CREATE TABLE generated(x INTEGER, doubled INTEGER GENERATED ALWAYS AS(x*2) STORED); CREATE VIRTUAL TABLE search USING fts5(body);'), { app } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id });
    const relations = await completion(app, p.id, { kind: 'relations' }, session.sessionId); expect(relations.entries.map(e => e.name)).toEqual(['generated', 'search']);
    const columns = await completion(app, p.id, { kind: 'columns', table: 'generated' }, session.sessionId); expect(columns.entries).toContainEqual({ name: 'doubled', kind: 'column', schema: 'main', table: 'generated', declaredType: 'INTEGER', generated: true, hidden: false });
    expect((await completion(app, p.id, { kind: 'columns', table: 'search' }, session.sessionId)).entries).toContainEqual({ name: 'rank', kind: 'column', schema: 'main', table: 'search', declaredType: '', generated: false, hidden: true });
    expect((await completion(app, p.id, { kind: 'columns', table: 'search_data' }, session.sessionId)).entries).toEqual([]); expect((await completion(app, p.id, { kind: 'columns', table: 'sqlite_schema' }, session.sessionId)).entries).toEqual([]); await app.close();
  });

  it('temp shadow先遮蔽main同名用户表，再过滤不可建议对象，绝不回退main字段', async () => {
    const p = profile('shadow遮蔽', 'CREATE TABLE search_data(main_column TEXT);'), { app } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id }); await execute(app, session.sessionId, 'CREATE VIRTUAL TABLE temp.search USING fts5(body)');
    const output = await completion(app, p.id, { kind: 'relations', prefix: 'search_data' }, session.sessionId); expect(output.entries).toEqual([]); expect((await completion(app, p.id, { kind: 'columns', table: 'search_data' }, session.sessionId)).entries).toEqual([]); expect((await completion(app, p.id, { kind: 'columns', schema: 'main', table: 'search_data' }, session.sessionId)).entries.map(entry => entry.name)).toEqual(['main_column']); await app.close();
  });

  it('257探测准确截到256并标incomplete，列目录同样受限', async () => {
    const p = profile('目录上限', Array.from({ length: 257 }, (_, i) => 'CREATE TABLE t' + String(i).padStart(3, '0') + '(x);').join('') + 'CREATE TABLE wide(' + Array.from({ length: 257 }, (_, i) => 'c' + i + ' TEXT').join(',') + ');'), { app } = runtime([p]);
    const result = await completion(app, p.id, { kind: 'relations', prefix: 't' }); expect(result.entries).toHaveLength(256); expect(result.incomplete).toBe(true); expect((await completion(app, p.id, { kind: 'relations', prefix: 't256' })).incomplete).toBe(false); const columns = await completion(app, p.id, { kind: 'columns', table: 'wide' }); expect(columns.entries).toHaveLength(256); expect(columns.incomplete).toBe(true); expect(Buffer.byteLength(JSON.stringify(columns))).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('UTF8目录字节先满时保整字段并标incomplete，不返回超过2MiB的包装', async () => {
    // schema SQL保持原生1MiB值门内；合法控制字符名字经JSON转义、准确表名逐列重复才使最终包装先满。
    const table = '\u0002'.repeat(512), declaredType = '汉'.repeat(1000), definition = 'CREATE TABLE "' + table + '"(' + Array.from({ length: 256 }, (_, i) => '"' + '\u0001'.repeat(508) + String(i).padStart(4, '0') + '" "' + declaredType + '"').join(',') + ');'; expect(Buffer.byteLength(definition)).toBeLessThan(1024 * 1024);
    const p = profile('字节预算', definition), { app } = runtime([p]);
    const output = await completion(app, p.id, { kind: 'columns', table }); expect(output.incomplete).toBe(true); expect(output.entries.length).toBeGreaterThan(0); expect(output.entries.length).toBeLessThan(256); expect(output.entries.every(entry => entry.kind === 'column' && entry.declaredType === declaredType)).toBe(true); expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('执行／计划／参数／事务各开始一次单调revision，目录与参数识别不递增', async () => {
    const p = profile(), { app } = runtime([p]), session = await app.request('sessions.open', { connectionId: p.id });
    await execute(app, session.sessionId, 'SELECT 1'); expect((await app.request('query.completionState', session)).objectsRevision).toBe(1);
    await app.request('query.explain', { ...session, taskId: 'plan-' + ++serial, sql: 'SELECT id FROM subject', maxRows: 100 }); expect((await app.request('query.completionState', session)).objectsRevision).toBe(2);
    await app.request('query.executeParameterized', { ...session, taskId: 'parameters-' + ++serial, sql: 'SELECT 2', maxRows: 100, parameters: [] }); expect((await app.request('query.completionState', session)).objectsRevision).toBe(3);
    await app.request('query.transaction', { ...session, action: 'begin' }); expect((await app.request('query.completionState', session)).objectsRevision).toBe(4);
    await completion(app, p.id, { kind: 'stamp' }, session.sessionId); await app.request('query.parameterNames', { ...session, sql: 'SELECT :a' }); expect((await app.request('query.completionState', session)).objectsRevision).toBe(4); await app.request('query.transaction', { ...session, action: 'rollback' }); await app.close();
  });

  it('NUL及未知公共字段在创建driver前拒绝，不能把字面输入当SQL或路径', async () => {
    const p = profile(), { app } = runtime([p]);
    await expect(completion(app, p.id, { kind: 'relations', prefix: 'x\0y' })).rejects.toThrow(); await expect(app.request('sqlite.completion', { connectionId: p.id, taskId: sqliteCompletionTaskPrefix + '夹带SQL', kind: 'relations', prefix: '', sql: 'DROP TABLE subject' })).rejects.toThrow(); expect(processes).toEqual([]);
  });

  it('main cookie前后外部DDL变化拒绝混合目录，确认原独立driver正常退出', async () => {
    const p = profile(), changed = deferred<void>(); let injected = false;
    const { app } = runtime([p], (message, forward, record) => { if (!injected && message.kind === 'completed' && statements(record).at(-1) === 'PRAGMA main.schema_version') { injected = true; const db = new DatabaseSync(p.sqlite.filePath!); try { db.exec('CREATE TABLE external_ddl(x)'); } finally { db.close(); } changed.resolve(); } forward(); });
    await expect(completion(app, p.id, { kind: 'relations' })).rejects.toThrow('读取期间变化'); await changed.promise; expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0);
  });

  it('原session目录期间completionState立即busy，拒并行SQL/目录；取消只等短读边界并保原事务', async () => {
    const p = profile(), held = deferred<void>(); let hold = false, forwardHeld!: () => void;
    const { app } = runtime([p], (message, forward, record) => { if (hold && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA main.schema_version') { hold = false; forwardHeld = forward; held.resolve(); } else forward(); });
    const session = await app.request('sessions.open', { connectionId: p.id }); await execute(app, session.sessionId, "BEGIN; INSERT INTO subject VALUES(7,'原事务')"); const revision = (await app.request('query.completionState', session)).objectsRevision, eventCount = processes[0].sent.length; hold = true;
    const taskId = sqliteCompletionTaskPrefix + '原会话取消', work = completion(app, p.id, { kind: 'relations' }, session.sessionId, taskId).catch(reason => reason); await held.promise; expect(await app.request('query.completionState', session)).toMatchObject({ busy: true, databaseKnown: false, objectsRevision: revision }); await expect(completion(app, p.id, { kind: 'stamp' }, session.sessionId)).rejects.toThrow('已有运行操作');
    let cancelled = false; const cancel = app.request('query.cancel', { taskId }).then(() => { cancelled = true; }); await Promise.resolve(); expect(cancelled).toBe(false); expect(processes[0].sent.slice(eventCount).some(request => request.kind === 'cancel' || request.kind === 'close')).toBe(false); forwardHeld(); expect(await work).toBeInstanceOf(Error); await cancel;
    expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false }); expect(await app.request('query.completionState', session)).toMatchObject({ busy: false, objectsRevision: revision }); expect(processes[0].kills).toBe(0); const result = await execute(app, session.sessionId, 'SELECT note FROM subject WHERE id=7'); expect(result.results[0].rows[0].c0).toBe('原事务'); await app.request('query.transaction', { ...session, action: 'rollback' }); await app.close();
  });

  it('原session的connectionId不符或非SQLite目标拒绝，不建立替代driver', async () => {
    const p = profile(), other = profile('另一库'), { app } = runtime([p, other]), session = await app.request('sessions.open', { connectionId: p.id });
    await expect(completion(app, other.id, { kind: 'relations' }, session.sessionId)).rejects.toThrow('不属于原连接'); await expect(completion(app, p.id, { kind: 'relations' }, 'sqlite:不存在')).rejects.toThrow('不存在'); await expect(completion(app, '网络库', { kind: 'relations' })).rejects.toThrow('授权'); expect(processes).toHaveLength(1); await app.close();
  });

  it('无session取消只终止自身打开中的driver，并等真实exit；未知旧编号仍属SQLite', async () => {
    const p = profile(), held = deferred<void>(); let forwardHeld!: () => void;
    const { app } = runtime([p], (message, forward) => { if (message.kind === 'opened') { forwardHeld = forward; held.resolve(); } else forward(); }); const taskId = sqliteCompletionTaskPrefix + '打开取消', work = completion(app, p.id, { kind: 'relations' }, undefined, taskId).catch(reason => reason); await held.promise;
    await app.request('query.cancel', { taskId }); expect(await work).toBeInstanceOf(Error); expect(processes[0].child.exitCode !== null || processes[0].child.signalCode !== null).toBe(true); expect(processes[0].kills).toBe(1); expect(app.ownsTask(sqliteCompletionTaskPrefix + '已退休')).toBe(true); const count = processes.length; await app.request('query.cancel', { taskId: sqliteCompletionTaskPrefix + '已退休' }); expect(processes).toHaveLength(count); forwardHeld(); await app.close();
  });

  it('每runtime最多8个活动补全，全部真实完成后账本与driver清零，不累计历史墓碑', async () => {
    const p = profile(), held: (() => void)[] = [], allHeld = deferred<void>();
    const { app, events } = runtime([p], (message, forward) => { if (message.kind === 'opened') { held.push(forward); if (held.length === 8) allHeld.resolve(); } else forward(); }); const work = Array.from({ length: 8 }, () => completion(app, p.id, { kind: 'stamp' })); await allHeld.promise; await expect(completion(app, p.id, { kind: 'stamp' })).rejects.toThrow('繁忙'); expect(processes).toHaveLength(8); held.forEach(forward => forward()); await Promise.all(work); expect((app as unknown as { completionReads: Map<string, unknown> }).completionReads.size).toBe(0); expect(events).toEqual([]); expect(await Promise.all(processes.map(record => record.exited))).toEqual(Array.from({ length: 8 }, () => ({ code: 0, signal: null }))); expect(processes.every(record => record.kills === 0)).toBe(true);
  });

  it('forceClose覆盖打开中的补全准确transport，确认exit后清原pending与活动账本', async () => {
    const p = profile(), held = deferred<void>();
    const { app } = runtime([p], (message, forward) => { if (message.kind === 'opened') held.resolve(); else forward(); }); const work = completion(app, p.id, { kind: 'stamp' }).catch(reason => reason); await held.promise; await app.forceClose(); expect(await work).toBeInstanceOf(Error); expect(processes[0].kills).toBe(1); expect(processes[0].child.exitCode !== null || processes[0].child.signalCode !== null).toBe(true); expect(app.ownsConnection(p.id)).toBe(false); expect((app as unknown as { completionReads: Map<string, unknown> }).completionReads.size).toBe(0);
  });

  it('connection close不interrupt原session补全，先等读边界再关闭准确driver', async () => {
    const p = profile(), held = deferred<void>(); let hold = false, forwardHeld!: () => void;
    const { app } = runtime([p], (message, forward, record) => { if (hold && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA main.schema_version') { hold = false; forwardHeld = forward; held.resolve(); } else forward(); }); const session = await app.request('sessions.open', { connectionId: p.id }); hold = true; const work = completion(app, p.id, { kind: 'stamp' }, session.sessionId).catch(reason => reason); await held.promise; const close = app.request('connections.close', { id: p.id }); expect(processes[0].sent.some(request => request.kind === 'close' || request.kind === 'cancel')).toBe(false); forwardHeld(); expect(await work).toBeInstanceOf(Error); await close; expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(app.ownsConnection(p.id)).toBe(false); expect(processes[0].kills).toBe(0);
  });

  it('sessions.close等待自身目录原pending终态后才关闭原driver', async () => {
    const p = profile(), held = deferred<void>(); let hold = false, forwardHeld!: () => void;
    const { app } = runtime([p], (message, forward, record) => { if (hold && message.kind === 'batch' && statements(record).at(-1) === 'PRAGMA main.schema_version') { hold = false; forwardHeld = forward; held.resolve(); } else forward(); }); const session = await app.request('sessions.open', { connectionId: p.id }); hold = true; const work = completion(app, p.id, { kind: 'stamp' }, session.sessionId).catch(reason => reason); await held.promise; const close = app.request('sessions.close', session); expect(processes[0].sent.some(request => request.kind === 'close' || request.kind === 'cancel')).toBe(false); forwardHeld(); expect(await work).toBeInstanceOf(Error); await close; expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect((app as unknown as { completionReads: Map<string, unknown> }).completionReads.size).toBe(0); expect(processes[0].kills).toBe(0);
  });

  it.each(['execute', 'explain', 'parameterized', 'transaction', 'parameterNames'] as const)('明确%s准确等自身目录终态后执行一次，期间第二用户意图／新补全不抢占', async action => {
    const p = profile(), gate = sessionCompletionGate(p), { app, events } = gate, session = await app.request('sessions.open', { connectionId: p.id }); await execute(app, session.sessionId, "BEGIN; INSERT INTO subject VALUES(7,'交接保留')"); const revision = (await app.request('query.completionState', session)).objectsRevision, taskId = sqliteCompletionTaskPrefix + 'handoff-' + action, start = processes[0].sent.length; gate.arm();
    const metadata = completion(app, p.id, { kind: 'relations' }, session.sessionId, taskId).catch(reason => reason); await gate.held; let finished = false;
    const work = userAction(app, session.sessionId, action, 'user-handoff-' + action).then(value => { finished = true; return value; });
    expect(await app.request('query.completionState', session)).toMatchObject({ busy: true, objectsRevision: revision }); await Promise.resolve(); expect(finished).toBe(false); expect(statements(processes[0]).some(sql => sql === handoffSql || /^COMMIT$/.test(sql))).toBe(false);
    await expect(completion(app, p.id, { kind: 'stamp' }, session.sessionId)).rejects.toThrow('已有运行操作'); await expect(userAction(app, session.sessionId, 'execute', 'second-user-' + action)).rejects.toThrow('已有运行操作'); expect(processes[0].sent.slice(start).some(request => request.kind === 'cancel' || request.kind === 'close')).toBe(false);
    gate.release(); expect(await metadata).toBeInstanceOf(Error); const result = await work; const after = processes[0].sent.slice(start).flatMap(request => request.kind === 'execute' ? [request.sql] : []);
    if (action === 'execute' || action === 'parameterized') { expect(result.results[0].rows).toEqual([{ c0: '交接保留' }]); expect(after.filter(sql => sql === handoffSql)).toHaveLength(1); }
    if (action === 'explain') { expect(result.failure).toBeUndefined(); expect(after.filter(sql => sql.startsWith('EXPLAIN QUERY PLAN ') && sql.includes(handoffSql))).toHaveLength(1); }
    if (action === 'transaction') expect(after.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    if (action === 'parameterNames') { expect(result.names).toEqual(['value']); expect(after).toEqual(['PRAGMA main.schema_version']); }
    expect(events.some(event => event.taskId === taskId)).toBe(false); expect(processes[0].kills).toBe(0); expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: action !== 'transaction', transactionKnown: true, broken: false }); expect(await app.request('query.completionState', session)).toMatchObject({ busy: false, objectsRevision: revision + (action === 'parameterNames' ? 0 : 1) });
    if (action !== 'transaction') await app.request('query.transaction', { ...session, action: 'rollback' }); await app.close();
  });

  it.each(['execute', 'explain', 'parameterized'] as const)('等待目录交接时取消%s只撤原用户意图，终态前不发SQL、不interrupt原事务', async action => {
    const p = profile(), gate = sessionCompletionGate(p), { app } = gate, session = await app.request('sessions.open', { connectionId: p.id }); await execute(app, session.sessionId, "BEGIN; INSERT INTO subject VALUES(7,'取消仍保留')"); const revision = (await app.request('query.completionState', session)).objectsRevision, userTask = 'cancel-handoff-' + action; gate.arm();
    const metadata = completion(app, p.id, { kind: 'relations' }, session.sessionId).catch(reason => reason); await gate.held; const work = userAction(app, session.sessionId, action, userTask).catch(reason => reason); let ended = false; const cancel = app.request('query.cancel', { taskId: userTask }).then(() => { ended = true; }); await Promise.resolve(); expect(ended).toBe(false); expect(processes[0].sent.some(request => request.kind === 'cancel')).toBe(false); gate.release(); expect(await metadata).toBeInstanceOf(Error); expect(await work).toBeInstanceOf(Error); await cancel;
    expect(statements(processes[0]).some(sql => sql.includes(handoffSql))).toBe(false); expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, transactionKnown: true, broken: false }); expect(await app.request('query.completionState', session)).toMatchObject({ busy: false, objectsRevision: revision }); const result = await execute(app, session.sessionId, handoffSql); expect(result.results[0].rows).toEqual([{ c0: '取消仍保留' }]); const count = processes[0].sent.length; await app.request('query.cancel', { taskId: userTask }); expect(processes[0].sent).toHaveLength(count); await app.request('query.transaction', { ...session, action: 'rollback' }); await app.close();
  });

  it.each(['session-close', 'connection-close', 'profile-change'] as const)('交接期间%s撤销原用户请求，不借相同会话名称投递到变化的目标', async change => {
    const p = profile(), gate = sessionCompletionGate(p), { app } = gate, session = await app.request('sessions.open', { connectionId: p.id }); gate.arm(); const metadata = completion(app, p.id, { kind: 'relations' }, session.sessionId).catch(reason => reason); await gate.held;
    const work = userAction(app, session.sessionId, 'execute', 'changed-handoff-' + change).catch(reason => reason); let closing: Promise<any> | undefined;
    if (change === 'session-close') closing = app.request('sessions.close', session); if (change === 'connection-close') closing = app.request('connections.close', { id: p.id }); if (change === 'profile-change') p.sqlite.readOnly = true;
    gate.release(); expect(await metadata).toBeInstanceOf(Error); expect(await work).toBeInstanceOf(Error); if (closing) await closing; expect(statements(processes[0]).some(sql => sql.includes(handoffSql))).toBe(false); expect(processes[0].kills).toBe(0); if (change === 'profile-change') { p.sqlite.readOnly = false; await app.close(); }
  });

  it('保留命名空间或复用taskId的无效请求不取消目录，更不能接管其它用户查询', async () => {
    const p = profile(), gate = sessionCompletionGate(p), { app } = gate, session = await app.request('sessions.open', { connectionId: p.id }); await app.request('query.execute', { ...session, taskId: 'already-used', sql: 'SELECT 1', maxRows: 1 }); gate.arm(); const taskId = sqliteCompletionTaskPrefix + 'namespace-guard', metadata = completion(app, p.id, { kind: 'relations' }, session.sessionId, taskId); await gate.held;
    await expect(userAction(app, session.sessionId, 'execute', taskId)).rejects.toThrow('编号无效'); await expect(userAction(app, session.sessionId, 'execute', 'already-used')).rejects.toThrow('编号无效'); expect((app as unknown as { completionReads: Map<string, { cancelled: boolean }> }).completionReads.get(taskId)?.cancelled).toBe(false); gate.release(); expect((await metadata).entries.length).toBeGreaterThan(0); expect(statements(processes[0]).some(sql => sql.includes(handoffSql))).toBe(false); await app.close();
  });

  it('pending属于真实用户查询时所有后继动作立即busy拒绝，不等待、不取消、不重放', async () => {
    const p = profile(), held = deferred<void>(); let forwardHeld!: () => void;
    const { app } = runtime([p], (message, forward, record) => { if (message.kind === 'batch' && statements(record).at(-1) === 'SELECT 42') { forwardHeld = forward; held.resolve(); } else forward(); }); const session = await app.request('sessions.open', { connectionId: p.id }), query = execute(app, session.sessionId, 'SELECT 42'); await held.promise;
    for (const action of ['execute', 'explain', 'parameterized', 'transaction', 'parameterNames'] as const) await expect(userAction(app, session.sessionId, action, 'busy-user-' + action)).rejects.toThrow('已有运行操作'); expect(processes[0].sent.some(request => request.kind === 'cancel' || request.kind === 'close')).toBe(false); expect(statements(processes[0]).filter(sql => sql === 'SELECT 42')).toHaveLength(1); forwardHeld(); expect((await query).results[0].rows).toEqual([{ c0: '42' }]); await app.close();
  });
});
