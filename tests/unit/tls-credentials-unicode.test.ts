import { describe, expect, it } from 'vitest';
import { assertTlsPassphrase, validTlsPassphrase } from '../../src/shared/tlsCredentials';
import { validateCommand } from '../../src/shared/validation';
import { connectionTlsOptions } from '../../src/engine/connectionTls';

/** 固定虚构口令仅检查共享入口，不读取证书、连接数据库或改写任何 Unicode 输入。 */
describe('TLS 私钥口令 UTF-16 配对与原字符边界', () => {
  it.each(['\ud800', '\udbff', '\udc00', '\udfff', '\ud800A', 'A\udfff', '\ud800\ud800\udc00', '\udc00\ud800', '🚀\ud800', '\udfff🚀'])('拒绝孤立或错配代理项，错误不回显输入 %#', value => {
    expect(Buffer.from(value, 'utf8').toString('utf8') === value).toBe(false);
    expect(validTlsPassphrase(value)).toBe(false);
    let error: unknown; try { assertTlsPassphrase(value); } catch (reason) { error = reason; }
    expect(error).toBeInstanceOf(Error); expect(String(error).includes(value)).toBe(false);
    expect(() => connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: value }, {})).toThrow('有效 Unicode');
    for (const command of ['connections.save', 'connections.test'] as const) {
      expect(() => validateCommand(command, { id: 'unicode-test', name: '纯校验', group: '', color: '#123456', dialect: 'mysql', host: 'localhost', port: 3306, user: 'test', tls: { enabled: true, rejectUnauthorized: true, passphrase: value } })).toThrow('参数无效');
    }
  });
  it.each(['', '  中文🚀  ', '\u0000保留\u0000', '\ud800\udc00', '\udbff\udfff', '🚀'.repeat(256), '中'.repeat(341) + '\u0000', '🚀'.repeat(255) + ' A\u0000 '])('有效代理对、中文、空白、NUL与1024字节边界保持原字符 %#', value => {
    expect(Buffer.from(value, 'utf8').toString('utf8') === value).toBe(true);
    expect(validTlsPassphrase(value)).toBe(true); expect(() => assertTlsPassphrase(value)).not.toThrow();
    expect(connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: value }, {})?.passphrase === value).toBe(true);
  });
  it('有效Unicode仍执行原字节上限，未填写继续保留原语义', () => {
    expect(validTlsPassphrase(undefined)).toBe(true);
    for (const value of ['x'.repeat(1025), '中'.repeat(342), '🚀'.repeat(257), '🚀'.repeat(256) + '\u0000']) expect(validTlsPassphrase(value)).toBe(false);
  });
});
