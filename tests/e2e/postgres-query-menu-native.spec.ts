import { Client } from 'pg';
import { listExcelSheets, readExcelRows } from '../../src/engine/excelFiles';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { test, expect, page, desktop, pageErrors, quitDesktop } from './desktop-fixture';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { UiCommandId } from '../../src/shared/uiCommands';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { statementNavigationZh as navigationText } from '../../src/renderer/locales/statementNavigation.zh-CN';
import { resultSqlZh } from '../../src/shared/resultSql.zh-CN';
import { formatText, zh } from '../../src/renderer/locales/zh-CN';
import { uiCommandLabels } from '../../src/shared/uiCommands.zh-CN';
import { postgresIdentifier } from '../../src/shared/postgresSql';
import { queryDuplicateZh } from '../../src/renderer/locales/queryDuplicate.zh-CN';
import { queryLayoutZh } from '../../src/renderer/locales/queryLayout.zh-CN';
import { postgresQueryExportZh as fullExportText } from '../../src/renderer/locales/postgresQueryExport.zh-CN';
import { fullQueryExportProfilesZh as profileText } from '../../src/renderer/locales/fullQueryExportProfiles.zh-CN';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryParameterReuseZh as reuseText } from '../../src/renderer/locales/queryParameterReuse.zh-CN';
import { queryFailureSourceZh as failureText } from '../../src/renderer/locales/queryFailureSource.zh-CN';
import { queryPartialOutcomeZh as partialText } from '../../src/renderer/locales/queryPartialOutcome.zh-CN';
import { queryContinueOnErrorZh as continueText } from '../../src/renderer/locales/queryContinueOnError.zh-CN';
import { postgresTransactionSettingsZh as transactionText } from '../../src/renderer/locales/postgresTransactionSettings.zh-CN';
import { postgresSearchPathZh as searchPathText } from '../../src/renderer/locales/postgresSearchPath.zh-CN';
import { postgresQueryTimeoutsZh as timeoutText } from '../../src/renderer/locales/postgresQueryTimeouts.zh-CN';
import { postgresNoticesZh as noticesText } from '../../src/renderer/locales/postgresNotices.zh-CN';
import { postgresNoticeHiddenMessage } from '../../src/shared/postgresNotices';

test.use({trace: 'off', video: 'off', screenshot: 'off'});
const tab = () => page.locator('.postgres-query:visible');
const editor = () => tab().locator('.postgres-editor .monaco-editor');
const script = "SELECT '选区原值' AS result;\nSELECT '第二句原值' AS result;";

async function prepare(connection: Extract<ConnectionProfile, {dialect: 'postgresql'}>, sql: string, resultLimit?: number) {
  await page.addInitScript(() => { self.MonacoEnvironment = {...self.MonacoEnvironment, globalAPI: true}; });
  await page.evaluate(async ({connection, sql, resultLimit}) => {
    const profile = await window.dbark.invoke('connections.save', connection);
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', {...settings, resultLimit: resultLimit ?? settings.resultLimit, activeTabId: 'pg-original', tabs: [
      {id: 'pg-original', kind: 'query', title: '原 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql},
      {id: 'pg-other', kind: 'query', title: '另一 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql: '-- 保留另一草稿'},
    ]});
  }, {connection, sql, resultLimit});
  await page.reload();
  await expect(editor().getByRole('textbox')).toBeVisible();
}

/** 测试从 Electron 实际菜单分发，不替换渲染处理器或后端会话。 */
async function enabled(id: UiCommandId) {
  return desktop.evaluate(({Menu}, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled === true, id);
}
async function command(id: UiCommandId) {
  await expect.poll(() => enabled(id), {message: '等待原生菜单命令 ' + id}).toBe(true);
  await desktop.evaluate(({Menu, BrowserWindow}, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('原生命令或所属窗口已经改变');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  }, id);
}

async function modelSelection(line: number, start: number, end = start) {
  await editor().evaluate((element, range) => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少当前 PostgreSQL 编辑器');
    instance.focus();
    instance.setSelection({startLineNumber: range.line, endLineNumber: range.line, startColumn: range.start, endColumn: range.end});
  }, {line, start, end});
}
async function inspectModel() {
  return editor().evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少当前 PostgreSQL 编辑器');
    const model = instance.getModel()!, selection = instance.getSelection();
    return {sql: model.getValue(), position: instance.getPosition(), selected: selection ? model.getValueInRange(selection) : '',
      identity: [instance.getId(), model.id]};
  });
}

const navigationPanel = () => tab().getByRole('region', {name: navigationText.title, exact: true});
const ambiguousScript = String.raw`SELECT 'a\'; SELECT 2; -- '`;
const ambiguousFoldingScript = ["SELECT 'a\\';", 'SELECT', '2;', "-- close '", ';', 'SELECT 3;'].join('\n');
async function replaceDraft(sql: string) {
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(sql);
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
}

