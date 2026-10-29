import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, desktop, closed, pageErrors } from './desktop-fixture';
import type { LiveContext } from './live-helpers';
import { binaryCellZh as binary } from '../../src/renderer/locales/binaryCell.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认跳过早于自动桌面夹具；实库helper仅在明确启用的测试体内加载。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
test.skip(!enabled, '仅由统筹明确启用200随机隔离库验收，默认不启动桌面或加载实库配置');
test.use({ trace: 'off' });
type Observation = { command: string; settled: boolean };
type Probe = { calls: Observation[]; restore(): void };
type ProbeRoot = typeof globalThis & { __queryResultTypesProbe?: Probe };
interface Header { name: string; type: string; index: string }
interface ObservedRow extends RowDataPacket { id: string; text_hex: string; long_hex: string; blob_hex: string; var_hex: string; nullable_hex: string | null }
const tableName = 'query_result_types', firstText = 'TEXT正文一', secondText = '0x00ff 仍是TEXT', longText = 'LONGTEXT正文\n第二行🙂';
const qualified = (database: string) => `\`${database}\`.\`${tableName}\``;
const query = () => page.locator('.query-tab:visible');
const grid = () => query().locator('.result-body .results-grid:visible');

test.beforeAll(() => {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || !/^\d+$/.test(process.env.DBARK_TEST_PORT ?? '') || Number(process.env.DBARK_TEST_PORT) < 1 || Number(process.env.DBARK_TEST_PORT) > 65535 || !process.env.DBARK_TEST_USER || process.env.DBARK_TEST_PASSWORD === undefined) throw Error('必须显式注入已核对200隔离实例的主机、端口及临时账号，不回退业务库配置');
});

/** 只旁观原IPC的命令及完成标记，不读取参数、SQL、认证或修改真实返回。 */
async function observe() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request');
    if (!original) throw Error('缺少真实IPC处理器');
    const probe: Probe = { calls: [], restore: () => handlers.set('dbark:request', original) }; (globalThis as ProbeRoot).__queryResultTypesProbe = probe;
    handlers.set('dbark:request', async (event, payload) => {
      const call = ['query.execute', 'table.preview', 'table.apply'].includes(payload.command) ? { command: payload.command, settled: false } : undefined;
      if (call) probe.calls.push(call);
      try { return await original(event, payload); } finally { if (call) call.settled = true; }
    });
  });
}
/** 输出脱敏命令摘要，完成计数用于确认SELECT实际返回后才操作结果。 */
async function observations(): Promise<Observation[]> { return desktop.evaluate(() => (globalThis as ProbeRoot).__queryResultTypesProbe?.calls ?? []); }
/** 旁观连接只在本例随机库建立合成表和原值证据，不替代产品SELECT。 */
async function fixture(context: LiveContext) {
  if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database)) throw Error('拒绝在非随机隔离库建立测试表');
  await context.observer.query(`CREATE TABLE ${qualified(context.database)} (id INT PRIMARY KEY,text_value TEXT,long_value LONGTEXT,blob_value BLOB,var_value VARBINARY(16),nullable_value TEXT NULL) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context.database)} VALUES (1,?,?,?,?,NULL),(2,?,?,?,?,?)`, [firstText, longText, Buffer.from([0, 255, 128]), Buffer.from([128, 0, 127, 255]), secondText, longText + '第二记录', Buffer.alloc(0), Buffer.alloc(0), '可空文字实值']);
}
/** 所有文本与字节都读HEX，原值比较不经过编码猜测或浮点往返。 */
async function read(context: LiveContext): Promise<ObservedRow[]> {
  return (await context.observer.query<ObservedRow[]>(`SELECT CAST(id AS CHAR) AS id,HEX(text_value) AS text_hex,HEX(long_value) AS long_hex,HEX(blob_value) AS blob_hex,HEX(var_value) AS var_hex,HEX(nullable_value) AS nullable_hex FROM ${qualified(context.database)} ORDER BY id`))[0];
}
/** 采集实际列头及aria坐标；虚拟列逐屏挂载，不按重复名称或猜测c0定位值。 */
async function headers(): Promise<Header[]> {
  const found = new Map<string, Header>(); await grid().evaluate(node => { node.scrollLeft = 0; });
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const visible = await grid().getByRole('columnheader').evaluateAll(nodes => nodes.flatMap(node => {
      const type = node.querySelector('.column-type'), index = node.getAttribute('aria-colindex'); if (!type || !index) return [];
      const name = Array.from(type.parentElement!.childNodes).filter(child => child !== type).map(child => child.textContent ?? '').join('');
      return [{ name, type: type.textContent ?? '', index }];
    }));
    for (const header of visible) { if (!/^\d+$/.test(header.index)) throw Error('实际列头缺少有效aria坐标'); found.set(header.index, header); }
    if (found.size === 5) break; await grid().evaluate(node => { node.scrollLeft += node.clientWidth; });
  }
  const result = [...found.values()].sort((a, b) => Number(a.index) - Number(b.index)); expect(result).toHaveLength(5); return result;
}
/** 将真实列头挂载后再读取同aria坐标的单元格，行序来自真实SELECT ORDER BY id。 */
async function cell(header: Header, row: number): Promise<Locator> {
  await grid().evaluate(node => { node.scrollLeft = 0; });
  const actualHeader = grid().locator(`[role=columnheader][aria-colindex="${header.index}"]`);
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    if (await actualHeader.count()) break; await grid().evaluate(node => { node.scrollLeft += node.clientWidth; });
  }
  await expect(actualHeader).toHaveCount(1); const target = grid().locator(`[role=row][aria-rowindex="${row}"] [role=gridcell][aria-colindex="${header.index}"]`); await expect(target).toHaveCount(1); await target.scrollIntoViewIfNeeded(); return target;
}
/** 双击与Enter都从真实网格选择进入，不直接调用组件或内部模型。 */
async function activate(header: Header, row: number, action: 'double' | 'enter') {
  const target = await cell(header, row); if (action === 'double') await target.dblclick(); else { await target.click(); await target.press('Enter'); }
}
/** 每轮查看都核对SELECT只执行一次、表预览与提交为零、旁观原值未变。 */
async function unchanged(context: LiveContext, before: ObservedRow[]) {
  const calls = await observations(); expect(calls.filter(call => call.command === 'query.execute')).toEqual([{ command: 'query.execute', settled: true }]); expect(calls.filter(call => call.command === 'table.preview' || call.command === 'table.apply')).toEqual([]); expect(await read(context)).toEqual(before);
}
/** 失败保留无秘密的命令/列头与实际页面，先撤销观察包装，再由既有helper退出及精确清库。 */
async function inDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  const { isolatedDatabase } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    await fixture(context); await observe();
    try { await body(context); expect(pageErrors).toEqual([]); }
    catch (reason) {
      if (!closed) {
        await info.attach('失败命令摘要', { body: JSON.stringify(await observations()), contentType: 'application/json' }).catch(() => undefined);
        const visibleHeaders = await grid().getByRole('columnheader').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, index: node.getAttribute('aria-colindex') }))).catch(() => []);
        await info.attach('失败时可见列头', { body: JSON.stringify(visibleHeaders), contentType: 'application/json' }).catch(() => undefined);
        await page.screenshot({ path: info.outputPath('query-result-types-failure.png') }).catch(() => undefined);
      }
      throw reason;
    } finally { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeRoot; root.__queryResultTypesProbe?.restore(); delete root.__queryResultTypesProbe; }); }
  }, info);
}

