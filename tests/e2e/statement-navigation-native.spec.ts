import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { statementNavigationZh as text } from '../../src/renderer/locales/statementNavigation.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { validStatementNavigationResult, type StatementNavigationResult } from '../../src/shared/statementNavigation';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_STATEMENT_NAVIGATION_NATIVE === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_/i.test(key) && !['DBARK_STATEMENT_NAVIGATION_NATIVE', 'DBARK_INTEGRATION_ENABLED'].includes(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|DB_|DATABASE_|SSH_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || /^PLAYWRIGHT_.*(?:TRACE|TIMEOUT|WORKER|RETRIES)/i.test(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('语句导航专项仅允许独占Windows/macOS离线源码，拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('语句导航专项禁止trace');
}
type Desktop = typeof import('./desktop-fixture');
interface WorkerFact { navigation: boolean; ready: number; sent: number; replied: number; terminated: number; source?: string; dialect?: string; result?: StatementNavigationResult; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式语句导航离线专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const completed = new Map<string, { directory: string; pid?: number; platform: string }>();
let failure: (() => unknown) | undefined;
test.afterEach(async ({}, info) => { if (active && info.status !== 'skipped' && !completed.has(info.title)) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); await info.attach('导航停链原件', { body: JSON.stringify(failure?.() ?? { stage: '尚未捕获owner' }), contentType: 'application/json' }); throw Error('语句导航尚未确认正常退出，保留原窗口和profile'); } });