test('PostgreSQL 查询超时分别中止慢语句和锁等待并可恢复', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const dialog = () => page.getByRole('dialog', {name: timeoutText.title, exact: true});
  const toolbar = () => tab().getByRole('button', {name: timeoutText.open, exact: true});
  const field = (name: string) => dialog().getByLabel(name, {exact: true});
  const button = (name: string) => dialog().getByRole('button', {name, exact: true});
  const open = async () => { await toolbar().click(); await expect(dialog()).toContainText(timeoutText.ready); };
  const close = () => button(timeoutText.close).click();
  const grid = () => tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid, state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  const records = async () => (await observer.query('SELECT value FROM public.query_timeout_guard')).rows.map(row => row.value);
  try {
    await observer.query('CREATE TABLE public.query_timeout_guard (value int)');
    await observer.query('INSERT INTO public.query_timeout_guard VALUES (1)');
    await prepare({id: '', name: '隔离 PostgreSQL 查询超时', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '原结果' AS value;");
    await command('execute-all'); await expect(grid()).toContainText('原结果');
    const baseline = await history(), original = await sessions(); expect(original).toHaveLength(1);
    await expect(toolbar()).toBeVisible(); await open();
    const defaults = [await field(timeoutText.statement).inputValue(), await field(timeoutText.lock).inputValue()];
    await field(timeoutText.statement).fill('1.5');
    await expect(dialog()).toContainText(timeoutText.invalid);
    await expect(button(timeoutText.apply)).toBeDisabled();
    await field(timeoutText.statement).fill('600'); await field(timeoutText.lock).fill('150');
    await button(timeoutText.apply).click(); await expect(dialog()).toContainText(timeoutText.applied);
    await expect(field(timeoutText.statement)).toHaveValue('600'); await expect(field(timeoutText.lock)).toHaveValue('150');
    await page.screenshot({path: info.outputPath('PostgreSQL会话查询超时.png')});
    await close();
    expect(await history()).toEqual(baseline); expect(await sessions()).toEqual(original);
    await expect(grid()).toContainText('原结果');

    const choice = tab().getByRole('checkbox', {name: continueText.option, exact: true});
    await replaceDraft('SELECT pg_sleep(2); INSERT INTO public.query_timeout_guard VALUES (9);');
    await choice.check(); await command('execute-all');
    await expect(tab()).toContainText('statement timeout'); await expect(tab()).toContainText(continueText.counts(1, 0, 1));
    expect(await records()).toEqual([1]);
    await choice.uncheck();
    await observer.query('BEGIN'); await observer.query('SELECT * FROM public.query_timeout_guard FOR UPDATE');
    await replaceDraft('UPDATE public.query_timeout_guard SET value = 2;'); await command('execute-all');
    await expect(tab()).toContainText('lock timeout');
    expect(await records()).toEqual([1]); await observer.query('ROLLBACK');
    await expect.poll(sessions).toEqual(original);

    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
    await open();
    await expect(field(timeoutText.statement)).toHaveValue(defaults[0]); await expect(field(timeoutText.lock)).toHaveValue(defaults[1]); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click();
    await open(); await expect(field(timeoutText.statement)).toHaveValue('600');
    await button(timeoutText.reset).click(); await expect(dialog()).toContainText(timeoutText.applied);
    await expect(field(timeoutText.statement)).toHaveValue(defaults[0]); await expect(field(timeoutText.lock)).toHaveValue(defaults[1]); await close();
    await command('execute-all');
    await expect(tab().getByRole('group', {name: postgresZh.receipt, exact: true})).toContainText('服务器回执 UPDATE');
    expect(await records()).toEqual([2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 会话搜索路径显示实际优先级并隔离查询标签', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const schema = '报告, "近况"', quoted = postgresIdentifier(schema);
  const sql = 'SELECT marker FROM search_path_items;';
  const dialog = () => page.getByRole('dialog', {name: searchPathText.title, exact: true});
  const path = () => dialog().getByLabel(searchPathText.configured, {exact: true});
  const effective = () => dialog().getByRole('list', {name: searchPathText.effective, exact: true}).getByRole('listitem');
  const button = (name: string) => dialog().getByRole('button', {name, exact: true});
  const open = () => tab().getByRole('button', {name: searchPathText.open, exact: true}).click();
  const close = () => button(searchPathText.close).click();
  const grid = () => tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid, state, query, xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  try {
    await observer.query('CREATE SCHEMA ' + quoted);
    for (const [owner, marker] of [['public', '默认表'], [quoted, '路径前置表']]) {
      await observer.query('CREATE TABLE ' + owner + '.search_path_items (marker text)');
      await observer.query('INSERT INTO ' + owner + '.search_path_items VALUES ($1)', [marker]);
    }
    await prepare({id: '', name: '隔离 PostgreSQL 搜索路径', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await command('execute-all'); await expect(grid()).toContainText('默认表');
    const baseline = await history(), initial = await sessions(); expect(initial).toHaveLength(1);
    await open(); await expect(dialog()).toContainText(searchPathText.ready);
    await expect(dialog()).toContainText(searchPathText.identity(user, user, initial[0].pid));
    const defaultPath = await path().inputValue();
    await expect(effective()).toHaveText(['pg_catalog', 'public']);
    await dialog().getByLabel(searchPathText.candidates, {exact: true}).selectOption(schema);
    await button(searchPathText.append).click(); await expect(path()).toHaveValue(defaultPath + ', ' + quoted);
    const next = '"缺少的 schema", ' + quoted + ', public';
    await path().fill(next); await button(searchPathText.apply).click();
    await expect(dialog()).toContainText(searchPathText.applied);
    await expect(path()).toHaveValue(next);
    await expect(effective()).toHaveText(['pg_catalog', schema, 'public']);
    await page.screenshot({path: info.outputPath('PostgreSQL会话搜索路径.png')});
    await path().fill('"未闭合'); await button(searchPathText.apply).click();
    await expect(dialog()).toContainText('未取得完整的设置回执');
    await expect(button(searchPathText.apply)).toBeDisabled();
    await button(searchPathText.refresh).click(); await expect(path()).toHaveValue(next);
    await close();
    expect(await history()).toEqual(baseline);
    await expect(grid()).toContainText('默认表');
    await command('execute-all'); await expect(grid()).toContainText('路径前置表');
    expect((await sessions()).map(item => item.pid)).toEqual([initial[0].pid]);

    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
    await open(); await expect(dialog()).toContainText(searchPathText.ready);
    await expect(path()).toHaveValue(defaultPath); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click();
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const transaction = await sessions();
    await open(); await expect(dialog()).toContainText('请先明确提交或回滚原事务，再读取搜索路径');
    await expect(button(searchPathText.reset)).toBeDisabled(); await close();
    expect(await sessions()).toEqual(transaction);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await replaceDraft(sql);
    await open(); await expect(path()).toHaveValue(next);
    await button(searchPathText.reset).click(); await expect(dialog()).toContainText(searchPathText.applied);
    await expect(path()).toHaveValue(defaultPath); await close();
    await command('execute-all'); await expect(grid()).toContainText('默认表');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 会话事务默认设置保持原结果并按实际事务隔离、只读及延期生效', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const dialog = () => page.getByRole('dialog', {name: transactionText.title, exact: true});
  const open = async () => {
    await tab().getByRole('button', {name: transactionText.open, exact: true}).click();
    await expect(dialog().getByText(transactionText.ready, {exact: true})).toBeVisible();
  };
  const close = () => dialog().getByRole('button', {name: transactionText.close, exact: true}).click();
  const apply = async (isolation: string, readOnly: boolean, deferrable: boolean) => {
    await dialog().getByLabel(transactionText.isolation, {exact: true}).selectOption(isolation);
    await dialog().getByRole('checkbox', {name: transactionText.readOnly, exact: true}).setChecked(readOnly);
    await dialog().getByRole('checkbox', {name: transactionText.deferrable, exact: true}).setChecked(deferrable);
    await dialog().getByRole('button', {name: transactionText.apply, exact: true}).click();
    await expect(dialog().getByText(transactionText.applied, {exact: true})).toBeVisible();
  };
  const sessions = async () => (await observer.query("SELECT pid,state,xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  const records = async () => (await observer.query('SELECT id FROM public.transaction_settings_sentinel ORDER BY id')).rows;
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  try {
    await observer.query('CREATE TABLE public.transaction_settings_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 事务设置', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '原结果保持' AS original;");
    await command('execute-all'); const grid = tab().locator('.postgres-results .rdg'); await expect(grid).toContainText('原结果保持');
    const originalResult = await grid.innerText(), before = await history(), original = await sessions(); expect(original).toHaveLength(1);
    await open(); await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('READ COMMITTED');
    await expect(dialog().getByRole('button', {name: transactionText.apply, exact: true})).toBeDisabled();
    await apply('SERIALIZABLE', true, true); expect(await sessions()).toEqual(original); expect(await history()).toEqual(before);
    expect(await grid.innerText()).toBe(originalResult);
    await page.screenshot({path: info.outputPath('PostgreSQL会话事务默认设置.png')}); await close();
    await replaceDraft("SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly, current_setting('transaction_deferrable') AS deferred;");
    await command('execute-all'); await expect(grid).toContainText('serializable'); await expect(grid.getByRole('gridcell').filter({hasText: /^on$/})).toHaveCount(2);
    await replaceDraft('INSERT INTO public.transaction_settings_sentinel VALUES (1);'); await command('execute-all');
    await expect(tab()).toContainText('read-only transaction'); expect(await records()).toEqual([]);
    await open(); await apply('REPEATABLE READ', false, false); await close();
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const active = await sessions(), beforeRead = await history();
    await open(); await expect(dialog()).toContainText(transactionText.active);
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toBeDisabled();
    await expect(dialog().getByRole('button', {name: transactionText.apply, exact: true})).toBeDisabled();
    await close(); expect(await sessions()).toEqual(active); expect(await history()).toEqual(beforeRead);
    // SHOW未提前固定事务快照；用户仍能在第一条SELECT前明确改变当前事务隔离级别。
    const transactional = 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE; INSERT INTO public.transaction_settings_sentinel VALUES (2) RETURNING id;';
    await replaceDraft(transactional);
    await command('execute-all'); await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await expect.poll(async () => (await history()).find(entry => entry.sql === transactional)?.success).toBe(true); expect(await records()).toEqual([]);
    await replaceDraft('SELECT missing_column;'); await command('execute-all');
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.failedTransaction);
    const failed = await observer.query("SELECT pid,state,query FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user]);
    await tab().getByRole('button', {name: transactionText.open, exact: true}).click();
    await expect(dialog()).toContainText('原会话状态未知或事务已失败'); await close();
    expect((await observer.query("SELECT pid,state,query FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows).toEqual(failed.rows);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(await records()).toEqual([]); expect((await sessions())[0].pid).toBe(original[0].pid);
    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click(); await open();
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('READ COMMITTED');
    await expect(dialog().getByRole('checkbox', {name: transactionText.readOnly, exact: true})).not.toBeChecked(); await close();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click(); await open();
    await expect(dialog().getByLabel(transactionText.isolation, {exact: true})).toHaveValue('REPEATABLE READ'); await close();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 成功结果查看实际 SQL 并定位原模型范围', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const duplicate = "SELECT '重复🧭' AS result", commandOnly = 'CREATE TEMP TABLE result_source_guard (id int)';
  const script = [duplicate, 'SELECT missing_column', '/* 第二份😀 */ ' + duplicate, commandOnly].join(';\r\n') + ';';
  const receipt = () => tab().getByRole('group', {name: postgresZh.receipt, exact: true});
  const picker = () => tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const locate = () => receipt().getByRole('button', {name: postgresZh.locateResult, exact: true});
  const view = () => receipt().getByRole('button', {name: zh.query.resultSql, exact: true});
  const dialog = () => page.getByRole('dialog', {name: zh.query.resultSqlTitle, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const close = () => dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  const originalSql = () => dialog().locator('.monaco-editor').evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance?.getModel()) throw Error('缺少结果来源编辑器');
    return {sql: instance.getValue().trim(), readOnly: instance.getRawOptions().readOnly};
  });
  await prepare({id: '', name: '隔离 PostgreSQL 结果来源', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, script);
  await tab().getByRole('checkbox', {name: continueText.option, exact: true}).check(); await command('execute-all');
  await expect(receipt()).toContainText('第 1 条语句');
  const before = await history();
  await picker().selectOption('1');
  await expect(locate()).toBeEnabled();
  await locate().click();
  await expect.poll(async () => {
    const model = await inspectModel(); return [model.position?.lineNumber, model.selected];
  }).toEqual([3, duplicate]);
  await view().click();
  await expect.poll(originalSql).toEqual({sql: '/* 第二份😀 */ ' + duplicate, readOnly: true});
  await expect(dialog().locator('.view-lines')).toContainText('第二份😀');
  await expect.poll(() => enabled('execute-all')).toBe(false);
  await page.screenshot({path: info.outputPath('PostgreSQL结果来源.png')});
  await close();
  await picker().selectOption('2');
  await view().click(); await expect.poll(originalSql).toEqual({sql: commandOnly, readOnly: true}); await close();
  await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(commandOnly);

  await replaceDraft('SELECT 3 AS revised;');
  await expect(locate()).toBeDisabled();
  await view().click(); await expect.poll(originalSql).toEqual({sql: commandOnly, readOnly: true}); await close();
  expect(await history()).toEqual(before);

  // Monaco 插入文本时沿用当前模型的 CRLF 格式。
  const two = duplicate + ';\r\n' + duplicate + ';';
  await replaceDraft(two);
  await modelSelection(2, 1, duplicate.length + 1);
  await command('execute-selection');
  await expect(locate()).toBeEnabled();
  await modelSelection(1, 1);
  await locate().click();
  await expect.poll(async () => {
    const model = await inspectModel(); return [model.position?.lineNumber, model.selected];
  }).toEqual([2, duplicate]);

  const template = 'SELECT length($1::text) AS size', secret = '参数绑定原值🧭';
  await replaceDraft(template + ';');
  await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
  const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
  await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
  await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
  await expect(locate()).toBeEnabled();
  await view().click(); await expect.poll(originalSql).toEqual({sql: template, readOnly: true}); await close();
  await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(template);
  expect(JSON.stringify(await history())).not.toContain(secret); expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 查询回执区分原编号、事务回执和实际接收行数', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const receipt = () => tab().getByRole('group', {name: postgresZh.receipt, exact: true});
  const picker = () => tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const status = () => tab().locator('.tab-status');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.receipt_rows ORDER BY id')).rows.map(row => row.id);
  try {
    await observer.query('CREATE TABLE public.receipt_rows (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 查询回执', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, [
      'INSERT INTO public.receipt_rows VALUES (1) RETURNING id;',
      'SELECT missing_column;',
      'BEGIN;',
      'INSERT INTO public.receipt_rows VALUES (9);',
      'SELECT another_missing;',
      'COMMIT;',
      'UPDATE public.receipt_rows SET id = 2 WHERE id = 1 RETURNING id;',
      'DELETE FROM public.receipt_rows WHERE false;',
      '/*NAME: 实库四行 */ SELECT generate_series(1, 4) AS number;',
    ].join('\n'), 3);
    const choice = tab().getByRole('checkbox', {name: continueText.option, exact: true});
    await choice.check(); await command('execute-all');
    await expect(picker().getByRole('option')).toHaveText([
      '1 · INSERT · 1 行', '3 · BEGIN · 0 行', '4 · INSERT · 0 行', '6 · ROLLBACK · 0 行',
      '7 · UPDATE · 1 行', '8 · DELETE · 0 行', '9 · 实库四行 · SELECT · 1 行',
    ]);
    await expect(receipt()).toContainText('第 1 条语句 · 服务器回执 INSERT · 服务端计数 1 行 · 已接收 1 行');
    await expect(status()).toContainText(/本次总耗时 \d+ ms/);
    await expect(status()).toContainText(postgresZh.idle);
    await expect(tab().getByRole('status', {name: continueText.title, exact: true})).toContainText(continueText.counts(9, 7, 2));
    const before = await history();
    await picker().selectOption('2');
    await expect(receipt()).toContainText('第 4 条语句 · 服务器回执 INSERT · 服务端计数 1 行');
    await expect(receipt()).not.toContainText('已接收');
    await picker().selectOption('3');
    await expect(receipt()).toContainText('第 6 条语句 · 服务器回执 ROLLBACK');
    await expect(receipt()).not.toContainText('服务端计数');
    await picker().selectOption('5');
    await expect(receipt()).toContainText('第 8 条语句 · 服务器回执 DELETE · 服务端计数 0 行');
    await picker().selectOption('6');
    await expect(receipt()).toContainText(/第 9 条语句 · 服务器回执 SELECT · 服务端计数 4 行 · 已接收 1 行 · 本条耗时 \d+ ms/);
    await expect(tab()).toContainText(postgresZh.truncated);
    await status().scrollIntoViewIfNeeded();
    await receipt().scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('PostgreSQL查询回执.png')});
    await picker().selectOption('4');
    await tab().getByRole('button', {name: zh.query.pinResult, exact: true}).click();
    await expect(receipt()).toHaveCount(0);
    await expect(status()).not.toContainText('本次总耗时');
    await tab().getByRole('button', {name: zh.query.currentResults, exact: true}).click();
    await expect(receipt()).toContainText('第 7 条语句 · 服务器回执 UPDATE · 服务端计数 1 行 · 已接收 1 行');
    expect(await history()).toEqual(before); expect(await records()).toEqual([2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 服务端消息保留失败前提示、原文定位、参数隐私及有界续执行', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const first = "DO $$ BEGIN RAISE NOTICE '普通消息🧭' USING DETAIL = '原始详情', HINT = '原始提示'; RAISE WARNING '实际警告'; END; $$";
  const failed = "DO $$ BEGIN RAISE NOTICE '失败前消息'; RAISE EXCEPTION '预期首错'; END; $$";
  const panel = () => tab().locator('details.postgres-notices');
  const open = (n: number) => panel().getByText(noticesText.count(n), {exact: true}).click();
  const entry = (message: string) => panel().getByRole('listitem').filter({hasText: message});
  const search = () => panel().getByRole('searchbox', {name: noticesText.search, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.notice_calls ORDER BY id')).rows.map(row => row.id);
  try {
    await observer.query('CREATE TABLE public.notice_calls (id int)');
    await observer.query(`CREATE FUNCTION public.notice_echo(v text) RETURNS int LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.notice_calls VALUES (1);
        RAISE NOTICE '回显 %', v USING DETAIL = '详情 ' || v, HINT = '提示 ' || v;
        RETURN 1;
      END; $$`);
    await prepare({id: '', name: '隔离 PostgreSQL 服务端消息', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false},
    first + ';\nSELECT 1;\n' + failed + ';\nINSERT INTO public.notice_calls VALUES (9);');
    await command('execute-all');
    const error = () => tab().getByRole('status', {name: partialText.title, exact: true});
    await expect(error()).toContainText(partialText.position(3, 2));
    await expect(tab()).toContainText('预期首错');
    await open(3);
    await expect(panel()).toContainText(noticesText.retained(3, 3));
    await expect(entry('普通消息🧭')).toContainText('NOTICE · 00000');
    await expect(entry('实际警告')).toContainText('WARNING · 01000');
    await expect(entry('失败前消息')).toContainText(noticesText.ordinal(3));
    const beforeLocate = await history();
    for (const [message, ordinal, statement] of [['普通消息🧭', 1, first], ['失败前消息', 3, failed]] as const) {
      await entry(message).getByRole('button', {name: noticesText.locate(ordinal), exact: true}).click();
      await expect.poll(async () => (await inspectModel()).selected).toBe(statement);
    }
    await entry('普通消息🧭').getByRole('button', {name: noticesText.locate(1), exact: true}).click();
    await error().getByRole('button', {name: failureText.locate, exact: true}).click();
    await expect.poll(async () => (await inspectModel()).selected).toBe(failed);
    expect(await history()).toEqual(beforeLocate); expect(await records()).toEqual([]);
    await search().fill('原始提示');
    await expect(panel().getByRole('listitem')).toHaveCount(1);
    for (const [label, value] of [[noticesText.detail, '原始详情'], [noticesText.hint, '原始提示'], [noticesText.context, 'PL/pgSQL']] as const) {
      await entry('普通消息🧭').getByText(label, {exact: true}).click();
      await expect(entry('普通消息🧭').getByText(value, {exact: label !== noticesText.context})).toBeVisible();
    }
    await page.screenshot({path: info.outputPath('PostgreSQL服务端消息.png')});

    await replaceDraft('SELECT public.notice_echo($1::text) AS call_result;');
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true}), secret = '仅参数消息保密😀';
    await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await open(1);
    await expect(panel()).toContainText(noticesText.redacted);
    await expect(panel()).toContainText(postgresNoticeHiddenMessage);
    await expect(panel()).not.toContainText(secret);
    expect(await records()).toEqual([1]);
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('settings.get', {})))).not.toContain(secret);

    await replaceDraft("DO $$ BEGIN FOR i IN 1..205 LOOP RAISE NOTICE '批次 %', i; END LOOP; END; $$;\nINSERT INTO public.notice_calls VALUES (2);");
    await command('execute-all'); await open(205);
    await expect(panel()).toContainText(noticesText.retained(205, 200));
    await expect(panel()).toContainText(noticesText.truncated);
    await expect(panel()).toContainText(noticesText.page(1, 8));
    await panel().getByRole('button', {name: noticesText.next, exact: true}).click();
    await expect(panel().getByText('批次 26', {exact: true})).toBeVisible();
    await search().fill('批次 200'); await expect(panel().getByRole('listitem')).toHaveCount(1);
    await search().fill('批次 205'); await expect(panel()).toContainText(noticesText.empty);
    expect(await records()).toEqual([1, 2]); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 显式遇错继续保留多错定位、原事务、取消及参数隐私', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = 'INSERT INTO public.continue_sentinel VALUES (1);\nSELECT missing_column;\nINSERT INTO public.continue_sentinel VALUES (2);\nSELECT 1/0;\nINSERT INTO public.continue_sentinel VALUES (3);';
  const choice = () => tab().getByRole('checkbox', {name: continueText.option, exact: true});
  const report = () => tab().getByRole('status', {name: continueText.title, exact: true});
  const records = async () => (await observer.query('SELECT id FROM public.continue_sentinel ORDER BY id')).rows.map(row => row.id);
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
  try {
    await observer.query('CREATE TABLE public.continue_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 遇错继续', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await expect(choice()).not.toBeChecked(); await command('execute-all');
    await expect(tab().getByRole('status', {name: partialText.title, exact: true})).toContainText(partialText.position(2, 1));
    expect(await records()).toEqual([1]); await expect(report()).toHaveCount(0);
    const original = await sessions(); expect(original).toHaveLength(1); expect(original[0].state).toBe('idle');
    await observer.query('TRUNCATE public.continue_sentinel');
    await choice().check(); await command('execute-all');
    await expect(report()).toContainText(continueText.counts(5, 3, 2)); await expect(report()).toContainText(continueText.reachedEnd);
    expect(await records()).toEqual([1, 2, 3]); expect(await sessions()).toEqual(original);
    const beforeLocate = await history();
    for (const [ordinal, statement] of [[2, 'SELECT missing_column'], [4, 'SELECT 1/0']] as const) {
      await report().getByRole('button', {name: continueText.locate(ordinal), exact: true}).click();
      await expect.poll(async () => (await inspectModel()).selected).toBe(statement);
    }
    expect(await history()).toEqual(beforeLocate); expect(await records()).toEqual([1, 2, 3]);
    expect(beforeLocate[0].success).toBe(false);
    await page.screenshot({path: info.outputPath('PostgreSQL遇错继续摘要.png')});

    const transactional = 'BEGIN;\nINSERT INTO public.continue_sentinel VALUES (4);\nSELECT missing_column;\nINSERT INTO public.continue_sentinel VALUES (5);\nROLLBACK;\nINSERT INTO public.continue_sentinel VALUES (6);';
    await replaceDraft(transactional); await command('execute-all');
    await expect(report()).toContainText(continueText.counts(6, 4, 2)); await expect(report()).toContainText(continueText.reachedEnd);
    expect(await records()).toEqual([1, 2, 3, 6]); expect(await sessions()).toEqual(original);
    await expect(report()).toContainText('current transaction is aborted');

    await replaceDraft('SELECT missing_column;\nSELECT pg_sleep(20);\nINSERT INTO public.continue_sentinel VALUES (7);');
    await command('execute-all');
    await expect.poll(async () => (await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' AND state='active' AND query LIKE '%pg_sleep(20)%'", [user])).rows[0].n).toBe(1);
    await tab().getByRole('button', {name: postgresZh.stop, exact: true}).click();
    await expect(report()).toContainText(continueText.counts(2, 0, 2)); await expect(report()).toContainText(continueText.stopped);
    expect(await records()).toEqual([1, 2, 3, 6]); await expect.poll(sessions).toEqual(original);

    await replaceDraft('SELECT $1::int AS parameter_error;');
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true}), secret = '续执行参数秘密😀';
    await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(report()).toContainText(continueText.counts(1, 0, 1)); await expect(report()).toContainText('SQLSTATE 22P02');
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(settings)).not.toContain(secret); expect(settings.tabs.every(item => !Object.hasOwn(item, 'continueOnError'))).toBe(true);
    await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click(); await expect(choice()).not.toBeChecked();
    await page.locator('.tab-strip').getByText('原 PostgreSQL 查询', {exact: true}).click(); await expect(choice()).toBeChecked();
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 失败语句定位覆盖脚本、选区、当前及参数，保持提交事实和原事务', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = "/* 已完成😀 */ INSERT INTO public.failure_sentinel VALUES (1) RETURNING id;\r\n/* 未完成🧭 */ SELECT missing_column FROM public.failure_sentinel;\r\nINSERT INTO public.failure_sentinel VALUES (2);";
  const notice = () => tab().getByRole('status', {name: partialText.title, exact: true});
  const locate = () => notice().getByRole('button', {name: failureText.locate, exact: true});
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  const records = async () => (await observer.query('SELECT id FROM public.failure_sentinel ORDER BY id')).rows;
  const select = async (start: number, end = start) => editor().evaluate((element, offsets) => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element)), model = instance?.getModel();
    if (!instance || !model) throw Error('缺少原查询模型');
    const from = model.getPositionAt(offsets.start), to = model.getPositionAt(offsets.end);
    instance.setSelection({startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column}); instance.focus();
  }, {start, end});
  const unchangedLocate = async (expected: string) => {
    await expect(locate()).toBeEnabled(); const before = await history();
    await locate().click(); await expect.poll(async () => (await inspectModel()).selected).toBe(expected);
    await expect.poll(() => editor().evaluate(element => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element)), selection = instance?.getSelection();
      if (!instance || !selection) return JSON.stringify({visible: false});
      const position = instance.getScrolledVisiblePosition(selection.getStartPosition()), layout = instance.getLayoutInfo();
      return JSON.stringify({visible: !!position && position.top >= 0 && position.top + position.height <= layout.height - layout.horizontalScrollbarHeight,
        position, editorHeight: layout.height, scrollbarHeight: layout.horizontalScrollbarHeight, scrollTop: instance.getScrollTop()});
    }), {message: '失败语句正文起点应完整显示在编辑区内'}).toContain('"visible":true');
    expect(await history()).toEqual(before); expect(await records()).toEqual([{id: 1}]);
  };
  try {
    await observer.query('CREATE TABLE public.failure_sentinel (id int PRIMARY KEY)');
    await prepare({id: '', name: '隔离 PostgreSQL 失败定位', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    const actual = (await inspectModel()).sql, firstEnd = actual.indexOf(';'), secondEnd = actual.indexOf(';', firstEnd + 1);
    await command('execute-all'); await expect(notice()).toContainText(partialText.position(2, 1));
    await expect(tab().locator('.postgres-results .rdg')).toContainText('id');
    await tab().getByLabel(queryLayoutZh.placement, {exact: true}).selectOption('results');
    await unchangedLocate(actual.slice(actual.indexOf('SELECT missing_column'), secondEnd)); await expect(editor()).toBeVisible();
    await page.screenshot({path: info.outputPath('PostgreSQL未完成语句定位.png')});
    await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(' '); await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(actual); await expect(locate()).toBeDisabled();

    const selectedScript = "INSERT INTO public.failure_sentinel VALUES (3);\r\nSELECT '选区🧭' AS selected_ok;\r\nSELECT missing_column FROM public.failure_sentinel;\r\nINSERT INTO public.failure_sentinel VALUES (4);";
    await replaceDraft(selectedScript);
    const start = selectedScript.indexOf('SELECT'), failedStart = selectedScript.indexOf(';', start) + 1, end = selectedScript.indexOf(';', failedStart);
    await select(start, end + 1); await command('execute-selection');
    await expect(notice()).toContainText(partialText.position(2, 1));
    await unchangedLocate(selectedScript.slice(failedStart, end).trimStart());
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await select(selectedScript.indexOf('missing_column')); await command('execute-current');
    await expect(notice()).toContainText(partialText.position(1, 0));
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.failedTransaction);
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const failedSession = await sessions(); expect(failedSession).toHaveLength(1); expect(failedSession[0].state).toBe('idle in transaction (aborted)');
    await unchangedLocate(selectedScript.slice(failedStart, end).trimStart()); expect(await sessions()).toEqual(failedSession);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click(); await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);

    const parameterSql = 'SELECT $1::int AS parameter_failure;', secret = '参数失败不应留存😀';
    await replaceDraft(parameterSql); await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    await form.getByLabel(parameterZh.value + ' p1', {exact: true}).fill(secret);
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(notice()).toContainText(partialText.position(1, 0)); await expect(tab()).toContainText('SQLSTATE 22P02');
    await unchangedLocate(parameterSql.slice(0, -1));
    expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('settings.get', {})))).not.toContain(secret);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 参数显式暂存与填入保持原事务，忘记及正文撤销后不复活', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const sql = 'SELECT $1::numeric(60,38) AS amount, $2::bytea AS bytes, $3::text AS note;',
    decimal = '0.12345678901234567890123456789012345678', secret = '仅本标签暂存😀';
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 参数暂存', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    const sessions = async () => (await observer.query("SELECT pid,state,xact_start::text FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const original = await sessions(); expect(original).toHaveLength(1); expect(original[0].state).toBe('idle in transaction');
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    const value = (name: string) => form.getByLabel(parameterZh.value + ' ' + name, {exact: true});
    const fill = form.getByRole('button', {name: reuseText.fill, exact: true});
    const remember = form.getByRole('checkbox', {name: reuseText.remember, exact: true});
    const open = async () => {
      await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
      await expect(value('p1')).toBeVisible(); await expect(form.getByRole('button', {name: parameterZh.execute, exact: true})).toBeEnabled();
    };
    const close = () => form.getByRole('button', {name: zh.common.cancel, exact: true}).click();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    await open(); await expect(remember).not.toBeChecked(); await expect(fill).toBeDisabled();
    await expect(form.getByText(parameterZh.namesDynamic, {exact: true})).toHaveCount(0);
    await form.getByLabel(parameterZh.type + ' p1', {exact: true}).selectOption('decimal'); await value('p1').fill(decimal);
    await form.getByLabel(parameterZh.type + ' p2', {exact: true}).selectOption('binary'); await value('p2').fill('00ff');
    await value('p3').fill(secret); await remember.check();
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg'); await expect(grid).toContainText(secret); await expect(grid).toContainText(decimal);
    await expect.poll(sessions).toEqual(original);
    const afterExecution = await history(); expect(afterExecution.some(entry => entry.sql === sql && entry.success)).toBe(true);
    await open(); await expect(fill).toBeEnabled(); await expect(remember).not.toBeChecked(); await expect(value('p1')).toHaveValue('');
    await fill.click(); await expect(value('p1')).toHaveValue(decimal); await expect(value('p2')).toHaveValue('00ff'); await expect(value('p3')).toHaveValue(secret);
    await expect(form.getByLabel(parameterZh.type + ' p1', {exact: true})).toHaveValue('decimal');
    await expect(form.getByLabel(parameterZh.type + ' p2', {exact: true})).toHaveValue('binary');
    expect(await history()).toEqual(afterExecution); await expect.poll(sessions).toEqual(original);
    await page.screenshot({path: info.outputPath('PostgreSQL参数显式填入.png')});
    await close(); await open(); await expect(fill).toBeEnabled(); await fill.click();
    await form.getByRole('button', {name: reuseText.forget, exact: true}).click();
    await expect(fill).toBeDisabled(); await expect(value('p3')).toHaveValue(secret);
    await remember.check(); await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect.poll(async () => (await history()).filter(entry => entry.sql === sql && entry.success).length)
      .toBe(afterExecution.filter(entry => entry.sql === sql && entry.success).length + 1);
    await open(); await expect(fill).toBeEnabled(); await close();
    await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.insertText(' ');
    await page.keyboard.press('ControlOrMeta+Z'); await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
    await open(); await expect(fill).toBeDisabled(); await expect(value('p3')).toHaveValue(''); await close();
    const persisted = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(persisted)).not.toContain(secret); expect(JSON.stringify(await history())).not.toContain(secret);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain(secret);
    await expect.poll(sessions).toEqual(original);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle); expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 完整导出按协议绑定类型参数并保留原会话及参数隐私', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 导出参数', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, 'SELECT 1 AS original;');
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect.poll(() => grid.innerText()).toContain('original');
    const result = await grid.innerText(), history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    const sql = "SELECT $1::bigint AS id, $2::numeric(60,38) AS amount, $3::text AS note, $4::bytea AS bytes, $5::text AS nullable, '$6' AS literal, $$ $7 $$ AS body FROM generate_series(1,130) AS g WHERE g <= $6::int;";
    const value = "导出参数原文😀'; SELECT '文本内容\n第二行", decimal = '0.12345678901234567890123456789012345678';
    await replaceDraft(sql);
    await tab().getByRole('button', {name: fullExportText.open, exact: true}).click();
    const dialog = page.getByRole('dialog', {name: fullExportText.title, exact: true});
    await dialog.getByRole('button', {name: fullExportText.parameters, exact: true}).click();
    const form = page.getByRole('dialog', {name: parameterZh.title, exact: true});
    const values = [['integer', '9007199254740993'], ['decimal', decimal], ['text', value], ['binary', '00ff'], ['null', ''], ['integer', '129']] as const;
    const fillParameters = async () => {
      for (const [index, [type, value]] of values.entries()) {
        const name = 'p' + (index + 1);
        await form.getByLabel(parameterZh.type + ' ' + name, {exact: true}).selectOption(type);
        if (type !== 'null') await form.getByLabel(parameterZh.value + ' ' + name, {exact: true}).fill(value);
      }
    };
    await fillParameters();
    await expect(form.getByLabel(parameterZh.name + ' 7', {exact: true})).toHaveCount(0);
    await form.getByRole('button', {name: fullExportText.applyParameters, exact: true}).click();
    await expect(dialog).toContainText(fullExportText.parameterCount(6));
    await dialog.getByLabel(zh.resultExport.format).selectOption('json');
    const path = info.outputPath('绑定参数完整结果.json');
    await mkdir(info.outputDir, {recursive: true});
    await desktop.evaluate(({dialog, BrowserWindow}, path) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes('json')))
          throw Error('拒绝本例范围外的文件选择');
        return {canceled: false, filePath: path};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePgParameterExportPicker: () => { dialog.showSaveDialog = original; }});
    }, path);
    await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await dialog.getByRole('button', {name: fullExportText.start, exact: true}).click();
    await expect(dialog.getByText(fullExportText.done(129), {exact: true})).toBeVisible();
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed.results[0].rows).toEqual(Array.from({length: 129}, () => ({id: '9007199254740993', amount: decimal,
      note: value, bytes: {type: 'binary', base64: 'AP8='}, nullable: null, literal: '$6', body: ' $7 '})));
    await page.screenshot({path: info.outputPath('PostgreSQL参数完整导出.png')});
    await dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    await expect.poll(sessions).toEqual(originalSessions);
    expect(await grid.innerText()).toBe(result);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    const persisted = await page.evaluate(() => window.dbark.invoke('settings.get', {}));
    expect(JSON.stringify(persisted)).not.toContain('导出参数原文😀');
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})))).not.toContain('导出参数原文😀');
    await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgParameterExportPicker(): void}).restorePgParameterExportPicker());
    await tab().getByRole('button', {name: postgresZh.parameters, exact: true}).click();
    await fillParameters();
    await form.getByRole('button', {name: parameterZh.execute, exact: true}).click();
    await expect(grid).toContainText(decimal);
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('history.list', {}))).some(entry => entry.sql === sql && entry.success)).toBe(true);
    expect(JSON.stringify(await page.evaluate(() => window.dbark.invoke('history.list', {})))).not.toContain('导出参数原文😀');
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 完整查询导出分批保存 CSV、JSON 和 Excel 并保护原事务及目标文件', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query('CREATE SEQUENCE export_guard');
    const csv = info.outputPath('完整结果.csv'), json = info.outputPath('完整结果.json'), xlsx = info.outputPath('完整结果.xlsx');
    const insertFile = info.outputPath('完整结果.sql'), cancelledSql = info.outputPath('原文件.sql');
    const unchanged = info.outputPath('原文件.csv'), cancelledExcel = info.outputPath('原文件.xlsx');
    await mkdir(info.outputDir, {recursive: true});
    await writeFile(unchanged, '原文件哨兵');
    await writeFile(cancelledExcel, 'Excel 原文件哨兵');
    await writeFile(cancelledSql, 'SQL 原文件哨兵');
    await prepare({id: '', name: '隔离 PostgreSQL 查询导出', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, "SELECT '保留原结果' AS marker;");
    const execute = tab().getByRole('button', {name: postgresZh.execute, exact: true});
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await execute.click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect.poll(() => grid.innerText()).toContain('保留原结果');
    const original = await grid.innerText();
    const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
    const baseline = await history();
    const sessions = () => observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user]);
    const owner = (await sessions()).rows;
    expect(owner).toHaveLength(1);
    expect(owner[0].state).toBe('idle in transaction');
    const output = [csv, csv, json, xlsx, insertFile, unchanged, cancelledExcel, cancelledSql];
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const path = paths[count];
        if (!path || BrowserWindow.getAllWindows().length !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes(path.split('.').at(-1)!)))
          throw Error('拒绝本例范围外的文件选择');
        count++;
        return {canceled: false, filePath: path};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePgFullExportPicker: () => { dialog.showSaveDialog = original; return count; }});
    }, output);
    const dialog = page.getByRole('dialog', {name: fullExportText.title, exact: true});
    const open = () => tab().getByRole('button', {name: fullExportText.open, exact: true}).click();
    const close = () => dialog.getByRole('button', {name: zh.common.close, exact: true}).click();
    const start = async () => {
      await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
      await dialog.getByRole('button', {name: fullExportText.start, exact: true}).click();
    };
    const sql = "WITH data AS (SELECT g FROM generate_series(1,4099) AS g) SELECT 9007199254740993 + g AS id, 0.12345678901234567890::numeric(30,20) AS id, CASE WHEN g % 2 = 0 THEN NULL ELSE '行' || g END AS note, decode('00ff','hex') AS bytes FROM data ORDER BY g;";
    await replaceDraft("SELECT '选区以外';\n" + sql);
    await modelSelection(2, 1, sql.length + 1);
    await open();
    await expect(dialog.getByLabel(fullExportText.source)).toHaveText(sql);
    await dialog.getByLabel(csvExportZh.label).selectOption(';');
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.name, {exact: true}).fill('分号报表');
    await dialog.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(dialog.getByText(profileText.saved, {exact: true})).toBeVisible();
    await dialog.getByLabel(csvExportZh.label).selectOption(',');
    await dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true}).click();
    await expect(dialog.getByRole('button', {name: fullExportText.start, exact: true})).toBeEnabled();
    await dialog.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(dialog.getByLabel(csvExportZh.label)).toHaveValue(';');
    await expect(dialog.getByRole('button', {name: fullExportText.start, exact: true})).toBeDisabled();
    await dialog.getByText(profileText.title, {exact: true}).click();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const lines = (await readFile(csv, 'utf8')).split('\r\n');
    expect(lines[0]).toBe('id;id [2];note;bytes');
    expect(lines.slice(1, -1)).toEqual(Array.from({length: 4099}, (_, i) =>
      `${9007199254740994n + BigInt(i)};0.12345678901234567890;${i % 2 === 0 ? `行${i + 1}` : '\\N'};base64:AP8=`));
    await close();
    await replaceDraft("SELECT nextval('export_guard'); -- 前置🚢\n" + sql + "\nSELECT nextval('export_guard');");
    await modelSelection(2, 10);
    await tab().getByRole('button', {name: fullExportText.openCurrent, exact: true}).click();
    await expect(dialog.getByText(fullExportText.currentSource, {exact: true})).toBeVisible();
    await expect(dialog.getByLabel(fullExportText.source)).toContainText(sql);
    await expect(dialog.getByLabel(fullExportText.source)).not.toContainText("nextval('export_guard')");
    await dialog.getByLabel(zh.resultExport.format).selectOption('json');
    await dialog.getByLabel(zh.resultExport.encoding).selectOption('utf16le');
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const bytes = await readFile(json);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('fffe');
    const parsed = JSON.parse(bytes.toString('utf16le').slice(1));
    expect(parsed.results[0].rows).toEqual(Array.from({length: 4099}, (_, i) => ({id: String(9007199254740994n + BigInt(i)),
      'id [2]': '0.12345678901234567890', note: i % 2 === 0 ? `行${i + 1}` : null, bytes: {type: 'binary', base64: 'AP8='}})));
    await dialog.getByLabel(zh.resultExport.format).selectOption('xlsx');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toHaveValue('utf8');
    await expect(dialog.getByLabel(csvExportZh.label)).toHaveCount(0);
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const [sheet] = await listExcelSheets({filePath: xlsx});
    let rowIndex = 0;
    for await (const row of readExcelRows({filePath: xlsx, sheetId: sheet.id, protocol: 'dbark-v1'})) {
      expect(Object.keys(row)).toEqual(['id', 'id [2]', 'note', 'bytes']);
      expect(row).toEqual({id: String(9007199254740994n + BigInt(rowIndex)), 'id [2]': '0.12345678901234567890',
        note: rowIndex % 2 === 0 ? `行${rowIndex + 1}` : null, bytes: {type: 'binary', base64: 'AP8='}});
      rowIndex++;
    }
    expect(rowIndex).toBe(4099);
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询导出Excel.png')});
    await dialog.getByLabel(zh.resultExport.format).selectOption('sql');
    await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
    await expect(dialog.getByRole('button', {name: zh.resultExport.chooseFile, exact: true})).toBeDisabled();
    await dialog.getByLabel(fullExportText.insertDatabase, {exact: true}).fill('回放"模式');
    await dialog.getByLabel(fullExportText.insertTable, {exact: true}).fill('导出结果');
    await dialog.getByLabel(fullExportText.insertColumns, {exact: true}).fill('exact_id\nexact_amount\nnote\nbytes');
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.name, {exact: true}).fill('回放列映射');
    await dialog.getByRole('button', {name: profileText.add, exact: true}).click();
    await expect(dialog.getByText(profileText.saved, {exact: true})).toBeVisible();
    await close();
    await modelSelection(2, 10);
    await tab().getByRole('button', {name: fullExportText.openCurrent, exact: true}).click();
    await dialog.getByText(profileText.title, {exact: true}).click();
    await dialog.getByLabel(profileText.select, {exact: true}).selectOption('回放列映射');
    await dialog.getByRole('button', {name: profileText.apply, exact: true}).click();
    await expect(dialog.getByLabel(fullExportText.insertDatabase, {exact: true})).toHaveValue('回放"模式');
    await expect(dialog.getByLabel(fullExportText.insertColumns, {exact: true})).toHaveValue('exact_id\nexact_amount\nnote\nbytes');
    await dialog.getByRole('button', {name: profileText.update, exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询导出方案.png')});
    await dialog.getByText(profileText.title, {exact: true}).click();
    await start();
    await expect(dialog.getByText(fullExportText.done(4099), {exact: true})).toBeVisible();
    const generated = await readFile(insertFile, 'utf8');
    expect(generated).toContain('INSERT INTO "回放""模式"."导出结果" ("exact_id", "exact_amount", "note", "bytes")');
    expect(generated).toContain("pg_catalog.set_config(E'DateStyle'");
    expect(generated).not.toContain("nextval('export_guard')");
    await observer.query('CREATE SCHEMA "回放""模式"; CREATE TABLE "回放""模式"."导出结果"(exact_id bigint, exact_amount numeric(30,20), note text, bytes bytea)');
    const beforeSettings = (await observer.query('SHOW DateStyle')).rows;
    await observer.query(generated);
    expect((await observer.query('SHOW DateStyle')).rows).toEqual(beforeSettings);
    const restored = await observer.query(`SELECT exact_id AS id, exact_amount AS "id [2]", note, encode(bytes, 'hex') AS bytes FROM "回放""模式"."导出结果" ORDER BY exact_id`);
    expect(restored.rows).toEqual(parsed.results[0].rows.map((row: {bytes: unknown}) => ({...row, bytes: '00ff'})));
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await page.screenshot({path: info.outputPath('PostgreSQL完整查询INSERT.png')});
    await close();

    await replaceDraft("SELECT nextval('export_guard');");
    await open(); await start();
    await expect(dialog.locator('.error-box')).toContainText(/read.only|只读/i);
    expect(await readFile(unchanged, 'utf8')).toBe('原文件哨兵');
    expect((await observer.query('SELECT is_called FROM export_guard')).rows).toEqual([{is_called: false}]);
    await close();

    await replaceDraft("SELECT g, CASE WHEN g > 64 THEN pg_sleep(30)::text ELSE '' END AS delay FROM generate_series(1,65) AS g;");
    for (const [format, filename, previous] of [
      ['xlsx', cancelledExcel, 'Excel 原文件哨兵'],
      ['sql', cancelledSql, 'SQL 原文件哨兵'],
    ]) {
      await open();
      await dialog.getByLabel(zh.resultExport.format).selectOption(format);
      if (format === 'sql') await dialog.getByLabel(fullExportText.insertTable, {exact: true}).fill('cancelled_export');
      await start();
      // 暂存已存在，且真实后端进入下一批 FETCH 时取消。
      await expect.poll(async () => (await readdir(info.outputDir)).some(name => name.startsWith(basename(filename) + '.dbark-') && name.endsWith('.partial'))).toBe(true);
      await expect.poll(async () => (await observer.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename=$1 AND state='active' AND query LIKE 'FETCH FORWARD 64 FROM dbark_query_export%'", [user])).rows[0].count).toBe(1);
      await dialog.getByRole('button', {name: zh.common.cancel, exact: true}).click();
      await expect(dialog.locator('.error-box')).toContainText(/取消|cancel/i);
      expect(await readFile(filename, 'utf8')).toBe(previous);
      expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
      await close();
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgFullExportPicker(): number}).restorePgFullExportPicker())).toBe(8);
    await expect.poll(async () => (await sessions()).rows).toEqual(owner);
    expect(await history()).toEqual(baseline);
    expect(await grid.innerText()).toBe(original);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 命名结果按实际执行语句区分并随固定结果保留', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const sql = [
    '/*NAME: 不显示的事务回执 */ BEGIN;',
    '/* 前导 /*NAME: 忽略内层 */ 注释 */',
    '--NAME: 月度汇总😀',
    'SELECT 9007199254740993 AS id;',
    '/*NAME: 月度汇总😀 */ SELECT 9007199254740994 AS id;',
    'SELECT $$/*NAME: 字符串内容 */;$$ AS note;',
  ].join('\n');
  await prepare({id: '', name: '隔离 PostgreSQL 命名结果', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
  const execute = tab().getByRole('button', {name: postgresZh.execute, exact: true});
  const picker = tab().getByRole('combobox', {name: 'PostgreSQL结果集', exact: true});
  const grid = tab().locator('.postgres-results .rdg');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  await execute.click();
  await expect(picker.getByRole('option')).toHaveText([
    '1 · BEGIN · 0 行', '2 · 月度汇总😀 · SELECT · 1 行', '3 · 月度汇总😀 · SELECT · 1 行', '4 · SELECT · 1 行',
  ]);
  await picker.selectOption('1');
  await expect(grid).toContainText('9007199254740993');
  await picker.selectOption('2');
  await expect(grid).toContainText('9007199254740994');
  await expect(grid).not.toContainText('9007199254740993');
  await page.screenshot({path: info.outputPath('PostgreSQL命名结果.png')});
  const baseline = await history();
  const next = '/*NAME: 本次单组😀 */ SELECT 7 AS latest;';
  await replaceDraft(next);
  await expect(picker.locator('option:checked')).toHaveText('3 · 月度汇总😀 · SELECT · 1 行');
  await tab().getByRole('button', {name: zh.query.pinResult, exact: true}).click();
  const pinned = tab().getByRole('button', {name: '固定 1 · 月度汇总😀', exact: true});
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  expect(await history()).toEqual(baseline);

  await modelSelection(1, next.indexOf('SELECT') + 1);
  await tab().getByRole('button', {name: postgresZh.current, exact: true}).click();
  await expect(tab().locator('.postgres-result-name')).toHaveText('本次单组😀');
  await expect(grid).toContainText('latest');
  await pinned.click();
  await expect(grid).toContainText('9007199254740994');
  await expect(pinned).toHaveAttribute('aria-pressed', 'true');
  const rollback = tab().getByRole('button', {name: postgresZh.rollback, exact: true});
  await rollback.click();
  await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
  await expect(rollback).toBeDisabled();
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

async function resizeQueryWindow(width: number, height: number) {
  await desktop.evaluate(({BrowserWindow}, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setMinimumSize(720, 320);
    window.setContentSize(size.width, size.height);
  }, {width, height});
}

test('PostgreSQL 查询布局支持原生拖动、键盘和窄窗回退并保留草稿', async ({}, info) => {
  const original = "SELECT 1;\nSELECT '原草稿😀';";
  await prepare({id: '', name: '离线 PostgreSQL 布局', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, original);
  await resizeQueryWindow(1280, 820);
  const placement = tab().getByRole('combobox', {name: queryLayoutZh.placement, exact: true});
  const heightBar = tab().getByRole('separator', {name: queryLayoutZh.separator, exact: true});
  const widthBar = tab().getByRole('separator', {name: queryLayoutZh.widthSeparator, exact: true});
  const height = () => tab().locator('.postgres-editor').evaluate(node => Math.round(node.getBoundingClientRect().height));
  const width = () => tab().locator('.query-layout-editor').evaluate(node => Math.round(node.getBoundingClientRect().width));
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  const saved = async () => (await settings()).tabs.find(item => item.id === 'pg-original');
  await expect(placement).toHaveValue('below');
  await expect.poll(height).toBe(300);
  const maximum = Number(await heightBar.getAttribute('aria-valuemax'));
  expect(maximum).toBeGreaterThanOrEqual(320);
  const draggedHeight = Math.min(360, maximum - 10), savedHeight = draggedHeight + 10;
  const identity = (await inspectModel()).identity;
  await modelSelection(2, original.split('\n')[1].length + 1);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original + ' ');
  const dragHeight = async (delta: number) => {
    const box = await heightBar.boundingBox(); if (!box) throw Error('缺少真实高度分隔条');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + delta, {steps: 4});
  };
  await dragHeight(50);
  await expect.poll(height).toBe(Math.min(350, maximum));
  expect((await saved())?.queryEditorHeight).toBeUndefined();
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(height).toBe(300);
  expect((await saved())?.queryEditorHeight).toBeUndefined();
  await dragHeight(draggedHeight - 300); await page.mouse.up();
  await expect.poll(async () => (await saved())?.queryEditorHeight).toBe(draggedHeight);
  await heightBar.focus(); await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await saved())?.queryEditorHeight).toBe(savedHeight);
  await placement.selectOption('beside');
  await expect(tab()).toHaveAttribute('data-result-layout', 'beside');
  await expect.poll(width).toBe(420);
  await widthBar.focus(); await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await saved())?.queryEditorWidth).toBe(470);
  await expect.poll(width).toBe(470);
  await page.screenshot({path: info.outputPath('PostgreSQL查询左右布局.png')});

  await resizeQueryWindow(790, 500);
  await expect(tab()).toHaveAttribute('data-result-layout', 'below');
  await expect(tab().getByText(queryLayoutZh.besideNarrow, {exact: true})).toBeVisible();
  await expect.poll(height).toBeLessThan(savedHeight);
  expect(await saved()).toMatchObject({queryResultPlacement: 'beside', queryEditorWidth: 470, queryEditorHeight: savedHeight});
  await resizeQueryWindow(1280, 820);
  await expect(tab()).toHaveAttribute('data-result-layout', 'beside');
  await expect.poll(width).toBe(470);
  await placement.selectOption('results');
  await expect(editor()).toBeHidden();
  await command('find');
  await expect(editor().locator('.find-widget')).toBeVisible();
  await expect(placement).toHaveValue('beside');
  await page.keyboard.press('Escape');
  await widthBar.focus(); await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await saved())?.queryEditorWidth).toBe(460);
  expect((await inspectModel()).identity).toEqual(identity);
  expect((await inspectModel()).sql).toBe(original + ' ');
  await editor().getByRole('textbox').focus(); await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  await expect.poll(async () => (await saved())?.sql).toBe(original);
  await placement.selectOption('results');
  await page.reload();
  await expect(placement).toHaveValue('beside');
  await expect.poll(width).toBe(460);
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  expect((await settings()).tabs.find(item => item.id === 'pg-other')).toMatchObject({sql: '-- 保留另一草稿'});
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 查询布局切换保留原结果勾选与活动事务', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE layout_source(id bigint PRIMARY KEY,note text); INSERT INTO layout_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE layout_source SET note='布局前未提交' RETURNING id,note,pg_backend_pid() AS session_id;";
    await prepare({id: '', name: '隔离 PostgreSQL 查询布局', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await resizeQueryWindow(1280, 820);
    const identity = (await inspectModel()).identity;
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg'), row = grid.locator('.rdg-row').filter({hasText: '9007199254740993'});
    await expect.poll(() => grid.innerText()).toContain('布局前未提交');
    await row.getByRole('checkbox').check();
    const result = await grid.innerText(), history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1); expect(originalSessions[0].state).toBe('idle in transaction');
    const placement = tab().getByRole('combobox', {name: queryLayoutZh.placement, exact: true});
    for (const layout of ['beside', 'results', 'below'] as const) {
      await placement.selectOption(layout);
      await expect(tab()).toHaveAttribute('data-result-layout', layout);
      await expect.poll(() => grid.innerText()).toBe(result);
      await expect(row.getByRole('checkbox')).toBeChecked();
      if (layout === 'beside') await page.screenshot({path: info.outputPath('PostgreSQL查询事务左右布局.png')});
    }
    expect((await inspectModel()).identity).toEqual(identity);
    expect((await inspectModel()).sql).toBe(sql);
    expect(await sessions()).toEqual(originalSessions);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    expect((await observer.query('SELECT note FROM layout_source')).rows).toEqual([{note: '服务器原值'}]);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM layout_source')).rows).toEqual([{note: '服务器原值'}]);
    await replaceDraft('SELECT 9007199254740993 AS id;');
    await tab().getByRole('button', {name: postgresZh.explain, exact: true}).click();
    const plan = tab().locator('.postgres-results .explain-view');
    await expect(plan).toContainText('Result');
    await placement.selectOption('results');
    await expect(plan).toBeVisible();
    await expect(plan).toContainText('Result');
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

async function triggerSuggestions() {
  await editor().evaluate(element => {
    const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
    const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
    if (!instance) throw Error('缺少当前 PostgreSQL 编辑器');
    instance.focus(); instance.trigger('keyboard', 'editor.action.triggerSuggest', {});
  });
}

test('PostgreSQL 名称补全插入用户原文和方言模板并保留一次撤销', async ({}, info) => {
  const name = 'pgQuick原文', sql = "-- 原样 $1 ${name}😀\n  SELECT 9007199254740993, 0.12345678901234567890;";
  await prepare({id: '', name: '离线 PostgreSQL 片段补全', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, 'SELECT 0;\n  ');
  await page.evaluate(({name, sql}) => window.dbark.invoke('snippets.save', {id: 'pg-completion', name, group: '离线', description: '', sql, updatedAt: ''}), {name, sql});
  await modelSelection(2, 3);
  await page.keyboard.type('pgQuick');
  const widget = () => page.locator('.suggest-widget.visible');
  await expect(widget().locator('.monaco-list-row.focused .label-name')).toHaveText(name);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT 0;\n  ' + sql);
  await expect(editor().locator('.view-lines')).toContainText('原样 $1 ${name}😀');
  await page.screenshot({path: info.outputPath('PostgreSQL片段名称补全.png')});
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT 0;\n  pgQuick');
  await replaceDraft('按条件');
  await triggerSuggestions();
  await expect(widget().locator('.monaco-list-row.focused .label-name')).toHaveText(zh.snippets.selectColumns);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await inspectModel()).sql).toBe('SELECT "id", "name"\nFROM "your_table"\nWHERE "id" > 0\nORDER BY "id"\nLIMIT 100;');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe('按条件');
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 片段补全沿原会话字符串模式且保留事务和结果', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await prepare({id: '', name: '隔离 PostgreSQL 片段补全', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, '');
    const snippet = "SELECT '$1 ${name}😀' AS literal;", name = 'pgQuick会话';
    await page.evaluate(({name, sql}) => window.dbark.invoke('snippets.save', {id: 'pg-mode-snippet', name, group: '', description: '', sql, updatedAt: ''}), {name, sql: snippet});
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    for (const mode of ['off', 'on'] as const) {
      await replaceDraft(`SELECT set_config('standard_conforming_strings','${mode}',true) AS mode;`);
      await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
      const grid = tab().locator('.postgres-results .rdg');
      // 先等可见网格完成布局，再用相同的innerText口径捕获前后结果。
      await expect.poll(() => grid.innerText()).toContain(mode);
      await expect(tab().getByRole('button', {name: postgresZh.execute, exact: true})).toBeEnabled();
      const result = await grid.innerText(), originalSessions = await sessions();
      expect(originalSessions).toHaveLength(1); expect(originalSessions[0].state).toBe('idle in transaction');
      const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
      // 尾部注释中的闭引号让输入桥不额外补引号，光标处在两种服务器模式下仍有相反归属。
      const source = "SELECT 'a\\';\npgQuick\n-- close '";
      await replaceDraft(source); await modelSelection(2, 8); await triggerSuggestions();
      const widget = page.locator('.suggest-widget.visible');
      if (mode === 'off') {
        await expect(widget).toContainText('No suggestions.');
        await expect(widget.locator('.label-name')).toHaveCount(0);
        await page.keyboard.press('Escape');
        expect((await inspectModel()).sql).toBe(source);
      } else {
        await expect(widget.locator('.monaco-list-row.focused .label-name')).toHaveText(name);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await inspectModel()).sql).toBe("SELECT 'a\\';\n" + snippet + "\n-- close '");
        await page.keyboard.press('ControlOrMeta+Z');
        await expect.poll(async () => (await inspectModel()).sql).toBe(source);
      }
      expect(await grid.innerText()).toBe(result); expect(await sessions()).toEqual(originalSessions);
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    }
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(async () => (await sessions()).map(row => row.state)).toEqual(['idle']);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 片段库支持选区建片段、纯文本插入撤销及失效选区保护', async ({}, info) => {
  const snippet = "SELECT '片段😀', '$1', '${name}', 0.12345678901234567890;", name = 'PostgreSQL 原文片段';
  const original = `SELECT 0;\n${snippet}\nSELECT 9;`;
  const dialog = () => page.getByRole('dialog', {name: zh.snippets.title, exact: true});
  const choose = (name: string) => dialog().getByRole('button', {name: formatText(zh.snippets.selectName, name), exact: true});
  await prepare({id: '', name: '离线 PostgreSQL 片段', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'postgres'}, original);
  await modelSelection(2, 1, snippet.length + 1);
  await page.keyboard.press('Shift+F10');
  await page.locator('.monaco-menu-container:visible').getByRole('menuitem', {name: uiCommandLabels['sql-selection-to-snippet'], exact: true}).click({delay: 120});
  await expect(dialog().getByRole('textbox', {name: zh.snippets.sql, exact: true})).toHaveValue(snippet);
  await page.keyboard.press('Escape');
  await expect(dialog()).toHaveCount(0);
  expect(await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).toEqual([]);
  await modelSelection(2, 1, snippet.length + 1);
  await command('sql-selection-to-snippet');
  await expect(dialog().getByRole('textbox', {name: zh.snippets.sql, exact: true})).toHaveValue(snippet);
  await dialog().getByLabel(zh.snippets.name, {exact: true}).fill(name);
  await dialog().getByRole('button', {name: zh.common.save, exact: true}).click();
  await expect(dialog().getByRole('button', {name: zh.snippets.edit, exact: true})).toBeVisible();
  const saved = await page.evaluate(() => window.dbark.invoke('snippets.list', {}));
  expect(saved).toMatchObject([{name, sql: snippet}]);
  await dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  expect((await inspectModel()).sql).toBe(original);

  const placeholder = 'PLACEHOLDER', before = `SELECT 0;\n${placeholder}\nSELECT 9;`;
  await replaceDraft(before);
  await modelSelection(2, 1, placeholder.length + 1);
  await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
  await choose(zh.snippets.selectColumns).click();
  await expect(dialog().locator('.snippet-details .view-lines')).toContainText('SELECT "id", "name"');
  await expect(dialog().getByRole('button', {name: zh.snippets.edit, exact: true})).toHaveCount(0);
  await choose(name).click();
  await page.keyboard.press('ControlOrMeta+Enter');
  await dialog().getByRole('button', {name: zh.snippets.insert, exact: true}).click();
  await expect(dialog()).toHaveCount(0);
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);
  await expect(editor().locator('.view-lines')).toContainText('片段😀');
  await page.screenshot({path: info.outputPath('PostgreSQL片段插入.png')});
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(before);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(async () => (await inspectModel()).sql).toBe(original);

  await modelSelection(2, 1, snippet.length + 1);
  await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
  await choose(name).click();
  // 公开编辑器API模拟选区漂移及恢复，旧意图不能因回到相同选区而复活。
  await modelSelection(1, 1);
  await modelSelection(2, 1, snippet.length + 1);
  await dialog().getByRole('button', {name: zh.snippets.insert, exact: true}).click();
  await expect(dialog().getByText(zh.snippets.insertChanged, {exact: true})).toBeVisible();
  expect((await inspectModel()).sql).toBe(original);
  await dialog().getByRole('button', {name: zh.common.close, exact: true}).click();
  expect(await page.evaluate(() => window.dbark.invoke('snippets.list', {}))).toEqual(saved);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 片段插入保留原事务、结果和会话且不自动执行', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE snippet_source(id bigint PRIMARY KEY,note text); INSERT INTO snippet_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE snippet_source SET note='片段前未提交事务' WHERE id=9007199254740993 RETURNING id,note,pg_backend_pid() AS session_id;";
    const snippet = "\nSELECT '$1'::text AS literal, '${name}'::text AS placeholder;";
    await prepare({id: '', name: '本轮隔离 PostgreSQL 片段', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await page.evaluate(sql => window.dbark.invoke('snippets.save', {id: 'pg-live-snippet', name: '实库原文片段', group: '', description: '', sql, updatedAt: ''}), snippet);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect(grid).toContainText('片段前未提交事务');
    await expect(tab().getByRole('button', {name: zh.snippets.title, exact: true})).toBeEnabled();
    const originalResult = await grid.innerText();
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    await modelSelection(1, sql.length + 1);
    await tab().getByRole('button', {name: zh.snippets.title, exact: true}).click();
    const dialog = page.getByRole('dialog', {name: zh.snippets.title, exact: true});
    await dialog.getByRole('button', {name: formatText(zh.snippets.selectName, '实库原文片段'), exact: true}).click();
    await dialog.getByRole('button', {name: zh.snippets.insert, exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql + snippet);
    expect(await grid.innerText()).toBe(originalResult);
    expect(await sessions()).toEqual(originalSessions);
    expect((await observer.query('SELECT note FROM snippet_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    await editor().getByRole('textbox').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM snippet_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 复制查询保留当前全文和库，副本与保存来源及原撤销记录独立', async ({}, info) => {
  const name = '已保存 PostgreSQL 来源', savedSql = "SELECT '保存原文';";
  const draft = "-- 当前完整草稿😀\nSELECT '0.12345678901234567890', '$1';";
  await prepare({id: '', name: '离线 PostgreSQL 复制', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'configured_database'}, savedSql);
  await page.evaluate(async ({name, sql}) => {
    const settings = await window.dbark.invoke('settings.get', {});
    const original = settings.tabs.find(tab => tab.id === 'pg-original');
    if (!original) throw Error('原查询缺失');
    const saved = await window.dbark.invoke('queries.create', {
      name, sql, connectionId: original.connectionId, context: {state: 'known', database: 'saved_database'},
    });
    await window.dbark.invoke('settings.save', {...settings, tabs: settings.tabs.map(tab => tab.id === original.id
      ? {...tab, title: name, database: 'saved_database', sourceBinding: saved.source, databaseContext: {state: 'known', database: 'saved_database'}} : tab)});
  }, {name, sql: savedSql});
  await page.reload();
  await expect(editor().getByRole('textbox')).toBeVisible();
  await replaceDraft(draft);
  // 先记录真实编辑器的一步撤销结果。输入桥可能保留多个原生撤销组，复制须保持同一基线。
  await page.keyboard.press('ControlOrMeta+Z');
  const undoBaseline = (await inspectModel()).sql;
  expect(undoBaseline).not.toBe(draft);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
  const settings = () => page.evaluate(() => window.dbark.invoke('settings.get', {}));
  await expect.poll(async () => (await settings()).tabs.find(tab => tab.id === 'pg-original')?.sql).toBe(draft);
  const original = (await settings()).tabs.find(tab => tab.id === 'pg-original')!;
  const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  await tab().getByRole('button', {name: queryDuplicateZh.action, exact: true}).click();
  await expect.poll(async () => (await settings()).tabs.length).toBe(3);
  const copiedSettings = await settings(), copied = copiedSettings.tabs.find(tab => tab.id === copiedSettings.activeTabId)!;
  expect(copied).toMatchObject({kind: 'query', title: name + queryDuplicateZh.suffix, sql: draft,
    connectionId: original.connectionId, database: 'saved_database', databaseContext: {state: 'known', database: 'saved_database'}});
  expect(copied.id).not.toBe(original.id);
  expect(copied.sourceBinding).toBeUndefined();
  expect(copied.fileSourceBinding).toBeUndefined();
  expect(copiedSettings.tabs.find(tab => tab.id === original.id)).toEqual(original);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  await expect.poll(async () => (await inspectModel()).sql).toBe(draft);
  await expect(editor().locator('.view-lines')).toContainText('当前完整草稿');
  await page.screenshot({path: info.outputPath('PostgreSQL复制为新查询.png')});
  await replaceDraft("SELECT '仅修改副本';");
  await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name, exact: true}).click();
  expect((await inspectModel()).sql).toBe(draft);
  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(async () => (await inspectModel()).sql).toBe(undoBaseline);
  expect(await page.evaluate(() => window.dbark.invoke('queries.list', {}))).toEqual(saved);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 复制查询保留原事务、结果和会话且副本不自动执行', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query("CREATE TABLE duplicate_source(id bigint PRIMARY KEY,note text); INSERT INTO duplicate_source VALUES(9007199254740993,'服务器原值')");
    const sql = "UPDATE duplicate_source SET note='原未提交事务' WHERE id=9007199254740993 RETURNING id,note,pg_backend_pid() AS session_id";
    await prepare({id: '', name: '本轮隔离 PostgreSQL 复制', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql);
    await tab().getByRole('button', {name: postgresZh.begin, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeEnabled();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    const grid = tab().locator('.postgres-results .rdg');
    await expect(grid).toContainText('原未提交事务');
    await expect(tab().getByRole('button', {name: queryDuplicateZh.action, exact: true})).toBeEnabled();
    const originalResult = await grid.innerText();
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const sessions = async () => (await observer.query("SELECT pid,state FROM pg_stat_activity WHERE usename=$1 AND application_name='tabrelio' ORDER BY pid", [user])).rows;
    const originalSessions = await sessions();
    expect(originalSessions).toHaveLength(1);
    expect(originalSessions[0].state).toBe('idle in transaction');
    await tab().getByRole('button', {name: queryDuplicateZh.action, exact: true}).click();
    await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
    await expect(tab().locator('.postgres-results .rdg')).toHaveCount(0);
    expect((await inspectModel()).sql).toBe(sql);
    expect(await sessions()).toEqual(originalSessions);
    expect((await observer.query('SELECT note FROM duplicate_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    await page.locator('[data-workspace-tab-id="pg-original"]').getByRole('button', {name: '原 PostgreSQL 查询', exact: true}).click();
    await expect.poll(() => grid.innerText()).toBe(originalResult);
    await tab().getByRole('button', {name: postgresZh.rollback, exact: true}).click();
    await expect(tab().getByRole('button', {name: postgresZh.rollback, exact: true})).toBeDisabled();
    await expect.poll(sessions).toEqual([{...originalSessions[0], state: 'idle'}]);
    expect((await observer.query('SELECT note FROM duplicate_source')).rows).toEqual([{note: '服务器原值'}]);
    expect(pageErrors).toEqual([]);
  } finally { await observer.end(); }
  await quitDesktop();
});

test('PostgreSQL 查询结果 INSERT 文件预览、截断范围、勾选和真实回放', async ({}, info) => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  const schema = '结果😀', fields = ['id', 'Value', 'value', 'bytes', 'nullable', 'stamp'];
  const table = (name: string) => postgresIdentifier(schema) + '.' + postgresIdentifier(name);
  const values = [
    ['9007199254740993', '0.12345678901234567890', "中'\\\n😀", Buffer.from([0, 255]), null, '2026-11-07 12:34:56.123456'],
    ['9007199254740994', '-9.87654321098765432100', '', Buffer.alloc(0), '', '2026-11-08 01:02:03.000004'],
    ['9007199254740995', '1', '超出已返回范围', Buffer.from([1]), '第三行', '2026-11-09 00:00:00'],
  ];
  const allFile = info.outputPath('已返回结果.sql'), selectedFile = info.outputPath('勾选结果.sql');
  try {
    await observer.query('CREATE SCHEMA ' + postgresIdentifier(schema));
    for (const name of ['source', 'all_rows', 'selected_rows'])
      await observer.query('CREATE TABLE ' + table(name) + ' (id bigint PRIMARY KEY, "Value" numeric(38,20), "value" text, bytes bytea, nullable text, stamp timestamp(6))');
    for (const row of values) await observer.query('INSERT INTO ' + table('source') + ' VALUES ($1,$2,$3,$4,$5,$6)', row);
    const sourceSql = 'SELECT id AS duplicate, "Value" AS duplicate, "value", bytes, nullable, stamp FROM ' + table('source') + ' ORDER BY id';
    await prepare({id: '', name: '本轮隔离 PostgreSQL 结果', dialect: 'postgresql', group: '', color: '#123456',
      host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sourceSql);
    await page.evaluate(async () => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', {...settings, resultLimit: 2});
    });
    await page.reload();
    await expect(editor().getByRole('textbox')).toBeVisible();
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    await expect(tab().locator('.postgres-results .rdg')).toContainText('9007199254740994');
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (BrowserWindow.getAllWindows().length !== 1 || args[0] !== BrowserWindow.getAllWindows()[0] ||
            !(args.at(-1) as Electron.SaveDialogOptions).filters?.some(filter => filter.extensions.includes('sql')) || !paths[count])
          throw Error('拒绝本例范围外的文件选择');
        return {canceled: false, filePath: paths[count++]};
      }) as typeof dialog.showSaveDialog;
      Object.assign(globalThis, {restorePostgresResultSqlPicker: () => { dialog.showSaveDialog = original; return count; }});
    }, [allFile, selectedFile]);
    for (const [selected, target, path] of [[false, 'all_rows', allFile], [true, 'selected_rows', selectedFile]] as const) {
      if (selected) await tab().locator('.postgres-results .rdg-row').filter({hasText: '9007199254740994'}).getByRole('checkbox').check();
      await tab().getByRole('button', {name: selected ? zh.resultExport.selectedTitle : zh.resultExport.title, exact: true}).click();
      const dialog = page.getByRole('dialog', {name: selected ? zh.resultExport.selectedTitle : zh.resultExport.title, exact: true});
      await dialog.getByLabel(zh.resultExport.format).selectOption('sql');
      await expect(dialog.getByLabel(zh.resultExport.encoding)).toHaveValue('utf8');
      await expect(dialog.getByLabel(zh.resultExport.encoding)).toBeDisabled();
      if (!selected) await expect(dialog).toContainText(zh.resultExport.truncated);
      await dialog.getByLabel(resultSqlZh.postgresDatabase).fill(schema);
      await dialog.getByLabel(resultSqlZh.table).fill(target);
      for (const [index, name] of fields.entries()) await dialog.getByLabel(resultSqlZh.column(index + 1)).fill(name);
      await dialog.getByRole('button', {name: resultSqlZh.preview, exact: true}).click();
      await expect(dialog.locator('.result-sql-preview')).toContainText('INSERT INTO ' + table(target));
      if (!selected) {
        await dialog.locator('.result-sql-preview').scrollIntoViewIfNeeded();
        await page.screenshot({path: info.outputPath('PostgreSQL查询结果SQL预览.png')});
      }
      await dialog.getByRole('button').filter({hasText: zh.resultExport.chooseFile}).click();
      await dialog.getByLabel(resultSqlZh.postgresConfirmation).fill(schema + '.' + target);
      await dialog.getByRole('checkbox', {name: resultSqlZh.acknowledge, exact: true}).check();
      await dialog.getByRole('button', {name: zh.resultExport.start, exact: true}).click();
      await expect(dialog.locator('.success-box')).toContainText('已导出 ' + (selected ? 1 : 2) + ' 行');
      const generated = await readFile(path, 'utf8');
      expect(generated).not.toContain('超出已返回范围');
      for (const mode of ['on', 'off']) {
        await observer.query('TRUNCATE ' + table(target));
        await observer.query('SET standard_conforming_strings = ' + mode);
        await observer.query(generated);
        const actual = (await observer.query('SELECT id::text, "Value"::text AS numeric, "value" AS note, encode(bytes, \'hex\') AS bytes, nullable, to_char(stamp, \'YYYY-MM-DD HH24:MI:SS.US\') AS stamp FROM ' + table(target) + ' ORDER BY id')).rows;
        const expected = (selected ? values.slice(1, 2) : values.slice(0, 2)).map(row => ({
          id: row[0], numeric: row[1], note: row[2], bytes: (row[3] as Buffer).toString('hex'), nullable: row[4], stamp: row[5],
        }));
        expect(actual).toEqual(expected);
      }
      await dialog.getByRole('button', {name: zh.common.done, exact: true}).click();
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(history);
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePostgresResultSqlPicker(): number}).restorePostgresResultSqlPicker())).toBe(2);
    expect((await observer.query('SELECT count(*)::int AS n FROM ' + table('source'))).rows[0].n).toBe(3);
    expect(pageErrors).toEqual([]);
  } finally {
    await observer.end();
  }
  await quitDesktop();
});