test('真实SELECT的wire BLOB文本与NULL不误开字节，实际字节及空字节只读且重复别名按坐标定位', async ({}, info) => {
  test.setTimeout(120000);
  await inDatabase(async context => {
    const before = await read(context), { openDatabaseQuery, executeSql, readRenderedResult } = await import('./live-helpers');
    await openDatabaseQuery(context.database);
    await executeSql(`SELECT text_value AS \`重复别名\`,blob_value AS \`重复别名\`,long_value AS \`长文字\`,var_value AS \`原始字节\`,nullable_value AS \`可空文字\` FROM ${qualified(context.database)} ORDER BY id`);
    await expect.poll(async () => (await observations()).filter(call => call.command === 'query.execute' && call.settled).length, { timeout: 20000 }).toBe(1);
    await readRenderedResult(text => text.includes(firstText) && text.includes(secondText));
    const columns = await headers(); expect(columns.map(column => column.name)).toEqual(['重复别名', '重复别名', '长文字', '原始字节', '可空文字']);
    for (const position of [0, 2, 4]) expect(columns[position].type.toUpperCase()).toBe('BLOB');
    await info.attach('实际SELECT结果列头', { body: JSON.stringify(columns), contentType: 'application/json' });
    await expect(await cell(columns[0], 2)).toHaveText(firstText); await expect(await cell(columns[0], 3)).toHaveText(secondText); await expect(await cell(columns[4], 2)).toHaveText('NULL');
    for (const position of [0, 2, 4]) for (const row of [2, 3]) for (const action of ['double', 'enter'] as const) {
      await activate(columns[position], row, action); await expect(page.getByRole('dialog')).toHaveCount(0); await unchanged(context, before);
    }
    for (const position of [1, 3]) for (const row of [2, 3]) for (const action of ['double', 'enter'] as const) {
      const header = columns[position]; await activate(header, row, action);
      const modal = page.getByRole('dialog', { name: `${binary.title}：${header.name}`, exact: true }), hex = modal.getByRole('textbox', { name: binary.hexLabel, exact: true });
      await expect(modal).toBeVisible(); await expect(hex).toHaveValue(row === 3 ? '' : position === 1 ? '00 ff 80' : '80 00 7f ff'); await expect(hex).toHaveJSProperty('readOnly', true); await expect(modal).toContainText(binary.readonly); await expect((await navigationMenuItem(modal, { name: /暂存/ }))).toHaveCount(0);
      if (row === 3) await expect(modal).toContainText(binary.empty);
      await (await navigationMenuItem(modal, { name: zh.dialogs.text001, exact: true })).click(); await expect(modal).toHaveCount(0); await unchanged(context, before);
    }
    await info.attach('只读结果命令摘要', { body: JSON.stringify(await observations()), contentType: 'application/json' }); await unchanged(context, before);
  }, info);
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
