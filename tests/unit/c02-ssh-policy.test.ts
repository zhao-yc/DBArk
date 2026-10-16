import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { c02SshConfig, c02SshEnabled, c02SshFingerprint, c02SshPorts, c02SshVersion, c02WrongSshFingerprint } from '../integration/helpers/c02-ssh-policy';

/** 虚构元数据只检查纯门禁，不读取文件、运行ssh或认证连接。 */
function environment(): NodeJS.ProcessEnv { return {
  DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_SSH_UI_ENABLED: '1', DBARK_C02_SSH_ROOT_CONFIRM: 'server-200/192.168.31.200/c02-ssh', DBARK_C02_SSH_ALIAS: 'server-200', DBARK_C02_SSH_HOST: '192.168.31.200', DBARK_C02_SSH_DB_HOST: '192.168.31.200', DBARK_C02_SSH_DB_PORT: '13384', DBARK_C02_SSH_PORT: '22', DBARK_C02_SSH_USER: '虚构用户', DBARK_C02_SSH_KEY_MODE: 'existing-unencrypted', DBARK_C02_SSH_KEY_PATH: join(process.cwd(), '.cache', '虚构只读身份', 'key'), DBARK_C02_SSH_TEMP_PARENT: join(process.cwd(), '.cache', '虚构临时目录'), DBARK_C02_SSH_HOST_SHA256: 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''), DBARK_C02_SSH_ADMIN_USER: '虚构管理账号', DBARK_C02_SSH_ADMIN_PASSWORD: '虚构管理口令', DBARK_C02_SSH_DB_UUID: '01234567-89ab-cdef-0123-456789abcdef',
}; }

describe('C02 SSH 专属默认关闭与ROOT显式身份', () => {
  it('仅两个专属开关全开才启用，旧SSH/mTLS开关不能启动', () => {
    for (const common of ['0', '1']) for (const ssh of ['0', '1']) expect(c02SshEnabled({ DBARK_INTEGRATION_ENABLED: common, DBARK_C02_SSH_UI_ENABLED: ssh, DBARK_TEST_SSH: '1', DBARK_C02_MTLS_UI_ENABLED: '1' })).toBe(common === '1' && ssh === '1');
  });
  it('关闭时在读取路径、身份或管理凭据之前拒绝', () => {
    const env = new Proxy({}, { get(_, key) { if (key === 'DBARK_INTEGRATION_ENABLED') return '0'; throw new Error('不应读取其它环境'); } });
    expect(() => c02SshConfig(env)).toThrow('尚未显式启用');
  });
  it.each(['DBARK_C02_SSH_ROOT_CONFIRM', 'DBARK_C02_SSH_ALIAS', 'DBARK_C02_SSH_HOST', 'DBARK_C02_SSH_DB_HOST'])('缺少/错误%s不能因通用配置存在而放行', key => {
    expect(() => c02SshConfig({ ...environment(), [key]: '其它目标', DBARK_TEST_HOST: '192.168.31.200' })).toThrow('只允许 ROOT');
  });
  it.each(c02SshPorts)('授权上界只接受既有端口%s，13484必须另给严格CA路径', port => {
    const env: NodeJS.ProcessEnv = { ...environment(), DBARK_C02_SSH_DB_PORT: String(port) };
    if (port === 13484) { expect(() => c02SshConfig(env)).toThrow('TLS_CA_PATH'); env.DBARK_C02_SSH_TLS_CA_PATH = join(process.cwd(), '不存在的CA'); }
    expect(c02SshConfig(env).port).toBe(port);
  });
  it.each(['3306', '13485', '013384', '0', '65536'])('拒绝范围外或非规范端口%s', port => { expect(() => c02SshConfig({ ...environment(), DBARK_C02_SSH_DB_PORT: port })).toThrow(); });
  it.each(['DBARK_C02_SSH_PORT', 'DBARK_C02_SSH_USER', 'DBARK_C02_SSH_KEY_PATH', 'DBARK_C02_SSH_TEMP_PARENT', 'DBARK_C02_SSH_ADMIN_USER', 'DBARK_C02_SSH_ADMIN_PASSWORD', 'DBARK_C02_SSH_DB_UUID'])('必须显式提供%s，不读ssh配置或env文件补齐', key => { expect(() => c02SshConfig({ ...environment(), [key]: undefined })).toThrow(); });
  it('拒绝相对/含换行身份路径，错误不输出原路径内容', () => {
    for (const path of ['./key', '/虚构\n私钥']) expect(() => c02SshConfig({ ...environment(), DBARK_C02_SSH_KEY_PATH: path })).toThrow('绝对路径');
  });
  it('独占userData不能写进原SSH身份目录或其子目录', () => {
    const parent = join(process.cwd(), '.cache', '虚构只读身份');
    for (const path of [parent, join(parent, '子目录')]) expect(() => c02SshConfig({ ...environment(), DBARK_C02_SSH_TEMP_PARENT: path })).toThrow('原身份目录');
    expect(c02SshConfig(environment()).tempParent).toBe(environment().DBARK_C02_SSH_TEMP_PARENT);
  });
  it('仅支持已确认未加密身份，密码SSH和私钥口令必须明确留在未验范围', () => {
    for (const patch of [{ DBARK_C02_SSH_KEY_MODE: 'encrypted' }, { DBARK_C02_SSH_PASSWORD: '不输出' }, { DBARK_C02_SSH_KEY_PASSPHRASE: '不输出' }]) expect(() => c02SshConfig({ ...environment(), ...patch })).toThrow('不验密码SSH或私钥口令');
  });
  it('既有密钥/环境均不存在也必须先被默认门禁拒绝，回调不执行', async () => {
    const { withC02SshLease } = await import('../integration/helpers/c02-ssh-fixture'), callback = vi.fn(async () => {});
    await expect(withC02SshLease({}, callback)).rejects.toThrow('尚未显式启用'); expect(callback).not.toHaveBeenCalled();
  });
});

