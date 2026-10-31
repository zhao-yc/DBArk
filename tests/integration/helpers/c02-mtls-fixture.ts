import { spawn } from 'node:child_process';
import { createPrivateKey, randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkServerIdentity, createSecureContext, type TLSSocket } from 'node:tls';
import { connect, execute, type ManagedConnection } from '../../../src/engine/connection';
import { identifier, qualified } from '../../../src/engine/sql';
import type { NetworkConnectionProfile as ConnectionProfile } from '../../../src/shared/contracts';
import { C02FixtureError, c02Config, c02Failure, c02Names, c02OpenSslCommands, c02OwnsTables, c02OwnsUser, c02UiEnabled, cleanupC02, type C02CertificatePaths, type C02Config, type C02Ownership } from './c02-mtls-policy';

type Row = Record<string, unknown>;

/** 断言只输出固定中文说明，不把配置、密码、私钥或驱动对象交给测试框架打印。 */
function requireFact(condition: unknown, message: string): asserts condition { if (!condition) throw new C02FixtureError(message); }

/** 显式路径必须已存在且为普通文件；拒绝符号链接，不搜索或下载任何工具、凭据。 */
async function regularFile(path: string): Promise<void> {
  const info = await lstat(path);
  requireFact(info.isFile() && !info.isSymbolicLink(), 'C02 显式材料或工具路径不是普通文件');
}

/** OpenSSL 输出不进入日志；口令通过管道传入，超时/启动错误先等进程退出，再允许删除材料。 */
async function openssl(config: C02Config, args: string[], passphrase: string): Promise<void> {
  const env: NodeJS.ProcessEnv = { MSYS2_ARG_CONV_EXCL: '*' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATH', 'Path', 'TMP', 'TEMP']) if (process.env[key]) env[key] = process.env[key];
  await new Promise<void>((done, reject) => {
    const child = spawn(config.opensslPath, args, { shell: false, windowsHide: true, env, stdio: ['pipe', 'ignore', 'ignore'] });
    let failure: unknown;
    const timer = setTimeout(() => { failure = new Error('OpenSSL 超时'); child.kill(); }, 30000);
    child.on('error', error => { failure = error; });
    child.stdin.on('error', error => { failure ??= error; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure || code !== 0 || signal) reject(c02Failure('C02 临时客户端证书签发失败', failure ?? Object.assign(new Error(), { code: signal ?? `EXIT_${code}` })));
      else done();
    });
    child.stdin.end(`${passphrase}\n`);
  });
}

/** 本轮目录只删除固定文件；不递归删除，出现额外文件或目录替换时保留现场并报错。 */
async function removeMaterials(directory: string, parent: string, files: C02CertificatePaths, identity: { dev: number; ino: number }): Promise<void> {
  requireFact(dirname(directory) === resolve(parent) && /^dbark-c02-mtls-[A-Za-z0-9]+$/.test(basename(directory)), 'C02 临时目录所有权校验失败');
  const info = await lstat(directory);
  requireFact(info.isDirectory() && !info.isSymbolicLink() && info.dev === identity.dev && info.ino === identity.ino, 'C02 临时目录已被替换，拒绝删除');
  const failures: unknown[] = [];
  for (const path of Object.values(files)) {
    requireFact(dirname(path) === directory, 'C02 临时文件越过本轮目录');
    try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(c02Failure('C02 精确删除临时文件失败', error)); }
  }
  try { await rmdir(directory); } catch (error) { failures.push(c02Failure('C02 临时目录未清空，已保留现场', error)); }
  if (failures.length) throw new AggregateError(failures, `C02 临时材料精确清理失败，保留目录 ${directory}`, { cause: failures[0] });
}

/** 建连和 SQL 都经过产品真实驱动；每条语句只发送一次，超时仅销毁当前连接，绝不重放。 */
async function sql(connection: ManagedConnection, statement: string, params: (string | number)[] = []): Promise<Row[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execute<Row[]>(connection, statement, params).then(result => result.rows),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        connection.broken = true; connection.connection.destroy();
        (connection.connection as unknown as { stream?: { destroy(): void } }).stream?.destroy();
        reject(new C02FixtureError('C02 SQL 超时，结果未知且不会重试'));
      }, 10000); }),
    ]);
  } catch (error) { throw c02Failure('C02 数据库语句失败；未重试', error); }
  finally { clearTimeout(timer); }
}

