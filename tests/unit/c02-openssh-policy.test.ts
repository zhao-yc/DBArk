import { describe, expect, it } from 'vitest';
import { utils } from 'ssh2';
import { resolve } from 'node:path';
import { c02OpenSshConfig, c02OpenSshEnabled, c02OpenSshManifest, c02OpenSshProof, c02OpenSshPurpose, c02OpenSshPrivacy } from '../integration/helpers/c02-openssh-policy';
import { generateC02OpenSshMaterials } from '../integration/helpers/c02-openssh-materials';

const manifest = { purpose: c02OpenSshPurpose, run: 'a'.repeat(32), user: 'c02_' + 'a'.repeat(12), port: 22384, fingerprint: 'SHA256:' + Buffer.alloc(32, 1).toString('base64').replace(/=+$/, ''), clientPublic: 'ssh-ed25519 YWJj dbark-c02-client' } as const;
const config = { nonce: 'b'.repeat(32), machineHash: 'c'.repeat(64), hostname: 'only-test-server', daemon: 'only-test-daemon', socket: '1:2' };
const proof = { purpose: c02OpenSshPurpose, run: manifest.run, host: '192.168.31.200', ...config, container: 'd'.repeat(64), image: 'sha256:' + 'e'.repeat(64), port: manifest.port, fingerprint: manifest.fingerprint, checkedAt: 1000000, restricted: true, openSshVersion: 'OpenSSH_10.2p1', maxSessions: 0 };
/** 全部是自有虚构策略数据，不读当前环境、凭据或200机器身份。 */
function env(): NodeJS.ProcessEnv { return { DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_OPENSSH_CORE_ENABLED: '1', DBARK_C02_OPENSSH_ROOT_CONFIRM: 'server-200/192.168.31.200/isolated-openssh', DBARK_C02_OPENSSH_DB_HOST: '192.168.31.200', DBARK_C02_OPENSSH_DB_PORT: '13384', DBARK_C02_OPENSSH_DB_UUID: '11111111-2222-3333-4444-555555555555', DBARK_C02_OPENSSH_CLIENT_DIR: resolve('own', `dbark-c02-openssh-${manifest.run}`), DBARK_C02_OPENSSH_PROOF_PATH: resolve('own', 'server-proof.json'), DBARK_C02_OPENSSH_PROOF_NONCE: config.nonce, DBARK_C02_OPENSSH_MACHINE_SHA256: config.machineHash, DBARK_C02_OPENSSH_SOCKET_ID: config.socket, DBARK_C02_OPENSSH_HOSTNAME: config.hostname, DBARK_C02_OPENSSH_DAEMON_ID: config.daemon, DBARK_C02_OPENSSH_ADMIN_USER: '仅测试管理员', DBARK_C02_OPENSSH_ADMIN_PASSWORD: '仅测试占位，不是实际凭据' }; }

