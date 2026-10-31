import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { test, expect, dataDir, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { SelectedResultsUiLifecycle, probeSelectedResultsTarget, type SelectedResultsTarget } from '../helpers/selectedResultsExportUi';
import { zh } from '../../src/renderer/locales/zh-CN';
import { queryContextZh } from '../../src/renderer/locales/queryContext.zh-CN';
import { verifySelectedResultsCsv } from '../helpers/selectedResultsExportCsv';

/** 双门和显式RAM身份通过后才加载；本专项不导入建库helper，不执行任何DDL或DROP。 */
export function registerSelectedResultsExport(binding: SelectedResultsTarget) {
  const states = new WeakMap<TestInfo, SelectedResultsUiLifecycle>();
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => {
    const state = states.get(info);
    if (!state) { retainOwnedDesktopResources(info); throw Error('勾选行验收未建立本例所有权，保留现场'); }
    state.afterEach();
  });
  for (const format of ['json', 'csv'] as const) test(`查询结果勾选行 ${format.toUpperCase()} 按原顺序导出固定快照，切换和新执行清选择且不重执行SQL`, async ({}, info) => {
    const captured = ownedDesktopResources(info), page = captured.page, application = captured.application, directory = dataDir;
    const state = new SelectedResultsUiLifecycle({
      assertCurrent(allowClosed = false) {
        binding.assertCurrent();
        const current = ownedDesktopResources(info);
        if (current.page !== page || current.application !== application || !allowClosed && current.closed) throw Error('勾选行验收所属桌面已变化或关闭');
      },
      closed: () => ownedDesktopResources(info).closed,
      retain: () => retainOwnedDesktopResources(info),
      confirmExit: () => confirmOwnedDesktopExit(info),
    }, info as TestInfo & { _startWallTime?: number });
    states.set(info, state);
    const observe = <T>(action: () => Promise<T>) => state.observe(action);
    try {
      await observe(() => probeSelectedResultsTarget(binding, () => state.assertCurrent(),
        () => mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, connectTimeout: 15000 }),
        native => closeMysqlConnection(native as Parameters<typeof closeMysqlConnection>[0], true)));

      // 只经真实表单建立一个不保存密码、无默认库、无SSH/TLS的临时工作区连接。
      const connectionName = `勾选行 ${format.toUpperCase()} 零DDL验收`;
      await observe(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => binding.assertCurrent())).click());
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await observe(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName));
      // Field包装label包含select选项文字；限定本对话框的combobox与标签前缀，不按完整label文本精确匹配。
      const dialectSelect = form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) });
      await observe(() => expect(dialectSelect).toHaveCount(1));
      await observe(() => dialectSelect.selectOption('mysql'));
      await observe(() => expect(dialectSelect).toHaveValue('mysql'));
      await observe(() => form.getByLabel(zh.connections.text009, { exact: true }).fill(binding.target.host));
      await observe(() => form.getByLabel(zh.connections.text010, { exact: true }).fill(String(binding.target.port)));
      await observe(() => form.getByLabel(zh.common.user, { exact: true }).fill(binding.target.user));
      await observe(() => form.getByLabel(zh.connections.text011, { exact: true }).fill(binding.target.password));
      await observe(() => form.getByLabel(zh.connections.text012, { exact: true }).fill(''));
      await observe(() => expect(form.getByLabel(zh.connections.text012, { exact: true })).toHaveValue(''));
      await observe(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck());
      await observe(() => expect(form.getByLabel(zh.connections.text016, { exact: true })).not.toBeChecked());
      await observe(async () => (await navigationMenuItem(form, { name: zh.connections.text034, exact: true }, () => binding.assertCurrent())).click());
      await observe(() => expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 }));
      await observe(async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => binding.assertCurrent())).click());
      await observe(() => expect(form).toBeHidden());
      const profiles = await observe(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))));
      const profile = profiles.length === 1 ? profiles[0] : undefined;
      // 布尔断言不把认证、服务器UUID或整个连接记录输出到失败差异中。
      // hasPassword同时表示RAM凭据；关闭持久保存后，非空密码仍需留在本例内存供真实查询建连。
      expect(Boolean(profile && profile.name === connectionName && profile.host === binding.target.host && profile.port === binding.target.port && profile.user === binding.target.user && !profile.database && profile.rememberPassword === false && profile.password === undefined && profile.hasPassword === Boolean(binding.target.password) && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);

      // 使用全局新查询表单，明确留空默认库；不展开数据库，更不创建数据库或表。
      await observe(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => binding.assertCurrent())).click());
      const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
      // 此处同样是Field包装的select；动态连接名称不能成为exact label定位的前提。
      const queryConnectionSelect = query.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) });
      await observe(() => expect(queryConnectionSelect).toHaveCount(1));
      await observe(() => queryConnectionSelect.selectOption(profile!.id));
      await observe(() => expect(queryConnectionSelect).toHaveValue(profile!.id));
      await observe(() => query.getByLabel(zh.app.text050, { exact: true }).fill(''));
      await observe(() => expect(query.getByLabel(zh.app.text050, { exact: true })).toHaveValue(''));
      await observe(async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => binding.assertCurrent())).click());
      await observe(() => expect(query).toBeHidden());
      const tab = page.locator('.query-tab:visible');
      await observe(() => expect(tab.locator('[aria-label="当前查询默认库"]')).toHaveText(queryContextZh.none));

      /** 真实键盘编辑及执行按钮；等待本次停止按钮恢复并核无错误，不注入查询结果。 */
      async function execute(sql: string) {
        await observe(() => tab.locator('.monaco-editor').getByRole('textbox').focus());
        await observe(() => page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+A`));
        await observe(() => page.keyboard.insertText(sql));
        await observe(async () => (await navigationMenuItem(tab, { name: zh.query.text011, exact: true }, () => binding.assertCurrent())).click());
        await observe(async () => expect((await navigationMenuItem(tab, { name: zh.common.stop, exact: true }, () => binding.assertCurrent()))).toBeDisabled({ timeout: 20000 }));
        await observe(() => expect(tab.locator('.error-box')).toHaveCount(0));
      }
      await execute("SELECT 1 AS id,CAST('18446744073709551615' AS CHAR) AS repeated,NULL AS repeated,X'00ff' AS bytes UNION ALL SELECT 2,'不选','中间',X'' UNION ALL SELECT 3,'0.12345678901234567890','',NULL ORDER BY id");
      const selected = (await navigationMenuItem(tab, { name: zh.resultExport.selectedTitle, exact: true }, () => binding.assertCurrent()));
      await observe(() => expect(selected).toBeDisabled());
      const rows = tab.locator('.result-body .results-grid [role="row"]');
      await observe(() => rows.nth(3).getByRole('checkbox').check());
      await observe(() => rows.nth(1).getByRole('checkbox').check());
      await observe(() => expect(selected).toBeEnabled());
      const before = await observe(() => page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(item => item.id).sort()));
      const file = join(directory, `selected-query-rows.${format}`);
      // 只回答本例一次原生保存位置；立即恢复原函数，文件授权和导出任务仍走产品实现。
      await observe(() => application.evaluate(({ dialog }, file) => {
        const original = dialog.showSaveDialog;
        dialog.showSaveDialog = (async () => { dialog.showSaveDialog = original; return { canceled: false, filePath: file }; }) as typeof dialog.showSaveDialog;
      }, file));
      await observe(() => selected.click());
      const dialog = page.getByRole('dialog', { name: zh.resultExport.selectedTitle, exact: true });
      await observe(() => expect(dialog).toContainText('仅导出已返回结果中勾选的 2 行'));
      await observe(() => expect(dialog).toContainText('打开时已固定选择快照'));
      await observe(() => dialog.getByRole('combobox', { name: zh.resultExport.format, exact: true }).selectOption(format));
      await observe(() => dialog.getByRole('combobox', { name: zh.resultExport.encoding, exact: true }).selectOption('utf8'));
      await observe(() => dialog.locator('.file-picker').click());
      await observe(async () => (await navigationMenuItem(dialog, { name: zh.resultExport.start, exact: true }, () => binding.assertCurrent())).click());
      await observe(() => expect(dialog.locator('.success-box')).toHaveText('已导出 2 行已返回结果。'));
      const bytes = await observe(() => readFile(file));
      if (format === 'json') {
        const actual = JSON.parse(bytes.toString('utf8'));
        // 此UNION的实际协议列为LONGLONG；生产bigNumberStrings策略必须原样保持字符串。
        expect(actual.map((row: Record<string, unknown>) => row.id)).toEqual(['1', '3']);
        expect(actual[0].repeated).toBe('18446744073709551615'); expect(actual[0]['repeated [3]']).toBeNull();
        expect(actual[0].bytes).toEqual({ type: 'binary', base64: 'AP8=' });
        expect(actual[1].repeated).toBe('0.12345678901234567890'); expect(actual[1].bytes).toBeNull();
      } else verifySelectedResultsCsv(bytes);
      await observe(async () => (await navigationMenuItem(dialog, { name: zh.common.done, exact: true }, () => binding.assertCurrent())).click());
      expect(await observe(() => page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(item => item.id).sort()))).toEqual(before);
      await observe(async () => (await navigationMenuItem(tab, { name: zh.query.pinResult, exact: true }, () => binding.assertCurrent())).click());
      await observe(() => expect(selected).toBeDisabled());
      await observe(() => tab.locator('.pinned-results .current-results').click());
      await observe(() => expect(selected).toBeDisabled());
      await observe(() => rows.nth(1).getByRole('checkbox').check());
      await observe(() => expect(selected).toBeEnabled());
      await execute('SELECT 4 AS next_result');
      await observe(() => expect(selected).toBeDisabled());
      await state.finish(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
    } catch (reason) { state.preserve(); throw reason; }
    finally { state.endBody(); }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