/** 检查真实 TLS 传输、证书 IP SAN、服务器会话 cipher，不以单纯能 SELECT 代替严格 TLS。 */
async function assertSecure(connection: ManagedConnection, host: string): Promise<string> {
  const stream = (connection.connection as unknown as { stream: TLSSocket }).stream;
  requireFact(stream.encrypted === true && stream.authorized === true && !stream.authorizationError, 'C02 真实 TLS 传输未通过 CA 认证');
  const peer = stream.getPeerCertificate(true);
  requireFact(Boolean(peer.raw) && checkServerIdentity(host, peer) === undefined && new X509Certificate(peer.raw).checkIP(host) === host, 'C02 服务器证书缺少目标 IP SAN 或身份校验失败');
  const rows = await sql(connection, "SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  const cipher = rows[0]?.Value;
  requireFact(typeof cipher === 'string' && cipher.length > 0, 'C02 真实 MySQL 会话没有 SSL cipher');
  return cipher;
}

export interface C02MtlSEvidence {
  database: string; user: string; serverUuid: string; cipher: string;
  noCertificateRejected: boolean; missingPassphraseRejected: boolean; wrongPassphraseRejected: boolean;
  observedConnectionIds: number[];
}

/** 只向受控回调提供临时受限用户及一天期文件，不交出管理账号或 CA 私钥。 */
export interface C02MtlSLease {
  readonly profile: ConnectionProfile;
  readonly database: string;
  readonly user: string;
  readonly marker: string;
  /** 只读观察本例精确用户，将真实应用线程纳入最终逐 ID 查证。 */
  observeApplicationThreads(): Promise<number[]>;
}

/** 仅 ROOT 双开关运行时读取显式材料、签发一天期证书并访问 13484；所有资源均为本次独占。 */
export async function runC02MtlS(env: NodeJS.ProcessEnv, useLease?: (lease: C02MtlSLease) => Promise<void>): Promise<C02MtlSEvidence> {
  const config = c02Config(env);
  requireFact(!useLease || c02UiEnabled(env), 'C02 回调租约还需显式开启 UI 开关');
  const suffix = randomBytes(6).toString('hex'), owner = randomBytes(16).toString('hex');
  const { database, user, account } = c02Names(suffix), table = qualified(database, 'subject');
  const password = `Cp!9${randomBytes(24).toString('hex')}`, passphrase = `C02!${randomBytes(32).toString('hex')}`;
  const parent = resolve(config.tempParent ?? tmpdir());
  const connections = new Set<ManagedConnection>(), ids = new Set<number>();
  let directory: string | undefined, files: C02CertificatePaths | undefined, directoryIdentity: { dev: number; ino: number } | undefined, admin: ManagedConnection | undefined;
  let databaseOwnership: C02Ownership = 'absent', userOwnership: C02Ownership = 'absent', failure: unknown, evidence: C02MtlSEvidence | undefined;
  const adminProfile: ConnectionProfile = { id: randomUUID(), name: 'C02 mTLS 管理观察', group: '', color: '#123456', dialect: 'mysql', host: config.host, port: config.port, user: config.adminUser, password: config.adminPassword, tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath } };
  /** 返回对象先入收尾集合，再检查其线程；意外认证成功也不会漏关。 */
  const open = async (profile: ConnectionProfile): Promise<ManagedConnection> => {
    try {
      const connection = await connect(profile); connections.add(connection);
      const id = connection.connection.threadId;
      requireFact(Number.isSafeInteger(id) && Number(id) > 0, 'C02 真实连接没有有效线程编号'); ids.add(id!);
      return connection;
    } catch (error) { throw c02Failure('C02 产品真实建连失败', error); }
  };
  /** 同一用户必须只有精确 subject 表的 SELECT；不读认证哈希、不执行 SHOW GRANTS。 */
  const assertGrants = async (): Promise<void> => {
    const grants = await sql(admin!, 'SELECT TABLE_SCHEMA AS db,TABLE_NAME AS name,PRIVILEGE_TYPE AS privilege,IS_GRANTABLE AS grantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?', [account]);
    requireFact(grants.length === 1 && grants[0].db === database && grants[0].name === 'subject' && grants[0].privilege === 'SELECT' && grants[0].grantable === 'NO', 'C02 表级权限超出精确 SELECT 范围');
    for (const scope of ['SCHEMA', 'COLUMN', 'USER']) {
      const extra = await sql(admin!, `SELECT PRIVILEGE_TYPE FROM information_schema.${scope}_PRIVILEGES WHERE GRANTEE=?${scope === 'USER' ? " AND PRIVILEGE_TYPE<>'USAGE'" : ''}`, [account]);
      requireFact(extra.length === 0, 'C02 出现额外授权，拒绝继续');
    }
    const requirements = await sql(admin!, 'SELECT ssl_type AS sslType FROM mysql.user WHERE User=? AND Host=?', [user, '%']);
    requireFact(requirements.length === 1 && requirements[0].sslType === 'X509', 'C02 临时用户没有 REQUIRE X509');
    requireFact((await sql(admin!, 'SELECT 1 FROM mysql.role_edges WHERE TO_USER=? AND TO_HOST=?', [user, '%'])).length === 0, 'C02 临时用户出现额外角色授权');
  };
  /** 必须收到真实认证拒绝；意外成功也先纳入严格关闭集合，不打印返回的配置。 */
  const rejectConnection = async (profile: ConnectionProfile, requireAccessDenied = false): Promise<void> => {
    let rejected: unknown;
    try { await open(profile); } catch (error) { rejected = error; }
    requireFact(rejected !== undefined, 'C02 负例意外认证成功');
    if (requireAccessDenied) {
      const cause = (rejected as Error).cause as { errno?: number } | undefined;
      requireFact(cause?.errno === 1045, 'C02 无证书负例没有收到服务器认证拒绝');
    }
  };
  try {
    // 所有本地材料与工具先验证；只有显式启用后的函数体能读取 CA 或 CA key。
    await Promise.all([config.caPath, config.caKeyPath, config.opensslPath].map(regularFile));
    const ca = new X509Certificate(await readFile(config.caPath));
    requireFact(ca.ca, 'C02 显式 CA 不是 CA 证书');
    const parentInfo = await lstat(parent);
    requireFact(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), 'C02 临时父目录不是普通目录');
    directory = await mkdtemp(join(parent, 'dbark-c02-mtls-'));
    files = { key: join(directory, 'client-key.pem'), csr: join(directory, 'client.csr'), cert: join(directory, 'client-cert.pem'), config: join(directory, 'openssl.cnf') };
    directoryIdentity = await lstat(directory); await chmod(directory, 0o700);
    await writeFile(files.config, '[req]\ndistinguished_name=dn\n[dn]\n[client_ext]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n', { flag: 'wx', mode: 0o600 });
    const commands = c02OpenSslCommands(config, files, suffix, owner);
    for (let index = 0; index < commands.length; index++) await openssl(config, commands[index], index === 2 ? config.caKeyPassphrase : passphrase);
    await chmod(files.key, 0o600);
    const key = await readFile(files.key), cert = await readFile(files.cert), leaf = new X509Certificate(cert);
    requireFact(key.toString('ascii').includes('-----BEGIN ENCRYPTED PRIVATE KEY-----'), 'C02 临时私钥没有加密');
    requireFact(leaf.checkIssued(ca) && leaf.verify(ca.publicKey) && leaf.checkPrivateKey(createPrivateKey({ key, passphrase })) && leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.2'), 'C02 临时证书的签发链、客户端用途或密钥不匹配');
    requireFact(Date.parse(leaf.validTo) - Date.now() > 0 && Date.parse(leaf.validTo) - Date.now() <= 25 * 60 * 60 * 1000, 'C02 临时证书超过一天有效期边界');
    // 原生解析独立证明缺/错口令确实不能解密；后续仍调用真实产品 connect，不替换驱动认证。
    for (const candidate of [undefined, `${passphrase}-wrong`]) {
      let refused = false;
      try { createSecureContext({ ca: await readFile(config.caPath), key, cert, passphrase: candidate }); } catch { refused = true; }
      requireFact(refused, 'C02 原生 TLS 未拒绝缺失或错误的加密私钥口令');
    }
    admin = await connect(adminProfile);
    await assertSecure(admin, config.host);
    const identity = await sql(admin, 'SELECT @@server_uuid AS serverUuid,VERSION() AS version,@@mandatory_roles AS mandatoryRoles');
    requireFact(String(identity[0]?.serverUuid).toLowerCase() === config.serverUuid && /^8\.4\./.test(String(identity[0]?.version)), 'C02 真实服务器身份或 MySQL 8.4 版本不匹配，未创建对象');
    requireFact(identity[0]?.mandatoryRoles === '', 'C02 服务器存在强制角色，无法证明临时用户只有 SELECT');
    // PROCESSLIST 在缺权限时可能只显示自己，必须在创建前证明观察者拥有直接 PROCESS 权限。
    const observation = await sql(admin, 'SELECT Process_priv AS allowed FROM mysql.user WHERE CONCAT(User,\'@\',Host)=CURRENT_USER()');
    requireFact(observation.length === 1 && observation[0].allowed === 'Y', 'C02 管理观察者没有直接 PROCESS 权限，未创建对象');
    requireFact((await sql(admin, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'C02 随机数据库已存在，拒绝接管');
    requireFact((await sql(admin, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02 随机用户名已存在，拒绝接管');
    // 标记未知必须早于发送；只有成功响应才升级为已确认，不用 IF NOT EXISTS 掩盖碰撞。
    databaseOwnership = 'unknown'; await sql(admin, `CREATE DATABASE ${identifier(database)} CHARACTER SET utf8mb4`); databaseOwnership = 'confirmed';
    await sql(admin, `CREATE TABLE ${table} (id INT PRIMARY KEY,marker CHAR(32) NOT NULL) COMMENT='dbark-c02-owner:${owner}'`);
    await sql(admin, `INSERT INTO ${table} (id,marker) VALUES (1,?)`, [owner]);
    userOwnership = 'unknown';
    await sql(admin, `CREATE USER ${account} IDENTIFIED BY '${password}' REQUIRE X509 ATTRIBUTE '{"dbarkC02Owner":"${owner}"}'`);
    userOwnership = 'confirmed';
    await sql(admin, `GRANT SELECT ON ${table} TO ${account}`); await assertGrants();
    const limited: ConnectionProfile = { ...adminProfile, id: randomUUID(), name: 'C02 一次性 mTLS SELECT', database, user, password, tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath, certPath: files.cert, keyPath: files.key, passphrase } };
    await rejectConnection({ ...limited, tls: { enabled: true, rejectUnauthorized: true, caPath: config.caPath } }, true);
    await rejectConnection({ ...limited, tls: { ...limited.tls!, passphrase: undefined } });
    await rejectConnection({ ...limited, tls: { ...limited.tls!, passphrase: `${passphrase}-wrong` } });
    const actual = await open(limited), cipher = await assertSecure(actual, config.host);
    requireFact((await sql(admin, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=? AND ID=?', [user, actual.connection.threadId!])).length === 1, 'C02 观察连接看不到真实临时用户线程，拒绝认定清零');
    const selected = await sql(actual, `SELECT id,marker FROM ${table}`);
    requireFact(selected.length === 1 && selected[0].id === 1 && selected[0].marker === owner, 'C02 正确口令未读到本轮 subject 数据');
    const session = (await sql(actual, 'SELECT DATABASE() AS db,CURRENT_USER() AS account,CONNECTION_ID() AS id,CURRENT_ROLE() AS roles'))[0];
    requireFact(session.db === database && session.account === `${user}@%` && Number(session.id) === actual.connection.threadId && session.roles === 'NONE', 'C02 成功查询的账号、库、角色或真实会话不匹配');
    await assertGrants();
    if (useLease) {
      // 原核心默认调用保持原样；仅 UI 扩展先释放核心连接，再把同一资源租给真实应用。
      await actual.close({ strict: true });
      let active = true;
      try {
        await useLease({ profile: structuredClone(limited), database, user, marker: owner,
          observeApplicationThreads: async () => {
            requireFact(active, 'C02 资源租约已归还，拒绝继续观察');
            const rows = await sql(admin!, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user]);
            return rows.map(row => { const id = Number(row.ID); requireFact(Number.isSafeInteger(id) && id > 0, 'C02 应用线程编号无效'); ids.add(id); return id; });
          },
        });
      } finally { active = false; }
      await assertGrants();
    }
    evidence = { database, user, serverUuid: config.serverUuid, cipher, noCertificateRejected: true, missingPassphraseRejected: true, wrongPassphraseRejected: true, observedConnectionIds: [...ids] };
  } catch (error) { failure = c02Failure(`C02 mTLS 核心验收失败；精确用户 ${user}、数据库 ${database}`, error); }
  try { await cleanupC02({
    user: userOwnership, database: databaseOwnership,
    closeConnections: async () => {
      const results = await Promise.allSettled([...connections].map(connection => connection.close({ strict: true })));
      const errors = results.flatMap(result => result.status === 'rejected' ? [c02Failure('C02 测试连接严格关闭失败', result.reason)] : []);
      if (errors.length) throw new AggregateError(errors, 'C02 真实连接关闭存在失败', { cause: errors[0] });
    },
    verifyThreadsGone: async () => {
      if (!admin) { requireFact(databaseOwnership === 'absent' && userOwnership === 'absent' && connections.size === 0, 'C02 缺少管理观察连接，不能确认会话清零'); return; }
      const deadline = Date.now() + 12000;
      do {
        const remaining = await sql(admin, 'SELECT ID FROM information_schema.PROCESSLIST WHERE USER=?', [user]);
        const recorded = ids.size ? await sql(admin, `SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${[...ids].map(() => '?').join(',')})`, [...ids]) : [];
        if (!remaining.length && !recorded.length) return;
        await delay(100);
      } while (Date.now() < deadline);
      throw new Error('C02 本轮账号或已记录线程仍存在，保留用户与数据库');
    },
    dropUser: async () => {
      // 用户元数据令牌和范围二次核对，防止同名对象被替换后仍凭创建标志删除。
      const rows = await sql(admin!, "SELECT ATTRIBUTE->>'$.dbarkC02Owner' AS owner FROM information_schema.USER_ATTRIBUTES WHERE USER=? AND HOST=?", [user, '%']);
      requireFact(c02OwnsUser(rows.map(row => ({ owner: row.owner })), owner), 'C02 用户所有权令牌不匹配，拒绝 DROP');
      await sql(admin!, `DROP USER ${account}`);
      requireFact((await sql(admin!, 'SELECT User FROM mysql.user WHERE User=?', [user])).length === 0, 'C02 精确用户删除后仍存在');
    },
    dropDatabase: async () => {
      const objects = await sql(admin!, 'SELECT TABLE_NAME AS name,TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [database]);
      requireFact(c02OwnsTables(objects.map(row => ({ name: row.name, comment: row.comment })), owner), 'C02 隔离库包含非本轮表，拒绝 DROP');
      for (const [catalog, column] of [['ROUTINES', 'ROUTINE_SCHEMA'], ['EVENTS', 'EVENT_SCHEMA'], ['TRIGGERS', 'TRIGGER_SCHEMA']]) requireFact((await sql(admin!, `SELECT 1 FROM information_schema.${catalog} WHERE ${column}=?`, [database])).length === 0, 'C02 隔离库包含非本轮对象，拒绝 DROP');
      await sql(admin!, `DROP DATABASE ${identifier(database)}`);
      requireFact((await sql(admin!, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database])).length === 0, 'C02 精确数据库删除后仍存在');
    },
    closeAdmin: async () => { if (admin) try { await admin.close({ strict: true }); } catch (error) { throw c02Failure('C02 管理观察连接严格关闭失败', error); } },
    removeTemporaryFiles: async () => {
      if (directory && files) {
        requireFact(directoryIdentity, `C02 无法确认临时目录身份，保留目录 ${directory}`);
        await removeMaterials(directory, parent, files, directoryIdentity);
      }
    },
  }, failure); } catch (error) {
    // 收尾失败时同样给出精确资源，不能因“成功证据只在最后输出”而丢失 ROOT 的核对入口。
    throw new C02FixtureError(`C02 验收或收尾失败；用户 ${user}、数据库 ${database}；临时目录 ${directory ?? '未创建'}；CREATE 确认状态：用户 ${userOwnership}、库 ${databaseOwnership}`, { cause: error });
  }
  requireFact(evidence, 'C02 没有生成完整验收证据');
  return evidence;
}
