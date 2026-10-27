import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { zh } from '../../src/renderer/locales/zh-CN';
import { tableForeignKeyJoinZh as text } from '../../src/renderer/locales/tableForeignKeyJoin.zh-CN';
import { recordViewZh as recordText } from '../../src/renderer/locales/recordViews.zh-CN';
import { draftHistoryZh } from '../../src/renderer/locales/draftHistory.zh-CN';
import { assertTableDraftNoWarnings, assertTableDraftProcesslistVisible, assertTableDraftProcesslistWarnings, selectTableDraftProcesslist, tableDraftProcesslistQuery, type TableDraftProcesslistPolicy, type TableDraftProcesslistRequest } from '../helpers/tableDraftProcesslist';

const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_FK_JOIN_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_FK_JOIN_MANIFEST', 'DBARK_FK_JOIN_MANIFEST_SHA256', 'DBARK_FK_JOIN_RESOURCE_MANIFEST', 'DBARK_FK_JOIN_RESOURCE_MANIFEST_SHA256'] as const;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const parentRows = [
  { id: 101, a: '9007199254740993', b: '12.3400', label: 'parent-match', ancestor_a: null, ancestor_b: null },
  { id: 102, a: '9007199254740993', b: '56.7800', label: 'same-a-wrong-b', ancestor_a: null, ancestor_b: null },
  { id: 103, a: '9007199254740995', b: '12.3400', label: 'same-b-wrong-a', ancestor_a: null, ancestor_b: null },
  { id: 104, a: '9007199254740997', b: '90.1200', label: 'parent-leaf', ancestor_a: '9007199254740993', ancestor_b: '12.3400' },
  { id: 105, a: null, b: '12.3400', label: 'nullable-parent-key', ancestor_a: null, ancestor_b: null },
];
const childRows = [{ id: 1, parent_a: '9007199254740993', parent_b: '12.3400', label: 'child-match' }, { id: 2, parent_a: null, parent_b: '12.3400', label: 'child-null' }];
interface ResourceManifest {
  version: 1; kind: 'dbark.fk-join-fixture'; database: string; ownerNonce: string; host: string; networkPort: 13384;
  server: { hostname: string; port: number; serverId: number; uuid: string; version: '8.4.11' };
  tables: { name: 'parent' | 'child'; ownerComment: string; ddlSha256: string; rowsSha256: string }[];
}

/** 仅身份标量允许驱动的规范十进制字符串表示；不转换业务BIGINT或DECIMAL。 */
function identityInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value === 'string' && (value.length > 16 || !/^(?:0|[1-9]\d*)$/.test(value))) throw Error('JOIN身份数值不是规范十进制整数');
  if (typeof value !== 'number' && typeof value !== 'string') throw Error('JOIN身份数值类型无效');
  const integer = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(integer) || integer < minimum || integer > maximum) throw Error('JOIN身份数值不在安全整数范围');
  return integer;
}