describe('C02 SSH 指纹负例及版本边界纯检查', () => {
  it('变换后指纹仍规范且解码字节确实不同，不用格式错误冒充身份验证', () => {
    const actual = environment().DBARK_C02_SSH_HOST_SHA256!, wrong = c02WrongSshFingerprint(actual);
    expect(c02SshFingerprint(actual)).toBe(true); expect(c02SshFingerprint(wrong)).toBe(true); expect(wrong).not.toBe(actual); expect(Buffer.from(wrong.slice(7), 'base64').equals(Buffer.from(actual.slice(7), 'base64'))).toBe(false);
  });
  it.each(['SHA256:bad', 'MD5:bad', 'SHA256:' + 'A'.repeat(42), 'SHA256:' + 'A'.repeat(43) + '=', 'SHA256:' + 'A'.repeat(42) + 'B'])('拒绝非规范指纹 %#', fingerprint => { expect(c02SshFingerprint(fingerprint)).toBe(false); expect(() => c02WrongSshFingerprint(fingerprint)).toThrow(); });
  it('MySQL8才进入用户令牌夹具，旧版/MariaDB只返回未验，不伪造新UI覆盖', () => {
    for (const [port, version] of [[13380, '8.0.46'], [13384, '8.4.11'], [13484, '8.4.11']] as const) expect(c02SshVersion(port, version)).toEqual({ targetMatches: true, ownerSupported: true });
    for (const [port, version] of [[13357, '5.7.44'], [13310, '10.11.19-MariaDB'], [13311, '11.4.13-MariaDB'], [13380, '8.0.20']] as const) expect(c02SshVersion(port, version)).toEqual({ targetMatches: true, ownerSupported: false });
    expect(c02SshVersion(13384, '11.4.13-MariaDB')).toEqual({ targetMatches: false, ownerSupported: false }); expect(c02SshVersion(3306, '8.4.11').targetMatches).toBe(false);
  });
});
