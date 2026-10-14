import type { RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import type { TaskEvent } from '../../src/shared/contracts';
import { indexPatchZh as text } from '../../src/renderer/locales/indexPatches.zh-CN';
import { test, expect, page, desktop, answerDialogs, requestQuit, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, modifier, type LiveContext } from './live-helpers';
test.use({ trace: 'off' });
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
type ObservedWindow = Window & { __indexEvents?: TaskEvent[] };
/** 真对象树打开表，不注入 React 状态或模拟结构服务。 */
async function openTable(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await connection.getByRole('button', { name: '刷新连接', exact: true }).click();
  await connection.locator('.database-row').getByRole('button', { name: context.database, exact: true }).click(); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); await expect(tablePage().locator(':scope > .error-box')).toHaveCount(0);
  return connection;
}
/** 只读取本例实际表定义，核对预览没有偷偷执行 DDL。 */
async function ddl(context: LiveContext, name: string): Promise<string> { const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${target(context, name)}`); return String(rows[0]['Create Table']); }
async function tasks() { return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'schema.indexes.apply')); }
/** 独立保存失败事实，不能用错误文案替代真实任务进度。 */
async function indexDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    try { await body(context); }
    catch (error) {
      if (!closed) await info.attach('索引失败原始状态', { body: JSON.stringify({ errors: await dialog().locator('.error-box').allTextContents(), status: await dialog().locator('.index-patch-state').allTextContents(), tasks: await tasks(), events: await page.evaluate(() => (window as ObservedWindow).__indexEvents ?? []) }, null, 2), contentType: 'application/json' });
      throw error;
    }
  }, info);
}
/** 风险确认只操作真实中文复选框，不向应用注入确认 ID。 */
async function preview() {
  await dialog().getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  const checks = dialog().getByRole('checkbox'); for (let index = 0; index < await checks.count(); index++) await checks.nth(index).check();
  await expect(dialog()).not.toContainText('ddl-implicit-commit'); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeEnabled();
}
/** 全部输入来自真实表单；不借 IPC 替代编辑器生成草稿。 */
async function edit(name: string) { await dialog().getByRole('button', { name: `编辑索引差异 ${name}`, exact: true }).click(); await expect(dialog().locator('.index-patch-editor')).toBeVisible(); }
async function save() { await dialog().getByRole('button', { name: text.rowSave, exact: true }).click(); await expect(dialog().locator('.index-patch-editor')).toHaveCount(0); }
/** 从真实选项读取不透明字段引用，适应服务端保留整数显示宽度的版本差异。 */
async function selectColumn(position: number, name: string) {
  const select = dialog().getByRole('combobox', { name: `索引字段 ${position}`, exact: true });
  const value = await select.locator('option').filter({ hasText: new RegExp(`^${name} ·`) }).getAttribute('value');
  if (!value) throw new Error('缺少真实字段选项'); await select.selectOption(value);
}
async function openDialog() { await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog().getByRole('button', { name: text.add, exact: true })).toBeEnabled(); }

test.describe('索引与主键差异：真实 Electron 和数据库', () => {
  test.skip(!enabled, '未显式授权 200 隔离数据库验收'); test.setTimeout(120000);
  test.beforeEach(async () => {
    environment.DBARK_TEST_HOST = '192.168.31.200'; environment.DBARK_TEST_PORT = process.env.DBARK_COLUMN_PATCH_TEST_PORT ?? '13384';
    if (!['13357', '13380', '13384', '13310', '13311'].includes(environment.DBARK_TEST_PORT)) throw new Error('拒绝访问未授权实例');
    await page.evaluate(() => { const current = window as ObservedWindow; current.__indexEvents = []; window.dbark.onTask(event => { if (event.indexPatch) current.__indexEvents!.push(event); }); });
  });
  test('对象树和表页两入口、只读预览零 DDL、双击只改名一次', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_once'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a VARCHAR(40),PRIMARY KEY(id),KEY ia(a(8)) COMMENT '原索引注释') ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
      const connection = await openTable(context, name), row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }); await row.hover(); await row.getByRole('button', { name: `${text.title} ${name}`, exact: true }).click();
      await expect(dialog().getByRole('button', { name: '编辑索引差异 ia', exact: true })).toBeEnabled(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); await openDialog();
      await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('中文`索引'); await save(); const before = await ddl(context, name); await preview(); expect(await ddl(context, name)).toBe(before);
      await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('RENAME INDEX'); await expect(dialog().locator('.monaco-editor .view-lines')).not.toContainText('DROP INDEX');
      await dialog().locator('.monaco-editor').getByRole('textbox').focus(); await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`); expect(await tasks()).toHaveLength(0); expect(await ddl(context, name)).toBe(before);
      await page.screenshot({ path: info.outputPath('index-preview.png') }); await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await tasks()).toHaveLength(1); expect(await ddl(context, name)).toContain('KEY `中文``索引` (`a`(8))'); expect(await ddl(context, name)).toContain("COMMENT '原索引注释'"); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
    }, info);
  });
  test('新增复合键支持列引用、清空可选前缀及移动顺序', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_composite'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a VARCHAR(40),bytes VARBINARY(50),PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await openTable(context, name); await openDialog();
      await dialog().getByRole('button', { name: text.add, exact: true }).click(); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('ix');
      await selectColumn(1, 'a'); const prefix = dialog().getByRole('spinbutton', { name: '索引前缀长度 1', exact: true }); await prefix.fill('3'); await prefix.fill('');
      await dialog().getByRole('button', { name: text.addPart, exact: true }).click(); await selectColumn(2, 'bytes'); await dialog().getByRole('spinbutton', { name: '索引前缀长度 2', exact: true }).fill('4');
      await dialog().getByRole('button', { name: '上移索引字段 2', exact: true }).click(); await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill("复合'注释\\末"); await save(); await preview(); await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW INDEX FROM ${target(context, name)} WHERE Key_name='ix'`); expect(rows.map(row => [row.Column_name, row.Sub_part === null ? null : String(row.Sub_part)])).toEqual([['bytes', '4'], ['a', null]]);
    }, info);
  });
  test('同目标数据草稿阻止索引入口，草稿内容保留', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_dirty'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT PRIMARY KEY,a VARCHAR(40)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,'old')`); await openTable(context, name);
      const header = tablePage().getByRole('columnheader', { name: /^a/ }), column = await header.getAttribute('aria-colindex'), cell = tablePage().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${column}"]`); await cell.dblclick(); const input = tablePage().getByRole('textbox', { name: '编辑 a', exact: true }); await input.fill('未提交草稿'); await input.press('Enter');
      await tablePage().getByRole('button', { name: text.title, exact: true }).click(); await expect(dialog()).toHaveCount(0); await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataDirty); await expect(cell).toContainText('未提交草稿');
    }, info);
  });
  test('删除主键与唯一键集中确认，完成后真实表页重新判断只读', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_keys'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT NOT NULL,PRIMARY KEY(id),UNIQUE KEY ua(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,10)`); await openTable(context, name); await openDialog(); await acceptNativeConfirmation();
      await dialog().getByRole('button', { name: '标记删除索引 PRIMARY', exact: true }).click(); await dialog().getByRole('button', { name: '标记删除索引 ua', exact: true }).click(); await preview(); await expect(dialog().getByRole('checkbox', { name: text.ackPrimary, exact: true })).toBeChecked(); await expect(dialog().getByRole('checkbox', { name: text.ackUnique, exact: true })).toBeChecked();
      await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 }); await dialog().getByRole('button', { name: text.close, exact: true }).click();
      await expect(tablePage().getByRole('button', { name: '新增', exact: true })).toBeDisabled(); await expect(tablePage()).toContainText('只读');
    }, info);
  });
  test('真实重复值失败消费一次性预览，不重放并使目标页过期', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_duplicate'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,7),(2,7)`); await openTable(context, name); await openDialog(); await dialog().getByRole('button', { name: text.add, exact: true }).click(); await dialog().getByRole('combobox', { name: text.kind, exact: true }).selectOption('unique'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('ua'); await selectColumn(1, 'a'); await save(); await preview(); const original = await ddl(context, name);
      await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect(dialog().locator('.error-box')).toBeVisible({ timeout: 30000 }); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); expect(await tasks()).toHaveLength(1); expect(await ddl(context, name)).toBe(original);
      await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click(); await expect(tablePage()).toContainText('页面已过期');
    }, info);
  });
  test('真实锁阻塞时取消等待服务器终态和清理，原索引不丢失', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_cancel'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await openTable(context, name); await openDialog(); await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('cancelled'); await save(); await preview();
      await context.observer.query(`LOCK TABLES ${target(context, name)} READ`);
      try {
        await dialog().getByRole('button', { name: text.apply, exact: true }).click(); await expect.poll(async () => { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'); return rows.some(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(context.database) && /metadata lock/i.test(String(row.State))); }, { timeout: 15000 }).toBe(true);
        await dialog().getByRole('button', { name: text.cancel, exact: true }).click(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 15000 }); expect((await tasks())[0].status).toBe('cancelled');
      } finally { await context.observer.query('UNLOCK TABLES'); }
      expect(await ddl(context, name)).toContain('KEY `ia`'); await acceptNativeConfirmation(); await dialog().getByRole('button', { name: text.close, exact: true }).click();
    }, info);
  });
  test('未保存的索引行输入也参与应用退出草稿保护', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_exit'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await openTable(context, name); await openDialog(); await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('未保存输入');
      await answerDialogs([0]); await requestQuit(); await expect.poll(async () => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBeGreaterThan(0); expect(closed).toBe(false); await expect(dialog().getByRole('textbox', { name: text.name, exact: true })).toHaveValue('未保存输入');
    }, info);
  });
});
