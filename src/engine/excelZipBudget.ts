import { open, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { EXCEL_LIMITS } from '../shared/excelTransfer';

export interface ExcelZipEntry { name: string; compressed: number; expanded: number; crc: number; method: number; flags: number; offset: number; start: number; end: number; }
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

/** ZIP 的 CRC32 对实际解压数据计算，不采用目录宣称的完整性结果。 */
export function excelCrc32(buffer: Uint8Array, initial = 0xffffffff): number {
  let value = initial;
  for (const byte of buffer) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return value >>> 0;
}

/** 仅接受普通相对 OPC 路径，不把 ZIP 内容释放到磁盘路径。 */
function safeEntryName(name: string): boolean {
  return !!name && name.length <= 1024 && !/[\\\u0000-\u001f:]/.test(name) && !name.startsWith('/') && name.split('/').every(part => part !== '..' && part !== '.');
}

/** 固定句柄随机读取，严格处理短读；外部文件发生替换也不会切换到新路径。 */
async function readExact(file: FileHandle, offset: number, length: number): Promise<Buffer> {
  const output = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const result = await file.read(output, read, length - read, offset + read);
    if (!result.bytesRead) throw new Error('XLSX 文件被截断或已发生变化');
    read += result.bytesRead;
  }
  return output;
}

/** 有界 ZIP 读取器：只接受单磁盘 ZIP32 的 stored/deflate，所有实际展开均执行预算和 CRC 校验。 */
export class ExcelZipArchive {
  readonly entries = new Map<string, ExcelZipEntry>();
  private closed = false;
  private active = false;
  private identity = '';

  private constructor(private readonly file: FileHandle, private readonly checkCancelled: () => void) {}

  /** 目录最多 2048 项，ZIP64、加密、重名与区段重叠均明确拒绝。 */
  static async open(path: string, checkCancelled: () => void = () => undefined): Promise<ExcelZipArchive> {
    checkCancelled();
    const file = await open(path, 'r');
    const archive = new ExcelZipArchive(file, checkCancelled);
    try { await archive.readDirectory(); return archive; }
    catch (error) { await file.close(); throw error; }
  }

  /** 时间戳和尺寸检测同句柄的原地改写，CRC 再验证每个实际读取的 entry。 */
  async assertUnchanged(): Promise<void> {
    this.checkCancelled();
    const stat = await this.file.stat({ bigint: true });
    const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (this.identity && this.identity !== identity) throw new Error('XLSX 文件在读取期间发生变化，请重新选择');
    this.identity = identity;
  }

