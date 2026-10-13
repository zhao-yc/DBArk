import type { RowDataPacket } from 'mysql2/promise';
import { writeFile } from 'node:fs/promises';
import { test, expect, page, desktop, answerDialogs } from './desktop-fixture';
import { enabled, isolatedDatabase, acceptNativeConfirmation } from './live-helpers';

test.use({ trace: 'off' });

/** 对象由独立观察连接准备，随后完全通过对象树、表格和筛选表单操作。 */
async function openTable(database: string, name: string) {
  await page.locator('.database-row').getByRole('button', { name: database, exact: true }).click();
  await page.locator('.object-row').getByText(name, { exact: true }).dblclick();
  const table = page.locator('.table-tab:visible');
  await expect(table.locator('.loading-overlay')).toHaveCount(0);
  await expect(table.getByRole('columnheader', { name: /^id/ })).toBeVisible();
  return table;
}

/** 小数据集可全部显示；只读取实际 DOM 单元格，不触碰 React 状态或引擎接口。 */
async function expectIds(expected: number[]) {
  const table = page.locator('.table-tab:visible');
  await expect(table.locator('.loading-overlay')).toHaveCount(0);
  await expect(table.locator('.error-box')).toHaveCount(0);
  await expect.poll(async () => (await table.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents()).map(Number)).toEqual(expected);
}

/** 每次条件都经可见输入生成，保留集合里的逗号、空行及前后空格。 */
async function addFilter(column: string, operator: string, value?: string | [string, string], empty = false) {
  const table = page.locator('.table-tab:visible');
  await table.getByLabel('筛选字段', { exact: true }).selectOption(column);
  await table.getByLabel('筛选运算符', { exact: true }).selectOption(operator);
  if (operator === 'IN' || operator === 'NOT IN') {
    await table.getByLabel('集合值', { exact: true }).fill(value as string ?? '');
    await table.getByLabel('额外包含空字符串', { exact: true }).setChecked(empty);
  } else if (operator === 'BETWEEN') {
    await table.getByLabel('区间起始值', { exact: true }).fill(value![0]);
    await table.getByLabel('区间结束值', { exact: true }).fill(value![1]);
  } else if (!operator.includes('NULL')) await table.getByLabel('筛选值', { exact: true }).fill(value as string ?? '');
  await table.getByRole('button', { name: '添加条件', exact: true }).click();
}

/** 清空规则仍然走 UI，确认之前的结果已真正被新查询替换。 */
async function clearFilters() {
  await page.locator('.table-tab:visible').getByRole('button', { name: '清空', exact: true }).click();
  await expectIds([1, 2, 3, 4, 5, 6, 7, 8]);
}

