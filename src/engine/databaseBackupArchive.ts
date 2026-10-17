import { createHash } from 'node:crypto';
import { queryZipDirectory, queryZipEnd } from './queryCsvZip';
import { databaseBackupArchiveLimits as limits, databaseBackupArchiveManifest, type DatabaseBackupArchiveDump, type DatabaseBackupArchiveManifest, type DatabaseBackupArchiveManifestInput } from './databaseBackupArchiveManifest';
export { databaseBackupArchiveLimits } from './databaseBackupArchiveManifest';
export type { DatabaseBackupArchiveDump, DatabaseBackupArchiveManifest, DatabaseBackupArchiveManifestInput } from './databaseBackupArchiveManifest';
export interface DatabaseBackupArchiveSink {
  /** AtomicFile.writeBytes已负责短写/缓冲；模块不取得提交或删除权。 */
  writeBytes(bytes: Uint8Array): Promise<void>;
}
export interface DatabaseBackupArchiveReader {
  readonly size: bigint;
  /** 返回1至length字节，允许短读；offset保持bigint。 */
  read(offset: bigint, length: number): Promise<Uint8Array>;
}
interface Entry {
  name: string;
  offset: number;
  bytes: number;
  crc: number;
}
const names = ['dump.sql', 'manifest.json'] as const;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
/** CRC及SHA都增量消费原字节，不解码SQL，不保留已经写出的dump。 */
function crc32(previous: number, bytes: Uint8Array): number {
  let value = previous ^ 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
/** 本地ZIP64大小留零，真实大小必须由带签名的64位descriptor及中央目录共同核验。 */
function localHeader(name: string): Buffer {
  const path = Buffer.from(name, 'utf8'), header = Buffer.alloc(50 + path.length);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(45, 4);
  header.writeUInt16LE(0x0808, 6);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(0xffffffff, 18);
  header.writeUInt32LE(0xffffffff, 22);
  header.writeUInt16LE(path.length, 26);
  header.writeUInt16LE(20, 28);
  path.copy(header, 30);
  header.writeUInt16LE(1, 30 + path.length);
  header.writeUInt16LE(16, 32 + path.length);
  return header;
}
/** 固定带签名descriptor，不接受可与数据尾部混淆的无签名变体。 */
function descriptor(entry: Entry): Buffer {
  const out = Buffer.alloc(24);
  out.writeUInt32LE(0x08074b50);
  out.writeUInt32LE(entry.crc, 4);
  out.writeBigUInt64LE(BigInt(entry.bytes), 8);
  out.writeBigUInt64LE(BigInt(entry.bytes), 16);
  return out;
}
/** 来自归档的uint64必须先按bigint预算验证，不能先转number或32位数。 */
function boundedNumber(value: bigint, max = limits.archiveBytes): number {
  if (value < 0n || value > max || value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('备份归档偏移或大小超出预算');
  return Number(value);
}

/** 顺序STORE/ZIP64 writer；调用方必须await并在完成前保持输入片段不变，最多64KiB一片。 */
export class DatabaseBackupArchiveWriter {

  private state: 'new' | 'dump' | 'finishing' | 'done' | 'failed' = 'new';
  private busy = false;
  private offset = 0;

  private readonly dumpHash = createHash('sha256');
  private readonly archiveHash = createHash('sha256');
  private dump?: Entry;

  constructor(private readonly sink: DatabaseBackupArchiveSink, private readonly checkCancelled: () => void = () => { }) { }
  /** 重入/失败永久阻断；写入失败不兜底commit/dispose，原子文件仍由执行器持有。 */

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy || this.state === 'failed' || this.state === 'done') {
      this.state = 'failed';
      throw Error('备份归档顺序或状态无效');
    }
    this.busy = true;
    try {
      this.checkCancelled();
      return await action();
    } catch (reason) {
      this.state = 'failed';
      throw reason;
    } finally {
      this.busy = false;
    }
  }
  /** await期间重入可能使状态停链；通过独立断言重新读取状态，不能沿用await前的类型缩窄。 */

  private assertWritable(): void {
    if (this.state === 'failed') throw Error('备份归档已停链');
  }

  private async emit(bytes: Uint8Array): Promise<void> {
    this.checkCancelled();
    this.assertWritable();
    if (BigInt(this.offset) + BigInt(bytes.length) > limits.archiveBytes) throw Error('备份归档超过10GiB或已停链');
    await this.sink.writeBytes(bytes);
    this.checkCancelled();
    this.assertWritable();
    this.archiveHash.update(bytes);
    this.offset += bytes.length;
  }
  /** 首次写出dump本地头；重复开始视为不可继续的调用顺序错误。 */

  startDump(): Promise<void> {
    return this.exclusive(async () => {
      if (this.state !== 'new') throw Error('备份dump只能开始一次');
      this.state = 'dump';
      this.dump = { name: names[0], offset: 0, bytes: 0, crc: 0 };
      await this.emit(localHeader(names[0]));
    });
  }
  /** 只复制当前有界片段，等sink接受并核取消后累计dump字节、CRC与SHA。 */

  writeDump(bytes: Uint8Array): Promise<void> {
    return this.exclusive(async () => {
      if (this.state !== 'dump' || !this.dump || !(bytes instanceof Uint8Array) || bytes.length > limits.blockBytes) throw Error('备份dump片段或状态无效');
      const copy = Buffer.from(bytes);
      await this.emit(copy);
      this.dump.crc = crc32(this.dump.crc, copy);
      this.dump.bytes += copy.length;
      this.dumpHash.update(copy);
    });
  }
  /** 后写清单，实际dump声明由模块生成；外部显式声明不一致则拒绝，不静默覆盖。 */

  finish(manifest: DatabaseBackupArchiveManifestInput): Promise<{ dump: DatabaseBackupArchiveDump; archive: { bytes: string; sha256: string }; manifest: DatabaseBackupArchiveManifest }> {
    return this.exclusive(async () => {

      if (this.state !== 'dump' || !this.dump) throw Error('备份dump尚未开始');
      this.state = 'finishing';
      const dump = { entry: 'dump.sql' as const, bytes: String(this.dump.bytes), sha256: this.dumpHash.digest('hex') }, prepared = databaseBackupArchiveManifest(manifest, dump);

      await this.emit(descriptor(this.dump));
      const metadata: Entry = { name: names[1], offset: this.offset, bytes: prepared.bytes.length, crc: crc32(0, prepared.bytes) };
      await this.emit(localHeader(names[1]));

      for (let at = 0; at < prepared.bytes.length; at += limits.blockBytes)await this.emit(prepared.bytes.subarray(at, at + limits.blockBytes));
      await this.emit(descriptor(metadata));

      const directoryOffset = this.offset;
      await this.emit(queryZipDirectory(this.dump));
      await this.emit(queryZipDirectory(metadata));
      await this.emit(queryZipEnd(2, directoryOffset, this.offset - directoryOffset));
      this.state = 'done';

      return { dump, archive: { bytes: String(this.offset), sha256: this.archiveHash.digest('hex') }, manifest: prepared.manifest };

    });
  }
}

