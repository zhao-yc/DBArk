import { isAbsolute } from 'node:path';

export const c02RootConfirmation = '192.168.31.200:13484/c02-mtls';
export type C02Ownership = 'absent' | 'unknown' | 'confirmed';
/** 仅本夹具受控说明可保留在 cause 中，外部驱动原文一律经过脱敏。 */
export class C02FixtureError extends Error {}
export interface C02Config {
  host: '192.168.31.200'; port: 13484; serverUuid: string;
  adminUser: string; adminPassword: string; caPath: string; caKeyPath: string;
  caKeyPassphrase: string; opensslPath: string; tempParent?: string;
}

/** 模块导入不读文件、不启动进程、不建连；双开关以外还必须核对 ROOT 的精确目标标记。 */
export function c02Enabled(env: NodeJS.ProcessEnv): boolean {
  return env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_C02_MTLS_ENABLED === '1';
}

/** 只接收本片显式环境值，不加载任何 .env、ROOT 配置或默认数据库凭据。 */
export function c02Config(env: NodeJS.ProcessEnv): C02Config {
  if (!c02Enabled(env)) throw new Error('C02 mTLS 尚未显式启用');
  if (env.DBARK_C02_ROOT_CONFIRM !== c02RootConfirmation || env.DBARK_C02_HOST !== '192.168.31.200' || env.DBARK_C02_PORT !== '13484') throw new Error('C02 mTLS 仅允许 ROOT 确认的 192.168.31.200:13484');
  const serverUuid = env.DBARK_C02_SERVER_UUID ?? '';
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid)) throw new Error('必须由 ROOT 显式提供已核对的 MySQL server_uuid');
  const adminUser = env.DBARK_C02_ADMIN_USER, adminPassword = env.DBARK_C02_ADMIN_PASSWORD;
  if (!adminUser || !adminPassword) throw new Error('必须由 ROOT 显式提供本次管理连接凭据');
  const pathValue = (name: string): string => {
    const value = env[name];
    if (!value || !isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error(`${name} 必须为显式绝对路径`);
    return value;
  };
  const caKeyPassphrase = env.DBARK_C02_CA_KEY_PASSPHRASE ?? '';
  if (/[\r\n\0]/.test(caKeyPassphrase)) throw new Error('CA 私钥口令不得包含换行或空字符');
  return {
    host: '192.168.31.200', port: 13484, serverUuid: serverUuid.toLowerCase(), adminUser, adminPassword,
    caPath: pathValue('DBARK_C02_CA_PATH'), caKeyPath: pathValue('DBARK_C02_CA_KEY_PATH'), caKeyPassphrase,
    opensslPath: env.DBARK_C02_OPENSSL_PATH ? pathValue('DBARK_C02_OPENSSL_PATH') : process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe' : pathValue('DBARK_C02_OPENSSL_PATH'),
    tempParent: env.DBARK_C02_TEMP_PARENT ? pathValue('DBARK_C02_TEMP_PARENT') : undefined,
  };
}

/** SQL 与删除范围只从本次随机后缀构造，调用方不能传入任意用户或库名。 */
export function c02Names(suffix: string): { database: string; user: string; account: string } {
  if (!/^[a-f0-9]{12}$/.test(suffix)) throw new Error('C02 随机资源后缀必须为十二位小写十六进制');
  const user = `cp_${suffix}`;
  return { database: `dbark_colperm_${suffix}`, user, account: `'${user}'@'%'` };
}

