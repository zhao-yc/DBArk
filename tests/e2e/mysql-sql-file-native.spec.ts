import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { mysqlSqlFileZh as text } from '../../src/renderer/locales/mysqlSqlFile.zh-CN';
import { sqlFileImportZh as receipt } from '../../src/renderer/locales/sqlFileImport.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_SQL_NATIVE !== '1', '仅运行隔离双实库 SQL 转储恢复');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('通过工具菜单还原双方言原生整库转储并保留中断证据', async ({}, info) => {
  const user = process.env.DBARK_BACKUP_AUDIT_USER ?? '', password = process.env.DBARK_BACKUP_AUDIT_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_BACKUP_AUDIT_MYSQL_PORT), mariaPort = Number(process.env.DBARK_BACKUP_AUDIT_MARIA_PORT);
  const mysqlDump = process.env.DBARK_MYSQL_DUMP ?? '', mariaDump = process.env.DBARK_MARIA_DUMP ?? '';
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
    process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_aud_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
    mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
    !mysqlDump || !mariaDump || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离源码和双端回环实库');

  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const failure = join(dataDir, '局部失败.sql'), cancel = join(dataDir, '长任务.sql'), stale = join(dataDir, '文件替换.sql');
  await writeFile(failure, 'CREATE TABLE evidence(id INT PRIMARY KEY);\nINSERT INTO evidence VALUES (1);\nINSERT INTO evidence VALUES (1);');
  await writeFile(cancel, 'INSERT INTO evidence VALUES (2);\nUPDATE evidence SET id=10 WHERE id=1;\nINSERT INTO evidence VALUES (3);');
  await writeFile(stale, 'INSERT INTO evidence VALUES (4);');
  const paths = [mysqlDump, mariaDump, failure, cancel, stale];
  const original = await Promise.all([readFile(mysqlDump), readFile(mariaDump)]);
  const control = await mysql.createConnection({ host: '127.0.0.1', port: mysqlPort, user, password });
  try {
    for (const [name, dialect, port] of [['MySQL 转储目标', 'mysql', mysqlPort], ['MariaDB 转储目标', 'mariadb', mariaPort]] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    // 仅代填系统文件选择；连接、SQL 及取消均走正式 IPC 和实库。
    await application.evaluate(({ dialog }, { paths, title }) => {
      const open = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        if ((args.at(-1) as Electron.OpenDialogOptions).title !== title || !paths.length) throw Error('非本例 SQL 文件选择');
        const path = paths.shift()!;
        if (!paths.length) dialog.showOpenDialog = open;
        return { canceled: false, filePaths: [path] };
      }) as typeof open;
    }, { paths, title: text.title });
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const report = modal.getByRole('status', { name: receipt.title });
    const target = modal.getByRole('combobox', { name: text.connection });
    const database = modal.getByRole('combobox', { name: text.database });
    const choose = modal.getByRole('button', { name: text.choose, exact: true });
    const run = modal.getByRole('button', { name: text.run, exact: true });
    const selectFile = async () => {
      await choose.click();
      await expect(run).toBeDisabled();
      await modal.getByRole('checkbox', { name: text.trust }).check();
    };

    await target.selectOption({ label: 'MySQL 转储目标' });
    await selectFile();
    await run.click();
    await expect(report).toContainText(receipt.completed);
    await expect(report).toContainText(new RegExp(receipt.completedStatements + '：([2-9]\\d|1\\d{2,})'));
    await page.screenshot({ path: info.outputPath('MySQL整库SQL恢复.png') });

    await target.selectOption({ label: 'MariaDB 转储目标' });
    await database.selectOption(user + '_used');
    await selectFile();
    await run.click();
    await expect(report).toContainText(receipt.completed);
    await page.screenshot({ path: info.outputPath('MariaDB整库SQL恢复.png') });

    await target.selectOption({ label: 'MySQL 转储目标' });
    await database.selectOption(user + '_empty');
    await selectFile();
    await run.click();
    await expect(report).toContainText(receipt.failed);
    await expect(report).toContainText(receipt.completedStatements + '：2');
    await expect(report).toContainText(receipt.ordinal(3));
    await expect(report).toContainText(receipt.rollbackStates.confirmed);

    await control.beginTransaction();
    await control.query('SELECT id FROM ??.evidence WHERE id=1 FOR UPDATE', [user + '_empty']);
    await selectFile();
    await run.click();
    await expect.poll(async () => {
      const [rows] = await control.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE INFO='UPDATE evidence SET id=10 WHERE id=1'");
      return Number(rows[0].n);
    }).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect(report).toContainText(receipt.cancelled);
    await expect(report).toContainText(receipt.completedStatements + '：1');
    await control.rollback();

    await selectFile();
    await writeFile(stale, 'INSERT INTO evidence VALUES (9);');
    await run.click();
    await expect(report).toContainText(receipt.failed);
    await expect(report).toContainText(receipt.completedStatements + '：0');
    const [rows] = await control.query<mysql.RowDataPacket[]>('SELECT id FROM ??.evidence ORDER BY id', [user + '_empty']);
    expect(rows.map(row => row.id)).toEqual([1, 2]);
    expect(await readFile(mysqlDump)).toEqual(original[0]);
    expect(await readFile(mariaDump)).toEqual(original[1]);
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  } finally { await control.end(); }
});
