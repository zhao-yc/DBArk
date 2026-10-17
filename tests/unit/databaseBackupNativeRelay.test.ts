import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import type { Server, Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupNativeRelay, databaseBackupNativeRelayNodeNet, type DatabaseBackupNativeRelayTarget } from '../../src/engine/databaseBackupNativeRelay';

/** 有界 RAM 套接字：可独立控制写回调/drain/close，不模拟服务器线程已退出。 */
class RamSocket extends EventEmitter {
  allowHalfOpen = true; writable = true; destroyed = false; writableLength = 0;
  localAddress = '192.0.2.10'; localPort = 45001; remoteAddress = '192.0.2.20'; remotePort = 3306;
  private queued: Buffer[] = [];
  readonly outgoing: Buffer[] = [];
  readonly callbacks: { size: number; callback: (error?: Error | null) => void }[] = [];
  writableResult = true;
  pause = vi.fn(() => this);
  connect = vi.fn((_options: unknown) => this);
  destroy = vi.fn(() => { this.destroyed = true; return this; });
  end = vi.fn(() => this);
  get readableLength() { return this.queued.reduce((sum, buffer) => sum + buffer.length, 0); }
  read = vi.fn((size: number) => {
    if (!this.queued.length) return null;
    const buffer = this.queued[0], output = buffer.subarray(0, size);
    if (output.length === buffer.length) this.queued.shift(); else this.queued[0] = buffer.subarray(output.length);
    return output;
  });
  write = vi.fn((buffer: Buffer, callback: (error?: Error | null) => void) => {
    this.outgoing.push(Buffer.from(buffer)); this.writableLength += buffer.length; this.callbacks.push({ size: buffer.length, callback }); return this.writableResult;
  });
  feed(buffer: Buffer) { this.queued.push(buffer); this.emit('readable'); }
  ack(error?: Error) { const write = this.callbacks.shift(); if (!write) throw Error('RAM没有待完成写入'); this.writableLength -= write.size; write.callback(error); }
}
class RamServer extends EventEmitter {
  listening = false;
  address = vi.fn(() => ({ address: '127.0.0.1', port: 41000, family: 'IPv4' }));
  listen = vi.fn((_options: unknown) => this);
  close = vi.fn((_callback?: (error?: Error) => void) => { this.listening = false; return this; });
}
function packet(version = '8.4.11', threadId = 91): Buffer {
  const encoded = Buffer.from(version, 'ascii'), payload = Buffer.alloc(1 + encoded.length + 1 + 4 + 8 + 1 + 2 + 1 + 2 + 2 + 1 + 10 + 13);
  payload[0] = 10; encoded.copy(payload, 1); payload.writeUInt32LE(threadId, encoded.length + 2);
  const header = Buffer.alloc(4); header.writeUIntLE(payload.length, 0, 3); return Buffer.concat([header, payload]);
}
function fixture(target: DatabaseBackupNativeRelayTarget = { ip: '192.0.2.20', port: 3306, family: 'mysql', version: '8.4.11', serverVersion: '8.4.11' }) {
  const owner = { taskId: 'relay-task', planToken: 'plan', sourceLease: 'lease', connectionRevision: 'r1' }, controller = new AbortController();
  const server = new RamServer(), upstream = new RamSocket(), client = new RamSocket(); client.remoteAddress = '127.0.0.1';
  const port = { server: vi.fn(() => server as unknown as Server), socket: vi.fn(() => upstream as unknown as Socket) };
  let valid = true;
  const hooks = { checkOwner: vi.fn(() => { if (!valid) throw Error('RAM私有原错'); }), register: vi.fn((_relay: DatabaseBackupNativeRelay) => undefined) };
  const relay = new DatabaseBackupNativeRelay(owner, target, hooks, controller.signal, port);
  function listen() { relay.start(owner); server.listening = true; server.emit('listening'); }
  function accept() { server.emit('connection', client); }
  function connect() { upstream.emit('connect'); }
  function open() { listen(); accept(); connect(); }
  function greet() { upstream.feed(packet(target.serverVersion)); }
  return { owner, target, controller, server, upstream, client, port, hooks, relay, listen, accept, connect, open, greet, invalidate: () => { valid = false; } };
}

