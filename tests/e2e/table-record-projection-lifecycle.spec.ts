import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { recordViewZh as formText } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as text } from '../../src/renderer/locales/recordProjections.zh-CN';
import { test, expect, page, desktop, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

test.use({ trace: 'off' });
const activeTable = () => page.locator('.table-tab:visible');
const panel = () => activeTable().getByRole('complementary', { name: formText.title, exact: true });
const tree = () => panel().getByRole('list', { name: text.lexicalTree, exact: true });
const qualified = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
type Probe = { calls: { command: string; settled: boolean }[]; held: boolean; release(): void; restore(): void };
type ProbeGlobal = typeof globalThis & { __recordProjectionLifecycle?: Probe };

/** 门控一次真实分页响应的交付；SQL和返回内容均由原handler完成，不伪造数据。 */
async function observe(holdPage = false) {
  await desktop.evaluate(({ ipcMain }, hold) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('没有真实IPC');
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    const state: Probe = { calls: [], held: false, release, restore: () => { release(); handlers.set('dbark:request', original); } };
    (globalThis as ProbeGlobal).__recordProjectionLifecycle = state;
    handlers.set('dbark:request', async (event, payload) => {
      if (!/^(?:table\.|metadata\.|query\.)/.test(payload.command)) return original(event, payload);
      const call = { command: payload.command, settled: false }; state.calls.push(call);
      const result = await original(event, payload); call.settled = true;
      if (hold && payload.command === 'table.page' && !state.held) { state.held = true; await waiting; }
      return result;
    });
  }, holdPage);
}
async function calls() { return desktop.evaluate(() => (globalThis as ProbeGlobal).__recordProjectionLifecycle?.calls ?? []); }
/** 清理先释放真实响应，避免失败时把原会话或应用关闭卡在测试门控中。 */
async function restore() { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeGlobal; root.__recordProjectionLifecycle?.restore(); delete root.__recordProjectionLifecycle; }); }
async function lifecycleDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (error) { if (!closed) await info.attach('只读投影生命周期命令名', { body: JSON.stringify(await calls()), contentType: 'application/json' }).catch(() => undefined); throw error; }
    finally { await restore(); }
  }, info);
}
/** 通过真实对象树打开目标，三个只读对象仍使用普通生产读取。 */
async function openTable(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) });
  await connection.getByRole('button', { name: context.connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click(); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(activeTable().locator('.context-bar')).toContainText(name); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
}
async function cell(): Promise<Locator> {
  const header = activeTable().getByRole('columnheader', { name: /^payload/ }); const index = await header.getAttribute('aria-colindex'); if (!index) throw new Error('缺少真实列坐标');
  const result = activeTable().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${index}"]`); await result.scrollIntoViewIfNeeded(); return result;
}
async function openPanel() { await (await cell()).click(); if (!(await panel().isVisible())) await activeTable().getByRole('button', { name: formText.title, exact: true }).click(); await expect(panel()).toBeVisible(); }
async function mode(value: 'tree' | 'json') { await panel().getByRole('button', { name: text[value], exact: true }).click(); }
async function wholeValue() { const source = await panel().getByRole('textbox', { name: text.jsonText, exact: true }).inputValue(); return { source, document: JSON.parse(source) as { fields: { name: string; value: { kind: string; text?: string } }[] } }; }
async function parsePayload() {
  await panel().getByRole('list', { name: text.fields, exact: true }).locator(':scope > li').filter({ has: page.getByRole('heading', { name: /^payload/ }) }).getByRole('button', { name: text.parseExplicit, exact: true }).click();
  await expect(tree()).toBeVisible();
}

test.describe('只读记录投影：分页撤下及只读对象生命周期', () => {
  test.skip(!enabled, '需要明确启用200隔离实库'); test.setTimeout(120000);
  test.beforeEach(() => { if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('只允许200测试服务器'); const port = process.env.DBARK_RECORD_VIEWS_TEST_PORT ?? process.env.DBARK_TEST_PORT ?? '13384'; if (!['13357', '13380', '13384', '13310', '13311'].includes(port)) throw new Error('拒绝未授权端口'); environment.DBARK_TEST_PORT = port; });

  test('真实分页响应交付前撤下旧投影，刷新及跨页不复用旧行且全文可原生复制', async ({}, info) => {
    await lifecycleDatabase(async context => {
      const name = 'paged_projections'; await context.observer.query(`CREATE TABLE ${qualified(context, name)}(id INT PRIMARY KEY,payload LONGTEXT) ENGINE=InnoDB`);
      await context.observer.query(`INSERT INTO ${qualified(context, name)} VALUES ?`, [Array.from({ length: 51 }, (_, index) => [index + 1, JSON.stringify({ n: index + 1 })])]); await openTable(context, name);
      await activeTable().getByRole('combobox', { name: '每页行数', exact: true }).selectOption('50'); await expect(activeTable().locator('.results-grid')).toHaveAttribute('aria-rowcount', '51'); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await openPanel(); await observe(true); await mode('json');
      const initial = await wholeValue(); expect(initial.document.fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":1}');
      const input = panel().getByRole('textbox', { name: text.jsonText, exact: true }); await input.focus(); await input.press(`${modifier}+A`); await input.press(`${modifier}+C`); expect(await desktop.evaluate(({ clipboard }) => clipboard.readText())).toBe(initial.source); expect(await calls()).toEqual([]);
      await activeTable().getByRole('button', { name: '下一页', exact: true }).click(); await expect.poll(() => desktop.evaluate(() => (globalThis as ProbeGlobal).__recordProjectionLifecycle?.held)).toBe(true);
      await expect(panel()).toContainText(text.stale); await expect(input).toHaveCount(0); await expect(tree()).toHaveCount(0);
      await desktop.evaluate(() => (globalThis as ProbeGlobal).__recordProjectionLifecycle?.release()); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(panel()).toContainText(text.noRecord); await expect(input).toHaveCount(0);
      await (await cell()).click(); expect((await wholeValue()).document.fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":51}');
      const firstRead = await calls(); expect(firstRead.filter(call => call.command === 'metadata.table')).toHaveLength(1); expect(firstRead.filter(call => call.command === 'table.page')).toHaveLength(1); expect(firstRead.every(call => ['metadata.table', 'table.page'].includes(call.command) && call.settled)).toBe(true);
      await activeTable().getByRole('button', { name: '刷新', exact: true }).click(); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(panel()).toContainText(text.noRecord); await expect(input).toHaveCount(0); await (await cell()).click(); expect((await wholeValue()).document.fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":51}');
      const finalRead = await calls(); expect(finalRead.filter(call => call.command === 'metadata.table')).toHaveLength(2); expect(finalRead.filter(call => call.command === 'table.page')).toHaveLength(2); expect(finalRead.every(call => ['metadata.table', 'table.page'].includes(call.command) && call.settled)).toBe(true);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT id,payload FROM ${qualified(context, name)} WHERE id IN(1,51) ORDER BY id`))[0].map(row => [String(row.id), row.payload])).toEqual([['1', '{"n":1}'], ['51', '{"n":51}']]);
    }, info);
  });

  test('视图无键及非事务表可只读查看，删除与撤销使旧节点失效且始终没有写入', async ({}, info) => {
    await lifecycleDatabase(async context => {
      await context.observer.query(`CREATE TABLE ${qualified(context, 'base_records')}(id INT PRIMARY KEY,payload LONGTEXT,native_json JSON) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context, 'base_records')} VALUES(1,'{"n":1}','{"n":9007199254740993,"text":"中文"}')`);
      await context.observer.query(`CREATE VIEW ${qualified(context, 'readonly_view')} AS SELECT id,payload,native_json FROM ${qualified(context, 'base_records')}`);
      // 以服务器实际返还原文为边界，不声称恢复MySQL存储JSON前的空白或重复成员。
      const [nativeRows] = await context.observer.query<RowDataPacket[]>(`SELECT CAST(native_json AS CHAR) AS raw FROM ${qualified(context, 'base_records')}`);
      const [nativeMetadata] = await context.observer.query<RowDataPacket[]>('SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [context.database, 'base_records', 'native_json']);
      const nativeKind = String(nativeMetadata[0].DATA_TYPE).toLowerCase() === 'json' ? 'json-text' : 'string';
      await context.observer.query(`CREATE TABLE ${qualified(context, 'no_key')}(payload LONGTEXT) ENGINE=InnoDB`); await context.observer.query(`INSERT INTO ${qualified(context, 'no_key')} VALUES('{"n":2}')`);
      await context.observer.query(`CREATE TABLE ${qualified(context, 'nontransaction')}(id INT PRIMARY KEY,payload LONGTEXT) ENGINE=MyISAM`); await context.observer.query(`INSERT INTO ${qualified(context, 'nontransaction')} VALUES(1,'{"n":3}')`);
      await observe();
      for (const [name, value] of [['readonly_view', '{"n":1}'], ['no_key', '{"n":2}'], ['nontransaction', '{"n":3}']] as const) {
        await openTable(context, name); await openPanel(); await expect(activeTable().getByRole('button', { name: '新增', exact: true })).toBeDisabled(); await expect(activeTable().getByRole('button', { name: '删除', exact: true })).toBeDisabled(); const before = (await calls()).length;
        await mode('tree'); await parsePayload(); await mode('json'); expect((await wholeValue()).document.fields.find(field => field.name === 'payload')!.value.text).toBe(value); await expect(panel().getByRole('textbox', { name: text.jsonText, exact: true })).toHaveJSProperty('readOnly', true); expect((await calls()).length).toBe(before);
        if (name === 'readonly_view') {
          expect((await wholeValue()).document.fields.find(field => field.name === 'native_json')!.value).toEqual({ kind: nativeKind, text: String(nativeRows[0].raw) }); await mode('tree');
          await panel().getByRole('list', { name: text.fields, exact: true }).locator(':scope > li').filter({ has: page.getByRole('heading', { name: /^native_json/ }) }).getByRole('button', { name: nativeKind === 'json-text' ? text.parse : text.parseExplicit, exact: true }).click();
          await tree().locator(':scope > li').filter({ has: page.getByText('成员 #1 · "n"', { exact: true }) }).getByRole('button', { name: text.inspect, exact: true }).click(); await expect(panel().getByRole('textbox', { name: text.token, exact: true })).toHaveValue('9007199254740993'); expect((await calls()).length).toBe(before);
        }
      }
      await openTable(context, 'base_records'); await openPanel(); await mode('tree'); await parsePayload(); await tree().locator(':scope > li').first().getByRole('button', { name: text.inspect, exact: true }).click(); await expect(panel().getByRole('textbox', { name: text.token, exact: true })).toHaveValue('{"n":1}'); const beforeDelete = (await calls()).length;
      await activeTable().getByRole('button', { name: '删除', exact: true }).click(); await expect(activeTable().locator('.row-deleted')).toHaveCount(1); await expect(tree()).toHaveCount(0); await expect(panel().getByRole('textbox', { name: text.token, exact: true })).toHaveCount(0); await mode('json'); expect((await wholeValue()).document.fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":1}');
      await activeTable().getByRole('button', { name: '删除', exact: true }).click(); await expect(activeTable().locator('.row-deleted')).toHaveCount(0); expect((await wholeValue()).document.fields.find(field => field.name === 'payload')!.value.text).toBe('{"n":1}'); expect((await calls()).length).toBe(beforeDelete); expect((await calls()).some(call => ['table.apply', 'table.preview', 'query.execute'].includes(call.command))).toBe(false);
      expect((await context.observer.query<RowDataPacket[]>(`SELECT payload FROM ${qualified(context, 'base_records')}`))[0][0].payload).toBe('{"n":1}');
    }, info);
  });
});
