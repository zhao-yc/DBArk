import { historyPagesZh as text } from './locales/historyPages.zh-CN';
import type { HistoryDurationRange } from '../shared/historyDurationRange';

export type HistoryDurationInputRange = HistoryDurationRange;

/** 文本端点只允许非负安全整数毫秒；拒绝Number的指数、小数与隐式对象转换。 */
function endpoint(value: string): number | undefined {
  if (typeof value !== 'string' || value.length > 64) throw Error(text.durationInvalid);
  const normalized = value.trim(); if (!normalized) return;
  if (!/^[0-9]+$/.test(normalized)) throw Error(text.durationInvalid);
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 0) throw Error(text.durationInvalid);
  return number;
}

/** 只在明确搜索时转换草稿；双端包含、允许相等，空白双端省略整个范围。 */
export function historyDurationInputRange(minimum: string, maximum: string): HistoryDurationInputRange | undefined {
  const minMs = endpoint(minimum), maxMs = endpoint(maximum);
  if (minMs === undefined && maxMs === undefined) return;
  if (minMs !== undefined && maxMs !== undefined && minMs > maxMs) throw Error(text.durationOrder);
  return { ...(minMs !== undefined ? { minMs } : {}), ...(maxMs !== undefined ? { maxMs } : {}) };
}
