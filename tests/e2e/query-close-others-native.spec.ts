import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryBindingZh as binding } from '../../src/renderer/locales/queryBinding.zh-CN';
import { queryCloseZh as close } from '../../src/renderer/locales/queryClose.zh-CN';
import { queryDuplicateZh as duplicate } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import type { AppSettings } from '../../src/shared/contracts';

/** 列表和默认关闭不加载桌面owner；实际启用前拒绝实库、SSH、认证及录制参数。 */
function assertOfflineCloseOthersEnvironment(env: Record<string, string | undefined>, args: string[]): void {
  if (Object.hasOwn(env, 'DBARK_DEV_URL')) throw Error('关闭其他查询原生专项拒绝DBARK_DEV_URL，空值也不得覆盖本例renderer');
  const alias = (key: string) => key === 'DBARK_C02_EXECUTABLE_PATH' && !!env.DBARK_EXECUTABLE_PATH && env[key] === env.DBARK_EXECUTABLE_PATH;
  if (env.DBARK_INTEGRATION_ENABLED !== '0' || Object.keys(env).some(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_|TLS_|MYSQL_|MARIADB_|AUTH_|PASSWORD|TOKEN|CREDENTIAL|CERT|CA_PATH|PRIVATE_KEY)/.test(key) && !alias(key))) throw Error('关闭其他查询原生专项只允许离线配置及integration=0，拒绝实库或认证参数');
  for (const [index, value] of args.entries()) {
    if ((value === '--trace' && args[index + 1] !== 'off') || (value.startsWith('--trace=') && value !== '--trace=off')) throw Error('关闭其他查询原生专项禁止开启trace');
  }
}
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST === '1';
if (active) assertOfflineCloseOthersEnvironment(process.env, process.argv);
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须Root开启DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST=1，integration=0并先核127.0.0.1:1无监听');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
// 首例失败即停止后续例，绝不在保留的未知owner之后自动启动下一实例。
test.describe.configure({ mode: 'serial', timeout: 120000, retries: 0 });

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const sourceName = '关闭其他查询来源A';
const savedSql = "SELECT '原保存来源A', '900719925474099312345';\n-- 离线用例不执行SQL";
const aSql = "SELECT '草稿A', '🚢';\n-- 保存失败必须保留原弹窗";
const bSql = "SELECT '草稿B', '0.12345678901234567890';\n-- 取消或失败后保持全文";
const cSql = "SELECT '保留C', '🧭';\n-- 当前查询必须保留";
const externalSql = "SELECT '另一编辑者更新的来源A';\n-- 仅通过合法本地CAS保存";
type Tab = AppSettings['tabs'][number];
const completed: { directory: string; identity: string; normalExitConfirmed: true }[] = [];

