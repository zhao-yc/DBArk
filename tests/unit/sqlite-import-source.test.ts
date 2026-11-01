import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { linkSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { sqliteImportSourceInspectionSchema, type SqliteImportSourceInspectOutput } from '../../src/shared/sqliteImportSource';
import { sqliteTableImportInspectionSchema, sqliteTableImportOutcomeSchema, type SqliteTableImportInspectOutput } from '../../src/shared/sqliteTableImport';
import type { SqliteTableCreateDesign, SqliteTableCreatePreviewOutput } from '../../src/shared/sqliteTableCreate';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('来源测试不能误启网络引擎或未登记的utility'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], applications = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只控制真实消息交付时点，不构造数据库或进程成功事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-import-source-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 失败保留来源和数据库；只清准确退出后本例独占的临时目录。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-import-source-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers(); for (const app of applications) await app.forceClose(); applications.clear(); for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; } for (const directory of directories.splice(0)) if (!failed) remove(directory); });
afterAll(() => { if (!retained) remove(bundleDirectory); });
function fixture(): SqliteConnectionProfile { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-import-source-')); directories.push(directory); const path = join(directory, '原库中文🚢.sqlite'), db = new DatabaseSync(path); try { db.exec('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB)'); } finally { db.close(); } return { id: '来源连接', name: '来源合成数据库', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 0 } }; }
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
function file(profile: SqliteConnectionProfile, content = '[{"value":"中文🚢"}]', format = 'json'): string { const path = join(dirname(profile.sqlite.filePath!), '本例来源' + ++serial + '.' + format); writeFileSync(path, content); return path; }
/** 后续显式DDL/导入才允许使用真实Node worker；来源检查自身必须零fork。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume(); const record: ProcessRecord = { child, sent: [], exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message)) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => child.kill(), exited: record.exited };
}
function runtime(profile: SqliteConnectionProfile, createTransport: () => SqliteProcessTransport = transport, onEvent?: (event: TaskEvent) => void) { const events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport, emit: event => { events.push(structuredClone(event)); onEvent?.(event); } }); applications.add(app); return { app, events }; }
function sourceRequest(profile: SqliteConnectionProfile, path: string, extra: Record<string, unknown> = {}) { return { connectionId: profile.id, database: 'main', fileToken: '准确原文件令牌', format: 'json', encoding: 'utf8', taskId: '来源扫描' + ++serial, filePath: path, assertCurrent: () => {}, ...extra }; }
async function inspectSource(app: SqliteRuntime, profile: SqliteConnectionProfile, path: string, extra?: Record<string, unknown>): Promise<SqliteImportSourceInspectOutput> { return sqliteImportSourceInspectionSchema.parse(await app.request('sqlite.importSource.inspect', sourceRequest(profile, path, extra))); }
function targetRequest(profile: SqliteConnectionProfile, path: string, source: SqliteImportSourceInspectOutput, extra: Record<string, unknown> = {}) { return { ...sourceRequest(profile, path), sourceId: source.sourceId, table: 'target', taskId: '最终目标检查' + ++serial, ...extra }; }
async function inspectTarget(app: SqliteRuntime, profile: SqliteConnectionProfile, path: string, source: SqliteImportSourceInspectOutput, extra?: Record<string, unknown>): Promise<SqliteTableImportInspectOutput> { return sqliteTableImportInspectionSchema.parse(await app.request('sqlite.tableImport.inspect', targetRequest(profile, path, source, extra))); }

describe('SQLite导入为新表来源能力真实文件与准确任务边界', () => {
  it('完整严格来源扫描零fork/零DDL/DML，精确JSON数字、NULL、missing、嵌套文字和原SHA均来自文件', async () => {
    const profile = fixture(), before = readFileSync(profile.sqlite.filePath!), content = '[{"value":9223372036854775807,"note":null},{"nested":{"n":9007199254740993}}]', path = file(profile, content); let forks = 0; const { app, events } = runtime(profile, () => { forks++; throw Error('来源扫描不得启动数据库进程'); }); const input = sourceRequest(profile, path), value = sqliteImportSourceInspectionSchema.parse(await app.request('sqlite.importSource.inspect', input));
    expect(forks).toBe(0); expect(value).toMatchObject({ connectionId: profile.id, database: 'main', records: 2, source: { sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content) }, sourceColumns: ['value', 'note', 'nested'], sample: [{ value: '9223372036854775807', note: null }, { nested: '{"n":9007199254740993}' }], sampleOmitted: false }); expect(value).not.toHaveProperty('target'); expect(value).not.toHaveProperty('filePath'); expect(readFileSync(profile.sqlite.filePath!)).toEqual(before); expect(events.at(-1)?.status).toBe('completed'); expect(events.every(event => !event.executionSql && !event.message.includes(path))).toBe(true); expect(app.ownsTask(input.taskId)).toBe(true); await expect(app.request('sqlite.importSource.inspect', input)).rejects.toThrow('任务编号已经使用');
  });

  it('显式原建表preview/apply后来源跨DDL仍有效，同表重检后typed导入成功撤来源及兄弟能力', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile, '[{"value":9223372036854775807},{"value":null}]'), source = await inspectSource(app, profile, path); expect(processes).toHaveLength(0);
    const design: SqliteTableCreateDesign = { name: '新表中文"🚢', columns: [{ name: 'id', declaredType: 'INTEGER', nullable: false, default: { kind: 'none' } }, { name: 'value', declaredType: 'BLOB', nullable: true, default: { kind: 'none' } }], primaryKey: ['id'], autoIncrement: true, indexes: [], foreignKeys: [], strict: false, withoutRowid: false };
    const ddl = await app.request('sqlite.tableCreate.preview', { connectionId: profile.id, database: 'main', design, taskId: '显式建表预览', assertCurrent: () => {} }) as SqliteTableCreatePreviewOutput; expect((await app.request('sqlite.tableCreate.apply', { previewId: ddl.previewId, confirmation: ddl.confirmation, taskId: '显式建表提交', operationId: randomUUID(), assertCurrent: () => {}, recordCreateFact: () => {} })).outcome).toBe('committed');
    const target = await inspectTarget(app, profile, path, source, { table: design.name }); expect(target.source).toEqual(source.source); expect(target.records).toBe(2); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM "新表中文""🚢"').get()!.n)).toBe(0);
    const renewed = await inspectTarget(app, profile, path, source, { table: design.name }); expect(renewed.inspectionId).not.toBe(target.inspectionId); await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('失效');
    const checked = await app.request('sqlite.tableImport.preview', { inspectionId: target.inspectionId, taskId: '显式数据预检', mapping: [{ source: 'value', target: 'value', kind: 'integer' }], assertCurrent: () => {} }); expect(checked.ok).toBe(true); expect(sqliteTableImportOutcomeSchema.parse(await app.request('sqlite.tableImport.apply', { previewId: checked.previewId, confirmation: checked.confirmation, taskId: '显式数据提交', operationId: randomUUID(), assertCurrent: () => {}, recordWriteFact: () => {} }))).toMatchObject({ outcome: 'committed', fact: { requestedRows: 2, appliedRows: 2 } });
    expect(disk(profile, db => db.prepare('SELECT typeof(value) AS type,CAST(value AS TEXT) AS value FROM "新表中文""🚢" ORDER BY id').all())).toEqual([{ type: 'integer', value: '9223372036854775807' }, { type: 'null', value: null }]); const count = processes.length; await expect(inspectTarget(app, profile, path, source, { table: design.name })).rejects.toThrow('失效'); await expect(app.request('sqlite.tableImport.preview', { inspectionId: renewed.inspectionId, mapping: [{ source: 'value', target: 'value', kind: 'integer' }], taskId: '兄弟检查不可重放', assertCurrent: () => {} })).rejects.toThrow('失效'); expect(processes).toHaveLength(count);
  });

  it('有效CSV默认解释可等价复用，错误令牌/编码/格式/列标题解释在fork前拒绝且不消费原来源', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile, 'value\n中文\n', 'csv'), source = await inspectSource(app, profile, path, { format: 'csv' });
    for (const extra of [{ format: 'json' }, { format: 'csv', encoding: 'utf16le' }, { format: 'csv', fileToken: '其它文件令牌' }, { format: 'csv', csvHasHeader: false }, { format: 'csv', csvDelimiter: ';' }]) await expect(inspectTarget(app, profile, path, source, extra)).rejects.toThrow('失效'); expect(processes).toHaveLength(0);
    const target = await inspectTarget(app, profile, path, source, { format: 'csv', csvDelimiter: ',', csvHasHeader: true }); expect(target.records).toBe(1); expect(target.sample).toEqual([{ value: '中文' }]); expect(processes).toHaveLength(1);
  });

  it('同SHA换inode和原文件字节改变都不能借旧来源，拒绝发生在目标utility打开前', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile), source = await inspectSource(app, profile, path), original = readFileSync(path), before = statSync(path, { bigint: true }); renameSync(path, path + '.原件'); writeFileSync(path, original); expect(statSync(path, { bigint: true }).ino).not.toBe(before.ino); await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('变化'); expect(processes).toHaveLength(0);
    const fresh = await inspectSource(app, profile, path); writeFileSync(path, '[{"value":"已修改原字节"}]'); await expect(inspectTarget(app, profile, path, fresh)).rejects.toThrow('变化'); expect(processes).toHaveLength(0); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM target').get()!.n)).toBe(0);
  });

  it('来源DB物理对象/profile修改、主库及日志hardlink来源均零fork拒绝，不把相同路径视为同对象', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile), source = await inspectSource(app, profile, path); profile.sqlite.busyTimeoutMs = 1; await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('配置已变化'); profile.sqlite.busyTimeoutMs = 0;
    const databasePath = profile.sqlite.filePath!; renameSync(databasePath, databasePath + '.原库'); const replacement = new DatabaseSync(databasePath); try { replacement.exec('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB)'); } finally { replacement.close(); } await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('失效');
    await expect(inspectSource(app, profile, databasePath)).rejects.toThrow('不能作为导入源'); const linked = join(dirname(path), '数据库硬链接.json'); linkSync(databasePath, linked); await expect(inspectSource(app, profile, linked)).rejects.toThrow('不能作为导入源'); const journal = databasePath + '-journal', linkedJournal = join(dirname(path), '日志硬链接.json'); writeFileSync(journal, '必须保留的日志'); linkSync(journal, linkedJournal); await expect(inspectSource(app, profile, linkedJournal)).rejects.toThrow('不能作为导入源'); expect(readFileSync(journal, 'utf8')).toBe('必须保留的日志'); expect(processes).toHaveLength(0);
  });

  it('来源30分钟TTL从完整发布开始，过期/准确release/connection close均阻止旧能力领取', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile), first = await inspectSource(app, profile, path); vi.useFakeTimers({ toFake: ['Date'] }); try { vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1); await expect(inspectTarget(app, profile, path, first)).rejects.toThrow('失效'); } finally { vi.useRealTimers(); }
    const released = await inspectSource(app, profile, path); await app.request('sqlite.importSource.release', { sourceId: released.sourceId }); await expect(inspectTarget(app, profile, path, released)).rejects.toThrow('失效'); const closed = await inspectSource(app, profile, path); await app.request('connections.close', { id: profile.id }); await expect(inspectTarget(app, profile, path, closed)).rejects.toThrow('失效'); expect(processes).toHaveLength(0);
  });

  it('来源独占claim拒并发跨表领取，已claim后自然TTL不杀原全文件检查，失败不自动消费', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false, release!: () => void; const { app } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'opened') { hold = false; release = forward; reached.resolve(); } else forward(); })); const path = file(profile), source = await inspectSource(app, profile, path); hold = true; const first = inspectTarget(app, profile, path, source); await reached.promise;
    await expect(inspectTarget(app, profile, path, source, { table: '其它目标' })).rejects.toThrow('失效'); expect(processes).toHaveLength(1); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1); release(); try { expect((await first).records).toBe(1); } finally { vi.useRealTimers(); }
    const retryable = await inspectSource(app, profile, path); await expect(inspectTarget(app, profile, path, retryable, { table: '尚未创建的表' })).rejects.toThrow(); expect((await inspectTarget(app, profile, path, retryable)).records).toBe(1);
  });

  it('准确release撤销正在claim的最终检查，不发布迟到target能力；原来源不会finally复活', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false, release!: () => void; const { app } = runtime(profile, () => transport((message, forward) => { if (hold && message.kind === 'opened') { hold = false; release = forward; reached.resolve(); } else forward(); })); const path = file(profile), source = await inspectSource(app, profile, path); hold = true; const pending = inspectTarget(app, profile, path, source); await reached.promise; await app.request('sqlite.importSource.release', { sourceId: source.sourceId }); release(); await expect(pending).rejects.toThrow('失效'); expect(await processes[0].exited).toEqual({ code: 0, signal: null }); await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('失效'); expect(processes).toHaveLength(1);
  });

  it('来源自然TTL不级联独立目标期限，过期后明确release仍撤其未领取children', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile), source = await inspectSource(app, profile, path), now = Date.now(); vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(now + 29 * 60 * 1000); const target = await inspectTarget(app, profile, path, source); vi.setSystemTime(now + 30 * 60 * 1000 + 1); await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('失效');
      const checked = await app.request('sqlite.tableImport.preview', { inspectionId: target.inspectionId, mapping: [{ source: 'value', target: 'value', kind: 'text' }], taskId: '来源过期独立预检仍有效', assertCurrent: () => {} }); expect(checked.ok).toBe(true); await app.request('sqlite.importSource.release', { sourceId: source.sourceId });
      await expect(app.request('sqlite.tableImport.apply', { previewId: checked.previewId, confirmation: checked.confirmation, taskId: '来源明确撤销旧预检', operationId: randomUUID(), assertCurrent: () => {}, recordWriteFact: () => {} })).rejects.toThrow('失效');
    } finally { vi.useRealTimers(); }
    expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM target').get()!.n)).toBe(0);
  });

  it.each(['inspection', 'source'] as const)('在途真实预检跨父TTL并prune后显式释放%s，原读取链拒晚发布且准确收尾', async mode => {
    const profile = fixture(), reached = deferred<void>(), taskId = '过期父能力在途预检-' + mode; let app!: SqliteRuntime, armed = false, target!: SqliteTableImportInspectOutput, source!: SqliteImportSourceInspectOutput, pruned: Promise<unknown> | undefined, released: Promise<unknown> | undefined;
    const current = runtime(profile, transport, event => {
      if (armed && event.taskId === taskId && event.rows === 128) {
        armed = false;
        // 保持真实文件迭代器停在第128条progress回调，只有Date变化，不替换reader、行值或原SQL回执。
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
        // 新领取触发原ledger自然TTL回收；在途预检只能由保留的准确引用承接后续显式撤权。
        pruned = app.request('sqlite.tableImport.preview', { inspectionId: target.inspectionId, mapping: [{ source: 'value', target: 'value', kind: 'text' }], taskId: taskId + '-自然回收', assertCurrent: () => {} }).then(() => { throw Error('过期父能力不应允许新领取'); }, reason => { expect(reason).toBeInstanceOf(Error); expect((reason as Error).message).toContain('失效'); });
        released = mode === 'inspection' ? app.request('sqlite.tableImport.release', { inspectionId: target.inspectionId }) : app.request('sqlite.importSource.release', { sourceId: source.sourceId }); reached.resolve();
      }
    }); app = current.app;
    const path = file(profile, JSON.stringify(Array.from({ length: 512 }, (_, value) => ({ value: '原文件' + value })))); source = await inspectSource(app, profile, path); target = await inspectTarget(app, profile, path, source); armed = true;
    const pending = app.request('sqlite.tableImport.preview', { inspectionId: target.inspectionId, mapping: [{ source: 'value', target: 'value', kind: 'text' }], taskId, assertCurrent: () => {} }), rejected = expect(pending).rejects.toThrow('失效');
    try { await reached.promise; await Promise.all([pruned, released]); await rejected; } finally { vi.useRealTimers(); }
    expect(current.events.filter(event => event.taskId === taskId).at(-1)?.status).toBe('failed'); expect(app.ownsTask(taskId)).toBe(true); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM target').get()!.n)).toBe(0);
    expect(processes).toHaveLength(2); for (const record of processes) { expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.sent.some(message => message.kind === 'execute' && message.sql.startsWith('INSERT'))).toBe(false); }
  });

  it.each([true, false])('已领取writer保持原强引用，COMMIT acknowledged=%s后来源/兄弟preview不能重复导入', async acknowledged => {
    const profile = fixture(), reached = deferred<void>(); let armed = false, release!: () => void;
    const { app } = runtime(profile, () => transport((message, forward) => {
      if (armed && message.kind === 'statement' && message.sql === 'COMMIT') { release = forward; reached.resolve(); return; }
      if (armed && !acknowledged && message.kind === 'statementEnd' && processes.at(-1)!.sent.filter(value => value.kind === 'execute').at(-1)?.sql === 'COMMIT') { processes.at(-1)!.child.kill(); return; }
      if (armed && !acknowledged && message.kind === 'completed' && processes.at(-1)!.sent.filter(value => value.kind === 'execute').at(-1)?.sql === 'COMMIT') return;
      forward();
    }));
    const path = file(profile), source = await inspectSource(app, profile, path), first = await inspectTarget(app, profile, path, source), second = await inspectTarget(app, profile, path, source);
    const makePreview = (inspectionId: string) => app.request('sqlite.tableImport.preview', { inspectionId, mapping: [{ source: 'value', target: 'value', kind: 'text' }], taskId: '来源同表数据预检' + ++serial, assertCurrent: () => {} }); const one = await makePreview(first.inspectionId), two = await makePreview(second.inspectionId); armed = true;
    const pending = app.request('sqlite.tableImport.apply', { previewId: one.previewId, confirmation: one.confirmation, taskId: '来源准确writer', operationId: randomUUID(), assertCurrent: () => {}, recordWriteFact: () => {} }); await reached.promise;
    if (acknowledged) await app.request('sqlite.importSource.release', { sourceId: source.sourceId }); release(); expect(sqliteTableImportOutcomeSchema.parse(await pending)).toMatchObject({ outcome: acknowledged ? 'committed' : 'unknown', fact: { commitAcknowledged: acknowledged, commitMayHaveBeenSent: true } });
    expect(disk(profile, db => db.prepare('SELECT value FROM target').all())).toEqual([{ value: '中文🚢' }]); const count = processes.length; await expect(inspectTarget(app, profile, path, source)).rejects.toThrow('失效'); await expect(app.request('sqlite.tableImport.apply', { previewId: two.previewId, confirmation: two.confirmation, taskId: '兄弟不能再次写', operationId: randomUUID(), assertCurrent: () => {}, recordWriteFact: () => {} })).rejects.toThrow('失效'); expect(processes).toHaveLength(count);
  });

  it.each(['cancel', 'close', 'force'] as const)('来源文件扫描%s经原pending/abort收尾，零fork且终态先于原Promise拒绝', async mode => {
    const profile = fixture(), path = file(profile, JSON.stringify(Array.from({ length: 512 }, (_, value) => ({ value: String(value) })))), input = sourceRequest(profile, path), reached = deferred<void>(); let cleanup: Promise<unknown> | undefined, app!: SqliteRuntime;
    const current = runtime(profile, () => { throw Error('来源扫描不得fork'); }, event => { if (!cleanup && event.taskId === input.taskId && event.rows === 128) { cleanup = mode === 'cancel' ? app.request('query.cancel', { taskId: input.taskId }) : mode === 'close' ? app.request('connections.close', { id: profile.id }) : app.forceClose(); reached.resolve(); } }); app = current.app;
    const pending = app.request('sqlite.importSource.inspect', input); const rejected = expect(pending).rejects.toThrow(); await reached.promise; await rejected; await cleanup; expect(current.events.filter(event => event.taskId === input.taskId).at(-1)?.status).toBe('cancelled'); expect(app.ownsTask(input.taskId)).toBe(true); expect(processes).toHaveLength(0); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM target').get()!.n)).toBe(0);
  });

  it('readonly来源可读；用户已写事务/TEMP状态不被扫描借用，非法编码没有来源能力', async () => {
    const profile = fixture(), { app } = runtime(profile), { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }); await app.request('query.execute', { sessionId, taskId: '原用户事务', sql: "CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(9); BEGIN; INSERT INTO target VALUES(1,'原未提交')", maxRows: 100 }); const count = processes.length, path = file(profile), source = await inspectSource(app, profile, path); expect(source.records).toBe(1); expect(processes).toHaveLength(count); expect(await app.request('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true }); expect((await app.request('query.execute', { sessionId, taskId: '原临时表', sql: 'SELECT n FROM marker', maxRows: 100 })).results[0].rows).toEqual([{ c0: '9' }]); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM target').get()!.n)).toBe(0); await app.request('query.transaction', { sessionId, action: 'rollback' }); await app.request('connections.close', { id: profile.id });
    profile.sqlite.readOnly = true; const readonly = await inspectSource(app, profile, path); expect(readonly.records).toBe(1); expect(processes).toHaveLength(count); const bad = file(profile, '', 'csv'); writeFileSync(bad, Buffer.from([0x76, 0x0a, 0xc3, 0x28, 0x0a])); await expect(inspectSource(app, profile, bad, { format: 'csv' })).rejects.toThrow('编码'); expect(processes).toHaveLength(count);
  });
});
