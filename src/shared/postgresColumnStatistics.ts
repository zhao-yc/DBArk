import { z } from 'zod';

export const postgresStatisticValueLimit = 4096;
const count = z.string().regex(/^(0|[1-9]\d{0,18})$/);
const metric = z.string().max(2 * (postgresStatisticValueLimit + 1)).nullable().transform(value => {
  if (value === null) return null;
  const units = Array.from(value);
  return { text: units.slice(0, postgresStatisticValueLimit).join(''), clipped: units.length > postgresStatisticValueLimit };
});
const statistics = z.object({
  rows: count, nonNull: count,
  empty: count.optional(),
  groups: z.object({ distinct: count, unique: count, min: metric, max: metric }).strict().optional(),
  numeric: z.object({ zero: count, nonFinite: count, sum: metric, average: metric, deviation: metric }).strict().optional(),
}).strict();

/** 计数和派生数量以 bigint 核对，窗口只接收完整且自洽的结果。 */
export function postgresColumnStatistics(raw: unknown) {
  const { groups, ...result } = statistics.parse(raw);
  const rows = BigInt(result.rows), nonNull = BigInt(result.nonNull), { numeric } = result;
  if (nonNull > rows || result.empty !== undefined && BigInt(result.empty) > nonNull ||
      groups && (BigInt(groups.unique) > BigInt(groups.distinct) || BigInt(groups.distinct) > nonNull ||
        (nonNull === 0n ? groups.min !== null || groups.max !== null || groups.distinct !== '0' :
          groups.min === null || groups.max === null || groups.distinct === '0')) ||
      numeric && BigInt(numeric.zero) + BigInt(numeric.nonFinite) > nonNull)
    throw Error('PostgreSQL 字段概况计数或极值不一致');
  return { ...result, nulls: String(rows - nonNull),
    ...(groups ? { groups: { ...groups, repeated: String(BigInt(groups.distinct) - BigInt(groups.unique)) } } : {}) };
}
export type PostgresColumnStatistics = ReturnType<typeof postgresColumnStatistics>;
