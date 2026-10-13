import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import mysql, { type Connection, type ConnectionOptions, type FieldPacket } from 'mysql2';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import type { ConnectionProfile, ConnectionStatus } from '../shared/contracts';

export interface ManagedConnection {
  connection: Connection;
  profile: ConnectionProfile;
  status: ConnectionStatus;
  broken: boolean;
  /** 结束数据库会话并释放附属 SSH 隧道，可以重复调用。 */
  close(): Promise<void>;
}

/** 参数化语句使用预处理以适应任意转义模式；无参数控制语句直接走文本协议，避免 START TRANSACTION 等不支持预处理。 */
export function execute<T = Record<string, unknown>[]>(managed: ManagedConnection, sql: string, params: (string | number | boolean | null | Buffer)[] = []): Promise<{ rows: T; fields: FieldPacket[] }> {
  if (managed.broken) return Promise.reject(new Error('数据库连接已断开，请重新连接；未自动重放 SQL'));
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, rows: unknown, fields: FieldPacket[]) => error ? reject(error) : resolve({ rows: rows as T, fields });
    // 在发送之前选择协议，不在失败后重放 SQL，保证写操作最多发送一次。
    if (params.length) managed.connection.execute(sql, params, done);
    else managed.connection.query(sql, done);
  });
}

/** 建立数据库连接前完成 SSH 主机校验和 TLS 文件加载；任何阶段失败都会释放隧道。 */
export async function connect(profile: ConnectionProfile, database = profile.database): Promise<ManagedConnection> {
  let ssh: SshClient | undefined;
  let stream: ClientChannel | undefined;
  let connection: Connection | undefined;
  try {
    if (profile.ssh?.enabled) {
      if (!profile.ssh.hostFingerprint) throw new Error('SSH 连接必须填写服务器 SHA256 主机指纹');
      const config = profile.ssh;
      ssh = new SshClient();
      const client = ssh;
      await new Promise<void>((resolve, reject) => {
        client.once('ready', resolve).on('error', reject);
        void (async () => {
          const privateKey = config.privateKeyPath ? await readFile(config.privateKeyPath) : undefined;
          client.connect({ host: config.host, port: config.port, username: config.user, password: config.password, privateKey, passphrase: config.passphrase, readyTimeout: 15000, keepaliveInterval: 10000,
            hostVerifier: (key: Buffer) => {
              const actual = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
              return actual === config.hostFingerprint?.trim().replace(/=+$/, '');
            }
          });
        })().catch(reject);
      });
      stream = await new Promise<ClientChannel>((resolve, reject) => client.forwardOut('127.0.0.1', 0, profile.host, profile.port, (error, channel) => error ? reject(error) : resolve(channel)));
    }
    const tls = profile.tls?.enabled ? {
      rejectUnauthorized: profile.tls.rejectUnauthorized,
      verifyIdentity: profile.tls.rejectUnauthorized,
      ca: profile.tls.caPath ? await readFile(profile.tls.caPath) : undefined,
      cert: profile.tls.certPath ? await readFile(profile.tls.certPath) : undefined,
      key: profile.tls.keyPath ? await readFile(profile.tls.keyPath) : undefined,
    } : undefined;
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
    await new Promise<void>((resolve, reject) => active.connect(error => error ? reject(error) : resolve()));
    let closed = false;
    const managed: ManagedConnection = {
      connection: active, profile, status: { version: '', dialect: profile.dialect, connectionId: active.threadId }, broken: false,
      /** 优先发送正常退出；连接已卡死时限时销毁，防止退出流程永久等待。 */
      async close() {
        if (closed) return;
        closed = true;
        await new Promise<void>(resolve => {
          const timeout = setTimeout(() => { active.destroy(); resolve(); }, 1000);
          timeout.unref();
          try { active.end(() => { clearTimeout(timeout); resolve(); }); } catch { clearTimeout(timeout); active.destroy(); resolve(); }
        });
        stream?.destroy(); ssh?.end();
      }
    };
    active.on('error', () => { managed.broken = true; });
    active.on('end', () => { managed.broken = true; });
    if (ssh) { ssh.on('error', () => { managed.broken = true; active.destroy(); }); ssh.on('close', () => { managed.broken = true; active.destroy(); }); }
    const result = await execute<{ version: string }[]>(managed, 'SELECT VERSION() AS version');
    managed.status.version = result.rows[0].version;
    managed.status.dialect = /mariadb/i.test(managed.status.version) ? 'mariadb' : 'mysql';
    return managed;
  } catch (error) {
    connection?.destroy(); stream?.destroy(); ssh?.end(); throw error;
  }
}
