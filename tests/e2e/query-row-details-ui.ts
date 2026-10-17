import { expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryRowDetailsZh as text } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { queryResultColumnsZh as columnsText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { queryRowDetailsUiSql, queryRowDetailsUiValues as values, type QueryRowDetailsUiBinding } from '../helpers/queryRowDetailsUi';
import type { HistoryEntry } from '../../src/shared/contracts';
import type * as Desktop from './desktop-fixture';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
/** 标签正文输入才允许统一平台EOL；返回值的CRLF、空白和精确数字一律严格比对。 */
const inputEol = (value: string) => value.replaceAll('\r\n', '\n');
/** 可访问名称可能包含Field提示，所有select按角色前缀并核唯一数量。 */
const prefix = (value: string) => new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));

/** 双门、准确目标检查全部完成之后才加载strict owner；Root独占实库预检和清理。 */
export function registerQueryRowDetailsUi(binding: QueryRowDetailsUiBinding) {
  binding.assertCurrent();
  const runtime = require('./desktop-fixture') as typeof Desktop, test = runtime.test;
  let completed: { directory: string; normalExitConfirmed: true; historyCount: 2 } | undefined;
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ timeout: 120000, retries: 0 });

  test('准确13384整行详情保留所有原字段、字节与文本，翻行关闭不改勾选，新执行撤销旧详情', async ({ trace, screenshot, video }, info) => {
    const captured = runtime.ownedDesktopResources(info), page = captured.page, directory = runtime.dataDir;
    let stopped = false;
    /** 每次动作前后核准确TestInfo、原App/页面及本轮配置；失败永久停链。 */
    function check(allowClosed = false) {
      try {
        binding.assertCurrent(); const current = runtime.ownedDesktopResources(info);
        if (stopped || info.status !== 'passed' || info.timeout !== 120000 || current.application !== captured.application || current.page !== page || !allowClosed && current.closed) throw Error('整行详情原桌面owner已变化、关闭或测试已终止');
      } catch (reason) { stopped = true; runtime.retainOwnedDesktopResources(info); throw reason; }
    }
    /** 未知失败只保留资源；不补清理、不重放或重启。 */
    async function step<T>(action: () => Promise<T>): Promise<T> {
      check(); try { const result = await action(); check(); return result; }
      catch (reason) { stopped = true; runtime.retainOwnedDesktopResources(info); throw reason; }
    }
    /** 仅只读真实设置和历史，不读写store、Monaco模型或内部handler。 */
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
    const query = () => page.locator('.query-tab:visible'), grid = () => query().locator('.result-body .results-grid');
    const region = () => query().getByRole('region', { name: text.region, exact: true });
    const row = (index: number) => grid().locator(`[role="row"][aria-rowindex="${index + 2}"]`);
    /** 输入只走真实键盘；读取实际落盘raw字符串作为后续history预期。 */
    async function write(sql: string) {
      const box = query().locator('.monaco-editor').getByRole('textbox');
      await step(() => box.focus()); await step(() => page.keyboard.press(`${modifier}+A`)); await step(() => page.keyboard.insertText(sql));
      await step(() => expect.poll(async () => { const value = await settings(); return inputEol(value.tabs.find(tab => tab.id === value.activeTabId)?.sql ?? ''); }).toBe(sql));
      const value = await settings(), raw = value.tabs.find(tab => tab.id === value.activeTabId)?.sql;
      expect(typeof raw).toBe('string'); return raw!;
    }
    /** 只点一次真实执行按钮；历史必须按预期增加到1/2，不自动补执行。 */
    async function execute(sql: string, count: 1 | 2) {
      const raw = await write(sql);
      const run = query().getByRole('button', { name: prefix(zh.query.text010) });
      await step(() => expect(run).toHaveCount(1)); await step(() => run.click());
      await step(() => expect(region()).toHaveCount(0));
      await step(() => expect.poll(async () => (await history()).length).toBe(count));
      const records = await history(); expect(records.every(record => record.success)).toBe(true);
      expect(records.filter(record => record.sql === raw)).toHaveLength(1);
      await step(() => expect(query().getByRole('button', { name: prefix(zh.query.text010) })).toBeEnabled());
      return { raw, records };
    }
    /** 真实网格单元格选活动行，不能借勾选集合推断详情位置。 */
    async function open(index = 0) {
      await step(() => row(index).locator('[role="gridcell"][aria-colindex="2"]').click());
      await step(() => query().getByRole('button', { name: text.open, exact: true }).click());
      await step(() => expect(region()).toBeVisible()); await step(() => expect(page.getByRole('dialog')).toHaveCount(0));
    }
    /** 必须读原textContent，Playwright空白规范不能替代真实返回值比对。 */
    async function rawValues(): Promise<(string | null)[]> { return step(() => region().locator('article pre').allTextContents()); }
    /** 未打开导出或剪贴板动作；仅检查两个原勾选位置。 */
    async function selectionKept() {
      await step(() => expect(row(0).getByRole('checkbox')).toBeChecked());
      await step(() => expect(row(1).getByRole('checkbox')).not.toBeChecked());
    }
    try {
      check(); expect(trace).toBe('off'); expect(screenshot).toBe('off'); expect(video).toBe('off');
      const target = binding.target, connectionName = '整行详情-' + target.marker;
      expect(await history()).toEqual([]); await step(() => expect(page.locator('.tab-strip .tab-select')).toHaveCount(0));
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click());
      const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      const dialect = connection.getByRole('combobox', { name: prefix(zh.connections.text008) });
      await step(() => expect(dialect).toHaveCount(1)); await step(() => dialect.selectOption('mysql')); await step(() => expect(dialect).toHaveValue('mysql'));
      await step(() => connection.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName));
      await step(() => connection.getByLabel(zh.connections.text009, { exact: true }).fill(target.host));
      await step(() => connection.getByLabel(zh.connections.text010, { exact: true }).fill(String(target.port)));
      await step(() => connection.getByLabel(zh.common.user, { exact: true }).fill(target.user));
      await step(() => connection.getByLabel(zh.connections.text011, { exact: true }).fill(target.password));
      await step(() => connection.getByLabel(zh.connections.text012, { exact: true }).fill(target.database));
      // 不点连接测试，不导入证书/SSH；本例凭据只进入strict owner所属的临时安装配置。
      await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})));
      expect(profiles).toHaveLength(1); const profile = profiles[0];
      expect(profile).toMatchObject({ name: connectionName, host: target.host, port: target.port, dialect: 'mysql', user: target.user, database: target.database });
      expect(profile.id).toBeTruthy(); expect(profile.ssh?.enabled ?? false).toBe(false); expect(profile.tls?.enabled ?? false).toBe(false);

      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click());
      const create = page.getByRole('dialog', { name: zh.common.newQuery, exact: true }), select = create.getByRole('combobox', { name: prefix(zh.app.text049) });
      await step(() => expect(select).toHaveCount(1)); await step(() => select.selectOption(profile.id)); await step(() => expect(select).toHaveValue(profile.id));
      await step(() => expect(select).toHaveText(connectionName));
      const database = create.getByRole('combobox', { name: prefix(zh.app.text050) }); await step(() => expect(database).toHaveCount(1)); await step(() => database.fill(target.database));
      await step(() => create.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(create).toBeHidden());
      const initial = await settings(); expect(initial.tabs).toHaveLength(1); expect(initial.tabs[0].connectionId).toBe(profile.id);
      const sql = queryRowDetailsUiSql(target), first = await execute(sql.first, 1);
      expect(first.records[0].connectionId).toBe(profile.id);
      await step(() => expect(grid()).toHaveAttribute('aria-colcount', '16'));
      await step(() => row(0).getByRole('checkbox').check()); await open();
      await step(() => expect(region()).toContainText(text.scope)); await step(() => expect(region().locator('article')).toHaveCount(15));
      const read = await rawValues();
      expect(read.slice(0, 7)).toEqual([values.bigint, values.decimal, text.null, text.empty, 'AP8=', '', values.json]);
      expect(read[7]).toBe(values.long.slice(0, 256)); expect(read[8]).toBe(values.html); expect(read[9]).toBe('隐藏-1');
      expect(read[10]).toBe(target.uuid); expect(read[11]).toMatch(/^8\.4\.11(?:[-+][^\s]+)?$/u); expect(read[12]).toBe(target.database); expect(read[13]).toBe(target.marker); expect(read[14]).toBe('0');
      const articles = region().locator('article');
      await step(() => expect(articles.nth(0).locator('h4')).toContainText('1. 重复')); await step(() => expect(articles.nth(1).locator('h4')).toContainText('2. 重复'));
      expect(await step(() => articles.nth(0).locator(':scope > small').textContent())).not.toBe(await step(() => articles.nth(1).locator(':scope > small').textContent()));
      await step(() => expect(articles.nth(4)).toContainText(text.binary)); await step(() => expect(articles.nth(5)).toContainText(text.binary + ' · 0'));
      await step(() => expect(region().locator('img,script')).toHaveCount(0)); await step(() => expect(articles.nth(7)).toContainText(text.preview));
      await step(() => articles.nth(7).getByRole('button', { name: text.expand, exact: true }).click()); expect((await rawValues())[7]).toBe(values.long);
      await step(() => articles.nth(7).getByRole('button', { name: text.collapse, exact: true }).click());
      await step(() => expect(region().getByRole('button', { name: text.previous, exact: true })).toBeDisabled());
      await step(() => region().getByRole('button', { name: text.next, exact: true }).click()); expect((await rawValues())[0]).toBe(values.nextBigint); expect((await rawValues())[9]).toBe('隐藏-2');
      await step(() => expect(region().getByRole('button', { name: text.next, exact: true })).toBeDisabled()); await selectionKept();
      await step(() => region().getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(region()).toHaveCount(0)); await selectionKept();
      expect(await history()).toEqual(first.records);

      await step(() => query().getByRole('button', { name: columnsText.open, exact: true }).click());
      const manage = page.getByRole('dialog', { name: columnsText.title, exact: true });
      await step(() => manage.getByRole('checkbox', { name: columnsText.visible(10), exact: true }).uncheck());
      await step(() => manage.getByRole('button', { name: columnsText.apply, exact: true }).click()); await step(() => expect(manage).toBeHidden());
      await step(() => expect(grid()).toHaveAttribute('aria-colcount', '15'));
      // 列布局原行为会清空旧勾选；明确重新勾选，再核详情自身不改变选择。
      await step(() => expect(row(0).getByRole('checkbox')).not.toBeChecked()); await step(() => row(0).getByRole('checkbox').check()); await open();
      await step(() => expect(region().locator('article')).toHaveCount(15)); expect((await rawValues())[9]).toBe('隐藏-1');
      await step(() => expect(region().locator('article').nth(9).locator('h4')).toContainText('10. hidden_value')); await selectionKept(); expect(await history()).toEqual(first.records);

      const second = await execute(sql.second, 2); await step(() => expect(region()).toHaveCount(0));
      await step(() => expect(query().getByRole('button', { name: text.open, exact: true })).toBeDisabled());
      await step(() => expect(grid()).toContainText('二次结果-' + target.marker));
      const final: HistoryEntry[] = await history(); expect(final).toHaveLength(2); expect(final.every(record => record.success && record.connectionId === profile.id)).toBe(true);
      expect(final.map(record => record.sql).sort()).toEqual([first.raw, second.raw].sort());
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
      expect(tasks).toHaveLength(2); expect(tasks.every(task => task.kind === 'query.execute' && task.status === 'completed')).toBe(true);
      expect(runtime.pageErrors).toEqual([]);
      check(); await runtime.confirmOwnedDesktopExit(info); check(true); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      completed = { directory, normalExitConfirmed: true, historyCount: 2 };
    } catch (reason) {
      stopped = true; runtime.retainOwnedDesktopResources(info);
      await info.attach('整行详情保留现场', { body: Buffer.from(JSON.stringify({ directory, automaticRetry: false, automaticRestart: false, automaticForceStop: false, databaseCleanupBySpec: false, directoryRemoved: false })), contentType: 'application/json' });
      throw reason;
    }
  });

  /** strict owner已证明正常退出及所属PID消失后，只读确认临时配置目录确实被原夹具清除。 */
  test.afterAll(async ({}, info) => {
    if (!completed) return;
    let missing = false;
    try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; }
    expect(missing, 'strict owner确认后临时配置目录应已清除').toBe(true);
    await info.attach('整行详情终态', { body: Buffer.from(JSON.stringify({ ...completed, accepted: true, directoryRemoved: true, launches: 1, explicitSqlExecution: 2, databaseCleanupBySpec: false, rootOwnsDatabasePrePostChecks: true, systemClipboard: 0 })), contentType: 'application/json' });
  });
}
