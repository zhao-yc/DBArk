import { Client } from 'pg';
import { databaseSearchZh as text } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { postgresStructureZh as structure } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresIdentifier as q } from '../../src/shared/postgresSql';
import { postgresStructureSearchKinds } from '../../src/shared/databaseSearch';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_SEARCH_NATIVE !== '1', '只运行隔离 PostgreSQL 结构搜索专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('PostgreSQL 全库结构搜索跨库续页，遵循对象权限并定位原字段', async ({}, info) => {
  const user = process.env.DBARK_PGSEARCH_USER ?? '', port = Number(process.env.DBARK_PGSEARCH_PORT);
  const password = process.env.DBARK_PGSEARCH_PASSWORD, adminPassword = process.env.DBARK_PGSEARCH_ADMIN_PASSWORD;
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgsearch_[a-f0-9]{12}$/.test(user) ||
      ![password, adminPassword].every(value => /^[a-f0-9]{64}$/.test(value ?? '')) ||
      !Number.isInteger(port) || port < 1025 || port > 65535 ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 和源码 Electron');

  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const dbOther = user + '_other', denied = user + '_denied';
  const clients: Client[] = [];
  const connect = async (database: string, name = 'postgres', secret = adminPassword) => {
    const client = new Client({ host: '127.0.0.1', port, database, user: name, password: secret, connectionTimeoutMillis: 5000 });
    await client.connect();
    clients.push(client);
    return client;
  };
  try {
    const admin = await connect('postgres');
    await admin.query('CREATE DATABASE ' + q(dbOther) + ' OWNER ' + q(user));
    await admin.query('CREATE DATABASE ' + q(denied));
    await admin.query('REVOKE CONNECT ON DATABASE ' + q(denied) + ' FROM PUBLIC');
    const baseAdmin = await connect(user);
    await baseAdmin.query('CREATE SCHEMA ' + q('Find.区😀') + ' AUTHORIZATION ' + q(user));
    await baseAdmin.query('CREATE TABLE public."Find%_hidden" (id integer)');
    const owner = await connect(user, user, password), second = await connect(dbOther, user, password);
    const schema = q('Find.区😀') + '.';
    await owner.query(`CREATE TABLE ${schema}"Find%_表" (id integer CONSTRAINT "Find%_pk" PRIMARY KEY, "Find%_字段" text CONSTRAINT "Find%_uniq" UNIQUE,
      CONSTRAINT "Find%_check" CHECK (id > 0), CONSTRAINT "Find%_fk" FOREIGN KEY (id) REFERENCES ${schema}"Find%_表"(id))`);
    await owner.query(`CREATE INDEX "Find%_idx" ON ${schema}"Find%_表" (id)`);
    await owner.query(`CREATE VIEW ${schema}"Find%_视图" AS SELECT id FROM ${schema}"Find%_表"`);
    await owner.query(`CREATE SEQUENCE ${schema}"Find%_seq"`);
    await owner.query(`CREATE FUNCTION ${schema}"Find%_fn"(integer) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '不应执行'; END $$`);
    await owner.query(`CREATE FUNCTION ${schema}"Find%_fn"(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$`);
    await owner.query(`CREATE PROCEDURE ${schema}"Find%_proc"() LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '不应执行'; END $$`);
    await owner.query(Array.from({ length: 55 }, (_, index) => 'CREATE TABLE ' + schema + q('page%_' + String(index).padStart(2, '0')) + ' (id integer)').join(';'));
    await owner.query('CREATE TABLE ' + schema + '"pageXYtrap" (id integer)');
    await second.query('CREATE TABLE public."page%_last" (id integer)');

    const connectionName = 'PostgreSQL 搜索隔离连接';
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await form.getByRole('combobox').selectOption('postgresql');
    await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password!);
    await form.getByLabel(zh.connections.text012, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.entry, exact: true }, own)).click();
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    await dialog.getByRole('combobox', { name: text.connection, exact: true }).selectOption({ label: connectionName });
    await expect(dialog.getByRole('combobox', { name: text.searchIn, exact: true })).toBeDisabled();
    const databases = dialog.getByRole('textbox', { name: text.databases, exact: true });
    const keyword = dialog.getByRole('textbox', { name: text.pattern, exact: true });
    const start = dialog.getByRole('button', { name: text.start, exact: true });
    const next = dialog.getByRole('button', { name: text.next, exact: true });
    const status = dialog.locator('.database-search-status');
    const setKinds = async (...kinds: (typeof postgresStructureSearchKinds)[number][]) => {
      for (const kind of postgresStructureSearchKinds) await dialog.getByRole('checkbox', { name: text.kinds[kind], exact: true }).setChecked(kinds.includes(kind));
    };
    const assertClosedSearch = async () => {
      const open = (await admin.query("SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity WHERE application_name = 'tabrelio' AND usename = $1", [user])).rows[0].n;
      expect(open).toBe(0);
    };

    await setKinds('table');
    await databases.fill([user, denied, dbOther].join('\n'));
    await keyword.fill('PAGE%_');
    await dialog.getByRole('combobox', { name: text.onError, exact: true }).selectOption('continue');
    await start.click();
    await expect(status).toContainText(text.summary(50, 0, 3));
    await assertClosedSearch();
    await next.click();
    await expect(status).toContainText(text.summary(55, 1, 3));
    await next.click();
    await expect(status).toContainText(text.summary(55, 2, 3));
    await expect(dialog.locator('.database-search-failures')).toContainText(denied);
    await next.click();
    await expect(status).toContainText(text.summary(56, 3, 3));
    await expect(next).toBeDisabled();
    await assertClosedSearch();
    await page.screenshot({ path: info.outputPath('跨库续页与权限拒绝.png') });

    await databases.fill(user);
    await keyword.fill('^Find%_(表|视图|字段|idx|pk|uniq|check|fk|seq|fn|proc|hidden)$');
    await dialog.getByRole('combobox', { name: text.mode, exact: true }).selectOption('regexp');
    await setKinds(...postgresStructureSearchKinds);
    await start.click();
    await expect(status).toContainText('10/11');
    await next.click();
    // 主键和唯一约束各有独立的索引命中，两个函数重载各有独立签名。
    await expect(status).toContainText(text.summary(14, 11, 11));
    await expect(dialog.getByRole('gridcell', { name: 'Find%_hidden', exact: true })).toHaveCount(0);
    await assertClosedSearch();

    await setKinds('function');
    await keyword.fill('Find%_fn');
    await dialog.getByRole('combobox', { name: text.mode, exact: true }).selectOption('whole');
    await start.click();
    await expect(status).toContainText(text.summary(2, 1, 1));
    await expect(dialog.getByRole('gridcell', { name: schema + '"Find%_fn"(integer)', exact: true })).toBeVisible();
    await expect(dialog.getByRole('gridcell', { name: schema + '"Find%_fn"(text)', exact: true })).toBeVisible();

    await setKinds('column');
    await keyword.fill('Find%_字段');
    await start.click();
    await expect(status).toContainText(text.summary(1, 1, 1));
    await dialog.getByRole('gridcell', { name: 'Find%_字段', exact: true }).click();
    await dialog.getByRole('button', { name: text.open, exact: true }).click();
    const detail = page.getByRole('dialog', { name: structure.title, exact: true });
    await expect(detail.locator('tr[aria-current="true"]')).toContainText('Find%_字段');
    await expect(detail.getByRole('button', { name: structure.sections.columns, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(detail.getByRole('button', { name: /编辑/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('只读结构字段定位.png') });
    await detail.getByRole('button', { name: structure.close, exact: true }).click();
    await expect(detail).toBeHidden();
    await assertClosedSearch();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
  }
});
