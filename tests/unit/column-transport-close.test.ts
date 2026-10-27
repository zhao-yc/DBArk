import { Duplex } from 'node:stream';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { connect as connectTls, createServer as createTlsServer, type TLSSocket } from 'node:tls';
import type { Socket } from 'node:net';
import { createRequire } from 'node:module';
import mysql from 'mysql2';
import { describe, expect, it, vi } from 'vitest';
import { closeMysqlConnection, type ManagedConnection } from '../../src/engine/connection';
import { columnTaskQuery } from '../../src/engine/tableColumnPatchTasks';

/** 真实 mysql2 搭配内存 Duplex，不联网、不替换驱动的 end/destroy 行为。 */
function transport() {
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  const connection = mysql.createConnection({ stream, connectTimeout: 0 });
  connection.on('error', () => undefined);
  return { stream, connection };
}

describe('结构任务真实 mysql2 本地关闭边界', () => {
  it('真实mysql2 QUIT先写出且排空，再关闭真实ssh2半开channel；不把EOF当CLOSE', async () => {
    // 仅内存连接两个真实驱动；SSH协议对端只转发数据和确认CLOSE，不联网、不伪造mysql2 end回调。
    const require = createRequire(import.meta.url);
    const { Channel } = require('ssh2/lib/Channel.js');
    const { onCHANNEL_CLOSE } = require('ssh2/lib/utils.js');
    const events: string[] = [];
    let channel: Duplex & { incoming: { state: string }; outgoing: { state: string }; close(): void };
    const serverStream = new Duplex({ read() {}, write(chunk, _encoding, callback) { channel.push(chunk); callback(); } });
    const client = { _chanMgr: { remove() {} }, _protocol: {
      channelData(_id: number, data: Buffer) { if (data.length === 5 && data[4] === 1) events.push('QUIT写入'); serverStream.push(data); },
      channelEOF() { events.push('写入排空EOF'); },
      channelClose() { events.push('请求CLOSE'); setImmediate(() => onCHANNEL_CLOSE(client, 0, channel)); },
    } };
    const state = () => ({ id: 0, window: 2097152, packetSize: 32768, state: 'open' });
    channel = new Channel(client, { type: 'direct-tcpip', incoming: state(), outgoing: state() });
    channel.on('close', () => events.push('真实channel关闭'));
    const server = mysql.createConnection({ stream: serverStream, isServer: true, connectTimeout: 0 }); server.on('error', () => undefined);
    server.on('quit', () => { events.push('服务器读到QUIT'); channel.incoming.state = 'eof'; channel.push(null); });
    server.serverHandshake({ protocolVersion: 10, serverVersion: '8.4.11', connectionId: 99, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088200, authCallback(_params: unknown, done: () => void) {
      done();
      // mysql2测试服务器结束认证后进入新命令序号0，避免将QUIT误判为握手后续包。
      (server as unknown as { _resetSequenceId(): void })._resetSequenceId();
    } });
    const connection = mysql.createConnection({ stream: channel, connectTimeout: 0 }); connection.on('error', () => undefined);
    try {
      await new Promise<void>((resolve, reject) => connection.connect(error => error ? reject(error) : resolve()));
      await closeMysqlConnection(connection, true, false, 100);
      expect(events).toEqual(['QUIT写入', '服务器读到QUIT', '写入排空EOF', '请求CLOSE', '真实channel关闭']);
      expect(channel.incoming.state).toBe('closed'); expect(channel.outgoing.state).toBe('closed');
      // ssh2的Node closed仍false，重复已破损清理必须认可真正的双向协议关闭而非再等一次事件。
      expect(channel.closed).toBe(false); await closeMysqlConnection(connection, true, true, 100);
    } finally { serverStream.destroy(); connection.destroy(); }
  });
  it('主动 destroy 只发底层 close 时也结束命令，但明确保持服务器结果未知', async () => {
    const { stream, connection } = transport(), controller = new AbortController(), events: string[] = [];
    connection.on('end', () => events.push('end')); stream.on('close', () => events.push('close'));
    controller.signal.addEventListener('abort', () => { connection.destroy(); stream.destroy(); });
    let terminal = false;
    const managed = { connection, broken: false, signal: controller.signal } as ManagedConnection;
    const result = columnTaskQuery({ managed, checkCancelled() {}, report() {}, commandStarted: () => () => { terminal = true; } }, 'ALTER TABLE `t` COMMENT=\'未实际联网\'');
    const failure = expect(result).rejects.toThrow('不能据此确认服务器'); controller.abort(); await failure;
    await new Promise(setImmediate);
    expect(events).toEqual(['close']); expect(terminal).toBe(true); expect(stream.destroyed).toBe(true);
  });

  it('严格关闭观察真实驱动队列未完成的超时，并销毁底层流而不是假成功', async () => {
    const { stream, connection } = transport();
    // 无握手的真实驱动保留命令队列，QUIT 不会完成；这不是服务器 ACK 模拟。
    await expect(closeMysqlConnection(connection, true, false, 20)).rejects.toThrow('关闭超时');
    await new Promise(setImmediate); expect(stream.destroyed).toBe(true); expect(stream.closed).toBe(true);
  });

  it('底层先close且真实驱动随后报告end错误时不能误记严格关闭成功', async () => {
    const { stream, connection } = transport();
    const result = closeMysqlConnection(connection, true, false, 100);
    const failure = expect(result).rejects.toThrow('正常退出失败');
    stream.destroy(); await failure;
    expect(stream.closed).toBe(true);
  });

  it('已关闭连接的真实 end 回调错误可观测，旧宽松结果仍兼容', async () => {
    const strict = transport(); strict.connection.destroy();
    await expect(closeMysqlConnection(strict.connection, true, false, 50)).rejects.toThrow('正常退出失败');
    const legacy = transport(); legacy.connection.destroy();
    await expect(closeMysqlConnection(legacy.connection, false, false, 50)).resolves.toBeUndefined();
    expect(strict.stream.destroyed).toBe(true); expect(legacy.stream.destroyed).toBe(true);
  });

  it('真实 KILL 后已断开语义只等待本地资源，不再发送无效 QUIT 或伪造服务器 ACK', async () => {
    const { stream, connection } = transport();
    await expect(closeMysqlConnection(connection, true, true, 50)).resolves.toBeUndefined();
    expect(stream.destroyed).toBe(true); expect(stream.closed).toBe(true);
  });
});

