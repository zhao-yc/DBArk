import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { AtomicFile, nativeAtomicFileIO, type AtomicFileIO } from '../../src/engine/atomicFile';
import { exportExcelFile } from '../../src/engine/excelFiles';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) { for (const file of await readdir(folder)) await rm(join(folder, file)); await rmdir(folder); } });
/** 所有写入测试限定在当前隔离 checkout 的缓存目录。 */
async function target(): Promise<string> { const base = join(process.cwd(), '.cache/f02-excel/tmp'); await mkdir(base, { recursive: true }); const folder = await mkdtemp(join(base, 'stream-')); folders.push(folder); return join(folder, 'output.xlsx'); }

describe('Excel 二进制原子文件', () => {
  it('消费短写并复制调用者缓冲，延迟落盘不受外部修改影响', async () => {
    const path = await target(); let calls = 0;
    const io: AtomicFileIO = { ...nativeAtomicFileIO, async open(file) { const handle = await nativeAtomicFileIO.open(file); return { ...handle, sync: () => handle.sync(), close: () => handle.close(), async write(bytes, offset, length) { calls++; return handle.write(bytes, offset, Math.min(3, length)); } }; } };
    const writer = await AtomicFile.create(path, 'utf8', () => {}, () => {}, io);
    const bytes = Buffer.from([0, 255, 1, 2, 3, 4, 5]); await writer.writeBytes(bytes); bytes.fill(9);
    await writer.commit(); await writer.dispose();
    expect(await readFile(path)).toEqual(Buffer.from([0, 255, 1, 2, 3, 4, 5])); expect(calls).toBe(3);
  });
  it('字节预算和提交前取消都保留旧文件', async () => {
    for (const mode of ['budget', 'cancel']) {
      const path = await target(); await writeFile(path, '原文件'); let cancelled = false;
      const writer = await AtomicFile.create(path, 'utf8', () => { if (cancelled) throw new Error('已取消'); }, () => {}, undefined, 3);
      await writer.writeBytes(Buffer.from([1, 2, 3]));
      if (mode === 'budget') await expect(writer.writeBytes(Buffer.from([4]))).rejects.toThrow('字节上限');
      else { cancelled = true; await expect(writer.commit()).rejects.toThrow('已取消'); }
      await writer.dispose(); expect(await readFile(path, 'utf8')).toBe('原文件'); expect(await readdir(folders.at(-1)!)).toEqual(['output.xlsx']);
    }
  });
});

describe('真实 ExcelJS 流背压与错误释放', () => {
  it('慢磁盘写入时，工作表缓冲保持在单行与高水位预算内', async () => {
    const path = await target(); let peak = 0, produced = 0, atFirstWrite = 0;
    const nativeWrite = PassThrough.prototype.write;
    vi.spyOn(PassThrough.prototype, 'write').mockImplementation(function(this: PassThrough, ...args: Parameters<typeof nativeWrite>) {
      const result = nativeWrite.apply(this, args); peak = Math.max(peak, this.writableLength + this.readableLength); return result;
    });
    const io: AtomicFileIO = { ...nativeAtomicFileIO, async open(file) { const handle = await nativeAtomicFileIO.open(file); return { sync: () => handle.sync(), close: () => handle.close(), async write(bytes, offset, length) { if (!atFirstWrite) atFirstWrite = produced; await new Promise(resolve => setTimeout(resolve, 1)); return handle.write(bytes, offset, length); } }; } };
    async function* rows() { for (let index = 0; index < 400; index++) { produced++; yield [randomBytes(8192).toString('base64')]; } }
    expect((await exportExcelFile({ filePath: path, columns: [{ name: '值', type: 'text' }], rows: rows(), io, onCommitStart() {} })).rows).toBe(400);
    expect(atFirstWrite).toBeLessThan(400); expect(peak).toBeLessThan(512 * 1024);
    await writeFile(join(process.cwd(), '.cache/f02-excel/stream-metrics.json'), JSON.stringify({ rows: 400, peakBufferBytes: peak, rowsAtFirstWrite: atFirstWrite }, null, 2));
  }, 15000);
  it('磁盘写入错误传播并保留旧文件，所有临时文件已关闭后才返回', async () => {
    const path = await target(); await writeFile(path, '旧文件'); let closed = false;
    const io: AtomicFileIO = { ...nativeAtomicFileIO, async open(file) { const handle = await nativeAtomicFileIO.open(file); return { sync: () => handle.sync(), async close() { await handle.close(); closed = true; }, async write() { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('模拟磁盘写入失败'); } }; } };
    async function* rows() { for (let index = 0; index < 200; index++) yield [randomBytes(8192).toString('base64')]; }
    await expect(exportExcelFile({ filePath: path, columns: [{ name: '值', type: 'text' }], rows: rows(), io, onCommitStart() {} })).rejects.toThrow('模拟磁盘写入失败');
    expect(closed).toBe(true); expect(await readFile(path, 'utf8')).toBe('旧文件'); expect(await readdir(folders.at(-1)!)).toEqual(['output.xlsx']);
  });
  it('在背压等待期间取消，等待在途磁盘写入后清理', async () => {
    const path = await target(); await writeFile(path, '旧文件'); let cancelled = false, inFlight = 0;
    const io: AtomicFileIO = { ...nativeAtomicFileIO, async open(file) { const handle = await nativeAtomicFileIO.open(file); return { sync: () => handle.sync(), close: () => handle.close(), async write(bytes, offset, length) { inFlight++; cancelled = true; await new Promise(resolve => setTimeout(resolve, 40)); const result = await handle.write(bytes, offset, length); inFlight--; return result; } }; } };
    async function* rows() { for (let index = 0; index < 300; index++) yield [randomBytes(8192).toString('base64')]; }
    await expect(exportExcelFile({ filePath: path, columns: [{ name: '值', type: 'text' }], rows: rows(), io, onCommitStart() {}, checkCancelled() { if (cancelled) throw new Error('背压中已取消'); } })).rejects.toThrow('已取消');
    expect(inFlight).toBe(0); expect(await readFile(path, 'utf8')).toBe('旧文件'); expect(await readdir(folders.at(-1)!)).toEqual(['output.xlsx']);
  });
});
