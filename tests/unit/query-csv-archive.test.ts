import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Types } from 'mysql2';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { createQueryStreamFile, type QueryStreamFileOptions } from '../../src/engine/queryStreamFile';
import { queryZipDirectory, queryZipEnd } from '../../src/engine/queryCsvZip';
import type { AtomicFileIO } from '../../src/engine/atomicFile';
import type { ManagedConnection } from '../../src/engine/connection';
import { consumeQueryFrames } from '../../src/engine/queryStreamProtocol';
import { resultExportColumns } from '../../src/shared/resultExport';
import { queryCsvResultFile, queryStreamExportLimits, type QueryExportFrame } from '../../src/shared/queryStreamExport';
import { decodeQueryCsvZip, readQueryCsvZip } from '../helpers/queryCsvZip';

const directories: string[] = [];
afterEach(async () => { for (const path of directories.splice(0)) { for (const name of await readdir(path)) { const file = join(path, name); if (name === 'directory') await rmdir(file); else await rm(file); } await rmdir(path); } });
/** 每项保留真实旧文件，用磁盘字节与独立解包器判定提交，避免只测写入器内存。 */
async function options(overrides: Partial<QueryStreamFileOptions> = {}): Promise<QueryStreamFileOptions> { const path = await mkdtemp(join(tmpdir(), 'dbark-csv-zip-')); directories.push(path); const filePath = join(path, 'all.zip'); await writeFile(filePath, '旧文件'); return { filePath, format: 'csv-zip', encoding: 'utf8', resultSelection: { kind: 'all' }, checkCancelled() {}, onCommitStart() {}, ...overrides }; }
function start(resultOrdinal: number, rowResultOrdinal: number, names = ['值'], statementOrdinal = resultOrdinal): Extract<QueryExportFrame, { kind: 'rows-start' }> { return { kind: 'rows-start', resultOrdinal, rowResultOrdinal, statementOrdinal, columns: resultExportColumns(names.map((name, index) => ({ key: `c${index}`, name }))).map((column, index) => ({ ...column, position: index + 1, type: 'VAR_STRING' })) }; }
function disk(overrides: Partial<AtomicFileIO> = {}): AtomicFileIO { return { open: path => open(path, 'wx'), rename, remove: path => rm(path, { force: true }), ...overrides }; }
async function rows(writer: Awaited<ReturnType<typeof createQueryStreamFile>>, resultOrdinal: number, rowResultOrdinal: number, values?: Extract<QueryExportFrame, { kind: 'row' }>['values']) { await writer.write(start(resultOrdinal, rowResultOrdinal)); if (values) await writer.write({ kind: 'row', resultOrdinal, values }); await writer.write({ kind: 'rows-end', resultOrdinal }); }

