import type { RowDataPacket } from 'mysql2/promise';
import { tableCommentZh as text } from '../../src/renderer/locales/tableComment.zh-CN';
import { test, expect, page } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, type LiveContext } from './live-helpers';
import { narrowSidebar } from './sidebar-size';

const active = enabled && process.env.DBARK_TABLE_COMMENT_TEST === '1';
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
/** 原生对象树打开真实表，不注入React状态或模拟业务服务。 */
async function open(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  const row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }); await row.getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); return row;
}
async function ddl(context: LiveContext, table: string) { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW CREATE TABLE ' + target(context, table)); return String(rows[0]['Create Table']); }
/** 风险只通过真实中文复选框确认，不向产品注入确认ID。 */
async function preview() {
  await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('COMMENT =');
  const editor = dialog().locator('.monaco-editor'), before = await editor.locator('.view-lines').innerText();
  await editor.click(); await page.keyboard.type('不可写入的SQL'); await expect(editor.locator('.view-lines')).toHaveText(before);
  const boxes = dialog().getByRole('checkbox'); expect(await boxes.count()).toBe(2); for (let index = 0; index < 2; index++) await boxes.nth(index).check();
}

test.describe('表注释：正式Electron与真实数据库入口', () => {
  test.skip(!active, '必须同时显式启用实库与表注释验收'); test.setTimeout(120000);
  test.beforeEach(() => {
    environment.DBARK_TEST_HOST = process.env.DBARK_TEST_HOST ?? '192.168.31.200'; environment.DBARK_TEST_PORT = process.env.DBARK_COLUMN_PATCH_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384';
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(environment.DBARK_TEST_HOST) || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(environment.DBARK_TEST_PORT)) throw new Error('拒绝访问未核对的200专用实例');
    // 严格TLS实例必须由执行器显式注入CA；不能借本地env缺省值自动降级或换目标。
    if (environment.DBARK_TEST_PORT === '13484' && (process.env.DBARK_TEST_TLS !== '1' || environment.DBARK_TEST_TLS !== '1' || !process.env.DBARK_TEST_CA || environment.DBARK_TEST_CA !== process.env.DBARK_TEST_CA)) throw new Error('13484必须显式启用严格TLS并提供一致CA，禁止降级');
  });
  test('对象树与表页两入口，复杂定义不重述、只读预览零DDL、双击只执行一次', async ({}, info) => {
    await isolatedDatabase(async context => {
      await narrowSidebar();
      const table = 'comment_complex'; await context.observer.query(`CREATE TABLE ${target(context, table)}(id INT NOT NULL AUTO_INCREMENT,s VARCHAR(80) CHARACTER SET latin1 COLLATE latin1_bin,g INT GENERATED ALWAYS AS(length(s)) STORED,PRIMARY KEY(id),KEY pref(s(8))) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='原说明'`);
      const row = await open(context, table); await row.hover(); await row.getByRole('button', { name: `${text.title} ${table}`, exact: true }).click(); await expect(dialog().getByRole('textbox', { name: text.comment, exact: true })).toBeEnabled();
      await dialog().getByRole('button', { name: text.close, exact: true }).click(); await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      const before = await ddl(context, table), comment = "普通'说明\\路径\n第二行"; await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill(comment); await preview(); expect(await ddl(context, table)).toBe(before);
      await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeEnabled(); await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick();
      await expect(dialog().locator('.table-comment-outcome')).toHaveText(text.succeeded, { timeout: 20000 }); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      const [rows] = await context.observer.query<RowDataPacket[]>('SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [context.database, table]); expect(rows[0].comment).toBe(comment);
      expect((await ddl(context, table)).replace(/ COMMENT='(?:[^'\\]|\\.|'')*'/g, '')).toBe(before.replace(/ COMMENT='(?:[^'\\]|\\.|'')*'/g, ''));
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.tableComment.apply')).toHaveLength(1);
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
  test('物理引擎参数只读，注释草稿退出保护，返回编辑使旧预览失效', async ({}, info) => {
    await isolatedDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${target(context, 'comment_options')}(id INT PRIMARY KEY) ENGINE=InnoDB COMMENT='MERGE_THRESHOLD=40'`);
      await open(context, 'comment_options'); await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog()).toContainText(text.readonly); await expect(dialog().getByRole('textbox', { name: text.comment, exact: true })).toBeDisabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await context.observer.query(`CREATE TABLE ${target(context, 'comment_back')}(id INT PRIMARY KEY) ENGINE=InnoDB COMMENT='原说明'`); await open(context, 'comment_back'); await tablePage().getByRole('button', { name: text.title, exact: true }).click();
      await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill('尚未提交'); await preview(); await dialog().getByRole('button', { name: text.back, exact: true }).click();
      await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toHaveCount(0); await expect(dialog().getByRole('textbox', { name: text.comment, exact: true })).toHaveValue('尚未提交');
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.some(task => task.kind === 'schema.tableComment.apply')).toBe(false);
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
});
