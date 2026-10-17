import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test, expect, ownedDesktopResources, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { connectAndCreate, environment } from './live-helpers';
import { tableCopyStructureZh as text } from '../../src/renderer/locales/tableCopyStructure.zh-CN';

/** 首片未来定义仅准备ROOT明确分配的明文13384，不沿helper默认值猜目标或静默降级。 */
function target() {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS === '1') throw Error('首个复制结构UI定义仅准备200明文13384，其它组合未准备');
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS'] as const) if (process.env[key] !== environment[key]) throw Error('复制结构原始目标与helper配置不一致');
  if (!environment.DBARK_TEST_USER || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('须ROOT提供已有测试账号并先核对、绑定本轮服务器UUID');
}
/** 创建任务未确认成功或读取未知时先停链，不能借退出取消后继续删库。 */
export async function assertTableCopyStructureTasksTerminal(info: TestInfo): Promise<void> {
  try {
    const owner = ownedDesktopResources(info); if (owner.closed) throw Error('所属应用已关闭但缺少任务终态证明，保留现场');
    const tasks = await owner.page.evaluate(() => window.dbark.invoke('tasks.list', {})); ownedDesktopResources(info);
    if (!Array.isArray(tasks) || tasks.some(task => (task.kind.startsWith('schema.tableCopyStructure.') || task.kind.startsWith('schema.databaseCreate.')) && (task.kind.endsWith('.apply') ? task.status !== 'completed' : !['completed', 'failed', 'cancelled'].includes(task.status)))) throw Error('复制或建库任务尚未终态/未确认成功，保留数据库、观察连接和桌面现场');
  } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
}
/** 本例专用清理：任一前提失败立即停链；原失败保持为聚合首因，不恢复或重试未知DDL。 */
export async function cleanupTableCopyStructureCase(info: TestInfo, observer: Connection | undefined, database: string, ownsName: boolean, primary?: { reason: unknown }): Promise<void> {
  try {
    await assertTableCopyStructureTasksTerminal(info); ownedDesktopResources(info);
    await confirmOwnedDesktopExit(info); ownedDesktopResources(info);
    if (!/^dbark_copy_[a-f0-9]{32}$/.test(database)) throw Error('拒绝清理非本例隔离名称');
    if (ownsName) {
      if (!observer) throw Error('本例观察连接未知，保留现场');
      await observer.query('DROP DATABASE IF EXISTS `' + database + '`'); ownedDesktopResources(info);
      const [rows] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]); ownedDesktopResources(info); expect(rows).toHaveLength(0);
    }
    await observer?.end(); ownedDesktopResources(info);
  } catch (reason) { retainOwnedDesktopResources(info); if (primary) throw new AggregateError([primary.reason, reason], '原UI失败且任务、退出或观察清理未确认，保留本例现场', { cause: primary.reason }); throw reason; }
}
/** 只注册未执行定义；不修改共享fixture，ROOT须另行安排固定候选与实际服务器终态证明。 */
export function registerTableCopyStructureUiTests() {
  target(); test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  for (const autoIncrement of [false, true]) test('真实表入口'+(autoIncrement ? '（含自增列）' : '')+'先展示DDL和准确确认，单次创建空表并保持源数据与结构', async ({}, info) => {
    target(); const captured = ownedDesktopResources(info), own = () => ownedDesktopResources(info), page = captured.page, database = 'dbark_copy_' + randomUUID().replaceAll('-', '');
    let observer: Connection | undefined, ownsName = false, primary: { reason: unknown } | undefined;
    /** 观察SQL未知或归属变化立即保留，禁止finally继续猜测清库。 */
    const observe = async <T>(request: () => Promise<T>): Promise<T> => { own(); try { const value = await request(); own(); return value; } catch (reason) { retainOwnedDesktopResources(info); throw reason; } };
    try {
      observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: 13384, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', connectTimeout: 15000 }); own(); const connection = observer;
      const [facts] = await observe(() => connection.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
      expect(String(facts[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(['linux', 'debian-linux-gnu']).toContain(String(facts[0].os).toLowerCase()); expect(Number(facts[0].names)).toBe(0); expect(facts[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const [existing] = await observe(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])); expect(existing).toHaveLength(0); ownsName = true;
      const context = await connectAndCreate(database, { page, application: captured.application, assertCurrent: () => { own(); } }); own();
      const source = '`' + database + '`.`copy_source`', destination = '`' + database + '`.`copy_destination`';
      if (autoIncrement) await observe(() => connection.query('SET SESSION information_schema_stats_expiry = 0'));
      await observe(() => connection.query(`CREATE TABLE ${source}(id BIGINT${autoIncrement ? ' UNSIGNED NOT NULL AUTO_INCREMENT' : ' NOT NULL'} PRIMARY KEY,note VARCHAR(80),KEY note_idx(note)) ENGINE=InnoDB${autoIncrement ? ' AUTO_INCREMENT=42' : ''} DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='合成来源'`));
      await observe(() => connection.query(`INSERT INTO ${source} VALUES(1,'源行不会复制')`));
      const [before] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsBefore] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }); await node.getByRole('button', { name: context.connectionName, exact: true }).focus(); own(); await node.getByRole('button', { name: '刷新连接', exact: true }).click(); own(); await node.locator('.database-row').getByRole('button', { name: database, exact: true }).click(); own(); await node.locator('.object-row').getByText('copy_source', { exact: true }).click(); own();
      const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); own(); await table.getByRole('button', { name: text.title, exact: true }).click(); own();
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await expect(dialog.getByRole('heading', { name: text.sourceDdl, exact: true })).toBeVisible(); own(); await dialog.getByRole('textbox', { name: text.newName, exact: true }).fill('copy_destination'); own(); await dialog.getByRole('button', { name: text.preview, exact: true }).click(); own(); await expect(dialog.locator('.monaco-editor .view-lines').last()).toContainText('LIKE'); own();
      const [absent] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'copy_destination'])); expect(absent).toHaveLength(0);
      const submit = dialog.getByRole('button', { name: text.apply, exact: true }); for (const label of [text.ackImplicit, text.ackScope, text.ackWindow, ...(autoIncrement ? [text.ackAutoIncrement] : [])]) { await dialog.getByRole('checkbox', { name: label, exact: true }).check(); own(); }
      await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination '); own(); await expect(submit).toBeDisabled(); own(); await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination'); own(); await submit.dblclick(); own(); await expect(dialog.locator('.table-copy-structure-outcome')).toHaveText(text.succeeded, { timeout: 30000 }); own(); await expect(submit).toBeDisabled(); own();
      const [after] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsAfter] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source)); const [created] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + destination)); const [empty] = await observe(() => connection.query<RowDataPacket[]>('SELECT 1 FROM ' + destination + ' LIMIT 1'));
      expect(after).toEqual(before); expect(rowsAfter).toEqual(rowsBefore); expect(empty).toHaveLength(0); const expectedDefinition = String(before[0]['Create Table']).replace('CREATE TABLE `copy_source`', 'CREATE TABLE `copy_destination`'); expect(created[0]['Create Table']).toBe(autoIncrement ? expectedDefinition.replace('ENGINE=InnoDB AUTO_INCREMENT=42', 'ENGINE=InnoDB') : expectedDefinition);
      if (autoIncrement) { const [counter] = await observe(() => connection.query<RowDataPacket[]>('SELECT CAST(AUTO_INCREMENT AS CHAR) AS value FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'copy_destination'])); expect(counter).toEqual([{ value: '1' }]); }
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); own(); expect(tasks.filter(task => task.kind === 'schema.tableCopyStructure.apply')).toHaveLength(1); await dialog.getByRole('button', { name: text.close, exact: true }).click(); own(); await expect(node.locator('.object-row').getByText('copy_destination', { exact: true })).toBeVisible(); own();
    } catch (reason) { primary = { reason }; throw reason; }
    finally { await cleanupTableCopyStructureCase(info, observer, database, ownsName, primary); }
  });
}
