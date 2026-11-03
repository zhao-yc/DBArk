import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTablePage, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';
import type { SqliteValueOptionsInput, SqliteValueOptionsOutput } from '../../src/shared/sqliteValueOptions';
import { randomUUID } from 'node:crypto';
import type { SqliteRelationshipsInput, SqliteRelationshipsOutput } from '../../src/shared/sqliteRelationships';
import { captureSqliteRelationshipDiagram } from '../../src/renderer/sqliteRelationshipDiagram';
import type { SqliteStatisticsInput, SqliteStatisticsOutput } from '../../src/shared/sqliteStatistics';

// 真实Node子进程代替Electron宿主，任何意外默认工厂调用立即失败，不伪造数据库结果。
vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('分页测试必须注入真实Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';
import { buildSqliteTableSelect } from '../../src/main/sqliteTableBrowse';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>(), drivers = new Set<SqliteDriverSession>();
let bundleDirectory: string, worker: string, retained = false;
/** 只观察真实消息边界，不生产任何成功数据库回执。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => {
  bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-browse-build-')); worker = join(bundleDirectory, 'worker.cjs');
  await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' });
});
/** 只清理本测试独占且全部准确进程已退出的目录，失败保留真实磁盘现场。 */
function removeDirectory(directory: string): void {
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-browse-')).toBe(true);
  rmSync(directory, { recursive: true, force: true });
}
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const runtime of runtimes) await runtime.forceClose(); runtimes.clear();
  for (const driver of drivers) { if (driver.isBusy) await driver.cancel(); await driver.close(); } drivers.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 无亲和性的value列真实混合五种存储类型，含64位上下界及Unicode/引号/空字符原文。 */
function fixture(encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be' = 'UTF-8'): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-browse-')); directories.push(directory);
  const path = join(directory, 'sample.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA encoding='" + encoding + "'");
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE mix(id INTEGER PRIMARY KEY,value,group_name TEXT,rank INTEGER,doubled INTEGER GENERATED ALWAYS AS (id*2) VIRTUAL,stored INTEGER GENERATED ALWAYS AS (id+100) STORED); CREATE VIEW mix_view AS SELECT * FROM mix; CREATE TABLE "引号""船🚢"("字段""甲" TEXT); INSERT INTO "引号""船🚢" VALUES(\'Unicode中文🚢\');');
    const insert = db.prepare('INSERT INTO mix(id,value,group_name,rank) VALUES(?,?,?,?)');
    for (const [id, value, group, rank] of [
      [1, 9223372036854775807n, 'A', 10], [2, -9223372036854775808n, 'A', 10], [3, 1.25, 'B', 20],
      [4, '9223372036854775807', 'A', 30], [5, null, 'B', 10], [6, Buffer.from([0, 255]), 'B', 20],
      [7, "' OR 1=1 --", 'A', 10], [8, '50%_中文🚢', 'A', 10], [9, '空\0字符', 'B', 10],
    ] as const) insert.run(id, value, group, rank);
    db.exec("INSERT INTO mix(id,value,group_name,rank) VALUES(10,CAST(0 AS REAL),'A',30)");
  } finally { db.close(); }
  return { id: '分页磁盘连接', name: '分页真实磁盘库', group: '', color: '#567890', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 独立原生连接只用于本例seed或外部结构变更，不借待验driver验证自身结果。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T {
  const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); }
}
/** 可暂停原消息或阻止本例准确terminate以制造资源异常；所有SQL/结果仍来自真实worker。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return {
    send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); },
    onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); },
    terminate: () => { record.kills++; return child.kill(); }, exited: record.exited,
  };
}
/** Main可信profile和准确transport以外不授予任何数据库能力。 */
function runtime(profile: SqliteConnectionProfile, create: () => SqliteProcessTransport = transport) {
  const events: TaskEvent[] = [];
  const app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: create, emit: event => events.push(structuredClone(event)) }); runtimes.add(app);
  return { app, events };
}
/** 每次分页使用独立任务ID；默认带唯一主键排序，不把无排序的自然行序当稳定保证。 */
function input(profile: SqliteConnectionProfile, taskId: string, patch: Partial<SqliteTablePageInput> = {}): SqliteTablePageInput {
  return { connectionId: profile.id, database: 'main', table: 'mix', taskId, offset: 0, limit: 3, mode: 'and', filters: [], sort: [{ column: 'id', direction: 'asc' }], ...patch };
}
/** 仅经运行时正式表分页命令，不从渲染层发送任意SQL。 */
function page(app: SqliteRuntime, value: SqliteTablePageInput): Promise<SqliteTablePage> { return app.request('sqlite.tablePage', value); }
/** 从真实结果合同取id原文，避免测试把64位数值转成Number。 */
function ids(value: SqliteTablePage): unknown[] { return value.result.rows.map(row => row.c0); }

