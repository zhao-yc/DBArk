import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import type { SqliteTableExportRequest } from '../../src/main/sqliteTableExport';
import { sqliteSchemaExportLimits } from '../../src/main/sqliteSchemaExport';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite结构导出单测只允许本例准确Node进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只暂停准确原消息，不替换SQL、目录或提交成功事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-schema-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 只清理本例独占目录，失败保留原库/目标/脚本现场；准确进程退出在删除之前。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-schema-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const app of runtimes) await app.forceClose(); runtimes.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });
/** 真库含默认/生成列、外键、表达式及partial索引、带多语句和关键词回退标识符的trigger、高水位9000。 */
function fixture(): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-schema-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE audit(begin TEXT,note TEXT); CREATE TABLE subject(id INTEGER PRIMARY KEY AUTOINCREMENT,parent_id INTEGER REFERENCES parent(id),value,note TEXT DEFAULT '默认',payload BLOB,generated INTEGER GENERATED ALWAYS AS(id*2) STORED); CREATE UNIQUE INDEX explicit_unique ON subject(note); CREATE INDEX expression_partial ON subject(length(note)) WHERE parent_id IS NOT NULL;");
    const insert = db.prepare('INSERT INTO subject(id,parent_id,value,note,payload) VALUES(?,?,?,?,?)');
    insert.run(1, 1, 9223372036854775807n, '首\0尾中文🚢', Buffer.from([0, 255])); insert.run(2, 1, 1.25, "单'引号;?", null); insert.run(3, null, null, '第三', Buffer.alloc(0)); insert.run(9000, null, '删除高水位', '删除', null); db.exec('DELETE FROM subject WHERE id=9000');
    // BEGIN字段及AS end必须交由真实SQLite创建证明合法，不能为词法器修改原定义。
    db.exec("CREATE TRIGGER \"触\"\"发;器\" AFTER INSERT ON subject WHEN NEW.id>0 BEGIN INSERT INTO audit(begin,note) SELECT NEW.note, CASE WHEN NEW.id>0 THEN '内;部?''中文' ELSE '尾' END AS end; END; CREATE VIEW subject_view AS SELECT id,note FROM subject; CREATE TRIGGER view_insert INSTEAD OF INSERT ON subject_view BEGIN INSERT INTO subject(id,note) VALUES(NEW.id,NEW.note); END;");
  } finally { db.close(); }
  return { id: '结构源', name: '结构导出真实磁盘', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 全部观察连接独立于导出只读事务。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function runtime(profile: SqliteConnectionProfile, create: () => SqliteProcessTransport = transport) { const events: TaskEvent[] = []; const app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: create, emit: event => events.push(structuredClone(event)) }); runtimes.add(app); return { app, events }; }
