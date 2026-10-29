import { clickSidebarAction } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { indexPatchZh as text } from '../../src/renderer/locales/indexPatches.zh-CN';
import { test, expect, page, desktop, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, type LiveContext } from './live-helpers';

// 三个开关均显式开启才启动原生应用；默认不会因其他实库套件的总开关而运行本文件。
const authorized = enabled && process.env.DBARK_SPECIAL_INDEX_INTEGRATION_ENABLED === '1' && process.env.DBARK_SPECIAL_INDEX_UI_ENABLED === '1';
test.use({ trace: 'off' });
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
type Probe = { calls: string[]; restore(): void };
type ProbeGlobal = typeof globalThis & { __specialIndexLiveProbe?: Probe };

/** 只旁观真实IPC命令名，原handler的参数、执行和返回完整透传，不注入引擎或组件状态。 */
async function observeCommands(): Promise<void> {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw new Error('缺少真实产品IPC入口');
    const root = globalThis as ProbeGlobal; if (root.__specialIndexLiveProbe) throw new Error('不能覆盖其他任务的观察包装');
    const probe: Probe = { calls: [], restore: () => { handlers.set('dbark:request', original); } }; root.__specialIndexLiveProbe = probe;
    handlers.set('dbark:request', (event, payload) => {
      const command = payload?.command;
      if (typeof command === 'string' && (/^schema\.indexes\./.test(command) || command === 'query.execute')) probe.calls.push(command);
      return original(event, payload);
    });
  });
}
async function commands(): Promise<string[]> { return desktop.evaluate(() => (globalThis as ProbeGlobal).__specialIndexLiveProbe?.calls ?? []); }
async function applyCount(): Promise<number> { return (await commands()).filter(command => command === 'schema.indexes.apply').length; }
async function applyTasks(): Promise<number> { return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'schema.indexes.apply').length); }

/** 观察连接只建立自主夹具和独立断言，索引变更全部由真实产品面板发起。 */
async function fixture(context: LiveContext, table: string): Promise<void> {
  const [rows] = await context.observer.query<RowDataPacket[]>('SELECT VERSION() AS version');
  const version = String(rows[0].version), mysql8 = /^8\./.test(version) && !/mariadb/i.test(version);
  await context.observer.query(`CREATE TABLE ${target(context, table)} (id INT NOT NULL,a TEXT,b VARCHAR(40),g POINT NOT NULL${mysql8 ? ' SRID 0' : ''},g_nullable GEOMETRY,calc VARCHAR(40) GENERATED ALWAYS AS (lower(b)) STORED,PRIMARY KEY(id),KEY keep_b(b),KEY readonly_generated(calc)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  await context.observer.query(`INSERT INTO ${target(context, table)}(id,a,b,g,g_nullable) VALUES (1,'原文 alpha','FIRST',ST_GeomFromText('POINT(1 2)',0),NULL),(2,'原文 beta','SECOND',ST_GeomFromText('POINT(3 4)',0),NULL)`);
}
/** 真对象树打开表再打开IndexPatchDialog，不使用夹具按钮、直接引擎命令或React状态。 */
async function openTable(context: LiveContext, name: string): Promise<void> {
  const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: context.connectionName, exact: true }) });
  await connection.getByRole('button', { name: context.connectionName, exact: true }).focus(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  const object = connection.locator('.object-row').getByText(name, { exact: true });
  if (!(await object.isVisible())) await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click();
  await expect(object).toBeVisible(); await object.click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); await expect(tablePage().locator(':scope > .error-box')).toHaveCount(0);
}
async function openDialog(): Promise<void> {
  await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog().getByRole('button', { name: text.add, exact: true })).toBeEnabled();
}
/** 从真实字段选项取服务器引用；不在测试中制造columnRef。 */
function field(position: number): Locator { return dialog().getByRole('combobox', { name: `索引字段 ${position}`, exact: true }); }
function option(position: number, name: string): Locator { return field(position).locator('option').filter({ hasText: new RegExp(`^${name} ·`) }); }
/** 本版Playwright的启用/禁用匹配沿label转向select；JS属性断言直接检查原OPTION，避免误判父select。 */
async function expectOptionDisabled(position: number, name: string, disabled: boolean): Promise<void> {
  const candidate = option(position, name); await expect(candidate).toHaveCount(1);
  await expect(candidate).toHaveJSProperty('disabled', disabled);
  if (disabled) await expect(candidate).toHaveAttribute('disabled', '');
  else await expect(candidate).not.toHaveAttribute('disabled');
}
async function selectField(position: number, name: string): Promise<void> {
  const value = await option(position, name).getAttribute('value'); if (!value) throw new Error('真实字段选项不存在'); await field(position).selectOption(value);
}
async function ddl(context: LiveContext, table: string): Promise<string> { const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${target(context, table)}`); return String(rows[0]['Create Table']); }
async function indexes(context: LiveContext, table: string): Promise<RowDataPacket[]> { return (await context.observer.query<RowDataPacket[]>(`SHOW INDEX FROM ${target(context, table)}`))[0]; }
/** 空间值按原始WKB核对，避免界面格式化掩盖真实数据变化。 */
async function data(context: LiveContext, table: string): Promise<RowDataPacket[]> { return (await context.observer.query<RowDataPacket[]>(`SELECT id,a,b,HEX(g) AS geometry_bytes,HEX(g_nullable) AS nullable_bytes,calc FROM ${target(context, table)} ORDER BY id`))[0]; }

