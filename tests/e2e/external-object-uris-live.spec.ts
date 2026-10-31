import { test as base } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_OBJECT_URI_LIVE === '1';
const title = '正式系统对象链接只读打开MySQL84字符集系统表';
if (enabled) register(); else base.skip(title, () => {});

/** 默认/list不加载实库配置；只读取已核对实例的系统目录，不创建或清理服务器对象。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const live = require('./live-helpers') as typeof import('./live-helpers');
  const { objectUri } = require('../../src/shared/workbench') as typeof import('../../src/shared/workbench');
  const { recordViewZh } = require('../../src/renderer/locales/recordViews.zh-CN') as typeof import('../../src/renderer/locales/recordViews.zh-CN');
  const { tableGridZh } = require('../../src/renderer/locales/tableGrid.zh-CN') as typeof import('../../src/renderer/locales/tableGrid.zh-CN');
  const { zh } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { test, expect } = runtime;
  const configuration = { host: live.environment.DBARK_TEST_HOST, port: live.environment.DBARK_TEST_PORT, user: live.environment.DBARK_TEST_USER, password: live.environment.DBARK_TEST_PASSWORD, tls: live.environment.DBARK_TEST_TLS };
  /** 启动与每次异步边界都复核原双门和配置，不把缺省端口或其它实例当作已验目标。 */
  const guard = () => {
    if (!enabled || !live.enabled || process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_OBJECT_URI_LIVE !== '1') throw Error('系统对象链接实库显式双门已变化');
    if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(configuration.host ?? '') || configuration.port !== '13384' || !configuration.user || configuration.password === undefined || configuration.tls === '1') throw Error('本例仅接受已核对200的13384直连配置，不回退端口、账号或TLS配置');
    if (configuration.host !== live.environment.DBARK_TEST_HOST || configuration.port !== live.environment.DBARK_TEST_PORT || configuration.user !== live.environment.DBARK_TEST_USER || configuration.password !== live.environment.DBARK_TEST_PASSWORD || configuration.tls !== live.environment.DBARK_TEST_TLS) throw Error('系统对象链接原实库配置已变化');
  };
  let complete = false;
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ retries: 0, mode: 'serial' }); test.setTimeout(90000);
  test.afterEach(({}, info) => { if (!complete) { runtime.retainOwnedDesktopResources(info); throw Error('系统对象链接只读实库例未完整收尾，保留原实例现场'); } });

  test(title, async ({}, info) => {
    guard(); const original = runtime.ownedDesktopResources(info), { application, page } = original;
    const own = () => { guard(); const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed) throw Error('系统对象链接只读实库原实例归属变化'); };
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))).toEqual([]); own();
    const connection = await page.evaluate(config => window.dbark.invoke('connections.save', {
      id: '', name: '系统对象链接只读验收', group: '只读系统目录验证', color: '#51bda5', dialect: 'mysql', host: config.host!, port: 13384, user: config.user!, password: config.password, rememberPassword: false
    }).then(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; }), { host: configuration.host, user: configuration.user, password: configuration.password }); own();
    expect(connection.rememberPassword).toBe(false);
    // 正常重新加载应用store，禁止直接注入连接状态或调用协议领取接口代替React consumer。
    await page.reload(); own(); await expect(page.locator('.app-statusbar')).toBeVisible(); own();
    await expect(page.locator('.connection-row').getByRole('button', { name: '系统对象链接只读验收', exact: true })).toBeVisible(); own();

    // 只旁观正式Main处理器的原返回，不复制分发器、不修改结果，也不记录认证参数。
    await application.evaluate(({ ipcMain, BrowserWindow }) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request');
      const window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (root.__dbarkObjectUriLiveAudit || !previous || BrowserWindow.getAllWindows().length !== 1) throw Error('系统链接只读旁观归属未知');
      const state = { pending: 0, calls: [] as { command: string; ok: boolean }[], check() {}, restore() {} };
      const check = () => { if (root.__dbarkObjectUriLiveAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1) throw Error('系统链接只读旁观归属变化'); };
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== window.webContents || event.senderFrame !== frame) throw Error('系统链接只读原IPC来源变化');
        const fact = { command: String(payload?.command), ok: false }; state.calls.push(fact); state.pending++;
        try { const result = await previous(event, payload); check(); fact.ok = result?.ok === true; return result; } finally { state.pending--; }
      };
      state.check = check; state.restore = () => { check(); if (state.pending) throw Error('系统链接只读IPC未收尾'); handlers.set('dbark:request', previous); delete root.__dbarkObjectUriLiveAudit; };
      root.__dbarkObjectUriLiveAudit = state; handlers.set('dbark:request', wrapped);
    }); own();
    const facts = async () => { own(); const value = await application.evaluate(() => { const audit = (globalThis as any).__dbarkObjectUriLiveAudit; audit.check(); return { pending: audit.pending as number, calls: audit.calls as { command: string; ok: boolean }[] }; }); own(); return value; };
    const status = await page.evaluate(id => window.dbark.invoke('connections.open', { id }), connection.id); own();
    expect(status.dialect).toBe('mysql'); expect(status.version).toMatch(/^8\.4\./);
    const database = 'information_schema', table = 'CHARACTER_SETS';
    const databases = await page.evaluate(connectionId => window.dbark.invoke('metadata.databases', { connectionId }), connection.id); own(); expect(databases).toContain(database);
    const objects = await page.evaluate(input => window.dbark.invoke('metadata.objects', input), { connectionId: connection.id, database }); own();
    const matches = objects.filter(object => object.name === table); expect(matches).toHaveLength(1); const object = matches[0];
    expect(object.kind).toBe('table'); // 当前目录将SYSTEM VIEW映射到表页；URI仍使用真实objects回包的kind。
    const metadata = await page.evaluate(input => window.dbark.invoke('metadata.table', input), { connectionId: connection.id, database, table }); own();
    expect(metadata.database).toBe(database); expect(metadata.name).toBe(table); expect(metadata.objectKind).toBeUndefined();
    expect(metadata.columns.map(column => column.name)).toEqual(expect.arrayContaining(['CHARACTER_SET_NAME', 'DEFAULT_COLLATE_NAME']));
    const baseline = await page.evaluate(() => window.dbark.invoke('settings.get', {})); own(); expect(baseline.tabs).toEqual([]);
    const uri = objectUri({ connectionId: connection.id, database, kind: object.kind, name: object.name });
    await application.evaluate(({ app }, value) => {
      let prevented = false; app.emit('open-url', { preventDefault() { prevented = true; } } as Electron.Event, value);
      if (!prevented) throw Error('正式系统对象链接事件未阻止默认处理');
    }, uri); own();

    const tab = page.locator('.table-tab:visible'), grid = tab.getByRole('grid', { name: tableGridZh.grid, exact: true });
    await expect(grid).toBeVisible({ timeout: 30000 }); own();
    await expect.poll(async () => { own(); return grid.getByRole('columnheader').evaluateAll(headers => headers.map(header => header.querySelector('.data-header > span')?.firstChild?.textContent)); }).toEqual(expect.arrayContaining(['CHARACTER_SET_NAME', 'DEFAULT_COLLATE_NAME'])); own();
    await expect.poll(async () => { own(); return grid.getByRole('gridcell').evaluateAll(cells => cells.filter(cell => (cell.textContent ?? '').trim().length > 0).length); }).toBeGreaterThan(0); own();
    await expect(tab.locator('.loading-overlay')).toHaveCount(0); await expect(tab.locator('.info-strip').filter({ hasText: recordViewZh.unknownObject })).toBeVisible(); own();
    await expect(tab.getByRole('button', { name: zh.common.add, exact: true })).toBeDisabled(); await expect(page.locator('.error-box')).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0); own();
    await expect.poll(async () => (await facts()).calls.filter(call => call.command === 'workbench.protocolFinish' && call.ok).length).toBe(1);
    await expect.poll(async () => (await facts()).pending).toBe(0);
    const result = await facts();
    for (const command of ['workbench.protocolResolve', 'workbench.protocolCommit', 'workbench.protocolFinish']) expect(result.calls.filter(call => call.command === command)).toEqual([{ command, ok: true }]);
    // 完整Main调用白名单：只读目录/分页和本地布局；任何查询执行、结构或数据写入命令都失败。
    const allowed = new Set(['app.runtimeInfo', 'app.info', 'app.setDirty', 'connections.list', 'connections.open', 'metadata.databases', 'metadata.objects', 'metadata.table', 'table.page', 'table.preferences.get', 'tasks.list', 'settings.get', 'settings.save', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolResolve', 'workbench.protocolCommit', 'workbench.protocolFinish']);
    expect(result.calls.filter(call => !allowed.has(call.command))).toEqual([]); expect(result.calls.filter(call => !call.ok)).toEqual([]);
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); own(); expect(settings.tabs).toHaveLength(1);
    expect(settings.tabs[0]).toMatchObject({ kind: 'table', connectionId: connection.id, database, table }); expect(settings.activeTabId).toBe(settings.tabs[0].id);
    expect(runtime.pageErrors).toEqual([]);
    await info.attach('系统对象链接实库只读证据', { body: JSON.stringify({ dialect: status.dialect, version: status.version, database, table, objectKind: metadata.objectKind ?? 'unknown', ...result, scope: '正式Main open-url事件、React consumer及真实系统表只读页；不证明系统注册、Shell或冷启动' }, null, 2), contentType: 'application/json' }); own();
    await application.evaluate(() => { (globalThis as any).__dbarkObjectUriLiveAudit.restore(); }); own();
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true); complete = true;
  });
}
