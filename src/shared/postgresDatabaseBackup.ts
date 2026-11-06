import { z } from 'zod';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const postgresDatabaseBackupTitle = 'PostgreSQL 整库备份';
export const postgresDatabaseBackupPickToolTitle = '选择 PostgreSQL pg_dump';
export const postgresDatabaseBackupToolSchema = z.object({}).strict();
const options = z.object({
  connectionId: identity, database: identity, portable: z.boolean(), toolToken: z.uuid(),
  format: z.enum(['sql', 'custom']).optional(),
}).strict();
const preservesArchiveOwners = (input: z.infer<typeof options>) => input.format !== 'custom' || !input.portable;
export const postgresDatabaseBackupChooseSchema = options.refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略');
export const postgresDatabaseBackupExecuteSchema = options.extend({
  fileToken: z.uuid(), taskId: identity,
}).strict().refine(preservesArchiveOwners, '归档会保留所有者和授权，请在转换 SQL 时选择是否省略');
export const postgresCustomArchiveExtensions = ['dump', 'backup'] as const;
export const isPostgresCustomArchiveDestination = (path: string) => /\.(?:dump|backup)$/i.test(path);
export type PostgresDatabaseBackupChooseInput = z.infer<typeof postgresDatabaseBackupChooseSchema>;
export type PostgresDatabaseBackupInput = z.infer<typeof postgresDatabaseBackupExecuteSchema>;
export interface PostgresDatabaseBackupResult {
  bytes: number;
  toolVersion: string;
  warning?: string;
}
