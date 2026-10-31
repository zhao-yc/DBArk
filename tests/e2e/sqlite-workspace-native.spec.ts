import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { queryAnalyzeZh } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { queryDatabaseSwitchZh } from '../../src/renderer/locales/queryDatabaseSwitch.zh-CN';
import { queryTransactionSettingsZh } from '../../src/renderer/locales/queryTransactionSettings.zh-CN';

// 默认及--list只注册一例；此时不加载desktop、NodeSQLite、文件操作或认证帮助器。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_WORKSPACE_NATIVE_TEST === '1';
if (active) {
  const alias = (key: string) => key === 'DBARK_C02_EXECUTABLE_PATH' && !!process.env.DBARK_EXECUTABLE_PATH && process.env[key] === process.env.DBARK_EXECUTABLE_PATH;
  const forbidden = Object.keys(process.env).filter(key => !alias(key) && (/^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$)/.test(key)));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite原生专项只允许Windows/macOS离线临时库、integration=0及无实库/密码/SSH环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite原生专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_WORKSPACE_NATIVE_TEST=1且integration=0，使用独立离线临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const connectionName = 'SQLite原工作区离线验收', quotedTable = '中文"航船🚢';
const precisionSql = 'SELECT exact_int,note,nullable,payload FROM main.subject ORDER BY id;';
const rolledBackSql = "INSERT INTO main.subject VALUES(10,10,'必须回滚',NULL,x'1000');";
const committedSql = "INSERT INTO main.subject VALUES(20,20,'明确提交🚢',NULL,x'00ff');";
const restoredSql = 'SELECT id,note FROM main.subject ORDER BY id;';
let completed: { directory: string; database: string; platform: string; firstPid: number | undefined; secondPid: number | undefined } | undefined;

/** 只在已经进入显式启用的原生用例后加载真实桌面菜单。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> {
  return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args);
}
/** 本例一旦失败即永久停链，原App/profile/数据库交给调用方核对，不自动重跑或清理。 */
test.afterEach(({}, info) => {
  if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite原生验收未完成正常退出闭环，已保留原App/profile/数据库'); }
});

