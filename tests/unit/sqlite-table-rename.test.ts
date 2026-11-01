import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { assertSqliteTableRenameFactTransition, sqliteTableRenameFactSchema, sqliteTableRenameInspectionSchema, sqliteTableRenamePreviewOutputSchema, sqliteTableRenameOutcomeSchema, type SqliteTableRenameInspectOutput, type SqliteTableRenamePreviewOutput, type SqliteTableRenameFact, type SqliteTableRenameOutcome } from '../../src/shared/sqliteTableRename';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('表重命名测试不能误启网络引擎或未登记的utility'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';
import { EngineBroker } from '../../src/main/broker';
import { SqliteWorkerCore } from '../../src/engine/sqlite/workerCore';
import { sqliteTableRenameLimits } from '../../src/shared/sqliteTableRename';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], applications = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只暂停或丢弃真实native回执，不补造DDL、提交或资源退出事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-rename-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 失败保留原实库，只有准确进程exit后才清理本例独占目录。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-table-rename-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers(); for (const app of applications) await app.forceClose(); applications.clear(); for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; } for (const directory of directories.splice(0)) if (!failed) remove(directory); });
afterAll(() => { if (!retained) remove(bundleDirectory); });
function fixture(sql = "CREATE TABLE target(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT COLLATE NOCASE,note TEXT,flag TEXT NOT NULL DEFAULT 'ok',obsolete TEXT,amount BLOB,gen TEXT GENERATED ALWAYS AS(code||':'||id) STORED,UNIQUE(code,id)); CREATE INDEX old_index ON target(code); CREATE TABLE child(c TEXT,pid INTEGER,FOREIGN KEY(c,pid) REFERENCES target(code,id)); CREATE TABLE audit(value TEXT); CREATE VIEW viewed AS SELECT code,note FROM target; CREATE TRIGGER tracked AFTER UPDATE OF code ON target BEGIN INSERT INTO audit VALUES(new.code); END; INSERT INTO target(id,code,note,obsolete,amount) VALUES(1,'a',NULL,'原旧列',9223372036854775807),(2,'b','中文','原旧列',X'00ff'); INSERT INTO child VALUES('a',1)"): SqliteConnectionProfile { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-rename-')); directories.push(directory); const path = join(directory, '原库中文🚢.sqlite'), db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); } return { id: '表重命名连接', name: '合成表重命名库', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 0 } }; }
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
function exists(profile: SqliteConnectionProfile, name: string): number { return disk(profile, db => Number(db.prepare('SELECT count(*) AS n FROM sqlite_schema WHERE name=?').get(name)!.n)); }
function data(profile: SqliteConnectionProfile, table = 'target') { return disk(profile, db => db.prepare('SELECT id,note,typeof(amount) AS type,CASE typeof(amount) WHEN \'integer\' THEN CAST(amount AS TEXT) ELSE hex(amount) END AS amount FROM "' + table.replaceAll('"','""') + '" ORDER BY id').all()); }
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void, intercept?: (message: SqliteWorkerRequest) => boolean): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume(); const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (!intercept?.(message)) child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function runtime(profile: SqliteConnectionProfile, createTransport: () => SqliteProcessTransport = transport) { const events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport, emit: event => events.push(structuredClone(event)) }); applications.add(app); return { app, events }; }
/** 仅RAM预算压力用同进程真实native内核；不把此adapter的关闭冒称OS子进程退出证据。 */
function nativeMemoryTransport(): SqliteProcessTransport {
  const closed = deferred<SqliteProcessExit>(); let listener: ((message: SqliteWorkerResponse) => void) | undefined;
  const core = new SqliteWorkerCore({ send: message => queueMicrotask(() => listener?.(message)), exit: code => { closed.resolve({ code, signal: null }); } });
  return { send: message => queueMicrotask(() => core.receive(message)), onMessage: receive => { listener = receive; queueMicrotask(() => receive({ kind: 'ready' })); return () => { listener = undefined; }; }, terminate: () => { core.disconnected(); return true; }, exited: closed.promise };
}
/** 只读核对会话内存数量/opaque摘要；不通过反射注入事实或伪造COMMIT。 */
function lineages(app: SqliteRuntime): ReadonlyMap<string, { navigationIdentity: string; signature: string; connectionId: string; table: string }> { return (app as unknown as { tableRenames: { lineages: ReadonlyMap<string, { navigationIdentity: string; signature: string; connectionId: string; table: string }> } }).tableRenames.lineages; }
async function inspect(app: SqliteRuntime, profile: SqliteConnectionProfile, table = 'target'): Promise<SqliteTableRenameInspectOutput> { return sqliteTableRenameInspectionSchema.parse(await app.request('sqlite.tableRename.inspect', { connectionId: profile.id, database: 'main', table, taskId: '表重命名目录' + ++serial, assertCurrent: () => {} })); }
async function preview(app: SqliteRuntime, catalogue: SqliteTableRenameInspectOutput, newName = '重命名表中文"🚢'): Promise<SqliteTableRenamePreviewOutput> { return sqliteTableRenamePreviewOutputSchema.parse(await app.request('sqlite.tableRename.preview', { catalogueId: catalogue.catalogueId, newName, taskId: '表重命名预览' + ++serial, assertCurrent: () => {} })); }
function apply(app: SqliteRuntime, value: SqliteTableRenamePreviewOutput, record?: (fact: SqliteTableRenameFact) => void) { const facts: SqliteTableRenameFact[] = [], input = { previewId: value.previewId, confirmation: value.confirmation, taskId: '表重命名提交' + ++serial, operationId: randomUUID(), assertCurrent: () => {}, recordTableRenameFact: (fact: SqliteTableRenameFact) => { sqliteTableRenameFactSchema.parse(fact); if (facts.length) assertSqliteTableRenameFactTransition(facts.at(-1)!, fact); record?.(fact); facts.push(structuredClone(fact)); } }; return { input, facts, result: (app.request('sqlite.tableRename.apply', input) as Promise<SqliteTableRenameOutcome>).then(value => sqliteTableRenameOutcomeSchema.parse(value)) }; }

