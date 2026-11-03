import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { sqlSyntaxCheckZh as text } from '../../src/renderer/locales/sqlSyntaxCheck.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { validSqlSyntaxCheckResult, type SqlSyntaxCheckResult } from '../../src/shared/sqlSyntaxCheck';

// 默认及列举不加载桌面、数据库、文件或用户配置；只允许固定离线入口显式开启。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQL_SYNTAX_NATIVE === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_/i.test(key) && !['DBARK_SQL_SYNTAX_NATIVE', 'DBARK_INTEGRATION_ENABLED'].includes(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|DB_|DATABASE_|SSH_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || /^PLAYWRIGHT_.*(?:TRACE|TIMEOUT|WORKER|RETRIES)/i.test(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('语法检查专项只允许Windows/macOS源码独占离线profile，拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('语法检查专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface WorkerFact { syntax: boolean; sent: number; ready: number; replied: number; terminated: number; source?: string; result?: SqlSyntaxCheckResult; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式语法检查离线源码专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; pid?: number; platform: string } | undefined;
let failure: (() => unknown) | undefined;
test.afterEach(async ({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); await info.attach('语法检查停链原件', { body: JSON.stringify(failure?.() ?? { stage: '尚未捕获原owner' }), contentType: 'application/json' }); throw Error('语法检查未完成准确退出，保留原窗口和profile'); } });

