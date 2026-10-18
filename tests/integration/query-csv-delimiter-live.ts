import { randomUUID, createHash } from 'node:crypto';
import { resolve, join, dirname, basename } from 'node:path';
import * as fs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import mysql from 'mysql2';
import type { Connection as NativeConnection } from 'mysql2';
import type { Connection as Observer, RowDataPacket } from 'mysql2/promise';
import { expect, vi, type TestContext } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import * as protocol from '../../src/engine/queryStreamProtocol';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TaskEvent } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import { emptyDefaultFactSql, assertEmptyDefaultFacts } from '../helpers/tableCreateEmptyDefault';
import { bindQcsvTarget, qcsvColumns, qcsvEmptyHeader, qcsvExpectedFields, qcsvHeaders, qcsvLifetime, qcsvPlan, qcsvRows, qcsvUsingHandle, type QcsvCase } from '../helpers/queryCsvIntegration';
import { assertQcsvOutput } from '../helpers/queryCsvIntegrationAssertions';

// 仅在真实原open之前登记partial；原参数、句柄、写入/提交/错误均透传，不模拟产品结果。
const io = vi.hoisted(() => ({
  beforeOpen: undefined as undefined | ((path: unknown) => Promise<void>),
  afterOpen: undefined as undefined | ((path: unknown, handle: FileHandle) => Promise<void>),
  beforeRename: undefined as undefined | ((from: unknown, to: unknown) => Promise<void>),
  afterRename: undefined as undefined | ((from: unknown, to: unknown) => Promise<void>),
  beforeRemove: undefined as undefined | ((path: unknown) => Promise<void>),
}));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    await io.beforeOpen?.(args[0]); const handle = await actual.open(...args);
    try { await io.afterOpen?.(args[0], handle); return handle; }
    catch (reason) { return qcsvUsingHandle(handle, async () => { throw reason; }); }
  }, rename: async (...args: Parameters<typeof actual.rename>) => {
    await io.beforeRename?.(...args); const result = await actual.rename(...args); await io.afterRename?.(...args); return result;
  }, rm: async (...args: Parameters<typeof actual.rm>) => { await io.beforeRemove?.(args[0]); return actual.rm(...args); } };
});
type Native = NativeConnection & { stream: { closed?: boolean; remoteAddress?: string; remotePort?: number } };
type Owned = { role: string; native: Native; stream: Native['stream']; thread: number; normalClosed: boolean; initializing?: boolean; managed?: ManagedConnection };
type Initialization = { role: string; natives: Owned[]; receipt?: NonNullable<ManagedConnection['resources']>; returned: boolean; failed: boolean; late: boolean };
type Identity = { dev: string; ino: string; size: number; hash: string };
type FileObject = Pick<Identity, 'dev' | 'ino'>;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
let halted = false;

