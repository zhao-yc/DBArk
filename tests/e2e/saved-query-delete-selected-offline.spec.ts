import { test as baseTest } from '@playwright/test';

// 默认和列表只登记未执行定义；不加载桌面、SQLite、配置、凭据或原生资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_SAVED_QUERY_DELETE_SELECTED_NATIVE === '1') register();
else baseTest.skip('保存查询批量删除正式离线原生专项默认关闭（未执行）', () => {});

/** 一例原120秒内完成真实Main批量删除、原窗口保持及同profile两次正常退出；不接触真实数据库。 */
function register(): void {
  if (process.platform !== 'win32' || process.env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('保存查询批量删除原生专项仅允许Windows及integration=0');
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test } = desktop, { expect } = require('@playwright/test') as typeof import('@playwright/test');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { savedQueryOrganizationZh: selection } = require('../../src/renderer/locales/savedQueryOrganization.zh-CN') as typeof import('../../src/renderer/locales/savedQueryOrganization.zh-CN');
  const { savedQueryPagesZh: pages } = require('../../src/renderer/locales/savedQueryPages.zh-CN') as typeof import('../../src/renderer/locales/savedQueryPages.zh-CN');
  const { savedQueryDeleteSelectedZh: text } = require('../../src/shared/savedQueryDeleteSelected') as typeof import('../../src/shared/savedQueryDeleteSelected');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), { join } = require('node:path') as typeof import('node:path');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let completed = false;
  test.afterEach(({}, info) => { if (!completed) { desktop.retainOwnedDesktopResources(info); throw Error('保存查询批量删除未完成原owner收尾，保留原App及profile'); } });

  test('保存查询跨两页选择、取消及完整批量删除，原分组草稿保留与同profile重启', async ({ trace, screenshot, video }, info) => {
    let owner = desktop.ownedDesktopResources(info), application = owner.application, page = owner.page, child = application.process(), closed = false, armed = false;
    const directory = desktop.dataDir, reports: Audit[] = [], exits: (number | null)[] = [];
    type Audit = { pending: number; forks: number; calls: { command: string; deletedIds?: string[]; localCancel?: boolean; ok?: boolean }[] };
    const localCommands = new Set(['queries.list', 'queries.page', 'queries.pageContinue', 'queries.pageRelease', 'queries.readText', 'queries.organizationGet', 'queries.deleteSelectedChecked', 'queries.updateSource', 'settings.get', 'settings.save', 'history.page', 'history.pageContinue', 'history.pageRelease', 'history.list', 'connections.list', 'tasks.list', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'query.cancel']);
    /** 已有引擎不会再次fork，故同时正向核UI期命令全属本地操作；取消只可指向本例页任务。 */
    function assertLocalAudit(value: Audit): void { expect(value.forks).toBe(0); expect(value.calls.filter(call => !localCommands.has(call.command) || call.command === 'query.cancel' && call.localCancel !== true)).toEqual([]); }
    /** 每次await都核同一TestInfo原App，重启仅在明确交接后更新本地owner。 */
    function check(): void {
      const current = desktop.ownedDesktopResources(info);
      if (process.env.DBARK_SAVED_QUERY_DELETE_SELECTED_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || current.application !== application || current.page !== page || current.closed !== closed || desktop.dataDir !== directory || !closed && application.process() !== child || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.timeout !== 120000) throw Error('保存查询批量删除原窗口、profile或单次期限已变化');
    }
    /** 旁观完全透传，只读归属/计数，不拒绝或替换任何产品结果。 */
    const audit = (): Promise<Audit> => application.evaluate(() => {
      const state = (globalThis as any).__savedQueryDeleteSelectedOfflineAudit; state.check();
      return { pending: state.pending, forks: state.forks, calls: state.calls };
    });
    async function step<T>(action: () => Promise<T>): Promise<T> {
      check(); if (armed) { const current = await audit(); check(); assertLocalAudit(current); }
      const result = await action(); check(); if (armed) { const current = await audit(); check(); assertLocalAudit(current); } return result;
    }
    /** 每次App安装自己的Map/fork透传旁观；不复制旧插入审计器或建立请求白名单。 */
    async function installAudit(): Promise<void> {
      await step(() => application.evaluate(({ ipcMain, utilityProcess, BrowserWindow }) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), previousFork = utilityProcess.fork;
        const windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents;
        if (root.__savedQueryDeleteSelectedOfflineAudit || !(handlers instanceof Map) || typeof previous !== 'function' || windows.length !== 1 || !window || window.isDestroyed()) throw Error('保存查询批量删除Main旁观原窗口无效');
        const localTasks = new Set<string>();
        const state = { pending: 0, forks: 0, calls: [] as { command: string; deletedIds?: string[]; localCancel?: boolean; ok?: boolean }[], check() {}, restore() {} };
        const forward = async function (this: unknown, event: any, request: any) {
          const command = typeof request?.command === 'string' ? request.command : '未知命令';
          if (['queries.page', 'queries.pageContinue', 'history.page', 'history.pageContinue'].includes(command) && typeof request.input?.taskId === 'string') localTasks.add(request.input.taskId);
          const row = { command, ...(command === 'queries.deleteSelectedChecked' ? { deletedIds: Array.isArray(request.input?.queries) ? request.input.queries.map((item: { id: string }) => item.id) : [] } : {}), ...(command === 'query.cancel' ? { localCancel: localTasks.has(request.input?.taskId) } : {}) } as (typeof state.calls)[number];
          state.calls.push(row); state.pending++;
          try { const result = await Reflect.apply(previous, this, [event, request]); row.ok = result !== null && typeof result === 'object' && 'ok' in result && result.ok === true; return result; }
          finally { state.pending--; }
        };
        const fork = function (this: unknown, ...args: Parameters<typeof previousFork>) { state.forks++; return Reflect.apply(previousFork, this, args); } as typeof previousFork;
        state.check = () => { if (root.__savedQueryDeleteSelectedOfflineAudit !== state || handlers.get('dbark:request') !== forward || utilityProcess.fork !== fork || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || window.isDestroyed() || window.webContents !== contents) throw Error('保存查询批量删除Main原Map或窗口归属已变化'); };
        state.restore = () => { state.check(); if (state.pending !== 0) throw Error('保存查询批量删除原请求尚未终结'); handlers.set('dbark:request', previous); utilityProcess.fork = previousFork; delete root.__savedQueryDeleteSelectedOfflineAudit; };
        root.__savedQueryDeleteSelectedOfflineAudit = state; handlers.set('dbark:request', forward); utilityProcess.fork = fork; state.check();
      })); armed = true;
    }
    /** 原请求完成且精确恢复原handler后才正常退出，失败不重复关闭或启动。 */
    async function quit(): Promise<void> {
      expect(desktop.pageErrors).toEqual([]);
      await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
      await step(async () => { const report = await audit(); expect(report.pending).toBe(0); reports.push(report); await application.evaluate(() => (globalThis as any).__savedQueryDeleteSelectedOfflineAudit.restore()); armed = false; });
      check(); await desktop.confirmOwnedDesktopExit(info); closed = true; check(); exits.push(child.exitCode); expect(child.exitCode).toBe(0);
    }
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    const records = () => step(() => page.evaluate(() => window.dbark.invoke('queries.list', {})));
    const groups = () => step(() => page.evaluate(() => window.dbark.invoke('queries.organizationGet', {})));
    /** 组织revision跨查询变更与重启会更新，只比较实际组、层次及人数。 */
    const organization = (value: Awaited<ReturnType<typeof groups>>) => ({ groups: value.groups, totalCount: value.totalCount, unfiledCount: value.unfiledCount });
    const list = () => page.getByRole('dialog', { name: zh.activity.text003, exact: true });
    async function openList(): Promise<void> {
      await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.historyQueries, exact: true }).click());
      await step(() => list().getByRole('button', { name: zh.activity.text005, exact: true }).click());
      await step(() => expect(list().getByRole('button', { name: pages.refresh, exact: true })).toBeEnabled());
    }
    /** 官方只读API核两个已挂载查询模型，包含隐藏的原来源草稿，不写模型或选择。 */
    const model = () => step(() => page.evaluate(() => {
      const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab'));
      if (editors?.length !== 2) throw Error('批量删除原两个Monaco不完整');
      return editors.map(editor => { const value = editor.getModel(); if (!value || value.isDisposed()) throw Error('批量删除原模型未知'); return { value: value.getValue(), uri: value.uri.toString(), eol: value.getEOL() }; }).sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : 0);
    }));
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(await records()).toEqual([]); expect((await settings()).tabs).toEqual([]);
      // 27条合成记录只通过正式Main准备；分页目标必须从真实返回值取得，不猜创建顺序或时间戳。
      const prepared = await step(() => page.evaluate(async () => {
        const profile = await window.dbark.invoke('connections.save', { id: 'delete-selected-offline-profile', name: '批量删除离线配置', dialect: 'mysql', host: 'never.invalid', port: 1, user: 'offline-only', group: '', color: '#456789', database: '配置默认库', rememberPassword: false }).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; });
        const created: { source: import('../../src/shared/queryBinding').QuerySourceBinding; name: string; sql: string }[] = [];
        for (let index = 0; index < 27; index++) {
          const name = index % 2 ? '同名保存查询🚢' : '保存查询' + index;
          const sql = '-- BULK_DELETE_SOURCE_' + String(index).padStart(2, '0') + '\r\n-- ' + '长Unicode中文🚢e\u0301'.repeat(60) + "\r\nSELECT '900719925474099312345', '0.12345678901234567890', '" + index + "';\r\n-- 原保存尾部";
          const context = index % 3 === 0 ? { state: 'known' as const, database: '原查询库' } : index % 3 === 1 ? { state: 'known' as const, database: null } : { state: 'unknown' as const };
          const result = await window.dbark.invoke('queries.create', { name, sql, context, connectionId: profile.id }); created.push({ ...result, sql });
        }
        const byId = new Map(created.map(query => [query.source.id, query])), all = await window.dbark.invoke('queries.list', {});
        const first = await window.dbark.invoke('queries.page', { taskId: crypto.randomUUID(), search: '', onError: 'stop', group: { kind: 'all' } });
        if (first.items.length !== 25 || !first.cursor) throw Error('真实第一页不是25条或没有下一批');
        const second = await window.dbark.invoke('queries.pageContinue', { taskId: crypto.randomUUID(), cursor: first.cursor });
        if (second.items.length !== 2) throw Error('真实第二页不是剩余2条'); if (second.cursor) await window.dbark.invoke('queries.pageRelease', { cursor: second.cursor });
        const targetIds = [first.items[0].query.id, second.items[0].query.id], survivors = first.items.filter(item => !targetIds.includes(item.query.id)).slice(0, 2);
        let snapshot = await window.dbark.invoke('queries.organizationGet', {});
        const groupIds: string[] = [];
        for (const name of ['第一页原组', '第二页原组']) { snapshot = await window.dbark.invoke('queries.organizationApply', { expectedRevision: snapshot.revision, operation: { kind: 'create', name, parentId: null } }); const group = snapshot.groups.find(group => group.name === name); if (!group) throw Error('合成分组未创建'); groupIds.push(group.id); }
        const members: { queryId: string; groupId: string }[] = [];
        for (let index = 0; index < targetIds.length; index++) {
          const queries = [targetIds[index], survivors[index].query.id].map(id => { const record = byId.get(id); if (!record) throw Error('真实分页目标没有原create绑定'); return { id, digest: record.source.digest }; });
          snapshot = await window.dbark.invoke('queries.organizationApply', { expectedRevision: snapshot.revision, operation: { kind: 'moveQueries', groupId: groupIds[index], queries } });
          members.push(...queries.map(query => ({ queryId: query.id, groupId: groupIds[index] })));
        }
        const targets = [first.items[0], second.items[0]].map((entry, index) => { const original = byId.get(entry.query.id); if (!original || original.source.digest !== entry.digest) throw Error('原分页摘要与create来源不一致'); return { ...entry, binding: original.source, groupId: groupIds[index] }; });
        const current = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...current, activeTabId: 'delete-selected-bound-0', tabs: targets.map((target, index) => {
          const record = all.find(query => query.id === target.query.id); if (!record) throw Error('原查询全文不存在');
          return { id: 'delete-selected-bound-' + index, kind: 'query' as const, title: '保留原来源草稿' + index, connectionId: profile.id, ...(record.database !== undefined ? { database: record.database } : {}), ...(record.databaseContext ? { databaseContext: record.databaseContext } : {}), sourceBinding: target.binding, sql: record.sql + '\r\n-- 本地独立未保存草稿' + index };
        }) });
        const canonical = await window.dbark.invoke('settings.get', {}); return { profile, created, targets, members, settings: canonical };
      }));
      expect(prepared.profile.rememberPassword).toBe(false); expect(prepared.profile.password).toBeUndefined();
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
      await step(() => expect(page.locator('.query-tab .sql-editor-wrap > [aria-busy="false"]')).toHaveCount(2));
      // 连接保存准备允许正常启动utility；观察从合成准备、reload与两个原编辑器就绪后开始。
      await installAudit();
      const sortRecords = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const baselineSettings = await settings(), baselineRecords = sortRecords(await records()), baselineGroups = organization(await groups()), baselineModels = await model();
      expect(baselineSettings.tabs).toEqual(prepared.settings.tabs); expect(baselineSettings.activeTabId).toBe(prepared.settings.activeTabId); expect(baselineRecords).toHaveLength(27);
      for (const created of prepared.created) expect(baselineRecords.find(query => query.id === created.source.id)).toMatchObject({ id: created.source.id, name: created.name, sql: created.sql, connectionId: prepared.profile.id });
      expect(baselineModels.map(value => value.value.replaceAll('\r\n', '\n')).sort()).toEqual(baselineSettings.tabs.map(tab => tab.sql!.replaceAll('\r\n', '\n')).sort());
      const targetIds = prepared.targets.map(target => target.query.id), targets = new Set(targetIds), expectedRecords = baselineRecords.filter(query => !targets.has(query.id));
      const expectedMembers = prepared.members.filter(member => !targets.has(member.queryId)).map(member => [member.queryId, member.groupId]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      const expectedGroups = { ...baselineGroups, totalCount: 25, groups: baselineGroups.groups.map(group => ({ ...group, count: group.count - prepared.targets.filter(target => target.groupId === group.id).length, totalCount: group.totalCount - prepared.targets.filter(target => target.groupId === group.id).length })) };
      const baselineProfiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(baselineProfiles).toEqual([prepared.profile]);
      await openList();
      const card = (target: (typeof prepared.targets)[number]) => list().locator('article.history-card').filter({ has: page.locator('pre').filter({ hasText: target.sqlPreview.split(/\r?\n/)[0] }) });
      const verifyCard = async (target: (typeof prepared.targets)[number]) => { await step(() => expect(card(target)).toHaveCount(1)); await step(() => expect(card(target).locator('strong')).toHaveText(target.query.name)); await step(() => expect(card(target).locator('pre')).toHaveText(target.sqlPreview + (target.previewTruncated ? '…' : ''))); };
      await step(() => expect(list().locator('article.history-card')).toHaveCount(25)); await verifyCard(prepared.targets[0]); await step(() => expect(card(prepared.targets[1])).toHaveCount(0));
      await step(() => card(prepared.targets[0]).getByRole('checkbox', { name: selection.select(prepared.targets[0].query.name), exact: true }).check());
      await step(() => expect(list().getByText(selection.selected(1, 0), { exact: true })).toBeVisible());
      await step(() => list().getByRole('button', { name: pages.next, exact: true }).click()); await step(() => expect(list().locator('article.history-card')).toHaveCount(2));
      await verifyCard(prepared.targets[1]); await step(() => expect(card(prepared.targets[0])).toHaveCount(0)); await step(() => expect(list().getByText(selection.selected(1, 1), { exact: true })).toBeVisible());
      await step(() => card(prepared.targets[1]).getByRole('checkbox', { name: selection.select(prepared.targets[1].query.name), exact: true }).check());
      await step(() => expect(list().getByText(selection.selected(2, 1), { exact: true })).toBeVisible());
      const preview = () => list().getByRole('group', { name: text.title, exact: true });
      const verifyPreview = async () => { await step(() => expect(preview()).toBeVisible()); await step(() => expect(preview().locator('li')).toHaveCount(2)); await step(() => expect(preview().locator('li')).toContainText(prepared.targets.map(target => target.query.name))); for (const id of targetIds) await step(() => expect(preview().getByText(id, { exact: true })).toBeVisible()); };
      await step(() => list().getByRole('button', { name: text.open, exact: true }).click()); await verifyPreview();
      await step(() => expect(preview().getByRole('button', { name: text.cancel, exact: true })).toBeFocused());
      await step(() => preview().getByRole('button', { name: text.cancel, exact: true }).press('Escape')); await step(() => expect(preview()).toHaveCount(0)); await step(() => expect(list()).toBeVisible());
      expect((await step(audit)).calls.filter(call => call.command === 'queries.deleteSelectedChecked')).toEqual([]); expect(sortRecords(await records())).toEqual(baselineRecords); expect(organization(await groups())).toEqual(baselineGroups);
      await step(() => expect(list().getByText(selection.selected(2, 1), { exact: true })).toBeVisible());
      await step(() => list().getByRole('button', { name: text.open, exact: true }).click()); await verifyPreview(); await step(() => preview().getByRole('button', { name: text.confirm(2), exact: true }).click());
      await step(() => expect(preview()).toHaveCount(0)); await step(() => expect(list().getByRole('button', { name: pages.refresh, exact: true })).toBeEnabled()); await step(() => expect(list().getByText(text.deleted(2), { exact: true })).toBeVisible());
      expect(sortRecords(await records())).toEqual(expectedRecords); expect(expectedRecords).toHaveLength(25); expect(organization(await groups())).toEqual(expectedGroups);
      expect((await settings()).tabs).toEqual(baselineSettings.tabs); expect((await settings()).activeTabId).toBe(baselineSettings.activeTabId);
      for (const target of prepared.targets) await step(() => expect(page.evaluate(input => window.dbark.invoke('queries.updateSource', input), { source: target.binding, content: { name: target.query.name, connectionId: prepared.profile.id, context: target.binding.context, sql: "SELECT '旧来源不得重建';" } })).rejects.toThrow());
      expect(sortRecords(await records())).toEqual(expectedRecords); expect(organization(await groups())).toEqual(expectedGroups);
      await step(() => list().getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(list()).toBeHidden());
      expect(await model()).toEqual(baselineModels); expect((await settings()).tabs).toEqual(baselineSettings.tabs); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual(baselineProfiles);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); await quit();
      check(); const restarted = await desktop.restartOwnedDesktop(info); application = restarted.application; page = restarted.page; child = application.process(); closed = false; check(); await installAudit();
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
      await step(() => expect(page.locator('.query-tab .sql-editor-wrap > [aria-busy="false"]')).toHaveCount(2));
      expect(sortRecords(await records())).toEqual(expectedRecords); expect(organization(await groups())).toEqual(expectedGroups); expect((await settings()).tabs).toEqual(baselineSettings.tabs); expect((await settings()).activeTabId).toBe(baselineSettings.activeTabId);
      expect((await model()).map(({ value, eol }) => ({ value, eol }))).toEqual(baselineModels.map(({ value, eol }) => ({ value, eol })));
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual(baselineProfiles);
      await openList(); await step(() => expect(list().locator('article.history-card')).toHaveCount(25)); for (const target of prepared.targets) await step(() => expect(card(target)).toHaveCount(0));
      await step(() => list().getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(list()).toBeHidden());
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); await quit();
      // 双owner确认退出后才独立读取实际dbark.sqlite原始记录，不调用产品存储来证明自身结果。
      check(); const initSqlJs = require('sql.js') as typeof import('sql.js'); const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }); check();
      const bytes = await fs.readFile(join(directory, 'dbark.sqlite')); check(); const db = new SQL.Database(bytes);
      try {
        expect(Number(db.exec('PRAGMA user_version')[0].values[0][0])).toBe(9);
        const rawRows = db.exec('SELECT id,data,updated_at FROM queries ORDER BY id')[0].values; expect(rawRows).toHaveLength(25); expect(rawRows.map(row => JSON.parse(String(row[1])))).toEqual(expectedRecords);
        for (const row of rawRows) expect(String(row[2])).toBe(JSON.parse(String(row[1])).updatedAt);
        expect(db.exec('SELECT query_id,group_id FROM saved_query_memberships ORDER BY query_id')[0].values).toEqual(expectedMembers);
        const storedOrganization = JSON.parse(String(db.exec('SELECT data FROM saved_query_organization WHERE id=1')[0].values[0][0])); expect(storedOrganization.version).toBe(1); expect(storedOrganization.groups).toEqual(baselineGroups.groups.map(({ id, name, parentId }) => ({ id, name, parentId })));
        const storedSettings = JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as typeof baselineSettings; expect(storedSettings.tabs).toEqual(baselineSettings.tabs); expect(storedSettings.activeTabId).toBe(baselineSettings.activeTabId);
      } finally { db.close(); } check();
      const deletions = reports.flatMap(report => report.calls).filter(call => call.command === 'queries.deleteSelectedChecked'); expect(deletions).toHaveLength(1); expect(deletions[0].ok).toBe(true); expect([...(deletions[0].deletedIds ?? [])].sort()).toEqual([...targetIds].sort());
      expect(reports.map(report => report.pending)).toEqual([0, 0]); expect(reports.map(report => report.forks)).toEqual([0, 0]); reports.forEach(assertLocalAudit);
      expect(reports.flatMap(report => report.calls).filter(call => /^(?:connections\.open|query\.execute|query\.transaction|sessions\.create)$/.test(call.command))).toEqual([]);
      await info.attach('保存查询跨页批量删除正式离线终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.saved-query-delete-selected-offline', preparedRecords: 27, deletedIds: targetIds, remainingRecords: 25, hiddenSelection: 1, escapeDeleteCalls: 0, confirmedDeleteCalls: 1, groupsPreserved: 2, membershipsRemovedOnlyForTargets: true, allSurvivorFieldsExact: true, bothOpenedSourceBindingsAndDraftsPreserved: true, bothMonacoBodiesPreserved: true, staleSourceUpdatesRejected: 2, normalOwnedExits: 2, originalProcessExitCodes: exits, sameProfileRestart: true, sqlite: 'dbark.sqlite', schema: 9, sqliteRawQueriesMembershipsSettingsVerified: true, auditUtilityForks: [0, 0], auditPendingAtRestore: [0, 0], transparentMainAudit: true, uiCommandsAllLocalVerified: true, preparationUtilityStartsAudited: false, testDatabaseExecutions: 0, testClipboardOperations: 0, nativeFilePickerOperations: 0, actualConnectionFormVerified: false, installerVerified: false, macOSVerified: false, auditScope: '首次从合成Main准备/reload/两个正文就绪后开始；第二次从同profile重启后安装至退出前restore。准备及退出不冒充Main全程审计。' })), contentType: 'application/json' });
      completed = true;
    } catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
  });
}
