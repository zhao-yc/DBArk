import { clickSidebarAction } from './sidebar-menu';
import { discardTestTab } from './query-close-ui';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import type { Locator } from '@playwright/test';
import { test, expect, desktop, page, quitDesktop, launchDesktop } from './desktop-fixture';
import { enabled, environment, modifier, acceptNativeConfirmation, isolatedDatabase, openDatabaseQuery, writeSql, executeSql } from './live-helpers';

test.use({ trace: 'off' });

/** 打开的标签和真实会话分别保护 UI 与 IPC 保存入口，拒绝切换地址时必须保留原连接。 */
async function verifyConnectionChangeGuard(database: string, connectionName: string, connectionId: string) {
  await page.locator('.connection-row').hover();
  await clickSidebarAction(page.locator('.connection-row').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) }), { name: `编辑连接 ${connectionName}`, exact: true });
  const form = page.getByRole('dialog', { name: '编辑连接', exact: true });
  await form.getByLabel('主机地址', { exact: true }).fill('127.0.0.1');
  await form.getByLabel('端口', { exact: true }).fill('1');
  await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '保存连接', exact: true })).click();
  await expect(form.locator('.error-box')).toContainText('关闭此连接的全部标签');
  await expect(form).toBeVisible();
  await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '取消', exact: true })).click();
  const ipc = await page.evaluate(async id => {
    const before = (await window.dbark.invoke('connections.list', {})).find(profile => profile.id === id)!;
    let error = '';
    try { await window.dbark.invoke('connections.save', { ...before, host: '127.0.0.1', port: 1 }); }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    const after = (await window.dbark.invoke('connections.list', {})).find(profile => profile.id === id)!;
    return { error, unchanged: before.host === after.host && before.port === after.port && before.name === after.name };
  }, connectionId);
  expect(ipc.error).toContain('先关闭相关标签页');
  expect(ipc.unchanged).toBe(true);
  await executeSql("SELECT '配置未切换' AS ready, DATABASE() AS active_database;");
  await expect(page.locator('.query-tab:visible .result-body')).toContainText('配置未切换');
  await expect(page.locator('.query-tab:visible .result-body')).toContainText(database);

  // 纯展示字段不改变底层传输配置，仍允许在当前会话保持打开时正常保存。
  const renamed = `${connectionName} 已改名`;
  await page.locator('.connection-row').hover();
  await clickSidebarAction(page.locator('.connection-row').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) }), { name: `编辑连接 ${connectionName}`, exact: true });
  await form.getByLabel('连接名称', { exact: true }).fill(renamed);
  await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '保存连接', exact: true })).click();
  await expect(form).toBeHidden();
  await expect(page.locator('.connection-row .tree-label')).toContainText(renamed);
  await executeSql("SELECT '改名后会话仍可用' AS ready;");
  await expect(page.locator('.query-tab:visible .result-body')).toContainText('改名后会话仍可用');
  return renamed;
}

