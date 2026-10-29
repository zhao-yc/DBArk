import { clickSidebarAction } from './sidebar-menu';
import { test, expect, type TestInfo } from '@playwright/test';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { createQueryResultPresetsRestartRun } from './query-result-presets-restart-runtime';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import type { EditorIndentNativeRun, IndentNativeOwner } from './editor-indentation-native-owner';
import { queryResultColumnsSql, type QueryResultColumnsUiTarget } from '../helpers/queryResultColumnsUi';
import { installQueryResultPresetsRestartAudit, readQueryResultPresetsRestartAudit } from '../helpers/queryResultPresetsRestartAudit';
import { queryResultPresetDocumentSchema, type QueryResultPresetStoredSnapshot } from '../../src/shared/queryResultPresets';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryResultPresetsZh as presets } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultFilterZh as filter } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sort } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultHistoryZh as history } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { queryCloseZh as closeText } from '../../src/renderer/locales/queryClose.zh-CN';

const connectionName = '整理方案重启只读连接', presetName = '重启保留整理', modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');

/** 两代仅由真实UI产生方案；共用原120秒单调期限和固定批准的编译树。 */
export function registerQueryResultPresetsRestart(binding: QueryResultColumnsUiTarget, approval: { manifestPath: string; approvedHash: string }): void {
  const cases = new WeakMap<TestInfo, ReturnType<typeof bindEditorIndentNativeCase>>();
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.describe.configure({ retries: 0, timeout: 120000 });
  test.afterEach(({}, info) => cases.get(info)?.retain());
  test('命名整理方案真实退出及第二客户端读取应用，临时凭据不落盘且两代正常退出', async ({ trace, screenshot, video }, info) => {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const scope = bindEditorIndentNativeCase(info, binding, () => test.info()); cases.set(info, scope);
    const target = { target: binding.target, assertCurrent: () => scope.assertCurrent() }, run = createQueryResultPresetsRestartRun(target, approval);
    try {
      const first = await run.launch(); await createConnection(run, first, binding);
      const profileId = await profile(run, first, binding, true), firstTab = await prepareQuery(run, first, profileId);
      await arm(run, first, profileId, firstTab, 1, info); await execute(run, first);
      await organize(run, first); const page = first.page, dialog = page.getByRole('dialog', { name: presets.title, exact: true });
      await step(run, first, () => page.locator('.query-tab:visible').getByRole('button', { name: presets.open, exact: true }).click());
      await step(run, first, () => dialog.getByRole('textbox', { name: presets.name, exact: true }).fill(presetName));
      await step(run, first, () => dialog.getByRole('button', { name: presets.create, exact: true }).click());
      await preview(run, first); const firstAudit = await step(run, first, () => first.application.evaluate(readQueryResultPresetsRestartAudit));
      expect(firstAudit.schemeCommands).toEqual(['list', 'save']); expect(firstAudit.snapshot?.entries).toHaveLength(1);
      const expected = firstAudit.snapshot!; assertConfiguration(expected);
      await step(run, first, () => dialog.getByRole('button', { name: zh.common.close, exact: true }).click());
      await closeQuery(run, first); await settled(run, first, 1); await run.close(first);
      const firstDisk = await disk(run, profileId, binding.target.password); expect(firstDisk.document).toEqual({ version: expected.version, revision: expected.revision, entries: expected.entries });
      expect(firstDisk.history).toBe(1); expect(firstDisk.tasks).toBe(1);

      const second = await run.launch(); expect(second.application).not.toBe(first.application);
      expect(await profile(run, second, binding, false)).toBe(profileId);
      await step(run, second, () => expect(second.page.locator('.query-tab')).toHaveCount(0));
      await restorePassword(run, second, binding); expect(await profile(run, second, binding, true)).toBe(profileId);
      const secondTab = await prepareQuery(run, second, profileId); await arm(run, second, profileId, secondTab, 2, info, expected);
      await execute(run, second); await step(run, second, () => expect.poll(() => ids(run, second)).toEqual(['1', '2', '3']));
      const secondDialog = second.page.getByRole('dialog', { name: presets.title, exact: true });
      await step(run, second, () => second.page.locator('.query-tab:visible').getByRole('button', { name: presets.open, exact: true }).click());
      await step(run, second, () => secondDialog.getByRole('combobox', { name: presets.choose, exact: true }).selectOption({ label: presetName }));
      await preview(run, second); await step(run, second, () => secondDialog.getByRole('button', { name: presets.apply, exact: true }).click());
      await step(run, second, () => expect(secondDialog).toBeHidden()); await step(run, second, () => expect.poll(() => ids(run, second)).toEqual(['3', '1']));
      await step(run, second, () => second.page.locator('.query-tab:visible').getByRole('button', { name: history.undo, exact: true }).click());
      await step(run, second, () => expect.poll(() => ids(run, second)).toEqual(['1', '2', '3']));
      await step(run, second, () => second.page.locator('.query-tab:visible').getByRole('button', { name: history.redo, exact: true }).click());
      await step(run, second, () => expect.poll(() => ids(run, second)).toEqual(['3', '1']));
      const secondAudit = await step(run, second, () => second.application.evaluate(readQueryResultPresetsRestartAudit));
      expect(secondAudit.schemeCommands).toEqual(['list', 'read']); expect(secondAudit.lastRead).toEqual(expected.entries[0].value);
      await closeQuery(run, second); await settled(run, second, 2); await run.close(second);
      const secondDisk = await disk(run, profileId, binding.target.password); expect(secondDisk.document).toEqual(firstDisk.document); expect(secondDisk.history).toBe(2); expect(secondDisk.tasks).toBe(2);
      await run.finish();
      await info.attach('命名方案重启终态', { body: JSON.stringify({ accepted: true, launches: 2, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, willQuit: owner.ready, closed: owner.closed, pids: owner.ids.size })), schemeCommands: [firstAudit.schemeCommands, secondAudit.schemeCommands], queries: [firstAudit.queries, secondAudit.queries], sqliteSchema: 9, sameDocumentAfterRestart: true, secrets: 0, systemClipboard: 0, serverWrites: 0, directoryRemoved: run.removed }), contentType: 'application/json' });
    } catch (reason) {
      run.retained = true;
      await info.attach('命名方案重启保留现场', { body: JSON.stringify({ directory: run.path, owners: run.owners.map(owner => ({ confirmed: owner.confirmed, closed: owner.closed, willQuit: owner.ready, ids: [...owner.ids], source: owner.sourceDiagnostics })), automaticRetry: false, forceStop: false, directoryRemoved: run.removed }), contentType: 'application/json' });
      throw reason;
    }
  });
}

