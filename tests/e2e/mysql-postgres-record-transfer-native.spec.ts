import { writeFile } from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { Client } from 'pg';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresRecordTransferZh as transferText } from '../../src/renderer/locales/postgresRecordTransfer.zh-CN';
import { navigationMenuItem } from './navigation-menu';
import { clickSidebarAction } from './sidebar-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_NETWORK_POSTGRES_TRANSFER_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '仅使用本轮隔离的网络源库及 PostgreSQL 目标库');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('网络查询结果跨引擎生成 PostgreSQL 草稿并保留原值', async ({}, info) => {
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
  const dialect = process.env.DBARK_TRANSFER_DIALECT;
  const configuration = (prefix: string) => {
    const database = process.env[prefix + '_DATABASE'] ?? '', user = process.env[prefix + '_USER'] ?? '';
    const password = process.env[prefix + '_PASSWORD'] ?? '', port = Number(process.env[prefix + '_PORT']);
    if (!/^tabrelio_(?:src|pg)_[a-f0-9]{12}$/.test(database) || database !== user ||
        !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('仅使用本轮隔离库及回环入口');
    return { database, user, password, port, host: '127.0.0.1' };
  };
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || (dialect !== 'mysql' && dialect !== 'mariadb'))
    throw Error('未确认隔离网络驱动');
  const origin = configuration('DBARK_TRANSFER_SOURCE'), destination = configuration('DBARK_TRANSFER_TARGET');
  if (!origin.database.startsWith('tabrelio_src_') || !destination.database.startsWith('tabrelio_pg_') ||
      origin.database.slice(-12) !== destination.database.slice(-12)) throw Error('源库及目标库不属于同一轮');
  const reader = await createConnection({ ...origin, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true });
  const target = new Client({ ...destination, connectionTimeoutMillis: 1500 });
  try {
    check();
    await target.connect();
    await reader.query('CREATE TABLE source_rows (id int PRIMARY KEY, memo varchar(40), exact_unsigned bigint unsigned, amount decimal(45,20), payload varbinary(32), note_text text)');
    await reader.query(`INSERT INTO source_rows VALUES
      (1, '复制甲', 18446744073709551615, 9007199254740993.00000000000000000001, X'00FF', NULL),
      (2, '复制乙', 0, 0.00000000000000000001, X'', ''),
      (3, '排除行', 7, 7, NULL, '保留')`);
    await target.query(`CREATE TABLE public.transfer_target (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, memo text NOT NULL, exact_unsigned numeric,
      amount numeric(45,20), payload bytea, note_text text)`);
    const readTarget = async () => (await target.query(`SELECT memo, exact_unsigned::text, amount::text,
      encode(payload,'hex') AS payload, note_text FROM public.transfer_target ORDER BY id`)).rows;
    const addConnection = async (name: string, kind: string, config: typeof origin) => {
      await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
      const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      await form.getByLabel(zh.connections.text006, { exact: true }).fill(name);
      await form.getByRole('combobox').selectOption(kind);
      await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(config.port));
      await form.getByLabel(zh.common.user, { exact: true }).fill(config.user);
      await form.getByLabel(zh.connections.text011, { exact: true }).fill(config.password);
      await form.getByLabel(zh.connections.text012, { exact: true }).fill(config.database);
      await form.getByLabel(zh.connections.text016, { exact: true }).uncheck();
      await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
      await expect(form).toBeHidden();
    };
    const sourceTitle = dialect + ' 隔离源', targetTitle = 'PostgreSQL 隔离目标';
    await addConnection(sourceTitle, dialect, origin);
    await addConnection(targetTitle, 'postgresql', destination);
    const openDatabase = async (title: string, name: string) => {
      const node = page.locator('.connection-node').filter({ hasText: title });
      await node.locator('.connection-row .tree-label').click();
      const row = node.locator('.database-row').filter({ has: page.getByRole('button', { name, exact: true }) });
      await row.locator('.tree-label').click();
      return row;
    };
    const sourceDb = await openDatabase(sourceTitle, origin.database);
    await clickSidebarAction(sourceDb, { name: zh.sidebar.text016, exact: true }, undefined, check);
    const query = page.locator('.query-tab:not(.postgres-query):visible');
    await query.locator('.monaco-editor').getByRole('textbox').focus();
    await page.keyboard.insertText('SELECT memo, exact_unsigned, amount, payload, note_text FROM source_rows ORDER BY id');
    await (await navigationMenuItem(query, { name: zh.query.text011, exact: true }, check)).click();
    for (const name of ['复制乙', '复制甲']) {
      await query.getByRole('row').filter({ has: page.getByRole('gridcell', { name, exact: true }) }).getByRole('checkbox').check();
    }
    await (await navigationMenuItem(query, { name: transferText.captureToPostgres, exact: true }, check)).click();
    await mark('在网络驱动的正式查询结果暂存两条勾选行');
    await openDatabase(targetTitle, destination.database);
    await page.locator('.object-row .tree-label').getByText('"public"."transfer_target"', { exact: true }).click();
    const tab = page.locator('.postgres-table-tab:visible');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    await button(transferText.openQuery).click();
    const mapping = page.getByRole('dialog', { name: transferText.title, exact: true });
    await expect(mapping).toContainText(dialect === 'mysql' ? transferText.mysqlSource : transferText.mariadbSource);
    await expect(mapping.getByRole('button', { name: transferText.remove('exact_unsigned'), exact: true })).toBeVisible();
    await expect(mapping.getByRole('button', { name: transferText.remove('payload'), exact: true })).toBeVisible();
    const map = async (targetColumn: string, input: RegExp) => {
      await mapping.getByLabel(transferText.targetColumn, { exact: true }).selectOption({ label: targetColumn });
      const sourceSelect = mapping.getByLabel(transferText.sourceColumn, { exact: true });
      const label = await sourceSelect.getByRole('option', { name: input }).textContent();
      await sourceSelect.selectOption({ label: label ?? '' });
      await mapping.getByRole('button', { name: transferText.add, exact: true }).click();
    };
    await map('amount (numeric(45,20))', /^amount .*第 3 列$/);
    await map('note_text (text)', /^note_text .*第 5 列$/);
    await page.screenshot({ path: info.outputPath(dialect + '-PostgreSQL字段映射.png') });
    await mapping.getByRole('button', { name: tableText.stage, exact: true }).click();
    await expect(mapping).toHaveCount(0);
    await button(tableText.preview).click();
    const review = page.getByRole('dialog', { name: tableText.preview, exact: true });
    await expect(review).toContainText('18446744073709551615');
    expect(await readTarget()).toEqual([]);
    await review.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(tab.getByRole('status')).toContainText('已确认整批提交');
    expect(await readTarget()).toEqual([
      { memo: '复制甲', exact_unsigned: '18446744073709551615', amount: '9007199254740993.00000000000000000001', payload: '00ff', note_text: null },
      { memo: '复制乙', exact_unsigned: '0', amount: '0.00000000000000000001', payload: '', note_text: '' },
    ]);
    expect((await reader.query('SELECT id, memo FROM source_rows ORDER BY id'))[0]).toEqual([
      { id: 1, memo: '复制甲' }, { id: 2, memo: '复制乙' }, { id: 3, memo: '排除行' },
    ]);
    expect(runtime.pageErrors).toEqual([]);
    await mark('预览零写入，确认后读回无符号整数、定点数、字节、NULL 与空串');
    await runtime.confirmOwnedDesktopExit(info);
    await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  } finally { await Promise.all([reader.end(), target.end()]); }
});
