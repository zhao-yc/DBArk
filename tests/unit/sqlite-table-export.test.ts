import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { parse } from 'csv-parse/sync';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteTablePage } from '../../src/shared/sqliteTableBrowse';
import type { SqliteTableExportInput, SqliteTableExportOutput } from '../../src/shared/sqliteTableExport';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { SqliteDriverError, SqliteDriverSession } from '../../src/engine/sqlite/session';
import { nativeAtomicFileIO, type AtomicFileIO } from '../../src/engine/atomicFile';
import { listExcelSheets, readExcelRows } from '../../src/engine/excelFiles';
import type { SqliteTableExportRequest } from '../../src/main/sqliteTableExport';
import { sqliteInsertLiteral } from '../../src/main/sqliteTableExport';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite导出单测必须注入真实Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], runtimes = new Set<SqliteRuntime>(), drivers = new Set<SqliteDriverSession>();
let bundleDirectory: string, worker: string, retained = false;
/** 只同步真实进程、磁盘IO或消息边界，不伪造SQL成功/文件提交回执。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-export-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 临时目录和准确进程全部归本例，失败保留原磁盘现场。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-export-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const app of runtimes) await app.forceClose(); runtimes.clear();
  for (const driver of drivers) { if (driver.isBusy) await driver.cancel(); await driver.close(); } drivers.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });

/** 独立磁盘库含真实五类存储、64位边界、NUL和生成列，输出文件只置于同一测试目录。 */
function fixture(): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-export-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,value,note TEXT,payload BLOB,number_text TEXT,generated INTEGER GENERATED ALWAYS AS (id*2) VIRTUAL); CREATE VIEW subject_view AS SELECT * FROM subject;');
    const insert = db.prepare('INSERT INTO subject(id,value,note,payload,number_text) VALUES(?,?,?,?,?)');
    for (const [id, value, note, payload] of [
      [1, 9223372036854775807n, '中文🚢', Buffer.from([0, 255])], [2, -9223372036854775808n, '单\'引号', null],
      [3, 1.25, '逗号,双"引号\n换行', Buffer.from([255, 0])], [4, '9223372036854775807', '\\N', Buffer.alloc(0)],
      [5, null, '', null], [6, Buffer.from([1, 2]), '普通文本', null], [7, 0, '空\0字符', null],
    ] as const) insert.run(id, value, note, payload, '9007199254740993');
    db.exec("INSERT INTO subject(id,value,note,number_text) VALUES(8,CAST(1 AS REAL),'整数形式REAL','9007199254740993'),(9,1e999,'无穷REAL','9007199254740993')");
  } finally { db.close(); }
  return { id: '导出源连接', name: '完整导出真实磁盘', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 编码必须在首张表创建前设置；BOM作为字段真实字符，数千NUL用于验证表达式深度。 */
function encodedFixture(encoding: 'UTF-8' | 'UTF-16le' | 'UTF-16be'): SqliteConnectionProfile {
  const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-export-')); directories.push(directory); const path = join(directory, 'encoded-source.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA encoding='" + encoding + "'; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)"); expect(Object.values(db.prepare('PRAGMA encoding').get()!)[0]).toBe(encoding);
    const insert = db.prepare('INSERT INTO subject VALUES(?,?)');
    for (const [index, note] of ['前\0后🚢', '\uFEFF真实BOM\0尾', '\0'.repeat(4096) + '末尾', '真实替代字符\uFFFD', '', '\uFEFF'].entries()) insert.run(index + 1, note);
  } finally { db.close(); }
  return { id: '源编码' + encoding, name: '源编码真实磁盘' + encoding, group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 100 } };
}
/** 外部原生连接核源数据，绝不从待验会话缓存证明未修改。 */
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
/** Hash和大文件验收都逐块读取，不把全量导出搬回RAM。 */
async function hash(path: string): Promise<string> { const digest = createHash('sha256'); for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer); return digest.digest('hex'); }
/** 真正Node utility替身宿主；可旁观/暂停准确消息，但原数据库结果不替换。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
/** 仅注入内核文件故障、准确transport及Main私有能力，不经渲染层传路径或IO。 */
function runtime(profile: SqliteConnectionProfile, options: { create?: () => SqliteProcessTransport; io?: AtomicFileIO; maxBytes?: number } = {}) {
  const events: TaskEvent[] = []; const app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport: options.create ?? transport, tableExport: { io: options.io, maxBytes: options.maxBytes }, emit: event => events.push(structuredClone(event)) }); runtimes.add(app); return { app, events };
}
/** 实际分页得到准确schemaKey；与导出共享真实目录指纹，不能手工猜哈希绕过元数据门。 */
function page(app: SqliteRuntime, profile: SqliteConnectionProfile, taskId = '源结构', table = 'subject'): Promise<SqliteTablePage> { return app.request('sqlite.tablePage', { connectionId: profile.id, database: 'main', table, taskId, offset: 0, limit: 1, filters: [], sort: [], mode: 'and' }); }
/** Main私有函数均为本例真实范围；默认目标只在本例目录，保留恢复承诺可单独旁观。 */
function request(profile: SqliteConnectionProfile, source: SqliteTablePage, patch: Partial<SqliteTableExportInput & { filePath: string }> = {}): SqliteTableExportRequest {
  const result: SqliteTableExportRequest = { connectionId: profile.id, database: 'main', table: source.target.table, taskId: '导出任务', fileToken: '仅本例Main授权令牌', schemaKey: source.schemaKey, columns: ['id', 'value', 'note', 'payload', 'number_text'], format: 'json', encoding: 'utf8', mode: 'and', filters: [], sort: [{ column: 'id', direction: 'asc' }], filePath: join(dirname(profile.sqlite.filePath!), 'output.json'), assertCurrent: () => {}, validateDestination: async () => {}, retainDestinationUntil: () => {}, ...patch };
  return result;
}
/** 普通完成的utility必须真实readonly、正常退出，且数据只发送一条无LIMIT流SELECT。 */
async function completed(record: ProcessRecord): Promise<void> {
  expect(await record.exited).toEqual({ code: 0, signal: null }); expect(record.kills).toBe(0); expect(record.sent.find(message => message.kind === 'open')).toMatchObject({ options: { readOnly: true } });
  const stream = record.sent.filter((message): message is Extract<SqliteWorkerRequest, { kind: 'streamRead' }> => message.kind === 'streamRead'); expect(stream).toHaveLength(1); expect(stream[0].sql).not.toMatch(/\b(?:LIMIT|OFFSET|COUNT)\b/i);
  expect(record.sent.filter(message => message.kind === 'execute').map(message => message.sql)).toContain('ROLLBACK');
}

