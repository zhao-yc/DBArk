import type { NetworkConnectionProfile } from './contracts';
import { z } from 'zod';

const identity = z.string().min(1).max(200).refine(value => !value.includes('\0'));
export const mysqlDatabaseBackupTitle = 'MySQL／MariaDB 整库备份';
export const mysqlDumpToolTitle = '选择 mysqldump 或 mariadb-dump';
export const mysqlBackupDatabase = z.string().min(1).refine(value => [...value].length <= 64 &&
  !/^[\-]|[\x00-\x1f\x7f/\\.]| $/u.test(value) && !/^(mysql|information_schema|performance_schema|sys|ndbinfo)$/i.test(value));
export const mysqlDatabaseBackupFormats = ['sql', 'archive'] as const;
export type MysqlDatabaseBackupFormat = typeof mysqlDatabaseBackupFormats[number];
export const mysqlDatabaseBackupChooseSchema = z.object({
  connectionId: identity, database: mysqlBackupDatabase, toolToken: z.uuid(), format: z.enum(mysqlDatabaseBackupFormats).optional(),
}).strict();
export const mysqlDatabaseBackupExecuteSchema = mysqlDatabaseBackupChooseSchema.extend({
  fileToken: z.uuid(), taskId: identity, acknowledgeSnapshot: z.literal(true),
});
export type MysqlDatabaseBackupChooseInput = z.infer<typeof mysqlDatabaseBackupChooseSchema>;
export type MysqlDatabaseBackupInput = z.infer<typeof mysqlDatabaseBackupExecuteSchema>;
export interface MysqlDatabaseBackupResult { bytes: number; toolVersion: string; serverVersion: string; archiveSha256?: string }

export function mysqlDatabaseBackupPathMatches(path: string, format: MysqlDatabaseBackupFormat = 'sql') {
  return (format === 'archive' ? /\.zip$/i : /\.sql$/i).test(path);
}

/** 原地址与原生工具的回环地址不同时，由独立的上游 TLS 会话校验原地址。 */
export function mysqlBackupTunnelRoute(profile: Pick<NetworkConnectionProfile, 'host' | 'ssh' | 'tls'>): {
  host: '127.0.0.1' | '::1'; verifyUpstream: boolean;
} | undefined {
  if (!profile.ssh?.enabled) return;
  if (!profile.tls?.enabled || !profile.tls.rejectUnauthorized) return { host: '127.0.0.1', verifyUpstream: false };
  if (profile.host === '127.0.0.1' || profile.host === '::1') return { host: profile.host, verifyUpstream: false };
  return { host: '127.0.0.1', verifyUpstream: true };
}
