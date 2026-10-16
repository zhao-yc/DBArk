import { randomBytes, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, execute, type ManagedConnection } from '../../../src/engine/connection';
import { identifier, qualified } from '../../../src/engine/sql';
import type { ConnectionProfile } from '../../../src/shared/contracts';
import { C02FixtureError, c02Failure, c02Names, c02OwnsTables, c02OwnsUser, cleanupC02, type C02Ownership } from './c02-mtls-policy';
import { c02SshConfig, c02SshVersion } from './c02-ssh-policy';

type Row = Record<string, unknown>;
export interface C02SshLease {
  readonly profile: ConnectionProfile; readonly database: string; readonly user: string; readonly marker: string; readonly tempParent: string;
  observeApplicationThreads(): Promise<number[]>;
}
export interface C02SshEvidence { port: number; version: string; ownerSupported: boolean; database: string; user: string; observedConnectionIds: number[] }

/** 固定受控说明不输出原配置、身份路径或认证错误。 */
function check(value: unknown, message: string): asserts value { if (!value) throw new C02FixtureError(message); }

/** 只发送一次SQL；超时销毁当前隧道的数据库流，不重放任何写操作。 */
async function sql(connection: ManagedConnection, text: string, params: (string | number)[] = []): Promise<Row[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([execute<Row[]>(connection, text, params).then(result => result.rows), new Promise<never>((_, reject) => { timer = setTimeout(() => {
    connection.broken = true; connection.connection.destroy(); (connection.connection as unknown as { stream?: { destroy(): void } }).stream?.destroy(); reject(new C02FixtureError('C02 SSH SQL超时，结果未知且不重试'));
  }, 10000); })]); } catch (error) { throw c02Failure('C02 SSH 数据库语句失败；未重试', error); } finally { clearTimeout(timer); }
}

