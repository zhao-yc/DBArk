import { writeFile } from 'node:fs/promises';
import { expect, test as base } from '@playwright/test';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { tableCopyStructureZh as structure } from '../../src/renderer/locales/tableCopyStructure.zh-CN';
import { tableCopyDataZh as data } from '../../src/renderer/locales/tableCopyData.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.some(value => value === '--list' || value.startsWith('--list=')) && process.env.DBARK_MYSQL_TABLE_COPY_CROSS_TEST === '1';
if (enabled && (process.env.DBARK_INTEGRATION_ENABLED !== '1' || !['win32', 'darwin'].includes(process.platform) ||
  ['DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA'].some(name => process.env[name]))) throw Error('仅允许源码 Electron 和独占回环实库');
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '须显式启用 MySQL 双库隔离验收');
test.use({ trace: 'off', screenshot: 'off', video: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('在实际窗口选择另一个库，确认空表及同名数据副本并刷新目标目录', async ({}, info) => {
  const user = process.env.DBARK_COPY_USER ?? '', password = process.env.DBARK_COPY_PASSWORD ?? '', port = Number(process.env.DBARK_COPY_PORT);
  if (!/^tabrelio_copy_[a-f0-9]{12}$/.test(user) || !/^[a-f0-9]{64}$/.test(password) || !Number.isInteger(port) || port <= 1024 || port > 65535)
    throw Error('仅允许本例的隔离回环 MySQL');
  const runtime = require('./desktop-fixture') as Runtime;
  const { page, application } = runtime.ownedDesktopResources(info), directory = runtime.dataDir, observations: string[] = [];
  const mark = async (step: string) => { observations.push(step); await writeFile(info.outputPath('原生验收.json'), JSON.stringify({ platform: process.platform, directory, observations }, null, 2)); };
  const own = () => { if (runtime.ownedDesktopResources(info).page !== page || info.retry || info.config.workers !== 1) throw Error('本例原生窗口归属已变化'); };
  const maria = process.env.DBARK_COPY_DIALECT === 'mariadb', vendor = maria ? 'MariaDB' : 'MySQL';
  const source = user + '_src', target = user + '_dst', title = vendor + ' 跨库整表验收';
  const observer = await mysql.createConnection({ host: '127.0.0.1', port, user, password });
  const exists = async (name: string) => (await observer.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [target, name]))[0].length;
  const rows = async (database: string) => (await observer.query<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,note FROM ${database}.orders ORDER BY orders.id`))[0];
  try {
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, own)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    await form.getByLabel(zh.connections.text006, { exact: true }).fill(title);
    if (maria) await form.getByRole('combobox').selectOption('mariadb');
    await form.getByLabel(zh.connections.text010, { exact: true }).fill(String(port));
    await form.getByLabel(zh.common.user, { exact: true }).fill(user);
    await form.getByLabel(zh.connections.text011, { exact: true }).fill(password);
    await form.getByRole('checkbox', { name: zh.connections.text016, exact: true }).uncheck();
    await form.getByRole('button', { name: zh.connections.text036, exact: true }).click();
    await expect(form).toBeHidden();
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: title, exact: true }) });
    await node.locator('.connection-row .tree-label').click();
    const db = (name: string) => node.locator('.database-row').getByRole('button', { name, exact: true });
    await db(target).click(); await db(source).click();
    const object = node.locator('.object-row').filter({ has: page.getByText('orders', { exact: true }) });
    await object.locator('.tree-label').dblclick();
    const table = page.locator('.table-tab:visible');
    await expect(table).toBeVisible(); await expect(table.locator('.loading-overlay')).toHaveCount(0);

    await (await navigationMenuItem(table, { name: structure.title, exact: true }, own)).click();
    const empty = page.getByRole('dialog', { name: structure.title, exact: true });
    await empty.getByLabel(structure.targetDatabase, { exact: true }).selectOption(target);
    await empty.getByLabel(structure.newName, { exact: true }).fill('empty_copy');
    await empty.getByRole('button', { name: structure.preview, exact: true }).click();
    await expect(empty).toContainText(target + '.empty_copy');
    expect(await exists('empty_copy')).toBe(0);
    await empty.getByLabel(structure.confirmation, { exact: true }).fill(target + '.empty_copy');
    for (const label of [structure.ackImplicit, structure.ackScope, structure.ackWindow, structure.ackAutoIncrement]) await empty.getByRole('checkbox', { name: label, exact: true }).check();
    await empty.getByRole('button', { name: structure.apply, exact: true }).click();
    await expect(empty.locator('.table-copy-structure-outcome')).toHaveText(structure.succeeded, { timeout: 30000 });
    expect((await observer.query<RowDataPacket[]>(`SELECT count(*) AS n FROM ${target}.empty_copy`))[0][0].n).toBe(0);
    await empty.getByRole('button', { name: structure.close, exact: true }).click(); await expect(empty).toBeHidden();
    await expect(node.locator('.object-row').getByText('empty_copy', { exact: true })).toBeVisible();
    await mark('跨库结构预览零写入，准确确认后独立核对空表和目标目录');

    await (await navigationMenuItem(table, { name: data.title, exact: true }, own)).click();
    const copy = page.getByRole('dialog', { name: data.title, exact: true });
    await copy.getByLabel(data.targetDatabase, { exact: true }).selectOption(target);
    await copy.getByLabel(data.newName, { exact: true }).fill('orders');
    await copy.getByRole('button', { name: data.preview, exact: true }).click();
    await expect(copy).toContainText(target + '.orders');
    expect(await exists('orders')).toBe(0);
    await page.screenshot({ path: info.outputPath(vendor + '跨库整表复制预览.png') });
    for (const label of [data.ackImplicit, data.ackScope, data.ackWindow, data.ackSnapshot, data.ackRetain]) await copy.getByRole('checkbox', { name: label, exact: true }).check();
    const submit = copy.getByRole('button', { name: data.apply, exact: true });
    await copy.getByLabel(data.confirmation, { exact: true }).fill(source + '.orders'); await expect(submit).toBeDisabled();
    await copy.getByLabel(data.confirmation, { exact: true }).fill(target + '.orders');
    await submit.click(); await expect(copy.locator('.table-copy-data-outcome')).toHaveText(data.succeeded, { timeout: 30000 });
    const copied = await rows(target); expect(copied).toEqual(await rows(source)); expect(copied).toHaveLength(3);
    await writeFile(info.outputPath(vendor + '跨库整表独立读回.json'), JSON.stringify(copied, null, 2));
    await copy.getByRole('button', { name: data.close, exact: true }).click(); await expect(copy).toBeHidden();
    await expect(node.locator('.object-row').getByText('orders', { exact: true })).toHaveCount(2);
    expect(runtime.pageErrors).toEqual([]);
    await mark('跨库数据预览零写入，拒绝来源库确认，目标同名副本精确读回三行');
    await expect.poll(async () => (await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).filter(task => task.status === 'running')).toEqual([]);
    await runtime.confirmOwnedDesktopExit(info); await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info); await mark('专项未完成，保留原窗口和工作区'); throw error;
  } finally { await observer.end(); }
});
