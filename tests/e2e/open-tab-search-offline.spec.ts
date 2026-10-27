import { test as base } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认及列举先短路；不加载桌面、文件、驱动或任何认证入口。
if (!listing && process.env.DBARK_OPEN_TAB_SEARCH_OFFLINE === '1' && process.env.DBARK_INTEGRATION_ENABLED === '0') register();
else base.skip('已打开标签查找的离线真实Main/GUI专项默认关闭（未执行）', () => {});

/** 本例只准备本地配置并切换已有查询，不建连、不执行SQL、不使用系统剪贴板。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { openTabSearchZh: text } = require('../../src/renderer/locales/openTabSearch.zh-CN') as typeof import('../../src/renderer/locales/openTabSearch.zh-CN');
  const { queryContextZh } = require('../../src/renderer/locales/queryContext.zh-CN') as typeof import('../../src/renderer/locales/queryContext.zh-CN');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  const { join, resolve } = require('node:path') as typeof import('node:path');
  const { execFile } = require('node:child_process') as typeof import('node:child_process');
  const { promisify } = require('node:util') as typeof import('node:util');
  const executeFile = promisify(execFile), executable = require('electron') as string;
  let retained = false, complete = false;
  const guard = () => {
    const info = test.info();
    if (retained || process.platform !== 'win32' || process.env.DBARK_OPEN_TAB_SEARCH_OFFLINE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || info.config.workers !== 1 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('标签查找离线专项要求原Windows/双门/单worker及零重试');
  };
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(120000); test.describe.configure({ mode: 'serial', retries: 0 });
  test.afterEach(({}, info) => { if (!complete) { retained = true; runtime.retainOwnedDesktopResources(info); throw Error('标签查找原生命周期未完整收尾，保留App与所属目录'); } });
  test('空工作区、24标签检索、键盘与鼠标按准确身份切换且原内容保持', async ({ trace, screenshot, video }, info) => {
    const captured = runtime.ownedDesktopResources(info), application = captured.application, page = captured.page, originalProcess = application.process(), directory = runtime.dataDir;
    let closed = false, armed = false;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { guard(); const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory) throw Error('标签查找原App或目录归属变化'); } }, () => test.info());
    const audit = () => application.evaluate(() => { const state = (globalThis as any).__openTabSearchOffline; state.check(); return { pending: state.pending as number, calls: state.calls as { command: string; ok: boolean }[], denied: state.denied as string[], engineStarts: state.engineStarts as number, savedActiveIds: state.savedActiveIds as string[] }; });
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { clock.assertCurrent(); if (armed && !closed) await audit(); const value = await action(); clock.assertCurrent(); if (armed && !allowClosed && !closed) await audit(); return value; };
    try {
      guard(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      await step(() => info.attach('标签查找原启动线索', { body: JSON.stringify({ directory, launcherPid: originalProcess.pid }), contentType: 'application/json' }));
      const actual = await step(() => application.evaluate(({ app }) => ({ pid: process.pid, executable: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData'), packaged: app.isPackaged, browserPids: app.getAppMetrics().filter(metric => metric.type === 'Browser').map(metric => metric.pid) })));
      await step(() => info.attach('标签查找原Main身份', { body: JSON.stringify(actual), contentType: 'application/json' }));
      expect(actual.packaged).toBe(false); expect(realpathSync(actual.executable)).toBe(realpathSync(executable)); expect(realpathSync(actual.appPath)).toBe(realpathSync(resolve('.'))); expect(realpathSync(actual.userData)).toBe(realpathSync(directory)); expect(actual.browserPids).toEqual([actual.pid]);
      const launcherPid = originalProcess.pid; if (!Number.isSafeInteger(launcherPid) || !launcherPid || launcherPid < 1 || !Number.isSafeInteger(actual.pid) || actual.pid < 1) throw Error('标签查找原启动缺少有效PID');
      let launcherLineage: unknown;
      if (actual.pid !== launcherPid) {
        // Windows原process()可能是cmd launcher，实际Main须由Browser指标和CIM父链共同证明。
        const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter 'ProcessId = ${launcherPid} OR ProcessId = ${actual.pid}' | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; executable=$_.ExecutablePath; createdUtc=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`;
        const result = await step(() => executeFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 })); expect(result.stderr).toBe('');
        const rows = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()) as { pid: number; parentPid: number; executable: string; createdUtc: string }[]; expect(rows).toHaveLength(2);
        const main = rows.find(row => row.pid === actual.pid), launcher = rows.find(row => row.pid === launcherPid); expect(main).toBeDefined(); expect(launcher).toBeDefined(); expect(main!.parentPid).toBe(launcherPid); expect(realpathSync(main!.executable)).toBe(realpathSync(actual.executable)); expect(Number.isFinite(Date.parse(launcher!.createdUtc)) && Number.isFinite(Date.parse(main!.createdUtc)) && Date.parse(launcher!.createdUtc) <= Date.parse(main!.createdUtc)).toBe(true); launcherLineage = rows;
      }
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]);
      const initial = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(initial.tabs).toEqual([]);
      const picker = () => page.getByRole('dialog', { name: text.title, exact: true }), input = () => picker().getByRole('combobox', { name: text.searchLabel, exact: true }), options = () => picker().getByRole('option');
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: text.entry, exact: true }).click()); await step(() => expect(picker()).toBeVisible()); await step(() => expect(input()).toBeFocused()); await step(() => expect(picker().getByText(text.empty, { exact: true })).toBeVisible()); await step(() => expect(options()).toHaveCount(0));
      await step(() => input().press('Enter')); await step(() => expect(picker()).toBeVisible()); await step(() => page.keyboard.press('Escape')); await step(() => expect(picker()).toBeHidden()); expect(await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).toEqual(initial);
      // 正式Main准备本地配置，不计作连接表单、产品新建查询或重启恢复验收。
      const prepared = await step(() => page.evaluate(async () => {
        const before = await window.dbark.invoke('settings.get', {});
        const profiles: import('../../src/shared/contracts').ConnectionProfile[] = [];
        for (const [id, name, host, database] of [['open-tab-offline-a', '离线甲', 'offline-a.example.invalid', '配置默认甲'], ['open-tab-offline-b', '离线乙', 'offline-b.example.invalid', '配置默认乙']]) profiles.push(await window.dbark.invoke('connections.save', { id, name, host, database, group: '标签查找离线', color: '#607d8b', dialect: 'mysql', port: 3306, user: 'offline-only', rememberPassword: false }));
        const saved = await window.dbark.invoke('queries.create', { name: '原绑定查询', connectionId: profiles[0].id, context: { state: 'known', database: '绑定库' }, sql: '-- TAB_SQL_ONLY_00' });
        const tabs: typeof before.tabs = Array.from({ length: 24 }, (_, index) => ({ id: 'open-tab-offline-' + String(index).padStart(2, '0'), kind: 'query' as const, title: '离线查询 ' + String(index).padStart(2, '0'), connectionId: profiles[index % 2].id, database: '业务库' + index, databaseContext: { state: 'known' as const, database: '业务库' + index }, sql: '-- TAB_SQL_ONLY_' + String(index).padStart(2, '0') }));
        tabs[0] = { ...tabs[0], title: saved.name, database: '绑定库', databaseContext: { state: 'known', database: '绑定库' }, sourceBinding: saved.source };
        tabs[2] = { ...tabs[2], database: undefined, databaseContext: { state: 'known', database: null } };
        tabs[3] = { ...tabs[3], database: undefined, databaseContext: { state: 'unknown' } };
        tabs[4] = { ...tabs[4], database: '遗留库', databaseContext: undefined };
        tabs[22] = { ...tabs[22], title: '同名查询', database: '目标库甲', databaseContext: { state: 'known', database: '目标库甲' } };
        tabs[23] = { ...tabs[23], title: '同名查询', database: '目标库乙', databaseContext: { state: 'known', database: '目标库乙' } };
        // 缺项须真正省略，不能将显式undefined写入严格settings合同。
        for (const tab of tabs) { if (tab.database === undefined) delete tab.database; if (tab.databaseContext === undefined) delete tab.databaseContext; }
        await window.dbark.invoke('settings.save', { ...before, tabs, activeTabId: tabs[0].id }); return { profiles, saved };
      }));
      expect(prepared.profiles.every(profile => profile.password === undefined && profile.rememberPassword === false)).toBe(true);
      await step(() => page.reload()); await step(() => expect(page.locator('.query-tab')).toHaveCount(24)); await step(() => expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('TAB_SQL_ONLY_00'));
      const baseline = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(baseline.tabs).toHaveLength(24); expect(baseline.activeTabId).toBe(baseline.tabs[0].id); expect(baseline.tabs[0].sourceBinding).toEqual(prepared.saved.source);
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toEqual(prepared.profiles); const right = baseline.tabs[23], left = baseline.tabs[22];
      // 观察范围从准备/reload完成后开始；只转发原Main，写入仅允许整份配置中准确activeTabId改变。
      await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, baseline) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame, originalFork = utilityProcess.fork;
        if (!previous || windows.length !== 1 || !frame || root.__openTabSearchOffline) throw Error('标签查找Main旁观入口未知');
        const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        const original = { ...baseline, activeTabId: undefined }, state = { pending: 0, denied: [] as string[], engineStarts: 0, calls: [] as { command: string; ok: boolean }[], savedActiveIds: [] as string[], permission: undefined as string | undefined, check() {}, allow(_id: string) {}, restore() {} };
        const check = () => { if (root.__openTabSearchOffline !== state || handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== blocked || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || state.denied.length) throw Error('标签查找原Main/文档/旁观已失效'); };
        const reject = (command: string): never => { state.denied.push(command); throw Error('标签查找禁止数据库或非预期写入：' + command); };
        const blocked = ((..._args: unknown[]) => { state.engineStarts++; return reject('utilityProcess.fork'); }) as typeof utilityProcess.fork;
        const allowed = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish']);
        const wrapped = async (event: any, payload: any) => {
          check(); if (event.sender !== contents || event.senderFrame !== frame) return reject('外来文档IPC'); const command = String(payload?.command), input = payload?.input;
          if (!allowed.has(command)) return reject(command);
          if (command === 'settings.save') { if (!state.permission || input?.activeTabId !== state.permission || stable({ ...input, activeTabId: undefined }) !== stable(original)) return reject(command); state.permission = undefined; }
          const fact = { command, ok: false }; state.calls.push(fact); state.pending++;
          try { const response = await previous(event, payload); check(); fact.ok = response?.ok === true; if (command === 'settings.save' && fact.ok) state.savedActiveIds.push(input.activeTabId); return response; }
          finally { state.pending--; }
        };
        state.check = check; state.allow = id => { check(); if (state.pending || state.permission || !baseline.tabs.some(tab => tab.id === id)) throw Error('标签切换许可归属或上一写入未结束'); state.permission = id; };
        state.restore = () => { check(); if (state.pending || state.permission || state.calls.some(call => !call.ok)) throw Error('标签查找原IPC未收尾'); handlers.set('dbark:request', previous); utilityProcess.fork = originalFork; delete root.__openTabSearchOffline; };
        root.__openTabSearchOffline = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = blocked; check();
      }, baseline)); armed = true;
      const allow = (id: string) => step(() => application.evaluate((_electron, id) => (globalThis as any).__openTabSearchOffline.allow(id), id));
      const unchanged = (activeTabId: string) => step(async () => { const saved = await page.evaluate(() => window.dbark.invoke('settings.get', {})); expect(saved).toEqual({ ...baseline, activeTabId }); return saved; });
      const assertStripVisible = async (tab: typeof baseline.tabs[number]) => {
        const active = page.locator('.tab-strip [data-active-workspace-tab="true"]'); await step(() => expect(active).toHaveCount(1)); await step(() => expect(active.locator('.tab-select')).toHaveText(tab.title));
        await step(() => expect.poll(async () => { const bounds = await active.boundingBox(), strip = await page.locator('.tab-strip').boundingBox(); return !!bounds && !!strip && bounds.width > 0 && bounds.x >= strip.x - 1 && bounds.x + bounds.width <= strip.x + strip.width + 1; }).toBe(true));
      };
      const overflow = await step(() => page.locator('.tab-strip').evaluate(node => node.scrollWidth > node.clientWidth)); expect(overflow).toBe(true);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: text.entry, exact: true }).click()); await step(() => expect(input()).toBeFocused()); await step(() => expect(options()).toHaveCount(24));
      const pickerText = await step(() => picker().innerText()); for (let index = 0; index < 24; index++) expect(pickerText).not.toContain('TAB_SQL_ONLY_' + String(index).padStart(2, '0'));
      await step(() => expect(options().nth(2)).toContainText(queryContextZh.none)); await step(() => expect(options().nth(3)).toContainText(queryContextZh.unknown)); await step(() => expect(options().nth(4)).toContainText(queryContextZh.legacy)); await step(() => expect(options().nth(4)).toContainText('遗留库'));
      for (const [key, index] of [['End', 23], ['ArrowUp', 22], ['ArrowDown', 23], ['Home', 0]] as const) { await step(() => input().press(key)); await step(() => expect(options().nth(index)).toHaveAttribute('aria-selected', 'true')); }
      await step(() => input().fill('同名查询 离线乙 目标库乙')); await step(() => expect(options()).toHaveCount(1)); await step(() => expect(options().first()).toContainText('离线乙')); await step(() => expect(options().first()).toContainText('目标库乙'));
      expect((await step(audit)).savedActiveIds).toEqual([]); await unchanged(baseline.tabs[0].id); await allow(right.id); await step(() => input().press('Enter')); await step(() => expect(picker()).toBeHidden());
      await step(() => expect.poll(async () => (await audit()).savedActiveIds).toEqual([right.id])); await unchanged(right.id); await assertStripVisible(right); await step(() => expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('TAB_SQL_ONLY_23'));
      // 从真实Monaco输入框聚焦后使用原快捷键；无匹配Enter与Esc都不能写配置或切标签。
      await step(() => page.locator('.query-tab:visible .monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press('ControlOrMeta+Shift+A')); await step(() => expect(input()).toBeFocused());
      await step(() => input().fill('TAB_SQL_ONLY_05')); await step(() => expect(options()).toHaveCount(0)); await step(() => expect(picker().getByText(text.noMatches, { exact: true })).toBeVisible()); await step(() => input().press('Enter')); await step(() => expect(picker()).toBeVisible()); await step(() => page.keyboard.press('Escape')); await step(() => expect(picker()).toBeHidden());
      await unchanged(right.id); expect((await step(audit)).savedActiveIds).toEqual([right.id]);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: text.entry, exact: true }).click()); await step(() => input().fill('同名查询')); await step(() => expect(options()).toHaveCount(2)); await step(() => input().fill('')); await step(() => expect(options()).toHaveCount(24));
      await step(() => input().fill('同名查询')); const target = options().filter({ has: page.getByText('离线甲', { exact: true }) }).filter({ has: page.getByText('目标库甲', { exact: true }) }); await step(() => expect(target).toHaveCount(1)); await allow(left.id); await step(() => target.click()); await step(() => expect(picker()).toBeHidden());
      await step(() => expect.poll(async () => (await audit()).savedActiveIds).toEqual([right.id, left.id])); const final = await unchanged(left.id); await assertStripVisible(left); await step(() => expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('TAB_SQL_ONLY_22'));
      expect(final.tabs).toEqual(baseline.tabs); expect(final.tabs[0].sourceBinding).toEqual(prepared.saved.source); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const result = await step(audit); expect(result.pending).toBe(0); expect(result.denied).toEqual([]); expect(result.engineStarts).toBe(0); expect(result.savedActiveIds).toEqual([right.id, left.id]); expect(result.calls.every(call => call.ok)).toBe(true);
      // restore自身已核收尾并撤销观察器；仅本次跳过销毁后的自动audit，不能再读取已删除的状态。
      await step(() => application.evaluate(() => (globalThis as any).__openTabSearchOffline.restore()), true); armed = false;
      clock.assertCurrent(); await runtime.confirmOwnedDesktopExit(info); closed = true; clock.assertCurrent(); expect(originalProcess.exitCode).toBe(0); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
      await step(() => info.attach('已打开标签查找离线真实流程', { body: JSON.stringify({ kind: 'dbark.open-tab-search-offline', actual, launcherPid, launcherLineage, initialEmptyPicker: true, tabCount: 24, sourceBindingPreserved: true, originalTabsPreserved: true, searchedSqlBody: false, savedActiveIds: result.savedActiveIds, noMatchEnterAndEscapePreserved: true, keyboardAndMouseActivation: true, activeStripItemVisible: true, databaseRequests: result.denied.length, engineStarts: result.engineStarts, pending: result.pending, observationScope: '正式Main本地配置准备及reload后，安装当前frame旁观至正常退出前restore', originalProcessExitCode: originalProcess.exitCode, localPersistenceConfirmedByMainRead: true, restartVerified: false, unverified: ['表标签数据或活动事务', '原生输入法组合键', '安装包', 'macOS', '重启后恢复'] }), contentType: 'application/json' }), true);
      complete = true;
    } catch (reason) { retained = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw reason; }
  });
}
