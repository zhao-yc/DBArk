import { lstat } from 'node:fs/promises';
import iconv from 'iconv-lite';
import { AtomicFile } from './atomicFile';
import { encodingName } from './files';
import { queryCsvResultFile, queryStreamExportLimits as limits, type QueryExportColumn, type QueryExportFrame } from '../shared/queryStreamExport';
import type { QueryFileEncoding } from '../shared/contracts';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); return value >>> 0; });
/** CRC按当前片段递增，既不读回临时包，也不保留已经消费的CSV行。 */
function crc32(previous: number, bytes: Uint8Array): number { let value = previous ^ 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
interface ZipEntry { name: string; offset: number; bytes: number; crc: number; }

/** ZIP64目录保留64位大小及偏移；小文件也使用同一标准格式，跨4GiB不改变流协议。 */
export function queryZipDirectory(entry: Readonly<ZipEntry>): Buffer {
  const name = Buffer.from(entry.name, 'utf8'), header = Buffer.alloc(46 + name.length + 28);
  header.writeUInt32LE(0x02014b50); header.writeUInt16LE(45, 4); header.writeUInt16LE(45, 6); header.writeUInt16LE(0x0808, 8); header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(entry.crc, 16); header.writeUInt32LE(0xffffffff, 20); header.writeUInt32LE(0xffffffff, 24); header.writeUInt16LE(name.length, 28); header.writeUInt16LE(28, 30); header.writeUInt32LE(0xffffffff, 42); name.copy(header, 46);
  const extra = 46 + name.length; header.writeUInt16LE(1, extra); header.writeUInt16LE(24, extra + 2); header.writeBigUInt64LE(BigInt(entry.bytes), extra + 4); header.writeBigUInt64LE(BigInt(entry.bytes), extra + 12); header.writeBigUInt64LE(BigInt(entry.offset), extra + 20);
  return header;
}
/** ZIP64结束记录与定位器后仍包含标准EOCD，外部解压器无需DBArk即可读取。 */
export function queryZipEnd(count: number, directoryOffset: number, directoryBytes: number): Buffer {
  const end = Buffer.alloc(98); end.writeUInt32LE(0x06064b50); end.writeBigUInt64LE(44n, 4); end.writeUInt16LE(45, 12); end.writeUInt16LE(45, 14); end.writeBigUInt64LE(BigInt(count), 24); end.writeBigUInt64LE(BigInt(count), 32); end.writeBigUInt64LE(BigInt(directoryBytes), 40); end.writeBigUInt64LE(BigInt(directoryOffset), 48);
  end.writeUInt32LE(0x07064b50, 56); end.writeBigUInt64LE(BigInt(directoryOffset + directoryBytes), 64); end.writeUInt32LE(1, 72);
  end.writeUInt32LE(0x06054b50, 76); end.writeUInt16LE(count, 84); end.writeUInt16LE(count, 86); end.writeUInt32LE(0xffffffff, 88); end.writeUInt32LE(0xffffffff, 92);
  return end;
}

/** 创建之前核对完整固定命名空间和目标类型；目录、链接或其它任务的目标不能等执行SQL后才发现。 */
export async function prepareQueryCsvZip(target: string, checkCancelled: () => void): Promise<void> {
  checkCancelled(); const names = ['manifest.json', ...Array.from({ length: limits.results }, (_, index) => queryCsvResultFile(index + 1))];
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length || names.some(name => !/^(?:manifest\.json|results\/rows-\d{3}\.csv)$/.test(name))) throw new Error('CSV容器文件名不安全或重复');
  try { const status = await lstat(target); if (!status.isFile() || status.isSymbolicLink()) throw new Error('CSV容器目标必须是普通文件，不能是目录或链接'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  checkCancelled();
}

/** STORE和带签名数据描述符实现顺序ZIP64；只留至多201条有界目录，不压缩或缓存结果数据。 */
class QueryZipWriter {
  private offset = 0;
  private active?: ZipEntry;
  private readonly entries: ZipEntry[] = [];
  constructor(private readonly file: AtomicFile, private readonly checkCancelled: () => void) {}
  /** 所有结构与数据都经同一原子文件的短写、取消和10GiB预算路径。 */
  private async emit(bytes: Uint8Array): Promise<void> { this.checkCancelled(); await this.file.writeBytes(bytes); this.offset += bytes.length; }
  /** 本地头使用STORE、UTF-8名称和数据描述符；未知大小先放ZIP64占位，结尾再给实际值。 */
  async start(name: string): Promise<void> {
    if (this.active || this.entries.length >= limits.results + 1 || this.entries.some(entry => entry.name === name)) throw new Error('CSV容器文件边界或名称无效');
    const path = Buffer.from(name, 'utf8'), header = Buffer.alloc(30 + path.length + 20); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(45, 4); header.writeUInt16LE(0x0808, 6); header.writeUInt16LE(0x21, 12); header.writeUInt32LE(0xffffffff, 18); header.writeUInt32LE(0xffffffff, 22); header.writeUInt16LE(path.length, 26); header.writeUInt16LE(20, 28); path.copy(header, 30); header.writeUInt16LE(1, 30 + path.length); header.writeUInt16LE(16, 32 + path.length);
    this.active = { name, offset: this.offset, bytes: 0, crc: 0 }; await this.emit(header);
  }
  /** 消费者必须等待这次写入结束，磁盘背压才能传回同一个驱动命令。 */
  async write(bytes: Uint8Array): Promise<void> { if (!this.active) throw new Error('CSV容器没有活动文件'); this.active.crc = crc32(this.active.crc, bytes); await this.emit(bytes); this.active.bytes += bytes.length; }
  /** 带签名描述符封闭当前文件，目录仅保存CRC、字节数和偏移。 */
  async end(): Promise<number> {
    const entry = this.active; if (!entry) throw new Error('CSV容器文件尚未开始');
    const descriptor = Buffer.alloc(24); descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(entry.crc, 4); descriptor.writeBigUInt64LE(BigInt(entry.bytes), 8); descriptor.writeBigUInt64LE(BigInt(entry.bytes), 16); await this.emit(descriptor); this.entries.push(entry); this.active = undefined; return entry.bytes;
  }
  /** 清单结束后写中央目录与ZIP64尾部；完成此步之后外层才允许原子提交。 */
  async complete(): Promise<void> { if (this.active) throw new Error('CSV容器文件尚未结束'); const at = this.offset; for (const entry of this.entries) await this.emit(queryZipDirectory(entry)); await this.emit(queryZipEnd(this.entries.length, at, this.offset - at)); }
}

type RowManifest = { kind: 'rows'; resultOrdinal: number; statementOrdinal: number; rowResultOrdinal: number; file: string; columns: Omit<QueryExportColumn, 'key'>[]; rowsWritten: number; bytes: number; warningCount?: number };
type StatusFrame = Extract<QueryExportFrame, { kind: 'status' }>;
/** 清单只持有有界结构和计数；CSV复用既有NULL、反斜线、Base64及精度字符串约定。 */
export class QueryCsvArchive {
  private readonly zip: QueryZipWriter;
  private readonly results: (RowManifest | StatusFrame)[] = [];
  private active?: RowManifest;
  private metadataBytes = 1024;
  constructor(file: AtomicFile, private readonly encoding: QueryFileEncoding, private readonly checkCancelled: () => void) { encodingName(encoding); this.zip = new QueryZipWriter(file, checkCancelled); }
  /** 每个CSV独立编码，UTF-16LE逐文件写BOM；包本身与清单不受CSV编码影响。 */
  async text(text: string): Promise<void> {
    this.checkCancelled(); const bytes = iconv.encode(text, this.encoding);
    if (iconv.decode(bytes, this.encoding, { stripBOM: false }) !== text) throw new Error('所选CSV编码无法无损表示结果中的字符，请改用UTF-8或JSON格式');
    if (this.encoding === 'utf16le') { try { new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new Error('所选CSV编码无法无损表示结果中的字符，请改用JSON格式'); } }
    await this.zip.write(bytes);
  }
  /** 结构预算在保留列描述之前检查，行数据从不加入清单。 */
  private retain(result: RowManifest | StatusFrame): void { const size = Buffer.byteLength(JSON.stringify(result)) + 128; if (this.results.length >= limits.results || this.metadataBytes + size > limits.archiveManifestBytes) throw new Error('CSV容器清单超过8MiB或200个结果，原目标文件保持不变'); this.metadataBytes += size; this.results.push(result); }
  /** 仅使用已经验证的位置列与有界序号，开始当前CSV并独立处理BOM。 */
  async start(frame: Extract<QueryExportFrame, { kind: 'rows-start' }>, columns: QueryExportColumn[]): Promise<void> {
    if (this.active) throw new Error('CSV容器上一个行集尚未结束');
    const result: RowManifest = { kind: 'rows', resultOrdinal: frame.resultOrdinal, statementOrdinal: frame.statementOrdinal, rowResultOrdinal: frame.rowResultOrdinal, file: queryCsvResultFile(frame.rowResultOrdinal), columns: columns.map(({ key: _key, ...column }) => column), rowsWritten: 0, bytes: 0 };
    this.retain(result); this.active = result; await this.zip.start(result.file); if (this.encoding === 'utf16le') await this.text('\uFEFF');
  }
  /** 空集也已写入标题；最终行数、字节数及警告归属当前行集。 */
  async end(rowsWritten: number, warningCount?: number): Promise<void> { if (!this.active) throw new Error('CSV容器行集尚未开始'); this.active.rowsWritten = rowsWritten; if (warningCount !== undefined) this.active.warningCount = warningCount; this.active.bytes = await this.zip.end(); this.active = undefined; }
  /** 非行集在原协议顺序占位，影响行数和插入编号只进清单，不伪造CSV。 */
  status(frame: StatusFrame): void { this.retain({ ...frame }); }
  /** 完整执行后追加UTF-8清单并封闭ZIP；不缓存、压缩或重新读取任何结果行。 */
  async complete(): Promise<void> {
    if (this.active) throw new Error('CSV容器行集尚未结束');
    const manifest = JSON.stringify({ format: 'DBArk-query-csv-archive', version: 1, encoding: this.encoding, csv: { delimiter: ',', recordDelimiter: '\r\n', null: '\\N', leadingBackslash: 'double', binary: 'base64:', header: 'exportName', columnOrder: 'position' }, results: this.results }) + '\n';
    if (Buffer.byteLength(manifest) > limits.archiveManifestBytes) throw new Error('CSV容器清单超过8MiB，原目标文件保持不变');
    await this.zip.start('manifest.json'); await this.zip.write(Buffer.from(manifest, 'utf8')); await this.zip.end(); await this.zip.complete();
  }
}
