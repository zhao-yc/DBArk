import { z } from 'zod';
import { postgresSqlFileStatementBytes } from './postgresSql';
import { postgresArchiveRestoreSchema } from './postgresArchive';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const postgresRestoreDatabaseName = z.string().min(1).max(63).refine(value =>
  value === value.trim() && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value) && new TextEncoder().encode(value).length <= 63);
export const postgresSqlFileTitle = '执行 PostgreSQL SQL 文件';
export const postgresSqlFileLimits = { bytes: 10 * 1024 ** 3, statementBytes: postgresSqlFileStatementBytes, statements: 1_000_000 } as const;
export const postgresSqlFileChooseSchema = z.object({
  connectionId: identity, database: identity, newDatabase: postgresRestoreDatabaseName.optional(),
}).strict();
const execution = postgresSqlFileChooseSchema.extend({ taskId: identity });
export const postgresSqlFileExecuteSchema = z.union([
  execution.extend({ fileToken: z.uuid() }).strict(),
  execution.extend({ archive: postgresArchiveRestoreSchema }).strict().refine(
    input => input.archive.content !== 'data' || input.newDatabase === undefined, '仅数据归档需要已有目标表结构'),
]);
export type PostgresSqlFileExecuteInput = z.infer<typeof postgresSqlFileExecuteSchema>;
export type PostgresSqlFileChooseInput = z.infer<typeof postgresSqlFileChooseSchema>;
export interface PostgresSqlFileChoice { token: string; name: string; bytes: number; }
export interface PostgresSqlFileResult {
  outcome: 'not-started' | 'committed' | 'rolled-back' | 'unknown';
  completed: number;
  cancelled: boolean;
  failure?: { reason: 'connection' | 'create-database' | 'database-exists' | 'archive' | 'file' | 'encoding' | 'syntax' | 'budget' | 'command' | 'server' | 'transaction' | 'cancelled';
    statement?: number; detail?: string; sqlState?: string };
  cleanupWarning?: true;
  databaseCreation?: 'created' | 'refused' | 'unknown';
  archiveWarning?: string;
}