/** 有界短读，BigInt先核边界再转长度；reader不能用空片段或超额片段掩盖截断。 */
async function readExact(reader: DatabaseBackupArchiveReader, size: bigint, offset: bigint, length: number, check: () => void): Promise<Buffer> {

  if (!Number.isSafeInteger(length) || length < 0 || length > limits.blockBytes || offset < 0n || offset + BigInt(length) > size) throw Error('备份归档读取边界无效');
  const out = Buffer.alloc(length);
  let filled = 0;

  while (filled < length) {
    check();
    const chunk = await reader.read(offset + BigInt(filled), length - filled);
    check();
    if (!(chunk instanceof Uint8Array) || !chunk.length || chunk.length > length - filled) throw Error('备份归档短读或返回长度无效');
    out.set(chunk, filled);
    filled += chunk.length;
  }
  return out;
}
/** 目录为固定两个名字和唯一ZIP64 extra，逐字节比对复用函数输出，拒绝未支持flag/方法/磁盘/额外字段。 */
async function directoryEntries(size: bigint, read: (offset: bigint, length: number) => Promise<Buffer>): Promise<{ entries: Entry[]; directoryOffset: bigint }> {

  if (size < 98n || size > limits.archiveBytes) throw Error('备份归档总大小无效');
  const tailAt = size - 98n, tail = await read(tailAt, 98);

  if (tail.readUInt32LE(0) !== 0x06064b50 || tail.readBigUInt64LE(4) !== 44n || tail.readUInt32LE(56) !== 0x07064b50 || tail.readUInt32LE(76) !== 0x06054b50) throw Error('备份归档ZIP64/结束记录无效');

  const offset = tail.readBigUInt64LE(48), bytes = tail.readBigUInt64LE(40), expectedBytes = BigInt(names.reduce((n, name) => n + 46 + Buffer.byteLength(name) + 28, 0));

  if (bytes !== expectedBytes || offset + bytes !== tailAt || !tail.equals(queryZipEnd(2, boundedNumber(offset), boundedNumber(bytes)))) throw Error('备份归档目录、条数或尾部不一致');

  const central = await read(offset, boundedNumber(bytes));
  let cursor = 0;
  const entries: Entry[] = [];

  for (const name of names) {
    const length = 46 + Buffer.byteLength(name) + 28, part = central.subarray(cursor, cursor + length), extra = 46 + Buffer.byteLength(name);
    const uncompressed = part.readBigUInt64LE(extra + 4), compressed = part.readBigUInt64LE(extra + 12), at = part.readBigUInt64LE(extra + 20);

    if (uncompressed !== compressed) throw Error('备份归档STORE大小不一致');
    const entry = { name, offset: boundedNumber(at), bytes: boundedNumber(uncompressed, name === names[1] ? BigInt(limits.manifestBytes) : limits.archiveBytes), crc: part.readUInt32LE(16) };

    if (!part.equals(queryZipDirectory(entry))) throw Error('备份归档中央头、名字或ZIP64信息无效');
    entries.push(entry);
    cursor += length;

  }

  let next = 0n;
  for (const entry of entries) {
    const header = localHeader(entry.name);
    if (BigInt(entry.offset) !== next) throw Error('备份归档条目重叠、间隙或偏移无效');
    if (!(await read(next, header.length)).equals(header)) throw Error('备份归档本地头与受控格式不一致');
    next += BigInt(header.length) + BigInt(entry.bytes);
    if (!(await read(next, 24)).equals(descriptor(entry))) throw Error('备份归档签名描述符不一致');
    next += 24n;
  }
  if (next !== offset) throw Error('备份归档存在额外条目或数据');
  return { entries, directoryOffset: offset };
}

