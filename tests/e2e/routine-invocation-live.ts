import { clickSidebarAction, sidebarMenuItem } from './sidebar-menu';
import type { Locator, TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { closeMysqlConnection } from '../../src/engine/connection';
import type { QueryOutcome, QueryResult } from '../../src/shared/contracts';
import type { QueryParameter, QueryParameterType } from '../../src/shared/queryParameters';
import type { RoutineInvocationMetadata } from '../../src/shared/routineInvocation';
import { zh } from '../../src/renderer/locales/zh-CN';
import { parameterZh } from '../../src/renderer/locales/queryParameters.zh-CN';
import { routineInvocationZh as text } from '../../src/renderer/locales/routineInvocation.zh-CN';
import { assertTableDraftProcesslistVisible, assertTableDraftProcesslistWarnings, selectTableDraftProcesslist, tableDraftProcesslistQuery, type TableDraftProcesslistPolicy, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';

const uuid = 'f568f70e-c730-11f1-8190-3e6c830dde01';
const names = ['echo_mixed', 'exact_add', 'ping0', 'out_only'] as const;
type RoutineName = typeof names[number];
interface Resource {
  version: 1; kind: 'dbark.routine-invocation-fixture'; database: string; ownerNonce: string; host: string; networkPort: 13384;
  server: { hostname: string; port: number; serverId: number; uuid: typeof uuid; version: '8.4.11' };
  routines: { name: RoutineName; kind: 'procedure' | 'function'; ddlSha256: string }[];
  audit: { name: 'audit'; ownerComment: string; ddlSha256: string; initialCount: 0 };
}
interface Fact { command: string; phase: RoutineName | 'idle'; taskId?: string; ok: boolean; result?: QueryOutcome | RoutineInvocationMetadata; }
const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_ROUTINE_INVOCATION_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST', 'DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST_SHA256'] as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
const kindOf = (name: RoutineName) => name === 'exact_add' ? 'function' as const : 'procedure' as const;
const executeFile = promisify(execFile);

/** 只归一化身份整数，业务UINT64/DECIMAL/微秒文本始终保持原值。 */
function identityInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === 'string' && (value.length > 16 || !/^[1-9]\d*$/.test(value)) || typeof value !== 'string' && typeof value !== 'number') throw Error('例程验收身份数值无效');
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw Error('例程验收身份整数越界');
  return parsed;
}

/** 仅消费Root显式提供的原清单与DBARK_TEST值，不从缓存、SSH或凭据文件回填。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>, args = JSON.stringify(process.argv);
  let failed = false;
  const check = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('例程验收原环境已变化');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_ROUTINE_INVOCATION_UI !== '1' || !['deve-server.yinzon.com', '192.168.31.200'].includes(values.DBARK_TEST_HOST ?? '') || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || !values.DBARK_TEST_PASSWORD || values.DBARK_TEST_EXPECTED_SERVER_UUID !== uuid || !/^dbark_e2e_call_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('例程验收必须使用已批准200/13384的本例隔离资源');
      if (!isAbsolute(values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST ?? '') || !/^[a-f0-9]{64}$/.test(values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST_SHA256 ?? '')) throw Error('例程验收缺少Root原资源清单与摘要');
    } catch (reason) { failed = true; throw reason; }
  };
  check(); return { values, check };
}

/** 清单规定准确四例程与一张空审计表；测试本身不建资源、不CALL预置、不DROP。 */
function readResource(environment: ReturnType<typeof bindEnvironment>): Resource {
  environment.check(); const path = environment.values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST!, stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('例程资源清单不是有界普通文件');
  const bytes = fs.readFileSync(path); if (hash(bytes) !== environment.values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST_SHA256) throw Error('例程资源清单字节变化');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Resource;
  if (!value || Object.keys(value).sort().join() !== 'audit,database,host,kind,networkPort,ownerNonce,routines,server,version' || value.version !== 1 || value.kind !== 'dbark.routine-invocation-fixture' || value.database !== environment.values.DBARK_TEST_DATABASE || !/^[a-f0-9]{32}$/.test(value.ownerNonce) || value.host !== environment.values.DBARK_TEST_HOST || value.networkPort !== 13384 || !value.server || Object.keys(value.server).sort().join() !== 'hostname,port,serverId,uuid,version' || !value.server.hostname || value.server.uuid !== uuid || value.server.version !== '8.4.11') throw Error('例程资源清单与批准身份不符');
  identityInteger(value.server.port, 65535); identityInteger(value.server.serverId, 0xffffffff);
  if (!Array.isArray(value.routines) || value.routines.length !== names.length) throw Error('例程预置对象集合不完整');
  for (const [index, name] of names.entries()) { const routine = value.routines[index]; if (!routine || Object.keys(routine).sort().join() !== 'ddlSha256,kind,name' || routine.name !== name || routine.kind !== kindOf(name) || !/^[a-f0-9]{64}$/.test(routine.ddlSha256)) throw Error('例程原定义摘要或类型未知'); }
  if (!value.audit || Object.keys(value.audit).sort().join() !== 'ddlSha256,initialCount,name,ownerComment' || value.audit.name !== 'audit' || value.audit.initialCount !== 0 || value.audit.ownerComment !== `dbark-call:${value.ownerNonce}:audit` || !/^[a-f0-9]{64}$/.test(value.audit.ddlSha256)) throw Error('例程原审计表不匹配');
  return value;
}