/** 每次跨await后核对同一TestInfo所属owner，不借全局句柄重启或操作其它实例。 */
function desktop(info: TestInfo) {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info);
  if (owner.closed) throw Error('本例桌面已关闭，禁止继续操作');
  return { runtime, ...owner };
}
/** 只读真实持久化设置；不接触store、Monaco模型或内部handler。 */
async function settings(info: TestInfo) {
  const value = await desktop(info).page.evaluate(() => window.dbark.invoke('settings.get', {})); desktop(info); return value;
}
/** 来源记录只读；唯一允许的写IPC在冲突场景中单独标明。 */
async function queries(info: TestInfo) {
  const value = await desktop(info).page.evaluate(() => window.dbark.invoke('queries.list', {})); desktop(info); return value;
}
/** 设置落盘不代表新Monaco已挂载；先核准确标签及正式正文桥就绪，再走真实键盘。 */
async function write(info: TestInfo, sql: string, expectedTabId?: string) {
  const { page } = desktop(info), before = await settings(info), tabId = expectedTabId ?? before.activeTabId;
  const index = before.tabs.findIndex(tab => tab.id === tabId); expect(index).toBeGreaterThanOrEqual(0);
  await expect.poll(() => settings(info).then(value => value.activeTabId)).toBe(tabId);
  const pane = page.locator('.tab-content > .tab-pane').nth(index);
  await expect(pane).toBeVisible(); desktop(info);
  await expect(pane.locator('.sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false'); desktop(info);
  const input = pane.locator('.sql-editor-wrap .monaco-editor').getByRole('textbox');
  await expect(input).toBeVisible(); desktop(info); await expect(input).toBeEditable(); desktop(info);
  expect((await settings(info)).activeTabId).toBe(tabId);
  await input.focus(); desktop(info); await page.keyboard.press(`${modifier}+A`); desktop(info);
  await page.keyboard.insertText(sql); desktop(info);
  await expect.poll(async () => { const value = await settings(info); expect(value.activeTabId).toBe(tabId); return value.tabs.find(tab => tab.id === tabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(sql);
}
/** 用真实标签按钮切换，再以持久化ID核对准确前端身份。 */
async function select(info: TestInfo, tab: Tab) {
  const { page } = desktop(info);
  await page.locator('.tab-strip .tab-select').filter({ has: page.getByText(tab.title, { exact: true }) }).click(); desktop(info);
  await expect.poll(() => settings(info).then(value => value.activeTabId)).toBe(tab.id);
}
/** 新连接、新查询、保存及两次复制都走真实表单/按钮；不测试连接、不提供认证材料。 */
async function threeDrafts(info: TestInfo) {
  const { page } = desktop(info);
  await expect(page.locator('.tab-strip .tab-select')).toHaveCount(0);
  await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click(); desktop(info);
  const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  const connectionName = '关闭其他查询离线连接';
  await connection.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName); desktop(info);
  await connection.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1'); desktop(info);
  await connection.getByLabel(zh.connections.text010, { exact: true }).fill('1'); desktop(info);
  await connection.getByLabel(zh.common.user, { exact: true }).fill('offline'); desktop(info);
  await connection.getByLabel(zh.connections.text011, { exact: true }).fill(''); desktop(info);
  await connection.getByLabel(zh.connections.text012, { exact: true }).fill(''); desktop(info);
  await connection.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck(); desktop(info);
  await expect(connection.getByLabel(zh.connections.text011, { exact: true })).toHaveValue('');
  await expect(connection.getByRole('checkbox', { name: zh.connections.text016, exact: true })).not.toBeChecked();
  await connection.getByRole('button', { name: zh.connections.text036, exact: true }).click(); desktop(info);
  await expect(connection).toBeHidden();
  await page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click(); desktop(info);
  const dialog = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await expect(dialog.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) })).toHaveText(connectionName);
  await expect(dialog.getByLabel(zh.app.text050, { exact: true })).toHaveValue('');
  // 正式流程的拒连是离线边界；不伪造连接成功、会话或服务器能力。
  await expect(dialog.locator('.error-box')).toContainText(/ECONNREFUSED|连接被拒绝|拒绝连接/i, { timeout: 20000 });
  await dialog.getByRole('button', { name: zh.app.text053, exact: true }).click(); desktop(info);
  await expect(dialog).toBeHidden(); await write(info, savedSql);
  await page.locator('.query-tab:visible').getByRole('button', { name: zh.query.text015, exact: true }).click(); desktop(info);
  const save = page.getByRole('dialog', { name: binding.title, exact: true });
  await save.getByLabel(binding.name, { exact: true }).fill(sourceName); desktop(info);
  await save.getByRole('button', { name: binding.create, exact: true }).click(); desktop(info); await expect(save).toBeHidden();
  const records = await queries(info); expect(records).toHaveLength(1);
  expect(records[0].sql.replaceAll('\r\n', '\n')).toBe(savedSql);
  await expect.poll(async () => (await settings(info)).tabs[0]?.sourceBinding?.id).toBe(records[0].id);
  await write(info, aSql);
  const a = (await settings(info)).tabs[0];
  await page.locator('.query-tab:visible').getByRole('button', { name: duplicate.action, exact: true }).click(); desktop(info);
  await expect.poll(() => settings(info).then(value => value.tabs.length)).toBe(2); await write(info, bSql, (await settings(info)).tabs[1].id);
  const b = (await settings(info)).tabs[1];
  await page.locator('.query-tab:visible').getByRole('button', { name: duplicate.action, exact: true }).click(); desktop(info);
  await expect.poll(() => settings(info).then(value => value.tabs.length)).toBe(3); await write(info, cSql, (await settings(info)).tabs[2].id);
  const value = await settings(info), c = value.tabs[2];
  expect(value.tabs).toEqual([a, b, c]); expect(value.activeTabId).toBe(c.id);
  expect(new Set(value.tabs.map(tab => tab.id)).size).toBe(3);
  for (const tab of value.tabs) { expect(tab.kind).toBe('query'); expect(tab.connectionId).toBe(a.connectionId); expect(tab.databaseContext).toEqual({ state: 'known', database: null }); }
  expect(a.sourceBinding?.id).toBe(records[0].id); expect(b).not.toHaveProperty('sourceBinding'); expect(c).not.toHaveProperty('sourceBinding');
  expect(await queries(info)).toEqual(records);
  return { a, b, c, records };
}
/** 等待真实portal和React提交产生准确目标弹窗，绝不自行清DOM或推进队列。 */
async function closeDialog(info: TestInfo, tab: Tab) {
  const dialog = desktop(info).page.getByRole('dialog', { name: close.title, exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.locator('strong')).toHaveText(tab.title); desktop(info); return dialog;
}
/** 观察本例窗口及准确目标；addedNodes补同批移除漏采，但记录不冒充完整DOM历史。 */
async function observeCloseDialogs(info: TestInfo, targets: Pick<Tab, 'id' | 'title'>[]) {
  if (targets.length !== 3 || new Set(targets.map(tab => tab.id)).size !== 3 || new Set(targets.map(tab => tab.title)).size !== 3) throw Error('本例DOM观察必须绑定三个唯一目标及标题');
  await desktop(info).page.evaluate(({ title, targets, runId }) => {
    const seen: string[] = [], matches: { tabId: string | null; title: string }[] = [], recorded = new WeakMap<Element, string>();
    /** 精确匹配真实关闭dialog及strong；未知同名dialog也记录为未归属，使最终断言失败。 */
    function capture(dialog: Element) {
      if (dialog.getAttribute('aria-label') !== title) return;
      const target = dialog.querySelector('strong')?.textContent ?? '';
      if (recorded.get(dialog) === target) return;
      recorded.set(dialog, target);
      if (seen.at(-1) !== target) { seen.push(target); matches.push({ tabId: targets.find(tab => tab.title === target)?.id ?? null, title: target }); }
    }
    /** 直接插入的dialog与包装子树均读取，包括回调时已经从body移除的原节点。 */
    function added(node: Node) {
      if (node.nodeType !== 1) return;
      const element = node as Element;
      if (element.matches('[role="dialog"]')) capture(element);
      for (const dialog of element.querySelectorAll('[role="dialog"]')) capture(dialog);
    }
    function sample(records: MutationRecord[] = []) {
      for (const record of records) for (const node of record.addedNodes) added(node);
      for (const dialog of document.querySelectorAll('[role="dialog"]')) capture(dialog);
    }
    const observer = new MutationObserver(sample); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); sample();
    // 只写测试观察记录；停止前收集尚未交付的records，不替换DOM或业务接口。
    (window as unknown as { __closeOthersObservation: { runId: string; targets: typeof targets; seen: string[]; matches: typeof matches; stop(): void } }).__closeOthersObservation = { runId, targets, seen, matches, stop: () => { sample(observer.takeRecords()); observer.disconnect(); } };
  }, { title: close.title, targets, runId: `${info.testId}:${info.retry}` }); desktop(info);
}
/** 只读历史核对没有执行SQL；成功后严格确认正常退出及所属PID，夹具再清理目录。 */
async function finish(info: TestInfo, identity: string) {
  const { runtime, page } = desktop(info), directory = runtime.dataDir;
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); desktop(info);
  expect(runtime.pageErrors).toEqual([]);
  await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
  completed.push({ directory, identity, normalExitConfirmed: true });
}
/** 失败立即保留所属owner，不在finally重试退出、不强停、不删除未知目录。 */
async function retainFailure(info: TestInfo) {
  const runtime = require('./desktop-fixture') as Desktop; runtime.retainOwnedDesktopResources(info);
  await info.attach('关闭其他查询保留现场', { body: Buffer.from(JSON.stringify({ directory: runtime.dataDir, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false })), contentType: 'application/json' });
}

