import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认与列表仅登记关闭状态，不读认证、不载入桌面或实库帮助器。
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_EXPLAIN_PROPERTIES_UI === '1') {
  const { bindExplainPropertiesUi } = require('../helpers/explainPropertiesUi') as typeof import('../helpers/explainPropertiesUi');
  register(bindExplainPropertiesUi(() => ({ env: process.env, platform: process.platform })));
} else baseTest.skip('执行计划属性与查找实库窗口验收默认关闭（未执行）', () => {});

/** 仅常量派生表的一次正式EXPLAIN；本地查找、属性阅读与文件留证不重发SQL。 */
function register(binding: ReturnType<typeof import('../helpers/explainPropertiesUi')['bindExplainPropertiesUi']>): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { explainPropertiesSql: sql, installExplainPropertiesAudit, readExplainPropertiesAudit } = require('../helpers/explainPropertiesUi') as typeof import('../helpers/explainPropertiesUi');
  const { guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { explainZh: text } = require('../../src/renderer/locales/explain.zh-CN') as typeof import('../../src/renderer/locales/explain.zh-CN');
  let halted = false;
  const cases = new Map<object, { complete: boolean; check(): void }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { try { const value = cases.get(info); if (!value?.complete) throw Error('计划属性原例未完成，保留资源'); value.check(); cases.delete(info); } catch (error) { halted = true; runtime.retainOwnedDesktopResources(info); throw error; } });
  test('真实常量EXPLAIN属性原值、折叠查找展开及零额外查询', async ({ trace, screenshot, video }, info) => {
    if (halted) throw Error('计划属性前例停链，不启动后续');
    const { mkdir, writeFile } = require('node:fs/promises') as typeof import('node:fs/promises'), { join, relative, isAbsolute } = require('node:path') as typeof import('node:path');
    const captured = runtime.ownedDesktopResources(info), { page, application } = captured, directory = runtime.dataDir;
    let armed = false, closed = false;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { binding.assertCurrent(); const owner = runtime.ownedDesktopResources(info); if (owner.page !== page || owner.application !== application || runtime.dataDir !== directory) throw Error('计划属性原窗口已变化'); } }, () => test.info());
    const completion = { complete: false, check() { clock.assertCurrent(); if (!closed || !runtime.ownedDesktopResources(info).closed) throw Error('计划属性原窗口未确认退出'); } }; cases.set(info, completion);
    /** 每步核对原期限、窗口、环境和准确Main审计；失败保留，不补发或补关。 */
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { clock.assertCurrent(); if (armed) { await application.evaluate(readExplainPropertiesAudit); clock.assertCurrent(); } const result = await action(); clock.assertCurrent(); if (armed && !allowClosed) { await application.evaluate(readExplainPropertiesAudit); clock.assertCurrent(); } return result; };
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); const nested = relative(directory, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('输出不得位于本例临时profile'); await step(() => mkdir(binding.target.output, { recursive: false }));
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '计划属性本例'], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, '']]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '计划属性本例' && profile.host === binding.target.host && profile.port === 13384 && profile.user === binding.target.user && profile.rememberPassword === false && !profile.database && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true }); await step(() => newQuery.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile.id)); await step(() => newQuery.getByLabel(zh.app.text050, { exact: true }).fill('')); await step(() => newQuery.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(newQuery).toBeHidden());
      const tab = page.locator('.query-tab:visible'), editor = tab.locator('.monaco-editor textarea'); await step(() => editor.focus()); await step(() => page.keyboard.press('Control+A')); await step(() => page.keyboard.insertText(sql));
      let tabId = ''; await step(() => expect.poll(async () => { const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); const own = settings.tabs.find(value => value.id === settings.activeTabId); if (own?.kind === 'query' && own.connectionId === profile.id && own.sql === sql) { tabId = own.id; return true; } return false; }).toBe(true));
      const nativeWindow = await step(() => application.browserWindow(page)), senderId = await step(() => nativeWindow.evaluate(native => native.webContents.id)); await step(() => nativeWindow.evaluate(native => native.setSize(1024, 680))); await step(() => nativeWindow.dispose()); await step(() => application.evaluate(installExplainPropertiesAudit, { senderId, profileId: profile.id, tabId, sql })); armed = true;
      await step(() => tab.getByRole('button', { name: '执行计划', exact: true }).click()); await step(() => expect(tab.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled({ timeout: 20000 })); await step(() => expect(tab.locator('.error-box')).toHaveCount(0));
      const plan = tab.getByRole('region', { name: text.title, exact: true }), search = plan.getByRole('textbox', { name: text.find, exact: true }), count = plan.getByRole('status', { name: text.findCount, exact: true });
      await step(() => expect(plan.getByRole('tree')).toBeVisible()); await step(() => plan.getByRole('button', { name: text.collapse, exact: true }).click()); await step(() => expect(plan.getByRole('treeitem')).toHaveCount(1));
      await step(() => search.fill('using_filesort')); await step(() => expect(count).toHaveText(text.matches(0, 1))); await step(() => plan.getByRole('button', { name: text.next, exact: true }).click());
      await step(() => expect(plan.getByRole('treeitem', { selected: true })).toBeFocused()); await step(() => expect(plan.getByRole('treeitem', { selected: true })).toContainText(text.kinds.ordering_operation));
      const properties = plan.getByLabel(text.details, { exact: true }).locator('.explain-properties');
      await step(() => expect(properties.locator('div').filter({ has: page.locator('dt', { hasText: 'using_filesort' }) }).locator('dd')).toHaveText('true'));
      await step(() => search.fill('using_temporary_table')); await step(() => expect(count).toHaveText(text.matches(0, 2))); await step(() => plan.getByRole('button', { name: text.next, exact: true }).click());
      const temporary = () => properties.locator('div').filter({ has: page.locator('dt', { hasText: 'using_temporary_table' }) }).locator('dd'); await step(() => expect(temporary()).toHaveText('true')); await step(() => plan.getByRole('button', { name: text.next, exact: true }).click()); await step(() => expect(temporary()).toHaveText('false')); await step(() => plan.getByRole('button', { name: text.previous, exact: true }).click()); await step(() => expect(temporary()).toHaveText('true'));
      await step(() => search.fill('used_columns')); await step(() => plan.getByRole('button', { name: text.next, exact: true }).click()); await step(() => expect(properties.locator('div').filter({ has: page.locator('dt', { hasText: 'used_columns' }) }).locator('dd')).toHaveText('["dbark_plan_value"]'));
      // 仅截取公开常量计划区域，认证表单已关闭；不录制用户桌面或其他窗口。
      expect(await step(() => plan.evaluate(element => element.scrollWidth <= element.clientWidth))).toBe(true); await step(() => plan.screenshot({ path: info.outputPath('plan-properties.png') }));
      await step(() => plan.getByRole('button', { name: text.clear, exact: true }).click()); await step(() => expect(search).toHaveValue('')); await step(() => plan.getByRole('button', { name: text.raw, exact: true }).click()); const raw = await step(() => plan.getByLabel(text.raw, { exact: true }).innerText()); const document = JSON.parse(raw);
      expect(document.query_block.ordering_operation.using_filesort).toBe(true); expect(document.query_block.ordering_operation.table.materialized_from_subquery.using_temporary_table).toBe(true); expect(document.query_block.ordering_operation.table.materialized_from_subquery.query_block.union_result.using_temporary_table).toBe(false); if (Buffer.byteLength(raw) > 32768) throw Error('本例计划超出预算'); await step(() => writeFile(join(binding.target.output, 'plan.json'), raw, { flag: 'wx' }));
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks).toHaveLength(1); expect(tasks.map(task => [task.kind, task.status])).toEqual([['query.explain', 'completed']]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const audit = await step(() => application.evaluate(readExplainPropertiesAudit)); expect(audit).toEqual({ explains: 1, sessions: 1, pending: 0 }); await step(() => info.attach('计划属性真实计数', { body: JSON.stringify(audit), contentType: 'application/json' }));
      await step(() => application.evaluate(guardQueryResultColumnsExitAnswers)); await step(() => runtime.confirmOwnedDesktopExit(info), true); closed = true; armed = false; completion.complete = true; completion.check();
    } catch (error) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw error; }
  });
}
