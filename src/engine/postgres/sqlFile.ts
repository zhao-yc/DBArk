import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { firstPostgresFileStatement, IncompletePostgresSql, isBarePostgresFileControl, postgresIdentifier,
  isPostgresInlineCopy, skipPostgresTrivia, type PostgresStatement } from '../../shared/postgresSql';
import { postgresSqlFileLimits as limits, type PostgresSqlFileResult } from '../../shared/postgresSqlFile';
import type { PostgresConnection } from './connection';

export interface PostgresSqlFileSource { path: string; version: string; bytes: number }
type Failure = NonNullable<PostgresSqlFileResult['failure']>;
class FileFailure extends Error { constructor(readonly reason: Failure['reason']) { super(reason); } }
type FilePart = PostgresStatement | { directive: 'restrict' | 'unrestrict' | 'unsupported'; key?: string };
const budget = () => ({ rows: 0, bytes: 0 });
const chunkSize = 128 * 1024;
const allowed = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'COMMENT', 'GRANT', 'REVOKE',
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SELECT', 'WITH', 'VALUES', 'SET', 'RESET', 'LOCK', 'DO', 'CALL',
  'REFRESH', 'SECURITY']);
type LargeObjectState = 'empty' | 'open' | 'closed';

/** 识别 pg_dump 生成的顺序大对象读写块，保留文件事务，逐条核对描述符和写入长度。 */
function largeObjectStep(sql: string, state: LargeObjectState, standardStrings: boolean): {
  next: LargeObjectState; result: string;
} {
  const command = sql.slice(skipPostgresTrivia(sql)).trimEnd();
  if (state !== 'open' && /^SELECT pg_catalog\.lo_open\('[0-9]+', 131072\)$/i.test(command))
    return { next: 'open', result: '0' };
  if (state === 'open' && /^SELECT pg_catalog\.lo_close\(0\)$/i.test(command))
    return { next: 'closed', result: '0' };
  const write = standardStrings && state === 'open' &&
    /^SELECT pg_catalog\.lowrite\(0, '\\x((?:[0-9a-f]{2})+)'\)$/i.exec(command);
  if (write) return { next: 'open', result: String(write[1].length / 2) };
  throw new FileFailure('command');
}

