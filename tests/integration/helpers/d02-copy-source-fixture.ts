import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { checkServerIdentity, type TLSSocket } from 'node:tls';
import { setTimeout as delay } from 'node:timers/promises';
import mysql, { type Connection } from 'mysql2';
import { Engine } from '../../../src/engine';
import { connect, execute, type ManagedConnection } from '../../../src/engine/connection';
import { identifier, qualified } from '../../../src/engine/sql';
import { validateCommand } from '../../../src/shared/validation';
import type { Command, CommandMap, ConnectionProfile, TablePage, TaskEvent } from '../../../src/shared/contracts';
import type { TableCopySourceReadResult } from '../../../src/shared/tableCopySource';
import { cleanupD02Copy, d02CopyNames, d02Fact, d02Failure, d02OwnsTables, D02FixtureError, type D02CopyConfig, type D02Ownership } from './d02-copy-source-policy';

type Row = Record<string, unknown>;
type Parameter = string | number | boolean | null | Buffer;
export interface D02CopyCase {
  database: string; table: string; profile: ConnectionProfile; events: TaskEvent[];
  dispatch<K extends Command>(command: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']>;
  adminSource(): Promise<{ page: TablePage; read(): Promise<TableCopySourceReadResult>; release(): Promise<void> }>;
  page(): Promise<TablePage>; read(page: TablePage, taskId?: string): Promise<TableCopySourceReadResult>;
  release(page: TablePage): Promise<void>; observe(): Promise<Row[]>;
  sql(text: string, values?: Parameter[]): Promise<Row[]>;
  write(text: string, values?: Parameter[]): Promise<void>; recreate(): Promise<void>;
  openBlocker(): Promise<ManagedConnection>; statement(connection: ManagedConnection, text: string): Promise<void>;
  driverIds(): number[]; driverCount(): number; assertGone(ids: number[]): Promise<void>;
  assertGrants(): Promise<void>; assertSame(left: unknown, right: unknown, message: string): void;
}

/** 只在双门开启、目标配置通过后动态导入本模块；真实mysql2只被旁路记录，不替换SQL或返回。 */
export async function withD02CopyCase(config: D02CopyConfig, action: (context: D02CopyCase) => Promise<void>, limited = false): Promise<void> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12), owner = randomUUID().replaceAll('-', ''), names = d02CopyNames(suffix, limited);
  const { database, user, account } = names, table = qualified(database, 'subject'), password = 'D02!' + randomBytes(24).toString('hex');
  const events: TaskEvent[] = [], engine = new Engine(event => events.push(event));
  const drivers = new Set<Connection>(), ids = new Set<number>(), tlsProofs = new Map<Connection, boolean>(), connections = new Set<ManagedConnection>();
  let observer: ManagedConnection | undefined, databaseState: D02Ownership = 'absent', userState: D02Ownership = 'absent', uncertainWrite = false, failure: unknown;
  let preservation: Error | undefined, userDeleted = false, databaseDeleted = false, userDropAcknowledged = false, databaseDropAcknowledged = false;
  /** 一次验证无法判定即永久失效；保留第一个安全因果链，后续读取恢复也不能重新授权写入。 */
  const preserve = (error: unknown) => { preservation ??= d02Failure('D02验证或操作无法确认，永久保留现场', error); };
  const verify = async <T>(action: () => Promise<T>): Promise<T> => { try { return await action(); } catch (error) { preserve(error); throw error; } };
  /** 与CREATE确认状态独立；每次真正发送夹具写操作前同步检查，不能在await后绕过标记。 */
  const requireWriteAuthorization = () => { if (preservation || uncertainWrite) throw preservation ?? new D02FixtureError('D02写结果未知，禁止后续写操作'); };
  const admin: ConnectionProfile = { id: randomUUID(), name: 'D02隔离观察', group: '', color: '#123456', dialect: 'mysql', host: config.host, port: config.port, user: config.user, password: config.password, ...(config.tls ? { tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath } } : {}) };
  const profile: ConnectionProfile = limited ? { ...admin, id: randomUUID(), name: 'D02临时仅SELECT', database, user, password } : { ...admin, id: randomUUID(), name: 'D02完整源正式Engine', database };
  const factory = mysql.createConnection;
  mysql.createConnection = ((...args: Parameters<typeof factory>) => {
    const driver = factory(...args); drivers.add(driver);
    driver.once('connect', () => {
      if (Number.isSafeInteger(driver.threadId) && Number(driver.threadId) > 0) ids.add(driver.threadId!);
      const socket = (driver as unknown as { stream?: TLSSocket }).stream;
      try { tlsProofs.set(driver, socket?.encrypted === true && socket.authorized === true && !socket.authorizationError && checkServerIdentity(config.host, socket.getPeerCertificate(true)) === undefined); }
      catch { tlsProofs.set(driver, false); }
    });
    return driver;
  }) as typeof mysql.createConnection;
  /** 夹具SQL超时只强制本地收尾并报告未知，不把socket销毁当作服务器完成或重放依据。 */
  const fixtureQuery = async <T>(connection: ManagedConnection, text: string, values: Parameter[] = []): Promise<{ rows: T }> => {
    // 所有现有DROP共用最终发送门；不能从观察/锁端口绕过已永久失效的授权。
    if (/^\s*DROP\b/i.test(text)) requireWriteAuthorization();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([execute<T>(connection, text, values), new Promise<never>((_, reject) => { timer = setTimeout(() => { connection.broken = true; connection.connection.destroy(); reject(new D02FixtureError('D02夹具SQL超时，服务器结果未知且未重放')); }, 10000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  /** 任意夹具写语句只发送一次；错误按未知结果保留现场，不能重放或反向补偿。 */
  const write = async (text: string, values: Parameter[] = []): Promise<void> => { requireWriteAuthorization(); try { await fixtureQuery(observer!, text, values); } catch (error) { uncertainWrite = true; preserve(error); throw d02Failure('D02夹具写响应未知，保留现场且未重放', error); } };
  /** 观察端只取显式指定的本轮目录、线程和subject事实，不记录完整查询日志。 */
  const sql = async (text: string, values: Parameter[] = []): Promise<Row[]> => verify(async () => (await fixtureQuery<Row[]>(observer!, text, values)).rows);
  /** 出现额外权限或归属漂移时同步保留全部资源，后续DROP回调也不能绕过。 */
  const owned = (condition: unknown, message: string): void => { if (!condition) { const error = new D02FixtureError(message); preserve(error); throw error; } };
  /** 只允许精确subject的SELECT，不执行SHOW GRANTS，不增加PROCESS或任何全局权限。 */
  const assertGrants = async (): Promise<void> => verify(async () => {
    if (!limited || userState !== 'confirmed') return;
    const grants = await sql('SELECT TABLE_SCHEMA AS db,TABLE_NAME AS name,PRIVILEGE_TYPE AS privilege,IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?', [account]);
    owned(grants.length === 1 && grants[0].db === database && grants[0].name === 'subject' && grants[0].privilege === 'SELECT' && grants[0].grantable === 'NO', 'D02账号权限不再是精确subject SELECT，保留现场');
    for (const scope of ['SCHEMA', 'COLUMN', 'USER']) owned((await sql(`SELECT PRIVILEGE_TYPE FROM information_schema.${scope}_PRIVILEGES WHERE GRANTEE=?${scope === 'USER' ? " AND PRIVILEGE_TYPE<>'USAGE'" : ''}`, [account])).length === 0, 'D02账号存在额外权限，保留现场');
    owned((await sql('SELECT 1 FROM mysql.role_edges WHERE TO_USER=? AND TO_HOST=?', [user, '%'])).length === 0, 'D02账号存在角色授权，保留现场');
  });
  /** 精确线程归零由独立观察连接确认；不把本地socket关闭或全零不可见结果当作证据。 */
  const assertGone = async (targetIds: number[]): Promise<void> => verify(async () => {
    d02Fact(targetIds.every(id => Number.isSafeInteger(id) && id > 0 && id !== observer?.connection.threadId), 'D02待核线程编号无效');
    const end = Date.now() + 12000;
    do { const rows = targetIds.length ? await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (' + targetIds.map(() => '?').join(',') + ')', targetIds) : []; if (!rows.length) return; await delay(100); } while (Date.now() < end);
    throw new D02FixtureError('D02真实线程尚未归还，保留账号和库');
  });
  /** 两个DROP共用同一重核门；线程、账号及subject归属全部可判定才授权一次删除。 */
  const verifyDeletion = async (): Promise<void> => {
    requireWriteAuthorization();
    await verify(async () => {
      owned(databaseState !== 'unknown' && userState !== 'unknown', 'D02真实CREATE确认状态仍未知，禁止任何DROP');
      await verifyThreadsGone();
      if (limited && userState === 'confirmed') {
        if (userDeleted) owned((await sql('SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'D02已删除账号再次出现，保留现场');
        else { await assertGrants(); const rows = await sql("SELECT ATTRIBUTE->>'$.dbarkD02Owner' AS owner FROM information_schema.USER_ATTRIBUTES WHERE USER=? AND HOST=?", [user, '%']); owned(rows.length === 1 && rows[0].owner === owner, 'D02账号归属已变化，拒绝删除'); }
      }
      if (databaseState === 'confirmed' && !databaseDeleted) {
        const tables = await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]);
        owned(tables.length === 1 && d02OwnsTables(tables.map(row => ({ name: row.name, comment: row.comment })), owner), 'D02subject缺失、存在未知表或归属已变化，拒绝删除');
        for (const [catalog, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) owned((await sql(`SELECT 1 FROM information_schema.${catalog} WHERE ${column}=?`, [database])).length === 0, 'D02库中存在非本轮对象，拒绝删除');
      }
    });
    requireWriteAuthorization();
  };
  /** 即使在清理阶段也永久记录无法判定；观察动作仍可继续，但其成功不能清除保留标记。 */
  const verifyThreadsGone = async (): Promise<void> => verify(async () => {
    if (!observer) { d02Fact(databaseState === 'absent' && userState === 'absent', 'D02无观察连接，保留对象'); return; }
    d02Fact([...drivers].every(driver => Number.isSafeInteger(driver.threadId) && Number(driver.threadId) > 0), 'D02存在无法核对编号的连接，保留现场');
    if (config.tls) d02Fact([...drivers].every(driver => tlsProofs.get(driver) === true), 'D02真实连接缺少严格TLS证据');
    await assertGone([...ids].filter(id => id !== observer!.connection.threadId));
    if (limited) d02Fact((await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user])).length === 0, 'D02临时账号仍有线程，保留对象');
  });
  /** 每次CREATE TABLE都附本轮归属标记，重建用例也不借用原业务表。 */
  const recreate = async (): Promise<void> => {
    await write(`CREATE TABLE ${table} (id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,note VARCHAR(40) NOT NULL,hidden_big BIGINT UNSIGNED INVISIBLE DEFAULT 7,hidden_decimal DECIMAL(30,6) INVISIBLE DEFAULT 0,hidden_stamp DATETIME(6) INVISIBLE,hidden_null TEXT INVISIBLE,hidden_blob MEDIUMBLOB INVISIBLE,computed INT GENERATED ALWAYS AS(LENGTH(note)) STORED) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin COMMENT='dbark-d02-owner:${owner}'`);
    await write(`INSERT INTO ${table}(id,note,hidden_big,hidden_decimal,hidden_stamp,hidden_null,hidden_blob) VALUES (?,?,?,?,?,?,?)`, ['9007199254740993', '源记录', '18446744073709551615', '12345678901234567890.120000', '2026-10-16 01:02:03.123456', null, Buffer.from([0, 255, 128, 0])]);
  };
  /** 公开输入先经过正式校验，再进入正式Engine.handle分发和实际mysql2驱动。 */
  const dispatch = async <K extends Command>(command: K, input: CommandMap[K]['input']): Promise<CommandMap[K]['output']> => {
    const checked = validateCommand(command, input);
    return engine.handle(command, { ...checked as object, ...(command === 'connections.open' ? { profile } : {}) });
  };
  const page = () => dispatch('table.page', { connectionId: profile.id, database, table: 'subject', page: 1, pageSize: 50, filters: [], sort: [], copySource: true, taskId: randomUUID() });
  /** 引用只能来自真实页结果；不能由辅助层伪造租约、键值或complete标志。 */
  const read = (source: TablePage, taskId = randomUUID()) => {
    d02Fact(source.copySource?.status === 'ready' && source.copySource.rowRefs[0], 'D02本轮页没有可验证的行来源');
    return dispatch('table.copySourceRead', { connectionId: profile.id, taskId, pageRef: source.copySource.pageRef, rowRef: source.copySource.rowRefs[0] });
  };
  const release = async (source: TablePage) => { d02Fact(source.copySource?.status === 'ready', 'D02待释放来源不完整'); await dispatch('table.copySourceRelease', { connectionId: profile.id, pageRef: source.copySource.pageRef }); };
  try {
    if (config.tls) { const file = await lstat(config.caPath!); d02Fact(file.isFile() && !file.isSymbolicLink(), 'D02原CA不是普通文件'); d02Fact(createHash('sha256').update(await readFile(config.caPath!)).digest('hex') === config.caSha256, 'D02原CA摘要不匹配，未创建连接或对象'); }
    observer = await connect(admin);
    if (config.tls) { d02Fact(tlsProofs.get(observer.connection) === true, 'D02观察连接的原CA认证或目标IP身份不匹配，未创建对象'); const cipher = (await sql("SHOW SESSION STATUS LIKE 'Ssl_cipher'"))[0]?.Value; d02Fact(typeof cipher === 'string' && cipher.length > 0, 'D02观察连接没有实际TLS会话cipher，未创建对象'); }
    const fact = (await sql('SELECT @@server_uuid AS uuid,VERSION() AS version,@@lower_case_table_names AS names,@@version_compile_os AS os,@@mandatory_roles AS roles'))[0];
    d02Fact(String(fact?.uuid).toLowerCase() === config.serverUuid && /^8\.4\./.test(String(fact?.version)) && Number(fact?.names) === 0 && ['linux', 'debian-linux-gnu'].includes(String(fact?.os).toLowerCase()) && fact?.roles === '', 'D02实例UUID或已批准的MySQL8.4/Linux条件不符，未创建对象');
    const process = await sql("SELECT Process_priv AS allowed FROM mysql.user WHERE CONCAT(User,'@',Host)=CURRENT_USER()"); d02Fact(process.length === 1 && process[0].allowed === 'Y', 'D02既有观察账号缺少直接PROCESS权限；不自动扩权');
    const instrument = await sql("SELECT ENABLED AS enabled FROM performance_schema.setup_instruments WHERE NAME='wait/lock/metadata/sql/mdl'"); d02Fact(instrument.length === 1 && instrument[0].enabled === 'YES', 'D02服务器未提供真实MDL观察条件；不自动修改全局设置');
    d02Fact((await sql('SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?', [observer.connection.threadId!])).length === 1, 'D02观察连接不能看见自身线程，拒绝零线程假证据');
    d02Fact((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'D02随机库已存在，拒绝接管');
    if (limited) d02Fact((await sql('SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'D02随机账号已存在，拒绝接管');
    console.info(JSON.stringify({ D02准备: database, 临时用户: limited ? user : '未创建', 端口: config.port, 实例UUID: config.serverUuid, 严格TLS: config.tls }));
    databaseState = 'unknown'; await write('CREATE DATABASE ' + identifier(database) + ' CHARACTER SET utf8mb4 COLLATE utf8mb4_bin'); databaseState = 'confirmed'; await recreate();
    if (limited) { userState = 'unknown'; await write(`CREATE USER ${account} IDENTIFIED BY '${password}' ATTRIBUTE '{"dbarkD02Owner":"${owner}"}'`); userState = 'confirmed'; await write(`GRANT SELECT ON ${table} TO ${account}`); await assertGrants(); }
    await dispatch('connections.open', { id: profile.id });
    await action({ database, table, profile, events, dispatch, page, read, release, sql, write, recreate, assertGrants,
      adminSource: async () => {
        d02Fact(limited, 'D02管理员旧来源只用于同轮限权归属负例');
        const previous = { ...admin, id: randomUUID(), database };
        await engine.handle('connections.open', { ...validateCommand('connections.open', { id: previous.id }) as object, profile: previous });
        const source = await engine.handle('table.page', validateCommand('table.page', { connectionId: previous.id, database, table: 'subject', page: 1, pageSize: 50, filters: [], sort: [], copySource: true, taskId: randomUUID() }) as object) as TablePage;
        return { page: source,
          read: async () => { d02Fact(source.copySource?.status === 'ready' && source.copySource.rowRefs[0], 'D02管理员旧来源未真实签发'); return engine.handle('table.copySourceRead', validateCommand('table.copySourceRead', { connectionId: previous.id, taskId: randomUUID(), pageRef: source.copySource.pageRef, rowRef: source.copySource.rowRefs[0] }) as object); },
          release: async () => { d02Fact(source.copySource?.status === 'ready', 'D02管理员旧来源未真实签发'); await engine.handle('table.copySourceRelease', validateCommand('table.copySourceRelease', { connectionId: previous.id, pageRef: source.copySource.pageRef }) as object); },
        };
      },
      observe: () => sql(`SELECT CAST(id AS CHAR) AS id,note,CAST(hidden_big AS CHAR) AS big,CAST(hidden_decimal AS CHAR) AS amount,DATE_FORMAT(hidden_stamp,'%Y-%m-%d %H:%i:%s.%f') AS stamp,hidden_null AS nullable,HEX(hidden_blob) AS blob,OCTET_LENGTH(hidden_blob) AS blobBytes,computed FROM ${table} ORDER BY id`),
      openBlocker: async () => verify(async () => { const blocker = await connect(admin); connections.add(blocker); return blocker; }),
      statement: async (connection, text) => { try { await fixtureQuery(connection, text); } catch (error) { preserve(error); throw d02Failure('D02锁连接操作失败，未重放', error); } },
      driverIds: () => [...ids].filter(id => id !== observer?.connection.threadId), driverCount: () => drivers.size, assertGone,
      assertSame: (left, right, message) => owned(isDeepStrictEqual(left, right), message),
    });
    await assertGrants(); d02Fact(events.length === 0, 'D02只读来源意外发送任务事件');
  } catch (error) { preserve(error); failure = d02Failure(`D02验收失败；本轮数据库${database}；临时用户${limited ? user : '未创建'}`, error); }
  try {
    await cleanupD02Copy({ user: userState, database: databaseState,
      closeConnections: async () => verify(async () => { const errors: unknown[] = []; try { await engine.closeAll(); } catch (error) { errors.push(d02Failure('D02引擎关闭失败', error)); } const results = await Promise.allSettled([...connections].map(connection => connection.close({ strict: true }))); results.forEach(result => { if (result.status === 'rejected') errors.push(d02Failure('D02锁连接关闭失败', result.reason)); }); if (errors.length) throw new AggregateError(errors, 'D02真实连接收尾失败'); }),
      verifyThreadsGone,
      dropUser: async () => { await verifyDeletion(); await write(`DROP USER ${account}`); userDropAcknowledged = true; await verify(async () => { d02Fact((await sql('SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'D02账号删除后仍存在'); userDeleted = true; }); },
      dropDatabase: async () => { await verifyDeletion(); await write('DROP DATABASE ' + identifier(database)); databaseDropAcknowledged = true; await verify(async () => { d02Fact((await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'D02数据库删除后仍存在'); databaseDeleted = true; }); },
      closeAdmin: async () => verify(async () => { await observer?.close({ strict: true }); }), removeTemporaryFiles: async () => undefined,
    }, uncertainWrite, failure ?? preservation);
    console.info(JSON.stringify({ D02清理: database, Engine及锁线程已观察归零: true, 临时账号已删除: limited, 数据库已删除: true, 观察连接: '已严格关闭' }));
  } catch (error) { throw d02Failure(`D02验收或清理失败；保留现场核对入口${database}/${limited ? user : '无临时用户'}；真实CREATE状态：用户${userState}、库${databaseState}；DROP成功响应：用户${userDropAcknowledged}、库${databaseDropAcknowledged}；确认删除：用户${userDeleted}、库${databaseDeleted}`, error); }
  finally { mysql.createConnection = factory; }
}
