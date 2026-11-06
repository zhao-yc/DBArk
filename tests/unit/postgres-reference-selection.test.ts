import { describe, expect, it } from 'vitest';
import { postgresTableReferenceLimits, postgresTableReferenceSchema, type PostgresTableReference } from '../../src/shared/postgresTable';
import { postgresReferenceSelection } from '../../src/renderer/postgresReferenceSelection';
import { readPostgresTableReferences } from '../../src/engine/postgres/tableReferences';
import type { PostgresConnection } from '../../src/engine/postgres/connection';

const choice: PostgresTableReference = {
  id: '10', stamp: 'a'.repeat(64), name: '复合键', schema: '引用库', table: '父"表',
  pairs: [
    { local: 'c2', localName: '键值', remote: 'id', binary: false },
    { local: 'c1', localName: '字节', remote: 'raw', binary: true },
  ],
};

describe('PostgreSQL 外键选值', () => {
  it('按约束顺序填入完整复合键，保留大整数和 BYTEA 原值', () => {
    expect(postgresReferenceSelection(choice, { c0: '9007199254740993', c1: { type: 'binary', base64: 'AP8=' }, c2: '说明' }))
      .toEqual([{ column: 'c2', value: { mode: 'text', value: '9007199254740993' } },
        { column: 'c1', value: { mode: 'binary', value: '00ff' } }]);
  });

  it('拒绝不完整元组、空键和已经丢失精度的值', () => {
    expect(() => postgresReferenceSelection(choice, { c0: '1' })).toThrow('完整');
    expect(() => postgresReferenceSelection(choice, { c0: '1', c1: null })).toThrow('完整');
    expect(() => postgresReferenceSelection(choice, { c0: 9007199254740992, c1: '合法' })).toThrow('完整');
  });

  it('IPC 只接收原页能力及目录标识，拒绝目标 SQL 和越界参数', () => {
    const input = {
      connectionId: '连接', database: '库', table: '"引用库"."子表"', tabId: '标签', pageToken: 'abcabcab-abca-4abc-8abc-abcabcabcabc',
      lookup: { id: choice.id, stamp: choice.stamp, search: '字面_%', offset: 40 },
    };
    expect(postgresTableReferenceSchema.safeParse(input).success).toBe(true);
    expect(postgresTableReferenceSchema.safeParse({ ...input, lookup: { ...input.lookup, table: '自定义表' } }).success).toBe(false);
    expect(postgresTableReferenceSchema.safeParse({ ...input, lookup: { ...input.lookup, offset: 100_001 } }).success).toBe(false);
    expect(postgresTableReferenceSchema.safeParse({ ...input, lookup: { ...input.lookup, search: '\0' } }).success).toBe(false);
  });

  it('浏览引用记录只接受原页行号及精确目录定位', () => {
    const input = {
      connectionId: '连接', database: '库', table: '"引用库"."子表"', tabId: '标签', pageToken: 'abcabcab-abca-4abc-8abc-abcabcabcabc',
      parentRow: 0, lookup: { id: choice.id, stamp: choice.stamp, search: '', offset: 0 },
    };
    expect(postgresTableReferenceSchema.safeParse(input).success).toBe(true);
    expect(postgresTableReferenceSchema.safeParse({ ...input, parentRow: 200 }).success).toBe(false);
    expect(postgresTableReferenceSchema.safeParse({ ...input, parentRow: -1 }).success).toBe(false);
    expect(postgresTableReferenceSchema.safeParse({ ...input, keyValues: ['任意键'] }).success).toBe(false);
    expect(postgresTableReferenceSchema.safeParse({ ...input, lookup: { ...input.lookup, offset: 1 } }).success).toBe(false);
  });

  it('每次读取外键目录独立计算行预算', async () => {
    const connection = { query: async (_sql: string, _values: unknown[], budget: { rows: number }) => {
      expect(budget.rows).toBe(postgresTableReferenceLimits.constraints + 1);
      // 驱动在接收行时扣减预算，后续目录读取仍应使用完整额度。
      budget.rows--;
      return { rows: [], truncated: false };
    } } as unknown as PostgresConnection;
    await readPostgresTableReferences(connection, '1', [], undefined);
    await readPostgresTableReferences(connection, '1', [], undefined);
  });
});
