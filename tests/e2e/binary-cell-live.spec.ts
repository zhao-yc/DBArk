import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, desktop, closed, pageErrors } from './desktop-fixture';
import type { LiveContext } from './live-helpers';
import { binaryCellZh as binary } from '../../src/renderer/locales/binaryCell.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';

// 只在模块声明阶段检查显式开关，默认跳过早于自动桌面夹具；实库 helper 仅在启用的测试体内加载。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
test.use({ trace: 'off' });
const name = 'binary_live_values', firstId = '18446744073709551614', secondId = '18446744073709551615';
const table = () => page.locator('.table-tab:visible');
const form = () => table().getByRole('complementary', { name: record.title, exact: true });
const cellDialog = (key: string) => page.getByRole('dialog', { name: `编辑单元格：${key}`, exact: true });
const viewer = (scope: Locator) => scope.getByRole('region', { name: binary.title, exact: true });
const preview = () => page.getByRole('dialog', { name: '确认数据修改', exact: true });
const qualified = (database: string) => `\`${database}\`.\`${name}\``;
type Observation = { command: string; settled: boolean };
type Probe = { calls: Observation[]; restore(): void };
type ProbeRoot = typeof globalThis & { __binaryLiveProbe?: Probe };
interface ReadRow extends RowDataPacket { exact_id: string; payload_hex: string; token_hex: string; bit_hex: string; picture_hex: string; nullable_hex: string | null; empty_hex: string | null; amount: string; }

