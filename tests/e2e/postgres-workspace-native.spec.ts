import { postgresSequenceZh as sequenceText } from '../../src/renderer/locales/postgresSequence.zh-CN';
import { postgresDependenciesZh as dependenciesText } from '../../src/renderer/locales/postgresDependencies.zh-CN';
import { postgresRoutineZh as routineText } from '../../src/renderer/locales/postgresRoutine.zh-CN';
import { navigationZh } from '../../src/renderer/locales/navigation.zh-CN';
import { test as base, expect } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresCreateTableZh } from '../../src/renderer/locales/postgresCreateTable.zh-CN';
import { postgresMaterializedRefreshZh as refreshText } from '../../src/renderer/locales/postgresMaterializedRefresh.zh-CN';
import { postgresViewManageZh as viewManageText } from '../../src/renderer/locales/postgresViewManage.zh-CN';
import { postgresViewEditZh as viewEditText } from '../../src/renderer/locales/postgresViewEdit.zh-CN';
import { postgresCreateViewZh as createViewText } from '../../src/renderer/locales/postgresCreateView.zh-CN';
import { postgresStructureZh } from '../../src/renderer/locales/postgresStructure.zh-CN';
import { postgresColumnEditZh } from '../../src/renderer/locales/postgresColumnEdit.zh-CN';
import { postgresIndexEditZh as indexText } from '../../src/renderer/locales/postgresIndexEdit.zh-CN';
import { postgresKeyEditZh as keyText } from '../../src/renderer/locales/postgresKeyEdit.zh-CN';
import { postgresForeignEditZh as fkText } from '../../src/renderer/locales/postgresForeignEdit.zh-CN';
import { postgresCheckEditZh as checkText } from '../../src/renderer/locales/postgresCheckEdit.zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresTableExportZh as tableExportText } from '../../src/renderer/locales/postgresTableExport.zh-CN';
import { postgresTableImportZh as tableImportText } from '../../src/renderer/locales/postgresTableImport.zh-CN';
import { csvImportHeaderZh } from '../../src/renderer/locales/csvImportHeader.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { explainSnapshotZh as snapshotText } from '../../src/shared/explainSnapshot.zh-CN';
import { decodePlanSnapshot } from '../../src/shared/explainSnapshot';
import { createQueryResultSnapshot, decodeQueryResultSnapshot, encodeQueryResultSnapshot } from '../../src/shared/queryResultSnapshot';
import { queryResultSnapshotUiZh as resultSnapshotText } from '../../src/renderer/locales/queryResultSnapshot.zh-CN';
import { csvExportZh } from '../../src/renderer/locales/csvExport.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSelectedFilterZh as selectedFilterText } from '../../src/renderer/locales/queryResultSelectedFilter.zh-CN';
import { queryResultStatisticsZh as statisticsText } from '../../src/renderer/locales/queryResultStatistics.zh-CN';
import { queryResultHistoryZh as historyText } from '../../src/renderer/locales/queryResultHistory.zh-CN';
import { queryResultPresetsZh as presetsText } from '../../src/renderer/locales/queryResultPresets.zh-CN';
import { queryResultComparisonZh as comparisonText } from '../../src/renderer/locales/queryResultComparison.zh-CN';
import { queryResultColumnsZh as columnText } from '../../src/renderer/locales/queryResultColumns.zh-CN';
import { gridRowHeightZh as heightText } from '../../src/renderer/locales/gridRowHeight.zh-CN';
import { queryRowDetailsZh as detailText } from '../../src/renderer/locales/queryRowDetails.zh-CN';
import { queryReadonlyRecordZh as recordText } from '../../src/renderer/locales/queryReadonlyRecord.zh-CN';
import { queryResultValueOptionsZh as valueText } from '../../src/renderer/locales/queryResultValueOptions.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { clickSidebarAction } from './sidebar-menu';
import { discardTestTab } from './query-close-ui';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_POSTGRES_WORKSPACE_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '默认关闭，须由本轮隔离PostgreSQL实库运行');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 仅由可核对的独占测试目标驱动真实表单、目录、编辑器与正常退出。 */
test('PostgreSQL窗口补全、建表、表页及正常退出', async ({}, info) => {
  const runtime = require('./desktop-fixture') as Runtime;
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  const { page, application } = runtime.ownedDesktopResources(info);
  const directory = runtime.dataDir, pid = application.process().pid;
  const evidence = info.outputPath('原生验收.json');
  const observations: string[] = [];
  const check = () => {
    const owner = runtime.ownedDesktopResources(info);
    if (owner.page !== page || owner.application !== application || owner.closed || runtime.dataDir !== directory ||
      info.config.workers !== 1 || info.timeout !== 120000 || info.retry !== 0) throw Error('原生测试归属或门槛已变化');
  };
  const mark = async (value: string) => {
    observations.push(value);
    await writeFile(evidence, JSON.stringify({ platform: process.platform, pid, directory, observations }, null, 2));
  };
  const tab = () => page.locator('.postgres-query:visible');
  const button = (name: string) => tab().getByRole('button', { name, exact: true });
  const execute = async () => { check(); await button(postgresZh.execute).click(); check(); };
  const edit = async (sql: string) => {
    check();
    await tab().locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.insertText(sql);
    check();
  };
  try {
    check();
    if (!['darwin', 'win32'].includes(process.platform) || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本轮专用角色及SSH回环实库');
    await mark('已捕获独占窗口归属');
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const title = '本轮 PostgreSQL 实库';
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(title);
    await form.getByRole('combobox').selectOption('postgresql');
    await expect(form.getByLabel(zh.connections.text010, { exact: true })).toHaveValue('5432');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
    await form.getByLabel(zh.connections.text012, { exact: true }).fill(database);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text034, exact: true }).click();
    await expect(form.locator('.success-box')).toContainText('连接成功 · PostgreSQL 18');
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    check();
    await mark('新建表单使用实际PostgreSQL驱动测试和保存');
    const connection = page.locator('.connection-row').filter({ hasText: title });
    await connection.locator('.tree-label').click();
    const databaseRow = page.locator('.database-row .tree-label').filter({ hasText: database });
    await databaseRow.click();
    const table = page.locator('.object-row .tree-label').filter({ hasText: '引号' });
    await table.click();
    const gridTab = page.locator('.postgres-table-tab:visible'), grid = gridTab.getByRole('grid');
    const tableButton = (name: string) => gridTab.getByRole('button', { name, exact: true });
    await expect(grid).toContainText('原值');

    /** 真实表单按字段设值，阶段操作不产生DML。 */
    const enter = async (dialog: ReturnType<typeof page.getByRole>, column: string, value: string) => {
      await dialog.getByLabel(column + ' ' + postgresTableZh.valueMode, { exact: true }).selectOption('text');
      await dialog.getByLabel(column + ' ' + postgresTableZh.value, { exact: true }).fill(value);
    };
    const add = async (id: string, note: string) => {
      await tableButton(postgresTableZh.add).click();
      const record = page.getByRole('dialog', { name: postgresTableZh.add, exact: true });
      await enter(record, 'id', id);
      await enter(record, 'note', note);
      await record.getByRole('button', { name: postgresTableZh.stage, exact: true }).click();
    };
    const editRecord = async (old: string, note: string) => {
      await grid.getByRole('gridcell', { name: old, exact: true }).click();
      await tableButton(postgresTableZh.edit).click();
      const record = page.getByRole('dialog', { name: postgresTableZh.edit, exact: true });
      await enter(record, 'note', note);
      await record.getByRole('button', { name: postgresTableZh.stage, exact: true }).click();
    };
    const commit = async () => {
      check();
      await tableButton(postgresTableZh.preview).click();
      const review = page.getByRole('dialog', { name: postgresTableZh.preview, exact: true });
      await expect(review).toContainText(postgresTableZh.previewHint);
      await review.getByRole('button', { name: postgresTableZh.apply, exact: true }).click();
      await expect(gridTab.getByRole('status')).toContainText('已确认整批提交');
      await expect(tableButton(postgresTableZh.refresh)).toBeEnabled();
      check();
    };
    await add('2', '新增甲');
    await add('3', '新增乙');
    await expect(grid).not.toContainText('新增甲');
    await commit();
    await expect(grid).toContainText('新增乙');

    await gridTab.getByRole('spinbutton', { name: postgresTableZh.pageSize, exact: true }).fill('1');
    await gridTab.getByLabel(postgresTableZh.filterColumn, { exact: true }).selectOption('note');
    await gridTab.getByLabel(postgresTableZh.filterText, { exact: true }).fill('新增');
    await tableButton(postgresTableZh.filter).click();
    await expect(grid).toContainText('新增甲');
    await expect(grid).not.toContainText('新增乙');
    await tableButton(postgresTableZh.next).click();
    await expect(grid).toContainText('新增乙');
    // 从第二页导出全部筛选记录，真实文件写入仍由原 Main 和 Engine 处理。
    const tableFile = info.outputPath('PostgreSQL原生导出.json');
    const tableSqlFile = info.outputPath('PostgreSQL原生数据.sql');
    const tableCopyFile = info.outputPath('PostgreSQL原生数据.csv');
    const tableExportOwner = await application.browserWindow(page);
    const tableExportSender = await tableExportOwner.evaluate(window => window.webContents.id);
    await tableExportOwner.dispose();
    await application.evaluate(({ BrowserWindow, dialog }, input) => {
      const original = dialog.showSaveDialog;
      const calls: string[] = [];
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const expected = BrowserWindow.getAllWindows().find(window => window.webContents.id === input.sender);
        const options = args[1] as { title?: string; defaultPath?: string; filters?: { extensions: string[] }[] };
        const extension = options.filters?.[0].extensions[0];
        if (!expected || args[0] !== expected || options.title !== input.title ||
            (extension !== 'json' && extension !== 'sql' && extension !== 'csv') || !options.defaultPath?.endsWith('.' + extension))
          throw Error('PostgreSQL 导出文件选择来源或格式不符');
        calls.push(extension);
        return { canceled: false, filePath: extension === 'sql' ? input.sqlFile : extension === 'csv' ? input.copyFile : input.file };
      }) as typeof original;
      Object.assign(globalThis, { finishPostgresTableExport: () => { dialog.showSaveDialog = original; return calls; } });
    }, { sender: tableExportSender, title: tableExportText.title, file: tableFile, sqlFile: tableSqlFile, copyFile: tableCopyFile });
    try {
      await tableButton(tableExportText.open).click();
      const tableExport = page.getByRole('dialog', { name: tableExportText.title, exact: true });
      await expect(tableExport).toContainText(tableExportText.filtered);
      await tableExport.getByLabel(tableExportText.format, { exact: true }).selectOption('json');
      await tableExport.getByRole('checkbox', { name: 'id', exact: true }).uncheck();
      await tableExport.getByRole('button', { name: tableExportText.choose, exact: true }).click();
      await expect(tableExport).toContainText('PostgreSQL原生导出.json');
      await page.screenshot({ path: info.outputPath('PostgreSQL表数据导出确认.png') });
      await tableExport.getByRole('button', { name: tableExportText.start, exact: true }).click();
      await expect(tableExport.getByRole('status')).toHaveText(tableExportText.saved(2));
      expect(JSON.parse(await readFile(tableFile, 'utf8'))).toEqual([{ note: '新增甲' }, { note: '新增乙' }]);
      await tableExport.getByLabel(tableExportText.format, { exact: true }).selectOption('sql');
      await expect(tableExport.getByLabel(tableExportText.encoding, { exact: true })).toHaveCount(0);
      await tableExport.getByRole('checkbox', { name: 'id', exact: true }).check();
      await tableExport.getByRole('button', { name: tableExportText.choose, exact: true }).click();
      await expect(tableExport).toContainText('PostgreSQL原生数据.sql');
      await page.screenshot({ path: info.outputPath('PostgreSQL表数据SQL导出确认.png') });
      await tableExport.getByRole('button', { name: tableExportText.start, exact: true }).click();
      await expect(tableExport.getByRole('status')).toHaveText(tableExportText.saved(2));
      const script = await readFile(tableSqlFile, 'utf8');
      expect(script).toContain('INSERT INTO "回归"."带""引号" ("id", "note") VALUES');
      expect(script).toContain("(E'2', E'新增甲'),\n(E'3', E'新增乙');");
      expect(script.endsWith('COMMIT;\n')).toBe(true);
      await tableExport.getByLabel(tableExportText.format, { exact: true }).selectOption('copy');
      await expect(tableExport).toContainText(tableExportText.copyHint);
      await expect(tableExport.getByLabel(tableExportText.encoding, { exact: true })).toHaveCount(0);
      await tableExport.getByRole('checkbox', { name: 'id', exact: true }).uncheck();
      await tableExport.getByRole('button', { name: tableExportText.choose, exact: true }).click();
      await expect(tableExport).toContainText('PostgreSQL原生数据.csv');
      await page.screenshot({ path: info.outputPath('PostgreSQL表数据COPY导出确认.png') });
      await tableExport.getByRole('button', { name: tableExportText.start, exact: true }).click();
      await expect(tableExport.getByRole('status')).toHaveText(tableExportText.saved(2));
      expect(await readFile(tableCopyFile, 'utf8')).toBe('note\n新增甲\n新增乙\n');
      await tableExport.locator('.modal-footer').getByRole('button', { name: tableExportText.close, exact: true }).click();
    } finally {
      const calls = await application.evaluate(() => (globalThis as unknown as { finishPostgresTableExport(): string[] }).finishPostgresTableExport());
      expect(calls).toEqual(['json', 'sql', 'csv']);
    }
    await mark('原生窗口从筛选第二页导出全范围 JSON、SQL 和 COPY CSV，实际文件各含两个匹配记录');
    await tableButton(postgresTableZh.clearFilter).click();
    await expect(grid).toContainText('原值');
    await gridTab.getByRole('spinbutton', { name: postgresTableZh.pageSize, exact: true }).fill('20');
    await tableButton(postgresTableZh.refresh).click();
    await expect(grid).toContainText('新增乙');

    // 真实表页选择本机文件并手动映射不同名列，写入仅发生在显式确认后。
    const importFile = info.outputPath('PostgreSQL导入源.csv');
    const noHeaderFile = info.outputPath('PostgreSQL无表头导入源.csv');
    await writeFile(importFile, '\uFEFF内容;编号\r\n"窗口;CSV";4\r\n', 'utf8');
    await writeFile(noHeaderFile, '5;"首行;无表头"\r\n', 'utf8');
    await application.evaluate(({ BrowserWindow, dialog }, input) => {
      const original = dialog.showOpenDialog;
      let calls = 0;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        const expected = BrowserWindow.getAllWindows().find(window => window.webContents.id === input.sender);
        const options = args[1] as { title?: string; filters?: { extensions: string[] }[] };
        if (!expected || args[0] !== expected || options.title !== input.title || options.filters?.[0].extensions[0] !== 'csv')
          throw Error('PostgreSQL CSV 文件选择来源或格式不符');
        calls++;
        return { canceled: false, filePaths: [calls === 1 ? input.file : input.noHeaderFile] };
      }) as typeof original;
      Object.assign(globalThis, { finishPostgresTableImport: () => { dialog.showOpenDialog = original; return calls; } });
    }, { sender: tableExportSender, title: '选择 PostgreSQL CSV 文件', file: importFile, noHeaderFile });
    let importCalls: number;
    try {
      await tableButton(tableImportText.open).click();
      const csv = page.getByRole('dialog', { name: tableImportText.title, exact: true });
      const confirm = csv.getByRole('button', { name: tableImportText.confirm, exact: true });
      await csv.getByLabel(tableImportText.delimiter, { exact: true }).selectOption(';');
      await csv.getByRole('button', { name: tableImportText.choose, exact: true }).click();
      await expect(csv.getByText('1. 内容', { exact: false })).toBeVisible();
      const sample = csv.getByRole('table', { name: tableImportText.sample, exact: true });
      await expect(sample.getByRole('cell', { name: '窗口;CSV', exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await csv.getByLabel(tableImportText.target(0), { exact: true }).selectOption({ label: 'note' });
      await csv.getByLabel(tableImportText.target(1), { exact: true }).selectOption({ label: 'id' });
      await expect(grid).not.toContainText('窗口;CSV');
      await page.screenshot({ path: info.outputPath('PostgreSQL表页CSV导入确认.png') });
      await confirm.click();
      await expect(csv).toHaveCount(0);
      await expect(grid).toContainText('窗口;CSV');
      await expect(gridTab).toContainText('PostgreSQL 已提交导入，共 1 行');

      // 切换首行解释后清除原映射，再选择文件并确认，首条记录必须真实写入。
      await tableButton(tableImportText.open).click();
      await csv.getByLabel(tableImportText.delimiter, { exact: true }).selectOption(';');
      const chooseImport = csv.getByRole('button', { name: tableImportText.choose, exact: true });
      await chooseImport.click();
      await expect(csv.getByText(tableImportText.sampleEmpty, { exact: true })).toBeVisible();
      await csv.getByRole('checkbox', { name: csvImportHeaderZh.label, exact: true }).uncheck();
      await expect(csv.getByText('PostgreSQL无表头导入源.csv', { exact: false })).toHaveCount(0);
      await expect(confirm).toBeDisabled();
      await chooseImport.click();
      await expect(sample.getByRole('columnheader', { name: '第1列', exact: true })).toBeVisible();
      await expect(sample.getByRole('cell', { name: '首行;无表头', exact: true })).toBeVisible();
      await csv.getByRole('button', { name: tableImportText.position, exact: true }).click();
      await expect(grid).not.toContainText('首行;无表头');
      await page.screenshot({ path: info.outputPath('PostgreSQL无表头CSV导入预览.png') });
      await confirm.click();
      await expect(csv).toHaveCount(0);
      await expect(grid).toContainText('首行;无表头');
    } finally {
      importCalls = await application.evaluate(() => (globalThis as unknown as { finishPostgresTableImport(): number }).finishPostgresTableImport());
    }
    expect(importCalls).toBe(3);
    await mark('有表头和无表头 CSV 均显示样本，切换首行模式清除旧映射，确认后实际写入并刷新原表页');

    await editRecord('原值', '原生整批更新');
    for (const note of ['新增甲', '新增乙', '窗口;CSV', '首行;无表头']) {
      await grid.getByRole('gridcell', { name: note, exact: true }).click();
      await tableButton(postgresTableZh.remove).click();
    }
    await expect(grid).toContainText('新增甲');
    await page.screenshot({ path: info.outputPath('PostgreSQL表记录草稿.png') });
    await commit();
    await expect(grid).toContainText('原生整批更新');
    await expect(grid).not.toContainText('新增甲');
    await expect(grid).not.toContainText('新增乙');
    await editRecord('原生整批更新', '原值');
    await commit();
    await expect(grid).toContainText('原值');
    await mark('表页真实分页与筛选，预览前未写入，真实新增和整批更新删除，最终恢复原值');
    // 同一表页查看原目录字段、约束和部分索引，并验证刷新。
    await tableButton(postgresStructureZh.open).click();
    const structure = page.getByRole('dialog', { name: postgresStructureZh.title, exact: true });
    await expect(structure.getByRole('table')).toContainText('本轮字段注释');
    await structure.getByRole('button', { name: postgresStructureZh.sections.constraints, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('note_check');
    await structure.getByRole('button', { name: postgresStructureZh.sections.indexes, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('note_partial');
    await expect(structure.getByRole('table')).toContainText('WHERE (note IS NOT NULL)');
    await structure.getByRole('button', { name: postgresStructureZh.refresh, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('note_partial');
    await page.screenshot({ path: info.outputPath('PostgreSQL实际索引结构.png') });
    await structure.getByRole('button', { name: dependenciesText.open, exact: true }).click();
    const dependencyDialog = page.getByRole('dialog', { name: dependenciesText.title, exact: true });
    const referencedBy = dependencyDialog.getByRole('region', { name: dependenciesText.referencedBy });
    const references = dependencyDialog.getByRole('region', { name: dependenciesText.references });
    await expect(referencedBy.getByRole('row').filter({ hasText: '结构视图' })).toHaveCount(1);
    await dependencyDialog.getByRole('button', { name: dependenciesText.back, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('note_partial');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();

    const viewRow = page.locator('.object-row').filter({ hasText: '结构视图' });
    await clickSidebarAction(viewRow, { name: postgresStructureZh.open + ' "回归"."结构视图"', exact: true }, undefined, check);
    await structure.getByRole('button', { name: dependenciesText.open, exact: true }).click();
    await expect(references.getByRole('table')).toContainText('带""引号');
    await dependencyDialog.getByRole('button', { name: dependenciesText.back, exact: true }).click();
    await mark('原生表结构和视图结构能互查双向直接依赖，回到原结构标签');
    await structure.getByRole('button', { name: postgresStructureZh.sections.definition, exact: true }).click();
    await expect(structure.locator('.monaco-editor .view-lines')).toContainText('"回归"."带""引号"');
    await structure.getByRole('button', { name: postgresStructureZh.openDraft, exact: true }).click();
    await expect(structure).toBeHidden();
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('"回归"."带""引号"');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    await discardTestTab(page, page.locator('.tab-strip .tab-close').last());
    await mark('表页结构和右键视图定义均走真实只读目录，视图草稿未自动执行');
    await tableButton(postgresTableZh.query).click();
    await expect(tab().locator('.monaco-editor')).toBeVisible();
    await page.locator('.tab-strip .tab-close').first().click();
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('SELECT * FROM "回归"."带""引号" LIMIT 1000;');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    await execute();
    await expect(tab().getByRole('grid')).toContainText('原值');
    await mark('树中真实对象生成安全SELECT草稿，明确点击后才执行');

    // 把光标放在中间语句，估算树与原始输出沿正式窗口交互读取。
    const beforeExplain = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const planPaths = ['估算基准', '估算对比', '实测'].map(name => info.outputPath(name + '.dbark-plan.json'));
    const nativeWindow = await application.browserWindow(page);
    const senderId = await nativeWindow.evaluate(native => native.webContents.id);
    await nativeWindow.dispose();
    // 只为本例选择固定文件路径，实际读取和写入仍由正式主进程处理。
    await application.evaluate(({ BrowserWindow, dialog }, input) => {
      const native = BrowserWindow.getAllWindows().find(item => item.webContents.id === input.senderId);
      if (!native) throw Error('计划快照的原窗口不存在');
      const originalSave = dialog.showSaveDialog, originalOpen = dialog.showOpenDialog;
      let saves = 0, opens = 0;
      const opening = [input.paths[0], input.paths[1], input.paths[2], input.paths[2]];
      const validate = (owner: unknown, actual: string | undefined, title: string) => {
        if (owner !== native || actual !== title || native.isDestroyed()) throw Error('计划快照文件选择来源已变化');
      };
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        validate(args[0], (args[1] as { title?: string })?.title, '保存计划快照');
        const filePath = input.paths[saves++];
        if (!filePath) throw Error('计划快照写入次数超过预期');
        return { canceled: false, filePath };
      }) as typeof originalSave;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        validate(args[0], (args[1] as { title?: string })?.title, '选择计划快照文件');
        const path = opening[opens++];
        if (!path) throw Error('计划快照读取次数超过预期');
        return { canceled: false, filePaths: [path] };
      }) as typeof originalOpen;
      Object.assign(globalThis, { finishPostgresSnapshotFiles: () => {
        dialog.showSaveDialog = originalSave;
        dialog.showOpenDialog = originalOpen;
        return { saves, opens };
      } });
    }, { senderId, paths: planPaths });
    /** 真实点击保存并等待主进程写入回执。 */
    const savePlan = async (view: ReturnType<typeof tab>, index: number) => {
      await view.getByRole('button', { name: snapshotText.save, exact: true }).click();
      await expect(view.getByText(snapshotText.saved(planPaths[index].split(/[\\/]/).at(-1)!), { exact: true })).toBeVisible();
      await expect(button(postgresZh.execute)).toBeEnabled();
    };
    const planTail = '\nDELETE FROM "回归"."带""引号";';
    await edit('UPDATE "回归"."带""引号" SET note = \'仅估算\';\nSELECT * FROM "回归"."带""引号" LIMIT 1;' + planTail);
    for (let index = 0; index <= planTail.length; index++) await page.keyboard.press('ArrowLeft');
    await button(postgresZh.explain).click();
    const plan = tab().getByRole('region', { name: '可视化执行计划' });
    await expect(plan.getByRole('treeitem').first()).toContainText('Limit');
    await expect(plan).toContainText('估计输出行数');
    await plan.getByRole('treeitem').last().click();
    await expect(plan.getByLabel('节点详情')).toContainText('Total Cost');
    await expect(plan.getByRole('treeitem').first()).toBeInViewport({ ratio: 0.8 });
    await expect(plan.getByLabel('节点详情').getByText('Total Cost', { exact: true })).toBeInViewport({ ratio: 0.8 });
    await page.screenshot({ path: info.outputPath('PostgreSQL实际估算计划.png') });
    await plan.getByRole('button', { name: '原始输出', exact: true }).click();
    await expect(plan.getByLabel('原始输出', { exact: true })).toContainText('"Node Type": "Limit"');
    await expect(plan.getByLabel('原始输出', { exact: true })).not.toContainText('Actual Rows');
    await savePlan(plan, 0);
    const selectedPlan = 'UPDATE "回归"."带""引号" SET note = \'只预览选区\';';
    await edit('SELECT 77;\n' + selectedPlan);
    for (let index = 0; index < selectedPlan.length; index++) await page.keyboard.press('Shift+ArrowLeft');
    await button(postgresZh.explain).click();
    await expect(plan.getByRole('treeitem').first()).toContainText('ModifyTable');
    await savePlan(plan, 1);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeExplain);
    await mark('真实窗口估算光标语句和明确选区，查看树形成本与原始 JSON，原行及执行历史保持');

    // 验收真实执行路径，使用显式事务并核对写入与回滚。
    await button(postgresZh.begin).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await expect(button(postgresZh.execute)).toBeEnabled();
    const analyzeSql = 'UPDATE "回归"."带""引号" SET note = note || \'-实测\' WHERE id = 1;';
    const analyzeDialog = page.getByRole('dialog', { name: '实际执行分析', exact: true });
    const beforeAnalyze = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await edit(analyzeSql);
    await button('实际执行分析').click();
    await expect(analyzeDialog).toBeVisible();
    await expect(analyzeDialog.getByLabel('本次冻结的 SQL')).toContainText('note ||');
    await expect(analyzeDialog.getByRole('button', { name: '确认并实际执行' })).toBeDisabled();
    await analyzeDialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(analyzeDialog).toBeHidden();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeAnalyze);
    await button('实际执行分析').click();
    await expect(analyzeDialog).toBeVisible();
    await analyzeDialog.getByRole('checkbox').check();
    await analyzeDialog.getByRole('button', { name: '确认并实际执行' }).click();
    const actualPlan = tab().getByRole('region', { name: '实际执行计划' });
    await expect(actualPlan.getByRole('treeitem').first()).toContainText('ModifyTable');
    await expect(actualPlan.getByLabel('分析节点详情')).toContainText('实测指标');
    await expect(actualPlan.getByLabel('分析节点详情')).toContainText('估算指标');
    await page.screenshot({ path: info.outputPath('PostgreSQL实际执行分析.png') });
    await actualPlan.getByRole('button', { name: '分析原始输出' }).click();
    await expect(actualPlan.getByLabel('分析原始输出')).toContainText('Actual Rows');
    await savePlan(actualPlan, 2);
    const analysisHistory = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    expect(analysisHistory.filter(entry => entry.sql.startsWith('EXPLAIN (ANALYZE TRUE') && entry.success)).toHaveLength(1);
    await edit('SELECT note FROM "回归"."带""引号" WHERE id = 1;');
    await execute();
    await expect(tab().getByRole('grid')).toContainText('原值-实测');
    await button(postgresZh.rollback).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await mark('实际分析确认前无执行，确认后只写入一次并显示实测与估算指标，原事务可回滚');

    // 通过真实按键接纳 schema、关系和别名字段，不从 Monaco 注入候选。
    const widget = tab().locator('.suggest-widget.visible');
    const beforeCompletion = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await edit('SELECT * FROM 回');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('回归');
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('FROM "回归".');
    await page.keyboard.press('Escape');
    await edit('SELECT * FROM "回归"."带');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('带"引号');
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('FROM "回归"."带""引号"');
    const suffix = ' FROM "回归"."带""引号" AS r';
    await edit('SELECT r.no' + suffix);
    for (let index = 0; index < suffix.length; index++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('note');
    await page.screenshot({ path: info.outputPath('PostgreSQL实际别名字段补全.png') });
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('SELECT r."note"' + suffix);

    // CTE 显式输出从编辑器解析，派生表的通配字段从真实目录回填到外层别名。
    const cases = [
      { prefix: 'WITH x AS (SELECT note AS "对外名称"' + suffix + ') SELECT x.对外', tail: ' FROM x',
        label: '对外名称', inserted: 'SELECT x."对外名称" FROM x', screenshot: 'PostgreSQL实际CTE字段补全.png' },
      { prefix: 'SELECT d.no', tail: ' FROM (SELECT r.*' + suffix + ') AS d',
        label: 'note', inserted: 'SELECT d."note"', screenshot: undefined },
    ];
    for (const item of cases) {
      await edit(item.prefix + item.tail);
      for (let index = 0; index < item.tail.length; index++) await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Control+Space');
      await expect(widget.locator('.monaco-list-row.focused')).toContainText(item.label);
      if (item.screenshot) await page.screenshot({ path: info.outputPath(item.screenshot) });
      await page.keyboard.press('Enter');
      await expect(tab().locator('.monaco-editor .view-lines')).toContainText(item.inserted);
    }
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeCompletion);
    await mark('真实按键验证 schema、带引号关系、查询别名、CTE 和派生表字段补全，目录读取没有写入执行历史');

    await edit('SELECT "回归"."窗口补全函');
    await page.keyboard.press('Control+Space');
    const routines = widget.locator('.monaco-list-row').filter({ hasText: '窗口补全函数' });
    await expect(routines).toHaveCount(2);
    await expect(routines.filter({ hasText: 'integer' })).toHaveCount(1);
    await expect(routines.filter({ hasText: 'text' })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath('PostgreSQL函数重载补全.png') });
    await page.keyboard.press('Enter');
    const signatures = tab().locator('.parameter-hints-widget:visible');
    const activeParameter = signatures.locator('.signature .parameter.active');
    await expect(activeParameter).toContainText('值');
    await page.keyboard.insertText('7');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('SELECT "回归"."窗口补全函数"(7)');
    await edit('SELECT * FROM "回归"."窗口表函');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('SETOF integer');
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('FROM "回归"."窗口表函数"()');
    await edit('CALL "回归"."窗口补全过');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('窗口补全过程');
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('CALL "回归"."窗口补全过程"()');
    await expect(activeParameter).toHaveText('"值" integer');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeCompletion);
    await mark('原生按键接纳函数重载、表函数和 CALL 过程，光标进入调用括号且没有执行历史');

    await edit('SELECT "回归"."窗口参数提示"');
    await page.keyboard.type('(');
    await expect(activeParameter).toHaveText('"起点" integer');
    await page.keyboard.type('1,');
    await expect(activeParameter).toHaveText('"标签" text DEFAULT …');
    await page.screenshot({ path: info.outputPath('PostgreSQL调用参数提示.png') });
    const signatureShortcut = (process.platform === 'darwin' ? 'Meta' : 'Control') + '+Shift+Space';
    await edit('SELECT "回归"."窗口参数提示"(greatest(1, 2), ');
    await page.keyboard.press(signatureShortcut);
    await expect(activeParameter).toHaveText('"标签" text DEFAULT …');
    await edit('SELECT "回归"."窗口参数提示"("标签" => \'x\', "起点" => ');
    await page.keyboard.press(signatureShortcut);
    await expect(activeParameter).toHaveText('"起点" integer');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeCompletion);
    await mark('原生括号、逗号和快捷键参数提示高亮位置或命名参数，嵌套逗号与执行历史保持');

    // 通过原标签执行临时表与 search_path 设置，再在同一标签请求目录。
    await edit('CREATE TEMP TABLE temp_scope_native ("会话值" int); INSERT INTO temp_scope_native VALUES (7); SET search_path TO "回归", public; SELECT "会话值" FROM temp_scope_native;');
    await execute();
    const setupResults = tab().getByRole('combobox', { name: 'PostgreSQL结果集' });
    await expect(setupResults.getByRole('option', { name: '4 · SELECT · 1 行' })).toHaveCount(1);
    await setupResults.selectOption('3');
    await expect(tab().getByRole('grid')).toContainText('7');
    await expect(button(postgresZh.execute)).toBeEnabled();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    const beforeSessionCompletion = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await edit('SELECT * FROM temp_scope_nat');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('temp_scope_native');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('pg_temp');
    await page.screenshot({ path: info.outputPath('PostgreSQL实际会话临时表补全.png') });
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('FROM "pg_temp"."temp_scope_native"');
    const localSuffix = ' FROM "带""引号" r';
    await edit('SELECT r.no' + localSuffix);
    for (let index = 0; index < localSuffix.length; index++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Control+Space');
    await expect(widget.locator('.monaco-list-row.focused')).toContainText('note');
    await page.keyboard.press('Enter');
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('SELECT r."note"' + localSuffix);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(beforeSessionCompletion);

    await button(postgresZh.begin).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await expect(button(postgresZh.execute)).toBeEnabled();
    await edit('SELECT * FROM temp_scope_nat');
    await page.keyboard.press('Control+Space');
    await expect(tab().getByText(postgresZh.completionTransaction, { exact: true })).toBeVisible();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await button(postgresZh.rollback).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await mark('原查询标签补全实际临时表与搜索路径，打开事务后目录暂停且原事务状态保持');

    await edit("/* 外 /* 内 ; */ 外 */ SELECT 9223372036854775807::bigint AS exact; SELECT $标记$含;号$标记$ AS note;");
    await execute();
    await expect(tab().getByRole('grid')).toContainText('9223372036854775807');
    await tab().getByRole('combobox', { name: 'PostgreSQL结果集' }).selectOption('1');
    await expect(tab().getByRole('grid')).toContainText('含;号');

    // NUMERIC 使用 PostgreSQL 原值，精确小数相差末位；面板设置同值次键与显式 NULL 位置。
    const amountSql = `SELECT amount AS "金额", note AS "次键" FROM (VALUES
      (1, 'NaN'::numeric, '不是数字'), (2, 1.00000000000000000002::numeric, '高精度较大'),
      (3, NULL::numeric, '空值'), (4, 1.00000000000000000001::numeric, 'a-次键'),
      (5, 1.00000000000000000001::numeric, 'z-次键')) AS v(id, amount, note) ORDER BY id;`;
    await edit(amountSql);
    await execute();
    const amountGrid = tab().getByRole('grid');
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('不是数字');
    const historyBeforeSort = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const amountHeader = amountGrid.getByRole('columnheader').filter({ hasText: '金额' });
    await amountHeader.click();
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('a-次键');
    await expect(amountGrid.getByRole('row').nth(3)).toContainText('高精度较大');
    await expect(amountGrid.getByRole('row').nth(5)).toContainText('空值');
    await button(sortText.panelTitle).click();
    const sortDialog = page.getByRole('dialog', { name: sortText.panelTitle, exact: true });
    await sortDialog.getByLabel(sortText.panelNulls(1), { exact: true }).selectOption('FIRST');
    await sortDialog.getByRole('button', { name: sortText.panelAdd, exact: true }).click();
    await sortDialog.getByLabel(sortText.panelDirection(2), { exact: true }).selectOption('DESC');
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果多列排序.png') });
    await sortDialog.getByRole('button', { name: sortText.panelApply, exact: true }).click();
    await expect(sortDialog).toHaveCount(0);
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('空值');
    await expect(amountGrid.getByRole('row').nth(2)).toContainText('z-次键');
    await expect(amountGrid.getByRole('row').nth(3)).toContainText('a-次键');
    await button(sortText.clear).click();
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('不是数字');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeSort);
    await mark('真实 NUMERIC 列头排序和多列草稿，复核精度、NULL 位置、并列次键和恢复原顺序');

    // 从网格取完整 NUMERIC 原文，取消等值草稿，再应用排除条件与含 NULL 的勾选条件。
    const shortcut = page.getByRole('dialog', { name: filterText.title, exact: true });
    const shortcutOperator = (index: number) => shortcut.getByLabel(filterText.operator + ' ' + index, { exact: true });
    const applyShortcut = shortcut.getByRole('button', { name: filterText.apply, exact: true });
    const exactAmount = '1.00000000000000000002';
    const exactCell = amountGrid.getByRole('gridcell', { name: exactAmount, exact: true });
    await expect(button(filterText.cellEquals)).toBeDisabled();
    await exactCell.click();
    await button(filterText.cellEquals).click();
    await expect(shortcutOperator(1)).toHaveValue('eq');
    await expect(shortcut.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue(exactAmount);
    await shortcut.getByRole('button', { name: filterText.cancel, exact: true }).click();
    await expect(amountGrid.getByRole('row')).toHaveCount(6);
    await exactCell.click();
    await button(filterText.cellNotEquals).click();
    await expect(shortcutOperator(1)).toHaveValue('ne');
    await applyShortcut.click();
    await expect(tab().getByText(filterText.counts(5, 3), { exact: true })).toBeVisible();
    await expect(amountGrid).not.toContainText('高精度较大');
    await expect(amountGrid).not.toContainText('空值');
    await button(filterText.clear).click();

    for (const label of ['不是数字', '空值']) {
      await amountGrid.getByRole('row').filter({
        has: page.getByRole('gridcell', { name: label, exact: true }),
      }).getByRole('checkbox').check();
    }
    const nanCell = amountGrid.getByRole('gridcell', { name: 'NaN', exact: true });
    await nanCell.click();
    await button(selectedFilterText.open).click();
    await expect(shortcut.getByLabel(filterText.groupMode('1'), { exact: true })).toHaveValue('OR');
    await expect(shortcutOperator(1)).toHaveValue('in');
    await expect(shortcut.getByLabel(filterText.member(1, 1), { exact: true })).toHaveValue('NaN');
    await expect(shortcutOperator(2)).toHaveValue('null');
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果快捷筛选.png') });
    await applyShortcut.click();
    await expect(tab().getByText(filterText.counts(5, 2), { exact: true })).toBeVisible();
    await expect(amountGrid).toContainText('不是数字');
    await expect(amountGrid).toContainText('空值');
    await nanCell.click();
    await button(filterText.cellEquals).click();
    await expect(shortcut.getByLabel(filterText.groupMode('1'), { exact: true })).toHaveValue('OR');
    await expect(shortcutOperator(3)).toHaveValue('eq');
    await applyShortcut.click();
    await expect(tab().getByText(filterText.counts(5, 1), { exact: true })).toBeVisible();
    await expect(amountGrid).not.toContainText('空值');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeSort);
    await mark('快捷筛选保留 NUMERIC 原值，取消草稿不改结果，NaN 与 NULL 勾选和后续 AND 追加均通过原生窗口');

    // 先统计已筛选行，再用两条有限原值核对勾选范围的精确合计和平均值。
    const statistics = page.getByRole('dialog', { name: statisticsText.title, exact: true });
    const metric = (name: string) => statistics.getByLabel(name, { exact: true });
    await button(statisticsText.open).click();
    await expect(metric(statisticsText.count)).toHaveText('1');
    await expect(metric(statisticsText.max)).toHaveText('NaN');
    await statistics.getByRole('button', { name: statisticsText.close, exact: true }).click();
    await button(filterText.clear).click();
    for (const label of ['高精度较大', 'z-次键']) {
      await amountGrid.getByRole('row').filter({
        has: page.getByRole('gridcell', { name: label, exact: true }),
      }).getByRole('checkbox').check();
    }
    await exactCell.click();
    await button(statisticsText.open).click();
    const statisticsScope = statistics.getByLabel(statisticsText.scope, { exact: true });
    await expect(statisticsScope).toHaveValue('selected');
    await expect(metric(statisticsText.count)).toHaveText('2');
    await expect(metric(statisticsText.sum)).toHaveText('2.00000000000000000003');
    await expect(metric(statisticsText.average)).toHaveText('1.000000000000000000015');
    await statisticsScope.selectOption('all');
    await expect(metric(statisticsText.nulls)).toHaveText('1');
    await expect(metric(statisticsText.distinct)).toHaveText('3');
    await expect(metric(statisticsText.sum)).toHaveText(statisticsText.unavailable);
    await expect(statistics.getByText(statisticsText.postgresNonFinite, { exact: false })).toBeVisible();
    await statistics.getByRole('button', { name: statisticsText.frequency, exact: true }).click();
    const chart = statistics.getByRole('region', { name: statisticsText.frequencyTitle, exact: true });
    await expect(chart.getByText(statisticsText.frequencyCount(5), { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果列统计.png') });
    await chart.getByRole('row').filter({ hasText: 'NaN' }).getByRole('button', { name: statisticsText.frequencyFilter, exact: true }).click();
    await expect(statistics).toHaveCount(0);
    await expect(shortcut.getByLabel(filterText.input + ' 1', { exact: true })).toHaveValue('NaN');
    await applyShortcut.click();
    await expect(tab().getByText(filterText.counts(5, 1), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeSort);
    await mark('列统计按筛选和勾选范围计数，精确 NUMERIC 合计与平均保留末位，NaN 分布回填同一筛选草稿');

    // 从同一整理历史恢复筛选和排序，随后用新排序分支替换原重做路径。
    const undoResult = button(historyText.undo), redoResult = button(historyText.redo);
    await undoResult.click();
    await expect(amountGrid.getByRole('row')).toHaveCount(6);
    await expect(redoResult).toBeEnabled();
    await amountHeader.click();
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('a-次键');
    await expect(redoResult).toBeDisabled();
    const historyCell = amountGrid.getByRole('gridcell', { name: 'a-次键', exact: true });
    await historyCell.click();
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(modifier + '+z');
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('不是数字');
    await historyCell.click();
    await page.keyboard.press(modifier + '+Shift+z');
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('a-次键');

    await nanCell.click();
    await button(filterText.cellEquals).click();
    await applyShortcut.click();
    await expect(tab().getByText(filterText.counts(5, 1), { exact: true })).toBeVisible();
    await undoResult.click();
    await expect(amountGrid.getByRole('row').nth(1)).toContainText('a-次键');
    await expect(amountGrid.getByRole('row')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果整理历史.png') });
    await redoResult.click();
    await expect(tab().getByText(filterText.counts(5, 1), { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeSort);
    await mark('整理历史可用网格快捷键撤销重做；撤销筛选保留原排序，新整理清除重做分支');

    // 通过真实本机方案 IPC 保存、改名、读取及删除，拒绝把原列配置套到名称不同的结果。
    await button(columnText.open).click();
    const presetColumns = page.getByRole('dialog', { name: columnText.title, exact: true });
    await presetColumns.getByRole('button', { name: columnText.freezeThrough(1), exact: true }).click();
    await presetColumns.getByRole('button', { name: columnText.apply, exact: true }).click();
    await button(presetsText.open).click();
    const presets = page.getByRole('dialog', { name: presetsText.title, exact: true });
    const presetName = presets.getByRole('textbox', { name: presetsText.name, exact: true });
    const presetChoice = presets.getByRole('combobox', { name: presetsText.choose, exact: true });
    const presetPreview = presets.getByRole('region', { name: presetsText.preview, exact: true });
    const presetApply = presets.getByRole('button', { name: presetsText.apply, exact: true });
    const closePresets = presets.getByRole('button', { name: zh.common.close, exact: true });
    const namedPreset = '金额筛选与排序方案', renamedPreset = '金额筛选与排序方案复用';
    await expect(presets.getByText(presetsText.empty, { exact: true })).toBeVisible();
    await presetName.fill(namedPreset);
    await presets.getByRole('button', { name: presetsText.create, exact: true }).click();
    await expect(presetChoice.locator('option:checked')).toHaveText(namedPreset);
    await expect(presetPreview).toContainText('NaN');
    await expect(presetPreview).toContainText(presetsText.asc);
    await expect(presetPreview.getByLabel(presetsText.savedFrozen)).toHaveText(presetsText.frozenThrough(1, '金额'));
    await presetName.fill(renamedPreset);
    await presets.getByRole('button', { name: presetsText.rename, exact: true }).click();
    await expect(presetChoice.locator('option:checked')).toHaveText(renamedPreset);
    await closePresets.click();

    await edit('SELECT 0::numeric AS "金额", \'别名变化\' AS changed;');
    await execute();
    await button(presetsText.open).click();
    await presetChoice.selectOption({ label: renamedPreset });
    await expect(presets.getByRole('alert')).toHaveText(presetsText.mismatch);
    await expect(presetApply).toBeDisabled();
    await closePresets.click();
    await edit(amountSql);
    await execute();
    await expect(amountGrid.getByRole('row')).toHaveCount(6);
    const historyBeforePreset = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await button(presetsText.open).click();
    await presetChoice.selectOption({ label: renamedPreset });
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果整理方案.png') });
    await presetApply.click();
    await expect(presets).toHaveCount(0);
    await expect(tab().getByText(filterText.counts(5, 1), { exact: true })).toBeVisible();
    await expect(amountHeader.getByLabel(sortText.ascending)).toBeVisible();
    await expect(amountHeader).toHaveClass(/rdg-cell-frozen-start/);
    await undoResult.click();
    await expect(amountGrid.getByRole('row')).toHaveCount(6);
    await expect(amountHeader.getByLabel(sortText.ascending)).toHaveCount(0);
    await expect(amountHeader).toHaveClass(/rdg-cell-frozen-start/);
    await button(presetsText.open).click();
    await presetChoice.selectOption({ label: renamedPreset });
    await presets.getByRole('button', { name: presetsText.overwrite, exact: true }).click();
    await expect(presetPreview).toContainText(presetsText.noFilters);
    await expect(presetPreview).toContainText(presetsText.noSort);
    await presets.getByRole('button', { name: presetsText.remove, exact: true }).click();
    await expect(presets.getByText(presetsText.empty, { exact: true })).toBeVisible();
    await closePresets.click();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforePreset);
    await mark('命名整理方案实际保存改名、拒绝列不匹配、跨查询恢复筛选排序和冻结，并完成撤销、覆盖和删除');

    // 查询带可观测的序列推进，导出三种文件后复核只执行了原查询一次。
    await button(postgresZh.begin).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await edit(`CREATE TEMP SEQUENCE pg_result_export_seq;
      SELECT id AS "同名", note AS "同名", raw, nextval('pg_result_export_seq') AS "调用序号"
      FROM (VALUES (9223372036854775805::bigint, NULL::text, decode('00ff','hex')),
                   (9223372036854775806::bigint, ''::text, NULL::bytea),
                   (9223372036854775807::bigint, '引;号'::text, decode('','hex'))) AS items(id,note,raw)
      ORDER BY id; SELECT '另一结果' AS note;`);
    await execute();
    const resultSwitch = tab().getByRole('combobox', { name: 'PostgreSQL结果集' });
    const resultGrid = tab().getByRole('grid');
    const selectedExport = button(zh.resultExport.selectedTitle);
    const firstId = '9223372036854775805', lastId = '9223372036854775807';
    const selectResultRow = (value: string) => resultGrid.getByRole('row').filter({
      has: page.getByRole('gridcell', { name: value, exact: true }),
    }).getByRole('checkbox').check();
    await resultSwitch.selectOption('1');
    await expect(resultGrid).toContainText(firstId);
    await expect(undoResult).toBeDisabled();
    await expect(redoResult).toBeDisabled();
    await selectResultRow(lastId);
    await expect(selectedExport).toBeEnabled();
    await resultSwitch.selectOption('2');
    await expect(resultGrid).toContainText('另一结果');
    await expect(selectedExport).toBeDisabled();
    await resultSwitch.selectOption('1');
    await expect(selectedExport).toBeDisabled();
    const idHeader = resultGrid.getByRole('columnheader').filter({ hasText: '同名' }).first();
    await selectResultRow(lastId);
    await idHeader.click();
    await expect(selectedExport).toBeDisabled();
    await idHeader.click();
    await expect(resultGrid.getByRole('row').nth(1)).toContainText(lastId);
    await selectResultRow(firstId);
    await selectResultRow(lastId);
    const resultPaths = { json: info.outputPath('PostgreSQL查询勾选.json'), csv: info.outputPath('PostgreSQL查询返回.csv'),
      xlsx: info.outputPath('PostgreSQL查询返回.xlsx'), filtered: info.outputPath('PostgreSQL查询筛选.json'),
      layout: info.outputPath('PostgreSQL查询列布局.json'), pinned: info.outputPath('PostgreSQL固定快照.json') };
    await application.evaluate(({ BrowserWindow, dialog }, input) => {
      const original = dialog.showSaveDialog, calls: string[] = [];
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const owner = BrowserWindow.getAllWindows().find(window => window.webContents.id === input.sender);
        const options = args[1] as { title?: string; defaultPath?: string; filters?: { extensions: string[] }[] };
        const extension = options.filters?.[0].extensions[0];
        if (!owner || args[0] !== owner || options.title !== '导出文件' ||
            (extension !== 'json' && extension !== 'csv' && extension !== 'xlsx') || options.defaultPath !== '查询结果.' + extension)
          throw Error('PostgreSQL 查询结果保存的窗口或格式不符');
        calls.push(extension);
        const filePath = [input.paths.json, input.paths.csv, input.paths.xlsx, input.paths.filtered, input.paths.layout, input.paths.pinned][calls.length - 1];
        if (!filePath) throw Error('超出 PostgreSQL 查询结果导出次数');
        return { canceled: false, filePath };
      }) as typeof original;
      Object.assign(globalThis, { finishPostgresResultExport: () => { dialog.showSaveDialog = original; return calls; } });
    }, { sender: tableExportSender, paths: resultPaths });
    const historyBeforeExport = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    let resultExportCalls: string[];
    try {
      for (const format of ['json', 'csv', 'xlsx'] as const) {
        const selected = format === 'json', title = selected ? zh.resultExport.selectedTitle : zh.resultExport.title;
        await button(title).click();
        const saveResult = page.getByRole('dialog', { name: title, exact: true });
        await expect(saveResult).toContainText(selected ? '勾选的 2 行' : '已返回 3 行');
        await expect(saveResult.getByRole('option', { name: 'INSERT SQL', exact: true })).toHaveCount(0);
        await saveResult.getByLabel(zh.resultExport.format, { exact: true }).selectOption(format);
        if (format === 'csv') await saveResult.getByLabel(csvExportZh.label, { exact: true }).selectOption(';');
        await saveResult.locator('.file-picker').click();
        await expect(saveResult.locator('.file-picker')).toContainText(selected ? 'PostgreSQL查询勾选.json' : 'PostgreSQL查询返回.' + format);
        if (selected) await page.screenshot({ path: info.outputPath('PostgreSQL查询结果导出确认.png') });
        await saveResult.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
        await expect(saveResult.locator('.success-box')).toHaveText('已导出 ' + (selected ? 2 : 3) + ' 行已返回结果。');
        await saveResult.getByRole('button', { name: zh.common.done, exact: true }).click();
        await expect(saveResult).toHaveCount(0);
        await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
      }
      // 筛选相邻 BIGINT，错误草稿保留现有排序和勾选，成功后按过滤后的实际显示顺序导出。
      await button(filterText.open).click();
      const filter = page.getByRole('dialog', { name: filterText.title, exact: true });
      await filter.getByRole('button', { name: filterText.add, exact: true }).click();
      await filter.getByRole('button', { name: valueText.openCondition(1), exact: true }).click();
      const values = filter.getByRole('region', { name: valueText.title, exact: true });
      await expect(values).toContainText(firstId);
      await expect(values).toContainText(lastId);
      await values.getByRole('button', { name: valueText.cancel, exact: true }).click();
      await filter.getByLabel(filterText.operator + ' 1', { exact: true }).selectOption('gte');
      const condition = filter.getByLabel(filterText.input + ' 1', { exact: true });
      const applyFilter = filter.getByRole('button', { name: filterText.apply, exact: true });
      const middleId = '9223372036854775806';
      await condition.fill(middleId);
      await page.screenshot({ path: info.outputPath('PostgreSQL查询结果条件筛选.png') });
      await condition.fill('无效数值');
      await applyFilter.click();
      await expect(filter.getByRole('alert')).toContainText(filterText.value);
      await expect(resultGrid).toContainText(firstId);
      await condition.fill(middleId);
      await applyFilter.click();
      await expect(filter).toHaveCount(0);
      await expect(tab().getByText(filterText.counts(3, 2), { exact: true })).toBeVisible();
      await expect(resultGrid).not.toContainText(firstId);
      await expect(resultGrid.getByRole('row').nth(1)).toContainText(lastId);
      await expect(selectedExport).toBeDisabled();
      await button(zh.resultExport.title).click();
      const filteredExport = page.getByRole('dialog', { name: zh.resultExport.title, exact: true });
      await filteredExport.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
      await filteredExport.locator('.file-picker').click();
      await expect(filteredExport.locator('.file-picker')).toContainText('PostgreSQL查询筛选.json');
      await filteredExport.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
      await expect(filteredExport.locator('.success-box')).toHaveText('已导出 2 行已返回结果。');
      await filteredExport.getByRole('button', { name: zh.common.done, exact: true }).click();
      expect(JSON.parse(await readFile(resultPaths.filtered, 'utf8')).map((row: { 同名: string }) => row.同名)).toEqual([lastId, middleId]);

      // 重名列按原列序号定位，拒绝隐藏活动规则列，成功后勾选导出使用可见列和当前顺序。
      await button(columnText.open).click();
      const columns = page.getByRole('dialog', { name: columnText.title, exact: true });
      const applyColumns = columns.getByRole('button', { name: columnText.apply, exact: true });
      await columns.getByLabel(columnText.visible(1), { exact: true }).uncheck();
      await applyColumns.click();
      await expect(columns.getByRole('alert')).toHaveText(columnText.activeRule);
      await expect(resultGrid.getByRole('row').nth(1)).toContainText(lastId);
      await columns.getByLabel(columnText.visible(1), { exact: true }).check();
      await columns.getByLabel(columnText.visible(3), { exact: true }).uncheck();
      await columns.getByRole('button', { name: columnText.up(2), exact: true }).click();
      await columns.getByRole('button', { name: columnText.freezeThrough(2), exact: true }).click();
      await columns.getByLabel(columnText.width(2), { exact: true }).fill('240');
      await columns.getByLabel(heightText.label, { exact: true }).selectOption('56');
      await page.screenshot({ path: info.outputPath('PostgreSQL查询结果列管理.png') });
      await applyColumns.click();
      await expect(columns).toHaveCount(0);
      await expect(undoResult).toBeDisabled();
      await expect(redoResult).toBeDisabled();
      await expect(resultGrid).toHaveClass(/grid-row-height-56/);
      await expect(resultGrid.getByRole('columnheader', { name: /raw/ })).toHaveCount(0);
      const reorderedHeader = resultGrid.getByRole('columnheader').filter({ hasText: '同名' }).first();
      await expect(reorderedHeader.locator('.column-type')).toHaveText('TEXT');
      await expect(reorderedHeader).toHaveClass(/rdg-cell-frozen-start/);
      await expect(reorderedHeader).toHaveCSS('width', '240px');
      await expect(tab().getByText(filterText.counts(3, 2), { exact: true })).toBeVisible();
      await expect(resultGrid.getByRole('row').nth(1)).toContainText(lastId);
      await expect(resultGrid).not.toContainText(firstId);
      await selectResultRow(middleId);
      await selectResultRow(lastId);
      await selectedExport.click();
      const layoutExport = page.getByRole('dialog', { name: zh.resultExport.selectedTitle, exact: true });
      await layoutExport.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
      await layoutExport.locator('.file-picker').click();
      await expect(layoutExport.locator('.file-picker')).toContainText('PostgreSQL查询列布局.json');
      await layoutExport.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
      await expect(layoutExport.locator('.success-box')).toHaveText('已导出 2 行已返回结果。');
      await layoutExport.getByRole('button', { name: zh.common.done, exact: true }).click();
      const layoutRows = JSON.parse(await readFile(resultPaths.layout, 'utf8'));
      expect(Object.keys(layoutRows[0])).toEqual(['同名', '同名 [2]', '调用序号']);
      expect(layoutRows).toEqual([
        { 同名: '引;号', '同名 [2]': lastId, 调用序号: '3' },
        { 同名: '', '同名 [2]': middleId, 调用序号: '2' },
      ]);

      // 行详情沿用筛选后的降序，完整原列仍包含隐藏二进制和两个同名字段。
      const detailButton = button(detailText.open);
      await expect(detailButton).toBeDisabled();
      await resultGrid.getByRole('gridcell', { name: lastId, exact: true }).click();
      await detailButton.click();
      const detail = tab().getByRole('region', { name: detailText.region, exact: true });
      const rowDocument = detail.getByRole('textbox', { name: recordText.jsonText, exact: true });
      await expect(detail.locator('header')).toContainText('1 / 2');
      await expect(detail.getByRole('button', { name: detailText.previous, exact: true })).toBeDisabled();
      await detail.getByRole('searchbox', { name: detailText.fieldSearch, exact: true }).fill('raw');
      await expect(detail.locator('.query-row-details-fields article')).toHaveCount(1);
      await detail.getByRole('button', { name: recordText.tree, exact: true }).click();
      await expect(detail.getByLabel(recordText.tree, { exact: true })).toContainText('二进制 · Base64 · 0 字节');
      await detail.getByRole('button', { name: recordText.json, exact: true }).click();
      expect(JSON.parse(await rowDocument.inputValue())).toMatchObject({
        complete: true, sourceTypes: 'returned-values', fields: [
          { key: 'c0', name: '同名', protocolType: 'BIGINT', value: { kind: 'text', value: lastId } },
          { key: 'c1', name: '同名', protocolType: 'TEXT', value: { kind: 'text', value: '引;号' } },
          { key: 'c2', name: 'raw', protocolType: 'BYTEA', value: { kind: 'blob', bytes: 0, value: '' } },
          { key: 'c3', name: '调用序号', value: { kind: 'text', value: '3' } },
        ],
      });
      await rowDocument.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('PostgreSQL查询结果行详情.png') });
      await detail.getByRole('button', { name: detailText.next, exact: true }).click();
      await expect(detail.locator('header')).toContainText('2 / 2');
      await expect(detail.getByRole('button', { name: detailText.next, exact: true })).toBeDisabled();
      expect(JSON.parse(await rowDocument.inputValue()).fields.slice(0, 3).map((field: { value: unknown }) => field.value))
        .toEqual([{ kind: 'text', value: middleId }, { kind: 'text', value: '' }, { kind: 'null' }]);
      await button(filterText.clear).click();
      await expect(detail).toHaveCount(0);
      await expect(detailButton).toBeDisabled();
      await mark('行详情按当前筛选降序翻行，隐藏原列、重复别名、BIGINT、空串、NULL 和二进制在只读视图中可区分');
      await expect(resultGrid.getByRole('row').nth(1)).toContainText(lastId);
      await expect(resultGrid).toContainText(firstId);
      await mark('BIGINT 候选、错误草稿、排序保留、筛选后 JSON 和清除筛选通过原生窗口');
      await resultSwitch.selectOption('2');
      await resultSwitch.selectOption('1');
      await expect(undoResult).toBeDisabled();
      await expect(redoResult).toBeDisabled();
      await expect(resultGrid.getByRole('columnheader', { name: /raw/ })).toBeVisible();
      await expect(resultGrid).toHaveClass(/grid-row-height-32/);
      await expect(resultGrid.getByRole('row').nth(1)).toContainText(firstId);
      await mark('列布局保护活动条件和排序，隐藏与重排联动勾选导出，切换结果恢复原布局');

      // 固定原结果时已有筛选与隐藏列。快照仍须包含全部原列、原行和精确数据。
      await resultGrid.getByRole('gridcell', { name: lastId, exact: true }).click();
      await button(filterText.cellEquals).click();
      await applyFilter.click();
      await expect(resultGrid).not.toContainText(firstId);
      await button(columnText.open).click();
      await columns.getByLabel(columnText.visible(3), { exact: true }).uncheck();
      await applyColumns.click();
      await expect(resultGrid.getByRole('columnheader', { name: /raw/ })).toHaveCount(0);
      await button(zh.query.pinResult).click();
      const pinned = tab().getByRole('group', { name: zh.query.pinSection, exact: true });
      await expect(pinned.getByRole('button', { name: '固定 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(resultGrid).toContainText(firstId);
      await expect(resultGrid.getByRole('columnheader', { name: /raw/ })).toBeVisible();
      await expect(resultSwitch).toHaveCount(0);
      await button(zh.resultExport.title).click();
      const pinExport = page.getByRole('dialog', { name: zh.resultExport.title, exact: true });
      await pinExport.getByLabel(zh.resultExport.format, { exact: true }).selectOption('json');
      await pinExport.locator('.file-picker').click();
      await expect(pinExport.locator('.file-picker')).toContainText('PostgreSQL固定快照.json');
      await pinExport.getByRole('button', { name: zh.resultExport.start, exact: true }).click();
      await expect(pinExport.locator('.success-box')).toHaveText('已导出 3 行已返回结果。');
      await pinExport.getByRole('button', { name: zh.common.done, exact: true }).click();
      const pinRows = JSON.parse(await readFile(resultPaths.pinned, 'utf8'));
      expect(pinRows.map((row: { 同名: string }) => row.同名)).toEqual([firstId, middleId, lastId]);
      expect(pinRows[0].raw).toEqual({ type: 'binary', base64: 'AP8=' });
    } finally {
      resultExportCalls = await application.evaluate(() => (globalThis as unknown as { finishPostgresResultExport(): string[] }).finishPostgresResultExport());
    }
    expect(resultExportCalls).toEqual(['json', 'csv', 'xlsx', 'json', 'json', 'json']);
    expect(JSON.parse(await readFile(resultPaths.json, 'utf8'))).toEqual([
      { 同名: lastId, '同名 [2]': '引;号', raw: { type: 'binary', base64: '' }, 调用序号: '3' },
      { 同名: firstId, '同名 [2]': null, raw: { type: 'binary', base64: 'AP8=' }, 调用序号: '1' },
    ]);
    expect(await readFile(resultPaths.csv, 'utf8')).toBe('同名;同名 [2];raw;调用序号\r\n' +
      lastId + ';"引;号";base64:;3\r\n9223372036854775806;"";\\N;2\r\n' + firstId + ';\\N;base64:AP8=;1\r\n');
    const { Workbook } = require('exceljs') as typeof import('exceljs');
    const resultBook = new Workbook();
    await resultBook.xlsx.readFile(resultPaths.xlsx);
    expect(resultBook.worksheets).toHaveLength(1);
    const sheet = resultBook.worksheets[0];
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell('A2').text).toBe(lastId);
    expect(sheet.getCell('B1').text).toBe('同名 [2]');
    expect(sheet.getCell('B4').text).toBe('\\N');
    expect(sheet.getCell('C4').text).toBe('\\B:AP8=');
    expect(sheet.getCell('B3').text).toBe('');
    expect(sheet.getCell('A4').text).toBe(firstId);
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeExport);
    await edit("SELECT '序列确认：' || currval('pg_result_export_seq')::text;");
    await execute();
    await expect(tab().getByRole('grid')).toContainText('序列确认：3');
    const pinGroup = tab().getByRole('group', { name: zh.query.pinSection, exact: true });
    const oldResult = pinGroup.getByRole('button', { name: '固定 1', exact: true });
    await expect(pinGroup.getByRole('button', { name: zh.query.currentResults, exact: true })).toHaveAttribute('aria-pressed', 'true');
    const historyBeforePinRead = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    await oldResult.click();
    await expect(resultGrid).toContainText(firstId);
    await expect(resultGrid).not.toContainText('序列确认：3');
    await page.screenshot({ path: info.outputPath('PostgreSQL固定查询结果.png') });
    await button(zh.query.pinnedStatement).click();
    const pinSql = page.getByRole('dialog', { name: zh.query.pinSource, exact: true });
    await expect(pinSql.locator('.view-lines')).toContainText('pg_result_export_seq');
    await pinSql.getByRole('button', { name: zh.common.close, exact: true }).click();
    await pinGroup.getByRole('button', { name: '释放 固定 1', exact: true }).click();
    await expect(pinGroup).toHaveCount(0);
    await expect(resultGrid).toContainText('序列确认：3');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforePinRead);
    await mark('固定完整原结果、导出原值，执行新查询后回看快照 SQL 并释放，事务及历史保持');

    // 两次真实查询固定各自原值，使用相邻 NUMERIC 键核对四类差异和二进制明细。
    await edit(`SELECT * FROM (VALUES
      (1.00000000000000000001::numeric, '旧文本'::text, decode('00','hex')),
      (1.00000000000000000002::numeric, '保留', NULL::bytea),
      ('NaN'::numeric, '移除', NULL::bytea)) AS records("键", "内容", "字节");`);
    await execute();
    await button(zh.query.pinResult).click();
    await expect(button(comparisonText.open)).toBeDisabled();
    const resultSnapshotPath = info.outputPath('PostgreSQL原始结果.dbark-result.json');
    const legacySnapshotPath = info.outputPath('通用旧版结果.dbark-result.json');
    await writeFile(legacySnapshotPath, encodeQueryResultSnapshot(createQueryResultSnapshot({
      columns: [{ key: 'k', name: '旧版字段', type: 'TEXT' }], rows: [{ k: '旧版内容' }],
      elapsedMs: 0, truncated: false, statement: '旧版快照文字',
    })));
    await application.evaluate(({ BrowserWindow, dialog }, input) => {
      const originalSave = dialog.showSaveDialog, originalOpen = dialog.showOpenDialog;
      const calls: string[] = [];
      /** 原生测试只替代选择路径，核对真实所属窗口及快照对话框。 */
      function checkPicker(owner: unknown, options: { title?: string; filters?: { extensions: string[] }[] }, expected: string) {
        const window = BrowserWindow.getAllWindows().find(item => item.webContents.id === input.sender);
        if (!window || owner !== window || options.title !== expected || options.filters?.[0].extensions.join() !== 'json')
          throw Error('结果快照文件选择器来源或格式不符');
      }
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = args[1] as { title?: string; defaultPath?: string; filters?: { extensions: string[] }[] };
        checkPicker(args[0], options, '保存结果快照');
        if (options.defaultPath !== '结果快照.dbark-result.json' || calls.length) throw Error('结果快照保存请求不符');
        calls.push('save');
        return { canceled: false, filePath: input.path };
      }) as typeof originalSave;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        checkPicker(args[0], args[1] as { title?: string; filters?: { extensions: string[] }[] }, '打开结果快照');
        if (calls.length !== 1 && calls.length !== 2) throw Error('结果快照打开次数不符');
        const path = calls.length === 1 ? input.legacy : input.path;
        calls.push('open');
        return { canceled: false, filePaths: [path] };
      }) as typeof originalOpen;
      Object.assign(globalThis, { finishPostgresResultSnapshots: () => {
        dialog.showSaveDialog = originalSave; dialog.showOpenDialog = originalOpen; return calls;
      } });
    }, { sender: tableExportSender, path: resultSnapshotPath, legacy: legacySnapshotPath });
    await button(resultSnapshotText.save).click();
    await expect(tab().getByText(resultSnapshotText.saved, { exact: true })).toBeVisible();
    const savedResultSnapshot = decodeQueryResultSnapshot(await readFile(resultSnapshotPath));
    expect(savedResultSnapshot.version).toBe(3);
    expect(savedResultSnapshot.result).toMatchObject({ postgresCommand: 'SELECT', affectedRows: 3 });
    expect(savedResultSnapshot.result.rows[0]).toMatchObject({ c0: '1.00000000000000000001', c1: '旧文本',
      c2: { type: 'binary', base64: 'AA==' } });
    await pinGroup.getByRole('button', { name: '释放 固定 2', exact: true }).click();
    await edit(`SELECT * FROM (VALUES
      ('Infinity'::numeric, '新增'::text, NULL::bytea),
      (1.00000000000000000002::numeric, '保留', NULL::bytea),
      (1.00000000000000000001::numeric, '新文本', decode('ff','hex'))) AS records("键", "内容", "字节");`);
    await execute();
    await button(zh.query.pinResult).click();
    const historyBeforeComparison = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    try {
      await button(resultSnapshotText.open).click();
      await expect(tab().getByRole('alert')).toHaveText(resultSnapshotText.postgresRequired);
      await expect(resultGrid).toContainText('新文本');
      await button(resultSnapshotText.open).click();
      await expect(tab().getByText(resultSnapshotText.opened, { exact: true })).toBeVisible();
      await expect(resultGrid).toContainText('旧文本');
      await expect(pinGroup.getByRole('button', { name: '固定 4 · PostgreSQL原始结果.dbark-result.json', exact: true }))
        .toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({ path: info.outputPath('PostgreSQL查询结果快照文件.png') });
    } finally {
      expect(await application.evaluate(() =>
        (globalThis as unknown as { finishPostgresResultSnapshots(): string[] }).finishPostgresResultSnapshots()))
        .toEqual(['save', 'open', 'open']);
    }
    await mark('PostgreSQL 结果快照实际保存与回读，拒绝旧版快照后恢复原数值、原字节和命令标签');
    await button(comparisonText.open).click();
    const resultComparison = page.getByRole('dialog', { name: comparisonText.title, exact: true });
    const startComparison = resultComparison.getByRole('button', { name: comparisonText.start, exact: true });
    await expect(startComparison).toBeDisabled();
    await resultComparison.getByLabel(comparisonText.right, { exact: true }).selectOption({ label: '固定 3' });
    await resultComparison.getByLabel(comparisonText.left, { exact: true })
      .selectOption({ label: '固定 4 · PostgreSQL原始结果.dbark-result.json' });
    await expect(resultComparison.getByRole('checkbox', { name: comparisonText.key('c2'), exact: true })).toBeDisabled();
    await resultComparison.getByRole('checkbox', { name: comparisonText.key('c0'), exact: true }).check();
    await startComparison.click();
    for (const metric of [comparisonText.added, comparisonText.removed, comparisonText.changed, comparisonText.equal]) {
      await expect(resultComparison.getByLabel(metric, { exact: true })).toHaveText('1');
    }
    await resultComparison.getByLabel(comparisonText.filter, { exact: true }).selectOption('changed');
    await resultComparison.getByRole('button', { name: comparisonText.details(0), exact: true }).click();
    const difference = resultComparison.getByRole('region', { name: comparisonText.detailsTitle, exact: true });
    await expect(difference.getByLabel(comparisonText.leftValue + ' c0', { exact: true })).toContainText('1.00000000000000000001');
    await expect(difference.getByLabel(comparisonText.leftValue + ' c1', { exact: true })).toContainText('旧文本');
    await expect(difference.getByLabel(comparisonText.rightValue + ' c1', { exact: true })).toContainText('新文本');
    await expect(difference.getByLabel(comparisonText.leftValue + ' c2', { exact: true })).toContainText('AA==');
    await expect(difference.getByLabel(comparisonText.rightValue + ' c2', { exact: true })).toContainText('/w==');
    await page.screenshot({ path: info.outputPath('PostgreSQL固定结果对比.png') });
    await resultComparison.getByRole('button', { name: comparisonText.close, exact: true }).click();
    await pinGroup.getByRole('button', { name: '释放 固定 4 · PostgreSQL原始结果.dbark-result.json', exact: true }).click();
    await expect(button(comparisonText.open)).toBeDisabled();
    await pinGroup.getByRole('button', { name: '释放 固定 3', exact: true }).click();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(historyBeforeComparison);
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await mark('两份固定结果按精确 NUMERIC 对齐，四类差异各一行，可查文本与 BYTEA 原值，执行历史及事务保持');
    await button(postgresZh.rollback).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await mark('查询结果的勾选 JSON、已返回 CSV 和 Excel 实际落盘，导出未推进原序列或改变事务');

    const parameterSql = 'SELECT $1::text AS bound';
    await edit('SELECT 10;\n' + parameterSql);
    const textbox = tab().locator('.monaco-editor').getByRole('textbox');
    await textbox.focus();
    for (let index = 0; index < parameterSql.length; index++) await page.keyboard.press('Shift+ArrowLeft');
    await button(postgresZh.parameters).click();
    const parameters = page.getByRole('dialog', { name: parameterZh.title, exact: true });
    const parameter = '参数原文 ; -- 😀';
    await parameters.getByLabel('参数值 p1', { exact: true }).fill(parameter);
    await parameters.getByRole('button', { name: parameterZh.execute, exact: true }).click();
    await expect(parameters).toBeHidden();
    await expect(tab().getByRole('grid')).toContainText(parameter);
    await mark('多结果切换、BIGINT精度及选区位置参数走真实窗口');

    await button(postgresZh.begin).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.transaction);
    await edit('UPDATE "回归"."带""引号" SET note = \'原生事务\' WHERE id = 1; SELECT 1/0;');
    await execute();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.failedTransaction);
    await expect(button(postgresZh.commit)).toBeDisabled();
    await button(postgresZh.rollback).click();
    await expect(tab().locator('.tab-status')).toContainText(postgresZh.idle);
    await edit('SELECT pg_sleep(30); SELECT 99;');
    await execute();
    await expect(tab()).toContainText(postgresZh.running);
    const stop = Date.now();
    await button(postgresZh.stop).click();
    await expect(button(postgresZh.execute)).toBeEnabled({ timeout: 15000 });
    expect(Date.now() - stop).toBeLessThan(20000);
    await expect(tab().locator('.error-box')).toBeVisible();
    await edit('SELECT note FROM "回归"."带""引号" WHERE id = 1;');
    await execute();
    await expect(tab().getByRole('grid')).toContainText('原值');
    const history = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    expect(history.some(entry => entry.sql === parameterSql && entry.success)).toBe(true);
    expect(JSON.stringify(history)).not.toContain(parameter);
    await mark('失败事务禁止提交，回滚原行，取消等待真实终态后同会话可查询');
    await page.screenshot({ path: info.outputPath('PostgreSQL真实查询.png') });

    await page.locator('.tab-strip .tab-close').click();
    const close = page.getByRole('dialog', { name: queryCloseZh.title, exact: true });
    await close.getByRole('button', { name: queryCloseZh.save, exact: true }).click();
    const save = page.getByRole('dialog', { name: queryBindingZh.title, exact: true });
    await save.getByLabel(queryBindingZh.name, { exact: true }).fill('保留的PostgreSQL查询');
    await save.getByRole('button', { name: queryBindingZh.create, exact: true }).click();
    await expect(save).toBeHidden();
    await expect(tab()).toHaveCount(0);
    const queries = await page.evaluate(() => window.dbark.invoke('queries.list', {}));
    expect(queries).toHaveLength(1);
    expect(queries[0].name).toBe('保留的PostgreSQL查询');

    // 使用数据库原右键入口建表，再从实际新表页核对目录。
    const databaseNode = page.locator('.database-row').filter({ hasText: database });
    await clickSidebarAction(databaseNode, { name: zh.sidebar.text017, exact: true }, undefined, check);
    const create = page.getByRole('dialog', { name: postgresCreateTableZh.title, exact: true });
    await create.getByLabel(postgresCreateTableZh.schema, { exact: true }).selectOption('回归');
    await create.getByLabel(postgresCreateTableZh.table, { exact: true }).fill('窗口新表');
    const first = create.getByRole('group', { name: postgresCreateTableZh.field(1), exact: true });
    await first.getByLabel(postgresCreateTableZh.name, { exact: true }).fill('id');
    await first.getByLabel(postgresCreateTableZh.type, { exact: true }).selectOption('bigint');
    await first.getByLabel(postgresCreateTableZh.identity, { exact: true }).selectOption('always');
    await first.getByRole('checkbox', { name: postgresCreateTableZh.primary, exact: true }).check();
    await create.getByRole('button', { name: postgresCreateTableZh.add, exact: true }).click();
    const second = create.getByRole('group', { name: postgresCreateTableZh.field(2), exact: true });
    await second.getByLabel(postgresCreateTableZh.name, { exact: true }).fill('note');
    await second.getByLabel(postgresCreateTableZh.default, { exact: true }).selectOption('literal');
    await second.getByLabel(postgresCreateTableZh.value, { exact: true }).fill('窗口默认');
    await second.getByLabel(postgresCreateTableZh.comment, { exact: true }).fill('窗口列注释');
    await create.getByRole('button', { name: postgresCreateTableZh.preview, exact: true }).click();
    await expect(create.locator('.pg-create-sql')).toContainText('CREATE TABLE "回归"."窗口新表"');
    await expect(page.locator('.object-row').filter({ hasText: /^"回归"\."窗口新表"$/ })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('PostgreSQL建表确认前.png') });
    await create.getByRole('button', { name: postgresCreateTableZh.apply, exact: true }).click();
    await expect(create).toBeHidden();
    await expect(page.locator('.object-row').filter({ hasText: /^"回归"\."窗口新表"$/ })).toBeVisible();
    await expect(gridTab.locator('.context-bar')).toContainText('"回归"."窗口新表"');
    await tableButton(postgresStructureZh.open).click();
    await expect(structure.getByRole('table')).toContainText('窗口默认');
    await expect(structure.getByRole('table')).toContainText('窗口列注释');
    // 新增和重命名同批预览，原结构在明确确认之前保持。
    await structure.getByRole('button', { name: postgresColumnEditZh.open, exact: true }).click();
    const fieldEdit = structure.getByRole('region', { name: postgresColumnEditZh.title });
    await fieldEdit.getByLabel(postgresColumnEditZh.name, { exact: true }).fill('字段草稿');
    await fieldEdit.getByLabel(postgresColumnEditZh.comment, { exact: true }).fill('结构编辑确认');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByLabel(postgresColumnEditZh.operation, { exact: true }).selectOption('rename');
    await fieldEdit.getByLabel(postgresColumnEditZh.from, { exact: true }).selectOption('字段草稿');
    await fieldEdit.getByLabel(postgresColumnEditZh.name, { exact: true }).fill('字段确认');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByLabel(postgresColumnEditZh.operation, { exact: true }).selectOption('add');
    await fieldEdit.getByLabel(postgresColumnEditZh.name, { exact: true }).fill('可删除');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.preview, exact: true }).click();
    await expect(fieldEdit.getByLabel(postgresColumnEditZh.previewTitle)).toContainText('RENAME COLUMN "字段草稿" TO "字段确认"');
    await expect(gridTab.getByRole('columnheader', { name: '字段确认', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('PostgreSQL字段编辑预览.png') });
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.apply, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('字段确认');
    await expect(structure.getByRole('table')).toContainText('结构编辑确认');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await expect(gridTab.getByRole('columnheader').filter({ hasText: '字段确认' })).toBeVisible();
    await expect(gridTab.getByRole('columnheader', { name: '可删除 text', exact: true })).toBeVisible();
    await mark('字段新增与重命名按同批 SQL 确认，实际结构和原表页刷新到新字段');
    // 已有字段修改与删除再次使用同一入口，删除须独立确认。
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresColumnEditZh.open, exact: true }).click();
    await fieldEdit.getByLabel(postgresColumnEditZh.operation, { exact: true }).selectOption('type');
    await fieldEdit.getByLabel(postgresColumnEditZh.from, { exact: true }).selectOption('字段确认');
    await fieldEdit.getByLabel(postgresColumnEditZh.type, { exact: true }).selectOption('varchar');
    await fieldEdit.getByLabel(postgresColumnEditZh.length, { exact: true }).fill('16');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByLabel(postgresColumnEditZh.operation, { exact: true }).selectOption('default');
    await fieldEdit.getByLabel(postgresColumnEditZh.useDefault, { exact: true }).check();
    await fieldEdit.getByLabel(postgresColumnEditZh.defaultValue, { exact: true }).fill('新默认值');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByLabel(postgresColumnEditZh.operation, { exact: true }).selectOption('drop');
    await fieldEdit.getByLabel(postgresColumnEditZh.from, { exact: true }).selectOption('可删除');
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.stage }).click();
    await fieldEdit.getByRole('button', { name: postgresColumnEditZh.preview, exact: true }).click();
    await expect(fieldEdit.getByLabel(postgresColumnEditZh.previewTitle)).toContainText('DROP COLUMN "可删除" RESTRICT');
    const confirmColumnChanges = fieldEdit.getByRole('button', { name: postgresColumnEditZh.apply, exact: true });
    await expect(confirmColumnChanges).toBeDisabled();
    await fieldEdit.getByLabel(postgresColumnEditZh.confirmDrop, { exact: true }).check();
    await expect(confirmColumnChanges).toBeEnabled();
    await page.screenshot({ path: info.outputPath('PostgreSQL已有字段修改与删除预览.png') });
    await confirmColumnChanges.click();
    await expect(structure.getByRole('table')).toContainText('character varying(16)');
    await expect(structure.getByRole('table')).toContainText('新默认值');
    await expect(structure.getByRole('table')).not.toContainText('可删除');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await expect(gridTab.getByRole('columnheader', { name: '字段确认 character varying(16)', exact: true })).toBeVisible();
    await expect(gridTab.getByRole('columnheader', { name: /^可删除(?:\s|$)/ })).toHaveCount(0);
    await mark('已有字段类型和默认值更新后回读，删除独立确认，原表页已去除被删字段');
    // 原生窗口经过真实表单、实际 SQL 预览和同一目录回读验收索引写入。
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.indexes, exact: true }).click();
    await structure.getByRole('button', { name: indexText.open, exact: true }).click();
    const indexEdit = structure.getByRole('region', { name: indexText.title });
    const indexAction = indexEdit.getByLabel(indexText.operation, { exact: true });
    const indexStage = indexEdit.getByRole('button', { name: indexText.stage, exact: true });
    const indexPreview = indexEdit.getByRole('button', { name: indexText.preview, exact: true });
    const indexApply = indexEdit.getByRole('button', { name: indexText.apply, exact: true });
    await expect(indexAction.locator('option[value=drop]')).toHaveJSProperty('disabled', true);
    await indexEdit.getByLabel(indexText.name, { exact: true }).fill('窗口索引草稿');
    await indexEdit.getByLabel(indexText.key(1), { exact: true }).selectOption('note');
    await indexEdit.getByLabel(indexText.order(1), { exact: true }).selectOption('desc');
    await indexEdit.getByLabel(indexText.nulls(1), { exact: true }).selectOption('last');
    await indexEdit.getByRole('button', { name: indexText.addKey, exact: true }).click();
    await indexEdit.getByLabel(indexText.key(2), { exact: true }).selectOption('id');
    await indexEdit.getByRole('button', { name: indexText.addInclude, exact: true }).click();
    await indexEdit.getByLabel(indexText.include(1), { exact: true }).selectOption('字段确认');
    await indexStage.click();
    await indexAction.selectOption('rename');
    await indexEdit.getByLabel(indexText.from, { exact: true }).selectOption('窗口索引草稿');
    await indexEdit.getByLabel(indexText.name, { exact: true }).fill('窗口索引确认');
    await indexStage.click();
    await indexPreview.click();
    await expect(indexEdit.getByLabel(indexText.previewTitle)).toContainText('"note" DESC NULLS LAST, "id" ASC) INCLUDE ("字段确认")');
    await expect(indexEdit.getByLabel(indexText.previewTitle)).toContainText('RENAME TO "窗口索引确认"');
    await page.screenshot({ path: info.outputPath('PostgreSQL索引创建与重命名预览.png') });
    await indexApply.click();
    await expect(structure.getByRole('table')).toContainText('窗口索引确认');
    await expect(structure.getByRole('table')).toContainText('INCLUDE');
    await structure.getByRole('button', { name: indexText.open, exact: true }).click();
    await indexAction.selectOption('drop');
    await expect(indexEdit.getByLabel(indexText.from, { exact: true }).locator('option')).toHaveCount(1);
    await indexStage.click();
    await indexPreview.click();
    await expect(indexEdit.getByLabel(indexText.previewTitle)).toContainText('DROP INDEX "回归"."窗口索引确认" RESTRICT');
    await expect(indexApply).toBeDisabled();
    await indexEdit.getByLabel(indexText.confirmDrop, { exact: true }).check();
    await indexApply.click();
    await expect(structure.getByRole('table')).toContainText('窗口新表_pkey');
    await expect(structure.getByRole('table')).not.toContainText('窗口索引确认');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await mark('实际索引创建与重命名同批提交，删除单独确认，主键关联索引不进入删除列表');
    // 验收从约束目录更换复合主键，并核对唯一约束和相关目录回读。
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.constraints, exact: true }).click();
    await structure.getByRole('button', { name: keyText.open, exact: true }).click();
    const keyEdit = structure.getByRole('region', { name: keyText.title });
    const keyAction = keyEdit.getByLabel(keyText.operation, { exact: true });
    const keyStage = keyEdit.getByRole('button', { name: keyText.stage, exact: true });
    await keyAction.selectOption('drop');
    await keyEdit.getByLabel(keyText.from, { exact: true }).selectOption('窗口新表_pkey');
    await keyStage.click();
    await keyAction.selectOption('create');
    await keyEdit.getByLabel(keyText.name, { exact: true }).fill('窗口复合主键');
    await keyEdit.getByLabel(keyText.key(1), { exact: true }).selectOption('note');
    await keyEdit.getByRole('button', { name: keyText.addColumn, exact: true }).click();
    await keyEdit.getByLabel(keyText.key(2), { exact: true }).selectOption('id');
    await keyStage.click();
    await keyEdit.getByLabel(keyText.keyType, { exact: true }).selectOption('u');
    await keyEdit.getByLabel(keyText.name, { exact: true }).fill('窗口唯一约束');
    await keyEdit.getByRole('button', { name: keyText.removeColumn(2), exact: true }).click();
    await keyEdit.getByLabel(keyText.key(1), { exact: true }).selectOption('字段确认');
    await keyEdit.getByLabel(keyText.timing, { exact: true }).selectOption('deferred');
    await keyEdit.getByLabel(keyText.nullsNotDistinct, { exact: true }).check();
    await keyStage.click();
    await keyEdit.getByRole('button', { name: keyText.preview, exact: true }).click();
    const keySql = keyEdit.getByLabel(keyText.previewTitle);
    await expect(keySql).toContainText('DROP CONSTRAINT "窗口新表_pkey" RESTRICT');
    await expect(keySql).toContainText('PRIMARY KEY ("note", "id")');
    await expect(keySql).toContainText('UNIQUE NULLS NOT DISTINCT ("字段确认") DEFERRABLE INITIALLY DEFERRED');
    const keyApply = keyEdit.getByRole('button', { name: keyText.apply, exact: true });
    await expect(keyApply).toBeDisabled();
    await keyEdit.getByLabel(keyText.confirmDrop, { exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL主键与唯一约束预览.png') });
    await keyApply.click();
    await expect(structure.getByRole('table')).toContainText('窗口复合主键');
    await expect(structure.getByRole('table')).toContainText('窗口唯一约束');
    await expect(structure.getByRole('table')).toContainText('PRIMARY KEY (note, id)');
    await expect(structure.getByRole('table')).not.toContainText('窗口新表_pkey');
    await structure.getByRole('button', { name: postgresStructureZh.sections.indexes, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('窗口复合主键');
    await expect(structure.getByRole('table')).toContainText('窗口唯一约束');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await mark('窗口确认复合主键替换与可延迟唯一约束，约束和关联索引均从真实目录回读');
    // 使用实际候选创建复合自引用外键，再分开验证和删除。
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.constraints, exact: true }).click();
    await structure.getByRole('button', { name: fkText.open, exact: true }).click();
    const fkEdit = structure.getByRole('region', { name: fkText.title });
    const fkOperation = fkEdit.getByLabel(fkText.operation, { exact: true });
    const fkStage = fkEdit.getByRole('button', { name: fkText.stage, exact: true });
    const fkPreview = fkEdit.getByRole('button', { name: fkText.preview, exact: true });
    const fkApply = fkEdit.getByRole('button', { name: fkText.apply, exact: true });
    const fkSql = fkEdit.getByLabel(fkText.previewTitle);
    await fkEdit.getByLabel(fkText.name, { exact: true }).fill('窗口复合外键');
    await fkEdit.getByLabel(fkText.search, { exact: true }).fill('窗口新表');
    await fkEdit.getByRole('button', { name: fkText.find, exact: true }).click();
    await fkEdit.getByLabel(fkText.table, { exact: true }).selectOption({ label: '"回归"."窗口新表"' });
    await fkEdit.getByLabel(fkText.key, { exact: true }).selectOption({ label: '"note", "id"' });
    await fkEdit.getByLabel(fkText.local(1), { exact: true }).selectOption('note');
    await fkEdit.getByLabel(fkText.local(2), { exact: true }).selectOption('id');
    await fkEdit.getByLabel(fkText.match, { exact: true }).selectOption('f');
    await fkEdit.getByLabel(fkText.onUpdate, { exact: true }).selectOption('c');
    await fkEdit.getByLabel(fkText.notValid, { exact: true }).check();
    await fkStage.click();
    await fkPreview.click();
    await expect(fkSql).toContainText('FOREIGN KEY ("note", "id") REFERENCES "回归"."窗口新表" ("note", "id") MATCH FULL');
    await expect(fkSql).toContainText('ON UPDATE CASCADE ON DELETE NO ACTION NOT VALID');
    await page.screenshot({ path: info.outputPath('PostgreSQL复合外键预览.png') });
    await fkApply.click();
    const fkRow = structure.getByRole('row').filter({ hasText: '窗口复合外键' });
    await expect(fkRow).toContainText(postgresStructureZh.unvalidated);
    await structure.getByRole('button', { name: fkText.open, exact: true }).click();
    await fkOperation.selectOption('validate');
    await fkStage.click();
    await fkPreview.click();
    await expect(fkSql).toContainText('VALIDATE CONSTRAINT "窗口复合外键"');
    await fkApply.click();
    await expect(fkRow).toBeVisible();
    await expect(fkRow).not.toContainText(postgresStructureZh.unvalidated);
    await structure.getByRole('button', { name: fkText.open, exact: true }).click();
    await fkOperation.selectOption('drop');
    await fkStage.click();
    await fkPreview.click();
    await expect(fkApply).toBeDisabled();
    await fkEdit.getByLabel(fkText.confirmDrop, { exact: true }).check();
    await fkApply.click();
    await expect(structure.getByRole('table')).toContainText('窗口复合主键');
    await expect(fkRow).toHaveCount(0);
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await mark('原生目录选择复合唯一键并映射外键，分步创建、验证、确认删除均回读实际状态');
    // 原生窗口创建暂未验证的 CHECK，读取原表达式后替换并回读实际定义。
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.constraints, exact: true }).click();
    await structure.getByRole('button', { name: checkText.open, exact: true }).click();
    const checkEdit = structure.getByRole('region', { name: checkText.title });
    const checkAction = checkEdit.getByLabel(checkText.operation, { exact: true });
    const checkStage = checkEdit.getByRole('button', { name: checkText.stage, exact: true });
    const checkPreview = checkEdit.getByRole('button', { name: checkText.preview, exact: true });
    const checkApply = checkEdit.getByRole('button', { name: checkText.apply, exact: true });
    const checkSql = checkEdit.getByLabel(checkText.previewTitle);
    const checkExpression = checkEdit.getByRole('textbox', { name: checkText.expression, exact: true });
    await checkEdit.getByLabel(checkText.name, { exact: true }).fill('窗口检查约束');
    await checkExpression.fill('length(note) > 0 -- 窗口注释');
    await checkEdit.getByLabel(checkText.notValid, { exact: true }).check();
    await checkStage.click();
    await checkPreview.click();
    await expect(checkSql).toContainText('length(note) > 0 -- 窗口注释');
    await expect(checkSql).toContainText(') NOT VALID');
    await checkApply.click();
    const checkRow = structure.getByRole('row').filter({ hasText: '窗口检查约束' });
    await expect(checkRow).toContainText(postgresStructureZh.unvalidated);
    await structure.getByRole('button', { name: checkText.open, exact: true }).click();
    await checkAction.selectOption('validate');
    await checkStage.click();
    await checkPreview.click();
    await expect(checkSql).toContainText('VALIDATE CONSTRAINT "窗口检查约束"');
    await checkApply.click();
    await expect(checkRow).toBeVisible();
    await expect(checkRow).not.toContainText(postgresStructureZh.unvalidated);
    await structure.getByRole('button', { name: checkText.open, exact: true }).click();
    await checkAction.selectOption('replace');
    await expect(checkExpression).toHaveValue(/length\(note\) > 0/);
    await checkExpression.fill('id >= 1');
    await checkStage.click();
    await checkPreview.click();
    await expect(checkSql).toContainText('DROP CONSTRAINT "窗口检查约束" RESTRICT');
    await expect(checkSql).toContainText('id >= 1');
    await expect(checkApply).toBeDisabled();
    await checkEdit.getByLabel(checkText.confirmDrop, { exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL检查约束替换预览.png') });
    await checkApply.click();
    await expect(checkRow).toContainText('id >= 1');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await mark('CHECK 暂缓验证、单独验证和预填原表达式的原子替换经原生窗口与真实目录核对');
    await page.locator('.tab-strip .tab-close').click();
    await mark('数据库右键建表经过真实 SQL 预览和确认，新表目录自动刷新，实际结构可读');

    await clickSidebarAction(databaseNode, { name: createViewText.title, exact: true }, undefined, check);
    const viewCreate = page.getByRole('dialog', { name: createViewText.title, exact: true });
    await viewCreate.getByLabel(createViewText.schema, { exact: true }).selectOption('回归');
    await viewCreate.getByLabel(createViewText.name, { exact: true }).fill('窗口新视图');
    await viewCreate.getByLabel(createViewText.comment, { exact: true }).fill('窗口创建的视图');
    await viewCreate.getByLabel(createViewText.definition, { exact: true }).fill('SELECT id, note FROM "回归"."带""引号" WHERE id = 1;');
    await viewCreate.getByRole('button', { name: createViewText.preview, exact: true }).click();
    await expect(viewCreate.locator('.pg-create-sql')).toContainText('CREATE VIEW "回归"."窗口新视图"');
    await expect(viewCreate.locator('.pg-create-sql')).toContainText('COMMENT ON VIEW "回归"."窗口新视图"');
    await expect(page.locator('.object-row').filter({ hasText: '窗口新视图' })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('PostgreSQL图形化创建视图.png') });
    await viewCreate.getByRole('button', { name: createViewText.apply, exact: true }).click();
    await expect(viewCreate).toHaveCount(0);
    await expect(page.locator('.object-row').filter({ hasText: '窗口新视图' })).toBeVisible();
    await expect(gridTab.locator('.context-bar')).toContainText('"回归"."窗口新视图"');
    await expect(gridTab.getByRole('grid')).toContainText('原值');
    await mark('PostgreSQL 侧栏创建普通视图，预览确认后目录刷新并读取真实视图记录');
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.definition, exact: true }).click();
    await structure.getByRole('button', { name: viewEditText.title, exact: true }).click();
    const viewEdit = structure.getByRole('region', { name: viewEditText.title, exact: true });
    const viewQuery = viewEdit.getByRole('textbox', { name: viewEditText.definition, exact: true });
    await expect(viewQuery).toHaveValue(/"回归"\."带""引号"/);
    await viewQuery.fill(`SELECT id, note || '·视图定义更新' AS note FROM "回归"."带""引号" WHERE id = 1`);
    await viewEdit.getByRole('button', { name: viewEditText.preview, exact: true }).click();
    await expect(viewEdit.locator('pre')).toContainText('CREATE OR REPLACE VIEW "回归"."窗口新视图"');
    await expect(gridTab.getByRole('grid')).not.toContainText('视图定义更新');
    await page.screenshot({ path: info.outputPath('PostgreSQL编辑视图定义.png') });
    await viewEdit.getByRole('button', { name: viewEditText.apply, exact: true }).click();
    await expect(viewEdit).toHaveCount(0);
    await expect(structure.locator('.monaco-editor .view-lines')).toContainText('视图定义更新');
    await expect(structure.locator('.pg-structure-comment')).toContainText('窗口创建的视图');
    await structure.locator('.modal-footer').getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    await expect(gridTab.getByRole('grid')).toContainText('原值·视图定义更新');
    await mark('原生编辑 PostgreSQL 普通视图，提交后实际定义、原注释及已打开的记录页一致');
    const oldViewRow = page.locator('.object-row').filter({ hasText: '窗口新视图' });
    const renamedViewRow = page.locator('.object-row').filter({ hasText: '窗口已改名视图' });
    const openViewManager = async () => {
      await tableButton(postgresStructureZh.open).click();
      await structure.getByRole('button', { name: viewManageText.title, exact: true }).click();
      return structure.getByRole('region', { name: viewManageText.title, exact: true });
    };
    const renameView = await openViewManager();
    await renameView.getByRole('textbox', { name: viewManageText.name, exact: true }).fill('窗口已改名视图');
    await renameView.getByRole('button', { name: viewManageText.preview, exact: true }).click();
    await expect(renameView.locator('pre')).toContainText('RENAME TO "窗口已改名视图"');
    await expect(oldViewRow).toBeVisible();
    await renameView.getByRole('button', { name: viewManageText.confirmRename, exact: true }).click();
    await expect(structure).toHaveCount(0);
    await expect(oldViewRow).toHaveCount(0);
    await expect(renamedViewRow).toBeVisible();
    await expect(gridTab.locator('.context-bar')).toContainText('"回归"."窗口已改名视图"');
    await expect(gridTab.getByRole('grid')).toContainText('原值·视图定义更新');
    await mark('重命名普通视图后真实目录和记录页切换到新名称');
    const dropView = await openViewManager();
    await dropView.getByRole('combobox', { name: viewManageText.operation, exact: true }).selectOption('drop');
    await dropView.getByRole('button', { name: viewManageText.preview, exact: true }).click();
    await expect(dropView.locator('pre')).toContainText('DROP VIEW "回归"."窗口已改名视图" RESTRICT');
    const confirmDrop = dropView.getByRole('button', { name: viewManageText.confirmDrop, exact: true });
    await expect(confirmDrop).toBeDisabled();
    await expect(renamedViewRow).toBeVisible();
    await dropView.getByRole('checkbox', { name: viewManageText.acknowledge, exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL管理视图.png') });
    await confirmDrop.click();
    await expect(structure).toHaveCount(0);
    await expect(renamedViewRow).toHaveCount(0);
    await expect(page.locator('.tab-strip .tab-close')).toHaveCount(0);
    await mark('受限删除需明确勾选，确认后实际目录移除视图并关闭记录页');
    const materializedRow = (name: string) => page.locator('.object-row').filter({ hasText: name });
    const createMaterialized = async (name: string, populate: boolean) => {
      // 上一步 DDL 刷新对象目录，等真实对象回到树上再打开菜单。
      await expect(materializedRow('物化快照')).toBeVisible();
      await clickSidebarAction(databaseNode, { name: createViewText.materializedTitle, exact: true }, undefined, check);
      const dialog = page.getByRole('dialog', { name: createViewText.materializedTitle, exact: true });
      await dialog.getByLabel(createViewText.schema, { exact: true }).selectOption('回归');
      await dialog.getByRole('textbox', { name: createViewText.materializedName, exact: true }).fill(name);
      await dialog.getByRole('textbox', { name: createViewText.comment, exact: true }).fill('窗口创建的物化视图');
      await dialog.getByRole('textbox', { name: createViewText.definition, exact: true })
        .fill('SELECT id, note FROM "回归"."带""引号" WHERE id = 1');
      const fill = dialog.getByRole('checkbox', { name: createViewText.populate, exact: true });
      await expect(fill).toBeChecked();
      if (!populate) await fill.uncheck();
      await dialog.getByRole('button', { name: createViewText.preview, exact: true }).click();
      const sql = dialog.locator('.pg-create-sql');
      await expect(sql).toContainText('CREATE MATERIALIZED VIEW "回归"."' + name + '"');
      await expect(sql).toContainText(populate ? 'WITH DATA' : 'WITH NO DATA');
      await expect(sql).toContainText('COMMENT ON MATERIALIZED VIEW "回归"."' + name + '"');
      await expect(materializedRow(name)).toHaveCount(0);
      if (!populate) await page.screenshot({ path: info.outputPath('PostgreSQL创建物化视图.png') });
      await dialog.getByRole('button', { name: createViewText.materializedApply, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(materializedRow(name)).toBeVisible();
      await expect(gridTab.locator('.context-bar')).toContainText('"回归"."' + name + '"');
    };
    await createMaterialized('窗口已填充物化', true);
    await expect(gridTab.getByRole('grid')).toContainText('原值');
    await page.locator('.tab-strip .tab-close').click();
    await mark('窗口创建并立即填充物化视图，提交后直接读取真实记录');
    await createMaterialized('窗口待填充物化', false);
    await expect(gridTab).toContainText(refreshText.empty);
    await tableButton(postgresStructureZh.open).click();
    await expect(structure).toContainText(refreshText.empty);
    await expect(structure.locator('.pg-structure-comment')).toContainText('窗口创建的物化视图');
    await expect(structure.getByRole('button', { name: refreshText.title, exact: true })).toBeEnabled();
    await mark('窗口创建未填充物化视图，实际结构、原注释、记录页提示和刷新入口一致');
    await structure.getByRole('button', { name: postgresStructureZh.sections.indexes, exact: true }).click();
    await structure.getByRole('button', { name: indexText.open, exact: true }).click();
    await indexEdit.getByLabel(indexText.name, { exact: true }).fill('窗口物化唯一');
    await indexEdit.getByLabel(indexText.key(1), { exact: true }).selectOption('id');
    await indexEdit.getByRole('checkbox', { name: indexText.unique, exact: true }).check();
    await indexStage.click();
    await indexPreview.click();
    await expect(indexEdit.locator('pre')).toContainText('ALTER MATERIALIZED VIEW "回归"."窗口待填充物化" SET SCHEMA "回归"');
    await expect(indexEdit.locator('pre')).toContainText('CREATE UNIQUE INDEX "窗口物化唯一"');
    await page.screenshot({ path: info.outputPath('PostgreSQL物化视图索引.png') });
    await indexApply.click();
    await expect(structure.getByRole('table')).toContainText('窗口物化唯一');
    await expect(gridTab).toContainText(refreshText.empty);
    await mark('在新建且未填充的物化视图中图形化创建真实唯一索引，目录回读成功');

    const closeMaterializedStructure = () => structure.locator('.modal-footer')
      .getByRole('button', { name: postgresStructureZh.close, exact: true }).click();
    const openMaterializedRefresh = async () => {
      await structure.getByRole('button', { name: refreshText.title, exact: true }).click();
      return structure.getByRole('region', { name: refreshText.title, exact: true });
    };
    const refreshMode = (panel: import('@playwright/test').Locator) => panel.getByRole('combobox', { name: refreshText.mode, exact: true });
    const prepareRefresh = (panel: import('@playwright/test').Locator) => panel.getByRole('button', { name: refreshText.preview, exact: true }).click();
    const confirmRefresh = (panel: import('@playwright/test').Locator) => panel.getByRole('button', { name: refreshText.confirm, exact: true }).click();
    await expect(structure).toContainText(refreshText.empty);
    const firstRefresh = await openMaterializedRefresh();
    await expect(refreshMode(firstRefresh).locator('option[value="concurrent"]')).toHaveJSProperty('disabled', true);
    await prepareRefresh(firstRefresh);
    await expect(firstRefresh.locator('pre')).toContainText('REFRESH MATERIALIZED VIEW "回归"."窗口待填充物化" WITH DATA');
    await confirmRefresh(firstRefresh);
    await expect(structure).toContainText(refreshText.populated);
    await closeMaterializedStructure();
    await expect(gridTab.getByRole('grid')).toContainText('原值');

    await tableButton(postgresStructureZh.open).click();
    await expect(structure).toContainText(refreshText.eligible);
    const concurrentRefresh = await openMaterializedRefresh();
    await refreshMode(concurrentRefresh).selectOption('concurrent');
    await prepareRefresh(concurrentRefresh);
    await expect(concurrentRefresh.locator('pre')).toContainText('REFRESH MATERIALIZED VIEW CONCURRENTLY "回归"."窗口待填充物化" WITH DATA');
    await page.screenshot({ path: info.outputPath('PostgreSQL刷新物化视图.png') });
    await confirmRefresh(concurrentRefresh);
    await expect(structure).toContainText(refreshText.populated);
    await closeMaterializedStructure();
    await expect(gridTab.getByRole('grid')).toContainText('原值');

    await tableButton(postgresStructureZh.open).click();
    const clearMaterialized = await openMaterializedRefresh();
    await refreshMode(clearMaterialized).selectOption('empty');
    await prepareRefresh(clearMaterialized);
    await expect(clearMaterialized.locator('pre')).toContainText('REFRESH MATERIALIZED VIEW "回归"."窗口待填充物化" WITH NO DATA');
    const confirmEmpty = clearMaterialized.getByRole('button', { name: refreshText.confirmEmpty, exact: true });
    await expect(confirmEmpty).toBeDisabled();
    await clearMaterialized.getByRole('checkbox', { name: refreshText.acknowledge, exact: true }).check();
    await confirmEmpty.click();
    await expect(structure).toContainText(refreshText.empty);
    await closeMaterializedStructure();
    await expect(gridTab).toContainText(refreshText.empty);
    await page.locator('.tab-strip .tab-close').click();
    await mark('物化视图从未填充到普通和并发刷新，再明确清除；结构状态及打开的记录页一致');
    const seedMaterialized = materializedRow('物化快照');
    const renamedMaterialized = materializedRow('窗口物化已改名');
    await seedMaterialized.locator('.tree-label').click();
    await expect(gridTab).toContainText(refreshText.empty);
    const renameMaterialized = await openViewManager();
    await renameMaterialized.getByRole('textbox', { name: viewManageText.name, exact: true }).fill('窗口物化已改名');
    await renameMaterialized.getByRole('button', { name: viewManageText.preview, exact: true }).click();
    await expect(renameMaterialized.locator('pre')).toContainText('ALTER MATERIALIZED VIEW "回归"."物化快照" RENAME TO "窗口物化已改名"');
    await expect(seedMaterialized).toBeVisible();
    await renameMaterialized.getByRole('button', { name: viewManageText.confirmRename, exact: true }).click();
    await expect(structure).toHaveCount(0);
    await expect(renamedMaterialized).toBeVisible();
    await expect(seedMaterialized).toHaveCount(0);
    await expect(gridTab.locator('.context-bar')).toContainText('"回归"."窗口物化已改名"');
    await expect(gridTab).toContainText(refreshText.empty);
    await tableButton(postgresStructureZh.open).click();
    await structure.getByRole('button', { name: postgresStructureZh.sections.indexes, exact: true }).click();
    await expect(structure.getByRole('table')).toContainText('物化唯一索引');
    await closeMaterializedStructure();
    await mark('物化视图改名后目录和记录页切换，索引及原填充状态一致');

    const removeMaterialized = await openViewManager();
    await removeMaterialized.getByRole('combobox', { name: viewManageText.operation, exact: true }).selectOption('drop');
    await removeMaterialized.getByRole('button', { name: viewManageText.preview, exact: true }).click();
    await expect(removeMaterialized.locator('pre')).toContainText('DROP MATERIALIZED VIEW "回归"."窗口物化已改名" RESTRICT');
    const confirmMaterializedDrop = removeMaterialized.getByRole('button', { name: viewManageText.confirmDrop, exact: true });
    await expect(confirmMaterializedDrop).toBeDisabled();
    await removeMaterialized.getByRole('checkbox', { name: viewManageText.acknowledge, exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL管理物化视图.png') });
    await confirmMaterializedDrop.click();
    await expect(structure).toHaveCount(0);
    await expect(renamedMaterialized).toHaveCount(0);
    await expect(page.locator('.tab-strip .tab-close')).toHaveCount(0);
    await mark('原生窗口确认受限删除物化视图，目录和打开的记录页一并更新');
    await expect(materializedRow('窗口已填充物化')).toBeVisible();
    await clickSidebarAction(databaseNode, { name: sequenceText.create, exact: true }, undefined, check);
    const sequenceForm = page.getByRole('dialog', { name: sequenceText.create, exact: true });
    await sequenceForm.getByLabel(sequenceText.schema, { exact: true }).selectOption('回归');
    await sequenceForm.getByLabel(sequenceText.name, { exact: true }).fill('窗口精确序列');
    await sequenceForm.getByLabel(sequenceText.start, { exact: true }).fill('9223372036854775806');
    await sequenceForm.getByLabel(sequenceText.comment, { exact: true }).fill('窗口序列注释');
    await sequenceForm.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(sequenceForm.locator('pre')).toContainText('START WITH 9223372036854775806');
    const sequenceRow = page.locator('.object-row').filter({ hasText: '窗口精确序列' });
    await expect(sequenceRow).toHaveCount(0);
    await sequenceForm.getByRole('button', { name: sequenceText.apply, exact: true }).click();
    const sequenceInfo = page.getByRole('dialog', { name: sequenceText.title, exact: true });
    await expect(sequenceInfo.getByRole('table')).toContainText('9223372036854775806');
    await expect(sequenceInfo.getByRole('table')).toContainText(sequenceText.noValue);
    await expect(sequenceInfo.getByRole('table')).toContainText('窗口序列注释');
    await page.screenshot({ path: info.outputPath('PostgreSQL序列详情.png') });
    await sequenceInfo.getByRole('button', { name: zh.common.close, exact: true }).click();
    await expect(sequenceRow).toBeVisible();
    await clickSidebarAction(sequenceRow, { name: sequenceText.open + ' "回归"."窗口精确序列"', exact: true }, undefined, check);
    await expect(sequenceInfo.getByRole('table')).toContainText('9223372036854775806');
    await sequenceInfo.getByRole('button', { name: zh.common.close, exact: true }).click();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: '序列', exact: true }, check)).click();
    const browserSequence = page.locator('.object-list-row .tree-label').filter({ hasText: '窗口精确序列' });
    await expect(browserSequence).toBeVisible();
    await browserSequence.dblclick();
    await expect(sequenceInfo.getByRole('table')).toContainText('9223372036854775806');
    await mark('原生创建 PostgreSQL 序列并从树和序列目录重新打开，64 位起始值与未分配状态保持');

    await sequenceInfo.getByRole('button', { name: sequenceText.edit, exact: true }).click();
    const editSequence = page.getByRole('dialog', { name: sequenceText.edit, exact: true });
    await editSequence.getByLabel(sequenceText.start, { exact: true }).fill('9223372036854775803');
    await editSequence.getByLabel(sequenceText.restart, { exact: true }).fill('9223372036854775804');
    await editSequence.getByLabel(sequenceText.comment, { exact: true }).fill('窗口改后注释');
    await editSequence.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(editSequence.locator('pre')).toContainText('START WITH 9223372036854775803');
    await expect(editSequence.locator('pre')).toContainText('RESTART WITH 9223372036854775804');
    const commitSequenceEdit = editSequence.getByRole('button', { name: sequenceText.applyEdit, exact: true });
    await expect(commitSequenceEdit).toBeDisabled();
    await editSequence.getByRole('checkbox', { name: sequenceText.acknowledgeRestart, exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL序列管理预览.png') });
    await commitSequenceEdit.click();
    await expect(sequenceInfo.getByRole('table')).toContainText('9223372036854775803');
    await expect(sequenceInfo.getByRole('table')).toContainText('窗口改后注释');
    await expect(sequenceInfo.getByRole('table')).toContainText(sequenceText.noValue);
    await mark('原生窗口以不同精确值更新记录起始值和下次取号，重启需要单独确认');

    await sequenceInfo.getByRole('button', { name: sequenceText.rename, exact: true }).click();
    const renameSequence = page.getByRole('dialog', { name: sequenceText.rename, exact: true });
    await renameSequence.getByLabel(sequenceText.name, { exact: true }).fill('窗口改名序列');
    await renameSequence.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(renameSequence.locator('pre')).toContainText('RENAME TO "窗口改名序列"');
    await renameSequence.getByRole('button', { name: sequenceText.applyRename, exact: true }).click();
    await expect(sequenceInfo.getByText(/窗口改名序列/)).toBeVisible();
    await expect(sequenceInfo.getByRole('table')).toContainText('窗口改后注释');

    await sequenceInfo.getByRole('button', { name: sequenceText.ownership, exact: true }).click();
    const sequenceOwnership = page.getByRole('dialog', { name: sequenceText.ownership, exact: true });
    await sequenceOwnership.getByLabel(sequenceText.targetSearch, { exact: true }).fill('带"引号');
    const expectedBinding = '"回归"."带""引号"."id"';
    await sequenceOwnership.getByLabel(sequenceText.targetChoice, { exact: true }).selectOption({ label: expectedBinding });
    await sequenceOwnership.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(sequenceOwnership.locator('pre')).toContainText('OWNED BY ' + expectedBinding);
    const confirmOwnership = sequenceOwnership.getByRole('button', { name: sequenceText.applyOwnership, exact: true });
    await expect(confirmOwnership).toBeDisabled();
    await sequenceOwnership.getByRole('checkbox', { name: sequenceText.acknowledgeOwnership, exact: true }).check();
    await page.screenshot({ path: info.outputPath('PostgreSQL序列归属预览.png') });
    await confirmOwnership.click();
    await expect(sequenceInfo.getByRole('table')).toContainText(expectedBinding);
    await sequenceInfo.getByRole('button', { name: sequenceText.ownership, exact: true }).click();
    const ownershipMode = sequenceOwnership.getByLabel(sequenceText.ownershipMode, { exact: true });
    await expect(ownershipMode.locator('option[value="owner"]')).toHaveCount(0);
    await ownershipMode.selectOption('detach');
    await sequenceOwnership.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(sequenceOwnership.locator('pre')).toContainText('OWNED BY NONE');
    await sequenceOwnership.getByRole('checkbox', { name: sequenceText.acknowledgeOwnership, exact: true }).check();
    await confirmOwnership.click();
    await expect(sequenceInfo.getByRole('row').filter({ hasText: sequenceText.ownedBy })).toContainText('—');
    await mark('原生按名称搜索同 schema 的字段并绑定或解绑，按目录回读呈现所属字段');

    await sequenceInfo.getByRole('button', { name: zh.common.close, exact: true }).click();
    await expect(sequenceRow).toHaveCount(0);
    await expect(page.locator('.object-row').filter({ hasText: '窗口改名序列' })).toBeVisible();
    await expect(browserSequence).toHaveCount(0);
    await expect(page.locator('.object-list-row .tree-label').filter({ hasText: '窗口改名序列' })).toBeVisible();
    await mark('原生窗口重命名序列后回到新名称详情，对象树及序列列表同步刷新');

    await page.locator('.object-list-row .tree-label').filter({ hasText: '窗口依赖序列' }).dblclick();
    await sequenceInfo.getByRole('button', { name: dependenciesText.open, exact: true }).click();
    await expect(referencedBy.getByRole('row').filter({ hasText: '窗口依赖表' })).toContainText('字段默认值');
    await expect(referencedBy.getByRole('row').filter({ hasText: '窗口依赖视图' })).toContainText('视图');
    await dependencyDialog.getByRole('button', { name: zh.common.refresh, exact: true }).click();
    await expect(referencedBy.getByRole('row').filter({ hasText: '窗口依赖视图' })).toContainText('普通依赖');
    await page.screenshot({ path: info.outputPath('PostgreSQL对象依赖.png') });
    await dependencyDialog.getByRole('button', { name: dependenciesText.back, exact: true }).click();
    await sequenceInfo.getByRole('button', { name: zh.common.close, exact: true }).click();
    await mark('原生序列依赖区分字段默认值和引用视图，刷新后仍保留真实目录结果');

    const disposableSequence = page.locator('.object-list-row .tree-label').filter({ hasText: '窗口删除序列' });
    await disposableSequence.dblclick();
    await sequenceInfo.getByRole('button', { name: sequenceText.drop, exact: true }).click();
    const dropSequence = page.getByRole('dialog', { name: sequenceText.drop, exact: true });
    await dropSequence.getByRole('button', { name: sequenceText.preview, exact: true }).click();
    await expect(dropSequence.locator('pre')).toContainText('DROP SEQUENCE "回归"."窗口删除序列" RESTRICT');
    await dropSequence.getByRole('button', { name: dependenciesText.open, exact: true }).click();
    await expect(referencedBy).toContainText(dependenciesText.empty);
    await dependencyDialog.getByRole('button', { name: dependenciesText.back, exact: true }).click();
    await expect(dropSequence.locator('pre')).toContainText('DROP SEQUENCE "回归"."窗口删除序列" RESTRICT');
    const commitSequenceDrop = dropSequence.getByRole('button', { name: sequenceText.applyDrop, exact: true });
    await expect(commitSequenceDrop).toBeDisabled();
    await dropSequence.getByRole('checkbox', { name: sequenceText.acknowledge, exact: true }).check();
    await commitSequenceDrop.click();
    await expect(dropSequence).toHaveCount(0);
    await expect(disposableSequence).toHaveCount(0);
    await expect(page.locator('.object-row').filter({ hasText: '窗口删除序列' })).toHaveCount(0);
    await mark('原生窗口独立确认受限删除序列，刷新对象树和序列列表');

    const recipientRole = process.env.DBARK_POSTGRES_SEQUENCE_OWNER;
    if (recipientRole === database + '_sequence_owner') {
      const sequenceToTransfer = page.locator('.object-list-row .tree-label').filter({ hasText: '窗口转移序列' });
      await sequenceToTransfer.dblclick();
      await expect(sequenceInfo.getByRole('row').filter({ hasText: sequenceText.owner })).toContainText(database);
      await sequenceInfo.getByRole('button', { name: sequenceText.ownership, exact: true }).click();
      await ownershipMode.selectOption('owner');
      await sequenceOwnership.getByLabel(sequenceText.targetSearch, { exact: true }).fill('_sequence_owner');
      await sequenceOwnership.getByLabel(sequenceText.targetChoice, { exact: true }).selectOption({ label: recipientRole });
      await sequenceOwnership.getByRole('button', { name: sequenceText.preview, exact: true }).click();
      await expect(sequenceOwnership.locator('pre')).toContainText('OWNER TO "' + recipientRole + '"');
      await expect(confirmOwnership).toBeDisabled();
      await sequenceOwnership.getByRole('checkbox', { name: sequenceText.acknowledgeOwnership, exact: true }).check();
      await confirmOwnership.click();
      await expect(page.getByText('PostgreSQL 序列所有者已确认更新', { exact: true })).toBeVisible();
      await expect(sequenceOwnership).toHaveCount(0);
      await expect(sequenceToTransfer).toHaveCount(0);
      await expect(page.locator('.object-row').filter({ hasText: '窗口转移序列' })).toHaveCount(0);
      await mark('原生转移序列角色后确认提交，原角色失去查看权限时两个目录同步移除');
    }
    await page.locator('.tab-strip .tab-close').click();

    const routineHistory = await page.evaluate(() => window.dbark.invoke('history.list', {}));
    const textSignature = '"回归"."窗口补全函数"(text)', integerSignature = '"回归"."窗口补全函数"(integer)';
    const routineDefinition = page.getByRole('dialog', { name: routineText.title, exact: true });
    const textRoutineNode = page.locator('.object-row').filter({ hasText: '窗口补全函数"(text)' });
    await clickSidebarAction(textRoutineNode, { name: routineText.open + ' ' + textSignature, exact: true }, undefined, check);
    await expect(routineDefinition.getByRole('row').filter({ hasText: routineText.returns })).toContainText('text');
    await expect(routineDefinition.locator('.monaco-editor .view-lines')).toContainText('CREATE OR REPLACE FUNCTION');
    await routineDefinition.getByRole('button', { name: zh.common.close, exact: true }).click();

    await page.locator('.navigation-toolbar').getByRole('button', { name: navigationZh.routine, exact: true }).click();
    const routineFilter = page.getByRole('textbox', { name: navigationZh.search, exact: true });
    await routineFilter.fill('窗口补全函数');
    const routineRows = page.locator('.object-list-row .tree-label');
    await expect(routineRows).toHaveCount(2);
    await routineRows.filter({ hasText: integerSignature }).dblclick();
    await expect(routineDefinition.getByRole('row').filter({ hasText: routineText.returns })).toContainText('integer');
    await expect(routineDefinition.getByRole('table')).toContainText('整数重载定义');
    await expect(routineDefinition.getByRole('table')).toContainText(routineText.volatilityValues.s);
    await page.screenshot({ path: info.outputPath('PostgreSQL函数定义.png') });
    await routineDefinition.getByRole('button', { name: routineText.draft, exact: true }).click();
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('RETURNS integer');
    await discardTestTab(page, page.locator('.tab-strip .tab-close').last());

    await routineFilter.fill('窗口补全过程');
    await routineRows.filter({ hasText: '窗口补全过程' }).dblclick();
    await expect(routineDefinition.getByRole('table')).toContainText(routineText.categories.p);
    await expect(routineDefinition.locator('.monaco-editor .view-lines')).toContainText('CREATE OR REPLACE PROCEDURE');
    await routineDefinition.getByRole('button', { name: zh.common.close, exact: true }).click();

    const createRoutine = page.getByRole('dialog', { name: routineText.create, exact: true });
    await page.getByRole('button', { name: routineText.create, exact: true }).click();
    await createRoutine.getByLabel(routineText.schema, { exact: true }).selectOption('回归');
    await createRoutine.getByLabel(routineText.name, { exact: true }).fill('窗口图形函数');
    await createRoutine.getByRole('button', { name: routineText.addParameter, exact: true }).click();
    await createRoutine.getByLabel(routineText.parameterName + ' 1', { exact: true }).fill('输入');
    await createRoutine.getByLabel(routineText.comment, { exact: true }).fill('创建函数注释');
    await createRoutine.getByLabel(routineText.body, { exact: true }).fill('SELECT "输入" + 1');
    await createRoutine.getByRole('button', { name: routineText.preview, exact: true }).click();
    await expect(createRoutine.locator('pre')).toContainText('CREATE FUNCTION "回归"."窗口图形函数"(IN "输入" integer)');
    const newRoutineNode = page.locator('.object-row').filter({ hasText: '窗口图形函数' });
    await expect(newRoutineNode).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('PostgreSQL新建例程.png') });
    await createRoutine.getByRole('button', { name: routineText.confirm, exact: true }).click();
    await expect(routineDefinition.getByRole('table')).toContainText('创建函数注释');
    await routineDefinition.getByRole('button', { name: zh.common.close, exact: true }).click();
    await expect(newRoutineNode).toBeVisible();

    await clickSidebarAction(databaseNode, { name: routineText.create, exact: true }, undefined, check);
    await createRoutine.getByLabel(routineText.schema, { exact: true }).selectOption('回归');
    await createRoutine.getByLabel(routineText.kind, { exact: true }).selectOption('procedure');
    await createRoutine.getByLabel(routineText.language, { exact: true }).selectOption('plpgsql');
    await createRoutine.getByLabel(routineText.name, { exact: true }).fill('窗口图形过程');
    await createRoutine.getByLabel(routineText.comment, { exact: true }).fill('创建过程注释');
    await createRoutine.getByLabel(routineText.body, { exact: true }).fill('BEGIN NULL; END');
    await createRoutine.getByRole('button', { name: routineText.preview, exact: true }).click();
    await expect(createRoutine.locator('pre')).toContainText('CREATE PROCEDURE "回归"."窗口图形过程"()');
    await createRoutine.getByRole('button', { name: routineText.confirm, exact: true }).click();
    await expect(routineDefinition.getByRole('table')).toContainText('创建过程注释');
    await routineDefinition.getByRole('button', { name: zh.common.close, exact: true }).click();
    await routineFilter.fill('窗口图形');
    await expect(routineRows).toHaveCount(2);
    await mark('原生函数列表和数据库右键分别创建函数和过程，预览零写入并在确认后自动打开定义');
    await page.locator('.tab-strip .tab-close').click();
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual(routineHistory);
    await mark('原生对象树和函数列表打开两个重载及过程，读取 DDL 和打开定义草稿没有执行历史');




    const offlineBefore = await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}),
      history: await window.dbark.invoke('history.list', {}) }));
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: snapshotText.entry, exact: true }, check)).click();
    const snapshotDialog = page.getByRole('dialog', { name: snapshotText.title, exact: true });
    await snapshotDialog.getByRole('button', { name: snapshotText.choose, exact: true }).click();
    await expect(snapshotDialog.getByRole('treeitem').first()).toContainText('Limit');
    await snapshotDialog.getByRole('button', { name: snapshotText.compareChoose, exact: true }).click();
    const comparison = snapshotDialog.getByRole('region', { name: snapshotText.compareTitle });
    await expect(comparison).toContainText('ModifyTable');
    await expect(comparison.getByRole('table')).toContainText('Node Type');
    await page.screenshot({ path: info.outputPath('PostgreSQL估算计划离线比较.png') });
    await snapshotDialog.getByRole('button', { name: snapshotText.compareChoose, exact: true }).click();
    await expect(snapshotDialog.getByText(snapshotText.compareUnsupported, { exact: true })).toBeVisible();
    await expect(comparison).toContainText('ModifyTable');
    await snapshotDialog.getByRole('button', { name: snapshotText.choose, exact: true }).click();
    await expect(snapshotDialog.getByRole('region', { name: '实际执行计划' })).toContainText('ModifyTable');
    await snapshotDialog.getByRole('button', { name: snapshotText.close, exact: true }).click();
    expect(await page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}),
      history: await window.dbark.invoke('history.list', {}) }))).toEqual(offlineBefore);
    expect(await application.evaluate(() => (globalThis as typeof globalThis & { finishPostgresSnapshotFiles(): unknown }).finishPostgresSnapshotFiles()))
      .toEqual({ saves: 3, opens: 4 });
    for (const [index, path] of planPaths.entries()) {
      const snapshot = decodePlanSnapshot(await readFile(path, 'utf8'));
      expect(snapshot).toMatchObject({ dialect: 'postgresql', kind: index < 2 ? 'dbark.explain-snapshot' : 'dbark.analyze-snapshot' });
      expect(snapshot.result).not.toHaveProperty('statement');
    }
    await mark('实际保存两个估算快照及一个实测快照，离线比较与异类拒绝，任务和历史保持');
    check();
    expect(runtime.pageErrors).toEqual([]);
    await runtime.confirmOwnedDesktopExit(info);
    const files = await readdir(directory);
    for (const file of files.filter(value => /\.(?:db|sqlite|json)(?:-wal)?$/.test(value))) {
      if ((await readFile(join(directory, file))).includes(password)) throw Error('临时密码出现在工作区文件');
    }
    await mark('保存后关闭，正常退出已核对原PID，工作区文件未发现明文密码');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  }
});
