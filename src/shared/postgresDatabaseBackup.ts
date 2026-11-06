import { z } from 'zod';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const postgresDatabaseBackupTitle = 'PostgreSQL 整库备份';
export const postgresDatabaseBackupPickToolTitle = '选择 PostgreSQL pg_dump';
export const postgresDatabaseBackupToolSchema = z.object({}).strict();
export const postgresDatabaseBackupChooseSchema = z.object({
  connectionId: identity, database: identity, portable: z.boolean(), toolToken: z.uuid(),
}).strict();
export const postgresDatabaseBackupExecuteSchema = postgresDatabaseBackupChooseSchema.extend({
  fileToken: z.uuid(), taskId: identity,
}).strict();
export type PostgresDatabaseBackupChooseInput = z.infer<typeof postgresDatabaseBackupChooseSchema>;
export type PostgresDatabaseBackupInput = z.infer<typeof postgresDatabaseBackupExecuteSchema>;
export interface PostgresDatabaseBackupResult {
  bytes: number;
  toolVersion: string;
  warning?: string;
}
