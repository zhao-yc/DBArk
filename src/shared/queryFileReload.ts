import { z } from 'zod';
import { queryFileSourceRefSchema, type QueryFileSourceBlocked, type QueryFileSourceView } from './queryFileSources';

export const queryFileReloadLimits = { previewUnits: 32_768, lifetime: 5 * 60_000, previews: 100 } as const;
const base = { tabId: z.string().min(1).max(200), source: queryFileSourceRefSchema };
const operation = { ...base, taskId: z.string().uuid(), draftDigest: z.string().regex(/^[a-f0-9]{64}$/) };
export const queryFileReloadSchemas = {
  'queryFileSources.checkExternal': z.object(operation).strict(),
  'queryFileSources.reload': z.object({ ...operation, previewId: z.string().uuid() }).strict(),
  'queryFileSources.discardReload': z.object({ ...base, previewId: z.string().uuid() }).strict(),
};
export type QueryFileCheckInput = z.infer<typeof queryFileReloadSchemas['queryFileSources.checkExternal']>;
export type QueryFileReloadInput = z.infer<typeof queryFileReloadSchemas['queryFileSources.reload']>;
export type QueryFileDiscardInput = z.infer<typeof queryFileReloadSchemas['queryFileSources.discardReload']>;
export interface QueryFileTextDifference { prefixUnits: number; suffixUnits: number; beforeUnits: number; afterUnits: number; before: string; after: string; beforeTruncated: boolean; afterTruncated: boolean; }
export interface QueryFileExternalPreview { state: 'preview'; previewId: string; expiresAt: number; change: 'same' | 'modified' | 'replaced'; dirty: boolean; binding: QueryFileSourceView; difference: QueryFileTextDifference; }
export type QueryFileCheckResult = QueryFileExternalPreview | QueryFileSourceBlocked;
export type QueryFileReloadResult = { state: 'reloaded'; sql: string; binding: QueryFileSourceView } | QueryFileSourceBlocked;

/** 线性公共前后缀差异，展示覆盖所有变更的单一区间；不运行无界LCS，不截断完整重载正文。 */
export function queryFileTextDifference(before: string, after: string): QueryFileTextDifference {
  let start = 0, end = 0;
  while (start < before.length && start < after.length && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  while (end < before.length - start && end < after.length - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  // 不在代理对中间拆开展示；CR/LF本身保留原字符而非按行归一化。
  if (start && /[\ud800-\udbff]/.test(before[start - 1])) start--;
  if (end && /[\udc00-\udfff]/.test(before[before.length - end])) end--;
  const oldUnits = before.length - start - end, newUnits = after.length - start - end;
  function excerpt(value: string, units: number) { let length = Math.min(units, queryFileReloadLimits.previewUnits); if (length && /[\ud800-\udbff]/.test(value[start + length - 1])) length--; return value.slice(start, start + length); }
  const oldText = excerpt(before, oldUnits), newText = excerpt(after, newUnits);
  return { prefixUnits: start, suffixUnits: end, beforeUnits: oldUnits, afterUnits: newUnits, before: oldText, after: newText, beforeTruncated: oldText.length < oldUnits, afterTruncated: newText.length < newUnits };
}
