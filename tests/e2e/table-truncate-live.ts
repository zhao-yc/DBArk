import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page } from './desktop-fixture';
import { isolatedDatabase, environment, type LiveContext } from './live-helpers';
import { tableTruncateZh as text } from '../../src/renderer/locales/tableTruncate.zh-CN';
import { assertTableTruncateLiveTarget } from '../helpers/tableTruncateTarget';
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
/** 使用实际对象树和TableTab入口，不通过IPC替代预览/确认/提交。 */
async function open(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }).getByText(name, { exact: true }).click();
  const table = page.locator('.table-tab:visible'); await expect(table.locator('.loading-overlay')).toHaveCount(0); await table.getByRole('button', { name: text.title, exact: true }).click();
  await expect(dialog().getByRole('button', { name: text.preview, exact: true })).toBeEnabled();
}
/** 只有入口双开关才加载此模块；执行权由ROOT另行安排，不是本片交付时的实库证据。 */
export function registerTableTruncateUiTests() {
  // 仅本例启用：退出未确认即停止清库、关闭观察连接和自动强制清理。
  test.use({ preserveOnUnconfirmedExit: true });
  test('真实UI准确表名与完整风险确认；旧预览不能双发，数据和自增经观察连接核对', async ({}, info) => {
    assertTableTruncateLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
    await isolatedDatabase(async context => {
      const [status] = await context.observer.query<RowDataPacket[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names');
      expect(String(status[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(Number(status[0].names)).toBe(0); expect(['linux', 'debian-linux-gnu']).toContain(String(status[0].os).toLowerCase());
      const table = `\`${context.database}\`.\`basic\``;
      await context.observer.query(`CREATE TABLE ${table}(id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,s VARCHAR(80)) ENGINE=InnoDB AUTO_INCREMENT=20`); await context.observer.query(`INSERT INTO ${table}(s) VALUES('合成数据')`);
      await open(context, 'basic'); await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('TRUNCATE TABLE');
      const submit = dialog().getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled();
      await dialog().getByLabel(text.confirmation, { exact: true }).fill(context.database + '.basic ');
      for (const label of [text.ackData, text.ackCounter, text.ackWindow]) await dialog().getByRole('checkbox', { name: label, exact: true }).check();
      await expect(submit).toBeDisabled(); const [before] = await context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table); expect(before).toHaveLength(1);
      await dialog().getByLabel(text.confirmation, { exact: true }).fill(context.database + '.basic'); await submit.click(); await expect(dialog().getByText(text.succeeded, { exact: true })).toBeVisible(); await expect(submit).toBeDisabled();
      const [after] = await context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table); expect(after).toHaveLength(0);
      await context.observer.query(`INSERT INTO ${table}(s) VALUES('重置后')`); const [next] = await context.observer.query<RowDataPacket[]>('SELECT id FROM ' + table); expect(String(next[0].id)).toBe('1');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableTruncate.apply')).toHaveLength(1);
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info, { captureFailureScreenshot: false });
  });
}
