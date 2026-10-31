import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { utimesSync, type ReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportFileInspectInput } from '../../src/shared/importNewTable';
import { importFileInspectInputSchema } from '../../src/shared/importNewTable';

const observed = vi.hoisted(() => ({ streams: [] as ReadStream[], chunkBytes: 1 }));
/** 只缩小真实文件流的chunk，字节、解析器、摘要和close全部沿原实现，不伪造成功数据。 */
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { const options = args[1], stream = actual.createReadStream(args[0], { ...(typeof options === 'string' ? { encoding: options } : options), highWaterMark: observed.chunkBytes }); observed.streams.push(stream); return stream; } };
});
import { inspectImportFile, readVerifiedImportRecords } from '../../src/engine/importNewTableSource';
import { readRecords } from '../../src/engine/files';

const folders: string[] = [], check = () => {};
type Encoding = ImportFileInspectInput['encoding'];
type InspectInput = Parameters<typeof inspectImportFile>[0];
const invalidEncoding = '导入文件字节不符合所选编码，请核对编码或整理原文件；未确认本次导入完成';
/** 文件均为本测试新建的独占目录；先观察原stream真实close，再逐文件删除，不碰其它路径。 */
afterEach(async () => { await vi.waitFor(() => expect(observed.streams.every(stream => stream.destroyed && stream.closed)).toBe(true)); for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await unlink(join(folder, name)); await rmdir(folder); } observed.streams.length = 0; observed.chunkBytes = 1; vi.restoreAllMocks(); });
async function fixture(bytes: Uint8Array, encoding: Encoding = 'utf8', format: ImportFileInspectInput['format'] = 'csv') {
  const folder = await mkdtemp(join(tmpdir(), 'dbark-strict-encoding-')); folders.push(folder); const input: InspectInput = { fileToken: 'owned-file', taskId: 'owned-task', filePath: join(folder, 'source'), format, encoding }; await writeFile(input.filePath, bytes); return { input, bytes };
}
async function collect(input: Parameters<typeof readVerifiedImportRecords>[0], signal?: AbortSignal) { const rows = []; for await (const row of readVerifiedImportRecords(input, check, signal)) rows.push(row); return rows; }

