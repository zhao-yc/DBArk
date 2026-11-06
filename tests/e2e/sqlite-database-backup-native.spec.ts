import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { clickSidebarAction } from './sidebar-menu';
import { sqliteDatabaseCopyZh as text } from '../../src/shared/sqliteDatabaseBackup';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.skip(process.env.DBARK_SQLITE_DATABASE_COPY_NATIVE !== '1', '须显式启用独立 SQLite 整库备份验收');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('真实窗口备份在线 SQLite 并恢复为新连接', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '0' || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron 本地专项');
  const { page, application } = ownedDesktopResources(info);
  const directory = join(dataDir, 'sqlite-copy'), source = join(directory, '原库.sqlite'), backup = join(directory, '备份.sqlite'), restored = join(directory, '恢复.sqlite');
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('SQLite 备份专项窗口已变化'); };
  await mkdir(directory);
  const writer = new DatabaseSync(source);
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE ledger(id INTEGER PRIMARY KEY, note TEXT); INSERT INTO ledger VALUES(9223372036854775807, '备份保留记录');");
    expect(await readdir(directory)).toContain('原库.sqlite-wal');
    // 仅替换系统对话框结果。来源授权、IPC、utility 备份、发布和重新打开均使用产品入口。
    await application.evaluate(({ dialog }, files) => {
      const open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      const openPaths = [files.source, files.backup, files.restored];
      const openTitles = ['选择SQLite数据库文件', files.chooseBackup, '选择SQLite数据库文件'];
      const savePaths = [files.backup, files.restored];
      const saveTitles = [files.backupTitle, files.restoreTitle];
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (!openPaths.length || options.title !== openTitles.shift()) throw Error('意外的 SQLite 文件选择');
        const path = openPaths.shift()!;
        if (!openPaths.length) dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (!savePaths.length || options.title !== saveTitles.shift()) throw Error('意外的 SQLite 保存选择');
        const path = savePaths.shift()!;
        if (!savePaths.length) dialog.showSaveDialog = save;
        return { canceled: false, filePath: path };
      }) as typeof save;
    }, { source, backup, restored, chooseBackup: text.chooseBackup, backupTitle: text.backup, restoreTitle: text.restoreAs });

    const connect = async (name: string, path: string) => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await expect(form.locator('select')).toHaveCount(1);
      await form.locator('select').selectOption('sqlite');
      await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
      await expect(form.locator('input[readonly]')).toHaveValue(basename(path));
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
      return page.locator('.connection-node').filter({ has: page.getByRole('button', { name, exact: true }) });
    };

    const original = await connect('SQLite 在线来源', source);
    await clickSidebarAction(original, { name: text.backup, exact: true }, undefined, own);
    await expect(page.getByText(text.saved(basename(backup)), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: text.restore, exact: true }).click();
    await expect(page.getByText(text.restored(basename(restored)), { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('SQLite整库恢复.png') });
    expect((await readdir(directory)).filter(name => name.startsWith('.dbark-sqlite-copy-'))).toEqual([]);

    const recovered = await connect('SQLite 恢复库', restored);
    await recovered.getByRole('button', { name: 'SQLite 恢复库', exact: true }).click();
    await recovered.getByRole('button', { name: 'main', exact: true }).click();
    await recovered.locator('.object-row').getByRole('button', { name: 'ledger', exact: true }).dblclick();
    await expect(page.getByText('备份保留记录', { exact: true })).toBeVisible();
    const reader = new DatabaseSync(restored, { readOnly: true });
    try {
      expect(reader.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(reader.prepare('SELECT CAST(id AS TEXT) AS id, note FROM ledger').get()).toEqual({ id: '9223372036854775807', note: '备份保留记录' });
    } finally { reader.close(); }
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { writer.close(); }
});
