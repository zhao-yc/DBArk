import { z } from 'zod';
import type { DataRow, ResultColumn } from './contracts';

export const postgresTableLimits = { page: 200, offset: 1_000_000, changes: 100, fields: 200, value: 64 * 1024, draft: 1024 * 1024 } as const;
const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
const relation = z.string().min(1).max(512).refine(value => !value.includes('\0'));
const token = z.uuid();
const column = z.string().regex(/^c[0-9]{1,4}$/);
const target = z.object({ connectionId: identity, database: identity, table: relation, tabId: identity }).strict();

/** 筛选值与排序方向使用独立结构，标识符只从已读的列目录解析。 */
export const postgresTablePageSchema = target.extend({
  offset: z.number().int().min(0).max(postgresTableLimits.offset),
  limit: z.number().int().min(1).max(postgresTableLimits.page),
  sort: z.object({ column: relation, direction: z.enum(['asc', 'desc']) }).strict().optional(),
  filter: z.object({ column: relation, text: z.string().max(4096).refine(value => !value.includes('\0')) }).strict().optional(),
}).strict();

const fieldValue = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('text'), value: z.string().max(postgresTableLimits.value).refine(value => !value.includes('\0')) }).strict(),
  z.object({ mode: z.literal('binary'), value: z.string().max(postgresTableLimits.value).regex(/^(?:[0-9a-fA-F]{2})*$/) }).strict(),
  z.object({ mode: z.literal('null') }).strict(),
  z.object({ mode: z.literal('default') }).strict(),
]);
const field = z.object({ column, value: fieldValue }).strict();
const row = z.number().int().min(0).max(postgresTableLimits.page - 1);
const change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('insert'), fields: z.array(field).max(postgresTableLimits.fields) }).strict(),
  z.object({ kind: z.literal('update'), row, fields: z.array(field).min(1).max(postgresTableLimits.fields) }).strict(),
  z.object({ kind: z.literal('delete'), row }).strict(),
]);

/** 预览限定一页、每个原行一次及有限值预算；实际提交只接收服务器签发的预览号。 */
export const postgresTablePreviewSchema = target.extend({
  pageToken: token, changes: z.array(change).min(1).max(postgresTableLimits.changes),
}).strict().superRefine((input, context) => {
  let size = 0;
  const usedRows = new Set<number>();
  for (const item of input.changes) {
    if (item.kind !== 'insert') {
      if (usedRows.has(item.row)) context.addIssue({ code: 'custom', message: '同一原行只允许一个草稿动作' });
      usedRows.add(item.row);
    }
    if (item.kind === 'delete') continue;
    const keys = new Set<string>();
    for (const field of item.fields) {
      if (keys.has(field.column)) context.addIssue({ code: 'custom', message: '同一记录的列不能重复' });
      keys.add(field.column);
      size += 32 + ('value' in field.value ? 4 * field.value.value.length : 0);
    }
  }
  if (size > postgresTableLimits.draft) context.addIssue({ code: 'custom', message: '编辑草稿超过大小预算' });
});
export const postgresTableApplySchema = target.extend({ pageToken: token, previewToken: token }).strict();
export const postgresTableReleaseSchema = target.extend({ pageToken: token }).strict();
export type PostgresTableTarget = z.infer<typeof target>;
export type PostgresTablePageInput = z.infer<typeof postgresTablePageSchema>;
export type PostgresTableChange = z.infer<typeof change>;
export type PostgresTableField = z.infer<typeof field>;
export type PostgresTablePreviewInput = z.infer<typeof postgresTablePreviewSchema>;
export type PostgresTableApplyInput = z.infer<typeof postgresTableApplySchema>;
export type PostgresTableReleaseInput = z.infer<typeof postgresTableReleaseSchema>;
export interface PostgresTableColumn extends ResultColumn {
  nullable: boolean;
  defaultValue: boolean;
  generated: boolean;
  primary: boolean;
  binary: boolean;
}
export interface PostgresTablePage {
  pageToken?: string;
  columns: PostgresTableColumn[];
  rows: DataRow[];
  capabilities: { insert: boolean; update: boolean; delete: boolean };
  hasNext: boolean;
  truncated: boolean;
  order: 'primary' | 'physical' | 'unstable';
  relationKind: 'r' | 'p' | 'v' | 'm' | 'f';
}
export interface PostgresTablePreview {
  previewToken: string;
  statements: string[];
  counts: { insert: number; update: number; delete: number };
}
export interface PostgresTableOutcome {
  outcome: 'committed' | 'rolledBack' | 'notSent' | 'unknown';
  affected: number;
  message: string;
}
