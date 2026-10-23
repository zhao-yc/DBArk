import { win32 } from 'node:path';
import type { HistoryEntry } from '../../src/shared/contracts';

export const historyDeleteUiGate = 'DBARK_HISTORY_DELETE_UI';
/** 默认及列表先短路；不得因收集测试而加载桌面、SQLite或认证配置。 */
export function historyDeleteUiActive(args: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return !args.some(value => value === '--list' || value.startsWith('--list=')) && env[historyDeleteUiGate] === '1';
}
/** 离线专项只接收独占输出和批准源码身份，拒绝环境认证与运行器旁路。 */
export function bindHistoryDeleteUi(read: () => { args: readonly string[]; env: NodeJS.ProcessEnv; platform: string }) {
  const allowed = [historyDeleteUiGate, 'DBARK_INTEGRATION_ENABLED', 'DBARK_HISTORY_DELETE_OUTPUT', 'DBARK_HISTORY_DELETE_MANIFEST', 'DBARK_HISTORY_DELETE_MANIFEST_SHA256'];
  const capture = () => {
    const { args, env, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env);
    const keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('历史清理离线专项配置无效');
    const value = (name: string) => descriptors[name]?.value as string;
    const output = value('DBARK_HISTORY_DELETE_OUTPUT'), manifest = value('DBARK_HISTORY_DELETE_MANIFEST'), sha = value('DBARK_HISTORY_DELETE_MANIFEST_SHA256');
    if (value(historyDeleteUiGate) !== '1' || value('DBARK_INTEGRATION_ENABLED') !== '0' || !win32.isAbsolute(output) || win32.resolve(output) !== output || !/^dbark-history-delete-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('历史清理专项缺少独占输出或批准身份');
    for (const [index, argument] of args.entries()) {
      if (argument === '--config' || argument === '-c' || argument.startsWith('--config=') || /^-c./.test(argument) || ['--ui', '--debug', '--repeat-each', '--retries', '--workers'].includes(argument) || /^--(?:repeat-each|retries|workers)=/.test(argument) || argument === '--trace' && args[index + 1] !== 'off' || argument.startsWith('--trace=') && argument !== '--trace=off') throw Error('历史清理专项拒绝运行器覆盖');
    }
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), output, manifest, sha };
  };
  const original = capture(); let retained = false;
  return { target: Object.freeze({ output: original.output, manifest: original.manifest, sha: original.sha }), assertCurrent() {
    if (retained) throw Error('历史清理原配置已永久停链');
    try { if (capture().signature !== original.signature) throw Error('历史清理原配置发生变化'); } catch (error) { retained = true; throw error; }
  } };
}

export const historyDeleteSource = 'history-delete-offline-source';
export const historyDeleteTail = 'grp删除中文_';
/** 同时刻按原ID倒序分页；37条匹配仅在2048单元之后，首批不得靠概要猜测。 */
export function historyDeleteFixtures(): HistoryEntry[] {
  return Array.from({ length: 83 }, (_, index) => ({ id: `h${String(index).padStart(3, '0')}`, connectionId: historyDeleteSource,
    sql: 'SELECT ' + 'x'.repeat(2048) + ` /* ${index < 37 ? historyDeleteTail : '保留中文_'}${index}；仅合成存储，禁止执行 */`,
    startedAt: '2026-10-23T00:00:00.000Z', elapsedMs: 12, success: true }));
}

