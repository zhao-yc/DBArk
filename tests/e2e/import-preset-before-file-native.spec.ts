import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import type { RowDataPacket } from 'mysql2/promise';
import { importPresetsZh } from '../../src/renderer/locales/importPresets.zh-CN';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { txtImportZh } from '../../src/shared/txtImport';
import { test, expect, desktop, page, dataDir } from './desktop-fixture';
import { enabled, isolatedDatabase } from './live-helpers';
import { navigationMenuItem } from './navigation-menu';

test.use({trace: 'off'});

test('先应用 TXT 导入配置后选择文件，兼容后恢复映射并明确提交', async ({}, info) => {
  test.skip(!enabled || process.env.DBARK_IMPORT_PRESET_BEFORE_FILE_NATIVE !== '1', '需要本轮独占回环库');
  const port = Number(process.env.DBARK_TEST_PORT);
  if (process.env.DBARK_TEST_HOST !== '127.0.0.1' || !Number.isInteger(port) || port <= 1024 || port > 65535 ||
      !/^tabrelio-search-[a-f0-9]{12}$/.test(process.env.DBARK_MYSQL_SEARCH_CONTAINER ?? '')) throw Error('需要本轮独占回环库');
  test.setTimeout(90_000);
  await isolatedDatabase(async context => {
    await context.observer.query('USE ??', [context.database]);
    await context.observer.query('CREATE TABLE preset_target (id INT PRIMARY KEY, note TEXT) ENGINE=InnoDB');
    const bad = join(dataDir, '错误列数.txt'), good = join(dataDir, '兼容分隔文本.txt');
    await writeFile(bad, iconv.encode("2||'多列'||额外\r\n", 'gb18030'));
    await writeFile(good, iconv.encode("2||'第一条||中文'\r\n3||'第二条'\r\n", 'gb18030'));
    const name = '本例自定义 TXT 配置';
    await page.evaluate(async ({connectionId, database, name}) => {
      const saved = await window.dbark.invoke('files.importPresets.list', {});
      await window.dbark.invoke('files.importPresets.save', {generation: saved.generation, revision: saved.revision, name, configuration: {
        format: 'txt', encoding: 'gb18030', txtOptions: {mode: 'delimited', delimiter: '||', quote: 'single', recordDelimiter: 'crlf', hasHeader: false},
        columns: ['第1列', '第2列'], mapping: {第1列: 'id', 第2列: 'note'},
      }});
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', {...settings, activeTabId: 'preset-table', tabs: [
        {id: 'preset-table', title: 'preset_target', kind: 'table', connectionId, database, table: 'preset_target'},
      ]});
    }, {connectionId: context.connectionId, database: context.database, name});
    await page.reload();
    const table = page.locator('.table-tab:visible');
    await expect(table.getByRole('grid')).toBeVisible();
    await (await navigationMenuItem(table, {name: zh.common.import, exact: true})).click();
    const modal = page.getByRole('dialog', {name: zh.transfer.text004 + ' · ' + context.database + '.preset_target', exact: true});
    const presets = modal.getByRole('region', {name: importPresetsZh.title, exact: true});
    const start = modal.getByRole('button', {name: zh.transfer.text028, exact: true});
    await expect(modal.getByRole('combobox').first()).toHaveValue('csv');
    await presets.getByRole('button', {name: importPresetsZh.read, exact: true}).click();
    await presets.getByLabel(importPresetsZh.choose, {exact: true}).selectOption({label: name});
    await presets.getByRole('button', {name: importPresetsZh.apply, exact: true}).click();
    await expect(modal.getByRole('combobox').first()).toHaveValue('txt');
    await expect(modal.getByLabel(txtImportZh.custom, {exact: true})).toHaveValue('||');
    await expect(modal.getByRole('status').filter({hasText: importPresetsZh.needFile})).toBeVisible();
    await expect(start).toBeDisabled();
    for (const path of [bad, good]) {
      await desktop.evaluate(({dialog}, file) => {
        dialog.showOpenDialog = (async () => ({canceled: false, filePaths: [file]})) as typeof dialog.showOpenDialog;
      }, path);
      await modal.locator('.file-picker').click();
      if (path === bad) {
        await expect(modal.locator('.error-box')).toContainText(importPresetsZh.incompatible);
        await expect(start).toBeDisabled();
      }
    }
    const mapping = (column: string) => modal.getByLabel(formatText(zh.transfer.text020, column), {exact: true});
    await expect(mapping('第1列')).toHaveValue('id');
    await expect(mapping('第2列')).toHaveValue('note');
    await expect(modal.getByRole('status').filter({hasText: importPresetsZh.applied})).toBeVisible();
    const [before] = await context.observer.query<RowDataPacket[]>('SELECT id, note FROM preset_target');
    expect(before).toEqual([]);
    await mapping('第1列').scrollIntoViewIfNeeded();
    await modal.screenshot({path: info.outputPath('TXT 先应用配置后选择文件.png')});
    await copyFile(good, info.outputPath('导入配置 GB18030 合成样例.txt'));
    await start.click();
    await expect(modal.locator('.success-box')).toContainText('2');
    const [rows] = await context.observer.query<RowDataPacket[]>('SELECT id, note FROM preset_target ORDER BY id');
    expect(rows).toEqual([{id: 2, note: '第一条||中文'}, {id: 3, note: '第二条'}]);
  }, info);
});
