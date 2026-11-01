import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
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
async function prepare(profile: SqliteConnectionProfile, changes: SqliteTableRebuildChange[] = [{ column: 'note', default: { kind: 'text', value: '新默认' } }]) {
  const snapshot = await inspect(profile), store = new SqliteTableRebuild(), inspection = store.publish(snapshot), catalogue = store.catalogue(inspection.catalogueId), rebuildNames = names(), plan = store.preview(catalogue, changes, rebuildNames), claim = store.claim({ previewId: plan.previewId, confirmation: plan.confirmation, taskId: '重建提交' }); expect(plan.sql).toEqual(buildSqliteTableRebuildPlan(inspection, changes, rebuildNames).sql); return { snapshot, store, inspection, catalogue, plan, claim };
}
async function apply(profile: SqliteConnectionProfile, claim: SqliteTableRebuildClaim, options: { control?: SqliteTableRebuildControl; create?: () => SqliteProcessTransport; record?(fact: SqliteTableRebuildFact): void } = {}) {
  const writer = await open(profile, true, options.create), facts: SqliteTableRebuildFact[] = [], result = await applySqliteTableRebuild(writer, claim, { previewId: claim.id, confirmation: 'main.target', taskId: '重建提交', operationId: randomUUID(), assertCurrent: () => {}, recordRebuildFact: fact => { sqliteTableRebuildFactSchema.parse(fact); if (facts.length) assertSqliteTableRebuildFactTransition(facts.at(-1)!, fact); options.record?.(fact); facts.push(structuredClone(fact)); } }, options.control ?? control()); const parsed = sqliteTableRebuildOutcomeSchema.parse(result); if (writer.isUsable && writer.transaction === false) await writer.close(); return { result: parsed, facts, writer };
}
function noPrivateObjects(profile: SqliteConnectionProfile) { expect(disk(profile, db => db.prepare("SELECT name FROM main.sqlite_schema WHERE name LIKE '__dbark_rebuild_%'").all())).toEqual([]); }

