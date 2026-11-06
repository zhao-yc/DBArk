import { describe, expect, it } from 'vitest';
import { comparePostgresSnapshots } from '../../src/engine/postgres/dataCompare';

describe('PostgreSQL 表数据比较', () => {
  const columns = [{ name: 'id', type: 'numeric' }, { name: 'bytes', type: 'bytea' }, { name: 'note', type: 'text' }];
  const keys = ['id'];
  const bytes = { type: 'binary', base64: 'AP+A' } as const;

  it('按精确数值键匹配并保留小数形式、字节及空值差异', () => {
    const result = comparePostgresSnapshots(
      { columns, keys, rows: [['9007199254740993.00', bytes, null], ['2', null, '左']] },
      { columns, keys, rows: [['9007199254740993.0', { ...bytes }, ''], ['3', null, '右']] }, false,
    );
    expect(result.counts).toEqual({ 'source-only': 1, 'target-only': 1, different: 1 });
    expect(result.differences.find(row => row.kind === 'different')).toEqual({
      kind: 'different', key: ['9007199254740993.00'],
      cells: [
        { column: 0, source: '9007199254740993.00', target: '9007199254740993.0' },
        { column: 2, source: null, target: '' },
      ],
    });
  });

  it('拒绝无损表示仍重复的主键及声明类型不一致', () => {
    const original = { columns, keys, rows: [['1', null, null]] };
    expect(() => comparePostgresSnapshots(original, { columns, keys, rows: [['1.0', null, null], ['1.00', null, null]] }, true))
      .toThrow('重复的主键');
    expect(() => comparePostgresSnapshots(original, { ...original, columns: [{ name: 'id', type: 'text' }, ...columns.slice(1)] }, true))
      .toThrow('声明类型须一致');
  });
});
