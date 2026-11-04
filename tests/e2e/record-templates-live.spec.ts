import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { navigationMenuItem } from './navigation-menu';
import { recordTemplatesZh as text } from '../../src/renderer/locales/recordTemplates.zh-CN';
import { draftHistoryZh as historyText } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认与--list仅登记跳过项；不读取认证、不加载数据库驱动或桌面资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list=')), active = !listing && process.env.DBARK_RECORD_TEMPLATES_LIVE === '1';
const binding = active ? (require('./record-templates-live-gate') as typeof import('./record-templates-live-gate')).bindRecordTemplateLiveEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
type Desktop = typeof import('./desktop-fixture');
interface Fact { command: string; input: Record<string, unknown>; reply?: unknown; }
interface Audit { commands: string[]; denied: string[]; operations: Fact[]; pending: number; applies: number; profileId?: string; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须准确200基线、显式实库门和本轮预置随机库');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
/** 未确认原owner正常退出前保留准确窗口及数据库，不自动重试或强停。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('记录模板实库未完整闭合，原资源已保留'); } });

test('真实MySQL或MariaDB模板字段、精确值、整批草稿、明确提交及本机持久化', async ({ trace, screenshot, video }, info) => {
  if (!binding) throw Error('记录模板实库环境未绑定');
  const env = binding.target, runtime = require('./desktop-fixture') as Desktop, { application, page } = runtime.ownedDesktopResources(info), directory = runtime.dataDir, processHandle = application.process();
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  type Observer = import('mysql2/promise').Connection & { connection: Parameters<typeof closeMysqlConnection>[0] };
  let observer: Observer | undefined, stream: { closed?: boolean } | undefined, closed = false, observerClosed = false, stage = '独立身份与归属预检';
  const name = '记录模板实库 ' + env.dialect, templateName = '实库精确模板🚢', renamed = '实库模板已改名🚢', sourceLabel = 'TEMPLATE_SOURCE_中文🚢';
  const fields = ['label', 'big_value', 'amount', 'stamp', 'payload', 'nullable_value', 'empty_value', 'doc'];
  /** 每个异步边界仍属于原TestInfo、窗口、环境及同一观察socket。 */
  function check(): void {
    binding!.assertCurrent(); const owner = runtime.ownedDesktopResources(info);
    if (owner.application !== application || owner.page !== page || owner.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || observer && (observer.connection as unknown as { stream: unknown }).stream !== stream) throw Error('记录模板实库原资源或期限已变化');
  }
  const scrub = (message: string) => message.replaceAll(env.password, '[已隐藏]');
  async function step<T>(action: () => Promise<T>): Promise<T> { check(); try { const result = await action(); check(); return result; } catch (reason) { throw Error(scrub(reason instanceof Error ? reason.message : String(reason))); } }
  const qualify = (table: string) => mysql.escapeId(env.database) + '.' + mysql.escapeId(table);
  const serverSql = 'SELECT @@version AS version,@@hostname AS hostname' + (env.dialect === 'mysql' ? ',@@server_uuid AS uuid' : '');
  const rowsSql = 'SELECT CAST(id AS CHAR) AS id,HEX(label) AS label,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,DATE_FORMAT(stamp,\'%Y-%m-%d %H:%i:%s.%f\') AS stamp,HEX(payload) AS payload,nullable_value,HEX(empty_value) AS empty_value,HEX(doc) AS doc,defaulted,g FROM ' + qualify('items') + ' ORDER BY id';
  const ownerSql = 'SELECT id,purpose FROM ' + qualify('__owner') + ' ORDER BY id', ddlSql = 'SHOW CREATE TABLE ' + qualify('items');
  const catalogSql = 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY BINARY TABLE_NAME', threadsSql = 'SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? AND ID<>?';
  /** 观察端口只有固定SELECT/SHOW，无建库、写入、授权或任意SQL。 */
  async function read(sql: string, values: (string | number)[] = []) {
    if (![serverSql, rowsSql, ownerSql, ddlSql, catalogSql, threadsSql].includes(sql) || sql === catalogSql && (values.length !== 1 || values[0] !== env.database) || sql === threadsSql && (values.length !== 2 || values[0] !== env.database || values[1] !== observer?.threadId) || ![catalogSql, threadsSql].includes(sql) && values.length) throw Error('记录模板只读观察越界');
    const [rows] = await step(() => observer!.query<import('mysql2').RowDataPacket[]>(sql, values)); return rows;
  }
  const table = () => page.locator('.table-tab:visible'), grid = () => table().getByRole('grid'), modal = () => page.getByRole('dialog', { name: text.title, exact: true }), sqlModal = () => page.getByRole('dialog', { name: zh.table.text031, exact: true });
  const audit = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __recordTemplateLive?: Audit }).__recordTemplateLive; if (!state) throw Error('记录模板原Main观察器失效'); return state; }));
  const facts = (a: Audit, command: string) => a.operations.filter(fact => fact.command === command);
  const result = (raw: unknown): Record<string, any> => { if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !('result' in raw) || !raw.result || typeof raw.result !== 'object') throw Error('记录模板缺少原Main成功封套'); return raw.result as Record<string, any>; };
  const click = (scope: import('@playwright/test').Locator, name: string) => step(async () => (await navigationMenuItem(scope, { name, exact: true }, check)).click());
  const inserted = () => table().locator('.row-inserted');
  const count = (n: number) => step(() => expect(inserted()).toHaveCount(n));
  const open = async () => { await click(table(), text.open); await step(() => expect(modal()).toBeVisible()); await step(() => expect(modal().getByRole('button', { name: text.reload, exact: true })).toBeEnabled()); };
  const preview = async (id: string) => { await step(() => modal().getByLabel(text.list, { exact: true }).selectOption(id)); await step(() => modal().getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(modal().getByRole('button', { name: text.stage, exact: true })).toBeEnabled()); };
  const stageCopies = async (n: number, total: number) => { await step(() => modal().getByLabel(text.copies, { exact: true }).fill(String(n))); await step(() => modal().getByRole('button', { name: text.stage, exact: true }).click()); await step(() => expect(modal()).toBeHidden()); await count(total); };
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    observer = await step(() => mysql.createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, charset: 'utf8mb4', connectTimeout: 10000 })) as Observer;
    stream = (observer.connection as unknown as { stream: typeof stream }).stream; if (!stream) throw Error('原观察socket缺失');
    const identity = await read(serverSql); expect(identity).toHaveLength(1); expect(identity[0].version).toBe(env.version); expect(identity[0].hostname).toBe(env.hostname); if (env.serverUuid) expect(identity[0].uuid).toBe(env.serverUuid);
    expect(await read(ownerSql)).toEqual([{ id: env.owner, purpose: 'tabrelio record templates live acceptance' }]); expect((await read(catalogSql, [env.database])).map(row => row.name)).toEqual(['__owner', 'items']);
    const baseline = await read(rowsSql), originalDdl = await read(ddlSql); expect(baseline).toHaveLength(2); expect(baseline[0]).toMatchObject({ id: '1', big_value: '18446744073709551615', amount: '12345678901234567890.120000', stamp: '2026-11-04 01:02:03.123456', payload: '00FF8000', nullable_value: null, empty_value: '', defaulted: 'SOURCE_NOT_DEFAULT' });
    // 正式Main与引擎完整透传，明确拒绝目标外读写、任意SQL及第二次apply；不记录连接密码。
    await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, target) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window?.webContents.mainFrame, fork = utilityProcess.fork;
      if (!original || !window || !frame || BrowserWindow.getAllWindows().length !== 1) throw Error('记录模板原Main入口未知');
      const state: Audit = { commands: [], denied: [], operations: [], pending: 0, applies: 0 }; (globalThis as typeof globalThis & { __recordTemplateLive?: Audit }).__recordTemplateLive = state;
      const allowed = new Set(['app.menuState','app.runtimeInfo','app.info','app.setDirty','settings.get','settings.save','connections.list','connections.organizationGet','connections.save','connections.open','connections.close','workbench.get','workbench.protocolReady','workbench.protocolTake','metadata.databases','metadata.objects','metadata.table','table.page','table.preferences.get','table.preview','table.apply','table.applyReceipt.list','tasks.list','history.list','record.templates.list','record.templates.save','record.templates.rename','record.templates.delete','record.templates.read']);
      const deny = (name: string): never => { state.denied.push(name); throw Error('记录模板实库拒绝越界：' + name); };
      utilityProcess.fork = ((file: string, ...args: unknown[]) => { if (!/(?:^|[\\/])worker\.cjs$/.test(file)) return deny('其它utility'); return Reflect.apply(fork, utilityProcess, [file, ...args]); }) as typeof utilityProcess.fork;
      handlers.set('dbark:request', async (event, raw) => {
        if (event.sender !== window.webContents || event.senderFrame !== frame || !raw || typeof raw !== 'object' || !('command' in raw) || typeof raw.command !== 'string' || !('input' in raw) || !raw.input || typeof raw.input !== 'object') return deny('外来文档或异常IPC');
        const command = raw.command, value = raw.input as Record<string, unknown>; if (!allowed.has(command)) return deny(command); state.commands.push(command);
        if (command === 'connections.save') { if (state.profileId || typeof value.id !== 'string' || value.name !== target.name || value.host !== target.host || value.port !== target.port || value.database !== target.database || value.dialect !== target.dialect || value.rememberPassword !== false || value.ssh || value.tls) return deny('其它连接配置'); state.profileId = value.id; }
        if (['connections.open','connections.close'].includes(command) && value.id !== state.profileId) return deny('其它连接');
        if ((command.startsWith('metadata.') || command.startsWith('table.') && command !== 'table.applyReceipt.list' || command.startsWith('record.templates.')) && value.connectionId !== state.profileId) return deny('其它目标连接');
        if (command === 'metadata.objects' && value.database !== target.database) return deny('其它目录');
        if (['metadata.table','table.page','table.preferences.get','table.preview','table.apply'].includes(command) || command.startsWith('record.templates.')) { if (value.database !== target.database || value.table !== 'items') return deny('其它表'); }
        if (command === 'table.preview' || command === 'table.apply') { const changes = value.changes; if (!Array.isArray(changes) || changes.length !== 3 || changes.some(change => !change || change.kind !== 'insert' || !change.values || typeof change.values !== 'object' || Object.keys(change.values).sort().join(',') !== [...target.fields].sort().join(','))) return deny('非本例三条模板新增'); if (command === 'table.apply' && ++state.applies !== 1) return deny('重复提交'); }
        const fact = command.startsWith('record.templates.') || ['table.page','table.preview','table.apply'].includes(command) ? { command, input: structuredClone(value) } as Fact : undefined; if (fact) state.operations.push(fact); state.pending++;
        try { const reply = await original(event, raw); if (fact) fact.reply = structuredClone(reply); return reply; } finally { state.pending--; }
      });
    }, { name, host: env.host, port: env.port, database: env.database, dialect: env.dialect, fields }));
    stage = '真实连接表单与对象树打开预置表'; await click(page.locator('.navigation-toolbar'), zh.common.newConnection); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption(env.dialect));
    for (const [label, value] of [[zh.connections.text006, name],[zh.connections.text009,env.host],[zh.connections.text010,String(env.port)],[zh.common.user,env.user],[zh.connections.text011,env.password],[zh.connections.text012,env.database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').filter({ hasText: name }) }), database = connection.locator('.database-row .tree-label').filter({ hasText: env.database });
    if (!await step(() => database.isVisible())) await step(() => connection.locator('.connection-row .tree-label').filter({ hasText: name }).click()); await step(() => expect(database).toBeVisible());
    const object = connection.locator('.object-row .tree-label').filter({ hasText: /^items$/ }); if (!await step(() => object.isVisible())) await step(() => database.click()); await step(() => object.dblclick());
    await step(() => expect(grid()).toBeVisible()); await step(() => expect(table().getByRole('gridcell', { name: sourceLabel, exact: true })).toBeVisible()); await step(() => table().getByRole('gridcell', { name: sourceLabel, exact: true }).click());
    stage = '捕获明确字段并保存本机模板'; await open(); for (const field of ['id','g']) await step(() => expect(modal().getByRole('checkbox', { name: text.field(field), exact: true })).toHaveCount(0));
    await step(() => modal().getByLabel(text.name, { exact: true }).fill(templateName)); for (const field of fields) await step(() => modal().getByRole('checkbox', { name: text.field(field), exact: true }).check()); await step(() => modal().getByRole('button', { name: text.save, exact: true }).click()); await step(() => expect(modal().getByText(text.saved, { exact: true })).toBeVisible());
    const saved = facts(await audit(), 'record.templates.save').at(-1)!; const snapshot = result(saved.reply), id = snapshot.entries[0].id as string; expect(snapshot.entries[0].columns).toEqual(fields); expect(Object.keys(snapshot.entries[0]).sort()).toEqual(['columns','dialect','id','name','sourceCurrent']); expect(JSON.stringify(snapshot)).not.toContain('18446744073709551615');
    await preview(id); const screenshotPath = info.outputPath('记录模板实库预览.png'); await step(() => page.screenshot({ path: screenshotPath })); await info.attach('记录模板实库预览', { path: screenshotPath, contentType: 'image/png' }); await stageCopies(2, 2); expect(await read(rowsSql)).toEqual(baseline);
    await click(table(), historyText.undo); await count(0); await click(table(), historyText.redo); await count(2);
    await open(); await preview(id); await stageCopies(1, 3); await click(table(), historyText.undo); await count(2); await click(table(), historyText.redo); await count(3);
    const staged = await audit(); expect(facts(staged,'table.preview')).toEqual([]); expect(facts(staged,'table.apply')).toEqual([]); expect(await read(rowsSql)).toEqual(baseline);
    stage = '原集中预览取消保留三条，再明确提交一次'; await click(table(), zh.table.text019); await step(() => expect(sqlModal()).toBeVisible()); expect(await read(rowsSql)).toEqual(baseline); await step(() => sqlModal().getByRole('button', { name: zh.common.backToEdit, exact: true }).click()); await count(3); expect(facts(await audit(),'table.apply')).toEqual([]);
    await click(table(), zh.table.text019); await step(() => expect(sqlModal()).toBeVisible()); await step(() => sqlModal().getByRole('button', { name: zh.common.confirmApply, exact: true }).click()); await step(() => expect(sqlModal()).toBeHidden()); await count(0);
    const finalRows = await read(rowsSql); expect(finalRows.slice(0,2)).toEqual(baseline); expect(finalRows.slice(2)).toEqual([3,4,5].map(id => ({ ...baseline[0], id: String(id), defaulted: 'TEMPLATE_DATABASE_DEFAULT' })));
    const finalDdl = await read(ddlSql), normalize = (rows: unknown) => JSON.stringify(rows).replace(/AUTO_INCREMENT=\d+/g,'AUTO_INCREMENT=<计数>'); expect(normalize(finalDdl)).toBe(normalize(originalDdl));
    stage = '本机改名与显式重读保持原typed值'; await open(); await step(() => modal().getByLabel(text.list, { exact: true }).selectOption(id)); await step(() => modal().getByLabel(text.name, { exact: true }).fill(renamed)); await step(() => modal().getByRole('button', { name: text.rename, exact: true }).click()); await step(() => expect(modal().getByText(text.renamed, { exact: true })).toBeVisible()); await preview(id); expect(result(facts(await audit(),'record.templates.read').at(-1)!.reply)).toEqual(saved.input.content); await step(() => modal().getByRole('button', { name: zh.common.close, exact: true }).click());
    const finalAudit = await audit(); expect(finalAudit.denied).toEqual([]); expect(finalAudit.pending).toBe(0); expect(finalAudit.applies).toBe(1); expect(facts(finalAudit,'table.preview')).toHaveLength(2); expect(facts(finalAudit,'table.apply')).toHaveLength(1); expect(result(facts(finalAudit,'table.apply')[0].reply).affectedRows).toBe(3); expect(runtime.pageErrors).toEqual([]);
    const history = await step(() => page.evaluate(() => window.dbark.invoke('history.list', {}))); expect(history).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(JSON.stringify(tasks)).not.toContain('18446744073709551615'); expect(tasks.every(task => task.status !== 'running')).toBe(true);
    await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(processHandle.exitCode).toBe(0);
    await step(() => expect.poll(async () => (await read(threadsSql,[env.database,observer!.threadId!])).length, { timeout:5000 }).toBe(0));
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), { join } = require('node:path') as typeof import('node:path'); const config = new DatabaseSync(join(directory,'dbark.sqlite'), { readOnly:true });
    try { const documents = config.prepare('SELECT data FROM record_templates').all(); expect(documents).toHaveLength(1); const document = JSON.parse(String(documents[0].data)); expect(document.target).toEqual({ connectionId: finalAudit.profileId, database:env.database,table:'items' }); expect(document.entries[0]).toMatchObject({ id,name:renamed,content:saved.input.content }); expect(config.prepare('SELECT COUNT(*) AS n FROM secrets').get()?.n).toBe(0); } finally { config.close(); }
    await closeMysqlConnection(observer.connection,true); observerClosed=true; expect(stream.closed).toBe(true);
    await info.attach('记录模板实库闭合原件',{body:JSON.stringify({platform:process.platform,directory,pid:processHandle.pid,dialect:env.dialect,database:env.database,owner:env.owner,identity,baseline,finalRows,originalDdl,finalDdl,finalAudit,tasks,normalExit:true,exitCode:processHandle.exitCode,observerClosed:true,localStageWrites:0,canceledPreviewWrites:0,explicitApplyBatches:1,appliedRows:3,systemClipboardOperations:0,credentialPersistent:false,coldRestartVerified:false}),contentType:'application/json'}); completed={directory,database:env.database,pid:processHandle.pid,platform:process.platform};
  } catch(reason) {
    let partial: Audit | undefined; if(!closed) try { partial=await audit(); } catch { /* 不重装原观察器或补造失败事实。 */ } runtime.retainOwnedDesktopResources(info);
    await info.attach('记录模板实库失败保留',{body:scrub(JSON.stringify({stage,directory,database:env.database,pid:processHandle.pid,closed,partial,error:reason instanceof Error?reason.message:String(reason),automaticRetry:false,automaticForceStop:false})),contentType:'application/json'}); throw Error(scrub(reason instanceof Error?reason.message:String(reason)));
  } finally { if(observer&&!observerClosed) { try { await closeMysqlConnection(observer.connection,true); observerClosed=true; } catch(reason) { if(completed) throw reason; /* 原失败及原资源保留，不拿新连接追认关闭。 */ } } }
});

/** 只有原fixture完成准确正常退出后才认可独占目录已清除。 */
test.afterAll(async ({}, info:TestInfo)=>{if(!completed)return;const{stat}=require('node:fs/promises')as typeof import('node:fs/promises');let missing=false;try{await stat(completed.directory);}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw reason;}expect(missing).toBe(true);await info.attach('记录模板实库最终清理',{body:JSON.stringify({...completed,directoryRemoved:true,normalOwnerExits:1}),contentType:'application/json'});});