/** 已关闭连接标签后修改默认库，只清该连接树与库选择；新查询不得继承另一连接的活动库。 */
async function verifyConnectionContextInvalidation(database: string, connectionName: string, connectionId: string, encryptionAvailable: boolean) {
  const otherName = `另一连接 ${database}`;
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建连接', exact: true })).click();
  const create = page.getByRole('dialog', { name: '新建连接', exact: true });
  await create.getByLabel('连接名称', { exact: true }).fill(otherName);
  await create.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);
  await create.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '3306');
  await create.getByLabel('用户名', { exact: true }).fill(environment.DBARK_TEST_USER ?? 'root');
  await create.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
  await (await (await import('./navigation-menu')).navigationMenuItem(create, { name: '保存连接', exact: true })).click();
  await expect(create).toBeHidden();

  const originalNode = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: connectionName, exact: true }) });
  const otherNode = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: otherName, exact: true }) });
  await otherNode.locator('.connection-row .tree-label').click();
  const otherDatabase = otherNode.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await otherDatabase.hover();
  await clickSidebarAction(otherDatabase, { name: '新建数据库查询', exact: true });
  await executeSql("SELECT '另一连接保持原库' AS ready, DATABASE() AS active_database;");
  await expect(page.locator('.query-tab:visible .result-body')).toContainText(database);
  await expect(page.locator('.workspace-tab-button')).toHaveCount(2);

  // 原连接标签关闭触发真实会话释放，另一连接的当前查询与对象树继续存在。
  await acceptNativeConfirmation();
  await discardTestTab(page, page.locator('.workspace-tab-button').first().locator('.tab-close'));
  await expect(page.locator('.workspace-tab-button')).toHaveCount(1);
  await originalNode.locator('.connection-row .tree-label').click();
  const originalDatabase = originalNode.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await (await (await import('./navigation-menu')).navigationMenuItem(originalDatabase, { name: database, exact: true })).click();
  await expect(originalDatabase).toHaveClass(/active/);
  await expect(originalNode.getByRole('button', { name: 'transaction_probe', exact: true })).toBeVisible();
  await originalNode.locator('.connection-row').hover();
  await clickSidebarAction(originalNode, { name: `编辑连接 ${connectionName}`, exact: true });
  const edit = page.getByRole('dialog', { name: '编辑连接', exact: true });
  await edit.getByLabel('默认数据库（可选）', { exact: true }).fill('information_schema');
  if (!encryptionAvailable) await edit.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
  await (await (await import('./navigation-menu')).navigationMenuItem(edit, { name: '保存连接', exact: true })).click();
  await expect(edit).toBeHidden();
  await expect(originalNode.locator('.database-row')).toHaveCount(0);
  await expect(originalNode.locator('.connection-row')).toHaveClass(/active/);
  await expect(otherDatabase).toBeVisible();
  await expect(page.locator('.query-tab:visible .result-body')).toContainText('另一连接保持原库');

  // 空的默认库输入与选中的连接节点共同证明 selection.database 被清除，而非用其它标签补值。
  await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建查询', exact: true })).click();
  const query = page.getByRole('dialog', { name: '新建查询', exact: true });
  await expect(query.getByRole('combobox', { name: /^数据库连接/ })).toHaveValue(connectionId);
  await expect(query.getByLabel('默认数据库（可选）', { exact: true })).toHaveValue('');
  await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '打开查询', exact: true })).click();
  await executeSql('SELECT DATABASE() AS active_database;');
  await expect(page.locator('.query-tab:visible .result-body')).toContainText('information_schema');
  await expect(page.locator('.query-tab:visible .result-body')).not.toContainText(database);
}

/** 文件对话框只替换路径选择，导入预览、字段映射、任务及文件 IO 均走真实主进程。 */
async function chooseTransferFile(path: string, mode: 'import' | 'export') {
  await desktop.evaluate(({ dialog }, choice) => {
    if (choice.mode === 'import') dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [choice.path] })) as typeof dialog.showOpenDialog;
    else dialog.showSaveDialog = (async () => ({ canceled: false, filePath: choice.path })) as typeof dialog.showSaveDialog;
  }, { path, mode });
}

