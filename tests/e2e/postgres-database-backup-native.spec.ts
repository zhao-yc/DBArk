import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Client } from 'pg';
import { postgresDatabaseBackupZh as text } from '../../src/renderer/locales/postgresDatabaseBackup.zh-CN';
import { postgresSqlFileZh as restore } from '../../src/renderer/locales/postgresSqlFile.zh-CN';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_DATABASE_BACKUP_NATIVE !== '1', '只运行隔离 PostgreSQL 整库备份');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('生成原生整库备份、恢复新库，并取消等待锁的备份', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE, maintenance = process.env.DBARK_POSTGRES_COMPARE_TARGET;
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT), toolPath = process.env.DBARK_POSTGRES_DUMP_TOOL ?? '';
  const sshPort = Number(process.env.DBARK_POSTGRES_DUMP_SSH_PORT), sshPassword = process.env.DBARK_POSTGRES_DUMP_SSH_PASSWORD;
  const sshFingerprint = process.env.DBARK_POSTGRES_DUMP_SSH_FINGERPRINT;
  const caPath = process.env.DBARK_POSTGRES_DUMP_CA;
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
      database !== user || maintenance !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
      !isAbsolute(toolPath) || !/[/\\]pg_dump(?:\.exe)?$/.test(toolPath) ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL、选定的原生 pg_dump 和源码 Electron');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const freshName = user + '_backup_restore';
  const client = (db: string) => new Client({ host: '127.0.0.1', port, user, password, database: db });
  const source = client(database), lock = client(database), fresh = client(freshName);
  const backup = info.outputPath('PostgreSQL原生整库备份.sql');
  const sshBackup = info.outputPath('PostgreSQL原生SSH备份.sql');
  const cancel = info.outputPath('取消时保留原文件.sql');
  const sentinel = '原目标文件的原始字节\n';
  try {
    await source.connect(); await lock.connect();
    await writeFile(cancel, sentinel);
    const facts = 'SELECT (SELECT count(*) FROM public.native_copy) AS rows, ' +
      '(SELECT md5(string_agg(md5(ROW(id,note,raw)::text), \'\'' + ' ORDER BY id)) FROM public.native_copy) AS digest, ' +
      '(SELECT array_agg(total ORDER BY customer_id) FROM "迁移验收".summary) AS view, ' +
      'md5(lo_get(65003)) AS large_object, (SELECT last_value FROM public.native_copy_id_seq) AS sequence';
    const expected = (await source.query(facts)).rows;
    expect(expected[0]).toMatchObject({ rows: '84', sequence: '84' });

    const profiles: PostgresConnectionProfile[] = [{ id: '', name: '原生整库备份来源', group: '', color: '#607d8b',
      dialect: 'postgresql', host: '127.0.0.1', port, user, password, database, rememberPassword: false }];
    if (sshPort) {
      if (!Number.isInteger(sshPort) || sshPort < 1025 || sshPort > 65535 || !/^[a-f0-9]{64}$/.test(sshPassword ?? '') ||
          !/^SHA256:[a-zA-Z0-9+/]+$/.test(sshFingerprint ?? '')) throw Error('隔离 SSH 夹具无效');
      profiles.push({ ...profiles[0], name: '原生整库备份 SSH', ssh: {
        enabled: true, host: '127.0.0.1', port: sshPort, user: 'tabrelio-test',
        password: sshPassword, hostFingerprint: sshFingerprint,
      } });
    }
    await application.evaluate(({ dialog }, input) => {
      const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        if (title === input.toolTitle) return { canceled: false, filePaths: [input.toolPath] };
        if (title === '选择文件' && input.caPath) return { canceled: false, filePaths: [input.caPath] };
        if (title !== input.restoreTitle) throw Error('出现非本例的文件选择');
        dialog.showOpenDialog = originalOpen;
        return { canceled: false, filePaths: [input.backup] };
      }) as typeof originalOpen;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.SaveDialogOptions).title !== input.backupTitle || !input.targets.length)
          throw Error('出现非本例的保存对话框');
        const filePath = input.targets.shift()!;
        if (!input.targets.length) dialog.showSaveDialog = originalSave;
        return { canceled: false, filePath };
      }) as typeof originalSave;
    }, { toolTitle: text.tool, toolPath, restoreTitle: restore.title, backupTitle: text.title, backup, caPath,
      targets: [backup, ...(sshPort ? [sshBackup] : []), cancel] });
    if (caPath && sshPort) {
      const authorized = await page.evaluate(async () => {
        const certificate = await window.dbark.invoke('files.choose', { purpose: 'certificate' });
        if (!certificate) throw Error('证书选择未授权');
        return window.dbark.invoke('files.path', { token: certificate.token });
      });
      profiles[1].tls = { enabled: true, rejectUnauthorized: true, caPath: authorized };
    }
    await page.evaluate(async profiles => {
      for (const profile of profiles) await window.dbark.invoke('connections.save', profile);
    }, profiles);
    await page.reload();
    const menu = async (title: string) => (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: title, exact: true }, own)).click();
    await menu(text.title);
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const connection = modal.getByLabel(text.connection, { exact: true });
    const selectDatabase = async () => {
      try { await modal.getByLabel(text.database, { exact: true }).selectOption(database, { timeout: 15000 }); }
      catch (reason) { throw Error(await modal.innerText(), { cause: reason }); }
    };
    const choose = () => modal.getByRole('button', { name: text.choose, exact: true }).click();
    const start = () => modal.getByRole('button', { name: text.start, exact: true }).click();
    await connection.selectOption({ label: profiles[0].name });
    await selectDatabase();
    await modal.getByRole('checkbox', { name: text.portable, exact: true }).check();
    await modal.getByRole('button', { name: text.tool, exact: true }).click();
    await choose();
    await start();
    await expect(modal.getByRole('status')).toContainText('pg_dump 18.6', { timeout: 30000 });
    expect((await stat(backup)).size).toBeGreaterThan(5 * 1024 * 1024);
    const exported = await readFile(backup, 'utf8');
    expect(exported).toContain('REFRESH MATERIALIZED VIEW "迁移验收".summary');
    expect(exported).toContain('COPY public.native_copy');
    expect(exported).not.toMatch(/ OWNER TO /);
    expect(exported).not.toContain(password);
    await page.screenshot({ path: info.outputPath('PostgreSQL整库备份完成.png') });

    if (sshPort) {
      await connection.selectOption({ label: profiles[1].name });
      await selectDatabase();
      await choose();
      await start();
      await expect(modal.getByRole('status')).toContainText('pg_dump 18.6', { timeout: 30000 });
      expect((await stat(sshBackup)).size).toBe((await stat(backup)).size);
    }

    await connection.selectOption({ label: profiles.at(-1)!.name });
    await selectDatabase();
    await choose();
    await lock.query('BEGIN; LOCK TABLE public.native_copy IN ACCESS EXCLUSIVE MODE;');
    await start();
    await expect.poll(async () => (await source.query("SELECT count(*)::int AS waits FROM pg_stat_activity a " +
      "JOIN pg_stat_ssl s USING (pid) WHERE a.datname=current_database() AND a.application_name LIKE 'tabrelio-pg-dump-%' " +
      "AND a.wait_event_type='Lock' AND (NOT $1::boolean OR s.ssl)", [Boolean(caPath && sshPort)])).rows[0].waits).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect(modal.getByRole('button', { name: text.choose, exact: true })).toBeEnabled({ timeout: 10000 });
    expect(await readFile(cancel, 'utf8')).toBe(sentinel);
    await expect.poll(async () => (await source.query("SELECT count(*)::int AS sessions FROM pg_stat_activity " +
      "WHERE application_name LIKE 'tabrelio-pg-dump-%'")).rows[0].sessions).toBe(0);
    await lock.query('ROLLBACK');
    await modal.getByRole('button', { name: text.close, exact: true }).click();

    await menu(restore.title);
    const restored = page.getByRole('dialog', { name: restore.title, exact: true });
    await restored.getByLabel(restore.connection, { exact: true }).selectOption({ label: profiles[0].name });
    await restored.getByRole('checkbox', { name: restore.createMode, exact: true }).check();
    await restored.getByLabel(restore.maintenance, { exact: true }).selectOption(maintenance);
    await restored.getByLabel(restore.newDatabase, { exact: true }).fill(freshName);
    await restored.getByRole('button', { name: restore.choose, exact: true }).click();
    await restored.getByRole('button', { name: restore.createAndExecute, exact: true }).click();
    await expect(restored.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
    await fresh.connect();
    expect((await fresh.query(facts)).rows).toEqual(expected);
    await page.screenshot({ path: info.outputPath('PostgreSQL客户端备份恢复.png') });
    const tasks = JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})));
    expect(tasks).not.toContain(password);
    expect(tasks).not.toContain('取消时保留原文件.sql');
    expect(pageErrors).toEqual([]);
    await restored.getByRole('button', { name: restore.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally {
    await Promise.allSettled([source.end(), lock.end(), fresh.end()]);
  }
});
