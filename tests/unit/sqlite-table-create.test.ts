import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTableCreateDesign, SqliteTableCreatePreviewOutput, SqliteTableCreateOutcome, SqliteTableCreateFact } from '../../src/shared/sqliteTableCreate';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteTableCreateApplyRequest } from '../../src/main/sqliteTableCreate';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite建表测试只能启动本例准确Node进程，不能误启网络引擎'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';
import { EngineBroker } from '../../src/main/broker';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], applications = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只同步准确消息/磁盘边界，不伪造DDL、COMMIT或取消终态。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-create-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 只清准确进程退出后的独占目录，失败保留原磁盘现场。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-table-create-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers(); for (const app of applications) await app.forceClose(); applications.clear(); for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; } for (const directory of directories.splice(0)) if (!failed) remove(directory); });
afterAll(() => { if (!retained) remove(bundleDirectory); });
function fixture(): SqliteConnectionProfile { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-create-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path); try { db.exec('CREATE TABLE base(id INTEGER PRIMARY KEY,note TEXT)'); } finally { db.close(); } return { id: '建表真实连接', name: '建表真实磁盘', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } }; }
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
/** 原请求与响应真实透传，可暂停原native header或丢末回执证明准确边界。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void, intercept?: (message: SqliteWorkerRequest) => boolean): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (!intercept?.(message)) child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function runtime(profile: SqliteConnectionProfile, createTransport: () => SqliteProcessTransport = transport) { const events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport, emit: event => events.push(structuredClone(event)) }); applications.add(app); return { app, events }; }
function design(name = '新"表中文'): SqliteTableCreateDesign { return { name, columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'note', declaredType: 'TEXT', nullable: true, default: { kind: 'text', value: "默认'中文\0🚢" } }, { name: 'payload', declaredType: 'BLOB', nullable: true, default: { kind: 'blob', value: '00ff' } }], primaryKey: ['id'], autoIncrement: true, indexes: [{ name: '索引_' + name, unique: false, columns: [{ name: 'note', order: 'asc' }] }], foreignKeys: [], strict: true, withoutRowid: false }; }
function preview(app: SqliteRuntime, profile: SqliteConnectionProfile, value = design(), assertCurrent = () => {}): Promise<SqliteTableCreatePreviewOutput> { return app.request('sqlite.tableCreate.preview', { connectionId: profile.id, database: 'main', taskId: '建表预览' + ++serial, design: value, assertCurrent }); }
function copyPreview(app: SqliteRuntime, profile: SqliteConnectionProfile, source: string, name: string, mode: 'structure' | 'data' = 'data'): Promise<SqliteTableCreatePreviewOutput> {
  return app.request('sqlite.tableCreate.preview', { connectionId: profile.id, database: 'main', taskId: '复制预览' + ++serial, copy: { source, name, mode }, assertCurrent: () => {} });
}
function apply(app: SqliteRuntime, value: SqliteTableCreatePreviewOutput, record?: (fact: SqliteTableCreateFact) => void) { const facts: SqliteTableCreateFact[] = [], input: SqliteTableCreateApplyRequest = { previewId: value.previewId, taskId: '建表提交' + ++serial, confirmation: value.confirmation, operationId: '操作' + serial, assertCurrent: () => {}, recordCreateFact: fact => { record?.(fact); facts.push(structuredClone(fact)); } }; return { input, facts, result: app.request('sqlite.tableCreate.apply', input) as Promise<SqliteTableCreateOutcome> }; }
function exists(profile: SqliteConnectionProfile, name: string): number { return disk(profile, db => Number(db.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE name=?').get(name)!.n)); }

describe('SQLite可视化建表真实只读预览、准确原子提交与一次性能力', () => {
  it('同文件复制精确结构和当前完整数据，重新绑定自引用且独立分配 AUTOINCREMENT', async () => {
    const profile = fixture(), { app } = runtime(profile);
    disk(profile, db => db.exec(`CREATE TABLE [原.表](id INTEGER PRIMARY KEY AUTOINCREMENT, parent INTEGER REFERENCES [原.表](id),
      value ANY, raw BLOB, memo TEXT DEFAULT 'REFERENCES 原.表', derived TEXT AS (memo || '副本') STORED) STRICT;
      CREATE UNIQUE INDEX [表达式索引] ON [原.表](lower(memo)) WHERE parent IS NOT NULL;
      CREATE TABLE log(value); CREATE TRIGGER 原触发 AFTER INSERT ON [原.表] BEGIN INSERT INTO log VALUES(new.id); END;
      INSERT INTO [原.表](id, value, raw) VALUES(9007199254740993,'0007',X'00FF');
      INSERT INTO [原.表](id, value, raw) VALUES(9007199254741000,NULL,X'');
      DELETE FROM [原.表] WHERE id=9007199254741000;`));
    const structure = await copyPreview(app, profile, '原.表', '仅结构', 'structure');
    expect(structure.sql).toHaveLength(2);
    expect(await apply(app, structure).result).toMatchObject({ outcome: 'committed', definitionVerified: true });
    expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM 仅结构').get()?.n)).toBe(0);
    const plan = await copyPreview(app, profile, '原.表', '副"表');
    expect(exists(profile, '副"表')).toBe(0);
    expect(plan.sql[0]).toContain('REFERENCES "副""表"(id)');
    expect(plan.sql[0]).toContain("DEFAULT 'REFERENCES 原.表'");
    expect(plan.sql[1]).toContain('ON "副""表" (lower(memo)) WHERE parent IS NOT NULL');
    disk(profile, db => db.exec("INSERT INTO [原.表](id,parent,value,raw,memo) VALUES(9007199254740994,9007199254740993,-0.0,X'','新增')"));
    expect(await apply(app, plan).result).toMatchObject({ outcome: 'committed', definitionVerified: true, message: expect.stringContaining('已复制 2 行') });
    disk(profile, db => {
      const read = (table: string) => db.prepare(`SELECT CAST(id AS TEXT) AS id, typeof(value) AS storage, value, hex(raw) AS raw, derived FROM ${table} ORDER BY id`).all();
      expect(read('"副""表"')).toEqual(read('[原.表]'));
      expect(Object.is(read('"副""表"')[1].value, -0)).toBe(true);
      expect(db.prepare(`SELECT "table" FROM pragma_foreign_key_list('副"表')`).get()?.table).toBe('副"表');
      expect(db.prepare(`SELECT count(*) AS n FROM sqlite_schema WHERE tbl_name='副"表' AND type='trigger'`).get()?.n).toBe(0);
      expect(db.prepare('INSERT INTO "副""表" DEFAULT VALUES RETURNING CAST(id AS TEXT) AS id').get()?.id).toBe('9007199254740995');
      expect(db.prepare("SELECT CAST(seq AS TEXT) AS seq FROM sqlite_sequence WHERE name='原.表'").get()?.seq).toBe('9007199254741000');
    });
  });

  it('保留可访问的隐式 rowid 和 WITHOUT ROWID，失败整批回滚且同名目标无覆盖', async () => {
    const profile = fixture(), { app } = runtime(profile);
    disk(profile, db => db.exec(`CREATE TABLE implicit(rowid TEXT, note TEXT CHECK(note <> '禁止'));
      INSERT INTO implicit(_rowid_,rowid,note) VALUES(-7,'声明字段','原行');
      CREATE TABLE keyed(a INTEGER, b TEXT, PRIMARY KEY(a,b)) STRICT, WITHOUT ROWID;
      INSERT INTO keyed VALUES(9223372036854775807,'复合键');`));
    expect(await apply(app, await copyPreview(app, profile, 'implicit', '隐式副本')).result).toMatchObject({ outcome: 'committed' });
    expect(await apply(app, await copyPreview(app, profile, 'keyed', '复合副本')).result).toMatchObject({ outcome: 'committed' });
    disk(profile, db => {
      expect(db.prepare('SELECT _rowid_ AS id,rowid,note FROM 隐式副本').all()).toEqual([{ id: -7, rowid: '声明字段', note: '原行' }]);
      expect(db.prepare("SELECT wr,strict FROM pragma_table_list WHERE name='复合副本'").get()).toEqual({ wr: 1, strict: 1 });
      expect(db.prepare('SELECT CAST(a AS TEXT) AS a,b FROM 复合副本').all()).toEqual([{ a: '9223372036854775807', b: '复合键' }]);
      db.exec("PRAGMA ignore_check_constraints=ON; INSERT INTO implicit VALUES('坏原行','禁止')");
    });
    const invalid = await copyPreview(app, profile, 'implicit', '失败副本');
    expect(await apply(app, invalid).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 1, commitAcknowledged: false } });
    expect(exists(profile, '失败副本')).toBe(0);
    const conflict = await copyPreview(app, profile, 'keyed', '竞争副本');
    disk(profile, db => db.exec("CREATE TABLE 竞争副本(marker TEXT); INSERT INTO 竞争副本 VALUES('保留')"));
    expect(await apply(app, conflict).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0 } });
    expect(disk(profile, db => db.prepare('SELECT marker FROM 竞争副本').get()?.marker)).toBe('保留');
  });

  it('表已创建但复制尚未执行时停止，回滚副本和索引并保留来源', async () => {
    const profile = fixture(), reached = deferred<void>();
    disk(profile, db => db.exec("CREATE INDEX 原索引 ON base(note); INSERT INTO base VALUES(3,'保留来源')"));
    const { app, events } = runtime(profile, () => transport((message, forward) => {
      if (message.kind === 'statement' && message.sql.startsWith('INSERT OR ABORT INTO')) reached.resolve();
      else forward();
    }));
    const plan = await copyPreview(app, profile, 'base', '取消副本');
    const operation = apply(app, plan);
    await reached.promise;
    await app.request('query.cancel', { taskId: operation.input.taskId });
    expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 2, rollbackAcknowledged: true } });
    expect(events.at(-1)?.status).toBe('cancelled');
    expect(exists(profile, '取消副本')).toBe(0);
    expect(disk(profile, db => db.prepare("SELECT name FROM sqlite_schema WHERE type='index'").all())).toEqual([{ name: '原索引' }]);
    expect(disk(profile, db => db.prepare('SELECT id,note FROM base').all())).toEqual([{ id: 3, note: '保留来源' }]);
  });

  it('只读预览零DDL、准确exit后发布，独立RW建表/index/storedSql/EXPLAIN检查后提交且默认精度可用', async () => {
    const profile = fixture(), { app, events } = runtime(profile), value = design(), plan = await preview(app, profile, value); expect(exists(profile, value.name)).toBe(0); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); expect(processes[0].sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } }); expect(processes[0].sent.some(message => message.kind === 'execute' && /CREATE|INSERT/.test(message.sql))).toBe(false);
    const operation = apply(app, plan), outcome = await operation.result; expect(outcome).toMatchObject({ outcome: 'committed', definitionVerified: true, fact: { requestedStatements: 2, completedStatements: 2, commitAcknowledged: true, commitMayHaveBeenSent: true, rollbackAcknowledged: false } }); expect(await processes[1].exited).toEqual({ code: 0, signal: null }); expect(processes[1].kills).toBe(0); expect(processes[1].sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: false } });
    const statements = processes[1].sent.filter(message => message.kind === 'execute').map(message => message.sql); expect(statements).toContain('EXPLAIN INSERT INTO "main"."新""表中文" DEFAULT VALUES'); expect(statements.filter(sql => sql.startsWith('CREATE'))).toEqual(plan.sql); expect(statements.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    disk(profile, db => { expect(db.prepare('SELECT count(*) AS n FROM "新""表中文"').get()!.n).toBe(0); db.exec('INSERT INTO "新""表中文" DEFAULT VALUES'); expect(db.prepare('SELECT id,note,hex(payload) AS payload FROM "新""表中文"').get()).toEqual({ id: 1, note: "默认'中文\0🚢", payload: '00FF' }); });
    expect(operation.facts.findIndex(fact => fact.phase === 'commit-pending')).toBeLessThan(operation.facts.findIndex(fact => fact.phase === 'committed')); const own = events.filter(event => event.taskId === operation.input.taskId); expect(own.at(-1)?.status).toBe('completed'); expect(own.every(event => !event.executionSql && !event.rows && !event.message.includes('默认') && !event.message.includes(profile.sqlite.filePath!))).toBe(true); await expect(app.request('sqlite.tableCreate.apply', { ...operation.input, taskId: '不重放' })).rejects.toThrow('失效');
  });

  it('ASCII NOCASE共享table/view/index占用拒绝，trigger独立命名空间仍能创建同名表', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW occupied_view AS SELECT * FROM base; CREATE INDEX occupied_index ON base(note); CREATE TRIGGER same_trigger AFTER INSERT ON base BEGIN SELECT 1; END'));
    const { app } = runtime(profile); for (const name of ['BASE', 'Occupied_View', 'oCCupied_Index']) await expect(preview(app, profile, design(name))).rejects.toThrow('占用'); const value = design('same_trigger'); expect((await apply(app, await preview(app, profile, value)).result).outcome).toBe('committed'); expect(exists(profile, 'same_trigger')).toBe(2);
  });

  it('目录版本变化及准确文件替换分别整批回滚/零发送，原preview均一次消费', async () => {
    const profile = fixture(), { app } = runtime(profile), first = await preview(app, profile); disk(profile, db => db.exec('CREATE INDEX changed_version ON base(note)')); expect(await apply(app, first).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, rollbackAcknowledged: true } }); expect(exists(profile, first.target.table)).toBe(0);
    const second = await preview(app, profile), path = profile.sqlite.filePath!, backup = join(dirname(path), 'preserved.sqlite'); renameSync(path, backup); const fresh = new DatabaseSync(path); try { fresh.exec('CREATE TABLE base(id INTEGER PRIMARY KEY,note TEXT)'); } finally { fresh.close(); } expect(await apply(app, second).result).toMatchObject({ outcome: 'not-sent', fact: { completedStatements: 0, commitAcknowledged: false } }); expect(exists(profile, second.target.table)).toBe(0);
  });

  it.each(['missing', 'not-unique', 'wrong-collation'] as const)('真实父外键%s在CREATE/index后EXPLAIN编译被拒，整批DDL回滚且无原INSERT', async mode => {
    const profile = fixture(); if (mode !== 'missing') disk(profile, db => db.exec(mode === 'wrong-collation' ? 'CREATE TABLE parent(k TEXT COLLATE NOCASE); CREATE UNIQUE INDEX parent_unique ON parent(k COLLATE BINARY)' : 'CREATE TABLE parent(k TEXT)'));
    const { app } = runtime(profile), value = design('child'); value.foreignKeys = [{ name: 'fk', columns: ['note'], referencedTable: 'parent', referencedColumns: ['k'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deferred: false }]; const plan = await preview(app, profile, value), result = await apply(app, plan).result;
    expect(result).toMatchObject({ outcome: 'rolled-back', definitionVerified: false, fact: { requestedStatements: 2, completedStatements: 2, rollbackAcknowledged: true, commitMayHaveBeenSent: false } }); expect(exists(profile, 'child')).toBe(0); expect(exists(profile, value.indexes[0].name)).toBe(0); expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql.startsWith('INSERT '))).toBe(false);
  });

  it('独立create忙0失败不借原用户事务，其原行/临时表仍在；明确rollback后自引用unique可提交', async () => {
    const profile = fixture(); profile.sqlite.busyTimeoutMs = 0; const { app } = runtime(profile), { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }); await app.request('query.execute', { sessionId, taskId: '用户原事务', sql: "CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(7); BEGIN; INSERT INTO base VALUES(1,'原事务')", maxRows: 100 });
    const value = design('self_reference'); value.indexes[0].unique = true; value.foreignKeys = [{ name: 'self_fk', columns: ['note'], referencedTable: value.name, referencedColumns: ['note'], onDelete: 'NO ACTION', onUpdate: 'NO ACTION', deferred: true }]; const plan = await preview(app, profile, value); expect(await apply(app, plan).result).toMatchObject({ outcome: 'not-sent', fact: { completedStatements: 0, commitMayHaveBeenSent: false } });
    expect(await app.request('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true }); expect((await app.request('query.execute', { sessionId, taskId: '原未提交行仍在', sql: 'SELECT id,note FROM base', maxRows: 100 })).results[0].rows).toEqual([{ c0: '1', c1: '原事务' }]); expect((await app.request('query.execute', { sessionId, taskId: '原临时表仍在', sql: 'SELECT n FROM marker', maxRows: 100 })).results[0].rows).toEqual([{ c0: '7' }]); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM base').get()!.n)).toBe(0);
    await app.request('query.transaction', { sessionId, action: 'rollback' }); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM base').get()!.n)).toBe(0); expect((await apply(app, await preview(app, profile, value)).result).outcome).toBe('committed');
  });

  it('STRICT WITHOUT ROWID复合主键可提交空表，EXPLAIN默认INSERT不执行NOT NULL失败的原DML', async () => {
    const profile = fixture(), { app } = runtime(profile), value = design('composite'); value.autoIncrement = false; value.withoutRowid = true; value.primaryKey = ['id', 'note']; value.columns[1].nullable = false; value.columns[1].default = { kind: 'none' };
    expect(await apply(app, await preview(app, profile, value)).result).toMatchObject({ outcome: 'committed', definitionVerified: true, fact: { completedStatements: 2 } });
    disk(profile, db => { expect(db.prepare("SELECT wr,strict FROM pragma_table_list WHERE name='composite'").get()).toEqual({ wr: 1, strict: 1 }); expect(db.prepare('SELECT count(*) AS n FROM composite').get()!.n).toBe(0); expect(() => db.exec('INSERT INTO composite DEFAULT VALUES')).toThrow(); db.exec("INSERT INTO composite(id,note) VALUES(1,'明确值')"); expect(db.prepare('SELECT id,note FROM composite').all()).toEqual([{ id: 1, note: '明确值' }]); });
  });

  it('readonly可预览但apply零RW拒，确认错误/释放/过期都消费或撤销准确能力且task墓碑防跨query复用', async () => {
    const profile = fixture(), { app } = runtime(profile), first = await preview(app, profile), wrong = apply(app, { ...first, confirmation: '错误确认' }); await expect(wrong.result).rejects.toThrow('失效'); expect(app.ownsTask(wrong.input.taskId)).toBe(true); await expect(app.request('sqlite.tableCreate.apply', { ...wrong.input, confirmation: first.confirmation, taskId: '旧预览重试' })).rejects.toThrow('失效');
    const a = await preview(app, profile), b = await preview(app, profile); await app.request('sqlite.tableCreate.release', { previewId: a.previewId }); await expect(apply(app, a).result).rejects.toThrow('失效'); expect((await apply(app, b).result).outcome).toBe('committed');
    const expired = await preview(app, profile, design('expired')); vi.useFakeTimers({ toFake: ['Date'] }); try { vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1); await expect(apply(app, expired).result).rejects.toThrow('失效'); } finally { vi.useRealTimers(); }
    await app.request('connections.close', { id: profile.id }); profile.sqlite.readOnly = true; const ro = await preview(app, profile, design('readonly')), count = processes.length; expect(ro.warnings.length).toBeGreaterThan(0); expect((await apply(app, ro).result).outcome).toBe('not-sent'); expect(processes).toHaveLength(count); expect(exists(profile, 'readonly')).toBe(0);
  });

  it('同步not-sent/commit-pending持久失败阻写或整批回滚，COMMIT后回调失败仍保ACK', async () => {
    const profile = fixture(), { app } = runtime(profile), first = await preview(app, profile); expect((await apply(app, first, fact => { if (fact.phase === 'not-sent') throw Error('同步落盘失败'); }).result).outcome).toBe('not-sent'); expect(processes.at(-1)!.sent.some(message => message.kind === 'execute')).toBe(false);
    const second = await preview(app, profile), operation = apply(app, second, fact => { if (fact.phase === 'commit-pending') throw Error('commit前同步落盘失败'); }); expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 2, commitMayHaveBeenSent: false, rollbackAcknowledged: true } }); expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false); expect(exists(profile, second.target.table)).toBe(0);
    const third = await preview(app, profile); expect(await apply(app, third, fact => { if (fact.phase === 'committed') throw Error('ACK后保存失败'); }).result).toMatchObject({ outcome: 'committed', definitionVerified: true, cleanupWarning: true, fact: { commitAcknowledged: true } });
  });

  it('COMMIT前准确取消在原DDL step前收束为整批ROLLBACK，零表/index残留', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false;
    const { app, events } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'statement' && message.sql.startsWith('CREATE TABLE')) { hold = false; reached.resolve(); } else forward(); })); const plan = await preview(app, profile); hold = true; const operation = apply(app, plan); await reached.promise; await app.request('query.cancel', { taskId: operation.input.taskId }); expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, rollbackAcknowledged: true } }); expect(events.at(-1)?.status).toBe('cancelled'); expect(exists(profile, plan.target.table)).toBe(0); expect(processes.at(-1)!.kills).toBe(0);
  });

  it('COMMIT边界cancel/close/forceClose只等原ACK，不杀原准确进程', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false, release!: () => void;
    const { app } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'statement' && message.sql === 'COMMIT') { release = forward; reached.resolve(); } else forward(); })); const plan = await preview(app, profile); hold = true; const operation = apply(app, plan); await reached.promise; const record = processes.at(-1)!, count = record.sent.length; let cancelled = false; const cancel = app.request('query.cancel', { taskId: operation.input.taskId }).then(() => { cancelled = true; }), close = app.request('connections.close', { id: profile.id }), force = app.forceClose(); await delay(20); expect(cancelled).toBe(false); expect(record.kills).toBe(0); expect(record.sent).toHaveLength(count); release(); expect((await operation.result).outcome).toBe('committed'); await Promise.all([cancel, close, force]); expect(record.kills).toBe(0); expect(exists(profile, plan.target.table)).toBe(1);
  });

  it.each([true, false])('真实COMMIT后丢completed，statementEnd=%s准确区分committed/unknown并禁止重放', async acknowledged => {
    const profile = fixture(); let armed = false; const { app } = runtime(profile, () => transport((message, forward, record) => { const sql = record.sent.filter(value => value.kind === 'execute').at(-1); if (armed && sql?.kind === 'execute' && sql.sql === 'COMMIT') { if (message.kind === 'statementEnd') { if (acknowledged) forward(); record.child.kill(); return; } if (message.kind === 'completed') return; } forward(); }));
    const plan = await preview(app, profile); armed = true; const operation = apply(app, plan); expect(await operation.result).toMatchObject({ outcome: acknowledged ? 'committed' : 'unknown', definitionVerified: acknowledged, fact: { completedStatements: 2, commitMayHaveBeenSent: true, commitAcknowledged: acknowledged, rollbackAcknowledged: false } }); expect(exists(profile, plan.target.table)).toBe(1); await expect(app.request('sqlite.tableCreate.apply', { ...operation.input, taskId: '未知不重放' })).rejects.toThrow('失效');
  });

  it('已提交但close未知仍返回ACK+warning并阻新建，显式close准确释放；broker release在shutdown可路由', async () => {
    const profile = fixture(), reached = deferred<void>(); let holdClose = false; const { app } = runtime(profile, () => transport(undefined, message => { if (holdClose && message.kind === 'close') { vi.useFakeTimers(); reached.resolve(); return true; } return false; })); const plan = await preview(app, profile); holdClose = true; const operation = apply(app, plan); await reached.promise; try { await vi.advanceTimersByTimeAsync(5001); expect(await operation.result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); } finally { vi.useRealTimers(); }
    const count = processes.length; await expect(app.request('sessions.open', { connectionId: profile.id, database: 'main' })).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(count); await app.request('connections.close', { id: profile.id }); expect(app.ownsConnection(profile.id)).toBe(false); expect(exists(profile, plan.target.table)).toBe(1);
    const broker = new EngineBroker(() => {}, () => {}, () => undefined); Object.defineProperty(broker, 'sqlite', { value: app }); const close = broker.close(); await expect(broker.request('sqlite.tableCreate.release', { previewId: plan.previewId })).resolves.toBeUndefined(); await close;
  });
});
