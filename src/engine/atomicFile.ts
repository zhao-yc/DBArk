import { randomUUID } from 'node:crypto';
import { open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import iconv from 'iconv-lite';
import { encodingName } from './files';

export interface WritableFile {
  write(buffer: Uint8Array, offset: number, length: number): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>; close(): Promise<void>;
}
export interface AtomicFileIO {
  open(path: string): Promise<WritableFile>; rename(source: string, target: string): Promise<void>; remove(path: string): Promise<void>;
}
export const nativeAtomicFileIO: AtomicFileIO = { open: path => open(path, 'wx'), rename, remove: path => rm(path, { force: true }) };
const activeTargets = new Set<string>();

/** 对真实父目录归一化，防止相对路径、大小写或父目录链接绕过同目标互斥。 */
export async function exportTargetKey(target: string): Promise<string> {
  const absolute = resolve(target);
  const canonical = join(await realpath(dirname(absolute)), basename(absolute));
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

/** 同目录独占临时文件、无损编码、短写消费和明确的不可取消替换边界。 */
export class AtomicFile {
  private file?: WritableFile;
  private created = false;
  private disposed = false;
  private committed = false;
  private bytes = 0;
  private pendingBytes = 0;
  private pending: Uint8Array[] = [];
  private readonly temporary: string;
  private key = '';

  /** 构造不进行 IO；只有 open 成功后才拥有临时文件的删除权。 */
  private constructor(private readonly target: string, private readonly encoding: string, private readonly checkCancelled: () => void, private readonly onCommitStart: () => void, private readonly io: AtomicFileIO, private readonly maxBytes: number) {
    this.temporary = `${target}.dbark-${randomUUID()}.partial`;
  }

  /** 创建或取消失败时释放目标锁，绝不删除未由本次 open 创建的文件。 */
  static async create(target: string, encoding: string, checkCancelled: () => void, onCommitStart: () => void, io: AtomicFileIO = nativeAtomicFileIO, maxBytes = 10 * 1024 ** 3): Promise<AtomicFile> {
    const writer = new AtomicFile(target, encodingName(encoding), checkCancelled, onCommitStart, io, maxBytes);
    writer.key = await exportTargetKey(target);
    if (activeTargets.has(writer.key)) throw new Error('目标文件正在由另一个任务写入，请选择其他文件或等待');
    activeTargets.add(writer.key);
    try {
      checkCancelled(); writer.file = await io.open(writer.temporary); writer.created = true; checkCancelled();
      return writer;
    } catch (error) { await writer.dispose(); throw error; }
  }

  /** 字节统计只包含真实完成的磁盘写入，提交标志只在 rename 成功后为真。 */
  get bytesWritten(): number { return this.bytes; }
  get fileCommitted(): boolean { return this.committed; }

  /** 每个片段检查编码往返与总预算，并完整消费操作系统的部分写入。 */
  async write(text: string): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    const buffer = iconv.encode(text, this.encoding);
    if (this.encoding === 'utf16le') {
      try { new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(buffer); }
      catch { throw new Error('所选编码无法无损表示结果中的字符，请改用 JSON 格式'); }
    }
    if (iconv.decode(buffer, this.encoding, { stripBOM: false }) !== text) throw new Error('所选编码无法无损表示结果中的字符，请改用 UTF-8 或 JSON 格式');
    await this.writeBytes(buffer);
  }

  /** 二进制 XLSX 与文本共用预算及短写保护；复制小缓冲，避免调用者改写尚未落盘的数据。 */
  async writeBytes(input: Uint8Array): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    if (this.bytes + this.pendingBytes + input.length > this.maxBytes) throw new Error('完整导出超过文件字节上限，原目标文件保持不变');
    const buffer = Buffer.from(input);
    // 至多 64 KiB 编码缓冲；百万行任务不需要逐行发起系统调用，大行直接有界写入。
    if (this.pendingBytes + buffer.length > 64 * 1024) await this.flush();
    if (buffer.length >= 64 * 1024) await this.writeBuffer(buffer);
    else { this.pending.push(buffer); this.pendingBytes += buffer.length; }
  }

  /** 完整消费一段已编码字节，短写和每次系统调用都在取消边界内。 */
  private async writeBuffer(buffer: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < buffer.length) {
      this.checkCancelled();
      const { bytesWritten } = await this.file!.write(buffer, offset, buffer.length - offset);
      if (!Number.isInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > buffer.length - offset) throw new Error('目标文件无法继续写入');
      offset += bytesWritten; this.bytes += bytesWritten;
    }
  }

  /** 缓冲有固定上限，提交前必须写完，不能把仅进入缓冲区的数据误认为已保存。 */
  private async flush(): Promise<void> {
    if (!this.pendingBytes) return;
    const buffer = Buffer.concat(this.pending, this.pendingBytes);
    this.pending = []; this.pendingBytes = 0; await this.writeBuffer(buffer);
  }

  /** 替换之前允许取消；替换开始后只能报告真实提交结果，不能声称撤销文件。 */
  async commit(): Promise<void> {
    this.checkCancelled();
    if (!this.file || this.disposed || this.committed) throw new Error('文件写入器已关闭');
    await this.flush(); await this.file.sync(); this.checkCancelled(); await this.file.close(); this.file = undefined; this.checkCancelled();
    this.onCommitStart(); await this.io.rename(this.temporary, this.target); this.committed = true;
  }

  /** 幂等关闭，仅清理自己创建且未提交的临时文件；目标锁直到清理结束才释放。 */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = []; this.pendingBytes = 0;
    try { await this.file?.close(); }
    finally {
      this.file = undefined;
      try { if (this.created && !this.committed) await this.io.remove(this.temporary); }
      finally { if (this.key) activeTargets.delete(this.key); }
    }
  }
}
