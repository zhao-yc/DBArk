import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { promisify } from 'node:util';
import { it, vi } from 'vitest';
import { Engine } from '../../src/engine';
import * as driver from '../../src/engine/connection';
import { execute, type ManagedConnection } from '../../src/engine/connection';
import { identifier } from '../../src/engine/sql';
import type { ConnectionProfile, QueryOutcome, TaskEvent } from '../../src/shared/contracts';
import { queryStreamExportLimits as limits, type QueryStreamExportOutput } from '../../src/shared/queryStreamExport';

const enabled = process.env.DBARK_Q05_MILLION_ARCHIVE_ENABLED === '1' && Boolean(process.env.DBARK_Q05_MANUAL_OWNER) && process.env.DBARK_Q05_MANUAL_OWNER === process.env.DBARK_Q05_IDENTITY_CHECKED;
type Measurement = { scenario: string; events: number; startedAt: string; latest?: Pick<TaskEvent, 'status' | 'queryExport'>; peakRss: number; peakHeap: number; durationMs?: number; error?: unknown };

/** 此文件不匹配默认unit/integration/E2E模式，只由专用脚本生成的配置发现。 */
it.skipIf(!enabled)('手动Q05真实百万行CSV ZIP：一次查询任务、多行集/状态、取消、失败及所有权清理', async () => {
  const root = resolve(import.meta.dirname, '../..'), directory = resolve(process.env.DBARK_Q05_MANUAL_DIRECTORY ?? '');
  const owner = process.env.DBARK_Q05_MANUAL_OWNER!, python = process.env.DBARK_Q05_PYTHON!;
  assert.equal(dirname(directory), join(root, '.cache', 'q05-million-archive')); assert.match(basename(directory), /^dbark-q05-million-[A-Za-z0-9]+$/);
  assert.equal((await realpath(directory)).toLowerCase(), directory.toLowerCase());
  const markerPath = join(directory, 'owner.json'); assert.equal((await lstat(markerPath)).isSymbolicLink(), false); assert.ok((await stat(markerPath)).size < 32768);
  const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { owner: string; database: string; sha: string; sources: Record<string, string> };
  assert.equal(marker.owner, owner); assert.match(owner, /^[0-9a-f-]{36}$/); assert.match(marker.database, /^dbark_stream_\d+_[0-9a-f]{8}$/);
  for (const [path, hash] of Object.entries(marker.sources)) { assert.match(path, /^src\/(?:engine|shared)\/[A-Za-z]+\.ts$/); assert.equal(createHash('sha256').update(await readFile(join(root, path))).digest('hex'), hash, '启动后产品源码发生变化'); }
  const database = marker.database, identity = JSON.parse(await readFile(join(directory, 'server-identity.json'), 'utf8'));
  assert.equal(identity.owner, owner); assert.equal(identity.alias, 'server-200'); assert.ok(identity.addresses.includes('192.168.31.200')); assert.equal(identity.port, Number(process.env.DBARK_TEST_PORT));
  assert.equal(process.env.DBARK_TEST_HOST, '192.168.31.200'); assert.ok(Number.isInteger(identity.port) && identity.port > 0 && identity.port <= 65535);
  assert.ok(process.env.DBARK_TEST_USER && process.env.DBARK_TEST_PASSWORD !== undefined); assert.ok(python);
  const profile: ConnectionProfile = { id: randomUUID(), name: 'Q05手动百万行隔离验收', group: '测试', color: '#53c9ae', dialect: 'mysql', host: '192.168.31.200', port: identity.port, user: process.env.DBARK_TEST_USER!, password: process.env.DBARK_TEST_PASSWORD!, ...(process.env.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: process.env.DBARK_TEST_CA } } : {}) };
  const measurements = new Map<string, Measurement>(), threads = new Set<number>(), failures: unknown[] = [];
  const evidence: Record<string, unknown> = { scope: '真实Engine/原驱动/原ZIP writer手动验收；不含GUI、安装包或4GiB证明', baseline: '82e07a0788c78ea3e68df397fabb4820deb82587', source: marker, database, serverIdentity: identity, limits, startedAt: new Date().toISOString() };
  let observer: ManagedConnection | undefined, sessionId = '', sessionThread = 0, created = false, databaseAttempted = false, cancelId = '', cancellation: Promise<void> | undefined;
  /** 只记录有界摘要；不能因取证自己缓存全部事件、行数据或百万个对象。 */
  const engine = new Engine(event => {
    const item = measurements.get(event.taskId); if (!item) return;
    const memory = process.memoryUsage(); item.events++; item.latest = { status: event.status, queryExport: event.queryExport }; item.peakRss = Math.max(item.peakRss, memory.rss); item.peakHeap = Math.max(item.peakHeap, memory.heapUsed);
    if (event.taskId === cancelId && !cancellation && event.status === 'running' && (event.queryExport?.rowsWritten ?? 0) >= 256 && (event.queryExport?.bytesWritten ?? 0) >= 65536) {
      cancellation = (async () => {
        let observationError: unknown;
        try { const active = await observed('SELECT ID,COMMAND,INFO FROM information_schema.PROCESSLIST WHERE ID=?', [sessionThread]); assert.equal(active.length, 1); assert.notEqual(active[0].COMMAND, 'Sleep'); assert.ok(String(active[0].INFO).includes('SLEEP(0.001)')); evidence.cancelObservedActive = { threadId: sessionThread, rowsWritten: event.queryExport?.rowsWritten, bytesWritten: event.queryExport?.bytesWritten }; }
        catch (error) { observationError = error; }
        // 观察断言失败也必须真实取消，不能留下耗时查询等待测试超时。
        try { await engine.handle('query.cancel', { taskId: cancelId }); }
        catch (closing) { if (observationError) throw new AggregateError([observationError, closing], '取消观察和真实取消均失败', { cause: observationError }); throw closing; }
        if (observationError) throw observationError;
      })();
      void cancellation.catch(() => undefined);
    }
  });
  const actualConnect = driver.connect;
  // 仅透传旁观成功返回的真实ManagedConnection；不改入参、返回对象、驱动行流、writer或CRC。
  const recording = vi.spyOn(driver, 'connect').mockImplementation(async (...args: Parameters<typeof actualConnect>) => {
    const managed = await actualConnect(...args);
    try { const id = managed.connection.threadId; assert.ok(Number.isSafeInteger(id) && id! > 0); threads.add(id!); assert.ok(threads.size <= 64); return managed; }
    catch (error) { try { await managed.close({ strict: true }); } catch (closing) { throw new AggregateError([error, closing], '真实连接取证及关闭均失败', { cause: error }); } throw error; }
  });

  /** 普通参数化查询只用于本例准备、观察与清理，导出SQL绝不经此端口重放。 */
  async function observed(sql: string, values: (string | number)[] = []): Promise<Record<string, unknown>[]> { assert.ok(observer); const [rows] = await observer.connection.promise().query({ sql, values, timeout: 5000 }); return rows as Record<string, unknown>[]; }
  /** 会话内诊断使用普通查询，不读取或拼接导出文件里的结果。 */
  async function query(sql: string): Promise<QueryOutcome> { return engine.handle('query.execute', { sessionId, sql, taskId: randomUUID(), maxRows: 10 }); }
  /** 按真实位置取一行诊断字段，避开重复列名的对象键猜测。 */
  function values(result: QueryOutcome): unknown[] { return Object.values(result.results.find(item => item.rows.length)!.rows[0]); }
  /** 轮询只读可观察状态；不重试CREATE、写入、导出或KILL。 */
  async function until(condition: () => Promise<boolean>, timeout = 10000) { const end = Date.now() + timeout; do { if (await condition()) return; await pause(50); } while (Date.now() < end); throw new Error('真实服务器状态未在期限内收尾'); }
  /** 只检查本例随机目录，绝不扫描或删除其他导出任务的partial。 */
  async function partials() { return (await readdir(directory)).filter(name => name.endsWith('.partial')); }
  /** 每个场景恰好一次query.exportStream，失败返回原异常，调用方检查预期终态。 */
  async function exportOnce(scenario: string, sql: string, filePath: string, cancelling = false) {
    const taskId = randomUUID(), start = Date.now(); measurements.set(taskId, { scenario, events: 0, startedAt: new Date().toISOString(), peakRss: 0, peakHeap: 0 }); if (cancelling) cancelId = taskId;
    let watchdog: Promise<unknown> | undefined, watchdogError: unknown, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; watchdog = engine.handle('query.cancel', { taskId }).catch(error => { watchdogError = error; }); }, cancelling ? 40000 : 300000);
    let result: { ok: true; value: QueryStreamExportOutput } | { ok: false; error: unknown };
    try { result = await (engine.handle('query.exportStream', { sessionId, sql, taskId, fileToken: randomUUID(), filePath, format: 'csv-zip', encoding: 'utf8', protocol: 'text-strict', resultSelection: { kind: 'all' } }) as Promise<QueryStreamExportOutput>).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })); }
    finally { clearTimeout(timer); await watchdog; measurements.get(taskId)!.durationMs = Date.now() - start; }
    const item = measurements.get(taskId)!; if (!result.ok) item.error = result.error;
    if (watchdogError) { if (!result.ok) throw new AggregateError([result.error, watchdogError], '原导出和安全取消均失败', { cause: result.error }); throw watchdogError; }
    if (timedOut) throw new Error('场景超过安全期限，已请求真实取消', { cause: result.ok ? undefined : result.error });
    assert.ok(item.latest?.queryExport); assert.ok(item.events > 1);
    assert.ok((item.latest.queryExport.peakBufferedRows ?? Infinity) <= limits.queueRows); assert.ok((item.latest.queryExport.peakBufferedBytes ?? Infinity) <= limits.queueBytes); assert.deepEqual(await partials(), []);
    return { taskId, item, result };
  }
  /** 独立连接读取服务器哨兵，证明已提交前缀及未执行尾部没有被重放。 */
  async function guards() { return Object.fromEntries((await observed(`SELECT stage,hits FROM ${identifier(database)}.guard_rows ORDER BY stage`)).map(row => [String(row.stage), Number(row.hits)])); }
  /** 收尾各步独立执行，首个异常始终保留为AggregateError的cause。 */
  async function attempt(action: () => Promise<unknown>) { try { await action(); } catch (error) { failures.push(error); } }
  /** 所有错误落盘前隐藏账号与密码，配置对象本身不进入证据。 */
  function redacted(value: string): string { let result = value; for (const secret of [profile.password, profile.user]) if (secret) result = result.replaceAll(secret, '[凭据已隐藏]'); return result; }
  /** 保留原异常、cause与AggregateError顺序，同时限制异常树深度和宽度。 */
  function errorDetail(error: unknown, depth = 0): unknown { if (depth > 6) return '异常层数超过记录预算'; if (!(error instanceof Error)) return redacted(String(error)); return { name: error.name, message: redacted(error.message), stack: redacted(error.stack ?? ''), cause: error.cause === undefined ? undefined : errorDetail(error.cause, depth + 1), errors: error instanceof AggregateError ? [...error.errors].slice(0, 32).map(value => errorDetail(value, depth + 1)) : undefined }; }

  try {
    assert.equal(limits.fileBytes, 10 * 1024 ** 3); assert.equal(limits.queueRows, 8); assert.equal(limits.queueBytes, 1024 ** 2);
    const disk = await statfs(directory, { bigint: true }); assert.ok(disk.bavail * disk.bsize >= 12n * 1024n ** 3n);
    observer = await driver.connect(profile); const own = await observed('SELECT CONNECTION_ID() AS tid,VERSION() AS version,@@hostname AS hostname,@@port AS server_port'); assert.equal(Number(own[0].tid), observer.connection.threadId); evidence.observer = own[0]; await execute(observer, 'SET SESSION autocommit=1');
    assert.deepEqual(await observed('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]), []);
    databaseAttempted = true; evidence.databaseCreateAttempted = true;
    await execute(observer, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); created = true; evidence.databaseCreateConfirmed = true;
    await execute(observer, `CREATE TABLE ${identifier(database)}.__dbark_owner(run_id CHAR(36) PRIMARY KEY) ENGINE=InnoDB`); await execute(observer, `INSERT INTO ${identifier(database)}.__dbark_owner VALUES(?)`, [owner]);
    evidence.databaseOwnershipMarked = true;
    await execute(observer, 'SET SESSION lock_wait_timeout=5'); await execute(observer, 'SET SESSION innodb_lock_wait_timeout=5');
    await execute(observer, `CREATE TABLE ${identifier(database)}.guard_rows(stage VARCHAR(32) PRIMARY KEY,hits INT NOT NULL DEFAULT 0) ENGINE=InnoDB`);
    await execute(observer, `INSERT INTO ${identifier(database)}.guard_rows(stage) VALUES('call'),('success_after'),('failure_prefix'),('failure_tail'),('cancel_tail')`);
    await execute(observer, `CREATE TABLE ${identifier(database)}.million_rows(id INT UNSIGNED PRIMARY KEY,large_id BIGINT UNSIGNED,amount DECIMAL(40,12),label TEXT,bytes_value VARBINARY(8),null_value VARCHAR(16),empty_text VARCHAR(16),leading_text VARCHAR(32)) ENGINE=InnoDB`);
    const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)', id = '(1+d0.n+10*d1.n+100*d2.n+1000*d3.n+10000*d4.n+100000*d5.n)';
    // 服务器内造数；客户端不构造百万行数组，不改产品10GiB与队列预算。
    await observer.connection.promise().query({ sql: `INSERT INTO ${identifier(database)}.million_rows SELECT ${id},9007199254740992+${id},CAST('12345678901234567890.123456789012' AS DECIMAL(40,12)),CONCAT('第',${id},'行🚀,带"引号"',CHAR(13),CHAR(10),'第二行'),UNHEX('0001FF80'),NULL,'',CONCAT(CHAR(92),'N') FROM ${Array.from({ length: 6 }, (_, index) => `${digits} d${index}`).join(' CROSS JOIN ')}`, timeout: 180000 });
    const count = await observed(`SELECT COUNT(*) AS total,MIN(id) AS first_id,MAX(id) AS last_id FROM ${identifier(database)}.million_rows`); assert.deepEqual(Object.values(count[0]).map(Number), [1000000, 1, 1000000]); evidence.fixture = count[0];
    await execute(observer, `CREATE PROCEDURE ${identifier(database)}.q05_large() BEGIN UPDATE ${identifier(database)}.guard_rows SET hits=hits+1 WHERE stage='call'; SET @q05_runs=@q05_runs+1; SELECT id AS seq,large_id AS same_name,amount AS same_name,label AS \`文本\`,bytes_value,null_value,empty_text,leading_text,CONNECTION_ID() AS tid,@q05_runs AS runs FROM ${identifier(database)}.million_rows ORDER BY id; END`);
    await engine.handle('connections.open', { id: profile.id, profile }); sessionId = (await engine.handle('sessions.open', { connectionId: profile.id, database })).sessionId;
    sessionThread = Number(values(await query('SELECT CONNECTION_ID() AS tid'))[0]); assert.ok(threads.has(sessionThread)); evidence.session = { sessionId, threadId: sessionThread }; await query('SET SESSION autocommit=1; SET @q05_runs=0');
    const successPath = join(directory, 'million-all-results.zip');
    const success = await exportOnce('百万行和后续状态/小行集/空集', 'CALL q05_large(); UPDATE guard_rows SET hits=hits+1 WHERE stage=\'success_after\'; SELECT CONNECTION_ID() AS tid,@q05_runs AS runs,CAST(18446744073709551615 AS UNSIGNED) AS same_name,CAST(0.12345678901234567890 AS DECIMAL(30,20)) AS same_name; SELECT id AS empty_value FROM million_rows WHERE id<0', successPath);
    assert.ok(success.result.ok); assert.equal(success.item.latest?.status, 'completed'); assert.equal(success.result.value.statementsCompleted, 4); assert.equal(success.result.value.fileCommitted, true); assert.equal(success.item.latest.queryExport?.rowsWritten, 1000001);
    assert.deepEqual(success.result.value.results.map(item => [item.kind, item.resultOrdinal, item.statementOrdinal]), [['rows', 1, 1], ['status', 2, 1], ['status', 3, 2], ['rows', 4, 3], ['rows', 5, 4]]);
    assert.ok(success.result.value.preview.results.every(item => item.rows.length <= limits.previewRows)); evidence.previewRows = success.result.value.preview.results.map(item => item.rows.length);
    assert.deepEqual(values(await query('SELECT CONNECTION_ID(),@q05_runs')).map(Number), [sessionThread, 1]); const afterSuccess = await guards(); assert.equal(afterSuccess.call, 1); assert.equal(afterSuccess.success_after, 1); evidence.successGuards = afterSuccess;
    const verified = await promisify(execFile)(python, ['-B', join(root, 'scripts', 'verify-q05-million-archive.py'), '--archive', successPath, '--thread-id', String(sessionThread)], { windowsHide: true, maxBuffer: 256 * 1024, timeout: 300000, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); assert.equal(verified.stderr, ''); evidence.python = JSON.parse(verified.stdout);
    const original = Buffer.from('原归档：失败或取消不得覆盖。\n', 'utf8'), failurePath = join(directory, 'failure-protected.zip'); await writeFile(failurePath, original, { flag: 'wx' });
    const failed = await exportOnce('后续SQL失败保留原件', 'UPDATE guard_rows SET hits=hits+1 WHERE stage=\'failure_prefix\'; SELECT 7 AS sample; SELECT * FROM missing_q05_table; UPDATE guard_rows SET hits=hits+1 WHERE stage=\'failure_tail\'', failurePath);
    assert.equal(failed.result.ok, false); if (!failed.result.ok) assert.match(String(failed.result.error), /已完成 2 条 SQL/); assert.equal(failed.item.latest?.status, 'failed'); assert.equal(failed.item.latest?.queryExport?.statementsCompleted, 2); assert.equal(failed.item.latest?.queryExport?.fileCommitted, false); assert.deepEqual(await readFile(failurePath), original);
    const afterFailure = await guards(); assert.equal(afterFailure.failure_prefix, 1); assert.equal(afterFailure.failure_tail, 0); evidence.failureGuards = afterFailure;
    const cancelledPath = join(directory, 'cancel-protected.zip'); await writeFile(cancelledPath, original, { flag: 'wx' });
    const cancelled = await exportOnce('真实写盘中取消', 'SELECT id,REPEAT(label,32) AS payload,SLEEP(0.001) AS pause_value FROM million_rows ORDER BY id; UPDATE guard_rows SET hits=hits+1 WHERE stage=\'cancel_tail\'', cancelledPath, true);
    assert.ok(cancellation, '必须由真实写入进度触发取消，不能以超时取消替代'); await cancellation;
    assert.equal(cancelled.result.ok, false); if (!cancelled.result.ok) assert.match(String(cancelled.result.error), /取消/); assert.equal(cancelled.item.latest?.status, 'cancelled'); assert.equal(cancelled.item.latest?.queryExport?.fileCommitted, false); assert.ok((cancelled.item.latest?.queryExport?.rowsWritten ?? 0) > 0 && cancelled.item.latest!.queryExport!.rowsWritten < 1000000); assert.deepEqual(await readFile(cancelledPath), original);
    await until(async () => (await observed('SELECT COMMAND FROM information_schema.PROCESSLIST WHERE ID=?', [sessionThread])).every(row => row.COMMAND === 'Sleep'));
    assert.deepEqual(values(await query('SELECT CONNECTION_ID(),@q05_runs')).map(Number), [sessionThread, 1]); const finalGuards = await guards(); assert.deepEqual(finalGuards, { call: 1, cancel_tail: 0, failure_prefix: 1, failure_tail: 0, success_after: 1 }); evidence.finalGuards = finalGuards;
    evidence.archiveBytes = (await stat(successPath)).size; evidence.originalFilesPreserved = true;
  } catch (error) { failures.push(error); }
  finally {
    await attempt(() => engine.closeAll());
    if (cancellation) await attempt(() => cancellation!);
    if (observer) {
      const control = observer, ids = [...threads].filter(id => id !== control.connection.threadId);
      const cleanup: { actualThreadIds: number[]; nonObserverThreads: number[]; remaining: number | null; remainingIds: number[] } = { actualThreadIds: [...threads], nonObserverThreads: ids, remaining: ids.length ? null : 0, remainingIds: ids };
      evidence.connectionCleanup = cleanup;
      await attempt(async () => { if (ids.length) await until(async () => { const remaining = await observed('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', ids); cleanup.remaining = remaining.length; cleanup.remainingIds = remaining.map(row => Number(row.ID)); return remaining.length === 0; }, 5000); });
      if (created) await attempt(async () => {
        // DROP前同时核本地随机标记与服务器唯一标记；不按前缀批量删除，不KILL他人连接。
        assert.equal(JSON.parse(await readFile(markerPath, 'utf8')).owner, owner); const owned = await observed(`SELECT run_id FROM ${identifier(database)}.__dbark_owner`); assert.deepEqual(owned.map(row => row.run_id), [owner]);
        await execute(control, 'SET SESSION lock_wait_timeout=5'); evidence.databaseDropAttempted = true; await execute(control, `DROP DATABASE ${identifier(database)}`); evidence.databaseDropConfirmed = true;
      });
      // CREATE返回未知也必须查询本例精确库名；没有服务器所有权标记时只报告残留，不扩大删除。
      if (databaseAttempted) await attempt(async () => { const remaining = await observed('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]); evidence.databaseRemaining = remaining.length; assert.deepEqual(remaining, [], '本例库仍存在；没有可靠所有权时保留给ROOT核对'); });
      evidence.observerClosed = false;
      await attempt(async () => { await control.close({ strict: true }); evidence.observerClosed = true; });
    }
    await attempt(async () => { recording.mockRestore(); });
    await attempt(async () => { const remaining = await partials(); evidence.partialRemaining = remaining.length; evidence.partialNames = remaining; assert.deepEqual(remaining, []); });
    evidence.finishedAt = new Date().toISOString(); evidence.status = failures.length ? 'failed' : 'passed'; evidence.tasks = [...measurements].map(([taskId, item]) => ({ taskId, ...item, error: item.error === undefined ? undefined : errorDetail(item.error) })); evidence.errors = failures.map(error => errorDetail(error));
    await attempt(() => writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' }));
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Q05手动验收或清理失败，首个原始异常保留', { cause: failures[0] });
});
