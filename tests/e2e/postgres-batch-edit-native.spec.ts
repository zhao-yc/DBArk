import { test as base, expect } from '@playwright/test';
import { Client } from 'pg';
import { writeFile } from 'node:fs/promises';
import { postgresBatchEditZh as text } from '../../src/renderer/locales/postgresBatchEdit.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_POSTGRES_BATCH_EDIT_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '仅使用本轮隔离 PostgreSQL 实库');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 逐条编辑勾选记录及准确提交', async ({}, info) => {
  const runtime = require('./desktop-fixture') as Runtime;
  const { page, application } = runtime.ownedDesktopResources(info);
  const directory = runtime.dataDir, pid = application.process().pid;
  const observations: string[] = [];
  const mark = async (value: string) => {
    observations.push(value);
    await writeFile(info.outputPath('原生验收.json'), JSON.stringify({ platform: process.platform, pid, directory, observations }, null, 2));
  };
  const check = () => {
    const owner = runtime.ownedDesktopResources(info);
    if (owner.page !== page || owner.application !== application || owner.closed || runtime.dataDir !== directory ||
      info.config.workers !== 1 || info.timeout !== 120000 || info.retry !== 0) throw Error('原生测试归属或门槛已变化');
  };
  const database = process.env.DBARK_POSTGRES_TEST_DATABASE ?? '', user = process.env.DBARK_POSTGRES_TEST_USER;
  const password = process.env.DBARK_POSTGRES_TEST_PASSWORD ?? '', port = Number(process.env.DBARK_POSTGRES_TEST_PORT);
  let reader: Client | undefined;
  try {
    check();
    if (!['darwin', 'win32'].includes(process.platform) || process.env.DBARK_INTEGRATION_ENABLED !== '1' ||
      !/^tabrelio_pg_[a-f0-9]{12}$/.test(database) || user !== database || !/^[a-f0-9]{64}$/.test(password) ||
      !Number.isInteger(port) || port <= 1024 || port > 65535) throw Error('只允许本轮专用角色及 SSH 回环实库');
    reader = new Client({ host: '127.0.0.1', port, database, user, password, ssl: false, connectionTimeoutMillis: 1500 });
    await reader.connect();
    await reader.query(`CREATE TABLE "回归"."逐条编辑" (id bigint PRIMARY KEY, note text);
      INSERT INTO "回归"."逐条编辑" VALUES (9007199254740993,'甲原'),(9007199254740994,'乙原'),(9007199254740995,'丙原')`);
    const readRows = async () => (await reader!.query('SELECT id::text, note FROM "回归"."逐条编辑" ORDER BY id')).rows;
    const originals = await readRows();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const title = '逐条编辑隔离连接';
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
    await page.locator('.database-row .tree-label').filter({ hasText: database }).click();
    await page.locator('.object-row .tree-label').filter({ hasText: '逐条编辑' }).click();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const draft = tab.getByLabel(tableText.draft, { exact: true });
    const noteCell = (note: string) => grid.getByRole('gridcell', { name: note, exact: true });
    const mode = (dialog: ReturnType<typeof page.getByRole>) => dialog.getByLabel('note ' + tableText.valueMode, { exact: true });
    const value = (dialog: ReturnType<typeof page.getByRole>) => dialog.getByLabel('note ' + tableText.value, { exact: true });
    const edit = page.getByRole('dialog', { name: tableText.edit, exact: true });
    const batch = page.getByRole('dialog', { name: text.title, exact: true });
    const jump = (index: number) => batch.getByRole('button', { name: text.record(index), exact: true });
    const stage = () => batch.getByRole('button', { name: text.stage, exact: true }).click();
    await noteCell('甲原').click();
    await button(tableText.edit).click();
    await mode(edit).selectOption('text');
    await value(edit).fill('原有草稿');
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    for (const note of ['甲原', '丙原']) await grid.getByRole('row')
      .filter({ has: page.getByRole('gridcell', { name: note, exact: true }) }).getByRole('checkbox').check();

    await button(text.action).click();
    await expect(value(batch)).toHaveValue('原有草稿');
    await value(batch).fill('取消内容');
    await batch.getByRole('button', { name: tableText.cancel, exact: true }).click();
    await expect(draft).toContainText('note=原有草稿');
    expect(await readRows()).toEqual(originals);
    await mark('取消窗口保留原草稿，独立客户端核对原记录');

    await button(text.action).click();
    await mode(batch).selectOption('unchanged');
    await stage();
    await expect(draft).toContainText(tableText.changes(0));
    await expect(button(tableText.preview)).toBeDisabled();
    await draft.getByRole('button', { name: text.undo, exact: true }).click();
    await expect(draft).toContainText('note=原有草稿');
    await mark('保持原值可撤回最后一条更新，整批撤销恢复原草稿');

    const fillBoth = async () => {
      await button(text.action).click();
      await value(batch).fill('甲新值');
      await jump(3).click();
      await mode(batch).selectOption('null');
      await expect(batch.getByRole('region', { name: text.record(3), exact: true })).toContainText('9007199254740995');
      await jump(1).click();
      await expect(value(batch)).toHaveValue('甲新值');
    };
    await fillBoth();
    await page.screenshot({ path: info.outputPath('PostgreSQL逐条编辑勾选记录.png') });
    await stage();
    await expect(draft).toContainText('note=甲新值');
    await expect(draft).toContainText('note=NULL');
    await draft.getByRole('button', { name: text.undo, exact: true }).click();
    await expect(draft).toContainText('note=原有草稿');
    await expect(draft).not.toContainText('note=NULL');
    await mark('切换记录保留各自输入，整批暂存和撤销');

    await fillBoth();
    await stage();
    await button(tableText.preview).click();
    const review = page.getByRole('dialog', { name: tableText.preview, exact: true });
    expect(await readRows()).toEqual(originals);
    await review.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(noteCell('甲新值')).toBeVisible();
    expect(await readRows()).toEqual([{ ...originals[0], note: '甲新值' }, originals[1], { ...originals[2], note: null }]);
    await mark('确认原预览后两条勾选记录分别写入，未勾选记录保持');
    check();
    expect(runtime.pageErrors).toEqual([]);
    await reader.end();
    reader = undefined;
    await runtime.confirmOwnedDesktopExit(info);
    await mark('窗口正常退出');
  } catch (error) {
    runtime.retainOwnedDesktopResources(info);
    await mark('专项未完成，保留原窗口和工作区');
    throw error;
  } finally { await reader?.end(); }
});
