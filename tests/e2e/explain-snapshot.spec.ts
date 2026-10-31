import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认和列表模式不加载桌面、认证或实库帮助器。
if (!listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_EXPLAIN_PROPERTIES_UI === '1') {
  const { bindExplainPropertiesUi } = require('../helpers/explainPropertiesUi') as typeof import('../helpers/explainPropertiesUi');
  register(bindExplainPropertiesUi(() => ({ env: process.env, platform: process.platform })));
} else baseTest.skip('执行计划快照真实保存及独立离线重开验收默认关闭（未执行）', () => {});

/** 两例分别使用独立临时 profile；前例失败即在下一例桌面启动前停链。 */
function register(binding: ReturnType<typeof import('../helpers/explainPropertiesUi')['bindExplainPropertiesUi']>): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { explainPropertiesSql: sql } = require('../helpers/explainPropertiesUi') as typeof import('../helpers/explainPropertiesUi');
  const { installExplainSnapshotAudit, readExplainSnapshotAudit } = require('../helpers/explainSnapshotUi') as typeof import('../helpers/explainSnapshotUi');
  const { guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { explainZh: planText } = require('../../src/renderer/locales/explain.zh-CN') as typeof import('../../src/renderer/locales/explain.zh-CN');
  const { explainSnapshotZh: text } = require('../../src/shared/explainSnapshot.zh-CN') as typeof import('../../src/shared/explainSnapshot.zh-CN');
  const { join, relative, isAbsolute } = require('node:path') as typeof import('node:path');
  const paths = { json: join(binding.target.output, 'json.dbark-plan.json'), text: join(binding.target.output, 'text.dbark-plan.json'), jsonResaved: join(binding.target.output, 'json-resaved.dbark-plan.json'), textResaved: join(binding.target.output, 'text-resaved.dbark-plan.json') };
  let halted = false, liveComplete = false;
  const cases = new Map<object, { complete: boolean; check(): void }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: { assertCurrent() { binding.assertCurrent(); if (halted) throw Error('快照前例已停链，禁止启动后例'); } } });
  test.setTimeout(120000); test.describe.configure({ retries: 0, mode: 'serial' });
  test.afterEach(({}, info) => { try { const value = cases.get(info); if (!value?.complete) throw Error('快照原例未完成，保留资源'); value.check(); cases.delete(info); } catch (error) { halted = true; runtime.retainOwnedDesktopResources(info); throw error; } });

  for (const mode of ['live', 'offline'] as const) test(mode === 'live' ? '真实MySQL正式保存JSON及文本计划快照' : '全新无连接App正式离线打开及另存两种快照', async ({ trace, screenshot, video }, info) => {
    if (halted || mode === 'offline' && !liveComplete) throw Error('快照前例未完成，不启动后例');
    const captured = runtime.ownedDesktopResources(info), { page, application } = captured, directory = runtime.dataDir;
    let armed = false, closed = false;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { binding.assertCurrent(); const owner = runtime.ownedDesktopResources(info); if (owner.page !== page || owner.application !== application || runtime.dataDir !== directory) throw Error('快照原窗口归属已变化'); } }, () => test.info());
    const completion = { complete: false, check() { clock.assertCurrent(); if (!closed || !runtime.ownedDesktopResources(info).closed) throw Error('快照原窗口尚未确认退出'); } }; cases.set(info, completion);
    /** 每个原始 await 前后都核同一文档与原审计；失败不补发、不补关。 */
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { clock.assertCurrent(); if (armed) { await application.evaluate(readExplainSnapshotAudit); clock.assertCurrent(); } const value = await action(); clock.assertCurrent(); if (armed && !allowClosed) { await application.evaluate(readExplainSnapshotAudit); clock.assertCurrent(); } return value; };
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const nested = relative(directory, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('快照输出不得位于本例profile');
      const fs = require('node:fs/promises') as typeof import('node:fs/promises');
      if (mode === 'live') await step(() => fs.mkdir(binding.target.output, { recursive: false }));
      else { const stat = await step(() => fs.lstat(binding.target.output)); expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true); }
      let profileId: string | undefined, tabId: string | undefined;
      if (mode === 'live') {
        await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => clock.assertCurrent())).click());
        const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
        for (const [label, value] of [[zh.connections.text006, '快照本例'], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, '']]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
        await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(form).toBeHidden());
        const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); const profile = profiles[0]; profileId = profile.id;
        expect(Boolean(profile.name === '快照本例' && profile.host === binding.target.host && profile.port === 13384 && profile.user === binding.target.user && profile.rememberPassword === false && profile.password === undefined && !profile.database && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
        await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => clock.assertCurrent())).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
        await step(() => query.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile.id)); await step(() => query.getByLabel(zh.app.text050, { exact: true }).fill('')); await step(async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(query).toBeHidden());
        const editor = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox'); await step(() => expect(editor).toBeVisible()); await step(() => editor.focus()); await step(() => page.keyboard.press('Control+A')); await step(() => page.keyboard.insertText(sql));
        await step(() => expect.poll(async () => { const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); const own = settings.tabs.find(tab => tab.id === settings.activeTabId); if (settings.tabs.length === 1 && own?.kind === 'query' && own.connectionId === profile.id && own.sql === sql) { tabId = own.id; return true; } return false; }).toBe(true));
      }
      const nativeWindow = await step(() => application.browserWindow(page)), senderId = await step(() => nativeWindow.evaluate(native => native.webContents.id));
      await step(() => nativeWindow.evaluate(native => native.setSize(1100, 760))); await step(() => nativeWindow.dispose());
      await step(() => application.evaluate(installExplainSnapshotAudit, { senderId, mode, profileId, tabId, sql: mode === 'live' ? sql : undefined, paths })); armed = true;
      if (mode === 'live') {
        const tab = page.locator('.query-tab:visible'); await step(async () => (await navigationMenuItem(tab, { name: '执行计划', exact: true }, () => clock.assertCurrent())).click());
        for (const format of ['json', 'text'] as const) {
          await step(async () => expect((await navigationMenuItem(tab, { name: zh.common.stop, exact: true }, () => clock.assertCurrent()))).toBeDisabled({ timeout: 20000 })); await step(() => expect(tab.locator('.error-box')).toHaveCount(0));
          const plan = tab.getByRole('region', { name: planText.title, exact: true }); await step(() => expect(plan).toBeVisible());
          if (format === 'json') { await step(() => expect(plan.getByRole('tree')).toBeVisible()); await step(async () => (await navigationMenuItem(plan, { name: planText.raw, exact: true }, () => clock.assertCurrent())).click()); const raw = await step(() => plan.getByLabel(planText.raw, { exact: true }).innerText()); expect(JSON.parse(raw).query_block.ordering_operation.using_filesort).toBe(true); expect(raw).toContain('dbark_plan_value'); }
          else { await step(async () => (await navigationMenuItem(plan, { name: planText.table, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(plan.getByRole('grid')).toBeVisible()); await step(() => expect(plan.getByRole('columnheader').filter({ hasText: 'select_type' })).toBeVisible()); }
          await step(async () => (await navigationMenuItem(plan, { name: text.save, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(plan.getByRole('status').filter({ hasText: text.saved(format + '.dbark-plan.json') })).toBeVisible());
          if (format === 'json') await step(async () => (await navigationMenuItem(plan, { name: planText.text, exact: true }, () => clock.assertCurrent())).click());
        }
        expect((await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).map(task => [task.kind, task.status])).toEqual([['query.explain', 'completed'], ['query.explain', 'completed']]);
      } else {
        expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual([]);
        await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.entry, exact: true }, () => clock.assertCurrent())).click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(dialog).toContainText(text.notice));
        for (const format of ['json', 'text'] as const) {
          await step(async () => (await navigationMenuItem(dialog, { name: text.choose, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(dialog.getByRole('status').filter({ hasText: text.opened(format + '.dbark-plan.json') })).toBeVisible());
          const plan = dialog.getByRole('region', { name: planText.title, exact: true }); await step(async () => expect((await navigationMenuItem(plan, { name: planText.text, exact: true }, () => clock.assertCurrent()))).toHaveCount(0)); await step(async () => expect((await navigationMenuItem(dialog, { name: '执行计划', exact: true }, () => clock.assertCurrent()))).toHaveCount(0)); await step(() => expect(dialog.locator('.monaco-editor')).toHaveCount(0));
          if (format === 'json') {
            await step(() => expect(plan.getByRole('tree')).toBeVisible()); await step(async () => (await navigationMenuItem(plan, { name: planText.collapse, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(plan.getByRole('treeitem')).toHaveCount(1));
            const search = plan.getByRole('textbox', { name: planText.find, exact: true }); await step(() => search.fill('using_filesort')); await step(() => expect(plan.getByRole('status', { name: planText.findCount, exact: true })).toHaveText(planText.matches(0, 1))); await step(() => search.press('Enter')); await step(() => expect(plan.getByRole('treeitem', { selected: true })).toBeFocused());
            const selected = plan.getByRole('treeitem', { selected: true }); await step(() => expect(selected).toBeInViewport({ ratio: 1 })); await step(() => selected.screenshot({ path: info.outputPath('offline-plan-selected.png') }));
            await step(async () => (await navigationMenuItem(plan, { name: planText.raw, exact: true }, () => clock.assertCurrent())).click()); const raw = await step(() => plan.getByLabel(planText.raw, { exact: true }).innerText()); expect(JSON.parse(raw).query_block.ordering_operation.using_filesort).toBe(true);
          } else { await step(() => expect(plan.getByRole('grid')).toBeVisible()); await step(() => expect(plan.getByRole('columnheader').filter({ hasText: 'select_type' })).toBeVisible()); }
          await step(async () => (await navigationMenuItem(plan, { name: text.saveAs, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(plan.getByRole('status').filter({ hasText: text.saved(format + '-resaved.dbark-plan.json') })).toBeVisible());
        }
        await step(async () => (await navigationMenuItem(dialog, { name: text.close, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(dialog).toBeHidden());
        expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect((await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).tabs).toEqual([]);
      }
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const audit = await step(() => application.evaluate(readExplainSnapshotAudit)); expect(audit).toEqual(mode === 'live' ? { explains: 2, sessions: 1, saves: 2, opens: 0, dialogs: 2, pending: 0 } : { explains: 0, sessions: 0, saves: 2, opens: 2, dialogs: 4, pending: 0 });
      await step(() => info.attach('计划快照真实计数-' + mode, { body: JSON.stringify(audit), contentType: 'application/json' }));
      await step(() => application.evaluate(guardQueryResultColumnsExitAnswers)); await step(() => runtime.confirmOwnedDesktopExit(info), true); closed = true; armed = false; completion.complete = true; completion.check(); if (mode === 'live') liveComplete = true;
    } catch (error) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw error; }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