/** 每种调用脚本独立声明，不能借产品builder产生期望再自证SQL。 */
function expectedSql(database: string, name: RoutineName, actual: string): string {
  const target = quote(database) + '.' + quote(name);
  if (name === 'exact_add') return `SELECT ${target}(:arg_1) AS \`return_value\`;`;
  if (name === 'ping0') return `CALL ${target}();`;
  const matched = /@dbark_call_([a-f0-9]{32})_/.exec(actual); if (!matched) throw Error('例程草稿缺少本次独有变量名');
  const variable = (ordinal: number) => '@dbark_call_' + matched[1] + '_' + ordinal;
  if (name === 'out_only') return `SET ${variable(1)} = NULL;\nCALL ${target}(${variable(1)});\nSELECT ${variable(1)} AS \`out_1\`;\nSET ${variable(1)} = NULL;`;
  return `SET ${variable(6)} = :arg_6, ${variable(7)} = NULL, ${variable(8)} = NULL;\nCALL ${target}(:arg_1, :arg_2, :arg_3, :arg_4, :arg_5, ${variable(6)}, ${variable(7)}, ${variable(8)});\nSELECT ${variable(6)} AS \`out_6\`, ${variable(7)} AS \`out_7\`, ${variable(8)} AS \`out_8\`;\nSET ${variable(6)} = NULL, ${variable(7)} = NULL, ${variable(8)} = NULL;`;
}

/** 参数值仅供本例明确执行许可及真实控件填写；不是数据库凭据，不写入工作区。 */
function parameters(name: RoutineName): QueryParameter[] {
  if (name === 'exact_add') return [{ name: 'arg_1', type: 'decimal', value: '12.3400000000' }];
  if (name !== 'echo_mixed') return [];
  return [{ name: 'arg_1', type: 'integer', value: '18446744073709551615' }, { name: 'arg_2', type: 'decimal', value: '12345678901234567890.1234567890' }, { name: 'arg_3', type: 'datetime', value: '2026-10-28 12:34:56.123456' }, { name: 'arg_4', type: 'null' }, { name: 'arg_5', type: 'binary', value: '00ff00' }, { name: 'arg_6', type: 'decimal', value: '0.8765432110' }];
}

/** 用正式列key读取原回包；重名/缺列/截断不能靠UI显示文字掩盖。 */
function values(result: QueryResult, columns: string[]): unknown[][] {
  expect(result.truncated).toBe(false); expect(result.columns.map(column => column.name)).toEqual(columns); expect(new Set(result.columns.map(column => column.key)).size).toBe(columns.length);
  return result.rows.map(row => result.columns.map(column => { expect(Object.hasOwn(row, column.key)).toBe(true); return row[column.key]; }));
}

