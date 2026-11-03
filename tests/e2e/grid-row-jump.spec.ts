import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { LocalStore } from '../../src/main/storage';
import { gridRowJumpZh as text } from '../../src/renderer/locales/gridRowJump.zh-CN';
import { gridColumnWidthBatchZh as batchText } from '../../src/renderer/locales/gridColumnWidthBatch.zh-CN';
import { gridRowHeightZh as heightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { sqliteTableLayoutZh as layoutText } from '../../src/renderer/locales/sqliteTableLayout.zh-CN';
import { tableGridZh } from '../../src/renderer/locales/tableGrid.zh-CN';
import { tableHeaderCopyZh } from '../../src/renderer/locales/tableHeaderCopy.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { dataDir, desktop, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

/** 使用独立应用配置和合成 SQLite 数据，查询与浏览均走正式引擎。 */
async function seed() {
  await quitDesktop();
  const id = 'row-jump-offline', databasePath = join(dataDir, 'grid-row-jump.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE subject(id INTEGER PRIMARY KEY, name TEXT);
      WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<180)
      INSERT INTO subject SELECT i, '记录 ' || i FROM seq;
      CREATE VIEW subject_view AS SELECT id,name FROM subject ORDER BY id;`);
  } finally { database.close(); }
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    store.saveConnection({ id, dialect: 'sqlite', name: '行号定位测试', group: '', color: '#123456', sqlite: { filePath: realpathSync(databasePath), readOnly: false, busyTimeoutMs: 1000 } });
    store.saveSettings({ ...store.settings(), pageSize: 100, activeTabId: 'q-jump', tabs: [
      { id: 'q-jump', kind: 'query', title: '查询定位', connectionId: id, sql: 'SELECT id, name FROM subject ORDER BY id DESC;' },
      { id: 't-jump', kind: 'table', title: '表格定位', connectionId: id, database: 'main', table: 'subject' },
      { id: 'v-jump', kind: 'table', title: '视图定位', connectionId: id, database: 'main', table: 'subject_view' },
    ] });
  } finally { store.close(); }
  await launchDesktop();
}

/** 在虚拟行尚未渲染时输入行号，并确认焦点落到真实数据格。 */
async function jump(pane: Locator, row: string, expected: string, open: () => Promise<void>) {
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toHaveCount(0);
  await open();
  const input = pane.getByRole('textbox', { name: text.row, exact: true });
  await expect(input).toBeFocused();
  await input.fill('0');
  await expect(pane.getByRole('button', { name: text.go, exact: true })).toBeDisabled();
  await input.fill(row);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(pane.getByRole('gridcell', { name: expected, exact: true })).toBeFocused();
}

/** 从 Electron 正式菜单触发当前文档命令，保留窗口现有焦点。 */
async function nativeGoto() {
  await expect.poll(() => desktop.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line')?.enabled)).toBe(true);
  await desktop.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('sql-goto-line'), windows = BrowserWindow.getAllWindows();
    if (!item?.enabled || windows.length !== 1) throw Error('跳转菜单不可用');
    item.click(item, windows[0], {} as Electron.KeyboardEvent);
  });
}

test('查询结果和 SQLite 可编辑表、只读视图可定位未渲染行且无额外数据任务', async () => {
  await seed();
  const query = page.locator('.query-tab:visible'), table = page.locator('.sqlite-table-tab:visible');
  const tasks = () => page.evaluate(() => window.dbark.invoke('tasks.list', {}));
  await query.locator('.query-execute-split > button.primary').click();
  await expect(query.getByRole('gridcell', { name: '180', exact: true })).toBeVisible();
  const open = query.getByRole('button', { name: text.open, exact: true });
  await expect(open).toBeEnabled();
  const before = await tasks();
  await query.getByRole('gridcell', { name: '180', exact: true }).focus();
  await jump(query, '120', '61', () => page.keyboard.press('Control+g'));
  expect(await tasks()).toEqual(before);
  await open.click();
  await query.getByRole('textbox', { name: text.row, exact: true }).press('Escape');
  await expect(open).toBeFocused();
  await query.locator('.monaco-editor').getByRole('textbox').focus();
  await nativeGoto();
  const editorGoto = page.locator('.quick-input-widget:visible input');
  await expect(editorGoto).toBeFocused();
  await expect(query.getByRole('textbox', { name: text.row, exact: true })).toHaveCount(0);
  await editorGoto.press('Escape');

  for (const [tab, title, readOnly] of [['t-jump', '表格定位', 'false'], ['v-jump', '视图定位', 'true']] as const) {
    await page.locator(`[data-workspace-tab-id="${tab}"]`).getByRole('button', { name: title, exact: true }).click();
    await expect(table).toHaveAttribute('data-readonly', readOnly);
    const value = (row: string) => readOnly === 'false' ? 'INTEGER · ' + row : row;
    await expect(table.getByRole('gridcell', { name: value('1'), exact: true })).toBeVisible();
    await expect(table.getByRole('button', { name: text.open, exact: true })).toBeEnabled();
    const originalTasks = await tasks();
    await table.getByRole('gridcell', { name: value('1'), exact: true }).focus();
    await jump(table, '80', value('80'), readOnly === 'false' ? nativeGoto : () => page.keyboard.press('Control+g'));
    expect(await tasks()).toEqual(originalTasks);
  }
  expect(pageErrors).toEqual([]);
});

test('SQLite 统一可见列宽保留隐藏列与冻结，并通过原保存流程写入布局', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="v-jump"]').getByRole('button', { name: '视图定位', exact: true }).click();
  const table = page.locator('.sqlite-table-tab:visible');
  await expect(table.getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
  await (await navigationMenuItem(table.locator('.toolbar'), { name: layoutText.entry, exact: true })).click();
  const modal = page.getByRole('dialog', { name: layoutText.title, exact: true });
  const idWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' id', exact: true });
  const nameWidth = modal.getByRole('spinbutton', { name: tableGridZh.width + ' name', exact: true });
  await nameWidth.fill('210');
  await modal.getByRole('checkbox', { name: tableGridZh.visible + ' name', exact: true }).uncheck();
  await modal.getByRole('button', { name: tableGridZh.freezeThrough('id'), exact: true }).click();
  await modal.getByRole('combobox', { name: heightText.label, exact: true }).selectOption('24');
  await modal.getByRole('textbox', { name: batchText.width, exact: true }).fill('240');
  await modal.getByRole('button', { name: batchText.apply, exact: true }).click();
  await expect(idWidth).toHaveValue('240');
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: batchText.fit, exact: true }).click();
  const fitted = Number(await idWidth.inputValue());
  expect(fitted).toBeGreaterThanOrEqual(64);
  expect(fitted).toBeLessThan(240);
  await expect(nameWidth).toHaveValue('210');
  await modal.getByRole('button', { name: tableGridZh.save, exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('sqlite.tableLayout.get', { connectionId: 'row-jump-offline', database: 'main', table: 'subject_view' }))).preferences).toEqual({
    version: 1, frozenThrough: 'id', rowHeight: 24, columns: [
      { name: 'id', hidden: false, width: fitted },
      { name: 'name', hidden: true, width: 210 },
    ],
  });
  await expect.poll(() => table.locator('.results-grid .rdg-row').first().evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(24);
  expect(pageErrors).toEqual([]);
});

test('SQLite 可编辑网格支持含列名及当前列复制，内部 MIME 保持原数据行', async () => {
  await seed();
  await page.locator('[data-workspace-tab-id="t-jump"]').getByRole('button', { name: '表格定位', exact: true }).click();
  const pane = page.locator('.sqlite-table-tab:visible');
  const copy = pane.getByRole('button', { name: tableHeaderCopyZh.action, exact: true });
  const copyColumn = pane.getByRole('button', { name: tableHeaderCopyZh.column, exact: true });
  const idCell = (id: number) => pane.getByRole('gridcell', { name: `INTEGER · ${id}`, exact: true });
  await expect(pane).toHaveAttribute('data-readonly', 'false');
  await expect(idCell(1)).toBeVisible();
  // 原按钮和复制事件都运行真实实现，只将系统复制端口换成本例内存 DataTransfer。
  await page.evaluate(() => {
    const previous = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const transfers: DataTransfer[] = [];
    Object.defineProperty(document, 'execCommand', { configurable: true, value(command: string) {
      if (command !== 'copy') throw Error('拒绝本例外的命令');
      const data = new DataTransfer();
      document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
      transfers.push(data);
      return true;
    } });
    Object.assign(globalThis, { __headerCopyTest: { transfers, restore() {
      if (previous) Object.defineProperty(document, 'execCommand', previous);
      else Reflect.deleteProperty(document, 'execCommand');
      Reflect.deleteProperty(globalThis, '__headerCopyTest');
    } } });
  });
  try {
    await expect(copyColumn).toBeDisabled();
    await idCell(1).click();
    await copy.click();
    await copyColumn.click();
    for (const id of [2, 1]) {
      await idCell(id).locator('..').getByRole('checkbox', { name: '勾选 SQLite 记录', exact: true }).check();
    }
    await copy.click();
    await idCell(1).click();
    await copyColumn.click();
    const result = await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { transfers: DataTransfer[] } }).__headerCopyTest.transfers.map(data => ({
      text: data.getData('text/plain'), typed: JSON.parse(data.getData('application/x-dbark-cells')), sqlite: JSON.parse(data.getData('application/x-dbark-sqlite-cells')),
    })));
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ text: 'id\n1', typed: { rows: [['1']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }]] } });
    expect(result[1]).toMatchObject({ text: Array.from({ length: 100 }, (_, index) => index + 1).join('\n'), sqlite: { columns: ['id'] } });
    expect(result[1].sqlite.rows).toEqual(Array.from({ length: 100 }, (_, index) => [{ kind: 'integer', value: String(index + 1) }]));
    expect(result[2]).toMatchObject({ text: 'id\tname\n1\t记录 1\n2\t记录 2', typed: { rows: [['1', '记录 1'], ['2', '记录 2']] }, sqlite: { columns: ['id', 'name'] } });
    expect(result[2].sqlite.rows).toHaveLength(2);
    expect(result[3]).toMatchObject({ text: '1\n2', typed: { rows: [['1'], ['2']] }, sqlite: { columns: ['id'], rows: [[{ kind: 'integer', value: '1' }], [{ kind: 'integer', value: '2' }]] } });
    expect(pageErrors).toEqual([]);
  } finally {
    await page.evaluate(() => (globalThis as typeof globalThis & { __headerCopyTest: { restore(): void } }).__headerCopyTest.restore());
  }
});
