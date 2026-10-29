import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, desktop, closed, pageErrors } from './desktop-fixture';
import type { LiveContext } from './live-helpers';
import { binaryCellZh as binary } from '../../src/renderer/locales/binaryCell.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import { withNativeClipboard } from './native-clipboard';

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
  await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click();
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
  await loaded(); await (await cell(table(), key, row)).click(); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: '单元格', exact: true })).click(); await expect(cellDialog(key)).toBeVisible();
}
/** 只关闭本次字段弹窗，并确认后续操作不会落在上一轮读取期间。 */
async function closeCell(key: string) { await (await (await import('./navigation-menu')).navigationMenuItem(cellDialog(key), { name: record.closeCell, exact: true })).click(); await expect(cellDialog(key)).toHaveCount(0); await loaded(); }
/** Hex输入只进入原稀疏缓冲，暂存按钮才形成网格草稿，不投递数据库操作。 */
async function stageHex(key: string, value: string, row = 2) {
  await openCell(key, row); await viewer(cellDialog(key)).getByRole('textbox', { name: `${key} · ${record.value}`, exact: true }).fill(value);
  await (await (await import('./navigation-menu')).navigationMenuItem(cellDialog(key), { name: record.stageCell, exact: true })).click(); await expect(cellDialog(key)).toHaveCount(0); await loaded();
}
/** 先等待真实预览返回和确认按钮可用，数据库提交只来自明确确认。 */
async function showPreview() {
  await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: '预览并提交', exact: true })).click(); await expect(preview()).toBeVisible();
  await expect(preview().locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeEnabled();
}