/** 严格inspect只读取和散列原字节，不extract或解释SQL；完整性不等于来源可信、锁/资源已证或恢复已验。 */
export async function inspectDatabaseBackupArchive(reader: DatabaseBackupArchiveReader, checkCancelled: () => void = () => { }): Promise<{ manifest: DatabaseBackupArchiveManifest; dump: DatabaseBackupArchiveDump; archive: { bytes: string; sha256: string }; integrity: 'valid'; restoreVerified: false }> {

  checkCancelled();
  const size = reader.size;
  if (typeof size !== 'bigint' || size < 0n || size > limits.archiveBytes) throw Error('备份归档总大小超预算');
  const read = (offset: bigint, length: number) => readExact(reader, size, offset, length, checkCancelled);
  const { entries } = await directoryEntries(size, read);

  const hashes: string[] = [], manifestParts: Buffer[] = [], archiveHash = createHash('sha256');

  for (const entry of entries) {
    let crc = 0;
    const hash = createHash('sha256'), expectedHeader = localHeader(entry.name), header = await read(BigInt(entry.offset), expectedHeader.length);
    if (!header.equals(expectedHeader)) throw Error('备份归档读取期间本地头变化');
    archiveHash.update(header);
    let remaining = BigInt(entry.bytes), at = BigInt(entry.offset + expectedHeader.length);

    while (remaining) {
      const length = boundedNumber(remaining < BigInt(limits.blockBytes) ? remaining : BigInt(limits.blockBytes)), chunk = await read(at, length);
      crc = crc32(crc, chunk);
      hash.update(chunk);
      archiveHash.update(chunk);
      if (entry.name === names[1]) manifestParts.push(chunk);
      remaining -= BigInt(length);
      at += BigInt(length);
    }
    const end = await read(at, 24);
    if (!end.equals(descriptor(entry))) throw Error('备份归档读取期间描述符变化');
    archiveHash.update(end);
    if (crc !== entry.crc) throw Error('备份归档实际数据CRC不一致');
    hashes.push(hash.digest('hex'));

  }

  const manifestBytes = Buffer.concat(manifestParts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(manifestBytes));
  } catch {
    throw Error('备份清单不是受控UTF-8 JSON');
  }

  const { manifest, bytes } = databaseBackupArchiveManifest(parsed);
  if (!bytes.equals(manifestBytes)) throw Error('备份清单JSON存在重复键或非规范表示');
  const dump = { entry: 'dump.sql' as const, bytes: String(entries[0].bytes), sha256: hashes[0] };
  if (manifest.dump.bytes !== dump.bytes || manifest.dump.sha256 !== dump.sha256) throw Error('备份清单与实际dump SHA或大小不一致');
  // 元数据重读与原字段逐字节一致后接入整包散列；dump只流过一次，不拼接局部摘要。

  const expectedDirectory = Buffer.concat(entries.map(entry => queryZipDirectory(entry))), directoryOffset = BigInt(entries[1].offset + localHeader(names[1]).length + entries[1].bytes + 24), directory = await read(directoryOffset, expectedDirectory.length), tail = await read(size - 98n, 98);

  if (!directory.equals(expectedDirectory) || !tail.equals(queryZipEnd(2, boundedNumber(directoryOffset), directory.length))) throw Error('备份归档读取期间目录或尾部变化');
  archiveHash.update(directory);
  archiveHash.update(tail);
  checkCancelled();
  if (reader.size !== size) throw Error('备份归档读取期间大小变化');
  return { manifest, dump, archive: { bytes: String(size), sha256: archiveHash.digest('hex') }, integrity: 'valid', restoreVerified: false };
}
