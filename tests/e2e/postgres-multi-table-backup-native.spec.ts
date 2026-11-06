import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresTableBackupZh as text } from '../../src/renderer/locales/postgresTableBackup.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { queryFilesZh } from '../../src/renderer/locales/queryFiles.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_MULTI_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 多表备份和恢复');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('工具菜单备份跨 schema 双向外键与无主键表，在另一数据库原子回放', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, target = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    database !== user || target !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离回环 PostgreSQL 和源码 Electron');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const connect = (db: string) => new Client({ host: '127.0.0.1', port, user, password, database: db });
  const source = connect(database), restored = connect(target);
  const tableA = '"甲"."带""引号"', tableB = '"乙"."账本"', keyless = '"public"."无主键"';
  const savePath = info.outputPath('PostgreSQL多表备份.sql');
  try {
    await source.connect(); await restored.connect();
    const schemas = 'CREATE SCHEMA "甲"; CREATE SCHEMA "乙";';
    await restored.query(schemas + 'CREATE TABLE "public"."入口" (id int PRIMARY KEY);');
    await source.query(schemas + `
      CREATE TABLE ${tableA} (id bigint GENERATED ALWAYS AS IDENTITY, code bigint NOT NULL, link bigint, note text);
      CREATE UNIQUE INDEX "甲唯一索引" ON ${tableA}(code);
      CREATE TABLE ${tableB} (id bigint PRIMARY KEY, code bigint DEFAULT nextval('"甲"."带""引号_id_seq"'::regclass),
        blob bytea, amount numeric(38,12));
      INSERT INTO ${tableA}(code, link, note) VALUES (9007199254740993, 8, '关联甲');
      INSERT INTO ${tableB} VALUES (8, 9007199254740993, decode('00ff80','hex'), 9007199254740993.123456789012);
      ALTER TABLE ${tableA} ADD CONSTRAINT "甲指乙" FOREIGN KEY(link) REFERENCES ${tableB}(id);
      ALTER TABLE ${tableB} ADD CONSTRAINT "乙指甲" FOREIGN KEY(code) REFERENCES ${tableA}(code);
      SELECT setval('"甲"."带""引号_id_seq"'::regclass, 50, true);
      CREATE TABLE ${keyless} (note text);
      INSERT INTO ${keyless} VALUES ('重复'), ('重复'), (NULL);
      CREATE TABLE "public"."不选" (id int);
      CREATE TABLE "public"."保护" (id int); ALTER TABLE "public"."保护" ENABLE ROW LEVEL SECURITY;
    `);
    const inspect = `SELECT
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM (SELECT id::text, code::text, link::text, note FROM ${tableA}) a) AS left_rows,
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM (SELECT id::text, code::text, encode(blob,'hex') AS blob, amount::text FROM ${tableB}) b) AS right_rows,
      (SELECT jsonb_agg(note ORDER BY note NULLS LAST) FROM ${keyless}) AS keyless_rows,
      (SELECT count(*)::int FROM pg_constraint WHERE contype='f' AND conrelid IN ('${tableA}'::regclass,'${tableB}'::regclass)) AS keys`;
    const expected = (await source.query(inspect)).rows;
    for (const [title, db] of [['多表备份源库', database], ['多表恢复目标', target]] as const) {
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
    await application.evaluate(({ dialog }, input) => {
      const save = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (!(args.at(-1) as Electron.SaveDialogOptions).defaultPath?.endsWith('-多表备份.sql')) throw Error('非本例多表备份选择');
        dialog.showSaveDialog = save;
        return { canceled: false, filePath: input.savePath };
      }) as typeof save;
    }, { savePath });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await modal.getByLabel(text.connection, { exact: true }).selectOption({ label: '多表备份源库' });
    await modal.getByLabel(text.database, { exact: true }).selectOption(database);
    await modal.getByRole('checkbox', { name: tableA, exact: true }).check();
    await expect(modal.getByRole('checkbox', { name: '"public"."保护"', exact: true })).toHaveCount(0);
    await modal.getByRole('checkbox', { name: tableB, exact: true }).check();
    await modal.getByRole('textbox', { name: text.search, exact: true }).fill('无主键');
    await modal.getByRole('button', { name: text.visible, exact: true }).click();
    await modal.getByRole('textbox', { name: text.search, exact: true }).clear();
    await expect(modal.getByRole('checkbox', { name: '"public"."不选"', exact: true })).not.toBeChecked();
    await modal.getByRole('button', { name: text.choose, exact: true }).click();
    await modal.getByRole('button', { name: text.start, exact: true }).click();
    await expect(modal.getByRole('status')).toHaveText(text.done(3, 5));
    await page.screenshot({ path: info.outputPath('PostgreSQL多表备份.png') });
    const script = await readFile(savePath, 'utf8');
    expect(script.match(/^BEGIN;/gm)).toHaveLength(1);
    expect(script.match(/^COMMIT;/gm)).toHaveLength(1);
    expect(script).not.toContain('"不选"');
    expect(script.lastIndexOf('INSERT INTO')).toBeLessThan(script.indexOf('FOREIGN KEY'));
    await modal.getByRole('button', { name: text.close, exact: true }).click();

    // 中途建表时出现同名冲突，前面的建表也必须随事务回滚。
    await restored.query(`CREATE TABLE ${tableB} (id int); INSERT INTO ${tableB} VALUES (42);`);
    await expect(restored.query(script)).rejects.toThrow(/already exists/);
    await restored.query('ROLLBACK');
    expect((await restored.query(`SELECT to_regclass($1) AS a, to_regclass($2) AS c, to_regclass($3) AS seq`,
      [tableA, keyless, '"甲"."带""引号_id_seq"'])).rows).toEqual([{ a: null, c: null, seq: null }]);
    expect((await restored.query('SELECT * FROM ' + tableB)).rows).toEqual([{ id: 42 }]);
    await restored.query('DROP TABLE ' + tableB);
    const node = page.locator('.connection-node').filter({ has: page.locator('.connection-row .tree-label').getByText('多表恢复目标', { exact: true }) });
    await node.locator('.connection-row .tree-label').click();
    await node.locator('.database-row .tree-label').filter({ hasText: new RegExp('^' + target + '$') }).click();
    await node.locator('.object-row').getByRole('button', { name: '"public"."入口"', exact: true }).click();
    await page.locator('.postgres-table-tab:visible').getByRole('button', { name: postgresTableZh.query, exact: true }).click();
    const query = page.locator('.postgres-query:visible');
    await expect(query).toContainText(target);
    await application.evaluate(({ dialog }, input) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== '打开SQL文件') throw Error('非本例回放选择');
        dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [input.savePath] };
      }) as typeof open;
    }, { savePath });
    await (await navigationMenuItem(query, { name: queryFilesZh.open, exact: true }, own)).click();
    const open = page.getByRole('dialog', { name: queryFilesZh.open, exact: true });
    await (await navigationMenuItem(open, { name: queryFilesZh.openAction, exact: true }, own)).click();
    await expect(query.locator('.monaco-editor .view-lines')).toContainText('多表备份');
    expect((await restored.query('SELECT to_regclass($1) AS name', [tableA])).rows[0].name).toBeNull();
    await query.getByRole('button', { name: postgresZh.execute, exact: true }).click();
    await expect.poll(async () => (await restored.query('SELECT to_regclass($1) AS name', [tableA])).rows[0].name).not.toBeNull();
    expect((await restored.query(inspect)).rows).toEqual(expected);
    expect((await source.query(inspect)).rows).toEqual(expected);
    expect((await restored.query(`SELECT last_value::text, is_called FROM "甲"."带""引号_id_seq"`)).rows).toEqual([{ last_value: '50', is_called: true }]);
    expect((await restored.query(`SELECT pg_get_expr(d.adbin,d.adrelid) AS expr FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=$1::regclass AND a.attname='code'`, [tableB])).rows[0].expr)
      .toContain('带""引号_id_seq');
    const result = query.locator('.postgres-results select');
    const commit = result.getByRole('option').filter({ hasText: 'COMMIT' });
    await expect(commit).toHaveCount(1);
    await result.selectOption(await commit.getAttribute('value') ?? '');
    await expect(query.locator('.postgres-results')).toContainText(/服务器回执[：:]\s*COMMIT/);
    await page.screenshot({ path: info.outputPath('PostgreSQL多表恢复.png') });
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { await Promise.allSettled([source.end(), restored.end()]); }
});
