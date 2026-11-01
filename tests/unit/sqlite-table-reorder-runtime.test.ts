import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { copySqliteRebuildComparisonInput } from '../../src/engine/sqlite/rebuildComparison';
import { SqliteDriverSession } from '../../src/engine/sqlite/session';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteConnectionProfile } from '../../src/shared/contracts';
import { assertSqliteTableRebuildFactTransition, sqliteTableRebuildFactSchema, sqliteTableRebuildOutcomeSchema, sqliteTableRebuildLimits, type SqliteTableRebuildChange, type SqliteTableRebuildFact } from '../../src/shared/sqliteTableRebuild';
import { buildSqliteTableRebuildPlan, type SqliteTableRebuildNames } from '../../src/shared/sqliteTableRebuildExecutionPlan';
import { SqliteTableRebuild, inspectSqliteTableRebuild, verifySqliteTableRebuild, applySqliteTableRebuild, type SqliteTableRebuildClaim, type SqliteTableRebuildControl, type SqliteTableRebuildSnapshot } from '../../src/main/sqliteTableRebuild';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; received: SqliteWorkerResponse[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], sessions = new Set<SqliteDriverSession>();
let worker: string, bundleDirectory: string, retained = false;
/** 测试只使用本例独占合成文件；失败保留真实原件，退出后才清理准确目录。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-table-rebuild-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-rebuild-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers(); for (const session of sessions) { if (session.isBusy) await session.cancel(); if (session.isUsable && session.transaction === true) await session.execute('ROLLBACK'); try { await session.close(); } catch { await session.close(); } } sessions.clear(); for (const process of processes.splice(0)) { if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill(); await process.exited; } for (const directory of directories.splice(0)) if (!failed) remove(directory); });
afterAll(() => { if (!retained) remove(bundleDirectory); });
function names(): SqliteTableRebuildNames { const nonce = () => randomUUID().replaceAll('-', ''); return { candidate: '__dbark_rebuild_' + nonce(), ordinal: '__dbark_rebuild_order_' + nonce(), verificationCandidate: '__dbark_rebuild_' + nonce(), verificationOrdinal: '__dbark_rebuild_order_' + nonce() }; }
function fixture(sql = "CREATE TABLE target(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT DEFAULT '旧默认',amount BLOB,gen TEXT GENERATED ALWAYS AS(note||':'||id) STORED,UNIQUE(note,id)); CREATE INDEX kept_index ON target(note); CREATE TABLE audit(value TEXT); CREATE VIEW kept_view AS SELECT note,amount FROM target; CREATE TRIGGER kept_trigger AFTER UPDATE ON TARGET BEGIN INSERT INTO audit VALUES('不应触发'); END; CREATE TABLE outside(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT); INSERT INTO outside VALUES(88,'外部'); INSERT INTO target(id,note,amount) VALUES(1,'中文🚢',9223372036854775807),(2,NULL,X'00ff'),(9000,'高水位',NULL); DELETE FROM target WHERE id=9000"): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-rebuild-')); directories.push(directory); const path = join(directory, '原表中文🚢.sqlite'), db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); } return { id: '重建连接', name: '合成重建库', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 0 } };
}
function disk<T>(profile: SqliteConnectionProfile, action: (db: DatabaseSync) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
function schema(profile: SqliteConnectionProfile) { return disk(profile, db => db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_schema ORDER BY type,name').all()); }
function typed(profile: SqliteConnectionProfile, sql = 'SELECT _rowid_,id,note,typeof(amount),amount,gen FROM main.target ORDER BY _rowid_') { return disk(profile, db => { const statement = db.prepare(sql); statement.setReadBigInts(true); statement.setReturnArrays(true); return statement.all(); }); }
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key))), child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume(); const record: ProcessRecord = { child, sent: [], received: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage: listener => { const receive = (message: SqliteWorkerResponse) => { record.received.push(message); if (observe) observe(message, () => listener(message), record); else listener(message); }; child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function control(check: () => void = () => {}): SqliteTableRebuildControl { return { check, beginCleanup: () => {}, cleanupFailed: () => {}, beginCommit: () => {} }; }
async function open(profile: SqliteConnectionProfile, rebuild = false, create: () => SqliteProcessTransport = transport) { const options = { path: profile.sqlite.filePath!, readOnly: !rebuild, busyTimeoutMs: profile.sqlite.busyTimeoutMs }, session = await (rebuild ? SqliteDriverSession.openRebuild(create, options) : SqliteDriverSession.open(create, options)); sessions.add(session); return session; }
async function inspect(profile: SqliteConnectionProfile): Promise<SqliteTableRebuildSnapshot> { const driver = await open(profile), snapshot = await inspectSqliteTableRebuild(driver, profile, 'target', control()); await driver.close(); return snapshot; }
async function prepare(profile: SqliteConnectionProfile, changes: SqliteTableRebuildChange[] = [], columnOrder?: string[]) {
  const snapshot = await inspect(profile), store = new SqliteTableRebuild(), inspection = store.publish(snapshot), catalogue = store.catalogue(inspection.catalogueId), rebuildNames = names(), plan = store.preview(catalogue, changes, rebuildNames, columnOrder), claim = store.claim({ previewId: plan.previewId, confirmation: plan.confirmation, taskId: '重建提交' }); expect(plan.sql).toEqual(buildSqliteTableRebuildPlan(inspection, changes, rebuildNames, columnOrder).sql); return { snapshot, store, inspection, catalogue, plan, claim };
}
async function apply(profile: SqliteConnectionProfile, claim: SqliteTableRebuildClaim, options: { control?: SqliteTableRebuildControl; create?: () => SqliteProcessTransport; record?(fact: SqliteTableRebuildFact): void } = {}) {
  const writer = await open(profile, true, options.create), facts: SqliteTableRebuildFact[] = [], result = await applySqliteTableRebuild(writer, claim, { previewId: claim.id, confirmation: 'main.target', taskId: '重建提交', operationId: randomUUID(), assertCurrent: () => {}, recordRebuildFact: fact => { sqliteTableRebuildFactSchema.parse(fact); if (facts.length) assertSqliteTableRebuildFactTransition(facts.at(-1)!, fact); options.record?.(fact); facts.push(structuredClone(fact)); } }, options.control ?? control()); const parsed = sqliteTableRebuildOutcomeSchema.parse(result); if (writer.isUsable && writer.transaction === false) await writer.close(); return { result: parsed, facts, writer };
}
function noPrivateObjects(profile: SqliteConnectionProfile) { expect(disk(profile, db => db.prepare("SELECT name FROM main.sqlite_schema WHERE name LIKE '__dbark_rebuild_%'").all())).toEqual([]); }

describe('SQLite真实列重排事务与逐列名数据证明', () => {
  it('纯重排保留精确值、生成列、索引触发器原SQL、自增高水位及真实退出ACK', async () => {
    const profile = fixture(), data = typed(profile), kept = schema(profile).filter(row => ['kept_index', 'kept_trigger', 'kept_view', 'outside', 'audit'].includes(String(row.name))), sequence = disk(profile, db => db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all());
    const { plan, claim } = await prepare(profile, [], ['note', 'gen', 'amount', 'id']);
    expect(plan).toMatchObject({ changedOrder: true, changedTypes: 0, changedDefaults: 0 }); expect(plan.warnings.join(' ')).toContain('SELECT *'); expect(plan.warnings.join(' ')).toContain('INSERT');
    expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', definitionVerified: true, fact: { sourceRows: '2', copiedRows: '2', verifiedRows: '2', commitAcknowledged: true } });
    expect(typed(profile)).toEqual(data); expect(schema(profile).filter(row => kept.some(old => old.name === row.name)).map(({ rootpage: _root, ...row }) => row)).toEqual(kept.map(({ rootpage: _root, ...row }) => row));
    disk(profile, db => { expect(db.prepare("SELECT name FROM pragma_table_xinfo('target') ORDER BY cid").all().map(row => row.name)).toEqual(['note', 'gen', 'amount', 'id']); expect(db.prepare('SELECT * FROM target LIMIT 0').columns().map(column => column.name)).toEqual(['note', 'gen', 'amount', 'id']); expect(db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all()).toEqual(sequence); expect(db.prepare('SELECT * FROM audit').all()).toEqual([]); db.exec('INSERT INTO target(amount) VALUES(NULL)'); expect(db.prepare('SELECT note,id FROM target WHERE id=9001').get()).toEqual({ note: '旧默认', id: 9001 }); });
    noPrivateObjects(profile); const process = processes.at(-1)!; expect(process.received.find(message => message.kind === 'closed')).toMatchObject({ rebuildRestored: true }); expect(await process.exited).toEqual({ code: 0, signal: null }); expect(process.kills).toBe(0);
  });

  it('WITHOUT ROWID复合主键声明顺序不变，改变cid的显式表达式/partial索引按准确名称核对', async () => {
    const profile = fixture("CREATE TABLE target(a INTEGER,b TEXT COLLATE NOCASE,note TEXT DEFAULT '原',payload BLOB,PRIMARY KEY(b,a)) WITHOUT ROWID; CREATE INDEX kept ON target(note DESC,a) WHERE payload IS NOT NULL; CREATE INDEX expression_kept ON target(length(note),b COLLATE BINARY); INSERT INTO target VALUES(9223372036854775807,'乙','中文',X'00ff'),(-7,'甲',NULL,NULL)"), before = typed(profile, 'SELECT a,b,note,payload FROM target ORDER BY b COLLATE BINARY,a COLLATE BINARY'), { claim } = await prepare(profile, [], ['payload', 'note', 'b', 'a']);
    expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT a,b,note,payload FROM target ORDER BY b COLLATE BINARY,a COLLATE BINARY')).toEqual(before);
    expect(disk(profile, db => db.prepare("SELECT name,pk FROM pragma_table_xinfo('target') ORDER BY cid").all())).toEqual([{ name: 'payload', pk: 0 }, { name: 'note', pk: 0 }, { name: 'b', pk: 1 }, { name: 'a', pk: 2 }]); noPrivateObjects(profile);
  });

  it('多个inline UNIQUE随字段移动可交换自动索引编号，完整约束和重复多重性保持', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT UNIQUE,code BLOB UNIQUE,extra TEXT UNIQUE); INSERT INTO target VALUES(1,'甲',X'00ff',NULL),(2,NULL,NULL,'乙')"), before = typed(profile, 'SELECT id,note,code,extra FROM target ORDER BY id'), { claim } = await prepare(profile, [], ['extra', 'code', 'note', 'id']);
    expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT id,note,code,extra FROM target ORDER BY id')).toEqual(before);
    disk(profile, db => { expect(db.prepare("SELECT origin FROM pragma_index_list('target') WHERE origin='u'").all()).toHaveLength(3); for (const statement of ["INSERT INTO target(id,note) VALUES(3,'甲')", "INSERT INTO target(id,code) VALUES(3,X'00ff')", "INSERT INTO target(id,extra) VALUES(3,'乙')"]) expect(() => db.exec(statement)).toThrow(); }); noPrivateObjects(profile);
  });

  it('STRICT stored/virtual生成列可移至依赖字段之前，原值及标记逐列核对', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT DEFAULT '旧',stored TEXT AS(note||id) STORED,virtual INTEGER AS(length(note)) VIRTUAL) STRICT; INSERT INTO target(id,note) VALUES(-7,'中文'),(42,NULL)"), before = typed(profile, 'SELECT _rowid_,id,note,stored,virtual FROM target ORDER BY id'), { claim } = await prepare(profile, [], ['virtual', 'stored', 'note', 'id']);
    expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT _rowid_,id,note,stored,virtual FROM target ORDER BY id')).toEqual(before); expect(disk(profile, db => db.prepare("SELECT name,hidden FROM pragma_table_xinfo('target') ORDER BY cid").all())).toEqual([{ name: 'virtual', hidden: 2 }, { name: 'stored', hidden: 3 }, { name: 'note', hidden: 0 }, { name: 'id', hidden: 0 }]); noPrivateObjects(profile);
  });

  it('非IPK普通表真实负rowid与最大int64及BLOB/NULL在重排后不重新编号', async () => {
    const profile = fixture("CREATE TABLE target(note TEXT,payload BLOB); INSERT INTO target(_rowid_,note,payload) VALUES(-7,'负',X'00ff'),(9223372036854775807,NULL,NULL)"), before = typed(profile, 'SELECT _rowid_,note,payload FROM target ORDER BY _rowid_'), { claim } = await prepare(profile, [], ['payload', 'note']);
    expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT _rowid_,note,payload FROM target ORDER BY _rowid_')).toEqual(before); noPrivateObjects(profile);
  });

  it('重排可组合真实类型/default补丁，精确int64转TEXT后按新cid核验且未来行见新默认', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,amount INTEGER,note TEXT DEFAULT '旧'); INSERT INTO target VALUES(-7,9223372036854775807,NULL)"), { plan, claim } = await prepare(profile, [{ column: 'amount', declaredType: 'TEXT' }, { column: 'note', default: { kind: 'text', value: '新' } }], ['note', 'amount', 'id']);
    expect(plan).toMatchObject({ changedOrder: true, changedTypes: 1, changedDefaults: 1 }); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT note,amount,typeof(amount) AS storage,id FROM target').get())).toEqual({ note: null, amount: '9223372036854775807', storage: 'text', id: -7 }); disk(profile, db => { db.exec('INSERT INTO target(id) VALUES(8)'); expect(db.prepare('SELECT note FROM target WHERE id=8').get()).toEqual({ note: '新' }); }); noPrivateObjects(profile);
  });

  it('重排组合有损类型修改仍整批回滚，旧完整DDL/cid/数据保持且不重放preview', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,amount INTEGER,note TEXT); INSERT INTO target VALUES(1,9007199254740993,'精确')"), before = schema(profile), data = typed(profile, 'SELECT id,amount,note FROM target'), { store, plan, claim } = await prepare(profile, [{ column: 'amount', declaredType: 'REAL' }], ['note', 'id', 'amount']);
    expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { rollbackAcknowledged: true, commitAcknowledged: false, verifiedRows: '0' } }); expect(schema(profile)).toEqual(before); expect(typed(profile, 'SELECT id,amount,note FROM target')).toEqual(data); expect(() => store.claim({ previewId: plan.previewId, taskId: '不能重放', confirmation: plan.confirmation })).toThrow(); noPrivateObjects(profile);
  });

  it('inline外键native编号重排按完整语义及具体违规PK身份匹配，外部cascade和原触发器不执行', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE pa(id INTEGER PRIMARY KEY); CREATE TABLE pb(id INTEGER PRIMARY KEY); CREATE TABLE target(pk INTEGER PRIMARY KEY,a INTEGER REFERENCES pa(id),b INTEGER REFERENCES pb(id),note TEXT) WITHOUT ROWID; CREATE TABLE audit(n TEXT); CREATE TRIGGER kept AFTER DELETE ON target BEGIN INSERT INTO audit VALUES('不应触发'); END; CREATE TABLE child(pk INTEGER REFERENCES target(pk) ON DELETE CASCADE); INSERT INTO pa VALUES(1); INSERT INTO pb VALUES(2); INSERT INTO target VALUES(10,1,99,'原违规'),(20,1,2,'正确'); INSERT INTO child VALUES(10); PRAGMA foreign_keys=ON"), before = typed(profile, 'SELECT pk,a,b,note FROM target ORDER BY pk'), { claim } = await prepare(profile, [], ['b', 'note', 'pk', 'a']);
    expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT pk,a,b,note FROM target ORDER BY pk')).toEqual(before); disk(profile, db => { expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(1); expect(db.prepare('SELECT * FROM child').all()).toEqual([{ pk: 10 }]); expect(db.prepare('SELECT * FROM audit').all()).toEqual([]); }); noPrivateObjects(profile);
  });

  it.each([['id', 'note', 'amount', 'gen'], ['note', 'id'], ['note', 'gen', 'amount', 'id', 'extra'], ['note', 'note', 'amount', 'id'], ['Note', 'gen', 'amount', 'id']].map(order => [order] as const))('无效/原序列排列%j预览零写且不签能力', async order => {
    const profile = fixture(), snapshot = await inspect(profile), store = new SqliteTableRebuild(), inspection = store.publish(snapshot), before = schema(profile); expect(() => store.preview(store.catalogue(inspection.catalogueId), [], names(), order)).toThrow(); expect(schema(profile)).toEqual(before); noPrivateObjects(profile);
  });

  it('预览后外部DDL代次变化即使原列序相同也不能写，精确保留外部DDL', async () => {
    const profile = fixture(), { claim } = await prepare(profile, [], ['note', 'id', 'amount', 'gen']); disk(profile, db => db.exec('CREATE TABLE external_new(n TEXT)')); const before = schema(profile); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0 } }); expect(schema(profile)).toEqual(before); noPrivateObjects(profile);
  });

  it('真实writer要求准确candidateOrder，按名称核全值且不将extra ordinal当用户列', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT,payload BLOB); INSERT INTO target VALUES(-7,'中文',X'00ff'),(42,NULL,NULL)"), writer = await open(profile, true); await writer.execute('BEGIN IMMEDIATE');
    for (const sql of ['CREATE TABLE candidate(ord INTEGER NOT NULL,note TEXT,payload BLOB,id INTEGER PRIMARY KEY)', 'CREATE UNIQUE INDEX ord_unique ON candidate(ord)', 'INSERT INTO candidate(note,payload,id,ord) SELECT note,payload,id,ROW_NUMBER() OVER(ORDER BY id COLLATE BINARY ASC) FROM target']) await writer.execute(sql, { parameters: [] });
    const input = { source: 'target', candidate: 'candidate', candidateOrdinal: 'ord', columns: ['id', 'note', 'payload'], sourceOrder: ['id'], rowid: { source: 'id', candidate: 'id' } };
    await expect(writer.rebuildCompare(input)).rejects.toThrow(); await expect(writer.rebuildCompare({ ...input, candidateOrder: ['id', 'payload', 'note'] })).rejects.toThrow(); expect(await writer.rebuildCompare({ ...input, candidateOrder: ['note', 'payload', 'id'] })).toMatchObject({ sourceRows: '2', candidateRows: '2', verifiedRows: '2' });
    for (const order of [['note'], ['note', 'payload', 'id', 'ord'], ['note', 'note', 'id'], ['Note', 'payload', 'id']]) expect(() => copySqliteRebuildComparisonInput({ ...input, candidateOrder: order })).toThrow();
    const getter = vi.fn(() => 'note'), unsafe = ['note', 'payload', 'id']; Object.defineProperty(unsafe, '0', { enumerable: true, get: getter }); expect(() => copySqliteRebuildComparisonInput({ ...input, candidateOrder: unsafe })).toThrow(); expect(getter).not.toHaveBeenCalled(); await writer.execute('ROLLBACK'); await writer.close(); expect(schema(profile).some(row => row.name === 'candidate')).toBe(false);
  });
});
