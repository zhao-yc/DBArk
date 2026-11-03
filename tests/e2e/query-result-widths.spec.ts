import { createRequire } from 'node:module';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from '../../src/main/storage';
import { queryResultColumnsZh as text } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { dataDir, expect, launchDesktop, page, pageErrors, quitDesktop, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('SQLite 查询结果拖动和精确输入共享列宽，恢复默认后再次执行仍用默认值', async () => {
  const id = 'offline-result-widths';
  const sql = "SELECT '短文本' AS 重复列, '长一点的文本' AS 重复列";
  // 只为独立临时配置建立一个本地只读连接，查询仍经过正式 SQLite 引擎。
  await quitDesktop();
  const databasePath = join(dataDir, 'result-widths.sqlite');
  new DatabaseSync(databasePath).close();
  const require = createRequire(join(process.cwd(), 'package.json'));
  const store = await LocalStore.open(join(dataDir, 'dbark.sqlite'), require.resolve('sql.js/dist/sql-wasm.wasm'), { available: () => false, encrypt: value => value, decrypt: value => value });
  try {
    store.saveConnection({ id, dialect: 'sqlite', name: '列宽离线测试', group: '', color: '#123456', sqlite: { filePath: realpathSync(databasePath), readOnly: true, busyTimeoutMs: 1000 } });
    store.saveSettings({ ...store.settings(), activeTabId: id, tabs: [{ id, kind: 'query', title: '列宽离线查询', connectionId: id, sql }] });
  } finally { store.close(); }
  await launchDesktop();

  const query = page.locator('.query-tab:visible');
  const headers = query.getByRole('columnheader').filter({ hasText: '重复列' });
  const modal = page.getByRole('dialog', { name: text.title, exact: true });
  const apply = modal.getByRole('button', { name: text.apply, exact: true });
  const first = modal.getByRole('textbox', { name: text.width(1), exact: true });
  const second = modal.getByRole('textbox', { name: text.width(2), exact: true });
  const width = (index: number) => headers.nth(index).evaluate(header => Math.round(header.getBoundingClientRect().width));
  const open = async () => (await navigationMenuItem(query, { name: text.open, exact: true })).click();
  const execute = async () => query.locator('.query-execute-split > button.primary').click();
  await execute();
  await expect(headers).toHaveCount(2);
  await expect.poll(() => width(0)).toBe(170);
  await open();
  await first.fill('280');
  await second.fill('63');
  await expect(apply).toBeDisabled();
  await second.fill('210');
  await apply.click();
  await expect.poll(() => width(0)).toBe(280);
  await expect.poll(() => width(1)).toBe(210);

  const handle = await headers.nth(0).locator('.rdg-resize-handle').boundingBox();
  if (!handle) throw Error('缺少首列原生拖动手柄');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  try { await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2, { steps: 5 }); }
  finally { await page.mouse.up(); }
  await expect.poll(() => width(0)).toBe(340);
  await open();
  await expect(first).toHaveValue('340');
  await expect(second).toHaveValue('210');
  await modal.getByRole('button', { name: text.resetWidths, exact: true }).click();
  await apply.click();
  await expect.poll(() => width(0)).toBe(170);
  await expect.poll(() => width(1)).toBe(170);

  await open();
  await first.fill('290');
  await apply.click();
  await expect.poll(() => width(0)).toBe(290);
  await execute();
  await expect.poll(() => width(0)).toBe(170);
  const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
  expect(history.map(entry => entry.sql)).toEqual([sql, sql]);
  expect(pageErrors).toEqual([]);
});