/** 本例只消费Root预置原件；固定随机库、13384与来源摘要，不创建用户、授权、表或数据库。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv); let retained = false;
  const assertCurrent = () => {
    try {
      if (retained || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || keys.some(key => process.env[key] !== values[key])) throw Error('JOIN原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(?:DBARK_|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$|NODE_PATH$)/i.test(key) && !(keys as readonly string[]).includes(key)) throw Error('JOIN专项拒绝额外入口或认证环境键');
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_FK_JOIN_UI !== '1' || !['192.168.31.200', 'deve-server.yinzon.com'].includes(values.DBARK_TEST_HOST ?? '') || values.DBARK_TEST_PORT !== '13384' || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || !values.DBARK_TEST_PASSWORD || !/^[a-f0-9-]{36}$/.test(values.DBARK_TEST_EXPECTED_SERVER_UUID ?? '') || !/^dbark_e2e_fkjoin_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('JOIN必须批准的200服务器13384唯一隔离库');
      for (const prefix of ['DBARK_FK_JOIN_MANIFEST', 'DBARK_FK_JOIN_RESOURCE_MANIFEST'] as const) if (!isAbsolute(values[prefix] ?? '') || !/^[a-f0-9]{64}$/.test(values[`${prefix}_SHA256`] ?? '')) throw Error('JOIN必须Root原来源及资源清单');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('JOIN拒绝替代运行器');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('JOIN禁止开启追踪');
    } catch (reason) { retained = true; throw reason; }
  };
  assertCurrent(); return { values, assertCurrent };
}

/** 精确资源清单只规定本例两表原件；字段、库名与摘要不从晚到响应重签。 */
function readResource(path: string, digest: string, environment: ReturnType<typeof bindEnvironment>): ResourceManifest {
  const stat = sync.lstatSync(path), bytes = sync.readFileSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || sync.realpathSync(path) !== path || bytes.length > 65536 || hash(bytes) !== digest) throw Error('JOIN资源清单原件未知');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as ResourceManifest;
  const fields = ['version', 'kind', 'database', 'ownerNonce', 'host', 'networkPort', 'server', 'tables'];
  if (!value || Object.keys(value).sort().join() !== fields.sort().join() || value.version !== 1 || value.kind !== 'dbark.fk-join-fixture' || value.database !== environment.values.DBARK_TEST_DATABASE || !/^[a-f0-9]{32}$/.test(value.ownerNonce) || value.host !== environment.values.DBARK_TEST_HOST || value.networkPort !== 13384 || !value.server || Object.keys(value.server).sort().join() !== 'hostname,port,serverId,uuid,version' || !value.server.hostname || !Number.isSafeInteger(value.server.port) || !Number.isSafeInteger(value.server.serverId) || value.server.uuid !== environment.values.DBARK_TEST_EXPECTED_SERVER_UUID || value.server.version !== '8.4.11' || !Array.isArray(value.tables) || value.tables.length !== 2) throw Error('JOIN资源清单不匹配批准目标');
  identityInteger(value.server.port, 1, 65535); identityInteger(value.server.serverId, 1, 0xffffffff);
  for (const [index, name] of ['parent', 'child'].entries()) {
    const table = value.tables[index];
    if (!table || Object.keys(table).sort().join() !== 'ddlSha256,name,ownerComment,rowsSha256' || table.name !== name || table.ownerComment !== `dbark-fkjoin:${value.ownerNonce}:${name}` || !/^[a-f0-9]{64}$/.test(table.ddlSha256) || table.rowsSha256 !== hash(JSON.stringify(name === 'parent' ? parentRows : childRows))) throw Error('JOIN表原件或已批准种子摘要不匹配');
  }
  return value;
}

