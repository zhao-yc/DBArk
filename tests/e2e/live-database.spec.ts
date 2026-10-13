import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { Locator, TestInfo } from '@playwright/test';
import { test, expect, desktop, page, closed, pageErrors, answerDialogs, quitDesktop, launchDesktop } from './desktop-fixture';

test.use({ trace: 'off' });

// 必须由调用者显式启用；仅有本地凭据文件时仍跳过，CI 不会自动连接私有服务器。
const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1';
const environment: Record<string, string | undefined> = { ...process.env };
if (enabled && existsSync('.cache/dbark-test.env')) {
  for (const line of readFileSync('.cache/dbark-test.env', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match || environment[match[1]] !== undefined) continue;
    const value = match[2];
    environment[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
}

interface LiveContext { observer: Connection; database: string; connectionName: string; connectionId: string; }
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** 连接表单走真实 UI；测试追踪关闭，避免把临时数据库密码记录进 Playwright 参数轨迹。 */
async function connectAndCreate(database: string): Promise<Omit<LiveContext, 'observer'>> {
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
  await page.locator('.connection-row').hover();
  await page.locator('.connection-row').getByRole('button', { name: '创建数据库', exact: true }).click();
  const create = page.getByRole('dialog', { name: '创建数据库', exact: true });
  await create.getByLabel('数据库名称', { exact: true }).fill(database);
  await expect(create.locator('.monaco-editor .view-lines')).toContainText('CREATE DATABASE');
  // Electron 的 window.confirm 使用主进程同步原生框；不能用 CDP 的网页对话框接受接口。
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = args.at(-1) as Electron.MessageBoxSyncOptions;
      globalThis.__dbarkE2EDialogs.calls.push({ title: options.title, message: options.message, buttons: options.buttons, response: 0 });
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
  await create.getByRole('button', { name: '执行 SQL', exact: true }).click();
  await expect(create).toBeHidden({ timeout: 20000 });
  await page.locator('.connection-row .tree-label').click();
  await expect(page.locator('.database-row').getByRole('button', { name: database, exact: true })).toBeVisible();
  return { database, connectionName, connectionId };
}

/** 外部观察连接仅用于断言和清理，不替代被测应用的连接、查询或提交链路。 */
async function isolatedDatabase(body: (context: LiveContext) => Promise<void>, testInfo: TestInfo) {
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
async function openDatabaseQuery(database: string) {
  const row = page.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: '新建数据库查询', exact: true }).click();
  await expect(page.locator('.query-tab:visible .monaco-editor')).toBeVisible();
}

/** 使用 Monaco 的真实键盘输入，不通过内部模型或 IPC 绕过编辑器。 */
async function writeSql(source: string) {
  const input = page.locator('.query-tab:visible .monaco-editor').getByRole('textbox');
  await input.focus(); await page.keyboard.press(`${modifier}+A`); await page.keyboard.insertText(source);
}

async function executeSql(source: string) {
  await writeSql(source);
  const query = page.locator('.query-tab:visible');
  await query.getByRole('button', { name: '执行全部', exact: true }).click();
  await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
  await expect(query.locator('.error-box')).toHaveCount(0);
}

/** 文件对话框只替换路径选择，导入预览、字段映射、任务及文件 IO 均走真实主进程。 */
async function chooseTransferFile(path: string, mode: 'import' | 'export') {
  await desktop.evaluate(({ dialog }, choice) => {
    if (choice.mode === 'import') dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [choice.path] })) as typeof dialog.showOpenDialog;
    else dialog.showSaveDialog = (async () => ({ canceled: false, filePath: choice.path })) as typeof dialog.showSaveDialog;
  }, { path, mode });
}

async function transfer(table: Locator, file: string, mode: 'import' | 'export', format: 'csv' | 'json' | 'sql', rows: number, mapping?: Record<string, string>) {
  await chooseTransferFile(file, mode);
  await table.getByRole('button', { name: mode === 'import' ? '导入' : '导出', exact: true }).click();
  const modal = page.getByRole('dialog', { name: new RegExp(`^${mode === 'import' ? '导入数据' : '导出数据'} ·`) });
  // 原生 select 位于包裹式 label 内，匹配标签前缀，避免浏览器把选项文本并入标签名。
  await modal.getByRole('combobox', { name: /^文件格式/ }).selectOption(format);
  await modal.locator('.file-picker').click();
  if (mode === 'import' && format !== 'sql') {
    await expect(modal.locator('.mapping-grid')).toBeVisible();
    if (mapping) for (const [source, target] of Object.entries(mapping)) await modal.getByLabel(`映射字段 ${source}`, { exact: true }).selectOption(target);
  }
  await modal.getByRole('button', { name: mode === 'import' ? '开始导入' : '开始导出', exact: true }).click();
  await expect(modal.locator('.success-box')).toContainText(`${rows} 行`, { timeout: 20000 });
  await expect(modal.locator('.error-box')).toHaveCount(0);
  await modal.getByRole('button', { name: '完成', exact: true }).click();
  await expect(modal).toBeHidden();
}

