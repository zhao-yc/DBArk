import { test as baseTest } from '@playwright/test';

// 默认及列表模式只登记定义，不加载桌面或本地配置。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_SAVED_QUERY_DUPLICATE_NATIVE === '1') register();
else baseTest.skip('保存查询复制原生专项默认关闭（未执行）', () => {});

/** 独立临时profile内验证真实复制、取消与重启，不读取用户配置或连接服务器。 */
function register(): void {
  if (process.platform !== 'win32' || process.env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('复制原生专项仅允许Windows及integration=0');
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test, expect } = desktop;
  const { navigationMenuItem } = require('./navigation-menu') as typeof import('./navigation-menu');
  const { savedQueryDuplicateZh: text } = require('../../src/shared/savedQueryDuplicate') as typeof import('../../src/shared/savedQueryDuplicate');
  const { navigationZh } = require('../../src/renderer/locales/navigation.zh-CN') as typeof import('../../src/renderer/locales/navigation.zh-CN');
  const { savedQueryPagesZh: pages } = require('../../src/renderer/locales/savedQueryPages.zh-CN') as typeof import('../../src/renderer/locales/savedQueryPages.zh-CN');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let completed = false;
  test.afterEach(({}, info) => { if (!completed) { desktop.retainOwnedDesktopResources(info); throw Error('复制专项未完成原owner收尾，保留临时App及profile'); } });
  test('保存查询复制、取消、原分组和工作区保持及同profile重启', async ({}, info) => {
    let owner = desktop.ownedDesktopResources(info), app = owner.application, page = owner.page, closed = false;
    const directory = desktop.dataDir, sourceId = 'duplicate-offline-source';
    const sourceName = '复制专项原记录', copyName = '  独立副本🚢  ';
    const sql = '-- 完整SQL，不执行\r\n' + '-- Unicode🚢e\u0301\r\n'.repeat(120) + "SELECT '900719925474099312345','0.12345678901234567890',NULL,X'00ff';";
    /** 每个异步边界保持同一窗口及所属profile，重启只使用原fixture交接。 */
    function check(): void {
      const current = desktop.ownedDesktopResources(info);
      if (current.application !== app || current.page !== page || current.closed !== closed || desktop.dataDir !== directory || process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_SAVED_QUERY_DUPLICATE_NATIVE !== '1' || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.timeout !== 120000) throw Error('复制专项原owner、期限或运行条件已变化');
    }
    async function step<T>(action: () => Promise<T>): Promise<T> { check(); const value = await action(); check(); return value; }
    const list = () => page.getByRole('dialog', { name: zh.activity.text003, exact: true });
    const records = () => step(() => page.evaluate(() => window.dbark.invoke('queries.list', {})));
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    const groups = () => step(() => page.evaluate(() => window.dbark.invoke('queries.organizationGet', {})));
    /** 只走真正模块菜单入口，不模拟点击旧隐藏按钮。 */
    async function openList(): Promise<void> {
      const action = await step(() => navigationMenuItem(page.locator('.navigation-toolbar'), { name: navigationZh.savedQueries, exact: true }, check));
      await step(() => action.click()); await step(() => expect(list().getByRole('button', { name: pages.refresh, exact: true })).toBeEnabled());
    }
    /** 原fixture严格等待正常退出和原进程关闭，不强杀其它窗口。 */
    async function quit(): Promise<void> { expect(desktop.pageErrors).toEqual([]); check(); await desktop.confirmOwnedDesktopExit(info); closed = true; check(); }
    try {
      const runtime = await step(() => app.evaluate(({ app }) => ({ userData: app.getPath('userData'), executable: app.getPath('exe'), platform: process.platform, architecture: process.arch })));
      expect(runtime.userData).toBe(directory);
      await step(() => info.attach('复制专项运行身份', { body: Buffer.from(JSON.stringify({ ...runtime, mainPid: app.process().pid })), contentType: 'application/json' }));
      await step(() => page.evaluate(async ({ sourceId, sourceName, sql }) => {
        await window.dbark.invoke('queries.save', { id: sourceId, name: sourceName, sql, updatedAt: new Date().toISOString(), databaseContext: { state: 'unknown' } });
        let organization = await window.dbark.invoke('queries.organizationGet', {});
        organization = await window.dbark.invoke('queries.organizationApply', { expectedRevision: organization.revision, operation: { kind: 'create', name: '原分组', parentId: null } });
        const source = await window.dbark.invoke('queries.page', { taskId: crypto.randomUUID(), search: '', onError: 'stop' });
        if (source.cursor) await window.dbark.invoke('queries.pageRelease', { cursor: source.cursor });
        const entry = source.items.find(item => item.query.id === sourceId); if (!entry) throw Error('专项原资料不存在');
        await window.dbark.invoke('queries.organizationApply', { expectedRevision: organization.revision, operation: { kind: 'moveQueries', groupId: organization.groups[0].id, queries: [{ id: sourceId, digest: entry.digest }] } });
      }, { sourceId, sourceName, sql }));
      const original = await records(), beforeSettings = await settings(); expect(original).toHaveLength(1);
      await openList();
      const card = () => list().locator('article.history-card').filter({ has: page.locator('strong', { hasText: sourceName }) });
      await step(() => card().getByRole('button', { name: text.rename, exact: true }).click());
      await step(() => list().getByRole('textbox', { name: text.newName, exact: true }).fill('取消副本'));
      await step(() => page.keyboard.press('Escape')); await step(() => expect(list()).toBeVisible());
      expect(await records()).toEqual(original);
      await step(() => card().getByRole('button', { name: text.rename, exact: true }).click());
      await step(() => list().getByRole('textbox', { name: text.newName, exact: true }).fill(copyName));
      await step(() => list().getByRole('button', { name: text.confirm, exact: true }).click());
      await step(() => expect(list().getByText(text.renamed, { exact: true })).toBeVisible());
      const after = await records(), copy = after.find(query => query.id !== sourceId)!;
      expect(after).toHaveLength(2); expect(after.find(query => query.id === sourceId)).toEqual(original[0]);
      expect(copy).toEqual({ ...original[0], id: copy.id, name: copyName, updatedAt: copy.updatedAt }); expect(copy.sql).toBe(sql);
      expect((await groups()).groups[0].count).toBe(2); expect((await settings()).tabs).toEqual(beforeSettings.tabs);
      // 截图仅包含本例合成资料，实际读取由Playwright完成，不涉及系统剪贴板。
      const image = await step(() => page.screenshot()); await step(() => info.attach('复制查询窗口', { body: image, contentType: 'image/png' }));
      await step(() => list().getByRole('button', { name: zh.common.close, exact: true }).click());
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      await quit();
      check(); owner = await desktop.restartOwnedDesktop(info); app = owner.application; page = owner.page; closed = false; check();
      expect(await records()).toEqual(after); expect((await groups()).groups[0].count).toBe(2); expect((await settings()).tabs).toEqual(beforeSettings.tabs);
      await quit();
      const fs = require('node:fs/promises') as typeof import('node:fs/promises'), { join } = require('node:path') as typeof import('node:path');
      const initSqlJs = require('sql.js') as typeof import('sql.js');
      const SQL = await step(() => initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }));
      const bytes = await step(() => fs.readFile(join(directory, 'dbark.sqlite'))), db = new SQL.Database(bytes);
      try {
        expect(db.exec('SELECT data FROM queries ORDER BY id')[0].values.map(row => JSON.parse(String(row[0])))).toEqual([...after].sort((a, b) => a.id.localeCompare(b.id)));
        expect(db.exec('SELECT COUNT(*),COUNT(DISTINCT group_id) FROM saved_query_memberships')[0].values).toEqual([[2, 1]]);
      } finally { db.close(); }
      await step(() => info.attach('复制查询终态', { body: Buffer.from(JSON.stringify({ sourceId, copiedId: copy.id, exactSql: true, originalPreserved: true, groupMembers: 2, sameProfileRestart: true, normalOwnedExits: 2, sqliteVerified: true, testClipboardOperations: 0, realDatabaseOperations: 0, actualPlatform: process.platform, architecture: process.arch })), contentType: 'application/json' }));
      completed = true;
    } catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
  });
}
