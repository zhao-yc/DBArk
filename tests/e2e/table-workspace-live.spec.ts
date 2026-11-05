import { tableDraftFilesZh as draftText } from '../../src/renderer/locales/tableDraftFiles.zh-CN';
import { recordBatchEditZh as batchText } from '../../src/renderer/locales/recordBatchEdit.zh-CN';
import { tableEditWorkspaceZh as workspaceText } from '../../src/renderer/locales/tableEditWorkspace.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { tableToolbarZh } from '../../src/renderer/locales/tableToolbar.zh-CN';
import { installTableWorkspaceConfirmation, readTableWorkspaceConfirmations, installTableWorkspaceFileChoice, readTableWorkspaceFileChoices } from './table-workspace-live-gate';
import { tableApplyRecoveryZh as recoveryText } from '../../src/renderer/locales/tableApplyRecovery.zh-CN';
import { tableApplyReceiptZh as receiptText } from '../../src/renderer/locales/tableApplyReceiptZh';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { navigationMenuItem } from './navigation-menu';
import { draftHistoryZh as historyText } from '../../src/renderer/locales/draftHistory.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 默认与--list仅登记跳过项；不读取认证、不加载数据库驱动或桌面资源。
const listing = process.argv.some(value => value === '--list' || value.startsWith('--list=')), active = !listing && process.env.DBARK_TABLE_WORKSPACE_LIVE === '1';
const binding = active ? (require('./table-workspace-live-gate') as typeof import('./table-workspace-live-gate')).bindTableWorkspaceLiveEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform })) : undefined;
type Desktop = typeof import('./desktop-fixture');
interface Fact { command: string; input: Record<string, unknown>; reply?: unknown; delivered?: unknown; injected?: string; }
interface Audit { commands: string[]; denied: string[]; operations: Fact[]; pending: number; applies: number; profileId?: string; taskId?: string; taskEvents: unknown[]; suppressed: number; pageReadsAfterApply: number; injected: string[]; }
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
test.skip(!active, '默认关闭：须准确200基线、显式实库门和本轮预置随机库');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });
let completed: { directory: string; database: string; pid?: number; platform: string } | undefined;
/** 未确认原owner正常退出前保留准确窗口及数据库，不自动重试或强停。 */
test.afterEach(({}, info) => { if (active && info.status !== 'skipped' && !completed) { (require('./desktop-fixture') as Desktop).retainOwnedDesktopResources(info); throw Error('跨页草稿实库未完整闭合，原资源已保留'); } });

