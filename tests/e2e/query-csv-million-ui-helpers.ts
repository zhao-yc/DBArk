import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, stat, statfs, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import type { QueryExportProgress } from '../../src/shared/queryStreamExport';
import { queryStreamExportLimits as limits } from '../../src/shared/queryStreamExport';
import { requireQ05IsolatedPort } from '../../scripts/q05-isolated-port.mjs';
import { expect, desktop, page, closed, pageErrors, answerDialogs, quitDesktop } from './desktop-fixture';
import { environment, isolatedDatabase, openDatabaseQuery, executeSql, writeSql, type LiveContext } from './live-helpers';

type Preview = { rows: number; columns: number; truncated: boolean };
type Wire = { id: string; command: string; taskId: string; sessionId: string; source: string; maxRows?: number; responded?: boolean; failed?: boolean; preview?: Preview[]; positions?: (string | number)[][]; statementsCompleted?: number; committed?: boolean; threadId?: number; runs?: string };
type Probe = { records: Wire[]; pending: Map<string, Wire | { command: string; connectionId?: string }>; threadIds: Set<number>; sessions: { id: string; connectionId: string }[]; workerPids: number[]; overflow: boolean; expected: Record<string, string>; restore(): void };
type ProbeRoot = typeof globalThis & { __q05MillionUi?: Probe };
type Events = { taskId: string; count: number; latest?: { taskId: string; status: string; queryExport: QueryExportProgress }; unexpected: boolean; stop(): void };
type EventWindow = Window & { __q05MillionUiEvents?: Events };
const query = () => page.locator('.query-tab:visible');
const modal = () => page.getByRole('dialog', { name: '完整流式导出（新执行 SQL）', exact: true });
let prerequisites: Record<string, unknown> | undefined;

