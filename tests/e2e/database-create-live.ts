import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { test, expect, ownedDesktopResources, confirmOwnedDesktopExit, retainOwnedDesktopResources } from './desktop-fixture';
import { environment } from './live-helpers';
import { databaseCreateZh as text } from '../../src/renderer/locales/databaseCreate.zh-CN';

/** 首个正式定义仅准备明文8.4专用实例；不借尚未适配新表单的共享建库helper或降级TLS。 */
function target() {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS === '1') throw Error('首个新建库UI定义仅准备ROOT明确分配的200明文13384，其他组合未准备');
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS'] as const) if (process.env[key] !== environment[key]) throw Error('新建库UI原始目标与helper配置不一致');
  if (!environment.DBARK_TEST_USER) throw Error('须ROOT提供已有测试账号，不创建用户或扩大权限');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.DBARK_TEST_EXPECTED_SERVER_UUID ?? '')) throw Error('须ROOT先核对实际服务器UUID并显式绑定本次验收');
}
/** 双门入口才注册；本片不实际启动GUI、连接200或执行DDL。 */
export function registerDatabaseCreateUiTests() {
  target(); test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test('无默认库连接从真实表单选择编码，只读预览零DDL，确认后仅创建一次并刷新对象树', async ({}, info) => {
    target(); const name = 'dbark_create_' + randomUUID().replaceAll('-', ''), connectionName = '新建库隔离 ' + name;
    const captured = ownedDesktopResources(info);
    const assertOwner = () => { ownedDesktopResources(info); };
    const page = () => { assertOwner(); return captured.page; };
    const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: 13384, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', connectTimeout: 15000 });assertOwner();
    let ownsTarget = false, primary: { reason: unknown } | undefined;
  /** 观察请求未知或失去归属即保留；只调用一次本例observer，不借退出收尾取消它。 */
  const observe = async <T>(request: () => Promise<T>): Promise<T> => {
    assertOwner();
    try { const value = await request(); assertOwner(); return value; }
    catch (reason) { retainOwnedDesktopResources(info); throw reason; }
  };
    /** 观察连接只读取本例唯一名称，不替代产品的创建命令。 */
    const actual = async () => { assertOwner(); const [rows] = await observe(() => observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [name]));assertOwner(); return rows; };
    try {
      const [version] = await observe(() => observer.query<RowDataPacket[]>('SELECT @@version AS version,@@server_uuid AS uuid'));assertOwner(); expect(String(version[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(version[0].uuid).toBe(process.env.DBARK_TEST_EXPECTED_SERVER_UUID); expect(await actual()).toHaveLength(0);assertOwner(); ownsTarget = true;
      await page().locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();assertOwner(); const form = page().getByRole('dialog', { name: '新建连接', exact: true });
      await form.getByLabel('连接名称', { exact: true }).fill(connectionName);assertOwner(); await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);assertOwner(); await form.getByLabel('端口', { exact: true }).fill('13384');assertOwner(); await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER!);assertOwner(); await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');assertOwner();
      await form.getByRole('button', { name: '测试连接', exact: true }).click();assertOwner(); await expect(form.locator('.success-box')).toContainText('连接成功');assertOwner(); await form.getByRole('button', { name: '保存连接', exact: true }).click();assertOwner(); await expect(form).toBeHidden();assertOwner();
      const connection = page().locator('.connection-node').filter({ has: page().getByRole('button', { name: connectionName, exact: true }) }); await connection.getByRole('button', { name: connectionName, exact: true }).focus();assertOwner(); await clickSidebarAction(connection, { name: '创建数据库', exact: true }, undefined, assertOwner);assertOwner();
      const dialog = page().getByRole('dialog', { name: text.title, exact: true }); await expect(dialog.getByRole('textbox', { name: text.name, exact: true })).toBeEnabled();assertOwner(); await dialog.getByRole('textbox', { name: text.name, exact: true }).fill(name);assertOwner();
      await expect(dialog.getByRole('button', { name: text.preview, exact: true })).toBeDisabled();assertOwner(); await dialog.getByRole('combobox', { name: text.charset, exact: true }).selectOption('utf8mb4');assertOwner(); await dialog.getByRole('combobox', { name: text.collation, exact: true }).selectOption('utf8mb4_bin');assertOwner();
      await dialog.getByRole('button', { name: text.preview, exact: true }).click();assertOwner(); await expect(dialog.getByRole('heading', { name: text.sql, exact: true })).toBeVisible();assertOwner(); await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('CHARACTER SET');assertOwner(); expect(await actual()).toHaveLength(0);assertOwner();
      const submit = dialog.getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled();assertOwner(); await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(name + ' ');assertOwner(); await dialog.getByRole('checkbox', { name: text.ackDdl, exact: true }).check();assertOwner(); await dialog.getByRole('checkbox', { name: text.ackCreate, exact: true }).check();assertOwner(); await expect(submit).toBeDisabled();assertOwner();
      await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(name);assertOwner(); await submit.dblclick();assertOwner(); await expect(dialog.getByRole('status')).toContainText(text.succeeded, { timeout: 30000 });assertOwner(); await expect(submit).toBeDisabled();assertOwner();
      expect(await actual()).toEqual([{ name, charset: 'utf8mb4', collation: 'utf8mb4_bin' }]);assertOwner(); const tasks = await page().evaluate(() => window.dbark.invoke('tasks.list', {}));assertOwner(); expect(tasks.filter(task => task.kind === 'schema.databaseCreate.apply')).toHaveLength(1);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();assertOwner(); await connection.getByRole('button', { name: connectionName, exact: true }).click();assertOwner(); await expect(connection.locator('.database-row').getByRole('button', { name, exact: true })).toBeVisible();assertOwner();
    } catch (reason) { primary = { reason }; throw reason; }
    finally {
      // 退出拒绝立即停链，保留库、observer及目录；不能靠finally继续清理掩盖原始失败。
      try {
        const owner = ownedDesktopResources(info);
        if (!owner.closed) { const tasks = await owner.page.evaluate(() => window.dbark.invoke('tasks.list', {}));assertOwner(); ownedDesktopResources(info); if (tasks.some(task => task.kind === 'schema.databaseCreate.apply' && task.status !== 'completed')) throw Error('创建任务尚未确认成功，保留本例现场'); }
        await confirmOwnedDesktopExit(info);assertOwner(); ownedDesktopResources(info);
      } catch (reason) { retainOwnedDesktopResources(info); if (primary) throw new AggregateError([primary.reason, reason], '原用例失败且退出未完成，已保留隔离现场', { cause: primary.reason }); throw reason; }
      // 严格owner只证明本地退出；服务器逐ID终态仍由ROOT在实际验收中单独核对。
      try {
        assertOwner();
        if (ownsTarget) { if (!/^dbark_create_[a-f0-9]{32}$/.test(name)) throw Error('拒绝清理非本例名称'); await observe(() => observer.query('DROP DATABASE IF EXISTS `' + name + '`'));assertOwner(); expect(await actual()).toHaveLength(0);assertOwner(); }
        assertOwner(); await observer.end();assertOwner();
      } catch (reason) {
        // 归属或SQL未知即停链，不在下一段继续end；原失败仍为cause和聚合首项。
        retainOwnedDesktopResources(info);
        if (primary) throw new AggregateError([primary.reason, reason], '原用例失败且观察连接清理未确认，保留本例现场', { cause: primary.reason });
        throw reason;
      }
    }
  });
}
