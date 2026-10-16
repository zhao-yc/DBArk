import { randomBytes, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, execute, type ManagedConnection } from '../../../src/engine/connection';
import { identifier, qualified } from '../../../src/engine/sql';
import type { ConnectionProfile } from '../../../src/shared/contracts';
import { c02Failure, c02Names, c02OwnsTables, c02OwnsUser, cleanupC02, C02FixtureError, withC02UiLifetime, type C02Ownership } from './c02-mtls-policy';
import { c02OpenSshConfig, c02OpenSshProof, c02OpenSshCheck as check, type C02OpenSshServerPolicy } from './c02-openssh-policy';
import { readC02OpenSshMaterials, readC02OpenSshProofRecord } from './c02-openssh-materials';

export type C02OpenSshMode = 'password' | 'encrypted-key';
export interface C02OpenSshLease {
  database: string; user: string; marker: string; tempParent: string;
  serverPolicy: C02OpenSshServerPolicy;
  profile(mode: C02OpenSshMode): ConnectionProfile;
  observeApplicationThreads(): Promise<number[]>;
}
type Row = Record<string, unknown>;

/** 写操作只发送一次；所有原始异常在离开本片前脱敏，连接超时销毁且不重放。 */
async function sql(connection: ManagedConnection, source: string, params: (string | number)[] = []): Promise<Row[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([execute<Row[]>(connection, source, params).then(result => result.rows), new Promise<never>((_, reject) => { timer = setTimeout(() => { connection.broken = true; connection.connection.destroy(); reject(new C02FixtureError('C02隔离OpenSSH SQL超时，结果未知且不重试')); }, 10000); })]); }
  catch (error) { throw c02Failure('C02隔离OpenSSH数据库步骤失败', error); } finally { clearTimeout(timer); }
}