/** 只登记一个120秒、零重试、严格归属的真实窗口整例；失败保留库、App和观察连接。 */
export function registerRoutineInvocationUi(): void {
  const environment = bindEnvironment(); let retained = false, complete = false;
  const guard = () => { environment.check(); readResource(environment); const info = test.info(); if (retained || info.config.workers !== 1 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('例程验收要求原单worker、零重试及零重复'); };
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' });
  test.describe.configure({ mode: 'serial', retries: 0 }); test.setTimeout(120000);
  test.afterEach(({}, info) => { if (!complete) { retained = true; retainOwnedDesktopResources(info); throw Error('例程原整例尚未完成，保留所属现场'); } });
  test('过程IN/OUT/INOUT、精确函数、零参数和仅OUT：草稿零执行后逐一明确调用', async ({ trace, screenshot, video }, info: TestInfo) => {
    const resource = readResource(environment), original = ownedDesktopResources(info), application = original.application, page = original.page, originalProcess = application.process(), directory = dataDir, frame = page.mainFrame();
    const clock = bindEditorIndentNativeCase(info, { assertCurrent: guard }, () => test.info());
    let closed = false, observer: Connection | undefined, observerClosed = false, observerFailed = false, observerThread = 0, observerStream: any, processlist: TableDraftProcesslistPolicy | undefined, auditInstalled = false;
    const resourceDiagnostics: { source: string; warnings: unknown }[] = [];
    const check = () => { clock.assertCurrent(); const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observerFailed) throw Error('例程原App、文档或观察连接归属已变化'); };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); const value = await action(); check(); return value; };
    const database = resource.database, qualify = (name: string) => quote(database) + '.' + quote(name);
    const sql = {
      identity: 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@server_uuid AS uuid,@@version AS version,CONNECTION_ID() AS threadId',
      capability: 'SELECT @@performance_schema AS enabled',
      routines: 'SELECT ROUTINE_NAME AS name,LOWER(ROUTINE_TYPE) AS kind FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=? ORDER BY ROUTINE_NAME',
      tables: 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS ownerComment FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      auditDdl: 'SHOW CREATE TABLE ' + qualify('audit'),
      audit: 'SELECT id,marker FROM ' + qualify('audit') + ' ORDER BY id',
      ...Object.fromEntries(names.map(name => ['ddl_' + name, 'SHOW CREATE ' + kindOf(name).toUpperCase() + ' ' + qualify(name)])),
    };
    const read = async (statement: string, inputs: (string | number)[] = []): Promise<RowDataPacket[]> => {
      if (!Object.values(sql).includes(statement) || (statement === sql.routines || statement === sql.tables ? inputs.length !== 1 || inputs[0] !== database : inputs.length !== 0)) throw Error('例程观察SQL不属于准确只读集合');
      return step(() => new Promise((resolveRead, reject) => observer!.query({ sql: statement, values: inputs }, (error, rows) => error ? reject(error) : resolveRead(rows as RowDataPacket[]))));
    };
    const resources = async (request: TableDraftProcesslistRequest): Promise<RowDataPacket[]> => {
      if (!processlist || request.kind === 'database' || request.kind === 'ids' && (request.ids.length !== 1 || request.ids[0] !== observerThread) || request.kind === 'collect' && (request.database !== database || request.excludeId !== observerThread)) throw Error('例程资源核验只限本库和原观察线程');
      const selected = tableDraftProcesslistQuery(processlist, request);
      const query = (statement: string, values: (string | number)[] = []) => step(() => new Promise<RowDataPacket[]>((resolveRead, reject) => observer!.query({ sql: statement, values }, (error, rows) => error ? reject(error) : resolveRead(rows as RowDataPacket[]))));
      const rows = await query(selected.sql, selected.values), counts = await query('SHOW COUNT(*) WARNINGS'), warnings = await query('SHOW WARNINGS LIMIT 2');
      assertTableDraftProcesslistWarnings(processlist, counts, warnings); resourceDiagnostics.push({ source: processlist.source, warnings }); return rows;
    };
    try {
      guard(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      await step(() => info.attach('例程原启动线索', { body: JSON.stringify({ directory, launcherPid: originalProcess.pid, database, resourceSha256: environment.values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST_SHA256 }), contentType: 'application/json' }));
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), pid: process.pid, userData: app.getPath('userData'), packaged: app.isPackaged, browserPids: app.getAppMetrics().filter(metric => metric.type === 'Browser').map(metric => metric.pid) })));
      await step(() => info.attach('例程原Main身份', { body: JSON.stringify(actual), contentType: 'application/json' }));
      expect(actual.packaged).toBe(false); expect(fs.realpathSync(actual.executable)).toBe(fs.realpathSync(require('electron') as string)); expect(fs.realpathSync(actual.appPath)).toBe(fs.realpathSync(resolve('.'))); expect(fs.realpathSync(actual.userData)).toBe(fs.realpathSync(directory)); expect(actual.browserPids).toEqual([actual.pid]);
      const launcherPid = identityInteger(originalProcess.pid); let launcherLineage: unknown;
      if (actual.pid !== launcherPid) {
        const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter 'ProcessId = ${launcherPid} OR ProcessId = ${identityInteger(actual.pid)}' | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; executable=$_.ExecutablePath; createdUtc=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`;
        const recorded = await step(() => executeFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 })); expect(recorded.stderr).toBe('');
        const rows = JSON.parse(recorded.stdout.replace(/^\uFEFF/, '').trim()) as { pid: number; parentPid: number; executable: string; createdUtc: string }[]; expect(rows).toHaveLength(2);
        const main = rows.find(row => row.pid === actual.pid), launcher = rows.find(row => row.pid === launcherPid); expect(main).toBeDefined(); expect(launcher).toBeDefined(); expect(main!.parentPid).toBe(launcherPid); expect(fs.realpathSync(main!.executable)).toBe(fs.realpathSync(actual.executable)); expect(Number.isFinite(Date.parse(launcher!.createdUtc)) && Number.isFinite(Date.parse(main!.createdUtc)) && Date.parse(launcher!.createdUtc) <= Date.parse(main!.createdUtc)).toBe(true); launcherLineage = rows;
      }
      const mysql = require('mysql2') as typeof import('mysql2');
      observer = mysql.createConnection({ host: resource.host, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, database, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, multipleStatements: false, connectTimeout: 10000 });
      observerStream = (observer as any).stream; observer.on('error', () => { observerFailed = true; }); await step(() => new Promise<void>((resolveConnect, reject) => observer!.connect(error => error ? reject(error) : resolveConnect()))); observerThread = identityInteger(observer.threadId);
      const server = await read(sql.identity); expect(server).toHaveLength(1); expect({ ...server[0], port: identityInteger(server[0].port, 65535), serverId: identityInteger(server[0].serverId, 0xffffffff), threadId: identityInteger(server[0].threadId) }).toEqual({ ...resource.server, threadId: observerThread });
      processlist = selectTableDraftProcesslist('mysql', resource.server.version, await read(sql.capability)); assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread);
      expect(await read(sql.routines, [database])).toEqual([...resource.routines].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, kind }) => ({ name, kind })));
      expect(await read(sql.tables, [database])).toEqual([{ name: 'audit', ownerComment: resource.audit.ownerComment }]);
      for (const routine of resource.routines) { const shown = await read(sql['ddl_' + routine.name as keyof typeof sql]); expect(shown).toHaveLength(1); expect(hash(shown[0][routine.kind === 'function' ? 'Create Function' : 'Create Procedure'])).toBe(routine.ddlSha256); }
      const auditDdl = await read(sql.auditDdl); expect(auditDdl).toHaveLength(1); expect(hash(auditDdl[0]['Create Table'])).toBe(resource.audit.ddlSha256); expect(await read(sql.audit)).toEqual([]);
      await step(() => page.locator('.navigation-toolbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '例程调用本例'], [zh.connections.text009, resource.host], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0]; expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined(); expect(profile.database).toBe(database); expect(profile.port).toBe(13384);
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click());
      const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      await step(() => clickSidebarAction(databaseRow, { name: zh.sidebar.text016, exact: true }, undefined, check)); const query = () => page.locator('.query-tab:visible'); const sourceSql = '-- 原查询保持，尚未执行\nSELECT 123 AS untouched;';
      await step(() => expect(query().locator('.monaco-editor').getByRole('textbox')).toBeVisible()); await step(() => query().locator('.monaco-editor').getByRole('textbox').focus()); await step(() => query().locator('.monaco-editor').getByRole('textbox').evaluate((element, value) => { const transfer = new DataTransfer(); transfer.setData('text/plain', value); element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })); }, sourceSql));
      await step(() => expect.poll(async () => { const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n'); }).toBe(sourceSql));
      const initialSettings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), sourceTab = initialSettings.tabs.find(tab => tab.id === initialSettings.activeTabId)!; expect(sourceTab.kind).toBe('query'); const sourceResult = await step(() => query().locator('.result-body').innerText());
      // 后续Main旁观在此安装，只透传原handler；准备阶段不计入“草稿零执行”的观察范围。
      await step(() => application.evaluate(({ ipcMain, BrowserWindow }, input) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
        if (!previous || windows.length !== 1 || !frame || root.__routineInvocationAudit) throw Error('例程旁观原Main入口未知');
        const state = { phase: 'idle', pending: 0, calls: [] as any[], denied: [] as string[], executions: 0, sessions: {} as Record<string, string>, metadataIds: new Set<string>(), sql: '', parameters: [] as any[], permission: false, executed: new Set<string>(), check() {}, restore() {} };
        const check = () => { if (root.__routineInvocationAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window) throw Error('例程旁观原窗口或文档变化'); };
        const reject = (command: string): never => { state.denied.push(command); throw Error('例程禁止未明确授权的请求：' + command); };
        const allowed = new Set(['settings.get', 'settings.save', 'connections.list', 'connections.open', 'tasks.list', 'history.list', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.save', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish', 'sessions.open', 'sessions.close', 'metadata.routineInvocation', 'metadata.completion', 'query.parameterNames', 'query.completionState', 'query.temporaryState', 'query.sessionState', 'query.execute', 'query.executeParameterized']);
        const wrapped = async (event: any, payload: any) => {
          check(); if (event.sender !== contents || event.senderFrame !== frame) return reject('原文档之外的IPC');
          const command = String(payload?.command), request = payload?.input, phase = state.phase;
          if (!allowed.has(command)) return reject(command);
          if (command === 'connections.open' && request?.id !== input.connectionId || command === 'metadata.completion' && request?.connectionId !== input.connectionId) return reject(command);
          if (command === 'metadata.routineInvocation') {
            if (phase === 'idle' || request?.connectionId !== input.connectionId || request?.database !== input.database || request?.name !== phase || request?.kind !== (phase === 'exact_add' ? 'function' : 'procedure') || typeof request.taskId !== 'string' || state.metadataIds.has(request.taskId) || Object.keys(request).sort().join() !== 'connectionId,database,kind,name,taskId') return reject(command);
            state.metadataIds.add(request.taskId);
          }
          if (command === 'sessions.open' && (phase === 'idle' || request?.connectionId !== input.connectionId || request?.database !== input.database || state.sessions[phase])) return reject(command);
          // 已打开的隐藏查询页可能被动读取自己的协议状态；只有识参/执行必须属于当前调用页。
          if (['query.parameterNames', 'query.execute', 'query.executeParameterized'].includes(command) && request?.sessionId !== state.sessions[phase]) return reject(command);
          if (['query.completionState', 'query.temporaryState', 'query.sessionState', 'sessions.close'].includes(command) && !Object.values(state.sessions).includes(request?.sessionId)) return reject(command);
          if (command === 'query.parameterNames' && (!state.sql || request?.sql !== state.sql)) return reject(command);
          if (command === 'query.execute' || command === 'query.executeParameterized') {
            const supplied = command === 'query.executeParameterized' && Array.isArray(request?.parameters) ? request.parameters.map((parameter: any) => parameter.type === 'null' ? { name: parameter.name, type: parameter.type } : { name: parameter.name, type: parameter.type, value: parameter.value }) : [];
            if (!state.permission || state.executed.has(phase) || request?.sql !== state.sql || request?.currentStatement !== undefined || request?.continueOnError === true || request?.collectWarnings === true || command !== (state.parameters.length ? 'query.executeParameterized' : 'query.execute') || JSON.stringify(supplied) !== JSON.stringify(state.parameters)) return reject(command);
            state.permission = false; state.executed.add(phase); state.executions++;
          }
          const fact = { command, phase, taskId: typeof request?.taskId === 'string' ? request.taskId : undefined, ok: false, result: undefined as unknown }; state.calls.push(fact); state.pending++;
          try {
            const response = await previous(event, payload); check(); fact.ok = response?.ok === true;
            if (command === 'sessions.open' && fact.ok) { if (typeof response.result?.sessionId !== 'string' || Object.values(state.sessions).includes(response.result.sessionId)) return reject(command); state.sessions[phase] = response.result.sessionId; }
            if (command === 'metadata.routineInvocation' || command === 'query.execute' || command === 'query.executeParameterized') fact.result = response.result;
            return response;
          } finally { state.pending--; }
        };
        state.check = check; state.restore = () => { check(); if (state.pending || state.permission || state.denied.length || state.calls.some(fact => !fact.ok)) throw Error('例程旁观请求尚未严格结束'); handlers.set('dbark:request', previous); delete root.__routineInvocationAudit; };
        root.__routineInvocationAudit = state; handlers.set('dbark:request', wrapped); check();
      }, { connectionId: profile.id, database })); auditInstalled = true;
      const facts = () => step(() => application.evaluate(() => { const state = (globalThis as any).__routineInvocationAudit; state.check(); return { pending: state.pending as number, calls: state.calls as Fact[], denied: state.denied as string[], executions: state.executions as number, sessions: state.sessions as Record<string, string> }; }));
      /** 控件按真实参数名逐一填写，不使用preload执行、测试回包或系统剪贴板。 */
      const fill = async (modal: Locator, name: string, type: QueryParameterType, value?: string) => {
        const row = modal.locator('.parameter-row').filter({ has: page.getByText(parameterZh.type + ' ' + name, { exact: true }) });
        await step(() => row.getByRole('combobox').selectOption(type));
        if (type === 'null') await step(() => expect(row.locator('textarea')).toBeDisabled());
        else { const control = row.getByRole('textbox', { name: parameterZh.value + ' ' + name, exact: true }); await step(() => control.fill(value ?? '')); await step(() => expect(control).toHaveValue(value ?? '')); }
      };
      const generated: { name: RoutineName; sqlSha256: string; metadataTaskIds: string[]; results: unknown[] }[] = [], nonces = new Set<string>();
      for (const [index, name] of names.entries()) {
        await step(() => expect.poll(async () => (await facts()).pending).toBe(0));
        await step(() => application.evaluate((_electron, phase) => { const state = (globalThis as any).__routineInvocationAudit; state.check(); if (state.pending || state.permission) throw Error('例程前一操作未结束'); state.phase = phase; state.sql = ''; state.parameters = []; }, name));
        const entry = (await step(() => sidebarMenuItem(node.locator('.object-row').filter({ has: node.page().getByText(name, { exact: true }) }), { name: text.entry + ' ' + name, exact: true }, check))); await step(() => expect(entry).toBeVisible()); await step(() => entry.click());
        const modal = page.getByRole('dialog', { name: text.title, exact: true }); await step(() => expect(modal).toBeVisible());
        expect((await facts()).calls.filter(call => call.command === 'metadata.routineInvocation' && call.phase === name)).toHaveLength(0); expect((await facts()).executions).toBe(index);
        await step(() => modal.getByRole('button', { name: text.read, exact: true }).click()); await step(() => expect(modal.getByRole('button', { name: text.open, exact: true })).toBeEnabled());
        await step(() => expect(modal.locator('.routine-invocation-sql .monaco-editor').getByRole('textbox')).toHaveAttribute('aria-autocomplete', 'none'));
        await step(() => expect(modal.locator('.routine-invocation-sql .view-lines')).toContainText(name));
        const firstRead = (await facts()).calls.filter(call => call.command === 'metadata.routineInvocation' && call.phase === name); expect(firstRead).toHaveLength(1); expect(firstRead[0].ok).toBe(true);
        const metadata = firstRead[0].result as RoutineInvocationMetadata; expect(metadata).toMatchObject({ connectionId: profile.id, database, name, kind: kindOf(name), fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
        expect(metadata.parameters.map(parameter => parameter.mode)).toEqual(name === 'echo_mixed' ? ['IN', 'IN', 'IN', 'IN', 'IN', 'INOUT', 'OUT', 'OUT'] : name === 'exact_add' ? ['IN'] : name === 'out_only' ? ['OUT'] : []);
        if (name === 'exact_add') expect(metadata.returnType?.toLowerCase()).toBe('decimal(65,10)');
        expect((await facts()).executions).toBe(index); expect(await read(sql.audit)).toEqual(index ? [{ id: 1, marker: 'explicit-call' }] : []);
        await step(() => modal.getByRole('button', { name: text.open, exact: true }).click()); await step(() => expect(modal).toBeHidden());
        const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), targetTab = settings.tabs.find(tab => tab.id === settings.activeTabId)!;
        expect(targetTab).toMatchObject({ kind: 'query', title: text.queryTitle(name), connectionId: profile.id, database }); expect(targetTab.id).not.toBe(sourceTab.id); expect(settings.tabs.find(tab => tab.id === sourceTab.id)).toEqual(sourceTab);
        const source = targetTab.sql!; expect(source).toBe(expectedSql(database, name, source));
        const nonce = /@dbark_call_([a-f0-9]{32})_/.exec(source)?.[1]; if (nonce) { expect(nonces.has(nonce)).toBe(false); nonces.add(nonce); }
        const reads = (await facts()).calls.filter(call => call.command === 'metadata.routineInvocation' && call.phase === name); expect(reads).toHaveLength(2); expect(reads[0].taskId).not.toBe(reads[1].taskId); expect(reads.every(call => call.ok)).toBe(true); expect(reads[1].result).toEqual(metadata); expect((await facts()).executions).toBe(index);
        const supplied = parameters(name);
        await step(() => application.evaluate((_electron, input) => { const state = (globalThis as any).__routineInvocationAudit; state.check(); if (state.phase !== input.name || state.permission) throw Error('例程参数准备归属变化'); state.sql = input.sql; state.parameters = input.parameters; }, { name, sql: source, parameters: supplied }));
        let parameterModal: Locator | undefined;
        if (supplied.length) {
          await step(() => query().getByRole('button', { name: parameterZh.open, exact: true }).click()); parameterModal = page.getByRole('dialog', { name: parameterZh.title, exact: true }); await step(() => expect(parameterModal!).toBeVisible()); await step(() => expect(parameterModal!.getByRole('button', { name: parameterZh.execute, exact: true })).toBeEnabled());
          expect(await step(() => parameterModal!.locator('.parameter-row').count())).toBe(supplied.length);
          for (const parameter of supplied) await fill(parameterModal, parameter.name, parameter.type, parameter.value);
        }
        expect((await facts()).executions).toBe(index); expect(await read(sql.audit)).toEqual(index ? [{ id: 1, marker: 'explicit-call' }] : []);
        // 只有本次明确点击之前才给准确原SQL/参数的一次许可，失败绝不再领许可或重放。
        await step(() => application.evaluate((_electron, phase) => { const state = (globalThis as any).__routineInvocationAudit; state.check(); if (state.phase !== phase || !state.sql || state.permission || state.executed.has(phase)) throw Error('例程明确执行许可已使用'); state.permission = true; }, name));
        if (parameterModal) await step(() => parameterModal!.getByRole('button', { name: parameterZh.execute, exact: true }).click());
        else await step(() => query().getByRole('button', { name: /^执行(?:\s|$)/ }).click());
        if (parameterModal) await step(() => expect(parameterModal!).toBeHidden());
        await step(() => expect.poll(async () => { const audit = await facts(); return audit.pending === 0 && audit.calls.filter(call => /^query\.execute(?:Parameterized)?$/.test(call.command) && call.phase === name && call.ok).length === 1; }).toBe(true));
        const executed = (await facts()).calls.filter(call => /^query\.execute(?:Parameterized)?$/.test(call.command) && call.phase === name); expect(executed).toHaveLength(1); expect(executed[0].ok).toBe(true);
        const outcome = executed[0].result as QueryOutcome; expect(outcome.failure).toBeUndefined(); const sets = outcome.results.filter(result => result.columns.length);
        let actualRows: unknown[];
        if (name === 'echo_mixed') {
          expect(sets).toHaveLength(3);
          const first = values(sets[0], ['actual_id', 'actual_amount', 'actual_stamp', 'actual_nil', 'actual_hex']), second = values(sets[1], ['total', 'id']), outputs = values(sets[2], ['out_6', 'out_7', 'out_8']);
          expect(first).toEqual([['18446744073709551615', '12345678901234567890.1234567890', '2026-10-28 12:34:56.123456', null, '00FF00']]);
          expect(second).toEqual([['12345678901234567891.0000000000', '18446744073709551615']]); expect(outputs).toEqual([['12345678901234567891.0000000000', '18446744073709551615', { type: 'binary', base64: 'AP8A' }]]); actualRows = [first, second, outputs];
        } else {
          expect(sets).toHaveLength(1); const expected = name === 'exact_add' ? { columns: ['return_value'], rows: [['13.3400000000']] } : name === 'ping0' ? { columns: ['value'], rows: [['zero-params']] } : { columns: ['out_1'], rows: [['18446744073709551615']] };
          const rows = values(sets[0], expected.columns); expect(rows).toEqual(expected.rows); actualRows = [rows];
        }
        if (name === 'echo_mixed' || name === 'out_only') {
          const last = outcome.results.at(-1)!; expect(last.columns).toEqual([]); expect(last.affectedRows).toBe(0);
          expect(last.statement.trim().replace(/;$/, '')).toBe(source.split('\n').at(-1)!.replace(/;$/, ''));
        }
        expect(outcome.transactionOpen).toBe(false); expect(await read(sql.audit)).toEqual([{ id: 1, marker: 'explicit-call' }]); generated.push({ name, sqlSha256: hash(source), metadataTaskIds: reads.map(call => call.taskId!), results: actualRows });
      }
      const finalAudit = await facts(); expect(finalAudit.pending).toBe(0); expect(finalAudit.denied).toEqual([]); expect(finalAudit.executions).toBe(4); expect(finalAudit.calls.every(call => call.ok)).toBe(true);
      const metadataCalls = finalAudit.calls.filter(call => call.command === 'metadata.routineInvocation'); expect(metadataCalls).toHaveLength(8); expect(new Set(metadataCalls.map(call => call.taskId)).size).toBe(8);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); for (const call of metadataCalls) expect(tasks.find(task => task.id === call.taskId)).toMatchObject({ kind: 'metadata.routineInvocation', status: 'completed' }); expect(tasks.some(task => task.status === 'running')).toBe(false);
      const sourceButton = page.locator('.tab-strip .workspace-tab-button').filter({ has: page.getByRole('button', { name: sourceTab.title, exact: true }) }); await step(() => sourceButton.locator('.tab-select').click());
      await step(() => expect(query().locator('.result-body')).toHaveText(sourceResult)); await step(() => expect(query().locator('.monaco-editor .view-lines')).toContainText('untouched'));
      const after = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(after.tabs.find(tab => tab.id === sourceTab.id)).toEqual(sourceTab); for (const privateValue of ['18446744073709551615', '12345678901234567890.1234567890', '2026-10-28 12:34:56.123456']) expect(JSON.stringify(after)).not.toContain(privateValue);
      expect(pageErrors).toEqual([]); expect(await read(sql.audit)).toEqual([{ id: 1, marker: 'explicit-call' }]);
      await step(() => application.evaluate(() => (globalThis as any).__routineInvocationAudit.restore())); auditInstalled = false;
      check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
      assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread); expect(await resources({ kind: 'collect', database, excludeId: observerThread })).toEqual([]);
      await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(observerStream?.closed).toBe(true);
      await step(() => info.attach('例程调用真实窗口单次执行与严格收尾', { body: JSON.stringify({ kind: 'dbark.routine-invocation-ui', version: 1, database, server: resource.server, actual, launcherPid, launcherLineage, metadataTaskIds: metadataCalls.map(call => call.taskId), executions: finalAudit.executions, generated, auditRows: [{ id: 1, marker: 'explicit-call' }], sourceUnexecutedSqlPreserved: true, observationScope: '连接/对象树及未执行原查询准备完成后，安装Main旁观至正常退出前恢复原handler', metadataAndPreviewNeverExecute: true, variablesClearedByFinalStatementOutcomeOnly: true, variableRemovalIndependentlyObserved: false, originalProcessExitCode: originalProcess.exitCode, observerClosed, observerPhysicalStreamClosed: observerStream?.closed, targetThreadsAfterExit: 0, processlist, resourceDiagnostics, databaseRetainedForRoot: true, resourceManifestSha256: environment.values.DBARK_ROUTINE_INVOCATION_RESOURCE_MANIFEST_SHA256, unverified: ['已有结果/活动事务', '真实取消/异常CALL恢复', '安装包', 'macOS', '其它数据库版本'] }), contentType: 'application/json' }));
      complete = true;
    } catch (reason) {
      retained = true; clock.retain(); retainOwnedDesktopResources(info);
      // 原Main旁观、App、隔离库及尚未关闭观察连接都保留；不在失败收尾里补发或DROP。
      void auditInstalled; throw reason;
    }
  });
}