describe('SQLite全筛选字段概况真实只读worker', () => {
  /** 来源指纹必须来自原分页目录，不自行伪造结构摘要。 */
  async function statisticsInput(app: SqliteRuntime, profile: SqliteConnectionProfile, table = 'mix', column = 'value'): Promise<SqliteStatisticsInput> {
    const original = await page(app, input(profile, randomUUID(), { table, sort: [], limit: 1 }));
    return { connectionId: profile.id, database: 'main', table, column, taskId: randomUUID(), schemaKey: original.schemaKey, mode: 'and', filters: [] };
  }
  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s存储类型、64位极值、完整筛选及真实只读终态', async encoding => {
    const profile = fixture(encoding), { app } = runtime(profile), request = await statisticsInput(app, profile), before = disk(profile, db => db.prepare('SELECT id,typeof(value),hex(value) FROM mix ORDER BY id').all());
    const value: SqliteStatisticsOutput = await app.request('sqlite.statistics', request);
    expect(value).toMatchObject({ rows: '10', nonNull: '9', nulls: '1', declaredType: '' });
    expect(value.groups.map(group => [group.kind, group.count, group.distinct])).toEqual([['blob', '1', '1'], ['integer', '2', '2'], ['null', '1', '0'], ['real', '2', '2'], ['text', '4', '4']]);
    expect(value.groups[1]).toMatchObject({ min: { kind: 'integer', value: '-9223372036854775808' }, max: { kind: 'integer', value: '9223372036854775807' } });
    expect(value.groups[3]).toMatchObject({ min: { kind: 'real', value: '0' }, max: { kind: 'real', value: '1.25' } }); expect(value.groups[4].max).toEqual({ kind: 'text', value: '空\0字符' });
    const filtered = await app.request('sqlite.statistics', { ...request, taskId: randomUUID(), filters: [{ column: 'rank', operator: 'eq', value: { kind: 'integer', value: '10' } }] }); expect(filtered).toMatchObject({ rows: '6', nonNull: '5', nulls: '1' });
    expect(await app.request('sqlite.statistics', { ...request, taskId: randomUUID(), filters: [{ column: 'id', operator: 'gt', value: { kind: 'integer', value: '999' } }] })).toMatchObject({ rows: '0', nonNull: '0', nulls: '0', groups: [] });
    expect(await app.request('sqlite.statistics', { ...request, taskId: randomUUID(), column: 'doubled' })).toMatchObject({ groups: [{ kind: 'integer', count: '10', distinct: '10', min: { kind: 'integer', value: '2' }, max: { kind: 'integer', value: '20' } }] });
    await expect(app.request('sqlite.statistics', { ...request, taskId: randomUUID(), schemaKey: '0'.repeat(64) })).rejects.toThrow('结构');
    expect(disk(profile, db => db.prepare('SELECT id,typeof(value),hex(value) FROM mix ORDER BY id').all())).toEqual(before);
    for (const record of processes) { expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); const queries = record.sent.filter(message => message.kind === 'execute'); expect(queries[0]?.sql).toBe('BEGIN'); expect(queries.at(-1)?.sql).toBe('ROLLBACK'); expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } }); }
  });
  it('视图、原排序规则、REAL无穷和不同类型不合并，源磁盘保持', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE storage(v COLLATE NOCASE);INSERT INTO storage VALUES('a'),('A'),('b'),(1),(CAST(1 AS REAL)),(1e999),(-1e999),(X'00ff'),(X'01');CREATE VIEW storage_view AS SELECT v FROM storage"));
    const { app } = runtime(profile), request = await statisticsInput(app, profile, 'storage_view', 'v'), result: SqliteStatisticsOutput = await app.request('sqlite.statistics', request);
    expect(result.rows).toBe('9'); expect(result.groups.map(group => [group.kind, group.count, group.distinct])).toEqual([['blob', '2', '2'], ['integer', '1', '1'], ['real', '3', '3'], ['text', '3', '2']]);
    expect(result.groups[2]).toMatchObject({ min: { kind: 'real', value: '-Infinity' }, max: { kind: 'real', value: 'Infinity' } }); expect(result.groups[3].max).toEqual({ kind: 'text', value: 'b' });
  });
  it('极值超预算或坏TEXT整份失败，不发布截断统计，保留原数据', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE extreme(v);INSERT INTO extreme VALUES('a')")); const { app } = runtime(profile), request = await statisticsInput(app, profile, 'extreme', 'v');
    disk(profile, db => db.exec('INSERT INTO extreme VALUES(zeroblob(65537))'));
    await expect(app.request('sqlite.statistics', request)).rejects.toThrow(/预算/);
    disk(profile, db => db.exec("DELETE FROM extreme WHERE typeof(v)='blob';INSERT INTO extreme VALUES(CAST(X'80' AS TEXT))"));
    await expect(app.request('sqlite.statistics', { ...request, taskId: randomUUID() })).rejects.toThrow(/编码|无损|TEXT/);
    expect(disk(profile, db => db.prepare('SELECT typeof(v),hex(v) FROM extreme').all())).toEqual([{ 'typeof(v)': 'text', 'hex(v)': '61' }, { 'typeof(v)': 'text', 'hex(v)': '80' }]);
  });
  it('匹配行数涵盖整表和视图，按原存储类型绑定且不读取大 BLOB', async () => {
    const profile = fixture();
    disk(profile, db => db.exec("CREATE TABLE counted(id INTEGER PRIMARY KEY,v,payload); INSERT INTO counted(v) VALUES(2),('2'),(2),(NULL); CREATE VIEW counted_view AS SELECT * FROM counted WHERE id<=3"));
    const { app, events } = runtime(profile);
    const sources = [];
    for (const [table, total] of [['counted', '4'], ['counted_view', '3']] as const) {
      const { column: _column, ...source } = await statisticsInput(app, profile, table, 'v'); sources.push({ source, total });
    }
    disk(profile, db => db.exec('UPDATE counted SET payload=zeroblob(1048577) WHERE id<=2'));
    for (const { source, total } of sources) {
      await expect(app.request('sqlite.countRows', source)).resolves.toEqual({ request: source, rows: total });
      const read = (value: string) => app.request('sqlite.countRows', { ...source, taskId: randomUUID(), filters: [{ column: 'v', operator: 'eq', value: { kind: 'integer', value } }, { column: 'v', operator: 'isNull', enabled: false }] });
      await expect(read('2')).resolves.toMatchObject({ rows: '2' });
      await expect(read('99')).resolves.toMatchObject({ rows: '0' });
      expect(events.at(-1)).toMatchObject({ status: 'completed' }); expect(events.at(-1)?.rows).toBeUndefined();
      const record = processes.at(-1)!;
      expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0);
      expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } });
      const statements = record.sent.flatMap(message => message.kind === 'execute' ? [message.sql] : []);
      expect(statements[0]).toBe('BEGIN'); expect(statements.at(-1)).toBe('ROLLBACK');
      expect(statements.find(sql => sql.includes('__dbark_count'))).toMatch(/^SELECT count\(\*\) FROM \(SELECT 1 AS /);
      expect(statements.find(sql => sql.includes('__dbark_count'))).not.toMatch(/\b(?:ORDER BY|LIMIT|OFFSET)\b/i);
      await expect(app.request('sqlite.countRows', { ...source, schemaKey: 'f'.repeat(64), taskId: randomUUID() })).rejects.toThrow('结构已变化');
    }
  });
  it.each(['sqlite.statistics', 'sqlite.countRows'] as const)('%s 长聚合准确取消，原用户事务不受影响，未退出资源继续占槽', async command => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW stats_expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT x AS value FROM n'));
    const reached = deferred<void>(), { app, events } = runtime(profile, () => transport((message, forward) => { forward(); if (message.kind === 'statement' && /__dbark_(statistics|count)/.test(message.sql)) reached.resolve(); })), request = await statisticsInput(app, profile, 'stats_expensive');
    const { column: _column, ...countRequest } = request;
    const user = await app.request('sessions.open', { connectionId: profile.id }); await app.request('query.transaction', { ...user, action: 'begin' });
    const work = app.request(command, command === 'sqlite.countRows' ? countRequest : request).catch(reason => reason); await reached.promise; await delay(50); await app.request('query.cancel', { taskId: request.taskId }); expect(await work).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(processes[2].kills).toBe(1); expect(processes[1].kills).toBe(0);
    expect(await app.request('query.sessionState', user)).toEqual({ transactionOpen: true, transactionKnown: true, broken: false }); expect(taskState(app, request.taskId)).toEqual({ kind: 'browse-finished' }); await app.request('query.transaction', { ...user, action: 'rollback' }); await app.close();
  });
  it('两份概况准确任务仍在途时不创建第三个进程，退出后归还槽位', async () => {
    const profile = fixture(); let armed = false; const releases: (() => void)[] = [], reached = deferred<void>();
    const { app } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'opened') { releases.push(forward); if (releases.length === 2) reached.resolve(); } else forward(); }));
    const source = await statisticsInput(app, profile); armed = true; const first = app.request('sqlite.statistics', source), second = app.request('sqlite.statistics', { ...source, taskId: randomUUID() });
    const { column: _column, ...countRequest } = source;
    await reached.promise; const count = processes.length; await expect(app.request('sqlite.countRows', { ...countRequest, taskId: randomUUID() })).rejects.toThrow('并发上限'); expect(processes).toHaveLength(count);
    armed = false; releases.forEach(release => release()); await Promise.all([first, second]); await expect(app.request('sqlite.statistics', { ...source, taskId: randomUUID() })).resolves.toMatchObject({ rows: '10' });
  });
});

