import type { TestInfo } from '@playwright/test';
import type { LiveContext } from './live-helpers';
import { test, expect, page, desktop, closed } from './desktop-fixture';
import { recordViewZh as text } from '../../src/renderer/locales/recordViews.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { recordDocumentZh as documentText } from '../../src/renderer/locales/recordDocument.zh-CN';

// ROOT独占正式窗口/隔离库。默认跳过，不读取实库配置；不增加原45秒总超时或点击上限。
const enabled = process.env.DBARK_RECORD_CROSS_PAGE_UI === '1' && process.env.DBARK_INTEGRATION_ENABLED === '1';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const table = () => page.locator('.table-tab:visible');
const form = () => table().getByRole('complementary', { name: text.title, exact: true });
const next = () => form().getByRole('button', { name: text.next, exact: true });
const previous = () => form().getByRole('button', { name: text.previous, exact: true });
const note = () => form().getByRole('note', { name: text.pageNavigation, exact: true });
const qualified = (context: LiveContext) => `\`${context.database}\`.\`records\``;
type Call = { command: string; page?: number; pageSize?: number; filters?: unknown; sort?: unknown };
type Main = typeof globalThis & { __recordCrossPage?: { calls: Call[]; hold: boolean; held: boolean; release(): void; restore(): void } };

/** 只旁观正式 handler；需要时仅延迟一次真实第二页回包，不制造数据或替换产品组件。 */
async function observe(connectionId: string) {
  await desktop.evaluate(({ ipcMain }, id) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: { connectionId?: string; page?: number; pageSize?: number; filters?: unknown; sort?: unknown } }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'); if (!original) throw Error('缺少正式IPC处理器');
    let release = () => {};
    const state: NonNullable<Main['__recordCrossPage']> = { calls: [], hold: false, held: false, release() { release(); }, restore() { handlers.set('dbark:request', original); release(); } };
    (globalThis as Main).__recordCrossPage = state;
    handlers.set('dbark:request', async (event, payload) => {
      if (!['table.page', 'table.preview', 'table.apply'].includes(payload.command) || payload.input?.connectionId !== id) return original(event, payload);
      if (state.calls.length >= 96) throw Error('本例调用摘要超出预算');
      state.calls.push({ command: payload.command, ...(payload.command === 'table.page' ? { page: payload.input.page, pageSize: payload.input.pageSize, filters: payload.input.filters, sort: payload.input.sort } : {}) });
      const response = await original(event, payload);
      if (payload.command === 'table.page' && payload.input.page === 2 && state.hold) { state.hold = false; state.held = true; await new Promise<void>(resolve => { release = resolve; }); }
      return response;
    });
  }, connectionId);
}
async function calls(): Promise<Call[]> { return desktop.evaluate(() => (globalThis as Main).__recordCrossPage?.calls ?? []); }
/** 本例只保存命令和固定夹具的分页条件，不输出凭据、文件或行正文。 */
async function noWrites() { expect((await calls()).filter(call => call.command !== 'table.page')).toEqual([]); }

