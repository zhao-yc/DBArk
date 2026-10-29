import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, pageErrors } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tableFilteredExportZh as text } from '../../src/renderer/locales/tableFilteredExport.zh-CN';
import { tableValueOptionsZh as valuesText } from '../../src/renderer/locales/tableValueOptions.zh-CN';
import { tableSortZh as sortText } from '../../src/renderer/locales/tableSort.zh-CN';

/** 只消费Root预置随机库；文件选择用一次性Electron API适配，不冒充系统按钮输入。 */
export function registerTableFilteredExportUiTests(): void {
  const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_FILTERED_EXPORT_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_FILTERED_EXPORT_OWNER', 'DBARK_TABLE_FILTERED_EXPORT_MANIFEST', 'DBARK_TABLE_FILTERED_EXPORT_MANIFEST_SHA256', 'DBARK_TABLE_FILTERED_EXPORT_OUTPUT'];
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  if (keys.some(key => typeof values[key] !== 'string' || !values[key]) || process.platform !== 'win32' || values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_FILTERED_EXPORT_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !/^dbark_filteredexport_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE!) || !/^dbark-filtered-export:[a-f0-9]{32}$/.test(values.DBARK_TABLE_FILTERED_EXPORT_OWNER!) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(values.DBARK_TEST_EXPECTED_SERVER_UUID!) || !/^[a-f0-9]{64}$/.test(values.DBARK_TABLE_FILTERED_EXPORT_MANIFEST_SHA256!)) throw Error('筛选导出GUI原目标或批准来源无效');
  /** 捕获全部相关环境键的存在性和值；外部renderer、预加载及大小写别名一律拒绝。 */
  const environmentSignature = () => {
    const names = Object.keys(process.env).filter(key => /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (names.some(key => key !== key.toUpperCase() || ['DBARK_DEV_URL', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key))) throw Error('筛选导出GUI拒绝外部renderer、预加载或大小写环境别名');
    return JSON.stringify(names.map(key => [key, process.env[key]]));
  };
  const originalEnvironment = environmentSignature();
  const configuration = resolve('playwright.config.ts'), configHash = createHash('sha256').update(sync.readFileSync(configuration)).digest('hex');
  const output = resolve(values.DBARK_TABLE_FILTERED_EXPORT_OUTPUT!), outputStat = sync.lstatSync(output);
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output) throw Error('筛选导出GUI原输出目录无效');
  const assertEnvironment = () => {
    const stat = sync.lstatSync(output);
    if (environmentSignature() !== originalEnvironment || keys.some(key => values[key] !== process.env[key]) || createHash('sha256').update(sync.readFileSync(configuration)).digest('hex') !== configHash || !stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== outputStat.dev || stat.ino !== outputStat.ino || sync.realpathSync(output) !== output) throw Error('筛选导出GUI原环境或输出目录已变化');
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ filteredSource: { clock: Clock; identity: Identity; check(): void } }>({
    filteredSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('筛选导出GUI需要原配置与零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>) => { check(); const result = await action(); check(); return result; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_TABLE_FILTERED_EXPORT_MANIFEST!, values.DBARK_TABLE_FILTERED_EXPORT_MANIFEST_SHA256!, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('筛选导出GUI只验批准源码App');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ filteredSource }, use) => { await use({ assertCurrent: filteredSource.check, assertPreparation(info) { if (clocks.get(info) !== filteredSource.clock) throw Error('筛选导出GUI启动归属已变化'); filteredSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('筛选导出GUI未确认原App终态，保留现场'); } });
  nativeTest('正式表页排序后的1105行、字段子集及已应用Alpha筛选导出', async ({ filteredSource, trace, screenshot, video }, info) => {
    const { clock, identity } = filteredSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(); let closed = false;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    const check = () => {
      filteredSource.check(); const current = ownedDesktopResources(info);
      if (current.page !== page || current.application !== application || current.closed !== closed || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('筛选导出GUI原窗口已变化');
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('筛选导出GUI原观察连接或原物理流已失效');
    };
    const step = async <T,>(action: () => Promise<T>) => { check(); try { const result = await action(); check(); return result; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE!;
    const statements = Object.freeze({
      identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId',
      owner: 'SELECT marker FROM `' + database + '`.`__owner`',
      threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?',
    });
    /** 只提供三个固定只读动作，不接受任意SELECT前缀；原callback与原Query end均发生才返回。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolve, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('筛选导出GUI原观察动作未获准')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command);
      let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      /** 错误也不能冒充end；没有原命令终态时保留至原期限，不借新连接继续。 */
      const finish = () => {
        if (settled || !command.callbackReturned || !command.terminal) return;
        settled = true;
        if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('筛选导出GUI原观察结果形状未知')); else resolve(rows);
      };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => {
        failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish();
      });
      query.once('end', () => { command.terminal = true; finish(); });
      query.once('error', error => { failure ??= error; finish(); });
    }));
    /** 每次同时核实际服务器与原随机库标记，不以输入域名或同名数据库替代实际身份。 */
    const assertObserverIdentity = async () => {
      const actual = await readObserver('identity'); expect(actual).toHaveLength(1);
      expect(String(actual[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(actual[0].os).toLowerCase()); expect(String(actual[0].lowerNames)).toBe('0'); expect(actual[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(actual[0].threadId)).toBe(observerThread);
      expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_TABLE_FILTERED_EXPORT_OWNER }]);
    };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid })));
    await step(() => identity.assertActual(actual)); await step(() => identity.assertCurrent());
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolve, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST!, port: 13384, user: values.DBARK_TEST_USER!, password: values.DBARK_TEST_PASSWORD!, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 });
      observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('筛选导出GUI原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; });
      observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); });
      observer.connect(error => {
        if (error) { reject(error); return; }
        observerThread = observer!.threadId;
        if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('筛选导出GUI原观察线程身份未知')); else resolve();
      });
    }));
    await assertObserverIdentity();
    await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '全部筛选行本例'], [zh.connections.text009, values.DBARK_TEST_HOST!], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER!], [zh.connections.text011, values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
    const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); expect(profiles[0].rememberPassword).toBe(false);
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profiles[0].name, exact: true }) }); await step(() => node.getByRole('button', { name: profiles[0].name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').filter({ has: page.locator('.truncate').filter({ hasText: /^subject$/ }) }).locator('button.tree-label').click());
    const tab = page.locator('.table-tab:visible'), action = tab.locator('.table-action-bar'); await step(() => expect(tab.locator('.table-grid-wrap').getByRole('grid')).toBeVisible());
    await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await step(() => expect(action.getByText(formatText(zh.table.text016, 50), { exact: true })).toBeVisible());
    await step(() => tab.getByRole('button', { name: sortText.entry, exact: true }).click()); const sorting = tab.getByRole('region', { name: sortText.title, exact: true });
    for (const [index, column] of ['label', 'id'].entries()) { await step(() => sorting.getByRole('button', { name: sortText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortText.field(index + 1), exact: true }).selectOption(column)); }
    await step(() => sorting.getByRole('combobox', { name: sortText.direction(2), exact: true }).selectOption('DESC')); await step(() => sorting.getByRole('button', { name: sortText.apply, exact: true }).click()); await step(() => expect(sorting).toBeHidden());
    /** 仅为原窗口本次JSON路径回答一次原生保存选择；引擎、IPC和磁盘写入均为真实产品。 */
    const exportJson = async (name: string, count: number, projection = false) => {
      const filePath = join(output, name); await step(() => fs.writeFile(filePath, '原文件', { flag: 'wx' }));
      await step(() => tab.getByRole('button', { name: text.entry, exact: true }).click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => dialog.getByRole('combobox', { name: text.format, exact: true }).selectOption('json'));
      if (projection) {
        // 正式UI先证明空选择不能获得文件能力，再明确选择两列，不直接改配置或IPC。
        await step(() => dialog.getByRole('button', { name: text.clearFields, exact: true }).click());
        await step(() => expect(dialog.getByText(text.emptyFields, { exact: true })).toBeVisible());
        await step(() => expect(dialog.getByRole('button', { name: text.choose, exact: true })).toBeDisabled());
        await step(() => expect(dialog.getByRole('button', { name: text.start, exact: true })).toBeDisabled());
        await step(() => dialog.getByRole('checkbox', { name: '导出字段 id', exact: true }).check());
        await step(() => dialog.getByRole('checkbox', { name: '导出字段 amount', exact: true }).check());
        await step(() => expect(dialog.getByRole('checkbox', { name: '导出字段 label', exact: true })).not.toBeChecked());
      }
      /** 每次只消费原窗口同一精确路径的一次保存回答；改顺序后必须重新走原文件能力签发。 */
      const chooseOriginalFile = async () => {
      await step(() => application.evaluate(({ dialog, BrowserWindow }, input) => {
        const original = dialog.showSaveDialog, windows = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed()); if (windows.length !== 1) throw Error('筛选导出文件选择原窗口不唯一');
        const owner = windows[0];
        dialog.showSaveDialog = (async (window: any, options: any) => {
          dialog.showSaveDialog = original;
          if (window !== owner || owner.isDestroyed() || options.title !== '导出文件' || options.filters?.[0]?.extensions?.join(',') !== 'json' || options.defaultPath !== 'subject-filtered.json') throw Error('筛选导出本例文件选择越界');
          return { canceled: false, filePath: input.filePath };
        }) as typeof dialog.showSaveDialog;
      }, { filePath }));
        await step(() => dialog.getByRole('button', { name: text.choose, exact: true }).click());
        await step(() => expect(dialog.getByRole('button', { name: text.chooseAgain + '：' + basename(filePath), exact: true })).toBeEnabled());
      };
      await chooseOriginalFile();
      if (projection) {
        await step(() => dialog.getByRole('button', { name: '上移导出字段 amount', exact: true }).click());
        const order = dialog.getByRole('list', { name: text.fieldOrder, exact: true });
        await step(() => expect(order.locator('li > span')).toHaveText(['amount', 'id']));
        await step(() => expect(dialog.getByRole('button', { name: text.start, exact: true })).toBeDisabled());
        await step(() => expect(dialog.getByRole('button', { name: text.chooseAgain + '：' + basename(filePath), exact: true })).toHaveCount(0));
        // 旧令牌已撤销，重新明确选择同一projection.json，不能依旧令牌直接执行。
        await chooseOriginalFile();
      }
      await step(() => dialog.getByRole('button', { name: text.start, exact: true }).click()); await step(() => expect(dialog.getByText(text.completed(count), { exact: true })).toBeVisible());
      const rows = JSON.parse(await step(() => fs.readFile(filePath, 'utf8'))); expect(rows).toHaveLength(count); await step(() => dialog.getByRole('button', { name: text.done, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); return { filePath, rows };
    };
    const full = await exportJson('all.json', 1105);
    const projection = await exportJson('projection.json', 1105, true);
    // label未输出仍参与原多列排序；逐行比对首个完整文件，不能只比集合或抽样。
    for (const row of projection.rows) expect(Object.keys(row)).toEqual(['amount', 'id']);
    expect(projection.rows).toEqual(full.rows.map((row: { amount: unknown; id: unknown }) => ({ amount: row.amount, id: row.id })));
    await step(() => tab.getByRole('button', { name: valuesText.open, exact: true }).click()); const candidates = page.getByRole('dialog', { name: valuesText.title, exact: true }); await step(() => candidates.getByRole('combobox', { name: valuesText.column, exact: true }).selectOption('label')); await step(() => candidates.getByRole('button', { name: valuesText.read, exact: true }).click()); await step(() => expect(candidates.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ })).toBeVisible()); await step(() => candidates.getByRole('checkbox', { name: /^"[Aa]lpha ?"$/ }).check()); await step(() => candidates.getByRole('button', { name: valuesText.apply, exact: true }).click()); await step(() => expect(candidates).toBeHidden());
    const filtered = await exportJson('alpha.json', 369); expect(filtered.rows).toEqual(full.rows.filter((row: { label: string | null }) => typeof row.label === 'string' && row.label.trim().toLowerCase() === 'alpha')); expect(filtered.rows.map((row: { id: number }) => row.id)).toEqual(filtered.rows.map((row: { id: number }) => row.id).sort((left: number, right: number) => right - left));
    const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks.filter(task => task.kind === 'table.exportFiltered')).toHaveLength(3); expect(tasks.every(task => task.status === 'completed')).toBe(true); expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(pageErrors).toEqual([]);
    const screenshotPath = info.outputPath('全部筛选行-多列排序.png'); await step(() => tab.screenshot({ path: screenshotPath })); const screenshotHash = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex'); await step(() => identity.assertCurrent());
    await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); await step(() => identity.assertCurrent());
    await assertObserverIdentity(); expect(await readObserver('threads')).toEqual([]); check();
    observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check();
    expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('全部筛选行正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-filtered-export-ui', database, fullRows: full.rows.length, projectionRows: projection.rows.length, projectionColumns: ['amount', 'id'], projectionOrderMatchesFullRows: true, filteredRows: filtered.rows.length, files: [full.filePath, projection.filePath, filtered.filePath], pageSize: 50, sorting: ['label ASC', 'id DESC'], normalExit: true, originalProcessExitCode: original.exitCode, sourceManifest: values.DBARK_TABLE_FILTERED_EXPORT_MANIFEST_SHA256, sourceVerifiedBeforeAndAfter: true, serverVersion: '8.4.11', serverUuidVerified: true, originalOwnerVerifiedBeforeAndAfter: true, controlThreadId: observerThread, observerClosed, targetThreadsAfterExit: 0, observerCommandsEnded: true, screenshot: { path: screenshotPath, sha256: screenshotHash }, nativeFilePickerInputVerified: false, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}