/** 仅用于关闭顺序的受控TLS端口；destroySoon发出请求不代表实际close，原Promise必须继续等待。 */
function controlledTlsClose(initiallyClosed = false) {
  const events: string[] = [];
  let completeFlush: ((error?: Error) => void) | undefined;
  const stream = Object.assign(new EventEmitter(), {
    encrypted: true, closed: initiallyClosed, destroyed: false, writableEnded: initiallyClosed, writableFinished: initiallyClosed,
    end: vi.fn((callback: (error?: Error) => void) => { events.push('TLS结束请求'); stream.writableEnded = true; completeFlush = callback; }),
    destroy: vi.fn(() => { events.push('TLS销毁请求'); }),
    destroySoon: vi.fn(() => { events.push('TLS排空后关闭请求'); }),
  });
  const native = {
    stream,
    end: vi.fn((callback: (error?: Error) => void) => { events.push('QUIT原回调'); callback(); events.push('QUIT实际写入'); }),
    destroy: vi.fn(() => { events.push('驱动销毁请求'); }),
  };
  return {
    events, stream, native,
    connection: native as unknown as Parameters<typeof closeMysqlConnection>[0],
    flush(error?: Error) { if (!completeFlush) throw Error('尚未调用TLS结束端口'); events.push(error ? 'TLS排空失败' : 'TLS排空确认'); if (!error) stream.writableFinished = true; completeFlush(error); },
    close(hadError = false) { stream.closed = true; stream.destroyed = true; events.push('TLS真实关闭'); stream.emit('close', hadError); },
  };
}