describe('SQLite完整表重建事务、依赖与物理数据保护', () => {
  it('default-only完整重建保留所有typed行/生成列/附属SQL/序列高水位，未来行才见新默认', async () => {
    const profile = fixture(), before = typed(profile), kept = schema(profile).filter(row => ['kept_index', 'kept_trigger', 'kept_view', 'audit', 'outside', 'sqlite_sequence'].includes(String(row.name))), sequence = disk(profile, db => db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all()), prepared = await prepare(profile);
    expect((await apply(profile, prepared.claim)).result).toMatchObject({ outcome: 'committed', definitionVerified: true, fact: { sourceRows: '2', copiedRows: '2', verifiedRows: '2', commitAcknowledged: true, completedStatements: prepared.plan.sql.length } }); expect(typed(profile)).toEqual(before); expect(schema(profile).filter(row => kept.some(old => old.name === row.name)).map(({ rootpage: _root, ...row }) => row)).toEqual(kept.map(({ rootpage: _root, ...row }) => row));
    disk(profile, db => { expect(db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all()).toEqual(sequence); expect(db.prepare('SELECT * FROM audit').all()).toEqual([]); db.exec('INSERT INTO target(amount) VALUES(NULL)'); expect(db.prepare('SELECT id,note FROM target WHERE id=9001').get()).toEqual({ id: 9001, note: '新默认' }); }); noPrivateObjects(profile); const record = processes.at(-1)!; expect(record.received.find(message => message.kind === 'closed')).toMatchObject({ rebuildRestored: true }); expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0);
  });

  it('INTEGER转TEXT仅授权实际type补丁，最大int64保持十进制精确，default-only列不转换', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,amount INTEGER,note TEXT DEFAULT '旧'); INSERT INTO target VALUES(-7,9223372036854775807,'原值'),(42,-9223372036854775808,NULL)"), { claim } = await prepare(profile, [{ column: 'amount', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', fact: { sourceRows: '2', verifiedRows: '2' } }); expect(disk(profile, db => db.prepare('SELECT id,typeof(amount) AS storage,amount,note FROM target ORDER BY id').all())).toEqual([{ id: -7, storage: 'text', amount: '9223372036854775807', note: '原值' }, { id: 42, storage: 'text', amount: '-9223372036854775808', note: null }]); noPrivateObjects(profile);
  });

  it('INTEGER到REAL损失精度时原所有DDL/数据整批回滚，不以确认取代无损证明', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,amount INTEGER,note TEXT DEFAULT '旧'); INSERT INTO target VALUES(1,9007199254740993,'精确')"), before = schema(profile), data = typed(profile, 'SELECT id,amount,note FROM target'), { claim } = await prepare(profile, [{ column: 'amount', declaredType: 'REAL' }, { column: 'note', default: { kind: 'text', value: '新' } }]); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', definitionVerified: false, fact: { sourceRows: '1', copiedRows: '1', verifiedRows: '0', rollbackAcknowledged: true, commitMayHaveBeenSent: false } }); expect(schema(profile)).toEqual(before); expect(typed(profile, 'SELECT id,amount,note FROM target')).toEqual(data); noPrivateObjects(profile);
  });

  it.each([['0.5', 'committed'], ['0.1', 'rolled-back']] as const)('TEXT %s到REAL按精确有理值核验而非Number近似', async (value, outcome) => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'" + value + "')"), before = schema(profile), { claim } = await prepare(profile, [{ column: 'note', declaredType: 'REAL' }]); expect((await apply(profile, claim)).result.outcome).toBe(outcome); if (outcome === 'rolled-back') expect(schema(profile)).toEqual(before); noPrivateObjects(profile);
  });

  it('WITHOUT ROWID主键type改变导致2/10重排，双验证仍按新PK全序完整核对而非复用旧ordinal', async () => {
    const profile = fixture("CREATE TABLE target(a INTEGER,b TEXT,note TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO target VALUES(2,'乙','二'),(10,'甲','十'); CREATE INDEX kept ON target(note)"), { inspection, claim } = await prepare(profile, [{ column: 'a', declaredType: 'TEXT' }]); expect(inspection.rowIdentity).toEqual({ kind: 'primary-key', columns: ['a', 'b'] }); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', fact: { sourceRows: '2', verifiedRows: '2' } }); expect(disk(profile, db => db.prepare('SELECT a,b,note,typeof(a) AS storage FROM target ORDER BY a COLLATE BINARY,b COLLATE BINARY').all())).toEqual([{ a: '10', b: '甲', note: '十', storage: 'text' }, { a: '2', b: '乙', note: '二', storage: 'text' }]); expect(disk(profile, db => db.prepare("SELECT wr FROM pragma_table_list WHERE name='target'").get()!.wr)).toBe(1); noPrivateObjects(profile);
  });

  it('STRICT普通列type修改保持约束，stored/virtual生成列均参与严格值核验', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note INTEGER,stored TEXT AS ('固定') STORED,virtual TEXT AS ('固定') VIRTUAL) STRICT; INSERT INTO target VALUES(1,7)"), { claim } = await prepare(profile, [{ column: 'note', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT note,stored,virtual FROM target').get())).toEqual({ note: '7', stored: '固定', virtual: '固定' }); noPrivateObjects(profile);
  });

  it('依赖type的生成值改变即使原列无损转换也拒绝，不把未修改生成列纳入白名单', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,note INTEGER,gen TEXT AS (typeof(note)) STORED); INSERT INTO target(id,note) VALUES(1,7)'), before = schema(profile), { claim } = await prepare(profile, [{ column: 'note', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result.outcome).toBe('rolled-back'); expect(schema(profile)).toEqual(before); expect(disk(profile, db => db.prepare('SELECT note,gen FROM target').get())).toEqual({ note: 7, gen: 'integer' }); noPrivateObjects(profile);
  });

  it('普通无IPK表复制真实负/最大rowid，不能依赖隐式重新编号', async () => {
    const profile = fixture("CREATE TABLE target(note TEXT DEFAULT '旧'); INSERT INTO target(_rowid_,note) VALUES(-7,'负'),(9223372036854775807,'大')"), before = typed(profile, 'SELECT _rowid_,note FROM target ORDER BY _rowid_'), { inspection, claim } = await prepare(profile); expect(inspection.rowIdentity).toEqual({ kind: 'rowid', source: '_rowid_' }); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(typed(profile, 'SELECT _rowid_,note FROM target ORDER BY _rowid_')).toEqual(before); noPrivateObjects(profile);
  });

  it('selfFK、外部FK/view/trigger按原SQL保留，复制与DROP不会触发DELETE/cascade或审计', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,pid INTEGER REFERENCES target(id),note TEXT); CREATE TABLE child(pid INTEGER REFERENCES TARGET(id) ON DELETE CASCADE); CREATE TABLE audit(n TEXT); CREATE VIEW kept AS SELECT * FROM target; CREATE TRIGGER kept_delete AFTER DELETE ON TARGET BEGIN INSERT INTO audit VALUES('不能执行'); END; INSERT INTO target VALUES(1,NULL,'父'),(2,1,'子'); INSERT INTO child VALUES(2)"), kept = schema(profile).filter(row => ['child', 'audit', 'kept', 'kept_delete'].includes(String(row.name))), { claim } = await prepare(profile); expect((await apply(profile, claim)).result.outcome).toBe('committed'); disk(profile, db => { expect(db.prepare('SELECT * FROM child').all()).toEqual([{ pid: 2 }]); expect(db.prepare('SELECT * FROM audit').all()).toEqual([]); expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare('SELECT * FROM kept ORDER BY id').all()).toHaveLength(2); }); expect(schema(profile).filter(row => kept.some(value => value.name === row.name)).map(({ rootpage: _root, ...row }) => row)).toEqual(kept.map(({ rootpage: _root, ...row }) => row)); noPrivateObjects(profile);
  });

  it('WR子表NULL-rowid重复tuple从一条增至两条时按完整具体PK识别新违规并回滚', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT) WITHOUT ROWID; CREATE TABLE child(pk INTEGER PRIMARY KEY,parentid TEXT REFERENCES target(id)) WITHOUT ROWID; INSERT INTO target VALUES(1,'原'); INSERT INTO child VALUES(1,'bad'),(2,'01'); PRAGMA foreign_keys=ON"), before = schema(profile), rows = typed(profile, 'SELECT id,note FROM target'); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toHaveLength(1);
    const { claim } = await prepare(profile, [{ column: 'id', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { rollbackAcknowledged: true, commitMayHaveBeenSent: false } }); expect(schema(profile)).toEqual(before); expect(typed(profile, 'SELECT id,note FROM target')).toEqual(rows); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toHaveLength(1); noPrivateObjects(profile);
  });

  it('WR外键同数换行不能靠PRAGMA tuple multiset放行，REAL2.0父转TEXT使pk1修复但pk2新增违规须回滚', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE target(id BLOB PRIMARY KEY,note TEXT) WITHOUT ROWID; CREATE TABLE child(pk INTEGER PRIMARY KEY,parentid BLOB REFERENCES target(id)) WITHOUT ROWID; INSERT INTO target VALUES(2.0,'原'); INSERT INTO child VALUES(1,'2.0'),(2,2); PRAGMA foreign_keys=ON"), before = schema(profile), data = typed(profile, 'SELECT typeof(id),id,note FROM target'); expect(disk(profile, db => db.prepare('SELECT typeof(id) AS storage FROM target').get()!.storage)).toBe('real'); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toHaveLength(1);
    const { claim } = await prepare(profile, [{ column: 'id', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { rollbackAcknowledged: true, commitMayHaveBeenSent: false } }); expect(schema(profile)).toEqual(before); expect(typed(profile, 'SELECT typeof(id),id,note FROM target')).toEqual(data); expect(disk(profile, db => db.prepare('SELECT pk,typeof(parentid) AS storage,parentid FROM child ORDER BY pk').all())).toEqual([{ pk: 1, storage: 'text', parentid: '2.0' }, { pk: 2, storage: 'integer', parentid: 2 }]); noPrivateObjects(profile);
  });

  it('既有WR违规具体行保持时允许默认值重建，不把所有既有违规一概禁用', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT) WITHOUT ROWID; CREATE TABLE child(pk TEXT PRIMARY KEY,parentid INTEGER REFERENCES target(id)) WITHOUT ROWID; INSERT INTO target VALUES(1,'原'); INSERT INTO child VALUES('同一违规',99); PRAGMA foreign_keys=ON"), before = disk(profile, db => db.prepare('PRAGMA foreign_key_check').all()), { claim } = await prepare(profile); expect(before).toHaveLength(1); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toEqual(before); expect(disk(profile, db => db.prepare('SELECT * FROM child').all())).toEqual([{ pk: '同一违规', parentid: 99 }]); noPrivateObjects(profile);
  });

  it('目标本身为WR违规子表且PK实际获类型补丁时仅按已证明无损typed-key映射保原身份', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE target(pk INTEGER PRIMARY KEY,parentid INTEGER REFERENCES parent(id),note TEXT) WITHOUT ROWID; INSERT INTO parent VALUES(1); INSERT INTO target VALUES(2,99,'原'); PRAGMA foreign_keys=ON"), { claim } = await prepare(profile, [{ column: 'pk', declaredType: 'TEXT' }]); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT typeof(pk) AS storage,pk,parentid,note FROM target').all())).toEqual([{ storage: 'text', pk: '2', parentid: 99, note: '原' }]); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toHaveLength(1); noPrivateObjects(profile);
  });

  it('隐式复合父PK按原序映射，父NOCASE/INTEGER affinity与child大小写别名、NULL免检完整遵守', async () => {
    const profile = fixture("PRAGMA foreign_keys=OFF; CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原'); CREATE TABLE Parent(code TEXT COLLATE NOCASE,n INTEGER,PRIMARY KEY(code,n)) WITHOUT ROWID; CREATE TABLE Child(k TEXT COLLATE NOCASE,sub INTEGER,RefCode TEXT COLLATE BINARY,RefN TEXT,PRIMARY KEY(k,sub),FOREIGN KEY(REFCODE,REFN) REFERENCES PARENT) WITHOUT ROWID; INSERT INTO Parent VALUES('Ab',1); INSERT INTO Child VALUES('bad',9,'missing','1'),('good',1,'aB','01'),('null',2,NULL,'bad'); PRAGMA foreign_keys=ON"), before = disk(profile, db => db.prepare('PRAGMA foreign_key_check').all()), { claim } = await prepare(profile); expect(before).toHaveLength(1); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toEqual(before); expect(disk(profile, db => db.prepare('SELECT * FROM Child ORDER BY k COLLATE BINARY').all())).toHaveLength(3); noPrivateObjects(profile);
  });

  it('原序列缺失状态和负高水位均精确恢复，不取候选复制后的MAX代替', async () => {
    for (const value of [undefined, -7]) { const profile = fixture(); disk(profile, db => { db.exec("DELETE FROM sqlite_sequence WHERE name='target'"); if (value !== undefined) db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('target', BigInt(value)); }); const before = disk(profile, db => db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all()), { claim } = await prepare(profile); expect((await apply(profile, claim)).result.outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT rowid,name,seq FROM sqlite_sequence ORDER BY rowid').all())).toEqual(before); noPrivateObjects(profile); }
  });

  it.each([[-9223372036854775808n, -9223372036854775808n], [-7n, 9223372036854775807n]])('序列原负rowid %s与有符号边界水位%s均不经Number准确恢复', async (rowid, seq) => {
    const profile = fixture(); disk(profile, db => db.prepare("UPDATE main.sqlite_sequence SET rowid=?,seq=? WHERE name='target'").run(rowid, seq));
    const sequence = () => disk(profile, db => { const statement = db.prepare('SELECT rowid,name,typeof(seq),seq FROM main.sqlite_sequence ORDER BY rowid'); statement.setReadBigInts(true); statement.setReturnArrays(true); return statement.all(); }), before = sequence(), { inspection, claim } = await prepare(profile);
    expect(inspection.sequence).toEqual({ present: true, value: seq.toString() }); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', definitionVerified: true }); expect(sequence()).toEqual(before); noPrivateObjects(profile);
  });

  it('inspect/preview之后合法数据变化允许，写锁COUNT与完整copy/verify记录实际全部行', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原')"), { claim } = await prepare(profile); disk(profile, db => db.exec("INSERT INTO target VALUES(2,'后来')")); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', fact: { sourceRows: '2', copiedRows: '2', verifiedRows: '2' } }); expect(disk(profile, db => db.prepare('SELECT note FROM target ORDER BY id').all())).toEqual([{ note: '原' }, { note: '后来' }]); noPrivateObjects(profile);
  });

  it('外部DDL/drop-create同名即使root复用也拒绝旧预览，写锁后0个计划语句并真实ROLLBACK', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原')"), { claim } = await prepare(profile); disk(profile, db => db.exec("DROP TABLE target; CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'新表')")); const before = schema(profile); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, sourceRows: '0', rollbackAcknowledged: true } }); expect(schema(profile)).toEqual(before); expect(disk(profile, db => db.prepare('SELECT note FROM target').get()!.note)).toBe('新表'); noPrivateObjects(profile);
  });

  it('beforeCOMMIT事实持久化失败仍真实整批ROLLBACK，cleanup回调异常不能冒泡变not-sent', async () => {
    const profile = fixture(), before = schema(profile), rows = typed(profile), { claim } = await prepare(profile), ownControl = control(); ownControl.beginCleanup = () => { throw Error('准确cleanup回调异常'); }; const operation = await apply(profile, claim, { control: ownControl, record: fact => { if (fact.phase === 'commit-pending') throw Error('准确持久化异常'); } }); expect(operation.result).toMatchObject({ outcome: 'rolled-back', cleanupWarning: true, fact: { rollbackAcknowledged: true, completedStatements: claim.compiled.sql.length, commitAcknowledged: false } }); expect(schema(profile)).toEqual(before); expect(typed(profile)).toEqual(rows);
  });

  it('进度撤销经原native取消收束后真实ROLLBACK，不能复用原query事务或遗留验证表', async () => {
    const profile = fixture(), before = schema(profile), rows = typed(profile), { claim } = await prepare(profile); let revoked = false; const result = await apply(profile, claim, { control: control(() => { if (revoked) throw Error('本轮准确撤销'); }), create: () => transport((message, forward) => { if (message.kind === 'rebuildProgress') revoked = true; forward(); }) }); expect(result.result).toMatchObject({ outcome: 'rolled-back', fact: { rollbackAcknowledged: true, commitMayHaveBeenSent: false } }); expect(schema(profile)).toEqual(before); expect(typed(profile)).toEqual(rows); expect(processes.at(-1)!.kills).toBe(0); noPrivateObjects(profile);
  });

  it('RO预览只读取元数据不CREATE试写；verify在全schema变化后立即拒绝', async () => {
    const profile = fixture(), before = schema(profile), { snapshot, plan } = await prepare(profile); expect(plan.sql.length).toBeGreaterThan(10); expect(schema(profile)).toEqual(before); expect(processes.every(record => record.sent.every(message => message.kind !== 'execute' || !/^\s*(?:CREATE|INSERT|DROP|ALTER|DELETE)\b/i.test(message.sql)))).toBe(true); disk(profile, db => db.exec('CREATE TABLE outside_change(n TEXT)')); const driver = await open(profile); await expect(verifySqliteTableRebuild(driver, snapshot, control())).rejects.toThrow('失效'); expect(driver.transaction).toBe(false);
  });

  it('三个隐藏alias全遮蔽且无真实IPK时inspect拒绝；去掉最后IPK类型时preview拒绝不可证明身份', async () => {
    const profile = fixture('CREATE TABLE target(rowid TEXT,_rowid_ TEXT,oid TEXT,note TEXT)'), driver = await open(profile); await expect(inspectSqliteTableRebuild(driver, profile, 'target', control())).rejects.toThrow('rowid'); expect(driver.transaction).toBe(false);
    const other = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,rowid TEXT,_rowid_ TEXT,oid TEXT,note TEXT)'), snapshot = await inspect(other), store = new SqliteTableRebuild(), inspection = store.publish(snapshot); expect(inspection.rowIdentity).toEqual({ kind: 'rowid', source: 'id' }); expect(() => store.preview(store.catalogue(inspection.catalogueId), [{ column: 'id', declaredType: 'INT' }], names())).toThrow('rowid');
  });

  it('空WITHOUT ROWID表仍完整核验且记录真实零，不要求有数据才能重建默认值', async () => {
    const profile = fixture("CREATE TABLE target(key TEXT PRIMARY KEY,note TEXT DEFAULT '旧') WITHOUT ROWID"), { claim } = await prepare(profile); expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', fact: { sourceRows: '0', copiedRows: '0', verifiedRows: '0' } }); expect(disk(profile, db => db.prepare("SELECT dflt_value FROM pragma_table_xinfo('target') WHERE name='note'").get()!.dflt_value)).toBe("'新默认'"); noPrivateObjects(profile);
  });

  it('原文件写锁拒绝BEGIN时严格not-sent，释放后不自动重试或重放计划', async () => {
    const profile = fixture(), { claim } = await prepare(profile), before = schema(profile), blocker = new DatabaseSync(profile.sqlite.filePath!); blocker.exec('BEGIN IMMEDIATE');
    try { expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'not-sent', fact: { completedStatements: 0, sourceRows: '0', commitMayHaveBeenSent: false, rollbackAcknowledged: false } }); } finally { blocker.exec('ROLLBACK'); blocker.close(); }
    expect(schema(profile)).toEqual(before); expect(processes.at(-1)!.sent.filter(message => message.kind === 'execute' && message.sql === 'BEGIN IMMEDIATE')).toHaveLength(1); noPrivateObjects(profile);
  });

  it('完整计划拒绝把被污染的index/trigger目录SQL当作数据删除语句恢复', async () => {
    const profile = fixture(), { inspection } = await prepare(profile), original = schema(profile);
    for (const kind of ['index', 'trigger'] as const) { const source = structuredClone(inspection), target = source.relatedObjects.find(object => object.type === kind && object.sql !== null)!; target.sql = 'DELETE FROM main.outside'; expect(() => buildSqliteTableRebuildPlan(source, [{ column: 'note', default: { kind: 'none' } }], names())).toThrow(); }
    expect(schema(profile)).toEqual(original); expect(disk(profile, db => db.prepare('SELECT * FROM outside').all())).toEqual([{ id: 88, note: '外部' }]);
  });

  it.each([-1, 0])('原signed32 schema cookie %s真实读回后inspect/preview/verify/apply仍保持准确签名', async cookie => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT DEFAULT '旧'); INSERT INTO target VALUES(-7,'原值')"), original = typed(profile, 'SELECT _rowid_,id,note FROM target ORDER BY _rowid_');
    // 只有本例独占合成文件的setter关闭defensive；产品RO和writer仍按正常defensive=true打开。
    const setter = new DatabaseSync(profile.sqlite.filePath!, { defensive: false }); try { setter.exec('PRAGMA main.schema_version=' + cookie); expect(setter.prepare('PRAGMA main.schema_version').get()!.schema_version).toBe(cookie); } finally { setter.close(); }
    const { snapshot, claim } = await prepare(profile); expect(snapshot.facts.schemaVersion).toBe(String(cookie)); const verifier = await open(profile); await expect(verifySqliteTableRebuild(verifier, snapshot, control())).resolves.toBeUndefined(); expect(verifier.transaction).toBe(false); await verifier.close();
    expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'committed', definitionVerified: true, fact: { sourceRows: '1', copiedRows: '1', verifiedRows: '1' } }); expect(typed(profile, 'SELECT _rowid_,id,note FROM target ORDER BY _rowid_')).toEqual(original); expect(disk(profile, db => db.prepare("SELECT dflt_value FROM pragma_table_xinfo('target') WHERE name='note'").get()!.dflt_value)).toBe("'新默认'"); noPrivateObjects(profile);
  });

  it('schema cookie单独从零变负而目录/root原文不变也使旧预览失效，不能忽略负号签名', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原')"), setter = new DatabaseSync(profile.sqlite.filePath!, { defensive: false }); try { setter.exec('PRAGMA main.schema_version=0'); } finally { setter.close(); }
    const { claim } = await prepare(profile), before = schema(profile), changed = new DatabaseSync(profile.sqlite.filePath!, { defensive: false }); try { changed.exec('PRAGMA main.schema_version=-1'); expect(changed.prepare('PRAGMA main.schema_version').get()!.schema_version).toBe(-1); } finally { changed.close(); }
    expect((await apply(profile, claim)).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, sourceRows: '0', rollbackAcknowledged: true } }); expect(schema(profile)).toEqual(before); noPrivateObjects(profile);
  });

  it('TTL后的在途pin仍计预算，显式release命中过期原对象且阻止继续预览', async () => {
    const profile = fixture(), snapshot = await inspect(profile), store = new SqliteTableRebuild(), inspection = store.publish(snapshot), catalogue = store.catalogue(inspection.catalogueId), pin = store.pin(catalogue); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6 * 60 * 1000); expect(() => store.catalogue(inspection.catalogueId)).toThrow('失效'); expect(() => pin.check()).not.toThrow(); store.release({ catalogueId: inspection.catalogueId }); expect(() => pin.check()).toThrow('失效'); expect(() => store.preview(catalogue, [{ column: 'note', default: { kind: 'none' } }], names())).toThrow('失效'); pin.release(); pin.release();
  });

  it('299999ms签预览再等目录TTL后claim/pin重新预留真实字节，最后释放只扣一次且不能绕过64MiB', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT DEFAULT '" + '界'.repeat(100000) + "')"), snapshot = await inspect(profile), store = new SqliteTableRebuild(); vi.useFakeTimers(); const started = Date.now(), inspection = store.publish(snapshot), catalogue = store.catalogue(inspection.catalogueId), bytes = catalogue.bytes, budget = () => (store as unknown as { catalogueBytes: number }).catalogueBytes;
    expect(bytes).toBeGreaterThan(1000000); vi.setSystemTime(started + 299999); const preview = store.preview(catalogue, [{ column: 'note', default: { kind: 'none' } }], names()); vi.setSystemTime(started + 300001); const claim = store.claim({ previewId: preview.previewId, taskId: '过期目录提交', confirmation: preview.confirmation }); expect(budget()).toBe(0); const first = store.pin(claim.catalogue); expect(budget()).toBe(bytes);
    let filled = 0; for (;;) { try { store.publish(snapshot); filled++; } catch (reason) { expect(String(reason)).toContain('预算'); break; } } expect(filled).toBeGreaterThan(0); expect(filled).toBeLessThan(63); const full = budget(); expect(full).toBeLessThanOrEqual(sqliteTableRebuildLimits.catalogueBytes); first.release(); first.release(); expect(budget()).toBe(full - bytes);
    const replacement = store.publish(snapshot); expect(budget()).toBe(full); expect(() => store.pin(claim.catalogue)).toThrow('预算'); expect(budget()).toBe(full); store.release({ catalogueId: replacement.catalogueId }); const second = store.pin(claim.catalogue); expect(budget()).toBe(full); store.release({ catalogueId: claim.catalogue.id }); expect(() => second.check()).toThrow('失效'); second.release(); second.release(); expect(budget()).toBe(full - bytes); expect(budget()).toBeGreaterThanOrEqual(0);
  });
});
