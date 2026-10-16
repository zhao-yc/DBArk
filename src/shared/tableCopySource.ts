import { z } from 'zod';
import type { DataRow, TableInfo } from './contracts';

/** 来源补取只签发有界引用，不接收界面提供的SQL、键值或完整性证明。 */
export const tableCopySourceLimits = { rowBytes: 256 * 1024, resultBytes: 512 * 1024, keyBytes: 8 * 1024, definitionBytes: 2 * 1024 * 1024, columns: 1024, references: 4000, cacheBytes: 32 * 1024 * 1024, pagesPerConnection: 4, retentionMs: 5 * 60000, timeoutMs: 15000 } as const;
const connectionId = z.string().min(1).max(200), reference = z.string().uuid();
export const tableCopySourceReadSchema = z.object({ connectionId, taskId: reference, pageRef: reference, rowRef: reference }).strict();
export const tableCopySourceReleaseSchema = z.object({ connectionId, pageRef: reference }).strict();
export type TableCopySourceReadInput = z.infer<typeof tableCopySourceReadSchema>;
export type TableCopySourceReleaseInput = z.infer<typeof tableCopySourceReleaseSchema>;
export type TableCopyUnavailable = 'identity-permission' | 'identity-unproven' | 'no-key' | 'budget' | 'unsupported' | 'expired' | 'changed';
export type TableCopyPageSources = { status: 'ready'; pageRef: string; rowRefs: (string | null)[]; expiresAt: number; metadataKey: string; missingColumns: string[] } | { status: 'unavailable'; reason: TableCopyUnavailable; missingColumns: string[] };
export interface TableCopySourceReadResult { target: { connectionId: string; database: string; table: string }; pageRef: string; rowRef: string; metadataKey: string; readAt: string; complete: true; values: DataRow }

/** 只比较写入边界和可见目录，不包含变化中的表级自增计数；物理身份另由引擎租约证明。 */
export function tableCopyMetadataKey(info: TableInfo): string {
  return JSON.stringify([info.database, info.name, info.objectKind, info.engine, info.charset, info.collation, info.comment, info.editableKey, info.primaryKey, info.indexes, info.foreignKeys, info.columns.map(column => [column.name, column.type, column.nullable, column.generated, column.extra, column.defaultValue, column.characterSet, column.comment])]);
}