/** 预览前后独立查结构与数据，且实际apply调用及任务数量为预期值；风险确认逐项验证。 */
async function previewAndConfirm(context: LiveContext, table: string, expectedApplyCount: number, expectedSql: RegExp): Promise<void> {
  const before = await ddl(context, table), values = await data(context, table);
  await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  // 标题先于Monaco文本渲染；沿用默认断言期限等待真实DOM，不注入模型或延长超时。
  const sqlLines = dialog().locator('.monaco-editor .view-lines'); await expect(sqlLines).toContainText(expectedSql);
  const sql = (await sqlLines.innerText()).replace(/\u00a0/g, ' ');
  expect(sql).toMatch(expectedSql); expect(sql).not.toMatch(/USING\s+BTREE|\bASC\b|\bDESC\b/);
  expect(await ddl(context, table)).toBe(before); expect(await data(context, table)).toEqual(values);
  expect(await applyCount()).toBe(expectedApplyCount); expect(await applyTasks()).toBe(expectedApplyCount); expect((await commands()).filter(command => command === 'query.execute')).toEqual([]);
  expect((await commands()).filter(command => command === 'schema.indexes.preview')).toHaveLength(expectedApplyCount + 1);
  const apply = dialog().getByRole('button', { name: text.apply, exact: true }); await expect(apply).toBeDisabled();
  await expect(dialog().getByRole('checkbox')).toHaveCount(3); await expect(dialog().getByRole('checkbox', { name: text.ackUnique, exact: true })).toHaveCount(0);
  await dialog().getByRole('checkbox', { name: text.ackImplicit, exact: true }).check(); await dialog().getByRole('checkbox', { name: text.ackWindow, exact: true }).check(); await expect(apply).toBeDisabled();
  await dialog().getByRole('checkbox', { name: text.ackSpecial, exact: true }).check(); await expect(apply).toBeEnabled();
}
/** 复用隔离helper；异常时保存命令名，离开本例前恢复旁观包装。 */
async function withDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo): Promise<void> {
  await isolatedDatabase(async context => {
    let failure: unknown;
    try { await observeCommands(); await body(context); }
    catch (error) { failure = error; if (!closed) await info.attach('特殊索引实际命令名', { body: JSON.stringify(await commands()), contentType: 'application/json' }).catch(() => undefined); }
    finally {
      try { if (!closed) await desktop.evaluate(() => { const root = globalThis as ProbeGlobal; root.__specialIndexLiveProbe?.restore(); delete root.__specialIndexLiveProbe; }); }
      catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], '原UI验收错误与观察包装恢复错误均保留', { cause: failure }); }
    }
    if (failure !== undefined) throw failure;
  }, info);
}

