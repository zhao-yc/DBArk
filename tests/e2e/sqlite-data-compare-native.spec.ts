import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmOwnedDesktopExit, dataDir, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { sqliteDataCompareZh as text } from '../../src/shared/sqliteDataCompare';

test.skip(process.env.DBARK_SQLITE_DATA_COMPARE_NATIVE !== '1', '须显式启用 SQLite 数据比较专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });

test('在真实窗口比较同库及跨文件表，并按差异类型翻页和查看精确字段', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      process.env.DBARK_INTEGRATION_ENABLED !== '0' || ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron SQLite 比较专项');
  const { page, application } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('本例窗口归属已变化'); };
  const directory = join(dataDir, 'compare-fixture'), left = join(directory, '左侧.sqlite'), right = join(directory, '右侧.sqlite');
  await mkdir(directory);
  const create = 'CREATE TABLE ledger(id INTEGER PRIMARY KEY, value, note TEXT);';
  const insert = (text: string) => `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<26) INSERT INTO ledger SELECT i,i,'${text}' FROM n;`;
  function seed(path: string, sql: string) {
    const db = new DatabaseSync(path);
    try { db.exec(sql); } finally { db.close(); }
  }
  seed(left, create + insert('来源') + "INSERT INTO ledger VALUES(9223372036854775807,X'00FF80',NULL),(101,NULL,'仅左'); CREATE TABLE mirror(id INTEGER PRIMARY KEY, value, note TEXT); INSERT INTO mirror SELECT * FROM ledger;");
  seed(right, create + insert('目标') + "INSERT INTO ledger VALUES(9223372036854775807,X'00FF81',NULL),(102,NULL,'仅右');");
  try {
    // 仅代填系统文件选择，两条保存连接及比较操作经过真实 IPC 和 SQLite utility。
    await application.evaluate(({ dialog }, files) => {
      const original = dialog.showOpenDialog, paths = [files.left, files.right];
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (options.title !== '选择SQLite数据库文件' || !paths.length) throw Error('非本例 SQLite 文件选择');
        const path = paths.shift()!;
        if (!paths.length) dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
    }, { left, right });
    const connect = async (name: string, path: string) => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await expect(form.locator('select')).toHaveCount(1);
      await form.locator('select').selectOption('sqlite');
      await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
      await expect(form.locator('input[readonly]')).toHaveValue(basename(path));
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    };
    await connect('比较左库', left);
    await connect('比较右库', right);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: text.title, exact: true }, own)).click();
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const choose = async (label: string, profile: string, table: string) => {
      await modal.getByLabel(label + text.connection, { exact: true }).selectOption({ label: profile });
      await modal.getByLabel(label + text.table, { exact: true }).selectOption({ label: table });
    };
    await choose(text.source, '比较左库', 'ledger');
    await choose(text.target, '比较左库', 'mirror');
    const run = modal.getByRole('button', { name: text.run, exact: true });
    await run.click();
    await expect(modal.getByText(text.singleSnapshot, { exact: true })).toBeVisible();
    await expect(modal.getByRole('status')).toContainText('相同 28');

    await choose(text.target, '比较右库', 'ledger');
    await run.click();
    await expect(modal.getByText(text.splitSnapshot, { exact: true })).toBeVisible();
    await expect(modal.getByRole('status')).toContainText('仅左侧 1 · 仅右侧 1 · 字段值不同 27');
    await modal.getByLabel(text.kind, { exact: true }).selectOption('different');
    await expect(modal.getByText('1 / 2', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: text.next, exact: true }).click();
    await expect(modal.getByText('2 / 2', { exact: true })).toBeVisible();
    const precise = modal.getByRole('row').filter({ hasText: 'INTEGER 9223372036854775807' });
    await precise.getByRole('button', { name: text.detail, exact: true }).click();
    const detail = modal.getByRole('table', { name: text.detail, exact: true });
    await expect(detail).toBeInViewport();
    await expect(detail).toContainText('BLOB Base64 AP+A');
    await expect(detail).toContainText('BLOB Base64 AP+B');
    await page.screenshot({ path: info.outputPath('SQLite数据比较.png') });

    await modal.getByLabel(text.filterColumn, { exact: true }).fill('id');
    await modal.getByLabel(text.filterType, { exact: true }).selectOption('integer');
    await modal.getByLabel(text.filterValue, { exact: true }).fill('9223372036854775807');
    await run.click();
    await expect(modal.getByRole('status')).toContainText('左侧行数 1 · 右侧行数 1 · 相同 0 · 仅左侧 0 · 仅右侧 0 · 字段值不同 1');
    for (const [path, expected] of [[left, '00FF80'], [right, '00FF81']]) {
      const db = new DatabaseSync(path, { readOnly: true });
      try { expect(db.prepare('SELECT hex(value) AS value FROM ledger WHERE id=9223372036854775807').get()?.value).toBe(expected); }
      finally { db.close(); }
    }
    expect(pageErrors).toEqual([]);
    await modal.getByRole('button', { name: text.close, exact: true }).click();
    await confirmOwnedDesktopExit(info);
  } catch (error) {
    retainOwnedDesktopResources(info);
    throw error;
  }
});
