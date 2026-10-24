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
import { binaryCellFilesZh as text } from '../../src/renderer/locales/binaryCellFiles.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { binaryCellZh as binaryText } from '../../src/renderer/locales/binaryCell.zh-CN';
import { queryCloseZh } from '../../src/renderer/locales/queryClose.zh-CN';
import { binaryCellFilesUiFixture, installBinaryCellFilesUiChoice, readBinaryCellFilesUiChoices } from '../helpers/binaryCellFilesUi';

type Environment = ReturnType<typeof import('../helpers/binaryCellFilesUi').bindBinaryCellFilesUiEnvironment>;
interface Audit { opens: number; saves: number; previews: number; applies: number; queries: number; pending: number; forbidden: number; counts: Record<string, number>; replies: any[]; }

/** 原Main读取完整文件，真实缓冲暂存与明确提交后独立读回；失败不清理或重放。 */
export function registerBinaryCellFilesUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_BINARY_CELL_FILES_UI_OUTPUT), outputStat = sync.lstatSync(output);
  const plan = binaryCellFilesUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_BINARY_CELL_FILES_UI_OWNER);
  const sourceFiles = (['full', 'empty'] as const).map(kind => {
    const path = resolve(values[kind === 'full' ? 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL' : 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY']), stat = sync.lstatSync(path), sha256 = values[kind === 'full' ? 'DBARK_BINARY_CELL_FILES_UI_INPUT_FULL_SHA256' : 'DBARK_BINARY_CELL_FILES_UI_INPUT_EMPTY_SHA256'];
    if (!stat.isFile() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || hash(sync.readFileSync(path)) !== sha256 || !sync.readFileSync(path).equals(plan.inputs[kind].bytes)) throw Error('二进制单元格必须使用Root批准的两份准确原字节合成文件');
    return { kind, path, stat, sha256 };
  });
  if (new Set(sourceFiles.map(file => file.path)).size !== 2) throw Error('二进制单元格两份源文件不得复用路径');
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('二进制单元格文件需要原已存在空的独占输出目录');
  const outputNames = new Set<string>(); let activeSaveName: string | undefined;
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    // 仅原另存进行期间允许该准确目标的AtomicFile暂存名；原回执后立即撤销，残留即失败保留。
    const allowed = (name: string) => outputNames.has(name) || activeSaveName !== undefined && name.startsWith(activeSaveName + '.dbark-') && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/i.test(name.slice((activeSaveName + '.dbark-').length));
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !allowed(name))) throw Error('二进制单元格文件配置或输出目录身份变化');
    for (const source of sourceFiles) { const file = sync.lstatSync(source.path); if (!file.isFile() || file.isSymbolicLink() || file.dev !== source.stat.dev || file.ino !== source.stat.ino || sync.realpathSync(source.path) !== source.path || hash(sync.readFileSync(source.path)) !== source.sha256) throw Error('二进制单元格文件原源文件身份或字节变化'); }
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ binaryCellFilesSource: { clock: Clock; identity: Identity; check(): void } }>({
    binaryCellFilesSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('二进制单元格文件必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_BINARY_CELL_FILES_UI_MANIFEST, values.DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('二进制单元格文件只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ binaryCellFilesSource }, use) => { await use({ assertCurrent: binaryCellFilesSource.check, assertPreparation(info) { if (clocks.get(info) !== binaryCellFilesSource.clock) throw Error('二进制单元格文件原启动归属变化'); binaryCellFilesSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('二进制单元格文件原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式二进制文件载入缓冲、原字节另存和空文件提交', async ({ binaryCellFilesSource, trace, screenshot, video }, info) => {
    const { clock, identity } = binaryCellFilesSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      binaryCellFilesSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('二进制单元格文件原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('二进制单元格文件原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('二进制单元格文件原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE;
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`', rows: plan.rowSql,
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 原callback和原Query end均结束后才消费结果；不使用第二条连接补出成功终态。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('二进制单元格原观察命令归属或前序终态失效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('二进制单元格观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const actual = await readObserver('identity'); expect(actual).toHaveLength(1); expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_BINARY_CELL_FILES_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    for (const path of [output, ...sourceFiles.map(file => file.path)]) { const inside = relative(profileDirectory, path); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('二进制单元格输入输出不得位于原profile内'); }
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('二进制单元格原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('二进制单元格原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(plan.before);
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '二进制单元格文件本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** 原Main handler真实透传；写入只能来自本例两次原表草稿确认，不容许文件API绕过表页提交。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (root.__binaryCellFilesUi || typeof originalHandler !== 'function') throw Error('二进制单元格原Main审计归属未知');
      const audit = { opens: 0, saves: 0, previews: 0, applies: 0, queries: 0, pending: 0, forbidden: 0, counts: {} as Record<string, number>, replies: [] as any[] }; root.__binaryCellFilesUi = audit; let querySession: string | undefined;
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('二进制单元格原Main或窗口变化');
        const command = payload.command, value = payload.input; audit.counts[command] = (audit.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || command.startsWith('result.insert') || command.startsWith('files.') || command.startsWith('excel.') || ['query.executeParameterized', 'query.exportStream', 'query.transaction'].includes(command)) { audit.forbidden++; throw Error('二进制单元格禁止其它写入或通用文件流程'); }
        if (['metadata.objects', 'metadata.table', 'table.page', 'table.preview', 'table.apply'].includes(command) && (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== undefined && value.table !== 'subject')) throw Error('二进制单元格目标变化');
        let index: number | undefined;
        if (command === 'binaryCellFiles.open') { index = audit.opens++; if (index >= 3 || Object.keys(value).length !== 0) throw Error('二进制单元格仅准三次正式载入选择'); }
        if (command === 'binaryCellFiles.save') { index = audit.saves++; if (index >= 2 || Object.keys(value).sort().join() !== 'base64,suggestedName' || value.suggestedName !== 'binary-cell.bin' || value.base64 !== input.saveBase64[index]) throw Error('二进制单元格仅准两次完整原字节另存'); }
        if (command === 'table.preview' || command === 'table.apply') {
          const stage = command === 'table.preview' ? (audit.previews < 2 ? 0 : 1) : audit.applies;
          if (command === 'table.preview') audit.previews++; else audit.applies++;
          const change = value.changes?.[0], expected = input.before[stage], expectedBase64 = stage === 0 ? input.fullBase64 : '';
          if (stage > 1 || value.changes?.length !== 1 || change.kind !== 'update' || String(change.before?.id) !== expected.id || change.before.note !== expected.note || JSON.stringify(change.before.payload) !== JSON.stringify(stage === 0 ? null : { type: 'binary', base64: 'fwE=' }) || JSON.stringify(change.values) !== JSON.stringify({ payload: { type: 'binary', base64: expectedBase64 } })) throw Error('二进制单元格原草稿、原值或精确目标变化');
        }
        if (command === 'sessions.open' && (querySession !== undefined || value.connectionId !== input.connectionId || value.database !== input.database)) throw Error('二进制单元格SQL原会话连接或数据库变化');
        if (command === 'query.execute') { if (audit.queries++ !== 0 || !querySession || value.sessionId !== querySession || value.sql !== input.resultSql || value.parameters !== undefined) throw Error('二进制单元格只准原会话明确执行一次固定单条SELECT'); }
        audit.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'sessions.open') { if (!reply?.ok || typeof reply.result?.sessionId !== 'string' || !reply.result.sessionId) throw Error('二进制单元格原查询会话未确认'); querySession = reply.result.sessionId; }
          if (['binaryCellFiles.open', 'binaryCellFiles.save', 'table.preview', 'table.apply', 'query.execute'].includes(command)) {
            if (!reply?.ok) throw Error('二进制单元格正式Main回执失败');
            if (command === 'binaryCellFiles.open') {
              const expected = input.open[index!];
              if (expected === null ? reply.result !== null : !reply.result || Object.keys(reply.result).sort().join() !== 'base64,bytes,name' || reply.result.base64 !== expected.base64 || reply.result.bytes !== expected.bytes || reply.result.name !== expected.name) throw Error('二进制单元格正式文件完整原字节回执失配');
            }
            if (command === 'binaryCellFiles.save' && (reply.result?.bytes !== input.saveBytes[index!] || reply.result.name !== input.saveNames[index!] || Object.keys(reply.result).some(key => !['bytes', 'name'].includes(key)))) throw Error('二进制单元格正式另存回执失配');
            if (command === 'table.apply' && reply.result?.affectedRows !== 1) throw Error('二进制单元格原确认未精确更新一行');
            if (command === 'query.execute') { const results = reply.result?.results; if (results?.length !== 1 || results[0].rows?.length !== 1 || results[0].columns?.length !== 1 || JSON.stringify(Object.values(results[0].rows[0])) !== JSON.stringify([{ type: 'binary', base64: input.fullBase64 }])) throw Error('二进制单元格原单次SELECT未返回完整字节'); }
            audit.replies.push({ command, index, result: structuredClone(reply.result) });
          }
          return reply;
        } finally { audit.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__binaryCellFilesUiHandler = wrapped;
    }, { senderId, connectionId: profile.id, database, before: plan.before, fullBase64: plan.inputs.full.bytes.toString('base64'), resultSql: plan.resultSql, saveBase64: ['fwE=', plan.inputs.full.bytes.toString('base64')], saveBytes: [2, 13], saveNames: [plan.outputs.table.fileName, plan.outputs.query.fileName], open: [{ base64: plan.inputs.full.bytes.toString('base64'), bytes: 13, name: basename(sourceFiles[0].path) }, null, { base64: '', bytes: 0, name: basename(sourceFiles[1].path) }] }));
    const state = () => step(() => application.evaluate(({ ipcMain }) => { const root = globalThis as any; if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__binaryCellFilesUiHandler) throw Error('二进制单元格原Main审计变化'); return structuredClone(root.__binaryCellFilesUi) as Audit; }));
    const choices = [{ kind: 'save' as const, path: join(output, plan.outputs.table.fileName) }, { kind: 'open' as const, path: sourceFiles[0].path }, { kind: 'open' as const }, { kind: 'open' as const, path: sourceFiles[1].path }, { kind: 'save' as const, path: join(output, plan.outputs.query.fileName) }];
    const choose = (index: number) => step(() => application.evaluate(installBinaryCellFilesUiChoice, { owner: values.DBARK_BINARY_CELL_FILES_UI_OWNER, senderId, choices, index }));
    const chosen = (count: number) => step(() => application.evaluate(readBinaryCellFilesUiChoices, { owner: values.DBARK_BINARY_CELL_FILES_UI_OWNER, count }));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click());
    const table = page.locator('.table-tab:visible'), grid = table.getByRole('grid'), form = table.getByRole('complementary', { name: recordText.title, exact: true }), field = form.getByRole('region', { name: 'payload', exact: true }); await step(() => expect(grid).toHaveAttribute('aria-rowcount', '4'));
    /** 通过实际网格选择和原表单展开字段，绝不调用记录控制器或onHexChange。 */
    const editRow = async (id: number) => {
      const row = grid.getByRole('row').filter({ has: page.getByRole('gridcell', { name: String(id), exact: true }) }); await step(() => expect(row).toHaveCount(1)); await step(() => row.locator('[role="gridcell"][aria-colindex="3"]').click());
      if (!await step(() => form.isVisible())) await step(() => table.getByRole('button', { name: recordText.title, exact: true }).click()); await step(() => expect(form).toBeVisible());
      if (await step(() => field.getByRole('button', { name: recordText.editField, exact: true }).isVisible())) await step(() => field.getByRole('button', { name: recordText.editField, exact: true }).click());
      await step(() => expect(field.getByRole('combobox', { name: recordText.mode, exact: true })).toBeVisible());
    };
    const hex = () => field.getByRole('textbox', { name: 'payload · ' + recordText.value, exact: true });
    const hexValue = () => step(async () => (await hex().inputValue()).replace(/\s/g, '').replace(/^0x/i, '').toUpperCase());
    const savedFiles: { path: string; sha256: string; bytes: number }[] = [], screenshots: { path: string; sha256: string }[] = [];
    /** 另存必须完整原字节相同；路径只来自Root批准的一次性API回答。 */
    const assertSaved = async (kind: 'table' | 'query') => { const target = plan.outputs[kind], path = join(output, target.fileName), stat = await step(() => fs.lstat(path)); expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(path))).toBe(path); const bytes = await step(() => fs.readFile(path)); expect(bytes.toString('hex').toUpperCase()).toBe(target.hex); savedFiles.push({ path, sha256: hash(bytes), bytes: bytes.length }); };
    const capture = async (name: string) => { const path = join(output, name); expect(sync.existsSync(path)).toBe(false); outputNames.add(name); await step(() => page.screenshot({ path })); const sha256 = hash(await step(() => fs.readFile(path))); screenshots.push({ path, sha256 }); await step(() => info.attach(name, { path, contentType: 'image/png' })); };
    await editRow(2); expect(await hexValue()).toBe('7F01'); outputNames.add(plan.outputs.table.fileName); activeSaveName = plan.outputs.table.fileName; await choose(0); await step(() => field.getByRole('button', { name: text.save, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saves).toBe(1)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await chosen(1); activeSaveName = undefined; check(); await assertSaved('table'); expect(await hexValue()).toBe('7F01'); expect(await readObserver('rows')).toEqual(plan.before); await step(() => form.getByRole('button', { name: recordText.close, exact: true }).click());
    await editRow(1); await step(() => field.getByRole('combobox', { name: recordText.mode, exact: true }).selectOption('binary')); await choose(1); await step(() => field.getByRole('button', { name: text.load, exact: true }).click()); await step(() => expect.poll(hexValue).toBe(plan.fullHex)); await chosen(2);
    const beforeCancel = await hexValue(); await choose(2); await step(() => field.getByRole('button', { name: text.load, exact: true }).click()); await step(() => expect.poll(async () => (await state()).opens).toBe(2)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await chosen(3); expect(await hexValue()).toBe(beforeCancel); expect(await readObserver('rows')).toEqual(plan.before); expect((await state()).applies).toBe(0); await step(() => expect(form.getByRole('button', { name: recordText.stage, exact: true })).toBeEnabled()); await capture('二进制文件-完整缓冲取消保持.png');
    await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByRole('button', { name: recordText.stage, exact: true })).toBeDisabled()); expect(await readObserver('rows')).toEqual(plan.before);
    const preview = page.getByRole('dialog', { name: zh.table.text031, exact: true });
    /** 每次执行仍须原表页SQL预览和真实确认；首轮取消预览不得产生DML。 */
    const openPreview = async () => { await step(() => table.locator('.table-action-bar').getByRole('button', { name: zh.table.text019, exact: true }).click()); await step(() => expect(preview).toBeVisible()); await step(() => expect(preview.locator('.monaco-editor')).toContainText('UPDATE')); await step(() => expect(preview.locator('.monaco-editor')).toContainText('subject')); await step(() => expect(preview.getByRole('button', { name: zh.common.confirmApply, exact: true })).toBeEnabled()); };
    await openPreview(); expect((await state()).applies).toBe(0); expect(await readObserver('rows')).toEqual(plan.before); await step(() => preview.getByRole('button', { name: zh.common.backToEdit, exact: true }).click()); await step(() => expect(preview).toBeHidden()); expect((await state()).applies).toBe(0);
    await openPreview(); await step(() => preview.getByRole('button', { name: zh.common.confirmApply, exact: true }).click()); await step(() => expect(preview).toBeHidden()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); expect(await readObserver('rows')).toEqual(plan.afterFirst);
    await editRow(2); await choose(3); await step(() => field.getByRole('button', { name: text.load, exact: true }).click()); await step(() => expect.poll(hexValue).toBe('')); await chosen(4); await step(() => expect(field.getByRole('combobox', { name: recordText.mode, exact: true })).toHaveValue('binary')); expect(await readObserver('rows')).toEqual(plan.afterFirst); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await openPreview(); await step(() => preview.getByRole('button', { name: zh.common.confirmApply, exact: true }).click()); await step(() => expect(preview).toBeHidden()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); expect(await readObserver('rows')).toEqual(plan.after);
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newQuery, exact: true }).click()); const newQuery = page.getByRole('dialog', { name: zh.common.newQuery, exact: true }); await step(() => newQuery.getByRole('combobox', { name: new RegExp('^' + zh.app.text049) }).selectOption(profile.id)); await step(() => newQuery.getByLabel(zh.app.text050, { exact: true }).fill(database)); await step(() => newQuery.getByRole('button', { name: zh.app.text053, exact: true }).click()); await step(() => expect(newQuery).toBeHidden());
    const queryTab = page.locator('.query-tab:visible'); await step(() => queryTab.locator('.monaco-editor').getByRole('textbox').focus()); await step(() => page.keyboard.press('Control+A')); await step(() => page.keyboard.insertText(plan.resultSql));
    const settings = () => step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); await step(() => expect.poll(async () => { const value = await settings(); return value.tabs.find(item => item.id === value.activeTabId)?.sql; }).toBe(plan.resultSql)); const tabs = await settings(), queryIdentity = tabs.tabs.find(item => item.id === tabs.activeTabId)!;
    expect((await state()).queries).toBe(0); await step(() => queryTab.getByRole('button', { name: zh.query.text011, exact: true }).click()); await step(() => expect.poll(async () => (await state()).queries).toBe(1)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); const resultGrid = queryTab.locator('.result-body').getByRole('grid'); await step(() => expect(resultGrid).toHaveAttribute('aria-rowcount', '2')); await step(() => resultGrid.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]').dblclick());
    const binary = page.getByRole('dialog', { name: binaryText.title + '：payload', exact: true }); await step(() => expect(binary).toBeVisible()); await step(() => expect(binary.getByRole('button', { name: text.load, exact: true })).toHaveCount(0)); outputNames.add(plan.outputs.query.fileName); activeSaveName = plan.outputs.query.fileName; await choose(4); await step(() => binary.getByRole('button', { name: text.save, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saves).toBe(2)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); const picker = await chosen(5); activeSaveName = undefined; check(); await assertSaved('query'); await capture('二进制文件-SQL结果只读原字节另存.png');
    await step(() => binary.getByRole('button', { name: zh.dialogs.text001, exact: true }).click()); await step(() => expect(binary).toBeHidden());
    const final = await state(); expect({ opens: final.opens, saves: final.saves, previews: final.previews, applies: final.applies, queries: final.queries, pending: final.pending, forbidden: final.forbidden }).toEqual({ opens: 3, saves: 2, previews: 3, applies: 2, queries: 1, pending: 0, forbidden: 0 }); expect(pageErrors).toEqual([]);
    await step(() => page.locator('.tab-strip').getByRole('button', { name: formatText(zh.app.text012, queryIdentity.title), exact: true }).click()); const closing = page.getByRole('dialog', { name: queryCloseZh.title, exact: true }); await step(() => expect(closing).toBeVisible()); await step(() => closing.getByRole('button', { name: queryCloseZh.discard, exact: true }).click()); await step(() => expect(closing).toBeHidden()); await step(() => expect.poll(async () => (await settings()).tabs.some(item => item.id === queryIdentity.id)).toBe(false));
    await step(() => identity.assertCurrent()); await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent()); await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(plan.after); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true);
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    for (const saved of savedFiles) expect(hash(await step(() => fs.readFile(saved.path)))).toBe(saved.sha256);
    await step(() => info.attach('二进制单元格文件正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.binary-cell-files-ui', database, loadBufferOnlyBeforeStaging: true, stagingAndPreviewDidNotWrite: true, previewCancelledWithoutWrite: true, cancelledOpenPreservedBuffer: true, emptyFileIsZeroBytesNotNull: true, originalThirdRowPreserved: true, queryResultReadOnlyLoadAbsent: true, fullRawBytesVerified: true, audit: final, savedFiles, screenshots, picker, normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, sourceManifest: values.DBARK_BINARY_CELL_FILES_UI_MANIFEST_SHA256, sourceFiles: sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })), mainIpcAuditScope: '原窗口原handler透传；专用载入与原字节另存、原表页预览及两次明确单行更新；单条固定SELECT执行一次，无其它写入', systemClipboard: 0, systemFileDialogInput: 0, nativeInputVerified: false, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}
