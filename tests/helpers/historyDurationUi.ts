import { win32 } from 'node:path';
import type { HistoryEntry } from '../../src/shared/contracts';

export const historyDurationNativeGate = 'DBARK_HISTORY_DURATION_NATIVE_TEST';
/** 默认及列表优先短路，不能借列出定义加载桌面、SQLite或环境凭据。 */
export function historyDurationNativeActive(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env[historyDurationNativeGate] === '1';
}
/** 独立离线专项只接受五项配置；任何认证、开发旁路、大小写别名及Node注入均拒绝。 */
export function bindHistoryDurationUi(read: () => { args: readonly string[]; env: NodeJS.ProcessEnv; platform: string }) {
  const allowed = [historyDurationNativeGate, 'DBARK_INTEGRATION_ENABLED', 'DBARK_HISTORY_DURATION_OUTPUT', 'DBARK_HISTORY_DURATION_MANIFEST', 'DBARK_HISTORY_DURATION_MANIFEST_SHA256'];
  const capture = () => {
    const { args, env, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env);
    const keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('历史耗时原生专项配置无效，禁止认证及旁路');
    const value = (name: string) => descriptors[name]?.value as string;
    const output = value('DBARK_HISTORY_DURATION_OUTPUT'), manifest = value('DBARK_HISTORY_DURATION_MANIFEST'), sha = value('DBARK_HISTORY_DURATION_MANIFEST_SHA256');
    if (value(historyDurationNativeGate) !== '1' || value('DBARK_INTEGRATION_ENABLED') !== '0' || !win32.isAbsolute(output) || win32.resolve(output) !== output || !/^dbark-history-duration-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('历史耗时专项缺少独占新输出或Root批准身份清单');
    for (const [index, argument] of args.entries()) {
      if (argument === '--config' || argument === '-c' || argument.startsWith('--config=') || /^-c./.test(argument) || ['--ui', '--debug', '--repeat-each', '--retries', '--workers'].includes(argument) || /^--(?:repeat-each|retries|workers)=/.test(argument) || argument === '--trace' && args[index + 1] !== 'off' || argument.startsWith('--trace=') && argument !== '--trace=off') throw Error('历史耗时专项拒绝运行器配置覆盖');
    }
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), output, manifest, sha };
  };
  const original = capture(); let retained = false;
  return { target: Object.freeze({ output: original.output, manifest: original.manifest, sha: original.sha }), assertCurrent() {
    if (retained) throw Error('历史耗时原配置已永久停链');
    try { if (capture().signature !== original.signature) throw Error('历史耗时原配置发生变化'); } catch (error) { retained = true; throw error; }
  } };
}

export const historyDurationSourceA = 'history-duration-source-a';
export const historyDurationSourceB = 'history-duration-source-b';
export const historyDurationTail = '纯合成尾部限定标记';
/** 固定58条，按ID序号从新到旧；前50条均201ms，末8条独立端点表禁止产品函数生成期望。 */
export function historyDurationFixtures(): HistoryEntry[] {
  const last = [0, 99.5, 100, 100.5, 200, 201, 100, 200];
  return Array.from({ length: 58 }, (_, index) => ({
    id: `history-duration-${String(index).padStart(2, '0')}`, connectionId: index % 2 === 0 ? historyDurationSourceA : historyDurationSourceB,
    databaseContext: { state: 'known' as const, database: '纯合成历史库' },
    sql: index === 52 ? 'SELECT ' + 'x'.repeat(2048) + ' /* ' + historyDurationTail + ' */' : `SELECT ${index} AS 纯合成历史值 /* 仅存储，禁止执行 */`,
    startedAt: `2026-10-22T00:00:${String(58 - index).padStart(2, '0')}.000Z`, elapsedMs: index < 50 ? 201 : last[index - 50],
    success: index % 3 !== 0, ...(index % 3 === 0 ? { error: '纯合成历史错误，不来自数据库' } : {})
  }));
}

