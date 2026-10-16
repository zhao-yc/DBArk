import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { QueryParameter, QueryParameterType } from '../../src/shared/queryParameters';
import { test, expect, desktop, page, dataDir, pageErrors } from './desktop-fixture';
import { enabled, isolatedDatabase, openDatabaseQuery, executeSql, modifier } from './live-helpers';

// 表单确实填写临时数据库凭据；关闭追踪，参数验收数据也不复制到公开日志中。
test.use({ trace: 'off' });
const query = () => page.locator('.query-tab:visible');
const parameterDialog = () => page.getByRole('dialog', { name: '类型参数查询', exact: true });

/** 合成paste准备SQL，走可见编辑器既有粘贴处理；逐字核对持久化正文，不访问系统剪贴板。 */
async function writeSql(source: string) {
  await query().locator('.monaco-editor').getByRole('textbox').focus();
  await page.keyboard.press(`${modifier}+A`); await page.keyboard.press('Backspace');
  await query().locator('.monaco-editor').getByRole('textbox').evaluate((element, sql) => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', sql);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, source);
  await expect.poll(async () => page.evaluate(async () => {
    const settings = await window.dbark.invoke('settings.get', {});
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n');
  })).toBe(source.replaceAll('\r\n', '\n'));
}

/** 从独立观察连接读取提交结果，不调用应用实现来解释参数值。 */
async function countRows(observer: Connection, database: string, condition = '1=1') {
  const [rows] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.parameter_guard WHERE ${condition}`);
  return Number(rows[0].total);
}

/** 单行模板之外附加一条写入，再用真实选区收缩排除它，不依赖软换行位置。 */
async function selectTemplate(source: string, excluded: string) {
  await writeSql(`${source}\n${excluded}`);
  await page.keyboard.press(`${modifier}+A`);
  for (let index = 0; index <= excluded.length; index++) await page.keyboard.press('Shift+ArrowLeft');
}

/** 参数识别使用真实会话；等待识别完成才能填写，不能用固定延时假定表单已就绪。 */
async function openParameters(source?: string) {
  if (source !== undefined) await writeSql(source);
  await query().getByRole('button', { name: '参数执行', exact: true }).click();
  const modal = parameterDialog();
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: '执行参数 SQL', exact: true })).toBeEnabled({ timeout: 20000 });
  await expect(modal.locator('.error-box')).toHaveCount(0);
  return modal;
}

/** 所有九种值通过可见控件输入，NULL 的值控件必须禁用。 */
async function fillParameter(modal: Locator, name: string, type: QueryParameterType, value?: string) {
  // 包裹式 label 的可访问名称可能包含选项文案，以字段标题精确定位这一行。
  const row = modal.locator('.parameter-row').filter({ has: page.getByText(`参数类型 ${name}`, { exact: true }) });
  await row.getByRole('combobox').selectOption(type);
  // textarea 正文可能进入 label.textContent，按真实可访问名称定位，重复填值仍稳定。
  if (type === 'null') await expect(row.locator('textarea')).toBeDisabled();
  else await row.getByRole('textbox', { name: `参数值 ${name}`, exact: true }).fill(value ?? '');
}

/** 手动名称从稳定行内填写，重名测试也不依赖重复的 aria-label 定位。 */
async function addManualParameter(modal: Locator, name: string, type: QueryParameterType = 'text', value = '') {
  await modal.getByRole('button', { name: '添加参数', exact: true }).click();
  const row = modal.locator('.parameter-row').last();
  await row.getByRole('textbox', { name: /^参数名称 / }).fill(name);
  await row.getByRole('combobox').selectOption(type);
  if (type !== 'null') await row.getByRole('textbox', { name: /^参数值 / }).fill(value);
  return row;
}

/** 只点击一次开始，按真实任务登记找到这次执行，不重放失败的写操作。 */
async function startParameters(modal: Locator): Promise<string> {
  const before = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
  await modal.getByRole('button', { name: '执行参数 SQL', exact: true }).click();
  await expect(modal).toBeHidden();
  let taskId = '';
  await expect.poll(async () => {
    const added = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(task => !ids.includes(task.id) && task.kind === 'query.executeParameterized'), before);
    if (added.length === 1) taskId = added[0].id;
    return added.length;
  }).toBe(1);
  return taskId;
}

/** 任务终态与按钮都需完成；断言结果单元格时仍单独等待虚拟表格绘制。 */
async function finishParameters(taskId: string, status: 'completed' | 'failed' | 'cancelled' = 'completed') {
  await expect.poll(async () => page.evaluate(async id => (await window.dbark.invoke('tasks.list', {})).find(task => task.id === id)?.status, taskId), { timeout: 20000 }).toBe(status);
  await expect(query().getByRole('button', { name: '停止', exact: true })).toBeDisabled();
  if (status === 'completed') await expect(query().locator(':scope > .error-box')).toHaveCount(0);
}

/** 只比较任务和历史编号，读取本身不能制造查询任务或保存副本。 */
async function executionIds() {
  return page.evaluate(async () => ({ tasks: (await window.dbark.invoke('tasks.list', {})).map(item => item.id).sort(), history: (await window.dbark.invoke('history.list', {})).map(item => item.id).sort() }));
}

/** 模板留在持久化边界，填写值及其展开 Hex 不得落入历史、任务、工作区或 SQLite。 */
async function assertParameterPrivacy(markers: string[], templates: string[] = []) {
  const persisted = await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), settings: await window.dbark.invoke('settings.get', {}), queries: await window.dbark.invoke('queries.list', {}) }));
  const serialized = JSON.stringify(persisted);
  const disk = await readFile(join(dataDir, 'dbark.sqlite'));
  for (const marker of markers) {
    expect(serialized).not.toContain(marker);
    expect(serialized.toLowerCase()).not.toContain(Buffer.from(marker).toString('hex'));
    expect(disk.includes(Buffer.from(marker))).toBe(false);
    expect(disk.includes(Buffer.from(Buffer.from(marker).toString('hex')))).toBe(false);
  }
  for (const template of templates) expect(persisted.history.some(entry => entry.sql.replaceAll('\r\n', '\n') === template)).toBe(true);
  expect(pageErrors).toEqual([]);
}

test.describe('实库类型参数查询', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试服务器');
  test.describe.configure({ timeout: 180000 });

  test('选区与重复参数只执行一次，九种类型保留精度，模态快捷键和持久化不泄露填写值', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.parameter_guard (id INT PRIMARY KEY)`);
      await observer.query(`CREATE TABLE \`${database}\`.parameter_values (id INT PRIMARY KEY, text_value TEXT, integer_value DECIMAL(65,0), decimal_value DECIMAL(65,30), bool_value BOOLEAN, date_value DATE, datetime_value DATETIME(6), time_value TIME(6), binary_value BLOB, null_value VARCHAR(10), repeated_text TEXT)`);
      await openDatabaseQuery(database);
      await executeSql("SELECT '参数预览期间保留的旧结果' AS previous_result;");
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('参数预览期间保留的旧结果');
      const marker = `Q06_SECRET_${randomUUID()}`;
      const textValue = `${marker} 中文🚢'"; DROP TABLE parameter_guard; -- \\\n第二行`;
      const decimal = '12345678901234567890.123456789012345678901234567890';
      const template = 'INSERT INTO parameter_values VALUES (1,:text,:integer,:decimal,:boolean,:date,:datetime,:time,:binary,:null,:text);';
      await selectTemplate(template, 'INSERT INTO parameter_guard VALUES (99);');
      const beforePreview = await executionIds();
      const cancelledPreview = await openParameters();
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('参数预览期间保留的旧结果');
      await cancelledPreview.getByRole('button', { name: '取消', exact: true }).click();
      await expect(cancelledPreview).toBeHidden();
      expect(await executionIds()).toEqual(beforePreview); expect(await countRows(observer, database)).toBe(0);
      const modal = await openParameters();
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('参数预览期间保留的旧结果');
      await expect(modal.locator('.parameter-row')).toHaveCount(9);
      await expect(modal.locator('.monaco-editor .view-lines')).not.toContainText('parameter_guard');
      await fillParameter(modal, 'text', 'text', textValue);
      await fillParameter(modal, 'integer', 'integer', '18446744073709551615');
      await fillParameter(modal, 'decimal', 'decimal', decimal);
      await fillParameter(modal, 'boolean', 'boolean', 'true');
      await fillParameter(modal, 'date', 'date', '2000-02-29');
      await fillParameter(modal, 'datetime', 'datetime', '2026-10-14 12:34:56.123456');
      await fillParameter(modal, 'time', 'time', '-125:34:56.654321');
      await fillParameter(modal, 'binary', 'binary', '00017fff');
      await fillParameter(modal, 'null', 'null');
      const before = await executionIds();
      await modal.getByRole('textbox', { name: '参数值 text', exact: true }).focus();
      await page.keyboard.press(`${modifier}+Enter`); await page.keyboard.press(`${modifier}+S`);
      await expect(modal).toBeVisible(); expect(await executionIds()).toEqual(before);
      expect(await countRows(observer, database)).toBe(0);
      const [unwritten] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM \`${database}\`.parameter_values`);
      expect(Number(unwritten[0].total)).toBe(0);
      await modal.locator('.parameter-row').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('parameter-form.png') });
      await finishParameters(await startParameters(modal));
      expect(await countRows(observer, database)).toBe(0);
      const [rows] = await observer.query<RowDataPacket[]>(`SELECT text_value,CAST(integer_value AS CHAR) AS integer_value,CAST(decimal_value AS CHAR) AS decimal_value,bool_value,DATE_FORMAT(date_value,'%Y-%m-%d') AS date_value,DATE_FORMAT(datetime_value,'%Y-%m-%d %H:%i:%s.%f') AS datetime_value,CAST(time_value AS CHAR) AS time_value,HEX(binary_value) AS binary_value,null_value,repeated_text FROM \`${database}\`.parameter_values WHERE id=1`);
      expect(rows).toHaveLength(1);
      expect({ ...rows[0] }).toEqual({ text_value: textValue, integer_value: '18446744073709551615', decimal_value: decimal, bool_value: 1, date_value: '2000-02-29', datetime_value: '2026-10-14 12:34:56.123456', time_value: '-125:34:56.654321', binary_value: '00017FFF', null_value: null, repeated_text: textValue });
      const repeated = "SELECT :value AS first_parameter, :value AS second_parameter, ':ignored' AS literal_value /* :ignored_comment */;";
      const repeatedDialog = await openParameters(repeated);
      await expect(repeatedDialog.locator('.parameter-row')).toHaveCount(1);
      await fillParameter(repeatedDialog, 'value', 'text', marker);
      await finishParameters(await startParameters(repeatedDialog));
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText(marker);
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText(marker);
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="4"]')).toHaveText(':ignored');
      await page.screenshot({ path: testInfo.outputPath('parameter-result.png') });
      await query().getByRole('button', { name: '固定结果', exact: true }).click();
      await query().getByRole('button', { name: '快照 SQL', exact: true }).click();
      const preview = page.getByRole('dialog', { name: '固定结果的原 SQL', exact: true });
      await expect(preview.locator('.monaco-editor .view-lines')).toContainText(':value');
      await expect(preview.locator('.monaco-editor .view-lines')).not.toContainText(marker);
      await preview.getByRole('button', { name: '关闭', exact: true }).click();
      await assertParameterPrivacy([marker], [template, repeated]);
    }, testInfo);
  });

  test('非法类型和手动重名在表单拒绝，缺参及多余参数的 IPC 请求不能先执行写入', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionId }) => {
      await observer.query(`CREATE TABLE \`${database}\`.parameter_guard (id INT PRIMARY KEY)`);
      await openDatabaseQuery(database);
      const source = 'INSERT INTO parameter_guard VALUES (1); SELECT :value;';
      const modal = await openParameters(source);
      const before = await executionIds();
      const invalid: { type: QueryParameterType; value: string; error: RegExp }[] = [
        { type: 'integer', value: '1; DROP TABLE parameter_guard', error: /普通十进制/ },
        { type: 'decimal', value: '1e3', error: /普通十进制/ },
        { type: 'boolean', value: '1', error: /true 或 false/ },
        { type: 'date', value: '2025-02-29', error: /有效的 YYYY-MM-DD/ },
        { type: 'datetime', value: '2026-10-14 24:00:00', error: /日期时间/ },
        { type: 'time', value: '839:00:00', error: /小时范围/ },
        { type: 'binary', value: '0ff', error: /偶数位十六进制/ },
      ];
      for (const invalidValue of invalid) {
        await fillParameter(modal, 'value', invalidValue.type, invalidValue.value);
        await modal.getByRole('button', { name: '执行参数 SQL', exact: true }).click();
        await expect(modal.locator('.error-box')).toContainText(invalidValue.error);
        expect(await executionIds()).toEqual(before); expect(await countRows(observer, database)).toBe(0);
      }
      await fillParameter(modal, 'value', 'integer', '2');
      const manual = await addManualParameter(modal, '');
      await modal.getByRole('button', { name: '执行参数 SQL', exact: true }).click();
      await expect(modal.locator('.error-box')).toContainText('参数名须为');
      await manual.getByRole('textbox', { name: /^参数名称 / }).fill('value');
      await modal.getByRole('button', { name: '执行参数 SQL', exact: true }).click();
      await expect(modal.locator('.error-box')).toContainText('查询参数名称重复');
      expect(await executionIds()).toEqual(before); expect(await countRows(observer, database)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('query-parameters-invalid-before-write.png') });
      await modal.getByRole('button', { name: '取消', exact: true }).click();

      // 自动识别参数行不可删除；缺参用真实 IPC 负例验证主进程和引擎防线，不篡改表单 DOM。
      const { sessionId } = await page.evaluate(input => window.dbark.invoke('sessions.open', input), { connectionId, database });
      try {
        const invalidLists: QueryParameter[][] = [[], [{ name: 'value', type: 'integer', value: '2' }, { name: 'unused', type: 'null' }], [{ name: 'value', type: 'null' }, { name: 'value', type: 'null' }]];
        for (const parameters of invalidLists) {
          const message = await page.evaluate(async input => { try { await window.dbark.invoke('query.executeParameterized', input); return ''; } catch (error) { return String(error); } }, { sessionId, sql: source, parameters, taskId: randomUUID(), maxRows: 10 });
          expect(message).toMatch(/缺少命名参数值|多余参数|名称重复/);
          expect(await countRows(observer, database)).toBe(0);
        }
      } finally { await page.evaluate(input => window.dbark.invoke('sessions.close', input), { sessionId }); }
      expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('动态模式警示支持手动补参，失败保留已提交语句，未完成事务仍可真实回滚', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.parameter_guard (id INT PRIMARY KEY, note VARCHAR(120) UNIQUE) ENGINE=InnoDB`);
      await openDatabaseQuery(database);
      await executeSql("SET SESSION sql_mode=''; SET @future_mode='NO_BACKSLASH_ESCAPES';");
      const dynamic = "SET SESSION sql_mode=@future_mode; SELECT 'path\\' AS path_value, :later AS bound_value;";
      const manual = await openParameters(dynamic);
      await expect(manual.locator('.info-strip')).toContainText('名称预览可能不完整');
      await expect(manual.locator('.parameter-row')).toHaveCount(0);
      await addManualParameter(manual, 'later', 'integer', '42');
      await finishParameters(await startParameters(manual));
      await expect(query().getByRole('button', { name: '结果 2', exact: true })).toBeVisible();
      await query().getByRole('button', { name: '结果 2', exact: true }).click();
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('path\\');
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('42');
      await executeSql("SET SESSION sql_mode='';");

      const committedMarker = `Q06_COMMITTED_${randomUUID()}`;
      const partial = "INSERT INTO parameter_guard VALUES (1,:secret); SET SESSION sql_mode=@future_mode; SELECT 'path\\' AS path_value, :later AS missing_value; INSERT INTO parameter_guard VALUES (9,'后续不能执行');";
      const partialDialog = await openParameters(partial);
      await expect(partialDialog.locator('.info-strip')).toContainText('此前已经提交');
      await expect(partialDialog.locator('.parameter-row')).toHaveCount(1);
      await fillParameter(partialDialog, 'secret', 'text', committedMarker);
      await finishParameters(await startParameters(partialDialog), 'failed');
      await expect(query().locator(':scope > .error-box')).toContainText('已完成 2 条');
      await expect(query().locator(':scope > .error-box')).toContainText('未自动回滚或重放');
      expect(await countRows(observer, database, 'id=1')).toBe(1); expect(await countRows(observer, database, 'id=9')).toBe(0);
      await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeDisabled();

      // 成功完成的协议状态可确定事务已开启；先核对正常提示，再回滚这个空事务。
      const knownDialog = await openParameters('START TRANSACTION; SELECT :probe AS transaction_probe;');
      await fillParameter(knownDialog, 'probe', 'integer', '1');
      await finishParameters(await startParameters(knownDialog));
      await expect(query().locator('.tab-status')).toContainText('事务进行中');
      await expect(query().locator('.tab-status')).not.toContainText('事务状态需核对');
      await query().getByRole('button', { name: '回滚', exact: true }).click();
      await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeDisabled();

      const transactionMarker = `Q06_TRANSACTION_${randomUUID()}`;
      const transactional = 'START TRANSACTION; INSERT INTO parameter_guard VALUES (2,:secret); INSERT INTO parameter_guard VALUES (3,:secret); INSERT INTO parameter_guard VALUES (4,:secret);';
      const transactionDialog = await openParameters(transactional);
      await fillParameter(transactionDialog, 'secret', 'text', transactionMarker);
      await finishParameters(await startParameters(transactionDialog), 'failed');
      await expect(query().locator(':scope > .error-box')).toContainText('ER_DUP_ENTRY');
      await expect(query().locator(':scope > .error-box')).not.toContainText(transactionMarker);
      await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeEnabled();
      await expect(query().getByRole('button', { name: '提交', exact: true })).toBeEnabled();
      await expect(query().getByRole('button', { name: '开始事务', exact: true })).toBeDisabled();
      // MySQL 错误包不携带当前事务状态，不能把上一次状态当成当前确定状态。
      await expect(query().locator('.tab-status')).toContainText('事务状态需核对');
      await expect(query().locator('.tab-status')).not.toContainText('事务进行中');
      expect(await countRows(observer, database, 'id IN (2,3,4)')).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('query-parameters-failed-transaction.png') });
      await executeSql('SELECT COUNT(*) AS own_uncommitted_rows FROM parameter_guard WHERE id IN (2,3,4);');
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('1');
      await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeEnabled();
      await expect(query().locator('.tab-status')).toContainText('事务进行中');
      await expect(query().locator('.tab-status')).not.toContainText('事务状态需核对');
      await page.screenshot({ path: testInfo.outputPath('query-parameters-transaction-reconciled.png') });
      await query().getByRole('button', { name: '回滚', exact: true }).click();
      await expect(query().getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
      await executeSql('SELECT COUNT(*) AS rolled_back_rows FROM parameter_guard WHERE id IN (2,3,4);');
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('0');
      expect(await countRows(observer, database, 'id IN (2,3,4)')).toBe(0);
      expect(await countRows(observer, database)).toBe(1);
      await assertParameterPrivacy([committedMarker, transactionMarker], [partial, transactional]);
    }, testInfo);
  });

  test('参数长查询可取消且不执行后续写入，失败结果禁固定导出并释放会话继续执行', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      await observer.query(`CREATE TABLE \`${database}\`.parameter_guard (id INT PRIMARY KEY)`);
      await openDatabaseQuery(database);
      const marker = `Q06_CANCEL_${randomUUID()}`;
      const source = 'SELECT :value AS started_value; SELECT SLEEP(:delay) AS waiting; INSERT INTO parameter_guard VALUES (99);';
      const modal = await openParameters(source);
      await fillParameter(modal, 'value', 'text', marker); await fillParameter(modal, 'delay', 'integer', '30');
      const taskId = await startParameters(modal);
      await expect(query().locator('.result-body')).toContainText(marker);
      await expect(query().getByRole('button', { name: '停止', exact: true })).toBeEnabled();
      await query().getByRole('button', { name: '停止', exact: true }).click();
      await finishParameters(taskId, 'cancelled');
      await expect(query().locator(':scope > .error-box')).toContainText('取消');
      await expect(query().getByRole('button', { name: '固定结果', exact: true })).toBeDisabled();
      await expect(query().getByRole('button', { name: '导出已返回结果', exact: true })).toBeDisabled();
      expect(await countRows(observer, database)).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('query-parameters-cancelled.png') });
      await executeSql('SELECT 1 AS usable_after_cancel;');
      await expect(query().locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('1');
      expect(await countRows(observer, database)).toBe(0);
      await assertParameterPrivacy([marker], [source]);
    }, testInfo);
  });
});