/** 仅包裹真实Main原处理器作命令及结果事实记录；不替换业务响应。 */
export function installHistoryDeleteAudit({ ipcMain, BrowserWindow, app }: { ipcMain: any; BrowserWindow: any; app: any }, target: { senderId: number; pid: number; userData: string; url: string; marker: string }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  const window = BrowserWindow.getAllWindows().find((item: any) => item.webContents.id === target.senderId), frame = window?.webContents.mainFrame;
  if (root.__dbarkHistoryDeleteAudit || typeof original !== 'function' || !frame || process.pid !== target.pid || app.getPath('userData') !== target.userData || window.webContents.getURL() !== target.url) throw Error('历史清理真实Main归属不符');
  const frameProcess = frame.processId, frameToken = frame.frameToken, commands: string[] = [], events: any[] = [], ids = new Set<number>([process.pid]), tokens = new Set<string>();
  const state = { failed: false, pending: 0, quitting: false, settingsSaved: 0, report: () => ({}) };
  const check = () => {
    if (state.failed || root.__dbarkHistoryDeleteAudit !== state || handlers.get('dbark:request') !== wrapped || process.pid !== target.pid || app.getPath('userData') !== target.userData || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.mainFrame !== frame || frame.detached || frame.processId !== frameProcess || frame.frameToken !== frameToken || frame.url !== target.url || window.webContents.getURL() !== target.url || BrowserWindow.getAllWindows().length !== 1) { state.failed = true; throw Error('历史清理Main审计永久停链'); }
    for (const item of app.getAppMetrics()) { if (!Number.isSafeInteger(item.pid) || item.pid <= 0) throw Error('原应用PID无效'); ids.add(item.pid); }
    const renderer = window.webContents.getOSProcessId(); if (!Number.isSafeInteger(renderer) || renderer <= 0) throw Error('原渲染PID无效'); ids.add(renderer);
  };
  const databaseCommand = (command: string) => /^(?:connections\.(?:open|test|save|close)|sessions\.|query\.|metadata\.|schema\.|table\.|files\.|excel\.)/.test(command);
  const wrapped = async (event: any, payload: any) => {
    check(); if (event.sender !== window.webContents || event.senderFrame !== frame) { state.failed = true; throw Error('历史清理命令来源变化'); }
    const command = payload?.command; commands.push(command);
    // 意外数据库命令留下失败证据并在物理访问前停链，不以离线主机无法连接充当零访问证明。
    if (typeof command !== 'string' || databaseCommand(command)) { state.failed = true; throw Error('离线历史专项不允许数据库命令'); }
    state.pending++;
    try {
      const response = await original(event, payload); check(); if (response?.ok !== true) { state.failed = true; throw Error('真实历史命令未成功'); }
      const result = response.result;
      if (command === 'history.page' || command === 'history.pageContinue') events.push({ command, ids: result.items.map((item: any) => item.entry.id), scanned: result.scanned, matched: result.matched, failed: result.failed, search: payload.input.search });
      if (command === 'history.deletePreview') { tokens.add(result.previewToken); events.push({ command, count: result.count, scanned: result.scanned, kind: result.kind, scope: payload.input.scope.kind, samples: result.samples.map((item: any) => item.entry.id) }); }
      if (command === 'history.deleteApply') { tokens.delete(payload.input.previewToken); events.push({ command, deleted: result.deleted, applied: result.applied }); }
      if (command === 'history.deleteRelease') { tokens.delete(payload.input.previewToken); events.push({ command }); }
      if (command === 'settings.save') { if (!state.quitting) throw Error('非退出阶段意外写设置'); state.settingsSaved++; }
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  window.webContents.on('did-start-navigation', (details: any) => { if (details.isMainFrame && !details.isSameDocument) state.failed = true; });
  window.webContents.on('render-process-gone', () => { state.failed = true; });
  state.report = () => { check(); return { pending: state.pending, commands: [...commands], databaseCommands: commands.filter(databaseCommand).length, tokens: [...tokens], ids: [...ids], events: events.map(item => ({ ...item })) }; };
  handlers.set('dbark:request', wrapped); root.__dbarkHistoryDeleteAudit = state; check();
  app.on('before-quit', () => { state.quitting = true; });
  app.once('will-quit', () => { console.log(target.marker + ':' + JSON.stringify({ failed: state.failed, pending: state.pending, tokens: tokens.size, settingsSaved: state.settingsSaved, databaseCommands: commands.filter(databaseCommand).length })); });
  app.once('quit', (_event: unknown, exitCode: number) => { console.log(target.marker + ':EXIT:' + JSON.stringify({ exitCode })); });
}
/** 每次取证重核原handler、frame和进程，不能仅引用过去的绿色计数。 */
export function readHistoryDeleteAudit(): { pending: number; commands: string[]; databaseCommands: number; tokens: string[]; ids: number[]; events: any[] } {
  const state = (globalThis as any).__dbarkHistoryDeleteAudit; if (!state) throw Error('缺少历史清理Main审计'); return state.report();
}

/** 只有显式离线gate才加载桌面及SQLite，单例时钟绑定原测试和原App。 */
export function registerHistoryDeleteUi(): void {
  const { test, expect, _electron: electron } = require('@playwright/test') as typeof import('@playwright/test');
  const { bindEditorIndentNativeCase } = require('../e2e/editor-indentation-native-gate') as typeof import('../e2e/editor-indentation-native-gate');
  const { sealEditorIndentLaunchIdentity } = require('../e2e/editor-indentation-native-identity') as typeof import('../e2e/editor-indentation-native-identity');
  const { LocalStore } = require('../../src/main/storage') as typeof import('../../src/main/storage');
  const { historyPagesZh: t } = require('../../src/renderer/locales/historyPages.zh-CN') as typeof import('../../src/renderer/locales/historyPages.zh-CN');
  const { zh, formatText } = require('../../src/renderer/locales/zh-CN') as typeof import('../../src/renderer/locales/zh-CN');
  const { historyDeleteZh: deletion } = require('../../src/renderer/locales/historyDelete.zh-CN') as typeof import('../../src/renderer/locales/historyDelete.zh-CN');
  const fs = require('node:fs/promises') as typeof import('node:fs/promises'), sync = require('node:fs') as typeof import('node:fs');
  const { join, resolve } = require('node:path') as typeof import('node:path'), { fileURLToPath } = require('node:url') as typeof import('node:url');
  const { createHash, randomUUID } = require('node:crypto') as typeof import('node:crypto');
  const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
  const binding = bindHistoryDeleteUi(() => ({ args: process.argv, env: process.env, platform: process.platform }));
  const configPath = resolve(__dirname, '../../playwright.config.ts'), configHash = digest(sync.readFileSync(configPath));
  let retained = false, complete = false, verifyEnd: (() => void) | undefined;
  test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test.afterEach(() => { verifyEnd?.(); if (retained || !complete) throw Error('历史清理原生专项未闭合，原profile及应用保留'); });
  test('真实离线App历史清理取消、单条、跨页选择及筛选全集持久化', async ({ trace, screenshot, video }, info) => {
    let application: import('@playwright/test').ElectronApplication | undefined, page: import('@playwright/test').Page | undefined;
    let closed = false, quitting = false, willQuit = false, absent = false, quitReceipt: unknown, appExitCode: number | undefined, child: ReturnType<import('@playwright/test').ElectronApplication['process']> | undefined;
    let mainPid = 0, launcherPid = 0, senderId = 0, originalUrl = '', armed = false; const pids = new Set<number>(), pageErrors: string[] = [];
    const directoryFacts = new Map<string, { dev: number; ino: number }>();
    const output = binding.target.output, profile = join(output, 'profile'), sqlite = join(profile, 'dbark.sqlite'), marker = 'DBARK_HISTORY_DELETE_QUIT:' + randomUUID();
    const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
      binding.assertCurrent();
      if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || digest(sync.readFileSync(configPath)) !== configHash || info.project.retries !== 0 || info.project.repeatEach !== 1 || trace !== 'off' || screenshot !== 'off' || video !== 'off') throw Error('历史清理运行配置或原例已失效');
      if (application && (!child || (!quitting && application.process() !== child) || child.pid !== launcherPid || !pids.has(launcherPid) || closed && !quitting || page && (!quitting && page.isClosed() || !quitting && page.url() !== originalUrl))) throw Error('历史清理原App/页面/PID已变化');
      for (const path of [output, profile]) {
        const facts = directoryFacts.get(path); if (facts && !sync.existsSync(path)) throw Error('历史清理原目录已消失');
        if (sync.existsSync(path)) { const stat = sync.lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || facts && (stat.dev !== facts.dev || stat.ino !== facts.ino)) throw Error('历史清理原目录身份已变化'); }
      }
    } }, () => test.info());
    verifyEnd = () => { clock.assertCurrent(); if (!closed || !willQuit || !absent || !complete) throw Error('历史清理原例没有完整正常退出证据'); };
    const bare = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
    const observe = async () => { if (!armed || quitting) return; const report = await bare(() => application!.evaluate(readHistoryDeleteAudit)); for (const pid of report.ids) pids.add(pid); if (pageErrors.length) throw Error('历史清理原页面出现错误'); return report; };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { await observe(); const value = await bare(action); await observe(); return value; };
    try {
      clock.assertCurrent();
      const identity = await bare(() => sealEditorIndentLaunchIdentity(binding.target.manifest, binding.target.sha, resolve(__dirname, '../..'), { stat: async path => { const stat = await bare(() => fs.lstat(path)); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }, real: path => bare(() => fs.realpath(path)), list: path => bare(() => fs.readdir(path)), bytes: path => bare(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      if (identity.manifest.kind !== 'source') throw Error('本轮清理专项只验当前源码App');
      await bare(() => fs.mkdir(output, { recursive: false })); { const stat = sync.lstatSync(output); directoryFacts.set(output, { dev: stat.dev, ino: stat.ino }); }
      await bare(() => fs.mkdir(profile, { recursive: false })); { const stat = sync.lstatSync(profile); directoryFacts.set(profile, { dev: stat.dev, ino: stat.ino }); }
      const fixture = historyDeleteFixtures(), wasm = require.resolve('sql.js/dist/sql-wasm.wasm'), protector = { available: () => false, encrypt: (value: string) => value, decrypt: (value: string) => value };
      const seeded = await bare(() => LocalStore.open(sqlite, wasm, protector));
      const originalRaw = new Map<string, string>(); let originalConnections: unknown, originalQueries: unknown, originalSnippets: unknown;
      try {
        clock.assertCurrent(); seeded.saveConnection({ id: historyDeleteSource, name: '离线合成来源', host: 'never-connect.invalid', port: 1, user: '仅合成元数据', group: '', color: '', dialect: 'mysql', rememberPassword: false });
        seeded.saveQuery({ id: 'history-delete-saved', name: '清理后保留的合成查询', connectionId: historyDeleteSource, sql: 'SELECT 保存查询_仅存储', updatedAt: fixture[0].startedAt });
        seeded.saveSnippet({ id: 'history-delete-snippet', name: '清理后保留的合成片段', group: '', description: '离线验收', sql: 'SELECT 合成片段_仅存储', updatedAt: fixture[0].startedAt });
        for (const entry of fixture) { clock.assertCurrent(); seeded.addHistory(entry); originalRaw.set(entry.id, seeded.historyRaw(entry.id)!); }
        expect(seeded.history()).toHaveLength(83); expect(seeded.tasks()).toEqual([]); expect(seeded.settings().tabs).toEqual([]);
        originalConnections = seeded.connections(); originalQueries = seeded.queries(); originalSnippets = seeded.snippets(); clock.assertCurrent();
      } finally { seeded.close(); }
      const env: Record<string, string> = {};
      for (const key of ['SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'ComSpec', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'PATHEXT', 'WINDIR']) if (process.env[key] !== undefined) env[key] = process.env[key]!;
      env.DBARK_USER_DATA = profile; env.DBARK_INTEGRATION_ENABLED = '0';
      // 迟到launch也保留原句柄，失败不另启应用或强行关闭现场。
      clock.assertCurrent(); application = await electron.launch({ executablePath: identity.manifest.executable, args: [identity.manifest.root], cwd: identity.manifest.root, env, chromiumSandbox: true }); child = application.process(); launcherPid = child.pid ?? 0; if (launcherPid) pids.add(launcherPid);
      application.on('close', () => { closed = true; if (!quitting) retained = true; });
      application.on('console', message => {
        const line = message.text(); if (!line.startsWith(marker + ':')) return; if (!quitting) retained = true;
        try { if (line.startsWith(marker + ':EXIT:')) appExitCode = JSON.parse(line.slice((marker + ':EXIT:').length)).exitCode; else { quitReceipt = JSON.parse(line.slice(marker.length + 1)); willQuit = true; } } catch { retained = true; }
      }); clock.assertCurrent();
      const actual = await bare(() => application!.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, parent: process.ppid, userData: app.getPath('userData') })));
      mainPid = actual.pid; pids.add(mainPid); await bare(() => identity.assertActual(actual));
      if (actual.parent !== child.pid || actual.pid === child.pid || actual.userData !== profile) throw Error('历史清理原启动器/主PID/路径关系不符');
      page = await bare(() => application!.firstWindow()); originalUrl = page.url();
      if (resolve(fileURLToPath(originalUrl)) !== join(identity.manifest.root, 'dist/renderer/index.html')) throw Error('历史清理页面不是批准原入口');
      page.on('pageerror', error => pageErrors.push(error.name)); await bare(() => expect(page!.locator('.app-statusbar')).toBeVisible());
      const native = await bare(() => application!.browserWindow(page!)); senderId = await bare(() => native.evaluate(window => window.webContents.id)); await bare(() => native.dispose());
      await bare(() => application!.evaluate(installHistoryDeleteAudit, { senderId, pid: mainPid, userData: profile, url: originalUrl, marker })); armed = true;
      await step(() => page!.locator('.app-commandbar').getByRole('button', { name: '历史与查询', exact: true }).click());
      const dialog = page.getByRole('dialog', { name: '历史与保存的查询', exact: true }), next = dialog.getByRole('button', { name: t.next, exact: true });
      const ids = (upper: number, lower: number) => Array.from({ length: upper - lower + 1 }, (_, index) => 'h' + String(upper - index).padStart(3, '0'));
      /** 原批次原ID是独立固定预期，不能用产品回包构造删除后答案。 */
      const assertPage = async (expected: string[]) => {
        await step(() => expect(dialog.getByRole('button', { name: t.refresh, exact: true })).toBeEnabled());
        expect(await step(() => dialog.locator('.history-card').evaluateAll(elements => elements.map(element => element.getAttribute('data-history-id'))))).toEqual(expected);
      };
      const deletionDialog = () => page!.getByRole('dialog', { name: deletion.title, exact: true });
      const preview = async (count: number, scanned: number) => {
        const modal = deletionDialog(); await step(() => expect(modal.locator('[data-history-delete-dialog]')).toBeVisible());
        await step(() => modal.getByRole('button', { name: deletion.preview, exact: true }).click());
        await step(() => expect(modal.getByRole('status').filter({ hasText: '准确匹配' })).toHaveText(`准确匹配 ${count} 条；已扫描 ${scanned} 条。`));
        await step(() => expect(modal.getByRole('button', { name: deletion.confirm, exact: true })).toBeDisabled());
      };
      const confirm = async () => {
        const modal = deletionDialog(); await step(() => modal.getByRole('checkbox', { name: deletion.acknowledge, exact: true }).check());
        await step(() => modal.getByRole('button', { name: deletion.confirm, exact: true }).click()); await step(() => expect(modal).toBeHidden());
      };
      await assertPage(ids(82, 58));
      await step(() => dialog.locator('[data-history-id="h082"]').getByRole('button', { name: deletion.single, exact: true }).click()); await preview(1, 1);
      await step(() => deletionDialog().getByRole('button', { name: deletion.cancel, exact: true }).click()); await step(() => expect(deletionDialog()).toBeHidden()); await assertPage(ids(82, 58));
      expect((await observe())!.events.filter(item => item.command === 'history.deleteApply')).toEqual([]);
      await step(() => dialog.locator('[data-history-id="h082"]').getByRole('button', { name: deletion.single, exact: true }).click()); await preview(1, 1); await confirm(); await assertPage(ids(81, 57));
      await step(() => dialog.getByRole('checkbox', { name: '选择历史 h081', exact: true }).check()); await step(() => dialog.getByRole('checkbox', { name: '选择历史 h080', exact: true }).check());
      await step(() => next.click()); await assertPage(ids(56, 32)); await step(() => dialog.getByRole('checkbox', { name: '选择历史 h056', exact: true }).check());
      await step(() => dialog.getByRole('button', { name: deletion.selected, exact: true }).click()); await preview(3, 3); await confirm(); await assertPage([...ids(79, 57), 'h055', 'h054']);
      await step(() => dialog.getByLabel(t.search, { exact: true }).fill(historyDeleteTail)); await step(() => dialog.getByRole('button', { name: t.searchButton, exact: true }).click()); await assertPage([]);
      await step(() => expect(dialog.getByRole('status').filter({ hasText: formatText(t.summary, 1, 25, 0, 0) })).toContainText(formatText(t.summary, 1, 25, 0, 0)));
      await step(() => expect(next).toBeEnabled()); await step(() => dialog.getByRole('button', { name: deletion.filtered, exact: true }).click()); await preview(37, 79);
      const screenshotFile = join(output, '历史筛选全集删除确认.png'); await step(() => deletionDialog().screenshot({ path: screenshotFile }));
      await step(() => info.attach('历史筛选全集删除确认', { path: screenshotFile, contentType: 'image/png' })); await confirm(); await assertPage([]);
      await step(() => dialog.getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
      const finalAudit = (await observe())!;
      expect(finalAudit).toMatchObject({ pending: 0, databaseCommands: 0, tokens: [] });
      expect(finalAudit.events.filter(item => item.command === 'history.deletePreview').map(item => [item.kind, item.count, item.scanned])).toEqual([['selected', 1, 1], ['selected', 1, 1], ['selected', 3, 3], ['filtered', 37, 79]]);
      expect(finalAudit.events.filter(item => item.command === 'history.deleteApply').map(item => item.deleted)).toEqual([1, 3, 37]);
      expect(finalAudit.events.filter(item => item.command === 'history.deleteRelease')).toHaveLength(1); expect(pageErrors).toEqual([]);
      await step(() => fs.writeFile(join(output, '历史清理Main审计.json'), JSON.stringify({ synthetic: true, ...finalAudit }, null, 2) + '\n', { flag: 'wx' }));
      await step(() => identity.assertCurrent());
      const exited = application.waitForEvent('close', { timeout: 15000 }); void exited.catch(() => undefined); clock.assertCurrent(); quitting = true;
      await bare(() => application!.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); })); await bare(() => exited); armed = false;
      if (!closed || !willQuit) throw Error('历史清理未确认原应用正常退出');
      await bare(() => expect.poll(() => { clock.assertCurrent(); return [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } }); }, { timeout: 5000 }).toEqual([]));
      absent = true; expect(appExitCode).toBe(0); expect(child.exitCode).toBe(0); expect(child.signalCode).toBeNull();
      expect(quitReceipt).toEqual({ failed: false, pending: 0, tokens: 0, settingsSaved: 1, databaseCommands: 0 });
      const statBefore = await bare(() => fs.lstat(sqlite)); if (!statBefore.isFile() || statBefore.isSymbolicLink() || await bare(() => fs.realpath(sqlite)) !== sqlite) throw Error('原SQLite文件身份无效');
      const bytesBefore = await bare(() => fs.readFile(sqlite));
      // LocalStore.open含迁移写盘，仅在独占副本验证；退出后的实际profile原件只读保留。
      const verification = join(output, 'LocalStore校验副本'); await bare(() => fs.mkdir(verification, { recursive: false }));
      const copy = join(verification, 'dbark.sqlite'); await bare(() => fs.writeFile(copy, bytesBefore, { flag: 'wx', mode: 0o600 }));
      const reopened = await bare(() => LocalStore.open(copy, wasm, protector));
      const expectedIds = ids(79, 37).filter(id => id !== 'h056').sort(), records: { id: string; sha256: string }[] = [];
      try {
        clock.assertCurrent(); expect(expectedIds).toHaveLength(42); expect(reopened.history().map(item => item.id).sort()).toEqual(expectedIds);
        expect(reopened.connections()).toEqual(originalConnections); expect(reopened.queries()).toEqual(originalQueries); expect(reopened.snippets()).toEqual(originalSnippets); expect(reopened.tasks()).toEqual([]); expect(reopened.settings().tabs).toEqual([]);
        for (const expected of fixture) { clock.assertCurrent(); const raw = reopened.historyRaw(expected.id); if (expectedIds.includes(expected.id)) { expect(raw).toBe(originalRaw.get(expected.id)); records.push({ id: expected.id, sha256: digest(raw!) }); } else expect(raw).toBeUndefined(); }
      } finally { reopened.close(); }
      const bytesAfter = await bare(() => fs.readFile(sqlite)), statAfter = await bare(() => fs.lstat(sqlite));
      expect([statAfter.isFile(), statAfter.isSymbolicLink(), statAfter.dev, statAfter.ino, statAfter.size, statAfter.mtimeMs, statAfter.ctimeMs]).toEqual([true, false, statBefore.dev, statBefore.ino, statBefore.size, statBefore.mtimeMs, statBefore.ctimeMs]);
      expect(await bare(() => fs.realpath(sqlite))).toBe(sqlite); expect(digest(bytesAfter)).toBe(digest(bytesBefore)); await bare(() => identity.assertCurrent());
      const facts = { kind: 'dbark.history-delete-ui', synthetic: true, platform: process.platform, source: identity.manifest.root, sourceManifest: { path: binding.target.manifest, sha256: binding.target.sha }, sqlite, initialCount: 83, deleted: { single: 1, selected: 3, filtered: 37 }, finalCount: 42, records, tasks: 0, tabs: 0, savedQueriesPreserved: true, snippetsPreserved: true, connectionsPreserved: true, databaseCommands: finalAudit.databaseCommands, auditScope: '原Main观察器安装后覆盖本轮GUI命令；未连接物理数据库', normalExit: true, originalProcessExitCode: appExitCode, launcherExitCode: child.exitCode, allPidsAbsent: true, pids: [...pids], manifestRechecked: true, originalSqliteVerified: true, sqliteOriginalUnchangedDuringReadback: true, sqliteSha256: digest(bytesAfter), screenshot: { path: screenshotFile, sha256: digest(await bare(() => fs.readFile(screenshotFile))) }, localStoreVerification: '独占副本，原件只读', unverified: ['未验打开草稿GUI（本轮空tabs；存储unit覆盖保留）', '未验物理数据库、SSH、系统输入或剪贴板'] };
      const receipt = join(output, '历史清理结构化终态.json'); await bare(() => fs.writeFile(receipt, JSON.stringify(facts, null, 2) + '\n', { flag: 'wx' })); await bare(() => info.attach('历史清理正式专项终态', { path: receipt, contentType: 'application/json' }));
      complete = true; clock.assertCurrent();
    } catch (error) { retained = true; clock.retain(); throw error; }
  });
}
