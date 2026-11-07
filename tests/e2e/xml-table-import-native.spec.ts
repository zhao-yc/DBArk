import { test, expect, desktop, page } from './desktop-fixture';
import { isolatedDatabase } from './live-helpers';
import { navigationMenuItem } from './navigation-menu';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { fileImportConflictZh as conflict } from '../../src/renderer/locales/fileImportConflict.zh-CN';
import { fileImportTransactionZh as transaction } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { importPreflightZh as preflight } from '../../src/renderer/locales/importPreflight.zh-CN';
import { xmlImportZh as xml } from '../../src/shared/xmlImport';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.skip(process.env.DBARK_XML_TABLE_IMPORT_NATIVE !== '1', '仅在本轮隔离的 MySQL 或 MariaDB 实库运行');
test.setTimeout(120000);

test('XML 表导入支持混合字段、精确值、按主键更新和解析失败回滚', async ({}, info) => {
  const port = Number(process.env.DBARK_TEST_PORT), host = process.env.DBARK_MYSQL_SEARCH_CONTAINER;
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_TEST_HOST !== '127.0.0.1' ||
      !Number.isInteger(port) || port <= 1024 || port > 65535 || !/^[a-f0-9]{64}$/.test(process.env.DBARK_TEST_PASSWORD ?? '') ||
      !/^tabrelio-search-[a-f0-9]{12}$/.test(host ?? '')) throw Error('需要本轮回环隔离库');
  await isolatedDatabase(async ({observer, database, connectionName}) => {
    const [identity] = await observer.query<RowDataPacket[]>('SELECT @@hostname AS hostname');
    expect(identity[0].hostname).toBe(host);
    const table = `\`${database}\`.xml_subject`;
    await observer.query(`CREATE TABLE ${table}(id BIGINT UNSIGNED PRIMARY KEY, amount DECIMAL(30,12), note TEXT, payload BLOB) ENGINE=InnoDB`);
    const snapshot = async () => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id, CAST(amount AS CHAR) AS amount, note, HEX(payload) AS payload FROM ${table} ORDER BY ${table}.id`))[0].map(row => ({...row}));
    await mkdir(info.outputDir, {recursive: true});
    const first = info.outputPath('混合布局.xml'), second = info.outputPath('更新布局.xml'), third = info.outputPath('源文件变化.xml');
    await writeFile(first, '<data><entry id="1" payload="AP8="><amount>9007199254740993.123456789012</amount><note/></entry><entry id="18446744073709551615"><amount>1.250000000000</amount><payload></payload></entry></data>');
    await writeFile(second, '<RECORDS><RECORD id="1" amount="2.250000000000" note="中文&#9;&#10;&#13;" payload="AQI="/></RECORDS>');
    const inserted = '<data><entry id="2"><amount>1.000000000000</amount><note>回滚</note><payload/></entry>';
    await writeFile(third, inserted + '</data>');
    await desktop.evaluate(({dialog, BrowserWindow}, paths) => {
      const original = dialog.showOpenDialog;
      let count = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (args[0] !== BrowserWindow.getAllWindows()[0] || !paths[count] || options.filters?.[0]?.extensions[0] !== 'xml')
          throw Error('仅允许本例 XML 文件选择');
        return {canceled: false, filePaths: [paths[count++]]};
      }) as typeof original;
      Object.assign(globalThis, {restoreXmlImportPicker: () => { dialog.showOpenDialog = original; return count; }});
    }, [first, second, third]);
    const node = page.locator('.connection-node').filter({has: page.getByRole('button', {name: connectionName, exact: true})});
    const object = node.locator('.object-row .tree-label').getByText('xml_subject', {exact: true});
    if (!await object.isVisible()) await node.locator('.database-row').getByRole('button', {name: database, exact: true}).click();
    await object.click();
    const tab = page.locator('.table-tab:visible');
    await expect(tab.getByRole('grid')).toBeVisible();
    const modal = page.getByRole('dialog', {name: `${zh.transfer.text004} · ${database}.xml_subject`, exact: true});
    const open = async (path: string, tag: string) => {
      await (await navigationMenuItem(tab, {name: zh.common.import, exact: true})).click();
      await modal.getByRole('combobox', {name: zh.transfer.text006, exact: true}).selectOption('xml');
      await modal.getByRole('textbox', {name: xml.rowTag, exact: true}).fill(tag);
      await modal.getByRole('checkbox', {name: xml.binary, exact: true}).check();
      await expect(modal.getByRole('combobox', {name: zh.transfer.text009, exact: true})).toBeDisabled();
      await expect(modal.getByRole('combobox', {name: transaction.label, exact: true})).toBeDisabled();
      await expect(modal.getByRole('combobox', {name: transaction.label, exact: true})).toHaveValue('atomic');
      await modal.locator('.file-picker').click();
      await expect(modal.locator('.file-picker')).toContainText(basename(path));
      for (const name of ['id', 'amount', 'note', 'payload'])
        await expect(modal.getByRole('combobox', {name: formatText(zh.transfer.text020, name), exact: true})).toHaveValue(name);
    };
    const checkFile = async (rows: number) => {
      const panel = modal.getByRole('region', {name: preflight.title, exact: true});
      await panel.getByRole('button', {name: preflight.run, exact: true}).click();
      await expect(panel).toContainText(preflight.summary(rows, rows, 0, 0, 0));
    };
    const start = () => modal.getByRole('button', {name: zh.transfer.text028, exact: true}).click();
    const close = () => modal.getByRole('button', {name: zh.common.done, exact: true}).click();
    await open(first, 'entry');
    await checkFile(2);
    expect(await snapshot()).toEqual([]);
    await modal.screenshot({path: info.outputPath('XML表导入预检.png')});
    await start();
    const initial = [
      {id: '1', amount: '9007199254740993.123456789012', note: '', payload: '00FF'},
      {id: '18446744073709551615', amount: '1.250000000000', note: null, payload: ''},
    ];
    await expect(modal.locator('.success-box')).toContainText('2');
    expect(await snapshot()).toEqual(initial);
    await close();

    await open(second, 'RECORD');
    await modal.getByRole('combobox', {name: conflict.mode, exact: true}).selectOption('upsert');
    await modal.getByRole('combobox', {name: conflict.key, exact: true}).selectOption('PRIMARY');
    await start();
    await expect(modal).toContainText(conflict.completed);
    const updated = [{id: '1', amount: '2.250000000000', note: '中文\t\n\r', payload: '0102'}, initial[1]];
    expect(await snapshot()).toEqual(updated);
    await close();

    await open(third, 'entry');
    await checkFile(1);
    // 先让一条记录跨越真实读取分块写入事务，再在后续字节触发解析失败。
    await writeFile(third, inserted + '<!--' + 'x'.repeat(70_000));
    await start();
    await expect(modal.locator('.error-box').last()).toContainText('整文件目标表事务已确认回滚');
    expect(await snapshot()).toEqual(updated);
    await close();
    expect(await desktop.evaluate(() => (globalThis as typeof globalThis & {restoreXmlImportPicker(): number}).restoreXmlImportPicker())).toBe(3);
  }, info, {captureFailureScreenshot: false});
});
