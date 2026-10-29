import { test as baseTest } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认/列表不加载桌面，也不读取输出或认证；仅显式新门授权离线临时窗口。
if (!listing && process.env.DBARK_CONNECTION_ORGANIZATION_UI === '1') {
  const { bindConnectionOrganizationUi } = require('../helpers/connectionOrganizationUi') as typeof import('../helpers/connectionOrganizationUi');
  register(bindConnectionOrganizationUi(() => ({ env: process.env, platform: process.platform })));
} else baseTest.skip('连接批量整理离线窗口验收默认关闭（未执行）', () => {});

/** 正常表单建立三份空认证测试配置，真实预览/保存后退出并只复制本例SQLite供独立读回。 */
function register(binding: ReturnType<typeof import('../helpers/connectionOrganizationUi')['bindConnectionOrganizationUi']>): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { installConnectionOrganizationAudit, readConnectionOrganizationAudit } = require('../helpers/connectionOrganizationUi') as typeof import('../helpers/connectionOrganizationUi');
  const { guardQueryResultColumnsExitAnswers } = require('../helpers/queryResultColumnsUi') as typeof import('../helpers/queryResultColumnsUi');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { connectionOrganizationZh: text } = require('../../src/shared/connectionOrganization.zh-CN') as typeof import('../../src/shared/connectionOrganization.zh-CN');
  let halted = false;
  const cases = new Map<object, { check(): void; complete: boolean }>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { try { const current = cases.get(info); if (!current?.complete) throw Error('连接整理本例未完成，保留原资源'); current.check(); cases.delete(info); } catch (error) { halted = true; runtime.retainOwnedDesktopResources(info); throw error; } });
  test('真实三连接隐藏选择预览及原子整理，零数据库请求并正常退出', async ({ trace, screenshot, video }, info) => {
    if (halted) throw Error('连接整理前例已保留，停止后续');
    const { mkdir, readFile, writeFile } = require('node:fs/promises') as typeof import('node:fs/promises'), { join, relative, isAbsolute } = require('node:path') as typeof import('node:path');
    const captured = runtime.ownedDesktopResources(info), { page, application } = captured, directory = runtime.dataDir;
    let armed = false, closed = false;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { binding.assertCurrent(); const owner = runtime.ownedDesktopResources(info); if (owner.page !== page || owner.application !== application || runtime.dataDir !== directory) throw Error('连接整理owner已变化'); } }, () => test.info());
    const completion = { complete: false, check() { clock.assertCurrent(); if (!closed || !runtime.ownedDesktopResources(info).closed) throw Error('连接整理原窗口尚未正常退出'); } }; cases.set(info, completion);
    /** 原期限、原owner、原审计逐步复核；失败不再补动作或退出。 */
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { clock.assertCurrent(); if (closed && !allowClosed) throw Error('原窗口已关闭'); if (armed) await application.evaluate(readConnectionOrganizationAudit); const value = await action(); clock.assertCurrent(); if (armed && !allowClosed) await application.evaluate(readConnectionOrganizationAudit); return value; };
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const nested = relative(directory, binding.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('输出不得位于自动清理的本例profile');
      await step(() => mkdir(binding.output, { recursive: false }));
      const nativeWindow = await step(() => application.browserWindow(page)), sender = await step(() => nativeWindow.evaluate(native => native.webContents.id)); await step(() => nativeWindow.dispose());
      await step(() => application.evaluate(installConnectionOrganizationAudit, sender)); armed = true;
      for (const [name, group] of [['整理甲', ''], ['整理乙', '未分组'], ['整理丙', '原开发组']]) {
        await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
        for (const [label, value] of [[zh.connections.text006, name], [zh.connections.text013, group], [zh.connections.text009, '127.0.0.1'], [zh.connections.text010, '3306'], [zh.common.user, 'dbark_synthetic'], [zh.connections.text011, '']]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
        await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      }
      await step(() => expect(page.locator('.connection-group-heading')).toHaveCount(3));
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(3);
      await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: text.open, exact: true }).click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true });
      await step(() => expect(dialog.getByRole('button', { name: text.visibleSelect, exact: true })).toBeEnabled());
      for (const group of ['', '未分组']) await step(() => expect(dialog.getByRole('table', { name: text.list, exact: true })).toContainText(text.groupDisplay(group)));
      await step(() => dialog.getByRole('button', { name: text.visibleSelect, exact: true }).click()); await step(() => dialog.getByRole('textbox', { name: text.search, exact: true }).fill('整理乙'));
      await step(() => expect(dialog.getByRole('table', { name: text.list, exact: true }).locator('tbody > tr')).toHaveCount(1));
      await step(() => dialog.getByRole('checkbox', { name: text.editGroup, exact: true }).check()); await step(() => dialog.getByRole('textbox', { name: text.group, exact: true }).fill('本轮批量组'));
      await step(() => dialog.getByRole('checkbox', { name: text.editColor, exact: true }).check()); await step(() => dialog.getByLabel(text.color, { exact: true }).fill('#123456'));
      await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); const preview = dialog.getByRole('region', { name: text.previewTitle, exact: true });
      await step(() => expect(preview.locator('tbody > tr')).toHaveCount(3)); for (const profile of profiles) for (const value of [profile.name, '本轮批量组', '#123456']) await step(() => expect(preview.getByRole('row', { name: text.previewRow(profile.id), exact: true })).toContainText(value));
      await step(() => dialog.getByRole('button', { name: text.startApply, exact: true }).click()); await step(() => expect(dialog.getByText(text.success, { exact: true })).toBeVisible());
      await step(() => dialog.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => expect(dialog.getByRole('button', { name: text.preview, exact: true })).toBeEnabled());
      await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect(page.locator('.connection-group-heading')).toHaveCount(1));
      const after = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(after.map(profile => ({ ...profile, group: '', color: '' }))).toEqual(profiles.map(profile => ({ ...profile, group: '', color: '' }))); for (const profile of after) expect([profile.group, profile.color]).toEqual(['本轮批量组', '#123456']);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const audit = await step(() => application.evaluate(readConnectionOrganizationAudit)); expect(audit).toEqual({ saved: 3, gets: 2, applied: 1, pending: 0 }); await step(() => info.attach('连接整理真实计数', { body: JSON.stringify(audit), contentType: 'application/json' }));
      await step(() => application.evaluate(guardQueryResultColumnsExitAnswers)); await step(() => runtime.confirmOwnedDesktopExit(info), true); closed = true; armed = false;
      expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      const bytes = await step(() => readFile(join(directory, 'dbark.sqlite')), true); if (bytes.length > 2 * 1024 * 1024) throw Error('本例配置超出读取预算'); await step(() => writeFile(join(binding.output, 'organization.sqlite'), bytes, { flag: 'wx' }), true);
      clock.assertCurrent(); completion.complete = true;
    } catch (error) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw error; }
  });
}
