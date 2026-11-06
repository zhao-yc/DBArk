import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { makeDatabaseBackupArchive } from '../helpers/databaseBackupArchiveFixture';
import { databaseBackupArchiveZh as text } from '../../src/shared/databaseBackupArchiveFiles';

test.skip(process.env.DBARK_BACKUP_ARCHIVE_NATIVE !== '1', '须显式启用离线归档专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

/** 接受本仓库缓存下的小型合成原生 dump，默认用生成的离线样本。 */
async function fixtureSql(): Promise<Buffer> {
  const value = process.env.DBARK_BACKUP_ARCHIVE_FIXTURE_SQL;
  if (!value) return Buffer.from('CREATE TABLE ledger(id BIGINT UNSIGNED, payload VARBINARY(8));\r\nINSERT INTO ledger VALUES(18446744073709551614,0x00FF80);\n');
  const path = await realpath(value), cache = await realpath(resolve('.cache')), child = relative(cache, path);
  const stat = await lstat(path);
  if (!child || child.startsWith('..') || isAbsolute(child) || !path.endsWith('.sql') || !stat.isFile() || stat.size > 2 * 1024 ** 2)
    throw Error('只接受本轮缓存内的合成 SQL 夹具');
  return readFile(path);
}

test('从离线工具菜单检查归档并导出未改写的 SQL', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '0' || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron 本地归档专项');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('归档专项窗口已变化'); };
  const directory = join(dataDir, 'archive-fixture');
  const archive = join(directory, '测试归档.dbark-backup.zip'), damaged = join(directory, '损坏归档.dbark-backup.zip'), output = join(directory, '原始.sql');
  await mkdir(directory);
  const sql = await fixtureSql(), packaged = await makeDatabaseBackupArchive(sql, 'mariadb', process.env.DBARK_BACKUP_ARCHIVE_FIXTURE_SQL ? 'tabrelio_archive_fixture' : undefined);
  const modified = Buffer.from(packaged); modified[60] ^= 1;
  await writeFile(archive, packaged); await writeFile(damaged, modified);
  try {
    // 只代填系统对话框选择。界面命令、文件授权、复核与写盘使用真实产品入口。
    await application.evaluate(({ dialog }, paths) => {
      const open = dialog.showOpenDialog, save = dialog.showSaveDialog;
      const choices = [paths.damaged, paths.archive];
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (options.title !== paths.select || !choices.length) throw Error('非本例归档选择');
        const path = choices.shift()!;
        if (!choices.length) dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.SaveDialogOptions;
        if (options.title !== paths.save) throw Error('非本例 SQL 目标');
        dialog.showSaveDialog = save;
        return { canceled: false, filePath: paths.output };
      }) as typeof save;
    }, { archive, damaged, output, select: text.select, save: text.export });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const choose = modal.getByRole('button', { name: text.select, exact: true }), save = modal.getByRole('button', { name: text.export, exact: true });
    await choose.click();
    await expect(modal.getByRole('alert')).toContainText('CRC');
    await expect(save).toBeDisabled();
    await choose.click();
    await expect(modal.getByRole('status')).toHaveText(text.checked);
    await expect(modal).toContainText('MariaDB 11.4.13');
    const sha256 = createHash('sha256').update(sql).digest('hex');
    await expect(modal.getByText(sha256, { exact: true })).toBeVisible();
    await save.click();
    await expect(modal.getByRole('status')).toHaveText(text.saved(basename(output)));
    const extracted = await readFile(output);
    expect(extracted).toEqual(sql);
    expect(await readFile(archive)).toEqual(packaged);
    expect((await readdir(directory)).sort()).toEqual([basename(archive), basename(damaged), basename(output)].sort());
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.screenshot({ path: info.outputPath('备份归档导出.png') });
    await writeFile(info.outputPath('原始回读.sql'), extracted);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
