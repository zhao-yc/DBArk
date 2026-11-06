import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresTableExportZh as text } from '../../src/renderer/locales/postgresTableExport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { queryFilesZh } from '../../src/renderer/locales/queryFiles.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_TABLE_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 单表备份和恢复');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('整表 SQL 备份从真实窗口回放到另一 PostgreSQL 数据库', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, target = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || target !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离回环 PostgreSQL 和源码 Electron');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const client = (db: string) => new Client({ host: '127.0.0.1', port, user, password, database: db });
  const source = client(database), restored = client(target);
  const table = '"归档"."账""本"';
  const rows = `SELECT id::text, legacy::text, note, status::text, amount::text, encode(raw,'hex') AS raw,
    happened::text, calculated, parent FROM ${table} ORDER BY id`;
  const catalog = `SELECT
    (SELECT count(*)::int FROM pg_constraint WHERE conrelid = '${table}'::regclass AND contype IN ('p','u','c','f')) AS constraints,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname='归档' AND tablename='账"本') AS indexes,
    (SELECT tgenabled FROM pg_trigger WHERE tgrelid='${table}'::regclass AND tgname='记账触发') AS trigger,
    obj_description('${table}'::regclass,'pg_class') AS comment`;
  const savePath = info.outputPath('PostgreSQL整表备份.sql');
  try {
    await source.connect(); await restored.connect();
    const dependencies = `CREATE SCHEMA "归档";
      CREATE TYPE "归档"."状态" AS ENUM ('甲','乙');
      CREATE TABLE "归档"."父表" (id int PRIMARY KEY);
      INSERT INTO "归档"."父表" VALUES (7);
      CREATE FUNCTION "归档"."记账"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.note := '改写'; RETURN NEW; END $$;`;
    await source.query(dependencies); await restored.query(dependencies);
    await source.query(`
      CREATE TABLE ${table} (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993 INCREMENT BY 3),
        legacy bigserial UNIQUE, note text, status "归档"."状态" NOT NULL, amount numeric(38,12) CHECK (amount >= 0),
        raw bytea, happened timestamptz, calculated text GENERATED ALWAYS AS (coalesce(note,'空') || '已算') STORED,
        parent int REFERENCES "归档"."父表"(id), PRIMARY KEY (id)
      );
      COMMENT ON TABLE ${table} IS '备份注释';
      CREATE INDEX "账本部分索引" ON ${table} (lower(note)) WHERE note IS NOT NULL;
      CREATE TRIGGER "记账触发" BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION "归档"."记账"();
      ALTER TABLE ${table} DISABLE TRIGGER "记账触发";
      INSERT INTO ${table}(note,status,amount,raw,happened,parent) VALUES
        ('过滤保留','甲',9007199254740993.123456789012,decode('00ff80','hex'),'2026-05-04 11:12:13.123456+08',7),
        ('完整备份','乙',0,decode('','hex'),'2026-06-07 11:12:13.999999-05',7),
        (NULL,'甲',NULL,NULL,NULL,7);
      SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('${table}','id'), 9007199254741020, true);
      SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('${table}','legacy'), 50, true);
    `);
    const expected = (await source.query(rows)).rows, expectedCatalog = (await source.query(catalog)).rows;
    for (const [title, db] of [['备份源库', database], ['恢复目标库', target]] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(title);
      await form.getByRole('combobox').selectOption('postgresql');
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text012, { exact: true }).fill(db);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    const tablePage = page.locator('.postgres-table-tab:visible');
    const openTable = async (title: string, db: string, relation: string) => {
      const node = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').getByText(title, { exact: true }) });
      await node.locator('.connection-row .tree-label').click();
      const dbLabel = node.locator('.database-row .tree-label').filter({ hasText: new RegExp('^' + db + '$') });
      await dbLabel.click();
      await node.locator('.object-row').getByRole('button', { name: relation, exact: true }).click();
      await expect(tablePage.getByRole('grid')).toBeVisible();
    };
    await openTable('备份源库', database, table);
    await tablePage.getByLabel(postgresTableZh.filterColumn, { exact: true }).selectOption('note');
    await tablePage.getByLabel(postgresTableZh.filterText, { exact: true }).fill('过滤保留');
    await tablePage.getByRole('button', { name: postgresTableZh.filter, exact: true }).click();
    await expect(tablePage.getByRole('grid')).not.toContainText('完整备份');
    await application.evaluate(({ dialog }, input) => {
      const save = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (options.title !== input.title || !options.defaultPath?.endsWith('.sql')) throw Error('非本例备份路径');
        dialog.showSaveDialog = save;
        return { canceled: false, filePath: input.savePath };
      }) as typeof save;
    }, { title: text.title, savePath });
    await tablePage.getByRole('button', { name: text.open, exact: true }).click();
    const exportDialog = page.getByRole('dialog', { name: text.title, exact: true });
    await expect(exportDialog).toContainText(text.filtered);
    await exportDialog.getByLabel(text.format, { exact: true }).selectOption('sql-backup');
    await expect(exportDialog).toContainText(text.all);
    await expect(exportDialog.getByRole('checkbox', { name: 'note', exact: true })).toBeDisabled();
    await exportDialog.getByRole('button', { name: text.choose, exact: true }).click();
    await exportDialog.getByRole('button', { name: text.start, exact: true }).click();
    await expect(exportDialog.getByRole('status')).toHaveText(text.backupSaved(3));
    await page.screenshot({ path: info.outputPath('PostgreSQL整表备份.png') });
    const script = await readFile(savePath, 'utf8');
    expect(script).toContain('CREATE TABLE ' + table);
    expect(script).toContain('OVERRIDING SYSTEM VALUE');
    expect(script).toContain('9007199254741020');
    expect(script).not.toMatch(/DROP TABLE|TRUNCATE TABLE/i);
    await exportDialog.getByRole('button', { name: text.close, exact: true }).click();
    expect((await restored.query('SELECT to_regclass($1) AS name', [table])).rows[0].name).toBeNull();

    // 先移除触发器依赖，验证数据写入之后失败也会回滚新表和所属序列。
    await restored.query('DROP FUNCTION "归档"."记账"()');
    await expect(restored.query(script)).rejects.toThrow('记账');
    await restored.query('ROLLBACK');
    expect((await restored.query(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='归档' AND (c.relname='账"本' OR c.relkind='S')`)).rows[0].count).toBe(0);
    await restored.query(`CREATE FUNCTION "归档"."记账"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.note := '改写'; RETURN NEW; END $$;`);

    await openTable('恢复目标库', target, '"归档"."父表"');
    await tablePage.getByRole('button', { name: postgresTableZh.query, exact: true }).click();
    const query = page.locator('.postgres-query:visible');
    await expect(query).toContainText(target);
    await application.evaluate(({ dialog }, input) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== input.title) throw Error('非本例恢复文件');
        dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [input.savePath] };
      }) as typeof open;
    }, { title: '打开SQL文件', savePath });
    await (await navigationMenuItem(query, { name: queryFilesZh.open, exact: true }, own)).click();
    const open = page.getByRole('dialog', { name: queryFilesZh.open, exact: true });
    await (await navigationMenuItem(open, { name: queryFilesZh.openAction, exact: true }, own)).click();
    await expect(open).toBeHidden();
    await expect(query.locator('.monaco-editor .view-lines')).toContainText('单表备份');
    expect((await restored.query('SELECT to_regclass($1) AS name', [table])).rows[0].name).toBeNull();
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    await expect.poll(async () => (await restored.query('SELECT to_regclass($1) AS name', [table])).rows[0].name).not.toBeNull();
    expect((await restored.query(rows)).rows).toEqual(expected);
    expect((await restored.query(catalog)).rows).toEqual(expectedCatalog);
    const result = query.locator('.postgres-results select');
    const committed = result.getByRole('option').filter({ hasText: 'COMMIT' });
    await expect(committed).toHaveCount(1);
    await result.selectOption(await committed.getAttribute('value') ?? '');
    await expect(query.locator('.postgres-results')).toContainText(/服务器回执[：:]\s*COMMIT/);
    await page.screenshot({ path: info.outputPath('PostgreSQL整表恢复.png') });
    await expect(restored.query(script)).rejects.toThrow(/already exists/);
    await restored.query('ROLLBACK');
    expect((await restored.query(rows)).rows).toEqual(expected);
    const next = await restored.query(`INSERT INTO ${table}(note,status,parent) VALUES ('下一行','乙',7)
      RETURNING id::text, legacy::text, calculated`);
    expect(next.rows).toEqual([{ id: '9007199254741023', legacy: '51', calculated: '下一行已算' }]);
    expect((await source.query(rows)).rows).toEqual(expected);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally {
    await Promise.allSettled([source.end(), restored.end()]);
  }
});
