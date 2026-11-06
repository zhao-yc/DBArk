import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test as base } from '@playwright/test';
import { Client } from 'pg';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresRecordTransferZh as transferText } from '../../src/renderer/locales/postgresRecordTransfer.zh-CN';
import { sqliteZh } from '../../src/renderer/locales/sqlite.zh-CN';
import { sqliteRecordTransferZh as sqliteTransferText } from '../../src/renderer/locales/sqliteRecordTransfer.zh-CN';
import { sqliteTableClipboardZh as clipboardText } from '../../src/renderer/locales/sqliteTableClipboard.zh-CN';
import { sqliteTableEditZh as sqliteEditText } from '../../src/renderer/locales/sqliteTableEdit.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { sidebarMenuItem } from './sidebar-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_POSTGRES_RECORD_TRANSFER_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '仅使用本轮隔离的 PostgreSQL 源库和目标库');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 从只读视图跨库映射并追加两条记录', async ({}, info) => {
  const runtime = require('./desktop-fixture') as Runtime;
  const { page, application } = runtime.ownedDesktopResources(info);
  const directory = runtime.dataDir, observations: string[] = [];
  const mark = async (step: string) => {
    observations.push(step);
    await writeFile(info.outputPath('原生验收.json'), JSON.stringify({ platform: process.platform, directory, observations }, null, 2));
  };
  const check = () => {
    const owner = runtime.ownedDesktopResources(info);
    if (owner.page !== page || owner.application !== application || owner.closed ||
        info.config.workers !== 1 || info.timeout !== 120000 || info.retry !== 0) throw Error('原生测试归属或门槛已变化');
  };
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', targetDatabase = process.env.DBARK_POSTGRES_TRANSFER_DATABASE;
  const user = process.env.DBARK_POSTGRES_TEST_USER, password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '';
  const port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) ||
      targetDatabase !== database + '_target' || user !== database || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本轮独占双库和 SSH 回环入口');
  const connect = (name: string) => new Client({ host: '127.0.0.1', port, database: name, user, password, ssl: false, connectionTimeoutMillis: 1500 });
  const source = connect(database), target = connect(targetDatabase);
  try {
    check();
    await source.connect(); await target.connect();
    await source.query(`CREATE SCHEMA "迁移回归"; CREATE SEQUENCE "迁移回归"."执行标记";
      CREATE VIEW "迁移回归"."源视图" AS SELECT * FROM (VALUES
        ('第一行'::text, 9007199254740993.000000000000000001::numeric(40,18), decode('00ff','hex'), NULL::text),
        ('第二行', 0.000000000000000001::numeric(40,18), decode('','hex'), ''),
        ('不勾选', 3::numeric(40,18), NULL::bytea, '保留')
      ) AS rows(source_note, amount, raw, missing) ORDER BY amount DESC`);
    await target.query(`CREATE SCHEMA "迁移回归";
      CREATE TABLE "迁移回归"."目标表" (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993) PRIMARY KEY,
        memo text NOT NULL, amount numeric(40,18), raw bytea, missing text DEFAULT '数据库默认', exact_integer bigint,
        derived text GENERATED ALWAYS AS (memo || '-生成') STORED
      )`);
    const readTarget = async () => (await target.query(`SELECT id::text, memo, amount::text, encode(raw,'hex') AS raw,
      missing, derived FROM "迁移回归"."目标表" ORDER BY id`)).rows;
    const title = '跨库复制隔离连接';
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(title);
    await form.getByRole('combobox').selectOption('postgresql');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
    await form.getByLabel(zh.connections.text012, { exact: true }).fill(database);
    await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    await page.locator('.connection-row').filter({ hasText: title }).locator('.tree-label').click();
    const databases = page.locator('.database-row');
    const open = async (name: string, table: string) => {
      await databases.getByRole('button', { name, exact: true }).click();
      await page.locator('.object-row .tree-label').getByText(table, { exact: true }).click();
    };
    await open(database, '"迁移回归"."源视图"');
    const tab = page.locator('.postgres-table-tab:visible');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    for (const name of ['第二行', '第一行']) {
      await tab.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    await button(transferText.capture).click();
    await expect(tab.getByRole('status')).toContainText(transferText.captured(2));
    await expect(button(transferText.open)).toBeDisabled();
    await mark('从只读视图逆序勾选两条记录，当前源表无法作为目标');

    await open(targetDatabase, '"迁移回归"."目标表"');
    await button(transferText.open).click();
    const dialog = page.getByRole('dialog', { name: transferText.title, exact: true });
    await expect(dialog).toContainText(`${title} / ${database} / "迁移回归"."源视图"`);
    await expect(dialog).toContainText(`${title} / ${targetDatabase} / "迁移回归"."目标表"`);
    await dialog.getByRole('button', { name: tableText.cancel, exact: true }).click();
    expect(await readTarget()).toEqual([]);
    await button(transferText.open).click();
    const stage = dialog.getByRole('button', { name: tableText.stage, exact: true });
    await stage.click();
    await expect(dialog.getByRole('alert')).toContainText(transferText.required('memo'));
    await dialog.getByLabel(transferText.targetColumn, { exact: true }).selectOption({ label: 'memo (text)' });
    await dialog.getByLabel(transferText.sourceColumn, { exact: true }).selectOption({ label: 'source_note (text)' });
    await dialog.getByRole('button', { name: transferText.add, exact: true }).click();
    await page.screenshot({ path: info.outputPath('PostgreSQL跨库复制字段映射.png') });
    await stage.click();
    await expect(dialog).toHaveCount(0);
    await expect(button(transferText.open)).toBeDisabled();
    await expect(tab.getByRole('status')).toContainText(transferText.staged(2));
    expect(await readTarget()).toEqual([]);
    await mark('核对双库、取消零写入、缺少必填映射拒绝，手动映射后仅生成目标草稿');

    await button(tableText.preview).click();
    const review = page.getByRole('dialog', { name: tableText.preview, exact: true });
    await expect(review).toContainText('9007199254740993.000000000000000001');
    expect(await readTarget()).toEqual([]);
    await review.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(tab.getByRole('status')).toContainText('已确认整批提交');
    expect(await readTarget()).toEqual([
      { id: '9007199254740993', memo: '第一行', amount: '9007199254740993.000000000000000001', raw: '00ff', missing: null, derived: '第一行-生成' },
      { id: '9007199254740994', memo: '第二行', amount: '0.000000000000000001', raw: '', missing: '', derived: '第二行-生成' },
    ]);
    expect((await source.query('SELECT count(*)::text AS count FROM "迁移回归"."源视图"')).rows).toEqual([{ count: '3' }]);
    expect(runtime.pageErrors).toEqual([]);
    await mark('显式提交后独立读回两条记录及精确字段，源视图三条记录仍在');

    await page.locator('.tab-select').getByText('"迁移回归"."源视图"', { exact: true }).click();
    await button(tableText.query).click();
    const query = page.locator('.postgres-query:visible');
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.insertText(`SELECT source_note || '-查询' AS memo, '错误列'::text AS memo, amount, raw, missing,
      nextval('"迁移回归"."执行标记"') AS execution_id FROM "迁移回归"."源视图" ORDER BY amount DESC`);
    const run = query.getByRole('button', { name: postgresZh.execute, exact: true });
    await run.click();
    const captureQuery = query.getByRole('button', { name: transferText.queryCapture, exact: true });
    await expect(captureQuery).toBeDisabled();
    for (const name of ['第二行-查询', '第一行-查询']) {
      await query.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    const readSequence = async () => (await source.query('SELECT last_value::text AS value FROM "迁移回归"."执行标记"')).rows;
    expect(await readSequence()).toEqual([{ value: '3' }]);
    await captureQuery.click();
    await page.locator('.tab-select').getByText('"迁移回归"."目标表"', { exact: true }).click();
    await button(transferText.openQuery).click();
    await expect(dialog).toContainText('结果集 1');
    await expect(dialog.getByRole('button', { name: transferText.remove('memo'), exact: true })).toHaveCount(0);
    const addMapping = async (targetLabel: string, sourceLabel: string) => {
      await dialog.getByLabel(transferText.targetColumn, { exact: true }).selectOption({ label: targetLabel });
      await dialog.getByLabel(transferText.sourceColumn, { exact: true }).selectOption({ label: sourceLabel });
      await dialog.getByRole('button', { name: transferText.add, exact: true }).click();
    };
    await expect(dialog.getByLabel(transferText.sourceColumn, { exact: true })).toContainText('memo (text) · 第 2 列');
    await addMapping('memo (text)', 'memo (text) · 第 1 列');
    await addMapping('amount (numeric(40,18))', 'amount (numeric) · 第 3 列');
    await page.screenshot({ path: info.outputPath('PostgreSQL查询结果跨库映射.png') });
    await stage.click();
    await expect(dialog).toHaveCount(0);
    await button(tableText.preview).click();
    await expect(review).toContainText('第一行-查询');
    await expect(review).not.toContainText('错误列');
    expect(await readTarget()).toHaveLength(2);
    await review.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(tab.getByRole('status')).toContainText('已确认整批提交');
    expect((await readTarget()).slice(2)).toEqual([
      { id: '9007199254740995', memo: '第一行-查询', amount: '9007199254740993.000000000000000001', raw: '00ff', missing: null, derived: '第一行-查询-生成' },
      { id: '9007199254740996', memo: '第二行-查询', amount: '0.000000000000000001', raw: '', missing: '', derived: '第二行-查询-生成' },
    ]);
    expect(await readSequence()).toEqual([{ value: '3' }]);
    expect(runtime.pageErrors).toEqual([]);
    await mark('暂存查询勾选行，重复别名按列位置手动映射，确认后准确新增两行且原 SQL 未重跑');
    await expect(tab.getByRole('gridcell', { name: '第二行-查询', exact: true })).toBeVisible();
    await expect(button(tableText.refresh)).toBeEnabled();

    const sqlitePath = join(directory, 'transfer-source.sqlite');
    const sqliteFile = new DatabaseSync(sqlitePath);
    try {
      sqliteFile.exec(`CREATE TABLE transfer_source(memo TEXT, exact_integer INTEGER, precise TEXT, raw BLOB, missing TEXT, mixed);
        INSERT INTO transfer_source VALUES
        ('SQLite甲', 9223372036854775807, '9007199254740993.000000000000000001', X'00FF', NULL, X'AA'),
        ('SQLite乙', -9223372036854775808, '0.000000000000000001', X'', '', 7),
        ('SQLite不选', 0, '0', NULL, '保留', 8)`);
    } finally { sqliteFile.close(); }
    await application.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        const options = args.at(-1) as Electron.OpenDialogOptions;
        if (!options.properties?.includes('openFile')) throw Error('拒绝与本例无关的文件对话框');
        return { canceled: false, filePaths: [file] };
      }) as typeof dialog.showOpenDialog;
    }, sqlitePath);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    await form.getByLabel(zh.connections.text006, { exact: true }).fill('跨引擎 SQLite 只读源');
    await form.getByRole('combobox').selectOption('sqlite');
    await expect(form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true })).toBeChecked();
    await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
    await expect(form.locator('input[readonly]')).toHaveValue('transfer-source.sqlite');
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    const sqliteNode = page.locator('.connection-node').filter({ hasText: '跨引擎 SQLite 只读源' });
    await sqliteNode.locator('.connection-row .tree-label').click();
    await sqliteNode.locator('.database-row .tree-label').getByText('main', { exact: true }).click();
    const object = sqliteNode.locator('.object-row').filter({ hasText: 'transfer_source' });
    await object.locator('.tree-label').click();
    await (await sidebarMenuItem(object, { name: sqliteZh.selectQuery + ' transfer_source', exact: true }, check)).click();
    const sqliteQuery = page.locator('.query-tab:not(.postgres-query):visible');
    await sqliteQuery.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.insertText('SELECT memo, exact_integer, precise, raw, missing, mixed FROM transfer_source ORDER BY rowid');
    await (await navigationMenuItem(sqliteQuery, { name: zh.query.text011, exact: true }, check)).click();
    for (const name of ['SQLite乙', 'SQLite甲']) {
      await sqliteQuery.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    await (await navigationMenuItem(sqliteQuery, { name: transferText.captureToPostgres, exact: true }, check)).click();
    await page.locator('.tab-select').getByText('"迁移回归"."目标表"', { exact: true }).click();
    await button(transferText.openQuery).click();
    await expect(tab.getByRole('alert')).toContainText(transferText.refreshTarget);
    await button(tableText.refresh).click();
    await expect(button(transferText.openQuery)).toBeEnabled();
    await button(transferText.openQuery).click();
    await expect(dialog).toContainText(transferText.sqliteSource);
    await expect(dialog).toContainText('mixed (BLOB / INTEGER)');
    await expect(dialog.getByRole('button', { name: transferText.remove('exact_integer'), exact: true })).toBeVisible();
    await addMapping('amount (numeric(40,18))', 'precise (TEXT) · 第 3 列');
    await page.screenshot({ path: info.outputPath('SQLite到PostgreSQL字段映射.png') });
    await stage.click();
    await expect(dialog).toHaveCount(0);
    await button(tableText.preview).click();
    await expect(review).toContainText('9223372036854775807');
    expect(await readTarget()).toHaveLength(4);
    await review.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(tab.getByRole('status')).toContainText('已确认整批提交');
    expect((await readTarget()).slice(4)).toEqual([
      { id: '9007199254740997', memo: 'SQLite甲', amount: '9007199254740993.000000000000000001', raw: '00ff', missing: null, derived: 'SQLite甲-生成' },
      { id: '9007199254740998', memo: 'SQLite乙', amount: '0.000000000000000001', raw: '', missing: '', derived: 'SQLite乙-生成' },
    ]);
    expect((await target.query('SELECT exact_integer::text AS value FROM "迁移回归"."目标表" WHERE exact_integer IS NOT NULL ORDER BY id')).rows)
      .toEqual([{ value: '9223372036854775807' }, { value: '-9223372036854775808' }]);
    const sqliteCheck = new DatabaseSync(sqlitePath, { readOnly: true });
    try { expect(sqliteCheck.prepare('SELECT count(*) AS total FROM transfer_source').get()?.total).toBe(3); }
    finally { sqliteCheck.close(); }
    expect(runtime.pageErrors).toEqual([]);
    await mark('SQLite 只读查询按逐格类型跨引擎映射，确认后精确写入两条且源库保持');

    await expect(tab.getByRole('gridcell', { name: 'SQLite乙', exact: true })).toBeVisible();
    await button(tableText.query).click();
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.press((process.platform === 'darwin' ? 'Meta' : 'Control') + '+A');
    await page.keyboard.insertText(`SELECT memo, exact_integer, amount AS precise, raw, missing
      FROM "迁移回归"."目标表" WHERE exact_integer IS NOT NULL ORDER BY id`);
    await run.click();
    for (const name of ['SQLite乙', 'SQLite甲']) {
      await query.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    await captureQuery.click();
    const targetPath = join(directory, 'transfer-target.sqlite');
    const sqliteTarget = new DatabaseSync(targetPath);
    try {
      sqliteTarget.exec(`CREATE TABLE transfer_target(id INTEGER PRIMARY KEY, memo TEXT, exact_integer INTEGER,
        precise ANY, raw BLOB, missing TEXT, lossy REAL) STRICT`);
    } finally { sqliteTarget.close(); }
    await application.evaluate(({ dialog }, file) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = (async (...args: unknown[]) => {
        dialog.showOpenDialog = original;
        if (!(args.at(-1) as Electron.OpenDialogOptions).properties?.includes('openFile')) throw Error('拒绝与本例无关的文件对话框');
        return { canceled: false, filePaths: [file] };
      }) as typeof dialog.showOpenDialog;
    }, targetPath);
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    await form.getByLabel(zh.connections.text006, { exact: true }).fill('跨引擎 SQLite 写入目标');
    await form.getByRole('combobox').selectOption('sqlite');
    await form.getByRole('checkbox', { name: sqliteZh.readOnly, exact: true }).uncheck();
    await form.getByRole('button', { name: sqliteZh.choose, exact: true }).click();
    await expect(form.locator('input[readonly]')).toHaveValue('transfer-target.sqlite');
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    const sqliteTargetNode = page.locator('.connection-node').filter({ hasText: '跨引擎 SQLite 写入目标' });
    await sqliteTargetNode.locator('.connection-row .tree-label').click();
    await sqliteTargetNode.locator('.database-row .tree-label').getByText('main', { exact: true }).click();
    await sqliteTargetNode.locator('.object-row .tree-label').getByText('transfer_target', { exact: true }).dblclick();
    const sqliteTab = page.locator('.sqlite-table-tab:visible');
    await expect(sqliteTab.getByRole('grid', { name: sqliteEditText.grid, exact: true })).toBeVisible();
    const readSqliteTarget = () => {
      const db = new DatabaseSync(targetPath, { readOnly: true });
      try { return db.prepare(`SELECT memo, CAST(exact_integer AS TEXT) AS exact_integer, typeof(exact_integer) AS integer_type,
        precise, typeof(precise) AS precise_type, hex(raw) AS raw, typeof(raw) AS raw_type, missing FROM transfer_target ORDER BY id`).all(); }
      finally { db.close(); }
    };
    await (await navigationMenuItem(sqliteTab, { name: sqliteTransferText.entry, exact: true }, check)).click();
    const sqliteMapping = page.getByRole('dialog', { name: sqliteTransferText.title, exact: true });
    await expect(sqliteMapping).toContainText('跨引擎 SQLite 写入目标');
    await sqliteMapping.getByLabel(sqliteTransferText.sourceColumn, { exact: true }).selectOption('2');
    await expect(sqliteMapping.getByLabel(sqliteTransferText.targetColumn, { exact: true })).toHaveValue('precise');
    await expect(sqliteMapping.getByRole('option', { name: 'lossy (REAL)', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('PostgreSQL到SQLite字段映射.png') });
    await sqliteMapping.getByRole('button', { name: clipboardText.stage, exact: true }).click();
    await expect(sqliteMapping).toHaveCount(0);
    expect(readSqliteTarget()).toEqual([]);
    await sqliteTab.getByRole('button', { name: sqliteEditText.preview, exact: true }).click();
    const sqliteReview = page.getByRole('dialog', { name: sqliteEditText.previewTitle, exact: true });
    const confirm = sqliteReview.getByRole('checkbox', { name: sqliteEditText.confirmation, exact: true });
    await expect(confirm).toBeEnabled();
    expect(readSqliteTarget()).toEqual([]);
    await confirm.check();
    await sqliteReview.getByRole('button', { name: sqliteEditText.submit, exact: true }).click();
    const expected = [
      { memo: 'SQLite甲', exact_integer: '9223372036854775807', integer_type: 'integer', precise: '9007199254740993.000000000000000001', precise_type: 'text', raw: '00FF', raw_type: 'blob', missing: null },
      { memo: 'SQLite乙', exact_integer: '-9223372036854775808', integer_type: 'integer', precise: '0.000000000000000001', precise_type: 'text', raw: '', raw_type: 'blob', missing: '' },
    ];
    await expect.poll(readSqliteTarget).toEqual(expected);
    expect(await readTarget()).toHaveLength(6);
    expect(runtime.pageErrors).toEqual([]);
    await writeFile(info.outputPath('SQLite独立读回.json'), JSON.stringify(readSqliteTarget(), null, 2));
    await mark('PostgreSQL 勾选结果到 STRICT SQLite，排除会丢精度的 REAL 目标，确认后独立读回原类型');
    await runtime.confirmOwnedDesktopExit(info);
    await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  } finally { await Promise.all([source.end(), target.end()]); }
});