test('PostgreSQL 语句折叠离线保留标题和同行的下一条 SQL', async ({}, info) => {
  const sql = "SELECT 0;\n/* 外层 /* 内层; */ */\nDO $body$\nBEGIN\nPERFORM 42;\nEND;\n$body$; SELECT '相邻语句';";
  await prepare({id: '', name: '离线 PostgreSQL 折叠', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  const expanded = editor().locator('.codicon-folding-expanded');
  const collapsed = editor().locator('.codicon-folding-collapsed');
  const lines = editor().locator('.view-lines');
  await expect(expanded).toHaveCount(0);
  await command('editor-sql-folding');
  await expect(expanded).toHaveCount(1);
  await expanded.click();
  await expect(lines).not.toContainText('PERFORM 42');
  await expect(lines).toContainText('DO $body$');
  await expect(lines).toContainText('外层');
  await expect(lines).toContainText('相邻语句');
  await page.screenshot({path: info.outputPath('PostgreSQL语句折叠.png')});
  await collapsed.click();
  await expect(lines).toContainText('PERFORM 42');
  await expect.poll(async () => (await inspectModel()).sql).toBe(sql);
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('settings.get', {}))).editorSqlFolding).toBe(true);
  await replaceDraft(ambiguousFoldingScript);
  await expect(expanded).toHaveCount(0);
  await command('editor-sql-folding');
  await expect(expanded).toHaveCount(0);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 语句折叠使用真实会话缓存更新范围', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const set = 'SET standard_conforming_strings = ';
  await page.addInitScript(source => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      const request = message as {source?: string; dialect?: string; mode?: {noBackslashEscapes?: boolean}};
      if (request?.source === source && request.dialect === 'postgresql')
        (window as Window & {foldingMode?: boolean}).foldingMode = request.mode?.noBackslashEscapes;
      Reflect.apply(original, this, options === undefined ? [message] : [message, options]);
    };
  }, ambiguousFoldingScript);
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, set + 'off');
  const lines = editor().locator('.view-lines');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  await command('editor-sql-folding');
  for (const mode of ['off', 'on'] as const) {
    if (mode === 'on') await replaceDraft(set + mode);
    await tab().getByRole('button', {name: postgresZh.execute, exact: true}).click();
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === set + mode)).toBe(true);
    await expect.poll(() => enabled('execute-all')).toBe(true);
    const baseline = await history();
    await replaceDraft(ambiguousFoldingScript);
    const foldStart = mode === 'off' ? 1 : 2;
    await modelSelection(foldStart, 1);
    await expect.poll(() => page.evaluate(() => (window as Window & {foldingMode?: boolean}).foldingMode)).toBe(mode === 'on');
    const locate = () => editor().evaluate((element, line) => {
      const api = (window as Window & {monaco?: typeof import('monaco-editor')}).monaco;
      const instance = api?.editor.getEditors().find(item => item.getContainerDomNode().contains(element));
      const position = instance?.getScrolledVisiblePosition({lineNumber: line, column: 1});
      const root = instance?.getDomNode();
      if (!position || !root) return undefined;
      const y = root.getBoundingClientRect().top + position.top + position.height / 2;
      const rect = Array.from(root.querySelectorAll('.codicon-folding-expanded'), icon => icon.getBoundingClientRect())
        .find(bounds => bounds.top <= y && y < bounds.bottom);
      return rect && {x: rect.left + rect.width / 2, y};
    }, foldStart);
    await expect.poll(async () => !!await locate(), {message: '等待实际折叠首行 · ' + mode}).toBe(true);
    const clickPoint = await locate();
    if (!clickPoint) throw Error('折叠按钮在点击前失效');
    await page.mouse.click(clickPoint.x, clickPoint.y);
    await expect(editor().locator('.codicon-folding-collapsed')).toHaveCount(1);
    await expect(lines).not.toContainText('2;');
    if (mode === 'off') await expect(lines).not.toContainText('-- close');
    else await expect(lines).toContainText('-- close');
    await expect(lines).toContainText('SELECT 3;');
    expect((await inspectModel()).sql).toBe(ambiguousFoldingScript);
    expect(await history()).toEqual(baseline);
    await editor().locator('.codicon-folding-collapsed').click();
  }
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 语句导航支持离线目录、原生跳转、选中和编辑失效', async ({}, info) => {
  const body = 'DO $body$BEGIN PERFORM 1; END;$body$';
  const sql = '/* 外层😀 /* 内层; */ */\n' + body + ";\n--第二条\nSELECT '片段;二';\nSELECT 3";
  await prepare({id: '', name: '离线 PostgreSQL 导航', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  const panel = navigationPanel();
  await modelSelection(2, 8);
  await page.keyboard.press('ControlOrMeta+E');
  await expect.poll(async () => (await inspectModel()).selected).toBe(body);
  await expect(panel).toHaveCount(0);
  await command('statement-navigation');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(3));
  await panel.getByRole('button', {name: navigationText.position(0, 2)}).click();
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 1});
  await command('next-statement');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 4, column: 1});
  await command('previous-statement');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 1});
  await command('select-current-statement');
  await expect.poll(async () => (await inspectModel()).selected).toBe(body);
  await panel.getByRole('textbox', {name: navigationText.search}).fill('片段;二');
  await expect(panel.getByRole('status')).toHaveText(navigationText.total(1));
  await panel.getByRole('button', {name: navigationText.select + ' 2'}).click();
  await expect.poll(async () => (await inspectModel()).selected).toBe("SELECT '片段;二'");
  await page.screenshot({path: info.outputPath('PostgreSQL语句导航.png')});

  await replaceDraft(ambiguousScript);
  await expect(panel.getByRole('status')).toHaveText(navigationText.reasons.stale);
  await panel.getByRole('button', {name: navigationText.refresh}).click();
  await expect(panel.getByRole('status')).toHaveText(navigationText.reasons.mode);
  await panel.getByRole('button', {name: navigationText.close}).click();
  await expect(panel).toHaveCount(0);
  await expect(tab().getByText('尚未连接', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 语句导航读取真实会话字符串模式且不执行导航正文', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  const sql = 'SET standard_conforming_strings = ';
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, sql + 'off');
  const history = () => page.evaluate(() => window.dbark.invoke('history.list', {}));
  for (const [mode, count] of [['off', 1], ['on', 2]] as const) {
    if (mode === 'on') await replaceDraft(sql + mode);
    await command('execute-all');
    await expect.poll(async () => (await history()).some(entry => entry.success && entry.sql === sql + mode)).toBe(true);
    await expect(tab().getByText('原查询会话', {exact: true})).toBeVisible();
    const baseline = await history();
    await replaceDraft(ambiguousScript);
    const panel = navigationPanel();
    await tab().getByRole('button', {name: navigationText.entry, exact: true}).click();
    await expect(panel.getByRole('status')).toHaveText(navigationText.total(count));
    await panel.getByRole('button', {name: navigationText.select + ' ' + count}).click();
    await expect.poll(async () => (await inspectModel()).selected).toBe(mode === 'off' ? ambiguousScript : 'SELECT 2');
    expect(await history()).toEqual(baseline);
    await panel.getByRole('button', {name: navigationText.close}).click();
  }
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});

