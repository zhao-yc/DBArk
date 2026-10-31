import { describe, expect, it, vi } from 'vitest';
import { sqliteImportSourceInspectSchema, sqliteImportSourceInspectionSchema, sqliteImportSourceLimits, sqliteImportSourceOptionsKey, sqliteImportSourceReleaseSchema } from '../../src/shared/sqliteImportSource';
import { sqliteTableImportInspectSchema } from '../../src/shared/sqliteTableImport';
import type { DataRow } from '../../src/shared/contracts';

const input = { connectionId: 'owned-sqlite', database: 'main' as const, fileToken: 'owned-token', format: 'json' as const, encoding: 'utf8' as const, taskId: 'owned-inspection' };
/** 仅合成来源事实；本测试不打开文件、连接或实际进程。 */
function inspection() { return { sourceId: 'owned-source', connectionId: input.connectionId, database: 'main' as const, source: { sha256: 'a'.repeat(64), bytes: 123 }, sourceColumns: ['value'], sample: [{ value: '原值' }], records: 1, sampleOmitted: false, expiresAt: '2030-01-01T00:00:00.000Z' }; }

describe('SQLite无表来源能力的严格合同', () => {
  it('只接main文件令牌与读取选项，不接table/path/SQL/预期摘要或profile', () => {
    expect(sqliteImportSourceInspectSchema.parse(input)).toEqual(input);
    for (const extra of [{ table: '不存在的表' }, { path: '/用户路径' }, { expectedSource: inspection().source }, { sql: 'CREATE TABLE x(a)' }, { profile: {} }, { sourceId: '伪造来源' }]) expect(sqliteImportSourceInspectSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    for (const patch of [{ database: 'temp' }, { connectionId: '' }, { encoding: 'utf16be' }, { format: 'sql' }, { csvDelimiter: undefined }, { csvHasHeader: undefined }, { csvHasHeader: true }]) expect(sqliteImportSourceInspectSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    expect(sqliteImportSourceInspectSchema.parse({ ...input, format: 'csv', csvDelimiter: '\t', csvHasHeader: false })).toMatchObject({ csvDelimiter: '\t', csvHasHeader: false });
    expect(sqliteImportSourceReleaseSchema.parse({ sourceId: 'owned-source' })).toEqual({ sourceId: 'owned-source' });
    for (const value of [{}, { sourceId: '' }, { sourceId: 's', connectionId: 'c' }, { sourceId: 's', previewId: 'p' }]) expect(sqliteImportSourceReleaseSchema.safeParse(value).success).toBe(false);
  });

  it('CSV省略默认值与显式默认解释相同；无表/task/连接进入key，false及实际解释变化必须区分', () => {
    const base = { ...input, format: 'csv' as const }, key = sqliteImportSourceOptionsKey(base);
    expect(sqliteImportSourceOptionsKey({ ...base, csvDelimiter: ',', csvHasHeader: true })).toBe(key);
    const other = { ...base, taskId: '另一个任务', connectionId: '另一个连接', table: '另一个表', sourceId: '另一个来源', filePath: '/内部额外字段不参与' }; expect(sqliteImportSourceOptionsKey(other)).toBe(key);
    for (const patch of [{ fileToken: '另一个文件' }, { encoding: 'utf16le' as const }, { csvDelimiter: ';' as const }, { csvHasHeader: false }]) expect(sqliteImportSourceOptionsKey({ ...base, ...patch })).not.toBe(key);
    expect(JSON.parse(sqliteImportSourceOptionsKey(input))).toEqual({ fileToken: input.fileToken, format: 'json', encoding: 'utf8', csvDelimiter: null, csvHasHeader: null });
    expect(() => sqliteImportSourceOptionsKey({ ...input, csvDelimiter: undefined })).toThrow();
  });

  it('来源回包保持完整目录/精确样本/NULL/空串/missing/原型名，不泄露路径且独立克隆', () => {
    const row: DataRow = Object.fromEntries([['', '18446744073709551615'], ['__proto__', '原型原值'], ['nil', null], ['empty', ''], ['flag', true], ['blob', { type: 'binary', base64: 'AAH/' }]]), value = { ...inspection(), sourceColumns: ['', '__proto__', 'nil', 'empty', 'flag', 'blob', 'missing'], sample: [row] }, parsed = sqliteImportSourceInspectionSchema.parse(value);
    expect(parsed).toEqual(value); expect(Object.hasOwn(parsed.sample[0], 'missing')).toBe(false); expect(Object.hasOwn(parsed.sample[0], '__proto__')).toBe(true);
    value.source.sha256 = 'b'.repeat(64); value.sourceColumns.push('迟到改动'); row[''] = '被改'; (row.blob as { type: string; base64: string }).base64 = 'AA==';
    expect(parsed.source.sha256).toBe('a'.repeat(64)); expect(parsed.sourceColumns).not.toContain('迟到改动'); expect(parsed.sample[0]['']).toBe('18446744073709551615'); expect(parsed.sample[0].blob).toEqual({ type: 'binary', base64: 'AAH/' });
    for (const extra of [{ filePath: '/原文件' }, { fileToken: '不应返回' }, { target: { table: '不存在' } }, { profile: {} }]) expect(sqliteImportSourceInspectionSchema.safeParse({ ...inspection(), ...extra }).success).toBe(false);
  });

  it('目录1000列/名称256/样本20及256KiB/1000万记录硬预算先于克隆，空文件可检查', () => {
    const empty = { ...inspection(), sourceColumns: [], sample: [], records: 0, source: { sha256: '0'.repeat(64), bytes: 0 } }; expect(sqliteImportSourceInspectionSchema.parse(empty)).toEqual(empty);
    const maximum = { ...empty, sourceColumns: Array.from({ length: 1000 }, (_, index) => '源' + index), records: 10000000, sampleOmitted: true }; expect(sqliteImportSourceInspectionSchema.safeParse(maximum).success).toBe(true);
    for (const patch of [{ sourceColumns: Array.from({ length: 1001 }, (_, index) => '源' + index) }, { sourceColumns: ['x'.repeat(257)] }, { sourceColumns: ['重复', '重复'] }, { records: 10000001 }, { sample: Array.from({ length: 21 }, () => ({})) }, { sample: [{ value: 'x'.repeat(262144) }] }, { sample: [{ value: '\ud800' }] }, { sample: [{ unknown: '不在目录' }] }, { source: { sha256: 'A'.repeat(64), bytes: 1 } }, { sampleOmitted: true }]) expect(sqliteImportSourceInspectionSchema.safeParse({ ...inspection(), ...patch }).success).toBe(false);
    expect(sqliteImportSourceLimits).toMatchObject({ sources: 64, sourceBytes: 64 * 1024 * 1024, sourceLifetimeMs: 30 * 60 * 1000, records: 10000000 });
  });

  it('对象/目录/样本访问器与稀疏数组不执行，超限数组不先遍历getter', () => {
    const getter = vi.fn(() => '源值'), raw = Object.defineProperty({ ...input }, 'encoding', { enumerable: true, get: getter }); expect(sqliteImportSourceInspectSchema.safeParse(raw).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    const columns = Array.from({ length: 1001 }, (_, index) => '列' + index); Object.defineProperty(columns, '0', { get: getter, enumerable: true }); expect(sqliteImportSourceInspectionSchema.safeParse({ ...inspection(), sourceColumns: columns }).success).toBe(false);
    const row = Object.defineProperty({}, 'value', { get: getter, enumerable: true }); expect(sqliteImportSourceInspectionSchema.safeParse({ ...inspection(), sample: [row] }).success).toBe(false); expect(sqliteImportSourceInspectionSchema.safeParse({ ...inspection(), sample: new Array(1) }).success).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(() => sqliteImportSourceOptionsKey(Object.defineProperty({ ...input }, 'fileToken', { get: getter, enumerable: true }))).toThrow(); expect(getter).not.toHaveBeenCalled();
  });

  it('旧tableImport.inspect省略sourceId保持原形，新cap引用只接受可选id，不接客户端hash或额外权限', () => {
    const old = { ...input, table: '真实目标' }; expect(sqliteTableImportInspectSchema.parse(old)).toEqual(old); expect(sqliteTableImportInspectSchema.parse({ ...old, sourceId: 'owned-source' })).toEqual({ ...old, sourceId: 'owned-source' });
    const allFields = { ...old, format: 'csv', csvDelimiter: ',', csvHasHeader: true, sourceId: 'owned-source' }; expect(Object.keys(allFields)).toHaveLength(10); expect(sqliteTableImportInspectSchema.safeParse(allFields).success).toBe(true);
    for (const extra of [{ sourceId: '' }, { expectedSource: inspection().source }, { sha256: 'a'.repeat(64) }]) expect(sqliteTableImportInspectSchema.safeParse({ ...old, ...extra }).success).toBe(false);
  });
});
