import type { TestInfo } from '@playwright/test';
import type { QueryOutcome } from '../../src/shared/contracts';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
// 默认和列表路径仍登记两例，但不运行fixture或加载live-helpers，不读取凭据或建立连接。
const enabled = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_ANALYZE_SNAPSHOT_UI === '1';
register(enabled);

interface FileStep { mode: 'open' | 'save'; path?: string; cancel?: boolean; invalid?: boolean }
interface SnapshotAudit {
  commands: string[]; databaseCommands: string[]; pending: number; dialogs: number; fileIndex: number;
  analyses: Array<{ sql: string; sessionId: string; expectedDatabase: unknown; outcome: QueryOutcome }>;
  files: Array<{ mode: string; canceled: boolean; ok: boolean; name?: string; error?: string }>;
  serverThreadIds: number[];
}

/** 两例使用独立profile；只有真实分析保存、正常退出和隔离库清理全部完成，才允许离线例启动。 */
function register(enabled: boolean): void {
  const runtime = require('./desktop-fixture') as typeof import('./desktop-fixture');
  const { test, expect } = runtime;
  const fs = require('node:fs/promises') as typeof import('node:fs/promises');
  const path = require('node:path') as typeof import('node:path');
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const { queryAnalyzeZh: t } = require('../../src/renderer/locales/queryAnalyze.zh-CN') as typeof import('../../src/renderer/locales/queryAnalyze.zh-CN');
  const { explainSnapshotZh: text } = require('../../src/shared/explainSnapshot.zh-CN') as typeof import('../../src/shared/explainSnapshot.zh-CN');
  const liveTitle = '正式QueryTab实际分析后经真实Main保存计划文件';
  const offlineTitle = '全新空连接应用离线重开实际计划并保真另存，取消及坏文件保留原计划';
  let halted = false, liveComplete = false, filePath = '', firstProfile = '', originalBytes: Buffer | undefined;
  let originalDocument: any;
  const completed = new WeakSet<object>();
  test.skip(!enabled, '实际计划快照须统筹核对200隔离实例并显式开启实库和GUI双门');
  test.describe.configure({ mode: 'serial', retries: 0 });
  test.setTimeout(120000);
  test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off', ownedDesktopLaunchGuard: { assertCurrent() {
    if (halted || process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_ANALYZE_SNAPSHOT_UI !== '1' || test.info().title === offlineTitle && !liveComplete) throw Error('实际快照前例未完整完成或双门已变化，禁止启动后例');
  } } });
  test.afterEach(({}, info) => {
    if (info.status !== info.expectedStatus || !completed.has(info)) halted = true;
  });

  /** 只回答本例明确的输出文件路径，不允许借选择器读取任意本机文件。 */
  function output(info: TestInfo, name: string): string {
    const value = info.outputPath(name), relative = path.relative(info.outputDir, value);
    if (!path.isAbsolute(value) || path.isAbsolute(relative) || relative.startsWith('..') || !relative) throw Error('快照输出不属于本例目录');
    return value;
  }

  /** 旁观原Main转发且只替换文件选择器；文件验证、读写、sync和rename全部仍走正式服务。 */
  function installAudit({ ipcMain, dialog, BrowserWindow }: any, target: { mode: 'live' | 'offline'; steps: FileStep[]; profileId?: string; database?: string; sql?: string; openTitle: string; saveTitle: string; invalidText: string }): void {
    const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
    const windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
    if (root.__dbarkAnalyzeSnapshotAudit || typeof original !== 'function' || windows.length !== 1 || !frame || frame.detached) throw Error('实际快照Main旁观归属不明');
    const processId = frame.processId, frameToken = frame.frameToken, url = frame.url, signature = JSON.stringify(target);
    const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
    let currentFile: { step: FileStep; chosen: boolean } | undefined, sessionId: string | undefined, failed = false;
    const state: SnapshotAudit & { check(): void; restore(): void } = { commands: [], databaseCommands: [], analyses: [], files: [], serverThreadIds: [], pending: 0, dialogs: 0, fileIndex: 0, check() {}, restore() {} };
    const reject = (): never => { failed = true; throw Error('实际快照原窗口/文件旁观永久停链'); };
    const check = () => {
      const current = BrowserWindow.getAllWindows();
      if (failed || root.__dbarkAnalyzeSnapshotAudit !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== open || dialog.showSaveDialog !== save || JSON.stringify(target) !== signature || current.length !== 1 || current[0] !== window || window.isDestroyed() || contents.isDestroyed() || window.webContents !== contents || contents.mainFrame !== frame || frame.detached || frame.processId !== processId || frame.frameToken !== frameToken || frame.url !== url) reject();
    };
    const choose = (mode: string, args: any[]) => {
      check(); const file = currentFile;
      if (!file || file.step.mode !== mode || file.chosen || args[0] !== window || args.at(-1)?.title !== (mode === 'open' ? target.openTitle : target.saveTitle) || !file.step.cancel && (typeof file.step.path !== 'string' || !file.step.path)) reject();
      file!.chosen = true; state.dialogs++;
      return mode === 'open' ? { canceled: Boolean(file!.step.cancel), filePaths: file!.step.cancel ? [] : [file!.step.path] } : { canceled: Boolean(file!.step.cancel), ...(file!.step.cancel ? {} : { filePath: file!.step.path }) };
    };
    const open = async (...args: any[]) => choose('open', args), save = async (...args: any[]) => choose('save', args);
    const local = new Set(['connections.list', 'settings.get', 'settings.save', 'history.list', 'tasks.list', 'workbench.get', 'app.runtimeInfo', 'app.info']);
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== contents || event.senderFrame !== frame) reject();
      const command = payload?.command, input = payload?.input; if (typeof command !== 'string') reject(); state.commands.push(command);
      const fileCommand = command === 'explainFiles.open' || command === 'explainFiles.save';
      if (fileCommand) {
        const mode = command.endsWith('.open') ? 'open' : 'save', next = target.steps[state.fileIndex];
        if (currentFile || !next || next.mode !== mode || !input || Object.keys(input).length !== (mode === 'open' ? 0 : 1) || mode === 'save' && input.snapshot?.kind !== 'dbark.analyze-snapshot') reject();
        currentFile = { step: next, chosen: false }; state.fileIndex++;
      } else if (!local.has(command)) {
        state.databaseCommands.push(command);
        if (target.mode === 'offline') reject();
        if (command === 'connections.open') { if (input?.id !== target.profileId) reject(); }
        else if (command === 'sessions.open') { if (sessionId || input?.connectionId !== target.profileId || input.database !== target.database) reject(); }
        else if (command.startsWith('metadata.')) { if (input?.connectionId !== target.profileId) reject(); }
        else if (['query.completionState', 'query.temporaryCompletion', 'query.temporaryState', 'query.analyzeContext', 'sessions.close'].includes(command)) { if (!sessionId || input?.sessionId !== sessionId) reject(); }
        else if (command === 'query.analyze') { if (!sessionId || input?.sessionId !== sessionId || input.sql !== target.sql || input.acknowledged !== true || input.expectedDatabase !== target.database || state.analyses.length) reject(); }
        else reject();
      }
      if (target.mode === 'offline' && command === 'settings.save' && (!Array.isArray(input?.tabs) || input.tabs.length !== 0)) reject();
      state.pending++;
      try {
        const response = await original(event, payload); check();
        if (fileCommand) {
          const file = currentFile; if (!file?.chosen) reject();
          if (file!.step.invalid ? response?.ok !== false || !String(response.error).includes(target.invalidText) : response?.ok !== true || (file!.step.cancel ? response.result !== null : response.result?.name !== file!.step.path?.split(/[\\/]/).at(-1))) reject();
          state.files.push({ mode: file!.step.mode, canceled: Boolean(file!.step.cancel), ok: response.ok === true, ...(typeof response.result?.name === 'string' ? { name: response.result.name } : {}), ...(typeof response.error === 'string' ? { error: response.error } : {}) }); currentFile = undefined;
        } else {
          if (response?.ok !== true) reject();
          if (command === 'sessions.open') { if (typeof response.result?.sessionId !== 'string' || !response.result.sessionId) reject(); sessionId = response.result.sessionId; }
          if (command === 'connections.open' || command === 'sessions.open') {
            for (const id of [response.result?.connectionId, response.result?.status?.connectionId]) if (Number.isSafeInteger(id) && id > 0 && !state.serverThreadIds.includes(id)) state.serverThreadIds.push(id);
          }
          if (command === 'query.analyze') state.analyses.push({ sql: input.sql, sessionId: input.sessionId, expectedDatabase: input.expectedDatabase, outcome: JSON.parse(JSON.stringify(response.result)) });
          if (target.mode === 'offline' && ['connections.list', 'history.list', 'tasks.list'].includes(command) && (!Array.isArray(response.result) || response.result.length)) reject();
        }
        return response;
      } catch (error) { failed = true; throw error; } finally { state.pending--; }
    };
    const invalidate = () => { failed = true; }, navigating = (details: any) => { if (details.isMainFrame && !details.isSameDocument) invalidate(); };
    state.check = check;
    state.restore = () => {
      check(); if (state.pending !== 0 || currentFile) throw Error('实际快照原IPC尚未收尾，禁止恢复旁观器');
      handlers.set('dbark:request', original); dialog.showOpenDialog = originalOpen; dialog.showSaveDialog = originalSave;
      contents.off('did-start-navigation', navigating); for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) contents.off(event, invalidate);
      delete root.__dbarkAnalyzeSnapshotAudit;
    };
    root.__dbarkAnalyzeSnapshotAudit = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = open; dialog.showSaveDialog = save;
    contents.on('did-start-navigation', navigating); for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) contents.on(event, invalidate); check();
  }

  /** 每次只读原旁观事实；归属失效不能回退到另一个窗口。 */
  async function audit(info: TestInfo): Promise<SnapshotAudit> {
    const owner = runtime.ownedDesktopResources(info);
    const result = await owner.application.evaluate(() => {
      const state = (globalThis as any).__dbarkAnalyzeSnapshotAudit; if (!state) throw Error('实际快照旁观器缺失'); state.check();
      const { commands, databaseCommands, analyses, files, pending, dialogs, fileIndex, serverThreadIds } = state; return { commands, databaseCommands, analyses, files, pending, dialogs, fileIndex, serverThreadIds };
    }); runtime.ownedDesktopResources(info); return result;
  }

  /** 原失败和恢复错误同时保留；pending不为零或窗口失配时不退出、不删库、不强杀。 */
  async function observed(info: TestInfo, target: Parameters<typeof installAudit>[1], body: () => Promise<void>) {
    const owner = runtime.ownedDesktopResources(info); await owner.application.evaluate(installAudit, target); runtime.ownedDesktopResources(info);
    let failed = false, original: unknown;
    try { await body(); } catch (error) { failed = true; original = error; throw error; }
    finally {
      try {
        const fact = await audit(info); await info.attach('实际计划快照Main事实-' + target.mode, { body: JSON.stringify(fact, null, 2), contentType: 'application/json' });
        expect(fact.pending).toBe(0);
        await owner.application.evaluate(() => { const state = (globalThis as any).__dbarkAnalyzeSnapshotAudit; if (!state) throw Error('缺少原旁观器'); state.restore(); }); runtime.ownedDesktopResources(info);
      } catch (cleanup) {
        runtime.retainOwnedDesktopResources(info);
        if (failed) throw new AggregateError([original, cleanup], '原实际计划文件验收失败且旁观器收尾未确认', { cause: original }); throw cleanup;
      }
    }
  }

  test(liveTitle, async ({}, info) => {
    try {
      const live = await import('./live-helpers');
      if (!['192.168.31.200', 'deve-server.yinzon.com'].includes(live.environment.DBARK_TEST_HOST ?? '') || !['13384', '13311'].includes(live.environment.DBARK_TEST_PORT ?? '')) throw Error('实际快照仅允许统筹批准的200隔离13384/13311');
      firstProfile = runtime.dataDir; filePath = output(info, '实际计划.dbark-plan.json');
      await live.isolatedDatabase(async context => {
        const { database, observer, connectionId } = context;
        const observerThreadId = (observer as unknown as { threadId?: unknown }).threadId;
        await info.attach('实际快照隔离资源', { body: JSON.stringify({ database, connectionId, ...(typeof observerThreadId === 'number' && Number.isSafeInteger(observerThreadId) && observerThreadId > 0 ? { observerThreadId } : {}) }), contentType: 'application/json' });
        const [versionRows] = await observer.query('SELECT VERSION() AS version');
        const version = String((versionRows as Array<{ version: string }>)[0].version), dialect = /mariadb/i.test(version) ? 'mariadb' : 'mysql';
        expect(dialect).toBe(live.environment.DBARK_TEST_PORT === '13384' ? 'mysql' : 'mariadb');
        await observer.query('CREATE TABLE `' + database + '`.snapshot_subject(id BIGINT UNSIGNED PRIMARY KEY,amount DECIMAL(38,18),note VARCHAR(32)) ENGINE=InnoDB');
        await observer.query('INSERT INTO `' + database + '`.snapshot_subject VALUES(?,?,?)', ['9007199254740993', '12345678901234567890.123456789012345678', '中文原值']);
        await live.openDatabaseQuery(database);
        const source = 'SELECT id,amount,note FROM snapshot_subject WHERE id>=9007199254740993 ORDER BY id /* DBARK_ANALYZE_SNAPSHOT_SOURCE */';
        await live.writeSql(source);
        const owner = runtime.ownedDesktopResources(info), query = owner.page.locator('.query-tab:visible'), analysis = query.getByRole('region', { name: t.view, exact: true });
        await observed(info, { mode: 'live', steps: [{ mode: 'save', path: filePath }, { mode: 'save', cancel: true }], profileId: connectionId, database, sql: source, openTitle: text.choose, saveTitle: text.save, invalidText: text.invalid }, async () => {
          await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: t.open, exact: true })).click(); const confirmation = owner.page.getByRole('dialog', { name: t.title, exact: true });
          await expect(confirmation).toBeVisible(); await expect(confirmation).toContainText(database);
          expect((await audit(info)).analyses).toEqual([]); await confirmation.getByRole('checkbox', { name: t.acknowledge, exact: true }).check(); await (await (await import('./navigation-menu')).navigationMenuItem(confirmation, { name: t.confirm, exact: true })).click();
          await expect(confirmation).toHaveCount(0); await expect.poll(async () => (await audit(info)).analyses.length, { timeout: 20000 }).toBe(1);
          await expect.poll(async () => (await audit(info)).pending).toBe(0); await expect(analysis.getByRole('treeitem').first()).toBeVisible(); await expect(query.locator('.error-box')).toHaveCount(0);
          const reply = (await audit(info)).analyses[0].outcome, plan = reply.analysis!;
          expect(reply.results).toHaveLength(1); expect(reply.results[0].rows).toHaveLength(1); expect(reply.results[0].columns).toHaveLength(1);
          expect(plan.dialect).toBe(dialect); expect(plan.version.replace(/^5[.]5[.]5-/, '')).toBe(version.replace(/^5[.]5[.]5-/, '')); expect(plan.format).toBe(dialect === 'mysql' ? 'tree' : 'json'); expect(plan.rawTruncated).toBe(false);
          await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: text.save, exact: true })).click(); await expect(analysis.getByRole('status').filter({ hasText: text.saved(path.basename(filePath)) })).toBeVisible();
          originalBytes = await fs.readFile(filePath); originalDocument = JSON.parse(originalBytes.toString('utf8'));
          expect(originalDocument).toEqual({ kind: 'dbark.analyze-snapshot', version: 1, dialect: plan.dialect, serverVersion: plan.version, format: plan.format, raw: plan.raw, rawTruncated: plan.rawTruncated, warnings: plan.warnings, result: { columns: reply.results[0].columns, rows: reply.results[0].rows, truncated: reply.results[0].truncated } });
          for (const key of ['statement', 'elapsedMs', 'transactionOpen', 'nodes', 'connectionId', 'sessionId']) expect(Object.hasOwn(originalDocument, key) || Object.hasOwn(originalDocument.result, key)).toBe(false);
          expect(originalBytes.includes(Buffer.from(source))).toBe(false); await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: t.raw, exact: true })).click(); await expect(analysis.getByLabel(t.raw, { exact: true })).toHaveText(plan.raw);
          await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: text.save, exact: true })).click(); await expect(analysis.getByRole('button', { name: text.save, exact: true })).toBeEnabled();
          expect(await fs.readFile(filePath)).toEqual(originalBytes); await expect(analysis.getByLabel(t.raw, { exact: true })).toHaveText(plan.raw);
          const fact = await audit(info); expect(fact.analyses).toHaveLength(1); expect(fact.files).toEqual([{ mode: 'save', canceled: false, ok: true, name: path.basename(filePath) }, { mode: 'save', canceled: true, ok: true }]); expect(fact.fileIndex).toBe(2); expect(fact.pending).toBe(0);
          await owner.page.screenshot({ path: output(info, '实际分析-正式保存.png') });
        });
      }, info, { captureFailureScreenshot: false });
      expect(runtime.ownedDesktopResources(info).closed).toBe(true); expect(runtime.pageErrors).toEqual([]);
      if (!originalBytes || !originalDocument || !filePath) throw Error('缺少原保存文件');
      expect(await fs.readFile(filePath)).toEqual(originalBytes); liveComplete = true; completed.add(info);
    } catch (error) { halted = true; throw error; }
  });

  test(offlineTitle, async ({}, info) => {
    try {
      if (!liveComplete || !originalBytes || !originalDocument || !filePath || runtime.dataDir === firstProfile) throw Error('实库前例尚未正常退出并清理，或离线profile不是新目录');
      const owner = runtime.ownedDesktopResources(info), dialog = owner.page.getByRole('dialog', { name: text.title, exact: true });
      const copyOne = output(info, '离线另存一.dbark-plan.json'), copyTwo = output(info, '离线另存二.dbark-plan.json'), badKind = output(info, '坏类型.dbark-plan.json'), badVersion = output(info, '坏版本.dbark-plan.json');
      await fs.writeFile(badKind, JSON.stringify({ ...originalDocument, kind: 'dbark.future-snapshot' })); await fs.writeFile(badVersion, JSON.stringify({ ...originalDocument, version: 2 }));
      expect(await fs.readFile(filePath)).toEqual(originalBytes);
      const digest = createHash('sha256').update(originalBytes).digest('hex');
      await observed(info, { mode: 'offline', steps: [{ mode: 'open', path: filePath }, { mode: 'save', path: copyOne }, { mode: 'open', cancel: true }, { mode: 'open', path: badKind, invalid: true }, { mode: 'open', path: badVersion, invalid: true }, { mode: 'save', path: copyTwo }], openTitle: text.choose, saveTitle: text.save, invalidText: text.invalid }, async () => {
        expect(await owner.page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]); expect((await owner.page.evaluate(() => window.dbark.invoke('settings.get', {}))).tabs).toEqual([]);
        await (await (await import('./navigation-menu')).navigationMenuItem(owner.page.locator('.navigation-toolbar'), { name: text.entry, exact: true })).click(); await expect(dialog).toContainText(text.notice);
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.choose, exact: true })).click(); await expect(dialog.getByRole('status').filter({ hasText: text.opened(path.basename(filePath)) })).toBeVisible(); await expect(dialog).toContainText(text.actual);
        const analysis = dialog.getByRole('region', { name: t.view, exact: true }); await expect(analysis.getByRole('treeitem').first()).toBeVisible();
        await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: t.raw, exact: true })).click(); await expect(analysis.getByLabel(t.raw, { exact: true })).toHaveText(originalDocument.raw);
        await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: text.saveAs, exact: true })).click(); await expect(analysis.getByRole('status').filter({ hasText: text.saved(path.basename(copyOne)) })).toBeVisible();
        for (const failure of ['cancel', 'kind', 'version'] as const) {
          await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.choose, exact: true })).click(); await expect(dialog.getByRole('button', { name: text.choose, exact: true })).toBeEnabled();
          if (failure !== 'cancel') await expect(dialog.locator('.error-box')).toContainText(text.invalid);
          await expect(analysis.getByLabel(t.raw, { exact: true })).toHaveText(originalDocument.raw); await expect(dialog.getByRole('status').filter({ hasText: text.opened(path.basename(filePath)) })).toBeVisible();
          expect(createHash('sha256').update(await fs.readFile(filePath)).digest('hex')).toBe(digest);
        }
        await (await (await import('./navigation-menu')).navigationMenuItem(analysis, { name: text.saveAs, exact: true })).click(); await expect(analysis.getByRole('status').filter({ hasText: text.saved(path.basename(copyTwo)) })).toBeVisible();
        for (const copy of [copyOne, copyTwo]) { const bytes = await fs.readFile(copy); expect(JSON.parse(bytes.toString('utf8'))).toEqual(originalDocument); expect(bytes).toEqual(originalBytes); }
        await owner.page.screenshot({ path: output(info, '实际分析-空连接离线另存.png') });
        await (await (await import('./navigation-menu')).navigationMenuItem(dialog, { name: text.close, exact: true })).click(); await expect(dialog).toHaveCount(0);
        expect(await owner.page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]); expect(await owner.page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]); expect(await owner.page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
        const fact = await audit(info); expect(fact.databaseCommands).toEqual([]); expect(fact.analyses).toEqual([]); expect(fact.pending).toBe(0); expect(fact.fileIndex).toBe(6); expect(fact.dialogs).toBe(6);
      });
      await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true); expect(runtime.pageErrors).toEqual([]); completed.add(info);
    } catch (error) { halted = true; throw error; }
  });
}
