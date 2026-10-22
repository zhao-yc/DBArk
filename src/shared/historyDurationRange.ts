import { z } from 'zod';

const endpoint = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** 范围端点为非负安全整数毫秒，两端包含；空范围或倒序不能降级为不限。 */
export const historyDurationRangeSchema = z.object({ minMs: endpoint.optional(), maxMs: endpoint.optional() }).strict()
  .refine(value => value.minMs !== undefined || value.maxMs !== undefined, '耗时范围至少填写一个端点')
  .refine(value => value.minMs === undefined || value.maxMs === undefined || value.minMs <= value.maxMs, '最短耗时不能大于最长耗时');
export type HistoryDurationRange = z.infer<typeof historyDurationRangeSchema>;

/** 实际耗时沿用原number精度，不取整或重算；启用范围后负耗时作为损坏记录进入既有错误政策。 */
export function historyDurationMatches(elapsedMs: number, range?: HistoryDurationRange): boolean {
  if (range === undefined) return true;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw Error('执行历史耗时无效，无法按耗时范围筛选');
  return (range.minMs === undefined || elapsedMs >= range.minMs) && (range.maxMs === undefined || elapsedMs <= range.maxMs);
}
