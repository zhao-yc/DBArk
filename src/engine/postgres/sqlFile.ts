import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { firstPostgresFileStatement, IncompletePostgresSql, isBarePostgresFileControl } from '../../shared/postgresSql';
import { postgresSqlFileLimits as limits, type PostgresSqlFileResult } from '../../shared/postgresSqlFile';
import type { PostgresConnection } from './connection';

export interface PostgresSqlFileSource { path: string; version: string; bytes: number }
type Failure = NonNullable<PostgresSqlFileResult['failure']>;
class FileFailure extends Error { constructor(readonly reason: Failure['reason']) { super(reason); } }
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
    const { bytesRead } = await this.file.read(this.buffer, 0, count, this.offset);
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

  async next(standardStrings: boolean) {
    for (;;) {
      this.check();
      if (this.pending.length > limits.statementBytes) throw new FileFailure('budget');
      let part;
      try { part = firstPostgresFileStatement(this.pending, standardStrings); }
      catch (reason) {
        if (!(reason instanceof IncompletePostgresSql) || this.eof) throw new FileFailure('syntax');
      }
      if (part && (part.end < this.pending.length || this.eof)) {
        const bytes = Buffer.byteLength(part.sql);
        if (bytes > limits.statementBytes) throw new FileFailure('budget');
        this.pendingBytes -= bytes + Buffer.byteLength(this.pending.slice(0, part.start)) + Number(part.end < this.pending.length);
        this.pending = this.pending.slice(part.end + 1);
        return part;
      }
      if (this.eof) return;
      if (this.pendingBytes >= limits.statementBytes) throw new FileFailure('budget');
      const target = Math.min(limits.statementBytes, Math.max(this.pendingBytes * 2, this.pendingBytes + chunkSize));
      do { await this.append(); } while (!this.eof && this.pendingBytes < target);
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
      if (!completed && !wrapped && part.keyword === 'BEGIN' && isBarePostgresFileControl(part.sql, 'BEGIN')) {
        wrapped = true;
        continue;
      }
      if (wrapped && completed && !wrapperEnded && part.keyword === 'COMMIT' && isBarePostgresFileControl(part.sql, 'COMMIT')) {
        wrapperEnded = true;
        continue;
      }
      if (wrapperEnded || part.parameters.length || !allowed.has(part.keyword)) throw new FileFailure('command');
      if (completed >= limits.statements) throw new FileFailure('budget');
      control.check();
      failure = { reason: 'server', statement: completed + 1 };
      sent = true;
      await query(part.sql);
      if (!state().transactionKnown || !state().transactionOpen || state().transactionFailed)
        throw new FileFailure('transaction');
      if (++completed % 128 === 0) control.progress(completed);
    }
    if (!completed || wrapped !== wrapperEnded) throw new FileFailure('command');
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
