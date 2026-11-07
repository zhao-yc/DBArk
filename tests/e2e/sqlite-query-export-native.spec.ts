import { test as base, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteQueryExportZh as text } from '../../src/renderer/locales/sqliteQueryExport.zh-CN';
import { fullQueryExportProfilesZh as profileText } from '../../src/renderer/locales/fullQueryExportProfiles.zh-CN';
import { resultSqlZh } from '../../src/shared/resultSql.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { sidebarMenuItem } from './sidebar-menu';

type Desktop = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_SQLITE_QUERY_EXPORT_NATIVE_TEST === '1';
if (enabled) {
  const forbidden = Object.keys(process.env).filter(key => /^DBARK_(?:TEST_|C02_|SSH_|MTLS_)/.test(key) ||
    /^DBARK_.*(?:PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|DATABASE_URL)$/.test(key) ||
    /^(?:MYSQL_|MARIADB_|POSTGRES_|PGHOST$|PGPORT$|PGUSER$|PGPASSWORD$|PGDATABASE$|DATABASE_URL$|SSH_AUTH_SOCK$|SSH_AGENT_PID$|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/.test(key) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].includes(key));
  if (forbidden.length || process.env.DBARK_INTEGRATION_ENABLED !== '0' || !['darwin', 'win32'].includes(process.platform))
    throw Error('SQLite 查询导出原生测试要求隔离的源码环境，拒绝字段：' + forbidden.join(','));
}
const test: typeof base = enabled ? (require('./desktop-fixture') as Desktop).test : base;
test.skip(!enabled, '仅在显式启用的独占 SQLite 测试环境运行');
test.use({trace: 'off', screenshot: 'off', video: 'off', ...(enabled ? {preserveOnUnconfirmedExit: true} : {})});
test.describe.configure({timeout: 120000, retries: 0});

