import { Client } from 'pg';
import { serverMonitorZhCN as text } from '../../src/renderer/serverMonitorZh';
import { serverMonitorSessionsZh } from '../../src/renderer/serverMonitorSessionsZh';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_POSTGRES_MONITOR_NATIVE !== '1', '只运行隔离 PostgreSQL 监控专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 监控读取数据库统计、区分会话权限并取消原读取', async ({}, info) => {
  const user = process.env.DBARK_PGMON_USER ?? '', port = Number(process.env.DBARK_PGMON_PORT);
  const passwords = [process.env.DBARK_PGMON_PASSWORD, process.env.DBARK_PGMON_OTHER_PASSWORD, process.env.DBARK_PGMON_ADMIN_PASSWORD];
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pgmon_[a-f0-9]{12}$/.test(user) ||
      !passwords.every(value => /^[a-f0-9]{64}$/.test(value ?? '')) || !Number.isInteger(port) || port < 1025 || port > 65535 ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离回环 PostgreSQL 和源码 Electron');

  const { page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const client = (userName: string, password: string | undefined) => new Client({ host: '127.0.0.1', port, user: userName,
    password, database: user, connectionTimeoutMillis: 5000 });
  const ownQuery = client(user, passwords[0]), otherQuery = client(user + '_other', passwords[1]);
  // 会话操作用例会断开该夹具连接；实际终态由独立管理连接核对。
  otherQuery.on('error', () => {});
  const admin = client('postgres', passwords[2]), lock = client('postgres', passwords[2]);
  const connected: Client[] = [];
  let sleepers: Promise<unknown>[] = [], ownPid = 0, otherPid = 0;
  try {
    for (const connection of [admin, lock, ownQuery, otherQuery]) {
      await connection.connect(); connected.push(connection);
    }
    ownPid = (await ownQuery.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    otherPid = (await otherQuery.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const ownMarker = '监控本账号长查询', otherMarker = '其他账号受限标记';
    const ownSql = 'SELECT pg_sleep(90) /*' + ownMarker + 'A'.repeat(640) + '*/';
    sleepers = [
      ownQuery.query(ownSql).catch(() => undefined),
      otherQuery.query('SELECT pg_sleep(90) /*' + otherMarker + '*/').catch(() => undefined),
    ];
    const count = async (sql: string, params: (number | string)[] = []) => Number((await admin.query(sql, params)).rows[0].n);
    const activeSleepers = () => count("SELECT count(*) AS n FROM pg_catalog.pg_stat_activity WHERE pid IN ($1, $2) AND wait_event = 'PgSleep'", [ownPid, otherPid]);
    await expect.poll(activeSleepers).toBe(2);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const connectionName = 'PostgreSQL 监控隔离连接';
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(connectionName);
    await form.getByRole('combobox').selectOption('postgresql');
    await form.getByLabel(zh.connections.text009, { exact: true }).fill('127.0.0.1');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(passwords[0]!);
    await form.getByLabel(zh.connections.text012, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    await modal.getByRole('combobox').selectOption({ label: connectionName });
    await modal.getByRole('button', { name: text.open, exact: true }).click();
    const refresh = modal.getByRole('button', { name: text.refresh, exact: true });
    const monitorPid = modal.getByText(text.postgres.connectionId, { exact: true }).locator('..').locator('dd');
    const row = (pid: number | string) => modal.getByRole('row').filter({ has: page.getByRole('cell', { name: String(pid), exact: true }) });
    const sessionDetails = (pid: number | string) => row(pid).getByText(text.sqlDetail, { exact: true });
    await expect(modal.getByRole('heading', { name: text.postgres.status })).toBeVisible();
    await expect(modal.getByText(text.postgres.database, { exact: true }).locator('..').locator('dd')).toHaveText(user);
    await expect(modal.getByText('提交事务（xact_commit）', { exact: true }).locator('..').locator('dd')).toHaveText(/^\d+$/);
    await page.screenshot({ path: info.outputPath('PostgreSQL-数据库统计.png') });
    await expect(row(ownPid)).toContainText('Timeout: PgSleep');
    await sessionDetails(ownPid).click();
    await expect(row(ownPid).locator('pre')).toContainText(ownMarker);
    await expect(row(ownPid)).toContainText(text.sqlLimited);
    await sessionDetails(otherPid).click();
    await expect(row(otherPid).locator('pre')).toHaveText(text.null);
    await expect(row(otherPid)).not.toContainText(otherMarker);
    const firstPid = await monitorPid.innerText();
    await expect(row(firstPid)).toHaveCount(0);
    expect(await count('SELECT count(*) AS n FROM pg_catalog.pg_stat_activity WHERE pid = $1', [firstPid])).toBe(0);
    const search = modal.getByRole('searchbox', { name: serverMonitorSessionsZh.search });
    await search.fill('PgSleep');
    await expect(row(ownPid)).toBeVisible();
    await expect(row(otherPid)).toHaveCount(0);
    await modal.getByRole('button', { name: serverMonitorSessionsZh.clear, exact: true }).click();
    await page.screenshot({ path: info.outputPath('普通账号-会话监控.png') });
    await sessionDetails(ownPid).click();

    await admin.query('GRANT pg_read_all_stats TO ' + user);
    await refresh.click();
    await expect(monitorPid).not.toHaveText(firstPid);
    await expect(row(otherPid)).toContainText('Timeout: PgSleep');
    if (!await row(otherPid).locator('pre').isVisible()) await sessionDetails(otherPid).click();
    await expect(row(otherPid).locator('pre')).toContainText(otherMarker);
    await page.screenshot({ path: info.outputPath('统计权限-会话监控.png') });
    await admin.query('REVOKE pg_read_all_stats FROM ' + user);

    await admin.query('REVOKE SELECT ON pg_catalog.pg_stat_database FROM PUBLIC');
    await refresh.click();
    await expect(modal).toContainText('当前账号没有读取此项的权限');
    await expect(row(ownPid)).toBeVisible();
    await admin.query('GRANT SELECT ON pg_catalog.pg_stat_database TO PUBLIC');

    // 统计视图直接加锁会递归到系统目录。只在一次性测试库中加入独立锁门，保留视图原统计列。
    await admin.query('CREATE TABLE public.tabrelio_monitor_gate(id integer)');
    await admin.query('INSERT INTO public.tabrelio_monitor_gate VALUES (1)');
    await admin.query('GRANT SELECT ON public.tabrelio_monitor_gate TO PUBLIC');
    const originalView: string = (await admin.query(
      "SELECT pg_catalog.pg_get_viewdef('pg_catalog.pg_stat_database'::regclass) AS definition")).rows[0].definition;
    await admin.query('CREATE OR REPLACE VIEW pg_catalog.pg_stat_database AS SELECT original.* FROM (' +
      originalView.replace(/;\s*$/, '') + ') AS original CROSS JOIN public.tabrelio_monitor_gate');
    await lock.query('BEGIN');
    await lock.query('LOCK TABLE public.tabrelio_monitor_gate IN ACCESS EXCLUSIVE MODE');
    const waiting = () => count("SELECT count(*) AS n FROM pg_catalog.pg_stat_activity a JOIN pg_catalog.pg_locks l USING (pid) " +
      "WHERE a.application_name = 'tabrelio' AND a.datname = $1 AND l.relation = 'public.tabrelio_monitor_gate'::regclass AND NOT l.granted", [user]);
    await refresh.click();
    await expect.poll(waiting).toBe(1);
    await modal.getByRole('button', { name: text.cancel, exact: true }).click();
    await expect(refresh).toBeEnabled();
    await expect.poll(waiting).toBe(0);
    expect(await activeSleepers()).toBe(2);
    await page.screenshot({ path: info.outputPath('取消监控-原会话保持.png') });
    await lock.query('ROLLBACK');
    await admin.query('CREATE OR REPLACE VIEW pg_catalog.pg_stat_database AS ' + originalView);
    await admin.query('DROP TABLE public.tabrelio_monitor_gate');
    await refresh.click();
    await expect(modal.getByText('提交事务（xact_commit）', { exact: true })).toBeVisible();
    await expect(refresh).toBeEnabled();
    const lastManualPid = await monitorPid.innerText();
    const automatic = modal.getByRole('checkbox', { name: text.auto, exact: true });
    await automatic.check();
    await expect(monitorPid).not.toHaveText(lastManualPid, { timeout: 12_000 });
    await automatic.uncheck();
    await expect(refresh).toBeEnabled();
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    const monitorTasks = tasks.filter(task => task.kind === 'serverMonitor.read');
    expect(monitorTasks.map(task => task.status).sort()).toEqual(['cancelled', ...Array<string>(5).fill('completed')]);
    expect(JSON.stringify(monitorTasks)).not.toContain(ownMarker);
    expect(JSON.stringify(monitorTasks)).not.toContain(otherMarker);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);

    const chooseAction = async (pid: number, action: 'cancel-query' | 'terminate-session') => {
      await row(pid).getByRole('button', { name: text.signal[action], exact: true }).click();
      const confirm = modal.getByRole('region', { name: text.signal.target });
      await expect(confirm).toContainText('PID ' + pid);
      const send = confirm.getByRole('button', { name: text.signal.confirm, exact: true });
      await expect(send).toBeDisabled();
      await confirm.getByRole('textbox', { name: text.signal.pid }).fill(String(pid));
      return send;
    };
    const waitAction = async (message: string) => {
      await expect(modal.getByRole('status').filter({ hasText: message })).toBeVisible();
      await expect(refresh).toBeEnabled();
    };
    await expect(row(otherPid).getByRole('button', { name: text.signal['terminate-session'] })).toHaveCount(0);
    const staleCancel = await chooseAction(ownPid, 'cancel-query');
    const queryStart = async () => (await admin.query(
      "SELECT EXTRACT(EPOCH FROM query_start)::text AS started FROM pg_catalog.pg_stat_activity WHERE pid = $1 AND state = 'active'", [ownPid])).rows[0]?.started;
    const originalStart = await queryStart();
    expect(originalStart).toMatch(/^\d+\.\d+$/);
    await admin.query('SELECT pg_catalog.pg_cancel_backend($1)', [ownPid]);
    await sleepers[0];
    // 同一进程重发完全相同的 SQL；旧确认仍须由查询启动时间拦截。
    const successor = ownQuery.query(ownSql).then(() => 'completed', (reason: { code?: string }) => reason.code);
    sleepers.push(successor);
    await expect.poll(async () => { const start = await queryStart(); return typeof start === 'string' && start !== originalStart; }).toBe(true);
    await staleCancel.click();
    await waitAction(text.signal.stale);
    expect(await activeSleepers()).toBe(2);
    const liveCancel = await chooseAction(ownPid, 'cancel-query');
    await page.screenshot({ path: info.outputPath('确认取消查询.png') });
    await liveCancel.click();
    await waitAction(text.signal.ended);
    expect(await successor).toBe('57014');
    expect((await ownQuery.query('SELECT 42 AS value')).rows[0].value).toBe(42);

    await admin.query('GRANT pg_read_all_stats TO ' + user);
    await refresh.click();
    await (await chooseAction(otherPid, 'terminate-session')).click();
    await waitAction(text.signal.denied);
    expect(await activeSleepers()).toBe(1);
    await admin.query('GRANT pg_signal_backend TO ' + user);
    await admin.query('SELECT pg_catalog.pg_cancel_backend($1)', [otherPid]);
    await sleepers[1];
    await admin.query('CREATE TABLE public.monitor_terminate_evidence(id integer)');
    await admin.query('GRANT INSERT ON public.monitor_terminate_evidence TO ' + user + '_other');
    await otherQuery.query('BEGIN');
    await otherQuery.query('INSERT INTO public.monitor_terminate_evidence VALUES (1)');
    await refresh.click();
    await (await chooseAction(otherPid, 'terminate-session')).click();
    await waitAction(text.signal.ended);
    await expect.poll(() => count('SELECT count(*) AS n FROM pg_catalog.pg_stat_activity WHERE pid = $1', [otherPid])).toBe(0);
    expect(await count('SELECT count(*) AS n FROM public.monitor_terminate_evidence')).toBe(0);
    await page.screenshot({ path: info.outputPath('断开会话-服务器回执.png') });

    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await expect(modal).toBeHidden();
    expect(await count("SELECT count(*) AS n FROM pg_catalog.pg_stat_activity WHERE application_name = 'tabrelio' AND datname = $1", [user])).toBe(0);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  } finally {
    if (connected.includes(lock)) await lock.query('ROLLBACK').catch(() => undefined);
    if (ownPid && otherPid) await admin.query('SELECT pg_catalog.pg_cancel_backend(pid) FROM pg_catalog.pg_stat_activity WHERE pid IN ($1, $2)', [ownPid, otherPid]).catch(() => undefined);
    await Promise.allSettled(sleepers);
    await Promise.allSettled(connected.map(connection => connection.end()));
  }
});
