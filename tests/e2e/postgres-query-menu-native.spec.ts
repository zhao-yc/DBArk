import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
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