describe('SQLite关系图真实只读worker', () => {
  /** 锚点来自正式物理表分页，不自行拼出目录摘要。 */
  async function request(app: SqliteRuntime, profile: SqliteConnectionProfile, tables = ['mix']): Promise<SqliteRelationshipsInput> {
    const original = await page(app, input(profile, randomUUID()));
    return { connectionId: profile.id, database: 'main', taskId: randomUUID(), anchor: { table: 'mix', schemaKey: original.schemaKey }, tables };
  }
  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s复合隐式父键、WITHOUT ROWID、STRICT、生成列和有问题声明均保留目录事实', async encoding => {
    const profile = fixture(encoding);
    disk(profile, db => db.exec('CREATE TABLE Parent(a TEXT,b INTEGER,PRIMARY KEY(b,a)) WITHOUT ROWID; CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES PARENT ON UPDATE CASCADE); CREATE TABLE strict_parent(id INTEGER PRIMARY KEY) STRICT; CREATE TABLE implicit_child(x REFERENCES strict_parent); CREATE TABLE bad(x REFERENCES absent,y REFERENCES Parent(no_such_column)); CREATE TABLE self(id INTEGER PRIMARY KEY,p REFERENCES SELF);'));
    const { app, events } = runtime(profile), source = await request(app, profile, ['mix', 'Parent', 'child', 'strict_parent', 'implicit_child', 'bad', 'self']);
    const value: SqliteRelationshipsOutput = await app.request('sqlite.relationships', source);
    expect(value.tables.map(table => table.name)).toEqual(source.tables); expect(value.request).toEqual(source); expect(value.schemaVersion).toMatch(/^\d+$/);
    expect(value.tables[2].foreignKeys[0]).toMatchObject({ columns: ['x', 'y'], referencedTable: 'PARENT', referencedColumns: null, onUpdate: 'CASCADE' });
    expect(value.tables[0].columns.find(column => column.name === 'doubled')?.hidden).toBe(2); expect(value.tables[0].columns.find(column => column.name === 'stored')?.hidden).toBe(3);
    const graph = captureSqliteRelationshipDiagram(value, source); expect(graph.edges.find(edge => edge.key.referencedTable === 'Parent' && edge.key.implicit)?.key.referencedColumns).toEqual(['b', 'a']);
    expect(graph.edges.some(edge => edge.key.warning)).toBe(true); expect(graph.nodes.filter(node => node.external).map(node => node.name)).toEqual(['absent']);
    expect(taskState(app, source.taskId)).toEqual({ kind: 'browse-finished' }); expect(events.at(-1)).toMatchObject({ status: 'completed', rows: 7 });
    const record = processes.at(-1)!; await record.exited;
    const sql = record.sent.filter(message => message.kind === 'execute').map(message => message.sql);
    expect(sql[0]).toBe('BEGIN'); expect(sql.at(-1)).toBe('ROLLBACK'); expect(sql.some(sql => /foreign_key_check|foreign_keys\s*=|\b(?:INSERT|UPDATE|DELETE|ATTACH)\b/i.test(sql))).toBe(false);
  });
  it('所选表在同一快照读取，WAL并发结构提交不会混入后一张表', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY)'));
    let changed = false;
    const { app } = runtime(profile, () => transport((message, forward) => {
      if (!changed && message.kind === 'statement' && message.sql.includes('pragma_foreign_key_list')) { changed = true; disk(profile, db => db.exec('ALTER TABLE parent ADD COLUMN later TEXT')); }
      forward();
    }));
    const source = await request(app, profile, ['mix', 'parent']), value: SqliteRelationshipsOutput = await app.request('sqlite.relationships', source);
    expect(changed).toBe(true); expect(value.tables[1].columns.map(column => column.name)).toEqual(['id']);
    const fresh: SqliteRelationshipsOutput = await app.request('sqlite.relationships', { ...source, taskId: randomUUID() }); expect(fresh.tables[1].columns.map(column => column.name)).toEqual(['id', 'later']);
  });
  it('锚点已变、视图或缺表整份失败，不发布部分图或保留读资源', async () => {
    const profile = fixture(), { app, events } = runtime(profile), source = await request(app, profile);
    disk(profile, db => db.exec('ALTER TABLE mix ADD COLUMN changed TEXT'));
    for (const target of [source, { ...source, anchor: { ...source.anchor, schemaKey: 'f'.repeat(64) } }]) {
      await expect(app.request('sqlite.relationships', { ...target, taskId: randomUUID() })).rejects.toThrow('结构已变化'); expect(events.at(-1)?.status).toBe('failed');
    }
    const fresh = await request(app, profile);
    for (const table of ['mix_view', 'absent']) await expect(app.request('sqlite.relationships', { ...fresh, taskId: randomUUID(), tables: ['mix', table] })).rejects.toThrow();
    for (const record of processes) await record.exited;
  });
  it.each(['opening', 'foreign', 'rollback'] as const)('%s取消仅本图准确资源，原用户事务仍存活，编号保留墓碑', async phase => {
    const profile = fixture(), reached = deferred<void>(); let armed = false, paused = false, release!: () => void;
    const { app, events } = runtime(profile, () => transport((message, forward) => {
      const match = phase === 'opening' ? message.kind === 'opened' : message.kind === 'statement' && (phase === 'foreign' ? message.sql.includes('pragma_foreign_key_list') : message.sql === 'ROLLBACK');
      if (armed && !paused && match) { paused = true; release = forward; reached.resolve(); } else forward();
    }));
    const source = await request(app, profile), user = await app.request('sessions.open', { connectionId: profile.id }); await app.request('query.transaction', { ...user, action: 'begin' }); armed = true;
    const reading = app.request('sqlite.relationships', source).catch(reason => reason); await reached.promise;
    const stopping = app.request('query.cancel', { taskId: source.taskId }); if (phase === 'rollback') release(); await stopping;
    expect(await reading).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(taskState(app, source.taskId)).toEqual({ kind: 'browse-finished' });
    const state = await app.request('query.sessionState', user); expect(state).toEqual({ transactionOpen: true, transactionKnown: true, broken: false }); await app.request('query.transaction', { ...user, action: 'rollback' });
    const sent = processes[1].sent.length; await app.request('query.cancel', { taskId: source.taskId }); expect(processes[1].sent).toHaveLength(sent); expect(processes[1].kills).toBe(0);
    await expect(app.request('sqlite.relationships', source)).rejects.toThrow('编号已经使用');
  });
  it('两轮准确任务退出前拒绝第三轮，不为超量请求创建worker', async () => {
    const profile = fixture(); let armed = false; const releases: (() => void)[] = [], reached = deferred<void>();
    const { app } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'opened') { releases.push(forward); if (releases.length === 2) reached.resolve(); } else forward(); }));
    const source = await request(app, profile); armed = true;
    const first = app.request('sqlite.relationships', source), second = app.request('sqlite.relationships', { ...source, taskId: randomUUID() });
    await reached.promise; const count = processes.length;
    await expect(app.request('sqlite.relationships', { ...source, taskId: randomUUID() })).rejects.toThrow('并发上限'); expect(processes).toHaveLength(count);
    armed = false; releases.forEach(release => release()); await Promise.all([first, second]);
    await expect(app.request('sqlite.relationships', { ...source, taskId: randomUUID() })).resolves.toMatchObject({ tables: [{ name: 'mix' }] });
  });
});
/** 只检查新browse任务是否退化为轻量墓碑，不开放产品调试API或触碰真实进程对象。 */
function taskState(app: SqliteRuntime, taskId: string): unknown { return (app as unknown as { tasks: Map<string, unknown> }).tasks.get(taskId); }
/** 核每个已完成任务都正常ROLLBACK并关闭准确只读进程，且无COUNT与整表无界读取。 */
async function closedRead(record: ProcessRecord): Promise<void> {
  expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0);
  expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } });
  const queries = record.sent.filter((message): message is Extract<SqliteWorkerRequest, { kind: 'execute' }> => message.kind === 'execute');
  expect(queries[0].sql).toBe('BEGIN'); expect(queries.at(-1)?.sql).toBe('ROLLBACK'); expect(queries.some(query => /\bCOUNT\s*\(/i.test(query.sql))).toBe(false);
}

