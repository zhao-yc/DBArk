import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { serverMonitorZhCN as text } from '../../src/renderer/serverMonitorZh';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_MYSQL_MONITOR_NATIVE !== '1', '只运行隔离 MySQL／MariaDB 监控专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

for (const dialect of ['mysql', 'mariadb'] as const) {
  test(`${dialect} 拒绝过期查询、保留取消后的连接并验证断开回滚`, async ({}, info) => {
    const maria = dialect === 'mariadb';
    const port = Number(process.env[maria ? 'DBARK_MYMON_MARIA_PORT' : 'DBARK_MYMON_MYSQL_PORT']);
    const user = process.env.DBARK_MYMON_USER ?? '', other = user + '_other';
    const password = process.env.DBARK_MYMON_PASSWORD, adminPassword = process.env.DBARK_MYMON_ADMIN_PASSWORD;
    if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
        process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_mon_[a-f0-9]{12}$/.test(user) ||
        ![password, adminPassword].every(value => /^[a-f0-9]{64}$/.test(value ?? '')) ||
        !Number.isInteger(port) || port < 1025 || port > 65535 ||
        ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
      throw Error('只允许隔离回环实库和源码 Electron');

    const { page } = ownedDesktopResources(info);
    const assertOwner = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
    const connections: Connection[] = [];
    const connect = async (name: string, secret: string | undefined) => {
      const result = await mysql.createConnection({ host: '127.0.0.1', port, user: name, password: secret, database: user, connectTimeout: 5000 });
      connections.push(result);
      result.on('error', () => {});
      return result;
    };
    const rows = async (connection: Connection, sql: string, args: string[] = []) => (await connection.query<RowDataPacket[]>(sql, args))[0];
    const connectionId = async (connection: Connection) => String((await rows(connection, 'SELECT CAST(CONNECTION_ID() AS CHAR) AS id'))[0].id);
    const sleepers: Promise<unknown>[] = [];
    let admin: Connection | undefined, pid: string | undefined;
    try {
      admin = await connect('root', adminPassword);
      const own = await connect(user, password), victim = await connect(other, password);
      const ownId = pid = await connectionId(own), otherId = await connectionId(victim);
      expect([ownId, otherId].every(value => /^[1-9]\d*$/.test(value))).toBe(true);
      const monitorAdmin = admin;
      const activeId = async () => (await rows(monitorAdmin, maria
        ? "SELECT CAST(QUERY_ID AS CHAR) AS id FROM information_schema.PROCESSLIST WHERE ID = ? AND COMMAND = 'Query' AND INFO LIKE 'SELECT SLEEP%'"
        : "SELECT CAST(e.EVENT_ID AS CHAR) AS id FROM performance_schema.events_statements_current e JOIN performance_schema.threads t USING (THREAD_ID) WHERE t.PROCESSLIST_ID = ? AND e.END_EVENT_ID IS NULL AND e.SQL_TEXT LIKE 'SELECT SLEEP%'", [ownId]))[0]?.id;
      const sessionCount = async (id: string) => Number((await rows(monitorAdmin, 'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ?', [id]))[0].n);
      const query = 'SELECT SLEEP(60) AS slept, 1 /* tabrelio 原查询身份 */';
      // MySQL 的无表 SLEEP 在中断时返回 1，MariaDB 在本路径返回 ER_QUERY_INTERRUPTED。
      const interrupted = maria ? 1317 : 'sleep-interrupted';
      const sleep = () => {
        const pending = own.query<RowDataPacket[]>(query).then(([result]) =>
          Number(result[0]?.slept) === 1 ? 'sleep-interrupted' : 'completed', (reason: { errno?: number }) => reason.errno);
        sleepers.push(pending);
        return pending;
      };
      const original = sleep();
      await expect.poll(activeId).toMatch(/^[1-9]\d*$/);
      const originalId = await activeId();

      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertOwner)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      const connectionName = dialect + ' 隔离监控';
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
      await form.getByRole('combobox').selectOption(dialect);
      await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(password!);
      await form.getByLabel(zh.connections.text012, { exact: true }).fill(user);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, assertOwner)).click();
      const modal = page.getByRole('dialog', { name: text.title, exact: true });
      await modal.getByRole('combobox').selectOption({ label: connectionName });
      await modal.getByRole('button', { name: text.open, exact: true }).click();
      const refresh = modal.getByRole('button', { name: text.refresh, exact: true });
      const session = (id: string) => modal.getByRole('row').filter({ has: page.getByRole('cell', { name: id, exact: true }) });
      const choose = async (id: string, action: 'cancel-query' | 'terminate-session') => {
        await session(id).getByRole('button', { name: text.signal[action], exact: true }).click();
        const confirm = modal.getByRole('region', { name: text.signal.target });
        await expect(confirm).toContainText(text.signal.connectionIdLabel + ' ' + id);
        const send = confirm.getByRole('button', { name: text.signal.confirm, exact: true });
        await expect(send).toBeDisabled();
        await confirm.getByRole('textbox', { name: text.signal.connectionId }).fill(id);
        return send;
      };
      const wait = async (message: string) => {
        await expect(modal.getByRole('status').filter({ hasText: message })).toBeVisible();
        await expect(refresh).toBeEnabled();
      };

      // 同连接重发完全相同的 SQL，旧确认仍应被原语句 ID 或事件号拦截。
      const stale = await choose(ownId, 'cancel-query');
      await admin.query('KILL QUERY ' + ownId);
      expect(await original).toBe(interrupted);
      const successor = sleep();
      await expect.poll(async () => { const id = await activeId(); return !!id && id !== originalId; }).toBe(true);
      await stale.click();
      await wait(text.signal.stale);
      expect(await activeId()).toMatch(/^[1-9]\d*$/);
      const cancel = await choose(ownId, 'cancel-query');
      await page.screenshot({ path: info.outputPath(dialect + '-确认取消.png') });
      await cancel.click();
      await wait(text.signal.noLongerVisible);
      expect(await successor).toBe(interrupted);
      expect(await connectionId(own)).toBe(ownId);

      await (await choose(otherId, 'terminate-session')).click();
      await wait(text.signal.denied);
      expect(await sessionCount(otherId)).toBe(1);
      await admin.query('GRANT ' + (maria ? 'CONNECTION ADMIN' : 'CONNECTION_ADMIN') + " ON *.* TO '" + user + "'@'%'");
      await victim.query('START TRANSACTION');
      await victim.query('INSERT INTO monitor_rollback VALUES (1)');
      await refresh.click();
      await (await choose(otherId, 'terminate-session')).click();
      await wait(text.signal.noLongerVisible);
      await expect.poll(() => sessionCount(otherId)).toBe(0);
      expect(Number((await rows(admin, 'SELECT COUNT(*) AS n FROM monitor_rollback'))[0].n)).toBe(0);
      await page.screenshot({ path: info.outputPath(dialect + '-断开回执.png') });

      // 去掉身份表权限后，MariaDB 仍可按语句 ID 操作，MySQL 继续提供只读监控。
      await admin.query("REVOKE SELECT ON performance_schema.threads FROM '" + user + "'@'%'");
      const fallback = sleep();
      await expect.poll(activeId).toMatch(/^[1-9]\d*$/);
      await refresh.click();
      await expect(refresh).toBeEnabled();
      await expect(session(ownId)).toBeVisible();
      await expect(session(ownId).getByRole('button', { name: text.signal['terminate-session'], exact: true })).toHaveCount(0);
      if (maria) {
        await (await choose(ownId, 'cancel-query')).click();
        await wait(text.signal.noLongerVisible);
      } else {
        await expect(session(ownId).getByRole('button', { name: text.signal['cancel-query'], exact: true })).toHaveCount(0);
        await admin.query('KILL QUERY ' + ownId);
      }
      expect(await fallback).toBe(interrupted);
      expect(await connectionId(own)).toBe(ownId);

      await modal.getByRole('button', { name: text.close, exact: true }).click();
      await expect(modal).toBeHidden();
      expect(Number((await rows(admin, 'SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE USER = ?', [user]))[0].n)).toBe(1);
      expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
      expect(pageErrors).toEqual([]);
      await confirmOwnedDesktopExit(info);
    } catch (reason) {
      retainOwnedDesktopResources(info);
      throw reason;
    } finally {
      if (admin && pid && /^[1-9]\d*$/.test(pid)) await admin.query('KILL QUERY ' + pid).catch(() => undefined);
      await Promise.allSettled(sleepers);
      await Promise.allSettled(connections.map(connection => connection.end()));
    }
  });
}
