import type { Locator } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, page, desktop, dataDir, pageErrors, quitDesktop, launchDesktop } from './desktop-fixture';
import { enabled, environment, isolatedDatabase, modifier, type LiveContext } from './live-helpers';

// 只有显式启用时才访问已核对的 200 测试实例；追踪关闭，防止记录连接表单中的临时凭据。
test.use({ trace: 'off' });
const activeTable = () => page.locator('.table-tab:visible');
const findPanel = () => activeTable().getByRole('region', { name: '当前页查找替换', exact: true });
const layoutDialog = () => page.getByRole('dialog', { name: '表列偏好', exact: true });
const q = (database: string, name: string) => `\`${database}\`.\`${name}\``;

/** 刷新对象树而非已有表页；打开动作始终来自真实对象节点。 */
async function openTable(connectionName: string, database: string, name: string) {
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  const row = connection.locator('.connection-row'); await row.hover();
  await row.getByRole('button', { name: '刷新连接', exact: true }).click();
  const databaseRow = connection.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) });
  await expect(databaseRow).toBeVisible(); await databaseRow.getByRole('button', { name: database, exact: true }).click();
  await connection.locator('.object-row').getByText(name, { exact: true }).click();
  await expect(activeTable().locator('.context-bar')).toContainText(name);
  await expect(activeTable().locator('.loading-overlay')).toHaveCount(0);
  await expect(activeTable().locator(':scope > .error-box')).toHaveCount(0);
  await expect(activeTable().locator('.results-grid')).toBeVisible();
  return activeTable();
}

/** 当前可见列的真实 aria 坐标决定编辑目标，不能假设隐藏或重排后的数据库列偏移。 */
async function cell(name: string, row = 2) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = activeTable().getByRole('columnheader', { name: new RegExp(`^${escaped}`) });
  await expect(header).toHaveCount(1);
  const index = await header.getAttribute('aria-colindex');
  if (!index) throw new Error('当前列头没有真实 aria-colindex');
  const target = activeTable().locator(`[role="row"][aria-rowindex="${row}"] [role="gridcell"][aria-colindex="${index}"]`);
  await target.scrollIntoViewIfNeeded(); return target;
}

/** 单元格键盘编辑只形成草稿；数据库是否写入由独立连接判断。 */
async function edit(name: string, value: string, row = 2) {
  await (await cell(name, row)).dblclick();
  const input = activeTable().getByRole('textbox', { name: `编辑 ${name}`, exact: true });
  await input.fill(value); await input.press('Enter');
  await expect(await cell(name, row)).toHaveText(value);
}

/** 查找每次显式设置类型及范围，避免沿用上一项选项掩盖边界。 */
async function find(value: string, column = '', kind: 'text' | 'null' | 'default' = 'text', count?: number) {
  if (!(await findPanel().isVisible())) await activeTable().getByRole('button', { name: '当前页查找替换', exact: true }).click();
  const panel = findPanel();
  await panel.getByRole('combobox', { name: '查找值类型', exact: true }).selectOption(kind);
  await panel.getByRole('combobox', { name: '查找列范围', exact: true }).selectOption(column);
  if (kind === 'text') await panel.getByRole('textbox', { name: '查找文字', exact: true }).fill(value);
  if (count !== undefined) await expect(panel).toContainText(`当前页匹配 ${count} 格；`);
  return panel;
}

/** 布局改动只能通过界面；此只读 IPC 用于确认真实持久化结果。 */
async function savedLayout(context: LiveContext, table: string) {
  return page.evaluate(target => window.dbark.invoke('table.preferences.get', target), { connectionId: context.connectionId, database: context.database, table });
}

/** 布局在标签内立即生效，保存必须明确完成后才关闭窗口。 */
async function openLayout() {
  await activeTable().getByRole('button', { name: '表列偏好', exact: true }).click();
  await expect(layoutDialog()).toBeVisible(); return layoutDialog();
}

/** 方向按钮按列名移动，无拖动坐标或绕过界面的状态注入。 */
async function moveUp(name: string, steps: number) {
  for (let step = 0; step < steps; step++) await layoutDialog().getByRole('button', { name: `前移 ${name}`, exact: true }).click();
}

