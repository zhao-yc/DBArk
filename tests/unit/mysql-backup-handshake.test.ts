import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { inspectMysqlBackupHandshake } from '../../src/engine/mysqlBackupHandshake';
import { mysqlBackupTunnelHost } from '../../src/shared/mysqlDatabaseBackup';

function greeting(version: string, tls: boolean) {
  const packet = Buffer.alloc(4 + 1 + Buffer.byteLength(version) + 1 + 16);
  packet.writeUIntLE(packet.length - 4, 0, 3);
  packet[4] = 10;
  packet.write(version, 5, 'ascii');
  if (tls) packet.writeUInt16LE(0x0800, 5 + version.length + 14);
  return packet;
}

describe('MySQL 和 MariaDB SSH 备份握手', () => {
  it('分片握手经检查后仍以原字节转发，包括 MariaDB 兼容前缀', async () => {
    const stream = new PassThrough(), bytes = greeting('5.5.5-11.4.13-MariaDB', true);
    const pending = inspectMysqlBackupHandshake(stream, '11.4.13-MariaDB', true);
    stream.write(bytes.subarray(0, 2));
    stream.write(bytes.subarray(2, 9));
    stream.write(bytes.subarray(9));
    await pending;
    expect(stream.read()).toEqual(bytes);
    stream.destroy();
  });

  it.each([
    ['8.4.11', false, '8.4.11', true],
    ['8.4.12', true, '8.4.11', true],
    ['11.4.13-MariaDB', true, '8.4.11', false],
  ] as const)('TLS 和来源版本必须与已连接数据库一致', async (version, ssl, expected, requireSsl) => {
    const stream = new PassThrough();
    const pending = inspectMysqlBackupHandshake(stream, expected, requireSsl);
    stream.end(greeting(version, ssl));
    await expect(pending).rejects.toThrow('无法确认 SSH 转发');
  });

  it('SSH 中断时拒绝半包', async () => {
    const stream = new PassThrough();
    const pending = inspectMysqlBackupHandshake(stream, '8.4.11', false);
    stream.end(greeting('8.4.11', false).subarray(0, 8));
    await expect(pending).rejects.toThrow('无法确认 SSH 转发');
  });

  it('严格 TLS 仅保留相同回环地址，拒绝其它证书身份的 SSH 配置', () => {
    const ssh = { enabled: true, host: 'jump.invalid', port: 22, user: 'backup' };
    const tls = { enabled: true, rejectUnauthorized: true };
    expect(mysqlBackupTunnelHost({ host: 'db.invalid', tls })).toBeUndefined();
    expect(mysqlBackupTunnelHost({ host: 'db.invalid', ssh })).toBe('127.0.0.1');
    expect(mysqlBackupTunnelHost({ host: 'db.invalid', ssh, tls: { ...tls, rejectUnauthorized: false } })).toBe('127.0.0.1');
    expect(mysqlBackupTunnelHost({ host: '127.0.0.1', ssh, tls })).toBe('127.0.0.1');
    expect(mysqlBackupTunnelHost({ host: '::1', ssh, tls })).toBe('::1');
    expect(() => mysqlBackupTunnelHost({ host: 'db.invalid', ssh, tls })).toThrow('验证数据库证书');
  });
});
