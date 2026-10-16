import { isAbsolute, basename } from 'node:path';
import { C02FixtureError } from './c02-mtls-policy';
import { c02SshFingerprint } from './c02-ssh-policy';

export const c02OpenSshPurpose = 'dbark-c02-openssh-v1';
export const c02OpenSshBase = 'alpine:3.23.6@sha256:1f3591b8a02ea153f41c5bba878ad477f63ab3d19349762cb77504db02a23e15';
export const c02OpenSshPackage = '10.2_p1-r0';
export const c02OpenSshServerVersion = 'OpenSSH_10.2p1';
export interface C02OpenSshServerPolicy { openSshVersion: typeof c02OpenSshServerVersion; maxSessions: 0; }
export interface C02OpenSshManifest { purpose: typeof c02OpenSshPurpose; run: string; user: string; port: number; fingerprint: string; clientPublic: string; }
export interface C02OpenSshProof extends C02OpenSshServerPolicy { purpose: string; run: string; host: string; hostname: string; machineHash: string; socket: string; daemon: string; container: string; image: string; port: number; fingerprint: string; nonce: string; checkedAt: number; restricted: boolean; }
export interface C02OpenSshConfig { directory: string; proofPath: string; nonce: string; machineHash: string; hostname: string; daemon: string; socket: string; port: 13384 | 13484; uuid: string; adminUser: string; adminPassword: string; caPath?: string; }

/** 双门先于配置、材料、数据库或原生应用访问；服务器部署另有独立专项门。 */
export function c02OpenSshEnabled(env: NodeJS.ProcessEnv, mode: 'CORE' | 'UI' | 'SERVER'): boolean { return env.DBARK_INTEGRATION_ENABLED === '1' && env[`DBARK_C02_OPENSSH_${mode}_ENABLED`] === '1'; }
export function c02OpenSshCheck(value: unknown, message: string): asserts value { if (!value) throw new C02FixtureError(message); }

/** 读取fixture实际选项，CLI强制trace/截图/视频时在任何材料或连接访问前拒绝。 */
export function c02OpenSshPrivacy(options: { trace: unknown; screenshot: unknown; video: unknown }): void {
  for (const value of Object.values(options)) c02OpenSshCheck(value === 'off' || !!value && typeof value === 'object' && (value as { mode?: unknown }).mode === 'off', 'C02秘密验收必须关闭实际trace、截图和视频，拒绝CLI覆写采集');
}

/** 只接收本片明确注入的参数，不回退旧SSH、通用.env或任何Root身份。 */
export function c02OpenSshConfig(env: NodeJS.ProcessEnv, mode: 'CORE' | 'UI'): C02OpenSshConfig {
  c02OpenSshCheck(c02OpenSshEnabled(env, mode), 'C02隔离OpenSSH尚未显式开启');
  c02OpenSshCheck(env.DBARK_C02_OPENSSH_ROOT_CONFIRM === 'server-200/192.168.31.200/isolated-openssh', 'C02隔离OpenSSH缺少ROOT核对标记');
  const value = (key: string) => { const result = env[`DBARK_C02_OPENSSH_${key}`]; c02OpenSshCheck(result && !/[\r\n\0]/.test(result), `C02隔离OpenSSH缺少明确${key}`); return result; };
  const path = (key: string) => { const result = value(key); c02OpenSshCheck(isAbsolute(result), `C02隔离OpenSSH的${key}必须为绝对路径`); return result; };
  c02OpenSshCheck(value('DB_HOST') === '192.168.31.200', 'C02仅允许200专用MySQL目标');
  const port = value('DB_PORT'); c02OpenSshCheck(port === '13384' || port === '13484', 'C02隔离OpenSSH只允许13384/13484');
  const uuid = value('DB_UUID').toLowerCase(); c02OpenSshCheck(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid), 'C02必须提供真实MySQL UUID');
  const directory = path('CLIENT_DIR'); c02OpenSshCheck(/^dbark-c02-openssh-[a-f0-9]{32}$/.test(basename(directory)), 'C02只允许本片独占随机材料目录');
  const nonce = value('PROOF_NONCE'), machineHash = value('MACHINE_SHA256');
  c02OpenSshCheck(/^[a-f0-9]{32}$/.test(nonce) && /^[a-f0-9]{64}$/.test(machineHash), 'C02实际服务器核对参数格式错误');
  const socket = value('SOCKET_ID'); c02OpenSshCheck(/^\d+:\d+$/.test(socket), 'C02必须核对实际Docker socket身份');
  return { directory, proofPath: path('PROOF_PATH'), nonce, machineHash, socket, hostname: value('HOSTNAME'), daemon: value('DAEMON_ID'), port: Number(port) as 13384 | 13484, uuid, adminUser: value('ADMIN_USER'), adminPassword: value('ADMIN_PASSWORD'), ...(port === '13484' ? { caPath: path('TLS_CA_PATH') } : {}) };
}

/** 不接受既有Root用户、默认22、通配绑定、未经生成的公钥或未认证指纹。 */
export function c02OpenSshManifest(value: unknown): C02OpenSshManifest {
  const v = value as C02OpenSshManifest;
  c02OpenSshCheck(v && Object.keys(v).sort().join(',') === 'clientPublic,fingerprint,port,purpose,run,user' && v.purpose === c02OpenSshPurpose && /^[a-f0-9]{32}$/.test(v.run), 'C02材料所有权标记无效');
  c02OpenSshCheck(v.user === `c02_${v.run.slice(0, 12)}` && Number.isInteger(v.port) && v.port >= 20000 && v.port <= 29999 && c02SshFingerprint(v.fingerprint), 'C02临时账号、SSH端口或指纹无效');
  c02OpenSshCheck(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}(?: dbark-c02-client)?$/.test(v.clientPublic), 'C02只允许本片Ed25519公钥'); return v;
}

/** 客户端只消费ROOT刚在实际200上核验的记录；这不是客户端直接执行Docker的证明。 */
export function c02OpenSshProof(value: unknown, manifest: C02OpenSshManifest, config: Pick<C02OpenSshConfig, 'nonce' | 'machineHash' | 'hostname' | 'daemon' | 'socket'>, now = Date.now()): C02OpenSshProof {
  const v = value as C02OpenSshProof;
  c02OpenSshCheck(v?.purpose === c02OpenSshPurpose && v.run === manifest.run && v.host === '192.168.31.200' && v.port === manifest.port && v.fingerprint === manifest.fingerprint && v.nonce === config.nonce && v.machineHash === config.machineHash && v.hostname === config.hostname && v.daemon === config.daemon && v.socket === config.socket && v.restricted === true, 'C02实际服务器、socket或容器核对记录不匹配');
  c02OpenSshCheck(/^[a-f0-9]{64}$/.test(v.container) && /^sha256:[a-f0-9]{64}$/.test(v.image) && Number.isSafeInteger(v.checkedAt) && now >= v.checkedAt && now - v.checkedAt <= 300000, 'C02容器身份不完整或核对记录已过期');
  c02OpenSshCheck(v.openSshVersion === c02OpenSshServerVersion && v.maxSessions === 0, 'C02缺少实际固定OpenSSH版本及MaxSessions=0核对'); return v;
}
