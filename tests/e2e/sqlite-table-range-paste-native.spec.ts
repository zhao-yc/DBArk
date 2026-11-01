import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteTableRangePasteZh as rangeText } from '../../src/renderer/locales/sqliteTableRangePaste.zh-CN';

// 默认/--list不加载桌面、NodeSQLite或文件句柄，仅注册一个明确跳过项。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list=')), active = !listing && process.env.DBARK_SQLITE_TABLE_RANGE_PASTE_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key) || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key) || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key) || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite区域粘贴专项仅允许Windows/macOS源码、integration=0与独占合成文件；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite区域粘贴专项禁止自动trace');
}
type Desktop = typeof import('./desktop-fixture');
interface Fact { command: string; request: Record<string, unknown>; reply?: unknown; failure?: string; }
interface WorkerTrace { id: number; sent: { kind: string; id?: string; frame?: number; control?: string }[]; received: { kind: string; id?: string; frame?: number }[]; exit?: number; kills: number; }
interface Audit { pending: number; denied: string[]; pickerIds: string[]; profiles: Record<string, boolean>; commands: string[]; operations: Fact[]; events: unknown[]; workers: WorkerTrace[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_TABLE_RANGE_PASTE_NATIVE_TEST=1、integration=0，仅DataTransfer不操作系统剪贴板');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const rwName = 'SQLite区域本例读写', roName = 'SQLite区域本例只读', tableName = '粘贴"原表🚢';
let completed: { directory: string; database: string; firstPid?: number; secondPid?: number; platform: string } | undefined;
/** 未取得两次正常退出与准确资源清理前，原owner/profile/合成库全部保留，不重试或强停。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite区域粘贴专项未完成两次准确正常退出，原现场已保留'); } });

test('真实矩形按位置覆盖原行、old/new预览、单步undo/redo、Main提交与并发冲突整批回滚、重启零重放', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, { join, dirname, resolve, basename } = require('node:path') as typeof import('node:path'), { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), { realpathSync } = require('node:fs') as typeof import('node:fs');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, applicationProcess = application.process(), closed = false, armed = false, stage = '独占SQLite准备';
  const directory = runtime.dataDir, database = join(directory, 'sqlite-table-range-paste-native.sqlite'), columns = ['id', 'label', 'g', 'exact', 'payload', 'nullable'];
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite粘贴owner/profile/120秒单次期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteRangePasteNative?: Audit & { check(): void } }).__sqliteRangePasteNative; if (!state) throw Error('原粘贴Main观察器不存在'); state.check(); return { pending: state.pending, denied: state.denied, pickerIds: state.pickerIds, profiles: state.profiles, commands: state.commands, operations: state.operations, events: state.events, workers: state.workers }; });
  const step = async <T,>(action: () => Promise<T>, skipAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const value = await action(); check(); if (armed && !closed && !skipAfter) await audit(); return value; };
  const table = () => page.locator('.table-tab:visible'), grid = () => table().getByRole('grid', { name: 'SQLite 表格编辑', exact: true }), rangeModal = () => page.getByRole('dialog', { name: rangeText.title, exact: true }), previewModal = () => page.getByRole('dialog', { name: '预览 SQLite 集中修改', exact: true });
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))), history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  const operations = (facts: Audit, command: string) => facts.operations.filter(fact => fact.command === command);
  const result = (raw: unknown): Record<string, unknown> => { if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !('result' in raw) || !raw.result || typeof raw.result !== 'object' || Array.isArray(raw.result)) throw Error('SQLite粘贴缺少原Main成功封套'); return raw.result as Record<string, unknown>; };
  /** 独立观察只读准确本例文件，64位以CAST文本并额外核typeof；不触碰真实配置/剪贴板。 */
  const disk = () => { check(); if (dirname(resolve(database)) !== resolve(directory)) throw Error('SQLite粘贴磁盘观察越界'); const db = new DatabaseSync(database, { readOnly: true }); try { return { rows: db.prepare('SELECT CAST(id AS TEXT) AS id,label,g,CAST(exact AS TEXT) AS exact,typeof(exact) AS exact_type,lower(hex(payload)) AS payload,typeof(payload) AS payload_type,nullable FROM "粘贴""原表🚢" ORDER BY id').all(), control: db.prepare('SELECT id,value FROM outside_control ORDER BY id').all() }; } finally { db.close(); check(); } };
  const persistedTasks = () => { check(); const db = new DatabaseSync(join(directory, 'dbark.sqlite'), { readOnly: true }); try { return db.prepare('SELECT data FROM tasks ORDER BY id').all().map(row => { if (typeof row.data !== 'string') throw Error('原任务持久记录不是JSON'); return JSON.parse(row.data) as unknown; }); } finally { db.close(); check(); } };
  /** 只替换两次本例chooser，原IPC/SQLiteworker/任务与退出真实透传；worker所有帧/ACK/exit另记原件。 */
  const arm = (canonicalDatabase: string, savedProfiles: Record<string, boolean> = {}) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void };
    const root = globalThis as typeof globalThis & { __sqliteRangePasteNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window?.webContents.mainFrame, originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork, originalSend = window?.webContents.send;
    if (!original || !window || !frame || !originalSend || BrowserWindow.getAllWindows().length !== 1 || root.__sqliteRangePasteNative) throw Error('粘贴专项原Main入口未知');
    const state: State = { pending: 0, denied: [], pickerIds: [], profiles: { ...input.savedProfiles }, commands: [], operations: [], events: [], workers: [], check() {}, restore() {} }, snapshots = new Set<string>(), previews = new Set<string>(), workerReleases: (() => void)[] = []; let pickerRequest: string | undefined;
    const deny = (name: string): never => { state.denied.push(name); throw Error('SQLite区域粘贴专项拒绝越界：' + name); };
    const check = () => { if (root.__sqliteRangePasteNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.webContents.send !== send || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('SQLite粘贴原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions; if (Object.keys(input.savedProfiles).length || !pickerRequest || state.pickerIds.includes(pickerRequest) || state.pickerIds.length >= 2 || !options?.properties?.includes('openFile')) return deny('非本例文件chooser'); state.pickerIds.push(pickerRequest); return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
    const save = (() => deny('未授权文件保存对话框')) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => {
      check(); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite worker'); const child = Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]) as Electron.UtilityProcess, trace: WorkerTrace = { id: state.workers.length + 1, sent: [], received: [], kills: 0 }; state.workers.push(trace); const originalPost = child.postMessage, originalKill = child.kill;
      const post = ((...messages: unknown[]) => { const raw = messages[0]; if (raw && typeof raw === 'object' && 'kind' in raw && typeof raw.kind === 'string') { const value = raw as Record<string, unknown>; if (value.kind === 'open' && (!value.options || typeof value.options !== 'object' || !('path' in value.options) || value.options.path !== input.canonicalDatabase)) return deny('worker实际文件越界'); trace.sent.push({ kind: value.kind as string, ...(typeof value.id === 'string' ? { id: value.id } : {}), ...(typeof value.frame === 'number' ? { frame: value.frame } : {}), ...(value.kind === 'execute' && typeof value.sql === 'string' && ['BEGIN', 'BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'].includes(value.sql) ? { control: value.sql } : {}) }); } return Reflect.apply(originalPost, child, messages); }) as typeof child.postMessage;
      const kill = (() => { trace.kills++; return Reflect.apply(originalKill, child, []); }) as typeof child.kill;
      const receive = (raw: unknown) => { if (raw && typeof raw === 'object' && 'kind' in raw && typeof raw.kind === 'string') { const value = raw as Record<string, unknown>; trace.received.push({ kind: raw.kind, ...(typeof value.id === 'string' ? { id: value.id } : {}), ...(typeof value.frame === 'number' ? { frame: value.frame } : {}) }); } }; child.postMessage = post; child.kill = kill; child.on('message', receive); child.once('exit', code => { trace.exit = code; }); workerReleases.push(() => { if (child.postMessage !== post || child.kill !== kill) throw Error('原SQLiteworker观察器已变化'); child.postMessage = originalPost; child.kill = originalKill; child.off('message', receive); }); return child;
    }) as typeof utilityProcess.fork;
    const send = ((channel: string, ...args: unknown[]) => { if (channel === 'dbark:task') state.events.push(structuredClone(args[0])); return Reflect.apply(originalSend, window.webContents, [channel, ...args]); }) as typeof window.webContents.send;
    // 本机布局只读共用原表页的准确连接/数据库/对象范围，不放宽数据库操作。
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame || !payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('外来文档/非标准IPC'); const command = payload.command, value = payload.input as Record<string, unknown>;
      if (command === 'sqlite.tableLayout.get' && (Object.keys(value).length !== 3 || Object.keys(value).some(key => !['connectionId', 'database', 'table'].includes(key)))) return deny('其它SQLite本机列布局');

      if (/clipboard/i.test(command) || command === 'files.path' || /^(?:query|sessions|table|schema|serverMonitor)\./.test(command) || ['files.export', 'files.exportResult', 'excel.export', 'sqlite.tableExport'].includes(command)) return deny(command);
      if (command.startsWith('sqlite.') && !['sqlite.tableLayout.get', 'sqlite.tablePage', 'sqlite.tableEdit.preview', 'sqlite.tableEdit.apply', 'sqlite.tableEdit.release'].includes(command)) return deny(command); if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest || value.purpose !== 'sqlite-database' || typeof value.sqliteConnectionId !== 'string') return deny('文件选择归属'); pickerRequest = value.sqliteConnectionId; }
      if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite, readonly = value.name === input.rwName ? false : value.name === input.roName ? true : undefined; if (value.dialect !== 'sqlite' || typeof value.id !== 'string' || !state.pickerIds.includes(value.id) || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== readonly || readonly === undefined || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例SQLite配置'); state.profiles[value.id] = readonly; }
      if (command === 'connections.open' && !Object.hasOwn(state.profiles, String(value.id)) || command.startsWith('metadata.') && !Object.hasOwn(state.profiles, String(value.connectionId))) return deny('非本例连接');
      if ((command === 'sqlite.tablePage' || command === 'sqlite.tableLayout.get') && (!Object.hasOwn(state.profiles, String(value.connectionId)) || value.database !== 'main' || value.table !== input.tableName)) return deny('非本例表');
      if (command === 'sqlite.tableEdit.preview' && !snapshots.has(String(value.snapshotId)) || command === 'sqlite.tableEdit.apply' && !previews.has(String(value.previewId)) || command === 'sqlite.tableEdit.release' && !(snapshots.has(String(value.snapshotId)) || previews.has(String(value.previewId)))) return deny('非本例原编辑能力');
      const fact: Fact | undefined = command === 'sqlite.tablePage' || command.startsWith('sqlite.tableEdit.') ? { command, request: structuredClone(value) } : undefined; if (fact) state.operations.push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply); if (reply && typeof reply === 'object' && 'ok' in reply && reply.ok === true && 'result' in reply && reply.result && typeof reply.result === 'object') { const result = reply.result; if (command === 'sqlite.tablePage' && 'edit' in result && result.edit && typeof result.edit === 'object' && 'kind' in result.edit && result.edit.kind === 'editable' && 'snapshotId' in result.edit && typeof result.edit.snapshotId === 'string') snapshots.add(result.edit.snapshotId); if (command === 'sqlite.tableEdit.preview' && 'previewId' in result && typeof result.previewId === 'string') previews.add(result.previewId); } return reply; }
      catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; } finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending || state.workers.some(worker => worker.exit !== 0 || worker.kills !== 0)) throw Error('原SQLite请求/worker正常退出尚未确认'); for (const release of workerReleases) release(); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; window.webContents.send = originalSend; delete root.__sqliteRangePasteNative; }; root.__sqliteRangePasteNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; window.webContents.send = send; check();
  }, { database, canonicalDatabase, rwName, roName, tableName, savedProfiles }));
  const createConnection = async (name: string, readOnly: boolean) => { await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }); await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(name)); await step(() => form.locator('select').selectOption('sqlite')); if (!readOnly) await step(() => form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck()); await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden()); };
  const openTable = async (name: string) => { const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').filter({ hasText: name }) }), main = connection.locator('.database-row .tree-label').filter({ hasText: /^main$/ }); await step(() => expect(connection).toHaveCount(1)); if (!await step(() => main.isVisible())) await step(() => connection.locator('.connection-row .tree-label').filter({ hasText: name }).click()); const target = connection.locator('.object-row .tree-label').filter({ hasText: tableName }); if (!await step(() => target.isVisible())) await step(() => main.click()); await step(() => target.dblclick()); await step(() => expect(table()).toBeVisible()); };
  const counts = (update: number) => step(() => expect(table().getByRole('status').filter({ hasText: `本地草稿：新增 0 行，修改 ${update} 行，删除 0 行` })).toBeVisible());
  /** 从真实网格列头解析实际aria列位置，生成列仅作负例，不调用父层业务函数。 */
  const cell = async (rowIndex: number, name: string) => {
    const index = columns.indexOf(name); if (index < 0) throw Error('本例未知SQLite列');
    await step(() => (require('./sqlite-grid-navigation') as typeof import('./sqlite-grid-navigation')).revealSqliteEditColumn(page, grid(), index, check));
    const header = grid().getByRole('columnheader').filter({ hasText: new RegExp('^' + name + '(?: ·.*)?$') });
    await step(() => expect(header).toHaveCount(1)); const position = await step(() => header.getAttribute('aria-colindex'));
    if (!position || !/^[1-9][0-9]*$/.test(position)) throw Error('原矩形起点列位置未知');
    return grid().locator('[role="row"][aria-rowindex="' + (rowIndex + 1) + '"] [role="gridcell"][aria-colindex="' + position + '"]');
  };
  const selectCell = async (row: number, column: string) => { const target = await cell(row, column); await step(() => target.click()); return target; };
  type NativeCell = { kind: 'integer' | 'real' | 'text' | 'blob'; value: string } | { kind: 'null' | 'default' };
  const packet = (rows: NativeCell[][]) => JSON.stringify({ version: 1, rows, columns: rows[0].length === 2 ? ['payload', 'exact'] : ['nullable'] });
  /** 仅合成DOM DataTransfer；来源列名故意相反，矩形应按准确起点位置而非列名重排。 */
  const dispatchPaste = (content: string) => step(() => grid().evaluate((node, source) => {
    const data = new DataTransfer(); data.setData('application/x-dbark-sqlite-cells', source);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }); node.dispatchEvent(event); return event.defaultPrevented;
  }, content));
  const noLocalWrites = async (expected: ReturnType<typeof disk>) => {
    expect(disk()).toEqual(expected); const facts = await step(audit); expect(operations(facts, 'sqlite.tableEdit.preview')).toEqual([]); expect(operations(facts, 'sqlite.tableEdit.apply')).toEqual([]);
  };
  const closeRange = async () => { await step(() => rangeModal().getByRole('button', { name: rangeText.cancel, exact: true }).click()); await step(() => expect(rangeModal()).toBeHidden()); };
  const rejectedRange = async (row: number, column: string, rows: NativeCell[][], message: string, expected: ReturnType<typeof disk>) => {
    await selectCell(row, column); expect(await dispatchPaste(packet(rows))).toBe(true); await step(() => expect(rangeModal()).toBeVisible());
    await step(() => rangeModal().getByRole('button', { name: rangeText.preview, exact: true }).click());
    await step(() => expect(rangeModal().getByRole('alert')).toHaveText(message)); await step(() => expect(rangeModal().getByRole('button', { name: rangeText.stage, exact: true })).toBeDisabled());
    await closeRange(); await counts(0); await noLocalWrites(expected);
  };
  const previewRange = async (rows: NativeCell[][]) => {
    await selectCell(1, 'exact'); expect(await dispatchPaste(packet(rows))).toBe(true); await step(() => expect(rangeModal()).toBeVisible());
    await step(() => rangeModal().getByRole('button', { name: rangeText.preview, exact: true }).click());
    await step(() => expect(rangeModal().getByRole('table', { name: rangeText.previewRows, exact: true })).toBeVisible());
    await step(() => expect(rangeModal().getByText(rangeText.changedCounts(2, 2, 4), { exact: true })).toBeVisible());
    return rangeModal().getByRole('table', { name: rangeText.previewRows, exact: true });
  };
  const stageRange = async () => { await step(() => rangeModal().getByRole('button', { name: rangeText.stage, exact: true }).click()); await step(() => expect(rangeModal()).toBeHidden()); await counts(2); };
  const openSqlPreview = async () => {
    const before = operations(await step(audit), 'sqlite.tableEdit.preview').length;
    await step(() => table().getByRole('button', { name: '预览 SQLite 修改', exact: true }).click()); await step(() => expect(previewModal()).toBeVisible());
    await step(() => expect.poll(async () => { const facts = operations(await audit(), 'sqlite.tableEdit.preview'); return facts.length === before + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true));
    const fact = operations(await step(audit), 'sqlite.tableEdit.preview').at(-1)!; expect(fact.failure).toBeUndefined(); expect(result(fact.reply).counts).toEqual({ insert: 0, update: 2, delete: 0 }); return fact;
  };
  const applySql = async () => {
    const before = operations(await step(audit), 'sqlite.tableEdit.apply').length;
    await step(() => previewModal().getByRole('checkbox', { name: '确认提交 SQLite 集中修改', exact: true }).check()); await step(() => previewModal().getByRole('button', { name: '提交 SQLite 修改', exact: true }).click());
    await step(() => expect.poll(async () => { const facts = operations(await audit(), 'sqlite.tableEdit.apply'); return facts.length === before + 1 && facts.at(-1)?.reply !== undefined; }).toBe(true));
    const fact = operations(await step(audit), 'sqlite.tableEdit.apply').at(-1)!; expect(fact.failure).toBeUndefined(); return { fact, output: result(fact.reply) };
  };
  const restore = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteRangePasteNative?: { restore(): void } }).__sqliteRangePasteNative; if (!state) throw Error('原区域粘贴观察器失效'); state.restore(); }), true);
  const assertWorkers = (facts: Audit) => {
    expect(facts.pending).toBe(0); expect(facts.denied).toEqual([]);
    for (const worker of facts.workers) { expect(worker.exit).toBe(0); expect(worker.kills).toBe(0); expect(worker.sent.filter(frame => frame.kind === 'open')).toHaveLength(1); const closed = worker.received.filter(frame => frame.kind === 'closed'); expect(closed).toHaveLength(1); expect(worker.sent.filter(frame => frame.kind === 'closeAck')).toEqual([{ kind: 'closeAck', id: closed[0].id }]); for (const frame of worker.received.filter(frame => frame.kind === 'statement' || frame.kind === 'batch')) expect(worker.sent).toContainEqual({ kind: 'ack', id: frame.id, frame: frame.frame }); }
  };
  const privateA = 'RANGE_ORIGINAL_A_中文🚢', privateB = 'RANGE_ORIGINAL_B_空文本', observerLabel = 'RANGE_EXTERNAL_OBSERVER_保留', conflictMarker = 'RANGE_LOCAL_CONFLICT_不入库';
  const firstValues: NativeCell[][] = [[{ kind: 'integer', value: '-9223372036854775808' }, { kind: 'blob', value: '00aaff' }], [{ kind: 'integer', value: '9223372036854775807' }, { kind: 'null' }]];
  const conflictValues: NativeCell[][] = [[{ kind: 'integer', value: '7' }, { kind: 'blob', value: 'aabb' }], [{ kind: 'integer', value: '8' }, { kind: 'blob', value: 'ccdd' }]];
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await step(() => application.evaluate(({ BrowserWindow }) => { const windows = BrowserWindow.getAllWindows(); if (windows.length !== 1) throw Error('非本例唯一窗口'); windows[0].setSize(1024, 768); })); expect(basename(directory)).toMatch(/^dbark-e2e-/); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    const db = new DatabaseSync(database);
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE "粘贴""原表🚢"(id INTEGER PRIMARY KEY,label TEXT NOT NULL,g TEXT GENERATED ALWAYS AS(label||\':\'||id) STORED,exact INTEGER,payload BLOB,nullable TEXT DEFAULT \'默认文本\'); CREATE TABLE outside_control(id TEXT PRIMARY KEY,value TEXT); INSERT INTO outside_control VALUES(\'owner-only\',\'界外原值\')');
      const insert = db.prepare('INSERT INTO "粘贴""原表🚢"(id,label,exact,payload,nullable) VALUES(?,?,?,?,?)'); insert.run(41n, privateA, 9223372036854775807n, Buffer.from('00ff', 'hex'), null); insert.run(42n, privateB, -9223372036854775808n, Buffer.from([]), '');
    } finally { db.close(); }
    const canonicalDatabase = realpathSync(database), baseline = disk(); expect(baseline.rows).toHaveLength(2); await arm(canonicalDatabase); armed = true;
    stage = '真实RW/RO连接与排序后的原页';
    await createConnection(rwName, false); await createConnection(roName, true);
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))), rw = profiles.find(profile => profile.name === rwName), ro = profiles.find(profile => profile.name === roName);
    if (!rw || rw.dialect !== 'sqlite' || !ro || ro.dialect !== 'sqlite') throw Error('本例区域SQLite连接缺失');
    expect(rw.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: false }); expect(ro.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true }); await openTable(rwName); await step(() => expect(grid()).toBeVisible());
    await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel('SQLite 排序 1 字段', { exact: true }).selectOption('id'));
    const beforeSort = operations(await step(audit), 'sqlite.tablePage').length; await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click());
    await step(() => expect.poll(async () => { const reads = operations(await audit(), 'sqlite.tablePage'); return reads.length === beforeSort + 1 && reads.at(-1)?.reply !== undefined; }).toBe(true));
    await step(() => expect(grid().getByRole('button', { name: '选择 SQLite 第 2 行', exact: true })).toBeVisible()); await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); await counts(0);
    const sourcePage = operations(await step(audit), 'sqlite.tablePage').at(-1); expect((result(sourcePage?.reply).columns as { name: string }[]).map(column => column.name)).toEqual(columns);
    stage = '无准确数据起点不得打开区域窗口，行头不能冒充数据格';
    await step(() => grid().getByRole('button', { name: '选择 SQLite 第 1 行', exact: true }).click()); expect(await dispatchPaste(packet([[{ kind: 'text', value: conflictMarker }]]))).toBe(true);
    await step(() => expect(rangeModal()).toHaveCount(0)); await step(() => expect(table().locator('.sqlite-edit-clipboard-region').getByRole('alert')).toHaveText(rangeText.anchorRequired)); await noLocalWrites(baseline);
    stage = '矩形纵/横越界、生成列与已有行DEFAULT整组拒绝';
    await rejectedRange(2, 'exact', firstValues, rangeText.outOfBounds, baseline);
    await rejectedRange(1, 'nullable', [[{ kind: 'text', value: '前' }, { kind: 'text', value: '越界' }]], rangeText.outOfBounds, baseline);
    await rejectedRange(1, 'label', [[{ kind: 'text', value: '不可部分改' }, { kind: 'text', value: '生成列' }]], rangeText.generated, baseline);
    await rejectedRange(1, 'exact', [[{ kind: 'default' }]], rangeText.defaultExisting, baseline);
    stage = '从真实exact单元格粘贴2x2，前十行old/new按位置展示并保64位/BLOB/NULL';
    const localPreview = await previewRange(firstValues);
    await step(() => expect(localPreview.locator('thead th')).toHaveText(['#', 'exact', 'payload'])); await step(() => expect(localPreview.locator('tbody tr')).toHaveCount(2));
    await step(() => expect(localPreview.locator('tbody tr').nth(0).locator('td').nth(1)).toContainText('9223372036854775807'));
    await step(() => expect(localPreview.locator('tbody tr').nth(0).locator('td').nth(1)).toContainText('-9223372036854775808'));
    await step(() => expect(localPreview.locator('tbody tr').nth(0).locator('td').nth(2)).toContainText('00ff')); await step(() => expect(localPreview.locator('tbody tr').nth(0).locator('td').nth(2)).toContainText('00aaff'));
    await step(() => expect(localPreview.locator('tbody tr').nth(1).locator('td').nth(2)).toContainText('NULL')); await noLocalWrites(baseline); await stageRange();
    stage = '原脏页跨RO标签往返后真实More仍可打开空区域窗口并取消';
    const beforeMenu = await step(audit); await openTable(roName); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect(grid()).toHaveCount(0)); await openTable(rwName); await counts(2); await selectCell(1, 'exact');
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(table(), { name: rangeText.entry, exact: true }, check)).click());
    await step(() => expect(rangeModal()).toBeVisible()); await step(() => expect(rangeModal().getByLabel(rangeText.source, { exact: true })).toHaveValue('')); await step(() => expect(rangeModal().getByRole('button', { name: rangeText.preview, exact: true })).toBeDisabled()); await step(() => expect(rangeModal().getByRole('button', { name: rangeText.stage, exact: true })).toBeDisabled()); await closeRange(); await counts(2);
    const afterMenu = await step(audit); expect(operations(afterMenu, 'sqlite.tableEdit.preview')).toHaveLength(operations(beforeMenu, 'sqlite.tableEdit.preview').length); expect(operations(afterMenu, 'sqlite.tableEdit.apply')).toHaveLength(operations(beforeMenu, 'sqlite.tableEdit.apply').length); expect(disk()).toEqual(baseline);
    stage = '一次undo恢复原两行，redo恢复同一矩形但仍零DB写入';
    await step(() => table().getByRole('button', { name: '撤销 SQLite 草稿', exact: true }).click()); await counts(0);
    const oldExact = await cell(1, 'exact'); await step(() => expect(oldExact).toHaveText('INTEGER · 9223372036854775807'));
    await step(() => table().getByRole('button', { name: '重做 SQLite 草稿', exact: true }).click()); await counts(2); const newExact = await cell(1, 'exact'); await step(() => expect(newExact).toHaveText('INTEGER · -9223372036854775808')); await noLocalWrites(baseline);
    stage = '正式Main SQL预览取消不写入，再明确确认集中提交';
    const canceled = await openSqlPreview(); expect(canceled.request.changes).toEqual([
      { kind: 'update', row: 0, values: [{ column: 'exact', value: { kind: 'integer', value: '-9223372036854775808' } }, { column: 'payload', value: { kind: 'blob', value: '00aaff' } }] },
      { kind: 'update', row: 1, values: [{ column: 'exact', value: { kind: 'integer', value: '9223372036854775807' } }, { column: 'payload', value: { kind: 'null' } }] }
    ]);
    expect(disk()).toEqual(baseline); await step(() => previewModal().getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click()); await counts(2); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toEqual([]);
    const confirmed = await openSqlPreview(); expect(result(confirmed.reply).previewId).not.toBe(result(canceled.reply).previewId); const committed = await applySql(); expect(committed.output).toMatchObject({ outcome: 'committed', counts: { insert: 0, update: 2, delete: 0 }, fact: { requestedRows: 2, appliedRows: 2, commitAcknowledged: true, rollbackAcknowledged: false } });
    await step(() => expect(previewModal()).toBeHidden()); await counts(0); const afterCommit = disk(); expect(afterCommit).toEqual({ ...baseline, rows: [{ ...baseline.rows[0], exact: '-9223372036854775808', payload: '00aaff', payload_type: 'blob' }, { ...baseline.rows[1], exact: '9223372036854775807', payload: '', payload_type: 'null' }] });
    stage = '第二行被独立观察者修改，原Main更新首行后冲突整批ROLLBACK';
    await previewRange(conflictValues); await stageRange(); const conflictPreview = await openSqlPreview(); check(); const observer = new DatabaseSync(database);
    try { expect(observer.prepare('UPDATE "粘贴""原表🚢" SET label=? WHERE id=?').run(observerLabel, 42n).changes).toBe(1); } finally { observer.close(); check(); }
    const afterObserver = { ...afterCommit, rows: afterCommit.rows.map(row => row.id === '42' ? { ...row, label: observerLabel, g: observerLabel + ':42' } : row) }; expect(disk()).toEqual(afterObserver);
    const rolledBack = await applySql(); expect(rolledBack.output).toMatchObject({ outcome: 'rolled-back', counts: { insert: 0, update: 2, delete: 0 }, fact: { requestedRows: 2, appliedRows: 1, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true } }); expect(disk()).toEqual(afterObserver);
    await step(() => previewModal().getByRole('button', { name: '关闭 SQLite 修改预览', exact: true }).click()); await counts(2); const retained = await cell(1, 'exact'); await step(() => expect(retained).toHaveText('INTEGER · 7')); expect(operations(await step(audit), 'sqlite.tableEdit.apply')).toHaveLength(2);
    stage = '明确放弃保留草稿，readonly不授区域粘贴，重启保持原提交与观察者值';
    await step(() => runtime.answerDialogs([0], application)); const dialog = page.waitForEvent('dialog'); const [prompt] = await Promise.all([dialog, step(() => table().getByRole('button', { name: '放弃 SQLite 草稿', exact: true }).click())]); check(); expect(prompt.type()).toBe('confirm'); expect(prompt.message()).toBe('当前页有 SQLite 本地草稿。放弃草稿并继续读取？选择取消会保留草稿和当前页。'); await counts(0); expect(disk()).toEqual(afterObserver);
    await openTable(roName); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect(grid()).toHaveCount(0));
    await step(() => table().getByRole('grid').evaluate((node, source) => { const data = new DataTransfer(); data.setData('application/x-dbark-sqlite-cells', source); node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, packet(firstValues)));
    await step(() => expect(rangeModal()).toHaveCount(0)); await step(() => expect(table().getByRole('button', { name: '预览 SQLite 修改', exact: true })).toHaveCount(0)); expect(disk()).toEqual(afterObserver);
    await step(() => expect.poll(async () => (await tasks()).every(task => task.status !== 'running')).toBe(true)); const firstTasks = await tasks(), storedTasks = persistedTasks(), writeTasks = firstTasks.filter(task => task.kind === 'sqlite.tableEdit.apply'); expect(writeTasks).toHaveLength(2); expect(writeTasks.map(task => task.status).sort()).toEqual(['completed', 'failed']);
    const assertPrivate = (value: unknown) => { const encoded = JSON.stringify(value); for (const secret of [privateA, privateB, observerLabel, conflictMarker, database, canonicalDatabase]) expect(encoded).not.toContain(secret); expect(encoded).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\s/i); }; assertPrivate(firstTasks); assertPrivate(storedTasks); expect(await history()).toEqual([]); expect(runtime.pageErrors).toEqual([]);
    await step(() => expect.poll(async () => { const facts = await audit(); return facts.pending === 0 && facts.workers.every(worker => worker.exit === 0); }).toBe(true)); const firstFacts = await step(audit); assertWorkers(firstFacts); expect(firstFacts.pickerIds).toHaveLength(2); expect(operations(firstFacts, 'sqlite.tableEdit.apply')).toHaveLength(2);
    await step(() => expect.poll(async () => { const saved = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return saved.tabs.find(tab => tab.id === saved.activeTabId)?.connectionId; }).toBe(ro.id)); const persisted = await settings(); await restore(); armed = false;
    stage = '第一owner准确正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(applicationProcess.exitCode).toBe(0); const firstPid = applicationProcess.pid;
    stage = '同profile重启零草稿/SQL重放'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; applicationProcess = application.process(); closed = false; check(); expect(applicationProcess.pid).not.toBe(firstPid); await arm(canonicalDatabase, { [rw.id]: false, [ro.id]: true }); armed = true;
    await step(() => expect(table().getByRole('grid')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(disk()).toEqual(afterObserver); expect((await tasks()).filter(task => task.kind === 'sqlite.tableEdit.apply')).toEqual(writeTasks); assertPrivate(await tasks()); assertPrivate(persistedTasks()); expect(await history()).toEqual([]);
    const beforeRefresh = operations(await step(audit), 'sqlite.tablePage').length; await step(() => table().getByRole('button', { name: '刷新 SQLite 表数据', exact: true }).click()); await step(() => expect.poll(async () => { const reads = operations(await audit(), 'sqlite.tablePage'); return reads.length === beforeRefresh + 1 && reads.at(-1)?.reply !== undefined; }).toBe(true)); await step(() => expect(table().getByRole('grid')).toBeVisible());
    await step(() => expect.poll(async () => { const facts = await audit(); return facts.pending === 0 && facts.workers.every(worker => worker.exit === 0); }).toBe(true)); const secondFacts = await step(audit); assertWorkers(secondFacts); expect(secondFacts.pickerIds).toEqual([]); expect(operations(secondFacts, 'sqlite.tableEdit.apply')).toEqual([]); expect(operations(secondFacts, 'sqlite.tableEdit.preview')).toEqual([]); expect(runtime.pageErrors).toEqual([]); expect(disk()).toEqual(afterObserver); await restore(); armed = false;
    stage = '第二owner准确正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(applicationProcess.exitCode).toBe(0); expect(disk()).toEqual(afterObserver);
    await info.attach('SQLite区域粘贴真实IPC/typed磁盘/帧ACK资源原件', { body: JSON.stringify({ platform: process.platform, database, canonicalDatabase, firstPid, secondPid: applicationProcess.pid, baseline, afterCommit, afterObserver, finalDisk: disk(), firstValues, conflictValues, canceled, confirmed, committed, conflictPreview, rolledBack, firstFacts, secondFacts, firstTasks, storedTasks, regionMatrix: '2x2 exact/payload按位置；source.columns故意反序', rejected: ['无起点', '行/列越界', '生成列', '已有行DEFAULT', 'readonly'], localPreviewWrites: 0, localStageWrites: 0, explicitApplyBatches: 2, committedBatches: 1, acknowledgedRollbackBatches: 1, systemClipboardOperations: 0, normalOwnerExits: 2, workerFramesAndExactExitObserved: true, automaticRetry: false, automaticTrace: false, chooserScope: '仅替换两次本例Main文件chooser，未验证OS对话框输入', restorationObservation: '窗口就绪后至正常退出前；恢复首读不冒称已被Main观察器捕获' }), contentType: 'application/json' });
    completed = { directory, database, firstPid, secondPid: applicationProcess.pid, platform: process.platform };

  } catch (reason) { runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined; if (armed && !closed) try { partial = await audit(); } catch { /* 原观察器失败不重装或补造已丢失事实。 */ } try { await info.attach('SQLite粘贴失败原件保留', { body: JSON.stringify({ stage, directory, database, pid: applicationProcess.pid, closed, armed, partial, firstError: reason instanceof Error ? reason.message : String(reason), automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false }), contentType: 'application/json' }); } catch { /* 附件错误不覆盖首因或解除owner保留。 */ } throw reason; }
});

/** 仅原ownedfixture在两次准确正常退出后删除独占profile，专项不递归删除任何路径。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing).toBe(true); await info.attach('SQLite粘贴最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, launches: 2, systemClipboardOperations: 0, accepted: true }), contentType: 'application/json' }); });
