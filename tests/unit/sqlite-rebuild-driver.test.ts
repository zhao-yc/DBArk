import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import { SqliteDriverSession, type SqliteStreamReadOptions } from '../../src/engine/sqlite/session';
import { sqliteDriverLimits, type SqliteOpenOptions, type SqliteProcessExit, type SqliteProcessTransport, type SqliteWorkerRequest, type SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteRebuildComparisonInput } from '../../src/engine/sqlite/rebuildComparison';
import { compileSqliteTableRebuildCopyDefinition } from '../../src/shared/sqliteTableRebuildPlan';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; received: SqliteWorkerResponse[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], sessions = new Set<SqliteDriverSession>();
const candidate = '__dbark_rebuild_0123456789abcdef0123456789abcdef', ordinal = '__dbark_ordinal_0123456789abcdef0123456789abcdef';
const q = (value: string) => '"' + value.replaceAll('"', '""') + '"';
let worker: string, bundleDirectory: string, retained = false;
/** 仅暂停准确真实回执，不模拟比较结果或提交、关闭事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-rebuild-driver-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 失败原文件保留；只删除本例准确退出后的独占临时目录。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-rebuild-driver-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers();
  for (const session of sessions) { if (session.isBusy) await session.cancel(); if (session.isRebuildWriter && session.isUsable && session.transaction === true) await session.execute('ROLLBACK'); try { await session.close(); } catch { await session.close(); } } sessions.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) remove(directory);
});
afterAll(() => { if (!retained) remove(bundleDirectory); });
function fixture(sql = "CREATE TABLE source(id INTEGER PRIMARY KEY,note TEXT,payload BLOB); INSERT INTO source VALUES(1,'中文🚢',X'00ff'),(2,NULL,NULL),(3,'精确',9223372036854775807)"): { path: string; options: SqliteOpenOptions } {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-rebuild-driver-')); directories.push(directory); const path = join(directory, '原库.sqlite'), db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); } return { path, options: { path, readOnly: false, busyTimeoutMs: 0 } };
}
function disk<T>(path: string, action: (db: DatabaseSync) => T): T { const db = new DatabaseSync(path); try { return action(db); } finally { db.close(); } }
function definitions(path: string) { return disk(path, db => db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all()); }
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void, intercept?: (message: SqliteWorkerRequest, record: ProcessRecord) => boolean): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume(); const record: ProcessRecord = { child, sent: [], received: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (!intercept?.(message, record)) child.send(message, error => { if (error) child.kill(); }); }, onMessage: listener => { const receive = (message: SqliteWorkerResponse) => { record.received.push(message); if (observe) observe(message, () => listener(message), record); else listener(message); }; child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
async function open(options: SqliteOpenOptions, rebuild = true, create: () => SqliteProcessTransport = transport) { const session = await (rebuild ? SqliteDriverSession.openRebuild(create, options) : SqliteDriverSession.open(create, options)); sessions.add(session); return session; }
async function collect(session: SqliteDriverSession, sql: string) { const rows: unknown[][] = []; const result = await session.execute(sql, { onBatch: batch => { rows.push(...batch.rows); } }); return { rows, result }; }
function input(columns = ['id', 'note', 'payload'], sourceOrder = ['_rowid_']): SqliteRebuildComparisonInput { return { source: 'source', candidate, sourceOrder, candidateOrdinal: ordinal, columns, rowid: { source: '_rowid_', candidate: '_rowid_' } }; }
/** 所有copy都来自原writer已取得锁的同一事务，额外序号无默认值且显式一对一填充。 */
async function prepare(session: SqliteDriverSession): Promise<void> { await session.execute('BEGIN IMMEDIATE'); await session.execute('CREATE TABLE main.' + q(candidate) + '(id INTEGER PRIMARY KEY,note TEXT,payload BLOB,' + q(ordinal) + ' INTEGER NOT NULL UNIQUE)'); await session.execute('INSERT OR ABORT INTO main.' + q(candidate) + '(id,note,payload,' + q(ordinal) + ') SELECT id,note,payload,ROW_NUMBER() OVER(ORDER BY id) FROM main.source'); }

