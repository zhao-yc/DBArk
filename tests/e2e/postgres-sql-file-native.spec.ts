import { stat, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { postgresSqlFileZh as text } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import { postgresTableBackupZh as backupText } from '../../src/renderer/locales/postgresTableBackup.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_SQL_FILE_NATIVE !== '1', '只运行隔离 PostgreSQL 流式文件执行');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('从工具菜单流式恢复大备份并核对失败与服务端取消回滚', async ({}, info) => {
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
  const source = client(database), observer = client(target);
  const backup = info.outputPath('PostgreSQL多表大备份.sql');
  const bad = info.outputPath('执行失败.sql'), cancel = info.outputPath('服务端取消.sql'), changed = info.outputPath('更换文件.sql');
  const deferred = info.outputPath('延迟约束.sql');
  try {
    await source.connect(); await observer.connect();
    await source.query(`
      CREATE TABLE public.stream_parent (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, payload text);
      INSERT INTO public.stream_parent(payload) SELECT repeat('片段;', 3000) || i FROM generate_series(1,400) i;
      CREATE TABLE public.stream_child (id int PRIMARY KEY, parent bigint REFERENCES public.stream_parent(id), payload bytea);
      INSERT INTO public.stream_child VALUES(1,400,decode('00ff80','hex'));
    `);
    const facts = `SELECT count(*)::int AS rows, sum(octet_length(payload))::text AS bytes,
      md5(string_agg(md5(payload),'' ORDER BY id)) AS digest,
      (SELECT encode(payload,'hex') FROM public.stream_child) AS binary,
      (SELECT count(*)::int FROM pg_constraint WHERE conrelid='public.stream_child'::regclass AND contype='f') AS keys
      FROM public.stream_parent`;
    const expected = (await source.query(facts)).rows;
    await writeFile(bad, 'BEGIN; CREATE TABLE stream_failed(id int); INSERT INTO stream_failed VALUES(1); SELECT * FROM stream_missing; COMMIT;');
    await writeFile(cancel, 'BEGIN; CREATE TABLE stream_cancelled(id int); SELECT pg_sleep(30); COMMIT;');
    await writeFile(changed, 'CREATE TABLE stream_changed(id int);');
    await writeFile(deferred, 'BEGIN; CREATE TABLE stream_deferred(id int REFERENCES stream_parent(id) DEFERRABLE INITIALLY DEFERRED); ' +
      'INSERT INTO stream_deferred VALUES(9999); COMMIT;');
    for (const [title, db] of [['大备份来源', database], ['文件恢复目标', target]] as const) {
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
    // 仅代填本轮系统文件选择。产品目录、授权、导出、执行和取消使用真实入口。
    await application.evaluate(({ dialog }, input) => {
      const open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if (!(args.at(-1) as Electron.SaveDialogOptions).defaultPath?.endsWith('-多表备份.sql')) throw Error('非本例备份文件选择');
        dialog.showSaveDialog = save;
        return { canceled: false, filePath: input.backup };
      }) as typeof save;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== input.title || !input.paths.length) throw Error('非本例执行文件选择');
        const path = input.paths.shift()!;
        if (!input.paths.length) dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
    }, { backup, title: text.title, paths: [backup, bad, deferred, cancel, changed] });
    const tool = async (name: string) => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true }, own)).click();
    await tool(backupText.title);
    const backupDialog = page.getByRole('dialog', { name: backupText.title, exact: true });
    await backupDialog.getByLabel(backupText.connection, { exact: true }).selectOption({ label: '大备份来源' });
    await backupDialog.getByLabel(backupText.database, { exact: true }).selectOption(database);
    await backupDialog.getByRole('checkbox', { name: '"public"."stream_parent"', exact: true }).check();
    await backupDialog.getByRole('checkbox', { name: '"public"."stream_child"', exact: true }).check();
    await backupDialog.getByRole('button', { name: backupText.choose, exact: true }).click();
    await backupDialog.getByRole('button', { name: backupText.start, exact: true }).click();
    await expect(backupDialog.getByRole('status')).toHaveText(backupText.done(2, 401));
    expect((await stat(backup)).size).toBeGreaterThan(4 * 1024 * 1024);
    await backupDialog.getByRole('button', { name: backupText.close, exact: true }).click();
    await tool(text.title);
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await modal.getByLabel(text.connection, { exact: true }).selectOption({ label: '文件恢复目标' });
    await modal.getByLabel(text.database, { exact: true }).selectOption(target);
    const choose = () => modal.getByRole('button', { name: text.choose, exact: true }).click();
    const execute = () => modal.getByRole('button', { name: text.execute, exact: true }).click();
    const status = modal.getByRole('status');
    const exists = async (name: string) => (await observer.query('SELECT to_regclass($1) AS name', [name])).rows[0].name;
    await choose();
    expect(await exists('public.stream_parent')).toBeNull();
    await execute();
    await expect(status).toContainText(text.outcome.committed, { timeout: 25000 });
    expect((await observer.query(facts)).rows).toEqual(expected);
    expect((await observer.query('SELECT last_value::text FROM public.stream_parent_id_seq')).rows).toEqual([{ last_value: '400' }]);
    await page.screenshot({ path: info.outputPath('PostgreSQL大文件恢复.png') });

    await choose();
    await execute();
    await expect(status).toContainText(text.outcome['rolled-back']);
    await expect(status).toContainText(text.failedAt(3));
    expect(await exists('public.stream_failed')).toBeNull();
    await page.screenshot({ path: info.outputPath('PostgreSQL文件执行回滚.png') });

    await choose();
    await execute();
    await expect(status).toContainText(text.outcome['rolled-back']);
    await expect(status).toContainText('SQLSTATE 23503');
    expect(await exists('public.stream_deferred')).toBeNull();

    await choose();
    await execute();
    await expect.poll(async () => (await observer.query(`SELECT count(*)::int AS hits FROM pg_stat_activity
      WHERE datname=current_database() AND usename=current_user AND pid<>pg_backend_pid()
        AND state='active' AND query LIKE '%pg_sleep(30)%'`)).rows[0].hits).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect(status).toContainText(text.outcome['rolled-back']);
    await expect(status).toContainText(text.reason.cancelled);
    expect(await exists('public.stream_cancelled')).toBeNull();

    await choose();
    await expect(modal).toContainText('更换文件.sql');
    await writeFile(changed, 'CREATE TABLE stream_changed(id int, note text);');
    await execute();
    await expect(status).toContainText(text.outcome['not-started']);
    expect(await exists('public.stream_changed')).toBeNull();
    expect((await source.query(facts)).rows).toEqual(expected);
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    expect(JSON.stringify(tasks)).not.toMatch(/stream_missing|执行失败\.sql|服务端取消\.sql/);
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { await Promise.allSettled([source.end(), observer.end()]); }
});
