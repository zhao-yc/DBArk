import { clickSidebarAction } from './sidebar-menu';
import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateColumnEncodingZh as columnText } from '../../src/renderer/locales/tableCreateColumnEncoding.zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_CREATE_COLUMN_ENCODING_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST', 'DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('新表列编码原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('新表列编码拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_CREATE_COLUMN_ENCODING_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_ccenc_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('新表列编码须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST || !win32.isAbsolute(values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST_SHA256 ?? '')) throw Error('新表列编码缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('新表列编码源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('新表列编码拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('新表列编码禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerTableCreateColumnEncodingUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ columnEncodingSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    columnEncodingSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('新表列编码必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('新表列编码配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST!, environment.values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ columnEncodingSource }, use) => { await use({ assertCurrent: () => columnEncodingSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== columnEncodingSource.clock) throw Error('新表列编码原启动归属变化'); columnEncodingSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('新表列编码原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实目录两种列编码、重排、准确确认一次CREATE及真实字节核对', async ({ columnEncodingSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = columnEncodingSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, table = 'created_' + randomUUID().replaceAll('-', ''), quote = '`' + database + '`.`' + table + '`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined, originalProcessExitCode: number | null | undefined;
    /** 每个await前后核原TestInfo/窗口/frame/进程/socket；未知时永久保留，不补做DROP或重发。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('新表列编码原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('新表列编码原profile目录身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '列编码创建前', '列编码定义与数据', '退出客户端前', '退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false, sourceFailed = false;
    /** 原完整来源集合按明确阶段复读，摘要不冒充逐UI动作全量hash。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); try { if (sourceFailed || sourcePending || phases[sourceChecks.length] !== phase) throw Error('新表列编码来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; } catch (reason) { sourceFailed = true; retained = true; clock.retain(); throw reason; } };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      database: 'SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
      columns: 'SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,ORDINAL_POSITION AS ordinal FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
      table: 'SELECT t.TABLE_COLLATION AS collation,c.CHARACTER_SET_NAME AS charset FROM INFORMATION_SCHEMA.TABLES t LEFT JOIN INFORMATION_SCHEMA.COLLATIONS c ON t.TABLE_COLLATION=c.COLLATION_NAME WHERE t.TABLE_SCHEMA=? AND t.TABLE_NAME=?',
      definition: 'SHOW CREATE TABLE ' + quote,
      insert: 'INSERT INTO ' + quote + ' (`id`,`note`,`latin`,`inherited`,`amount`,`payload`) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',
      rows: 'SELECT CAST(id AS CHAR) AS id,HEX(note) AS noteHex,HEX(latin) AS latinHex,HEX(inherited) AS inheritedHex,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex FROM ' + quote + ' ORDER BY `' + table + '`.`id`',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    const inserted = ['9007199254740993', '中文🙂', 'éÿ', '继承🙂', '123456789012345678.123456', Buffer.from('00ff000a', 'hex'), '18446744073709551615', null, null, null, null, Buffer.alloc(0)];
    /** 原observer只接受固定SQL及本例精确参数，不借观察端执行额外DDL或任意查询。 */
    const read = (sql: string, params: (string | number | Buffer | null)[] = []): Promise<any> => {
      if (!Object.values(statements).includes(sql) || sql === statements.database && (params.length !== 1 || params[0] !== database) || [statements.exists, statements.columns, statements.table].includes(sql) && (params.length !== 2 || params[0] !== database || params[1] !== table) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || sql === statements.insert && (params.length !== inserted.length || params.some((value, index) => Buffer.isBuffer(value) ? !Buffer.isBuffer(inserted[index]) || !value.equals(inserted[index] as Buffer) : value !== inserted[index])) || [statements.identity, statements.definition, statements.rows].includes(sql) && params.length !== 0) throw Error('新表列编码控制SQL或参数越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: profileStat.dev, ino: profileStat.ino };
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity) as RowDataPacket[]; expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true); expect(await read(statements.database, [database])).toEqual([{ name: database }]); expect(await read(statements.exists, [database, table])).toEqual([]);
      process.stdout.write(JSON.stringify({ 专项: '新表列级编码GUI', 阶段: '原资源计划', 数据库: database, 表: table, 端口: 13384, 原观察线程: threadId }) + '\n');
      await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '列级编码本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '列级编码本例' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.user === environment.values.DBARK_TEST_USER && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const row = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => row.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(row.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true')); await step(() => row.hover()); await step(() => clickSidebarAction(row, { name: zh.sidebar.text017, exact: true }, undefined, check));
      const form = page.getByRole('dialog', { name: formatText(zh.schema.text009, database), exact: true }); await step(() => form.getByLabel(zh.schema.text010, { exact: true }).fill(table));
      for (const [position, name, type] of [[2, 'note', 'varchar(80)'], [3, 'latin', 'varchar(80)'], [4, 'inherited', 'varchar(80)'], [5, 'amount', 'decimal(30,6)'], [6, 'payload', 'varbinary(20)']] as const) { await step(() => form.getByRole('button', { name: zh.schema.text027, exact: true }).click()); await step(() => form.getByLabel(formatText(zh.schema.text018, position), { exact: true }).fill(name)); await step(() => form.getByLabel(formatText(zh.schema.text019, position), { exact: true }).fill(type)); }
      await step(() => form.getByRole('button', { name: columnText.read, exact: true }).click());
      await step(() => expect(form.getByRole('button', { name: columnText.reread, exact: true })).toBeEnabled());
      for (const [position, charset, collation] of [[2, 'utf8mb4', 'utf8mb4_bin'], [3, 'latin1', 'latin1_bin']] as const) { await step(() => form.getByLabel(columnText.mode(position), { exact: true }).selectOption('explicit')); await step(() => form.getByLabel(columnText.charset(position), { exact: true }).selectOption(charset)); await step(() => form.getByLabel(columnText.collation(position), { exact: true }).selectOption(collation)); }
      await step(() => form.getByLabel(formatText(zh.schema.text022, 2), { exact: true }).fill('NULL')); await step(() => form.getByRole('button', { name: orderText.upLabel(3), exact: true }).click()); await step(() => expect(form.getByLabel(columnText.collation(2), { exact: true })).toHaveValue('latin1_bin')); await step(() => expect(form.getByLabel(columnText.collation(3), { exact: true })).toHaveValue('utf8mb4_bin'));
      await step(() => form.getByRole('button', { name: zh.schema.text049, exact: true }).click()); const confirmation = page.getByRole('dialog', { name: text.title, exact: true });
      await step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('CHARACTER SET latin1 COLLATE latin1_bin')); await step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')); expect(await read(statements.exists, [database, table])).toEqual([]);
      const before = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(before.filter(task => ['schema.apply', 'schema.tableCreate.apply', 'query.execute'].includes(task.kind))).toEqual([]); await verifySource('列编码创建前');
      await step(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(database + '.' + table + ' ')); for (const label of [text.ackDdl, text.ackCreate]) await step(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check()); await step(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(database + '.' + table)); await step(() => confirmation.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded));
      const columns = await read(statements.columns, [database, table]) as RowDataPacket[], tableRows = await read(statements.table, [database, table]) as RowDataPacket[]; expect(tableRows).toHaveLength(1); expect(tableRows[0].charset).toBe('utf8mb4'); expect(columns.map(column => column.name)).toEqual(['id', 'latin', 'note', 'inherited', 'amount', 'payload']); expect(columns[1]).toMatchObject({ charset: 'latin1', collation: 'latin1_bin', nullable: 'YES' }); expect(columns[2]).toMatchObject({ charset: 'utf8mb4', collation: 'utf8mb4_bin', nullable: 'YES', defaultValue: null }); expect(columns[3]).toMatchObject({ charset: 'utf8mb4', collation: tableRows[0].collation }); for (const index of [0, 4, 5]) expect(columns[index]).toMatchObject({ charset: null, collation: null });
      const definition = await read(statements.definition); expect(String(definition[0]['Create Table'])).toContain('CHARACTER SET latin1 COLLATE latin1_bin'); expect(String(definition[0]['Create Table'])).toContain('COLLATE utf8mb4_bin');
      await read(statements.insert, inserted); const rows = await read(statements.rows); expect(rows).toEqual([{ id: '9007199254740993', noteHex: 'E4B8ADE69687F09F9982', latinHex: 'E9FF', inheritedHex: 'E7BBA7E689BFF09F9982', amount: '123456789012345678.123456', payloadHex: '00FF000A' }, { id: '18446744073709551615', noteHex: null, latinHex: null, inheritedHex: null, amount: null, payloadHex: '' }]);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); const taskCounts = { get: 2, preview: 1, apply: 1 };
      for (const [phase, count] of Object.entries(taskCounts)) { const selected = tasks.filter(task => task.kind === 'schema.tableCreate.' + phase); expect(selected).toHaveLength(count); expect(selected.every(task => task.status === 'completed')).toBe(true); } expect(tasks.some(task => task.status === 'running')).toBe(false); expect(tasks.filter(task => ['query.execute', 'schema.apply'].includes(task.kind))).toEqual([]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      await verifySource('列编码定义与数据'); const screenshotPath = resolve(info.outputPath('列编码成功确认区域.png')), inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('专项截图不能写入原profile目录'); await step(() => confirmation.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      await verifySource('退出客户端前'); await step(() => confirmation.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(confirmation).toBeHidden()); check(); await confirmOwnedDesktopExit(info); closed = true; originalProcessExitCode = originalProcess.exitCode; check(); expect(originalProcessExitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); check(); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed === true).toBe(true); await verifySource('退出与控制收尾后'); expect(sourceChecks).toEqual(phases);
      await step(() => info.attach('新建表列编码专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-create-column-encoding-ui', version: 1, platform: process.platform, database, table, serverVersion: '8.4.11', controlThreadId: threadId, rowCount: rows.length, taskCounts, normalExit: closed, originalProcessExitCode, observerClosed, targetThreadsAfterExit: 0, tableRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_TABLE_CREATE_COLUMN_ENCODING_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
