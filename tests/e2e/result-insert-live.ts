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
import { resultInsertZh as text } from '../../src/renderer/locales/resultInsert.zh-CN';
import { queryResultFilterZh as filterText } from '../../src/renderer/locales/queryResultFilter.zh-CN';
import { queryResultSortZh as sortText } from '../../src/renderer/locales/queryResultSort.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';

type Environment = ReturnType<typeof import('./result-insert.spec').bindResultInsertUiEnvironment>;
type ResultRow = { source_id: string; source_amount: string; source_payload: { type: 'binary'; base64: string }; source_note: string | null };
interface Audit {
  queries: number; forbidden: number; pending: number; sessionsOpened: number; applies: number; releases: number;
  counts: Record<string, number>; columns: { key: string; name: string; type: string }[]; rows: ResultRow[];
  previews: { rows: number; mapping: unknown; token?: string; released: boolean }[]; committed?: { rows: number; outcome: string; commitAcknowledged: boolean };
}

/** 只消费Root预置目标库；除真实确认的两行追加外，观察连接全部固定只读。 */
export function registerResultInsertUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_RESULT_INSERT_UI_OUTPUT), outputStat = sync.lstatSync(output);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('结果写入已有表需要原已存在空的独占输出目录');
  const outputNames = new Set<string>();
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !outputNames.has(name))) throw Error('结果写入已有表配置或输出目录身份变化');
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ resultInsertSource: { clock: Clock; identity: Identity; check(): void } }>({
    resultInsertSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('结果写入已有表必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_RESULT_INSERT_UI_MANIFEST, values.DBARK_RESULT_INSERT_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('结果写入已有表只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ resultInsertSource }, use) => { await use({ assertCurrent: resultInsertSource.check, assertPreparation(info) { if (clocks.get(info) !== resultInsertSource.clock) throw Error('结果写入已有表原启动归属变化'); resultInsertSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('结果写入已有表原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式结果视图取消四行预览、明确追加勾选两行并保留原查询', async ({ resultInsertSource, trace, screenshot, video }, info) => {
    const { clock, identity } = resultInsertSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      resultInsertSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('结果写入已有表原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('结果写入已有表原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('结果写入已有表原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE, qualified = '`' + database + '`.`target`';
    const sourceRows: ResultRow[] = [
      { source_id: '9007199254740993', source_amount: '2.000000000000', source_payload: { type: 'binary', base64: 'AQ==' }, source_note: '排除' },
      { source_id: '9007199254740994', source_amount: '9007199254740993.123456789012', source_payload: { type: 'binary', base64: 'AP8=' }, source_note: null },
      { source_id: '9007199254740995', source_amount: '-9007199254740993.123456789011', source_payload: { type: 'binary', base64: '' }, source_note: '中文' },
      { source_id: '9007199254740996', source_amount: '0.000000000001', source_payload: { type: 'binary', base64: 'J1wA' }, source_note: '中文' },
      { source_id: '9007199254740997', source_amount: '1.000000000000', source_payload: { type: 'binary', base64: '/wA=' }, source_note: 'A' },
    ];
    // 固定五行常量SQL只由用户编辑器输入并执行一次；目标已有表从不充当源。
    const sourceSql = "SELECT CAST('9007199254740993' AS UNSIGNED) AS source_id,CAST('2.000000000000' AS DECIMAL(30,12)) AS source_amount,CAST(X'01' AS BINARY) AS source_payload,_utf8mb4 X'e68e92e999a4' AS source_note\nUNION ALL SELECT CAST('9007199254740994' AS UNSIGNED),CAST('9007199254740993.123456789012' AS DECIMAL(30,12)),CAST(X'00ff' AS BINARY),NULL\nUNION ALL SELECT CAST('9007199254740995' AS UNSIGNED),CAST('-9007199254740993.123456789011' AS DECIMAL(30,12)),CAST(X'' AS BINARY),_utf8mb4 X'e4b8ade69687'\nUNION ALL SELECT CAST('9007199254740996' AS UNSIGNED),CAST('0.000000000001' AS DECIMAL(30,12)),CAST(X'275c00' AS BINARY),_utf8mb4 X'e4b8ade69687'\nUNION ALL SELECT CAST('9007199254740997' AS UNSIGNED),CAST('1.000000000000' AS DECIMAL(30,12)),CAST(X'ff00' AS BINARY),_utf8mb4 X'41';".replaceAll('\n', ' ');
    const viewRows = [sourceRows[1], sourceRows[4], sourceRows[3], sourceRows[2]], selectedRows = [sourceRows[1], sourceRows[2]];
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`',
      rows: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,note FROM ' + qualified + ' ORDER BY id',
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 只发固定只读白名单，必须收到原callback及原Query end双终态。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('结果追加写入原观察命令归属或前序终态无效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('结果追加写入观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const actual = await readObserver('identity'); expect(actual).toHaveLength(1); expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_RESULT_INSERT_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid })));
    await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    const inside = relative(profileDirectory, output); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('结果追加写入输出不能位于原profile内');
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('结果追加写入原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('结果追加写入原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual([]);
    await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '结果写入已有表本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true }); await step(() => newQuery.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile.id)); await step(() => newQuery.getByLabel(zh.app.text050, { exact: true }).fill(database)); await step(() => newQuery.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(newQuery).toBeHidden());
    const tab = page.locator('.query-tab:visible'), editor = tab.locator('.monaco-editor').getByRole('textbox'); await step(() => editor.focus()); await step(() => page.keyboard.press('Control+A')); await step(() => page.keyboard.insertText(sourceSql));
    // 整段输入后光标仍在正文末尾，Delete清除本例Monaco自动补在光标右侧的右括号；末尾无字符时此键不改变正文。
    // 只走真实键盘动作，不改模型或自动补全设置；下面仍逐字核对完整原SQL，未知输入差异立即保留现场。
    await step(() => page.keyboard.press('Delete'));
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    await step(() => expect.poll(async () => { const value = await settings(); return value.tabs.find(item => item.id === value.activeTabId)?.sql; }).toBe(sourceSql)); const beforeQuery = await settings(), queryTab = beforeQuery.tabs.find(item => item.id === beforeQuery.activeTabId)!;
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** 原Main handler只接受原常量SELECT一次、准确目标的两轮快照和原令牌一次提交。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (root.__resultInsertUi || typeof originalHandler !== 'function') throw Error('结果写入已有表原Main审计归属未知');
      const state = { queries: 0, forbidden: 0, pending: 0, sessionsOpened: 0, applies: 0, releases: 0, counts: {} as Record<string, number>, columns: [] as any[], rows: [] as any[], previews: [] as any[], committed: undefined as unknown }; root.__resultInsertUi = state;
      const sessions = new Set<string>(), tokens = new Map<string, any>();
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('结果追加写入原Main处理器或窗口变化');
        const command = payload.command, value = payload.input; state.counts[command] = (state.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || ['table.apply', 'table.preview', 'query.executeParameterized', 'query.transaction', 'query.explain', 'query.exportStream', 'table.exportFiltered', 'table.import'].includes(command)) { state.forbidden++; throw Error('结果追加写入禁止额外产品写入或执行'); }
        if (command === 'sessions.open' && (state.sessionsOpened || value.connectionId !== input.connectionId || value.database !== input.database)) throw Error('结果追加写入原查询会话目标变化');
        if (command === 'query.execute' && (++state.queries !== 1 || value.sql !== input.sql || !sessions.has(value.sessionId))) throw Error('结果追加写入禁止源SQL重放');
        if (command.startsWith('metadata.') && (value.connectionId !== input.connectionId || value.database !== undefined && value.database !== input.database || value.table !== undefined && value.table !== 'target')) throw Error('结果追加写入目录目标越界');
        let preview: any;
        if (command === 'result.insertPreview') {
          const expected = [input.viewRows, input.selectedRows][state.previews.length];
          if (!expected || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'target' || value.timeZone !== '+00:00' || value.data.truncated !== false || value.data.columns.length !== 4 || value.data.rows.length !== expected.length) throw Error('结果追加写入预览范围变化');
          const names = ['source_id', 'source_amount', 'source_payload', 'source_note'], targets = ['id', 'amount', 'payload', 'note'];
          // 正式导出快照投影key/name；数值、NULL、字节类型由每个原cell完整回证。
          if (value.data.columns.some((column: any, index: number) => column.name !== names[index] || column.key !== state.columns[index]?.key) || value.mapping.length !== 4) throw Error('结果追加写入原内部列身份或映射数量变化');
          for (const [index, column] of value.data.columns.entries()) {
            if (!value.mapping.some((mapping: any) => mapping.source === column.key && mapping.target === targets[index])) throw Error('结果追加写入准确映射变化');
            for (let row = 0; row < expected.length; row++) if (JSON.stringify(value.data.rows[row][column.key]) !== JSON.stringify(expected[row][names[index] as keyof typeof expected[0]])) throw Error('结果追加写入typed快照原值或排序变化');
          }
          preview = { rows: expected.length, mapping: structuredClone(value.mapping), released: false }; state.previews.push(preview);
        }
        if (command === 'result.insertRelease') { const original = tokens.get(value.previewToken); if (!original || value.connectionId !== input.connectionId || original.released || original.applied) throw Error('结果追加写入释放令牌归属变化'); original.released = true; state.releases++; }
        if (command === 'result.insertApply') { const original = tokens.get(value.previewToken); if (++state.applies !== 1 || state.previews.length !== 2 || !state.previews[0].released || original !== state.previews[1] || original.released || original.applied || value.connectionId !== input.connectionId || value.confirmation !== input.database + '.target' || value.acknowledged !== true) throw Error('结果追加写入确认、准确目标或一次性令牌变化'); original.applied = true; }
        state.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'sessions.open') { if (!reply?.ok || typeof reply.result?.sessionId !== 'string' || !reply.result.sessionId) throw Error('结果追加写入源会话回执失效'); sessions.add(reply.result.sessionId); state.sessionsOpened++; }
          if (command === 'query.execute') { if (!reply?.ok || reply.result.results?.length !== 1 || !Array.isArray(reply.result.results[0]?.rows) || reply.result.results[0].rows.length !== 5 || reply.result.transactionOpen !== false) throw Error('结果追加写入源结果或事务状态失效'); const result = reply.result.results[0]; state.columns = structuredClone(result.columns); state.rows = result.rows.map((row: any) => Object.fromEntries(result.columns.map((column: any) => [column.name, row[column.key]]))); }
          if (command === 'result.insertPreview') { if (!reply?.ok || typeof reply.result?.previewToken !== 'string' || tokens.has(reply.result.previewToken) || reply.result.rows !== preview.rows) throw Error('结果追加写入预览回执失效'); preview.token = reply.result.previewToken; tokens.set(preview.token, preview); }
          if (command === 'result.insertApply') { if (!reply?.ok || reply.result.rows !== 2 || reply.result.outcome !== 'committed' || reply.result.commitAcknowledged !== true) throw Error('结果追加写入缺少真实两行提交ACK'); state.committed = structuredClone(reply.result); }
          return reply;
        } finally { state.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__resultInsertUiHandler = wrapped;
    }, { connectionId: profile.id, database, senderId, sql: sourceSql, viewRows, selectedRows }));
    const state = () => step(() => application.evaluate(({ ipcMain }) => { const root = globalThis as any; if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__resultInsertUiHandler) throw Error('结果追加写入原Main审计已变化'); return structuredClone(root.__resultInsertUi) as Audit; }));
    await step(() => tab.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect.poll(async () => (await state()).rows.length).toBe(5)); await step(() => expect(tab.getByRole('button', { name: zh.common.stop, exact: true })).toBeDisabled()); expect((await state()).rows).toEqual(sourceRows);
    const columns = (await state()).columns; expect(columns.map(column => column.name)).toEqual(['source_id', 'source_amount', 'source_payload', 'source_note']); expect(new Set(columns.map(column => column.key)).size).toBe(4);
    const grid = tab.locator('.result-body .results-grid'), ids = () => step(() => grid.locator('[role="row"][aria-rowindex] [role="gridcell"][aria-colindex="2"]').allTextContents());
    await step(() => tab.getByRole('button', { name: filterText.open, exact: true }).click()); const filtering = tab.getByRole('region', { name: filterText.title, exact: true }); await step(() => filtering.getByRole('button', { name: filterText.add, exact: true }).click()); await step(() => filtering.getByRole('combobox', { name: filterText.column + ' 1', exact: true }).selectOption(columns[0].key)); await step(() => filtering.getByRole('combobox', { name: filterText.operator + ' 1', exact: true }).selectOption('gte')); await step(() => filtering.getByRole('textbox', { name: filterText.input + ' 1', exact: true }).fill('9007199254740994')); await step(() => filtering.getByRole('button', { name: filterText.apply, exact: true }).click()); await step(() => expect(filtering).toBeHidden());
    await step(() => tab.getByRole('button', { name: sortText.panelTitle, exact: true }).click()); const sorting = tab.getByRole('region', { name: sortText.panelTitle, exact: true });
    for (const [index, column] of [columns[3].key, columns[0].key].entries()) { await step(() => sorting.getByRole('button', { name: sortText.panelAdd, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortText.panelField(index + 1), exact: true }).selectOption(column)); }
    await step(() => sorting.getByRole('combobox', { name: sortText.panelDirection(2), exact: true }).selectOption('DESC')); await step(() => sorting.getByRole('button', { name: sortText.panelApply, exact: true }).click()); await step(() => expect(sorting).toBeHidden()); await step(() => expect.poll(ids).toEqual(viewRows.map(row => row.source_id)));
    const dialog = page.getByRole('dialog', { name: text.title, exact: true });
    /** 打开仅捕获已返回快照；读取目录必须逐层真实按钮触发。 */
    const openDialog = async (selected: boolean) => {
      const before = await state(); await step(() => tab.getByRole('button', { name: selected ? text.selected : text.open, exact: true }).click()); await step(() => expect(dialog).toBeVisible()); await step(() => expect(page.locator('[data-result-insert-owner]')).toHaveCount(1)); await step(() => expect(dialog.getByText(text.source(selected ? 2 : 4, 4, selected), { exact: true })).toBeVisible());
      const after = await state(); for (const command of ['connections.open', 'metadata.databases', 'metadata.objects', 'metadata.table', 'result.insertPreview', 'result.insertApply', 'query.execute']) expect(after.counts[command] ?? 0).toBe(before.counts[command] ?? 0);
      await step(() => expect(dialog.getByRole('combobox', { name: text.connection, exact: true })).toHaveValue(profile.id)); await step(() => dialog.getByRole('button', { name: text.databases, exact: true }).click()); await step(() => expect(dialog.getByRole('combobox', { name: text.database, exact: true })).toBeEnabled()); await step(() => dialog.getByRole('combobox', { name: text.database, exact: true }).selectOption(database));
      await step(() => dialog.getByRole('button', { name: text.tables, exact: true }).click()); await step(() => expect(dialog.getByRole('combobox', { name: text.table, exact: true })).toBeEnabled()); await step(() => dialog.getByRole('combobox', { name: text.table, exact: true }).selectOption('target')); await step(() => dialog.getByRole('button', { name: text.metadata, exact: true }).click()); await step(() => expect(dialog.getByRole('region', { name: text.mapping, exact: true })).toBeVisible());
      for (const [index, target] of ['id', 'amount', 'payload', 'note'].entries()) { const mapping = dialog.getByRole('combobox', { name: text.mappingColumn(columns[index].key), exact: true }); await step(() => expect(mapping).toHaveValue('')); await step(() => mapping.selectOption(target)); }
      await step(() => expect(dialog.getByRole('textbox', { name: text.timeZone, exact: true })).toHaveValue('+00:00')); await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect(dialog.getByLabel(text.sql, { exact: true })).toBeVisible()); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); expect((await state()).applies).toBe(0); expect(await readObserver('rows')).toEqual([]);
    };
    /** 取消后仍核原SQL、排序、筛选、事务和一次源执行，不仅核标签名。 */
    const assertParent = async () => { const current = await settings(), originalTab = current.tabs.find(item => item.id === queryTab.id); expect(originalTab?.sql).toBe(sourceSql); expect(originalTab?.connectionId).toBe(profile.id); expect(originalTab?.databaseContext).toEqual({ state: 'known', database }); await step(() => expect.poll(ids).toEqual(viewRows.map(row => row.source_id))); await step(() => expect(tab.getByRole('list', { name: sortText.priorities, exact: true }).getByRole('listitem')).toHaveCount(2)); await step(() => expect(tab.locator('.query-result-filter-bar')).toContainText(filterText.counts(5, 4))); await step(() => expect(tab.locator('.tab-status .warning-text')).toHaveCount(0)); const currentAudit = await state(); expect(currentAudit.queries).toBe(1); expect(currentAudit.counts['query.transaction'] ?? 0).toBe(0); expect(currentAudit.rows).toEqual(sourceRows); };
    await step(() => identity.assertCurrent()); await openDialog(false); await step(() => expect(dialog.getByText(text.sample(4, 4), { exact: true })).toBeVisible()); await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect.poll(async () => (await state()).releases).toBe(1)); expect((await state()).applies).toBe(0); expect(await readObserver('rows')).toEqual([]); await assertParent();
    for (const row of [2, 5]) await step(() => grid.locator('[role="row"][aria-rowindex="' + row + '"]').getByRole('checkbox').check()); await openDialog(true); await step(() => expect(dialog.getByText(text.sample(2, 2), { exact: true })).toBeVisible());
    await step(() => dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(database + '.target')); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => dialog.getByRole('checkbox', { name: text.acknowledge, exact: true }).check()); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeEnabled());
    const screenshotName = '结果追加写入-准确两行确认.png', screenshotPath = join(output, screenshotName); expect(sync.existsSync(screenshotPath)).toBe(false); outputNames.add(screenshotName); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotHash = hash(await step(() => fs.readFile(screenshotPath))); await step(() => info.attach('结果追加写入准确目标与两行确认', { path: screenshotPath, contentType: 'image/png' }));
    await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(dialog.getByText(text.committed(2), { exact: true })).toBeVisible()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
    const expectedTarget = selectedRows.map(row => ({ id: row.source_id, amount: row.source_amount, payloadHex: Buffer.from(row.source_payload.base64, 'base64').toString('hex').toUpperCase(), note: row.source_note })); expect(await readObserver('rows')).toEqual(expectedTarget);
    await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await assertParent();
    const final = await state(); expect({ queries: final.queries, forbidden: final.forbidden, pending: final.pending, sessionsOpened: final.sessionsOpened, applies: final.applies, releases: final.releases }).toEqual({ queries: 1, forbidden: 0, pending: 0, sessionsOpened: 1, applies: 1, releases: 1 }); expect(final.committed).toMatchObject({ rows: 2, outcome: 'committed', commitAcknowledged: true }); expect(final.previews.map(preview => preview.rows)).toEqual([4, 2]); expect(pageErrors).toEqual([]);
    await step(() => page.locator('.tab-strip').getByRole('button', { name: formatText(zh.app.text012, queryTab.title), exact: true }).click()); const closing = page.getByRole('dialog', { name: queryCloseZh.title, exact: true }); await step(() => expect(closing).toBeVisible()); await step(() => closing.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(closing).toBeHidden()); await step(() => expect.poll(async () => (await settings()).tabs.some(item => item.id === queryTab.id)).toBe(false));
    await step(() => identity.assertCurrent()); await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent());
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(expectedTarget); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true);
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('结果写入已有表正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.result-insert-ui', database, targetTable: 'target', sourceRows: 5, filteredSortedRows: 4, cancelledPreviewRows: 4, cancelledPreviewApplyCalls: 0, cancelledPreviewTargetRows: 0, insertedRows: 2, selectedIds: selectedRows.map(row => row.source_id), exactIntegerDecimalNullBlobVerified: true, sourceQueryExecutions: final.queries, sourceQueryReplayed: false, parentSqlResultsTransactionPreserved: true, realTargetConfirmation: true, commitAcknowledged: true, audit: final, mainIpcAuditScope: '原窗口dbark:request原handler透传；准确常量源SQL一次、typed完整快照两轮、准确目标与原一次性预览token一次apply，未声称底层全部SQL逐条审计', normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, originalOwnerVerifiedBeforeAndAfter: true, databaseRetainedForRoot: true, sourceManifest: values.DBARK_RESULT_INSERT_UI_MANIFEST_SHA256, sourceVerifiedBeforeAndAfter: true, screenshot: { path: screenshotPath, sha256: screenshotHash }, nativeConfirmationInputVerified: false, systemClipboard: 0, systemFileDialog: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
