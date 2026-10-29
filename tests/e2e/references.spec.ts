import { clickSidebarAction } from './sidebar-menu';
import { randomUUID } from 'node:crypto';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { Locator, TestInfo } from '@playwright/test';
import { test, expect, page, desktop, closed, answerDialogs, quitDesktop, pageErrors } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, acceptNativeConfirmation, openDatabaseQuery, executeSql, modifier, type LiveContext } from './live-helpers';
import { zh } from '../../src/renderer/locales/zh-CN';

// 仅测试显式授权的远程实例，禁用会记录连接表单凭据的追踪。
test.use({ trace: 'off' });
const tableTab = () => page.locator('.table-tab:visible');
const referenceDialog = (mode: 'choose' | 'browse') => page.getByRole('dialog', { name: mode === 'choose' ? '选择外键值' : '查看关联记录', exact: true });

/** 固定对象名与夹具生成的随机库名分别引用，不插入用户来源的 SQL 标识符。 */
const qualified = (database: string, table: string) => `\`${database}\`.\`${table}\``;

/** 跨库父表仍属于本例随机命名空间；先释放应用会话再按依赖顺序清理两个库。 */
async function withParentDatabase(body: (context: LiveContext & { parentDatabase: string }) => Promise<void>, testInfo: TestInfo) {
  await isolatedDatabase(async context => {
    const parentDatabase = `${context.database}_parent`;
    await context.observer.query(`CREATE DATABASE \`${parentDatabase}\` CHARACTER SET utf8mb4`);
    try { await body({ ...context, parentDatabase }); }
    finally {
      if (!closed) { await answerDialogs([1, 1]); await quitDesktop(); }
      if (!/^dbark_e2e_[a-z0-9_]+$/.test(context.database) || parentDatabase !== `${context.database}_parent`) throw new Error('拒绝清理不属于本例的跨库对象');
      await context.observer.query(`DROP DATABASE IF EXISTS \`${context.database}\``);
      await context.observer.query(`DROP DATABASE IF EXISTS \`${parentDatabase}\``);
      const [remaining] = await context.observer.query<RowDataPacket[]>('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (?,?)', [context.database, parentDatabase]);
      expect(remaining).toHaveLength(0);
    }
  }, testInfo);
}

/** 刷新同一真实连接后展开指定库，不刷新已有表格标签或丢弃其草稿。 */
async function openTable(connectionName: string, database: string, table: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  const row = connection.locator('.connection-row'); await row.hover();
  await clickSidebarAction(row, { name: '刷新连接', exact: true });
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await expect(databaseRow).toBeVisible(); await (await (await import('./navigation-menu')).navigationMenuItem(databaseRow, { name: database, exact: true })).click();
  const object = connection.locator('.object-row').getByText(table, { exact: true });
  await expect(object).toBeVisible(); await object.click();
  await expect(tableTab().locator('.context-bar')).toContainText(table);
  await expect(tableTab().locator('.loading-overlay')).toHaveCount(0);
  await expect(tableTab().locator(':scope > .error-box')).toHaveCount(0);
  return tableTab();
}

/** 通过列头的真实 aria-colindex 定位单元格，包含选择列时也不假定业务列偏移。 */
async function tableCell(table: Locator, column: string, row = 2) {
  const header = table.getByRole('columnheader', { name: new RegExp(`^${column}`) });
  await expect(header).toHaveCount(1);
  const index = await header.getAttribute('aria-colindex');
  if (!index) throw new Error('真实网格缺少列位置');
  const cell = table.locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
  await cell.scrollIntoViewIfNeeded(); return cell;
}

/** 单元格编辑只写入草稿；是否影响服务器由独立观察连接另外断言。 */
async function editCell(table: Locator, column: string, value: string, row = 2) {
  await (await tableCell(table, column, row)).dblclick();
  const input = table.getByRole('textbox', { name: `编辑 ${column}`, exact: true });
  await input.fill(value); await input.press('Enter');
}

/** 不替换 IPC；等待实际引用读取任务结束后再断言结果或错误。 */
async function settledReferences() {
  await expect.poll(async () => page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.referencePage' && task.status === 'running').length), { timeout: 20000 }).toBe(0);
}

/** 多外键时必须明确选择约束，单外键也核对本次读取的真实候选网格。 */
async function openReference(table: Locator, column: string, mode: 'choose' | 'browse', foreignKey?: string, row = 2) {
  await (await tableCell(table, column, row)).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: mode === 'choose' ? '选择外键值' : '查看关联记录', exact: true })).click();
  const modal = referenceDialog(mode); await expect(modal).toBeVisible();
  if (foreignKey) await modal.getByRole('combobox', { name: '外键约束', exact: true }).selectOption(foreignKey);
  return modal;
}

