import { Client } from 'pg';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresDataCompareZh as text, postgresDataSyncZh as sync } from '../../src/shared/postgresDataCompare';

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
    await expect(modal.getByRole('button', { name: sync.preview, exact: true })).toHaveCount(0);
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
    // 先制造唯一约束冲突。UPDATE 已执行后 INSERT 失败，整批回滚。
    await right.query('CREATE UNIQUE INDEX sync_amount_guard ON "对照"."明细" (amount) WHERE id >= 100');
    await side(text.target, text.connection).selectOption({ label: secondProfile });
    await choose(text.target, targetDatabase, '明细');
    const mark = async (kind: string, key: string) => {
      await modal.getByLabel(text.kind, { exact: true }).selectOption(kind);
      if (kind === 'different') await modal.getByRole('button', { name: text.next, exact: true }).click();
      await modal.getByRole('checkbox', { name: sync.select + ' "' + key + '"', exact: true }).check();
    };
    const preview = modal.getByRole('button', { name: sync.preview, exact: true });
    const apply = modal.getByRole('button', { name: sync.apply, exact: true });
    const confirm = modal.getByLabel(sync.confirm, { exact: true });
    const exact = targetDatabase + '."对照"."明细"';
    const current = async () => (await right.query(`SELECT id::text, amount::text, encode(raw,'hex') AS raw, note
      FROM "对照"."明细" WHERE id IN (1,101,102,9223372036854775807) ORDER BY id`)).rows;
    const original = await current();
    await run.click();
    await expect(summary).toContainText('字段值不同 27');
    await mark('source-only', '101');
    await mark('different', '9223372036854775807');
    await preview.click();
    await confirm.fill(exact);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('整批已回滚');
    expect(await current()).toEqual(original);

    // 同值更新也改变物理行版本，旧比较不得写入。
    await run.click();
    await expect(summary).toContainText('字段值不同 27');
    await mark('different', '9223372036854775807');
    await preview.click();
    await right.query('UPDATE "对照"."明细" SET note=note WHERE id=9223372036854775807');
    await confirm.fill(exact);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('原记录已被修改');
    expect(await current()).toEqual(original);

    await run.click();
    await expect(summary).toContainText('字段值不同 27');
    await mark('source-only', '101');
    await mark('target-only', '102');
    await mark('different', '9223372036854775807');
    await preview.click();
    const review = modal.getByRole('group', { name: sync.preview, exact: true });
    await expect(review.getByRole('listitem')).toHaveText(['插入　"101"', '删除　"102"', '更新　"9223372036854775807"']);
    await confirm.fill(targetDatabase + '."对照"."副本"');
    await expect(apply).toBeDisabled();
    await confirm.fill(exact);
    await expect(apply).toBeEnabled();
    await confirm.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('PostgreSQL差异同步.png') });
    await apply.click();
    await expect(modal.getByRole('status').filter({ hasText: '已确认整批提交' })).toBeVisible();
    expect(await current()).toEqual([
      original[0],
      { id: '101', amount: '0', raw: null, note: '仅左' },
      { id: '9223372036854775807', amount: '9007199254740993.000000000000000001', raw: '00ff80', note: null },
    ]);
    expect((await left.query('SELECT count(*)::int AS count FROM "对照"."明细"')).rows[0].count).toBe(28);
    await run.click();
    await expect(summary).toContainText('相同 2 · 仅左侧 0 · 仅右侧 0 · 字段值不同 26');
    const markFirstChanged = async () => {
      await expect(summary).toContainText('字段值不同 26');
      await modal.getByRole('checkbox', { name: sync.select + ' "1"', exact: true }).check();
      await preview.click();
      await confirm.fill(exact);
    };
    const committedRows = await current();
    await markFirstChanged();
    // 预览完成后新建触发器。写事务必须按锁内实际目录拦截。
    await right.query(`CREATE FUNCTION "对照".sync_trigger() RETURNS trigger LANGUAGE plpgsql AS
      $$BEGIN RAISE EXCEPTION '意外触发'; END;$$;
      CREATE TRIGGER sync_trigger BEFORE UPDATE ON "对照"."明细" FOR EACH ROW EXECUTE FUNCTION "对照".sync_trigger()`);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('启用的触发器或被外键引用');
    expect(await current()).toEqual(committedRows);
    await right.query('DROP TRIGGER sync_trigger ON "对照"."明细"; CREATE TABLE "对照"."引用" (id bigint REFERENCES "对照"."明细"(id) ON DELETE CASCADE)');
    await run.click();
    await markFirstChanged();
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('启用的触发器或被外键引用');
    expect(await current()).toEqual(committedRows);

    // 显式保留 identity 值，计算列在回读时一起核对，序列保持原位置。
    const identitySql = `CREATE TABLE "对照"."标识" (
      id bigint GENERATED ALWAYS AS IDENTITY (START WITH 42) PRIMARY KEY, val int,
      derived int GENERATED ALWAYS AS (val * 2) STORED)`;
    await left.query(identitySql + '; INSERT INTO "对照"."标识" (id,val) OVERRIDING SYSTEM VALUE VALUES (99,7)');
    await right.query(identitySql);
    // 切换数据库重新加载真实表目录。
    await choose(text.source, targetDatabase, '标识');
    await choose(text.source, database, '标识');
    await choose(text.target, database, '标识');
    await choose(text.target, targetDatabase, '标识');
    await run.click();
    await expect(summary).toContainText('仅左侧 1');
    await mark('source-only', '99');
    await preview.click();
    await confirm.fill(targetDatabase + '."对照"."标识"');
    await apply.click();
    await expect(modal.getByRole('status').filter({ hasText: '已确认整批提交' })).toBeVisible();
    expect((await right.query('SELECT id::text,val,derived FROM "对照"."标识"')).rows).toEqual([{ id: '99', val: 7, derived: 14 }]);
    expect((await right.query('SELECT last_value::text,is_called FROM "对照"."标识_id_seq"')).rows)
      .toEqual([{ last_value: '42', is_called: false }]);
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await Promise.allSettled([left.end(), right.end(), reader.end()]); }
});
