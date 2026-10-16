import { randomUUID } from 'node:crypto';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { test, expect, page, closed, answerDialogs, quitDesktop } from './desktop-fixture';
import { environment } from './live-helpers';
import { databaseCreateZh as text } from '../../src/renderer/locales/databaseCreate.zh-CN';

/** 首个正式定义仅准备明文8.4专用实例；不借尚未适配新表单的共享建库helper或降级TLS。 */
function target() {
  if (process.env.DBARK_TEST_HOST !== '192.168.31.200' || process.env.DBARK_TEST_PORT !== '13384' || process.env.DBARK_TEST_TLS === '1') throw Error('首个新建库UI定义仅准备ROOT明确分配的200明文13384，其他组合未准备');
  for (const key of ['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS'] as const) if (process.env[key] !== environment[key]) throw Error('新建库UI原始目标与helper配置不一致');
  if (!environment.DBARK_TEST_USER) throw Error('须ROOT提供已有测试账号，不创建用户或扩大权限');
}
/** 双门入口才注册；本片不实际启动GUI、连接200或执行DDL。 */
export function registerDatabaseCreateUiTests() {
  target(); test.use({ trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ retries: 0 });
  test('无默认库连接从真实表单选择编码，只读预览零DDL，确认后仅创建一次并刷新对象树', async () => {
    target(); const name = 'dbark_create_' + randomUUID().replaceAll('-', ''), connectionName = '新建库隔离 ' + name;
    const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: 13384, user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', connectTimeout: 15000 });
    let ownsTarget = false;
    /** 观察连接只读取本例唯一名称，不替代产品的创建命令。 */
    const actual = async () => (await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME AS name,DEFAULT_CHARACTER_SET_NAME AS charset,DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [name]))[0];
    try {
      const [version] = await observer.query<RowDataPacket[]>('SELECT @@version AS version'); expect(String(version[0].version)).toMatch(/^8\.4\.11(?:[-+].*)?$/); expect(await actual()).toHaveLength(0); ownsTarget = true;
      await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click(); const form = page.getByRole('dialog', { name: '新建连接', exact: true });
      await form.getByLabel('连接名称', { exact: true }).fill(connectionName); await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!); await form.getByLabel('端口', { exact: true }).fill('13384'); await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER!); await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
      await form.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(form.locator('.success-box')).toContainText('连接成功'); await form.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(form).toBeHidden();
      const connection = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) }); await connection.getByRole('button', { name: connectionName, exact: true }).focus(); await connection.getByRole('button', { name: '创建数据库', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await expect(dialog.getByRole('textbox', { name: text.name, exact: true })).toBeEnabled(); await dialog.getByRole('textbox', { name: text.name, exact: true }).fill(name);
      await expect(dialog.getByRole('button', { name: text.preview, exact: true })).toBeDisabled(); await dialog.getByRole('combobox', { name: text.charset, exact: true }).selectOption('utf8mb4'); await dialog.getByRole('combobox', { name: text.collation, exact: true }).selectOption('utf8mb4_bin');
      await dialog.getByRole('button', { name: text.preview, exact: true }).click(); await expect(dialog.getByRole('heading', { name: text.sql, exact: true })).toBeVisible(); await expect(dialog.locator('.monaco-editor .view-lines')).toContainText('CHARACTER SET'); expect(await actual()).toHaveLength(0);
      const submit = dialog.getByRole('button', { name: text.apply, exact: true }); await expect(submit).toBeDisabled(); await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(name + ' '); await dialog.getByRole('checkbox', { name: text.ackDdl, exact: true }).check(); await dialog.getByRole('checkbox', { name: text.ackCreate, exact: true }).check(); await expect(submit).toBeDisabled();
      await dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(name); await submit.dblclick(); await expect(dialog.getByRole('status')).toContainText(text.succeeded, { timeout: 30000 }); await expect(submit).toBeDisabled();
      expect(await actual()).toEqual([{ name, charset: 'utf8mb4', collation: 'utf8mb4_bin' }]); const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {})); expect(tasks.filter(task => task.kind === 'schema.databaseCreate.apply')).toHaveLength(1);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await connection.getByRole('button', { name: connectionName, exact: true }).click(); await expect(connection.locator('.database-row').getByRole('button', { name, exact: true })).toBeVisible();
    } finally {
      // 先关闭本例原生进程，再清理开始时不存在的唯一隔离库；任何已有数据库都不在清理范围。
      try { if (!closed) { await answerDialogs([1, 1]); await quitDesktop(); } }
      finally { try { if (ownsTarget) { if (!/^dbark_create_[a-f0-9]{32}$/.test(name)) throw Error('拒绝清理非本例名称'); await observer.query('DROP DATABASE IF EXISTS `' + name + '`'); expect(await actual()).toHaveLength(0); } } finally { await observer.end(); } }
    }
  });
}