test('SQLite原连接表单、查询精度及事务经真实utility执行，同profile正常重启只恢复草稿', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-workspace-native.sqlite');
  let closed = false, armed = false, stage = '独立磁盘准备';
  /** 每个异步边界都核准确owner、profile、期限及单例配置，不借共享全局旧句柄继续操作。 */
  const check = () => {
    const current = runtime.ownedDesktopResources(info);
    if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite原生验收owner/profile/120秒单例期限变化');
  };
  const audit = () => application.evaluate(() => {
    const state = (globalThis as any).__sqliteWorkspaceNative; state.check();
    return { pending: state.pending as number, denied: state.denied as string[], forks: state.forks as string[], pickerCalls: state.pickerCalls as number, connectionId: state.connectionId as string | undefined, commands: state.commands as string[], executions: state.executions as number };
  });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const query = () => page.locator('.query-tab:visible');
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  /** 键盘是编辑器唯一写入方式，settings只读确认400ms持久化，不调用Monaco模型修改API。 */
  const write = async (sql: string) => {
    const box = query().locator('.monaco-editor').getByRole('textbox'); await step(() => box.focus());
    await step(() => page.keyboard.press(modifier + '+A')); await step(() => page.keyboard.insertText(sql));
    await step(() => expect.poll(async () => { const value = await settings(); return value.tabs.find(tab => tab.id === value.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(sql));
  };
  /** 真实Ctrl/Meta+Enter只发一次，任务中心及原查询busy状态共同确认终态。 */
  const execute = async (sql: string, total: number) => {
    await write(sql); await step(() => page.keyboard.press(modifier + '+Enter'));
    await step(() => expect.poll(async () => (await tasks()).filter(task => task.kind === 'query.execute').length).toBe(total));
    await step(() => expect.poll(async () => (await tasks()).filter(task => task.kind === 'query.execute').map(task => task.status)).toEqual(Array(total).fill('completed')));
    await step(() => expect(query().locator('.tab-status').getByText(zh.query.text018, { exact: true })).toHaveCount(0));
    await step(() => expect(query().locator('.error-box')).toHaveCount(0));
  };
  /** 所有独立观察连接都强制只读，并在返回前关闭同一个准确DatabaseSync。 */
  const disk = () => {
    check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('SQLite观察路径越过本例profile');
    const db = new DatabaseSync(database, { readOnly: true });
    try { return db.prepare('SELECT id,note FROM subject ORDER BY id').all().map(row => ({ id: row.id, note: row.note })); } finally { db.close(); check(); }
  };
  /** 唯一替换点是本例原生文件选择结果；IPC、授权、preload、broker和SQLite执行全部透传原产品。 */
  const arm = (profileId?: string) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalFork = utilityProcess.fork;
    if (!original || windows.length !== 1 || !frame || root.__sqliteWorkspaceNative) throw Error('SQLite专项原Main旁观入口未知');
    const state = { pending: 0, denied: [] as string[], forks: [] as string[], pickerCalls: 0, connectionId: input.profileId, commands: [] as string[], executions: 0, check() {}, restore() {} };
    let pickerRequest = false;
    const deny = (name: string): never => { state.denied.push(name); throw Error('SQLite离线专项拒绝越界请求：' + name); };
    const check = () => { if (root.__sqliteWorkspaceNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || utilityProcess.fork !== fork || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite原Main/文档观察器身份变化或出现越界请求'); };
    const picker = (async (...args: unknown[]) => {
      check(); const options = args.at(-1) as Electron.OpenDialogOptions;
      if (input.profileId || state.pickerCalls || !pickerRequest || !state.connectionId || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker');
      state.pickerCalls++; return { canceled: false, filePaths: [input.database] };
    }) as typeof dialog.showOpenDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => {
      check(); state.forks.push(modulePath);
      if (modulePath.replaceAll('\\', '/').split('/').at(-1) !== 'sqliteWorker.cjs') return deny('非SQLite utilityProcess.fork');
      return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]);
    }) as typeof utilityProcess.fork;
    const allowedSql = new Set(input.sql);
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      const command = String(payload?.command), value = payload?.input;
      if (/clipboard/i.test(command) || command === 'files.path' || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('serverMonitor.')) return deny(command);
      if (command === 'files.choose') {
        if (input.profileId || value?.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId || state.connectionId && state.connectionId !== value.sqliteConnectionId) return deny('SQLite文件用途/连接归属');
        state.connectionId = value.sqliteConnectionId; pickerRequest = true;
      }
      if (command === 'connections.save' || command === 'connections.test') {
        if (value?.dialect !== 'sqlite' || value.id !== state.connectionId || !value.sqlite || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('伪网络连接配置');
      }
      if (command === 'connections.open' && value?.id !== state.connectionId || command.startsWith('metadata.') && value?.connectionId !== state.connectionId || command === 'sessions.open' && value?.connectionId !== state.connectionId) return deny('其它数据库连接');
      if (command.startsWith('query.') && value?.sessionId && !value.sessionId.startsWith('sqlite:')) return deny('非SQLite原查询会话');
      if (command === 'query.execute') { if (!allowedSql.has(value?.sql?.replaceAll('\r\n', '\n'))) return deny('非本例明确SQL'); state.executions++; }
      state.commands.push(command); state.pending++;
      try { const result = await original(event, payload); check(); return result; } finally { state.pending--; if (command === 'files.choose') pickerRequest = false; }
    };
    state.check = check;
    state.restore = () => { check(); if (state.pending) throw Error('SQLite原请求尚未收尾'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; utilityProcess.fork = originalFork; delete root.__sqliteWorkspaceNative; };
    root.__sqliteWorkspaceNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; utilityProcess.fork = fork; check();
  }, { database, profileId, sql: [precisionSql, rolledBackSql, committedSql, restoredSql] }));
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    const db = new DatabaseSync(database);
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE subject(id INTEGER PRIMARY KEY,exact_int INTEGER,note TEXT,nullable TEXT,payload BLOB); CREATE TABLE "中文""航船🚢"(n TEXT); CREATE VIEW subject_view AS SELECT id,note FROM subject;');
      db.exec("INSERT INTO subject VALUES(1,9223372036854775807,'9007199254740993',NULL,x'00ff'),(2,-9223372036854775808,'中文🚢',NULL,x'ff00');");
    } finally { db.close(); }
    // 在原创建句柄关闭后、选择器启动前冻结真实路径；macOS的/var链接不能误判为换文件。
    const canonicalDatabase = realpathSync(database);
    check(); const baselineDisk = disk(); expect(baselineDisk).toEqual([{ id: 1, note: '9007199254740993' }, { id: 2, note: '中文🚢' }]);
    await arm(); armed = true; stage = '原连接表单选择文件与版本探测';
    await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName));
    // 包裹式label还包含option正文；以表单唯一真实select定位，并保留原DOM/可访问性证据。
    const dialect = form.locator('select'); await step(() => expect(dialect).toHaveCount(1)); await step(() => expect(dialect).toBeEnabled());
    await step(async () => info.attach('原数据库类型控件', { body: JSON.stringify({ html: await dialect.evaluate(element => element.outerHTML), accessibility: await dialect.ariaSnapshot() }), contentType: 'application/json' }));
    await step(() => dialect.selectOption('sqlite'));
    await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked());
    await step(() => expect(form.getByLabel(zh.connections.text009, { exact: true })).toHaveCount(0)); await step(() => expect(form.getByLabel(zh.common.user, { exact: true })).toHaveCount(0));
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click());
    await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database)));
    await step(() => form.getByRole('button', { name: zh.connections.text034, exact: true }).click());
    await step(() => expect(form.locator('.success-box')).toContainText(/SQLite\s+\d+\.\d+/));
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]);
    await step(() => form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck());
    await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1);
    const profile = profiles[0]; expect(profile.dialect).toBe('sqlite'); if (profile.dialect !== 'sqlite') throw Error('SQLite原生表单错误保存为网络配置');
    expect(profile.name).toBe(connectionName); expect(profile.sqlite.filePath).toBe(canonicalDatabase); expect(profile.sqlite.readOnly).toBe(false); expect(profile.sqlite.fileToken).toBeUndefined();
    for (const key of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(key);
    const pickerFacts = await step(audit); expect(pickerFacts.pickerCalls).toBe(1); expect(pickerFacts.connectionId).toBe(profile.id); expect(pickerFacts.executions).toBe(0);

    stage = '原左树生成引用转义草稿但不执行';
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: connectionName }).click());
    await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click());
    await step(() => expect(page.locator('.object-row .tree-label').filter({ hasText: 'subject_view' })).toBeVisible());
    // 表双击现在进入只读数据页；生成草稿须明确点击真实树右键菜单，不能借隐藏按钮执行。
    await step(async () => {
      const row = page.locator('.object-row').filter({ has: page.getByRole('button', { name: quotedTable, exact: true }) });
      const item = await (require('./sidebar-menu') as typeof import('./sidebar-menu')).sidebarMenuItem(row, { name: sqliteZh.selectQuery + ' ' + quotedTable, exact: true }, check);
      check(); await item.click(); check();
    });
    await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible());
    const generated = await settings(); expect(generated.tabs).toHaveLength(1); expect(generated.tabs[0].kind).toBe('query');
    expect(generated.tabs[0].sql).toBe('SELECT * FROM "main"."中文""航船🚢" LIMIT 100;'); expect(generated.tabs[0].databaseContext).toEqual({ state: 'known', database: 'main' });
    await step(() => expect(page.locator('.table-tab')).toHaveCount(0)); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]); expect((await step(audit)).executions).toBe(0);
    await step(() => expect(query().getByLabel('当前查询默认库', { exact: true })).toHaveText('main'));
    await step(() => expect(query().locator('.query-context-options')).toHaveCount(0));
    // 展开真实“更多”菜单再检查入口缺失，不能以未展开的portal冒充隐藏成功。
    const triggers = query().locator('.action-menu-trigger:visible');
    for (let index = 0, count = await step(() => triggers.count()); index < count; index++) {
      const trigger = triggers.nth(index); if (await step(() => trigger.isDisabled())) continue;
      await step(() => trigger.click());
      for (const label of [queryAnalyzeZh.open, queryTransactionSettingsZh.open, queryDatabaseSwitchZh.open, zh.query.text014]) await step(() => expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0));
      await step(() => page.keyboard.press('Escape'));
    }

    stage = '原Monaco键盘执行精度及二进制'; await execute(precisionSql, 1);
    const grid = query().getByRole('grid'); await step(() => expect(grid).toBeVisible());
    for (const text of ['9223372036854775807', '-9223372036854775808', '9007199254740993', '中文🚢', '0x00ff', '0xff00']) await step(() => expect(grid.getByText(text, { exact: true })).toBeVisible());
    await step(() => expect(grid.locator('.null-value')).toHaveCount(2)); expect(disk()).toEqual(baselineDisk);
    stage = '可见事务按钮与独立只读观察';
    await step(() => query().getByRole('button', { name: zh.common.transactionBegin, exact: true }).click());
    await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeEnabled());
    await execute(rolledBackSql, 2); expect(disk()).toEqual(baselineDisk);
    await step(() => query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).click());
    await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeDisabled()); expect(disk()).toEqual(baselineDisk);
    stage = '明确自动提交写入及重启前未执行草稿'; await execute(committedSql, 3);
    const committedDisk = [...baselineDisk, { id: 20, note: '明确提交🚢' }]; expect(disk()).toEqual(committedDisk);
    await write(restoredSql); const persisted = await settings(), firstHistory = await history(), firstTasks = await tasks(), firstFacts = await step(audit);
    expect(firstFacts.executions).toBe(3); expect(firstFacts.denied).toEqual([]); expect(firstFacts.forks.length).toBeGreaterThan(0); expect(firstFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(runtime.pageErrors).toEqual([]);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
    await step(() => application.evaluate(() => (globalThis as any).__sqliteWorkspaceNative.restore()), true); armed = false;
    stage = '首owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile严格owned重启'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid);
    await arm(profile.id); armed = true;
    await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible()); expect(await settings()).toEqual(persisted);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(await tasks()).toEqual(firstTasks); expect(await history()).toEqual(firstHistory); expect(disk()).toEqual(committedDisk);
    expect((await step(audit)).executions).toBe(0); await step(() => expect(query().getByRole('grid')).toHaveCount(0));
    stage = '恢复后明确执行SELECT'; await execute(restoredSql, 4);
    await step(() => expect(query().getByRole('grid').getByText('明确提交🚢', { exact: true })).toBeVisible()); expect(disk()).toEqual(committedDisk);
    const secondFacts = await step(audit); expect(secondFacts.executions).toBe(1); expect(secondFacts.pickerCalls).toBe(0); expect(secondFacts.denied).toEqual([]); expect(secondFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(runtime.pageErrors).toEqual([]);
    // 仅成功完成态手动截图，画面只包含本例合成数据；自动trace/screenshot/video始终关闭。
    await step(async () => info.attach('SQLite原工作区完成态', { body: await page.screenshot(), contentType: 'image/png' }));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0));
    await step(() => application.evaluate(() => (globalThis as any).__sqliteWorkspaceNative.restore()), true); armed = false;
    stage = '次owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await info.attach('SQLite原工作区原生事实与边界', { body: JSON.stringify({ platform: process.platform, pickerCalls: firstFacts.pickerCalls, pickerScope: '仅替换本例Main showOpenDialog返回准确临时路径，未验证操作系统原生对话框输入', firstFacts, secondFacts, exactSqlExecutions: 4, generatedSelectNeverExecuted: true, independentReadonlyDiskObserved: true, rollbackPreservedOriginalRows: true, committedInsertReadAfterRestart: true, sameProfileDraftRestoredWithoutExecution: true, firstPid, secondPid: originalProcess.pid, firstExitCode: 0, secondExitCode: originalProcess.exitCode, observationScope: '每次App首窗口就绪后安装观察器至退出前撤销；启动就绪前不冒称已观察fork', automaticTrace: false, automaticScreenshot: false, video: false, systemClipboardOperations: 0, unverified: ['操作系统原生文件对话框输入', '长查询停止与失效会话（core真实子进程单测另验）', '只读连接拒写（core真实磁盘单测另验）', '其它操作系统', '非本轮实际启动产物'] }), contentType: 'application/json' });
    completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    try { await info.attach('SQLite原生失败保留现场', { body: JSON.stringify({ stage, directory, database, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件异常不能覆盖首因或解除原owner保留。 */ }
    throw reason;
  }
});

/** fixture确认两次准确owner退出后才清理本例目录；这里只读确认，绝不自行递归删除。 */
test.afterAll(async ({}, info: TestInfo) => {
  if (!completed) return;
  const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; }
  expect(missing, '正常退出后本例profile与SQLite必须由原strict owner fixture统一清理').toBe(true);
  await info.attach('SQLite原生最终清理事实', { body: JSON.stringify({ ...completed, accepted: true, directoryRemoved: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' });
});
