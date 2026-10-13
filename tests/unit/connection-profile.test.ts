import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connectionTransportChanged } from '../../src/shared/connectionProfile';

const original: ConnectionProfile = { id: 'connection', name: '开发库', group: '', color: '#abcdef', host: 'db.example', port: 3306, user: 'user', dialect: 'mysql', hasPassword: true, ssh: { enabled: true, host: 'jump.example', port: 22, user: 'ssh', hasPassword: true, hasPassphrase: true }, tls: { enabled: true, rejectUnauthorized: true, caPath: '/ca.pem' } };

describe('连接目标与认证变更判定', () => {
  it('名称、分组、颜色和记住密码策略不改变连接目标', () => {
    expect(connectionTransportChanged(original, { ...original, name: '重命名', group: '生产', color: '#123456', rememberPassword: false })).toBe(false);
  });
  it('未重填三种秘密保持原值，而显式清除任何已保存秘密需要重连', () => {
    expect(connectionTransportChanged(original, { ...original })).toBe(false);
    expect(connectionTransportChanged(original, { ...original, password: '' })).toBe(true);
    expect(connectionTransportChanged(original, { ...original, ssh: { ...original.ssh!, password: '' } })).toBe(true);
    expect(connectionTransportChanged(original, { ...original, ssh: { ...original.ssh!, passphrase: '' } })).toBe(true);
  });
  it('界面重填不可见密码按变更处理，解密后相同秘密则允许保持当前会话', () => {
    expect(connectionTransportChanged(original, { ...original, password: '新输入' })).toBe(true);
    const resolved = { ...original, password: '现有密码' };
    expect(connectionTransportChanged(resolved, { ...resolved }, { preserveMissingSecrets: false })).toBe(false);
    expect(connectionTransportChanged(resolved, { ...resolved, password: undefined }, { preserveMissingSecrets: false })).toBe(true);
  });
  it('不存在的秘密被清空、默认未启用SSH/TLS不产生伪变更', () => {
    const empty: ConnectionProfile = { ...original, hasPassword: false, ssh: undefined, tls: undefined };
    expect(connectionTransportChanged(empty, { ...empty, password: '', database: '', ssh: { enabled: false, host: '', port: 22, user: '' }, tls: { enabled: false, rejectUnauthorized: true } })).toBe(false);
  });
  it.each([
    { host: 'other.example' }, { port: 3307 }, { user: 'other' }, { database: 'another' }, { dialect: 'mariadb' as const },
    { ssh: { ...original.ssh!, hostFingerprint: 'SHA256:changed' } }, { ssh: { ...original.ssh!, privateKeyPath: '/different-key' } },
    { ssh: { ...original.ssh!, enabled: false } }, { tls: { ...original.tls!, caPath: '/other-ca.pem' } }, { tls: { ...original.tls!, rejectUnauthorized: false } },
  ])('数据库地址、认证或信任设置变更必须受保护：%j', patch => {
    expect(connectionTransportChanged(original, { ...original, ...patch })).toBe(true);
  });
});
