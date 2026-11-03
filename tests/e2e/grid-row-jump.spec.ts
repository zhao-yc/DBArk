import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Locator } from '@playwright/test';
import { LocalStore } from '../../src/main/storage';
import { gridRowJumpZh as text } from '../../src/renderer/locales/gridRowJump.zh-CN';
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
