import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, pageErrors } from './desktop-fixture';
import { enabled, environment, isolatedDatabase } from './live-helpers';
import { tableGridZh as text } from '../../src/renderer/locales/tableGrid.zh-CN';

test.use({ trace: 'off' });
const table = () => page.locator('.table-tab:visible');
const panel = () => table().getByRole('region', { name: text.find, exact: true });
/** 使用真实对象树打开新表，保持生产连接、元数据和分页 IPC。 */
async function openTable(connectionName: string, database: string, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await databaseRow.getByRole('button', { name: database, exact: true }).click(); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().getByRole('button', { name: text.find, exact: true })).toBeEnabled();
}

test.describe('200隔离实库页内单处与正则替换', () => {
  test.skip(!enabled, '由主对话统一启用200隔离实库验收');
  test.beforeEach(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('仅允许主对话核对后的200隔离测试服务器'); });
  test('同格第二处替换和正则零宽预览零写库，明确集中提交后才更新精确原值', async ({}, result) => {
    test.setTimeout(120000);
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const qualified = '`' + database + '`.`find_single_regex`';
      await observer.query(`CREATE TABLE ${qualified} (id BIGINT UNSIGNED PRIMARY KEY,note TEXT,amount DECIMAL(30,6),payload BLOB) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${qualified} VALUES (18446744073709551615,'😀old前old后old',12345678901234567890.123456,UNHEX('00ff'))`);
      await openTable(connectionName, database, 'find_single_regex'); await table().getByRole('button', { name: text.find, exact: true }).click();
      await panel().getByRole('combobox', { name: text.column, exact: true }).selectOption('note'); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('old');
      await expect(panel().getByRole('status')).toContainText('0 / 3 处'); await panel().getByRole('button', { name: text.next, exact: true }).click(); await panel().getByRole('button', { name: text.next, exact: true }).click();
      await expect(panel().locator('.page-find-current')).toContainText('格内第 2 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('新'); await panel().getByRole('button', { name: text.replaceOne, exact: true }).click();
      await expect(table().locator('.row-modified')).toContainText('😀old前新后old');
      const read = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,note,amount,HEX(payload) AS payload FROM ${qualified}`))[0][0];
      expect(await read()).toMatchObject({ id: '18446744073709551615', note: '😀old前old后old', amount: '12345678901234567890.123456', payload: '00FF' });
      await panel().getByRole('checkbox', { name: text.regex, exact: true }).check(); await panel().getByRole('textbox', { name: text.query, exact: true }).fill('(?=old)'); await panel().getByRole('button', { name: text.search, exact: true }).click();
      await expect(panel().getByRole('status')).toContainText('0 / 2 处'); await panel().getByRole('textbox', { name: text.replacement, exact: true }).fill('$1'); await panel().getByRole('button', { name: text.preview, exact: true }).click();
      const preview = page.getByRole('dialog', { name: text.replaceTitle, exact: true }); await expect(preview).toContainText('😀$1old前新后$1old'); expect((await read()).note).toBe('😀old前old后old');
      await preview.getByRole('button', { name: text.apply, exact: true }).click(); await expect(table().locator('.row-modified')).toContainText('😀$1old前新后$1old'); expect((await read()).note).toBe('😀old前old后old');
      await table().getByRole('button', { name: '预览并提交', exact: true }).click(); const submit = page.getByRole('dialog', { name: '确认数据修改', exact: true }); await expect(submit.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await submit.getByRole('button', { name: '确认提交', exact: true }).click();
      await expect(submit).toHaveCount(0); expect(await read()).toMatchObject({ id: '18446744073709551615', note: '😀$1old前新后$1old', amount: '12345678901234567890.123456', payload: '00FF' }); expect(pageErrors).toEqual([]);
    }, result);
  });
});
