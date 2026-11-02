import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { queryAnalyzeZh } from '../../src/renderer/locales/queryAnalyze.zh-CN';
import { queryDatabaseSwitchZh } from '../../src/renderer/locales/queryDatabaseSwitch.zh-CN';
import { queryTransactionSettingsZh } from '../../src/renderer/locales/queryTransactionSettings.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultHistoryZh as sortHistoryText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSelectedFilterZh as selectedFilterText } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { queryResultValueOptionsZh as valueText } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { queryResultPresetsZh as presetText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultMemoryZh as memoryText } from '../../src/renderer/locales/queryResultMemory.zh-CN';

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
const precisionSql = "SELECT exact_int,note,nullable,payload,CASE id WHEN 1 THEN 2 ELSE '2' END AS mixed FROM main.subject ORDER BY id;";
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
  const directory = runtime.dataDir, database = join(directory, 'sqlite-workspace-native.sqlite'), snapshotPath = join(directory, 'sqlite-result-types.dbark-result.json');
  const snapshotText = (require('../../src/renderer/locales/queryResultSnapshot.zh-CN') as typeof import('../../src/renderer/locales/queryResultSnapshot.zh-CN')).queryResultSnapshotUiZh;
  let closed = false, armed = false, stage = '独立磁盘准备', savedPresetId = '';
  /** 每个异步边界都核准确owner、profile、期限及单例配置，不借共享全局旧句柄继续操作。 */
  const check = () => {
    const current = runtime.ownedDesktopResources(info);
    if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite原生验收owner/profile/120秒单例期限变化');
  };
  const audit = () => application.evaluate(() => {
    const state = (globalThis as any).__sqliteWorkspaceNative; state.check();
    return { pending: state.pending as number, denied: state.denied as string[], forks: state.forks as string[], pickerCalls: state.pickerCalls as number, connectionId: state.connectionId as string | undefined, commands: state.commands as string[], executions: state.executions as number, snapshots: state.snapshots as { saved: number; opened: number }, resultTypes: state.resultTypes as { codes: string[]; columns: string[]; rowCount: number }[][] };
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
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork;
    if (!original || windows.length !== 1 || !frame || root.__sqliteWorkspaceNative) throw Error('SQLite专项原Main旁观入口未知');
    const state = { pending: 0, denied: [] as string[], forks: [] as string[], pickerCalls: 0, connectionId: input.profileId, commands: [] as string[], executions: 0, snapshots: { saved: 0, opened: 0 }, resultTypes: [] as { codes: string[]; columns: string[]; rowCount: number }[][], check() {}, restore() {} };
    let pickerRequest = false, snapshotRequest: 'open' | 'save' | undefined;
    const deny = (name: string): never => { state.denied.push(name); throw Error('SQLite离线专项拒绝越界请求：' + name); };
    const check = () => { if (root.__sqliteWorkspaceNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite原Main/文档观察器身份变化或出现越界请求'); };
    const picker = (async (...args: unknown[]) => {
      check(); const options = args.at(-1) as Electron.OpenDialogOptions;
      if (snapshotRequest === 'open') {
        if (!input.profileId || state.snapshots.opened || args[0] !== window || options?.title !== '打开结果快照') return deny('非本例快照打开');
        state.snapshots.opened++; return { canceled: false, filePaths: [input.snapshotPath] };
      }
      if (input.profileId || state.pickerCalls || !pickerRequest || !state.connectionId || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker');
      state.pickerCalls++; return { canceled: false, filePaths: [input.database] };
    }) as typeof dialog.showOpenDialog;
    // 仅选择本例准确新文件，真实快照校验、编码、写入及重开均由产品完成。
    const save = (async (...args: unknown[]) => {
      check(); const options = args.at(-1) as Electron.SaveDialogOptions;
      if (input.profileId || snapshotRequest !== 'save' || state.snapshots.saved || args[0] !== window || options?.title !== '保存结果快照') return deny('非本例快照保存');
      state.snapshots.saved++; return { canceled: false, filePath: input.snapshotPath };
    }) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => {
      check(); state.forks.push(modulePath);
      if (modulePath.replaceAll('\\', '/').split('/').at(-1) !== 'sqliteWorker.cjs') return deny('非SQLite utilityProcess.fork');
      return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]);
    }) as typeof utilityProcess.fork;
    const allowedSql = new Set(input.sql);
    const wrapped = async (event: any, payload: any) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      const command = String(payload?.command), value = payload?.input;
      if (command === 'resultSnapshotFiles.save' || command === 'resultSnapshotFiles.open') {
        if (snapshotRequest || command.endsWith('.save') && (input.profileId || state.executions !== 1 || value?.snapshot?.version !== 2) || command.endsWith('.open') && (!input.profileId || state.executions !== 1)) return deny('非本例明确快照操作');
        snapshotRequest = command.endsWith('.save') ? 'save' : 'open';
      }
      if (/clipboard/i.test(command) || command === 'files.path' || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('serverMonitor.')) return deny(command);
      if (command.startsWith('result.presets.') && value?.connectionId !== state.connectionId) return deny('非本例连接整理方案');
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
      try {
        const result = await original(event, payload); check();
        if (command === 'query.execute' && result.ok) state.resultTypes.push(result.result.results.map((item: any) => ({ codes: [...item.sqliteStorage.rows], columns: item.columns.map((column: any) => column.key), rowCount: item.rows.length })));
        return result;
      } finally { state.pending--; if (command === 'files.choose') pickerRequest = false; if (command.startsWith('resultSnapshotFiles.')) snapshotRequest = undefined; }
    };
    state.check = check;
    state.restore = () => { check(); if (state.pending) throw Error('SQLite原请求尚未收尾'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; delete root.__sqliteWorkspaceNative; };
    root.__sqliteWorkspaceNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; check();
  }, { database, snapshotPath, profileId, sql: [precisionSql, rolledBackSql, committedSql, restoredSql] }));
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
      for (const label of [queryAnalyzeZh.open, queryTransactionSettingsZh.open, queryDatabaseSwitchZh.open]) await step(() => expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0));
      await step(() => page.keyboard.press('Escape'));
    }
    // 已接入的计划入口应真实可见；仅打开菜单检查，不执行未授权的计划SQL。
    await step(async () => expect(await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(query(), { name: zh.query.text014, exact: true }, check)).toBeEnabled());
    await step(() => page.keyboard.press('Escape'));

    stage = '原Monaco键盘执行精度及二进制'; await execute(precisionSql, 1);
    const grid = query().getByRole('grid'); await step(() => expect(grid).toBeVisible());
    for (const text of ['9223372036854775807', '-9223372036854775808', '9007199254740993', '中文🚢', '0x00ff', '0xff00']) await step(() => expect(grid.getByText(text, { exact: true })).toBeVisible());
    await step(() => expect(grid.locator('.null-value')).toHaveCount(2)); expect(disk()).toEqual(baselineDisk);
    expect((await step(audit)).resultTypes).toEqual([[{ codes: ['itnbi', 'itnbt'], columns: ['c0', 'c1', 'c2', 'c3', 'c4'], rowCount: 2 }]]);
    stage = '真实列头与独立草稿本地多列排序，原四次SQL预算不变';
    const exactHeader = grid.getByRole('columnheader').filter({ hasText: 'exact_int' }), mixedHeader = grid.getByRole('columnheader').filter({ hasText: 'mixed' }), blobHeader = grid.getByRole('columnheader').filter({ hasText: 'payload' });
    await step(() => expect(exactHeader).toHaveCount(1)); await step(() => expect(mixedHeader).toHaveCount(1)); await step(() => expect(blobHeader).toHaveCount(1));
    const exactPosition = await step(() => exactHeader.getAttribute('aria-colindex')); if (!exactPosition || !/^[1-9][0-9]*$/.test(exactPosition)) throw Error('本例原精确整数列坐标缺失');
    const shownIntegers = () => step(() => grid.locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${exactPosition}"]`).allTextContents());
    const ascending = ['-9223372036854775808', '9223372036854775807'], originalOrder = [...ascending].reverse();
    await step(() => exactHeader.click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(() => mixedHeader.click({ modifiers: [modifier] })); await step(() => expect(query().getByRole('list', { name: sortText.priorities, exact: true }).getByRole('listitem')).toHaveCount(2));
    await step(async () => (await navigationMenuItem(query(), { name: sortText.panelTitle, exact: true }, check)).click());
    const sorting = query().getByRole('region', { name: sortText.panelTitle, exact: true }); await step(() => expect(sorting).toBeVisible());
    await step(() => expect(sorting.getByLabel(sortText.panelField(1), { exact: true })).toHaveValue('c0')); await step(() => expect(sorting.getByLabel(sortText.panelField(2), { exact: true })).toHaveValue('c4'));
    await step(() => sorting.getByRole('button', { name: sortText.panelEarlier(2), exact: true }).click());
    await step(() => sorting.getByLabel(sortText.panelNulls(1), { exact: true }).selectOption('LAST'));
    await step(() => sorting.getByRole('button', { name: sortText.panelApply, exact: true }).click()); await step(() => expect(sorting).toHaveCount(0));
    // 两格均显示2，INTEGER仍排在TEXT之前；优先级来自明确应用的独立草稿。
    await step(() => expect.poll(shownIntegers).toEqual(originalOrder));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.undo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.redo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(originalOrder));
    await step(() => blobHeader.click()); await step(() => expect(blobHeader).toHaveAttribute('aria-sort', 'ascending'));
    await step(() => blobHeader.click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '真实typed结果筛选只改变已返回视图，保原BLOB排序及整理历史';
    const filtering = query().getByRole('region', { name: filterText.title, exact: true });
    /** 原菜单与真实表单共同验证草稿；应用、撤销、清除均不补读数据库。 */
    const openFiltering = async () => { await step(async () => (await navigationMenuItem(query(), { name: filterText.open, exact: true }, check)).click()); await step(() => expect(filtering).toBeVisible()); };
    const applyFiltering = async (expected: string[]) => { await step(() => filtering.getByRole('button', { name: filterText.apply, exact: true }).click()); await step(() => expect(filtering).toHaveCount(0)); await step(() => expect.poll(shownIntegers).toEqual(expected)); await step(() => expect(blobHeader).toHaveAttribute('aria-sort', 'descending')); expect((await step(audit)).executions).toBe(1); };
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c4'));
    await step(() => filtering.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('eq'));
    await step(() => filtering.getByLabel(filterText.input + ' 1', { exact: true }).fill('2'));
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text'));
    await step(() => expect.poll(shownIntegers).toEqual(ascending)); await applyFiltering([ascending[0]]);
    await step(() => expect(query().getByText(filterText.counts(2, 1), { exact: true })).toBeVisible());
    await openFiltering(); await step(() => filtering.getByLabel(filterText.sqliteType(1), { exact: true }).selectOption('integer'));
    await step(() => expect.poll(shownIntegers).toEqual([ascending[0]]));
    // 仅成功草稿态手动截图，画面为本例合成数据；自动trace/video仍关闭。
    await step(async () => info.attach('SQLite结果显式类型筛选草稿', { body: await page.screenshot(), contentType: 'image/png' }));
    await applyFiltering([ascending[1]]);
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.undo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual([ascending[0]]));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.redo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual([ascending[1]]));
    await openFiltering(); await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c3'));
    await step(() => filtering.getByLabel(filterText.sqliteType(1), { exact: true }).selectOption('blob'));
    await step(() => filtering.getByLabel(filterText.input + ' 1', { exact: true }).fill('00ff')); await applyFiltering([ascending[1]]);
    await openFiltering(); await step(() => filtering.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('between'));
    await step(() => filtering.getByLabel(filterText.upper + ' 1', { exact: true }).fill('ff00')); await applyFiltering(ascending);
    await openFiltering(); await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c2'));
    await step(() => filtering.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('null')); await applyFiltering(ascending);
    await openFiltering(); await step(() => filtering.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('notNull')); await applyFiltering([]);
    await step(async () => (await navigationMenuItem(query(), { name: filterText.clear, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(() => expect(query().getByText(filterText.counts(2, 2), { exact: true })).toBeVisible());
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '真实原格与勾选快捷条件保留SQLite存储类型，不增加SQL';
    const mixedPosition = await step(() => mixedHeader.getAttribute('aria-colindex'));
    if (!mixedPosition || !/^[1-9][0-9]*$/.test(mixedPosition)) throw Error('本例混合存储类型列坐标缺失');
    /** 用实际网格定位当前TEXT格；同显示的INTEGER格仍由原逐格代码区分。 */
    const chooseMixed = () => step(() => grid.locator(`[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="${mixedPosition}"]`).click());
    const shortcut = async (name: string) => { await step(async () => (await navigationMenuItem(query(), { name, exact: true }, check)).click()); await step(() => expect(filtering).toBeVisible()); };
    const clearFiltering = async () => { await step(async () => (await navigationMenuItem(query(), { name: filterText.clear, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(ascending)); };
    await chooseMixed(); await shortcut(filterText.cellEquals);
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text'));
    await step(() => expect(filtering.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue('2'));
    await step(() => expect.poll(shownIntegers).toEqual(ascending)); await applyFiltering([ascending[0]]); await clearFiltering();
    await chooseMixed(); await shortcut(filterText.cellNotEquals);
    await step(() => expect(filtering.getByLabel(filterText.groupMode('1'), { exact: true })).toHaveValue('OR'));
    await step(() => expect(filtering.getByLabel(filterText.operator + ' 1', { exact: true })).toHaveValue('ne'));
    await step(() => expect(filtering.getByLabel(filterText.operator + ' 2', { exact: true })).toHaveValue('notType'));
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(2), { exact: true })).toHaveValue('text'));
    await step(() => expect.poll(shownIntegers).toEqual(ascending)); await applyFiltering([ascending[1]]); await clearFiltering();
    for (const index of [2, 3]) await step(() => grid.locator(`[role="row"][aria-rowindex="${index}"]`).getByRole('checkbox').check());
    await chooseMixed(); await shortcut(selectedFilterText.open);
    await step(() => expect(filtering.getByLabel(filterText.groupMode('1'), { exact: true })).toHaveValue('OR'));
    for (const [offset, kind] of ['text', 'integer'].entries()) {
      const index = offset + 1;
      await step(() => expect(filtering.getByLabel(filterText.operator + ' ' + index, { exact: true })).toHaveValue('in'));
      await step(() => expect(filtering.getByLabel(filterText.sqliteType(index), { exact: true })).toHaveValue(kind));
      await step(() => expect(filtering.getByLabel(filterText.member(index, 1), { exact: true })).toHaveValue('2'));
      await step(() => expect(filtering.getByLabel(filterText.member(index, 2), { exact: true })).toHaveCount(0));
    }
    await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(async () => info.attach('SQLite勾选同显示值保留独立类型草稿', { body: await page.screenshot(), contentType: 'image/png' }));
    await applyFiltering(ascending);
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.undo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.redo, exact: true }, check)).click()); await openFiltering();
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text'));
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(2), { exact: true })).toHaveValue('integer'));
    await step(() => filtering.getByRole('button', { name: filterText.cancel, exact: true }).click()); await clearFiltering();
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '真实不同值候选按原全量返回与类型勾选，仍须审阅后应用';
    const picker = filtering.getByRole('region', { name: valueText.title, exact: true });
    /** 候选入口只读原返回范围；即使当前筛选只剩一行，原另一类型仍可选。 */
    const openValues = async () => { await step(() => filtering.getByRole('button', { name: valueText.openCondition(1), exact: true }).click()); await step(() => expect(picker).toBeVisible()); };
    const writeValues = async () => { await step(() => picker.getByRole('button', { name: valueText.apply, exact: true }).click()); await step(() => expect(picker).toHaveCount(0)); expect((await step(audit)).executions).toBe(1); };
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c4')); await openValues();
    await step(() => expect(picker.getByRole('checkbox', { name: valueText.sqliteValue('2', 'integer'), exact: true })).toBeVisible());
    await step(() => picker.getByRole('checkbox', { name: valueText.sqliteValue('2', 'text'), exact: true }).check());
    await step(() => expect.poll(shownIntegers).toEqual(ascending)); await writeValues();
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('text')); await applyFiltering([ascending[0]]);
    await openFiltering(); await openValues();
    await step(() => expect(picker.getByText(valueText.counts(2, 2, 2, 0), { exact: true })).toBeVisible());
    await step(() => picker.getByRole('checkbox', { name: valueText.sqliteValue('2', 'text'), exact: true }).check());
    await step(() => picker.getByLabel(valueText.mode, { exact: true }).selectOption('exclude')); await writeValues();
    await step(() => expect.poll(shownIntegers).toEqual([ascending[0]])); await applyFiltering([ascending[1]]); await clearFiltering();
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c4')); await openValues();
    await step(() => picker.getByRole('checkbox', { name: valueText.sqliteValue('2', 'text'), exact: true }).check());
    await step(() => picker.getByLabel(valueText.search, { exact: true }).fill('INTEGER'));
    await step(() => expect(picker.getByText(valueText.counts(2, 2, 1, 1), { exact: true })).toBeVisible());
    await step(() => picker.getByRole('button', { name: valueText.selectMatches, exact: true }).click());
    await step(() => picker.getByLabel(valueText.search, { exact: true }).fill(''));
    await step(() => expect(picker.getByText(valueText.counts(2, 2, 2, 2), { exact: true })).toBeVisible());
    await step(async () => info.attach('SQLite不同值候选保留同显示值的原类型', { body: await page.screenshot(), contentType: 'image/png' }));
    await writeValues(); await step(() => expect(filtering.getByLabel(filterText.groupMode('1'), { exact: true })).toHaveValue('OR')); await applyFiltering(ascending); await clearFiltering();
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c3')); await openValues();
    await step(() => picker.getByRole('checkbox', { name: valueText.sqliteValue('00ff', 'blob'), exact: true }).check()); await writeValues();
    await step(() => expect(filtering.getByLabel(filterText.sqliteType(1), { exact: true })).toHaveValue('blob')); await applyFiltering([ascending[1]]); await clearFiltering();
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c2')); await openValues();
    await step(() => expect(picker.getByText(valueText.counts(2, 1, 1, 0), { exact: true })).toBeVisible());
    await step(() => picker.getByRole('checkbox', { name: valueText.nullValue, exact: true }).check());
    await step(() => picker.getByLabel(valueText.mode, { exact: true }).selectOption('exclude')); await writeValues(); await applyFiltering([]); await clearFiltering();
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '命名整理方案经原Main保存、重命名和回读，筛选排序一起应用';
    await openFiltering(); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click());
    await step(() => filtering.getByLabel(filterText.column + ' 1', { exact: true }).selectOption('c4'));
    await step(() => filtering.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('eq'));
    await step(() => filtering.getByLabel(filterText.input + ' 1', { exact: true }).fill('2')); await applyFiltering([ascending[0]]);
    await step(async () => (await navigationMenuItem(query(), { name: memoryText.save, exact: true }, check)).click());
    await step(() => expect(query().getByText(memoryText.saved, { exact: true })).toBeVisible());
    const presets = () => page.getByRole('dialog', { name: presetText.title, exact: true });
    const openPresets = async () => { await step(async () => (await navigationMenuItem(query(), { name: presetText.open, exact: true }, check)).click()); await step(() => expect(presets().getByLabel(presetText.choose, { exact: true })).toBeEnabled()); };
    const closePresets = async () => { await step(() => presets().getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(presets()).toHaveCount(0)); };
    await openPresets(); await step(() => presets().getByLabel(presetText.name, { exact: true }).fill('SQLite类型整理'));
    await step(() => presets().getByRole('button', { name: presetText.create, exact: true }).click());
    await step(() => expect(presets().getByRole('button', { name: presetText.apply, exact: true })).toBeEnabled());
    savedPresetId = await step(() => presets().getByLabel(presetText.choose, { exact: true }).inputValue()); if (!/^[a-f0-9-]{36}$/.test(savedPresetId)) throw Error('本例方案未返回准确编号');
    await step(() => expect(presets().getByRole('region', { name: presetText.preview, exact: true })).toContainText(filterText.sqliteTypes.text));
    await step(() => presets().getByLabel(presetText.name, { exact: true }).fill('类型与原排序'));
    await step(() => presets().getByRole('button', { name: presetText.rename, exact: true }).click());
    await step(() => expect(presets().getByRole('option', { name: '类型与原排序', exact: true })).toHaveCount(1));
    await closePresets(); await clearFiltering(); await step(() => exactHeader.click()); await step(() => exactHeader.click());
    await step(() => expect.poll(shownIntegers).toEqual(originalOrder));
    await openPresets(); await step(() => presets().getByLabel(presetText.choose, { exact: true }).selectOption(savedPresetId));
    await step(async () => info.attach('SQLite整理方案原值类型及排序预览', { body: await page.screenshot(), contentType: 'image/png' }));
    await step(() => presets().getByRole('button', { name: presetText.apply, exact: true }).click());
    await step(() => expect(presets()).toHaveCount(0)); await step(() => expect.poll(shownIntegers).toEqual([ascending[0]])); await step(() => expect(blobHeader).toHaveAttribute('aria-sort', 'descending'));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.undo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(originalOrder));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.redo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual([ascending[0]])); await clearFiltering();
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '仅当前标签暂存原类型条件和排序，明确应用并整步撤销重做';
    await step(async () => (await navigationMenuItem(query(), { name: memoryText.apply, exact: true }, check)).click());
    await step(() => expect.poll(shownIntegers).toEqual([ascending[0]])); await step(() => expect(blobHeader).toHaveAttribute('aria-sort', 'descending'));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.undo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual(ascending));
    await step(async () => (await navigationMenuItem(query(), { name: sortHistoryText.redo, exact: true }, check)).click()); await step(() => expect.poll(shownIntegers).toEqual([ascending[0]])); await clearFiltering();
    await step(() => expect(query().getByText(memoryText.saved, { exact: true })).toBeVisible());
    expect((await step(audit)).executions).toBe(1); expect(disk()).toEqual(baselineDisk);
    stage = '原结果菜单真实保存逐格类型快照';
    await step(async () => (await navigationMenuItem(query(), { name: snapshotText.save, exact: true }, check)).click());
    await step(() => expect(query().getByText(snapshotText.saved, { exact: true })).toBeVisible());
    const savedSnapshot = JSON.parse((require('node:fs') as typeof import('node:fs')).readFileSync(snapshotPath, 'utf8'));
    // 独立JSON读取断言wire，不调用产品codec生成预期，确认大整数与字节原文未改变。
    expect(savedSnapshot.version).toBe(2); expect(savedSnapshot.result.sqliteStorage).toEqual({ version: 1, rows: ['itnbi', 'itnbt'] });
    expect(savedSnapshot.result.rows).toEqual([{ c0: '9223372036854775807', c1: '9007199254740993', c2: null, c3: { type: 'binary', base64: 'AP8=' }, c4: '2' }, { c0: '-9223372036854775808', c1: '中文🚢', c2: null, c3: { type: 'binary', base64: '/wA=' }, c4: '2' }]);
    stage = '可见事务按钮与独立只读观察';
    await step(() => query().getByRole('button', { name: zh.common.transactionBegin, exact: true }).click());
    await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeEnabled());
    await execute(rolledBackSql, 2); expect(disk()).toEqual(baselineDisk);
    await step(() => expect(query().getByText(memoryText.saved, { exact: true })).toBeVisible());
    await step(async () => expect(await navigationMenuItem(query(), { name: memoryText.apply, exact: true }, check)).toBeDisabled());
    await step(() => page.keyboard.press('Escape'));
    await step(async () => (await navigationMenuItem(query(), { name: memoryText.clear, exact: true }, check)).click());
    await step(() => expect(query().getByText(memoryText.saved, { exact: true })).toHaveCount(0));
    await step(() => query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).click());
    await step(() => expect(query().getByRole('button', { name: zh.common.transactionRollback, exact: true })).toBeDisabled()); expect(disk()).toEqual(baselineDisk);
    stage = '明确自动提交写入及重启前未执行草稿'; await execute(committedSql, 3);
    const committedDisk = [...baselineDisk, { id: 20, note: '明确提交🚢' }]; expect(disk()).toEqual(committedDisk);
    await write(restoredSql); const persisted = await settings(), firstHistory = await history(), firstTasks = await tasks(), firstFacts = await step(audit);
    expect(firstFacts.executions).toBe(3); expect(firstFacts.denied).toEqual([]); expect(firstFacts.forks.length).toBeGreaterThan(0); expect(firstFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(runtime.pageErrors).toEqual([]);
    // 检查pending与撤观察器放在同一Main同步回合，不能让400ms防抖保存插进两次evaluate之间。
    await step(() => expect.poll(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteWorkspaceNative?: { pending: number; check(): void; restore(): void } }).__sqliteWorkspaceNative; if (!state) throw Error('原SQLite观察器已失效'); state.check(); if (state.pending !== 0) return false; state.restore(); return true; })).toBe(true), true); armed = false;
    stage = '首owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile严格owned重启'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid);
    await arm(profile.id); armed = true;
    await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible()); expect(await settings()).toEqual(persisted);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(await tasks()).toEqual(firstTasks); expect(await history()).toEqual(firstHistory); expect(disk()).toEqual(committedDisk);
    expect((await step(audit)).executions).toBe(0); await step(() => expect(query().getByRole('grid')).toHaveCount(0));
    stage = '恢复后明确执行SELECT'; await execute(restoredSql, 4);
    await step(() => expect(query().getByRole('grid').getByText('明确提交🚢', { exact: true })).toBeVisible()); expect(disk()).toEqual(committedDisk);
    stage = '新owner原结果菜单离线重开版本2快照';
    await step(async () => (await navigationMenuItem(query(), { name: snapshotText.open, exact: true }, check)).click());
    await step(() => expect(query().getByText(snapshotText.opened, { exact: true })).toBeVisible());
    await step(() => expect(query().getByRole('grid').getByText('9223372036854775807', { exact: true })).toBeVisible());
    expect((require('node:fs') as typeof import('node:fs')).readFileSync(snapshotPath, 'utf8')).toBe(JSON.stringify(savedSnapshot) + '\n');
    stage = '新owner从本机持久化方案应用到原类型快照，随后准确删除本例方案';
    await step(async () => (await navigationMenuItem(query(), { name: presetText.open, exact: true }, check)).click());
    const restoredPresets = page.getByRole('dialog', { name: presetText.title, exact: true });
    await step(() => expect(restoredPresets.getByLabel(presetText.choose, { exact: true })).toBeEnabled());
    await step(() => restoredPresets.getByLabel(presetText.choose, { exact: true }).selectOption(savedPresetId));
    await step(() => expect(restoredPresets.getByRole('region', { name: presetText.preview, exact: true })).toContainText(filterText.sqliteTypes.text));
    await step(() => restoredPresets.getByRole('button', { name: presetText.apply, exact: true }).click());
    await step(() => expect(restoredPresets).toHaveCount(0));
    await step(() => expect(query().getByRole('grid').getByText('-9223372036854775808', { exact: true })).toBeVisible());
    await step(() => expect(query().getByRole('grid').getByText('9223372036854775807', { exact: true })).toHaveCount(0));
    await step(async () => (await navigationMenuItem(query(), { name: presetText.open, exact: true }, check)).click());
    await step(() => expect(restoredPresets.getByLabel(presetText.choose, { exact: true })).toBeEnabled());
    await step(() => restoredPresets.getByLabel(presetText.choose, { exact: true }).selectOption(savedPresetId));
    await step(() => restoredPresets.getByRole('button', { name: presetText.remove, exact: true }).click());
    await step(() => expect(restoredPresets.getByText(presetText.empty, { exact: true })).toBeVisible());
    await step(() => restoredPresets.getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(restoredPresets).toHaveCount(0));
    const secondFacts = await step(audit); expect(secondFacts.executions).toBe(1); expect(secondFacts.pickerCalls).toBe(0); expect(secondFacts.denied).toEqual([]); expect(secondFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(runtime.pageErrors).toEqual([]);
    expect(firstFacts.snapshots).toEqual({ saved: 1, opened: 0 }); expect(secondFacts.snapshots).toEqual({ saved: 0, opened: 1 });
    expect(firstFacts.resultTypes).toEqual([[{ codes: ['itnbi', 'itnbt'], columns: ['c0', 'c1', 'c2', 'c3', 'c4'], rowCount: 2 }], [{ codes: [], columns: [], rowCount: 0 }], [{ codes: [], columns: [], rowCount: 0 }]]);
    expect(secondFacts.resultTypes).toEqual([[{ codes: ['it', 'it', 'it'], columns: ['c0', 'c1'], rowCount: 3 }]]);
    // 仅成功完成态手动截图，画面只包含本例合成数据；自动trace/screenshot/video始终关闭。
    await step(async () => info.attach('SQLite原工作区完成态', { body: await page.screenshot(), contentType: 'image/png' }));
    await step(() => expect.poll(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteWorkspaceNative?: { pending: number; check(): void; restore(): void } }).__sqliteWorkspaceNative; if (!state) throw Error('原SQLite观察器已失效'); state.check(); if (state.pending !== 0) return false; state.restore(); return true; })).toBe(true), true); armed = false;
    stage = '次owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await info.attach('SQLite原工作区原生事实与边界', { body: JSON.stringify({ platform: process.platform, pickerCalls: firstFacts.pickerCalls, pickerScope: '仅替换本例Main打开／保存选择器返回准确owned临时路径，未验证操作系统原生对话框输入', firstFacts, secondFacts, exactSqlExecutions: 4, generatedSelectNeverExecuted: true, independentReadonlyDiskObserved: true, rollbackPreservedOriginalRows: true, committedInsertReadAfterRestart: true, sameProfileDraftRestoredWithoutExecution: true, firstPid, secondPid: originalProcess.pid, firstExitCode: 0, secondExitCode: originalProcess.exitCode, observationScope: '每次App首窗口就绪后安装观察器至退出前撤销；启动就绪前不冒称已观察fork', automaticTrace: false, automaticScreenshot: false, video: false, systemClipboardOperations: 0, unverified: ['操作系统原生文件对话框输入', '长查询停止与失效会话（core真实子进程单测另验）', '只读连接拒写（core真实磁盘单测另验）', '其它操作系统', '非本轮实际启动产物'] }), contentType: 'application/json' });
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