  private async readDirectory(): Promise<void> {
    await this.assertUnchanged();
    const stat = await this.file.stat();
    if (!stat.isFile() || stat.size < 22 || stat.size > EXCEL_LIMITS.maxCompressedBytes) throw new Error('XLSX 文件大小超出范围（最大 256 MiB）');
    const tailSize = Math.min(stat.size, 65_557), tailStart = stat.size - tailSize;
    const tail = await readExact(this.file, tailStart, tailSize);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { end = index; break; }
    }
    if (end < 0) throw new Error('文件不是完整的 XLSX ZIP 工作簿');
    const count = tail.readUInt16LE(end + 10), size = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count === 0xffff || offset === 0xffffffff || size === 0xffffffff) throw new Error('不支持多磁盘或 ZIP64 工作簿');
    if (!count || count > EXCEL_LIMITS.maxEntries || size > 4 * 1024 ** 2 || offset + size !== tailStart + end) throw new Error('XLSX ZIP 目录超限或损坏');
    const directory = await readExact(this.file, offset, size);
    let cursor = 0, declaredExpanded = 0;
    for (let index = 0; index < count; index++) {
      this.checkCancelled();
      if (cursor + 46 > size || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('XLSX ZIP 目录记录损坏');
      const flags = directory.readUInt16LE(cursor + 8), method = directory.readUInt16LE(cursor + 10);
      const crc = directory.readUInt32LE(cursor + 16), compressed = directory.readUInt32LE(cursor + 20), expanded = directory.readUInt32LE(cursor + 24);
      const nameSize = directory.readUInt16LE(cursor + 28), extraSize = directory.readUInt16LE(cursor + 30), commentSize = directory.readUInt16LE(cursor + 32), localOffset = directory.readUInt32LE(cursor + 42);
      const next = cursor + 46 + nameSize + extraSize + commentSize;
      if (next > size || directory.readUInt16LE(cursor + 34) || (flags & ~0x080e) || ![0, 8].includes(method) || [compressed, expanded, localOffset].includes(0xffffffff)) throw new Error('不支持加密、ZIP64 或特殊压缩的 XLSX 文件');
      const nameBytes = directory.subarray(cursor + 46, cursor + 46 + nameSize);
      let name: string;
      try { name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch { throw new Error('XLSX ZIP 文件名编码无效'); }
      if (!safeEntryName(name) || this.entries.has(name)) throw new Error('XLSX ZIP 包含不安全或重复的文件名');
      if (expanded > EXCEL_LIMITS.maxEntryBytes || (declaredExpanded += expanded) > EXCEL_LIMITS.maxExpandedBytes) throw new Error('XLSX 展开大小超限');
      if (localOffset + 30 > offset) throw new Error('XLSX 本地文件头位置无效');
      const local = await readExact(this.file, localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameSize) throw new Error('XLSX 本地文件头与目录不一致');
      const localName = await readExact(this.file, localOffset + 30, nameSize);
      if (!localName.equals(nameBytes)) throw new Error('XLSX 本地文件名与目录不一致');
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressed || local.readUInt32LE(22) !== expanded)) throw new Error('XLSX 本地文件大小与目录不一致');
      const start = localOffset + 30 + nameSize + local.readUInt16LE(28), dataEnd = start + compressed;
      if (dataEnd > offset) throw new Error('XLSX entry 数据范围越界');
      let entryEnd = dataEnd;
      if (flags & 8) {
        if (dataEnd + 12 > offset) throw new Error('XLSX 数据描述记录被截断');
        const prefix = await readExact(this.file, dataEnd, 4);
        const descriptorStart = dataEnd + (prefix.readUInt32LE(0) === 0x08074b50 ? 4 : 0);
        if (descriptorStart + 12 > offset) throw new Error('XLSX 数据描述记录被截断');
        const descriptor = await readExact(this.file, descriptorStart, 12);
        if (descriptor.readUInt32LE(0) !== crc || descriptor.readUInt32LE(4) !== compressed || descriptor.readUInt32LE(8) !== expanded) throw new Error('XLSX 数据描述与目录不一致');
        entryEnd = descriptorStart + 12;
      }
      this.entries.set(name, { name, compressed, expanded, crc, method, flags, offset: localOffset, start, end: entryEnd });
      cursor = next;
    }
    if (cursor !== size) throw new Error('XLSX ZIP 目录尾部无效');
    let previousEnd = 0;
    for (const entry of [...this.entries.values()].sort((a, b) => a.offset - b.offset)) {
      if (entry.offset < previousEnd) throw new Error('XLSX ZIP entry 区段重叠');
      previousEnd = entry.end;
    }
    await this.assertUnchanged();
  }

  /** 每次读取单 entry，inflate 输出块至多 32 KiB；提前退出时等待真实流关闭再返回。 */
  async *read(name: string): AsyncGenerator<Buffer> {
    if (this.closed || this.active) throw new Error('XLSX ZIP 读取器已关闭或正在读取');
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`XLSX 缺少必要文件：${name}`);
    this.active = true;
    let source: Readable | undefined, inflated: ReturnType<typeof createInflateRaw> | undefined, completion: Promise<void> | undefined, sourceDone: Promise<void> | undefined;
    try {
      await this.assertUnchanged();
      // 不使用 FileHandle.createReadStream：提前 destroy 会关闭共享句柄。只读固定偏移块，流不拥有句柄。
      const file = this.file, check = this.checkCancelled;
      async function* chunks(): AsyncGenerator<Buffer> {
        for (let offset = 0; offset < entry!.compressed; offset += 32 * 1024) {
          check(); yield await readExact(file, entry!.start + offset, Math.min(32 * 1024, entry!.compressed - offset));
        }
      }
      source = Readable.from(chunks(), { highWaterMark: 32 * 1024, objectMode: false });
      sourceDone = finished(source, { cleanup: true }); void sourceDone.catch(() => undefined);
      const output = entry.method === 8 ? (inflated = createInflateRaw({ chunkSize: 32 * 1024 })) : source;
      if (inflated) { completion = pipeline(source, inflated); void completion.catch(() => undefined); }
      let count = 0, crc = 0xffffffff;
      for await (const chunk of output) {
        this.checkCancelled();
        count += chunk.length;
        if (count > EXCEL_LIMITS.maxEntryBytes || count > entry.expanded) throw new Error('XLSX 实际展开大小超过预算或目录声明');
        crc = excelCrc32(chunk, crc);
        yield chunk;
      }
      if (completion) await completion;
      if (count !== entry.expanded || ((crc ^ 0xffffffff) >>> 0) !== entry.crc || (inflated && inflated.bytesWritten !== entry.compressed)) throw new Error('XLSX entry 长度或 CRC 校验失败');
      await this.assertUnchanged();
    } finally {
      source?.destroy(); inflated?.destroy();
      if (completion) await completion.catch(() => undefined);
      if (sourceDone) await sourceDone.catch(() => undefined);
      this.active = false;
    }
  }

  /** 未使用的工作表和附件也校验实际展开量，不能靠伪造 ZIP 目录绕过整个包的预算。 */
  async audit(): Promise<void> {
    let actual = 0;
    for (const name of this.entries.keys()) for await (const chunk of this.read(name)) {
      actual += chunk.length;
      if (actual > EXCEL_LIMITS.maxExpandedBytes) throw new Error('XLSX 实际总展开大小超过 512 MiB');
    }
  }

  /** 预览与正式导入之间使用完整压缩文件的 SHA256 绑定，不依赖可伪造的 CRC 或时间戳。 */
  async fingerprint(): Promise<string> {
    await this.assertUnchanged();
    const hash = createHash('sha256'), size = Number((await this.file.stat()).size);
    for (let offset = 0; offset < size; offset += 64 * 1024) {
      this.checkCancelled(); hash.update(await readExact(this.file, offset, Math.min(64 * 1024, size - offset)));
    }
    await this.assertUnchanged(); return hash.digest('hex');
  }

  /** 只能在迭代结束后关闭，取消调用方必须先结束迭代，再等待句柄释放。 */
  async close(): Promise<void> { if (!this.closed) { this.closed = true; await this.file.close(); } }
}
