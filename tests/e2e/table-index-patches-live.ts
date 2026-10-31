import { clickSidebarAction } from './sidebar-menu';
import type { RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import type { TaskEvent } from '../../src/shared/contracts';
import { indexPatchZh as text } from '../../src/renderer/locales/indexPatches.zh-CN';
import { test, expect, page, desktop, answerDialogs, requestQuit, closed } from './desktop-fixture';
import { environment, isolatedDatabase, acceptNativeConfirmation, modifier, type LiveContext } from './live-helpers';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const dialog = () => page.getByRole('dialog', { name: text.title, exact: true });
const tablePage = () => page.locator('.table-tab:visible');
const target = (context: LiveContext, table: string) => `\`${context.database}\`.\`${table}\``;
type ObservedWindow = Window & { __indexEvents?: TaskEvent[] };
const versions: Record<string, string> = { '13357': '5.7.44', '13380': '8.0.46', '13384': '8.4.11', '13310': '10.11.19', '13311': '11.4.13', '13484': '8.4.11' };
/** 沿用六组合纯目标/TLS门，不覆盖主机、默认端口或降级证书校验。 */
function liveTarget() {
  const input = { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA };
  assertDefaultEncodingLiveTarget(input);
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_CA'] as const) {
    if (process.env[key] !== environment[key]) throw Error('原始环境与实跑目标不一致：' + key);
  }
  return input;
}

