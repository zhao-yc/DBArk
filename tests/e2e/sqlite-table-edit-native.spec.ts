import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';

// 默认和--list只注册单个跳过项；原生App、NodeSQLite和文件观察均在显式专项内部加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_TABLE_EDIT_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)
    || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite表格编辑仅允许Windows/macOS源码、integration=0与无外库认证环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite表格编辑禁止自动trace');
}

type Desktop = typeof import('./desktop-fixture');
type Fact = { command: string; request: Record<string, unknown>; reply?: unknown; failure?: string };
interface Audit { pending: number; denied: string[]; forks: string[]; pickerIds: string[]; profiles: Record<string, boolean>; commands: string[]; operations: Fact[]; events: unknown[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_TABLE_EDIT_NATIVE_TEST=1、integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const rwName = 'SQLite表格编辑本例读写', roName = 'SQLite表格编辑本例只读', pkTable = '编辑"主键🚢', compoundTable = '编辑复合键', viewName = '编辑只读视图';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 失败保留准确owner、原profile和数据库，禁止自动重试、强停或清理。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite表格编辑未完成两次正常退出，原现场已保留'); } });

test('SQLite真实表格草稿增改删、预览取消、独立事务提交与并发冲突整批回滚，重启不重放', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop;
  const { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-table-edit-native.sqlite');
  let closed = false, armed = false, stage = '独占合成SQLite准备';
  /** 所有异步边界只承认本例准确owner与原120秒单次期限。 */
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite表格编辑owner/profile/120秒单次期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableEditNative?: Audit & { check(): void } }).__sqliteTableEditNative; if (!state) throw Error('原SQLite编辑观察器不存在'); state.check(); return { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, commands: state.commands, operations: state.operations, events: state.events }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const table = () => page.locator('.table-tab:visible');
  const grid = () => table().getByRole('grid', { name: 'SQLite 表格编辑', exact: true });
  const preview = () => page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  /** 原始IPC必须有成功封套才读取结果，不用UI预期伪造后端提交事实。 */
  const result = (reply: unknown): Record<string, unknown> => { if (!reply || typeof reply !== 'object' || !('ok' in reply) || reply.ok !== true || !('result' in reply) || !reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result)) throw Error('SQLite编辑没有成功原IPC结果'); return reply.result as Record<string, unknown>; };
  const operations = (facts: Audit, command: string) => facts.operations.filter(operation => operation.command === command);
  /** 每次独立只读磁盘观察都关闭句柄；所有整数转文本并额外核typeof，保护64位原文。 */
  const disk = () => {
    check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('独立观察越过本例目录'); const db = new DatabaseSync(database, { readOnly: true });
    try { return {
      pk: db.prepare('SELECT CAST(id AS TEXT) AS id,note,typeof(mixed) AS mixed_type,CAST(mixed AS TEXT) AS mixed,nullable,lower(hex(payload)) AS payload,typeof(payload) AS payload_type,CAST(exact_int AS TEXT) AS exact_int,typeof(exact_int) AS exact_type,CAST(real_num AS TEXT) AS real_num,typeof(real_num) AS real_type,defaulted FROM "编辑""主键🚢" ORDER BY "编辑""主键🚢".id').all(),
      compound: db.prepare('SELECT tenant,CAST(id AS TEXT) AS id,note FROM "编辑复合键" ORDER BY tenant,"编辑复合键".id').all(),
      control: db.prepare('SELECT id,note FROM "界外控制" ORDER BY id').all()
    }; } finally { db.close(); check(); }
  };
  /** 仅替换两次自身文件chooser的准确路径；IPC、授权、SQLite任务和事件全部真实透传。 */
  const arm = (savedProfiles: Record<string, boolean> = {}) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __sqliteTableEditNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork, originalSend = window?.webContents.send;
    if (typeof original !== 'function' || windows.length !== 1 || !frame || !originalSend || root.__sqliteTableEditNative) throw Error('SQLite表格编辑原Main入口未知');
    const state: State = { pending: 0, denied: [], forks: [], pickerIds: [], profiles: { ...input.savedProfiles }, commands: [], operations: [], events: [], check() {}, restore() {} };
    const snapshots = new Set<string>(), previews = new Set<string>(); let pickerRequest: string | undefined;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite表格编辑专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteTableEditNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.webContents.send !== send || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite表格编辑原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions; if (Object.keys(input.savedProfiles).length || !pickerRequest || state.pickerIds.includes(pickerRequest) || state.pickerIds.length >= 2 || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker'); state.pickerIds.push(pickerRequest); return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
    const save = (() => deny('未授权保存对话框')) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => { check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]); }) as typeof utilityProcess.fork;
    const send = ((channel: string, ...args: unknown[]) => { if (channel === 'dbark:task') state.events.push(structuredClone(args[0])); return Reflect.apply(originalSend, window.webContents, [channel, ...args]); }) as typeof window.webContents.send;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC'); const command = payload.command, value = payload.input as Record<string, unknown>;
      if (/clipboard/i.test(command) || command === 'files.path' || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('serverMonitor.') || ['files.export', 'files.exportResult', 'excel.export', 'sqlite.tableExport'].includes(command)) return deny(command);
      if (command.startsWith('sqlite.') && !['sqlite.tablePage', 'sqlite.tableEdit.preview', 'sqlite.tableEdit.apply', 'sqlite.tableEdit.release'].includes(command)) return deny('未知SQLite命令');
      if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId) return deny('文件用途/连接归属'); pickerRequest = value.sqliteConnectionId; }
      if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite, readOnly = value.name === input.rwName ? false : value.name === input.roName ? true : undefined; if (value.dialect !== 'sqlite' || typeof value.id !== 'string' || !state.pickerIds.includes(value.id) || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== readOnly || readOnly === undefined || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例明确读写/只读配置'); state.profiles[value.id] = readOnly; }
      if (command === 'connections.open' && !Object.hasOwn(state.profiles, String(value.id)) || command.startsWith('metadata.') && !Object.hasOwn(state.profiles, String(value.connectionId))) return deny('其它数据库连接');
      if (command === 'sqlite.tablePage' && (!Object.hasOwn(state.profiles, String(value.connectionId)) || value.database !== 'main' || !input.objects.includes(String(value.table)))) return deny('其它SQLite目标');
      if (command === 'sqlite.tableEdit.preview' && !snapshots.has(String(value.snapshotId)) || command === 'sqlite.tableEdit.apply' && !previews.has(String(value.previewId)) || command === 'sqlite.tableEdit.release' && !(snapshots.has(String(value.snapshotId)) || previews.has(String(value.previewId)))) return deny('其它编辑快照/预览');
      const fact: Fact | undefined = command === 'sqlite.tablePage' || command.startsWith('sqlite.tableEdit.') ? { command, request: structuredClone(value) } : undefined; if (fact) state.operations.push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply);
        if (reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply && reply.result && typeof reply.result === 'object') { const output = reply.result; if (command === 'sqlite.tablePage' && 'edit' in output && output.edit && typeof output.edit === 'object' && 'kind' in output.edit && output.edit.kind === 'editable' && 'snapshotId' in output.edit && typeof output.edit.snapshotId === 'string') snapshots.add(output.edit.snapshotId); if (command === 'sqlite.tableEdit.preview' && 'previewId' in output && typeof output.previewId === 'string') previews.add(output.previewId); } return reply;
      } catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; } finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending) throw Error('SQLite编辑请求仍在途'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; window.webContents.send = originalSend; delete root.__sqliteTableEditNative; };
    root.__sqliteTableEditNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; window.webContents.send = send; check();
  }, { database, savedProfiles, rwName, roName, objects: [pkTable, compoundTable, viewName] }));
  /** 两个连接都通过真实表单保存；读写连接必须明确取消产品默认只读。 */
  const createConnection = async (name: string, readOnly: boolean) => {
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(name)); const dialect = form.locator('select'); await step(() => expect(dialect).toHaveCount(1)); await step(() => dialect.selectOption('sqlite')); const readonly = form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }); await step(() => expect(readonly).toBeChecked()); if (!readOnly) { await step(() => readonly.uncheck()); await step(() => expect(readonly).not.toBeChecked()); }
    await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
  };
  /** 通过指定连接真实树层级打开对象，不依靠重复名字碰巧选中另一个连接。 */
  const openObject = async (name: string, object: string) => { const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').filter({ hasText: name }) }); await step(() => expect(connection).toHaveCount(1)); const databaseRow = connection.locator('.database-row .tree-label').filter({ hasText: /^main$/ }); if (!await step(() => databaseRow.isVisible())) await step(() => connection.locator('.connection-row .tree-label').filter({ hasText: name }).click()); const objectRow = connection.locator('.object-row .tree-label').filter({ hasText: object }); if (!await step(() => objectRow.isVisible())) await step(() => databaseRow.click()); await step(() => objectRow.dblclick()); await step(() => expect(table()).toBeVisible()); };
  /** 只从可访问列头读取实际网格值；不把后端回包或草稿内存冒称为已展示内容。 */
  const columnValues = (column: string) => step(async () => { const header = grid().getByRole('columnheader').filter({ hasText: new RegExp('^' + column + '$') }); await expect(header).toHaveCount(1); check(); const position = await header.getAttribute('aria-colindex'); check(); if (!position || !/^[1-9][0-9]*$/.test(position)) throw Error('编辑网格原列位置未知'); return grid().locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${position}"]`).allTextContents(); });
  const select = (row: number) => step(() => grid().getByRole('button', { name: `选择 SQLite 第 ${row} 行`, exact: true }).click());
  /** 先经真实排序控件确定页内行序，不能把SQLite未指定ORDER BY的扫描顺序当作定位合同。 */
  const sortPage = async (columns: string[]) => {
    const before = operations(await step(audit), 'sqlite.tablePage').length;
    await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click());
    for (const [index, column] of columns.entries()) { await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel(`SQLite 排序 ${index + 1} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 排序 ${index + 1} 方向`, { exact: true }).selectOption('asc')); }
    await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click()); await step(() => expect.poll(async () => { const pages = operations(await audit(), 'sqlite.tablePage'); return pages.length === before + 1 && pages.at(-1)?.reply !== undefined; }).toBe(true));
    await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); await step(() => expect(grid()).toBeVisible());
  };
  /** 真实window.confirm沿原夹具Main回答协议；CDP事件只观察，不能在Main已回答后再次accept。 */
  const confirm = async (action: () => Promise<unknown>, expected: string) => {
    await step(() => runtime.answerDialogs([0], application));
    const waiting = page.waitForEvent('dialog');
    // 同时观察两条Promise，避免首因后留下未结算click并在retained墓碑之后继续运行。
    const [prompt] = await Promise.all([waiting, step(action)]); check(); expect(prompt.type()).toBe('confirm'); expect(prompt.message()).toBe(expected);
    const answered = await step(() => application.evaluate(() => ({ answers: [...globalThis.__dbarkE2EDialogs.answers], calls: structuredClone(globalThis.__dbarkE2EDialogs.calls) })));
    expect(answered.answers).toEqual([]); expect(answered.calls).toHaveLength(1); expect(answered.calls[0]).toMatchObject({ message: expected, response: 0 });
    expect(answered.calls[0].buttons).toHaveLength(2); expect(answered.calls[0].buttons?.every(button => typeof button === 'string' && button.length > 0)).toBe(true);
  };
  const counts = (insert: number, update: number, remove: number) => step(() => expect(table().getByRole('status').filter({ hasText: `本地草稿：新增 ${insert} 行，修改 ${update} 行，删除 ${remove} 行` })).toBeVisible());
  /** 所有新输入显式指定动态类型，NULL没有值，新增未勾字段继续省略而非补NULL。 */
  const input = async (modal: ReturnType<typeof page.getByRole>, column: string, kind: 'text' | 'integer' | 'real' | 'blob' | 'null', value?: string, insert = false) => {
    if (insert) await step(() => modal.getByRole('checkbox', { name: '写入 SQLite 字段 ' + column, exact: true }).check());
    await step(() => modal.getByLabel('SQLite 字段 ' + column + ' 类型', { exact: true }).selectOption(kind));
    if (kind === 'null') await step(() => expect(modal.getByLabel('SQLite 字段 ' + column + ' 值', { exact: true })).toBeDisabled());
    else { if (value === undefined) throw Error('typed非NULL字段缺少显式原文'); await step(() => modal.getByLabel('SQLite 字段 ' + column + ' 值', { exact: true }).fill(value)); }
  };
  const openRow = async (row: number) => { await select(row); await step(() => table().getByRole('button', { name: '编辑 SQLite 当前行', exact: true }).click()); const modal = page.getByRole('dialog', { name: '编辑 SQLite 当前行', exact: true }); await step(() => expect(modal).toBeVisible()); return modal; };
  const save = async (modal: ReturnType<typeof page.getByRole>) => { await step(() => modal.getByRole('button', { name: '保存 SQLite 本地草稿', exact: true }).click()); await step(() => expect(modal).toBeHidden()); };
  const openPreview = async (expectedCounts: { insert: number; update: number; delete: number }) => {
    const before = operations(await step(audit), 'sqlite.tableEdit.preview').length;
    await step(() => table().getByRole('button', { name: '预览 SQLite 修改', exact: true }).click()); await step(() => expect(preview()).toBeVisible()); await step(() => expect(preview().getByLabel('SQLite 修改 SQL 预览', { exact: true })).toBeVisible());
    await step(() => expect.poll(async () => { const facts = operations(await audit(), 'sqlite.tableEdit.preview'); return facts.length === before + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true)); const fact = operations(await step(audit), 'sqlite.tableEdit.preview').at(-1); expect(fact?.failure).toBeUndefined(); const output = result(fact?.reply); expect(output.counts).toEqual(expectedCounts); await step(() => expect(preview().getByRole('button', { name: '提交 SQLite 修改', exact: true })).toBeDisabled()); return { fact, output };
  };
  const apply = async () => {
    const before = operations(await step(audit), 'sqlite.tableEdit.apply').length; await step(() => preview().getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check()); await step(() => preview().getByRole('button', { name: '提交 SQLite 修改', exact: true }).click());
    await step(() => expect.poll(async () => { const facts = operations(await audit(), 'sqlite.tableEdit.apply'); return facts.length === before + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true)); const fact = operations(await step(audit), 'sqlite.tableEdit.apply').at(-1); expect(fact?.failure).toBeUndefined(); return { fact, output: result(fact?.reply) };
  };
  /** 任务持久原件仅从本例配置SQLite独立读取，不读取连接记录或系统凭据。 */
  const diskTasks = (): unknown[] => { check(); const db = new DatabaseSync(join(directory, 'dbark.sqlite'), { readOnly: true }); try { return db.prepare('SELECT data FROM tasks ORDER BY id').all().map(row => { if (typeof row.data !== 'string') throw Error('持久任务记录不是JSON文本'); return JSON.parse(row.data) as unknown; }); } finally { db.close(); check(); } };
  const oldNote = 'E2E_EDIT_ORIGINAL_PRIVATE_', newNote = 'E2E_EDIT_NEW_PRIVATE_中文🚢', insertNote = 'E2E_EDIT_INSERT_PRIVATE_中文🚢', conflictFirst = 'E2E_EDIT_CONFLICT_FIRST_PRIVATE_', conflictLast = 'E2E_EDIT_CONFLICT_LAST_PRIVATE_', observerNote = 'E2E_EDIT_EXTERNAL_OBSERVER_PRIVATE_', defaultValue = 'DB_DEFAULT_默认🚢';
  const sourceRows = [1, 2, 3, 4, 999].map(id => ({ id: String(id), note: oldNote + id, mixed_type: id === 2 ? 'text' : 'integer', mixed: '2', nullable: id % 2 ? '原非空' + id : null, payload: id % 2 ? '00ff' : 'ff00', payload_type: 'blob', exact_int: id % 2 ? '9223372036854775807' : '-9223372036854775808', exact_type: 'integer', real_num: String(id + 0.25), real_type: 'real', defaulted: defaultValue }));
  const compoundRows = [{ tenant: 'A', id: '1', note: oldNote + 'A1' }, { tenant: 'A', id: '2', note: oldNote + 'A2' }, { tenant: 'A', id: '3', note: oldNote + 'A3' }, { tenant: 'B', id: '3', note: oldNote + 'B3' }];
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    const db = new DatabaseSync(database); try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "编辑""主键🚢"(id INTEGER PRIMARY KEY,note TEXT NOT NULL,mixed,nullable TEXT,payload BLOB,exact_int INTEGER,real_num REAL,defaulted TEXT NOT NULL DEFAULT \'DB_DEFAULT_默认🚢\'); CREATE TABLE "编辑复合键"(tenant TEXT NOT NULL,id INTEGER NOT NULL,note TEXT NOT NULL,PRIMARY KEY(tenant,id)) WITHOUT ROWID; CREATE TABLE "界外控制"(id TEXT PRIMARY KEY,note TEXT); INSERT INTO "界外控制" VALUES(\'control-only\',\'界外原值禁止触碰\'); CREATE VIEW "编辑只读视图" AS SELECT * FROM "编辑""主键🚢";');
      const insert = db.prepare('INSERT INTO "编辑""主键🚢"(id,note,mixed,nullable,payload,exact_int,real_num) VALUES(?,?,?,?,?,?,?)'); for (const row of sourceRows) insert.run(BigInt(row.id), row.note, row.mixed_type === 'integer' ? BigInt(row.mixed) : row.mixed, row.nullable, Buffer.from(row.payload, 'hex'), BigInt(row.exact_int), Number(row.real_num)); const compound = db.prepare('INSERT INTO "编辑复合键" VALUES(?,?,?)'); for (const row of compoundRows) compound.run(row.tenant, BigInt(row.id), row.note);
    } finally { db.close(); }
    // 创建句柄关闭后且chooser前取得canonical期望，不按产品返回结果事后规范化。
    const canonicalDatabase = realpathSync(database), baseline = { pk: sourceRows, compound: compoundRows, control: [{ id: 'control-only', note: '界外原值禁止触碰' }] }; expect(disk()).toEqual(baseline);
    await arm(); armed = true; stage = '真实表单明确读写与只读连接'; await createConnection(rwName, false); await createConnection(roName, true);
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(2); const rw = profiles.find(profile => profile.name === rwName), ro = profiles.find(profile => profile.name === roName); if (!rw || rw.dialect !== 'sqlite' || !ro || ro.dialect !== 'sqlite') throw Error('本例读写/只读SQLite配置错误'); expect(rw.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: false }); expect(ro.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true });
    for (const profile of profiles) { for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(field); if (profile.dialect !== 'sqlite') throw Error('SQLite连接不应转为网络'); expect(profile.sqlite.fileToken).toBeUndefined(); }
    stage = '可靠PK原页typed值与本地增改删零写入'; await openObject(rwName, pkTable); await step(() => expect(grid()).toBeVisible()); await sortPage(['id']); await step(() => expect.poll(async () => await columnValues('id')).toEqual(['INTEGER · 1', 'INTEGER · 2', 'INTEGER · 3', 'INTEGER · 4', 'INTEGER · 999']));
    const pkPage = operations(await step(audit), 'sqlite.tablePage').at(-1); expect(pkPage?.request).toMatchObject({ connectionId: rw.id, table: pkTable, editing: true }); expect(result(pkPage?.reply)).toMatchObject({ edit: { kind: 'editable', locator: { kind: 'rowid' } } });
    const edit = await openRow(1); for (const [column, kind, value] of [['note', 'text', oldNote + '1'], ['mixed', 'integer', '2'], ['exact_int', 'integer', '9223372036854775807'], ['payload', 'blob', '00ff'], ['real_num', 'real', '1.25']] as const) { await step(() => expect(edit.getByLabel('SQLite 字段 ' + column + ' 类型', { exact: true })).toHaveValue(kind)); await step(() => expect(edit.getByLabel('SQLite 字段 ' + column + ' 值', { exact: true })).toHaveValue(value)); }
    await input(edit, 'note', 'text', newNote); await input(edit, 'mixed', 'text', '2'); await input(edit, 'nullable', 'null'); await input(edit, 'payload', 'blob', '00aaff'); await input(edit, 'exact_int', 'integer', '-9223372036854775808'); await input(edit, 'real_num', 'real', '-2.75'); await save(edit);
    await step(() => table().getByRole('button', { name: '新增 SQLite 记录', exact: true }).click()); const added = page.getByRole('dialog', { name: '新增 SQLite 记录', exact: true }); await step(() => expect(added).toBeVisible()); await step(() => expect(added.getByRole('checkbox', { name: '写入 SQLite 字段 defaulted', exact: true })).not.toBeChecked());
    for (const [column, kind, value] of [['id', 'integer', '6'], ['note', 'text', insertNote], ['mixed', 'real', '2.5'], ['nullable', 'text', ''], ['payload', 'blob', ''], ['exact_int', 'integer', '9223372036854775807'], ['real_num', 'real', '1.25']] as const) await input(added, column, kind, value, true); await save(added);
    await select(3); await confirm(() => table().getByRole('button', { name: '删除 SQLite 当前行', exact: true }).click(), '将当前记录标记为本地待删除？只有预览并明确提交后才会修改数据库。'); await counts(1, 1, 1); expect(disk()).toEqual(baseline); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toEqual([]);
    stage = 'SQL预览取消零写入且保留草稿'; const canceledPreview = await openPreview({ insert: 1, update: 1, delete: 1 }); expect(canceledPreview.output.target).toEqual({ connectionId: rw.id, database: 'main', table: pkTable }); expect(canceledPreview.output.sql).toEqual(expect.arrayContaining([expect.stringMatching(/UPDATE /), expect.stringMatching(/INSERT INTO /), expect.stringMatching(/DELETE FROM /)]));
    // 精确确认新增defaulted没有进入写入合同，而非用显式NULL/默认文本碰巧得到相同结果。
    expect(canceledPreview.fact?.request.changes).toEqual([
      { kind: 'update', row: 0, values: [{ column: 'note', value: { kind: 'text', value: newNote } }, { column: 'mixed', value: { kind: 'text', value: '2' } }, { column: 'nullable', value: { kind: 'null' } }, { column: 'payload', value: { kind: 'blob', value: '00aaff' } }, { column: 'exact_int', value: { kind: 'integer', value: '-9223372036854775808' } }, { column: 'real_num', value: { kind: 'real', value: '-2.75' } }] },
      { kind: 'delete', row: 2 },
      { kind: 'insert', values: [{ column: 'id', value: { kind: 'integer', value: '6' } }, { column: 'note', value: { kind: 'text', value: insertNote } }, { column: 'mixed', value: { kind: 'real', value: '2.5' } }, { column: 'nullable', value: { kind: 'text', value: '' } }, { column: 'payload', value: { kind: 'blob', value: '' } }, { column: 'exact_int', value: { kind: 'integer', value: '9223372036854775807' } }, { column: 'real_num', value: { kind: 'real', value: '1.25' } }] }
    ]);
    expect(disk()).toEqual(baseline); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toEqual([]); await step(() => preview().getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click()); await step(() => expect(preview()).toBeHidden()); await counts(1, 1, 1); expect(disk()).toEqual(baseline);
    stage = '明确确认独立事务真实提交'; const confirmedPreview = await openPreview({ insert: 1, update: 1, delete: 1 }); expect(confirmedPreview.output.previewId).not.toBe(canceledPreview.output.previewId); const committed = await apply(); expect(committed.output).toMatchObject({ outcome: 'committed', counts: { insert: 1, update: 1, delete: 1 }, fact: { phase: 'committed', requestedRows: 3, appliedRows: 3, commitAcknowledged: true, rollbackAcknowledged: false } });
    const expectedPk = [...sourceRows.filter(row => row.id !== '3').map(row => row.id === '1' ? { ...row, note: newNote, mixed_type: 'text', nullable: null, payload: '00aaff', exact_int: '-9223372036854775808', real_num: '-2.75' } : row), { id: '6', note: insertNote, mixed_type: 'real', mixed: '2.5', nullable: '', payload: '', payload_type: 'blob', exact_int: '9223372036854775807', exact_type: 'integer', real_num: '1.25', real_type: 'real', defaulted: defaultValue }].sort((a, b) => Number(a.id) - Number(b.id)); const afterCommit = { ...baseline, pk: expectedPk }; expect(disk()).toEqual(afterCommit);
    // 成功提交会真实刷新并关闭原预览；等待新网格，不用已返回IPC冒称React已完成。
    await step(() => expect(preview()).toBeHidden()); await step(() => expect(grid()).toBeVisible()); await counts(0, 0, 0);
    stage = 'WITHOUT ROWID复合主键冲突整批回滚'; await openObject(rwName, compoundTable); await step(() => expect(grid()).toBeVisible()); await sortPage(['tenant', 'id']); await step(() => expect.poll(async () => await columnValues('tenant')).toEqual(['TEXT · A', 'TEXT · A', 'TEXT · A', 'TEXT · B'])); await step(() => expect.poll(async () => await columnValues('id')).toEqual(['INTEGER · 1', 'INTEGER · 2', 'INTEGER · 3', 'INTEGER · 3']));
    const compoundPage = operations(await step(audit), 'sqlite.tablePage').at(-1); expect(result(compoundPage?.reply)).toMatchObject({ edit: { kind: 'editable', locator: { kind: 'primary-key', columns: ['tenant', 'id'] } } }); const first = await openRow(1); await input(first, 'note', 'text', conflictFirst); await save(first); const last = await openRow(3); await input(last, 'note', 'text', conflictLast); await save(last); await counts(0, 2, 0); expect(disk()).toEqual(afterCommit); const conflictPreview = await openPreview({ insert: 0, update: 2, delete: 0 });
    // 独立外部写入是本例合成库明确授权的并发观察，不通过产品IPC或同一连接模拟冲突。
    check(); const observer = new DatabaseSync(database); try { expect(observer.prepare('UPDATE "编辑复合键" SET note=? WHERE tenant=? AND id=?').run(observerNote, 'A', 3n).changes).toBe(1); } finally { observer.close(); check(); }
    const afterObserver = { ...afterCommit, compound: compoundRows.map(row => row.tenant === 'A' && row.id === '3' ? { ...row, note: observerNote } : row) }; expect(disk()).toEqual(afterObserver);
    const rolledBack = await apply(); expect(rolledBack.output).toMatchObject({ outcome: 'rolled-back', counts: { insert: 0, update: 2, delete: 0 }, fact: { phase: 'rolled-back', requestedRows: 2, appliedRows: 1, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true } }); expect(disk()).toEqual(afterObserver); await step(() => expect(preview().getByRole('button', { name: '关闭 SQLite 修改预览', exact: true })).toBeEnabled()); await step(() => preview().getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click()); await counts(0, 2, 0); await step(() => expect(grid().getByText('TEXT · ' + conflictFirst, { exact: true })).toBeVisible()); await step(() => expect(grid().getByText('TEXT · ' + conflictLast, { exact: true })).toBeVisible()); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toHaveLength(2);
    stage = '明确放弃已核保留草稿并核readonly/view禁写'; await confirm(() => table().getByRole('button', { name: '放弃 SQLite 草稿', exact: true }).click(), '当前页有 SQLite 本地草稿。放弃草稿并继续读取？选择取消会保留草稿和当前页。'); await counts(0, 0, 0); await step(() => expect(grid().getByText('TEXT · ' + observerNote, { exact: true })).toBeVisible()); expect(disk()).toEqual(afterObserver);
    const beforeReadonly = operations(await step(audit), 'sqlite.tableEdit.preview').length; await openObject(rwName, viewName); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect(grid()).toHaveCount(0)); await step(() => expect(table().getByRole('button', { name: '新增 SQLite 记录', exact: true })).toHaveCount(0)); await step(() => expect(table().getByRole('button', { name: '预览 SQLite 修改', exact: true })).toHaveCount(0)); const viewPage = operations(await step(audit), 'sqlite.tablePage').at(-1); expect(result(viewPage?.reply)).toMatchObject({ target: { kind: 'view', table: viewName }, edit: { kind: 'readonly' } });
    await openObject(roName, pkTable); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect(grid()).toHaveCount(0)); for (const button of ['新增 SQLite 记录', '删除 SQLite 当前行', '编辑 SQLite 当前行', '预览 SQLite 修改']) await step(() => expect(table().getByRole('button', { name: button, exact: true })).toHaveCount(0)); expect(operations(await step(audit), 'sqlite.tableEdit.preview')).toHaveLength(beforeReadonly); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toHaveLength(2); expect(disk()).toEqual(afterObserver);
    stage = '任务事实隐私与真实磁盘终态'; await step(() => expect.poll(async () => (await tasks()).every(task => task.status !== 'running')).toBe(true)); const firstTasks = await tasks(), persistedTasks = diskTasks();
    const assertPrivate = (records: unknown) => { const text = JSON.stringify(records); for (const privateText of [oldNote, newNote, insertNote, conflictFirst, conflictLast, observerNote, database, canonicalDatabase]) expect(text).not.toContain(privateText); expect(text).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\s/i); };
    assertPrivate(firstTasks); assertPrivate(persistedTasks); const writeTasks = firstTasks.filter(task => task.kind === 'sqlite.tableEdit.apply'); expect(writeTasks).toHaveLength(2); expect(writeTasks.map(task => task.status).sort()).toEqual(['completed', 'failed']);
    for (const applied of [committed, rolledBack]) {
      const task = writeTasks.find(record => record.id === applied.fact?.request.taskId); expect(task).toHaveProperty('sqliteWrite', applied.output.fact);
      const fact = task && 'sqliteWrite' in task ? task.sqliteWrite : undefined;
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) throw Error('持久任务缺少最小SQLite写入事实');
      expect(Object.keys(fact).sort()).toEqual(['operationId', 'target', 'phase', 'requestedRows', 'appliedRows', 'commitMayHaveBeenSent', 'commitAcknowledged', 'rollbackAcknowledged'].sort());
      const stored = persistedTasks.find(record => !!record && typeof record === 'object' && 'id' in record && record.id === task?.id); expect(stored).toHaveProperty('sqliteWrite', applied.output.fact);
    }
    expect(firstTasks.every(task => ['sqlite.tablePage', 'sqlite.tableEdit.preview', 'sqlite.tableEdit.apply'].includes(task.kind))).toBe(true); expect(await history()).toEqual([]); expect(runtime.pageErrors).toEqual([]); const firstFacts = await step(audit); expect(firstFacts.denied).toEqual([]); expect(firstFacts.pickerIds).toHaveLength(2); expect(firstFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.') || /clipboard/i.test(command))).toBe(false);
    // 活动标签明确保持只读连接，恢复启动不领取编辑快照，也不会重放旧草稿。
    await step(() => expect.poll(async () => { const saved = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return saved.tabs.find(tab => tab.id === saved.activeTabId)?.connectionId; }).toBe(ro.id)); const persisted = await settings();
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableEditNative?: { restore(): void } }).__sqliteTableEditNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile重启无写入重放'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid); await arm({ [rw.id]: false, [ro.id]: true }); armed = true; await step(() => expect(table().getByRole('grid')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(disk()).toEqual(afterObserver);
    const restoredWrites = (await tasks()).filter(task => task.kind === 'sqlite.tableEdit.apply'); expect(restoredWrites).toEqual(writeTasks); assertPrivate(await tasks()); assertPrivate(diskTasks()); expect(await history()).toEqual([]); const beforeRefresh = operations(await step(audit), 'sqlite.tablePage').length; await step(() => table().getByRole('button', { name: '刷新 SQLite 表数据', exact: true }).click()); await step(() => expect.poll(async () => operations(await audit(), 'sqlite.tablePage').length).toBe(beforeRefresh + 1)); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await tasks()).every(task => task.status !== 'running')).toBe(true));
    const secondFacts = await step(audit); expect(secondFacts.pickerIds).toEqual([]); expect(secondFacts.denied).toEqual([]); expect(operations(secondFacts, 'sqlite.tableEdit.apply')).toEqual([]); expect(operations(secondFacts, 'sqlite.tableEdit.preview')).toEqual([]); expect(runtime.pageErrors).toEqual([]); expect(disk()).toEqual(afterObserver);
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableEditNative?: { restore(): void } }).__sqliteTableEditNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(afterObserver);
    await info.attach('SQLite表格编辑真实请求事务回执与独立磁盘原件', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, canonicalDatabaseBeforePicker: canonicalDatabase, firstPid, secondPid: originalProcess.pid, baseline, afterCommit, afterIndependentObserverAndRollback: afterObserver, finalDisk: disk(), canceledPreview, confirmedPreview, committed, conflictPreview, rolledBack, firstFacts, secondFacts, firstTasks, persistedTasks, firstExitCode: 0, secondExitCode: originalProcess.exitCode, localDraftWrites: 0, canceledPreviewWrites: 0, explicitApplyBatches: 2, committedBatches: 1, acknowledgedRollbackBatches: 1, sourceOutsideControlProtected: true, userQueryExecutions: 0, systemClipboardOperations: 0, automaticRetry: false, automaticTrace: false, queryTransactionIsolationScope: '本GUI禁止query/session IPC；正在使用的用户查询事务不被借用的精确并发边界由独立后端单元验证，不冒称本GUI已覆盖', pickerScope: '只替换两次自身Main文件chooser准确返回值，未验证操作系统对话框输入', observationScope: '每次原窗口就绪后安装至退出前撤销；不冒称观察恢复首读' }), contentType: 'application/json' }); completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableEditNative?: Audit }).__sqliteTableEditNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, pickerIds: state.pickerIds, profiles: state.profiles, commands: state.commands, operations: state.operations, events: state.events } : undefined; }); } catch { /* 原观察器失效不重建、不补造历史事实。 */ }
    try { await info.attach('SQLite表格编辑失败原件保留', { body: JSON.stringify({ stage, directory, database, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, partial, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件失败不覆盖首因或解除owner保留。 */ } throw reason;
  }
});

/** 原ownedfixture只有准确正常退出后才清理；专项不递归删除任何路径。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing, '原ownedfixture必须在成功退出后清理本例profile与SQLite').toBe(true); await info.attach('SQLite表格编辑最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
