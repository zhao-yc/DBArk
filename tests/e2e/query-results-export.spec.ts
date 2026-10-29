import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import type { TaskEvent } from '../../src/shared/contracts';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, writeSql, executeSql } from './live-helpers';

type Encoding = 'utf8' | 'utf16le' | 'gb18030';
type ResultTaskObservation = { events: { at: number; event: Pick<TaskEvent, 'taskId' | 'status' | 'progress' | 'rows' | 'message'> }[]; cancelTaskId?: string; cancelRequestedAt?: number; cancelFinished?: boolean; cancelError?: string; stop(): void };
type ObservedWindow = Window & { __resultFileObservation?: ResultTaskObservation; __returnedRowsObservation?: { taskId?: string; keys: string[]; ids: string[]; invalidPayloads: number; stop(): void } };
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
  await (await navigationMenuItem(page.locator('.query-tab:visible'), { name: '导出已返回结果', exact: true })).click();
  const modal = page.getByRole('dialog', { name: '导出已返回结果', exact: true });
  await modal.getByRole('combobox', { name: '结果文件格式', exact: true }).selectOption(format);
  await modal.getByRole('combobox', { name: '结果文件编码', exact: true }).selectOption(encoding);
  await expect((await navigationMenuItem(modal, { name: '开始导出已返回行', exact: true }))).toBeDisabled();
  await modal.locator('.file-picker').click();
  if (path) await expect(modal.locator('.file-picker')).toContainText(basename(path));
  else await expect((await navigationMenuItem(modal, { name: '开始导出已返回行', exact: true }))).toBeDisabled();
  return modal;
}

