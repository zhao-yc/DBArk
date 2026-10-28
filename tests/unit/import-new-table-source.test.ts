import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, rmdir, utimes, writeFile } from 'node:fs/promises';
import { utimesSync } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import iconv from 'iconv-lite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importFileInspectInputSchema, importFileInspectOutputSchema, importFileSampleRowBytes, importFileSourceSchema, importNewTableLimits, importNewTableSeedSchema, type ImportFileInspectInput } from '../../src/shared/importNewTable';

const observed = vi.hoisted(() => ({ streams: [] as ReadStream[] }));
/** 仅观察原createReadStream和真实close，不替换任何文件字节、解析或成功结果。 */
vi.mock('node:fs', async original => { const actual = await original<typeof import('node:fs')>(); return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => { const stream = actual.createReadStream(...args); observed.streams.push(stream); return stream; } }; });
import { inspectImportFile, readVerifiedImportRecords } from '../../src/engine/importNewTableSource';

const folders: string[] = [];
/** 只删除本例临时目录中的自有文件；不递归删除其他路径。 */
afterEach(async () => { for (const folder of folders.splice(0)) { for (const name of await readdir(folder)) await rm(join(folder, name)); await rmdir(folder); } observed.streams.length = 0; vi.restoreAllMocks(); });
async function fixture(content: string, patch: Partial<ImportFileInspectInput> = {}) { const folder = await mkdtemp(join(tmpdir(), 'dbark-import-new-table-')); folders.push(folder); const input: ImportFileInspectInput & { filePath: string } = { fileToken: '本例文件', taskId: '本例任务', format: 'json', encoding: 'utf8', filePath: join(folder, 'source'), ...patch }; const bytes = iconv.encode(content, input.encoding); await writeFile(input.filePath, bytes); return { input, bytes }; }
const check = () => {};
async function collect(input: Parameters<typeof readVerifiedImportRecords>[0], signal?: AbortSignal) { const rows = []; for await (const row of readVerifiedImportRecords(input, check, signal)) rows.push(row); return rows; }

