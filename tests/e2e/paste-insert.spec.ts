import { clickSidebarAction } from './sidebar-menu';
import { test, expect, page } from './desktop-fixture';
import { pasteInsertZh as text } from '../../src/renderer/locales/pasteInsert.zh-CN';
import { cellClipboardType, encodeClipboard } from '../../src/renderer/gridClipboard';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { LiveContext } from './live-helpers';

// 仅ROOT显式安排正式窗口/200后启用；本轮只list，不读取系统剪贴板或私有配置。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_D02_PASTE_INSERT_UI === '1';
test.skip(!enabled, '默认关闭：批量新增由ROOT单独分配GUI与已核200/13384');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const table = () => page.locator('.table-tab:visible'), dialog = () => page.getByRole('dialog', { name: text.action, exact: true });

/** 未来实际验收仍走原隔离库、连接表单及真实对象树；不在列表阶段加载live帮助器。 */
async function isolated(body: (context: LiveContext) => Promise<void>, info: Parameters<typeof import('./live-helpers').isolatedDatabase>[1]) {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384') throw Error('批量新增专项只允许ROOT已核200/13384');
  const live = await import('./live-helpers');
  await live.isolatedDatabase(async context => {
    await context.observer.query(`CREATE TABLE \`${context.database}\`.subject(id BIGINT PRIMARY KEY AUTO_INCREMENT,note TEXT,bytes BLOB,doc JSON,generated_value INT AS(CHAR_LENGTH(note))) ENGINE=InnoDB`);
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
    await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus();
    await clickSidebarAction(connection, { name: '刷新连接', exact: true });
    await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
    await connection.locator('.object-row').filter({ has: page.getByText('subject', { exact: true }) }).getByText('subject', { exact: true }).click();
    await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().getByRole('button', { name: text.action, exact: true })).toBeEnabled();
    await body(context);
  }, info);
}
/** 用户另行集中预览前后核对真实库计数，绝不点确认写入。 */
async function unchanged(context: LiveContext) {
  const [rows] = await context.observer.query(`SELECT COUNT(*) AS count FROM \`${context.database}\`.subject`);
  expect(Number((rows as { count: number }[])[0].count)).toBe(0);
}

test('批量新增：空表手工文本先有界预览再暂存，外部NULL为文字且零自动写入', async ({}, info) => {
  test.setTimeout(120000); await isolated(async context => {
    await table().getByRole('button', { name: text.action, exact: true }).click();
    await dialog().getByLabel(text.input, { exact: true }).fill('第一行\nNULL'); await dialog().getByRole('button', { name: text.preview, exact: true }).click();
    await expect(dialog().getByRole('status')).toContainText('2'); await expect(dialog()).toContainText('文本：NULL'); await expect(dialog()).toContainText('DEFAULT'); await unchanged(context);
    await dialog().getByRole('button', { name: text.stage, exact: true }).click(); await expect(dialog()).toHaveCount(0); await expect(table().locator('.row-inserted')).toHaveCount(2); await unchanged(context);
    await table().getByRole('button', { name: zh.table.text019, exact: true }).click(); const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
    await expect(preview.locator('.monaco-editor')).toBeVisible(); await unchanged(context); await preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click();
  }, info);
});

test('批量新增：合成paste事件保留typed NULL/字节/JSON原文，未声称系统原生剪贴板验收', async ({}, info) => {
  test.setTimeout(120000); await isolated(async context => {
    await table().getByRole('button', { name: text.action, exact: true }).click();
    const payload = encodeClipboard([[null, { type: 'binary', base64: 'AAH/' }, '{"n":900719925474099312345,"x":-0}']]);
    await dialog().getByLabel(text.input, { exact: true }).evaluate((element, data) => {
      const transfer = new DataTransfer(); transfer.setData(data.type, data.typed); transfer.setData('text/plain', data.text);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, { ...payload, type: cellClipboardType });
    await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog()).toContainText('SQL NULL'); await expect(dialog()).toContainText('0x0001ff'); await expect(dialog()).toContainText('900719925474099312345');
    await dialog().getByRole('button', { name: text.stage, exact: true }).click(); await expect(table().locator('.row-inserted')).toHaveCount(1); await unchanged(context);
  }, info);
});

test('批量新增：1001行整批拒绝，关闭及未知typed不复用旧预览，既有草稿保留', async ({}, info) => {
  test.setTimeout(120000); await isolated(async context => {
    await table().getByRole('button', { name: zh.common.add, exact: true }).click();
    await table().getByRole('button', { name: text.action, exact: true }).click(); await dialog().getByLabel(text.input, { exact: true }).fill(Array(1001).fill('x').join('\n')); await dialog().getByRole('button', { name: text.preview, exact: true }).click();
    await expect(dialog().getByRole('alert')).toContainText('1000'); await expect(dialog().getByRole('button', { name: text.stage, exact: true })).toBeDisabled();
    await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(table().locator('.row-inserted')).toHaveCount(1);
    await table().getByRole('button', { name: text.action, exact: true }).click(); await dialog().getByLabel(text.input, { exact: true }).fill('旧预览'); await dialog().getByRole('button', { name: text.preview, exact: true }).click();
    await dialog().getByLabel(text.input, { exact: true }).evaluate((element, type) => { const transfer = new DataTransfer(); transfer.setData(type, '{"version":999,"rows":[]}'); transfer.setData('text/plain', '不能退回此文本'); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); }, cellClipboardType);
    await expect(dialog().getByRole('alert')).toBeVisible(); await expect(dialog().getByRole('button', { name: text.stage, exact: true })).toBeDisabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(table().locator('.row-inserted')).toHaveCount(1); await unchanged(context);
  }, info);
});
