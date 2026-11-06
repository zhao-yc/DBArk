import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { databaseBackupArchiveZh as text } from '../../src/shared/databaseBackupArchiveFiles';
import type { DatabaseBackupKind } from '../../src/shared/databaseBackup';
import { makeDatabaseBackupArchive } from '../helpers/databaseBackupArchiveFixture';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_BACKUP_INVENTORY_NATIVE !== '1', '仅运行隔离的原生转储归档 SQL 对象验收');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('从原生 MySQL 和 MariaDB 转储核对清单及报告显式差异', async ({}, info) => {
  const database = process.env.DBARK_BACKUP_INVENTORY_DATABASE ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '0' || !/^tabrelio_inv_[a-f0-9]{12}_used$/.test(database) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离的源码 Electron 离线归档专项');
  const root = await realpath(resolve('.cache'));
  const fixtures = await realpath(process.env.DBARK_BACKUP_INVENTORY_FIXTURES ?? '');
  const child = relative(root, fixtures);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw Error('只接受仓库缓存下的隔离转储');
  const readSql = async (family: 'mysql' | 'mariadb') => {
    const path = join(fixtures, family + '.sql'), stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('原生夹具必须为小型普通文件');
    return readFile(path);
  };
  const objects: [DatabaseBackupKind, string][] = [
    ['database', database], ['table', 'ledger'], ['view', 'ledger_view'], ['trigger', 'ledger_before'],
    ['procedure', 'read_ledger'], ['event', 'ledger_event']
  ];
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const directory = join(dataDir, 'inventory-fixtures');
  await mkdir(directory);
  const [mysql, maria] = await Promise.all([readSql('mysql'), readSql('mariadb')]);
  const withDiff = Buffer.concat([mysql, Buffer.from('\nUSE explicit_other;\n')]);
  const cases = [
    { family: 'mysql', sql: mysql, items: objects },
    { family: 'mariadb', sql: maria, items: objects },
    { family: 'mysql', sql: withDiff, items: objects.filter(([kind]) => kind !== 'view').concat([['table', 'absent_table']]) },
  ] as const;
  const paths = await Promise.all(cases.map(async ({ family, sql, items }, index) => {
    const path = join(directory, `测试归档-${index}.dbark-backup.zip`);
    await writeFile(path, await makeDatabaseBackupArchive(sql, family, database, items.map(([kind, name]) => ({
      kind, name, definitionSha256: '0'.repeat(64), ...(kind === 'table' ? { engine: 'InnoDB' } : {}),
    }))));
    return path;
  }));
  const before = await Promise.all(paths.map(path => readFile(path)));
  try {
    // 仅替代系统文件选择，原生窗口、校验、重新读取、解析和渲染均使用产品入口。
    await application.evaluate(({ dialog }, { paths, title }) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== title || !paths.length) throw Error('非本例归档选择');
        const path = paths.shift()!;
        if (!paths.length) dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
    }, { paths, title: text.select });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const inspect = modal.getByRole('button', { name: text.inspectSql, exact: true });
    const result = modal.getByRole('region', { name: text.sqlInventory, exact: true });
    await expect(inspect).toBeDisabled();
    for (const family of ['MySQL', 'MariaDB']) {
      await modal.getByRole('button', { name: text.select, exact: true }).click();
      await expect(modal.getByRole('status')).toHaveText(text.checked);
      await expect(result).toHaveCount(0);
      await inspect.click();
      await expect(result).toContainText(text.sqlInventoryState.matches);
      await expect(result).toContainText('定义对象 6');
      await expect(result).toContainText('写入语句 1');
      await expect(result).toContainText('root@%');
      await expect(result).toContainText(database);
      await result.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(family + '归档SQL对象检查.png') });
    }
    await modal.getByRole('button', { name: text.select, exact: true }).click();
    await expect(modal.getByRole('status')).toHaveText(text.checked);
    await inspect.click();
    await expect(result).toContainText(text.sqlInventoryState.differs);
    await expect(result).toContainText('absent_table');
    await expect(result).toContainText('ledger_view');
    await expect(result).toContainText('explicit_other');
    expect(await Promise.all(paths.map(path => readFile(path)))).toEqual(before);
    expect(await page.evaluate(() => window.dbark.invoke('connections.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('归档SQL对象清单差异.png') });
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
