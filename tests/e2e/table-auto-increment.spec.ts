import type { RowDataPacket } from 'mysql2/promise';
import { tableAutoIncrementZh as text } from '../../src/renderer/locales/tableAutoIncrement.zh-CN';
import { assertTableAutoIncrementLiveTarget } from '../helpers/tableAutoIncrementTarget';
import { test, expect, page } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, type LiveContext } from './live-helpers';

const active = enabled && process.env.DBARK_TABLE_AUTO_INCREMENT_TEST === '1';
const writablePort = ['13380', '13384', '13484'].includes(process.env.DBARK_TEST_PORT ?? '');
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, name: string) => `\`${context.database}\`.\`${name}\``;
/** 通过对象树真实名称打开；保持可见性和点击命中检查，禁止force click。 */
async function open(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  const row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }); await row.getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); return row;
}
async function ddl(context: LiveContext, name: string) { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW CREATE TABLE ' + target(context, name)); return String(rows[0]['Create Table']); }
/** 只通过中文复选框确认三项风险，SQL编辑器必须保持只读。 */
async function preview() {
  await dialog().getByRole('button', { name: text.preview, exact: true }).click();
  await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  const editor = dialog().locator('.monaco-editor'), before = await editor.locator('.view-lines').innerText();
  expect(before).toContain('AUTO_INCREMENT ='); await editor.click(); await page.keyboard.type('不可写入的SQL'); await expect(editor.locator('.view-lines')).toHaveText(before);
  const boxes = dialog().getByRole('checkbox'); expect(await boxes.count()).toBe(3); for (let index = 0; index < 3; index++) await boxes.nth(index).check();
}

test.describe('表级下一自增值：正式Electron与真实数据库准备', () => {
  test.skip(!active, '必须双显式启用实库与下一自增值验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    // 环境必须显式指定，不利用凭据文件补齐本轮目标或把严格TLS换成明文。
    assertTableAutoIncrementLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
    if (!process.env.DBARK_TEST_USER) throw new Error('必须显式指定专用测试账号');
    environment.DBARK_TEST_HOST = process.env.DBARK_TEST_HOST; environment.DBARK_TEST_PORT = process.env.DBARK_TEST_PORT;
    if (environment.DBARK_TEST_TLS !== process.env.DBARK_TEST_TLS || environment.DBARK_TEST_CA !== process.env.DBARK_TEST_CA) throw new Error('本轮TLS/CA与既有环境不一致，禁止降级或替换');
  });
  test('两入口只读预览，精确大数上调一次，真实目录及定义后核验', async ({}, info) => {
    await isolatedDatabase(async context => {
      const name = 'auto_complex'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,g INT GENERATED ALWAYS AS(length(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB COMMENT='原说明'`);
      const row = await open(context, name); await row.hover(); await row.getByRole('button', { name: `${text.title} ${name}`, exact: true }).click();
      if (!writablePort) { await expect(dialog()).toContainText(text.readonly); await expect(dialog().getByRole('textbox', { name: text.value, exact: true })).toBeDisabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); return; }
      await expect(dialog().getByRole('textbox', { name: text.value, exact: true })).toBeEnabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); const before = await ddl(context, name);
      await dialog().getByRole('textbox', { name: text.value, exact: true }).fill('9007199254740993'); await preview(); expect(await ddl(context, name)).toBe(before);
      await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().locator('.table-auto-increment-outcome')).toHaveText(text.succeeded, { timeout: 20000 });
      await expect(dialog()).toContainText('9007199254740993'); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      await context.observer.query('SET SESSION information_schema_stats_expiry = 0');
      const [rows] = await context.observer.query<RowDataPacket[]>('SELECT CAST(AUTO_INCREMENT AS CHAR) AS value FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [context.database, name]); expect(rows[0].value).toBe('9007199254740993');
      expect((await ddl(context, name)).replace(/ AUTO_INCREMENT=[0-9]+/, '')).toBe(before.replace(/ AUTO_INCREMENT=[0-9]+/, ''));
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableAutoIncrement.apply')).toHaveLength(1);
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
  test('真实无自增列保持只读，不新增列属性或改写表', async ({}, info) => {
    await isolatedDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${target(context, 'no_auto')}(id INT PRIMARY KEY) ENGINE=InnoDB`); await open(context, 'no_auto'); const before = await ddl(context, 'no_auto');
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog()).toContainText(text.readonly); await expect(dialog().getByRole('textbox', { name: text.value, exact: true })).toBeDisabled();
      await dialog().getByRole('button', { name: text.close, exact: true }).click(); expect(await ddl(context, 'no_auto')).toBe(before);
    }, info);
  });
  test('拒绝非规范/降低计数，返回编辑释放预览，未确认风险不能执行', async ({}, info) => {
    test.skip(!writablePort, '本例要求已证明MySQL8写范围');
    await isolatedDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${target(context, 'auto_back')}(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB AUTO_INCREMENT=20`); await open(context, 'auto_back');
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await dialog().getByRole('textbox', { name: text.value, exact: true }).fill('19'); await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog()).toContainText('只允许上调');
      await dialog().getByRole('textbox', { name: text.value, exact: true }).fill('01'); await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog()).toContainText('规范正十进制');
      await dialog().getByRole('textbox', { name: text.value, exact: true }).fill('30'); await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      await dialog().getByRole('button', { name: text.back, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0); await expect(dialog().getByRole('textbox', { name: text.value, exact: true })).toHaveValue('30');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.some(task => task.kind === 'schema.tableAutoIncrement.apply')).toBe(false);
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
});
