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
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';

/** 只消费Root预置唯一随机库；正式UI用例不建库、写行、删库或替换产品回包。 */
export function registerTableValueOptionsUiTests(): void {
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
  nativeTest('正式表页服务器不同值、NULL补集、草稿确认、排序及跨500组LIKE', async ({ tableValuesSource, trace, screenshot, video }, info) => {
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
    const phases = ['实际启动身份', '原草稿及不同值读取前', '筛选排序及540组后', '退出客户端前', '退出与观察流收尾后'], sourceChecks: string[] = []; let sourcePending = false, sourceFailed = false;
    /** 完整来源集合在五个明确阶段复读，不能把摘要称为每个UI动作重新验全部文件。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); try { if (sourcePending || sourceFailed || phases[sourceChecks.length] !== phase) throw Error('表页不同值来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; } catch (reason) { sourceFailed = true; retained = true; clock.retain(); throw reason; } };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      objects: 'SELECT TABLE_NAME AS name,TABLE_TYPE AS type,TABLE_COMMENT AS comment FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      owner: 'SELECT marker FROM ' + qualify('__owner'),
      subject: 'SELECT CAST(id AS CHAR) AS id,label,CAST(big_value AS CHAR) AS big_value,CAST(amount AS CHAR) AS amount,CAST(at_value AS CHAR) AS at_value FROM ' + qualify('subject') + ' ORDER BY id',
      candidates: 'SELECT CAST(COUNT(*) AS CHAR) AS rowCount,MIN(label) AS first,MAX(label) AS last FROM ' + qualify('candidates'),
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 只允许固定只读观察语句，不能通过参数引入其它库或任意SQL。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<RowDataPacket[]> => {
      if (!Object.values(statements).includes(sql) || sql === statements.objects && (params.length !== 1 || params[0] !== database) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.objects, statements.threads].includes(sql) && params.length) throw Error('表页不同值观察SQL或参数越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows as RowDataPacket[]))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: profileStat.dev, ino: profileStat.ino };
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity); expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      const objects = await read(statements.objects, [database]); expect(objects.map(row => row.name)).toEqual(['__owner', 'candidates', 'large_value', 'subject', 'subject_view']);
      expect(await read(statements.owner)).toEqual([{ marker: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER }]);
      for (const object of objects.filter(row => row.name !== 'subject_view')) expect(object.comment).toBe(environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER + ':' + (object.name === '__owner' ? 'owner' : object.name));
      const subjectBefore = await read(statements.subject), candidatesBefore = await read(statements.candidates); expect(subjectBefore.map(row => row.label)).toEqual(['Alpha', 'alpha', null, '', 'NULL', '\n', 'line\nbreak', 'Alpha ', '尾部中文']); expect(candidatesBefore).toEqual([{ rowCount: '540', first: 'g_0000', last: 'g_0539' }]);
      process.stdout.write(JSON.stringify({ 专项: '表页服务器不同值GUI', 阶段: '原资源计划', 数据库: database, 表: ['subject', 'candidates', 'subject_view'], 端口: 13384, 原观察线程: threadId }) + '\n');
      await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '表页不同值本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '表页不同值本例' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.user === environment.values.DBARK_TEST_USER && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click());
      /** 通过真实导航打开表，不能直接替换工作区store或渲染器props。 */
      const openTable = async (name: string) => { const object = node.locator('.object-row').filter({ has: page.locator('.truncate').filter({ hasText: new RegExp('^' + name + '$') }) }); await step(() => object.locator('button.tree-label').click()); await step(() => expect(page.locator('.table-grid-wrap:visible').getByRole('grid')).toBeVisible()); };
      await openTable('subject'); const tab = page.locator('.table-tab:visible'), grid = tab.locator('.table-grid-wrap').getByRole('grid'), action = tab.locator('.table-action-bar');
      await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect(action.getByText(formatText(zh.table.text016, 9), { exact: true })).toBeVisible());
      // 两级服务器排序，后续同组Alpha用第二级id降序证明排序没有丢失。
      await step(() => tab.getByRole('button', { name: sortText.entry, exact: true }).click()); const sorting = tab.getByRole('region', { name: sortText.title, exact: true });
      await step(() => sorting.getByRole('button', { name: sortText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortText.field(1), exact: true }).selectOption('label')); await step(() => sorting.getByRole('button', { name: sortText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortText.field(2), exact: true }).selectOption('id')); await step(() => sorting.getByRole('combobox', { name: sortText.direction(2), exact: true }).selectOption('DESC')); await step(() => sorting.getByRole('button', { name: sortText.apply, exact: true }).click()); await step(() => expect(sorting).toBeHidden());
      await step(() => expect(action.getByText(formatText(zh.table.text016, 9), { exact: true })).toBeVisible());
      await step(() => grid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]').click()); await step(() => tab.getByRole('button', { name: recordText.title, exact: true }).click()); const form = tab.getByRole('complementary', { name: recordText.title, exact: true });
      const amount = form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^amount/ }) }); await step(() => amount.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => amount.getByRole('combobox', { name: recordText.mode, exact: true }).selectOption('text')); await step(() => amount.getByLabel('amount · ' + recordText.value, { exact: true }).fill('0.000000000001')); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); expect(await read(statements.subject)).toEqual(subjectBefore);
      await verifySource('原草稿及不同值读取前');
      let explicitReads = 0;
      /** 选择字段不请求；每次仅通过读取按钮获取服务端候选。 */
      const openValues = async (columnName: string) => {
        await step(() => tab.getByRole('button', { name: text.open, exact: true }).click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(dialog.locator('[data-table-value-options-dialog]')).toHaveCount(1));
        await step(() => dialog.getByRole('combobox', { name: text.column, exact: true }).selectOption(columnName)); await step(() => expect(dialog.getByRole('checkbox')).toHaveCount(0));
        const before = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(before.filter(item => item.kind === 'table.valueOptions')).toHaveLength(explicitReads);
        await step(() => dialog.getByRole('button', { name: text.read, exact: true }).click()); explicitReads++; await step(() => expect(dialog.getByRole('button', { name: text.refresh, exact: true })).toBeEnabled()); return dialog;
      };
      const labels = await openValues('label'); await step(() => expect(labels.getByRole('checkbox')).toHaveCount(7));
      for (const value of [null, '', 'NULL', '\n', 'line\nbreak', '尾部中文']) await step(() => expect(labels.getByRole('checkbox', { name: text.value(value), exact: true })).toBeVisible());
      const alphaOption = labels.locator('label').filter({ has: page.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ }) }); await step(() => expect(alphaOption).toContainText('3 行'));
      await step(() => labels.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ }).check());
      const screenshotPath = resolve(info.outputPath('表页服务器不同值-NULL与完整多行.png')), inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('专项截图不能写入原profile目录'); await step(() => labels.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      // 由Electron API测试适配器回答准确丢稿确认；这不是系统按钮输入验收。
      await step(() => application.evaluate(installTableValueOptionsConfirmation, { owner: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!, expected: recordText.discardPage, choice: 'reject' as const }));
      await step(() => labels.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(labels.getByText(text.rejected, { exact: true })).toBeVisible());
      const rejected = await step(() => application.evaluate(readTableValueOptionsConfirmations, environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!)); expect(rejected).toHaveLength(1); expect(rejected[0].choice).toBe('reject'); expect(rejected[0].response).toBe(rejected[0].cancelIndex); expect(rejected[0].options.message).toBe(recordText.discardPage);
      await step(() => expect(labels.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ })).toBeChecked()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); expect(await read(statements.subject)).toEqual(subjectBefore);
      await step(() => application.evaluate(installTableValueOptionsConfirmation, { owner: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!, expected: recordText.discardPage, choice: 'accept' as const }));
      await step(() => labels.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(labels).toBeHidden());
      const confirmations = await step(() => application.evaluate(readTableValueOptionsConfirmations, environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER!)); expect(confirmations).toHaveLength(2); expect(confirmations.map(value => value.choice)).toEqual(['reject', 'accept']); expect(confirmations[0].response).toBe(confirmations[0].cancelIndex); expect(confirmations[1].response).toBe(confirmations[1].acceptIndex); expect(confirmations.every(value => value.options.message === recordText.discardPage)).toBe(true); await step(() => expect(action.getByText(formatText(zh.table.text016, 3), { exact: true })).toBeVisible());
      const alphaIds = subjectBefore.filter(row => ['Alpha', 'alpha', 'Alpha '].includes(row.label)).map(row => row.id).reverse();
      await step(() => expect(grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]')).toHaveText(alphaIds));
      const clear = async () => { const filterPanel = tab.locator('.expanded-filter-panel').filter({ has: page.locator('.filter-rule-form') }); if (!(await step(() => filterPanel.isVisible()))) await step(() => tab.getByRole('button', { name: /^筛选/ }).click()); await step(() => filterPanel.getByRole('button', { name: zh.common.clearAll, exact: true }).click()); await step(() => expect(action.getByText(formatText(zh.table.text016, 9), { exact: true })).toBeVisible()); };
      await clear();
      // 排除Alpha但保留NULL，再排除Alpha+NULL，两种完整补集均走真实表页。
      for (const excludeNull of [false, true]) {
        const dialog = await openValues('label'); await step(() => dialog.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ }).check()); if (excludeNull) await step(() => dialog.getByRole('checkbox', { name: text.value(null), exact: true }).check());
        await step(() => dialog.getByRole('combobox', { name: text.mode, exact: true }).selectOption('exclude')); await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect(action.getByText(formatText(zh.table.text016, excludeNull ? 5 : 6), { exact: true })).toBeVisible()); const ids = await step(() => grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents()); const nullId = subjectBefore.find(row => row.label === null)!.id; expect(ids.includes(nullId)).toBe(!excludeNull); expect(alphaIds.every(id => !ids.includes(id))).toBe(true); await clear();
      }
      const multiline = await openValues('label'); await step(() => multiline.getByRole('checkbox', { name: text.value('line\nbreak'), exact: true }).check()); await step(() => multiline.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(multiline).toBeHidden()); await step(() => expect(action.getByText(formatText(zh.table.text016, 1), { exact: true })).toBeVisible()); await step(() => expect(grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]')).toHaveText([subjectBefore.find(row => row.label === 'line\nbreak')!.id])); await clear();
      // 540组表只返回500，尾部g_0530不在已读集合；服务器LIKE仍能从全表找出10组。
      await openTable('candidates'); await step(() => expect(action.getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible());
      const candidates = await openValues('label'); await step(() => expect(candidates.getByRole('checkbox')).toHaveCount(50)); await step(() => expect(candidates.getByText(text.truncated, { exact: true })).toBeVisible()); await step(() => expect(candidates.getByRole('checkbox', { name: text.value('g_0000'), exact: true })).toBeVisible()); await step(() => candidates.getByRole('button', { name: text.next, exact: true }).click()); await step(() => expect(candidates.getByRole('checkbox', { name: text.value('g_0050'), exact: true })).toBeVisible()); await step(() => candidates.getByRole('textbox', { name: text.search, exact: true }).fill('g_053%')); await step(() => candidates.getByRole('button', { name: text.refresh, exact: true }).click()); explicitReads++;
      await step(() => expect(candidates.getByRole('checkbox')).toHaveCount(10)); await step(() => expect(candidates.getByRole('checkbox', { name: text.value('g_0539'), exact: true })).toBeVisible()); await step(() => expect(candidates.getByText(text.truncated, { exact: true })).toHaveCount(0)); await step(() => candidates.getByRole('button', { name: text.selectAll, exact: true }).click()); await step(() => candidates.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(candidates).toBeHidden()); await step(() => expect(action.getByText(formatText(zh.table.text016, 10), { exact: true })).toBeVisible());
      expect(await read(statements.subject)).toEqual(subjectBefore); expect(await read(statements.candidates)).toEqual(candidatesBefore); expect(await read(statements.owner)).toEqual([{ marker: environment.values.DBARK_TABLE_VALUE_OPTIONS_OWNER }]); expect(await read(statements.objects, [database])).toEqual(objects);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))), selectedTasks = tasks.filter(task => task.kind === 'table.valueOptions'); expect(selectedTasks).toHaveLength(explicitReads); expect(selectedTasks.every(task => task.status === 'completed')).toBe(true); expect(tasks.some(task => task.status === 'running' || task.kind === 'table.apply' || task.kind === 'table.preview' || task.kind.startsWith('schema.') || task.kind.startsWith('query.execute'))).toBe(false); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(pageErrors).toEqual([]);
      await verifySource('筛选排序及540组后'); await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); check(); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed).toBe(true); await verifySource('退出与观察流收尾后'); expect(sourceChecks).toEqual(phases);
      await step(() => info.attach('表页不同值正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-value-options-ui', version: 1, platform: process.platform, database, serverVersion: '8.4.11', controlThreadId: threadId, subjectRows: 9, labelGroups: 7, collationEqualRows: 3, excludeAlphaRows: 6, excludeAlphaAndNullRows: 5, multilineRows: 1, parentDiscardRejectedAndAccepted: true, confirmationPort: 'Electron API测试适配器（一次性准确message白名单）', confirmations, systemConfirmationInputVerified: false, sorting: ['label ASC', 'id DESC'], sourceCandidateGroups: 540, returnedCandidateGroups: 500, displayedPageSize: 50, serverLikePattern: 'g_053%', serverLikeGroups: 10, explicitReadTasks: explicitReads, sourceRowsUnchanged: true, normalExit: closed, originalProcessExitCode: originalProcess.exitCode, observerClosed, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