/** 本片不部署服务器、不复制Root私钥；只消费已核验的新材料和ROOT实际容器证明。 */
export async function withC02OpenSshLease(env: NodeJS.ProcessEnv, mode: 'CORE' | 'UI', use: (lease: C02OpenSshLease) => Promise<void>) {
  const config = c02OpenSshConfig(env, mode);
  const { materials, proof } = await (async () => {
    try {
      check(config.proofPath === join(config.directory, 'server-proof.json'), 'C02核对记录必须位于本片材料目录');
      const materials = await readC02OpenSshMaterials(config.directory);
      const proof = c02OpenSshProof(await readC02OpenSshProofRecord(config.directory), materials.manifest, config); return { materials, proof };
    } catch (error) { throw c02Failure('C02本片材料或ROOT实际服务器核对失败，尚未建连', error); }
  })();
  if (config.caPath) { const ca = await lstat(config.caPath); check(ca.isFile() && !ca.isSymbolicLink(), 'C02严格TLS需要显式公证书普通文件'); }
  const { database, user, account } = c02Names(randomBytes(6).toString('hex')), marker = randomBytes(16).toString('hex'), password = 'Cp!9' + randomBytes(24).toString('hex');
  const adminProfile: ConnectionProfile = { id: randomUUID(), name: 'C02隔离OpenSSH管理观察', group: '', color: '#123456', dialect: 'mysql', host: '192.168.31.200', port: config.port, user: config.adminUser, password: config.adminPassword, ...(config.caPath ? { tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath } } : {}) };
  const limited: ConnectionProfile = { ...adminProfile, id: randomUUID(), name: `C02隔离SSH ${database}`, database, user, password };
  const ids = new Set<number>(); let admin: ManagedConnection | undefined, failure: unknown, version = '';
  let userOwnership: C02Ownership = 'absent', databaseOwnership: C02Ownership = 'absent';
  // 授权失效不可由后续成功复位；CREATE归属仍保留为真实状态，不能伪装unknown。
  let grantsInvalid = false;
  const assertGrants = async () => {
    check(!grantsInvalid, 'C02授权范围已失效，保留精确用户和库');
    try {
      const grants = await sql(admin!, 'SELECT TABLE_SCHEMA AS db,TABLE_NAME AS name,PRIVILEGE_TYPE AS privilege,IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?', [account]);
      check(grants.length === 1 && grants[0].db === database && grants[0].name === 'subject' && grants[0].privilege === 'SELECT' && grants[0].grantable === 'NO', 'C02临时账号必须只有subject SELECT');
      for (const scope of ['SCHEMA', 'COLUMN', 'USER']) check((await sql(admin!, `SELECT PRIVILEGE_TYPE FROM information_schema.${scope}_PRIVILEGES WHERE GRANTEE=?${scope === 'USER' ? " AND PRIVILEGE_TYPE<>'USAGE'" : ''}`, [account])).length === 0, 'C02临时账号出现额外授权');
      check((await sql(admin!, 'SELECT 1 FROM mysql.role_edges WHERE TO_USER=? AND TO_HOST=?', [user, '%'])).length === 0, 'C02临时账号出现额外角色');
    } catch (error) { grantsInvalid = true; throw error; }
  };
  try {
    admin = await connect(adminProfile);
    const identity = (await sql(admin, 'SELECT VERSION() AS version,@@server_uuid AS uuid,@@mandatory_roles AS roles'))[0]; version = String(identity?.version);
    check(/^8\.4\./.test(version) && String(identity.uuid).toLowerCase() === config.uuid && identity.roles === '', 'C02实例真实版本、UUID或强制角色不匹配，未创建资源');
    check((await sql(admin, "SELECT Process_priv AS allowed FROM mysql.user WHERE CONCAT(User,'@',Host)=CURRENT_USER()"))[0]?.allowed === 'Y', 'C02管理观察者必须具有既有直接PROCESS权限，不增权');
    check((await sql(admin, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0 && (await sql(admin, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02随机资源已存在，拒绝接管');
    databaseOwnership = 'unknown'; await sql(admin, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); databaseOwnership = 'confirmed';
    await sql(admin, `CREATE TABLE ${qualified(database, 'subject')} (id INT PRIMARY KEY,marker CHAR(32) NOT NULL) COMMENT='dbark-c02-owner:${marker}'`); await sql(admin, `INSERT INTO ${qualified(database, 'subject')} VALUES(1,?)`, [marker]);
    userOwnership = 'unknown'; await sql(admin, `CREATE USER ${account} IDENTIFIED BY '${password}'${config.caPath ? ' REQUIRE SSL' : ''} ATTRIBUTE '{"dbarkC02Owner":"${marker}"}'`); userOwnership = 'confirmed';
    await sql(admin, `GRANT SELECT ON ${qualified(database, 'subject')} TO ${account}`); await assertGrants();
    let active = true;
    try { await use({ database, user, marker, tempParent: dirname(config.directory), serverPolicy: { openSshVersion: proof.openSshVersion, maxSessions: proof.maxSessions }, profile: auth => ({ ...structuredClone(limited), ssh: { enabled: true, host: '192.168.31.200', port: materials.manifest.port, user: materials.manifest.user, hostFingerprint: materials.manifest.fingerprint, ...(auth === 'password' ? { password: materials.password } : { privateKeyPath: materials.keyPath, passphrase: materials.passphrase }) } }), observeApplicationThreads: async () => { check(active, 'C02租约已归还'); return (await sql(admin!, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user])).map(row => { const id = Number(row.ID); check(Number.isSafeInteger(id) && id > 0, 'C02线程编号无效'); ids.add(id); return id; }); } }); }
    finally { active = false; }
    await assertGrants();
  } catch (error) { failure = c02Failure('C02隔离OpenSSH租约或验收失败', error); }
  try { await cleanupC02({ user: userOwnership, database: databaseOwnership, closeConnections: async () => {}, verifyThreadsGone: async () => {
    if (userOwnership === 'absent' && databaseOwnership === 'absent') return;
    check(admin, 'C02缺少观察者，不能证明线程清零'); const deadline = Date.now() + 12000;
    while (true) { const rows = await sql(admin, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user]); const recorded = ids.size ? await sql(admin, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${[...ids].map(() => '?').join(',')})`, [...ids]) : []; if (!rows.length && !recorded.length) break; check(Date.now() < deadline, 'C02应用线程未清零，保留资源'); await delay(100); }
    // 即使用例本身失败也重核授权；此公共删除门失败时cleanupC02不能执行任一DROP。
    check(!grantsInvalid, 'C02观察到授权失效，禁止自动DROP用户或库');
    if (userOwnership === 'confirmed') await assertGrants();
  }, dropUser: async () => {
    check(!grantsInvalid, 'C02授权范围已失效，禁止DROP用户');
    const owner = await sql(admin!, "SELECT ATTRIBUTE->>'$.dbarkC02Owner' AS owner FROM information_schema.USER_ATTRIBUTES WHERE USER=? AND HOST=?", [user, '%']); check(c02OwnsUser(owner.map(row => ({ owner: row.owner })), marker), 'C02用户令牌不匹配，拒绝DROP');
    await sql(admin!, `DROP USER ${account}`); check((await sql(admin!, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02临时用户仍存在');
  }, dropDatabase: async () => {
    check(!grantsInvalid, 'C02授权范围已失效，禁止DROP库');
    const tables = await sql(admin!, 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]); check(c02OwnsTables(tables.map(row => ({ name: row.name, comment: row.comment })), marker), 'C02库对象所有权不匹配，拒绝DROP');
    for (const [catalog, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) check((await sql(admin!, `SELECT 1 FROM information_schema.${catalog} WHERE ${column}=?`, [database])).length === 0, 'C02隔离库出现额外对象');
    await sql(admin!, `DROP DATABASE ${identifier(database)}`); check((await sql(admin!, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'C02临时库仍存在');
  }, closeAdmin: async () => {
    if (!admin) return; const oldAdminId = admin.connection.threadId, errors: unknown[] = [];
    try { await admin.close({ strict: true }); } catch (error) { errors.push(c02Failure('C02原管理连接严格关闭失败', error)); }
    let observer: ManagedConnection | undefined;
    try { observer = await connect(adminProfile); const all = [...ids, ...(oldAdminId ? [oldAdminId] : [])]; if (all.length) check((await sql(observer, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${all.map(() => '?').join(',')})`, all)).length === 0, 'C02原管理或应用线程仍存在'); }
    catch (error) { errors.push(c02Failure('C02独立逐ID观察失败', error)); }
    finally { try { await observer?.close({ strict: true }); } catch (error) { errors.push(c02Failure('C02最后观察连接严格关闭失败', error)); } }
    if (errors.length) throw new AggregateError(errors, 'C02管理与观察连接收尾失败', { cause: errors[0] });
  }, removeTemporaryFiles: async () => {
    // 服务器及新密钥由ROOT在全部核心/GUI结束后统一down和精确材料清理，本租约不接管。
  } }, failure); } catch (error) { throw new C02FixtureError(`C02隔离OpenSSH未完成；精确用户 ${user}、库 ${database}；CREATE状态：用户 ${userOwnership}、库 ${databaseOwnership}；授权失效 ${grantsInvalid}`, { cause: error }); }
  return { databasePort: config.port, version, serverRun: proof.run, serverContainer: proof.container, database, user, observedConnectionIds: [...ids], databaseFixtureCleaned: true, serverAndMaterialsAwaitRootCleanup: true };
}