test('真实更多及右键检查脚本、问题跳转与过期清除，原模型撤销保持且零数据库请求', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), { application, page } = owner;
  const directory = runtime.dataDir, originalProcess = application.process(), modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  let closed = false, armed = false, stage = '初始化独占离线原窗口';
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  failure = () => ({ stage, directory, pid: originalProcess.pid, closed, armed, exitCode: originalProcess.exitCode, signal: originalProcess.signalCode, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false });
  const check = () => { const now = runtime.ownedDesktopResources(info); if (now.application !== application || now.page !== page || now.closed !== closed || runtime.dataDir !== directory || (!closed && application.process() !== originalProcess) || closed && originalProcess.exitCode !== 0 || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.repeatEach !== 1 || info.config.workers !== 1) throw Error('语法检查原owner/profile/期限发生变化'); };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const result = await action(); check(); return result; };
  const query = () => page.locator('.query-tab:visible'), panel = () => query().getByRole('region', { name: text.title, exact: true });
  const click = (scope: import('@playwright/test').Locator, name: string) => step(async () => { const item = await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(scope, { name, exact: true }, check); check(); await item.click(); check(); });
  const audit = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __syntaxNative?: { commands: string[]; denied: string[]; restore(): void } }).__syntaxNative; if (!state) throw Error('原语法检查Main观察器不存在'); return { commands: state.commands, denied: state.denied }; }));
  const workers = () => step(() => page.evaluate(() => (window as Window & { __syntaxWorkers?: WorkerFact[] }).__syntaxWorkers ?? []));
  /** 公共Monaco API只读原模型，不调用provider、动作、setValue或setPosition。 */
  const model = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
    const editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && !!node.closest('.query-tab') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('原查询Monaco不唯一'); const editor = editors[0], model = editor.getModel(), selection = editor.getSelection();
    if (!model || model.isDisposed() || !selection || editor.getRawOptions().readOnly) throw Error('原编辑模型失效或只读');
    return { uri: model.uri.toString(), version: model.getVersionId(), source: model.getValue(), undo: model.canUndo(), redo: model.canRedo(), selection: { start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()) }, markers: api!.editor.getModelMarkers({ resource: model.uri }).filter(marker => marker.source === '本地语法检查').map(marker => ({ start: model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn }), end: model.getOffsetAt({ lineNumber: marker.endLineNumber, column: marker.endColumn }), message: marker.message, severity: marker.severity })) };
  }));
  const unchanged = (before: Awaited<ReturnType<typeof model>>, after: Awaited<ReturnType<typeof model>>) => expect({ uri: after.uri, version: after.version, source: after.source, undo: after.undo, redo: after.redo }).toEqual({ uri: before.uri, version: before.version, source: before.source, undo: before.undo, redo: before.redo });
  const write = async (source: string) => { await step(() => page.keyboard.press('Escape')); await step(() => query().locator('.sql-editor-wrap .monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press(modifier + '+A')); await step(() => page.keyboard.insertText(source)); await step(() => expect.poll(async () => (await model()).source.replaceAll('\r\n', '\n')).toBe(source.replaceAll('\r\n', '\n'))); };
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await step(() => page.addInitScript(() => {
      self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true };
      const original = window.Worker, facts: WorkerFact[] = []; (window as Window & { __syntaxWorkers?: WorkerFact[] }).__syntaxWorkers = facts;
      window.Worker = class extends original {
        private readonly fact: WorkerFact;
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.fact = { syntax: false, sent: 0, ready: 0, replied: 0, terminated: 0 }; facts.push(this.fact); this.addEventListener('message', event => { if (event.data?.type === 'dbark-completion-ready') this.fact.ready++; else if (event.data?.id === 1 && this.fact.syntax) { this.fact.replied++; this.fact.result = structuredClone(event.data.result); } }); }
        override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) { const data = message as { intent?: unknown; source?: unknown }; if (data?.intent === 'syntax') { this.fact.syntax = true; this.fact.sent++; if (typeof data.source === 'string') this.fact.source = data.source; } if (Array.isArray(transfer)) super.postMessage(message, transfer); else super.postMessage(message, transfer); }
        override terminate() { this.fact.terminated++; super.terminate(); }
      };
    }));
    await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
    await step(() => application.evaluate(({ ipcMain, utilityProcess, BrowserWindow }) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], fork = utilityProcess.fork;
      if (!original || !window || BrowserWindow.getAllWindows().length !== 1) throw Error('原Main处理器或唯一窗口缺失');
      const state = { commands: [] as string[], denied: [] as string[], restore() {} };
      const deny = (command: string): never => { state.denied.push(command); throw Error('离线语法检查拒绝：' + command); };
      const wrapped: Handler = async (event, payload) => {
        if (handlers.get('dbark:request') !== wrapped || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || BrowserWindow.getAllWindows().length !== 1) return deny('外来文档或处理器替换');
        const command = (payload as { command?: unknown })?.command; if (typeof command !== 'string') return deny('非标准输入'); state.commands.push(command);
        if (/^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command) || /clipboard/i.test(command) || command.startsWith('files.') || command.startsWith('queryFileSources.') && command !== 'queryFileSources.status' || ['connections.open', 'connections.test', 'connections.connect'].includes(command)) return deny(command);
        return original(event, payload);
      };
      const guardedFork = (() => deny('utility.fork')) as typeof utilityProcess.fork;
      state.restore = () => { if (handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== guardedFork) throw Error('原观察器已变化'); handlers.set('dbark:request', original); utilityProcess.fork = fork; };
      (globalThis as typeof globalThis & { __syntaxNative?: typeof state }).__syntaxNative = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = guardedFork;
    })); armed = true;
    await click(page.locator('.navigation-toolbar'), '新建连接'); const form = page.getByRole('dialog', { name: '新建连接', exact: true });
    await step(() => form.getByLabel('连接名称', { exact: true }).fill('语法检查离线本例')); await step(() => form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1')); await step(() => form.getByLabel('端口', { exact: true }).fill('1')); await step(() => form.getByLabel('用户名', { exact: true }).fill('offline')); await click(form, '保存连接');
    // 仅准备隔离空草稿，随后真实恢复；避免新建查询向导主动读取数据库，不替代产品检查入口。
    await step(() => page.evaluate(async () => { const profiles = await window.dbark.invoke('connections.list', {}), settings = await window.dbark.invoke('settings.get', {}); if (profiles.length !== 1 || profiles[0].name !== '语法检查离线本例' || settings.tabs.length) throw Error('离线草稿准备目标不唯一'); const id = crypto.randomUUID(); await window.dbark.invoke('settings.save', { ...settings, tabs: [{ id, kind: 'query', title: '语法检查离线草稿', connectionId: profiles[0].id, sql: '' }], activeTabId: id }); }));
    await step(() => page.reload()); await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
    const proofs: unknown[] = [];
    /** 使用真实菜单，提示与原Worker回包、当前模型marker逐项比对。 */
    const inspect = async (source: string, gesture: 'more' | 'context', issues: boolean) => {
      await write(source); const before = await model(), count = (await workers()).filter(worker => worker.syntax).length;
      if (gesture === 'more') await click(query(), text.entry);
      else {
        const point = await step(() => page.evaluate(() => { const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => editor.hasTextFocus()); if (editors?.length !== 1) throw Error('右键原聚焦编辑器不唯一'); const editor = editors[0], position = editor.getPosition(), node = editor.getDomNode(); if (!position || !node) throw Error('右键原光标失效'); const view = editor.getScrolledVisiblePosition(position); if (!view) throw Error('原光标不可见'); const box = node.getBoundingClientRect(); return { x: box.left + view.left + 1, y: box.top + view.top + view.height / 2 }; }));
        await step(() => page.mouse.click(point.x, point.y, { button: 'right' })); const item = page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: text.entry, exact: true }); await step(() => expect(item).toBeVisible()); await step(() => item.click({ delay: 120 }));
      }
      await step(() => expect(panel()).toBeVisible()); await step(() => expect(panel().getByRole('status')).toContainText(issues ? text.issues : text.clean, { timeout: 13000 }));
      const facts = (await workers()).filter(worker => worker.syntax); expect(facts).toHaveLength(count + 1); const fact = facts.at(-1)!; expect(fact).toMatchObject({ sent: 1, ready: 1, replied: 1, terminated: 1, source: before.source }); expect(validSqlSyntaxCheckResult(fact.result, before.source)).toBe(true); if (fact.result?.status !== 'ready') throw Error('实际Worker未完成本地语法解析');
      const after = await model(); unchanged(before, after); expect(after.markers.map(marker => ({ start: marker.start, end: marker.end }))).toEqual(fact.result.issues.map(issue => ({ start: issue.start, end: issue.end }))); expect(after.markers.every(marker => marker.severity === 4)).toBe(true); expect((await audit()).denied).toEqual([]);
      if (issues) { expect(after.markers.length).toBeGreaterThan(0); await step(() => panel().getByRole('list').getByRole('button').first().click()); const selected = await model(); unchanged(before, selected); expect(selected.selection).toEqual({ start: fact.result.issues[0].start, end: fact.result.issues[0].end }); }
      await step(async () => info.attach('实际语法检查-' + gesture, { body: await page.screenshot(), contentType: 'image/png' })); proofs.push({ gesture, before, after: await model(), fact }); return before;
    };
    stage = '真实更多检查多语句，原文问题跳转与旧marker失效';
    const original = await inspect('SELECT 1;\r\n/* 中文😀 */\r\nSELECT id FROM;', 'more', true);
    await step(() => query().locator('.monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')); await step(() => page.keyboard.insertText('\n--继续编辑'));
    await step(() => expect(panel().getByRole('status')).toHaveText(text.reasons.stale)); expect((await model()).markers).toEqual([]); const workerCount = (await workers()).filter(worker => worker.syntax).length;
    await step(() => page.keyboard.press(modifier + '+Z')); await step(() => expect.poll(async () => (await model()).source).toBe(original.source)); expect((await model()).markers).toEqual([]); expect((await workers()).filter(worker => worker.syntax)).toHaveLength(workerCount);
    await step(() => panel().getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(panel()).toHaveCount(0));
    stage = '真实右键检查DELIMITER例程，不执行语句且原撤销栈保持';
    await inspect("DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT '分号;😀'; SELECT 2; END$$\nDELIMITER ;\nSELECT 3;", 'context', false);
    await step(() => panel().getByRole('button', { name: text.close, exact: true }).click()); expect((await model()).markers).toEqual([]);
    const final = await audit(); expect(final.denied).toEqual([]); expect(final.commands.filter(command => /^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command) || /clipboard/i.test(command))).toEqual([]);
    expect(await step(() => page.evaluate(async () => ({ tasks: (await window.dbark.invoke('tasks.list', {})).length, history: (await window.dbark.invoke('history.list', {})).length })))).toEqual({ tasks: 0, history: 0 });
    await step(() => page.locator('.workspace-tabs .tab-close, .tab-close').first().click()); const close = page.getByRole('dialog', { name: queryCloseZh.title, exact: true }); await step(() => expect(close).toBeVisible()); await step(() => close.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(query()).toHaveCount(0));
    const workerProof = await workers(); expect(workerProof.filter(worker => worker.syntax)).toHaveLength(2); expect(workerProof.filter(worker => worker.syntax).every(worker => worker.sent === 1 && worker.ready === 1 && worker.replied === 1 && worker.terminated === 1)).toBe(true); expect(pageErrors).toEqual([]);
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __syntaxNative?: { restore(): void } }).__syntaxNative; if (!state) throw Error('原Main观察器缺失'); state.restore(); })); armed = false;
    stage = '准确App正常退出与原进程核零'; await step(() => info.attach('语法检查原文回包模型与资源证明', { body: JSON.stringify({ directory, pid: originalProcess.pid, platform: process.platform, proofs, audit: final, workers: workerProof, systemClipboardOperations: 0, databaseRequests: 0, fixtureScope: '仅空草稿设置准备；真实菜单、原模型、Worker和Main透传' }), contentType: 'application/json' }));
    check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); completed = { directory, pid: originalProcess.pid, platform: process.platform };
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('语法检查失败现场', { body: JSON.stringify({ ...(failure?.() as object), firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); throw reason; }
});

/** 成功目录仅由原fixture在正常退出及准确PID确认后清理；失败现场保持。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing).toBe(true); await info.attach('语法检查最终退出清理证明', { body: JSON.stringify({ ...completed, normalExit: true, directoryRemoved: true, accepted: true, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