/** beforeAll在自动桌面夹具之前核双门、六端口、Python和200身份；--list不调用。 */
export async function checkMillionUiPrerequisites(): Promise<void> {
  assert.equal(process.env.DBARK_INTEGRATION_ENABLED, '1'); assert.equal(process.env.DBARK_Q05_MILLION_ARCHIVE_UI, '1');
  const port = requireQ05IsolatedPort(process.env.DBARK_TEST_PORT, environment.DBARK_TEST_PORT);
  assert.equal(process.env.DBARK_TEST_HOST, '192.168.31.200'); assert.ok(process.env.DBARK_TEST_USER && process.env.DBARK_TEST_PASSWORD !== undefined);
  assert.ok(environment.DBARK_TEST_HOST === process.env.DBARK_TEST_HOST && environment.DBARK_TEST_USER === process.env.DBARK_TEST_USER && environment.DBARK_TEST_PASSWORD === process.env.DBARK_TEST_PASSWORD, 'ROOT环境与既有夹具连接配置必须相同');
  assert.equal(environment.DBARK_TEST_TLS === '1', process.env.DBARK_TEST_TLS === '1');
  if (port === 13484) assert.equal(process.env.DBARK_TEST_TLS, '1', '13484必须显式严格TLS，不能借默认环境降级');
  if (process.env.DBARK_TEST_TLS === '1') { const ca = process.env.DBARK_TEST_CA; assert.ok(ca && isAbsolute(ca) && environment.DBARK_TEST_CA === ca); const file = await lstat(ca); assert.ok(file.isFile() && !file.isSymbolicLink()); }
  const python = process.env.DBARK_Q05_PYTHON; assert.ok(python && isAbsolute(python)); const file = await lstat(python); assert.ok(file.isFile() && !file.isSymbolicLink());
  const expected = process.env.DBARK_Q05_EXPECTED_HOSTNAME; assert.ok(expected && /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(expected));
  const result = await promisify(execFile)('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'server-200', 'hostname; hostname -I; df -Pk /var/lib/docker'], { windowsHide: true, timeout: 20000, maxBuffer: 65536 });
  const lines = result.stdout.trim().split(/\r?\n/), addresses = lines[1]?.trim().split(/\s+/) ?? [], available = lines.at(-1)?.trim().split(/\s+/)[3];
  assert.equal(result.stderr, ''); assert.equal(lines[0]?.trim(), expected); assert.ok(addresses.includes('192.168.31.200')); assert.match(available ?? '', /^\d+$/); assert.ok(BigInt(available!) >= 2n * 1024n ** 2n);
  prerequisites = { serverAlias: 'server-200', hostname: expected, address: '192.168.31.200', port, availableKiB: available, checkedAt: new Date().toISOString() };
}

/** 只透传真实fork/postMessage并旁观原响应，兼容源码及asar中的正式worker；不改驱动或文件。 */
async function observeUtility() {
  await desktop.evaluate(({ utilityProcess }) => {
    const root = globalThis as ProbeRoot; if (root.__q05MillionUi) throw Error('重复安装Q05旁观器');
    const fork = utilityProcess.fork, restorers: (() => void)[] = [];
    const state: Probe = { records: [], pending: new Map(), threadIds: new Set(), sessions: [], workerPids: [], overflow: false, expected: {}, restore() { utilityProcess.fork = fork; for (const restore of restorers.reverse()) restore(); } }; root.__q05MillionUi = state;
    /** 只收真实安全整数线程，达到固定容量就记录溢出，不能静默丢掉连接证据。 */
    const rememberThread = (id: number | undefined) => { if (!Number.isSafeInteger(id) || (id ?? 0) < 1) return; if (state.threadIds.size < 64 || state.threadIds.has(id!)) state.threadIds.add(id!); else state.overflow = true; };
    utilityProcess.fork = ((...args: Parameters<typeof fork>) => {
      const child = fork(...args); if (args[2]?.serviceName !== 'DBArk 数据库引擎') return child;
      child.once('spawn', () => { if (state.workerPids.length < 4 && child.pid) state.workerPids.push(child.pid); else state.overflow = true; });
      const send = child.postMessage;
      child.postMessage = ((...messages: Parameters<typeof send>) => {
        const message = messages[0] as { id?: string; command?: string; input?: { taskId?: string; sessionId?: string; connectionId?: string; sql?: string; maxRows?: number } };
        const command = message.command ?? '', input = message.input ?? {};
        if (message.id && ['connections.test', 'connections.open', 'sessions.open', 'query.execute', 'query.exportStream'].includes(command)) {
          if (state.pending.size >= 64) state.overflow = true;
          else if (command.startsWith('query.')) {
            const record: Wire = { id: message.id, command, taskId: input.taskId ?? '', sessionId: input.sessionId ?? '', source: Object.keys(state.expected).find(key => state.expected[key] === input.sql) ?? '未知SQL', maxRows: input.maxRows };
            if (state.records.length < 8) { state.records.push(record); state.pending.set(message.id, record); } else state.overflow = true;
          } else state.pending.set(message.id, { command, ...(command === 'sessions.open' ? { connectionId: input.connectionId } : {}) });
        }
        return send.apply(child, messages);
      }) as typeof send;
      const observe = (message: { type?: string; id?: string; error?: string; result?: any }) => {
        if (message.type !== 'response' || !message.id) return; const pending = state.pending.get(message.id); if (!pending) return; state.pending.delete(message.id);
        const result = message.result;
        if (pending.command === 'connections.test' || pending.command === 'connections.open') rememberThread(result?.connectionId);
        else if (pending.command === 'sessions.open') { if (state.sessions.length < 8 && typeof result?.sessionId === 'string') state.sessions.push({ id: result.sessionId, connectionId: (pending as { connectionId?: string }).connectionId ?? '' }); else state.overflow = true; }
        else {
          const record = pending as Wire; record.responded = true; record.failed = !!message.error;
          const preview = record.command === 'query.exportStream' ? result?.preview : result;
          if (Array.isArray(preview?.results) && preview.results.length <= 200) {
            record.preview = preview.results.map((item: any) => ({ rows: item.rows.length, columns: item.columns.length, truncated: item.truncated }));
            for (const item of preview.results) { const column = item.columns.find((column: any) => ['ui_session_id', 'tid'].includes(column.name)), runs = item.columns.find((column: any) => column.name === 'runs'); if (column && item.rows.length) { record.threadId = Number(item.rows[0][column.key]); rememberThread(record.threadId); if (runs) record.runs = String(item.rows[0][runs.key]); break; } }
          }
          if (record.command === 'query.exportStream' && result) { if (Array.isArray(result.results) && result.results.length <= 200) record.positions = result.results.map((item: any) => [item.kind, item.resultOrdinal, item.statementOrdinal]); else state.overflow = true; record.statementsCompleted = result.statementsCompleted; record.committed = result.fileCommitted; }
        }
      };
      child.on('message', observe); restorers.push(() => { child.postMessage = send; child.removeListener('message', observe); });
      return child;
    }) as typeof fork;
  });
  await page.evaluate(() => {
    const state: Events = { taskId: '', count: 0, unexpected: false, stop() {} };
    state.stop = window.dbark.onTask(event => { if (!event.queryExport) return; if (!state.taskId) state.taskId = event.taskId; if (event.taskId !== state.taskId) { state.unexpected = true; return; } state.count++; state.latest = { taskId: event.taskId, status: event.status, queryExport: event.queryExport }; });
    (window as EventWindow).__q05MillionUiEvents = state;
  });
}

/** 只取有限编号、计数和返回结构，绝不跨测试端复制全部预览行或百万行。 */
async function utilitySummary() { return desktop.evaluate(() => { const state = (globalThis as ProbeRoot).__q05MillionUi; if (!state) throw Error('没有Q05旁观器'); return { records: state.records, threadIds: [...state.threadIds], sessions: state.sessions, workerPids: state.workerPids, overflow: state.overflow, pending: state.pending.size }; }); }
/** 所有实际请求及监听在退出之前恢复；应用及原连接收尾仍走现有夹具。 */
async function restoreObservation() { await page.evaluate(() => { (window as EventWindow).__q05MillionUiEvents?.stop(); delete (window as EventWindow).__q05MillionUiEvents; }); await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__q05MillionUi?.restore(); delete root.__q05MillionUi; }); }
/** 历史只记录编号和本例SQL匹配项，不把历史正文全部写入证据。 */
async function executionIds(source: string) { return page.evaluate(async sql => ({ tasks: (await window.dbark.invoke('tasks.list', {})).map(item => item.id).sort(), history: (await window.dbark.invoke('history.list', {})).map(item => item.id).sort(), matching: (await window.dbark.invoke('history.list', {})).filter(item => item.sql === sql).map(item => ({ id: item.id, success: item.success, connectionId: item.connectionId })) }), source); }
/** 独立控制连接只观察/清理本例资源，不调用任何产品执行接口。 */
async function controlConnection(): Promise<Connection> { return mysql.createConnection({ host: '192.168.31.200', port: requireQ05IsolatedPort(process.env.DBARK_TEST_PORT, environment.DBARK_TEST_PORT), user: process.env.DBARK_TEST_USER!, password: process.env.DBARK_TEST_PASSWORD!, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000, ...(process.env.DBARK_TEST_TLS === '1' ? { ssl: { ca: readFileSync(process.env.DBARK_TEST_CA!), rejectUnauthorized: true, verifyIdentity: true } } : {}) }); }

