import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import { tlsPassphraseMaxLength } from '../../src/shared/tlsCredentials';
import { connectionTransportChanged } from '../../src/shared/connectionProfile';
import { copyConnectionProfile, exportConnectionProfile, connectionTransferDocumentSchema } from '../../src/shared/connectionTransfer';
import { queryConnectionDigest } from '../../src/main/queryBinding';
import { assertConnectionUpdateAllowed } from '../../src/renderer/connectionChanges';

const profile: ConnectionProfile = { id: 'c', name: 'TLS口令边界', group: '', color: '#123456', dialect: 'mysql', host: 'db.example', port: 3306, user: 'test', tls: { enabled: true, rejectUnauthorized: true, keyPath: '/client.key', certPath: '/client.pem' } };

describe('TLS口令契约、来源身份及公开概要', () => {
  it('旧配置保持可读，未提供、明确清空和Unicode空白口令保持原语义', () => {
    for (const passphrase of [undefined, '', '  中文私钥口令  ', 'x'.repeat(tlsPassphraseMaxLength), '中'.repeat(341), '🚢'.repeat(256)]) {
      const value = { ...profile, tls: { ...profile.tls!, passphrase, hasPassphrase: true } };
      expect(validateCommand('connections.save', value)).toEqual(value);
    }
    expect(validateCommand('connections.test', profile)).toEqual(profile);
  });
  it.each([123, null, {}, 'x'.repeat(tlsPassphraseMaxLength + 1), '中'.repeat(342), '🚢'.repeat(257)])('拒绝非文本或越界口令，不在校验错误中回显输入 %#', passphrase => {
    let message = ''; try { validateCommand('connections.save', { ...profile, tls: { ...profile.tls!, passphrase } }); } catch (error) { message = String(error); }
    expect(message).toContain('参数无效'); if (typeof passphrase === 'string') expect(message.includes(passphrase)).toBe(false);
  });
  it('严格拒绝伪造的存在标记类型或额外秘密字段', () => {
    expect(() => validateCommand('connections.save', { ...profile, tls: { ...profile.tls!, hasPassphrase: 'true' } })).toThrow('参数无效');
    expect(() => validateCommand('connections.save', { ...profile, tls: { ...profile.tls!, otherSecret: '秘密' } })).toThrow('参数无效');
  });
  it('口令和已存标记不进入复制、交换格式或来源身份摘要', () => {
    const secret = '仅测试TLS秘密', full = { ...profile, tls: { ...profile.tls!, passphrase: secret, hasPassphrase: true } };
    for (const value of [copyConnectionProfile(full), exportConnectionProfile(full)]) {
      const json = JSON.stringify(value); expect(json.includes(secret)).toBe(false); expect(json).not.toContain('hasPassphrase'); expect(value.tls).not.toHaveProperty('passphrase');
    }
    expect(queryConnectionDigest(full)).toBe(queryConnectionDigest(profile));
    for (const field of [{ passphrase: secret }, { hasPassphrase: true }]) {
      expect(() => connectionTransferDocumentSchema.parse({ format: 'DBArk-connections', version: 1, connections: [{ ...exportConnectionProfile(profile), tls: { enabled: true, rejectUnauthorized: true, ...field } }] })).toThrow();
    }
  });
  it('补填或清除口令属于认证变更，存在标记本身和缺省保留不会改变身份', () => {
    const previous = { ...profile, tls: { ...profile.tls!, hasPassphrase: true } };
    expect(connectionTransportChanged(previous, profile)).toBe(false);
    for (const passphrase of ['新口令', '']) {
      const next = { ...previous, tls: { ...previous.tls, passphrase } };
      expect(connectionTransportChanged(previous, next)).toBe(true);
      expect(() => assertConnectionUpdateAllowed(previous, next, [{ id: 't', kind: 'query', title: '原查询', connectionId: profile.id }])).toThrow();
    }
    const resolved = { ...previous, tls: { ...previous.tls, passphrase: '实际相同口令' } };
    expect(connectionTransportChanged(resolved, structuredClone(resolved), { preserveMissingSecrets: false })).toBe(false);
    expect(connectionTransportChanged(resolved, { ...resolved, tls: { ...resolved.tls, passphrase: '' } }, { preserveMissingSecrets: false })).toBe(true);
  });
});
