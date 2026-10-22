import type { TableColumnApplyProgress } from './tableColumnPatches';

export interface DatabaseDropTarget { connectionId: string; database: string; }
export type DatabaseDropProgress = TableColumnApplyProgress;
export const databaseDropAcknowledgements = ['irreversible-database-drop', 'external-ddl-window', 'external-references-and-grants', 'sessions-and-partial-failure'] as const;
export interface DatabaseDropCounts { tables: number; views: number; procedures: number; functions: number; triggers: number; events: number; }
export interface DatabaseDropGetInput extends DatabaseDropTarget { taskId: string; }
export interface DatabaseDropPreviewInput { snapshotId: string; taskId: string; }
export interface DatabaseDropApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface DatabaseDropReleaseInput { snapshotId?: string; previewToken?: string; }
export interface DatabaseDropGetOutput {
  target: DatabaseDropTarget; snapshotId: string; expiresAt: string; catalogDigest: string;
  counts: DatabaseDropCounts; charset: string; collation: string; writable: boolean;
  reasons: string[]; warnings: string[]; serverVersion: string;
}
export interface DatabaseDropPreviewOutput {
  target: DatabaseDropTarget; previewToken: string; expiresAt: string; catalogDigest: string;
  counts: DatabaseDropCounts; sql: string; requiredAcknowledgements: string[]; warnings: string[];
}
export interface DatabaseDropApplyOutput {
  target: DatabaseDropTarget; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean;
  warnings: string[]; after?: { databaseAbsent: boolean }; verificationError?: string;
}

/** 保留合法 Unicode 和反引号；禁止服务器本身不接受的路径、NUL、补充平面字符及尾空格，不自动修剪。 */
export function validateDatabaseDropName(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 64 || /[\u0000.\\/\uD800-\uDFFF]/.test(value) || value.endsWith(' ')) throw Error('数据库名称无效；须为1至64个服务器合法字符，不会自动修剪或改名');
  return value;
}

/** 只在目录交叉核验后编码单一标识符，不将名称解释为SQL。 */
export function databaseDropIdentifier(value: string): string { return '`' + validateDatabaseDropName(value).replaceAll('`', '``') + '`'; }

/** 系统库匹配不依赖服务器大小写映射，始终禁止删除。 */
export function isProtectedDatabaseDropName(value: string): boolean { return ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(value.toLowerCase()); }
