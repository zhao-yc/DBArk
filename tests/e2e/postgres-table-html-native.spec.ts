import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { postgresTableExportZh as text } from '../../src/renderer/locales/postgresTableExport.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表和视图从第二页导出全部筛选 HTML', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
    !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000});
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.html_table (id bigint PRIMARY KEY, bucket text, note text, raw bytea);
      INSERT INTO public.html_table SELECT 9007199254740993 + g, CASE WHEN g%2=1 THEN '匹配' ELSE '排除' END,
        CASE WHEN g=1 THEN '<img src=x> & 中文' WHEN g=3 THEN NULL WHEN g=5 THEN '' ELSE '行' || g END, decode('00ff','hex')
        FROM generate_series(1,18) g;
      CREATE VIEW public.html_view AS SELECT id,bucket,note,raw FROM public.html_table`);
    await mkdir(info.outputDir, {recursive: true});
    const targets = ['表数据.html', '表数据.xml', '视图数据.html', '视图数据.xml'].map(name => info.outputPath(name));
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showSaveDialog;
      let count = 0;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args[1] as Electron.SaveDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== paths[count].split('.').at(-1))
          throw Error('本例 PostgreSQL 文件选择越界');
        return {canceled: false, filePath: paths[count++]};
      }) as typeof original;
      Object.assign(globalThis, { restorePgTableHtmlPicker: () => { dialog.showSaveDialog = original; return count; } });
    }, targets);
    const connectionId = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL HTML', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    for (const [index, name] of ['html_table', 'html_view'].entries()) {
      await page.evaluate(async input => {
        const settings = await window.dbark.invoke('settings.get', {});
        await window.dbark.invoke('settings.save', { ...settings, pageSize: 2, activeTabId: input.name,
          tabs: [{ id: input.name, title: input.name, kind: 'table', connectionId: input.connectionId, database: input.database, table: '"public"."' + input.name + '"' }] });
      }, {name, connectionId, database});
      await page.reload();
      const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
      await expect(grid).toBeVisible();
      await tab.getByLabel(tableText.filterColumn, {exact: true}).selectOption('bucket');
      await tab.getByLabel(tableText.filterText, {exact: true}).fill('匹配');
      await (await navigationMenuItem(tab, {name: tableText.filter, exact: true})).click();
      await expect(grid).not.toContainText('排除');
      await grid.getByRole('columnheader').filter({hasText: /^id/}).press('Enter');
      await expect(tab.locator('.tab-status')).toContainText(tableText.activeSort(1));
      await (await navigationMenuItem(tab, {name: tableText.next, exact: true})).click();
      await expect(tab.locator('.tab-status')).toContainText(tableText.currentPage(2));
      await (await navigationMenuItem(tab, {name: text.open, exact: true})).click();
      const modal = page.getByRole('dialog', {name: text.title, exact: true});
      await expect(modal).toContainText(text.filtered);
      await modal.getByLabel(text.format, {exact: true}).selectOption('html');
      for (const column of ['id', 'bucket']) await modal.getByRole('checkbox', {name: column, exact: true}).uncheck();
      await modal.getByRole('button', {name: text.choose, exact: true}).click();
      await modal.getByRole('button', {name: text.start, exact: true}).click();
      await expect(modal.getByRole('status')).toHaveText(text.saved(9));
      const document = await page.evaluate(markup => {
        const doc = new DOMParser().parseFromString(markup, 'text/html');
        return {title: doc.title, headers: [...doc.querySelectorAll('th')].map(cell => cell.textContent),
          rows: [...doc.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => [cell.textContent, cell.dataset.kind ?? 'text'])),
          unsafe: doc.querySelectorAll('img,script,iframe').length};
      }, await readFile(targets[index * 2], 'utf8'));
      const notes = ['<img src=x> & 中文', 'NULL', '空字符串', '行7', '行9', '行11', '行13', '行15', '行17'];
      expect(document).toEqual({title: '表数据', headers: ['note', 'raw'], unsafe: 0, rows: notes.map((note, i) =>
        [[note, i === 1 ? 'null' : i === 2 ? 'empty' : 'text'], ['base64:AP8=', 'binary']])});
      if (index === 1) await modal.screenshot({path: info.outputPath('PostgreSQL视图HTML导出.png')});
      await modal.getByLabel(text.format, {exact: true}).selectOption('xml');
      await modal.getByRole('button', {name: text.choose, exact: true}).click();
      await modal.getByRole('button', {name: text.start, exact: true}).click();
      await expect(modal.getByRole('status')).toHaveText(text.saved(9));
      const xml = await page.evaluate(markup => {
        const doc = new DOMParser().parseFromString(markup, 'application/xml');
        return {scope: doc.documentElement.getAttribute('scope'), headers: [...doc.querySelectorAll('column')].map(column => column.textContent),
          rows: [...doc.querySelectorAll('record')].map(row => [...row.children].map(cell => [cell.textContent, cell.getAttribute('kind')]))};
      }, await readFile(targets[index * 2 + 1], 'utf8'));
      expect(xml).toEqual({scope: 'table', headers: ['note', 'raw'], rows: notes.map((note, i) =>
        [[i === 1 || i === 2 ? '' : note, i === 1 ? 'null' : 'text'], ['AP8=', 'binary']])});
      await modal.locator('.modal-footer').getByRole('button', {name: text.close, exact: true}).click();
      await expect(tab.locator('.tab-status')).toContainText(tableText.currentPage(2));
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgTableHtmlPicker(): number}).restorePgTableHtmlPicker())).toBe(4);
    expect((await readdir(info.outputDir)).filter(name => name.endsWith('.partial'))).toEqual([]);
    expect((await observer.query('SELECT count(*)::int AS count FROM public.html_table')).rows).toEqual([{count: 18}]);
  } finally { await observer.end(); }
});
