import { z } from 'zod';

/** 首阶段只接受两张明确配对的基本表，不由客户端传入凭据或 SQL。 */
const name = z.string().min(1).max(64).refine(value => !value.includes('\0'), '名称不能包含 NUL');
export const schemaCompareTargetSchema = z.object({ connectionId: z.string().min(1).max(200), database: name, table: name }).strict();
export const schemaCompareInputSchema = z.object({ taskId: z.string().min(1).max(200), source: schemaCompareTargetSchema, target: schemaCompareTargetSchema }).strict();
export type SchemaCompareTarget = z.infer<typeof schemaCompareTargetSchema>;
export type SchemaCompareInput = z.infer<typeof schemaCompareInputSchema>;
export const schemaCompareLimits = { active: 2, snapshots: 8, snapshotMs: 120_000, definitionBytes: 2 * 1024 * 1024, objects: 4608, reportBytes: 12 * 1024 * 1024, cacheBytes: 32 * 1024 * 1024, selections: 100 } as const;
export const schemaCompareSelectionSchema = z.object({ category: z.enum(['columns', 'indexes', 'foreignKeys', 'unclassified']), name }).strict();
export const schemaComparePreviewSchema = z.object({ snapshotId: z.string().min(1).max(200), selections: z.array(schemaCompareSelectionSchema).min(1).max(schemaCompareLimits.selections) }).strict().superRefine((value, context) => {
  if (new Set(value.selections.map(item => JSON.stringify([item.category, item.name]))).size !== value.selections.length) context.addIssue({ code: 'custom', message: '不能重复选择差异项' });
});
export const schemaCompareReleaseSchema = z.object({ snapshotId: z.string().min(1).max(200) }).strict();
export type SchemaComparePreviewInput = z.infer<typeof schemaComparePreviewSchema>;
export interface SchemaCompareResult extends SchemaCompareReport { snapshotId: string; expiresAt: string; }
export interface SchemaComparePreview {
  direction: 'source-to-target'; target: SchemaCompareTarget; expiresAt: string; sql: string;
  statements: { category: SchemaCompareCategory; name: string; sql: string; destructive: boolean }[];
  blocked: { category: SchemaCompareCategory; name: string; reasons: string[] }[];
  warnings: string[]; executable: false;
}
export type SchemaCompareCategory = 'columns' | 'indexes' | 'foreignKeys' | 'unclassified';
export type SchemaCompareStatus = 'added' | 'removed' | 'changed' | 'same' | 'unknown';
export interface SchemaCompareFragment { rawSql: string; ordinal?: number; }
export interface SchemaCompareDifference {
  category: SchemaCompareCategory; name: string; status: SchemaCompareStatus;
  source?: SchemaCompareFragment; target?: SchemaCompareFragment;
  /** 逐项差异包含不可证明原因，避免未知内容被误报为相同。 */
  reasons: string[]; changedProperties: string[];
}
export interface SchemaCompareIgnoredFragment { side: 'source' | 'target'; category: 'tableOptions'; rawSql: string; }
export interface SchemaCompareReport {
  source: SchemaCompareTarget; target: SchemaCompareTarget;
  direction: 'source-to-target'; mode: 'read-only-definition';
  rows: SchemaCompareDifference[]; counts: Record<SchemaCompareStatus, number>;
  /** 仅表示本次已覆盖投影的判断，不代表数据库或表的全部结构相同。 */
  comparable: boolean; ignored: string[]; ignoredFragments: SchemaCompareIgnoredFragment[];
  sourceVersion: string; targetVersion: string;
}
