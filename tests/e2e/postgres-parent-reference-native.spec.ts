import { test as base, expect } from '@playwright/test';
import { Client } from 'pg';
import { writeFile } from 'node:fs/promises';
import { postgresReferencePickerZh as text } from '../../src/renderer/locales/postgresReferencePicker.zh-CN';
import { postgresTableZh as tableText } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresRecordViewZh as recordText } from '../../src/renderer/locales/postgresRecordView.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';
import { navigationMenuItem } from './navigation-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_POSTGRES_PARENT_REFERENCE_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '仅使用本轮隔离 PostgreSQL 实库');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

test('PostgreSQL 从当前记录双向查看复合外键关联', async ({}, info) => {
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
    await reader.query(`CREATE TABLE "回归"."父档案" (code bigint, label text, details text, raw bytea, PRIMARY KEY (code,label));
      INSERT INTO "回归"."父档案" VALUES
        (9007199254740993,'甲',repeat('长说明',150) || '结尾甲',decode('00ff','hex')),
        (9007199254740994,'乙','候选父乙',decode('0102','hex'));
      CREATE TABLE "回归"."引用父档案" (id int PRIMARY KEY, parent_code bigint, parent_label text,
        FOREIGN KEY (parent_code,parent_label) REFERENCES "回归"."父档案" (code,label));
      INSERT INTO "回归"."引用父档案" VALUES (1,9007199254740993,'甲'),(2,NULL,NULL);
      CREATE TABLE "回归"."订单明细" (id int PRIMARY KEY, parent_code bigint, parent_label text, memo text CHECK (memo <> '拒绝'), payload bytea,
        CONSTRAINT "订单归属" FOREIGN KEY (parent_code,parent_label) REFERENCES "回归"."父档案" (code,label));
      INSERT INTO "回归"."订单明细" SELECT i, 9007199254740993, '甲',
        CASE WHEN i=43 THEN '字面_%' || repeat('长说明',150) ELSE '明细' || i END, decode('00ff','hex')
        FROM generate_series(1,43) i;
      INSERT INTO "回归"."订单明细" VALUES (44,9007199254740994,'乙','不属于甲',NULL);`);
    const readRows = async () => (await reader!.query(`SELECT id, parent_code::text, parent_label FROM "回归"."引用父档案" ORDER BY id`)).rows;
    const originals = await readRows();
    await (await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check)).click();
    const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    const title = '引用记录隔离连接';
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
    await page.locator('.object-row').getByRole('button', { name: '"回归"."引用父档案"', exact: true }).click();
    const tab = page.locator('.postgres-table-tab:visible'), grid = tab.getByRole('grid');
    const button = (name: string) => tab.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog', { name: text.browseTitle, exact: true });
    const close = () => dialog.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    const relatedTab = page.locator('.postgres-related-table-tab:visible');
    const tabButton = (title: string) => page.locator('.tab-strip .tab-select').getByText(title, { exact: true });
    const closeTab = (title: string) => page.locator('.tab-strip .workspace-tab-button')
      .filter({ has: page.getByText(title, { exact: true }) }).locator('.tab-close').click();
    await expect(button(text.browse)).toBeDisabled();
    await grid.getByRole('gridcell', { name: '9007199254740993', exact: true }).click();
    await button(text.browse).click();
    await expect(dialog.getByRole('table')).toContainText('9007199254740993');
    await expect(dialog.getByText(/引用表.*回归\.父档案/)).toBeVisible();
    await expect(dialog.getByRole('table')).toContainText('0x00ff');
    await expect(dialog.getByRole('button', { name: text.use, exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: recordText.raw('details'), exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: recordText.raw('details'), exact: true })).toHaveValue('长说明'.repeat(150) + '结尾甲');
    await dialog.getByRole('button', { name: recordText.raw('details'), exact: true }).click();
    await page.screenshot({ path: info.outputPath('PostgreSQL查看引用记录.png') });
    await dialog.getByRole('button', { name: text.openRelated, exact: true }).click();
    const relatedParentTitle = text.relatedTitle('"回归"."父档案"');
    await expect(tabButton(relatedParentTitle)).toBeVisible();
    await expect(relatedTab.getByRole('grid')).toContainText('9007199254740993');
    await expect(relatedTab.getByRole('grid')).not.toContainText('候选父乙');
    await relatedTab.getByRole('button', { name: text.relatedRecord, exact: true }).click();
    await expect(relatedTab.getByRole('table')).toContainText('0x00ff');
    await closeTab(relatedParentTitle);
    await expect(tabButton(relatedParentTitle)).toHaveCount(0);
    await mark('网格按复合外键准确读取父记录，保留大整数、完整长文本和 BYTEA');

    await button(tableText.edit).click();
    const edit = page.getByRole('dialog', { name: tableText.edit, exact: true });
    await edit.getByRole('button', { name: text.open, exact: true }).click();
    const candidate = edit.getByRole('row').filter({ hasText: '候选父乙' });
    await candidate.getByRole('button', { name: text.use, exact: true }).click();
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    const draft = tab.getByLabel(tableText.draft, { exact: true });
    await expect(draft).toContainText('parent_code=9007199254740994');
    await button(recordText.view).click();
    await button(text.browse).click();
    await expect(dialog.getByRole('table')).toContainText('9007199254740993');
    await close();
    await expect(draft).toContainText('parent_code=9007199254740994');
    await mark('原外键选值仍能整组暂存，记录表单浏览数据库原值并保留已改草稿');

    await button(recordText.next).click();
    await button(text.browse).click();
    await expect(dialog.getByText(text.emptyParent, { exact: true })).toBeVisible();
    await close();
    expect(await readRows()).toEqual(originals);
    await expect(draft).toContainText('parent_code=9007199254740994');
    await draft.getByRole('button', { name: tableText.discard, exact: true }).click();
    await expect(draft).toHaveCount(0);
    await mark('空外键无可见父记录，独立读回确认浏览与暂存零写入');

    await page.locator('.object-row').getByRole('button', { name: '"回归"."父档案"', exact: true }).click();
    await expect(button(text.children)).toBeDisabled();
    await grid.getByRole('gridcell', { name: '9007199254740993', exact: true }).click();
    await button(tableText.edit).click();
    await edit.getByLabel('label ' + tableText.valueMode, { exact: true }).selectOption('text');
    await edit.getByLabel('label ' + tableText.value, { exact: true }).fill('草稿甲');
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    await button(text.children).click();
    const children = page.getByRole('dialog', { name: text.childrenTitle, exact: true });
    const constraints = children.getByLabel(text.constraint, { exact: true });
    const selectTable = async (name: string) => {
      const option = constraints.getByRole('option', { name: new RegExp('回归\\.' + name) });
      await expect(option).toHaveCount(1);
      await constraints.selectOption((await option.getAttribute('value'))!);
    };
    await selectTable('订单明细');
    await expect(children.getByText(text.childRange(0, 40))).toBeVisible();
    await children.getByRole('button', { name: text.childNext, exact: true }).click();
    await expect(children.getByText(text.childRange(40, 3))).toBeVisible();
    await expect(children.getByRole('table')).not.toContainText('不属于甲');
    await mark('按数据库原复合键读取子记录，分两页准确定位 43 条并排除另一父记录');

    await children.getByRole('searchbox', { name: text.childQuery, exact: true }).fill('_%');
    await children.getByRole('button', { name: text.childSearch, exact: true }).click();
    await expect(children.getByText(text.childRange(0, 1))).toBeVisible();
    await page.screenshot({ path: info.outputPath('PostgreSQL查看子记录.png') });
    await children.getByRole('button', { name: text.inspectChild, exact: true }).click();
    await expect(children.getByRole('table')).toContainText('0x00ff');
    await children.getByRole('button', { name: recordText.raw('memo'), exact: true }).click();
    await expect(children.getByRole('textbox', { name: recordText.raw('memo'), exact: true })).toHaveValue('字面_%' + '长说明'.repeat(150));
    await children.getByRole('button', { name: text.backToChildren, exact: true }).click();
    await expect(children.getByText(text.childRange(0, 1))).toBeVisible();
    await selectTable('引用父档案');
    await expect(children.getByRole('table')).toContainText('9007199254740993');
    await children.getByRole('button', { name: zh.dialogs.text001, exact: true }).click();
    await expect(draft).toContainText('label=草稿甲');
    expect((await reader.query('SELECT label FROM "回归"."父档案" ORDER BY code')).rows).toEqual([{ label: '甲' }, { label: '乙' }]);
    expect(await readRows()).toEqual(originals);
    await draft.getByRole('button', { name: tableText.discard, exact: true }).click();
    await expect(draft).toHaveCount(0);
    await mark('字面搜索、完整字段、约束切换及原草稿均已核对，独立读回确认零写入');

    await button(text.children).click();
    await selectTable('订单明细');
    await children.getByRole('searchbox', { name: text.childQuery, exact: true }).fill('_%');
    await children.getByRole('button', { name: text.childSearch, exact: true }).click();
    await expect(children.getByText(text.childRange(0, 1))).toBeVisible();
    await children.getByRole('button', { name: text.openRelated, exact: true }).click();
    const relatedChildTitle = text.relatedTitle('"回归"."订单明细"');
    await expect(tabButton(relatedChildTitle)).toBeVisible();
    const search = relatedTab.getByRole('searchbox', { name: text.childQuery, exact: true });
    await expect(search).toHaveValue('_%');
    await expect(relatedTab.getByText(text.childRange(0, 1))).toBeVisible();
    await closeTab('"回归"."父档案"');
    await expect(tabButton('"回归"."父档案"')).toHaveCount(0);
    await search.fill('');
    await relatedTab.getByRole('button', { name: text.childSearch, exact: true }).click();
    await expect(relatedTab.getByText(text.childRange(0, 40))).toBeVisible();
    await relatedTab.getByRole('button', { name: text.childNext, exact: true }).click();
    await expect(relatedTab.getByText(text.childRange(40, 3))).toBeVisible();
    await expect(relatedTab.getByRole('grid')).not.toContainText('不属于甲');
    await page.screenshot({ path: info.outputPath('PostgreSQL独立关联表页.png') });
    await mark('独立子表页继承搜索，关闭源页后仍能在原外键范围准确翻页');

    await relatedTab.getByRole('gridcell', { name: '明细42', exact: true }).click();
    await relatedTab.getByRole('button', { name: tableText.edit, exact: true }).click();
    await edit.getByLabel('memo ' + tableText.valueMode, { exact: true }).selectOption('text');
    await edit.getByLabel('memo ' + tableText.value, { exact: true }).fill('拒绝');
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    await relatedTab.getByRole('button', { name: tableText.preview, exact: true }).click();
    const preview = page.getByRole('dialog', { name: tableText.preview, exact: true });
    const lastRows = async () => (await reader!.query('SELECT id, memo FROM "回归"."订单明细" WHERE id IN (41,42,44) ORDER BY id')).rows;
    const originals42 = [{ id: 41, memo: '明细41' }, { id: 42, memo: '明细42' }, { id: 44, memo: '不属于甲' }];
    await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(relatedTab.getByText(tableText.retryAfterRollback, { exact: false })).toBeVisible();
    await expect(relatedTab.getByLabel(tableText.draft, { exact: true })).toContainText('memo=拒绝');
    expect(await lastRows()).toEqual(originals42);
    await relatedTab.getByRole('button', { name: tableText.edit, exact: true }).click();
    await expect(edit.getByLabel('memo ' + tableText.value, { exact: true })).toHaveValue('拒绝');
    await mark('关联记录约束失败后确认回滚，原行保持且草稿可继续编辑');
    await edit.getByLabel('memo ' + tableText.value, { exact: true }).fill('关联页已改42');
    await edit.getByRole('button', { name: tableText.stage, exact: true }).click();
    await relatedTab.getByRole('button', { name: tableText.preview, exact: true }).click();
    await expect(preview.getByText('关联页已改42', { exact: true })).toBeVisible();
    await expect(preview.getByText(/暂存时第 42 行.*id=42/)).toBeVisible();
    await expect(preview.locator('pre')).toContainText('UPDATE ONLY "回归"."订单明细"');
    expect(await lastRows()).toEqual(originals42);
    await page.screenshot({ path: info.outputPath('PostgreSQL关联记录修改预览.png') });
    await preview.getByRole('button', { name: tableText.apply, exact: true }).click();
    await expect(relatedTab.getByRole('gridcell', { name: '关联页已改42', exact: true })).toBeVisible();
    expect(await lastRows()).toEqual([{ id: 41, memo: '明细41' }, { id: 42, memo: '关联页已改42' }, { id: 44, memo: '不属于甲' }]);
    await mark('关联页选中记录经表单、暂存和独立预览，确认后只更新目标行并保留筛选和页码');

    await page.locator('.object-row').getByRole('button', { name: '"回归"."订单明细"', exact: true }).click();
    await expect(tabButton('"回归"."订单明细"')).toBeVisible();
    await expect(tabButton(relatedChildTitle)).toBeVisible();
    await tabButton(relatedChildTitle).click();
    await reader.query(`UPDATE "回归"."父档案" SET details = details || '外部变化' WHERE code=9007199254740993`);
    await relatedTab.getByRole('button', { name: text.relatedRefresh, exact: true }).click();
    await expect(relatedTab.getByRole('alert')).toContainText('原记录已变化');
    await expect(relatedTab.getByRole('grid')).toHaveCount(0);
    await closeTab(relatedChildTitle);
    await expect(tabButton(relatedChildTitle)).toHaveCount(0);
    await mark('普通表页独立打开，外部修改源记录后关联页拒绝刷新并清除旧结果');

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
