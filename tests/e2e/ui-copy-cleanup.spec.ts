import { test as base } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_UI_COPY_TEST === '1';
// 默认不占用桌面；专项只展示合成快照，不访问实库、认证或系统剪贴板。
if (enabled) {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || process.env.DBARK_EXECUTABLE_PATH || Object.keys(process.env).some(key => /^DBARK_(TEST_|C02_|SSH_|MTLS_|TLS_)/.test(key))) throw Error('文案专项必须使用独立源码入口并关闭实库与凭据环境');
  register();
} else base.skip('界面文案精简与键盘帮助专项默认关闭（未执行）', () => {});

/** 复用正式窗口、真实查询组件及严格退出归属；Main 仅替换固定的合成快照读取。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test, expect } = runtime;
  const { queryResultSnapshotUiZh: snapshotText } = require('../../src/renderer/locales/queryResultSnapshot.zh-CN') as typeof import('../../src/renderer/locales/queryResultSnapshot.zh-CN');
  const { queryResultFilterZh: filterText } = require('../../src/renderer/locales/queryResultFilter.zh-CN') as typeof import('../../src/renderer/locales/queryResultFilter.zh-CN');
  const { queryResultSortZh: sortText } = require('../../src/renderer/locales/queryResultSort.zh-CN') as typeof import('../../src/renderer/locales/queryResultSort.zh-CN');
  const baseline = process.env.DBARK_UI_COPY_BASELINE === '1';
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(90000);
  test.describe.configure({ mode: 'serial', retries: 0 });
  test('合成查询快照的说明密度、键盘帮助与主题窗口布局', async ({}, info) => {
    const owner = runtime.ownedDesktopResources(info), { application, page } = owner;
    let complete = false;
    // 只包含公开的虚构行；来源 SQL 仅供展示，不建立数据库连接。
    const snapshot = { kind: 'dbark.query-result-snapshot' as const, version: 1 as const, name: '界面精简示例', result: {
      columns: [{ key: 'id', name: 'id', type: 'LONG' }, { key: 'name', name: 'name', type: 'VAR_STRING' }, { key: 'created_at', name: 'created_at', type: 'DATETIME' }],
      rows: [{ id: 1, name: '示例记录', created_at: '2026-10-29 10:00:00' }], truncated: false, elapsedMs: 1, statement: 'SELECT id, name, created_at FROM example;',
    } };
    try {
      await info.attach('文案原生启动归属', { body: JSON.stringify(await application.evaluate(({ app }) => ({ pid: process.pid, executable: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData') }))), contentType: 'application/json' });
      await application.evaluate(({ ipcMain, utilityProcess, BrowserWindow }, snapshot) => {
        const handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0];
        if (!previous || !window || BrowserWindow.getAllWindows().length !== 1) throw Error('文案专项缺少唯一原窗口');
        const state = { opened: 0, denied: [] as string[], pending: 0 };
        (globalThis as any).__uiCopyAudit = state;
        const local = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'queries.list', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish']);
        utilityProcess.fork = (() => { state.denied.push('utilityProcess.fork'); throw Error('文案专项拒绝启动数据库引擎'); }) as typeof utilityProcess.fork;
        handlers.set('dbark:request', async (event: Electron.IpcMainInvokeEvent, payload: { command: string }) => {
          if (event.sender !== window.webContents) throw Error('文案专项拒绝外来窗口');
          const command = String(payload.command);
          if (command === 'resultSnapshotFiles.open') { state.opened++; return { ok: true, result: { name: '界面示例.dbark-result.json', snapshot } }; }
          if (!local.has(command)) { state.denied.push(command); throw Error('文案专项拒绝非本地命令：' + command); }
          state.pending++;
          try { return await previous(event, payload); } finally { state.pending--; }
        });
      }, snapshot);
      const cases = baseline ? [{ theme: 'dark' as const, width: 1440, height: 900 }] : [
        { theme: 'dark' as const, width: 1440, height: 900 }, { theme: 'light' as const, width: 1440, height: 900 },
        { theme: 'dark' as const, width: 1024, height: 768 }, { theme: 'light' as const, width: 1024, height: 768 },
      ];
      for (const item of cases) {
        await application.evaluate(({ BrowserWindow }, item) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setContentSize(item.width, item.height); }, item);
        await page.evaluate(async item => {
          const settings = await window.dbark.invoke('settings.get', {});
          await window.dbark.invoke('settings.save', { ...settings, theme: item.theme, activeTabId: 'copy-query', tabs: [{ id: 'copy-query', kind: 'query', connectionId: 'copy-offline', title: '示例查询', databaseContext: { state: 'known', database: null }, sql: 'SELECT id, name, created_at FROM example;' }] });
        }, item);
        await page.reload();
        const query = page.locator('.query-tab:visible');
        await query.getByRole('button', { name: snapshotText.open, exact: true }).click();
        await expect(query.locator('[role="grid"]')).toBeVisible();
        if (!baseline) {
          await expect(page.locator('.tab-order-help')).toHaveCount(0);
          await expect(query.locator('.query-result-snapshot-scope')).toHaveCount(0);
          await expect(query.locator('.query-result-sort-scope')).not.toBeVisible();
          await expect(query.locator('.query-result-filter-bar')).not.toContainText(filterText.scope);
        }
        await page.screenshot({ path: info.outputPath(`${baseline ? 'before' : 'after'}-${item.theme}-${item.width}.png`) });
        if (!baseline) {
          await query.getByRole('button', { name: sortText.panelTitle, exact: true }).click();
          const sort = query.getByRole('region', { name: sortText.panelTitle, exact: true });
          await expect(sort.locator('details.usage-help')).not.toHaveAttribute('open', '');
          await expect(sort.getByText(sortText.panelHint, { exact: true })).not.toBeVisible();
          // 原生 summary 接收 Enter 与空格，展开不会提交排序草稿。
          await sort.locator('summary').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
          await expect(sort.locator('summary')).toBeFocused(); await page.keyboard.press('Enter');
          await expect(sort.getByText(sortText.panelHint, { exact: true })).toBeVisible();
          await page.keyboard.press('Space'); await expect(sort.getByText(sortText.panelHint, { exact: true })).not.toBeVisible();
          await sort.getByRole('button', { name: sortText.panelCancel, exact: true }).click();
          await query.getByRole('button', { name: filterText.open, exact: true }).click();
          const filter = query.getByRole('region', { name: filterText.title, exact: true });
          await expect(filter.getByText(filterText.hint, { exact: true })).not.toBeVisible();
          await filter.locator('summary').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
          await expect(filter.locator('summary')).toBeFocused(); await page.keyboard.press('Enter');
          await expect(filter.getByText(filterText.hint, { exact: true })).toBeVisible();
          // 只检查本次新增帮助的边界，数据网格和工具条保留既有横向滚动。
          const overflow = await filter.locator('details.usage-help').evaluate(element => { const a = element.getBoundingClientRect(), b = element.parentElement!.getBoundingClientRect(), content = element.querySelector('.usage-help-content')!; return a.left < b.left - 1 || a.right > b.right + 1 || content.scrollWidth > content.clientWidth + 1; });
          expect(overflow).toBe(false);
          await page.screenshot({ path: info.outputPath(`help-${item.theme}-${item.width}.png`) });
          await page.keyboard.press('Space'); await expect(filter.getByText(filterText.hint, { exact: true })).not.toBeVisible();
          await page.screenshot({ path: info.outputPath(`filter-${item.theme}-${item.width}.png`) });
          await filter.getByRole('button', { name: filterText.cancel, exact: true }).click();
        }
      }
      const audit = await application.evaluate(() => (globalThis as any).__uiCopyAudit as { opened: number; denied: string[]; pending: number });
      expect(audit.opened).toBe(cases.length); expect(audit.denied).toEqual([]);
      expect(runtime.pageErrors).toEqual([]);
      await info.attach('文案专项范围', { body: JSON.stringify({ baseline, audit, syntheticSnapshot: true, databaseAcceptance: false }), contentType: 'application/json' });
      await runtime.confirmOwnedDesktopExit(info); complete = true;
    } finally {
      if (!complete) runtime.retainOwnedDesktopResources(info);
    }
  });
}