describe('SQLite真正只读服务器分页、typed筛选与准确任务收尾', () => {
  it('准确1024个列表/类型/分页绑定经过原utility保护真实执行，不提高原worker门槛', async () => {
    const profile = fixture(), { app } = runtime(profile), values = Array.from({ length: 128 }, () => ({ kind: 'text' as const, value: '' }));
    const filters = [...Array.from({ length: 7 }, () => ({ column: 'value', operator: 'in' as const, values })), { column: 'value', operator: 'in' as const, values: values.slice(0, 118) }];
    expect(ids(await page(app, input(profile, '准确列表绑定上限', { filters })))).toEqual([]);
    expect(processes.flatMap(record => record.sent).some(message => message.kind === 'execute' && message.parameters?.length === 1024)).toBe(true);
    for (const record of processes) await closedRead(record);
  });
  it.each(['mix', 'mix_view'])('%s的紧凑原格存储类型由真实协议保留，与同一磁盘typeof逐格一致', async table => {
    const profile = fixture(), { app } = runtime(profile), actual = await page(app, input(profile, '原格存储类型', { table, limit: 100 }));
    const observer = new DatabaseSync(profile.sqlite.filePath!, { readOnly: true });
    try {
      const fields = actual.columns.map(column => 'substr(typeof("' + column.name.replaceAll('"', '""') + '"),1,1)').join('||');
      const expected = observer.prepare('SELECT ' + fields + ' AS codes FROM "' + table + '" ORDER BY id').all().map(row => row.codes);
      expect(actual.storageTypes).toEqual(expected); expect(actual.storageTypes?.every(row => row.length === actual.columns.length)).toBe(true);
    } finally { observer.close(); }
    for (const record of processes) await closedRead(record);
  });
  it('多读一行决定hasMore，分页/末页/空页有界，64位与REAL/TEXT/NULL/BLOB及生成列保真', async () => {
    const profile = fixture(), { app, events } = runtime(profile);
    const first = await page(app, input(profile, '第一页'));
    expect(first.target).toEqual({ connectionId: profile.id, database: 'main', table: 'mix', kind: 'table' }); expect(first.offset).toBe(0); expect(first.limit).toBe(3); expect(first.hasMore).toBe(true);
    expect(first.columns.map(column => column.name)).toEqual(['id', 'value', 'group_name', 'rank', 'doubled', 'stored']);
    expect(first.result.columns.map(column => column.type)).toEqual(Array(6).fill('SQLITE'));
    expect(first.result.rows[0]).toEqual({ c0: '1', c1: '9223372036854775807', c2: 'A', c3: '10', c4: '2', c5: '101' });
    expect(first.result.rows[1].c1).toBe('-9223372036854775808'); expect(first.result.rows[2].c1).toBe('1.25'); expect(first.result.truncated).toBe(false);
    const second = await page(app, input(profile, '第二页', { offset: 3 })); expect(ids(second)).toEqual(['4', '5', '6']); expect(second.hasMore).toBe(true);
    expect(second.result.rows.map(row => row.c1)).toEqual(['9223372036854775807', null, { type: 'binary', base64: 'AP8=' }]);
    const last = await page(app, input(profile, '最后页', { offset: 9 })); expect(ids(last)).toEqual(['10']); expect(last.hasMore).toBe(false);
    const empty = await page(app, input(profile, '空页', { offset: 100 })); expect(empty.result.rows).toEqual([]); expect(empty.hasMore).toBe(false); expect(empty.columns).toEqual(first.columns);
    for (const record of processes) await closedRead(record);
    const select = processes[0].sent.find(message => message.kind === 'execute' && message.sql.includes(' FROM "main"."mix" AS "__dbark_source"'));
    expect(select).toMatchObject({ parameters: [{ type: 'integer', value: '4' }, { type: 'integer', value: '0' }], options: { maxRows: 4 } });
    expect(events.filter(event => event.status !== 'running').map(event => [event.taskId, event.status])).toEqual([['第一页', 'completed'], ['第二页', 'completed'], ['最后页', 'completed'], ['空页', 'completed']]);
    expect(app.ownsTask('第一页')).toBe(true); await expect(page(app, input(profile, '第一页'))).rejects.toThrow('已经使用');
    for (const id of ['第一页', '第二页', '最后页', '空页']) expect(taskState(app, id)).toEqual({ kind: 'browse-finished' });
  });

  it('不同值使用独立真实只读快照，原类型/NULL/精度、搜索及混合勾选补集均一致', async () => {
    const profile = fixture(), { app } = runtime(profile), original = await page(app, input(profile, '候选源结构'));
    const request = { connectionId: profile.id, database: 'main', table: 'mix', column: 'value', schemaKey: original.schemaKey, taskId: '原类型候选', mode: 'and', filters: [], search: '' };
    const output = await app.request('sqlite.valueOptions', request);
    expect(output.request).toEqual(request); expect(output.truncated).toBe(false); expect(output.values).toHaveLength(10); expect(output.values.every((option: { count: string }) => option.count === '1')).toBe(true);
    expect(output.values.map((option: { value: unknown }) => option.value)).toEqual(expect.arrayContaining([{ kind: 'integer', value: '9223372036854775807' }, { kind: 'integer', value: '-9223372036854775808' }, { kind: 'text', value: '9223372036854775807' }, { kind: 'blob', value: '00ff' }, { kind: 'null' }, { kind: 'text', value: '空\0字符' }]));
    const selectedValues = [{ kind: 'integer' as const, value: '9223372036854775807' }, { kind: 'text' as const, value: '9223372036854775807' }, { kind: 'null' as const }, { kind: 'blob' as const, value: '00ff' }];
    expect(ids(await page(app, input(profile, '混合类型包含', { limit: 100, filters: [{ column: 'value', operator: 'oneOf', selectedValues }] })))).toEqual(['1', '4', '5', '6']);
    expect(ids(await page(app, input(profile, '混合类型排除', { limit: 100, filters: [{ column: 'value', operator: 'notOneOf', selectedValues }] })))).toEqual(['2', '3', '7', '8', '9', '10']);
    const search = await app.request('sqlite.valueOptions', { ...request, taskId: '全表原文搜索', search: '%_' }); expect(search.values).toEqual([{ value: { kind: 'text', value: '50%_中文🚢' }, count: '1' }]);
    await expect(app.request('sqlite.valueOptions', { ...request, taskId: '过期结构候选', schemaKey: '0'.repeat(64) })).rejects.toThrow('结构');
    for (const record of processes) {
      const queries = record.sent.filter((message): message is Extract<SqliteWorkerRequest, { kind: 'execute' }> => message.kind === 'execute'), groups = queries.filter(query => query.sql.includes('GROUP BY'));
      if (!groups.length) { await closedRead(record); continue; }
      expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } });
      expect(queries[0].sql).toBe('BEGIN'); expect(queries.at(-1)?.sql).toBe('ROLLBACK'); expect(groups).toHaveLength(1); expect(groups[0].sql).toMatch(/GROUP BY typeof\(.+LIMIT 501$/); expect(groups[0].sql).toContain('count(*)');
    }
  });
  it('500+1不同值有界，搜索仍扫描完整集合，原排序规则分组且无穷REAL保持原值', async () => {
    const profile = fixture(); disk(profile, db => {
      db.exec('CREATE TABLE choices(id INTEGER PRIMARY KEY,v COLLATE NOCASE)'); const insert = db.prepare('INSERT INTO choices(v) VALUES(?)');
      // 合成数据一起提交，避免数百次磁盘同步耗尽原5秒期限；读取、原行值和资源断言保持。
      db.exec('BEGIN');
      for (let index = 0; index < 601; index++) insert.run('g' + String(index).padStart(4, '0')); insert.run('g0600'); insert.run('A'); insert.run('a'); insert.run(null); db.exec('INSERT INTO choices(v) VALUES(1e999)');
      db.exec('COMMIT');
    });
    const { app } = runtime(profile), original = await page(app, input(profile, '候选上限结构', { table: 'choices' })), request = { connectionId: profile.id, database: 'main', table: 'choices', column: 'v', schemaKey: original.schemaKey, mode: 'and', filters: [], search: '', taskId: '候选上限' };
    const first = await app.request('sqlite.valueOptions', request); expect(first.values).toHaveLength(500); expect(first.truncated).toBe(true); expect(first.values).toContainEqual({ value: { kind: 'null' }, count: '1' }); expect(first.values).toContainEqual({ value: { kind: 'real', value: 'Infinity' }, count: '1' }); expect(first.values.filter((option: { value: { value?: string } }) => option.value.value === 'A' || option.value.value === 'a')).toHaveLength(1); expect(first.values.find((option: { count: string }) => option.count === '2')).toMatchObject({ count: '2' });
    const beyond = await app.request('sqlite.valueOptions', { ...request, taskId: '第601组搜索', search: 'g0600' }); expect(beyond.values).toEqual([{ value: { kind: 'text', value: 'g0600' }, count: '2' }]); expect(beyond.truncated).toBe(false);
    for (const record of processes) { expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); }
  });
  it.each(['frequency', 'frequency_view'])('%s的真实次数排序先扫描完整532组，再取500，原类型／排序规则及冻结条件保持', async table => {
    const profile = fixture(); disk(profile, db => {
      db.exec('CREATE TABLE frequency(id INTEGER PRIMARY KEY,n COLLATE NOCASE); CREATE VIEW frequency_view AS SELECT id,n FROM frequency');
      const insert = db.prepare('INSERT INTO frequency(n) VALUES(?)');
      for (let i = 0; i < 520; i++) insert.run('g' + String(i).padStart(4, '0'));
      for (let i = 0; i < 100; i++) insert.run('zz_hot'); for (let i = 0; i < 9; i++) insert.run('yy_warm');
      for (const value of [null, null, '', 'NULL', 'A', 'a', 2n, 2n, 2, 2, '2', '2', '2', Buffer.from('00ff', 'hex'), Buffer.from('00ff', 'hex'), Infinity, '前\0🚢']) insert.run(value);
    });
    const baseline = disk(profile, db => db.prepare('SELECT id,typeof(n) AS kind,hex(n) AS bytes FROM frequency ORDER BY id').all()), { app } = runtime(profile);
    expect(baseline).toHaveLength(646);
    const original = await page(app, input(profile, '次数原结构', { table, sort: [] })), request: SqliteValueOptionsInput = { connectionId: profile.id, database: 'main', table, column: 'n', schemaKey: original.schemaKey, taskId: '次数默认', mode: 'and', filters: [], search: '' };
    const read = (value: SqliteValueOptionsInput) => app.request('sqlite.valueOptions', value) as Promise<SqliteValueOptionsOutput>;
    const first = await read(request); expect(first.values).toHaveLength(500); expect(first.truncated).toBe(true); expect(first.request).not.toHaveProperty('order'); expect(first.values.some(option => option.value.kind === 'text' && option.value.value === 'zz_hot')).toBe(false);
    const most = await read({ ...request, taskId: '最多次数', order: 'count-desc' }); expect(most.values).toHaveLength(500); expect(most.truncated).toBe(true);
    expect(most.values.slice(0, 3)).toEqual([{ value: { kind: 'text', value: 'zz_hot' }, count: '100' }, { value: { kind: 'text', value: 'yy_warm' }, count: '9' }, { value: { kind: 'text', value: '2' }, count: '3' }]);
    expect(most.values.slice(3, 7)).toEqual([{ value: { kind: 'blob', value: '00ff' }, count: '2' }, { value: { kind: 'integer', value: '2' }, count: '2' }, { value: { kind: 'null' }, count: '2' }, { value: { kind: 'real', value: '2' }, count: '2' }]);
    expect(most.values[7].count).toBe('2'); expect(most.values[7].value.kind).toBe('text'); expect((most.values[7].value as { value: string }).value.toLowerCase()).toBe('a');
    const least = await read({ ...request, taskId: '最少次数', order: 'count-asc' }); expect(least.values).toHaveLength(500); expect(least.values.every(option => option.count === '1')).toBe(true); expect(least.values[0]).toEqual({ value: { kind: 'real', value: 'Infinity' }, count: '1' });
    const filtered = { ...request, filters: [{ column: 'id', operator: 'lte' as const, value: { kind: 'integer' as const, value: '625' } }], order: 'count-desc' as const };
    expect((await read({ ...filtered, taskId: '冻结原条件' })).values.slice(0, 2)).toEqual([{ value: { kind: 'text', value: 'zz_hot' }, count: '100' }, { value: { kind: 'text', value: 'yy_warm' }, count: '5' }]);
    const searched = await read({ ...filtered, taskId: '搜索后次数', search: 'warm' }); expect(searched.values).toEqual([{ value: { kind: 'text', value: 'yy_warm' }, count: '5' }]); expect(searched.truncated).toBe(false);
    expect(disk(profile, db => db.prepare('SELECT id,typeof(n) AS kind,hex(n) AS bytes FROM frequency ORDER BY id').all())).toEqual(baseline);
    const groups = processes.flatMap(record => record.sent).filter((message): message is Extract<SqliteWorkerRequest, { kind: 'execute' }> => message.kind === 'execute' && message.sql.includes('GROUP BY typeof('));
    expect(groups).toHaveLength(5); expect(groups.filter(message => message.sql.includes('ORDER BY count(*) DESC, typeof('))).toHaveLength(3); expect(groups.filter(message => message.sql.includes('ORDER BY count(*) ASC, typeof('))).toHaveLength(1); expect(groups.every(message => message.sql.endsWith(' LIMIT 501') && message.options.maxRows === 501)).toBe(true);
    for (const record of processes) { expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } }); }
  });
  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s候选保真实NUL/BOM/Unicode；坏编码代表值明确拒绝，不发布替代字符', async encoding => {
    const profile = fixture(encoding); disk(profile, db => { db.exec('CREATE TABLE encoded_values(id INTEGER PRIMARY KEY,v TEXT)'); const insert = db.prepare('INSERT INTO encoded_values(v) VALUES(?)'); insert.run('前\0🚢后'); insert.run('\uFEFF真实BOM'); });
    const { app } = runtime(profile), original = await page(app, input(profile, '编码候选结构', { table: 'encoded_values', sort: [] })), request = { connectionId: profile.id, database: 'main', table: 'encoded_values', column: 'v', schemaKey: original.schemaKey, mode: 'and', filters: [], search: '', taskId: '原文候选' };
    const exact = await app.request('sqlite.valueOptions', request); expect(exact.values).toEqual(expect.arrayContaining([{ value: { kind: 'text', value: '前\0🚢后' }, count: '1' }, { value: { kind: 'text', value: '\uFEFF真实BOM' }, count: '1' }]));
    const bytes = encoding === 'UTF-8' ? '80' : encoding === 'UTF-16le' ? '00d8' : 'd800'; disk(profile, db => db.exec("INSERT INTO encoded_values(v) VALUES(CAST(X'" + bytes + "' AS TEXT))"));
    await expect(app.request('sqlite.valueOptions', { ...request, taskId: '坏编码候选' })).rejects.toThrow(/编码|无损|TEXT/);
    for (const record of processes) { expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); }
  });
  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s只读表页坏编码不能静默替换成真实U+FFFD', async encoding => {
    const profile = fixture(encoding), bytes = encoding === 'UTF-8' ? '80' : encoding === 'UTF-16le' ? '00d8' : 'd800';
    disk(profile, db => { db.exec('CREATE TABLE invalid_page(id INTEGER PRIMARY KEY,v)'); db.prepare('INSERT INTO invalid_page VALUES(1,?)').run('真实替代字符\uFFFD\0🚢'); db.exec("INSERT INTO invalid_page VALUES(2,CAST(X'" + bytes + "' AS TEXT))"); });
    const before = disk(profile, db => db.prepare('SELECT id,typeof(v) AS kind,hex(v) AS bytes FROM invalid_page ORDER BY id').all()), { app } = runtime(profile);
    await expect(page(app, input(profile, '只读坏编码', { table: 'invalid_page', limit: 10 }))).rejects.toThrow(/编码|无损|TEXT/);
    const recovered = await page(app, input(profile, '明确缩小到有效记录', { table: 'invalid_page', limit: 10, filters: [{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '1' } }] }));
    expect(recovered.result.rows).toEqual([{ c0: '1', c1: '真实替代字符\uFFFD\0🚢' }]); expect(recovered.storageTypes).toEqual(['it']);
    expect(disk(profile, db => db.prepare('SELECT id,typeof(v) AS kind,hex(v) AS bytes FROM invalid_page ORDER BY id').all())).toEqual(before);
    for (const record of processes) await closedRead(record);
  });
  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s有效表及视图保NUL/BOM/真实U+FFFD与五类存储，不改变原页列名或值', async encoding => {
    const profile = fixture(encoding); disk(profile, db => {
      db.exec('CREATE TABLE exact_page(id INTEGER PRIMARY KEY,v); CREATE VIEW exact_page_view AS SELECT * FROM exact_page'); const insert = db.prepare('INSERT INTO exact_page VALUES(?,?)');
      [null, '\uFEFF前\0🚢后', 9223372036854775807n, 1.25, Buffer.from([128, 255]), '\uFFFD'].forEach((value, index) => insert.run(index + 1, value));
    }); const { app } = runtime(profile);
    for (const table of ['exact_page', 'exact_page_view']) {
      const result = await page(app, input(profile, '完整原文' + table, { table, limit: 10 }));
      expect(result.result.rows).toEqual([{ c0: '1', c1: null }, { c0: '2', c1: '\uFEFF前\0🚢后' }, { c0: '3', c1: '9223372036854775807' }, { c0: '4', c1: '1.25' }, { c0: '5', c1: { type: 'binary', base64: 'gP8=' } }, { c0: '6', c1: '\uFFFD' }]);
      expect(result.result.columns.map(column => [column.key, column.name])).toEqual([['c0', 'id'], ['c1', 'v']]); expect(result.storageTypes).toEqual(['in', 'it', 'ii', 'ir', 'ib', 'it']);
    } for (const record of processes) await closedRead(record);
  });
  it('非确定性视图列仍是一次原值，不以重复求值制造文本校验失败', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW volatile_page AS SELECT hex(randomblob(32)) AS value'));
    const { app } = runtime(profile), value = await page(app, input(profile, '随机视图原文', { table: 'volatile_page', sort: [], limit: 1 }));
    expect(value.result.rows).toHaveLength(1); expect(value.result.rows[0].c0).toMatch(/^[0-9A-F]{64}$/); expect(value.storageTypes).toEqual(['t']);
    for (const record of processes) await closedRead(record);
  });
  it('真实worker文本首尾和排除匹配保NUL与通配原文，不纳入NULL或其它存储类型', async () => {
    const profile = fixture(), { app } = runtime(profile); let serial = 0;
    for (const [operator, value, expected] of [
      ['notContains', '%_', ['4', '7', '9']], ['startsWith', '50%_', ['8']], ['notStartsWith', '50%_', ['4', '7', '9']],
      ['endsWith', '\0字符', ['9']], ['notEndsWith', '\0字符', ['4', '7', '8']], ['endsWith', '', ['4', '7', '8', '9']],
    ] as const) expect(ids(await page(app, input(profile, '文本首尾' + ++serial, { limit: 100, filters: [{ column: 'value', operator, value: { kind: 'text', value } }] })))).toEqual(expected);
    for (const record of processes) await closedRead(record);
  });
  it('typed比较匹配真实存储类型，contains为字面包含，AND/OR与多列排序均由服务器执行', async () => {
    const profile = fixture(), { app } = runtime(profile); let serial = 0;
    const filter = (filters: SqliteTablePageInput['filters'], patch: Partial<SqliteTablePageInput> = {}) => page(app, input(profile, '筛选' + ++serial, { limit: 100, filters, ...patch }));
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'integer', value: '9223372036854775807' } }]))).toEqual(['1']);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'text', value: '9223372036854775807' } }]))).toEqual(['4']);
    expect(ids(await filter([{ column: 'value', operator: 'ne', value: { kind: 'integer', value: '9223372036854775807' } }]))).toEqual(['2']);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'real', value: '+.125e1' } }]))).toEqual(['3']);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'real', value: '-0' } }]))).toEqual(['10']);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'integer', value: '-0' } }]))).toEqual([]);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'blob', value: '00FF' } }]))).toEqual(['6']);
    expect(ids(await filter([{ column: 'value', operator: 'contains', value: { kind: 'text', value: '%_' } }]))).toEqual(['8']);
    expect(ids(await filter([{ column: 'value', operator: 'contains', value: { kind: 'text', value: "' OR 1=1 --" } }]))).toEqual(['7']);
    expect(ids(await filter([{ column: 'value', operator: 'eq', value: { kind: 'text', value: '空\0字符' } }]))).toEqual(['9']);
    expect(ids(await filter([{ column: 'value', operator: 'isNull' }]))).toEqual(['5']);
    expect(ids(await filter([{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '1' } }, { column: 'value', operator: 'isNull' }], { mode: 'or' }))).toEqual(['1', '5']);
    expect(ids(await filter([{ column: 'group_name', operator: 'eq', value: { kind: 'text', value: 'A' } }, { column: 'rank', operator: 'gte', value: { kind: 'integer', value: '30' } }]))).toEqual(['4', '10']);
    expect(ids(await filter([], { sort: [{ column: 'group_name', direction: 'asc' }, { column: 'rank', direction: 'desc' }, { column: 'id', direction: 'desc' }] }))).toEqual(['10', '4', '8', '7', '2', '1', '6', '3', '9', '5']);
    const injected = processes.flatMap(record => record.sent).filter((message): message is Extract<SqliteWorkerRequest, { kind: 'execute' }> => message.kind === 'execute').find(message => message.parameters?.includes("' OR 1=1 --"));
    expect(injected).toBeDefined(); expect(injected!.sql).not.toContain("' OR 1=1 --"); expect(injected!.sql).toContain('typeof("__dbark_source"."value") = ? AND instr("__dbark_source"."value", ?) > 0');
    for (const record of processes) await closedRead(record);
  });

  it('table/view与Unicode双引号标识符正确引用；未知字段/伪SQL名称/元数据变更不借旧白名单', async () => {
    const profile = fixture(), { app } = runtime(profile);
    const view = await page(app, input(profile, '视图', { table: 'mix_view', limit: 1 })); expect(view.target.kind).toBe('view'); expect(ids(view)).toEqual(['1']);
    const unicode = await page(app, input(profile, '双引号标识符', { table: '引号"船🚢', sort: [{ column: '字段"甲', direction: 'asc' }], filters: [{ column: '字段"甲', operator: 'eq', value: { kind: 'text', value: 'Unicode中文🚢' } }] }));
    expect(unicode.result.rows).toEqual([{ c0: 'Unicode中文🚢' }]); expect(unicode.result.statement).toContain('FROM "main"."引号""船🚢" AS "__dbark_source"'); expect(unicode.result.statement).toContain('dbark_sqlite_export_text_exact_v1("__dbark_source"."字段""甲", CAST("__dbark_source"."字段""甲" AS BLOB))');
    await expect(page(app, input(profile, '字段注入', { filters: [{ column: 'value" OR 1=1 --', operator: 'isNull' }] }))).rejects.toThrow('列已不存在');
    await expect(page(app, input(profile, '对象注入', { table: 'mix"; DROP TABLE mix; --' }))).rejects.toThrow('表或视图已不存在');
    disk(profile, db => db.exec('ALTER TABLE mix RENAME COLUMN group_name TO renamed_group'));
    await expect(page(app, input(profile, '旧字段', { sort: [{ column: 'group_name', direction: 'asc' }] }))).rejects.toThrow('列已不存在');
    const next = await page(app, input(profile, '新结构')); expect(next.columns.map(column => column.name)).toContain('renamed_group');
    disk(profile, db => db.exec('DROP VIEW mix_view')); await expect(page(app, input(profile, '删除后视图', { table: 'mix_view' }))).rejects.toThrow('表或视图已不存在');
    expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM mix').get()!.n)).toBe(10);
    for (const record of processes) await closedRead(record);
  });

  it('元数据与数据处于同一读快照，外部WAL结构变更只在下一页请求出现，不借用户事务', async () => {
    const profile = fixture(); let changed = false;
    const { app } = runtime(profile, () => transport((message, forward, record) => {
      const current = record.sent.filter((sent): sent is Extract<SqliteWorkerRequest, { kind: 'execute' }> => sent.kind === 'execute').at(-1);
      if (!changed && message.kind === 'batch' && current?.sql.includes('SELECT name,type,sql FROM main.sqlite_schema')) { disk(profile, db => db.exec('ALTER TABLE mix ADD COLUMN added_later TEXT')); changed = true; }
      forward();
    }));
    const user = await app.request('sessions.open', { connectionId: profile.id });
    await app.request('query.execute', { ...user, taskId: '原事务写入', sql: "BEGIN; INSERT INTO mix(id,value,group_name,rank) VALUES(99,'用户未提交','A',1)", maxRows: 100 });
    // 用户写事务持有锁时不制造结构写竞争，先仅核真正独立读取不可见未提交值。
    changed = true; const isolated = await page(app, input(profile, '独立读', { limit: 100 })); expect(ids(isolated)).not.toContain('99');
    await app.request('query.transaction', { ...user, action: 'rollback' }); changed = false;
    const snapshot = await page(app, input(profile, '原快照')); expect(changed).toBe(true); expect(snapshot.columns.map(column => column.name)).not.toContain('added_later');
    const next = await page(app, input(profile, '下一请求新快照')); expect(next.columns.map(column => column.name)).toContain('added_later'); expect(next.result.rows.every(row => row.c6 === null)).toBe(true);
    expect(await app.request('query.sessionState', user)).toEqual({ transactionOpen: false, transactionKnown: true, broken: false }); await app.request('sessions.close', user);
  });

  it('真实FTS隐藏虚列不进入浏览，生成列仍可见，无列/列数及输入预算在投递前明确拒绝', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE VIRTUAL TABLE docs USING fts5(body); INSERT INTO docs(body) VALUES('可见正文')"));
    const { app } = runtime(profile), docs = await page(app, input(profile, '隐藏列', { table: 'docs', sort: [] }));
    expect(docs.columns).toEqual([{ name: 'body', declaredType: '' }]); expect(docs.result.rows).toEqual([{ c0: '可见正文' }]);
    const baseline = processes.length;
    await expect(page(app, input(profile, '超页数', { limit: 1001 }))).rejects.toThrow();
    await expect(page(app, input(profile, '重复排序', { sort: [{ column: 'id', direction: 'asc' }, { column: 'id', direction: 'desc' }] }))).rejects.toThrow();
    expect(processes).toHaveLength(baseline);
    // 无列与列数检查是确定性SQL编译器边界；不伪造数据库的成功元数据来替代真实driver。
    expect(() => buildSqliteTableSelect(input(profile, '无列'), [])).toThrow('没有可浏览列');
    expect(() => buildSqliteTableSelect(input(profile, '列预算'), Array.from({ length: 1025 }, (_, index) => ({ name: 'field' + index, declaredType: '' })))).toThrow('列目录超过预算');
  });

  it.each([false, true])('真实driver readOnly=%s只放行data_version读取及FTS SELECT/MATCH，赋值与危险PRAGMA仍拒绝', async readOnly => {
    const profile = fixture(), body = '航船 SQLite 安全正文';
    disk(profile, db => { db.exec('CREATE VIRTUAL TABLE docs USING fts5(body)'); db.prepare('INSERT INTO docs(body) VALUES(?)').run(body); });
    const driver = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly, busyTimeoutMs: 100 }); drivers.add(driver);
    /** 原生值仅经原driver批次收集，SQL和授权回执均不替换。 */
    const collect = async (sql: string, parameters: SqliteValue[] = []) => {
      const rows: SqliteValue[][] = []; await driver.execute(sql, { parameters, onBatch: batch => { rows.push(...batch.rows); } }); return rows;
    };
    const version = await collect('PRAGMA data_version'); expect(version).toHaveLength(1); expect(version[0]).toHaveLength(1); expect(version[0][0]).toMatchObject({ type: 'integer', value: expect.stringMatching(/^[1-9][0-9]*$/) });
    expect(await collect('PRAGMA main.data_version')).toEqual(version);
    for (const sql of ['PRAGMA data_version=1', 'PRAGMA data_version(1)', 'PRAGMA main.data_version=7', 'PRAGMA writable_schema=ON', 'PRAGMA foreign_keys=OFF', 'PRAGMA query_only=OFF']) {
      await expect(driver.execute(sql)).rejects.toBeInstanceOf(SqliteDriverError); expect(driver.isUsable).toBe(true); expect(driver.transaction).toBe(false);
    }
    expect(await collect('SELECT body FROM docs')).toEqual([[body]]);
    expect(await collect('SELECT body FROM docs WHERE docs MATCH ?', ['SQLite'])).toEqual([[body]]);
    if (readOnly) {
      for (const sql of ["INSERT INTO docs(body) VALUES('只读不得写入')", "UPDATE docs SET body='只读不得修改'", 'DELETE FROM docs']) await expect(driver.execute(sql)).rejects.toBeInstanceOf(SqliteDriverError);
      expect(await collect('SELECT body FROM docs')).toEqual([[body]]);
      expect(disk(profile, db => db.prepare('SELECT body FROM docs').all().map(row => row.body))).toEqual([body]);
    } else {
      await driver.execute("INSERT INTO docs(body) VALUES('用户明确的读写连接写入')");
      expect(disk(profile, db => db.prepare('SELECT body FROM docs ORDER BY rowid').all().map(row => row.body))).toEqual([body, '用户明确的读写连接写入']);
    }
    await driver.close(); expect(await processes.at(-1)!.exited).toEqual({ code: 0, signal: null }); expect(processes.at(-1)!.kills).toBe(0);
  });

  it('16MiB完整页预算不足明确失败，不把丢掉的额外一行误报成无下一页；缩小页后正常读', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE large_rows(id INTEGER PRIMARY KEY,payload TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<40) INSERT INTO large_rows SELECT x,printf('%0450000d',x) FROM n"));
    const { app, events } = runtime(profile);
    await expect(page(app, input(profile, '预算不足', { table: 'large_rows', limit: 40 }))).rejects.toThrow('超过预算');
    expect(events.at(-1)).toMatchObject({ taskId: '预算不足', status: 'failed' }); await closedRead(processes[0]);
    const smaller = await page(app, input(profile, '减少每页', { table: 'large_rows', limit: 1 })); expect(smaller.hasMore).toBe(true); expect(smaller.result.rows).toHaveLength(1); expect(String(smaller.result.rows[0].c1)).toHaveLength(450000); await closedRead(processes[1]);
  });

  it('原生数组未超预算但QueryResult键名开销超过16MiB时也明确拒页，不自动缩页', async () => {
    const profile = fixture(); disk(profile, db => {
      const columns = Array.from({ length: 1023 }, (_, index) => 'f' + index + ' TEXT').join(',');
      db.exec('CREATE TABLE wide(id INTEGER PRIMARY KEY,' + columns + ')');
      db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO wide SELECT x," + Array(1023).fill("'abcdefgh'").join(',') + ' FROM n');
    });
    const { app } = runtime(profile);
    await expect(page(app, input(profile, '对象预算', { table: 'wide', limit: 1000 }))).rejects.toThrow('结果对象超过16MiB');
    await closedRead(processes[0]);
    const smaller = await page(app, input(profile, '对象预算缩小每页', { table: 'wide', limit: 10 })); expect(smaller.result.rows).toHaveLength(10); expect(smaller.hasMore).toBe(true); await closedRead(processes[1]);
  }, 15000);

  it.each(['opening', 'schema', 'catalogue', 'select', 'rollback'] as const)('%s边界取消只作用准确任务，原driver收尾后先发布cancelled再拒绝，旧编号不取消后继读取', async phase => {
    const profile = fixture(), reached = deferred<void>(), nextReached = deferred<void>(); let paused = false, holdNext = false, release!: () => void, releaseNext!: () => void;
    const { app, events } = runtime(profile, () => transport((message, forward) => {
      const match = phase === 'opening' ? message.kind === 'opened' : message.kind === 'statement' && (phase === 'schema' ? message.sql.includes('SELECT name,type,sql FROM main.sqlite_schema') : phase === 'catalogue' ? message.sql.includes('pragma_table_xinfo') : phase === 'select' ? message.sql.includes(' FROM "main"."mix" AS "__dbark_source"') : message.sql === 'ROLLBACK');
      if (!paused && match) { paused = true; release = forward; reached.resolve(); }
      else if (holdNext && message.kind === 'statement' && message.sql.includes(' FROM "main"."mix" AS "__dbark_source"')) { holdNext = false; releaseNext = forward; nextReached.resolve(); }
      else forward();
    }));
    const reading = page(app, input(profile, '准确取消')).catch(reason => { expect(events.at(-1)?.status).toBe('cancelled'); return reason; });
    await reached.promise; const cancelling = app.request('query.cancel', { taskId: '准确取消' });
    if (phase === 'rollback') { await delay(10); expect(processes[0].sent.some(message => message.kind === 'cancel')).toBe(false); release(); }
    await cancelling; expect(await reading).toBeInstanceOf(Error); expect(events.filter(event => event.status !== 'running').map(event => event.status)).toEqual(['cancelled']);
    await processes[0].exited; expect(processes[0].kills).toBe(phase === 'opening' ? 1 : 0);
    holdNext = true; const next = page(app, input(profile, '后继分页')); await nextReached.promise; const sent = processes[1].sent.length;
    await app.request('query.cancel', { taskId: '准确取消' }); expect(processes[1].sent).toHaveLength(sent); expect(processes[1].kills).toBe(0); releaseNext();
    expect(ids(await next)).toEqual(['1', '2', '3']); expect(app.ownsTask('准确取消')).toBe(true); expect(app.ownsTask('后继分页')).toBe(true);
    expect(taskState(app, '准确取消')).toEqual({ kind: 'browse-finished' }); expect(taskState(app, '后继分页')).toEqual({ kind: 'browse-finished' });
  });

  it.each(['value', 'count-desc', 'count-asc'] as const)('不同值%s真实阻塞分组准确取消，原用户事务仍打开，任务退出后保留编号墓碑', async order => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW values_expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT x AS value FROM n'));
    const reached = deferred<void>(), { app, events } = runtime(profile, () => transport((message, forward) => { forward(); if (message.kind === 'statement' && message.sql.includes('GROUP BY typeof(')) reached.resolve(); }));
    const original = await page(app, input(profile, '阻塞候选原结构', { table: 'values_expensive', sort: [] })), user = await app.request('sessions.open', { connectionId: profile.id }); await app.request('query.transaction', { ...user, action: 'begin' });
    const reading = app.request('sqlite.valueOptions', { connectionId: profile.id, database: 'main', table: 'values_expensive', column: 'value', schemaKey: original.schemaKey, taskId: '原分组取消', mode: 'and', filters: [], search: '', ...(order === 'value' ? {} : { order }) }).catch(reason => reason);
    await reached.promise; await delay(50); await app.request('query.cancel', { taskId: '原分组取消' }); expect(await reading).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(processes[2].kills).toBe(1); expect(processes[1].kills).toBe(0); expect(taskState(app, '原分组取消')).toEqual({ kind: 'browse-finished' });
    expect(await app.request('query.sessionState', user)).toEqual({ transactionOpen: true, transactionKnown: true, broken: false }); await app.request('query.transaction', { ...user, action: 'rollback' }); await app.close();
  });
  it('真实阻塞聚合可准确强取消，只读分页关闭不会取消用户标签事务或另一个物理会话', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) AS total FROM n'));
    const reached = deferred<void>(); const { app, events } = runtime(profile, () => transport((message, forward) => { forward(); if (message.kind === 'statement' && message.sql.includes(' FROM "main"."expensive" AS "__dbark_source"')) reached.resolve(); }));
    const user = await app.request('sessions.open', { connectionId: profile.id }); await app.request('query.transaction', { ...user, action: 'begin' });
    const reading = page(app, input(profile, '原生阻塞取消', { table: 'expensive', sort: [] })).catch(reason => reason); await reached.promise; await delay(50);
    await app.request('query.cancel', { taskId: '原生阻塞取消' }); expect(await reading).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled'); expect(processes[1].kills).toBe(1); expect(processes[0].kills).toBe(0);
    expect(await app.request('query.sessionState', user)).toEqual({ transactionOpen: true, transactionKnown: true, broken: false }); await app.request('query.transaction', { ...user, action: 'rollback' }); await app.close();
  });

  it('连接关闭覆盖打开中的browse，迟到打开不能读取；forceClose保留旧任务SQLite墓碑', async () => {
    const profile = fixture(), reached = deferred<void>();
    const { app, events } = runtime(profile, () => transport((message, forward) => { if (message.kind === 'opened') reached.resolve(); else forward(); }));
    const reading = page(app, input(profile, '连接关闭中的浏览')).catch(reason => reason); await reached.promise;
    await app.request('connections.close', { id: profile.id }); expect(await reading).toBeInstanceOf(Error); expect(events.at(-1)?.status).toBe('cancelled');
    expect(processes[0].sent.some(message => message.kind === 'execute')).toBe(false); expect(app.ownsConnection(profile.id)).toBe(false); expect(app.ownsTask('连接关闭中的浏览')).toBe(true); await app.forceClose();
    await app.request('query.cancel', { taskId: '连接关闭中的浏览' }); expect(processes).toHaveLength(1);
  });

  it('取消后exit仍未确认必须failed且阻断新建，准确资源实际退出前不能假报取消成功', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) AS total FROM n'));
    const reached = deferred<void>(); let allowKill = false;
    const { app, events } = runtime(profile, () => {
      const original = transport((message, forward) => { forward(); if (message.kind === 'statement' && message.sql.includes(' FROM "main"."expensive" AS "__dbark_source"')) reached.resolve(); });
      return { ...original, terminate: () => allowKill ? original.terminate() : false };
    });
    const reading = page(app, input(profile, '退出未确认', { table: 'expensive', sort: [] })).catch(reason => reason); await reached.promise; await delay(50); vi.useFakeTimers();
    try {
      const cancelled = app.request('query.cancel', { taskId: '退出未确认' }).catch(reason => reason); await vi.advanceTimersByTimeAsync(5251); expect(await cancelled).toBeInstanceOf(Error);
      await vi.advanceTimersByTimeAsync(5001); expect(await reading).toBeInstanceOf(Error); expect(events.at(-1)).toMatchObject({ taskId: '退出未确认', status: 'failed' });
      expect(events.some(event => event.status === 'cancelled' || event.status === 'completed')).toBe(false);
      expect(taskState(app, '退出未确认')).toMatchObject({ kind: 'browse', resource: expect.any(Object) });
      await expect(page(app, input(profile, '不能新建'))).rejects.toThrow('资源尚未确认'); await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(1);
    } finally { allowKill = true; vi.useRealTimers(); }
    await app.forceClose(); await processes[0].exited; expect(app.ownsConnection(profile.id)).toBe(false); expect(app.ownsTask('退出未确认')).toBe(true); expect(taskState(app, '退出未确认')).toEqual({ kind: 'browse-finished' });
  });
});
