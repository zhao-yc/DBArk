import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { databaseSearchZh as t } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { definitionNavigationZh as navigation } from '../../src/renderer/locales/definitionNavigation.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { confirmOwnedDesktopExit, expect, ownedDesktopResources, pageErrors, retainOwnedDesktopResources, test } from './desktop-fixture';
import { navigationMenuItem } from './navigation-menu';

test.skip(process.env.DBARK_SQLITE_STRUCTURE_SEARCH_NATIVE !== '1', '仅运行隔离 SQLite 全库搜索专项');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 90_000, retries: 0 });

test('SQLite 全库搜索分页、目录和正文高亮，拒绝继续旧目录', async ({}, info) => {
  if (!['darwin', 'win32'].includes(process.platform) || info.config.workers !== 1 || info.retry ||
      ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(key => process.env[key]))
    throw Error('只允许隔离的源码 Electron 测试');
  const { application, page } = ownedDesktopResources(info);
  const own = () => { if (ownedDesktopResources(info).page !== page) throw Error('测试窗口归属已变化'); };
  const dir = await mkdtemp(join(tmpdir(), 'tabrelio-sqlite-search-'));
  const file = join(dir, 'search.sqlite');
  const write = (sql: string) => { const db = new DatabaseSync(file); try { db.exec(sql); } finally { db.close(); } };
  const bytes = async () => createHash('sha256').update(await readFile(file)).digest('hex');
  try {
    write(`PRAGMA encoding='UTF-16le';
      CREATE TABLE "对象😀"("关键_%列" TEXT);
      INSERT INTO "对象😀" VALUES ('原数据');
      CREATE INDEX "关键_%索引" ON "对象😀"("关键_%列");
      CREATE VIEW "关键_%视图" AS SELECT '定义😀针' AS value, '定义😀针' AS second;
      CREATE TRIGGER "关键_%触发器" AFTER INSERT ON "对象😀" BEGIN SELECT '触发器正文'; END;
      ${Array.from({ length: 56 }, (_, i) => 'CREATE TABLE "batch_' + String(i).padStart(2, '0') + '" (id INTEGER);').join('')}`);
    const original = await bytes();
    await application.evaluate(({ dialog }, path) => {
      let used = false;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (used || !options.properties?.includes('openFile')) throw Error('不是本例 SQLite 文件选择');
        used = true;
        return { canceled: false, filePaths: [path] };
      }) as typeof dialog.showOpenDialog;
    }, file);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill('SQLite 搜索隔离文件');
    await form.getByRole('combobox').selectOption('sqlite');
    await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    const profile = (await page.evaluate(() => window.dbark.invoke('connections.list', {})))[0];
    expect(profile.dialect).toBe('sqlite');

    const open = async () => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: t.entry, exact: true }, own)).click();
      const search = page.getByRole('dialog', { name: t.title, exact: true });
      await expect(search.getByLabel(t.databases, { exact: true })).toHaveValue('main');
      await expect(search.getByLabel(t.databases, { exact: true })).toHaveAttribute('readonly', '');
      return search;
    };
    const search = await open();
    const chooseKinds = async (...kinds: string[]) => {
      for (const label of [t.kinds.table, t.kinds.view, t.kinds.column, t.kinds.index, t.kinds.trigger]) {
        const box = page.getByRole('checkbox', { name: label, exact: true });
        if (await box.count()) await box.setChecked(kinds.includes(label));
      }
    };
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    const keyword = page.getByLabel(t.pattern, { exact: true });
    const mode = page.getByLabel(t.mode, { exact: true });
    await chooseKinds(t.kinds.table);
    await mode.selectOption('regexp');
    await keyword.fill('^BATCH_[0-9]{2}$');
    await button(t.start).click();
    await expect(search.getByRole('status')).toContainText('命中 50');
    await button(t.next).click();
    await expect(search.getByRole('status')).toContainText('命中 56');
    await expect(button(t.next)).toBeDisabled();

    await chooseKinds(t.kinds.view, t.kinds.column, t.kinds.index, t.kinds.trigger);
    await mode.selectOption('contains');
    await keyword.fill('关键_%');
    await button(t.start).click();
    for (let i = 0; i < 10; i++) {
      await expect(button(t.start)).toBeEnabled();
      if (!(await button(t.next).isEnabled())) break;
      await button(t.next).click();
    }
    await expect(search.getByRole('status')).toContainText('命中 4');
    for (const name of ['关键_%视图', '关键_%列', '关键_%索引', '关键_%触发器'])
      await expect(search.getByRole('gridcell', { name, exact: true }).last()).toBeVisible();
    await page.screenshot({ path: info.outputPath('结构名称.png') });

    await search.getByRole('gridcell', { name: '关键_%索引', exact: true }).dblclick();
    const indexViewer = page.getByRole('dialog', { name: t.definitionTitle(t.kinds.index, '关键_%索引'), exact: true });
    await expect(indexViewer.locator('.view-lines')).toContainText('CREATE INDEX');
    await indexViewer.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    await open();

    const findDefinition = async () => {
      await page.getByLabel(t.searchIn, { exact: true }).selectOption('definition');
      await chooseKinds(t.kinds.view);
      await keyword.fill('定义😀针');
      await button(t.start).click();
      await expect(page.getByRole('dialog', { name: t.definitionsTitle, exact: true }).getByRole('status')).toContainText('命中 1');
    };
    await findDefinition();
    await page.getByRole('gridcell', { name: '关键_%视图', exact: true }).dblclick();
    const viewer = page.getByRole('dialog', { name: t.definitionTitle(t.kinds.view, '关键_%视图'), exact: true });
    const navigator = viewer.getByRole('region', { name: navigation.title, exact: true });
    await expect(navigator.getByRole('status')).toContainText(navigation.count(0, 2));
    await navigator.getByRole('button', { name: navigation.next, exact: true }).click();
    await expect(navigator.getByRole('status')).toContainText(navigation.count(1, 2));
    await page.screenshot({ path: info.outputPath('定义定位.png') });
    await viewer.getByRole('button', { name: zh.common.cancel, exact: true }).click();
    expect(await bytes()).toBe(original);

    await open();
    await findDefinition();
    write(`DROP VIEW "关键_%视图"; CREATE VIEW "关键_%视图" AS SELECT '修改后的定义' AS value;`);
    await page.getByRole('gridcell', { name: '关键_%视图', exact: true }).dblclick();
    await expect(viewer.getByRole('status')).toContainText(navigation.invalid);
    await expect(navigator).toHaveCount(0);
    await viewer.getByRole('button', { name: zh.common.cancel, exact: true }).click();

    const first = await page.evaluate(connectionId => window.dbark.invoke('search.structure', {
      connectionId, taskId: crypto.randomUUID(), dialect: 'sqlite', databases: ['main'], kinds: ['table'],
      pattern: { mode: 'prefix', text: 'batch_', caseSensitive: true }, maxResults: 100, onError: 'stop',
    }), profile.id);
    expect(first.hits).toHaveLength(50);
    expect(first.cursor).toBeTruthy();
    write('CREATE TABLE catalog_changed (id INTEGER);');
    await expect(page.evaluate(({ connectionId, cursor }) => window.dbark.invoke('search.structureContinue', {
      connectionId, taskId: crypto.randomUUID(), cursor,
    }), { connectionId: profile.id, cursor: first.cursor! })).rejects.toThrow('文件或目录已变化');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    expect(pageErrors).toEqual([]);
    await confirmOwnedDesktopExit(info);
    await rm(dir, { recursive: true });
  } catch (reason) {
    retainOwnedDesktopResources(info);
    throw reason;
  }
});
