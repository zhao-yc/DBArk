import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync, constants } from 'node:sqlite';
import { copySqliteCreateGuard, sqliteCreateGuardLimits, type SqliteCreateGuard } from '../../src/engine/sqlite/protocol';
import { build } from 'esbuild';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import type { SqliteExecutionResult, SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';

const directories: string[] = [], sessions = new Set<SqliteDriverSession>();
const processes: { child: ChildProcess; kills: number; exited: Promise<SqliteProcessExit> }[] = [];
let bundleDirectory: string, worker: string, retained = false;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-guard-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 只清理本例真实关闭后的精确目录，失败原件保留；不按进程名操作其它应用。 */
function removeDirectory(directory: string) { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-create-guard-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  vi.useRealTimers();
  for (const session of sessions) { if (session.isBusy) await session.cancel(); await session.close(); } sessions.clear();
  for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 独立临时磁盘库，原生打开读取；没有任何数据库服务器或用户配置。 */
function fixture(journal: 'DELETE' | 'WAL' = 'DELETE') { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-create-guard-')); directories.push(directory); const path = join(directory, 'sample.sqlite'); const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=' + journal); db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)'); db.close(); return { directory, path }; }
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

const guard = (kind: SqliteCreateGuard['kind'] = 'view', name = 'intended', allowedRelations = ['subject']): SqliteCreateGuard => ({ kind, name, allowedRelations });
/** 观察准确合成文件，不从待验连接内部缓存推断CREATE已落盘。 */
function definitions(path: string) { const db = new DatabaseSync(path); try { return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all(); } finally { db.close(); } }

describe('SQLite对象CREATE私有原生授权guard', () => {
  it('Node真实authorizer校准准确CREATE main/kind/name和trigger ON关系，不用正文ON关键词猜测', () => {
    const { path } = fixture(), db = new DatabaseSync(path), calls: { action: number; first: string | null; second: string | null; database: string | null; source: string | null }[] = [];
    try {
      db.exec('ALTER TABLE subject ADD COLUMN "on" TEXT; CREATE TABLE audit(note TEXT)');
      db.setAuthorizer((action, first, second, database, source) => { calls.push({ action, first, second, database, source }); return constants.SQLITE_OK; });
      db.exec('CREATE VIEW "原生视图" AS SELECT * FROM subject');
      db.exec("CREATE TRIGGER \"原生触发器\" AFTER UPDATE OF \"on\" ON subject BEGIN INSERT INTO audit VALUES('只在未来更新执行'); END");
      expect(calls.filter(call => call.action === constants.SQLITE_CREATE_VIEW)).toEqual([{ action: constants.SQLITE_CREATE_VIEW, first: '原生视图', second: null, database: 'main', source: null }]);
      expect(calls.filter(call => call.action === constants.SQLITE_CREATE_TRIGGER)).toEqual([{ action: constants.SQLITE_CREATE_TRIGGER, first: '原生触发器', second: 'subject', database: 'main', source: null }]);
      expect(calls.some(call => [constants.SQLITE_INSERT, constants.SQLITE_UPDATE].includes(call.action) && call.database === 'main' && ['sqlite_master', 'sqlite_schema'].includes(call.first ?? ''))).toBe(true);
      expect(db.prepare('SELECT * FROM audit').all()).toEqual([]);
    } finally { db.close(); }
  });

  it('准确main视图及完整带分号trigger正文可创建，CREATE不执行触发器，之后普通DML仍按原行为运行', async () => {
    const { path } = fixture(), session = await open(path); await session.execute('CREATE TABLE audit(note TEXT); ALTER TABLE subject ADD COLUMN "on" TEXT');
    const view = '视图"中文', trigger = '触发器"中文';
    expect((await session.execute('CREATE VIEW main."' + view.replaceAll('"', '""') + '" AS SELECT id,note FROM subject', { parameters: [], createGuard: guard('view', view) })).statements).toMatchObject([{ rows: 0, changes: '0' }]);
    expect((await session.execute('CREATE TRIGGER main."' + trigger.replaceAll('"', '""') + '" AFTER UPDATE OF "on" ON subject BEGIN INSERT INTO audit VALUES(\'内部;中文\'); INSERT INTO audit VALUES(\'第二句\'); END;', { parameters: [], createGuard: guard('trigger', trigger) })).statements).toHaveLength(1);
    expect((await collect(session, 'SELECT * FROM audit')).rows).toEqual([]); await session.execute("INSERT INTO subject(id,note) VALUES(1,'原值'); UPDATE subject SET \"on\"='变化' WHERE id=1"); expect((await collect(session, 'SELECT note FROM audit')).rows).toEqual([['内部;中文'], ['第二句']]); expect(definitions(path).filter(object => object.type === 'view' || object.type === 'trigger')).toHaveLength(2);
  });

  it.each([
    ['错误名称', 'CREATE VIEW wrong AS SELECT * FROM subject'],
    ['错误类型', 'CREATE TRIGGER intended AFTER INSERT ON subject BEGIN SELECT 1; END'],
    ['TEMP视图', 'CREATE TEMP VIEW intended AS SELECT * FROM subject'],
    ['TEMP触发器', 'CREATE TEMP TRIGGER intended AFTER INSERT ON subject BEGIN SELECT 1; END'],
    ['不同schema', 'CREATE VIEW temp.intended AS SELECT * FROM subject'],
    ['建表', 'CREATE TABLE intended(id INTEGER)'],
    ['建索引', 'CREATE INDEX intended ON subject(note)'],
    ['删除表', 'DROP TABLE subject'],
    ['改表', 'ALTER TABLE subject RENAME TO intended'],
    ['业务写入', "INSERT INTO subject VALUES(1,'拒绝')"],
    ['普通SELECT', 'SELECT 1'],
    ['EXPLAIN', 'EXPLAIN CREATE VIEW intended AS SELECT * FROM subject'],
    ['事务控制', 'BEGIN'],
    ['危险PRAGMA', 'PRAGMA foreign_keys=OFF'],
    ['附加库', "ATTACH ':memory:' AS extra"],
  ])('%s不能借guard执行其它目标或其它语句，失败后能力复位', async (_name, sql) => {
    const { path } = fixture(), before = definitions(path), session = await open(path); await expect(session.execute(sql, { parameters: [], createGuard: guard() })).rejects.toMatchObject({ completedStatements: 0 }); expect(definitions(path)).toEqual(before); expect(diskCount(path).count).toBe(0);
    await session.execute("INSERT INTO subject VALUES(8,'正常后续')"); expect(diskCount(path).count).toBe(1); expect((await collect(session, 'SELECT note FROM subject')).rows).toEqual([['正常后续']]);
  });

  it('trigger原生ON关系必须在准确白名单，UPDATE OF坏列允许CREATE但不冒称未来触发正确', async () => {
    const { path } = fixture(), session = await open(path); await session.execute('CREATE TABLE other(id INTEGER); CREATE TABLE audit(n INTEGER)');
    await expect(session.execute('CREATE TRIGGER intended AFTER INSERT ON other BEGIN SELECT 1; END', { parameters: [], createGuard: guard('trigger') })).rejects.toMatchObject({ code: 'SQLITE_CREATE_GUARD_DENIED', completedStatements: 0 });
    await session.execute('CREATE TRIGGER intended AFTER UPDATE OF nonexistent ON subject BEGIN INSERT INTO audit VALUES(1); END', { parameters: [], createGuard: guard('trigger') }); await session.execute("INSERT INTO subject VALUES(1,'原值'); UPDATE subject SET note='变化' WHERE id=1"); expect((await collect(session, 'SELECT n FROM audit')).rows).toEqual([]);
  });

  it('CREATE尾随第二句由原生sourceSQL单语句门在第一句step前拒绝，不发布任何CREATE', async () => {
    const { path } = fixture(), session = await open(path), before = definitions(path);
    await expect(session.execute("CREATE VIEW intended AS SELECT * FROM subject; INSERT INTO subject VALUES(1,'不得执行')", { parameters: [], createGuard: guard() })).rejects.toMatchObject({ code: 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', completedStatements: 0 }); expect(definitions(path)).toEqual(before); expect(diskCount(path).count).toBe(0);
    await session.execute('CREATE VIEW intended AS SELECT * FROM subject; -- 只有尾注释\n', { parameters: [], createGuard: guard() }); expect(definitions(path).some(object => object.type === 'view' && object.name === 'intended')).toBe(true);
  });

  it('显式空parameters强制模式，不能与named/nonempty/缺失参数或stream混用，RO guard不能授写', async () => {
    const { path } = fixture(), session = await open(path), readonly = await open(path, true), before = readFileSync(path);
    for (const options of [{ createGuard: guard() }, { parameters: ['x'], createGuard: guard() }, { namedParameters: {}, createGuard: guard() }]) await expect(session.execute('CREATE VIEW intended AS SELECT * FROM subject', options)).rejects.toMatchObject({ code: 'SQLITE_CREATE_GUARD_INVALID', completedStatements: 0 });
    await expect(readonly.streamRead('SELECT * FROM subject', { parameters: [], onBatch: () => {}, createGuard: guard() } as any)).rejects.toMatchObject({ code: 'SQLITE_CREATE_GUARD_INVALID' }); await expect(readonly.execute('CREATE VIEW intended AS SELECT * FROM subject', { parameters: [], createGuard: guard() })).rejects.toMatchObject({ completedStatements: 0 }); expect(readFileSync(path)).toEqual(before);
  });

  it('guard复制拒绝访问器/继承字段/稀疏数组/重复关系/保留系统名及超预算，复制后不随调用方数组改变', () => {
    let getters = 0; const raw = guard(); Object.defineProperty(raw, 'allowedRelations', { enumerable: true, get: () => { getters++; return ['subject']; } }); expect(() => copySqliteCreateGuard(raw)).toThrow(); expect(getters).toBe(0);
    for (const value of [Object.create(guard()), { ...guard(), extra: true }, { ...guard(), kind: {} }, { ...guard(), name: 'sqlite_bad' }, { ...guard(), name: '坏\0名' }, { ...guard(), allowedRelations: ['sqlite_sequence'] }, { ...guard(), allowedRelations: ['subject', 'SUBJECT'] }, { ...guard(), allowedRelations: new Array(1) }, { ...guard(), allowedRelations: Array.from({ length: sqliteCreateGuardLimits.relations + 1 }, (_, index) => 't' + index) }]) expect(() => copySqliteCreateGuard(value)).toThrow();
    const relations = ['subject'], copied = copySqliteCreateGuard({ kind: 'trigger', name: 'intended', allowedRelations: relations }); relations[0] = 'other'; expect(copied.allowedRelations).toEqual(['subject']);
  });

  it('CREATE header准确取消不step，随后普通写及另一guard执行证明能力finally复位', async () => {
    const { path } = fixture(), session = await open(path); let cancelled = false;
    await expect(session.execute('CREATE VIEW intended AS SELECT * FROM subject', { parameters: [], createGuard: guard(), onStatement: () => { cancelled = true; void session.cancel(); } })).rejects.toMatchObject({ code: 'SQLITE_CANCELLED', completedStatements: 0 }); expect(cancelled).toBe(true); expect(definitions(path).some(object => object.name === 'intended')).toBe(false);
    await session.execute("INSERT INTO subject VALUES(1,'取消后普通写')"); await session.execute('CREATE VIEW later AS SELECT * FROM subject', { parameters: [], createGuard: guard('view', 'later') }); expect((await collect(session, 'SELECT note FROM later')).rows).toEqual([['取消后普通写']]);
  });
});
