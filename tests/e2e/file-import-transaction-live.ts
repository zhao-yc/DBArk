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
import { fileImportTransactionZh as text } from '../../src/renderer/locales/fileImportTransaction.zh-CN';
import { fileImportTransactionUiFixture, installFileImportTransactionUiChoice, readFileImportTransactionUiChoices } from '../helpers/fileImportTransactionUi';

type Environment = ReturnType<typeof import('../helpers/fileImportTransactionUi').bindFileImportTransactionUiEnvironment>;
interface Audit {
  imports: number; forbidden: number; pending: number; choices: number; tokens: string[]; counts: Record<string, number>;
  previews: { file: number; rows?: number }[]; results: { table: string; mode: string; rows: number; errors: string[] }[];
}

/** 每份文件向指定目标明确导入一次；前后独立实读，失败不重放，不在测试内清理已提交批次。 */
export function registerFileImportTransactionUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_FILE_IMPORT_TRANSACTION_UI_OUTPUT), outputStat = sync.lstatSync(output);
  const plan = fileImportTransactionUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER);
  const sourceFiles = ([['atomicBad', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_ATOMIC_BAD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_ATOMIC_BAD_SHA256'], ['batchBad', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_BATCH_BAD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_BATCH_BAD_SHA256'], ['good', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_GOOD', 'DBARK_FILE_IMPORT_TRANSACTION_UI_CSV_GOOD_SHA256']] as const).map(([kind, pathKey, hashKey]) => {
    const path = resolve(values[pathKey]), stat = sync.lstatSync(path), sha256 = values[hashKey], expected = Buffer.from(plan.files[kind].text, 'utf8');
    if (!stat.isFile() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || hash(sync.readFileSync(path)) !== sha256 || !sync.readFileSync(path).equals(expected)) throw Error('文件导入事务必须使用Root批准的三份准确UTF8合成文件');
    return { kind, path, stat, sha256 };
  });
  if (new Set(sourceFiles.map(file => file.path)).size !== 3) throw Error('文件导入事务三份源文件不得复用路径');
  if (sourceFiles[0].sha256 !== sourceFiles[1].sha256) throw Error('原子与分批坏文件必须逐字节完全相同');
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('文件导入事务需要原已存在空的独占输出目录');
  const outputNames = new Set<string>();
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !outputNames.has(name))) throw Error('文件导入事务配置或输出目录身份变化');
    for (const source of sourceFiles) { const file = sync.lstatSync(source.path); if (!file.isFile() || file.isSymbolicLink() || file.dev !== source.stat.dev || file.ino !== source.stat.ino || sync.realpathSync(source.path) !== source.path || hash(sync.readFileSync(source.path)) !== source.sha256) throw Error('文件导入事务原源文件身份或字节变化'); }
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ fileImportTransactionSource: { clock: Clock; identity: Identity; check(): void } }>({
    fileImportTransactionSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('文件导入事务必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST, values.DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('文件导入事务只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ fileImportTransactionSource }, use) => { await use({ assertCurrent: fileImportTransactionSource.check, assertPreparation(info) { if (clocks.get(info) !== fileImportTransactionSource.clock) throw Error('文件导入事务原启动归属变化'); fileImportTransactionSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('文件导入事务原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式CSV原子尾部失败零新增、默认分批保留500行及原子成功两行', async ({ fileImportTransactionSource, trace, screenshot, video }, info) => {
    const { clock, identity } = fileImportTransactionSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      fileImportTransactionSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('文件导入事务原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('文件导入事务原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('文件导入事务原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE;
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`',
      atomic: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(nullable_note) AS nullableHex,HEX(literal_slash) AS slashHex FROM ' + plan.qualified('atomic_target') + ' ORDER BY ' + plan.qualified('atomic_target') + '.`id` ASC',
      batch: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,HEX(note) AS noteHex,HEX(nullable_note) AS nullableHex,HEX(literal_slash) AS slashHex FROM ' + plan.qualified('batch_target') + ' ORDER BY ' + plan.qualified('batch_target') + '.`id` ASC',
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 固定SQL只读白名单，原callback及原Query end均到达才能消费下一条。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('文件导入事务原观察命令归属或前序终态失效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('文件导入事务观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const actual = await readObserver('identity'); expect(actual).toHaveLength(1); expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    for (const path of [output, ...sourceFiles.map(file => file.path)]) { const inside = relative(profileDirectory, path); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('文件导入事务输出与输入不得位于原profile内'); }
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('文件导入事务原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('文件导入事务原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('atomic')).toEqual([plan.baseline]); expect(await readObserver('batch')).toEqual([plan.baseline]);
    await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '文件导入事务导入本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** 原Main仅透传三个准确文件能力、三次指定策略导入；失败回执不触发任何自动重放。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (root.__fileImportTransactionUi || typeof originalHandler !== 'function') throw Error('文件导入事务原Main审计归属未知');
      const state = { imports: 0, forbidden: 0, pending: 0, choices: 0, tokens: [] as string[], counts: {} as Record<string, number>, previews: [] as any[], results: [] as any[] }; root.__fileImportTransactionUi = state;
      const targets = ['atomic_target', 'batch_target', 'atomic_target'], modes = ['atomic', 'batch', 'atomic'], rowCounts = [0, 500, 2];
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('文件导入事务原Main或窗口变化');
        const command = payload.command, value = payload.input; state.counts[command] = (state.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || command.startsWith('query.execute') || command.startsWith('files.importPresets.') || ['table.apply', 'table.preview', 'files.export', 'result.insertApply', 'result.insertPreview'].includes(command)) { state.forbidden++; throw Error('文件导入事务禁止其它产品写入或执行'); }
        if (['metadata.objects', 'metadata.table', 'table.page'].includes(command) && (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== undefined && !['atomic_target', 'batch_target'].includes(value.table))) throw Error('文件导入事务表页或元数据目标变化');
        if (command === 'files.choose') {
          const index = state.choices++;
          if (index >= 3 || value.purpose !== 'import' || value.format !== 'csv' || value.suggestedName !== targets[index] + '.csv') throw Error('文件导入事务只准三次独立准确CSV选择');
        }
        let preview: any, importing: number | undefined;
        if (command === 'files.preview') {
          const index = state.tokens.indexOf(value.fileToken);
          if (index < 0 || state.previews.some(item => item.file === index) || value.format !== 'csv' || value.encoding !== 'utf8' || value.csvDelimiter !== ',' || Object.hasOwn(value, 'csvHasHeader') || Object.hasOwn(value, 'transactionMode')) throw Error('文件导入事务预览原能力、字节配置或独立策略合同变化');
          preview = { file: index }; state.previews.push(preview);
        }
        if (command === 'files.import') {
          importing = state.imports++;
          if (importing >= 3 || state.results.length !== importing || state.choices !== importing + 1 || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== targets[importing] || value.fileToken !== state.tokens[importing] || value.format !== 'csv' || value.encoding !== 'utf8' || value.csvDelimiter !== ',' || Object.hasOwn(value, 'csvHasHeader') || value.transactionMode !== modes[importing] || JSON.stringify(value.mapping) !== JSON.stringify(input.mapping)) throw Error('文件导入事务禁止重复坏文件或更换目标、策略、映射');
        }
        state.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'files.choose') { if (!reply?.ok || typeof reply.result?.token !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reply.result.token) || state.tokens.includes(reply.result.token) || reply.result.name !== input.names[state.tokens.length]) throw Error('文件导入事务正式Main能力回执变化'); state.tokens.push(reply.result.token); }
          if (command === 'files.preview') {
            const expected = input.previews[preview.file];
            if (!reply?.ok || JSON.stringify(reply.result?.columns) !== JSON.stringify(input.columns) || reply.result.rows?.length !== expected.length || JSON.stringify(reply.result.rows.map((row: any) => input.columns.map(column => row[column]))) !== JSON.stringify(expected)) throw Error('文件导入事务正式预览原文或精度失配');
            preview.rows = reply.result.rows.length;
          }
          if (command === 'files.import') {
            const index = importing!;
            if (!reply?.ok || reply.result?.rows !== rowCounts[index] || !Array.isArray(reply.result.errors) || reply.result.errors.length !== (index < 2 ? 1 : 0) || index < 2 && !String(reply.result.errors[0]).includes('502')) throw Error('文件导入事务实际失败位置或已确认行数失配');
            state.results.push({ table: targets[index], mode: modes[index], rows: reply.result.rows, errors: [...reply.result.errors] });
          }
          return reply;
        } finally { state.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__fileImportTransactionUiHandler = wrapped;
    }, { connectionId: profile.id, database, senderId, names: sourceFiles.map(file => basename(file.path)), columns: plan.columns, mapping: plan.mapping, previews: [plan.files.atomicBad.preview, plan.files.batchBad.preview, plan.files.good.preview] }));
    const state = () => step(() => application.evaluate(({ ipcMain }) => { const root = globalThis as any; if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__fileImportTransactionUiHandler) throw Error('文件导入事务原Main审计变化'); return structuredClone(root.__fileImportTransactionUi) as Audit; }));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click());
    const screenshots: { path: string; sha256: string }[] = [];
    /** 每个案例都用新对话框、独立文件令牌和一次真实按钮；失败后的原Start必须禁用。 */
    const importOnce = async (index: number, target: 'atomic_target' | 'batch_target', mode: 'atomic' | 'batch', expectedRows: number) => {
      await step(() => node.locator('.object-row').getByRole('button', { name: target, exact: true }).click()); const table = page.locator('.table-tab:visible'); await step(() => expect(table.getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => table.getByRole('button', { name: zh.common.import, exact: true }).click());
      const dialog = page.getByRole('dialog', { name: zh.transfer.text004 + ' · ' + database + '.' + target, exact: true }), strategy = dialog.getByRole('combobox', { name: text.label, exact: true }), start = dialog.getByRole('button', { name: zh.transfer.text028, exact: true }), sample = dialog.locator('.sample-grid').getByRole('grid');
      await step(() => expect(strategy).toHaveValue('batch')); await step(() => expect(start).toBeDisabled());
      await step(() => application.evaluate(installFileImportTransactionUiChoice, { owner: values.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER, senderId, paths: sourceFiles.map(file => file.path), index })); await step(() => dialog.locator('button.file-picker').click()); await step(() => expect.poll(async () => (await state()).tokens.length).toBe(index + 1)); await step(() => expect(dialog.locator('button.file-picker')).toContainText(basename(sourceFiles[index].path))); await step(() => expect(sample).toHaveAttribute('aria-rowcount', index === 2 ? '3' : '21'));
      for (const column of plan.columns) await step(() => expect(dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true })).toHaveValue(column));
      await step(() => application.evaluate(readFileImportTransactionUiChoices, { owner: values.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER, count: index + 1 }));
      if (mode === 'atomic') {
        const beforeMode = await state(); await step(() => strategy.selectOption('atomic')); await step(() => expect(strategy).toHaveValue('atomic'));
        const afterMode = await state(); expect(afterMode.previews).toEqual(beforeMode.previews); expect(afterMode.tokens).toEqual(beforeMode.tokens); expect(afterMode.counts['metadata.table']).toBe(beforeMode.counts['metadata.table']);
        for (const column of plan.columns) await step(() => expect(dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true })).toHaveValue(column));
      }
      await step(() => start.click()); await step(() => expect.poll(async () => (await state()).results.length).toBe(index + 1)); await step(() => expect.poll(async () => (await state()).pending).toBe(0));
      if (index < 2) await step(() => expect(dialog.locator('details.error-box pre')).toContainText('502'));
      else await step(() => expect(dialog.locator('.success-box')).toContainText(zh.transfer.text023 + zh.common.import + ' 2' + zh.transfer.text024));
      expect((await state()).results[index]).toMatchObject({ table: target, mode, rows: expectedRows }); await step(() => expect(start).toBeDisabled());
      const screenshotName = '文件事务-' + (index + 1) + '-' + mode + '.png', screenshotPath = join(output, screenshotName); expect(sync.existsSync(screenshotPath)).toBe(false); outputNames.add(screenshotName); await step(() => dialog.screenshot({ path: screenshotPath })); const sha256 = hash(await step(() => fs.readFile(screenshotPath))); screenshots.push({ path: screenshotPath, sha256 }); await step(() => info.attach('文件事务第' + (index + 1) + '次明确导入', { path: screenshotPath, contentType: 'image/png' }));
      await step(() => dialog.getByRole('button', { name: zh.common.done, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
    };
    await step(() => identity.assertCurrent()); await importOnce(0, 'atomic_target', 'atomic', 0); expect(await readObserver('atomic')).toEqual([plan.baseline]); expect(await readObserver('batch')).toEqual([plan.baseline]);
    await importOnce(1, 'batch_target', 'batch', 500); expect(await readObserver('batch')).toEqual(plan.expectedBatch); expect(await readObserver('atomic')).toEqual([plan.baseline]);
    await importOnce(2, 'atomic_target', 'atomic', 2); expect(await readObserver('atomic')).toEqual(plan.expectedAtomic); expect(await readObserver('batch')).toEqual(plan.expectedBatch);
    const final = await state(); expect({ imports: final.imports, forbidden: final.forbidden, pending: final.pending, choices: final.choices, tokens: final.tokens.length, previews: final.previews.length }).toEqual({ imports: 3, forbidden: 0, pending: 0, choices: 3, tokens: 3, previews: 3 }); expect(final.results.map(result => result.rows)).toEqual([0, 500, 2]); expect(pageErrors).toEqual([]);
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'files.import')).toHaveLength(3); expect(tasks.every(task => task.status !== 'running')).toBe(true); const picker = await step(() => application.evaluate(readFileImportTransactionUiChoices, { owner: values.DBARK_FILE_IMPORT_TRANSACTION_UI_OWNER, count: 3 }));
    await step(() => identity.assertCurrent()); await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent()); await assertObserverIdentity(); expect(await readObserver('atomic')).toEqual(plan.expectedAtomic); expect(await readObserver('batch')).toEqual(plan.expectedBatch); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true);
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('文件导入事务正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.file-import-transaction-ui', database, sourceRecordsBeforeBadTail: 501, badRecord: 502, atomicFailureConfirmedRows: 0, batchFailureConfirmedRows: 500, batchPending501Absent: true, atomicSuccessConfirmedRows: 2, finalAtomicRows: 3, finalBatchRows: 501, bothOriginalRowsPreserved: true, exactBigintDecimalNullBlobCrlfBackslashVerified: true, strategyDefaultsToBatch: true, modeChangePreservedFilePreviewMapping: true, importsAttemptedOncePerTargetScenario: true, automaticRetry: false, audit: final, normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, sourceManifest: values.DBARK_FILE_IMPORT_TRANSACTION_UI_MANIFEST_SHA256, sourceFiles: sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })), screenshots, picker, mainIpcAuditScope: '原窗口原handler透传；三份准确Main文件令牌、预览不携带transactionMode、精确目标与atomic/batch/atomic策略的一次独立导入；各阶段独立服务器完整读回', lowLevelSqlCommitCountVerified: false, guiJsonVerified: false, systemClipboard: 0, systemFileDialogInput: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}
