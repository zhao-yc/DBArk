import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'csv-parse';
import type { Locator } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { TaskEvent } from '../../src/shared/contracts';
import { test, expect, desktop, page, dataDir, pageErrors, answerDialogs, quitDesktop } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, executeSql, modifier } from './live-helpers';
import { readQueryCsvZip } from '../helpers/queryCsvZip';
import { parse as parseCsv } from 'csv-parse/sync';

// 凭据只进入临时连接表单；关闭追踪，截图和文件仅使用合成测试数据。
test.use({ trace: 'off' });
/** 只定位当前可见查询，避免多标签中旧结果参与断言。 */
const query = () => page.locator('.query-tab:visible');
/** 按完整可访问标题定位新执行导出窗口，与已有结果导出明确区分。 */
const dialog = () => page.getByRole('dialog', { name: '完整流式导出（新执行 SQL）', exact: true });
const acknowledgement = '我确认这是一次新的 SQL 执行，写入不能由取消文件导出撤销';
const binaryAcknowledgement = '我接受显式二进制模式的首次准备与诊断状态变化';
type StreamWindow = Window & { __q05StreamEvents?: TaskEvent[] };
type JsonDocument = { format: string; version: number; results: { kind: 'rows' | 'status'; resultOrdinal: number; statementOrdinal: number; rowResultOrdinal?: number; rows?: Record<string, unknown>[]; rowsWritten: number; columns?: { name: string; exportName: string }[] }[] };

