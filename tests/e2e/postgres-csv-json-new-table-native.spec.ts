import { excelImportZh } from '../../src/shared/excelTransfer';
import { writeXlsxImportFixture } from '../helpers/xlsxImportFixture';
import { test, expect, desktop, page } from './desktop-fixture';
import { Client } from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { importNewTableZh as wizardText } from '../../src/renderer/locales/importNewTable.zh-CN';
import { postgresCreateTableZh as designText } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { postgresTableImportZh as importText } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { txtImportZh } from '../../src/shared/txtImport';
import { sidebarMenuItem } from './sidebar-menu';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_POSTGRES_WORKSPACE_NATIVE !== '1', '需要本轮隔离 PostgreSQL');

test('PostgreSQL 从 CSV、精确 JSON 和分隔 TXT 新建表，文件变化时保留空表', async ({}, info) => {
  const user = process.env.DBARK_POSTGRES_TEST_USER ?? '', database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '';
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(user) || database !== user ||
      !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('需要本轮独占回环库');
  const observer = new Client({ host: '127.0.0.1', port, user, database, password, connectionTimeoutMillis: 3000 });
  await observer.connect();
  try {
    const connectionName = '本例 PostgreSQL CSV 和 JSON 新表';
    await page.evaluate(input => window.dbark.invoke('connections.save', input), {
      id: '', name: connectionName, dialect: 'postgresql' as const, group: '', color: '#123456', host: '127.0.0.1', port, user, database, password, rememberPassword: false,
    });
    await page.reload();
    const node = page.locator('.connection-node').filter({has: page.getByRole('button', {name: connectionName, exact: true})});
    await node.getByRole('button', {name: connectionName, exact: true}).click();
    const databaseRow = node.locator('.database-row').filter({has: page.getByRole('button', {name: database, exact: true})});
    const wizard = page.getByRole('dialog', {name: wizardText.title, exact: true});
    const designer = page.getByRole('dialog', {name: designText.title, exact: true});
    const importer = page.getByRole('dialog', {name: importText.title, exact: true});
    await mkdir(info.outputDir, {recursive: true});
    const csv = '\uFEFF9007199254740993;base64:AP8=;;\\N\r\n9223372036854775807;base64:;\\N;尾部字段\r\n';
    const json = '[{"id":9007199254740993,"raw":{"type":"binary","base64":"AP8="},"note":""},{"id":9223372036854775807,"raw":{"type":"binary","base64":""},"late":{"n":9007199254740993.123456789012}}]';
    const txt = 'id|raw|note|late\n9007199254740993|base64:AP8=||\\N\n9223372036854775807|base64:|\\N|尾部字段\n';
    const scenarios = [
      {format: 'csv', table: 'csv_created', content: Buffer.from(csv, 'utf16le')},
      {format: 'json', table: 'json_created', content: json},
      {format: 'txt', table: 'txt_created', content: txt},
      {format: 'xlsx', table: 'xlsx_created', content: ''},
      {format: 'json', table: 'json_changed', content: json},
    ] as const;
    const paths = scenarios.map(({format, table}) => info.outputPath(`${table}.${format}`));
    for (const [index, path] of paths.entries()) {
      if (scenarios[index].format !== 'xlsx') await writeFile(path, scenarios[index].content);
      else await writeXlsxImportFixture(path, ['id', 'raw', 'note', 'late'], [
        ['9007199254740993', '\\B:AP8=', '', null], ['9223372036854775807', '\\B:', null, '尾部字段'],
      ]);
    }
    await desktop.evaluate(({dialog, BrowserWindow}, files) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const path = files[count];
        const options = args[1] as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !path || !path.endsWith('.' + options.filters?.[0]?.extensions[0]))
          throw Error('仅允许本例 CSV、JSON 和 TXT 文件选择');
        count++;
        return { canceled: false, filePaths: [path] };
      }) as typeof original;
      Object.assign(globalThis, {restorePgCsvJsonPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, paths);
    for (const [index, {format, table}] of scenarios.entries()) {
      const qualified = `"public"."${table}"`;
      const records = async () => (await observer.query(`SELECT id::text, encode(raw,'hex') AS raw, note, late FROM ${qualified} ORDER BY ${qualified}.id`)).rows;
      await (await sidebarMenuItem(databaseRow, {name: wizardText.title + ' ' + database, exact: true})).click();
      await wizard.getByLabel(wizardText.format, {exact: true}).selectOption(format);
      if (format === 'csv') {
        await wizard.getByLabel(wizardText.encoding, {exact: true}).selectOption('utf16le');
        await wizard.getByLabel(wizardText.delimiter, {exact: true}).selectOption(';');
        await wizard.getByRole('checkbox', {name: wizardText.header, exact: true}).uncheck();
      } else if (format === 'txt') {
        await wizard.getByLabel(txtImportZh.delimiter, {exact: true}).selectOption('|');
        await wizard.getByRole('checkbox', {name: txtImportZh.hasHeader, exact: true}).check();
      } else if (format === 'xlsx') {
        await wizard.getByRole('button', {name: excelImportZh.workbook, exact: true}).click();
        await wizard.getByLabel(excelImportZh.sheet, {exact: true}).selectOption({label: '导入🚢'});
        await wizard.getByLabel(excelImportZh.header, {exact: true}).fill('2');
        await wizard.getByLabel(excelImportZh.protocol, {exact: true}).selectOption('dbark-v1');
      }
      await wizard.getByRole('button', {name: format === 'xlsx' ? excelImportZh.inspect : wizardText.choose, exact: true}).click();
      await expect(wizard.getByText(wizardText.records(2), {exact: true})).toBeVisible();
      await wizard.getByLabel(wizardText.table, {exact: true}).fill(table);
      await wizard.getByRole('checkbox', {name: wizardText.reviewed, exact: true}).check();
      await wizard.getByRole('button', {name: wizardText.design, exact: true}).click();
      await designer.getByLabel(designText.schema, {exact: true}).selectOption('public');
      const field = (n: number) => designer.getByRole('group', {name: designText.field(n), exact: true});
      if (format === 'csv') for (const [i, name] of ['id', 'raw', 'note', 'late'].entries()) {
        await expect(field(i + 1).getByLabel(designText.name, {exact: true})).toHaveValue(`第${i + 1}列`);
        await field(i + 1).getByLabel(designText.name, {exact: true}).fill(name);
      }
      await field(1).getByLabel(designText.type, {exact: true}).selectOption('bigint');
      await field(2).getByLabel(designText.type, {exact: true}).selectOption('bytea');
      await designer.getByRole('button', {name: designText.preview, exact: true}).click();
      await expect(designer.locator('pre')).toContainText('CREATE TABLE ' + qualified);
      await designer.getByRole('button', {name: designText.apply, exact: true}).click();
      await expect(wizard.getByText(qualified, {exact: false})).toBeVisible();
      expect(await records()).toEqual([]);
      await wizard.getByRole('button', {name: wizardText.continue, exact: true}).click();
      await expect(importer.getByRole('table', {name: importText.sample, exact: true})).toContainText('9223372036854775807');
      if (format === 'csv') for (const [i, label] of ['id', 'raw', 'note', 'late'].entries()) {
        await importer.getByLabel(importText.target(i), {exact: true}).selectOption({label});
      }
      const changed = table === 'json_changed';
      if (changed) await writeFile(paths[index], json.replace('9007199254740993.123456789012', '9007199254740994.123456789012'));
      else await importer.screenshot({path: info.outputPath(`${format.toUpperCase()} 新表列映射.png`)});
      await importer.getByRole('button', {name: importText.confirm, exact: true}).click();
      await expect(importer).toBeHidden();
      if (changed) {
        await expect(page.getByText('整批已回滚', {exact: false})).toBeVisible();
        expect(await records()).toEqual([]);
      } else {
        await expect(page.getByText('PostgreSQL 已提交导入，共 2 行', {exact: true})).toBeVisible();
        expect(await records()).toEqual([
          {id: '9007199254740993', raw: '00ff', note: '', late: null},
          {id: '9223372036854775807', raw: '', note: null, late: format === 'json' ? '{"n":9007199254740993.123456789012}' : '尾部字段'},
        ]);
      }
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restorePgCsvJsonPicker(): number}).restorePgCsvJsonPicker())).toBe(scenarios.length);
  } finally { await observer.end(); }
});
