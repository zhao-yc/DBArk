import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Socket } from 'node:net';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Locator } from '@playwright/test';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { installTableDraftAudit, readTableDraftAudit, removeTableDraftAudit, installTableDraftFileAnswer, finishTableDraftFileAnswer } from '../helpers/tableDraftUi';
import { selectTableDraftProcesslist, tableDraftProcesslistNeedsCapability, tableDraftProcesslistQuery, assertTableDraftProcesslistVisible, assertTableDraftNoWarnings, assertTableDraftProcesslistWarnings, type TableDraftProcesslistPolicy, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';
import { decodeTableDraft, type TableDraftDocument } from '../../src/shared/tableDraft';
import { tableDraftFilesZh as text } from '../../src/renderer/locales/tableDraftFiles.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

const listing = process.argv.some(value => value === 'list' || value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_DRAFT_UI === '1';
test.skip(!enabled, '表格草稿正式窗口须统筹预核200隔离实例并显式开启双门');
/** 启动前仅核源码入口，不改变原harness的生命周期门。 */
const launchGuard = { assertCurrent() { if (!enabled || process.platform !== 'win32' || process.env.DBARK_EXECUTABLE_PATH) throw Error('草稿GUI只接受已开启双门的Windows源码入口'); } };
test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: launchGuard, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(180000); test.describe.configure({ mode: 'serial', retries: 0 });

type Baseline = { id: string; note: string; big_value: string; amount: string; stamp: string; payload: string | null; nullable_value: string | null };
type NativeConnection = Parameters<typeof import('../../src/engine/connection').closeMysqlConnection>[0];

test('真实表格第二页混合草稿保存、重开独立恢复、一次集中提交及原行并发拒绝', async ({ trace, screenshot, video }, info) => {
  if (!enabled || process.platform !== 'win32' || trace !== 'off' || screenshot !== 'off' || video !== 'off') throw Error('本专项仅开启双门的Windows源码原窗口且禁止轨迹、视频和自动截图');
  const { default: mysql } = await import('mysql2/promise'), { closeMysqlConnection } = await import('../../src/engine/connection');
  const live = await import('./live-helpers'), env = live.environment, host = env.DBARK_TEST_HOST ?? '', port = Number(env.DBARK_TEST_PORT), tls = env.DBARK_TEST_TLS === '1';
  if (!enabled || !['deve-server.yinzon.com', '192.168.31.200'].includes(host) || ![13357, 13380, 13384, 13310, 13311, 13484].includes(port) || !env.DBARK_TEST_USER || !env.DBARK_TEST_EXPECTED_HOSTNAME) throw Error('仅允许预核200六个隔离实例');
  if (port === 13484 && (!tls || !env.DBARK_TEST_CA)) throw Error('13484必须保留严格TLS及CA');
  const original = ownedDesktopResources(info), { page, application } = original;
  const check = () => { const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page) throw Error('草稿原桌面归属变化'); };
  const database = 'dbark_tabledraftui_' + randomUUID().replaceAll('-', ''), marker = randomUUID(), threads = new Set<number>();
  const options = { host, port, user: env.DBARK_TEST_USER, password: env.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, connectTimeout: 15000, ...(tls ? { ssl: { ca: readFileSync(env.DBARK_TEST_CA!), rejectUnauthorized: true, verifyIdentity: true } } : {}) };
  const observer = await mysql.createConnection(options), observerId = observer.threadId;
  const native = (observer as unknown as { connection: NativeConnection }).connection, stream = (native as unknown as { stream: Socket }).stream;
  let observerClosing = false, observerClosed = false, created = false, marked = false, installed = false, fileAnswer: string | undefined, directory = '', failed = false, failure: unknown, serverVersion = '', verifiedMysqlUuid: string | undefined, processlist: TableDraftProcesslistPolicy | undefined;
  const files: { path: string; bytes: Buffer }[] = [];
  /** 原观察流仅关闭一次；复用严格QUIT和真实close门，不补强停或重试。 */
  const closeObserver = async () => {
    if (observerClosing || observerClosed || (observer as unknown as { connection: NativeConnection }).connection !== native || (native as unknown as { stream: Socket }).stream !== stream) throw Error('草稿原观察流归属或关闭次数无效');
    observerClosing = true; await closeMysqlConnection(native, true); expect(stream.closed).toBe(true); observerClosed = true;
  };
  /** 原始观察读保留原诊断，由各明确用途决定诊断门，不按SQL模糊匹配。 */
  const readObserver = async (sql: string, values: (string | number | Buffer | null)[] = []) => {
    check(); if (observerClosed || observerClosing) throw Error('草稿原观察连接已关闭');
    const [rows] = await observer.query<RowDataPacket[] | ResultSetHeader>(sql, values); check();
    const [count] = await observer.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'); check();
    const [warnings] = await observer.query<RowDataPacket[]>('SHOW WARNINGS'); check();
    return { rows, count, warnings };
  };
  /** 外部普通SQL和写入Header仍必须零警告，范围保持本轮随机库。 */
  const observe = async (sql: string, values: (string | number | Buffer | null)[] = []) => {
    const { rows, count, warnings } = await readObserver(sql, values);
    assertTableDraftNoWarnings(count, warnings); expect(warnings).toEqual([]);
    if (Array.isArray(rows)) return rows.map(row => ({ ...row }));
    expect(rows.fieldCount).toBe(0); expect(rows.warningStatus).toBe(0); expect(Number.isSafeInteger(rows.affectedRows) && rows.affectedRows >= 0).toBe(true); expect(Number.isInteger(rows.serverStatus) && rows.serverStatus >= 0 && rows.serverStatus <= 65535).toBe(true); return [];
  };
  const table = (name: string) => '`' + database + '`.`' + name + '`';
  const audit = async () => { check(); const result = await readTableDraftAudit(application); check(); for (const id of result.connectionThreads) threads.add(id); return result; };
  /** 只有固定来源与受控ID/数据库请求可以进入这一已知诊断模式。 */
  const readProcesslist = async (request: TableDraftProcesslistRequest) => {
    if (!processlist) throw Error('草稿审计来源尚未核实');
    const query = tableDraftProcesslistQuery(processlist, request), result = await readObserver(query.sql, query.values);
    assertTableDraftProcesslistWarnings(processlist, result.count, result.warnings);
    if (!Array.isArray(result.rows)) throw Error('草稿进程审计未返回行集合');
    return result.rows;
  };
  /** 来源在真实身份核对后固定，审计前必须看到当前原observer的唯一ID。 */
  const observerVisible = async () => assertTableDraftProcesslistVisible(await readProcesslist({ kind: 'ids', ids: [observerId] }), observerId);
  const auditEmpty = async (sql: string, values: (string | number | Buffer | null)[] = []) => { await observerVisible(); expect(await observe(sql, values)).toEqual([]); };
  const auditProcessesEmpty = async (request: TableDraftProcesslistRequest) => { await observerVisible(); expect(await readProcesslist(request)).toEqual([]); };
  /** 只登记实际可观察的线程，不把未取得ID的短连接补造成已登记资源。 */
  const collectThreads = async () => { await observerVisible(); for (const row of await readProcesslist({ kind: 'collect', database, excludeId: observerId })) threads.add(Number(row.ID)); if (installed) await audit(); };
  const rowsSql = 'SELECT CAST(id AS CHAR) AS id,note,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,DATE_FORMAT(stamp,\'%Y-%m-%d %H:%i:%s.%f\') AS stamp,HEX(payload) AS payload,nullable_value FROM ' + table('subject') + ' ORDER BY id';
  const baseline = async () => await observe(rowsSql) as Baseline[];
  try {
    const identity = (await observe('SELECT @@hostname AS hostname,VERSION() AS version,CONNECTION_ID() AS id'))[0]; expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(Number(identity.id)).toBe(observerId); serverVersion = String(identity.version);
    if (!serverVersion.includes('MariaDB')) { if (!env.DBARK_TEST_EXPECTED_UUID) throw Error('未提供本轮MySQL UUID，未建库'); expect((await observe('SELECT @@server_uuid AS uuid'))[0].uuid).toBe(env.DBARK_TEST_EXPECTED_UUID); verifiedMysqlUuid = env.DBARK_TEST_EXPECTED_UUID; }
    const dialect = serverVersion.includes('MariaDB') ? 'mariadb' : 'mysql';
    const capability = tableDraftProcesslistNeedsCapability(dialect, serverVersion) ? await observe('SELECT @@performance_schema AS enabled') : undefined;
    processlist = selectTableDraftProcesslist(dialect, serverVersion, capability); await observerVisible();
    await info.attach('草稿原资源', { body: JSON.stringify({ database, owner: marker, observerId, port, version: identity.version }), contentType: 'application/json' });
    created = true; const context = await live.connectAndCreate(database, { page, application, assertCurrent: check });
    await observe('CREATE TABLE ' + table('__owner') + ' (token VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB'); await observe('INSERT INTO ' + table('__owner') + ' VALUES (?)', [marker]); marked = true;
    await observe('CREATE TABLE ' + table('subject') + " (id BIGINT UNSIGNED NOT NULL PRIMARY KEY,note VARCHAR(90) NOT NULL DEFAULT '',big_value BIGINT UNSIGNED NOT NULL DEFAULT 18446744073709551615,amount DECIMAL(30,12) NOT NULL DEFAULT 9007199254740993.123456789012,stamp DATETIME(6) NOT NULL DEFAULT '2026-10-27 01:02:03.123456',payload VARBINARY(16) NULL DEFAULT NULL,nullable_value VARCHAR(32) NULL DEFAULT NULL) ENGINE=InnoDB");
    const start = 9007199254740993n, newId = '18446744073709551614';
    const initial: Baseline[] = Array.from({ length: 61 }, (_, index) => ({ id: String(start + BigInt(index)), note: 'row-' + String(index + 1).padStart(2, '0'), big_value: '18446744073709551615', amount: '9007199254740993.123456789012', stamp: '2026-10-27 01:02:03.123456', payload: '00FF8000', nullable_value: index % 2 ? '' : null }));
    await observe('INSERT INTO ' + table('subject') + ' (id,note,big_value,amount,stamp,payload,nullable_value) VALUES ' + initial.map(() => '(?,?,?,?,?,?,?)').join(','), initial.flatMap(row => [row.id, row.note, row.big_value, row.amount, row.stamp, Buffer.from('00ff8000', 'hex'), row.nullable_value]));
    expect(await baseline()).toEqual(initial);
    directory = await mkdtemp(join(tmpdir(), 'dbark-tabledraft-ui-'));
    await installTableDraftAudit(application, { connectionId: context.connectionId, database, table: 'subject' }); installed = true;
    const databaseNode = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await (await (await import('./navigation-menu')).navigationMenuItem(databaseNode, { name: database, exact: true }, check)).click();
    const openTable = async () => { check(); await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.object-row'), { name: 'subject', exact: true }, check)).click(); await expect(page.locator('.table-tab:visible').getByRole('grid')).toBeVisible(); await expect(page.locator('.table-tab:visible').locator('.loading-overlay')).toHaveCount(0); await expect.poll(async () => (await audit()).pending).toBe(0); await collectThreads(); };
    await openTable(); const tab = page.locator('.table-tab:visible'), grid = tab.getByRole('grid');
    await tab.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50');
    await expect.poll(async () => (await audit()).pages.at(-1)).toMatchObject({ page: 1, pageSize: 50, count: 50, hasMore: true });
    await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: zh.common.pageNext, exact: true }, check)).click();
    await expect.poll(async () => (await audit()).pages.at(-1)).toMatchObject({ page: 2, pageSize: 50, count: 11, hasMore: false });
    const sourceRow = (note: string) => grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: note, exact: true }) });
    /** 只读真实列头首文本节点，避免把紧接的类型small文本合并成列名。 */
    const cell = async (row: Locator, key: string) => {
      const indices = await tab.getByRole('columnheader').evaluateAll((headers, key) => headers.filter(header => header.querySelector('.data-header > span')?.firstChild?.textContent === key).map(header => header.getAttribute('aria-colindex')), key);
      if (indices.length !== 1 || !indices[0] || !/^\d+$/.test(indices[0])) throw Error('草稿真实网格列坐标缺失或不唯一');
      return row.locator('[role="gridcell"][aria-colindex="' + indices[0] + '"]');
    };
    const edit = async (row: Locator, key: string, value: string) => { check(); await (await cell(row, key)).dblclick(); const input = tab.locator('.grid-input'); await expect(input).toBeVisible(); await input.fill(value); await input.press('Enter'); await expect(input).toHaveCount(0); check(); };
    await edit(sourceRow('row-51'), 'note', 'saved-update-51');
    await sourceRow('row-52').getByRole('checkbox').check(); await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: zh.common.delete, exact: true }, check)).click();
    await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: zh.common.add, exact: true }, check)).click(); await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const inserted = tab.locator('.row-inserted'); await expect(inserted).toHaveCount(1); await edit(inserted, 'id', newId); await edit(inserted, 'note', 'saved-insert');
    await expect(tab.getByRole('button', { name: text.open, exact: true })).toBeDisabled(); expect(await baseline()).toEqual(initial);
    /** 原UI写出敏感草稿文件，独立读取磁盘字节后才登记，不伪造保存回包。 */
    const save = async (name: string): Promise<TableDraftDocument> => {
      await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: text.save, exact: true }, check)).click(); const dialog = page.getByRole('dialog', { name: text.saveTitle, exact: true });
      await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: text.saveAction, exact: true })).toBeDisabled();
      await dialog.getByRole('checkbox', { name: text.saveAcknowledgement, exact: true }).check();
      const path = join(directory, name), nonce = randomUUID(); fileAnswer = nonce;
      await installTableDraftFileAnswer(application, { nonce, path, mode: 'save' }); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.saveAction, exact: true }, check)).click();
      await expect(dialog.getByRole('status')).toContainText(text.saved); expect(await finishTableDraftFileAnswer(application, nonce)).toMatchObject({ calls: 1, originalRestored: true }); fileAnswer = undefined;
      const bytes = await readFile(path), document = decodeTableDraft(bytes.toString('utf8')); files.push({ path, bytes });
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.close, exact: true }, check)).click(); await expect(dialog).toBeHidden();
      await expect(tab.getByRole('button', { name: text.open, exact: true })).toBeDisabled();
      await expect(page.locator('.workspace-tab-button.active .dirty-dot')).toHaveCount(1); return document;
    };
    const document = await save('mixed.dbark-draft');
    expect(document.changes).toHaveLength(3); expect(document.changes.map(change => change.kind)).toEqual(['update', 'delete', 'insert']);
    const first = document.changes[0], deleted = document.changes[1], added = document.changes[2];
    if (first.kind !== 'update' || deleted.kind !== 'delete' || added.kind !== 'insert') throw Error('草稿源操作次序不符');
    expect(first.values).toEqual({ note: 'saved-update-51' }); expect(first.before).toMatchObject({ id: initial[50].id, note: 'row-51', big_value: initial[50].big_value, amount: initial[50].amount, stamp: initial[50].stamp, payload: { type: 'binary', base64: 'AP+AAA==' }, nullable_value: null });
    expect(deleted.before.id).toBe(initial[51].id); expect(added.values).toEqual({ id: newId, note: 'saved-insert' });
    const firstAudit = await audit(); expect(firstAudit.saves).toEqual([{ payload: { target: document.target, metadataKey: document.metadataKey, changes: document.changes }, ok: true }]); expect(firstAudit.applies).toEqual([]); expect(await baseline()).toEqual(initial);
    // 使用既有原生确认接口适配丢弃已保存的RAM草稿；关闭和重开均为真实Tab/对象树点击。
    await live.acceptNativeConfirmation({ page, application, assertCurrent: check });
    const closeTable = async () => { await page.locator('.workspace-tab-button.active .tab-close').click(); await expect(page.locator('.table-tab:visible')).toHaveCount(0); check(); };
    await closeTable(); await openTable();
    await expect.poll(async () => (await audit()).pages.at(-1)).toMatchObject({ page: 1, pageSize: 50, count: 50, hasMore: true });
    await expect(tab.getByRole('button', { name: text.open, exact: true })).toBeEnabled(); expect(await baseline()).toEqual(initial);
    /** 打开与核验都走原Main及原Engine，不注入页面状态或替代恢复方法。 */
    const openDraft = async (file: string) => {
      await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: text.open, exact: true }, check)).click(); const dialog = page.getByRole('dialog', { name: text.restoreTitle, exact: true });
      const nonce = randomUUID(); fileAnswer = nonce; await installTableDraftFileAnswer(application, { nonce, path: file, mode: 'open' });
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.choose, exact: true }, check)).click(); await expect(dialog.getByRole('region', { name: text.file, exact: true })).toBeVisible();
      expect(await finishTableDraftFileAnswer(application, nonce)).toMatchObject({ calls: 1, originalRestored: true }); fileAnswer = undefined;
      await dialog.getByRole('checkbox', { name: text.restoreAcknowledgement, exact: true }).check(); return dialog;
    };
    let restore = await openDraft(files[0].path); await expect(restore.getByLabel(text.summary, { exact: true })).toHaveText('新增：1；修改：1；删除：1');
    await (await (await import('./navigation-menu')).navigationMenuItem(restore, { name: text.restoreAction, exact: true }, check)).click(); await expect(restore).toBeHidden();
    await expect(tab.getByRole('status')).toHaveText(text.restoredScope); await expect(grid.getByRole('row')).toHaveCount(4);
    await expect(tab.locator('.row-modified')).toHaveCount(1); await expect(tab.locator('.row-deleted')).toHaveCount(1); await expect(tab.locator('.row-inserted')).toHaveCount(1);
    await expect(await cell(sourceRow('saved-update-51'), 'id')).toHaveText(initial[50].id); await expect(await cell(sourceRow('row-52'), 'id')).toHaveText(initial[51].id); await expect(await cell(sourceRow('saved-insert'), 'id')).toHaveText(newId);
    await expect(tab.getByRole('button', { name: zh.common.pageNext, exact: true })).toBeDisabled(); await expect(tab.getByRole('button', { name: zh.common.pagePrevious, exact: true })).toBeDisabled();
    await expect(tab.getByRole('button', { name: text.open, exact: true })).toBeDisabled(); expect(await baseline()).toEqual(initial);
    let state = await audit(); expect(state.verifies).toHaveLength(1); expect(state.verifies[0]).toMatchObject({ ok: true, count: 3 }); expect(state.applies).toHaveLength(0);
    await info.attach('原独立恢复草稿视图', { body: await tab.screenshot(), contentType: 'image/png' });
    await (await (await import('./navigation-menu')).navigationMenuItem(tab, { name: zh.table.text019, exact: true }, check)).click(); const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
    await expect(preview.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await expect(preview.locator('.monaco-editor .view-lines')).toContainText('DELETE'); await expect(preview.locator('.monaco-editor .view-lines')).toContainText('INSERT'); expect(await baseline()).toEqual(initial);
    state = await audit(); expect(state.previews).toEqual([{ changes: document.changes, ok: true }]); expect(state.applies).toHaveLength(0);
    await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: zh.common.confirmApply, exact: true }, check)).click(); await expect(preview).toBeHidden();
    await expect.poll(async () => (await audit()).applies.length).toBe(1); await expect.poll(async () => (await audit()).pending).toBe(0); await expect(tab.locator('.loading-overlay')).toHaveCount(0);
    const expected = [...initial.filter(row => row.id !== initial[51].id).map(row => row.id === initial[50].id ? { ...row, note: 'saved-update-51' } : row), { id: newId, note: 'saved-insert', big_value: initial[0].big_value, amount: initial[0].amount, stamp: initial[0].stamp, payload: null, nullable_value: null }];
    expect(await baseline()).toEqual(expected); expect((await audit()).applies).toEqual([{ taskId: expect.any(String), changes: document.changes, ok: true }]);
    await expect(page.locator('.workspace-tab-button.active .dirty-dot')).toHaveCount(0);
    // 第二份文件保留原before；由独立连接改变原行，真实恢复必须失败，不能更新成新before。
    await edit(sourceRow('row-01'), 'note', 'stale-attempt'); const stale = await save('stale.dbark-draft'); expect(stale.changes).toHaveLength(1);
    await closeTable(); await openTable(); await observe('UPDATE ' + table('subject') + ' SET note=? WHERE id=?', ['external-preserved', initial[0].id]);
    restore = await openDraft(files[1].path); await (await (await import('./navigation-menu')).navigationMenuItem(restore, { name: text.restoreAction, exact: true }, check)).click();
    await expect(restore.locator('.error-box')).toContainText('原始行已变化或不存在'); await expect(restore.getByRole('button', { name: text.close, exact: true })).toBeEnabled();
    state = await audit(); expect(state.verifies).toHaveLength(2); expect(state.verifies[1].ok).toBe(false); expect(new Set(state.verifies.map(value => value.taskId)).size).toBe(2); expect(state.applies).toHaveLength(1);
    await (await (await import('./navigation-menu')).navigationMenuItem(restore, { name: text.close, exact: true }, check)).click(); await expect(restore).toBeHidden();
    await expect(sourceRow('row-01')).toHaveCount(1); await expect(tab.locator('.row-modified,.row-deleted,.row-inserted')).toHaveCount(0); await expect(page.locator('.workspace-tab-button.active .dirty-dot')).toHaveCount(0);
    expect(await baseline()).toEqual(expected.map(row => row.id === initial[0].id ? { ...row, note: 'external-preserved' } : row));
    await collectThreads(); await expect.poll(async () => (await audit()).pending).toBe(0); state = await audit(); expect(state.saves).toHaveLength(2); expect(state.opens).toHaveLength(2); expect(state.applies).toHaveLength(1); expect(pageErrors).toEqual([]);
    await info.attach('草稿Main原始旁观', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    await info.attach('草稿文件字节', { body: JSON.stringify(files.map(file => ({ path: file.path, bytes: file.bytes.length, sha256: createHash('sha256').update(file.bytes).digest('hex') }))), contentType: 'application/json' });
  } catch (error) { failed = true; failure = error; }
  try {
    if (fileAnswer) throw Error('原文件选择未闭合，保留本轮现场');
    await info.attach('草稿收尾前原资源', { body: JSON.stringify({ database, owner: marker, observerId, threads: [...threads], created, marked, files: files.map(file => file.path) }), contentType: 'application/json' });
    if (installed) { expect((await audit()).pending).toBe(0); await removeTableDraftAudit(application); installed = false; }
    await confirmOwnedDesktopExit(info); check();
    if (created) {
      if (!marked || !/^dbark_tabledraftui_[a-f0-9]{32}$/.test(database)) throw Error('原草稿owner未确认，保留准确库');
      expect(await observe('SELECT token FROM ' + table('__owner'))).toEqual([{ token: marker }]);
      for (const id of threads) { await auditProcessesEmpty({ kind: 'ids', ids: [id] }); await auditEmpty('SELECT trx_mysql_thread_id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', [id]); }
      await auditProcessesEmpty({ kind: 'database', database });
      await observe('SET SESSION lock_wait_timeout=5'); await observe('DROP DATABASE `' + database + '`'); await auditEmpty('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database]);
    }
    for (const file of files) { expect(await readFile(file.path)).toEqual(file.bytes); await unlink(file.path); } if (directory) await rmdir(directory);
    await closeObserver();
    // 原观察流确认close后，独立新连接核其服务器线程/事务以及原登记资源、准确库均为零。
    const checker: Connection = await mysql.createConnection(options), checkerId = checker.threadId, checkerNative = (checker as unknown as { connection: NativeConnection }).connection, checkerStream = (checkerNative as unknown as { stream: Socket }).stream;
    let checkerFailure: unknown;
    /** 独立checker另取本连接能力，原始诊断不被通用零告警门提前吞掉。 */
    const checkerRaw = async (sql: string, values: (string | number)[] = []) => {
      check(); const [rows] = await checker.query<RowDataPacket[]>(sql, values); check();
      const [count] = await checker.query<RowDataPacket[]>('SHOW COUNT(*) WARNINGS'); check();
      const [warnings] = await checker.query<RowDataPacket[]>('SHOW WARNINGS'); check();
      expect(Array.isArray(rows)).toBe(true); return { rows, count, warnings };
    };
    const checkerRead = async (sql: string, values: (string | number)[] = []) => { const result = await checkerRaw(sql, values); assertTableDraftNoWarnings(result.count, result.warnings); expect(result.warnings).toEqual([]); return result.rows; };
    try {
      const identity = await checkerRead('SELECT @@hostname AS hostname,VERSION() AS version,CONNECTION_ID() AS id'); expect(identity).toHaveLength(1); expect(identity[0].hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME); expect(String(identity[0].version)).toBe(serverVersion); expect(Number(identity[0].id)).toBe(checkerId);
      if (verifiedMysqlUuid) { const uuid = await checkerRead('SELECT @@server_uuid AS uuid'); expect(uuid[0].uuid).toBe(verifiedMysqlUuid); }
      const checkerDialect = verifiedMysqlUuid ? 'mysql' : 'mariadb', checkerVersion = String(identity[0].version);
      const checkerCapability = tableDraftProcesslistNeedsCapability(checkerDialect, checkerVersion) ? await checkerRead('SELECT @@performance_schema AS enabled') : undefined;
      const checkerSource = selectTableDraftProcesslist(checkerDialect, checkerVersion, checkerCapability); expect(checkerSource).toEqual(processlist);
      const checkerProcesses = async (request: TableDraftProcesslistRequest) => { const query = tableDraftProcesslistQuery(checkerSource, request), result = await checkerRaw(query.sql, query.values); assertTableDraftProcesslistWarnings(checkerSource, result.count, result.warnings); return result.rows; };
      const checkerVisible = async () => assertTableDraftProcesslistVisible(await checkerProcesses({ kind: 'ids', ids: [checkerId] }), checkerId);
      const checkerEmpty = async (sql: string, values: (string | number)[] = []) => { await checkerVisible(); expect(await checkerRead(sql, values)).toEqual([]); };
      const checkerProcessesEmpty = async (request: TableDraftProcesslistRequest) => { await checkerVisible(); expect(await checkerProcesses(request)).toEqual([]); };
      for (const id of [observerId, ...threads]) { await checkerProcessesEmpty({ kind: 'ids', ids: [id] }); await checkerEmpty('SELECT trx_mysql_thread_id FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id=?', [id]); }
      await checkerProcessesEmpty({ kind: 'database', database });
      await checkerEmpty('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database]);
    } catch (error) { checkerFailure = error; }
    try { await closeMysqlConnection(checkerNative, true); expect(checkerStream.closed).toBe(true); } catch (error) { if (checkerFailure) throw new AggregateError([checkerFailure, error], '草稿独立核查与原核查流关闭均失败'); throw error; }
    if (checkerFailure) throw checkerFailure;
    await info.attach('草稿原资源清理终态', { body: JSON.stringify({ database, owner: marker, observerId, registeredThreads: [...threads], checkerId, normalExit: true, observerClosed, observerSocketClosed: stream.closed, checkerSocketClosed: checkerStream.closed, registeredThreadRemaining: 0, registeredTransactionRemaining: 0, databaseRemaining: 0, 未验: ['未取得ID的短连接逐语句物理账（另由Engine专项提供）', '真实等待与取消', '系统原生文件窗口输入', '剪贴板', 'macOS', '安装包'] }), contentType: 'application/json' });
  } catch (cleanup) {
    retainOwnedDesktopResources(info);
    if (!observerClosing && !observerClosed) try { await closeObserver(); } catch (closing) { throw new AggregateError(failed ? [failure, cleanup, closing] : [cleanup, closing], '草稿UI现场保留且观察流关闭未确认'); }
    if (failed) throw new AggregateError([failure, cleanup], '草稿原UI失败与收尾失败均保留'); throw cleanup;
  }
  if (failed) throw failure;
});
