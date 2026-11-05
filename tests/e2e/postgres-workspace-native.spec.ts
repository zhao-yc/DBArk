import { test as base, expect } from '@playwright/test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zh } from '../../src/renderer/locales/zh-CN';
import { postgresTableZh } from '../../src/renderer/locales/postgresTable.zh-CN';
import { postgresZh } from '../../src/renderer/locales/postgres.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { queryBindingZh } from '../../src/renderer/locales/queryBinding.zh-CN';
import { navigationMenuItem } from './navigation-menu';

type Runtime = typeof import('./desktop-fixture');
const enabled = !process.argv.includes('--list') && process.env.DBARK_POSTGRES_WORKSPACE_NATIVE === '1';
const test: typeof base = enabled ? (require('./desktop-fixture') as Runtime).test : base;
test.skip(!enabled, '默认关闭，须由本轮隔离PostgreSQL实库运行');
test.use({ trace: 'off', video: 'off', screenshot: 'off', ...(enabled ? { preserveOnUnconfirmedExit: true } : {}) });
test.describe.configure({ timeout: 120000, retries: 0 });

/** 仅由可核对的独占测试目标驱动真实表单、目录、编辑器与正常退出。 */
test('PostgreSQL窗口表页、记录事务、查询、参数和正常退出', async ({}, info) => {
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
    await tableButton(postgresTableZh.clearFilter).click();
    await expect(grid).toContainText('原值');
    await gridTab.getByRole('spinbutton', { name: postgresTableZh.pageSize, exact: true }).fill('20');
    await tableButton(postgresTableZh.refresh).click();
    await expect(grid).toContainText('新增乙');

    await editRecord('原值', '原生整批更新');
    for (const note of ['新增甲', '新增乙']) {
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
    await tableButton(postgresTableZh.query).click();
    await expect(tab().locator('.monaco-editor')).toBeVisible();
    await page.locator('.tab-strip .tab-close').first().click();
    await expect(tab().locator('.monaco-editor .view-lines')).toContainText('SELECT * FROM "回归"."带""引号" LIMIT 1000;');
    expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toEqual([]);
    await execute();
    await expect(tab().getByRole('grid')).toContainText('原值');
    await mark('树中真实对象生成安全SELECT草稿，明确点击后才执行');

    await edit("/* 外 /* 内 ; */ 外 */ SELECT 9223372036854775807::bigint AS exact; SELECT $标记$含;号$标记$ AS note;");
    await execute();
    await expect(tab().getByRole('grid')).toContainText('9223372036854775807');
    await tab().getByRole('combobox', { name: 'PostgreSQL结果集' }).selectOption('1');
    await expect(tab().getByRole('grid')).toContainText('含;号');

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
