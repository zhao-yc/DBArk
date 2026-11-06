import mysql, { type RowDataPacket } from 'mysql2/promise';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { zh } from '../../src/renderer/locales/zh-CN';
import { mysqlDataCompareZh as text } from '../../src/shared/mysqlDataCompare';
import { postgresDataSyncZh as sync } from '../../src/shared/postgresDataCompare';

test.skip(process.env.DBARK_MYSQL_DATA_SYNC_NATIVE !== '1', '仅运行隔离 MySQL／MariaDB 数据同步');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('MySQL 与 MariaDB 对两端同步所选差异并确认冲突回滚', async ({}, info) => {
  const user = process.env.DBARK_COMPARE_USER ?? '', password = process.env.DBARK_COMPARE_PASSWORD ?? '';
  const mysqlPort = Number(process.env.DBARK_COMPARE_MYSQL_PORT), mariaPort = Number(process.env.DBARK_COMPARE_MARIA_PORT);
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_cmp_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) ||
      mysqlPort === mariaPort || ![mysqlPort, mariaPort].every(port => Number.isInteger(port) && port > 1024 && port <= 65535) ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key])) throw Error('只允许隔离源码和双端回环实库');
  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const database = user + '_a', mirror = user + '_b', writer = user + '_writer', max = '18446744073709551615';
  const connect = (port: number) => mysql.createConnection({ host: '127.0.0.1', port, user: writer, password });
  const left = await connect(mysqlPort), right = await connect(mariaPort);
  const values = async (connection: typeof left, db: string, table: string) => (await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(raw) AS raw,note,conflict_value FROM ' + db + '.' + table + ' ORDER BY ' + table + '.id'
  ))[0];
  try {
    for (const [dialect, port] of [['mysql', mysqlPort], ['mariadb', mariaPort]] as const) {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(dialect);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(writer);
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
    const preview = modal.getByRole('button', { name: sync.preview, exact: true });
    const apply = modal.getByRole('button', { name: sync.apply, exact: true });
    const confirm = modal.getByLabel(sync.confirm, { exact: true });
    const committed = modal.getByRole('status').filter({ hasText: '已确认整批提交' });
    const mark = async (kind: string, key: string) => {
      await modal.getByLabel(text.kind, { exact: true }).selectOption(kind);
      await modal.getByRole('checkbox', { name: sync.select + ' "' + key + '"', exact: true }).check();
    };
    const compare = async () => { await run.click(); await expect(summary).toContainText('字段值不同 27'); };
    const target = '`' + database + '`.`ledger`';
    await choose(text.source, 'mysql', database, 'ledger');
    await choose(text.target, 'mariadb', database, 'ledger');
    const original = await values(right, database, 'ledger'), mysqlOriginal = await values(left, database, 'ledger');
    await compare();
    await mark('source-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('整批已回滚：目标唯一约束冲突');
    expect(await values(right, database, 'ledger')).toEqual(original);

    await compare();
    await mark('different', max);
    await preview.click();
    await right.query('UPDATE ' + database + '.ledger SET note=\'并发改值\' WHERE id=' + max);
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('右侧原值已变化');
    expect((await values(right, database, 'ledger')).at(-1)?.note).toBe('并发改值');
    await right.query('UPDATE ' + database + ".ledger SET note='' WHERE id=" + max);

    await compare();
    await mark('source-only', '101'); await mark('target-only', '102'); await mark('different', max);
    await preview.click();
    const review = modal.getByRole('group', { name: sync.preview, exact: true });
    await expect(review.getByRole('listitem')).toHaveText(['插入　"101"', '删除　"102"', '更新　"' + max + '"']);
    await confirm.fill('`' + mirror + '`.`mirror`');
    await expect(apply).toBeDisabled();
    await confirm.fill(target);
    await expect(review).toBeInViewport({ ratio: 0.9 });
    await page.screenshot({ path: info.outputPath('MySQL与MariaDB差异同步.png') });
    await apply.click();
    await expect(committed).toBeVisible();
    const mariaAfter = await values(right, database, 'ledger');
    expect(mariaAfter).toEqual([...original.slice(0, 26), mysqlOriginal[26], mysqlOriginal[27]]);
    expect(await values(left, database, 'ledger')).toEqual(mysqlOriginal);
    await run.click();
    await expect(summary).toContainText('相同 2 · 仅左侧 0 · 仅右侧 0 · 字段值不同 26');

    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mysql', database, 'ledger');
    await compare();
    await mark('source-only', '102'); await mark('target-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(committed).toBeVisible();
    expect(await values(left, database, 'ledger')).toEqual([...mysqlOriginal.slice(0, 26), original[26], original[27]]);

    // 目标已被另一张表引用时，级联不能越过选择范围。
    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mysql', database, 'guard_parent');
    await compare();
    await mark('target-only', '101');
    await preview.click();
    await confirm.fill('`' + database + '`.`guard_parent`');
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText(/外键|依赖/);
    expect((await values(left, database, 'guard_parent')).find(row => row.id === '101')).toEqual(mysqlOriginal[26]);
    expect((await left.query<RowDataPacket[]>('SELECT CAST(id AS CHAR) AS id FROM ' + database + '.guard_child'))[0]).toEqual([{ id: '101' }]);

    // 同连接跨库复验，预览后新增的触发器必须在目标锁内拦截。
    await choose(text.source, 'mariadb', mirror, 'mirror');
    await choose(text.target, 'mariadb', database, 'ledger');
    const compareWithin = async () => { await run.click(); await expect(summary).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 1'); };
    await compareWithin();
    await mark('different', max);
    await preview.click();
    await right.query('CREATE TRIGGER ' + database + '.guard_sync BEFORE UPDATE ON ' + database + ".ledger FOR EACH ROW SET NEW.note='意外触发'");
    await confirm.fill(target);
    await apply.click();
    await expect(modal.getByRole('alert')).toContainText('触发器');
    expect(await values(right, database, 'ledger')).toEqual(mariaAfter);
    await right.query('DROP TRIGGER ' + database + '.guard_sync');

    await compareWithin();
    await expect(modal.getByText(text.shared, { exact: true })).toBeVisible();
    await mark('source-only', '102'); await mark('target-only', '101'); await mark('different', max);
    await preview.click();
    await confirm.fill(target);
    await apply.click();
    await expect(committed).toBeVisible();
    expect(await values(right, database, 'ledger')).toEqual(original);
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally { await Promise.allSettled([left.end(), right.end()]); }
});