/** 每项真实异步动作沿同代owner双侧检查，不采用延时猜测保存结果。 */
function step<T>(run: EditorIndentNativeRun, owner: IndentNativeOwner, action: () => Promise<T>): Promise<T> { return run.step(owner, action); }
/** 完整配置用独立手写语义验收，原字段键仍取实际结果身份。 */
function assertConfiguration(snapshot: QueryResultPresetStoredSnapshot): void {
  const value = snapshot.entries[0].value, columns = value.columns;
  expect(columns.map(column => column.name)).toEqual(['id', 'repeated', 'repeated', 'null_value', 'empty_value', 'bytes', 'hidden_value']); expect(value.visible).toEqual(columns);
  expect(value.configuration).toEqual({ expression: { mode: 'AND', children: [{ mode: 'OR', children: [{ column: columns[0].key, operator: 'eq', value: '1' }, { column: columns[0].key, operator: 'eq', value: '3' }] }, { column: columns[2].key, operator: 'lte', value: '1.00000000000000000001' }, { column: columns[0].key, operator: 'eq', value: '保留停用原文', enabled: false }] }, sort: [{ column: columns[0].key, direction: 'DESC', nulls: 'LAST', ignoreCase: true }, { column: columns[2].key, direction: 'ASC', nulls: 'FIRST' }] });
}
/** 连接仅由表单创建且不记住密码，不测试连接或展开对象树。 */
async function createConnection(run: EditorIndentNativeRun, owner: IndentNativeOwner, binding: QueryResultColumnsUiTarget): Promise<void> {
  const page = owner.page; await step(run, owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
  const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
  for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, '']]) await step(run, owner, () => form.getByLabel(label, { exact: true }).fill(value));
  await step(run, owner, () => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql'));
  await step(run, owner, () => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(run, owner, () => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(run, owner, () => expect(form).toBeHidden());
}
/** 重启后只在关闭标签的真实表单重新填临时秘密，不改连接概要或方案。 */
async function restorePassword(run: EditorIndentNativeRun, owner: IndentNativeOwner, binding: QueryResultColumnsUiTarget): Promise<void> {
  const row = owner.page.locator('.connection-node').filter({ has: owner.page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await step(run, owner, () => row.locator('.connection-row').hover()); await step(run, owner, () => clickSidebarAction(row, { name: `编辑连接 ${connectionName}`, exact: true }));
  const form = owner.page.getByRole('dialog', { name: '编辑连接', exact: true }); await step(run, owner, () => form.getByLabel(zh.connections.text011, { exact: true }).fill(binding.target.password));
  await step(run, owner, () => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(run, owner, () => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(run, owner, () => expect(form).toBeHidden());
}
/** 只读真实概要，证明两代ID相同、没有持久密码、SSH或TLS。 */
async function profile(run: EditorIndentNativeRun, owner: IndentNativeOwner, binding: QueryResultColumnsUiTarget, available: boolean): Promise<string> {
  const profiles = await step(run, owner, () => owner.page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const value = profiles[0];
  expect(Boolean(value.name === connectionName && value.host === binding.target.host && value.port === 13384 && value.user === binding.target.user && value.rememberPassword === false && value.password === undefined && Boolean(value.hasPassword) === (available && Boolean(binding.target.password)) && !value.database && !value.tls?.enabled && !value.ssh?.enabled)).toBe(true); return value.id;
}
/** SQL全部来自真实Monaco输入；读取Main设置仅用于捕获准确tabId。 */
async function prepareQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner, profileId: string): Promise<string> {
  const page = owner.page; await step(run, owner, () => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
  await step(run, owner, () => form.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profileId)); await step(run, owner, () => form.getByLabel(zh.app.text050, { exact: true }).fill('')); await step(run, owner, () => form.getByRole('button', { name: zh.app.text053, exact: true }).click());
  await step(run, owner, () => page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus()); await step(run, owner, () => page.keyboard.press(modifier + '+A')); await step(run, owner, () => page.keyboard.insertText(queryResultColumnsSql));
  let id = ''; await step(run, owner, () => expect.poll(async () => { run.assert(owner); const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); run.assert(owner); const tab = settings.tabs.find(item => item.id === settings.activeTabId); if (settings.tabs.length === 1 && tab?.kind === 'query' && tab.sql === queryResultColumnsSql && tab.connectionId === profileId) { id = tab.id; return true; } return false; }).toBe(true)); return id;
}
/** 固定审核器只旁观实际handler回包；不能给方案或结果注入成功值。 */
async function arm(run: EditorIndentNativeRun, owner: IndentNativeOwner, profileId: string, tabId: string, phase: 1 | 2, info: TestInfo, expected?: QueryResultPresetStoredSnapshot): Promise<void> {
  const window = await step(run, owner, () => owner.application.browserWindow(owner.page)), senderId = await step(run, owner, () => window.evaluate(value => value.webContents.id)); await step(run, owner, () => window.dispose());
  await step(run, owner, () => owner.application.evaluate(installQueryResultPresetsRestartAudit, { senderId, profileId, tabId, sql: queryResultColumnsSql, deadline: (info as TestInfo & { _startWallTime: number })._startWallTime + 120000, phase, ...(expected ? { expected } : {}) }));
}
/** 每代恰一次执行按钮，结果显示行序由真实DOM单元格独立读取。 */
async function execute(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<void> {
  const tab = owner.page.locator('.query-tab:visible'); await step(run, owner, () => tab.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(run, owner, () => expect(tab.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled({ timeout: 20000 })); await step(run, owner, () => expect(tab.locator('.error-box')).toHaveCount(0)); await step(run, owner, () => expect.poll(() => ids(run, owner)).toEqual(['1', '2', '3']));
}
/** 内部轮询仅同代同步核验，不能嵌套run.step形成并发动作。 */
async function ids(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<string[]> { run.assert(owner); const values = await owner.page.locator('.query-tab:visible .results-grid [role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents(); run.assert(owner); return values; }
/** 完整括号、停用原文及两列选项全部由实际控件建立。 */
async function organize(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<void> {
  const page = owner.page, tab = page.locator('.query-tab:visible'), panel = tab.getByRole('region', { name: filter.title, exact: true });
  await step(run, owner, () => tab.getByRole('button', { name: filter.open, exact: true }).click()); await step(run, owner, () => panel.getByRole('button', { name: filter.addGroup, exact: true }).click());
  /** 独立输入每个叶节点，不借产品比较器或保存接口构造期待。 */
  async function rule(index: number, column: number, operator: string, value: string) { await step(run, owner, () => panel.getByRole('combobox', { name: filter.column + ' ' + index, exact: true }).selectOption({ index: column })); await step(run, owner, () => panel.getByRole('combobox', { name: filter.operator + ' ' + index, exact: true }).selectOption(operator)); await step(run, owner, () => panel.getByRole('textbox', { name: filter.input + ' ' + index, exact: true }).fill(value)); }
  await rule(1, 0, 'eq', '1'); await step(run, owner, () => panel.getByRole('button', { name: filter.addInGroup('1'), exact: true }).click()); await rule(2, 0, 'eq', '3');
  await step(run, owner, () => panel.getByRole('button', { name: filter.add, exact: true }).click()); await rule(3, 2, 'lte', '1.00000000000000000001');
  await step(run, owner, () => panel.getByRole('button', { name: filter.add, exact: true }).click()); await rule(4, 0, 'eq', '保留停用原文'); await step(run, owner, () => panel.getByRole('checkbox', { name: filter.enabled(4), exact: true }).uncheck()); await step(run, owner, () => panel.getByRole('button', { name: filter.apply, exact: true }).click());
  const heads = tab.locator('.results-grid [role="columnheader"]:has(.column-type)'); await step(run, owner, () => heads.nth(0).click()); await step(run, owner, () => heads.nth(0).click()); await step(run, owner, () => heads.nth(2).click({ modifiers: [modifier] }));
  await step(run, owner, () => tab.getByRole('combobox', { name: sort.nulls(1, 'id'), exact: true }).selectOption('LAST')); await step(run, owner, () => tab.getByRole('checkbox', { name: sort.ignoreCase(1, 'id'), exact: true }).check()); await step(run, owner, () => tab.getByRole('combobox', { name: sort.nulls(2, 'repeated'), exact: true }).selectOption('FIRST')); await step(run, owner, () => expect.poll(() => ids(run, owner)).toEqual(['3', '1']));
}
/** 只观察可见完整预览，停用原文仍存在且两个NULL选项顺序正确。 */
async function preview(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<void> {
  const preview = owner.page.getByRole('dialog', { name: presets.title, exact: true }).getByRole('region', { name: presets.preview, exact: true });
  await step(run, owner, () => expect(preview).toContainText('保留停用原文')); await step(run, owner, () => expect(preview).toContainText(presets.disabled)); await step(run, owner, () => expect(preview).toContainText('1.00000000000000000001'));
  await step(run, owner, () => expect(preview.locator('ol > li')).toHaveText(['id · ' + presets.desc + ' · ' + presets.nullLast + ' · ' + presets.ignoreCase, 'repeated · ' + presets.asc + ' · ' + presets.nullFirst]));
}
/** 标签关闭走原草稿确认后待Main空工作区落盘，避免重启补密码时触及活动会话。 */
async function closeQuery(run: EditorIndentNativeRun, owner: IndentNativeOwner): Promise<void> {
  await step(run, owner, () => owner.page.locator('.tab-strip .tab-close').click()); const dialog = owner.page.getByRole('dialog', { name: closeText.title, exact: true });
  await step(run, owner, () => expect.poll(async () => { run.assert(owner); const count = await owner.page.locator('.query-tab').count(); run.assert(owner); if (!count) return true; const visible = await dialog.isVisible(); run.assert(owner); return visible; }).toBe(true));
  if (await step(run, owner, () => dialog.isVisible())) await step(run, owner, () => dialog.getByRole('button', { name: closeText.discard, exact: true }).click());
  await step(run, owner, () => expect.poll(async () => { run.assert(owner); const settings = await owner.page.evaluate(() => window.dbark.invoke('settings.get', {})); run.assert(owner); return settings.tabs.length; }).toBe(0));
}
/** 当代审计、历史任务及显式关闭事实必须全部结算才允许正常退出。 */
async function settled(run: EditorIndentNativeRun, owner: IndentNativeOwner, total: number): Promise<void> {
  await step(run, owner, () => expect.poll(async () => { run.assert(owner); const state = await owner.application.evaluate(readQueryResultPresetsRestartAudit); run.assert(owner); return state.pending; }).toBe(0));
  const state = await step(run, owner, () => owner.application.evaluate(readQueryResultPresetsRestartAudit)); expect(state.queries).toBe(1); expect(state.revision).toBe(0); expect(state.workspaceClosed).toBe(true);
  const tasks = await step(run, owner, () => owner.page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks).toHaveLength(total); expect(tasks.every(task => task.kind === 'query.execute' && task.status === 'completed')).toBe(true); expect(owner.errors).toEqual([]);
}
/** 只有全部所属PID已确认退出后读真实SQLite；不写文件、不读取任何旧测试目录。 */
async function disk(run: EditorIndentNativeRun, profileId: string, password: string) {
  return run.stopped(async directory => {
    run.assert(); const SQL = await initSqlJs({ locateFile: () => wasm }); run.assert(); const file = join(directory, 'dbark.sqlite'), before = await lstat(file); run.assert();
    if (!before.isFile() || before.isSymbolicLink() || before.size > 4 * 1024 * 1024) throw Error('本例SQLite大小或文件身份未知');
    const bytes = await readFile(file); run.assert(); const after = await lstat(file); run.assert();
    expect([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs]); if (password) expect(bytes.includes(Buffer.from(password))).toBe(false);
    const db = new SQL.Database(bytes);
    try {
      expect(db.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(db.exec('SELECT COUNT(*) FROM secrets')[0].values[0][0]).toBe(0);
      const statement = db.prepare('SELECT data FROM query_result_presets WHERE connection_id=?'); let raw: unknown;
      try { statement.bind([profileId]); expect(statement.step()).toBe(true); raw = JSON.parse(String(statement.get()[0])); expect(statement.step()).toBe(false); } finally { statement.free(); }
      expect(db.exec('SELECT COUNT(*) FROM query_result_presets')[0].values[0][0]).toBe(1);
      return { document: queryResultPresetDocumentSchema.parse(raw), history: Number(db.exec('SELECT COUNT(*) FROM history')[0].values[0][0]), tasks: Number(db.exec('SELECT COUNT(*) FROM tasks')[0].values[0][0]) };
    } finally { db.close(); }
  });
}
