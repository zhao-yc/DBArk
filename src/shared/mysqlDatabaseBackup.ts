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

/** 原生工具按其连接地址核对证书。仅在能保留同一校验地址时启用严格 TLS 隧道。 */
export function mysqlBackupTunnelHost(profile: Pick<NetworkConnectionProfile, 'host' | 'ssh' | 'tls'>): '127.0.0.1' | '::1' | undefined {
  if (!profile.ssh?.enabled) return;
  if (!profile.tls?.enabled || !profile.tls.rejectUnauthorized) return '127.0.0.1';
  if (profile.host === '127.0.0.1' || profile.host === '::1') return profile.host;
  throw Error('此 SSH 连接要求验证数据库证书。原生备份仅能保留 127.0.0.1 或 ::1 的证书身份校验');
}
