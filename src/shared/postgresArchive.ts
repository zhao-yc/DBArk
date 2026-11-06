import { z } from 'zod';

export const postgresArchiveTitle = 'PostgreSQL 自定义归档';
export const postgresArchiveToolTitle = '选择 PostgreSQL pg_restore';
export const postgresArchiveOpenTitle = '打开 PostgreSQL 自定义归档';
export const postgresArchiveSaveTitle = '导出 PostgreSQL 归档 SQL';
export const postgresArchiveRestoreTitle = '恢复 PostgreSQL 自定义归档';
export const postgresArchiveListLimit = 2 * 1024 ** 2;

export const postgresArchiveChooseSchema = z.object({ kind: z.enum(['tool', 'source']) }).strict();
export const postgresArchiveCancelSchema = z.object({ operationId: z.uuid() }).strict();
export const postgresArchiveListSchema = postgresArchiveCancelSchema.extend({ sourceToken: z.uuid(), toolToken: z.uuid() }).strict();
export const postgresArchiveRestoreSchema = postgresArchiveListSchema.omit({ operationId: true }).extend({
  content: z.enum(['all', 'schema', 'data']), portable: z.boolean(),
}).strict();
export const postgresArchiveExportSchema = postgresArchiveRestoreSchema.extend({ operationId: z.uuid() }).strict();
export type PostgresArchiveListInput = z.infer<typeof postgresArchiveListSchema>;
export type PostgresArchiveExportInput = z.infer<typeof postgresArchiveExportSchema>;
export type PostgresArchiveRestoreInput = z.infer<typeof postgresArchiveRestoreSchema>;
export interface PostgresArchiveRestoreChoice { name: string; selection: PostgresArchiveRestoreInput }
export interface PostgresArchiveListing { text: string; toolVersion: string; warning?: string }
export interface PostgresArchiveSqlExport { name: string; bytes: number; toolVersion: string; warning?: string }
