import { randomUUID, createHash } from 'node:crypto';
import { resolve, join, dirname, basename } from 'node:path';
import * as fs from 'node:fs/promises';
import mysql from 'mysql2';
import type { Connection as NativeConnection } from 'mysql2';
import type { Connection as Observer, RowDataPacket } from 'mysql2/promise';
import { expect, vi, type TestContext } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TaskEvent } from '../../src/shared/contracts';
import type { QueryInsertPending } from '../../src/shared/queryInsertExport';
import type { QueryStreamExportOutput } from '../../src/shared/queryStreamExport';
import { validateCommand } from '../../src/shared/validation';
import { emptyDefaultFactSql, assertEmptyDefaultFacts } from '../helpers/tableCreateEmptyDefault';
import { bindQisTarget, qisColumns, qisLifetime, qisPlan, qisRows, qisUsingHandle, type QisCase } from '../helpers/queryInsertIntegration';

// 仅提前登记引擎实际选出的partial路径，所有参数/句柄/错误仍原样交付；不替换写入或提交。
const io = vi.hoisted(() => ({ beforeOpen: undefined as undefined | ((path: unknown) => Promise<void>) }));
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => { await io.beforeOpen?.(args[0]); return actual.open(...args); } };
});
let halted = false;
type Native = NativeConnection & { stream: { closed?: boolean; remoteAddress?: string; remotePort?: number } };
type Owned = { role: string; native: Native; stream: Native['stream']; thread: number; normalClosed: boolean; managed?: ManagedConnection };
type FileIdentity = { dev: string; ino: string; size: number; hash: string };
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';

