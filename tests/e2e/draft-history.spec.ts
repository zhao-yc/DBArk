import { clickSidebarAction } from './sidebar-menu';
import { test, expect, page } from './desktop-fixture';
import { draftHistoryZh as history } from '../../src/renderer/locales/draftHistory.zh-CN';
import { pasteInsertZh as paste } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { LiveContext } from './live-helpers';

// 本轮仅list；实际GUI及200专项必须由ROOT另行安排，列表阶段不加载私网帮助器。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_D02_DRAFT_HISTORY_UI === '1';
test.skip(!enabled, '默认关闭：本页草稿撤销重做等待ROOT独立安排GUI及已核200');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const table = () => page.locator('.table-tab:visible');

/** 后续验收使用原隔离库和连接流程，不改运行环境、不在list时连接。 */
async function isolated(body: (context: LiveContext) => Promise<void>, info: Parameters<typeof import('./live-helpers').isolatedDatabase>[1]) {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384') throw Error('草稿历史专项仅允许ROOT已核200/13384');
  const live = await import('./live-helpers');
  await live.isolatedDatabase(async context => {
    await context.observer.query(`CREATE TABLE \`${context.database}\`.subject(id BIGINT PRIMARY KEY AUTO_INCREMENT,note TEXT) ENGINE=InnoDB`);
    await context.observer.query(`INSERT INTO \`${context.database}\`.subject(note) VALUES ('原值')`);
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
    await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus();
    await clickSidebarAction(connection, { name: '刷新连接', exact: true });
    await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click();
    await connection.locator('.object-row').filter({ has: page.getByText('subject', { exact: true }) }).getByText('subject', { exact: true }).click();
    await expect(table().locator('.loading-overlay')).toHaveCount(0); await body(context);
    const [rows] = await context.observer.query(`SELECT note FROM \`${context.database}\`.subject`);
    expect(rows).toEqual([expect.objectContaining({ note: '原值' })]);
  }, info);
}

test('本页草稿：一次单格编辑可撤销重做，编辑输入期间禁用页面历史', async ({}, info) => {
  test.setTimeout(120000); await isolated(async () => {
    await table().getByRole('gridcell').filter({ hasText: /^原值$/ }).dblclick(); const input = table().locator('.grid-input');
    await input.fill('新值'); await expect(table().getByRole('button', { name: history.undo, exact: true })).toBeDisabled();
    await input.press('Enter'); await expect(input).toHaveCount(0);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.undo, exact: true })).click(); await expect(table().getByRole('gridcell').filter({ hasText: /^原值$/ })).toHaveCount(1);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.redo, exact: true })).click(); await expect(table().getByRole('gridcell').filter({ hasText: /^新值$/ })).toHaveCount(1);
  }, info);
});

test('本页草稿：单行与批量新增各为一步，重做不提交数据库', async ({}, info) => {
  test.setTimeout(120000); await isolated(async () => {
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: zh.common.add, exact: true })).click(); await expect(table().locator('.row-inserted')).toHaveCount(1);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.undo, exact: true })).click(); await expect(table().locator('.row-inserted')).toHaveCount(0);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.redo, exact: true })).click(); await expect(table().locator('.row-inserted')).toHaveCount(1);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: paste.action, exact: true })).click(); const dialog = page.getByRole('dialog', { name: paste.action, exact: true });
    await dialog.getByLabel(paste.input, { exact: true }).fill('甲\n乙'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: paste.preview, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: paste.stage, exact: true })).click();
    await expect(table().locator('.row-inserted')).toHaveCount(3); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.undo, exact: true })).click(); await expect(table().locator('.row-inserted')).toHaveCount(1);
    await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: history.redo, exact: true })).click(); await expect(table().locator('.row-inserted')).toHaveCount(3);
  }, info);
});