test.describe('远程真实数据库桌面工作流', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试服务器');
  test.describe.configure({ timeout: 180000 });

  test('UI 连接建库、选中 SQL、多结果、事务、取消与重启凭据', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await writeSql("SELECT '中文🚀选中' AS selected_only;\nSELECT '不应执行' AS not_selected;");
      await page.keyboard.press(`${modifier}+Home`); await page.keyboard.press('Shift+End');
      await query.locator('.toolbar button.primary').click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
      await expect(query.locator('.result-body')).toContainText('中文🚀选中');
      await expect(query.getByRole('button', { name: '结果 2', exact: true })).toHaveCount(0);
      await executeSql('SELECT 1 AS first_result; SELECT 2 AS second_result;');
      await query.getByRole('button', { name: '结果 2', exact: true }).click();
      await expect(query.locator('.result-body')).toContainText('second_result');
      await executeSql('CREATE TABLE transaction_probe (id INT PRIMARY KEY, note VARCHAR(120)) ENGINE=InnoDB;');
      await query.getByRole('button', { name: '开始事务', exact: true }).click();
      await expect(query.locator('.tab-status')).toContainText('事务进行中');
      await executeSql("INSERT INTO transaction_probe VALUES (1,'应回滚');");
      const [beforeRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`);
      expect(Number(beforeRollback[0].total)).toBe(0);
      await query.getByRole('button', { name: '回滚', exact: true }).click();
      await expect(query.locator('.tab-status')).not.toContainText('事务进行中');
      const [afterRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`);
      expect(Number(afterRollback[0].total)).toBe(0);
      await query.getByRole('button', { name: '开始事务', exact: true }).click();
      await executeSql("INSERT INTO transaction_probe VALUES (2,'应提交');");
      await query.getByRole('button', { name: '提交', exact: true }).click();
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`); return Number(rows[0].total); }).toBe(1);
      await writeSql('SELECT SLEEP(30) AS cancelled_query;');
      await query.getByRole('button', { name: '执行全部', exact: true }).click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeEnabled();
      await query.getByRole('button', { name: '停止', exact: true }).click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 15000 });
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).some(task => task.status === 'cancelled'))).toBe(true);
      await executeSql("SELECT '取消后仍可查询' AS ready;");
      await expect(query.locator('.result-body')).toContainText('取消后仍可查询');
      await page.screenshot({ path: testInfo.outputPath('live-query.png') });
      const encryptionAvailable = await page.evaluate(async () => (await window.dbark.invoke('app.info', {})).encryptionAvailable);
      await quitDesktop(); await launchDesktop();
      const restored = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
      expect(restored[0].hasPassword).toBe(encryptionAvailable);
      await page.locator('.connection-row').hover();
      await page.getByRole('button', { name: `编辑连接 ${connectionName}`, exact: true }).click();
      const form = page.getByRole('dialog', { name: '编辑连接', exact: true });
      if (!encryptionAvailable) await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
      await form.getByRole('button', { name: '测试连接', exact: true }).click();
      await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });
      await form.getByRole('button', { name: '取消', exact: true }).click();
    }, testInfo);
  });

  test('对象树表格预览提交、复制粘贴与 CSV/JSON/SQL 文件往返', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.records (id INT PRIMARY KEY, title VARCHAR(120), note VARCHAR(120), amount DECIMAL(30,6)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO \`${database}\`.records VALUES (1,'原始一','备注一',12345678901234567890.123456),(2,'原始二',NULL,0.000001)`);
      await page.locator('.database-row').getByRole('button', { name: database, exact: true }).click();
      await page.locator('.object-row').getByRole('button', { name: 'records', exact: true }).click();
      const table = page.locator('.table-tab:visible');
      await expect(table.getByRole('gridcell', { name: '原始一', exact: true })).toBeVisible();
      await table.getByRole('gridcell', { name: '原始一', exact: true }).dblclick();
      await table.getByRole('textbox', { name: '编辑 title', exact: true }).fill('修改成功');
      await page.keyboard.press('Enter');
      const [before] = await observer.query<RowDataPacket[]>(`SELECT title FROM \`${database}\`.records WHERE id=1`);
      expect(before[0].title).toBe('原始一');
      async function commitDraft() {
        await table.getByRole('button', { name: '预览并提交', exact: true }).click();
        const preview = page.getByRole('dialog', { name: '确认数据修改', exact: true });
        await expect(preview.locator('.monaco-editor .view-lines')).toContainText('UPDATE');
        await preview.getByRole('button', { name: '确认提交', exact: true }).click();
        await expect(preview).toBeHidden({ timeout: 20000 });
        await expect(table.locator('.loading-overlay')).toHaveCount(0);
      }
      await commitDraft();
      const changed = table.getByRole('gridcell', { name: '修改成功', exact: true });
      await expect(changed).toBeVisible(); await changed.click();
      const copied = await changed.evaluate(element => {
        const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
        return Object.fromEntries(data.types.map(type => [type, data.getData(type)]));
      });
      expect(copied['text/plain']).toBe('修改成功');
      const target = table.getByRole('gridcell', { name: '原始二', exact: true });
      await target.click();
      await target.evaluate((element, content) => { const data = new DataTransfer(); for (const [type, value] of Object.entries(content)) data.setData(type, value); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); }, copied);
      await commitDraft();
      const [copiedRows] = await observer.query<RowDataPacket[]>(`SELECT title FROM \`${database}\`.records ORDER BY id`);
      expect(copiedRows.map(row => row.title)).toEqual(['修改成功', '修改成功']);
      const matrixStart = table.getByRole('gridcell', { name: '修改成功', exact: true }).first();
      await matrixStart.click();
      await matrixStart.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', '矩阵一\t新备注一\n矩阵二\t新备注二'); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
      await commitDraft();
      const [matrixRows] = await observer.query<RowDataPacket[]>(`SELECT title,note,amount FROM \`${database}\`.records ORDER BY id`);
      expect(matrixRows.map(row => [row.title, row.note])).toEqual([['矩阵一', '新备注一'], ['矩阵二', '新备注二']]);
      expect(matrixRows[0].amount).toBe('12345678901234567890.123456');
      await mkdir('.cache/e2e-files', { recursive: true });
      const folder = await mkdtemp(join(resolve('.cache/e2e-files'), 'transfer-'));
      for (const format of ['csv', 'json', 'sql'] as const) {
        const output = join(folder, `records.${format}`);
        await transfer(table, output, 'export', format, 2);
        const content = await readFile(output, 'utf8');
        expect(content).toContain('矩阵一'); expect(content).toContain('12345678901234567890.123456');
        if (format === 'json') expect(JSON.parse(content)).toHaveLength(2);
        if (format === 'sql') { expect(content).toContain('CREATE TABLE'); expect(content).toContain('INSERT INTO'); }
      }
      const csv = join(folder, 'import.csv'); const json = join(folder, 'import.json'); const sql = join(folder, 'import.sql');
      await writeFile(csv, 'source_id,source_title,source_note,source_amount\n3,CSV导入,映射成功,1.000001\n', 'utf8');
      await writeFile(json, JSON.stringify([{ id: 4, title: 'JSON导入🚀', note: null, amount: '2.000002' }]), 'utf8');
      await writeFile(sql, `INSERT INTO \`${database}\`.records VALUES (5,'SQL导入','脚本执行',3.000003);`, 'utf8');
      await transfer(table, csv, 'import', 'csv', 1, { source_id: 'id', source_title: 'title', source_note: 'note', source_amount: 'amount' });
      await transfer(table, json, 'import', 'json', 1);
      await transfer(table, sql, 'import', 'sql', 1);
      const [imported] = await observer.query<RowDataPacket[]>(`SELECT id,title,note,amount FROM \`${database}\`.records ORDER BY id`);
      expect(imported).toHaveLength(5);
      expect(imported[2].title).toBe('CSV导入'); expect(imported[3].title).toBe('JSON导入🚀'); expect(imported[3].note).toBeNull(); expect(imported[4].amount).toBe('3.000003');
      await table.getByRole('button', { name: '刷新', exact: true }).click();
      await expect(table.getByRole('gridcell', { name: 'SQL导入', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('live-table.png') });
    }, testInfo);
  });
});
