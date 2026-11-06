import { z } from 'zod';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const mysqlDatabaseBackupTitle = 'MySQL／MariaDB 整库备份';
export const mysqlDumpToolTitle = '选择 mysqldump 或 mariadb-dump';
export const mysqlBackupDatabase = z.string().min(1).refine(value => [...value].length <= 64 &&
  !/^[\-]|[\x00-\x1f\x7f/\\.]| $/u.test(value) && !/^(mysql|information_schema|performance_schema|sys|ndbinfo)$/i.test(value));
export const mysqlDatabaseBackupChooseSchema = z.object({
  connectionId: identity, database: mysqlBackupDatabase, toolToken: z.uuid(),
}).strict();
export const mysqlDatabaseBackupExecuteSchema = mysqlDatabaseBackupChooseSchema.extend({
  fileToken: z.uuid(), taskId: identity, acknowledgeSnapshot: z.literal(true),
});
export type MysqlDatabaseBackupChooseInput = z.infer<typeof mysqlDatabaseBackupChooseSchema>;
export type MysqlDatabaseBackupInput = z.infer<typeof mysqlDatabaseBackupExecuteSchema>;
export interface MysqlDatabaseBackupResult { bytes: number; toolVersion: string; serverVersion: string }
