import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors, dialogCalls } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { csvImportHeaderZh as text } from '../../src/renderer/locales/csvImportHeader.zh-CN';
import { csvHeaderUiFixture, installCsvHeaderUiFileChoice, readCsvHeaderUiFileChoice } from '../helpers/csvHeaderUi';

type Environment = ReturnType<typeof import('../helpers/csvHeaderUi').bindCsvHeaderUiEnvironment>;
interface Audit {
  imports: number; forbidden: number; pending: number; choices: number; fileToken?: string;
  counts: Record<string, number>; previews: { hasHeader: boolean; columns: string[]; values: unknown[][] }[]; imported?: { rows: number; errors: string[] };
}

/** 只消费Root预置随机库和唯一CSV；文件选择由真实Main签发令牌，观察连接固定只读。 */
export function registerCsvHeaderUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_CSV_HEADER_UI_OUTPUT), outputStat = sync.lstatSync(output);
  const plan = csvHeaderUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_CSV_HEADER_UI_OWNER), csvPath = resolve(values.DBARK_CSV_HEADER_UI_CSV), csvStat = sync.lstatSync(csvPath);
  if (!csvStat.isFile() || csvStat.isSymbolicLink() || sync.realpathSync(csvPath) !== csvPath || hash(sync.readFileSync(csvPath)) !== values.DBARK_CSV_HEADER_UI_CSV_SHA256 || sync.readFileSync(csvPath, 'utf8') !== plan.csvText) throw Error('无标题CSV必须是Root批准的唯一合成文件原字节');
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('无标题CSV导入需要原已存在空的独占输出目录');
  const outputNames = new Set<string>();
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output), file = sync.lstatSync(csvPath);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !outputNames.has(name))) throw Error('无标题CSV导入配置或输出目录身份变化');
    if (!file.isFile() || file.isSymbolicLink() || file.dev !== csvStat.dev || file.ino !== csvStat.ino || sync.realpathSync(csvPath) !== csvPath || hash(sync.readFileSync(csvPath)) !== values.DBARK_CSV_HEADER_UI_CSV_SHA256) throw Error('无标题CSV原文件身份或字节变化');
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ csvHeaderSource: { clock: Clock; identity: Identity; check(): void } }>({
    csvHeaderSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('无标题CSV导入必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_CSV_HEADER_UI_MANIFEST, values.DBARK_CSV_HEADER_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('无标题CSV导入只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ csvHeaderSource }, use) => { await use({ assertCurrent: csvHeaderSource.check, assertPreparation(info) { if (clocks.get(info) !== csvHeaderSource.clock) throw Error('无标题CSV导入原启动归属变化'); csvHeaderSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('无标题CSV导入原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式CSV默认标题预览、位置映射及首条数据完整导入', async ({ csvHeaderSource, trace, screenshot, video }, info) => {
    const { clock, identity } = csvHeaderSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      csvHeaderSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('无标题CSV导入原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('无标题CSV导入原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('无标题CSV导入原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE;
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`',
      rows: 'SELECT CAST(`第1列` AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(nullable_note) AS nullableHex,HEX(literal_slash) AS slashHex FROM ' + plan.qualified + ' ORDER BY `第1列` DESC',
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 固定SQL只读白名单，原callback及原Query end均到达才能消费下一条。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('无标题CSV原观察命令归属或前序终态失效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('无标题CSV观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const actual = await readObserver('identity'); expect(actual).toHaveLength(1); expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_CSV_HEADER_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    for (const path of [output, csvPath]) { const inside = relative(profileDirectory, path); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('无标题CSV输出与输入不得位于原profile内'); }
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('无标题CSV原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('无标题CSV原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual([]);
    await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '无标题CSV导入本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** Main只透传正式文件能力、四轮首行切换预览和准确位置映射的一次导入。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (root.__csvHeaderUi || typeof originalHandler !== 'function') throw Error('无标题CSV原Main审计归属未知');
      const state = { imports: 0, forbidden: 0, pending: 0, choices: 0, fileToken: undefined as string | undefined, counts: {} as Record<string, number>, previews: [] as any[], imported: undefined as unknown }; root.__csvHeaderUi = state;
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('无标题CSV原Main或窗口变化');
        const command = payload.command, value = payload.input; state.counts[command] = (state.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || command.startsWith('query.execute') || ['table.apply', 'table.preview', 'files.export', 'result.insertApply', 'result.insertPreview'].includes(command)) { state.forbidden++; throw Error('无标题CSV禁止额外产品写入和源查询'); }
        if (['metadata.objects', 'metadata.table', 'table.page'].includes(command) && (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== undefined && value.table !== 'target')) throw Error('无标题CSV目录或表页目标变化');
        if (command === 'files.choose' && (++state.choices !== 1 || value.purpose !== 'import' || value.format !== 'csv' || value.suggestedName !== 'target.csv')) throw Error('无标题CSV只准本例一次正式文件选择');
        let preview: any;
        if (command === 'files.preview') {
          const sequence = [true, false, true, false];
          if (state.previews.length >= sequence.length || !state.fileToken || value.fileToken !== state.fileToken || value.format !== 'csv' || value.encoding !== 'utf8' || value.csvDelimiter !== ',' || (sequence[state.previews.length] ? Object.hasOwn(value, 'csvHasHeader') : value.csvHasHeader !== false || !Object.hasOwn(value, 'csvHasHeader'))) throw Error('无标题CSV预览令牌、首行配置或原顺序变化');
          preview = { hasHeader: sequence[state.previews.length], columns: [], values: [] }; state.previews.push(preview);
        }
        if (command === 'files.import') {
          if (++state.imports !== 1 || state.previews.length !== 4 || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'target' || value.fileToken !== state.fileToken || value.format !== 'csv' || value.encoding !== 'utf8' || value.csvDelimiter !== ',' || value.csvHasHeader !== false || JSON.stringify(value.mapping) !== JSON.stringify(input.mapping)) throw Error('无标题CSV仅允许准确目标、原能力及完整位置映射导入一次');
        }
        state.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'files.choose') { if (!reply?.ok || !reply.result || typeof reply.result.token !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reply.result.token) || reply.result.name !== input.fileName) throw Error('无标题CSV真实Main文件令牌回执无效'); state.fileToken = reply.result.token; }
          if (command === 'files.preview') {
            const columns = preview.hasHeader ? input.headerColumns : input.positionalColumns, expectedRows = preview.hasHeader ? input.decoded.slice(1) : input.decoded;
            if (!reply?.ok || JSON.stringify(reply.result?.columns) !== JSON.stringify(columns) || reply.result.rows?.length !== expectedRows.length) throw Error('无标题CSV正式预览列或首条数据数量失配');
            preview.columns = [...reply.result.columns]; preview.values = reply.result.rows.map((row: any) => columns.map((column: string) => { if (!Object.hasOwn(row, column)) throw Error('无标题CSV正式预览字段缺失'); return row[column]; })); if (JSON.stringify(preview.values) !== JSON.stringify(expectedRows)) throw Error('无标题CSV正式预览完整原文或NULL失配');
          }
          if (command === 'files.import') { if (!reply?.ok || reply.result?.rows !== 2 || !Array.isArray(reply.result.errors) || reply.result.errors.length) throw Error('无标题CSV真实导入未完整成功两行'); state.imported = structuredClone(reply.result); }
          return reply;
        } finally { state.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__csvHeaderUiHandler = wrapped;
    }, { connectionId: profile.id, database, senderId, fileName: basename(csvPath), headerColumns: plan.headerColumns, positionalColumns: plan.positionalColumns, decoded: plan.decoded, mapping: Object.fromEntries(plan.positionalColumns.map((column, index) => [column, plan.targetColumns[index]])) }));
    const state = () => step(() => application.evaluate(({ ipcMain }) => { const root = globalThis as any; if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__csvHeaderUiHandler) throw Error('无标题CSV原Main审计已变化'); return structuredClone(root.__csvHeaderUi) as Audit; }));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').getByRole('button', { name: 'target', exact: true }).click());
    const table = page.locator('.table-tab:visible'); await step(() => expect(table.getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => table.getByRole('button', { name: zh.common.import, exact: true }).click());
    const dialog = page.getByRole('dialog', { name: zh.transfer.text004 + ' · ' + database + '.target', exact: true }), header = dialog.getByRole('checkbox', { name: text.label, exact: true }), sample = dialog.locator('.sample-grid').getByRole('grid'), start = dialog.getByRole('button', { name: zh.transfer.text028, exact: true });
    await step(() => expect(header).toBeChecked()); await step(() => expect(start).toBeDisabled());
    await step(() => application.evaluate(installCsvHeaderUiFileChoice, { owner: values.DBARK_CSV_HEADER_UI_OWNER, senderId, path: csvPath })); await step(() => dialog.locator('button.file-picker').click());
    await step(() => expect.poll(async () => (await state()).previews.length).toBe(1)); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '2')); expect((await state()).previews[0].values).toHaveLength(1); expect((await state()).previews[0].values[0][0]).toBe('18446744073709551614');
    const picker = await step(() => application.evaluate(readCsvHeaderUiFileChoice, values.DBARK_CSV_HEADER_UI_OWNER)); expect(picker.path).toBe(csvPath); expect((await state()).imports).toBe(0); expect(await readObserver('rows')).toEqual([]);
    /** 等待原预览真实回包及新位置映射，不能把旧header或旧样本当作新状态。 */
    const assertPositional = async (count: number) => { await step(() => expect.poll(async () => (await state()).previews.length).toBe(count)); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '3')); await step(() => expect(sample.getByRole('gridcell').filter({ hasText: /^18446744073709551615$/ })).toBeVisible()); for (const column of plan.positionalColumns) await step(() => expect(dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true })).toHaveValue('')); await step(() => expect(header).not.toBeChecked()); };
    await step(() => header.uncheck()); await assertPositional(2); await step(() => start.click()); await step(() => expect(dialog.getByText(zh.transfer.text001, { exact: true })).toBeVisible()); expect((await state()).imports).toBe(0); expect(await readObserver('rows')).toEqual([]);
    // 手动映射之后切回header再恢复，必须重新明确全部位置映射，不能复活旧同名映射。
    await step(() => dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, '第1列'), exact: true }).selectOption('第1列')); await step(() => header.check()); await step(() => expect.poll(async () => (await state()).previews.length).toBe(3)); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '2')); await step(() => header.uncheck()); await assertPositional(4);
    for (const [index, column] of plan.positionalColumns.entries()) await step(() => dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true }).selectOption(plan.targetColumns[index]));
    const screenshotName = '无标题CSV-首条数据与手动映射.png', screenshotPath = join(output, screenshotName); expect(sync.existsSync(screenshotPath)).toBe(false); outputNames.add(screenshotName); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotHash = hash(await step(() => fs.readFile(screenshotPath))); await step(() => info.attach('无标题CSV首条数据与手动映射', { path: screenshotPath, contentType: 'image/png' }));
    await step(() => start.click()); await step(() => expect(dialog.locator('.success-box')).toContainText(zh.transfer.text023 + zh.common.import + ' 2' + zh.transfer.text024)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(start).toBeDisabled());
    const toHex = (value: string) => Buffer.from(value, 'utf8').toString('hex').toUpperCase(), expectedRows = plan.decoded.map(row => ({ id: row[0], amount: row[1], payloadHex: row[2] === 'base64:AP8=' ? '00FF' : '', noteHex: toHex(row[3]), nullableHex: row[4] === null ? null : toHex(row[4]), slashHex: toHex(row[5]) })); expect(await readObserver('rows')).toEqual(expectedRows);
    await step(() => dialog.getByRole('button', { name: zh.common.done, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); const final = await state(); expect({ imports: final.imports, forbidden: final.forbidden, pending: final.pending, choices: final.choices }).toEqual({ imports: 1, forbidden: 0, pending: 0, choices: 1 }); expect(final.previews.map(preview => preview.hasHeader)).toEqual([true, false, true, false]); expect(final.imported).toEqual({ rows: 2, errors: [] }); expect(pageErrors).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'files.import')).toHaveLength(1); expect(tasks.every(task => task.status === 'completed')).toBe(true); await step(() => identity.assertCurrent());
    await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent()); await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(expectedRows); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true);
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('无标题CSV导入正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.csv-header-ui', database, table: 'target', defaultHasHeader: true, defaultPreviewRows: 1, noHeaderPreviewRows: 2, firstRecordPreserved: true, positionalMappingInitiallyEmpty: true, sameNamedPositionNotAutomatic: true, missingMappingImportCalls: 0, headerAbaMappingReset: true, importedRows: 2, exactBigintDecimalNullBlobCrlfBackslashVerified: true, audit: final, normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, originalOwnerVerifiedBeforeAndAfter: true, databaseRetainedForRoot: true, sourceManifest: values.DBARK_CSV_HEADER_UI_MANIFEST_SHA256, sourceVerifiedBeforeAndAfter: true, sourceCsv: { path: csvPath, sha256: values.DBARK_CSV_HEADER_UI_CSV_SHA256, unchanged: true }, screenshot: { path: screenshotPath, sha256: screenshotHash }, picker, mainIpcAuditScope: '原窗口原Main透传；真实files.choose令牌、准确四轮header配置与完整预览、准确目标及完整位置映射一次files.import；未声称底层SQL逐条审计', systemClipboard: 0, systemFileDialogInput: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
