import { assertConnectionReady } from '../shared/connectionTransfer';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mysql, { type Connection, type ConnectionOptions, type FieldPacket } from 'mysql2';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import type { ConnectionProfile, ConnectionStatus } from '../shared/contracts';
import { sqlExecutableWords } from '../shared/queryParameters';

export interface ManagedConnection {
  connection: Connection;
  profile: ConnectionProfile;
  status: ConnectionStatus;
  broken: boolean;
  /** 模式和事务来自初始读取及后续协议状态包；undefined 表示无法可靠判断。 */
  sqlMode?: string;
  serverStatus?: number;
  sqlModeTracking?: boolean;
  /** ERR 包没有状态位，保留上次状态供展示，但不能把它当作错误后的实时真值。 */
  transactionStateKnown?: boolean;
  noBackslashEscapesKnown?: boolean;
  /** 独立只读任务可在建连、元数据和读取阶段取消整个连接。 */
  signal?: AbortSignal;
  /** 结束数据库会话并释放附属 SSH 隧道，可以重复调用。 */
  close(options?: { strict?: boolean }): Promise<void>;
}

/** 严格结构任务观察 QUIT 写入/本地流关闭；COM_QUIT 没有服务器 ACK，不据此证明 DDL 结果。 */
export async function closeMysqlConnection(connection: Connection, strict: boolean, alreadyBroken = false, timeoutMs = 1000): Promise<void> {
  const stream = (connection as unknown as { stream?: { closed?: boolean; incoming?: { state?: string }; outgoing?: { state?: string }; once(name: string, fn: () => void): unknown; removeListener(name: string, fn: () => void): unknown; destroy(): void; end(callback?: (error?: Error) => void): void; close?(): void } }).stream;
  let failure: Error | undefined;
  await new Promise<void>(resolve => {
    // ssh2 Channel 的 closed 属性不随手工 close 事件变化；双方协议状态可证明此前已关闭，不能把 EOF 当 CLOSE。
    let settled = false, endReturned = alreadyBroken, writableFlushed = alreadyBroken, transportClosed = stream?.closed === true || (typeof stream?.close === 'function' && stream.incoming?.state === 'closed' && stream.outgoing?.state === 'closed');
    const finish = (): void => { if (settled) return; settled = true; clearTimeout(timer); stream?.removeListener('close', onClose); resolve(); };
    const checkFinished = (): void => { if (!strict || !stream || ((failure || (endReturned && writableFlushed)) && transportClosed)) finish(); };
    const onClose = (): void => { transportClosed = true; checkFinished(); };
    const destroyLocal = (): void => { connection.destroy(); stream?.destroy(); };
    const timer = setTimeout(() => { failure = new Error('数据库连接关闭超时，本地流已强制关闭，请核对服务器状态'); destroyLocal(); finish(); }, timeoutMs);
    timer.unref();
    if (strict) stream?.once('close', onClose);
    if (alreadyBroken) {
      destroyLocal();
      checkFinished();
      return;
    }
    try {
      connection.end(error => {
        endReturned = true;
        if (error) { failure = new Error('数据库连接正常退出失败，本地流已强制关闭，请核对服务器状态', { cause: error }); destroyLocal(); }
        checkFinished();
        if (strict && !error && stream && !settled) {
          // mysql2 QUIT 回调早于 writePacket，必须等本次同步写入结束才结束流；ssh2 半开 channel 还须在写队列完成后显式 CLOSE。
          queueMicrotask(() => {
            if (settled) return;
            try { stream.end(error => {
              try { if (error) throw error; writableFlushed = true; stream.close?.(); checkFinished(); }
              catch (error) { failure = new Error('数据库退出传输写入或关闭失败，本地流已强制关闭', { cause: error }); destroyLocal(); checkFinished(); }
            }); }
            catch (error) { failure = new Error('数据库退出传输关闭失败，本地流已强制关闭', { cause: error }); destroyLocal(); checkFinished(); }
          });
        }
      });
    } catch (error) { failure = new Error('数据库连接退出发生异常，本地流已强制关闭', { cause: error }); destroyLocal(); checkFinished(); }
  });
  if (strict && failure) throw failure;
}

