import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Socket } from 'node:net';
import mysql, { type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { installSqlImportFileAnswer, finishSqlImportFileAnswer } from '../helpers/sqlFileImportUi';
import { sqlFileImportReceiptSchema, type FileImportResult } from '../../src/shared/sqlFileImport';
import { sqlFileImportZh as t } from '../../src/renderer/locales/sqlFileImport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_SQL_FILE_IMPORT_UI === '1';
test.skip(!enabled, 'SQL文件导入正式窗口须统筹核对200隔离实例并显式开启双门');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(150000);
interface Audit {
  pending: number; choices: { token: string; name: string }[];
  started: { taskId: string; token: string }[]; cancels: { taskId: string; ok: boolean }[];
  imports: { taskId: string; token: string; encoding: string; result: FileImportResult }[];
}

test('SQL文件真实选择令牌、失败和成功新任务、原按钮取消及原线程收尾', async ({}, info) => {
  if (process.platform !== 'win32') throw Error('本专项只验Windows，不能当作macOS证据');
  const live = await import('./live-helpers'), env = live.environment;
  const host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT), tls = env.DBARK_TEST_TLS === '1';
  if (!enabled || !['deve-server.yinzon.com', '192.168.31.200'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('SQL文件窗口专项仅允许预核200六个隔离实例');
  if (port === 13484 && (!tls || !env.DBARK_TEST_CA)) throw Error('13484必须保持既有严格TLS及CA');
  const owned = ownedDesktopResources(info), application = owned.application, page = owned.page;
  /** 跨await始终核对原TestInfo及原窗口，不借全局句柄接管新应用。 */
  const check = () => { const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page) throw Error('SQL文件导入原窗口归属变化'); };
  const database = 'dbark_sqlimport_ui_' + randomUUID().replaceAll('-', ''), marker = randomUUID(), threadIds = new Set<number>();
  const observer = await mysql.createConnection({ host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000, ...(tls ? { ssl: { ca: readFileSync(env.DBARK_TEST_CA!), rejectUnauthorized: true, verifyIdentity: true } } : {}) });
  const observerId = (observer as unknown as { threadId: number }).threadId;
  const observerSocket = (observer as unknown as { connection: { stream: Socket } }).connection.stream;
  let observerSawClose = observerSocket.closed === true, observerEndAttempted = false;
  const observerClosed = new Promise<void>(resolve => { if (observerSawClose) resolve(); else observerSocket.once('close', () => { observerSawClose = true; resolve(); }); });
  /** 只关闭原句柄一次；end成功后最多观察5秒原socket，不重连、强停或重试。 */
  const closeObserver = async () => {
    if (observerEndAttempted) throw Error('原观察连接已尝试关闭，禁止重复关闭');
    observerEndAttempted = true; await observer.end();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([observerClosed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('原观察连接socket关闭尚未确认')), 5000); })]); }
    finally { if (timer) clearTimeout(timer); }
    expect(observerSawClose && observerSocket.closed).toBe(true);
  };
  let created = false, marked = false, auditInstalled = false, directory = '', failed = false, failure: unknown;
  const sourceFiles = new Map<string, Buffer>();
  const table = (name: string) => '`' + database + '`.`' + name + '`';
  /** 原观察连接仅做身份、owner、独立数据和资源断言，不代替产品导入。 */
  const observe = async (sql: string, values: (string | number)[] = []) => {
    check(); const [rows] = await observer.query<RowDataPacket[] | ResultSetHeader>(sql, values); check();
    if (Array.isArray(rows)) return rows.map(row => ({ ...row }));
    // DDL/DML仅消费合法的无警告ACK，不能把任意非数组回包伪装成行结果。
    expect(rows && typeof rows === 'object' && rows.fieldCount === 0).toBe(true);
    expect(Number.isSafeInteger(rows.affectedRows) && rows.affectedRows >= 0).toBe(true);
    expect(Number.isSafeInteger(rows.insertId) && rows.insertId >= 0).toBe(true);
    expect(Number.isInteger(rows.serverStatus) && rows.serverStatus >= 0 && rows.serverStatus <= 65535).toBe(true);
    expect(rows.warningStatus).toBe(0);
    return [];
  };
  const audit = async (): Promise<Audit> => { check(); const state = await application.evaluate(() => { const state = (globalThis as any).__sqlImportAudit; state.check(); return { pending: state.pending, choices: state.choices, started: state.started, cancels: state.cancels, imports: state.imports }; }); check(); return state; };
  try {
    const identity = (await observe('SELECT VERSION() AS version,@@hostname AS hostname,CONNECTION_ID() AS id'))[0];
    expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(Number(identity.id)).toBe(observerId);
    if (!String(identity.version).includes('MariaDB')) { if (!env.DBARK_TEST_EXPECTED_UUID) throw Error('缺少已预核MySQL UUID，未建库'); expect((await observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(env.DBARK_TEST_EXPECTED_UUID); }
    await info.attach('SQL文件导入原资源登记', { body: JSON.stringify({ database, owner: marker, observerId, port, version: identity.version, hostname: identity.hostname }), contentType: 'application/json' });
    // 新建连接及数据库仍使用真实表单；创建前已从独立物理连接核过身份。
    created = true;
    const context = await live.connectAndCreate(database, { application, page, assertCurrent: check });
    await observe('CREATE TABLE ' + table('__owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB');
    await observe('INSERT INTO ' + table('__owner') + ' VALUES (?)', [marker]); marked = true;
    await observe('CREATE TABLE ' + table('subject') + ' (id INT PRIMARY KEY,note VARCHAR(100)) ENGINE=InnoDB');
    directory = await mkdtemp(join(tmpdir(), 'dbark-sqlimport-ui-'));
    const badStatement = "INSERT INTO subject VALUES(1,'重复')";
    const prefix = "SELECT SLEEP(3);\r\nINSERT INTO subject VALUES(1,'先提交😀');\r\nSTART TRANSACTION;\r\nINSERT INTO subject VALUES(2,'待回滚');\r\n";
    const badText = prefix + badStatement + ";\r\nINSERT INTO subject VALUES(3,'尾句不得执行');\r\n";
    const goodText = "SELECT SLEEP(3);\r\nINSERT INTO subject VALUES(4,'明确新任务成功😀');\r\n";
    // SLEEP-only可能以正常ACK结束；使用六实例独立probe已证明ERR1317的原固定SQL。
    const cancelPrefix = "INSERT INTO subject VALUES(5,'取消前提交😀');\r\nSTART TRANSACTION;\r\nINSERT INTO subject VALUES(6,'取消时待回滚');\r\n", cancelStatement = 'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=CONNECTION_ID() AND SLEEP(15)=0';
    // 尾部COMMIT及标记行使误执行产生独立可见副作用；GUI仍不把零行冒称utility物理零发送。
    const cancelText = cancelPrefix + cancelStatement + ";\r\nCOMMIT;\r\nINSERT INTO subject VALUES(7,'取消尾部不得执行');\r\n";
    for (const [name, text] of [['failed.sql', badText], ['next-explicit.sql', goodText], ['third-explicit-cancel.sql', cancelText]]) {
      const path = join(directory, name), bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
      await writeFile(path, bytes, { flag: 'wx' }); sourceFiles.set(path, bytes);
    }
    await info.attach('SQL文件三次原输入字节登记', { body: JSON.stringify([...sourceFiles].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), encoding: 'utf16le', bom: true }))), contentType: 'application/json' });
    /** 只旁观原Main能力与回执，不发files.import、不替换结果或执行参数。 */
    await application.evaluate(({ ipcMain, BrowserWindow }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
      if (root.__sqlImportAudit || typeof original !== 'function' || windows.length !== 1 || !frame) throw Error('SQL导入Main旁观原归属未知');
      const state = { pending: 0, choices: [] as { token: string; name: string }[], started: [] as Audit['started'], cancels: [] as Audit['cancels'], imports: [] as Audit['imports'], check() {}, restore() {} };
      const check = () => { if (root.__sqlImportAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('SQL导入Main旁观原归属变化'); };
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== contents || event.senderFrame !== frame) throw Error('SQL导入Main旁观来源变化');
        const relevant = payload.command === 'files.import' || payload.command === 'files.choose' || payload.command === 'query.cancel';
        if (relevant) state.pending++;
        try {
          if (payload.command === 'files.import') {
            const value = payload.input;
            if (state.imports.length >= 3 || state.started.length !== state.imports.length || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'subject' || value.format !== 'sql' || value.encoding !== 'utf16le' || value.fileToken !== state.choices[state.imports.length]?.token || Object.hasOwn(value, 'filePath') || Object.keys(value.mapping).length) throw Error('SQL导入正式输入与当前文件能力不符');
            state.started.push({ taskId: value.taskId, token: value.fileToken });
          }
          if (payload.command === 'query.cancel') {
            if (state.cancels.length || state.started.length !== 3 || state.imports.length !== 2 || payload.input.taskId !== state.started[2].taskId) throw Error('SQL导入取消未指向第三次在途原任务');
            state.cancels.push({ taskId: payload.input.taskId, ok: false });
          }
          const response = await original(event, payload); check();
          if (payload.command === 'files.choose') {
            if (payload.input.purpose !== 'import' || payload.input.format !== 'sql' || !response?.ok || typeof response.result?.token !== 'string' || state.choices.length >= 3 || state.choices.some(value => value.token === response.result.token)) throw Error('SQL导入未收到本次独立Main能力');
            state.choices.push({ token: response.result.token, name: response.result.name });
          }
          if (payload.command === 'files.import') { if (!response?.ok) throw Error('SQL导入未返回结构化回执'); state.imports.push({ taskId: payload.input.taskId, token: payload.input.fileToken, encoding: payload.input.encoding, result: response.result }); }
          if (payload.command === 'query.cancel') state.cancels[0].ok = response?.ok === true;
          return response;
        } finally { if (relevant) state.pending--; }
      };
      state.check = check; state.restore = () => { check(); if (state.pending) throw Error('SQL导入请求仍在途，不能移除旁观器'); handlers.set('dbark:request', original); delete root.__sqlImportAudit; };
      root.__sqlImportAudit = state; handlers.set('dbark:request', wrapped);
    }, { connectionId: context.connectionId, database }); auditInstalled = true;
    const row = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await (await (await import('./navigation-menu')).navigationMenuItem(row, { name: database, exact: true }, check)).click();
    await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.object-row'), { name: 'subject', exact: true }, check)).click();
    const tab = page.locator('.table-tab:visible'); await expect(tab.getByRole('grid')).toBeVisible();
    await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: zh.common.import, exact: true }, check)).click();
    const dialog = page.getByRole('dialog', { name: `${zh.transfer.text004} · ${database}.subject`, exact: true });
    await dialog.getByRole('combobox', { name: zh.transfer.text006, exact: true }).selectOption('sql');
    await dialog.getByRole('combobox', { name: zh.transfer.text009, exact: true }).selectOption('utf16le');
    const start = dialog.getByRole('button', { name: zh.transfer.text028, exact: true }), report = dialog.getByRole('status', { name: t.title, exact: true });
    for (const [index, path] of [...sourceFiles.keys()].entries()) {
      check(); const nonce = randomUUID(); await installSqlImportFileAnswer(application, { nonce, path });
      await dialog.locator('.file-picker').click(); expect(await finishSqlImportFileAnswer(application, nonce)).toMatchObject({ calls: 1, restored: true });
      await expect(dialog.locator('.file-picker')).toContainText(basename(path));
      expect((await audit()).imports).toHaveLength(index);
      expect((await audit()).started).toHaveLength(index);
      await expect(report).toHaveCount(0);
      await expect(start).toBeEnabled(); await start.click();
      // 固定短SLEEP只为登记这次原导入线程，不以GUI空闲或任务提示猜测物理执行。
      const sleeping = index === 2 ? cancelStatement : 'SELECT SLEEP(3)';
      await expect.poll(async () => { const rows = await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND INFO=?', [database, sleeping]); for (const row of rows) threadIds.add(Number(row.ID)); return rows.length; }).toBe(1);
      if (index === 2) {
        const started = (await audit()).started[index]; expect(started).toBeDefined();
        expect(await observe('SELECT id FROM ' + table('subject') + ' ORDER BY id')).toEqual([{ id: 1 }, { id: 4 }, { id: 5 }]);
        await expect(dialog.locator('.file-picker')).toBeDisabled();
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: zh.transfer.text027, exact: true }, check)).click();
        await expect.poll(async () => (await audit()).cancels.length).toBe(1);
        expect((await audit()).cancels[0].taskId).toBe(started.taskId);
      }
      await expect.poll(async () => (await audit()).imports.length).toBe(index + 1);
      await expect.poll(async () => (await audit()).pending).toBe(0);
      const original = (await audit()).imports[index], receipt = sqlFileImportReceiptSchema.parse(original.result.sql);
      expect(receipt.taskId).toBe(original.taskId); expect(receipt.encoding).toBe('utf16le');
      await expect(report).toBeVisible(); await expect(report).toContainText(t.affected); await expect(report).toContainText(t.rollback);
      if (index === 0) {
        expect(receipt).toMatchObject({ termination: 'failed', completedStatements: 4, serverReportedAffectedRows: 2, failure: { phase: 'execute', statement: { ordinal: 5, location: { start: { offset: prefix.length, line: 5, column: 1 }, end: { offset: prefix.length + badStatement.length, line: 5, column: badStatement.length + 1 } } } }, rollback: { state: 'confirmed' }, transaction: 'closed' });
        await expect(report.getByText(`${t.completedStatements}：4`, { exact: true })).toBeVisible();
        await expect(report.getByText(`${t.affected}：2`, { exact: true })).toBeVisible();
        await expect(report).toContainText(t.ordinal(5)); await expect(report).toContainText(t.phases.execute);
        await expect(report).toContainText(t.position({ line: 5, column: 1 }, { line: 5, column: badStatement.length + 1 }));
        await expect(report).toContainText(t.rollbackStates.confirmed); await expect(report).toContainText(t.transactions.closed);
        await expect(report).toContainText(t.affectedHint);
        expect(await observe('SELECT id FROM ' + table('subject') + ' ORDER BY id')).toEqual([{ id: 1 }]);
      } else if (index === 1) {
        expect(receipt).toMatchObject({ termination: 'completed', completedStatements: 2, serverReportedAffectedRows: 1, rollback: { state: 'not-needed' }, transaction: 'closed' });
        await expect(report.getByText(`${t.affected}：1`, { exact: true })).toBeVisible();
        await expect(report).toContainText(t.completed); await expect(report).toContainText(t.rollbackStates['not-needed']);
        expect(await observe('SELECT id FROM ' + table('subject') + ' ORDER BY id')).toEqual([{ id: 1 }, { id: 4 }]);
      } else {
        expect(receipt).toMatchObject({ termination: 'cancelled', completedStatements: 3, serverReportedAffectedRows: 2, failure: { phase: 'execute', statement: { ordinal: 4, location: { start: { offset: cancelPrefix.length, line: 4, column: 1 }, end: { offset: cancelPrefix.length + cancelStatement.length, line: 4, column: cancelStatement.length + 1 } } } }, rollback: { state: 'confirmed' }, transaction: 'closed' });
        expect((await audit()).cancels).toEqual([{ taskId: original.taskId, ok: true }]);
        await expect(report).toContainText(t.cancelled); await expect(report).toContainText(t.ordinal(4)); await expect(report).toContainText(t.phases.execute);
        await expect(report).toContainText(t.position({ line: 4, column: 1 }, { line: 4, column: cancelStatement.length + 1 }));
        await expect(report.getByText(`${t.completedStatements}：3`, { exact: true })).toBeVisible();
        await expect(report.getByText(`${t.affected}：2`, { exact: true })).toBeVisible();
        await expect(report).toContainText(t.rollbackStates.confirmed); await expect(report).toContainText(t.transactions.closed);
        expect(await observe('SELECT id FROM ' + table('subject') + ' ORDER BY id')).toEqual([{ id: 1 }, { id: 4 }, { id: 5 }]);
      }
      await expect(start).toBeDisabled();
      await info.attach('SQL文件第' + (index + 1) + '次真实回执', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' });
      await info.attach('SQL文件第' + (index + 1) + '次原生报告', { body: await report.screenshot(), contentType: 'image/png' });
    }
    const result = await audit(); expect(result.imports).toHaveLength(3); expect(result.started).toHaveLength(3); expect(new Set(result.imports.map(value => value.taskId)).size).toBe(3); expect(new Set(result.choices.map(value => value.token)).size).toBe(3); expect(threadIds.size).toBe(3);
    expect(result.cancels).toEqual([{ taskId: result.imports[2].taskId, ok: true }]);
    await info.attach('SQL文件原Main三次任务及取消旁观', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    expect(pageErrors).toEqual([]);
    await application.evaluate(() => (globalThis as any).__sqlImportAudit.restore()); auditInstalled = false;
    await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: zh.common.done, exact: true }, check)).click();
  } catch (error) { failed = true; failure = error; }
  try {
    await info.attach('SQL文件原收尾前登记', { body: JSON.stringify({ database, owner: marker, observerId, importThreads: [...threadIds], createAttempted: created, ownerConfirmed: marked, sourceFiles: [...sourceFiles].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex') })) }), contentType: 'application/json' });
    check();
    if (auditInstalled) { expect((await audit()).pending).toBe(0); await application.evaluate(() => (globalThis as any).__sqlImportAudit.restore()); auditInstalled = false; }
    await confirmOwnedDesktopExit(info); check();
    if (created) {
      if (!marked || !/^dbark_sqlimport_ui_[a-f0-9]{32}$/.test(database)) throw Error('SQL导入原随机库owner未知，保留资源');
      expect(await observe('SELECT token FROM ' + table('__owner'))).toEqual([{ token: marker }]);
      for (const id of threadIds) expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [id])).toEqual([]);
      expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?', [database])).toEqual([]);
      await observe('SET SESSION lock_wait_timeout=5'); await observe('DROP DATABASE `' + database + '`');
      expect(await observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).toEqual([]);
    }
    for (const [path, bytes] of sourceFiles) { expect(await readFile(path)).toEqual(bytes); await unlink(path); } if (directory) await rmdir(directory);
    await info.attach('SQL文件原线程及清理登记', { body: JSON.stringify({ database, owner: marker, observerId, importThreads: [...threadIds], threadsRemaining: 0, databaseRemaining: 0, normalExit: true, 未验: ['utility逐语句物理发送账（由Engine实库专项另验）', '真实网络ACK丢失', '真实ROLLBACK失败', '系统原生文件窗口输入', '剪贴板', '安装包', 'macOS'] }), contentType: 'application/json' });
    await closeObserver();
    await info.attach('SQL文件原观察socket关闭', { body: JSON.stringify({ observerId, endAttempted: observerEndAttempted, sawClose: observerSawClose, socketClosed: observerSocket.closed }), contentType: 'application/json' });
  } catch (cleanup) {
    retainOwnedDesktopResources(info);
    if (!observerEndAttempted) {
      try { await closeObserver(); } catch (closing) { throw new AggregateError(failed ? [failure, cleanup, closing] : [cleanup, closing], 'SQL文件UI原现场保留且观察连接关闭未确认', { cause: failed ? failure : cleanup }); }
    }
    if (failed) throw new AggregateError([failure, cleanup], 'SQL文件UI失败且原资源收尾未确认', { cause: failure }); throw cleanup;
  }
  if (failed) throw failure;
});