/** 文件预览完成后点击执行；失败保存脱敏任务状态帮助区分数据库错误与交互未触发。 */
async function transfer(table: Locator, file: string, mode: 'import' | 'export', format: 'csv' | 'json' | 'sql', rows: number, mapping?: Record<string, string>) {
  await chooseTransferFile(file, mode);
  await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: mode === 'import' ? '导入' : '导出', exact: true })).click();
  const modal = page.getByRole('dialog', { name: new RegExp(`^${mode === 'import' ? '导入数据' : '导出数据'} ·`) });
  // 原生 select 位于包裹式 label 内，匹配标签前缀，避免浏览器把选项文本并入标签名。
  await modal.getByRole('combobox', { name: /^文件格式/ }).selectOption(format);
  await modal.locator('.file-picker').click();
  if (mode === 'import' && format !== 'sql') {
    await expect(modal.locator('.mapping-grid')).toBeVisible();
    await expect(modal.locator('.spinner')).toHaveCount(0);
    if (mapping) for (const [source, target] of Object.entries(mapping)) await modal.getByLabel(`映射字段 ${source}`, { exact: true }).selectOption(target);
    else {
      // JSON 的同名映射必须等元数据加载后真实就绪，不能只凭预览表格出现就开始写入。
      for (const field of ['id', 'title', 'note', 'amount']) await expect(modal.getByLabel(`映射字段 ${field}`, { exact: true })).toHaveValue(field);
    }
    if (format === 'json') {
      // 把真实 UTF-8 文件切成不匹配编码，旧映射必须失效且无法执行；恢复后只点击一次导入。
      const previousTasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).length);
      await modal.getByRole('combobox', { name: /^文件编码/ }).selectOption('utf16le');
      await expect(modal.locator('.error-box')).toBeVisible();
      await expect(modal.locator('.mapping-grid')).toHaveCount(0);
      await expect(modal.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled();
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).length)).toBe(previousTasks);
      await modal.getByRole('combobox', { name: /^文件编码/ }).selectOption('utf8');
      await expect(modal.locator('.mapping-grid')).toBeVisible();
      await expect(modal.locator('.spinner')).toHaveCount(0);
      await expect(modal.locator('.error-box')).toHaveCount(0);
      for (const field of ['id', 'title', 'note', 'amount']) await expect(modal.getByLabel(`映射字段 ${field}`, { exact: true })).toHaveValue(field);
    }
  }
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: mode === 'import' ? '开始导入' : '开始导出', exact: true })).click();
  try { await expect(modal.locator('.success-box')).toContainText(`${rows} 行`, { timeout: 20000 }); }
  catch (reason) {
    const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
    await writeFile('.cache/e2e-transfer-failure.json', JSON.stringify({ mode, format, tasks }, null, 2));
    throw reason;
  }
  await expect(modal.locator('.error-box')).toHaveCount(0);
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '完成', exact: true })).click();
  await expect(modal).toBeHidden();
}

