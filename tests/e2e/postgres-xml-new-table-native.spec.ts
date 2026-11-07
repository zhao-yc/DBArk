import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { importNewTableZh as wizardText } from '../../src/renderer/locales/importNewTable.zh-CN';
import { postgresCreateTableZh as designText } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { postgresTableImportZh as importText } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { xmlImportZh } from '../../src/shared/xmlImport';
import { sidebarMenuItem } from './sidebar-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('从 XML 新建 PostgreSQL 表时独立确认建表和写入，源变化时保留空表', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    await observer.query('CREATE SCHEMA "XML 导入"');
    const connectionName = '本例 PostgreSQL XML 新表';
    await page.evaluate(input => window.dbark.invoke('connections.save', input), {
      id: '', name: connectionName, dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.reload();
    const node = page.locator('.connection-node').filter({has: page.getByRole('button', {name: connectionName, exact: true})});
    await node.getByRole('button', {name: connectionName, exact: true}).click();
    const databaseRow = node.locator('.database-row').filter({has: page.getByRole('button', {name: database, exact: true})});
    await mkdir(info.outputDir, {recursive: true});
    const files = ['新表记录.xml', '建表后改写.xml', '映射后改写.xml'].map(name => info.outputPath(name));
    const source = '<data><entry id="9007199254740993" raw="AP8="><note/></entry><entry id="9223372036854775807" raw=""><late>尾部字段</late></entry></data>';
    for (const file of files) await writeFile(file, source);
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args[1] as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== 'xml')
          throw Error('仅允许本例 XML 文件选择');
        return { canceled: false, filePaths: [paths[count++]] };
      }) as typeof original;
      Object.assign(globalThis, {restorePgNewXmlPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, files);
    const wizard = page.getByRole('dialog', {name: wizardText.title, exact: true});
    const designer = page.getByRole('dialog', {name: designText.title, exact: true});
    const importer = page.getByRole('dialog', {name: importText.title, exact: true});
    for (const [index, table] of ['xml_created', 'xml_changed_before', 'xml_changed_after'].entries()) {
      const qualified = `"XML 导入"."${table}"`;
      const records = async () => (await observer.query(`SELECT id::text, encode(raw,'hex') AS raw, note, late FROM ${qualified} ORDER BY id`)).rows;
      await (await sidebarMenuItem(databaseRow, {name: wizardText.title + ' ' + database, exact: true})).click();
      await expect(wizard.getByLabel(wizardText.format, {exact: true})).toHaveValue('xml');
      await wizard.getByLabel(xmlImportZh.rowTag, {exact: true}).fill('entry');
      await wizard.getByRole('checkbox', {name: xmlImportZh.binary, exact: true}).check();
      await wizard.getByRole('button', {name: wizardText.choose, exact: true}).click();
      await expect(wizard.getByText(wizardText.records(2), {exact: true})).toBeVisible();
      await wizard.getByLabel(wizardText.table, {exact: true}).fill(table);
      await wizard.getByRole('checkbox', {name: wizardText.reviewed, exact: true}).check();
      expect((await observer.query('SELECT to_regclass($1) AS existing', [qualified])).rows[0].existing).toBeNull();
      await wizard.getByRole('button', {name: wizardText.design, exact: true}).click();
      await designer.getByLabel(designText.schema, {exact: true}).selectOption('XML 导入');
      const field = (n: number) => designer.getByRole('group', {name: designText.field(n), exact: true});
      await expect(field(4).getByLabel(designText.name, {exact: true})).toHaveValue('late');
      await field(1).getByLabel(designText.type, {exact: true}).selectOption('bigint');
      await field(2).getByLabel(designText.type, {exact: true}).selectOption('bytea');
      await designer.getByRole('button', {name: designText.preview, exact: true}).click();
      await expect(designer.locator('pre')).toContainText('CREATE TABLE ' + qualified);
      expect((await observer.query('SELECT to_regclass($1) AS existing', [qualified])).rows[0].existing).toBeNull();
      await designer.getByRole('button', {name: designText.apply, exact: true}).click();
      await expect(wizard.getByText(qualified, {exact: false})).toBeVisible();
      expect(await records()).toEqual([]);
      if (index === 1) await writeFile(files[index], source.replace('尾部字段', '改写字段'));
      await wizard.getByRole('button', {name: wizardText.continue, exact: true}).click();
      if (index === 1) {
        await expect(importer).toContainText('XML 源文件已变化');
        expect(await records()).toEqual([]);
        await importer.getByRole('button', {name: wizardText.close, exact: true}).click();
        continue;
      }
      await expect(importer.getByRole('table', {name: importText.sample, exact: true})).toContainText('9223372036854775807');
      await expect(importer.getByLabel(importText.target(3), {exact: true}).locator('option:checked')).toHaveText('late');
      expect(await records()).toEqual([]);
      if (index === 0) await importer.screenshot({path: info.outputPath('PostgreSQL XML 新表列映射.png')});
      if (index === 2) await writeFile(files[index], source.replace('尾部字段', '改写字段'));
      await importer.getByRole('button', {name: importText.confirm, exact: true}).click();
      await expect(importer).toBeHidden();
      if (index === 0) {
        await expect(page.getByText('PostgreSQL 已提交导入，共 2 行', {exact: true})).toBeVisible();
        expect(await records()).toEqual([
          {id: '9007199254740993', raw: '00ff', note: '', late: null},
          {id: '9223372036854775807', raw: '', note: null, late: '尾部字段'},
        ]);
      } else {
        await expect(page.getByText('整批已回滚', {exact: false})).toBeVisible();
        expect(await records()).toEqual([]);
      }
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgNewXmlPicker(): number}).restorePgNewXmlPicker())).toBe(3);
  } finally { await observer.end(); }
});
