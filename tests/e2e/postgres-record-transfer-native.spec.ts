import { writeFile } from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';
import { Client } from 'pg';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresRecordTransferZh as transferText } from '../../src/renderer/locales/postgresRecordTransfer.zh-CN';
import { navigationMenuItem } from './navigation-menu';

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
    await source.query(`CREATE SCHEMA "迁移回归";
      CREATE VIEW "迁移回归"."源视图" AS SELECT * FROM (VALUES
        ('第一行'::text, 9007199254740993.000000000000000001::numeric(40,18), decode('00ff','hex'), NULL::text),
        ('第二行', 0.000000000000000001::numeric(40,18), decode('','hex'), ''),
        ('不勾选', 3::numeric(40,18), NULL::bytea, '保留')
      ) AS rows(source_note, amount, raw, missing) ORDER BY amount DESC`);
    await target.query(`CREATE SCHEMA "迁移回归";
      CREATE TABLE "迁移回归"."目标表" (
        id bigint GENERATED ALWAYS AS IDENTITY (START WITH 9007199254740993) PRIMARY KEY,
        memo text NOT NULL, amount numeric(40,18), raw bytea, missing text DEFAULT '数据库默认',
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
    await runtime.confirmOwnedDesktopExit(info);
    await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  } finally { await Promise.all([source.end(), target.end()]); }
});