/** 观察协议包并更新缓存，绝不为诊断或事务状态额外执行 SELECT/DO。 */
export function observeSessionState(managed: ManagedConnection, packet: { serverStatus?: number; stateChanges?: { systemVariables?: Record<string, string> }; sql?: string }): void {
  const previousMode = managed.sqlMode;
  const previousStatus = managed.serverStatus;
  const previousEscapesKnown = managed.noBackslashEscapesKnown;
  if (packet.serverStatus !== undefined) { managed.serverStatus = packet.serverStatus; managed.transactionStateKnown = true; }
  const variables = packet.stateChanges?.systemVariables ?? {};
  if (Object.hasOwn(variables, 'sql_mode')) {
    // CALL 退出可报告恢复后的完整模式，却在末包及后续普通 EOF 保留例程内的 NBE 位。
    // 只有同包完整模式与状态一致才恢复信任；普通成功包只能恢复事务状态。
    const consistent = packet.serverStatus !== undefined && Boolean(packet.serverStatus & 512) === variables.sql_mode.split(',').includes('NO_BACKSLASH_ESCAPES');
    managed.sqlMode = consistent ? variables.sql_mode : undefined;
    managed.noBackslashEscapesKnown = consistent;
    managed.sqlModeTracking = true;
  }
  if (Object.hasOwn(variables, 'session_track_system_variables')) {
    const tracked = variables.session_track_system_variables.toLowerCase().split(',').map(value => value.trim());
    managed.sqlModeTracking = tracked.includes('*') || tracked.includes('sql_mode');
    if (!managed.sqlModeTracking) { managed.sqlMode = undefined; managed.noBackslashEscapesKnown = false; }
  }
  // 五个基线服务器实测：关闭 tracker 自身时没有任何变量报告，CALL/EXECUTE 也可隐藏这种变化。
  // 对不透明控制语句不能凭缺少事件猜测“模式没变”；NBE 位也可能过时，须使用四候选扫描器。
  if (packet.sql && !(Number(packet.serverStatus) & 8) && !Object.hasOwn(variables, 'sql_mode')) {
    try {
      const words = sqlExecutableWords(packet.sql, { noBackslashEscapes: previousMode === undefined ? Boolean((previousStatus ?? 0) & 512) : previousMode.split(',').includes('NO_BACKSLASH_ESCAPES'), noBackslashEscapesKnown: previousMode !== undefined || previousEscapesKnown !== false, ansiQuotes: previousMode?.split(',').includes('ANSI_QUOTES') ?? false, ansiQuotesKnown: previousMode !== undefined });
      const control = words[0];
      if (control === 'CALL' || control === 'EXECUTE' || (control === 'SET' && words.some(word => ['SQL_MODE', 'SESSION_TRACK_SYSTEM_VARIABLES'].includes(word)))) {
        managed.sqlMode = undefined;
        managed.noBackslashEscapesKnown = false;
        if (!Object.hasOwn(variables, 'session_track_system_variables')) managed.sqlModeTracking = undefined;
      }
    } catch { managed.sqlMode = undefined; managed.sqlModeTracking = undefined; managed.noBackslashEscapesKnown = false; }
  }
  // 出现矛盾后持续未知，不能让下一份同样过时的 EOF 重新获得词法解析的信任。
  if (managed.sqlMode !== undefined && packet.serverStatus !== undefined && Boolean(packet.serverStatus & 512) !== managed.sqlMode.split(',').includes('NO_BACKSLASH_ESCAPES')) {
    managed.sqlMode = undefined; managed.noBackslashEscapesKnown = false;
  }
}

/** ERR 可能来自隐式提交、死锁或执行了一部分的存储程序；无协议证据时明确降为未知。 */
export function observeSessionError(managed: ManagedConnection): void {
  managed.transactionStateKnown = false; managed.noBackslashEscapesKnown = false;
  managed.sqlMode = undefined; managed.sqlModeTracking = undefined;
}

