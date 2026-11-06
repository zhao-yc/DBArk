import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { databaseBackupArchiveZh as text } from '../../src/shared/databaseBackupArchiveFiles';
import { zh } from '../../src/renderer/locales/zh-CN';
import { makeDatabaseBackupArchive } from '../helpers/databaseBackupArchiveFixture';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_BACKUP_AUDIT_NATIVE !== '1', '仅运行隔离的双实库归档恢复目标检查');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('从已校验归档检查 MySQL 与 MariaDB 的真实目标目录', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_BACKUP_AUDIT_MYSQL_PORT), mariaPort = Number(process.env.DBARK_BACKUP_AUDIT_MARIA_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
    ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离源码和双端回环实库');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const directory = join(dataDir, 'audit-fixtures');
  await mkdir(directory);
  const specs = [
    ['mysql', user + '_used'], ['mysql', user + '_empty'], ['mysql', user + '_missing'],
    ['mariadb', user + '_empty'], ['mariadb', user + '_used']
  ] as const;
  const paths = await Promise.all(specs.map(async ([family, database], index) => {
    const path = join(directory, `测试归档-${index}.dbark-backup.zip`);
    await writeFile(path, await makeDatabaseBackupArchive(Buffer.from('CREATE TABLE should_never_exist(id INT);'), family, database));
    return path;
  }));
  const original = await readFile(paths[0]);
  try {
    for (const [name, dialect, port, account] of [
      ['MySQL 全局可见', 'mysql', mysqlPort, user], ['MySQL 库级权限', 'mysql', mysqlPort, user + '_read'],
      ['MariaDB 全局可见', 'mariadb', mariaPort, user]
    ] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(account);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    // 仅代填文件选择，归档字节检查、授权、RPC 和服务端目录读取走正式路径。
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
    const target = modal.getByRole('combobox', { name: text.target, exact: true });
    const result = modal.getByRole('region', { name: text.auditResult, exact: true });
    const audit = modal.getByRole('button', { name: text.audit, exact: true });
    const open = async () => {
      await modal.getByRole('button', { name: text.select, exact: true }).click();
      await expect(modal.getByRole('status')).toHaveText(text.checked);
      await expect(result).toHaveCount(0);
    };
    const check = async (label: string, state: string) => {
      await target.selectOption({ label });
      await audit.click();
      await expect(result).toContainText(state);
      await expect(result).toContainText(text.auditScope);
    };
    await open();
    await check('MySQL 全局可见 · MySQL', text.targetState.occupied);
    await expect(result).toContainText('MySQL 8.4.11 · ' + text.targetVersion.match);
    await expect(result).toContainText('表及其他关系 1 · 视图 1 · 过程及函数 1 · 触发器 1 · 事件 1');
    await expect(result).toContainText(/事件调度器\s+关闭/);
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('MySQL恢复目标检查.png') });

    await open();
    await check('MySQL 库级权限 · MySQL', text.targetState.unknown);
    await check('MySQL 全局可见 · MySQL', text.targetState.empty);
    await open();
    await check('MySQL 全局可见 · MySQL', text.targetState.absent);
    await check('MySQL 库级权限 · MySQL', text.targetState.unknown);

    await open();
    await check('MariaDB 全局可见 · MariaDB', text.targetState.empty);
    await expect(result).toContainText('MariaDB 11.4.13 · ' + text.targetVersion.match);
    await expect(result).toContainText(/事件调度器\s+开启/);
    await check('MySQL 全局可见 · MySQL', text.targetVersion.mismatch);

    await open();
    await check('MariaDB 全局可见 · MariaDB', text.targetState.occupied);
    await expect(result).toContainText('表及其他关系 2 · 视图 1 · 过程及函数 1 · 触发器 1 · 事件 1');
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('MariaDB恢复目标检查.png') });
    expect(await readFile(paths[0])).toEqual(original);
    await writeFile(paths[4], '归档已变化');
    await audit.click();
    await expect(modal.getByRole('alert')).toContainText(text.stale);
    await expect(result).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