test.describe('特殊索引真实产品面板验收准备', () => {
  test.skip(!authorized, '必须由ROOT同时开启总实库、特殊索引实库及专属UI开关；默认不启动GUI或连接私网'); test.setTimeout(120000);
  test.beforeEach(() => {
    const port = process.env.DBARK_SPECIAL_INDEX_TEST_PORT ?? environment.DBARK_TEST_PORT;
    if (environment.DBARK_TEST_HOST !== '192.168.31.200' || !port || !['13357', '13380', '13384', '13310', '13311', '13484'].includes(port)) throw new Error('只允许ROOT已核对的200六个隔离实例，不能自动替换连接目标');
    environment.DBARK_TEST_PORT = port;
  });
  for (const kind of ['fulltext', 'spatial'] as const) test(`${kind}类型切换、真实候选、零DDL预览、一次执行和删除`, async ({}, info) => {
    await withDatabase(async context => {
      const table = `ui_${kind}`, name = `live_${kind}`; await fixture(context, table); const originalData = await data(context, table), originalIndexes = (await indexes(context, table)).map(row => row.Key_name).sort();
      await openTable(context, table); await openDialog();
      const readonly = dialog().locator('.index-patch-item[aria-label="readonly_generated"]'); await expect(readonly).toContainText('生成');
      await expect(readonly.getByRole('button', { name: '编辑索引差异 readonly_generated', exact: true })).toBeDisabled(); await expect(readonly.getByRole('button', { name: '标记删除索引 readonly_generated', exact: true })).toBeDisabled();
      await dialog().getByRole('button', { name: text.add, exact: true }).click(); await selectField(1, 'b'); await dialog().getByRole('spinbutton', { name: '索引前缀长度 1', exact: true }).fill('3');
      await dialog().getByRole('button', { name: text.addPart, exact: true }).click(); await selectField(2, 'a'); await dialog().getByRole('spinbutton', { name: '索引前缀长度 2', exact: true }).fill('8');
      const kinds = dialog().getByRole('combobox', { name: text.kind, exact: true });
      await kinds.selectOption('spatial'); await expect(field(2)).toHaveCount(0); await expect(dialog().getByRole('textbox', { name: text.method, exact: true })).toHaveValue('RTREE');
      await expect(field(1)).toHaveValue((await option(1, 'g').getAttribute('value'))!);
      await expectOptionDisabled(1, 'g', false); for (const column of ['a', 'b', 'g_nullable', 'calc', 'id']) await expectOptionDisabled(1, column, true);
      await expect(dialog().getByRole('button', { name: text.addPart, exact: true })).toBeDisabled();
      await kinds.selectOption('fulltext'); await expect(dialog().getByRole('textbox', { name: text.method, exact: true })).toHaveValue('FULLTEXT');
      await expect(field(1)).toHaveValue((await option(1, 'a').getAttribute('value'))!);
      await expectOptionDisabled(1, 'a', false); await expectOptionDisabled(1, 'b', false); for (const column of ['g', 'g_nullable', 'calc', 'id']) await expectOptionDisabled(1, column, true);
      await expect(dialog().getByRole('spinbutton', { name: '索引前缀长度 1', exact: true })).toHaveValue(''); await expect(dialog().getByRole('spinbutton', { name: '索引前缀长度 1', exact: true })).toBeDisabled(); await expect(dialog().getByRole('combobox', { name: '索引方向 1', exact: true })).toBeDisabled();
      if (kind === 'spatial') await kinds.selectOption(kind);
      else { await dialog().getByRole('button', { name: text.addPart, exact: true }).click(); await selectField(2, 'b'); }
      await dialog().getByRole('textbox', { name: text.name, exact: true }).fill(name); await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill('面板特殊索引');
      await dialog().getByRole('button', { name: text.rowSave, exact: true }).click(); await expect(dialog().locator('.index-patch-editor')).toHaveCount(0);
      await previewAndConfirm(context, table, 0, kind === 'fulltext' ? /ADD\s+FULLTEXT\s+INDEX/ : /ADD\s+SPATIAL\s+INDEX/); await page.screenshot({ path: info.outputPath(`${kind}-real-panel-preview.png`) });
      await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await applyCount()).toBe(1); expect(await applyTasks()).toBe(1); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); await expect(dialog()).toContainText(text.consumed);
      const actual = (await indexes(context, table)).filter(row => row.Key_name === name).sort((a, b) => Number(a.Seq_in_index) - Number(b.Seq_in_index));
      expect(actual.map(row => row.Column_name)).toEqual(kind === 'fulltext' ? ['a', 'b'] : ['g']); for (const row of actual) { expect(String(row.Non_unique)).toBe('1'); expect(row.Index_type).toBe(kind === 'fulltext' ? 'FULLTEXT' : 'SPATIAL'); expect(row.Index_comment).toBe('面板特殊索引'); }
      expect(await data(context, table)).toEqual(originalData);
      await dialog().getByRole('button', { name: text.close, exact: true }).click(); await openDialog();
      const added = dialog().locator(`.index-patch-item[aria-label="${name}"]`); await expect(added.getByRole('button', { name: `编辑索引差异 ${name}`, exact: true })).toBeDisabled(); await expect(added).toContainText(/不改名|不能改名/);
      await added.getByText(text.original, { exact: true }).click(); await expect(added.locator('pre')).toContainText(kind === 'fulltext' ? 'FULLTEXT KEY' : 'SPATIAL KEY');
      await acceptNativeConfirmation(); await added.getByRole('button', { name: `标记删除索引 ${name}`, exact: true }).click();
      await previewAndConfirm(context, table, 1, /DROP\s+INDEX/); await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await applyCount()).toBe(2); expect(await applyTasks()).toBe(2); expect((await indexes(context, table)).map(row => row.Key_name).sort()).toEqual(originalIndexes); expect(await data(context, table)).toEqual(originalData);
      await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
});
