import { test, expect, page, pageErrors } from './desktop-fixture';
import { enabled, isolatedDatabase } from './live-helpers';
import { objectUri } from '../../src/shared/workbench';

// 此用例仅供统筹在已核验的隔离服务器资源上显式运行，默认不联网。
test.skip(!enabled, '需要统筹显式启用 200 服务器隔离数据库验收');
test.use({ trace: 'off' });

/** 引用仅来源于本例生成的隔离库或固定测试对象，不接受外部 SQL 文本。 */
const quote = (name: string) => '`' + name.replaceAll('`', '``') + '`';

test('实库对象树星标、成功打开与对象删除后链接失败', async ({}, testInfo) => {
  await isolatedDatabase(async ({ observer, database, connectionId }) => {
    const table = '含空 格`表'; const view = 'constructor';
    await observer.query(`CREATE TABLE ${quote(database)}.${quote(table)} (id INT PRIMARY KEY)`);
    await observer.query(`CREATE VIEW ${quote(database)}.${quote(view)} AS SELECT id FROM ${quote(database)}.${quote(table)}`);
    await observer.query(`CREATE PROCEDURE ${quote(database)}.${quote(table)}() SELECT 1`);
    const [before] = await observer.query(`SHOW CREATE TABLE ${quote(database)}.${quote(table)}`);
    const dbRow = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
    await dbRow.getByRole('button', { name: database, exact: true }).click();
    const row = page.locator('.object-row').filter({ has: page.getByTitle(`表 · ${table}`, { exact: true }) });
    await expect(row).toBeVisible(); await row.locator('.tree-label').focus();
    await row.getByRole('button', { name: `添加收藏：${table}`, exact: true }).click();
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('workbench.get', {}))).document.favorites.length).toBe(1);
    // 收藏操作前后数据库定义原样不变，未触发结构写入。
    const [after] = await observer.query(`SHOW CREATE TABLE ${quote(database)}.${quote(table)}`); expect(after).toEqual(before);
    const shelf = page.getByRole('region', { name: '对象收藏', exact: true });
    await shelf.getByRole('button').filter({ hasText: table }).click();
    await expect(page.locator('.table-tab:visible')).toBeVisible();
    await expect(page.locator('.table-tab:visible .error-box')).toHaveCount(0);
    const profilesBefore = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
    // 同名过程采用明确类型核验，读取的是过程定义而非表页。
    await page.locator('.app-commandbar').getByRole('button', { name: '粘贴对象链接', exact: true }).click();
    let link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
    await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId, database, kind: 'procedure', name: table }));
    await link.getByRole('button', { name: '打开链接', exact: true }).click();
    const definition = page.getByRole('dialog');
    await expect(definition).toContainText('只读');
    await expect(definition.getByRole('button', { name: '执行 SQL', exact: true })).toHaveCount(0);
    await definition.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await observer.query(`DROP VIEW ${quote(database)}.${quote(view)}`);
    await page.locator('.app-commandbar').getByRole('button', { name: '粘贴对象链接', exact: true }).click();
    link = page.getByRole('dialog', { name: '粘贴对象链接', exact: true });
    await link.getByLabel('DBArk 对象链接', { exact: true }).fill(objectUri({ connectionId, database, kind: 'view', name: view }));
    await link.getByRole('button', { name: '打开链接', exact: true }).click();
    await expect(link.getByRole('alert')).toContainText('原对象已删除');
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual(profilesBefore);
    expect(pageErrors).toEqual([]);
  }, testInfo);
});
