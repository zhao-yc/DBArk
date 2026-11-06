import { z } from 'zod';
import type { TableHistogramRange } from './tableHistogram';

export const postgresHistogramBins = z.union([z.literal(5), z.literal(10), z.literal(20)]);
export type PostgresHistogramBins = z.infer<typeof postgresHistogramBins>;
export const postgresHistogramBoundLimit = 4096;

/** 只有已由目录确认的内置数值列可以参加区间比较。 */
export function postgresHistogramKind(column: { type: string; valueOptions?: boolean }) {
  if (!column.valueOptions) return undefined;
  if (/^(smallint|integer|bigint)$/.test(column.type)) return 'integer';
  if (/^numeric(?:\(.*\))?$/.test(column.type)) return 'decimal';
  if (column.type === 'real' || column.type === 'double precision') return 'float';
  return undefined;
}

export interface PostgresTableHistogram {
  column: string;
  requestedBins: PostgresHistogramBins;
  approximate: boolean;
  finite: string;
  nonFinite: string;
  nulls: string;
  ranges: TableHistogramRange[];
}

const count = z.string().regex(/^(0|[1-9]\d{0,18})$/);
// 区间中点可能同时拥有一个端点的整数位和另一个端点的小数位。
const decimal = z.string().max(2 * postgresHistogramBoundLimit + 3).regex(/^-?\d+(?:\.\d+)?$/)
  .transform(value => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value);
const histogram = z.object({
  rows: count, finite: count, nulls: count, high: decimal.nullable(),
  buckets: z.array(z.object({ lower: decimal, count }).strict()).max(20),
}).strict();

function compare(left: string, right: string) {
  const [leftWhole, leftFraction = ''] = left.split('.'), [rightWhole, rightFraction = ''] = right.split('.');
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const a = BigInt(leftWhole + leftFraction.padEnd(scale, '0'));
  const b = BigInt(rightWhole + rightFraction.padEnd(scale, '0'));
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 区间递增、端点有值、总数一致时才发布。计数和边界比较都保留任意精度。 */
export function decodePostgresTableHistogram(raw: unknown, column: string, requestedBins: PostgresHistogramBins, approximate: boolean): PostgresTableHistogram {
  const { rows, finite, nulls, high, buckets } = histogram.parse(raw);
  const nonFinite = BigInt(rows) - BigInt(finite) - BigInt(nulls);
  const fail = () => Error('PostgreSQL 数值分布的区间或计数不一致');
  if (nonFinite < 0n || buckets.length > requestedBins || (finite === '0') !== (high === null) ||
      (finite === '0') !== (buckets.length === 0) ||
      buckets.reduce((sum, bucket) => sum + BigInt(bucket.count), 0n) !== BigInt(finite) ||
      buckets[0]?.count === '0' || buckets.at(-1)?.count === '0') throw fail();
  const ranges = buckets.map(({ lower, count }, index) => {
    const upper = buckets[index + 1]?.lower ?? high!;
    const upperInclusive = index === buckets.length - 1;
    const order = compare(lower, upper);
    if (order > 0 || order === 0 && buckets.length !== 1) throw fail();
    return { lower, upper, upperInclusive, count };
  });
  return { column, requestedBins, approximate, finite, nulls, nonFinite: String(nonFinite), ranges };
}