test('保留C：取消全部保留；再发A直接关闭后真实推进B，B取消保留B和C全文', async ({ trace, screenshot, video }, info) => {
  try {
    expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
    const { a, b, c, records } = await threeDrafts(info), { page } = desktop(info);
    const others = page.locator('.app-commandbar').getByRole('button', { name: close.others, exact: true });
    await others.click(); desktop(info);
    await (await closeDialog(info, a)).getByRole('button', { name: close.cancel, exact: true }).click(); desktop(info);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await settings(info)).tabs).toEqual([a, b, c]); expect((await settings(info)).activeTabId).toBe(c.id); expect(await queries(info)).toEqual(records);
    await expect(others).toBeEnabled(); await others.click(); desktop(info);
    await (await closeDialog(info, a)).getByRole('button', { name: close.discard, exact: true }).click(); desktop(info);
    // 7142cb0原红必须在这里失败，不能因已知缺陷跳过真正出现B的断言。
    const second = await closeDialog(info, b);
    await expect.poll(() => settings(info).then(value => value.tabs.map(tab => tab.id))).toEqual([b.id, c.id]);
    await second.getByRole('button', { name: close.cancel, exact: true }).click(); desktop(info);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await settings(info)).tabs).toEqual([b, c]); expect((await settings(info)).activeTabId).toBe(c.id); expect(await queries(info)).toEqual(records);
    await select(info, b); await select(info, c); expect((await settings(info)).tabs).toEqual([b, c]);
    await finish(info, '取消与真实commit后推进');
  } catch (reason) { await retainFailure(info); throw reason; }
});

