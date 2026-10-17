import { createServer, isIP, Socket, type Server } from 'node:net';

export interface DatabaseBackupNativeRelayOwner {
  readonly taskId: string; readonly planToken: string; readonly sourceLease: string; readonly connectionRevision: string;
}
export interface DatabaseBackupNativeRelayTarget {
  readonly ip: string; readonly port: number; readonly family: 'mysql' | 'mariadb'; readonly version: '8.4.11' | '11.4.13';
  /** Root 已通过私有源会话验证的准确 VERSION 文本，不从 renderer 接受。 */
  readonly serverVersion: string;
}
export interface DatabaseBackupNativeRelayTuple {
  readonly localAddress: string; readonly localPort: number; readonly remoteAddress: string; readonly remotePort: number;
}
export interface DatabaseBackupNativeRelayGreeting {
  readonly protocolVersion: 10; readonly serverVersion: string; readonly threadId: number;
  readonly family: 'mysql' | 'mariadb'; readonly version: '8.4.11' | '11.4.13'; readonly upstream: DatabaseBackupNativeRelayTuple;
}
export type DatabaseBackupNativeRelayReason = 'cancelled' | 'timeout' | 'owner-invalid' | 'registration-failed' | 'listen-failed' | 'connect-failed' | 'second-client' | 'client-error' | 'upstream-error' | 'client-close' | 'upstream-close' | 'packet-invalid' | 'version-mismatch' | 'buffer-limit' | 'write-failed' | 'explicit-close';
type Boundary = DatabaseBackupNativeRelayReason | 'client-eof' | 'upstream-eof';
type Role = 'client' | 'upstream';
/** 此端口返回实际 Node Server/Socket 类型；替身仅用于 RAM 测试，不能提供自报 close 证明。 */
export interface DatabaseBackupNativeRelayNet {
  server(): Server;
  socket(): Socket;
}
/** 导入/构造适配器都不 listen/connect；只有 Root 显式 start 后调用原生方法。 */
export function databaseBackupNativeRelayNodeNet(): DatabaseBackupNativeRelayNet {
  return {
    server: () => createServer({ allowHalfOpen: true, pauseOnConnect: true, highWaterMark: 16 * 1024 }),
    socket: () => {
      // Socket 继承 Duplex 并传递其水位选项；先保存对象，兼容当前 net 类型未列出继承字段。
      const options = { allowHalfOpen: true, readableHighWaterMark: 16 * 1024, writableHighWaterMark: 16 * 1024 };
      return new Socket(options);
    },
  };
}
export interface DatabaseBackupNativeRelayHooks {
  checkOwner(owner: Readonly<DatabaseBackupNativeRelayOwner>): void;
  /** 首次 listen/connect 前同步登记同一实例，含稳定 Promise 与后续原生句柄 getter。 */
  register(relay: DatabaseBackupNativeRelay): void;
}
function failure(): Error { return new Error('备份私有中继未能维持已登记来源与本地流状态；后端线程终态须由 Root 单独核对'); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
function ip(value: string): string {
  if (typeof value !== 'string' || value.length > 45 || !isIP(value) || value.includes('%')) throw failure();
  return isIP(value) === 4 ? value : new URL(`http://[${value}]/`).hostname.slice(1, -1);
}
interface SocketRecord {
  readonly socket: Socket; readonly role: Role | 'extra-client'; readonly closed: ReturnType<typeof deferred<void>>;
  connected: boolean; ended: boolean; errored: boolean; closeSeen: boolean; closeRequested: boolean;
}
interface WriteRecord { readonly bytes: Buffer; returned: boolean; callbackDone: boolean; drained: boolean; needsDrain: boolean; readonly after?: () => void; }

/** 单 owner/单次上游的 TCP 中继；所有 EOF/失败仅封存转发，原 Socket 只能由 Root 显式请求关闭。 */
export class DatabaseBackupNativeRelay {
  private readonly binding: Readonly<DatabaseBackupNativeRelayOwner>;
  private readonly target: Readonly<DatabaseBackupNativeRelayTarget>;
  private readonly hooks: DatabaseBackupNativeRelayHooks;
  private readonly port: DatabaseBackupNativeRelayNet;
  private readonly ready = deferred<{ host: '127.0.0.1'; port: number }>();
  private readonly connected = deferred<DatabaseBackupNativeRelayTuple>();
  private readonly greeting = deferred<DatabaseBackupNativeRelayGreeting>();
  private readonly stopped = deferred<Boundary>();
  private readonly failed = deferred<DatabaseBackupNativeRelayReason>();
  private readonly serverEnd = deferred<void>();
  readonly listening = this.ready.promise;
  readonly upstreamConnected = this.connected.promise;
  readonly handshake = this.greeting.promise;
  readonly flowStopped = this.stopped.promise;
  readonly failure = this.failed.promise;
  readonly listenerClosed = this.serverEnd.promise;
  private server: Server | null = null;
  private upstream: SocketRecord | null = null;
  private client: SocketRecord | null = null;
  private readonly clients: SocketRecord[] = [];
  private started = false;
  private acceptingSealed = false;
  private listenAttempted = false;
  private connectAttempted = false;
  private serverCloseRequested = false;
  private serverCloseSeen = false;
  private reason: Boundary | null = null;
  private failureReason: DatabaseBackupNativeRelayReason | null = null;
  private tuple: Readonly<DatabaseBackupNativeRelayTuple> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly writes: Record<Role, WriteRecord | null> = { client: null, upstream: null };
  private handshakeBuffer: Buffer | null = null;
  private handshakeBytes = 0;
  private handshakeLength: number | null = null;
  private handshakeParsed = false;
  private handshakeWritten = false;
  private tail: Buffer | null = null;

  constructor(private readonly owner: DatabaseBackupNativeRelayOwner, target: DatabaseBackupNativeRelayTarget, hooks: DatabaseBackupNativeRelayHooks, private readonly signal?: AbortSignal, port: DatabaseBackupNativeRelayNet = databaseBackupNativeRelayNodeNet()) {
    this.binding = Object.freeze({ ...owner }); this.target = Object.freeze({ ...target });
    this.hooks = Object.freeze({ checkOwner: hooks.checkOwner.bind(hooks), register: hooks.register.bind(hooks) });
    this.port = Object.freeze({ server: port.server.bind(port), socket: port.socket.bind(port) });
    if (Object.keys(this.binding).length !== 4 || ['taskId', 'planToken', 'sourceLease', 'connectionRevision'].some(key => { const value = this.binding[key as keyof DatabaseBackupNativeRelayOwner]; return typeof value !== 'string' || !value || value.length > 200 || /[\x00-\x1f]/.test(value); })) throw failure();
    if (!Number.isSafeInteger(this.target.port) || this.target.port < 1 || this.target.port > 65535 || ip(this.target.ip) !== this.target.ip) throw failure();
    if (!(this.target.family === 'mysql' && this.target.version === '8.4.11' && /^8\.4\.11(?:-commercial)?$/.test(this.target.serverVersion) || this.target.family === 'mariadb' && this.target.version === '11.4.13' && /^(?:5\.5\.5-)?11\.4\.13-MariaDB(?:-[\x20-\x7e]+)?$/.test(this.target.serverVersion)) || this.target.serverVersion.length > 128) throw failure();
  }
  /** 清理只允许原登记 owner，租约撤销后仍可关闭自己的旧句柄；不能以同值新对象冒充。 */
  private own(owner: DatabaseBackupNativeRelayOwner): void {
    if (owner !== this.owner || Object.entries(this.binding).some(([key, value]) => owner[key as keyof DatabaseBackupNativeRelayOwner] !== value)) throw failure();
  }
  private valid(): boolean {
    try { this.own(this.owner); this.hooks.checkOwner(this.binding); if (this.signal?.aborted) throw failure(); return true; }
    catch { this.stop(this.signal?.aborted ? 'cancelled' : 'owner-invalid', true); return false; }
  }
  private active(): boolean { return !this.reason && this.valid() && !this.reason; }
  /** Root 在任何 await 前取得实例与全部连接 Promise；无自动重开监听、重连或新 owner 接管。 */
  start(owner: DatabaseBackupNativeRelayOwner): this {
    this.own(owner); if (this.started || this.acceptingSealed) throw failure(); this.started = true;
    if (!this.valid() || this.reason) return this;
    try {
      const registration: unknown = this.hooks.register(this);
      if (registration !== undefined) { void Promise.resolve(registration).catch(() => undefined); throw failure(); }
      if (!this.active() || this.acceptingSealed) return this;
      this.server = this.port.server();
      this.server.on('connection', socket => this.accept(socket));
      this.server.on('error', () => this.stop('listen-failed', true));
      this.server.on('close', () => { this.serverCloseSeen = true; this.serverEnd.resolve(); });
      this.server.on('listening', () => this.listened());
      this.upstream = this.capture(this.port.socket(), 'upstream');
      this.upstream.socket.on('connect', () => this.didConnect());
      this.signal?.addEventListener('abort', this.abort, { once: true });
      if (!this.active()) return this;
      this.listenAttempted = true;
      this.server.listen({ host: '127.0.0.1', port: 0, exclusive: true, backlog: 1 });
      if (!this.reason && !this.handshakeWritten) { this.timer = setTimeout(() => this.stop('timeout', true), 15000); this.timer.unref(); }
    } catch { this.stop(this.listenAttempted ? 'listen-failed' : 'registration-failed', true); }
    return this;
  }
  private readonly abort = (): void => this.stop('cancelled', true);
  private listened(): void {
    if (this.acceptingSealed || !this.active()) { this.closeListener(); return; }
    const address = this.server?.address();
    if (!address || typeof address === 'string' || address.address !== '127.0.0.1' || !Number.isSafeInteger(address.port) || address.port < 1) { this.stop('listen-failed', true); return; }
    this.ready.resolve(Object.freeze({ host: '127.0.0.1', port: address.port }));
  }
  /** server.close 只停止新 accept；已有客户端和上游不 end/destroy，close 事件另记。 */
  private closeListener(): void {
    this.acceptingSealed = true;
    if (!this.server || !this.server.listening || this.serverCloseRequested) return;
    this.serverCloseRequested = true;
    try { this.server.close(error => { if (error) this.stop('listen-failed', true); }); } catch { this.stop('listen-failed', true); }
  }
  seal(owner: DatabaseBackupNativeRelayOwner): void { this.own(owner); this.closeListener(); if (!this.client) this.stop('explicit-close', false); }
  private capture(socket: Socket, role: SocketRecord['role']): SocketRecord {
    const record: SocketRecord = { socket, role, closed: deferred<void>(), connected: false, ended: false, errored: false, closeSeen: false, closeRequested: false };
    // 先存原句柄再操作流；同步 pause/on 异常也不能让已分配的 Socket 从 Root 账本消失。
    if (role === 'upstream') this.upstream = record; else { this.clients.push(record); if (role === 'client') this.client = record; }
    socket.on('error', () => { record.errored = true; this.stop(role === 'upstream' ? 'upstream-error' : 'client-error', true); });
    socket.on('end', () => { record.ended = true; if (role === 'upstream' && !this.handshakeParsed) this.stop('packet-invalid', true); else this.stop(role === 'upstream' ? 'upstream-eof' : 'client-eof', false); });
    socket.on('timeout', () => this.stop('timeout', true));
    socket.on('close', () => {
      record.closeSeen = true; record.closed.resolve();
      if (!record.closeRequested && !record.ended) this.stop(role === 'upstream' ? 'upstream-close' : 'client-close', true);
    });
    if (role !== 'extra-client') {
      socket.on('readable', () => this.pump(role));
      socket.on('drain', () => { const write = this.writes[role]; if (write) { write.drained = true; this.written(role, write); } });
    }
    try { socket.pause(); } catch { this.stop(role === 'upstream' ? 'upstream-error' : 'client-error', true); }
    return record;
  }
  private accept(socket: Socket): void {
    const extra = Boolean(this.client || this.acceptingSealed || this.reason);
    const record = this.capture(socket, extra ? 'extra-client' : 'client');
    if (extra) { this.stop('second-client', true); return; }
    this.client = record; record.connected = true;
    // 首客户端一旦登记，立即关闭监听入口；排队迟到客户端仍留在本 owner 的原记录中。
    this.closeListener();
    if (!this.active()) return;
    if (!this.upstream || socket.remoteAddress !== '127.0.0.1' || socket.allowHalfOpen !== true || this.upstream.socket.allowHalfOpen !== true) { this.stop('connect-failed', true); return; }
    this.connectAttempted = true;
    try {
      this.upstream.socket.connect({ host: this.target.ip, port: this.target.port, family: isIP(this.target.ip), autoSelectFamily: false,
        lookup: (_hostname, _options, callback) => callback(failure(), '', 0),
      });
    } catch { this.stop('connect-failed', true); }
  }
  /** 只记录同一原 Socket 的实际四元组；连接晚到也保留，不恢复已撤销的流。 */
  private didConnect(): void {
    if (!this.upstream) return;
    if (this.upstream.connected) { this.stop('connect-failed', true); return; }
    const socket = this.upstream.socket; this.upstream.connected = true;
    try {
      if (!socket.localAddress || !socket.remoteAddress || !Number.isSafeInteger(socket.localPort) || !Number.isSafeInteger(socket.remotePort) || !socket.localPort || socket.localPort > 65535 || !socket.remotePort || socket.remotePort > 65535 || ip(socket.remoteAddress) !== this.target.ip || socket.remotePort !== this.target.port || !isIP(socket.localAddress)) throw failure();
      this.tuple = Object.freeze({ localAddress: socket.localAddress, localPort: socket.localPort, remoteAddress: socket.remoteAddress, remotePort: socket.remotePort });
      if (!this.active()) return;
      this.connected.resolve(this.tuple); this.pump('upstream');
    } catch { this.stop('connect-failed', true); }
  }
  /** 每次只从已缓冲数据取最多16 KiB；不用 data 流全量队列，不调用 resume/pipe/pipeline。 */
  private pump(from: Role): void {
    if (!this.active() || !this.client || !this.upstream?.connected) return;
    const to: Role = from === 'client' ? 'upstream' : 'client';
    if (this.writes[to] || from === 'client' && !this.handshakeWritten) return;
    if (from === 'upstream' && this.tail) { const tail = this.tail; this.tail = null; this.write('client', tail); return; }
    const source = from === 'client' ? this.client.socket : this.upstream.socket;
    try {
      const amount = Math.min(source.readableLength, 16 * 1024); if (!amount) return;
      const chunk: unknown = source.read(amount);
      if (!Buffer.isBuffer(chunk) || chunk.length > 16 * 1024 || !chunk.length) { this.stop('buffer-limit', true); return; }
      if (from === 'upstream' && !this.handshakeParsed) this.readGreeting(chunk); else this.write(to, chunk);
    } catch { this.stop('upstream-error', true); }
  }
  /** 包头与载荷合计最多4096；只解析 protocol/version/connectionId，不解析认证、SQL或行。 */
  private readGreeting(chunk: Buffer): void {
    this.handshakeBuffer ??= Buffer.alloc(4096); let cursor = 0;
    while (cursor < chunk.length && !this.handshakeParsed && this.active()) {
      const needed = (this.handshakeLength ?? 4) - this.handshakeBytes;
      const take = Math.min(needed, chunk.length - cursor);
      chunk.copy(this.handshakeBuffer, this.handshakeBytes, cursor, cursor + take); this.handshakeBytes += take; cursor += take;
      if (this.handshakeBytes === 4 && this.handshakeLength === null) {
        this.handshakeLength = this.handshakeBuffer.readUIntLE(0, 3) + 4;
        if (this.handshakeLength > 4096 || this.handshakeLength < 10 || this.handshakeBuffer[3] !== 0) { this.stop('packet-invalid', true); return; }
      }
      if (this.handshakeLength !== null && this.handshakeBytes === this.handshakeLength) {
        const packet = this.handshakeBuffer.subarray(0, this.handshakeLength), end = packet.indexOf(0, 5);
        if (packet[4] !== 10 || end < 6 || end > 133 || end + 1 + 4 + 8 + 1 + 2 + 1 + 2 + 2 + 1 + 10 > packet.length || packet.subarray(5, end).some(byte => byte < 0x20 || byte > 0x7e)) { this.stop('packet-invalid', true); return; }
        const serverVersion = packet.toString('ascii', 5, end), threadId = packet.readUInt32LE(end + 1);
        if (serverVersion !== this.target.serverVersion) { this.stop('version-mismatch', true); return; }
        if (!threadId || !this.tuple) { this.stop('packet-invalid', true); return; }
        this.handshakeParsed = true;
        if (cursor < chunk.length) this.tail = chunk.subarray(cursor);
        this.greeting.resolve(Object.freeze({ protocolVersion: 10, serverVersion, threadId, family: this.target.family, version: this.target.version, upstream: this.tuple }));
        this.write('client', packet, () => {
          // 只有原写回调成功且背压已解除才清除握手副本；取消不会伪造写完成。
          this.handshakeBuffer = null; this.handshakeBytes = 0; this.handshakeWritten = true;
          if (this.timer) { clearTimeout(this.timer); this.timer = null; }
          this.pump('client');
        });
      }
    }
    if (!this.handshakeParsed) this.pump('upstream');
  }
  /** 每方向最多一笔原写入，必须同时见成功callback与所需drain；错误绝不销毁对侧。 */
  private write(to: Role, bytes: Buffer, after?: () => void): void {
    if (!this.active()) return;
    const destination = to === 'client' ? this.client?.socket : this.upstream?.socket;
    if (!destination || this.writes[to] || !destination.writable || destination.destroyed || destination.writableLength + bytes.length > 16 * 1024 || bytes.length > 16 * 1024) { this.stop('buffer-limit', true); return; }
    const write: WriteRecord = { bytes, returned: false, callbackDone: false, drained: false, needsDrain: false, after }; this.writes[to] = write;
    try {
      const accepted = destination.write(bytes, error => { if (error) { this.stop('write-failed', true); return; } write.callbackDone = true; this.written(to, write); });
      write.returned = true; write.needsDrain = !accepted; if (accepted) write.drained = true;
      this.written(to, write);
    } catch { this.stop('write-failed', true); }
  }
  private written(to: Role, write: WriteRecord): void {
    if (this.writes[to] !== write || !write.returned || !write.callbackDone || write.needsDrain && !write.drained) return;
    this.writes[to] = null; write.after?.();
    if (this.active()) this.pump(to === 'client' ? 'upstream' : 'client');
  }
  private stop(reason: Boundary, failed: boolean): void {
    if (failed && !this.failureReason) { this.failureReason = reason as DatabaseBackupNativeRelayReason; this.failed.resolve(this.failureReason); }
    if (!this.reason) { this.reason = reason; this.stopped.resolve(reason); }
    this.ready.reject(failure()); this.connected.reject(failure()); this.greeting.reject(failure());
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.closeListener();
    // 不对任何一侧 end/destroy；Root 先按 threadId+HOST/USER+实例登记核对/KILL原线程。
  }
  timeout(owner: DatabaseBackupNativeRelayOwner): void { this.own(owner); this.stop('timeout', true); }
  cancel(owner: DatabaseBackupNativeRelayOwner): void { this.own(owner); this.stop('cancelled', true); }
  /** 唯一主动关闭Socket入口；destroy/end只是请求，closed Promise只由原close事件完成。 */
  requestClose(owner: DatabaseBackupNativeRelayOwner, target: 'upstream' | 'clients' | 'server' | 'all', mode: 'destroy' | 'end' = 'destroy'): void {
    this.own(owner); if (!['upstream', 'clients', 'server', 'all'].includes(target) || !['destroy', 'end'].includes(mode)) throw failure();
    this.closeListener(); if (target === 'server') return;
    this.stop('explicit-close', false);
    const records = [...(target === 'upstream' || target === 'all' ? this.upstream ? [this.upstream] : [] : []), ...(target === 'clients' || target === 'all' ? this.clients : [])];
    for (const record of records) {
      if (record.closeSeen) continue; record.closeRequested = true;
      try { if (mode === 'destroy') record.socket.destroy(); else record.socket.end(); } catch { this.stop(record.role === 'upstream' ? 'upstream-error' : 'client-error', true); }
    }
  }
  /** 仅私有原句柄与真实事件记录；无serverClosed字段，不把本地close提升成后端线程终态。 */
  retained(owner: DatabaseBackupNativeRelayOwner) {
    this.own(owner);
    return { server: this.server, upstream: this.upstream?.socket ?? null, upstreamClosed: this.upstream?.closed.promise ?? null,
      clients: this.clients.map(record => ({ socket: record.socket, closed: record.closed.promise })), listening: this.listening, upstreamConnected: this.upstreamConnected, handshake: this.handshake };
  }
  snapshot(owner: DatabaseBackupNativeRelayOwner) {
    this.own(owner);
    const state = (record: SocketRecord) => ({ role: record.role, connected: record.connected, ended: record.ended, errored: record.errored, localCloseSeen: record.closeSeen, closeRequested: record.closeRequested });
    return Object.freeze({ started: this.started, listenAttempted: this.listenAttempted, connectAttempted: this.connectAttempted, acceptingSealed: this.acceptingSealed,
      serverCloseRequested: this.serverCloseRequested, listenerLocalCloseSeen: this.serverCloseSeen, reason: this.reason, failureReason: this.failureReason,
      upstream: this.upstream ? state(this.upstream) : null, clients: this.clients.map(state), upstreamTuple: this.tuple,
      handshakeParsed: this.handshakeParsed, handshakeWritten: this.handshakeWritten, handshakeRetainedBytes: this.handshakeBuffer ? this.handshakeBytes : 0,
      tailBytes: this.tail?.length ?? 0, clientWriteBytes: this.writes.client?.bytes.length ?? 0, upstreamWriteBytes: this.writes.upstream?.bytes.length ?? 0,
    });
  }
}
