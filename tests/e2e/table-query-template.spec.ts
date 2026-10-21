import { connectionUriZh } from '../../src/renderer/locales/connectionUri.zh-CN';
import { connectionUriErrors } from '../../src/shared/connectionUri';
import { test as baseTest, expect, type TestInfo } from '@playwright/test';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableQueryTemplateZh as text } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { recordViewZh } from '../../src/renderer/locales/recordViews.zh-CN';
import { createHash } from 'node:crypto';

const listing = process.argv.some(value => value === '--list' || value.startsWith('--list='));
const active = !listing && process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_TABLE_QUERY_TEMPLATE_UI === '1';
type Desktop = typeof import('./desktop-fixture');
const test: typeof baseTest = active ? (require('./desktop-fixture') as Desktop).test : baseTest;
// 默认及列表不读取认证、不加载桌面；Root先创建本轮隔离夹具，只接受明确200/13384。
const target = active ? { host: process.env.DBARK_TEST_HOST, port: process.env.DBARK_TEST_PORT, user: process.env.DBARK_TEST_USER, password: process.env.DBARK_TEST_PASSWORD, database: process.env.DBARK_TEST_DATABASE, uuid: process.env.DBARK_TEST_EXPECTED_SERVER_UUID } : undefined;
if (target && (target.host !== '192.168.31.200' || target.port !== '13384' || !target.user || typeof target.password !== 'string' || !/^dbark_querytemplate_[a-f0-9]{32}$/.test(target.database ?? '') || target.uuid !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || ![undefined, '0'].includes(process.env.DBARK_TEST_TLS) || process.env.DBARK_TEST_SSH || process.env.DBARK_TEST_CA || process.env.DBARK_EXECUTABLE_PATH || Object.hasOwn(process.env, 'DBARK_DEV_URL'))) throw Error('表结构查询模板缺少本轮准确明文隔离目标，拒绝启动');
test.skip(!active, '默认关闭：须Root显式提供准确隔离夹具及DBARK_TABLE_QUERY_TEMPLATE_UI=1');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(active ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 只透传固定表分页、一次明确SELECT及一次参数名称读取，拒绝用户写入及结构修改。 */
function observeTemplates({ ipcMain }: { ipcMain: Electron.IpcMain }, input: { database: string; connectionId: string; select: string; update: string }) {
  const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request'), root = globalThis as any;
  if (typeof original !== 'function' || root.__tableQueryTemplates) throw Error('模板观察器归属未知');
  const state = { pages: 0, selects: 0, parameters: 0, hoverReads: 0, writes: 0, pending: 0, rows: 0, confirmations: 0, note: undefined as unknown };
  root.__tableQueryTemplates = state;
  handlers.set('dbark:request', async (event: any, payload: any) => {
    const command = payload.command, value = payload.input;
    if (command.startsWith('schema.') || ['table.apply', 'table.preview', 'query.executeParameterized'].includes(command)) { state.writes++; throw Error('本例禁止产品写入'); }
    if (command === 'table.page') { if (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'subject') throw Error('分页目标已变化'); state.pages++; }
    if (command === 'query.execute') { if (state.selects++ || value.sql.replaceAll('\r\n', '\n') !== input.select) throw Error('禁止非本例SELECT或重复正文执行'); }
    if (command === 'query.parameterNames') { if (state.parameters++ || value.sql.replaceAll('\r\n', '\n') !== input.update) throw Error('参数目标或读取次数变化'); }
    const hover = command === 'metadata.completion' && value?.details === true;
    if (hover) { if (state.hoverReads >= 4 || value.kind !== 'columns' || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'subject' || value.prefix !== 'amount' || Object.keys(value).sort().join(',') !== 'connectionId,database,details,kind,prefix,table,taskId') throw Error('字段悬停目标或预算变化'); state.hoverReads++; }
    if (!hover && !['table.page', 'query.execute', 'query.parameterNames'].includes(command)) return original(event, payload);
    state.pending++;
    try {
      const reply = await original(event, payload);
      if (command === 'query.execute') {
        if (!reply?.ok || !Array.isArray(reply.result?.results) || reply.result.results.length !== 1) throw Error('原SELECT未成功');
        const result = reply.result.results[0], columns = result.columns, rows = result.rows;
        // 任意SQL结果以唯一内部key存行；显示名称不能直接作为DataRow属性。
        if (!Array.isArray(columns) || columns.length !== 4 || columns.map((column: any) => column.name).join(',') !== 'id,amount,note,bin' || columns.some((column: any) => typeof column.key !== 'string' || !column.key) || new Set(columns.map((column: any) => column.key)).size !== 4 || !Array.isArray(rows)) throw Error('原SELECT结果列身份无效');
        const idKey = columns[0].key, noteKey = columns[2].key, matches = rows.filter((row: any) => Object.hasOwn(row, idKey) && row[idKey] === '1');
        if (matches.length !== 1 || !Object.hasOwn(matches[0], noteKey)) throw Error('原SELECT缺少唯一id=1记录或note字段');
        state.rows = rows.length; state.note = matches[0][noteKey];
      }
      return reply;
    }
    finally { state.pending--; }
  });
}

test('真实表结构模板及字段悬停：安全属性、SELECT执行、UPDATE参数识别和原表草稿保留', async ({ trace, screenshot, video }, info) => {
  const runtime = require('./desktop-fixture') as Desktop, owner = runtime.ownedDesktopResources(info), page = owner.page, application = owner.application;
  const mysql = require('mysql2/promise') as typeof import('mysql2/promise'), { closeMysqlConnection } = require('../../src/engine/connection') as typeof import('../../src/engine/connection');
  const qualified = '`' + target!.database! + '`.`subject`', databaseSql = '`' + target!.database! + '`', digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let definition = '', data = '', preparedThread = 0, cleanupThread = 0, created = false;
  const closes: { label: string; normal: boolean; streamClosed: boolean }[] = [];
  /** 每条辅助连接都重新核准确服务器和原生关闭；只在原owner仍有效时结算。 */
  async function auxiliary(label: string, action: (connection: import('mysql2/promise').Connection, id: number) => Promise<void>, afterExit = false): Promise<void> {
    const check = () => { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || !afterExit && current.closed) throw Error('辅助连接原owner失效'); };
    check(); const connection = await mysql.createConnection({ host: target!.host!, port: 13384, user: target!.user, password: target!.password, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, connectTimeout: 15000 }), native = (connection as any).connection, stream = native?.stream;
    expect(Boolean(native && stream)).toBe(true); let failure: unknown;
    try { check(); const [rows] = await connection.query<any[]>('SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS id'); check(); expect(rows).toHaveLength(1); expect(rows[0].version).toMatch(/^8\.4\.11(?:-|$)/); expect(rows[0].os).toBe('Linux'); expect(Number(rows[0].names)).toBe(0); expect(rows[0].uuid).toBe(target!.uuid); await action(connection, Number(rows[0].id)); check(); }
    catch (reason) { failure = reason; }
    check(); await closeMysqlConnection(native, true, false, 2000); expect(stream.closed).toBe(true); closes.push({ label, normal: true, streamClosed: true }); if (failure) throw failure;
  }
  /** 每步核原TestInfo、App和窗口，失败保留原资源，不重启或补退出。 */
  async function step<T>(action: () => Promise<T>): Promise<T> { const current = runtime.ownedDesktopResources(info); if (current.page !== page || current.application !== application || current.closed) throw Error('原窗口已失效'); const result = await action(); const after = runtime.ownedDesktopResources(info); if (after.page !== page || after.application !== application || after.closed) throw Error('原窗口已失效'); return result; }
  const state = () => step(() => application.evaluate(() => (globalThis as any).__tableQueryTemplates as { pages: number; selects: number; parameters: number; hoverReads: number; writes: number; pending: number; rows: number; confirmations: number; note: unknown }));
  const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
  try {
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    await auxiliary('prepare', async (connection, id) => {
      preparedThread = id; const [existing] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]); expect(existing).toHaveLength(0);
      await connection.query('CREATE DATABASE ' + databaseSql + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); created = true;
      await connection.query('CREATE TABLE ' + qualified + " (id BIGINT NOT NULL PRIMARY KEY,amount DECIMAL(30,20) NOT NULL DEFAULT 0.12345678901234567890 COMMENT '字段悬停 <img src=x> [执行](command:danger)',note VARCHAR(200) NULL,bin VARBINARY(4) NULL) ENGINE=InnoDB");
      await connection.query('INSERT INTO ' + qualified + ' VALUES ?', [Array.from({ length: 61 }, (_, index) => [index + 1, index === 0 || index === 60 ? '0.12345678901234567890' : '1.00000000000000000000', index === 0 ? '' : index === 60 ? null : '其他记录', Buffer.from([0, 255])])]);
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(61); definition = digest(ddl); data = digest(rows);
    });
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true }), connectionName = '查询模板本例';
    await step(() => form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName));
    // 正式URI入口先拒绝不支持的加密参数，随后只填表；原连接、查询及草稿整例继续。
    await step(() => form.getByRole('button', { name: connectionUriZh.open, exact: true }).click());
    await step(() => form.getByLabel(connectionUriZh.title, { exact: true }).fill('mysql://fixture:unused@offline.invalid/?ssl=true'));
    await step(() => form.getByRole('button', { name: connectionUriZh.apply, exact: true }).click()); await step(() => expect(form.locator('.error-box')).toHaveText(connectionUriErrors.options));
    await step(() => expect(form.getByLabel(zh.connections.text009, { exact: true })).toHaveValue('127.0.0.1')); await step(() => expect(form.getByRole('button', { name: zh.connections.text036, exact: true })).toBeDisabled());
    const uri = 'mysql://' + encodeURIComponent(target!.user!) + ':' + encodeURIComponent(target!.password!) + '@' + target!.host! + ':' + target!.port! + '/' + encodeURIComponent(target!.database!);
    await step(() => form.getByLabel(connectionUriZh.title, { exact: true }).fill(uri)); await step(() => form.getByRole('button', { name: connectionUriZh.apply, exact: true }).click()); await step(() => expect(form.getByLabel(connectionUriZh.title, { exact: true })).toHaveCount(0));
    for (const [label, value] of [[zh.connections.text009, target!.host!], [zh.connections.text010, target!.port!], [zh.common.user, target!.user!], [zh.connections.text011, target!.password!], [zh.connections.text012, target!.database!]]) await step(() => expect(form.getByLabel(label, { exact: true })).toHaveValue(value));
    await step(() => expect(form.getByLabel(zh.connections.text016, { exact: true })).not.toBeChecked()); expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toHaveLength(0);
    await step(() => form.getByRole('combobox', { name: new RegExp('^' + zh.connections.text008) }).selectOption('mysql')); await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.database).toBe(target!.database!); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
    const select = text.generatedComment + `\nSELECT\n  \`id\`,\n  \`amount\`,\n  \`note\`,\n  \`bin\`\nFROM \`${target!.database!}\`.\`subject\`\nLIMIT 1000;`;
    const update = text.generatedComment + `\nUPDATE \`${target!.database!}\`.\`subject\`\nSET\n  \`amount\` = :value_1,\n  \`note\` = :value_2,\n  \`bin\` = :value_3\nWHERE\n  \`id\` = :key_1\nLIMIT 1;`;
    await step(() => application.evaluate(observeTemplates, { connectionId: profile.id, database: target!.database!, select, update }));
    const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
    await step(() => connection.locator('.connection-row > .tree-label').focus()); await step(() => connection.getByRole('button', { name: zh.sidebar.text011, exact: true }).click()); await step(() => connection.locator('.database-row').getByRole('button', { name: target!.database!, exact: true }).click()); await step(() => connection.locator('.object-row').getByText('subject', { exact: true }).click());
    const table = page.locator('.table-tab:visible'), cell = table.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="4"]');
    await step(() => expect(cell).toBeVisible()); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
    const tableTab = (await settings()).tabs.find(tab => tab.kind === 'table')!; expect(tableTab).toBeTruthy();
    await step(() => cell.dblclick()); const editor = table.locator('.grid-input'); await step(() => editor.fill('原表未提交草稿')); await step(() => editor.press('Enter')); await step(() => expect(editor).toHaveCount(0)); await step(() => expect(cell).toHaveText('原表未提交草稿'));
    const before = await state(), templates = page.getByRole('dialog', { name: text.title, exact: true });
    await step(() => table.getByRole('button', { name: text.entry, exact: true }).click()); await step(() => expect(templates.getByLabel(text.preview, { exact: true })).toHaveText(select)); expect(await state()).toEqual(before);
    await step(() => templates.getByRole('button', { name: text.open, exact: true }).click()); await step(() => expect(templates).toBeHidden());
    let active = await settings(), query = active.tabs.find(tab => tab.id === active.activeTabId)!; expect(query.kind).toBe('query'); expect(query.connectionId).toBe(profile.id); expect(query.databaseContext).toEqual({ state: 'known', database: target!.database! }); expect(query.sql?.replaceAll('\r\n', '\n')).toBe(select); expect(query.sourceBinding).toBeUndefined(); expect(query.fileSourceBinding).toBeUndefined(); expect((await state()).selects).toBe(0);
    const queryView = page.locator('.query-tab:visible');
    // 真正悬停Monaco字段，信息来自正式元数据接口；备注不会变成HTML、图片或命令链接。
    const amount = queryView.locator('.monaco-editor .view-line').filter({ hasText: '`amount`' }).locator('span').filter({ hasText: 'amount' }).last();
    await step(() => amount.hover()); const hover = page.locator('.monaco-hover:visible .markdown-hover');
    await step(() => expect(hover).toContainText('decimal(30,20)')); await step(() => expect(hover).toContainText('允许NULL：否')); await step(() => expect(hover).toContainText('0.12345678901234567890')); await step(() => expect(hover).toContainText('字段悬停')); await step(() => expect(hover.locator('a,img')).toHaveCount(0)); expect((await state()).hoverReads).toBeGreaterThan(0); expect((await state()).selects).toBe(0);
    await step(() => page.mouse.move(0, 0)); await step(() => expect(hover).toBeHidden());
    await step(() => queryView.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect.poll(async () => (await state()).rows).toBe(61)); expect((await state()).note).toBe(''); await step(() => expect(queryView.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled());
    const selectTable = () => step(() => page.locator('.tab-strip .tab-select').filter({ has: page.getByText(tableTab.title, { exact: true }) }).click());
    await selectTable(); await step(() => expect(cell).toHaveText('原表未提交草稿')); const beforeWriteTemplates = await state();
    await step(() => table.getByRole('button', { name: text.entry, exact: true }).click());
    for (const kind of ['INSERT', 'DELETE', 'UPDATE']) { await step(() => templates.getByRole('combobox', { name: text.kind, exact: true }).selectOption(kind)); await step(() => expect(templates.getByLabel(text.preview, { exact: true })).toContainText(kind)); }
    await step(() => expect(templates.getByLabel(text.preview, { exact: true })).toHaveText(update)); expect(await state()).toEqual(beforeWriteTemplates); await step(() => templates.getByRole('button', { name: text.open, exact: true }).click());
    active = await settings(); query = active.tabs.find(tab => tab.id === active.activeTabId)!; expect(query.sql?.replaceAll('\r\n', '\n')).toBe(update); expect(query.connectionId).toBe(profile.id); expect((await state()).selects).toBe(1);
    await step(() => queryView.getByRole('button', { name: parameterZh.open, exact: true }).click()); const parameters = page.getByRole('dialog', { name: parameterZh.title, exact: true });
    for (const [index, name] of ['value_1', 'value_2', 'value_3', 'key_1'].entries()) await step(() => expect(parameters.getByRole('textbox', { name: `${parameterZh.name} ${index + 1}`, exact: true })).toHaveValue(name));
    await step(() => parameters.getByRole('button', { name: zh.common.cancel, exact: true }).click()); await selectTable(); await step(() => expect(cell).toHaveText('原表未提交草稿'));
    // 只为本例草稿的原生确认接口提供一次受限回答；不把协议回答算作系统键鼠操作。
    await step(() => application.evaluate(({ dialog }, expected) => { const sync = dialog.showMessageBoxSync, asynchronous = dialog.showMessageBox; const answer = (args: any[]) => { dialog.showMessageBoxSync = sync; dialog.showMessageBox = asynchronous; if (args.at(-1)?.message !== expected) throw Error('拒绝其它确认使用本例回答'); (globalThis as any).__tableQueryTemplates.confirmations++; return { response: 0, checkboxChecked: false }; }; dialog.showMessageBoxSync = ((...args: any[]) => answer(args).response) as typeof sync; dialog.showMessageBox = (async (...args: any[]) => answer(args)) as typeof asynchronous; }, recordViewZh.discardPage));
    await step(() => table.getByRole('button', { name: zh.table.text018, exact: true }).click()); await step(() => expect(cell).toHaveText('')); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
    await step(() => expect.poll(async () => (await state()).pending).toBe(0)); const final = await state(); expect(final.selects).toBe(1); expect(final.parameters).toBe(1); expect(final.writes).toBe(0); expect(final.pending).toBe(0); expect(final.confirmations).toBe(1); expect(runtime.pageErrors).toEqual([]); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);
    await runtime.confirmOwnedDesktopExit(info); expect(runtime.ownedDesktopResources(info).closed).toBe(true);
    await auxiliary('cleanup', async (connection, id) => {
      cleanupThread = id; const [active] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=?', [target!.database!, preparedThread]); expect(active).toHaveLength(0);
      const [objects] = await connection.execute<any[]>('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [target!.database!]); expect(objects.map(row => [row.TABLE_NAME, row.TABLE_TYPE])).toEqual([['subject', 'BASE TABLE']]);
      for (const query of ['SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?', 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', 'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?']) { const [rows] = await connection.execute<any[]>(query, [target!.database!]); expect(rows).toHaveLength(0); }
      const [ddl] = await connection.query<any[]>('SHOW CREATE TABLE ' + qualified), [rows] = await connection.query<any[]>('SELECT * FROM ' + qualified + ' ORDER BY id'); expect(rows).toHaveLength(61); expect(digest(ddl)).toBe(definition); expect(digest(rows)).toBe(data);
      expect(created && /^dbark_querytemplate_[a-f0-9]{32}$/.test(target!.database!)).toBe(true); await connection.query('DROP DATABASE ' + databaseSql);
    }, true);
    await auxiliary('verify-absence', async connection => { const [databases] = await connection.execute<any[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target!.database!]), [threads] = await connection.execute<any[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE DB=? OR ID=? OR ID=?', [target!.database!, preparedThread, cleanupThread]); expect(databases).toHaveLength(0); expect(threads).toHaveLength(0); }, true);
    await info.attach('表结构SQL模板', { body: Buffer.from(JSON.stringify({ connectionUriVerified: true, generated: 4, fieldHoverVerified: true, hoverMarkupSafe: true, selectExecuted: true, parameterNames: 4, draftPreserved: true, draftRestored: true, noAutomaticExecution: true, noWrites: true, audit: final, definitionUnchanged: true, fixtureRows: 61, fixtureDataUnchanged: true, databaseRemoved: true, closes })), contentType: 'application/json' });
  } catch (reason) { runtime.retainOwnedDesktopResources(info); await info.attach('模板隔离资源保留', { body: Buffer.from(JSON.stringify({ database: target!.database!, created, automaticCleanup: false, closes })), contentType: 'application/json' }); throw reason; }
});
