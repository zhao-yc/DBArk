import { mkdir, readFile, stat, lstat, realpath, readdir } from 'node:fs/promises';
import { relative, isAbsolute, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import mysql from 'mysql2/promise';
import { parse } from 'csv-parse/sync';
import type { TestInfo } from '@playwright/test';
import { test, expect, dataDir, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { closeMysqlConnection } from '../../src/engine/connection';
import { QueryResultColumnsUiLifetime, assertQueryResultColumnsUiIdentity, closeQueryResultColumnsObserver, guardQueryResultColumnsExitAnswers, installQueryResultColumnsAudit, readQueryResultColumnsAudit, answerQueryResultColumnsSave, type QueryResultColumnsUiTarget } from '../helpers/queryResultColumnsUi';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultValueOptionsZh as text } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultHistoryZh as historyText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';

// 66行自带常量，一次SELECT；不读取表/业务库，不运行存储函数，不创建资源。
const sql = Array.from({ length: 66 }, (_, index) => {
  const category = index === 0 ? 'NULL' : "'" + (index === 1 ? '' : index === 2 ? 'NULL' : index < 5 ? 'A' : '分类' + String(index).padStart(2, '0')) + "'";
  const exact = index === 0 ? '18446744073709551615' : index === 3 ? '9007199254740993' : index === 4 ? '9007199254740992' : '1';
  return `SELECT CAST('${String(index).padStart(2, '0')}' AS CHAR)${index ? '' : ' AS id'},CAST(${category} AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_bin${index ? '' : ' AS category'},CAST('${exact}' AS UNSIGNED)${index ? '' : ' AS exact_value'}`;
}).join(' UNION ALL ') + ' ORDER BY id';

/** 原生专项复用原owner、120秒和准确目标门；不读取React内部状态或替换任何产品回包。 */
export function registerQueryResultValueOptionsUi(binding: QueryResultColumnsUiTarget): void {
  const cases = new Map<TestInfo, QueryResultColumnsUiLifetime>(); let halted = false;
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(({}, info) => { const life = cases.get(info); if (!life) { halted = true; retainOwnedDesktopResources(info); throw Error('不同值专项未登记原owner，保留现场'); } try { life.afterEach(); cases.delete(info); } catch (reason) { halted = true; throw reason; } });
  test('准确13384真实结果不同值分页、NULL补集、精确值、多列排序及两格式导出', async ({ trace, screenshot, video }, info) => {
    if (halted) throw Error('前例原资源未收尾，不能开始不同值专项');
    const captured = ownedDesktopResources(info), page = captured.page, application = captured.application;
    const life = new QueryResultColumnsUiLifetime({ check(allowClosed) { binding.assertCurrent(); const now = ownedDesktopResources(info); if (now.page !== page || now.application !== application || !allowClosed && now.closed) throw Error('不同值专项原owner已变化'); }, closed: () => ownedDesktopResources(info).closed, retain() { halted = true; retainOwnedDesktopResources(info); }, async exit() { life.check(); await application.evaluate(readQueryResultColumnsAudit); life.check(); await application.evaluate(guardQueryResultColumnsExitAnswers); life.check(); await confirmOwnedDesktopExit(info); } }, info as TestInfo & { _startWallTime?: number });
    cases.set(info, life); let observer: mysql.Connection | undefined, native: any, stream: any, armed = false;
    /** 所有await均复核原owner及准确Main审计；不重签时限。 */
    const observe = <T,>(action: () => Promise<T>) => life.observe(async () => { if (armed) await application.evaluate(readQueryResultColumnsAudit); const result = await action(); if (armed) await application.evaluate(readQueryResultColumnsAudit); return result; });
    try {
      if (trace !== 'off' || screenshot !== 'off' || video !== 'off') throw Error('认证阶段禁止trace、截图或video');
      const manifest = process.env.DBARK_VALUE_OPTIONS_MANIFEST, manifestSha256 = process.env.DBARK_VALUE_OPTIONS_MANIFEST_SHA256;
      if (!manifest || !isAbsolute(manifest) || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? '')) throw Error('不同值专项缺少Root批准的绝对来源清单及摘要');
      let sourceClosed = false;
      const sourceRead = <T,>(action: () => Promise<T>) => life.observe(action, sourceClosed);
      const source = await sourceRead(() => sealEditorIndentLaunchIdentity(manifest, manifestSha256!, resolve('.'), {
        stat: path => sourceRead(async () => { const value = await lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }),
        real: path => sourceRead(() => realpath(path)), list: path => sourceRead(() => readdir(path)), bytes: path => sourceRead(() => readFile(path)),
      }, () => { life.check(sourceClosed); if (process.env.DBARK_VALUE_OPTIONS_MANIFEST !== manifest || process.env.DBARK_VALUE_OPTIONS_MANIFEST_SHA256 !== manifestSha256) throw Error('不同值专项批准来源已变化'); }));
      if (source.manifest.kind !== 'source') throw Error('本轮仅验源码，不接纳安装版替代');
      const phases: string[] = [];
      /** 五阶段完整核清单；实际主进程身份另核，不以工作目录推测启动产物。 */
      async function verifySource(phase: string): Promise<void> { await sourceRead(() => source.assertCurrent()); phases.push(phase); }
      const actual = await observe(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid })));
      await sourceRead(() => source.assertActual(actual));
      await verifySource('实际启动身份');
      const nested = relative(dataDir, binding.target.output); if (!nested.startsWith('..') && !isAbsolute(nested)) throw Error('原输出不能位于自动清理profile内');
      await observe(() => mkdir(binding.target.output, { recursive: false }));
      await observe(async () => { observer = await mysql.createConnection({ host: binding.target.host, port: binding.target.port, user: binding.target.user, password: binding.target.password, connectTimeout: 15000 }); native = (observer as mysql.Connection & { connection?: any }).connection; stream = native?.stream; if (!native || !stream) throw Error('原观察流归属未知'); });
      assertQueryResultColumnsUiIdentity(await observe(() => observer!.query('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid')), binding.target.uuid);
      await observe(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, () => life.check())).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '不同值本例只读'], [zh.connections.text009, binding.target.host], [zh.connections.text010, String(binding.target.port)], [zh.common.user, binding.target.user], [zh.connections.text011, binding.target.password], [zh.connections.text012, '']]) await observe(() => form.getByLabel(label, { exact: true }).fill(value));
      await observe(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await observe(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await observe(async () => (await navigationMenuItem(form, { name: zh.connections.text036, exact: true }, () => life.check())).click()); await observe(() => expect(form).toBeHidden());
      const profiles = await observe(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))), profile = profiles.length === 1 ? profiles[0] : undefined;
      expect(Boolean(profile && profile.name === '不同值本例只读' && profile.host === binding.target.host && profile.port === binding.target.port && profile.user === binding.target.user && !profile.database && !profile.rememberPassword && profile.password === undefined && profile.hasPassword === Boolean(binding.target.password) && !profile.tls?.enabled && !profile.ssh?.enabled)).toBe(true);
      await observe(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newQuery, exact: true }, () => life.check())).click()); const query = page.getByRole('dialog', { name: zh.common.newQuery, exact: true });
      await observe(() => query.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile!.id)); await observe(() => query.getByLabel(zh.app.text050, { exact: true }).fill('')); await observe(async () => (await navigationMenuItem(query, { name: zh.app.text053, exact: true }, () => life.check())).click()); await observe(() => expect(query).toBeHidden());
      const tab = page.locator('.query-tab:visible'); await observe(() => tab.locator('.monaco-editor').getByRole('textbox').focus()); await observe(() => page.keyboard.press('Control+A')); await observe(() => page.keyboard.insertText(sql));
      let tabId = ''; await observe(() => expect.poll(async () => { const settings = await observe(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), own = settings.tabs.find(item => item.id === settings.activeTabId); if (own?.kind === 'query' && own.connectionId === profile!.id && own.sql === sql) { tabId = own.id; return true; } return false; }).toBe(true));
      const ownerWindow = await observe(() => application.browserWindow(page)), senderId = await observe(() => ownerWindow.evaluate(window => window.webContents.id)); await observe(() => ownerWindow.dispose());
      await observe(() => application.evaluate(installQueryResultColumnsAudit, { senderId, profileId: profile!.id, tabId, sql, deadline: (info as TestInfo & { _startWallTime?: number })._startWallTime! + 120000 })); armed = true;
      await observe(async () => (await navigationMenuItem(tab, { name: zh.query.text011, exact: true }, () => life.check())).click()); await observe(async () => expect((await navigationMenuItem(tab, { name: zh.common.stop, exact: true }, () => life.check()))).toBeDisabled({ timeout: 20000 })); await observe(() => expect(tab.locator('.error-box')).toHaveCount(0));
      await verifySource('查询返回后');
      const grid = tab.locator('.result-body .results-grid'), heads = grid.locator('[role="columnheader"]:has(.column-type)'), panel = tab.getByRole('region', { name: filterText.title, exact: true }), picker = panel.getByRole('region', { name: text.title, exact: true });
      const ids = () => observe(() => grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents());
      /** 期望来自66条原常量的手工计数；不调用产品筛选器生成答案。 */
      const count = (matched: number) => observe(() => expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(66, matched)));
      await count(66); await observe(() => heads.nth(1).click()); await observe(() => heads.nth(2).click({ modifiers: ['Control'] })); await observe(() => heads.nth(2).click({ modifiers: ['Control'] }));
      const priorities = () => observe(() => expect(tab.getByRole('list', { name: sortText.priorities, exact: true }).getByRole('listitem')).toHaveCount(2)); await priorities();
      /** 只编辑条件及不同值草稿；父应用前原网格和计数必须保持。 */
      async function openPicker(existing = false) {
        await observe(async () => (await navigationMenuItem(tab, { name: filterText.open, exact: true }, () => life.check())).click());
        if (!existing) { await observe(async () => (await navigationMenuItem(panel, { name: filterText.add, exact: true }, () => life.check())).click()); await observe(() => panel.getByRole('combobox', { name: filterText.column + ' 1', exact: true }).selectOption('c1')); }
        await observe(async () => (await navigationMenuItem(panel, { name: text.openCondition(1), exact: true }, () => life.check())).click()); await observe(() => expect(picker).toContainText(text.counts(66, 65, 65, 0))); await observe(() => expect(picker.getByRole('checkbox')).toHaveCount(50));
      }
      // 跨页搜索全选覆盖完整匹配集合，取消两层草稿均不修改视图。
      await openPicker(); await observe(async () => (await navigationMenuItem(picker, { name: text.next, exact: true }, () => life.check())).click()); await observe(() => expect(picker.getByRole('checkbox')).toHaveCount(15)); await observe(() => picker.getByRole('checkbox', { name: text.value('分类65'), exact: true }).check());
      await observe(() => picker.getByRole('textbox', { name: text.search, exact: true }).fill('分类6')); await observe(async () => (await navigationMenuItem(picker, { name: text.selectMatches, exact: true }, () => life.check())).click()); await observe(() => expect(picker).toContainText(text.counts(66, 65, 6, 6)));
      await observe(async () => (await navigationMenuItem(picker, { name: text.apply, exact: true }, () => life.check())).click()); await count(66); await observe(async () => (await navigationMenuItem(panel, { name: filterText.cancel, exact: true }, () => life.check())).click()); await count(66);
      // 混合NULL、空串、NULL字样及末页不同值，仍由原多列排序投影。
      await openPicker(); for (const literal of [null, '', 'NULL']) await observe(() => picker.getByRole('checkbox', { name: text.value(literal), exact: true }).check());
      const screenshotPath = info.outputPath('不同值筛选SQL-NULL与原文.png'); await observe(() => picker.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await observe(() => readFile(screenshotPath))).digest('hex');
      await observe(async () => (await navigationMenuItem(picker, { name: text.next, exact: true }, () => life.check())).click()); await observe(() => picker.getByRole('checkbox', { name: text.value('分类65'), exact: true }).check()); await observe(async () => (await navigationMenuItem(picker, { name: text.apply, exact: true }, () => life.check())).click()); await count(66);
      await observe(async () => (await navigationMenuItem(panel, { name: filterText.apply, exact: true }, () => life.check())).click()); await count(4); await observe(() => expect.poll(ids).toEqual(['00', '01', '02', '65'])); await priorities();
      await observe(async () => (await navigationMenuItem(tab, { name: historyText.undo, exact: true }, () => life.check())).click()); await count(66); await observe(async () => (await navigationMenuItem(tab, { name: historyText.redo, exact: true }, () => life.check())).click()); await count(4); await observe(async () => (await navigationMenuItem(tab, { name: filterText.clear, exact: true }, () => life.check())).click()); await count(66);
      for (const includeNull of [false, true]) {
        await openPicker(); await observe(() => picker.getByRole('checkbox', { name: text.value('A'), exact: true }).check()); if (includeNull) await observe(() => picker.getByRole('checkbox', { name: text.value(null), exact: true }).check());
        await observe(() => picker.getByRole('combobox', { name: text.mode, exact: true }).selectOption('exclude')); await observe(async () => (await navigationMenuItem(picker, { name: text.apply, exact: true }, () => life.check())).click()); await observe(async () => (await navigationMenuItem(panel, { name: filterText.apply, exact: true }, () => life.check())).click()); await count(includeNull ? 63 : 64);
        const visible = await ids(); expect(visible[0]).toBe(includeNull ? '01' : '00'); expect(visible).not.toContain('03'); expect(visible).not.toContain('04'); await priorities(); await observe(async () => (await navigationMenuItem(tab, { name: filterText.clear, exact: true }, () => life.check())).click());
      }
      await openPicker(); await observe(() => picker.getByRole('checkbox', { name: text.value('A'), exact: true }).check()); await observe(async () => (await navigationMenuItem(picker, { name: text.apply, exact: true }, () => life.check())).click()); await observe(async () => (await navigationMenuItem(panel, { name: filterText.apply, exact: true }, () => life.check())).click()); await count(2); await observe(() => expect.poll(ids).toEqual(['03', '04'])); await priorities();
      // 筛选后仍可见原全部65种值；真实Esc只关闭内层，不提交或关闭外层。
      await openPicker(true); await observe(() => picker.getByRole('textbox', { name: text.search, exact: true }).focus()); await observe(() => page.keyboard.press('Escape')); await observe(() => expect(picker).toBeHidden()); await observe(() => expect(panel).toBeVisible()); await observe(async () => (await navigationMenuItem(panel, { name: filterText.cancel, exact: true }, () => life.check())).click()); await observe(() => expect.poll(ids).toEqual(['03', '04']));
      for (const index of [2, 3]) await observe(() => grid.locator('[role="row"][aria-rowindex="' + index + '"]').getByRole('checkbox').check());
      for (const format of ['csv', 'json'] as const) {
        await observe(async () => (await navigationMenuItem(tab, { name: zh.resultExport.selectedTitle, exact: true }, () => life.check())).click()); const dialog = page.getByRole('dialog', { name: zh.resultExport.selectedTitle, exact: true });
        await observe(() => dialog.getByRole('combobox', { name: zh.resultExport.format, exact: true }).selectOption(format)); await observe(() => dialog.getByRole('combobox', { name: zh.resultExport.encoding, exact: true }).selectOption('utf8')); await observe(() => application.evaluate(answerQueryResultColumnsSave, { senderId, path: binding.target[format] })); await observe(() => dialog.locator('.file-picker').click()); await observe(async () => (await navigationMenuItem(dialog, { name: zh.resultExport.start, exact: true }, () => life.check())).click()); await observe(() => expect(dialog.locator('.success-box')).toHaveText('已导出 2 行已返回结果。'));
        expect((await observe(() => stat(binding.target[format]))).size).toBeLessThan(32768); const bytes = await observe(() => readFile(binding.target[format]));
        if (format === 'csv') expect(parse(bytes, { bom: true, columns: false, cast: false })).toEqual([['id', 'category', 'exact_value'], ['03', 'A', '9007199254740993'], ['04', 'A', '9007199254740992']]);
        else expect(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))).toEqual([{ id: '03', category: 'A', exact_value: '9007199254740993' }, { id: '04', category: 'A', exact_value: '9007199254740992' }]);
        await observe(async () => (await navigationMenuItem(dialog, { name: zh.common.done, exact: true }, () => life.check())).click()); if (format === 'csv') for (const index of [2, 3]) await observe(() => grid.locator('[role="row"][aria-rowindex="' + index + '"]').getByRole('checkbox').check());
      }
      const audit = await observe(() => application.evaluate(readQueryResultColumnsAudit)); expect(audit).toEqual({ queries: 1, exports: ['csv', 'json'], pending: 0, revision: 0 }); expect(pageErrors).toEqual([]);
      await verifySource('筛选与导出后'); await verifySource('退出客户端前');
      await life.finish(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})), () => closeQueryResultColumnsObserver(observer! as mysql.Connection & { connection?: unknown }, native, stream, () => life.check(true), own => closeMysqlConnection(own, true, false, life.remaining(1000))));
      sourceClosed = true;
      await verifySource('退出与观察流收尾后');
      await info.attach('不同值专项实际终态', { body: JSON.stringify({ sourceRows: 66, distinctValues: 65, pageSizes: [50, 15], mixedNullRows: 4, excludeAWithNullRows: 64, excludeAAndNullRows: 63, finalIds: ['03', '04'], audit, source: { manifestSha256, phases }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, normalExit: true, observerClosed: stream.closed === true, systemClipboard: 0, installerVerified: false, macOSVerified: false }), contentType: 'application/json' });
    } catch (reason) { life.preserve(); throw reason; } finally { life.endBody(); }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
