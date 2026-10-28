import type { TestInfo } from '@playwright/test';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { connect, type ManagedConnection } from '../../src/engine/connection';
import type { ConnectionProfile } from '../../src/shared/contracts';
import type { TableCheckChange, TableCheckGetOutput, TableCheckPreviewOutput, TableCheckApplyOutput } from '../../src/shared/tableChecks';
import { tableCheckMessages } from '../../src/shared/tableChecks';
import { tableChecksZh as text } from '../../src/renderer/locales/tableChecks.zh-CN';
import { tableCheckAcknowledgementLabel } from '../../src/renderer/tableChecksUi';
import { zh } from '../../src/renderer/locales/zh-CN';
import { assertTableDraftProcesslistVisible, assertTableDraftProcesslistWarnings, selectTableDraftProcesslist, tableDraftProcesslistQuery, tableDraftProcesslistNeedsCapability, type TableDraftProcesslistPolicy, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';

const ports = ['13357', '13380', '13384', '13310', '13311', '13484'];
const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_CHECKS_NATIVE', 'DBARK_TABLE_CHECKS_RESOURCE_MANIFEST', 'DBARK_TABLE_CHECKS_RESOURCE_MANIFEST_SHA256', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TEST_CA'] as const;
interface Resource {
  version: 1; kind: 'dbark.table-check-fixture'; database: string; ownerNonce: string; host: '192.168.31.200'; networkPort: number;
  server: { dialect: 'mysql' | 'mariadb'; version: string; hostname: string; port: number; serverId: number; uuid: string | null };
  subject: { name: 'subject'; ownerComment: string; ddlSha256: string; rowsSha256: string; initialCheckNames: string[] };
  ownedCheckNames: ['ck_amount', 'ck_amount_v2'];
}
interface Fact { command: string; taskId?: string; ok: boolean; result?: TableCheckGetOutput | TableCheckPreviewOutput | TableCheckApplyOutput; }
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => '`' + value.replaceAll('`', '``') + '`';
const core = (value: string) => value.replace(/^5\.5\.5-/, '').split(/[-+]/)[0];
const executeFile = promisify(execFile);
/** 只有身份标量归一化，行中的UINT64/DECIMAL/JSON原文本不经Number或JSON.parse。 */
function integer(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value === 'string' && (value.length > 16 || !/^(?:0|[1-9]\d*)$/.test(value)) || typeof value !== 'string' && typeof value !== 'number') throw Error('CHECK原生身份整数格式未知');
  const parsed = typeof value === 'number' ? value : Number(value); if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw Error('CHECK原生身份整数越界'); return parsed;
}
/** 只消费控制器本轮显式env；不读缓存、SSH配置、密钥或认证文件。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>, args = JSON.stringify(process.argv); let failed = false;
  const check = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('CHECK原生原环境变化');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_CHECKS_NATIVE !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || !ports.includes(values.DBARK_TEST_PORT ?? '') || values.DBARK_TEST_TLS !== (values.DBARK_TEST_PORT === '13484' ? '1' : '0') || !values.DBARK_TEST_USER || !values.DBARK_TEST_PASSWORD || !/^dbark_e2e_checks_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '') || !isAbsolute(values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST ?? '') || !/^[a-f0-9]{64}$/.test(values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST_SHA256 ?? '') || values.DBARK_TEST_TLS === '1' && !isAbsolute(values.DBARK_TEST_CA ?? '')) throw Error('CHECK验收必须显式批准的六端隔离库/严格TLS及原清单');
    } catch (reason) { failed = true; throw reason; }
  };
  check(); return { values, check };
}
/** 一份清单只授权一个准确数据库/subject和两条本轮约束，测试不建删资源。 */
function readResource(env: ReturnType<typeof bindEnvironment>): Resource {
  env.check(); const path = env.values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST!, stat = fs.lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw Error('CHECK资源原件不是有界普通文件');
  const bytes = fs.readFileSync(path); if (hash(bytes) !== env.values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST_SHA256) throw Error('CHECK资源原件摘要变化'); const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Resource;
  if (!value || Object.keys(value).sort().join() !== 'database,host,kind,networkPort,ownedCheckNames,ownerNonce,server,subject,version' || value.version !== 1 || value.kind !== 'dbark.table-check-fixture' || value.database !== env.values.DBARK_TEST_DATABASE || value.host !== env.values.DBARK_TEST_HOST || String(value.networkPort) !== env.values.DBARK_TEST_PORT || !/^[a-f0-9]{32}$/.test(value.ownerNonce) || !value.server || Object.keys(value.server).sort().join() !== 'dialect,hostname,port,serverId,uuid,version' || !['mysql', 'mariadb'].includes(value.server.dialect) || !value.server.hostname || !['5.7.44', '8.0.46', '8.4.11', '10.11.19', '11.4.13'].includes(core(value.server.version))) throw Error('CHECK准确服务器/版本/库清单不符');
  integer(value.server.port, 1, 65535); integer(value.server.serverId, 0, 0xffffffff);
  if (value.server.dialect === 'mysql' ? value.server.uuid !== env.values.DBARK_TEST_EXPECTED_SERVER_UUID || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value.server.uuid ?? '') : value.server.uuid !== null) throw Error('CHECK服务器UUID绑定未知');
  if (JSON.stringify(value.ownedCheckNames) !== '["ck_amount","ck_amount_v2"]' || !value.subject || Object.keys(value.subject).sort().join() !== 'ddlSha256,initialCheckNames,name,ownerComment,rowsSha256' || value.subject.name !== 'subject' || value.subject.ownerComment !== `dbark-checks:${value.ownerNonce}:subject` || !/^[a-f0-9]{64}$/.test(value.subject.ddlSha256) || !/^[a-f0-9]{64}$/.test(value.subject.rowsSha256) || !Array.isArray(value.subject.initialCheckNames) || new Set(value.subject.initialCheckNames).size !== value.subject.initialCheckNames.length || value.subject.initialCheckNames.some(name => typeof name !== 'string' || !name || value.ownedCheckNames.includes(name as typeof value.ownedCheckNames[number]))) throw Error('CHECK表原件/旁约束/本轮名字不符');
  const legacy = value.server.dialect === 'mysql' && core(value.server.version) === '5.7.44'; if (legacy ? value.subject.initialCheckNames.length !== 0 : !value.subject.initialCheckNames.includes('ck_keep')) throw Error('CHECK基线旁约束与版本事实不符');
  return value;
}

