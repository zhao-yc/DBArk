import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { buildSqliteWorker as build } from '../helpers/buildSqliteWorker';
import { queryParameterLimits } from '../../src/shared/queryParameters';
import { SqliteDriverError, SqliteDriverSession, type SqliteExecuteOptions, type SqliteStreamReadOptions } from '../../src/engine/sqlite/session';
import type { SqliteExecutionResult, SqliteProcessExit, SqliteProcessTransport, SqliteValue, SqliteWorkerRequest, SqliteWorkerResponse } from '../../src/engine/sqlite/protocol';

interface ProcessRecord { child: ChildProcess; sent: SqliteWorkerRequest[]; received: SqliteWorkerResponse[]; kills: number; exited: Promise<SqliteProcessExit>; }
const directories: string[] = [], processes: ProcessRecord[] = [], drivers = new Set<SqliteDriverSession>(), active = new Set<Promise<SqliteExecutionResult>>();
let worker: string, bundleDirectory: string, retained = false;
/** 只同步真实执行边界，不替换SQL或原生结果。 */
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeAll(async () => { bundleDirectory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-bindings-build-')); worker = join(bundleDirectory, 'worker.cjs'); await build({ entryPoints: ['src/engine/sqlite/worker.ts'], outfile: worker, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'node22' }); });
/** 所有目录属于本例；准确执行/进程终态在删除之前，失败保留磁盘原件。 */
function removeDirectory(directory: string): void { expect(dirname(resolve(directory))).toBe(resolve(tmpdir())); expect(basename(directory).startsWith('dbark-sqlite-bindings-')).toBe(true); rmSync(directory, { recursive: true, force: true }); }
afterEach(async context => {
  const failed = context.task.result?.state === 'fail'; retained ||= failed;
  for (const driver of drivers) if (driver.isBusy) await driver.cancel(); await Promise.allSettled([...active]);
  for (const driver of drivers) await driver.close(); drivers.clear();
  for (const record of processes.splice(0)) { if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(); await record.exited; }
  for (const directory of directories.splice(0)) if (!failed) removeDirectory(directory);
});
afterAll(() => { if (!retained) removeDirectory(bundleDirectory); });
/** 合成真实磁盘，无用户配置、网络或已有库。 */
function fixture(): string { const directory = mkdtempSync(join(tmpdir(), 'dbark-sqlite-bindings-')); directories.push(directory); const path = join(directory, 'source.sqlite'), db = new DatabaseSync(path); try { db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,note TEXT,num,payload BLOB)'); } finally { db.close(); } return path; }
function disk<T>(path: string, action: (db: InstanceType<typeof DatabaseSync>) => T): T { const db = new DatabaseSync(path); try { return action(db); } finally { db.close(); } }
/** 仅故障例在发送端加非法字段，以独立证明worker不能信Main预校验；原响应一律真实透传。 */
function transport(rewrite?: (message: SqliteWorkerRequest) => SqliteWorkerRequest): SqliteProcessTransport {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^DBARK_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key)));
  const child = fork(worker, [], { env, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true }); child.stdout!.resume(); child.stderr!.resume();
  const record: ProcessRecord = { child, sent: [], received: [], kills: 0, exited: new Promise<SqliteProcessExit>(yes => child.once('exit', (code, signal) => yes({ code, signal }))) }; processes.push(record);
  return { send: original => { const message = rewrite ? rewrite(original) : original; record.sent.push(message); child.send(message, error => { if (error) child.kill(); }); }, onMessage(listener) { const receive = (message: SqliteWorkerResponse) => { record.received.push(message); listener(message); }; child.on('message', receive); return () => child.off('message', receive); }, terminate: () => { record.kills++; return child.kill(); }, exited: record.exited };
}
async function open(path: string, readOnly = false, rewrite?: (message: SqliteWorkerRequest) => SqliteWorkerRequest) { const driver = await SqliteDriverSession.open(() => transport(rewrite), { path, readOnly, busyTimeoutMs: 100 }); drivers.add(driver); return { driver, process: processes.at(-1)! }; }
function track(work: Promise<SqliteExecutionResult>) { active.add(work); void work.then(() => active.delete(work), () => active.delete(work)); return work; }
/** 按原批次逐份收集本例小结果，执行事实仍由原driver返回，不拼参数到SQL。 */
async function execute(driver: SqliteDriverSession, sql: string, options: SqliteExecuteOptions = {}) {
  const rows = new Map<number, SqliteValue[][]>(), headers: string[] = [];
  const result = await track(driver.execute(sql, { ...options, onStatement: header => { headers.push(header.sql); return options.onStatement?.(header); }, onBatch: async batch => { const group = rows.get(batch.index) ?? []; group.push(...batch.rows); rows.set(batch.index, group); await options.onBatch?.(batch); } }));
  return { result, rows, headers };
}
const integer = (value: string): SqliteValue => ({ type: 'integer', value });
function count(path: string): unknown { return disk(path, db => db.prepare('SELECT count(*) AS n FROM subject').get()!.n); }