test('SQLite 查询工具栏从选区绑定参数，独立导出完整结果并保护源文件', async ({}, info) => {
  const runtime = require('./desktop-fixture') as Desktop;
  const {DatabaseSync} = require('node:sqlite') as typeof import('node:sqlite');
  const {listExcelSheets, readExcelRows} = require('../../src/engine/excelFiles') as typeof import('../../src/engine/excelFiles');
  const {application, page} = runtime.ownedDesktopResources(info);
  const originalProcess = application.process();
  const directory = runtime.dataDir, database = join(directory, 'query-export.sqlite'), target = join(directory, 'query-export.json');
  const xlsx = join(directory, 'query-export.xlsx');
  const fullInsertFile = join(directory, 'full-query.sql');
  const insertFile = join(directory, 'query-result.sql');
  const html = join(directory, 'full-query.html'), selectedHtml = join(directory, 'query-result.html');
  const xml = join(directory, 'full-query.xml'), selectedXml = join(directory, 'query-result.xml');
  const resultSql = "SELECT 9223372036854775807 AS mixed, -0.0 AS signed, X'00ff' AS bytes, '中🚢'||char(0)||'尾' AS note " +
    "UNION ALL SELECT '9223372036854775807', 1.0, NULL, ''";
  const connectionName = 'SQLite查询导出本例';
  const prefix = "DELETE FROM subject;\n";
  const sql = 'WITH RECURSIVE series(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM series WHERE n<1205) ' +
    'SELECT n AS position, id AS exact, :marker AS marker, payload FROM series CROSS JOIN subject ORDER BY n;';
  const source = prefix + sql + '\nDELETE FROM subject;';
  let stage = '独占数据库和窗口准备';
  const check = () => {
    const owner = runtime.ownedDesktopResources(info);
    if (owner.closed || owner.application !== application || owner.page !== page || runtime.dataDir !== directory) throw Error('SQLite 查询导出窗口归属已改变');
  };
  const digest = () => createHash('sha256').update(readFileSync(database)).digest('hex');
  try {
    check();
    expect(basename(directory)).toMatch(/^dbark-e2e-/);
    const db = new DatabaseSync(database);
    try { db.exec("CREATE TABLE subject(id INTEGER PRIMARY KEY,payload BLOB); INSERT INTO subject VALUES(9223372036854775807,X'00ff');"); }
    finally { db.close(); }
    const before = digest();
    await page.addInitScript(() => {
      let environment: Record<string, unknown> = {globalAPI: true};
      Object.defineProperty(window, 'MonacoEnvironment', {configurable: true, get: () => environment, set: value => {
        environment = value && typeof value === 'object' ? {...value, globalAPI: true} : {globalAPI: true};
      }});
    });
    await page.reload();
    // 只替换本例窗口的文件选择结果，原生文件令牌、IPC、驱动和写盘继续走产品链路。
    await application.evaluate(({dialog, ipcMain, BrowserWindow}, input) => {
      type Handler = (event: Electron.IpcMainInvokeEvent, payload: {command: string; input: Record<string, unknown>}) => Promise<unknown>;
      const handlers = (ipcMain as unknown as {_invokeHandlers: Map<string, Handler>})._invokeHandlers;
      const original = handlers.get('dbark:request')!, open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      const [owner, extra] = BrowserWindow.getAllWindows();
      if (!owner || extra || !original) throw Error('缺少原测试窗口或处理器');
      const facts = {requests: [] as {command: string; value: Record<string, unknown>}[], replies: [] as unknown[], resultExports: [] as {command: string; value: Record<string, unknown>}[], executions: 0, saveCalls: 0, openCalls: 0, denied: [] as string[]};
      let chooser: string | undefined;
      dialog.showOpenDialog = (async () => {
        if (chooser !== 'sqlite-database' || ++facts.openCalls !== 1) throw Error('本例不允许其它打开对话框');
        return {canceled: false, filePaths: [input.database]};
      }) as typeof dialog.showOpenDialog;
      dialog.showSaveDialog = (async () => {
        const paths = [input.target, input.xlsx, input.fullInsertFile, input.html, input.xml, input.insertFile, input.selectedHtml, input.selectedXml];
        if (chooser !== 'export' || ++facts.saveCalls > paths.length) throw Error('本例不允许其它保存对话框');
        return {canceled: false, filePath: paths[facts.saveCalls - 1]};
      }) as typeof dialog.showSaveDialog;
      const wrapped: Handler = async (event, payload) => {
        if (event.senderFrame !== owner.webContents.mainFrame) throw Error('本例 IPC 窗口归属已改变');
        const {command, input: value} = payload;
        if (command === 'query.execute') {
          if (value.sql !== input.resultSql || ++facts.executions !== 1) throw Error('本例只允许一次准确的合成查询');
        } else if (['files.previewResultSql', 'files.exportResult', 'files.releaseResultSql'].includes(command)) {
          if (command === 'files.exportResult' && !['sql', 'html', 'xml'].includes(String(value.format))) throw Error('本例只允许 INSERT SQL、HTML 或 XML 快照文件');
          facts.resultExports.push({command, value: structuredClone(value)});
        } else if (/^(?:query\.(?:execute|transaction)|sqlite\.(?!queryExport)|files\.(?!choose$))/.test(command)) {
          facts.denied.push(command); throw Error('本例禁止执行其它 SQL 或文件动作');
        }
        if (command === 'sqlite.queryExport' || command === 'sqlite.queryExportParameterNames') {
          if (value.sql !== input.sql) { facts.denied.push(command); throw Error('导出 SQL 越过了原选区'); }
          facts.requests.push({command, value: structuredClone(value)});
        }
        if (command === 'files.choose') chooser = String(value.purpose);
        try {
          const reply = await original(event, payload);
          if (command === 'sqlite.queryExport') facts.replies.push(structuredClone(reply));
          return reply;
        } finally { if (command === 'files.choose') chooser = undefined; }
      };
      handlers.set('dbark:request', wrapped);
      Object.assign(globalThis, {sqliteQueryExportProof: {facts, restore() {
        handlers.set('dbark:request', original); dialog.showOpenDialog = open; dialog.showSaveDialog = save;
      }}});
    }, {database, target, xlsx, sql, fullInsertFile, insertFile, resultSql, html, selectedHtml, xml, selectedXml});

    stage = '保存连接及从树打开查询';
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), {name: zh.common.newConnection, exact: true}, check)).click();
    const form = page.getByRole('dialog', {name: zh.common.newConnection, exact: true});
    await form.getByLabel(zh.connections.text006, {exact: true}).fill(connectionName);
    await form.locator('select').selectOption('sqlite');
    await form.getByRole('checkbox', {name: sqliteZh.readOnly, exact: true}).uncheck();
    await form.getByRole('button', {name: sqliteZh.choose, exact: true}).click();
    await expect(form.locator('input[readonly]')).toHaveValue(basename(database));
    await form.getByRole('button', {name: zh.connections.text036, exact: true}).click();
    await expect(form).toBeHidden();
    const connection = page.locator('.connection-node').filter({hasText: connectionName});
    const main = connection.locator('.database-row .tree-label').filter({hasText: /^main$/});
    if (!await main.isVisible()) await connection.locator('.connection-row .tree-label').filter({hasText: connectionName}).click();
    const object = connection.locator('.object-row').filter({has: page.getByRole('button', {name: 'subject', exact: true})});
    if (!await object.isVisible()) await main.click();
    await object.getByRole('button', {name: 'subject', exact: true}).click();
    await expect(object).toHaveClass(/\bactive\b/);
    await (await sidebarMenuItem(object, {name: sqliteZh.selectQuery + ' subject', exact: true}, check)).click();

    stage = '捕获单个选区并绑定类型参数';
    const query = page.locator('.query-tab:visible');
    await expect(query.locator('.monaco-editor').getByRole('textbox')).toBeVisible();
    await page.evaluate(({source, start, end}) => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const editors = api?.editor.getEditors().filter(editor => editor.getContainerDomNode().closest('.query-tab .sql-editor-wrap'));
      if (editors?.length !== 1) throw Error('本例查询编辑器不唯一');
      const [editor] = editors, model = editor.getModel()!;
      model.setValue(source);
      model.setEOL(api!.editor.EndOfLineSequence.LF);
      const first = model.getPositionAt(start), last = model.getPositionAt(end);
      editor.setSelection({startLineNumber: first.lineNumber, startColumn: first.column, endLineNumber: last.lineNumber, endColumn: last.column});
    }, {source, start: prefix.length, end: prefix.length + sql.length});
    await (await navigationMenuItem(query.locator('.query-primary-toolbar'), {name: text.open, exact: true}, check)).click();
    const modal = page.getByRole('dialog', {name: text.title, exact: true});
    await expect(modal.getByLabel(text.source)).toHaveText(sql);
    await modal.getByRole('button', {name: text.parameters, exact: true}).click();
    const parameters = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    await parameters.getByLabel(parameterZh.value + ' marker', {exact: true}).fill("中文';🚢");
    await parameters.getByRole('button', {name: text.applyParameters, exact: true}).click();

    stage = '真实流导出并读回磁盘';
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('json');
    await modal.getByLabel(zh.resultExport.encoding, {exact: true}).selectOption('utf16le');
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByLabel(profileText.name, {exact: true}).fill('交付 JSON');
    await modal.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(modal.getByText(profileText.saved, {exact: true})).toBeVisible();
    const saved = await page.evaluate(() => window.dbark.invoke('queryExportProfiles.list', {dialect: 'sqlite'}));
    expect(saved.map(({revision, ...profile}) => profile)).toEqual([{name: '交付 JSON', options: {format: 'json', encoding: 'utf16le'}}]);
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await modal.getByRole('button', {name: text.start, exact: true}).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(1205));
    const bytes = readFileSync(target);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('fffe');
    const rows = JSON.parse(bytes.toString('utf16le').slice(1));
    expect(rows).toHaveLength(1205);
    expect(rows[0]).toEqual({position: '1', exact: '9223372036854775807', marker: "中文';🚢", payload: {type: 'binary', base64: 'AP8='}});
    expect(rows.at(-1).position).toBe('1205');
    stage = '按光标捕获当前查询并逐行导出 XLSX';
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    await page.evaluate(offset => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const editor = api?.editor.getEditors().find(instance => instance.getContainerDomNode().closest('.query-tab .sql-editor-wrap'));
      const model = editor?.getModel();
      if (!editor || !model) throw Error('缺少当前 SQLite 查询编辑器');
      editor.setPosition(model.getPositionAt(offset));
    }, prefix.length + sql.indexOf('SELECT n AS'));
    await (await navigationMenuItem(query.locator('.query-primary-toolbar'), {name: text.openCurrent, exact: true}, check)).click();
    await expect(modal.getByText(text.currentSource, {exact: true})).toBeVisible();
    await expect(modal.getByLabel(text.source)).toHaveText(sql);
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByLabel(profileText.select, {exact: true}).selectOption('交付 JSON');
    await modal.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(modal.getByLabel(zh.resultExport.format, {exact: true})).toHaveValue('json');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toHaveValue('utf16le');
    await expect(modal.getByText(text.parameterCount(1), {exact: true})).toHaveCount(0);
    await expect(modal.getByRole('button', {name: text.start, exact: true})).toBeDisabled();
    await modal.getByLabel(profileText.name, {exact: true}).fill('月度 JSON');
    await modal.getByRole('button', {name: profileText.update, exact: true}).click();
    await expect(modal.getByLabel(profileText.select, {exact: true})).toHaveValue('月度 JSON');
    await modal.getByRole('button', {name: profileText.delete, exact: true}).click();
    await expect(modal.getByText(profileText.deleted, {exact: true})).toBeVisible();
    await expect(modal.getByLabel(profileText.select, {exact: true}).locator('option')).toHaveCount(1);
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByRole('button', {name: text.parameters, exact: true}).click();
    await parameters.getByLabel(parameterZh.value + ' marker', {exact: true}).fill("中文';🚢");
    await parameters.getByRole('button', {name: text.applyParameters, exact: true}).click();
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('xlsx');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toBeDisabled();
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toHaveValue('utf8');
    await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await modal.getByRole('button', {name: text.start, exact: true}).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(1205));
    const [sheet] = await listExcelSheets({filePath: xlsx});
    let excelRows = 0;
    for await (const row of readExcelRows({filePath: xlsx, sheetId: sheet.id, protocol: 'dbark-v1'})) {
      expect(row).toEqual(rows[excelRows++]);
    }
    expect(excelRows).toBe(1205);
    stage = '按光标流式保存完整 SQLite INSERT 并独立回放';
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('sql');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toBeDisabled();
    await expect(modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true})).toBeDisabled();
    await modal.getByLabel(text.insertTable, {exact: true}).fill('exported');
    await modal.getByLabel(text.insertColumns, {exact: true}).fill('pos\nexact_value\nmarker_value\nbytes');
    await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await modal.getByRole('button', {name: text.start, exact: true}).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(1205));
    const fullSql = readFileSync(fullInsertFile, 'utf8');
    const independent = new DatabaseSync(':memory:');
    try {
      independent.exec('CREATE TABLE exported(pos, exact_value, marker_value, bytes);');
      independent.exec(fullSql);
      expect(independent.prepare('SELECT count(*) AS n FROM exported').get()).toEqual({n: 1205});
      expect(independent.prepare("SELECT pos, CAST(exact_value AS TEXT) AS exact_value, marker_value, hex(bytes) AS bytes FROM exported WHERE pos=1205").get())
        .toEqual({pos: 1205, exact_value: '9223372036854775807', marker_value: "中文';🚢", bytes: '00FF'});
    } finally { independent.close(); }
    await info.attach('SQLite完整INSERT导出窗口', {body: await modal.screenshot({animations: 'disabled'}), contentType: 'image/png'});
    stage = '导出完整 SQLite 查询为 HTML 并核对真实行数';
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('html');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toHaveValue('utf8');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toBeDisabled();
    await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await modal.getByRole('button', {name: text.start, exact: true}).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(1205));
    const fullPage = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      const body = doc.querySelector('tbody')!;
      return {rows: body.rows.length, last: [...body.rows[body.rows.length - 1].cells].map(cell => cell.textContent)};
    }, readFileSync(html, 'utf8'));
    expect(fullPage).toEqual({rows: 1205, last: ['1205', '9223372036854775807', "中文';🚢", 'base64:AP8=']});
    stage = '应用 XML 方案并核对完整查询的实际文件';
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('xml');
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByLabel(profileText.name, {exact: true}).fill('XML 交付');
    await modal.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(modal.getByText(profileText.saved, {exact: true})).toBeVisible();
    await modal.getByLabel(zh.resultExport.format, {exact: true}).selectOption('csv');
    await modal.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(modal.getByLabel(zh.resultExport.format, {exact: true})).toHaveValue('xml');
    await expect(modal.getByLabel(zh.resultExport.encoding, {exact: true})).toBeDisabled();
    await modal.getByText(profileText.title, {exact: true}).click();
    await modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await modal.getByRole('button', {name: text.start, exact: true}).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(1205));
    const fullXml = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'application/xml');
      const records = doc.querySelectorAll('record');
      return {rows: records.length, last: [...records[records.length - 1].children].map(cell => cell.textContent)};
    }, readFileSync(xml, 'utf8'));
    expect(fullXml).toEqual({rows: 1205, last: ['1205', '9223372036854775807', "中文';🚢", 'AP8=']});
    expect(digest()).toBe(before);
    expect(readdirSync(directory).filter(name => name.endsWith('.partial'))).toEqual([]);
    const facts = await application.evaluate(() =>
      (globalThis as typeof globalThis & {sqliteQueryExportProof: {facts: unknown}}).sqliteQueryExportProof.facts);
    expect(facts).toMatchObject({
      denied: [], openCalls: 1, saveCalls: 5, requests: [
        {command: 'sqlite.queryExportParameterNames', value: {sql}},
        {command: 'sqlite.queryExport', value: {sql, format: 'json', encoding: 'utf16le', parameters: [{name: 'marker', type: 'text', value: "中文';🚢"}]}},
        {command: 'sqlite.queryExportParameterNames', value: {sql}},
        {command: 'sqlite.queryExport', value: {sql, format: 'xlsx', encoding: 'utf8', parameters: [{name: 'marker', type: 'text', value: "中文';🚢"}]}},
        {command: 'sqlite.queryExport', value: {sql, format: 'sql', encoding: 'utf8', insertTarget: {database: 'main', table: 'exported', columns: ['pos', 'exact_value', 'marker_value', 'bytes']}, parameters: [{name: 'marker', type: 'text', value: "中文';🚢"}]}},
        {command: 'sqlite.queryExport', value: {sql, format: 'html', encoding: 'utf8', parameters: [{name: 'marker', type: 'text', value: "中文';🚢"}]}},
        {command: 'sqlite.queryExport', value: {sql, format: 'xml', encoding: 'utf8', parameters: [{name: 'marker', type: 'text', value: "中文';🚢"}]}},
      ], replies: Array.from({length: 5}, () => ({ok: true, result: {rows: 1205, fileCommitted: true}})),
    });
    const observed = await page.evaluate(async () => ({
      history: await window.dbark.invoke('history.list', {}),
      tasks: await window.dbark.invoke('tasks.list', {}),
    }));
    expect(observed.history).toEqual([]);
    expect(observed.tasks.find(task => task.kind === 'sqlite.queryExport')).toMatchObject({status: 'completed', progress: 100});
    expect(JSON.stringify(observed.tasks)).not.toContain(sql);
    expect(JSON.stringify(observed.tasks)).not.toContain(target);
    expect(runtime.pageErrors).toEqual([]);
    await info.attach('SQLite 查询导出成功窗口', {body: await modal.screenshot({animations: 'disabled'}), contentType: 'image/png'});
    stage = '改动原草稿后停用旧导出';
    await page.evaluate(() => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const model = api?.editor.getEditors().find(editor => editor.getContainerDomNode().closest('.query-tab .sql-editor-wrap'))?.getModel();
      if (!model) throw Error('缺少原 SQLite 草稿');
      model.setValue(model.getValue() + '\n-- 修改后旧导出失效');
    });
    await expect(modal.getByRole('button', {name: zh.resultExport.chooseFile, exact: true})).toBeDisabled();
    await expect(modal.locator('.error-box')).toContainText(text.changed);
    stage = '执行一次合成查询并导出勾选行 SQLite INSERT';
    await modal.getByRole('button', {name: zh.common.close, exact: true}).click();
    await page.evaluate(sql => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const editor = api?.editor.getEditors().find(instance => instance.getContainerDomNode().closest('.query-tab .sql-editor-wrap'));
      const model = editor?.getModel();
      if (!editor || !model) throw Error('本例缺少原查询模型');
      model.setValue(sql);
      editor.focus();
    }, resultSql);
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+Enter');
    const grid = query.locator('.query-result-grid');
    const dataRows = grid.getByRole('row').filter({has: page.getByRole('gridcell')});
    await expect(dataRows).toHaveCount(2);
    for (const row of await dataRows.all()) await row.getByRole('checkbox').check();
    const beforeResultExport = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await (await navigationMenuItem(query, {name: zh.resultExport.selectedTitle, exact: true}, check)).click();
    const insert = page.getByRole('dialog', {name: zh.resultExport.selectedTitle, exact: true});
    await insert.getByLabel(zh.resultExport.format, {exact: true}).selectOption('sql');
    await expect(insert.getByLabel(zh.resultExport.encoding, {exact: true})).toBeDisabled();
    await insert.getByLabel(resultSqlZh.sqliteDatabase, {exact: true}).fill('main');
    await insert.getByLabel(resultSqlZh.table, {exact: true}).fill('replay');
    for (const [index, name] of ['mixed', 'signed', 'bytes', 'note'].entries())
      await insert.getByLabel(resultSqlZh.column(index + 1), {exact: true}).fill(name);
    await insert.getByRole('button', {name: resultSqlZh.preview, exact: true}).click();
    const preview = insert.getByLabel(resultSqlZh.preview, {exact: true});
    await expect(preview).toContainText('VALUES (9223372036854775807, -0.0');
    await expect(preview).toContainText("VALUES ('9223372036854775807', 1.0");
    await insert.getByRole('button', {name: zh.resultExport.chooseFile, exact: false}).click();
    await insert.getByLabel(resultSqlZh.confirmation, {exact: true}).fill('main.replay');
    await insert.getByRole('checkbox', {name: resultSqlZh.acknowledge, exact: true}).check();
    await insert.getByRole('button', {name: zh.resultExport.start, exact: true}).click();
    await expect(insert.locator('.success-box')).toBeVisible();
    const generated = readFileSync(insertFile, 'utf8');
    expect(generated).toBe(await preview.textContent());
    const replay = new DatabaseSync(':memory:');
    try {
      replay.exec('CREATE TABLE replay(mixed, signed, bytes, note);');
      replay.exec(generated);
      const rows = replay.prepare('SELECT typeof(mixed) AS kind, CAST(mixed AS TEXT) AS mixed, signed, typeof(bytes) AS btype, hex(bytes) AS bytes, hex(note) AS note FROM replay ORDER BY rowid').all();
      expect(rows).toEqual([
        {kind: 'integer', mixed: '9223372036854775807', signed: -0, btype: 'blob', bytes: '00FF', note: 'E4B8ADF09F9AA200E5B0BE'},
        {kind: 'text', mixed: '9223372036854775807', signed: 1, btype: 'null', bytes: '', note: ''},
      ]);
    } finally { replay.close(); }
    expect(digest()).toBe(before);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeResultExport);
    await info.attach('SQLite结果INSERT导出窗口', {body: await insert.screenshot({animations: 'disabled'}), contentType: 'image/png'});
    stage = '勾选快照 HTML 保留空文本、二进制和控制字符';
    await insert.getByRole('button', {name: zh.common.done, exact: true}).click();
    for (const row of await dataRows.all()) await row.getByRole('checkbox').check();
    await (await navigationMenuItem(query, {name: zh.resultExport.selectedTitle, exact: true}, check)).click();
    await insert.getByLabel(zh.resultExport.format, {exact: true}).selectOption('html');
    await insert.getByRole('button', {name: zh.resultExport.chooseFile, exact: false}).click();
    await insert.getByRole('button', {name: zh.resultExport.start, exact: false}).click();
    await expect(insert.locator('.success-box')).toBeVisible();
    const selectedPage = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'text/html');
      return [...doc.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => [cell.textContent, cell.dataset.kind ?? 'text']));
    }, readFileSync(selectedHtml, 'utf8'));
    expect(selectedPage).toEqual([
      [['9223372036854775807', 'text'], ['-0', 'text'], ['base64:AP8=', 'binary'], ['中🚢\\u0000尾', 'text']],
      [['9223372036854775807', 'text'], ['1', 'text'], ['NULL', 'null'], ['空字符串', 'empty']],
    ]);
    stage = '勾选 XML 快照可逆保留 NUL';
    await insert.getByRole('button', {name: zh.common.done, exact: true}).click();
    for (const row of await dataRows.all()) await row.getByRole('checkbox').check();
    await (await navigationMenuItem(query, {name: zh.resultExport.selectedTitle, exact: true}, check)).click();
    await insert.getByLabel(zh.resultExport.format, {exact: true}).selectOption('xml');
    await insert.getByRole('button', {name: zh.resultExport.chooseFile, exact: false}).click();
    await insert.getByRole('button', {name: zh.resultExport.start, exact: false}).click();
    await expect(insert.locator('.success-box')).toBeVisible();
    const selectedXmlCells = await page.evaluate(markup => {
      const doc = new DOMParser().parseFromString(markup, 'application/xml');
      return [...doc.querySelectorAll('cell')].map(cell => [cell.textContent, cell.getAttribute('kind'), cell.getAttribute('encoding')]);
    }, readFileSync(selectedXml, 'utf8'));
    expect(selectedXmlCells[3]).toEqual([Buffer.from('中🚢\0尾', 'utf16le').toString('base64'), 'text', 'utf16le-base64']);
    expect(selectedXmlCells.slice(6)).toEqual([['', 'null', null], ['', 'text', null]]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeResultExport);
    const resultProof = await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & {sqliteQueryExportProof: {facts: unknown; restore(): void}}).sqliteQueryExportProof;
      state.restore(); return state.facts;
    });
    expect(resultProof).toMatchObject({executions: 1, denied: [], saveCalls: 8, resultExports: [
      {command: 'files.previewResultSql', value: {sqliteStorage: {version: 1, rows: ['irbt', 'trnt']}}},
      {command: 'files.exportResult', value: {sql: {sqliteStorage: {version: 1, rows: ['irbt', 'trnt']}}}},
      {command: 'files.releaseResultSql'},
      {command: 'files.exportResult', value: {format: 'html', encoding: 'utf8'}},
      {command: 'files.exportResult', value: {format: 'xml', encoding: 'utf8'}},
    ]});
    stage = '确认原 Electron 进程正常退出';
    await insert.getByRole('button', {name: zh.common.done, exact: true}).click();
    await runtime.confirmOwnedDesktopExit(info);
    expect(originalProcess.exitCode).toBe(0);
    await info.attach('SQLite 查询导出证据', {body: JSON.stringify({platform: process.platform, directory, rows: rows.length, excelRows, sourceSha256: before, facts, resultProof, exitCode: originalProcess.exitCode}), contentType: 'application/json'});
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    try {
      await info.attach('SQLite 查询导出失败现场', {body: JSON.stringify({stage, directory, pid: originalProcess.pid, exitCode: originalProcess.exitCode}), contentType: 'application/json'});
    } catch { /* 附件错误不能覆盖原生验收首错。 */ }
    throw error;
  }
});
