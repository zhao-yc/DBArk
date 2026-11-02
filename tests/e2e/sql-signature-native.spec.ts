import { test as baseTest, expect } from '@playwright/test';

// 默认与列举均不加载桌面或SQLite；专项拒绝用户配置、网络认证和自动trace。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQL_SIGNATURE_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/i.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/i.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('参数提示只允许离线源码独占profile；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('参数提示专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface Audit { commands: string[]; denied: string[]; pickerCalls: number; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须显式开启离线SQL参数提示专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let complete = false;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !complete) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('参数提示未完成正常退出，保留原窗口及profile'); } });

test('真实三方言编辑器括号、逗号、嵌套和快捷键参数提示，不改模型且零数据库请求', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { application, page } = runtime.ownedDesktopResources(info);
  const { join, basename } = require('node:path') as typeof import('node:path'), { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const directory = runtime.dataDir, database = join(directory, 'sql-signature-only.sqlite'), applicationProcess = application.process(), pid = applicationProcess.pid;
  const db = new DatabaseSync(database); try { db.exec("CREATE TABLE __owner(purpose TEXT); INSERT INTO __owner VALUES('sql-signature-local-only');"); } finally { db.close(); }
  const originalFile = readFileSync(database), modifier = process.platform === 'darwin' ? 'Meta' : 'Control'; let closed = false;
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.config.workers !== 1) throw Error('参数提示原owner或期限变化'); };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
  const query = () => page.locator('.query-tab:visible'), widget = () => page.locator('.parameter-hints-widget:visible');
  const click = async (container: import('@playwright/test').Locator, name: string) => step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(container, { name, exact: true }, check)).click());
  expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
  await info.attach('参数提示本例owner', { body: JSON.stringify({ directory, database, pid, platform: process.platform }), contentType: 'application/json' });
  await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
  await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
  // 真实处理器透传；唯一适配是本例SQLite文件选择，不允许创建会话、元数据、SQL或utility。
  await step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, database) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0];
    if (!original || !window || BrowserWindow.getAllWindows().length !== 1) throw Error('缺少唯一本例主窗口');
    const state: Audit = { commands: [], denied: [], pickerCalls: 0 }; let choosing = false;
    (globalThis as typeof globalThis & { __sqlSignatureAudit?: Audit }).__sqlSignatureAudit = state;
    const deny = (command: string): never => { state.denied.push(command); throw Error('离线参数提示拒绝：' + command); };
    dialog.showOpenDialog = (async () => { if (!choosing || state.pickerCalls) return deny('非本例文件选择'); state.pickerCalls++; return { canceled: false, filePaths: [database] }; }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (() => deny('保存文件')) as typeof dialog.showSaveDialog;
    utilityProcess.fork = (() => deny('utility.fork')) as typeof utilityProcess.fork;
    handlers.set('dbark:request', async (event, payload) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return deny('外来frame');
      const value = payload as { command?: unknown; input?: Record<string, unknown> }, command = value.command;
      if (typeof command !== 'string') return deny('非标准请求'); state.commands.push(command);
      if (/^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command) || /clipboard/i.test(command) || ['connections.open', 'connections.test', 'connections.connect', 'files.path', 'files.save', 'files.export'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (choosing || state.pickerCalls || value.input?.purpose !== 'sqlite-database' || typeof value.input.sqliteConnectionId !== 'string') return deny('文件选择归属'); choosing = true; }
      try { return await original(event, payload); } finally { if (command === 'files.choose') choosing = false; }
    });
  }, database));
  for (const dialect of ['mysql', 'mariadb', 'sqlite'] as const) {
    await click(page.locator('.navigation-toolbar'), '新建连接');
    const form = page.getByRole('dialog', { name: '新建连接', exact: true });
    await step(() => form.getByLabel('连接名称', { exact: true }).fill('参数提示离线' + dialect));
    await step(() => form.locator('select').selectOption(dialect));
    if (dialect === 'sqlite') {
      const { sqliteZh } = require('../../src/renderer/locales/sqlite.zh-CN') as typeof import('../../src/renderer/locales/sqlite.zh-CN');
      await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click());
      await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database)));
    } else {
      await step(() => form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1'));
      await step(() => form.getByLabel('端口', { exact: true }).fill('1'));
      await step(() => form.getByLabel('用户名', { exact: true }).fill('offline'));
    }
    await click(form, '保存连接'); await step(() => expect(form).toBeHidden());
  }
  // 新建查询会主动建连；只通过真实设置协议准备独占空草稿，随后使用原布局恢复及真实键盘。
  const tabs = await step(() => page.evaluate(async () => {
    const profiles = await window.dbark.invoke('connections.list', {}), settings = await window.dbark.invoke('settings.get', {});
    if (profiles.length !== 3 || settings.tabs.length || profiles.some(profile => profile.name !== '参数提示离线' + profile.dialect)) throw Error('本例草稿目标不唯一');
    const tabs = profiles.map(profile => ({ id: crypto.randomUUID(), kind: 'query' as const, title: '参数提示' + profile.dialect, connectionId: profile.id, sql: '' }));
    await window.dbark.invoke('settings.save', { ...settings, tabs, activeTabId: tabs[0].id });
    return tabs.map(tab => ({ id: tab.id, dialect: profiles.find(profile => profile.id === tab.connectionId)!.dialect }));
  }));
  await step(() => page.reload()); await step(() => expect(query().locator('.monaco-editor')).toBeVisible());
  /** 只读公开API核原模型、位置和撤销；不直接设置光标、正文或调用provider。 */
  const snapshot = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => editor.hasTextFocus());
    if (editors?.length !== 1) throw Error('缺少唯一原聚焦编辑器'); const editor = editors[0], model = editor.getModel(), position = editor.getPosition();
    if (!model || !position || model.isDisposed()) throw Error('原模型失效');
    return { uri: model.uri.toString(), source: model.getValue(), version: model.getVersionId(), undo: model.canUndo(), redo: model.canRedo(), offset: model.getOffsetAt(position) };
  }));
  const input = async (source: string) => { await step(() => page.keyboard.press('Escape')); await step(() => query().locator('.monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press(modifier + '+A')); await step(() => page.keyboard.press('Backspace')); await step(() => page.keyboard.insertText(source)); };
  const hint = async (label: string, parameter: string) => { await step(() => expect(widget().locator('.signature .code')).toHaveText(label)); await step(() => expect(widget().locator('.signature .parameter.active')).toHaveText(parameter)); };
  const proofs: unknown[] = [];
  for (const tab of tabs) {
    await step(() => page.locator('[data-workspace-tab-id="' + tab.id + '"] .tab-select').click());
    await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
    await input('SELECT SUBSTR'); await step(() => page.keyboard.type('(')); await hint('SUBSTR(字符串, 起始位置)', '字符串');
    await input("SELECT SUBSTR('前,🚢', 1"); await step(() => page.keyboard.type(',')); await hint('SUBSTR(字符串, 起始位置, 长度)', '长度');
    // 真实输入走Monaco原自动补括号；光标留在右括号前，不能把正常编辑动作误算为提示修改。
    const before = await snapshot(); expect(before.source).toBe("SELECT SUBSTR('前,🚢', 1,)"); expect(before.offset).toBe(before.source.length - 1);
    await step(() => page.keyboard.press(modifier + '+Shift+Space')); await hint('SUBSTR(字符串, 起始位置, 长度)', '长度'); expect(await snapshot()).toEqual(before);
    await info.attach('参数提示真实窗口-' + tab.dialect, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    await step(() => page.keyboard.type('2)')); await step(() => expect(widget()).toHaveCount(0));
    if (tab.dialect !== 'sqlite') {
      await input("SELECT CONCAT('a', IFNULL(1"); await step(() => page.keyboard.type(',')); await hint('IFNULL(值, 替代值)', '替代值');
      await step(() => page.keyboard.type('0)')); await hint('CONCAT(值, ...)', '值');
      await step(() => page.keyboard.type(')')); await step(() => expect(widget()).toHaveCount(0));
    } else {
      await input('SELECT MAX(1'); await step(() => page.keyboard.type(',')); await hint('MAX(值1, 其他值, ...)', '其他值');
    }
    proofs.push({ dialect: tab.dialect, unchangedByManualHint: before, final: await snapshot() });
  }
  await step(() => page.keyboard.press('Escape'));
  const audit = await step(() => application.evaluate(() => (globalThis as typeof globalThis & { __sqlSignatureAudit?: Audit }).__sqlSignatureAudit));
  expect(audit?.denied).toEqual([]); expect(audit?.pickerCalls).toBe(1); expect(audit?.commands.some(command => /^(?:query|metadata|sessions|sqlite)\./.test(command))).toBe(false);
  expect(await step(() => page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })))).toEqual({ tasks: [], history: [] });
  expect(readFileSync(database)).toEqual(originalFile); expect(runtime.pageErrors).toEqual([]);
  check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(applicationProcess.exitCode).toBe(0);
  await info.attach('参数提示真实原件', { body: JSON.stringify({ proofs, audit, directory, database, pid, platform: process.platform, originalExitCode: applicationProcess.exitCode, normalExit: true, sourceFileUnchanged: true, systemFilePickerInputVerified: false, systemClipboard: 0 }), contentType: 'application/json' });
  complete = true;
});