/** 不重复旧核心：管理连接仅准备/观察精确资源，SSH正负认证及查询留给正式UI和utility。 */
export async function withC02SshLease(env: NodeJS.ProcessEnv, use: (lease: C02SshLease) => Promise<void>): Promise<C02SshEvidence> {
  const config = c02SshConfig(env), { database, user, account } = c02Names(randomBytes(6).toString('hex')), owner = randomBytes(16).toString('hex');
  const table = qualified(database, 'subject'), password = `Cp!9${randomBytes(24).toString('hex')}`;
  const profile: ConnectionProfile = { id: randomUUID(), name: 'C02 SSH 管理观察', group: '', color: '#123456', dialect: config.dialect, host: config.host, port: config.port, user: config.adminUser, password: config.adminPassword,
    ssh: { enabled: true, host: config.sshHost, port: config.sshPort, user: config.sshUser, privateKeyPath: config.keyPath, hostFingerprint: config.fingerprint },
    ...(config.caPath ? { tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath } } : {}) };
  let admin: ManagedConnection | undefined, failure: unknown, version = '', ownerSupported = false;
  let userOwnership: C02Ownership = 'absent', databaseOwnership: C02Ownership = 'absent';
  const ids = new Set<number>();
  /** 只核对文件元数据，不读、复制、哈希或改写现存私钥内容；正式驱动仅在ROOT执行时读取。 */
  const file = async (path: string): Promise<void> => { const info = await lstat(path); check(info.isFile() && !info.isSymbolicLink(), 'C02 SSH 显式身份或CA路径不是普通文件'); };
  /** 权限目录只允许subject表SELECT，不读认证哈希或执行SHOW GRANTS。 */
  const assertGrants = async (): Promise<void> => {
    const grants = await sql(admin!, 'SELECT TABLE_SCHEMA AS db,TABLE_NAME AS name,PRIVILEGE_TYPE AS privilege,IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?', [account]);
    check(grants.length === 1 && grants[0].db === database && grants[0].name === 'subject' && grants[0].privilege === 'SELECT' && grants[0].grantable === 'NO', 'C02 SSH 临时用户超出精确SELECT权限');
    for (const scope of ['SCHEMA', 'COLUMN', 'USER']) check((await sql(admin!, `SELECT PRIVILEGE_TYPE FROM information_schema.${scope}_PRIVILEGES WHERE GRANTEE=?${scope === 'USER' ? " AND PRIVILEGE_TYPE<>'USAGE'" : ''}`, [account])).length === 0, 'C02 SSH 临时用户出现额外授权');
    check((await sql(admin!, 'SELECT 1 FROM mysql.role_edges WHERE TO_USER=? AND TO_HOST=?', [user, '%'])).length === 0, 'C02 SSH 临时用户出现额外角色');
  };
  try {
    const parent = await lstat(config.tempParent); check(parent.isDirectory() && !parent.isSymbolicLink(), 'C02 SSH 显式临时父路径不是普通目录');
    await file(config.keyPath); if (config.caPath) await file(config.caPath);
    admin = await connect(profile);
    version = String((await sql(admin, 'SELECT VERSION() AS version'))[0]?.version);
    const support = c02SshVersion(config.port, version); check(support.targetMatches, 'C02 SSH 目标端口与实际版本不匹配，未创建对象'); ownerSupported = support.ownerSupported;
    if (ownerSupported) {
      const identity = (await sql(admin, 'SELECT @@server_uuid AS uuid,@@mandatory_roles AS roles'))[0];
      check(String(identity.uuid).toLowerCase() === config.serverUuid && identity.roles === '', 'C02 SSH MySQL身份或强制角色不匹配，未创建对象');
      const observation = await sql(admin, "SELECT Process_priv AS allowed FROM mysql.user WHERE CONCAT(User,'@',Host)=CURRENT_USER()");
      check(observation.length === 1 && observation[0].allowed === 'Y', 'C02 SSH 观察者缺少直接PROCESS权限，未创建对象');
      check((await sql(admin, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'C02 SSH 随机库已存在，拒绝接管');
      check((await sql(admin, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02 SSH 随机用户已存在，拒绝接管');
      databaseOwnership = 'unknown'; await sql(admin, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); databaseOwnership = 'confirmed';
      await sql(admin, `CREATE TABLE ${table} (id INT PRIMARY KEY,marker CHAR(32) NOT NULL) COMMENT='dbark-c02-owner:${owner}'`); await sql(admin, `INSERT INTO ${table} VALUES (1,?)`, [owner]);
      userOwnership = 'unknown'; await sql(admin, `CREATE USER ${account} IDENTIFIED BY '${password}'${config.caPath ? ' REQUIRE SSL' : ''} ATTRIBUTE '{"dbarkC02Owner":"${owner}"}'`); userOwnership = 'confirmed';
      await sql(admin, `GRANT SELECT ON ${table} TO ${account}`); await assertGrants();
      let active = true;
      try { await use({ profile: { ...profile, id: randomUUID(), name: 'C02 SSH 一次性SELECT', user, password, database }, database, user, marker: owner, tempParent: config.tempParent,
        observeApplicationThreads: async () => { check(active, 'C02 SSH 租约已归还'); return (await sql(admin!, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user])).map(row => { const id = Number(row.ID); check(Number.isSafeInteger(id) && id > 0, 'C02 SSH 线程编号无效'); ids.add(id); return id; }); },
      }); } finally { active = false; }
      await assertGrants();
    }
  } catch (error) { failure = c02Failure('C02 SSH 资源准备或正式UI回调失败', error); }
  try { await cleanupC02({ user: userOwnership, database: databaseOwnership, closeConnections: async () => {},
    verifyThreadsGone: async () => {
      if (userOwnership === 'absent' && databaseOwnership === 'absent') return;
      check(admin, 'C02 SSH 没有观察连接，不能证明清零');
      const deadline = Date.now() + 12000;
      do {
        const active = await sql(admin, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user]);
        const recorded = ids.size ? await sql(admin, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${[...ids].map(() => '?').join(',')})`, [...ids]) : [];
        if (!active.length && !recorded.length) return; await delay(100);
      } while (Date.now() < deadline);
      throw new C02FixtureError('C02 SSH 本例用户或已记录线程未清零，保留对象');
    },
    dropUser: async () => {
      const rows = await sql(admin!, "SELECT ATTRIBUTE->>'$.dbarkC02Owner' AS owner FROM information_schema.USER_ATTRIBUTES WHERE USER=? AND HOST=?", [user, '%']);
      check(c02OwnsUser(rows.map(row => ({ owner: row.owner })), owner), 'C02 SSH 用户令牌不匹配，拒绝DROP');
      await sql(admin!, `DROP USER ${account}`); check((await sql(admin!, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02 SSH 用户删除后仍存在');
    },
    dropDatabase: async () => {
      const rows = await sql(admin!, 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]);
      check(c02OwnsTables(rows.map(row => ({ name: row.name, comment: row.comment })), owner), 'C02 SSH 库所有权不匹配，拒绝DROP');
      for (const [catalog, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) check((await sql(admin!, `SELECT 1 FROM information_schema.${catalog} WHERE ${column}=?`, [database])).length === 0, 'C02 SSH 隔离库出现非本轮对象');
      await sql(admin!, `DROP DATABASE ${identifier(database)}`); check((await sql(admin!, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'C02 SSH 库删除后仍存在');
    },
    closeAdmin: async () => {
      if (!admin) return;
      const errors: unknown[] = [], adminId = admin.connection.threadId;
      try { await admin.close({ strict: true }); } catch (error) { errors.push(c02Failure('C02 SSH 管理隧道严格关闭失败', error)); }
      let observer: ManagedConnection | undefined;
      try {
        observer = await connect(profile); const all = [...ids, ...(adminId ? [adminId] : [])], deadline = Date.now() + 12000;
        while (all.length && (await sql(observer, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${all.map(() => '?').join(',')})`, all)).length) { check(Date.now() < deadline, 'C02 SSH 管理或应用线程仍存在'); await delay(100); }
      } catch (error) { errors.push(c02Failure('C02 SSH 独立逐ID核对失败', error)); }
      finally { try { await observer?.close({ strict: true }); } catch (error) { errors.push(c02Failure('C02 SSH 最后观察隧道严格关闭失败', error)); } }
      if (errors.length) throw new AggregateError(errors, 'C02 SSH 观察连接收尾失败', { cause: errors[0] });
    },
    // 不生成、复制或删除任何SSH身份材料；应用自己的userData已在回调finally精确清理。
    removeTemporaryFiles: async () => {},
  }, failure); } catch (error) { throw new C02FixtureError(`C02 SSH 失败；精确用户 ${user}、库 ${database}；CREATE确认状态：用户 ${userOwnership}、库 ${databaseOwnership}`, { cause: error }); }
  return { port: config.port, version, ownerSupported, database, user, observedConnectionIds: [...ids] };
}
