import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';

// 列表与默认关闭时不加载桌面owner，更不导入实库、凭据或剪贴板帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_QUERY_DUPLICATE_NATIVE_TEST === '1';
if (active) {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || Object.keys(process.env).some(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key))) throw Error('查询复制原生专项只允许独立离线进程及integration=0');
  for (const [index, value] of process.argv.entries()) {
    if ((value === '--trace' && process.argv[index + 1] !== 'off') || (value.startsWith('--trace=') && value !== '--trace=off')) throw Error('查询复制原生专项禁止开启trace');
  }
}
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须Root显式开启DBARK_QUERY_DUPLICATE_NATIVE_TEST=1，且integration=0');
// 严格owner按原夹具实现；失败停链保留，不强退、不重启、不删除未知所属配置。
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const undoKey = `${modifier}+z`, redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
const connectionName = '查询复制原生离线连接', sourceName = '查询复制已保存来源';
const savedSql = "SELECT '离线保存来源', '900719925474099312345', '🚢';\n-- 本例不得执行SQL";
const draftSql = "SELECT '来源草稿修改', '0.12345678901234567890', '🧭';\n-- 复制当前全文，保存来源保持不变";
const copySql = "SELECT '仅修改副本', '900719925474099399999';\n-- 原草稿和保存来源均不得跟随修改";
let completed: { directory: string; normalExitConfirmed: true; independentTabIds: true; sourceUndoBaselineMatched: true } | undefined;

/** 每次重新核本例owner，不使用模块全局page操作其它实例，也不允许重启旧owner。 */
function desktop(info: TestInfo) {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info);
  if (owner.closed) throw Error('本例桌面已关闭，禁止继续界面操作');
  return { runtime, ...owner };
}
/** 只读真实持久化设置，不读写生产store、Monaco模型或光标。 */
async function settings(info: TestInfo) {
  const owner = desktop(info), value = await owner.page.evaluate(() => window.dbark.invoke('settings.get', {}));
  desktop(info); return value;
}
/** 只读实际保存查询，副本和来源草稿均不得隐式覆盖其正文。 */
async function queries(info: TestInfo) {
  const owner = desktop(info), value = await owner.page.evaluate(() => window.dbark.invoke('queries.list', {}));
  desktop(info); return value;
}
/** 键盘正文唯一写入路径；等待真实settings落盘，不用setValue或剪贴板输入。 */
async function write(info: TestInfo, sql: string) {
  const { page } = desktop(info), box = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await box.focus(); desktop(info); await page.keyboard.press(`${modifier}+A`); desktop(info);
  await page.keyboard.insertText(sql); desktop(info);
  await expect.poll(async () => { const value = await settings(info); return value.tabs.find(tab => tab.id === value.activeTabId)?.sql; }).toBe(sql);
}
/** 真实键盘Undo/Redo；预期来自复制前实际Undo结果，不硬编码编辑器的分组。 */
async function historyKey(info: TestInfo, key: string) {
  const { page } = desktop(info); await page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus(); desktop(info);
  await page.keyboard.press(key); desktop(info);
}
/** 按真实tab按钮导航，再用持久化ID确认；不同tab ID只证明前端草稿归属。 */
async function select(info: TestInfo, name: string, id: string) {
  const { page } = desktop(info); await page.locator('.tab-strip .tab-select').filter({ has: page.getByText(name, { exact: true }) }).click(); desktop(info);
  await expect.poll(() => settings(info).then(value => value.activeTabId)).toBe(id);
}