/** 每份结果只点击一次导出，等待真实完成消息后独立读取文件验证字节。 */
async function completeExport(modal: Locator, rows: number) {
  await (await navigationMenuItem(modal, { name: '开始导出已返回行', exact: true })).click();
  await expect(modal.locator('.success-box')).toHaveText(`已导出 ${rows} 行已返回结果。`, { timeout: 30000 });
  await expect(modal.locator('.error-box')).toHaveCount(0);
  await (await navigationMenuItem(modal, { name: '完成', exact: true })).click();
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

/** 有限结果用于观察真实文件任务；查询本身仍受客户端字节预算，不能假定返回全部 50000 行。 */
function cancellationSource(): string {
  const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
  return `SELECT a.n + b.n*10 + c.n*100 + d.n*1000 + e.n*10000 AS id, REPEAT('中文🚢,',32) AS payload FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN (SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) e`;
}

/** 仅观察查询真正传回的列与每个 ID，用于成功提交分支逐行比较；不重新执行原 SQL。 */
async function observeReturnedRows() {
  await page.evaluate(() => {
    const state = window as ObservedWindow;
    const observation = { keys: [] as string[], ids: [] as string[], invalidPayloads: 0, taskId: undefined as string | undefined, stop: () => {} };
    observation.stop = window.dbark.onTask(event => {
      if (event.columns?.map(column => column.name).join(',') === 'id,payload') { observation.taskId = event.taskId; observation.keys = event.columns.map(column => column.key); }
      if (event.taskId !== observation.taskId || !event.batch) return;
      for (const row of event.batch) { observation.ids.push(String(row[observation.keys[0]])); if (row[observation.keys[1]] !== '中文🚢,'.repeat(32)) observation.invalidPayloads++; }
    });
    state.__returnedRowsObservation = observation;
  });
}

/** 已返回 ID 顺序是文件的验收基准，不能仅凭行数或唯一性声称内容完整。 */
async function returnedRows() {
  return page.evaluate(() => {
    const state = window as ObservedWindow, observation = state.__returnedRowsObservation;
    if (!observation) throw new Error('未注册已返回行观察器');
    observation.stop(); delete state.__returnedRowsObservation;
    return { ids: observation.ids, keys: observation.keys, invalidPayloads: observation.invalidPayloads };
  });
}

/** 观察真实任务事件；早取消模式在第一条真实 running 回调发送一次真实 IPC，不替换执行链路。 */
async function observeResultTask(before: string[], earlyCancel = false) {
  await page.evaluate(({ existing, cancel }) => {
    const observation: ResultTaskObservation = { events: [], stop: () => {} };
    observation.stop = window.dbark.onTask(event => {
      if (existing.includes(event.taskId)) return;
      observation.events.push({ at: Date.now(), event: { taskId: event.taskId, status: event.status, progress: event.progress, rows: event.rows, message: event.message } });
      if (cancel && !observation.cancelTaskId && event.status === 'running') {
        observation.cancelTaskId = event.taskId; observation.cancelRequestedAt = Date.now();
        void window.dbark.invoke('query.cancel', { taskId: event.taskId }).then(() => { observation.cancelFinished = true; }, error => { observation.cancelError = String(error); });
      }
    });
    (window as ObservedWindow).__resultFileObservation = observation;
  }, { existing: before, cancel: earlyCancel });
}

/** 读取唯一终态及取消调用证据，停止监听后不影响该标签的后续操作。 */
async function resultTaskObservation() {
  return page.evaluate(() => {
    const state = window as ObservedWindow, observation = state.__resultFileObservation;
    if (!observation) throw new Error('未注册文件任务观察器');
    observation.stop(); delete state.__resultFileObservation;
    const { stop: _stop, ...summary } = observation; return summary;
  });
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
      await expect((await navigationMenuItem(query, { name: '导出已返回结果', exact: true }))).toBeDisabled();
      await (await navigationMenuItem(query, { name: '结果 2', exact: true })).click();
      await expect((await navigationMenuItem(query, { name: '导出已返回结果', exact: true }))).toBeEnabled();
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
      await (await navigationMenuItem(query, { name: '固定结果', exact: true })).click();
      await executeSql("SELECT '新结果不能覆盖固定数据' AS current_value;");
      const current = join(directory, 'current.json');
      await completeExport(await prepareExport(current, 'json'), 1);
      expect(await jsonFile(current)).toEqual([{ current_value: '新结果不能覆盖固定数据' }]);

      // 明确关闭真实数据库连接后，仍只能写缓存快照；原脚本内的主键 INSERT 不能被再次执行。
      await page.evaluate(id => window.dbark.invoke('connections.close', { id }), connectionId);
      await (await navigationMenuItem(query, { name: '固定 1', exact: true })).click();
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
      await (await navigationMenuItem(cancelled, { name: '关闭', exact: true })).click();
      expect(await jsonFile(original)).toEqual(records);
      expect((await readdir(directory)).sort()).toEqual(['current.json', 'fixed-gb18030.csv', 'fixed-utf16.json', 'original.json']);
      expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('截断只导出已返回行，取消查询的部分结果禁导出，文件取消竞争按真实终态核验', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.limited_rows (id INT PRIMARY KEY)`);
      await observer.query(`INSERT INTO \`${database}\`.limited_rows VALUES (1),(2),(3),(4),(5)`);
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await (await navigationMenuInput(query, {name:'查询结果行数上限',exact:true})).fill('2');
      await executeSql('SELECT id FROM limited_rows ORDER BY id');
      const directory = join(dataDir, 'result-cancellation'); await mkdir(directory);
      const limited = join(directory, '仅两行.json');
      const modal = await prepareExport(limited, 'json');
      await expect(modal.locator('.warning-text')).toContainText('此结果已截断');
      await expect(modal.locator('.info-strip')).toContainText('已返回 2 行');
      await completeExport(modal, 2);
      expect(await jsonFile(limited)).toEqual([{ id: 1 }, { id: 2 }]);
      await (await navigationMenuItem(query, { name: '固定结果', exact: true })).click();

      await writeSql('SELECT 99 AS cancelled_partial; SELECT SLEEP(30) AS wait_value;');
      await (await navigationMenuItem(query, { name: '执行全部', exact: true })).click();
      await expect(query.locator('.result-body')).toContainText('99');
      await expect((await navigationMenuItem(query, { name: '导出已返回结果', exact: true }))).toBeDisabled();
      await (await navigationMenuItem(query, { name: '停止', exact: true })).click();
      await expect((await navigationMenuItem(query, { name: '停止', exact: true }))).toBeDisabled({ timeout: 20000 });
      await expect((await navigationMenuItem(query, { name: '导出已返回结果', exact: true }))).toBeDisabled();
      await (await navigationMenuItem(query, { name: '固定 1', exact: true })).click();
      const preserved = join(directory, '取消后旧快照.json');
      await completeExport(await prepareExport(preserved, 'json'), 2);
      expect(await jsonFile(preserved)).toEqual([{ id: 1 }, { id: 2 }]);

      // 服务器生成有限的 50000 行用于真实文件取消；客户端没有导出完整表或重跑原 SQL。
      await (await navigationMenuInput(query, {name:'查询结果行数上限',exact:true})).fill('50000');
      await observeReturnedRows(); await executeSql(cancellationSource());
      const returned = await returnedRows(); expect(returned.keys).toHaveLength(2); expect(returned.invalidPayloads).toBe(0); expect(returned.ids.length).toBeGreaterThan(0); expect(new Set(returned.ids).size).toBe(returned.ids.length);
      const target = join(directory, '取消保护.csv'); const previous = Buffer.from('原目标不得被取消任务覆盖\r\n'); await writeFile(target, previous);
      const exporting = await prepareExport(target, 'csv');
      await expect(exporting.locator('.info-strip')).toContainText(`已返回 ${returned.ids.length} 行`);
      const history = await queryHistoryIds();
      const beforeTasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
      await observeResultTask(beforeTasks);
      await (await navigationMenuItem(exporting, { name: '开始导出已返回行', exact: true })).click();
      // 自然鼠标点击可能晚于原子替换；不能把旧 DOM 进度当作取消必然抵达提交前。
      await expect(exporting.locator('.transfer-progress')).toContainText(/已写入|已导出/, { timeout: 15000 });
      const cancel = (await navigationMenuItem(exporting, { name: '取消结果导出', exact: true })); let clickError: unknown;
      if (await cancel.count()) { try { await cancel.click({ timeout: 3000 }); } catch (error) { clickError = error; } }
      await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => !beforeTasks.includes(task.id)).map(task => task.status).join(','), { timeout: 15000 }).toMatch(/^(cancelled|completed|failed)$/);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const added = tasks.filter(task => !beforeTasks.includes(task.id));
      expect(added).toHaveLength(1); expect(added[0].kind).toBe('files.exportResult'); expect(['cancelled', 'completed']).toContain(added[0].status);
      if (clickError && added[0].status !== 'completed') throw clickError;
      const observation = await resultTaskObservation(); expect(observation.events.filter(item => item.event.status !== 'running').map(item => [item.event.taskId, item.event.status])).toEqual([[added[0].id, added[0].status]]);
      if (added[0].status === 'cancelled') {
        await expect(exporting.locator('.error-box')).toContainText('取消'); expect(await readFile(target)).toEqual(previous); await expect(exporting.locator('.success-box')).toHaveCount(0);
      } else {
        await expect(exporting.locator('.success-box')).toHaveText(`已导出 ${returned.ids.length} 行已返回结果。`); await expect(exporting.locator('.error-box')).toHaveCount(0);
        const csv = parse(await readFile(target)) as string[][]; expect(csv.shift()).toEqual(['id', 'payload']); expect(csv.length).toBe(returned.ids.length);
        for (let index = 0; index < csv.length; index++) if (csv[index].length !== 2 || csv[index][0] !== returned.ids[index] || csv[index][1] !== '中文🚢,'.repeat(32)) throw new Error(`已完成 CSV 的第 ${index + 1} 行与实际返回值不一致`);
      }
      expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
      expect(await queryHistoryIds()).toEqual(history);
      await writeFile(testInfo.outputPath('query-result-export-terminal.json'), JSON.stringify({ status: added[0].status, returnedRows: returned.ids.length, clickError: clickError ? String(clickError) : undefined, observation }, null, 2));
      await page.screenshot({ path: testInfo.outputPath('query-result-export-terminal.png') });
      await (await navigationMenuItem(exporting, { name: added[0].status === 'completed' ? '完成' : '关闭', exact: true })).click();
      const [allRows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.limited_rows`);
      expect(Number(allRows[0].total)).toBe(5);
    }, testInfo);
  });

  test('真实UI启动后首条文件进度触发真实IPC提前取消，原件字节保持且任务资源释放', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.cancel_once(id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible'); await (await navigationMenuInput(query, {name:'查询结果行数上限',exact:true})).fill('50000');
      await executeSql(`INSERT INTO cancel_once VALUES(1); ${cancellationSource()}`); await (await navigationMenuItem(query, { name: '结果 2', exact: true })).click();
      const directory = join(dataDir, 'result-early-cancellation'); await mkdir(directory);
      const target = join(directory, '提前取消原件.csv'), previous = Buffer.from('首条真实进度触发取消，原件必须保留\r\n'); await writeFile(target, previous);
      const exporting = await prepareExport(target, 'csv'); const history = await queryHistoryIds();
      const beforeTasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
      await observeResultTask(beforeTasks, true);
      // 只有开始动作来自 UI；提前取消通过真实事件回调发真实 IPC，不能称作鼠标点击取消的证据。
      await (await navigationMenuItem(exporting, { name: '开始导出已返回行', exact: true })).click();
      await expect(exporting.locator('.error-box')).toContainText('取消', { timeout: 15000 }); await expect(exporting.locator('.success-box')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as ObservedWindow).__resultFileObservation?.cancelFinished)).toBe(true);
      const added = (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => !beforeTasks.includes(task.id));
      expect(added).toHaveLength(1); expect(added[0]).toMatchObject({ kind: 'files.exportResult', status: 'cancelled' });
      const observation = await resultTaskObservation(); expect(observation.cancelTaskId).toBe(added[0].id); expect(observation.cancelError).toBeUndefined();
      expect(observation.events[0].event).toMatchObject({ taskId: added[0].id, status: 'running', progress: 0, rows: 0 });
      expect(observation.events.filter(item => item.event.status !== 'running').map(item => [item.event.taskId, item.event.status])).toEqual([[added[0].id, 'cancelled']]);
      expect(await readFile(target)).toEqual(previous); expect((await readdir(directory)).filter(name => name.endsWith('.partial'))).toEqual([]); expect(await queryHistoryIds()).toEqual(history);
      const [written] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.cancel_once`); expect(Number(written[0].total)).toBe(1);
      await writeFile(testInfo.outputPath('query-result-export-early-cancel.json'), JSON.stringify(observation, null, 2));
      await exporting.locator('.error-box').scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath('query-result-export-early-cancel.png') });
      await (await navigationMenuItem(exporting, { name: '关闭', exact: true })).click();
    }, testInfo);
  });

  test('打开和另存 SQL 文件不替换原标签或提交原会话的未完成事务', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.file_transaction (id INT PRIMARY KEY, note VARCHAR(80))`);
      await openDatabaseQuery(database);
      const query = page.locator('.query-tab:visible');
      await (await navigationMenuItem(query, { name: '开始事务', exact: true })).click();
      await expect((await navigationMenuItem(query, { name: '回滚', exact: true }))).toBeEnabled();
      await executeSql("INSERT INTO file_transaction VALUES (1,'仅原会话可见');");
      const probe = 'SELECT CONNECTION_ID() AS session_id, COUNT(*) AS visible_rows FROM file_transaction;';
      await executeSql(probe);
      // 数字校验与取值必须使用同一份读数，避免两次异步 DOM 读取之间网格重绘清空单元格。
      const sessionCell = query.locator('.result-body [role="gridcell"][aria-colindex="2"]');
      let originalSession = '';
      await expect.poll(async () => { const value = await sessionCell.innerText(); if (/^\d+$/.test(value)) originalSession = value; return value; }).toMatch(/^\d+$/);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('1');
      const [before] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(before[0].total)).toBe(0);
      const history = await queryHistoryIds();
      const tasks = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort());
      const directory = join(dataDir, 'transaction-query-files'); await mkdir(directory);
      const saved = join(directory, '原事务查询.sql');
      await chooseResultPath(saved);
      await (await navigationMenuItem(query, { name: '另存 SQL 文件', exact: true })).click();
      const saveDialog = page.getByRole('dialog', { name: '另存 SQL 文件', exact: true });
      await (await navigationMenuItem(saveDialog, { name: '选择并保存 SQL 文件', exact: true })).click();
      await expect(saveDialog).toBeHidden(); expect(await readFile(saved, 'utf8')).toBe(probe);

      const file = join(directory, '只打开不能执行.sql');
      const importedSql = "COMMIT; INSERT INTO file_transaction VALUES (99,'文件内容不能被执行');"; await writeFile(file, importedSql);
      await chooseResultPath(file, 'open');
      await (await navigationMenuItem(query, { name: '打开 SQL 文件', exact: true })).click();
      const openDialog = page.getByRole('dialog', { name: '打开 SQL 文件', exact: true });
      await (await navigationMenuItem(openDialog, { name: '选择并打开 SQL 文件', exact: true })).click();
      await expect(openDialog).toBeHidden(); await expect(page.locator('.workspace-tab-button')).toHaveCount(2);
      await expect(page.locator('.query-tab:visible .monaco-editor .view-lines')).toContainText('文件内容不能被执行');
      await expect((await navigationMenuItem(page.locator('.query-tab:visible'), { name: '回滚', exact: true }))).toBeDisabled();
      expect(await queryHistoryIds()).toEqual(history);
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort())).toEqual(tasks);
      const [afterOpen] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(afterOpen[0].total)).toBe(0);
      await page.locator('.workspace-tab-button').first().getByRole('button').first().click();
      await expect(query.locator('.monaco-editor .view-lines')).toContainText('CONNECTION_ID()');
      await expect((await navigationMenuItem(query, { name: '回滚', exact: true }))).toBeEnabled();
      await executeSql(probe);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(originalSession);
      await expect(query.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('1');
      await page.screenshot({ path: testInfo.outputPath('query-file-transaction-retained.png') });
      await (await navigationMenuItem(query, { name: '回滚', exact: true })).click();
      await expect((await navigationMenuItem(query, { name: '回滚', exact: true }))).toBeDisabled();
      const [afterRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.file_transaction`);
      expect(Number(afterRollback[0].total)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('query-file-transaction-rolled-back.png') });
    }, testInfo);
  });
});

/** 原门进入具体动作后才加载真实菜单导航，不改变默认/列表阶段的资源边界。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuItem(...args); }

/** 仅实际操作时加载结果设置菜单，默认及列表阶段不增加资源读取。 */
async function navigationMenuInput(...args: Parameters<typeof import('./navigation-menu')['navigationMenuInput']>): Promise<import('@playwright/test').Locator> { return (require('./navigation-menu') as typeof import('./navigation-menu')).navigationMenuInput(...args); }
