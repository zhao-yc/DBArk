import { test, expect, desktop, page } from './desktop-fixture';
import { isolatedDatabase } from './live-helpers';
import { sidebarMenuItem } from './sidebar-menu';
import { mkdir, writeFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { importNewTableZh as wizardText } from '../../src/renderer/locales/importNewTable.zh-CN';
import { tableCreateZh as createText } from '../../src/renderer/locales/tableCreate.zh-CN';
import { importPreflightZh as preflight } from '../../src/renderer/locales/importPreflight.zh-CN';
import { xmlImportZh } from '../../src/shared/xmlImport';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_XML_NEW_TABLE_NATIVE !== '1', '需要本轮隔离 MySQL 或 MariaDB');
test.setTimeout(120000);

test('XML 从文件新建表独立确认建表和导入，原文件变化时保留空表', async ({}, info) => {
  const port = Number(process.env.DBARK_TEST_PORT), host = process.env.DBARK_MYSQL_SEARCH_CONTAINER;
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_TEST_HOST !== '127.0.0.1' ||
      !Number.isInteger(port) || port <= 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(process.env.DBARK_TEST_PASSWORD ?? '') ||
      !/^tabrelio-search-[a-f0-9]{12}$/.test(host ?? '')) throw Error('需要本轮回环隔离库');
  await isolatedDatabase(async ({observer, database, connectionName}) => {
    const [identity] = await observer.query<RowDataPacket[]>('SELECT @@hostname AS hostname');
    expect(identity[0].hostname).toBe(host);
    await mkdir(info.outputDir, {recursive: true});
    const files = [info.outputPath('新表记录.xml'), info.outputPath('预检后变化.xml')];
    const source = '<data><entry id="18446744073709551614" raw="AP8="><note/></entry><entry id="18446744073709551615" raw=""><late>尾部字段</late></entry></data>';
    for (const file of files) await writeFile(file, source);
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== 'xml')
          throw Error('仅允许本例 XML 文件选择');
        return { canceled: false, filePaths: [paths[count++]] };
      }) as typeof original;
      Object.assign(globalThis, {restoreXmlNewTablePicker: () => { dialog.showOpenDialog = original; return count; }});
    }, files);
    const node = page.locator('.connection-node').filter({has: page.getByRole('button', {name: connectionName, exact: true})});
    const databaseRow = node.locator('.database-row').filter({has: page.getByRole('button', {name: database, exact: true})});
    const wizard = page.getByRole('dialog', {name: wizardText.title, exact: true});
    const designer = page.getByRole('dialog', {name: formatText(zh.schema.text009, database), exact: true});
    const confirmation = page.getByRole('dialog', {name: createText.title, exact: true});
    for (const [index, table] of ['xml_created', 'xml_changed'].entries()) {
      const qualified = `\`${database}\`.\`${table}\``;
      const records = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id, HEX(raw) AS raw, note, late FROM ${qualified} ORDER BY ${qualified}.id`))[0].map(row => ({...row}));
      await (await sidebarMenuItem(databaseRow, {name: wizardText.title + ' ' + database, exact: true})).click();
      await wizard.getByLabel(wizardText.format, {exact: true}).selectOption('xml');
      await wizard.getByLabel(xmlImportZh.rowTag, {exact: true}).fill('entry');
      await wizard.getByRole('checkbox', {name: xmlImportZh.binary, exact: true}).check();
      await expect(wizard.getByLabel(wizardText.encoding, {exact: true})).toBeDisabled();
      await wizard.getByRole('button', {name: wizardText.choose, exact: true}).click();
      await expect(wizard.getByText(wizardText.records(2), {exact: true})).toBeVisible();
      await expect(wizard.getByRole('columnheader', {name: 'late', exact: true})).toBeVisible();
      await wizard.getByLabel(wizardText.table, {exact: true}).fill(table);
      await wizard.getByRole('checkbox', {name: wizardText.reviewed, exact: true}).check();
      if (index === 0) await wizard.screenshot({path: info.outputPath('XML 新表来源扫描.png')});
      await wizard.getByRole('button', {name: wizardText.design, exact: true}).click();
      for (const [position, name] of ['id', 'raw', 'note', 'late'].entries()) {
        await expect(designer.getByRole('textbox', {name: formatText(zh.schema.text018, position + 1), exact: true})).toHaveValue(name);
      }
      await designer.getByRole('textbox', {name: formatText(zh.schema.text019, 1), exact: true}).fill('BIGINT UNSIGNED');
      await designer.getByRole('textbox', {name: formatText(zh.schema.text019, 2), exact: true}).fill('BLOB');
      await designer.getByRole('button', {name: zh.schema.text049, exact: true}).click();
      await confirmation.getByRole('textbox', {name: createText.confirmation, exact: true}).fill(database + '.' + table);
      await confirmation.getByRole('checkbox', {name: createText.ackDdl, exact: true}).check();
      await confirmation.getByRole('checkbox', {name: createText.ackCreate, exact: true}).check();
      await confirmation.getByRole('button', {name: createText.apply, exact: true}).click();
      await expect(confirmation.getByText(createText.succeeded, {exact: true})).toBeVisible();
      expect(await records()).toEqual([]);
      await confirmation.getByRole('button', {name: createText.close, exact: true}).click();
      await wizard.getByRole('button', {name: wizardText.continue, exact: true}).click();
      const importer = page.getByRole('dialog', {name: zh.transfer.text004 + ' · ' + database + '.' + table, exact: true});
      const start = importer.getByRole('button', {name: zh.transfer.text028, exact: true});
      await expect(importer.getByLabel(xmlImportZh.rowTag, {exact: true})).toHaveValue('entry');
      await expect(importer.getByLabel(xmlImportZh.rowTag, {exact: true})).toBeDisabled();
      await expect(importer.getByRole('checkbox', {name: xmlImportZh.binary, exact: true})).toBeChecked();
      await expect(importer.getByRole('combobox', {name: formatText(zh.transfer.text020, 'late'), exact: true})).toHaveValue('late');
      await expect(start).toBeDisabled();
      await importer.getByRole('button', {name: preflight.run, exact: true}).click();
      await expect(importer).toContainText(preflight.summary(2, 2, 0, 0, 0));
      await expect(start).toBeEnabled();
      expect(await records()).toEqual([]);
      if (index === 1) await writeFile(files[index], source.replace('尾部字段', '改写字段'));
      await start.click();
      if (index === 0) {
        await expect(importer.locator('.success-box')).toContainText('2');
        expect(await records()).toEqual([
          { id: '18446744073709551614', raw: '00FF', note: '', late: null },
          { id: '18446744073709551615', raw: '', note: null, late: '尾部字段' },
        ]);
      } else {
        await expect(importer.locator('.error-box').last()).toContainText('整文件目标表事务已确认回滚');
        expect(await records()).toEqual([]);
      }
      await importer.getByRole('button', {name: zh.common.done, exact: true}).click();
      await expect(importer).toBeHidden();
    }
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restoreXmlNewTablePicker(): number}).restoreXmlNewTablePicker())).toBe(2);
  }, info, {captureFailureScreenshot: false});
});
