import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { QueryOutcome, SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';

// 单测必须注入真实Node子进程；意外走默认Electron工厂立即失败，不能以mock成功代替数据库。
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite运行时测试必须使用真实隔离Node进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; kills: number; sent: SqliteWorkerRequest[]; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>();
let bundleDirectory: string, worker: string, retained = false;

/** 只同步真实进程/结果消息的观察时刻，不伪造SQLite执行事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-runtime-build-')); worker = join(bundleDirectory, 'worker.cjs');
  await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' });
});
/** 只删除本测试独占且已确认退出的临时目录，失败保留原库与worker。 */
function removeDirectory(directory: string): void {
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-runtime-')).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const runtime of runtimes) await runtime.forceClose(); runtimes.clear();
  for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 用独立磁盘库验证真实Schema、事务隔离及写入结果，不读用户配置。 */
function fixture(id = '磁盘连接'): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-runtime-')); directories.push(directory);
  const path = join(directory, 'sample.sqlite'), db = new DatabaseSync(path);
  try { db.exec("PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT); CREATE VIEW subject_view AS SELECT id,note FROM subject; CREATE TRIGGER subject_trigger AFTER INSERT ON subject BEGIN SELECT 1; END"); } finally { db.close(); }
  return { id, name: '真实磁盘库', group: '', color: '#789abc', dialect: 'sqlite', sqlite: { filePath: path, fileName: 'sample.sqlite', readOnly: false, busyTimeoutMs: 100 } };
}
/** 每次工厂调用都启动一个准确子进程，记录请求和kill次数验证取消边界。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, kills: 0, sent: [], exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return {
    send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); },
    onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message)) : listener(message); child.on('message', receive); return () => child.off('message', receive); },
    terminate: () => { record.kills++; return child.kill(); }, exited: record.exited,
  };
}
/** 除Main已授权路径及真实transport工厂外，不给运行时其它数据库能力。 */
function runtime(profiles: SqliteConnectionProfile[], options: { create?: () => SqliteProcessTransport; emit?: (event: TaskEvent) => void } = {}) {
  const events: TaskEvent[] = [];
  const runtime = new SqliteRuntime({ resolveProfile: id => profiles.find(profile => profile.id === id), createTransport: options.create ?? transport, emit: event => { events.push(structuredClone(event)); options.emit?.(event); } });
  runtimes.add(runtime); return { runtime, events };
}
/** 从原合同发起完整脚本；任务编号由各例明确指定以检查历史取消路由。 */
function execute(runtime: SqliteRuntime, sessionId: string, taskId: string, sql: string): Promise<QueryOutcome> {
  return runtime.request('query.execute', { sessionId, taskId, sql, maxRows: 1000 });
}
/** 使用另一个独立原生连接检查已提交磁盘值。 */
function diskValue(profile: SqliteConnectionProfile, sql: string): unknown {
  const db = new DatabaseSync(profile.sqlite.filePath!); try { return Object.values(db.prepare(sql).get()!)[0]; } finally { db.close(); }
}

describe('SQLite原工作区运行时与真实磁盘utility路由', () => {
  it('连接探测真实打开关闭，元数据只读独立utility且DDL按名称/种类参数化', async () => {
    const profile = fixture(), { runtime: app } = runtime([profile]);
    const status = await app.request('connections.test', profile);
    expect(status).toMatchObject({ dialect: 'sqlite' }); expect(status.version).toMatch(/^\d+\.\d+/);
    expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0);
    expect(await app.request('connections.open', { id: profile.id })).toEqual(status);
    expect(await app.request('metadata.databases', { connectionId: profile.id })).toEqual(['main']);
    expect(await app.request('metadata.objects', { connectionId: profile.id, database: 'main' })).toEqual([
      { name: 'subject', kind: 'table' }, { name: 'subject_trigger', kind: 'trigger' }, { name: 'subject_view', kind: 'view' },
    ]);
    const ddl = await app.request('metadata.ddl', { connectionId: profile.id, database: 'main', name: 'subject', kind: 'table' }); expect(ddl).toContain('CREATE TABLE subject');
    await expect(app.request('metadata.ddl', { connectionId: profile.id, database: 'main', name: "subject' OR 1=1 --", kind: 'table' })).rejects.toThrow('对象不存在');
    await expect(app.request('metadata.ddl', { connectionId: profile.id, database: 'main', name: 'subject', kind: 'view' })).rejects.toThrow('对象不存在');
    const metadataProcesses = processes.slice(2);
    for (const process of metadataProcesses) {
      expect(process.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } });
      expect(await process.exited).toEqual({ code: 0, signal: null }); expect(process.kills).toBe(0);
    }
    expect(diskValue(profile, 'SELECT count(*) FROM subject')).toBe(0);
    await app.request('connections.close', { id: profile.id }); expect(app.ownsConnection(profile.id)).toBe(false);
  });

  it('每标签真实物理连接隔离事务，独立元数据不借用户事务，提交才改变另一标签结果', async () => {
    const profile = fixture(), { runtime: app } = runtime([profile]);
    const first = await app.request('sessions.open', { connectionId: profile.id, database: null });
    const second = await app.request('sessions.open', { connectionId: profile.id, database: 'main' });
    expect(first.sessionId).toMatch(/^sqlite:/); expect(second.sessionId).not.toBe(first.sessionId); expect(processes[0].child.pid).not.toBe(processes[1].child.pid);
    await execute(app, first.sessionId, '未提交写入', "BEGIN; INSERT INTO subject VALUES(1,'未提交'); CREATE TABLE pending_schema(n)");
    expect(await app.request('query.sessionState', first)).toEqual({ transactionOpen: true, transactionKnown: true, broken: false });
    expect((await execute(app, second.sessionId, '其它标签读取', 'SELECT count(*) FROM subject')).results[0].rows).toEqual([{ c0: '0' }]);
    expect((await app.request('metadata.objects', { connectionId: profile.id, database: 'main' })).some((object: { name: string }) => object.name === 'pending_schema')).toBe(false);
    expect(diskValue(profile, 'SELECT count(*) FROM subject')).toBe(0);
    await app.request('query.transaction', { ...first, action: 'commit' });
    expect((await execute(app, second.sessionId, '提交后读取', 'SELECT note FROM subject')).results[0].rows).toEqual([{ c0: '未提交' }]);
    expect(await app.request('query.completionState', first)).toMatchObject({ dialect: 'sqlite', database: 'main', databaseKnown: true, busy: false });
    await app.close(); expect(processes.every(process => process.child.exitCode === 0)).toBe(true);
  });

  it('活动标签和打开中均拒绝换配置，不取消不回滚；关闭后才准许换目标', async () => {
    const profile = fixture(), changed = { ...profile, sqlite: { ...profile.sqlite, readOnly: true } }, opened = deferred<void>(); let release!: () => void;
    const { runtime: app } = runtime([profile], { create: () => transport((message, forward) => { if (message.kind === 'opened') { release = forward; opened.resolve(); } else forward(); }) });
    const opening = app.request('sessions.open', { connectionId: profile.id }); await opened.promise;
    await expect(app.request('__connections.prepareSave', { id: profile.id, profile: changed })).rejects.toThrow('仍有打开');
    expect(processes[0].kills).toBe(0); expect(processes[0].sent.some(message => message.kind === 'close')).toBe(false);
    release(); const session = await opening;
    await execute(app, session.sessionId, '原事务', "BEGIN; INSERT INTO subject VALUES(1,'保留事务')");
    await expect(app.request('__connections.prepareSave', { id: profile.id, profile: changed })).rejects.toThrow('仍有打开');
    expect(await app.request('query.sessionState', session)).toMatchObject({ transactionOpen: true, transactionKnown: true });
    expect(processes[0].sent.some(message => message.kind === 'execute' && message.sql === 'ROLLBACK')).toBe(false);
    await app.request('sessions.close', session); expect(diskValue(profile, 'SELECT count(*) FROM subject')).toBe(0);
    await app.request('__connections.prepareSave', { id: profile.id, profile: changed }); expect(app.ownsConnection(profile.id)).toBe(false);
  });

  it('关闭屏障覆盖迟到open，原driver先正常退出，不能发布新session或被新请求复活', async () => {
    const profile = fixture(), opened = deferred<void>(); let release!: () => void;
    const { runtime: app } = runtime([profile], { create: () => transport((message, forward) => { if (message.kind === 'opened') { release = forward; opened.resolve(); } else forward(); }) });
    const opening = app.request('sessions.open', { connectionId: profile.id }).catch(reason => reason); await opened.promise;
    const closing = app.request('connections.close', { id: profile.id });
    expect(app.ownsConnection(profile.id)).toBe(true);
    await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('正在关闭');
    release(); expect(await opening).toBeInstanceOf(Error); await closing;
    expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].kills).toBe(0); expect(app.ownsConnection(profile.id)).toBe(false);
    expect(app.ownsSession('sqlite:未知历史编号')).toBe(true); expect(app.ownsSession('mysql-session')).toBe(false);
    await expect(app.request('query.sessionState', { sessionId: 'sqlite:未知历史编号' })).rejects.toThrow('不会自动重连');
  });

  it('旧task取消不干扰当前任务，连接关闭取消准确任务并等终态，另一连接继续可用', async () => {
    const profile = fixture(), otherProfile = fixture('另一连接'), started = deferred<void>();
    const { runtime: app, events } = runtime([profile, otherProfile], { emit: event => { if (event.taskId === '长查询' && event.executionSql?.includes('sum(x)')) started.resolve(); } });
    const session = await app.request('sessions.open', { connectionId: profile.id }), other = await app.request('sessions.open', { connectionId: otherProfile.id });
    await execute(app, session.sessionId, '旧任务', 'SELECT 1');
    const query = execute(app, session.sessionId, '长查询', "BEGIN; INSERT INTO subject VALUES(1,'未提交'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n").catch(reason => reason);
    await started.promise; await delay(50);
    const count = processes[0].sent.length; await app.request('query.cancel', { taskId: '旧任务' }); expect(processes[0].sent).toHaveLength(count); expect(processes[0].kills).toBe(0);
    expect(app.ownsTask('旧任务')).toBe(true); expect(app.ownsTask('未登记任务')).toBe(false);
    await expect(execute(app, session.sessionId, '忙态请求', 'SELECT 3')).rejects.toThrow('已有运行操作');
    await app.request('connections.close', { id: profile.id }); expect(await query).toBeInstanceOf(Error);
    expect(events.filter(event => event.taskId === '长查询' && event.status !== 'running').map(event => event.status)).toEqual(['cancelled']);
    await processes[0].exited; expect(diskValue(profile, 'SELECT count(*) FROM subject')).toBe(0);
    expect((await execute(app, other.sessionId, '另一连接可用', 'SELECT 42')).results[0].rows).toEqual([{ c0: '42' }]); expect(processes[1].kills).toBe(0);
    await expect(app.request('serverMonitor.read', { connectionId: otherProfile.id, taskId: '未接入' })).rejects.toThrow('SQLite尚未接入此功能');
    await expect(app.request('sessions.open', { connectionId: otherProfile.id, database: 'attached' })).rejects.toThrow('只支持main');
  });

  it('取消原task的确认不关闭其它标签，强退只终止已登记transport并等待退出', async () => {
    const profile = fixture(), started = deferred<void>();
    const { runtime: app } = runtime([profile], { emit: event => { if (event.taskId === '明确取消' && event.executionSql?.includes('sum(x)')) started.resolve(); } });
    const first = await app.request('sessions.open', { connectionId: profile.id }), second = await app.request('sessions.open', { connectionId: profile.id });
    const query = execute(app, first.sessionId, '明确取消', 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n').catch(reason => reason);
    await started.promise; await delay(50); await app.request('query.cancel', { taskId: '明确取消' }); expect(await query).toBeInstanceOf(Error);
    expect((await execute(app, second.sessionId, '同连接另一标签', 'SELECT 5')).results[0].rows).toEqual([{ c0: '5' }]); expect(processes[1].kills).toBe(0);
    await app.forceClose(); await Promise.all(processes.map(process => process.exited));
    expect(app.ownsConnection(profile.id)).toBe(false); await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('正在退出');
  });

  it.each(['connections.open', 'connections.test'])('%s打开失败但exit未确认时直接拒绝新session/元数据，强退也必须等待真实exit事实', async command => {
    // RAM协议仅证明未确认资源的异常分支，不伪造任何打开成功、查询或数据库结果。
    vi.useFakeTimers();
    const profile = fixture(), exited = deferred<SqliteProcessExit>(); let listener: ((message: SqliteWorkerResponse) => void) | undefined, kills = 0;
    const { runtime: app } = runtime([profile], { create: () => ({
      send: message => { if (message.kind === 'open') queueMicrotask(() => listener?.({ kind: 'failed', id: message.id, code: 'SQLITE_NATIVE_CANTOPEN', message: '本例打开失败', transaction: false, completedStatements: 0 })); },
      onMessage: receive => { listener = receive; queueMicrotask(() => receive({ kind: 'ready' })); return () => { listener = undefined; }; },
      terminate: () => { kills++; return false; }, exited: exited.promise,
    }) });
    try {
      const opening = app.request(command, command === 'connections.test' ? profile : { id: profile.id }).catch(reason => reason);
      await vi.advanceTimersByTimeAsync(5001); const openingFailure = await opening; expect(openingFailure).toBeInstanceOf(Error); expect(kills).toBe(1);
      expect(app.ownsConnection(profile.id)).toBe(true);
      // 不先调用connections.close，原失败本身就必须封锁所有新建与元数据读取。
      await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
      await expect(app.request('metadata.objects', { connectionId: profile.id, database: 'main' })).rejects.toThrow('资源尚未确认');
      await expect(app.request('connections.test', profile)).rejects.toThrow('资源尚未确认'); expect(kills).toBe(1);
      const closeFailure = await app.request('connections.close', { id: profile.id }).catch(reason => reason);
      expect(closeFailure).toBeInstanceOf(Error); expect(closeFailure.message).toContain('未确认退出'); expect(closeFailure.cause).toBe(openingFailure);
      await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
      await expect(app.request('__connections.prepareSave', { id: profile.id, transportChanged: true, profile: { ...profile, sqlite: { ...profile.sqlite, readOnly: true } } })).rejects.toThrow('未确认资源');
      let closed = false; const forced = app.forceClose().then(() => { closed = true; });
      await vi.advanceTimersByTimeAsync(1); expect(closed).toBe(false); expect(kills).toBe(2); expect(app.ownsConnection(profile.id)).toBe(true);
      exited.resolve({ code: null, signal: 'SIGTERM' }); await forced; expect(closed).toBe(true); expect(app.ownsConnection(profile.id)).toBe(false);
    } finally { exited.resolve({ code: null, signal: 'SIGTERM' }); vi.useRealTimers(); }
  });

  it('未确认句柄迟到退出仍保留隔离，只有显式连接close解锁，正常SQL错误不会封死有效driver', async () => {
    vi.useFakeTimers();
    const profile = fixture(), exited = deferred<SqliteProcessExit>(); let listener: ((message: SqliteWorkerResponse) => void) | undefined, created = 0;
    const { runtime: app } = runtime([profile], { create: () => {
      if (++created > 1) return transport();
      // 只伪造打开失败，不提供成功打开或SQL结果；解除隔离后转入真实Node磁盘driver。
      return {
        send: message => { if (message.kind === 'open') queueMicrotask(() => listener?.({ kind: 'failed', id: message.id, code: 'SQLITE_NATIVE_CANTOPEN', message: '本例未确认句柄', transaction: false, completedStatements: 0 })); },
        onMessage: receive => { listener = receive; queueMicrotask(() => receive({ kind: 'ready' })); return () => { listener = undefined; }; },
        terminate: () => false, exited: exited.promise,
      };
    } });
    try {
      const opening = app.request('connections.test', profile).catch(reason => reason); await vi.advanceTimersByTimeAsync(5001); expect(await opening).toBeInstanceOf(Error);
      exited.resolve({ code: null, signal: 'SIGTERM' }); await vi.advanceTimersByTimeAsync(0);
      await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
      await expect(app.request('metadata.databases', { connectionId: profile.id })).rejects.toThrow('资源尚未确认'); expect(created).toBe(1);
      await expect(app.request('__connections.prepareSave', { id: profile.id, transportChanged: true, profile })).rejects.toThrow('未确认资源');
      await app.request('connections.close', { id: profile.id }); expect(app.ownsConnection(profile.id)).toBe(false);
    } finally { exited.resolve({ code: null, signal: 'SIGTERM' }); vi.useRealTimers(); }
    const first = await app.request('sessions.open', { connectionId: profile.id });
    await app.request('query.transaction', { ...first, action: 'begin' });
    await expect(app.request('query.transaction', { ...first, action: 'begin' })).rejects.toThrow();
    const second = await app.request('sessions.open', { connectionId: profile.id });
    expect((await execute(app, second.sessionId, '正常错误后仍可新建', 'SELECT 6')).results[0].rows).toEqual([{ c0: '6' }]);
    await app.request('query.transaction', { ...first, action: 'rollback' }); await app.close();
  });

  it('真实长查询取消未确认exit即封锁连接，原生句柄退出后仍须显式连接close', async () => {
    const profile = fixture(), started = deferred<void>(); let allowKill = false, attempts = 0;
    const { runtime: app } = runtime([profile], {
      create: () => { const original = transport(); return { ...original, terminate: () => { attempts++; return allowKill ? original.terminate() : false; } }; },
      emit: event => { if (event.taskId === '取消未确认' && event.executionSql?.includes('sum(x)')) started.resolve(); },
    });
    const first = await app.request('sessions.open', { connectionId: profile.id });
    const query = execute(app, first.sessionId, '取消未确认', 'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n').catch(reason => reason);
    await started.promise; await delay(50); vi.useFakeTimers();
    try {
      const cancel = app.request('query.cancel', { taskId: '取消未确认' }).catch(reason => reason);
      await vi.advanceTimersByTimeAsync(5251); expect(await cancel).toBeInstanceOf(Error); expect(await query).toMatchObject({ code: 'SQLITE_EXIT_UNCONFIRMED', sessionClosed: false }); expect(attempts).toBe(1);
      await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
      await expect(app.request('metadata.objects', { connectionId: profile.id, database: 'main' })).rejects.toThrow('资源尚未确认');
      expect(processes).toHaveLength(1); expect(processes[0].child.exitCode).toBeNull();
    } finally { allowKill = true; vi.useRealTimers(); }
    // 首次收尾即使准确driver随后退出，也保留本轮原取消失败，不能把它改写成取消成功。
    await expect(app.request('connections.close', { id: profile.id })).rejects.toThrow('收尾未全部确认'); await processes[0].exited;
    expect(app.ownsConnection(profile.id)).toBe(true); await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
    await app.request('connections.close', { id: profile.id }); expect(app.ownsConnection(profile.id)).toBe(false);
    const recovered = await app.request('sessions.open', { connectionId: profile.id }); expect((await execute(app, recovered.sessionId, '显式解锁后查询', 'SELECT 7')).results[0].rows).toEqual([{ c0: '7' }]); await app.close();
  });

  it('真实标签close握手失败封锁新建，显式连接close重试只回收原准确driver', async () => {
    const profile = fixture(); let withheld = 0;
    const { runtime: app } = runtime([profile], { create: () => {
      const original = transport(); return { ...original, send: message => { if (message.kind === 'close') { withheld++; return; } original.send(message); } };
    } });
    const first = await app.request('sessions.open', { connectionId: profile.id });
    await execute(app, first.sessionId, '关闭前真实查询', 'SELECT 8'); vi.useFakeTimers();
    try {
      const closing = app.request('sessions.close', first).catch(reason => reason); await vi.advanceTimersByTimeAsync(5001);
      expect(await closing).toBeInstanceOf(Error); expect(withheld).toBe(1);
      await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
      await expect(app.request('metadata.databases', { connectionId: profile.id })).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(1);
    } finally { vi.useRealTimers(); }
    await app.request('connections.close', { id: profile.id }); await processes[0].exited; expect(processes[0].kills).toBe(1); expect(app.ownsConnection(profile.id)).toBe(false);
  });
});
