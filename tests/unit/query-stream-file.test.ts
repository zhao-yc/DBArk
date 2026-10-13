import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { parse } from 'csv-parse/sync';
import { AtomicFile, type AtomicFileIO } from '../../src/engine/atomicFile';
import { createQueryStreamFile, type QueryStreamFileOptions } from '../../src/engine/queryStreamFile';
import { ResultFileTasks } from '../../src/engine/resultFileTasks';
import { resultExportColumns } from '../../src/shared/resultExport';
import type { QueryExportFrame } from '../../src/shared/queryStreamExport';

const directories: string[] = [];
/** 仅移除本测试创建的文件，不递归删除或处理其他临时目录。 */
afterEach(async () => { for (const directory of directories.splice(0)) { for (const name of await readdir(directory)) await rm(join(directory, name)); await rmdir(directory); } });
/** 保留预先存在的目标，以真实磁盘证据检查失败是否误覆盖。 */
async function options(extra: Partial<QueryStreamFileOptions> = {}): Promise<QueryStreamFileOptions> {
  const directory = await mkdtemp(join(tmpdir(), 'dbark-stream-file-')); directories.push(directory);
  const filePath = join(directory, 'result'); await writeFile(filePath, '原文件');
  return { filePath, format: 'json', encoding: 'utf8', resultSelection: { kind: 'all' }, checkCancelled() {}, onCommitStart() {}, ...extra };
}
/** 列映射与引擎共用位置规则，测试覆盖重复、空名及数字/原型同名列。 */
function start(ordinal: number, rowOrdinal: number, names = ['值']): QueryExportFrame {
  return { kind: 'rows-start', resultOrdinal: ordinal, statementOrdinal: ordinal, rowResultOrdinal: rowOrdinal, columns: resultExportColumns(names.map((name, index) => ({ key: `c${index}`, name }))).map((column, index) => ({ ...column, position: index + 1, type: 'VAR_STRING' })) };
}
/** 文件接口仍执行真实磁盘调用，仅指定故障或竞态边界被替换。 */
function disk(overrides: Partial<AtomicFileIO> = {}): AtomicFileIO { return { open: path => open(path, 'wx'), rename, remove: path => rm(path, { force: true }), ...overrides }; }
/** 可控 Promise 精确进入提交阶段，不依赖 sleep 猜测取消时序。 */
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('完整多结果流式文件', () => {
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('JSON %s 保存异构结果、状态、空集及精确位置值', async encoding => {
    const input = await options({ encoding }); const writer = await createQueryStreamFile(input);
    try {
      await writer.write(start(1, 1, ['值', '值', '值 [2]', '', '__proto__', 'constructor', '2', '1', '浮点', '二进制']));
      await writer.write({ kind: 'row', resultOrdinal: 1, values: [null, '', '18446744073709551615', '0.12345678901234567890', '原型', '\uD800', '二', '一', 1.0000001192092896, { type: 'binary', base64: 'AAH/' }] });
      await writer.write({ kind: 'rows-end', resultOrdinal: 1, warningCount: 3 });
      await writer.write({ kind: 'status', resultOrdinal: 2, statementOrdinal: 2, affectedRows: 1, insertId: '18446744073709551615', warningCount: 0 });
      await writer.write(start(3, 2)); await writer.write({ kind: 'rows-end', resultOrdinal: 3 }); await writer.complete();
      const text = iconv.decode(await readFile(input.filePath), encoding); const document = JSON.parse(text);
      expect(document).toMatchObject({ format: 'DBArk-query-results', version: 1 }); expect(document.results).toHaveLength(3);
      expect(document.results[0].warningCount).toBe(3); expect(Object.hasOwn(document.results[2], 'warningCount')).toBe(false);
      const row = document.results[0].rows[0]; expect(row['值']).toBeNull(); expect(row['值 [3]']).toBe(''); expect(row['值 [2]']).toBe('18446744073709551615'); expect(row['列 [4]']).toBe('0.12345678901234567890');
      expect(Object.hasOwn(row, '__proto__')).toBe(true); expect(row['__proto__']).toBe('原型'); expect(row.constructor).toBe('\uD800'); expect(row['浮点']).toBe(1.0000001192092896); expect(row['二进制']).toEqual({ type: 'binary', base64: 'AAH/' });
      expect(text.indexOf('"2":"二"')).toBeLessThan(text.indexOf('"1":"一"')); expect(document.results[2]).toMatchObject({ rowResultOrdinal: 2, rows: [], rowsWritten: 0 });
      expect(writer.fileCommitted).toBe(true); expect(writer.rowsWritten).toBe(1); expect(writer.bytesWritten).toBe((await readFile(input.filePath)).length);
    } finally { await writer.abort(); }
    expect(await readdir(directories.at(-1)!)).toEqual(['result']);
  });
  it('CSV 指定第二个行集，状态包不占序号，空行集仍占序号', async () => {
    const input = await options({ format: 'csv', resultSelection: { kind: 'row-result', ordinal: 2 } }); const writer = await createQueryStreamFile(input);
    try {
      await writer.write(start(1, 1)); await writer.write({ kind: 'rows-end', resultOrdinal: 1 });
      await writer.write({ kind: 'status', resultOrdinal: 2, statementOrdinal: 2, affectedRows: 1, insertId: '0', warningCount: 0 });
      await writer.write(start(3, 2, ['NULL', '空串', '反斜线', '二进制'])); await writer.write({ kind: 'row', resultOrdinal: 3, values: [null, '', '\\N', { type: 'binary', base64: 'AAH/' }] }); await writer.write({ kind: 'rows-end', resultOrdinal: 3 }); await writer.complete();
      expect(parse(await readFile(input.filePath, 'utf8'))).toEqual([['NULL', '空串', '反斜线', '二进制'], ['\\N', '', '\\\\N', 'base64:AAH/']]); expect(writer.rowsWritten).toBe(1);
    } finally { await writer.abort(); }
  });
  it('指定结果不存在、结果串流或字段预算超限均保留原文件', async () => {
    const input = await options({ format: 'csv', resultSelection: { kind: 'row-result', ordinal: 2 } }); const writer = await createQueryStreamFile(input);
    try {
      await writer.write(start(1, 1)); await expect(writer.write({ kind: 'row', resultOrdinal: 2, values: ['错结果'] })).rejects.toThrow('不匹配');
      await expect(writer.write({ kind: 'row', resultOrdinal: 1, values: ['界'.repeat(3 * 1024 * 1024)] })).rejects.toThrow('8 MiB');
      await writer.write({ kind: 'rows-end', resultOrdinal: 1 }); await expect(writer.complete()).rejects.toThrow('不存在'); expect(writer.fileCommitted).toBe(false);
    } finally { await writer.abort(); }
    expect(await readFile(input.filePath, 'utf8')).toBe('原文件'); expect(await readdir(directories.at(-1)!)).toEqual(['result']);
  });
  it('IEEE 大浮点保持数值，非法二进制、缺失与非有限字段拒绝', async () => {
    const input = await options(); const writer = await createQueryStreamFile(input);
    try {
      await writer.write(start(1, 1));
      for (const value of [undefined, Infinity, { type: 'binary', base64: 'YR==' }]) await expect(writer.write({ kind: 'row', resultOrdinal: 1, values: [value] } as QueryExportFrame)).rejects.toThrow();
      await writer.write({ kind: 'row', resultOrdinal: 1, values: [1e30] }); await writer.write({ kind: 'rows-end', resultOrdinal: 1 }); await writer.complete(); expect(JSON.parse(await readFile(input.filePath, 'utf8')).results[0].rows[0]['值']).toBe(1e30);
    } finally { await writer.abort(); }
  });
  it('短写被完整消费；替换失败和无法无损编码均不改变目标', async () => {
    const input = await options({ encoding: 'utf16le' }); let calls = 0;
    const writer = await createQueryStreamFile(input, disk({ open: async path => { const file = await open(path, 'wx'); return { write: (buffer, offset, length) => { calls++; return file.write(buffer, offset, Math.min(3, length)); }, sync: () => file.sync(), close: () => file.close() }; } }));
    try { await writer.write(start(1, 1)); await writer.write({ kind: 'row', resultOrdinal: 1, values: ['中文😊'] }); await writer.write({ kind: 'rows-end', resultOrdinal: 1 }); await writer.complete(); expect(calls).toBeGreaterThan(50); expect(JSON.parse(iconv.decode(await readFile(input.filePath), 'utf16le')).results[0].rows[0]['值']).toBe('中文😊'); } finally { await writer.abort(); }
    const second = await options({ format: 'csv', resultSelection: { kind: 'row-result', ordinal: 1 } }); const broken = await createQueryStreamFile(second);
    try { await broken.write(start(1, 1)); await expect(broken.write({ kind: 'row', resultOrdinal: 1, values: ['\uD800'] })).rejects.toThrow('无法无损'); } finally { await broken.abort(); }
    expect(await readFile(second.filePath, 'utf8')).toBe('原文件');
    const third = await options(); const rejected = await createQueryStreamFile(third, disk({ rename: async () => { throw new Error('拒绝替换'); } }));
    try { await expect(rejected.complete()).rejects.toThrow('拒绝替换'); } finally { await rejected.abort(); }
    expect(await readFile(third.filePath, 'utf8')).toBe('原文件');
  });
  it('同步期取消保留原文件；进入 rename 后取消仍报告真实成功', async () => {
    const input = await options(); let cancelled = false; const entered = deferred(), release = deferred();
    const writer = await createQueryStreamFile({ ...input, checkCancelled() { if (cancelled) throw new Error('已取消'); } }, disk({ open: async path => { const file = await open(path, 'wx'); return { write: (buffer, offset, length) => file.write(buffer, offset, length), close: () => file.close(), sync: async () => { entered.resolve(); await release.promise; await file.sync(); } }; } }));
    const completing = writer.complete(); const failure = expect(completing).rejects.toThrow('已取消'); await entered.promise; cancelled = true; release.resolve(); await failure; await writer.abort(); expect(await readFile(input.filePath, 'utf8')).toBe('原文件');
    const second = await options(); const committing = deferred(), permit = deferred(); let commitStarted = false; cancelled = false;
    const late = await createQueryStreamFile({ ...second, checkCancelled() { if (cancelled && !commitStarted) throw new Error('已取消'); }, onCommitStart() { commitStarted = true; } }, disk({ rename: async (from, to) => { committing.resolve(); await permit.promise; await rename(from, to); } }));
    // 第二个任务单独开始，直到明确提交点才发取消。
    const saved = late.complete(); await committing.promise; cancelled = true; permit.resolve(); await saved; expect(late.fileCommitted).toBe(true); await late.abort(); expect(JSON.parse(await readFile(second.filePath, 'utf8')).results).toEqual([]);
  });
  it('与旧结果任务共用目标锁，提前失败不删除其他任务的临时文件', async () => {
    const input = await options(); const writer = await createQueryStreamFile(input);
    try {
      await expect(createQueryStreamFile({ ...input, filePath: join(directories.at(-1)!, '.', 'result') })).rejects.toThrow('另一个任务');
      await expect(new ResultFileTasks(() => {}).run({ fileToken: 'selected', taskId: 'old-result', filePath: input.filePath, format: 'json', encoding: 'utf8', result: { columns: [{ key: 'c0', name: '值' }], rows: [], truncated: false } })).rejects.toThrow('另一个任务');
      expect(await readdir(directories.at(-1)!)).toHaveLength(2); await writer.complete();
    } finally { await writer.abort(); }
    const next = await createQueryStreamFile(input); await next.abort(); expect(await readdir(directories.at(-1)!)).toEqual(['result']);
  });
  it('缓冲及文件字节预算明确拒绝，未 flush 的小片段也计入限额', async () => {
    const input = await options(); const file = await AtomicFile.create(input.filePath, 'utf8', input.checkCancelled, input.onCommitStart, undefined, 7);
    try { await file.write('1234'); await expect(file.write('5678')).rejects.toThrow('字节上限'); expect(file.fileCommitted).toBe(false); } finally { await file.dispose(); }
    expect(await readFile(input.filePath, 'utf8')).toBe('原文件');
  });
});