describe('原字节SHA链的内部严格编码选项', () => {
  it.each([
    ['utf16le', 'csv'], ['gb18030', 'csv'], ['utf16le', 'json'], ['gb18030', 'json'],
  ] as const)('旧默认%s/%s单字节chunk保留相邻非BMP、NUL和合法替换字符，不要求严格开关', async (encoding, format) => {
    const value = '开头🚢😀中间\0合法�结尾🚀', content = format === 'csv' ? 'value\n' + value + '\n' : JSON.stringify([{ value }]), { input, bytes } = await fixture(iconv.encode(content, encoding), encoding, format);
    const rows = []; for await (const row of readRecords(input.filePath, format, encoding)) rows.push(row);
    expect(rows).toEqual([{ value }]); const legacy = await inspectImportFile(input, check);
    expect(legacy.rows).toEqual([{ value }]); expect(legacy.source).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); expect(await collect({ ...input, expectedSource: legacy.source })).toEqual([{ value }]);
    expect(observed.streams).toHaveLength(3); expect(observed.streams.every(stream => stream.bytesRead === bytes.length)).toBe(true);
  });

  it.each([['\ud800尾', '�尾'], ['尾\ud800', '尾�']] as const)('默认UTF16LE孤立代理项%s仍沿原替换容错，不误拼后续普通字符', async (raw, value) => {
    const { input } = await fixture(Buffer.from('value\n' + raw, 'utf16le'), 'utf16le');
    expect((await inspectImportFile(input, check)).rows).toEqual([{ value }]); await expect(inspectImportFile({ ...input, strictEncoding: true }, check)).rejects.toThrow(invalidEncoding);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 64])('GB18030 %i字节chunk的四字节字符后接ASCII及EOF非BMP，与整文件UTF8原文完全一致', async chunkBytes => {
    observed.chunkBytes = chunkBytes;
    const value = '🚢A🚀BC😀中文�\0末尾🚢', content = 'value\n' + value, { input, bytes } = await fixture(iconv.encode(content, 'gb18030'), 'gb18030');
    expect(iconv.decode(bytes, 'gb18030')).toBe(content);
    const rows = []; for await (const row of readRecords(input.filePath, 'csv', 'gb18030')) rows.push(row);
    expect(rows).toEqual([{ value }]); if (typeof rows[0].value !== 'string') throw Error('本例CSV值必须为原文本'); expect(Buffer.from(rows[0].value, 'utf8')).toEqual(Buffer.from(value, 'utf8'));
    const strict = await inspectImportFile({ ...input, strictEncoding: true }, check); expect(strict.rows).toEqual([{ value }]); expect(strict.source).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); expect(await collect({ ...input, expectedSource: strict.source, strictEncoding: true })).toEqual([{ value }]);
    expect(observed.streams).toHaveLength(3); expect(observed.streams.every(stream => stream.bytesRead === bytes.length)).toBe(true);
  });

  it.each([[0x81], [0x81, 0x30, 0x81], [0x81, 0x20], [0x81, 0x30, 0x81, 0x20]].map(invalid => [invalid] as const))('默认GB18030非法序列%s仍按原完整iconv映射容错，后续合法四字节字符不丢失', async invalid => {
    const valid = iconv.encode('🚢A末尾', 'gb18030');
    for (const content of [Buffer.concat([Buffer.from(invalid), valid]), Buffer.concat([valid, Buffer.from(invalid)])]) {
      const bytes = Buffer.concat([Buffer.from('value\n'), content]), { input } = await fixture(bytes, 'gb18030'), value = iconv.decode(bytes, 'gb18030').slice('value\n'.length);
      expect((await inspectImportFile(input, check)).rows).toEqual([{ value }]); await expect(inspectImportFile({ ...input, strictEncoding: true }, check)).rejects.toThrow(invalidEncoding);
    }
  });

  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s真实单字节chunk支持NUL/非BMP/合法U+FFFD，摘要覆盖唯一原流全部字节', async encoding => {
    const value = '原文\0合法�"🚢', content = '名称;值;数字\r\n中文🚢;"原文\0合法�""🚢";9223372036854775807\r\n', { input, bytes } = await fixture(iconv.encode(content, encoding), encoding);
    input.csvDelimiter = ';'; const output = await inspectImportFile({ ...input, strictEncoding: true }, check);
    expect(output).toMatchObject({ columns: ['名称', '值', '数字'], records: 1, rows: [{ 名称: '中文🚢', 值: value, 数字: '9223372036854775807' }], source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }); expect(observed.streams).toHaveLength(1); expect(observed.streams[0].bytesRead).toBe(bytes.length);
    expect(await collect({ ...input, strictEncoding: true, expectedSource: output.source })).toEqual(output.rows); expect(observed.streams).toHaveLength(2); expect(observed.streams.every(stream => stream.bytesRead === bytes.length)).toBe(true);
  });

  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s完整JSON数字仍保原token，严格校验不改写正文或嵌套JSON', async encoding => {
    const content = '[{"文字":"中文🚢\\u0000合法�","大整数":18446744073709551615,"小数":0.10000000000000001,"嵌套":{"数":9007199254740993}}]', { input, bytes } = await fixture(iconv.encode(content, encoding), encoding, 'json'), output = await inspectImportFile({ ...input, strictEncoding: true }, check);
    expect(output.rows).toEqual([{ 文字: '中文🚢\0合法�', 大整数: '18446744073709551615', 小数: '0.10000000000000001', 嵌套: '{"数":9007199254740993}' }]); expect(output.source).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); expect(await collect({ ...input, expectedSource: output.source, strictEncoding: true })).toEqual(output.rows); expect(observed.streams).toHaveLength(2);
  });

  it.each([
    ['utf8', [0xff], '非法UTF8起始字节'], ['utf8', [0xc0, 0xaf], '过长UTF8'], ['utf8', [0xed, 0xa0, 0x80], 'UTF8代理项'],
    ['utf16le', [0x00, 0xdc], '孤立UTF16低代理项'], ['gb18030', [0x81, 0x20], '非法GB18030续字节'],
  ] as const)('%s中%s拒绝签发检查结果，诊断不包含源值/路径', async (encoding, invalid, _description) => {
    const secret = 'PRIVATE_ENCODING_VALUE_8134', bytes = Buffer.concat([iconv.encode('value\n' + secret, encoding), Buffer.from(invalid), iconv.encode('\n', encoding)]), { input } = await fixture(bytes, encoding), complete = vi.fn();
    await expect(inspectImportFile({ ...input, strictEncoding: true }, check, complete)).rejects.toThrow(invalidEncoding); expect(complete).not.toHaveBeenCalled(); expect(observed.streams).toHaveLength(1);
    try { await inspectImportFile({ ...input, strictEncoding: true }, check); throw Error('本例损坏编码不能通过'); } catch (error) { expect((error as Error).message).toBe(invalidEncoding); expect((error as Error).message).not.toContain(secret); expect((error as Error).message).not.toContain(input.filePath); }
  });

  it.each([
    ['utf8', [0xe4, 0xb8]], ['utf16le', [0x61]], ['utf16le', [0x00, 0xd8]], ['gb18030', [0x81]], ['gb18030', [0x81, 0x30, 0x81]],
  ] as const)('%s流EOF flush拒绝截断尾序列%s，不能在iconv容错后补发完整摘要', async (encoding, tail) => {
    const bytes = Buffer.concat([iconv.encode('value\n原完整行\n', encoding), Buffer.from(tail)]), { input } = await fixture(bytes, encoding); await expect(inspectImportFile({ ...input, strictEncoding: true }, check)).rejects.toThrow(invalidEncoding);
  });

  it('旧调用省略开关仍保原容错行为；正式读取显式启用后相同SHA也必须拒绝非法字节', async () => {
    const bytes = Buffer.concat([Buffer.from('value\n'), Buffer.from([0xff]), Buffer.from('末尾\n')]), { input } = await fixture(bytes), legacy = await inspectImportFile(input, check);
    expect(legacy.rows).toEqual([{ value: '�末尾' }]); expect(legacy.source).toEqual({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); expect(await collect({ ...input, expectedSource: legacy.source })).toEqual(legacy.rows); await expect(collect({ ...input, expectedSource: legacy.source, strictEncoding: true })).rejects.toThrow(invalidEncoding);
    expect(importFileInspectInputSchema.safeParse({ fileToken: input.fileToken, taskId: input.taskId, format: input.format, encoding: input.encoding, strictEncoding: true }).success).toBe(false);
  });

  it('正式迭代器可能已写入原行，EOF编码拒绝仍触发同一原生事务整批回滚', async () => {
    const bytes = Buffer.concat([Buffer.from('value\n先前完整行\n'), Buffer.from([0xe4, 0xb8])]), { input } = await fixture(bytes), legacy = await inspectImportFile(input, check), seen: unknown[] = []; let completed = false;
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("CREATE TABLE owned(value TEXT NOT NULL); INSERT INTO owned VALUES('原控制行'); BEGIN");
      await expect((async () => { try { for await (const row of readVerifiedImportRecords({ ...input, expectedSource: legacy.source, strictEncoding: true }, check)) { seen.push(row); if (typeof row.value !== 'string') throw Error('本例CSV只应产出文本'); db.prepare('INSERT INTO owned VALUES(?)').run(row.value); } completed = true; db.exec('COMMIT'); } catch (reason) { db.exec('ROLLBACK'); throw reason; } })()).rejects.toThrow(invalidEncoding);
      expect(seen).toContainEqual({ value: '先前完整行' }); expect(completed).toBe(false); expect(db.prepare('SELECT value FROM owned').all()).toEqual([{ value: '原控制行' }]);
    } finally { db.close(); }
  });

  it('取消仍优先保原任务原因，提前取消不打开源文件', async () => {
    const { input } = await fixture(Buffer.from('value\n合法\n')), abort = new AbortController(); abort.abort(); await expect(inspectImportFile({ ...input, strictEncoding: true }, check, undefined, abort.signal)).rejects.toThrow('取消'); expect(observed.streams).toHaveLength(0);
    const reason = new Error('本例原任务主动取消'); await expect(inspectImportFile({ ...input, strictEncoding: true }, () => { throw reason; })).rejects.toBe(reason); expect(observed.streams).toHaveLength(0);
  });

  it('严格解码不代替原文件身份复核，读取期间metadata变化仍拒绝最终摘要', async () => {
    observed.chunkBytes = 64; const { input } = await fixture(Buffer.from('value\n' + Array.from({ length: 300 }, (_, index) => '行' + index + '\n').join(''))); let changed = false;
    await expect(inspectImportFile({ ...input, strictEncoding: true }, check, progress => { if (progress.records >= 128 && !changed) { changed = true; utimesSync(input.filePath, new Date(), new Date(Date.now() + 5000)); } })).rejects.toThrow('源文件身份'); expect(changed).toBe(true);
  });
});