/** 负例必须来自相应真实认证阶段，普通网络错误、TLS错误和超时不能充当拒绝通过。 */
export async function rejectC02OpenSsh(profile: ConnectionProfile, kind: 'password' | 'passphrase' | 'fingerprint') {
  let connection: ManagedConnection | undefined, matched = false;
  try { connection = await connect(profile); }
  catch (error) { const message = error instanceof Error ? error.message : ''; matched = kind === 'fingerprint' ? message.includes('Host denied (verification failed)') : kind === 'password' ? message.includes('All configured authentication methods failed') : /privateKey|passphrase|encrypted|decrypt/i.test(message); }
  finally { await connection?.close({ strict: true }); }
  check(matched, 'C02负例未在期望SSH认证阶段被拒绝，不能用网络失败替代');
}

/** 真实产品Engine经ssh2/forwardOut访问限定SELECT；不运行模拟SSH传输。 */
export async function selectC02OpenSsh(lease: C02OpenSshLease, mode: C02OpenSshMode) {
  const connection = await connect(lease.profile(mode));
  await withC02UiLifetime(async () => {
    const rows = await sql(connection, "SELECT CURRENT_USER() AS user,DATABASE() AS db,CONNECTION_ID() AS id,marker FROM subject");
    check(rows.length === 1 && rows[0].user === `${lease.user}@%` && rows[0].db === lease.database && rows[0].marker === lease.marker && (await lease.observeApplicationThreads()).includes(Number(rows[0].id)), 'C02真实SSH SELECT身份、标记或线程不匹配');
    if (lease.profile(mode).tls?.enabled) check(!!(await sql(connection, "SHOW SESSION STATUS LIKE 'Ssl_cipher'"))[0]?.Value, 'C02严格TLS隧道没有实际cipher');
  }, async () => { await connection.close({ strict: true }); });
}
