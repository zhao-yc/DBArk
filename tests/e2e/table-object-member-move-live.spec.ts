import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, desktop, closed, pageErrors } from './desktop-fixture';
import type { LiveContext } from './live-helpers';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as treeText } from '../../src/renderer/locales/recordProjections.zh-CN';
import { recordJsonStructureInputZh as structureText } from '../../src/renderer/locales/recordJsonStructureInput.zh-CN';
import { objectMemberMoveZh as text } from '../../src/renderer/locales/objectMemberMove.zh-CN';

// 只准备真实产品入口；默认跳过早于桌面启动，200和GUI均由统筹明确启用。
test.skip(process.env.DBARK_INTEGRATION_ENABLED !== '1', '需要统筹分配GUI及200随机隔离库资源；默认不加载实库配置');
test.use({ trace: 'off' });
const name = 'object_member_moves', firstId = '18446744073709551614', secondId = '18446744073709551615';
const original = ' {"n":9007199254740993,  "\\u006e" : -0,\n "n":1e999,"box":{"x":[1,{"n":1,"n":2}]}} \r\n';
const movedSecondToLast = ' {"n":9007199254740993,  "n":1e999,\n "box":{"x":[1,{"n":1,"n":2}]},"\\u006e" : -0} \r\n';
const table = () => page.locator('.table-tab:visible');
const panel = () => table().getByRole('complementary', { name: formText.title, exact: true });
const tree = () => panel().getByRole('list', { name: treeText.lexicalTree, exact: true });
const root = () => tree().locator(':scope > li').filter({ has: page.getByText(treeText.root, { exact: true }) });
const editor = () => panel().getByRole('region', { name: structureText.title, exact: true });
const leave = () => page.getByRole('dialog', { name: formText.leaveTitle, exact: true });
const preview = () => page.getByRole('dialog', { name: '确认数据修改', exact: true });
const qualified = (database: string) => `\`${database}\`.\`${name}\``;
type Call = { command: string; settled: boolean };
type Probe = { calls: Call[]; restore(): void };
type ProbeRoot = typeof globalThis & { __objectMemberMoveProbe?: Probe };
interface ObservedRow extends RowDataPacket { id: string; note_hex: string; body_hex: string; generated_hex: string }

