import type { RowDataPacket } from 'mysql2/promise';
import { realpathSync } from 'node:fs';
import { tableDefaultEncodingZh as text } from '../../src/renderer/locales/tableDefaultEncoding.zh-CN';
import { test, expect, page } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, type LiveContext } from './live-helpers';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import { narrowSidebar } from './sidebar-size';

const active = enabled && process.env.DBARK_TABLE_DEFAULT_ENCODING_TEST === '1', dialog = () => page.getByRole('dialog', { name: text.title, exact: true }), tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
/** 只读取已保存连接的公开TLS概要；CA按既有夹具的realpath与观察连接保持一致。 */
async function assertSavedTls(context: LiveContext) {
  const profile = await page.evaluate(async id => {
    const value = (await window.dbark.invoke('connections.list', {})).find(profile => profile.id === id);
    return value ? { host: value.host, port: value.port, tls: value.tls ? { enabled: value.tls.enabled, rejectUnauthorized: value.tls.rejectUnauthorized, caPath: value.tls.caPath } : undefined } : undefined;
  }, context.connectionId);
  if (!profile) throw new Error('本轮保存连接不存在，不能继续默认编码验收');
  const strict = environment.DBARK_TEST_TLS === '1', caPath = strict ? realpathSync(environment.DBARK_TEST_CA!) : environment.DBARK_TEST_CA;
  if (strict && profile.tls?.caPath?.trim()) profile.tls.caPath = realpathSync(profile.tls.caPath);
  assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath }, profile);
}
/** 真实对象树入口，不注入React状态、候选或产品执行参数。 */
async function open(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click(); await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  const row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }); await row.getByText(name, { exact: true }).click(); await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); return row;
}
async function ddl(context: LiveContext, table: string) { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW CREATE TABLE ' + target(context, table)); return String(rows[0]['Create Table']); }
/** 必须在真实候选中完成两次选择，切换字符集时不会自动补规则。 */
async function choose() {
  await dialog().getByRole('combobox', { name: text.charset, exact: true }).selectOption('latin1'); await expect(dialog().getByRole('combobox', { name: text.collation, exact: true })).toHaveValue(''); await expect(dialog().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
  await dialog().getByRole('combobox', { name: text.collation, exact: true }).selectOption('latin1_swedish_ci');
}
async function preview() {
  await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  const editor = dialog().locator('.monaco-editor');
  // 标题出现不代表Monaco已画完；先等待真实SQL可见，再以同一innerText接口逐字核对只读性。
  await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replace(/\s+/gu, ' ')).toContain('DEFAULT CHARACTER SET');
  const before = await editor.locator('.view-lines').innerText(); expect(before).not.toContain('CONVERT TO'); await editor.click(); await page.keyboard.type('不能写入SQL'); await expect.poll(() => editor.locator('.view-lines').innerText()).toBe(before);
  const checks = dialog().getByRole('checkbox'); expect(await checks.count()).toBe(3); for (let index = 0; index < 3; index++) await checks.nth(index).check();
}
test.describe('表默认编码：正式Electron和真实数据库入口', () => {
  test.skip(!active, '必须显式启用实库与表默认编码验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    environment.DBARK_TEST_HOST = process.env.DBARK_TEST_HOST ?? '192.168.31.200'; environment.DBARK_TEST_PORT = process.env.DBARK_COLUMN_PATCH_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384';
    assertDefaultEncodingLiveTarget({ host: environment.DBARK_TEST_HOST, port: environment.DBARK_TEST_PORT, tlsFlag: environment.DBARK_TEST_TLS, caPath: environment.DBARK_TEST_CA });
  });
  test('对象树与表页两入口，实际候选成对、只读预览零DDL、双击一次并保留原列数据', async ({}, info) => {
    await isolatedDatabase(async context => {
      await narrowSidebar();
      await assertSavedTls(context);
      const table = 'default_complex'; await context.observer.query(`CREATE TABLE ${target(context, table)}(id INT NOT NULL,s VARCHAR(80),g INT GENERATED ALWAYS AS(CHAR_LENGTH(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, table)}(id,s) VALUES(1,'中文😀')`);
      const row = await open(context, table); await row.hover(); await row.getByRole('button', { name: `${text.title} ${table}`, exact: true }).click(); await expect(dialog().getByRole('combobox', { name: text.charset, exact: true })).toBeEnabled(); await expect(dialog()).toContainText(text.scope);
      await dialog().getByRole('button', { name: text.close, exact: true }).click(); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await choose(); const before = await ddl(context, table); await preview(); expect(await ddl(context, table)).toBe(before);
      await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().locator('.table-default-encoding-outcome')).toHaveText(text.succeeded, { timeout: 20000 }); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      const [columns] = await context.observer.query<RowDataPacket[]>('SELECT CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [context.database, table, 's']); expect(columns[0]).toMatchObject({ charset: 'utf8mb4', collation: 'utf8mb4_bin' });
      const [rows] = await context.observer.query<RowDataPacket[]>('SELECT s,g FROM ' + target(context, table)); expect(rows[0].s).toBe('中文😀'); expect(String(rows[0].g)).toBe('3');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableDefaultEncoding.apply')).toHaveLength(1); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
  test('物理参数只读，返回选择释放旧预览，未执行草稿显式放弃', async ({}, info) => {
    await isolatedDatabase(async context => {
      await assertSavedTls(context);
      await context.observer.query(`CREATE TABLE ${target(context, 'default_options')}(id INT PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='MERGE_THRESHOLD=40'`); await open(context, 'default_options'); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog()).toContainText(text.readonly); await expect(dialog().getByRole('combobox', { name: text.charset, exact: true })).toBeDisabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await context.observer.query(`CREATE TABLE ${target(context, 'default_back')}(id INT PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`); await open(context, 'default_back'); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await choose(); await preview(); await dialog().getByRole('button', { name: text.back, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0); await expect(dialog().getByRole('combobox', { name: text.collation, exact: true })).toHaveValue('latin1_swedish_ci');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.some(task => task.kind === 'schema.tableDefaultEncoding.apply')).toBe(false); await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
});
