import { Client } from 'pg';
import { test, expect, page, desktop, pageErrors, quitDesktop } from './desktop-fixture';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { UiCommandId } from '../../src/shared/uiCommands';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { statementNavigationZh as navigationText } from '../../src/renderer/locales/statementNavigation.zh-CN';

test.use({trace: 'off', video: 'off', screenshot: 'off'});
const tab = () => page.locator('.postgres-query:visible');
const editor = () => tab().locator('.postgres-editor .monaco-editor');
const script = "SELECT '选区原值' AS result;\nSELECT '第二句原值' AS result;";

async function prepare(connection: Extract<ConnectionProfile, {dialect: 'postgresql'}>, sql: string) {
  await page.addInitScript(() => { self.MonacoEnvironment = {...self.MonacoEnvironment, globalAPI: true}; });
  await page.evaluate(async ({connection, sql}) => {
    const profile = await window.dbark.invoke('connections.save', connection);
    const settings = await window.dbark.invoke('settings.get', {});
    await window.dbark.invoke('settings.save', {...settings, activeTabId: 'pg-original', tabs: [
      {id: 'pg-original', kind: 'query', title: '原 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql},
      {id: 'pg-other', kind: 'query', title: '另一 PostgreSQL 查询', connectionId: profile.id, database: connection.database, sql: '-- 保留另一草稿'},
    ]});
  }, {connection, sql});
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
    return {sql: model.getValue(), position: instance.getPosition(), selected: selection ? model.getValueInRange(selection) : ''};
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
