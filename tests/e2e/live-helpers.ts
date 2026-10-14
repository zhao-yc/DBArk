import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { TestInfo } from '@playwright/test';
import { expect, desktop, page, closed, pageErrors, answerDialogs, quitDesktop } from './desktop-fixture';

// 必须由调用者显式启用；仅有本地凭据文件时仍跳过，CI 不会自动连接私有服务器。
export const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
export const environment: Record<string, string | undefined> = { ...process.env };
if (enabled && existsSync('.cache/dbark-test.env')) {
  for (const line of readFileSync('.cache/dbark-test.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || environment[match[1]] !== undefined) continue;
    const value = match[2];
    environment[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}

export interface LiveContext { observer: Connection; database: string; connectionName: string; connectionId: string; }
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 浏览器确认框由 Electron 原生接口承接，同时覆盖其同步与异步调用路径。 */
export async function acceptNativeConfirmation() {
  await answerDialogs([]);
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxSyncOptions;
      globalThis.__dbarkE2EDialogs.calls.push({ title: options.title, message: options.message, buttons: options.buttons, response: 0 });
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
}

/** 连接表单走真实 UI；测试追踪关闭，避免把临时数据库密码记录进 Playwright 参数轨迹。 */
export async function connectAndCreate(database: string): Promise<Omit<LiveContext, 'observer'>> {
  const connectionName = `E2E ${database}`;
  await page.locator('.app-commandbar').getByRole('button', { name: '新建连接', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建连接', exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(connectionName);
  await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);
  await form.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '3306');
  await form.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER ?? 'root');
  await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
  await form.getByLabel('连接分组', { exact: true }).fill('隔离数据库验证');
  await form.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });
  await form.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(form).toBeHidden();
  const profiles = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
  const connectionId = profiles.find(profile => profile.name === connectionName)!.id;
  const connectionRow = page.locator('.connection-row').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
  // 使用既有键盘焦点入口显示操作区，避免窗口切换后残留鼠标位置使悬停状态失效；保持真实可见性和点击检查。
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).focus();
  const createDatabase = connectionRow.getByRole('button', { name: '创建数据库', exact: true });
  await expect(createDatabase).toBeVisible(); await createDatabase.click();
  const create = page.getByRole('dialog', { name: '创建数据库', exact: true });
  await create.getByLabel('数据库名称', { exact: true }).fill(database);
  await expect(create.locator('.monaco-editor .view-lines')).toContainText('CREATE DATABASE');
  await acceptNativeConfirmation();
  await create.getByRole('button', { name: '执行 SQL', exact: true }).click();
  await expect(create).toBeHidden({ timeout: 20000 });
  await connectionRow.getByRole('button', { name: connectionName, exact: true }).click();
  await expect(page.locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible();
  return { database, connectionName, connectionId };
}

/** 外部观察连接仅用于断言和清理，不替代被测应用的连接、查询或提交链路。 */
export async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo) {
  if (!environment.DBARK_TEST_HOST || !environment.DBARK_TEST_USER) throw new Error('启用实库 E2E 时必须提供已核对服务器的测试连接配置');
  const database = `dbark_e2e_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
  const observer = await mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT ?? 3306), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 15000 });
  try {
    const context = await connectAndCreate(database);
    await body({ observer, ...context });
    expect(pageErrors).toEqual([]);
  } catch (error) {
    if (!closed) await page.screenshot({ path: testInfo.outputPath('live-failure.png') }).catch(() => undefined);
    throw error;
  } finally {
    // 先退出应用，释放可能尚未回滚的会话，再清理本例唯一库；不触碰引擎测试库。
    try { if (!closed) { await answerDialogs([1, 1]); await quitDesktop(); } }
    finally {
      try {
        if (!/^dbark_e2e_[a-z0-9_]+$/.test(database)) throw new Error('拒绝清理非 E2E 隔离库');
        await observer.query({ sql: `DROP DATABASE IF EXISTS \`${database}\``, timeout: 15000 });
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
        expect(remaining).toHaveLength(0);
      } finally { await observer.end(); }
    }
  }
}

/** 选中数据库节点后通过对象树新建查询，确保 SQL 会话绑定正确的库。 */
export async function openDatabaseQuery(database: string) {
  const row = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  // 数据库节点沿用同一 focus-within 操作入口，不依赖鼠标在其他窗口关闭前的位置。
  await row.getByRole('button', { name: database, exact: true }).focus();
  const newQuery = row.getByRole('button', { name: '新建数据库查询', exact: true });
  await expect(newQuery).toBeVisible(); await newQuery.click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
}

/** 使用 Monaco 的真实键盘输入，不通过内部模型或 IPC 绕过编辑器。 */
export async function writeSql(source: string) {
  const input = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(source);
}

/** 执行全部 SQL 并等待任务结束，任何可见数据库错误都必须使验收失败。 */
export async function executeSql(source: string) {
  await writeSql(source);
  const query = page.locator('.query-tab:visible');
  await query.getByRole('button', { name: '执行全部', exact: true }).click();
  await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
  await expect(query.locator('.error-box')).toHaveCount(0);
}
