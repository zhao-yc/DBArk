import { test as baseTest } from '@playwright/test';

// 默认和列表只登记未执行定义；不加载桌面、SQLite、配置、凭据或原生资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
if (!listing && process.env.DBARK_SAVED_QUERY_RENAME_NATIVE === '1') register();
else baseTest.skip('保存查询重命名正式离线原生专项默认关闭（未执行）', () => {});

/** 一例原120秒内完成真实Main改名、原窗口保持及同profile两次正常退出；不接触真实数据库。 */
function register(): void {
  if (process.platform !== 'win32' || process.env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('保存查询重命名原生专项仅允许Windows及integration=0');
  const desktop = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test } = desktop, { expect } = require('@playwright/test') as typeof import('@playwright/test');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { savedQueryPagesZh: pages } = require('../../src/renderer/locales/savedQueryPages.zh-CN') as typeof import('../../src/renderer/locales/savedQueryPages.zh-CN');
  const { savedQueryRenameZh: text } = require('../../src/shared/savedQueryRename') as typeof import('../../src/shared/savedQueryRename');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), { join } = require('node:path') as typeof import('node:path');
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  let completed = false;
  test.afterEach(({}, info) => { if (!completed) { desktop.retainOwnedDesktopResources(info); throw Error('保存查询重命名未完成原owner收尾，保留原App及profile'); } });

  test('保存查询真实重命名、Escape仅取消内联、原SQL分组与打开草稿保持及同profile重启', async ({ trace, screenshot, video }, info) => {
    let owner = desktop.ownedDesktopResources(info), application = owner.application, page = owner.page, child = application.process(), closed = false, armed = false;
    const directory = desktop.dataDir, reports: Audit[] = [], exits: (number | null)[] = [];
    const originalName = '待重命名原查询', renamedName = '  已有同名🚢 e\u0301 查询  ';
    const sql = '-- RENAME_ORIGINAL_SOURCE_仅此记录\r\n-- ' + '长Unicode中文🚢e\u0301'.repeat(90) + "\r\nSELECT '900719925474099312345', '0.12345678901234567890';\r\n-- 原保存尾部";
    const otherSql = "-- RENAME_CONTROL_SOURCE_另一个ID\r\nSELECT '独立对照，不执行';";
    const openedSql = sql + '\r\n-- 原绑定标签自己的未保存正文';
    const extraSql = "-- 独立本地草稿\r\nSELECT '保持额外草稿🧭';";
    type Audit = { pending: number; forks: number; calls: { command: string; renameId?: string; localCancel?: boolean; ok?: boolean }[] };
    const localCommands = new Set(['queries.list', 'queries.page', 'queries.pageContinue', 'queries.pageRelease', 'queries.readText', 'queries.organizationGet', 'queries.renameChecked', 'queries.updateSource', 'settings.get', 'settings.save', 'history.page', 'history.pageContinue', 'history.pageRelease', 'history.list', 'connections.list', 'tasks.list', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'query.cancel']);
    /** 已有引擎不会再次fork，故同时正向核UI期命令全属本地操作；取消只可指向本例页任务。 */
    function assertLocalAudit(value: Audit): void { expect(value.forks).toBe(0); expect(value.calls.filter(call => !localCommands.has(call.command) || call.command === 'query.cancel' && call.localCancel !== true)).toEqual([]); }
    /** 每次await都核同一TestInfo原App，重启仅在明确交接后更新本地owner。 */
    function check(): void {
      const current = desktop.ownedDesktopResources(info);
      if (process.env.DBARK_SAVED_QUERY_RENAME_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || current.application !== application || current.page !== page || current.closed !== closed || desktop.dataDir !== directory || !closed && application.process() !== child || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.project.retries !== 0 || info.timeout !== 120000) throw Error('保存查询重命名原窗口、profile或单次期限已变化');
    }
    /** 旁观完全透传，只读归属/计数，不拒绝或替换任何产品结果。 */
    const audit = (): Promise<Audit> => application.evaluate(() => {
      const state = (globalThis as any).__savedQueryRenameOfflineAudit; state.check();
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
        if (root.__savedQueryRenameOfflineAudit || !(handlers instanceof Map) || typeof previous !== 'function' || windows.length !== 1 || !window || window.isDestroyed()) throw Error('保存查询重命名Main旁观原窗口无效');
        const localTasks = new Set<string>();
        const state = { pending: 0, forks: 0, calls: [] as { command: string; renameId?: string; localCancel?: boolean; ok?: boolean }[], check() {}, restore() {} };
        const forward = async function (this: unknown, event: any, request: any) {
          const command = typeof request?.command === 'string' ? request.command : '未知命令';
          if (['queries.page', 'queries.pageContinue', 'history.page', 'history.pageContinue'].includes(command) && typeof request.input?.taskId === 'string') localTasks.add(request.input.taskId);
          const row = { command, ...(command === 'queries.renameChecked' ? { renameId: request.input?.id } : {}), ...(command === 'query.cancel' ? { localCancel: localTasks.has(request.input?.taskId) } : {}) } as (typeof state.calls)[number];
          state.calls.push(row); state.pending++;
          try { const result = await Reflect.apply(previous, this, [event, request]); row.ok = result !== null && typeof result === 'object' && 'ok' in result && result.ok === true; return result; }
          finally { state.pending--; }
        };
        const fork = function (this: unknown, ...args: Parameters<typeof previousFork>) { state.forks++; return Reflect.apply(previousFork, this, args); } as typeof previousFork;
        state.check = () => { if (root.__savedQueryRenameOfflineAudit !== state || handlers.get('dbark:request') !== forward || utilityProcess.fork !== fork || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || window.isDestroyed() || window.webContents !== contents) throw Error('保存查询重命名Main原Map或窗口归属已变化'); };
        state.restore = () => { state.check(); if (state.pending !== 0) throw Error('保存查询重命名原请求尚未终结'); handlers.set('dbark:request', previous); utilityProcess.fork = previousFork; delete root.__savedQueryRenameOfflineAudit; };
        root.__savedQueryRenameOfflineAudit = state; handlers.set('dbark:request', forward); utilityProcess.fork = fork; state.check();
      })); armed = true;
    }
    /** 原请求完成且精确恢复原handler后才正常退出，失败不重复关闭或启动。 */
    async function quit(): Promise<void> {
      expect(desktop.pageErrors).toEqual([]);
      await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
      await step(async () => { const report = await audit(); expect(report.pending).toBe(0); reports.push(report); await application.evaluate(() => (globalThis as any).__savedQueryRenameOfflineAudit.restore()); armed = false; });
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
    /** DOM无查询ID属性，以Main页中准确ID取得完整预览，再绑定唯一预览与strong名称。 */
    async function sourceEntry(id: string) {
      const entries = await step(() => page.evaluate(async () => {
        const reply = await window.dbark.invoke('queries.page', { taskId: crypto.randomUUID(), search: '', onError: 'stop' });
        if (reply.cursor) await window.dbark.invoke('queries.pageRelease', { cursor: reply.cursor }); return reply.items;
      }));
      const matched = entries.filter(entry => entry.query.id === id); expect(matched).toHaveLength(1); return matched[0];
    }
    /** Monaco官方全局API只读观测当前可见原编辑器；不修改正文、模型或选区。 */
    const model = () => step(() => page.evaluate(() => {
      const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
      if (editors?.length !== 1) throw Error('重命名原查询Monaco不唯一'); const value = editors[0].getModel(); if (!value || value.isDisposed()) throw Error('重命名原查询模型未知');
      return { value: value.getValue(), uri: value.uri.toString(), eol: value.getEOL() };
    }));
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      expect(await records()).toEqual([]); expect((await settings()).tabs).toEqual([]);
      // 仅使用正式Main准备合成配置，不声称连接表单、建库、保存查询表单或SQL执行验收。
      const prepared = await step(() => page.evaluate(async input => {
        const profile = await window.dbark.invoke('connections.save', { id: 'rename-offline-profile', name: '重命名离线配置', dialect: 'mysql', host: 'never.invalid', port: 1, user: 'offline-only', group: '', color: '#456789', database: '配置默认库', rememberPassword: false }).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; });
        const original = await window.dbark.invoke('queries.create', { name: input.originalName, connectionId: profile.id, context: { state: 'known', database: '原查询库' }, sql: input.sql });
        const other = await window.dbark.invoke('queries.create', { name: input.renamedName, connectionId: profile.id, context: { state: 'known', database: null }, sql: input.otherSql });
        const initial = await window.dbark.invoke('queries.organizationGet', {}), created = await window.dbark.invoke('queries.organizationApply', { expectedRevision: initial.revision, operation: { kind: 'create', name: '原查询归属组', parentId: null } });
        const group = created.groups.find(group => group.name === '原查询归属组'); if (!group) throw Error('合成分组未创建');
        await window.dbark.invoke('queries.organizationApply', { expectedRevision: created.revision, operation: { kind: 'moveQueries', groupId: group.id, queries: [{ id: original.source.id, digest: original.source.digest }] } });
        const current = await window.dbark.invoke('settings.get', {});
        const next = { ...current, activeTabId: 'rename-bound-open', tabs: [
          { id: 'rename-bound-open', kind: 'query' as const, title: '原打开标签保留', connectionId: profile.id, database: '原查询库', databaseContext: { state: 'known' as const, database: '原查询库' }, sourceBinding: original.source, sql: input.openedSql },
          { id: 'rename-extra-open', kind: 'query' as const, title: '额外草稿保留', connectionId: profile.id, databaseContext: { state: 'known' as const, database: null }, sql: input.extraSql },
        ] };
        await window.dbark.invoke('settings.save', next);
        const canonical = await window.dbark.invoke('settings.get', {});
        return { profile, original, other, groupId: group.id, settings: canonical };
      }, { originalName, renamedName, sql, otherSql, openedSql, extraSql }));
      expect(prepared.profile.rememberPassword).toBe(false); expect(prepared.profile.password).toBeUndefined(); expect(prepared.original.source.digest).toMatch(/^[a-f0-9]{64}$/);
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
      await step(() => expect(page.locator('.query-tab:visible .sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false'));
      // 正式连接保存准备可能启动utility；旁观只从准备/reload/正文就绪后的实际UI阶段开始。
      await installAudit();
      const baselineSettings = await settings(), baselineRecords = await records(), baselineGroups = organization(await groups()), baselineModel = await model();
      const baselineProfiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(baselineProfiles).toEqual([prepared.profile]);
      expect(baselineSettings.tabs).toEqual(prepared.settings.tabs); expect(baselineSettings.activeTabId).toBe('rename-bound-open'); expect(baselineModel.value).toBe(openedSql.replaceAll('\r\n', baselineModel.eol));
      const before = baselineRecords.find(query => query.id === prepared.original.source.id)!, control = baselineRecords.find(query => query.id === prepared.other.source.id)!;
      expect(before).toMatchObject({ name: originalName, sql, connectionId: prepared.profile.id, database: '原查询库', databaseContext: { state: 'known', database: '原查询库' } }); expect(control).toMatchObject({ name: renamedName, sql: otherSql });
      const entry = await sourceEntry(before.id); expect(entry.digest).toBe(prepared.original.source.digest); expect(entry.groupId).toBe(prepared.groupId);
      await openList();
      const card = () => list().locator('article.history-card').filter({ has: page.locator('pre').filter({ hasText: 'RENAME_ORIGINAL_SOURCE_仅此记录' }) });
      await step(() => expect(card()).toHaveCount(1)); await step(() => expect(card().locator('strong')).toHaveText(entry.query.name)); await step(() => expect(card().locator('pre')).toHaveText(entry.sqlPreview + (entry.previewTruncated ? '…' : '')));
      await step(() => card().getByRole('button', { name: text.rename, exact: true }).click());
      const editor = () => list().getByRole('group', { name: text.rename, exact: true });
      await step(() => editor().getByRole('textbox', { name: text.newName, exact: true }).fill('这次仅取消'));
      await step(() => editor().getByRole('textbox', { name: text.newName, exact: true }).press('Escape'));
      await step(() => expect(editor()).toHaveCount(0)); await step(() => expect(list()).toBeVisible());
      expect((await step(audit)).calls.filter(call => call.command === 'queries.renameChecked')).toEqual([]); expect(await records()).toEqual(baselineRecords);
      await step(() => card().getByRole('button', { name: text.rename, exact: true }).click());
      await step(() => editor().getByRole('textbox', { name: text.newName, exact: true }).fill(renamedName)); await step(() => editor().getByRole('button', { name: text.confirm, exact: true }).click());
      await step(() => expect(editor()).toHaveCount(0)); await step(() => expect(list().getByRole('button', { name: pages.refresh, exact: true })).toBeEnabled()); await step(() => expect(card().locator('strong')).toHaveText(renamedName));
      const changedRecords = await records(), after = changedRecords.find(query => query.id === before.id)!;
      const { name: _oldName, updatedAt: _oldTime, ...oldFields } = before, { name: _newName, updatedAt: _newTime, ...newFields } = after;
      expect(after.name).toBe(renamedName); expect(newFields).toEqual(oldFields); expect(Date.parse(after.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));
      expect(changedRecords.find(query => query.id === control.id)).toEqual(control); expect(changedRecords.filter(query => query.name === renamedName)).toHaveLength(2); expect(organization(await groups())).toEqual(baselineGroups);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual(baselineProfiles);
      const renamedEntry = await sourceEntry(before.id); expect(renamedEntry.groupId).toBe(prepared.groupId); expect(renamedEntry.digest).not.toBe(entry.digest);
      expect((await settings()).tabs).toEqual(baselineSettings.tabs); expect((await settings()).activeTabId).toBe(baselineSettings.activeTabId);
      // 两项真实CAS拒绝只尝试旧摘要，本地失败不可改写SQL、名称或已打开标签。
      await step(() => expect(page.evaluate(input => window.dbark.invoke('queries.renameChecked', input), { id: before.id, digest: entry.digest, name: '旧摘要不得改名' })).rejects.toThrow(text.stale));
      await step(() => expect(page.evaluate(input => window.dbark.invoke('queries.updateSource', input), { source: prepared.original.source, content: { name: originalName, connectionId: prepared.profile.id, context: { state: 'known' as const, database: '原查询库' }, sql: 'SELECT 旧摘要不得覆盖;' } })).rejects.toThrow());
      expect(await records()).toEqual(changedRecords);
      await step(() => list().getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(list()).toBeHidden());
      expect(await model()).toEqual(baselineModel); expect((await settings()).tabs).toEqual(baselineSettings.tabs);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      await quit();
      // 仅在原owner确认退出后，使用夹具明确许可重启同一临时profile，不新建替代配置。
      check(); const restarted = await desktop.restartOwnedDesktop(info); application = restarted.application; page = restarted.page; child = application.process(); closed = false; check(); await installAudit();
      await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
      await step(() => expect(page.locator('.query-tab:visible .sql-editor-wrap > [aria-busy]')).toHaveAttribute('aria-busy', 'false'));
      expect(await records()).toEqual(changedRecords); expect(organization(await groups())).toEqual(baselineGroups); expect((await sourceEntry(before.id)).groupId).toBe(prepared.groupId);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }))))).toEqual(baselineProfiles);
      const restoredSettings = await settings(); expect(restoredSettings.tabs).toEqual(baselineSettings.tabs); expect(restoredSettings.activeTabId).toBe(baselineSettings.activeTabId);
      const restoredModel = await model(); expect(restoredModel.value).toBe(baselineModel.value); expect(restoredModel.eol).toBe(baselineModel.eol);
      await openList(); await step(() => expect(card()).toHaveCount(1)); await step(() => expect(card().locator('strong')).toHaveText(renamedName));
      await step(() => list().getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(list()).toBeHidden());
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); await quit();
      // 实际配置文件名是dbark.sqlite；只在原进程退出后，以独立SQL.js只读副本核schema9及原始记录。
      check(); const initSqlJs = require('sql.js') as typeof import('sql.js');
      const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') }); check();
      const bytes = await fs.readFile(join(directory, 'dbark.sqlite')); check(); const db = new SQL.Database(bytes);
      try {
        const queryRows = db.exec('SELECT id,data,updated_at FROM queries ORDER BY id')[0].values;
        const stored = queryRows.map(row => JSON.parse(String(row[1])) as typeof after); expect(stored).toEqual([...changedRecords].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        for (const row of queryRows) expect(String(row[2])).toBe((JSON.parse(String(row[1])) as typeof after).updatedAt);
        expect(Number(db.exec('PRAGMA user_version')[0].values[0][0])).toBe(9);
        expect(db.exec('SELECT query_id,group_id FROM saved_query_memberships ORDER BY query_id')[0].values).toEqual([[before.id, prepared.groupId]]);
        const organizationData = JSON.parse(String(db.exec('SELECT data FROM saved_query_organization WHERE id=1')[0].values[0][0])); expect(organizationData.version).toBe(1); expect(organizationData.groups).toEqual(baselineGroups.groups.map(({ id, name, parentId }) => ({ id, name, parentId })));
        const storedSettings = JSON.parse(String(db.exec('SELECT data FROM settings WHERE id=1')[0].values[0][0])) as typeof baselineSettings; expect(storedSettings.tabs).toEqual(baselineSettings.tabs); expect(storedSettings.activeTabId).toBe(baselineSettings.activeTabId);
      } finally { db.close(); } check();
      const renameCalls = reports.flatMap(report => report.calls).filter(call => call.command === 'queries.renameChecked');
      expect(renameCalls.filter(call => call.ok)).toEqual([{ command: 'queries.renameChecked', renameId: before.id, ok: true }]); expect(renameCalls.filter(call => call.ok === false)).toHaveLength(1);
      expect(reports.map(report => report.pending)).toEqual([0, 0]); expect(reports.map(report => report.forks)).toEqual([0, 0]);
      reports.forEach(assertLocalAudit);
      expect(reports.flatMap(report => report.calls).filter(call => /^(?:connections\.open|query\.execute|query\.transaction|sessions\.create)$/.test(call.command))).toEqual([]);
      await info.attach('保存查询重命名正式离线终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.saved-query-rename-offline', originalId: before.id, duplicateNameOtherId: control.id, confirmedRenames: 1, escapeRenames: 0, groupId: prepared.groupId, sourceSqlExact: true, sourceContextPreserved: true, otherRecordExact: true, openSourceBindingPreserved: true, bothDraftsPreserved: true, staleRenameRejected: true, staleUpdateRejected: true, normalOwnedExits: 2, originalProcessExitCodes: exits, sameProfileRestart: true, sqlite: 'dbark.sqlite', schema: 9, sqliteRawRecordsAndMembershipsVerified: true, auditUtilityForks: [0, 0], auditPendingAtRestore: [0, 0], transparentMainAudit: true, uiCommandsAllLocalVerified: true, cancelsOnlyObservedLocalPageTasks: true, preparationUtilityStartsAudited: false, testDatabaseExecutions: 0, testClipboardOperations: 0, nativeFilePickerOperations: 0, actualConnectionFormVerified: false, installerVerified: false, macOSVerified: false, auditScope: '首次从合成Main准备/reload/正文就绪后开始；第二次从原profile重启后安装至退出前restore。准备与退出不冒充Main全程审计，准备utility启动不冒充SQL执行。' })), contentType: 'application/json' });
      completed = true;
    } catch (reason) { desktop.retainOwnedDesktopResources(info); throw reason; }
  });
}
