import mysql, { type RowDataPacket } from 'mysql2/promise';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { mysqlDataCompareZh as text } from '../../src/shared/mysqlDataCompare';

test.skip(process.env.DBARK_MYSQL_DATA_COMPARE_NATIVE !== '1', '仅运行隔离 MySQL／MariaDB 数据比较');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('MySQL 与 MariaDB 同连接及跨连接快照、精确值和服务端取消', async ({}, info) => {
  const user = process.env.DBARK_COMPARE_USER ?? '', password = process.env.DBARK_COMPARE_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_COMPARE_MYSQL_PORT), mariaPort = Number(process.env.DBARK_COMPARE_MARIA_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
      mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离源码和双端回环实库');
  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const database = user + '_a', other = user + '_b';
  const connect = (port: number, role = user) => mysql.createConnection({ host: '127.0.0.1', port, user: role, password });
  const left = await connect(mysqlPort), right = await connect(mariaPort), locker = await connect(mysqlPort, user + '_lock');
  try {
    for (const [dialect, port] of [['mysql', mysqlPort], ['mariadb', mariaPort]] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(dialect);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    }
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const side = (label: string, key: string) => modal.getByLabel(label + key, { exact: true });
    const choose = async (label: string, connection: string, db: string, table: string) => {
      await side(label, text.connection).selectOption({ label: connection });
      await side(label, text.database).selectOption(db);
      await side(label, text.table).selectOption(table);
    };
    const run = modal.getByRole('button', { name: text.run, exact: true });
    const summary = modal.getByRole('status').filter({ hasText: text.key });
    await choose(text.source, 'mysql', database, 'ledger');
    await choose(text.target, 'mysql', other, 'mirror');
    await expect(side(text.target, text.table).getByRole('option', { name: 'unavailable_view', exact: true })).toHaveCount(0);
    await expect(side(text.target, text.table).getByRole('option', { name: 'non_transactional', exact: true })).toHaveCount(0);
    await run.click();
    await expect(modal.getByText(text.shared, { exact: true })).toBeVisible();
    await expect(summary).toContainText('相同 28');

    await choose(text.source, 'mariadb', database, 'ledger');
    await choose(text.target, 'mariadb', other, 'mirror');
    await run.click();
    await expect(modal.getByText(text.shared, { exact: true })).toBeVisible();
    await expect(summary).toContainText('相同 28');

    await choose(text.source, 'mysql', database, 'ledger');
    await choose(text.target, 'mariadb', database, 'ledger');
    await run.click();
    await expect(modal.getByText(text.split, { exact: true })).toBeVisible();
    await expect(summary).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await modal.getByLabel(text.kind, { exact: true }).selectOption('different');
    await expect(modal.getByText('1 / 2', { exact: true })).toBeVisible();
    await modal.getByRole('row').filter({ hasText: '18446744073709551615' }).getByRole('button', { name: text.details, exact: true }).click();
    const detail = modal.getByRole('group', { name: text.details, exact: true });
    await expect(detail).toContainText('9007199254740993.000000000000000001');
    await expect(detail).toContainText('9007199254740993.000000000000000002');
    await expect(detail).toContainText('字节 Base64 AP+A');
    await expect(detail).toContainText('字节 Base64 AP+B');
    await expect(detail).toContainText('1.0000000000000002');
    await expect(detail).toContainText('1.0000000000000004');
    await expect(detail.getByText('moment', { exact: false })).toHaveCount(0);
    const note = detail.getByRole('row').filter({ hasText: 'note' });
    await expect(note.getByRole('cell').first()).toHaveText('NULL');
    await expect(note.getByRole('cell').last()).toHaveText('""');
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB数据比较.png') });
    await modal.getByRole('button', { name: text.next, exact: true }).click();
    await expect(modal.getByText('2 / 2', { exact: true })).toBeVisible();

    await modal.getByLabel(text.filterColumn, { exact: true }).fill('id');
    await modal.getByLabel(text.filterValue, { exact: true }).fill('18446744073709551615');
    await run.click();
    await expect(summary).toContainText('左侧行数 1 · 右侧行数 1 · 相同 0 · 仅左侧 0 · 仅右侧 0 · 字段值不同 1');
    await modal.getByLabel(text.filterValue, { exact: true }).clear();
    await choose(text.target, 'mysql', other, 'overflow_rows');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('比较超过每侧 10,000 行');
    await expect(summary).toHaveCount(0);
    await choose(text.target, 'mysql', other, 'mismatched');
    await run.click();
    await expect(modal.getByRole('alert')).toContainText('声明类型须一致');
    await expect(summary).toHaveCount(0);

    await choose(text.target, 'mysql', other, 'mirror');
    await locker.query('LOCK TABLES ' + other + '.mirror WRITE');
    const waiting = async () => (await left.query<RowDataPacket[]>('SHOW FULL PROCESSLIST'))[0].filter(row =>
      typeof row.State === 'string' && /lock/i.test(row.State) && typeof row.Info === 'string' && row.Info.includes('mirror')).length;
    await run.click();
    await expect.poll(waiting).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect.poll(waiting).toBe(0);
    await expect(modal.getByRole('alert')).toContainText(text.cancelled);
    await locker.query('UNLOCK TABLES');
    await run.click();
    await expect(summary).toContainText('相同 28');
    for (const [connection, raw] of [[left, '00FF80'], [right, '00FF81']] as const) {
      const [rows] = await connection.query<RowDataPacket[]>('SELECT HEX(raw) AS value FROM ' + database + '.ledger WHERE id=18446744073709551615');
      expect(rows[0].value).toBe(raw);
    }
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await Promise.allSettled([left.end(), right.end(), locker.end()]); }
});
