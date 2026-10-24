import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { importPresetConfigurationSchema, importPresetDocumentSchema, importPresetSnapshotSchema, importPresetEntrySchema, importPresetListSchema, importPresetSaveSchema, importPresetDeleteSchema, importPresetLimits, type ImportPresetConfiguration } from '../../src/shared/importPresets';

/** 手工构造源键，原型同名及换行只属于列身份，不携带任何真实文件或数据。 */
function configuration(): ImportPresetConfiguration {
  return { format: 'csv', encoding: 'utf8', csvDelimiter: ';', csvHasHeader: false, columns: ['__proto__', 'constructor', '跨\r\n行'], mapping: Object.fromEntries([['__proto__', 'id'], ['constructor', ''], ['跨\r\n行', '内容']]) };
}
function entry() { return { id: randomUUID(), name: '财务 CSV 导入', configuration: configuration(), createdAt: '2026-10-24T00:00:00.000Z', updatedAt: '2026-10-24T00:00:00.000Z' }; }
function packet() { return { generation: randomUUID(), revision: 0, name: '财务 CSV 导入', configuration: configuration() }; }

describe('导入配置严格共享合同', () => {
  it('CSV false、序号或原型源键、跳过和原始列顺序完整保留，返回独立副本', () => {
    const raw = configuration(), result = importPresetConfigurationSchema.parse(raw);
    expect(result).toEqual(raw); expect(Object.hasOwn(result.mapping, '__proto__')).toBe(true); expect(Object.getPrototypeOf(result.mapping)).toBe(null);
    raw.columns.reverse(); raw.mapping['__proto__'] = '外部修改'; expect(result.columns).toEqual(['__proto__', 'constructor', '跨\r\n行']); expect(result.mapping['__proto__']).toBe('id');
    const defaults = { format: 'csv', encoding: 'utf16le', columns: ['第1列'], mapping: { 第1列: '目标' } };
    expect(importPresetConfigurationSchema.parse(defaults)).toEqual(defaults);
    expect(importPresetConfigurationSchema.parse({ ...defaults, csvHasHeader: true, csvDelimiter: '\t' })).toMatchObject({ csvHasHeader: true, csvDelimiter: '\t' });
    expect(importPresetConfigurationSchema.parse({ ...defaults, format: 'json', encoding: 'gb18030' })).toMatchObject({ format: 'json', encoding: 'gb18030' });
  });
  it('禁止JSON夹带CSV选项，包括own undefined；格式/编码/分隔符不猜测', () => {
    for (const extra of [{ csvDelimiter: ',' }, { csvHasHeader: false }, { csvHasHeader: true }, { csvHasHeader: undefined }, { csvDelimiter: undefined }]) expect(importPresetConfigurationSchema.safeParse({ format: 'json', encoding: 'utf8', columns: ['id'], mapping: { id: 'id' }, ...extra }).success).toBe(false);
    for (const extra of [{ csvHasHeader: undefined }, { csvHasHeader: 'false' }, { csvDelimiter: undefined }, { csvDelimiter: '|' }, { format: 'sql' }, { encoding: 'latin1' }]) expect(importPresetConfigurationSchema.safeParse({ ...configuration(), ...extra }).success).toBe(false);
  });
  it('源列完整唯一、映射完整且只引用源键，至少一个非空唯一可写目标', () => {
    for (const columns of [[], ['id', 'id'], [''], ['x'.repeat(4097)], Array.from({ length: 4097 }, (_, i) => String(i))]) expect(importPresetConfigurationSchema.safeParse({ ...configuration(), columns }).success).toBe(false);
    const base = { format: 'csv', encoding: 'utf8', columns: ['a', 'b'] };
    for (const mapping of [{ a: 'id' }, { a: 'id', b: '', extra: '' }, { a: '', b: '' }, { a: 'id', b: 'id' }, { a: 'x'.repeat(65), b: '' }, { a: '坏\0列', b: '' }, { a: null, b: '' }]) expect(importPresetConfigurationSchema.safeParse({ ...base, mapping }).success).toBe(false);
    expect(importPresetConfigurationSchema.safeParse({ ...base, mapping: { a: 'x'.repeat(64), b: '' } }).success).toBe(true);
    const columns = Array.from({ length: 4096 }, (_, i) => String(i));
    expect(importPresetConfigurationSchema.parse({ format: 'json', encoding: 'utf8', columns, mapping: Object.fromEntries(columns.map((column, i) => [column, i ? '' : 'id'])) }).columns).toHaveLength(4096);
  });
  it('任何层额外秘密、文件、SQL、数据库或行数据字段都拒绝', () => {
    for (const extra of [{ fileToken: 'f' }, { filePath: '/path' }, { connectionId: 'c' }, { database: 'db' }, { password: '不应保存' }, { rows: [] }, { row: {} }, { sql: 'SELECT 1' }]) {
      expect(importPresetSaveSchema.safeParse({ ...packet(), ...extra }).success).toBe(false);
      expect(importPresetConfigurationSchema.safeParse({ ...configuration(), ...extra }).success).toBe(false);
      expect(importPresetEntrySchema.safeParse({ ...entry(), ...extra }).success).toBe(false);
    }
  });
  it('原始对象访问器不执行，隐藏/符号/继承/稀疏/循环一律拒绝', () => {
    let calls = 0;
    const getter = { ...configuration() }; Object.defineProperty(getter, 'format', { enumerable: true, get() { calls++; return 'csv'; } });
    const hidden = { ...configuration() }; Object.defineProperty(hidden, 'encoding', { value: 'utf8', enumerable: false });
    const columns = ['a']; Object.defineProperty(columns, '0', { enumerable: true, get() { calls++; return 'a'; } });
    const mapping = Object.create(null); Object.defineProperty(mapping, 'a', { enumerable: true, get() { calls++; return 'id'; } });
    const circular: Record<string, unknown> = { ...configuration() }; circular.mapping = circular;
    for (const value of [getter, hidden, { ...configuration(), [Symbol('额外')]: 1 }, Object.assign(Object.create({ inherited: 1 }), configuration()), { ...configuration(), columns: Array(1) }, { ...configuration(), columns }, { format: 'csv', encoding: 'utf8', columns: ['a'], mapping }, circular]) expect(importPresetConfigurationSchema.safeParse(value).success).toBe(false);
    const command = packet(); Object.defineProperty(command, 'configuration', { enumerable: true, get() { calls++; return configuration(); } }); expect(importPresetSaveSchema.safeParse(command).success).toBe(false);
    expect(calls).toBe(0);
  });
  it('孤立UTF16、非法名字、错误CAS与时间顺序拒绝，内部空格不被规范化', () => {
    expect(importPresetSaveSchema.parse(packet()).name).toBe('财务 CSV 导入');
    for (const name of ['', ' ', ' 首部', '尾部 ', '换\n行', '控\u0085制', '名'.repeat(81), '\ud800']) expect(importPresetSaveSchema.safeParse({ ...packet(), name }).success).toBe(false);
    for (const field of ['generation', 'revision'] as const) expect(importPresetSaveSchema.safeParse({ ...packet(), [field]: undefined }).success).toBe(false);
    for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(importPresetDeleteSchema.safeParse({ generation: randomUUID(), id: randomUUID(), revision }).success).toBe(false);
    for (const columns of [['\ud800'], ['\udfff']]) expect(importPresetConfigurationSchema.safeParse({ format: 'csv', encoding: 'utf8', columns, mapping: Object.fromEntries(columns.map(column => [column, 'id'])) }).success).toBe(false);
    expect(importPresetConfigurationSchema.safeParse({ format: 'json', encoding: 'utf8', columns: ['😀'], mapping: { '😀': '中文' } }).success).toBe(true);
    expect(importPresetEntrySchema.safeParse({ ...entry(), updatedAt: '2025-10-24T00:00:00.000Z' }).success).toBe(false);
    expect(importPresetEntrySchema.safeParse({ ...entry(), createdAt: '2026-02-30T00:00:00.000Z' }).success).toBe(false);
    expect(importPresetListSchema.parse({})).toEqual({}); expect(importPresetListSchema.safeParse({ connectionId: 'c' }).success).toBe(false);
  });
  it('单配置和总文档按完整UTF8计费，100项上限及重复名称/编号均整份拒绝', () => {
    const columns = Array.from({ length: 32 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(4094));
    const large = { format: 'csv', encoding: 'utf8', columns, mapping: Object.fromEntries(columns.map((column, i) => [column, 'c' + i])) };
    expect(importPresetConfigurationSchema.safeParse(large).success).toBe(false);
    const chinese = { format: 'csv', encoding: 'utf8', columns: Array.from({ length: 16 }, (_, i) => String(i) + '字'.repeat(4000)), mapping: {} as Record<string, string> };
    chinese.mapping = Object.fromEntries(chinese.columns.map((column, i) => [column, 'c' + i])); expect(importPresetConfigurationSchema.safeParse(chinese).success).toBe(false);
    const entries = Array.from({ length: 100 }, (_, i) => ({ ...entry(), name: '配置' + i }));
    expect(importPresetDocumentSchema.parse({ version: 1, revision: 99, entries }).entries).toHaveLength(100);
    expect(importPresetDocumentSchema.safeParse({ version: 1, revision: 0, entries: [...entries, { ...entry(), name: '101' }] }).success).toBe(false);
    expect(importPresetDocumentSchema.safeParse({ version: 2, revision: 0, entries: [] }).success).toBe(false);
    expect(importPresetDocumentSchema.safeParse({ version: 1, revision: 0, entries: [entries[0], entries[0]] }).success).toBe(false);
    const medium = { format: 'json', encoding: 'utf8', columns: ['a'.repeat(4096), ...Array.from({ length: 9 }, (_, i) => i + 'x'.repeat(3999))], mapping: {} as Record<string, string> };
    medium.mapping = Object.fromEntries(medium.columns.map((column, i) => [column, 'c' + i]));
    expect(importPresetConfigurationSchema.safeParse(medium).success).toBe(true);
    const oversized = Array.from({ length: 60 }, (_, i) => ({ ...entry(), name: '大配置' + i, configuration: medium }));
    expect(importPresetDocumentSchema.safeParse({ version: 1, revision: 0, entries: oversized }).success).toBe(false);
    expect(importPresetSnapshotSchema.parse({ generation: randomUUID(), revision: 0, entries: [] }).entries).toEqual([]);
    expect(importPresetLimits.documentBytes).toBe(4 * 1024 * 1024);
  });
});