describe('SQLite重建独立writer与无值完整比较内部协议', () => {
  it('普通open拒绝mode透传与readonly重建；普通writer和RO不能调用完整重建比较', async () => {
    const { options } = fixture();
    for (const mode of ['table-rebuild', undefined, 'other']) await expect(SqliteDriverSession.open(transport, { ...options, mode } as SqliteOpenOptions)).rejects.toThrow('模式'); await expect(SqliteDriverSession.openRebuild(transport, { ...options, readOnly: true })).rejects.toThrow('只读'); expect(processes).toHaveLength(0);
    const normal = await open(options, false), readonly = await open({ ...options, readOnly: true }, false); expect(normal.isRebuildWriter).toBe(false); expect(readonly.isRebuildWriter).toBe(false); await expect(normal.rebuildCompare(input())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARE_MODE' }); await expect(readonly.rebuildCompare(input())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARE_MODE' }); expect((await collect(normal, 'PRAGMA foreign_keys')).rows).toEqual([[{ type: 'integer', value: '1' }]]);
  });

  it('私有writer固定FKOFF/legacyON，公共PRAGMA setter、ATTACH和DQS门仍拒绝；close恢复确认且真实exit', async () => {
    const { options } = fixture(), session = await open(options); expect(session.isRebuildWriter).toBe(true); expect((await collect(session, 'PRAGMA foreign_keys')).rows).toEqual([[{ type: 'integer', value: '0' }]]); expect((await collect(session, 'PRAGMA legacy_alter_table')).rows).toEqual([[{ type: 'integer', value: '1' }]]);
    for (const sql of ['PRAGMA foreign_keys=ON', 'PRAGMA legacy_alter_table=OFF', 'PRAGMA writable_schema=ON', 'PRAGMA ignore_check_constraints=ON', 'PRAGMA temp_store=MEMORY', "ATTACH ':memory:' AS other", 'DETACH DATABASE main', 'SELECT "not_a_column"']) await expect(session.execute(sql)).rejects.toMatchObject({ completedStatements: 0 });
    await session.close(); const record = processes.at(-1)!; expect(record.received.find(message => message.kind === 'opened')).toMatchObject({ mode: 'table-rebuild', readOnly: false, transaction: false }); expect(record.received.find(message => message.kind === 'closed')).toMatchObject({ rebuildRestored: true }); expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0);
  });

  it('FKOFF删除父表不级联，legacyON候选改回原名不污染外部view/trigger/selfFK；ROLLBACK完整恢复', async () => {
    const { path, options } = fixture("CREATE TABLE source(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES source(id)); CREATE TABLE child(pid INTEGER REFERENCES source(id) ON DELETE CASCADE); CREATE TABLE audit(n INTEGER); CREATE VIEW external_view AS SELECT * FROM source; CREATE TRIGGER external_trigger AFTER INSERT ON audit BEGIN SELECT COUNT(*) FROM source; END; INSERT INTO source VALUES(1,NULL),(2,1); INSERT INTO child VALUES(2)"), before = definitions(path), session = await open(options);
    await session.execute('BEGIN IMMEDIATE'); await session.execute('CREATE TABLE ' + q(candidate) + '(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES source(id))'); await session.execute('INSERT OR ABORT INTO ' + q(candidate) + '(id,parent) SELECT id,parent FROM source'); await session.execute('DROP TABLE source'); expect((await collect(session, 'SELECT pid FROM child')).rows).toEqual([[{ type: 'integer', value: '2' }]]); await session.execute('ALTER TABLE ' + q(candidate) + ' RENAME TO source'); expect((await collect(session, 'PRAGMA foreign_key_list(source)')).rows[0]?.[2]).toBe('source');
    const current = (await collect(session, "SELECT sql FROM sqlite_schema WHERE name IN ('external_view','external_trigger','child') ORDER BY name")).rows.map(row => row[0]); expect(current).toEqual(before.filter(row => ['external_view', 'external_trigger', 'child'].includes(String(row.name))).sort((left, right) => String(left.name).localeCompare(String(right.name))).map(row => row.sql)); expect(current.every(sql => !String(sql).includes(candidate))).toBe(true);
    await session.execute('ROLLBACK'); await session.close(); expect(definitions(path)).toEqual(before); expect(disk(path, db => db.prepare('SELECT * FROM child').all())).toEqual([{ pid: 2 }]);
  });

  it('重建事务未收束时close立即拒绝且连接仍可显式ROLLBACK，再正常恢复保护关闭', async () => {
    const { path, options } = fixture(), before = definitions(path), session = await open(options); await prepare(session); await expect(session.close()).rejects.toMatchObject({ code: 'SQLITE_REBUILD_TRANSACTION_ACTIVE' }); expect(session.isUsable).toBe(true); expect(session.isClosed).toBe(false); expect(processes.at(-1)!.sent.filter(message => message.kind === 'close')).toHaveLength(0); await session.execute('ROLLBACK'); await session.close(); expect(definitions(path)).toEqual(before); expect(processes.at(-1)!.kills).toBe(0);
  });

  it('worker自身也拒绝事务内直接close，拒绝后能继续原事务显式回滚而不悬空closing', async () => {
    const { path, options } = fixture(), before = definitions(path), session = await open(options); await prepare(session); const record = processes.at(-1)!, response = deferred<SqliteWorkerResponse>();
    const receive = (message: SqliteWorkerResponse) => { if ('id' in message && message.id === 'direct-close') response.resolve(message); }; record.child.on('message', receive); record.child.send({ kind: 'close', id: 'direct-close' }); expect(await response.promise).toMatchObject({ kind: 'failed', code: 'SQLITE_REBUILD_TRANSACTION_ACTIVE', transaction: true, completedStatements: 0 }); record.child.off('message', receive);
    expect(record.received.filter(message => message.kind === 'closed')).toHaveLength(0); expect((await collect(session, 'SELECT COUNT(*) FROM source')).rows).toEqual([[{ type: 'integer', value: '3' }]]); await session.execute('ROLLBACK'); await session.close(); expect(definitions(path)).toEqual(before); expect(record.kills).toBe(0);
  });

  it('关闭回执缺少私有保护恢复确认时不能报正常关闭，保留协议失败并确认原进程退出', async () => {
    const { options } = fixture(), create = () => transport((message, forward) => { if (message.kind === 'closed') delete message.rebuildRestored; forward(); }), session = await open(options, true, create); await expect(session.close()).rejects.toMatchObject({ code: 'SQLITE_CLOSE_UNCONFIRMED' }); expect(session.isClosed).toBe(true); expect(processes.at(-1)!.kills).toBe(1); expect(processes.at(-1)!.sent.filter(message => message.kind === 'closeAck')).toHaveLength(0);
  });

  it('完整比较只交付计数及进度ACK，没有用户值、SQL、普通结果batch或隐藏事务控制', async () => {
    const { path, options } = fixture(), before = definitions(path), session = await open(options); await expect(session.rebuildCompare(input())).rejects.toMatchObject({ code: 'SQLITE_REBUILD_COMPARE_TRANSACTION' }); await prepare(session); const record = processes.at(-1)!, start = record.sent.length, progress: { comparedRows: string; columnGroups: number }[] = [];
    expect(await session.rebuildCompare(input(), { onProgress: value => { progress.push(value); } })).toEqual({ sourceRows: '3', candidateRows: '3', verifiedRows: '3', columnGroups: 1 }); expect(progress.at(-1)).toEqual({ comparedRows: '3', columnGroups: 1 });
    const request = record.sent.slice(start).find(message => message.kind === 'rebuildCompare')!; expect(request).not.toHaveProperty('sql'); const messages = record.received.filter(message => 'id' in message && message.id === request.id); expect(messages.every(message => !['statement', 'statementEnd', 'batch'].includes(message.kind))).toBe(true); expect(messages.filter(message => message.kind === 'rebuildProgress').every(message => record.sent.some(sent => sent.kind === 'ack' && sent.id === request.id && sent.frame === message.frame))).toBe(true); expect(session.transaction).toBe(true);
    await session.execute('ROLLBACK'); await session.close(); expect(definitions(path)).toEqual(before);
  });

  it('真实跨度编译经独立writer完整复制比较并提交，原typed行与rowid不变且只有后续插入采用新默认', async () => {
    const { path, options } = fixture("CREATE TABLE source(id INTEGER PRIMARY KEY,note TEXT DEFAULT '旧默认',payload BLOB,precise INTEGER); INSERT INTO source VALUES(-7,'中文🚢',X'00ff',9223372036854775807),(42,NULL,NULL,-9223372036854775808),(9223372036854775807,'原值',X'',NULL)");
    // 独立native连接提供真实原定义和xinfo，不手写候选DDL或用Number读取64位业务值。
    const original = disk(path, db => ({ tableSql: db.prepare("SELECT sql FROM main.sqlite_schema WHERE type='table' AND name='source'").get()!.sql as string, columns: db.prepare("SELECT name,hidden FROM pragma_table_xinfo('source','main') ORDER BY cid").all().map(row => ({ name: row.name as string, hidden: row.hidden as number })), xinfo: db.prepare("SELECT name,type,CAST(\"notnull\" AS TEXT) AS nn,dflt_value,CAST(pk AS TEXT) AS pk,CAST(hidden AS TEXT) AS hidden FROM pragma_table_xinfo('source','main') ORDER BY cid").all() }));
    const typed = () => disk(path, db => { const statement = db.prepare("SELECT _rowid_,typeof(id),id,typeof(note),note,CASE WHEN typeof(note)='text' THEN CAST(note AS BLOB) END,typeof(payload),payload,typeof(precise),precise FROM main.source ORDER BY _rowid_ COLLATE BINARY ASC"); statement.setReadBigInts(true); statement.setReturnArrays(true); return statement.all(); }), before = typed(), copyOrdinal = '__dbark_rebuild_order_0123456789abcdef0123456789abcdef', newDefault = '新默认🚢';
    const plan = compileSqliteTableRebuildCopyDefinition({ table: 'source', tableSql: original.tableSql, columns: original.columns, candidateName: candidate, changes: [{ column: 'note', default: { kind: 'text', value: newDefault } }] }, copyOrdinal), copied = plan.columnMapping.filter(column => column.copy).map(column => column.name);
    expect(copied).toEqual(['id', 'note', 'payload', 'precise']); expect(copied).not.toContain('_rowid_'); const session = await open(options); await session.execute('BEGIN IMMEDIATE'); await session.execute(plan.candidateSql, { parameters: [] }); await session.execute(plan.createOrdinalIndexSql, { parameters: [] });
    // id为真实INTEGER PRIMARY KEY，显式复制id即可保留rowid，不重复写隐藏rowid；序号按同一真实rowid全序生成。
    await session.execute('INSERT OR ABORT INTO main.' + q(candidate) + '(' + [...copied, copyOrdinal].map(q).join(',') + ') SELECT ' + copied.map(q).join(',') + ',ROW_NUMBER() OVER(ORDER BY "_rowid_" COLLATE BINARY ASC) FROM main."source"', { parameters: [] });
    expect(await session.rebuildCompare({ source: 'source', candidate, sourceOrder: ['_rowid_'], candidateOrdinal: copyOrdinal, columns: original.columns.map(column => column.name), rowid: { source: '_rowid_', candidate: '_rowid_' } })).toEqual({ sourceRows: '3', candidateRows: '3', verifiedRows: '3', columnGroups: 1 });
    for (const sql of plan.removeOrdinalSql) await session.execute(sql, { parameters: [] });
    const actual = (await collect(session, 'SELECT name,type,CAST("notnull" AS TEXT),dflt_value,CAST(pk AS TEXT),CAST(hidden AS TEXT) FROM pragma_table_xinfo(' + "'" + candidate + "','main') ORDER BY cid")).rows;
    expect(actual).toEqual(original.xinfo.map(row => [row.name, row.type, row.nn, row.name === 'note' ? "'" + newDefault + "'" : row.dflt_value, row.pk, row.hidden]));
    await session.execute('DROP TABLE main."source"', { parameters: [] }); await session.execute('ALTER TABLE main.' + q(candidate) + ' RENAME TO "source"', { parameters: [] }); const committed = await session.execute('COMMIT'); expect(committed.transaction).toBe(false); expect(committed.statements).toHaveLength(1); expect(session.transaction).toBe(false); await session.close();
    const record = processes.at(-1)!; expect(record.received.find(message => message.kind === 'closed')).toMatchObject({ rebuildRestored: true }); expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); expect(typed()).toEqual(before);
    // 在确认关闭后从独立连接执行新写入，旧三行未被默认值替换，未来行才采用新默认。
    expect(disk(path, db => { db.prepare('INSERT INTO main.source(id,payload,precise) VALUES(77,?,?)').run(Buffer.from([0xab, 0]), 7n); return db.prepare('SELECT note FROM main.source WHERE id=77').get()!.note; })).toBe(newDefault);
    expect(disk(path, db => db.prepare("SELECT name FROM main.sqlite_schema WHERE name IN (?,?)").all(candidate, plan.ordinalIndex))).toEqual([]);
  });

  it('原表总payload超过普通32MiB结果预算仍完整逐行比较，单值不越1MiB且不累积值到IPC', async () => {
    const rows = 4097, width = 8192, { path, options } = fixture('CREATE TABLE source(id INTEGER PRIMARY KEY,note TEXT,payload BLOB); WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<' + rows + ') INSERT INTO source SELECT n,\'批次\',zeroblob(' + width + ') FROM seq'); expect(rows * width).toBeGreaterThan(sqliteDriverLimits.resultBytes); const session = await open(options); await prepare(session); expect(await session.rebuildCompare(input())).toEqual({ sourceRows: String(rows), candidateRows: String(rows), verifiedRows: String(rows), columnGroups: 1 }); const record = processes.at(-1)!; expect(record.received.filter(message => message.kind === 'batch' && message.rows.length)).toHaveLength(0); await session.execute('ROLLBACK'); await session.close(); expect(disk(path, db => db.prepare('SELECT COUNT(*) AS n FROM source').get()!.n)).toBe(rows);
  });

  it('比较256列分组完整终态一致，私有native门支持1025列但公开结果门仍1024', async () => {
    const names = Array.from({ length: 257 }, (_, index) => 'c' + index), columns = names.map(name => q(name) + ' INTEGER').join(','), { options } = fixture('CREATE TABLE source(id INTEGER PRIMARY KEY,' + columns + '); INSERT INTO source(id,' + names.map(q).join(',') + ') VALUES(1,' + names.map((_, index) => String(index)).join(',') + ')'), session = await open(options); await session.execute('BEGIN IMMEDIATE'); await session.execute('CREATE TABLE ' + q(candidate) + '(id INTEGER PRIMARY KEY,' + columns + ',' + q(ordinal) + ' INTEGER NOT NULL UNIQUE)'); await session.execute('INSERT INTO ' + q(candidate) + ' SELECT *,1 FROM source'); expect(await session.rebuildCompare(input(['id', ...names]))).toEqual({ sourceRows: '1', candidateRows: '1', verifiedRows: '1', columnGroups: 2 });
    await session.execute('ROLLBACK'); const wide = Array.from({ length: 1025 }, (_, index) => 'w' + index + ' INTEGER').join(','); await session.execute('CREATE TABLE wide(' + wide + ')'); await expect(session.execute('SELECT * FROM wide LIMIT 0')).rejects.toMatchObject({ completedStatements: 0 }); await session.close();
  });

  it('WITHOUT ROWID按完整复合PK匹配ordinal，不能混入伪rowid或省略完整排序键', async () => {
    const { options } = fixture("CREATE TABLE source(a TEXT,b INTEGER,note TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO source VALUES('乙',2,'中文'),('甲',1,'原值')"), session = await open(options); await session.execute('BEGIN IMMEDIATE'); await session.execute('CREATE TABLE ' + q(candidate) + '(a TEXT,b INTEGER,note TEXT,' + q(ordinal) + ' INTEGER NOT NULL UNIQUE,PRIMARY KEY(a,b)) WITHOUT ROWID'); await session.execute('INSERT OR ABORT INTO ' + q(candidate) + '(a,b,note,' + q(ordinal) + ') SELECT a,b,note,ROW_NUMBER() OVER(ORDER BY a COLLATE BINARY,b COLLATE BINARY) FROM source');
    const request: SqliteRebuildComparisonInput = { source: 'source', candidate, sourceOrder: ['a', 'b'], candidateOrdinal: ordinal, columns: ['a', 'b', 'note'] }; expect(await session.rebuildCompare(request)).toEqual({ sourceRows: '2', candidateRows: '2', verifiedRows: '2', columnGroups: 1 }); await expect(session.rebuildCompare({ ...request, rowid: { source: '_rowid_', candidate: '_rowid_' } })).rejects.toMatchObject({ completedStatements: 0 }); await expect(session.rebuildCompare({ ...request, sourceOrder: ['a'] })).rejects.toMatchObject({ completedStatements: 0 }); expect(session.transaction).toBe(true); await session.execute('ROLLBACK');
  });

  it('普通worker直接伪造rebuildCompare和私有模式额外SQL输入均拒绝，不能借原事务绕过保护', async () => {
    const { options } = fixture(), normal = await open(options, false); await normal.execute('BEGIN'); const record = processes.at(-1)!, response = deferred<SqliteWorkerResponse>(); const receive = (message: SqliteWorkerResponse) => { if ('id' in message && message.id === 'forged-comparison') response.resolve(message); }; record.child.on('message', receive); record.child.send({ kind: 'rebuildCompare', id: 'forged-comparison', input: input() }); expect(await response.promise).toMatchObject({ kind: 'failed', code: 'SQLITE_REBUILD_COMPARE_MODE', completedStatements: 0 }); record.child.off('message', receive); await normal.execute('ROLLBACK'); await normal.close();
    const writer = await open(options); await prepare(writer); const privateRecord = processes.at(-1)!, rejected = deferred<SqliteWorkerResponse>(); const observe = (message: SqliteWorkerResponse) => { if ('id' in message && message.id === 'forged-sql') rejected.resolve(message); }; privateRecord.child.on('message', observe); privateRecord.child.send({ kind: 'rebuildCompare', id: 'forged-sql', input: input(), sql: 'DROP TABLE source' }); expect(await rejected.promise).toMatchObject({ kind: 'failed', code: 'SQLITE_REBUILD_COMPARE_INPUT' }); privateRecord.child.off('message', observe); expect((await collect(writer, 'SELECT COUNT(*) FROM source')).rows).toEqual([[{ type: 'integer', value: '3' }]]); await writer.execute('ROLLBACK');
  });

  it('进度consumer未完成保持busy，cancel可先取得原native终态但必须等consumer完成才能复用和close', async () => {
    const { path, options } = fixture(), session = await open(options); await prepare(session); const reached = deferred<void>(), release = deferred<void>(); let finished = false;
    const comparison = session.rebuildCompare(input(), { onProgress: async () => { reached.resolve(); await release.promise; } }).finally(() => { finished = true; }); const observed = comparison.catch(error => error); await reached.promise; await expect(session.execute('SELECT 1')).rejects.toMatchObject({ code: 'SQLITE_SESSION_UNAVAILABLE' }); await expect(session.close()).rejects.toMatchObject({ code: 'SQLITE_SESSION_BUSY' }); expect(await session.cancel()).toMatchObject({ mode: 'cooperative', sessionClosed: false, transaction: true, resources: 'confirmed' }); expect(finished).toBe(false); expect(session.isBusy).toBe(true); release.resolve(); expect(await observed).toMatchObject({ code: 'SQLITE_CANCELLED', completedStatements: 0 }); expect(session.isBusy).toBe(false); expect(session.transaction).toBe(true); expect(processes.at(-1)!.kills).toBe(0); await session.execute('ROLLBACK'); await session.close(); expect(disk(path, db => db.prepare('SELECT COUNT(*) AS n FROM source').get()!.n)).toBe(3);
  });

  it('进度consumer异常仍经原取消/终态框架报告，完整比较不能暗中提交或回滚', async () => {
    const { options } = fixture(), session = await open(options); await prepare(session); await expect(session.rebuildCompare(input(), { onProgress: () => { throw Error('准确进度消费者失败'); } })).rejects.toMatchObject({ code: 'SQLITE_CONSUMER_FAILED', completedStatements: 0 }); expect(session.transaction).toBe(true); expect(processes.at(-1)!.kills).toBe(0); await session.execute('ROLLBACK');
  });

  it.each(['rows', 'groups', 'ordinary'] as const)('终态%s伪比较事实触发原协议失效并准确终止，不移交给下一任务', async mode => {
    const { path, options } = fixture(); let armed = false; const create = () => transport((message, forward) => { if (armed && message.kind === 'completed') { armed = false; message.result.comparison = mode === 'ordinary' ? { sourceRows: '0', candidateRows: '0', verifiedRows: '0', columnGroups: 1 } : { ...message.result.comparison!, ...(mode === 'rows' ? { verifiedRows: '0' } : { columnGroups: 4 }) }; } forward(); }), session = await open(options, mode !== 'ordinary', create);
    if (mode === 'ordinary') { armed = true; await expect(session.execute('SELECT 1')).rejects.toMatchObject({ code: 'SQLITE_PROTOCOL_ERROR' }); } else { await prepare(session); armed = true; await expect(session.rebuildCompare(input())).rejects.toMatchObject({ code: 'SQLITE_PROTOCOL_ERROR' }); }
    expect(session.isClosed).toBe(true); expect(processes.at(-1)!.kills).toBe(1); await session.close(); expect(disk(path, db => db.prepare('SELECT COUNT(*) AS n FROM source').get()!.n)).toBe(3);
  });

  it('只读stream不能借比较入口或内部writer绕开结果范围；单值超1MiB时比较失败保原事务', async () => {
    const { options } = fixture('CREATE TABLE source(id INTEGER PRIMARY KEY,note TEXT,payload BLOB); INSERT INTO source VALUES(1,NULL,zeroblob(' + (sqliteDriverLimits.valueBytes + 1) + ')); CREATE TABLE ' + q(candidate) + '(id INTEGER PRIMARY KEY,note TEXT,payload BLOB,' + q(ordinal) + ' INTEGER NOT NULL UNIQUE); INSERT INTO ' + q(candidate) + ' SELECT *,1 FROM source'), session = await open(options); const stream: SqliteStreamReadOptions = { parameters: [], onBatch: () => {} }; await expect(session.streamRead('SELECT * FROM source', stream)).rejects.toMatchObject({ code: 'SQLITE_STREAM_REQUIRES_READONLY' }); await session.execute('BEGIN IMMEDIATE'); await expect(session.rebuildCompare(input())).rejects.toMatchObject({ completedStatements: 0 }); expect(session.transaction).toBe(true); await session.execute('ROLLBACK');
  });
});
