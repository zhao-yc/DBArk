import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTablePage, SqliteTablePageInput } from '../../src/shared/sqliteTableBrowse';

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
function fixture(): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-browse-')); directories.push(directory);
  const path = join(directory, 'sample.sqlite'), db = new DatabaseSync(path);
  try {
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
    const select = processes[0].sent.find(message => message.kind === 'execute' && message.sql.startsWith('SELECT "id"'));
    expect(select).toMatchObject({ parameters: [{ type: 'integer', value: '4' }, { type: 'integer', value: '0' }], options: { maxRows: 4 } });
    expect(events.filter(event => event.status !== 'running').map(event => [event.taskId, event.status])).toEqual([['第一页', 'completed'], ['第二页', 'completed'], ['最后页', 'completed'], ['空页', 'completed']]);
    expect(app.ownsTask('第一页')).toBe(true); await expect(page(app, input(profile, '第一页'))).rejects.toThrow('已经使用');
    for (const id of ['第一页', '第二页', '最后页', '空页']) expect(taskState(app, id)).toEqual({ kind: 'browse-finished' });
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
    expect(injected).toBeDefined(); expect(injected!.sql).not.toContain("' OR 1=1 --"); expect(injected!.sql).toContain('typeof("value") = ? AND instr("value", ?) > 0');
    for (const record of processes) await closedRead(record);
  });

  it('table/view与Unicode双引号标识符正确引用；未知字段/伪SQL名称/元数据变更不借旧白名单', async () => {
    const profile = fixture(), { app } = runtime(profile);
    const view = await page(app, input(profile, '视图', { table: 'mix_view', limit: 1 })); expect(view.target.kind).toBe('view'); expect(ids(view)).toEqual(['1']);
    const unicode = await page(app, input(profile, '双引号标识符', { table: '引号"船🚢', sort: [{ column: '字段"甲', direction: 'asc' }], filters: [{ column: '字段"甲', operator: 'eq', value: { kind: 'text', value: 'Unicode中文🚢' } }] }));
    expect(unicode.result.rows).toEqual([{ c0: 'Unicode中文🚢' }]); expect(unicode.result.statement).toContain('SELECT "字段""甲" FROM "main"."引号""船🚢"');
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
      const match = phase === 'opening' ? message.kind === 'opened' : message.kind === 'statement' && (phase === 'schema' ? message.sql.includes('SELECT name,type,sql FROM main.sqlite_schema') : phase === 'catalogue' ? message.sql.includes('pragma_table_xinfo') : phase === 'select' ? message.sql.startsWith('SELECT "id"') : message.sql === 'ROLLBACK');
      if (!paused && match) { paused = true; release = forward; reached.resolve(); }
      else if (holdNext && message.kind === 'statement' && message.sql.startsWith('SELECT "id"')) { holdNext = false; releaseNext = forward; nextReached.resolve(); }
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

  it('真实阻塞聚合可准确强取消，只读分页关闭不会取消用户标签事务或另一个物理会话', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW expensive AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) AS total FROM n'));
    const reached = deferred<void>(); const { app, events } = runtime(profile, () => transport((message, forward) => { forward(); if (message.kind === 'statement' && message.sql.startsWith('SELECT "total"')) reached.resolve(); }));
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
      const original = transport((message, forward) => { forward(); if (message.kind === 'statement' && message.sql.startsWith('SELECT "total"')) reached.resolve(); });
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
