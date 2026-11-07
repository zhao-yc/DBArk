import mysql, { type RowDataPacket } from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { databaseSearchZh as text } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { definitionNavigationZh as navigationText } from '../../src/renderer/locales/definitionNavigation.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_DEFINITION_REGEXP_NATIVE !== '1', '仅运行隔离 MySQL 或 MariaDB 定义正则定位专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('服务器正则从真实定义导航非空片段并拒绝失效位置', async ({}, info) => {
  const dialect = process.env.DBARK_SEARCH_EDIT_DIALECT, hostname = process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '';
  const port = Number(process.env.DBARK_TEST_PORT), password = process.env.DBARK_TEST_PASSWORD ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      (dialect !== 'mysql' && dialect !== 'mariadb') || !/^tabrelio-search-[a-f0-9]{12}$/.test(hostname) ||
      !Number.isInteger(port) || port < 1025 || port > 65535 || !/^[a-f0-9]{64}$/.test(password) ||
      process.env.DBARK_TEST_HOST !== '127.0.0.1' || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('仅允许本轮回环隔离库及源码 Electron');
  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('原窗口已变化'); };
  const observer = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, charset: 'utf8mb4' });
  const database = 'dbark_e2e_definition_rx_' + randomBytes(6).toString('hex');
  const qualified = (name: string) => '`' + database + '`.`' + name + '`';
  try {
    const [facts] = await observer.query<RowDataPacket[]>('SELECT @@hostname AS host, VERSION() AS version');
    expect(facts[0].host).toBe(hostname);
    expect(facts[0].version).toMatch(dialect === 'mysql' ? /^8\.4\./ : /^11\.4\./);
    await observer.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4');
    await observer.query('CREATE VIEW ' + qualified('regex_view') + " AS SELECT '😀前 XAA1' AS one, 'XBB2' AS two, 'XCC3' AS three");
    await observer.query('CREATE TABLE ' + qualified('regex_many') + "(id INT) COMMENT='" + 'Q9 '.repeat(201) + "'");

    const toolbar = page.locator('.navigation-toolbar'), connectionName = dialect + ' 定义正则隔离';
    await (await navigationMenuItem(toolbar, { name: zh.common.newConnection, exact: true }, own)).click();
    const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await connection.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await connection.getByRole('combobox').selectOption(dialect);
    await connection.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
    await connection.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await connection.getByLabel(zh.common.user, { exact: true }).fill('root');
    await connection.getByLabel(zh.connections.text011, { exact: true }).fill(password);
    await connection.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck();
    await connection.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(connection).toBeHidden();

    const search = page.getByRole('dialog', { name: text.definitionsTitle, exact: true });
    const viewer = page.getByRole('dialog', { name: /^查看.+ · / });
    const navigation = viewer.getByRole('region', { name: navigationText.title, exact: true });
    const run = async (kind: 'table' | 'view', pattern: string, caseSensitive = true) => {
      await (await navigationMenuItem(toolbar, { name: text.entry, exact: true }, own)).click();
      await page.getByRole('dialog', { name: text.title, exact: true }).getByLabel(text.searchIn, { exact: true }).selectOption('definition');
      await search.getByLabel(text.connection, { exact: true }).selectOption({ label: connectionName });
      await search.getByLabel(text.databases, { exact: true }).fill(database);
      await search.getByLabel(text.pattern, { exact: true }).fill(pattern);
      await search.getByLabel(text.mode, { exact: true }).selectOption('regexp');
      await search.getByRole('checkbox', { name: text.caseSensitive, exact: true }).setChecked(caseSensitive);
      for (const name of ['table', 'view', 'procedure', 'function', 'trigger', 'event'] as const) {
        if (name !== kind) await search.getByRole('checkbox', { name: text.kinds[name], exact: true }).uncheck();
      }
      await search.getByRole('button', { name: text.start, exact: true }).click();
      await expect(search.getByRole('button', { name: text.start, exact: true })).toBeEnabled();
      await expect(search.locator('.error-box')).toHaveCount(0);
    };
    const open = async (name: string) => {
      await search.getByRole('gridcell', { name, exact: true }).dblclick();
      await expect(viewer).toBeVisible();
    };
    const close = () => viewer.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    const exact = (sql: string, needle: string, index: number, count: number) => {
      const offset = sql.indexOf(needle);
      expect(offset).toBeGreaterThan(-1);
      const lines = sql.slice(0, offset).split(/\r\n|\r|\n/);
      return navigationText.count(index, count) + navigationText.position(lines.length, lines.at(-1)!.length + 1);
    };

    const [view] = await observer.query<RowDataPacket[]>('SHOW CREATE VIEW ' + qualified('regex_view'));
    const ddl = String(view[0]['Create View']);
    // 锚点先产生空匹配。后续非空匹配依赖原文中的后顾和编号反向引用。
    await run('view', '^|(?<=X)([A-Z])\\1[0-9]');
    await open('regex_view');
    await expect(navigation.getByRole('status')).toHaveText(exact(ddl, 'AA1', 0, 3));
    await expect(navigation).toContainText(navigationText.complete);
    await navigation.getByRole('button', { name: navigationText.next, exact: true }).click();
    await expect(navigation.getByRole('status')).toHaveText(exact(ddl, 'BB2', 1, 3));
    await navigation.getByRole('button', { name: navigationText.next, exact: true }).click();
    await expect(navigation.getByRole('status')).toHaveText(exact(ddl, 'CC3', 2, 3));
    await expect(viewer.locator('.definition-match-active').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath('定义正则定位.png') });
    await close();

    await run('view', '(?<=x)([a-z])\\1[0-9]', false);
    await open('regex_view');
    await expect(navigation.getByRole('status')).toHaveText(exact(ddl, 'AA1', 0, 3));
    await close();

    await run('table', 'Q[0-9]');
    await open('regex_many');
    await expect(navigation).toContainText(navigationText.capped(200));
    await navigation.getByRole('button', { name: navigationText.previous, exact: true }).click();
    await expect(navigation.getByRole('status')).toContainText(navigationText.count(199, 200));
    await close();

    await run('table', '^');
    await open('regex_many');
    await expect(viewer.getByRole('status')).toHaveText(navigationText.unavailable);
    await expect(navigation).toHaveCount(0);
    await close();

    await run('table', 'Q[0-9]');
    await observer.query('ALTER TABLE ' + qualified('regex_many') + " COMMENT='Q8 改动后'");
    await open('regex_many');
    await expect(viewer.getByRole('status')).toHaveText(navigationText.invalid);
    await expect(navigation).toHaveCount(0);
    await expect(viewer.locator('.monaco-editor .view-lines')).toContainText('Q8 改动后');
    await close();
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await observer.query('DROP DATABASE `' + database + '`');
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await observer.end(); }
});
