import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { randomUUID } from 'node:crypto';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableCreateGeneratedZh as generatedText } from '../../src/renderer/locales/tableCreateGenerated.zh-CN';
import { tableCreateZh as text } from '../../src/renderer/locales/tableCreate.zh-CN';
import { tableCreateColumnOrderZh as orderText } from '../../src/renderer/locales/tableCreateColumnOrder.zh-CN';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_CREATE_GENERATED_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'] as const;
/** 本专项只消费Root预置的唯一随机库；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('新表生成列原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('新表生成列拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_CREATE_GENERATED_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_create_generated_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('新表生成列须Root准确绑定200/13384/UUID及预置隔离库');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('新表生成列备用源码专项拒绝外部运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('新表生成列拒绝替代配置或交互运行');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 此定义仅做备用准确目标验收；源码完整清单、安装版和Mac另由Root独立安排，不由本例冒称。 */
export function registerTableCreateGeneratedUiTests() {
  const environment = bindEnvironment(), clocks = new Map<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ generatedCreateClock: ReturnType<typeof bindEditorIndentNativeCase> }>({
    generatedCreateClock: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('新表生成列必须单worker、原120秒和零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock); try { await use(clock); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ generatedCreateClock }, use) => { await use({ assertCurrent: () => generatedCreateClock.assertCurrent(), assertPreparation(info) { if (clocks.get(info) !== generatedCreateClock) throw Error('新表生成列原启动归属变化'); generatedCreateClock.assertCurrent(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('新表生成列未完成原App与控制连接收尾，保留随机库和现场'); } });
  nativeTest('真实新表表单两种生成列、重排、三确认、目录及精确值核对', async ({ generatedCreateClock: clock, trace, screenshot, video }, info) => {
    const captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process();
    const database = environment.values.DBARK_TEST_DATABASE!, table = 'created_' + randomUUID().replaceAll('-', ''), quote = '`' + database + '`.`' + table + '`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any;
    /** 每个await前后仍核原TestInfo/窗口/进程/控制socket；首个未知永久保留，不补执行。 */
    const check = () => { clock.assertCurrent(); const owner = ownedDesktopResources(info); if (owner.page !== page || owner.application !== application || owner.closed !== closed || !closed && application.process() !== originalProcess || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('新表生成列原资源身份变化'); };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      database: 'SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
      columns: 'SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,EXTRA AS extra,GENERATION_EXPRESSION AS expression,ORDINAL_POSITION AS ordinal FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
      indexes: 'SELECT INDEX_NAME AS name,COLUMN_NAME AS col FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',
      definition: 'SHOW CREATE TABLE ' + quote,
      insert: 'INSERT INTO ' + quote + ' (`id`,`qty`,`price`,`moment`,`payload`,`memo`) VALUES (?,?,?,?,?,?),(?,?,?,?,?,?)',
      rows: "SELECT CAST(id AS CHAR) AS id,CAST(qty AS CHAR) AS qty,CAST(price AS CHAR) AS price,CAST(total AS CHAR) AS total,CAST(extra_value AS CHAR) AS extra_value,DATE_FORMAT(moment,'%Y-%m-%d %H:%i:%s.%f') AS moment,HEX(payload) AS payload,memo FROM " + quote + ' ORDER BY `' + table + '`.`id`',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    const inserted = ['9007199254740993', '3', '9007199254.123456', '2026-10-22 00:01:02.123456', Buffer.from('00ff000a', 'hex'), '中文🙂', '18446744073709551615', null, null, '2026-10-22 23:59:58.654321', Buffer.alloc(0), ''];
    /** 控制SQL与参数均固定，只写本例已准确核对的随机表；不接受动态任意SQL。 */
    const read = (sql: string, params: (string | number | Buffer | null)[] = []): Promise<any> => {
      if (!Object.values(statements).includes(sql) || sql === statements.database && (params.length !== 1 || params[0] !== database) || [statements.exists, statements.columns, statements.indexes].includes(sql) && (params.length !== 2 || params[0] !== database || params[1] !== table) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || sql === statements.insert && (params.length !== inserted.length || params.some((value, index) => Buffer.isBuffer(value) ? !Buffer.isBuffer(inserted[index]) || !value.equals(inserted[index] as Buffer) : value !== inserted[index])) || [statements.identity, statements.definition, statements.rows].includes(sql) && params.length) throw Error('新表生成列控制SQL或参数越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity) as RowDataPacket[]; expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true); expect(await read(statements.database, [database])).toEqual([{ name: database }]); expect(await read(statements.exists, [database, table])).toEqual([]);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '新表生成列专项'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '新表生成列专项' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.user === environment.values.DBARK_TEST_USER && profile.database === database && profile.rememberPassword === false && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const row = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => row.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(row.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true')); await step(() => row.hover()); await step(() => row.getByRole('button', { name: zh.sidebar.text017, exact: true }).click());
      const form = page.getByRole('dialog', { name: formatText(zh.schema.text009, database), exact: true }); await step(() => form.getByLabel(zh.schema.text010, { exact: true }).fill(table));
      for (const [position, name, type] of [[2, 'qty', 'bigint'], [3, 'price', 'decimal(20,6)'], [4, 'total', 'decimal(30,6)'], [5, 'extra_value', 'decimal(30,6)'], [6, 'moment', 'datetime(6)'], [7, 'payload', 'varbinary(20)'], [8, 'memo', 'varchar(80)']] as const) {
        await step(() => form.getByRole('button', { name: zh.schema.text027, exact: true }).click()); await step(() => form.getByLabel(formatText(zh.schema.text018, position), { exact: true }).fill(name)); await step(() => form.getByLabel(formatText(zh.schema.text019, position), { exact: true }).fill(type));
      }
      for (const [position, storage, expression] of [[4, 'VIRTUAL', 'qty * price'], [5, 'STORED', 'price + 2.000000']] as const) { await step(() => form.getByLabel(generatedText.mode(position), { exact: true }).selectOption(storage)); await step(() => form.getByLabel(generatedText.expression(position), { exact: true }).fill(expression)); }
      await step(() => form.getByRole('button', { name: orderText.upLabel(5), exact: true }).click()); await step(() => expect(form.getByLabel(generatedText.expression(4), { exact: true })).toHaveValue('price + 2.000000')); await step(() => form.getByRole('button', { name: zh.schema.text049, exact: true }).click());
      const confirmation = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(confirmation.locator('.monaco-editor .view-lines')).toContainText('GENERATED ALWAYS')); expect(await read(statements.exists, [database, table])).toEqual([]);
      const before = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(before.filter(task => ['schema.apply', 'schema.tableCreate.apply', 'query.execute'].includes(task.kind))).toEqual([]);
      await step(() => confirmation.getByLabel(text.confirmation, { exact: true }).fill(database + '.' + table)); for (const label of [text.ackDdl, text.ackCreate]) await step(() => confirmation.getByRole('checkbox', { name: label, exact: true }).check()); await step(() => expect(confirmation.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => confirmation.getByRole('checkbox', { name: generatedText.ack, exact: true }).check()); await step(() => confirmation.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(confirmation.getByRole('status')).toHaveText(text.succeeded));
      const columns = await read(statements.columns, [database, table]) as RowDataPacket[]; expect(columns.map(column => column.name)).toEqual(['id', 'qty', 'price', 'extra_value', 'total', 'moment', 'payload', 'memo']); expect(columns[3]).toMatchObject({ type: 'decimal(30,6)', nullable: 'YES', defaultValue: null, extra: 'STORED GENERATED' }); expect(columns[4]).toMatchObject({ type: 'decimal(30,6)', nullable: 'YES', defaultValue: null, extra: 'VIRTUAL GENERATED' }); expect(columns[3].expression).toBeTruthy(); expect(columns[4].expression).toBeTruthy(); expect(await read(statements.indexes, [database, table])).toEqual([{ name: 'PRIMARY', col: 'id' }]); const definition = await read(statements.definition); expect(String(definition[0]['Create Table'])).toContain('GENERATED ALWAYS');
      await read(statements.insert, inserted); const rows = await read(statements.rows); expect(rows).toEqual([{ id: '9007199254740993', qty: '3', price: '9007199254.123456', total: '27021597762.370368', extra_value: '9007199256.123456', moment: '2026-10-22 00:01:02.123456', payload: '00FF000A', memo: '中文🙂' }, { id: '18446744073709551615', qty: null, price: null, total: null, extra_value: null, moment: '2026-10-22 23:59:58.654321', payload: '', memo: '' }]);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); for (const command of ['schema.tableCreate.get', 'schema.tableCreate.preview', 'schema.tableCreate.apply']) { const selected = tasks.filter(task => task.kind === command); expect(selected).toHaveLength(1); expect(selected[0].status).toBe('completed'); } expect(tasks.some(task => ['running', 'queued', 'cancelling'].includes(task.status))).toBe(false); expect(tasks.filter(task => ['query.execute', 'schema.apply'].includes(task.kind))).toEqual([]);
      await step(() => confirmation.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(confirmation).toBeHidden()); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(await read(statements.threads, [database, threadId])).toEqual([]);
      check(); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed === true).toBe(true);
      await step(() => info.attach('新建表生成列备用终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-create-generated-ui', version: 1, platform: process.platform, database, table, serverVersion: '8.4.11', controlThreadId: threadId, rowCount: rows.length, normalExit: closed, observerClosed, tableRetainedForRoot: true, systemClipboard: 0, sourceManifestVerified: false, installerVerified: false })), contentType: 'application/json' }));
      finished.add(info);
    } catch (reason) { clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}
