import { clickSidebarAction } from './sidebar-menu';
import { columnPatchZh as text } from '../../src/renderer/locales/columnPatches.zh-CN';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { createHash } from 'node:crypto';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_JSON_COLUMNS_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认及列表不读取认证、不加载桌面；Root先创建本轮隔离夹具，只接受明确200/13384。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_jsonui_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('JSON字段设计缺少本轮准确明文隔离目标，拒绝启动');
test.skip(!active, '默认关闭：须Root显式提供准确隔离夹具及DBARK_JSON_COLUMNS_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('真实字段设计器新增JSON：只读预览、单次DDL、类型重读与原行保持', async ({}, info: TestInfo) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const qualified = '`' + target!.database! + '`.`subject`', databaseSql = '`' + target!.database! + '`', digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let definition = '', data = '', preparedThread = 0, cleanupThread = 0, created = false;
  const closes: { label: string; normal: boolean; streamClosed: boolean }[] = [];
  /** 每条辅助连接都重新核准确服务器和原生关闭；只在原owner仍有效时结算。 */
  async function auxiliary(label: string, action: (connection: import('mysql2/promise').Connection, id: number) => Promise<void>, afterExit = false): Promise<void> {
    const check = () => { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || !afterExit && current.closed) throw Error('辅助连接原owner失效'); };
    check(); const connection = await mysql.createConnection({ host: target!.host!, port: 13384, user: target!.user, password: target!.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 15000 }), native = (connection as any).connection, stream = native?.stream;
    expect(Boolean(native && stream)).toBe(true); let failure: unknown;
    try { check(); const [rows] = await connection.query<any[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS id'); check(); expect(rows).toHaveLength(1); expect(rows[0].version).toMatch(/^8\.4\.11(?:-|$)/); expect(rows[0].os).toBe('Linux'); expect(Number(rows[0].names)).toBe(0); expect(rows[0].uuid).toBe(target!.uuid); await action(connection, Number(rows[0].id)); check(); }
    catch (reason) { failure = reason; }
    check(); await closeMysqlConnection(native, true, false, 2000); expect(stream.closed).toBe(true); closes.push({ label, normal: true, streamClosed: true }); if (failure) throw failure;
  }
  /** 每步核原TestInfo、App和窗口，失败保留原资源，不重启或补退出。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  try {
    await auxiliary('prepare', async (connection, id) => {
      preparedThread = id; const [existing] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]); expect(existing).toHaveLength(0);
      await connection.query('CREATE DATABASE ' + databaseSql + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci'); created = true;
      await connection.query('CREATE TABLE ' + qualified + ' (id INT NOT NULL PRIMARY KEY,note VARCHAR(40)) ENGINE=InnoDB'); await connection.query("INSERT INTO " + qualified + " VALUES(1,'原行一'),(2,'原行二')");
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); definition = digest(ddl); data = digest(rows);
    });
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }), connectionName = 'JSON字段本例';
    for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => clickSidebarAction(connection, { name: zh.sidebar.text011, exact: true })); await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click()); await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const table = page.locator('.table-tab:visible'), dialog = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
    await step(() => table.getByRole('button', { name: text.title, exact: true }).click()); await step(() => dialog.getByRole('button', { name: text.add, exact: true }).click());
    await step(() => dialog.getByRole('textbox', { name: text.name, exact: true }).fill('doc')); await step(() => dialog.getByRole('combobox', { name: new RegExp('^' + text.family) }).selectOption('json')); await step(() => expect(dialog).toContainText(text.jsonHint));
    await step(() => dialog.getByRole('textbox', { name: text.comment, exact: true }).fill('JSON字段')); await step(() => dialog.getByRole('combobox', { name: text.nullable, exact: true }).selectOption('true')); await step(() => dialog.getByRole('combobox', { name: text.default, exact: true }).selectOption('none')); await step(() => dialog.getByRole('button', { name: text.rowSave, exact: true }).click());
    await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(dialog.getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible());
    await auxiliary('preview', async connection => { const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(digest(ddl)).toBe(definition); expect(digest(rows)).toBe(data); });
    expect((await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).filter(task => task.kind === 'schema.columns.apply')).toHaveLength(0);
    for (const label of [text.ackImplicit, text.ackWindow]) await step(() => dialog.getByRole('checkbox', { name: label, exact: true }).check());
    await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(dialog.getByRole('status')).toHaveText(text.succeeded)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
    await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
    await step(() => table.getByRole('button', { name: text.title, exact: true }).click()); await step(() => dialog.getByRole('button', { name: /^doc ·/ }).click()); await step(() => expect(dialog.getByRole('combobox', { name: new RegExp('^' + text.family) })).toHaveValue('json')); await step(() => dialog.getByRole('button', { name: text.back, exact: true }).click()); await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click());
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'schema.columns.apply')).toHaveLength(1); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(runtime.pageErrors).toEqual([]);
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    await auxiliary('cleanup', async (connection, id) => {
      cleanupThread = id; const [active] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=?', [target!.database!, preparedThread]); expect(active).toHaveLength(0);
      const [columns] = await connection.execute<any[]>('SELECT COLUMN_NAME AS name,DATA_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [target!.database!, 'subject']); expect(columns.map(row => row.name)).toEqual(['id', 'note', 'doc']); expect(columns[2]).toEqual({ name: 'doc', type: 'json', nullable: 'YES', comment: 'JSON字段' });
      const [rows] = await connection.query<any[]>('SELECT id,note FROM ' + qualified + ' ORDER BY id'), [docs] = await connection.query<any[]>('SELECT doc FROM ' + qualified); expect(digest(rows)).toBe(data); expect(docs).toHaveLength(2); expect(docs.every(row => row.doc === null)).toBe(true);
      expect(created && /^dbark_jsonui_[a-f0-9]{32}$/.test(target!.database!)).toBe(true); await connection.query('DROP DATABASE ' + databaseSql);
    }, true);
    await auxiliary('verify-absence', async connection => { const [db] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]), [threads] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=? OR ID=?', [target!.database!, preparedThread, cleanupThread]); expect(db).toHaveLength(0); expect(threads).toHaveLength(0); }, true);
    await info.attach('JSON字段实际界面', { body: Buffer.from(JSON.stringify({ jsonTypeSelected: true, previewZeroDdl: true, applyTasks: 1, definitionVerified: true, reopenedTypeJson: true, sourceRowsUnchanged: true, nullRows: 2, normalAppExit: true, databaseRemoved: true, closes })), contentType: 'application/json' });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('JSON字段隔离资源保留', { body: Buffer.from(JSON.stringify({ database: target!.database!, created, automaticCleanup: false, closes })), contentType: 'application/json' }); throw reason; }
});
