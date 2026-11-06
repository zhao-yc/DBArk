import { describe, expect, it } from 'vitest';
import { postgresTableHistogramSchema } from '../../src/shared/postgresTable';
import { decodePostgresTableHistogram, postgresHistogramKind } from '../../src/shared/postgresTableHistogram';

describe('PostgreSQL 数值分布', () => {
  it('只允许原表页字段和固定区间数', () => {
    const input = { connectionId: '连接', database: '库', table: '表', tabId: '页',
      pageToken: 'd312a72b-fdfd-4a6e-8770-f5f1637af235', column: 'c1' };
    expect(postgresTableHistogramSchema.parse({ ...input, bins: 20 }).bins).toBe(20);
    expect(postgresTableHistogramSchema.safeParse({ ...input, bins: '5' }).success).toBe(false);
    expect(postgresTableHistogramSchema.safeParse({ ...input, bins: 5, lower: '1' }).success).toBe(false);
    expect(postgresHistogramKind({ type: 'numeric(2,-3)', valueOptions: true })).toBe('decimal');
    expect(postgresHistogramKind({ type: 'numeric', valueOptions: false })).toBeUndefined();
  });

  it('保留负值及精确小数端点，分离 NULL 与非有限值', () => {
    expect(decodePostgresTableHistogram({ rows: '9007199254741001', finite: '9007199254740999', nulls: '1',
      high: '-9007199254740993.10000000000000001', buckets: [
        { lower: '-9007199254740993.10000000000000003', count: '9007199254740998' },
        { lower: '-9007199254740993.10000000000000002', count: '1' },
      ] }, '金额', 5, false)).toEqual({ column: '金额', requestedBins: 5, approximate: false,
      finite: '9007199254740999', nulls: '1', nonFinite: '1', ranges: [
        { lower: '-9007199254740993.10000000000000003', upper: '-9007199254740993.10000000000000002', upperInclusive: false, count: '9007199254740998' },
        { lower: '-9007199254740993.10000000000000002', upper: '-9007199254740993.10000000000000001', upperInclusive: true, count: '1' },
      ] });
  });

  it('拒绝计数矛盾、端点缺值和逆序边界', () => {
    const result = { rows: '2', finite: '2', nulls: '0', high: '2', buckets: [{ lower: '1', count: '2' }] };
    expect(() => decodePostgresTableHistogram({ ...result, nulls: '1' }, '值', 5, true)).toThrow('不一致');
    expect(() => decodePostgresTableHistogram({ ...result, buckets: [{ lower: '1', count: '0' }, { lower: '2', count: '2' }] }, '值', 5, true)).toThrow('不一致');
    expect(() => decodePostgresTableHistogram({ ...result, high: '0' }, '值', 5, true)).toThrow('不一致');
  });
});
