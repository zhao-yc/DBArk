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
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableFilteredUpdateZh as text } from '../../src/renderer/locales/tableFilteredUpdate.zh-CN';
import { tableFilteredUpdateUiFixture, tableFilteredUpdateMultiUiFixture, assertTableFilteredUpdateUiProcess, tableFilteredUpdateUiConflictFiles, tableFilteredUpdateUiConflictRequest, parseTableFilteredUpdateUiConflictAck, type TableFilteredUpdateUiConflictAck } from '../helpers/tableFilteredUpdateUi';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { tableFilterGroupsZh as groups } from '../../src/renderer/locales/tableFilterGroups.zh-CN';
import { tableFilterEnabledZh as enabled } from '../../src/renderer/locales/tableFilterEnabled.zh-CN';
import { tableSortZh as sortingText } from '../../src/renderer/locales/tableSort.zh-CN';

type Environment = ReturnType<typeof import('../helpers/tableFilteredUpdateUi').bindTableFilteredUpdateUiEnvironment> | ReturnType<typeof import('../helpers/tableFilteredUpdateUi').bindTableFilteredUpdateMultiUiEnvironment>;
interface Audit {
  previews: number; applies: number; releases: number; queryExecuteCount: number; pending: number; forbidden: number;
  counts: Record<string, number>; previewResults: any[]; applyResults: any[]; events: any[];
  pages: { input: any; ids?: string[]; hasMore?: boolean }[];
}
/** 完整服务器范围只由正式表单构造；Root单次并发CAS后独立核原行，再明确提交并核整批回滚。 */
export function registerTableFilteredUpdateUiTests(environment: Environment): void {
  const { values, mode } = environment, multi = mode === 'multi', configuration = resolve('playwright.config.ts');
  const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
  const configurationHash = hash(sync.readFileSync(configuration)), output = resolve(values.DBARK_TABLE_FILTERED_UPDATE_UI_OUTPUT), outputStat = sync.lstatSync(output);
  const singlePlan = tableFilteredUpdateUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER), multiPlan = tableFilteredUpdateMultiUiFixture(values.DBARK_TEST_DATABASE, values.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER), plan = multi ? multiPlan : singlePlan;
  const fields = multi ? multiPlan.fillColumns : ['note'], confirmation = plan.database + '.subject / ' + (multi ? JSON.stringify(fields) : 'note') + ' / 61';
  const assignmentDigest = (second: boolean) => hash(JSON.stringify(multi ? (second ? multiPlan.secondAssignments : multiPlan.assignments).map(item => [item.column, item.value]) : ['note', second ? plan.secondFillValue : plan.fillValue]));
  if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || sync.realpathSync(output) !== output || sync.readdirSync(output).length !== 0) throw Error('全部筛选行填充需要原已存在空的独占输出目录');
  const outputNames = new Set<string>(), frozenJson = new Map<string, { sha256: string; dev: number; ino: number }>(); let publishingConflict = false;
  let retained = false;
  /** 每个await前后核环境、配置与原输出目录，来源清单另行完整复核。 */
  const assertEnvironment = () => {
    environment.assertCurrent(); const current = sync.lstatSync(output);
    const allowed = (name: string) => outputNames.has(name) || publishingConflict && ([tableFilteredUpdateUiConflictFiles.requestTemporary, tableFilteredUpdateUiConflictFiles.ackTemporary] as readonly string[]).includes(name);
    if (hash(sync.readFileSync(configuration)) !== configurationHash || !current.isDirectory() || current.isSymbolicLink() || current.dev !== outputStat.dev || current.ino !== outputStat.ino || sync.realpathSync(output) !== output || sync.readdirSync(output).some(name => !allowed(name))) throw Error('全部筛选行填充配置或输出目录身份变化');
    for (const [name, original] of frozenJson) { const path = join(output, name), stat = sync.lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== original.dev || stat.ino !== original.ino || sync.realpathSync(path) !== path || hash(sync.readFileSync(path)) !== original.sha256) throw Error('全部筛选行填充原冲突请求或回执已漂移'); }
  };
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>();
  const nativeTest = test.extend<{ tableFilteredUpdateSource: { clock: Clock; identity: Identity; check(): void } }>({
    tableFilteredUpdateSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() {
        assertEnvironment(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configuration || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('全部筛选行填充必须原配置、单worker、原120秒及零重试');
      } }, () => nativeTest.info());
      clocks.set(info, clock);
      const check = () => { clock.assertCurrent(); assertEnvironment(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(values.DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST, values.DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256, resolve('.'), {
        stat: path => checked(async () => { const stat = await fs.lstat(path); return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, check));
      if (identity.manifest.kind !== 'source') throw Error('全部筛选行填充只接受批准源码App，不冒充安装包');
      try { await use({ clock, identity, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ tableFilteredUpdateSource }, use) => { await use({ assertCurrent: tableFilteredUpdateSource.check, assertPreparation(info) { if (clocks.get(info) !== tableFilteredUpdateSource.clock) throw Error('全部筛选行填充原启动归属变化'); tableFilteredUpdateSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('全部筛选行填充原App、观察连接或证据未闭合，保留随机库及失败现场'); } });
  nativeTest(multi ? '正式全部筛选行四字段NULL金额原字节整批提交与跨页冲突回滚' : '正式全部筛选行61行整批提交及跨页并发冲突回滚', async ({ tableFilteredUpdateSource, trace, screenshot, video }, info) => {
    const { clock, identity } = tableFilteredUpdateSource, captured = ownedDesktopResources(info), { page, application } = captured, original = application.process(), frame = page.mainFrame(), profileDirectory = dataDir;
    let closed = false, profileIdentity: { dev: number; ino: number } | undefined;
    let observer: Connection | undefined, observerStream: Socket | undefined, observerThread: number | undefined, observerClosed = false, observerClosing = false, observerSawClose = false, observerError: Error | undefined;
    const observerCommands: { callbackReturned: boolean; terminal: boolean }[] = [];
    /** 保持原窗口、PID、profile及物理观察socket；失败后不补退出或另起连接。 */
    const check = () => {
      tableFilteredUpdateSource.check(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== profileDirectory || !closed && (application.process() !== original || page.mainFrame() !== frame || frame.isDetached())) throw Error('全部筛选行填充原桌面身份变化');
      if (profileIdentity) { const stat = sync.lstatSync(profileDirectory); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== profileIdentity.dev || stat.ino !== profileIdentity.ino || sync.realpathSync(profileDirectory) !== profileDirectory) throw Error('全部筛选行填充原profile变化'); }
      if (observer && ((observer as unknown as { stream: Socket }).stream !== observerStream || observerThread !== undefined && observer.threadId !== observerThread || observerError || !observerClosing && (observerClosed ? !observerSawClose || observerStream?.closed !== true : observerSawClose || observerStream?.closed === true))) throw Error('全部筛选行填充原观察线程或物理流变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (error) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw error; } };
    const database = values.DBARK_TEST_DATABASE;
    const statements = Object.freeze({ identity: 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames,@@server_uuid AS uuid,CONNECTION_ID() AS threadId', owner: 'SELECT marker FROM `' + database + '`.`__owner`', rows: plan.rowSql, threads: 'SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ? AND ID<>?' });
    /** 独立观察连接只能执行四条固定SELECT，原callback和Query end均结束后才消费。 */
    const readObserver = (kind: keyof typeof statements): Promise<RowDataPacket[]> => step(() => new Promise((resolveRead, reject) => {
      if (!observer || observerClosed || observerClosing || !Number.isSafeInteger(observerThread) || observerThread! < 1 || observerCommands.some(command => !command.callbackReturned || !command.terminal)) { reject(Error('全部筛选行填充原观察命令归属或前序终态失效')); return; }
      const command = { callbackReturned: false, terminal: false }; observerCommands.push(command); let rows: RowDataPacket[] | undefined, failure: Error | undefined, settled = false;
      const finish = () => { if (settled || !command.callbackReturned || !command.terminal) return; settled = true; if (failure) reject(failure); else if (!Array.isArray(rows)) reject(Error('全部筛选行填充观察结果形状无效')); else resolveRead(rows); };
      const query = observer.query({ sql: statements[kind], values: kind === 'threads' ? [database, observerThread] : [] }, (error, result) => { failure ??= error ?? undefined; rows = result as RowDataPacket[]; command.callbackReturned = true; finish(); });
      query.once('end', () => { command.terminal = true; finish(); }); query.once('error', error => { failure ??= error; finish(); });
    }));
    const assertObserverIdentity = async () => { const rows = await readObserver('identity'); expect(rows).toHaveLength(1); expect(String(rows[0].version).split(/[-+]/)[0]).toBe('8.4.11'); expect(['linux', 'debian-linux-gnu']).toContain(String(rows[0].os).toLowerCase()); expect(String(rows[0].lowerNames)).toBe('0'); expect(rows[0].uuid).toBe(values.DBARK_TEST_EXPECTED_SERVER_UUID); expect(Number(rows[0].threadId)).toBe(observerThread); expect(await readObserver('owner')).toEqual([{ marker: values.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER }]); };
    expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid, parent: process.ppid, platform: process.platform }))); await step(() => identity.assertActual(actual)); assertTableFilteredUpdateUiProcess(actual, original.pid, process.platform); await step(() => identity.assertCurrent());
    const profileStat = await step(() => fs.lstat(profileDirectory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(profileDirectory))).toBe(profileDirectory); profileIdentity = { dev: profileStat.dev, ino: profileStat.ino }; const inside = relative(profileDirectory, output); if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('全部筛选行填充输出不得位于原profile内');
    const mysql = await step(() => import('mysql2')), { closeMysqlConnection } = await step(() => import('../../src/engine/connection'));
    await step(() => new Promise<void>((resolveConnect, reject) => {
      observer = mysql.createConnection({ host: values.DBARK_TEST_HOST, port: 13384, user: values.DBARK_TEST_USER, password: values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); observerStream = (observer as unknown as { stream: Socket }).stream;
      if (!observerStream || typeof observerStream.once !== 'function') { reject(Error('全部筛选行填充原观察物理流未知')); return; }
      observerStream.once('close', () => { observerSawClose = true; }); observer.on('error', error => { observerError = error; retained = true; clock.retain(); retainOwnedDesktopResources(info); }); observer.connect(error => { if (error) { reject(error); return; } observerThread = observer!.threadId; if (!Number.isSafeInteger(observerThread) || observerThread! < 1) reject(Error('全部筛选行填充原观察线程未知')); else resolveConnect(); });
    }));
    await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(plan.expectedInitial);
    await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
    for (const [label, value] of [[zh.connections.text006, '全部筛选行填充本例'], [zh.connections.text009, values.DBARK_TEST_HOST], [zh.connections.text010, '13384'], [zh.common.user, values.DBARK_TEST_USER], [zh.connections.text011, values.DBARK_TEST_PASSWORD], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
    await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden()); const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect({ host: profile.host, port: profile.port, user: profile.user, database: profile.database, rememberPassword: profile.rememberPassword, password: profile.password, ssh: !!profile.ssh?.enabled, tls: !!profile.tls?.enabled }).toEqual({ host: '192.168.31.200', port: 13384, user: values.DBARK_TEST_USER, database, rememberPassword: false, password: undefined, ssh: false, tls: false });
    const browserWindow = await step(() => application.browserWindow(page)), senderId = await step(() => browserWindow.evaluate(window => window.webContents.id)); await step(() => browserWindow.dispose());
    /** 原Main只透传三次完整范围预览、取消释放及两次单次token提交；真实任务事件只旁观不伪造。 */
    await step(() => application.evaluate(({ ipcMain, BrowserWindow }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, originalHandler = handlers.get('dbark:request'), windows = BrowserWindow.getAllWindows().filter(window => window.webContents.id === input.senderId); if (root.__tableFilteredUpdateUi || typeof originalHandler !== 'function' || windows.length !== 1) throw Error('全部筛选行填充原Main或窗口未知');
      const audit = { previews: 0, applies: 0, releases: 0, queryExecuteCount: 0, pending: 0, forbidden: 0, counts: {} as Record<string, number>, previewResults: [] as any[], applyResults: [] as any[], events: [] as any[], pages: [] as any[] }; root.__tableFilteredUpdateUi = audit;
      const contents = windows[0].webContents, originalSend = contents.send;
      const send = function(this: any, channel: string, ...args: any[]) { if (contents.send !== send || this !== contents) throw Error('全部筛选行填充原任务事件出口变化'); const event = args[0]; if (channel === 'dbark:task' && event?.tableFilteredUpdate) audit.events.push(structuredClone({ taskId: event.taskId, status: event.status, tableFilteredUpdate: event.tableFilteredUpdate })); return originalSend.call(contents, channel, ...args); }; contents.send = send; root.__tableFilteredUpdateUiSend = send;
      const normalize = (filters: any[]) => filters.map(rule => ({ column: rule.column, operator: rule.operator, value: rule.value, enabled: rule.enabled !== false }));
      // 原Main请求和值集合完整透传；不接受只保留首列、重排或混入旧接口。
      const assigned = (value: any, second: boolean) => input.multi
        ? !Object.hasOwn(value, 'column') && !Object.hasOwn(value, 'value') && JSON.stringify(value.assignments) === JSON.stringify(second ? input.secondAssignments : input.assignments)
        : !Object.hasOwn(value, 'assignments') && value.column === 'note' && value.value === (second ? input.secondFillValue : input.fillValue);
      const outputColumns = (value: any) => input.multi ? !Object.hasOwn(value, 'column') && JSON.stringify(value.columns) === JSON.stringify(input.fields) : !Object.hasOwn(value, 'columns') && value.column === 'note';
      const applyTokens = new Set<string>();
      const wrapped = async (event: any, payload: any) => {
        if (event.sender.id !== input.senderId || handlers.get('dbark:request') !== wrapped || contents.send !== send) throw Error('全部筛选行填充原Main或任务观察变化');
        const command = payload.command, value = payload.input; audit.counts[command] = (audit.counts[command] ?? 0) + 1;
        if (command.startsWith('query.execute')) audit.queryExecuteCount++;
        if (command.startsWith('schema.') || command.startsWith('files.') || command.startsWith('excel.') || command.startsWith('binaryCellFiles.') || command.startsWith('result.insert') || command.startsWith('query.execute') || ['table.apply', 'table.preview', 'query.transaction', 'query.exportStream', 'table.exportFiltered'].includes(command)) { audit.forbidden++; throw Error('全部筛选行填充禁止额外产品执行或写入'); }
        if (['metadata.objects', 'metadata.table', 'table.page'].includes(command) && (value.connectionId !== input.connectionId || value.database !== input.database || value.table !== undefined && value.table !== 'subject')) throw Error('全部筛选行填充原表目标变化');
        let previewIndex: number | undefined, applyIndex: number | undefined, entry: any;
        if (command === 'table.page') { entry = { input: structuredClone({ page: value.page, pageSize: value.pageSize, filters: value.filters, filterMode: value.filterMode, filterGroup: value.filterGroup, sort: value.sort }) }; audit.pages.push(entry); }
        if (command === 'table.filteredUpdate.preview') {
          previewIndex = audit.previews++;
          if (previewIndex >= 3 || audit.previewResults.length !== previewIndex || value.connectionId !== input.connectionId || value.database !== input.database || value.table !== 'subject' || !assigned(value, previewIndex === 2) || JSON.stringify(normalize(value.filters)) !== JSON.stringify(normalize(input.filters)) || value.filterMode !== 'all' || JSON.stringify(value.filterGroup) !== JSON.stringify(input.filterGroup) || JSON.stringify(value.sort) !== JSON.stringify(input.sort) || typeof value.metadataKey !== 'string' || !value.metadataKey || ['page', 'pageSize', 'limit', 'offset'].some(key => Object.hasOwn(value, key))) throw Error('全部筛选行填充完整范围或typed值变化');
        }
        if (command === 'table.filteredUpdate.release') { audit.releases++; if (audit.releases !== 1 || value.connectionId !== input.connectionId || value.previewToken !== audit.previewResults[0]?.previewToken || audit.applies !== 0) throw Error('全部筛选行填充只准取消原第一份预览'); }
        if (command === 'table.filteredUpdate.apply') {
          applyIndex = audit.applies++; const expected = audit.previewResults[applyIndex + 1];
          if (applyIndex >= 2 || !expected || value.connectionId !== input.connectionId || value.previewToken !== expected.previewToken || applyTokens.has(value.previewToken) || value.confirmation !== input.confirmation || value.acknowledged !== true || Object.keys(value).sort().join() !== 'acknowledged,confirmation,connectionId,previewToken,taskId') throw Error('全部筛选行填充禁止更换准确确认或重放令牌'); applyTokens.add(value.previewToken);
          audit.applyResults.push({ taskId: value.taskId, previewToken: value.previewToken, pending: true });
        }
        audit.pending++;
        try {
          const reply = await originalHandler(event, payload);
          if (command === 'table.page') { if (!reply?.ok || !Array.isArray(reply.result?.rows)) throw Error('全部筛选行填充原表页失败'); entry.ids = reply.result.rows.map((row: any) => String(row.id)); entry.hasMore = reply.result.hasMore; }
          if (command === 'table.filteredUpdate.preview') {
            const preview = reply?.result;
            if (!reply?.ok || preview.rows !== 61 || preview.shownRows !== 10 || preview.sampleOmitted !== true || preview.target?.connectionId !== input.connectionId || preview.target.database !== input.database || preview.target.table !== 'subject' || !outputColumns(preview) || preview.assignmentDigest !== (previewIndex === 2 ? input.secondDigest : input.firstDigest) || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(preview.previewToken) || audit.previewResults.some(item => item.previewToken === preview.previewToken) || typeof preview.sql !== 'string' || preview.sql.match(/UPDATE /g)?.length !== 10 || !preview.sql.includes('subject') || preview.sql.includes(input.disabledValue)) throw Error('全部筛选行填充真实61行完整范围或有限样本失配'); audit.previewResults.push(structuredClone(preview));
          }
          if (command === 'table.filteredUpdate.apply') {
            if (applyIndex === 0 ? !reply?.ok || reply.result?.rows !== 61 || !outputColumns(reply.result) || reply.result.commitAcknowledged !== true || reply.result.outcome !== 'committed' : reply?.ok !== false || typeof reply.error !== 'string' || !reply.error) throw Error('全部筛选行填充真实提交或冲突回执失配'); audit.applyResults[applyIndex!] = { ...audit.applyResults[applyIndex!], pending: false, reply: structuredClone(reply) };
          }
          if (command === 'table.filteredUpdate.release' && !reply?.ok) throw Error('全部筛选行填充原取消预览未释放');
          return reply;
        } finally { audit.pending--; }
      };
      handlers.set('dbark:request', wrapped); root.__tableFilteredUpdateUiHandler = wrapped;
    }, { senderId, connectionId: profile.id, database, filters: plan.filters, filterGroup: plan.filterGroup, sort: plan.sort, fillValue: plan.fillValue, secondFillValue: plan.secondFillValue, disabledValue: plan.filters[3].value, multi, fields, confirmation, assignments: multiPlan.assignments, secondAssignments: multiPlan.secondAssignments, firstDigest: assignmentDigest(false), secondDigest: assignmentDigest(true) }));
    const state = () => step(() => application.evaluate(({ ipcMain, BrowserWindow }, id) => { const root = globalThis as any, window = BrowserWindow.getAllWindows().find(window => window.webContents.id === id); if ((ipcMain as any)._invokeHandlers.get('dbark:request') !== root.__tableFilteredUpdateUiHandler || window?.webContents.send !== root.__tableFilteredUpdateUiSend) throw Error('全部筛选行填充原Main审计变化'); return structuredClone(root.__tableFilteredUpdateUi) as Audit; }, senderId));
    const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); await step(() => node.locator('.database-row').getByRole('button', { name: database, exact: true }).click()); await step(() => node.locator('.object-row').getByRole('button', { name: 'subject', exact: true }).click());
    const table = page.locator('.table-tab:visible'), action = table.locator('.table-action-bar'), grid = table.getByRole('grid');
    /** 每次表单变更必须等真实新回包；不能用旧DOM或请求计数冒充表页已更新。 */
    const settled = async (count?: number) => { if (count !== undefined) await step(() => expect.poll(async () => (await state()).pages.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pages.at(-1)?.ids !== undefined).toBe(true)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0)); };
    await step(() => expect(grid).toBeVisible()); await settled(); let pageCount = (await state()).pages.length;
    if (await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).inputValue()) !== '50') { await step(() => action.getByRole('combobox', { name: zh.table.text021, exact: true }).selectOption('50')); await settled(pageCount + 1); }
    await step(() => table.getByRole('button', { name: zh.table.text006, exact: true }).click()); const filterForm = table.locator('.filter-rule-form');
    const addRule = async (column: string, operator: string, value: string) => { await step(() => filterForm.getByRole('combobox', { name: zh.table.text009, exact: true }).selectOption(column)); await step(() => filterForm.getByRole('combobox', { name: zh.table.filterOperatorLabel, exact: true }).selectOption(operator)); await step(() => filterForm.getByRole('textbox', { name: zh.table.text011, exact: true }).fill(value)); const count = (await state()).pages.length; await step(() => filterForm.getByRole('button', { name: zh.table.text013, exact: true }).click()); await settled(count + 1); };
    for (const rule of plan.filters) await addRule(rule.column, rule.operator, rule.value);
    pageCount = (await state()).pages.length; await step(() => table.getByRole('checkbox', { name: enabled.enabled(4), exact: true }).uncheck()); await settled(pageCount + 1);
    await step(() => table.getByRole('button', { name: groups.open, exact: true }).click()); const grouping = table.getByRole('region', { name: groups.title, exact: true }); await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode(), exact: true })).toHaveValue('all')); await step(() => grouping.getByRole('button', { name: groups.addGroup(), exact: true }).click()); await step(() => expect(grouping.getByRole('combobox', { name: groups.groupMode('1'), exact: true })).toHaveValue('any')); for (const index of [1, 2]) await step(() => grouping.getByRole('combobox', { name: groups.destination(index), exact: true }).selectOption({ label: groups.group('1') })); pageCount = (await state()).pages.length; await step(() => grouping.getByRole('button', { name: groups.apply, exact: true }).click()); await settled(pageCount + 1);
    await step(() => table.getByRole('button', { name: sortingText.entry, exact: true }).click()); const sorting = table.getByRole('region', { name: sortingText.title, exact: true }); for (const [index, column] of ['label', 'id'].entries()) { await step(() => sorting.getByRole('button', { name: sortingText.add, exact: true }).click()); await step(() => sorting.getByRole('combobox', { name: sortingText.field(index + 1), exact: true }).selectOption(column)); } await step(() => sorting.getByRole('combobox', { name: sortingText.direction(2), exact: true }).selectOption('DESC')); pageCount = (await state()).pages.length; await step(() => sorting.getByRole('button', { name: sortingText.apply, exact: true }).click()); await settled(pageCount + 1);
    expect((await state()).pages.at(-1)?.ids).toEqual(plan.expectedFilteredIds.slice(0, 50)); pageCount = (await state()).pages.length; await step(() => table.getByRole('button', { name: zh.common.pageNext, exact: true }).click()); await settled(pageCount + 1); const parentPage = (await state()).pages.at(-1)!; expect(parentPage.ids).toEqual(plan.expectedSecondPageIds); expect(parentPage.hasMore).toBe(false); expect(parentPage.input).toMatchObject({ page: 2, pageSize: 50, filters: plan.filters, filterMode: 'all', filterGroup: plan.filterGroup, sort: plan.sort });
    const assertParent = async () => { await step(() => expect(action.getByText(zh.table.text023 + '2' + zh.table.text024, { exact: true })).toBeVisible()); await step(() => expect(grid).toHaveAttribute('aria-rowcount', '12')); const current = (await state()).pages.at(-1)!; expect(current.input).toEqual(parentPage.input); expect(current.ids).toEqual(parentPage.ids); expect(current.hasMore).toBe(false); };
    const dialog = page.getByRole('dialog', { name: text.title, exact: true }), screenshots: { path: string; sha256: string }[] = [];
    const capture = async (name: string) => { const path = join(output, name); expect(sync.existsSync(path)).toBe(false); outputNames.add(name); await step(() => dialog.screenshot({ path })); const sha256 = hash(await step(() => fs.readFile(path))); screenshots.push({ path, sha256 }); await step(() => info.attach(name, { path, contentType: 'image/png' })); };
    /** 从真实独立字段编辑器填写typed值；NULL不伪装成字符串，二进制走原Hex输入。 */
    const fillAssignment = async (item: typeof multiPlan.assignments[number], index: number) => {
      const group = dialog.getByRole('group', { name: text.assignment(index + 1), exact: true });
      await step(() => group.getByRole('combobox', { name: index ? text.columnAt(index + 1) : text.column, exact: true }).selectOption(item.column));
      const binary = typeof item.value === 'object' && item.value !== null, mode = item.value === null ? 'null' : binary ? 'binary' : 'text';
      await step(() => group.getByRole('combobox', { name: recordText.mode, exact: true }).selectOption(mode));
      const editor = group.getByRole('textbox', { name: item.column + ' · ' + recordText.value, exact: true });
      if (mode === 'null') await step(() => expect(editor).toHaveAttribute('readonly', ''));
      else await step(() => editor.fill(binary ? Buffer.from((item.value as { base64: string }).base64, 'base64').toString('hex').toUpperCase() : String(item.value)));
    };
    /** 只有真实选择普通字段、输入值和点击预览才能得到原Main令牌；打开本身不读取全范围。 */
    const preview = async (value: string, count: number) => {
      const before = await state(); await step(() => table.getByRole('button', { name: text.entry, exact: true }).click()); await step(() => expect(dialog).toBeVisible()); await step(() => expect(page.locator('[data-table-filtered-update-dialog]')).toHaveCount(1)); expect((await state()).previews).toBe(before.previews); await step(() => expect(dialog.getByRole('region', { name: text.conditions, exact: true })).toContainText(text.disabledRule)); await step(() => expect(dialog.getByRole('region', { name: text.sorts, exact: true })).toContainText('label ASC')); await step(() => expect(dialog.getByRole('region', { name: text.sorts, exact: true })).toContainText('id DESC'));
      if (multi) {
        const assignments = count === 3 ? multiPlan.secondAssignments : multiPlan.assignments;
        for (const [index, item] of assignments.entries()) { if (index) await step(() => dialog.getByRole('button', { name: text.add, exact: true }).click()); await fillAssignment(item, index); }
        await step(() => expect(dialog.locator('fieldset')).toHaveCount(4));
        // toBeDisabled沿label重定向到可用的select；应直接核原option，避免把父控件状态当成选项状态。
        const duplicate = dialog.getByRole('combobox', { name: text.columnAt(2), exact: true }).locator('option[value="note"]');
        await step(() => expect(duplicate).toHaveAttribute('disabled', ''));
        await step(() => expect(duplicate).toHaveJSProperty('disabled', true));
        if (count === 1) { await step(() => dialog.getByRole('button', { name: text.remove('side_note'), exact: true }).click()); await step(() => expect(dialog.locator('fieldset')).toHaveCount(3)); await step(() => dialog.getByRole('button', { name: text.add, exact: true }).click()); await fillAssignment(assignments[3], 3); }
        expect((await state()).previews).toBe(before.previews);
      } else { await step(() => dialog.getByRole('combobox', { name: text.column, exact: true }).selectOption('note')); await step(() => dialog.getByRole('textbox', { name: 'note · 字段内容', exact: true }).fill(value)); }
      await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect.poll(async () => (await state()).previewResults.length).toBe(count)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(dialog.getByText(text.sample(10, 61), { exact: true })).toBeVisible()); await step(() => expect(dialog.getByLabel(text.sql, { exact: true })).toBeVisible()); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      return (await state()).previewResults[count - 1];
    };
    const confirm = async () => { await step(() => dialog.getByRole('textbox', { name: text.confirmation, exact: true }).fill(confirmation)); await step(() => dialog.getByRole('checkbox', { name: text.acknowledge, exact: true }).check()); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeEnabled()); await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); };
    await preview(plan.fillValue, 1); expect(await readObserver('rows')).toEqual(plan.expectedInitial); expect((await state()).applies).toBe(0); await capture('全部筛选行填充-取消预览.png'); await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await step(() => expect.poll(async () => (await state()).releases).toBe(1)); await step(() => expect.poll(async () => (await state()).pending).toBe(0)); await assertParent(); expect(await readObserver('rows')).toEqual(plan.expectedInitial);
    await preview(plan.fillValue, 2); expect(await readObserver('rows')).toEqual(plan.expectedInitial); await confirm(); await step(() => expect(dialog.getByText(text.committed(61), { exact: true })).toBeVisible()); expect(await readObserver('rows')).toEqual(plan.expectedAfterFill); await capture('全部筛选行填充-确认61行.png'); pageCount = (await state()).pages.length; await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await settled(pageCount + 1); await assertParent();
    const third = await preview(plan.secondFillValue, 3); expect(await readObserver('rows')).toEqual(plan.expectedAfterFill);
    /** 请求和回执只以两个准确临时名原子发布；JSON原inode和SHA随后纳入永久来源守卫。 */
    const request = tableFilteredUpdateUiConflictRequest(database, values.DBARK_TABLE_FILTERED_UPDATE_UI_OWNER, third.previewToken), requestBytes = Buffer.from(JSON.stringify(request) + '\n'), requestSha256 = hash(requestBytes), files = tableFilteredUpdateUiConflictFiles;
    publishingConflict = true; outputNames.add(files.request); outputNames.add(files.ack); expect(sync.existsSync(join(output, files.request))).toBe(false); expect(sync.existsSync(join(output, files.ack))).toBe(false);
    await step(() => fs.writeFile(join(output, files.requestTemporary), requestBytes, { flag: 'wx' })); await step(() => fs.rename(join(output, files.requestTemporary), join(output, files.request)));
    const freezeJson = async (name: string, expectedSha?: string) => { const path = join(output, name), stat = await step(() => fs.lstat(path)); expect(stat.isFile() && !stat.isSymbolicLink()).toBe(true); expect(stat.size).toBeLessThan(4096); expect(await step(() => fs.realpath(path))).toBe(path); const bytes = await step(() => fs.readFile(path)), sha256 = hash(bytes); if (expectedSha) expect(sha256).toBe(expectedSha); frozenJson.set(name, { sha256, dev: stat.dev, ino: stat.ino }); check(); return bytes; };
    await freezeJson(files.request, requestSha256); await step(() => expect.poll(() => sync.existsSync(join(output, files.ack))).toBe(true)); const ackBytes = await freezeJson(files.ack), conflictAck: TableFilteredUpdateUiConflictAck = parseTableFilteredUpdateUiConflictAck(JSON.parse(ackBytes.toString('utf8')), request, requestSha256, observerThread!); publishingConflict = false; check(); expect(sync.existsSync(join(output, files.requestTemporary))).toBe(false); expect(sync.existsSync(join(output, files.ackTemporary))).toBe(false); expect(await readObserver('rows')).toEqual(plan.expectedAfterConflict); expect((await state()).applies).toBe(1);
    await confirm(); await step(() => expect(dialog.getByRole('alert')).toContainText(text.rolledBack)); await step(() => expect(dialog.getByRole('paragraph').filter({ hasText: text.consumed })).toBeVisible()); await step(() => expect(dialog.getByRole('paragraph').filter({ hasText: text.consumed })).toHaveText(text.consumed)); expect(await readObserver('rows')).toEqual(plan.expectedAfterConflict); const failure = (await state()).applyResults[1]; const rollback = (await state()).events.filter(event => event.taskId === failure.taskId).at(-1)?.tableFilteredUpdate; expect(rollback).toMatchObject({ rows: 30, totalRows: 61, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: true, transactionProtected: true, outcome: 'rolled-back' }); await capture('全部筛选行填充-冲突整批回滚.png'); await step(() => dialog.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(dialog).toBeHidden()); await assertParent();
    const final = await state(); expect({ previews: final.previews, applies: final.applies, releases: final.releases, queryExecuteCount: final.queryExecuteCount, pending: final.pending, forbidden: final.forbidden }).toEqual({ previews: 3, applies: 2, releases: 1, queryExecuteCount: 0, pending: 0, forbidden: 0 }); expect(pageErrors).toEqual([]);
    await step(() => identity.assertCurrent()); await confirmOwnedDesktopExit(info); closed = true; check(); expect(original.exitCode).toBe(0); expect(dialogCalls).toEqual([]); await step(() => identity.assertCurrent()); await assertObserverIdentity(); expect(await readObserver('rows')).toEqual(plan.expectedAfterConflict); expect(await readObserver('threads')).toEqual([]); expect(observerCommands.every(command => command.callbackReturned && command.terminal)).toBe(true); observerClosing = true; await step(() => closeMysqlConnection(observer!, true)); observerClosed = true; observerClosing = false; check(); expect(observerSawClose).toBe(true); expect(observerStream!.closed).toBe(true); await step(() => identity.assertCurrent());
    await step(() => info.attach('全部筛选行批量填充正式专项终态', { body: Buffer.from(JSON.stringify({ kind: 'dbark.table-filtered-update-ui', mode, fields, assignments: multi ? multiPlan.assignments : undefined, actualApp: actual, database, originalPage: 2, pageSize: 50, originalPageRows: 11, totalRows: 81, matchedRows: 61, untouchedRows: 20, field: multi ? undefined : 'note', cancelledPreviewNoWrites: true, confirmedRows: 61, originalPageFilterSortPreserved: true, exactAllRowsAndOtherColumnsVerified: true, conflictAttemptedRowsBeforeRollback: 30, conflictRollbackAcknowledged: true, noAutomaticReplay: true, conflictRequest: { ...request, requestSha256 }, conflictAck, conflictFiles: Object.fromEntries([...frozenJson].map(([name, value]) => [name, value.sha256])), audit: final, screenshots, normalExit: true, originalProcessExitCode: original.exitCode, observerReadOnly: true, observerClosed, observerCommandsEnded: true, controlThreadId: observerThread, rootControlThreadId: conflictAck.controlThreadId, targetThreadsAfterExit: 0, databaseRetainedForRoot: true, sourceManifest: values.DBARK_TABLE_FILTERED_UPDATE_UI_MANIFEST_SHA256, mainIpcAuditScope: '原窗口原handler及原事件出口旁观；完整条件分组/停用/多列排序、三次61行预览、一取消释放、两次真实确认；Root单次准确CAS后30行更新冲突整批回滚', systemClipboard: 0, systemFileDialogInput: 0, nativeInputVerified: false, installerVerified: false, macOSVerified: false })), contentType: 'application/json' })); finished.add(info);
  });
}
