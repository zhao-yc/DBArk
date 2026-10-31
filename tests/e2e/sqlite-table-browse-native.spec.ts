import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';

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
interface Audit { pending: number; denied: string[]; forks: string[]; pickerCalls: number; connectionId?: string; commands: string[]; pages: PageFact[]; }
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
  let closed = false, armed = false, stage = '独占合成库准备';
  /** 每个异步边界都只承认本例准确owner与120秒单次期限。 */
  const check = () => {
    const current = runtime.ownedDesktopResources(info);
    if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite表浏览owner/profile/单次120秒期限变化');
  };
  const audit = () => application.evaluate(() => {
    const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: Audit & { check(): void } }).__sqliteTableBrowseNative;
    if (!state) throw Error('原SQLite表浏览观察器不存在'); state.check();
    return { pending: state.pending, denied: state.denied, forks: state.forks, pickerCalls: state.pickerCalls, connectionId: state.connectionId, commands: state.commands, pages: state.pages };
  });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
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
    const state: State = { pending: 0, denied: [], forks: [], pickerCalls: 0, connectionId: input.profileId, commands: [], pages: [], check() {}, restore() {} }; let pickerRequest = false;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite只读表浏览专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteTableBrowseNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || utilityProcess.fork !== fork || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite表浏览原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => {
      check(); const options = args.at(-1) as Electron.OpenDialogOptions;
      if (input.profileId || state.pickerCalls || !pickerRequest || !state.connectionId || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker');
      state.pickerCalls++; return { canceled: false, filePaths: [input.database] };
    }) as typeof dialog.showOpenDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => { check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]); }) as typeof utilityProcess.fork;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC');
      const command = payload.command, value = payload.input as Record<string, unknown>;
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
      if (command === 'sqlite.tablePage' && (value.connectionId !== state.connectionId || value.database !== 'main' || !input.objects.includes(String(value.table)))) return deny('其它SQLite表目标');
      const page: PageFact | undefined = command === 'sqlite.tablePage' ? { request: structuredClone(value), reply: undefined } : undefined;
      if (page) state.pages.push(page);
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
  const controls = async (open: boolean) => { const visible = await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).isVisible()); if (visible !== open) await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); };
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
    // 右侧原列通过真实水平滚动显露，不能以虚拟网格尚未挂载的单元格冒称可见。
    await step(() => table().getByRole('grid').evaluate(element => { element.scrollLeft = element.scrollWidth; }));
    await step(() => expect(table().getByRole('grid').getByText('9223372036854775807', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').getByText('0x00ff', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').getByText('0xff00', { exact: true })).toBeVisible()); await step(() => expect(table().getByRole('grid').locator('.null-value')).toHaveCount(3));
    const nextCount = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: 'SQLite 下一页', exact: true }).click()); await step(() => expect.poll(async () => (await audit()).pages.length).toBe(nextCount + 1)); await expectIds([6, 7, 8, 9, 10]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ offset: 5, limit: 5, table: tableName }); await step(() => table().getByRole('button', { name: 'SQLite 首页', exact: true }).click()); await expectIds([1, 2, 3, 4, 5]);
    stage = '真实控件区分整数与文本并验证AND/OR'; await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(1, 'mixed', 'eq', 'integer', '2'); await apply([1]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ filters: [{ column: 'mixed', operator: 'eq', value: { kind: 'integer', value: '2' } }] }); await controls(true); await step(() => table().getByLabel('SQLite 筛选 1 值类型', { exact: true }).selectOption('text')); await apply([2]);
    await controls(true); await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await filter(2, 'id', 'gte', 'integer', '30'); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('and')); await apply([]);
    await controls(true); await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('or')); await apply([2, 30, 31, 32, 33]);
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ mode: 'or', filters: [{ column: 'mixed', operator: 'eq', value: { kind: 'text', value: '2' } }, { column: 'id', operator: 'gte', value: { kind: 'integer', value: '30' } }] });
    stage = '多列排序方向及优先级'; await controls(true); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 2', exact: true }).click()); await step(() => table().getByRole('button', { name: '删除 SQLite 筛选 1', exact: true }).click()); await step(() => table().getByRole('button', { name: '删除 SQLite 排序 1', exact: true }).click());
    for (const [index, column, direction] of [[1, 'bucket', 'asc'], [2, 'rank_num', 'desc'], [3, 'id', 'asc']] as const) { await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel(`SQLite 排序 ${index} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 排序 ${index} 方向`, { exact: true }).selectOption(direction)); }
    await apply(expectedSort([{ key: 'bucket', direction: 'asc' }, { key: 'rank', direction: 'desc' }, { key: 'id', direction: 'asc' }]));
    await controls(true); await step(() => table().getByLabel('SQLite 排序 2 方向', { exact: true }).selectOption('asc')); await apply(expectedSort([{ key: 'bucket', direction: 'asc' }, { key: 'rank', direction: 'asc' }, { key: 'id', direction: 'asc' }]));
    await controls(true); await step(() => table().getByRole('button', { name: '上移 SQLite 排序 2', exact: true }).click()); await apply(expectedSort([{ key: 'rank', direction: 'asc' }, { key: 'bucket', direction: 'asc' }, { key: 'id', direction: 'asc' }]));
    expect((await step(audit)).pages.at(-1)?.request).toMatchObject({ sort: [{ column: 'rank_num', direction: 'asc' }, { column: 'bucket', direction: 'asc' }, { column: 'id', direction: 'asc' }] });
    stage = '原树视图与明确生成SELECT仍待执行'; await step(() => page.locator('.object-row .tree-label').filter({ hasText: viewName }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible()); await expectIds([30, 31, 32, 33, 34]);
    expect((await step(audit)).pages.at(-1)?.reply).toMatchObject({ ok: true, result: { target: { kind: 'view', table: viewName }, hasMore: false } });
    const beforeDraft = (await step(audit)).pages.length;
    await step(async () => { const row = page.locator('.object-row').filter({ has: page.getByRole('button', { name: tableName, exact: true }) }); const item = await (require('./sidebar-menu') as typeof import('./sidebar-menu')).sidebarMenuItem(row, { name: sqliteZh.selectQuery + ' ' + tableName, exact: true }, check); check(); await item.click(); check(); });
    await step(() => expect(page.locator('.query-tab:visible .monaco-editor').getByRole('textbox')).toBeVisible());
    const drafted = await settings(), queryTab = drafted.tabs.find(tab => tab.id === drafted.activeTabId); expect(queryTab).toMatchObject({ kind: 'query', connectionId: profile.id, database: 'main', sql: 'SELECT * FROM "main"."浏览""航船🚢" LIMIT 100;' });
    expect((await step(audit)).pages.length).toBe(beforeDraft); expect(await history()).toEqual([]); expect((await tasks()).every(task => task.kind === 'sqlite.tablePage' && task.status === 'completed')).toBe(true); expect(disk()).toEqual(baseline);
    // 保存查询草稿后回到真实表标签；重启须恢复表页而非把SELECT草稿自动执行。
    const tableTab = drafted.tabs.find(tab => tab.kind === 'table' && tab.table === tableName); if (!tableTab) throw Error('原表标签已丢失');
    await step(() => page.locator(`[data-workspace-tab-id="${tableTab.id}"]`).getByRole('button', { name: tableName, exact: true }).click()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    // UI切换先于原400ms设置落盘；必须等真实Main持久态确认，不能用旧查询activeId作重启基线。
    await step(() => expect.poll(async () => (await settings()).activeTabId).toBe(tableTab.id));
    const persisted = await settings(), firstFacts = await step(audit), firstTasks = await tasks(); expect(persisted.tabs.find(tab => tab.id === persisted.activeTabId)).toMatchObject({ kind: 'table', table: tableName });
    expect(firstFacts.pickerCalls).toBe(1); expect(firstFacts.denied).toEqual([]); expect(firstFacts.forks.length).toBeGreaterThan(0); expect(firstFacts.forks.every(path => /(?:^|[\\/])sqliteWorker\.cjs$/.test(path))).toBe(true); expect(firstFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.'))).toBe(false); expect(runtime.pageErrors).toEqual([]);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: { restore(): void } }).__sqliteTableBrowseNative; if (!state) throw Error('原观察器已失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile重启恢复表页'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid);
    await arm(profile.id); armed = true; await step(() => expect(table().getByRole('grid')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await history()).toEqual([]); expect(disk()).toEqual(baseline);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect((await tasks()).every(task => task.kind === 'sqlite.tablePage' && task.status === 'completed')).toBe(true);
    // 恢复时首轮读取可能先于观察器安装；只证明安装后的显式刷新，绝不补写先前fork事实。
    const restoredPages = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: '刷新 SQLite 表数据', exact: true }).click()); await step(() => expect.poll(async () => (await audit()).pages.length).toBe(restoredPages + 1));
    // 原IPC回包先于React交付；完成态必须同时核真实网格与Task终态，不能把加载画面当成已展示。
    await step(() => expect(table().getByRole('grid')).toBeVisible());
    await step(() => expect.poll(async () => (await tasks()).every(task => task.kind === 'sqlite.tablePage' && task.status === 'completed')).toBe(true));
    const secondFacts = await step(audit); expect(secondFacts.pickerCalls).toBe(0); expect(secondFacts.denied).toEqual([]); expect(secondFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.'))).toBe(false); expect(runtime.pageErrors).toEqual([]); expect(disk()).toEqual(baseline);
    // 只手动保留成功完成态的本例合成数据；自动截图、trace和视频始终关闭。
    await step(async () => info.attach('SQLite分页表格完成态', { body: await page.screenshot(), contentType: 'image/png' }));
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: { restore(): void } }).__sqliteTableBrowseNative; if (!state) throw Error('原观察器已失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await info.attach('SQLite表浏览原始请求回包与完成边界', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, canonicalDatabaseBeforePicker: canonicalDatabase, firstPid, secondPid: originalProcess.pid, firstFacts, secondFacts, firstTasks, originalRows: baseline, finalRows: disk(), sourceRows: 34, userSqlExecutions: 0, userTransactions: 0, systemClipboardOperations: 0, generatedSelectNeverExecuted: true, sameProfileTableTabRestored: true, firstExitCode: 0, secondExitCode: originalProcess.exitCode, pickerScope: '只替换本例Main文件picker准确返回路径，未验证操作系统原生对话框输入', observationScope: '每次首窗口就绪后安装观察器至退出前撤销；重启初始读取不冒称已观察', automaticRetry: false, automaticTrace: false }), contentType: 'application/json' });
    completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info);
    let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableBrowseNative?: Audit }).__sqliteTableBrowseNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, pickerCalls: state.pickerCalls, connectionId: state.connectionId, commands: state.commands, pages: state.pages } : undefined; }); } catch { /* 只读保留已捕获原件，不借失败重建观察器。 */ }
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