describe('隔离OpenSSH默认门与范围', () => {
  it.each(['CORE', 'UI', 'SERVER'] as const)('%s默认关闭，通用SSH/mTLS门不能顺带开启', mode => {
    expect(c02OpenSshEnabled({}, mode)).toBe(false); expect(c02OpenSshEnabled({ DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_SSH_UI_ENABLED: '1', DBARK_C02_MTLS_ENABLED: '1' }, mode)).toBe(false);
    expect(c02OpenSshEnabled({ DBARK_INTEGRATION_ENABLED: '1', [`DBARK_C02_OPENSSH_${mode}_ENABLED`]: '1' }, mode)).toBe(true);
  });
  it('关门时甚至不访问后续配置getter', () => {
    const values = {}; Object.defineProperty(values, 'DBARK_C02_OPENSSH_ROOT_CONFIRM', { get() { throw Error('关门后不应读配置'); } });
    expect(() => c02OpenSshConfig(values, 'CORE')).toThrow('尚未显式开启');
  });
  it('只接受两个既有MySQL8.4端口，SSH端口不允许默认22或数据库端口', () => {
    expect(c02OpenSshConfig(env(), 'CORE').port).toBe(13384);
    for (const port of ['13357', '13380', '13310', '13311', '3306', '22']) expect(() => c02OpenSshConfig({ ...env(), DBARK_C02_OPENSSH_DB_PORT: port }, 'CORE')).toThrow('只允许13384/13484');
    for (const port of [22, 13384, 19999, 30000]) expect(() => c02OpenSshManifest({ ...manifest, port })).toThrow();
  });
  it('13484必须显式CA，不能回退明文；不读旧Root配置或旧身份字段', () => {
    expect(() => c02OpenSshConfig({ ...env(), DBARK_C02_OPENSSH_DB_PORT: '13484' }, 'CORE')).toThrow('TLS_CA_PATH');
    expect(c02OpenSshConfig({ ...env(), DBARK_C02_OPENSSH_DB_PORT: '13484', DBARK_C02_OPENSSH_TLS_CA_PATH: resolve('own', 'ca.pem') }, 'CORE').caPath).toBe(resolve('own', 'ca.pem'));
    expect(() => c02OpenSshConfig({ ...env(), DBARK_C02_OPENSSH_CLIENT_DIR: resolve('own', '.ssh') }, 'CORE')).toThrow('独占随机材料');
  });
  it.each([{ user: 'root' }, { run: '../root' }, { clientPublic: 'command="/bin/sh" ssh-ed25519 YWJj' }, { fingerprint: 'SHA256:截断' }, { unknown: '不接受额外字段' }])('材料拒绝其它身份或注入%j', patch => { expect(() => c02OpenSshManifest({ ...manifest, ...patch })).toThrow(); });
  it('ROOT新鲜核对记录匹配才可消费，不能以未认证扫描或环境自述替代', () => { expect(c02OpenSshProof(proof, manifest, config, 1000001).run).toBe(manifest.run); });
  it.each([{ host: '127.0.0.1' }, { machineHash: '0'.repeat(64) }, { socket: '1:3' }, { daemon: '其它daemon' }, { hostname: '本机' }, { nonce: '0'.repeat(32) }, { run: '0'.repeat(32) }, { port: 22 }, { fingerprint: 'SHA256:错误' }, { restricted: false }, { container: '短ID' }, { image: 'latest' }])('真实目标/容器证明变化%j拒绝', patch => { expect(() => c02OpenSshProof({ ...proof, ...patch }, manifest, config, 1000001)).toThrow(); });
  it('过期或未来核对记录不能作为当前服务器证明', () => { expect(() => c02OpenSshProof(proof, manifest, config, 1300001)).toThrow('过期'); expect(() => c02OpenSshProof(proof, manifest, config, 999999)).toThrow('过期'); });
  it.each([{ openSshVersion: undefined }, { openSshVersion: 'OpenSSH_10.1p1' }, { maxSessions: undefined }, { maxSessions: 1 }])('拒绝缺失或错误的实际版本/会话策略%j', patch => { expect(() => c02OpenSshProof({ ...proof, ...patch }, manifest, config, 1000001)).toThrow('固定OpenSSH版本'); });
  it('实际off或对象off允许；CLI开启任一采集时拒绝，不依赖项目默认值', () => {
    expect(() => c02OpenSshPrivacy({ trace: 'off', screenshot: { mode: 'off' }, video: 'off' })).not.toThrow();
    for (const key of ['trace', 'screenshot', 'video']) expect(() => c02OpenSshPrivacy({ trace: 'off', screenshot: 'off', video: 'off', [key]: 'on' })).toThrow('拒绝CLI覆写');
  });
});

describe('实际新临时密钥的纯格式验证，不计OpenSSH互通', () => {
  it('现代OpenSSH私钥确实AES/bcrypt加密；缺/错口令不能解析，正确口令可签名验证', () => {
    const own = generateC02OpenSshMaterials(22384);
    // 只断言非秘密元数据/布尔，失败报告不能展开私钥或口令对象。
    expect(own.clientPrivate.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true);
    const bytes = Buffer.from(own.clientPrivate.split('\n').filter(line => !line.startsWith('---')).join(''), 'base64');
    let offset = 'openssh-key-v1\0'.length; const string = () => { const size = bytes.readUInt32BE(offset); offset += 4; const value = bytes.subarray(offset, offset + size); offset += size; return value; };
    expect(string().toString()).toBe('aes256-ctr'); expect(string().toString()).toBe('bcrypt'); const options = string(); expect(options.readUInt32BE(options.length - 4)).toBe(16);
    expect(utils.parseKey(own.clientPrivate) instanceof Error).toBe(true); expect(utils.parseKey(own.clientPrivate, own.passphrase + '-wrong') instanceof Error).toBe(true);
    const parsed = utils.parseKey(own.clientPrivate, own.passphrase); const valid = !(parsed instanceof Error) && !Array.isArray(parsed);
    expect(valid).toBe(true); if (!valid) return;
    const data = Buffer.from('仅用于本地格式验证'), signature = parsed.sign(data); expect(!(signature instanceof Error) && parsed.verify(data, signature)).toBe(true);
    expect(parsed.getPublicSSH().equals(Buffer.from(own.manifest.clientPublic.split(' ')[1], 'base64'))).toBe(true);
    expect(own.password.length === 48 && own.passphrase.length === 48 && own.password !== own.passphrase).toBe(true);
  });
});