/** 只接受普通文件，物理身份和文件修改代次共同约束授权。 */
function version(stat: BigIntStats) {
  if (!stat.isFile() || stat.ino <= 0n || stat.size < 1n || stat.size > BigInt(limits.bytes)) throw new FileFailure('file');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
export async function inspectPostgresSqlFile(path: string): Promise<PostgresSqlFileSource> {
  if (!isAbsolute(path) || path.includes('\0') || !/\.sql$/i.test(path)) throw Error('请选择普通的 SQL 文件');
  try {
    const stat = await lstat(path, { bigint: true });
    return { path, version: version(stat), bytes: Number(stat.size) };
  } catch { throw Error('请选择非空且不超过 10 GiB 的普通 SQL 文件'); }
}
async function assertVersion(source: PostgresSqlFileSource, file: FileHandle) {
  if (version(await file.stat({ bigint: true })) !== source.version ||
      version(await lstat(source.path, { bigint: true })) !== source.version) throw new FileFailure('file');
}

/** 在发出 CREATE DATABASE 等事务外操作前重新确认本机源文件。 */
export async function assertPostgresSqlFileSource(source: PostgresSqlFileSource) {
  if (!isAbsolute(source.path) || version(await lstat(source.path, { bigint: true })) !== source.version)
    throw new FileFailure('file');
}

const databaseBudget = () => ({ rows: 1, bytes: 2048 });

/** 用服务器字节长度复核名称，避免 CREATE DATABASE 静默截断标识符。 */
export async function postgresRestoreDatabaseCommand(connection: PostgresConnection, name: string): Promise<string> {
  const result = await connection.query(
    "SELECT pg_catalog.octet_length($1::text) <= pg_catalog.current_setting('max_identifier_length')::int",
    [name], databaseBudget(),
  );
  if (result.rows[0]?.c0 !== 't') throw Error('目标数据库名称超过服务器允许的字节长度');
  return 'CREATE DATABASE ' + postgresIdentifier(name) + ' WITH TEMPLATE template0';
}

/** 读取创建后的库 OID，连接目标库时再次核对，防止同名对象在两次连接之间被替换。 */
export async function readPostgresRestoreDatabaseOid(connection: PostgresConnection, name: string): Promise<string> {
  const result = await connection.query(
    'SELECT oid::text FROM pg_catalog.pg_database WHERE datname = $1 AND datallowconn AND NOT datistemplate ' +
    'AND datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)',
    [name], databaseBudget(),
  );
  const oid = result.rows[0]?.c0;
  if (typeof oid !== 'string' || !/^[1-9][0-9]*$/.test(oid)) throw Error('无法确认新建 PostgreSQL 数据库的身份');
  return oid;
}

/** 每轮只保留尚未执行的缓冲。超长单句按倍增补块，避免每块重扫整句。 */
class FileStatements {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly buffer = Buffer.allocUnsafe(chunkSize);
  private pending = '';
  private pendingBytes = 0;
  private offset = 0;
  private eof = false;
  constructor(private readonly file: FileHandle, private readonly bytes: number, private readonly check: () => void) {}

  private async append() {
    this.check();
    const count = Math.min(this.bytes - this.offset, chunkSize, Math.max(1, limits.statementBytes - this.pendingBytes));
    if (count < 1) throw new FileFailure('file');
    const { bytesRead } = await this.file.read(this.buffer, 0, count, this.offset).catch(() => {
      throw new FileFailure('file');
    });
    this.check();
    if (!bytesRead) throw new FileFailure('file');
    this.offset += bytesRead;
    this.eof = this.offset === this.bytes;
    let decoded: string;
    try { decoded = this.decoder.decode(this.buffer.subarray(0, bytesRead), { stream: !this.eof }); }
    catch { throw new FileFailure('encoding'); }
    if (decoded.includes('\0')) throw new FileFailure('encoding');
    this.pending += decoded;
    this.pendingBytes += Buffer.byteLength(decoded);
  }

  private take(length: number) {
    const value = this.pending.slice(0, length);
    this.pendingBytes -= Buffer.byteLength(value);
    this.pending = this.pending.slice(length);
    return value;
  }

  async next(standardStrings: boolean): Promise<FilePart | undefined> {
    for (;;) {
      this.check();
      if (this.pending.length > limits.statementBytes) throw new FileFailure('budget');
      try {
        const start = skipPostgresTrivia(this.pending);
        if (this.pending[start] === '\\') {
          const end = this.pending.indexOf('\n', start);
          if (end >= 0 || this.eof) {
            const line = this.take(end >= 0 ? end + 1 : this.pending.length).slice(start);
            const match = /^\\(restrict|unrestrict)[ \t]+([A-Za-z0-9]+)[ \t]*(?:\r?\n)?$/.exec(line);
            if (!match) return { directive: 'unsupported' };
            return { directive: match[1] === 'restrict' ? 'restrict' : 'unrestrict', key: match[2] };
          }
        } else {
          const part = firstPostgresFileStatement(this.pending, standardStrings);
          if (part && (part.end < this.pending.length || this.eof)) {
            if (Buffer.byteLength(part.sql) > limits.statementBytes) throw new FileFailure('budget');
            this.take(part.end + Number(part.end < this.pending.length));
            return part;
          }
        }
      } catch (reason) {
        if (reason instanceof FileFailure) throw reason;
        if (!(reason instanceof IncompletePostgresSql) || this.eof) throw new FileFailure('syntax');
      }
      if (this.eof) return;
      if (this.pendingBytes >= limits.statementBytes) throw new FileFailure('budget');
      const target = Math.min(limits.statementBytes, Math.max(this.pendingBytes * 2, this.pendingBytes + chunkSize));
      do { await this.append(); } while (!this.eof && this.pendingBytes < target);
    }
  }

  /** COPY 指令行单独结束。只保留可能跨读取块的结束标记，长数据行也逐块发送。 */
  async *copyData(): AsyncGenerator<Buffer> {
    let end = this.pending.indexOf('\n');
    while (end < 0 && !this.eof && this.pendingBytes < limits.statementBytes) {
      const start = this.pending.length;
      await this.append();
      end = this.pending.indexOf('\n', start);
    }
    if (end < 0 || !/^[ \t]*(?:--[^\r\n]*)?\r?\n$/.test(this.take(end + 1)))
      throw new FileFailure('syntax');

    let previous = '\n';
    for (;;) {
      this.check();
      let length = this.pending.length, markerLength = 0;
      for (const match of this.pending.matchAll(/(?:^|(?<=[\r\n]))\\(?:\.(?:\r\n?|\n|(?![\s\S]))|(?![\s\S]))/g)) {
        const start = match.index, before = start ? this.pending[start - 1] : previous;
        if (before !== '\n' && before !== '\r') continue;
        const marker = match[0];
        if (marker.endsWith('\n')) {
          // 拒绝单独 CR 引出的标记，防止较旧服务器把它解释为提前结束。
          if (before === '\r') throw new FileFailure('syntax');
          length = start;
          markerLength = marker.length;
          break;
        }
        if (start + marker.length === this.pending.length && !this.eof) {
          length = start;
          break;
        }
        if (marker.endsWith('\r')) throw new FileFailure('syntax');
      }
      if (length) {
        previous = this.pending[length - 1];
        yield Buffer.from(this.take(length));
      }
      if (markerLength) {
        this.take(markerLength);
        return;
      }
      if (this.eof) throw new FileFailure('syntax');
      await this.append();
    }
  }
}

export interface PostgresSqlFileControl {
  check(): void;
  cancelled(): boolean;
  active(value: boolean): void;
  protect(): void;
  settleCancel(): Promise<void>;
  progress(statements: number): void;
}

/** 只用专用连接执行。文件事务外壳由客户端托管，读到尾部并复核源文件后才发送真实 COMMIT。 */
export async function executePostgresSqlFile(connection: PostgresConnection, source: PostgresSqlFileSource,
  control: PostgresSqlFileControl): Promise<PostgresSqlFileResult> {
  let file: FileHandle | undefined, opened = false, sent = false, commitSent = false, completed = 0, wrapped = false, wrapperEnded = false;
  let restrictionKey: string | undefined, restrictionEnded = false;
  let largeObject: LargeObjectState | undefined;
  let failure: Failure = { reason: 'file' };
  const query = async (sql: string, readResult = false) => {
    control.active(true);
    try { return await connection.query(sql, undefined, readResult ? { rows: 1, bytes: 1024 } : budget(), undefined, 'extended'); }
    finally { control.active(false); }
  };
  const settled = (outcome: PostgresSqlFileResult['outcome'], problem?: Failure): PostgresSqlFileResult =>
    ({ outcome, completed, cancelled: control.cancelled(), ...(problem ? { failure: problem } : {}) });
  const state = () => connection.state();
  try {
    control.check();
    await assertPostgresSqlFileSource(source);
    file = await open(source.path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    await assertVersion(source, file);
    const statements = new FileStatements(file, source.bytes, () => control.check());
    control.check();
    failure = { reason: 'transaction' };
    const begin = await query('BEGIN');
    opened = state().transactionKnown && state().transactionOpen;
    if (begin.postgresCommand !== 'BEGIN' || !opened) throw new FileFailure('transaction');
    for (;;) {
      failure = { reason: 'file' };
      const part = await statements.next(connection.standardStrings);
      if (!part) break;
      failure = { reason: 'command', statement: completed + 1 };
      if ('directive' in part) {
        if (largeObject) throw new FileFailure('command');
        if (part.directive === 'restrict' && !restrictionKey && !completed && !wrapped) restrictionKey = part.key;
        else if (part.directive === 'unrestrict' && restrictionKey && restrictionKey === part.key &&
            !restrictionEnded && completed && wrapped === wrapperEnded) restrictionEnded = true;
        else throw new FileFailure('command');
        continue;
      }
      if (restrictionEnded || wrapperEnded) throw new FileFailure('command');
      if (!largeObject && part.keyword === 'BEGIN' && isBarePostgresFileControl(part.sql, 'BEGIN')) {
        if (!completed && !wrapped) wrapped = true;
        else largeObject = 'empty';
        continue;
      }
      if (part.keyword === 'COMMIT' && isBarePostgresFileControl(part.sql, 'COMMIT')) {
        if (largeObject === 'closed') { largeObject = undefined; continue; }
        if (!largeObject && wrapped && completed) { wrapperEnded = true; continue; }
        throw new FileFailure('command');
      }
      const lo = largeObject && largeObjectStep(part.sql, largeObject, connection.standardStrings);
      const copy = part.keyword === 'COPY';
      if (part.parameters.length ||
          !(copy ? isPostgresInlineCopy(part.sql, connection.standardStrings) : allowed.has(part.keyword)))
        throw new FileFailure('command');
      if (completed >= limits.statements) throw new FileFailure('budget');
      control.check();
      failure = { reason: 'server', statement: completed + 1 };
      sent = true;
      if (copy) {
        control.active(true);
        try {
          await connection.copyIn(part.sql, Readable.from(statements.copyData(), { objectMode: false }));
        } catch (reason) {
          if (reason instanceof FileFailure) throw reason;
          const safe = connection.error(reason) as Error & { postgresSqlState?: string };
          // COPY 的错误消息可能包含输入记录，只保留真实的错误码。
          failure = { ...failure, ...(safe.postgresSqlState ? { sqlState: safe.postgresSqlState } : {}) };
          throw new FileFailure('server');
        } finally { control.active(false); }
      } else {
        const result = await query(part.sql, Boolean(lo));
        if (lo) {
          if (result.postgresCommand !== 'SELECT' || result.rows[0]?.c0 !== lo.result) throw new FileFailure('transaction');
          largeObject = lo.next;
        }
      }
      if (!state().transactionKnown || !state().transactionOpen || state().transactionFailed)
        throw new FileFailure('transaction');
      if (++completed % 128 === 0) control.progress(completed);
    }
    if (!completed || wrapped !== wrapperEnded || Boolean(restrictionKey) !== restrictionEnded || largeObject)
      throw new FileFailure('command');
    failure = { reason: 'file' };
    await assertVersion(source, file);
    await file.close(); file = undefined;
    control.check();
    failure = { reason: 'transaction' };
    control.protect();
    commitSent = true;
    const commit = await query('COMMIT');
    if (state().transactionKnown && !state().transactionOpen) {
      if (commit.postgresCommand === 'COMMIT') return settled('committed');
      if (commit.postgresCommand === 'ROLLBACK') return settled('rolled-back', failure);
    }
    return settled('unknown', failure);
  } catch (reason) {
    if (control.cancelled()) failure = { reason: 'cancelled', ...(failure.statement === undefined ? {} : { statement: failure.statement }) };
    else if (reason instanceof FileFailure) failure = { ...failure, reason: reason.reason };
    else if (reason instanceof Error) {
      const sqlState = (reason as Error & { postgresSqlState?: string }).postgresSqlState;
      if (commitSent && sqlState && state().transactionKnown && !state().transactionOpen)
        return settled('rolled-back', { reason: 'server', sqlState, detail: reason.message.slice(0, 2048) });
      if (failure.reason === 'server') failure = { ...failure, detail: reason.message.slice(0, 2048), ...(sqlState ? { sqlState } : {}) };
    }
    control.protect();
    await control.settleCancel();
    if (state().transactionKnown && state().transactionOpen) {
      try {
        const rollback = await query('ROLLBACK');
        if (rollback.postgresCommand === 'ROLLBACK' && state().transactionKnown && !state().transactionOpen)
          return settled('rolled-back', failure);
      } catch { /* 只有服务器回执和已关闭状态一起确认回滚。 */ }
    }
    return settled(opened || sent ? 'unknown' : 'not-started', failure);
  } finally { await file?.close().catch(() => undefined); }
}