for (const dialect of ['mysql', 'sqlite'] as const) test(`${dialect}真实菜单语句导航、分页全文搜索、跳转选中及ABA失效，零SQL执行`, async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), { application, page } = owner;
  const directory = runtime.dataDir, originalProcess = application.process(), modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const { join, dirname, resolve } = require('node:path') as typeof import('node:path'); const { realpathSync } = require('node:fs') as typeof import('node:fs');
  const sqlitePath = join(directory, 'navigation.sqlite'), name = '语句导航离线-' + dialect;
  let closed = false, armed = false, stage = '原窗口初始化', canonical: string | undefined;
  const pageErrors: string[] = []; page.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
  failure = () => ({ stage, directory, pid: originalProcess.pid, dialect, closed, armed, exitCode: originalProcess.exitCode, signal: originalProcess.signalCode, automaticRetry: false, automaticRestart: false, automaticForceStop: false });
  const check = () => { const now = runtime.ownedDesktopResources(info); if (now.application !== application || now.page !== page || now.closed !== closed || runtime.dataDir !== directory || !closed && application.process() !== originalProcess || closed && originalProcess.exitCode !== 0 || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.repeatEach !== 1 || info.config.workers !== 1) throw Error('导航原owner/profile/期限已变化'); };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const result = await action(); check(); return result; };
  const query = () => page.locator('.query-tab:visible'), panel = () => query().getByRole('region', { name: text.title, exact: true });
  const click = (scope: import('@playwright/test').Locator, name: string) => step(async () => { const item = await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(scope, { name, exact: true }, check); check(); await item.click(); check(); });
  const audit = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __navigationNative?: { commands: string[]; denied: string[]; pickerCalls: number } }).__navigationNative; if (!state) throw Error('原Main导航观察器缺失'); return { commands: state.commands, denied: state.denied, pickerCalls: state.pickerCalls }; }));
  const workers = () => step(() => page.evaluate(() => (window as Window & { __navigationWorkers?: WorkerFact[] }).__navigationWorkers ?? []));
  /** 磁盘全定义和全行由独立只读Node连接观察，不借用用户查询或导航线程。 */
  const disk = () => {
    check(); if (dialect !== 'sqlite') return undefined; if (dirname(resolve(sqlitePath)) !== resolve(directory)) throw Error('磁盘观察越界');
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), db = new DatabaseSync(sqlitePath, { readOnly: true });
    try { return { schema: db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all(), rows: db.prepare('SELECT * FROM sample ORDER BY id').all() }; } finally { db.close(); check(); }
  };
  /** 公共API只读真实原模型和选区，正文、光标操作只走真实键盘和产品导航按钮。 */
  const model = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => { const node = editor.getContainerDomNode(); return node.isConnected && !!node.closest('.query-tab') && node.getClientRects().length > 0; });
    if (editors?.length !== 1) throw Error('原查询编辑器不唯一'); const editor = editors[0], model = editor.getModel(), selection = editor.getSelection(); if (!model || model.isDisposed() || !selection || editor.getRawOptions().readOnly) throw Error('原模型或选区失效');
    return { uri: model.uri.toString(), version: model.getVersionId(), source: model.getValue(), undo: model.canUndo(), redo: model.canRedo(), selection: { start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()) } };
  }));
  const unchanged = (a: Awaited<ReturnType<typeof model>>, b: Awaited<ReturnType<typeof model>>) => expect({ uri: a.uri, version: a.version, source: a.source, undo: a.undo, redo: a.redo }).toEqual({ uri: b.uri, version: b.version, source: b.source, undo: b.undo, redo: b.redo });
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    if (dialect === 'sqlite') { const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), db = new DatabaseSync(sqlitePath); try { db.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO sample VALUES(1,'导航控制行😀')"); } finally { db.close(); } canonical = realpathSync(sqlitePath); }
    const baseline = disk();
    await step(() => page.addInitScript(() => {
      self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true };
      const original = window.Worker, facts: WorkerFact[] = []; (window as Window & { __navigationWorkers?: WorkerFact[] }).__navigationWorkers = facts;
      window.Worker = class extends original {
        private readonly fact: WorkerFact;
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.fact = { navigation: false, ready: 0, sent: 0, replied: 0, terminated: 0 }; facts.push(this.fact); this.addEventListener('message', event => { if (event.data?.type === 'dbark-statement-navigation-ready') { this.fact.navigation = true; this.fact.ready++; } else if (event.data?.id === 1 && this.fact.navigation) { this.fact.replied++; this.fact.result = structuredClone(event.data.result); } }); }
        override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) { const data = message as { source?: unknown; dialect?: unknown }; if (data && typeof data.dialect === 'string' && typeof data.source === 'string') { this.fact.navigation = true; this.fact.sent++; this.fact.source = data.source; this.fact.dialect = data.dialect; } if (Array.isArray(transfer)) super.postMessage(message, transfer); else super.postMessage(message, transfer); }
        override terminate() { this.fact.terminated++; super.terminate(); }
      };
    }));
    await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
    await step(() => application.evaluate(({ ipcMain, utilityProcess, BrowserWindow, dialog }, path) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], fork = utilityProcess.fork, picker = dialog.showOpenDialog;
      if (!original || !window || BrowserWindow.getAllWindows().length !== 1) throw Error('原Main和唯一窗口未知');
      const state = { commands: [] as string[], denied: [] as string[], pickerCalls: 0, restore() {} }; let picking = false;
      const deny = (name: string): never => { state.denied.push(name); throw Error('离线导航拒绝：' + name); };
      const wrapped: Handler = async (event, payload) => {
        if (handlers.get('dbark:request') !== wrapped || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || BrowserWindow.getAllWindows().length !== 1) return deny('外来文档或原观察器变化');
        const command = (payload as { command?: unknown })?.command, input = (payload as { input?: any })?.input; if (typeof command !== 'string') return deny('非标准请求'); state.commands.push(command);
        if (command === 'files.choose' && path && state.pickerCalls === 0 && input?.purpose === 'sqlite-database' && typeof input.sqliteConnectionId === 'string') { picking = true; try { return await original(event, payload); } finally { picking = false; } }
        if (/^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command) || /clipboard/i.test(command) || command.startsWith('files.') || command.startsWith('queryFileSources.') && command !== 'queryFileSources.status' || ['connections.test', 'connections.open', 'connections.connect'].includes(command)) return deny(command);
        return original(event, payload);
      };
      const guardedFork = (() => deny('utility.fork')) as typeof utilityProcess.fork;
      const guardedPicker = (async (...args: unknown[]) => { if (!picking || !path || state.pickerCalls || args[0] !== window || !(args.at(-1) as Electron.OpenDialogOptions)?.properties?.includes('openFile')) return deny('非本例SQLite chooser'); state.pickerCalls++; return { canceled: false, filePaths: [path] }; }) as typeof dialog.showOpenDialog;
      state.restore = () => { if (handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== guardedFork || dialog.showOpenDialog !== guardedPicker) throw Error('原观察器变化'); handlers.set('dbark:request', original); utilityProcess.fork = fork; dialog.showOpenDialog = picker; };
      (globalThis as typeof globalThis & { __navigationNative?: typeof state }).__navigationNative = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = guardedFork; dialog.showOpenDialog = guardedPicker;
    }, canonical)); armed = true;
    stage = '真实连接表单和隔离空草稿准备';
    await click(page.locator('.navigation-toolbar'), '新建连接'); const form = page.getByRole('dialog', { name: '新建连接', exact: true }); await step(() => form.getByLabel('连接名称', { exact: true }).fill(name));
    if (dialect === 'sqlite') { await step(() => form.locator('select').selectOption('sqlite')); await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); }
    else { await step(() => form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1')); await step(() => form.getByLabel('端口', { exact: true }).fill('1')); await step(() => form.getByLabel('用户名', { exact: true }).fill('offline')); }
    await click(form, '保存连接');
    // 唯一替换是本例准确SQLite chooser；通过真实设置协议准备空草稿，再走工作区恢复，避免新建向导主动建连。
    await step(() => page.evaluate(async ({ name, dialect }) => { const profiles = await window.dbark.invoke('connections.list', {}), settings = await window.dbark.invoke('settings.get', {}); if (profiles.length !== 1 || profiles[0].name !== name || profiles[0].dialect !== dialect || settings.tabs.length) throw Error('导航空草稿目标不唯一'); const id = crypto.randomUUID(); await window.dbark.invoke('settings.save', { ...settings, theme: dialect === 'sqlite' ? 'light' : 'dark', tabs: [{ id, kind: 'query', title: '语句导航草稿', connectionId: profiles[0].id, ...(dialect === 'sqlite' ? { database: 'main', databaseContext: { state: 'known', database: 'main' } } : {}), sql: '' }], activeTabId: id }); }, { name, dialect }));
    await step(() => page.reload()); await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
    await step(() => expect(page.locator('html')).toHaveAttribute('data-theme', dialect === 'sqlite' ? 'light' : 'dark'));
    const compound = dialect === 'sqlite' ? "CREATE TEMP TRIGGER nav_trigger AFTER INSERT ON sample BEGIN UPDATE sample SET note=';'; SELECT CASE WHEN 1 THEN ';' END; END;" : "DELIMITER $$\nCREATE PROCEDURE nav_proc() BEGIN SELECT ';'; SELECT 2; END$$\nDELIMITER ;";
    const script = (dialect === 'sqlite' ? '--前导注释;😀\n' : '#前导注释;😀\n') + "SELECT 'duplicate;😀';\n" + compound + "\nSELECT '" + 'x'.repeat(200) + "hidden_needle';\n" + "SELECT 'duplicate;😀';\n".repeat(10);
    await step(() => query().locator('.monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.insertText(script)); await step(() => expect.poll(async () => (await model()).source.replaceAll('\r\n', '\n')).toBe(script));
    stage = '原生菜单跳到行列，恢复仅结果布局并保持草稿';
    const beforePosition = await model();
    await step(() => query().getByRole('button', { name: '查询结果布局', exact: true }).click());
    await step(() => page.getByRole('menuitem', { name: '仅显示结果', exact: true }).click());
    await step(() => expect(query().locator('.monaco-editor')).toBeHidden());
    const lineEditEnabled = () => step(() => application.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById('sql-duplicate-lines')?.enabled === true));
    await expect.poll(lineEditEnabled).toBe(false);
    const gotoLine = async () => {
      await expect.poll(() => step(() => application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line')?.enabled === true))).toBe(true);
      await step(() => application.evaluate(({ Menu, BrowserWindow }) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line'), windows = BrowserWindow.getAllWindows();
        if (!item?.enabled || windows.length !== 1) throw Error('跳到行列原生命令不可用');
        item.click(item, windows[0], {} as Electron.KeyboardEvent);
      }));
    };
    await gotoLine();
    await step(() => expect(query().locator('.monaco-editor')).toBeVisible());
    const quickInput = page.locator('.quick-input-widget:visible input');
    await step(() => quickInput.fill(':2:4')); await step(() => quickInput.press('Enter'));
    const targetOffset = beforePosition.source.indexOf('\n') + 4;
    await expect.poll(async () => (await model()).selection).toEqual({ start: targetOffset, end: targetOffset });
    const afterPosition = await model(); unchanged(beforePosition, afterPosition);
    await gotoLine(); await step(() => quickInput.fill(':3:2')); await step(() => quickInput.press('Escape'));
    await expect.poll(async () => (await model()).selection).toEqual(afterPosition.selection);
    unchanged(beforePosition, await model());
    stage = '原生菜单切换行注释并保护 MySQL 双负号';
    const toggleComment = () => step(() => application.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-toggle-comment'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('切换行注释原生命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }));
    await toggleComment();
    const startOfLine = beforePosition.source.indexOf('\n') + 1;
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source.slice(0, startOfLine) + '-- ' + beforePosition.source.slice(startOfLine));
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source);
    await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'));
    await step(() => page.keyboard.insertText('--8'));
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source + '--8');
    await step(() => page.keyboard.press(modifier + '+/'));
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source + (dialect === 'mysql' ? '-- --8' : '8'));
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source + '--8');
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(beforePosition.source);
    stage = '原生整行编辑与右键删除分别可撤销';
    await gotoLine();
    await step(() => quickInput.fill(':2:1')); await step(() => quickInput.press('Enter'));
    await step(() => page.keyboard.press('Shift+ArrowDown'));
    const originalLines = await model();
    const selectedLine = originalLines.source.slice(originalLines.selection.start, originalLines.selection.end);
    expect(selectedLine.replaceAll('\r\n', '\n')).toBe("SELECT 'duplicate;😀';\n");
    const lineCommand = (id: 'sql-duplicate-lines' | 'sql-move-lines-up' | 'sql-move-lines-down') =>
      step(() => application.evaluate(({ Menu, BrowserWindow }, id) => {
        const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
        if (!item?.enabled || windows.length !== 1) throw Error('行操作原生命令不可用');
        item.click(item, windows[0], {} as Electron.KeyboardEvent);
      }, id));
    const { start, end } = originalLines.selection;
    const firstLine = originalLines.source.slice(0, start), tail = originalLines.source.slice(end);
    await expect.poll(lineEditEnabled).toBe(true);
    await gotoLine();
    await step(() => quickInput.fill(':1:1')); await step(() => quickInput.press('Enter'));
    await step(() => page.keyboard.press('Shift+ArrowDown'));
    await step(() => page.keyboard.press('Shift+ArrowDown'));
    await expect.poll(async () => (await model()).selection).toEqual({ start: 0, end });
    await lineCommand('sql-duplicate-lines');
    await expect.poll(async () => (await model()).source).toBe((firstLine + selectedLine).repeat(2) + tail);
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(originalLines.source);
    await gotoLine();
    await step(() => quickInput.fill(':2:1')); await step(() => quickInput.press('Enter'));
    await step(() => page.keyboard.press('Shift+ArrowDown'));
    await expect.poll(async () => (await model()).selection).toEqual({ start, end });
    await lineCommand('sql-duplicate-lines');
    await expect.poll(async () => (await model()).source).toBe(firstLine + selectedLine.repeat(2) + tail);
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(originalLines.source);
    await lineCommand('sql-move-lines-up');
    await expect.poll(async () => (await model()).source).toBe(selectedLine + firstLine + tail);
    await lineCommand('sql-move-lines-down');
    await expect.poll(async () => (await model()).source).toBe(originalLines.source);
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(selectedLine + firstLine + tail);
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(originalLines.source);
    const linePoint = await step(() => page.evaluate(() => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const editor = api?.editor.getEditors().find(item => item.getContainerDomNode().closest('.query-tab'));
      const position = editor?.getScrolledVisiblePosition({ lineNumber: 2, column: 3 });
      const bounds = editor?.getDomNode()?.getBoundingClientRect();
      if (!position || !bounds) throw Error('删除行右键坐标不可用');
      return { x: bounds.x + position.left, y: bounds.y + position.top + position.height / 2 };
    }));
    await step(() => page.mouse.click(linePoint.x, linePoint.y, { button: 'right' }));
    await step(() => page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: uiCommandLabels['sql-delete-lines'], exact: true }).click({ delay: 120 }));
    await expect.poll(async () => (await model()).source).toBe(firstLine + tail);
    await step(() => page.keyboard.press(modifier + '+Z'));
    await expect.poll(async () => (await model()).source).toBe(originalLines.source);
    await step(() => page.keyboard.press('ArrowRight'));
    stage = '真实原生菜单与右键仅转换选区并可一次撤销';
    const nativeEnabled = () => step(() => application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-lowercase')?.enabled === true));
    await expect.poll(nativeEnabled).toBe(false);
    await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'));
    await step(() => page.keyboard.press('ArrowDown'));
    await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'));
    for (let index = 0; index < 6; index++) await step(() => page.keyboard.press('Shift+ArrowRight'));
    const originalCase = await model(), range = originalCase.selection;
    expect(originalCase.source.slice(range.start, range.end)).toBe('SELECT');
    await expect.poll(nativeEnabled).toBe(true);
    await step(() => application.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('sql-lowercase'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('当前选区的原生小写命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }));
    const lower = originalCase.source.slice(0, range.start) + 'select' + originalCase.source.slice(range.end);
    await expect.poll(async () => (await model()).source).toBe(lower);
    const point = await step(() => page.evaluate(() => {
      const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco;
      const editor = api?.editor.getEditors().find(item => { const node = item.getContainerDomNode(); return !!node.closest('.query-tab') && node.getClientRects().length > 0; });
      const visible = editor?.getScrolledVisiblePosition({ lineNumber: 2, column: 3 }), box = editor?.getDomNode()?.getBoundingClientRect();
      if (!visible || !box) throw Error('选区坐标不可用');
      return { x: box.x + visible.left + 1, y: box.y + visible.top + visible.height / 2 };
    }));
    await step(() => page.mouse.click(point.x, point.y, { button: 'right' }));
    await step(() => page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: uiCommandLabels['sql-uppercase'], exact: true }).click({ delay: 120 }));
    await expect.poll(async () => (await model()).source).toBe(originalCase.source);
    await step(() => page.keyboard.press(modifier + '+Z')); await expect.poll(async () => (await model()).source).toBe(lower);
    await step(() => page.keyboard.press(modifier + '+Z')); await expect.poll(async () => (await model()).source).toBe(originalCase.source);
    const before = await model(); expect(before.uri).toBe(originalCase.uri);
    stage = '真实更多/右键导航，13条完整分段与原源回包核对';
    if (dialect === 'mysql') await click(query(), text.entry);
    else { await step(() => query().locator('.monaco-editor').click({ button: 'right', position: { x: 150, y: 28 } })); const item = page.locator('.monaco-menu-container:visible').getByRole('menuitem', { name: text.entry, exact: true }); await step(() => expect(item).toBeVisible()); await step(() => item.click({ delay: 120 })); }
    await step(() => expect(panel().getByRole('status')).toHaveText(text.total(13), { timeout: 13000 })); const facts = (await workers()).filter(value => value.navigation); expect(facts).toHaveLength(1); const fact = facts[0]; expect(fact).toMatchObject({ ready: 1, sent: 1, replied: 1, terminated: 1, dialect, source: before.source }); expect(validStatementNavigationResult(fact.result, before.source)).toBe(true); if (fact.result?.status !== 'ready') throw Error('导航原分段未完成'); const ranges = fact.result.statements; expect(ranges).toHaveLength(13); unchanged(before, await model());
    expect(before.source.slice(ranges[1].start, ranges[1].end)).toContain(dialect === 'sqlite' ? 'CREATE TEMP TRIGGER' : 'CREATE PROCEDURE'); expect(before.source.slice(ranges[1].start, ranges[1].end)).toContain(dialect === 'sqlite' ? "UPDATE sample SET note=';';" : "SELECT ';'; SELECT 2;");
    await step(() => expect(panel().getByRole('listitem').nth(2).locator('code')).not.toContainText('hidden_needle')); await step(() => panel().getByRole('textbox', { name: text.search, exact: true }).fill('hidden_needle')); await step(() => expect(panel().getByRole('status')).toHaveText(text.total(1)));
    await step(() => panel().getByRole('button', { name: `${text.select} 3`, exact: true }).click()); const selected = await model(); unchanged(before, selected); expect(selected.selection).toEqual({ start: ranges[2].start, end: ranges[2].end });
    await step(() => panel().getByRole('textbox', { name: text.search, exact: true }).fill('')); await step(() => panel().getByRole('button', { name: text.next, exact: true }).click()); await step(() => expect(panel().getByRole('listitem')).toHaveCount(3)); await step(() => panel().getByRole('button', { name: /^第 13 条/ }).click()); const jumped = await model(); unchanged(before, jumped); expect(jumped.selection).toEqual({ start: ranges[12].start, end: ranges[12].start }); await step(() => expect(panel().locator('li.active')).toHaveCount(1));
    await step(() => application.evaluate(({ BrowserWindow }) => { const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('非唯一导航窗口'); windows[0].setSize(1150, 760); }));
    await step(() => expect.poll(async () => page.evaluate(() => { const node = document.querySelector('.statement-navigation'); const editor = document.querySelector('.sql-editor-wrap > [aria-busy] .monaco-editor'), e = editor?.getBoundingClientRect(), n = node?.getBoundingClientRect(); return !!node && !!e && !!n && node.scrollWidth <= node.clientWidth + 1 && e.height >= 130 && e.right <= n.left + 1 && n.bottom <= e.bottom + 1; })).toBe(true));
    await step(async () => info.attach('实际导航-' + dialect, { body: await page.screenshot(), contentType: 'image/png' }));
    stage = '编辑使目录失效，撤销不能复活，明确刷新才重建';
    await step(() => query().locator('.monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')); await step(() => page.keyboard.insertText('\n--继续编辑')); await step(() => expect(panel().getByRole('status')).toHaveText(text.reasons.stale)); await step(() => expect(panel().getByRole('listitem')).toHaveCount(0));
    await step(() => page.keyboard.press(modifier + '+Z')); await step(() => expect.poll(async () => (await model()).source).toBe(before.source)); expect((await workers()).filter(value => value.navigation)).toHaveLength(1); await step(() => panel().getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => expect(panel().getByRole('status')).toHaveText(text.total(13), { timeout: 13000 })); const finalWorkers = (await workers()).filter(value => value.navigation); expect(finalWorkers).toHaveLength(2); expect(finalWorkers.every(value => value.ready === 1 && value.sent === 1 && value.replied === 1 && value.terminated === 1)).toBe(true);
    stage = '真实偏好设置模态使原目录永久失效';
    await step(() => page.getByRole('button', { name: '偏好设置', exact: true }).click()); const preferences = page.getByRole('dialog', { name: '偏好设置', exact: true }); await step(() => expect(preferences).toBeVisible()); await step(() => preferences.getByRole('button', { name: '完成', exact: true }).click()); await step(() => expect(panel().getByRole('status')).toHaveText(text.reasons.stale)); await step(() => expect(panel().getByRole('listitem')).toHaveCount(0)); expect((await workers()).filter(value => value.navigation)).toHaveLength(2);
    const final = await audit(); expect(final.denied).toEqual([]); expect(final.pickerCalls).toBe(dialect === 'sqlite' ? 1 : 0); expect(final.commands.filter(command => /^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command))).toEqual([]); expect(disk()).toEqual(baseline);
    expect(await step(() => page.evaluate(async () => ({ history: (await window.dbark.invoke('history.list', {})).length, tasks: (await window.dbark.invoke('tasks.list', {})).length })))).toEqual({ history: 0, tasks: 0 });
    const finalModel = await model(); expect(finalModel.source).toBe(before.source);
    await step(() => panel().getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(panel()).toHaveCount(0));
    stage = '保留草稿后通过原生窗口菜单重开，明确放弃后不可重开';
    const tabButton = page.locator('[data-workspace-tab-id]');
    const oldTabId = await step(() => tabButton.getAttribute('data-workspace-tab-id'));
    const close = page.getByRole('dialog', { name: queryCloseZh.title, exact: true });
    const reopenEnabled = () => step(() => application.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('reopen-query')?.enabled === true));
    await expect.poll(reopenEnabled).toBe(false);
    await step(() => tabButton.locator('.tab-close').click()); await step(() => expect(close).toBeVisible());
    await step(() => close.getByRole('button', { name: queryCloseZh.keepDraft, exact: true }).click()); await step(() => expect(query()).toHaveCount(0));
    await expect.poll(reopenEnabled).toBe(true);
    await step(() => application.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('reopen-query'), windows = BrowserWindow.getAllWindows();
      if (!item?.enabled || windows.length !== 1) throw Error('原生重开命令不可用');
      item.click(item, windows[0], {} as Electron.KeyboardEvent);
    }));
    await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeEditable());
    expect(await step(() => tabButton.getAttribute('data-workspace-tab-id'))).not.toBe(oldTabId);
    expect((await model()).source).toBe(finalModel.source);
    await expect.poll(reopenEnabled).toBe(false);
    await step(() => tabButton.locator('.tab-close').click()); await step(() => expect(close).toBeVisible());
    await step(() => close.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(query()).toHaveCount(0));
    await expect.poll(reopenEnabled).toBe(false); expect((await audit()).denied).toEqual([]); expect(disk()).toEqual(baseline); expect(pageErrors).toEqual([]);
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __navigationNative?: { restore(): void } }).__navigationNative; if (!state) throw Error('原观察器缺失'); state.restore(); })); armed = false;
    await step(() => info.attach('导航原文范围模型与资源证明-' + dialect, { body: JSON.stringify({ directory, pid: originalProcess.pid, dialect, platform: process.platform, before, selected, jumped, finalModel, fact, finalWorkers, audit: final, baseline, finalDisk: disk(), userSqlExecutions: 0, systemClipboardOperations: 0, fixtureScope: '只准备准确空草稿和SQLite chooser；真实菜单/模型/Worker/Main透传' }), contentType: 'application/json' }));
    stage = '原App正常退出和准确PID确认'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(baseline); completed.set(info.title, { directory, pid: originalProcess.pid, platform: process.platform });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('导航失败现场', { body: JSON.stringify({ ...(failure?.() as object), firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); throw reason; }
});

/** 准确目录只由原fixture在正常退出及所属PID核零后清理，失败目录不删。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed.size) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); for (const [title, entry] of completed) { let missing = false; try { await stat(entry.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing).toBe(true); await info.attach('导航最终退出清理-' + title, { body: JSON.stringify({ ...entry, normalExit: true, directoryRemoved: true, accepted: true }), contentType: 'application/json' }); } });