/** 只在明确开启后的原120秒任务内执行；本片提交期间没有调用此函数。 */
export async function runQisCase(context: TestContext, kind: QisCase) {
  if (halted) throw Error('QIS前例未可信完成，后续用例保留不继续');
  halted = true; // 准入阶段失败也不能落回下一case；仅完整成功后重新放行。
  const plan = qisPlan(kind, randomUUID().replaceAll('-', ''), hash(context.task.id)), binding = bindQisTarget(() => process.env, 'qis-' + plan.nonce);
  const life = qisLifetime(context, binding, () => { halted = true; });
  context.onTestFinished(() => life.end());
  const root = resolve(__dirname, '../..');
  if (resolve(process.cwd()) !== root || root.length > 1024) throw Error('QIS必须在本次明确且有界的clone路径内执行');
  const journal = join(root, '.cache', 'qis-' + plan.nonce + '.ownership.ndjson'), directory = join(root, '.cache', plan.directory), target = join(directory, plan.file);
  const actualFs = await vi.importActual<typeof fs>('node:fs/promises'); life.check();
  const owned: Owned[] = [], partials = new Set<string>(), records: object[] = [], definitions = new Map<string, string>();
  const oldBytes = Buffer.from('DBArk-QIS-old:' + plan.nonce, 'ascii');
  let engine: Engine | undefined, observer: Observer | undefined, observerOwner: Owned | undefined, source: Owned | undefined, sessionId = '', sourceClosed = false, closingEngine = false, databaseAck = false, complete = false;
  let journalBytes = 0, journalId = '', sourceSql = '', sourceExecutions = 0, nativeCommands = 0, connectAttempts = 0, connectRole = 'engine-control';
  let targetIdentity: FileIdentity | undefined, directoryId = '';
  let active: { id: string; event?: TaskEvent; pending?: QueryInsertPending; settled: boolean; outcome?: { ok: true; value: QueryStreamExportOutput } | { ok: false; error: unknown }; done: Promise<void>; ready: Promise<QueryInsertPending>; publish(value: QueryInsertPending): void; fail(error: unknown): void } | undefined;

  /** 同一原任务和原物理流；只允许已声明的关闭阶段消费closed，不凭同thread号码替换流。 */
  function check() {
    life.check();
    for (const item of owned) {
      if (item.native.stream !== item.stream || item.native.threadId !== item.thread || item.managed && (item.managed.connection !== item.native || item.managed.profile !== binding.profile || item.managed.broken && !item.normalClosed)) { life.stop(); throw Error('QIS原物理流或连接身份变化'); }
      if (item.stream.closed && !item.normalClosed) { life.stop(); throw Error('QIS原物理流未确认正常退出'); }
    }
    if (source?.normalClosed && !sourceClosed && !closingEngine) { life.stop(); throw Error('QIS原会话提前关闭'); }
  }
  const step = <T>(action: () => Promise<T>) => life.step(async () => { check(); const value = await action(); check(); return value; });
  /** 每条有界元数据追加都fsync并核原文件，凭据/SQL/样例/令牌不进入journal。 */
  async function record(stage: string, detail: object = {}) {
    check(); if (records.length >= 48) throw Error('QIS登记条数超限');
    const entry = { seq: records.length + 1, stage, ...detail }, bytes = Buffer.from(JSON.stringify(entry) + '\n'); if (journalBytes + bytes.length > 32768) throw Error('QIS登记字节超限');
    const handle = await actualFs.open(journal, records.length ? 'a' : 'wx', 0o600);
    await qisUsingHandle(handle, async () => {
      check(); const stat = await handle.stat(); check(); const identity = String(stat.dev) + ':' + String(stat.ino);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== journalBytes || journalId && journalId !== identity) throw Error('QIS登记原文件变化');
      journalId = identity; await handle.writeFile(bytes); check(); await handle.sync(); check();
    });
    check(); const stat = await actualFs.lstat(journal); check(); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || String(stat.dev) + ':' + String(stat.ino) !== journalId || stat.size !== journalBytes + bytes.length) throw Error('QIS登记路径变化');
    journalBytes += bytes.length; records.push(entry);
  }
  /** 仅记录命令数；透传原方法与所有参数，不修改SQL、类型解码或驱动回包。 */
  function observeNative(native: Native, role: string, managed?: ManagedConnection, acquired?: Owned) {
    const item: Owned = acquired ?? { role, native, stream: native.stream, thread: native.threadId!, normalClosed: false, managed };
    if (acquired) item.thread = native.threadId!; else owned.push(item);
    if (!item.stream || !Number.isSafeInteger(item.thread) || item.thread <= 0 || !['192.168.31.200', '::ffff:192.168.31.200'].includes(item.stream.remoteAddress ?? '') || item.stream.remotePort !== 13384) throw Error('QIS原连接线程或准确peer未知');
    if (owned.some(other => other !== item && other.thread === item.thread)) throw Error('QIS不同连接复用了未知线程身份');
    for (const method of ['query', 'execute'] as const) {
      const original = native[method];
      (native as any)[method] = function (...args: any[]) { nativeCommands++; const sql = typeof args[0] === 'string' ? args[0] : args[0]?.sql; if (sql === sourceSql && sourceSql) sourceExecutions++; return (original as any).apply(this, args); };
    }
    return item;
  }
  /** 每条独立驱动连接写前登记用途，返回后立即记下原句柄；失败不另开恢复连接。 */
  async function raw(role: string, multi = false): Promise<{ owner: Owned; connection: Observer }> {
    await record('connection-planned', { role }); check(); if (connectAttempts >= 8) throw Error('QIS连接数量超限'); connectAttempts++;
    // 独立观察/回放连接关闭mysql2默认IGNORE_SPACE握手位，保留严格只读事实门，不修改服务器配置。
    const native = mysql.createConnection({ host: binding.profile.host, port: 13384, user: binding.profile.user, password: binding.profile.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, multipleStatements: multi, flags: ['-IGNORE_SPACE'], connectTimeout: 10000 }) as unknown as Native;
    // 建连成功前仍保留原流线索，最终失败附录记录其真实thread（若已返回），不尝试强退。
    const acquired: Owned = { role, native, stream: native.stream, thread: native.threadId ?? 0, normalClosed: false }; owned.push(acquired);
    native.on('error', () => life.stop());
    const connection = native.promise();
    await new Promise<void>((yes, no) => native.connect(error => error ? no(error) : yes()));
    const owner = observeNative(native, role, undefined, acquired); check(); await record('connection-returned', { role, thread: owner.thread });
    return { owner, connection };
  }
  async function closeRaw(item: Owned) { check(); await driver.closeMysqlConnection(item.native, true); if (item.native.stream !== item.stream || item.stream.closed !== true) throw Error('QIS独立原流正常close未知'); item.normalClosed = true; check(); }
  /** 每条连接建库/回放前读准确版本及UUID；不通过修改服务器配置补能力。 */
  async function facts(connection: Observer) { const [rows] = await step(() => connection.query<RowDataPacket[]>(emptyDefaultFactSql)); assertEmptyDefaultFacts(rows, 'f568f70e-c730-11f1-8190-3e6c830dde01'); }
  const table = (name: string) => quote(plan.database) + '.' + quote(name);
  async function sql(text: string, params?: unknown[]) { return step(() => observer!.query<any>(text, params)); }
  /** 每次文件读取前后均核原路径和inode；本片不提供跨进程路径CAS承诺。 */
  async function file(path: string, expected?: FileIdentity): Promise<{ bytes: Buffer; identity: FileIdentity }> {
    check(); const before = await actualFs.lstat(path); check(); const canonical = await actualFs.realpath(path); check();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 2 * 1024 * 1024 || canonical !== resolve(path)) throw Error('QIS文件类型、大小或规范路径未知');
    const bytes = await actualFs.readFile(path); check(); const canonicalAfter = await actualFs.realpath(path); check(); const after = await actualFs.lstat(path); check();
    const identity = { dev: String(after.dev), ino: String(after.ino), size: after.size, hash: hash(bytes) };
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1 || canonicalAfter !== resolve(path) || after.dev !== before.dev || after.ino !== before.ino || after.size !== bytes.length || expected && JSON.stringify(identity) !== JSON.stringify(expected)) throw Error('QIS原文件身份或字节变化');
    return { bytes, identity };
  }
  async function noPartial() { const names = await step(() => actualFs.readdir(directory)); expect(names).toEqual([plan.file]); for (const path of partials) { try { await actualFs.lstat(path); throw Error('QIS原partial仍残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; } } }
  async function invoke(command: string, input: any) { check(); const valid = validateCommand(command, command === 'connections.open' ? { id: input.id } : input); return step(() => engine!.handle(command as any, command === 'query.exportStream' ? { ...(valid as object), filePath: target } : command === 'connections.open' ? { ...(valid as object), profile: binding.profile } : valid as any)); }
  /** 预期的公共拒绝在原step内部结算，不把已验证的负例当成夹具失效后继续清理。 */
  async function refusedConfirmation(input: object) { await step(async () => { const valid = validateCommand('query.confirmInsertExport', input); await expect(engine!.handle('query.confirmInsertExport', valid as any)).rejects.toThrow(); }); }
  async function query(text: string) { return invoke('query.execute', { sessionId, taskId: randomUUID(), sql: text, maxRows: 10 }); }
  /** 后台公开命令只注入本例路径；不冒充Main令牌/原生文件选择器验收。 */
  function begin(text: string, encoding: 'utf8' | 'utf16le' | 'gb18030') {
    check(); if (active && !active.settled) throw Error('QIS前导出尚未结算');
    let publish!: (value: QueryInsertPending) => void, fail!: (reason: unknown) => void;
    const ready = new Promise<QueryInsertPending>((yes, no) => { publish = yes; fail = no; }); void ready.catch(() => undefined);
    const id = randomUUID(), entry = { id, settled: false, ready, publish, fail, done: undefined! as Promise<void>, outcome: undefined as undefined | { ok: true; value: QueryStreamExportOutput } | { ok: false; error: unknown }, pending: undefined as QueryInsertPending | undefined, event: undefined as TaskEvent | undefined };
    active = entry;
    const input = validateCommand('query.exportStream', { sessionId, taskId: id, sql: text, fileToken: randomUUID(), format: 'sql', encoding, protocol: 'text-strict', resultSelection: { kind: 'all' }, insertTarget: { database: plan.database, table: 'target', columns: [...qisColumns] } });
    const running = engine!.handle('query.exportStream', { ...(input as object), filePath: target });
    entry.done = running.then(value => { entry.settled = true; entry.outcome = { ok: true, value }; if (!entry.pending) fail(Error('QIS未产生待确认样例')); }, error => { entry.settled = true; entry.outcome = { ok: false, error }; fail(error); });
    return entry;
  }
  function taskEvent(event: TaskEvent) {
    const entry = active; if (!entry || event.taskId !== entry.id) return;
    try { check(); entry.event = event; if (event.queryInsert) { if (entry.pending || event.queryInsert.sql.length > 4 * 1024 * 1024) throw Error('QIS待确认事件重复或超限'); entry.pending = event.queryInsert; entry.publish(event.queryInsert); } }
    catch { life.stop(); }
  }
  /** 独立CAST/HEX投影覆盖数字、时间、SQL NULL/空串/文字NULL及JSON原字节。 */
  async function rows(name: string) {
    const [value] = await sql('SELECT CAST(id AS CHAR) AS id,CAST(signed_value AS CHAR) AS signed_value,CAST(amount AS CHAR) AS amount,DATE_FORMAT(happened,\'%Y-%m-%d %H:%i:%s.%f\') AS happened,CAST(clock_value AS CHAR) AS clock_value,nullable_text,HEX(note) AS note_hex,HEX(payload) AS payload_hex,JSON_TYPE(doc) AS doc_kind,JSON_UNQUOTE(JSON_EXTRACT(doc,\'$.n\')) AS doc_n,HEX(CAST(doc AS CHAR CHARACTER SET utf8mb4)) AS doc_hex FROM ' + table(name) + ' ORDER BY id'); return value as Record<string, unknown>[];
  }
  let restoreConnect: (() => void) | undefined;
  try {
    check(); const cache = await actualFs.lstat(join(root, '.cache')); check(); const cachePath = await actualFs.realpath(join(root, '.cache')); check(); if (!cache.isDirectory() || cache.isSymbolicLink() || cachePath !== join(root, '.cache')) throw Error('QIS既有证据父目录未知');
    await record('planned', { ...plan, runNonce: binding.runNonce, directory, target, partialRule: plan.file + '.dbark-<UUID>.partial' });
    const first = await raw('observer'); observer = first.connection; observerOwner = first.owner; await facts(observer);
    await step(() => actualFs.mkdir(directory)); const dir = await step(() => actualFs.lstat(directory)); const real = await step(() => actualFs.realpath(directory));
    if (!dir.isDirectory() || dir.isSymbolicLink() || real !== directory) throw Error('QIS原目录未知'); directoryId = String(dir.dev) + ':' + String(dir.ino); await record('directory-created');
    const handle = await actualFs.open(target, 'wx', 0o600); await qisUsingHandle(handle, async () => { check(); await handle.writeFile(oldBytes); check(); await handle.sync(); check(); }); const initialTarget = await file(target); expect(initialTarget.bytes).toEqual(oldBytes); targetIdentity = initialTarget.identity;
    io.beforeOpen = async path => {
      check(); if (typeof path !== 'string' || dirname(resolve(path)) !== directory || !basename(path).startsWith(plan.file + '.dbark-') || !/\.dbark-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/.test(path)) throw Error('QIS引擎尝试未登记范围的文件创建');
      if (partials.size >= 1 || partials.has(path)) throw Error('QIS单次执行出现第二份partial');
      await record('partial-planned', { name: basename(path) }); partials.add(path);
    };
    await facts(observer); expect((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]))[0]).toHaveLength(0);
    const [created] = await sql('CREATE DATABASE ' + quote(plan.database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); expect(created.affectedRows).toBe(1); databaseAck = true; await record('database-created');
    await sql('CREATE TABLE ' + table('__qis_owner') + ' (nonce CHAR(32) PRIMARY KEY,case_hash CHAR(64)) ENGINE=InnoDB COMMENT=\'qis:' + plan.nonce + '\''); await sql('INSERT INTO ' + table('__qis_owner') + ' VALUES (?,?)', [plan.nonce, plan.caseHash]);
    const columns = '(id BIGINT UNSIGNED PRIMARY KEY,signed_value BIGINT,amount DECIMAL(65,30),happened DATETIME(6),clock_value TIME(6),nullable_text TEXT,note TEXT,payload BLOB,doc JSON) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT=\'qis:' + plan.nonce + '\'';
    for (const name of ['source', 'target']) await sql('CREATE TABLE ' + table(name) + ' ' + columns);
    await sql('CREATE TABLE ' + table('neighbor') + ' (id INT PRIMARY KEY,note VARCHAR(32)) ENGINE=InnoDB COMMENT=\'qis:' + plan.nonce + '\''); await sql('INSERT INTO ' + table('neighbor') + ' VALUES (7,?)', ['旁行保持']);
    for (const name of plan.tables) definitions.set(name, String((await sql('SHOW CREATE TABLE ' + table(name)))[0][0]['Create Table']));
    const sample = qisRows(), [seed] = await step(() => observer!.execute<any>('INSERT INTO ' + table('source') + ' VALUES ' + sample.map(() => '(' + qisColumns.map(() => '?').join(',') + ')').join(','), sample.flatMap(row => row.values)));
    expect(seed.affectedRows).toBe(301); expect(seed.warningStatus).toBe(0);
    const before = await rows('source'); expect(before.map(({ doc_hex, ...value }) => value)).toEqual(sample.map(row => row.expected));
    const original = driver.connect;
    const spying = vi.spyOn(driver, 'connect').mockImplementation(async (...args) => {
      await record('connection-planned', { role: connectRole }); check(); if (connectAttempts >= 8) throw Error('QIS连接数量超限'); connectAttempts++;
      const managed = await original(...args), item = observeNative(managed.connection as unknown as Native, connectRole, managed), close = managed.close.bind(managed);
      managed.close = async () => { check(); await close({ strict: true }); if (item.native.stream !== item.stream || item.stream.closed !== true) throw Error('QIS原Engine流正常close未知'); item.normalClosed = true; };
      await record('connection-returned', { role: item.role, thread: item.thread }); return managed;
    }); restoreConnect = () => spying.mockRestore();
    engine = new Engine(taskEvent); connectRole = 'engine-initial'; await invoke('connections.open', { id: binding.profile.id });
    connectRole = 'source-session'; const opened = await invoke('sessions.open', { connectionId: binding.profile.id, database: plan.database }); sessionId = opened.sessionId;
    const sessions = owned.filter(item => item.role === 'source-session'); expect(sessions).toHaveLength(1); source = sessions[0]; connectRole = 'engine-control';
    await query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION',time_zone='+00:00'");
    const identity = await query('SELECT CONNECTION_ID() AS thread,@@server_uuid AS uuid,@@version AS version'), identityValues = Object.values(identity.results[0].rows[0]); expect(Number(identityValues[0])).toBe(source.thread); expect(identityValues[1]).toBe(plan.serverUuid); expect(String(identityValues[2])).toMatch(/^8\.4\.11(?:[-+]|$)/);
    sourceSql = 'SELECT ' + qisColumns.map(quote).join(',') + ' FROM ' + table('source') + ' ORDER BY id';
    const encoding = kind === 'utf16le' || kind === 'gb18030' ? kind : 'utf8';
    const running = begin(kind === 'multi-result' ? sourceSql + ';SELECT 2 AS extra_result' : sourceSql, encoding);
    if (kind === 'multi-result') {
      await step(() => running.done); expect(running.outcome?.ok).toBe(false); expect(running.pending).toBeUndefined(); expect(running.event?.status).toBe('failed'); expect(running.event?.queryExport?.fileCommitted).toBe(false); await file(target, targetIdentity); await noPartial();
    } else {
      const pending = await step(() => running.ready); expect(running.settled).toBe(false); expect(pending).toMatchObject({ totalRows: 301, shownRows: 20, encoding, target: { database: plan.database, table: 'target', columns: [...qisColumns] } });
      // COUNT为BIGINT，独立连接显式bigNumberStrings=true，应精确核字符串而非改驱动解码。
      expect(running.event?.queryExport?.phase).toBe('awaiting-confirmation'); expect(sourceExecutions).toBe(1); await file(target, targetIdentity); expect((await sql('SELECT COUNT(*) AS n FROM ' + table('target')))[0][0].n).toBe('0');
      expect(partials.size).toBe(1); const staged = await file([...partials][0]); expect(staged.bytes.length).toBe(pending.bytes);
      const text = new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding === 'utf16le' ? 'utf-16le' : 'gb18030', { fatal: true }).decode(staged.bytes);
      expect(text.startsWith(pending.sql)).toBe(true); expect((text.match(/^INSERT INTO /gm) ?? []).length).toBe(301); expect((pending.sql.match(/^INSERT INTO /gm) ?? []).length).toBe(20); if (encoding === 'utf16le') expect([...staged.bytes.subarray(0, 2)]).toEqual([255, 254]);
      await record('staged', { totalRows: pending.totalRows, shownRows: pending.shownRows, bytes: pending.bytes, encoding });
      const commands = nativeCommands, connections = connectAttempts;
      if (kind === 'cancel' || kind === 'session-close') {
        if (kind === 'cancel') await invoke('query.cancel', { taskId: running.id });
        else { sourceClosed = true; await invoke('sessions.close', { sessionId }); expect(source.normalClosed).toBe(true); }
        await step(() => running.done); expect(running.outcome?.ok).toBe(false); expect(running.event?.status).toBe('cancelled'); expect(running.event?.queryExport).toMatchObject({ phase: 'awaiting-confirmation', rowsWritten: 301, statementsCompleted: 1, fileCommitted: false }); expect(nativeCommands).toBe(commands); expect(connectAttempts).toBe(connections); await file(target, targetIdentity); await noPartial();
        await refusedConfirmation({ taskId: running.id, previewToken: pending.previewToken, confirmation: plan.database + '.target', acknowledged: true });
        expect(nativeCommands).toBe(commands); expect(connectAttempts).toBe(connections);
      } else {
        await invoke('query.confirmInsertExport', { taskId: running.id, previewToken: pending.previewToken, confirmation: plan.database + '.target', acknowledged: true }); await step(() => running.done);
        expect(running.outcome?.ok).toBe(true); expect(nativeCommands).toBe(commands); expect(connectAttempts).toBe(connections); expect(sourceExecutions).toBe(1);
        if (!running.outcome?.ok) throw Error('QIS导出未知'); expect(running.outcome.value).toMatchObject({ statementsCompleted: 1, fileCommitted: true }); expect(running.outcome.value.preview.results[0].rows).toHaveLength(200); expect(running.outcome.value.preview.results[0].truncated).toBe(true);
        await refusedConfirmation({ taskId: running.id, previewToken: pending.previewToken, confirmation: plan.database + '.target', acknowledged: true }); expect(nativeCommands).toBe(commands); expect(connectAttempts).toBe(connections);
        targetIdentity = staged.identity; expect((await file(target, targetIdentity)).bytes).toEqual(staged.bytes); await noPartial(); expect((await sql('SELECT COUNT(*) AS n FROM ' + table('target')))[0][0].n).toBe('0');
        for (const mode of ['', ',NO_BACKSLASH_ESCAPES']) {
          const replay = await raw('replay-' + (mode ? 'nbe' : 'normal'), true); await facts(replay.connection);
          await step(() => replay.connection.query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION" + mode + "',time_zone='+00:00'"));
          const [actualMode] = await step(() => replay.connection.query<RowDataPacket[]>('SELECT @@SESSION.sql_mode AS mode,CONNECTION_ID() AS thread')); expect(new Set(String(actualMode[0].mode).split(','))).toEqual(new Set(('STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION' + mode).split(','))); expect(Number(actualMode[0].thread)).toBe(replay.owner.thread); expect(replay.owner.thread).not.toBe(source!.thread);
          const [ack] = await step(() => replay.connection.query<any>(text)); expect(ack).toHaveLength(301); expect(ack.every((row: any) => row.affectedRows === 1 && row.warningStatus === 0)).toBe(true);
          expect(await rows('target')).toEqual(before); expect(await rows('source')).toEqual(before); await closeRaw(replay.owner);
          if (!mode) { const [deleted] = await sql('DELETE FROM ' + table('target')); expect(deleted.affectedRows).toBe(301); }
        }
      }
      expect(sourceExecutions).toBe(1);
    }
    expect(sourceExecutions).toBe(1); expect((await sql('SELECT id,note FROM ' + table('neighbor')))[0]).toEqual([{ id: 7, note: '旁行保持' }]); expect(await rows('source')).toEqual(before);
    // 所有任务已结算，正常关闭原Engine/原物理流后才核资源并取得精确删除权。
    expect(active?.settled).toBe(true); closingEngine = true; await step(() => engine!.closeAll()); expect(owned.filter(item => item.managed).every(item => item.normalClosed && item.stream.closed)).toBe(true); await record('engine-closed');
    await facts(observer); const ids = owned.filter(item => item !== observerOwner).map(item => item.thread);
    if (ids.length) expect((await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids))[0]).toHaveLength(0);
    if (!databaseAck || !targetIdentity || !directoryId) throw Error('QIS建库ACK或原文件/目录身份未知'); expect((await sql('SELECT nonce,case_hash FROM ' + table('__qis_owner')))[0]).toEqual([{ nonce: plan.nonce, case_hash: plan.caseHash }]);
    const [tables] = await sql('SELECT TABLE_NAME AS name,TABLE_TYPE AS kind,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY TABLE_NAME', [plan.database]);
    expect(tables).toEqual([...plan.tables].sort().map(name => ({ name, kind: 'BASE TABLE', comment: 'qis:' + plan.nonce })));
    for (const name of plan.tables) expect(String((await sql('SHOW CREATE TABLE ' + table(name)))[0][0]['Create Table'])).toBe(definitions.get(name));
    for (const [view, column] of [['TRIGGERS', 'TRIGGER_SCHEMA'], ['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA']]) expect((await sql('SELECT 1 FROM information_schema.' + view + ' WHERE BINARY ' + column + '=BINARY ? LIMIT 1', [plan.database]))[0]).toHaveLength(0);
    await noPartial(); await file(target, targetIdentity); await step(() => actualFs.unlink(target));
    try { await actualFs.lstat(target); throw Error('QIS目标文件仍残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
    await sql('DROP DATABASE ' + quote(plan.database)); expect((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?', [plan.database]))[0]).toHaveLength(0);
    await closeRaw(observerOwner!); expect(owned.every(item => item.normalClosed && item.stream.closed)).toBe(true);
    const finalDir = await step(() => actualFs.lstat(directory)); if (!finalDir.isDirectory() || finalDir.isSymbolicLink() || String(finalDir.dev) + ':' + String(finalDir.ino) !== directoryId || (await step(() => actualFs.readdir(directory))).length) throw Error('QIS原目录身份或残留未知');
    await step(() => actualFs.rmdir(directory)); try { await actualFs.lstat(directory); throw Error('QIS原目录仍残留'); } catch (reason) { check(); if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
    await record('cleaned'); io.beforeOpen = undefined; restoreConnect(); restoreConnect = undefined; life.finish(); complete = true; halted = false;
  } catch (reason) { life.stop(); throw reason; }
  finally {
    // 失败只留有界身份附录，不补发cancel/close/DROP或扩大文件删除。原后台Promise已有结算观察。
    console.log(JSON.stringify({ QIS: plan.kind, complete, nonce: plan.nonce, schema: plan.database, directory, target, journal, partials: [...partials].map(value => basename(value)), connections: owned.map(item => ({ role: item.role, thread: item.native.threadId ?? item.thread, normalClosed: item.normalClosed, streamClosed: item.stream?.closed === true })), retained: !complete, rows: 301, sourceExecutions }));
    life.end(); if (!complete) halted = true;
  }
}
