import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import type { QueryResultColumnsUiTarget } from '../helpers/queryResultColumnsUi';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认与列表不读取认证、不加载桌面；复用原准确目标绑定，不改变既有一条SQL审计。
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_QUERY_RESULT_COLUMNS_UI === '1' && process.env.DBARK_QUERY_RESULT_COMPARISON_LIVE === '1') {
  const { bindQueryResultColumnsUiTarget, queryResultColumnsUiKeys } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const helper = Object.fromEntries(queryResultColumnsUiKeys.filter(key => Object.hasOwn(process.env, key)).map(key => [key, process.env[key]]));
  const binding = bindQueryResultColumnsUiTarget(() => process.env, helper); let invalid = false;
  const guarded = { ...binding, assertCurrent() { binding.assertCurrent(); if (invalid || process.env.DBARK_QUERY_RESULT_COMPARISON_LIVE !== '1') { invalid = true; throw Error('固定结果对比原授权已变化，永久停链'); } } };
  register(guarded);
} else baseTest.skip('固定结果对比真实客户端验收默认关闭（未执行）', () => {});

/** 独立两次常量SELECT，沿原窗口严格生命周期；对比只有UI操作，没有业务算法或状态注入。 */
function register(binding: QueryResultColumnsUiTarget): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), test = runtime.test;
  const { comparisonLeftSql, comparisonRightSql, installComparisonAudit, readComparisonAudit, QueryResultComparisonLifetime } = require('../helpers/queryResultComparisonUi') as typeof import('../helpers/queryResultComparisonUi');
  const { assertQueryResultColumnsUiIdentity, closeQueryResultColumnsObserver, guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { queryResultComparisonZh: text } = require('../../src/renderer/locales/queryResultComparison.zh-CN') as typeof import('../../src/renderer/locales/queryResultComparison.zh-CN');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const cases = new Map<TestInfo, { life: InstanceType<typeof QueryResultComparisonLifetime> }>(); let halted = false;
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { const current = cases.get(info); if (!current) { halted = true; runtime.retainOwnedDesktopResources(info); throw Error('固定结果对比未建立本例owner'); } try { current.life.afterEach(); cases.delete(info); } catch (reason) { halted = true; throw reason; } });
  test('准确13384两份固定结果按明确键比较：增删改同各一行与精确原值', async ({ trace, screenshot, video }, info) => {
    if (halted) throw Error('固定结果对比前例已保留，停止后续');
    const { mkdir } = require('node:fs/promises') as typeof import('node:fs/promises'), { relative, isAbsolute } = require('node:path') as typeof import('node:path');
    const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
    const owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
    let observer: import('mysql2/promise').Connection | undefined, native: any, stream: any, armed = false;
    const life = new QueryResultComparisonLifetime({ check(allowClosed) { binding.assertCurrent(); const now = runtime.ownedDesktopResources(info); if (now.page !== page || now.application !== application || !allowClosed && now.closed) throw Error('固定结果对比原owner已变化'); }, closed: () => runtime.ownedDesktopResources(info).closed, retain: () => { halted = true; runtime.retainOwnedDesktopResources(info); }, async exit() { life.check(); await application.evaluate(readComparisonAudit); life.check(); await application.evaluate(guardQueryResultColumnsExitAnswers); life.check(); await runtime.confirmOwnedDesktopExit(info); } }, info as TestInfo & { _startWallTime?: number });
    cases.set(info, { life });
    /** 每步先后都核原handler、目标和原期限；失败不继续补查或退出。 */
    const step = <T,>(action: () => Promise<T>) => life.observe(async () => { if (armed) await application.evaluate(readComparisonAudit); const result = await action(); if (armed) await application.evaluate(readComparisonAudit); return result; });
    try {
      life.check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      // 仅封闭本例独占页面的剪贴板接口；内存粘贴不得读取或覆盖系统剪贴板。
      await step(() => page.evaluate(() => {
        let attempts = 0;
        const blocked = async () => { attempts++; throw Error('本例禁止访问系统剪贴板'); };
        Object.defineProperty(navigator, 'clipboard', { value: Object.freeze({ read: blocked, readText: blocked, write: blocked, writeText: blocked }), configurable: false });
        Object.defineProperty(window, '__dbarkComparisonClipboardAttempts', { get: () => attempts, configurable: false });
      }));
      const nested = relative(runtime.dataDir, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('独占输出不得位于fixture自动清理目录');
      await step(() => mkdir(binding.target.output, { recursive: false }));
      await step(async () => { observer = await mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, connectTimeout: 15000 }); native = (observer as any).connection; stream = native?.stream; if (!native || !stream) throw Error('观察连接原生归属未知'); });
      assertQueryResultColumnsUiIdentity(await step(() => observer!.query('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')), binding.target.uuid);
      const connectionName = '固定结果对比本例';
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, connectionName], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, '']]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
      expect(Boolean(profile.name === connectionName && profile.host === binding.target.host && profile.port === binding.target.port && profile.user === binding.target.user && !profile.database && profile.rememberPassword === false && profile.password === undefined && profile.hasPassword === Boolean(binding.target.password) && !profile.tls?.enabled && !profile.ssh?.enabled)).toBe(true);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
      await step(() => query.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile.id)); await step(() => query.getByLabel(zh.app.text050, { exact: true }).fill('')); await step(() => query.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(query).toBeHidden());
      const tab = page.locator('.query-tab:visible');
      /** 清空后派发内存粘贴，经过编辑器正式paste处理，不直接写model或工作区。 */
      async function edit(sql: string) {
        const mac=process.platform==='darwin';
        // 全选之后先真实清空并等正式读回，不能仅凭按过快捷键就假定整段已替换。
        const nativeWindow=await step(()=>application.browserWindow(page));await step(()=>nativeWindow.evaluate(window=>window.focus()));await step(()=>nativeWindow.dispose());
        await step(()=>tab.locator('.monaco-editor').getByRole('textbox').focus());
        await step(()=>page.keyboard.press(mac?'Meta+ArrowUp':'Control+Home'));await step(()=>page.keyboard.press(mac?'Meta+Shift+ArrowDown':'Control+Shift+End'));await step(()=>page.keyboard.press('Backspace'));
        const body=async()=>{const settings=await step(()=>page.evaluate(()=>window.dbark.invoke('settings.get',{})));return settings.tabs.find(item=>item.id===settings.activeTabId)?.sql??'';};
        await step(()=>expect.poll(body).toBe(''));
        await step(()=>tab.locator('.monaco-editor').getByRole('textbox').evaluate((element, value) => {
          const data = new DataTransfer(); data.setData('text/plain', value);
          // Monaco增强粘贴会补读系统resources；明确空URI列表后只消费本次内存内容。
          data.setData('text/uri-list', '');
          if (document.activeElement !== element || data.files.length !== 0 || [...data.types].sort().join('|') !== 'text/plain|text/uri-list') throw Error('内存粘贴目标或格式不符');
          const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
          if (event.clipboardData !== data) throw Error('内存粘贴数据身份不符');
          element.dispatchEvent(event);
          if (!event.defaultPrevented) throw Error('编辑器未接管本次内存粘贴');
        }, sql));
        await step(()=>expect.poll(body).toBe(sql));
      }
      await edit(comparisonLeftSql);
      const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), tabId = settings.activeTabId;
      if (typeof tabId !== 'string' || !tabId) throw Error('本例查询标签身份未确认');
      expect(settings.tabs.filter(item => item.id === tabId && item.kind === 'query' && item.connectionId === profile.id)).toHaveLength(1);
      const ownWindow = await step(() => application.browserWindow(page)), senderId = await step(() => ownWindow.evaluate(window => window.webContents.id)); await step(() => ownWindow.dispose());
      const auditTarget: import('../helpers/queryResultComparisonUi').ComparisonAuditTarget = { senderId, profileId: profile.id, tabId, sqls: [comparisonLeftSql, comparisonRightSql], maxRows: settings.resultLimit, deadline: (info as TestInfo & { _startWallTime?: number })._startWallTime! + 120000 }; await step(() => application.evaluate(installComparisonAudit, auditTarget)); armed = true;
      /** 两次执行分别固定原始结果，快照标签通过真实可见按钮取值，不读React状态。 */
      async function executeAndPin() { await step(() => tab.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect(tab.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled({ timeout: 20000 })); await step(() => expect(tab.locator('.error-box')).toHaveCount(0)); await step(() => tab.getByRole('button', { name: zh.query.pinResult, exact: true }).click()); }
      await executeAndPin(); const leftLabel = await step(() => tab.locator('.pinned-result > button[aria-pressed]').first().innerText());
      await step(() => tab.getByRole('button', { name: zh.query.currentResults, exact: true }).click()); await edit(comparisonRightSql); await executeAndPin();
      const rightLabel = await step(() => tab.locator('.pinned-result > button[aria-pressed]').nth(1).innerText()); expect(rightLabel).not.toBe(leftLabel);
      await step(() => tab.getByRole('button', { name: text.open, exact: true }).click()); const comparison = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(comparison).toBeVisible());
      const leftSelect = comparison.getByRole('combobox', { name: text.left, exact: true }), rightSelect = comparison.getByRole('combobox', { name: text.right, exact: true });
      const leftId = await step(() => leftSelect.locator('option').filter({ hasText: leftLabel.trim() }).getAttribute('value')), rightId = await step(() => rightSelect.locator('option').filter({ hasText: rightLabel.trim() }).getAttribute('value'));
      if (!leftId || !rightId || leftId === rightId) throw Error('原固定快照选项身份不明确');
      await step(() => leftSelect.selectOption(leftId)); await step(() => rightSelect.selectOption(rightId));
      await step(() => expect(comparison.getByRole('checkbox', { name: text.key('c0'), exact: true })).not.toBeChecked());
      await step(() => expect(comparison.getByRole('button', { name: text.start, exact: true })).toBeDisabled());
      await step(() => comparison.getByRole('checkbox', { name: text.key('c0'), exact: true }).check()); await step(() => comparison.getByRole('button', { name: text.start, exact: true }).click());
      for (const label of [text.added, text.removed, text.changed, text.equal]) await step(() => expect(comparison.getByLabel(label, { exact: true })).toHaveText('1'));
      // 详情按全结果索引定位，先从实际分类行找到“修改”；不调用产品算法计算期望。
      const changed = comparison.locator('tbody > tr').filter({ hasText: text.changed });
      await step(() => changed.getByRole('button', { name: /^查看差异 [0-9]+$/ }).click()); const detail = comparison.getByRole('region', { name: text.detailsTitle, exact: true });
      for (const [key, left, right] of [['c1', '"9007199254740993"', '"9007199254740994"'], ['c2', '"1.00000000000000000001"', '"1.00000000000000000002"'], ['c3', text.nullValue, '"" · ' + text.emptyString], ['c4', text.binary + ' AA==', text.binary + ' ']]) {
        await step(() => expect(detail.getByLabel(text.leftValue + ' ' + key, { exact: true })).toHaveText(text.leftValue + '：' + left)); await step(() => expect(detail.getByLabel(text.rightValue + ' ' + key, { exact: true })).toHaveText(text.rightValue + '：' + right));
      }
      await step(() => comparison.getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(comparison).toBeHidden());
      const audit = await step(() => application.evaluate(readComparisonAudit)); expect(audit).toEqual({ queries: 2, pending: 0, revision: 0 }); expect(runtime.pageErrors).toEqual([]);
      expect(await step(() => page.evaluate(() => (window as unknown as { __dbarkComparisonClipboardAttempts: number }).__dbarkComparisonClipboardAttempts))).toBe(0);
      await step(() => info.attach('固定结果对比原始计数', { body: JSON.stringify(audit), contentType: 'application/json' }));
      await life.finish(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})), () => closeQueryResultColumnsObserver(observer! as import('mysql2/promise').Connection & { connection?: unknown }, native, stream, () => life.check(true), value => closeMysqlConnection(value, true, false, life.remaining(1000))));
    } catch (reason) { life.preserve(); throw reason; } finally { life.endBody(); }
  });
}