/** 服务器内造数复用已验模型；BLOB真实返回同样的规范字节，不构造客户端百万行数组。 */
async function createFixture({ observer, database }: LiveContext, owner: string) {
  assert.match(database, /^dbark_e2e_[a-z0-9_]+$/); const name = '`' + database + '`';
  await observer.query(`CREATE TABLE ${name}.__q05_owner(run_id CHAR(36) PRIMARY KEY) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${name}.__q05_owner VALUES(?)`, [owner]);
  await observer.query(`CREATE TABLE ${name}.guard_rows(stage VARCHAR(32) PRIMARY KEY,hits INT NOT NULL DEFAULT 0) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${name}.guard_rows(stage) VALUES('call'),('success_after')`);
  await observer.query(`CREATE TABLE ${name}.million_rows(id INT UNSIGNED PRIMARY KEY,large_id BIGINT UNSIGNED,amount DECIMAL(40,12),label TEXT,bytes_value BLOB,null_value VARCHAR(16),empty_text VARCHAR(16),leading_text VARCHAR(32)) ENGINE=InnoDB`);
  const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)', id = '(1+d0.n+10*d1.n+100*d2.n+1000*d3.n+10000*d4.n+100000*d5.n)';
  await observer.query({ sql: `INSERT INTO ${name}.million_rows SELECT ${id},9007199254740992+${id},CAST('12345678901234567890.123456789012' AS DECIMAL(40,12)),CONCAT('第',${id},'行🚀,带"引号"',CHAR(13),CHAR(10),'第二行'),UNHEX('0001FF80'),NULL,'',CONCAT(CHAR(92),'N') FROM ${Array.from({ length: 6 }, (_, index) => `${digits} d${index}`).join(' CROSS JOIN ')}`, timeout: 120000 });
  const [counts] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total,MIN(id) AS first_id,MAX(id) AS last_id FROM ${name}.million_rows`); expect(Object.values(counts[0]).map(Number)).toEqual([1000000, 1, 1000000]);
  await observer.query(`CREATE PROCEDURE ${name}.q05_large() BEGIN UPDATE ${name}.guard_rows SET hits=hits+1 WHERE stage='call'; SET @q05_runs=@q05_runs+1; SELECT id AS seq,large_id AS same_name,amount AS same_name,label AS \`文本\`,bytes_value,null_value,empty_text,leading_text,CONNECTION_ID() AS tid,@q05_runs AS runs FROM ${name}.million_rows ORDER BY id; END`);
}