/** 不复制原错误消息、SQL、参数、堆栈或路径；按原有因果层级保留安全的类别与错误编号。 */
export function c02Failure(stage: string, reason: unknown): Error {
  const sanitize = (value: unknown, depth = 0): Error => {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const safe = new Error(value instanceof C02FixtureError ? value.message : '底层失败详情已脱敏', depth < 4 && source.cause !== undefined ? { cause: sanitize(source.cause, depth + 1) } : undefined);
    if (['Error', 'TypeError', 'RangeError', 'AggregateError', 'AbortError'].includes(String(source.name))) safe.name = String(source.name);
    for (const key of ['code', 'sqlState']) if (typeof source[key] === 'string' && /^[A-Z0-9_]{1,64}$/.test(source[key])) Object.assign(safe, { [key]: source[key] });
    if (typeof source.errno === 'number' && Number.isSafeInteger(source.errno)) Object.assign(safe, { errno: source.errno });
    if (value instanceof AggregateError) Object.assign(safe, { errors: depth < 4 ? value.errors.map(item => sanitize(item, depth + 1)) : [] });
    return safe;
  };
  return new C02FixtureError(stage, { cause: sanitize(reason) });
}

/** 服务端元数据必须保留本次令牌；空库只允许用于已确认 CREATE、尚未建表的失败收尾。 */
export function c02OwnsTables(rows: { name: unknown; comment: unknown }[], owner: string): boolean {
  return /^[a-f0-9]{32}$/.test(owner) && rows.length <= 1 && rows.every(row => row.name === 'subject' && row.comment === `dbark-c02-owner:${owner}`);
}

/** 用户元数据必须精确一条且令牌一致，不按用户名模糊匹配或接管同名对象。 */
export function c02OwnsUser(rows: { owner: unknown }[], owner: string): boolean {
  return /^[a-f0-9]{32}$/.test(owner) && rows.length === 1 && rows[0].owner === owner;
}

export interface C02CleanupActions {
  user: C02Ownership; database: C02Ownership;
  closeConnections(): Promise<void>; verifyThreadsGone(): Promise<void>;
  dropUser(): Promise<void>; dropDatabase(): Promise<void>;
  closeAdmin(): Promise<void>; removeTemporaryFiles(): Promise<void>;
}

/** 只有已确认创建且线程清零的对象才能删除；未知 CREATE 不尝试 DROP，更不重试写操作。 */
export async function cleanupC02(actions: C02CleanupActions, originalFailure?: unknown): Promise<void> {
  const errors: unknown[] = originalFailure === undefined ? [] : [originalFailure];
  const attempt = async (action: () => Promise<void>): Promise<boolean> => {
    try { await action(); return true; } catch (error) { errors.push(error); return false; }
  };
  await attempt(() => actions.closeConnections());
  const released = await attempt(() => actions.verifyThreadsGone());
  for (const kind of ['user', 'database'] as const) {
    if (actions[kind] === 'unknown') errors.push(new Error(`C02 ${kind === 'user' ? '用户' : '数据库'} CREATE 结果未知，保留精确对象待 ROOT 核对`));
    if (released && actions[kind] === 'confirmed') await attempt(() => kind === 'user' ? actions.dropUser() : actions.dropDatabase());
  }
  await attempt(() => actions.closeAdmin());
  await attempt(() => actions.removeTemporaryFiles());
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'C02 mTLS 验收或清理失败，首个原因已保留', { cause: errors[0] });
}

export interface C02CertificatePaths { key: string; csr: string; cert: string; config: string }

/** 口令只走子进程 stdin；这些固定参数不得拼入任何口令或使用 CAcreateserial 写入 CA 目录。 */
export function c02OpenSslCommands(config: Pick<C02Config, 'caPath' | 'caKeyPath'>, files: C02CertificatePaths, suffix: string, serial: string): string[][] {
  c02Names(suffix);
  if (!/^[a-f0-9]{32}$/.test(serial)) throw new Error('C02 证书序列号无效');
  return [
    ['genpkey', '-algorithm', 'RSA', '-aes-256-cbc', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', files.key, '-pass', 'stdin'],
    ['req', '-new', '-sha256', '-key', files.key, '-passin', 'stdin', '-subj', `/CN=dbark-c02-${suffix}`, '-out', files.csr, '-config', files.config],
    ['x509', '-req', '-sha256', '-in', files.csr, '-CA', config.caPath, '-CAkey', config.caKeyPath, '-passin', 'stdin', '-set_serial', `0x${serial}`, '-days', '1', '-extfile', files.config, '-extensions', 'client_ext', '-out', files.cert],
  ];
}