describe('SQLite命名脚本真实原生绑定、整组零step预校验及准确资源', () => {
  it('同map跨DDL/事务/多句复用，重复名称单槽，注入/NUL/空文本/NULL/BLOB/REAL/signed64全部原值保真', async () => {
    const path = fixture(), { driver, process } = await open(path), injection = "'); DROP TABLE subject;--\0中文🚢", named = Object.assign(Object.create(null), { ':id': integer('1'), ':text': injection, ':max': integer('9223372036854775807'), ':min': integer('-9223372036854775808'), ':real': { type: 'real', value: '-0' }, ':null': null, ':empty': '', ':blob': { type: 'binary', base64: 'AP8=' }, ':zero': { type: 'binary', base64: '' } }) as Record<string, SqliteValue>;
    const sql = 'CREATE TEMP TABLE marker(note); BEGIN; INSERT INTO subject VALUES(:id,:text,:max,:blob); INSERT INTO marker VALUES(:text); SELECT :text,:text,:max,:min,:real,:null,:empty,:blob,:zero; COMMIT; SELECT note FROM marker';
    const outcome = await execute(driver, sql, { namedParameters: named }); expect(outcome.result.statements).toHaveLength(7); expect(outcome.result.transaction).toBe(false);
    expect(outcome.rows.get(4)).toEqual([[injection, injection, integer('9223372036854775807'), integer('-9223372036854775808'), { type: 'real', value: '-0' }, null, '', { type: 'binary', base64: 'AP8=' }, { type: 'binary', base64: '' }]]); expect(outcome.rows.get(6)).toEqual([[injection]]);
    expect(disk(path, db => db.prepare('SELECT note,typeof(num) AS storage,quote(num) AS number,hex(payload) AS bytes FROM subject').get())).toEqual({ note: injection, storage: 'integer', number: '9223372036854775807', bytes: '00FF' });
    expect(process.sent.find(message => message.kind === 'execute')).toMatchObject({ sql, namedParameters: named }); expect(Object.getPrototypeOf((process.sent.find(message => message.kind === 'execute') as Extract<SqliteWorkerRequest, { kind: 'execute' }>).namedParameters)).toBeNull(); expect(outcome.headers.some(header => header.includes(':text'))).toBe(true); expect(outcome.headers.some(header => header.includes(injection))).toBe(false);
    await driver.close(); expect(await process.exited).toEqual({ code: 0, signal: null }); expect(process.kills).toBe(0);
  });

  it('missing/extra/wrongstyle或后部不完整均在首条无参写哨兵之前拒绝，所有错误不泄露绑定值', async () => {
    const path = fixture(), { driver, process } = await open(path), sentinel = "INSERT INTO subject VALUES(99,'前哨兵',NULL,NULL); ";
    for (const [suffix, named] of [['SELECT :v', {}], ['SELECT :v', { ':v': '保密合成值', ':extra': '多余' }], ['SELECT ?', { ':v': '保密合成值' }], ['SELECT ?2', { ':v': '保密合成值' }], ['SELECT @v', { ':v': '保密合成值' }], ['SELECT $v', { ':v': '保密合成值' }], ["SELECT :v; SELECT '未闭合", { ':v': '保密合成值' }]] as [string, Record<string, SqliteValue>][]) {
      const failure = await track(driver.execute(sentinel + suffix, { namedParameters: named })).catch(reason => reason); expect(failure).toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(failure.message).not.toContain('保密合成值'); expect(count(path)).toBe(0);
    }
    expect(process.received.some(message => message.kind === 'statement')).toBe(false); expect(driver.isUsable).toBe(true);
  });

  it('映射仅自有普通/nullproto数据字段，getter/继承/非法键/嵌套访问器均零投递，安全原型同名参数可绑定', async () => {
    const path = fixture(), { driver, process } = await open(path), baseline = process.sent.length; let invoked = 0;
    const getter = Object.defineProperty({}, ':v', { enumerable: true, get: () => { invoked++; return '不得读取'; } });
    const nested = { ':v': Object.defineProperty({ type: 'integer' }, 'value', { enumerable: true, get: () => { invoked++; return '1'; } }) };
    for (const map of [getter, nested, Object.create({ ':v': '继承值' }), { v: '缺完整冒号' }, { ':1bad': '名称' }, { [Symbol('不接受符号')]: '值' }]) await expect(track(driver.execute('SELECT :v', { namedParameters: map as Record<string, SqliteValue> }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID' });
    expect(invoked).toBe(0); expect(process.sent).toHaveLength(baseline);
    const safe = Object.assign(Object.create(null), { ':__proto__': '原型名是值', ':constructor': integer('7') }) as Record<string, SqliteValue>; expect((await execute(driver, 'SELECT :__proto__,:constructor', { namedParameters: safe })).rows.get(0)).toEqual([['原型名是值', integer('7')]]);
  });

  it('隐藏参数键/包装字段及复制前超量对象均零投递，隐藏getter和超量对象getter从不调用', async () => {
    const path = fixture(), { driver, process } = await open(path), baseline = process.sent.length; let invoked = 0;
    const hiddenKey = Object.defineProperty({}, ':v', { value: '隐藏绑定', enumerable: false });
    const hiddenType = { ':v': Object.defineProperty({ value: '1' }, 'type', { value: 'integer', enumerable: false }) };
    const hiddenValue = { ':v': Object.defineProperty({ type: 'integer' }, 'value', { value: '1', enumerable: false }) };
    const hiddenGetter = Object.defineProperty({}, ':v', { enumerable: false, get: () => { invoked++; return '不得调用'; } });
    const oversized = Object.fromEntries(Array.from({ length: queryParameterLimits.names }, (_, index) => [':p' + index, '值'])); Object.defineProperty(oversized, ':last', { enumerable: true, get: () => { invoked++; return '超量时不得调用'; } });
    const oversizedValue = { ':v': Object.defineProperty({ type: 'integer', value: '1' }, 'extra', { enumerable: true, get: () => { invoked++; return '包装超量时不得调用'; } }) };
    for (const map of [hiddenKey, hiddenType, hiddenValue, hiddenGetter, oversized, oversizedValue]) await expect(track(driver.execute("INSERT INTO subject VALUES(1,:v,NULL,NULL)", { namedParameters: map as Record<string, SqliteValue> }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 });
    expect(invoked).toBe(0); expect(process.sent).toHaveLength(baseline); expect(process.received.some(message => message.kind === 'statement')).toBe(false); expect(count(path)).toBe(0);
  });

  it('named与位置数组互斥，stream公开选项及绕过Main的原请求都不能接受named', async () => {
    const path = fixture(), { driver, process } = await open(path), baseline = process.sent.length;
    await expect(track(driver.execute("INSERT INTO subject VALUES(1,:v,NULL,NULL)", { parameters: [], namedParameters: { ':v': '不得写' } }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID' }); expect(process.sent).toHaveLength(baseline);
    const forged = await open(path, false, message => message.kind === 'execute' ? { ...message, parameters: [] } : message); await expect(track(forged.driver.execute("INSERT INTO subject VALUES(1,:v,NULL,NULL)", { namedParameters: { ':v': '不得写' } }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(count(path)).toBe(0); expect(forged.process.received.some(message => message.kind === 'statement')).toBe(false);
    const read = await open(path, true), streamOptions = { parameters: [], namedParameters: { ':v': '不得读' }, onBatch: () => {} } as unknown as SqliteStreamReadOptions, before = read.process.sent.length; await expect(track(read.driver.streamRead('SELECT :v', streamOptions))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID' }); expect(read.process.sent).toHaveLength(before);
    const forgedRead = await open(path, true, message => message.kind === 'streamRead' ? { ...message, namedParameters: { ':v': '不得读' } } as unknown as SqliteWorkerRequest : message); await expect(track(forgedRead.driver.streamRead('SELECT :v', { parameters: [], onBatch: () => {} }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(forgedRead.process.received.some(message => message.kind === 'statement')).toBe(false);
  });

  it.each<SqliteValue>([{ type: 'integer', value: '9223372036854775808' }, { type: 'integer', value: '01' }, { type: 'real', value: 'NaN' }, { type: 'binary', base64: '***' }, '\uD800', '界'.repeat(Math.floor(queryParameterLimits.valueBytes / 3) + 1), { type: 'binary', base64: Buffer.alloc(queryParameterLimits.valueBytes + 1).toString('base64') }])('整组无效值案例%#在首条写之前失败，不回显值', async value => {
    const path = fixture(), { driver, process } = await open(path), sql = "INSERT INTO subject VALUES(99,'前哨兵',NULL,NULL); SELECT :value";
    const failure = await track(driver.execute(sql, { namedParameters: { ':value': value } })).catch(reason => reason); expect(failure).toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(failure.message).toBe('SQLite整组命名绑定、名称集合或参数预算无效，尚未执行任何用户语句'); expect(count(path)).toBe(0); expect(process.received.some(message => message.kind === 'statement')).toBe(false);
  });

  it('参数按实际UTF8/raw BLOB字节计64KiB与总1MiB，base64较长不被错当原值超限', async () => {
    const path = fixture(), { driver } = await open(path), blob = Buffer.alloc(queryParameterLimits.valueBytes, 255).toString('base64'); expect(blob.length).toBeGreaterThan(queryParameterLimits.valueBytes);
    expect((await execute(driver, 'SELECT length(:blob),typeof(:blob)', { namedParameters: { ':blob': { type: 'binary', base64: blob } } })).rows.get(0)).toEqual([[integer('65536'), 'blob']]);
    const values = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [':p' + index, 'a'.repeat(queryParameterLimits.valueBytes)])), sum = Object.keys(values).map(name => 'length(' + name + ')').join('+'); expect((await execute(driver, 'SELECT ' + sum, { namedParameters: values })).rows.get(0)).toEqual([[integer(String(queryParameterLimits.totalBytes))]]);
    const tooMany = { ...values, ':p16': 'a' }, sql = "INSERT INTO subject VALUES(99,'前哨兵',NULL,NULL); SELECT " + sum + '+length(:p16)'; await expect(track(driver.execute(sql, { namedParameters: tooMany }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(count(path)).toBe(0);
  });

  it('超过200名称/100000出现次数/1000语句的整模板在首条写之前明确拒绝', async () => {
    const path = fixture(), { driver, process } = await open(path), prefix = "INSERT INTO subject VALUES(99,'前哨兵',NULL,NULL); ";
    const names = Object.fromEntries(Array.from({ length: queryParameterLimits.names + 1 }, (_, index) => [':v' + index, 'x'])); await expect(track(driver.execute(prefix + 'SELECT ' + Object.keys(names).join(','), { namedParameters: names }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 });
    await expect(track(driver.execute(prefix + 'SELECT ' + Array(queryParameterLimits.occurrences + 1).fill(':v').join('+'), { namedParameters: { ':v': integer('1') } }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 });
    await expect(track(driver.execute(prefix + 'SELECT :v;'.repeat(1000), { namedParameters: { ':v': integer('1') } }))).rejects.toMatchObject({ code: 'SQLITE_NAMED_PARAMETERS_INVALID', completedStatements: 0 }); expect(count(path)).toBe(0); expect(process.received.some(message => message.kind === 'statement')).toBe(false);
  });

  it('native语法/约束首错保留原前序statementEnd与事务事实，未执行后句、不拼值、不重放', async () => {
    const path = fixture(), { driver, process } = await open(path), value = '合成私有绑定\0文本', sql = 'INSERT INTO subject VALUES(1,:v,NULL,NULL); SELECT :v; INSERT INTO subject VALUES(1,:v,NULL,NULL); INSERT INTO subject VALUES(2,:v,NULL,NULL)';
    const failure = await track(driver.execute(sql, { namedParameters: { ':v': value } })).catch(reason => reason); expect(failure).toBeInstanceOf(SqliteDriverError); expect(failure).toMatchObject({ completedStatements: 2, transaction: false, sessionClosed: false }); expect(failure.completedResults).toHaveLength(2); expect(failure.completedResults[0]).toMatchObject({ index: 0, changes: '1' }); expect(failure.completedResults[1]).toMatchObject({ index: 1, rows: 1 }); expect(failure.message).not.toContain(value); expect(count(path)).toBe(1);
    expect(process.received.filter(message => message.kind === 'statement')).toHaveLength(3); expect(process.received.filter(message => message.kind === 'statement').some(message => message.sql.includes(value))).toBe(false);
    const before = process.sent.filter(message => message.kind === 'execute').length; expect((await execute(driver, 'SELECT :v', { namedParameters: { ':v': value } })).rows.get(0)).toEqual([[value]]); expect(process.sent.filter(message => message.kind === 'execute')).toHaveLength(before + 1); expect(count(path)).toBe(1);
    const grammar = await track(driver.execute("BEGIN; INSERT INTO subject VALUES(2,:v,NULL,NULL); SELEC :v; INSERT INTO subject VALUES(3,:v,NULL,NULL)", { namedParameters: { ':v': value } })).catch(reason => reason); expect(grammar).toMatchObject({ completedStatements: 2, transaction: true }); expect(count(path)).toBe(1); await execute(driver, 'ROLLBACK'); expect(count(path)).toBe(1);
  });

  it('真实双session事务与readonly前序保持；原authorizer继续阻PRAGMA/ATTACH且无外来文件', async () => {
    const path = fixture(), first = await open(path), second = await open(path, true); await execute(first.driver, 'BEGIN; INSERT INTO subject VALUES(1,:v,NULL,NULL)', { namedParameters: { ':v': '原事务' } }); expect(first.driver.transaction).toBe(true);
    expect((await execute(second.driver, 'SELECT count(*) FROM subject WHERE note=:v', { namedParameters: { ':v': '原事务' } })).rows.get(0)).toEqual([[integer('0')]]); await execute(first.driver, 'COMMIT'); expect(count(path)).toBe(1);
    const denied = await track(second.driver.execute('SELECT :v; INSERT INTO subject VALUES(2,:v,NULL,NULL)', { namedParameters: { ':v': '拒写' } })).catch(reason => reason); expect(denied).toMatchObject({ completedStatements: 1, transaction: false }); expect(denied.completedResults[0]).toMatchObject({ index: 0, rows: 1 }); expect(count(path)).toBe(1);
    const other = join(dirname(path), 'never-attached.sqlite'); for (const sql of ['PRAGMA foreign_keys=OFF; SELECT :v', 'ATTACH :v AS other']) await expect(track(first.driver.execute(sql, { namedParameters: { ':v': other } }))).rejects.toMatchObject({ completedStatements: 0 }); expect(existsSync(other)).toBe(false); expect((await execute(first.driver, 'PRAGMA foreign_keys')).rows.get(0)).toEqual([[integer('1')]]);
  });

  it('命名脚本强取消只终止准确原进程，原未提交写回滚且不会重连或执行后句', async () => {
    const path = fixture(), { driver, process } = await open(path), reached = deferred<void>(), sql = 'BEGIN; INSERT INTO subject VALUES(1,:v,NULL,NULL); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<:limit) SELECT sum(x) FROM n; COMMIT; INSERT INTO subject VALUES(2,:v,NULL,NULL)';
    const work = track(driver.execute(sql, { namedParameters: { ':v': '未提交', ':limit': integer('1000000000') }, onStatement: header => { if (header.sql.includes('sum(x)')) reached.resolve(); } })); const failure = expect(work).rejects.toMatchObject({ code: 'SQLITE_CANCELLED_SESSION_CLOSED', completedStatements: 2, sessionClosed: true, transaction: null }); await reached.promise; await delay(50);
    expect(await driver.cancel()).toMatchObject({ mode: 'process-terminated', sessionClosed: true, resources: 'confirmed' }); await failure; expect(process.kills).toBe(1); await process.exited; expect(driver.isClosed).toBe(true); expect(count(path)).toBe(0); expect(process.received.filter(message => message.kind === 'statement')).toHaveLength(3); expect(process.sent.filter(message => message.kind === 'execute')).toHaveLength(1);
  });

  it('原位置绑定仍单语句且保原较大值预算，readonly stream保单SELECT与原ACK/正常exit', async () => {
    const path = fixture(), { driver } = await open(path), text = 'a'.repeat(queryParameterLimits.valueBytes + 1); expect((await execute(driver, 'SELECT length(?)', { parameters: [text] })).rows.get(0)).toEqual([[integer(String(text.length))]]);
    await expect(track(driver.execute("INSERT INTO subject VALUES(1,'不得step',NULL,NULL); SELECT ?", { parameters: [integer('1')] }))).rejects.toMatchObject({ code: 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', completedStatements: 0 }); expect(count(path)).toBe(0);
    const read = await open(path, true), rows: SqliteValue[][] = []; expect((await track(read.driver.streamRead('SELECT length(?)', { parameters: [text], onBatch: batch => { rows.push(...batch.rows); } }))).statements[0].truncated).toBe(false); expect(rows).toEqual([[integer(String(text.length))]]);
    await expect(track(read.driver.streamRead('SELECT 1; SELECT 2', { parameters: [], onBatch: () => {} }))).rejects.toMatchObject({ code: 'SQLITE_PARAMETERS_REQUIRE_SINGLE_STATEMENT', completedStatements: 0 }); await read.driver.close(); expect(await read.process.exited).toEqual({ code: 0, signal: null }); expect(read.process.kills).toBe(0);
  });
});
