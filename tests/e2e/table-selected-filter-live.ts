import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh } from '../../src/renderer/locales/zh-CN';

import { tableSelectedFilterZh as selectedText } from '../../src/renderer/locales/tableSelectedFilter.zh-CN';
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_SELECTED_FILTER_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_SELECTED_FILTER_MANIFEST', 'DBARK_SELECTED_FILTER_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('表勾选值筛选原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('表勾选值筛选拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_SELECTED_FILTER_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_selectedfilter_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('表勾选值筛选须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_SELECTED_FILTER_MANIFEST || !win32.isAbsolute(values.DBARK_SELECTED_FILTER_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_SELECTED_FILTER_MANIFEST_SHA256 ?? '')) throw Error('表勾选值筛选缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('表勾选值筛选源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('表勾选值筛选拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('表勾选值筛选禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerTableSelectedFilterUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ selectedFilterSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    selectedFilterSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('表勾选值筛选必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('表勾选值筛选配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_SELECTED_FILTER_MANIFEST!, environment.values.DBARK_SELECTED_FILTER_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ selectedFilterSource }, use) => { await use({ assertCurrent: () => selectedFilterSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== selectedFilterSource.clock) throw Error('表勾选值筛选原启动归属变化'); selectedFilterSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('表勾选值筛选原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实跨页勾选值包含与NULL补集，保持旧OR和多列排序', async ({ selectedFilterSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = selectedFilterSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, qualified = '`' + database + '`.`subject`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    /** 每个await都核原窗口／进程／socket，未知终态保留现场，绝不补重跑或删库。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('表勾选值筛选原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('表勾选值筛选原profile身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '原表草稿与预览前', '全量筛选与NULL补集核对', '退出客户端前', '退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false;
    /** 明确五个来源阶段复读完整集合，不把有限分页观察扩称Main全部IPC审计。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); if (sourcePending || phases[sourceChecks.length] !== phase) throw Error('表勾选值筛选来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      rows: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,note FROM ' + qualified + ' ORDER BY id',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 原观察连接只允许固定四条只读语句和准确随机库参数。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<any> => {
      if (!Object.values(statements).includes(sql) || sql === statements.exists && (params.length !== 1 || params[0] !== database) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.exists, statements.threads].includes(sql) && params.length !== 0) throw Error('表勾选值筛选观察SQL越界');
      return step(() => new Promise((resolve, reject) => observer!.query({ sql, values: params }, (error, rows) => error ? reject(error) : resolve(rows))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: profileStat.dev, ino: profileStat.ino };
      const mysql = require('mysql2') as typeof import('mysql2'); observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve())));
      const facts = await read(statements.identity) as RowDataPacket[]; expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId);
      expect({ version: facts[0].version, os: facts[0].os, names: Number(facts[0].names), uuid: facts[0].uuid }).toEqual({ version: '8.4.11', os: 'Linux', names: 0, uuid: environment.values.DBARK_TEST_EXPECTED_SERVER_UUID }); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      expect(await read(statements.exists, [database])).toEqual([{ name: 'subject' }]); const authority = await read(statements.rows) as { id: string; amount: string; note: string | null }[]; expect(authority).toHaveLength(121); expect(authority[0]).toEqual({ id: '9007199254740993', amount: '123456789012345678.000001', note: null });
      const base = 9007199254740992n, lower = (base + 61n).toString(), upper = (base + 101n).toString(), beforeRows = authority.filter(row => BigInt(row.id) <= BigInt(lower) || BigInt(row.id) >= BigInt(upper)), secondPage = beforeRows.slice(50);
      expect(beforeRows).toHaveLength(82); expect(secondPage).toHaveLength(32);
      const included = beforeRows.filter(row => row.note === null || row.note === ''), nullOnly = beforeRows.filter(row => row.note === null); expect(included).toHaveLength(42); expect(nullOnly).toHaveLength(22);
      await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '勾选值筛选本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(Boolean(profile.name === '勾选值筛选本例' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.database === database && profile.user === environment.values.DBARK_TEST_USER && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      // 只观察本例分页和防写；不代替引擎或修改任何请求／回包。
      await step(() => application.evaluate(({ ipcMain }, input) => {
        const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request'), root = globalThis as any;
        if (typeof original !== 'function' || root.__selectedFilterOwner) throw Error('勾选值分页观察器归属未知');
        const state = { pages: [] as any[], pending: 0, writes: 0 }, tasks = new Set<string>(); root.__selectedFilterPages = state;
        const wrapped = async (event: any, payload: any) => {
          const command = payload.command, value = payload.input;
          if (command.startsWith('schema.') || ['table.apply', 'table.preview', 'query.execute', 'query.executeParameterized'].includes(command)) { state.writes++; throw Error('本例禁止正文或产品写入'); }
          if (command !== 'table.page') return original(event, payload);
          if (value.connectionId !== input.id || value.database !== input.database || value.table !== 'subject' || state.pages.length >= 10 || typeof value.taskId !== 'string' || !value.taskId || tasks.has(value.taskId)) throw Error('本例分页目标、次数或任务身份变化');
          tasks.add(value.taskId); const entry: any = { input: { page: value.page, pageSize: value.pageSize, filters: structuredClone(value.filters), filterMode: value.filterMode, filterGroup: structuredClone(value.filterGroup), sort: structuredClone(value.sort) } }; state.pages.push(entry); state.pending++;
          try { const reply = await original(event, payload); if (reply?.ok !== true || !Array.isArray(reply.result?.rows)) throw Error('原分页未成功'); entry.ids = reply.result.rows.map((row: any) => row.id); entry.notes = reply.result.rows.map((row: any) => row.note); entry.hasMore = reply.result.hasMore; return reply; }
          finally { state.pending--; tasks.delete(value.taskId); }
        };
        handlers.set('dbark:request', wrapped); root.__selectedFilterOwner = { handlers, wrapped };
      }, { id: profile.id, database }));
      const state = () => step(() => application.evaluate(() => { const root = globalThis as any, owner = root.__selectedFilterOwner; if (!owner || owner.handlers.get('dbark:request') !== owner.wrapped) throw Error('原分页观察器已变化'); return root.__selectedFilterPages as { pages: { input: { page: number; pageSize: number; filters: unknown[]; filterMode: string; filterGroup?: unknown; sort: unknown[] }; ids?: string[]; notes?: (string | null)[]; hasMore?: boolean }[]; pending: number; writes: number }; }));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true')); await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click());
      const table = page.locator('.table-tab:visible'), grid = table.getByRole('grid'), panel = table.getByRole('region', { name: selectedText.title, exact: true });
      /** 必须先等本次回包和加载结束，不能借旧行或旧任务数通过。 */
      const settled = async (count: number) => { await step(() => expect.poll(async () => (await state()).pages.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids !== undefined).toBe(true)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); };
      await settled(1); await step(() => table.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await settled(2); await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click()); const filter = table.locator('.filter-rule-form');
      /** 两条手工条件使用原生产入口，OR切换仍明确触发一次服务器读取。 */
      const add = async (operator: string, value: string) => { await step(() => filter.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption('id')); await step(() => filter.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption(operator)); await step(() => filter.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(value)); const count = (await state()).pages.length; await step(() => filter.getByRole('button', { name: zh.table.text013, exact: true }).click()); await settled(count + 1); };
      await add('<=', lower); await add('>=', upper); await step(() => table.getByRole('combobox', { name: zh.table.filterModeLabel, exact: true }).selectOption('any')); await settled(5);
      await step(() => table.getByRole('button', { name: sortText.entry, exact: true }).click()); const sorting = table.getByRole('region', { name: sortText.title, exact: true });
      for (const [index, name, direction] of [[1, 'id', 'ASC'], [2, 'amount', 'DESC']] as const) { await step(() => sorting.getByRole('button', { name: sortText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortText.field(index), exact: true }).selectOption(name)); await step(() => sorting.getByRole('combobox', { name: sortText.direction(index), exact: true }).selectOption(direction)); }
      await step(() => sorting.getByRole('button', { name: sortText.apply, exact: true }).click()); await settled(6);
      await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(7); expect((await state()).pages.at(-1)?.ids).toEqual(secondPage.map(row => row.id));
      const expectedSort = [{ column: 'id', direction: 'ASC' }, { column: 'amount', direction: 'DESC' }], originalFilters = [{ column: 'id', operator: '<=', value: lower }, { column: 'id', operator: '>=', value: upper }];
      const row = (id: string) => grid.getByRole('row').filter({ has: page.getByRole('gridcell').filter({ hasText: new RegExp('^' + id + '$') }) });
      const nullRow = secondPage.find(row => row.note === null)!, emptyRow = secondPage.find(row => row.note === '')!;
      for (const record of [nullRow, emptyRow]) await step(() => row(record.id).getByRole('checkbox').check()); await step(() => row(nullRow.id).locator('[role="gridcell"][aria-colindex="4"]').click());
      await step(() => table.getByRole('button', { name: recordText.title, exact: true }).click()); const record = page.getByRole('complementary', { name: recordText.title, exact: true }), amount = record.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^amount/ }) });
      await step(() => amount.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => amount.getByLabel('amount · ' + recordText.value, { exact: true }).fill('0.000001')); await step(() => record.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(record.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => row(nullRow.id).locator('[role="gridcell"][aria-colindex="4"]').click()); await verifySource('原表草稿与预览前');
      await step(() => table.getByRole('button', { name: selectedText.entry, exact: true }).click()); await step(() => expect(panel.getByLabel(selectedText.rowCount, { exact: true })).toHaveText('2')); await step(() => expect(panel.getByLabel(selectedText.valueCount, { exact: true })).toHaveText('1')); await step(() => expect(panel.getByRole('list', { name: selectedText.values, exact: true }).getByRole('listitem')).toHaveText(['""'])); expect((await state()).pages).toHaveLength(7);
      const screenshotPath = resolve(info.outputPath('勾选值筛选原值与NULL预览.png')), inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('截图不能写入原profile'); await step(() => panel.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      await step(() => panel.getByRole('button', { name: selectedText.cancel, exact: true }).click()); await step(() => expect(record.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => expect(amount).toContainText('0.000001')); expect((await state()).pages).toHaveLength(7); expect(await read(statements.rows)).toEqual(authority);
      await step(() => table.getByRole('button', { name: draftHistoryZh.undo, exact: true }).click()); await step(() => expect(record.getByText(recordText.unchanged, { exact: true })).toBeVisible()); await step(() => row(nullRow.id).locator('[role="gridcell"][aria-colindex="4"]').click());
      await step(() => table.getByRole('button', { name: selectedText.entry, exact: true }).click()); await step(() => panel.getByRole('button', { name: selectedText.apply, exact: true }).click()); await settled(8);
      const includeGroup = { mode: 'all', children: [{ mode: 'any', children: [0, 1] }, { mode: 'any', children: [2, 3] }] };
      expect((await state()).pages.at(-1)).toMatchObject({ input: { page: 1, pageSize: 50, filters: [...originalFilters, { column: 'note', operator: 'IN', values: [''] }, { column: 'note', operator: 'IS NULL' }], filterMode: 'all', filterGroup: includeGroup, sort: expectedSort }, ids: included.map(row => row.id), hasMore: false });
      const currentEmpty = included.find(row => row.note === '')!; await step(() => row(currentEmpty.id).getByRole('checkbox').check()); await step(() => row(currentEmpty.id).locator('[role="gridcell"][aria-colindex="4"]').click()); await step(() => table.getByRole('button', { name: selectedText.excludeEntry, exact: true }).click()); await step(() => expect(panel.getByLabel(selectedText.semantics, { exact: true })).toHaveText(selectedText.excludeValues)); expect((await state()).pages).toHaveLength(8); await step(() => panel.getByRole('button', { name: selectedText.apply, exact: true }).click()); await settled(9);
      const excludeGroup = { mode: 'all', children: [...includeGroup.children, { mode: 'any', children: [4, 5] }] };
      expect((await state()).pages.at(-1)).toMatchObject({ input: { page: 1, filters: [...originalFilters, { column: 'note', operator: 'IN', values: [''] }, { column: 'note', operator: 'IS NULL' }, { column: 'note', operator: 'NOT IN', values: [''] }, { column: 'note', operator: 'IS NULL' }], filterMode: 'all', filterGroup: excludeGroup, sort: expectedSort }, ids: nullOnly.map(row => row.id), hasMore: false }); expect((await state()).pages.at(-1)?.notes?.every(value => value === null)).toBe(true);
      const currentNull = nullOnly[0]; await step(() => row(currentNull.id).getByRole('checkbox').check()); await step(() => row(currentNull.id).locator('[role="gridcell"][aria-colindex="4"]').click()); await step(() => table.getByRole('button', { name: selectedText.excludeEntry, exact: true }).click()); await step(() => expect(panel.getByLabel(selectedText.semantics, { exact: true })).toHaveText(selectedText.excludeNull)); await step(() => panel.getByRole('button', { name: selectedText.apply, exact: true }).click()); await settled(10); expect((await state()).pages.at(-1)).toMatchObject({ input: { page: 1, filterMode: 'all', filterGroup: { mode: 'all', children: [...excludeGroup.children, 6] }, sort: expectedSort }, ids: [], hasMore: false }); expect((await state()).pages.at(-1)?.input.filters.at(-1)).toEqual({ column: 'note', operator: 'IS NOT NULL' });
      expect(await read(statements.rows)).toEqual(authority); await verifySource('全量筛选与NULL补集核对'); const final = await state(); expect(final.pages).toHaveLength(10); expect(final.writes).toBe(0); expect(final.pending).toBe(0); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true);
      await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed).toBe(true); await verifySource('退出与控制收尾后'); expect(sourceChecks).toEqual(phases);
      await step(() => info.attach('表勾选值筛选专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-selected-filter-ui', version: 1, platform: process.platform, database, objects: ['subject'], serverVersion: '8.4.11', controlThreadId: threadId, sourceRows: 121, oldOrRows: 82, secondPageRows: 32, includedRows: 42, excludeEmptyKeepsNullRows: 22, excludeNullRows: 0, parentDraftPreserved: true, previewDidNotQuery: true, pageRequests: 10, productWrites: 0, historyRows: 0, finalPending: 0, audit: final, originalSortPreserved: true, normalExit: closed, originalProcessExitCode: originalProcess.exitCode, observerClosed, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_SELECTED_FILTER_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