/** 只有双门准入后的真实Vitest原任务才能调用；准备提交不调用此函数。 */
export async function runQcsvCase(context: TestContext, scenario: QcsvCase) {
  if (halted) throw Error('QCSV前例未可信结束，保留现场并停止后续例');
  halted = true;
  const plan = qcsvPlan(scenario, randomUUID().replaceAll('-', ''), hash(context.task.id));
  const binding = bindQcsvTarget(() => process.env, 'qcsv-' + plan.nonce);
  const life = qcsvLifetime(context, binding, () => { halted = true; });
  context.onTestFinished(() => life.end());
  const root = resolve(__dirname, '../..');
  if (resolve(process.cwd()) !== root || root.length > 1024) throw Error('QCSV只允许当前明确clone根目录');
  const journal = join(root, '.cache', 'qcsv-' + plan.nonce + '.ownership.ndjson'), directory = join(root, '.cache', plan.directory), target = join(directory, plan.file);
  const actualFs = await vi.importActual<typeof fs>('node:fs/promises'); life.check();
  const owned: Owned[] = [], partials = new Set<string>(), records: object[] = [], definitions = new Map<string, string>();
  let journalBytes = 0, journalId = '', cacheId = '', directoryId = '', targetIdentity: Identity | undefined;
  let partialObject: FileObject | undefined, publication: Identity | undefined, published = false;
  let observer: Observer | undefined, observerOwner: Owned | undefined, source: Owned | undefined, engine: Engine | undefined, sessionId = '';
  let connectRole = 'engine-initial', connectAttempts = 0, sourceExecutions = 0, exporting = false, complete = false, databaseAck = false, closingEngine = false;
  let activeTask = '', taskSettled = false, latestEvent: TaskEvent | undefined;
  let sourceSql = '', expectedStatements: string[] = [];
  const exportCommands: { role: string; thread: number; method: string; sql: string }[] = [];
  const initializations: Initialization[] = []; let initializing: Initialization | undefined;
  let restoreConnect: (() => void) | undefined, restoreCreation: (() => void) | undefined, restoreFrames: (() => void) | undefined;

  /** 同一物理流、thread、profile和managed；正常close标记不能被相同thread新流替代。 */
  function check() {
    life.check();
    for (const item of owned) if (item.native.stream !== item.stream || (!item.initializing || item.thread > 0) && item.native.threadId !== item.thread || item.managed && (item.managed.connection !== item.native || item.managed.profile !== binding.profile || item.managed.broken && !item.normalClosed) || item.stream.closed && !item.normalClosed) { life.stop(); throw Error('QCSV原物理连接或流身份未知'); }
    if (source?.normalClosed && !closingEngine) { life.stop(); throw Error('QCSV原source会话提前关闭'); }
  }
  const step = <T>(action: () => Promise<T>) => life.step(async () => { check(); const value = await action(); check(); return value; });

  /** 元数据日记每次追加都核原inode、大小并fsync；不写凭据/SQL/样本或令牌。 */
  async function record(stage: string, detail: object = {}) {
    check(); const parent = await actualFs.lstat(join(root, '.cache')); check(); const parentPath = await actualFs.realpath(join(root, '.cache')); check();
    if (!parent.isDirectory() || parent.isSymbolicLink() || parentPath !== join(root, '.cache') || String(parent.dev) + ':' + String(parent.ino) !== cacheId) throw Error('QCSV日记父目录身份变化');
    if (records.length >= 48) throw Error('QCSV日记条数超限');
    const entry = { seq: records.length + 1, stage, ...detail }, bytes = Buffer.from(JSON.stringify(entry) + '\n');
    if (journalBytes + bytes.length > 32768) throw Error('QCSV日记超过32KiB');
    const handle = await actualFs.open(journal, records.length ? 'a' : 'wx', 0o600);
    await qcsvUsingHandle(handle, async () => {
      check(); const stat = await handle.stat(); check(); const id = String(stat.dev) + ':' + String(stat.ino);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== journalBytes || journalId && journalId !== id) throw Error('QCSV原日记身份变化');
      journalId = id; await handle.writeFile(bytes); check(); await handle.sync(); check();
    });
    check(); const stat = await actualFs.lstat(journal); check();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || String(stat.dev) + ':' + String(stat.ino) !== journalId || stat.size !== journalBytes + bytes.length) throw Error('QCSV日记路径变化');
    journalBytes += bytes.length; records.push(entry);
  }

  /** 只旁观原query/execute；不更换结果、参数或解码，也不保存查询正文到日志。 */
  function observeNative(native: Native, role: string, managed?: ManagedConnection, acquired?: Owned) {
    const item: Owned = acquired ?? { role, native, stream: native.stream, thread: native.threadId!, normalClosed: false, managed };
    if (acquired) {
      if (item.native !== native || item.stream !== native.stream || item.thread > 0 && item.thread !== native.threadId) { life.stop(); throw Error('QCSV初始化返回的原连接身份变化'); }
      if (!item.thread) item.thread = native.threadId!; item.managed = managed; item.initializing = false;
    } else owned.push(item);
    if (!item.stream || !Number.isSafeInteger(item.thread) || item.thread <= 0 || !['192.168.31.200', '::ffff:192.168.31.200'].includes(item.stream.remoteAddress ?? '') || item.stream.remotePort !== 13384 || owned.some(other => other !== item && other.thread === item.thread)) throw Error('QCSV原peer或线程身份未知');
    for (const method of ['query', 'execute'] as const) {
      const original = native[method];
      (native as any)[method] = function (...args: any[]) {
        const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql;
        if (sourceSql && sql === sourceSql) sourceExecutions++;
        if (exporting) { if (exportCommands.length >= 8 || typeof sql !== 'string') { life.stop(); throw Error('QCSV导出命令超限或身份未知'); } exportCommands.push({ role, thread: item.thread, method, sql }); }
        return (original as any).apply(this, args);
      };
    }
    return item;
  }

  /** 构造返回即登记同一native/stream；事件仅补首次thread及RAM线索，不写日记、不关闭或恢复资源。 */
  function captureNative(native: Native, attempt: Initialization) {
    const item: Owned = { role: attempt.role, native, stream: native.stream, thread: native.threadId ?? 0, normalClosed: false, initializing: true };
    owned.push(item); attempt.natives.push(item);
    const remember = () => {
      attempt.late ||= life.state.retained || !life.state.active;
      const thread = native.threadId;
      if (native.stream !== item.stream || !item.stream || !Number.isSafeInteger(thread) || thread! <= 0 || item.thread > 0 && item.thread !== thread) { attempt.failed = true; life.stop(); return; }
      if (!item.thread) item.thread = thread!;
    };
    native.on('connect', remember);
    native.on('error', () => { attempt.failed = true; life.stop(); });
    if (!item.stream || attempt.natives.length !== 1) { attempt.failed = true; life.stop(); }
    return item;
  }

  /** 原回执只读快照进入失败附录；未知明确保留，不调用recover，也不从替代句柄补认证。 */
  function initializationEvidence(attempt: Initialization) {
    let resources: unknown;
    try { resources = attempt.receipt?.snapshot(); } catch { resources = { inventoryUnknown: true }; }
    return { role: attempt.role, receiptAvailable: !!attempt.receipt, returned: attempt.returned, failed: attempt.failed, late: attempt.late,
      natives: attempt.natives.map(item => ({ thread: item.thread, observedThread: item.native.threadId ?? 0, streamClosed: item.stream?.closed === true })), resources };
  }

  /** 唯一独立observer采用-IGNORE_SPACE；先登记后建连，不补恢复连接。 */
  async function rawObserver() {
    await record('connection-planned', { role: 'observer' }); check(); connectAttempts++;
    const native = mysql.createConnection({ host: binding.profile.host, port: 13384, user: binding.profile.user, password: binding.profile.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, multipleStatements: false, flags: ['-IGNORE_SPACE'], connectTimeout: 10000 }) as unknown as Native;
    const acquired: Owned = { role: 'observer', native, stream: native.stream, thread: native.threadId ?? 0, normalClosed: false }; owned.push(acquired); native.on('error', () => life.stop());
    const connection = native.promise(); await new Promise<void>((yes, no) => native.connect(error => error ? no(error) : yes()));
    const owner = observeNative(native, 'observer', undefined, acquired); check(); await record('connection-returned', { role: owner.role, thread: owner.thread }); return { connection, owner };
  }
  async function facts() { const [rows] = await step(() => observer!.query<RowDataPacket[]>(emptyDefaultFactSql)); assertEmptyDefaultFacts(rows, plan.serverUuid); }
  const table = (name: string) => quote(plan.database) + '.' + quote(name);
  async function sql(text: string, params?: unknown[]) { return step(() => observer!.query<any>(text, params)); }
  /** 只认可本例已取得身份的原目录，路径相同不能替代原inode。 */
  async function ownedDirectory() {
    check(); const stat = await actualFs.lstat(directory); check(); const path = await actualFs.realpath(directory); check();
    if (!directoryId || !stat.isDirectory() || stat.isSymbolicLink() || path !== directory || String(stat.dev) + ':' + String(stat.ino) !== directoryId) throw Error('QCSV原目录身份变化');
  }
  /** 文件只读前后核同inode、规范路径、大小、nlink及可选摘要；上限2MiB。 */
  async function file(path: string, expected?: Identity, object?: FileObject) {
    await ownedDirectory(); if (dirname(resolve(path)) !== directory) throw Error('QCSV文件越出本例目录');
    check(); const before = await actualFs.lstat(path); check(); const canonical = await actualFs.realpath(path); check();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !Number.isSafeInteger(before.dev) || before.dev < 0 || !Number.isSafeInteger(before.ino) || before.ino <= 0 || before.size > 2 * 1024 * 1024 || canonical !== resolve(path) || object && (String(before.dev) !== object.dev || String(before.ino) !== object.ino)) throw Error('QCSV文件类型、原对象、规范路径或预算未知');
    const bytes = await actualFs.readFile(path); check(); const canonicalAfter = await actualFs.realpath(path); check(); const after = await actualFs.lstat(path); check();
    const identity = { dev: String(after.dev), ino: String(after.ino), size: after.size, hash: hash(bytes) };
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || canonicalAfter !== resolve(path) || after.dev !== before.dev || after.ino !== before.ino || after.size !== bytes.length || expected && JSON.stringify(identity) !== JSON.stringify(expected)) throw Error('QCSV文件读取期间身份或字节变化');
    await ownedDirectory(); return { bytes, identity };
  }
  /** 归属只从原open句柄取得一次，拒绝不精确的系统标识；路径快照不能签发新对象归属。 */
  async function openedObject(handle: FileHandle): Promise<FileObject> {
    const stat = await handle.stat(); check();
    if (!stat.isFile() || stat.nlink !== 1 || !Number.isSafeInteger(stat.dev) || stat.dev < 0 || !Number.isSafeInteger(stat.ino) || stat.ino <= 0) throw Error('QCSV原open句柄身份未知');
    return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
  }
  async function noPartial() {
    await ownedDirectory();
    expect(await step(() => actualFs.readdir(directory))).toEqual([plan.file]);
    expect(partials.size).toBe(1);
    for (const path of partials) try { await actualFs.lstat(path); throw Error('QCSV原partial残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
  }
  /** 公开Engine协议仅附本例路径/profile；不冒充Main文件选择令牌的GUI验收。 */
  async function invoke(command: string, input: any) {
    check(); const valid = validateCommand(command, command === 'connections.open' ? { id: input.id } : input);
    return step(() => engine!.handle(command as any, command === 'connections.open' ? { ...(valid as object), profile: binding.profile } : valid as any));
  }
  async function query(text: string) { return invoke('query.execute', { sessionId, taskId: randomUUID(), sql: text, maxRows: 10 }); }
  /** SQL独立CAST/HEX投影保留精度与JSON原数字，不用产品值/CSV处理器制造答案。 */
  async function rows() {
    const [value] = await sql('SELECT CAST(id AS CHAR) AS id,CAST(signed_value AS CHAR) AS signed_value,CAST(amount AS CHAR) AS amount,DATE_FORMAT(happened,\'%Y-%m-%d %H:%i:%s.%f\') AS happened,CAST(clock_value AS CHAR) AS clock_value,nullable_text,empty_text,HEX(slash_text) AS slash_hex,HEX(punctuation) AS punctuation_hex,HEX(payload) AS payload_hex,JSON_TYPE(doc) AS doc_kind,JSON_UNQUOTE(JSON_EXTRACT(doc,\'$.n\')) AS doc_n,HEX(CAST(doc AS CHAR CHARACTER SET utf8mb4)) AS doc_hex FROM ' + table('source') + ' ORDER BY id');
    return value as Record<string, any>[];
  }

  try {
    check(); const cache = await actualFs.lstat(join(root, '.cache')); check(); const cachePath = await actualFs.realpath(join(root, '.cache')); check();
    if (!cache.isDirectory() || cache.isSymbolicLink() || cachePath !== join(root, '.cache')) throw Error('QCSV既有证据父目录未知'); cacheId = String(cache.dev) + ':' + String(cache.ino);
    await record('planned', { ...plan, runNonce: binding.runNonce, directory, target, partialRule: plan.file + '.dbark-<UUID>.partial' });
    const first = await rawObserver(); observer = first.connection; observerOwner = first.owner; await facts();
    await record('directory-planned'); await step(() => actualFs.mkdir(directory)); const dir = await step(() => actualFs.lstat(directory)), real = await step(() => actualFs.realpath(directory));
    if (!dir.isDirectory() || dir.isSymbolicLink() || real !== directory) throw Error('QCSV原目录未知'); directoryId = String(dir.dev) + ':' + String(dir.ino); await record('directory-created', { identity: directoryId });
    await record('target-planned'); const handle = await actualFs.open(target, 'wx', 0o600), oldBytes = Buffer.from('DBArk-QCSV-old:' + plan.nonce);
    let oldObject: FileObject | undefined;
    await qcsvUsingHandle(handle, async () => { check(); oldObject = await openedObject(handle); await handle.writeFile(oldBytes); check(); await handle.sync(); check(); }); const initial = await file(target, undefined, oldObject); expect(initial.bytes).toEqual(oldBytes); targetIdentity = initial.identity; await record('target-created', { identity: targetIdentity });
    io.beforeOpen = async path => {
      check(); if (typeof path !== 'string' || dirname(resolve(path)) !== directory || !basename(path).startsWith(plan.file + '.dbark-') || !/\.dbark-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/.test(path) || partials.size >= 1) throw Error('QCSV拒绝未登记或重复partial');
      partials.add(path); await record('partial-planned', { name: basename(path) });
    };
    io.afterOpen = async (path, handle) => {
      check(); if (typeof path !== 'string' || !partials.has(path) || partialObject) throw Error('QCSV原partial open归属未知');
      partialObject = await openedObject(handle); await record('partial-opened', { name: basename(path), object: partialObject });
    };
    // 原rename前从已绑定partial读完整身份；发布后仅核该同一对象，不从最终路径重新认领。
    io.beforeRename = async (from, to) => {
      check(); if (typeof from !== 'string' || !partials.has(from) || to !== target || !partialObject || publication) throw Error('QCSV原发布边界未知');
      publication = Object.freeze((await file(from, undefined, partialObject)).identity); await file(target, targetIdentity);
      await record('publish-planned', { partial: basename(from), identity: publication });
    };
    io.afterRename = async (from, to) => {
      check(); if (typeof from !== 'string' || !partials.has(from) || to !== target || !publication || !partialObject || published) throw Error('QCSV原发布回执未知');
      await file(target, publication, partialObject); await record('published', { identity: publication }); published = true;
    };
    // 产品失败收尾同样只可移除原partial；不存在时透传原rm，替换或失效时保留当前路径。
    io.beforeRemove = async path => {
      check(); if (typeof path !== 'string' || !partials.has(path) || !partialObject) throw Error('QCSV原partial删除归属未知');
      try { await file(path, undefined, partialObject); } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; await ownedDirectory(); }
    };
    await facts(); expect((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]))[0]).toHaveLength(0);
    await record('database-planned'); const [created] = await sql('CREATE DATABASE ' + quote(plan.database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); expect(created.affectedRows).toBe(1); databaseAck = true; await record('database-created');
    await sql('CREATE TABLE ' + table('__qcsv_owner') + ' (nonce CHAR(32) PRIMARY KEY,case_hash CHAR(64)) ENGINE=InnoDB COMMENT=\'qcsv:' + plan.nonce + '\''); await sql('INSERT INTO ' + table('__qcsv_owner') + ' VALUES (?,?)', [plan.nonce, plan.caseHash]);
    await sql('CREATE TABLE ' + table('source') + ' (id BIGINT UNSIGNED PRIMARY KEY,signed_value BIGINT,amount DECIMAL(65,30),happened DATETIME(6),clock_value TIME(6),nullable_text TEXT,empty_text TEXT,slash_text TEXT,punctuation TEXT,payload BLOB,doc JSON) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT=\'qcsv:' + plan.nonce + '\'');
    await sql('CREATE TABLE ' + table('neighbor') + ' (id INT PRIMARY KEY,note VARCHAR(32)) ENGINE=InnoDB COMMENT=\'qcsv:' + plan.nonce + '\''); await sql('INSERT INTO ' + table('neighbor') + ' VALUES (7,?)', ['旁行保持']);
    for (const name of plan.tables) definitions.set(name, String((await sql('SHOW CREATE TABLE ' + table(name)))[0][0]['Create Table']));
    const sample = qcsvRows(), [seed] = await step(() => observer!.execute<any>('INSERT INTO ' + table('source') + ' VALUES ' + sample.map(() => '(' + qcsvColumns.map(() => '?').join(',') + ')').join(','), sample.flatMap(row => row.values)));
    expect(seed.affectedRows).toBe(301); expect(seed.warningStatus).toBe(0);
    const before = await rows(); expect(before.map(({ doc_hex, ...row }) => row)).toEqual(sample.map(row => row.expected));
    expect((await sql('SELECT COUNT(*) AS n FROM ' + table('source')))[0][0].n).toBe('301');
    await record('seed-verified', { rows: 301, definitions: Object.fromEntries([...definitions].map(([name, ddl]) => [name, hash(ddl)])), expectedHash: hash(JSON.stringify(before)) });

    const originalCreate = mysql.createConnection;
    const creation = vi.spyOn(mysql, 'createConnection').mockImplementation((...args) => {
      const native = originalCreate.apply(mysql, args); if (initializing) captureNative(native as unknown as Native, initializing); return native;
    }); restoreCreation = () => creation.mockRestore();
    const original = driver.connect, spying = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      await record('connection-planned', { role: connectRole }); check(); if (connectAttempts >= 3) throw Error('QCSV连接数量超限'); connectAttempts++;
      if (initializing) throw Error('QCSV初始化不得并发');
      const attempt: Initialization = { role: connectRole, natives: [], returned: false, failed: false, late: false }; initializations.push(attempt); initializing = attempt;
      try {
      const managed = await original(args[0], args[1], args[2], receipt => {
        if (attempt.receipt && attempt.receipt !== receipt) { attempt.failed = true; life.stop(); } else attempt.receipt = receipt;
        const upstream = args[3]; upstream?.(receipt);
      }); attempt.returned = true;
      if (attempt.natives.length !== 1 || attempt.receipt !== managed.resources || !attempt.receipt) throw Error('QCSV原初始化回执或native归属未知');
      const item = observeNative(managed.connection as unknown as Native, attempt.role, managed, attempt.natives[0]), close = managed.close.bind(managed); check();
      managed.close = async () => { check(); await close({ strict: true }); if (item.native.stream !== item.stream || item.stream.closed !== true) throw Error('QCSV原Engine流正常close未知'); item.normalClosed = true; };
      await record('connection-returned', { role: item.role, thread: item.thread, receipt: true }); return managed;
      } catch (reason) { attempt.failed = true; attempt.late ||= life.state.retained || !life.state.active; life.stop(); throw reason; }
      finally { if (initializing === attempt) initializing = undefined; }
    }); restoreConnect = () => spying.mockRestore();
    engine = new Engine(event => { if (event.taskId === activeTask) { try { check(); latestEvent = event; } catch { life.stop(); } } });
    await invoke('connections.open', { id: binding.profile.id }); connectRole = 'source-session';
    const opened = await invoke('sessions.open', { connectionId: binding.profile.id, database: plan.database }); sessionId = opened.sessionId;
    const sessions = owned.filter(item => item.role === 'source-session'); expect(sessions).toHaveLength(1); source = sessions[0];
    await query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION',time_zone='+00:00'");
    const identity = await query('SELECT CONNECTION_ID() AS thread,@@server_uuid AS uuid,@@version AS version'); const values = Object.values(identity.results[0].rows[0]);
    expect(Number(values[0])).toBe(source.thread); expect(values[1]).toBe(plan.serverUuid); expect(String(values[2])).toMatch(/^8\.4\.11(?:[-+]|$)/);
    const sourceFacts = (await query(emptyDefaultFactSql)).results[0];
    assertEmptyDefaultFacts(sourceFacts.rows.map((row: any) => Object.fromEntries(sourceFacts.columns.map((column: any) => [column.name, row[column.key]]))), plan.serverUuid);
    sourceSql = 'SELECT ' + qcsvColumns.map((name, index) => quote(name) + ' AS ' + quote(qcsvHeaders[index])).join(',') + ' FROM ' + table('source') + ' ORDER BY id';
    expectedStatements = ['SELECT 0 AS ' + quote(qcsvEmptyHeader) + ' WHERE 0', 'DO 0', sourceSql];
    const frames = vi.spyOn(protocol, 'consumeQueryFrames'); restoreFrames = () => frames.mockRestore();
    const connectionsBefore = connectAttempts; activeTask = randomUUID();
    const input = validateCommand('query.exportStream', { sessionId, taskId: activeTask, sql: expectedStatements.join(';'), fileToken: randomUUID(), format: scenario.format, encoding: scenario.encoding, protocol: 'text-strict', resultSelection: scenario.format === 'csv' ? { kind: 'row-result', ordinal: 2 } : { kind: 'all' }, ...(scenario.separator === 'default' ? {} : { csvDelimiter: scenario.delimiter }) });
    await record('export-planned', { task: activeTask, caseId: scenario.id, sourceThread: source.thread, sourceHash: hash(sourceSql), statements: 3 }); exporting = true;
    const output = await step(async () => { try { return await engine!.handle('query.exportStream', { ...(input as object), filePath: target }); } finally { taskSettled = true; } }); exporting = false;
    expect(connectAttempts).toBe(connectionsBefore); expect(sourceExecutions).toBe(1);
    expect(exportCommands).toEqual(expectedStatements.map(sql => ({ role: 'source-session', thread: source!.thread, method: 'query', sql })));
    if (frames.mock.calls.some(call => call[0] !== source!.managed)) throw Error('QCSV帧未绑定原managed，禁止打印连接或凭据');
    expect(frames.mock.calls.map(call => [call[1], call[2], call[3].statementOrdinal])).toEqual(expectedStatements.map((sql, index) => [sql, 'text', index + 1]));
    expect(output).toMatchObject({ statementsCompleted: 3, fileCommitted: true, transactionKnown: true, transactionOpen: false });
    expect(output.results.map((row: any) => [row.resultOrdinal, row.statementOrdinal, row.kind, row.rowResultOrdinal ?? null, row.rowsWritten])).toEqual([[1, 1, 'rows', 1, 0], [2, 2, 'status', null, 0], [3, 3, 'rows', 2, 301]]);
    expect(output.preview.results[0].rows).toHaveLength(0); expect(output.preview.results[2].rows).toHaveLength(200); expect(output.preview.results[2].truncated).toBe(true);
    expect(latestEvent?.status).toBe('completed'); expect(latestEvent?.queryExport).toMatchObject({ rowsWritten: 301, statementsCompleted: 3, fileCommitted: true });
    expect(latestEvent?.queryExport?.peakBufferedRows).toBe(1); expect(latestEvent?.queryExport?.peakBufferedBytes).toBeGreaterThan(0); expect(latestEvent?.queryExport?.peakBufferedBytes).toBeLessThanOrEqual(1024 * 1024);
    if (!published || !publication || !partialObject) throw Error('QCSV缺少原partial发布证明');
    const saved = await file(target, publication, partialObject); targetIdentity = publication; const verified = assertQcsvOutput(saved.bytes, scenario, before.map(qcsvExpectedFields));
    await noPartial(); await record('verified', { ...verified, bytes: saved.bytes.length, sourceExecutions, sourceThread: source.thread, identity: targetIdentity });
    expect(await rows()).toEqual(before); expect((await sql('SELECT id,note FROM ' + table('neighbor')))[0]).toEqual([{ id: 7, note: '旁行保持' }]);

    // 成功任务结算、同一Engine流正常关闭、精确线程后核之后，才取得本例资源删除权。
    expect(taskSettled).toBe(true); closingEngine = true; await step(() => engine!.closeAll()); expect(owned.filter(item => item.managed).every(item => item.normalClosed && item.stream.closed)).toBe(true); await record('engine-closed');
    if (initializations.length !== 2 || initializations.some(attempt => attempt.failed || !attempt.returned || attempt.receipt?.snapshot().confirmedClosed !== true)) throw Error('QCSV原driver资源终态未确认');
    await facts(); const ids = owned.filter(item => item !== observerOwner).map(item => item.thread);
    expect((await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids))[0]).toHaveLength(0);
    if (!databaseAck || !targetIdentity || !directoryId) throw Error('QCSV原创建ACK或文件身份未知');
    expect((await sql('SELECT nonce,case_hash FROM ' + table('__qcsv_owner')))[0]).toEqual([{ nonce: plan.nonce, case_hash: plan.caseHash }]);
    expect((await sql('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME', [plan.database]))[0]).toEqual([...plan.tables].sort().map(name => ({ name, kind: 'BASE TABLE', comment: 'qcsv:' + plan.nonce })));
    for (const name of plan.tables) expect(String((await sql('SHOW CREATE TABLE ' + table(name)))[0][0]['Create Table'])).toBe(definitions.get(name));
    for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect((await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]))[0]).toHaveLength(0);
    expect(await rows()).toEqual(before); expect((await sql('SELECT id,note FROM ' + table('neighbor')))[0]).toEqual([{ id: 7, note: '旁行保持' }]);
    await noPartial(); await file(target, targetIdentity); await record('cleanup-verified', { schema: plan.database, directoryId, identity: targetIdentity, absentThreads: ids }); await step(() => actualFs.unlink(target));
    try { await actualFs.lstat(target); throw Error('QCSV原目标文件仍残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
    await record('target-removed');
    await sql('DROP DATABASE ' + quote(plan.database)); expect((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]))[0]).toHaveLength(0);
    await record('database-removed');
    await step(async () => { await driver.closeMysqlConnection(observerOwner!.native, true); if (observerOwner!.native.stream !== observerOwner!.stream || observerOwner!.stream.closed !== true) throw Error('QCSV原observer流正常close未知'); observerOwner!.normalClosed = true; });
    expect(owned.every(item => item.normalClosed && item.stream.closed)).toBe(true);
    const finalDir = await step(() => actualFs.lstat(directory)); if (!finalDir.isDirectory() || finalDir.isSymbolicLink() || String(finalDir.dev) + ':' + String(finalDir.ino) !== directoryId || (await step(() => actualFs.readdir(directory))).length) throw Error('QCSV原目录身份或残留未知');
    await step(() => actualFs.rmdir(directory));
    try { await actualFs.lstat(directory); throw Error('QCSV原目录仍残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
    await record('cleaned'); io.beforeOpen = io.afterOpen = io.beforeRename = io.afterRename = io.beforeRemove = undefined; restoreFrames(); restoreConnect(); restoreCreation(); life.finish(); complete = true; halted = false;
  } catch (reason) { life.stop(); throw reason; }
  finally {
    // 失败只留有界归属附录：绝不补发cancel/close/DROP、重连、重放或递归删旧目录。
    console.log(JSON.stringify({ QCSV: plan.caseId, complete, nonce: plan.nonce, schema: plan.database, directory, target, journal, partials: [...partials].map(value => basename(value)), partialObject, publication, published, connections: owned.map(item => ({ role: item.role, thread: item.thread, observedThread: item.native.threadId ?? 0, normalClosed: item.normalClosed, streamClosed: item.stream?.closed === true })), initializations: initializations.map(initializationEvidence), retained: !complete, rows: 301, sourceExecutions, exportCommands: exportCommands.length, taskSettled }));
    life.end(); if (!complete) halted = true;
  }
}