test.describe('远程真实数据库桌面工作流', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试服务器');
  test.describe.configure({ timeout: 180000 });

  test('UI 连接建库、选中 SQL、多结果、事务、取消与重启凭据', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName, connectionId }) => {
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await writeSql("SELECT '中文🚀选中' AS selected_only;\nSELECT '不应执行' AS not_selected;");
      await page.keyboard.press(`${modifier}+Home`); await page.keyboard.press('Shift+End');
      await query.locator('.toolbar button.primary').click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
      await expect(query.locator('.result-body')).toContainText('中文🚀选中');
      await expect(query.getByRole('button', { name: '结果 2', exact: true })).toHaveCount(0);
      await executeSql('SELECT 1 AS first_result; SELECT 2 AS second_result;');
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '结果 2', exact: true })).click();
      await expect(query.locator('.result-body')).toContainText('second_result');
      // 固定快照保留精度、二进制与 NULL；新查询不得替换旧值，释放后回到本次结果。
      await executeSql("SELECT CAST(9223372036854775807 AS SIGNED) AS exact_bigint, CAST(12345678901234567890.123456 AS DECIMAL(30,6)) AS exact_decimal, NULL AS missing_value, X'00ff' AS binary_value, '固定中文🚀' AS text_value;");
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '固定结果', exact: true })).click();
      await executeSql("SELECT '新查询结果' AS latest;");
      await expect(query.locator('.result-body')).toContainText('新查询结果');
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '固定 1', exact: true })).click();
      await expect(query.getByRole('button', { name: '固定 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
      for (const value of ['9223372036854775807', '12345678901234567890.123456', 'NULL', '0x00ff', '固定中文🚀']) await expect(query.getByRole('gridcell', { name: value, exact: true })).toBeVisible();
      await expect(query.locator('.result-body')).not.toContainText('新查询结果');
      await page.screenshot({ path: testInfo.outputPath('live-pinned-result.png') });
      // 只读快照弹窗获得焦点时，快捷键不得穿透到后台正在编辑的写 SQL。
      await observer.query('CREATE TABLE ' + database + '.snapshot_shortcut_probe (id INT AUTO_INCREMENT PRIMARY KEY)');
      await writeSql('INSERT INTO snapshot_shortcut_probe VALUES (NULL);');
      const tasksBeforeSnapshot = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).length);
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '快照 SQL', exact: true })).click();
      const snapshotSql = page.getByRole('dialog', { name: '固定结果的原 SQL', exact: true });
      await expect(snapshotSql.locator('.monaco-editor .view-lines')).toContainText('固定中文🚀');
      await expect(snapshotSql.locator('.monaco-editor .view-lines')).not.toContainText('新查询结果');
      await snapshotSql.locator('.monaco-editor').getByRole('textbox').focus();
      await page.keyboard.press(`${modifier}+Enter`);
      // 同时给 Electron 菜单快捷键和 Monaco 命令分发留出实际处理时间，再核对数据库与任务均未变化。
      await page.waitForTimeout(350);
      const [snapshotWrites] = await observer.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM ' + database + '.snapshot_shortcut_probe');
      expect(Number(snapshotWrites[0].total)).toBe(0);
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).length)).toBe(tasksBeforeSnapshot);
      await (await (await import('./navigation-menu')).navigationMenuItem(snapshotSql, { name: '关闭', exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '释放 固定 1', exact: true })).click();
      await expect(query.locator('.pinned-results')).toHaveCount(0);
      await expect(query.locator('.result-body')).toContainText('新查询结果');
      const renamedConnection = await verifyConnectionChangeGuard(database, connectionName, connectionId);
      await executeSql('CREATE TABLE transaction_probe (id INT PRIMARY KEY, note VARCHAR(120)) ENGINE=InnoDB; CREATE TABLE shortcut_probe (id INT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(120)) ENGINE=InnoDB;');
      // 同时经过 Monaco 与 Electron 快捷键入口时，只能提交一次写操作；观察连接核对真实行数。
      await writeSql("INSERT INTO shortcut_probe (note) VALUES ('快捷键只写入一次');");
      await page.keyboard.press(`${modifier}+Enter`);
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.shortcut_probe`); return Number(rows[0].total); }).toBe(1);
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled();
      await expect(query.locator('.error-box')).toHaveCount(0);
      const [shortcutRows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.shortcut_probe`);
      expect(Number(shortcutRows[0].total)).toBe(1);
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '开始事务', exact: true })).click();
      await expect(query.locator('.tab-status')).toContainText('事务进行中');
      await executeSql("INSERT INTO transaction_probe VALUES (1,'应回滚');");
      const [beforeRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`);
      expect(Number(beforeRollback[0].total)).toBe(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '回滚', exact: true })).click();
      await expect(query.locator('.tab-status')).not.toContainText('事务进行中');
      const [afterRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`);
      expect(Number(afterRollback[0].total)).toBe(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '开始事务', exact: true })).click();
      await executeSql("INSERT INTO transaction_probe VALUES (2,'应提交');");
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '提交', exact: true })).click();
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.transaction_probe`); return Number(rows[0].total); }).toBe(1);
      await executeSql("SELECT '取消后仍保留的快照' AS preserved;");
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '固定结果', exact: true })).click();
      await writeSql('SELECT 1 AS partial_result; SELECT SLEEP(30) AS cancelled_query;');
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '执行全部', exact: true })).click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeEnabled();
      await expect(query.locator('.result-body')).toContainText('partial_result');
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '停止', exact: true })).click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 15000 });
      await expect.poll(() => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).some(task => task.status === 'cancelled'))).toBe(true);
      await expect(query.getByRole('button', { name: '固定结果', exact: true })).toBeDisabled();
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '固定 2', exact: true })).click();
      await expect(query.locator('.result-body')).toContainText('取消后仍保留的快照');
      await (await (await import('./navigation-menu')).navigationMenuItem(query, { name: '释放 固定 2', exact: true })).click();
      await executeSql("SELECT '取消后仍可查询' AS ready;");
      await expect(query.locator('.result-body')).toContainText('取消后仍可查询');
      await page.screenshot({ path: testInfo.outputPath('live-query.png') });
      const encryptionAvailable = await page.evaluate(async () => (await window.dbark.invoke('app.info', {})).encryptionAvailable);
      await quitDesktop(); await launchDesktop();
      const restored = await page.evaluate(() => window.dbark.invoke('connections.list', {}));
      expect(restored[0].hasPassword).toBe(encryptionAvailable);
      await page.locator('.connection-row').hover();
      await clickSidebarAction(page.locator('.connection-row').filter({ has: page.getByRole('button', { name: renamedConnection, exact: true }) }), { name: `编辑连接 ${renamedConnection}`, exact: true });
      const form = page.getByRole('dialog', { name: '编辑连接', exact: true });
      if (!encryptionAvailable) await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
      await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '测试连接', exact: true })).click();
      await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });
      await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '取消', exact: true })).click();
      await verifyConnectionContextInvalidation(database, renamedConnection, connectionId, encryptionAvailable);
      await page.screenshot({ path: testInfo.outputPath('live-connection-context.png') });
    }, testInfo);
  });

  test('对象树表格预览提交、复制粘贴与 CSV/JSON/SQL 文件往返', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.records (id INT PRIMARY KEY, title VARCHAR(120), note VARCHAR(120), amount DECIMAL(30,6)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO \`${database}\`.records VALUES (1,'原始一','备注一',12345678901234567890.123456),(2,'原始二',NULL,0.000001)`);
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.database-row'), { name: database, exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.object-row'), { name: 'records', exact: true })).click();
      const table = page.locator('.table-tab:visible');
      await expect(table.getByRole('gridcell', { name: '原始一', exact: true })).toBeVisible();
      await table.getByRole('gridcell', { name: '原始一', exact: true }).dblclick();
      await table.getByRole('textbox', { name: '编辑 title', exact: true }).fill('修改成功');
      await page.keyboard.press('Enter');
      const [before] = await observer.query<RowDataPacket[]>(`SELECT title FROM \`${database}\`.records WHERE id=1`);
      expect(before[0].title).toBe('原始一');
      async function commitDraft() {
        await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: '预览并提交', exact: true })).click();
        const preview = page.getByRole('dialog', { name: '确认数据修改', exact: true });
        await expect(preview.locator('.monaco-editor .view-lines')).toContainText('UPDATE');
        await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '确认提交', exact: true })).click();
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
        if (format !== 'sql') { expect(content).toContain('矩阵一'); expect(content).toContain('12345678901234567890.123456'); }
        if (format === 'json') expect(JSON.parse(content)).toHaveLength(2);
        if (format === 'sql') {
          expect(content).toContain('CREATE TABLE'); expect(content).toContain('INSERT INTO');
          // SQL 用 UTF-8 十六进制字面量保存文本，实际恢复到同一隔离库的新表来验证精度与字符。
          const restore = join(folder, 'records-restored.sql');
          await writeFile(restore, content.replaceAll('`records`', '`records_restored`'), 'utf8');
          await transfer(table, restore, 'import', 'sql', 2);
          const [restoredRows] = await observer.query<RowDataPacket[]>(`SELECT title,note,amount FROM \`${database}\`.records_restored ORDER BY id`);
          expect(restoredRows).toEqual(matrixRows);
        }
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
      await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: '刷新', exact: true })).click();
      await expect(table.getByRole('gridcell', { name: 'SQL导入', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('live-table.png') });
    }, testInfo);
  });
});
