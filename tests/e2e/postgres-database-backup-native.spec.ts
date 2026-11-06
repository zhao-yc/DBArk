import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { Client } from 'pg';
import { postgresDatabaseBackupZh as text } from '../../src/renderer/locales/postgresDatabaseBackup.zh-CN';
import { postgresArchiveZh as archiveText } from '../../src/renderer/locales/postgresArchive.zh-CN';
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
  const restoreTool = process.env.DBARK_POSTGRES_RESTORE_TOOL;
  const sshPort = Number(process.env.DBARK_POSTGRES_DUMP_SSH_PORT), sshPassword = process.env.DBARK_POSTGRES_DUMP_SSH_PASSWORD;
  const sshFingerprint = process.env.DBARK_POSTGRES_DUMP_SSH_FINGERPRINT;
  const caPath = process.env.DBARK_POSTGRES_DUMP_CA;
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
      database !== user || maintenance !== user + '_target' || !Number.isInteger(port) || port < 1025 || port > 65535 ||
      !isAbsolute(toolPath) || !/[/\\]pg_dump(?:\.exe)?$/.test(toolPath) ||
      restoreTool && (!isAbsolute(restoreTool) || !/[/\\]pg_restore(?:\.exe)?$/.test(restoreTool)) ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL、选定的原生 pg_dump 和源码 Electron');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const freshName = user + '_backup_restore';
  const client = (db: string) => new Client({ host: '127.0.0.1', port, user, password, database: db });
  const source = client(database), lock = client(database), fresh = client(freshName);
  const archiveDatabase = user + '_archive_restore', archiveTarget = client(archiveDatabase);
  const directDatabase = user + '_archive_direct', directTarget = client(directDatabase);
  const partialDatabase = user + '_archive_partial', partialTarget = client(partialDatabase);
  const rejectedDatabase = user + '_archive_rejected';
  const cancelledDatabase = user + '_archive_cancelled';
  const backup = info.outputPath('PostgreSQL原生整库备份.sql');
  const sshBackup = info.outputPath('PostgreSQL原生SSH备份.sql');
  const cancel = info.outputPath('取消时保留原文件.sql');
  const custom = info.outputPath('PostgreSQL整库归档.dump'), corrupt = info.outputPath('截断归档.dump');
  const changedArchive = info.outputPath('选择后变化的归档.dump');
  const converted = info.outputPath('归档完整恢复.sql'), schema = info.outputPath('归档仅结构.sql');
  const data = info.outputPath('归档仅数据.sql'), protectedSql = info.outputPath('归档失败时保留.sql');
  const sentinel = '原目标文件的原始字节\n';
  const holdTool = restoreTool && process.platform === 'darwin' ? info.outputPath('暂停转换夹具', 'pg_restore') : undefined;
  const holdMarker = info.outputPath('转换子进程.txt');
  try {
    await source.connect(); await lock.connect();
    await writeFile(cancel, sentinel);
    if (restoreTool) {
      await writeFile(corrupt, 'PGDMP');
      await writeFile(protectedSql, sentinel);
    }
    if (holdTool && restoreTool) {
      const shellLiteral = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      await mkdir(dirname(holdTool), { recursive: true });
      await writeFile(holdTool, '#!/bin/sh\nif [ "$1" = "--version" ]; then exec ' + shellLiteral(restoreTool) +
        ' --version; fi\nprintf "%s" "$$" > ' + shellLiteral(holdMarker) + '\nexec /bin/sleep 30\n', { mode: 0o700 });
    }
    const recordFacts = 'SELECT (SELECT count(*) FROM public.native_copy) AS rows, ' +
      '(SELECT md5(string_agg(md5(ROW(id,note,raw)::text), \'\'' + ' ORDER BY id)) FROM public.native_copy) AS digest, ' +
      'md5(lo_get(65003)) AS large_object, (SELECT last_value FROM public.native_copy_id_seq) AS sequence';
    const facts = recordFacts + ', (SELECT array_agg(total ORDER BY customer_id) FROM "迁移验收".summary) AS view';
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
        if (title === input.archiveToolTitle && input.restoreTools.length)
          return { canceled: false, filePaths: [input.restoreTools.shift()!] };
        const sources = title === input.restoreTitle ? input.restoreSources : title === input.archiveOpenTitle ? input.archiveSources : [];
        if (!sources.length) throw Error('出现非本例的文件选择');
        const file = sources.shift()!;
        if (!input.restoreSources.length && !input.archiveSources.length) dialog.showOpenDialog = originalOpen;
        return { canceled: false, filePaths: [file] };
      }) as typeof originalOpen;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        const targets = title === input.backupTitle ? input.targets : title === input.archiveSaveTitle ? input.archiveTargets : [];
        if (!targets.length) throw Error('出现非本例的保存对话框');
        const filePath = targets.shift()!;
        if (!input.targets.length && !input.archiveTargets.length) dialog.showSaveDialog = originalSave;
        return { canceled: false, filePath };
      }) as typeof originalSave;
    }, { toolTitle: text.tool, toolPath, restoreTitle: restore.title, backupTitle: text.title, caPath,
      restoreTools: restoreTool ? [restoreTool, ...(holdTool ? [holdTool] : [])] : [],
      archiveToolTitle: archiveText.chooseTool, archiveOpenTitle: archiveText.chooseSource, archiveSaveTitle: archiveText.export,
      restoreSources: [backup, ...(restoreTool ? [converted] : [])],
      archiveSources: restoreTool ? [custom, corrupt, changedArchive, ...(holdTool ? [custom] : [])] : [],
      archiveTargets: restoreTool ? [schema, data, converted, protectedSql, protectedSql] : [],
      targets: [backup, ...(restoreTool ? [custom] : []), ...(sshPort ? [sshBackup] : []), cancel] });
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

    if (restoreTool) {
      await modal.getByLabel(text.format, { exact: true }).selectOption('custom');
      await choose();
      await start();
      await expect(modal.getByRole('status')).toContainText('pg_dump 18.6', { timeout: 30000 });
      const archive = await readFile(custom);
      expect(archive.subarray(0, 5).toString('ascii')).toBe('PGDMP');
      expect(archive.length).toBeLessThan((await stat(backup)).size / 4);
      await copyFile(custom, changedArchive);
      await modal.getByLabel(text.format, { exact: true }).selectOption('sql');
      await modal.getByRole('checkbox', { name: text.portable, exact: true }).check();
    }

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

    const restoreSql = async (name: string, target: Client, screenshot: string) => {
      await menu(restore.title);
      const restored = page.getByRole('dialog', { name: restore.title, exact: true });
      await restored.getByLabel(restore.connection, { exact: true }).selectOption({ label: profiles[0].name });
      await restored.getByRole('checkbox', { name: restore.createMode, exact: true }).check();
      await restored.getByLabel(restore.maintenance, { exact: true }).selectOption(maintenance);
      await restored.getByLabel(restore.newDatabase, { exact: true }).fill(name);
      await restored.getByRole('button', { name: restore.choose, exact: true }).click();
      await restored.getByRole('button', { name: restore.createAndExecute, exact: true }).click();
      await expect(restored.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
      await target.connect();
      expect((await target.query(facts)).rows).toEqual(expected);
      await page.screenshot({ path: info.outputPath(screenshot) });
      await restored.getByRole('button', { name: restore.close, exact: true }).click();
    };
    await restoreSql(freshName, fresh, 'PostgreSQL客户端备份恢复.png');
    if (restoreTool) {
      const original = await readFile(custom);
      await menu(archiveText.title);
      const archive = page.getByRole('dialog', { name: archiveText.title, exact: true });
      const openSource = () => archive.getByRole('button', { name: archiveText.chooseSource, exact: true }).click();
      const exportSql = () => archive.getByRole('button', { name: archiveText.export, exact: true }).click();
      const openDirect = async (scope: 'all' | 'schema' | 'data') => {
        await archive.getByLabel(archiveText.content, { exact: true }).selectOption(scope);
        await archive.getByRole('button', { name: archiveText.restore, exact: true }).click();
        const direct = page.getByRole('dialog', { name: restore.archiveTitle, exact: true });
        await direct.getByLabel(restore.connection, { exact: true }).selectOption({ label: profiles[0].name });
        return direct;
      };
      const confirmNew = async (direct: ReturnType<typeof page.getByRole>, name: string) => {
        await expect(direct.getByRole('checkbox', { name: restore.createMode, exact: true })).toBeChecked();
        await direct.getByLabel(restore.maintenance, { exact: true }).selectOption(maintenance);
        await direct.getByLabel(restore.newDatabase, { exact: true }).fill(name);
        await direct.getByRole('button', { name: restore.createAndExecute, exact: true }).click();
      };
      const closeDirect = async (direct: ReturnType<typeof page.getByRole>) => {
        await direct.getByRole('button', { name: restore.close, exact: true }).click();
        await expect(archive).toBeVisible();
      };
      await openSource();
      await archive.getByRole('button', { name: archiveText.chooseTool, exact: true }).click();
      await archive.getByRole('button', { name: archiveText.list, exact: true }).click();
      await expect(archive.locator('pre')).toContainText('TABLE DATA public native_copy');
      await expect(archive.locator('pre')).toContainText('MATERIALIZED VIEW DATA');
      await expect(archive).toContainText('pg_restore 18.6');
      await page.screenshot({ path: info.outputPath('PostgreSQL归档目录.png') });
      await archive.getByRole('checkbox', { name: archiveText.portable, exact: true }).check();
      for (const [selection, path, expectedSql, excluded] of [
        ['schema', schema, 'CREATE TABLE public.native_copy', 'COPY public.native_copy'],
        ['data', data, 'COPY public.native_copy', 'CREATE TABLE public.native_copy'],
        ['all', converted, 'COPY public.native_copy', ' OWNER TO '],
      ]) {
        await archive.getByLabel(archiveText.content, { exact: true }).selectOption(selection);
        await exportSql();
        await expect(archive.getByRole('status')).toContainText('已导出');
        const sql = await readFile(path, 'utf8');
        expect(sql).toContain(expectedSql);
        expect(sql).not.toContain(excluded);
      }
      const direct = await openDirect('all');
      await expect(direct).toContainText('PostgreSQL整库归档.dump');
      await confirmNew(direct, directDatabase);
      await expect(direct.getByRole('status')).toContainText(restore.outcome.committed, { timeout: 30000 });
      await expect(direct.getByRole('button', { name: restore.createAndExecute, exact: true })).toBeDisabled();
      await directTarget.connect();
      expect((await directTarget.query(facts)).rows).toEqual(expected);
      await page.screenshot({ path: info.outputPath('PostgreSQL归档直接恢复.png') });
      await closeDirect(direct);

      const structure = await openDirect('schema');
      await confirmNew(structure, partialDatabase);
      await expect(structure.getByRole('status')).toContainText(restore.outcome.committed);
      await partialTarget.connect();
      const count = async () => (await partialTarget.query('SELECT count(*)::int AS total FROM public.native_copy')).rows[0].total;
      expect(await count()).toBe(0);
      await closeDirect(structure);

      await partialTarget.query("CREATE FUNCTION public.wait_on_archive_insert() RETURNS trigger LANGUAGE plpgsql AS " +
        "$$ BEGIN PERFORM pg_sleep(30); RETURN NEW; END $$; CREATE TRIGGER wait_on_archive_insert " +
        "BEFORE INSERT ON public.native_copy FOR EACH ROW EXECUTE FUNCTION public.wait_on_archive_insert()");
      const records = await openDirect('data');
      await expect(records.getByRole('checkbox', { name: restore.createMode, exact: true })).toHaveCount(0);
      await records.getByLabel(restore.database, { exact: true }).selectOption(partialDatabase);
      const loadRecords = () => records.getByRole('button', { name: restore.archiveExecute, exact: true }).click();
      await loadRecords();
      await expect.poll(async () => (await source.query("SELECT count(*)::int AS waiting FROM pg_stat_activity " +
        "WHERE datname=$1 AND wait_event='PgSleep' AND query LIKE '%COPY public.native_copy%'", [partialDatabase])).rows[0].waiting).toBe(1);
      await records.getByRole('button', { name: restore.cancel, exact: true }).click();
      await expect(records.getByRole('status')).toContainText(restore.outcome['rolled-back']);
      await expect(records.getByRole('status')).toContainText(restore.reason.cancelled);
      expect(await count()).toBe(0);
      await partialTarget.query('DROP TRIGGER wait_on_archive_insert ON public.native_copy; DROP FUNCTION public.wait_on_archive_insert()');
      await loadRecords();
      await expect(records.getByRole('status')).toContainText(restore.outcome.committed);
      expect((await partialTarget.query(recordFacts)).rows).toEqual((await source.query(recordFacts)).rows);
      await closeDirect(records);

      await openSource();
      await exportSql();
      await expect(archive).toContainText('pg_restore 未正常完成');
      expect(await readFile(protectedSql, 'utf8')).toBe(sentinel);
      const failed = await openDirect('all');
      await confirmNew(failed, rejectedDatabase);
      await expect(failed.getByRole('status')).toContainText(restore.outcome['not-started']);
      await expect(failed.getByRole('status')).toContainText(restore.reason.archive);
      expect((await source.query('SELECT count(*)::int AS total FROM pg_database WHERE datname=$1', [rejectedDatabase])).rows[0].total).toBe(0);
      await closeDirect(failed);
      await openSource();
      await expect(archive).toContainText('选择后变化的归档.dump');
      await writeFile(changedArchive, 'PGDMP截断的内容');
      await exportSql();
      await expect(archive).toContainText('归档已变化');
      expect(await readFile(protectedSql, 'utf8')).toBe(sentinel);
      expect((await readFile(custom)).equals(original)).toBe(true);
      if (holdTool) {
        // 让准备阶段保持在可观察窗口，确认取消仅结束本任务子进程且零建库。
        await openSource();
        await archive.getByRole('button', { name: archiveText.chooseTool, exact: true }).click();
        const preparing = await openDirect('all');
        await confirmNew(preparing, cancelledDatabase);
        const pid = () => readFile(holdMarker, 'utf8').then(Number, () => 0);
        await expect.poll(pid).toBeGreaterThan(1);
        const childPid = await pid();
        await preparing.getByRole('button', { name: restore.cancel, exact: true }).click();
        await expect(preparing.getByRole('status')).toContainText(restore.outcome['not-started']);
        await expect(preparing.getByRole('status')).toContainText(restore.reason.cancelled);
        expect((await source.query('SELECT count(*)::int AS total FROM pg_database WHERE datname=$1', [cancelledDatabase])).rows[0].total).toBe(0);
        expect(() => process.kill(childPid, 0)).toThrow(/ESRCH/);
        await closeDirect(preparing);
      }
      await archive.getByRole('button', { name: archiveText.close, exact: true }).click();
      await restoreSql(archiveDatabase, archiveTarget, 'PostgreSQL归档恢复完成.png');
    }
    const tasks = JSON.stringify(await page.evaluate(() => window.dbark.invoke('tasks.list', {})));
    expect(tasks).not.toContain(password);
    expect(tasks).not.toContain('取消时保留原文件.sql');
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally {
    await Promise.allSettled([source.end(), lock.end(), fresh.end(), archiveTarget.end(), directTarget.end(), partialTarget.end()]);
  }
});
