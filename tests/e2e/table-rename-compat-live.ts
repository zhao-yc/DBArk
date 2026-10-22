import type { TestInfo } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import { resolve, win32 } from 'node:path';
import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir } from './desktop-fixture';
import { bindEditorIndentNativeCase } from './editor-indentation-native-gate';
import { sealEditorIndentLaunchIdentity } from './editor-indentation-native-identity';
import { closeMysqlConnection } from '../../src/engine/connection';
import { tableRenameZh as text } from '../../src/renderer/locales/tableRename.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

// 本轮Root只读探针的静态身份；MySQL额外核UUID，MariaDB不查询不存在的server_uuid。
const servers = {
  '13357': { version: '5.7.44', hostname: '4718e6a259bf', serverId: '0', port: '3306', os: 'Linux', lowerNames: '0', dialect: 'mysql' },
  '13310': { version: '10.11.19-MariaDB-ubu2204', hostname: '3e3cd19a73e0', serverId: '1', port: '3306', os: 'debian-linux-gnu', lowerNames: '0', dialect: 'mariadb' },
  '13311': { version: '11.4.13-MariaDB-ubu2404', hostname: '77df3519cfc9', serverId: '1', port: '3306', os: 'debian-linux-gnu', lowerNames: '0', dialect: 'mariadb' },
} as const;
const mysqlUuid = 'f4cf2aa8-c730-11f1-8b89-223553c03441';
const keys = ['DBARK_INTEGRATION_ENABLED', 'DBARK_TABLE_RENAME_COMPAT_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_RENAME_COMPAT_MARKER', 'DBARK_TABLE_RENAME_COMPAT_MANIFEST', 'DBARK_TABLE_RENAME_COMPAT_MANIFEST_SHA256'] as const;