/** 保存完成由真实提示确认，不用固定延时猜测本地磁盘写入。 */
async function saveAndCloseLayout() {
  await layoutDialog().getByRole('button', { name: '保存表列偏好', exact: true }).click();
  await expect(layoutDialog()).toContainText('列偏好已保存');
  await layoutDialog().getByRole('button', { name: '关闭', exact: true }).click();
  await expect(layoutDialog()).toBeHidden();
}

/** 普通表格提交保留真实 SQL 预览与确认；加载完成后另外核验新单元格。 */
async function dataPreview() {
  await activeTable().getByRole('button', { name: '预览并提交', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '确认数据修改', exact: true });
  await expect(modal.locator('.monaco-editor .view-lines')).toContainText('UPDATE'); return modal;
}

/** 系统加密不可用时只在重启后的真实连接表单重新输入临时密码，不改变布局数据。 */
async function restoreConnectionPassword(connectionName: string) {
  const info = await page.evaluate(() => window.dbark.invoke('app.info', {}));
  if (info.encryptionAvailable) return;
  const connection = page.locator('.connection-node').filter({ has: page.locator('.connection-row').getByText(connectionName, { exact: true }) });
  await connection.locator('.connection-row').hover();
  await connection.getByRole('button', { name: `编辑连接 ${connectionName}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: '编辑连接', exact: true });
  await form.getByLabel('数据库密码', { exact: true }).fill(environment.DBARK_TEST_PASSWORD ?? '');
  await form.getByRole('button', { name: '保存连接', exact: true }).click(); await expect(form).toBeHidden();
}

test.describe('当前页查找替换与列偏好：真实 MySQL UI', () => {
  test.skip(!enabled, '需要显式启用 DBARK_INTEGRATION_ENABLED，普通 CI 不访问 200 私网');
  test.setTimeout(90000);
  // 实库入口固定为本轮已核对的专用实例，环境变量不能悄悄将写入测试指向其他服务器。
  test.beforeEach(() => {
    if (enabled) { expect(environment.DBARK_TEST_HOST).toBe('192.168.31.200'); expect(Number(environment.DBARK_TEST_PORT ?? 13384)).toBe(13384); }
  });

  test('查找只含当前页，下一处定位虚拟远行远列且不加载其他页', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      const columns = Array.from({ length: 28 }, (_, index) => `c${index + 1}`);
      await observer.query(`CREATE TABLE ${q(database, 'find_wide')} (id INT PRIMARY KEY, ${columns.map(name => `\`${name}\` VARCHAR(80) NOT NULL DEFAULT ''`).join(',')}) ENGINE=InnoDB`);
      const values = Array.from({ length: 125 }, (_, index) => [index + 1, index === 89 ? '远行远列唯一中文' : index === 119 ? '只在未加载第二页' : `普通-${index + 1}`]);
      await observer.query(`INSERT INTO ${q(database, 'find_wide')} (id,c28) VALUES ?`, [values]);
      const table = await openTable(connectionName, database, 'find_wide');
      // 本例明确选取 100 行页，不把应用的默认页大小当成待验证的查找契约。
      await table.getByRole('combobox', { name: '每页行数', exact: true }).selectOption('100');
      await expect(table.getByRole('combobox', { name: '每页行数', exact: true })).toHaveValue('100');
      await expect(table.locator('.loading-overlay')).toHaveCount(0);
      await expect(table.getByRole('gridcell', { name: '远行远列唯一中文', exact: true })).toHaveCount(0);
      let panel = await find('远行远列唯一中文', '', 'text', 1);
      await panel.getByRole('button', { name: '下一处', exact: true }).click();
      const target = table.getByRole('gridcell', { name: '远行远列唯一中文', exact: true });
      await expect(target).toBeVisible(); await expect(target).toHaveAttribute('aria-selected', 'true');
      await expect(target).toHaveAttribute('aria-colindex', '30');
      await expect(table.locator('[role="row"][aria-rowindex="91"]')).toContainText('远行远列唯一中文');
      expect(await table.locator('.results-grid [role="row"]').count()).toBeLessThan(65);
      await expect(table.locator('.results-grid')).toHaveAttribute('aria-rowcount', '101');
      panel = await find('只在未加载第二页', '', 'text', 0);
      await expect(panel.getByRole('button', { name: '下一处', exact: true })).toBeDisabled();
      await expect(table.getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('1');
      await page.screenshot({ path: testInfo.outputPath('grid-find-virtual-current-page.png') });
      await table.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(table.getByRole('textbox', { name: '跳转页码', exact: true })).toHaveValue('2');
      await expect(table.locator('.loading-overlay')).toHaveCount(0);
      await find('只在未加载第二页', '', 'text', 1);
    }, testInfo);
  });

  test('草稿查找区分文字 NULL、实际 NULL、DEFAULT、二进制与精确数值和原型列', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      await observer.query(`CREATE TABLE ${q(database, 'find_types')} (id INT PRIMARY KEY AUTO_INCREMENT, value_text VARCHAR(80), \`__proto__\` VARCHAR(80), \`constructor\` VARCHAR(80), exact_big BIGINT UNSIGNED, exact_decimal DECIMAL(30,6), payload BLOB, generated_text VARCHAR(90) GENERATED ALWAYS AS (CONCAT(value_text,'生成')) STORED) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'find_types')} (id,value_text,\`__proto__\`,\`constructor\`,exact_big,exact_decimal,payload) VALUES (1,'NULL','原型中文','构造中文',18446744073709551615,12345678901234567890.123456,UNHEX('4e554c4c')),(2,NULL,'第二原型','第二构造',9007199254740993,0.000001,NULL),(3,'','第三原型','第三构造',0,0,UNHEX('00ff'))`);
      await openTable(connectionName, database, 'find_types');
      const textSearch = await find('null', 'value_text', 'text', 1);
      await textSearch.getByRole('checkbox', { name: '区分大小写', exact: true }).check();
      await expect(textSearch).toContainText('当前页匹配 0 格；');
      await textSearch.getByRole('checkbox', { name: '区分大小写', exact: true }).uncheck();
      await textSearch.getByRole('textbox', { name: '查找文字', exact: true }).fill('ULL');
      await textSearch.getByRole('checkbox', { name: '整格匹配', exact: true }).check();
      await expect(textSearch).toContainText('当前页匹配 0 格；');
      await textSearch.getByRole('checkbox', { name: '整格匹配', exact: true }).uncheck();
      await expect(textSearch).toContainText('当前页匹配 1 格；');
      await find('NULL', 'value_text', 'text', 1); await find('', 'value_text', 'null', 1);
      await find('4e554c4c', 'payload', 'text', 0); await find('NULL', 'payload', 'text', 0);
      await find('18446744073709551615', 'exact_big', 'text', 1);
      const numeric = await find('12345678901234567890.123456', 'exact_decimal', 'text', 1);
      await numeric.getByRole('textbox', { name: '替换为文字', exact: true }).fill('错误数值替换');
      await numeric.getByRole('button', { name: '预览当前页替换', exact: true }).click();
      await expect(numeric.locator('.error-box')).toContainText('没有可替换的文字单元格');
      await expect(page.getByRole('dialog', { name: '当前页替换草稿预览', exact: true })).toHaveCount(0);
      await edit('value_text', '未提交中文'); await find('未提交中文', 'value_text', 'text', 1);
      await find('原型中文', '__proto__', 'text', 1); await find('构造中文', 'constructor', 'text', 1);
      const [before] = await observer.query<RowDataPacket[]>(`SELECT value_text,CAST(exact_big AS CHAR) AS exact_big,exact_decimal,HEX(payload) AS payload FROM ${q(database, 'find_types')} WHERE id=1`);
      expect([before[0].value_text, before[0].exact_big, before[0].exact_decimal, before[0].payload]).toEqual(['NULL', '18446744073709551615', '12345678901234567890.123456', '4E554C4C']);
      await activeTable().getByRole('button', { name: '新增', exact: true }).click();
      await find('', '__proto__', 'default', 1); await find('', '__proto__', 'null', 0);
      await find('', 'value_text', 'default', 1); await find('', 'value_text', 'null', 1);
      await find('DEFAULT', '__proto__', 'text', 0);
      await (await cell('value_text')).click(); await activeTable().getByRole('button', { name: '删除', exact: true }).click();
      await find('未提交中文', 'value_text', 'text', 0);
      await page.screenshot({ path: testInfo.outputPath('grid-find-types-draft.png') });
    }, testInfo);
  });

  test('替换预览零写入且一次形成整批草稿，服务器旧值冲突回滚全部修改', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      await observer.query(`CREATE TABLE ${q(database, 'replace_conflict')} (id INT PRIMARY KEY, title VARCHAR(100), \`__proto__\` VARCHAR(100), amount DECIMAL(30,6)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'replace_conflict')} VALUES (1,'old 第一','old 原型一',12345678901234567890.123456),(2,'old 第二','old 原型二',0.000001)`);
      await openTable(connectionName, database, 'replace_conflict');
      const beforeTasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const panel = await find('old', '', 'text', 4);
      await panel.getByRole('textbox', { name: '替换为文字', exact: true }).fill('$& 新');
      await panel.getByRole('button', { name: '预览当前页替换', exact: true }).click();
      const preview = page.getByRole('dialog', { name: '当前页替换草稿预览', exact: true });
      await expect(preview).toContainText('将修改 4 格、2 行');
      await expect(preview.getByRole('cell', { name: '$& 新 原型二', exact: true })).toBeVisible();
      expect((await observer.query<RowDataPacket[]>(`SELECT title FROM ${q(database, 'replace_conflict')} ORDER BY id`))[0].map(row => row.title)).toEqual(['old 第一', 'old 第二']);
      expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual(beforeTasks);
      await page.screenshot({ path: testInfo.outputPath('grid-replace-preview-no-write.png') });
      await preview.getByRole('button', { name: '确认形成替换草稿', exact: true }).click(); await expect(preview).toBeHidden();
      await expect(activeTable().locator('.table-action-bar')).toContainText('2 条待提交修改');
      await expect(await cell('__proto__')).toHaveText('$& 新 原型一');
      expect((await observer.query<RowDataPacket[]>(`SELECT title FROM ${q(database, 'replace_conflict')} ORDER BY id`))[0].map(row => row.title)).toEqual(['old 第一', 'old 第二']);
      expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual(beforeTasks);
      const submit = await dataPreview();
      await observer.query(`UPDATE ${q(database, 'replace_conflict')} SET title='并发修改' WHERE id=2`);
      await submit.getByRole('button', { name: '确认提交', exact: true }).click();
      await expect(submit.locator('.error-box')).toContainText(/并发|已被其他/);
      const [after] = await observer.query<RowDataPacket[]>(`SELECT title,\`__proto__\` AS prototype_value,amount FROM ${q(database, 'replace_conflict')} ORDER BY id`);
      expect(after.map(row => [row.title, row.prototype_value, row.amount])).toEqual([['old 第一', 'old 原型一', '12345678901234567890.123456'], ['并发修改', 'old 原型二', '0.000001']]);
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const submitted = tasks.filter(task => task.kind === 'table.apply' && !beforeTasks.some(old => old.id === task.id));
      expect(submitted).toHaveLength(1); expect(submitted[0].status).toBe('failed');
      await expect(activeTable().locator('.table-action-bar')).toContainText('2 条待提交修改');
      await page.screenshot({ path: testInfo.outputPath('grid-replace-conflict-rollback.png') });
    }, testInfo);
  });

  test('隐藏和重排列后按可见顺序复制粘贴，隐藏键仍可靠定位且外键不串列', async ({}, testInfo) => {
    await isolatedDatabase(async context => {
      const { observer, database, connectionName } = context;
      await observer.query(`CREATE TABLE ${q(database, 'grid_parent')} (id INT PRIMARY KEY,label VARCHAR(80)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'grid_parent')} VALUES (10,'父记录十'),(20,'父记录二十')`);
      await observer.query(`CREATE TABLE ${q(database, 'grid_child')} (id INT PRIMARY KEY,parent_id INT,title VARCHAR(80),note VARCHAR(80),\`__proto__\` VARCHAR(80),CONSTRAINT grid_child_parent FOREIGN KEY(parent_id) REFERENCES ${q(database, 'grid_parent')}(id)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'grid_child')} VALUES (1,10,'标题一','隐藏备注一','原型一'),(2,20,'标题二','隐藏备注二','原型二')`);
      await openTable(connectionName, database, 'grid_child'); await (await cell('parent_id')).click();
      const layout = await openLayout();
      await layout.getByRole('checkbox', { name: '显示列 id', exact: true }).uncheck();
      await layout.getByRole('checkbox', { name: '显示列 note', exact: true }).uncheck();
      await moveUp('__proto__', 2); await saveAndCloseLayout();
      const saved = await savedLayout(context, 'grid_child');
      expect(saved?.columns.filter(column => !column.hidden).map(column => column.name)).toEqual(['parent_id', '__proto__', 'title']);
      await find('隐藏备注一', '', 'text', 0);
      await activeTable().getByRole('button', { name: '当前页查找替换', exact: true }).click();
      await expect(activeTable().getByRole('button', { name: '查看关联记录', exact: true })).toBeEnabled();
      await activeTable().getByRole('button', { name: '查看关联记录', exact: true }).click();
      const reference = page.getByRole('dialog', { name: '查看关联记录', exact: true });
      await expect(reference.getByRole('gridcell', { name: '父记录十', exact: true })).toBeVisible();
      await reference.getByRole('button', { name: '关闭', exact: true }).click();
      const first = await cell('__proto__'); await first.click();
      await expect(activeTable().getByRole('button', { name: '查看关联记录', exact: true })).toBeDisabled();
      // 真实 ClipboardEvent 走 RDG 事件处理；不依赖操作系统剪贴板权限，也不改内部草稿。
      await first.evaluate(element => { const data = new DataTransfer(); data.setData('text/plain', '原型改一\t标题改一\n原型改二\t标题改二'); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
      await expect(await cell('__proto__')).toHaveText('原型改一'); await expect(await cell('title', 3)).toHaveText('标题改二');
      await activeTable().locator('[role="row"][aria-rowindex="2"]').getByRole('checkbox').check();
      const copied = await (await cell('__proto__')).evaluate(element => { const data = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return { text: data.getData('text/plain'), typed: data.getData('application/x-dbark-cells') }; });
      expect(copied.text).toBe('10\t原型改一\t标题改一'); expect(JSON.parse(copied.typed).rows).toEqual([[10, '原型改一', '标题改一']]);
      const submit = await dataPreview(); await submit.getByRole('button', { name: '确认提交', exact: true }).click(); await expect(submit).toBeHidden({ timeout: 20000 });
      await expect(activeTable().locator('.loading-overlay')).toHaveCount(0); await expect(await cell('title')).toHaveText('标题改一');
      const [rows] = await observer.query<RowDataPacket[]>(`SELECT id,parent_id,title,note,\`__proto__\` AS prototype_value FROM ${q(database, 'grid_child')} ORDER BY id`);
      expect(rows.map(row => [row.id, row.parent_id, row.title, row.note, row.prototype_value])).toEqual([[1, 10, '标题改一', '隐藏备注一', '原型改一'], [2, 20, '标题改二', '隐藏备注二', '原型改二']]);
      await (await cell('parent_id')).click(); await openLayout(); await layoutDialog().getByRole('checkbox', { name: '显示列 parent_id', exact: true }).uncheck(); await saveAndCloseLayout();
      await expect(activeTable().getByRole('button', { name: '查看关联记录', exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('grid-visible-order-and-hidden-key.png') });
    }, testInfo);
  });

  test('列偏好关闭重开和真实重启后恢复，表结构增删调和且其他表保持默认', async ({}, testInfo) => {
    await isolatedDatabase(async context => {
      const { observer, database, connectionName } = context;
      await observer.query(`CREATE TABLE ${q(database, 'layout_saved')} (id INT PRIMARY KEY,obsolete VARCHAR(30),\`constructor\` VARCHAR(30),keep_text VARCHAR(30)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'layout_saved')} VALUES (1,'旧列','原型构造','保留内容')`);
      await observer.query(`CREATE TABLE ${q(database, 'layout_other')} LIKE ${q(database, 'layout_saved')}`);
      await observer.query(`INSERT INTO ${q(database, 'layout_other')} SELECT * FROM ${q(database, 'layout_saved')}`);
      await openTable(connectionName, database, 'layout_saved'); await openLayout();
      await layoutDialog().getByRole('checkbox', { name: '显示列 obsolete', exact: true }).uncheck();
      await moveUp('constructor', 2);
      await layoutDialog().getByRole('spinbutton', { name: '列宽 constructor', exact: true }).fill('260');
      await layoutDialog().getByRole('spinbutton', { name: '列宽 constructor', exact: true }).press('Tab');
      await saveAndCloseLayout();
      const original = await savedLayout(context, 'layout_saved');
      expect(original?.columns).toEqual([{ name: 'constructor', hidden: false, width: 260 }, { name: 'id', hidden: false }, { name: 'obsolete', hidden: true }, { name: 'keep_text', hidden: false }]);
      await page.getByRole('button', { name: '关闭 layout_saved', exact: true }).click();
      await openTable(connectionName, database, 'layout_saved'); await expect(await cell('constructor')).toHaveText('原型构造');
      await expect(activeTable().getByRole('columnheader', { name: /^obsolete/ })).toHaveCount(0);
      await page.getByRole('button', { name: '关闭 layout_saved', exact: true }).click();
      await quitDesktop(); await launchDesktop(); await restoreConnectionPassword(connectionName);
      await openTable(connectionName, database, 'layout_saved'); expect(await savedLayout(context, 'layout_saved')).toEqual(original);
      await expect(activeTable().getByRole('columnheader', { name: /^constructor/ })).toHaveAttribute('aria-colindex', '2');
      const width = await activeTable().getByRole('columnheader', { name: /^constructor/ }).boundingBox(); expect(width?.width).toBeCloseTo(260, 0);
      await openTable(connectionName, database, 'layout_other'); expect(await savedLayout(context, 'layout_other')).toBeNull();
      await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toHaveAttribute('aria-colindex', '2');
      await expect(activeTable().getByRole('columnheader', { name: /^obsolete/ })).toBeVisible();
      await observer.query(`ALTER TABLE ${q(database, 'layout_saved')} DROP COLUMN obsolete, ADD COLUMN added_text VARCHAR(30) DEFAULT '新列内容'`);
      await page.locator('.workspace-tab-button').getByRole('button', { name: 'layout_saved', exact: true }).click();
      await activeTable().getByRole('button', { name: '刷新', exact: true }).click(); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0);
      await openLayout();
      await expect(layoutDialog().getByRole('checkbox', { name: '显示列 obsolete', exact: true })).toHaveCount(0);
      await expect(layoutDialog().getByRole('checkbox', { name: '显示列 added_text', exact: true })).toBeChecked();
      await expect(layoutDialog().getByRole('spinbutton', { name: '列宽 constructor', exact: true })).toHaveValue('260');
      await saveAndCloseLayout();
      expect((await savedLayout(context, 'layout_saved'))?.columns.map(column => column.name)).toEqual(['constructor', 'id', 'keep_text', 'added_text']);
      await expect(await cell('added_text')).toHaveText('新列内容');
      await page.screenshot({ path: testInfo.outputPath('grid-layout-restart-schema-reconcile.png') });
      await openLayout(); await layoutDialog().getByRole('button', { name: '恢复默认列布局', exact: true }).click();
      await expect.poll(() => savedLayout(context, 'layout_saved')).toBeNull();
      await layoutDialog().getByRole('button', { name: '关闭', exact: true }).click();
      await expect(activeTable().getByRole('columnheader', { name: /^id/ })).toHaveAttribute('aria-colindex', '2');
      expect(pageErrors).toEqual([]);
    }, testInfo);
  });

  test('网格查找快捷键不抢单元格编辑器或模态，预览期间快捷键不提交后台草稿', async ({}, testInfo) => {
    await isolatedDatabase(async ({ observer, database, connectionName }) => {
      await observer.query(`CREATE TABLE ${q(database, 'grid_shortcuts')} (id INT PRIMARY KEY,title VARCHAR(80)) ENGINE=InnoDB`);
      await observer.query(`INSERT INTO ${q(database, 'grid_shortcuts')} VALUES (1,'键盘原文')`);
      await openTable(connectionName, database, 'grid_shortcuts'); await (await cell('title')).click();
      await page.keyboard.press(`${modifier}+f`); await expect(findPanel()).toBeVisible();
      const searchInput = findPanel().getByRole('textbox', { name: '查找文字', exact: true });
      const replacementInput = findPanel().getByRole('textbox', { name: '替换为文字', exact: true });
      await expect(searchInput).toBeFocused(); await page.keyboard.insertText('键盘原文');
      await expect(searchInput).toHaveValue('键盘原文'); await expect(findPanel()).toContainText('当前页匹配 1 格；');
      await expect(await cell('title')).toHaveText('键盘原文'); await expect(activeTable().locator('.row-modified')).toHaveCount(0);
      expect((await observer.query<RowDataPacket[]>(`SELECT title FROM ${q(database, 'grid_shortcuts')} WHERE id=1`))[0][0].title).toBe('键盘原文');
      await (await cell('title')).click(); await page.keyboard.press(`${modifier}+f`); await expect(searchInput).toBeFocused();
      await (await cell('title')).click(); await page.keyboard.press(`${modifier}+h`); await expect(replacementInput).toBeFocused();
      await page.keyboard.insertText('仅输入替换词'); await expect(replacementInput).toHaveValue('仅输入替换词');
      await expect(activeTable().locator('.row-modified')).toHaveCount(0);
      for (const kind of ['null', 'default']) {
        const kindSelect = findPanel().getByRole('combobox', { name: '查找值类型', exact: true });
        await kindSelect.selectOption(kind); await (await cell('title')).click(); await page.keyboard.press(`${modifier}+f`);
        await expect(kindSelect).toBeFocused(); await expect(searchInput).toBeDisabled();
        await (await cell('title')).click(); await page.keyboard.press(`${modifier}+h`); await expect(kindSelect).toBeFocused();
      }
      await findPanel().getByRole('combobox', { name: '查找值类型', exact: true }).selectOption('text');
      await activeTable().getByRole('button', { name: '当前页查找替换', exact: true }).click(); await expect(findPanel()).toBeHidden();
      await (await cell('title')).click(); await page.keyboard.press(`${modifier}+h`); await expect(findPanel()).toBeVisible();
      await expect(replacementInput).toBeFocused();
      await activeTable().getByRole('button', { name: '当前页查找替换', exact: true }).click(); await expect(findPanel()).toBeHidden();
      await (await cell('title')).dblclick();
      const editor = activeTable().getByRole('textbox', { name: '编辑 title', exact: true });
      await editor.fill('键盘草稿'); await editor.press(`${modifier}+f`); await expect(findPanel()).toBeHidden(); await expect(editor).toBeVisible();
      await editor.press('Enter'); await expect(await cell('title')).toHaveText('键盘草稿');
      await openLayout(); await page.keyboard.press(`${modifier}+f`); await expect(findPanel()).toBeHidden(); await expect(layoutDialog()).toBeVisible();
      await page.keyboard.press(`${modifier}+Enter`); await expect(page.getByRole('dialog', { name: '确认数据修改', exact: true })).toHaveCount(0);
      await layoutDialog().getByRole('button', { name: '关闭', exact: true }).click();
      const beforeTasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const panel = await find('键盘草稿', 'title', 'text', 1);
      await panel.getByRole('textbox', { name: '替换为文字', exact: true }).fill('替换后的草稿');
      await panel.getByRole('button', { name: '预览当前页替换', exact: true }).click();
      const replacement = page.getByRole('dialog', { name: '当前页替换草稿预览', exact: true });
      await expect(replacement).toBeVisible(); await page.keyboard.press(`${modifier}+Enter`);
      await expect(replacement).toBeVisible(); await expect(page.getByRole('dialog', { name: '确认数据修改', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual(beforeTasks);
      expect((await observer.query<RowDataPacket[]>(`SELECT title FROM ${q(database, 'grid_shortcuts')} WHERE id=1`))[0][0].title).toBe('键盘原文');
      await replacement.getByRole('button', { name: '取消', exact: true }).click(); await expect(await cell('title')).toHaveText('键盘草稿');
      await page.screenshot({ path: testInfo.outputPath('grid-modal-editor-shortcut-guard.png') });
    }, testInfo);
  });

  test('真实 CSV 原型表头映射只导入一次，列偏好不持久化单元格内容', async ({}, testInfo) => {
    await isolatedDatabase(async context => {
      const { observer, database, connectionName } = context;
      await observer.query(`CREATE TABLE ${q(database, 'prototype_import')} (id INT PRIMARY KEY,\`__proto__\` VARCHAR(100) NOT NULL,\`constructor\` VARCHAR(100) NOT NULL,note VARCHAR(150) NOT NULL) ENGINE=InnoDB`);
      await openTable(connectionName, database, 'prototype_import');
      const notes = ['D06-仅单元格秘密一-9ac43e', 'D06-仅单元格秘密二-28dce1'];
      const rows = [['原型🌊,逗号', '构造"引号', '1', notes[0]], ['原型第二行', '构造\n换行', '2', notes[1]]];
      // 文件表头顺序特意与数据库列顺序不同；只生成本例虚构数据，真实解析需保留引号和换行。
      const csv = [['__proto__', 'constructor', 'id', 'note'], ...rows].map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
      const file = testInfo.outputPath('prototype-mapping-source.csv'); await writeFile(file, csv, 'utf8');
      // 仅替换原生文件选择的返回值，授权令牌、预览、映射、文件读取和 worker 写库均保持真实。
      await desktop.evaluate(({ dialog }, path) => { dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog; }, file);
      const tasksBefore = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      await activeTable().getByRole('button', { name: '导入', exact: true }).click();
      const modal = page.getByRole('dialog', { name: `导入数据 · ${database}.prototype_import`, exact: true });
      await modal.getByRole('combobox', { name: /^文件格式/ }).selectOption('csv');
      await modal.getByRole('combobox', { name: /^文件编码/ }).selectOption('utf8');
      await expect(modal.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled();
      await modal.locator('.file-picker').click(); await expect(modal.locator('.mapping-grid')).toBeVisible();
      await expect(modal.locator('.spinner')).toHaveCount(0);
      for (const name of ['__proto__', 'constructor', 'id', 'note']) await expect(modal.getByRole('combobox', { name: `映射字段 ${name}`, exact: true })).toHaveValue(name);
      // 显式修改并恢复原型字段映射，覆盖真实手工映射构建，而非只依赖默认同名映射。
      await modal.getByRole('combobox', { name: '映射字段 __proto__', exact: true }).selectOption('');
      await modal.getByRole('combobox', { name: '映射字段 __proto__', exact: true }).selectOption('__proto__');
      await expect(modal.locator('.sample-grid').getByRole('gridcell', { name: '原型🌊,逗号', exact: true })).toBeVisible();
      expect(Number((await observer.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${q(database, 'prototype_import')}`))[0][0].n)).toBe(0);
      expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual(tasksBefore);
      await page.screenshot({ path: testInfo.outputPath('grid-prototype-import-mapping.png') });
      await modal.getByRole('button', { name: '开始导入', exact: true }).click();
      await expect(modal.locator('.success-box')).toContainText('已导入 2 行', { timeout: 20000 });
      await expect(modal.locator('.error-box')).toHaveCount(0);
      await expect(modal.getByRole('button', { name: '开始导入', exact: true })).toBeDisabled();
      const tasks = await page.evaluate(() => window.dbark.invoke('tasks.list', {}));
      const imported = tasks.filter(task => task.kind === 'files.import' && !tasksBefore.some(previous => previous.id === task.id));
      expect(imported).toHaveLength(1); expect(imported[0].status).toBe('completed');
      const [actual] = await observer.query<RowDataPacket[]>(`SELECT id,\`__proto__\` AS prototype_value,\`constructor\` AS constructor_value,note FROM ${q(database, 'prototype_import')} ORDER BY id`);
      expect(actual.map(row => [String(row.id), row.prototype_value, row.constructor_value, row.note])).toEqual(rows.map(row => [row[2], row[0], row[1], row[3]]));
      expect(actual).toHaveLength(2);
      await modal.getByRole('button', { name: '完成', exact: true }).click();
      await activeTable().getByRole('button', { name: '刷新', exact: true }).click(); await expect(activeTable().locator('.loading-overlay')).toHaveCount(0);
      await expect(await cell('__proto__')).toHaveText(rows[0][0]);
      await openLayout(); await layoutDialog().getByRole('checkbox', { name: '显示列 note', exact: true }).uncheck(); await saveAndCloseLayout();
      const saved = await savedLayout(context, 'prototype_import'); expect(saved?.columns.map(column => column.name)).toEqual(['id', '__proto__', 'constructor', 'note']);
      expect(saved?.columns.find(column => column.name === 'note')?.hidden).toBe(true);
      const persisted = JSON.stringify(saved), bytes = await readFile(join(dataDir, 'dbark.sqlite'));
      for (const note of notes) { expect(persisted).not.toContain(note); expect(bytes.includes(Buffer.from(note, 'utf8'))).toBe(false); }
      await page.screenshot({ path: testInfo.outputPath('grid-prototype-import-completed.png') });
    }, testInfo);
  });
});
