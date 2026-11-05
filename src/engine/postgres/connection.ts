import { Client, Query, types, type FieldDef, type QueryConfig, type ClientConfig } from 'pg';
import { from as copyFrom, to as copyTo } from 'pg-copy-streams';
import type { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { Client as SshClient, type ClientChannel } from 'ssh2';
import { Duplex, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import type { PostgresConnectionProfile, QueryResult, CellValue } from '../../shared/contracts';
import { assertConnectionReady } from '../../shared/connectionTransfer';

/** 已建立SSH通道适配pg需要的Socket接口；所有字节仍只经过原准确channel。 */
class ForwardSocket extends Duplex {
  constructor(private readonly channel: ClientChannel) {
    super();
    channel.on('data', (data: Buffer) => {
      if (!this.push(data)) channel.pause();
    });
    channel.on('end', () => this.push(null));
    channel.on('error', (error: Error) => this.destroy(error));
    channel.on('close', () => this.destroy());
  }
  connect() {
    queueMicrotask(() => this.emit('connect'));
    return this;
  }
  setNoDelay() {
    return this;
  }
  setKeepAlive() {
    return this;
  }
  _read() {
    this.channel.resume();
  }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.channel.write(chunk, callback);
  }
  _final(callback: (error?: Error | null) => void) {
    this.channel.end(callback);
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (!this.channel.destroyed) this.channel.destroy();
    callback(error);
  }
}
const names: Record<number, string> = {
  16: 'BOOLEAN',
  17: 'BYTEA',
  20: 'BIGINT',
  21: 'SMALLINT',
  23: 'INTEGER',
  25: 'TEXT',
  114: 'JSON',
  700: 'REAL',
  701: 'DOUBLE PRECISION',
  1042: 'CHAR',
  1043: 'VARCHAR',
  1082: 'DATE',
  1083: 'TIME',
  1114: 'TIMESTAMP',
  1184: 'TIMESTAMPTZ',
  1186: 'INTERVAL',
  1266: 'TIMETZ',
  1700: 'NUMERIC',
  2950: 'UUID',
  3802: 'JSONB',
};
const bytea = types.getTypeParser(17, 'text');
/** 不使用默认日期／JSON／数组／数值解析器；协议原文保留精度，只有BYTEA转准确字节包装。 */
export const postgresTypes = {
  getTypeParser: (oid: number) => (oid === 17 ? bytea : (value: string) => value),
};
interface PgWire extends EventEmitter {
  stream: Duplex & { closed?: boolean };
}
export interface PostgresBudget {
  rows: number;
  bytes: number;
}

/** 一份物理连接独享事务状态和传输资源；不使用池、不自动重连或重放SQL。 */
export class PostgresConnection {
  client?: Client;
  broken = false;
  private ssh?: SshClient;
  private channel?: ClientChannel;
  private sshClosed = false;
  private channelClosed = false;
  private closing?: Promise<void>;
  private stopped = false;
  version = '';
  database = '';
  backendStart = '';
  standardStrings = true;
  constructor(
    readonly profile: PostgresConnectionProfile,
    readonly requestedDatabase = profile.database || 'postgres',
  ) {}
  /** 错误不回显认证材料或附加原异常对象，避免任务与IPC保存秘密。 */
  error(reason: unknown): Error {
    let message = reason instanceof Error ? reason.message : String(reason);
    for (const secret of [
      this.profile.password,
      this.profile.ssh?.password,
      this.profile.ssh?.passphrase,
      this.profile.tls?.passphrase,
    ])
      if (secret) message = message.replaceAll(secret, '[已隐藏]');
    return Error(message.slice(0, 8192));
  }
  private check() {
    if (this.stopped) throw Error('PostgreSQL连接已取消');
  }
  abort() {
    this.stopped = true;
    void this.client?.end().catch(() => {});
    this.ssh?.end();
  }
  /** 明确给出认证函数、数据库、SSL和空启动选项，不读取PGPASSWORD／PGPASS／PGOPTIONS等环境认证。 */
  async open(): Promise<void> {
    if (
      this.profile.dialect !== 'postgresql' ||
      !this.profile.host ||
      !this.profile.user ||
      !Number.isInteger(this.profile.port) ||
      this.profile.port < 1 ||
      this.profile.port > 65535 ||
      !this.requestedDatabase ||
      /[\/\0]/.test(this.profile.host) ||
      this.profile.user.includes('\0') ||
      this.requestedDatabase.includes('\0')
    )
      throw Error('PostgreSQL连接目标无效');
    assertConnectionReady(this.profile);
    this.check();
    if (this.profile.ssh?.enabled) {
      const config = this.profile.ssh;
      if (!config.hostFingerprint) throw Error('SSH连接必须填写服务器SHA256主机指纹');
      const privateKey = config.privateKeyPath ? await readFile(config.privateKeyPath) : undefined;
      this.check();
      const ssh = (this.ssh = new SshClient());
      ssh.once('close', () => {
        this.sshClosed = true;
      });
      await new Promise<void>((resolve, reject) => {
        ssh
          .once('ready', resolve)
          .on('error', reject)
          .once('close', () => reject(Error('SSH在就绪前关闭')));
        ssh.connect({
          host: config.host,
          port: config.port,
          username: config.user,
          password: config.password,
          privateKey,
          passphrase: config.passphrase,
          readyTimeout: 15000,
          hostVerifier: (key: Buffer) =>
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '') ===
            config.hostFingerprint?.trim().replace(/=+$/, ''),
        });
      });
      this.check();
      this.channel = await new Promise<ClientChannel>((resolve, reject) =>
        ssh.forwardOut('127.0.0.1', 0, this.profile.host, this.profile.port, (error, channel) => {
          if (error) reject(error);
          else {
            channel.once('close', () => {
              this.channelClosed = true;
            });
            resolve(channel);
          }
        }),
      );
      this.check();
    }
    const tls = this.profile.tls;
    const material = tls?.enabled
      ? {
          rejectUnauthorized: tls.rejectUnauthorized,
          passphrase: tls.passphrase,
          ca: tls.caPath ? await readFile(tls.caPath) : undefined,
          cert: tls.certPath ? await readFile(tls.certPath) : undefined,
          key: tls.keyPath ? await readFile(tls.keyPath) : undefined,
        }
      : false;
    this.check();
    const config: ClientConfig & { replication: string } = {
      host: this.profile.host,
      port: this.profile.port,
      user: this.profile.user,
      database: this.requestedDatabase,
      password: () => this.profile.password ?? '',
      ssl: material,
      sslnegotiation: 'postgres',
      options: ' ',
      replication: 'false',
      client_encoding: 'UTF8',
      application_name: 'tabrelio',
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      types: postgresTypes,
      ...(this.channel ? { stream: () => new ForwardSocket(this.channel!) } : {}),
    };
    const client = (this.client = Object.assign(
      new Client(config),
      // pg将false视为缺省，PGBINARY仍会覆盖配置；客户端固定使用文本列协议。
      { binary: false },
    ));
    (client as unknown as { connection: PgWire }).connection.on(
      'parameterStatus',
      (message: { parameterName: string; parameterValue: string }) => {
        if (message.parameterName === 'standard_conforming_strings')
          this.standardStrings = message.parameterValue === 'on';
        if (message.parameterName === 'client_encoding' && message.parameterValue.toUpperCase() !== 'UTF8')
          this.broken = true;
      },
    );
    client.on('error', () => {
      this.broken = true;
    });
    client.once('end', () => {
      this.broken = true;
    });
    await client.connect();
    this.check();
    const result = await this.query(
      "SELECT pg_catalog.current_database(), pg_catalog.current_setting('server_version'), " +
        "pg_catalog.current_setting('standard_conforming_strings'), extract(epoch FROM backend_start)::text " +
        'FROM pg_catalog.pg_stat_activity WHERE pid = pg_catalog.pg_backend_pid()',
      undefined,
      { rows: 1, bytes: 65536 },
    );
    const row = result.rows[0];
    if (!row || typeof row.c0 !== 'string' || typeof row.c1 !== 'string' || typeof row.c3 !== 'string')
      throw Error('PostgreSQL连接身份回包无效');
    this.database = row.c0;
    this.version = row.c1;
    this.standardStrings = row.c2 === 'on';
    this.backendStart = row.c3;
  }
  /** 状态只读来自实际ReadyForQuery缓存，失败事务E不能伪称空闲或已回滚。 */
  state() {
    const status = this.client?.getTransactionStatus();
    return {
      transactionOpen: status === 'T' || status === 'E',
      transactionKnown: !this.broken && ['I', 'T', 'E'].includes(status ?? ''),
      transactionFailed: status === 'E',
      broken: this.broken,
    };
  }
  get processId(): number | undefined {
    return (this.client as unknown as { processID?: number })?.processID;
  }
  /** 逐行消费但不让pg积累第二份rows；超显示预算继续排空，SQL仍按用户原意执行到真实终态。 */
  query(
    sql: string,
    values: unknown[] | undefined,
    budget: PostgresBudget,
    onRows?: (rows: QueryResult['rows'], columns: QueryResult['columns']) => void,
    protocol?: 'extended' | 'parse',
  ): Promise<QueryResult> {
    const client = this.client;
    if (!client || this.broken)
      return Promise.reject(Error('PostgreSQL会话已失效，请先核对写入结果再重新连接'));
    const wire = (client as unknown as { connection: PgWire }).connection,
      started = performance.now();
    const config: QueryConfig & { rowMode: 'array'; queryMode?: 'extended' } = {
      text: sql,
      values,
      rowMode: 'array',
      types: postgresTypes,
      // 计划预览由服务端 Parse 再确认单语句，不允许简单协议执行尾随命令。
      ...(protocol === 'extended' ? { queryMode: 'extended' } : {}),
    };
    const query = new Query(config);
    if (protocol === 'parse') {
      // 只用驱动队列发送 Parse / Sync，等服务器验证单条语句，不发送 Bind 或 Execute。
      query.submit = connection => {
        connection.parse({ text: sql, name: '', types: [] }, true);
        connection.sync();
      };
    }
    const rows: QueryResult['rows'] = [];
    let failure: unknown,
      completed = false,
      parsed = false,
      fields: FieldDef[] = [],
      tag = '',
      affected: number | undefined,
      truncated = false,
      batch: QueryResult['rows'] = [];
    const columns = () =>
      fields.map((field, i) => ({
        key: 'c' + i,
        name: field.name,
        type: names[field.dataTypeID] ?? 'OID ' + field.dataTypeID,
      }));
    return new Promise((resolve, reject) => {
      const parsedStatement = () => { parsed = true; };
      const cleanup = () => {
        wire.removeListener('readyForQuery', ready);
        wire.removeListener('parseComplete', parsedStatement);
        client.removeListener('error', dead);
        client.removeListener('end', ended);
      };
      const finish = () => {
        if (completed) return;
        completed = true;
        cleanup();
        if (failure) {
          reject(this.error(failure));
          return;
        }
        if (batch.length) onRows?.(batch, columns());
        resolve({
          columns: columns(),
          rows,
          postgresCommand: tag,
          ...(affected === undefined ? {} : { affectedRows: affected }),
          truncated,
          elapsedMs: performance.now() - started,
          statement: sql,
        });
      };
      const ready = () => {
        if (this.broken && !failure) failure = Error('PostgreSQL连接编码已变化，请核对执行结果并重新连接');
        if (protocol === 'parse' && !parsed && !failure) failure = Error('PostgreSQL未确认单语句解析');
        finish();
      };
      const dead = (reason: unknown) => {
        this.broken = true;
        failure = reason;
        finish();
      };
      const ended = () => dead(Error('PostgreSQL连接已结束；执行中的写入请先核对结果'));
      wire.once('readyForQuery', ready);
      if (protocol === 'parse') wire.once('parseComplete', parsedStatement);
      client.once('error', dead);
      client.once('end', ended);
      query.on('row', (row: unknown[], result?: { fields: FieldDef[] }) => {
        if (!result) {
          failure = Error('PostgreSQL行元数据缺失');
          return;
        }
        fields = result.fields;
        let bytes = 0;
        const entries: [string, CellValue][] = [];
        for (let i = 0; i < row.length; i++) {
          const value = row[i];
          if (value !== null && typeof value !== 'string' && !Buffer.isBuffer(value)) {
            failure = Error('PostgreSQL驱动返回了未经无损解析的值');
            return;
          }
          const cell = Buffer.isBuffer(value)
            ? { type: 'binary' as const, base64: value.toString('base64') }
            : (value as string | null);
          bytes += 32 + (typeof cell === 'string' ? Buffer.byteLength(cell) : cell ? cell.base64.length : 4);
          entries.push(['c' + i, cell]);
        }
        if (fields.length > 1024 || rows.length >= 100000 || budget.rows <= 0 || bytes > budget.bytes) {
          truncated = true;
          return;
        }
        budget.rows--;
        budget.bytes -= bytes;
        const data = Object.fromEntries(entries);
        rows.push(data);
        batch.push(data);
        if (batch.length === 128) {
          onRows?.(batch, columns());
          batch = [];
        }
      });
      query.once('error', (reason) => {
        failure = reason;
      });
      query.once('end', (result: any) => {
        fields = result.fields;
        tag = result.command ?? '';
        if (Number.isSafeInteger(result.rowCount) && result.rowCount >= 0) affected = result.rowCount;
      });
      try {
        client.query(query);
      } catch (reason) {
        failure = reason;
        finish();
      }
    });
  }
  /** 在独占读取连接中消费 COPY 字节，等待实际命令标签、事务状态及文件写入。 */
  async copyOut(sql: string, write: (chunk: Buffer) => Promise<void>): Promise<number> {
    this.check();
    const client = this.client;
    if (!client || this.broken || client.getTransactionStatus() !== 'T')
      throw Error('PostgreSQL COPY 需要独占读取事务');
    const wire = (client as unknown as { connection: PgWire }).connection;
    const stream = copyTo(sql);
    let tag = '', cleanup = () => {};
    const terminal = new Promise<number | undefined>(resolve => {
      const command = (message: { text: string }) => { tag = message.text; };
      const ended = () => resolve(undefined);
      const ready = () => {
        const match = /^COPY (\d+)$/.exec(tag);
        const count = match ? Number(match[1]) : NaN;
        resolve(!this.broken && client.getTransactionStatus() === 'T' && Number.isSafeInteger(count) ? count : undefined);
      };
      cleanup = () => {
        wire.removeListener('commandComplete', command);
        wire.removeListener('readyForQuery', ready);
        client.removeListener('end', ended);
      };
      wire.once('commandComplete', command);
      wire.once('readyForQuery', ready);
      client.once('end', ended);
    });
    // 每次文件写入结束才读取下一块，读写失败时也先退出当前写入。
    const drain = (async () => {
      for await (const chunk of stream) await write(chunk);
    })();
    try {
      try { client.query(stream); }
      catch (reason) { stream.destroy(this.error(reason)); }
      await drain;
      const rows = await terminal;
      if (rows === undefined) throw Error('PostgreSQL 未确认 COPY 行数及事务状态');
      return rows;
    } catch (reason) {
      this.abort();
      throw this.error(reason);
    } finally { cleanup(); }
  }
  /** COPY FROM 的流结束后仍复核服务器就绪；失败时等待原命令退出再允许回滚。 */
  async copyIn(sql: string, source: Readable): Promise<number> {
    this.check();
    const client = this.client;
    if (!client || this.broken || client.getTransactionStatus() !== 'T')
      throw Error('PostgreSQL COPY 需要独占写入事务');
    const wire = (client as unknown as { connection: PgWire }).connection;
    const stream = copyFrom(sql);
    stream.rowCount = -1;
    let settle!: () => void;
    const ready = new Promise<void>(resolve => { settle = resolve; });
    wire.once('readyForQuery', settle);
    client.once('end', settle);
    try {
      client.query(stream);
      try { await pipeline(source, stream); } finally { await ready; }
      if (this.broken || client.getTransactionStatus() !== 'T' || !Number.isSafeInteger(stream.rowCount) || stream.rowCount < 0)
        throw Error('PostgreSQL 未确认 COPY 导入行数及事务状态');
      return stream.rowCount;
    } finally {
      wire.removeListener('readyForQuery', settle);
      client.removeListener('end', settle);
    }
  }
  /** 正常结束原物理会话及SSH资源；观察超时保留资源，不能当作关闭成功。 */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const work = (async () => {
      const wait = async (promise: Promise<unknown>) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('PostgreSQL原连接关闭未确认')), 15000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      if (this.client) {
        await wait(this.client.end());
        const wire = (this.client as unknown as { connection: PgWire }).connection;
        if (wire.stream.closed !== true) throw Error('PostgreSQL原TCP／TLS流关闭未确认');
      }
      if (this.channel && !this.channelClosed)
        await wait(
          new Promise<void>((resolve) => {
            this.channel!.once('close', resolve);
            this.channel!.end();
          }),
        );
      if (this.ssh && !this.sshClosed)
        await wait(
          new Promise<void>((resolve) => {
            this.ssh!.once('close', resolve);
            this.ssh!.end();
          }),
        );
    })();
    this.closing = work;
    void work.catch(() => {
      if (this.closing === work) this.closing = undefined;
    });
    return work;
  }
}
