import { navigationMenuItem } from './navigation-menu';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteValueOptionsZh as valuesText } from '../../src/renderer/locales/sqliteValueOptions.zh-CN';
import { createHash } from 'node:crypto';
import { installTableValueOptionsConfirmation, readTableValueOptionsConfirmations } from './table-value-options-native-gate';

// 默认及--list仅注册跳过项；真实桌面、文件和NodeSQLite只在显式专项内部加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_VALUE_FREQUENCY_NATIVE_TEST === '1';
if (active) {
  const alias = (key: string) => key === 'DBARK_C02_EXECUTABLE_PATH' && !!process.env.DBARK_EXECUTABLE_PATH && process.env[key] === process.env.DBARK_EXECUTABLE_PATH;
  const forbidden = Object.keys(process.env).filter(key => !alias(key) && (/^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$)/.test(key)));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite表浏览专项只允许Windows/macOS、integration=0与无实库认证环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite表浏览专项禁止自动trace');
}

type Desktop = typeof import('./desktop-fixture');
type PageFact = { request: Record<string, unknown>; reply: unknown; failure?: string };
interface Audit { frames?: { event: string; at: number; pid?: number; kind?: string; id?: string; code?: number }[]; pending: number; denied: string[]; forks: string[]; pickerCalls: number; connectionId?: string; commands: string[]; lookups: PageFact[]; pages: PageFact[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_VALUE_FREQUENCY_NATIVE_TEST=1且integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const connectionName = 'SQLite次数排序本例', tableName = '次数候选', viewName = '次数候选视图';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 失败始终保留原App、profile与SQLite，不自动重启、强停或清理。 */
test.afterEach(({}, info) => {
  if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite表浏览未完成本次正常退出，原现场已保留'); }
});

test('SQLite完整客户端全组次数排序、丢弃确认、类型筛选与零隐式读取', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-value-frequency-native.sqlite');
  await info.attach('SQLite本例启动所有权', { body: JSON.stringify({ directory, database, pid: originalProcess.pid, platform: process.platform }), contentType: 'application/json' });
  let closed = false, armed = false, stage = '独占合成库准备', reportedStage = '';
  /** 每个异步边界都只承认本例准确owner与120秒单次期限。 */
  const check = () => {
    const current = runtime.ownedDesktopResources(info);
    if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite表浏览owner/profile/单次120秒期限变化');
  };
  const observation = { guardCalls: 0, guardMs: 0, snapshotCalls: 0, snapshotMs: 0 };
  /** 每个界面边界仍执行同一个Main身份检查，不为未消费的门卫调用回传整份增长中的原页历史。 */
  const guard = async () => {
    const started = performance.now(); observation.guardCalls++;
    try { await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: Audit & { check(): void } }).__sqliteTableBrowseNative;
      if (!state) throw Error('原SQLite表浏览观察器不存在'); state.check();
    }); } finally { observation.guardMs += performance.now() - started; }
  };
  /** 所有业务断言与最终原件仍读取完整历史；计时只作回执，不参与通过条件或延长期限。 */
  const audit = async () => {
    const started = performance.now(); observation.snapshotCalls++;
    try { return await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: Audit & { check(): void } }).__sqliteTableBrowseNative;
      if (!state) throw Error('原SQLite表浏览观察器不存在'); state.check();
      return { pending: state.pending, denied: state.denied, forks: state.forks, pickerCalls: state.pickerCalls, connectionId: state.connectionId, commands: state.commands, lookups: state.lookups, pages: state.pages };
    }); } finally { observation.snapshotMs += performance.now() - started; }
  };
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { if (stage !== reportedStage) { reportedStage = stage; console.log('SQLite表页阶段：' + stage); console.log('SQLite观察端口累计：' + JSON.stringify(observation)); } check(); if (armed && !closed) await guard(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await guard(); return result; };
  const table = () => page.locator('.table-tab[aria-label="SQLite 只读表浏览"]:visible');
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  /** 只替换自身文件picker的准确返回值；原IPC、文件授权与SQLite utility全程透传。 */
  const arm = (profileId?: string) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __sqliteTableBrowseNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame, originalPicker = dialog.showOpenDialog, originalFork = utilityProcess.fork;
    if (typeof original !== 'function' || windows.length !== 1 || !frame || root.__sqliteTableBrowseNative) throw Error('SQLite表浏览原Main入口未知');
    const state: State = { pending: 0, denied: [], forks: [], frames: [], pickerCalls: 0, connectionId: input.profileId, commands: [], lookups: [], pages: [], check() {}, restore() {} }; let pickerRequest = false;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite只读表浏览专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteTableBrowseNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || utilityProcess.fork !== fork || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite表浏览原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => {
      check(); const options = args.at(-1) as Electron.OpenDialogOptions;
      if (input.profileId || state.pickerCalls || !pickerRequest || !state.connectionId || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker');
      state.pickerCalls++; return { canceled: false, filePaths: [input.database] };
    }) as typeof dialog.showOpenDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => { check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); const child = Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]);
      // 只观察原utility帧头与退出时点，不接管消息、不记录行值，也不改变ACK或终态门槛。
      const record = (event: string, packet?: unknown, code?: number) => { if (root.__sqliteTableBrowseNative !== state || state.frames!.length >= 5000) return; const value = packet && typeof packet === 'object' ? packet as { kind?: unknown; id?: unknown } : {}; state.frames!.push({ event, at: performance.now(), pid: child.pid, kind: typeof value.kind === 'string' ? value.kind.slice(0, 80) : undefined, id: typeof value.id === 'string' ? value.id.slice(0, 200) : undefined, code }); };
      record('fork'); child.on('message', (message: unknown) => record('message', message)); child.on('exit', (code: number) => record('exit', undefined, code)); return child; }) as typeof utilityProcess.fork;
    // 本机布局只读共用原表页的准确连接/数据库/对象范围，不放宽数据库操作。
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC');
      const command = payload.command, value = payload.input as Record<string, unknown>;
      if (command === 'sqlite.tableLayout.get' && (Object.keys(value).length !== 3 || Object.keys(value).some(key => !['connectionId', 'database', 'table'].includes(key)))) return deny('其它SQLite本机列布局');

      if (/clipboard/i.test(command) || command === 'files.path' || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('serverMonitor.')) return deny(command);
      if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') {
        if (input.profileId || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId || state.connectionId && state.connectionId !== value.sqliteConnectionId) return deny('文件选择用途/连接归属');
        state.connectionId = value.sqliteConnectionId; pickerRequest = true;
      }
      if (command === 'connections.save' || command === 'connections.test') {
        const config = value.sqlite;
        if (value.dialect !== 'sqlite' || value.id !== state.connectionId || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== true || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例只读文件配置');
      }
      if (command === 'connections.open' && value.id !== state.connectionId || command.startsWith('metadata.') && value.connectionId !== state.connectionId) return deny('其它数据库连接');
      if ((command === 'sqlite.tablePage' || command === 'sqlite.valueOptions' || command.startsWith('sqlite.tableLayout.')) && (value.connectionId !== state.connectionId || value.database !== 'main' || !input.objects.includes(String(value.table)))) return deny('其它SQLite表目标');
      if (command.startsWith('sqlite.tablePresets.') && (!['list', 'save', 'delete', 'read'].some(kind => command === 'sqlite.tablePresets.' + kind) || value.connectionId !== state.connectionId || value.database !== 'main' || !input.objects.includes(String(value.table)))) return deny('其它SQLite本机方案目标');
      const page: PageFact | undefined = (command === 'sqlite.tablePage' || command === 'sqlite.valueOptions') ? { request: structuredClone(value), reply: undefined } : undefined;
      if (page) (command === 'sqlite.valueOptions' ? state.lookups : state.pages).push(page);
      state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (page) page.reply = structuredClone(reply); return reply; }
      catch (reason) { if (page) page.failure = reason instanceof Error ? reason.message : String(reason); throw reason; }
      finally { state.pending--; if (command === 'files.choose') pickerRequest = false; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('SQLite表浏览请求仍在途'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; utilityProcess.fork = originalFork; delete root.__sqliteTableBrowseNative; };
    root.__sqliteTableBrowseNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; utilityProcess.fork = fork; check();
  }, { database, profileId, objects: [tableName, viewName] }));
  /** 按真实id列头取得列序号，避开ResultsGrid的勾选列；只滚动可见网格，不读取组件内部数据。 */
  const ids = () => step(async () => {
    const grid = table().getByRole('grid'); await grid.evaluate(element => { element.scrollLeft = 0; }); check();
    const header = grid.getByRole('columnheader').filter({ hasText: /^id/ }); await expect(header).toHaveCount(1); check();
    const column = await header.getAttribute('aria-colindex'); check(); if (!column || !/^[1-9][0-9]*$/.test(column)) throw Error('原id列可访问位置未知');
    return grid.locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${column}"]`).allTextContents();
  });
  const expectIds = (expected: number[]) => step(() => expect.poll(async () => (await ids()).map(value => value.trim())).toEqual(expected.map(String)));
  /** 只读磁盘观察完整类型和字节，不借产品回包生成自己的基线。 */
  const disk = () => { check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('本例数据库越界'); const db = new DatabaseSync(database, { readOnly: true }); try { return db.prepare('SELECT id,typeof(n) AS kind,hex(n) AS bytes FROM "次数候选" ORDER BY id').all(); } finally { db.close(); check(); } };
  const controls = async (open: boolean) => { const visible = await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).isVisible()); if (visible !== open) await step(async () => (await navigationMenuItem(table().locator('.toolbar'), { name: '筛选与排序', exact: true }, check)).click()); };
  const apply = async (expected: number[]) => { const count = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click()); await step(() => expect.poll(async () => { const pages = (await audit()).pages; return pages.length === count + 1 && pages.at(-1)?.reply !== undefined; }).toBe(true)); await controls(false); await expectIds(expected); };
  const modal = () => page.getByRole('dialog', { name: valuesText.title, exact: true });
  /** 只从正式筛选表单打开；选择字段和排序必须保持Main候选任务数。 */
  const open = async () => { await controls(true); const before = (await step(audit)).lookups.length; await step(async () => (await navigationMenuItem(table(), { name: valuesText.entry, exact: true }, check)).click()); await step(() => modal().getByLabel(valuesText.column, { exact: true }).selectOption('n')); expect((await step(audit)).lookups).toHaveLength(before); };
  const read = async () => { const count = (await step(audit)).lookups.length; await step(() => modal().getByRole('button', { name: valuesText.read, exact: true }).click()); await step(() => expect(modal().getByLabel(valuesText.choice(1), { exact: true })).toBeEnabled()); const facts = await step(audit); expect(facts.lookups).toHaveLength(count + 1); const reply = facts.lookups.at(-1)!.reply as { ok?: boolean; result?: { values: { value: { kind: string; value?: string }; count: string }[]; truncated: boolean } }; expect(reply.ok).toBe(true); expect(reply.result).toBeDefined(); return reply.result!; };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    const db = new DatabaseSync(database); try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "次数候选"(id INTEGER PRIMARY KEY,n COLLATE NOCASE); CREATE VIEW "次数候选视图" AS SELECT id,n FROM "次数候选"'); const insert = db.prepare('INSERT INTO "次数候选"(n) VALUES(?)');
      for (let i = 0; i < 520; i++) insert.run('g' + String(i).padStart(4, '0')); for (let i = 0; i < 100; i++) insert.run('zz_hot'); for (let i = 0; i < 9; i++) insert.run('yy_warm');
      for (const value of [null, null, '', 'NULL', 2n, 2n, 2, '2', '2', '2', Buffer.from('00ff', 'hex')]) insert.run(value);
    } finally { db.close(); }
    const baseline = disk(), canonicalDatabase = realpathSync(database); expect(baseline).toHaveLength(640);
    await arm(); armed = true; stage = '真实只读连接及原树表页'; await step(async () => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }); await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName)); await step(() => form.locator('select').selectOption('sqlite')); await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked());
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; if (profile.dialect !== 'sqlite') throw Error('本例不允许网络连接'); expect(profile.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true });
    await step(() => page.locator('.connection-row .tree-label').filter({ hasText: connectionName }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click()); await step(() => page.locator('.object-row .tree-label').filter({ hasText: new RegExp('^' + tableName + '$') }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    await controls(true); await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill('5')); await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel('SQLite 排序 1 字段', { exact: true }).selectOption('id')); await step(() => table().getByLabel('SQLite 排序 1 方向', { exact: true }).selectOption('asc')); await apply([1, 2, 3, 4, 5]);
    stage = '完整529组默认与最多次数'; await open(); const first = await read(); expect(first.values).toHaveLength(500); expect(first.truncated).toBe(true); expect(first.values.some(option => option.value.kind === 'text' && option.value.value === 'zz_hot')).toBe(false);
    await step(() => modal().getByLabel(valuesText.order, { exact: true }).selectOption('count-desc')); expect((await step(audit)).lookups).toHaveLength(1); const most = await read(); expect(most.values.slice(0, 3)).toEqual([{ value: { kind: 'text', value: 'zz_hot' }, count: '100' }, { value: { kind: 'text', value: 'yy_warm' }, count: '9' }, { value: { kind: 'text', value: '2' }, count: '3' }]);
    await step(() => modal().getByLabel(valuesText.choice(1), { exact: true }).check());
    const confirmationOwner = 'dbark-table-value-options:' + createHash('sha256').update(directory).digest('hex').slice(0, 32);
    /** 复用一次性准确message的Main适配器；回答后恢复原函数，不冒充操作系统按钮输入。 */
    const answer = (accepted: boolean) => step(() => application.evaluate(installTableValueOptionsConfirmation, { owner: confirmationOwner, expected: valuesText.discard, choice: accepted ? 'accept' as const : 'reject' as const }));
    await answer(false); await step(() => modal().getByLabel(valuesText.order, { exact: true }).selectOption('count-asc')); await step(() => expect(modal().getByLabel(valuesText.order, { exact: true })).toHaveValue('count-desc')); await step(() => expect(modal().getByLabel(valuesText.choice(1), { exact: true })).toBeChecked()); expect((await step(audit)).lookups).toHaveLength(2);
    await step(async () => info.attach('SQLite次数最多真实窗口', { body: await modal().screenshot(), contentType: 'image/png' }));
    await answer(true); await step(() => modal().getByLabel(valuesText.order, { exact: true }).selectOption('count-asc')); expect((await step(audit)).lookups).toHaveLength(2); await step(() => expect(modal().getByRole('button', { name: valuesText.add, exact: true })).toBeDisabled()); const least = await read(); expect(least.values.slice(0, 2)).toEqual([{ value: { kind: 'blob', value: '00ff' }, count: '1' }, { value: { kind: 'real', value: '2' }, count: '1' }]);
    const beforeAdd = (await step(audit)).pages.length; await step(() => modal().getByLabel(valuesText.choice(2), { exact: true }).check()); await step(() => modal().getByRole('button', { name: valuesText.add, exact: true }).click()); await step(() => expect(modal()).toBeHidden()); expect((await step(audit)).pages).toHaveLength(beforeAdd); await controls(false); await expectIds([1, 2, 3, 4, 5]); await controls(true); await apply([636]);
    expect((await step(audit)).pages.at(-1)?.request.filters).toEqual([{ column: 'n', operator: 'oneOf', selectedValues: [{ kind: 'real', value: '2' }] }]);
    stage = '清原条件再读热门值并明确应用'; await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]); await open(); await step(() => modal().getByLabel(valuesText.order, { exact: true }).selectOption('count-desc')); await read(); await step(() => modal().getByLabel(valuesText.choice(1), { exact: true }).check()); const finalBefore = (await step(audit)).pages.length; await step(() => modal().getByRole('button', { name: valuesText.add, exact: true }).click()); await step(() => expect(modal()).toBeHidden()); expect((await step(audit)).pages).toHaveLength(finalBefore); await apply([521, 522, 523, 524, 525]);
    const confirmationRecords = await step(() => application.evaluate(readTableValueOptionsConfirmations, confirmationOwner)), confirmations = confirmationRecords.map(record => ({ message: record.options.message, accepted: record.choice === 'accept' }));
    expect(confirmations).toEqual([{ message: valuesText.discard, accepted: false }, { message: valuesText.discard, accepted: true }]); expect(confirmationRecords[0].response).toBe(confirmationRecords[0].cancelIndex); expect(confirmationRecords[1].response).toBe(confirmationRecords[1].acceptIndex); const facts = await step(audit); expect(facts.lookups.map(item => item.request.order)).toEqual([undefined, 'count-desc', 'count-asc', 'count-desc']); expect(facts.lookups.every(item => !item.failure && (item.reply as { ok?: boolean }).ok === true)).toBe(true); expect(facts.denied).toEqual([]); expect(facts.pending).toBe(0); expect(facts.pickerCalls).toBe(1); expect(await history()).toEqual([]); expect(runtime.pageErrors).toEqual([]); expect(disk()).toEqual(baseline);
    const allTasks = await tasks(); expect(allTasks.filter(task => task.kind === 'sqlite.valueOptions')).toHaveLength(4); expect(allTasks.every(task => ['sqlite.tablePage', 'sqlite.valueOptions'].includes(task.kind) && task.status === 'completed')).toBe(true);
    await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: { restore(): void } }).__sqliteTableBrowseNative; if (!state) throw Error('原Main观察器已失效'); state.restore(); }), true); armed = false; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(baseline);
    await info.attach('SQLite次数排序完整窗口终态', { body: JSON.stringify({ database, directory, pid: originalProcess.pid, platform: process.platform, sourceRows: 640, groups: 529, returnedGroups: 500, explicitReads: 4, confirmations, confirmationRecords, systemConfirmationInputVerified: false, sourceUnchanged: true, rawMainFacts: facts, userQueries: 0, systemClipboard: 0, originalExitCode: originalProcess.exitCode, normalExit: true, systemPickerInputVerified: false, installerVerified: false, macOSVerified: false }), contentType: 'application/json' });
    completed = { directory, database, platform: process.platform, firstPid: originalProcess.pid };
  } catch (reason) { runtime.retainOwnedDesktopResources(info); throw reason; }
});
