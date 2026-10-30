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

import { tableQueryTemplateZh as templateText } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TEMPLATE_COLUMNS_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEMPLATE_COLUMNS_MANIFEST', 'DBARK_TEMPLATE_COLUMNS_MANIFEST_SHA256'] as const;
/** 仅消费Root预置唯一随机库与准确来源清单；不建库、建用户、授权、Docker或自动DROP。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('模板字段选择原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('模板字段选择拒绝环境大小写别名');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TEMPLATE_COLUMNS_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || values.DBARK_TEST_EXPECTED_SERVER_UUID !== 'f568f70e-c730-11f1-8190-3e6c830dde01' || !/^dbark_e2e_templatecols_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('模板字段选择须Root准确绑定200/13384/UUID与预置唯一随机库');
      if (!values.DBARK_TEMPLATE_COLUMNS_MANIFEST || !win32.isAbsolute(values.DBARK_TEMPLATE_COLUMNS_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_TEMPLATE_COLUMNS_MANIFEST_SHA256 ?? '')) throw Error('模板字段选择缺少Root批准的绝对来源清单与SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('模板字段选择源码专项拒绝替代运行环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('模板字段选择拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('模板字段选择禁止CLI开启trace');
    } catch (error) { failed = true; throw error; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 仅登记默认关闭的正式表单定义；来源及真实数据库观察独立，Main逐条IPC审计明确未做。 */
export function registerTableQueryTemplateColumnsUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ templateColumnsSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    templateColumnsSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('模板字段选择必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置字节；来源清单每个底层FSawait继续核原clock与环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('模板字段选择配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_TEMPLATE_COLUMNS_MANIFEST!, environment.values.DBARK_TEMPLATE_COLUMNS_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('本专项仅接受批准源码App，不冒充安装版');
      // 桌面夹具依赖本scope先收尾；afterEach不得提前删除clock，旧TestInfo不接管下一例。
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ templateColumnsSource }, use) => { await use({ assertCurrent: () => templateColumnsSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== templateColumnsSource.clock) throw Error('模板字段选择原启动归属变化'); templateColumnsSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('模板字段选择原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('真实选列排序、宽表精简及独立查询保持原表草稿', async ({ templateColumnsSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = templateColumnsSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, qualified = '`' + database + '`.`subject`';
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    /** 每步核原窗口、原进程和原观察socket；失败保留现场，不能补退出或删库。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('模板字段选择原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('模板字段选择原profile身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '原表草稿与模板前', '选列顺序与父草稿核对', '退出客户端前', '退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false;
    /** 明确五个阶段复读完整来源集合；不把阶段证据扩称逐动作Main审计。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => {
      check(); if (sourcePending || phases[sourceChecks.length] !== phase) throw Error('模板字段选择来源阶段失配'); sourcePending = true;
      await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false;
    };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      exists: 'SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      first: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,note FROM ' + qualified + ' ORDER BY id LIMIT 1',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    /** 观察连接只接受四条固定只读语句与当前唯一随机库参数。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<any> => {
      if (!Object.values(statements).includes(sql) || sql === statements.exists && (params.length !== 1 || params[0] !== database) || sql === statements.threads && (params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])) || ![statements.exists, statements.threads].includes(sql) && params.length !== 0) throw Error('模板字段选择观察语句越界');
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
      expect(await read(statements.exists, [database])).toEqual([{ name: 'subject' }, { name: 'subject_view' }, { name: 'wide' }]); const firstBefore = await read(statements.first);
      expect(firstBefore).toEqual([{ id: '9007199254740993', amount: '123456789012345678.000001', note: '' }]);
      await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '模板选列本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
      expect(Boolean(profile.name === '模板选列本例' && profile.host === '192.168.31.200' && profile.port === 13384 && profile.user === environment.values.DBARK_TEST_USER && profile.database === database && profile.rememberPassword === false && profile.password === undefined && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const select = templateText.generatedComment + '\nSELECT\n  `note`,\n  `id`,\n  `amount`\nFROM ' + qualified + '\nLIMIT 1000;';
      const insert = templateText.generatedComment + '\nINSERT INTO ' + qualified + '\nSET\n  `note` = :value_1,\n  `amount` = :value_2;';
      const update = templateText.generatedComment + '\nUPDATE ' + qualified + '\nSET\n  `note` = :value_1\nWHERE\n  `id` = :key_1\nLIMIT 1;';
      // 仅限一次指定SELECT和两次参数名读取的防写观察器；不声称覆盖全部Main IPC。
      await step(() => application.evaluate(({ ipcMain }, input) => {
        const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request'), root = globalThis as any;
        if (typeof original !== 'function' || root.__templateColumns) throw Error('模板选列观察器归属未知');
        const state = { selects: 0, parameters: 0, writes: 0, pending: 0, rows: 0, names: [] as string[], first: undefined as unknown }; root.__templateColumns = state;
        const sessions = new Set<string>(); let sessionCount = 0;
        handlers.set('dbark:request', async (event: any, payload: any) => {
          const command = payload.command, value = payload.input;
          if (command.startsWith('schema.') || ['table.apply', 'table.preview', 'query.executeParameterized'].includes(command)) { state.writes++; throw Error('本例禁止产品写入'); }
          if (command === 'sessions.open' && (sessionCount >= 3 || value.connectionId !== input.id || value.database !== input.database)) throw Error('本例只打开三个准确连接及数据库会话');
          if (command === 'query.execute' && (state.selects++ || !sessions.has(value.sessionId) || value.sql.replaceAll('\r\n', '\n') !== input.select)) throw Error('本例只接受原会话的一次明确选列SELECT');
          if (command === 'query.parameterNames' && (!sessions.has(value.sessionId) || state.parameters >= 2 || value.sql.replaceAll('\r\n', '\n') !== [input.insert, input.update][state.parameters++])) throw Error('本例参数名读取会话、目标或顺序变化');
          if (command === 'sessions.close' && !sessions.has(value.sessionId)) throw Error('本例拒绝关闭未知会话');
          if (!['sessions.open', 'sessions.close', 'query.execute', 'query.parameterNames'].includes(command)) return original(event, payload);
          state.pending++;
          try {
            const reply = await original(event, payload);
            if (command === 'sessions.open') {
              if (reply?.ok !== true || typeof reply.result?.sessionId !== 'string' || !reply.result.sessionId || sessions.has(reply.result.sessionId)) throw Error('原打开会话回执失效');
              sessions.add(reply.result.sessionId); sessionCount++;
            }
            if (command === 'sessions.close' && reply?.ok === true) sessions.delete(value.sessionId);
            if (command === 'query.execute') {
              if (!reply?.ok || reply.result.results.length !== 1) throw Error('选列SELECT结果失效');
              const result = reply.result.results[0], columns = result.columns, rows = result.rows;
              if (!Array.isArray(columns) || columns.map((c: any) => c.name).join(',') !== 'note,id,amount' || columns.some((c: any) => typeof c.key !== 'string' || !c.key) || new Set(columns.map((c: any) => c.key)).size !== 3 || !Array.isArray(rows)) throw Error('选列结果内部列身份失效');
              const matched = rows.filter((r: any) => Object.hasOwn(r, columns[1].key) && r[columns[1].key] === '9007199254740993');
              if (matched.length !== 1 || !Object.hasOwn(matched[0], columns[0].key) || !Object.hasOwn(matched[0], columns[2].key)) throw Error('选列结果原行身份失效');
              state.rows = rows.length; state.names = columns.map((c: any) => c.name); state.first = { note: matched[0][columns[0].key], id: matched[0][columns[1].key], amount: matched[0][columns[2].key] };
            }
            return reply;
          } finally { state.pending--; }
        });
      }, { id: profile.id, database, select, insert, update }));
      const state = () => step(() => application.evaluate(() => (globalThis as any).__templateColumns as { selects: number; parameters: number; writes: number; pending: number; rows: number; names: string[]; first: unknown }));
      const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click()); const table = page.locator('.table-tab:visible'); const grid = table.getByRole('grid'); await step(() => expect(grid).toContainText('9007199254740993'));
      await step(() => expect.poll(async () => (await settings()).tabs.filter(tab => tab.kind === 'table').length).toBe(1)); const tableTab = (await settings()).tabs.find(tab => tab.kind === 'table')!;
      await step(() => grid.getByRole('gridcell').filter({ hasText: /^9007199254740993$/ }).click()); await step(() => table.getByRole('button', { name: recordText.title, exact: true }).click()); const form = page.getByRole('complementary', { name: recordText.title, exact: true });
      const note = form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^note/ }) }); await step(() => note.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => note.getByLabel('note · ' + recordText.value, { exact: true }).fill('父页未提交草稿')); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible());
      await verifySource('原表草稿与模板前'); const modal = page.getByRole('dialog', { name: templateText.title, exact: true });
      const open = async () => { await step(() => table.getByRole('button', { name: templateText.entry, exact: true }).click()); await step(() => expect(modal).toBeVisible()); };
      const choose = (name: string) => step(() => modal.getByRole('checkbox', { name: templateText.chooseColumn(name), exact: true }).check());
      const returnTable = () => step(() => page.locator('.tab-strip .tab-select').filter({ has: page.getByText(tableTab.title, { exact: true }) }).click());
      /** 等待正式持久化，确认新查询保留连接/数据库，且无文件或原表绑定。 */
      const openQuery = async (sql: string) => {
        await step(() => expect(modal.getByLabel(templateText.preview, { exact: true })).toHaveText(sql)); await step(() => modal.getByRole('button', { name: templateText.open, exact: true }).click()); await step(() => expect(modal).toBeHidden());
        await step(() => expect.poll(async () => { const current = await settings(); return current.tabs.find(tab => tab.id === current.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(sql));
        const current = await settings(), tab = current.tabs.find(tab => tab.id === current.activeTabId)!;
        expect(tab.kind).toBe('query'); expect(tab.connectionId).toBe(profile.id); expect(tab.databaseContext).toEqual({ state: 'known', database }); expect(tab.sourceBinding).toBeUndefined(); expect(tab.fileSourceBinding).toBeUndefined();
      };
      await open(); await step(() => expect(modal.getByRole('checkbox')).toHaveCount(5)); await step(() => modal.getByRole('button', { name: templateText.clearColumns, exact: true }).click()); await step(() => expect(modal.getByText(templateText.fieldRequired, { exact: true })).toBeVisible()); await step(() => expect(modal.getByRole('button', { name: templateText.open, exact: true })).toBeDisabled());
      for (const name of ['id', 'amount', 'note']) await choose(name);
      await step(() => modal.getByRole('button', { name: templateText.moveColumnUp('note'), exact: true }).click()); await step(() => modal.getByRole('button', { name: templateText.moveColumnUp('note'), exact: true }).click());
      const screenshotPath = resolve(info.outputPath('模板选列与SQL预览.png')), inside = relative(directory, screenshotPath); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('截图不能写入原profile'); await step(() => modal.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      await openQuery(select); expect((await state()).selects).toBe(0); const queryView = page.locator('.query-tab:visible'); await step(() => queryView.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect.poll(async () => (await state()).rows).toBe(61)); expect((await state()).first).toEqual(firstBefore[0]); await step(() => expect(queryView.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled());
      for (const [kind, sql, columns, names] of [['INSERT', insert, ['note', 'amount'], ['value_1', 'value_2']], ['UPDATE', update, ['note'], ['value_1', 'key_1']]] as const) {
        await returnTable(); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => expect(note).toContainText('父页未提交草稿')); await open(); await step(() => modal.getByRole('combobox', { name: templateText.kind, exact: true }).selectOption(kind));
        for (const name of ['id', 'computed']) await step(() => expect(modal.getByRole('checkbox', { name: templateText.chooseColumn(name), exact: true })).toHaveCount(0));
        await step(() => modal.getByRole('button', { name: templateText.clearColumns, exact: true }).click()); for (const name of columns) await choose(name); await openQuery(sql);
        await step(() => queryView.getByRole('button', { name: parameterZh.open, exact: true }).click()); const parameters = page.getByRole('dialog', { name: parameterZh.title, exact: true });
        for (const [index, name] of names.entries()) await step(() => expect(parameters.getByRole('textbox', { name: `${parameterZh.name} ${index + 1}`, exact: true })).toHaveValue(name));
        await step(() => expect(parameters.getByRole('textbox', { name: new RegExp('^' + parameterZh.name + ' ') })).toHaveCount(names.length)); await step(() => parameters.getByRole('button', { name: zh.common.cancel, exact: true }).click());
      }
      await returnTable(); await open(); await step(() => modal.getByRole('combobox', { name: templateText.kind, exact: true }).selectOption('DELETE')); await step(() => expect(modal.getByRole('checkbox')).toHaveCount(0)); await step(() => expect(modal.getByLabel(templateText.preview, { exact: true })).toHaveText(templateText.generatedComment + '\nDELETE FROM ' + qualified + '\nWHERE\n  `id` = :key_1\nLIMIT 1;')); await step(() => modal.getByRole('button', { name: templateText.close, exact: true }).click());
      await step(() => node.locator('.object-row').getByRole('button', { name: 'wide', exact: true }).click()); await step(() => expect(table.getByRole('grid')).toBeVisible()); await open(); await step(() => modal.getByRole('combobox', { name: templateText.kind, exact: true }).selectOption('INSERT')); await step(() => expect(modal.getByText(templateText.budget, { exact: true })).toBeVisible()); await step(() => expect(modal.getByRole('button', { name: templateText.open, exact: true })).toBeDisabled()); await step(() => expect(modal.getByRole('checkbox')).toHaveCount(50));
      await step(() => modal.getByRole('button', { name: templateText.columnsNext, exact: true }).click()); await step(() => expect(modal.getByText(templateText.columnsPage(2, 5), { exact: true })).toBeVisible()); await step(() => expect(modal.getByRole('checkbox')).toHaveCount(50)); await step(() => modal.getByRole('button', { name: templateText.clearColumns, exact: true }).click()); await step(() => modal.getByRole('textbox', { name: templateText.filterColumns, exact: true }).fill('c204')); await choose('c204');
      await step(() => expect(modal.getByRole('checkbox')).toHaveCount(1)); await step(() => expect(modal.getByLabel(templateText.preview, { exact: true })).toHaveText(templateText.generatedComment + '\nINSERT INTO `' + database + '`.`wide`\nSET\n  `c204` = :value_1;')); await step(() => expect(modal.getByRole('button', { name: templateText.open, exact: true })).toBeEnabled()); await step(() => modal.getByRole('button', { name: templateText.close, exact: true }).click());
      await returnTable(); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => expect(note).toContainText('父页未提交草稿')); expect(await read(statements.first)).toEqual(firstBefore); await verifySource('选列顺序与父草稿核对');
      await step(() => table.getByRole('button', { name: draftHistoryZh.undo, exact: true }).click()); await step(() => expect(form.getByText(recordText.unchanged, { exact: true })).toBeVisible());
      const final = await state(); expect(final).toEqual({ selects: 1, parameters: 2, writes: 0, pending: 0, rows: 61, names: ['note', 'id', 'amount'], first: firstBefore[0] });
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(tasks.some(task => task.kind === 'table.apply' || task.kind === 'table.preview' || task.kind.startsWith('schema.'))).toBe(false); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toHaveLength(1);
      await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed).toBe(true); await verifySource('退出与控制收尾后'); expect(sourceChecks).toEqual(phases);
      await step(() => info.attach('模板选列专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-query-template-columns-ui', version: 1, platform: process.platform, database, objects: ['subject', 'subject_view', 'wide'], serverVersion: '8.4.11', controlThreadId: threadId, selectedColumns: ['note', 'id', 'amount'], selectRows: 61, firstRow: firstBefore[0], parameterNames: [['value_1', 'value_2'], ['value_1', 'key_1']], wideWritableColumns: 205, maxRenderedColumnChoices: 50, wideNarrowedColumns: ['c204'], parentDraftPreserved: true, noAutomaticExecution: true, audit: final, normalExit: closed, originalProcessExitCode: originalProcess.exitCode, observerClosed, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, source: { manifestSha256: environment.values.DBARK_TEMPLATE_COLUMNS_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
