import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { mysqlDatabaseBackupZh as backup } from '../../src/renderer/locales/mysqlDatabaseBackup.zh-CN';
import { mysqlSqlFileZh as restore } from '../../src/renderer/locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh as receipt } from '../../src/renderer/locales/sqlFileImport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_BACKUP_NATIVE !== '1', '仅运行隔离的原生整库备份与恢复');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('从正式入口生成双方言整库 SQL 并还原', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_BACKUP_AUDIT_MYSQL_PORT), mariaPort = Number(process.env.DBARK_BACKUP_AUDIT_MARIA_PORT);
  const mysqlTool = process.env.DBARK_MYSQL_DUMP_TOOL ?? '', mariaTool = process.env.DBARK_MARIA_DUMP_TOOL ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
    !mysqlTool || !mariaTool || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离源码和双端回环实库');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const menu = (name: string) => navigationMenuItem(page.locator('.navigation-toolbar'), { name, exact: true }, own);
  const db = user + '_used', blocked = user + '_empty';
  const tls = process.env.DBARK_MYSQL_BACKUP_REQUIRE_TLS === '1' ? { rejectUnauthorized: false } : undefined;
  const targets = [
    { dialect: 'mysql', port: mysqlPort, tool: mysqlTool, path: join(dataDir, 'MySQL.sql'), label: 'MySQL 源与目标' },
    { dialect: 'mariadb', port: mariaPort, tool: mariaTool, path: join(dataDir, 'MariaDB.sql'), label: 'MariaDB 源与目标' },
  ] as const;
  const guarded = join(dataDir, '原文件.sql');
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
      if (tls) {
        await form.getByRole('button', { name: 'TLS / SSL', exact: true }).click();
        await form.getByRole('checkbox', { name: zh.connections.text027, exact: true }).check();
        await form.getByRole('checkbox', { name: zh.connections.text028, exact: true }).uncheck();
      }
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    await application.evaluate(({ dialog }, { sources, destinations, tools, openTitle, saveTitle, scriptTitle }) => {
      const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const title = (args.at(-1) as Electron.OpenDialogOptions).title;
        const path = (title === openTitle ? tools : title === scriptTitle ? sources : []).shift();
        if (!path) throw Error('非本例文件选择');
        if (!tools.length && !sources.length) dialog.showOpenDialog = originalOpen;
        return { canceled: false, filePaths: [path] };
      }) as typeof originalOpen;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const path = destinations.shift();
        if ((args.at(-1) as Electron.SaveDialogOptions).title !== saveTitle || !path) throw Error('非本例备份路径');
        if (!destinations.length) dialog.showSaveDialog = originalSave;
        return { canceled: false, filePath: path };
      }) as typeof originalSave;
    }, {
      sources: targets.map(item => item.path), tools: targets.map(item => item.tool),
      destinations: [targets[0].path, guarded, guarded, targets[1].path],
      openTitle: backup.tool, saveTitle: backup.title, scriptTitle: restore.title,
    });
    for (const target of targets) {
      await (await menu(backup.title)).click();
      const modal = page.getByRole('dialog', { name: backup.title, exact: true });
      await modal.getByRole('combobox', { name: backup.connection }).selectOption({ label: target.label });
      const database = modal.getByRole('combobox', { name: backup.database });
      await database.selectOption(db);
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
      await expect(modal.getByRole('status')).toContainText('已保存整库 SQL', { timeout: 20000 });
      const original = await readFile(target.path);
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
