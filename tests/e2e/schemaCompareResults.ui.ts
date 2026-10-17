import { test, expect, page, pageErrors } from './desktop-fixture';
import { comparisonProtocol } from './schema-compare-protocol';
import { schemaCompareResultsZh as text } from '../../src/renderer/locales/schemaCompareResults.zh-CN';
import { schemaCompareZh as labels } from '../../src/renderer/locales/schemaCompare.zh-CN';

const dialog = () => page.getByRole('dialog', { name: labels.title, exact: true });

/** 仅在显式双门启用后注册；走正式工具栏、IPC、驱动及回环协议，不访问实库或剪贴板。 */
export function registerSchemaCompareResultsUiTests(): void {
  test('M02正式界面组合筛选保留隐藏选择，清除后重建审查稿，重新比较重置筛选', async () => {
    const protocol = await comparisonProtocol();
    try {
      await openComparison(protocol.port); await dialog().getByRole('button', { name: labels.start, exact: true }).click();
      await expect(dialog().getByRole('button', { name: labels.start, exact: true })).toBeEnabled();
      expect(await dialog().locator('.error-box').allTextContents(), protocol.queries.join('\n')).toEqual([]);
      await expect(dialog()).toContainText(text.count(2, 3));
      await dialog().getByLabel('选择 字段 extra', { exact: true }).check(); await dialog().getByLabel('选择 主键 / 索引 extra_idx', { exact: true }).check();
      await dialog().getByLabel(text.category, { exact: true }).selectOption('columns'); await dialog().getByLabel(text.status, { exact: true }).selectOption('added'); await dialog().getByLabel(text.name, { exact: true }).fill('EXTRA');
      await expect(dialog()).toContainText(text.count(1, 3)); await expect(dialog()).toContainText(text.hidden(1));
      await dialog().getByRole('button', { name: labels.preview, exact: true }).click(); await expect(dialog().getByLabel(labels.sql, { exact: true })).toContainText('ADD KEY `extra_idx`');
      await dialog().getByRole('button', { name: text.clearHidden, exact: true }).click(); await expect(dialog().getByLabel(labels.sql, { exact: true })).toHaveCount(0);
      await expect(dialog().getByLabel('选择 字段 extra', { exact: true })).toBeChecked(); await dialog().getByRole('button', { name: labels.preview, exact: true }).click();
      await expect(dialog().getByLabel(labels.sql, { exact: true })).toContainText('ADD COLUMN `extra`'); await expect(dialog().getByLabel(labels.sql, { exact: true })).not.toContainText('ADD KEY');
      await dialog().getByLabel(text.name, { exact: true }).fill('不存在'); await expect(dialog()).toContainText(text.noMatch);
      await dialog().getByRole('button', { name: text.reset, exact: true }).click(); await expect(dialog()).toContainText(text.count(2, 3)); await expect(dialog().getByLabel('选择 主键 / 索引 extra_idx', { exact: true })).not.toBeChecked();
      await dialog().getByLabel(text.status, { exact: true }).selectOption('same'); await expect(dialog().getByLabel('选择 字段 id', { exact: true })).toBeDisabled();
      await dialog().getByRole('button', { name: labels.start, exact: true }).click(); await expect(dialog().getByRole('button', { name: labels.start, exact: true })).toBeEnabled();
      await expect(dialog().getByLabel(text.status, { exact: true })).toHaveValue('differences'); await expect(dialog()).toContainText(text.count(2, 3));
      await dialog().getByRole('button', { name: labels.close, exact: true }).click(); await expect(dialog()).toHaveCount(0);
      expect(pageErrors).toEqual([]); expect(protocol.queries.every(sql => !/^(ALTER|DROP|CREATE|INSERT|DELETE|UPDATE)/.test(sql))).toBe(true);
    } finally { await protocol.close(); }
  });

  test('M02正式界面按需展开两侧定义，特殊名称为文本且区分 NULL 默认值', async () => {
    const name = ' x.*<img> ', protocol = await comparisonProtocol({ sourceBody: '`id` int,` x.*<img> ` varchar(4) DEFAULT NULL', targetBody: "`id` int,` x.*<img> ` varchar(4) DEFAULT 'NULL'" });
    try {
      await openComparison(protocol.port); await dialog().getByRole('button', { name: labels.start, exact: true }).click(); await expect(dialog().getByRole('button', { name: labels.start, exact: true })).toBeEnabled();
      expect(await dialog().locator('.error-box').allTextContents()).toEqual([]);
      await dialog().getByLabel(text.name, { exact: true }).fill('.*<img>'); await expect(dialog().locator('tbody tr')).toHaveCount(1); await expect(dialog().locator('pre')).toHaveCount(0);
      await dialog().getByRole('button', { name: text.expand, exact: true }).click();
      const definitions = dialog().locator('.schema-compare-result-definitions');
      await expect(definitions).toHaveAttribute('aria-label', `${text.definitions} ${name}`);
      await expect(definitions).toContainText('DEFAULT NULL'); await expect(definitions).toContainText("DEFAULT 'NULL'"); await expect(definitions.locator('img,script')).toHaveCount(0);
      await dialog().getByRole('button', { name: text.collapse, exact: true }).click(); await expect(dialog().locator('pre')).toHaveCount(0);
      await dialog().getByRole('button', { name: labels.close, exact: true }).click(); await expect(dialog()).toHaveCount(0); expect(pageErrors).toEqual([]);
    } finally { await protocol.close(); }
  });
}

/** 通过现有连接保存 IPC 及真实表单进入比较，不替换比较服务或塞入合成报告。 */
async function openComparison(port: number): Promise<void> {
  await page.evaluate(async value => {
    for (const id of ['left', 'right']) await window.dbark.invoke('connections.save', { id, name: `M02回环夹具 ${id}`, host: '127.0.0.1', port: value, user: 'test', group: '', color: '#123456', dialect: 'mysql' });
  }, port);
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible(); await page.getByRole('button', { name: labels.entry, exact: true }).click();
  for (const [side, connection, table] of [['源表', 'left', 'source'], ['目标表', 'right', 'target']]) {
    await dialog().getByLabel(`${side} 连接`, { exact: true }).selectOption(connection);
    await dialog().getByLabel(`${side} 数据库`, { exact: true }).fill('db'); await dialog().getByLabel(`${side} 表名`, { exact: true }).fill(table);
  }
}