/** 创建51条实际服务端记录；对象树、分页、表单和IPC全部使用正式应用路径。 */
async function prepare(context: LiveContext) {
  await context.observer.query(`CREATE TABLE ${qualified(context)}(id BIGINT PRIMARY KEY,note VARCHAR(100),payload JSON) ENGINE=InnoDB`);
  await context.observer.query(`INSERT INTO ${qualified(context)} VALUES ?`, [Array.from({ length: 51 }, (_, index) => [index + 1, `记录${index + 1}`, '{"n":9007199254740993}'])]);
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row > .tree-label').focus(); await connection.getByRole('button', { name: zh.sidebar.text011, exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await connection.locator('.object-row').getByText('records', { exact: true }).click(); await expect(table().locator('.loading-overlay')).toHaveCount(0);
  await table().getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50'); await expect(table().locator('.loading-overlay')).toHaveCount(0);
  await observe(context.connectionId);
  // 显式排序和非空服务端条件随正反跨页原样传递。
  await table().getByRole('columnheader', { name: /^id/ }).click(); await expect(table().locator('.loading-overlay')).toHaveCount(0);
  await table().getByRole('button', { name: zh.table.text006, exact: true }).click();
  const filter = table().locator('.filter-panel'); await filter.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption('id'); await filter.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption('>='); await filter.getByRole('textbox', { name: zh.table.text011, exact: true }).fill('1'); await filter.getByRole('button', { name: zh.table.text013, exact: true }).click(); await expect(table().locator('.loading-overlay')).toHaveCount(0);
  const header = table().getByRole('columnheader', { name: /^id/ }), index = await header.getAttribute('aria-colindex');
  await table().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`).click();
  await table().getByRole('button', { name: text.title, exact: true }).click(); await expect(previous()).toBeDisabled();
  // 页内真实按钮导航不发读取；不用DOM注入或程序设置React选中状态。
  for (let index = 1; index < 50; index++) await next().click();
  await expect(form()).toContainText('本页第 50 / 50 条'); await expect(form().getByRole('region', { name: 'id', exact: true }).locator('dd').first()).toHaveText('50');
}
async function currentId(value: string) { await expect(form().getByRole('region', { name: 'id', exact: true }).locator('dd').first()).toHaveText(value); }
/** 复用已验随机库清理，始终先还原本例旁观器；不改现有夹具断言或超时。 */
async function database(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  const { isolatedDatabase } = await import('./live-helpers');
  await isolatedDatabase(async context => {
    try { await prepare(context); await body(context); await noWrites(); }
    finally { if (!closed) { try { await info.attach('记录跨页调用摘要', { body: JSON.stringify(await calls(), null, 2), contentType: 'application/json' }); } finally { await desktop.evaluate(() => { (globalThis as Main).__recordCrossPage?.restore(); delete (globalThis as Main).__recordCrossPage; }); } } }
  }, info);
}

test.describe('D04记录表单跨页正式入口准备', () => {
  test.skip(!enabled, '默认关闭，由ROOT单独开启实库与DBARK_RECORD_CROSS_PAGE_UI');
  test.beforeAll(() => {
    if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(process.env.DBARK_TEST_PORT ?? '')) throw Error('仅允许ROOT明确注入并核对的200隔离实例');
    if (process.env.DBARK_TEST_PORT === '13484' && process.env.DBARK_TEST_TLS !== '1') throw Error('严格TLS端口必须沿用原TLS配置');
  });
  test('51条/50分页正反跨页保持条件与选择，首尾明确且零自动写入', async ({}, info) => {
    await database(async () => {
      const before = (await calls()).length; await next().click(); await currentId('51'); await expect(next()).toBeDisabled();
      await previous().click(); await currentId('50');
      const read = (await calls()).slice(before); expect(read).toHaveLength(2); expect(read.map(call => call.page)).toEqual([2, 1]);
      for (const call of read) { expect(call.pageSize).toBe(50); expect(call.filters).toEqual([{ column: 'id', operator: '>=', value: '1' }]); expect(call.sort).toEqual([{ column: 'id', direction: 'ASC' }]); }
    }, info);
  });
  for (const kind of ['字段文本', '非法JSON字段', '非法整行JSON', '非当前行草稿', '新增草稿', '删除草稿'] as const) {
    test(`${kind}阻止跨页并完整保留输入与旧值`, async ({}, info) => {
      await database(async () => {
        let input: ReturnType<typeof form> | undefined;
        if (kind === '非法整行JSON') { await form().getByRole('button', { name: documentText.input, exact: true }).click(); input = form().getByRole('textbox', { name: documentText.label, exact: true }); await input.fill('{'); }
        else if (kind === '新增草稿') { await table().getByRole('button', { name: zh.common.add, exact: true }).click(); }
        else if (kind === '删除草稿') { await table().getByRole('button', { name: zh.common.delete, exact: true }).click(); }
        else {
          if (kind === '非当前行草稿') await previous().click();
          const key = kind === '非法JSON字段' ? 'payload' : 'note', section = form().getByRole('region', { name: key, exact: true });
          await section.getByRole('button', { name: text.editField, exact: true }).click(); await section.getByRole('combobox', { name: text.mode, exact: true }).selectOption(kind === '非法JSON字段' ? 'json' : 'text');
          input = section.getByRole('textbox', { name: `${key} · ${text.value}`, exact: true }); await input.fill(kind === '非法JSON字段' ? '{' : '跨页前原样保留');
          if (kind === '非当前行草稿') { await form().getByRole('button', { name: text.stage, exact: true }).click(); await next().click(); input = undefined; }
        }
        const before = (await calls()).length; await next().click(); await expect(note()).toHaveText(text.pageDirty); expect((await calls()).length).toBe(before);
        if (input) await expect(input).toHaveValue(kind === '字段文本' ? '跨页前原样保留' : '{');
        await expect(table().locator('.table-action-bar')).toContainText(/草稿|未提交|未暂存/);
      }, info);
    });
  }
  test('目标页记录被外部删除后显示空页，可明确返回，旧记录不冒充新页', async ({}, info) => {
    await database(async context => {
      await context.observer.query(`DELETE FROM ${qualified(context)} WHERE id=51`); await next().click(); await expect(note()).toContainText('第 2 页没有记录'); await expect(form().getByRole('region', { name: 'id', exact: true })).toHaveCount(0); await expect(next()).toBeDisabled();
      await previous().click(); await currentId('50');
    }, info);
  });
  test('实际服务器读失败清空旧页且不自动重试，恢复表后明确返回', async ({}, info) => {
    await database(async context => {
      await context.observer.query(`RENAME TABLE ${qualified(context)} TO \`${context.database}\`.\`暂存原表\``);
      const before = (await calls()).length; await next().click(); await expect(note()).toContainText('第 2 页读取失败'); await expect(form().getByRole('region', { name: 'id', exact: true })).toHaveCount(0); expect((await calls()).length).toBe(before + 1);
      await context.observer.query(`RENAME TABLE \`${context.database}\`.\`暂存原表\` TO ${qualified(context)}`); await previous().click(); await currentId('50');
    }, info);
  });
  test('真实第二页回包迟到时切换标签撤销自动选行，忙态不重复读取', async ({}, info) => {
    await database(async () => {
      await desktop.evaluate(() => { (globalThis as Main).__recordCrossPage!.hold = true; }); const before = (await calls()).length;
      await next().click(); await expect.poll(() => desktop.evaluate(() => (globalThis as Main).__recordCrossPage!.held)).toBe(true); await expect(next()).toBeDisabled();
      await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click(); await page.getByRole('dialog', { name: zh.common.newQuery, exact: true }).getByRole('button', { name: '打开查询', exact: true }).click();
      await desktop.evaluate(() => (globalThis as Main).__recordCrossPage!.release()); await page.locator('.tab-select').filter({ hasText: /^records$/ }).click(); await expect(table().locator('.loading-overlay')).toHaveCount(0);
      await expect(form()).toContainText(text.empty); await expect(form().getByRole('region', { name: 'id', exact: true })).toHaveCount(0); expect((await calls()).length).toBe(before + 1);
    }, info);
  });
});