/** 候选只通过实际单元格选择，随后精确重读并一次暂存整组外键列。 */
async function chooseReference(modal: Locator, visibleLabel: string) {
  await modal.getByRole('gridcell', { name: visibleLabel, exact: true }).click();
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '使用选中关联值', exact: true })).click();
  await expect(modal).toBeHidden({ timeout: 20000 }); await settledReferences();
}

/** 引用筛选沿用界面上的条件表单，任一模式不得绕过当前元组的关联约束。 */
async function filterReferences(modal: Locator, column: string, operator: string, value: string) {
  await modal.getByRole('combobox', { name: '筛选字段', exact: true }).selectOption(column);
  await modal.getByRole('combobox', { name: '筛选运算符', exact: true }).selectOption(operator);
  await modal.getByRole('textbox', { name: '筛选值', exact: true }).fill(value);
  await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '添加条件', exact: true })).click();
  await settledReferences();
}

/** 提交仍走普通表格的 SQL 预览和确认流程，外键选择不会直接写数据库。 */
async function previewDraft(table: Locator) {
  await (await (await import('./navigation-menu')).navigationMenuItem(table, { name: '预览并提交', exact: true })).click();
  const modal = page.getByRole('dialog', { name: '确认数据修改', exact: true });
  await expect(modal.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); return modal;
}

/** 额外连接只用于本例持锁与观察；它不会进入应用的查询会话或临时表。 */
async function observerConnection() {
  if (environment.DBARK_TEST_HOST !== '192.168.31.200') throw new Error('外键验收只允许本轮已核对的 200 实例');
  return mysql.createConnection({ host: environment.DBARK_TEST_HOST, port: Number(environment.DBARK_TEST_PORT ?? 13384), user: environment.DBARK_TEST_USER, password: environment.DBARK_TEST_PASSWORD, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true });
}

/** 根据本例随机库名和固定父表名观察真实阻塞语句，不把对话框关闭当成连接释放。 */
async function matchingServerReads(observer: Connection, database: string, table: string) {
  const [rows] = await observer.query<RowDataPacket[]>('SELECT ID,STATE,INFO FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID()');
  return rows.filter(row => typeof row.INFO === 'string' && row.INFO.includes(database) && row.INFO.includes(table) && !/^LOCK TABLES/i.test(row.INFO));
}

/** 取消后连原服务端线程也必须消失；查询结束但留下 Sleep 连接不算资源释放。 */
async function expectConnectionsClosed(observer: Connection, ids: number[]) {
  expect(ids.length).toBeGreaterThan(0);
  await expect.poll(async () => {
    const [rows] = await observer.query<RowDataPacket[]>('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (?)', [ids]);
    return rows.map(row => Number(row.ID));
  }, { timeout: 10000 }).toEqual([]);
}

