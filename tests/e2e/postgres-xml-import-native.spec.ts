import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { xmlImportZh } from '../../src/shared/xmlImport';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 表导入 XML 支持字段映射、精确数据及源文件变化回滚', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query("CREATE TABLE public.xml_subject (id bigint PRIMARY KEY, amount numeric(30,12), note text, raw bytea, marker text DEFAULT '默认值')");
    const snapshot = async () => (await observer.query("SELECT id::text, amount::text, note, encode(raw,'hex') AS raw, marker FROM public.xml_subject ORDER BY id")).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL XML', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({connectionId, database}) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'xml_subject', tabs: [
        { id: 'xml_subject', title: 'xml_subject', kind: 'table', connectionId, database, table: '"public"."xml_subject"' },
      ] });
    }, {connectionId: profile, database});
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    await expect(tab.getByRole('grid')).toBeVisible();
    await mkdir(info.outputDir, {recursive: true});
    const path = info.outputPath('混合记录.xml'), changed = info.outputPath('变化记录.xml');
    await writeFile(path, '<data><entry id="1" raw="AP8="><amount>9007199254740993.123456789012</amount><note/></entry><entry id="9223372036854775807" raw=""><amount>2.500000000000</amount><ignore>跳过</ignore></entry><entry id="3"><note>中文&#9;&#10;&#13; &quot;\\.</note></entry></data>');
    const before = '<data><entry id="4"><note>原样</note></entry></data>';
    await writeFile(changed, before);
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[1] as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== 'xml')
          throw Error('本例 PostgreSQL XML 文件选择越界');
        return { canceled: false, filePaths: [paths[count++]] };
      }) as typeof original;
      Object.assign(globalThis, {restorePgXmlPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, [path, changed]);
    const modal = page.getByRole('dialog', {name: text.title, exact: true});
    const choose = async (file: string) => {
      await (await navigationMenuItem(tab, {name: text.open, exact: true})).click();
      await modal.getByLabel(text.format, {exact: true}).selectOption('xml');
      await modal.getByLabel(xmlImportZh.rowTag, {exact: true}).fill('entry');
      await modal.getByRole('checkbox', {name: xmlImportZh.binary, exact: true}).check();
      await modal.getByRole('button', {name: text.chooseXml, exact: true}).click();
      await expect(modal).toContainText(basename(file));
    };
    const apply = () => modal.getByRole('button', {name: text.confirm, exact: true}).click();
    await choose(path);
    await expect(modal.getByLabel(text.target(4), {exact: true})).toHaveValue('');
    await expect(modal.getByRole('table', {name: text.sample, exact: true})).toContainText('9223372036854775807');
    expect(await snapshot()).toEqual([]);
    await modal.screenshot({path: info.outputPath('PostgreSQL XML 导入预览.png')});
    await apply();
    await expect(tab).toContainText('PostgreSQL 已提交导入，共 3 行');
    const committed = [
      {id: '1', amount: '9007199254740993.123456789012', note: '', raw: '00ff', marker: '默认值'},
      {id: '3', amount: null, note: '中文\t\n\r "\\.', raw: null, marker: '默认值'},
      {id: '9223372036854775807', amount: '2.500000000000', note: null, raw: '', marker: '默认值'},
    ];
    expect(await snapshot()).toEqual(committed);
    await choose(changed);
    await writeFile(changed, before.replace('id="4"', 'id="5"'));
    await apply();
    await expect(tab).toContainText('整批已回滚');
    expect(await snapshot()).toEqual(committed);
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgXmlPicker(): number}).restorePgXmlPicker())).toBe(2);
  } finally { await observer.end(); }
});