describe('新表导入全文件检查与正式来源核验（仅RAM和临时文件）', () => {
  it('第21条后新字段仍进入联合目录，前20样本和正式读取均保留大数原文', async () => {
    const content = '[' + Array.from({ length: 21 }, (_, index) => index === 20 ? '{"迟到字段":0.12345678901234567890}' : '{"id":18446744073709551615,"嵌套":{"n":9007199254740993}}').join(',') + ']', { input, bytes } = await fixture(content);
    const progress = vi.fn(), result = await inspectImportFile(input, check, progress);
    expect(result).toMatchObject({ columns: ['id', '嵌套', '迟到字段'], records: 21, sampleOmitted: true, source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }); expect(result.rows).toHaveLength(20); expect(result.rows[0]).toMatchObject({ id: '18446744073709551615', 嵌套: '{"n":9007199254740993}' });
    expect((await collect({ ...input, expectedSource: result.source }))[20]['迟到字段']).toBe('0.12345678901234567890'); expect(progress).toHaveBeenLastCalledWith({ records: 21, bytes: bytes.length }); expect(importFileInspectOutputSchema.parse(result)).toEqual(result);
  });
  it.each(['utf8', 'utf16le', 'gb18030'] as const)('%s摘要包含编码后的全部原字节，CSV标题及无标题首行均保持', async encoding => {
    const { input, bytes } = await fixture('名称;值\r\n中文;18446744073709551615\r\n', { format: 'csv', encoding, csvDelimiter: ';' });
    expect(await inspectImportFile(input, check)).toMatchObject({ columns: ['名称', '值'], records: 1, rows: [{ 名称: '中文', 值: '18446744073709551615' }], source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, sampleOmitted: false });
    expect(await inspectImportFile({ ...input, csvHasHeader: false }, check)).toMatchObject({ columns: ['第1列', '第2列'], records: 2, rows: [{ 第1列: '名称', 第2列: '值' }, { 第1列: '中文', 第2列: '18446744073709551615' }] });
  });
  it('同长改字节不能借新身份时间绕过原SHA，正式生成器在耗尽前拒绝完成', async () => {
    const { input } = await fixture('[{"note":"甲"}]'), preview = await inspectImportFile(input, check); await writeFile(input.filePath, '[{"note":"乙"}]');
    await expect(collect({ ...input, expectedSource: preview.source })).rejects.toThrow('完整内容已变化');
  });
  it('读取中修改同一文件即使原字节已缓冲仍由前后身份拒绝，原流真实释放', async () => {
    const { input } = await fixture('[{"n":1},{"n":2}]'), preview = await inspectImportFile(input, check); let changed = false;
    await expect((async () => { for await (const _row of readVerifiedImportRecords({ ...input, expectedSource: preview.source }, check)) if (!changed) { changed = true; await writeFile(input.filePath, '[{"n":1},{"n":3}]'); await utimes(input.filePath, new Date(), new Date(Date.now() + 5000)); } })()).rejects.toThrow('源文件身份');
    await vi.waitFor(() => expect(observed.streams.every(stream => stream.destroyed && stream.closed)).toBe(true));
  });
  it('检查过程中修改来源不能返回可用摘要，错误不泄露源值和路径', async () => {
    const { input } = await fixture('[' + Array.from({ length: 300 }, () => '{"私密":"内容"}').join(',') + ']'); let changed = false;
    await expect(inspectImportFile(input, check, value => { if (value.records >= 128 && !changed) { changed = true; /* 同步改时间，确保发生于完整扫描的前后身份之间。 */ utimesSync(input.filePath, new Date(), new Date(Date.now() + 5000)); } })).rejects.toThrow('源文件身份');
    await writeFile(input.filePath, '[{"私密":"不应写入诊断"},');
    try { await inspectImportFile(input, check); throw Error('本例应拒绝损坏JSON'); } catch (error) { expect((error as Error).message).toContain('未完整读取或解析'); expect((error as Error).message).not.toContain('不应写入诊断'); expect((error as Error).message).not.toContain(input.filePath); }
  });
  it('取消与提前停止都等待原pipeline释放，不借提前return声称完整核验', async () => {
    const { input } = await fixture('[' + Array.from({ length: 4000 }, (_, index) => '{"n":' + index + '}').join(',') + ']'), preview = await inspectImportFile(input, check), abort = new AbortController(); let rows = 0;
    await expect((async () => { for await (const _row of readVerifiedImportRecords({ ...input, expectedSource: preview.source }, check, abort.signal)) { rows++; abort.abort(); } })()).rejects.toThrow('取消'); expect(rows).toBe(1);
    const generator = readVerifiedImportRecords({ ...input, expectedSource: preview.source }, check); expect((await generator.next()).done).toBe(false); await generator.return(undefined);
    await vi.waitFor(() => expect(observed.streams.every(stream => stream.destroyed && stream.closed)).toBe(true));
    let cancelled = false; await expect(inspectImportFile(input, () => { if (cancelled) throw Error('本例主动取消'); }, value => { if (value.records >= 128) cancelled = true; })).rejects.toThrow('本例主动取消');
    await vi.waitFor(() => expect(observed.streams.every(stream => stream.destroyed && stream.closed)).toBe(true));
  });
  it('样本按完整JSON转义预算保留前部完整行，超限不截值且继续扫描后续列', async () => {
    const first = 'x'.repeat(140000), second = '\u0001'.repeat(40000), { input } = await fixture(JSON.stringify([{ text: first }, { text: second }, ...Array.from({ length: 20 }, () => ({ 后续列: '完整扫描' }))]));
    const result = await inspectImportFile(input, check); expect(result).toMatchObject({ columns: ['text', '后续列'], records: 22, sampleOmitted: true }); expect(result.rows).toEqual([{ text: first }]); expect(Buffer.byteLength(JSON.stringify(result.rows))).toBeLessThanOrEqual(importNewTableLimits.sampleBytes);
    const binary = { payload: { type: 'binary' as const, base64: 'AAH/' }, text: '\0\n"\\🚢' }; expect(importFileSampleRowBytes(binary)).toBe(Buffer.byteLength(JSON.stringify(binary)));
    expect(importFileInspectOutputSchema.safeParse({ ...result, rows: [{ text: 'z'.repeat(importNewTableLimits.sampleBytes) }] }).success).toBe(false);
  });
  it('空集、空文件及只有CSV标题分别保留准确行数、字段和完整来源', async () => {
    for (const [content, format, names] of [['[]', 'json', []], ['', 'csv', []], ['首列,后列\r\n', 'csv', ['首列', '后列']]] as const) { const { input, bytes } = await fixture(content, { format }); expect(await inspectImportFile(input, check)).toEqual({ columns: [...names], rows: [], records: 0, source: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, sampleOmitted: false }); }
  });
  it('联合字段超1000或21条后的超长字段拒绝，重复CSV标题继续沿原拒绝门', async () => {
    const many = Array.from({ length: 1001 }, (_, index) => ({ ['列' + index]: index })), { input } = await fixture(JSON.stringify(many)); await expect(inspectImportFile(input, check)).rejects.toThrow('1000列');
    await writeFile(input.filePath, JSON.stringify([...Array.from({ length: 20 }, () => ({ a: 1 })), { ['名'.repeat(257)]: '后置非法' }])); await expect(inspectImportFile(input, check)).rejects.toThrow('256字符');
    await writeFile(input.filePath, '重复,重复\n1,2'); await expect(inspectImportFile({ ...input, format: 'csv' }, check)).rejects.toThrow('未完整读取或解析');
    await expect(inspectImportFile({ ...input, filePath: folders[0] }, check)).rejects.toThrow('普通文件');
  });
  it('原型同名与JSON空源键完整保留，seed目录与映射严格一致且独立克隆', async () => {
    const { input } = await fixture('[{"__proto__":"源值","constructor":18446744073709551615,"":true}]'), result = await inspectImportFile(input, check), mapping = Object.fromEntries([['__proto__', '原型列'], ['constructor', '构造列'], ['', '空键列']]);
    const raw = { file: { token: input.fileToken, name: 'input.json' }, format: input.format, encoding: input.encoding, expectedSource: result.source, columns: result.columns, mapping }, seed = importNewTableSeedSchema.parse(raw);
    expect(result.columns).toEqual(['__proto__', 'constructor', '']); expect(Object.hasOwn(result.rows[0], '__proto__')).toBe(true); expect(result.rows[0]['constructor']).toBe('18446744073709551615'); expect(Object.hasOwn(seed.mapping, '__proto__')).toBe(true); expect(seed.mapping['__proto__']).toBe('原型列'); raw.mapping['__proto__'] = '迟到改名'; raw.columns.pop(); raw.expectedSource.bytes++; expect(seed.columns).toEqual(['__proto__', 'constructor', '']); expect(seed.mapping['__proto__']).toBe('原型列'); expect(seed.expectedSource.bytes).not.toBe(raw.expectedSource.bytes);
    expect(importNewTableSeedSchema.safeParse({ ...seed, mapping: { constructor: '构造列', '': '空键列' } }).success).toBe(false); expect(importNewTableSeedSchema.safeParse({ ...seed, mapping: Object.fromEntries(seed.columns.map(name => [name, '重复目标'])) }).success).toBe(false);
  });
  it('共享严格合同拒绝多余字段、访问器、稀疏样本、错误SHA以及JSON专用项混入', () => {
    const input = { fileToken: '文件', taskId: '任务', format: 'json', encoding: 'utf8' }, getter = vi.fn();
    expect(importFileInspectInputSchema.safeParse({ ...input, csvDelimiter: undefined }).success).toBe(false); expect(importFileInspectInputSchema.safeParse({ ...input, csvHasHeader: false }).success).toBe(false); expect(importFileInspectInputSchema.safeParse({ ...input, filePath: '禁止IPC路径' }).success).toBe(false); expect(importFileInspectInputSchema.safeParse(Object.defineProperty({ ...input }, 'encoding', { enumerable: true, get: getter })).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(importFileSourceSchema.safeParse({ sha256: 'A'.repeat(64), bytes: 1 }).success).toBe(false); expect(importFileSourceSchema.safeParse({ sha256: 'a'.repeat(64), bytes: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(importFileInspectOutputSchema.safeParse({ columns: ['a'], rows: new Array(1), records: 1, source: { sha256: 'a'.repeat(64), bytes: 1 }, sampleOmitted: false }).success).toBe(false);
  });
});
