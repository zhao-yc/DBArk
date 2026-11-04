import { navigationMenuItem } from './navigation-menu';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableBrowseZh as browseText } from '../../src/renderer/locales/sqliteTableBrowse.zh-CN';
import { sqliteTablePresetsZh as presetText } from '../../src/renderer/locales/sqliteTablePresets.zh-CN';
import { sqliteTableLayoutZh as layoutText } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { sqliteValueOptionsZh as valuesText } from '../../src/renderer/locales/sqliteValueOptions.zh-CN';
import { tableGridZh as layoutFields } from '../../src/renderer/locales/tableGrid.zh-CN';
import { gridColumnWidthBatchZh as batchText } from '../../src/renderer/locales/gridColumnWidthBatch.zh-CN';
import { queryRowDetailsZh as detailText } from '../../src/renderer/locales/queryRowDetails.zh-CN';

// 默认及--list仅注册跳过项；真实桌面、文件和NodeSQLite只在显式专项内部加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_TABLE_BROWSE_NATIVE_TEST === '1';
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
test.skip(!active, '默认关闭：须DBARK_SQLITE_TABLE_BROWSE_NATIVE_TEST=1且integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const connectionName = 'SQLite只读表浏览本例', tableName = '浏览"航船🚢', viewName = '末五行视图';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 失败始终保留原App、profile与SQLite，不自动重启、强停或清理。 */
test.afterEach(({}, info) => {
  if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite表浏览未完成两次正常退出，原现场已保留'); }
});

test('SQLite原树只读表页真实分页、类型筛选及多列排序，正常重启恢复表标签且零用户SQL', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-table-browse-native.sqlite');
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
  const rows = Array.from({ length: 34 }, (_, index) => { const id = index + 1; return { id, bucket: id % 3 === 0 ? 'A' : 'B', rank: id % 4, note: '行' + String(id).padStart(2, '0') + '中文🚢', mixed: id <= 2 ? '2' : String(id), mixedType: id === 2 ? 'text' : 'integer', nullable: id % 2 ? null : '存在' + id, payload: id === 1 ? '00ff' : id === 2 ? 'ff00' : Buffer.from([id, 255 - id]).toString('hex'), exact: id === 1 ? '9223372036854775807' : '-9223372036854775808' }; });
  /** 全量独立磁盘观察强制只读，数字转文本避免观察器自身损失64位精度。 */
  const disk = () => {
    check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('SQLite观察越过本例目录');
    const db = new DatabaseSync(database, { readOnly: true });
    try { return db.prepare('SELECT CAST(id AS TEXT) AS id,bucket,CAST(rank_num AS TEXT) AS rank_num,note,typeof(mixed) AS mixed_type,CAST(mixed AS TEXT) AS mixed_text,nullable,lower(hex(payload)) AS payload,CAST(exact_int AS TEXT) AS exact_int FROM "浏览""航船🚢" ORDER BY "浏览""航船🚢".id').all(); } finally { db.close(); check(); }
  };
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
  const expectedSort = (sorts: { key: 'id' | 'bucket' | 'rank'; direction: 'asc' | 'desc' }[]) => [...rows].sort((a, b) => { for (const sort of sorts) { const compared = sort.key === 'bucket' ? a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0 : a[sort.key] - b[sort.key]; if (compared) return sort.direction === 'asc' ? compared : -compared; } return 0; }).slice(0, 5).map(row => row.id);
  /** 原IPC回执逐层核形状后才计数，不能用合成期望替代服务端实际回包。 */
  const pageRows = (reply: unknown): unknown[] => {
    if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true || !('result' in reply)) throw Error('SQLite表浏览没有成功原IPC回执');
    const page = reply.result; if (!page || typeof page !== 'object' || !('result' in page)) throw Error('SQLite表浏览缺少原Page');
    const result = page.result; if (!result || typeof result !== 'object' || !('rows' in result) || !Array.isArray(result.rows)) throw Error('SQLite表浏览缺少原始行');
    return result.rows;
  };
  /** 展开/收起都点击真实产品入口，收起后给网格足够空间展示完整五行。 */
  const controls = async (open: boolean) => { const visible = await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).isVisible()); if (visible !== open) await step(async () => (await navigationMenuItem(table().locator('.toolbar'), { name: '筛选与排序', exact: true }, check)).click()); };
  const apply = async (expected: number[]) => {
    const before = (await step(audit)).pages.length;
    await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click());
    await step(() => expect.poll(async () => (await audit()).pages.length).toBe(before + 1)); await controls(false); await expectIds(expected);
  };
  const filter = async (index: number, column: string, operator: string, kind?: string, value?: string) => {
    const before = (await step(audit)).pages.length;
    await step(() => table().getByLabel(`SQLite 筛选 ${index} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 筛选 ${index} 运算符`, { exact: true }).selectOption(operator));
    if (kind !== undefined) await step(() => table().getByLabel(`SQLite 筛选 ${index} 值类型`, { exact: true }).selectOption(kind));
    if (value !== undefined) await step(() => table().getByLabel(`SQLite 筛选 ${index} 条件值`, { exact: true }).fill(value));
    expect((await step(audit)).pages.length).toBe(before);
  };
  type HeaderSort = { column: 'id' | 'bucket' | 'rank_num' | 'nullable' | 'exact_int'; direction: 'asc' | 'desc' };
  /** 独立只读SQLite求准确排序期望，BIGINT/NULL不经Number或客户端比较器。 */
  const nativeIds = (sort: HeaderSort[], offset = 0, limit = 5): number[] => {
    check(); const columns = new Set(['id', 'bucket', 'rank_num', 'nullable', 'exact_int']); if (!sort.length || sort.some(rule => !columns.has(rule.column) || !['asc', 'desc'].includes(rule.direction))) throw Error('本例排序观察越界');
    const db = new DatabaseSync(database, { readOnly: true }); try { return db.prepare('SELECT id FROM "浏览""航船🚢" ORDER BY ' + sort.map(rule => '"' + rule.column + '" ' + rule.direction.toUpperCase()).join(',') + ' LIMIT ? OFFSET ?').all(limit, offset).map(row => Number(row.id)); } finally { db.close(); check(); }
  };
  /** 点真实可见列头一次，只接纳一份服务端请求；Ctrl/Meta沿RDG原生多列操作。 */
  const headerSort = async (column: HeaderSort['column'], sort: HeaderSort[], expected?: number[], multi = false) => {
    await controls(false); const grid = table().getByRole('grid'), position = ['id', 'bucket', 'rank_num', 'note', 'mixed', 'nullable', 'payload', 'exact_int'].indexOf(column);
    await step(() => (require('./sqlite-grid-navigation') as typeof import('./sqlite-grid-navigation')).revealSqliteEditColumn(page, grid, position, check));
    const header = grid.getByRole('columnheader').filter({ hasText: new RegExp('^' + column) }); await step(() => expect(header).toHaveCount(1)); const before = (await step(audit)).pages.length;
    await step(() => header.click({ modifiers: multi ? [process.platform === 'darwin' ? 'Meta' : 'Control'] : [] }));
    await step(() => expect.poll(async () => { const pages = (await audit()).pages; return pages.length === before + 1 && pages.at(-1)?.reply !== undefined; }).toBe(true));
    const fact = (await step(audit)).pages.at(-1)!; expect(fact.failure).toBeUndefined(); expect(fact.request).toMatchObject({ table: tableName, offset: 0, limit: 5, mode: 'and', filters: [] }); expect(fact.request.sort).toEqual(sort); pageRows(fact.reply); await step(() => expect(grid).toBeVisible()); if (expected) await expectIds(expected); return fact;
  };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    const db = new DatabaseSync(database);
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "浏览""航船🚢"(id INTEGER PRIMARY KEY,bucket TEXT,rank_num INTEGER,note TEXT,mixed,nullable TEXT,payload BLOB,exact_int INTEGER); CREATE VIEW "末五行视图" AS SELECT * FROM "浏览""航船🚢" WHERE id>=30 ORDER BY id;');
      const insert = db.prepare('INSERT INTO "浏览""航船🚢" VALUES(?,?,?,?,?,?,?,?)');
      // 无亲和性列必须绑定BigInt才会真实存为INTEGER；Number会被Node原生绑定为REAL。
      for (const row of rows) insert.run(row.id, row.bucket, row.rank, row.note, row.mixedType === 'text' ? row.mixed : BigInt(row.mixed), row.nullable, Buffer.from(row.payload, 'hex'), BigInt(row.exact));
    } finally { db.close(); }
    // 预期在原创建句柄关闭后且picker启动前取得；chooser仍只返回本例原join路径。
    const canonicalDatabase = realpathSync(database);
    const baseline = rows.map(row => ({ id: String(row.id), bucket: row.bucket, rank_num: String(row.rank), note: row.note, mixed_type: row.mixedType, mixed_text: row.mixed, nullable: row.nullable, payload: row.payload, exact_int: row.exact })); expect(disk()).toEqual(baseline);
    await arm(); armed = true; stage = '真实只读表单保存';
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName)); const dialect = form.locator('select'); await step(() => expect(dialect).toHaveCount(1)); await step(() => dialect.selectOption('sqlite'));
    await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked()); await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click());
    await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; if (profile.dialect !== 'sqlite') throw Error('表浏览表单错误保存为网络连接');
    expect(profile.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true }); expect(profile.sqlite.fileToken).toBeUndefined();
    for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(field);
    stage = '原树双击打开只读数据页'; await step(() => page.locator('.connection-row .tree-label').filter({ hasText: connectionName }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click());
    await step(() => page.locator('.object-row .tree-label').filter({ hasText: tableName }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    await step(() => expect.poll(async () => (await audit()).pages.length).toBe(1)); expect((await settings()).tabs).toHaveLength(1); expect((await settings()).tabs[0]).toMatchObject({ kind: 'table', connectionId: profile.id, database: 'main', table: tableName });
    const firstPage = (await step(audit)).pages[0]; expect(firstPage.request).toMatchObject({ table: tableName, offset: 0, limit: 100 }); expect(firstPage.reply).toMatchObject({ ok: true, result: { target: { kind: 'table', table: tableName }, hasMore: false } }); expect(pageRows(firstPage.reply)).toHaveLength(34);
    await controls(true); await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill('5'));
    // 分页断言由明确唯一id排序保证，不把未指定排序的扫描顺序当作跨版本合同。
    await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel('SQLite 排序 1 字段', { exact: true }).selectOption('id')); await step(() => table().getByLabel('SQLite 排序 1 方向', { exact: true }).selectOption('asc')); await apply([1, 2, 3, 4, 5]);
    stage = '只读当前页行详情复用原值并区分动态类型';
    const details = () => table().getByRole('region', { name: detailText.sqlitePage, exact: true });
    const detailField = (name: string) => details().locator('article').filter({ has: page.locator('h4', { hasText: name }) });
    /** 经虚拟网格选格和真实更多菜单打开，行详情只读取已加载页。 */
    const openDetail = async () => {
      await step(() => table().getByRole('grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').first().click());
      await step(async () => (await navigationMenuItem(table().locator('.toolbar'), { name: detailText.open, exact: true }, check)).click());
      await step(() => expect(details()).toBeVisible());
    };
    const beforeDetails = await step(audit);
    await openDetail();
    await step(() => expect(details().getByRole('button', { name: detailText.previous, exact: true })).toBeDisabled());
    await step(() => expect(detailField('mixed').locator('small')).toHaveText('INTEGER'));
    await step(() => expect(detailField('mixed').locator('pre')).toHaveText('2'));
    await step(() => expect(detailField('exact_int').locator('pre')).toHaveText('9223372036854775807'));
    await step(() => expect(detailField('nullable').locator('pre')).toHaveText(detailText.null));
    await step(() => expect(detailField('payload').locator('small')).toHaveText('BLOB'));
    await step(() => expect(detailField('payload').locator('pre')).toHaveText('AP8='));
    const fieldSearch = () => details().getByRole('searchbox', { name: detailText.fieldSearch, exact: true });
    await step(() => fieldSearch().fill('MIXED'));
    await step(() => expect(details().locator('article')).toHaveCount(1));
    await step(() => details().getByRole('button', { name: detailText.next, exact: true }).click());
    await step(() => expect(fieldSearch()).toHaveValue('MIXED'));
    await step(() => expect(detailField('mixed').locator('small')).toHaveText('TEXT'));
    await step(() => expect(detailField('mixed').locator('pre')).toHaveText('2'));
    await step(() => fieldSearch().fill('不存在'));
    await step(() => expect(details().getByRole('status')).toHaveText(detailText.noFields));
    await step(() => details().getByRole('button', { name: detailText.clearFieldSearch, exact: true }).click());
    await step(() => details().getByLabel(detailText.sqliteRow, { exact: true }).fill('5'));
    await step(() => details().getByRole('button', { name: detailText.go, exact: true }).click());
    await step(() => expect(detailField('note').locator('pre')).toHaveText(rows[4].note));
    await step(() => expect(details().getByRole('button', { name: detailText.next, exact: true })).toBeDisabled());
    const afterDetails = await step(audit);
    expect(afterDetails.pages).toEqual(beforeDetails.pages); expect(afterDetails.forks).toEqual(beforeDetails.forks); expect(disk()).toEqual(baseline);
    stage = '只读真实列头即时排序、分页沿服务端全表且ASC/DESC/移除循环';
    await headerSort('id', [{ column: 'id', direction: 'desc' }], [34, 33, 32, 31, 30]);
    await step(() => expect(details()).toHaveCount(0));
    const headerNext = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: 'SQLite 下一页', exact: true }).click()); await step(() => expect.poll(async () => { const pages = (await audit()).pages; return pages.length === headerNext + 1 && pages.at(-1)?.reply !== undefined; }).toBe(true)); await expectIds([29, 28, 27, 26, 25]); expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 5, limit: 5, sort: [{ column: 'id', direction: 'desc' }] });
    await headerSort('id', []); await headerSort('id', [{ column: 'id', direction: 'asc' }], [1, 2, 3, 4, 5]);
    stage = 'Ctrl或Meta追加优先级，精确BIGINT与NULL排序交真实SQLite并同步排序表单';
    await headerSort('exact_int', [{ column: 'exact_int', direction: 'asc' }]);
    const preciseAscending: HeaderSort[] = [{ column: 'exact_int', direction: 'asc' }, { column: 'id', direction: 'asc' }]; await headerSort('id', preciseAscending, nativeIds(preciseAscending), true);
    await controls(true); await step(() => expect(table().getByLabel('SQLite 排序 1 字段', { exact: true })).toHaveValue('exact_int')); await step(() => expect(table().getByLabel('SQLite 排序 2 字段', { exact: true })).toHaveValue('id')); await controls(false);
    const preciseDescending: HeaderSort[] = [{ column: 'exact_int', direction: 'desc' }, { column: 'id', direction: 'asc' }]; await headerSort('exact_int', preciseDescending, nativeIds(preciseDescending), true); await step(() => table().getByRole('grid').evaluate(element => { element.scrollLeft = element.scrollWidth; })); await step(() => expect(table().getByRole('grid').getByText('9223372036854775807', { exact: true })).toBeVisible());
    await headerSort('exact_int', [{ column: 'id', direction: 'asc' }], [1, 2, 3, 4, 5], true);
    await headerSort('nullable', [{ column: 'nullable', direction: 'asc' }]); const nullsAscending: HeaderSort[] = [{ column: 'nullable', direction: 'asc' }, { column: 'id', direction: 'asc' }]; await headerSort('id', nullsAscending, nativeIds(nullsAscending), true);
    const nullsDescending: HeaderSort[] = [{ column: 'nullable', direction: 'desc' }, { column: 'id', direction: 'asc' }]; await headerSort('nullable', nullsDescending, nativeIds(nullsDescending), true); await headerSort('nullable', [{ column: 'id', direction: 'asc' }], [1, 2, 3, 4, 5], true);
    stage = '未应用filter/mode/limit保持草稿，列头只沿applied，明确Apply后才生效';
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'id', 'gte', 'integer', '30'); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('or')); await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill('3')); await controls(false);
    await headerSort('id', [{ column: 'id', direction: 'desc' }], [34, 33, 32, 31, 30]); await controls(true); await step(() => expect(table().getByLabel('SQLite 筛选 1 条件值', { exact: true })).toHaveValue('30')); await step(() => expect(table().getByLabel('SQLite 筛选关系', { exact: true })).toHaveValue('or')); await step(() => expect(table().getByLabel('SQLite 每页条数', { exact: true })).toHaveValue('3')); await step(() => expect(table().getByLabel('SQLite 排序 1 方向', { exact: true })).toHaveValue('desc')); await apply([34, 33, 32]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, limit: 3, mode: 'or', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '30' } }], sort: [{ column: 'id', direction: 'desc' }] });
    const draftNext = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: 'SQLite 下一页', exact: true }).click()); await step(() => expect.poll(async () => { const pages = (await audit()).pages; return pages.length === draftNext + 1 && pages.at(-1)?.reply !== undefined; }).toBe(true)); await expectIds([31, 30]); expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 3, limit: 3, mode: 'or' });
    stage = '按页码跳转沿已应用配置，非法页码零读取，空页可回首页';
    await controls(true); await step(() => table().getByLabel(browseText.limit, { exact: true }).fill('7')); await controls(false);
    const jumpInput = () => table().getByLabel(browseText.pageJumpLabel, { exact: true });
    const jumpButton = () => table().getByRole('button', { name: browseText.pageJump, exact: true });
    const beforeJump = (await step(audit)).pages.length;
    await step(() => expect(jumpInput()).toHaveValue('2'));
    await step(() => jumpInput().fill('1e2')); await step(() => jumpButton().click());
    await step(() => expect(table().getByText(/页码必须是/)).toBeVisible()); expect((await step(audit)).pages.length).toBe(beforeJump);
    await step(() => jumpInput().fill('2')); await step(() => jumpInput().press('Enter')); expect((await step(audit)).pages.length).toBe(beforeJump);
    await step(() => jumpInput().fill('1')); await step(() => jumpInput().press('Enter')); await expectIds([34, 33, 32]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, limit: 3, mode: 'or', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '30' } }], sort: [{ column: 'id', direction: 'desc' }] });
    await step(() => jumpInput().fill('3')); await step(() => jumpButton().click());
    await step(() => expect(table().locator('.tab-status')).toContainText('行偏移 6 · 本页 0 行'));
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 6, limit: 3 });
    await step(() => table().getByRole('button', { name: browseText.first, exact: true }).click()); await expectIds([34, 33, 32]);
    await step(() => expect(jumpInput()).toHaveValue('1'));
    const beforeLast = (await step(audit)).pages.length;
    await step(() => table().getByRole('button', { name: browseText.last, exact: true }).click()); await expectIds([31, 30]);
    await step(() => expect(jumpInput()).toHaveValue('2'));
    await step(() => expect(table().getByText(browseText.lastCount('5'), { exact: true })).toBeVisible());
    const lastAudit = await step(audit); expect(lastAudit.pages).toHaveLength(beforeLast + 1);
    expect(lastAudit.pages.at(-1)?.request).toMatchObject({ offset: 0, limit: 3, lastPage: true, mode: 'or', sort: [{ column: 'id', direction: 'desc' }] });
    expect(lastAudit.pages.at(-1)?.reply).toMatchObject({ ok: true, result: { offset: 3, limit: 3, matchingRows: '5', hasMore: false } });
    stage = '底栏页长独立应用，返回首页并保留未应用的筛选表单';
    await controls(true); await filter(1, 'id', 'gte', 'integer', '33'); await controls(false);
    const sizeInput = () => table().getByLabel(browseText.pageSizeLabel, { exact: true });
    const sizeApply = () => table().getByRole('button', { name: browseText.pageSizeApply, exact: true });
    await step(() => expect(sizeInput()).toHaveValue('3'));
    await step(() => sizeInput().fill('1001')); await step(() => sizeApply().click());
    await step(() => expect(table().getByText(/每页行数必须是/)).toBeVisible());
    await step(() => sizeInput().fill('03')); await step(() => sizeInput().press('Enter'));
    await step(() => expect(sizeInput()).toHaveValue('3'));
    expect((await step(audit)).pages).toHaveLength(lastAudit.pages.length);
    await step(() => sizeInput().fill('4')); await step(() => sizeApply().click()); await expectIds([34, 33, 32, 31]);
    await step(() => expect(jumpInput()).toHaveValue('1'));
    const resized = await step(audit);
    expect(resized.pages).toHaveLength(lastAudit.pages.length + 1);
    expect(resized.pages.at(-1)?.request).toMatchObject({ offset: 0, limit: 4, mode: 'or', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '30' } }], sort: [{ column: 'id', direction: 'desc' }] });
    await controls(true);
    await step(() => expect(table().getByLabel('SQLite 筛选 1 条件值', { exact: true })).toHaveValue('33'));
    await step(() => expect(table().getByLabel(browseText.limit, { exact: true })).toHaveValue('7'));
    await controls(false);
    // 回原明确已应用状态，原分页、typed筛选和排序表单回归全部继续执行。
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('and')); await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill('5')); await step(() => table().getByLabel('SQLite 排序 1 方向', { exact: true }).selectOption('asc')); await apply([1, 2, 3, 4, 5]);
    // 右侧原列通过真实水平滚动显露，不能以虚拟网格尚未挂载的单元格冒称可见。
    await step(() => table().getByRole('grid').evaluate(element => { element.scrollLeft = element.scrollWidth; }));
    await step(() => expect(table().getByRole('grid').getByText('9223372036854775807', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').getByText('0x00ff', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').getByText('0xff00', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').locator('.null-value')).toHaveCount(3));
    const nextCount = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: 'SQLite 下一页', exact: true }).click()); await step(() => expect.poll(async () => (await audit()).pages.length).toBe(nextCount + 1)); await expectIds([6, 7, 8, 9, 10]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 5, limit: 5, table: tableName }); await step(() => table().getByRole('button', { name: 'SQLite 首页', exact: true }).click()); await expectIds([1, 2, 3, 4, 5]);
    stage = '只读原格TEXT、BLOB和NULL筛选草稿，明确应用前零读取';
    /** 由当前真实表头确定原格位置，鼠标选格后只走已实现菜单。 */
    const cellFilter = async (rowIndex: number, name: string, exclude: boolean) => {
      const before = (await step(audit)).pages.length, grid = table().getByRole('grid');
      await step(() => grid.evaluate(element => { element.scrollLeft = element.scrollWidth; }));
      const header = grid.getByRole('columnheader').filter({ hasText: new RegExp('^' + name) });
      const position = await step(() => header.getAttribute('aria-colindex')); if (!position) throw Error('筛选原格列位置未知');
      await step(() => grid.locator('[role="row"][aria-rowindex="' + (rowIndex + 2) + '"] [role="gridcell"][aria-colindex="' + position + '"]').click());
      await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(table(), { name: exclude ? '不等于当前单元格' : '等于当前单元格', exact: true }, check)).click());
      expect((await step(audit)).pages.length).toBe(before);
    };
    await cellFilter(1, 'mixed', false); await step(() => expect(table().getByLabel('SQLite 筛选 1 值类型', { exact: true })).toHaveValue('text')); await step(() => expect(table().getByLabel('SQLite 筛选 1 条件值', { exact: true })).toHaveValue('2')); await apply([2]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    await cellFilter(0, 'payload', false); await step(() => expect(table().getByLabel('SQLite 筛选 1 值类型', { exact: true })).toHaveValue('blob')); await step(() => expect(table().getByLabel('SQLite 筛选 1 条件值', { exact: true })).toHaveValue('00ff')); await apply([1]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    await cellFilter(0, 'nullable', true); await step(() => expect(table().getByLabel('SQLite 筛选 1 运算符', { exact: true })).toHaveValue('notNull')); await apply([2, 4, 6, 8, 10]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    stage = '勾选两行后按当前列加入原类型集合，未应用时零读取';
    for (const exclude of [false, true]) {
      const grid = table().getByRole('grid'), beforeChecked = (await step(audit)).pages.length;
      await step(() => grid.evaluate(element => { element.scrollLeft = 0; }));
      for (const rowIndex of [2, 3]) await step(() => grid.locator('[role="row"][aria-rowindex="' + rowIndex + '"]').getByRole('checkbox').check());
      await step(() => grid.evaluate(element => { element.scrollLeft = element.scrollWidth; }));
      const position = await step(() => grid.getByRole('columnheader').filter({ hasText: /^mixed/ }).getAttribute('aria-colindex'));
      if (!position) throw Error('勾选值筛选原列位置未知');
      await step(() => grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="' + position + '"]').click());
      await step(async () => (await navigationMenuItem(table(), { name: exclude ? '排除勾选行的当前列值' : '包含勾选行的当前列值', exact: true }, check)).click());
      expect((await step(audit)).pages.length).toBe(beforeChecked);
      await step(() => expect(table().getByLabel('SQLite 筛选 1 运算符', { exact: true })).toHaveValue(exclude ? 'notOneOf' : 'oneOf'));
      await apply(exclude ? [3, 4, 5, 6, 7] : [1, 2]);
      expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ filters: [{ column: 'mixed', operator: exclude ? 'notOneOf' : 'oneOf', selectedValues: [{ kind: 'integer', value: '2' }, { kind: 'text', value: '2' }] }] });
      await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    }
    stage = '只读范围包含两端、逆序不交换、NOT BETWEEN与停用，坏边界零读取';
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'id', 'between', 'integer', '30');
    const invalidRangePages = (await step(audit)).pages.length;
    await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click()); expect((await step(audit)).pages.length).toBe(invalidRangePages);
    // 报错表单占据视口时，RDG仅挂载可见行；沿原导航收起表单再核原五行，随后恢复草稿。
    await controls(false); await expectIds([1, 2, 3, 4, 5]); await controls(true); expect((await step(audit)).pages.length).toBe(invalidRangePages);
    await step(() => table().getByLabel('SQLite 筛选 1 结束值', { exact: true }).fill('32')); await apply([30, 31, 32]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, filters: [{ column: 'id', operator: 'between', value: { kind: 'integer', value: '30' }, secondValue: { kind: 'integer', value: '32' } }] });
    await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 运算符', { exact: true }).selectOption('notBetween')); await apply([1, 2, 3, 4, 5]);
    await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 运算符', { exact: true }).selectOption('between')); await step(() => table().getByLabel('SQLite 筛选 1 条件值', { exact: true }).fill('32')); await step(() => table().getByLabel('SQLite 筛选 1 结束值', { exact: true }).fill('30')); await apply([]);
    await controls(true); await step(() => table().getByLabel('启用 SQLite 筛选 1', { exact: true }).uncheck()); await apply([1, 2, 3, 4, 5]);
    await controls(true); await step(() => expect(table().getByLabel('SQLite 筛选 1 结束值', { exact: true })).toHaveValue('30')); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    stage = '只读IN/NOT IN列表保真实类型与BLOB字节，编辑列表零读取';
    await controls(true); const listBefore = (await step(audit)).pages.length;
    await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'mixed', 'in', 'integer', '2');
    await step(() => table().getByRole('button', { name: '添加 SQLite 筛选 1 列表值', exact: true }).click()); await step(() => table().getByLabel('SQLite 筛选 1 列表值 2', { exact: true }).fill('30')); expect((await step(audit)).pages.length).toBe(listBefore); await apply([1, 30]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, filters: [{ column: 'mixed', operator: 'in', values: [{ kind: 'integer', value: '2' }, { kind: 'integer', value: '30' }] }] });
    await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('text')); await apply([2]);
    await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 运算符', { exact: true }).selectOption('notIn')); await step(() => table().getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('integer')); await apply([3, 4, 5, 6, 7]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'payload', 'in', 'blob', '00ff'); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选 1 列表值', exact: true }).click()); await step(() => table().getByLabel('SQLite 筛选 1 列表值 2', { exact: true }).fill('ff00')); await apply([1, 2]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    stage = '文本首尾与排除原文，明确Apply才全表读取且不跨存储类型';
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click());
    for (const [column, operator, value, expected] of [
      ['note', 'notContains', '行0', [10, 11, 12, 13, 14]], ['note', 'startsWith', '行3', [30, 31, 32, 33, 34]], ['note', 'notStartsWith', '行0', [10, 11, 12, 13, 14]],
      ['note', 'endsWith', '30中文🚢', [30]], ['note', 'notEndsWith', '中文🚢', []], ['mixed', 'endsWith', '', [2]], ['mixed', 'notContains', '', []],
    ] as const) {
      await controls(true); await filter(1, column, operator, 'text', value); await apply([...expected]);
      expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, filters: [{ column, operator, value: { kind: 'text', value } }] });
    }
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    stage = '全表不同值明确读取，typed勾选只加草稿，再沿原Apply读取';
    await controls(true); const lookupPages = (await step(audit)).pages.length, lookupReads = (await step(audit)).lookups.length;
    await step(() => table().getByRole('button', { name: valuesText.entry, exact: true }).click()); const valuesModal = () => page.getByRole('dialog', { name: valuesText.title, exact: true });
    await step(() => expect(valuesModal()).toBeVisible()); expect((await step(audit)).lookups).toHaveLength(lookupReads);
    await step(() => valuesModal().getByLabel(valuesText.column, { exact: true }).selectOption('note')); await step(() => valuesModal().getByLabel(valuesText.search, { exact: true }).fill('行3')); expect((await step(audit)).lookups).toHaveLength(lookupReads);
    await step(() => valuesModal().getByRole('button', { name: valuesText.read, exact: true }).click()); await step(() => expect(valuesModal().getByLabel(valuesText.choice(1), { exact: true })).toBeEnabled());
    expect((await step(audit)).lookups).toHaveLength(lookupReads + 1); const lookupTaskId = (await step(audit)).lookups.at(-1)!.request.taskId; expect(typeof lookupTaskId).toBe('string'); expect((await step(audit)).lookups.at(-1)?.request).toMatchObject({ column: 'note', search: '行3', mode: 'and', filters: [] });
    await step(() => valuesModal().getByLabel(valuesText.choice(1), { exact: true }).check()); await step(() => valuesModal().getByLabel(valuesText.choice(5), { exact: true }).check());
    await step(() => valuesModal().getByRole('button', { name: valuesText.add, exact: true }).click()); await step(() => expect(valuesModal()).toBeHidden());
    expect((await tasks()).filter(task => task.kind === 'sqlite.valueOptions')).toHaveLength(1); expect((await step(audit)).pages).toHaveLength(lookupPages); await step(() => expect(table().getByLabel('SQLite 筛选 1 运算符', { exact: true })).toHaveValue('oneOf')); await apply([30, 34]);
    expect((await step(audit)).pages.at(-1)?.request.filters).toEqual([{ column: 'note', operator: 'oneOf', selectedValues: [{ kind: 'text', value: '行30中文🚢' }, { kind: 'text', value: '行34中文🚢' }] }]);
    await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await apply([1, 2, 3, 4, 5]);
    stage = '真实控件区分整数与文本并验证AND/OR'; await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'mixed', 'eq', 'integer', '2'); await apply([1]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ filters: [{ column: 'mixed', operator: 'eq', value: { kind: 'integer', value: '2' } }] }); await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('text')); await apply([2]);
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(2, 'id', 'gte', 'integer', '30'); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('and')); await apply([]);
    await controls(true); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('or')); await apply([2, 30, 31, 32, 33]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ mode: 'or', filters: [{ column: 'mixed', operator: 'eq', value: { kind: 'text', value: '2' } }, { column: 'id', operator: 'gte', value: { kind: 'integer', value: '30' } }] });
    stage = '筛选单条与全部启停保原值，未Apply零读取且Apply从首页重读';
    await controls(true); const beforeToggle = (await step(audit)).pages.length;
    await step(() => table().getByLabel('启用 SQLite 筛选 1', { exact: true }).uncheck());
    await step(() => table().getByLabel('SQLite 筛选 1 条件值', { exact: true }).fill('保留停用值'));
    await step(() => expect(table().getByLabel('启用 SQLite 筛选 1', { exact: true })).not.toBeChecked());
    expect((await step(audit)).pages.length).toBe(beforeToggle); await apply([30, 31, 32, 33, 34]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 0, filters: [{ column: 'mixed', enabled: false, value: { kind: 'text', value: '保留停用值' } }, { column: 'id', value: { kind: 'integer', value: '30' } }] });
    await controls(true); const beforeAll = (await step(audit)).pages.length;
    await step(() => table().getByRole('button', { name: '全部停用 SQLite 筛选', exact: true }).click());
    await step(() => expect(table().getByText('已启用 0 / 2 条筛选', { exact: true })).toBeVisible());
    await step(async () => info.attach('SQLite全部停用筛选表单', { body: await page.screenshot(), contentType: 'image/png' }));
    expect((await step(audit)).pages.length).toBe(beforeAll); await apply([1, 2, 3, 4, 5]);
    expect((await step(audit)).pages.at(-1)?.request.filters).toEqual([{ column: 'mixed', operator: 'eq', enabled: false, value: { kind: 'text', value: '保留停用值' } }, { column: 'id', operator: 'gte', enabled: false, value: { kind: 'integer', value: '30' } }]);
    stage = '清空筛选与排序各自独立，还原当前页设置全程零读取';
    await controls(true);
    const beforeDraftReset = (await step(audit)).pages.length;
    const draftButton = (name: string) => table().getByRole('button', { name, exact: true });
    const draftPending = () => table().getByText(browseText.draftPending, { exact: true });
    await step(() => expect(draftButton(browseText.restoreAppliedDraft)).toBeDisabled());
    await step(() => draftButton(browseText.clearFilterDraft).click());
    await step(() => expect(table().getByLabel(browseText.filterOperator(1), { exact: true })).toHaveCount(0));
    await step(() => expect(table().getByLabel(browseText.sortColumn(1), { exact: true })).toHaveValue('id'));
    await step(() => expect(draftPending()).toBeVisible());
    await step(() => draftButton(browseText.restoreAppliedDraft).click());
    await step(() => expect(table().getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('保留停用值'));
    await step(() => draftButton(browseText.clearSortDraft).click());
    await step(() => expect(table().getByLabel(browseText.sortColumn(1), { exact: true })).toHaveCount(0));
    await step(() => expect(table().getByLabel(browseText.filterValue(1), { exact: true })).toHaveValue('保留停用值'));
    await step(() => table().getByLabel(browseText.limit, { exact: true }).fill('9'));
    await step(() => table().getByLabel(browseText.mode, { exact: true }).selectOption('and'));
    await step(() => draftButton(browseText.restoreAppliedDraft).click());
    await step(() => expect(table().getByLabel(browseText.limit, { exact: true })).toHaveValue('5'));
    await step(() => expect(table().getByLabel(browseText.mode, { exact: true })).toHaveValue('or'));
    await step(() => expect(table().getByLabel(browseText.sortColumn(1), { exact: true })).toHaveValue('id'));
    await step(() => expect(table().getByLabel(browseText.filterEnabled(1), { exact: true })).not.toBeChecked());
    await step(() => expect(draftPending()).toHaveCount(0));
    expect((await step(audit)).pages.length).toBe(beforeDraftReset);
    await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 条件值', { exact: true }).fill('2'));
    await step(() => table().getByRole('button', { name: '全部启用 SQLite 筛选', exact: true }).click());
    await step(() => expect(table().getByLabel('启用 SQLite 筛选 1', { exact: true })).toBeChecked());
    await step(() => expect(table().getByLabel('启用 SQLite 筛选 2', { exact: true })).toBeChecked()); await apply([2, 30, 31, 32, 33]);
    stage = '多列排序方向及优先级'; await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 2', exact: true }).click()); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await step(() => table().getByRole('button', { name: '删除 SQLite 排序 1', exact: true }).click());
    for (const [index, column, direction] of [[1, 'bucket', 'asc'], [2, 'rank_num', 'desc'], [3, 'id', 'asc']] as const) { await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel(`SQLite 排序 ${index} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 排序 ${index} 方向`, { exact: true }).selectOption(direction)); }
    await apply(expectedSort([{ key: 'bucket', direction: 'asc' }, { key: 'rank', direction: 'desc' }, { key: 'id', direction: 'asc' }]));
    await controls(true); await step(() => table().getByLabel('SQLite 排序 2 方向', { exact: true }).selectOption('asc')); await apply(expectedSort([{ key: 'bucket', direction: 'asc' }, { key: 'rank', direction: 'asc' }, { key: 'id', direction: 'asc' }]));
    await controls(true); await step(() => table().getByRole('button', { name: '上移 SQLite 排序 2', exact: true }).click()); await apply(expectedSort([{ key: 'rank', direction: 'asc' }, { key: 'bucket', direction: 'asc' }, { key: 'id', direction: 'asc' }]));
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ sort: [{ column: 'rank_num', direction: 'asc' }, { column: 'bucket', direction: 'asc' }, { column: 'id', direction: 'asc' }] });
    stage = '原树视图与明确生成SELECT仍待执行'; await step(() => page.locator('.object-row .tree-label').filter({ hasText: viewName }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible()); await expectIds([30, 31, 32, 33, 34]);
    expect((await step(audit)).pages.at(-1)?.reply).toMatchObject({ ok: true, result: { target: { kind: 'view', table: viewName }, hasMore: false } });
    const beforeDraft = (await step(audit)).pages.length;
    await openDetail(); await step(() => expect(detailField('note').locator('pre')).toHaveText(rows[29].note));
    await step(async () => { const row = page.locator('.object-row').filter({ has: page.getByRole('button', { name: tableName, exact: true }) }); const item = await (require('./sidebar-menu') as typeof import('./sidebar-menu')).sidebarMenuItem(row, { name: sqliteZh.selectQuery + ' ' + tableName, exact: true }, check); check(); await item.click(); check(); });
    await step(() => expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeVisible());
    const drafted = await settings(), queryTab = drafted.tabs.find(tab => tab.id === drafted.activeTabId); expect(queryTab).toMatchObject({ kind: 'query', connectionId: profile.id, database: 'main', sql: 'SELECT * FROM "main"."浏览""航船🚢" LIMIT 100;' });
    expect((await step(audit)).pages.length).toBe(beforeDraft); expect(await history()).toEqual([]); expect((await tasks()).every(task => (task.kind === 'sqlite.tablePage' || task.kind === 'sqlite.valueOptions' && task.id === lookupTaskId) && task.status === 'completed')).toBe(true); expect(disk()).toEqual(baseline);
    // 保存查询草稿后回到真实表标签；重启须恢复表页而非把SELECT草稿自动执行。
    const tableTab = drafted.tabs.find(tab => tab.kind === 'table' && tab.table === tableName); if (!tableTab) throw Error('原表标签已丢失');
    await step(() => page.locator(`[data-workspace-tab-id="${tableTab.id}"]`).getByRole('button', { name: tableName, exact: true }).click()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    stage = '本机方案保存与只回填表单';
    const beforePreset = await step(audit); await controls(true); await step(() => table().getByRole('button', { name: presetText.entry, exact: true }).click());
    const presetPanel = () => table().getByRole('group', { name: presetText.title, exact: true });
    await step(() => expect(presetPanel().getByRole('button', { name: presetText.save, exact: true })).toBeEnabled());
    await step(() => expect.poll(() => presetPanel().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true));
    const presetLimit = await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).inputValue());
    await step(() => presetPanel().getByLabel(presetText.name, { exact: true }).fill('原表排序方案'));
    await step(() => presetPanel().getByRole('button', { name: presetText.save, exact: true }).click()); await step(() => expect(presetPanel().getByText(presetText.saved, { exact: true })).toBeVisible());
    await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill(presetLimit === '7' ? '8' : '7'));
    await step(() => presetPanel().getByRole('button', { name: presetText.load, exact: true }).click()); await step(() => expect(table().getByLabel('SQLite 每页条数', { exact: true })).toHaveValue(presetLimit));
    await step(() => expect(presetPanel().getByText(presetText.loaded, { exact: true })).toBeVisible());
    const afterPreset = await step(audit); expect(afterPreset.pages.length).toBe(beforePreset.pages.length); expect(afterPreset.forks).toEqual(beforePreset.forks); expect(disk()).toEqual(baseline); await controls(false);
    // UI切换先于原400ms设置落盘；必须等真实Main持久态确认，不能用旧查询activeId作重启基线。
    await step(() => expect.poll(async () => (await settings()).activeTabId).toBe(tableTab.id));
    stage = '只读列布局隐藏重排调宽冻结并保存'; const beforeLayout = await step(audit);
    await step(async () => (await navigationMenuItem(table().locator('.toolbar'), { name: layoutText.entry, exact: true }, check)).click());
    const layoutModal = () => page.getByRole('dialog', { name: layoutText.title, exact: true });
    await step(() => layoutModal().getByRole('checkbox', { name: layoutFields.visible + ' nullable', exact: true }).uncheck());
    const searchColumns = () => layoutModal().getByRole('searchbox', { name: layoutFields.columnSearch, exact: true });
    const bucketWidth = await step(() => layoutModal().getByLabel(layoutFields.width + ' bucket', { exact: true }).inputValue());
    await step(() => searchColumns().fill('not_present'));
    await step(() => expect(layoutModal().getByText(layoutFields.noMatchingColumns, { exact: true })).toBeVisible());
    await step(() => searchColumns().fill(' ID '));
    await step(() => expect(layoutModal().getByLabel(layoutFields.width + ' bucket', { exact: true })).toHaveCount(0));
    await step(() => layoutModal().getByRole('button', { name: layoutFields.down + ' id', exact: true }).click());
    await step(() => layoutModal().getByRole('button', { name: batchText.fitColumn('id'), exact: true }).click());
    const idFit = Number(await step(() => layoutModal().getByLabel(layoutFields.width + ' id', { exact: true }).inputValue()));
    expect(idFit).toBeGreaterThanOrEqual(64); expect(idFit).toBeLessThan(170);
    await step(() => searchColumns().fill(''));
    await step(() => expect(layoutModal().getByLabel(layoutFields.width + ' bucket', { exact: true })).toHaveValue(bucketWidth));
    await step(() => expect(layoutModal().getByRole('button', { name: batchText.fitColumn('nullable'), exact: true })).toBeDisabled());
    await step(() => layoutModal().getByLabel(layoutFields.width + ' id', { exact: true }).fill('220'));
    await step(() => layoutModal().getByRole('button', { name: layoutFields.freezeThrough('id'), exact: true }).click());
    await step(() => layoutModal().getByRole('button', { name: layoutFields.save, exact: true }).click()); await step(() => expect(layoutModal().getByText(layoutFields.saved, { exact: true })).toBeVisible());
    await step(() => layoutModal().locator('.modal-footer').getByRole('button', { name: zh.common.close, exact: true }).click()); await step(() => expect(layoutModal()).toBeHidden());
    const assertLayout = async () => {
      const grid = table().getByRole('grid'), id = grid.getByRole('columnheader').filter({ hasText: /^id/ });
      await step(() => expect(grid.getByRole('columnheader').filter({ hasText: /^nullable/ })).toHaveCount(0)); await step(() => expect(id).toHaveAttribute('aria-colindex', '3'));
      const left = await step(() => id.evaluate(element => { const rect = element.getBoundingClientRect(); if (Math.abs(rect.width - 220) > 1) throw Error('SQLite保存列宽未应用'); return rect.left; }));
      await step(() => grid.evaluate(element => { element.scrollLeft = 400; })); await step(() => expect.poll(() => id.evaluate(element => element.getBoundingClientRect().left)).toBeCloseTo(left, 0)); await step(() => grid.evaluate(element => { element.scrollLeft = 0; }));
    };
    await assertLayout(); await openDetail(); await step(() => fieldSearch().fill('nullable'));
    await step(() => expect(details().locator('article')).toHaveCount(1));
    await step(() => expect(detailField('nullable')).toBeVisible());
    await step(() => details().getByRole('button', { name: detailText.close, exact: true }).click()); await step(() => expect(details()).toHaveCount(0));
    const afterLayout = await step(audit); expect(afterLayout.pages.length).toBe(beforeLayout.pages.length); expect(afterLayout.forks).toEqual(beforeLayout.forks); expect(disk()).toEqual(baseline);
    const persisted = await settings(), firstFacts = await step(audit), firstTasks = await tasks(); expect(persisted.tabs.find(tab => tab.id === persisted.activeTabId)).toMatchObject({ kind: 'table', table: tableName });
    expect(firstFacts.pickerCalls).toBe(1); expect(firstFacts.denied).toEqual([]); expect(firstFacts.forks.length).toBeGreaterThan(0); expect(firstFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(firstFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.'))).toBe(false); expect(runtime.pageErrors).toEqual([]);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: { restore(): void } }).__sqliteTableBrowseNative; if (!state) throw Error('原观察器已失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile重启恢复表页'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid);
    await arm(profile.id); armed = true; await step(() => expect(table().getByRole('grid')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await history()).toEqual([]); expect(disk()).toEqual(baseline);
    await step(async () => expect((await navigationMenuItem(table().locator('.toolbar'), { name: layoutText.entry, exact: true }, check))).toBeEnabled()); await assertLayout();
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect((await tasks()).every(task => (task.kind === 'sqlite.tablePage' || task.kind === 'sqlite.valueOptions' && task.id === lookupTaskId) && task.status === 'completed')).toBe(true);
    // 恢复时首轮读取可能先于观察器安装；只证明安装后的显式刷新，绝不补写先前fork事实。
    const restoredPages = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: '刷新 SQLite 表数据', exact: true }).click()); await step(() => expect.poll(async () => (await audit()).pages.length).toBe(restoredPages + 1));
    // 原IPC回包先于React交付；完成态必须同时核真实网格与Task终态，不能把加载画面当成已展示。
    await step(() => expect(table().getByRole('grid')).toBeVisible());
    await step(() => expect.poll(async () => (await tasks()).every(task => (task.kind === 'sqlite.tablePage' || task.kind === 'sqlite.valueOptions' && task.id === lookupTaskId) && task.status === 'completed')).toBe(true));
    await assertLayout();
    stage = '重启持久化方案仍只填写表单'; const beforeRestoredPreset = await step(audit); await controls(true);
    await step(() => table().getByRole('button', { name: presetText.entry, exact: true }).click());
    await step(() => table().getByLabel(presetText.selection, { exact: true }).selectOption({ label: '原表排序方案' }));
    await step(() => table().getByRole('button', { name: presetText.load, exact: true }).click()); await step(() => expect(table().getByLabel('SQLite 每页条数', { exact: true })).toHaveValue(presetLimit));
    await step(() => expect(table().getByText(presetText.loaded, { exact: true })).toBeVisible());
    expect((await step(audit)).pages.length).toBe(beforeRestoredPreset.pages.length); expect((await step(audit)).forks).toEqual(beforeRestoredPreset.forks); await controls(false);
    const secondFacts = await step(audit); expect(secondFacts.pickerCalls).toBe(0); expect(secondFacts.denied).toEqual([]); expect(secondFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.'))).toBe(false); expect(runtime.pageErrors).toEqual([]); expect(disk()).toEqual(baseline);
    // 只手动保留成功完成态的本例合成数据；自动截图、trace和视频始终关闭。
    await step(async () => info.attach('SQLite分页表格完成态', { body: await page.screenshot(), contentType: 'image/png' }));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: { restore(): void } }).__sqliteTableBrowseNative; if (!state) throw Error('原观察器已失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await info.attach('SQLite表浏览原始请求回包与完成边界', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, canonicalDatabaseBeforePicker: canonicalDatabase, firstPid, secondPid: originalProcess.pid, firstFacts, secondFacts, firstTasks, originalRows: baseline, finalRows: disk(), sourceRows: 34, realHeaderServerSort: true, headerCycleAndPlatformMultisortChecked: true, headerUsesAppliedFiltersModeAndLimit: true, unsubmittedDraftKeptUntilApply: true, userSqlExecutions: 0, userTransactions: 0, systemClipboardOperations: 0, generatedSelectNeverExecuted: true, sameProfileTableTabRestored: true, firstExitCode: 0, secondExitCode: originalProcess.exitCode, pickerScope: '只替换本例Main文件picker准确返回路径，未验证操作系统原生对话框输入', observationScope: '每次首窗口就绪后安装观察器至退出前撤销；重启初始读取不冒称已观察', automaticRetry: false, automaticTrace: false }), contentType: 'application/json' });
    await info.attach('SQLite表浏览观察端口计时', { body: JSON.stringify(observation), contentType: 'application/json' });
    completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: Audit }).__sqliteTableBrowseNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, frames: state.frames, pickerCalls: state.pickerCalls, connectionId: state.connectionId, commands: state.commands, lookups: state.lookups, pages: state.pages } : undefined; }); } catch { /* 只读保留已捕获原件，不借失败重建观察器。 */ }
    try { await info.attach('分组菜单只读事件', { body: JSON.stringify(await (await import('./navigation-menu-diagnostics')).readNavigationMenuObservation(page)), contentType: 'application/json' }); } catch { /* 只读诊断失败不覆盖原错误。 */ }
    try { await info.attach('SQLite表浏览失败原件保留', { body: JSON.stringify({ stage, directory, database, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, partial, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件失败不覆盖首因，也不解除原owner保留。 */ }
    throw reason;
  }
});

/** 只有原fixture完成两次准确正常退出后才核清理；专项不自行删除目录。 */
test.afterAll(async ({}, info: TestInfo) => {
  if (!completed) return;
  const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false;
  try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; }
  expect(missing, '原ownedfixture必须在成功退出后清理本例profile与SQLite').toBe(true);
  await info.attach('SQLite表浏览最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' });
});
