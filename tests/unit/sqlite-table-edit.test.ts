import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableChange, SqliteTableEditOutcome, SqliteTableEditPreview, SqliteWriteFact } from '../../src/shared/sqliteTableEdit';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteEditApplyRequest } from '../../src/main/sqliteTableEdit';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite编辑单测必须使用准确真实Node进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只同步真实协议/磁盘操作边界，不伪造SQL或COMMIT成功。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-edit-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 仅删除本例独占目录，准确进程退出后才清理；失败保留原磁盘现场。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-edit-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const app of runtimes) await app.forceClose(); runtimes.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });
/** 原生SQLite真实seed含类型、默认值与生成列，后续独立连接核盘。 */
function fixture(): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-edit-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path);
  try { db.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT NOT NULL DEFAULT '默认',value,payload BLOB,generated INTEGER GENERATED ALWAYS AS (id*2) VIRTUAL); INSERT INTO subject(id,note,value,payload) VALUES(1,'原甲',9223372036854775807,x'00ff'),(2,'原乙',1.25,NULL); CREATE VIEW subject_view AS SELECT * FROM subject;"); } finally { db.close(); }
  return { id: '编辑真实源', name: '编辑真实磁盘', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 该观察连接独立于待验driver，不能用原事务缓存证明提交或回滚。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
/** 原消息仍出自真实worker；可截留准确边界以证明取消/ACK/退出竞态。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void, intercept?: (message: SqliteWorkerRequest) => boolean): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (!intercept?.(message)) child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
/** Main可信profile与真实transport是唯一外部能力，所有apply SQL都由后端生成。 */
function runtime(profile: SqliteConnectionProfile, create: () => SqliteProcessTransport = transport) { const events: TaskEvent[] = []; const app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: create, emit: event => events.push(structuredClone(event)) }); runtimes.add(app); return { app, events }; }
/** 默认只有显式editing=true才取得页能力，不伪造snapshot/schemaKey。 */
function page(app: SqliteRuntime, profile: SqliteConnectionProfile, table = 'subject', editing = true): Promise<SqliteTablePage> { return app.request('sqlite.tablePage', { connectionId: profile.id, database: 'main', table, taskId: '读取页' + ++serial, offset: 0, limit: 100, filters: [], mode: 'and', sort: [], ...(editing ? { editing: true } : {}) }); }
/** 公共快照只能从真实原页领取。 */
function snapshot(source: SqliteTablePage): string { expect(source.edit?.kind).toBe('editable'); if (source.edit?.kind !== 'editable') throw Error('本例没有可编辑快照'); return source.edit.snapshotId; }
function preview(app: SqliteRuntime, source: SqliteTablePage, changes: SqliteTableChange[]): Promise<SqliteTableEditPreview> { return app.request('sqlite.tableEdit.preview', { snapshotId: snapshot(source), taskId: '预览' + ++serial, changes }); }
/** 私有事实回调只存目标和计数；测试可让原持久回执失败，不伪造数据库ACK。 */
function apply(app: SqliteRuntime, plan: SqliteTableEditPreview, record?: (fact: SqliteWriteFact) => void) { const facts: SqliteWriteFact[] = []; const input: SqliteEditApplyRequest = { previewId: plan.previewId, confirmation: plan.confirmation, taskId: '写入' + ++serial, operationId: '操作' + serial, assertCurrent: () => {}, recordWriteFact: fact => { record?.(fact); facts.push(structuredClone(fact)); } }; return { input, facts, result: app.request('sqlite.tableEdit.apply', input) as Promise<SqliteTableEditOutcome> }; }
const update = (row: number, note: string): SqliteTableChange => ({ kind: 'update', row, values: [{ column: 'note', value: { kind: 'text', value: note } }] });
function notes(profile: SqliteConnectionProfile): unknown[] { return disk(profile, db => db.prepare('SELECT id,note FROM subject ORDER BY id').all()); }