describe('SQLite表重命名原生依赖、文件身份和准确事务事实', () => {
  it('真实A到B再到A只继承已ACK后目录，普通数据变化及五分钟cap到期不切断同一导航链', async () => {
    const profile = fixture(), { app } = runtime(profile), first = await inspect(app, profile); expect(first.navigationIdentity).toMatch(/^[a-f0-9]{64}$/);
    const firstPlan = await preview(app, first, '中间表'); expect(firstPlan.navigationIdentity).toBe(first.navigationIdentity); expect(await apply(app, firstPlan).result).toMatchObject({ outcome: 'committed', navigationIdentity: first.navigationIdentity, definitionVerified: true }); expect(lineages(app).size).toBe(1);
    disk(profile, db => db.exec('UPDATE "中间表" SET note=\'仅数据变化\' WHERE id=1'));
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    try {
      const middle = await inspect(app, profile, '中间表'); expect(middle.navigationIdentity).toBe(first.navigationIdentity); const next = await preview(app, middle, 'target'); expect(await apply(app, next).result).toMatchObject({ outcome: 'committed', navigationIdentity: first.navigationIdentity }); expect((await inspect(app, profile)).navigationIdentity).toBe(first.navigationIdentity); expect(disk(profile, db => db.prepare('SELECT note FROM target WHERE id=1').get()!.note)).toBe('仅数据变化');
    } finally { vi.useRealTimers(); }
  });

  it('交错两张表的已知重命名共同推进全库目录，回到原名分别保留各自opaque身份', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); CREATE TABLE other(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,\'甲\'); INSERT INTO other VALUES(2,\'乙\')'), { app } = runtime(profile), first = await inspect(app, profile), firstPlan = await preview(app, first, '中间甲'); expect((await apply(app, firstPlan).result).outcome).toBe('committed');
    const second = await inspect(app, profile, 'other'); expect(second.navigationIdentity).not.toBe(first.navigationIdentity); expect((await apply(app, await preview(app, second, '中间乙')).result).outcome).toBe('committed'); expect(lineages(app).size).toBe(2);
    const firstAgain = await inspect(app, profile, '中间甲'); expect(firstAgain.navigationIdentity).toBe(first.navigationIdentity); expect((await apply(app, await preview(app, firstAgain, 'target')).result).outcome).toBe('committed');
    const secondAgain = await inspect(app, profile, '中间乙'); expect(secondAgain.navigationIdentity).toBe(second.navigationIdentity); expect((await apply(app, await preview(app, secondAgain, 'other')).result).outcome).toBe('committed'); expect((await inspect(app, profile)).navigationIdentity).toBe(first.navigationIdentity); expect((await inspect(app, profile, 'other')).navigationIdentity).toBe(second.navigationIdentity);
  });

  it('DROP并同名CREATE即使rootpage复用也切断原链，connection.close后不继承旧会话身份', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原值')"), { app } = runtime(profile), first = await inspect(app, profile); expect((await apply(app, await preview(app, first, 'renamed')).result).outcome).toBe('committed');
    const before = disk(profile, db => ({ root: db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='renamed'").get()!.rootpage, schema: db.prepare('PRAGMA schema_version').get()!.schema_version }));
    disk(profile, db => db.exec("DROP TABLE renamed; CREATE TABLE renamed(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO renamed VALUES(2,'另一张表')"));
    const after = disk(profile, db => ({ root: db.prepare("SELECT rootpage FROM sqlite_schema WHERE name='renamed'").get()!.rootpage, schema: db.prepare('PRAGMA schema_version').get()!.schema_version })); expect(after.root).toBe(before.root); expect(after.schema).not.toBe(before.schema);
    const replaced = await inspect(app, profile, 'renamed'); expect(replaced.navigationIdentity).not.toBe(first.navigationIdentity); expect(lineages(app).size).toBe(0); expect((await apply(app, await preview(app, replaced, 'newtable')).result).outcome).toBe('committed'); expect(lineages(app).size).toBe(1);
    await app.request('connections.close', { id: profile.id }); expect(lineages(app).size).toBe(0); expect((await inspect(app, profile, 'newtable')).navigationIdentity).not.toBe(replaced.navigationIdentity);
  });

  it('未知COMMIT即使原写已落盘也清导航链，不从旧rootpage推测后继身份', async () => {
    const profile = fixture(), reached = deferred<void>(); let armed = false;
    const { app } = runtime(profile, () => transport((message, forward, record) => { const last = record.sent.filter(value => value.kind === 'execute').at(-1); if (armed && last?.kind === 'execute' && last.sql === 'COMMIT') { if (message.kind === 'statementEnd') { reached.resolve(); record.child.kill(); return; } if (message.kind === 'completed') return; } forward(); }));
    const first = await inspect(app, profile); expect((await apply(app, await preview(app, first, 'stage1')).result).outcome).toBe('committed'); expect(lineages(app).size).toBe(1); const current = await inspect(app, profile, 'stage1'); expect(current.navigationIdentity).toBe(first.navigationIdentity); const plan = await preview(app, current, 'stage2'); armed = true; const outcome = apply(app, plan); await reached.promise; expect(await outcome.result).toMatchObject({ outcome: 'unknown', navigationIdentity: first.navigationIdentity, definitionVerified: false }); expect(exists(profile, 'stage2')).toBe(1); expect(lineages(app).size).toBe(0);
    await app.request('connections.close', { id: profile.id }); expect((await inspect(app, profile, 'stage2')).navigationIdentity).not.toBe(first.navigationIdentity);
  });

  it('会话链RAM固定64条，真实native内核连续65次确认提交后淘汰最旧且close逐连接清零', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原值')"), { app } = runtime(profile, nativeMemoryTransport); let table = 'target'; const connections: string[] = [];
    for (let index = 0; index <= sqliteTableRenameLimits.lineages; index++) {
      profile.id = '有界导航连接' + index; connections.push(profile.id); const catalogue = await inspect(app, profile, table), name = '表' + index; expect((await apply(app, await preview(app, catalogue, name)).result).outcome).toBe('committed'); table = name; expect(lineages(app).size).toBe(Math.min(index + 1, sqliteTableRenameLimits.lineages));
    }
    expect([...lineages(app).values()].some(value => value.connectionId === connections[0])).toBe(false); expect([...lineages(app).values()].every(value => /^[a-f0-9]{64}$/.test(value.navigationIdentity) && /^[a-f0-9]{64}$/.test(value.signature))).toBe(true);
    for (const id of connections) await app.request('connections.close', { id }); expect(lineages(app).size).toBe(0); expect(disk(profile, db => db.prepare('SELECT note FROM "' + table + '"').get()!.note)).toBe('原值'); expect(processes).toHaveLength(0);
  });

  it('独立RO目录/预览零ALTER，提交原生更新外键/索引/触发器/视图并保留精确原值与自增水位', async () => {
    const profile = fixture(), before = data(profile), { app, events } = runtime(profile), catalogue = await inspect(app, profile);
    expect(catalogue.columns.find(column => column.name === 'gen')).toMatchObject({ hidden: 3 });
    expect(catalogue.relatedObjects).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'viewed', type: 'view' }), expect.objectContaining({ name: 'tracked', type: 'trigger' }), expect.objectContaining({ name: 'child', type: 'table' })]));
    expect(await processes[0].exited).toEqual({ code: 0, signal: null });
    const plan = await preview(app, catalogue); expect(plan).toMatchObject({ newName: '重命名表中文"🚢', confirmation: 'main.target' });
    expect(processes.every(record => !record.sent.some(message => message.kind === 'execute' && /^ALTER/i.test(message.sql)))).toBe(true); expect(data(profile)).toEqual(before);
    const operation = apply(app, plan); expect(await operation.result).toMatchObject({ outcome: 'committed', newName: plan.newName, definitionVerified: true, fact: { requestedStatements: 1, completedStatements: 1, commitAcknowledged: true } });
    expect(data(profile, plan.newName)).toEqual(before); expect(exists(profile, 'target')).toBe(0);
    const current = await inspect(app, profile, plan.newName); expect(current.columns).toEqual(catalogue.columns);
    disk(profile, db => { const quote = '"' + plan.newName.replaceAll('"', '""') + '"'; expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); expect(db.prepare("PRAGMA foreign_key_list('child')").all()[0].table).toBe(plan.newName); expect(db.prepare("SELECT sql FROM sqlite_schema WHERE name='old_index'").get()!.sql).toContain(plan.newName.replaceAll('"', '""')); db.exec('UPDATE ' + quote + " SET code='c' WHERE id=2"); expect(db.prepare('SELECT value FROM audit').all()).toEqual([{ value: 'c' }]); expect(db.prepare('SELECT code FROM viewed ORDER BY code').all()).toEqual([{ code: 'a' }, { code: 'c' }]); expect(db.prepare('SELECT name,seq FROM sqlite_sequence').all()).toEqual([{ name: plan.newName, seq: 2 }]); db.exec('INSERT INTO ' + quote + "(code) VALUES('next')"); expect(db.prepare('SELECT id FROM ' + quote + " WHERE code='next'").get()!.id).toBe(3); });
    const own = events.filter(event => event.taskId === operation.input.taskId); expect(own.at(-1)).toMatchObject({ status: 'completed', sqliteTableRename: { commitAcknowledged: true } }); expect(own.every(event => !event.executionSql && !event.message.includes(profile.sqlite.filePath!) && !event.message.includes(plan.newName))).toBe(true);
  });

  it('STRICT WITHOUT ROWID复合PK、生成列、表达式及部分索引保持原flags/root和数据', async () => {
    const profile = fixture("CREATE TABLE target(a TEXT,b INTEGER,note TEXT,gen TEXT GENERATED ALWAYS AS(a||b),PRIMARY KEY(a,b)) STRICT, WITHOUT ROWID; CREATE INDEX expr ON target(lower(a)) WHERE b>0; INSERT INTO target(a,b,note) VALUES('中文',7,'原值')"), { app } = runtime(profile), catalogue = await inspect(app, profile); expect(catalogue).toMatchObject({ strict: true, withoutRowid: true });
    const plan = await preview(app, catalogue, '新表'); expect((await apply(app, plan).result).outcome).toBe('committed'); const current = await inspect(app, profile, '新表'); expect(current).toMatchObject({ strict: true, withoutRowid: true, columns: catalogue.columns });
    expect(disk(profile, db => db.prepare('SELECT a,b,note,gen FROM 新表').all())).toEqual([{ a: '中文', b: 7, note: '原值', gen: '中文7' }]);
  });

  it('新名包含引号和SQL片段始终是一个标识符；表/视图/索引名称冲突在只读预览拒绝', async () => {
    const profile = fixture(), { app } = runtime(profile), catalogue = await inspect(app, profile);
    for (const name of ['child', 'CHILD', 'viewed', 'old_index']) await expect(preview(app, catalogue, name)).rejects.toThrow('占用');
    const before = processes.length; for (const name of ['', 'sqlite_user', 'SQLITE_user', '含\0名称']) await expect(preview(app, catalogue, name)).rejects.toThrow(); expect(processes).toHaveLength(before); await expect(preview(app, catalogue, 'target')).rejects.toThrow();
    const name = 't"; DROP TABLE child;--', plan = await preview(app, catalogue, name); expect((await apply(app, plan).result).outcome).toBe('committed'); expect(exists(profile, name)).toBe(1); expect(exists(profile, 'child')).toBe(1);
  });

  it('ASCII仅大小写改名沿用真实SQLite同名拒绝，回滚保留原FK拼写/自动索引名/原值', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE,parent INTEGER REFERENCES TaRgEt(id)); INSERT INTO target(id,code,parent) VALUES(1,\'原值\',NULL),(2,\'子值\',1)'), definitions = disk(profile, db => db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all());
    // 独立observer只在可回滚事务内取得本轮真实native行为，不用伪造版本或错误回执。
    disk(profile, db => { db.exec('BEGIN'); try { expect(() => db.exec('ALTER TABLE main.target RENAME TO TARGET')).toThrow(/already another table or index/i); } finally { db.exec('ROLLBACK'); } });
    const { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue, 'TARGET'); expect(plan.sql).toEqual(['ALTER TABLE main."target" RENAME TO "TARGET"']);
    expect(await apply(app, plan).result).toMatchObject({ outcome: 'rolled-back', definitionVerified: false, fact: { completedStatements: 0, rollbackAcknowledged: true, commitAcknowledged: false } });
    expect(disk(profile, db => db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all())).toEqual(definitions); expect(exists(profile, 'target')).toBe(1); expect(exists(profile, 'TARGET')).toBe(0); expect(disk(profile, db => db.prepare('SELECT id,code,parent FROM target ORDER BY id').all())).toEqual([{ id: 1, code: '原值', parent: null }, { id: 2, code: '子值', parent: 1 }]);
  });

  it('原FK大小写引用和自引用均原生改为准确新名，自动索引root/xinfo保留', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE,parent INTEGER REFERENCES TaRgEt(id)); CREATE TABLE child(pid INTEGER REFERENCES TARGET(id)); INSERT INTO target(id,code,parent) VALUES(1,\'原值\',NULL),(2,\'子值\',1); INSERT INTO child VALUES(2)'), { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue, 'MixedCase新表');
    expect((await apply(app, plan).result).outcome).toBe('committed'); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toEqual([]);
    disk(profile, db => { expect(db.prepare('PRAGMA foreign_key_list("MixedCase新表")').all()[0].table).toBe(plan.newName); expect(db.prepare('PRAGMA foreign_key_list(child)').all()[0].table).toBe(plan.newName); expect(db.prepare('SELECT id,code,parent FROM "MixedCase新表" ORDER BY id').all()).toEqual([{ id: 1, code: '原值', parent: null }, { id: 2, code: '子值', parent: 1 }]); });
  });

  it('不完整或有歧义的依赖由原生拒绝并确认rollback，不以writable_schema或正则修补', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO target VALUES(1,'原值'); CREATE VIEW broken AS SELECT n FROM missing"), { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue), definitions = disk(profile, db => db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all());
    expect(await apply(app, plan).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, rollbackAcknowledged: true } }); expect(disk(profile, db => db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all())).toEqual(definitions); expect(exists(profile, 'target')).toBe(1); expect(exists(profile, plan.newName)).toBe(0);
    expect(processes.flatMap(record => record.sent).every(message => message.kind !== 'execute' || !/writable_schema\s*=|legacy_alter_table\s*=|foreign_keys\s*=/i.test(message.sql))).toBe(true);
  });

  it('预览后合法数据和sequence增长允许保留；原既有FK违规仅按准确表名映射，不吞原违规', async () => {
    const profile = fixture(), { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue); disk(profile, db => {
      // 仅本例独立observer在事务外构造已存在的违规；产品worker始终保持foreign_keys=ON。
      db.exec('PRAGMA foreign_keys=OFF'); expect(db.prepare('PRAGMA foreign_keys').get()!.foreign_keys).toBe(0);
      db.exec("INSERT INTO target(code,note) VALUES('external','新数据'); INSERT INTO child VALUES('missing',99)");
    });
    expect((await apply(app, plan).result).outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT seq FROM sqlite_sequence WHERE name=?').get(plan.newName)!.seq)).toBe(3); expect(disk(profile, db => db.prepare('PRAGMA foreign_key_check').all())).toEqual([expect.objectContaining({ table: 'child', parent: plan.newName, rowid: 2 })]);
  });

  it('原目录变化在写锁内零DDL回滚，同路径文件替换not-sent；view/virtual/shadow/system拒绝写', async () => {
    const profile = fixture(), { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue); disk(profile, db => db.exec('CREATE INDEX outside_change ON target(note)')); expect(await apply(app, plan).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0 } });
    const next = await preview(app, await inspect(app, profile)); renameSync(profile.sqlite.filePath!, profile.sqlite.filePath! + '.原件'); const db = new DatabaseSync(profile.sqlite.filePath!); try { db.exec('CREATE TABLE target(id INTEGER PRIMARY KEY); CREATE VIEW viewed AS SELECT * FROM target; CREATE VIRTUAL TABLE fts USING fts5(value)'); } finally { db.close(); }
    expect((await apply(app, next).result).outcome).toBe('not-sent'); for (const table of ['viewed', 'fts', 'fts_data', 'sqlite_schema']) await expect(inspect(app, profile, table)).rejects.toThrow(); expect(exists(profile, next.newName)).toBe(0);
  });

  it('只读检查预览仍可用，错误确认/显式release单次消费且旧任务编号保墓碑', async () => {
    const profile = fixture(); profile.sqlite.readOnly = true; const { app } = runtime(profile), catalogue = await inspect(app, profile), plan = await preview(app, catalogue), count = processes.length; expect(catalogue.readOnly).toBe(true); const operation = apply(app, plan); expect((await operation.result).outcome).toBe('not-sent'); expect(processes).toHaveLength(count); expect(app.ownsTask(operation.input.taskId)).toBe(true); await expect(app.request('sqlite.tableRename.apply', { ...operation.input, taskId: '不重放' })).rejects.toThrow('失效');
    const released = await preview(app, catalogue); await app.request('sqlite.tableRename.release', { previewId: released.previewId }); await expect(apply(app, released).result).rejects.toThrow('失效'); await app.request('connections.close', { id: profile.id }); profile.sqlite.readOnly = false; const writer = await preview(app, await inspect(app, profile)), before = processes.length; expect((await apply(app, { ...writer, confirmation: 'main.其它表' }).result).outcome).toBe('not-sent'); expect(processes).toHaveLength(before);
  });

  it('独立busy0写连接不借用用户事务和TEMP，原事务回滚后明确新预览可执行', async () => {
    const profile = fixture(), { app } = runtime(profile), { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }); await app.request('query.execute', { sessionId, taskId: '原用户事务', sql: "CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(9); BEGIN; INSERT INTO target(code,note) VALUES('用户','未提交')", maxRows: 100 });
    const catalogue = await inspect(app, profile), plan = await preview(app, catalogue); expect((await apply(app, plan).result).outcome).toBe('not-sent'); expect(await app.request('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true }); expect((await app.request('query.execute', { sessionId, taskId: '原TEMP仍在', sql: 'SELECT n FROM marker', maxRows: 100 })).results[0].rows).toEqual([{ c0: '9' }]); expect(data(profile)).toHaveLength(2); await app.request('query.transaction', { sessionId, action: 'rollback' }); expect((await apply(app, await preview(app, catalogue)).result).outcome).toBe('committed'); expect(data(profile, plan.newName)).toHaveLength(2);
  });

  it('原ALTER header取消不stepDDL，确认回滚且旧task不能取消下一项重命名', async () => {
    const profile = fixture(), reached = deferred<void>(); let armed = false; const { app, events } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'statement' && message.sql.startsWith('ALTER TABLE')) { armed = false; reached.resolve(); } else forward(); })); const catalogue = await inspect(app, profile), plan = await preview(app, catalogue); armed = true; const operation = apply(app, plan); await reached.promise; await app.request('query.cancel', { taskId: operation.input.taskId }); expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 0, rollbackAcknowledged: true } }); expect(events.filter(event => event.taskId === operation.input.taskId).at(-1)?.status).toBe('cancelled'); expect(processes.at(-1)!.kills).toBe(0);
    const next = await preview(app, catalogue, '明确新表'); await app.request('query.cancel', { taskId: operation.input.taskId }); expect((await apply(app, next).result).outcome).toBe('committed');
  });

  it('COMMIT已发送后cancel/close/forceClose/release只等原ACK，不杀原写进程', async () => {
    const profile = fixture(), reached = deferred<void>(); let armed = false, release!: () => void; const { app } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'statement' && message.sql === 'COMMIT') { release = forward; reached.resolve(); } else forward(); })); const catalogue = await inspect(app, profile), plan = await preview(app, catalogue); armed = true; const operation = apply(app, plan); await reached.promise; const record = processes.at(-1)!, count = record.sent.length; let cancelled = false;
    const cancel = app.request('query.cancel', { taskId: operation.input.taskId }).then(() => { cancelled = true; }); await app.request('sqlite.tableRename.release', { catalogueId: catalogue.catalogueId }); const close = app.request('connections.close', { id: profile.id }), force = app.forceClose(); await delay(20); expect(cancelled).toBe(false); expect(record.kills).toBe(0); expect(record.sent).toHaveLength(count); release(); expect((await operation.result).outcome).toBe('committed'); await Promise.all([cancel, close, force]); expect(record.kills).toBe(0); expect(exists(profile, plan.newName)).toBe(1);
  });

  it.each([true, false])('COMMIT实际落盘后丢completed，statementEnd=%s保持ACK或unknown并撤销兄弟能力', async acknowledged => {
    const profile = fixture(); let armed = false; const { app } = runtime(profile, () => transport((message, forward, record) => { const last = record.sent.filter(value => value.kind === 'execute').at(-1); if (armed && last?.kind === 'execute' && last.sql === 'COMMIT') { if (message.kind === 'statementEnd') { if (acknowledged) forward(); record.child.kill(); return; } if (message.kind === 'completed') return; } forward(); })); const catalogue = await inspect(app, profile), plan = await preview(app, catalogue), sibling = await preview(app, catalogue, '兄弟能力'); armed = true;
    expect(await apply(app, plan).result).toMatchObject({ outcome: acknowledged ? 'committed' : 'unknown', cleanupWarning: true, newName: plan.newName, fact: { completedStatements: 1, commitMayHaveBeenSent: true, commitAcknowledged: acknowledged } }); expect(exists(profile, plan.newName)).toBe(1); await expect(apply(app, sibling).result).rejects.toThrow('失效');
  });

  it.each([false, true])('在途只读pin跨TTL自然回收不杀预览；显式release=%s撤销准确迟到能力', async revoked => {
    const profile = fixture(), reached = deferred<void>(); let hold = false, release!: () => void; const { app } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'statement' && message.sql === 'BEGIN') { hold = false; release = forward; reached.resolve(); } else forward(); })); const catalogue = await inspect(app, profile); hold = true; const pending = preview(app, catalogue), observed = pending.then(value => ({ value }), reason => ({ reason })); await reached.promise; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    try { await expect(preview(app, catalogue, '过期领取')).rejects.toThrow('失效'); if (revoked) await app.request('sqlite.tableRename.release', { catalogueId: catalogue.catalogueId }); release(); const result = await observed; if (revoked) expect('reason' in result).toBe(true); else { expect('value' in result).toBe(true); if ('value' in result) expect((await apply(app, result.value).result).outcome).toBe('committed'); } } finally { vi.useRealTimers(); }
  });

  it('同步持久拒绝阻止发送或回滚；已ACK后存储与close失败仍保原提交且隔离连接', async () => {
    const profile = fixture(), reached = deferred<void>(); let holdClose = false; const { app } = runtime(profile, () => transport(undefined, message => { if (holdClose && message.kind === 'close') { vi.useFakeTimers(); reached.resolve(); return true; } return false; })), catalogue = await inspect(app, profile);
    expect((await apply(app, await preview(app, catalogue), fact => { if (fact.phase === 'not-sent') throw Error('同步持久拒绝'); }).result).outcome).toBe('not-sent'); expect(await apply(app, await preview(app, catalogue), fact => { if (fact.phase === 'commit-pending') throw Error('COMMIT前持久拒绝'); }).result).toMatchObject({ outcome: 'rolled-back', fact: { completedStatements: 1, commitMayHaveBeenSent: false } });
    const next = await preview(app, catalogue); holdClose = true; const operation = apply(app, next, fact => { if (fact.phase === 'committed') throw Error('ACK后持久拒绝'); }); await reached.promise; try { await vi.advanceTimersByTimeAsync(5001); expect(await operation.result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); } finally { vi.useRealTimers(); } const count = processes.length; await expect(inspect(app, profile)).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(count); await app.request('connections.close', { id: profile.id }); expect(exists(profile, next.newName)).toBe(1);
  });

  it('broker四命令属于SQLite ledger，release越过退出屏障且不能误启网络引擎', async () => {
    const broker = new EngineBroker(() => {}, () => {}, () => undefined); await expect(broker.request('sqlite.tableRename.inspect', { connectionId: 'network', database: 'main', table: 'target', taskId: 'wrong-engine', assertCurrent: () => {} })).rejects.toThrow('SQLite缺少'); const close = broker.close(); await expect(broker.request('sqlite.tableRename.release', { catalogueId: 'unknown' })).resolves.toBeUndefined(); await close; expect(processes).toHaveLength(0);
  });
});