test('离线原生复制当前全文、隔离保存来源及副本编辑，并保留原UndoRedo基线', async ({ trace, screenshot, video }, info) => {
  const { runtime, page } = desktop(info), directory = runtime.dataDir;
  try {
    expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
    await expect(page.locator('.tab-strip .tab-select')).toHaveCount(0);
    await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click(); desktop(info);
    const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await connection.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName); desktop(info);
    await connection.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1'); desktop(info);
    await connection.getByLabel(zh.connections.text010, { exact: true }).fill('1'); desktop(info);
    await connection.getByLabel(zh.common.user, { exact: true }).fill('offline'); desktop(info);
    await connection.getByLabel(zh.connections.text011, { exact: true }).fill(''); desktop(info);
    await connection.getByLabel(zh.connections.text012, { exact: true }).fill(''); desktop(info);
    await connection.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck(); desktop(info);
    await expect(connection.getByLabel(zh.connections.text011, { exact: true })).toHaveValue('');
    await expect(connection.getByRole('checkbox', { name: zh.connections.text016, exact: true })).not.toBeChecked();
    // 不点“测试连接”，不提供密码、证书或文件授权。
    await connection.getByRole('button', { name: zh.connections.text036, exact: true }).click(); desktop(info);
    await expect(connection).toBeHidden();

    await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click(); desktop(info);
    const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
    await expect(newQuery.getByLabel(zh.app.text049, { exact: true })).toHaveText(connectionName);
    await expect(newQuery.getByLabel(zh.app.text050, { exact: true })).toHaveValue('');
    // 原流程会尝试127.0.0.1:1并拒连；这是离线边界，不伪造服务器信息或补全状态。
    await expect(newQuery.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 });
    await newQuery.getByRole('button', { name: zh.app.text053, exact: true }).click(); desktop(info);
    await expect(newQuery).toBeHidden(); await write(info, savedSql);

    const query = page.locator('.query-tab:visible');
    await query.getByRole('button', { name: zh.query.text015, exact: true }).click(); desktop(info);
    const save = page.getByRole('dialog', { name: queryBindingZh.title, exact: true });
    await save.getByLabel(queryBindingZh.name, { exact: true }).fill(sourceName); desktop(info);
    await save.getByRole('button', { name: queryBindingZh.create, exact: true }).click(); desktop(info);
    await expect(save).toBeHidden();
    const records = await queries(info); expect(records).toHaveLength(1); expect(records[0].sql).toBe(savedSql);
    expect(records[0].databaseContext).toEqual({ state: 'known', database: null });
    await expect.poll(async () => (await settings(info)).tabs[0]?.sourceBinding?.id).toBe(records[0].id);
    const sourceId = (await settings(info)).activeTabId!; expect(sourceId).toBeTruthy();

    await write(info, draftSql); await historyKey(info, undoKey);
    await expect.poll(async () => (await settings(info)).tabs.find(tab => tab.id === sourceId)?.sql).not.toBe(draftSql);
    const undoBaseline = (await settings(info)).tabs.find(tab => tab.id === sourceId)!.sql; expect(typeof undoBaseline).toBe('string');
    await historyKey(info, redoKey);
    await expect.poll(async () => (await settings(info)).tabs.find(tab => tab.id === sourceId)?.sql).toBe(draftSql);
    const original = (await settings(info)).tabs.find(tab => tab.id === sourceId)!;
    expect(original.sourceBinding?.id).toBe(records[0].id); expect(original.databaseContext).toEqual({ state: 'known', database: null });
    await query.getByRole('button', { name: queryDuplicateZh.action, exact: true }).click(); desktop(info);
    await expect.poll(() => settings(info).then(value => value.tabs.length)).toBe(2);
    const copied = await settings(info), target = copied.tabs.find(tab => tab.id === copied.activeTabId)!;
    expect(target.id).not.toBe(sourceId); expect(target.title).toBe(sourceName + queryDuplicateZh.suffix);
    expect(target.sql).toBe(draftSql); expect(target.connectionId).toBe(original.connectionId); expect(target.kind).toBe('query');
    expect(target.database).toBeUndefined(); expect(target.databaseContext).toEqual({ state: 'known', database: null });
    expect(target).not.toHaveProperty('sourceBinding');
    expect(Object.keys(target).filter(key => !['id', 'kind', 'title', 'connectionId', 'sql', 'database', 'databaseContext'].includes(key))).toEqual([]);
    expect(copied.tabs.find(tab => tab.id === sourceId)).toEqual(original);
    await expect(query.getByLabel('当前查询默认库', { exact: true })).toHaveText(queryContextZh.none);
    expect(await queries(info)).toEqual(records);

    await write(info, copySql); expect((await settings(info)).tabs.find(tab => tab.id === sourceId)?.sql).toBe(draftSql);
    expect(await queries(info)).toEqual(records);
    await select(info, sourceName, sourceId); await historyKey(info, undoKey);
    await expect.poll(async () => (await settings(info)).tabs.find(tab => tab.id === sourceId)?.sql).toBe(undoBaseline);
    expect((await settings(info)).tabs.find(tab => tab.id === target.id)?.sql).toBe(copySql);
    await historyKey(info, redoKey);
    await expect.poll(async () => (await settings(info)).tabs.find(tab => tab.id === sourceId)?.sql).toBe(draftSql);
    const final = await settings(info); expect(final.tabs).toHaveLength(2);
    expect(final.tabs.find(tab => tab.id === sourceId)?.sourceBinding).toEqual(original.sourceBinding);
    expect(final.tabs.find(tab => tab.id === target.id)?.sql).toBe(copySql); expect(final.tabs.find(tab => tab.id === target.id)).not.toHaveProperty('sourceBinding');
    expect(await queries(info)).toEqual(records); expect(runtime.pageErrors).toEqual([]);
    await runtime.confirmOwnedDesktopExit(info);
    expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    completed = { directory, normalExitConfirmed: true, independentTabIds: true, sourceUndoBaselineMatched: true };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    await info.attach('查询复制原生保留现场', { body: Buffer.from(JSON.stringify({ directory, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false })), contentType: 'application/json' });
    throw reason;
  }
});

/** 仅在strict owner已核正常退出及所属PID消失、自动夹具完成清理后确认目录不存在。 */
test.afterAll(async ({}, info) => {
  if (!completed) return;
  let missing = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; }
  expect(missing, '正常退出后临时配置目录必须由strict owner夹具清理').toBe(true);
  await info.attach('查询复制原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, ...completed, directoryRemoved: true, launches: 1, explicitSqlExecution: 0, systemClipboard: 0, realDatabaseSessionIsolationProven: false })), contentType: 'application/json' });
});
