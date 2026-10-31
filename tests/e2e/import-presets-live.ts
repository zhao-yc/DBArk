import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, join, relative, isAbsolute, basename } from 'node:path';
import iconv from 'iconv-lite';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors, dialogCalls } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { csvImportHeaderZh as headerText } from '../../src/renderer/locales/csvImportHeader.zh-CN';
import { importPresetsZh as text } from '../../src/renderer/locales/importPresets.zh-CN';
import { importPresetsUiFixture, installImportPresetsUiChoice, readImportPresetsUiChoices } from '../helpers/importPresetsUi';

type Environment = ReturnType<typeof import('../helpers/importPresetsUi').bindImportPresetsUiEnvironment>;
interface Audit {
  imports: number; forbidden: number; pending: number; choices: number; tokens: string[]; counts: Record<string, number>;
  previews: { file: number; encoding: string; delimiter: string; header: boolean; ok?: boolean; columns?: string[]; rows?: number }[];
  saved?: { generation: string; revision: number; entries: { id: string; name: string; configuration: unknown }[] }; saves: number; deletes: number; mutations: number;
}

/** 只消费Root三份预置文件和随机库；保存纯本地配置，真实导入仅限明确确认的B文件两行。 */
export function registerImportPresetsUiTests(environment: Environment): void {
  const { values } = environment, configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_IMPORT_PRESETS_UI_OUTPUT), outputStat = sync.lstatSync(output);
  const plan = importPresetsUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_IMPORT_PRESETS_UI_OWNER);
  const sourceFiles = ([['a', 'DBARK_IMPORT_PRESETS_UI_CSV_A', 'DBARK_IMPORT_PRESETS_UI_CSV_A_SHA256'], ['bad', 'DBARK_IMPORT_PRESETS_UI_CSV_BAD', 'DBARK_IMPORT_PRESETS_UI_CSV_BAD_SHA256'], ['b', 'DBARK_IMPORT_PRESETS_UI_CSV_B', 'DBARK_IMPORT_PRESETS_UI_CSV_B_SHA256']] as const).map(([kind, pathKey, hashKey]) => {
    const path = resolve(values[pathKey]), stat = sync.lstatSync(path), sha256 = values[hashKey], expected = iconv.encode(plan.files[kind].text, 'gb18030');
    if (!stat.isFile() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || hash(sync.readFileSync(path)) !== sha256 || !sync.readFileSync(path).equals(expected)) throw Error('导入配置必须使用Root批准的三份准确GB18030合成文件');
    return { kind, path, stat, sha256 };
  });
  if (new Set(sourceFiles.map(file => file.path)).size !== 3) throw Error('导入配置三份源文件不得复用路径');
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('导入配置需要原已存在空的独占输出目录');
  const outputNames = new Set<string>();
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !outputNames.has(name))) throw Error('导入配置配置或输出目录身份变化');
    for (const source of sourceFiles) { const file = sync.lstatSync(source.path); if (!file.isFile() || file.isSymbolicLink() || file.dev !== source.stat.dev || file.ino !== source.stat.ino || sync.realpathSync(source.path) !== source.path || hash(sync.readFileSync(source.path)) !== source.sha256) throw Error('导入配置原源文件身份或字节变化'); }
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ importPresetsSource: { clock: Clock; identity: Identity; check(): void } }>({
    importPresetsSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('导入配置必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_IMPORT_PRESETS_UI_MANIFEST, values.DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('导入配置只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ importPresetsSource }, use) => { await use({ assertCurrent: importPresetsSource.check, assertPreparation(info) { if (clocks.get(info) !== importPresetsSource.clock) throw Error('导入配置原启动归属变化'); importPresetsSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('导入配置原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest('正式保存与复用导入配置、拒绝坏源列并明确导入新文件两行', async ({ importPresetsSource, trace, screenshot, video }, info) => {
    const { clock, identity } = importPresetsSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      importPresetsSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('导入配置原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('导入配置原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('导入配置原观察线程或物理流变化');
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
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('导入配置原观察命令归属或前序终态失效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('导入配置观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const actual = await readObserver('identity'); expect(actual).toHaveLength(1); expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_IMPORT_PRESETS_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino };
    for (const path of [output, ...sourceFiles.map(file => file.path)]) { const inside = relative(profileDirectory, path); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('导入配置输出与输入不得位于原profile内'); }
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('导入配置原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('导入配置原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual([]);
    await step(async () => { const assertMenuCurrent = check; assertMenuCurrent(); const action = await navigationMenuItem(page.locator('.navigation-toolbar'), { name: zh.common.newConnection, exact: true }, assertMenuCurrent); assertMenuCurrent(); await action.click(); assertMenuCurrent(); }); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '导入配置导入本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}).then(profiles => profiles.map(profile => { if (profile.dialect === 'sqlite') throw new Error('网络连接专项收到SQLite，停止当前验收'); return profile; })))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    expect(profile.hasPassword).toBe(Boolean(values.DBARK_TEST_PASSWORD)); expect(await step(() => application.evaluate(({ app }) => app.getPath('userData')))).toBe(profileDirectory);
    /** Main原handler仅放行原三份文件能力、纯配置CAS和准确B文件的一次导入。 */
    await step(() => application.evaluate(({ ipcMain }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'); if (root.__importPresetsUi || typeof originalHandler !== 'function') throw Error('导入配置原Main审计归属未知');
      const state = { imports: 0, forbidden: 0, pending: 0, choices: 0, tokens: [] as string[], counts: {} as Record<string, number>, previews: [] as any[], saves: 0, deletes: 0, mutations: 0, saved: undefined as any, snapshot: undefined as any, primaryId: '', temporaryId: '' }; root.__importPresetsUi = state;
      const configurationEqual = (value: any) => value && Object.keys(value).sort().join(',') === 'columns,csvDelimiter,csvHasHeader,encoding,format,mapping' && value.format === 'csv' && value.encoding === 'gb18030' && value.csvDelimiter === ';' && value.csvHasHeader === false && JSON.stringify(value.columns) === JSON.stringify(input.columns) && JSON.stringify(value.mapping) === JSON.stringify(input.mapping);
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped) throw Error('导入配置原Main或窗口变化');
        const command = payload.command, value = payload.input; state.counts[command] = (state.counts[command] ?? 0) + 1;
        if (command.startsWith('schema.') || command.startsWith('query.execute') || ['table.apply', 'table.preview', 'files.export', 'result.insertApply', 'result.insertPreview'].includes(command)) { state.forbidden++; throw Error('导入配置禁止额外产品写入或执行'); }
        if (['metadata.objects', 'metadata.table', 'table.page'].includes(command) && (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== undefined && value.table !== 'target')) throw Error('导入配置目录或表页目标变化');
        if (command === 'files.choose' && (++state.choices > 3 || value.purpose !== 'import' || value.format !== 'csv' || value.suggestedName !== 'target.csv')) throw Error('导入配置只准三份顺序正式CSV选择');
        let preview: any;
        if (command === 'files.preview') {
          const file = state.tokens.indexOf(value.fileToken), header = value.csvHasHeader !== false, combination = [value.encoding, value.csvDelimiter, header].join('|');
          const allowed = file === 0 ? ['gb18030|;|false', 'utf8|;|false', 'utf8|,|false', 'utf8|,|true'] : file === 1 ? ['utf8|,|true', 'gb18030|;|false'] : file === 2 ? ['gb18030|;|false'] : [];
          if (state.previews.length >= 16 || value.format !== 'csv' || !allowed.includes(combination) || header && Object.hasOwn(value, 'csvHasHeader') || !header && (!Object.hasOwn(value, 'csvHasHeader') || value.csvHasHeader !== false)) throw Error('导入配置预览原文件、解释选项或读取预算变化');
          preview = { file, encoding: value.encoding, delimiter: value.csvDelimiter, header }; state.previews.push(preview);
        }
        if (command === 'files.importPresets.list' && (Object.keys(value).length || state.counts[command] > 3)) throw Error('导入配置列表读取范围或预算变化');
        let mutation: number | undefined;
        if (command === 'files.importPresets.save') {
          mutation = state.mutations; const expectedName = [input.presetName, input.temporaryPresetName, input.updatedPresetName][mutation], update = mutation === 2;
          if (++state.saves > 3 || mutation > 2 || !state.snapshot || value.generation !== state.snapshot.generation || value.revision !== state.snapshot.revision || (update ? value.id !== state.primaryId : Object.hasOwn(value, 'id')) || value.name !== expectedName || !configurationEqual(value.configuration) || Object.keys(value).sort().join(',') !== (update ? 'configuration,generation,id,name,revision' : 'configuration,generation,name,revision')) throw Error('导入配置明确创建/更新CAS或纯配置白名单变化');
          state.mutations++;
        }
        if (command === 'files.importPresets.delete') {
          mutation = state.mutations;
          if (++state.deletes !== 1 || mutation !== 3 || !state.snapshot || value.generation !== state.snapshot.generation || value.revision !== state.snapshot.revision || value.id !== state.temporaryId || Object.keys(value).sort().join(',') !== 'generation,id,revision') throw Error('导入配置只准明确删除本例临时配置一次');
          state.mutations++;
        }
        if (command === 'files.import' && (++state.imports !== 1 || state.choices !== 3 || !state.saved || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'target' || value.fileToken !== state.tokens[2] || value.format !== 'csv' || value.encoding !== 'gb18030' || value.csvDelimiter !== ';' || value.csvHasHeader !== false || JSON.stringify(value.mapping) !== JSON.stringify(input.mapping))) throw Error('导入配置只准准确B文件、完整人工映射及原目标导入一次');
        state.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'files.choose') { if (!reply?.ok || typeof reply.result?.token !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(reply.result.token) || reply.result.name !== input.names[state.tokens.length] || state.tokens.includes(reply.result.token)) throw Error('导入配置正式Main文件令牌失效'); state.tokens.push(reply.result.token); }
          if (command === 'files.preview') {
            preview.ok = reply?.ok === true;
            if (reply?.ok) { preview.columns = structuredClone(reply.result.columns); preview.rows = reply.result.rows.length; }
            if (value.encoding === 'gb18030' && value.csvDelimiter === ';' && value.csvHasHeader === false) {
              const expected = input.decoded[preview.file], columns = Array.from({ length: preview.file === 1 ? 7 : 6 }, (_, index) => '第' + (index + 1) + '列');
              if (!reply?.ok || JSON.stringify(reply.result.columns) !== JSON.stringify(columns) || reply.result.rows.length !== 2 || JSON.stringify(reply.result.rows.map((row: any) => columns.map(column => row[column]))) !== JSON.stringify(expected)) throw Error('导入配置正确解释下的完整预览原文失配');
            }
          }
          if (command === 'files.importPresets.list' || command === 'files.importPresets.save' || command === 'files.importPresets.delete') {
            if (!reply?.ok || !reply.result || typeof reply.result.generation !== 'string' || !Number.isSafeInteger(reply.result.revision) || !Array.isArray(reply.result.entries)) throw Error('导入配置实际存储回执失效');
            const snapshot = reply.result;
            if (mutation !== undefined) {
              if (snapshot.revision !== value.revision + 1 || snapshot.generation !== value.generation || snapshot.entries.length !== [1, 2, 2, 1][mutation] || snapshot.entries.some((entry: any) => !configurationEqual(entry.configuration))) throw Error('导入配置实际CRUD修订或完整配置变化');
              if (mutation === 0) { const primary = snapshot.entries.find((entry: any) => entry.name === input.presetName); if (!primary) throw Error('导入配置主项未实际创建'); state.primaryId = primary.id; }
              if (mutation === 1) { const temporary = snapshot.entries.find((entry: any) => entry.name === input.temporaryPresetName); if (!temporary || temporary.id === state.primaryId) throw Error('导入配置临时项未独立创建'); state.temporaryId = temporary.id; }
              if (mutation >= 2 && !snapshot.entries.some((entry: any) => entry.id === state.primaryId && entry.name === input.updatedPresetName) || mutation === 3 && snapshot.entries.some((entry: any) => entry.id === state.temporaryId)) throw Error('导入配置更新或明确删除未实际生效');
              state.saved = structuredClone(snapshot);
            }
            state.snapshot = structuredClone(snapshot);
          }
          if (command === 'files.import') { if (!reply?.ok || reply.result?.rows !== 2 || reply.result.errors?.length !== 0) throw Error('导入配置真实导入未成功两行'); }
          return reply;
        } finally { state.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__importPresetsUiHandler = wrapped;
    }, { connectionId: profile.id, database, senderId, names: sourceFiles.map(file => basename(file.path)), columns: plan.columns, mapping: plan.configuration.mapping, presetName: plan.presetName, temporaryPresetName: plan.temporaryPresetName, updatedPresetName: plan.updatedPresetName, decoded: [plan.files.a.decoded, plan.files.bad.decoded, plan.files.b.decoded] }));
    const state = () => step(() => application.evaluate(({ ipcMain }) => { const root = globalThis as any; if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__importPresetsUiHandler) throw Error('导入配置原Main审计变化'); return structuredClone(root.__importPresetsUi) as Audit; }));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').getByRole('button', { name: 'target', exact: true }).click());
    const table = page.locator('.table-tab:visible'); await step(() => expect(table.getByRole('grid')).toBeVisible()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => table.getByRole('button', { name: zh.common.import, exact: true }).click());
    const dialog = page.getByRole('dialog', { name: zh.transfer.text004 + ' · ' + database + '.target', exact: true }), presets = dialog.getByRole('region', { name: text.title, exact: true }), header = dialog.getByRole('checkbox', { name: headerText.label, exact: true }), encoding = dialog.getByRole('combobox', { name: new RegExp('^' + zh.transfer.text009) }), delimiter = dialog.getByRole('combobox', { name: zh.transfer.csvDelimiter, exact: true }), sample = dialog.locator('.sample-grid').getByRole('grid'), start = dialog.getByRole('button', { name: zh.transfer.text028, exact: true });
    expect((await state()).counts['files.importPresets.list'] ?? 0).toBe(0); await step(() => expect(header).toBeChecked()); await step(() => encoding.selectOption('gb18030')); await step(() => delimiter.selectOption(';')); await step(() => header.uncheck());
    /** 每次独立一次性Electron API适配；文件能力由真实Main产生，不在测试内造token。 */
    const choose = async (index: number) => { await step(() => application.evaluate(installImportPresetsUiChoice, { owner: values.DBARK_IMPORT_PRESETS_UI_OWNER, senderId, paths: sourceFiles.map(file => file.path), index })); await step(() => dialog.locator('button.file-picker').click()); await step(() => expect.poll(async () => (await state()).tokens.length).toBe(index + 1)); await step(() => expect(dialog.locator('button.file-picker')).toContainText(basename(sourceFiles[index].path))); await step(() => expect.poll(async () => (await state()).previews.some(preview => preview.file === index && preview.ok !== undefined)).toBe(true)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => application.evaluate(readImportPresetsUiChoices, { owner: values.DBARK_IMPORT_PRESETS_UI_OWNER, count: index + 1 })); };
    const mapping = (column: string) => dialog.getByRole('combobox', { name: formatText(zh.transfer.text020, column), exact: true });
    await choose(0); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '3')); for (const [index, column] of plan.columns.entries()) await step(() => mapping(column).selectOption(plan.targetColumns[index]));
    await step(() => presets.getByRole('button', { name: text.read, exact: true }).click()); await step(() => expect(presets.getByRole('button', { name: text.create, exact: true })).toBeEnabled()); await step(() => presets.getByRole('textbox', { name: text.name, exact: true }).fill(plan.presetName)); await step(() => presets.getByRole('button', { name: text.create, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saved?.revision).toBe(1));
    const created = (await state()).saved!; expect(created.entries).toHaveLength(1); expect(created.entries[0].configuration).toEqual(plan.configuration); expect(created.entries[0].name).toBe(plan.presetName);
    // 明确走完整本地CRUD：另存临时项、选回主项改名更新，再只删除临时项，最终保留一份可复用配置。
    await step(() => presets.getByRole('textbox', { name: text.name, exact: true }).fill(plan.temporaryPresetName)); await step(() => presets.getByRole('button', { name: text.create, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saved?.revision).toBe(2));
    const temporary = (await state()).saved!.entries.find(entry => entry.name === plan.temporaryPresetName)!; expect(temporary.id).not.toBe(created.entries[0].id);
    await step(() => presets.getByRole('combobox', { name: text.choose, exact: true }).selectOption(created.entries[0].id)); await step(() => presets.getByRole('textbox', { name: text.name, exact: true }).fill(plan.updatedPresetName)); await step(() => presets.getByRole('button', { name: text.update, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saved?.revision).toBe(3));
    await step(() => presets.getByRole('combobox', { name: text.choose, exact: true }).selectOption(temporary.id)); await step(() => presets.getByRole('button', { name: text.delete, exact: true }).click()); await step(() => expect.poll(async () => (await state()).saved?.revision).toBe(4));
    const saved = (await state()).saved!; expect(saved.entries).toHaveLength(1); expect(saved.entries[0].id).toBe(created.entries[0].id); expect(saved.entries[0].name).toBe(plan.updatedPresetName); expect(saved.entries[0].configuration).toEqual(plan.configuration); await step(() => presets.getByRole('combobox', { name: text.choose, exact: true }).selectOption(saved.entries[0].id)); expect((await state()).imports).toBe(0); expect(await readObserver('rows')).toEqual([]);
    await step(() => encoding.selectOption('utf8')); await step(() => delimiter.selectOption(',')); await step(() => header.check()); await choose(1); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '2'));
    await step(() => presets.getByRole('button', { name: text.refresh, exact: true }).click()); await step(() => presets.getByRole('combobox', { name: text.choose, exact: true }).selectOption(saved.entries[0].id));
    const beforeBad = await state(); await step(() => presets.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(encoding).toHaveValue('gb18030')); await step(() => expect(delimiter).toHaveValue(';')); await step(() => expect(header).not.toBeChecked()); await step(() => expect(dialog.getByText(text.incompatible, { exact: true })).toBeVisible()); await step(() => expect(start).toBeDisabled()); await step(() => expect.poll(async () => (await state()).pending).toBe(0));
    const afterBad = await state(); expect(afterBad.counts['metadata.table']).toBe((beforeBad.counts['metadata.table'] ?? 0) + 1); expect(afterBad.previews.at(-1)).toMatchObject({ file: 1, encoding: 'gb18030', delimiter: ';', header: false, ok: true, columns: [...plan.columns, '第7列'], rows: 2 }); expect(afterBad.imports).toBe(0); expect(await readObserver('rows')).toEqual([]);
    await choose(2); await step(() => expect(sample).toHaveAttribute('aria-rowcount', '3')); for (const column of plan.columns) await step(() => expect(mapping(column)).toHaveValue('')); await step(() => expect(presets.getByRole('combobox', { name: text.choose, exact: true })).toHaveValue(saved.entries[0].id));
    await step(() => start.click()); await step(() => expect(dialog.getByText(zh.transfer.text001, { exact: true })).toBeVisible()); expect((await state()).imports).toBe(0);
    const beforeGood = await state(); await step(() => presets.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(dialog.getByText(text.applied, { exact: true })).toBeVisible()); for (const [index, column] of plan.columns.entries()) await step(() => expect(mapping(column)).toHaveValue(plan.targetColumns[index]));
    await step(() => expect(sample.getByRole('gridcell').filter({ hasText: /^18446744073709551615$/ })).toBeVisible()); expect((await state()).counts['metadata.table']).toBe((beforeGood.counts['metadata.table'] ?? 0) + 1); expect((await state()).imports).toBe(0);
    const screenshotName = '导入配置-重新核验B文件完整映射.png', screenshotPath = join(output, screenshotName); expect(sync.existsSync(screenshotPath)).toBe(false); outputNames.add(screenshotName); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotHash = hash(await step(() => fs.readFile(screenshotPath))); await step(() => info.attach('导入配置重新核验完整映射', { path: screenshotPath, contentType: 'image/png' }));
    await step(() => start.click()); await step(() => expect(dialog.locator('.success-box')).toContainText(zh.transfer.text023 + zh.common.import + ' 2' + zh.transfer.text024)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(start).toBeDisabled());
    const toHex = (value: string) => Buffer.from(value, 'utf8').toString('hex').toUpperCase(), expectedRows = plan.files.b.decoded.map(row => ({ id: row[0], amount: row[1], payloadHex: row[2] === 'base64:AP8=' ? '00FF' : '', noteHex: toHex(row[3]!), nullableHex: row[4] === null ? null : toHex(row[4]), slashHex: toHex(row[5]!) })); expect(await readObserver('rows')).toEqual(expectedRows);
    await step(() => dialog.getByRole('button', { name: zh.common.done, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); const final = await state(); expect({ imports: final.imports, forbidden: final.forbidden, pending: final.pending, choices: final.choices, saves: final.saves, deletes: final.deletes, mutations: final.mutations }).toEqual({ imports: 1, forbidden: 0, pending: 0, choices: 3, saves: 3, deletes: 1, mutations: 4 }); expect(final.saved).toEqual(saved); expect(pageErrors).toEqual([]);
    const picker = await step(() => application.evaluate(readImportPresetsUiChoices, { owner: values.DBARK_IMPORT_PRESETS_UI_OWNER, count: 3 })); await step(() => identity.assertCurrent()); await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent());
    // 正常退出后复制原SQLite完整字节，标准夹具随后可正常清理userData；Root仍可独立SQL.js核验。
    const sqliteSource = join(profileDirectory, 'dbark.sqlite'), sqliteName = 'import-presets-dbark.sqlite', sqliteCopy = join(output, sqliteName), sqliteStat = await step(() => fs.lstat(sqliteSource)); expect(sqliteStat.isFile() && !sqliteStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(sqliteSource))).toBe(sqliteSource); expect(sync.existsSync(sqliteCopy)).toBe(false); const sqliteBytes = await step(() => fs.readFile(sqliteSource)), sqliteHash = hash(sqliteBytes); outputNames.add(sqliteName); await step(() => fs.copyFile(sqliteSource, sqliteCopy, sync.constants.COPYFILE_EXCL)); expect(hash(await step(() => fs.readFile(sqliteCopy)))).toBe(sqliteHash); expect(hash(await step(() => fs.readFile(sqliteSource)))).toBe(sqliteHash);
    const initSqlJs = require('sql.js') as typeof import('sql.js')['default'], wasmBinary = await step(() => fs.readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))), SQL = await step(() => initSqlJs({ wasmBinary: Uint8Array.from(wasmBinary).buffer })), local = new SQL.Database(sqliteBytes); let persisted: any;
    try {
      expect(local.exec('SELECT COUNT(*) AS count FROM secrets')[0].values).toEqual([[0]]);
      const profilesOnDisk = local.exec('SELECT data FROM connections')[0].values.map(row => JSON.parse(String(row[0]))); expect(profilesOnDisk).toHaveLength(1); expect(profilesOnDisk[0].rememberPassword).toBe(false); expect(Object.hasOwn(profilesOnDisk[0], 'password')).toBe(false);
      const raw = local.exec('SELECT data FROM import_presets WHERE id=1'); expect(raw).toHaveLength(1); expect(raw[0].values).toHaveLength(1); persisted = JSON.parse(String(raw[0].values[0][0])); expect(Object.keys(persisted).sort()).toEqual(['entries', 'revision', 'version']); expect(persisted.version).toBe(1); expect(persisted.revision).toBe(saved.revision); expect(persisted.entries).toEqual(saved.entries); expect(persisted.entries[0].configuration).toEqual(plan.configuration); expect(Object.keys(persisted.entries[0].configuration).sort()).toEqual(['columns', 'csvDelimiter', 'csvHasHeader', 'encoding', 'format', 'mapping']);
      const configurationText = JSON.stringify(persisted.entries[0].configuration); for (const forbidden of [...sourceFiles.map(file => file.path), ...final.tokens]) expect(configurationText).not.toContain(forbidden);
    } finally { local.close(); }
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(expectedRows); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true); observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('保存并复用导入配置正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.import-presets-ui', database, table: 'target', presetName: plan.updatedPresetName, presetId: saved.entries[0].id, configurationRevision: persisted.revision, savedConfiguration: persisted.entries[0].configuration, localCrud: { creates: 2, updates: 1, deletes: 1, remaining: 1 }, saveDidNotImport: true, badSevenColumnsRejectedEntirely: true, byteOptionsRestored: true, metadataRefreshedOnBothApplications: true, newFileDidNotInheritMapping: true, explicitReapplyRequired: true, importedRows: 2, exactBigintDecimalNullBlobCrlfBackslashVerified: true, audit: final, normalExit: true, originalProcessExitCode: original.exitCode, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, sourceManifest: values.DBARK_IMPORT_PRESETS_UI_MANIFEST_SHA256, sourceFiles: sourceFiles.map(file => ({ path: file.path, sha256: file.sha256 })), localStore: { actualPath: sqliteSource, retainedCopy: sqliteCopy, sha256: sqliteHash, secretsRows: 0, passwordSessionOnly: true, configurationOnlyFieldsVerified: true, guiRestartVerified: false }, screenshot: { path: screenshotPath, sha256: screenshotHash }, picker, mainIpcAuditScope: '原窗口原handler透传；三份准确Main文件令牌、纯配置两次新建一次更新一次删除CAS、恢复选项的有界预览和B文件一次导入；未声称底层SQL逐条审计', systemClipboard: 0, systemFileDialogInput: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}


/** 仅在原用户动作中加载真实菜单展示入口；每个异步边界继续核原资源门。 */
async function navigationMenuItem(...args: Parameters<typeof import('./navigation-menu')['navigationMenuItem']>) {
  args[2]?.(); const menu = await import('./navigation-menu'); args[2]?.();
  const item = await menu.navigationMenuItem(...args); args[2]?.(); return item;
}
