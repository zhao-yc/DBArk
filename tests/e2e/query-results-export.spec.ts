import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, writeSql, executeSql } from './live-helpers';

type Encoding = 'utf8' | 'utf16le' | 'gb18030';
test.use({ trace: 'off' });

/** 只控制原生选择结果，数据库、导出任务和文件 IO 不替换为模拟实现。 */
async function chooseResultPath(path?: string, mode: 'save' | 'open' = 'save') {
  await desktop.evaluate(({ dialog }, choice) => {
    if (choice.mode === 'save') dialog.showSaveDialog = (async () => ({ canceled: choice.path === undefined, filePath: choice.path })) as typeof dialog.showSaveDialog;
    else dialog.showOpenDialog = (async () => ({ canceled: choice.path === undefined, filePaths: choice.path === undefined ? [] : [choice.path] })) as typeof dialog.showOpenDialog;
  }, { path, mode });
}

/** 格式和编码始终由用户界面选择；目标未授权时开始按钮必须不可用。 */
async function prepareExport(path: string | undefined, format: 'csv' | 'json', encoding: Encoding = 'utf8') {
  await chooseResultPath(path);
  await page.locator('.query-tab:visible').getByRole('button', { name: '导出已返回结果', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '导出已返回结果', exact: true });
  await modal.getByRole('combobox', { name: '结果文件格式', exact: true }).selectOption(format);
  await modal.getByRole('combobox', { name: '结果文件编码', exact: true }).selectOption(encoding);
  await expect(modal.getByRole('button', { name: '开始导出已返回行', exact: true })).toBeDisabled();
  await modal.locator('.file-picker').click();
  if (path) await expect(modal.locator('.file-picker')).toContainText(basename(path));
  else await expect(modal.getByRole('button', { name: '开始导出已返回行', exact: true })).toBeDisabled();
  return modal;
}

/** 每份结果只点击一次导出，等待真实完成消息后独立读取文件验证字节。 */
async function completeExport(modal: Locator, rows: number) {
  await modal.getByRole('button', { name: '开始导出已返回行', exact: true }).click();
  await expect(modal.locator('.success-box')).toHaveText(`已导出 ${rows} 行已返回结果。`, { timeout: 30000 });
  await expect(modal.locator('.error-box')).toHaveCount(0);
  await modal.getByRole('button', { name: '完成', exact: true }).click();
  await expect(modal).toBeHidden();
}

/** 独立解析文件，不复用被测导出序列化函数，保留数字字符串及原型同名 JSON 键。 */
async function jsonFile(path: string, encoding: Encoding = 'utf8'): Promise<Record<string, unknown>[]> {
  return JSON.parse(iconv.decode(await readFile(path), encoding));
}

/** 每个导出前后都比较真实查询历史，防止导出缓存结果时重放原 SQL。 */
async function queryHistoryIds() {
  return page.evaluate(async () => (await window.dbark.invoke('history.list', {})).map(item => item.id).sort());
}

