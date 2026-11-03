import { test as baseTest, expect } from '@playwright/test';
import { relationshipDiagramZh as text } from '../../src/renderer/locales/relationshipDiagram.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认与列举不读取数据库认证、不加载桌面／驱动；只消费Root已授权并预置的准确两库。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_ER_LIVE_NATIVE === '1';
const environment = active ? (require('./relationship-diagram-live-gate') as typeof import('./relationship-diagram-live-gate')).relationshipLiveEnvironment(process.env, process.argv, process.platform) : undefined;
type Desktop = typeof import('./desktop-fixture');
interface Audit { commands: string[]; denied: string[]; failures: { command: string; message: string }[]; tables: { database: string; table: string; taskId?: string }[]; catalogs: number; pages: number; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：显式启用ER实库门、准确随机两库及服务器UUID');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let complete = false;
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !complete) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('ER实库窗口未完整闭合，保留原profile及两库，不自动清理或重试'); } });

test('真实Main和数据库元数据的复合／自引用／跨库关系图，父表与原结构保持', async ({ trace, screenshot, video }, info) => {
  if (!environment) throw Error('ER实库环境未绑定');
  const env = environment, runtime = require('./desktop-fixture') as Desktop, { application, page } = runtime.ownedDesktopResources(info), applicationProcess = application.process(), pid = applicationProcess.pid, directory = runtime.dataDir;
  const mysql = require('mysql2') as typeof import('mysql2'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const { relationshipLiveCommands } = require('./relationship-diagram-live-gate') as typeof import('./relationship-diagram-live-gate');
  const { resolve } = require('node:path') as typeof import('node:path'), { readFileSync } = require('node:fs') as typeof import('node:fs'), { createHash } = require('node:crypto') as typeof import('node:crypto');
  const configPath = resolve('playwright.config.ts'), configHash = createHash('sha256').update(readFileSync(configPath)).digest('hex');
  let observer: import('mysql2').Connection | undefined, stream: { closed?: boolean } | undefined, observerClosed = false, closed = false, originalFailure: unknown;
  const sourceTables = ['__owner', 'child', 'parent', 'unlinked'], targetTables = ['__owner', 'parent'], name = 'ER关系图本例';
  /** 所有await前后核原窗口、profile及观察socket；已退出后只允许同一只读观察连接收尾。 */
  function check(): void { const owner = runtime.ownedDesktopResources(info); if (owner.application !== application || owner.page !== page || owner.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1 || createHash('sha256').update(readFileSync(configPath)).digest('hex') !== configHash || observer && (observer as unknown as { stream: unknown }).stream !== stream) throw Error('ER实库原资源、配置或期限改变'); }
  const scrub = (value: string) => value.replaceAll(env.password, '[已隐藏]');
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); try { const result = await action(); check(); return result; } catch (reason) { const original = reason instanceof Error ? reason : Error(String(reason)), safe = Error(scrub(original.message)); safe.stack = original.stack ? scrub(original.stack) : safe.stack; throw safe; } }
  /** 观察器只有固定SELECT／SHOW；无建库、数据修改、授权、文件或任意SQL端口。 */
  const ownerSql = (database: string) => 'SELECT id,purpose FROM ' + mysql.escapeId(database) + '.`__owner` ORDER BY id';
  const countSql = (database: string, table: string) => 'SELECT CAST(COUNT(*) AS CHAR) AS rows_count FROM ' + mysql.escapeId(database) + '.' + mysql.escapeId(table);
  const ddlSql = (database: string, table: string) => 'SHOW CREATE TABLE ' + mysql.escapeId(database) + '.' + mysql.escapeId(table);
  const tablesSql = 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY BINARY TABLE_NAME';
  const serverSql = 'SELECT @@server_uuid AS uuid,@@version AS version,DATABASE() AS current_database';
  const threadsSql = 'SELECT ID FROM information_schema.PROCESSLIST WHERE DB IN (?,?) AND ID<>?';
  const statements = new Set([serverSql, tablesSql, threadsSql, ...[env.source, env.target].map(ownerSql), ...sourceTables.flatMap(table => [countSql(env.source, table), ddlSql(env.source, table)]), ...targetTables.flatMap(table => [countSql(env.target, table), ddlSql(env.target, table)])]);
  function read(sql: string, values: (string | number)[] = []): Promise<import('mysql2').RowDataPacket[]> {
    if (!statements.has(sql) || sql === tablesSql && (values.length !== 1 || ![env.source, env.target].includes(String(values[0]))) || sql === threadsSql && (values.length !== 3 || values[0] !== env.source || values[1] !== env.target || values[2] !== observer?.threadId) || ![tablesSql, threadsSql].includes(sql) && values.length) throw Error('ER只读观察范围越界');
    return step(() => new Promise((resolve, reject) => observer!.query({ sql, values }, (error, rows) => error ? reject(Error(scrub(error.message))) : resolve(rows as import('mysql2').RowDataPacket[]))));
  }
  /** 精确读取两库的全部目录／定义与空业务表，owner必须唯一相符。 */
  async function snapshot() {
    const server = await read(serverSql); expect(server).toHaveLength(1); expect(server[0].uuid).toBe(env.serverUuid); expect(String(server[0].version)).toMatch(/^8\.4\./); expect(server[0].current_database).toBeNull();
    const definitions: Record<string, unknown> = {};
    for (const [database, tables] of [[env.source, sourceTables], [env.target, targetTables]] as const) {
      const catalog = await read(tablesSql, [database]); expect(catalog.map(row => row.name)).toEqual(tables);
      expect(await read(ownerSql(database))).toEqual([{ id: env.owner, purpose: 'DBArk ER relationship diagram metadata acceptance' }]);
      for (const table of tables) { const count = await read(countSql(database, table)); expect(count.map(row => row.rows_count)).toEqual([table === '__owner' ? '1' : '0']); definitions[database + '.' + table] = await read(ddlSql(database, table)); }
    }
    return definitions;
  }
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); check();
    observer = mysql.createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as unknown as { stream: typeof stream }).stream;
    const originalDefinitions = await snapshot();
    await info.attach('ER实库本轮owner', { body: JSON.stringify({ directory, pid, source: env.source, target: env.target, observerThread: observer.threadId, platform: process.platform }), contentType: 'application/json' });
    await step(() => application.evaluate(({ app }) => { if (app.isPackaged) throw Error('ER实库门只允许源码客户端'); }));
    // 原Main全透传，不伪造目录或回包；只允许本例表的只读请求与本地连接／布局准备。
    await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, target) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], fork = utilityProcess.fork;
      if (!original || !window || BrowserWindow.getAllWindows().length !== 1) throw Error('ER原Main入口未知');
      const state: Audit & { profileId?: string } = { commands: [], denied: [], failures: [], tables: [], catalogs: 0, pages: 0 };
      (globalThis as typeof globalThis & { __erLiveAudit?: typeof state }).__erLiveAudit = state;
      const deny = (value: string): never => { state.denied.push(value); throw Error('ER实库拒绝越界：' + value); };
      utilityProcess.fork = ((path: string, ...args: unknown[]) => { if (!/(?:^|[\\/])worker\.cjs$/.test(path)) return deny('其它utility'); return Reflect.apply(fork, utilityProcess, [path, ...args]); }) as typeof utilityProcess.fork;
      handlers.set('dbark:request', async (event, payload) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return deny('外来文档');
        const raw = payload as { command?: unknown; input?: Record<string, unknown> }, command = raw.command, input = raw.input;
        if (typeof command !== 'string' || !input || typeof input !== 'object') return deny('非标准请求'); state.commands.push(command);
        if (!target.allowed.includes(command)) return deny(command);
        if (['workbench.get', 'workbench.protocolReady', 'workbench.protocolTake'].includes(command) && Object.keys(input).length) return deny('其它工作区或协议参数');
        if (command === 'connections.save') {
          if (state.profileId || typeof input.id !== 'string' || input.name !== target.name || input.host !== target.host || input.port !== 13384 || input.database !== target.database || input.dialect !== 'mysql' || input.rememberPassword !== false) return deny('其它连接配置'); state.profileId = input.id;
        }
        if (['connections.open', 'connections.close'].includes(command) && input.id !== state.profileId) return deny('其它连接');
        if (['metadata.table', 'metadata.objects', 'table.page', 'table.preferences.get'].includes(command) && input.connectionId !== state.profileId) return deny('其它连接');
        if (command === 'metadata.table') {
          if (input.database !== target.database || !['child', 'parent', 'unlinked'].includes(String(input.table))) return deny('其它表元数据');
          state.tables.push({ database: target.database, table: String(input.table), ...(typeof input.taskId === 'string' ? { taskId: input.taskId } : {}) });
        } else if (command === 'metadata.objects') { if (input.database !== target.database) return deny('其它目录'); state.catalogs++; }
        else if (command === 'table.page') { if (input.database !== target.database || input.table !== 'child') return deny('其它数据页'); state.pages++; }
        else if (command === 'table.preferences.get') { if (input.database !== target.database || input.table !== 'child') return deny('其它表偏好'); }
        else if (command === 'query.cancel') { if (!state.tables.some(value => value.taskId === input.taskId)) return deny('其它任务取消'); }
        else if (/^(?:metadata|table|schema|query|sessions|sqlite|files|result|serverMonitor|routine|tableDraftFiles|binaryCellFiles)\./.test(command) || /clipboard/i.test(command) || ['connections.test', 'connections.delete', 'connections.connect'].includes(command)) return deny(command);
        const reply = await original(event, payload);
        if (command === 'workbench.protocolReady') { const value = reply as { ok?: boolean; result?: { pending?: boolean; active?: boolean } }; if (value.ok !== true || value.result?.pending !== false || value.result.active !== false) return deny('本例不允许系统对象意图'); }
        if (command === 'workbench.protocolTake') { const value = reply as { ok?: boolean; result?: unknown }; if (value.ok !== true || value.result !== null) return deny('本例不领取系统对象意图'); }
        if (reply && typeof reply === 'object' && 'ok' in reply && reply.ok === false) { const error = 'error' in reply ? reply.error : undefined; const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error); state.failures.push({ command, message: message.slice(0, 1000) }); }
        return reply;
      });
    }, { name, host: env.host, database: env.source, allowed: [...relationshipLiveCommands] }));
    const click = async (scope: import('@playwright/test').Locator, name: string) => step(async () => (await (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(scope, { name, exact: true }, check)).click());
    await click(page.locator('.navigation-toolbar'), zh.common.newConnection); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, name], [zh.connections.text009, env.host], [zh.connections.text010, '13384'], [zh.common.user, env.user], [zh.connections.text011, env.password], [zh.connections.text012, env.source]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await click(form, zh.connections.text036); await step(() => expect(form).toBeHidden());
    // 只准备独占fixture的真实布局，再走原恢复；没有隐藏业务按钮或伪造产品回包。
    await step(() => page.evaluate(async () => {
      const profiles = await window.dbark.invoke('connections.list', {}), settings = await window.dbark.invoke('settings.get', {}); if (profiles.length !== 1 || settings.tabs.length || profiles[0].dialect !== 'mysql' || !profiles[0].database || profiles[0].password !== undefined || profiles[0].rememberPassword !== false) throw Error('ER独占配置不相符');
      const id = crypto.randomUUID(); await window.dbark.invoke('settings.save', { ...settings, tabs: [{ id, kind: 'table', title: 'child', connectionId: profiles[0].id, database: profiles[0].database, table: 'child' }], activeTabId: id });
    }));
    await step(() => page.reload()); await step(() => expect(page.locator('.table-tab [role="grid"]')).toBeVisible());
    // 网格骨架先于元数据及行页出现；等待实际原页准备完成，不能拿旧禁用菜单等待后来渲染。
    await step(() => expect(page.locator('.table-tab .context-bar .tag')).toHaveText('InnoDB'));
    await step(() => expect(page.locator('.table-tab').getByRole('button', { name: zh.common.refresh, exact: true })).toBeEnabled());
    const before = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    await click(page.locator('.table-tab'), text.entry); const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await step(() => expect(modal.locator('.relationship-diagram-node')).toHaveCount(3)); await step(() => modal.getByRole('button', { name: text.catalog, exact: true }).click());
    for (const name of ['parent', 'unlinked']) await step(() => modal.getByRole('checkbox', { name, exact: true }).check());
    await step(() => modal.getByRole('button', { name: text.read, exact: true }).click()); await step(() => expect(modal).toContainText('3 张已读表 · 1 个未读目标 · 3 个外键'));
    await step(() => expect(modal.locator('.relationship-diagram-node.external')).toHaveCount(1)); await step(() => expect(modal.locator('.relationship-diagram-node.external')).toContainText(env.target + '.parent'));
    const composite = modal.locator('details').filter({ hasText: 'fk_composite' }); await step(() => composite.locator('summary').click()); await step(() => expect(composite.locator('li')).toHaveText(['tenant → tenant', 'parent_id → id']));
    await step(() => modal.getByRole('button', { name: text.fit, exact: true }).click()); await info.attach('ER真实数据库窗口', { body: await step(() => page.screenshot()), contentType: 'image/png' });
    await step(() => modal.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => expect(modal.getByRole('button', { name: text.refresh, exact: true })).toBeEnabled());
    await step(() => modal.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(modal).toHaveCount(0));
    const audit = await step(() => application.evaluate(() => (globalThis as typeof globalThis & { __erLiveAudit?: Audit }).__erLiveAudit));
    expect(audit?.denied).toEqual([]); expect(audit?.catalogs).toBe(1); expect(audit?.tables.filter(value => value.taskId).map(value => value.table)).toEqual(['child', 'parent', 'unlinked', 'child', 'parent', 'unlinked']);
    expect(new Set(audit?.tables.flatMap(value => value.taskId ? [value.taskId] : [])).size).toBe(6);
    expect(audit?.pages).toBe(1); expect(await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).toEqual(before); expect(runtime.pageErrors).toEqual([]); expect(await snapshot()).toEqual(originalDefinitions);
    check(); await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(applicationProcess.exitCode).toBe(0);
    await step(() => expect.poll(async () => (await read(threadsSql, [env.source, env.target, observer!.threadId!])).length, { timeout: 5000 }).toBe(0));
    await closeMysqlConnection(observer, true); observerClosed = true; expect(stream?.closed).toBe(true);
    await info.attach('ER真实窗口闭合原件', { body: JSON.stringify({ directory, pid, platform: process.platform, source: env.source, target: env.target, serverUuid: env.serverUuid, audit, originalExitCode: applicationProcess.exitCode, observerClosed, sourceUnchanged: true, normalExit: true, clipboard: 0, databaseWrites: 0 }), contentType: 'application/json' }); complete = true;
  } catch (reason) {
    originalFailure = reason;
    // 保留原失败和窗口，只附准确Main只读审计及当前可见错误；不重开、不调用隐藏业务入口。
    try {
      const audit = await application.evaluate(() => (globalThis as typeof globalThis & { __erLiveAudit?: Audit }).__erLiveAudit);
      await info.attach('ER失败Main审计', { body: scrub(JSON.stringify(audit)), contentType: 'application/json' });
      await info.attach('ER失败窗口', { body: await page.screenshot(), contentType: 'image/png' });
    } catch { /* 诊断句柄已失效时保留原错误，不用新窗口替代失败现场。 */ }
    throw reason;
  }
  finally {
    if (!complete) runtime.retainOwnedDesktopResources(info);
    // 失败保留库和窗口；独立只读观察连接仍精确释放，收尾失败由原框架保留现场。
    if (observer && !observerClosed) {
      try { await closeMysqlConnection(observer, true); observerClosed = true; }
      catch (reason) { const message = scrub(reason instanceof Error ? reason.message : String(reason)); await info.attach('ER观察连接收尾失败', { body: message, contentType: 'text/plain' }); if (!originalFailure) throw Error(message); }
    }
  }
});