test.describe('200隔离实库二进制单元格', () => {
  test.skip(!enabled, '只由统筹显式注入并启用200隔离验收，默认不启动桌面或加载实库配置');
  test.beforeAll(() => {
    if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || !/^\d+$/.test(process.env.DBARK_TEST_PORT ?? '') || Number(process.env.DBARK_TEST_PORT) < 1 || Number(process.env.DBARK_TEST_PORT) > 65535 || !process.env.DBARK_TEST_USER || process.env.DBARK_TEST_PASSWORD === undefined) throw new Error('必须显式注入已核对200隔离实例的主机、端口及临时账号，不回退业务库配置');
  });

  test('二进制网格保留真实原生复制粘贴与导航，键盘不进入文本编辑且明确提交才写库', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => withNativeClipboard(async () => {
      await fixture(context);
      await context.observer.query(`UPDATE ${qualified(context.database)} SET token=? WHERE id=?`, [Buffer.from([171, 0, 255, 128]), secondId]);
      const before = await read(context); await openTable(context);
      const source = await cell(table(), 'token', 3); await source.click();
      for (const key of ['F2', 'a']) { await page.keyboard.press(key); await expect(table().getByRole('textbox', { name: '编辑 token', exact: true })).toHaveCount(0); }
      await page.keyboard.press('ArrowRight'); await expect(await cell(table(), 'bit_value', 3)).toBeFocused();
      await page.keyboard.press('ArrowLeft'); await expect(source).toBeFocused();
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await page.keyboard.press(`${modifier}+C`);
      await expect.poll(() => desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe('0xab00ff80');
      const target = await cell(table(), 'token'); await target.click(); await page.keyboard.press(`${modifier}+V`);
      await expect(target).toHaveText('0xab00ff80');
      // 专用查看器须读到真实字节包装；仅把0x文字粘进去不能满足这条断言。
      await openCell('token'); await expect(viewer(cellDialog('token')).getByRole('textbox', { name: `token · ${record.value}`, exact: true })).toHaveValue(/^(?:0x)?ab00ff80$/i); await closeCell('token');
      expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0); expect(await read(context)).toEqual(before);
      await showPreview(); expect(await read(context)).toEqual(before);
      await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认提交', exact: true })).click(); await expect(preview()).toHaveCount(0);
      const expected = before.map((row, index) => ({ ...row, token_hex: index === 0 ? 'AB00FF80' : row.token_hex }));
      expect(await read(context)).toEqual(expected); expect(await calls('table.apply')).toBe(1);
    }), info);
  });

  test('报告组合标志不执行清空或预览，TEXT输入保留且正常Delete区分NULL与零字节', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context);
      await context.observer.query(`ALTER TABLE ${qualified(context.database)} MODIFY token VARBINARY(32) NOT NULL,ADD note TEXT`);
      await context.observer.query(`UPDATE ${qualified(context.database)} SET note='普通文本'`);
      const before = await read(context); await openTable(context); const target = await cell(table(), 'token'); await target.click();
      /** 只报告DOM组合状态，不模拟或声称实体输入法行为；后续正常按键另证处理器可达。 */
      async function reportedKey(target: Locator, key: string, state: { isComposing: boolean; keyCode?: number; ctrlKey?: boolean; metaKey?: boolean }) { await target.evaluate((node, input) => { node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...input })); }, { key, ...state }); }
      for (const state of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
        for (const [key, modifiers] of [['Delete', {}], ['Enter', {}], ['Enter', { ctrlKey: true }], ['Enter', { metaKey: true }], ['f', { ctrlKey: true }], ['h', { metaKey: true }]] as const) await reportedKey(target, key, { ...state, ...modifiers });
      }
      await expect(target).toHaveText('0x00ff80'); await expect(table().locator('.row-modified')).toHaveCount(0); await expect(preview()).toHaveCount(0); await expect(cellDialog('token')).toHaveCount(0); await expect(table().locator('.page-find-panel')).toHaveCount(0);
      expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0); expect(await read(context)).toEqual(before);
      await target.press('Enter'); await expect(cellDialog('token')).toBeVisible(); await closeCell('token');
      // TEXT在协议层仍可能是BLOB；普通字符进入原编辑器，组合Enter/Escape不提前提交或关闭。
      const note = await cell(table(), 'note'); await note.click(); await note.press('a'); const input = table().getByRole('textbox', { name: '编辑 note', exact: true }); await expect(input).toBeVisible(); await input.fill('普通文本草稿');
      await reportedKey(input, 'Enter', { isComposing: true, ctrlKey: true }); await reportedKey(input, 'Escape', { isComposing: false, keyCode: 229 }); await expect(input).toHaveValue('普通文本草稿'); await expect(preview()).toHaveCount(0); expect(await calls('table.preview')).toBe(0);
      await input.press('Enter'); await expect(input).toHaveCount(0); await expect(await cell(table(), 'note')).toHaveText('普通文本草稿');
      const payload = await cell(table(), 'payload'); await payload.click(); await payload.press('Delete'); await openCell('payload'); await expect(viewer(cellDialog('payload'))).toContainText(binary.null); await closeCell('payload');
      const bytes = await cell(table(), 'token'); await bytes.click(); await bytes.press('Delete'); await expect(bytes).toHaveText('0x'); await openCell('token'); await expect(viewer(cellDialog('token'))).toContainText(binary.empty); await closeCell('token');
      expect(await calls('table.apply')).toBe(0); expect(await calls('table.preview')).toBe(0); expect(await read(context)).toEqual(before); const [notes] = await context.observer.query<RowDataPacket[]>(`SELECT note FROM ${qualified(context.database)} ORDER BY id`); expect(notes.map(row => row.note)).toEqual(['普通文本', '普通文本']);
      await page.screenshot({ path: info.outputPath('reported-ime-and-delete-guards.png') });
    }, info);
  });

  test('BLOB VARBINARY BIT查看及草稿零写，明确集中提交后逐字节与大整数保持', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context);
      await openCell('payload'); await (await (await import('./navigation-menu')).navigationMenuItem(viewer(cellDialog('payload')), { name: binary.text, exact: true })).click();
      await expect(viewer(cellDialog('payload')).getByRole('textbox', { name: binary.textLabel, exact: true })).toHaveValue('中文😀\0'); await closeCell('payload');
      await openCell('picture'); await (await (await import('./navigation-menu')).navigationMenuItem(viewer(cellDialog('picture')), { name: binary.image, exact: true })).click();
      await expect.poll(() => viewer(cellDialog('picture')).getByRole('img').evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([2, 3]); await closeCell('picture');
      for (const [key, description] of [['nullable_payload', binary.null], ['empty_payload', binary.empty]] as const) { await openCell(key); await expect(viewer(cellDialog(key))).toContainText(description); await closeCell(key); }
      await stageHex('payload', '0x00 ff 80 00');
      await (await cell(table(), 'token')).click(); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: record.title, exact: true })).click();
      const token = form().getByRole('region', { name: 'token', exact: true }); await (await (await import('./navigation-menu')).navigationMenuItem(token, { name: record.editField, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(viewer(token), { name: binary.text, exact: true })).click(); await expect(viewer(token).getByRole('alert')).toContainText(binary.decodeFailed);
      await (await (await import('./navigation-menu')).navigationMenuItem(viewer(token), { name: binary.hex, exact: true })).click(); await viewer(token).getByRole('textbox').fill('0x00 fe 80 00'); await (await (await import('./navigation-menu')).navigationMenuItem(form(), { name: record.stage, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(form(), { name: record.close, exact: true })).click(); await expect(form()).toHaveCount(0);
      await stageHex('bit_value', '0x8001');
      await openCell('nullable_payload'); await cellDialog('nullable_payload').getByRole('combobox', { name: record.mode, exact: true }).selectOption('binary'); await expect(viewer(cellDialog('nullable_payload'))).toContainText(binary.empty); await (await (await import('./navigation-menu')).navigationMenuItem(cellDialog('nullable_payload'), { name: record.stageCell, exact: true })).click(); await expect(cellDialog('nullable_payload')).toHaveCount(0);
      await openCell('empty_payload'); await cellDialog('empty_payload').getByRole('combobox', { name: record.mode, exact: true }).selectOption('null'); await (await (await import('./navigation-menu')).navigationMenuItem(cellDialog('empty_payload'), { name: record.stageCell, exact: true })).click(); await expect(cellDialog('empty_payload')).toHaveCount(0);
      expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
      await showPreview(); expect(await read(context)).toEqual(before); expect(await calls('table.apply')).toBe(0);
      const pages = await calls('table.page', true); await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认提交', exact: true })).click(); await expect(preview()).toHaveCount(0); await loaded(pages);
      const after = await read(context); expect(after).toEqual([{ ...before[0], payload_hex: '00FF8000', token_hex: '00FE8000', bit_hex: '8001', nullable_hex: '', empty_hex: null }, before[1]]);
      expect(after.map(row => row.exact_id)).toEqual([firstId, secondId]); expect(after[0].amount).toBe('12345678901234567890.123456'); expect(await calls('table.apply')).toBe(1);
    }, info);
  });

  test('旁观更新第二行使整个集中批次回滚，不重放第一行写入', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context); await stageHex('payload', '0x00aabb', 2); await stageHex('payload', '0x11ccdd', 3); await showPreview();
      await context.observer.query(`UPDATE ${qualified(context.database)} SET payload=? WHERE id=?`, [Buffer.from('deadbeef', 'hex'), secondId]);
      await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认提交', exact: true })).click(); await expect.poll(() => calls('table.apply', true), { timeout: 20000 }).toBe(1);
      await expect(preview().locator('.error-box')).toContainText(/并发|已被其他|原值/); expect(await read(context)).toEqual([before[0], { ...before[1], payload_hex: 'DEADBEEF' }]); expect(await calls('table.apply')).toBe(1);
      await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeDisabled(); await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: zh.common.backToEdit, exact: true })).click(); await expect(preview()).toHaveCount(0);
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
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: zh.dialogs.text001, exact: true })).click(); await expect(modal).toHaveCount(0);
      // 同名别名仍按唯一内部键读取第二列的图片，显示名称不能反过来用于值定位。
      await executeSql(`SELECT payload AS \`重复列\`,picture AS \`重复列\` FROM ${qualified(context.database)} ORDER BY id`);
      // 实际列头可访问名称含数据库类型，与既有 column() 使用相同的列名前缀规则。
      const headers = query.getByRole('columnheader', { name: /^重复列/ }); await expect(headers).toHaveCount(2);
      const imageIndex = await headers.nth(1).getAttribute('aria-colindex'); if (!imageIndex) throw new Error('同名第二列缺少实际坐标');
      await query.locator(`[role=row][aria-rowindex="2"] [role=gridcell][aria-colindex="${imageIndex}"]`).dblclick();
      const duplicate = page.getByRole('dialog', { name: `${binary.title}：重复列`, exact: true }); await expect(duplicate).toBeVisible();
      await (await (await import('./navigation-menu')).navigationMenuItem(viewer(duplicate), { name: binary.image, exact: true })).click();
      await expect.poll(() => viewer(duplicate).getByRole('img').evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([2, 3]);
      await expect(duplicate.getByRole('button', { name: record.stageCell, exact: true })).toHaveCount(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(viewer(duplicate), { name: binary.hex, exact: true })).click();
      await expect(viewer(duplicate)).toContainText(binary.readonly); await expect(viewer(duplicate).getByRole('textbox')).toHaveJSProperty('readOnly', true);
      await (await (await import('./navigation-menu')).navigationMenuItem(duplicate, { name: zh.dialogs.text001, exact: true })).click(); expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
    }, info);
  });

  test('真实连接修改保护保留旧输入，刷新经确认后清除旧编辑且不写库', async ({}, info) => {
    test.setTimeout(120000);
    await inDatabase(async context => {
      await fixture(context); const before = await read(context); await openTable(context); await (await cell(table(), 'payload')).click(); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: record.title, exact: true })).click();
      const payload = form().getByRole('region', { name: 'payload', exact: true }); await (await (await import('./navigation-menu')).navigationMenuItem(payload, { name: record.editField, exact: true })).click(); await viewer(payload).getByRole('textbox').fill('0x010203');
      const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) }); await connection.locator('.connection-row').getByRole('button', { name: context.connectionName, exact: true }).focus(); await clickSidebarAction(connection, { name: formatText(zh.sidebar.text010, context.connectionName), exact: true });
      const dialog = page.getByRole('dialog', { name: '编辑连接', exact: true }); await dialog.getByLabel(zh.connections.text012, { exact: true }).fill(context.database + '_changed'); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: '保存连接', exact: true })).click();
      await expect(dialog.locator('.error-box')).toContainText(zh.connections.openTabsBlockChanges); expect(await calls('connections.save')).toBe(0); await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: '取消', exact: true })).click(); await expect(dialog).toHaveCount(0); await expect(viewer(payload).getByRole('textbox')).toHaveValue('0x010203');
      const { acceptNativeConfirmation } = await import('./live-helpers'); await acceptNativeConfirmation(); const pages = await calls('table.page', true); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: '刷新', exact: true })).click(); await loaded(pages);
      await expect(form().getByRole('region', { name: binary.title, exact: true })).toHaveCount(0); await expect(table().locator('.row-modified')).toHaveCount(0); expect(await read(context)).toEqual(before); expect(await calls('table.preview')).toBe(0); expect(await calls('table.apply')).toBe(0);
    }, info);
  });
});
