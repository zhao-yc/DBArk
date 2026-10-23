import { z } from 'zod';
import { historyPageInputSchema, type HistoryPageEntry } from './historyPages';

/** 清理只接受已见摘要或规范筛选；原文始终留在Main及其有界匹配线程。 */
export const historyDeleteLimits = Object.freeze({ selected: 100, retained: 1000, samples: 3, rawBytes: 128 * 1024 * 1024, lifetimeMs: 5 * 60_000, previewMs: 30_000, tokens: 8, active: 2, recentTasks: 256 });
export const historyDeleteText = Object.freeze({
  stale: '历史、连接配置或预览来源已变化，请重新预览；未删除记录',
  cancelled: '历史清理预览已取消，未删除记录',
  busy: '历史清理预览已达上限，请关闭旧预览后重试',
  taskUsed: '历史清理请求编号已使用，请重新预览',
  budget: '历史清理预览超过原文或时间预算，未生成删除授权',
  invalidRecord: '历史记录或索引损坏，无法完整确认删除范围',
  failed: '历史清理预览未完整完成，未生成删除授权',
  missing: '所选历史已移除或变化，请重新搜索后选择',
  shuttingDown: '客户端正在退出，不能清理执行历史',
});
const id = z.string().min(1).max(200), digest = z.string().regex(/^[a-f0-9]{64}$/);
export const historyDeleteReferenceSchema = z.object({ id, digest }).strict();
export type HistoryDeleteReference = z.infer<typeof historyDeleteReferenceSchema>;
export const historyDeleteFiltersSchema = historyPageInputSchema.omit({ taskId: true, onError: true });
export type HistoryDeleteFilters = z.infer<typeof historyDeleteFiltersSchema>;
export const historyDeletePreviewInputSchema = z.object({
  taskId: z.string().uuid(),
  scope: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('selected'), records: z.array(historyDeleteReferenceSchema).min(1).max(historyDeleteLimits.selected).refine(records => new Set(records.map(record => record.id)).size === records.length, '所选历史不能重复') }).strict(),
    z.object({ kind: z.literal('filtered'), filters: historyDeleteFiltersSchema }).strict(),
  ]),
}).strict();
export const historyDeleteApplyInputSchema = z.object({ previewToken: z.string().uuid() }).strict();
export const historyDeleteReleaseInputSchema = historyDeleteApplyInputSchema;
export type HistoryDeletePreviewInput = z.infer<typeof historyDeletePreviewInputSchema>;
export type HistoryDeleteApplyInput = z.infer<typeof historyDeleteApplyInputSchema>;
export type HistoryDeleteReleaseInput = z.infer<typeof historyDeleteReleaseInputSchema>;
export type HistoryDeleteSample = Pick<HistoryPageEntry, 'entry' | 'sqlPreview' | 'sqlUnits' | 'previewTruncated'>;
export interface HistoryDeletePreviewOutput {
  previewToken: string;
  kind: 'selected' | 'filtered';
  count: number;
  scanned: number;
  samples: HistoryDeleteSample[];
  expiresAt: string;
}
export interface HistoryDeleteApplyOutput { deleted: number; applied: true; }