/** 原生键盘准备 SQL；先删除旧选区避免配对包装，逐字核对持久化模板且不访问剪贴板。 */
async function writeSql(source: string) {
  await query().locator('.monaco-editor').getByRole('textbox').focus();
  await page.keyboard.press(`${modifier}+A`); await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.dbark.invoke('settings.get', {});
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n');
  })).toBe(source.replaceAll('\r\n', '\n'));
}
/** 只替换系统文件选择结果，不替换授权、IPC、数据库执行或实际文件写入。 */
async function choosePath(path?: string) {
  await desktop.evaluate(({ dialog: native }, filePath) => {
    native.showSaveDialog = (async () => ({ canceled: filePath === undefined, filePath })) as typeof native.showSaveDialog;
  }, path);
}
/** 流事件只观察，不修改任务；任务记录不持久化结果行，因此进度另从真实事件取证。 */
async function observeEvents() {
  await page.evaluate(() => {
    const state = window as StreamWindow;
    if (!state.__q05StreamEvents) { state.__q05StreamEvents = []; window.dbark.onTask(event => state.__q05StreamEvents!.push(event)); }
  });
}
/** 比对真实任务和历史编号，证明预览配置或旧结果导出没有偷偷执行 SQL。 */
async function executionIds() {
  return page.evaluate(async () => ({ tasks: (await window.dbark.invoke('tasks.list', {})).map(task => task.id).sort(), history: (await window.dbark.invoke('history.list', {})).map(item => item.id).sort() }));
}
/** 独立观察连接读取真实已提交计数，不依赖应用返回消息判断 SQL 是否执行。 */
async function count(observer: Connection, database: string, condition = '1=1') {
  const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.stream_guard WHERE ${condition}`);
  return Number(rows[0].total);
}
/** 选择格式和目标后仍需明确新执行确认，双协议确认相互独立。 */
async function openExport(path?: string, format: 'json' | 'csv' | 'csv-zip' = 'json', ordinal = 1, protocol: 'text-strict' | 'binary-explicit' = 'text-strict') {
  await observeEvents(); await choosePath(path);
  await query().getByRole('button', { name: '新执行并完整导出', exact: true }).click();
  const modal = dialog(); await expect(modal).toBeVisible();
  await modal.getByRole('combobox', { name: '完整文件格式', exact: true }).selectOption(format);
  await modal.getByRole('combobox', { name: '执行协议', exact: true }).selectOption(protocol);
  if (format === 'csv') await modal.getByRole('textbox', { name: '行结果集序号', exact: true }).fill(String(ordinal));
  await expect(modal.getByRole('button', { name: '确认新执行并导出', exact: true })).toBeDisabled();
  await modal.locator('.file-picker').click();
  if (path) await expect(modal.locator('.file-picker')).toContainText(basename(path));
  return modal;
}
/** 唯一开始入口；双击也必须只登记一个任务，失败后不进行自动重试。 */
async function start(modal: Locator, doubleClick = false) {
  const before = await executionIds();
  await modal.getByRole('checkbox', { name: acknowledgement, exact: true }).check();
  const binary = modal.getByRole('checkbox', { name: binaryAcknowledgement, exact: true });
  if (await binary.count()) {
    await expect(modal.getByRole('button', { name: '确认新执行并导出', exact: true })).toBeDisabled(); await binary.check();
  }
  const button = modal.getByRole('button', { name: '确认新执行并导出', exact: true });
  if (doubleClick) await button.dblclick(); else await button.click();
  let taskId = '';
  await expect.poll(async () => {
    const added = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(item => !ids.includes(item.id) && item.kind === 'query.exportStream'), before.tasks);
    if (added.length === 1) taskId = added[0].id;
    return added.length;
  }).toBe(1);
  return taskId;
}
/** 终态须由真实任务确认，完成提示不代替磁盘字节和独立服务器断言。 */
async function finish(taskId: string, status: 'completed' | 'failed' | 'cancelled' = 'completed') {
  await expect.poll(() => page.evaluate(async id => (await window.dbark.invoke('tasks.list', {})).find(item => item.id === id)?.status, taskId), { timeout: 60000 }).toBe(status);
  if (status === 'completed') { await expect(dialog().locator('.success-box')).toContainText('完整文件已提交'); await expect(dialog().locator('.error-box')).toHaveCount(0); }
  else await expect(dialog().locator('.error-box')).toBeVisible();
  return page.evaluate(id => (window as StreamWindow).__q05StreamEvents?.filter(event => event.taskId === id).at(-1), taskId);
}
/** 从真实关闭按钮收起模态，不能以隐藏窗口替代任务资源收尾断言。 */
async function closeExport() { await dialog().getByRole('button', { name: '关闭', exact: true }).click(); await expect(dialog()).toBeHidden(); }
/** 用独立解析器读实际小型 JSON 文件，不读取应用内存中的预览替代。 */
async function json(path: string): Promise<JsonDocument> { return JSON.parse(await readFile(path, 'utf8')); }
/** 对任务、历史、工作区和真实 SQLite 字节同时检查参数值及展开 Hex。 */
async function privacy(marker: string, template: string) {
  const persisted = await page.evaluate(async () => ({ history: await window.dbark.invoke('history.list', {}), tasks: await window.dbark.invoke('tasks.list', {}), settings: await window.dbark.invoke('settings.get', {}), queries: await window.dbark.invoke('queries.list', {}) }));
  const serialized = JSON.stringify(persisted), disk = await readFile(join(dataDir, 'dbark.sqlite')), hex = Buffer.from(marker).toString('hex');
  expect(serialized).not.toContain(marker); expect(serialized.toLowerCase()).not.toContain(hex);
  expect(disk.includes(Buffer.from(marker))).toBe(false); expect(disk.includes(Buffer.from(hex))).toBe(false);
  expect(persisted.history.some(item => item.sql.replaceAll('\r\n', '\n') === template)).toBe(true);
}
/** 只控制本例父目录的真实路径检查返回点；没有 IPC/数据库/文件内容替身。 */
async function installPathGate(parent: string) {
  await desktop.evaluate((_electron, directory) => {
    // 调试 evaluate 无动态 import 回调，取同一 Node 内建模块实例以便 finally 完整恢复。
    const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises'); const original = fs.realpath;
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    const state = { entered: false, release, restore: () => { fs.realpath = original; release(); } };
    (globalThis as typeof globalThis & { __q05PathGate?: typeof state }).__q05PathGate = state;
    fs.realpath = (async (...args: Parameters<typeof original>) => {
      const actual = await original(...args);
      if (String(args[0]).toLowerCase() === directory.toLowerCase()) { state.entered = true; await waiting; }
      return actual;
    }) as typeof original;
  }, parent);
}
/** 等到真实路径查询已完成但尚未投递工作进程，避免用固定延时猜竞态。 */
async function waitPathGate() { await expect.poll(() => desktop.evaluate(() => (globalThis as typeof globalThis & { __q05PathGate?: { entered: boolean } }).__q05PathGate?.entered)).toBe(true); }
/** 在取消或真实进程退出后释放准备边界，检验生产代码是否拒绝迟到投递。 */
async function releasePathGate() { await desktop.evaluate(() => (globalThis as typeof globalThis & { __q05PathGate?: { release(): void } }).__q05PathGate?.release()); }
/** 无论断言是否成功都恢复同一 Node 内建方法，防止本例影响正常退出和后续清理。 */
async function restorePathGate() { await desktop.evaluate(() => { const state = globalThis as typeof globalThis & { __q05PathGate?: { restore(): void } }; state.__q05PathGate?.restore(); delete state.__q05PathGate; }); }

test.describe('实库完整 SQL 流式导出', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试实例');
  test.describe.configure({ timeout: 180000 });

  test('多CSV入口明确新执行，ZIP授权、各行集与清单真实落盘且写入只发生一次', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard(id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      const directory = join(dataDir, 'multi-csv'); await mkdir(directory); const target = join(directory, 'all.zip'); await writeFile(target, '旧文件');
      await writeSql("INSERT INTO stream_guard VALUES(501);SELECT 11 AS same_name,22 AS same_name;SELECT 33 AS empty_value FROM DUAL WHERE 0;SELECT CAST(18446744073709551615 AS UNSIGNED) AS big_value,NULL AS missing,UNHEX('0001FF') AS bytes_value;");
      const before = await executionIds(), modal = await openExport(target, 'csv-zip'); await expect(modal).toContainText('所有行集顺序写入独立CSV'); await expect(modal.getByRole('textbox', { name: '行结果集序号', exact: true })).toHaveCount(0); expect(await executionIds()).toEqual(before); expect(await count(observer, database)).toBe(0);
      const taskId = await start(modal, true), event = await finish(taskId); expect(event?.queryExport).toMatchObject({ statementsCompleted: 4, fileCommitted: true, rowsWritten: 2 });
      const files = await readQueryCsvZip(target), manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')); expect(manifest.results.map((result: any) => result.kind)).toEqual(['status', 'rows', 'rows', 'rows']);
      expect(parseCsv(files.get('results/rows-001.csv')!)).toEqual([['same_name', 'same_name [2]'], ['11', '22']]); expect(parseCsv(files.get('results/rows-002.csv')!)).toEqual([['empty_value']]); expect(parseCsv(files.get('results/rows-003.csv')!)[1]).toEqual(['18446744073709551615', '\\N', 'base64:AAH/']);
      expect(await count(observer, database)).toBe(1); const after = await executionIds(); expect(after.history.filter(id => !before.history.includes(id))).toHaveLength(1); await expect(modal.getByRole('button', { name: '确认新执行并导出', exact: true })).toBeDisabled(); await expect(modal).toContainText('results/rows-003.csv'); expect(await readdir(directory)).toEqual(['all.zip']); await page.screenshot({ path: testInfo.outputPath('multi-csv-zip-success.png') }); await closeExport();
    }, testInfo);
  });

  test('选区固定、模态快捷键和双击只执行一次，同标签事务临时表保持且旧结果导出不重放', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      await executeSql('CREATE TEMPORARY TABLE stream_temp(value INT); INSERT INTO stream_temp VALUES(42); SET @stream_marker=73;');
      await executeSql('SELECT CONNECTION_ID() AS thread_id');
      const cell = query().locator('.result-body [role="gridcell"][aria-colindex="2"]');
      let threadId = ''; await expect.poll(async () => { threadId = (await cell.textContent())?.trim() ?? ''; return threadId; }).toMatch(/^\d+$/);
      await query().getByRole('button', { name: '开始事务', exact: true }).click(); await expect(query().locator('.tab-status')).toContainText('事务进行中');
      const source = 'INSERT INTO stream_guard VALUES(1); SELECT CONNECTION_ID() AS thread_id, value, @stream_marker AS session_value FROM stream_temp;';
      const excluded = 'COMMIT; INSERT INTO stream_guard VALUES(99);';
      await writeSql(`${source}\n${excluded}`); await page.keyboard.press(`${modifier}+A`);
      for (let index = 0; index <= excluded.length; index++) await page.keyboard.press('Shift+ArrowLeft');
      const directory = join(dataDir, 'single-execution'); await mkdir(directory); const target = join(directory, 'transaction.json');
      const before = await executionIds(); const modal = await openExport(target);
      await expect(modal.locator('.query-stream-source')).toHaveText(source);
      await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`);
      expect(await executionIds()).toEqual(before); expect(await count(observer, database)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('stream-fixed-selection.png') });
      const taskId = await start(modal, true); await finish(taskId);
      expect(await count(observer, database)).toBe(0);
      const file = await json(target); expect(file).toMatchObject({ format: 'DBArk-query-results', version: 1 });
      expect(file.results.map(item => [item.resultOrdinal, item.statementOrdinal, item.kind])).toEqual([[1, 1, 'status'], [2, 2, 'rows']]);
      expect(Object.values(file.results[1].rows![0]).map(String)).toEqual([threadId, '42', '73']);
      const after = await executionIds(); expect(after.history.filter(id => !before.history.includes(id))).toHaveLength(1);
      await page.screenshot({ path: testInfo.outputPath('stream-single-execution-success.png') }); await closeExport();
      await expect(query().locator('.tab-status')).toContainText('事务进行中');
      await query().getByRole('button', { name: '结果 2', exact: true }).click();
      await choosePath(join(directory, 'cached-preview.json'));
      await query().getByRole('button', { name: '导出已返回结果', exact: true }).click();
      const cached = page.getByRole('dialog', { name: '导出已返回结果', exact: true });
      await cached.getByRole('combobox', { name: '结果文件格式', exact: true }).selectOption('json'); await cached.locator('.file-picker').click();
      await cached.getByRole('button', { name: '开始导出已返回行', exact: true }).click(); await expect(cached.locator('.success-box')).toContainText('已导出 1 行');
      await cached.getByRole('button', { name: '完成', exact: true }).click();
      expect((await executionIds()).history).toEqual(after.history); expect(await count(observer, database)).toBe(0);
      await executeSql('SELECT CONNECTION_ID(), COUNT(*) FROM stream_guard');
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(threadId);
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('1');
      await query().getByRole('button', { name: '回滚', exact: true }).click(); await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
      expect(await count(observer, database)).toBe(0); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    }, testInfo);
  });

  test('类型参数只是配置，成功和SQL错误只持久化模板，CSV不存在结果不重放已提交写入', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`);
      await observer.query(`CREATE TABLE \`${database}\`.stream_secret (value VARCHAR(100) PRIMARY KEY)`); await openDatabaseQuery(database);
      const marker = `Q05_SECRET_${randomUUID()}`; const template = 'INSERT INTO stream_secret VALUES(:value); SELECT CAST(18446744073709551615 AS UNSIGNED) AS big_value, NULL AS null_value, X\'00ff\' AS payload, \'中文\' AS `__proto__`;';
      await writeSql(template); const directory = join(dataDir, 'parameters'); await mkdir(directory); const target = join(directory, 'secret.json');
      const modal = await openExport(target); const before = await executionIds();
      await modal.getByRole('button', { name: '填写类型参数', exact: true }).click();
      const form = page.getByRole('dialog', { name: '类型参数查询', exact: true });
      await expect(form.getByRole('button', { name: '应用参数（不执行 SQL）', exact: true })).toBeEnabled({ timeout: 20000 });
      const row = form.locator('.parameter-row').filter({ has: page.getByText('参数类型 value', { exact: true }) });
      await row.getByRole('combobox').selectOption('text'); await row.getByRole('textbox', { name: '参数值 value', exact: true }).fill(marker);
      await form.getByRole('button', { name: '应用参数（不执行 SQL）', exact: true }).click(); await expect(form).toBeHidden();
      expect(await executionIds()).toEqual(before);
      const first = await start(modal); await finish(first); await closeExport(); await privacy(marker, template);
      const content = await json(target), values = content.results.find(item => item.kind === 'rows')!.rows![0];
      expect(values.big_value).toBe('18446744073709551615'); expect(values.null_value).toBeNull(); expect(values.payload).toEqual({ type: 'binary', base64: 'AP8=' }); expect(Object.hasOwn(values, '__proto__')).toBe(true); expect(values.__proto__).toBe('中文');
      expect(await readFile(target, 'utf8')).not.toContain(marker); expect(await readFile(target, 'utf8')).not.toContain(template);
      // 相同模板重新打开，填写值不恢复；明确第二次执行制造真实重复键失败，不能自动重试。
      const second = await openExport(target); await second.getByRole('button', { name: '填写类型参数', exact: true }).click();
      await expect(form.getByRole('button', { name: '应用参数（不执行 SQL）', exact: true })).toBeEnabled({ timeout: 20000 });
      const secondRow = form.locator('.parameter-row').filter({ has: page.getByText('参数类型 value', { exact: true }) });
      await expect(secondRow.getByRole('textbox', { name: '参数值 value', exact: true })).toHaveValue('');
      await secondRow.getByRole('textbox', { name: '参数值 value', exact: true }).fill(marker);
      await form.getByRole('button', { name: '应用参数（不执行 SQL）', exact: true }).click();
      const failed = await start(second); await finish(failed, 'failed'); await expect(second.locator('.error-box')).toContainText('ER_DUP_ENTRY');
      await expect(second.getByRole('button', { name: '确认再次新执行并导出', exact: true })).toBeDisabled();
      expect(await json(target)).toEqual(content); await privacy(marker, template); await closeExport();
      const previous = Buffer.from('CSV 原件'); const csv = join(directory, 'missing.csv'); await writeFile(csv, previous);
      await writeSql('INSERT INTO stream_guard VALUES(7); SELECT 1 AS only_result;');
      const absent = await openExport(csv, 'csv', 2); const absentTask = await start(absent); await finish(absentTask, 'failed');
      await expect(absent.locator('.error-box')).toContainText('不存在指定的行结果集'); expect(await readFile(csv)).toEqual(previous); expect(await count(observer, database, 'id=7')).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('stream-missing-result-protected.png') }); await closeExport();
      expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    }, testInfo);
  });

  test('CSV按本次行结果序号导出100001行，预览仍200行且普通上限不截断文件', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      await query().getByLabel('查询结果行数上限', { exact: true }).fill('2');
      const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
      await writeSql(`INSERT INTO stream_guard VALUES(1); SELECT '不是目标' AS ignored; SELECT a.n+b.n*10+c.n*100+d.n*1000+e.n*10000+f.n*100000+1 AS id FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e CROSS JOIN ${digits} f WHERE a.n+b.n*10+c.n*100+d.n*1000+e.n*10000+f.n*100000<100001 ORDER BY id; INSERT INTO stream_guard VALUES(2);`);
      const directory = join(dataDir, 'complete-file'); await mkdir(directory); const target = join(directory, 'all-rows.csv');
      const modal = await openExport(target, 'csv', 2); const taskId = await start(modal); const event = await finish(taskId);
      expect(event?.queryExport).toMatchObject({ statementsCompleted: 4, rowsWritten: 100001, fileCommitted: true });
      let rows = 0, sum = 0;
      for await (const row of createReadStream(target).pipe(parse({ columns: true }))) { rows++; const id = Number(row.id); if (id !== rows) throw new Error(`完整 CSV 第 ${rows} 行错误`); sum += id; }
      expect(rows).toBe(100001); expect(sum).toBe(5000150001); expect(await count(observer, database)).toBe(2);
      await page.screenshot({ path: testInfo.outputPath('stream-complete-over-limit.png') }); await closeExport();
      await query().getByRole('button', { name: '结果 3', exact: true }).click(); await expect(query().locator('.tab-status')).toContainText('200'); await expect(query().locator('.tab-status')).toContainText('已达到结果上限');
      expect(await query().locator('.result-body [role="row"]').count()).toBeLessThan(80); expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('严格浮点失败保留原件，显式二进制确认后精确导出相邻FLOAT和DOUBLE', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`);
      await observer.query(`CREATE TABLE \`${database}\`.stream_float(id INT PRIMARY KEY,f FLOAT,d DOUBLE)`);
      await observer.query(`INSERT INTO \`${database}\`.stream_float VALUES(1,1,1),(2,1.00000011920928955078125,1.0000000000000002)`); await openDatabaseQuery(database);
      const directory = join(dataDir, 'float-protocol'); await mkdir(directory); const target = join(directory, 'floats.json'); await writeFile(target, '浮点原件');
      await writeSql('INSERT INTO stream_guard VALUES(1); SELECT f,d FROM stream_float ORDER BY id; INSERT INTO stream_guard VALUES(2);');
      const strict = await openExport(target); const first = await start(strict); await finish(first, 'failed');
      await expect(strict.locator('.error-box')).toContainText('FLOAT/DOUBLE'); expect(await readFile(target, 'utf8')).toBe('浮点原件'); expect(await count(observer, database)).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('stream-strict-float-failure.png') }); await closeExport();
      await writeSql('SELECT f,d FROM stream_float ORDER BY id;');
      const binary = await openExport(target, 'json', 1, 'binary-explicit'); const second = await start(binary); await finish(second);
      expect((await json(target)).results[0].rows).toEqual([{ f: 1, d: 1 }, { f: 1.0000001192092896, d: 1.0000000000000002 }]);
      expect(await count(observer, database)).toBe(1); await page.screenshot({ path: testInfo.outputPath('stream-binary-float-success.png') }); await closeExport();
    }, testInfo);
  });

  test('真实长查询与磁盘写入取消均等资源终态，不执行尾SQL且旧文件保持', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      await executeSql('SELECT CONNECTION_ID() AS thread_id'); const cell = query().locator('.result-body [role="gridcell"][aria-colindex="2"]');
      let threadId = ''; await expect.poll(async () => { threadId = (await cell.textContent())?.trim() ?? ''; return threadId; }).toMatch(/^\d+$/);
      const directory = join(dataDir, 'cancellation'); await mkdir(directory); const target = join(directory, 'protected.csv'); const previous = Buffer.from('取消保护原件'); await writeFile(target, previous);
      await writeSql('SELECT SLEEP(30) AS wait_value; INSERT INTO stream_guard VALUES(9);');
      const modal = await openExport(target, 'csv'); const first = await start(modal);
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>('SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=?', [threadId]); return rows.some(row => String(row.INFO).includes('SLEEP(30)')); }).toBe(true);
      await modal.getByRole('button', { name: '取消任务', exact: true }).click(); await finish(first, 'cancelled'); expect(await readFile(target)).toEqual(previous); expect(await count(observer, database)).toBe(0); await closeExport();
      const digits = '(SELECT 0 n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)';
      await writeSql(`SELECT REPEAT('实际磁盘写入',128) AS payload FROM ${digits} a CROSS JOIN ${digits} b CROSS JOIN ${digits} c CROSS JOIN ${digits} d CROSS JOIN ${digits} e; INSERT INTO stream_guard VALUES(10);`);
      const writing = await openExport(target, 'csv'); const second = await start(writing);
      await expect.poll(() => page.evaluate(id => (window as StreamWindow).__q05StreamEvents?.some(event => event.taskId === id && event.status === 'running' && (event.queryExport?.bytesWritten ?? 0) >= 65536), second), { timeout: 20000 }).toBe(true);
      await writing.getByRole('button', { name: '取消任务', exact: true }).click(); const terminal = await finish(second, 'cancelled');
      expect(terminal?.queryExport?.bytesWritten).toBeGreaterThan(0); expect(terminal?.queryExport?.rowsWritten).toBeLessThan(100000);
      expect(await readFile(target)).toEqual(previous); expect(await count(observer, database)).toBe(0); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
      await page.screenshot({ path: testInfo.outputPath('stream-writing-cancelled.png') }); await closeExport();
      await executeSql('SELECT CONNECTION_ID() AS thread_id'); await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(threadId);
      const [active] = await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=? AND COMMAND<>?', [threadId, 'Sleep']); expect(active).toHaveLength(0);
    }, testInfo);
  });

  test('主进程真实路径归一化准备期间取消不发送SQL，恢复文件接口后同目标可正常使用', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionId }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`);
      const directory = join(dataDir, 'preparing-cancel'); await mkdir(directory); const target = join(directory, 'protected.json'); await writeFile(target, '准备取消原件');
      await choosePath(target); await observeEvents();
      const file = await page.evaluate(() => window.dbark.invoke('files.choose', { purpose: 'export', format: 'json' })); expect(file).not.toBeNull();
      const sessionId = await page.evaluate(async input => (await window.dbark.invoke('sessions.open', input)).sessionId, { connectionId, database });
      const taskId = randomUUID();
      await installPathGate(directory);
      try {
        // 调用真实 Preload，等待由主进程真实准备阶段可控边界确认；不凭 sleep 猜测取消时点。
        await page.evaluate(input => {
          const state = window as StreamWindow & { __q05PreparingOutcome?: { ok: boolean; error?: string } };
          void window.dbark.invoke('query.exportStream', input).then(() => { state.__q05PreparingOutcome = { ok: true }; }, error => { state.__q05PreparingOutcome = { ok: false, error: String(error) }; });
        }, { sessionId, sql: 'INSERT INTO stream_guard VALUES(31); SELECT 1 AS value', taskId, fileToken: file!.token, format: 'json' as const, encoding: 'utf8' as const, protocol: 'text-strict' as const, resultSelection: { kind: 'all' as const } });
        await waitPathGate();
        await page.evaluate(id => window.dbark.invoke('query.cancel', { taskId: id }), taskId);
        expect(await count(observer, database)).toBe(0);
        await releasePathGate();
        await expect.poll(() => page.evaluate(() => (window as StreamWindow & { __q05PreparingOutcome?: { ok: boolean } }).__q05PreparingOutcome?.ok)).toBe(false);
        const event = await page.evaluate(id => (window as StreamWindow).__q05StreamEvents?.filter(item => item.taskId === id).at(-1), taskId);
        expect(event).toMatchObject({ status: 'cancelled', queryExport: { phase: 'preparing', statementsCompleted: 0, sqlMayHaveExecuted: false, fileCommitted: false } });
        expect(await count(observer, database)).toBe(0); expect(await readFile(target, 'utf8')).toBe('准备取消原件');
      } finally {
        await restorePathGate();
        await page.evaluate(id => window.dbark.invoke('sessions.close', { sessionId: id }), sessionId);
      }
      await openDatabaseQuery(database); await writeSql('INSERT INTO stream_guard VALUES(32); SELECT 1 AS value');
      const modal = await openExport(target); const next = await start(modal); await finish(next); expect(await count(observer, database, 'id=32')).toBe(1); await closeExport();
      expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    }, testInfo);
  });

  test('路径准备期间真实数据库utility进程退出后不迟到执行或覆盖原件', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionId }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`);
      const directory = join(dataDir, 'worker-exit-preparing'); await mkdir(directory); const target = join(directory, 'protected.json'); await writeFile(target, '工作进程退出保护原件');
      await choosePath(target); await observeEvents();
      const file = await page.evaluate(() => window.dbark.invoke('files.choose', { purpose: 'export', format: 'json' })); expect(file).not.toBeNull();
      const sessionId = await page.evaluate(async input => (await window.dbark.invoke('sessions.open', input)).sessionId, { connectionId, database });
      const workerPid = await desktop.evaluate(({ app }) => {
        const workers = app.getAppMetrics().filter(metric => metric.type === 'Utility' && (metric.name === 'DBArk 数据库引擎' || metric.serviceName === 'DBArk 数据库引擎'));
        if (workers.length !== 1 || workers[0].pid === process.pid || workers[0].pid < 1) throw new Error('无法唯一核对本测试应用的数据库 utility 进程');
        return workers[0].pid;
      });
      const taskId = randomUUID(); await installPathGate(directory);
      try {
        await page.evaluate(input => {
          const state = window as StreamWindow & { __q05WorkerOutcome?: { ok: boolean; error?: string } };
          void window.dbark.invoke('query.exportStream', input).then(() => { state.__q05WorkerOutcome = { ok: true }; }, error => { state.__q05WorkerOutcome = { ok: false, error: String(error) }; });
        }, { sessionId, taskId, sql: 'INSERT INTO stream_guard VALUES(41); SELECT 1 AS value', fileToken: file!.token, format: 'json' as const, encoding: 'utf8' as const, protocol: 'text-strict' as const, resultSelection: { kind: 'all' as const } });
        await waitPathGate();
        // 只终止刚由 app.getAppMetrics 唯一核对的本测试数据库进程，不按进程名批量终止。
        await desktop.evaluate(({ app }, pid) => {
          const owned = app.getAppMetrics().some(metric => metric.pid === pid && metric.type === 'Utility' && (metric.name === 'DBArk 数据库引擎' || metric.serviceName === 'DBArk 数据库引擎'));
          if (!owned || pid === process.pid) throw new Error('数据库进程归属已改变，拒绝终止');
          process.kill(pid, 'SIGKILL');
        }, workerPid);
        await expect.poll(() => page.evaluate(async id => (await window.dbark.invoke('tasks.list', {})).find(item => item.id === id)?.status, taskId)).toBe('failed');
        await releasePathGate();
        await expect.poll(() => page.evaluate(() => (window as StreamWindow & { __q05WorkerOutcome?: { ok: boolean } }).__q05WorkerOutcome?.ok)).toBe(false);
        const event = await page.evaluate(id => (window as StreamWindow).__q05StreamEvents?.filter(item => item.taskId === id).at(-1), taskId);
        expect(event).toMatchObject({ status: 'failed', queryExport: { phase: 'preparing', sqlMayHaveExecuted: false, fileCommitted: false, statementsCompleted: 0 } });
        expect(await readFile(target, 'utf8')).toBe('工作进程退出保护原件'); expect(await count(observer, database)).toBe(0);
        const workers = await desktop.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Utility' && (metric.name === 'DBArk 数据库引擎' || metric.serviceName === 'DBArk 数据库引擎')).map(metric => metric.pid));
        expect(workers).toEqual([]); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
      } finally { await restorePathGate(); }
    }, testInfo);
  });

  test('通过Electron正常退出正在导出的标签会等待真正取消，事务和原文件均保持正确', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.stream_guard (id INT PRIMARY KEY)`); await openDatabaseQuery(database);
      await query().getByRole('button', { name: '开始事务', exact: true }).click(); await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeEnabled();
      await executeSql('INSERT INTO stream_guard VALUES(51); SELECT CONNECTION_ID() AS thread_id'); await query().getByRole('button', { name: '结果 2', exact: true }).click();
      let threadId = ''; await expect.poll(async () => { threadId = (await query().locator('.result-body [role="gridcell"][aria-colindex="2"]').textContent())?.trim() ?? ''; return threadId; }).toMatch(/^\d+$/);
      const directory = join(dataDir, 'quit-while-exporting'); await mkdir(directory); const path = join(directory, 'protected.json'); await writeFile(path, '退出时原件');
      await writeSql('SELECT SLEEP(30); INSERT INTO stream_guard VALUES(52)'); const modal = await openExport(path); await start(modal);
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>('SELECT INFO FROM information_schema.PROCESSLIST WHERE ID=?', [threadId]); return rows.some(row => String(row.INFO).includes('SLEEP(30)')); }).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('stream-before-normal-quit.png') });
      await answerDialogs([1, 1]); await quitDesktop();
      await expect.poll(async () => { const [rows] = await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [threadId]); return rows.length; }).toBe(0);
      expect(await count(observer, database)).toBe(0); expect(await readFile(path, 'utf8')).toBe('退出时原件'); expect((await readdir(directory)).some(name => name.endsWith('.partial'))).toBe(false);
    }, testInfo);
  });
});
