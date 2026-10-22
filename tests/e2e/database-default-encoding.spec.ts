import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认/列表只登记未执行定义，不能加载桌面、认证、数据库驱动或读取输出。
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_DATABASE_DEFAULT_ENCODING_UI === '1') {
  const { bindDatabaseDefaultEncodingUi } = require('../helpers/databaseDefaultEncodingUi') as typeof import('../helpers/databaseDefaultEncodingUi');
  register(bindDatabaseDefaultEncodingUi(() => ({ env: process.env, platform: process.platform })));
} else baseTest.skip('数据库默认编码正式预览执行及现有表不变实库验收默认关闭（未执行）', () => {});

/** 真实随机库仅属于原用例；任何失败保留原窗口、数据库、控制连接及输出，不补做清理。 */
function register(binding: ReturnType<typeof import('../helpers/databaseDefaultEncodingUi')['bindDatabaseDefaultEncodingUi']>): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { installDatabaseDefaultEncodingUiAudit, readDatabaseDefaultEncodingUiAudit } = require('../helpers/databaseDefaultEncodingUi') as typeof import('../helpers/databaseDefaultEncodingUi');
  const { guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const { databaseDefaultEncodingZh: text } = require('../../src/renderer/locales/databaseDefaultEncoding.zh-CN') as typeof import('../../src/renderer/locales/databaseDefaultEncoding.zh-CN');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { join, relative, isAbsolute } = require('node:path') as typeof import('node:path');
  const { randomUUID, createHash } = require('node:crypto') as typeof import('node:crypto');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  const prepared = new Map<object, Clock>(), completed = new Map<object, () => void>(); let halted = false;
  const launchGuard = {
    assertCurrent() { binding.assertCurrent(); if (halted) throw Error('数据库默认编码原例已停链'); },
    assertPreparation(info: import('@playwright/test').TestInfo) { this.assertCurrent(); let clock = prepared.get(info); if (!clock) { clock = bindEditorIndentNativeCase(info, this, () => test.info()); prepared.set(info, clock); } clock.assertCurrent(); },
  };
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: launchGuard }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { try { const check = completed.get(info); if (!check) throw Error('数据库默认编码原用例未完成'); check(); completed.delete(info); prepared.delete(info); } catch (error) { halted = true; prepared.get(info)?.retain(); runtime.retainOwnedDesktopResources(info); throw error; } });

  test('真实MySQL数据库默认编码先预览后修改且已有表列与精确数据保持不变', async ({ trace, screenshot, video }, info) => {
    const clock = prepared.get(info); if (!clock) throw Error('数据库默认编码缺少原启动期限');
    const { page, application } = runtime.ownedDesktopResources(info), directory = runtime.dataDir;
    const database = 'dbark_dbencoding_ui_' + randomUUID().replaceAll('-', ''), quote = '`' + database + '`';
    let armed = false, closed = false, observerClosed = false, native: import('mysql2').Connection | undefined, stream: any;
    const check = () => { clock.assertCurrent(); binding.assertCurrent(); const owner = runtime.ownedDesktopResources(info); if (owner.page !== page || owner.application !== application || runtime.dataDir !== directory || closed !== owner.closed) throw Error('数据库默认编码原窗口归属已变化'); if (native && ((native as any).stream !== stream || !stream || observerClosed !== (stream.closed === true))) throw Error('数据库默认编码控制连接归属或关闭状态已变化'); };
    /** 每次原await前后检查原owner/期限/配置与Main审计；失败不补发请求。 */
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { check(); if (armed) { await application.evaluate(readDatabaseDefaultEncodingUiAudit); check(); } const value = await action(); check(); if (armed && !allowClosed) { await application.evaluate(readDatabaseDefaultEncodingUiAudit); check(); } return value; };
    const query = async (sql: string, params: (string | number | Buffer | null)[] = []): Promise<any> => step(() => new Promise((resolve, reject) => native!.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows))));
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const nested = relative(directory, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('数据库默认编码输出不得位于本例profile');
      const fs = require('node:fs/promises') as typeof import('node:fs/promises'); await step(() => fs.mkdir(binding.target.output, { recursive: false }));
      const mysql = require('mysql2') as typeof import('mysql2'); check(); native = mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (native as any).stream; check();
      await step(() => new Promise<void>((resolve, reject) => native!.connect(error => error ? reject(error) : resolve())));
      const identity = await query('SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId'); expect(identity).toHaveLength(1); const server = identity[0]; expect({ version: server.version, os: server.os, names: Number(server.names), uuid: server.uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: binding.target.uuid }); expect(Number.isSafeInteger(Number(server.threadId)) && Number(server.threadId) > 0).toBe(true); const threadId = Number(server.threadId);
      // 在建库前记录脱敏原计划，失败也能定位本例资源；不输出凭据。
      process.stdout.write(JSON.stringify({ 专项: '数据库默认编码GUI', 阶段: '原资源计划', 数据库: database, 端口: binding.target.port, 原观察线程: threadId }) + '\n');
      expect(await query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?', [database])).toEqual([]);
      await query('CREATE DATABASE ' + quote + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
      await query('CREATE TABLE ' + quote + '.`existing` (`id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,`moment` DATETIME(6) NOT NULL,`unicode_value` VARCHAR(80) NOT NULL,`payload` VARBINARY(20),`nullable_value` TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
      await query('INSERT INTO ' + quote + '.`existing` VALUES (?,?,?,?,?),(?,?,?,?,?)', ['18446744073709551615', '2026-10-22 00:01:02.123456', '中文🙂', Buffer.from('00ff000a', 'hex'), null, '9007199254740993', '2026-10-22 23:59:58.654321', '', Buffer.alloc(0), 'NULL']);
      const defaults = () => query('SELECT DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
      const tableDefinition = () => query('SHOW CREATE TABLE ' + quote + '.`existing`');
      const columnEncoding = () => query("SELECT COLUMN_NAME AS name,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='existing' ORDER BY ORDINAL_POSITION", [database]);
      // 限定原表数字列，避免ORDER BY命中CAST后的文本别名而按字典序排列。
      const rows = () => query("SELECT CAST(id AS CHAR) AS id,DATE_FORMAT(moment,'%Y-%m-%d %H:%i:%s.%f') AS moment,unicode_value,HEX(payload) AS payload,nullable_value FROM " + quote + '.`existing` ORDER BY existing.id');
      const original = { defaults: await defaults(), definition: await tableDefinition(), columns: await columnEncoding(), rows: await rows() };
      expect(original.defaults).toEqual([{ charset: 'utf8mb4', collation: 'utf8mb4_bin' }]); expect(original.rows).toEqual([{ id: '9007199254740993', moment: '2026-10-22 23:59:58.654321', unicode_value: '', payload: '', nullable_value: 'NULL' }, { id: '18446744073709551615', moment: '2026-10-22 00:01:02.123456', unicode_value: '中文🙂', payload: '00FF000A', nullable_value: null }]);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '数据库编码本例'], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '数据库编码本例' && profile.host === binding.target.host && profile.port === 13384 && profile.user === binding.target.user && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const nativeWindow = await step(() => application.browserWindow(page)), senderId = await step(() => nativeWindow.evaluate(native => native.webContents.id)); await step(() => nativeWindow.evaluate(native => native.setSize(1280, 900))); await step(() => nativeWindow.dispose());
      await step(() => application.evaluate(installDatabaseDefaultEncodingUiAudit, { senderId, profileId: profile.id, database })); armed = true;
      await step(() => page.locator('.connection-row .tree-label').filter({ hasText: '数据库编码本例' }).click()); const entry = page.getByRole('button', { name: text.entry + ' ' + database, exact: true }); await step(() => expect(entry).toBeVisible()); await step(() => entry.click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true });
      await step(() => expect(dialog.getByRole('combobox', { name: text.collation, exact: true })).toBeEnabled()); await step(() => expect(dialog.getByRole('button', { name: text.preview, exact: true })).toBeDisabled()); await step(() => expect(dialog).toContainText(text.scope));
      await step(() => dialog.getByRole('combobox', { name: text.collation, exact: true }).selectOption('utf8mb4_general_ci')); await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(dialog.getByLabel(text.confirmation, { exact: true })).toBeVisible());
      const previewAudit = await step(() => application.evaluate(readDatabaseDefaultEncodingUiAudit)); expect(previewAudit).toEqual({ gets: 1, previews: 1, applies: 0, releases: 0, pending: 0, verified: false });
      expect(await defaults()).toEqual(original.defaults); expect(await tableDefinition()).toEqual(original.definition); expect(await columnEncoding()).toEqual(original.columns); expect(await rows()).toEqual(original.rows);
      await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => dialog.getByLabel(text.confirmation, { exact: true }).fill(database));
      for (const label of [text.ackImplicit, text.ackDefaults, text.ackWindow]) await step(() => dialog.getByRole('checkbox', { name: label, exact: true }).check());
      await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); const outcome = dialog.locator('.database-default-encoding-outcome'); await step(() => expect(outcome).toHaveText(text.succeeded, { timeout: 20000 })); await step(() => expect(dialog.locator('.error-box')).toHaveCount(0)); await step(() => outcome.scrollIntoViewIfNeeded()); await step(() => expect(outcome).toBeInViewport({ ratio: 1 })); await step(() => outcome.screenshot({ path: join(binding.target.output, 'database-default-encoding-success.png') }));
      const changed = { defaults: await defaults(), definition: await tableDefinition(), columns: await columnEncoding(), rows: await rows() }; expect(changed.defaults).toEqual([{ charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }]); expect(changed.definition).toEqual(original.definition); expect(changed.columns).toEqual(original.columns); expect(changed.rows).toEqual(original.rows);
      await query('CREATE TABLE ' + quote + '.`inherited` (`text_value` VARCHAR(20))'); const inherited = await query("SELECT TABLE_COLLATION AS collation FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='inherited'", [database]); const inheritedColumns = await query("SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='inherited' AND COLUMN_NAME='text_value'", [database]); expect(inherited).toEqual([{ collation: 'utf8mb4_general_ci' }]); expect(inheritedColumns).toEqual([{ charset: 'utf8mb4', collation: 'utf8mb4_general_ci' }]);
      await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks).toHaveLength(3); expect(new Set(tasks.map(value => value.id)).size).toBe(3); expect(tasks.map(value => [value.kind, value.status]).sort()).toEqual(['apply', 'get', 'preview'].map(kind => ['schema.databaseDefaultEncoding.' + kind, 'completed']).sort()); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect((await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).tabs).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const audit = await step(() => application.evaluate(readDatabaseDefaultEncodingUiAudit)); expect(audit).toEqual({ gets: 1, previews: 1, applies: 1, releases: 1, pending: 0, verified: true });
      expect(await query('SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?', [database, threadId])).toEqual([]);
      await step(() => application.evaluate(guardQueryResultColumnsExitAnswers));
      // 原App终态核验发生在同一原请求内部；关闭后的step不得再向已毁窗口读取审计。
      await step(async () => { await runtime.confirmOwnedDesktopExit(info); closed = true; }, true); armed = false; check(); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      expect(await query('SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?', [database, threadId])).toEqual([]);
      await query('DROP DATABASE ' + quote); expect(await query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?', [database])).toEqual([]);
      const originalNative = native, originalStream = stream; await step(async () => { await closeMysqlConnection(originalNative!, true); observerClosed = true; }); expect(native).toBe(originalNative); expect(stream).toBe(originalStream); expect(originalStream.closed).toBe(true);
      const evidence = { kind: 'dbark.database-default-encoding-ui', version: 1, platform: process.platform, server: { version: server.version, os: server.os, lowerCaseTableNames: Number(server.names), uuid: server.uuid }, database, controlThreadId: threadId, before: original.defaults[0], after: changed.defaults[0], preview: { unchanged: true, audit: previewAudit }, existing: { rowCount: original.rows.length, definitionBefore: hash(original.definition), definitionAfter: hash(changed.definition), columnsBefore: hash(original.columns), columnsAfter: hash(changed.columns), rowsBefore: hash(original.rows), rowsAfter: hash(changed.rows) }, inherited: { default: inherited[0].collation, column: inheritedColumns[0] }, audit, tasks: tasks.map(value => ({ kind: value.kind, status: value.status })), normalExit: closed, targetThreadsAfterExit: 0, databaseRemoved: true, observerTransportClosed: observerClosed };
      await step(() => fs.writeFile(join(binding.target.output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 })); await step(() => info.attach('数据库默认编码脱敏证据', { body: JSON.stringify(evidence), contentType: 'application/json' }));
      completed.set(info, () => { check(); if (!closed || !observerClosed) throw Error('数据库默认编码退出或控制流未闭合'); });
    } catch (error) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw error; }
  });
}
