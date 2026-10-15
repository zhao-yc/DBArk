import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Duplex } from 'node:stream';
import { createSecureContext, TLSSocket } from 'node:tls';
import mysql from 'mysql2';
import { beforeAll, describe, expect, it } from 'vitest';
import { connectionTlsOptions, tlsConnectionError } from '../../src/engine/connectionTls';
import { tlsPassphraseMaxLength } from '../../src/shared/tlsCredentials';

let encrypted: Buffer, plain: Buffer, phrase: string;
beforeAll(() => {
  // 一次性私钥及口令只在测试进程内存存在，不生成证书、不监听端口、不保存PEM或秘密。
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 }); phrase = randomBytes(24).toString('hex');
  encrypted = Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: phrase }));
  plain = Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
});

describe('真实Node TLS及mysql2的加密PEM参数', () => {
  it('正式选项携带独立口令，真实OpenSSL成功解密；未加密旧key仍兼容', () => {
    const options = connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: phrase }, { key: encrypted })!;
    expect(options.passphrase === phrase).toBe(true); expect(options.rejectUnauthorized).toBe(true); expect(options.verifyIdentity).toBe(true);
    expect(() => createSecureContext(options)).not.toThrow();
    expect(() => createSecureContext(connectionTlsOptions({ enabled: true, rejectUnauthorized: true }, { key: plain })!)).not.toThrow();
  });
  it.each(['missing', 'wrong'])('真实OpenSSL拒绝%s口令，没有模拟验证成功', kind => {
    const options = connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: kind === 'missing' ? undefined : '错误的测试口令' }, { key: encrypted })!;
    expect(() => createSecureContext(options)).toThrow();
  });
  it('真实mysql2 startTLS使用口令创建真实SecureContext，同一ssl对象口令改错后不能复用缓存', () => {
    const ssl = connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: phrase }, { key: encrypted })!;
    /** 使用真实驱动和内存Duplex，不创建网络连接；仅验证TLS初始化和加密key解密，不声称认证握手完成。 */
    function driver() {
      const raw = new Duplex({ read() {}, write(_bytes, _encoding, done) { done(); } });
      const connection = mysql.createConnection({ stream: raw, ssl, host: 'memory.invalid', connectTimeout: 0 }); connection.on('error', () => {});
      return { raw, connection: connection as typeof connection & { startTLS(done: (error?: Error) => void): void; stream: TLSSocket } };
    }
    const good = driver();
    try { good.connection.startTLS(() => {}); expect(good.connection.stream instanceof TLSSocket).toBe(true); expect(good.connection.stream.encrypted).toBe(true); }
    finally { good.connection.destroy(); good.raw.destroy(); }
    ssl.passphrase = '错误口令使真实驱动缓存失效'; const bad = driver();
    try { expect(() => bad.connection.startTLS(() => {})).toThrow(); }
    finally { bad.connection.destroy(); bad.raw.destroy(); }
  });
  it('utility选项拒绝越界，禁用TLS不产生ssl选项，连接错误删除原异常秘密及cause', () => {
    expect(connectionTlsOptions(undefined, {})).toBeUndefined();
    expect(connectionTlsOptions({ enabled: false, rejectUnauthorized: true, passphrase: phrase }, { key: encrypted })).toBeUndefined();
    expect(() => connectionTlsOptions({ enabled: true, rejectUnauthorized: true, passphrase: 'x'.repeat(tlsPassphraseMaxLength + 1) }, {})).toThrow('不能超过');
    const original = new Error('拒绝：' + phrase, { cause: { passphrase: phrase } });
    const error = tlsConnectionError(original, phrase) as Error;
    expect(error.message.includes(phrase)).toBe(false); expect(error.stack?.includes(phrase)).toBe(false); expect(error).not.toHaveProperty('cause'); expect(error).not.toBe(original);
    expect(tlsConnectionError(original, undefined)).toBe(original);
  });
});
