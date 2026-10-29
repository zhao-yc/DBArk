import { test as base } from '@playwright/test';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const enabled = !listing && process.env.DBARK_RESULT_SNAPSHOT_GLOBAL === '1';
if (enabled && process.env.DBARK_INTEGRATION_ENABLED !== '0') throw Error('全局结果快照离线例必须显式关闭实库入口');
// 默认及列举不加载桌面、文件适配器或任何认证/实库帮助器。
if (enabled) register(); else base.skip('全局无连接结果快照真实文件保存及新进程离线重开默认关闭（未执行）', () => {});

/** 两例使用严格owned生命周期；原初始空工作区建立配置保持基线，不注入连接或查询标签。 */
function register(): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture'), { test, expect } = runtime;
  const { bindEditorIndentNativeCase } = require('./editor-indentation-native-gate') as typeof import('./editor-indentation-native-gate');
  const { mkdtemp, writeFile, readFile, lstat, readdir, realpath, unlink, rmdir } = require('node:fs/promises') as typeof import('node:fs/promises');
  const sync = require('node:fs') as typeof import('node:fs');
  const { basename, dirname, join, resolve } = require('node:path') as typeof import('node:path');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const { execFile } = require('node:child_process') as typeof import('node:child_process');
  const { promisify } = require('node:util') as typeof import('node:util');
  const executeFile = promisify(execFile);
  const { queryResultSnapshotViewerZh: text } = require('../../src/renderer/locales/queryResultSnapshotViewer.zh-CN') as typeof import('../../src/renderer/locales/queryResultSnapshotViewer.zh-CN');
  const { binaryCellZh } = require('../../src/renderer/locales/binaryCell.zh-CN') as typeof import('../../src/renderer/locales/binaryCell.zh-CN');
  const { binaryCellFilesZh } = require('../../src/renderer/locales/binaryCellFiles.zh-CN') as typeof import('../../src/renderer/locales/binaryCellFiles.zh-CN');
  const { queryResultSnapshotFileMessages: filesText } = require('../../src/main/queryResultSnapshotFiles') as typeof import('../../src/main/queryResultSnapshotFiles');
  const executable = require('electron') as string;
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  // 独立固定wire：不调用产品codec创建输入；数字使用协议的原始十进制文本。
  const wire = String.raw`{"kind":"dbark.query-result-snapshot","version":1,"name":"离线合成结果","result":{"columns":[{"key":"__proto__","name":"重复列","type":"VAR_STRING"},{"key":"constructor","name":"重复列","type":"VAR_STRING"},{"key":"big","name":"BIGINT","type":"LONGLONG"},{"key":"decimal","name":"DECIMAL","type":"NEWDECIMAL"},{"key":"date","name":"日期","type":"DATETIME"},{"key":"nullable","name":"NULL","type":"NULL"},{"key":"empty","name":"空串","type":"VAR_STRING"},{"key":"blob","name":"BLOB","type":"BLOB"},{"key":"emptyBlob","name":"空BLOB","type":"BLOB"},{"key":"negativeZero","name":"负零","type":"DOUBLE"}],"rows":[{"__proto__":"原型键安全","constructor":"构造键安全","big":"18446744073709551615","decimal":"12345678901234567890.1234567890","date":"2026-10-28 12:34:56.123456","nullable":null,"empty":"","blob":{"type":"binary","base64":"AP8A"},"emptyBlob":{"type":"binary","base64":""},"negativeZero":{"type":"number","text":"-0"}}],"truncated":true,"elapsedMs":{"type":"number","text":"0.5"},"statement":"SELECT '仅快照SQL'; -- offline-snapshot-source"}}`;
  const expectedWire = JSON.parse(wire);
  let halted = false, firstComplete = false, outputRemoved = false, output = '', sourcePath = '', savedPath = '', savedSha256 = '', firstPid = 0, firstProfile = '';
  let outputIdentity: { dev: number; ino: number } | undefined;
  const cases = new Map<object, { complete: boolean; check(): void }>();
  /** 专用双门只控制本例；不读取或消费数据库认证参数。 */
  const guard = () => {
    const info = test.info();
    if (halted || process.env.DBARK_RESULT_SNAPSHOT_GLOBAL !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || info.config.workers !== 1 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('全局结果快照离线原门或零重试配置已变化');
    if (info.title.includes('全新进程') && !firstComplete) throw Error('保存原例尚未严格闭合，不启动重开例');
    if (outputIdentity && !outputRemoved) { const stat = sync.lstatSync(output); if (!stat.isDirectory() || stat.isSymbolicLink() || sync.realpathSync(output) !== output || stat.dev !== outputIdentity.dev || stat.ino !== outputIdentity.ino) throw Error('结果快照原临时目录身份变化'); }
  };
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' });
  test.setTimeout(120000); test.describe.configure({ mode: 'serial', retries: 0 });
  test.afterEach(({}, info) => { try { const state = cases.get(info); if (!state?.complete) throw Error('结果快照原例未完整收尾，保留资源'); state.check(); cases.delete(info); } catch (reason) { halted = true; runtime.retainOwnedDesktopResources(info); throw reason; } });

  for (const mode of ['save', 'reopen'] as const) test(mode === 'save' ? '零连接零标签正式Main从全局入口导入并另存合成结果，零数据库请求及正常退出' : '全新进程零连接零标签从全局入口重开原保存文件，配置保持并正常退出', async ({ trace, screenshot, video }, info) => {
    const captured = runtime.ownedDesktopResources(info), application = captured.application, page = captured.page, profileDirectory = runtime.dataDir, originalProcess = application.process();
    let closed = false, armed = false;
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() { guard(); const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || runtime.dataDir !== profileDirectory) throw Error('结果快照原App归属变化'); } }, () => test.info());
    const completion = { complete: false, check() { clock.assertCurrent(); if (!closed || !runtime.ownedDesktopResources(info).closed) throw Error('结果快照原App未确认退出'); } }; cases.set(info, completion);
    /** 旁观只读取计数；正式Main原回包不被替换，失败保留原App和文件。 */
    const audit = () => application.evaluate(() => { const state = (globalThis as any).__queryResultSnapshotGlobal; state.check(); return { pending: state.pending as number, engineStarts: state.engineStarts as number, denied: state.denied as string[], calls: state.calls as { command: string; ok: boolean }[], opened: state.opened as number, saved: state.saved as number, chooserCalls: state.chooserCalls as number, originalCells: state.originalCells as { negativeZero: boolean; prototypeOwn: boolean; constructorOwn: boolean; big: string; decimal: string; date: string; nullable: unknown; empty: string; blob: string; emptyBlob: string; truncated: boolean } | undefined }; });
    const step = async <T,>(action: () => Promise<T>, allowClosed = false): Promise<T> => { clock.assertCurrent(); if (armed && !closed) await audit(); const value = await action(); clock.assertCurrent(); if (armed && !allowClosed && !closed) await audit(); return value; };
    try {
      guard(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      // 先保留失败恢复所需的原始目录与launcher线索，后续身份断言失败也不丢归属。
      await step(() => info.attach('结果快照原启动归属', { body: JSON.stringify({ kind: 'dbark.result-snapshot-launch', mode, profileDirectory, launcherPid: originalProcess.pid }), contentType: 'application/json' }));
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, userData: app.getPath('userData'), browserPids: app.getAppMetrics().filter(metric => metric.type === 'Browser').map(metric => metric.pid) })));
      await step(() => info.attach('结果快照原Main身份', { body: JSON.stringify({ kind: 'dbark.result-snapshot-main', mode, actual, launcherPid: originalProcess.pid, profileDirectory }), contentType: 'application/json' }));
      expect(actual.packaged).toBe(false); expect(await step(() => realpath(actual.executable))).toBe(await step(() => realpath(executable))); expect(await step(() => realpath(actual.appPath))).toBe(await step(() => realpath(resolve('.')))); expect(Number.isSafeInteger(actual.pid) && actual.pid > 0).toBe(true);
      expect(actual.browserPids).toEqual([actual.pid]); expect(await step(() => realpath(actual.userData))).toBe(await step(() => realpath(profileDirectory)));
      const launcherPid = originalProcess.pid;
      if (typeof launcherPid !== 'number' || !Number.isSafeInteger(launcherPid) || launcherPid <= 0) throw Error('结果快照原launcher缺少有效PID');
      let launcherLineage: unknown;
      if (process.platform === 'win32' && actual.pid !== launcherPid) {
        // Playwright在Windows通过shell启动Electron；保留原launcher，并核实真实Main的直接父链。
        const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter 'ProcessId = ${launcherPid} OR ProcessId = ${actual.pid}' | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; name=$_.Name; executable=$_.ExecutablePath; createdUtc=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`;
        const result = await step(() => executeFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 }));
        expect(result.stderr).toBe('');
        const records = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()) as { pid: number; parentPid: number; name: string; executable: string; createdUtc: string }[];
        expect(records).toHaveLength(2); const launcher = records.find(record => record.pid === launcherPid), main = records.find(record => record.pid === actual.pid);
        expect(launcher).toBeDefined(); expect(main).toBeDefined(); expect(main!.parentPid).toBe(launcherPid); expect(await step(() => realpath(main!.executable))).toBe(await step(() => realpath(actual.executable)));
        expect(Number.isFinite(Date.parse(launcher!.createdUtc)) && Number.isFinite(Date.parse(main!.createdUtc)) && Date.parse(launcher!.createdUtc) <= Date.parse(main!.createdUtc)).toBe(true);
        launcherLineage = { launcher, main };
      } else expect(actual.pid).toBe(launcherPid);
      if (mode === 'save') {
        firstPid = actual.pid; firstProfile = profileDirectory;
        output = await step(() => mkdtemp(join(tmpdir(), 'dbark-result-snapshot-global-'))); sourcePath = join(output, '合成输入.dbark-result.json'); savedPath = join(output, '真实保存.dbark-result.json');
        expect(dirname(resolve(output))).toBe(resolve(tmpdir())); expect(basename(output)).toMatch(/^dbark-result-snapshot-global-/);
        const stat = await step(() => lstat(output)); expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true); outputIdentity = { dev: stat.dev, ino: stat.ino };
        await step(() => info.attach('结果快照原临时文件归属', { body: JSON.stringify({ kind: 'dbark.result-snapshot-files', output, sourcePath, savedPath, outputIdentity }), contentType: 'application/json' }));
        await step(() => writeFile(sourcePath, wire, { flag: 'wx', mode: 0o600 }));
      } else { expect(firstComplete).toBe(true); expect(actual.pid).not.toBe(firstPid); expect(profileDirectory).not.toBe(firstProfile); expect(hash(await step(() => readFile(savedPath)))).toBe(savedSha256); }
      // 从fixture就绪后安装窗口级审计，再冻结真实空工作区的文档/chooser身份；不重签来源回包。
      await step(() => application.evaluate(({ ipcMain, dialog, BrowserWindow, utilityProcess }, input) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents;
        const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork;
        if (root.__queryResultSnapshotGlobal || typeof previous !== 'function' || windows.length !== 1 || !contents) throw Error('全局结果快照离线旁观归属未知');
        const state = { pending: 0, engineStarts: 0, denied: [] as string[], calls: [] as { command: string; ok: boolean }[], opened: 0, saved: 0, chooserCalls: 0, originalCells: undefined as unknown, frame: undefined as Electron.WebFrameMain | undefined, file: undefined as { mode: 'open' | 'save'; path: string; chosen: boolean } | undefined, reading: undefined as unknown, check() {}, arm(_mode: 'open' | 'save') {}, bind() {} };
        const check = () => { if (root.__queryResultSnapshotGlobal !== state || handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== blocked || dialog.showOpenDialog !== open || dialog.showSaveDialog !== save || window.isDestroyed() || contents.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || state.frame && contents.mainFrame !== state.frame) throw Error('全局结果快照离线原窗口/文档或适配器变化'); };
        const reject = (command: string): never => { state.denied.push(command); throw Error('全局结果快照离线禁止数据库或未声明请求：' + command); };
        const blocked = ((..._args: unknown[]) => { state.engineStarts++; return reject('utilityProcess.fork'); }) as typeof utilityProcess.fork;
        const choose = (mode: 'open' | 'save', args: unknown[]) => { check(); const file = state.file, options = args[1] as { title?: string }; if (!state.frame || !file || file.mode !== mode || file.chosen || state.reading !== file || args[0] !== window || options?.title !== (mode === 'open' ? input.openTitle : input.saveTitle)) throw Error('结果快照原生选择不属于当前原操作'); file.chosen = true; state.chooserCalls++; return file.path; };
        const open = (async (...args: unknown[]) => ({ canceled: false, filePaths: [choose('open', args)] })) as typeof dialog.showOpenDialog;
        const save = (async (...args: unknown[]) => ({ canceled: false, filePath: choose('save', args) })) as typeof dialog.showSaveDialog;
        const allowed = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.save', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish', 'resultSnapshotFiles.open', 'resultSnapshotFiles.save']);
        const wrapped = async (event: any, payload: any) => {
          check(); if (event.sender !== contents || event.senderFrame !== (state.frame ?? contents.mainFrame)) throw Error('结果快照IPC不是原窗口当前文档');
          const command = String(payload?.command), value = payload?.input, fact = { command, ok: false }; state.calls.push(fact);
          if (!allowed.has(command)) reject(command);
          const file = command === 'resultSnapshotFiles.open' || command === 'resultSnapshotFiles.save' ? state.file : undefined;
          if (command.startsWith('resultSnapshotFiles.')) { if (!file || state.reading || file.mode !== (command.endsWith('.open') ? 'open' : 'save') || !value || Object.keys(value).sort().join() !== (file.mode === 'open' ? '' : 'snapshot')) throw Error('结果快照文件请求不属于单个明确操作'); state.reading = file; }
          state.pending++;
          try {
            const response = await previous(event, payload); check(); fact.ok = response?.ok === true;
            if (file) {
              if (!file.chosen || !fact.ok || response.result?.name !== file.path.split(/[\\/]/).at(-1)) throw Error('结果快照原文件操作未成功闭合');
              if (file.mode === 'open') {
                const result = response.result.snapshot.result, row = result.rows[0]; state.opened++;
                state.originalCells = { negativeZero: Object.is(row.negativeZero, -0), prototypeOwn: Object.hasOwn(row, '__proto__'), constructorOwn: Object.hasOwn(row, 'constructor'), big: row.big, decimal: row.decimal, date: row.date, nullable: row.nullable, empty: row.empty, blob: row.blob.base64, emptyBlob: row.emptyBlob.base64, truncated: result.truncated };
              } else state.saved++;
              state.file = undefined;
            }
            return response;
          } finally { state.pending--; if (file && state.reading === file) state.reading = undefined; }
        };
        state.check = check; state.bind = () => { check(); if (state.frame || state.pending || state.file) throw Error('结果快照正式文档只能在准备收尾后捕获一次'); state.frame = contents.mainFrame; };
        state.arm = mode => { check(); if (!state.frame || state.pending || state.file || state.reading || mode === 'save' && input.mode !== 'save') throw Error('结果快照文件尚未空闲或保存未授权'); state.file = { mode, path: mode === 'save' ? input.savedPath : input.openPath, chosen: false }; };
        root.__queryResultSnapshotGlobal = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = open; dialog.showSaveDialog = save; utilityProcess.fork = blocked; check();
        // 原函数保留在闭包，只替chooser；原文件服务、codec与所有IPC结果仍由产品执行。
        void originalOpen; void originalSave; void originalFork;
      }, { mode, savedPath, openPath: mode === 'save' ? sourcePath : savedPath, openTitle: filesText.choose, saveTitle: filesText.save })); armed = true;
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]);
      // 直接使用新安装的真实空工作区；不通过settings.save注入伪查询、连接或结果。
      await step(() => expect(page.locator('.welcome-tab')).toBeVisible());
      const baseline = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(baseline.tabs).toEqual([]);
      await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => (globalThis as any).__queryResultSnapshotGlobal.bind()));
      expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]);
      await step(async () => (await navigationMenuItem(page, { name: text.entry, exact: true }, () => clock.assertCurrent())).click());
      const viewer = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(viewer).toBeVisible());
      // 打开查看器本身不触发任何文件或数据库操作，选文件仍属于第二次明确动作。
      expect((await step(audit)).opened).toBe(0);
      await step(() => application.evaluate(() => (globalThis as any).__queryResultSnapshotGlobal.arm('open')));
      await step(async () => (await navigationMenuItem(viewer, { name: text.choose, exact: true }, () => clock.assertCurrent())).click());
      await step(() => expect(viewer.getByText(text.opened(basename(mode === 'save' ? sourcePath : savedPath)), { exact: true })).toBeVisible());
      await step(() => expect(viewer.getByText(text.truncated, { exact: true })).toBeVisible());
      const actualCells = (await step(audit)).originalCells;
      expect(actualCells).toEqual({ negativeZero: true, prototypeOwn: true, constructorOwn: true, big: '18446744073709551615', decimal: '12345678901234567890.1234567890', date: '2026-10-28 12:34:56.123456', nullable: null, empty: '', blob: 'AP8A', emptyBlob: '', truncated: true });
      await step(async () => expect((await navigationMenuItem(viewer, { name: text.choose, exact: true }, () => clock.assertCurrent()))).toBeVisible()); await step(async () => expect((await navigationMenuItem(viewer, { name: text.save, exact: true }, () => clock.assertCurrent()))).toBeVisible());
      const grid = viewer.locator('.results-grid'), duplicateHeaders = grid.getByRole('columnheader').filter({ hasText: /^重复列/ });
      await step(() => expect(duplicateHeaders).toHaveCount(2));
      // 正式列头同时呈现列名与类型，分别核对，不能把small中的类型当成列名的一部分。
      expect(await step(() => duplicateHeaders.evaluateAll(headers => headers.map(header => {
        const type = header.querySelector('.column-type')?.textContent ?? '';
        return { name: (header.textContent ?? '').replace(type, '').trim(), type };
      })))).toEqual([{ name: '重复列', type: 'VAR_STRING' }, { name: '重复列', type: 'VAR_STRING' }]);
      const bounds = await step(() => grid.boundingBox()), viewport = await step(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
      expect(bounds).not.toBeNull(); expect(bounds!.width).toBeGreaterThan(0); expect(bounds!.height).toBeGreaterThan(0); expect(bounds!.x).toBeLessThan(viewport.width); expect(bounds!.y).toBeLessThan(viewport.height); expect(bounds!.x + bounds!.width).toBeGreaterThan(0); expect(bounds!.y + bounds!.height).toBeGreaterThan(0);
      for (const value of ['原型键安全', '构造键安全', '18446744073709551615', '12345678901234567890.1234567890']) {
        await step(() => grid.evaluate(element => { element.scrollLeft = 0; }));
        let found = false;
        for (let index = 0; index < 8; index++) { if (await step(() => grid.getByRole('gridcell').filter({ hasText: value }).count())) { found = true; break; } await step(() => grid.evaluate(element => { element.scrollLeft += element.clientWidth; })); await step(() => page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))))); }
        expect(found).toBe(true); await step(() => expect(grid.getByRole('gridcell').filter({ hasText: value })).toContainText(value));
      }
      await step(async () => (await navigationMenuItem(viewer, { name: text.sourceShow, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(viewer.locator('.monaco-editor .view-lines')).toContainText('仅快照SQL')); await step(() => expect(viewer.getByRole('textbox')).toHaveAttribute('aria-autocomplete', 'none')); await step(async () => (await navigationMenuItem(viewer, { name: text.sourceHide, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(viewer.locator('.monaco-editor')).toHaveCount(0));
      // 全局BLOB只读展示，不暴露依赖查询会话的独立原字节文件操作；Esc只关闭最内层。
      await step(() => grid.evaluate(element => { element.scrollLeft = element.scrollWidth; }));
      const blob = grid.getByRole('gridcell').filter({ hasText: /^0x00FF00$/i });
      await step(() => expect(blob).toHaveCount(1)); await step(() => blob.dblclick());
      const binary = page.getByRole('dialog', { name: binaryCellZh.title + '：BLOB', exact: true });
      await step(() => expect(binary).toBeVisible()); await step(() => expect(binary.getByRole('textbox', { name: binaryCellZh.hexLabel, exact: true })).toHaveValue(/00.*ff.*00/i));
      await step(async () => expect((await navigationMenuItem(binary, { name: binaryCellFilesZh.save, exact: true }, () => clock.assertCurrent()))).toHaveCount(0));
      await step(() => page.keyboard.press('Escape')); await step(() => expect(binary).toBeHidden()); await step(() => expect(viewer).toBeVisible());
      if (mode === 'save') {
        await step(() => application.evaluate(() => (globalThis as any).__queryResultSnapshotGlobal.arm('save'))); await step(async () => (await navigationMenuItem(viewer, { name: text.save, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(viewer.getByText(text.saved(basename(savedPath)), { exact: true })).toBeVisible());
        const saved = await step(() => readFile(savedPath)); savedSha256 = hash(saved); const independent = JSON.parse(saved.toString('utf8'));
        expect(Object.keys(independent).sort()).toEqual(['kind', 'name', 'result', 'version']); expect(independent.name).toBe(expectedWire.name); expect(independent.kind).toBe(expectedWire.kind); expect(independent.version).toBe(1); expect(independent.result).toEqual(expectedWire.result);
        expect(Object.hasOwn(independent.result.rows[0], '__proto__')).toBe(true); expect(independent.result.rows[0].negativeZero).toEqual({ type: 'number', text: '-0' });
      }
      await step(async () => (await navigationMenuItem(viewer, { name: text.close, exact: true }, () => clock.assertCurrent())).click()); await step(() => expect(viewer).toBeHidden()); await step(() => expect(page.locator('.welcome-tab')).toBeVisible());
      expect(await step(() => page.locator('.query-tab').count())).toBe(0);
      const after = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(after).toEqual(baseline); expect(JSON.stringify(after)).not.toContain('offline-snapshot-source'); expect(JSON.stringify(after)).not.toContain('18446744073709551615');
      expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect(await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(runtime.pageErrors).toEqual([]);
      const result = await step(audit); expect(result.pending).toBe(0); expect(result.engineStarts).toBe(0); expect(result.denied).toEqual([]); expect(result.opened).toBe(1); expect(result.saved).toBe(mode === 'save' ? 1 : 0); expect(result.chooserCalls).toBe(mode === 'save' ? 2 : 1); expect(result.calls.every(call => call.ok)).toBe(true);
      expect(await step(() => readFile(sourcePath, 'utf8'))).toBe(wire); expect(hash(await step(() => readFile(savedPath)))).toBe(savedSha256);
      await step(() => runtime.confirmOwnedDesktopExit(info), true); closed = true; armed = false; expect(originalProcess.exitCode).toBe(0); completion.check();
      if (mode === 'reopen') {
        guard(); expect((await step(() => readdir(output))).sort()).toEqual([basename(sourcePath), basename(savedPath)].sort());
        for (const path of [sourcePath, savedPath]) { const stat = await step(() => lstat(path)); expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true); expect(dirname(resolve(path))).toBe(output); await step(() => unlink(path)); }
        await step(async () => { await rmdir(output); outputRemoved = true; });
      }
      await step(() => info.attach('全局结果快照离线真实文件-' + mode, { body: JSON.stringify({ mode, actual, launcherPid, launcherLineage, profileDirectory, firstPid, newProcess: mode === 'reopen', originalProcessExitCode: originalProcess.exitCode, fileSha256: savedSha256, pending: result.pending, engineStarts: result.engineStarts, databaseRequests: result.denied.length, opens: result.opened, saves: result.saved, chooserCalls: result.chooserCalls, originalCells: result.originalCells, initialZeroConnectionsAndZeroTabsPreserved: true, configurationContainsSnapshotData: false, clipboardCalls: 0, completeFileDirectoryRemoved: outputRemoved, observationScope: 'fixture就绪后安装旁观，至正常退出前', startupBeforeObserver: '未观察', unverified: ['已有实库结果与活动事务', '查询页高级筛选排序（既有入口另验）', '安装包', '其它平台', '取消与失败文件场景由单元测试另验'] }, null, 2), contentType: 'application/json' }), true);
      completion.complete = true; if (mode === 'save') firstComplete = true;
    } catch (reason) { halted = true; clock.retain(); runtime.retainOwnedDesktopResources(info); throw reason; }
  });
}

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }
