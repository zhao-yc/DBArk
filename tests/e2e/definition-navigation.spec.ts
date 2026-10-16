import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, page, desktop, closed } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, type LiveContext } from './definition-navigation-live';
import { assertDefaultEncodingLiveTarget } from '../helpers/tableDefaultEncodingTarget';
import { definitionNavigationZh as t } from '../../src/renderer/locales/definitionNavigation.zh-CN';

// ROOT独占新准备入口；默认关闭，不读取本地.env、不制造搜索/定义回包。
test.skip(!enabled, '需ROOT同时开启实库和DBARK_W03_DEFINITION_NAVIGATION_TEST');
test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(90000);
const searchDialog = () => page.getByRole('dialog', { name: '全库搜索：定义正文', exact: true });
const definition = () => page.getByRole('dialog', { name: /^查看.+ · / });
const navigation = () => definition().getByRole('region', { name: t.title, exact: true });
const target = (context: LiveContext, name: string) => `\`${context.database}\`.\`${name}\``;
type Observation = { commands: string[]; holdName?: string; held: boolean; delivered: boolean; release(): void; restore(): void };
type Main = typeof globalThis & { __definitionNavigationObserver?: Observation };

/** 只记录命令名；可延后一次真实metadata.ddl响应，不替换SQL、定义内容或认证结果。 */
async function observe() {
  await desktop.evaluate(({ ipcMain }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: { command: string; input?: { name?: string } }) => Promise<unknown>;
    const handlers = (ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'); if (!original) throw Error('缺少正式IPC处理器');
    let release = () => {}; const state: Observation = { commands: [], held: false, delivered: false, release() { release(); }, restore() { handlers.set('dbark:request', original); release(); } };
    (globalThis as Main).__definitionNavigationObserver = state;
    handlers.set('dbark:request', async (event, payload) => {
      if (state.commands.length >= 300) throw Error('定义导航命令观察超出预算'); state.commands.push(payload.command);
      const result = await original(event, payload);
      if (payload.command === 'metadata.ddl' && state.holdName === payload.input?.name) { state.holdName = undefined; state.held = true; await new Promise<void>(resolve => { release = resolve; }); state.delivered = true; }
      return result;
    });
  });
}
/** 本例准备完成后只允许读取；不把建库夹具或外部观察连接的显式DDL算成产品自动写入。 */
async function noWrites() {
  const commands = await desktop.evaluate(() => (globalThis as Main).__definitionNavigationObserver?.commands ?? []);
  expect(commands.filter(command => command.startsWith('schema.') || command === 'table.preview' || command === 'table.apply' || command.startsWith('query.') && !['query.cancel', 'query.sessionState', 'query.completionState'].includes(command))).toEqual([]);
}
/** 使用原随机库/真实连接表单；任何失败先恢复旁观器，再由既有夹具关闭并清理本例库。 */
async function database(body: (context: LiveContext) => Promise<void>, info: TestInfo) {
  await isolatedDatabase(async context => {
    // 用真实编辑器准备原查询草稿；等持久化正文快照就绪后才开始观察本次定位。
    const row = page.locator('.database-row').filter({ has: page.getByRole('button', { name: context.database, exact: true }) });
    await row.getByRole('button', { name: context.database, exact: true }).focus(); await row.getByRole('button', { name: '新建数据库查询', exact: true }).click();
    await page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus(); await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`); const draft = '-- 保留原草稿 😀\nSELECT 9007199254740993'; await page.keyboard.insertText(draft);
    // Monaco按平台保存行尾；仅准备草稿统一CRLF为LF，后续tabs/history仍逐字比较原始快照。
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs.find(tab => tab.kind === 'query')?.sql?.replaceAll('\r\n', '\n')).toBe(draft);
    const tabs = (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs, history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await observe();
    try { await body(context); await noWrites(); expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs).toEqual(tabs); expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history); }
    finally { if (!closed) await desktop.evaluate(() => { (globalThis as Main).__definitionNavigationObserver?.restore(); delete (globalThis as Main).__definitionNavigationObserver; }); }
  }, info);
}
/** 搜索与打开均走实际中文控件；不直接打开定义或传入制造的位置。 */
async function search(database: string, needle: string, mode = 'contains') {
  await page.locator('.app-commandbar').getByRole('button', { name: '全库搜索', exact: true }).click();
  await page.getByRole('dialog', { name: '全库搜索：结构名称', exact: true }).getByLabel('搜索内容', { exact: true }).selectOption('definition');
  await searchDialog().getByLabel('数据库范围（每行一个）', { exact: true }).fill(database); await searchDialog().getByLabel('搜索文字', { exact: true }).fill(needle); await searchDialog().getByLabel('匹配方式', { exact: true }).selectOption(mode);
  await searchDialog().getByRole('button', { name: '开始搜索', exact: true }).click(); await expect(searchDialog().getByRole('button', { name: '开始搜索', exact: true })).toBeEnabled({ timeout: 30000 }); await expect(searchDialog().locator('.error-box')).toHaveCount(0);
}
async function open(name: string) { await searchDialog().locator('.rdg-row').filter({ has: page.getByText(name, { exact: true }) }).click(); await searchDialog().getByRole('button', { name: '打开当前定义', exact: true }).click(); await expect(searchDialog()).toHaveCount(0); await expect(definition()).toBeVisible(); }
/** 独立从实际SHOW CREATE原文计算UTF16行列期望，不借产品导航状态反推位置。 */
function offsets(sql: string, needle: string) { const values: number[] = []; let at = sql.indexOf(needle); while (at >= 0) { values.push(at); at = sql.indexOf(needle, at + needle.length); } return values; }
function status(sql: string, offset: number, index: number, count: number) { const lines = sql.slice(0, offset).split(/\r\n|\r|\n/); return t.count(index, count) + t.position(lines.length, lines.at(-1)!.length + 1); }
async function ddl(context: LiveContext, name: string, kind = 'TABLE') { const [rows] = await context.observer.query<RowDataPacket[]>('SHOW CREATE ' + kind + ' ' + target(context, name)); const key = Object.keys(rows[0]).find(key => /^Create /.test(key))!; return String(rows[0][key]); }

test.beforeEach(({ trace }) => {
  if (trace !== 'off') throw Error('真实连接表单禁止记录trace');
  assertDefaultEncodingLiveTarget({ host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, tlsFlag: process.env.DBARK_TEST_TLS, caPath: process.env.DBARK_TEST_CA });
  if (!process.env.DBARK_TEST_USER || environment.DBARK_TEST_TLS !== process.env.DBARK_TEST_TLS || environment.DBARK_TEST_CA !== process.env.DBARK_TEST_CA) throw Error('必须显式指定既有测试账号和同一TLS/CA');
});

test('真实定义普通文字大小写/Unicode多处导航按精确行列定位，关闭后无SQL执行', async ({}, info) => {
  await database(async context => {
    await context.observer.query(`CREATE VIEW ${target(context, 'subject')} AS SELECT '😀 Marker' AS one, 'Marker' AS two, 'Marker' AS three`);
    const before = await ddl(context, 'subject', 'VIEW'), expected = offsets(before, 'Marker'); expect(expected).toHaveLength(3);
    const tabs = (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs;
    await search(context.database, 'mArKeR'); await open('subject'); await expect(navigation().getByRole('status')).toHaveText(status(before, expected[0], 0, 3));
    await navigation().getByRole('button', { name: t.next, exact: true }).click(); await expect(navigation().getByRole('status')).toHaveText(status(before, expected[1], 1, 3));
    await navigation().getByRole('button', { name: t.previous, exact: true }).click(); await navigation().getByRole('button', { name: t.previous, exact: true }).click(); await expect(navigation().getByRole('status')).toHaveText(status(before, expected[2], 2, 3));
    await expect(definition().locator('.definition-match-active').first()).toBeVisible(); const displayed = await definition().locator('.monaco-editor .view-lines').textContent(); await page.keyboard.insertText('不可修改'); expect(await definition().locator('.monaco-editor .view-lines').textContent()).toBe(displayed);
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Enter`); await navigation().getByRole('button', { name: t.close, exact: true }).click(); await expect(navigation()).toHaveCount(0); await expect(definition().locator('.definition-match')).toHaveCount(0); await expect(definition().getByRole('button', { name: '执行 SQL', exact: true })).toHaveCount(0);
    expect(await ddl(context, 'subject', 'VIEW')).toBe(before); expect((await page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs).toEqual(tabs);
  }, info);
});
for (const count of [200, 201]) test(`真实${count}处边界包含额外探测，导航只在前200处循环`, async ({}, info) => {
  await database(async context => {
    await context.observer.query(`CREATE TABLE ${target(context, 'subject')}(id INT) COMMENT='${'NavMark '.repeat(count)}'`); const before = await ddl(context, 'subject'), expected = offsets(before, 'NavMark'); expect(expected).toHaveLength(count);
    await search(context.database, 'NavMark'); await open('subject'); await expect(navigation().getByRole('status')).toHaveText(status(before, expected[0], 0, 200)); await expect(navigation()).toContainText(count === 201 ? t.capped(200) : t.complete);
    await navigation().getByRole('button', { name: t.previous, exact: true }).click(); await expect(navigation().getByRole('status')).toHaveText(status(before, expected[199], 199, 200)); expect(await ddl(context, 'subject')).toBe(before);
  }, info);
});
for (const change of ['定义变化', '读取失败']) test(`搜索后${change}整组失效，不沿用旧计数或执行定义`, async ({}, info) => {
  await database(async context => {
    await context.observer.query(`CREATE TABLE ${target(context, 'subject')}(id INT) COMMENT='NavMark'`); await search(context.database, 'NavMark');
    if (change === '定义变化') await context.observer.query(`ALTER TABLE ${target(context, 'subject')} COMMENT='NavMark changed'`); else await context.observer.query('DROP TABLE ' + target(context, 'subject'));
    await open('subject'); await expect(definition().getByRole('status')).toHaveText(change === '定义变化' ? t.invalid : t.failed); await expect(navigation()).toHaveCount(0); await expect(definition().locator('.definition-match')).toHaveCount(0);
    if (change === '定义变化') await expect(definition().locator('.monaco-editor .view-lines')).toContainText('changed'); else await expect(definition().locator('.monaco-editor')).toHaveCount(0);
  }, info);
});
test('服务器正则只显示真实当前定义和明确降级，不伪称零处或复制JS正则结果', async ({}, info) => {
  await database(async context => { await context.observer.query(`CREATE TABLE ${target(context, 'subject')}(id INT) COMMENT='NavMark'`); await search(context.database, 'NavM.rk', 'regexp'); await open('subject'); await expect(definition().getByRole('status')).toHaveText(t.unavailable); await expect(navigation()).toHaveCount(0); await expect(definition().locator('.monaco-editor .view-lines')).toContainText('NavMark'); }, info);
});
test('延迟真实定义回包后关闭并打开另一对象，旧回包不覆盖新正文、URI或计数', async ({}, info) => {
  await database(async context => {
    for (const name of ['first', 'second']) await context.observer.query(`CREATE TABLE ${target(context, name)}(id INT) COMMENT='NavMark ${name}'`);
    await desktop.evaluate(() => { (globalThis as Main).__definitionNavigationObserver!.holdName = 'first'; }); await search(context.database, 'NavMark'); await open('first');
    await expect.poll(() => desktop.evaluate(() => (globalThis as Main).__definitionNavigationObserver?.held)).toBe(true); await definition().getByRole('button', { name: '取消', exact: true }).click();
    await search(context.database, 'NavMark'); await open('second'); const source = await ddl(context, 'second'); await expect(navigation().getByRole('status')).toHaveText(status(source, offsets(source, 'NavMark')[0], 0, 1));
    await desktop.evaluate(() => (globalThis as Main).__definitionNavigationObserver?.release()); await expect.poll(() => desktop.evaluate(() => (globalThis as Main).__definitionNavigationObserver?.delivered)).toBe(true);
    // 旧真实回包释放后再完成一次renderer IPC读取，随后核对当前对象及位置。
    await page.evaluate(() => window.dbark.invoke('settings.get', {})); await expect(definition().locator('.monaco-editor .view-lines')).toContainText('second'); await expect(navigation().getByRole('status')).toHaveText(status(source, offsets(source, 'NavMark')[0], 0, 1));
  }, info);
});
test('真实CRLF正文按服务器原文分类：可无损时精确导航，混合行尾规范化时明确降级', async ({}, info) => {
  await database(async context => {
    // 此实例原生例程正文拒绝非BMP；真实非BMP位置仍由首项VIEW验证，此处保留CRLF分类与精确期待。
    await context.observer.query(`CREATE PROCEDURE ${target(context, 'subject')}() BEGIN\r\n-- 中文 Marker\r\nSELECT 'Marker';\r\nEND`); const before = await ddl(context, 'subject', 'PROCEDURE'), mixed = /\r\n/.test(before) && /(^|[^\r])\n/.test(before), expected = offsets(before, 'Marker');
    await search(context.database, 'Marker'); await open('subject');
    if (mixed) { await expect(navigation().getByRole('status')).toHaveText(t.unlocatable); await expect(navigation().getByRole('button', { name: t.next, exact: true })).toHaveCount(0); await expect(definition().locator('.definition-match')).toHaveCount(0); }
    else await expect(navigation().getByRole('status')).toHaveText(status(before, expected[0], 0, expected.length));
    expect(await ddl(context, 'subject', 'PROCEDURE')).toBe(before); console.info(JSON.stringify({ 定义导航端口: process.env.DBARK_TEST_PORT, 服务器原文混合行尾: mixed, 原文标记数量: expected.length }));
  }, info);
});