describe('TLS排空之后仍需真实物理关闭', () => {
  it('真实TLS半开对端读到真实mysql2 QUIT后不end，客户端仍须完成物理关闭', async () => {
    // 临时随机PSK只保留RAM；此用例验证真实加密流，不涉及证书认证或正式连接TLS策略。
    const psk = randomBytes(32), identity = 'dbark-close-unit';
    const rawSockets = new Set<Socket>(); let peer: TLSSocket | undefined, serverConnection: ReturnType<typeof mysql.createConnection> | undefined;
    let quit!: () => void, quitSeen = false;
    const quitRead = new Promise<void>(resolve => { quit = resolve; });
    const server = createTlsServer({
      minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', ciphers: 'PSK-AES128-GCM-SHA256', allowHalfOpen: true,
      pskCallback: (_socket, receivedIdentity) => receivedIdentity === identity ? psk : null,
    }, secure => {
      peer = secure; secure.on('error', () => undefined);
      serverConnection = mysql.createConnection({ stream: secure, isServer: true, connectTimeout: 0 }); serverConnection.on('error', () => undefined);
      serverConnection.on('quit', () => { quitSeen = true; quit(); });
      serverConnection.serverHandshake({ protocolVersion: 10, serverVersion: '8.4.11', connectionId: 991, statusFlags: 2, characterSet: 45, capabilityFlags: 0x00088200, authCallback(_params: unknown, done: () => void) {
        done(); (serverConnection as unknown as { _resetSequenceId(): void })._resetSequenceId();
      } });
    });
    server.on('connection', raw => { rawSockets.add(raw); raw.once('close', () => rawSockets.delete(raw)); });
    // 失败仍由原connect回调或服务器阶段Promise报告，监听仅避免有意清理造成全局无人error。
    server.on('tlsClientError', () => undefined);
    let client: TLSSocket | undefined, connection: ReturnType<typeof mysql.createConnection> | undefined, quitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
      const address = server.address(); if (!address || typeof address === 'string') throw Error('TLS用例未取得本例临时端口');
      client = connectTls({ host: '127.0.0.1', port: address.port, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2', ciphers: 'PSK-AES128-GCM-SHA256', rejectUnauthorized: false, pskCallback: () => ({ identity, psk }) });
      await new Promise<void>((resolve, reject) => { client!.once('error', reject); client!.once('secureConnect', () => { client!.removeListener('error', reject); resolve(); }); });
      client.on('error', () => undefined);
      expect(client.getProtocol()).toBe('TLSv1.2'); expect(client.getCipher().name).toBe('PSK-AES128-GCM-SHA256'); expect(client.encrypted).toBe(true);
      connection = mysql.createConnection({ stream: client, connectTimeout: 0 }); connection.on('error', () => undefined);
      await new Promise<void>((resolve, reject) => connection!.connect(error => error ? reject(error) : resolve()));
      const pending = closeMysqlConnection(connection, true, false, 1000); void pending.catch(() => undefined);
      // 对端收到QUIT必须是真实协议事件；定时器仅失败定位，finally仍逐一等待原socket关闭。
      await new Promise<void>((resolve, reject) => { quitTimer = setTimeout(() => reject(Error('本例TLS对端未读到QUIT')), 1000); void quitRead.then(() => { clearTimeout(quitTimer); resolve(); }); });
      expect(quitSeen).toBe(true); expect(peer?.writableEnded).toBe(false);
      await expect(pending).resolves.toBeUndefined();
      expect(client.closed).toBe(true); expect(client.destroyed).toBe(true);
    } finally {
      if (quitTimer) clearTimeout(quitTimer);
      const sockets = [...new Set([client, peer, ...rawSockets].filter((socket): socket is Socket => socket !== undefined))];
      const closed = sockets.map(socket => socket.closed ? Promise.resolve() : new Promise<void>(resolve => socket.once('close', () => resolve())));
      connection?.destroy(); serverConnection?.destroy(); sockets.forEach(socket => socket.destroy());
      await Promise.all(closed);
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      psk.fill(0);
    }
  }, 10000);

  it('QUIT写入microtask围栏及TLS排空之前不请求destroySoon，真实close之前不返回', async () => {
    const f = controlledTlsClose(), pending = closeMysqlConnection(f.connection, true, false, 1000); let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      expect(f.events).toEqual(['QUIT原回调', 'QUIT实际写入']); expect(f.stream.destroySoon).not.toHaveBeenCalled();
      await Promise.resolve(); expect(f.events).toEqual(['QUIT原回调', 'QUIT实际写入', 'TLS结束请求']);
      expect(f.stream.destroySoon).not.toHaveBeenCalled(); f.flush(); await Promise.resolve();
      expect(f.stream.destroySoon).toHaveBeenCalledOnce(); expect(settled).toBe(false);
      expect(f.native.destroy).not.toHaveBeenCalled(); f.close(); await pending;
      expect(f.events).toEqual(['QUIT原回调', 'QUIT实际写入', 'TLS结束请求', 'TLS排空确认', 'TLS排空后关闭请求', 'TLS真实关闭']);
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('TLS排空失败即使随后close仍拒绝，不能调用成功destroySoon分支', async () => {
    const f = controlledTlsClose(), pending = closeMysqlConnection(f.connection, true, false, 1000); void pending.catch(() => undefined);
    try {
      await Promise.resolve(); f.flush(Error('合成TLS排空失败')); expect(f.stream.destroySoon).not.toHaveBeenCalled();
      f.close(); await expect(pending).rejects.toThrow('退出传输写入或关闭失败');
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('已有finish/close不能越过原QUIT同步写入与本次TLS结束回调提前成功', async () => {
    const f = controlledTlsClose(true), pending = closeMysqlConnection(f.connection, true, false, 1000); let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    try {
      expect(f.events).toEqual(['QUIT原回调', 'QUIT实际写入']);
      await Promise.resolve(); expect(f.stream.end).toHaveBeenCalledOnce(); expect(settled).toBe(false);
      expect(f.stream.destroySoon).not.toHaveBeenCalled(); f.flush(); await pending;
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('正常TLS排空后close带hadError仍拒绝，不能把物理关闭当成无错误退出', async () => {
    const f = controlledTlsClose(), pending = closeMysqlConnection(f.connection, true, false, 1000); void pending.catch(() => undefined);
    try {
      await Promise.resolve(); f.flush(); expect(f.stream.destroySoon).toHaveBeenCalledOnce();
      f.close(true); await expect(pending).rejects.toThrow('TLS连接关闭出现传输错误');
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('destroySoon同步close再throw仍保留原关闭异常，不被先兑现的close遮蔽', async () => {
    const f = controlledTlsClose(), original = Error('合成同步关闭失败');
    f.stream.destroySoon.mockImplementation(() => { f.close(); throw original; });
    const pending = closeMysqlConnection(f.connection, true, false, 1000); void pending.catch(() => undefined);
    try {
      await Promise.resolve(); f.flush();
      await expect(pending).rejects.toThrow('退出传输写入或关闭失败');
      await expect(pending).rejects.toHaveProperty('cause', original);
      expect(f.stream.destroySoon).toHaveBeenCalledOnce();
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('TLS未排空超时后迟到flush不得再次destroySoon或销毁原连接', async () => {
    const f = controlledTlsClose(), pending = closeMysqlConnection(f.connection, true, false, 20); void pending.catch(() => undefined);
    try {
      await expect(pending).rejects.toThrow('关闭超时');
      expect(f.stream.end).toHaveBeenCalledOnce(); expect(f.native.destroy).toHaveBeenCalledOnce(); expect(f.stream.destroy).toHaveBeenCalledOnce();
      f.flush(); await Promise.resolve();
      expect(f.stream.destroySoon).not.toHaveBeenCalled(); expect(f.native.destroy).toHaveBeenCalledOnce(); expect(f.stream.destroy).toHaveBeenCalledOnce(); expect(f.stream.end).toHaveBeenCalledOnce();
    } finally { f.close(); await pending.catch(() => undefined); }
  });

  it('原QUIT回调未到即超时，迟到QUIT错误不能再结束TLS或追加销毁', async () => {
    const f = controlledTlsClose(); let quitCallback: ((error?: Error) => void) | undefined;
    f.native.end.mockImplementation(callback => { quitCallback = callback; f.events.push('QUIT原回调延迟'); });
    const pending = closeMysqlConnection(f.connection, true, false, 20); void pending.catch(() => undefined);
    try {
      await expect(pending).rejects.toThrow('关闭超时'); expect(quitCallback).toBeTypeOf('function');
      expect(f.stream.end).not.toHaveBeenCalled(); expect(f.native.destroy).toHaveBeenCalledOnce(); expect(f.stream.destroy).toHaveBeenCalledOnce();
      quitCallback!(Error('超时后原QUIT迟到错误')); await Promise.resolve();
      expect(f.stream.end).not.toHaveBeenCalled(); expect(f.stream.destroySoon).not.toHaveBeenCalled(); expect(f.native.destroy).toHaveBeenCalledOnce(); expect(f.stream.destroy).toHaveBeenCalledOnce();
    } finally { f.close(); await pending.catch(() => undefined); }
  });
});
