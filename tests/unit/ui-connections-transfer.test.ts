import { describe, expect, it } from 'vitest';
import { assignAuthorizedConnectionFile, copyConnectionOverview, type PendingConnectionProfile } from '../../src/renderer/connectionsTransfer';

const source: PendingConnectionProfile = { id: 'old-id', name: '源连接', group: '分组', color: '#123456', dialect: 'mysql', host: 'example.test', port: 3306, user: 'dbuser', database: 'CaseDB', password: 'secret-db', hasPassword: true, rememberPassword: true, ssh: { enabled: true, host: 'ssh.test', port: 22, user: 'sshuser', password: 'secret-ssh', hasPassword: true, passphrase: 'secret-passphrase', hasPassphrase: true, privateKeyPath: 'C:\\private\\key.pem', hostFingerprint: 'SHA256:fixed' }, tls: { enabled: true, rejectUnauthorized: true, caPath: 'C:\\private\\ca.pem', certPath: 'C:\\private\\cert.pem', keyPath: 'C:\\private\\tls.pem' } };

describe('连接概要复制与授权补文件', () => {
  it('复制新表单不携带秘密、旧ID或有效认证路径，保持安全设置', () => {
    const copy = copyConnectionOverview(source);
    expect(copy.id).toBe(''); expect(copy.name).toBe('源连接 副本'); expect(copy.rememberPassword).toBe(false);
    for (const field of ['password', 'hasPassword']) expect(Object.hasOwn(copy, field)).toBe(false);
    for (const field of ['password', 'hasPassword', 'passphrase', 'hasPassphrase', 'privateKeyPath']) expect(Object.hasOwn(copy.ssh!, field)).toBe(false);
    for (const field of ['caPath', 'certPath', 'keyPath']) expect(Object.hasOwn(copy.tls!, field)).toBe(false);
    expect(copy.ssh!.enabled).toBe(true); expect(copy.ssh!.hostFingerprint).toBe('SHA256:fixed'); expect(copy.tls!.rejectUnauthorized).toBe(true);
    expect(copy.pendingFiles).toEqual(['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey']);
    expect(JSON.stringify(copy)).not.toContain('secret-'); expect(source.ssh!.privateKeyPath).toBe('C:\\private\\key.pem');
  });
  it('禁用组件仍保留待补文件身份，不因以后启用而丢失验证门槛', () => {
    const copy = copyConnectionOverview({ ...source, ssh: { ...source.ssh!, enabled: false }, tls: { ...source.tls!, enabled: false } });
    expect(copy.ssh!.enabled).toBe(false); expect(copy.tls!.enabled).toBe(false); expect(copy.pendingFiles).toHaveLength(4);
  });
  it('只有明确授权选择能消除对应标记，其他待补项及验证状态保持', () => {
    const pending: PendingConnectionProfile = { ...source, pendingFiles: ['sshPrivateKey', 'tlsCa', 'tlsCert', 'tlsKey'] };
    const manuallyTyped = { ...pending, tls: { ...pending.tls!, caPath: 'C:\\typed.pem' } }; expect(manuallyTyped.pendingFiles).toEqual(pending.pendingFiles);
    const selected = assignAuthorizedConnectionFile(pending, 'tlsCa', 'C:\\chosen.pem');
    expect(selected.tls!.caPath).toBe('C:\\chosen.pem'); expect(selected.pendingFiles).toEqual(['sshPrivateKey', 'tlsCert', 'tlsKey']); expect(selected.tls!.rejectUnauthorized).toBe(true);
    expect(pending.pendingFiles).toHaveLength(4); expect(pending.tls!.caPath).toBe('C:\\private\\ca.pem');
    const sshSelected = assignAuthorizedConnectionFile(selected, 'sshPrivateKey', 'C:\\ssh.pem'); expect(sshSelected.ssh!.hostFingerprint).toBe('SHA256:fixed'); expect(sshSelected.pendingFiles).toEqual(['tlsCert', 'tlsKey']);
  });
});
