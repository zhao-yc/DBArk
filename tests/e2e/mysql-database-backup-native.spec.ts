import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { inspectDatabaseBackupArchive } from '../../src/engine/databaseBackupArchive';
import { databaseBackupArchiveZh as archiveText } from '../../src/shared/databaseBackupArchiveFiles';
import { mysqlDatabaseBackupZh as backup } from '../../src/renderer/locales/mysqlDatabaseBackup.zh-CN';
import { mysqlSqlFileZh as restore } from '../../src/renderer/locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh as receipt } from '../../src/renderer/locales/sqlFileImport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { makeDatabaseBackupArchive } from '../helpers/databaseBackupArchiveFixture';

test.skip(process.env.DBARK_MYSQL_BACKUP_NATIVE !== '1', '仅运行隔离的原生整库备份与恢复');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('从正式入口生成双方言整库 SQL 并还原', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_BACKUP_AUDIT_MYSQL_PORT), mariaPort = Number(process.env.DBARK_BACKUP_AUDIT_MARIA_PORT);
  const sshPort = Number(process.env.DBARK_MYSQL_BACKUP_SSH_PORT ?? 0);
  const sshPassword = process.env.DBARK_MYSQL_BACKUP_SSH_PASSWORD ?? '';
  const fingerprint = process.env.DBARK_MYSQL_BACKUP_SSH_FINGERPRINT ?? '';
  const caPath = process.env.DBARK_MYSQL_BACKUP_TLS_CA ?? '';
  const mysqlTool = process.env.DBARK_MYSQL_DUMP_TOOL ?? '', mariaTool = process.env.DBARK_MARIA_DUMP_TOOL ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
    sshPort && (!Number.isInteger(sshPort) || sshPort < 1025 || sshPort > 65535 ||
      !/^[a-f0-9]{64}$/.test(sshPassword) || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) ||
    caPath && (!isAbsolute(caPath) || process.env.DBARK_MYSQL_BACKUP_REQUIRE_TLS !== '1') ||
    !mysqlTool || !mariaTool || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离源码和双端回环实库');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const menu = (name: string) => navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true }, own);
  const directRestore = process.env.DBARK_MYSQL_BACKUP_ARCHIVE_DIRECT_NATIVE === '1';
  const zip = directRestore || process.env.DBARK_MYSQL_BACKUP_ARCHIVE_NATIVE === '1';
  const db = user + '_used', blocked = user + '_empty';
  const partialDb = user + '_missing', partialPath = join(dataDir, '旧版归档-部分失败.dbark-backup.zip');
  const cancelPath = join(dataDir, '旧版归档-执行取消.dbark-backup.zip');
  if (directRestore) {
    const start = 'CREATE DATABASE `' + partialDb + '`;\nUSE `' + partialDb + '`;\nCREATE TABLE ledger(id INT);\n';
    await writeFile(partialPath, await makeDatabaseBackupArchive(Buffer.from(start + 'INSERT INTO missing_table VALUES (1);\n'), 'mysql', partialDb));
    await writeFile(cancelPath, await makeDatabaseBackupArchive(Buffer.from(start + 'SELECT SLEEP(30);\nINSERT INTO ledger VALUES (1);\n'), 'mysql', partialDb));
  }
  const tls = process.env.DBARK_MYSQL_BACKUP_REQUIRE_TLS === '1'
    ? caPath ? { rejectUnauthorized: true, ca: await readFile(caPath) } : { rejectUnauthorized: false }
    : undefined;
  const targets = [
    { dialect: 'mysql', port: mysqlPort, tool: mysqlTool, path: join(dataDir, 'MySQL.sql'), label: 'MySQL 源与目标' },
    { dialect: 'mariadb', port: mariaPort, tool: mariaTool, path: join(dataDir, 'MariaDB.sql'), label: 'MariaDB 源与目标' },
  ] as const;
  const archivePath = (path: string) => path.replace(/\.sql$/, '.dbark-backup.zip');
  const destination = (path: string) => zip ? archivePath(path) : path;
  const guarded = destination(join(dataDir, '原文件.sql'));
  await writeFile(guarded, '原文件\n');
  try {
    for (const target of targets) {
      await (await menu(zh.common.newConnection)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(target.label);
      await form.getByRole('combobox').selectOption(target.dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(target.port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      if (sshPort) {
        if (!caPath) await form.getByLabel(zh.connections.text009, { exact: true }).fill(`backup-${target.dialect}.invalid`);
        await form.getByRole('button', { name: zh.connections.text005, exact: true }).click();
        await form.getByRole('checkbox', { name: zh.connections.text017, exact: true }).check();
        await form.getByLabel(zh.connections.text018, { exact: true }).fill('127.0.0.1');
        await form.getByLabel(zh.connections.text019, { exact: true }).fill(String(sshPort));
        await form.getByLabel(zh.connections.text020, { exact: true }).fill('tabrelio-test');
        await form.getByLabel(zh.connections.text021, { exact: true }).fill(sshPassword);
        await form.getByLabel(zh.connections.text025, { exact: true }).fill(fingerprint);
      }
      if (tls) {
        await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
        await form.getByRole('checkbox', { name: zh.connections.text027, exact: true }).check();
        if (caPath) await form.getByLabel(zh.connections.text029, { exact: true }).fill(caPath);
        else await form.getByRole('checkbox', { name: zh.connections.text028, exact: true }).uncheck();
      }
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    await application.evaluate(({ dialog }, { sources, destinations, tools, archives, exports, openTitle, saveTitle, scriptTitle, archiveTitle, exportTitle }) => {
      const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        const path = (title === openTitle ? tools : title === scriptTitle ? sources : title === archiveTitle ? archives : []).shift();
        if (!path) throw Error('非本例文件选择');
        if (!tools.length && !sources.length && !archives.length) dialog.showOpenDialog = originalOpen;
        return { canceled: false, filePaths: [path] };
      }) as typeof originalOpen;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.SaveDialogOptions).title;
        const path = (title === saveTitle ? destinations : title === exportTitle ? exports : []).shift();
        if (!path) throw Error('非本例备份路径');
        if (!destinations.length && !exports.length) dialog.showSaveDialog = originalSave;
        return { canceled: false, filePath: path };
      }) as typeof originalSave;
    }, {
      sources: directRestore ? [] : targets.map(item => item.path), tools: targets.map(item => item.tool),
      destinations: [destination(targets[0].path), guarded, guarded, destination(targets[1].path)],
      archives: zip ? [destination(targets[0].path), ...(directRestore ? [partialPath, cancelPath] : []), destination(targets[1].path)] : [],
      exports: zip && !directRestore ? targets.map(item => item.path) : [],
      archiveTitle: archiveText.select, exportTitle: archiveText.export,
      openTitle: backup.tool, saveTitle: backup.title, scriptTitle: restore.title,
    });
    for (const target of targets) {
      await (await menu(backup.title)).click();
      const modal = page.getByRole('dialog', { name: backup.title, exact: true });
      await modal.getByRole('combobox', { name: backup.connection }).selectOption({ label: target.label });
      const database = modal.getByRole('combobox', { name: backup.database });
      await database.selectOption(db);
      if (zip) await modal.getByRole('combobox', { name: backup.format }).selectOption('archive');
      await modal.getByRole('button', { name: backup.tool, exact: true }).click();
      const choose = modal.getByRole('button', { name: backup.choose, exact: true });
      const run = modal.getByRole('button', { name: backup.start, exact: true });
      const stage = async () => {
        await choose.click();
        await expect(run).toBeDisabled();
        await modal.getByRole('checkbox', { name: backup.confirm }).check();
        await run.click();
      };
      await stage();
      await expect(modal.getByRole('status')).toContainText(zip ? '已保存整库 ZIP 归档' : '已保存整库 SQL', { timeout: 20000 });
      const saved = await readFile(destination(target.path)), sqlChunks: Buffer[] = [];
      const checked = zip ? await inspectDatabaseBackupArchive({
        size: BigInt(saved.length),
        async read(offset, length) { return saved.subarray(Number(offset), Number(offset) + length); },
      }, undefined, { async writeBytes(bytes) { sqlChunks.push(Buffer.from(bytes)); } }) : undefined;
      const original = checked ? Buffer.concat(sqlChunks) : saved;
      if (checked) {
        expect(checked.manifest).toMatchObject({ schemaVersion: 2, family: target.dialect, database: db, resourcesConfirmed: true,
          toolExecutableSha256: createHash('sha256').update(await readFile(target.tool)).digest('hex') });
        expect(checked.manifest.objects.map(object => object.kind).sort()).toEqual(['database', 'event', 'function', 'procedure', 'table', 'table', 'trigger', 'view']);
        expect(Number(checked.dump.bytes)).toBeGreaterThan(64 * 1024);
        expect(checked.archive.sha256).toBe(createHash('sha256').update(saved).digest('hex'));
        await expect(modal.getByRole('status')).toContainText(checked.archive.sha256);
        await writeFile(info.outputPath(target.dialect + '-整库备份.zip'), saved);
      }
      expect(original.toString()).toContain('CREATE DATABASE');
      expect(original.toString()).toContain('Dump completed');
      await page.screenshot({ path: info.outputPath(target.dialect + '-整库备份.png') });
      if (target.dialect === 'mysql') {
        await database.selectOption(blocked);
        await stage();
        await expect(modal.getByRole('alert')).toContainText('非 InnoDB');
        expect(await readFile(guarded, 'utf8')).toBe('原文件\n');
        await database.selectOption(db);
        const lock = await mysql.createConnection({ host: '127.0.0.1', port: target.port, user, password, database: db, ssl: tls });
        const monitor = await mysql.createConnection({ host: '127.0.0.1', port: target.port, user, password, ssl: tls });
        const nativeSessions = async () => {
          const [rows] = await monitor.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(*) AS n FROM performance_schema.metadata_locks WHERE OBJECT_TYPE='USER LEVEL LOCK' AND OBJECT_NAME LIKE 'tabrelio-dump-%'");
          return Number(rows[0].n);
        };
        try {
          await lock.query('LOCK TABLES ledger WRITE');
          await stage();
          await expect.poll(nativeSessions, { timeout: 10000 }).toBe(1);
          await modal.getByRole('button', { name: backup.cancel, exact: true }).click();
          await expect(modal.getByRole('alert')).toContainText('整库备份已取消');
          expect(await nativeSessions()).toBe(0);
          expect(await readFile(guarded, 'utf8')).toBe('原文件\n');
        } finally {
          await monitor.end();
          await lock.end();
        }
      }
      await modal.getByRole('button', { name: backup.close, exact: true }).click();
      if (checked) {
        await (await menu(archiveText.title)).click();
        const archiveModal = page.getByRole('dialog', { name: archiveText.title, exact: true });
        await archiveModal.getByRole('button', { name: archiveText.select, exact: true }).click();
        await expect(archiveModal.getByRole('status')).toContainText(archiveText.checked);
        await expect(archiveModal.getByText(checked.dump.sha256, { exact: true })).toBeVisible();
        await expect(archiveModal.getByText(archiveText.snapshotScope, { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(target.dialect + '-归档校验.png') });
        await archiveModal.getByRole('button', { name: archiveText.inspectSql, exact: true }).click();
        await expect(archiveModal.getByRole('region', { name: archiveText.sqlInventory })).toBeVisible();
        const family = target.dialect === 'mysql' ? 'MySQL' : 'MariaDB';
        await archiveModal.getByRole('combobox', { name: archiveText.target }).selectOption({ label: target.label + ' · ' + family });
        await archiveModal.getByRole('button', { name: archiveText.audit, exact: true }).click();
        const targetAudit = archiveModal.getByRole('region', { name: archiveText.auditResult });
        await expect(targetAudit).toContainText(archiveText.targetVersion.match);
        await expect(targetAudit).toContainText(archiveText.targetState.occupied);
        if (directRestore) {
          const audit = archiveModal.getByRole('button', { name: archiveText.audit, exact: true });
          const runRestore = archiveModal.getByRole('button', { name: archiveText.restore, exact: true });
          const trust = archiveModal.getByRole('checkbox', { name: archiveText.restoreAcknowledgement });
          const result = archiveModal.getByRole('status', { name: receipt.title });
          await expect(runRestore).toBeHidden();
          const control = await mysql.createConnection({ host: '127.0.0.1', port: target.port, user, password, ssl: tls });
          try {
            await control.query('DROP DATABASE ??', [db]);
            await audit.click();
            await expect(targetAudit).toContainText(archiveText.targetState.absent);
            await expect(runRestore).toBeDisabled();
            if (target.dialect === 'mysql') {
              // 检查通过之后由另一个会话占用同名库。执行前复查必须保住新对象。
              await control.query('CREATE DATABASE ??', [db]);
              await control.query('CREATE TABLE ??.guard_marker(id INT)', [db]);
              await trust.check();
              await runRestore.click();
              await expect(archiveModal.getByRole('alert')).toContainText(archiveText.restoreRejected);
              expect((await control.query<mysql.RowDataPacket[]>('SHOW TABLES FROM ??', [db]))[0]).toEqual([{ ['Tables_in_' + db]: 'guard_marker' }]);
              await control.query('DROP TABLE ??.guard_marker', [db]);
              await audit.click();
              await expect(targetAudit).toContainText(archiveText.targetState.empty);
            }
            await trust.check();
            await page.screenshot({ path: info.outputPath(target.dialect + '-归档恢复确认.png') });
            await runRestore.click();
            await expect(result).toContainText(receipt.completed, { timeout: 20000 });
            await expect(result).toContainText(receipt.transactions.closed);
            await page.screenshot({ path: info.outputPath(target.dialect + '-归档恢复回执.png') });
            expect(await readFile(destination(target.path))).toEqual(saved);
            await expect(stat(target.path)).rejects.toHaveProperty('code', 'ENOENT');
            if (target.dialect === 'mysql') {
              await archiveModal.getByRole('button', { name: archiveText.select, exact: true }).click();
              await expect(archiveModal.getByText('旧版归档-部分失败.dbark-backup.zip', { exact: false })).toBeVisible();
              await audit.click();
              await expect(targetAudit).toContainText(archiveText.targetState.absent);
              await trust.check();
              await runRestore.click();
              await expect(result).toContainText(receipt.failed);
              await expect(result).toContainText(receipt.ordinal(4));
              await expect(result).toContainText('第 4 行');
              await page.screenshot({ path: info.outputPath('mysql-旧版归档部分失败.png') });
              expect((await control.query<mysql.RowDataPacket[]>('SHOW TABLES FROM ??', [partialDb]))[0]).toHaveLength(1);
              await control.query('DROP DATABASE ??', [partialDb]);
              await archiveModal.getByRole('button', { name: archiveText.select, exact: true }).click();
              await expect(archiveModal.getByText('旧版归档-执行取消.dbark-backup.zip', { exact: false })).toBeVisible();
              await audit.click();
              await expect(targetAudit).toContainText(archiveText.targetState.absent);
              await trust.check();
              await runRestore.click();
              const activeSleep = async () => Number((await control.query<mysql.RowDataPacket[]>(
                "SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE DB = ? AND INFO = 'SELECT SLEEP(30)'", [partialDb]))[0][0].n);
              await expect.poll(activeSleep, { timeout: 10000 }).toBe(1);
              await archiveModal.getByRole('button', { name: archiveText.cancel, exact: true }).click();
              await expect(result).toContainText(receipt.cancelled);
              expect(await activeSleep()).toBe(0);
              expect((await control.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM ??.ledger', [partialDb]))[0][0].n).toBe(0);
              await page.screenshot({ path: info.outputPath('mysql-旧版归档取消回执.png') });
              await control.query('DROP DATABASE ??', [partialDb]);
            }
          } finally { await control.end(); }
          await archiveModal.getByRole('button', { name: archiveText.close, exact: true }).click();
          continue;
        }
        await archiveModal.getByRole('button', { name: archiveText.export, exact: true }).click();
        await expect(archiveModal.getByRole('status')).toContainText(archiveText.saved(target.dialect === 'mysql' ? 'MySQL.sql' : 'MariaDB.sql'));
        expect(await readFile(target.path)).toEqual(original);
        expect(await readFile(destination(target.path))).toEqual(saved);
        await archiveModal.getByRole('button', { name: archiveText.close, exact: true }).click();
      }

      // 源库属于一次性容器。先清除夹具，再通过正式 SQL 入口验证备份可建库和回放。
      const control = await mysql.createConnection({ host: '127.0.0.1', port: target.port, user, password, ssl: tls });
      try { await control.query('DROP DATABASE ??', [db]); }
      finally { await control.end(); }
      await (await menu(restore.title)).click();
      const importModal = page.getByRole('dialog', { name: restore.title, exact: true });
      await importModal.getByRole('combobox', { name: restore.connection }).selectOption({ label: target.label });
      await importModal.getByRole('button', { name: restore.choose, exact: true }).click();
      await importModal.getByRole('checkbox', { name: restore.trust }).check();
      await importModal.getByRole('button', { name: restore.run, exact: true }).click();
      await expect(importModal.getByRole('status', { name: receipt.title })).toContainText(receipt.completed, { timeout: 20000 });
      expect(await readFile(target.path)).toEqual(original);
      await importModal.getByRole('button', { name: restore.close, exact: true }).click();
    }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
