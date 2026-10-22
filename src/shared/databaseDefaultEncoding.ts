import type { TableColumnApplyProgress } from './tableColumnPatches';
import type { TableEncodingPair } from './tableDefaultEncoding';

export const databaseDefaultEncodingAcknowledgements = ['ddl-implicit-commit', 'database-default-only', 'external-ddl-window'] as const;
export interface DatabaseDefaultEncodingTarget { connectionId: string; database: string; }
export interface DatabaseDefaultEncodingGetInput extends DatabaseDefaultEncodingTarget { taskId: string; }
export interface DatabaseDefaultEncodingGetOutput {
  target: DatabaseDefaultEncodingTarget; snapshotId: string; expiresAt: string; definitionHash: string; catalogDigest: string;
  current: TableEncodingPair; candidates: TableEncodingPair[]; writable: boolean; reasons: string[]; warnings: string[]; serverVersion: string;
}
export interface DatabaseDefaultEncodingPreviewInput extends TableEncodingPair { snapshotId: string; taskId: string; }
export interface DatabaseDefaultEncodingPreviewOutput {
  target: DatabaseDefaultEncodingTarget; before: TableEncodingPair; after: TableEncodingPair; previewToken: string; expiresAt: string;
  definitionHash: string; catalogDigest: string; sql: string; warnings: string[]; requiredAcknowledgements: string[];
}
export interface DatabaseDefaultEncodingApplyInput { previewToken: string; confirmation: string; acknowledgements: string[]; taskId: string; }
export interface DatabaseDefaultEncodingApplyOutput {
  target: DatabaseDefaultEncodingTarget; ddlSubmitted: true; ddlCompleted: true; definitionVerified: boolean;
  before: TableEncodingPair; after: TableEncodingPair; warnings: string[]; verificationError?: string;
}
export interface DatabaseDefaultEncodingReleaseInput { snapshotId?: string; previewToken?: string; }
export type DatabaseDefaultEncodingProgress = TableColumnApplyProgress;
export const databaseDefaultEncodingWarnings = [
  'DDL可能隐式提交，不能事务回滚；取消、断线或响应丢失不能证明服务器未执行，绝不自动重试。',
  '只修改数据库默认字符集和排序规则，影响以后未显式指定编码的新表；不转换任何已有表、列或数据。',
  '数据库没有可用的稳定对象编号；重核不能完全识别外部删除重建或同值ABA，也不能提供原子比较交换。请在维护窗口暂停并行结构修改。',
] as const;
