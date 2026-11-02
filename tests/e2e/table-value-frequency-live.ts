import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { bindTableValueOptionsUiEnvironment, installTableValueOptionsConfirmation, readTableValueOptionsConfirmations } from './table-value-options-native-gate';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableValueOptionsZh as text } from '../../src/renderer/locales/tableValueOptions.zh-CN';
import { tableValueFrequencyRows } from '../helpers/tableValueFrequencyFixture';
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';

/** 只消费Root预置唯一随机库；正式UI用例不建库、写行、删库或替换产品回包。 */
export function registerTableValueFrequencyLiveTests(): void {
  if (process.env.DBARK_VALUE_FREQUENCY_LIVE !== '1') throw Error('真实次数排序专项缺少独立开关');
  const environment = bindTableValueOptionsUiEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  const configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ tableValuesSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    tableValuesSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('表页不同值须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 用户await前后核原配置字节，来源每个底层FS await仍核原clock。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('表页不同值原配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_TABLE_VALUE_OPTIONS_MANIFEST!, environment.values.DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256!, resolve('.'), {
        stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项只接受批准源码App，不冒充安装版');
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ tableValuesSource }, use) => { await use({ assertCurrent: () => tableValuesSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== tableValuesSource.clock) throw Error('表页不同值原启动归属已变化'); tableValuesSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('表页不同值原App、观察流或证据尚未闭合，保留随机库与现场'); } });
  nativeTest('真实物理表次数排序跨500组、草稿确认、NULL及筛选作用域', async ({ tableValuesSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = tableValuesSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, qualify = (name: string) => '`' + database + '`.`' + name + '`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    /** 绑定原窗口、frame、进程、profile及socket；观察超时或失败均保留，不重新建立清理连接。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('表页不同值原资源身份已变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('表页不同值原profile目录身份已变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const result = await action(); check(); return result; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '原草稿及不同值读取前', '次数排序与筛选后', '退出客户端前', '退出与观察流收尾后'], sourceChecks: string[] = []; let sourcePending = false, sourceFailed = false;
    /** 完整来源集合在五个明确阶段复读，不能把摘要称为每个UI动作重新验全部文件。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); try { if (sourcePending || sourceFailed || phases[sourceChecks.length] !== phase) throw Error('表页不同值来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; } catch (reason) { sourceFailed = true; retained = true; clock.retain(); throw reason; } };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      objects: 'SELECT TABLE_NAME AS name,TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME',
      owner: 'SELECT marker FROM ' + qualify('__owner'),
      subject: 'SELECT CAST(id AS CHAR) AS id,n FROM ' + qualify('subject') + ' ORDER BY id',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    };
    /** 原观察流仅接受固定只读语句及本例库参数，不接受任意 SQL。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<RowDataPacket[]> => {
      if (!Object.values(statements).includes(sql) || sql === statements.objects && (params.length !== 1 || params[0] !== database) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.objects, statements.threads].includes(sql) && params.length) throw Error('次数排序观察语句越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows as RowDataPacket[]))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      await step(() => info.attach('次数排序原窗口归属', { body: JSON.stringify({ pid: actual.pid, directory, database }), contentType: 'application/json' }));
      const stat = await step(() => fs.lstat(directory)); expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: stat.dev, ino: stat.ino };
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity); expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      const objects = await read(statements.objects, [database]); expect(objects).toEqual([{ name: '__owner', type: 'BASE TABLE' }, { name: 'subject', type: 'BASE TABLE' }]);
      expect(await read(statements.owner)).toEqual([{ marker: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER }]); const before = await read(statements.subject); expect(before).toEqual(tableValueFrequencyRows());
      await step(async () => { const entry = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, check); check(); await entry.click(); check(); });
      const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '次数排序本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: '次数排序本例', exact: true }) }); await step(() => node.getByRole('button', { name: '次数排序本例', exact: true }).click());
      const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click());
      await step(() => node.locator('.object-row').filter({ has: page.locator('.truncate').filter({ hasText: /^subject$/ }) }).locator('button.tree-label').click());
      const tab = page.locator('.table-tab:visible'), grid = tab.locator('.table-grid-wrap').getByRole('grid'), action = tab.locator('.table-action-bar'); await step(() => expect(grid).toBeVisible());
      await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect(action.getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible());
      await step(async () => { const entry = await navigationMenuItem(tab, { name: sortText.entry, exact: true }, check); check(); await entry.click(); check(); });
      const sorting = tab.getByRole('region', { name: sortText.title, exact: true }); await step(() => sorting.getByRole('button', { name: sortText.add, exact: true }).click()); await step(() => sorting.getByLabel(sortText.field(1), { exact: true }).selectOption('id')); await step(() => sorting.getByLabel(sortText.direction(1), { exact: true }).selectOption('ASC')); await step(() => sorting.getByRole('button', { name: sortText.apply, exact: true }).click()); await step(() => expect(sorting).toBeHidden());
      /** 真实滚动虚拟表格，按逻辑行号逐一收集整页，不能假定 50 行同时挂载。 */
      const verifyHotPage = async () => {
        const expected = before.filter(row => row.n === 'zz_hot').slice(0, 50), seen = new Map<number, { id: string; n: string }>();
        await step(() => expect(action.getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible());
        await step(() => grid.evaluate(element => { element.scrollTop = 0; }));
        await step(() => expect.poll(async () => {
          const visible = await step(() => grid.locator('[role="row"][aria-rowindex]').evaluateAll(elements => elements.flatMap(element => {
            const id = element.querySelector('[role="gridcell"][aria-colindex="2"]'), n = element.querySelector('[role="gridcell"][aria-colindex="3"]');
            return id && n ? [{ index: Number(element.getAttribute('aria-rowindex')) - 2, id: id.textContent ?? '', n: n.textContent ?? '' }] : [];
          })));
          for (const row of visible) { expect({ id: row.id, n: row.n }).toEqual(expected[row.index]); seen.set(row.index, { id: row.id, n: row.n }); }
          if (seen.size < expected.length) await step(() => grid.evaluate(element => { element.scrollTop += Math.max(32, Math.floor(element.clientHeight / 2)); }));
          return seen.size;
        }, { intervals: [50, 100, 150] }).toBe(expected.length));
        expect([...seen].sort(([left], [right]) => left - right).map(([, row]) => row)).toEqual(expected);
        await step(() => grid.evaluate(element => { element.scrollTop = 0; }));
      };
      // 仅暂存本地字段草稿，后续明确拒绝／接受父表页丢稿确认；绝不提交数据库写操作。
      await step(() => grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]').click());
      await step(async () => { const entry = await navigationMenuItem(tab, { name: recordText.title, exact: true }, check); check(); await entry.click(); check(); });
      const form = tab.getByRole('complementary', { name: recordText.title, exact: true }), field = form.locator('.record-field[aria-label="n"]');
      await step(() => field.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => field.getByRole('combobox', { name: recordText.mode, exact: true }).selectOption('text')); await step(() => field.getByLabel('n · ' + recordText.value, { exact: true }).fill('LOCAL_ONLY_DRAFT')); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible());
      await verifySource('原草稿及不同值读取前');
      let reads = 0;
      /** 任务审计走真实受限接口；读取数量由明确按钮动作增加，不替换产品服务。 */
      const assertReads = async () => { const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'table.valueOptions')).toHaveLength(reads); return tasks; };
      const open = async () => { await step(async () => { const entry = await navigationMenuItem(tab, { name: text.open, exact: true }, check); check(); await entry.click(); check(); }); const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(dialog.locator('[data-table-value-options-dialog]')).toHaveCount(1)); await step(() => dialog.getByLabel(text.column, { exact: true }).selectOption('n')); await step(() => expect(dialog.getByRole('checkbox')).toHaveCount(0)); await assertReads(); return dialog; };
      const dialog = await open();
      await step(() => dialog.getByRole('button', { name: text.read, exact: true }).click()); reads++; await step(() => expect(dialog.getByRole('button', { name: text.refresh, exact: true })).toBeEnabled());
      await step(() => expect(dialog.getByText(text.selected(500, 0), { exact: true })).toBeVisible()); await step(() => expect(dialog.getByText(text.truncated, { exact: true })).toBeVisible()); await step(() => expect(dialog.getByLabel(text.value('zz_hot'), { exact: true })).toHaveCount(0));
      await step(() => dialog.getByLabel(text.value('0000'), { exact: true }).check()); await step(() => dialog.getByLabel(text.order, { exact: true }).selectOption('count-desc')); await assertReads(); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      await step(() => dialog.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => expect(dialog.getByRole('button', { name: text.confirmRead, exact: true })).toBeVisible()); await assertReads(); await step(() => dialog.getByRole('button', { name: text.keep, exact: true }).click()); await step(() => expect(dialog.getByLabel(text.value('0000'), { exact: true })).toBeChecked());
      await step(() => dialog.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => dialog.getByRole('button', { name: text.confirmRead, exact: true }).click()); reads++;
      await step(() => expect(dialog.getByRole('checkbox').first()).toHaveAttribute('aria-label', text.value('zz_hot'))); await step(() => expect(dialog.getByText(text.selected(500, 0), { exact: true })).toBeVisible());
      for (const [value, count] of [['zz_hot', '100'], ['yy_warm', '9'], [null, '2']] as const) await step(() => expect(dialog.locator('label').filter({ has: page.getByRole('checkbox', { name: text.value(value), exact: true }) })).toContainText(text.count(count)));
      const screenshotPath = resolve(info.outputPath('真实物理表次数排序.png')); const inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('截图不能位于原profile内'); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      await step(() => dialog.getByLabel(text.value('zz_hot'), { exact: true }).check());
      for (const choice of ['reject', 'accept'] as const) { await step(() => application.evaluate(installTableValueOptionsConfirmation, { owner: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!, expected: recordText.discardPage, choice })); await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); if (choice === 'reject') { await step(() => expect(dialog.getByText(text.rejected, { exact: true })).toBeVisible()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); expect(await read(statements.subject)).toEqual(before); } }
      await step(() => expect(dialog).toBeHidden()); await verifyHotPage();
      const confirmations = await step(() => application.evaluate(readTableValueOptionsConfirmations, environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!)); expect(confirmations.map(value => value.choice)).toEqual(['reject', 'accept']); expect(confirmations[0].response).toBe(confirmations[0].cancelIndex); expect(confirmations[1].response).toBe(confirmations[1].acceptIndex);
      /** 页数可能清空前后同为 50；等待原首行重新出现，不能把旧页计数当刷新完成。 */
      const clear = async () => { const panel = tab.locator('.expanded-filter-panel').filter({ has: page.locator('.filter-rule-form') }); if (!(await step(() => panel.isVisible()))) await step(() => tab.getByRole('button', { name: /^筛选/ }).click()); await step(() => panel.getByRole('button', { name: zh.common.clearAll, exact: true }).click()); await step(() => expect(grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]')).toHaveText(before[0].id)); await step(() => expect(tab.locator('.loading-overlay')).toHaveCount(0)); await step(() => expect(action.getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible()); };
      await clear(); const least = await open(); await step(() => least.getByLabel(text.order, { exact: true }).selectOption('count-asc')); await assertReads(); await step(() => least.getByRole('button', { name: text.read, exact: true }).click()); reads++;
      await step(() => expect(least.getByRole('checkbox').first()).toHaveAttribute('aria-label', text.value(''))); await step(() => expect(least.getByRole('checkbox').nth(1)).toHaveAttribute('aria-label', text.value('0000'))); await step(() => expect(least.getByText(text.selected(500, 0), { exact: true })).toBeVisible());
      await step(() => least.getByLabel(text.value(''), { exact: true }).check()); await step(() => least.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(least).toBeHidden()); await step(() => expect(action.getByText(formatText(zh.table.text016, 1), { exact: true })).toBeVisible()); await step(() => expect(grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]')).toHaveText([before.find(row => row.n === '')!.id]));
      await clear(); const nulls = await open(); await step(() => nulls.getByLabel(text.order, { exact: true }).selectOption('count-desc')); await step(() => nulls.getByRole('button', { name: text.read, exact: true }).click()); reads++; await step(() => nulls.getByLabel(text.value(null), { exact: true }).check()); await step(() => nulls.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(nulls).toBeHidden()); await step(() => expect(action.getByText(formatText(zh.table.text016, 2), { exact: true })).toBeVisible()); await step(() => expect(grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]')).toHaveText(before.filter(row => row.n === null).map(row => row.id)));
      await clear(); const warm = await open(); await step(() => warm.getByLabel(text.order, { exact: true }).selectOption('count-asc')); await step(() => warm.getByLabel(text.search, { exact: true }).fill('yy%')); await assertReads(); await step(() => warm.getByRole('button', { name: text.read, exact: true }).click()); reads++; await step(() => expect(warm.getByRole('checkbox')).toHaveCount(1)); await step(() => expect(warm).toContainText(text.count('9'))); await step(() => warm.getByLabel(text.value('yy_warm'), { exact: true }).check()); await step(() => warm.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(warm).toBeHidden()); await step(() => expect(grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]')).toHaveText(before.filter(row => row.n === 'yy_warm').map(row => row.id)));
      const tasks = await assertReads(); expect(reads).toBe(5); expect(tasks.filter(task => task.kind === 'table.valueOptions').every(task => task.status === 'completed')).toBe(true); expect(tasks.some(task => task.status === 'running' || ['table.apply', 'table.preview'].includes(task.kind) || task.kind.startsWith('schema.') || task.kind.startsWith('query.execute'))).toBe(false); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(pageErrors).toEqual([]);
      expect(await read(statements.subject)).toEqual(before); expect(await read(statements.owner)).toEqual([{ marker: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER }]); expect(await read(statements.objects, [database])).toEqual(objects);
      await verifySource('次数排序与筛选后'); await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed).toBe(true); await verifySource('退出与观察流收尾后');
      await step(() => info.attach('次数排序真实物理表终态', { body: JSON.stringify({ version: 1, kind: 'dbark.value-frequency-live', platform: process.platform, database, subjectRows: 633, groups: 525, returnedGroups: 500, explicitReads: reads, hotCount: '100', warmCount: '9', nullCount: '2', parentDiscardRejectedAndAccepted: true, confirmations, sourceRowsUnchanged: true, normalExit: closed, originalProcessExitCode: originalProcess.exitCode, observerClosed, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, systemClipboard: 0, mainIpcAuditVerified: false, systemConfirmationInputVerified: false, installerVerified: false, macOSVerified: false }), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}

/** 按真实用户导航延迟加载菜单入口，异步边界继续核当前资源。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.(); const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