/** 仅旁观原处理器的命令名和完成状态，不记录凭据、SQL或修改真实返回。 */
async function observe() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, input: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('没有真实请求处理器');
    const state: Probe = { calls: [], restore: () => handlers.set('dbark:request', original) };
    (globalThis as ProbeRoot).__binaryLiveProbe = state;
    handlers.set('dbark:request', async (event, input) => {
      const item = ['table.page', 'metadata.table', 'table.preview', 'table.apply', 'query.execute', 'connections.save'].includes(input.command) ? { command: input.command, settled: false } : undefined;
      if (item) state.calls.push(item);
      try { return await original(event, input); } finally { if (item) item.settled = true; }
    });
  });
}
/** 只读取无秘密调用摘要，读取完成计数也用于排除旧页面和读取空帧。 */
async function calls(command: string, settled = false): Promise<number> {
  return desktop.evaluate((_, value) => (globalThis as ProbeRoot).__binaryLiveProbe?.calls.filter(item => item.command === value.command && (!value.settled || item.settled)).length ?? 0, { command, settled });
}
/** 观察包装先撤销，再由现有 helper 退出应用并精确清理随机隔离库。 */
async function inDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  const { isolatedDatabase } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    await observe();
    try { await body(context); expect(pageErrors).toEqual([]); }
    finally { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__binaryLiveProbe?.restore(); delete root.__binaryLiveProbe; }); }
  }, info);
}
/** 旁观连接只负责本例建表、取证、并发冲突和清理，不替代被测应用的读取或写入。 */
async function fixture(context: LiveContext) {
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 3; canvas.getContext('2d')!.fillRect(0, 0, 2, 3); return canvas.toDataURL('image/png').split(',')[1]; });
  await context.observer.query(`CREATE TABLE ${qualified(context.database)} (id BIGINT UNSIGNED PRIMARY KEY,payload BLOB,token VARBINARY(32),bit_value BIT(16),picture BLOB,nullable_payload BLOB,empty_payload BLOB,amount DECIMAL(30,6)) ENGINE=InnoDB`);
  for (const [id, value] of [[firstId, '中文😀\0'], [secondId, '第二行原值']] as const) {
    await context.observer.query(`INSERT INTO ${qualified(context.database)} VALUES (?,?,?,b'1000000011111111',?,NULL,?,12345678901234567890.123456)`, [id, Buffer.from(value, 'utf8'), Buffer.from([0, 255, 128]), Buffer.from(png, 'base64'), Buffer.alloc(0)]);
  }
}
/** 服务器证据全部用字符及HEX读取，避免大整数、DECIMAL或字节被浮点/编码往返改写。 */
async function read(context: LiveContext): Promise<ReadRow[]> {
  return (await context.observer.query<ReadRow[]>(`SELECT CAST(id AS CHAR) AS exact_id,HEX(payload) AS payload_hex,HEX(token) AS token_hex,HEX(bit_value) AS bit_hex,HEX(picture) AS picture_hex,HEX(nullable_payload) AS nullable_hex,HEX(empty_payload) AS empty_hex,amount FROM ${qualified(context.database)} ORDER BY id`))[0];
}
/** 等待生产读取真正完成后才依赖模态开关或单元格断言，不用延时猜测空帧。 */
async function loaded(previous?: number) {
  if (previous !== undefined) await expect.poll(() => calls('table.page', true), { timeout: 20000 }).toBeGreaterThan(previous);
  await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().locator(':scope > .error-box')).toHaveCount(0);
}
/** 表入口始终来自真实对象树；强制按精确主键升序，避免依赖服务器偶然返回顺序。 */
async function openTable(context: LiveContext) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  const before = await calls('table.page', true); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(table().locator('.context-bar')).toContainText(name); await loaded(before);
  const sorted = await calls('table.page', true); await (await column(table(), 'id')).click(); await loaded(sorted);
  await expect(await cell(table(), 'id')).toHaveText(firstId);
}
/** 水平滚动让虚拟列真实挂载，列头带类型和选择列时仍读取实际 aria 坐标。 */
async function column(scope: Locator, key: string): Promise<Locator> {
  const grid = scope.locator('.results-grid'), escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = scope.getByRole('columnheader', { name: new RegExp(`^${escaped}`) });
  await grid.evaluate(node => { node.scrollLeft = 0; });
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (await header.count()) break;
    await grid.evaluate(node => { node.scrollLeft += node.clientWidth; });
  }
  await expect(header).toHaveCount(1); return header;
}
/** 单元格位置包含选择列；不能把数据库列序号直接当网格序号。 */
async function cell(scope: Locator, key: string, row = 2): Promise<Locator> {
  const header = await column(scope, key), index = await header.getAttribute('aria-colindex');
  if (!index) throw new Error('实际列头没有aria坐标');
  const result = scope.locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`); await result.scrollIntoViewIfNeeded(); return result;
}
/** 通过工具栏打开真实编辑器，关闭前后都等待当前读取结束。 */
async function openCell(key: string, row = 2) {
  await loaded(); await (await cell(table(), key, row)).click(); await table().getByRole('button', { name: '单元格', exact: true }).click(); await expect(cellDialog(key)).toBeVisible();
}
/** 只关闭本次字段弹窗，并确认后续操作不会落在上一轮读取期间。 */
async function closeCell(key: string) { await cellDialog(key).getByRole('button', { name: record.closeCell, exact: true }).click(); await expect(cellDialog(key)).toHaveCount(0); await loaded(); }
/** Hex输入只进入原稀疏缓冲，暂存按钮才形成网格草稿，不投递数据库操作。 */
async function stageHex(key: string, value: string, row = 2) {
  await openCell(key, row); await viewer(cellDialog(key)).getByRole('textbox', { name: `${key} · ${record.value}`, exact: true }).fill(value);
  await cellDialog(key).getByRole('button', { name: record.stageCell, exact: true }).click(); await expect(cellDialog(key)).toHaveCount(0); await loaded();
}
/** 先等待真实预览返回和确认按钮可用，数据库提交只来自明确确认。 */
async function showPreview() {
  await table().getByRole('button', { name: '预览并提交', exact: true }).click(); await expect(preview()).toBeVisible();
  await expect(preview().locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeEnabled();
}

test.describe('200隔离实库二进制单元格', () => {
  test.skip(!enabled, '只由统筹显式注入并启用200隔离验收，默认不启动桌面或加载实库配置');
  test.beforeAll(() => {
    if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || !/^\d+$/.test(process.env.DBARK_TEST_PORT ?? '') || Number(process.env.DBARK_TEST_PORT) < 1 || Number(process.env.DBARK_TEST_PORT) > 65535 || !process.env.DBARK_TEST_USER || process.env.DBARK_TEST_PASSWORD === undefined) throw new Error('必须显式注入已核对200隔离实例的主机、端口及临时账号，不回退业务库配置');
  });

  test('BLOB VARBINARY BIT查看及草稿零写，明确集中提交后逐字节与大整数保持', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context);
      await openCell('payload'); await viewer(cellDialog('payload')).getByRole('button', { name: binary.text, exact: true }).click();
      await expect(viewer(cellDialog('payload')).getByRole('textbox', { name: binary.textLabel, exact: true })).toHaveValue('中文😀\0'); await closeCell('payload');
      await openCell('picture'); await viewer(cellDialog('picture')).getByRole('button', { name: binary.image, exact: true }).click();
      await expect.poll(() => viewer(cellDialog('picture')).getByRole('img').evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([2, 3]); await closeCell('picture');
      for (const [key, description] of [['nullable_payload', binary.null], ['empty_payload', binary.empty]] as const) { await openCell(key); await expect(viewer(cellDialog(key))).toContainText(description); await closeCell(key); }
      await stageHex('payload', '0x00 ff 80 00');
      await (await cell(table(), 'token')).click(); await table().getByRole('button', { name: record.title, exact: true }).click();
      const token = form().getByRole('region', { name: 'token', exact: true }); await token.getByRole('button', { name: record.editField, exact: true }).click();
      await viewer(token).getByRole('button', { name: binary.text, exact: true }).click(); await expect(viewer(token).getByRole('alert')).toContainText(binary.decodeFailed);
      await viewer(token).getByRole('button', { name: binary.hex, exact: true }).click(); await viewer(token).getByRole('textbox').fill('0x00 fe 80 00'); await form().getByRole('button', { name: record.stage, exact: true }).click();
      await form().getByRole('button', { name: record.close, exact: true }).click(); await expect(form()).toHaveCount(0);
      await stageHex('bit_value', '0x8001');
      await openCell('nullable_payload'); await cellDialog('nullable_payload').getByRole('combobox', { name: record.mode, exact: true }).selectOption('binary'); await expect(viewer(cellDialog('nullable_payload'))).toContainText(binary.empty); await cellDialog('nullable_payload').getByRole('button', { name: record.stageCell, exact: true }).click(); await expect(cellDialog('nullable_payload')).toHaveCount(0);
      await openCell('empty_payload'); await cellDialog('empty_payload').getByRole('combobox', { name: record.mode, exact: true }).selectOption('null'); await cellDialog('empty_payload').getByRole('button', { name: record.stageCell, exact: true }).click(); await expect(cellDialog('empty_payload')).toHaveCount(0);
      expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
      await showPreview(); expect(await read(context)).toEqual(before); expect(await calls('table.apply')).toBe(0);
      const pages = await calls('table.page', true); await preview().getByRole('button', { name: '确认提交', exact: true }).click(); await expect(preview()).toHaveCount(0); await loaded(pages);
      const after = await read(context); expect(after).toEqual([{ ...before[0], payload_hex: '00FF8000', token_hex: '00FE8000', bit_hex: '8001', nullable_hex: '', empty_hex: null }, before[1]]);
      expect(after.map(row => row.exact_id)).toEqual([firstId, secondId]); expect(after[0].amount).toBe('12345678901234567890.123456'); expect(await calls('table.apply')).toBe(1);
    }, info);
  });

  test('旁观更新第二行使整个集中批次回滚，不重放第一行写入', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context); await stageHex('payload', '0x00aabb', 2); await stageHex('payload', '0x11ccdd', 3); await showPreview();
      await context.observer.query(`UPDATE ${qualified(context.database)} SET payload=? WHERE id=?`, [Buffer.from('deadbeef', 'hex'), secondId]);
      await preview().getByRole('button', { name: '确认提交', exact: true }).click(); await expect.poll(() => calls('table.apply', true), { timeout: 20000 }).toBe(1);
      await expect(preview().locator('.error-box')).toContainText(/并发|已被其他|原值/); expect(await read(context)).toEqual([before[0], { ...before[1], payload_hex: 'DEADBEEF' }]); expect(await calls('table.apply')).toBe(1);
      await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeDisabled(); await preview().getByRole('button', { name: zh.common.backToEdit, exact: true }).click(); await expect(preview()).toHaveCount(0);
    }, info);
  });

  test('SQL结果的二进制始终只读，不推测写表定位', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); const { openDatabaseQuery, executeSql } = await import('./live-helpers');
      await openDatabaseQuery(context.database); await executeSql(`SELECT id,payload,picture,nullable_payload,empty_payload FROM ${qualified(context.database)} ORDER BY id`);
      const query = page.locator('.query-tab:visible'); await expect(query.locator('.result-body')).toContainText(firstId); await expect(query.locator('.result-body')).toContainText(secondId);
      await (await cell(query, 'payload')).dblclick(); const modal = page.getByRole('dialog', { name: `${binary.title}：payload`, exact: true });
      await expect(viewer(modal)).toContainText(binary.readonly); await expect(viewer(modal).getByRole('textbox')).toHaveJSProperty('readOnly', true); await expect(modal.getByRole('button', { name: record.stageCell, exact: true })).toHaveCount(0);
      await modal.getByRole('button', { name: zh.dialogs.text001, exact: true }).click(); await expect(modal).toHaveCount(0); expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
    }, info);
  });

  test('真实连接修改保护保留旧输入，刷新经确认后清除旧编辑且不写库', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context); await (await cell(table(), 'payload')).click(); await table().getByRole('button', { name: record.title, exact: true }).click();
      const payload = form().getByRole('region', { name: 'payload', exact: true }); await payload.getByRole('button', { name: record.editField, exact: true }).click(); await viewer(payload).getByRole('textbox').fill('0x010203');
      const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) }); await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: formatText(zh.sidebar.text010, context.connectionName), exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '编辑连接', exact: true }); await dialog.getByLabel(zh.connections.text012, { exact: true }).fill(context.database + '_changed'); await dialog.getByRole('button', { name: '保存连接', exact: true }).click();
      await expect(dialog.locator('.error-box')).toContainText(zh.connections.openTabsBlockChanges); expect(await calls('connections.save')).toBe(0); await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(viewer(payload).getByRole('textbox')).toHaveValue('0x010203');
      const { acceptNativeConfirmation } = await import('./live-helpers'); await acceptNativeConfirmation(); const pages = await calls('table.page', true); await table().getByRole('button', { name: '刷新', exact: true }).click(); await loaded(pages);
      await expect(form().getByRole('region', { name: binary.title, exact: true })).toHaveCount(0); await expect(table().locator('.row-modified')).toHaveCount(0); expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
    }, info);
  });
});
