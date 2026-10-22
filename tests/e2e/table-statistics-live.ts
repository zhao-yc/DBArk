import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';

import { tableStatisticsZh as statsText } from '../../src/renderer/locales/tableStatistics.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_STATISTICS_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_STATISTICS_MANIFEST', 'DBARK_TABLE_STATISTICS_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('表数据统计原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('表数据统计拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_STATISTICS_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_tablestat_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('表数据统计须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_TABLE_STATISTICS_MANIFEST || !win32.isAbsolute(values.DBARK_TABLE_STATISTICS_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_TABLE_STATISTICS_MANIFEST_SHA256 ?? '')) throw Error('表数据统计缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('表数据统计源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('表数据统计拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('表数据统计禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerTableStatisticsUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ tableStatisticsSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    tableStatisticsSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('表数据统计必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('表数据统计配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_TABLE_STATISTICS_MANIFEST!, environment.values.DBARK_TABLE_STATISTICS_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ tableStatisticsSource }, use) => { await use({ assertCurrent: () => tableStatisticsSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== tableStatisticsSource.clock) throw Error('表数据统计原启动归属变化'); tableStatisticsSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('表数据统计原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实123行全筛选统计、金额草稿排除、数值字节与视图', async ({ tableStatisticsSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = tableStatisticsSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, table = 'subject', quote = '`' + database + '`.`' + table + '`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined, originalProcessExitCode: number | null | undefined;
    /** 每个await前后核原TestInfo/窗口/frame/进程/socket；未知时永久保留，不补做DROP或重发。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('表数据统计原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('表数据统计原profile目录身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '原金额草稿与统计前', '全量统计与草稿核对', '退出客户端前', '退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false, sourceFailed = false;
    /** 原完整来源集合按明确阶段复读，摘要不冒充逐UI动作全量hash。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); try { if (sourceFailed || sourcePending || phases[sourceChecks.length] !== phase) throw Error('表数据统计来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; } catch (reason) { sourceFailed = true; retained = true; clock.retain(); throw reason; } };
    const qualify = (name: string) => String.fromCharCode(96) + database + String.fromCharCode(96) + '.' + String.fromCharCode(96) + name + String.fromCharCode(96);
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      first: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,note FROM ' + quote + ' ORDER BY id LIMIT 1',
      aggregate: 'SELECT CAST(COUNT(*) AS CHAR) AS rowCount,CAST(COUNT(amount) AS CHAR) AS amountNonNull,CAST(COUNT(*)-COUNT(amount) AS CHAR) AS amountNulls,CAST(MIN(amount) AS CHAR) AS amountMin,CAST(MAX(amount) AS CHAR) AS amountMax,CAST(SUM(amount) AS CHAR) AS amountSum,CAST(AVG(amount) AS CHAR) AS amountAvg,CAST(COUNT(payload) AS CHAR) AS payloadNonNull,CAST(COUNT(*)-COUNT(payload) AS CHAR) AS payloadNulls,HEX(MIN(payload)) AS payloadMin,HEX(MAX(payload)) AS payloadMax,CAST(COUNT(doc) AS CHAR) AS docNonNull,CAST(COUNT(*)-COUNT(doc) AS CHAR) AS docNulls FROM ' + quote,
      view: 'SELECT CAST(COUNT(*) AS CHAR) AS rowCount FROM ' + qualify('subject_view'),
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 只读观察原固定对象/原线程，不创建/改表/改行/删库，也不接任意SQL或业务参数。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<any> => {
      if (!Object.values(statements).includes(sql) || sql === statements.exists && (params.length !== 1 || params[0] !== database) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.exists, statements.threads].includes(sql) && params.length !== 0) throw Error('表数据统计观察SQL或参数越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: profileStat.dev, ino: profileStat.ino };
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity) as RowDataPacket[]; expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      expect(await read(statements.exists, [database])).toEqual([{ name: 'subject' }, { name: 'subject_view' }]); const firstBefore = await read(statements.first), aggregateBefore = await read(statements.aggregate), viewBefore = await read(statements.view);
      expect(firstBefore).toEqual([{ id: '9007199254740993', amount: '123456789012345678.000001', note: 'original-note-001' }]); expect(aggregateBefore).toHaveLength(1); const authority = aggregateBefore[0];
      expect(authority).toMatchObject({ rowCount: '123', amountNonNull: '106', amountNulls: '17', payloadNonNull: '99', payloadNulls: '24', payloadMin: '0001', payloadMax: '007B', docNonNull: '82', docNulls: '41' }); expect(typeof authority.amountSum).toBe('string'); expect(typeof authority.amountAvg).toBe('string'); expect(viewBefore).toEqual([{ rowCount: '62' }]);
      process.stdout.write(JSON.stringify({ 专项: '表数据统计GUI', 阶段: '原资源计划', 数据库: database, 表: ['subject', 'subject_view'], 端口: 13384, 原观察线程: threadId }) + '\n');
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '表统计本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '表统计本例' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.user === environment.values.DBARK_TEST_USER && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click()); const tableGrid = page.locator('.table-grid-wrap:visible').getByRole('grid'); await step(() => expect(tableGrid).toContainText('9007199254740993'));
      // 正式页大小默认200；通过实际选择器固定为50，再证明全量123行统计与已加载页不同。
      await step(() => page.locator('.table-action-bar:visible').getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect(page.locator('.table-action-bar:visible').getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible());
      await step(() => tableGrid.getByRole('gridcell').filter({ hasText: /^9007199254740993$/ }).click()); await step(() => page.getByRole('button', { name: recordText.title, exact: true }).click()); const form = page.getByRole('complementary', { name: recordText.title, exact: true });
      const amount = form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^amount/ }) }); await step(() => amount.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => amount.getByLabel('amount · ' + recordText.value, { exact: true }).fill('0.000001')); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); expect(await read(statements.first)).toEqual(firstBefore);
      await verifySource('原金额草稿与统计前');
      const openStatistics = async () => { await step(() => page.getByRole('button', { name: statsText.title, exact: true }).click()); const modal = page.getByRole('dialog', { name: statsText.title, exact: true }); await step(() => expect(modal.getByText(statsText.scope, { exact: true })).toBeVisible()); await step(() => expect(modal.getByText(statsText.drafts, { exact: true })).toBeVisible()); return modal; };
      const dialog = await openStatistics(); await step(() => dialog.getByRole('button', { name: statsText.start, exact: true }).click()); await step(() => expect(dialog.getByLabel(statsText.rowCount, { exact: true })).toHaveText('123'));
      for (const name of ['id', 'amount', 'measure', 'payload', 'doc']) await step(() => dialog.getByRole('checkbox', { name: statsText.selectColumn(name), exact: true }).check());
      await step(() => dialog.getByRole('button', { name: statsText.start, exact: true }).click()); await step(() => expect(dialog.getByLabel(statsText.rowCount, { exact: true })).toHaveText('123'));
      const amountRow = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'amount', exact: true }) }); const amountCells = amountRow.getByRole('cell');
      for (const [index, expected] of [[1, authority.amountNonNull], [2, authority.amountNulls], [3, authority.amountMin], [4, authority.amountMax], [5, authority.amountSum], [6, authority.amountAvg]] as const) await step(() => expect(amountCells.nth(index)).toHaveText(String(expected)));
      const binaryRow = dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'payload', exact: true }) }); await step(() => expect(binaryRow).toContainText('0x0001')); await step(() => expect(binaryRow).toContainText('0x007b')); await step(() => expect(dialog.getByText(statsText.approximate, { exact: true })).toBeVisible()); await step(() => expect(dialog.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'doc', exact: true }) })).toContainText(statsText.unavailable));
      const screenshotPath = resolve(info.outputPath('全量表统计成功区域.png')), inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('专项截图不能写入原profile目录'); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      await step(() => dialog.getByRole('button', { name: statsText.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => expect(form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^amount/ }) })).toContainText('0.000001')); expect(await read(statements.first)).toEqual(firstBefore); expect(await read(statements.aggregate)).toEqual(aggregateBefore);
      await step(() => page.getByRole('button', { name: draftHistoryZh.undo, exact: true }).click()); await step(() => expect(form.getByText(recordText.unchanged, { exact: true })).toBeVisible());
      await step(() => page.getByRole('button', { name: zh.table.text006, exact: true }).click()); const filter = page.locator('.filter-rule-form'); await step(() => filter.getByLabel(zh.table.text009, { exact: true }).selectOption('id')); await step(() => filter.getByLabel(zh.table.text011, { exact: true }).fill('0')); await step(() => filter.getByRole('button', { name: zh.table.text013, exact: true }).click()); await step(() => expect(tableGrid.getByRole('gridcell').filter({ hasText: /^9007199254740993$/ })).toHaveCount(0));
      const empty = await openStatistics(); await step(() => empty.getByRole('button', { name: statsText.start, exact: true }).click()); await step(() => expect(empty.getByLabel(statsText.rowCount, { exact: true })).toHaveText('0')); await step(() => expect(empty.getByText(statsText.empty, { exact: true })).toBeVisible()); await step(() => empty.getByRole('button', { name: statsText.close, exact: true }).click()); await step(() => expect(empty).toBeHidden());
      await step(() => page.locator('.expanded-filter-panel').getByRole('button', { name: zh.common.clearAll, exact: true }).click()); await step(() => expect(tableGrid).toContainText('9007199254740993')); const cleared = await openStatistics(); await step(() => cleared.getByRole('button', { name: statsText.start, exact: true }).click()); await step(() => expect(cleared.getByLabel(statsText.rowCount, { exact: true })).toHaveText('123')); await step(() => cleared.getByRole('button', { name: statsText.close, exact: true }).click()); await step(() => expect(cleared).toBeHidden());
      const viewNode = node.locator('.object-row').filter({ has: page.locator('.truncate').filter({ hasText: /^subject_view$/ }) }); await step(() => viewNode.locator('button.tree-label').click()); await step(() => expect(page.locator('.table-grid-wrap:visible').getByRole('grid')).toContainText('9007199254740993'));
      const viewDialog = await openStatistics(); await step(() => viewDialog.getByRole('button', { name: statsText.start, exact: true }).click()); await step(() => expect(viewDialog.getByLabel(statsText.rowCount, { exact: true })).toHaveText('62')); await step(() => viewDialog.getByRole('button', { name: statsText.close, exact: true }).click()); await step(() => expect(viewDialog).toBeHidden());
      const firstAfter = await read(statements.first), aggregateAfter = await read(statements.aggregate); expect(firstAfter).toEqual(firstBefore); expect(aggregateAfter).toEqual(aggregateBefore); expect(await read(statements.view)).toEqual(viewBefore); await verifySource('全量统计与草稿核对');
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); const selected = tasks.filter(task => task.kind === 'table.statistics'); expect(selected).toHaveLength(5); expect(selected.every(task => task.status === 'completed')).toBe(true); expect(tasks.some(task => task.status === 'running' || task.kind === 'table.apply' || task.kind === 'table.preview' || task.kind.startsWith('schema.') || task.kind.startsWith('query.execute'))).toBe(false); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; originalProcessExitCode = originalProcess.exitCode; check(); expect(originalProcessExitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); check(); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed === true).toBe(true); await verifySource('退出与控制收尾后'); expect(sourceChecks).toEqual(phases);
      await step(() => info.attach('表数据统计专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-statistics-ui', version: 1, platform: process.platform, database, objects: ['subject', 'subject_view'], serverVersion: '8.4.11', controlThreadId: threadId, loadedRows: 50, serverRows: '123', viewRows: '62', selectedColumns: ['id','amount','measure','payload','doc'], localAmount: '0.000001', amountSourceValue: firstBefore[0].amount, amountSum: authority.amountSum, amountAvg: authority.amountAvg, beforeSha256: createHash('sha256').update(JSON.stringify([firstBefore,aggregateBefore,viewBefore])).digest('hex'), afterSha256: createHash('sha256').update(JSON.stringify([firstAfter,aggregateAfter,viewBefore])).digest('hex'), parentDraftPreserved: true, explicitStatisticsTasks: 5, normalExit: closed, originalProcessExitCode, observerClosed, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_TABLE_STATISTICS_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}
