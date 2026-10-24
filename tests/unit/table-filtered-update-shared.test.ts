import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TableInfo } from '../../src/shared/contracts';
import { tableFilteredUpdateBinaryBytes, tableFilteredUpdateColumns, tableFilteredUpdateConfirmation, tableFilteredUpdateLimits, tableFilteredUpdatePreviewInputSchema } from '../../src/shared/tableFilteredUpdate';

const input = () => ({ connectionId: 'offline', database: 'db', table: 'subject', taskId: randomUUID(), metadataKey: '可信元数据', filters: [{ column: 'id', operator: 'IN', values: ['18446744073709551615', '0'] }], sort: [{ column: 'id', direction: 'DESC' }], column: 'note', value: '保留\0空白 🚢 ' });
function source(): TableInfo { return { database: 'db', name: 'subject', objectKind: 'table', engine: 'InnoDB', columns: ['id', 'note', 'amount', 'at', 'computed'].map(name => ({ name, type: name === 'id' ? 'BIGINT' : name === 'amount' ? 'DECIMAL(30,12)' : name === 'at' ? 'TIMESTAMP(6)' : 'TEXT', nullable: name !== 'id', generated: name === 'computed', defaultValue: null, extra: name === 'computed' ? 'STORED GENERATED' : '', comment: '' })), indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], ddl: '完整定义由Engine再核' }; }
describe('全部筛选行填充共享契约', () => {
  it('保留原筛选与值，准确确认文本含库表列及行数', () => {
    const original = input(); expect(tableFilteredUpdatePreviewInputSchema.parse(original)).toEqual(original);
    expect(tableFilteredUpdateConfirmation({ target: { connectionId: 'x', database: '库', table: '表' }, column: '字段', rows: 1105 })).toBe('库.表 / 字段 / 1105');
    expect(tableFilteredUpdateLimits).toMatchObject({ previews: 2, lifetimeMs: 600000, spoolBytes: 10737418240, previewSqlBytes: 262144 });
  });
  it('不读取访问器，不把继承、稀疏或客户端SQL提升为可信输入', () => {
    const getter = vi.fn(() => '旧值'), bad = input(); Object.defineProperty(bad, 'value', { get: getter, enumerable: true });
    expect(() => tableFilteredUpdatePreviewInputSchema.parse(bad)).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const value of [{ ...input(), sql: 'UPDATE 任意' }, Object.assign(Object.create({ value: '继承' }), { ...input(), value: undefined }), { ...input(), sort: Array(1) }, { ...input(), value: '\ud800' }, { ...input(), filters: [{ column: 'id', operator: 'IN', values: ['1'], enabled: false }], filterGroup: { mode: 'all', children: [] } }]) expect(() => tableFilteredUpdatePreviewInputSchema.parse(value)).toThrow();
  });
  it('8MiB规范Base64逐字节校验，空字节合法，坏padding和真实超限均拒绝', () => {
    expect(tableFilteredUpdateBinaryBytes('')).toBe(0); expect(tableFilteredUpdateBinaryBytes('AP8=')).toBe(2);
    for (const value of ['AB==', 'AAF=', 'A===', 'YWJj\n', '====']) expect(() => tableFilteredUpdateBinaryBytes(value)).toThrow();
    const exact = Buffer.alloc(tableFilteredUpdateLimits.fieldBytes).toString('base64'); expect(tableFilteredUpdateBinaryBytes(exact)).toBe(tableFilteredUpdateLimits.fieldBytes);
    expect(() => tableFilteredUpdateBinaryBytes(Buffer.alloc(tableFilteredUpdateLimits.fieldBytes + 1).toString('base64'))).toThrow();
  });
  it.each([
    { kind: 'secondary unique', unique: true, columns: ['note'] },
    { kind: 'nonunique', unique: false, columns: ['note'] },
    { kind: 'composite unique', unique: true, columns: ['note', 'amount'] },
    { kind: 'composite nonunique', unique: false, columns: ['amount', 'note'] },
    { kind: 'prefix catalog', unique: false, columns: ['note'] },
  ])('$kind的每个分量均不得全范围填充，普通无索引字段仍可选择', ({ unique, columns }) => {
    const info = source(); info.indexes.push({ name: 'secondary', unique, columns });
    expect(tableFilteredUpdateColumns(info).map(column => column.name)).toEqual(['note', 'amount', 'at'].filter(name => !columns.includes(name)));
  });
  it.each(['unknown', 'empty', 'duplicate', 'generated', 'on-update'] as const)('%s索引依赖不完整或会自动变化时整表无候选', kind => {
    const info = source(), columns = kind === 'unknown' ? ['missing'] : kind === 'empty' ? [] : kind === 'duplicate' ? ['note', 'note'] : kind === 'generated' ? ['computed'] : ['at'];
    if (kind === 'on-update') info.columns.find(column => column.name === 'at')!.extra = 'on update CURRENT_TIMESTAMP(6)';
    info.indexes.push({ name: 'secondary', unique: false, columns }); expect(tableFilteredUpdateColumns(info)).toEqual([]);
  });
});
