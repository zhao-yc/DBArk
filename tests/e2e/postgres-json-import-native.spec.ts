import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import iconv from 'iconv-lite';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { postgresTableImportZh as text } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { navigationMenuItem } from './navigation-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 现有表导入 JSON 保留精确值、列映射和默认值，并整批回滚', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query(`CREATE TABLE public.json_subject (id bigint PRIMARY KEY, amount numeric(30,12),
      note text, raw bytea, meta jsonb, late text, marker text DEFAULT '默认值', doubled numeric GENERATED ALWAYS AS (amount * 2) STORED)`);
    const snapshot = async () => (await observer.query(`SELECT id::text, amount::text, note, encode(raw,'hex') AS raw,
      meta::text, late, marker, doubled::text FROM public.json_subject AS subject ORDER BY subject.id`)).rows;
    const profile = await page.evaluate(async input => (await window.dbark.invoke('connections.save', input)).id, {
      id: '', name: '本例 PostgreSQL JSON', dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.evaluate(async ({connectionId, database}) => {
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: 'json_subject', tabs: [
        { id: 'json_subject', title: 'json_subject', kind: 'table', connectionId, database, table: '"public"."json_subject"' },
      ] });
    }, {connectionId: profile, database});
    await page.reload();
    const tab = page.locator('.postgres-table-tab:visible');
    await expect(tab.getByRole('grid')).toBeVisible();
    await mkdir(info.outputDir, {recursive: true});
    const source = info.outputPath('GB18030 样例.json'), changed = info.outputPath('变化记录.json'), duplicate = info.outputPath('重复键.json');
    const data = '[{"id":1,"amount":9007199254740993.123456789012,"note":"","raw":{"type":"binary","base64":"AP8="},"meta":{"n":9223372036854775807},"ignore":"跳过"},{"id":9223372036854775807,"raw":{"type":"binary","base64":""},"别名":"中文尾部"}]';
    const before = '[{"id":3},{"id":4}]';
    await writeFile(source, iconv.encode(data, 'gb18030'));
    await writeFile(changed, before);
    await writeFile(duplicate, '[{"id":3},{"id":1}]');
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[1] as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== 'json')
          throw Error('仅允许本例 JSON 文件选择');
        return { canceled: false, filePaths: [paths[count++]] };
      }) as typeof original;
      Object.assign(globalThis, {restorePgJsonPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, [source, source, changed, duplicate]);
    const modal = page.getByRole('dialog', {name: text.title, exact: true});
    const choose = () => modal.getByRole('button', {name: text.chooseJson, exact: true}).click();
    const open = async () => {
      await (await navigationMenuItem(tab, {name: text.open, exact: true})).click();
      await modal.getByLabel(text.format, {exact: true}).selectOption('json');
    };
    const confirm = modal.getByRole('button', {name: text.confirm, exact: true});
    await open();
    await choose();
    await expect(modal).toContainText('导入文件字节不符合所选编码');
    await expect(confirm).toBeDisabled();
    await modal.getByLabel(text.encoding, {exact: true}).selectOption('gb18030');
    await choose();
    await expect(modal).toContainText(basename(source));
    await expect(modal).toContainText(text.records(2));
    await expect(modal.getByRole('option', {name: 'doubled', exact: true})).toHaveCount(0);
    await expect(modal.getByLabel(text.target(5), {exact: true})).toHaveValue('');
    await modal.getByLabel(text.target(6), {exact: true}).selectOption({label: 'late'});
    await expect(modal.getByRole('table', {name: text.sample, exact: true})).toContainText('9007199254740993.123456789012');
    expect(await snapshot()).toEqual([]);
    await modal.screenshot({path: info.outputPath('PostgreSQL JSON 导入映射.png')});
    await confirm.click();
    await expect(tab).toContainText('PostgreSQL 已提交导入，共 2 行');
    await expect(tab.getByRole('grid')).toContainText('中文尾部');
    const committed = [
      {id: '1', amount: '9007199254740993.123456789012', note: '', raw: '00ff', meta: '{"n": 9223372036854775807}', late: null, marker: '默认值', doubled: '18014398509481986.246913578024'},
      {id: '9223372036854775807', amount: null, note: null, raw: '', meta: null, late: '中文尾部', marker: '默认值', doubled: null},
    ];
    expect(await snapshot()).toEqual(committed);
    for (const file of [changed, duplicate]) {
      await open(); await choose();
      await expect(modal).toContainText(basename(file));
      if (file === changed) await writeFile(changed, before.replace('"id":4', '"id":5'));
      await confirm.click();
      await expect(modal).toBeHidden();
      await expect(tab).toContainText('整批已回滚');
      expect(await snapshot()).toEqual(committed);
      await tab.getByRole('button', {name: postgresTableZh.refresh, exact: true}).click();
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgJsonPicker(): number}).restorePgJsonPicker())).toBe(4);
  } finally { await observer.end(); }
});
