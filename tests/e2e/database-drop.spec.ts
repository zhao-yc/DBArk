import { clickSidebarAction, sidebarMenuItem } from './sidebar-menu';
import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认和列表只登记未执行定义；不能加载桌面、认证、驱动或读取本地凭据。
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_DATABASE_DROP_UI === '1') {
  const { bindDatabaseDropUi } = require('../helpers/databaseDropUi') as typeof import('../helpers/databaseDropUi');
  register(bindDatabaseDropUi(() => ({ env: process.env, platform: process.platform })));
} else baseTest.skip('删除数据库真实窗口及精确资源清理验收默认关闭（未执行）', () => {});

/** 只为原用例新建随机库；失败保留原进程、连接、库及日志，不自动补删或重跑。 */
function register(binding: ReturnType<typeof import('../helpers/databaseDropUi')['bindDatabaseDropUi']>): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { installDatabaseDropUiAudit, readDatabaseDropUiAudit } = require('../helpers/databaseDropUi') as typeof import('../helpers/databaseDropUi');
  const { guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const { databaseDropZh: text } = require('../../src/renderer/locales/databaseDrop.zh-CN') as typeof import('../../src/renderer/locales/databaseDrop.zh-CN');
  const { workbenchZh } = require('../../src/renderer/locales/workbench.zh-CN') as typeof import('../../src/renderer/locales/workbench.zh-CN');
  const { tableRenameZh } = require('../../src/renderer/locales/tableRename.zh-CN') as typeof import('../../src/renderer/locales/tableRename.zh-CN');
  const { objectUri } = require('../../src/shared/workbench') as typeof import('../../src/shared/workbench');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { join, relative, isAbsolute } = require('node:path') as typeof import('node:path');
  const { randomUUID, createHash } = require('node:crypto') as typeof import('node:crypto');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  const prepared = new Map<object, Clock>(), completed = new Map<object, () => void>(); let halted = false;
  const launchGuard = {
    assertCurrent() { binding.assertCurrent(); if (halted) throw Error('删除数据库原用例已停链'); },
    assertPreparation(info: import('@playwright/test').TestInfo) { this.assertCurrent(); if (info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('删除数据库必须原用例单worker零重试'); let clock = prepared.get(info); if (!clock) { clock = bindEditorIndentNativeCase(info, this, () => test.info()); prepared.set(info, clock); } clock.assertCurrent(); },
  };
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: launchGuard }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { try { const check = completed.get(info); if (!check) throw Error('删除数据库原用例未完成'); check(); completed.delete(info); prepared.delete(info); } catch (error) { halted = true; prepared.get(info)?.retain(); runtime.retainOwnedDesktopResources(info); throw error; } });

  test('真实Sidebar删除库先放弃预览再执行，六类对象消失且查询原文保留、旧链接退役', async ({ trace, screenshot, video }, info) => {
    const clock = prepared.get(info); if (!clock) throw Error('删除数据库缺少原启动期限');
    const { page, application } = runtime.ownedDesktopResources(info), directory = runtime.dataDir, originalProcess = application.process();
    const database = 'dbark_dbdrop_ui_' + randomUUID().replaceAll('-', ''), quote = '`' + database + '`', marker = 'dbark-dbdrop-owner:' + randomUUID();
    const preservedSql = "SELECT 9007199254740993 AS exact_value; -- 本例删除数据库后保留原文";
    let armed = false, closed = false, observerClosed = false, native: import('mysql2').Connection | undefined, stream: any;
    /** 活通道核对原ChildProcess身份；正常退出后只核已捕获原进程终态，不再访问关闭的Playwright通道。 */
    const check = () => {
      clock.assertCurrent(); binding.assertCurrent(); const owner = runtime.ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || runtime.dataDir !== directory || closed !== owner.closed || !Number.isSafeInteger(originalProcess.pid) || originalProcess.pid! <= 0) throw Error('删除数据库原窗口或进程归属已变化');
      if (closed) { if (originalProcess.exitCode !== 0 || originalProcess.signalCode !== null) throw Error('删除数据库原进程未取得退出码0且无终止信号的正常终态'); }
      else if (application.process() !== originalProcess) throw Error('删除数据库原ChildProcess身份已变化');
      if (native && ((native as any).stream !== stream || !stream || observerClosed !== (stream.closed === true))) throw Error('删除数据库观察连接或原流关闭状态已变化');
    };
    /** 每个原await前后核原owner和期限，审计只观察实际Main，不替换任务响应。 */
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { check(); if (armed) { await application.evaluate(readDatabaseDropUiAudit); check(); } const value = await action(); check(); if (armed && !allowClosed) { await application.evaluate(readDatabaseDropUiAudit); check(); } return value; };
    const query = async (sql: string, params: (string | number | Buffer | null)[] = []): Promise<any> => step(() => new Promise((resolve, reject) => native!.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows))));
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const actualSchema = () => query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE CAST(SCHEMA_NAME AS BINARY)=CAST(? AS BINARY)', [database]);
    const actualRows = () => query("SELECT CAST(id AS CHAR) AS id,DATE_FORMAT(moment,'%Y-%m-%d %H:%i:%s.%f') AS moment,unicode_value,HEX(payload) AS payload,nullable_value FROM " + quote + '.`subject` ORDER BY subject.id');
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const nested = relative(directory, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('删除数据库输出不得位于原profile');
      const fs = require('node:fs/promises') as typeof import('node:fs/promises'); await step(() => fs.mkdir(binding.target.output, { recursive: false }));
      const mysql = require('mysql2') as typeof import('mysql2'); check(); native = mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (native as any).stream; check();
      await step(() => new Promise<void>((resolve, reject) => native!.connect(error => error ? reject(error) : resolve())));
      const identity = await query('SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId'); expect(identity).toHaveLength(1); const server = identity[0]; expect({ version: server.version, os: server.os, names: Number(server.names), uuid: server.uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: binding.target.uuid }); const threadId = Number(server.threadId); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      process.stdout.write(JSON.stringify({ 专项: '删除数据库GUI', 阶段: '原资源计划', 数据库: database, 归属标记: marker, 端口: binding.target.port, 原观察线程: threadId, 原应用PID: originalProcess.pid }) + '\n');
      expect(await actualSchema()).toEqual([]);
      await query('CREATE DATABASE ' + quote + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin');
      await query('CREATE TABLE ' + quote + '.`subject` (`id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,`moment` DATETIME(6) NOT NULL,`unicode_value` VARCHAR(80) NOT NULL,`payload` VARBINARY(20),`nullable_value` TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT=?', [marker]);
      await query('INSERT INTO ' + quote + '.`subject` VALUES (?,?,?,?,?),(?,?,?,?,?)', ['18446744073709551615', '2026-10-23 00:01:02.123456', '中文🙂', Buffer.from('00ff000a', 'hex'), null, '9007199254740993', '2026-10-23 23:59:58.654321', '', Buffer.alloc(0), 'NULL']);
      await query('CREATE VIEW ' + quote + '.`subject_view` AS SELECT id,unicode_value FROM ' + quote + '.`subject`');
      await query('CREATE PROCEDURE ' + quote + '.`subject_procedure`() SQL SECURITY DEFINER SELECT 1');
      await query('CREATE FUNCTION ' + quote + '.`subject_function`() RETURNS INT DETERMINISTIC RETURN 1');
      await query('CREATE TRIGGER ' + quote + '.`subject_trigger` BEFORE INSERT ON ' + quote + '.`subject` FOR EACH ROW SET NEW.nullable_value=NEW.nullable_value');
      await query('CREATE EVENT ' + quote + '.`subject_event` ON SCHEDULE EVERY 1 DAY STARTS \'2099-01-01 00:00:00\' ON COMPLETION PRESERVE DISABLE DO SET @dbark_dbdrop_ui=1');
      const original = { definition: await query('SHOW CREATE TABLE ' + quote + '.`subject`'), rows: await actualRows(), marker: await query("SELECT TABLE_COMMENT AS marker FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='subject'", [database]) };
      expect(original.marker).toEqual([{ marker }]); expect(original.rows).toEqual([{ id: '9007199254740993', moment: '2026-10-23 23:59:58.654321', unicode_value: '', payload: '', nullable_value: 'NULL' }, { id: '18446744073709551615', moment: '2026-10-23 00:01:02.123456', unicode_value: '中文🙂', payload: '00FF000A', nullable_value: null }]);
      await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '删除数据库本例'], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '删除数据库本例' && profile.host === binding.target.host && profile.port === 13384 && profile.user === binding.target.user && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click());
      const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => expect(databaseRow).toHaveCount(1)); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click());
      const subject = node.locator('.object-row').filter({ has: page.getByRole('button', { name: 'subject', exact: true }) }); await step(() => subject.getByRole('button', { name: 'subject', exact: true }).click());
      const table = page.locator('.table-tab:visible'); await step(() => expect(table.locator('.results-grid')).toBeVisible()); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); await step(() => expect(table.locator(':scope > .error-box')).toHaveCount(0)); await step(() => expect(table).toContainText('9007199254740993'));
      const tableNode = await step(() => table.elementHandle()); if (!tableNode) throw Error('删除数据库缺少真实原表页');
      await step(() => databaseRow.getByRole('button', { name: database, exact: true }).focus()); await step(() => clickSidebarAction(databaseRow, { name: zh.sidebar.text016, exact: true }, undefined, check));
      const queryEditor = page.locator('.query-tab:visible .monaco-editor'); await step(() => expect(queryEditor).toBeVisible()); await step(() => queryEditor.click()); await step(() => page.keyboard.insertText(preservedSql));
      await step(() => expect.poll(async () => { const value = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); return value.tabs.find(tab => tab.kind === 'query')?.sql; }).toBe(preservedSql));
      const initialSettings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(initialSettings.tabs).toHaveLength(2); const tableTab = initialSettings.tabs.find(tab => tab.kind === 'table')!, queryTab = initialSettings.tabs.find(tab => tab.kind === 'query')!;
      expect(tableTab).toMatchObject({ connectionId: profile.id, database, table: 'subject' }); expect(queryTab).toMatchObject({ connectionId: profile.id, database, sql: preservedSql });
      const nativeWindow = await step(() => application.browserWindow(page)), senderId = await step(() => nativeWindow.evaluate(native => native.webContents.id)); await step(() => nativeWindow.evaluate(native => native.setSize(1280, 900))); await step(() => nativeWindow.dispose());
      await step(() => application.evaluate(installDatabaseDropUiAudit, { senderId, profileId: profile.id, database, tableTabId: tableTab.id, queryTabId: queryTab.id, sql: preservedSql })); armed = true;
      const dialog = page.getByRole('dialog', { name: text.title, exact: true });
      /** 真实右键菜单与可见入口点击，不用force或直接调用删除IPC。 */
      const open = async () => { await step(() => databaseRow.scrollIntoViewIfNeeded()); await step(() => databaseRow.hover()); const entry = (await step(() => sidebarMenuItem(databaseRow, { name: text.title + ' ' + database, exact: true }, check))); await step(() => expect(entry).toBeVisible()); await step(() => entry.click()); await step(() => expect(dialog.getByRole('button', { name: text.preview, exact: true })).toBeEnabled()); for (const label of [text.tables, text.views, text.procedures, text.functions, text.triggers, text.events]) await step(() => expect(dialog.locator('dl > div').filter({ has: page.locator('dt').filter({ hasText: new RegExp('^' + label + '$') }) }).locator('dd')).toHaveText('1')); };
      const prepare = async () => {
        await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(dialog.getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible());
        const editor = dialog.locator('.monaco-editor'), lines = editor.locator('.view-lines'); await step(() => expect.poll(async () => (await step(() => lines.innerText())).replace(/\r?\n/g, '').replaceAll('\u00a0', ' ')).toBe('DROP DATABASE ' + quote + ';'));
        const before = await step(() => lines.innerText()); await step(() => editor.click()); await step(() => page.keyboard.type('cannot_edit')); await step(() => expect.poll(() => step(() => lines.innerText())).toBe(before));
        await step(() => expect(dialog.getByRole('checkbox')).toHaveCount(4)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      };
      await open(); await prepare(); expect((await step(() => application.evaluate(readDatabaseDropUiAudit))).applies).toBe(0); expect(await actualRows()).toEqual(original.rows);
      await step(() => dialog.getByRole('button', { name: text.back, exact: true }).click()); await step(() => expect(dialog.getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0)); await prepare();
      // 放弃第二个预览后关闭窗口：仅使用真实返回按钮，无需批准一次删除。
      await step(() => dialog.getByRole('button', { name: text.back, exact: true }).click()); await step(() => expect(dialog.getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0)); await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
      const discarded = await step(() => application.evaluate(readDatabaseDropUiAudit)); expect(discarded).toMatchObject({ gets: 1, previews: 2, applies: 0, releases: 3, pending: 0, verified: false }); expect(await actualSchema()).toEqual([{ SCHEMA_NAME: database }]); expect(await query('SHOW CREATE TABLE ' + quote + '.`subject`')).toEqual(original.definition); expect(await actualRows()).toEqual(original.rows);
      await open(); await prepare(); await step(() => dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + ' '));
      for (const label of [text.ackIrreversible, text.ackWindow, text.ackReferences, text.ackSessions]) await step(() => dialog.getByRole('checkbox', { name: label, exact: true }).check());
      await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); expect((await step(() => application.evaluate(readDatabaseDropUiAudit))).applies).toBe(0); expect(await actualRows()).toEqual(original.rows);
      await step(() => dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeEnabled());
      await step(() => dialog.screenshot({ path: join(binding.target.output, 'database-drop-preview.png') }));
      await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); const outcome = dialog.locator('.database-drop-outcome'); await step(() => expect(outcome).toHaveText(text.succeeded, { timeout: 20000 })); await step(() => expect(dialog.getByRole('button', { name: text.close, exact: true })).toBeEnabled()); await step(() => expect(dialog.locator('.error-box')).toHaveCount(0));
      expect(await actualSchema()).toEqual([]); const after = await step(() => application.evaluate(readDatabaseDropUiAudit)); expect(after).toEqual({ gets: 2, previews: 3, applies: 1, releases: 5, pending: 0, verified: true, retiredResolves: 0 });
      // 只回答本例已完成删除后的原生确认，单次恢复原函数，不修改renderer ref、state或执行回执。
      await step(() => application.evaluate(({ dialog: native }, expected) => {
        const root = globalThis as any; if (root.__dbarkDatabaseDropCloseConfirmation !== undefined) throw Error('删除数据库关闭确认已占用'); root.__dbarkDatabaseDropCloseConfirmation = 0;
        const sync = native.showMessageBoxSync, asynchronous = native.showMessageBox;
        const answer = (args: any[]) => { native.showMessageBoxSync = sync; native.showMessageBox = asynchronous; if (args.at(-1)?.message !== expected) throw Error('拒绝其它原生确认使用删除数据库回答'); root.__dbarkDatabaseDropCloseConfirmation++; return { response: 0, checkboxChecked: false }; };
        native.showMessageBoxSync = ((...args: any[]) => answer(args).response) as typeof sync; native.showMessageBox = (async (...args: any[]) => answer(args)) as typeof asynchronous;
      }, text.discard));
      await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); expect(await step(() => application.evaluate(() => (globalThis as any).__dbarkDatabaseDropCloseConfirmation))).toBe(1);
      await step(() => expect(databaseRow).toHaveCount(0)); expect(await step(() => tableNode.evaluate(element => element.isConnected))).toBe(false);
      const finalSettings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(finalSettings.tabs).toEqual([queryTab]); expect(finalSettings.activeTabId).toBe(queryTab.id); await step(() => expect(queryEditor).toBeVisible()); await step(() => expect(queryEditor.locator('.view-lines')).toContainText('9007199254740993'));
      const oldLink = objectUri({ connectionId: profile.id, database, kind: 'table', name: 'subject' }); await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: workbenchZh.paste, exact: true }).click()); const link = page.getByRole('dialog', { name: workbenchZh.paste, exact: true }); await step(() => link.getByRole('textbox', { name: workbenchZh.uri, exact: true }).fill(oldLink)); await step(() => link.getByRole('button', { name: workbenchZh.openUri, exact: true }).click()); await step(() => expect(link.locator('.error-box')).toHaveText(tableRenameZh.oldLink)); await step(() => link.getByRole('button', { name: workbenchZh.cancel, exact: true }).click()); await step(() => expect(link).toBeHidden());
      expect((await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).tabs).toEqual([queryTab]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))), ownTasks = tasks.filter(value => value.kind.startsWith('schema.databaseDrop.')); expect(ownTasks).toHaveLength(6); expect(ownTasks.every(value => value.status === 'completed')).toBe(true); const audit = await step(() => application.evaluate(readDatabaseDropUiAudit)); expect(audit).toEqual(after);
      await step(() => application.evaluate(guardQueryResultColumnsExitAnswers)); await step(async () => { await runtime.confirmOwnedDesktopExit(info); closed = true; }, true); armed = false; check(); expect(originalProcess.exitCode).toBe(0);
      expect(await query('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND ID<>?', [database, threadId])).toEqual([]); expect(await actualSchema()).toEqual([]);
      const originalNative = native, originalStream = stream; await step(async () => { await closeMysqlConnection(originalNative!, true); observerClosed = true; }); expect(native).toBe(originalNative); expect(stream).toBe(originalStream); expect(originalStream.closed).toBe(true);
      const evidence = { kind: 'dbark.database-drop-ui', version: 1, platform: process.platform, server: { version: server.version, os: server.os, lowerCaseTableNames: Number(server.names), uuid: server.uuid }, database, ownerMarker: marker, controlThreadId: threadId, discardedPreview: { audit: discarded, rowsUnchanged: true, definitionUnchanged: true }, counts: { tables: 1, views: 1, procedures: 1, functions: 1, triggers: 1, events: 1 }, before: { definitionSha256: hash(original.definition), rowsSha256: hash(original.rows) }, audit, readonlySqlVerified: true, exactConfirmationVerified: true, originalTableNodeDetached: true, originalQueryPreserved: true, staleObjectLinkBlocked: true, originalProcessExitCode: originalProcess.exitCode, normalExit: closed, targetThreadsAfterExit: 0, databaseAbsent: true, observerTransportClosed: observerClosed, clipboardOperations: 0, installerVerified: false, macOSVerified: false };
      await step(() => fs.writeFile(join(binding.target.output, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 })); await step(() => info.attach('删除数据库脱敏证据', { body: JSON.stringify(evidence), contentType: 'application/json' })); completed.set(info, () => { check(); if (!closed || !observerClosed) throw Error('删除数据库退出或原控制流未闭合'); });
    } catch (error) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw error; }
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