/** 只旁观索引请求的令牌和任务号，完整透传原IPC；不记录连接表单或认证内容。 */
async function observeIndexRequests(): Promise<void> {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: { previewToken?: string; taskId?: string } }) => unknown;
    type Probe = { calls: { command: string; token?: string; taskId?: string }[]; restore(): void };
    const root = globalThis as typeof globalThis & { __indexRenameProbe?: Probe };
    if (root.__indexRenameProbe) throw Error('索引观察器不能覆盖其它任务');
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers.get('dbark:request'); if (!original) throw Error('缺少真实IPC入口');
    root.__indexRenameProbe = { calls: [], restore: () => handlers.set('dbark:request', original) };
    handlers.set('dbark:request', (event, payload) => {
      if (payload.command === 'schema.indexes.apply') root.__indexRenameProbe!.calls.push({ command: payload.command, token: payload.input?.previewToken, taskId: payload.input?.taskId });
      return original(event, payload);
    });
  });
}
/** 只返回一次性执行的数量与身份是否齐全，不将原始令牌写入公共诊断。 */
async function requestSummary() {
  return desktop.evaluate(() => {
    const calls = (globalThis as typeof globalThis & { __indexRenameProbe?: { calls: { token?: string; taskId?: string }[] } }).__indexRenameProbe?.calls ?? [];
    return { count: calls.length, identified: calls.every(call => typeof call.token === 'string' && !!call.token && typeof call.taskId === 'string' && !!call.taskId) };
  });
}
/** 按稳定语义采集索引；统计基数是优化器估计，不纳入结构等值，数据原值另作完整比较。 */
async function renameSnapshot(context: LiveContext, name: string) {
  const [indexes] = await context.observer.query<RowDataPacket[]>('SHOW INDEX FROM ' + target(context, name));
  const fields = ['Key_name', 'Non_unique', 'Seq_in_index', 'Column_name', 'Collation', 'Sub_part', 'Index_type', 'Comment', 'Index_comment', 'Visible', 'Ignored', 'Expression'];
  const indexRows = indexes.map(row => Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])))
    .sort((left, right) => String(left.Key_name).localeCompare(String(right.Key_name)) || Number(left.Seq_in_index) - Number(right.Seq_in_index));
  const [rows] = await context.observer.query<RowDataPacket[]>(`SELECT id,a,b,HEX(payload) AS payload FROM ${target(context, name)} ORDER BY id`);
  return { ddl: await ddl(context, name), indexes: indexRows, rows };
}
/** 普通复合BTREE是唯一操作目标；唯一旁键、不可见/忽略旁键及精确数据用于保持断言。 */
async function renameFixture(context: LiveContext, name: string): Promise<void> {
  const port = environment.DBARK_TEST_PORT!, mysql8 = ['13380', '13384', '13484'].includes(port), maria = ['13310', '13311'].includes(port);
  const direction = port === '13357' ? '' : ' DESC';
  const hidden = mysql8 ? ',KEY hidden_a(a) INVISIBLE' : maria ? ',KEY hidden_a(a) IGNORED' : '';
  await context.observer.query(`CREATE TABLE ${target(context, name)}(id BIGINT NOT NULL,a VARCHAR(40) NOT NULL,b INT NOT NULL,payload VARBINARY(20),PRIMARY KEY(id),KEY ia(a(8),b${direction}) COMMENT '原索引注释',UNIQUE KEY keep_unique(b),KEY keep_pair(id,a)${hidden}) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`);
  await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,'中文abcdefgh',11,X'00FF'),(9007199254740993,'第二行xyz',22,X'000102')`);
}
/** 终态事件必须来自同一真实apply任务；只断言进度事实，不制造成功或失败。 */
async function lastApplyEvent() {
  const currentTasks = await tasks(); expect(currentTasks).toHaveLength(1);
  const events = await page.evaluate(() => (window as ObservedWindow).__indexEvents ?? []);
  const matches = events.filter(event => event.taskId === currentTasks[0].id);
  expect(matches.length).toBeGreaterThan(0); return matches.at(-1)!;
}
/** 真对象树打开表，不注入 React 状态或模拟结构服务。 */
async function openTable(context: LiveContext, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(context.connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover(); await clickSidebarAction(connection, { name: '刷新连接', exact: true });
  await (await (await import('./navigation-menu')).navigationMenuItem(connection.locator('.database-row'), { name: context.database, exact: true })).click(); await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(tablePage().locator('.context-bar')).toContainText(name); await expect(tablePage().locator('.loading-overlay')).toHaveCount(0); await expect(tablePage().locator(':scope > .error-box')).toHaveCount(0);
  return connection;
}
/** 只读取本例实际表定义，核对预览没有偷偷执行 DDL。 */
async function ddl(context: LiveContext, name: string): Promise<string> { const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW CREATE TABLE ${target(context, name)}`); return String(rows[0]['Create Table']); }
async function tasks() { return page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'schema.indexes.apply')); }
/** 独立保存失败事实，不能用错误文案替代真实任务进度。 */
async function indexDatabase(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  const input = liveTarget();
  await isolatedDatabase(async context => {
    const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })));
    const profile = profiles.find(profile => profile.id === context.connectionId); if (!profile) throw Error('缺少本例实际保存连接');
    assertDefaultEncodingLiveTarget(input, profile);
    const [actual] = await context.observer.query<RowDataPacket[]>('SELECT @@version AS version');
    const version = String(actual[0].version);
    expect(version.split(/[-+]/)[0]).toBe(versions[input.port!]);
    expect(/mariadb/i.test(version)).toBe(['13310', '13311'].includes(input.port!));
    if (input.tlsFlag === '1') { const [tls] = await context.observer.query<RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'"); expect(tls[0]?.Value).toBeTruthy(); }
    await observeIndexRequests();
    try { await body(context); }
    catch (error) {
      if (!closed) await info.attach('索引失败原始状态', { body: JSON.stringify({ errors: await dialog().locator('.error-box').allTextContents(), status: await dialog().locator('.index-patch-state').allTextContents(), tasks: await tasks(), events: await page.evaluate(() => (window as ObservedWindow).__indexEvents ?? []) }, null, 2), contentType: 'application/json' });
      throw error;
    }
    finally {
      if (!closed) await desktop.evaluate(() => { const root = globalThis as typeof globalThis & { __indexRenameProbe?: { restore(): void } }; root.__indexRenameProbe?.restore(); delete root.__indexRenameProbe; });
    }
  }, info);
}
/** 风险确认只操作真实中文复选框，不向应用注入确认 ID。 */
async function preview() {
  await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.preview, exact: true })).click(); await expect(dialog().getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible();
  const checks = dialog().getByRole('checkbox'); for (let index = 0; index < await checks.count(); index++) await checks.nth(index).check();
  await expect(dialog()).not.toContainText('ddl-implicit-commit'); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeEnabled();
}
/** 全部输入来自真实表单；不借 IPC 替代编辑器生成草稿。 */
async function edit(name: string) { await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: `编辑索引差异 ${name}`, exact: true })).click(); await expect(dialog().locator('.index-patch-editor')).toBeVisible(); }
async function save() { await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.rowSave, exact: true })).click(); await expect(dialog().locator('.index-patch-editor')).toHaveCount(0); }
/** 从真实选项读取不透明字段引用，适应服务端保留整数显示宽度的版本差异。 */
async function selectColumn(position: number, name: string) {
  const select = dialog().getByRole('combobox', { name: `索引字段 ${position}`, exact: true });
  const value = await select.locator('option').filter({ hasText: new RegExp(`^${name} ·`) }).getAttribute('value');
  if (!value) throw new Error('缺少真实字段选项'); await select.selectOption(value);
}
async function openDialog() { await (await (await import('./navigation-menu')).navigationMenuItem(tablePage(), { name: text.title, exact: true })).click(); await expect(dialog().getByRole('button', { name: text.add, exact: true })).toBeEnabled(); }