describe('SQLite完整导出真实只读流、原子文件与精度回放', () => {
  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s沿typed筛选/排序/选择列顺序流式输出，源库字节不变，DB正常exit先于prepare/commit', async format => {
    const profile = fixture(), { app, events } = runtime(profile), source = await page(app, profile), before = await hash(profile.sqlite.filePath!);
    const columns = format === 'xlsx' ? ['number_text', 'payload', 'id'] : ['note', 'id', 'value', 'payload', 'number_text'];
    const input = request(profile, source, { format, columns, filePath: join(dirname(profile.sqlite.filePath!), 'output.' + format), filters: [{ column: 'id', operator: 'lte', value: { kind: 'integer', value: format === 'xlsx' ? '6' : '9' } }], sort: [{ column: 'id', direction: 'desc' }] });
    let validations = 0;
    input.validateDestination = async () => { if (++validations > 1) expect(processes.at(-1)!.child.exitCode).toBe(0); };
    const output: SqliteTableExportOutput = await app.request('sqlite.tableExport', input); expect(output).toEqual({ rows: format === 'xlsx' ? 6 : 9, fileCommitted: true }); expect(validations).toBe(3);
    await completed(processes.at(-1)!); expect(await hash(profile.sqlite.filePath!)).toBe(before); expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toEqual([]);
    if (format === 'json') {
      const rows = JSON.parse(readFileSync(input.filePath, 'utf8')); expect(Object.keys(rows[0])).toEqual(columns); expect(rows[0]).toMatchObject({ id: '9', value: 'Infinity', number_text: '9007199254740993' });
      expect(rows.find((row: any) => row.id === '1').value).toBe('9223372036854775807'); expect(rows.find((row: any) => row.id === '2').value).toBe('-9223372036854775808'); expect(rows.find((row: any) => row.id === '7').note).toBe('空\0字符'); expect(rows.find((row: any) => row.id === '1').payload).toEqual({ type: 'binary', base64: 'AP8=' });
    } else if (format === 'csv') {
      const rows = parse(readFileSync(input.filePath, 'utf8')) as string[][]; expect(rows[0]).toEqual(columns); expect(rows).toHaveLength(10); expect(rows.find(row => row[1] === '1')![3]).toBe('base64:AP8='); expect(rows.find(row => row[1] === '5')![2]).toBe('\\N'); expect(rows.find(row => row[1] === '4')![0]).toBe('\\\\N'); expect(rows.find(row => row[1] === '7')![0]).toBe('空\0字符');
    } else if (format === 'sql') {
      const sql = readFileSync(input.filePath, 'utf8'); expect(sql).not.toMatch(/\bCREATE\b/i); expect(sql).toContain('char(0)'); expect(sql).toContain('9e999');
      const replay = new DatabaseSync(join(dirname(input.filePath), 'replay.sqlite'));
      try {
        replay.exec(disk(profile, db => db.prepare("SELECT sql FROM sqlite_schema WHERE name='subject'").get()!.sql as string)); replay.exec(sql);
        const inspect = "SELECT id,typeof(value) AS storage,CASE WHEN typeof(value)='blob' THEN hex(value) ELSE quote(value) END AS value,hex(CAST(note AS BLOB)) AS note,hex(payload) AS payload,number_text FROM subject ORDER BY id";
        expect(replay.prepare(inspect).all()).toEqual(disk(profile, db => db.prepare(inspect).all()));
      } finally { replay.close(); }
    } else {
      const sheets = await listExcelSheets({ filePath: input.filePath }); const rows = [];
      for await (const row of readExcelRows({ filePath: input.filePath, sheetId: sheets[0].id, protocol: 'dbark-v1' })) rows.push(row);
      expect(rows).toHaveLength(6); expect(Object.keys(rows[0])).toEqual(columns); expect(rows[0].id).toBe('6'); expect(rows.at(-1)!.payload).toEqual({ type: 'binary', base64: 'AP8=' }); expect(rows[0].number_text).toBe('9007199254740993');
    }
    expect(events.at(-1)).toMatchObject({ taskId: input.taskId, status: 'completed', rows: output.rows }); expect((app as any).tasks.get(input.taskId)).toEqual({ kind: 'export-finished' });
  });

  it('真实输出超过32MiB而不中途截断，普通execute仍保留32MiB原门槛，不分页循环不全表缓存', async () => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE big(id INTEGER PRIMARY KEY,body TEXT); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<52) INSERT INTO big SELECT x,printf('%0700000d',x) FROM n"));
    const driver = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly: true, busyTimeoutMs: 100 }); drivers.add(driver);
    const bounded = await driver.execute('SELECT body FROM big', { maxRows: 1000000, maxBytes: 32 * 1024 * 1024, onBatch: () => {} }); expect(bounded.statements[0].truncated).toBe(true); expect(bounded.statements[0].rows).toBeLessThan(52); await driver.close();
    const { app } = runtime(profile), source = await page(app, profile, '大表源', 'big'), input = request(profile, source, { table: 'big', columns: ['id', 'body'], format: 'csv', filePath: join(dirname(profile.sqlite.filePath!), 'big.csv') });
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 52, fileCommitted: true }); expect(statSync(input.filePath).size).toBeGreaterThan(32 * 1024 * 1024);
    let lines = 0; for await (const chunk of createReadStream(input.filePath)) for (const byte of chunk as Buffer) if (byte === 10) lines++; expect(lines).toBe(53); await completed(processes.at(-1)!);
  });

  it('真实stream计数跨过100万行，只持每批1000行，普通查询行预算仍有效', async () => {
    const profile = fixture(); disk(profile, db => db.exec('CREATE VIEW million AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000001) SELECT x FROM n'));
    const driver = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly: true, busyTimeoutMs: 100 }); drivers.add(driver);
    let count = 0, first: SqliteValue | undefined, last: SqliteValue | undefined, maximum = 0;
    const result = await driver.streamRead('SELECT x FROM million', { batchRows: 1000, onBatch: batch => { maximum = Math.max(maximum, batch.rows.length); first ??= batch.rows[0]?.[0]; last = batch.rows.at(-1)?.[0]; count += batch.rows.length; } });
    expect(count).toBe(1000001); expect(maximum).toBeLessThanOrEqual(1000); expect(first).toEqual({ type: 'integer', value: '1' }); expect(last).toEqual({ type: 'integer', value: '1000001' }); expect(result.statements[0]).toMatchObject({ rows: 1000001, truncated: false });
    // 上方已完整验证真实1000001行流；普通预算只需实际3行证明保留2行并标截断，不重复drain整百万行。
    expect((await driver.execute('SELECT x FROM million LIMIT 3', { maxRows: 2 })).statements[0]).toMatchObject({ rows: 2, truncated: true }); await driver.close();
  });

  it('stream拒读写会话与非单条SELECT；schema变化、SQL视图/生成列在partial创建前拒绝', async () => {
    const profile = fixture(), writable = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly: false, busyTimeoutMs: 100 }); drivers.add(writable);
    const before = processes[0].sent.length; await expect(writable.streamRead('SELECT 1', { onBatch: () => {} })).rejects.toMatchObject({ code: 'SQLITE_STREAM_REQUIRES_READONLY' }); expect(processes[0].sent).toHaveLength(before); await writable.close();
    const readonly = await SqliteDriverSession.open(transport, { path: profile.sqlite.filePath!, readOnly: true, busyTimeoutMs: 100 }); drivers.add(readonly);
    for (const sql of ['BEGIN', "INSERT INTO subject(id) VALUES(100)", 'SELECT 1; SELECT 2']) await expect(readonly.streamRead(sql, { onBatch: () => {} })).rejects.toBeInstanceOf(SqliteDriverError); expect(readonly.isUsable).toBe(true); await readonly.close();
    const { app } = runtime(profile), source = await page(app, profile); expect(source.columns.find(column => column.name === 'generated')?.generated).toBe(true); expect(source.schemaKey).toMatch(/^[a-f0-9]{64}$/);
    const gen = request(profile, source, { taskId: '拒生成列', format: 'sql', columns: ['generated'] }); await expect(app.request('sqlite.tableExport', gen)).rejects.toThrow('生成列');
    const view = await page(app, profile, '视图目录', 'subject_view'); await expect(app.request('sqlite.tableExport', request(profile, view, { taskId: '拒视图', format: 'sql' }))).rejects.toThrow('视图');
    disk(profile, db => db.exec('ALTER TABLE subject ADD COLUMN later TEXT')); await expect(app.request('sqlite.tableExport', request(profile, source, { taskId: '拒旧schema' }))).rejects.toThrow('结构已变化'); expect(readdirSync(dirname(profile.sqlite.filePath!)).filter(path => path.endsWith('.partial'))).toEqual([]);
    expect(sqliteInsertLiteral({ type: 'real', value: '-0' })).toBe('-0.0'); expect(sqliteInsertLiteral({ type: 'real', value: '1' })).toBe('1.0');
  });

  it('原子短写逐段消费，零写入或私有文件预算不足不替换原目标且源库不变', async () => {
    const profile = fixture(); const short: AtomicFileIO = { ...nativeAtomicFileIO, open: async path => { const file = await nativeAtomicFileIO.open(path); return { ...file, write: (buffer, offset, length) => file.write(buffer, offset, Math.min(17, length)) }; } };
    const { app } = runtime(profile, { io: short }), source = await page(app, profile), input = request(profile, source); expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 9, fileCommitted: true }); expect(JSON.parse(readFileSync(input.filePath, 'utf8'))).toHaveLength(9);
    const zero: AtomicFileIO = { ...nativeAtomicFileIO, open: async path => { const file = await nativeAtomicFileIO.open(path); return { ...file, write: async () => ({ bytesWritten: 0 }) }; } };
    const bad = runtime(profile, { io: zero }), badSource = await page(bad.app, profile), badInput = request(profile, badSource, { taskId: '零写入' }); writeFileSync(badInput.filePath, '原目标'); const sourceHash = await hash(profile.sqlite.filePath!);
    await expect(bad.app.request('sqlite.tableExport', badInput)).rejects.toThrow(); expect(readFileSync(badInput.filePath, 'utf8')).toBe('原目标');
    const small = runtime(profile, { maxBytes: 100 }), smallSource = await page(small.app, profile), smallInput = request(profile, smallSource, { taskId: '文件预算' }); await expect(small.app.request('sqlite.tableExport', smallInput)).rejects.toThrow(); expect(readFileSync(smallInput.filePath, 'utf8')).toBe('原目标'); expect(await hash(profile.sqlite.filePath!)).toBe(sourceHash);
  });

  it.each(['json', 'xlsx'] as const)('%s取消原stream只撤销本任务暂存，先cancelled再拒绝；旧task不影响后继导出', async format => {
    const profile = fixture(), reached = deferred<void>(); let paused = false;
    const { app, events } = runtime(profile, { create: () => transport((message, forward, record) => {
      const last = record.sent.filter(message => message.kind === 'execute' || message.kind === 'streamRead').at(-1);
      if (!paused && message.kind === 'batch' && last?.kind === 'streamRead') { paused = true; reached.resolve(); } else forward();
    }) });
    const source = await page(app, profile), input = request(profile, source, { format }); writeFileSync(input.filePath, '原目标');
    const exporting = app.request('sqlite.tableExport', input).catch(reason => { expect(events.at(-1)?.status).toBe('cancelled'); return reason; }); await reached.promise;
    await app.request('query.cancel', { taskId: input.taskId }); expect(await exporting).toBeInstanceOf(Error); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标'); expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toEqual([]);
    const next = request(profile, source, { taskId: '后继导出' }); await app.request('sqlite.tableExport', next); const count = processes.at(-1)!.sent.length; await app.request('query.cancel', { taskId: input.taskId }); expect(processes.at(-1)!.sent).toHaveLength(count); expect((app as any).tasks.get(input.taskId)).toEqual({ kind: 'export-finished' });
  });

  it('DB关闭未知时绝不prepare/commit；准确close重试确认退出后才解除封锁', async () => {
    const profile = fixture(), closeReached = deferred<void>(); let dropClose = false;
    const { app, events } = runtime(profile, { create: () => { const original = transport(); return { ...original, send: message => { if (dropClose && message.kind === 'close') { vi.useFakeTimers(); closeReached.resolve(); return; } original.send(message); } }; } });
    const source = await page(app, profile), input = request(profile, source); writeFileSync(input.filePath, '原目标'); let checks = 0; input.validateDestination = async () => { checks++; };
    dropClose = true;
    try {
      const exporting = app.request('sqlite.tableExport', input).catch(reason => reason);
      // 直到准确close真的发送时才切换计时器；原生打开、SQL和文件IO均先真实完成。
      await closeReached.promise;
      await vi.advanceTimersByTimeAsync(5001); expect(await exporting).toBeInstanceOf(Error);
      expect(checks).toBe(1); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标'); expect(events.at(-1)?.status).toBe('failed'); await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
    } finally { dropClose = false; vi.useRealTimers(); }
    await app.request('connections.close', { id: profile.id }); await processes.at(-1)!.exited; expect(app.ownsConnection(profile.id)).toBe(false);
  });

  it('文件cleanup失败保留准确handle/删除能力和Main目标预留，显式close恢复后才发recovered', async () => {
    const profile = fixture(); let failClose = true, retainedPromise: Promise<void> | undefined, recovered = false;
    const io: AtomicFileIO = { ...nativeAtomicFileIO, open: async path => { const file = await nativeAtomicFileIO.open(path); return { ...file, close: async () => { if (failClose) throw Error('本例原文件关闭未确认'); await file.close(); } }; } };
    const { app, events } = runtime(profile, { io }), source = await page(app, profile), input = request(profile, source); writeFileSync(input.filePath, '原目标'); input.retainDestinationUntil = promise => { retainedPromise = promise; void promise.then(() => { recovered = true; }); };
    await expect(app.request('sqlite.tableExport', input)).rejects.toThrow(); expect(retainedPromise).toBeDefined(); expect(recovered).toBe(false); expect(events.at(-1)?.status).toBe('failed'); expect(readFileSync(input.filePath, 'utf8')).toBe('原目标');
    expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toHaveLength(1); await expect(app.request('sessions.open', { connectionId: profile.id })).rejects.toThrow('资源尚未确认');
    failClose = false; await app.request('connections.close', { id: profile.id }); await retainedPromise; expect(recovered).toBe(true); expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toEqual([]); expect(app.ownsConnection(profile.id)).toBe(false); expect((app as any).tasks.get(input.taskId)).toEqual({ kind: 'export-finished' });
  });

  it('rename开始后晚取消或owner撤权不改写fileCommitted，目标复核在DB正常exit后再次执行', async () => {
    const profile = fixture(), renaming = deferred<void>(), allowRename = deferred<void>(); let owner = true;
    const io: AtomicFileIO = { ...nativeAtomicFileIO, rename: async (source, target) => { renaming.resolve(); await allowRename.promise; await nativeAtomicFileIO.rename(source, target); } };
    const { app, events } = runtime(profile, { io }), source = await page(app, profile), input = request(profile, source); input.assertCurrent = () => { if (!owner) throw Error('本例owner已撤销'); };
    const exporting = app.request('sqlite.tableExport', input); await renaming.promise; expect(processes.at(-1)!.child.exitCode).toBe(0); owner = false;
    let stopped = false; const cancelled = app.request('query.cancel', { taskId: input.taskId }).then(() => { stopped = true; }); await delay(10); expect(stopped).toBe(false); allowRename.resolve();
    expect(await exporting).toEqual({ rows: 9, fileCommitted: true }); await cancelled; expect(events.at(-1)).toMatchObject({ status: 'completed', rows: 9 }); expect(JSON.parse(readFileSync(input.filePath, 'utf8'))).toHaveLength(9);
  });

  it('含NUL的SQLite INSERT在真实UTF-16le目标库回放仍保持完整Unicode文本', async () => {
    const profile = fixture(), { app } = runtime(profile), source = await page(app, profile);
    const input = request(profile, source, { taskId: '跨目标编码NUL', format: 'sql', columns: ['id', 'note'], filters: [{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '7' } }], filePath: join(dirname(profile.sqlite.filePath!), 'nul-utf16-replay.sql') });
    const original = disk(profile, db => db.prepare('SELECT note,typeof(note) AS storage FROM subject WHERE id=7').get()!); expect(original).toMatchObject({ note: '空\0字符', storage: 'text' });
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 1, fileCommitted: true });
    const replay = new DatabaseSync(join(dirname(input.filePath), 'nul-utf16-target.sqlite'));
    try {
      const schema = disk(profile, db => db.prepare("SELECT sql FROM sqlite_schema WHERE name='subject'").get()!.sql as string);
      replay.exec("PRAGMA encoding='UTF-16le';" + schema);
      expect(Object.values(replay.prepare('PRAGMA encoding').get()!)[0]).toBe('UTF-16le'); replay.exec(readFileSync(input.filePath, 'utf8'));
      expect(replay.prepare('SELECT note,typeof(note) AS storage FROM subject WHERE id=7').get()).toEqual(original);
    } finally { replay.close(); }
  });

  it('无效UTF8源TEXT必须明确拒绝或按原字节回放，成功导出不可静默替换成U+FFFD', async () => {
    const profile = fixture(); disk(profile, db => db.exec("INSERT INTO subject(id,value,note,number_text) VALUES(10,10,CAST(X'80' AS TEXT),'仅本例非法UTF8原件')"));
    const original = disk(profile, db => db.prepare('SELECT typeof(note) AS storage,hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=10').get()!); expect(original).toMatchObject({ storage: 'text', bytes: '80' });
    const { app } = runtime(profile), source = await page(app, profile), input = request(profile, source, { taskId: '无效UTF8保真门', format: 'sql', columns: ['id', 'note'], filters: [{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '10' } }], filePath: join(dirname(profile.sqlite.filePath!), 'invalid-text.sql') });
    writeFileSync(input.filePath, '原目标不得以修复字符替换');
    let result: SqliteTableExportOutput | undefined, failure: unknown;
    try { result = await app.request('sqlite.tableExport', input); } catch (reason) { failure = reason; }
    if (failure) {
      expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).toMatch(/无效|无损|文本|UTF-?8/i);
      expect(readFileSync(input.filePath, 'utf8')).toBe('原目标不得以修复字符替换'); expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toEqual([]);
    } else {
      expect(result).toEqual({ rows: 1, fileCommitted: true });
      const replay = new DatabaseSync(join(dirname(input.filePath), 'invalid-text-replay.sqlite'));
      try {
        replay.exec(disk(profile, db => db.prepare("SELECT sql FROM sqlite_schema WHERE name='subject'").get()!.sql as string));
        expect(Object.values(replay.prepare('PRAGMA encoding').get()!)[0]).toBe('UTF-8'); replay.exec(readFileSync(input.filePath, 'utf8'));
        expect(replay.prepare('SELECT typeof(note) AS storage,hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=10').get()).toEqual(original);
      } finally { replay.close(); }
    }
    expect(disk(profile, db => db.prepare('SELECT typeof(note) AS storage,hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=10').get())).toEqual(original);
  });

  it.each(['UTF-8', 'UTF-16le', 'UTF-16be'] as const)('%s真实源TEXT含BOM/4096个NUL导出SQL到UTF8库仍完整，真实U+FFFD不误拒', async encoding => {
    const profile = encodedFixture(encoding), original = disk(profile, db => db.prepare('SELECT id,note FROM subject ORDER BY id').all()), { app } = runtime(profile), source = await page(app, profile);
    const input = request(profile, source, { taskId: '跨编码平衡NUL', format: 'sql', columns: ['id', 'note'], filePath: join(dirname(profile.sqlite.filePath!), 'balanced-text.sql') });
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 6, fileCommitted: true });
    const replay = new DatabaseSync(join(dirname(input.filePath), 'utf8-balanced-replay.sqlite'));
    try {
      replay.exec('CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT)'); expect(Object.values(replay.prepare('PRAGMA encoding').get()!)[0]).toBe('UTF-8'); replay.exec(readFileSync(input.filePath, 'utf8'));
      expect(replay.prepare('SELECT id,note FROM subject ORDER BY id').all()).toEqual(original);
      expect(replay.prepare('SELECT note FROM subject WHERE id=3').get()!.note).toBe('\0'.repeat(4096) + '末尾');
      expect(replay.prepare('SELECT note FROM subject WHERE id=2').get()!.note).toBe('\uFEFF真实BOM\0尾');
      expect(replay.prepare('SELECT note FROM subject WHERE id=6').get()!.note).toBe('\uFEFF');
    } finally { replay.close(); }
  });

  it.each(['csv', 'json'] as const)('%s真实视图可用directOnly外层校验，原NOCASE列筛选与同名投影alias排序保持', async format => {
    const profile = fixture(); disk(profile, db => db.exec("CREATE TABLE collated(id INTEGER PRIMARY KEY,label TEXT COLLATE NOCASE); INSERT INTO collated VALUES(1,'a'),(2,'B'),(3,'b'),(4,'A'),(5,'c'); CREATE VIEW collated_view AS SELECT id,label FROM collated"));
    const { app } = runtime(profile), source = await page(app, profile, '真实collation视图', 'collated_view');
    const input = request(profile, source, { taskId: '视图原collation排序', table: 'collated_view', format, columns: ['label', 'id'], filters: [{ column: 'label', operator: 'gte', value: { kind: 'text', value: 'a' } }], sort: [{ column: 'label', direction: 'asc' }, { column: 'id', direction: 'asc' }], filePath: join(dirname(profile.sqlite.filePath!), 'collated.' + format) });
    expect(await app.request('sqlite.tableExport', input)).toEqual({ rows: 5, fileCommitted: true });
    const read = () => format === 'json' ? (JSON.parse(readFileSync(input.filePath, 'utf8')) as { label: string; id: string }[]).map(row => [row.label, row.id]) : (parse(readFileSync(input.filePath, 'utf8')) as string[][]).slice(1);
    expect(read()).toEqual([['a', '1'], ['A', '4'], ['B', '2'], ['b', '3'], ['c', '5']]);
    const stream = processes.at(-1)!.sent.find((message): message is Extract<SqliteWorkerRequest, { kind: 'streamRead' }> => message.kind === 'streamRead');
    expect(stream!.sql).toContain('ORDER BY "__dbark_source"."label" ASC, "__dbark_source"."id" ASC');
    const filtered = { ...input, taskId: '视图NOCASE匹配', filters: [{ column: 'label', operator: 'eq' as const, value: { kind: 'text' as const, value: 'A' } }] };
    expect(await app.request('sqlite.tableExport', filtered)).toEqual({ rows: 2, fileCommitted: true }); expect(read()).toEqual([['a', '1'], ['A', '4']]);
  });

  it.each(['csv', 'json', 'sql', 'xlsx'] as const)('%s遇真实UTF8/UTF16LE/BE非法TEXT均明确拒绝，旧目标保持且无partial残留', async format => {
    for (const encoding of ['UTF-8', 'UTF-16le', 'UTF-16be'] as const) {
      const profile = encodedFixture(encoding), bytes = encoding === 'UTF-8' ? '80' : encoding === 'UTF-16le' ? '00D8' : 'D800';
      disk(profile, db => db.exec("INSERT INTO subject VALUES(99,CAST(X'" + bytes + "' AS TEXT))"));
      const raw = disk(profile, db => db.prepare('SELECT typeof(note) AS storage,hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=99').get()!); expect(raw).toMatchObject({ storage: 'text', bytes });
      const { app, events } = runtime(profile), source = await page(app, profile), input = request(profile, source, { taskId: '非法TEXT原件' + encoding, format, columns: ['id', 'note'], filters: [{ column: 'id', operator: 'eq', value: { kind: 'integer', value: '99' } }], filePath: join(dirname(profile.sqlite.filePath!), 'invalid.' + format) });
      writeFileSync(input.filePath, '原目标不可损失');
      await expect(app.request('sqlite.tableExport', input)).rejects.toMatchObject({ code: 'SQLITE_TEXT_ENCODING_UNREPRESENTABLE' });
      expect(readFileSync(input.filePath, 'utf8')).toBe('原目标不可损失'); expect(readdirSync(dirname(input.filePath)).filter(path => path.endsWith('.partial'))).toEqual([]); expect(events.at(-1)?.status).toBe('failed');
      expect(disk(profile, db => db.prepare('SELECT typeof(note) AS storage,hex(CAST(note AS BLOB)) AS bytes FROM subject WHERE id=99').get())).toEqual(raw);
    }
  });
});