test.describe('实库查询结果文件导出', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试服务器');
  test.describe.configure({ timeout: 180000 });

  test('多结果与固定旧结果保留重名列和精确值，断开连接导出不重放写 SQL', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionId }) => {
      await observer.query(`CREATE TABLE \`${database}\`.export_once (id INT PRIMARY KEY)`);
      await openDatabaseQuery(database);
      await executeSql(`INSERT INTO export_once VALUES (1);
SELECT CAST(9223372036854775807 AS SIGNED) AS exact_bigint,
 CAST('12345678901234567890.12345678901234567890' AS DECIMAL(40,20)) AS exact_decimal,
 NULL AS null_value, '' AS empty_value,
 CONCAT('中文,逗号', CHAR(10 USING utf8mb4), '第二行"引号"🚢') AS text_value,
 X'00ff' AS binary_value, CONCAT(CHAR(92 USING utf8mb4), 'N') AS literal_null,
 'first' AS dup, 'second' AS dup, 'reserved' AS \`dup [9]\`, 'proto' AS \`__proto__\`, 'empty-name' AS \`\`;`);
      const query = page.locator('.query-tab:visible');
      await expect(query.getByRole('button', { name: '导出已返回结果', exact: true })).toBeDisabled();
      await query.getByRole('button', { name: '结果 2', exact: true }).click();
      await expect(query.getByRole('button', { name: '导出已返回结果', exact: true })).toBeEnabled();
      const directory = join(dataDir, 'result-roundtrip'); await mkdir(directory);
      const original = join(directory, 'original.json');
      const modal = await prepareExport(original, 'json');
      await expect(modal.locator('.result-export-columns')).toContainText('dup [10]');
      await expect(modal.locator('.result-export-columns')).toContainText('列 [12]');
      await page.screenshot({ path: testInfo.outputPath('query-result-export-columns.png') });
      const firstHistory = await queryHistoryIds();
      await completeExport(modal, 1);
      expect(await queryHistoryIds()).toEqual(firstHistory);
      const records = await jsonFile(original);
      expect(records).toHaveLength(1);
      expect(Object.keys(records[0])).toEqual(['exact_bigint', 'exact_decimal', 'null_value', 'empty_value', 'text_value', 'binary_value', 'literal_null', 'dup', 'dup [10]', 'dup [9]', '__proto__', '列 [12]']);
      expect(records[0]).toMatchObject({ exact_bigint: '9223372036854775807', exact_decimal: '12345678901234567890.12345678901234567890', null_value: null, empty_value: '', text_value: '中文,逗号\n第二行"引号"🚢', binary_value: { type: 'binary', base64: 'AP8=' }, literal_null: '\\N', dup: 'first', 'dup [10]': 'second', 'dup [9]': 'reserved', '列 [12]': 'empty-name' });
      expect(Object.hasOwn(records[0], '__proto__')).toBe(true); expect(records[0].__proto__).toBe('proto');
      await query.getByRole('button', { name: '固定结果', exact: true }).click();
      await executeSql("SELECT '新结果不能覆盖固定数据' AS current_value;");
      const current = join(directory, 'current.json');
      await completeExport(await prepareExport(current, 'json'), 1);
      expect(await jsonFile(current)).toEqual([{ current_value: '新结果不能覆盖固定数据' }]);

      // 明确关闭真实数据库连接后，仍只能写缓存快照；原脚本内的主键 INSERT 不能被再次执行。
      await page.evaluate(id => window.dbark.invoke('connections.close', { id }), connectionId);
      await query.getByRole('button', { name: '固定 1', exact: true }).click();
      const fixedHistory = await queryHistoryIds();
      const fixedCsv = join(directory, 'fixed-gb18030.csv');
      await completeExport(await prepareExport(fixedCsv, 'csv', 'gb18030'), 1);
      const csvRows = parse(iconv.decode(await readFile(fixedCsv), 'gb18030')) as string[][];
      expect(csvRows[0]).toEqual(Object.keys(records[0]));
      expect(csvRows[1]).toEqual(['9223372036854775807', '12345678901234567890.12345678901234567890', '\\N', '', '中文,逗号\n第二行"引号"🚢', 'base64:AP8=', '\\\\N', 'first', 'second', 'reserved', 'proto', 'empty-name']);
      const fixedJson = join(directory, 'fixed-utf16.json');
      await completeExport(await prepareExport(fixedJson, 'json', 'utf16le'), 1);
      expect((await readFile(fixedJson)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
      expect(await jsonFile(fixedJson, 'utf16le')).toEqual(records);
      expect(await queryHistoryIds()).toEqual(fixedHistory);
      const [written] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.export_once`);
      expect(Number(written[0].total)).toBe(1);
      const cancelled = await prepareExport(undefined, 'json');
      await cancelled.getByRole('button', { name: '关闭', exact: true }).click();
      expect(await jsonFile(original)).toEqual(records);
      expect((await readdir(directory)).sort()).toEqual(['current.json', 'fixed-gb18030.csv', 'fixed-utf16.json', 'original.json']);
      expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('截断只导出已返回行，取消查询的部分结果禁导出，取消文件任务保护原文件', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.limited_rows (id INT PRIMARY KEY)`);
      await observer.query(`INSERT INTO \`${database}\`.limited_rows VALUES (1),(2),(3),(4),(5)`);
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await query.getByLabel('查询结果行数上限', { exact: true }).fill('2');
      await executeSql('SELECT id FROM limited_rows ORDER BY id');
      const directory = join(dataDir, 'result-cancellation'); await mkdir(directory);
      const limited = join(directory, '仅两行.json');
      const modal = await prepareExport(limited, 'json');
      await expect(modal.locator('.warning-text')).toContainText('此结果已截断');
      await expect(modal.locator('.info-strip')).toContainText('已返回 2 行');
      await completeExport(modal, 2);
      expect(await jsonFile(limited)).toEqual([{ id: 1 }, { id: 2 }]);
      await query.getByRole('button', { name: '固定结果', exact: true }).click();

      await writeSql('SELECT 99 AS cancelled_partial; SELECT SLEEP(30) AS wait_value;');
      await query.getByRole('button', { name: '执行全部', exact: true }).click();
      await expect(query.locator('.result-body')).toContainText('99');
      await expect(query.getByRole('button', { name: '导出已返回结果', exact: true })).toBeDisabled();
      await query.getByRole('button', { name: '停止', exact: true }).click();
      await expect(query.getByRole('button', { name: '停止', exact: true })).toBeDisabled({ timeout: 20000 });
      await expect(query.getByRole('button', { name: '导出已返回结果', exact: true })).toBeDisabled();
      await query.getByRole('button', { name: '固定 1', exact: true }).click();
      const preserved = join(directory, '取消后旧快照.json');
      await completeExport(await prepareExport(preserved, 'json'), 2);
      expect(await jsonFile(preserved)).toEqual([{ id: 1 }, { id: 2 }]);

      // 服务器生成有限的 50000 行用于真实文件取消；客户端没有导出完整表或重跑原 SQL。
      await query.getByLabel('查询结果行数上限', { exact: true }).fill('50000');
      const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
      await executeSql(`SELECT a.n + b.n*10 + c.n*100 + d.n*1000 + e.n*10000 AS id, REPEAT('中文🚢,',32) AS payload FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) e`);
      const target = join(directory, '取消保护.csv'); const previous = Buffer.from('原目标不得被取消任务覆盖\r\n'); await writeFile(target, previous);
      const exporting = await prepareExport(target, 'csv');
      const history = await queryHistoryIds();
      const beforeTasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
      await exporting.getByRole('button', { name: '开始导出已返回行', exact: true }).click();
      // 使用真实进度作为取消时点，不插入 sleep、不伪造磁盘阻塞，也不重复开始写入。
      await expect(exporting.locator('.transfer-progress')).toContainText('已写入', { timeout: 15000 });
      await exporting.getByRole('button', { name: '取消结果导出', exact: true }).click();
      await expect(exporting.locator('.error-box')).toContainText('取消', { timeout: 15000 });
      expect(await readFile(target)).toEqual(previous);
      expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const added = tasks.filter(task => !beforeTasks.includes(task.id));
      expect(added).toHaveLength(1); expect(added[0]).toMatchObject({ kind: 'files.exportResult', status: 'cancelled' });
      expect(await queryHistoryIds()).toEqual(history);
      await page.screenshot({ path: testInfo.outputPath('query-result-export-cancelled.png') });
      await exporting.getByRole('button', { name: '关闭', exact: true }).click();
      const [allRows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.limited_rows`);
      expect(Number(allRows[0].total)).toBe(5);
    }, testInfo);
  });

  test('打开和另存 SQL 文件不替换原标签或提交原会话的未完成事务', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.file_transaction (id INT PRIMARY KEY, note VARCHAR(80))`);
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await query.getByRole('button', { name: '开始事务', exact: true }).click();
      await expect(query.getByRole('button', { name: '回滚', exact: true })).toBeEnabled();
      await executeSql("INSERT INTO file_transaction VALUES (1,'仅原会话可见');");
      const probe = 'SELECT CONNECTION_ID() AS session_id, COUNT(*) AS visible_rows FROM file_transaction;';
      await executeSql(probe);
      // 查询完成事件先于虚拟表格绘制；必须等待真实单元格数字，而不是立刻读取尚为空的 DOM。
      const sessionCell = query.locator('.result-body [role="gridcell"][aria-colindex="2"]');
      await expect(sessionCell).toHaveText(/^\d+$/);
      const originalSession = await sessionCell.innerText();
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('1');
      const [before] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(before[0].total)).toBe(0);
      const history = await queryHistoryIds();
      const tasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
      const directory = join(dataDir, 'transaction-query-files'); await mkdir(directory);
      const saved = join(directory, '原事务查询.sql');
      await chooseResultPath(saved);
      await query.getByRole('button', { name: '另存 SQL 文件', exact: true }).click();
      const saveDialog = page.getByRole('dialog', { name: '另存 SQL 文件', exact: true });
      await saveDialog.getByRole('button', { name: '选择并保存 SQL 文件', exact: true }).click();
      await expect(saveDialog).toBeHidden(); expect(await readFile(saved, 'utf8')).toBe(probe);

      const file = join(directory, '只打开不能执行.sql');
      const importedSql = "COMMIT; INSERT INTO file_transaction VALUES (99,'文件内容不能被执行');"; await writeFile(file, importedSql);
      await chooseResultPath(file, 'open');
      await query.getByRole('button', { name: '打开 SQL 文件', exact: true }).click();
      const openDialog = page.getByRole('dialog', { name: '打开 SQL 文件', exact: true });
      await openDialog.getByRole('button', { name: '选择并打开 SQL 文件', exact: true }).click();
      await expect(openDialog).toBeHidden(); await expect(page.locator('.workspace-tab-button')).toHaveCount(2);
      await expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('文件内容不能被执行');
      await expect(page.locator('.query-tab:visible').getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
      expect(await queryHistoryIds()).toEqual(history);
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort())).toEqual(tasks);
      const [afterOpen] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(afterOpen[0].total)).toBe(0);
      await page.locator('.workspace-tab-button').first().getByRole('button').first().click();
      await expect(query.locator('.monaco-editor .view-lines')).toContainText('CONNECTION_ID()');
      await expect(query.getByRole('button', { name: '回滚', exact: true })).toBeEnabled();
      await executeSql(probe);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(originalSession);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('1');
      await page.screenshot({ path: testInfo.outputPath('query-file-transaction-retained.png') });
      await query.getByRole('button', { name: '回滚', exact: true }).click();
      await expect(query.getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
      const [afterRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(afterRollback[0].total)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('query-file-transaction-rolled-back.png') });
    }, testInfo);
  });
});