describe('一次新执行的多CSV ZIP64容器', () => {
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s逐行集保存空集、重复列与精确位置，清单固定UTF-8且状态不占CSV序号', async encoding => {
    const input = await options({ encoding }), writer = await createQueryStreamFile(input);
    try {
      await rows(writer, 1, 1);
      await writer.write({ kind: 'status', resultOrdinal: 2, statementOrdinal: 2, affectedRows: 2, insertId: '18446744073709551615', warningCount: 3 });
      const names = ['值', '值', '值 [2]', '', '__proto__', '字节', '日期', '空串', '反斜线', '../manifest.json'];
      await writer.write(start(3, 2, names)); const values = ['18446744073709551615', '0.12345678901234567890', null, '中文😊', '原型', { type: 'binary' as const, base64: 'AAH/' }, '2026-10-16 01:02:03.123456', '', '\\N', '无路径'];
      await writer.write({ kind: 'row', resultOrdinal: 3, values }); await writer.write({ kind: 'rows-end', resultOrdinal: 3, warningCount: 1 }); await writer.complete();
      const files = await readQueryCsvZip(input.filePath); expect([...files.keys()]).toEqual([queryCsvResultFile(1), queryCsvResultFile(2), 'manifest.json']);
      const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')); expect(manifest).toMatchObject({ format: 'DBArk-query-csv-archive', version: 1, encoding });
      expect(manifest.results.map((result: any) => [result.kind, result.resultOrdinal, result.statementOrdinal, result.rowResultOrdinal, result.rowsWritten])).toEqual([['rows', 1, 1, 1, 0], ['status', 2, 2, undefined, undefined], ['rows', 3, 3, 2, 1]]);
      expect(manifest.results[1]).toMatchObject({ affectedRows: 2, insertId: '18446744073709551615', warningCount: 3 }); expect(manifest.results[2].warningCount).toBe(1); expect(Object.hasOwn(manifest.results[0], 'warningCount')).toBe(false);
      expect(manifest.results[2].columns.map((column: any) => column.name)).toEqual(names); expect(manifest.results[2].columns.map((column: any) => column.exportName)).toEqual(['值', '值 [3]', '值 [2]', '列 [4]', '__proto__', '字节', '日期', '空串', '反斜线', '../manifest.json']); expect(manifest.results[2].columns.every((column: any) => !Object.hasOwn(column, 'key'))).toBe(true);
      expect(parse(iconv.decode(files.get(queryCsvResultFile(1))!, encoding))).toEqual([['值']]);
      const csv = parse(iconv.decode(files.get(queryCsvResultFile(2))!, encoding)); expect(csv[1]).toEqual(['18446744073709551615', '0.12345678901234567890', '\\N', '中文😊', '原型', 'base64:AAH/', '2026-10-16 01:02:03.123456', '', '\\\\N', '无路径']);
      for (const result of manifest.results.filter((item: any) => item.kind === 'rows')) expect(result.bytes).toBe(files.get(result.file)!.length);
      if (encoding === 'utf16le') for (const name of [queryCsvResultFile(1), queryCsvResultFile(2)]) expect(files.get(name)!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
      expect(writer.rowsWritten).toBe(1); expect(writer.fileCommitted).toBe(true); expect(writer.bytesWritten).toBe((await readFile(input.filePath)).length);
    } finally { await writer.abort(); } expect(await readdir(directories.at(-1)!)).toEqual(['all.zip']);
  });
  it('只有非行集也交付清单，并保存200个空行集而不合并边界', async () => {
    const input = await options(), writer = await createQueryStreamFile(input); try { await writer.write({ kind: 'status', resultOrdinal: 1, statementOrdinal: 1, affectedRows: 0, insertId: '0', warningCount: 0 }); await writer.complete(); } finally { await writer.abort(); }
    expect([...((await readQueryCsvZip(input.filePath)).keys())]).toEqual(['manifest.json']);
    const next = await options(), many = await createQueryStreamFile(next); try { for (let ordinal = 1; ordinal <= 200; ordinal++) await rows(many, ordinal, ordinal); await many.complete(); } finally { await many.abort(); }
    const files = await readQueryCsvZip(next.filePath); expect(files.size).toBe(201); expect(JSON.parse(files.get('manifest.json')!.toString()).results).toHaveLength(200);
  });
  it('ZIP64结构保留超过4GiB的真实64位大小和偏移，不发生32位截断', () => {
    const directory = queryZipDirectory({ name: 'x', bytes: 5 * 1024 ** 3, offset: 6 * 1024 ** 3, crc: 0x12345678 }), extra = 47;
    expect(directory.readUInt32LE(20)).toBe(0xffffffff); expect(directory.readUInt32LE(42)).toBe(0xffffffff); expect(directory.readBigUInt64LE(extra + 4)).toBe(5n * 1024n ** 3n); expect(directory.readBigUInt64LE(extra + 20)).toBe(6n * 1024n ** 3n);
    const end = queryZipEnd(201, 7 * 1024 ** 3, 12345); expect(end.readBigUInt64LE(48)).toBe(7n * 1024n ** 3n); expect(end.readBigUInt64LE(64)).toBe(7n * 1024n ** 3n + 12345n); expect(end.readUInt32LE(76)).toBe(0x06054b50);
  });
  it('数据损坏被独立CRC检查发现，不能仅凭清单或完成标志宣称文件正确', async () => {
    const input = await options(), writer = await createQueryStreamFile(input); try { await rows(writer, 1, 1, ['校验原值']); await writer.complete(); } finally { await writer.abort(); }
    const data = await readFile(input.filePath), at = data.indexOf(Buffer.from('校验原值')); expect(at).toBeGreaterThan(0); data[at] ^= 1; expect(() => decodeQueryCsvZip(data)).toThrow('CRC');
  });
  it('真实帧消费者等待慢磁盘后才读取后续行集，单次命令保持一行背压', async () => {
    let release!: () => void, entered!: () => void; const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
    const input = await options(), writer = await createQueryStreamFile(input, disk({ open: async path => { const file = await open(path, 'wx'); let first = true; return { write: async (bytes, at, length) => { if (first) { first = false; entered(); await gate; } return file.write(bytes, at, length); }, sync: () => file.sync(), close: () => file.close() }; } }));
    const command = new EventEmitter(), connection = new EventEmitter() as ManagedConnection['connection'];
    const packets: [string, ...unknown[]][] = [['fields', [{ name: 'first', columnType: Types.VAR_STRING }], 0], ['result', ['x'.repeat(128 * 1024)], 0], ['fields', [{ name: 'second', columnType: Types.VAR_STRING }], 1], ['result', ['末行'], 1], ['result', { affectedRows: 0, insertId: 0, warningStatus: 0 }, 2], ['end']];
    let paused = false, pumping = false, sends = 0; const peaks: number[] = [];
    const pump = () => { if (pumping) return; pumping = true; try { while (!paused && packets.length) { const [event, ...args] = packets.shift()!; command.emit(event, ...args); } } finally { pumping = false; } };
    connection.pause = () => { paused = true; }; connection.resume = () => { paused = false; pump(); };
    connection.query = (() => { sends++; queueMicrotask(pump); return command; }) as unknown as typeof connection.query;
    const running = consumeQueryFrames({ connection, broken: false } as ManagedConnection, 'CALL same_execution()', 'text', { statementOrdinal: 1, ordinals: { results: 0, rows: 0 }, consume: frame => writer.write(frame), checkCancelled() {}, queuePeak: count => peaks.push(count), stop: async () => { packets.splice(0, packets.length, ['end']); } });
    try { await ready; expect(packets[0][0]).toBe('fields'); expect(paused).toBe(true); expect(writer.rowsWritten).toBe(0); expect(await readFile(input.filePath, 'utf8')).toBe('旧文件'); }
    finally { release(); }
    try { await running; await writer.complete(); } finally { await writer.abort(); }
    expect(sends).toBe(1); expect(peaks).toEqual([1, 1]); expect(connection.listenerCount('error')).toBe(0); expect(command.listenerCount('result')).toBe(0); const files = await readQueryCsvZip(input.filePath); expect(files.size).toBe(3); expect(JSON.parse(files.get('manifest.json')!.toString()).results.map((result: any) => result.kind)).toEqual(['rows', 'rows', 'status']);
  });
  it('准备阶段拒绝错误选择、目录及不存在父目录，取消不创建partial', async () => {
    const input = await options(); await expect(createQueryStreamFile({ ...input, resultSelection: { kind: 'row-result', ordinal: 1 } })).rejects.toThrow('全部');
    const path = join(directories.at(-1)!, 'directory'); await mkdir(path); await expect(createQueryStreamFile({ ...input, filePath: path })).rejects.toThrow('普通文件');
    await expect(createQueryStreamFile({ ...input, filePath: join(path, 'missing', 'x.zip') })).rejects.toThrow(); await expect(createQueryStreamFile({ ...input, checkCancelled() { throw Error('已取消'); } })).rejects.toThrow('已取消');
    expect((await readdir(directories.at(-1)!)).sort()).toEqual(['all.zip', 'directory']); expect(await readFile(input.filePath, 'utf8')).toBe('旧文件');
  });
  it('同目标冲突在开始SQL之前拒绝，只释放本任务锁和partial', async () => {
    const input = await options(), writer = await createQueryStreamFile(input); try { await expect(createQueryStreamFile({ ...input, filePath: join(directories.at(-1)!, '.', 'all.zip') })).rejects.toThrow('另一个任务'); expect(await readdir(directories.at(-1)!)).toHaveLength(2); } finally { await writer.abort(); }
    const next = await createQueryStreamFile(input); await next.abort(); expect(await readdir(directories.at(-1)!)).toEqual(['all.zip']);
  });
  it.each(['cancel', 'disk', 'rename', 'encoding', 'unfinished'] as const)('%s在已经消费多个行集后保留旧文件并清理容器', async fault => {
    let cancelled = false; const input = await options({ checkCancelled() { if (cancelled) throw Error('已取消'); } }); let writes = 0;
    const writer = await createQueryStreamFile(input, disk({ open: async path => { const file = await open(path, 'wx'); return { write: async (buffer, at, length) => { writes++; if (fault === 'disk' && writes > 1) throw Error('磁盘已满'); return file.write(buffer, at, Math.min(4096, length)); }, sync: () => file.sync(), close: () => file.close() }; }, rename: fault === 'rename' ? async () => { throw Error('拒绝替换'); } : rename }));
    try {
      await rows(writer, 1, 1, ['首行']); await writer.write(start(2, 2));
      if (fault === 'cancel') cancelled = true;
      if (fault === 'encoding') await expect(writer.write({ kind: 'row', resultOrdinal: 2, values: ['\uD800'] })).rejects.toThrow('无法无损');
      else if (fault === 'disk') await expect(writer.write({ kind: 'row', resultOrdinal: 2, values: ['x'.repeat(128 * 1024)] })).rejects.toThrow('磁盘已满');
      else if (fault === 'cancel') await expect(writer.write({ kind: 'row', resultOrdinal: 2, values: ['迟到行'] })).rejects.toThrow('已取消');
      else if (fault === 'unfinished') await expect(writer.complete()).rejects.toThrow('尚未结束');
      else { await writer.write({ kind: 'rows-end', resultOrdinal: 2 }); await expect(writer.complete()).rejects.toThrow('拒绝替换'); }
    } finally { await writer.abort(); }
    expect(await readFile(input.filePath, 'utf8')).toBe('旧文件'); expect(await readdir(directories.at(-1)!)).toEqual(['all.zip']);
  });
  it('短写仍完成有效ZIP；替换开始后晚到取消不伪造撤销', async () => {
    let cancelled = false, committed = false; const input = await options({ checkCancelled() { if (cancelled && !committed) throw Error('已取消'); }, onCommitStart() { committed = true; } });
    const writer = await createQueryStreamFile(input, disk({ open: async path => { const file = await open(path, 'wx'); return { write: (bytes, at, length) => file.write(bytes, at, Math.min(3, length)), sync: () => file.sync(), close: () => file.close() }; }, rename: async (from, to) => { expect((await readQueryCsvZip(from)).size).toBe(2); expect(await readFile(to, 'utf8')).toBe('旧文件'); cancelled = true; await rename(from, to); } }));
    try { await rows(writer, 1, 1, ['完整值']); await writer.complete(); expect(writer.fileCommitted).toBe(true); } finally { await writer.abort(); } expect((await readQueryCsvZip(input.filePath)).size).toBe(2);
  });
  it('清单累计预算先于无界保留拒绝，不把列名用作包内路径', async () => {
    const input = await options(), writer = await createQueryStreamFile(input), names = Array.from({ length: 1024 }, (_, index) => '列' + index + 'x'.repeat(1000));
    try { await expect((async () => { for (let ordinal = 1; ordinal <= 10; ordinal++) { await writer.write(start(ordinal, ordinal, names)); await writer.write({ kind: 'rows-end', resultOrdinal: ordinal }); } })()).rejects.toThrow('清单超过8MiB'); } finally { await writer.abort(); }
    expect(queryStreamExportLimits.fileBytes).toBe(10 * 1024 ** 3); expect(await readFile(input.filePath, 'utf8')).toBe('旧文件'); expect(await readdir(directories.at(-1)!)).toEqual(['all.zip']);
  });
});