test('PostgreSQL 原生菜单在活动查询中查找、替换、导航、编辑和保存', async ({}, info) => {
  const sql = '--紧邻注释😀\nselect (1 + 2) as value;\nselect 3 as tail;';
  await prepare({id: '', name: '离线 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port: 1, user: 'offline', database: 'offline_db'}, sql);
  const body = async () => (await inspectModel()).sql;
  const undo = async (value = sql) => {
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(body).toBe(value);
  };
  await command('find');
  const widget = editor().locator('.find-widget');
  await expect(widget).toBeVisible();
  await widget.locator('.find-part textarea').fill('value');
  await command('replace');
  await widget.locator('.replace-part textarea').fill('replacement');
  await widget.getByRole('button', {name: /^Replace All/}).click();
  await page.keyboard.press('Escape');
  await expect(widget).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(body).toBe(sql.replace('value', 'replacement'));
  await undo();

  await command('sql-goto-line');
  const jump = page.locator('.quick-input-widget:visible input');
  await jump.fill(':2:8');
  await jump.press('Enter');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 8});
  await command('sql-goto-bracket');
  await expect.poll(async () => (await inspectModel()).position).toMatchObject({lineNumber: 2, column: 14});
  await command('sql-select-bracket');

  await modelSelection(1, 1);
  await command('sql-toggle-comment');
  await expect.poll(body).toBe(sql.replace('--紧邻', '紧邻'));
  await undo();
  await modelSelection(2, 1, 7);
  await command('sql-uppercase');
  await expect.poll(body).toBe(sql.replace('select', 'SELECT'));
  await undo();
  await modelSelection(3, 1);
  await expect.poll(() => enabled('sql-uppercase')).toBe(false);
  await command('sql-duplicate-lines');
  await expect.poll(body).toBe(sql + '\nselect 3 as tail;');
  await undo();
  await command('format');
  await expect.poll(body).not.toBe(sql);
  await undo();

  await command('save-query');
  const save = page.getByRole('dialog', {name: queryBindingZh.title, exact: true});
  await expect(save).toBeVisible();
  await expect.poll(() => enabled('execute-all')).toBe(false);
  await page.screenshot({path: info.outputPath('PostgreSQL原生菜单保存.png')});
  await save.getByLabel(queryBindingZh.name).fill('菜单保存的 PostgreSQL 查询');
  await save.getByRole('button', {name: queryBindingZh.create}).click();
  await expect(save).toHaveCount(0);
  const saved = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
  expect(saved).toEqual([expect.objectContaining({name: '菜单保存的 PostgreSQL 查询', sql, database: 'offline_db'})]);
  await page.locator('.tab-strip').getByText('另一 PostgreSQL 查询', {exact: true}).click();
  await expect.poll(body).toBe('-- 保留另一草稿');
  await command('sql-toggle-comment');
  await expect.poll(body).toBe('保留另一草稿');
  await page.locator('.tab-strip [data-workspace-tab-id="pg-original"]').getByRole('button', {name: '菜单保存的 PostgreSQL 查询', exact: true}).click();
  await expect.poll(body).toBe(sql);
  expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('PostgreSQL 原生查询菜单严格执行选区、当前语句、全部，并停止原任务', async () => {
  test.skip(process.env.DBARK_POSTGRES_QUERY_MENU_NATIVE !== '1', '需要本轮隔离 PostgreSQL');
  const user = process.env.DBARK_PGSEARCH_USER ?? '', password = process.env.DBARK_PGSEARCH_PASSWORD ?? '';
  const port = Number(process.env.DBARK_PGSEARCH_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅允许本轮隔离的回环 PostgreSQL');
  await prepare({id: '', name: '本轮隔离 PostgreSQL', dialect: 'postgresql', group: '', color: '#123456',
    host: '127.0.0.1', port, user, database: user, password, rememberPassword: false}, script);
  const rows = tab().locator('.postgres-results .rdg');
  const idle = () => expect.poll(() => enabled('execute-all')).toBe(true);

  await modelSelection(1, 1);
  await idle();
  await expect.poll(() => enabled('execute-selection')).toBe(false);
  await modelSelection(1, 1, script.indexOf('\n') + 1);
  await command('execute-selection');
  await expect(rows).toContainText('选区原值');
  await idle();
  await modelSelection(2, 10);
  await expect.poll(() => enabled('execute-selection')).toBe(false);
  await command('execute-current');
  await expect(rows).toContainText('第二句原值');
  await idle();

  await modelSelection(2, 1, script.split('\n')[1].length + 1);
  await expect.poll(() => enabled('execute-selection')).toBe(true);
  await command('execute-all');
  await expect(rows).toContainText('选区原值');
  await idle();
  const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
  expect(history.some(entry => entry.sql === script)).toBe(true);
  expect(history.some(entry => entry.sql === script.split('\n')[0])).toBe(true);

  await editor().getByRole('textbox').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('SELECT pg_sleep(20) /* tabrelio_menu_cancel */;');
  const observer = new Client({host: '127.0.0.1', port, user, database: user, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await command('execute');
    const active = async () => Number((await observer.query(
      "SELECT count(*) AS n FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND state = 'active' AND query LIKE $1",
      ['%tabrelio_menu_cancel%'],
    )).rows[0].n);
    await expect.poll(active).toBe(1);
    await expect.poll(() => enabled('execute-all')).toBe(false);
    await command('stop');
    await idle();
    await expect.poll(active).toBe(0);
    await expect.poll(() => enabled('stop')).toBe(false);
  } finally { await observer.end(); }
  await expect(tab().getByRole('button', {name: postgresZh.execute, exact: true})).toBeEnabled();
  expect(pageErrors).toEqual([]);
  await quitDesktop();
});