function page(app: SqliteRuntime, profile: SqliteConnectionProfile, table = 'subject'): Promise<SqliteTablePage> { return app.request('sqlite.tablePage', { connectionId: profile.id, database: 'main', table, taskId: '结构页' + ++serial, mode: 'and', filters: [], sort: [], limit: 1, offset: 0 }); }
/** 私有输出能力只落本例目录；公有schemaKey一律来自真实原页。 */
function request(profile: SqliteConnectionProfile, source: SqliteTablePage, patch: Partial<SqliteTableExportRequest> = {}): SqliteTableExportRequest { return { connectionId: profile.id, database: 'main', table: source.target.table, taskId: '结构导出' + ++serial, fileToken: '本例已授权目标', filePath: join(dirname(profile.sqlite.filePath!), 'output' + serial + '.sql'), format: 'sql', sqlContent: 'structure', columns: [], encoding: 'utf8', schemaKey: source.schemaKey, mode: 'and', filters: [], sort: [], assertCurrent: () => {}, validateDestination: async () => {}, retainDestinationUntil: () => {}, ...patch }; }
function dependencies(db: InstanceType<typeof DatabaseSync>): void { db.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(1); CREATE TABLE audit(begin TEXT,note TEXT); CREATE TABLE other_seq(id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO other_seq VALUES(77)'); }
function definitions(db: InstanceType<typeof DatabaseSync>, table: string): unknown[] { return db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE tbl_name=? ORDER BY type,name').all(table); }
const inspect = 'SELECT id,parent_id,typeof(value) AS storage,CASE WHEN typeof(value)=\'blob\' THEN hex(value) ELSE quote(value) END AS value,hex(CAST(note AS BLOB)) AS note,hex(payload) AS payload,generated FROM subject ORDER BY id';

describe('SQLite结构及数据导出真实快照与独立SQL回放', () => {
  it('仅结构零数据SELECT/rows0，精确CREATE/index/trigger/FK及seq9000回放，目标其它序列不变', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile);
    // 附属目录取导出开始时自己的快照；浏览页之后新增的真实索引应包含在脚本中。
    disk(profile, db => db.exec('CREATE INDEX after_page_index ON subject(parent_id)'));
    const before = hash(profile.sqlite.filePath!), input = request(profile, source);
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 0, fileCommitted: true }); const original = processes.at(-1)!; expect(original.sent.filter(message => message.kind === 'streamRead')).toEqual([]); expect(await original.exited).toEqual({ code: 0, signal: null }); expect(original.kills).toBe(0); expect(hash(profile.sqlite.filePath!)).toBe(before);
    const sql = readFileSync(input.filePath, 'utf8'); expect(sql).toContain('BEGIN;\n'); expect(sql).toContain('COMMIT;\n'); expect(sql).not.toMatch(/\b(?:ATTACH|DROP|PRAGMA)\b/i); expect(sql).toContain('外部对象需要事先准备');
    const target = new DatabaseSync(join(dirname(input.filePath), 'structure-replay.sqlite'));
    try { dependencies(target); target.exec(sql); expect(definitions(target, 'subject')).toEqual(disk(profile, db => definitions(db, 'subject'))); expect(target.prepare('SELECT count(*) AS n FROM subject').get()!.n).toBe(0); expect(target.prepare("SELECT seq FROM sqlite_sequence WHERE name='subject'").get()!.seq).toBe(9000); expect(target.prepare("SELECT seq FROM sqlite_sequence WHERE name='other_seq'").get()!.seq).toBe(77); expect(target.prepare('PRAGMA foreign_key_list(subject)').all()).toEqual(disk(profile, db => db.prepare('PRAGMA foreign_key_list(subject)').all())); target.exec("INSERT INTO subject(parent_id,note) VALUES(1,'回放后')"); expect(target.prepare('SELECT id,generated FROM subject').get()).toEqual({ id: 9001, generated: 18002 }); expect(target.prepare('SELECT begin,note FROM audit').get()).toEqual({ begin: '回放后', note: "内;部?'中文" }); } finally { target.close(); }
  });

  it('结构+过滤数据使用重排全非生成列，精度/NUL/BLOB/NULL与生成值完整回放且装载时trigger无副作用', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile), input = request(profile, source, { sqlContent: 'structure-data', columns: ['payload', 'note', 'value', 'parent_id', 'id'], filters: [{ column: 'id', operator: 'lte', value: { kind: 'integer', value: '2' } }], sort: [{ column: 'id', direction: 'desc' }] });
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 2, fileCommitted: true }); const sent = processes.at(-1)!.sent.filter(message => message.kind === 'streamRead'); expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ parameters: ['integer', { type: 'integer', value: '2' }] });
    const sql = readFileSync(input.filePath, 'utf8'); expect(sql.indexOf('CREATE TRIGGER')).toBeGreaterThan(sql.lastIndexOf('INSERT INTO "main"."subject"')); expect(sql).toContain('char(0)');
    const target = new DatabaseSync(join(dirname(input.filePath), 'full-replay.sqlite'));
    try { dependencies(target); target.exec(sql); expect(target.prepare(inspect).all()).toEqual(disk(profile, db => db.prepare(inspect + ' LIMIT 2').all())); expect(target.prepare('SELECT count(*) AS n FROM audit').get()!.n).toBe(0); expect(target.prepare("SELECT seq FROM sqlite_sequence WHERE name='subject'").get()!.seq).toBe(9000); expect(definitions(target, 'subject')).toEqual(disk(profile, db => definitions(db, 'subject'))); target.exec("INSERT INTO subject(note) VALUES('明确后续')"); expect(target.prepare('SELECT max(id) AS id FROM subject').get()!.id).toBe(9001); expect(target.prepare('SELECT count(*) AS n FROM audit').get()!.n).toBe(1); } finally { target.close(); }
  });

  it('视图仅结构与INSTEAD OF trigger真实回放；data及structure-data仍拒视图并保旧目标', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile, 'subject_view'), input = request(profile, source); expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 0, fileCommitted: true }); expect(processes.at(-1)!.sent.some(message => message.kind === 'streamRead')).toBe(false);
    const target = new DatabaseSync(join(dirname(input.filePath), 'view-replay.sqlite'));
    try { target.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)'); target.exec(readFileSync(input.filePath, 'utf8')); expect(definitions(target, 'subject_view')).toEqual(disk(profile, db => definitions(db, 'subject_view'))); target.exec("INSERT INTO subject_view VALUES(5,'视图回写')"); expect(target.prepare('SELECT * FROM subject_view').all()).toEqual([{ id: 5, note: '视图回写' }]); } finally { target.close(); }
    for (const sqlContent of ['data', 'structure-data'] as const) { const denied = request(profile, source, { sqlContent, columns: ['id', 'note'] }); writeFileSync(denied.filePath, '原目标'); await expect(app.request('sqlite.tableExport', denied)).rejects.toThrow('视图'); expect(readFileSync(denied.filePath, 'utf8')).toBe('原目标'); }
  });

  it('WITHOUT ROWID+STRICT、复合主键和引用Unicode标识符的结构数据可真实回放', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE TABLE "中""文;--"(a TEXT,b INTEGER,note TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID, STRICT; INSERT INTO "中""文;--" VALUES(\'甲\',1,\'原一\'),(\'乙\',2,NULL)'));
    const { app } = runtime(profile), source = await page(app, profile, '中"文;--'), input = request(profile, source, { sqlContent: 'structure-data', columns: ['note', 'b', 'a'] }); expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 2, fileCommitted: true });
    const target = new DatabaseSync(join(dirname(input.filePath), 'without-replay.sqlite'));
    try { target.exec(readFileSync(input.filePath, 'utf8')); expect(target.prepare('SELECT * FROM "中""文;--" ORDER BY a').all()).toEqual(disk(profile, db => db.prepare('SELECT * FROM "中""文;--" ORDER BY a').all())); expect(definitions(target, '中"文;--')).toEqual(disk(profile, db => definitions(db, '中"文;--'))); } finally { target.close(); }
  });

  it.each(['--尾行注释', '--尾行注释\n', '/*尾块注释;?*/', ';'])('原CREATE末尾为%s时安全分隔，仅EOF行注释增加准确的一个必要换行', async tail => {
    const profile = fixture(); disk(profile, db => {
      db.exec('CREATE TABLE tail_table(a TEXT,b INTEGER,PRIMARY KEY(a,b)) WITHOUT ROWID, STRICT ' + tail);
      db.exec('CREATE INDEX tail_index ON tail_table(b) ' + tail);
      db.exec("CREATE TRIGGER tail_trigger AFTER INSERT ON tail_table BEGIN INSERT INTO audit(begin,note) VALUES(NEW.a,'尾;?'); END " + tail);
    });
    const { app } = runtime(profile), source = await page(app, profile, 'tail_table'), input = request(profile, source), originals = disk(profile, db => definitions(db, 'tail_table')) as { sql: string | null }[];
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 0, fileCommitted: true });
    const sql = readFileSync(input.filePath, 'utf8'); for (const row of originals) if (row.sql) expect(sql).toContain(row.sql);
    expect(disk(profile, db => definitions(db, 'tail_table'))).toEqual(originals);
    // 实证的唯一转换：只有该EOF例且原目录实际保留末行注释的对象才多一个换行，不trim或统一normalize。
    const expected = originals.map(row => tail === '--尾行注释' && row.sql?.endsWith('--尾行注释') ? { ...row, sql: row.sql + '\n' } : row);
    const target = new DatabaseSync(join(dirname(input.filePath), 'tail-replay.sqlite'));
    try { target.exec('CREATE TABLE audit(begin TEXT,note TEXT)'); target.exec(sql); expect(definitions(target, 'tail_table')).toEqual(expected); target.exec("INSERT INTO tail_table VALUES('唯一',1)"); expect(target.prepare('SELECT begin,note FROM audit').all()).toEqual([{ begin: '唯一', note: '尾;?' }]); } finally { target.close(); }
  });

  it('AUTOINCREMENT只识别真实关键字，字符串/引用名/注释不读取或伪造sqlite_sequence', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE TABLE ordinary("AUTOINCREMENT" TEXT DEFAULT \'AUTOINCREMENT\',note TEXT /* AUTOINCREMENT */)'));
    const { app } = runtime(profile), source = await page(app, profile, 'ordinary'), input = request(profile, source); expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 0, fileCommitted: true }); expect(processes.at(-1)!.sent.some(message => message.kind === 'execute' && message.sql.includes('FROM main.sqlite_sequence'))).toBe(false); expect(readFileSync(input.filePath, 'utf8')).not.toContain('"sqlite_sequence"');
    disk(profile, db => db.exec('CREATE TABLE empty_auto(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT)')); const empty = await page(app, profile, 'empty_auto'), noSequence = request(profile, empty); expect(await app.request('sqlite.tableExport', noSequence)).toEqual({ rows: 0, fileCommitted: true }); expect(readFileSync(noSequence.filePath, 'utf8')).not.toContain('INSERT INTO "main"."sqlite_sequence"');
  });

  it('结构+数据缺列/显式generated、虚拟/影子/系统表均拒绝并保持旧文件', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIRTUAL TABLE docs USING fts5(body)')); const { app } = runtime(profile), source = await page(app, profile);
    for (const columns of [['id'], ['id', 'parent_id', 'value', 'note', 'payload', 'generated']]) { const input = request(profile, source, { sqlContent: 'structure-data', columns }); writeFileSync(input.filePath, '原目标'); await expect(app.request('sqlite.tableExport', input)).rejects.toThrow(/全部非生成列|生成列/); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标'); }
    for (const table of ['docs', 'docs_data', 'sqlite_sequence']) { const target = await page(app, profile, table), input = request(profile, target); writeFileSync(input.filePath, '原目标'); await expect(app.request('sqlite.tableExport', input)).rejects.toThrow(/系统表|虚拟表|影子表/); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标'); }
  });

  it.each(['invalid-text', 'nul'] as const)('附属SQL定义%s不能静默修复/截断后发布，原目标保持', async mode => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile);
    disk(profile, db => { db.enableDefensive(false); db.exec('PRAGMA writable_schema=ON'); db.exec("UPDATE sqlite_schema SET sql=CAST(CAST(sql AS BLOB)||X'" + (mode === 'invalid-text' ? '202f2a802a2f' : '00202d2d4e554c') + "' AS TEXT) WHERE name='expression_partial'"); });
    const input = request(profile, source); writeFileSync(input.filePath, '原目标'); await expect(app.request('sqlite.tableExport', input)).rejects.toThrow(/编码|NUL/); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标'); expect(readdirSync(dirname(input.filePath)).filter(name => name.endsWith('.partial'))).toEqual([]);
  });

  it('真实附属CREATE总量超过2MiB明确拒绝，不能缩减对象或发布旧目标', async () => {
    const profile = fixture(); disk(profile, db => { for (let index = 0; index < 3; index++) db.exec('CREATE INDEX budget_' + index + ' ON subject(id) /*' + '界'.repeat(250000) + '*/'); expect(db.prepare("SELECT sum(length(CAST(sql AS BLOB))) AS bytes FROM sqlite_schema WHERE tbl_name='subject'").get()!.bytes).toBeGreaterThan(sqliteSchemaExportLimits.definitionBytes); });
    const { app } = runtime(profile), source = await page(app, profile), input = request(profile, source); writeFileSync(input.filePath, '原目标'); await expect(app.request('sqlite.tableExport', input)).rejects.toThrow('2MiB'); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标');
  });

  it('结构目录读取中准确取消会回滚/正常exit且无数据SQL，旧目标保持', async () => {
    const profile = fixture(), reached = deferred<void>(); let pause = false;
    const { app, events } = runtime(profile, () => transport((message, forward) => { if (pause && message.kind === 'statement' && message.sql.includes('ORDER BY type,name LIMIT')) { pause = false; reached.resolve(); } else forward(); }));
    const source = await page(app, profile), input = request(profile, source); writeFileSync(input.filePath, '原目标'); pause = true; const work = app.request('sqlite.tableExport', input); const failure = expect(work).rejects.toThrow('取消'); await reached.promise; await app.request('query.cancel', { taskId: input.taskId }); await failure;
    expect(events.at(-1)?.status).toBe('cancelled'); const original = processes.at(-1)!; expect(await original.exited).toEqual({ code: 0, signal: null }); expect(original.kills).toBe(0); expect(original.sent.some(message => message.kind === 'streamRead')).toBe(false); expect(original.sent.some(message => message.kind === 'execute' && message.sql === 'ROLLBACK')).toBe(true); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标');
  });

  it('旧data省略模式与显式data均保持INSERT-only且不恢复结构或序列', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile);
    for (const explicit of [false, true]) { const input = request(profile, source, { columns: ['id', 'note'], ...(explicit ? { sqlContent: 'data' as const } : {}) }); if (!explicit) delete input.sqlContent; expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 3, fileCommitted: true }); const sql = readFileSync(input.filePath, 'utf8'); expect(sql).not.toMatch(/CREATE|BEGIN|COMMIT|sqlite_sequence/); expect(sql.match(/INSERT INTO/g)).toHaveLength(3); }
  });
});