/** 只由双门入口注册；本片只准备六组合定义，实际执行和资源核对由统筹另行安排。 */
export function registerTableIndexPatchUiTests() {
liveTarget();
test.describe('索引与主键差异：真实 Electron 和数据库', () => {
  test.setTimeout(120000);
  test.beforeEach(async () => {
    liveTarget();
    await page.evaluate(() => { const current = window as ObservedWindow; current.__indexEvents = []; window.dbark.onTask(event => { if (event.indexPatch) current.__indexEvents!.push(event); }); });
  });
  test('对象树和表页两入口、只读预览零 DDL、双击只改名一次', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_once'; await renameFixture(context, name); const original = await renameSnapshot(context, name);
      const connection = await openTable(context, name), row = connection.locator('.object-row').filter({ has: page.getByText(name, { exact: true }) }); await row.hover(); await clickSidebarAction(row, { name: `${text.title} ${name}`, exact: true });
      await expect(dialog().getByRole('button', { name: '编辑索引差异 ia', exact: true })).toBeEnabled(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await openDialog();
      // PRIMARY名称固定；不可见/忽略索引只能保留，不能借普通改名入口变更。
      await edit('PRIMARY'); await expect(dialog().getByRole('textbox', { name: text.name, exact: true })).toBeDisabled(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.editorCancel, exact: true })).click();
      if (environment.DBARK_TEST_PORT !== '13357') await expect(dialog().getByRole('button', { name: '编辑索引差异 hidden_a', exact: true })).toBeDisabled();
      await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('中文`索引'); await save(); const before = await ddl(context, name); await preview(); expect(await ddl(context, name)).toBe(before);
      await expect(dialog().locator('.monaco-editor .view-lines')).toContainText('RENAME INDEX'); await expect(dialog().locator('.monaco-editor .view-lines')).not.toContainText('DROP INDEX');
      await dialog().locator('.monaco-editor').getByRole('textbox').focus(); await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`); expect(await tasks()).toHaveLength(0); expect(await ddl(context, name)).toBe(before);
      await page.screenshot({ path: info.outputPath('index-preview.png') }); await dialog().getByRole('button', { name: text.apply, exact: true }).dblclick(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      expect(await requestSummary()).toEqual({ count: 1, identified: true }); expect(await tasks()).toHaveLength(1);
      const after = await renameSnapshot(context, name);
      expect(after.ddl).toBe(original.ddl.replace('KEY `ia`', 'KEY `中文``索引`'));
      const renamed = original.indexes.map<Record<string, unknown>>(row => ({ ...row, Key_name: row.Key_name === 'ia' ? '中文`索引' : row.Key_name })).sort((left, right) => String(left.Key_name).localeCompare(String(right.Key_name)) || Number(left.Seq_in_index) - Number(right.Seq_in_index));
      expect(after.indexes).toStrictEqual(renamed); expect(after.rows).toStrictEqual(original.rows);
      expect([1, '1']).toContain(after.indexes.find(row => row.Key_name === '中文`索引')?.Non_unique);
      expect([0, '0']).toContain(after.indexes.find(row => row.Key_name === 'keep_unique')?.Non_unique);
      expect((await lastApplyEvent()).indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
      await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
    }, info);
  });
  test('新增复合键支持列引用、清空可选前缀及移动顺序', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_composite'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a VARCHAR(40),bytes VARBINARY(50),PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await openTable(context, name); await openDialog();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.add, exact: true })).click(); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('ix');
      await selectColumn(1, 'a'); const prefix = dialog().getByRole('spinbutton', { name: '索引前缀长度 1', exact: true }); await prefix.fill('3'); await prefix.fill('');
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.addPart, exact: true })).click(); await selectColumn(2, 'bytes'); await dialog().getByRole('spinbutton', { name: '索引前缀长度 2', exact: true }).fill('4');
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '上移索引字段 2', exact: true })).click(); await dialog().getByRole('textbox', { name: text.comment, exact: true }).fill("复合'注释\\末"); await save(); await preview(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });
      const [rows] = await context.observer.query<RowDataPacket[]>(`SHOW INDEX FROM ${target(context, name)} WHERE Key_name='ix'`); expect(rows.map(row => [row.Column_name, row.Sub_part === null ? null : String(row.Sub_part)])).toEqual([['bytes', '4'], ['a', null]]);
    }, info);
  });
  test('同目标数据草稿阻止索引入口，草稿内容保留', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_dirty'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT PRIMARY KEY,a VARCHAR(40)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,'old')`); await openTable(context, name);
      const header = tablePage().getByRole('columnheader', { name: /^a/ }), column = await header.getAttribute('aria-colindex'), cell = tablePage().locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${column}"]`); await cell.dblclick(); const input = tablePage().getByRole('textbox', { name: '编辑 a', exact: true }); await input.fill('未提交草稿'); await input.press('Enter');
      await (await (await import('./navigation-menu')).navigationMenuItem(tablePage(), { name: text.title, exact: true })).click(); await expect(dialog()).toHaveCount(0); await expect(page.locator('.toast[role="alert"]')).toContainText(text.dataDirty); await expect(cell).toContainText('未提交草稿');
    }, info);
  });
  test('删除主键与唯一键集中确认，完成后真实表页重新判断只读', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_keys'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT NOT NULL,PRIMARY KEY(id),UNIQUE KEY ua(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,10)`); await openTable(context, name); await openDialog(); await acceptNativeConfirmation();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '标记删除索引 PRIMARY', exact: true })).click(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '标记删除索引 ua', exact: true })).click(); await preview(); await expect(dialog().getByRole('checkbox', { name: text.ackPrimary, exact: true })).toBeChecked(); await expect(dialog().getByRole('checkbox', { name: text.ackUnique, exact: true })).toBeChecked();
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().getByRole('status')).toContainText(text.succeeded, { timeout: 30000 }); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click();
      await expect(tablePage().getByRole('button', { name: '新增', exact: true })).toBeDisabled(); await expect(tablePage()).toContainText('只读');
    }, info);
  });
  test('真实重复值失败消费一次性预览，不重放并使目标页过期', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_duplicate'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT,PRIMARY KEY(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await context.observer.query(`INSERT INTO ${target(context, name)} VALUES(1,7),(2,7)`); await openTable(context, name); await openDialog(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.add, exact: true })).click(); await dialog().getByRole('combobox', { name: text.kind, exact: true }).selectOption('unique'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('ua'); await selectColumn(1, 'a'); await save(); await preview(); const original = await ddl(context, name);
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().locator('.error-box')).toBeVisible({ timeout: 30000 }); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); expect(await tasks()).toHaveLength(1); expect(await ddl(context, name)).toBe(original);
      await acceptNativeConfirmation(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await expect(tablePage()).toContainText('页面已过期');
    }, info);
  });
  test('真实锁阻塞时取消等待服务器终态和清理，原索引不丢失', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_cancel'; await renameFixture(context, name); const original = await renameSnapshot(context, name); await openTable(context, name); await openDialog(); await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('cancelled'); await save(); await preview();
      await context.observer.query(`LOCK TABLES ${target(context, name)} READ`);
      try {
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect.poll(async () => { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'); return rows.some(row => typeof row.Info === 'string' && row.Info.startsWith('ALTER TABLE') && row.Info.includes(context.database) && /metadata lock/i.test(String(row.State))); }, { timeout: 15000 }).toBe(true);
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.cancel, exact: true })).click(); await expect(dialog().getByRole('button', { name: text.read, exact: true })).toBeEnabled({ timeout: 15000 }); expect((await tasks())[0].status).toBe('cancelled');
        expect((await lastApplyEvent()).indexPatch).toMatchObject({ ddlSubmitted: true, ddlCompleted: false, definitionVerified: false, outcome: 'unknown' });
        await expect(dialog().getByRole('status')).toContainText(text.unknown); await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled();
      } finally { await context.observer.query('UNLOCK TABLES'); }
      expect(await renameSnapshot(context, name)).toStrictEqual(original); expect(await requestSummary()).toEqual({ count: 1, identified: true });
      await acceptNativeConfirmation(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.close, exact: true })).click(); await expect(tablePage()).toContainText('页面已过期'); expect(await tasks()).toHaveLength(1);
    }, info);
  });
  test('未保存的索引行输入也参与应用退出草稿保护', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_exit'; await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT NOT NULL,a INT,PRIMARY KEY(id),KEY ia(a)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC`); await openTable(context, name); await openDialog(); await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('未保存输入');
      await answerDialogs([0]); await requestQuit(); await expect.poll(async () => desktop.evaluate(() => globalThis.__dbarkE2EDialogs.calls.length)).toBeGreaterThan(0); expect(closed).toBe(false); await expect(dialog().getByRole('textbox', { name: text.name, exact: true })).toHaveValue('未保存输入');
    }, info);
  });
  test('改名预览后外部结构变化拒绝旧令牌，保留外部修改与全部数据且不重放', async ({}, info) => {
    await indexDatabase(async context => {
      const name = 'index_concurrent'; await renameFixture(context, name); await openTable(context, name); await openDialog();
      await edit('ia'); await dialog().getByRole('textbox', { name: text.name, exact: true }).fill('stale_name'); await save(); await preview();
      // 观察连接只制造一次明确的外部DDL，产品操作仍由原预览的真实确认按钮发起。
      await context.observer.query(`ALTER TABLE ${target(context, name)} COMMENT='外部并发修改'`); const external = await renameSnapshot(context, name);
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: text.apply, exact: true })).click(); await expect(dialog().locator('.error-box')).toContainText('变化', { timeout: 15000 });
      await expect(dialog().getByRole('button', { name: text.apply, exact: true })).toBeDisabled(); await expect(dialog().getByRole('status')).toContainText(text.notSent);
      expect((await lastApplyEvent()).indexPatch).toMatchObject({ ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' });
      expect(await renameSnapshot(context, name)).toStrictEqual(external); expect(await requestSummary()).toEqual({ count: 1, identified: true });
    }, info);
  });
});
}
