import { test as base } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_OBJECT_URI_OFFLINE === '1';
const title = '系统对象链接正式Main事件与真实副实例离线拒绝不启动数据库';
if (enabled) register(); else base.skip(title, () => {});

/** 只验证离线系统入口、原IPC和错误投影；不替换产品结果，不访问数据库或系统剪贴板。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { objectUri } = require('../../src/shared/workbench') as typeof import('../../src/shared/workbench');
  const { externalObjectUrisZh: text } = require('../../src/shared/externalObjectUris.zh-CN') as typeof import('../../src/shared/externalObjectUris.zh-CN');
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { test, expect } = runtime;
  const guard = () => { if (!enabled || process.env.DBARK_OBJECT_URI_OFFLINE !== '1') throw Error('系统链接离线显式门已变化'); };
  let complete = false;
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ retries: 0, mode: 'serial' }); test.setTimeout(90000);
  test.afterEach(({}, info) => { if (!complete) { runtime.retainOwnedDesktopResources(info); throw Error('系统链接离线例未完整收尾，保留现场'); } });

  test(title, async ({}, info) => {
    guard(); const original = runtime.ownedDesktopResources(info), application = original.application, page = original.page;
    const own = () => { guard(); const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed) throw Error('系统链接原实例归属变化'); };
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
    const baseline = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    const launch = await application.evaluate(({ app, ipcMain, BrowserWindow, utilityProcess }) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), originalFork = utilityProcess.fork;
      const window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (root.__dbarkObjectUriAudit || !previous || BrowserWindow.getAllWindows().length !== 1) throw Error('系统链接旁观归属未知');
      const state = { pending: 0, calls: [] as { command: string; ok: boolean }[], forks: 0, check() {}, restore() {} };
      const check = () => { if (root.__dbarkObjectUriAudit !== state || handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== blocked || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1) throw Error('系统链接旁观归属变化'); };
      const blocked = ((..._args: unknown[]) => { state.forks++; throw Error('离线系统链接例禁止引擎启动'); }) as typeof utilityProcess.fork;
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== window.webContents || event.senderFrame !== frame) throw Error('原IPC来源变化');
        const fact = { command: String(payload?.command), ok: false }; state.calls.push(fact); state.pending++;
        try { const result = await previous(event, payload); check(); fact.ok = result?.ok === true; return result; } finally { state.pending--; }
      };
      state.check = check; state.restore = () => { check(); if (state.pending) throw Error('系统链接IPC未收尾'); handlers.set('dbark:request', previous); utilityProcess.fork = originalFork; delete root.__dbarkObjectUriAudit; };
      root.__dbarkObjectUriAudit = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = blocked;
      return { executable: process.execPath, development: process.defaultApp === true, appPath: app.getAppPath(), userData: app.getPath('userData') };
    });
    own();
    const facts = () => application.evaluate(() => { const state = (globalThis as any).__dbarkObjectUriAudit; state.check(); return { pending: state.pending as number, calls: state.calls as { command: string; ok: boolean }[], forks: state.forks as number }; });
    await application.evaluate(({ app }) => {
      let prevented = false; app.emit('open-url', { preventDefault() { prevented = true; } } as Electron.Event, 'dbark://object/v1/invalid');
      if (!prevented) throw Error('原open-url未阻止默认处理');
    }); own();
    await expect(page.getByText(text.invalid, { exact: true })).toBeVisible();
    await expect.poll(async () => (await facts()).calls.filter(call => call.command === 'workbench.protocolFinish' && call.ok).length).toBe(1);

    // 真正启动第二个Electron进程：原process.argv由副实例传additionalData，主实例继续使用原窗口。
    const uri = objectUri({ connectionId: 'offline-no-such-connection', database: '原库/ %22', kind: 'table', name: '表"尾\\' });
    const env = Object.fromEntries(Object.entries({ ...process.env, DBARK_USER_DATA: launch.userData }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE;
    const arguments_ = [...(launch.development ? [launch.appPath] : []), uri];
    const child = spawn(launch.executable, arguments_, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    // 先订阅真实终态，再持久化PID；超时也能精确找到本例副实例，不能以退出观察超时代替退出。
    const secondaryExit = new Promise<{ pid: number | undefined; code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => resolve({ pid: child.pid, code, signal }));
    });
    void secondaryExit.catch(() => undefined); // 附件IO期间也保留原拒绝，由下方同一Promise报告。
    const secondaryRecord = { pid: child.pid, executable: launch.executable, arguments: arguments_, userData: launch.userData };
    await info.attach('系统链接副实例启动归属', { body: JSON.stringify(secondaryRecord, null, 2), contentType: 'application/json' });
    let outputBytes = 0;
    const retainOutput = (channel: string, chunk: Buffer) => {
      // 限定本例控制台总量，既不隐藏错误，也不让副实例无限输出挤满内存。
      const kept = chunk.subarray(0, Math.max(0, 65536 - outputBytes)); outputBytes += kept.length;
      if (kept.length) console.log(`DBARK_OBJECT_URI_SECONDARY_${channel}:` + kept.toString('utf8'));
    };
    child.stdout?.on('data', (chunk: Buffer) => retainOutput('STDOUT', chunk));
    child.stderr?.on('data', (chunk: Buffer) => retainOutput('STDERR', chunk));
    const secondary = await secondaryExit;
    await info.attach('系统链接副实例退出终态', { body: JSON.stringify(secondary), contentType: 'application/json' });
    own(); expect(secondary.code).toBe(0); expect(secondary.signal).toBeNull(); expect(secondary.pid).toBeGreaterThan(0);
    await expect(page.getByText(text.resolveFailed, { exact: true })).toBeVisible();
    await expect.poll(async () => (await facts()).calls.filter(call => call.command === 'workbench.protocolFinish' && call.ok).length).toBe(2);
    const result = await facts(); expect(result.pending).toBe(0); expect(result.forks).toBe(0);
    expect(result.calls.filter(call => call.command === 'workbench.protocolResolve')).toEqual([{ command: 'workbench.protocolResolve', ok: false }]);
    expect(result.calls.some(call => call.command === 'workbench.protocolCommit')).toBe(false);
    expect(await page.evaluate(() => window.dbark.invoke('settings.get', {}))).toEqual(baseline);
    await application.evaluate(() => { (globalThis as any).__dbarkObjectUriAudit.restore(); }); own();
    expect(runtime.pageErrors).toEqual([]);
    await info.attach('系统链接离线入口证据', { body: JSON.stringify({ secondary, ...result, scope: '正式open-url事件与真实副实例；不是系统协议注册或实库对象成功导航' }, null, 2), contentType: 'application/json' });
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true); complete = true;
  });
}