describe('SQLite表格编辑真实快照、参数预览与整批提交事实', () => {
  it('显式非只读页才签typed快照，预览无SQL投递，混合增改删/默认/NULL/生成列及顶层changes真实提交', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE TABLE audit(note); CREATE TRIGGER changed AFTER UPDATE ON subject BEGIN INSERT INTO audit VALUES(NEW.note); END'));
    const { app, events } = runtime(profile); expect((await page(app, profile, 'subject', false)).edit).toBeUndefined(); const source = await page(app, profile);
    expect(source.edit).toMatchObject({ kind: 'editable', locator: { kind: 'rowid', columns: [] } });
    if (source.edit?.kind !== 'editable') throw Error('缺少原页'); expect(source.edit.rows[0][2]).toEqual({ kind: 'integer', value: '9223372036854775807' }); expect(source.edit.rows[0][3]).toEqual({ kind: 'blob', value: '00ff' }); expect(source.edit.columns.find(column => column.name === 'generated')?.generated).toBe(true);
    expect(source.result.columns.map(column => column.name)).not.toContain('__dbark_edit_locator');
    const count = processes.length, before = notes(profile), plan = await preview(app, source, [update(0, "明确'新甲\0🚢"), { kind: 'delete', row: 1 }, { kind: 'insert', values: [{ column: 'id', value: { kind: 'integer', value: '3' } }, { column: 'payload', value: { kind: 'null' } }] }]);
    expect(processes).toHaveLength(count); expect(notes(profile)).toEqual(before); expect(plan.counts).toEqual({ insert: 1, update: 1, delete: 1 }); expect(plan.sql[0]).toContain('char(0)'); expect(plan.sql).toHaveLength(3);
    const operation = apply(app, plan), outcome = await operation.result; expect(outcome.outcome).toBe('committed'); expect(outcome.fact).toMatchObject({ appliedRows: 3, commitAcknowledged: true, rollbackAcknowledged: false });
    // 独立观察器也显式保留BigInt，不能在验盘时先把64位值转成Number。
    expect(disk(profile, db => { const query = db.prepare('SELECT id,note,value,payload,generated FROM subject ORDER BY id'); query.setReadBigInts(true); return query.all().map(row => ({ ...row, id: String(row.id), value: row.value === null ? null : String(row.value), payload: row.payload instanceof Uint8Array ? Buffer.from(row.payload).toString('hex') : row.payload, generated: String(row.generated) })); })).toEqual([{ id: '1', note: "明确'新甲\0🚢", value: '9223372036854775807', payload: '00ff', generated: '2' }, { id: '3', note: '默认', value: null, payload: null, generated: '6' }]);
    expect(disk(profile, db => db.prepare('SELECT note FROM audit').get()!.note)).toBe("明确'新甲\0🚢"); expect(operation.facts.findIndex(fact => fact.phase === 'commit-pending')).toBeLessThan(operation.facts.findIndex(fact => fact.phase === 'committed'));
    expect(events.at(-1)?.status).toBe('completed'); await expect(app.request('sqlite.tableEdit.apply', { ...operation.input, taskId: '不重放' })).rejects.toThrow('失效'); await expect(preview(app, source, [update(0, '不可重领')])).rejects.toThrow('失效');
  });

  it('真正WITHOUT ROWID复合主键定位；外部改后继行使首行回滚，原快照仍可明确重新预览未冲突行', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE composite(a TEXT,b INTEGER,note TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID; INSERT INTO composite VALUES('a',1,'原一'),('b',2,'原二')"));
    const { app, events } = runtime(profile), source = await page(app, profile, 'composite'); expect(source.edit).toMatchObject({ kind: 'editable', locator: { kind: 'primary-key', columns: ['a', 'b'] } });
    const plan = await preview(app, source, [update(0, '本批一'), update(1, '本批二')]); disk(profile, db => db.exec("UPDATE composite SET note='外部二' WHERE a='b' AND b=2"));
    const failed = await apply(app, plan).result; expect(failed).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 1, rollbackAcknowledged: true, commitAcknowledged: false } }); expect(events.at(-1)?.status).toBe('failed');
    expect(disk(profile, db => db.prepare('SELECT note FROM composite ORDER BY a').all().map(row => row.note))).toEqual(['原一', '外部二']);
    const retry = await preview(app, source, [update(0, '明确重领原一')]); expect((await apply(app, retry).result).outcome).toBe('committed');
  });

  it('trigger改动后继原行被逐条重核发现，整批及trigger副作用全部回滚', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE audit(note); CREATE TRIGGER changed AFTER UPDATE ON subject WHEN NEW.id=1 BEGIN UPDATE subject SET note='触发器二' WHERE id=2; INSERT INTO audit VALUES('触发器副作用'); END"));
    const { app } = runtime(profile), source = await page(app, profile), before = notes(profile), plan = await preview(app, source, [update(0, '第一条'), update(1, '第二条')]);
    const outcome = await apply(app, plan).result; expect(outcome).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 1, rollbackAcknowledged: true } }); expect(notes(profile)).toEqual(before); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM audit').get()!.n)).toBe(0);
  });

  it('UNIQUE/FK或COMMIT前持久事实失败均整批回滚，失败不能偷偷发送COMMIT', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE UNIQUE INDEX unique_note ON subject(note)'));
    const { app } = runtime(profile), source = await page(app, profile), before = notes(profile);
    const duplicate = await preview(app, source, [update(0, '相同'), update(1, '相同')]); expect((await apply(app, duplicate).result).outcome).toBe('rolled-back'); expect(notes(profile)).toEqual(before);
    const pending = await preview(app, source, [update(0, '不得提交')]); const operation = apply(app, pending, fact => { if (fact.phase === 'commit-pending') throw Error('原事实同步保存失败'); });
    expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true } }); expect(notes(profile)).toEqual(before);
    expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false);
    disk(profile, db => db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)'));
    const child = await page(app, profile, 'child'), fk = await preview(app, child, [{ kind: 'insert', values: [{ column: 'id', value: { kind: 'integer', value: '1' } }, { column: 'parent_id', value: { kind: 'integer', value: '99' } }] }]);
    expect(await apply(app, fk).result).toMatchObject({ outcome: 'rolled-back', fact: { commitMayHaveBeenSent: true, commitAcknowledged: false, rollbackAcknowledged: true } }); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM child').get()!.n)).toBe(0);
  });

  it('视图/virtual/shadow/系统表/无可靠键及只读profile仅浏览，生成列和未知列不签写预览', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE VIRTUAL TABLE docs USING fts5(body); CREATE TABLE no_key(rowid,_rowid_,oid,note); CREATE TABLE sequence_owner(id INTEGER PRIMARY KEY AUTOINCREMENT)"));
    const { app } = runtime(profile); for (const table of ['subject_view', 'docs', 'docs_data', 'no_key', 'sqlite_sequence']) expect((await page(app, profile, table)).edit?.kind).toBe('readonly');
    const source = await page(app, profile); await expect(preview(app, source, [{ kind: 'update', row: 0, values: [{ column: 'generated', value: { kind: 'integer', value: '99' } }] }])).rejects.toThrow('生成列');
    await expect(preview(app, source, [{ kind: 'update', row: 0, values: [{ column: '不存在', value: { kind: 'null' } }] }])).rejects.toThrow('未知列');
    profile.sqlite.readOnly = true; const ro = runtime(profile); expect((await page(ro.app, profile)).edit?.kind).toBe('readonly');
    const plan = await preview(app, source, [update(0, '配置改变')]); const count = processes.length; expect((await apply(app, plan).result).outcome).toBe('not-sent'); expect(processes).toHaveLength(count);
  });

  it('原rowid三个别名均遮蔽时使用实际唯一键collation，不把NOCASE列扩大为多行匹配', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE unique_key(rowid,_rowid_,oid,k TEXT NOT NULL COLLATE NOCASE,note); CREATE UNIQUE INDEX exact_unique ON unique_key(k COLLATE BINARY); INSERT INTO unique_key VALUES(NULL,NULL,NULL,'a','小写'),(NULL,NULL,NULL,'A','大写')"));
    const { app } = runtime(profile), source = await page(app, profile, 'unique_key'); expect(source.edit).toMatchObject({ kind: 'editable', locator: { kind: 'unique-key', columns: ['k'] } });
    const plan = await preview(app, source, [update(0, '仅小写')]); expect((await apply(app, plan).result).outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT k,note FROM unique_key ORDER BY k COLLATE BINARY').all())).toEqual([{ k: 'A', note: '大写' }, { k: 'a', note: '仅小写' }]);
  });

  it('真实文件替换与schema_version变化均拒旧页，预览过期/释放不能重领', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile), plan = await preview(app, source, [update(0, '旧页')]);
    disk(profile, db => db.exec('CREATE INDEX changed_schema ON subject(note)')); expect((await apply(app, plan).result).outcome).toBe('rolled-back');
    const next = await page(app, profile), replacement = await preview(app, next, [update(0, '不得改新文件')]); const path = profile.sqlite.filePath!, backup = join(dirname(path), 'original-kept.sqlite'); expect(dirname(resolve(backup))).toBe(dirname(resolve(path))); renameSync(path, backup);
    const fresh = new DatabaseSync(path); try { fresh.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT,value,payload BLOB,generated INTEGER GENERATED ALWAYS AS(id*2) VIRTUAL); INSERT INTO subject(id,note) VALUES(1,'新文件')"); } finally { fresh.close(); }
    expect((await apply(app, replacement).result).outcome).toBe('not-sent'); expect(notes(profile)).toEqual([{ id: 1, note: '新文件' }]);
    const current = await page(app, profile), expired = await preview(app, current, [update(0, '过期')]); vi.useFakeTimers({ toFake: ['Date'] });
    try { vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1); await expect(apply(app, expired).result).rejects.toThrow('失效'); } finally { vi.useRealTimers(); }
    const released = await preview(app, current, [update(0, '释放')]); await app.request('sqlite.tableEdit.release', { snapshotId: snapshot(current) }); await expect(apply(app, released).result).rejects.toThrow('失效');
  });

  it('COMMIT ACK后的事实回调失败仍返回committed+warning，来源和兄弟预览永久撤销', async () => {
    const profile = fixture(), { app, events } = runtime(profile), source = await page(app, profile), first = await preview(app, source, [update(0, '真实提交')]), sibling = await preview(app, source, [update(1, '旧兄弟')]);
    const operation = apply(app, first, fact => { if (fact.phase === 'committed') throw Error('本例ACK后事实回调失败'); }); expect(await operation.result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } });
    expect(notes(profile)[0]).toEqual({ id: 1, note: '真实提交' }); expect(events.at(-1)?.status).toBe('completed'); await expect(apply(app, sibling).result).rejects.toThrow('失效');
  });

  it.each([true, false])('COMMIT真实执行后丢最终completed，statementEnd可见=%s时按原ACK区分committed与unknown', async acknowledged => {
    const profile = fixture(); let armed = false;
    const { app, events } = runtime(profile, () => transport((message, forward, record) => {
      const command = record.sent.filter(item => item.kind === 'execute').at(-1);
      if (armed && command?.kind === 'execute' && command.sql === 'COMMIT') {
        // worker先完成真实COMMIT才发送statementEnd；只丢协议回执并终止准确原进程，不能伪造数据库成功。
        if (message.kind === 'statementEnd') { if (acknowledged) forward(); record.kills++; record.child.kill(); return; }
        if (message.kind === 'completed') return;
      }
      forward();
    }));
    const source = await page(app, profile), plan = await preview(app, source, [update(0, '真实磁盘已提交')]), sibling = await preview(app, source, [update(1, '不可重放兄弟')]); armed = true;
    const operation = apply(app, plan), result = await operation.result;
    expect(result).toMatchObject({ outcome: acknowledged ? 'committed' : 'unknown', fact: { appliedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: acknowledged, rollbackAcknowledged: false } });
    if (acknowledged) expect(result.cleanupWarning).toBe(true);
    expect(notes(profile)[0]).toEqual({ id: 1, note: '真实磁盘已提交' }); expect(events.at(-1)?.status).toBe(acknowledged ? 'completed' : 'failed');
    expect(processes.at(-1)!.sent.filter(message => message.kind === 'execute' && message.sql === 'COMMIT')).toHaveLength(1); await expect(apply(app, sibling).result).rejects.toThrow('失效'); await expect(preview(app, source, [update(0, '禁止旧来源')])).rejects.toThrow('失效');
  });

  it('COMMIT前在真实DML header准确取消，确认ROLLBACK且原页可重新明确预览', async () => {
    const profile = fixture(), reached = deferred<void>(); let pause = false;
    const { app, events } = runtime(profile, () => transport((message, forward) => { if (pause && message.kind === 'statement' && message.sql.startsWith('UPDATE ')) { pause = false; reached.resolve(); } else forward(); }));
    const source = await page(app, profile), before = notes(profile), plan = await preview(app, source, [update(0, '不得执行')]); pause = true;
    const operation = apply(app, plan); await reached.promise; await app.request('query.cancel', { taskId: operation.input.taskId });
    expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 0, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true } });
    expect(events.at(-1)?.status).toBe('cancelled'); expect(notes(profile)).toEqual(before); expect(processes.at(-1)!.kills).toBe(0);
    expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false);
    const retry = await preview(app, source, [update(0, '重新明确提交')]); expect((await apply(app, retry).result).outcome).toBe('committed');
  });

  it('已COMMIT但原driver关闭未确认仍返回committed并阻新建，显式close准确恢复原资源', async () => {
    const profile = fixture(), reached = deferred<void>(); let dropClose = false;
    const { app, events } = runtime(profile, () => transport(undefined, message => {
      // 只对已经真实提交的原close投递制造故障；SQL/COMMIT和独立验盘均沿真实SQLite。
      if (dropClose && message.kind === 'close') { vi.useFakeTimers(); reached.resolve(); return true; } return false;
    }));
    const source = await page(app, profile), plan = await preview(app, source, [update(0, '提交后关闭失败')]); dropClose = true;
    const operation = apply(app, plan); await reached.promise;
    try { await vi.advanceTimersByTimeAsync(5001); expect(await operation.result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); } finally { vi.useRealTimers(); }
    expect(notes(profile)[0]).toEqual({ id: 1, note: '提交后关闭失败' }); expect(events.at(-1)?.status).toBe('completed');
    const count = processes.length; await expect(app.request('sessions.open', { connectionId: profile.id, database: 'main' })).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(count);
    const original = processes.at(-1)!; expect(original.child.exitCode).toBeNull(); expect(original.kills).toBe(0); await app.request('connections.close', { id: profile.id }); await original.exited; expect(original.kills).toBe(1); expect(app.ownsConnection(profile.id)).toBe(false);
  });

  it('非法原TEXT字节不能签编辑快照，旧页后续遇坏TEXT也拒写并确认回滚', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile), plan = await preview(app, source, [update(0, '禁止替代字符写回')]);
    disk(profile, db => db.exec("UPDATE subject SET note=CAST(X'80' AS TEXT) WHERE id=1"));
    await expect(page(app, profile)).rejects.toMatchObject({ code: 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' });
    const result = await apply(app, plan).result; expect(result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 0, rollbackAcknowledged: true, commitMayHaveBeenSent: false } });
    expect(disk(profile, db => db.prepare('SELECT hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=1').get()!.bytes)).toBe('80');
  });

  it('真实DML完成后原路径被替换时COMMIT前拒提交并回滚准确原文件；原生禁止rename则保留该OS门', async () => {
    const profile = fixture(), path = profile.sqlite.filePath!, backup = join(dirname(path), 'late-original.sqlite'), replacement = join(dirname(path), 'late-replacement.sqlite');
    const fresh = new DatabaseSync(replacement); try { fresh.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO subject VALUES(1,'替换文件保持原样')"); } finally { fresh.close(); }
    const reached = deferred<void>(); let hold = false, release!: () => void;
    const { app } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'statement' && message.sql === 'SELECT changes()') { hold = false; release = forward; reached.resolve(); } else forward(); }));
    const source = await page(app, profile), plan = await preview(app, source, [update(0, '旧文件不得提交')]); hold = true;
    const operation = apply(app, plan); await reached.promise; let replaced = false;
    try {
      // 替换库在事务前就独立建好；不在旧journal存活期间打开新库，避免fixture自行触发恢复。
      try { renameSync(path, backup); replaced = true; } catch (reason) { expect(process.platform).toBe('win32'); expect(['EPERM', 'EACCES', 'EBUSY']).toContain((reason as NodeJS.ErrnoException).code); console.info('本机Windows原生拒绝重命名活动SQLite，保留实际OS限制；未伪造成功替换。'); }
      if (replaced) renameSync(replacement, path);
    } finally { release(); }
    const result = await operation.result;
    if (replaced) {
      expect(result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 1, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true } });
      expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql === 'COMMIT')).toBe(false);
      expect(notes(profile)).toEqual([{ id: 1, note: '替换文件保持原样' }]); expect(notes({ ...profile, sqlite: { ...profile.sqlite, filePath: backup } })).toEqual([{ id: 1, note: '原甲' }, { id: 2, note: '原乙' }]);
    } else {
      expect(result).toMatchObject({ outcome: 'committed', fact: { commitAcknowledged: true } }); expect(notes(profile)[0]).toEqual({ id: 1, note: '旧文件不得提交' });
    }
  });

  it('COMMIT边界后的cancel/连接close/forceClose只等原ACK而不KILL', async () => {
    const profile = fixture(), reached = deferred<void>(); let holdCommit = false, release!: () => void;
    const { app, events } = runtime(profile, () => transport((message, forward) => { if (holdCommit && message.kind === 'statement' && message.sql === 'COMMIT') { release = forward; reached.resolve(); } else forward(); }));
    const source = await page(app, profile), plan = await preview(app, source, [update(0, '边界提交')]); holdCommit = true; const operation = apply(app, plan); await reached.promise;
    const original = processes.at(-1)!, sent = original.sent.length; let cancelled = false; const cancel = app.request('query.cancel', { taskId: operation.input.taskId }).then(() => { cancelled = true; }); const closing = app.request('connections.close', { id: profile.id }); const forced = app.forceClose();
    await delay(20); expect(cancelled).toBe(false); expect(original.sent).toHaveLength(sent); expect(original.kills).toBe(0); release();
    expect(await operation.result).toMatchObject({ outcome: 'committed', fact: { commitAcknowledged: true } }); await Promise.all([cancel, closing, forced]); expect(original.kills).toBe(0); expect(events.at(-1)?.status).toBe('completed'); expect(notes(profile)[0]).toEqual({ id: 1, note: '边界提交' });
  });
});
