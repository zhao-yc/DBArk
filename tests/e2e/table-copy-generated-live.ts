// 沿固定c138复制结构正式流程追加VIRTUAL/STORED场景；实际0。
import { cleanupTableCopyStructureCase } from './table-copy-structure-live';
import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources } from './desktop-fixture';
import { connectAndCreate, environment } from './live-helpers';
import { tableCopyStructureZh as text } from '../../src/renderer/locales/tableCopyStructure.zh-CN';
import { tableCopyStructureTarget, type TableCopyStructureTargetKey } from '../helpers/tableCopyStructureTarget';
/** 只注册未执行定义；不修改共享fixture，ROOT须另行安排固定候选与实际服务器终态证明。 */
export function registerTableCopyGeneratedUiTests() {
  const key: TableCopyStructureTargetKey = 'mysql84';
  tableCopyStructureTarget(key, process.env, environment); test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  for (const storage of ['VIRTUAL', 'STORED'] as const) test('MySQL8.4.11普通生成列'+storage+'先展示DDL和准确确认，单次创建空表并保持源数据与结构', async ({}, info) => {
    const target = tableCopyStructureTarget(key, process.env, environment), captured = ownedDesktopResources(info), own = () => ownedDesktopResources(info), page = captured.page, database = 'dbark_copy_' + randomUUID().replaceAll('-', '');
    let observer: Connection | undefined, ownsName = false, primary: { reason: unknown } | undefined;
    /** 观察SQL未知或归属变化立即保留，禁止finally继续猜测清库。 */
    const observe = async <T>(request: () => Promise<T>): Promise<T> => { own(); try { const value = await request(); own(); return value; } catch (reason) { retainOwnedDesktopResources(info); throw reason; } };
    try {
      observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: target.port, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', connectTimeout: 15000 }); own(); const connection = observer;
      const [facts] = await observe(() => connection.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid'));
      expect(String(facts[0].version)).toMatch(target.versionPattern); expect(['linux', 'debian-linux-gnu']).toContain(String(facts[0].os).toLowerCase()); expect(Number(facts[0].names)).toBe(0); expect(facts[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const [existing] = await observe(() => connection.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])); expect(existing).toHaveLength(0); ownsName = true;
      const context = await connectAndCreate(database, { page, application: captured.application, assertCurrent: () => { own(); } }); own();
      const source = '`' + database + '`.`copy_source`', destination = '`' + database + '`.`copy_destination`';
      await observe(() => connection.query(`CREATE TABLE ${source} (id int NOT NULL,price decimal(30,12) NOT NULL,total decimal(50,12) GENERATED ALWAYS AS (id * price + 9007199254740993.123456789012) ${storage},note varchar(80) DEFAULT NULL,PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='合成生成列来源'`));
      await observe(() => connection.query(`INSERT INTO ${source} (id,price,note) VALUES(1,2.000000000001,'源行不会复制')`));
      const [before] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsBefore] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }); await node.getByRole('button', { name: context.connectionName, exact: true }).focus(); own(); await node.getByRole('button', { name: '刷新连接', exact: true }).click(); own(); await node.locator('.database-row').getByRole('button', { name: database, exact: true }).click(); own(); await node.locator('.object-row').getByText('copy_source', { exact: true }).click(); own();
      const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); own(); await table.getByRole('button', { name: text.title, exact: true }).click(); own();
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await expect(dialog.getByRole('heading', { name: text.sourceDdl, exact: true })).toBeVisible(); own(); await dialog.getByRole('textbox', { name: text.newName, exact: true }).fill('copy_destination'); own(); await dialog.getByRole('button', { name: text.preview, exact: true }).click(); own(); await expect(dialog.locator('.monaco-editor .view-lines').last()).toContainText('LIKE'); own();
      const [absent] = await observe(() => connection.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [database, 'copy_destination'])); expect(absent).toHaveLength(0);
      await expect(dialog.getByRole('heading', { name: text.generated, exact: true })).toBeVisible(); own(); await expect(dialog).toContainText(storage === 'VIRTUAL' ? text.generatedVirtual : text.generatedStored); own();
      const submit = dialog.getByRole('button', { name: text.apply, exact: true }); for (const label of [text.ackImplicit, text.ackScope, text.ackWindow, text.ackGenerated]) { await dialog.getByRole('checkbox', { name: label, exact: true }).check(); own(); }
      await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination '); own(); await expect(submit).toBeDisabled(); own(); await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.copy_destination'); own(); await submit.dblclick(); own(); await expect(dialog.locator('.table-copy-structure-outcome')).toHaveText(text.succeeded, { timeout: 30000 }); own(); await expect(submit).toBeDisabled(); own();
      const [after] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + source)); const [rowsAfter] = await observe(() => connection.query<RowDataPacket[]>('SELECT id,note FROM ' + source)); const [created] = await observe(() => connection.query<RowDataPacket[]>('SHOW CREATE TABLE ' + destination)); const [empty] = await observe(() => connection.query<RowDataPacket[]>('SELECT 1 FROM ' + destination + ' LIMIT 1'));
      expect(after).toEqual(before); expect(rowsAfter).toEqual(rowsBefore); expect(empty).toHaveLength(0); const expectedDefinition = String(before[0]['Create Table']).replace('CREATE TABLE `copy_source`', 'CREATE TABLE `copy_destination`'); expect(created[0]['Create Table']).toBe(expectedDefinition);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); own(); expect(tasks.filter(task => task.kind === 'schema.tableCopyStructure.apply')).toHaveLength(1); await dialog.getByRole('button', { name: text.close, exact: true }).click(); own(); await expect(node.locator('.object-row').getByText('copy_destination', { exact: true })).toBeVisible(); own();
    } catch (reason) { primary = { reason }; throw reason; }
    finally { await cleanupTableCopyStructureCase(info, observer, database, ownsName, primary); }
  });
}