test.beforeAll(() => {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || !/^\d+$/.test(process.env.DBARK_TEST_PORT ?? '') || Number(process.env.DBARK_TEST_PORT) < 1 || Number(process.env.DBARK_TEST_PORT) > 65535 || !process.env.DBARK_TEST_USER || process.env.DBARK_TEST_PASSWORD === undefined) throw Error('必须由统筹显式注入已核对的200隔离主机、端口及临时账号');
});
/** 原IPC只记脱敏命令和完成计数，不采集行值、SQL或认证，不伪造返回。 */
async function observe() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, input: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (!originalHandler) throw Error('缺少真实IPC');
    const probe: Probe = { calls: [], restore: () => handlers.set('dbark:request', originalHandler) }; (globalThis as ProbeRoot).__objectMemberMoveProbe = probe;
    handlers.set('dbark:request', async (event, input) => { const call = ['table.page', 'table.preview', 'table.apply'].includes(input.command) ? { command: input.command, settled: false } : undefined; if (call) probe.calls.push(call); try { return await originalHandler(event, input); } finally { if (call) call.settled = true; } });
  });
}
/** 只取已知命令计数，读取完成标记排除上一次页面或模态空帧。 */
async function count(command: string, settled = false) { return desktop.evaluate((_, input) => (globalThis as ProbeRoot).__objectMemberMoveProbe?.calls.filter(call => call.command === input.command && (!input.settled || call.settled)).length ?? 0, { command, settled }); }
/** 每例只建立随机隔离表；observer随后用于原值断言、制造冲突和既有清理。 */
async function fixture(context: LiveContext) {
  if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database)) throw Error('拒绝在非随机隔离库建立夹具');
  await context.observer.query(`CREATE TABLE ${qualified(context.database)} (id BIGINT UNSIGNED PRIMARY KEY,note TEXT,body LONGTEXT,computed LONGTEXT GENERATED ALWAYS AS(body) STORED) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context.database)} (id,note,body) VALUES (?,'原第一',?),(?,'原第二',?)`, [firstId, original, secondId, original]);
}
/** 精确文本及大整数均以字符/HEX取证，不按服务器JSON类型重建原文。 */
async function read(context: LiveContext): Promise<ObservedRow[]> { return (await context.observer.query<ObservedRow[]>(`SELECT CAST(id AS CHAR) AS id,HEX(note) AS note_hex,HEX(body) AS body_hex,HEX(computed) AS generated_hex FROM ${qualified(context.database)} ORDER BY id`))[0]; }
/** 观察包装先恢复，再由原helper退出、核清随机库及清理本次桌面进程。 */
async function withDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  const { isolatedDatabase } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    await fixture(context); await observe();
    try { await body(context); expect(pageErrors).toEqual([]); }
    catch (reason) { if (!closed) { await info.attach('对象移动命令摘要', { body: JSON.stringify(await desktop.evaluate(() => (globalThis as ProbeRoot).__objectMemberMoveProbe?.calls)), contentType: 'application/json' }).catch(() => undefined); await page.screenshot({ path: info.outputPath('object-member-move-failure.png') }).catch(() => undefined); } throw reason; }
    finally { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__objectMemberMoveProbe?.restore(); delete root.__objectMemberMoveProbe; }); }
  }, info);
}
/** 列先滚动挂载，再用实际aria坐标定位，不能把协议列顺序当数据库偏移。 */
async function cell(key: string, row = 2): Promise<Locator> {
  const grid = table().locator('.results-grid'), header = table().getByRole('columnheader').filter({ hasText: new RegExp('^' + key) }); await grid.evaluate(node => { node.scrollLeft = 0; });
  for (let attempt = 0; attempt < 10; attempt++) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); if (await header.count()) break; await grid.evaluate(node => { node.scrollLeft += node.clientWidth; }); }
  await expect(header).toHaveCount(1); const index = await header.getAttribute('aria-colindex'); if (!index || !/^\d+$/.test(index)) throw Error('实际列头坐标无效'); const target = table().locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${index}"]`); await target.scrollIntoViewIfNeeded(); return target;
}
/** 成功读取完成后才使用新页面，不靠延时猜测模态和旧字段状态。 */
async function loaded(previous?: number) { if (previous !== undefined) await expect.poll(() => count('table.page', true), { timeout: 20000 }).toBeGreaterThan(previous); await expect(table().locator('.loading-overlay')).toHaveCount(0); await expect(table().locator(':scope > .error-box')).toHaveCount(0); }
/** 对象树打开及真实主键排序确定行序，不依赖服务器偶然扫描顺序。 */
async function openTable(context: LiveContext) {
  const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) }); await connection.getByRole('button', { name: context.connectionName, exact: true }).focus(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click(); const previous = await count('table.page', true); await connection.locator('.object-row').getByText(name, { exact: true }).click(); await loaded(previous);
  const sorted = await count('table.page', true); await table().getByRole('columnheader').filter({ hasText: /^id/ }).click(); await loaded(sorted); await expect(await cell('id')).toHaveText(firstId);
}
/** 通过记录表单和显式LONGTEXT解析进入真实有序树。 */
async function openPanel() { await (await cell('body')).click(); await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: formText.title, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: treeText.tree, exact: true })).click(); }
async function parseColumn(key = 'body') {
  const field = panel().getByRole('list', { name: treeText.fields, exact: true }).locator(':scope > li').filter({ has: page.getByRole('heading', { name: new RegExp('^' + key + '$|^' + key + '\\s') }) });
  await (await (await import('./navigation-menu')).navigationMenuItem(field, { name: treeText.parseExplicit, exact: true })).click(); await expect(tree()).toBeVisible();
}
/** 必须从产品结构菜单打开，不能从夹具按钮或内部controller直接调用新动作。 */
async function operation() { await (await (await import('./navigation-menu')).navigationMenuItem(root(), { name: structureText.more, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(panel().getByRole('group', { name: structureText.more, exact: true }), { name: text.title, exact: true })).click(); await expect(editor()).toBeVisible(); }
async function positions(from: string, to: string) { await editor().getByRole('textbox', { name: text.fromLabel, exact: true }).fill(from); await editor().getByRole('textbox', { name: text.toLabel, exact: true }).fill(to); }
async function stageMove() { await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.stage, exact: true })).click(); await expect(editor()).toHaveCount(0); await expect(panel().locator('.error-box')).toHaveCount(0); }
/** 根token不含外围空白，完整外围仍由服务器HEX逐字节断言覆盖。 */
async function localToken() { await parseColumn(); await (await (await import('./navigation-menu')).navigationMenuItem(root(), { name: treeText.inspect, exact: true })).click(); return panel().getByRole('textbox', { name: treeText.token, exact: true }).inputValue(); }
async function showPreview() { await (await (await import('./navigation-menu')).navigationMenuItem(table(), { name: '预览并提交', exact: true })).click(); await expect(preview()).toBeVisible(); await expect(preview().locator('.monaco-editor .view-lines')).toContainText('UPDATE'); await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeEnabled(); }

