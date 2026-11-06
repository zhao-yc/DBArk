import { describe, expect, it } from 'vitest';
import type { PostgresTableColumn, PostgresTablePage } from '../../src/shared/postgresTable';
import { capturePostgresRecordTransfer, defaultPostgresTransferMapping, postgresTransferChanges, samePostgresTransferTable } from '../../src/renderer/postgresRecordTransfer';

const relation = { connectionId: '源连接', database: '源库', table: '"样本"."记录"', label: '来源' };
const note: PostgresTableColumn = { key: 'c0', name: '原备注', type: 'text', nullable: true, generated: false, defaultValue: false, primary: false, binary: false };
const amount = { ...note, key: 'c1', name: '金额', type: 'numeric(40,18)' };
const bytes = { ...note, key: 'c2', name: '字节', type: 'bytea', binary: true };
const id: PostgresTableColumn = { ...note, key: 'c3', name: 'id', type: 'bigint', nullable: false, primary: true, sequenceDefault: true, defaultValue: true };
const source: PostgresTablePage = {
  exportToken: '源页', columns: [note, amount, bytes, id], rows: [
    { c0: null, c1: '9007199254740993.000000000000000001', c2: { type: 'binary', base64: 'AP8=' }, c3: '1' },
    { c0: '', c1: '0.000000000000000001', c2: { type: 'binary', base64: '' }, c3: '2' },
  ], capabilities: { insert: false, update: false, delete: false }, hasNext: false, truncated: false, order: 'unstable', relationKind: 'v',
};
const target: PostgresTablePage = {
  ...source, pageToken: '目标页', capabilities: { insert: true, update: false, delete: false }, relationKind: 'r',
  columns: [{ ...note, key: 'c2', name: '备注' }, { ...amount, key: 'c0' }, { ...bytes, key: 'c1' }, id],
};
const capture = () => capturePostgresRecordTransfer(relation, source, source.columns, new Set([1, 0]));

describe('PostgreSQL 跨库记录草稿', () => {
  it('按原页顺序保留精确小数、字节、NULL 与空字符串，序列由目标库维护', () => {
    const snapshot = capture();
    const mapping = defaultPostgresTransferMapping(snapshot, target.columns);
    expect([...mapping]).toEqual([['c0', 'c1'], ['c1', 'c2']]);
    mapping.set('c2', 'c0');
    expect(postgresTransferChanges(snapshot, target, mapping)).toEqual([
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'text', value: '9007199254740993.000000000000000001' } },
        { column: 'c1', value: { mode: 'binary', value: '00ff' } }, { column: 'c2', value: { mode: 'null' } }] },
      { kind: 'insert', fields: [{ column: 'c0', value: { mode: 'text', value: '0.000000000000000001' } },
        { column: 'c1', value: { mode: 'binary', value: '' } }, { column: 'c2', value: { mode: 'text', value: '' } }] },
    ]);
    expect(samePostgresTransferTable(relation, { ...relation, database: '目标库' })).toBe(false);
    expect(samePostgresTransferTable(relation, { ...relation, label: '改名' })).toBe(true);
  });

  it('拒绝缺失字段、生成列、字节到文本、必填目标缺少映射与 NULL', () => {
    const snapshot = capture();
    const columns = [{ ...target.columns[0], nullable: false }, ...target.columns.slice(1), { ...note, key: 'c4', generated: true }];
    const required = { ...target, columns };
    for (const [mapping, message] of [
      [new Map([['c4', 'c0']]), '不匹配'],
      [new Map([['c2', 'c2']]), '不匹配'],
      [new Map([['c2', 'c8']]), '不匹配'],
      [new Map([['c0', 'c1']]), '没有默认值'],
      [new Map([['c2', 'c0']]), 'NULL'],
    ] as const) expect(() => postgresTransferChanges(snapshot, required, mapping)).toThrow(message);
  });

  it('仅复制选择的可见字段，拒绝不完整和超出预算的来源', () => {
    const snapshot = capturePostgresRecordTransfer(relation, source, [amount], new Set([1]));
    expect([...snapshot.rows[0]]).toEqual([['c1', '0.000000000000000001']]);
    expect(() => capturePostgresRecordTransfer(relation, { ...source, truncated: true }, [amount], new Set([1]))).toThrow('变化');
    expect(() => capturePostgresRecordTransfer(relation, { ...source, rows: [{}] }, [amount], new Set([0]))).toThrow('不完整');
    expect(() => capturePostgresRecordTransfer(relation, { ...source, rows: [{ c1: 'x'.repeat(262145) }] }, [amount], new Set([0]))).toThrow('1 MiB');
    const large = capturePostgresRecordTransfer(relation, { ...source, rows: [{ c1: 'x'.repeat(65536) }] }, [amount], new Set([0]));
    const destinations = Array.from({ length: 4 }, (_, index) => ({ ...amount, key: 'c' + index }));
    expect(() => postgresTransferChanges(large, { ...target, columns: destinations },
      new Map(destinations.map(column => [column.key, amount.key])))).toThrow('1 MiB');
  });
});