test.describe('实库外键选择与关联浏览', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED 并配置已核对的远程测试服务器');
  test.describe.configure({ timeout: 180000 });

  test('跨库复合键分页选择一次暂存两列，关联筛选不泄漏其他父记录，集中提交失败整体回滚', async ({}, testInfo) => {
    await withParentDatabase(async ({ observer, database, parentDatabase, connectionName }) => {
      const parents = qualified(parentDatabase, 'reference_parents'), children = qualified(database, 'reference_children');
      await observer.query(`CREATE TABLE ${parents} (parent_big BIGINT UNSIGNED NOT NULL,parent_decimal DECIMAL(40,20) NOT NULL,label VARCHAR(80),PRIMARY KEY(parent_big,parent_decimal)) ENGINE=InnoDB`);
      const values = Array.from({ length: 130 }, (_, index) => [String(9007199254740993n + BigInt(index)), `12345678901234567890.${String(index + 1).padStart(20, '0')}`, `父记录-${String(index + 1).padStart(3, '0')}`]);
      await observer.query(`INSERT INTO ${parents} VALUES ?`, [values]);
      await observer.query(`CREATE TABLE ${children} (id INT PRIMARY KEY,parent_big BIGINT UNSIGNED,parent_decimal DECIMAL(40,20),note VARCHAR(80),CONSTRAINT fk_child_composite FOREIGN KEY(parent_big,parent_decimal) REFERENCES ${parents}(parent_big,parent_decimal)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${children} VALUES (1,?,?,?),(2,?,?,?)`, [values[0][0], values[0][1], '子表原值一', values[0][0], values[0][1], '子表原值二']);
      const parent = await openTable(connectionName, parentDatabase, 'reference_parents');
      await editCell(parent, 'label', '父表未提交草稿');
      await expect(parent.locator('.table-action-bar')).toContainText('1 条待提交修改');
      const child = await openTable(connectionName, database, 'reference_children');
      const choosing = await openReference(child, 'parent_big', 'choose');
      await expect(choosing.getByRole('gridcell', { name: '父记录-001', exact: true })).toBeVisible();
      await choosing.getByRole('textbox', { name: '引用记录页码', exact: true }).fill('2');
      await (await (await import('./navigation-menu')).navigationMenuItem(choosing, { name: '跳转引用页', exact: true })).click();
      await settledReferences();
      await expect(choosing.getByRole('textbox', { name: '引用记录页码', exact: true })).toHaveValue('2');
      await filterReferences(choosing, 'label', '=', '父记录-060');
      await expect(choosing.getByRole('textbox', { name: '引用记录页码', exact: true })).toHaveValue('1');
      await chooseReference(choosing, '父记录-060');
      await expect(await tableCell(child, 'parent_big')).toHaveText(values[59][0]);
      await expect(await tableCell(child, 'parent_decimal')).toHaveText(values[59][1]);
      await expect(child.locator('.table-action-bar')).toContainText('1 条待提交修改');
      const readChildren = async () => { const [rows] = await observer.query<RowDataPacket[]>(`SELECT id,CAST(parent_big AS CHAR) parent_big,CAST(parent_decimal AS CHAR) parent_decimal,note FROM ${children} ORDER BY id`); return rows; };
      expect((await readChildren()).map(row => [row.parent_big, row.parent_decimal])).toEqual([[values[0][0], values[0][1]], [values[0][0], values[0][1]]]);
      const browsing = await openReference(child, 'parent_decimal', 'browse');
      await expect(browsing.getByRole('gridcell', { name: '父记录-060', exact: true })).toBeVisible();
      await filterReferences(browsing, 'label', '=', '父记录-001');
      await expect(browsing.getByRole('gridcell')).toHaveCount(0);
      await browsing.getByRole('combobox', { name: '条件匹配方式', exact: true }).selectOption('any');
      await filterReferences(browsing, 'label', '=', '父记录-060');
      await expect(browsing.getByRole('gridcell', { name: '父记录-060', exact: true })).toBeVisible();
      await expect(browsing.getByRole('gridcell', { name: '父记录-001', exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('reference-composite-browse-any.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(browsing, { name: '关闭', exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.workspace-tab-button'), { name: 'reference_parents', exact: true })).click();
      await expect(tableTab().getByRole('gridcell', { name: '父表未提交草稿', exact: true })).toBeVisible();
      await expect(tableTab().locator('.table-action-bar')).toContainText('1 条待提交修改');
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.workspace-tab-button'), { name: 'reference_children', exact: true })).click();
      // 第二行制造真实外键错误，验证普通表格事务不会只提交前一行。
      await editCell(child, 'parent_decimal', '9.5', 3);
      let preview = await previewDraft(child);
      await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '确认提交', exact: true })).click();
      await expect(preview.locator('.error-box')).toBeVisible({ timeout: 20000 });
      expect((await readChildren()).map(row => [row.parent_big, row.parent_decimal])).toEqual([[values[0][0], values[0][1]], [values[0][0], values[0][1]]]);
      await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '返回编辑', exact: true })).click();
      await expect(child.locator('.table-action-bar')).toContainText('2 条待提交修改');
      await editCell(child, 'parent_decimal', values[0][1], 3);
      preview = await previewDraft(child); await page.screenshot({ path: testInfo.outputPath('reference-composite-submit-preview.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '确认提交', exact: true })).click();
      await expect(preview).toBeHidden({ timeout: 20000 });
      expect((await readChildren()).map(row => [row.parent_big, row.parent_decimal])).toEqual([[values[59][0], values[59][1]], [values[0][0], values[0][1]]]);
      const [parentRows] = await observer.query<RowDataPacket[]>(`SELECT label FROM ${parents} WHERE parent_big=? AND parent_decimal=?`, [values[0][0], values[0][1]]);
      expect(parentRows[0].label).toBe('父记录-001');
    }, testInfo);
  });

  test('BINARY、BIT 键与文本排序规则保真，原型同名列和只读子表可浏览，NULL 与默认值不变成无条件查询', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const binaryParent = qualified(database, 'binary_parent'), binaryChild = qualified(database, 'binary_child');
      const textParent = qualified(database, 'text_parent'), textChild = qualified(database, 'text_child'), readonlyChild = qualified(database, 'readonly_child');
      await observer.query(`CREATE TABLE ${binaryParent} (binary_key BINARY(2) PRIMARY KEY,label VARCHAR(50)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${binaryParent} VALUES (X'00FF','二进制父一'),(X'0001','二进制父二')`);
      await observer.query(`CREATE TABLE ${binaryChild} (id INT PRIMARY KEY,binary_key BINARY(2),CONSTRAINT fk_binary FOREIGN KEY(binary_key) REFERENCES ${binaryParent}(binary_key)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${binaryChild} VALUES (1,X'00FF')`);
      let child = await openTable(connectionName, database, 'binary_child');
      let browse = await openReference(child, 'binary_key', 'browse');
      await expect(browse.getByRole('gridcell', { name: '二进制父一', exact: true })).toBeVisible();
      await expect(browse.getByRole('gridcell', { name: '二进制父二', exact: true })).toHaveCount(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      await chooseReference(await openReference(child, 'binary_key', 'choose'), '二进制父二');
      await expect(await tableCell(child, 'binary_key')).toHaveText('0x0001');
      const [beforeBinary] = await observer.query<RowDataPacket[]>(`SELECT HEX(binary_key) AS value FROM ${binaryChild}`); expect(beforeBinary[0].value).toBe('00FF');
      const preview = await previewDraft(child); await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '确认提交', exact: true })).click(); await expect(preview).toBeHidden({ timeout: 20000 });
      const [afterBinary] = await observer.query<RowDataPacket[]>(`SELECT HEX(binary_key) AS value FROM ${binaryChild}`); expect(afterBinary[0].value).toBe('0001');

      // BIT 使用真实页返回的二进制值，不经 JavaScript Number 转换超安全整数。
      const bitParent = qualified(database, 'bit_parent'), bitChild = qualified(database, 'bit_child');
      await observer.query(`CREATE TABLE ${bitParent} (bit_key BIT(64) PRIMARY KEY,label VARCHAR(50)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${bitParent} VALUES (18446744073709551615,'BIT 最大无符号父记录'),(9007199254740993,'BIT 精确父记录')`);
      await observer.query(`CREATE TABLE ${bitChild} (id INT PRIMARY KEY,bit_key BIT(64),CONSTRAINT fk_bit FOREIGN KEY(bit_key) REFERENCES ${bitParent}(bit_key)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${bitChild} VALUES (1,18446744073709551615)`);
      child = await openTable(connectionName, database, 'bit_child');
      browse = await openReference(child, 'bit_key', 'browse');
      await expect(browse.getByRole('gridcell', { name: 'BIT 最大无符号父记录', exact: true })).toBeVisible();
      await expect(browse.getByRole('gridcell', { name: 'BIT 精确父记录', exact: true })).toHaveCount(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      await chooseReference(await openReference(child, 'bit_key', 'choose'), 'BIT 精确父记录');
      await expect(await tableCell(child, 'bit_key')).toHaveText('0x0020000000000001');
      const [beforeBit] = await observer.query<RowDataPacket[]>(`SELECT CAST(bit_key AS UNSIGNED) AS value FROM ${bitChild}`); expect(String(beforeBit[0].value)).toBe('18446744073709551615');
      const bitPreview = await previewDraft(child); await (await (await import('./navigation-menu')).navigationMenuItem(bitPreview, { name: '确认提交', exact: true })).click(); await expect(bitPreview).toBeHidden({ timeout: 20000 });
      const [afterBit] = await observer.query<RowDataPacket[]>(`SELECT CAST(bit_key AS UNSIGNED) AS value FROM ${bitChild}`); expect(String(afterBit[0].value)).toBe('9007199254740993');
      // 提交弹窗先关闭，表页随后才重新读取；必须等刷新结束及草稿清除后再选择最新行。
      await expect(child.locator('.toolbar').getByRole('button', { name: '刷新', exact: true })).toBeEnabled({ timeout: 20000 });
      await expect(child.locator('.loading-overlay')).toHaveCount(0);
      await expect(child.locator(':scope > .error-box')).toHaveCount(0);
      await expect(child.locator('.row-modified')).toHaveCount(0);
      await expect(await tableCell(child, 'bit_key')).toHaveText('0x0020000000000001');
      browse = await openReference(child, 'bit_key', 'browse');
      await expect(browse.getByRole('gridcell', { name: 'BIT 精确父记录', exact: true })).toBeVisible();
      await expect(browse.getByRole('gridcell', { name: 'BIT 最大无符号父记录', exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('reference-bit64-exact.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();

      await observer.query(`CREATE TABLE ${textParent} (\`__proto__\` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY,\`constructor\` VARCHAR(80)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${textParent} VALUES ('Alpha','大小写父记录'),('Beta ','尾空格父记录')`);
      await observer.query(`CREATE TABLE ${textChild} (id INT PRIMARY KEY,\`__proto__\` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,note VARCHAR(80),CONSTRAINT fk_prototype FOREIGN KEY(\`__proto__\`) REFERENCES ${textParent}(\`__proto__\`)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${textChild} VALUES (1,'alpha','原值')`);
      await observer.query(`CREATE TABLE ${readonlyChild} (id INT,\`__proto__\` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,CONSTRAINT fk_readonly FOREIGN KEY(\`__proto__\`) REFERENCES ${textParent}(\`__proto__\`)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${readonlyChild} VALUES (1,'alpha')`);
      child = await openTable(connectionName, database, 'text_child');
      browse = await openReference(child, '__proto__', 'browse');
      await expect(browse.getByRole('gridcell', { name: '大小写父记录', exact: true })).toBeVisible();
      await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      await chooseReference(await openReference(child, '__proto__', 'choose'), '尾空格父记录');
      expect(await (await tableCell(child, '__proto__')).textContent()).toBe('Beta ');
      const [beforeText] = await observer.query<RowDataPacket[]>(`SELECT HEX(\`__proto__\`) AS value FROM ${textChild}`); expect(beforeText[0].value).toBe(Buffer.from('alpha').toString('hex').toUpperCase());
      let choosing = await openReference(child, '__proto__', 'choose');
      await expect(choosing.getByRole('gridcell', { name: '大小写父记录', exact: true })).toBeVisible();
      await (await (await import('./navigation-menu')).navigationMenuItem(choosing, { name: '清空外键值', exact: true })).click();
      await (await (await import('./navigation-menu')).navigationMenuItem(choosing.getByRole('alertdialog', { name: '清空外键值', exact: true }), { name: '清空外键值', exact: true })).click();
      await expect(choosing).toBeHidden(); await expect(await tableCell(child, '__proto__')).toHaveText('NULL');
      const beforeIncomplete = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.referencePage').map(task => task.id).sort());
      browse = await openReference(child, '__proto__', 'browse');
      await expect(browse.locator('.error-box')).toContainText('当前外键值不完整');
      await expect(browse.getByRole('gridcell')).toHaveCount(0); await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.referencePage').map(task => task.id).sort())).toEqual(beforeIncomplete);
      await acceptNativeConfirmation(); await (await (await import('./navigation-menu')).navigationMenuItem(child, { name: '撤销', exact: true })).click();
      await expect(await tableCell(child, '__proto__')).toHaveText('alpha');
      await (await (await import('./navigation-menu')).navigationMenuItem(child, { name: '新增', exact: true })).click();
      browse = await openReference(child, '__proto__', 'browse', undefined, 3);
      await expect(browse.locator('.error-box')).toContainText('当前外键值不完整');
      await expect(browse.getByRole('gridcell')).toHaveCount(0); await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'table.referencePage').map(task => task.id).sort())).toEqual(beforeIncomplete);
      await (await (await import('./navigation-menu')).navigationMenuItem(child, { name: '撤销', exact: true })).click();
      const readonly = await openTable(connectionName, database, 'readonly_child');
      await (await tableCell(readonly, '__proto__')).click();
      await expect(readonly.getByRole('button', { name: '选择外键值', exact: true })).toBeDisabled();
      browse = await openReference(readonly, '__proto__', 'browse');
      await expect(browse.getByRole('gridcell', { name: '大小写父记录', exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('reference-readonly-prototype.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(browse, { name: '关闭', exact: true })).click();
      const [unchangedText] = await observer.query<RowDataPacket[]>(`SELECT HEX(\`__proto__\`) AS value FROM ${textChild}`); expect(unchangedText[0].value).toBe(beforeText[0].value);
    }, testInfo);
  });

  test('父记录被删或同名约束改指向时拒绝旧候选，源草稿与已开父表草稿保持原值', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const parentA = qualified(database, 'change_parent_a'), parentB = qualified(database, 'change_parent_b'), children = qualified(database, 'change_child');
      for (const parent of [parentA, parentB]) { await observer.query(`CREATE TABLE ${parent} (id INT PRIMARY KEY,label VARCHAR(80)) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${parent} VALUES (1,'父记录一'),(2,'父记录二')`); }
      await observer.query(`CREATE TABLE ${children} (id INT PRIMARY KEY,parent_id INT,note VARCHAR(80),CONSTRAINT fk_changed FOREIGN KEY(parent_id) REFERENCES ${parentA}(id)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${children} VALUES (1,1,'源原值')`);
      const parent = await openTable(connectionName, database, 'change_parent_a'); await editCell(parent, 'label', '父表保留草稿');
      const child = await openTable(connectionName, database, 'change_child'); await editCell(child, 'note', '源表保留草稿');
      let modal = await openReference(child, 'parent_id', 'choose');
      await modal.getByRole('gridcell', { name: '父记录二', exact: true }).click();
      await observer.query(`DELETE FROM ${parentA} WHERE id=2`);
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '使用选中关联值', exact: true })).click();
      await expect(modal.locator('.error-box')).toContainText('已不存在或外键定义发生变化', { timeout: 20000 });
      await expect(modal.getByRole('button', { name: '使用选中关联值', exact: true })).toBeDisabled();
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
      await expect(await tableCell(child, 'parent_id')).toHaveText('1'); await expect(await tableCell(child, 'note')).toHaveText('源表保留草稿');
      await observer.query(`INSERT INTO ${parentA} VALUES (2,'父记录二')`);
      modal = await openReference(child, 'parent_id', 'choose'); await modal.getByRole('gridcell', { name: '父记录二', exact: true }).click();
      // InnoDB 不保证同条 ALTER 内重用外键名；分两条确定的 DDL 完成测试用约束替换。
      await observer.query(`ALTER TABLE ${children} DROP FOREIGN KEY fk_changed`);
      await observer.query(`ALTER TABLE ${children} ADD CONSTRAINT fk_changed FOREIGN KEY(parent_id) REFERENCES ${parentB}(id)`);
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '使用选中关联值', exact: true })).click();
      await expect(modal.locator('.error-box')).toContainText('外键定义发生变化', { timeout: 20000 });
      await expect(modal.getByRole('button', { name: '使用选中关联值', exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('reference-definition-changed.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
      await expect(await tableCell(child, 'parent_id')).toHaveText('1'); await expect(await tableCell(child, 'note')).toHaveText('源表保留草稿');
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.workspace-tab-button'), { name: 'change_parent_a', exact: true })).click();
      await expect(tableTab().getByRole('gridcell', { name: '父表保留草稿', exact: true })).toBeVisible();
      const [persisted] = await observer.query<RowDataPacket[]>(`SELECT parent_id,note FROM ${children}`); expect({ ...persisted[0] }).toEqual({ parent_id: 1, note: '源原值' });
    }, testInfo);
  });

  test('多个外键明确选择，取消真实阻塞读取后任务与连接归零，普通查询事务临时表及诊断保持独立', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const parentA = qualified(database, 'cancel_parent_a'), parentB = qualified(database, 'cancel_parent_b'), children = qualified(database, 'cancel_child');
      for (const [parent, label] of [[parentA, '目标甲'], [parentB, '目标乙']]) { await observer.query(`CREATE TABLE ${parent} (id INT PRIMARY KEY,label VARCHAR(50)) ENGINE=InnoDB`); await observer.query(`INSERT INTO ${parent} VALUES (1,?)`, [label]); }
      await observer.query(`CREATE TABLE ${children} (id INT PRIMARY KEY,parent_id INT,note VARCHAR(80),CONSTRAINT fk_ref_a FOREIGN KEY(parent_id) REFERENCES ${parentA}(id),CONSTRAINT fk_ref_b FOREIGN KEY(parent_id) REFERENCES ${parentB}(id)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${children} VALUES (1,1,'源原值')`);
      await observer.query(`CREATE TABLE ${qualified(database, 'query_transaction')} (id INT PRIMARY KEY) ENGINE=InnoDB`);
      await openDatabaseQuery(database);
      await executeSql('CREATE TEMPORARY TABLE reference_session_temp (id INT PRIMARY KEY,value INT); INSERT INTO reference_session_temp VALUES (1,7); START TRANSACTION; INSERT INTO query_transaction VALUES (1); SELECT CONNECTION_ID() AS original_session;');
      const sqlTab = page.locator('.query-tab:visible');
      await (await (await import('./navigation-menu')).navigationMenuItem(sqlTab, { name: '结果 5', exact: true })).click();
      await expect(sqlTab.getByRole('columnheader', { name: /^original_session\b/ })).toBeVisible();
      const sessionCell = sqlTab.locator('.result-body [role="gridcell"][aria-colindex="2"]');
      await sessionCell.scrollIntoViewIfNeeded();
      // 虚拟行的 textContent 先于可见文字就绪；在同一次可见文字采样中等待并保存原会话编号。
      let sessionId = '';
      await expect.poll(async () => { sessionId = await sessionCell.innerText(); return sessionId; }).toMatch(/^[1-9]\d*$/);
      await page.screenshot({ path: testInfo.outputPath('reference-session-before.png') });
      await executeSql('UPDATE reference_session_temp SET value=value+1 WHERE id=1;');
      const child = await openTable(connectionName, database, 'cancel_child'); await editCell(child, 'note', '取消后保留草稿');
      let modal = await openReference(child, 'parent_id', 'browse', 'fk_ref_b');
      await expect(modal.getByRole('gridcell', { name: '目标乙', exact: true })).toBeVisible();
      await expect(modal.getByRole('gridcell', { name: '目标甲', exact: true })).toHaveCount(0);
      const beforeShortcut = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute').map(task => task.id).sort());
      // 关联窗口的快捷键不能再次执行后台查询中的 UPDATE；后续临时表值也必须仍为 8。
      await page.keyboard.press(`${modifier}+Enter`);
      expect(await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).filter(task => task.kind === 'query.execute').map(task => task.id).sort())).toEqual(beforeShortcut);
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
      const locker = await observerConnection();
      try {
        await locker.query(`LOCK TABLES ${parentA} WRITE`);
        const before = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
        modal = await openReference(child, 'parent_id', 'browse');
        await expect(modal.getByRole('combobox', { name: '外键约束', exact: true })).toHaveValue('fk_ref_a');
        await expect.poll(async () => (await matchingServerReads(observer, database, 'cancel_')).some(row => /lock/i.test(String(row.STATE))), { timeout: 20000 }).toBe(true);
        const cancelledIds = (await matchingServerReads(observer, database, 'cancel_')).map(row => Number(row.ID));
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '取消读取', exact: true })).click();
        await expect(modal.locator('.error-box')).toContainText('取消', { timeout: 20000 }); await settledReferences();
        const cancelled = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(task => !ids.includes(task.id) && task.kind === 'table.referencePage'), before);
        expect(cancelled).toHaveLength(1); expect(cancelled[0].status).toBe('cancelled');
        await expectConnectionsClosed(observer, cancelledIds);
        await page.screenshot({ path: testInfo.outputPath('reference-cancelled-real-lock.png') });
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
        // 关闭仍在真实读取中的第二个窗口，旧请求必须先释放，不能在之后覆盖新目标页。
        modal = await openReference(child, 'parent_id', 'browse');
        await expect.poll(async () => (await matchingServerReads(observer, database, 'cancel_')).some(row => /lock/i.test(String(row.STATE))), { timeout: 20000 }).toBe(true);
        const closedIds = (await matchingServerReads(observer, database, 'cancel_')).map(row => Number(row.ID));
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click(); await expect(modal).toBeHidden();
        await settledReferences(); await expectConnectionsClosed(observer, closedIds);
      } finally { try { await locker.query('UNLOCK TABLES'); } finally { await locker.end(); } }
      modal = await openReference(child, 'parent_id', 'browse', 'fk_ref_b');
      await expect(modal.getByRole('gridcell', { name: '目标乙', exact: true })).toBeVisible();
      await expect(modal.getByRole('gridcell', { name: '目标甲', exact: true })).toHaveCount(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
      await expect(await tableCell(child, 'note')).toHaveText('取消后保留草稿');
      const [beforeRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${qualified(database, 'query_transaction')}`); expect(Number(beforeRollback[0].total)).toBe(0);
      await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.workspace-tab-button'), { name: '未命名查询', exact: true })).click();
      await executeSql('SELECT ROW_COUNT() AS previous_affected, (SELECT value FROM reference_session_temp WHERE id=1) AS temp_value, CONNECTION_ID() AS current_session;');
      await expect(sqlTab.locator('.result-body [role="gridcell"][aria-colindex="2"]')).toHaveText('1');
      await expect(sqlTab.locator('.result-body [role="gridcell"][aria-colindex="3"]')).toHaveText('8');
      await expect(sqlTab.locator('.result-body [role="gridcell"][aria-colindex="4"]')).toHaveText(sessionId);
      await expect(sqlTab.locator('.tab-status')).toContainText('事务进行中');
      await page.screenshot({ path: testInfo.outputPath('reference-session-after.png') });
      await (await (await import('./navigation-menu')).navigationMenuItem(sqlTab, { name: '回滚', exact: true })).click(); await expect(sqlTab.getByRole('button', { name: '回滚', exact: true })).toBeDisabled();
      const [afterRollback] = await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${qualified(database, 'query_transaction')}`); expect(Number(afterRollback[0].total)).toBe(0);
      expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('父表权限不足时读取明确失败，可空复合外键仍可清空草稿并经预览提交', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database }) => {
      const parents = qualified(database, 'permission_parent'), children = qualified(database, 'permission_child');
      await observer.query(`CREATE TABLE ${parents} (id INT,zone INT,label VARCHAR(80),PRIMARY KEY(id,zone)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${parents} VALUES (1,7,'不可读取的父记录')`);
      await observer.query(`CREATE TABLE ${children} (id INT PRIMARY KEY,parent_id INT,parent_zone INT,note VARCHAR(80),CONSTRAINT fk_permission FOREIGN KEY(parent_id,parent_zone) REFERENCES ${parents}(id,zone)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${children} VALUES (1,1,7,'子表原值')`);
      const user = `dbark_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`, password = `D05!${randomUUID()}`;
      const connectionName = `外键限权验收 ${user}`;
      await observer.query("CREATE USER ?@'%' IDENTIFIED BY ?", [user, password]);
      try {
        await observer.query(`GRANT SELECT,UPDATE ON ${children} TO ?@'%'`, [user]);
        await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), { name: '新建连接', exact: true })).click();
        const form = page.getByRole('dialog', { name: '新建连接', exact: true });
        await form.getByLabel('连接名称', { exact: true }).fill(connectionName);
        await form.getByLabel('主机地址', { exact: true }).fill(environment.DBARK_TEST_HOST!);
        await form.getByLabel('端口', { exact: true }).fill(environment.DBARK_TEST_PORT ?? '13384');
        await form.getByLabel('用户名', { exact: true }).fill(user); await form.getByLabel('数据库密码', { exact: true }).fill(password);
        // 只关闭本临时限权账号的密码保存，不改变共享管理连接或普通账号的记忆策略。
        await form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck();
        await expect(form.getByRole('checkbox', { name: zh.connections.text016, exact: true })).not.toBeChecked();
        await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '测试连接', exact: true })).click();
        await expect(form.locator('.success-box')).toContainText('连接成功', { timeout: 20000 });
        await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '保存连接', exact: true })).click(); await expect(form).toBeHidden();
        const child = await openTable(connectionName, database, 'permission_child'); await editCell(child, 'note', '限权失败仍保留草稿');
        const modal = await openReference(child, 'parent_id', 'browse');
        await expect(modal.locator('.error-box')).toContainText(/denied|权限|无权/i, { timeout: 20000 });
        await expect(modal.getByRole('gridcell')).toHaveCount(0); await settledReferences();
        await page.screenshot({ path: testInfo.outputPath('reference-permission-denied.png') });
        await (await (await import('./navigation-menu')).navigationMenuItem(modal, { name: '关闭', exact: true })).click();
        await expect(await tableCell(child, 'note')).toHaveText('限权失败仍保留草稿');
        const persisted = async () => { const [rows] = await observer.query<RowDataPacket[]>(`SELECT parent_id,parent_zone,note FROM ${children}`); return { ...rows[0] }; };
        expect(await persisted()).toEqual({ parent_id: 1, parent_zone: 7, note: '子表原值' });
        const choosing = await openReference(child, 'parent_id', 'choose');
        await expect(choosing.locator('.error-box')).toContainText(/denied|权限|无权/i, { timeout: 20000 });
        await expect(choosing.getByRole('gridcell')).toHaveCount(0); await settledReferences();
        const beforeClear = await page.evaluate(async () => (await window.dbark.invoke('tasks.list', {})).map(task => task.id));
        // 父表 SELECT 拒绝不影响合法的清空；这里只重新读取源元数据，不能偷偷查询父候选。
        await (await (await import('./navigation-menu')).navigationMenuItem(choosing, { name: '清空外键值', exact: true })).click();
        await (await (await import('./navigation-menu')).navigationMenuItem(choosing.getByRole('alertdialog', { name: '清空外键值', exact: true }), { name: '清空外键值', exact: true })).click();
        await expect(choosing).toBeHidden({ timeout: 20000 });
        const clearTasks = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(task => !ids.includes(task.id)), beforeClear);
        expect(clearTasks.map(task => ({ kind: task.kind, status: task.status }))).toEqual([{ kind: 'metadata.table', status: 'completed' }]);
        await expect(await tableCell(child, 'parent_id')).toHaveText('NULL');
        await expect(await tableCell(child, 'parent_zone')).toHaveText('NULL');
        await expect(await tableCell(child, 'note')).toHaveText('限权失败仍保留草稿');
        await expect(child.locator('.table-action-bar')).toContainText('1 条待提交修改');
        expect(await persisted()).toEqual({ parent_id: 1, parent_zone: 7, note: '子表原值' });
        const incomplete = await openReference(child, 'parent_id', 'browse');
        await expect(incomplete.locator('.error-box')).toContainText('当前外键值不完整，没有关联记录。');
        await (await (await import('./navigation-menu')).navigationMenuItem(incomplete, { name: '关闭', exact: true })).click();
        const afterIncomplete = await page.evaluate(async ids => (await window.dbark.invoke('tasks.list', {})).filter(task => !ids.includes(task.id)), beforeClear);
        expect(afterIncomplete.map(task => task.id)).toEqual(clearTasks.map(task => task.id));
        const preview = await previewDraft(child);
        // 预览按占位 SQL 与 JSON 参数分别展示；两列必须绑定真实 null，而不是要求 SQL 字面量。
        await expect(preview.locator('.monaco-editor .view-lines')).toContainText(/SET\s+`parent_id`\s*=\s*\?,\s*`parent_zone`\s*=\s*\?/);
        await expect(preview.locator('.monaco-editor .view-lines')).toContainText('参数：[null,null,"限权失败仍保留草稿"');
        await page.screenshot({ path: testInfo.outputPath('reference-permission-clear-preview.png') });
        await (await (await import('./navigation-menu')).navigationMenuItem(preview, { name: '确认提交', exact: true })).click(); await expect(preview).toBeHidden({ timeout: 20000 });
        expect(await persisted()).toEqual({ parent_id: null, parent_zone: null, note: '限权失败仍保留草稿' });
        expect(pageErrors).toEqual([]);
      } finally {
        if (!closed) { await answerDialogs([1, 1]); await quitDesktop(); }
        if (!/^dbark_e2e_[0-9a-f]{12}$/.test(user)) throw new Error('拒绝清理非本例临时账户');
        await observer.query("DROP USER IF EXISTS ?@'%'", [user]);
        const [remaining] = await observer.query<RowDataPacket[]>('SELECT User FROM mysql.user WHERE User=?', [user]); expect(remaining).toHaveLength(0);
      }
    }, testInfo);
  });
});
