import { clickSidebarAction } from './sidebar-menu';
import { test, expect, desktop, page, retainOwnedDesktopResources } from './desktop-fixture';
import { environment, isolatedDatabase } from './live-helpers';
import { withNativeClipboard } from './native-clipboard';
import { copyInsertSqlZh as text } from '../../src/shared/copyInsertSql.zh-CN';

/** 验收通过真实对象树打开明确表目标，不能注入 React 状态或伪造元数据。 */
async function openTable(connectionName: string, database: string, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection.locator('.connection-row'), { name: '刷新连接', exact: true });
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await expect(databaseRow).toBeVisible(); await (await (await import('./navigation-menu')).navigationMenuItem(databaseRow, { name: database, exact: true })).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  const table = page.locator('.table-tab:visible'); await expect(table.locator('.context-bar')).toContainText(name); await expect(table.locator('.loading-overlay')).toHaveCount(0); return table;
}
/** 只在 ROOT 单独授予真实 GUI、200 数据库及系统剪贴板许可后注册；本切片实际执行为零。 */
export function registerCopyInsertSqlNativeTest() {
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.beforeEach(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200' || environment.DBARK_TEST_PORT !== '13384') throw Error('仅允许 ROOT 已核对的200/13384隔离验收窗口'); });
  test('真实表页当前及选中行复制 INSERT、草稿与生成列拒绝', async ({}, info) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const target = '`' + database + '`.`copy_insert_values`';
      await observer.query(`CREATE TABLE ${target} (id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,6), stamp DATETIME(6), note TEXT, payload BLOB, doc JSON, nullable_value TEXT) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${target} VALUES (18446744073709551615,12345678901234567890.120000,'2026-10-17 01:02:03.123456','原始记录甲',X'00ff8000','{"n":18446744073709551615}',NULL),(2,2.000001,'2026-10-17 02:03:04.654321','原始记录乙',X'',NULL,'')`);
      const [before] = await observer.query(`SELECT CAST(id AS CHAR) id,CAST(amount AS CHAR) amount,CAST(stamp AS CHAR) stamp,note,HEX(payload) payload,CAST(doc AS CHAR) doc,nullable_value FROM ${target} ORDER BY id`);
      try {
        await withNativeClipboard(async () => {
          let table = await openTable(connectionName, database, 'copy_insert_values');
          const first = table.locator('.results-grid [role="row"]').filter({ hasText: '原始记录甲' }), second = table.locator('.results-grid [role="row"]').filter({ hasText: '原始记录乙' });
          await first.getByRole('gridcell').filter({ hasText: '原始记录甲' }).click(); await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.current, exact: true })).click(); await expect(table).toContainText(text.copied);
          await expect.poll(() => desktop.evaluate(async ({ clipboard }, database) => (await clipboard.readText()).includes('INSERT INTO `' + database + '`.`copy_insert_values`'), database)).toBe(true);
          const current = await desktop.evaluate(({ clipboard }) => clipboard.readText());
          expect(current).toContain('INSERT INTO `' + database + '`.`copy_insert_values`'); expect(current).toContain('18446744073709551615'); expect(current).toContain('12345678901234567890.120000'); expect(current).toContain("X'00ff8000'"); expect(current).toContain(Buffer.from('2026-10-17 01:02:03.123456').toString('hex')); expect(current).toContain('NULL'); expect(current.split('\n')).toHaveLength(1);
          await first.getByRole('checkbox').check(); await second.getByRole('checkbox').check(); await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.selected, exact: true })).click(); await expect(table).toContainText(text.copied);
          await expect.poll(() => desktop.evaluate(async ({ clipboard }) => (await clipboard.readText()).split('\n').length)).toBe(2);
          const selected = await desktop.evaluate(({ clipboard }) => clipboard.readText()); expect(selected.split('\n')).toHaveLength(2);
          await first.getByRole('gridcell').filter({ hasText: '原始记录甲' }).dblclick(); const input = table.locator('.grid-input'); await input.fill('未保存草稿'); await input.press('Enter');
          await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.selected, exact: true })).click(); await expect(table).toContainText(text.draft);
          expect(await desktop.evaluate(async ({ clipboard }, value) => await clipboard.readText() === value, selected)).toBe(true);
          await observer.query('CREATE TABLE `' + database + '`.`copy_insert_generated` (id INT, derived INT GENERATED ALWAYS AS (id+1) STORED)'); await observer.query('INSERT INTO `' + database + '`.`copy_insert_generated` (id) VALUES (1)');
          table = await openTable(connectionName, database, 'copy_insert_generated'); await table.locator('.results-grid [role="gridcell"]').first().click(); await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: text.current, exact: true })).click(); await expect(table).toContainText(text.type);
          expect(await desktop.evaluate(async ({ clipboard }, value) => await clipboard.readText() === value, selected)).toBe(true);
        });
      } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
      const [after] = await observer.query(`SELECT CAST(id AS CHAR) id,CAST(amount AS CHAR) amount,CAST(stamp AS CHAR) stamp,note,HEX(payload) payload,CAST(doc AS CHAR) doc,nullable_value FROM ${target} ORDER BY id`);
      expect(after).toEqual(before);
    }, info, { captureFailureScreenshot: false });
  });
}
