import { test as baseTest, expect } from '@playwright/test';

// 默认和列举均不加载桌面fixture；离线本文引用不接收任何数据库认证或用户配置路径。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_LOCAL_REFERENCES_NATIVE === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/i.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/i.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PG|SSH_AUTH_SOCK$|SSH_AGENT_PID$|DATABASE_URL$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('本文关系引用只允许离线源码临时profile；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('本文关系引用专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
type WorkerFact = { posted: number; ready: number; replied: number; terminated: number; references: boolean; status?: string; count?: number };
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式启用MySQL本文引用离线专项');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let complete = false;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !complete) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('本文关系引用未完成正常退出，保留原窗口和profile'); } });

test('MySQL离线真实Shift+F12引用列表与跳转，保持原模型、撤销和零数据库请求', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), { application, page } = owner;
  const directory = runtime.dataDir, appProcess = application.process(), pid = appProcess.pid, modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const observedErrors: string[] = []; page.on('pageerror', error => observedErrors.push(error.stack ?? error.message));
  let closed = false;
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.config.workers !== 1) throw Error('本文引用原owner或期限改变'); };
  const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
  const query = () => page.locator('.query-tab:visible');
  const click = async (container: import('@playwright/test').Locator, name: string) => step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(container, { name, exact: true }, check)).click());
  expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
  await info.attach('本文引用本轮owner', { body: JSON.stringify({ directory, pid, platform: process.platform }), contentType: 'application/json' });
  await step(() => page.addInitScript(() => {
    self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true };
    const original = window.Worker, facts: WorkerFact[] = [];
    (window as Window & { __localReferencesWorkers?: WorkerFact[] }).__localReferencesWorkers = facts;
    window.Worker = class extends original {
      private fact: WorkerFact;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); this.fact = { posted: 0, ready: 0, replied: 0, terminated: 0, references: false }; facts.push(this.fact);
        this.addEventListener('message', event => { if (event.data?.type === 'dbark-completion-ready') this.fact.ready++; else if (event.data?.result) { this.fact.replied++; this.fact.status = event.data.result.status; this.fact.count = event.data.result.references?.length; } });
      }
      override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions): void { if (message && typeof message === 'object' && 'intent' in message && message.intent === 'references') { this.fact.references = true; this.fact.posted++; } if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options); }
      override terminate(): void { this.fact.terminated++; super.terminate(); }
    };
  }));
  await step(() => page.reload()); await step(() => expect(page.locator('.app-statusbar')).toBeVisible());
  // 原处理器真实透传；任何数据库、文件或剪贴板请求在到达业务前拒绝，不伪造导航结果。
  await step(() => application.evaluate(({ ipcMain, utilityProcess }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request');
    if (!original) throw Error('原请求处理器不存在');
    const state = { commands: [] as string[], denied: [] as string[] };
    (globalThis as typeof globalThis & { __localReferencesAudit?: typeof state }).__localReferencesAudit = state;
    const deny = (command: string): never => { state.denied.push(command); throw Error('离线本文引用拒绝：' + command); };
    handlers.set('dbark:request', async (event, payload) => {
      const command = (payload as { command?: unknown })?.command;
      if (typeof command !== 'string') return deny('非标准请求'); state.commands.push(command);
      if (/^(?:metadata|sessions|query|table|schema|sqlite|serverMonitor)\./.test(command) || /clipboard/i.test(command) || ['connections.open', 'connections.test', 'connections.connect', 'files.choose', 'files.path', 'files.save', 'files.export'].includes(command)) return deny(command);
      return original(event, payload);
    });
    utilityProcess.fork = (() => deny('utility.fork')) as typeof utilityProcess.fork;
  }));
  await click(page.locator('.navigation-toolbar'), '新建连接');
  const connection = page.getByRole('dialog', { name: '新建连接', exact: true });
  await step(() => connection.getByLabel('连接名称', { exact: true }).fill('本文引用离线本例'));
  await step(() => connection.getByLabel('主机地址', { exact: true }).fill('127.0.0.1'));
  await step(() => connection.getByLabel('端口', { exact: true }).fill('1'));
  await step(() => connection.getByLabel('用户名', { exact: true }).fill('offline'));
  await click(connection, '保存连接');
  // 新建查询对话框会主动建连；本例通过真实设置协议准备空草稿，再走原工作区恢复入口。
  // 只准备独占fixture，不模拟产品按钮、不直接改model，也不放行数据库请求。
  await step(() => page.evaluate(async () => {
    const profiles = await window.dbark.invoke('connections.list', {}), settings = await window.dbark.invoke('settings.get', {});
    if (profiles.length !== 1 || profiles[0].name !== '本文引用离线本例' || settings.tabs.length) throw Error('离线草稿准备目标不唯一');
    const id = crypto.randomUUID();
    await window.dbark.invoke('settings.save', { ...settings, tabs: [{ id, kind: 'query', title: '本文引用离线草稿', connectionId: profiles[0].id, sql: '' }], activeTabId: id });
  }));
  await step(() => page.reload());
  await step(() => expect(query().locator('.monaco-editor')).toBeVisible());
  /** 全部只读公开Monaco API，禁止直接设置光标、正文或调用provider。 */
  const snapshot = () => step(() => page.evaluate(() => {
    const api = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco, editors = api?.editor.getEditors().filter(editor => editor.hasTextFocus());
    if (editors?.length !== 1) throw Error('缺少唯一原聚焦编辑器'); const editor = editors[0], model = editor.getModel(), position = editor.getPosition();
    if (!model || !position || model.isDisposed()) throw Error('原模型失效');
    const selected = editor.getSelection(); if (!selected) throw Error('原模型选区失效');
    return { uri: model.uri.toString(), source: model.getValue(), version: model.getVersionId(), undo: model.canUndo(), redo: model.canRedo(), offset: model.getOffsetAt(position), selection: { start: model.getOffsetAt(selected.getStartPosition()), end: model.getOffsetAt(selected.getEndPosition()) } };
  }));

  const proofs: unknown[] = [];
  for (const [marked, count] of [
    ['SELECT |s.id, s.name FROM subject AS s WHERE s.id=1', 3],
    ['WITH |q AS (SELECT 1 n) SELECT q.n FROM q', 2],
    ['SELECT |d.n FROM (SELECT 1 n) AS d WHERE d.n=1', 2],
    ['SELECT |s.id, (SELECT s.id FROM child s) FROM parent s WHERE s.id=1', 2],
  ] as const) {
    const source = marked.replace('|', ''), offset = marked.indexOf('|');
    await step(() => page.keyboard.press('Escape')); await step(() => query().locator('.monaco-editor').getByRole('textbox').focus());
    await step(() => page.keyboard.press(modifier + '+A')); await step(() => page.keyboard.press('Backspace')); await step(() => page.keyboard.insertText(source));
    await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'));
    for (const _point of source.slice(0, offset + 1)) await step(() => page.keyboard.press('ArrowRight'));
    const before = await snapshot(); expect(before.source).toBe(source); expect(before.offset).toBe(offset + 1);
    await step(() => page.keyboard.press('Shift+F12'));
    const peek = query().locator('.peekview-widget.reference-zone-widget');
    await step(() => expect(peek).toBeVisible({ timeout: 13000 }));
    await step(() => expect(query().locator('.suggest-widget.visible')).toHaveCount(0));
    const rows = peek.locator('.ref-tree .monaco-list-row[role="treeitem"][aria-level="1"]');
    await step(() => expect(rows).toHaveCount(count + 1));
    // 行已插入不代表异步预览和初始选择已完成；等待真实可操作的选中行，不插入固定睡眠。
    await step(() => expect(peek.locator('.ref-tree .monaco-list-row[aria-selected="true"]')).toHaveCount(1));
    await info.attach('本文引用列表' + proofs.length, { body: await step(() => page.screenshot()), contentType: 'image/png' });
    // 真正双击最后一个引用，不能只读provider结果或直接调用Monaco命令来替代界面导航。
    await step(() => rows.last().dblclick());
    await step(() => expect(peek).not.toBeVisible());
    await step(() => query().locator('.monaco-editor').getByRole('textbox').focus());
    const target = source.lastIndexOf(marked.includes('WITH |q') ? 'q' : marked.includes('|d') ? 'd.n' : 's.id');
    const after = await snapshot(); expect(after.offset).toBe(target + 1); expect(after.selection).toEqual({ start: target, end: target + 1 });
    expect({ ...after, offset: before.offset, selection: before.selection }).toEqual(before); proofs.push({ before, after, count });
  }
  const workers = await step(() => page.evaluate(() => (window as Window & { __localReferencesWorkers?: WorkerFact[] }).__localReferencesWorkers?.filter(fact => fact.references)));
  expect(workers).toHaveLength(4);
  for (const fact of workers!) expect(fact).toMatchObject({ posted: 1, ready: 1, replied: 1, terminated: 1, status: 'ready' });
  const audit = await step(() => application.evaluate(() => (globalThis as typeof globalThis & { __localReferencesAudit?: { commands: string[]; denied: string[] } }).__localReferencesAudit));
  expect(audit?.denied).toEqual([]); expect(audit?.commands.some(command => /^(?:query|metadata|sessions)\./.test(command))).toBe(false);
  expect(await step(() => page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) })))).toEqual({ tasks: [], history: [] });
  await info.attach('本文引用窗口错误堆栈', { body: JSON.stringify(observedErrors), contentType: 'application/json' });
  expect(runtime.pageErrors).toEqual([]);
  await info.attach('本文引用真实窗口', { body: await step(() => page.screenshot()), contentType: 'image/png' });
  await info.attach('本文引用原件', { body: JSON.stringify({ proofs, workers, audit, directory, pid, platform: process.platform }), contentType: 'application/json' });
  check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check();
  const exit = { pid, exitCode: appProcess.exitCode, signal: appProcess.signalCode, directory, platform: process.platform };
  await info.attach('本文引用正常退出回执', { body: JSON.stringify(exit), contentType: 'application/json' });
  expect(exit.exitCode).toBe(0); expect(exit.signal).toBeNull(); complete = true;
});