test('真实MySQL或MariaDB多页表单暂存、缓存返回、统一事务及异常整组保护', async ({ trace, screenshot, video }, info) => {
  if (!binding) throw Error('跨页草稿实库环境未绑定');
  const env = binding.target, runtime = require('./desktop-fixture') as Desktop, { application, page } = runtime.ownedDesktopResources(info), directory = runtime.dataDir, processHandle = application.process();
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  type Observer = import('mysql2/promise').Connection & { connection: Parameters<typeof closeMysqlConnection>[0] };
  let observer: Observer | undefined, stream: { closed?: boolean } | undefined, closed = false, observerClosed = false, stage = '独立身份与归属预检';
  const name = '跨页草稿实库 ' + env.dialect, sourceLabel = 'TEMPLATE_SOURCE_中文🚢';
  const fields = ['label'];
  /** 每个异步边界仍属于原TestInfo、窗口、环境及同一观察socket。 */
  function check(): void {
    binding!.assertCurrent(); const owner = runtime.ownedDesktopResources(info);
    if (owner.application !== application || owner.page !== page || owner.closed !== closed || runtime.dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || observer && (observer.connection as unknown as { stream: unknown }).stream !== stream) throw Error('跨页草稿实库原资源或期限已变化');
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
    if (![serverSql, rowsSql, ownerSql, ddlSql, catalogSql, threadsSql].includes(sql) || sql === catalogSql && (values.length !== 1 || values[0] !== env.database) || sql === threadsSql && (values.length !== 2 || values[0] !== env.database || values[1] !== observer?.threadId) || ![catalogSql, threadsSql].includes(sql) && values.length) throw Error('提交结果核对只读观察越界');
    const [rows] = await step(() => observer!.query<import('mysql2').RowDataPacket[]>(sql, values)); return rows;
  }
  const table = () => page.locator('.table-tab:visible'), grid = () => table().getByRole('grid'), sqlModal = () => page.getByRole('dialog', { name: zh.table.text031, exact: true });
  const audit = () => step(() => application.evaluate(() => { const state = (globalThis as typeof globalThis & { __tableWorkspaceLive?: Audit }).__tableWorkspaceLive; if (!state) throw Error('提交结果核对原Main观察器失效'); return state; }));
  const facts = (a: Audit, command: string) => a.operations.filter(fact => fact.command === command);
  const result = (raw: unknown): Record<string, any> => { if (!raw || typeof raw !== 'object' || !('ok' in raw) || raw.ok !== true || !('result' in raw) || !raw.result || typeof raw.result !== 'object') throw Error('提交结果核对缺少原Main成功封套'); return raw.result as Record<string, any>; };
  const click = (scope: import('@playwright/test').Locator, name: string) => step(async () => (await navigationMenuItem(scope, { name, exact: true }, check)).click());
  const modified = () => table().locator('.row-modified');
  const count = (n: number) => step(() => expect(modified()).toHaveCount(n));
  try {
    check(); await info.attach('跨页草稿原owner', { body: JSON.stringify({ directory, pid: processHandle.pid, database: env.database, mode: env.mode }), contentType: 'application/json' }); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    observer = await step(() => mysql.createConnection({ host: env.host, port: env.port, user: env.user, password: env.password, multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, jsonStrings: true, charset: 'utf8mb4', connectTimeout: 10000 })) as Observer;
    stream = (observer.connection as unknown as { stream: typeof stream }).stream; if (!stream) throw Error('原观察socket缺失');
    const identity = await read(serverSql); expect(identity).toHaveLength(1); expect(identity[0].version).toBe(env.version); expect(identity[0].hostname).toBe(env.hostname); if (env.serverUuid) expect(identity[0].uuid).toBe(env.serverUuid);
    expect(await read(ownerSql)).toEqual([{ id: env.owner, purpose: 'tabrelio table workspace live acceptance' }]); expect((await read(catalogSql, [env.database])).map(row => row.name)).toEqual(['__owner', 'items']);
    const baseline = await read(rowsSql), originalDdl = await read(ddlSql); expect(baseline).toHaveLength(3); expect(baseline[0]).toMatchObject({ id: '1', big_value: '18446744073709551615', amount: '12345678901234567890.120000', stamp: '2026-11-04 01:02:03.123456', payload: '00FF8000', nullable_value: null, empty_value: '', defaulted: 'SOURCE_NOT_DEFAULT' });
    // 正式Main与引擎完整透传，明确拒绝目标外读写、任意SQL及第二次apply；不记录连接密码。
    await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, target) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers, original = handlers.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window?.webContents.mainFrame, fork = utilityProcess.fork;
      if (!original || !window || !frame || BrowserWindow.getAllWindows().length !== 1) throw Error('提交结果核对原Main入口未知');
      const state: Audit = { commands: [], denied: [], operations: [], pending: 0, applies: 0, taskEvents: [], suppressed: 0, pageReadsAfterApply: 0, injected: [] };
      const originalSend = window.webContents.send;
      // 仅unknown场景在交付层抑制本例进度，Main与Engine仍保留原始ACK和持久回执。
      window.webContents.send = ((channel: string, ...args: unknown[]) => {
        const event = args[0] as { taskId?: string; tableApply?: unknown } | undefined;
        if (channel === 'dbark:task' && event && event.taskId === state.taskId && event.tableApply) { state.taskEvents.push(structuredClone(event)); if (target.mode === 'unknown') { state.suppressed++; return; } }
        return Reflect.apply(originalSend, window.webContents, [channel, ...args]);
      }) as typeof window.webContents.send; (globalThis as typeof globalThis & { __tableWorkspaceLive?: Audit }).__tableWorkspaceLive = state;
      const allowed = new Set([...(target.mode === 'draft-restore' ? ['tableDraftFiles.save','tableDraftFiles.open','table.draftVerify'] : []),'app.menuState','app.runtimeInfo','app.info','app.setDirty','settings.get','settings.save','connections.list','connections.organizationGet','connections.save','connections.open','connections.close','workbench.get','workbench.protocolReady','workbench.protocolTake','metadata.databases','metadata.objects','metadata.table','table.page','table.preferences.get','table.preview','table.apply','table.applyReceipt.list','table.applyReceipt.detail','table.copySourceRelease','tasks.list','history.list']);
      const deny = (name: string): never => { state.denied.push(name); throw Error('跨页草稿实库拒绝越界：' + name); };
      utilityProcess.fork = ((file: string, ...args: unknown[]) => { if (!/(?:^|[\\/])worker\.cjs$/.test(file)) return deny('其它utility'); return Reflect.apply(fork, utilityProcess, [file, ...args]); }) as typeof utilityProcess.fork;
      handlers.set('dbark:request', async (event, raw) => {
        if (event.sender !== window.webContents || event.senderFrame !== frame || !raw || typeof raw !== 'object' || !('command' in raw) || typeof raw.command !== 'string' || !('input' in raw) || !raw.input || typeof raw.input !== 'object') return deny('外来文档或异常IPC');
        const command = raw.command, value = raw.input as Record<string, unknown>; if (!allowed.has(command)) return deny(command); state.commands.push(command);
        if (command === 'connections.save') { if (state.profileId || typeof value.id !== 'string' || value.name !== target.name || value.host !== target.host || value.port !== target.port || value.database !== target.database || value.dialect !== target.dialect || value.rememberPassword !== false || value.ssh || value.tls) return deny('其它连接配置'); state.profileId = value.id; }
        if (['connections.open','connections.close'].includes(command) && value.id !== state.profileId) return deny('其它连接');
        if ((command.startsWith('metadata.') || command.startsWith('table.') && !command.startsWith('table.applyReceipt.') || command.startsWith('record.templates.')) && value.connectionId !== state.profileId) return deny('其它目标连接');
        if (command === 'metadata.objects' && value.database !== target.database) return deny('其它目录');
        if (['metadata.table','table.page','table.preferences.get','table.preview','table.apply'].includes(command) || command.startsWith('record.templates.')) { if (value.database !== target.database || value.table !== 'items') return deny('其它表'); }
        if (command === 'table.preview' || command === 'table.apply') { const changes = value.changes; if (!Array.isArray(changes) || changes.length !== 2 || changes.some((change,at) => !change || change.kind !== 'update' || !change.before || typeof change.before !== 'object' || String(change.before.id) !== (at===0?'1':'3') || !change.values || typeof change.values !== 'object' || Object.keys(change.values).some(key=>!target.fields.includes(key)))) return deny('非本例准确两条UPDATE'); if (command === 'table.apply') { if (++state.applies !== 1) return deny('重复提交'); state.taskId = String(value.taskId); } }
        if (command.startsWith('tableDraftFiles.')) { const selected = command === 'tableDraftFiles.save' ? value.payload as any : value.target as any; const targetValue = command === 'tableDraftFiles.save' ? selected?.target : selected; if (targetValue?.connectionId !== state.profileId || targetValue.database !== target.database || targetValue.table !== 'items') return deny('其它草稿目标'); }
        const fact = command.startsWith('tableDraftFiles.') || command === 'table.draftVerify' || command.startsWith('record.templates.') || ['app.setDirty','metadata.table','table.page','table.preview','table.apply','table.applyReceipt.list','table.applyReceipt.detail'].includes(command) ? { command, input: structuredClone(value) } as Fact : undefined; if (fact) state.operations.push(fact); state.pending++;
        try {
          // 只模拟交付失败：原Main提交或回执读取先实际完成，原封套单独留证。
          if (command === 'table.page' && state.applies && ++state.pageReadsAfterApply === 1 && target.mode === 'read-failure') {
            const delivered = { ok: false, error: '受控交付故障：提交后首次读取失败，未发送该次读取SQL' }; state.injected.push('read-failure'); if (fact) { fact.delivered = delivered; fact.injected = 'read-failure'; } return delivered;
          }
          const reply = await original(event, raw); if (fact) fact.reply = structuredClone(reply);
          if (command === 'table.apply' && ['lost-reply','unknown'].includes(target.mode) || command === 'table.applyReceipt.list' && value.taskId === state.taskId && target.mode === 'unknown') {
            const reason = command === 'table.apply' ? 'lost-reply' : 'receipt-unavailable', delivered = { ok: false, error: '受控交付故障：' + reason }; state.injected.push(reason); if (fact) { fact.delivered = delivered; fact.injected = reason; } return delivered;
          }
          if (fact) fact.delivered = structuredClone(reply); return reply;
        } finally { state.pending--; }
      });
    }, { name, host: env.host, port: env.port, database: env.database, dialect: env.dialect, fields, mode: env.mode }));
    stage = '真实连接表单与对象树打开预置表'; await click(page.locator('.navigation-toolbar'), zh.common.newConnection); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption(env.dialect));
    for (const [label, value] of [[zh.connections.text006, name],[zh.connections.text009,env.host],[zh.connections.text010,String(env.port)],[zh.common.user,env.user],[zh.connections.text011,env.password],[zh.connections.text012,env.database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
    await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').filter({ hasText: name }) }), database = connection.locator('.database-row .tree-label').filter({ hasText: env.database });
    if (!await step(() => database.isVisible())) await step(() => connection.locator('.connection-row .tree-label').filter({ hasText: name }).click()); await step(() => expect(database).toBeVisible());
    const object = connection.locator('.object-row .tree-label').filter({ hasText: /^items$/ }); if (!await step(() => object.isVisible())) await step(() => database.click()); await step(() => object.dblclick());
    await step(() => expect(grid()).toBeVisible()); await step(() => expect(table().getByRole('gridcell', { name: sourceLabel, exact: true })).toBeVisible()); await step(() => table().getByRole('gridcell', { name: sourceLabel, exact: true }).click());
    stage = '一行一页，表单明确暂存并跨页，三页草稿及缓存返回';
    const labelA = 'WORKSPACE_FIRST_中文🚢', labelC = 'WORKSPACE_THIRD_独立🚢';
    await step(() => table().getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('custom'));
    const size = table().getByRole('textbox', { name: zh.table.customPageSizeLabel, exact: true }); await step(() => size.fill('1')); await step(() => table().getByRole('button', { name: zh.table.applyPageSize, exact: true }).click());
    await step(() => expect(grid().getByRole('row')).toHaveCount(2));
    await step(() => table().getByRole('gridcell', { name: sourceLabel, exact: true }).click()); await click(table(), record.title);
    const recordForm = () => table().getByRole('complementary', { name: record.title, exact: true });
    const field = () => recordForm().locator('.record-field[aria-label="label"]');
    await step(() => expect(recordForm()).toBeVisible()); await step(() => field().getByRole('button', { name: record.editField, exact: true }).click());
    await step(() => field().getByRole('textbox', { name: 'label · ' + record.value, exact: true }).fill(labelA));
    await step(() => recordForm().getByRole('button', { name: workspaceText.stageNext, exact: true }).click());
    await step(() => expect(grid().getByRole('gridcell', { name: '对照原记录', exact: true })).toBeVisible());
    await step(() => recordForm().getByRole('button', { name: workspaceText.stageNext, exact: true }).click());
    await step(() => expect(grid().getByRole('gridcell', { name: '第三原记录', exact: true })).toBeVisible());
    // 保持字段稀疏输入，明确暂存本条；此时仍是两个不同原页的本地草稿。
    await step(() => field().getByRole('button', { name: record.editField, exact: true }).click()); await step(() => field().getByRole('textbox', { name: 'label · ' + record.value, exact: true }).fill(labelC)); await step(() => recordForm().getByRole('button', { name: record.stage, exact: true }).click());
    const bar = () => table().getByRole('region', { name: workspaceText.region, exact: true });
    await step(() => expect(bar()).toContainText(workspaceText.summary(3,2))); await count(1); expect(await read(rowsSql)).toEqual(baseline);
    const stagedPath=info.outputPath('三页草稿与逐条表单真实窗口.png'); await step(()=>page.screenshot({path:stagedPath})); await info.attach('三页草稿与逐条表单真实窗口',{path:stagedPath,contentType:'image/png'});
    const beforeCache = await audit();
    await step(() => bar().getByRole('button', { name: workspaceText.page(1), exact: true }).click()); await step(() => expect(grid().getByRole('gridcell', { name: labelA, exact: true })).toBeVisible());
    await click(table(), historyText.undo); await step(() => expect(grid().getByRole('gridcell', { name: sourceLabel, exact: true })).toBeVisible()); await click(table(), historyText.redo);
    await step(() => bar().getByRole('button', { name: workspaceText.page(3), exact: true }).click()); await step(() => expect(grid().getByRole('gridcell', { name: labelC, exact: true })).toBeVisible());
    await click(table(), historyText.undo); await step(() => expect(grid().getByRole('gridcell', { name: '第三原记录', exact: true })).toBeVisible()); await click(table(), historyText.redo);
    const afterCache = await audit(); expect(facts(afterCache,'table.page')).toHaveLength(facts(beforeCache,'table.page').length); expect(facts(afterCache,'metadata.table')).toHaveLength(facts(beforeCache,'metadata.table').length); expect(afterCache.applies).toBe(0); expect(await read(rowsSql)).toEqual(baseline);
    // 在干净的中间页也能预览全部后台修改；取消预览保留两页，数据库仍无写入。
    await step(() => bar().getByRole('button', { name: workspaceText.page(2), exact: true }).click()); await count(0);
    // 当前页干净而后台两页有修改：初始无输入通知及取消批量窗口均必须保留退出保护。
    await step(() => grid().getByRole('row').filter({has:page.getByRole('gridcell',{name:'对照原记录',exact:true})}).getByRole('checkbox').check());
    const dirtyBefore = facts(await audit(), 'app.setDirty').length;
    await click(table(),batchText.action); const batch = page.getByRole('dialog',{name:batchText.title,exact:true}); await step(()=>expect(batch).toBeVisible());
    await step(()=>expect(page.locator('.workspace-tab-button.active .dirty-dot')).toHaveCount(1)); await step(()=>batch.getByRole('button',{name:batchText.cancel,exact:true}).click()); await step(()=>expect(batch).toBeHidden());
    await step(()=>expect(page.locator('.workspace-tab-button.active .dirty-dot')).toHaveCount(1)); expect(facts(await audit(),'app.setDirty').slice(dirtyBefore).every(item=>item.input.dirty!==false)).toBe(true);
    await click(table(), zh.table.text019); await step(() => expect(sqlModal()).toContainText(workspaceText.preview(2))); await step(() => sqlModal().getByRole('button', { name: zh.common.backToEdit, exact: true }).click());
    if (env.mode === 'draft-restore') {
      stage = '正式草稿文件保存，关闭原表标签后新表页独立核验并恢复分组';
      await step(() => bar().getByRole('button', { name: workspaceText.page(3), exact: true }).click());
      const owner = 'dbark-table-workspace:' + env.owner, draftPath = info.outputPath('workspace-' + env.owner + '.dbark-draft');
      await click(table(), draftText.save); const saving = page.getByRole('dialog', { name: draftText.saveTitle, exact: true });
      await step(() => saving.getByRole('checkbox', { name: draftText.saveAcknowledgement, exact: true }).check());
      await step(() => application.evaluate(installTableWorkspaceFileChoice, { owner, path: draftPath, mode: 'save' as const }));
      await step(() => saving.getByRole('button', { name: draftText.saveAction, exact: true }).click());
      await step(() => expect(saving).toContainText(draftText.saved)); await step(() => saving.getByRole('button', { name: draftText.close, exact: true }).click());
      expect(await read(rowsSql)).toEqual(baseline); expect((await audit()).applies).toBe(0);
      const { readFile } = require('node:fs/promises') as typeof import('node:fs/promises'), { decodeTableDraft } = require('../../src/shared/tableDraft') as typeof import('../../src/shared/tableDraft');
      const saved = decodeTableDraft(await step(() => readFile(draftPath, 'utf8')));
      expect(saved.version).toBe(2); expect(saved.workspace).toEqual({ pageSize: 1, activePage: 3, pages: [{ index: 1, changes: 1 }, { index: 3, changes: 1 }] });
      expect(saved.changes).toHaveLength(2); await info.attach('正式第二版多页草稿文件', { path: draftPath, contentType: 'application/json' });
      // 使用正式关闭入口销毁原TableTab及RAM工作区，然后经对象树创建全新表页。
      await step(() => application.evaluate(installTableWorkspaceConfirmation, { owner, expected: zh.app.text002, choice: 'accept' as const }));
      await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')); await step(() => expect(table()).toHaveCount(0));
      expect((await step(() => application.evaluate(readTableWorkspaceConfirmations, owner))).map(item => item.choice)).toEqual(['accept']);
      await step(() => object.dblclick()); await step(() => expect(grid().getByRole('gridcell', { name: sourceLabel, exact: true })).toBeVisible());
      await step(() => expect(modified()).toHaveCount(0));
      await click(table(), draftText.open); const restoring = page.getByRole('dialog', { name: draftText.restoreTitle, exact: true });
      await step(() => application.evaluate(installTableWorkspaceFileChoice, { owner, path: draftPath, mode: 'open' as const }));
      await step(() => restoring.getByRole('button', { name: draftText.choose, exact: true }).click());
      await step(() => expect(restoring).toContainText(draftText.workspaceSummary(2,3))); await step(() => restoring.getByRole('checkbox', { name: draftText.restoreAcknowledgement, exact: true }).check());
      await step(() => restoring.getByRole('button', { name: draftText.restoreAction, exact: true }).click()); await step(() => expect(restoring).toBeHidden());
      await step(() => expect(bar()).toContainText(workspaceText.summary(2,2))); await step(() => expect(bar()).toContainText(workspaceText.restoredHint));
      await step(() => expect(grid().getByRole('gridcell', { name: labelC, exact: true })).toBeVisible());
      const beforeSwitch = await audit(); expect(facts(beforeSwitch, 'table.draftVerify')).toHaveLength(1);
      const verified = result(facts(beforeSwitch, 'table.draftVerify')[0].reply); expect(verified.verifiedChanges).toBe(2);
      await step(() => bar().getByRole('button', { name: workspaceText.page(1), exact: true }).click()); await step(() => expect(grid().getByRole('gridcell', { name: labelA, exact: true })).toBeVisible());
      const afterSwitch = await audit(); expect(facts(afterSwitch,'table.page')).toHaveLength(facts(beforeSwitch,'table.page').length); expect(facts(afterSwitch,'metadata.table')).toHaveLength(facts(beforeSwitch,'metadata.table').length);
      expect(afterSwitch.applies).toBe(0); expect(await read(rowsSql)).toEqual(baseline);
      const choices = await step(() => application.evaluate(readTableWorkspaceFileChoices, owner)); expect(choices.map(item => item.mode)).toEqual(['save','open']);
      await info.attach('原生文件选择与关闭原表恢复证据', { body: JSON.stringify({ choices, oldTableTabDestroyed: true, newTableTabCreated: true, verifiedChanges: 2, restoredPages: [1,3], activeRestoredPage: 3, localGroupSwitchReads: 0, writesBeforeApply: 0 }), contentType: 'application/json' });
      const restoredShot = info.outputPath('关闭原表后恢复多页草稿.png'); await step(() => page.screenshot({ path: restoredShot })); await info.attach('关闭原表后恢复多页草稿', { path: restoredShot, contentType: 'image/png' });
    }
    await step(() => bar().getByRole('button', { name: workspaceText.page(3), exact: true }).click()); await count(1); await click(table(), zh.table.text019); await step(() => expect(sqlModal()).toContainText(workspaceText.preview(2))); expect(await read(rowsSql)).toEqual(baseline);
    let concurrent = baseline;
    if (env.mode === 'rolled-back') {
      // 独立连接只在本随机库第3行制造原值冲突，SQL及条件固定，第一条应用更新必须真实回滚。
      expect(await read(ownerSql)).toEqual([{ id: env.owner, purpose: 'tabrelio table workspace live acceptance' }]);
      const [updated] = await step(() => observer!.execute<import('mysql2').ResultSetHeader>('UPDATE ' + qualify('items') + ' SET empty_value=? WHERE id=3 AND empty_value=?', ['RECOVERY_CONCURRENT', '第三空串字段'])); expect(updated.affectedRows).toBe(1); concurrent = await read(rowsSql);
    }
    stage = '真实事务后仅在交付层注入指定异常';
    await step(() => sqlModal().getByRole('button', { name: zh.common.confirmApply, exact: true }).click());
    const banner = () => table().getByRole('status', { name: recoveryText.title, exact: true });
    if (['unknown', 'rolled-back'].includes(env.mode)) {
      await step(() => expect(sqlModal().locator('.error-box')).toBeVisible()); await step(() => expect(sqlModal().getByRole('button', { name: zh.common.confirmApply, exact: true })).toBeDisabled());
      await step(() => sqlModal().getByRole('button', { name: zh.common.backToEdit, exact: true }).click());
    } else await step(() => expect(sqlModal()).toBeHidden());
    if (env.mode === 'unknown' || env.mode === 'read-failure') {
      stage = '旧草稿只读且不能新预览，用户核回执并明确重新读取';
      await step(() => expect(banner()).toBeVisible()); await step(() => expect(banner()).toContainText(env.mode === 'unknown' ? recoveryText.unknown : recoveryText.committed)); await count(1);
      await step(() => expect(table().getByRole('button', { name: zh.table.text019, exact: true })).toBeDisabled());
      await step(() => expect(banner().getByRole('button', { name: recoveryText.reload, exact: true })).toBeEnabled()); await step(() => expect(table().locator('.loading-overlay')).toHaveCount(0));
      // 准确展开本表数据编辑组并等待实际子菜单，不扫描其它组或依赖渲染前count。
      await step(() => table().getByRole('toolbar', { name: tableToolbarZh.title, exact: true }).getByRole('button', { name: '更多', exact: true }).click());
      await step(() => page.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: tableToolbarZh.editing, exact: true }).click());
      const editMenu = page.getByRole('menu', { name: tableToolbarZh.editing, exact: true });
      await step(() => expect(editMenu.getByRole('menuitem', { name: historyText.undo, exact: true })).toBeDisabled()); await step(() => expect(editMenu.getByRole('menuitem', { name: historyText.redo, exact: true })).toBeDisabled()); await step(() => page.keyboard.press('Escape'));
      await step(() => expect(editMenu).toBeHidden());
      const frozen = await audit(); expect(frozen.applies).toBe(1); expect(frozen.pageReadsAfterApply).toBe(env.mode === 'unknown' ? 0 : 1);
      await step(() => banner().getByRole('button', { name: receiptText.openCurrent, exact: true }).click());
      const details = page.getByRole('dialog', { name: receiptText.title, exact: true }); await step(() => expect(details).toBeVisible());
      if (env.mode === 'unknown') await step(() => details.getByRole('button', { name: receiptText.viewDetails, exact: true }).click());
      await step(() => expect(details.getByRole('region', { name: receiptText.details, exact: true })).toContainText(receiptText.outcomes.committed));
      await step(() => page.keyboard.press('Escape')); await step(() => expect(details).toBeHidden());
      const screenshotPath = info.outputPath('提交异常后的只读草稿与核对入口.png'); await step(() => page.screenshot({ path: screenshotPath })); await info.attach('提交异常后的只读草稿与核对入口', { path: screenshotPath, contentType: 'image/png' });
      const beforeRead = await audit(), confirmationOwner = 'dbark-table-workspace:' + env.owner, expected = env.mode === 'unknown' ? recoveryText.confirmUnknown : recoveryText.confirmCommitted;
      // Electron原生确认在Main消费一次回答，保留实际message/按钮及恢复原函数的证据。
      await step(() => application.evaluate(installTableWorkspaceConfirmation, { owner: confirmationOwner, expected, choice: 'reject' as const }));
      await step(() => banner().getByRole('button', { name: recoveryText.reload, exact: true }).click()); expect((await audit()).pageReadsAfterApply).toBe(beforeRead.pageReadsAfterApply); await count(1);
      let confirmations = await step(() => application.evaluate(readTableWorkspaceConfirmations, confirmationOwner)); expect(confirmations.map(item => item.choice)).toEqual(['reject']);
      await step(() => application.evaluate(installTableWorkspaceConfirmation, { owner: confirmationOwner, expected, choice: 'accept' as const }));
      await step(() => banner().getByRole('button', { name: recoveryText.reload, exact: true }).click()); await step(() => expect(banner()).toBeHidden()); await count(0);
      confirmations = await step(() => application.evaluate(readTableWorkspaceConfirmations, confirmationOwner)); expect(confirmations.map(item => item.choice)).toEqual(['reject','accept']); await info.attach('原生核对确认实际回答', { body: JSON.stringify(confirmations), contentType: 'application/json' });
    } else if (env.mode === 'rolled-back') {
      await step(() => expect(banner()).toBeHidden()); await count(1); expect(await read(rowsSql)).toEqual(concurrent);
      // 已确认回滚仍保留原两行，允许修正后新预览，但本例不再次投递。
      await click(table(), zh.table.text019); await step(() => expect(sqlModal()).toBeVisible()); await step(() => expect(sqlModal().getByRole('button', { name: zh.common.confirmApply, exact: true })).toBeEnabled());
      await step(() => sqlModal().getByRole('button', { name: zh.common.backToEdit, exact: true }).click());
    } else { await count(0); await step(() => expect(banner()).toBeHidden()); }
    const windowPath=info.outputPath('多页草稿统一提交真实窗口.png'); await step(()=>page.screenshot({path:windowPath})); await info.attach('多页草稿统一提交真实窗口',{path:windowPath,contentType:'image/png'});
    const finalRows = await read(rowsSql); expect(finalRows).toEqual(env.mode === 'rolled-back' ? concurrent : [{ ...baseline[0], label: Buffer.from(labelA).toString('hex').toUpperCase(), g: labelA + ':generated' }, baseline[1], { ...baseline[2], label: Buffer.from(labelC).toString('hex').toUpperCase(), g: labelC + ':generated' }]);
    const finalDdl=await read(ddlSql);expect(finalDdl).toEqual(originalDdl);
    const finalAudit = await audit(); expect(finalAudit.denied).toEqual([]); expect(finalAudit.pending).toBe(0); expect(finalAudit.applies).toBe(1); expect(facts(finalAudit,'table.preview')).toHaveLength(env.mode === 'rolled-back' ? 3 : 2); expect(facts(finalAudit,'table.apply')).toHaveLength(1); if(env.mode !== 'rolled-back') expect(result(facts(finalAudit,'table.apply')[0].reply).affectedRows).toBe(2);
    expect(finalAudit.suppressed > 0).toBe(env.mode === 'unknown'); expect(finalAudit.injected).toEqual(env.mode === 'unknown' ? ['lost-reply', 'receipt-unavailable'] : env.mode === 'lost-reply' ? ['lost-reply'] : env.mode === 'read-failure' ? ['read-failure'] : []);
    const receipts = await step(() => page.evaluate(() => window.dbark.invoke('table.applyReceipt.list', {}))); expect(receipts.total).toBe(1); const receipt = receipts.items[0]; expect(receipt.outcome).toBe(env.mode === 'rolled-back' ? 'rolled-back' : 'committed'); expect(receipt.intent).toEqual({ insert:0, update:2, delete:0, statementCount:2 }); expect(receipt.evidence.commitAcknowledged).toBe(env.mode !== 'rolled-back'); expect(receipt.evidence.rollbackAcknowledged).toBe(env.mode === 'rolled-back'); expect(runtime.pageErrors).toEqual([]);
    const history = await step(() => page.evaluate(() => window.dbark.invoke('history.list', {}))); expect(history).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(JSON.stringify(tasks)).not.toContain('18446744073709551615'); expect(tasks.every(task => task.status !== 'running')).toBe(true);
    await runtime.confirmOwnedDesktopExit(info); closed = true; check(); expect(processHandle.exitCode).toBe(0);
    await step(() => expect.poll(async () => (await read(threadsSql,[env.database,observer!.threadId!])).length, { timeout:5000 }).toBe(0));
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite'), { join } = require('node:path') as typeof import('node:path'); const config = new DatabaseSync(join(directory,'dbark.sqlite'), { readOnly:true });
    try { expect(config.prepare('SELECT COUNT(*) AS n FROM secrets').get()?.n).toBe(0); } finally { config.close(); }
    await closeMysqlConnection(observer.connection,true); observerClosed=true; expect(stream.closed).toBe(true);
    await info.attach('跨页草稿实库闭合原件',{body:JSON.stringify({mode:env.mode,platform:process.platform,directory,pid:processHandle.pid,dialect:env.dialect,database:env.database,owner:env.owner,identity,baseline,finalRows,originalDdl,finalDdl,finalAudit,receipt,tasks,normalExit:true,exitCode:processHandle.exitCode,observerClosed:true,localStageWrites:0,retainedPages:3,modifiedPages:[1,3],cachedReturnReads:0,independentHistories:true,cleanPagePreview:true,canceledCleanPageBatchDirtyPreserved:true,changedRows:[1,3],unselectedRow:2,explicitApplyBatches:1,appliedRows:env.mode === 'rolled-back' ? 0 : 2,systemClipboardOperations:0,credentialPersistent:false,coldRestartVerified:false,draftFileRestored:env.mode==='draft-restore',originalTableTabDestroyed:env.mode==='draft-restore'}),contentType:'application/json'}); completed={directory,database:env.database,pid:processHandle.pid,platform:process.platform};
  } catch(reason) {
    if(!closed) try { const shot=info.outputPath('失败原窗口.png'); await page.screenshot({path:shot}); await info.attach('失败原窗口',{path:shot,contentType:'image/png'}); const menus=await (await import('./navigation-menu-diagnostics')).readNavigationMenuObservation(page); await info.attach('失败原菜单观察',{body:JSON.stringify(menus),contentType:'application/json'}); } catch { /* 只观察原页，不重建窗口。 */ }
    let partial: Audit | undefined; if(!closed) try { partial=await audit(); } catch { /* 不重装原观察器或补造失败事实。 */ } runtime.retainOwnedDesktopResources(info);
    await info.attach('跨页草稿实库失败保留',{body:scrub(JSON.stringify({stage,directory,database:env.database,pid:processHandle.pid,closed,partial,error:reason instanceof Error?reason.message:String(reason),automaticRetry:false,automaticForceStop:false})),contentType:'application/json'}); throw Error(scrub(reason instanceof Error?reason.message:String(reason)));
  } finally { if(observer&&!observerClosed) { try { await closeMysqlConnection(observer.connection,true); observerClosed=true; } catch(reason) { if(completed) throw reason; /* 原失败及原资源保留，不拿新连接追认关闭。 */ } } }
});

/** 只有原fixture完成准确正常退出后才认可独占目录已清除。 */
test.afterAll(async ({}, info:TestInfo)=>{if(!completed)return;const{stat}=require('node:fs/promises')as typeof import('node:fs/promises');let missing=false;try{await stat(completed.directory);}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')missing=true;else throw reason;}expect(missing).toBe(true);await info.attach('跨页草稿实库最终清理',{body:JSON.stringify({...completed,directoryRemoved:true,normalOwnerExits:1}),contentType:'application/json'});});