/** 新增正式UI补充，唯一导出入口为实际按钮；finally保留原异常和独立清理证据。 */
export async function runMillionArchiveUi(info: TestInfo): Promise<void> {
  assert.ok(prerequisites); const owner = randomUUID(), directory = info.outputPath('q05-million-ui-' + owner); await mkdir(directory);
  const space = await statfs(directory, { bigint: true }); assert.ok(space.bavail * space.bsize >= 12n * 1024n ** 3n); const target = join(directory, 'million-all-results.zip'); await writeFile(join(directory, 'owner.json'), JSON.stringify({ owner, caseId: 'Q05-MILLION-CSV-ZIP-UI', prerequisites }), { flag: 'wx' });
  const evidence: Record<string, unknown> = { caseId: 'Q05-MILLION-CSV-ZIP-UI', scope: '0.17原246项之外的正式UI补充；需ROOT分别运行源码与公开NSIS', owner, prerequisites, limits, startedAt: new Date().toISOString() }, failures: unknown[] = [];
  let control: Connection | undefined, database = '', observerId = 0, snapshot: Awaited<ReturnType<typeof utilitySummary>> | undefined, watching = false;
  /** 每个收尾独立尝试，多错误的首个对象不丢失。 */
  async function attempt(action: () => Promise<unknown>) { try { await action(); } catch (error) { failures.push(error); } }
  /** 仅脱敏异常及小型元数据，账号密码不进入证据或测试输出。 */
  function errorDetail(error: unknown, depth = 0): unknown { if (depth > 5) return '异常层数超过预算'; let text = error instanceof Error ? error.stack ?? error.message : String(error); for (const secret of [process.env.DBARK_TEST_USER, process.env.DBARK_TEST_PASSWORD]) if (secret) text = text.replaceAll(secret, '[凭据已隐藏]'); return { error: text, cause: error instanceof Error && error.cause ? errorDetail(error.cause, depth + 1) : undefined, errors: error instanceof AggregateError ? [...error.errors].slice(0, 16).map(value => errorDetail(value, depth + 1)) : undefined }; }
  try {
    control = await controlConnection(); evidence.controlThreadId = control.threadId;
    watching = true; await observeUtility();
    await isolatedDatabase(async context => {
      database = context.database; evidence.database = database; observerId = context.observer.threadId; evidence.observerThreadId = observerId;
      try {
        await createFixture(context, owner); await openDatabaseQuery(database); await (await navigationMenuInput(query(), {name:'查询结果行数上限',exact:true})).fill('2');
        const source = "CALL q05_large(); UPDATE guard_rows SET hits=hits+1 WHERE stage='success_after'; SELECT CONNECTION_ID() AS tid,@q05_runs AS runs,CAST(18446744073709551615 AS UNSIGNED) AS same_name,CAST(0.12345678901234567890 AS DECIMAL(30,20)) AS same_name; SELECT id AS empty_value FROM million_rows WHERE id<0"; evidence.sourceSql = source;
        const seed = 'SET SESSION autocommit=1; SET @q05_runs=0; SELECT CONNECTION_ID() AS ui_session_id,@q05_runs AS runs FROM million_rows ORDER BY id LIMIT 5', post = 'SELECT CONNECTION_ID() AS ui_session_id,@q05_runs AS runs';
        await desktop.evaluate((_, expected) => { (globalThis as ProbeRoot).__q05MillionUi!.expected = expected; }, { seed, export: source, post });
        await executeSql(seed); await query().getByRole('button', { name: '结果 3', exact: true }).click(); await expect(query().locator('.tab-status')).toContainText('已达到结果上限');
        const seeded = (await utilitySummary()).records.find(item => item.source === 'seed'); expect(seeded).toMatchObject({ responded: true, failed: false, maxRows: 2, preview: [{ rows: 0 }, { rows: 0 }, { rows: 2, truncated: true }], runs: '0' }); assert.ok(seeded?.threadId);
        await expect(query().getByRole('grid')).toHaveAttribute('aria-rowcount', '3');
        const utility = await desktop.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged, executable: process.execPath, workers: app.getAppMetrics().filter(item => item.type === 'Utility' && (item.name === 'DBArk 数据库引擎' || item.serviceName === 'DBArk 数据库引擎')).map(item => item.pid) })); expect(utility.workers).toHaveLength(1); evidence.application = utility;
        await writeSql(source); await expect.poll(() => page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(item => item.id === settings.activeTabId)?.sql; })).toBe(source);
        const before = await executionIds(source); expect(before.matching).toEqual([]);
        await desktop.evaluate(({ dialog }, filePath) => { const root = globalThis as typeof globalThis & { __q05MillionSave?: typeof dialog.showSaveDialog }; root.__q05MillionSave = dialog.showSaveDialog; dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog; }, target);
        await query().getByRole('button', { name: '新执行并完整导出', exact: true }).click(); await modal().getByRole('combobox', { name: '完整文件格式', exact: true }).selectOption('csv-zip'); await expect(modal().locator('.query-stream-source')).toHaveText(source); await modal().locator('.file-picker').click(); await expect(modal().locator('.file-picker')).toContainText(basename(target));
        await expect(modal().getByRole('button', { name: '确认新执行并导出', exact: true })).toBeDisabled(); expect(await executionIds(source)).toEqual(before);
        await modal().getByRole('checkbox', { name: '我确认这是一次新的 SQL 执行，写入不能由取消文件导出撤销', exact: true }).check(); await modal().getByRole('button', { name: '确认新执行并导出', exact: true }).click();
        let taskId = ''; await expect.poll(async () => { const tasks = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(item => !ids.includes(item.id) && item.kind === 'query.exportStream'), before.tasks); if (tasks.length === 1) taskId = tasks[0].id; return tasks.length; }).toBe(1);
        await expect.poll(() => page.evaluate(async id => (await window.dbark.invoke('tasks.list', {})).find(item => item.id === id)?.status, taskId), { timeout: 240000 }).toBe('completed'); await expect(modal().locator('.success-box')).toContainText('完整文件已提交'); await expect(modal().locator('.error-box')).toHaveCount(0);
        const event = await page.evaluate(() => { const value = (window as EventWindow).__q05MillionUiEvents!; return { count: value.count, latest: value.latest, unexpected: value.unexpected }; }); expect(event.unexpected).toBe(false); expect(event.latest).toMatchObject({ taskId, status: 'completed', queryExport: { statementsCompleted: 4, rowsWritten: 1000001, fileCommitted: true } }); expect(event.latest!.queryExport.peakBufferedRows).toBeLessThanOrEqual(8); expect(event.latest!.queryExport.peakBufferedBytes).toBeLessThanOrEqual(1024 ** 2); evidence.progress = event;
        const exported = (await utilitySummary()).records.filter(item => item.command === 'query.exportStream'); expect(exported).toHaveLength(1); expect(exported[0]).toMatchObject({ taskId, source: 'export', sessionId: seeded.sessionId, threadId: seeded.threadId, runs: '1', responded: true, failed: false, statementsCompleted: 4, committed: true }); expect(exported[0].positions).toEqual([['rows', 1, 1], ['status', 2, 1], ['status', 3, 2], ['rows', 4, 3], ['rows', 5, 4]]); expect(exported[0].preview!.map(item => item.rows)).toEqual([200, 0, 0, 1, 0]); expect(exported[0].preview!.every(item => item.rows <= 200)).toBe(true);
        const after = await executionIds(source); expect(after.tasks.filter(id => !before.tasks.includes(id))).toEqual([taskId]); expect(after.history.filter(id => !before.history.includes(id))).toHaveLength(1); expect(after.matching).toEqual([{ id: after.history.find(id => !before.history.includes(id)), success: true, connectionId: context.connectionId }]); evidence.history = after.matching;
        const verified = await promisify(execFile)(process.env.DBARK_Q05_PYTHON!, ['-B', resolve('scripts/verify-q05-million-archive.py'), '--archive', target, '--thread-id', String(seeded.threadId)], { windowsHide: true, timeout: 300000, maxBuffer: 256 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }); expect(verified.stderr).toBe(''); evidence.python = JSON.parse(verified.stdout); evidence.archiveBytes = (await stat(target)).size;
        await modal().getByRole('button', { name: '关闭', exact: true }).click(); await expect(modal()).toBeHidden(); await expect((await navigationMenuInput(query(), {name:'查询结果行数上限',exact:true}))).toHaveValue('2'); await expect(query().locator('.tab-status')).toContainText('200'); await expect(query().locator('.tab-status')).toContainText('已达到结果上限'); expect(await query().locator('.result-body [role=row]').count()).toBeLessThan(80); await expect(query().getByRole('grid')).toHaveAttribute('aria-rowcount', '201');
        await page.screenshot({ path: info.outputPath('q05-million-csv-zip-ui.png') });
        await expect.poll(() => page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return settings.tabs.find(item => item.id === settings.activeTabId)?.sql; })).toBe(source);
        await executeSql(post); const posted = (await utilitySummary()).records.find(item => item.source === 'post'); expect(posted).toMatchObject({ responded: true, failed: false, sessionId: seeded.sessionId, threadId: seeded.threadId, runs: '1', maxRows: 2 });
        const [guard] = await context.observer.query<RowDataPacket[]>(`SELECT stage,hits FROM \`${database}\`.guard_rows ORDER BY stage`); expect(guard.map(row => [row.stage, Number(row.hits)])).toEqual([['call', 1], ['success_after', 1]]); evidence.guards = guard;
        expect((await executionIds(source)).matching).toEqual(after.matching); const [owned] = await context.observer.query<RowDataPacket[]>(`SELECT run_id FROM \`${database}\`.__q05_owner`); expect(owned.map(row => row.run_id)).toEqual([owner]); expect(pageErrors).toEqual([]);
      } catch (error) { failures.push(error); throw error; }
      finally {
        await attempt(async () => { snapshot = await utilitySummary(); evidence.utility = snapshot; expect(snapshot.overflow).toBe(false); expect(snapshot.pending).toBe(0); expect(snapshot.records).toHaveLength(3); expect(new Set(snapshot.records.map(item => item.id)).size).toBe(3); expect(new Set(snapshot.records.map(item => item.sessionId)).size).toBe(1); expect(snapshot.sessions).toHaveLength(1); expect(snapshot.sessions[0].connectionId).toBe(context.connectionId); expect(snapshot.sessions[0].id).toBe(snapshot.records[0].sessionId); expect(snapshot.workerPids).toEqual((evidence.application as { workers: number[] }).workers); });
        await attempt(async () => { await desktop.evaluate(({ dialog }) => { const root = globalThis as typeof globalThis & { __q05MillionSave?: typeof dialog.showSaveDialog }; if (root.__q05MillionSave) dialog.showSaveDialog = root.__q05MillionSave; delete root.__q05MillionSave; }); });
        await attempt(async () => { await restoreObservation(); watching = false; });
      }
    }, info);
  } catch (error) { if (!failures.includes(error)) failures.push(error); }
  finally {
    if (watching && !closed) await attempt(restoreObservation);
    // 夹具在进入本例库前失败时也退出本次应用；原失败仍保留，不以清理成功替代验收。
    if (!closed) await attempt(async () => { await answerDialogs([1, 1]); await quitDesktop(); });
    if (control) {
      const ids = [...new Set([observerId, ...(snapshot?.threadIds ?? [])])].filter(id => Number.isSafeInteger(id) && id > 0 && id !== control!.threadId);
      await attempt(async () => { const cleanup = { knownPhysicalThreadIds: ids, remaining: -1 }; evidence.connectionCleanup = cleanup; await expect.poll(async () => { const [rows] = ids.length ? await control!.query<RowDataPacket[]>({ sql: 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + ids.map(() => '?').join(',') + ')', values: ids, timeout: 5000 }) : [[]]; cleanup.remaining = rows.length; return rows.length; }, { timeout: 10000 }).toBe(0); });
      if (database) await attempt(async () => { const [rows] = await control!.query<RowDataPacket[]>({ sql: 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', values: [database], timeout: 5000 }); evidence.databaseRemaining = rows.length; expect(rows).toHaveLength(0); });
      await attempt(async () => { await control!.end(); evidence.controlEnded = true; });
    }
    // 只有ESRCH可证明进程消失；权限不足和未知观测失败必须保留失败，不能伪造资源全零。
    await attempt(async () => { expect(closed).toBe(true); const remaining = (snapshot?.workerPids ?? []).filter(pid => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException | undefined)?.code === 'ESRCH') return false; throw new Error('无法确认本例utility进程是否退出', { cause: error }); } }); evidence.utilityPidsRemaining = remaining; expect(remaining).toEqual([]); });
    await attempt(async () => { const names = (await readdir(directory)).filter(name => name.endsWith('.partial')); evidence.partialRemaining = names.length; expect(names).toEqual([]); expect(JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')).owner).toBe(owner); });
    evidence.finishedAt = new Date().toISOString(); evidence.status = failures.length ? 'failed' : 'passed'; evidence.errors = failures.map(error => errorDetail(error)); await attempt(() => writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' }));
    await attempt(() => info.attach('Q05百万行ZIP正式UI补充证据', { path: join(directory, 'evidence.json'), contentType: 'application/json' }));
  }
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, 'Q05百万行正式UI补充或清理失败，首个原异常已保留', { cause: failures[0] });
}

/** 仅实际操作时加载结果设置菜单，默认及列表阶段不增加资源读取。 */
async function navigationMenuInput(...args: Parameters<typeof import('./navigation-menu')['navigationMenuInput']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuInput(...args); }
