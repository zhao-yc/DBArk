import { Client } from 'pg';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresDataCompareZh as text } from '../../src/shared/postgresDataCompare';

test.skip(process.env.DBARK_POSTGRES_DATA_COMPARE_NATIVE !== '1', '仅运行本轮隔离 PostgreSQL 数据比较');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 同库与跨库比较、原值分页、预算及取消', async ({}, info) => {
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', targetDatabase = process.env.DBARK_POSTGRES_COMPARE_TARGET ?? '';
  const user = process.env.DBARK_POSTGRES_TEST_USER, password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
      targetDatabase !== database + '_target' || user !== database || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离源码 Electron 和本轮 SSH 回环实库');
  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const config = { host: '127.0.0.1', port, user, password, ssl: false, connectionTimeoutMillis: 1500 };
  const left = new Client({ ...config, database }), right = new Client({ ...config, database: targetDatabase });
  const reader = new Client({ ...config, database });
  try {
    await left.connect(); await right.connect(); await reader.connect();
    const schema = 'CREATE SCHEMA "对照"; ';
    await left.query(schema + `CREATE TABLE "对照"."明细" (id bigint PRIMARY KEY, amount numeric, raw bytea, note text, moment timestamptz);
      CREATE TABLE "对照"."副本" (LIKE "对照"."明细" INCLUDING ALL);
      CREATE TABLE "对照"."分区" (LIKE "对照"."明细" INCLUDING ALL) PARTITION BY RANGE (id);
      CREATE TABLE "对照"."分区一" PARTITION OF "对照"."分区" FOR VALUES FROM (1) TO (100);
      CREATE TABLE "对照"."分区余" PARTITION OF "对照"."分区" DEFAULT;
      CREATE TABLE "对照"."行级权限" (LIKE "对照"."明细" INCLUDING ALL);
      ALTER TABLE "对照"."行级权限" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "对照"."行级权限" FORCE ROW LEVEL SECURITY;
      CREATE TABLE "对照"."超限" (LIKE "对照"."明细" INCLUDING ALL);
      CREATE TABLE "对照"."不兼容" (id bigint PRIMARY KEY, amount text, raw bytea, note text, moment timestamptz);
      CREATE VIEW "对照"."视图" AS SELECT * FROM "对照"."明细";
      INSERT INTO "对照"."明细" SELECT i, i, NULL, '左', '2026-04-08T10:11:12.123456+08' FROM generate_series(1,26) i;
      INSERT INTO "对照"."明细" VALUES (101,0,NULL,'仅左',NULL),
        (9223372036854775807,9007199254740993.000000000000000001,decode('00ff80','hex'),NULL,NULL);
      INSERT INTO "对照"."副本" SELECT * FROM "对照"."明细";
      INSERT INTO "对照"."分区" SELECT * FROM "对照"."明细";
      INSERT INTO "对照"."超限" (id) SELECT i FROM generate_series(1,10001) i;`);
    await right.query(schema + `CREATE TABLE "对照"."明细" (note text, moment timestamptz, raw bytea, amount numeric, id bigint PRIMARY KEY);
      INSERT INTO "对照"."明细" (id,amount,raw,note,moment) SELECT i, i, NULL, '右', '2026-04-08T02:11:12.123456Z' FROM generate_series(1,26) i;
      INSERT INTO "对照"."明细" (id,amount,raw,note,moment) VALUES (102,0,NULL,'仅右',NULL),
        (9223372036854775807,9007199254740993.000000000000000002,decode('00ff81','hex'),'',NULL);`);
    await right.query("ALTER DATABASE " + targetDatabase + " SET timezone = 'Pacific/Auckland'");

    const profileName = '对照隔离连接', secondProfile = '对照另一连接';
    const saveConnection = async (name: string, db: string) => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await form.getByRole('combobox').selectOption('postgresql');
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text012, { exact: true }).fill(db);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    };
    await saveConnection(profileName, database);
    await saveConnection(secondProfile, targetDatabase);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const side = (label: string, key: string) => modal.getByLabel(label + key, { exact: true });
    const choose = async (label: string, db: string, table: string) => {
      await side(label, text.database).selectOption(db);
      await side(label, text.table).selectOption('"对照"."' + table + '"');
    };
    const run = modal.getByRole('button', { name: text.run, exact: true });
    const summary = modal.getByRole('status').filter({ hasText: text.key });
    await side(text.source, text.connection).selectOption({ label: profileName });
    await side(text.target, text.connection).selectOption({ label: profileName });
    await choose(text.source, database, '明细');
    await choose(text.target, database, '副本');
    await expect(side(text.source, text.table).getByRole('option', { name: '"对照"."视图"', exact: true })).toHaveCount(0);
    await run.click();
    await expect(modal.getByText(text.shared, { exact: true })).toBeVisible();
    await expect(summary).toContainText('相同 28');

    await choose(text.target, database, '分区');
    await run.click();
    await expect(summary).toContainText('相同 28');

    await choose(text.target, targetDatabase, '明细');
    await run.click();
    await expect(modal.getByText(text.split, { exact: true })).toBeVisible();
    await expect(summary).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await modal.getByLabel(text.kind, { exact: true }).selectOption('different');
    await expect(modal.getByText('1 / 2', { exact: true })).toBeVisible();
    await modal.getByRole('row').filter({ has: page.getByRole('cell', { name: '"1"', exact: true }) })
      .getByRole('button', { name: text.details, exact: true }).click();
    await expect(modal.getByRole('group', { name: text.details, exact: true }).getByText('moment', { exact: false })).toHaveCount(0);
    await modal.getByRole('button', { name: text.next, exact: true }).click();
    await modal.getByRole('row').filter({ hasText: '9223372036854775807' }).getByRole('button', { name: text.details, exact: true }).click();
    const details = modal.getByRole('group', { name: text.details, exact: true });
    await expect(details).toContainText('9007199254740993.000000000000000001');
    await expect(details).toContainText('9007199254740993.000000000000000002');
    await expect(details).toContainText('BYTEA Base64 AP+A');
    await expect(details).toContainText('BYTEA Base64 AP+B');
    const note = details.getByRole('row').filter({ hasText: 'note' });
    await expect(note.getByRole('cell').first()).toHaveText('NULL');
    await expect(note.getByRole('cell').last()).toHaveText('""');
    await page.screenshot({ path: info.outputPath('PostgreSQL数据比较.png') });

    await side(text.target, text.connection).selectOption({ label: secondProfile });
    await choose(text.target, targetDatabase, '明细');
    await run.click();
    await expect(modal.getByText(text.split, { exact: true })).toBeVisible();
    await expect(summary).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');

    await modal.getByLabel(text.filterColumn, { exact: true }).fill('id');
    await modal.getByLabel(text.filterValue, { exact: true }).fill('9223372036854775807');
    await run.click();
    await expect(summary).toContainText('左侧行数 1 · 右侧行数 1 · 相同 0 · 仅左侧 0 · 仅右侧 0 · 字段值不同 1');
    await modal.getByLabel(text.filterValue, { exact: true }).clear();
    await side(text.target, text.connection).selectOption({ label: profileName });
    await choose(text.target, database, '超限');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('比较超过每侧');
    await expect(summary).toHaveCount(0);
    await choose(text.target, database, '不兼容');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('字段名及 PostgreSQL 声明类型须一致');
    await expect(summary).toHaveCount(0);

    await choose(text.target, database, '行级权限');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText(/row-level security/i);
    await expect(summary).toHaveCount(0);

    // 持有真实排他锁，观察比较后端阻塞后取消；取消必须释放该后端并保留其它会话。
    await choose(text.target, database, '副本');
    await left.query('BEGIN; LOCK TABLE "对照"."副本" IN ACCESS EXCLUSIVE MODE');
    const waiting = async () => Number((await reader.query(`SELECT count(*) FROM pg_catalog.pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%"对照"."副本"%'`)).rows[0].count);
    await run.click();
    await expect.poll(waiting).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect(modal.getByRole('alert')).toContainText(text.cancelled);
    await expect.poll(waiting).toBe(0);
    await left.query('ROLLBACK');
    await run.click();
    await expect(summary).toContainText('相同 28');
    for (const [client, raw] of [[left, '00ff80'], [right, '00ff81']] as const) {
      const value = await client.query('SELECT encode(raw,\'hex\') AS value FROM "对照"."明细" WHERE id=9223372036854775807');
      expect(value.rows[0].value).toBe(raw);
    }
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await Promise.allSettled([left.end(), right.end(), reader.end()]); }
});