test.describe('远程真实数据库表格筛选与规模', () => {
  test.skip(!enabled, '需要显式启用实库验收，并使用已核对的远程测试服务器');
  test.describe.configure({ timeout: 240000 });

  test('筛选组合保留 Unicode、NULL、空字符串与含逗号集合，并可编辑条件', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query('CREATE TABLE ' + database + '.filter_cases (id INT PRIMARY KEY, title VARCHAR(80), score INT NOT NULL) ENGINE=InnoDB');
      await observer.query('INSERT INTO ' + database + '.filter_cases (id,title,score) VALUES ?', [[[1, null, 1], [2, '', 2], [3, '中文🚀', 3], [4, '甲,乙', 4], [5, ' leading value ', 5], [6, 'abc', 6], [7, '中文另一个', 7], [8, '甲', 8]]]);
      const table = await openTable(database, 'filter_cases');
      await table.getByRole('button', { name: '筛选', exact: true }).click();
      await expectIds([1, 2, 3, 4, 5, 6, 7, 8]);
      await addFilter('title', '=', '中文🚀'); await expectIds([3]);
      await table.getByRole('button', { name: '编辑条件 1', exact: true }).click();
      await table.getByLabel('筛选值', { exact: true }).fill('甲,乙');
      await table.getByRole('button', { name: '保存条件', exact: true }).click(); await expectIds([4]);
      await table.getByRole('button', { name: '移除条件 1', exact: true }).click(); await expectIds([1, 2, 3, 4, 5, 6, 7, 8]);
      await addFilter('title', 'IS NULL'); await expectIds([1]); await clearFilters();
      await addFilter('title', '=', ''); await expectIds([2]); await clearFilters();
      await addFilter('title', 'IN', '甲,乙\n中文🚀'); await expectIds([3, 4]); await clearFilters();
      await addFilter('title', 'NOT IN', '甲,乙\n中文🚀'); await expectIds([2, 5, 6, 7, 8]); await clearFilters();
      await addFilter('title', 'IN', '', true); await expectIds([2]); await clearFilters();
      await addFilter('title', 'IN', ' leading value '); await expectIds([5]); await clearFilters();
      await addFilter('title', 'IN', '甲,乙\n'); await expectIds([2, 4]); await clearFilters();
      await addFilter('score', 'BETWEEN', ['3', '5']); await expectIds([3, 4, 5]); await clearFilters();
      await addFilter('title', 'NOT LIKE', '中文%'); await expectIds([2, 4, 5, 6, 8]); await clearFilters();
      await addFilter('score', '>=', '3'); await expectIds([3, 4, 5, 6, 7, 8]);
      await addFilter('score', '<=', '5'); await expectIds([3, 4, 5]); await clearFilters();
      await addFilter('title', 'IS NULL'); await expectIds([1]);
      await addFilter('title', '=', ''); await expectIds([]);
      await table.getByLabel('条件匹配方式', { exact: true }).selectOption('any'); await expectIds([1, 2]);
      await page.screenshot({ path: testInfo.outputPath('live-filter-any.png') });
      await table.getByLabel('条件匹配方式', { exact: true }).selectOption('all'); await expectIds([]);
      await table.getByRole('button', { name: '移除条件 1', exact: true }).click(); await expectIds([2]);
      await clearFilters();
      await table.getByLabel('跳转页码', { exact: true }).fill('2');
      await table.getByRole('button', { name: '跳转', exact: true }).click(); await expectIds([]);
      await addFilter('title', '=', '中文🚀'); await expectIds([3]);
      await expect(table.getByLabel('跳转页码', { exact: true })).toHaveValue('1');
      await clearFilters();
      // 用户取消丢弃草稿时，条件、原数据和当前修改都必须保留。
      await table.getByRole('gridcell', { name: '中文🚀', exact: true }).dblclick();
      const editor = table.getByLabel('编辑 title', { exact: true });
      await editor.fill('保留的本地草稿'); await editor.press('Enter');
      await expect(table.locator('.table-action-bar')).toContainText('1 条待提交修改');
      await answerDialogs([1]);
      await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as typeof dialog.showMessageBoxSync; });
      await addFilter('score', '=', '3');
      await expect(table.getByRole('button', { name: '编辑条件 1', exact: true })).toHaveCount(0);
      await expect(table.getByRole('gridcell', { name: '保留的本地草稿', exact: true })).toBeVisible();
      await expectIds([1, 2, 3, 4, 5, 6, 7, 8]);
      const [persistedDraft] = await observer.query<RowDataPacket[]>('SELECT title FROM ' + database + '.filter_cases WHERE id=3');
      expect(persistedDraft[0].title).toBe('中文🚀');
      await answerDialogs([]);
      await acceptNativeConfirmation();
      await table.getByRole('button', { name: '撤销', exact: true }).click();
      await expect(table.getByRole('gridcell', { name: '中文🚀', exact: true })).toBeVisible();
      // 精确整数筛选失败时必须清空旧页，不能把旧结果留在新条件下继续编辑。
      await addFilter('score', '=', 'abc');
      await expect(table.locator('.loading-overlay')).toHaveCount(0);
      await expect(table.locator('.error-box')).toBeVisible();
      await expect(table.locator('[role="gridcell"]')).toHaveCount(0);
      await table.getByRole('button', { name: '清空', exact: true }).click();
      await expectIds([1, 2, 3, 4, 5, 6, 7, 8]);
    }, testInfo);
  });

  test('百万行表仅渲染当前页，滚动千行后可直接跳到第一千页末行', async ({}, testInfo) => {
    test.skip(process.env.DBARK_TEST_MILLION !== '1', '百万行造数须显式设置 DBARK_TEST_MILLION=1');
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query('CREATE TABLE ' + database + '.million_rows (id INT PRIMARY KEY, label VARCHAR(80), bucket INT NOT NULL) ENGINE=InnoDB');
      const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
      const id = '(1+d0.n+10*d1.n+100*d2.n+1000*d3.n+10000*d4.n+100000*d5.n)';
      // 造数完全在服务器执行，客户端只接收一个状态包，避免测试自身载入百万条记录。
      await observer.query({ sql: 'INSERT INTO ' + database + '.million_rows SELECT ' + id + ",CONCAT('第',LPAD(" + id + ",7,'0'),'行🚀'),MOD(" + id + ',100) FROM ' + Array.from({ length: 6 }, (_, index) => digits + ' d' + index).join(' CROSS JOIN '), timeout: 120000 });
      const [counts] = await observer.query<RowDataPacket[]>('SELECT COUNT(*) total, MIN(id) first_id, MAX(id) last_id FROM ' + database + '.million_rows');
      expect(Number(counts[0].total)).toBe(1000000); expect(counts[0].first_id).toBe(1); expect(counts[0].last_id).toBe(1000000);
      const table = await openTable(database, 'million_rows');
      await table.getByLabel('每页行数', { exact: true }).selectOption('1000');
      await expect(table.locator('.loading-overlay')).toHaveCount(0);
      const grid = table.locator('.results-grid');
      await expect(grid).toHaveAttribute('aria-rowcount', '1001');
      await expect(grid.getByRole('gridcell', { name: '1', exact: true }).and(grid.locator('[aria-colindex="2"]'))).toBeVisible();
      const initialDomRows = await grid.getByRole('row').count();
      expect(initialDomRows).toBeLessThan(100);
      await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(grid.getByRole('gridcell', { name: '1000', exact: true })).toBeVisible();
      const firstPageDomRows = await grid.getByRole('row').count();
      expect(firstPageDomRows).toBeLessThan(100);
      await table.getByLabel('跳转页码', { exact: true }).fill('1000');
      await table.getByRole('button', { name: '跳转', exact: true }).click();
      await expect(table.locator('.loading-overlay')).toHaveCount(0);
      await grid.evaluate(element => { element.scrollTop = 0; });
      await expect(grid.getByRole('gridcell', { name: '999001', exact: true })).toBeVisible({ timeout: 20000 });
      await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect(grid.getByRole('gridcell', { name: '1000000', exact: true })).toBeVisible();
      await expect(grid.getByRole('gridcell', { name: '第1000000行🚀', exact: true })).toBeVisible();
      await expect(grid).toHaveAttribute('aria-rowcount', '1001');
      const lastPageDomRows = await grid.getByRole('row').count();
      expect(lastPageDomRows).toBeLessThan(100);
      await expect(table.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
      await expect(table.locator('.error-box')).toHaveCount(0);
      const measurements = testInfo.outputPath('million-grid-measurements.json');
      await writeFile(measurements, JSON.stringify({ total: 1000000, pageSize: 1000, targetPage: 1000, lastId: 1000000, initialDomRows, firstPageDomRows, lastPageDomRows }, null, 2));
      await testInfo.attach('百万行虚拟表格记录', { contentType: 'application/json', path: measurements });
      await page.screenshot({ path: testInfo.outputPath('live-million-page-1000.png') });
    }, testInfo);
  });
});
