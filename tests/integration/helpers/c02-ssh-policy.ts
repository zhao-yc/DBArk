import * as paths from 'node:path';
import { isAbsolute } from 'node:path';
import { C02FixtureError } from './c02-mtls-policy';

export const c02SshPorts = [13357, 13380, 13384, 13310, 13311, 13484] as const;
export interface C02SshConfig {
  host: '192.168.31.200'; port: number; dialect: 'mysql' | 'mariadb'; serverUuid?: string;
  adminUser: string; adminPassword: string; sshHost: '192.168.31.200'; sshPort: number; sshUser: string;
  keyPath: string; fingerprint: string; tempParent: string; caPath?: string;
}

/** 独立默认关闭，不因 mTLS 或旧通用 SSH 开关而启动本片 GUI。 */
export function c02SshEnabled(env: NodeJS.ProcessEnv): boolean { return env.DBARK_INTEGRATION_ENABLED === '1' && env.DBARK_C02_SSH_UI_ENABLED === '1'; }

/** SHA256主机指纹必须为32字节的规范无填充Base64，禁止接受截断或伪造格式。 */
export function c02SshFingerprint(value: string): boolean {
  const payload = value.startsWith('SHA256:') ? value.slice(7) : '';
  return /^[A-Za-z0-9+/]{43}$/.test(payload) && Buffer.from(payload, 'base64').byteLength === 32 && Buffer.from(payload, 'base64').toString('base64').replace(/=+$/, '') === payload;
}

/** 确保负例格式仍合法且恰与 ROOT 已认证指纹不同，失败必须来自真实主机身份拒绝。 */
export function c02WrongSshFingerprint(actual: string): string {
  if (!c02SshFingerprint(actual)) throw new C02FixtureError('C02 SSH 主机指纹格式无效');
  const bytes = Buffer.from(actual.slice(7), 'base64'); bytes[0] ^= 1;
  return `SHA256:${bytes.toString('base64').replace(/=+$/, '')}`;
}

/** 同步配置和真实路径复核共用目录边界；按平台处理大小写、跨盘及以..开头的普通子目录名。 */
export function c02SshAssertSeparatePaths(keyPath: string, tempParent: string, path = paths): void {
  const fromIdentityDirectory = path.relative(path.dirname(path.resolve(keyPath)), path.resolve(tempParent));
  if (!fromIdentityDirectory || !path.isAbsolute(fromIdentityDirectory) && fromIdentityDirectory !== '..' && !fromIdentityDirectory.startsWith(`..${path.sep}`)) throw new C02FixtureError('C02 SSH 临时目录不能位于原身份目录内');
}

/** SSH字段只消费ROOT解析ssh -G的显式值，指纹来自其已认证记录；不运行ssh、不读配置/env/身份文件。 */
export function c02SshConfig(env: NodeJS.ProcessEnv): C02SshConfig {
  if (!c02SshEnabled(env)) throw new C02FixtureError('C02 SSH UI 尚未显式启用');
  if (env.DBARK_C02_SSH_ROOT_CONFIRM !== 'server-200/192.168.31.200/c02-ssh' || env.DBARK_C02_SSH_ALIAS !== 'server-200' || env.DBARK_C02_SSH_HOST !== '192.168.31.200' || env.DBARK_C02_SSH_DB_HOST !== '192.168.31.200') throw new C02FixtureError('C02 SSH 只允许 ROOT 核对的 server-200 / 192.168.31.200');
  const number = (name: string): number => { const text = env[name] ?? ''; if (!/^[1-9][0-9]{0,4}$/.test(text) || Number(text) > 65535) throw new C02FixtureError(`${name} 必须显式提供有效端口`); return Number(text); };
  const path = (name: string): string => { const value = env[name]; if (!value || !isAbsolute(value) || /[\r\n\0]/.test(value)) throw new C02FixtureError(`${name} 必须为显式绝对路径`); return value; };
  const text = (name: string): string => { const value = env[name]; if (!value || /[\r\n\0]/.test(value)) throw new C02FixtureError(`${name} 必须由 ROOT 显式提供`); return value; };
  const port = number('DBARK_C02_SSH_DB_PORT');
  if (!(c02SshPorts as readonly number[]).includes(port)) throw new C02FixtureError('C02 SSH 数据库仅允许六个既有专用端口');
  const fingerprint = text('DBARK_C02_SSH_HOST_SHA256');
  if (!c02SshFingerprint(fingerprint)) throw new C02FixtureError('C02 SSH 主机指纹格式无效');
  if (env.DBARK_C02_SSH_KEY_MODE !== 'existing-unencrypted' || env.DBARK_C02_SSH_PASSWORD || env.DBARK_C02_SSH_KEY_PASSPHRASE) throw new C02FixtureError('本片只准备既有未加密私钥，不验密码SSH或私钥口令');
  const serverUuid = env.DBARK_C02_SSH_DB_UUID;
  if ([13380, 13384, 13484].includes(port) && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(serverUuid ?? '')) throw new C02FixtureError('MySQL8 目标必须由 ROOT 显式提供已核对的 server_uuid');
  const keyPath = path('DBARK_C02_SSH_KEY_PATH'), tempParent = path('DBARK_C02_SSH_TEMP_PARENT');
  c02SshAssertSeparatePaths(keyPath, tempParent);
  return { host: '192.168.31.200', port, dialect: [13310, 13311].includes(port) ? 'mariadb' : 'mysql', serverUuid: serverUuid?.toLowerCase(),
    adminUser: text('DBARK_C02_SSH_ADMIN_USER'), adminPassword: text('DBARK_C02_SSH_ADMIN_PASSWORD'), sshHost: '192.168.31.200', sshPort: number('DBARK_C02_SSH_PORT'), sshUser: text('DBARK_C02_SSH_USER'),
    keyPath, fingerprint, tempParent, caPath: port === 13484 ? path('DBARK_C02_SSH_TLS_CA_PATH') : undefined };
}

/** 六端口仅是授权上界；本片用户令牌依赖 MySQL8 ATTRIBUTE，旧版/MariaDB在创建前明确未验。 */
export function c02SshVersion(port: number, version: string): { targetMatches: boolean; ownerSupported: boolean } {
  const patterns: Record<number, RegExp> = { 13357: /^5\.7\./, 13380: /^8\.0\./, 13384: /^8\.4\./, 13484: /^8\.4\./, 13310: /^10\.11\..*MariaDB/i, 13311: /^11\.4\..*MariaDB/i };
  const targetMatches = patterns[port]?.test(version) === true && ([13310, 13311].includes(port) || !/MariaDB/i.test(version));
  return { targetMatches, ownerSupported: targetMatches && ([13384, 13484].includes(port) || port === 13380 && Number(version.split('.')[2]?.match(/^\d+/)?.[0]) >= 21) };
}
