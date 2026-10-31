import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';

// 默认和--list仅注册一个跳过项；原生桌面及磁盘reader只在显式离线专项内加载。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_SQLITE_TABLE_EXPORT_NATIVE_TEST === '1';
if (active) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key)
    || /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key)
    || /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key)
    || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (process.env.DBARK_INTEGRATION_ENABLED !== '0' || forbidden.length || !['win32', 'darwin'].includes(process.platform)) throw Error('SQLite全量导出只允许Windows/macOS源码、integration=0和无外库认证环境；拒绝字段：' + forbidden.join(','));
  for (const [index, value] of process.argv.entries()) if ((value === '--trace' && process.argv[index + 1] !== 'off') || value.startsWith('--trace=') && value !== '--trace=off') throw Error('SQLite全量导出禁止自动trace');
}

type Desktop = typeof import('./desktop-fixture');
type Format = 'csv' | 'json' | 'sql' | 'xlsx';
type Fact = { request: Record<string, unknown>; reply?: unknown; failure?: string };
type Event = { taskId: string; status: string; progress: number; rows?: number; message: string };
interface Audit { pending: number; denied: string[]; forks: string[]; pickerCalls: number; saveCalls: { format: string; canceled: boolean; path?: string }[]; connectionId?: string; commands: string[]; pages: Fact[]; exports: Fact[]; events: Event[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须DBARK_SQLITE_TABLE_EXPORT_NATIVE_TEST=1、integration=0，仅使用独占临时SQLite');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
const connectionName = 'SQLite完整流式导出本例', tableName = '导出"航船🚢';
let completed: { directory: string; database: string; platform: string; firstPid?: number; secondPid?: number } | undefined;

/** 任何失败都保留原owner、profile、源库和实际导出文件，不自动补跑或清理。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('SQLite全量导出未完成两次正常退出，原现场已保留'); } });

test('SQLite原表页第二页完整导出四格式、字段重排、独立读回和SQL类型回放，取消不提交文件', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop;
  const { join, resolve, dirname, basename } = require('node:path') as typeof import('node:path');
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const { realpathSync, readFileSync, writeFileSync, readdirSync } = require('node:fs') as typeof import('node:fs');
  const { createHash, randomUUID } = require('node:crypto') as typeof import('node:crypto');
  let owner = runtime.ownedDesktopResources(info), application = owner.application, page = owner.page, originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'sqlite-table-export-native.sqlite'), replayDatabase = join(directory, 'replay-' + randomUUID() + '.sqlite');
  let closed = false, armed = false, stage = '独占1537行合成库准备';
  /** 每个异步边界核对准确owner和原120秒单次期限，不接受别的App/profile接管。 */
  const check = () => { const current = runtime.ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('SQLite全量导出owner/profile/120秒单次期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableExportNative?: Audit & { check(): void } }).__sqliteTableExportNative; if (!state) throw Error('原导出观察器不存在'); state.check(); return { pending: state.pending, denied: state.denied, forks: state.forks, pickerCalls: state.pickerCalls, saveCalls: state.saveCalls, connectionId: state.connectionId, commands: state.commands, pages: state.pages, exports: state.exports, events: state.events }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const table = () => page.locator('.table-tab[aria-label="SQLite 只读表浏览"]:visible');
  const dialog = () => page.getByRole('dialog', { name: '导出全部筛选行', exact: true });
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  const tasks = () => step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {})));
  const history = () => step(() => page.evaluate(() => window.dbark.invoke('history.list', {})));
  const rows = Array.from({ length: 1537 }, (_, index) => { const id = index + 1; return { id, bucket: id % 17 === 0 ? '排除' : '保留', rank: id % 7, note: id % 13 === 0 ? '\\N' : `行${id},"中文🚢"\n第二行`, mixed: String(id % 11), mixedType: id % 2 ? 'integer' : 'text', nullable: id % 3 === 0 ? null : id % 5 === 0 ? '' : '存在' + id, payload: Buffer.from([id % 256, 0, 255, id % 251]).toString('hex'), exact: id % 2 ? '9223372036854775807' : '-9223372036854775808', real: id + 0.25 }; });
  const selected = ['note', 'id', 'nullable', 'payload', 'exact_int', 'mixed', 'real_num'];
  const filtered = rows.filter(row => row.id >= 100 && row.bucket === '保留').sort((a, b) => a.rank - b.rank || b.id - a.id);
  const projection = filtered.map(row => ({ note: row.note, id: String(row.id), nullable: row.nullable, payload: { type: 'binary', base64: Buffer.from(row.payload, 'hex').toString('base64') }, exact_int: row.exact, mixed: row.mixed, real_num: String(row.real) }));
  const schema = 'CREATE TABLE "导出""航船🚢"(id INTEGER PRIMARY KEY,bucket TEXT,rank_num INTEGER,note TEXT,mixed,nullable TEXT,payload BLOB,exact_int INTEGER,real_num REAL)';
  /** 独立磁盘观察转文本读取数字；typeof单独保存，避免观察器自身损失INTEGER64。 */
  const disk = (file = database) => { check(); if (dirname(resolve(file)) !== resolve(directory)) throw Error('磁盘观察越过本例目录'); const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare('SELECT CAST(id AS TEXT) AS id,bucket,CAST(rank_num AS TEXT) AS rank_num,note,typeof(mixed) AS mixed_type,CAST(mixed AS TEXT) AS mixed_text,nullable,lower(hex(payload)) AS payload,CAST(exact_int AS TEXT) AS exact_int,typeof(exact_int) AS exact_type,CAST(real_num AS TEXT) AS real_num,typeof(real_num) AS real_type FROM "导出""航船🚢" ORDER BY "导出""航船🚢".id').all(); } finally { db.close(); check(); } };
  const noPartial = () => { check(); expect(readdirSync(directory).filter(name => /\.dbark-.*\.partial$/.test(name))).toEqual([]); };
  /** 只替换自身chooser的准确返回路径，原IPC、授权、文件写入、utility和任务事件全部透传。 */
  const arm = (profileId?: string) => step(() => application.evaluate(({ ipcMain, BrowserWindow, dialog, utilityProcess }, input) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
    type State = Audit & { check(): void; restore(): void; choice?: { format: Format; path?: string; canceled: boolean } };
    const root = globalThis as typeof globalThis & { __sqliteTableExportNative?: State }, handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers;
    const original = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame;
    const originalPicker = dialog.showOpenDialog, originalSave = dialog.showSaveDialog, originalFork = utilityProcess.fork, originalSend = window?.webContents.send;
    if (typeof original !== 'function' || windows.length !== 1 || !frame || !originalSend || root.__sqliteTableExportNative) throw Error('SQLite全量导出原Main入口未知');
    const state: State = { pending: 0, denied: [], forks: [], pickerCalls: 0, saveCalls: [], connectionId: input.profileId, commands: [], pages: [], exports: [], events: [], check() {}, restore() {} };
    let pickerRequest: Record<string, unknown> | undefined;
    const deny = (command: string): never => { state.denied.push(command); throw Error('SQLite全量导出专项拒绝越界：' + command); };
    const check = () => { if (root.__sqliteTableExportNative !== state || handlers.get('dbark:request') !== wrapped || dialog.showOpenDialog !== picker || dialog.showSaveDialog !== save || utilityProcess.fork !== fork || window.webContents.send !== send || window.isDestroyed() || BrowserWindow.getAllWindows().length !== 1 || window.webContents.mainFrame !== frame || state.denied.length) throw Error('SQLite全量导出原Main/文档观察器失效'); };
    const picker = (async (...args: unknown[]) => { check(); const options = args.at(-1) as Electron.OpenDialogOptions; if (input.profileId || state.pickerCalls || pickerRequest?.purpose !== 'sqlite-database' || !state.connectionId || !options?.properties?.includes('openFile')) return deny('非本例SQLite-picker'); state.pickerCalls++; return { canceled: false, filePaths: [input.database] }; }) as typeof dialog.showOpenDialog;
    const save = (async () => { check(); const choice = state.choice; if (!choice || pickerRequest?.purpose !== 'export' || pickerRequest.format !== choice.format || !choice.canceled && !input.targets.includes(String(choice.path))) return deny('非本例导出-picker'); state.saveCalls.push({ ...choice }); delete state.choice; return { canceled: choice.canceled, filePath: choice.canceled ? undefined : choice.path }; }) as typeof dialog.showSaveDialog;
    const fork = ((modulePath: string, ...args: unknown[]) => { check(); state.forks.push(modulePath); if (!/(?:^|[\\/])sqliteWorker\.cjs$/.test(modulePath)) return deny('非SQLite utility'); return Reflect.apply(originalFork, utilityProcess, [modulePath, ...args]); }) as typeof utilityProcess.fork;
    const send = ((channel: string, ...args: unknown[]) => { if (channel === 'dbark:task') state.events.push(structuredClone(args[0]) as Event); return Reflect.apply(originalSend, window.webContents, [channel, ...args]); }) as typeof window.webContents.send;
    const wrapped: Handler = async (event, payload) => {
      check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来文档IPC');
      if (!payload || typeof payload !== 'object' || !('command' in payload) || typeof payload.command !== 'string' || !('input' in payload) || !payload.input || typeof payload.input !== 'object') return deny('非标准IPC');
      const command = payload.command, value = payload.input as Record<string, unknown>;
      if (/clipboard/i.test(command) || command === 'files.path' || command.startsWith('table.') || command.startsWith('schema.') || command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('serverMonitor.') || ['files.export', 'files.exportResult', 'excel.export'].includes(command)) return deny(command);
      if (command.startsWith('metadata.') && !['metadata.databases', 'metadata.objects'].includes(command)) return deny(command);
      if (command === 'files.choose') { if (pickerRequest) return deny('并发chooser'); if (value.purpose === 'sqlite-database') { if (input.profileId || typeof value.sqliteConnectionId !== 'string' || !value.sqliteConnectionId || state.connectionId && state.connectionId !== value.sqliteConnectionId) return deny('源文件归属'); state.connectionId = value.sqliteConnectionId; } else if (value.purpose !== 'export' || !state.choice || value.format !== state.choice.format) return deny('文件用途'); pickerRequest = value; }
      if (command === 'connections.save' || command === 'connections.test') { const config = value.sqlite; if (value.dialect !== 'sqlite' || value.id !== state.connectionId || !config || typeof config !== 'object' || !('readOnly' in config) || config.readOnly !== true || ['host', 'port', 'user', 'password', 'ssh', 'tls'].some(key => Object.hasOwn(value, key))) return deny('非本例只读配置'); }
      if (command === 'connections.open' && value.id !== state.connectionId || command.startsWith('metadata.') && value.connectionId !== state.connectionId) return deny('其它数据库');
      if (['sqlite.tablePage', 'sqlite.tableExport'].includes(command) && (value.connectionId !== state.connectionId || value.database !== 'main' || value.table !== input.tableName)) return deny('其它SQLite目标');
      const fact: Fact | undefined = ['sqlite.tablePage', 'sqlite.tableExport'].includes(command) ? { request: structuredClone(value) } : undefined;
      if (fact) (command === 'sqlite.tablePage' ? state.pages : state.exports).push(fact); state.commands.push(command); state.pending++;
      try { const reply = await original(event, payload); check(); if (fact) fact.reply = structuredClone(reply); return reply; } catch (reason) { if (fact) fact.failure = reason instanceof Error ? reason.message : String(reason); throw reason; } finally { state.pending--; if (command === 'files.choose') pickerRequest = undefined; }
    };
    state.check = check; state.restore = () => { check(); if (state.pending || state.choice) throw Error('导出请求/chooser仍在途'); handlers.set('dbark:request', original); dialog.showOpenDialog = originalPicker; dialog.showSaveDialog = originalSave; utilityProcess.fork = originalFork; window.webContents.send = originalSend; delete root.__sqliteTableExportNative; };
    root.__sqliteTableExportNative = state; handlers.set('dbark:request', wrapped); dialog.showOpenDialog = picker; dialog.showSaveDialog = save; utilityProcess.fork = fork; window.webContents.send = send; check();
  }, { database, profileId, tableName, targets: ['csv', 'json', 'sql', 'xlsx'].map(format => join(directory, '全量筛选.' + format)) }));
  const choose = (format: Format, canceled: boolean) => step(() => application.evaluate((_electron, input) => { const state = (globalThis as typeof globalThis & { __sqliteTableExportNative?: Audit & { check(): void; choice?: { format: Format; path: string; canceled: boolean } } }).__sqliteTableExportNative; if (!state) throw Error('原观察器不存在'); state.check(); if (state.choice) throw Error('原chooser尚未消费'); state.choice = input; }, { format, canceled, path: join(directory, '全量筛选.' + format) }));
  /** 读取真实id列可见单元格，避开网格勾选列，不能用IPC数据替代已展示的第二页。 */
  const ids = () => step(async () => { const grid = table().getByRole('grid'); await grid.evaluate(element => { element.scrollLeft = 0; }); check(); const header = grid.getByRole('columnheader').filter({ hasText: /^id/ }); await expect(header).toHaveCount(1); check(); const column = await header.getAttribute('aria-colindex'); check(); if (!column || !/^[1-9][0-9]*$/.test(column)) throw Error('原id列位置未知'); return grid.locator(`[role="row"][aria-rowindex]:not([aria-rowindex="1"]) [role="gridcell"][aria-colindex="${column}"]`).allTextContents(); });
  const expectIds = (values: number[]) => step(() => expect.poll(async () => (await ids()).map(value => value.trim())).toEqual(values.map(String)));
  const fileFacts: { format: Format; rows: number; bytes: number; sha256: string; headers: string[] }[] = [];
  /** 独立第三方reader只解析磁盘成品；不调用产品导出/导入helper生成预期。 */
  const readExport = async (format: Format) => {
    check(); const target = join(directory, '全量筛选.' + format), bytes = readFileSync(target); expect(bytes.length).toBeGreaterThan(0);
    if (format === 'json') { const records: unknown = JSON.parse(bytes.toString('utf8')); expect(records).toEqual(projection); if (!Array.isArray(records)) throw Error('JSON成品不是数组'); expect(records.map(row => Object.keys(row))).toEqual(projection.map(() => selected)); }
    if (format === 'csv') {
      const { parse } = require('csv-parse/sync') as typeof import('csv-parse/sync'); const records = parse(bytes, { bom: true }) as string[][];
      expect(records.shift()).toEqual(selected);
      // CSV协议：NULL为\N，反斜线文本加转义，二进制为base64:；数值仅验证精确文本。
      const cell = (value: unknown): string => value === null ? '\\N' : typeof value === 'object' && value && 'base64' in value ? 'base64:' + value.base64 : String(value).startsWith('\\') ? '\\' + String(value) : String(value);
      expect(records).toEqual(projection.map(row => Object.values(row).map(cell)));
    }
    if (format === 'xlsx') {
      const { Workbook } = require('exceljs') as typeof import('exceljs'); const workbook = new Workbook(); await workbook.xlsx.readFile(target); check(); expect(workbook.worksheets).toHaveLength(1); const sheet = workbook.worksheets[0];
      /** ExcelJS可把inline富文本读为richText；只拼明确文本run，公式、错误和其他非文本值一律拒绝。 */
      const text = (value: unknown): string => {
        if (typeof value === 'string') return value;
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('richText' in value) || !Array.isArray(value.richText)) throw Error('XLSX独立reader收到非文本或非richText单元格');
        return value.richText.map((run: unknown) => {
          if (!run || typeof run !== 'object' || Array.isArray(run) || !('text' in run) || typeof run.text !== 'string' || Object.keys(run).some(key => !['text', 'font'].includes(key))
            || 'font' in run && run.font !== undefined && (!run.font || typeof run.font !== 'object' || Array.isArray(run.font))) throw Error('XLSX独立reader收到无效richText文本run');
          return run.text;
        }).join('');
      };
      const values = Array.from({ length: sheet.rowCount }, (_, index) => selected.map((_, column) => text(sheet.getRow(index + 1).getCell(column + 1).value))); expect(values.shift()).toEqual(selected);
      // DBArk工作簿文本协议独立核原值：数字字符串、NULL \N、BLOB \B:、首反斜线双写。
      const cell = (value: unknown): string => value === null ? '\\N' : typeof value === 'object' && value && 'base64' in value ? '\\B:' + value.base64 : String(value).startsWith('\\') ? '\\' + String(value) : String(value);
      expect(values).toEqual(projection.map(row => Object.values(row).map(cell)));
    }
    if (format === 'sql') {
      const sql = bytes.toString('utf8'); expect(sql).not.toMatch(/\b(?:CREATE|BEGIN|COMMIT|UPDATE|DELETE|DROP|ATTACH|PRAGMA)\s/i); expect(sql.match(/^INSERT INTO /gm)).toHaveLength(filtered.length);
      // SQL仅在另一随机独占测试库显式回放；同列/亲和性由夹具创建，绝不交给产品连接执行。
      const replay = new DatabaseSync(replayDatabase); try { replay.exec(schema); replay.exec(sql); } finally { replay.close(); }
      const expected = [...filtered].sort((a, b) => a.id - b.id).map(row => ({ id: String(row.id), bucket: null, rank_num: null, note: row.note, mixed_type: row.mixedType, mixed_text: row.mixed, nullable: row.nullable, payload: row.payload, exact_int: row.exact, exact_type: 'integer', real_num: String(row.real), real_type: 'real' })); expect(disk(replayDatabase)).toEqual(expected);
    }
    fileFacts.push({ format, rows: filtered.length, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), headers: selected }); await info.attach('SQLite全量导出原始成品.' + format, { body: bytes, contentType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : format === 'json' ? 'application/json' : 'text/plain; charset=utf-8' }); check(); noPartial();
  };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); expect(basename(directory)).toMatch(/^dbark-e2e-/); expect(filtered.length).toBeGreaterThan(1025);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]); expect((await settings()).tabs).toEqual([]); expect(await tasks()).toEqual([]); expect(await history()).toEqual([]);
    const db = new DatabaseSync(database); try { db.exec('PRAGMA journal_mode=WAL;' + schema); const insert = db.prepare('INSERT INTO "导出""航船🚢" VALUES(?,?,?,?,?,?,?,?,?)'); db.exec('BEGIN'); for (const row of rows) insert.run(row.id, row.bucket, row.rank, row.note, row.mixedType === 'integer' ? BigInt(row.mixed) : row.mixed, row.nullable, Buffer.from(row.payload, 'hex'), BigInt(row.exact), row.real); db.exec('COMMIT'); } finally { db.close(); }
    // 源句柄关闭后、chooser前捕获真实canonical路径；chooser仍返回本例原join路径。
    const canonicalDatabase = realpathSync(database), baseline = rows.map(row => ({ id: String(row.id), bucket: row.bucket, rank_num: String(row.rank), note: row.note, mixed_type: row.mixedType, mixed_text: row.mixed, nullable: row.nullable, payload: row.payload, exact_int: row.exact, exact_type: 'integer', real_num: String(row.real), real_type: 'real' })); expect(disk()).toEqual(baseline);
    await arm(); armed = true; stage = '真实只读表单选择保存';
    await step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click());
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }); await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName)); const dialect = form.locator('select'); await step(() => expect(dialect).toHaveCount(1)); await step(() => dialect.selectOption('sqlite'));
    await step(() => expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked()); await step(() => form.getByRole('button', { name: sqliteZh.choose, exact: true }).click()); await step(() => expect(form.locator('input[readonly]')).toHaveValue(basename(database))); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; if (profile.dialect !== 'sqlite') throw Error('全量导出错误保存网络连接'); expect(profile.sqlite).toMatchObject({ filePath: canonicalDatabase, readOnly: true }); expect(profile.sqlite.fileToken).toBeUndefined(); for (const field of ['host', 'port', 'user', 'password', 'rememberPassword', 'hasPassword', 'ssh', 'tls']) expect(profile).not.toHaveProperty(field);
    stage = '真实树双击及typed筛选多排序第二页'; await step(() => page.locator('.connection-row .tree-label').filter({ hasText: connectionName }).click()); await step(() => page.locator('.database-row .tree-label').filter({ hasText: /^main$/ }).click()); await step(() => page.locator('.object-row .tree-label').filter({ hasText: tableName }).dblclick()); await step(() => expect(table().getByRole('grid')).toBeVisible());
    await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); await step(() => table().getByLabel('SQLite 每页条数', { exact: true }).fill('5'));
    for (const [index, column, operator, kind, value] of [[1, 'id', 'gte', 'integer', '100'], [2, 'bucket', 'eq', 'text', '保留']] as const) { await step(() => table().getByRole('button', { name: '添加 SQLite 筛选条件', exact: true }).click()); await step(() => table().getByLabel(`SQLite 筛选 ${index} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 筛选 ${index} 运算符`, { exact: true }).selectOption(operator)); await step(() => table().getByLabel(`SQLite 筛选 ${index} 值类型`, { exact: true }).selectOption(kind)); await step(() => table().getByLabel(`SQLite 筛选 ${index} 条件值`, { exact: true }).fill(value)); }
    await step(() => table().getByLabel('SQLite 筛选关系', { exact: true }).selectOption('and'));
    for (const [index, column, direction] of [[1, 'rank_num', 'asc'], [2, 'id', 'desc']] as const) { await step(() => table().getByRole('button', { name: '添加 SQLite 排序', exact: true }).click()); await step(() => table().getByLabel(`SQLite 排序 ${index} 字段`, { exact: true }).selectOption(column)); await step(() => table().getByLabel(`SQLite 排序 ${index} 方向`, { exact: true }).selectOption(direction)); }
    expect((await step(audit)).pages).toHaveLength(1); await step(() => table().getByRole('button', { name: '应用 SQLite 筛选排序', exact: true }).click()); await step(() => table().getByRole('button', { name: '筛选与排序', exact: true }).click()); await expectIds(filtered.slice(0, 5).map(row => row.id));
    await step(() => table().getByRole('button', { name: 'SQLite 下一页', exact: true }).click()); await expectIds(filtered.slice(5, 10).map(row => row.id)); const secondPage = (await step(audit)).pages.at(-1); expect(secondPage?.request).toMatchObject({ offset: 5, limit: 5, mode: 'and', filters: [{ column: 'id', operator: 'gte', value: { kind: 'integer', value: '100' } }, { column: 'bucket', operator: 'eq', value: { kind: 'text', value: '保留' } }], sort: [{ column: 'rank_num', direction: 'asc' }, { column: 'id', direction: 'desc' }] });
    const canceledTarget = join(directory, '全量筛选.csv'), originalBytes = Buffer.from('本例已存在目标：取消必须完整保留\n'); writeFileSync(canceledTarget, originalBytes); const beforeCancelFiles = readdirSync(directory).sort();
    stage = '真实chooser取消零文件提交'; await step(() => table().getByRole('button', { name: '导出全部筛选行', exact: true }).click()); await step(() => expect(dialog()).toBeVisible()); await step(() => dialog().getByLabel('SQLite 全量导出格式', { exact: true }).selectOption('csv')); await choose('csv', true); await step(() => dialog().getByRole('button', { name: '选择 SQLite 全量导出文件', exact: true }).click());
    await step(() => expect.poll(async () => (await audit()).saveCalls.length).toBe(1)); await step(() => expect(dialog().locator('[data-sqlite-table-export-dialog]')).toHaveAttribute('aria-busy', 'false')); await step(() => expect(dialog().getByRole('button', { name: '开始 SQLite 全量导出', exact: true })).toBeDisabled()); expect((await step(audit)).exports).toEqual([]); expect(readFileSync(canceledTarget)).toEqual(originalBytes); expect(readdirSync(directory).sort()).toEqual(beforeCancelFiles); noPartial(); await step(() => dialog().getByRole('button', { name: '关闭 SQLite 全量导出', exact: true }).click());
    for (const format of ['csv', 'json', 'sql', 'xlsx'] as const) {
      stage = '真实全部筛选行导出及独立读回：' + format; const previous = (await step(audit)).exports.length;
      await step(() => table().getByRole('button', { name: '导出全部筛选行', exact: true }).click()); await step(() => expect(dialog()).toBeVisible()); await step(() => dialog().getByLabel('SQLite 全量导出格式', { exact: true }).selectOption(format)); if (format === 'xlsx') { await step(() => expect(dialog().getByLabel('SQLite 全量导出编码', { exact: true })).toBeDisabled()); await step(() => expect(dialog().getByLabel('SQLite 全量导出编码', { exact: true })).toHaveValue('utf8')); } else await step(() => dialog().getByLabel('SQLite 全量导出编码', { exact: true }).selectOption('utf8'));
      for (const column of ['bucket', 'rank_num']) await step(() => dialog().getByRole('checkbox', { name: '导出 SQLite 字段 ' + column, exact: true }).uncheck());
      // 通过真实上移入口按名字重排；不读取或写入React/Zustand内部状态。
      const order = ['id', 'note', 'mixed', 'nullable', 'payload', 'exact_int', 'real_num'];
      for (let target = 0; target < selected.length; target++) { let index = order.indexOf(selected[target]); while (index > target) { await step(() => dialog().getByRole('button', { name: '上移 SQLite 导出字段 ' + selected[target], exact: true }).click()); [order[index - 1], order[index]] = [order[index], order[index - 1]]; index--; } }
      await step(() => expect(dialog().getByLabel('SQLite 导出字段顺序', { exact: true }).locator('li > span')).toHaveText(selected)); await choose(format, false); await step(() => dialog().getByRole('button', { name: '选择 SQLite 全量导出文件', exact: true }).click()); await step(() => expect(dialog().getByRole('button', { name: '开始 SQLite 全量导出', exact: true })).toBeEnabled()); await step(() => dialog().getByRole('button', { name: '开始 SQLite 全量导出', exact: true }).click());
      await step(() => expect.poll(async () => { const state = await audit(); return state.exports.length === previous + 1 && state.exports.at(-1)?.reply !== undefined; }).toBe(true)); const facts = await step(audit), exported = facts.exports.at(-1); expect(exported?.failure).toBeUndefined(); expect(exported?.reply).toEqual({ ok: true, result: { rows: filtered.length, fileCommitted: true } }); expect(exported?.request).toMatchObject({ connectionId: profile.id, database: 'main', table: tableName, mode: 'and', filters: secondPage?.request.filters, sort: secondPage?.request.sort, format, encoding: 'utf8', columns: selected }); expect(exported?.request.schemaKey).toMatch(/^[0-9a-f]{64}$/); expect(exported?.request).not.toHaveProperty('offset'); expect(exported?.request).not.toHaveProperty('limit');
      const events = facts.events.filter(event => event.taskId === exported?.request.taskId); expect(events.some(event => event.status === 'running' && (event.rows ?? 0) >= 100 && (event.rows ?? 0) < filtered.length)).toBe(true); expect(events.at(-1)).toMatchObject({ status: 'completed', progress: 100, rows: filtered.length }); await readExport(format); expect(disk()).toEqual(baseline);
      await step(() => expect(dialog().getByText('SQLite 全量导出已保存 ' + filtered.length + ' 行。', { exact: true })).toBeVisible()); await step(() => expect(dialog().getByRole('button', { name: '关闭 SQLite 全量导出', exact: true })).toBeEnabled()); await step(() => dialog().getByRole('button', { name: '关闭 SQLite 全量导出', exact: true }).click()); await expectIds(filtered.slice(5, 10).map(row => row.id)); expect((await step(audit)).pages.at(-1)?.request.offset).toBe(5);
    }
    stage = '完整请求/任务边界及源库不变'; await step(() => expect.poll(async () => (await tasks()).every(task => ['sqlite.tablePage', 'sqlite.tableExport'].includes(task.kind) && task.status === 'completed')).toBe(true)); const firstFacts = await step(audit), firstTasks = await tasks(); expect(firstFacts.denied).toEqual([]); expect(firstFacts.pickerCalls).toBe(1); expect(firstFacts.saveCalls).toHaveLength(5); expect(firstFacts.exports).toHaveLength(4); expect(firstFacts.pages).toHaveLength(3); expect(firstFacts.commands.some(command => command.startsWith('query.') || command.startsWith('sessions.') || command.startsWith('table.') || command.startsWith('schema.') || /clipboard/i.test(command))).toBe(false); expect(await history()).toEqual([]); expect(runtime.pageErrors).toEqual([]); noPartial(); expect(disk()).toEqual(baseline);
    const persisted = await settings(); expect(persisted.tabs).toHaveLength(1); expect(persisted.tabs[0]).toMatchObject({ kind: 'table', table: tableName, connectionId: profile.id });
    await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableExportNative?: { restore(): void } }).__sqliteTableExportNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第一owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile正常重启恢复表页'; await runtime.restartOwnedDesktop(info); owner = runtime.ownedDesktopResources(info); application = owner.application; page = owner.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid); await arm(profile.id); armed = true; await step(() => expect(table().getByRole('grid')).toBeVisible()); expect(await settings()).toEqual(persisted); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual(profiles); expect(await history()).toEqual([]); expect(disk()).toEqual(baseline); noPartial();
    // 恢复首读可能早于观察器；只承认安装后的原刷新，不补写启动事实。
    const beforeRefresh = (await step(audit)).pages.length; await step(() => table().getByRole('button', { name: '刷新 SQLite 表数据', exact: true }).click()); await step(() => expect.poll(async () => (await audit()).pages.length).toBe(beforeRefresh + 1)); await step(() => expect(table().getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await tasks()).every(task => ['sqlite.tablePage', 'sqlite.tableExport'].includes(task.kind) && task.status === 'completed')).toBe(true));
    const secondFacts = await step(audit); expect(secondFacts.pickerCalls).toBe(0); expect(secondFacts.saveCalls).toEqual([]); expect(secondFacts.exports).toEqual([]); expect(secondFacts.denied).toEqual([]); expect(runtime.pageErrors).toEqual([]); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableExportNative?: { restore(): void } }).__sqliteTableExportNative; if (!state) throw Error('原观察器失效'); state.restore(); }), true); armed = false;
    stage = '第二owner正常退出'; check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(disk()).toEqual(baseline); noPartial();
    await info.attach('SQLite完整流式导出原始请求事件与磁盘读回', { body: JSON.stringify({ platform: process.platform, rawDatabase: database, canonicalDatabaseBeforePicker: canonicalDatabase, replayDatabase, firstPid, secondPid: originalProcess.pid, firstFacts, secondFacts, firstTasks, files: fileFacts, sourceRows: baseline, finalSourceRows: disk(), filteredRows: filtered.length, selectedColumns: selected, fromPageOffset: 5, chooserCancel: { exportInvocations: 0, oldTargetBytesPreserved: true, partialFiles: 0 }, sqlReplayIndependentFixture: true, userSqlExecutions: 0, userTransactions: 0, systemClipboardOperations: 0, firstExitCode: 0, secondExitCode: originalProcess.exitCode, automaticRetry: false, automaticTrace: false, pickerScope: '只替换自身Main文件chooser准确返回值，未验证操作系统对话框输入', cancellationScope: 'GUI仅验证chooser取消；运行中取消、短写和异常退出由独立后端单元覆盖', observationScope: '每次原窗口就绪后安装至退出前撤销；不冒称观察恢复首读' }), contentType: 'application/json' });
    completed = { directory, database, platform: process.platform, firstPid, secondPid: originalProcess.pid };
  } catch (reason) {
    runtime.retainOwnedDesktopResources(info); let partial: Audit | undefined;
    if (armed && !closed) try { partial = await application.evaluate(() => { const state = (globalThis as typeof globalThis & { __sqliteTableExportNative?: Audit }).__sqliteTableExportNative; return state ? { pending: state.pending, denied: state.denied, forks: state.forks, pickerCalls: state.pickerCalls, saveCalls: state.saveCalls, connectionId: state.connectionId, commands: state.commands, pages: state.pages, exports: state.exports, events: state.events } : undefined; }); } catch { /* 原观察器不可用时不重建，也不覆盖首因。 */ }
    try { await info.attach('SQLite完整导出失败原件保留', { body: JSON.stringify({ stage, directory, database, replayDatabase, files: fileFacts, pid: originalProcess.pid, exitCode: originalProcess.exitCode, closed, armed, partial, automaticRetry: false, automaticRestart: false, automaticForceStop: false, directoryRemoved: false, firstError: reason instanceof Error ? reason.message : String(reason) }), contentType: 'application/json' }); } catch { /* 附件失败不解除owner保留。 */ } throw reason;
  }
});

/** 只有原fixture完成两次准确正常退出，才验证它清理自身临时目录。 */
test.afterAll(async ({}, info: TestInfo) => { if (!completed) return; const { stat } = require('node:fs/promises') as typeof import('node:fs/promises'); let missing = false; try { await stat(completed.directory); } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') missing = true; else throw reason; } expect(missing, '原ownedfixture必须在成功退出后清理本例profile、源库和导出文件').toBe(true); await info.attach('SQLite完整导出最终清理原件', { body: JSON.stringify({ ...completed, directoryRemoved: true, accepted: true, launches: 2, systemClipboardOperations: 0 }), contentType: 'application/json' }); });
