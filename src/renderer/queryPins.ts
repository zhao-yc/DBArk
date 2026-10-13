import type { QueryResult } from '../shared/contracts';
import { zh } from './locales/zh-CN';

export interface PinnedQueryResult { id: string; label: string; result: QueryResult; bytes: number; }
export const pinLimits = { count: 5, bytes: 16 * 1024 * 1024 };

/** 固定的是当前已返回的完整快照，保留类型和精度；容量不足时拒绝而不截断旧结果。 */
export function snapshotQueryResult(pins: PinnedQueryResult[], result: QueryResult, id: string, label: string): PinnedQueryResult {
  if (!result.columns.length) throw new Error(zh.query.pinRequiresRows);
  if (pins.length >= pinLimits.count) throw new Error(zh.query.pinCountLimit);
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  if (pins.reduce((total, pin) => total + pin.bytes, 0) + bytes > pinLimits.bytes) throw new Error(zh.query.pinMemoryLimit);
  return { id, label, result: structuredClone(result), bytes };
}
