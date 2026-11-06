import { describe, expect, it } from 'vitest';
import { postgresColumnStatistics } from '../../src/shared/postgresColumnStatistics';
import { postgresTableColumnReadSchema } from '../../src/shared/postgresTable';

describe('PostgreSQL 字段概况', () => {
  it('以原精度计算 NULL 与重复组数，并标出已截断的极值', () => {
    const value = '🧪'.repeat(4097);
    expect(postgresColumnStatistics({
      rows: '9007199254740995', nonNull: '9007199254740993', empty: '1',
      groups: { distinct: '9007199254740991', unique: '9007199254740990', min: '', max: value },
    })).toMatchObject({ nulls: '2', empty: '1', groups: {
      repeated: '1', min: { text: '', clipped: false }, max: { text: '🧪'.repeat(4096), clipped: true },
    } });
  });

  it('拒绝不一致计数或极值，IPC 只允许原表页字段', () => {
    expect(() => postgresColumnStatistics({ rows: '1', nonNull: '2' })).toThrow('不一致');
    expect(() => postgresColumnStatistics({
      rows: '0', nonNull: '0', groups: { distinct: '0', unique: '0', min: '', max: null },
    })).toThrow('不一致');
    const request = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1' };
    expect(postgresTableColumnReadSchema.safeParse(request).success).toBe(true);
    expect(postgresTableColumnReadSchema.safeParse({ ...request, search: '额外条件' }).success).toBe(false);
  });
});