test('真实对象菜单移动完整成员，原页草稿与精确token保留，只有确认后写库', async ({}, info) => {
  test.setTimeout(120000); await withDatabase(async context => {
    const before = await read(context); await openTable(context); await (await cell('note')).dblclick(); const note = table().getByRole('textbox', { name: '编辑 note', exact: true }); await note.fill('已有页面备注'); await note.press('Enter');
    await openPanel(); await parseColumn(); await operation(); await positions('2', '4'); await stageMove(); expect(await localToken()).toBe(movedSecondToLast.trim()); expect(await read(context)).toEqual(before); expect(await count('table.preview')).toBe(0); expect(await count('table.apply')).toBe(0);
    await showPreview(); expect(await read(context)).toEqual(before); expect(await count('table.apply')).toBe(0); const pages = await count('table.page', true); await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认提交', exact: true })).click(); await expect(preview()).toHaveCount(0); await loaded(pages);
    const expectedBody = Buffer.from(movedSecondToLast).toString('hex').toUpperCase(); expect(await read(context)).toEqual([{ ...before[0], note_hex: Buffer.from('已有页面备注').toString('hex').toUpperCase(), body_hex: expectedBody, generated_hex: expectedBody }, before[1]]); expect(await count('table.apply', true)).toBe(1);
  }, info);
});
test('非法成员位置保留原文，切行三选的留在放弃暂存继续复用原控制器', async ({}, info) => {
  test.setTimeout(120000); await withDatabase(async context => {
    const before = await read(context); await openTable(context); await openPanel(); await parseColumn(); await operation(); await positions('1', '0'); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.stage, exact: true })).click(); await expect(panel().locator('.error-box')).toContainText(text.position);
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.next, exact: true })).click(); await expect(leave()).toBeVisible(); await (await (await import('./navigation-menu')).navigationMenuItem(leave(), { name: formText.stageContinue, exact: true })).click(); await expect(leave()).toBeVisible(); await expect(leave().locator('.error-box')).toContainText(text.position); await (await (await import('./navigation-menu')).navigationMenuItem(leave(), { name: formText.stay, exact: true })).click(); await expect(editor().getByRole('textbox', { name: text.toLabel, exact: true })).toHaveValue('0');
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.next, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(leave(), { name: formText.discardContinue, exact: true })).click(); await expect(editor()).toHaveCount(0); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.previous, exact: true })).click(); await parseColumn(); await operation(); await positions('1', '2');
    await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.next, exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(leave(), { name: formText.stageContinue, exact: true })).click(); await expect(editor()).toHaveCount(0); await expect(table().locator('.row-modified')).toHaveCount(1); expect(await read(context)).toEqual(before); expect(await count('table.preview')).toBe(0); expect(await count('table.apply')).toBe(0);
  }, info);
});
test('生成列不能移动，两行对象移动遇到并发原值变化整批回滚且不重放', async ({}, info) => {
  test.setTimeout(120000); await withDatabase(async context => {
    const before = await read(context); await openTable(context); await openPanel(); await parseColumn('computed'); await expect(root().getByRole('button', { name: structureText.more, exact: true })).toBeDisabled();
    await parseColumn(); await operation(); await positions('1', '2'); await stageMove(); await (await (await import('./navigation-menu')).navigationMenuItem(panel(), { name: formText.next, exact: true })).click(); await parseColumn(); await operation(); await positions('2', '1'); await stageMove(); await showPreview();
    await context.observer.query(`UPDATE ${qualified(context.database)} SET note='并发原值' WHERE id=?`, [secondId]); await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '确认提交', exact: true })).click(); await expect.poll(() => count('table.apply', true), { timeout: 20000 }).toBe(1); await expect(preview().locator('.error-box')).toContainText(/并发|已被其他/); await expect(preview().getByRole('button', { name: '确认提交', exact: true })).toBeDisabled(); expect(await count('table.apply')).toBe(1);
    expect(await read(context)).toEqual([before[0], { ...before[1], note_hex: Buffer.from('并发原值').toString('hex').toUpperCase() }]); await (await (await import('./navigation-menu')).navigationMenuItem(preview(), { name: '返回编辑', exact: true })).click(); await expect(preview()).toHaveCount(0);
  }, info);
});