/** 只绑定Root预置的单个随机库；环境发生漂移后永久失效，不退回默认端口或凭据文件。 */
function bindEnvironment() {
  const values = Object.fromEntries(keys.map(key => [key, process.env[key]])) as Record<typeof keys[number], string | undefined>;
  const args = JSON.stringify(process.argv), relevant = () => JSON.stringify(Object.keys(process.env).filter(key => /^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort().map(key => [key, process.env[key]]));
  const originalEnvironment = relevant(); let failed = false;
  const assertCurrent = () => {
    try {
      if (failed || process.platform !== 'win32' || JSON.stringify(process.argv) !== args || relevant() !== originalEnvironment) throw Error('表重命名兼容原环境已变化');
      for (const key of Object.keys(process.env)) if (/^(DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key) && key !== key.toUpperCase()) throw Error('表重命名兼容拒绝环境大小写别名');
      const port = values.DBARK_TEST_PORT;
      if (values.DBARK_INTEGRATION_ENABLED !== '1' || values.DBARK_TABLE_RENAME_COMPAT_UI !== '1' || values.DBARK_TEST_HOST !== '192.168.31.200' || !port || !Object.hasOwn(servers, port) || values.DBARK_TEST_TLS !== '0' || !values.DBARK_TEST_USER || typeof values.DBARK_TEST_PASSWORD !== 'string' || !/^dbark_e2e_rncp_ui_[a-f0-9]{32}$/.test(values.DBARK_TEST_DATABASE ?? '')) throw Error('表重命名兼容仅允许Root绑定200三个旧基线端口和唯一随机库');
      if (port === '13357' ? values.DBARK_TEST_EXPECTED_SERVER_UUID !== mysqlUuid : Object.hasOwn(process.env, 'DBARK_TEST_EXPECTED_SERVER_UUID')) throw Error('表重命名兼容MySQL须准确UUID，MariaDB不接受伪造UUID');
      if (!values.DBARK_TABLE_RENAME_COMPAT_MARKER || values.DBARK_TABLE_RENAME_COMPAT_MARKER.length > 128 || values.DBARK_TABLE_RENAME_COMPAT_MARKER.includes('\0')) throw Error('表重命名兼容缺少Root准确的原表注释标记');
      if (!values.DBARK_TABLE_RENAME_COMPAT_MANIFEST || !win32.isAbsolute(values.DBARK_TABLE_RENAME_COMPAT_MANIFEST) || !/^[a-f0-9]{64}$/.test(values.DBARK_TABLE_RENAME_COMPAT_MANIFEST_SHA256 ?? '')) throw Error('表重命名兼容缺少Root批准的绝对来源清单和SHA256');
      for (const key of ['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_TEST_CA', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) if (Object.hasOwn(process.env, key)) throw Error('表重命名兼容源码专项拒绝替代运行或TLS环境');
      if (process.argv.some(value => /^(?:--(?:ui|debug|config)|-c)(?:=|$)/.test(value))) throw Error('表重命名兼容拒绝替代配置或交互运行');
      for (const [index, value] of process.argv.entries()) if (value === '--trace' && process.argv[index + 1] !== 'off' || value.startsWith('--trace=') && value !== '--trace=off') throw Error('表重命名兼容禁止CLI开启trace');
    } catch (reason) { failed = true; throw reason; }
  };
  assertCurrent();
  return { values, server: servers[values.DBARK_TEST_PORT as keyof typeof servers], assertCurrent };
}

/** 只登记正式源码App的一次往返；准备、授权、数据插入与精确清理全部由Root负责。 */
export function registerTableRenameCompatUiTests() {
  const environment = bindEnvironment(), configPath = resolve('playwright.config.ts'), configurationHash = createHash('sha256').update(sync.readFileSync(configPath)).digest('hex');
  type Clock = ReturnType<typeof bindEditorIndentNativeCase>;
  type Identity = Awaited<ReturnType<typeof sealEditorIndentLaunchIdentity>>;
  const clocks = new Map<TestInfo, Clock>(), finished = new WeakSet<TestInfo>(); let retained = false;
  const nativeTest = test.extend<{ tableRenameCompatSource: { clock: Clock; identity: Identity; assertConfiguration(): void } }>({
    tableRenameCompatSource: async ({}, use, info) => {
      const clock = bindEditorIndentNativeCase(info, { assertCurrent() { environment.assertCurrent(); if (retained || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.config.configFile !== configPath || info.project.retries !== 0 || info.project.repeatEach !== 1) throw Error('表重命名兼容必须原配置、单worker、原120秒及零重试'); } }, () => nativeTest.info());
      clocks.set(info, clock);
      /** 每个用户await前后核配置，完整清单每个FS await仍核原clock和环境。 */
      const assertConfiguration = () => { clock.assertCurrent(); try { if (createHash('sha256').update(sync.readFileSync(configPath)).digest('hex') !== configurationHash) throw Error('表重命名兼容配置字节已变化'); } catch (reason) { retained = true; clock.retain(); throw reason; } clock.assertCurrent(); };
      const checked = async <T,>(action: () => Promise<T>): Promise<T> => { clock.assertCurrent(); const value = await action(); clock.assertCurrent(); return value; };
      assertConfiguration();
      const identity = await checked(() => sealEditorIndentLaunchIdentity(environment.values.DBARK_TABLE_RENAME_COMPAT_MANIFEST!, environment.values.DBARK_TABLE_RENAME_COMPAT_MANIFEST_SHA256!, resolve('.'), {
        stat: path => checked(async () => { const value = await fs.lstat(path); return { file: value.isFile(), directory: value.isDirectory(), link: value.isSymbolicLink() }; }),
        real: path => checked(() => fs.realpath(path)), list: path => checked(() => fs.readdir(path)), bytes: path => checked(() => fs.readFile(path)),
      }, () => clock.assertCurrent()));
      assertConfiguration(); if (identity.manifest.kind !== 'source') throw Error('表重命名兼容专项仅接受批准源码App，不冒充安装版');
      try { await use({ clock, identity, assertConfiguration }); } finally { clocks.delete(info); }
    },
    ownedDesktopLaunchGuard: async ({ tableRenameCompatSource }, use) => { await use({ assertCurrent: () => tableRenameCompatSource.assertConfiguration(), assertPreparation(info) { if (clocks.get(info) !== tableRenameCompatSource.clock) throw Error('表重命名兼容原启动归属变化'); tableRenameCompatSource.assertConfiguration(); } }); },
  });
  nativeTest.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
  nativeTest.describe.configure({ mode: 'serial', retries: 0, timeout: 120000 });
  nativeTest.afterEach(({}, info) => { if (!finished.has(info)) { retained = true; clocks.get(info)?.retain(); retainOwnedDesktopResources(info); throw Error('表重命名兼容原App、控制连接或证据尚未闭合，保留随机库和现场'); } });
  nativeTest('旧基线真实侧栏改名及表页恢复，原物理实体和完整定义保持', async ({ tableRenameCompatSource, trace, screenshot, video }, info) => {
    const { clock, identity, assertConfiguration } = tableRenameCompatSource, captured = ownedDesktopResources(info), page = captured.page, application = captured.application, originalProcess = application.process(), frame = page.mainFrame(), directory = dataDir;
    const database = environment.values.DBARK_TEST_DATABASE!, port = Number(environment.values.DBARK_TEST_PORT), server = environment.server;
    const quote = (name: string) => String.fromCharCode(96) + name + String.fromCharCode(96), qualified = (name: 'subject' | 'renamed_subject') => quote(database) + '.' + quote(name);
    let closed = false, observerClosed = false, observer: Connection | undefined, stream: any, originalDirectory: { dev: number; ino: number } | undefined;
    const errors: string[] = []; page.on('pageerror', reason => errors.push(reason.message));
    /** 保持原进程、窗口、profile与观察器原流；任何漂移都不重试或自动清理。 */
    const check = () => {
      assertConfiguration(); const owner = ownedDesktopResources(info);
      if (owner.page !== page || owner.application !== application || owner.closed !== closed || dataDir !== directory || !closed && (application.process() !== originalProcess || page.mainFrame() !== frame || frame.isDetached()) || observer && ((observer as any).stream !== stream || observerClosed !== (stream?.closed === true))) throw Error('表重命名兼容原资源身份变化');
      if (originalDirectory) { const value = sync.lstatSync(directory); if (!value.isDirectory() || value.isSymbolicLink() || sync.realpathSync(directory) !== directory || value.dev !== originalDirectory.dev || value.ino !== originalDirectory.ino) throw Error('表重命名兼容原profile身份变化'); }
    };
    const step = async <T,>(action: () => Promise<T>): Promise<T> => { check(); try { const value = await action(); check(); return value; } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; } };
    const phases = ['实际启动身份', '原表与提交前', '改名及恢复核验', '退出客户端前', '退出与控制收尾后'], sourceChecks: string[] = []; let sourcePending = false;
    /** 五个阶段完整重读原来源，不扩称所有Main IPC或每个UI事件都受全量审计。 */
    const verifySource = async (phase: string, actual?: Parameters<Identity['assertActual']>[0]) => { check(); if (sourcePending || phases[sourceChecks.length] !== phase) throw Error('表重命名兼容来源阶段失配'); sourcePending = true; await step(() => identity.assertCurrent()); if (actual) await step(() => identity.assertActual(actual)); sourceChecks.push(phase); sourcePending = false; };
    const statements = {
      identity: 'SELECT VERSION() AS version,@@hostname AS hostname,CAST(@@server_id AS CHAR) AS serverId,CAST(@@port AS CHAR) AS port,@@version_compile_os AS os,CAST(@@lower_case_table_names AS CHAR) AS lowerNames,CONNECTION_ID() AS threadId' + (server.dialect === 'mysql' ? ',@@server_uuid AS uuid' : ''),
      exists: 'SELECT TABLE_NAME AS name,TABLE_TYPE AS type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? ORDER BY BINARY TABLE_NAME',
      tableInfo: 'SELECT ENGINE,ROW_FORMAT,TABLE_COLLATION,CAST(AUTO_INCREMENT AS CHAR) AS AUTO_INCREMENT,TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
      statistics: 'SELECT TABLE_CATALOG,TABLE_SCHEMA,TABLE_NAME,NON_UNIQUE,INDEX_SCHEMA,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,CARDINALITY,SUB_PART,PACKED,NULLABLE,INDEX_TYPE,COMMENT,INDEX_COMMENT FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY BINARY INDEX_NAME,SEQ_IN_INDEX',
      columns: 'SELECT TABLE_CATALOG,TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH,CHARACTER_OCTET_LENGTH,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_TYPE,COLUMN_KEY,EXTRA,PRIVILEGES,COLUMN_COMMENT,GENERATION_EXPRESSION FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
      physical: 'SELECT CAST(TABLE_ID AS CHAR) AS tableId,NAME AS name FROM INFORMATION_SCHEMA.INNODB_SYS_TABLES WHERE CAST(NAME AS BINARY)=CAST(? AS BINARY)',
      threads: 'SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE DB=? AND ID<>?',
    };
    const names = ['subject', 'renamed_subject'] as const;
    const dataSql = (name: typeof names[number]) => 'SELECT CAST(id AS CHAR) AS id,HEX(s) AS s,CAST(g AS CHAR) AS g,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload,CAST(at_time AS CHAR) AS at_time FROM ' + qualified(name) + ' ORDER BY id';
    const definitions = names.map(name => 'SHOW CREATE TABLE ' + qualified(name)), dataQueries = names.map(dataSql);
    /** 观察器只接受固定只读目录及准确名称；不承担fixture创建、填充、授权或DROP。 */
    const read = (sql: string, params: (string | number)[] = []): Promise<RowDataPacket[]> => {
      const pair = [statements.tableInfo, statements.statistics, statements.columns].includes(sql), name = params[1];
      if (pair ? params.length !== 2 || params[0] !== database || !names.some(value => value === name)
        : sql === statements.exists ? params.length !== 1 || params[0] !== database
        : sql === statements.physical ? params.length !== 1 || !names.some(value => params[0] === database + '/' + value)
        : sql === statements.threads ? params.length !== 2 || params[0] !== database || !Number.isSafeInteger(params[1])
        : ![statements.identity, ...definitions, ...dataQueries].includes(sql) || params.length !== 0) throw Error('表重命名兼容观察SQL越界');
      return step(() => new Promise((done, reject) => observer!.query<RowDataPacket[]>({ sql, values: params }, (error, rows) => error ? reject(error) : done(rows))));
    };
    try {
      check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
      const actual = await step(() => application.evaluate(({ app }) => ({ executable: process.execPath, appPath: app.getAppPath(), resources: process.resourcesPath, packaged: app.isPackaged, pid: process.pid }))); await verifySource('实际启动身份', actual);
      const profileStat = await step(() => fs.lstat(directory)); expect(profileStat.isDirectory() && !profileStat.isSymbolicLink()).toBe(true); expect(await step(() => fs.realpath(directory))).toBe(directory); originalDirectory = { dev: profileStat.dev, ino: profileStat.ino };
      const mysql = require('mysql2') as typeof import('mysql2');
      observer = mysql.createConnection({ host: environment.values.DBARK_TEST_HOST, port, user: environment.values.DBARK_TEST_USER, password: environment.values.DBARK_TEST_PASSWORD, supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false, multipleStatements: false, charset: 'UTF8MB4_BIN', connectTimeout: 10000 }); stream = (observer as any).stream;
      await step(() => new Promise<void>((done, reject) => observer!.connect(error => error ? reject(error) : done())));
      const facts = await read(statements.identity); expect(facts).toHaveLength(1); const threadId = Number(facts[0].threadId), { dialect: _dialect, ...expectedIdentity } = server;
      expect(Object.fromEntries(Object.keys(expectedIdentity).map(key => [key, String(facts[0][key])]))).toEqual(expectedIdentity); expect(Number.isSafeInteger(threadId) && threadId > 0).toBe(true);
      if (server.dialect === 'mysql') expect(facts[0].uuid).toBe(mysqlUuid); else expect(Object.hasOwn(facts[0], 'uuid')).toBe(false);
      expect(await read(statements.exists, [database])).toEqual([{ name: 'subject', type: 'BASE TABLE' }]);
      const authority = await read(dataSql('subject')), originalDefinitionRows = await read(definitions[0]), originalStatistics = await read(statements.statistics, [database, 'subject']), originalColumns = await read(statements.columns, [database, 'subject']), originalTable = await read(statements.tableInfo, [database, 'subject']), originalPhysical = await read(statements.physical, [database + '/subject']);
      expect(authority).toEqual([
        { id: '-9', s: null, g: null, amount: '12345678901234567890.1234567890', payload: '0000FF', at_time: '2001-02-03 04:05:06.123456' },
        { id: '0', s: '', g: '0', amount: '0.0000000001', payload: '', at_time: '2002-03-04 05:06:07.654321' },
        { id: '9007199254740993', s: 'C3A9', g: '2', amount: '-1.0000000001', payload: null, at_time: '2003-04-05 06:07:08.000001' },
      ]);
      expect(originalDefinitionRows).toHaveLength(1); const originalDefinition = String(originalDefinitionRows[0]['Create Table']); expect(originalDefinition.startsWith('CREATE TABLE ' + quote('subject') + ' (')).toBe(true);
      expect(originalPhysical).toHaveLength(1); const tableId = originalPhysical[0].tableId; expect(typeof tableId === 'string' && /^[1-9][0-9]{0,19}$/.test(tableId)).toBe(true); expect(originalPhysical[0].name).toBe(database + '/subject');
      expect(originalTable).toHaveLength(1); expect(originalTable[0]).toMatchObject({ ENGINE: 'InnoDB', TABLE_COLLATION: 'utf8mb4_bin', AUTO_INCREMENT: '9007199254740994', TABLE_COMMENT: environment.values.DBARK_TABLE_RENAME_COMPAT_MARKER });
      expect(originalStatistics.map(row => [row.INDEX_NAME, Number(row.SEQ_IN_INDEX), row.COLUMN_NAME, Number(row.NON_UNIQUE), row.SUB_PART === null ? null : Number(row.SUB_PART)])).toEqual([['PRIMARY', 1, 'id', 0, null], ['pref', 1, 's', 1, 8]]);
      expect(originalColumns.map(row => row.COLUMN_NAME)).toEqual(['id', 's', 'g', 'amount', 'payload', 'at_time']); expect(originalColumns[2].EXTRA).toMatch(/STORED GENERATED|PERSISTENT/); expect(originalColumns[2].GENERATION_EXPRESSION).toMatch(/length/i);
      await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.newConnection, exact: true }).click()); const form = page.getByRole('dialog', { name: zh.common.newConnection, exact: true });
      for (const [label, value] of [[zh.connections.text006, '表重命名兼容本例'], [zh.connections.text009, environment.values.DBARK_TEST_HOST!], [zh.connections.text010, String(port)], [zh.common.user, environment.values.DBARK_TEST_USER!], [zh.connections.text011, environment.values.DBARK_TEST_PASSWORD!], [zh.connections.text012, database]]) await step(() => form.getByLabel(label, { exact: true }).fill(value));
      // Field包裹select和全部选项，完整标签包含选项文字；按唯一真实控件及完整选项身份定位。
      const dialectControl = form.getByRole('combobox'); await step(() => expect(dialectControl).toHaveCount(1)); await step(() => expect(dialectControl).toBeEnabled());
      const dialectOptions = dialectControl.locator('option'); await step(() => expect(dialectOptions).toHaveText(['MySQL', 'MariaDB']));
      await step(() => expect(dialectOptions.nth(0)).toHaveAttribute('value', 'mysql')); await step(() => expect(dialectOptions.nth(1)).toHaveAttribute('value', 'mariadb')); await step(() => expect(dialectControl).toHaveValue('mysql'));
      await step(() => dialectControl.selectOption(server.dialect)); await step(() => expect(dialectControl).toHaveValue(server.dialect));
      await step(() => form.getByLabel(zh.connections.text016, { exact: true }).uncheck()); await step(() => form.getByRole('button', { name: zh.connections.text036, exact: true }).click()); await step(() => expect(form).toBeHidden());
      const profiles = await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {}))); expect(profiles).toHaveLength(1); const profile = profiles[0];
      expect(Boolean(profile.name === '表重命名兼容本例' && profile.host === '192.168.31.200' && profile.port === port && profile.database === database && profile.user === environment.values.DBARK_TEST_USER && profile.dialect === server.dialect && profile.rememberPassword === false && !profile.ssh?.enabled && !profile.tls?.enabled)).toBe(true);
      const sender = await step(() => application.evaluate(({ webContents }) => { const windows = webContents.getAllWebContents().filter(item => item.getType() === 'window'); if (windows.length !== 1) throw Error('表重命名兼容原主窗口不唯一'); return windows[0].id; }));
      // 只限制本例schema.tableRename三类请求；保留原Main处理器与Engine回包，不扩称全IPC审计。
      await step(() => application.evaluate(({ ipcMain }, input) => {
        const handlers = (ipcMain as any)._invokeHandlers, original = handlers.get('dbark:request'), root = globalThis as any;
        if (typeof original !== 'function' || root.__tableRenameCompatOwner) throw Error('表重命名兼容原Main观察器归属未知');
        const state = { gets: [] as any[], previews: [] as any[], applies: [] as any[], pending: 0 }, snapshots = new Map<string, { source: string; hash: string }>(), plans = new Map<string, { source: string; destination: string; acknowledgements: string[] }>(), tasks = new Set<string>();
        const wrapped = async (event: any, payload: any) => {
          const command = payload?.command, value = payload?.input, permitted = ['schema.tableRename.get', 'schema.tableRename.preview', 'schema.tableRename.apply'];
          if (['query.execute', 'table.commit', 'table.truncate', 'table.drop', 'schema.apply'].includes(command)) throw Error('表重命名兼容专项禁止其它产品写入');
          if (!permitted.includes(command)) return original(event, payload);
          if (event.sender.id !== input.sender || event.senderFrame !== event.sender.mainFrame || typeof value?.taskId !== 'string' || !value.taskId || tasks.has(value.taskId) || state.pending !== 0) throw Error('表重命名兼容原sender或任务身份变化');
          const source = state.applies.length === 0 ? 'subject' : 'renamed_subject', destination = source === 'subject' ? 'renamed_subject' : 'subject';
          let kind: 'gets' | 'previews' | 'applies', entry: any;
          if (command === 'schema.tableRename.get') {
            if (Object.keys(value).sort().join(',') !== 'connectionId,database,table,taskId' || value.connectionId !== input.id || value.database !== input.database || value.table !== source || state.gets.length !== state.applies.length || state.gets.length >= 2) throw Error('表重命名兼容get超出准确两次原表读取');
            kind = 'gets'; entry = { source };
          } else if (command === 'schema.tableRename.preview') {
            const owner = snapshots.get(value.snapshotId);
            if (Object.keys(value).sort().join(',') !== 'newName,snapshotId,taskId' || !owner || owner.source !== source || value.newName !== destination || state.previews.length !== state.applies.length || state.previews.length >= 2) throw Error('表重命名兼容preview超出原读取和准确往返名称');
            kind = 'previews'; entry = { source, destination, hash: owner.hash };
          } else {
            const plan = plans.get(value.previewToken);
            if (Object.keys(value).sort().join(',') !== 'acknowledgements,previewToken,taskId' || !plan || plan.source !== source || plan.destination !== destination || JSON.stringify(value.acknowledgements) !== JSON.stringify(plan.acknowledgements) || state.applies.length >= 2) throw Error('表重命名兼容apply不属于原预览的单次三确认');
            plans.delete(value.previewToken); kind = 'applies'; entry = { source, destination };
          }
          state[kind].push(entry); state.pending++; tasks.add(value.taskId);
          try {
            const reply = await original(event, payload); if (reply?.ok !== true) throw Error('表重命名兼容原请求未成功'); const result = reply.result;
            if (kind === 'gets') {
              if (result?.target?.connectionId !== input.id || result.target.database !== input.database || result.target.table !== source || result.writable !== true || result.tableId !== input.tableId || result.serverVersion !== input.version || !Array.isArray(result.reasons) || result.reasons.length !== 0 || typeof result.ddlHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.ddlHash)) throw Error('表重命名兼容真实读取未明确授权原物理实体');
              entry.tableId = result.tableId; snapshots.set(result.snapshotId, { source, hash: result.ddlHash });
            }
            if (kind === 'previews') {
              const q = (name: string) => String.fromCharCode(96) + name + String.fromCharCode(96), expectedSql = 'RENAME TABLE ' + q(input.database) + '.' + q(source) + ' TO ' + q(input.database) + '.' + q(destination) + ';', risks = ['ddl-implicit-commit', 'external-ddl-window', 'references-and-grants'];
              if (result?.target?.connectionId !== input.id || result.target.database !== input.database || result.target.table !== source || result.before !== source || result.after !== destination || result.ddlHash !== entry.hash || result.sql !== expectedSql || !Array.isArray(result.requiredAcknowledgements) || result.requiredAcknowledgements.length !== 3 || new Set(result.requiredAcknowledgements).size !== 3 || !risks.every(id => result.requiredAcknowledgements.includes(id))) throw Error('表重命名兼容真实预览不属于完整准确RENAME和三确认');
              entry.sql = result.sql; plans.set(result.previewToken, { source, destination, acknowledgements: [...result.requiredAcknowledgements] });
            }
            if (kind === 'applies') {
              if (result?.target?.connectionId !== input.id || result.target.database !== input.database || result.target.table !== source || result.newTarget?.connectionId !== input.id || result.newTarget.database !== input.database || result.newTarget.table !== destination || result.ddlSubmitted !== true || result.ddlCompleted !== true || result.definitionVerified !== true || result.after?.tableId !== input.tableId || !/^[a-f0-9]{64}$/.test(result.after?.physicalIdentity ?? '') || !/^[a-f0-9]{64}$/.test(result.after?.ddlHash ?? '') || state.applies.length === 2 && state.applies[0].result?.physicalIdentity !== result.after.physicalIdentity) throw Error('表重命名兼容实际DDL未完成原实体和完整定义核验');
              entry.result = { ddlSubmitted: result.ddlSubmitted, ddlCompleted: result.ddlCompleted, definitionVerified: result.definitionVerified, ...result.after };
            }
            return reply;
          } finally { state.pending--; }
        };
        handlers.set('dbark:request', wrapped); root.__tableRenameCompatOwner = { handlers, wrapped, state };
      }, { id: profile.id, database, sender, tableId, version: server.version }));
      const state = () => step(() => application.evaluate(() => {
        const owner = (globalThis as any).__tableRenameCompatOwner; if (!owner || owner.handlers.get('dbark:request') !== owner.wrapped) throw Error('表重命名兼容原Main观察器已变化');
        return owner.state as { gets: { source: string; tableId: string }[]; previews: { source: string; destination: string; sql: string }[]; applies: { source: string; destination: string; result: { ddlSubmitted: boolean; ddlCompleted: boolean; definitionVerified: boolean; tableId: string; ddlHash: string; physicalIdentity: string } }[]; pending: number };
      }));
      const node = page.locator('.connection-node').filter({ has: page.getByRole('button', { name: profile.name, exact: true }) });
      await step(() => node.getByRole('button', { name: profile.name, exact: true }).click()); const databaseRow = node.locator('.database-row').filter({ has: page.getByRole('button', { name: database, exact: true }) }); await step(() => databaseRow.getByRole('button', { name: database, exact: true }).click());
      const object = (name: typeof names[number]) => node.locator('.object-row').filter({ has: page.getByRole('button', { name, exact: true }) });
      await step(() => object('subject').getByRole('button', { name: 'subject', exact: true }).click());
      const table = page.locator('.table-tab:visible'), dialog = page.getByRole('dialog', { name: text.title, exact: true });
      /** 真实新表页应有本例三行；只读settings核新标签ID，不调用workspace setter或flush。 */
      const visibleTable = async (name: typeof names[number]) => {
        await step(() => expect(table.locator('.context-bar')).toContainText(name)); await step(() => expect(table.locator('.loading-overlay')).toHaveCount(0));
        await step(() => expect(table.locator(':scope > .error-box')).toHaveCount(0)); await step(() => expect(table.locator('.results-grid')).toBeVisible());
        const header = table.getByRole('columnheader', { name: /^id/ }); await step(() => expect(header).toHaveCount(1)); const index = await step(() => header.getAttribute('aria-colindex')); if (!index) throw Error('表重命名兼容真实网格缺少id坐标');
        for (const [offset, id] of ['-9', '0', '9007199254740993'].entries()) await step(() => expect(table.locator('[role="row"][aria-rowindex="' + (offset + 2) + '"] [role="gridcell"][aria-colindex="' + index + '"]')).toHaveText(id));
        await step(() => expect.poll(async () => { const value = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); return value.tabs.map(tab => [tab.kind, tab.table]); }).toEqual([['table', name]]));
        const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(settings.tabs).toHaveLength(1); expect(settings.activeTabId).toBe(settings.tabs[0].id);
        expect(settings.tabs[0]).toMatchObject({ connectionId: profile.id, database, table: name, kind: 'table', title: name }); return settings.tabs[0].id;
      };
      const initialTabId = await visibleTable('subject'), initialNode = await step(() => table.elementHandle()); if (!initialNode) throw Error('原表页DOM缺失');
      // focus-within让真实侧栏行操作可见，不使用force click或任意延时。
      await step(() => object('subject').getByRole('button', { name: 'subject', exact: true }).focus()); await step(() => object('subject').getByRole('button', { name: text.title + ' subject', exact: true }).click());
      /** 两方向都通过名称输入和固定SQL只读预览；不发测试自造preview/apply IPC。 */
      const prepare = async (source: typeof names[number], destination: typeof names[number]) => {
        await step(() => expect(dialog.getByRole('textbox', { name: text.newName, exact: true })).toBeEnabled()); await step(() => expect(dialog.getByRole('textbox', { name: text.newName, exact: true })).toHaveValue(source));
        await step(() => dialog.getByRole('textbox', { name: text.newName, exact: true }).fill(destination)); await step(() => dialog.getByRole('button', { name: text.preview, exact: true }).click());
        await step(() => expect(dialog.getByRole('heading', { name: text.fixedSql, exact: true })).toBeVisible()); const editor = dialog.locator('.monaco-editor'), lines = editor.locator('.view-lines'), expected = ('RENAME TABLE ' + qualified(source) + ' TO ' + qualified(destination) + ';').replace(/ /g, '\u00a0');
        await step(() => expect.poll(async () => (await step(() => lines.innerText())).replace(/\r?\n/g, '')).toBe(expected)); const before = await step(() => lines.innerText());
        await step(() => editor.click()); await step(() => page.keyboard.type('cannot_edit')); await step(() => expect.poll(() => step(() => lines.innerText())).toBe(before));
        await step(() => expect(dialog.getByRole('checkbox')).toHaveCount(3)); await step(() => expect(dialog.getByRole('button', { name: text.apply, exact: true })).toBeDisabled());
      };
      /** 原表、新表两名称均只读核验；定义仅替换CREATE首行中的原表名。 */
      const verifyDatabase = async (name: typeof names[number]) => {
        const other = name === 'subject' ? 'renamed_subject' : 'subject';
        expect(await read(statements.exists, [database])).toEqual([{ name, type: 'BASE TABLE' }]); expect(await read(dataSql(name))).toEqual(authority);
        const definition = await read('SHOW CREATE TABLE ' + qualified(name)); expect(definition).toHaveLength(1); expect(String(definition[0]['Create Table'])).toBe(originalDefinition.replace('CREATE TABLE ' + quote('subject'), 'CREATE TABLE ' + quote(name)));
        expect(await read(statements.tableInfo, [database, name])).toEqual(originalTable);
        expect(await read(statements.statistics, [database, name])).toEqual(originalStatistics.map(row => ({ ...row, TABLE_NAME: name })));
        expect(await read(statements.columns, [database, name])).toEqual(originalColumns.map(row => ({ ...row, TABLE_NAME: name })));
        expect(await read(statements.physical, [database + '/' + name])).toEqual([{ tableId, name: database + '/' + name }]); expect(await read(statements.physical, [database + '/' + other])).toEqual([]);
      };
      /** 每个方向只单击一次，并等待App关闭弹窗及实际对象树刷新。 */
      const apply = async (source: typeof names[number], destination: typeof names[number]) => {
        for (const label of [text.ackImplicit, text.ackWindow, text.ackReferences]) await step(() => dialog.getByRole('checkbox', { name: label, exact: true }).check());
        await step(() => dialog.getByRole('button', { name: text.apply, exact: true }).click()); await step(() => expect(dialog).toBeHidden());
        await step(() => expect(object(source)).toHaveCount(0)); await step(() => expect(object(destination)).toHaveCount(1)); return visibleTable(destination);
      };
      await prepare('subject', 'renamed_subject'); await verifyDatabase('subject'); expect((await state()).applies).toHaveLength(0); await verifySource('原表与提交前');
      const screenshotPath = resolve(info.outputPath('表重命名兼容SQL与风险预览.png')); await step(() => dialog.screenshot({ path: screenshotPath })); const screenshotSha256 = createHash('sha256').update(await step(() => fs.readFile(screenshotPath))).digest('hex');
      const renamedTabId = await apply('subject', 'renamed_subject'); expect(renamedTabId).not.toBe(initialTabId); expect(await step(() => initialNode.evaluate(element => element.isConnected))).toBe(false); await verifyDatabase('renamed_subject'); expect((await state()).applies).toHaveLength(1);
      const renamedNode = await step(() => table.elementHandle()); if (!renamedNode) throw Error('改名后的真实表页DOM缺失');
      await step(() => table.getByRole('button', { name: text.title, exact: true }).click()); await prepare('renamed_subject', 'subject'); await verifyDatabase('renamed_subject'); expect((await state()).applies).toHaveLength(1);
      const restoredTabId = await apply('renamed_subject', 'subject'); expect(new Set([initialTabId, renamedTabId, restoredTabId]).size).toBe(3); expect(await step(() => renamedNode.evaluate(element => element.isConnected))).toBe(false); await verifyDatabase('subject'); await verifySource('改名及恢复核验');
      const final = await state(); expect(final.gets.map(item => item.source)).toEqual(['subject', 'renamed_subject']); expect(final.previews.map(item => [item.source, item.destination])).toEqual([['subject', 'renamed_subject'], ['renamed_subject', 'subject']]); expect(final.applies.map(item => [item.source, item.destination])).toEqual([['subject', 'renamed_subject'], ['renamed_subject', 'subject']]); expect(final.applies.every(item => item.result.definitionVerified && item.result.tableId === tableId)).toBe(true); expect(final.applies[0].result.physicalIdentity).toBe(final.applies[1].result.physicalIdentity); expect(final.pending).toBe(0);
      expect(await step(() => page.evaluate(() => window.dbark.invoke('history.list', {})))).toEqual([]); expect(errors).toEqual([]);
      await verifySource('退出客户端前'); check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); expect(await read(statements.threads, [database, threadId])).toEqual([]); await closeMysqlConnection(observer, true); observerClosed = true; check(); expect(stream.closed).toBe(true); await verifySource('退出与控制收尾后'); expect(sourceChecks).toEqual(phases); expect(errors).toEqual([]);
      await step(() => info.attach('表重命名兼容专项终态', { body: Buffer.from(JSON.stringify({
        kind: 'dbark.table-rename-compat-ui', version: 1, platform: process.platform, endpointPort: port, database,
        serverIdentity: { ...expectedIdentity, ...(server.dialect === 'mysql' ? { uuid: mysqlUuid } : {}) }, normalExit: closed, observerClosed, originalProcessExitCode: originalProcess.exitCode, targetThreadsAfterExit: 0, databaseRetainedForRoot: true,
        originalRowsPreserved: true, originalDefinitionRestored: true, completeCommonIndexCatalogPreserved: true, completeColumnCatalogPreserved: true, originalTableId: tableId, physicalIdentityStable: true,
        directions: [['subject', 'renamed_subject'], ['renamed_subject', 'subject']], entries: ['sidebar', 'table'], tableTabIds: [initialTabId, renamedTabId, restoredTabId], oldTableNodesDetached: true, objectDirectoryRefreshed: true, previewWrites: 0, applyRequests: 2,
        audit: final, source: { manifestSha256: environment.values.DBARK_TABLE_RENAME_COMPAT_MANIFEST_SHA256, phases: sourceChecks }, screenshot: { path: screenshotPath, sha256: screenshotSha256 }, pageErrors: errors,
        querySqlPreservationVerified: false, favoriteMigrationVerified: false, staleObjectLinkVerified: false, mainIpcAuditVerified: false, systemClipboard: 0, installerVerified: false, macOSVerified: false,
      })), contentType: 'application/json' })); finished.add(info);
    } catch (reason) { retained = true; clock.retain(); retainOwnedDesktopResources(info); throw reason; }
  });
}
