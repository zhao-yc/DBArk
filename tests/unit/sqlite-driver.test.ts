import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import type { SqliteExecutionResult, SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';

const directories: string[] = [], sessions = new Set<SqliteDriverSession>();
const processes: { child: ChildProcess; kills: number; exited: Promise<SqliteProcessExit> }[] = [];
let bundleDirectory: string, worker: string, retained = false;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-driver-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 只清理本例真实关闭后的精确目录，失败原件保留；不按进程名操作其它应用。 */
function removeDirectory(directory: string) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-driver-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  vi.useRealTimers();
  for (const session of sessions) { if (session.isBusy) await session.cancel(); await session.close(); } sessions.clear();
  for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 独立临时磁盘库，原生打开读取；没有任何数据库服务器或用户配置。 */
function fixture(journal: 'DELETE' | 'WAL' = 'DELETE') { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-driver-')); directories.push(directory); const path = join(directory, 'sample.sqlite'); const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=' + journal); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)'); db.close(); return { directory, path }; }
function transport(): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout!.resume(); child.stderr!.resume();
  const record = { child, kills: 0, exited: new Promise<SqliteProcessExit>(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))) }; processes.push(record);
  return { send: message => { child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { child.on('message', listener); return () => child.off('message', listener); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
async function open(path: string, readOnly = false) { const session = await SqliteDriverSession.open(transport, { path, readOnly, busyTimeoutMs: 100 }); sessions.add(session); return session; }
async function collect(session: SqliteDriverSession, sql: string) { const rows: SqliteValue[][] = []; const result = await session.execute(sql, { onBatch: batch => { rows.push(...batch.rows); } }); return { rows, result }; }
/** 独立连接观察已提交文件状态，不能用待验session自己的缓存证明恢复。 */
function diskCount(path: string) { const db = new DatabaseSync(path); try { return { count: db.prepare('SELECT count(*) AS n FROM subject').get()!.n, integrity: Object.values(db.prepare('PRAGMA integrity_check').get()!)[0] }; } finally { db.close(); } }

describe('SQLite真实磁盘原生驱动与进程生命周期', () => {
  it('重复列名按位置保留，动态INTEGER/REAL/TEXT/NULL/BLOB不丢精度且可连续执行', async () => {
    const { path } = fixture(), session = await open(path), columns: string[][] = [];
    const rows: SqliteValue[][] = [];
    await session.execute("SELECT 9223372036854775807 AS duplicate,-9223372036854775808 AS duplicate,1.25,-0.0,1e999,'9007199254740993',x'00ff',NULL,'中文🚢';", { onStatement: statement => { columns.push(statement.columns.map(column => column.name)); }, onBatch: batch => { rows.push(...batch.rows); } });
    expect(columns[0].slice(0, 2)).toEqual(['duplicate', 'duplicate']);
    expect(rows).toEqual([[{ type: 'integer', value: '9223372036854775807' }, { type: 'integer', value: '-9223372036854775808' }, { type: 'real', value: '1.25' }, { type: 'real', value: '-0' }, { type: 'real', value: 'Infinity' }, '9007199254740993', { type: 'binary', base64: 'AP8=' }, null, '中文🚢']]);
    expect((await collect(session, 'SELECT 2')).rows).toEqual([[{ type: 'integer', value: '2' }]]); await session.close(); expect(session.isClosed).toBe(true);
  });
  it('SQLite原生脚本正确处理trigger的BEGIN/END、内部引号/注释/分号，变化量含触发器', async () => {
    const { path } = fixture(), session = await open(path);
    const sql = "CREATE TABLE audit(n INTEGER,note TEXT); CREATE TRIGGER tr AFTER INSERT ON subject BEGIN INSERT INTO audit VALUES(1,'文本;--不是注释'); UPDATE audit SET n=n+1; END; -- 外层注释\n INSERT INTO subject VALUES(7,'保留'); SELECT n,note FROM audit;";
    const { rows, result } = await collect(session, sql);
    expect(result.statements).toHaveLength(4); expect(result.statements.map(statement => statement.changes)).toEqual(['0', '0', '3', '0']); expect(rows).toEqual([[{ type: 'integer', value: '2' }, '文本;--不是注释']]);
    expect((await session.execute('; -- 纯注释\n /* 尾注释 */ ;')).statements).toEqual([]);
  });
  it('参数原文含NUL、64位整型和字节精确保留；多语句参数在第一条写入前拒绝', async () => {
    const { path } = fixture(), session = await open(path);
    await expect(session.execute('INSERT INTO subject VALUES(?,?); INSERT INTO subject VALUES(2,\'不得执行\')', { parameters: [{ type: 'integer', value: '1' }, '原文'] })).rejects.toMatchObject({ code: 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', completedStatements: 0 });
    expect(diskCount(path).count).toBe(0);
    await session.execute('INSERT INTO subject VALUES(?,?)', { parameters: [{ type: 'integer', value: '9223372036854775807' }, 'NUL\0中文' ] });
    expect((await collect(session, 'SELECT id,note FROM subject')).rows).toEqual([[{ type: 'integer', value: '9223372036854775807' }, 'NUL\0中文']]);
  });
  it('首错停止保留实际事务，独立连接不可见；ROLLBACK显式完成后COMMIT变化量为0', async () => {
    const { path } = fixture(), session = await open(path);
    await expect(session.execute("BEGIN; INSERT INTO subject VALUES(1,'第一条'); INSERT INTO subject VALUES(1,'冲突'); INSERT INTO subject VALUES(2,'不得执行')")).rejects.toMatchObject({ completedStatements: 2, transaction: true, sessionClosed: false });
    expect(session.transaction).toBe(true); expect(diskCount(path).count).toBe(0);
    expect((await collect(session, 'SELECT count(*) FROM subject')).rows).toEqual([[{ type: 'integer', value: '1' }]]);
    const rollback = await session.execute('ROLLBACK'); expect(rollback.transaction).toBe(false); expect(rollback.statements[0].changes).toBe('0');
    await session.execute('BEGIN; INSERT INTO subject VALUES(1,NULL)'); const commit = await session.execute('COMMIT'); expect(commit.statements[0].changes).toBe('0'); expect(diskCount(path)).toEqual({ count: 1, integrity: 'ok' });
  });
  it('各会话临时表隔离；只读模式拒绝写入/ATTACH/危险PRAGMA，缺文件不创建', async () => {
    const { path, directory } = fixture(), first = await open(path), second = await open(path);
    await first.execute('CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(1)'); await expect(second.execute('SELECT * FROM marker')).rejects.toBeInstanceOf(SqliteDriverError);
    const readonly = await open(path, true), bytes = readFileSync(path), attached = join(directory, 'other.sqlite');
    await readonly.execute('BEGIN; SELECT * FROM subject; ROLLBACK');
    for (const sql of ["INSERT INTO subject VALUES(4,'拒绝')", "ATTACH DATABASE '" + attached.replaceAll("'", "''") + "' AS other", 'PRAGMA writable_schema=ON']) await expect(readonly.execute(sql)).rejects.toBeInstanceOf(SqliteDriverError);
    await readonly.close(); expect(readFileSync(path)).toEqual(bytes);
    const missing = join(directory, 'missing.sqlite'); await expect(open(missing)).rejects.toBeInstanceOf(SqliteDriverError);
    const { existsSync } = await import('node:fs'); expect(existsSync(missing)).toBe(false); expect(existsSync(attached)).toBe(false);
  });
  it('逐批ACK保持背压，达到行/字节限制只截断传输而非整库加载，RETURNING仍完整提交', async () => {
    const { path } = fixture(), session = await open(path), first = deferred<void>(), resume = deferred<void>(); let batches = 0, returned = 0;
    const result = session.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) SELECT x FROM n', { maxRows: 25, batchRows: 10, onBatch: async batch => { returned += batch.rows.length; if (++batches === 1) { first.resolve(); await resume.promise; } } });
    await first.promise; await delay(30); expect(batches).toBe(1); expect(session.isBusy).toBe(true); resume.resolve();
    expect((await result).statements[0]).toMatchObject({ rows: 25, truncated: true, changes: '0' }); expect(returned).toBe(25);
    const inserted = await session.execute('INSERT INTO subject SELECT value,NULL FROM json_each(\'[1,2,3]\') RETURNING id', { maxRows: 1 }); expect(inserted.statements[0]).toMatchObject({ rows: 1, truncated: true, changes: '3' }); expect(diskCount(path).count).toBe(3);
    const bounded = await session.execute("SELECT '超过当前传输预算的完整文字'", { maxBytes: 1 }); expect(bounded.statements[0]).toMatchObject({ rows: 0, truncated: true });
  });
  it('协作取消保留实际事务；原生已终态而消费者仍忙时不误杀或放行新任务', async () => {
    const { path } = fixture(), session = await open(path); await session.execute('BEGIN');
    const first = deferred<void>(), resume = deferred<void>(), before = processes.at(-1)!;
    const execution = session.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) SELECT x FROM n', { batchRows: 10, onBatch: async () => { first.resolve(); await resume.promise; } }).catch(error => error);
    await first.promise; const cancellation = session.cancel(); expect(session.cancel()).toBe(cancellation);
    expect(await cancellation).toMatchObject({ mode: 'cooperative', sessionClosed: false, transaction: true, resources: 'confirmed' });
    await delay(350); expect(before.kills).toBe(0); expect(session.isBusy).toBe(true); await expect(session.close()).rejects.toMatchObject({ code: 'SQLITE_SESSION_BUSY' }); resume.resolve();
    expect(await execution).toMatchObject({ code: 'SQLITE_CANCELLED', completedStatements: 0, transaction: true }); await session.execute('ROLLBACK');
  });
  it.each(['DELETE', 'WAL'] as const)('%s日志：阻塞聚合被准确进程取消，独立重开恢复文件但不伪造回滚', async journal => {
    const { path } = fixture(journal), session = await open(path), started = deferred<void>(), before = processes.at(-1)!;
    expect((await collect(session, 'PRAGMA journal_mode')).rows).toEqual([[journal.toLowerCase()]]);
    const execution = session.execute("BEGIN; INSERT INTO subject VALUES(1,'未提交'); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n", { onStatement: statement => { if (statement.index === 2) started.resolve(); } }).catch(error => error);
    await started.promise; await delay(50);
    expect(await session.cancel()).toEqual({ mode: 'process-terminated', sessionClosed: true, transaction: null, resources: 'confirmed' });
    expect(await execution).toMatchObject({ code: 'SQLITE_CANCELLED_SESSION_CLOSED', sessionClosed: true, transaction: null, completedStatements: 2 }); expect(before.kills).toBe(1);
    expect(diskCount(path)).toEqual({ count: 0, integrity: 'ok' }); const processCount = processes.length;
    await expect(session.execute('COMMIT')).rejects.toMatchObject({ code: 'SQLITE_SESSION_UNAVAILABLE' }); expect(processes).toHaveLength(processCount);
  });
  it('WAL读者只见已提交值，第二写者锁等待失败不重放，显式回滚后可发新请求', async () => {
    const { path } = fixture('WAL'), first = await open(path);
    expect((await collect(first, 'PRAGMA journal_mode')).rows).toEqual([['wal']]);
    const second = await open(path), reader = await open(path, true);
    await first.execute("BEGIN IMMEDIATE; INSERT INTO subject VALUES(1,'未提交')");
    expect((await collect(reader, 'SELECT count(*) FROM subject')).rows).toEqual([[{ type: 'integer', value: '0' }]]);
    await expect(second.execute("INSERT INTO subject VALUES(2,'明确一次')")).rejects.toMatchObject({ code: 'SQLITE_NATIVE_5', transaction: false, completedStatements: 0, sessionClosed: false });
    expect(second.isBusy).toBe(false); await first.execute('ROLLBACK');
    expect((await collect(reader, 'SELECT count(*) FROM subject')).rows).toEqual([[{ type: 'integer', value: '0' }]]);
    await second.execute("INSERT INTO subject VALUES(2,'明确新请求')");
    expect((await collect(reader, 'SELECT id,note FROM subject')).rows).toEqual([[{ type: 'integer', value: '2' }, '明确新请求']]);
    expect(diskCount(path)).toEqual({ count: 1, integrity: 'ok' });
  });
  it('原生prepare阶段拒绝副作用PRAGMA，参数校验或消费者拒绝都不改变外键设置', async () => {
    const { path } = fixture(), session = await open(path), header = vi.fn();
    await session.execute('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(pid INTEGER REFERENCES parent(id))');
    for (const sql of ['PRAGMA foreign_keys=OFF; SELECT 1', 'PRAGMA foreign_keys(OFF)', 'EXPLAIN PRAGMA foreign_keys=OFF', 'PRAGMA ignore_check_constraints=ON', 'PRAGMA optimize', 'PRAGMA writable_schema=ON']) {
      await expect(session.execute(sql, { parameters: [], onStatement: header })).rejects.toMatchObject({ completedStatements: 0, sessionClosed: false });
      expect((await collect(session, 'PRAGMA foreign_keys')).rows).toEqual([[{ type: 'integer', value: '1' }]]);
    }
    expect(header).not.toHaveBeenCalled();
    await expect(session.execute('INSERT INTO child VALUES(999)')).rejects.toMatchObject({ completedStatements: 0 });
    expect((await collect(session, 'SELECT count(*) FROM child')).rows).toEqual([[{ type: 'integer', value: '0' }]]);
    await expect(session.execute('INSERT INTO parent VALUES(1)', { onStatement: () => { throw Error('消费者拒绝'); } })).rejects.toMatchObject({ code: 'SQLITE_CONSUMER_FAILED' });
    expect((await collect(session, 'SELECT count(*) FROM parent')).rows).toEqual([[{ type: 'integer', value: '0' }]]);
  });
  it('消费者错误在原生step前撤销，不把界面回调失败当成重放写入理由', async () => {
    const { path } = fixture(), session = await open(path);
    await expect(session.execute("INSERT INTO subject VALUES(1,'不得写入')", { onStatement() { throw Error('本例消费者拒绝'); } })).rejects.toMatchObject({ code: 'SQLITE_CONSUMER_FAILED' });
    expect(diskCount(path).count).toBe(0); expect(session.isClosed).toBe(false); expect(session.isBusy).toBe(false);
  });
  it('消费者内部等待取消不会形成等待环，后继查询仅在原消费者完成后放行', async () => {
    const { path } = fixture(), session = await open(path); let cancelled = false;
    await expect(session.execute('SELECT 1', { onStatement: async () => { const result = await session.cancel(); cancelled = result.mode === 'cooperative'; } })).rejects.toMatchObject({ code: 'SQLITE_CANCELLED' });
    expect(cancelled).toBe(true); expect(session.isBusy).toBe(false); expect((await collect(session, 'SELECT 2')).rows).toEqual([[{ type: 'integer', value: '2' }]]);
  });
});
