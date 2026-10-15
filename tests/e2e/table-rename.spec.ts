import type { RowDataPacket } from 'mysql2/promise';
import { tableRenameZh as text } from '../../src/renderer/locales/tableRename.zh-CN';
import { assertTableRenameLiveTarget } from '../helpers/tableRenameTarget';
import { test, expect, page } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, type LiveContext } from './live-helpers';

const active = enabled && process.env.DBARK_TABLE_RENAME_TEST === '1';
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
  expect(before).toContain('RENAME TABLE'); await editor.click(); await page.keyboard.type('不可写入的SQL'); await expect(editor.locator('.view-lines')).toHaveText(before);
  const boxes = dialog().getByRole('checkbox'); expect(await boxes.count()).toBe(3); for (let index = 0; index < 3; index++) await boxes.nth(index).check();
}

test.describe('同库表重命名：正式Electron与真实数据库准备', () => {
  test.skip(!active, '必须双显式启用实库与表重命名验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    // 环境必须显式指定，不利用凭据文件补齐本轮目标或把严格TLS换成明文。
    assertTableRenameLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
    if (!process.env.DBARK_TEST_USER) throw new Error('必须显式指定专用测试账号');
    environment.DBARK_TEST_HOST = process.env.DBARK_TEST_HOST; environment.DBARK_TEST_PORT = process.env.DBARK_TEST_PORT;
    if (environment.DBARK_TEST_TLS !== process.env.DBARK_TEST_TLS || environment.DBARK_TEST_CA !== process.env.DBARK_TEST_CA) throw new Error('本轮TLS/CA与既有环境不一致，禁止降级或替换');
  });
  test('两个专用入口，复杂定义零重述、只读预览、双击一次、新标签真实重读', async ({}, info) => {
    await isolatedDatabase(async context => {
      const name = 'rename_complex'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,g INT GENERATED ALWAYS AS(length(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB COMMENT='原说明'`);
      const row = await open(context, name); await row.hover(); await row.getByRole('button', { name: `${text.title} ${name}`, exact: true }).click();
      if (!writablePort) { await expect(dialog()).toContainText(text.readonly); await expect(dialog().getByRole('textbox', { name: text.newName, exact: true })).toBeDisabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); return; }
      await expect(dialog().getByRole('textbox', { name: text.newName, exact: true })).toBeEnabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); const before = await ddl(context, name);
      await dialog().getByRole('textbox', { name: text.newName, exact: true }).fill('renamed_complex'); await preview(); expect(await ddl(context, name)).toBe(before);
      await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog()).toBeHidden({ timeout: 20000 });
      await expect(tablePage().locator('.context-bar')).toContainText('renamed_complex'); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0);
      expect(await ddl(context, 'renamed_complex')).toBe(before.replace('CREATE TABLE `rename_complex`', 'CREATE TABLE `renamed_complex`'));
      await expect(ddl(context, name)).rejects.toThrow(); const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableRename.apply')).toHaveLength(1);
    }, info);
  });
  test('实际目标已存在时预览拒绝，保留草稿和两张真实表', async ({}, info) => {
    test.skip(!writablePort, '本例要求已证明MySQL8写范围');
    await isolatedDatabase(async context => {
      for (const name of ['rename_conflict', 'occupied']) await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT PRIMARY KEY) ENGINE=InnoDB`);
      await open(context, 'rename_conflict'); await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await dialog().getByRole('textbox', { name: text.newName, exact: true }).fill('occupied'); await dialog().getByRole('button', { name: text.preview, exact: true }).click();
      await expect(dialog()).toContainText('占用'); await expect(dialog().getByRole('textbox', { name: text.newName, exact: true })).toHaveValue('occupied');
      expect(await ddl(context, 'rename_conflict')).toContain('CREATE TABLE `rename_conflict`'); expect(await ddl(context, 'occupied')).toContain('CREATE TABLE `occupied`');
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
  test('返回编辑释放旧预览，草稿关闭确认，未确认风险不会执行', async ({}, info) => {
    test.skip(!writablePort, '本例要求已证明MySQL8写范围');
    await isolatedDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${target(context, 'rename_back')}(id INT PRIMARY KEY) ENGINE=InnoDB`); await open(context, 'rename_back');
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await dialog().getByRole('textbox', { name: text.newName, exact: true }).fill('rename_back_new');
      await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      await dialog().getByRole('button', { name: text.back, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0); await expect(dialog().getByRole('textbox', { name: text.newName, exact: true })).toHaveValue('rename_back_new');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.some(task => task.kind === 'schema.tableRename.apply')).toBe(false);
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); expect(await ddl(context, 'rename_back')).toContain('CREATE TABLE `rename_back`');
    }, info);
  });
});
