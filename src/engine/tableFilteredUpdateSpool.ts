import { createHash, type Hash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { CellValue } from '../shared/contracts';
import { tableFilteredUpdateLimits as limits, tableFilteredUpdateText as text } from '../shared/tableFilteredUpdate';

export interface TableFilteredUpdateSnapshotRow { values: CellValue[]; timestampEpochs: (string | null)[]; }
type StoredCell = ['s', string] | ['n', number | '-0'] | ['b', boolean] | ['z'] | ['x', string];
const identity = (left: BigIntStats, right: BigIntStats) => left.dev === right.dev && left.ino === right.ino;
const unchanged = (left: BigIntStats, right: BigIntStats) => identity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
/** 快照只保存数据值；数值负零单独编码，不能被JSON静默变成零。 */
function stored(value: CellValue): StoredCell {
  if (value === null) return ['z'];
  if (typeof value === 'string') { if (Buffer.byteLength(value) > limits.fieldBytes) throw Error(text.budget); return ['s', value]; }
  if (typeof value === 'number' && Number.isFinite(value)) return ['n', Object.is(value, -0) ? '-0' : value];
  if (typeof value === 'boolean') return ['b', value];
  if (value && typeof value === 'object' && value.type === 'binary' && typeof value.base64 === 'string') {
    const decoded = Buffer.from(value.base64, 'base64');
    if (decoded.toString('base64') !== value.base64) throw Error(text.spool);
    if (decoded.length > limits.fieldBytes) throw Error(text.budget);
    return ['x', value.base64];
  }
  throw Error(text.spool);
}
function restored(input: unknown): CellValue {
  if (!Array.isArray(input)) throw Error(text.spool);
  if (input[0] === 'z' && input.length === 1) return null;
  if (input.length !== 2) throw Error(text.spool);
  if (input[0] === 's' && typeof input[1] === 'string') return input[1];
  if (input[0] === 'b' && typeof input[1] === 'boolean') return input[1];
  if (input[0] === 'n' && (input[1] === '-0' || typeof input[1] === 'number' && Number.isFinite(input[1]))) return input[1] === '-0' ? -0 : input[1];
  if (input[0] === 'x' && typeof input[1] === 'string') return { type: 'binary', base64: input[1] };
  throw Error(text.spool);
}
/** 原文件独占创建；一行写完后才接收下一行，内存不随总匹配行数增长。 */
export class TableFilteredUpdateSpool {
  readonly directory: string; readonly path: string;
  rows = 0; bytes = 0;
  private handle?: FileHandle; private readonly hash: Hash = createHash('sha256');
  private original: BigIntStats; private readonly parent: BigIntStats;
  private sealed?: { stat: BigIntStats; digest: string }; private removed = false; private fileRemoved = false;
  private readonly readers = new Set<FileHandle>();
  private constructor(directory: string, handle: FileHandle, original: BigIntStats, parent: BigIntStats) { this.directory = directory; this.path = join(directory, 'snapshot.bin'); this.handle = handle; this.original = original; this.parent = parent; }
  static async create(check: () => void): Promise<TableFilteredUpdateSpool> {
    check(); const created = await mkdtemp(join(tmpdir(), 'dbark-filtered-update-')); let directory = created, file: FileHandle | undefined;
    try {
      check(); directory = await realpath(created); check(); const parent = await lstat(directory, { bigint: true }); check();
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw Error(text.spool);
      file = await open(join(directory, 'snapshot.bin'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0), 0o600);
      const original = await file.stat({ bigint: true }); check();
      return new TableFilteredUpdateSpool(directory, file, original, parent);
    } catch (error) {
      const failures: unknown[] = [error]; try { await file?.close(); } catch (reason) { failures.push(reason); }
      if (file) try { await unlink(join(directory, 'snapshot.bin')); } catch (reason) { failures.push(reason); }
      try { await rmdir(directory); } catch (reason) { failures.push(reason); }
      throw failures.length === 1 ? error : new AggregateError(failures, text.spool);
    }
  }
  async append(row: TableFilteredUpdateSnapshotRow, check: () => void, reserve: (additional: number) => void): Promise<void> {
    check(); if (!this.handle || this.sealed || this.removed || !Number.isSafeInteger(this.rows + 1)) throw Error(text.spool);
    const value = JSON.stringify([row.values.map(stored), row.timestampEpochs]);
    const payload = Buffer.from(value, 'utf8'); if (payload.length > limits.rowBytes) throw Error(text.budget);
    const prefix = Buffer.allocUnsafe(4); prefix.writeUInt32BE(payload.length);
    reserve(prefix.length + payload.length);
    for (const buffer of [prefix, payload]) {
      let offset = 0; while (offset < buffer.length) { check(); const result = await this.handle.write(buffer, offset, buffer.length - offset); check(); if (!result.bytesWritten) throw Error(text.spool); offset += result.bytesWritten; }
      this.hash.update(buffer); this.bytes += buffer.length;
    }
    this.rows++;
  }
  async seal(check: () => void): Promise<void> {
    check(); if (!this.handle || this.sealed) throw Error(text.spool);
    await this.handle.sync(); check(); const stat = await this.handle.stat({ bigint: true }); check();
    if (!identity(this.original, stat) || stat.size !== BigInt(this.bytes)) throw Error(text.spool);
    await this.handle.close(); this.handle = undefined; check();
    this.original = stat; this.sealed = { stat, digest: this.hash.digest('hex') };
    await this.verifyPath(); check();
  }
  private async verifyPath(): Promise<void> {
    const parent = await lstat(this.directory, { bigint: true });
    if (!parent.isDirectory() || parent.isSymbolicLink() || !identity(parent, this.parent) || await realpath(this.directory) !== this.directory) throw Error(text.spool);
    const current = await lstat(this.path, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || !unchanged(this.sealed?.stat ?? this.original, current)) throw Error(text.spool);
  }
  /** 每一遍都从原文件柄流式核完整SHA和行数；第二遍结束前不能提交事务。 */
  async *read(check: () => void): AsyncGenerator<TableFilteredUpdateSnapshotRow> {
    check(); if (!this.sealed || this.removed) throw Error(text.spool); await this.verifyPath(); check();
    const handle = await open(this.path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0)); this.readers.add(handle); let failure: unknown;
    try {
      check(); if (!unchanged(await handle.stat({ bigint: true }), this.sealed.stat)) throw Error(text.spool);
      let position = 0, rows = 0; const hash = createHash('sha256');
      const readExact = async (buffer: Buffer) => { let offset = 0; while (offset < buffer.length) { check(); const result = await handle.read(buffer, offset, buffer.length - offset, position); check(); if (!result.bytesRead) throw Error(text.spool); offset += result.bytesRead; position += result.bytesRead; } hash.update(buffer); };
      while (position < this.bytes) {
        const prefix = Buffer.allocUnsafe(4); await readExact(prefix); const length = prefix.readUInt32BE();
        if (!length || length > limits.rowBytes || position + length > this.bytes) throw Error(text.spool);
        const payload = Buffer.allocUnsafe(length); await readExact(payload); let data: unknown;
        try { data = JSON.parse(payload.toString('utf8')); } catch { throw Error(text.spool); }
        if (!Array.isArray(data) || data.length !== 2 || !Array.isArray(data[0]) || data[0].length > limits.columns || !Array.isArray(data[1]) || data[1].length > limits.columns || data[1].some((value: unknown) => value !== null && (typeof value !== 'string' || !/^-?\d+(?:\.\d{1,6})?$/.test(value)))) throw Error(text.spool);
        const values = data[0].map(restored); values.forEach(stored); rows++;
        yield { values, timestampEpochs: data[1] as (string | null)[] };
      }
      check(); if (position !== this.bytes || rows !== this.rows || hash.digest('hex') !== this.sealed.digest || !unchanged(await handle.stat({ bigint: true }), this.sealed.stat)) throw Error(text.spool);
      await this.verifyPath(); check();
    } catch (error) { failure = error; throw error; }
    finally { try { await handle.close(); this.readers.delete(handle); } catch (error) { if (failure) throw new AggregateError([failure, error], text.spool); throw error; } }
  }
  /** 只清理本次创建的原inode与目录；被替换的外来对象保留现场并报错。 */
  async dispose(): Promise<void> {
    if (this.removed) return;
    for (const reader of this.readers) { await reader.close(); this.readers.delete(reader); }
    if (this.handle) { await this.handle.close(); this.handle = undefined; }
    const parent = await lstat(this.directory, { bigint: true }); if (!identity(parent, this.parent) || !parent.isDirectory() || parent.isSymbolicLink()) throw Error(text.spool);
    if (!this.fileRemoved) { const file = await lstat(this.path, { bigint: true }); if (!identity(file, this.original) || !file.isFile() || file.isSymbolicLink()) throw Error(text.spool); await unlink(this.path); this.fileRemoved = true; }
    await rmdir(this.directory); this.removed = true;
  }
}
