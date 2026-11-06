import { once } from 'node:events';
import { createConnection, createServer, type AddressInfo, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { connect, TLSSocket } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { inspectMysqlBackupHandshake, readMysqlBackupHandshake, readMysqlBackupSslRequest } from '../../src/engine/mysqlBackupHandshake';
import { createMysqlBackupLoopbackIdentity, upgradeMysqlBackupTls } from '../../src/engine/mysqlBackupTlsRelay';
import { openNativeBackupTunnel } from '../../src/engine/nativeBackupTunnel';
import { mysqlBackupTunnelRoute } from '../../src/shared/mysqlDatabaseBackup';

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

  it('同一回环地址保留原转发方式，严格 TLS 的其他地址启用双段校验', () => {
    const ssh = { enabled: true, host: 'jump.invalid', port: 22, user: 'backup' };
    const tls = { enabled: true, rejectUnauthorized: true };
    expect(mysqlBackupTunnelRoute({ host: 'db.invalid', tls })).toBeUndefined();
    expect(mysqlBackupTunnelRoute({ host: 'db.invalid', ssh })).toEqual({ host: '127.0.0.1', verifyUpstream: false });
    expect(mysqlBackupTunnelRoute({ host: 'db.invalid', ssh, tls: { ...tls, rejectUnauthorized: false } })).toEqual({ host: '127.0.0.1', verifyUpstream: false });
    expect(mysqlBackupTunnelRoute({ host: '127.0.0.1', ssh, tls })).toEqual({ host: '127.0.0.1', verifyUpstream: false });
    expect(mysqlBackupTunnelRoute({ host: '::1', ssh, tls })).toEqual({ host: '::1', verifyUpstream: false });
    expect(mysqlBackupTunnelRoute({ host: 'db.invalid', ssh, tls })).toEqual({ host: '127.0.0.1', verifyUpstream: true });
    expect(mysqlBackupTunnelRoute({ host: '192.0.2.10', ssh, tls })).toEqual({ host: '127.0.0.1', verifyUpstream: true });
  });
});

describe('MySQL 原生备份双段 TLS', () => {
  it.each(['match', 'wrong-host', 'plaintext'] as const)('只在上下游 TLS 均成立时转发认证数据：%s', async scenario => {
    const [upstream, local] = await Promise.all([createMysqlBackupLoopbackIdentity(), createMysqlBackupLoopbackIdentity()]);
    const signal = AbortSignal.timeout(5000), version = '8.4.11';
    const request = Buffer.alloc(36);
    request[0] = 32; request[3] = 1; request.writeUInt32LE(0x0a00, 4);
    let received = '', sslRequested = false, serverSocket: Socket | undefined, serverTls: TLSSocket | undefined;
    const server = createServer(socket => {
      serverSocket = socket;
      socket.on('error', () => {});
      socket.write(greeting(version, true));
      void readMysqlBackupSslRequest(socket, signal).then(packet => {
        sslRequested = packet.equals(request);
        serverTls = new TLSSocket(socket, { isServer: true, secureContext: upstream.context });
        serverTls.on('error', () => {});
        serverTls.on('data', data => { received += data.toString(); serverTls!.write('回复'); });
      }, () => socket.destroy());
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const tunnel = await openNativeBackupTunnel('127.0.0.1',
      async () => createConnection((server.address() as AddressInfo).port, '127.0.0.1'), () => {}, undefined,
      (socket, channel) => upgradeMysqlBackupTls(socket, channel, {
        host: scenario === 'wrong-host' ? 'db.invalid' : '127.0.0.1', version, signal, upstream: { ca: upstream.cert }, local: local.context,
      }));
    const socket = createConnection(tunnel.port, tunnel.host);
    let client: TLSSocket | undefined;
    try {
      await readMysqlBackupHandshake(socket, version, true, signal);
      if (scenario === 'plaintext') {
        const closed = once(socket, 'close');
        socket.write(Buffer.from([4, 0, 0, 1, 0, 0, 0, 0]));
        await closed;
        expect(sslRequested).toBe(false);
      } else {
        socket.write(request);
        client = connect({ socket, host: tunnel.host, ca: local.cert, rejectUnauthorized: true });
        if (scenario === 'match') {
          await once(client, 'secureConnect');
          const reply = once(client, 'data');
          client.write('认证数据');
          expect((await reply)[0].toString()).toBe('回复');
        } else {
          // 同一信任链但证书名称不符。下游不能完成 TLS，也不能向上游交付认证数据。
          await expect(once(client, 'secureConnect')).rejects.toThrow();
        }
        expect(sslRequested).toBe(true);
      }
      expect(received).toBe(scenario === 'match' ? '认证数据' : '');
      expect(tunnel.forwardingStarted).toBe(scenario === 'match');
    } finally {
      client?.destroy(); socket.destroy(); serverTls?.destroy(); serverSocket?.destroy();
      await tunnel.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 9000);
});
