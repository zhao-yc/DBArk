import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { navigationMenuItem } from './navigation-menu';
import { recordBatchEditZh as text } from '../../src/renderer/locales/recordBatchEdit.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { recordProjectionZh as projection } from '../../src/renderer/locales/recordProjections.zh-CN';
import { draftHistoryZh as historyText } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认与--list仅登记跳过项；不读取认证、不加载数据库驱动或桌面资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list=')), active = !listing && process.env.DBARK_RECORD_BATCH_LIVE === '1';
const binding = active ? (require('./record-batch-live-gate') as typeof import('./record-batch-live-gate')).bindRecordBatchLiveEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
type Desktop = typeof import('./desktop-fixture');
interface Fact { command: string; input: Record<string, unknown>; reply?: unknown; }
interface Audit { commands: string[]; denied: string[]; operations: Fact[]; pending: number; applies: number; profileId?: string; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须准确200基线、显式实库门和本轮预置随机库');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
/** 未确认原owner正常退出前保留准确窗口及数据库，不自动重试或强停。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('批量记录表单实库未完整闭合，原资源已保留'); } });

test('真实MySQL或MariaDB勾选逐条表单、取消保留、整组undo／redo和明确集中提交', async ({ trace, screenshot, video }, info) => {
  if (!binding) throw Error('批量记录表单实库环境未绑定');
  const env = binding.target, runtime = require('./desktop-fixture') as Desktop, { application, page } = runtime.ownedDesktopResources(info), directory = runtime.dataDir, processHandle = application.process();
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  type Observer = import('mysql2/promise').Connection & { connection: Parameters<typeof closeMysqlConnection>[0] };
  let observer: Observer | undefined, stream: { closed?: boolean } | undefined, closed = false, observerClosed = false, stage = '独立身份与归属预检';
  const name = '批量记录表单实库 ' + env.dialect, sourceLabel = 'TEMPLATE_SOURCE_中文🚢';
  const fields = ['label','big_value','payload','nullable_value','doc'];
  /** 每个异步边界仍属于原TestInfo、窗口、环境及同一观察socket。 */
  function check(): void {
    binding!.assertCurrent(); const owner = runtime.ownedDesktopResources(info);
    if (owner.application !== application || owner.page !== page || owner.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || observer && (observer.connection as unknown as { stream: unknown }).stream !== stream) throw Error('批量记录表单实库原资源或期限已变化');
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
    if (![serverSql, rowsSql, ownerSql, ddlSql, catalogSql, threadsSql].includes(sql) || sql === catalogSql && (values.length !== 1 || values[0] !== env.database) || sql === threadsSql && (values.length !== 2 || values[0] !== env.database || values[1] !== observer?.threadId) || ![catalogSql, threadsSql].includes(sql) && values.length) throw Error('批量记录表单只读观察越界');
    const [rows] = await step(() => observer!.query<import('mysql2').RowDataPacket[]>(sql, values)); return rows;
  }
  const table = () => page.locator('.table-tab:visible'), grid = () => table().getByRole('grid'), modal = () => page.getByRole('dialog', { name: text.title, exact: true }), sqlModal = () => page.getByRole('dialog', { name: zh.table.text031, exact: true });
  const audit = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __recordBatchLive?: Audit }).__recordBatchLive; if (!state) throw Error('批量记录表单原Main观察器失效'); return state; }));
  const facts = (a: Audit, command: string) => a.operations.filter(fact => fact.command === command);
  const result = (raw: unknown): Record<string, any> => { if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !('result' in raw) || !raw.result || typeof raw.result !== 'object') throw Error('批量记录表单缺少原Main成功封套'); return raw.result as Record<string, any>; };
  const click = (scope: import('@playwright/test').Locator, name: string) => step(async () => (await navigationMenuItem(scope, { name, exact: true }, check)).click());
  const modified = () => table().locator('.row-modified');
  const count = (n: number) => step(() => expect(modified()).toHaveCount(n));
  const open = async () => { await click(table(), text.action); await step(() => expect(modal()).toBeVisible()); };
  const press = (label: string) => step(() => modal().getByRole('button',{name:label,exact:true}).click());
  const field = (name: string) => modal().locator('.record-field[aria-label="'+name+'"]');
  const expand = (name: string) => step(() => field(name).getByRole('button',{name:record.editField,exact:true}).click());
  const fill = (name: string, value: string) => step(() => field(name).getByLabel(name+' · '+record.value,{exact:true}).fill(value));
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    observer = await step(() => mysql.createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, charset: 'utf8mb4', connectTimeout: 10000 })) as Observer;
    stream = (observer.connection as unknown as { stream: typeof stream }).stream; if (!stream) throw Error('原观察socket缺失');
    const identity = await read(serverSql); expect(identity).toHaveLength(1); expect(identity[0].version).toBe(env.version); expect(identity[0].hostname).toBe(env.hostname); if (env.serverUuid) expect(identity[0].uuid).toBe(env.serverUuid);
    expect(await read(ownerSql)).toEqual([{ id: env.owner, purpose: 'tabrelio record batch live acceptance' }]); expect((await read(catalogSql, [env.database])).map(row => row.name)).toEqual(['__owner', 'items']);
    const baseline = await read(rowsSql), originalDdl = await read(ddlSql); expect(baseline).toHaveLength(3); expect(baseline[0]).toMatchObject({ id: '1', big_value: '18446744073709551615', amount: '12345678901234567890.120000', stamp: '2026-11-04 01:02:03.123456', payload: '00FF8000', nullable_value: null, empty_value: '', defaulted: 'SOURCE_NOT_DEFAULT' });
    // 正式Main与引擎完整透传，明确拒绝目标外读写、任意SQL及第二次apply；不记录连接密码。
    await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, target) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window?.webContents.mainFrame, fork = utilityProcess.fork;
      if (!original || !window || !frame || BrowserWindow.getAllWindows().length !== 1) throw Error('批量记录表单原Main入口未知');
      const state: Audit = { commands: [], denied: [], operations: [], pending: 0, applies: 0 }; (globalThis as typeof globalThis & { __recordBatchLive?: Audit }).__recordBatchLive = state;
      const allowed = new Set(['app.menuState','app.runtimeInfo','app.info','app.setDirty','settings.get','settings.save','connections.list','connections.organizationGet','connections.save','connections.open','connections.close','workbench.get','workbench.protocolReady','workbench.protocolTake','metadata.databases','metadata.objects','metadata.table','table.page','table.preferences.get','table.preview','table.apply','table.applyReceipt.list','tasks.list','history.list']);
      const deny = (name: string): never => { state.denied.push(name); throw Error('批量记录表单实库拒绝越界：' + name); };
      utilityProcess.fork = ((file: string, ...args: unknown[]) => { if (!/(?:^|[\\/])worker\.cjs$/.test(file)) return deny('其它utility'); return Reflect.apply(fork, utilityProcess, [file, ...args]); }) as typeof utilityProcess.fork;
      handlers.set('dbark:request', async (event, raw) => {
        if (event.sender !== window.webContents || event.senderFrame !== frame || !raw || typeof raw !== 'object' || !('command' in raw) || typeof raw.command !== 'string' || !('input' in raw) || !raw.input || typeof raw.input !== 'object') return deny('外来文档或异常IPC');
        const command = raw.command, value = raw.input as Record<string, unknown>; if (!allowed.has(command)) return deny(command); state.commands.push(command);
        if (command === 'connections.save') { if (state.profileId || typeof value.id !== 'string' || value.name !== target.name || value.host !== target.host || value.port !== target.port || value.database !== target.database || value.dialect !== target.dialect || value.rememberPassword !== false || value.ssh || value.tls) return deny('其它连接配置'); state.profileId = value.id; }
        if (['connections.open','connections.close'].includes(command) && value.id !== state.profileId) return deny('其它连接');
        if ((command.startsWith('metadata.') || command.startsWith('table.') && command !== 'table.applyReceipt.list' || command.startsWith('record.templates.')) && value.connectionId !== state.profileId) return deny('其它目标连接');
        if (command === 'metadata.objects' && value.database !== target.database) return deny('其它目录');
        if (['metadata.table','table.page','table.preferences.get','table.preview','table.apply'].includes(command) || command.startsWith('record.templates.')) { if (value.database !== target.database || value.table !== 'items') return deny('其它表'); }
        if (command === 'table.preview' || command === 'table.apply') { const changes = value.changes; if (!Array.isArray(changes) || changes.length !== 2 || changes.some((change,at) => !change || change.kind !== 'update' || !change.before || typeof change.before !== 'object' || String(change.before.id) !== (at===0?'1':'3') || !change.values || typeof change.values !== 'object' || Object.keys(change.values).some(key=>!target.fields.includes(key)))) return deny('非本例准确两条UPDATE'); if (command === 'table.apply' && ++state.applies !== 1) return deny('重复提交'); }
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
    stage = '真实checkbox只选第1／3条，取消局部不同输入不落原草稿';
    for(const label of [sourceLabel,'第三原记录']) await step(()=>grid().getByRole('row').filter({has:page.getByRole('gridcell',{name:label,exact:true})}).getByRole('checkbox').check());
    const beforeInput=await audit();await open();await step(()=>expect(modal().getByText(text.position(1,2),{exact:true})).toBeVisible());await expand('label');await fill('label','取消第一');await press(text.next);await press(text.keepContinue);await step(()=>expect(modal().getByText(text.position(2,2),{exact:true})).toBeVisible());await expand('label');await fill('label','取消第三');await press(text.cancel);await step(()=>expect(modal()).toBeHidden());await count(0);expect(await read(rowsSql)).toEqual(baseline);
    const canceled=await audit();for(const command of ['table.page','table.preview','table.apply'])expect(facts(canceled,command)).toHaveLength(facts(beforeInput,command).length);
    stage = '逐条独立赋值，后条非法JSON保持并拒绝整组，修正后表单及树共享';
    const labelA='BATCH_FIRST_中文🚢',labelC='BATCH_THIRD_独立🚢',docC='{"n":1e999,"n":9007199254740993}';
    await open();await expand('label');await fill('label',labelA);await expand('big_value');await fill('big_value','9223372036854775807');await press(text.keep);await press(text.next);await expand('label');await fill('label',labelC);await expand('doc');await step(()=>field('doc').getByLabel(record.mode,{exact:true}).selectOption('json'));await fill('doc','{');await press(text.save);await step(()=>expect(modal()).toBeVisible());await count(0);expect(await read(rowsSql)).toEqual(baseline);expect(facts(await audit(),'table.preview')).toEqual([]);
    await fill('doc',docC);await expand('nullable_value');await step(()=>field('nullable_value').getByLabel(record.mode,{exact:true}).selectOption('text'));await fill('nullable_value','');await expand('payload');await fill('payload','0xff0001');await press(text.keep);await press(text.previous);await step(()=>expect(modal().getByText(text.position(1,2),{exact:true})).toBeVisible());await expand('label');await step(()=>expect(field('label').getByLabel('label · '+record.value,{exact:true})).toHaveValue(labelA));await press(projection.tree);await step(()=>expect(modal().getByRole('list',{name:projection.fields,exact:true})).toBeVisible());await press(projection.form);
    const screenshotPath=info.outputPath('批量记录表单真实窗口.png');await step(()=>page.screenshot({path:screenshotPath}));await info.attach('批量记录表单真实窗口',{path:screenshotPath,contentType:'image/png'});await press(text.save);await step(()=>expect(modal()).toBeHidden());await count(2);expect(await read(rowsSql)).toEqual(baseline);
    const staged=await audit();expect(facts(staged,'table.page')).toHaveLength(facts(beforeInput,'table.page').length);expect(facts(staged,'table.preview')).toEqual([]);expect(facts(staged,'table.apply')).toEqual([]);
    await click(table(),historyText.undo);await count(0);await click(table(),historyText.redo);await count(2);
    stage = '两条UPDATE集中预览取消保留，明确确认后一次真实事务提交';
    await click(table(),zh.table.text019);await step(()=>expect(sqlModal()).toBeVisible());expect(await read(rowsSql)).toEqual(baseline);await step(()=>sqlModal().getByRole('button',{name:zh.common.backToEdit,exact:true}).click());await count(2);expect(facts(await audit(),'table.apply')).toEqual([]);
    await click(table(),zh.table.text019);await step(()=>expect(sqlModal()).toBeVisible());await step(()=>sqlModal().getByRole('button',{name:zh.common.confirmApply,exact:true}).click());await step(()=>expect(sqlModal()).toBeHidden());await count(0);
    const finalRows=await read(rowsSql);expect(finalRows).toEqual([{...baseline[0],label:Buffer.from(labelA).toString('hex').toUpperCase(),big_value:'9223372036854775807',g:labelA+':generated'},baseline[1],{...baseline[2],label:Buffer.from(labelC).toString('hex').toUpperCase(),doc:Buffer.from(docC).toString('hex').toUpperCase(),payload:'FF0001',nullable_value:'',g:labelC+':generated'}]);
    const finalDdl=await read(ddlSql);expect(finalDdl).toEqual(originalDdl);
    const finalAudit = await audit(); expect(finalAudit.denied).toEqual([]); expect(finalAudit.pending).toBe(0); expect(finalAudit.applies).toBe(1); expect(facts(finalAudit,'table.preview')).toHaveLength(2); expect(facts(finalAudit,'table.apply')).toHaveLength(1); expect(result(facts(finalAudit,'table.apply')[0].reply).affectedRows).toBe(2); expect(runtime.pageErrors).toEqual([]);
    const history = await step(() => page.evaluate(() => window.dbark.invoke('history.list', {}))); expect(history).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(JSON.stringify(tasks)).not.toContain('18446744073709551615'); expect(tasks.every(task => task.status !== 'running')).toBe(true);
    await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(processHandle.exitCode).toBe(0);
    await step(() => expect.poll(async () => (await read(threadsSql,[env.database,observer!.threadId!])).length, { timeout:5000 }).toBe(0));
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), { join } = require('node:path') as typeof import('node:path'); const config = new DatabaseSync(join(directory,'dbark.sqlite'), { readOnly:true });
    try { expect(config.prepare('SELECT COUNT(*) AS n FROM secrets').get()?.n).toBe(0); } finally { config.close(); }
    await closeMysqlConnection(observer.connection,true); observerClosed=true; expect(stream.closed).toBe(true);
    await info.attach('批量记录表单实库闭合原件',{body:JSON.stringify({platform:process.platform,directory,pid:processHandle.pid,dialect:env.dialect,database:env.database,owner:env.owner,identity,baseline,finalRows,originalDdl,finalDdl,finalAudit,tasks,normalExit:true,exitCode:processHandle.exitCode,observerClosed:true,localStageWrites:0,canceledDialogWrites:0,selectedRows:[1,3],unselectedRow:2,windowNavigationReads:0,canceledPreviewWrites:0,explicitApplyBatches:1,appliedRows:2,systemClipboardOperations:0,credentialPersistent:false,coldRestartVerified:false}),contentType:'application/json'}); completed={directory,database:env.database,pid:processHandle.pid,platform:process.platform};
  } catch(reason) {
    let partial: Audit | undefined; if(!closed) try { partial=await audit(); } catch { /* 不重装原观察器或补造失败事实。 */ } runtime.retainOwnedDesktopResources(info);
    await info.attach('批量记录表单实库失败保留',{body:scrub(JSON.stringify({stage,directory,database:env.database,pid:processHandle.pid,closed,partial,error:reason instanceof Error?reason.message:String(reason),automaticRetry:false,automaticForceStop:false})),contentType:'application/json'}); throw Error(scrub(reason instanceof Error?reason.message:String(reason)));
  } finally { if(observer&&!observerClosed) { try { await closeMysqlConnection(observer.connection,true); observerClosed=true; } catch(reason) { if(completed) throw reason; /* 原失败及原资源保留，不拿新连接追认关闭。 */ } } }
});

/** 只有原fixture完成准确正常退出后才认可独占目录已清除。 */
test.afterAll(async ({}, info:TestInfo)=>{if(!completed)return;const{stat}=require('node:fs/promises')as typeof import('node:fs/promises');let missing=false;try{await stat(completed.directory);}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw reason;}expect(missing).toBe(true);await info.attach('批量记录表单实库最终清理',{body:JSON.stringify({...completed,directoryRemoved:true,normalOwnerExits:1}),contentType:'application/json'});});
