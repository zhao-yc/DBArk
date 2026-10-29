import { test, expect, desktop, page } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, executeSql, writeSql } from './live-helpers';

test.use({ trace: 'off' });
const query = () => page.locator('.query-tab:visible');

/** 此套件由统筹注入隔离连接后逐版本执行，不读取其它克隆的凭据。 */
test.describe('原会话真实 JSON 执行计划', () => {
  test.skip(!enabled, '需统筹显式启用 200 服务器隔离实库环境');
  test('SELECT/JOIN/子查询/排序和临时表事务通过真实查询入口展示', async ({}, info) => {
    test.setTimeout(180000);
    await isolatedDatabase(async ({ database }) => {
      await openDatabaseQuery(database);
      await executeSql('CREATE TABLE customer(id INT PRIMARY KEY, active INT); CREATE TABLE orders(id INT PRIMARY KEY,customer_id INT,KEY customer_id(customer_id)); CREATE TABLE detail(id INT PRIMARY KEY,order_id INT,KEY order_id(order_id)); INSERT INTO customer VALUES(1,1),(2,0); INSERT INTO orders VALUES(1,1),(2,1); INSERT INTO detail VALUES(1,1),(2,2)');
      const sources = [
        'SELECT * FROM customer WHERE active=1',
        'SELECT c.id,o.id FROM customer c JOIN orders o ON o.customer_id=c.id WHERE c.active=1',
        'SELECT c.id FROM customer c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.id IN (SELECT order_id FROM detail))',
        'SELECT customer_id,COUNT(*) FROM orders GROUP BY customer_id ORDER BY COUNT(*) DESC',
        'SELECT id FROM customer UNION ALL SELECT id FROM orders',
      ];
      for (const source of sources) {
        await writeSql(source); await (await navigationMenuItem(query(), { name: '执行计划', exact: true })).click();
        await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled({ timeout: 20000 });
        await expect(query().locator('.error-box')).toHaveCount(0); await expect(query().getByRole('tree')).toBeVisible();
        await expect(query().getByRole('treeitem').first()).toBeVisible();
        await (await navigationMenuItem(query(), { name: '原始输出', exact: true })).click();
        await expect(query().getByLabel('原始输出', { exact: true })).toContainText('query_block');
      }
      await executeSql('CREATE TEMPORARY TABLE session_subject(id INT PRIMARY KEY); INSERT INTO session_subject VALUES(7); START TRANSACTION; UPDATE customer SET active=active+1 WHERE id=1');
      await writeSql('SELECT * FROM session_subject'); await (await navigationMenuItem(query(), { name: '执行计划', exact: true })).click();
      await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled({ timeout: 20000 });
      await expect(query().getByRole('treeitem').filter({ hasText: 'session_subject' })).toBeVisible();
      await expect((await navigationMenuItem(query(), { name: '提交', exact: true }))).toBeEnabled();
      // 编辑器改成会失败的另一条 SQL，文本按钮仍须分析首次捕获的临时表语句。
      await writeSql('SELECT * FROM missing_changed_draft'); await (await navigationMenuItem(query(), { name: '获取文本计划', exact: true })).click();
      await expect((await navigationMenuItem(query(), { name: '停止', exact: true }))).toBeDisabled({ timeout: 20000 });
      await expect(query().locator('.error-box')).toHaveCount(0); await expect(query().getByRole('grid')).toContainText('session_subject');
      await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1024, 680));
      await page.screenshot({ path: info.outputPath('live-explain-minimum.png') });
      await executeSql('ROLLBACK; SELECT DATABASE() AS current_database,(SELECT active FROM customer WHERE id=1) AS active,(SELECT id FROM session_subject) AS temporary_id');
      // 脚本第一结果是 ROLLBACK 的 OK 包，必须明确切到第二结果核对原会话数据。
      await (await navigationMenuItem(query(), { name: '结果 2', exact: true })).click();
      await expect(query().getByRole('grid')).toContainText(database); await expect(query().getByRole('grid')).toContainText('7');
      // 结果网格自带选择列，表头还附带类型；按业务名称前缀找到实际列坐标。
      for (const [name, value] of [['active', '1'], ['temporary_id', '7']]) {
        const index = await query().getByRole('columnheader', { name: new RegExp('^' + name) }).getAttribute('aria-colindex');
        expect(index).toMatch(/^[1-9]\d*$/);
        await expect(query().locator(`[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="${index}"]`)).toHaveText(value);
      }
      await expect((await navigationMenuItem(query(), { name: '提交', exact: true }))).toBeDisabled();
    }, info);
  });
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
