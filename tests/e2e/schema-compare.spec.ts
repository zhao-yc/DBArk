import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, page, desktop, dataDir, pageErrors } from './desktop-fixture';
import { schemaCompareZh as text } from '../../src/renderer/locales/schemaCompare.zh-CN';
import { comparisonProtocol } from './schema-compare-protocol';

const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
/** 通过真实保存连接 IPC 创建本例配置；表单、比较、预览仍全部由用户入口触发。 */
async function openComparison(port: number) {
  await page.evaluate(async value => {
    for (const id of ['left', 'right']) await window.dbark.invoke('connections.save', { id, name: id === 'left' ? '源侧离线夹具' : '目标侧离线夹具', host: '127.0.0.1', port: value, user: 'test', group: '', color: '#123456', dialect: 'mysql' });
  }, port);
  await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
  await page.getByRole('button', { name: text.entry, exact: true }).click();
  await dialog().getByLabel('源表 连接', { exact: true }).selectOption('left'); await dialog().getByLabel('目标表 连接', { exact: true }).selectOption('right');
  for (const side of ['源表', '目标表']) await dialog().getByLabel(`${side} 数据库`, { exact: true }).fill('db');
  await dialog().getByLabel('源表 表名', { exact: true }).fill('source'); await dialog().getByLabel('目标表 表名', { exact: true }).fill('target');
}
test('真实工具栏到 IPC、驱动、比较、差异选择、SQL预览与原子保存，输入变化撤销旧结果', async ({}, info) => {
  const protocol = await comparisonProtocol();
  try {
    await openComparison(protocol.port); await dialog().getByRole('button', { name: text.start, exact: true }).click();
    await expect(dialog().getByRole('button', { name: text.start, exact: true })).toBeEnabled();
    expect(await dialog().locator('.error-box').allTextContents(), protocol.queries.join('\n')).toEqual([]); await expect(dialog()).toContainText('新增：2');
    await dialog().getByLabel('选择 字段 extra', { exact: true }).check(); await dialog().getByLabel('选择 主键 / 索引 extra_idx', { exact: true }).check();
    await dialog().getByRole('button', { name: text.preview, exact: true }).click();
    await expect(dialog().getByLabel(text.sql, { exact: true })).toContainText('ALTER TABLE `db`.`target` ADD COLUMN `extra`');
    await expect(dialog()).toContainText('尚未同步'); await expect.poll(() => protocol.active).toBe(0);
    const path = join(dataDir, '结构比较预览.sql');
    await desktop.evaluate(({ dialog: native }, filePath) => { native.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof native.showSaveDialog; }, path);
    await dialog().getByRole('button', { name: text.save, exact: true }).click(); await expect(dialog()).toContainText(text.saved);
    expect(await readFile(path, 'utf8')).toContain('1234567890123456789012.12345678');
    expect(protocol.queries.every(sql => !/^(ALTER|DROP|CREATE|INSERT|DELETE|UPDATE)/.test(sql))).toBe(true);
    await page.screenshot({ path: info.outputPath('schema-compare-preview.png') });
    await dialog().getByLabel('目标表 表名', { exact: true }).fill('another'); await expect(dialog().getByLabel(text.sql, { exact: true })).toHaveCount(0);
    await expect(dialog().getByRole('button', { name: text.preview, exact: true })).toBeDisabled();
    await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(dialog()).toHaveCount(0); expect(pageErrors).toEqual([]);
  } finally { await protocol.close(); }
});
test('读取中关闭窗口通过公共取消结束真实驱动连接，迟到响应不恢复窗口', async () => {
  const protocol = await comparisonProtocol();
  try {
    await openComparison(protocol.port); protocol.hold(); await dialog().getByRole('button', { name: text.start, exact: true }).click();
    await expect.poll(() => protocol.waiting).toBe(true); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    await expect(dialog()).toHaveCount(0); await expect.poll(() => protocol.active).toBe(0);
    expect(protocol.queries.some(sql => sql.startsWith('KILL CONNECTION'))).toBe(true);
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); const work = tasks.filter(task => task.kind === 'schema.compare');
    expect(work).toHaveLength(1); expect(work[0].status).toBe('cancelled'); expect(work[0].message).not.toContain('extra'); expect(pageErrors).toEqual([]);
  } finally { await protocol.close(); }
});
test('取消控制权限不足保持失败事实和窗口，不能显示为已取消成功', async () => {
  const protocol = await comparisonProtocol();
  try {
    await openComparison(protocol.port); protocol.hold(); protocol.denyCancellation();
    await dialog().getByRole('button', { name: text.start, exact: true }).click(); await expect.poll(() => protocol.waiting).toBe(true);
    await dialog().getByRole('button', { name: text.close, exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText('取消控制连接失败');
    await expect(dialog().getByRole('button', { name: text.close, exact: true })).toBeEnabled(); await expect.poll(() => protocol.active).toBe(0);
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.find(task => task.kind === 'schema.compare')?.status).toBe('failed');
    await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(dialog()).toHaveCount(0); expect(pageErrors).toEqual([]);
  } finally { await protocol.close(); }
});