test('来源CAS冲突：首个A保存失败仍可另存关闭，但B不自动推进且B/C与原来源保持', async ({ trace, screenshot, video }, info) => {
  try {
    expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
    const { a, b, c, records } = await threeDrafts(info), { page } = desktop(info);
    expect(a.sourceBinding).toBeTruthy();
    // 唯一写IPC：模拟另一编辑者走正式本地CAS，不改store、当前tab绑定或内部handler。
    const external = await page.evaluate(({ source, name, connectionId, sql }) => window.dbark.invoke('queries.updateSource', { source: source!, content: { name, connectionId, context: source!.context, sql } }), { source: a.sourceBinding, name: records[0].name, connectionId: records[0].connectionId, sql: externalSql }); desktop(info);
    expect(external.source.id).toBe(records[0].id); expect(external.source.digest).not.toBe(a.sourceBinding!.digest);
    const originals = await queries(info); expect(originals).toHaveLength(1); expect(originals[0].sql).toBe(externalSql);
    expect((await settings(info)).tabs).toEqual([a, b, c]);
    const observedTargets = [a, b, c].map(({ id, title }) => ({ id, title }));
    await observeCloseDialogs(info, observedTargets);
    await page.locator('.app-commandbar').getByRole('button', { name: close.others, exact: true }).click(); desktop(info);
    await (await closeDialog(info, a)).getByRole('button', { name: close.save, exact: true }).click(); desktop(info);
    const save = page.getByRole('dialog', { name: binding.title, exact: true }); await expect(save).toBeVisible();
    const nameBefore = await save.getByLabel(binding.name, { exact: true }).inputValue();
    await save.getByRole('button', { name: binding.update, exact: true }).click(); desktop(info);
    await expect(save.locator('.error-box')).toContainText('原查询已修改；本次未覆盖');
    await expect(save).toBeVisible(); await expect(save.getByLabel(binding.name, { exact: true })).toHaveValue(nameBefore);
    await expect(save.getByRole('button', { name: binding.create, exact: true })).toBeEnabled();
    expect((await settings(info)).tabs).toEqual([a, b, c]); expect(await queries(info)).toEqual(originals);
    const newName = '失败后由旧弹窗另存A';
    await save.getByLabel(binding.name, { exact: true }).fill(newName); desktop(info);
    await save.getByRole('button', { name: binding.create, exact: true }).click(); desktop(info);
    await expect(save).toBeHidden(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => settings(info).then(value => value.tabs.map(tab => tab.id))).toEqual([b.id, c.id]);
    expect((await settings(info)).tabs).toEqual([b, c]); expect((await settings(info)).activeTabId).toBe(c.id);
    const after = await queries(info); expect(after).toHaveLength(2);
    expect(after.find(record => record.id === originals[0].id)).toEqual(originals[0]);
    const created = after.find(record => record.id !== originals[0].id)!;
    expect(created.name).toBe(newName); expect(created.sql).toBe(a.sql); expect(created.connectionId).toBe(a.connectionId); expect(created.databaseContext).toEqual(a.databaseContext);
    // 真实界面切换跨后续提交；只观察、不手动调用queue或伪造无modal。
    await select(info, b); await select(info, c); await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await settings(info)).tabs).toEqual([b, c]); expect(await queries(info)).toEqual(after);
    await expect(page.locator('.tab-strip .tab-select')).toHaveCount(2);
    const observed = await page.evaluate(() => { const observation = (window as unknown as { __closeOthersObservation: { runId: string; targets: { id: string; title: string }[]; seen: string[]; matches: { tabId: string | null; title: string }[]; stop(): void } }).__closeOthersObservation; observation.stop(); return { runId: observation.runId, targets: observation.targets, seen: observation.seen, matches: observation.matches }; }); desktop(info);
    expect(observed.runId).toBe(`${info.testId}:${info.retry}`); expect(observed.targets).toEqual(observedTargets);
    expect(observed.seen).toEqual([a.title]); expect(observed.matches).toEqual([{ tabId: a.id, title: a.title }]);
    await finish(info, '首个来源冲突后粘性停链与旧弹窗另存');
  } catch (reason) { await retainFailure(info); throw reason; }
});

/** 自动fixture仅在正常退出和所属PID确认后清理；此处再核每例配置目录消失。 */
test.afterAll(async ({}, info) => {
  for (const result of completed) {
    let missing = false;
    try { await stat(result.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; }
    expect(missing, 'strict owner清理后本例配置目录必须不存在').toBe(true);
    await info.attach('关闭其他查询原生终态', { body: Buffer.from(JSON.stringify({ accepted: true, ...result, directoryRemoved: true, launches: 1, explicitSqlExecution: 0, systemClipboard: 0, realDatabaseSessionIsolationProven: false })), contentType: 'application/json' });
  }
});
