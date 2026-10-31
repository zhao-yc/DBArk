import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { linkSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import type { SqliteConnectionProfile, TaskEvent } from '../../src/shared/contracts';
import type { SqliteProcessExit, SqliteProcessTransport, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';
import { assertSqliteImportWriteFactTransition, sqliteImportWriteFactSchema, sqliteTableImportInspectionSchema, sqliteTableImportOutcomeSchema, sqliteTableImportPreviewOutputSchema, type SqliteImportWriteFact, type SqliteTableImportInspectOutput, type SqliteTableImportMapping, type SqliteTableImportOutcome, type SqliteTableImportPreviewOutput } from '../../src/shared/sqliteTableImport';

vi.mock('electron', () => ({ utilityProcess: { fork: () => { throw Error('SQLite导入测试只能使用本例准确Node子进程'); } } }));
import { SqliteRuntime } from '../../src/main/sqliteRuntime';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; kills: number; exited: Promise<SqliteProcessExit>; }
type Preview = Extract<SqliteTableImportPreviewOutput, { ok: true }>;
const directories: string[] = [], processes: ProcessRecord[] = [], applications = new Set<SqliteRuntime>();
let worker: string, bundleDirectory: string, retained = false, serial = 0;
/** 只暂停/丢弃真实原回执，不构造成功、取消或提交事实。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-import-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 失败保留原磁盘；仅准确进程退出后清理本例独占临时目录。 */
function remove(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-table-import-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => { const failed = context.task.result?.state === 'fail'; retained ||= failed; vi.useRealTimers(); for (const app of applications) await app.forceClose(); applications.clear(); for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; } for (const directory of directories.splice(0)) if (!failed) remove(directory); });
afterAll(() => { if (!retained) remove(bundleDirectory); });
function fixture(sql = 'CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB)'): SqliteConnectionProfile { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-table-import-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path); try { db.exec(sql); } finally { db.close(); } return { id: '导入真实连接', name: '本例合成库', group: '', color: '#123456', dialect: 'sqlite', sqlite: { filePath: path, readOnly: false, busyTimeoutMs: 0 } }; }
function disk<T>(profile: SqliteConnectionProfile, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(profile.sqlite.filePath!); try { return action(db); } finally { db.close(); } }
function rows(profile: SqliteConnectionProfile) { return disk(profile, db => db.prepare('SELECT CAST(id AS TEXT) AS id,typeof(value) AS type,CAST(value AS TEXT) AS value FROM target ORDER BY id').all()); }
function file(profile: SqliteConnectionProfile, content: string, format: 'csv' | 'json' = 'json'): string { const path = join(dirname(profile.sqlite.filePath!), '导入中文🚢' + ++serial + '.' + format); writeFileSync(path, content); return path; }
/** 固定worker、原消息透传；所有进程资源都保留到准确exit。 */
function transport(observe?: (message: SqliteWorkerResponse, forward: () => void, record: ProcessRecord) => void, intercept?: (message: SqliteWorkerRequest) => boolean): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: message => { record.sent.push(message); if (!intercept?.(message)) child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => observe ? observe(message, () => listener(message), record) : listener(message); child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
function runtime(profile: SqliteConnectionProfile, createTransport: () => SqliteProcessTransport = transport) { const events: TaskEvent[] = [], app = new SqliteRuntime({ resolveProfile: id => id === profile.id ? profile : undefined, createTransport, emit: event => events.push(structuredClone(event)) }); applications.add(app); return { app, events }; }
async function inspect(app: SqliteRuntime, profile: SqliteConnectionProfile, path: string, table = 'target', format: 'csv' | 'json' = 'json', assertCurrent = () => {}): Promise<SqliteTableImportInspectOutput> { return sqliteTableImportInspectionSchema.parse(await app.request('sqlite.tableImport.inspect', { connectionId: profile.id, database: 'main', table, fileToken: '本例文件令牌', filePath: path, format, encoding: 'utf8', ...(format === 'csv' ? { csvDelimiter: ',', csvHasHeader: true } : {}), taskId: '导入检查' + ++serial, assertCurrent })); }
async function preview(app: SqliteRuntime, value: SqliteTableImportInspectOutput, mapping: SqliteTableImportMapping[] = [{ source: 'value', target: 'value', kind: 'text' }]): Promise<SqliteTableImportPreviewOutput> { return sqliteTableImportPreviewOutputSchema.parse(await app.request('sqlite.tableImport.preview', { inspectionId: value.inspectionId, mapping, taskId: '导入预检' + ++serial, assertCurrent: () => {} })); }
async function plan(app: SqliteRuntime, value: SqliteTableImportInspectOutput, mapping?: SqliteTableImportMapping[]): Promise<Preview> { const checked = await preview(app, value, mapping); expect(checked.ok).toBe(true); if (!checked.ok) throw Error('真实预检未签发提交能力'); return checked; }
function apply(app: SqliteRuntime, value: Preview, record?: (fact: SqliteImportWriteFact) => void) { const facts: SqliteImportWriteFact[] = [], input = { previewId: value.previewId, taskId: '导入提交' + ++serial, confirmation: value.confirmation, operationId: randomUUID(), assertCurrent: () => {}, recordWriteFact: (fact: SqliteImportWriteFact) => { sqliteImportWriteFactSchema.parse(fact); if (facts.length) assertSqliteImportWriteFactTransition(facts.at(-1)!, fact); record?.(fact); facts.push(structuredClone(fact)); } }; return { input, facts, result: (app.request('sqlite.tableImport.apply', input) as Promise<SqliteTableImportOutcome>).then(value => sqliteTableImportOutcomeSchema.parse(value)) }; }

describe('SQLite现有表整文件导入真实磁盘与准确进程生命周期', () => {
  it('导入真实来源强制严格编码，非法UTF8在签能力前拒绝，合法替换字符及NUL不被误拒', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value TEXT)'), { app } = runtime(profile), invalid = file(profile, '', 'csv');
    writeFileSync(invalid, Buffer.concat([Buffer.from('value\n先前有效\n'), Buffer.from([0xc3, 0x28]), Buffer.from('\n')]));
    await expect(inspect(app, profile, invalid, 'target', 'csv')).rejects.toThrow('编码'); expect(rows(profile)).toEqual([]);
    const legitimate = file(profile, 'value\n合法�\0🚢\n', 'csv'), inspected = await inspect(app, profile, legitimate, 'target', 'csv'); expect(inspected.sample).toEqual([{ value: '合法�\0🚢' }]);
    expect((await apply(app, await plan(app, inspected)).result).outcome).toBe('committed'); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '合法�\0🚢' }]);
  });
  it('JSON精确数值、NUL、BLOB、NULL、空串、嵌套JSON、默认和生成列，预检零DML后一次提交', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB,note TEXT,payload BLOB,defaulted TEXT NOT NULL DEFAULT \'原默认\',generated INTEGER GENERATED ALWAYS AS(id*2))'), { app, events } = runtime(profile);
    const path = file(profile, '[{"value":9223372036854775807,"note":"中文\\u0000🚢","payload":"00ff"},{"value":null,"note":"","payload":""}]'), inspected = await inspect(app, profile, path);
    expect(inspected.columns.find(column => column.name === 'id')).toMatchObject({ autoGenerated: true }); expect(inspected.columns.find(column => column.name === 'generated')).toMatchObject({ generated: true }); expect(inspected.sample[0].value).toBe('9223372036854775807'); expect(await processes[0].exited).toEqual({ code: 0, signal: null });
    const checked = await plan(app, inspected, [{ source: 'value', target: 'value', kind: 'integer' }, { source: 'note', target: 'note', kind: 'text' }, { source: 'payload', target: 'payload', kind: 'blob-hex' }]); expect(rows(profile)).toEqual([]); expect(processes).toHaveLength(3); expect(processes.every(record => !record.sent.some(message => message.kind === 'execute' && /INSERT|CREATE/.test(message.sql)))).toBe(true);
    const operation = apply(app, checked); expect(await operation.result).toMatchObject({ outcome: 'committed', fact: { requestedRows: 2, appliedRows: 2, commitAcknowledged: true }, counts: { insert: 2, update: 0, delete: 0 } });
    expect(disk(profile, db => db.prepare('SELECT CAST(value AS TEXT) AS value,typeof(value) AS type,note,hex(payload) AS payload,defaulted,generated FROM target ORDER BY id').all())).toEqual([{ value: '9223372036854775807', type: 'integer', note: '中文\0🚢', payload: '00FF', defaulted: '原默认', generated: 2 }, { value: null, type: 'null', note: '', payload: '', defaulted: '原默认', generated: 4 }]); expect(await processes[3].exited).toEqual({ code: 0, signal: null }); expect(processes[3].kills).toBe(0);
    expect(processes[3].sent.filter(message => message.kind === 'execute' && message.sql === 'COMMIT')).toHaveLength(1); expect(events.filter(event => event.taskId === operation.input.taskId).at(-1)?.status).toBe('completed'); expect(events.every(event => !event.executionSql && !event.message.includes(path) && !event.message.includes('9223372036854775807'))).toBe(true);
    const nested = await plan(app, await inspect(app, profile, file(profile, '[{"value":{"n":9007199254740993,"array":[null,true]}}]'))); expect((await apply(app, nested).result).outcome).toBe('committed'); expect(rows(profile).at(-1)).toMatchObject({ type: 'text', value: '{"n":9007199254740993,"array":[null,true]}' });
  });

  it('CSV沿原NULL/转义NULL/空串和base64协议，并以真实513行跨越旧编辑500行事实门', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB,payload BLOB)'), { app } = runtime(profile), path = file(profile, 'value,payload\n\\N,base64:AP8=\n\\\\N,base64:\n,base64:YQ==\n', 'csv');
    const checked = await plan(app, await inspect(app, profile, path, 'target', 'csv'), [{ source: 'value', target: 'value', kind: 'text' }, { source: 'payload', target: 'payload', kind: 'blob-base64' }]); expect((await apply(app, checked).result).outcome).toBe('committed'); expect(rows(profile)).toEqual([{ id: '1', type: 'null', value: null }, { id: '2', type: 'text', value: '\\N' }, { id: '3', type: 'text', value: '' }]); expect(disk(profile, db => db.prepare('SELECT hex(payload) AS value FROM target ORDER BY id').all())).toEqual([{ value: '00FF' }, { value: '' }, { value: '61' }]);
    const many = await plan(app, await inspect(app, profile, file(profile, JSON.stringify(Array.from({ length: 513 }, (_, value) => ({ value: String(value) }))))), [{ source: 'value', target: 'value', kind: 'integer' }]); const operation = apply(app, many); expect(await operation.result).toMatchObject({ outcome: 'committed', fact: { requestedRows: 513, appliedRows: 513 } }); expect(operation.facts.filter(fact => fact.phase === 'writing').map(fact => fact.appliedRows)).toEqual([0, 128, 256, 384, 512, 513]); expect(rows(profile)).toHaveLength(516);
  });

  it('STRICT ANY保留数字原文TEXT、signed64 INTEGER及NULL，普通ANY仍是NUMERIC而拒不安全TEXT映射', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value ANY) STRICT; CREATE TABLE ordinary(value ANY)'), { app } = runtime(profile), inspected = await inspect(app, profile, file(profile, '[{"value":"9007199254740993"},{"value":null}]'));
    expect(inspected).toMatchObject({ strict: true, columns: expect.arrayContaining([expect.objectContaining({ name: 'value', affinity: 'blob' })]) }); expect((await apply(app, await plan(app, inspected)).result).outcome).toBe('committed');
    expect((await apply(app, await plan(app, await inspect(app, profile, file(profile, '[{"value":-9223372036854775808}]')), [{ source: 'value', target: 'value', kind: 'integer' }])).result).outcome).toBe('committed'); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '9007199254740993' }, { id: '2', type: 'null', value: null }, { id: '3', type: 'integer', value: '-9223372036854775808' }]);
    const ordinary = await inspect(app, profile, file(profile, '[{"value":"9007199254740993"}]'), 'ordinary'); expect(ordinary).toMatchObject({ strict: false, columns: [expect.objectContaining({ affinity: 'numeric' })] }); expect(await preview(app, ordinary)).toMatchObject({ ok: false, report: { issues: [expect.objectContaining({ code: 'unsafe-affinity' })] } });
  });

  it('整文件missing诊断有界且继续计数；生成列、缺必填字段及空文件均不能取得apply能力', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB,computed GENERATED ALWAYS AS(id+1))'), { app } = runtime(profile), inspected = await inspect(app, profile, file(profile, JSON.stringify([{ value: '首条' }, ...Array.from({ length: 130 }, () => ({}))])));
    const checked = await preview(app, inspected); expect(checked).toMatchObject({ ok: false, records: 131, report: { checkedRecords: 131, validRecords: 1, invalidRecords: 130, issueCount: 130, complete: true, truncated: true } }); expect(checked.report.issues).toHaveLength(100); expect(checked.report.issues[0]).toMatchObject({ record: 2, source: 'value', code: 'missing-source' }); expect(checked).not.toHaveProperty('previewId'); expect(rows(profile)).toEqual([]);
    expect(await preview(app, inspected, [{ source: 'value', target: 'computed', kind: 'integer' }])).toMatchObject({ ok: false, report: { issues: [expect.objectContaining({ code: 'invalid-mapping' })] } });
    const empty = await inspect(app, profile, file(profile, '[]')); expect(empty.records).toBe(0); expect(await preview(app, empty)).toMatchObject({ ok: false, report: { checkedRecords: 0, complete: true, issues: [expect.objectContaining({ code: 'empty-file' })] } });
  });

  it.each(['IGNORE', 'REPLACE'])('表默认ON CONFLICT %s不能跳行或删旧行，末条冲突整批回滚并返回准确行号', async policy => {
    const profile = fixture(`CREATE TABLE target(id INTEGER PRIMARY KEY,value TEXT UNIQUE ON CONFLICT ${policy}); INSERT INTO target VALUES(1,'保留原行')`), { app } = runtime(profile), inspected = await inspect(app, profile, file(profile, '[{"value":"前缀未提交"},{"value":"保留原行"}]')), checked = await plan(app, inspected), operation = apply(app, checked);
    expect(checked.sql).toMatch(/^INSERT OR ABORT /); expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { requestedRows: 2, appliedRows: 1, rollbackAcknowledged: true, commitMayHaveBeenSent: false }, failure: { code: 'native-rejected', record: 2 } }); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '保留原行' }]); expect((await preview(app, inspected)).ok).toBe(true); await expect(app.request('sqlite.tableImport.apply', { ...operation.input, taskId: '旧能力不得重放' })).rejects.toThrow('失效');
  });

  it('RAISE IGNORE的零顶层changes拒提交，正常trigger额外写不误判为多源行', async () => {
    const profile = fixture("CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB); CREATE TABLE audit(value); CREATE TRIGGER logged AFTER INSERT ON target BEGIN INSERT INTO audit VALUES(new.value); END; CREATE TRIGGER ignored BEFORE INSERT ON target WHEN new.value='跳过' BEGIN SELECT RAISE(IGNORE); END"), { app } = runtime(profile), checked = await plan(app, await inspect(app, profile, file(profile, '[{"value":"第一行"},{"value":"跳过"}]')));
    expect(await apply(app, checked).result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 1 }, failure: { code: 'native-rejected', record: 2 } }); expect(rows(profile)).toEqual([]); expect(disk(profile, db => db.prepare('SELECT count(*) AS n FROM audit').get()!.n)).toBe(0);
    const good = await plan(app, await inspect(app, profile, file(profile, '[{"value":"正常触发"}]'))); expect((await apply(app, good).result).outcome).toBe('committed'); expect(disk(profile, db => db.prepare('SELECT value FROM audit').all())).toEqual([{ value: '正常触发' }]);
  });

  it('预检后源字节或目录变化分别零写拒绝/原事务回滚，源和schema问题不伪造成约束行', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile, '[{"value":"原值"}]'), inspected = await inspect(app, profile, path), first = await plan(app, inspected); writeFileSync(path, '[{"value":"改值"}]'); expect(await apply(app, first).result).toMatchObject({ outcome: 'not-sent', failure: { code: 'source-changed' } }); expect(rows(profile)).toEqual([]);
    const second = await plan(app, await inspect(app, profile, path)); disk(profile, db => db.exec('CREATE INDEX changed ON target(value)')); expect(await apply(app, second).result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 0, rollbackAcknowledged: true }, failure: { code: 'schema-changed' } }); expect(rows(profile)).toEqual([]);
  });

  it('inspect后ALTER在preview短RO目录复核即拒绝，不用旧列目录签发预览', async () => {
    const profile = fixture(), { app } = runtime(profile), inspected = await inspect(app, profile, file(profile, '[{"value":"不得签发旧目录能力"}]')); disk(profile, db => db.exec('ALTER TABLE target ADD COLUMN added TEXT'));
    await expect(preview(app, inspected)).rejects.toThrow('目录已变化'); expect(rows(profile)).toEqual([]); expect(processes.every(record => !record.sent.some(message => message.kind === 'execute' && message.sql.startsWith('INSERT')))).toBe(true); expect(await processes.at(-1)!.exited).toEqual({ code: 0, signal: null });
  });

  it('流中最后指纹改变在已发送INSERT后仍回滚整批，不按旧样本或提前读完宣称成功', async () => {
    const profile = fixture(); let path = '', armed = false; const { app } = runtime(profile, () => transport((message, forward, record) => { const last = record.sent.filter(value => value.kind === 'execute').at(-1); if (armed && message.kind === 'statementEnd' && last?.kind === 'execute' && last.sql.startsWith('INSERT OR ABORT')) { armed = false; writeFileSync(path, '[{"value":"替换后"},{"value":"第二行"}]'); } forward(); })); path = file(profile, '[{"value":"第一行"},{"value":"第二行"}]'); const checked = await plan(app, await inspect(app, profile, path)); armed = true;
    expect(await apply(app, checked).result).toMatchObject({ outcome: 'rolled-back', fact: { rollbackAcknowledged: true }, failure: { code: 'source-changed' } }); expect(rows(profile)).toEqual([]);
  });

  it('readonly只读检查/预检可用，错误确认消费一次能力，源库和hardlink在fork前拒绝', async () => {
    const profile = fixture(), { app } = runtime(profile), path = file(profile, '[{"value":"原值"}]'), checked = await plan(app, await inspect(app, profile, path)); const wrong = apply(app, { ...checked, confirmation: '错误确认' }); expect((await wrong.result).outcome).toBe('not-sent'); await expect(app.request('sqlite.tableImport.apply', { ...wrong.input, confirmation: checked.confirmation, taskId: '不重复确认' })).rejects.toThrow('失效');
    await app.request('connections.close', { id: profile.id }); profile.sqlite.readOnly = true; const readonly = await plan(app, await inspect(app, profile, path)), count = processes.length; expect((await apply(app, readonly).result).outcome).toBe('not-sent'); expect(processes).toHaveLength(count); expect(rows(profile)).toEqual([]);
    await expect(inspect(app, profile, profile.sqlite.filePath!)).rejects.toThrow('不能作为导入源'); const alias = join(dirname(path), '源库硬链接.json'); linkSync(profile.sqlite.filePath!, alias); await expect(inspect(app, profile, alias)).rejects.toThrow('不能作为导入源'); expect(processes).toHaveLength(count);
  });

  it('独立导入忙0失败不借用户事务，原未提交行和TEMP表完整保留，显式rollback后新预检可提交', async () => {
    const profile = fixture(), { app } = runtime(profile), { sessionId } = await app.request('sessions.open', { connectionId: profile.id, database: 'main' }); await app.request('query.execute', { sessionId, taskId: '原用户写事务', sql: "CREATE TEMP TABLE marker(n); INSERT INTO marker VALUES(7); BEGIN; INSERT INTO target VALUES(1,'用户未提交')", maxRows: 100 });
    const inspected = await inspect(app, profile, file(profile, '[{"value":"新导入"}]')), checked = await plan(app, inspected); expect(await apply(app, checked).result).toMatchObject({ outcome: 'not-sent', fact: { appliedRows: 0, commitMayHaveBeenSent: false } }); expect(await app.request('query.sessionState', { sessionId })).toMatchObject({ transactionOpen: true, transactionKnown: true }); expect((await app.request('query.execute', { sessionId, taskId: '原用户行仍在', sql: 'SELECT value FROM target', maxRows: 100 })).results[0].rows).toEqual([{ c0: '用户未提交' }]); expect((await app.request('query.execute', { sessionId, taskId: '原临时表仍在', sql: 'SELECT n FROM marker', maxRows: 100 })).results[0].rows).toEqual([{ c0: '7' }]); expect(rows(profile)).toEqual([]);
    await app.request('query.transaction', { sessionId, action: 'rollback' }); expect(rows(profile)).toEqual([]); expect((await apply(app, await plan(app, inspected)).result).outcome).toBe('committed'); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '新导入' }]);
  });

  it('原INSERT header暂停后准确cancel，尚未step的行不落盘且保真实rollback/exit和任务墓碑', async () => {
    const profile = fixture(), reached = deferred<void>(); let armed = false; const { app, events } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'statement' && message.sql.startsWith('INSERT OR ABORT')) { armed = false; reached.resolve(); } else forward(); })); const checked = await plan(app, await inspect(app, profile, file(profile, '[{"value":"不得落盘"}]'))); armed = true; const operation = apply(app, checked); await reached.promise; await app.request('query.cancel', { taskId: operation.input.taskId }); expect(await operation.result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 0, rollbackAcknowledged: true } }); expect(rows(profile)).toEqual([]); expect(events.filter(event => event.taskId === operation.input.taskId).at(-1)?.status).toBe('cancelled'); expect(processes.at(-1)!.kills).toBe(0); expect(await processes.at(-1)!.exited).toEqual({ code: 0, signal: null }); expect(app.ownsTask(operation.input.taskId)).toBe(true);
    const next = await plan(app, await inspect(app, profile, file(profile, '[{"value":"下一项准确提交"}]'))); await app.request('query.cancel', { taskId: operation.input.taskId }); expect((await apply(app, next).result).outcome).toBe('committed');
  });

  it('COMMIT边界后cancel/close/forceClose和预览TTL都不能杀原提交，原ACK完成才归还资源', async () => {
    const profile = fixture(), reached = deferred<void>(); let armed = false, release!: () => void; const { app } = runtime(profile, () => transport((message, forward) => { if (armed && message.kind === 'statement' && message.sql === 'COMMIT') { release = forward; reached.resolve(); } else forward(); })); const checked = await plan(app, await inspect(app, profile, file(profile, '[{"value":"准确提交"}]'))); armed = true; const operation = apply(app, checked); await reached.promise; const record = processes.at(-1)!, count = record.sent.length; let cancelled = false; const cancel = app.request('query.cancel', { taskId: operation.input.taskId }).then(() => { cancelled = true; }), close = app.request('connections.close', { id: profile.id }), force = app.forceClose(); await delay(20); expect(cancelled).toBe(false); expect(record.kills).toBe(0); expect(record.sent).toHaveLength(count); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1); release(); try { expect((await operation.result).outcome).toBe('committed'); await Promise.all([cancel, close, force]); } finally { vi.useRealTimers(); } expect(record.kills).toBe(0); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '准确提交' }]);
  });

  it.each([true, false])('原COMMIT落盘后丢最终completed，保statementEnd=%s准确分committed/unknown不重放', async acknowledged => {
    const profile = fixture(); let armed = false; const { app } = runtime(profile, () => transport((message, forward, record) => { const last = record.sent.filter(value => value.kind === 'execute').at(-1); if (armed && last?.kind === 'execute' && last.sql === 'COMMIT') { if (message.kind === 'statementEnd') { if (acknowledged) forward(); record.child.kill(); return; } if (message.kind === 'completed') return; } forward(); })); const checked = await plan(app, await inspect(app, profile, file(profile, '[{"value":"真实已落盘"}]'))); armed = true; const operation = apply(app, checked); expect(await operation.result).toMatchObject({ outcome: acknowledged ? 'committed' : 'unknown', cleanupWarning: true, fact: { appliedRows: 1, commitMayHaveBeenSent: true, commitAcknowledged: acknowledged, rollbackAcknowledged: false } }); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '真实已落盘' }]); await expect(app.request('sqlite.tableImport.apply', { ...operation.input, taskId: '不确定禁止重放' })).rejects.toThrow('失效');
  });

  it('同步事实持久失败在发送前阻断或COMMIT前回滚；提交后回调失败不抹原ACK', async () => {
    const profile = fixture(), { app } = runtime(profile), inspected = await inspect(app, profile, file(profile, '[{"value":"真实值"}]'));
    expect((await apply(app, await plan(app, inspected), fact => { if (fact.phase === 'not-sent') throw Error('真实同步持久失败'); }).result).outcome).toBe('not-sent'); expect(rows(profile)).toEqual([]);
    expect(await apply(app, await plan(app, inspected), fact => { if (fact.phase === 'commit-pending') throw Error('COMMIT前持久失败'); }).result).toMatchObject({ outcome: 'rolled-back', fact: { appliedRows: 1, commitMayHaveBeenSent: false, rollbackAcknowledged: true } }); expect(rows(profile)).toEqual([]);
    expect(await apply(app, await plan(app, inspected), fact => { if (fact.phase === 'committed') throw Error('原ACK后持久失败'); }).result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); expect(rows(profile)).toHaveLength(1);
  });

  it('COMMIT已ACK但原close退出未知仍保committed，连接阻新建直到显式close准确释放', async () => {
    const profile = fixture(), reached = deferred<void>(); let hold = false; const { app } = runtime(profile, () => transport(undefined, message => { if (hold && message.kind === 'close') { vi.useFakeTimers(); reached.resolve(); return true; } return false; })); const path = file(profile, '[{"value":"已提交原值"}]'), checked = await plan(app, await inspect(app, profile, path)); hold = true; const operation = apply(app, checked); await reached.promise;
    try { await vi.advanceTimersByTimeAsync(5001); expect(await operation.result).toMatchObject({ outcome: 'committed', cleanupWarning: true, fact: { commitAcknowledged: true } }); } finally { vi.useRealTimers(); }
    const count = processes.length; await expect(inspect(app, profile, path)).rejects.toThrow('资源尚未确认'); await expect(app.request('sessions.open', { connectionId: profile.id, database: 'main' })).rejects.toThrow('资源尚未确认'); expect(processes).toHaveLength(count); await app.request('connections.close', { id: profile.id }); expect(app.ownsConnection(profile.id)).toBe(false); expect(rows(profile)).toEqual([{ id: '1', type: 'text', value: '已提交原值' }]);
  });

  it('源能力准确release及文档失效均零新读取；表/视图/虚拟表权限不能由文件映射扩展', async () => {
    const profile = fixture('CREATE TABLE target(id INTEGER PRIMARY KEY,value BLOB); CREATE VIEW viewed AS SELECT * FROM target; CREATE VIRTUAL TABLE searched USING fts5(value)'), { app } = runtime(profile), path = file(profile, '[{"value":"真实值"}]'), inspected = await inspect(app, profile, path), checked = await plan(app, inspected); await app.request('sqlite.tableImport.release', { inspectionId: inspected.inspectionId }); await expect(preview(app, inspected)).rejects.toThrow('失效'); await expect(apply(app, checked).result).rejects.toThrow('失效'); const count = processes.length; await expect(inspect(app, profile, path, 'target', 'json', () => { throw Error('原文档已失效'); })).rejects.toThrow('原文档已失效'); expect(processes).toHaveLength(count);
    for (const table of ['viewed', 'searched']) await expect(inspect(app, profile, path, table)).rejects.toThrow('不能导入'); expect(rows(profile)).toEqual([]);
  });
});