/** 仅登记一条正式窗口复合例，失败后保留原库/应用/观察连接，不自行DROP或重试。 */
export function registerTableForeignKeyJoinUi() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configHash = hash(sync.readFileSync(configPath));
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>; type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ joinSource: { clock: Clock; identity: Identity; resource: ResourceManifest; check(): void } }>({
    joinSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('JOIN必须原配置单worker及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      const resource = readResource(environment.values.DBARK_FK_JOIN_RESOURCE_MANIFEST!, environment.values.DBARK_FK_JOIN_RESOURCE_MANIFEST_SHA256!, environment);
      const check = () => { clock.assertCurrent(); if (hash(sync.readFileSync(configPath)) !== configHash) throw Error('JOIN原配置字节变化'); readResource(environment.values.DBARK_FK_JOIN_RESOURCE_MANIFEST!, environment.values.DBARK_FK_JOIN_RESOURCE_MANIFEST_SHA256!, environment); clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>) => { check(); const value = await action(); check(); return value; };
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_FK_JOIN_MANIFEST!, environment.values.DBARK_FK_JOIN_MANIFEST_SHA256!, resolve('.'), { stat: path => checked(async () => { const item = await fs.lstat(path); return { file: item.isFile(), directory: item.isDirectory(), link: item.isSymbolicLink() }; }), real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)) }, check));
      if (identity.manifest.kind !== 'source') throw Error('本例仅验批准源码，不冒充安装包');
      try { await use({ clock, identity, resource, check }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ joinSource }, use) => { await use({ assertCurrent: joinSource.check, assertPreparation(info) { if (clocks.get(info) !== joinSource.clock) throw Error('JOIN原启动归属变化'); joinSource.check(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' }); nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('JOIN原生命周期未完整闭合，保留本例库与现场'); } });
  nativeTest('真实复合外键LEFT精确单次执行、NULL拒匹配与INNER/self草稿零执行', async ({ joinSource, trace, screenshot, video }, info) => {
    const { clock, identity, resource } = joinSource, original = ownedDesktopResources(info), application = original.application, page = original.page, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir, database = resource.database;
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, observerFailed = false, observerThread = 0, originalDirectory: { dev: number; ino: number } | undefined;
    const check = () => {
      joinSource.check(); const current = ownedDesktopResources(info);
      if (current.application !== application || current.page !== page || current.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observerFailed) throw Error('JOIN原实例或观察连接失效');
      if (originalDirectory) { const stat = sync.lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink() || sync.realpathSync(directory) !== directory || stat.dev !== originalDirectory.dev || stat.ino !== originalDirectory.ino) throw Error('JOIN原配置目录身份漂移'); }
      if (observer && ((observer as any).stream !== stream || observerThread > 0 && observer.threadId !== observerThread || observerClosed && stream.closed !== true || !observerClosed && stream.closed === true)) throw Error('JOIN原物理连接身份或关闭事实变化');
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const qualify = (table: string) => '`' + database + '`.`' + table + '`';
    const statements = {
      identity: 'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@server_uuid AS uuid,VERSION() AS version,CONNECTION_ID() AS threadId',
      tables: 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS ownerComment FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',
      parent: 'SELECT id,CAST(a AS CHAR) AS a,CAST(b AS CHAR) AS b,label,CAST(ancestor_a AS CHAR) AS ancestor_a,CAST(ancestor_b AS CHAR) AS ancestor_b FROM ' + qualify('parent') + ' ORDER BY id',
      child: 'SELECT id,CAST(parent_a AS CHAR) AS parent_a,CAST(parent_b AS CHAR) AS parent_b,label FROM ' + qualify('child') + ' ORDER BY id',
      parentDdl: 'SHOW CREATE TABLE ' + qualify('parent'), childDdl: 'SHOW CREATE TABLE ' + qualify('child'),
      capability: 'SELECT @@performance_schema AS enabled',
    };
    let processlist: TableDraftProcesslistPolicy | undefined;
    const resourceDiagnostics: { source: string; sqlSha256: string; warnings: unknown }[] = [];
    /** 原命令及紧随诊断共用原物理连接；只读资源用途单独适用已有精确弃用告警策略。 */
    const diagnosed = async (sql: string, values: (string | number)[], resourcePolicy?: TableDraftProcesslistPolicy): Promise<RowDataPacket[]> => {
      const query = (statement: string, parameters: (string | number)[] = []) => step(() => new Promise<RowDataPacket[]>((resolve, reject) => observer!.query({ sql: statement, values: parameters }, (error, rows) => error ? reject(error) : resolve(rows as RowDataPacket[]))));
      const rows = await query(sql, values), count = await query('SHOW COUNT(*) WARNINGS'), warnings = await query('SHOW WARNINGS LIMIT 2');
      if (resourcePolicy) { assertTableDraftProcesslistWarnings(resourcePolicy, count, warnings); resourceDiagnostics.push({ source: resourcePolicy.source, sqlSha256: hash(sql), warnings }); }
      else assertTableDraftNoWarnings(count, warnings);
      return rows;
    };
    /** 观察连接仅接受本文件固定核验语句，不接业务SQL，不改任何测试数据。 */
    const read = (sql: string, values: (string | number)[] = []): Promise<RowDataPacket[]> => {
      if (!Object.values(statements).includes(sql) || sql === statements.tables && (values.length !== 1 || values[0] !== database) || sql !== statements.tables && values.length) throw Error('JOIN观察SQL不属于本例精确只读集合');
      return diagnosed(sql, values);
    };
    /** 固定ids自身哨兵及collect唯一库；不允许调用者以任意SQL申请忽略warning。 */
    const resources = (request: TableDraftProcesslistRequest): Promise<RowDataPacket[]> => {
      if (!processlist || request.kind === 'database' || request.kind === 'ids' && (request.ids.length !== 1 || request.ids[0] !== observerThread) || request.kind === 'collect' && (request.database !== database || request.excludeId !== observerThread)) throw Error('JOIN资源观察用途或原物理身份未知');
      const query = tableDraftProcesslistQuery(processlist, request); return diagnosed(query.sql, query.values, processlist);
    };
    const sourceChecks: string[] = [];
    const verifySource = async (phase: string) => { await step(() => identity.assertCurrent()); sourceChecks.push(phase); };
    try {
      expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actualApp = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid })));
      await step(() => identity.assertActual(actualApp));
      const directoryStat = await step(() => fs.lstat(directory)); originalDirectory = { dev: directoryStat.dev, ino: directoryStat.ino }; check();
      const mysql = require('mysql2') as typeof import('mysql2');
      observer = mysql.createConnection({ host: resource.host, port: 13384, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, database, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true, multipleStatements: false, connectTimeout: 10000 });
      stream = (observer as any).stream; observer.on('error', () => { observerFailed = true; });
      await step(() => new Promise<void>((resolve, reject) => observer!.connect(error => error ? reject(error) : resolve()))); observerThread = identityInteger(observer.threadId, 1, Number.MAX_SAFE_INTEGER); check();
      const actualServer = await read(statements.identity); expect(actualServer).toHaveLength(1);
      const actualIdentity = actualServer.map(row => ({ ...row, port: identityInteger(row.port, 1, 65535), serverId: identityInteger(row.serverId, 1, 0xffffffff), threadId: identityInteger(row.threadId, 1, Number.MAX_SAFE_INTEGER) }));
      expect(actualIdentity).toEqual([{ ...resource.server, threadId: observerThread }]);
      processlist = selectTableDraftProcesslist('mysql', resource.server.version, await read(statements.capability));
      assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread);
      expect(await read(statements.tables, [database])).toEqual([...resource.tables].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, ownerComment }) => ({ name, ownerComment })));
      for (const table of resource.tables) { const ddl = await read(table.name === 'parent' ? statements.parentDdl : statements.childDdl); expect(ddl).toHaveLength(1); expect(hash(String(ddl[0]['Create Table']))).toBe(table.ddlSha256); }
      const beforeParent = await read(statements.parent), beforeChild = await read(statements.child); expect(beforeParent).toEqual(parentRows); expect(beforeChild).toEqual(childRows);
      await verifySource('实际启动及预置资源身份');
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const connection = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, 'JOIN本例'], [zh.connections.text009, resource.host], [zh.connections.text010, '13384'], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => connection.getByLabel(label, { exact: true }).fill(value));
      await step(() => connection.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => connection.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(connection).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
      expect(profile.port).toBe(13384); expect(profile.database).toBe(database); expect(profile.rememberPassword).toBe(false); expect(profile.password).toBeUndefined();
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) }); await step(() => node.getByRole('button', { name: profile.name, exact: true }).click());
      const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click()); await step(() => expect(databaseRow.getByRole('button', { name: database, exact: true })).toHaveAttribute('aria-expanded', 'true'));
      await step(() => node.locator('.object-row').getByRole('button', { name: 'child', exact: true }).click()); const sourceTable = page.locator('.table-tab:visible'); await step(() => expect(sourceTable.getByRole('grid')).toContainText('child-match'));
      await step(() => sourceTable.getByRole('gridcell').filter({ hasText: /^child-match$/ }).click()); await step(() => page.getByRole('button', { name: recordText.title, exact: true }).click()); const form = page.getByRole('complementary', { name: recordText.title, exact: true });
      const label = form.locator('.record-field').filter({ has: page.getByRole('heading', { name: /^label/ }) }); await step(() => label.getByRole('button', { name: recordText.editField, exact: true }).click()); await step(() => label.getByLabel('label · ' + recordText.value, { exact: true }).fill('local-only-join-draft')); await step(() => form.getByRole('button', { name: recordText.stage, exact: true }).click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible());
      // 原IPC只旁观/透传；唯一明确执行的SQL必须在执行按钮前逐字授权一次。
      await step(() => application.evaluate(({ ipcMain, BrowserWindow }, input) => {
        const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
        if (!previous || root.__fkJoinAudit || BrowserWindow.getAllWindows().length !== 1) throw Error('JOIN旁观原入口未知');
        const state = { pending: 0, calls: [] as { command: string; phase: string; taskId?: string; ok: boolean; result?: unknown }[], phase: 'join', session: '', allowed: undefined as string | undefined, executions: 0, check() {}, restore() {} };
        const check = () => { if (root.__fkJoinAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1) throw Error('JOIN旁观原IPC归属变化'); };
        const wrapped = async (event: any, payload: any) => {
          check(); if (event.sender !== window.webContents || event.senderFrame !== frame) throw Error('JOIN旁观来源变化');
          const command = String(payload?.command), request = payload?.input;
          if (command === 'sessions.open' && (request?.connectionId !== input.connectionId || request?.database !== input.database || state.session)) throw Error('JOIN查询会话目标变化或重复打开');
          if (command === 'query.execute') { if (!state.allowed || request?.sql !== state.allowed || state.executions || !state.session || request?.sessionId !== state.session) throw Error('JOIN禁止未逐字授权、错误会话或重复执行SQL'); state.allowed = undefined; state.executions++; }
          else if (/^(?:schema\.|files\.|excel\.|table\.(?:apply|preview)|query\.(?:executeParameterized|exportStream|analyze|transaction))/.test(command)) throw Error('JOIN禁止其它写入或执行用途');
          const fact = { command, phase: state.phase, taskId: typeof request?.taskId === 'string' ? request.taskId : undefined, ok: false, result: undefined as unknown }; state.calls.push(fact); state.pending++;
          try { const result = await previous(event, payload); check(); fact.ok = result?.ok === true; if (command === 'sessions.open' && fact.ok) { if (!result.result?.sessionId) throw Error('JOIN原会话回包缺少身份'); state.session = result.result.sessionId; } if (command === 'query.execute' && fact.ok) fact.result = result.result; return result; } finally { state.pending--; }
        };
        state.check = check; state.restore = () => { check(); if (state.pending || state.allowed) throw Error('JOIN原IPC或明确执行许可未收尾'); handlers.set('dbark:request', previous); delete root.__fkJoinAudit; };
        root.__fkJoinAudit = state; handlers.set('dbark:request', wrapped);
        if (!input.connectionId || !input.database) throw Error('JOIN旁观目标未知');
      }, { connectionId: profile.id, database }));
      const facts = () => step(() => application.evaluate(() => { const state = (globalThis as any).__fkJoinAudit; state.check(); return { pending: state.pending as number, calls: state.calls as { command: string; phase: string; taskId?: string; ok: boolean; result?: import('../../src/shared/contracts').QueryOutcome }[], executions: state.executions as number }; }));
      const sourceButton = page.locator('.tab-strip .workspace-tab-button').filter({ has: page.getByRole('button', { name: 'child', exact: true }) });
      const preview = async (kind: 'LEFT' | 'INNER', source: 'child' | 'parent') => {
        await step(() => page.locator('.table-tab:visible').getByRole('button', { name: text.entry, exact: true }).click()); const dialog = page.getByRole('dialog', { name: text.title, exact: true });
        await step(() => expect(dialog.getByLabel(text.joinKind, { exact: true })).toHaveValue('LEFT')); if (kind === 'INNER') await step(() => dialog.getByLabel(text.joinKind, { exact: true }).selectOption('INNER'));
        await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click()); const sqlView = dialog.getByRole('region', { name: text.preview, exact: true }).locator('pre'); await step(() => expect(sqlView).toBeVisible()); const sql = (await step(() => sqlView.textContent()))!;
        expect(sql).toContain(`\n${kind} JOIN ${qualify('parent')} AS p\nON\n`); expect(sql).not.toContain('<=>');
        const childNames = source === 'child' ? ['id', 'parent_a', 'parent_b', 'label'] : ['id', 'a', 'b', 'label', 'ancestor_a', 'ancestor_b'];
        const parentNames = ['id', 'a', 'b', 'label', 'ancestor_a', 'ancestor_b'];
        const mappings = [...sql.matchAll(/^  ([cp])\.`([a-z_]+)` AS `([a-z_0-9]+)`[,]?$/gm)].map(match => ({ side: match[1], column: match[2], alias: match[3] }));
        expect(mappings).toEqual([...childNames.map((column, index) => ({ side: 'c', column, alias: `c_${index + 1}_${column}` })), ...parentNames.map((column, index) => ({ side: 'p', column, alias: `p_${index + 1}_${column}` }))]); expect(new Set(mappings.map(item => item.alias)).size).toBe(mappings.length);
        expect(sql).toContain(`c.\`${source === 'child' ? 'parent_a' : 'ancestor_a'}\` = p.\`a\``); expect(sql).toContain(`c.\`${source === 'child' ? 'parent_b' : 'ancestor_b'}\` = p.\`b\``);
        const before = await facts(); expect(before.executions).toBe(source === 'child' && kind === 'LEFT' ? 0 : 1);
        await step(() => dialog.getByRole('button', { name: text.open, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
        await step(() => expect.poll(async () => { const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return settings.tabs.find(tab => tab.id === settings.activeTabId); }).toMatchObject({ kind: 'query', title: text.queryTitle(source), connectionId: profile.id, database, databaseContext: { state: 'known', database }, sql }));
        expect((await facts()).executions).toBe(before.executions); return { sql, mappings };
      };
      const left = await preview('LEFT', 'child'); expect(await read(statements.child)).toEqual(beforeChild); await step(() => expect(sourceButton.locator('.dirty-dot')).toHaveCount(1));
      await step(() => application.evaluate((_electron, sql) => { const state = (globalThis as any).__fkJoinAudit; state.check(); if (state.pending || state.allowed || state.executions) throw Error('JOIN明确执行前尚未空闲'); state.allowed = sql; }, left.sql));
      const query = page.locator('.query-tab:visible'); await step(() => query.getByRole('button', { name: /^执行(?:\s|$)/ }).click());
      await step(() => expect.poll(async () => { const state = await facts(); return state.pending === 0 && state.calls.filter(call => call.command === 'query.execute' && call.ok).length === 1; }).toBe(true));
      const execution = (await facts()).calls.find(call => call.command === 'query.execute')!; expect(execution.ok).toBe(true); const result = execution.result!; expect(result.failure).toBeUndefined(); expect(result.results).toHaveLength(1);
      const rows = result.results[0]; expect(rows.truncated).toBe(false); expect(rows.columns.map(column => column.name)).toEqual(left.mappings.map(item => item.alias)); expect(new Set(rows.columns.map(column => column.key)).size).toBe(left.mappings.length);
      const values = rows.rows.map(row => Object.fromEntries(rows.columns.map(column => [column.name, row[column.key]]))).sort((a, b) => Number(a.c_1_id) - Number(b.c_1_id));
      const expected = childRows.map((child, index) => Object.fromEntries(left.mappings.map(item => [item.alias, item.side === 'c' ? child[item.column as keyof typeof child] : index === 0 ? parentRows[0][item.column as keyof typeof parentRows[0]] : null])));
      expect(values).toEqual(expected); await verifySource('LEFT实际单次执行及精确NULL结果');
      await step(() => sourceButton.locator('.tab-select').click()); await step(() => expect(form.getByText(recordText.staged, { exact: true })).toBeVisible()); await step(() => expect(sourceTable.getByRole('grid')).toContainText('local-only-join-draft'));
      await preview('INNER', 'child'); await step(() => sourceButton.locator('.tab-select').click());
      await step(() => page.getByRole('button', { name: draftHistoryZh.undo, exact: true }).click()); await step(() => expect(form.getByText(recordText.unchanged, { exact: true })).toBeVisible());
      await step(() => application.evaluate(() => { const state = (globalThis as any).__fkJoinAudit; state.check(); state.phase = 'source-navigation'; }));
      await step(() => node.locator('.object-row').getByRole('button', { name: 'parent', exact: true }).click()); await step(() => expect(page.locator('.table-tab:visible').getByRole('grid')).toContainText('parent-leaf')); await step(() => expect.poll(async () => (await facts()).pending).toBe(0));
      await step(() => application.evaluate(() => { const state = (globalThis as any).__fkJoinAudit; state.check(); state.phase = 'join'; }));
      const self = await preview('LEFT', 'parent'); expect(self.sql).toContain('FROM ' + qualify('parent') + ' AS c');
      const audit = await facts(); expect(audit.pending).toBe(0); expect(audit.executions).toBe(1); expect(audit.calls.filter(call => call.command === 'sessions.open')).toHaveLength(1); const metadata = audit.calls.filter(call => call.command === 'metadata.table' && call.phase === 'join'); expect(metadata).toHaveLength(8); expect(metadata.every(call => call.ok && typeof call.taskId === 'string')).toBe(true); expect(new Set(metadata.map(call => call.taskId)).size).toBe(metadata.length);
      const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); for (const call of metadata) expect(tasks.find(task => task.id === call.taskId)).toMatchObject({ kind: 'metadata.table', status: 'completed' }); expect(tasks.some(task => task.status === 'running')).toBe(false);
      expect(await read(statements.parent)).toEqual(beforeParent); expect(await read(statements.child)).toEqual(beforeChild); expect(pageErrors).toEqual([]); await verifySource('INNER与self仅草稿及退出前');
      await step(() => application.evaluate(() => (globalThis as any).__fkJoinAudit.restore()));
      check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); assertTableDraftProcesslistVisible(await resources({ kind: 'ids', ids: [observerThread] }), observerThread); expect(await resources({ kind: 'collect', database, excludeId: observerThread })).toEqual([]); await closeMysqlConnection(observer, true); observerClosed = true; check(); await verifySource('原App及控制连接严格退出');
      await step(() => info.attach('外键JOIN精确单次执行与草稿证据', { body: Buffer.from(JSON.stringify({ kind: 'dbark.fk-join-ui', version: 1, database, server: resource.server, tables: resource.tables, sourceChecks, executions: audit.executions, leftSqlSha256: hash(left.sql), leftRows: values, innerNativeExecutionVerified: false, selfNativeExecutionVerified: false, nullChildUnmatched: true, compositeTupleAndPrecision: true, uniqueProjectedColumns: true, sourceDraftPreserved: true, sourceRowsUnchanged: true, metadataTaskIds: metadata.map(call => call.taskId), originalProcessExitCode: originalProcess.exitCode, observerClosed, targetThreadsAfterExit: 0, processlist, resourceDiagnostics, databaseRetainedForRoot: true, installerVerified: false, macOSVerified: false, sourceManifestSha256: environment.values.DBARK_FK_JOIN_MANIFEST_SHA256, resourceManifestSha256: environment.values.DBARK_FK_JOIN_RESOURCE_MANIFEST_SHA256 })), contentType: 'application/json' }));
      finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}