/** 真Main原handler观察器，只准本窗口的历史分页与已签发cursor精确释放，不伪造产品结果。 */
export function installHistoryDurationAudit({ ipcMain, BrowserWindow, app }: { ipcMain: any; BrowserWindow: any; app: any }, target: { senderId: number; pid: number; userData: string; url: string; marker: string; settings: unknown }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  const window = BrowserWindow.getAllWindows().find((item: any) => item.webContents.id === target.senderId), frame = window?.webContents.mainFrame;
  if (root.__dbarkHistoryDurationAudit || typeof original !== 'function' || !window || !frame || process.pid !== target.pid || app.getPath('userData') !== target.userData || window.webContents.getURL() !== target.url) throw Error('历史耗时真实Main归属不符');
  const captured = JSON.stringify(target), frameProcess = frame.processId, frameToken = frame.frameToken, frameUrl = frame.url;
  const cursors = new Set<string>(), taskIds = new Set<string>(), events: any[] = [], ids = new Set<number>([process.pid]), forwarded: string[] = [];
  const databaseCommands = () => forwarded.filter(command => /^(?:connections\.(?:open|test|save|close)|sessions\.|query\.|metadata\.|schema\.|table\.|files\.|excel\.)/.test(command)).length;
  const state = { failed: false, pending: 0, starts: 0, continues: 0, releases: 0, quitting: false, settingsSaved: 0, check: () => {}, report: () => ({}) };
  const reject = (): never => { state.failed = true; throw Error('历史耗时Main只读审计永久停链'); };
  const object = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  const token = (value: any) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  state.check = () => {
    if (state.failed || JSON.stringify(target) !== captured || root.__dbarkHistoryDurationAudit !== state || handlers.get('dbark:request') !== wrapped || process.pid !== target.pid || app.getPath('userData') !== target.userData || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.mainFrame !== frame || frame.detached || frame.processId !== frameProcess || frame.frameToken !== frameToken || frame.url !== frameUrl || frameUrl !== target.url || window.webContents.getURL() !== target.url || BrowserWindow.getAllWindows().length !== 1) reject();
    for (const item of app.getAppMetrics()) { if (!Number.isSafeInteger(item.pid) || item.pid <= 0) reject(); ids.add(item.pid); }
    const renderer = window.webContents.getOSProcessId(); if (!Number.isSafeInteger(renderer) || renderer <= 0) reject(); ids.add(renderer);
  };
  const wrapped = async (event: any, payload: any) => {
    state.check(); if (event.sender !== window.webContents || event.senderFrame !== frame || event.senderFrame.url !== target.url) reject();
    const command = payload?.command, input = payload?.input;
    if (command === 'history.page') {
      if (!object(input, ['taskId', 'search', 'fields', 'scope', 'status', 'onError', 'timeRange', 'durationRange']) || !token(input.taskId) || taskIds.has(input.taskId) || input.onError !== 'continue') reject();
      taskIds.add(input.taskId); if (++state.starts > 10) reject();
    } else if (command === 'history.pageContinue') {
      if (!object(input, ['taskId', 'cursor']) || !token(input.taskId) || taskIds.has(input.taskId) || !cursors.delete(input.cursor)) reject(); taskIds.add(input.taskId); if (++state.continues > 13) reject();
    } else if (command === 'history.pageRelease') {
      if (!object(input, ['cursor']) || !cursors.delete(input.cursor)) reject(); if (++state.releases > 3) reject();
    } else if (['connections.list', 'settings.get', 'tasks.list', 'workbench.get', 'app.info', 'security.encryptionAvailable'].includes(command)) { if (!object(input, []) || Object.keys(input).length) reject(); }
    else if (command === 'app.setDirty') { if (!object(input, ['dirty']) || input.dirty !== false) reject(); }
    else if (command === 'settings.save') {
      // 正常退出必须刷新原空标签配置；仅此一次、仅原字段原值，不能借退出授权保存其他数据。
      const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      if (!state.quitting || state.settingsSaved || !input || !Array.isArray(input.tabs) || input.tabs.length || JSON.stringify(canonical(input)) !== JSON.stringify(canonical(target.settings))) reject(); state.settingsSaved++;
    }
    else reject();
    forwarded.push(command); state.pending++;
    try {
      const result = await original(event, payload); state.check();
      if (result?.ok !== true) reject();
      if (command === 'history.page' || command === 'history.pageContinue') {
        const page = result.result;
        if (!page || !Array.isArray(page.items) || page.items.length > 25 || !Array.isArray(page.failures) || page.failures.length || page.failed !== 0 || !Number.isSafeInteger(page.scanned) || !Number.isSafeInteger(page.matched)) reject();
        if (page.cursor !== undefined) { if (!token(page.cursor) || cursors.has(page.cursor)) reject(); cursors.add(page.cursor); }
        events.push({ command, ...(command === 'history.page' ? { filter: JSON.parse(JSON.stringify(input)) } : { consumed: input.cursor }), ids: page.items.map((item: any) => item.entry.id), scanned: page.scanned, matched: page.matched, cursor: page.cursor ?? null });
      }
      if (command === 'history.pageRelease') events.push({ command, released: input.cursor });
      if (command === 'tasks.list' && result.result.length !== 0) reject();
      return result;
    } catch (error) { state.failed = true; throw error; }
    finally { state.pending--; }
  };
  window.webContents.on('did-start-navigation', (details: any) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  window.webContents.on('render-process-gone', () => { state.failed = true; });
  state.report = () => { state.check(); return { starts: state.starts, continues: state.continues, releases: state.releases, pending: state.pending, databaseCommands: databaseCommands(), cursors: [...cursors], ids: [...ids], events: events.map(item => ({ ...item })) }; };
  handlers.set('dbark:request', wrapped); root.__dbarkHistoryDurationAudit = state; state.check();
  app.on('before-quit', () => { state.quitting = true; });
  app.once('will-quit', () => {
    if (state.failed || state.pending || cursors.size || state.settingsSaved !== 1) { state.failed = true; console.log(target.marker + ':失败'); return; }
    console.log(target.marker + ':' + JSON.stringify({ starts: state.starts, continues: state.continues, releases: state.releases, settingsSaved: state.settingsSaved, pending: state.pending, cursors: cursors.size }));
  });
}
/** 读审计时仍核对原处理器及原frame，不能靠缓存的绿色计数代替当下归属。 */
export function readHistoryDurationAudit(): { starts: number; continues: number; releases: number; pending: number; databaseCommands: number; cursors: string[]; ids: number[]; events: any[] } {
  const state = (globalThis as any).__dbarkHistoryDurationAudit; if (!state) throw Error('缺少历史耗时原Main审计'); return state.report();
}

/** 完整原生定义延迟加载；只有唯一gate及Root批准身份成立后才允许创建profile或App。 */
export function registerHistoryDurationNative(): void {
  const { test, expect, _electron: electron } = require('@playwright/test') as typeof import('@playwright/test');
  const { bindEditorIndentNativeCase } = require('../e2e/editor-indentation-native-gate') as typeof import('../e2e/editor-indentation-native-gate');
  const { sealEditorIndentLaunchIdentity } = require('../e2e/editor-indentation-native-identity') as typeof import('../e2e/editor-indentation-native-identity');
  const { LocalStore } = require('../../src/main/storage') as typeof import('../../src/main/storage');
  const { historyPagesZh: t } = require('../../src/renderer/locales/historyPages.zh-CN') as typeof import('../../src/renderer/locales/historyPages.zh-CN');
  const { zh, formatText } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), sync = require('node:fs') as typeof import('node:fs');
  const { join, resolve } = require('node:path') as typeof import('node:path'), { fileURLToPath } = require('node:url') as typeof import('node:url');
  const { createHash, randomUUID } = require('node:crypto') as typeof import('node:crypto');
  const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
  const binding = bindHistoryDurationUi(() => ({ args: process.argv, env: process.env, platform: process.platform }));
  const configPath = resolve(__dirname, '../../playwright.config.ts'), configHash = digest(sync.readFileSync(configPath));
  let retained = false, complete = false, verifyEnd: (() => void) | undefined;
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(() => { verifyEnd?.(); if (retained || !complete) throw Error('历史耗时原生专项未闭合，原profile及应用保留'); });
  test('真实独立App历史耗时端点、组合筛选及原始SQLite不变', async ({ trace, screenshot, video }, info) => {
    let application: import('@playwright/test').ElectronApplication | undefined, page: import('@playwright/test').Page | undefined;
    let closed = false, quitting = false, willQuit = false, absent = false, quitReceipt: unknown, child: ReturnType<import('@playwright/test').ElectronApplication['process']> | undefined;
    let mainPid = 0, launcherPid = 0, senderId = 0, originalUrl = '', armed = false; const pids = new Set<number>(), pageErrors: string[] = [];
    const directoryFacts = new Map<string, { dev: number; ino: number }>();
    const output = binding.target.output, profile = join(output, 'profile'), sqlite = join(profile, 'dbark.sqlite'), marker = 'DBARK_HISTORY_DURATION_QUIT:' + randomUUID();
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
      binding.assertCurrent();
      if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || digest(sync.readFileSync(configPath)) !== configHash || info.project.retries !== 0 || info.project.repeatEach !== 1 || trace !== 'off' || screenshot !== 'off' || video !== 'off') throw Error('历史耗时运行配置或原例已失效');
      if (application && (!child || (!quitting && application.process() !== child) || child.pid !== launcherPid || !pids.has(launcherPid) || closed && !quitting || page && (!quitting && page.isClosed() || !quitting && page.url() !== originalUrl))) throw Error('历史耗时原App/页面/PID已变化');
      for (const path of [output, profile]) {
        const facts = directoryFacts.get(path); if (facts && !sync.existsSync(path)) throw Error('历史耗时原目录已消失');
        if (sync.existsSync(path)) { const stat = sync.lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || facts && (stat.dev !== facts.dev || stat.ino !== facts.ino)) throw Error('历史耗时原目录身份已变化'); }
      }
    } }, () => test.info());
    verifyEnd = () => { clock.assertCurrent(); if (!closed || !willQuit || !absent || !complete) throw Error('历史耗时原例没有完整正常退出证据'); };
    const bare = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
    const observe = async () => { if (!armed || quitting) return; const report = await bare(() => application!.evaluate(readHistoryDurationAudit)); for (const pid of report.ids) pids.add(pid); if (pageErrors.length) throw Error('历史耗时原页面出现错误'); return report; };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { await observe(); const value = await bare(action); await observe(); return value; };
    try {
      clock.assertCurrent();
      const identity = await bare(() => sealEditorIndentLaunchIdentity(binding.target.manifest, binding.target.sha, resolve(__dirname, '../..'), { stat: async path => { const stat = await bare(() => fs.lstat(path)); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }, real: path => bare(() => fs.realpath(path)), list: path => bare(() => fs.readdir(path)), bytes: path => bare(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      if (identity.manifest.kind !== 'source') throw Error('本轮耗时专项只验当前源码App');
      await bare(() => fs.mkdir(output, { recursive: false })); { const stat = sync.lstatSync(output); directoryFacts.set(output, { dev: stat.dev, ino: stat.ino }); }
      await bare(() => fs.mkdir(profile, { recursive: false })); { const stat = sync.lstatSync(profile); directoryFacts.set(profile, { dev: stat.dev, ino: stat.ino }); }
      const fixture = historyDurationFixtures(), wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), protector = { available: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value };
      const seeded = await bare(() => LocalStore.open(sqlite, wasm, protector));
      let expectedRaw: { id: string; sha256: string; elapsedMs: number; startedAt: string; connectionId: string }[], originalSettings: unknown;
      try {
        clock.assertCurrent(); for (const [id, name] of [[historyDurationSourceA, '合成来源甲'], [historyDurationSourceB, '合成来源乙']]) seeded.saveConnection({ id, name, host: 'never-connect.invalid', port: 1, user: '仅合成元数据', group: '', color: '', dialect: 'mysql', rememberPassword: false });
        for (const entry of fixture) { clock.assertCurrent(); seeded.addHistory(entry); }
        expectedRaw = fixture.map(entry => ({ id: entry.id, sha256: digest(seeded.historyRaw(entry.id)!), elapsedMs: entry.elapsedMs, startedAt: entry.startedAt, connectionId: entry.connectionId })).sort((a, b) => a.id.localeCompare(b.id));
        expect(seeded.history()).toHaveLength(58); expect(seeded.tasks()).toEqual([]); originalSettings = seeded.settings(); clock.assertCurrent();
      } finally { seeded.close(); }
      const env: Record<string, string> = {};
      for (const key of ['SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'WINDIR']) if (process.env[key] !== undefined) env[key] = process.env[key]!;
      env.DBARK_USER_DATA = profile; env.DBARK_INTEGRATION_ENABLED = '0';
      // 先登记迟到launch句柄再检查期限，失败不遗失原实例，也不强关。
      clock.assertCurrent(); application = await electron.launch({ executablePath: identity.manifest.executable, args: [identity.manifest.root], cwd: identity.manifest.root, env, chromiumSandbox: true }); child = application.process(); launcherPid = child.pid ?? 0; if (launcherPid) pids.add(launcherPid);
      application.on('close', () => { closed = true; if (!quitting) retained = true; }); application.on('console', message => { if (message.text().startsWith(marker + ':')) { if (!quitting) retained = true; try { quitReceipt = JSON.parse(message.text().slice(marker.length + 1)); willQuit = true; } catch { retained = true; } } }); clock.assertCurrent();
      const actual = await bare(() => application!.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, parent: process.ppid, userData: app.getPath('userData') })));
      mainPid = actual.pid; pids.add(mainPid); await bare(() => identity.assertActual(actual));
      if (actual.parent !== child.pid || actual.pid === child.pid || actual.userData !== profile) throw Error('历史耗时原启动器/主PID/路径关系不符');
      page = await bare(() => application!.firstWindow()); originalUrl = page.url();
      if (resolve(fileURLToPath(originalUrl)) !== join(identity.manifest.root, 'dist/renderer/index.html')) throw Error('历史耗时页面不是批准的原入口');
      page.on('pageerror', error => pageErrors.push(error.name)); await bare(() => expect(page!.locator('.app-statusbar')).toBeVisible());
      const native = await bare(() => application!.browserWindow(page!)); senderId = await bare(() => native.evaluate(window => window.webContents.id)); await bare(() => native.dispose());
      await bare(() => application!.evaluate(installHistoryDurationAudit, { senderId, pid: mainPid, userData: profile, url: originalUrl, marker, settings: originalSettings })); armed = true;
      await step(() => page!.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click());
      const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true }), next = dialog.getByRole('button', { name: t.next, exact: true }), search = dialog.getByRole('button', { name: t.searchButton, exact: true });
      const minimum = dialog.getByLabel(t.minDuration, { exact: true }), maximum = dialog.getByLabel(t.maxDuration, { exact: true });
      const ids = (indices: readonly number[]) => indices.map(index => `history-duration-${String(index).padStart(2, '0')}`);
      const assertPage = async (indices: readonly number[], batch: number, scanned: number, matched: number, more: boolean) => {
        await step(() => expect(dialog.getByRole('button', { name: t.refresh, exact: true })).toBeEnabled());
        expect(await step(() => dialog.locator('.history-card').evaluateAll(elements => elements.map(element => element.getAttribute('data-history-id'))))).toEqual(ids(indices));
        await step(() => expect(dialog.getByRole('status').filter({ hasText: formatText(t.summary, batch, scanned, matched, 0) })).toHaveText(formatText(t.summary, batch, scanned, matched, 0) + ' ' + (more ? t.more : t.done)));
        await step(() => more ? expect(next).toBeEnabled() : expect(next).toBeDisabled());
      };
      await assertPage(Array.from({ length: 25 }, (_, index) => index), 1, 25, 25, true);
      await step(() => minimum.fill('100')); await step(() => maximum.fill('200')); await step(() => expect(next).toBeDisabled()); await step(() => search.click()); await assertPage([], 1, 25, 0, true);
      const beforeInvalid = await observe();
      for (const value of ['-1', '100.5', '1e2', '9007199254740992']) {
        await step(() => minimum.fill(value)); await step(() => search.click()); await step(() => expect(dialog.locator('.error-box')).toContainText(t.durationInvalid)); await step(() => expect(next).toBeDisabled());
        const report = await observe(); expect(report!.events).toEqual(beforeInvalid!.events); expect(report!.cursors).toEqual(beforeInvalid!.cursors); expect(await step(() => dialog.locator('.history-card').count())).toBe(0);
      }
      await step(() => minimum.fill('201')); await step(() => search.click()); await step(() => expect(dialog.locator('.error-box')).toContainText(t.durationOrder)); expect((await observe())!.cursors).toEqual(beforeInvalid!.cursors);
      await step(() => minimum.fill('100')); await step(() => expect(next).toBeEnabled()); await step(() => next.click()); await assertPage([], 2, 50, 0, true); await step(() => next.click()); await assertPage([52, 53, 54, 56, 57], 3, 58, 5, false);
      /** 以下期望由固定末8条表手工列出，绝不调用产品筛选器反推答案。 */
      const ranges = [
        { min: '100', max: '100', first: [] as number[], second: [] as number[], last: [52, 56], counts: [0, 0, 2] },
        { min: '', max: '0', first: [], second: [], last: [50], counts: [0, 0, 1] },
        { min: '', max: '100', first: [], second: [], last: [50, 51, 52, 56], counts: [0, 0, 4] },
        { min: '201', max: '', first: Array.from({ length: 25 }, (_, index) => index), second: Array.from({ length: 25 }, (_, index) => index + 25), last: [55], counts: [25, 50, 51] },
        { min: '9007199254740991', max: '', first: [], second: [], last: [], counts: [0, 0, 0] }
      ];
      for (const range of ranges) {
        await step(() => minimum.fill(range.min)); await step(() => maximum.fill(range.max)); await step(() => search.click()); await assertPage(range.first, 1, 25, range.counts[0], true);
        await step(() => next.click()); await assertPage(range.second, 2, 50, range.counts[1], true); await step(() => next.click()); await assertPage(range.last, 3, 58, range.counts[2], false);
      }
      await step(() => minimum.fill('100')); await step(() => maximum.fill('200')); await step(() => dialog.getByLabel(t.scope, { exact: true }).selectOption('connection:' + historyDurationSourceA)); await step(() => dialog.getByLabel(t.status, { exact: true }).selectOption('success'));
      await step(() => dialog.getByLabel(t.from, { exact: true }).fill('2026-10-22T00:00:05.000Z')); await step(() => dialog.getByLabel(t.until, { exact: true }).fill('2026-10-22T00:00:07.000Z')); await step(() => dialog.getByLabel(t.search, { exact: true }).fill(historyDurationTail)); await step(() => search.click()); await assertPage([], 1, 25, 0, true); await step(() => next.click()); await assertPage([52], 2, 29, 1, false);
      await step(() => expect(dialog.locator('[data-history-id="history-duration-52"] pre')).not.toContainText(historyDurationTail));
      const durationGroup = dialog.getByRole('group', { name: t.durationRange, exact: true }); await step(() => durationGroup.scrollIntoViewIfNeeded()); await step(() => expect(durationGroup).toBeInViewport({ ratio: 1 })); await step(() => durationGroup.screenshot({ path: join(output, '历史耗时组合筛选.png') }));
      await step(() => dialog.getByLabel(t.search, { exact: true }).fill('')); await step(() => dialog.getByLabel(t.scope, { exact: true }).selectOption('all')); await step(() => dialog.getByLabel(t.status, { exact: true }).selectOption('all')); await step(() => dialog.getByRole('button', { name: t.clearTime, exact: true }).click()); await step(() => search.click()); await assertPage([], 1, 25, 0, true);
      const beforeClear = await observe(); await step(() => dialog.getByRole('button', { name: t.clearDuration, exact: true }).click()); await step(() => expect(minimum).toHaveValue('')); await step(() => expect(maximum).toHaveValue('')); await step(() => expect(next).toBeDisabled()); expect((await observe())!.events).toEqual(beforeClear!.events);
      await step(() => search.click()); await assertPage(Array.from({ length: 25 }, (_, index) => index), 1, 25, 25, true);
      await step(() => dialog.getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
      expect(await step(() => page!.evaluate(() => window.dbark.invoke('tasks.list', {})))).toEqual([]); const finalAudit = await observe(); expect(finalAudit).toMatchObject({ starts: 10, continues: 13, releases: 3, pending: 0, databaseCommands: 0, cursors: [] }); expect(pageErrors).toEqual([]);
      await step(() => fs.writeFile(join(output, '历史耗时审计.json'), JSON.stringify({ synthetic: true, ...finalAudit }, null, 2) + '\n', { flag: 'wx' }));
      await step(() => identity.assertCurrent());
      const exited = application.waitForEvent('close', { timeout: 15000 }); void exited.catch(() => undefined); clock.assertCurrent(); quitting = true;
      await bare(() => application!.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); })); await bare(() => exited); if (!closed || !willQuit) throw Error('历史耗时未确认原应用正常退出'); armed = false;
      await bare(() => expect.poll(() => { clock.assertCurrent(); return [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }); }, { timeout: 5000 }).toEqual([]));
      absent = true; expect(quitReceipt).toEqual({ starts: 10, continues: 13, releases: 3, settingsSaved: 1, pending: 0, cursors: 0 });
      await bare(() => fs.writeFile(join(output, '历史耗时正常退出.json'), JSON.stringify({ synthetic: true, ...quitReceipt as object, pids: [...pids], allPidsAbsent: true }, null, 2) + '\n', { flag: 'wx' }));
      const statBefore = await bare(() => fs.lstat(sqlite));
      if (!statBefore.isFile() || statBefore.isSymbolicLink() || await bare(() => fs.realpath(sqlite)) !== sqlite) throw Error('原SQLite文件身份无效');
      const bytesBefore = await bare(() => fs.readFile(sqlite));
      // 产品open含迁移写盘，只在本例独占副本执行；实际profile原件始终只读。
      const verification = join(output, 'LocalStore校验副本'); await bare(() => fs.mkdir(verification, { recursive: false }));
      const copy = join(verification, 'dbark.sqlite'); await bare(() => fs.writeFile(copy, bytesBefore, { flag: 'wx', mode: 0o600 }));
      const reopened = await bare(() => LocalStore.open(copy, wasm, protector));
      try {
        clock.assertCurrent(); expect(reopened.history()).toHaveLength(58); expect(reopened.tasks()).toEqual([]); expect(reopened.settings().tabs).toEqual([]);
        expect(reopened.connections().map(value => ({ id: value.id, host: value.host, port: value.port, hasPassword: value.hasPassword }))).toEqual([{ id: historyDurationSourceA, host: 'never-connect.invalid', port: 1, hasPassword: false }, { id: historyDurationSourceB, host: 'never-connect.invalid', port: 1, hasPassword: false }]);
        for (const expected of expectedRaw!) { clock.assertCurrent(); expect(digest(reopened.historyRaw(expected.id)!)).toBe(expected.sha256); }
      } finally { reopened.close(); }
      const bytesAfter = await bare(() => fs.readFile(sqlite)), statAfter = await bare(() => fs.lstat(sqlite));
      expect([statAfter.isFile(), statAfter.isSymbolicLink(), statAfter.dev, statAfter.ino, statAfter.size, statAfter.mtimeMs, statAfter.ctimeMs]).toEqual([true, false, statBefore.dev, statBefore.ino, statBefore.size, statBefore.mtimeMs, statBefore.ctimeMs]);
      expect(await bare(() => fs.realpath(sqlite))).toBe(sqlite); expect(digest(bytesAfter)).toBe(digest(bytesBefore));
      await bare(() => fs.writeFile(join(output, '历史耗时原始读回.json'), JSON.stringify({ synthetic: true, sqlite, count: 58, tasks: 0, tabs: 0, databaseCommands: finalAudit!.databaseCommands, physicalSessions: '未测物理数据库会话；审计只证明本例未转发数据库命令', metadataConnections: 2, sqliteOriginalUnchanged: true, localStoreVerification: '独占副本，LocalStore.open可能迁移；未对原件调用open', sqliteSha256: digest(bytesAfter), records: expectedRaw! }, null, 2) + '\n', { flag: 'wx' }));
      complete = true; clock.assertCurrent();
    } catch (error) { retained = true; clock.retain(); throw error; }
  });
}