describe('B01 原生 TCP 中继（纯 RAM）', () => {
  it('隐私出口与显式私有API对照：JSON/inspect不带原字段，在途字节/四元组仍由原owner私有保留', async () => {
    const f = fixture(); const hidden = ['relay-task', 'planToken', 'sourceLease', 'connectionRevision', '192.0.2.20', '192.0.2.10', '45001', 'threadId', 'upstreamTuple', 'RAM_AUTH_SECRET', 'RAM_RAW_ERROR'];
    const check = () => {
      const snapshot = f.relay.snapshot(f.owner);
      expect(Object.keys(f.relay)).toEqual([]); expect(Object.getOwnPropertyNames(f.relay)).toEqual([]);
      expect(JSON.parse(JSON.stringify(f.relay))).toEqual(snapshot);
      for (const output of [JSON.stringify(f.relay), JSON.stringify(snapshot), inspect(f.relay, { depth: 8 }), inspect(f.relay, { depth: 8, customInspect: false }), inspect(f.relay, { depth: 8, customInspect: false, showHidden: true })]) for (const marker of hidden) expect(output).not.toContain(marker);
    };
    check(); f.open(); f.greet(); const facts = await f.relay.handshake; expect(facts).toMatchObject({ threadId: 91, upstream: { localPort: 45001, remoteAddress: '192.0.2.20' } });
    const retained = f.relay.retained(f.owner); expect(retained.upstream).toBe(f.upstream); expect(retained.upstreamTuple).toBe(facts.upstream); expect(retained.clients[0].socket).toBe(f.client); expect(retained.handshake).toBe(f.relay.handshake); expect(retained.upstreamConnected).toBe(f.relay.upstreamConnected);
    f.client.ack(); f.upstream.writableResult = false; const payload = Buffer.from('RAM_AUTH_SECRET'); f.client.feed(payload); expect(f.relay.snapshot(f.owner).upstreamWriteBytes).toBe(payload.length); f.upstream.outgoing.length = 0; f.client.outgoing.length = 0; check();
    f.upstream.emit('error', Object.assign(Error('RAM_RAW_ERROR'), { cause: Error('RAM_AUTH_SECRET') })); expect(await f.relay.failure).toBe('upstream-error'); check(); expect(f.relay.retained(f.owner).upstream).toBe(retained.upstream);
    f.upstream.ack(); expect(f.relay.snapshot(f.owner).upstreamWriteBytes).toBe(payload.length); f.upstream.emit('drain'); expect(f.relay.snapshot(f.owner).upstreamWriteBytes).toBe(0); expect(f.upstream.destroy).not.toHaveBeenCalled();
    expect(() => f.relay.retained({ ...f.owner })).toThrow(); f.relay.requestClose(f.owner, 'all'); let localClosed = false; void retained.upstreamClosed!.then(() => { localClosed = true; }); await Promise.resolve(); expect(localClosed).toBe(false); f.upstream.emit('close'); await retained.upstreamClosed; expect(localClosed).toBe(true); check();
    const g = fixture(); g.listen(); g.accept(); g.relay.cancel(g.owner); g.connect(); await expect(g.relay.handshake).rejects.toThrow(); const lateTuple = g.relay.retained(g.owner).upstreamTuple; expect(lateTuple?.localPort).toBe(45001); g.upstream.emit('close'); expect(g.relay.retained(g.owner).upstreamTuple).toBe(lateTuple); expect(JSON.stringify(g.relay)).not.toContain('45001');
  });
  it('构造适配器和 relay 不分配/监听/连接；先登记稳定原实例与Promise，再仅listen环回随机端口', async () => {
    expect(databaseBackupNativeRelayNodeNet()).toMatchObject({ server: expect.any(Function), socket: expect.any(Function) });
    const f = fixture(); expect(f.port.server).not.toHaveBeenCalled(); expect(f.port.socket).not.toHaveBeenCalled();
    f.hooks.register.mockImplementation(relay => { expect(relay).toBe(f.relay); expect(relay.listening).toBe(f.relay.listening); expect(relay.upstreamConnected).toBe(f.relay.upstreamConnected); expect(f.server.listen).not.toHaveBeenCalled(); expect(f.upstream.connect).not.toHaveBeenCalled(); });
    f.listen(); expect(f.server.listen).toHaveBeenCalledWith({ host: '127.0.0.1', port: 0, exclusive: true, backlog: 1 }); expect(await f.relay.listening).toEqual({ host: '127.0.0.1', port: 41000 }); expect(f.upstream.connect).not.toHaveBeenCalled(); f.relay.cancel(f.owner);
  });
  it('首客户端只连固定IP，禁止DNS；四元组与原Socket/threadId属于同一次连接', async () => {
    const f = fixture(); f.open(); const options = f.upstream.connect.mock.calls[0][0] as { host: string; port: number; family: number; autoSelectFamily: boolean; lookup: (...args: unknown[]) => void };
    expect(options).toMatchObject({ host: '192.0.2.20', port: 3306, family: 4, autoSelectFamily: false }); const lookup = vi.fn(); options.lookup('bad.example', {}, lookup); expect(lookup).toHaveBeenCalledWith(expect.any(Error), '', 0);
    f.greet(); expect(await f.relay.handshake).toMatchObject({ protocolVersion: 10, serverVersion: '8.4.11', threadId: 91, upstream: { localAddress: '192.0.2.10', localPort: 45001, remoteAddress: '192.0.2.20', remotePort: 3306 } });
    expect(f.relay.retained(f.owner).upstream).toBe(f.upstream); expect(f.server.close).toHaveBeenCalledTimes(1); f.client.ack(); f.relay.cancel(f.owner);
  });
  it('逐字节分片握手与同chunk尾部完整保留；写callback/drain后才清握手副本，再转发尾部', async () => {
    const f = fixture(); f.open(); f.client.writableResult = false; const greeting = packet(), tail = Buffer.from([0, 255, 1, 10]);
    for (const byte of greeting.subarray(0, greeting.length - 2)) f.upstream.feed(Buffer.from([byte])); f.upstream.feed(Buffer.concat([greeting.subarray(-2), tail]));
    await f.relay.handshake; expect(f.client.outgoing).toEqual([greeting]); expect(f.relay.snapshot(f.owner)).toMatchObject({ handshakeWritten: false, handshakeRetainedBytes: greeting.length, tailBytes: tail.length });
    f.client.ack(); expect(f.client.outgoing).toHaveLength(1); expect(f.relay.snapshot(f.owner).handshakeWritten).toBe(false);
    f.client.emit('drain'); expect(f.relay.snapshot(f.owner)).toMatchObject({ handshakeWritten: true, handshakeRetainedBytes: 0, tailBytes: 0 }); expect(f.client.outgoing[1]).toEqual(tail); f.client.ack(); f.client.emit('drain'); f.relay.cancel(f.owner);
  });
  it('双向字节不解释/改写；callback与drain缺一均不读下一块，各方向最多16KiB一笔', async () => {
    const f = fixture(); f.open(); f.greet(); await f.relay.handshake;
    const clientBytes = Buffer.from([0, 128, 39, 92, 10, 255]); f.client.feed(clientBytes); expect(f.upstream.outgoing).toHaveLength(0); f.client.ack(); expect(f.upstream.outgoing[0]).toEqual(clientBytes); f.upstream.ack();
    f.client.writableResult = false; const bytes = Buffer.alloc(40 * 1024, 0xa5); f.upstream.feed(bytes);
    expect(f.client.outgoing.at(-1)).toHaveLength(16 * 1024); expect(f.upstream.readableLength).toBe(24 * 1024); f.client.emit('drain'); expect(f.upstream.readableLength).toBe(24 * 1024); f.client.ack();
    expect(f.upstream.readableLength).toBe(8 * 1024); f.client.ack(); expect(f.upstream.readableLength).toBe(8 * 1024); f.client.emit('drain'); expect(f.upstream.readableLength).toBe(0); f.client.ack(); f.client.emit('drain');
    expect(Buffer.concat(f.client.outgoing.slice(1))).toEqual(bytes); expect(f.upstream.read.mock.calls.every(([amount]) => amount <= 16384)).toBe(true); f.relay.cancel(f.owner);
  });
  it.each(['end', 'error', 'close'] as const)('CLI %s 不自动end/destroy上游，原四元组/Socket和本地close事件分别保留', async event => {
    const f = fixture(); f.open(); f.greet(); await f.relay.handshake; f.client.ack(); f.client.emit(event, Error('合成原错误不输出'));
    expect(f.upstream.end).not.toHaveBeenCalled(); expect(f.upstream.destroy).not.toHaveBeenCalled(); expect(f.relay.retained(f.owner).upstream?.localPort).toBe(45001); expect(f.relay.snapshot(f.owner).upstream?.localCloseSeen).toBe(false);
    f.relay.requestClose(f.owner, 'upstream'); expect(f.upstream.destroy).toHaveBeenCalledTimes(1); let closed = false; void f.relay.retained(f.owner).upstreamClosed!.then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false); f.upstream.emit('close'); await f.relay.retained(f.owner).upstreamClosed; expect(f.relay.snapshot(f.owner).upstream?.localCloseSeen).toBe(true); expect('serverClosed' in f.relay.snapshot(f.owner)).toBe(false);
  });
  it('封存accept不关闭原Socket；第二客户端与迟到accept留在原owner，不能再连上游', async () => {
    const f = fixture(); f.open(); const extra = new RamSocket(); extra.remoteAddress = '127.0.0.1'; f.server.emit('connection', extra);
    expect(await f.relay.failure).toBe('second-client'); expect(f.relay.retained(f.owner).clients.map(value => value.socket)).toEqual([f.client, extra]); expect(f.upstream.connect).toHaveBeenCalledTimes(1); expect(extra.destroy).not.toHaveBeenCalled(); expect(f.upstream.destroy).not.toHaveBeenCalled();
    f.relay.requestClose(f.owner, 'all'); expect(extra.destroy).toHaveBeenCalledTimes(1); expect(f.client.destroy).toHaveBeenCalledTimes(1); expect(f.upstream.destroy).toHaveBeenCalledTimes(1); expect(f.relay.snapshot(f.owner).listenerLocalCloseSeen).toBe(false); f.server.emit('close'); await f.relay.listenerClosed;
  });
  it('取消/租约失效永久停新转发，晚到connect仍记录原四元组但不恢复/重连', async () => {
    const f = fixture(); f.listen(); f.accept(); f.controller.abort(); await expect(f.relay.handshake).rejects.toThrow('Root'); f.connect(); f.upstream.feed(packet());
    expect(f.relay.retained(f.owner).upstream?.localPort).toBe(45001); expect(f.client.outgoing).toHaveLength(0); expect(f.upstream.connect).toHaveBeenCalledTimes(1); expect(f.upstream.destroy).not.toHaveBeenCalled(); expect(() => f.relay.start(f.owner)).toThrow();
    const g = fixture(); g.open(); g.greet(); await g.relay.handshake; g.invalidate(); g.client.ack(); g.client.feed(Buffer.from('不会发送')); expect(await g.relay.failure).toBe('owner-invalid'); expect(g.upstream.outgoing).toHaveLength(0); g.relay.requestClose(g.owner, 'all');
  });
  it('握手写入期间取消保留副本，迟到成功callback只记原写完成，不恢复尾部或新SQL字节', async () => {
    const f = fixture(); f.open(); const greeting = packet(); f.upstream.feed(Buffer.concat([greeting, Buffer.from('RAM尾部')])); await f.relay.handshake;
    f.relay.cancel(f.owner); expect(f.relay.snapshot(f.owner).handshakeRetainedBytes).toBe(greeting.length); f.client.ack(); expect(f.relay.snapshot(f.owner).handshakeRetainedBytes).toBe(0); expect(f.client.outgoing).toHaveLength(1); expect(f.upstream.destroy).not.toHaveBeenCalled();
  });
  it.each(['sequence', 'protocol', 'oversize', 'no-nul', 'zero-id', 'version', 'truncated'] as const)('握手异常 %s 阻断且保留原句柄，不转发认证/行、不自动关闭上游', async kind => {
    const f = fixture(); f.open(); let greeting = packet(); if (kind === 'sequence') greeting[3] = 1; if (kind === 'protocol') greeting[4] = 9; if (kind === 'oversize') greeting.writeUIntLE(4096, 0, 3); if (kind === 'no-nul') greeting.fill(65, 5); if (kind === 'zero-id') greeting = packet('8.4.11', 0); if (kind === 'version') greeting = packet('8.4.12'); if (kind === 'truncated') greeting = greeting.subarray(0, 12);
    f.upstream.feed(greeting); if (kind === 'truncated') f.upstream.emit('end'); await expect(f.relay.handshake).rejects.toThrow('Root'); expect(f.client.outgoing).toHaveLength(0); expect(f.upstream.destroy).not.toHaveBeenCalled(); expect(f.relay.snapshot(f.owner).failureReason).toBe(kind === 'version' ? 'version-mismatch' : 'packet-invalid');
  });
  it('显式超时、原socket超时、写错误都失败；停止不是close，原错误不进入snapshot', async () => {
    for (const kind of ['explicit', 'socket', 'write']) {
      const f = fixture(); f.open(); if (kind === 'explicit') f.relay.timeout(f.owner); if (kind === 'socket') f.upstream.emit('timeout'); if (kind === 'write') { f.greet(); await f.relay.handshake; f.client.ack(Error('RAM秘密错误')); }
      expect(await f.relay.failure).toBe(kind === 'write' ? 'write-failed' : 'timeout'); expect(JSON.stringify(f.relay.snapshot(f.owner))).not.toContain('秘密'); expect(f.upstream.destroy).not.toHaveBeenCalled(); expect(f.client.destroy).not.toHaveBeenCalled();
    }
  });
  it('只接受原owner清理，目标入参副本不可换绑；错误上游四元组不形成握手事实', async () => {
    const f = fixture(); (f.target as { ip: string }).ip = '192.0.2.99'; f.open(); expect(f.upstream.connect.mock.calls[0][0]).toMatchObject({ host: '192.0.2.20' }); expect(() => f.relay.cancel({ ...f.owner })).toThrow(); expect(() => f.relay.requestClose({ ...f.owner }, 'all')).toThrow(); f.relay.cancel(f.owner);
    const g = fixture(); g.listen(); g.accept(); g.upstream.remotePort = 3307; g.connect(); await expect(g.relay.upstreamConnected).rejects.toThrow(); expect(await g.relay.failure).toBe('connect-failed'); expect(g.client.outgoing).toHaveLength(0);
  });
  it('取消早于listening时，迟到监听只请求封存，原客户端不会触发新connect', async () => {
    const f = fixture(); f.relay.start(f.owner); f.relay.cancel(f.owner); f.server.listening = true; f.server.emit('listening'); f.server.emit('connection', f.client);
    await expect(f.relay.listening).rejects.toThrow(); expect(f.server.close).toHaveBeenCalledTimes(1); expect(f.upstream.connect).not.toHaveBeenCalled(); expect(f.relay.retained(f.owner).clients[0].socket).toBe(f.client); f.relay.requestClose(f.owner, 'all');
  });
  it('只解析准确MariaDB握手文本；旧版/未知IP/DNS/不匹配family在构造时拒绝', async () => {
    const f = fixture({ ip: '192.0.2.20', port: 3306, family: 'mariadb', version: '11.4.13', serverVersion: '11.4.13-MariaDB-deb12' }); f.open(); f.greet(); expect((await f.relay.handshake).threadId).toBe(91); f.client.ack(); f.relay.cancel(f.owner);
    for (const change of [{ ip: 'example.test' }, { serverVersion: '8.4.12' }, { version: '11.4.13' }, { port: 0 }]) expect(() => fixture({ ip: '192.0.2.20', port: 3306, family: 'mysql', version: '8.4.11', serverVersion: '8.4.11', ...change } as DatabaseBackupNativeRelayTarget)).toThrow();
  });
  it('在启动前或登记回调里封存入口不会listen/connect，也不关闭原Socket', async () => {
    const f = fixture(); f.relay.seal(f.owner); expect(() => f.relay.start(f.owner)).toThrow(); expect(f.port.server).not.toHaveBeenCalled(); await expect(f.relay.listening).rejects.toThrow();
    const g = fixture(); g.hooks.register.mockImplementation(relay => { relay.seal(g.owner); }); g.relay.start(g.owner); expect(g.server.listen).not.toHaveBeenCalled(); expect(g.upstream.connect).not.toHaveBeenCalled(); expect(g.upstream.destroy).not.toHaveBeenCalled(); await expect(g.relay.listening).rejects.toThrow();
  });
  it('握手4096字节边界可原样写出；已有目的队列会计入上限并拒绝越界新写入', async () => {
    const f = fixture(); f.open(); const greeting = Buffer.alloc(4096); packet().copy(greeting); greeting.writeUIntLE(4092, 0, 3); f.upstream.feed(greeting); await f.relay.handshake; expect(f.client.outgoing[0]).toEqual(greeting); f.client.ack(); f.relay.cancel(f.owner);
    const g = fixture(); g.open(); g.client.writableLength = 16384; g.greet(); expect(await g.relay.failure).toBe('buffer-limit'); expect(g.client.outgoing).toHaveLength(0); expect(g.upstream.destroy).not.toHaveBeenCalled();
  });
  it('原Socket流方法同步失败仍已登记原句柄与closed Promise，不做替换或自动销毁', async () => {
    const f = fixture(); f.upstream.pause.mockImplementation(() => { throw Error('仅RAM流异常'); }); f.relay.start(f.owner); expect(await f.relay.failure).toBe('upstream-error'); expect(f.relay.retained(f.owner).upstream).toBe(f.upstream); expect(f.server.listen).not.toHaveBeenCalled(); expect(f.upstream.destroy).not.toHaveBeenCalled();
    f.relay.requestClose(f.owner, 'upstream'); let closed = false; void f.relay.retained(f.owner).upstreamClosed!.then(() => { closed = true; }); await Promise.resolve(); expect(closed).toBe(false); f.upstream.emit('close'); await f.relay.retained(f.owner).upstreamClosed; expect(closed).toBe(true);
  });
});