/** 单清单单实例单例，所有未知和失败保留原App/库，不重试、不替换失败断言或清理资源。 */
export function registerTableChecksNative(): void {
  const env = bindEnvironment(); let retained = false, completed = false;
  const guard = () => { env.check(); readResource(env); const info = test.info(); if (retained || info.config.workers !== 1 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('CHECK原生要求原单worker/零重试和零重复'); };
  test.use({ preserveOnUnconfirmedExit: true, ownedDesktopLaunchGuard: { assertCurrent: guard }, trace: 'off', screenshot: 'off', video: 'off' }); test.setTimeout(120000); test.describe.configure({ mode: 'serial', retries: 0 });
  test.afterEach(({}, info) => { if (!completed) { retained = true; retainOwnedDesktopResources(info); throw Error('CHECK原生命周期未闭合，保留本例资源'); } });
  test('Sidebar CHECK完整目录、单项确认修改及生效探针，原行和旁结构保持', async ({ trace, screenshot, video }, info: TestInfo) => {
    const resource = readResource(env), appOwner = ownedDesktopResources(info), application = appOwner.application, page = appOwner.page, originalProcess = application.process(), directory = dataDir, frame = page.mainFrame();
    const clock = bindEditorIndentNativeCase(info, { assertCurrent: guard }, () => test.info()); let closed = false, observer: ManagedConnection | undefined, observerClosed = false, observerFailed = false, armed = false, observerThread = 0, processlist: TableDraftProcesslistPolicy | undefined;
    const probes: { phase: string; threadId?: number; rejected?: boolean; errno?: number; rolledBack: boolean; strictClosed: boolean; streamClosed?: boolean }[] = [], resourceDiagnostics: { source: string; warnings: unknown }[] = [];
    const check = () => { clock.assertCurrent(); const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || dataDir !== directory || !closed && (page.mainFrame() !== frame || frame.isDetached() || application.process() !== originalProcess) || observerFailed) throw Error('CHECK原App/文档/连接归属失效'); };
    const audit = () => application.evaluate(() => { const state = (globalThis as any).__tableChecksNative; state.check(); return { pending: state.pending as number, applies: state.applies as number, calls: state.calls as Fact[], denied: state.denied as string[], getIds: [...state.snapshots.keys()] as string[], released: [...state.released] as string[] }; });
    const step = async <T,>(action: () => Promise<T>, skipAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const value = await action(); check(); if (armed && !closed && !skipAfter) await audit(); return value; };
    const targetSql = quote(resource.database) + '.`subject`', legacy = resource.server.dialect === 'mysql' && core(resource.server.version) === '5.7.44', profile: ConnectionProfile = { id: 'checks-observer-' + resource.ownerNonce, name: 'CHECK隔离验证', group: '', color: '#455a64', dialect: resource.server.dialect, host: resource.host, port: resource.networkPort, user: env.values.DBARK_TEST_USER!, password: env.values.DBARK_TEST_PASSWORD!, database: resource.database, rememberPassword: false, ...(env.values.DBARK_TEST_TLS === '1' ? { tls: { enabled: true, rejectUnauthorized: true, caPath: env.values.DBARK_TEST_CA! } } : {}) };
    const sql = {
      identity: 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version AS version,CONNECTION_ID() AS threadId', uuid: 'SELECT @@server_uuid AS uuid', capability: 'SELECT @@performance_schema AS enabled',
      ddl: 'SHOW CREATE TABLE ' + targetSql,
      rows: 'SELECT CAST(id AS CHAR) AS id,CAST(amount AS CHAR) AS amount,note,CAST(payload AS CHAR CHARACTER SET utf8mb4) AS payload FROM ' + targetSql + ' ORDER BY id',
      tables: 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS ownerComment FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      checks: 'SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=? AND TABLE_NAME=\'subject\' AND CONSTRAINT_TYPE=\'CHECK\' ORDER BY CONSTRAINT_NAME',
      begin: 'START TRANSACTION', insert: 'INSERT INTO ' + targetSql + '(id,amount,note,payload) VALUES(3,-1,NULL,NULL)', rollback: 'ROLLBACK AND NO CHAIN NO RELEASE',
    };
    /** 主观察连接不接DML；探针独立会话只开放三条固定事务语句和准确身份SELECT。 */
    const resourceSql = new Set<string>();
    const query = async <T,>(managed: ManagedConnection, statement: string, values: (string | number)[] = []): Promise<T> => {
      if (managed === observer ? ![sql.identity, sql.uuid, sql.capability, sql.ddl, sql.rows, sql.tables, sql.checks, 'SHOW COUNT(*) WARNINGS', 'SHOW WARNINGS LIMIT 2'].includes(statement) && !resourceSql.has(statement) : ![sql.identity, sql.uuid, sql.begin, sql.insert, sql.rollback].includes(statement) || values.length !== 0) throw Error('CHECK物理连接拒绝未知SQL用途');
      return step(() => new Promise<T>((resolveQuery, reject) => managed.connection.query({ sql: statement, values }, (error, rows) => error ? reject(error) : resolveQuery(rows as T))));
    };
    const read = async (statement: string, values: (string | number)[] = []): Promise<RowDataPacket[]> => { if (![sql.identity, sql.uuid, sql.capability, sql.ddl, sql.rows, sql.tables, sql.checks].includes(statement) || (statement === sql.tables || statement === sql.checks ? values.length !== 1 || values[0] !== resource.database : values.length !== 0)) throw Error('CHECK观察只限精确只读SQL'); return query(observer!, statement, values); };
    const assertIdentity = async (managed: ManagedConnection) => {
      const rows = await query<RowDataPacket[]>(managed, sql.identity); expect(rows).toHaveLength(1); const row = rows[0]; expect({ hostname: row.hostname, port: integer(row.port, 1, 65535), serverId: integer(row.serverId, 0, 0xffffffff), version: row.version, threadId: integer(row.threadId) }).toEqual({ hostname: resource.server.hostname, port: resource.server.port, serverId: resource.server.serverId, version: resource.server.version, threadId: integer(managed.connection.threadId) });
      expect(managed.status.dialect).toBe(resource.server.dialect); expect(core(managed.status.version)).toBe(core(resource.server.version)); if (resource.server.dialect === 'mysql') expect(await query(managed, sql.uuid)).toEqual([{ uuid: resource.server.uuid }]);
      if (env.values.DBARK_TEST_TLS === '1') { const stream = (managed.connection as any).stream; expect(stream.encrypted).toBe(true); expect(stream.authorized).toBe(true); }
    };
    const resources = async (request: TableDraftProcesslistRequest): Promise<RowDataPacket[]> => {
      if (!processlist || request.kind === 'database' || request.kind === 'ids' && (request.ids.length !== 1 || request.ids[0] !== observerThread) || request.kind === 'collect' && (request.database !== resource.database || request.excludeId !== observerThread)) throw Error('CHECK资源查询只能看本库/原观察线程');
      const selected = tableDraftProcesslistQuery(processlist, request); resourceSql.add(selected.sql);
      const rows = await query<RowDataPacket[]>(observer!, selected.sql, selected.values), counts = await query(observer!, 'SHOW COUNT(*) WARNINGS'), warnings = await query(observer!, 'SHOW WARNINGS LIMIT 2'); assertTableDraftProcesslistWarnings(processlist, counts, warnings); resourceDiagnostics.push({ source: processlist.source, warnings }); return rows;
    };
    const negativeProbe = async (phase: string, rejectExpected: boolean): Promise<void> => {
      const fact = { phase, rolledBack: false, strictClosed: false } as typeof probes[number]; probes.push(fact); let managed: ManagedConnection | undefined, failure: unknown;
      try {
        managed = await step(() => connect({ ...profile, id: 'checks-probe-' + phase + '-' + resource.ownerNonce }, resource.database)); fact.threadId = integer(managed.connection.threadId); await assertIdentity(managed);
        await query(managed, sql.begin);
        try { const header = await query<ResultSetHeader>(managed, sql.insert); fact.rejected = false; expect(header.affectedRows).toBe(1); if (rejectExpected) throw Error('准确负值探针未被CHECK拒绝'); }
        catch (reason) { const errno = Number((reason as { errno?: unknown })?.errno); fact.errno = errno; if (!rejectExpected || errno !== (resource.server.dialect === 'mysql' ? 3819 : 4025)) throw reason; fact.rejected = true; }
      } catch (reason) { failure = reason; }
      finally {
        if (managed) {
          try { await query(managed, sql.rollback); fact.rolledBack = true; } catch (reason) { failure = failure ? new AggregateError([failure, reason], 'CHECK探针失败且原事务回滚未确认') : reason; }
          try { await managed.close({ strict: true }); fact.strictClosed = true; fact.streamClosed = (managed.connection as any).stream?.closed; if (fact.streamClosed !== true) throw Error('CHECK探针物理流关闭未确认'); } catch (reason) { failure = failure ? new AggregateError([failure, reason], 'CHECK探针原资源严格收尾未确认') : reason; }
        }
      }
      if (failure) throw failure;
    };
    try {
      guard(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']); await step(() => info.attach('CHECK原启动线索', { body: JSON.stringify({ directory, launcherPid: originalProcess.pid, database: resource.database, resourceSha256: env.values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST_SHA256 }), contentType: 'application/json' }));
      const actual = await step(() => application.evaluate(({ app }) => ({ pid: process.pid, executable: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData'), packaged: app.isPackaged, browserPids: app.getAppMetrics().filter(metric => metric.type === 'Browser').map(metric => metric.pid) })));
      expect(actual.packaged).toBe(false); expect(fs.realpathSync(actual.executable)).toBe(fs.realpathSync(require('electron') as string)); expect(fs.realpathSync(actual.appPath)).toBe(fs.realpathSync(resolve('.'))); expect(fs.realpathSync(actual.userData)).toBe(fs.realpathSync(directory)); expect(actual.browserPids).toEqual([actual.pid]); const launcherPid = integer(originalProcess.pid); let launcherLineage: unknown;
      await step(() => info.attach('CHECK原Main身份', { body: JSON.stringify(actual), contentType: 'application/json' }));
      if (actual.pid !== launcherPid) {
        const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter 'ProcessId = ${launcherPid} OR ProcessId = ${integer(actual.pid)}' | ForEach-Object { [pscustomobject]@{ pid=[int]$_.ProcessId; parentPid=[int]$_.ParentProcessId; executable=$_.ExecutablePath; createdUtc=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress`;
        const result = await step(() => executeFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 })); expect(result.stderr).toBe(''); const rows = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()) as { pid: number; parentPid: number; executable: string; createdUtc: string }[]; expect(rows).toHaveLength(2); const main = rows.find(row => row.pid === actual.pid), launcher = rows.find(row => row.pid === launcherPid); expect(main).toBeDefined(); expect(launcher).toBeDefined(); expect(main!.parentPid).toBe(launcherPid); expect(fs.realpathSync(main!.executable)).toBe(fs.realpathSync(actual.executable)); expect(Number.isFinite(Date.parse(launcher!.createdUtc)) && Number.isFinite(Date.parse(main!.createdUtc)) && Date.parse(launcher!.createdUtc) <= Date.parse(main!.createdUtc)).toBe(true); launcherLineage = rows;
      }
      observer = await step(() => connect(profile, resource.database)); observerThread = integer(observer.connection.threadId); observer.connection.on('error', () => { observerFailed = true; }); await assertIdentity(observer);
      processlist = selectTableDraftProcesslist(resource.server.dialect, resource.server.version, tableDraftProcesslistNeedsCapability(resource.server.dialect, resource.server.version) ? await read(sql.capability) : undefined); assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread);
      expect(await read(sql.tables, [resource.database])).toEqual([{ name: 'subject', ownerComment: resource.subject.ownerComment }]); const originalDdlRows = await read(sql.ddl); expect(originalDdlRows).toHaveLength(1); const originalDdl = originalDdlRows[0]['Create Table'] as string; expect(hash(originalDdl)).toBe(resource.subject.ddlSha256);
      const baselineRows = await read(sql.rows); expect(hash(JSON.stringify(baselineRows))).toBe(resource.subject.rowsSha256); expect(baselineRows).toHaveLength(2);
      expect(baselineRows.find(row => row.id === '2')).toEqual({ id: '2', amount: null, note: '', payload: null }); const precise = baselineRows.find(row => row.id === '18446744073709551615')!; expect(precise.amount).toBe('12345678901234567890.1234567890'); expect(precise.note).toBeNull(); expect(typeof precise.payload).toBe('string'); expect(precise.payload).toMatch(/"wide"\s*:\s*18446744073709551615/); expect(precise.payload).toContain('合成');
      expect((await read(sql.checks, [resource.database])).map(row => row.name).sort()).toEqual([...resource.subject.initialCheckNames].sort());
      // 准备真实保存配置，秘密仅传原Main并保留会话；此步不冒称连接表单/CA选择器验收。
      const savedProfile = await step(() => page.evaluate(profile => window.dbark.invoke('connections.save', profile), { ...profile, id: 'checks-app-' + resource.ownerNonce, name: 'CHECK本例' })); expect(savedProfile.rememberPassword).toBe(false); expect(savedProfile.password).toBeUndefined();
      // 重新加载只为正式App读取本地保存配置；不是用重载绕过产品数据或定义读取。
      await step(() => page.reload()); const currentFrame = page.mainFrame(); if (currentFrame !== frame) throw Error('CHECK准备reload改变Playwright原mainFrame身份');
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: savedProfile.name, exact: true }) }); await step(() => node.getByRole('button', { name: savedProfile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: resource.database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: resource.database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: resource.database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      // Main旁观从准备/连接树完成后开始；捕获原响应，不伪造get/preview/apply或执行SQL。
      await step(() => application.evaluate(({ ipcMain, BrowserWindow }, target) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], contents = window?.webContents, frame = contents?.mainFrame;
        if (!previous || windows.length !== 1 || !frame || root.__tableChecksNative) throw Error('CHECK原Main旁观入口未知');
        const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        const state = { pending: 0, applies: 0, calls: [] as any[], denied: [] as string[], taskIds: new Set<string>(), snapshots: new Map<string, any>(), previews: new Map<string, any>(), released: new Set<string>(), currentSnapshot: '', change: undefined as unknown, expectedSql: '', permission: undefined as string | undefined, check() {}, restore() {} };
        const check = () => { if (root.__tableChecksNative !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || contents.isDestroyed() || contents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || BrowserWindow.getAllWindows()[0] !== window || state.denied.length) throw Error('CHECK原Main/文档/旁观已失效'); };
        const reject = (command: string): never => { state.denied.push(command); throw Error('CHECK禁止未声明操作或重复DDL：' + command); };
        const local = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish']);
        const wrapped = async (event: any, payload: any) => {
          check(); if (event.sender !== contents || event.senderFrame !== frame) return reject('外来IPC');
          const command = String(payload?.command), input = payload?.input;
          if (!local.has(command) && !['schema.tableChecks.get', 'schema.tableChecks.preview', 'schema.tableChecks.apply', 'schema.tableChecks.release'].includes(command)) return reject(command);
          if (['schema.tableChecks.get', 'schema.tableChecks.preview', 'schema.tableChecks.apply'].includes(command)) { if (typeof input?.taskId !== 'string' || state.taskIds.has(input.taskId)) return reject(command); state.taskIds.add(input.taskId); }
          if (command === 'schema.tableChecks.get' && (input?.connectionId !== target.connectionId || input?.database !== target.database || input?.table !== target.table || Object.keys(input).sort().join() !== 'connectionId,database,table,taskId')) return reject(command);
          if (command === 'schema.tableChecks.preview' && (input?.snapshotId !== state.currentSnapshot || stable(input?.change) !== stable(state.change) || !state.expectedSql)) return reject(command);
          if (command === 'schema.tableChecks.apply') {
            const preview = state.previews.get(input?.previewToken);
            if (!state.permission || state.permission !== input?.previewToken || !preview || input?.databaseConfirmation !== target.database || input?.tableConfirmation !== target.table || !Array.isArray(input.acknowledgements) || new Set(input.acknowledgements).size !== input.acknowledgements.length || stable([...input.acknowledgements].sort()) !== stable([...preview.requiredAcknowledgements].sort())) return reject(command);
            state.permission = undefined; state.applies++;
          }
          if (command === 'schema.tableChecks.release') {
            if (!input || Object.keys(input).some(key => !['snapshotId', 'previewToken'].includes(key)) || !input.snapshotId && !input.previewToken || input.snapshotId && !state.snapshots.has(input.snapshotId) || input.previewToken && !state.previews.has(input.previewToken)) return reject(command);
          }
          const fact = { command, taskId: typeof input?.taskId === 'string' ? input.taskId : undefined, ok: false, result: undefined as unknown }; state.calls.push(fact); state.pending++;
          try {
            const response = await previous(event, payload); check(); fact.ok = response?.ok === true;
            if (command.startsWith('schema.tableChecks.') && command !== 'schema.tableChecks.release') fact.result = response.result;
            if (command === 'schema.tableChecks.get' && fact.ok) { const value = response.result; if (stable(value?.target) !== stable(target) || typeof value.snapshotId !== 'string' || state.snapshots.has(value.snapshotId)) return reject(command); state.snapshots.set(value.snapshotId, value); state.currentSnapshot = value.snapshotId; }
            if (command === 'schema.tableChecks.preview' && fact.ok) { const value = response.result, snapshot = state.snapshots.get(input.snapshotId); if (stable(value?.target) !== stable(target) || typeof value.previewToken !== 'string' || state.previews.has(value.previewToken) || value.ddlHash !== snapshot.ddlHash || value.sql !== state.expectedSql || stable(value.change) !== stable(state.change)) return reject(command); state.previews.set(value.previewToken, value); }
            if (command === 'schema.tableChecks.release' && fact.ok) { if (input.snapshotId) state.released.add('snapshot:' + input.snapshotId); if (input.previewToken) state.released.add('preview:' + input.previewToken); }
            return response;
          } finally { state.pending--; }
        };
        state.check = check; state.restore = () => { check(); if (state.pending || state.permission || state.calls.some(fact => !fact.ok) || [...state.snapshots.keys()].some(id => !state.released.has('snapshot:' + id)) || [...state.previews.keys()].some(id => !state.released.has('preview:' + id))) throw Error('CHECK原令牌/任务未完整释放'); handlers.set('dbark:request', previous); delete root.__tableChecksNative; };
        root.__tableChecksNative = state; handlers.set('dbark:request', wrapped); check();
      }, { connectionId: savedProfile.id, database: resource.database, table: 'subject' })); armed = true;
      const facts = async () => step(audit), modal = page.getByRole('dialog', { name: text.title, exact: true });
      await step(() => node.getByRole('button', { name: text.entry + ' subject', exact: true }).click()); await step(() => expect(modal).toBeVisible()); expect((await facts()).calls.filter(call => call.command === 'schema.tableChecks.get')).toHaveLength(0);
      let snapshot: TableCheckGetOutput;
      const get = async (ownedName?: string, enforced?: boolean) => {
        const count = (await facts()).calls.filter(call => call.command === 'schema.tableChecks.get').length;
        await step(() => modal.getByRole('button', { name: text.read, exact: true }).click()); await step(() => expect.poll(async () => { const value = await facts(); return value.pending === 0 && value.calls.filter(call => call.command === 'schema.tableChecks.get' && call.ok).length === count + 1; }).toBe(true));
        const call = (await facts()).calls.filter(call => call.command === 'schema.tableChecks.get').at(-1)!; snapshot = call.result as TableCheckGetOutput;
        expect(snapshot.target).toEqual({ connectionId: savedProfile.id, database: resource.database, table: 'subject' }); expect(snapshot.dialect).toBe(resource.server.dialect); expect(core(snapshot.serverVersion)).toBe(core(resource.server.version));
        if (legacy) { expect(snapshot.writable).toBe(false); expect(snapshot.allowsNotEnforced).toBe(false); expect(snapshot.reasons).toContain(tableCheckMessages.unsupported); }
        else { expect(snapshot.coverage).toBe('complete'); expect(snapshot.writable).toBe(true); expect(snapshot.allowsNotEnforced).toBe(resource.server.dialect === 'mysql'); }
        expect(snapshot.checks.map(item => item.name).sort()).toEqual([...resource.subject.initialCheckNames, ...(ownedName ? [ownedName] : [])].sort());
        if (ownedName) expect(snapshot.checks.find(item => item.name === ownedName)?.enforced).toBe(enforced);
        await step(() => expect(modal.getByRole('button', { name: text.read, exact: true })).toBeEnabled()); return snapshot;
      };
      await get();
      const reports: { op: TableCheckChange['op']; taskId: string; ddlHash: string; verified: boolean }[] = [];
      if (legacy) {
        await step(() => expect(modal.getByText(text.readonly, { exact: true })).toBeVisible()); await step(() => expect(modal.getByRole('button', { name: text.add, exact: true })).toBeDisabled()); await step(() => expect(modal.getByRole('button', { name: text.preview, exact: true })).toHaveCount(0)); expect((await facts()).applies).toBe(0); expect(probes).toEqual([]);
      } else {
        /** 每项先固定本次结构化change与独立期望SQL，预览期间观察原数据/原定义未变。 */
        const operate = async (change: TableCheckChange, itemName?: string) => {
          const beforeApplies = (await facts()).applies, beforeDdl = (await read(sql.ddl))[0]['Create Table'] as string;
          if (change.op === 'add') { await step(() => modal.getByRole('button', { name: text.add, exact: true }).click()); }
          else { const item = modal.locator('.table-checks-item').filter({ has: page.getByText(itemName!, { exact: true }) }); await step(() => expect(item).toHaveCount(1)); await step(() => item.getByRole('button', { name: change.op === 'replace' ? text.edit : change.op === 'drop' ? text.drop : change.enforced ? text.enable : text.disable, exact: true }).click()); }
          if (change.op === 'add' || change.op === 'replace') { await step(() => modal.getByLabel(text.name, { exact: true }).fill(change.name)); await step(() => modal.getByLabel(text.expression, { exact: true }).fill(change.expression)); await step(() => modal.getByLabel(text.enforced, { exact: true }).selectOption(change.enforced ? 'yes' : 'no')); }
          const old = change.op === 'add' ? undefined : snapshot.checks.find(item => item.checkRef === change.checkRef)!;
          const drop = old ? (resource.server.dialect === 'mysql' ? 'DROP CHECK ' : 'DROP CONSTRAINT ') + quote(old.name) : '';
          const add = change.op === 'add' || change.op === 'replace' ? 'ADD CONSTRAINT ' + quote(change.name) + ' CHECK (\n' + change.expression + '\n)' + (resource.server.dialect === 'mysql' ? change.enforced ? ' ENFORCED' : ' NOT ENFORCED' : '') : '';
          const clauses = change.op === 'add' ? add : change.op === 'drop' ? drop : change.op === 'replace' ? drop + ', ' + add : 'ALTER CHECK ' + quote(old!.name) + (change.enforced ? ' ENFORCED' : ' NOT ENFORCED');
          const expectedSql = 'ALTER TABLE ' + targetSql + ' ' + clauses + ';';
          await step(() => application.evaluate((_electron, value) => { const state = (globalThis as any).__tableChecksNative; state.check(); if (state.pending || state.permission) throw Error('CHECK前一任务未结束'); state.change = value.change; state.expectedSql = value.sql; }, { change, sql: expectedSql }));
          const count = (await facts()).calls.filter(call => call.command === 'schema.tableChecks.preview').length;
          await step(() => modal.getByRole('button', { name: text.preview, exact: true }).click()); await step(() => expect.poll(async () => { const value = await facts(); return value.pending === 0 && value.calls.filter(call => call.command === 'schema.tableChecks.preview' && call.ok).length === count + 1; }).toBe(true));
          const preview = (await facts()).calls.filter(call => call.command === 'schema.tableChecks.preview').at(-1)!.result as TableCheckPreviewOutput; expect(preview.sql).toBe(expectedSql); expect(preview.ddlHash).toBe(hash(beforeDdl));
          const acks = ['ddl-implicit-commit', 'external-ddl-window', ...(change.op === 'drop' || change.op === 'replace' ? ['check-removal'] : []), ...(change.op === 'drop' ? [] : [change.enforced ? 'check-existing-rows' : 'check-disabled'])]; expect([...preview.requiredAcknowledgements].sort()).toEqual([...acks].sort());
          await step(() => expect(modal.getByRole('button', { name: text.apply, exact: true })).toBeDisabled()); await step(() => expect(modal.locator('.monaco-editor').getByRole('textbox')).toHaveAttribute('aria-autocomplete', 'none'));
          expect((await read(sql.ddl))[0]['Create Table']).toBe(beforeDdl); expect(await read(sql.rows)).toEqual(baselineRows); expect((await facts()).applies).toBe(beforeApplies);
          await step(() => modal.getByLabel(text.databaseConfirmation, { exact: true }).fill(resource.database)); await step(() => modal.getByLabel(text.tableConfirmation, { exact: true }).fill('subject')); await step(() => expect(modal.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
          for (const ack of preview.requiredAcknowledgements) { const label = tableCheckAcknowledgementLabel(ack); if (!label) throw Error('CHECK确认项没有正式文案'); await step(() => modal.getByRole('checkbox', { name: label, exact: true }).check()); }
          await step(() => expect(modal.getByRole('button', { name: text.apply, exact: true })).toBeEnabled());
          await step(() => application.evaluate((_electron, token) => { const state = (globalThis as any).__tableChecksNative; state.check(); if (state.pending || state.permission || !state.previews.has(token)) throw Error('CHECK明确提交许可未就绪'); state.permission = token; }, preview.previewToken));
          await step(() => modal.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect.poll(async () => { const value = await facts(); return value.pending === 0 && value.calls.filter(call => call.command === 'schema.tableChecks.apply' && call.ok).length === beforeApplies + 1; }).toBe(true));
          const apply = (await facts()).calls.filter(call => call.command === 'schema.tableChecks.apply').at(-1)!; const output = apply.result as TableCheckApplyOutput; expect(output).toMatchObject({ target: snapshot.target, ddlSubmitted: true, ddlCompleted: true, resourcesReleased: true, definitionVerified: true }); expect(output.verificationError).toBeUndefined(); await step(() => expect(modal.getByText(text.verified, { exact: true })).toBeVisible());
          expect(await read(sql.rows)).toEqual(baselineRows); reports.push({ op: change.op, taskId: apply.taskId!, ddlHash: output.after!.ddlHash, verified: output.definitionVerified });
        };
        await operate({ op: 'add', name: 'ck_amount', expression: '(`amount` >= 0)', enforced: true }); await negativeProbe('after-add', true); expect(await read(sql.rows)).toEqual(baselineRows); await get('ck_amount', true);
        await operate({ op: 'replace', checkRef: snapshot!.checks.find(item => item.name === 'ck_amount')!.checkRef, name: 'ck_amount_v2', expression: '(`amount` >= 1)', enforced: true }, 'ck_amount'); await negativeProbe('after-replace', true); expect(await read(sql.rows)).toEqual(baselineRows); await get('ck_amount_v2', true);
        if (resource.server.dialect === 'mysql') {
          await operate({ op: 'enforcement', checkRef: snapshot!.checks.find(item => item.name === 'ck_amount_v2')!.checkRef, enforced: false }, 'ck_amount_v2'); await negativeProbe('not-enforced', false); expect(await read(sql.rows)).toEqual(baselineRows); await get('ck_amount_v2', false);
          await operate({ op: 'enforcement', checkRef: snapshot!.checks.find(item => item.name === 'ck_amount_v2')!.checkRef, enforced: true }, 'ck_amount_v2'); await negativeProbe('after-enable', true); expect(await read(sql.rows)).toEqual(baselineRows); await get('ck_amount_v2', true);
        } else {
          await step(() => expect(modal.getByText(text.maria, { exact: true })).toBeVisible()); const owned = modal.locator('.table-checks-item').filter({ has: page.getByText('ck_amount_v2', { exact: true }) }); await step(() => expect(owned.getByRole('button', { name: text.disable, exact: true })).toBeDisabled());
        }
        await operate({ op: 'drop', checkRef: snapshot!.checks.find(item => item.name === 'ck_amount_v2')!.checkRef }, 'ck_amount_v2'); await get();
      }
      expect((await read(sql.ddl))[0]['Create Table']).toBe(originalDdl); expect(await read(sql.rows)).toEqual(baselineRows); expect((await read(sql.checks, [resource.database])).map(row => row.name).sort()).toEqual([...resource.subject.initialCheckNames].sort());
      await step(() => modal.getByRole('button', { name: text.close, exact: true }).click()); await step(() => expect(modal).toBeHidden());
      const result = await facts(); expect(result.pending).toBe(0); expect(result.denied).toEqual([]); expect(result.applies).toBe(legacy ? 0 : resource.server.dialect === 'mysql' ? 5 : 3); expect(result.calls.every(call => call.ok)).toBe(true);
      const taskCalls = result.calls.filter(call => ['schema.tableChecks.get', 'schema.tableChecks.preview', 'schema.tableChecks.apply'].includes(call.command)); expect(new Set(taskCalls.map(call => call.taskId)).size).toBe(taskCalls.length); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); for (const call of taskCalls) expect(tasks.find(task => task.id === call.taskId)).toMatchObject({ kind: call.command, status: 'completed' }); expect(tasks.some(task => task.status === 'running')).toBe(false);
      expect(result.getIds.every(id => result.released.includes('snapshot:' + id))).toBe(true); expect(probes.every(fact => fact.rolledBack && fact.strictClosed && fact.streamClosed)).toBe(true); expect(pageErrors).toEqual([]);
      // restore负责原pending/令牌收尾；撤销后不能再读被删除的Main观察状态。
      await step(() => application.evaluate(() => (globalThis as any).__tableChecksNative.restore()), true); armed = false;
      check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread); expect(await resources({ kind: 'collect', database: resource.database, excludeId: observerThread })).toEqual([]);
      await observer.close({ strict: true }); observerClosed = true; check(); expect((observer.connection as any).stream?.closed).toBe(true);
      await step(() => info.attach('CHECK管理正式界面与独立事务探针', { body: JSON.stringify({ kind: 'dbark.table-checks-native', database: resource.database, server: resource.server, actual, launcherPid, launcherLineage, legacyReadonly: legacy, applies: result.applies, reports, probes, metadataTaskIds: taskCalls.map(call => call.taskId), allSnapshotsReleased: true, originalDdlHash: hash(originalDdl), finalDdlRestored: true, originalRowsSha256: resource.subject.rowsSha256, rowsUnchanged: true, initialCheckNames: resource.subject.initialCheckNames, originalProcessExitCode: originalProcess.exitCode, observerClosed, observerStreamClosed: (observer!.connection as any).stream?.closed, databaseThreadsAfterExit: 0, processlist, resourceDiagnostics, resourceManifestSha256: env.values.DBARK_TABLE_CHECKS_RESOURCE_MANIFEST_SHA256, databaseRetainedForRoot: true, observationScope: '配置/Sidebar树准备后安装正式Main旁观，至正常退出前restore', rawUtilitySqlObserved: false, unverified: ['MySQL5.7不查询ENFORCED目录的原始utility SQL追踪（由reader单元门另验）', '真实取消/权限不足/并发外部DDL', '已有查询事务/表格草稿', '安装包', 'macOS'] }), contentType: 'application/json' })); completed = true;
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}
