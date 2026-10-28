import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadStream } from 'node:fs';
import type { TableInfo } from '../../src/shared/contracts';
import type { FileImportPreflightInput } from '../../src/shared/fileImportPreflight';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const observed = vi.hoisted(() => ({ metadata: vi.fn(), streams: [] as ReadStream[] }));
vi.mock('../../src/engine/metadata', () => ({ tableInfo: observed.metadata }));
// 只观察真实文件流终态，不替换解析或磁盘读取。
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
    const stream = actual.createReadStream(...args); observed.streams.push(stream); return stream;
  } };
});
import { preflightImportFile } from '../../src/engine/fileImportPreflight';
import { readRecords } from '../../src/engine/files';

let folder: string, input: FileImportPreflightInput & { filePath: string }, context: StructureTaskContext, info: TableInfo, abort: AbortController;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'dbark-preflight-')); abort = new AbortController(); observed.streams.length = 0;
  input = { taskId: '离线预检', connectionId: '离线', database: '测试库', table: '目标', fileToken: '离线文件', filePath: join(folder, 'source.csv'), format: 'csv', encoding: 'utf8', mapping: { id: 'id', amount: 'amount' } };
  info = { database: input.database, name: input.table, objectKind: 'table', engine: 'InnoDB', ddl: '', indexes: [], foreignKeys: [], editableKey: [], primaryKey: [], columns: [
    { name: 'id', type: 'bigint unsigned', nullable: false, generated: false, extra: '', comment: '', defaultValue: null },
    { name: 'amount', type: 'decimal(30,12)', nullable: true, generated: false, extra: '', comment: '', defaultValue: null }
  ] };
  observed.metadata.mockReset().mockImplementation(async () => structuredClone(info));
  context = { managed: { signal: abort.signal, status: { dialect: 'mysql' } }, checkCancelled: () => abort.signal.throwIfAborted(), report: vi.fn(), commandStarted: vi.fn(() => () => undefined) } as unknown as StructureTaskContext;
});
afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

describe('整文件只读预检', () => {
  it('扫描20条之后并完整统计多字段错误，报告不包含原值', async () => {
    const source = 'id,amount\n' + Array.from({ length: 21 }, (_, index) => `${index},1.25`).join('\n') + '\n私密坏值,私密小数';
    await writeFile(input.filePath, source);
    const report = await preflightImportFile(context, input);
    expect(report).toMatchObject({ checkedRecords: 22, validRecords: 21, invalidRecords: 1, issueCount: 2, complete: true, termination: 'complete', sourceBytes: Buffer.byteLength(source) });
    expect(report.issues.map(issue => [issue.record, issue.target])).toEqual([[22, 'id'], [22, 'amount']]);
    expect(JSON.stringify(report)).not.toContain('私密坏值');
    expect(report.sourceFingerprint).toBe(createHash('sha256').update(source).digest('hex'));
    expect(observed.metadata).toHaveBeenCalledTimes(2);
  });
  it('CSV引号内多行不改变数据记录号', async () => {
    await writeFile(input.filePath, 'id,amount\n1,2\n"坏\n值",3\n4,5');
    expect((await preflightImportFile(context, input)).issues[0]).toMatchObject({ record: 2, source: 'id' });
  });
  it('JSON保留大整数和小数原token以及原型同名字段', async () => {
    input.format = 'json';
    input.mapping = JSON.parse('{"__proto__":"amount","id":"id"}') as Record<string, string>;
    await writeFile(input.filePath, '[{"id":18446744073709551615,"__proto__":123456789012345678.123456789012}]');
    expect(await preflightImportFile(context, input)).toMatchObject({ checkedRecords: 1, validRecords: 1, issueCount: 0, complete: true });
  });
  it('超过200明细后仍扫描并保留完整计数', async () => {
    await writeFile(input.filePath, 'id,amount\n' + '坏,错\n'.repeat(301));
    const report = await preflightImportFile(context, input);
    expect(report).toMatchObject({ checkedRecords: 301, invalidRecords: 301, issueCount: 602, truncated: true, complete: true });
    expect(report.issues).toHaveLength(200);
  });
  it('源字段缺失逐项报告，不因未映射非空列报错', async () => {
    input.format = 'json'; input.mapping = { amount: 'amount' };
    await writeFile(input.filePath, '[{"amount":2},{}]');
    expect(await preflightImportFile(context, input)).toMatchObject({ checkedRecords: 2, validRecords: 1, invalidRecords: 1, issues: [{ record: 2, code: 'missing-source' }] });
  });
  it('解析失败不给虚构记录号或完整SHA', async () => {
    await writeFile(input.filePath, 'id,amount\n1,2\n"未闭合');
    const report = await preflightImportFile(context, input);
    expect(report).toMatchObject({ complete: false, termination: 'parse-error', sourceFingerprint: null });
    expect(report.issues.at(-1)).toMatchObject({ code: 'parse-error' });
    expect(report.issues.at(-1)).not.toHaveProperty('record');
  });
  it('映射空、重复、未知和生成列在读取文件前拒绝', async () => {
    const mappings: Record<string, string>[] = [{}, { a: 'id', b: 'id' }, { a: '未知' }];
    for (const mapping of mappings) await expect(preflightImportFile(context, { ...input, mapping })).rejects.toThrow();
    info.columns[0].generated = true;
    await expect(preflightImportFile(context, input)).rejects.toThrow('生成列');
    expect(observed.streams).toHaveLength(0);
  });
  it('字段发生变化使扫描结果失效，动态DDL自增计数不在指纹内', async () => {
    await writeFile(input.filePath, 'id,amount\n1,2');
    const changed = structuredClone(info); changed.columns[0].nullable = true;
    observed.metadata.mockResolvedValueOnce(info).mockResolvedValueOnce(changed);
    expect(await preflightImportFile(context, input)).toMatchObject({ complete: false, termination: 'schema-changed' });
    observed.metadata.mockResolvedValueOnce(info).mockResolvedValueOnce({ ...info, ddl: 'CREATE TABLE 任意 AUTO_INCREMENT=500' });
    expect(await preflightImportFile(context, input)).toMatchObject({ complete: true });
  });
  it('读取期间文件变化使来源失效且不暴露SHA', async () => {
    await writeFile(input.filePath, 'id,amount\n' + '1,2\n'.repeat(1000));
    let changed = false;
    // 在真实扫描让出点同步追加，避免测试自身未等待写入造成竞态。
    const report = await preflightImportFile(context, input, () => { if (!changed) { changed = true; appendFileSync(input.filePath, '9,9\n'); } });
    expect(report).toMatchObject({ complete: false, termination: 'source-changed', sourceFingerprint: null });
  });
  it('真实文件读取取消释放原流，取消不转成解析报告', async () => {
    await writeFile(input.filePath, 'id,amount\n' + '1,2\n'.repeat(20000));
    await expect(preflightImportFile(context, input, () => abort.abort())).rejects.toThrow();
    expect(observed.streams.every(stream => stream.closed)).toBe(true);
  });
  it('reader原五参数仍兼容，原始字节观察和已取消signal有效', async () => {
    await writeFile(input.filePath, 'id,amount\n1,2');
    const rows = []; for await (const row of readRecords(input.filePath, 'csv', 'utf8')) rows.push(row);
    expect(rows).toHaveLength(1); abort.abort();
    await expect(async () => { for await (const _row of readRecords(input.filePath, 'csv', 'utf8', undefined, undefined, { signal: abort.signal })) { /* 不应产出记录。 */ } }).rejects.toThrow();
  });
});
