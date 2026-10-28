import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, unlink, readFile, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Socket } from 'node:net';
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { installConflictFileAnswer, finishConflictFileAnswer } from '../helpers/fileImportConflictUi';
import { installPreflightUiAudit, readPreflightUiAudit, removePreflightUiAudit, installPreflightReportAnswer, finishPreflightReportAnswer, armPreflightBusyObservation, finishPreflightBusyObservation } from '../helpers/fileImportPreflightUi';
import { fileImportConflictReportSchema } from '../../src/shared/fileImportConflict';
import { fileImportConflictZh as conflictText } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { fileImportTransactionZh } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { importPreflightZh as t } from '../../src/renderer/locales/importPreflight.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_FILE_IMPORT_PREFLIGHT_UI === '1';
test.skip(!enabled, '整文件预检正式窗口须预核200/13384并显式开启双门');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(180000);

test('原窗口预检322条坏文件、报告原子保存、新来源显式校验及两行精确原子导入', async ({}, info) => {
  if (process.platform !== 'win32') throw Error('本专项仅Windows，不能外推macOS验收');
  // 动态导入放在双门后，默认及list不读取私有凭据文件。
  const live = await import('./live-helpers'), env = live.environment, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT);
  if (!enabled || !['deve-server.yinzon.com', '192.168.31.200'].includes(host) || port !== 13384 || env.DBARK_TEST_TLS === '1' || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME || !env.DBARK_TEST_EXPECTED_UUID) throw Error('仅允许已预核200/13384既有普通隔离实例');
  const original = ownedDesktopResources(info), application = original.application, page = original.page;
  const check = () => { const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page) throw Error('预检原窗口归属变化'); };
  const database = 'dbark_importconflict_ui_' + randomUUID().replaceAll('-', ''), marker = randomUUID(), threads = new Set<number>();
  const observer = await mysql.createConnection({ host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000 });
  const observerId = observer.threadId, socket = (observer as unknown as { connection: { stream: Socket } }).connection.stream;
  let sawClose = socket.closed === true, endAttempted = false, created = false, marked = false, installed = false, held = false, directory = '', failed = false, failure: unknown, reportVerified = false;
  const closed = new Promise<void>(resolve => { if (sawClose) resolve(); else socket.once('close', () => { sawClose = true; resolve(); }); });
  /** 原观察连接只关闭一次，正常end后等真实socket关闭；不重连或强停补绿。 */
  const endObserver = async () => { if (endAttempted) throw Error('原观察连接不能重复关闭'); endAttempted = true; await observer.end(); let timer: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('原观察socket关闭未确认')), 5000); })]); } finally { if (timer) clearTimeout(timer); } expect(sawClose && socket.closed).toBe(true); };
  /** 观察者Header必须零警告，行集合不经过被测文件序列化器。 */
  const observe = async (sql: string, values: (string | number)[] = []) => { check(); const [rows] = await observer.query<RowDataPacket[] | ResultSetHeader>(sql, values); check(); if (Array.isArray(rows)) return rows.map(row => ({ ...row })); expect(rows.fieldCount).toBe(0); expect(Number.isSafeInteger(rows.affectedRows) && rows.affectedRows >= 0).toBe(true); expect(Number.isInteger(rows.serverStatus) && rows.serverStatus >= 0 && rows.serverStatus <= 65535).toBe(true); expect(rows.warningStatus).toBe(0); return []; };
  const table = (name: string) => '`' + database + '`.`' + name + '`';
  const files: { path: string; bytes: Buffer }[] = []; let reportPath = '';
  const audit = async () => { check(); const value = await readPreflightUiAudit(application); check(); return value; };
  const snapshot = () => observe('SELECT CAST(n AS CHAR) AS n,CAST(amount AS CHAR) AS amount,note,HEX(payload) AS payload FROM ' + table('subject') + ' ORDER BY ' + table('subject') + '.n');
  try {
    const identity = (await observe('SELECT @@hostname AS hostname,VERSION() AS version,CONNECTION_ID() AS id'))[0]; expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(Number(identity.id)).toBe(observerId); expect(String(identity.version)).not.toContain('MariaDB'); expect((await observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(env.DBARK_TEST_EXPECTED_UUID);
    await info.attach('预检原资源', { body: JSON.stringify({ database, owner: marker, observerId, port, version: identity.version }), contentType: 'application/json' });
    created = true; const context = await live.connectAndCreate(database, { page, application, assertCurrent: check });
    await observe('CREATE TABLE ' + table('__owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB'); await observe('INSERT INTO ' + table('__owner') + ' VALUES (?)', [marker]); marked = true;
    await observe('CREATE TABLE ' + table('subject') + ' (n BIGINT UNSIGNED NOT NULL PRIMARY KEY,amount DECIMAL(30,12) NOT NULL,note TEXT NULL,payload BLOB NULL) ENGINE=InnoDB');
    await observe('INSERT INTO ' + table('subject') + " VALUES(7,0,'原值',X'00FF')");
    const before = await snapshot(), definition = await observe('SHOW CREATE TABLE ' + table('subject'));
    directory = await mkdtemp(join(tmpdir(), 'dbark-importconflict-ui-')); reportPath = join(directory, 'preflight-report.json');
    const sources = [
      { name: 'bad-after-preview.csv', text: 'n,amount,note,payload\r\n' + '8,1.25,"正常\r\n跨行",\\N\r\n'.repeat(21) + '私密坏整数,私密坏小数,不能进入报告,\\N\r\n'.repeat(301) },
      { name: 'valid-two.csv', text: 'n,amount,note,payload\r\n7,9007199254740993.123456789012,\\N,base64:AP8=\r\n18446744073709551615,-9007199254740993.123456789011,"中文😀\r\n跨行",\\N\r\n' }
    ];
    for (const source of sources) { const path = join(directory, source.name), bytes = Buffer.from(source.text, 'utf8'); await writeFile(path, bytes, { flag: 'wx' }); files.push({ path, bytes }); }
    await installPreflightUiAudit(application, { connectionId: context.connectionId, database, table: 'subject' }); installed = true;
    await page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }).getByRole('button', { name: database, exact: true }).click();
    await page.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click(); const tab = page.locator('.table-tab:visible'); await expect(tab.getByRole('grid')).toBeVisible(); await tab.getByRole('button', { name: zh.common.import, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${zh.transfer.text004} · ${database}.subject`, exact: true }), panel = dialog.getByRole('region', { name: t.title, exact: true }), start = dialog.getByRole('button', { name: zh.transfer.text028, exact: true }), run = panel.getByRole('button', { name: t.run, exact: true });
    await dialog.getByRole('combobox', { name: zh.transfer.text006, exact: true }).selectOption('csv');
    /** 准确一次性回答原文件框，Main仍签发真实唯一token；不声明系统键鼠输入已验。 */
    const choose = async (file: typeof files[number]) => { const nonce = randomUUID(); check(); await installConflictFileAnswer(application, { nonce, path: file.path, format: 'csv' }); check(); await dialog.locator('.file-picker').click(); expect(await finishConflictFileAnswer(application, nonce)).toEqual({ calls: 1, originalRestored: true, nativeInputVerified: false }); await expect(dialog.locator('.file-picker')).toContainText(basename(file.path)); await expect(dialog.locator('.sample-grid').getByRole('grid')).toBeVisible(); for (const name of ['n', 'amount', 'note', 'payload']) await expect(dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, name), exact: true })).toHaveValue(name); };
    await choose(files[0]); expect((await audit()).imports).toHaveLength(0);
    await armPreflightBusyObservation(run, zh.transfer.text028); await run.click(); await expect.poll(async () => (await audit()).checks.length).toBe(1); await expect.poll(async () => (await audit()).pending).toBe(0);
    expect((await finishPreflightBusyObservation(run)).some(state => state.runDisabled && state.startDisabled)).toBe(true);
    await expect(panel).toContainText(t.summary(322, 21, 301, 602, 200)); await expect(panel).toContainText(t.truncated); await expect(panel.locator('tbody tr')).toHaveCount(20); await expect(panel.locator('tbody tr').first().getByRole('cell').first()).toHaveText('22'); await expect(start).toBeDisabled();
    expect((await audit()).imports).toHaveLength(0); expect(await snapshot()).toEqual(before); expect(await observe('SHOW CREATE TABLE ' + table('subject'))).toEqual(definition);
    await info.attach('坏文件预检正式报告区域', { body: await panel.screenshot(), contentType: 'image/png' });
    const nonce = randomUUID(); await installPreflightReportAnswer(application, { nonce, path: reportPath, suggestedName: t.reportName }); await panel.getByRole('button', { name: t.export, exact: true }).click(); expect(await finishPreflightReportAnswer(application, nonce)).toEqual({ calls: 1, originalRestored: true, nativeInputVerified: false });
    await expect.poll(async () => (await audit()).exports.length).toBe(1); await expect.poll(async () => (await audit()).pending).toBe(0);
    // 独立Node JSON.parse核原文件，不调用产品报告投影器生成期待。
    const raw = await readFile(reportPath, 'utf8'), report = JSON.parse(raw) as Record<string, unknown>[];
    expect(report).toHaveLength(201); expect(report[0]).toMatchObject({ kind: 'summary', formatVersion: 1, database, table: 'subject', checkedRecords: 322, validRecords: 21, invalidRecords: 301, issueCount: 602, retainedIssues: 200, complete: true, truncated: true, termination: 'complete' });
    expect(report.slice(1).every(row => row.kind === 'issue' && row.code === 'invalid-value' && Number(row.record) >= 22 && ['n', 'amount'].includes(String(row.target)))).toBe(true);
    expect(report[1]).toMatchObject({ record: 22, source: 'n', target: 'n' }); expect(report[2]).toMatchObject({ record: 22, source: 'amount', target: 'amount' });
    expect(raw).not.toMatch(/私密坏整数|私密坏小数|不能进入报告|fileToken|filePath/); for (const choice of (await audit()).choices) expect(raw).not.toContain(choice.token);
    // 检查解码后的字符串，不能让Windows路径的JSON反斜杠转义绕过路径排除断言。
    const reportStrings = report.flatMap(row => Object.values(row).filter((value): value is string => typeof value === 'string'));
    for (const path of [...files.map(file => file.path), reportPath]) expect(reportStrings.some(value => value.includes(path))).toBe(false);
    reportVerified = true;
    await expect(start).toBeDisabled(); expect(await snapshot()).toEqual(before); for (const file of files) expect(await readFile(file.path)).toEqual(file.bytes);
    await choose(files[1]); await expect(panel).not.toContainText(t.summary(322, 21, 301, 602, 200)); await expect(panel.locator('tbody tr')).toHaveCount(0); await expect(panel.getByRole('button', { name: t.export, exact: true })).toBeDisabled();
    // 换来源撤销坏报告，预检属于可选操作；此处明确设置策略后主动校验，不宣称产品强制预检。
    await dialog.getByRole('combobox', { name: conflictText.mode, exact: true }).selectOption('upsert'); await dialog.getByRole('combobox', { name: conflictText.key, exact: true }).selectOption('PRIMARY'); await dialog.getByRole('combobox', { name: fileImportTransactionZh.label, exact: true }).selectOption('atomic');
    await armPreflightBusyObservation(run, zh.transfer.text028); await run.click(); await expect.poll(async () => (await audit()).checks.length).toBe(2); await expect.poll(async () => (await audit()).pending).toBe(0); expect((await finishPreflightBusyObservation(run)).some(state => state.runDisabled && state.startDisabled)).toBe(true); await expect(panel).toContainText(t.summary(2, 2, 0, 0, 0)); await expect(panel).toContainText(t.passed); await expect(start).toBeEnabled();
    expect((await audit()).imports).toHaveLength(0); expect(await snapshot()).toEqual(before);
    // 沿原冲突UI的真实行锁等待登记唯一原导入线程，不按短预检会话或DB字段猜测线程归属。
    await observe('START TRANSACTION'); held = true; await observe('SELECT n FROM ' + table('subject') + ' WHERE n=7 FOR UPDATE'); await start.click();
    await expect.poll(async () => { const rows = await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND ID<>? AND INFO LIKE ?', [database, observerId, '%FOR UPDATE%']); for (const row of rows) threads.add(Number(row.ID)); return rows.length; }).toBe(1);
    await observe('ROLLBACK'); held = false; await expect.poll(async () => (await audit()).imports.length).toBe(1); await expect.poll(async () => (await audit()).pending).toBe(0);
    const imported = (await audit()).imports[0], receipt = fileImportConflictReportSchema.parse(imported.result.conflicts);
    expect(receipt).toMatchObject({ taskId: imported.taskId, termination: 'completed', readRecords: 2, committed: { inserted: 1, matchedUpdates: 1, skippedExisting: 0, skippedMissing: 0 }, currentBatch: 'none' });
    await expect(dialog.getByRole('status', { name: conflictText.report, exact: true })).toContainText(conflictText.completed); await expect(start).toBeDisabled(); expect(threads.size).toBe(1);
    expect(await snapshot()).toEqual([{ n: '7', amount: '9007199254740993.123456789012', note: null, payload: '00FF' }, { n: '18446744073709551615', amount: '-9007199254740993.123456789011', note: '中文😀\r\n跨行', payload: null }]);
    expect(await observe('SHOW CREATE TABLE ' + table('subject'))).toEqual(definition); for (const file of files) expect(await readFile(file.path)).toEqual(file.bytes); expect(pageErrors).toEqual([]);
    await info.attach('预检窗口报告及原子导入回执', { body: JSON.stringify({ bad: { checked: 322, invalid: 301, issueCount: 602, retained: report.length - 1 }, good: { checked: 2, issueCount: 0 }, receipt }), contentType: 'application/json' }); await info.attach('预检正式报告区域', { body: await panel.screenshot(), contentType: 'image/png' });
    await removePreflightUiAudit(application); installed = false; await dialog.getByRole('button', { name: zh.common.done, exact: true }).click();
  } catch (error) { failed = true; failure = error; }
  if (failed) {
    // 原用例失败即保留窗口、库及文件；仅关闭本例观察连接，释放其自有行锁，不补退出或清库。
    retainOwnedDesktopResources(info);
    await info.attach('预检UI原失败现场保留', { body: JSON.stringify({ database, owner: marker, observerId, importThreads: [...threads], created, marked, reportVerified, directory, normalExitAttempted: false, databaseRemoved: false, sourceFilesRemoved: false, automaticRetry: false }), contentType: 'application/json' });
    if (!endAttempted) try { await endObserver(); } catch (closing) { throw new AggregateError([failure, closing], '预检UI原失败现场保留且观察连接关闭未确认', { cause: failure }); }
    throw failure;
  }
  try {
    if (held) { await observe('ROLLBACK'); held = false; }
    await info.attach('预检原资源收尾前登记', { body: JSON.stringify({ database, owner: marker, observerId, importThreads: [...threads], created, marked, reportVerified, files: files.map(file => ({ path: file.path, sha256: createHash('sha256').update(file.bytes).digest('hex') })) }), contentType: 'application/json' });
    if (installed) { expect((await audit()).pending).toBe(0); await removePreflightUiAudit(application); installed = false; }
    await confirmOwnedDesktopExit(info); check();
    if (created) { if (!marked || !/^dbark_importconflict_ui_[a-f0-9]{32}$/.test(database)) throw Error('预检原owner未知，保留资源'); expect(await observe('SELECT token FROM ' + table('__owner'))).toEqual([{ token: marker }]); for (const id of threads) expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [id])).toEqual([]); expect(await observe('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=?', [database])).toEqual([]); await observe('SET SESSION lock_wait_timeout=5'); await observe('DROP DATABASE `' + database + '`'); expect(await observe('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).toEqual([]); }
    for (const file of files) { expect(await readFile(file.path)).toEqual(file.bytes); await unlink(file.path); } if (reportPath && reportVerified) await unlink(reportPath); if (directory) await rmdir(directory); await endObserver();
    await info.attach('预检原线程及清理终态', { body: JSON.stringify({ database, owner: marker, observerId, importThreads: [...threads], normalExit: true, socketClosed: socket.closed, sawClose, databaseRemaining: 0, 未验: ['短预检会话物理线程及逐命令账由Engine18例另证；此UI不宣称全线程登记', '预检取消交互', '系统原生文件窗口键鼠输入', '剪贴板', 'macOS', '安装包', '真实COMMIT断线或ROLLBACK失败'] }), contentType: 'application/json' });
  } catch (cleanup) { retainOwnedDesktopResources(info); if (!endAttempted) try { await endObserver(); } catch (closing) { throw new AggregateError(failed ? [failure, cleanup, closing] : [cleanup, closing], '预检UI原现场保留且观察关闭未确认', { cause: failed ? failure : cleanup }); } if (failed) throw new AggregateError([failure, cleanup], '原预检UI及收尾失败', { cause: failure }); throw cleanup; }
  if (failed) throw failure;
});