/** 参数化语句使用预处理以适应任意转义模式；无参数控制语句直接走文本协议，避免 START TRANSACTION 等不支持预处理。 */
export function execute<T = Record<string, unknown>[]>(managed: ManagedConnection, sql: string, params: (string | number | boolean | null | Buffer)[] = []): Promise<{ rows: T; fields: FieldPacket[] }> {
  if (managed.signal?.aborted) return Promise.reject(new Error('任务已取消'));
  if (managed.broken) return Promise.reject(new Error('数据库连接已断开，请重新连接；未自动重放 SQL'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('任务已取消'));
    managed.signal?.addEventListener('abort', abort, { once: true });
    const done = (error: Error | null, rows: unknown, fields: FieldPacket[]) => { managed.signal?.removeEventListener('abort', abort); error ? reject(error) : resolve({ rows: rows as T, fields }); };
    // 在发送之前选择协议，不在失败后重放 SQL，保证写操作最多发送一次。
    if (params.length) managed.connection.execute(sql, params, done);
    else managed.connection.query(sql, done);
  });
}

/** 建立数据库连接前完成 SSH 主机校验和 TLS 文件加载；任何阶段失败都会释放隧道。 */
export async function connect(profile: ConnectionProfile, database = profile.database, signal?: AbortSignal): Promise<ManagedConnection> {
  assertConnectionReady(profile);
  let ssh: SshClient | undefined;
  let sshClosed = false;
  let stream: ClientChannel | undefined;
  let connection: Connection | undefined;
  const cancelled = () => { if (signal?.aborted) throw new Error('任务已取消'); };
  const destroy = () => {
    connection?.destroy();
    // mysql2.destroy 实际只发送 FIN；正在等待结果时还须销毁底层流，不能留下半关闭的本地 socket。
    (connection as unknown as { stream?: { destroy(): void } } | undefined)?.stream?.destroy();
    stream?.destroy(); ssh?.destroy();
  };
  signal?.addEventListener('abort', destroy, { once: true });
  /** 驱动 destroy 未必回调 pending connect/forwardOut，显式唤醒等待并回收迟到通道。 */
  const stage = <T>(start: (done: (error?: Error | null, result?: T) => void) => void): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(new Error('任务已取消'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    const done = (error?: Error | null, result?: T) => { signal?.removeEventListener('abort', abort); if (signal?.aborted) abort(); else if (error) reject(error); else resolve(result as T); };
    try { start(done); } catch (error) { done(error as Error); }
  });
  try {
    cancelled();
    if (profile.ssh?.enabled) {
      if (!profile.ssh.hostFingerprint) throw new Error('SSH 连接必须填写服务器 SHA256 主机指纹');
      const config = profile.ssh;
      ssh = new SshClient();
      ssh.once('close', () => { sshClosed = true; });
      const client = ssh;
      const privateKey = config.privateKeyPath ? await readFile(config.privateKeyPath, { signal }) : undefined;
      cancelled();
      await stage<void>(done => {
        client.once('ready', () => done()).on('error', error => done(error));
          client.connect({ host: config.host, port: config.port, username: config.user, password: config.password, privateKey, passphrase: config.passphrase, readyTimeout: 15000, keepaliveInterval: 10000,
            hostVerifier: (key: Buffer) => {
              const actual = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
              return actual === config.hostFingerprint?.trim().replace(/=+$/, '');
            }
          });
      });
      stream = await stage<ClientChannel>(done => client.forwardOut('127.0.0.1', 0, profile.host, profile.port, (error, channel) => { if (signal?.aborted) channel?.destroy(); done(error, channel); }));
    }
    const tls = profile.tls?.enabled ? {
      rejectUnauthorized: profile.tls.rejectUnauthorized,
      verifyIdentity: profile.tls.rejectUnauthorized,
      ca: profile.tls.caPath ? await readFile(profile.tls.caPath, { signal }) : undefined,
      cert: profile.tls.certPath ? await readFile(profile.tls.certPath, { signal }) : undefined,
      key: profile.tls.keyPath ? await readFile(profile.tls.keyPath, { signal }) : undefined,
    } : undefined;
    cancelled();
    const options: ConnectionOptions = {
      host: profile.host, port: profile.port, user: profile.user, password: profile.password, database: database || undefined,
      stream, ssl: tls, connectTimeout: 15000, enableKeepAlive: true, keepAliveInitialDelay: 10000,
      charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true,
      jsonStrings: true, multipleStatements: false, flags: ['FOUND_ROWS'],
      // 静态解析器配合 rowsAsArray 不把合法的 __proto__ 等字段名写入对象原型。
      disableEval: true,
      // JSON 保持服务器原始文本；JS 自动解析会损失 JSON 内部大整数的精度。
      typeCast(field, next) { if (field.type === 'JSON') return field.string('utf8'); return next(); },
    };
    connection = mysql.createConnection(options);
    const active = connection;
    await stage<void>(done => active.connect(error => done(error)));
    let closePending: Promise<void> | undefined;
    const managed: ManagedConnection = {
      connection: active, profile, status: { version: '', dialect: profile.dialect, connectionId: active.threadId }, broken: false, signal,
      /** 优先发送正常退出；连接已卡死时限时销毁，防止退出流程永久等待。 */
      async close(options = {}) {
        if (!closePending) closePending = (async () => {
          let failure: unknown;
          try { await closeMysqlConnection(active, Boolean(options.strict), managed.broken || Boolean(signal?.aborted)); } catch (error) { failure = error; }
          finally {
            stream?.destroy();
            if (options.strict && ssh && !sshClosed) {
              const client = ssh;
              await new Promise<void>(resolve => {
                const done = (): void => { clearTimeout(timer); client.removeListener('close', done); resolve(); };
                const timer = setTimeout(() => { failure ??= new Error('SSH 隧道关闭超时，已强制释放本地传输'); client.destroy(); done(); }, 1000);
                timer.unref(); client.once('close', done); client.end();
              });
            } else ssh?.end();
            signal?.removeEventListener('abort', destroy);
          }
          if (failure) throw failure;
        })();
        return closePending;
      }
    };
    active.on('error', () => { managed.broken = true; });
    active.on('end', () => { managed.broken = true; });
    active.on('dbark:session-state', (packet: Parameters<typeof observeSessionState>[1]) => observeSessionState(managed, packet));
    active.on('dbark:session-error', () => observeSessionError(managed));
    if (ssh) { ssh.on('error', () => { managed.broken = true; active.destroy(); }); ssh.on('close', () => { managed.broken = true; active.destroy(); }); }
    // 仅在新会话建立时读取模式；此时尚无用户语句的 ROW_COUNT/警告需要保留。
    const result = await execute<{ version: string; sqlMode: string }[]>(managed, 'SELECT VERSION() AS version, @@SESSION.sql_mode AS sqlMode');
    managed.status.version = result.rows[0].version;
    managed.status.dialect = /mariadb/i.test(managed.status.version) ? 'mariadb' : 'mysql';
    managed.sqlMode = result.rows[0].sqlMode;
    // 同时跟踪跟踪配置本身，用户明确关闭此能力时不继续使用过期的 SQL 模式缓存。
    await execute(managed, "SET SESSION session_track_system_variables = 'sql_mode,session_track_system_variables'");
    // 初始化的 SET 可能按通用控制保护使缓存失效；该指令没有改变刚读出的 sql_mode。
    managed.sqlMode = result.rows[0].sqlMode;
    managed.sqlModeTracking = true;
    managed.noBackslashEscapesKnown = true;
    return managed;
  } catch (error) {
    destroy(); signal?.removeEventListener('abort', destroy);
    // 证书/密钥文件读取也可能由AbortSignal中止；统一建连取消文案，避免泄露底层英文异常。
    if(signal?.aborted)throw new Error('任务已取消');
    throw error;
  }
}
