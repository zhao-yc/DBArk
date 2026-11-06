import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { firstPostgresFileStatement, IncompletePostgresSql, isBarePostgresFileControl,
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
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SELECT', 'WITH', 'VALUES', 'SET', 'RESET', 'LOCK', 'DO', 'CALL']);

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
  let failure: Failure = { reason: 'file' };
  const query = async (sql: string) => {
    control.active(true);
    try { return await connection.query(sql, undefined, budget(), undefined, 'extended'); }
    finally { control.active(false); }
  };
  const settled = (outcome: PostgresSqlFileResult['outcome'], problem?: Failure): PostgresSqlFileResult =>
    ({ outcome, completed, cancelled: control.cancelled(), ...(problem ? { failure: problem } : {}) });
  const state = () => connection.state();
  try {
    control.check();
    if (!isAbsolute(source.path) || version(await lstat(source.path, { bigint: true })) !== source.version)
      throw new FileFailure('file');
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
        if (part.directive === 'restrict' && !restrictionKey && !completed && !wrapped) restrictionKey = part.key;
        else if (part.directive === 'unrestrict' && restrictionKey && restrictionKey === part.key &&
            !restrictionEnded && completed && wrapped === wrapperEnded) restrictionEnded = true;
        else throw new FileFailure('command');
        continue;
      }
      if (restrictionEnded) throw new FileFailure('command');
      if (!completed && !wrapped && part.keyword === 'BEGIN' && isBarePostgresFileControl(part.sql, 'BEGIN')) {
        wrapped = true;
        continue;
      }
      if (wrapped && completed && !wrapperEnded && part.keyword === 'COMMIT' && isBarePostgresFileControl(part.sql, 'COMMIT')) {
        wrapperEnded = true;
        continue;
      }
      const copy = part.keyword === 'COPY';
      if (wrapperEnded || part.parameters.length ||
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
      } else await query(part.sql);
      if (!state().transactionKnown || !state().transactionOpen || state().transactionFailed)
        throw new FileFailure('transaction');
      if (++completed % 128 === 0) control.progress(completed);
    }
    if (!completed || wrapped !== wrapperEnded || Boolean(restrictionKey) !== restrictionEnded) throw new FileFailure('command');
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
