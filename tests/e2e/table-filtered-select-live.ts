import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors, dialogCalls } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableFilteredSelectZh as text } from '../../src/renderer/locales/tableFilteredSelect.zh-CN';
import { tableQueryTemplateZh as template } from '../../src/renderer/locales/tableQueryTemplate.zh-CN';
import { tableFilterGroupsZh as groups } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { tableFilterEnabledZh as enabled } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';
import { tableSortZh as sortingText } from '../../src/renderer/locales/tableSort.zh-CN';
import { recordViewZh as record } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';

type Environment = ReturnType<typeof import('./table-filtered-select.spec').bindFilteredSelectUiEnvironment>;
type ResultRow = { label: string; id: string; amount: string };
interface Audit {
  queryExecuteCount: number; writes: number; pending: number; sessionsOpened: number; approvedSql?: string; approved: boolean;
  counts: Record<string, number>; rows: ResultRow[]; pages: { input: { page: number; pageSize: number; filters: unknown; filterGroup?: unknown; sort: unknown }; ids?: string[]; hasMore?: boolean }[];
}

/** 只消费Root预置库，所有观察SQL固定只读；不建库、删库、SSH或Docker。 */
export function registerTableFilteredSelectUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_FILTERED_SELECT_OUTPUT), outputStat = sync.lstatSync(output);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('当前筛选SELECT需要原已存在空的独占输出目录');
  const outputNames = new Set<string>();
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !outputNames.has(name))) throw Error('当前筛选SELECT配置或输出目录身份变化');
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ filteredSelectSource: { clock: Clock; identity: Identity; check(): void } }>({
    filteredSelectSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('当前筛选SELECT必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_FILTERED_SELECT_MANIFEST, values.DBARK_FILTERED_SELECT_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('当前筛选SELECT只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ filteredSelectSource }, use) => { await use({ assertCurrent: filteredSelectSource.check, assertPreparation(info) { if (clocks.get(info) !== filteredSelectSource.clock) throw Error('当前筛选SELECT原启动归属变化'); filteredSelectSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('当前筛选SELECT原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式表页嵌套筛选生成独立SELECT并明确执行，保留父页第二页及草稿', async ({ filteredSelectSource, trace, screenshot, video }, info) => {
    const { clock, identity } = filteredSelectSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      filteredSelectSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('当前筛选SELECT原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('当前筛选SELECT原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('当前筛选SELECT原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE, qualified = '`' + database + '`.`subject`';
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`',
      rows: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,label,note FROM ' + qualified + ' ORDER BY id',
      // 独立固定SQL与数学期待，不调用产品生成器求期望，也不执行预览之外的产品SQL。
      expected: "SELECT label,CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount FROM " + qualified + " WHERE (label='Alpha' OR label='Beta') AND id>=CAST('9007199254740993' AS UNSIGNED) ORDER BY label ASC,id DESC LIMIT 1000",
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 原mysql callback与原Query end都到达后才返回；错误不能伪造命令终态。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('当前筛选SELECT观察命令归属或前序终态无效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command);
      let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('当前筛选SELECT观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    /** 前后都核实际服务器及Root唯一标记，不能用输入域名替代实际身份。 */
    const assertObserverIdentity = async () => {
      const actual = await readObserver('identity'); expect(actual).toHaveLength(1);
      expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread);
      expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_FILTERED_SELECT_OWNER }]);
    };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid })));
    await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    const inside = relative(profileDirectory, output); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('当前筛选SELECT输出不能位于原profile内');
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('当前筛选SELECT原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('当前筛选SELECT原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); const before = await readObserver('rows'); expect(before).toHaveLength(121);
    expect(before).toEqual(Array.from({ length: 121 }, (_, index) => { const i = index + 1; return { id: String(9007199254740992n + BigInt(i)), amount: '123456789012345678.' + String(i).padStart(6, '0'), label: i % 3 === 0 ? 'Alpha' : i % 3 === 1 ? 'Beta' : null, note: 'original-' + i }; }));
    const expected = await readObserver('expected'); expect(expected).toHaveLength(81);
    const mathematical = [...before.filter(row => row.label === 'Alpha').reverse(), ...before.filter(row => row.label === 'Beta').reverse()].map(({ label, id, amount }) => ({ label, id, amount })); expect(expected).toEqual(mathematical);

    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** 原Main handler逐条透传并审计；只准明确按钮后的本预览单SELECT，禁止产品写入。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request');
      if (root.__filteredSelectUi || typeof originalHandler !== 'function') throw Error('当前筛选SELECT原Main审计归属未知');
      const state = { queryExecuteCount: 0, writes: 0, pending: 0, sessionsOpened: 0, approved: false, approvedSql: undefined as string | undefined, connectionId: undefined as string | undefined, counts: {} as Record<string, number>, rows: [] as any[], pages: [] as any[] }; root.__filteredSelectUi = state;
      const sessions = new Set<string>();
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('当前筛选SELECT原Main处理器或窗口已变化');
        const command = payload.command, value = payload.input; state.counts[command] = (state.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || ['table.apply', 'table.preview', 'query.executeParameterized', 'query.explain', 'query.exportStream', 'query.transaction', 'table.exportFiltered', 'table.import'].includes(command)) { state.writes++; throw Error('当前筛选SELECT禁止产品写入及额外执行'); }
        if (command === 'sessions.open' && (state.sessionsOpened !== 0 || !state.connectionId || value.connectionId !== state.connectionId || value.database !== input.database)) throw Error('当前筛选SELECT独立会话目标无效');
        if (command === 'query.execute') {
          state.queryExecuteCount++;
          if (state.queryExecuteCount !== 1 || !state.approved || typeof state.approvedSql !== 'string' || value.sql !== state.approvedSql || !sessions.has(value.sessionId)) throw Error('当前筛选SELECT只准一次明确审阅的单条SELECT');
          state.approved = false;
        }
        let entry: any;
        if (command === 'table.page') {
          if (!state.connectionId || value.connectionId !== state.connectionId || value.database !== input.database || value.table !== 'subject') throw Error('当前筛选SELECT表页目标无效');
          entry = { input: structuredClone({ page: value.page, pageSize: value.pageSize, filters: value.filters, filterGroup: value.filterGroup, sort: value.sort }) }; state.pages.push(entry);
        }
        state.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'sessions.open') { if (!reply?.ok || typeof reply.result?.sessionId !== 'string' || !reply.result.sessionId || sessions.has(reply.result.sessionId)) throw Error('当前筛选SELECT原会话回执失效'); sessions.add(reply.result.sessionId); state.sessionsOpened++; }
          if (command === 'sessions.close' && reply?.ok) sessions.delete(value.sessionId);
          if (command === 'table.page') { if (!reply?.ok || !Array.isArray(reply.result?.rows)) throw Error('当前筛选SELECT正式表页未成功'); entry.ids = reply.result.rows.map((row: any) => row.id); entry.hasMore = reply.result.hasMore; }
          if (command === 'query.execute') {
            if (!reply?.ok || reply.result.results?.length !== 1) throw Error('当前筛选SELECT真实结果失效');
            const result = reply.result.results[0], columns = result.columns;
            if (!Array.isArray(columns) || columns.map((column: any) => column.name).join(',') !== 'label,id,amount' || columns.some((column: any) => typeof column.key !== 'string' || !column.key) || new Set(columns.map((column: any) => column.key)).size !== 3 || !Array.isArray(result.rows)) throw Error('当前筛选SELECT结果内部列身份失效');
            state.rows = result.rows.map((row: any) => { if (columns.some((column: any) => !Object.hasOwn(row, column.key))) throw Error('当前筛选SELECT结果行不完整'); return { label: row[columns[0].key], id: row[columns[1].key], amount: row[columns[2].key] }; });
          }
          return reply;
        } finally { state.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__filteredSelectUiHandler = wrapped;
    }, { database, senderId }));
    const state = () => step(() => application.evaluate(() => { const root = globalThis as any; if (!root.__filteredSelectUiHandler) throw Error('当前筛选SELECT审计缺失'); return structuredClone(root.__filteredSelectUi) as Audit; }));
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '当前筛选SELECT本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
    expect({ name: profile.name, host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ name: '当前筛选SELECT本例', host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    await step(() => application.evaluate((_electron, id) => { const state = (globalThis as any).__filteredSelectUi; if (state.connectionId) throw Error('当前筛选SELECT连接已绑定'); state.connectionId = id; }, profile.id));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click());
    const table = page.locator('.table-tab:visible'), action = table.locator('.table-action-bar'), grid = table.getByRole('grid');
    /** 等待真实新回包结束，不把旧页文本或已发出的请求当成读取完成。 */
    const settled = async (count?: number) => { if (count !== undefined) await step(() => expect.poll(async () => (await state()).pages.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids !== undefined).toBe(true)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); };
    await step(() => expect(grid).toBeVisible()); await settled();
    let pageCount = (await state()).pages.length; await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await settled(pageCount + 1);
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click()); const filterForm = table.locator('.filter-rule-form');
    /** 条件从正式表单依次添加，精确十进制始终保留原字符串。 */
    const addRule = async (column: string, operator: string, value: string) => {
      await step(() => filterForm.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption(column)); await step(() => filterForm.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption(operator)); await step(() => filterForm.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(value));
      const count = (await state()).pages.length; await step(() => filterForm.getByRole('button', { name: zh.table.text013, exact: true }).click()); await settled(count + 1);
    };
    await addRule('label', '=', 'Alpha'); await addRule('label', '=', 'Beta'); await addRule('id', '>=', '9007199254740993'); await addRule('amount', '>', '999999999999999999.999999');
    pageCount = (await state()).pages.length; await step(() => table.getByRole('checkbox', { name: enabled.enabled(4), exact: true }).uncheck()); await settled(pageCount + 1);
    await step(() => table.getByRole('button', { name: groups.open, exact: true }).click()); const grouping = table.getByRole('region', { name: groups.title, exact: true });
    await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode(), exact: true })).toHaveValue('all')); await step(() => grouping.getByRole('button', { name: groups.addGroup(), exact: true }).click()); await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode('1'), exact: true })).toHaveValue('any'));
    for (const index of [1, 2]) await step(() => grouping.getByRole('combobox', { name: groups.destination(index), exact: true }).selectOption({ label: groups.group('1') }));
    pageCount = (await state()).pages.length; await step(() => grouping.getByRole('button', { name: groups.apply, exact: true }).click()); await settled(pageCount + 1);
    await step(() => table.getByRole('button', { name: sortingText.entry, exact: true }).click()); const sorting = table.getByRole('region', { name: sortingText.title, exact: true });
    for (const [index, column] of ['label', 'id'].entries()) { await step(() => sorting.getByRole('button', { name: sortingText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortingText.field(index + 1), exact: true }).selectOption(column)); }
    await step(() => sorting.getByRole('combobox', { name: sortingText.direction(2), exact: true }).selectOption('DESC')); pageCount = (await state()).pages.length; await step(() => sorting.getByRole('button', { name: sortingText.apply, exact: true }).click()); await settled(pageCount + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(expected.slice(0, 50).map(row => row.id)); pageCount = (await state()).pages.length; await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(pageCount + 1);
    const parentPage = (await state()).pages.at(-1)!; expect(parentPage.input).toMatchObject({ page: 2, pageSize: 50, filters: [{ column: 'label', operator: '=', value: 'Alpha' }, { column: 'label', operator: '=', value: 'Beta' }, { column: 'id', operator: '>=', value: '9007199254740993' }, { column: 'amount', operator: '>', value: '999999999999999999.999999', enabled: false }], filterGroup: { mode: 'all', children: [2, 3, { mode: 'any', children: [0, 1] }] }, sort: [{ column: 'label', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] }); expect(parentPage.ids).toEqual(expected.slice(50).map(row => row.id)); expect(parentPage.hasMore).toBe(false); expect(parentPage.ids).toHaveLength(31);
    const parentId = parentPage.ids![0]; await step(() => grid.getByRole('gridcell').filter({ hasText: new RegExp('^' + parentId + '$') }).click()); await step(() => table.getByRole('button', { name: record.title, exact: true }).click()); const form = table.getByRole('complementary', { name: record.title, exact: true }), note = form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^note/ }) });
    await step(() => note.getByRole('button', { name: record.editField, exact: true }).click()); await step(() => note.getByLabel('note · ' + record.value, { exact: true }).fill('父页未提交草稿')); await step(() => form.getByRole('button', { name: record.stage, exact: true }).click()); await step(() => expect(form.getByText(record.staged, { exact: true })).toBeVisible());
    const parent = (await settings()).tabs.find(tab => tab.kind === 'table')!; expect(parent).toBeDefined(); expect((await settings()).resultLimit).toBe(1000); const parentPageCount = (await state()).pages.length;
    /** 用固定fixture语法独立拼出准确预览，不调用产品SQL编译器计算期望。 */
    const literal = (value: string) => "_utf8mb4 X'" + Buffer.from(value, 'utf8').toString('hex') + "'";
    const where = '((`id` >= CAST(CAST(' + literal('9007199254740993') + ' AS DECIMAL(20,0)) AS UNSIGNED)) AND ((`label` = ' + literal('Alpha') + ') OR (`label` = ' + literal('Beta') + ')))';
    const sqlFor = (columns: string[]) => 'SELECT ' + columns.map(column => '`' + column + '`').join(', ') + ' FROM ' + qualified + ' WHERE ' + where + ' ORDER BY `label` ASC, `id` DESC LIMIT 1000;';
    const modal = page.getByRole('dialog', { name: text.title, exact: true });
    const open = async () => { await step(() => table.getByRole('button', { name: text.entry, exact: true }).click()); await step(() => expect(modal).toBeVisible()); await step(() => expect(page.locator('[data-table-filtered-select-dialog]')).toHaveCount(1)); await step(() => expect(modal.getByRole('combobox', { name: template.kind, exact: true })).toHaveCount(0)); };
    /** 草稿、第二页原回包和可见行数共同确认父状态保持，不能只看标签名称。 */
    const assertParent = async () => { await step(() => expect(form.getByText(record.staged, { exact: true })).toBeVisible()); await step(() => expect(note).toContainText('父页未提交草稿')); await step(() => expect(action.getByText(zh.table.text023 + '2' + zh.table.text024, { exact: true })).toBeVisible()); await step(() => expect(grid).toHaveAttribute('aria-rowcount', '32')); expect((await state()).pages).toHaveLength(parentPageCount); expect((await state()).pages.at(-1)).toEqual(parentPage); expect(await readObserver('rows')).toEqual(before); };
    await step(() => identity.assertCurrent()); await open();
    await step(() => expect(modal.getByLabel(text.preview, { exact: true })).toHaveText(sqlFor(['id', 'amount', 'label', 'note']))); await step(() => expect(modal).toContainText(text.scope(1000))); await step(() => expect(modal.getByRole('region', { name: text.conditions, exact: true })).toContainText(text.disabledRule));
    expect((await state()).queryExecuteCount).toBe(0); await step(() => modal.getByRole('button', { name: template.close, exact: true }).click()); await step(() => expect(modal).toBeHidden()); await assertParent();
    await open(); await step(() => expect(modal.getByRole('region', { name: text.columns, exact: true })).toBeVisible()); await step(() => modal.getByRole('button', { name: template.clearColumns, exact: true }).click()); await step(() => expect(modal.getByRole('button', { name: template.open, exact: true })).toBeDisabled());
    for (const name of ['id', 'amount', 'label']) await step(() => modal.getByRole('checkbox', { name: template.chooseColumn(name), exact: true }).check());
    for (let count = 0; count < 2; count++) await step(() => modal.getByRole('button', { name: template.moveColumnUp('label'), exact: true }).click());
    const sql = sqlFor(['label', 'id', 'amount']); await step(() => expect(modal.getByLabel(text.preview, { exact: true })).toHaveText(sql));
    const preview = await step(() => modal.getByLabel(text.preview, { exact: true }).innerText()); expect(preview).toBe(sql); expect(preview).not.toMatch(/\bOFFSET\b|父页未提交草稿|999999999999999999/); expect(preview).not.toContain(literal('999999999999999999.999999')); expect(preview.match(/;/g)).toHaveLength(1); expect(preview.startsWith('SELECT `label`, `id`, `amount` FROM ' + qualified + ' WHERE ')).toBe(true);
    const screenshotName = '当前筛选SELECT-正式预览.png', screenshotPath = join(output, screenshotName); expect(sync.existsSync(screenshotPath)).toBe(false); outputNames.add(screenshotName); await step(() => modal.screenshot({ path: screenshotPath })); const screenshotHash = hash(await step(() => fs.readFile(screenshotPath))); await step(() => info.attach('当前筛选SELECT正式预览', { path: screenshotPath, contentType: 'image/png' }));
    await step(() => modal.getByRole('button', { name: template.open, exact: true }).click()); await step(() => expect(modal).toBeHidden());
    await step(() => expect.poll(async () => { const current = await settings(); return current.tabs.find(tab => tab.id === current.activeTabId)?.sql; }).toBe(sql));
    const current = await settings(), query = current.tabs.find(tab => tab.id === current.activeTabId)!; expect(query.kind).toBe('query'); expect(query.id).not.toBe(parent.id); expect(query.connectionId).toBe(profile.id); expect(query.databaseContext).toEqual({ state: 'known', database }); expect(query.table).toBeUndefined(); expect(query.sourceBinding).toBeUndefined(); expect(query.fileSourceBinding).toBeUndefined(); expect(query.sql).toBe(preview);
    expect((await state()).queryExecuteCount).toBe(0); expect((await state()).sessionsOpened).toBe(0); await step(() => identity.assertCurrent());
    await step(() => application.evaluate((_electron, approvedSql) => { const state = (globalThis as any).__filteredSelectUi; if (state.queryExecuteCount || state.approved || state.approvedSql) throw Error('当前筛选SELECT执行许可重复'); state.approvedSql = approvedSql; state.approved = true; }, preview));
    const queryView = page.locator('.query-tab:visible'); await step(() => queryView.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect.poll(async () => (await state()).rows.length).toBe(81)); await step(() => expect(queryView.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); expect((await state()).rows).toEqual(expected);
    await step(() => page.locator('.tab-strip .tab-select').filter({ has: page.getByText(parent.title, { exact: true }) }).click()); await assertParent();
    await step(() => table.getByRole('button', { name: draftHistoryZh.undo, exact: true }).click()); await step(() => expect(form.getByText(record.unchanged, { exact: true })).toBeVisible());
    // 正式关闭独立查询并明确放弃草稿，退出前不留宽泛原生确认适配器。
    await step(() => page.locator('.tab-strip').getByRole('button', { name: formatText(zh.app.text012, query.title), exact: true }).click()); const closing = page.getByRole('dialog', { name: queryCloseZh.title, exact: true }); await step(() => expect(closing).toBeVisible()); await step(() => closing.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(closing).toBeHidden()); await step(() => expect.poll(async () => (await settings()).tabs.some(tab => tab.id === query.id)).toBe(false));
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(tasks.some(task => task.kind === 'table.apply' || task.kind === 'table.preview' || task.kind.startsWith('schema.'))).toBe(false);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toHaveLength(1); expect(pageErrors).toEqual([]); await step(() => identity.assertCurrent());
    const final = await state(); expect({ queryExecuteCount: final.queryExecuteCount, writes: final.writes, pending: final.pending, sessionsOpened: final.sessionsOpened, approved: final.approved }).toEqual({ queryExecuteCount: 1, writes: 0, pending: 0, sessionsOpened: 1, approved: false });
    await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent());
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(before); expect(await readObserver('expected')).toEqual(expected); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true);
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('当前筛选SELECT正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-filtered-select-ui', database, selectedColumns: ['label', 'id', 'amount'], resultRows: 81, originalPage: 2, originalPageRows: 31, parentDraftPreserved: true, noAutomaticExecution: true, audit: { queryExecuteCount: final.queryExecuteCount, writes: final.writes, pending: final.pending, sessionsOpened: final.sessionsOpened, counts: final.counts }, normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, originalOwnerVerifiedBeforeAndAfter: true, serverUuidVerified: true, fixtureRowsUnchanged: true, databaseRetainedForRoot: true, sourceManifest: values.DBARK_FILTERED_SELECT_MANIFEST_SHA256, sourceVerifiedBeforeAndAfter: true, screenshot: { path: screenshotPath, sha256: screenshotHash }, mainIpcAudit: { scope: '原窗口dbark:request逐条透传计数；query.execute仅一次准确预览SELECT；schema及table.apply/table.preview和额外执行拒绝', otherIpcDomainsVerified: false, directServerSqlAuditVerified: false }, queryClosedThroughFormalDiscard: true, nativeConfirmationInputVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}
