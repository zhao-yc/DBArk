import { Duplex } from 'node:stream';
import { createRequire } from 'node:module';
import mysql from 'mysql2';
import { describe, expect, it } from 'vitest';
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
